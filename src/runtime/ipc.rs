//! Runs the protocol of `bun_ipc` over a socket or a pipe, for JavaScript values.

use core::cell::Cell;
use core::convert::Infallible;
use core::ffi::{c_int, c_void};

use crate::api::bun::subprocess::Subprocess;
use crate::ipc_host::IPCInstance;
use crate::node::node_cluster_binding::{self as cluster, ClusterPeer};
#[cfg(windows)]
use bun_collections::ByteVecExt as _;
use bun_core::{Output, String as BunString, StringView, strings};
use bun_io::KeepAlive;
use bun_ipc::{
    Event, Frame, FrameError, Inbox, Kind, Mode, Offer, Outbox, Payload, Phase, Reply, WriteReason,
    Wrote,
};
use bun_jsc as jsc;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::js_value::Protected;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    GlobalRef, JSGlobalObject, JSObject, JSValue, JsCell, JsError, JsResult, SerializedFlags,
    StringJsc as _, Task,
};
use bun_ptr::{BackRef, RefPtr, ThisPtr};
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
#[cfg(windows)]
use bun_sys::windows::libuv::{UvHandle as _, UvStream as _};
use bun_sys::{CloseOnDrop, Fd};
use bun_uws::CloseCode;

bun_core::define_scoped_log!(log, IPC, visible);

bun_core::comptime_string_map! {
    pub(crate) static MODE_MAP: Mode = {
        b"advanced" => Mode::Advanced,
        b"json" => Mode::Json,
    };
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum SerializeAndSendResult {
    Success,
    Failure,
    Backoff,
}

/// Closes the channel.
enum ReadError {
    Silent,
    TooLong,
    Js(JsError),
}

impl From<FrameError> for ReadError {
    fn from(err: FrameError) -> Self {
        match err {
            FrameError::Invalid => ReadError::Silent,
            FrameError::LineTooLong => ReadError::TooLong,
        }
    }
}

impl From<JsError> for ReadError {
    fn from(err: JsError) -> Self {
        match err {
            JsError::OutOfMemory => ReadError::TooLong,
            JsError::Thrown | JsError::Terminated => ReadError::Js(err),
        }
    }
}

/// Runs no script, so `frame` can be borrowed from the inbox.
fn decode(
    mode: Mode,
    Frame { kind, body, .. }: Frame<'_>,
    global: &JSGlobalObject,
) -> Result<(Kind, JSValue), ReadError> {
    // The previous handler may have taken a worker's termination trap, which JSONParse asserts against.
    if global.bun_vm().script_execution_status() != jsc::ScriptExecutionStatus::Running {
        return Err(ReadError::Silent);
    }
    let value = match (kind, mode) {
        (Kind::Version, _) => JSValue::UNDEFINED,
        (_, Mode::Advanced) => JSValue::deserialize(body, global)?,
        (_, Mode::Json) => parse_json(body, global)?,
    };
    Ok((kind, value))
}

fn parse_json(json: &[u8], global: &JSGlobalObject) -> Result<JSValue, ReadError> {
    extern "C" fn on_free(freed: &Cell<bool>, _: *mut c_void, _: usize) {
        freed.set(true);
    }
    let parsed = if strings::is_all_ascii(json) {
        let freed = Cell::new(false);
        // SAFETY: `json` and the flag outlive `string`, and the check below panics if anything kept a ref past it.
        let string = unsafe { BunString::create_external::<&Cell<bool>>(json, &freed, on_free) };
        if string.tag() == bun_core::Tag::Dead {
            return Err(ReadError::TooLong);
        }
        let parsed = string.to_js_by_parse_json(global);
        drop(string);
        assert!(
            freed.get(),
            "Expected ascii string to be freed by ExternalString, but it wasn't. This is a bug in Bun."
        );
        parsed
    } else {
        StringView::borrow_utf8(json).to_js_by_parse_json(global)
    };
    parsed.map_err(|err| match err {
        JsError::Terminated => ReadError::Js(err),
        JsError::Thrown => {
            // A pending termination is not cleared by this and keeps unwinding.
            global.clear_exception();
            ReadError::Silent
        }
        JsError::OutOfMemory => bun_core::out_of_memory(),
    })
}

fn serialize(
    mode: Mode,
    global: &JSGlobalObject,
    mut value: JSValue,
    mut kind: Kind,
) -> JsResult<Vec<u8>> {
    if mode == Mode::Json {
        let json = value.json_stringify_fast(global)?;
        if json.tag() == bun_core::Tag::Dead {
            return Err(JsError::OutOfMemory);
        }
        return (mode.encode(kind, json.to_utf8().slice())).ok_or(JsError::OutOfMemory);
    }
    if kind == Kind::Data {
        let envelope = jsc::cpp::IPCTagAdvancedBuffers(global, value)?;
        if !envelope.is_null() {
            (value, kind) = (envelope, Kind::DataWithBuffers);
        }
    }
    let flags = SerializedFlags {
        for_cross_process_transfer: true,
        for_storage: false,
    };
    (mode.encode(kind, value.serialize(global, flags)?.data())).ok_or(JsError::OutOfMemory)
}

#[cfg(windows)]
type Socket = uv::Owned<uv::Pipe>;
#[cfg(not(windows))]
pub(crate) type Socket = bun_uws::SocketHandler<false>;

pub(crate) struct Handle {
    #[cfg(windows)]
    pub fd: Fd,
    #[cfg(not(windows))]
    duplicate: CloseOnDrop,
    js: Protected,
    close_on_complete: bool,
    pub cluster_seq: Option<i32>,
    #[cfg(windows)]
    pub win_export_hex: Option<Box<[u8]>>,
    #[cfg(windows)]
    pub peer_pid: u32,
}

impl Handle {
    pub(crate) fn new(fd: Fd, js: JSValue, close_on_complete: bool) -> bun_sys::Result<Self> {
        Ok(Self {
            #[cfg(windows)]
            fd,
            #[cfg(not(windows))]
            duplicate: CloseOnDrop::new(bun_sys::dup(fd)?),
            js: js.protected(),
            close_on_complete,
            cluster_seq: None,
            #[cfg(windows)]
            win_export_hex: None,
            #[cfg(windows)]
            peer_pid: 0,
        })
    }

    #[cfg(not(windows))]
    fn export_again(&mut self, _message: &mut [u8]) {}

    #[cfg(windows)]
    fn export_again(&mut self, message: &mut [u8]) {
        if let Some(hex) = &mut self.win_export_hex
            && let Some(new_hex) = windows_export_socket_hex(self.fd, self.peer_pid)
        {
            if let Some(pos) = bun_core::memmem(message, hex) {
                message[pos..pos + new_hex.len()].copy_from_slice(&new_hex);
            }
            *hex = new_hex;
        }
    }

    fn close_next_tick(&self, global: &JSGlobalObject) {
        if self.close_on_complete {
            let close = jsc::JSFunction::create(
                global,
                "",
                crate::generated_bindgen::ipc::Bun__IPC__closeSentHandle,
                1,
                Default::default(),
            );
            let _ = JSValue::call_next_tick_1(close, global, self.js.value());
        }
    }
}

pub(crate) fn close_sent_handle<'a>(
    cx: &mut JsScope<'a>,
    handle: Option<JsLocal<'a, JSObject>>,
) -> JsResult<()> {
    let global = cx.global();
    if let Some(handle) = handle {
        let js = handle.to_js();
        if let Some(f) = js.get(global, "close")? {
            if f.is_callable() {
                f.call(global, js, &[])?;
            }
        }
    }
    Ok(())
}

#[derive(Default)]
enum Callbacks {
    #[default]
    None,
    One(Protected),
    /// An array and its length: one GC root for a backlog of any size.
    Many(Protected, u32),
}

impl Callbacks {
    /// Runs no script: `put_index` does not look at `Array.prototype`, unlike `push`.
    fn add(&mut self, callback: JSValue, global: &JSGlobalObject) -> JsResult<()> {
        match self {
            _ if !callback.is_callable() => {}
            Callbacks::None => *self = Callbacks::One(callback.protected()),
            Callbacks::One(first) => {
                let array = JSValue::create_array_from_slice(global, &[first.value(), callback])?;
                *self = Callbacks::Many(array.protected(), 2);
            }
            Callbacks::Many(array, len) => {
                array.value().put_index(global, *len, callback)?;
                *len += 1;
            }
        }
        Ok(())
    }

    fn call_next_tick(&self, global: &JSGlobalObject) -> JsResult<()> {
        match self {
            Callbacks::None => {}
            Callbacks::One(it) => JSValue::call_next_tick_1(it.value(), global, JSValue::NULL)?,
            Callbacks::Many(array, _) => {
                let mut callbacks = array.value().array_iterator(global)?;
                while let Some(callback) = callbacks.next()? {
                    JSValue::call_next_tick_1(callback, global, JSValue::NULL)?;
                }
            }
        }
        Ok(())
    }
}

fn complete(offer: &Offer<Handle, Callbacks>, global: &JSGlobalObject) {
    offer.handle.close_next_tick(global);
    let _ = offer.callbacks.call_next_tick(global); // TODO: properly propagate exception upwards
}

#[cfg(windows)]
struct WindowsWrite {
    write_req: uv::uv_write_t,
    write_buffer: uv::uv_buf_t,
    write_slice: Box<[u8]>,
    owner: Option<*mut SendQueue>,
}

/// No method of `outbox` or `inbox` can run script, so a borrow of either ends before script can reach it.
#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct SendQueue {
    ref_count: Cell<u32>,
    root: Cell<Option<BackRef<SendQueue, bun_ptr::Root>>>,
    mode: Mode,
    phase: Cell<Phase>,
    outbox: JsCell<Outbox<Handle, Callbacks>>,
    inbox: JsCell<Inbox>,
    #[cfg(not(windows))]
    incoming_fd: Cell<Option<CloseOnDrop>>,
    /// From `attach` until `Phase::Closed`.
    socket: JsCell<Option<Socket>>,
    /// Until `detach`.
    owner: Cell<Option<SendQueueOwner>>,
    keep_alive: KeepAlive,
    pub(crate) cluster: JsCell<ClusterPeer>,
    /// libuv's until `windows_on_write_complete`.
    #[cfg(windows)]
    windows_write: Cell<Option<*mut WindowsWrite>>,
}

#[derive(Copy, Clone)]
pub(crate) enum SendQueueOwner {
    Subprocess(BackRef<Subprocess<'static>>),
    Instance,
}

impl SendQueueOwner {
    fn global(self) -> GlobalRef {
        GlobalRef::new(match &self {
            SendQueueOwner::Subprocess(subprocess) => subprocess.global_this.get(),
            SendQueueOwner::Instance => VirtualMachine::get().global(),
        })
    }

    /// The `target` of `parseHandle`.
    fn to_js(self) -> JSValue {
        match self {
            SendQueueOwner::Subprocess(subprocess) => {
                subprocess.this_value.get().try_get().unwrap_or_default()
            }
            SendQueueOwner::Instance => JSValue::NULL,
        }
    }
}

impl SendQueue {
    pub(crate) fn new(mode: Mode, owner: SendQueueOwner) -> RefPtr<SendQueue> {
        let this = RefPtr::new(Self {
            ref_count: Cell::new(1),
            root: Cell::new(None),
            mode,
            phase: Cell::new(Phase::Open),
            outbox: JsCell::default(),
            inbox: JsCell::new(Inbox::new(mode)),
            #[cfg(not(windows))]
            incoming_fd: Cell::new(None),
            socket: JsCell::new(None),
            owner: Cell::new(Some(owner)),
            keep_alive: KeepAlive::default(),
            cluster: JsCell::default(),
            #[cfg(windows)]
            windows_write: Cell::new(None),
        });
        this.root.set(Some(BackRef::from(this.this_ptr())));
        this
    }

    fn this_ptr(&self) -> ThisPtr<SendQueue> {
        (self.root.get().expect("SendQueue::new sets root")).this_ptr()
    }

    pub(crate) fn as_ctx_ptr(&self) -> *mut SendQueue {
        self.this_ptr().as_ptr()
    }

    pub(crate) fn attach(&self, socket: Socket) {
        self.socket.set(Some(socket));
    }

    pub(crate) fn detach(&self) {
        self.phase.set(Phase::Reported);
        self.close_socket(CloseCode::Failure);
        self.owner.set(None);
    }

    pub(crate) fn is_connected(&self) -> bool {
        self.phase.get() == Phase::Open
    }

    pub(crate) fn is_close_reported(&self) -> bool {
        self.phase.get() == Phase::Reported
    }

    pub(crate) fn disconnect(&self) {
        let awaits_ack = self.outbox.get().unacked().is_some();
        self.advance(Event::Disconnect { awaits_ack });
    }

    pub(crate) fn close_after_exit(&self) {
        self.advance(Event::PeerExited);
    }

    fn advance(&self, event: Event) {
        let Some(phase) = self.phase.get().after(event) else {
            return;
        };
        log!("{:?} -> {:?} on {:?}", self.phase.get(), phase, event);
        self.phase.set(phase);
        if phase.needs_task() {
            let this = RefPtr::from_this(self.this_ptr());
            (VirtualMachine::get().event_loop()).enqueue_task(Task::from_ref::<Self>(this));
        }
    }

    /// Script can run the event loop until the close is reported. The guard keeps a `Subprocess`, and so `self`, past that.
    fn hold_owner(&self) -> Option<(GlobalRef, jsc::EnsureStillAlive)> {
        let owner = self.owner.get()?;
        Some((owner.global(), jsc::EnsureStillAlive(owner.to_js())))
    }

    fn close_socket(&self, code: CloseCode) {
        #[cfg(windows)]
        {
            let _ = code;
            let is_open = self.with_pipe(|pipe| pipe.read_stop()).is_some();
            if is_open && self.windows_write.get().is_some() && !self.is_close_reported() {
                return self.advance(Event::CloseBlocked);
            }
        }
        #[cfg(not(windows))]
        if let Some(socket) = *self.socket.get() {
            socket.close(code);
        }
        self.socket_closed();
    }

    pub(crate) fn socket_closed(&self) {
        #[cfg(windows)]
        if let Some(windows_write) = self.windows_write.take() {
            // SAFETY: libuv holds it until `windows_on_write_complete`, which frees it.
            unsafe { (*windows_write).owner = None };
        }
        self.keep_alive.disable();
        self.socket.set(None);
        self.advance(Event::TransportClosed);
    }

    /// `task_tag::SendQueueDeferred` dispatch, under the task's ref.
    pub(crate) fn run_deferred(&self) {
        let Some((global, _alive)) = self.hold_owner() else {
            return;
        };
        let phase = self.phase.get();
        #[cfg(not(windows))]
        if phase == Phase::ClosingAfterRead
            && let Some(socket) = *self.socket.get()
        {
            socket.read_now();
        }
        if matches!(phase, Phase::Closing | Phase::ClosingAfterRead) {
            self.close_socket(CloseCode::Normal);
        }
        if self.phase.get() != Phase::Closed {
            return;
        }
        self.phase.set(Phase::Reported);
        if let Some(offer) = self.outbox.with_mut(Outbox::take_unacked) {
            complete(&offer, &global);
        }
        for payload in self.outbox.with_mut(Outbox::take_unsent) {
            if let Payload::Handle(offer) = payload {
                offer.handle.close_next_tick(&global);
            }
        }
        match self.owner.get() {
            Some(SendQueueOwner::Subprocess(subprocess)) => subprocess.handle_ipc_close(),
            Some(SendQueueOwner::Instance) => IPCInstance::handle_ipc_close(),
            None => {}
        }
    }

    /// `uv::open_handles` closes the channel's pipe through here at a thread
    /// teardown: close now (pending writes finish ECANCELED) and let the owner
    /// observe the disconnect, rather than waiting for writes as a user close does.
    #[cfg(windows)]
    unsafe fn stop_for_vm_teardown(this: *mut c_void) {
        // SAFETY: recorded at configure time by this live SendQueue; the pipe
        // leaves the list when it drops.
        unsafe { &*this.cast::<SendQueue>() }.socket_closed();
    }

    pub(crate) fn write_version_packet(&self) {
        if let Some(packet) = self.mode.version_packet() {
            let no_callback = |_: &mut Callbacks| Ok::<_, Infallible>(());
            let Ok(()) = (self.outbox).with_mut(|it| it.push(packet.to_vec(), None, no_callback));
            self.flush(WriteReason::Queued);
        }
    }

    pub(crate) fn serialize_and_send(
        &self,
        global: &JSGlobalObject,
        value: JSValue,
        kind: Kind,
        callback: JSValue,
        handle: Option<Handle>,
    ) -> SerializeAndSendResult {
        let is_backed_up = self.outbox.get().is_backed_up();
        let Ok(bytes) = serialize(self.mode, global, value, kind) else {
            return SerializeAndSendResult::Failure;
        };
        if self.is_close_reported() {
            // Script ran the event loop while it serialized, or node:cluster is late. Nothing would release it.
            if let Some(handle) = handle {
                handle.close_next_tick(global);
            }
        } else {
            let add_callback = |callbacks: &mut Callbacks| callbacks.add(callback, global);
            let pushed = (self.outbox).with_mut(|it| it.push(bytes, handle, add_callback));
            if pushed.is_err() {
                return SerializeAndSendResult::Failure;
            }
            self.flush(WriteReason::Queued);
        }
        if is_backed_up {
            return SerializeAndSendResult::Backoff;
        }
        SerializeAndSendResult::Success
    }

    fn flush(&self, mut reason: WriteReason) {
        while self.write(reason) {
            reason = WriteReason::Writable;
        }
        if self.outbox.get().is_idle() {
            self.advance(Event::Idle);
            self.keep_alive.unref(bun_io::js_vm_ctx());
        } else {
            self.keep_alive.ref_(bun_io::js_vm_ctx());
        }
    }

    /// Returns whether to write on.
    fn on_write_complete(&self, written: Option<usize>) -> bool {
        log!("wrote {:?}", written);
        match self.outbox.with_mut(|outbox| outbox.end_write(written)) {
            Wrote::Continue(callbacks) => {
                if let Some(owner) = self.owner.get() {
                    let _ = callbacks.call_next_tick(&owner.global());
                }
                true
            }
            Wrote::Blocked => false,
            Wrote::Failed => {
                self.close_socket(CloseCode::Failure);
                false
            }
        }
    }

    /// Returns whether to write on.
    #[cfg(not(windows))]
    fn write(&self, reason: WriteReason) -> bool {
        let socket = *self.socket.get();
        let written = self.outbox.with_mut(|outbox| {
            let (data, handle) = outbox.begin_write(reason)?;
            Some(socket.map(|socket| match handle {
                None => socket.write(data),
                Some(handle) => socket.write_fd(data, handle.duplicate.fd().native()),
            }))
        });
        written.is_some_and(|it| self.on_write_complete(it.and_then(|n| usize::try_from(n).ok())))
    }

    /// Returns whether to write on. `windows_on_write_complete` has the result of a write that started.
    #[cfg(windows)]
    fn write(&self, reason: WriteReason) -> bool {
        let Some(write_slice) =
            (self.outbox).with_mut(|outbox| Some(Box::<[u8]>::from(outbox.begin_write(reason)?.0)))
        else {
            return false;
        };
        let Some(stream) = self.with_pipe(|pipe| {
            pipe.ref_(); // ref on write
            pipe.as_stream()
        }) else {
            return self.on_write_complete(None);
        };

        let mut write_req = Box::new(WindowsWrite {
            owner: Some(self.as_ctx_ptr()),
            write_slice,
            write_req: bun_core::ffi::zeroed(),
            write_buffer: uv::uv_buf_t::init(b""), // re-init below after slice address is stable
        });
        write_req.write_buffer = uv::uv_buf_t::init(&write_req.write_slice);
        let write_req = bun_ptr::AliasableBox::from(write_req);
        let req = write_req.as_ptr();
        debug_assert!(self.windows_write.get().is_none());

        // SAFETY: `req` stays put until the write callback takes it.
        let result = unsafe {
            (*req).write_req.write(
                stream,
                &(*req).write_buffer,
                req,
                SendQueue::windows_on_write_complete,
            )
        };
        if result.is_err() {
            drop(write_req);
            self.with_pipe(|pipe| pipe.unref());
            return self.on_write_complete(None);
        }
        self.windows_write.set(Some(write_req.into_raw()));
        false
    }

    #[cfg(windows)]
    fn windows_on_write_complete(write_req: *mut WindowsWrite, status: uv::ReturnCode) {
        let (this, write_len) = {
            // SAFETY: the box `write` gave up, which libuv hands back once.
            let write_req = unsafe { bun_core::heap::take(write_req) };
            (write_req.owner, write_req.write_slice.len())
        };
        let Some(this) = this else {
            return; // disconnected before the write completes
        };
        // SAFETY: `socket_closed` clears `owner` before the SendQueue can go.
        let this = unsafe { &*this };
        let _alive = this.hold_owner();
        let _scope = VirtualMachine::get().enter_event_loop_scope();
        this.windows_write.set(None);
        this.with_pipe(|pipe| pipe.unref()); // write complete; unref
        let is_written = status.to_error(bun_sys::Tag::write).is_none();
        if this.on_write_complete(is_written.then_some(write_len)) {
            this.flush(WriteReason::Writable);
        }
        if this.phase.get() == Phase::ClosingAfterWrite {
            this.close_socket(CloseCode::Normal);
        }
    }

    #[cfg(windows)]
    fn with_pipe<R>(&self, f: impl FnOnce(&mut uv::Pipe) -> R) -> Option<R> {
        (self.socket).with_mut(|socket| socket.as_mut().map(|pipe| f(pipe)))
    }

    #[cfg(windows)]
    pub(crate) fn ipc_peer_pid(&self) -> u32 {
        self.with_pipe(|pipe| pipe.ipc_remote_pid()).unwrap_or(0)
    }

    /// # Safety
    /// `this` must point at a live `SendQueue` and must derive from the
    /// allocation's root raw pointer (SharedReadWrite provenance), NOT from a
    /// `&mut` reborrow: the pointer is stashed in `uv_handle_t.data` for the
    /// pipe's lifetime.
    #[cfg(windows)]
    pub(crate) unsafe fn windows_configure_server(
        this: *mut Self,
        mut ipc_pipe: uv::Owned<uv::Pipe>,
    ) -> bun_sys::Result<()> {
        log!("configureServer");
        ipc_pipe.unref();
        ipc_pipe.set_owner(this.cast(), Self::stop_for_vm_teardown);
        // Routes through the `StreamReader for SendQueue` impl below.
        let result = ipc_pipe.read_start_ctx::<SendQueue>(this);
        // SAFETY: caller contract — `this` is a live SendQueue.
        let self_ = unsafe { &*this };
        self_.attach(ipc_pipe);
        result
            .to_result(bun_sys::Tag::listen)
            .inspect_err(|_| self_.close_socket(CloseCode::Failure))
    }

    /// SAFETY: as [`Self::windows_configure_server`].
    #[cfg(windows)]
    pub(crate) unsafe fn windows_configure_client(
        this: *mut Self,
        pipe_fd: Fd,
    ) -> bun_sys::Result<()> {
        log!("configureClient");
        let mut ipc_pipe = uv::Owned::<uv::Pipe>::zeroed();
        ipc_pipe
            .init(uv::Loop::get(), true)
            .to_result(bun_sys::Tag::pipe)?;
        ipc_pipe.open(pipe_fd.uv()).to_result(bun_sys::Tag::open)?;
        // SAFETY: fn contract.
        unsafe { Self::windows_configure_server(this, ipc_pipe) }
    }

    pub(crate) fn on_writable(&self) {
        let _alive = self.hold_owner();
        let _scope = VirtualMachine::get().enter_event_loop_scope();
        self.flush(WriteReason::Writable);
    }

    pub(crate) fn on_end(&self) {
        self.close_socket(CloseCode::Failure);
    }

    pub(crate) fn on_fd(&self, fd: c_int) {
        #[cfg(windows)]
        let _ = fd;
        #[cfg(not(windows))]
        (self.incoming_fd).set(Some(CloseOnDrop::new(Fd::from_native(fd))));
    }

    pub(crate) fn on_data(&self, data: &[u8]) {
        let Some((global, _alive)) = self.hold_owner() else {
            return;
        };
        let _scope = global.bun_vm().enter_event_loop_scope();
        let Err(err) = self.deliver_all(&global, data) else {
            return;
        };
        // A read that is being delivered further up the stack has nothing left to report.
        self.inbox.set(Inbox::new(self.mode));
        match err {
            ReadError::Silent => {}
            ReadError::TooLong => Output::print_errorln("IPC message is too long."),
            ReadError::Js(err) => crate::dispatch::fold(Err(err)),
        }
        self.close_socket(CloseCode::Failure);
    }

    fn deliver_all(&self, global: &JSGlobalObject, mut data: &[u8]) -> Result<(), ReadError> {
        let max_len = BunString::max_length();
        if self.mode == Mode::Advanced && self.inbox.get().is_empty() {
            while let Some(frame) = bun_ipc::advanced_frame(data, max_len)? {
                data = data.get(frame.len..).unwrap_or_default();
                self.deliver(global, decode(self.mode, frame, global)?)?;
                if data.is_empty() {
                    return Ok(());
                }
            }
        }
        (self.inbox).with_mut(|inbox| inbox.buffer().extend_from_slice(data));
        let decode = |frame: Frame<'_>| decode(self.mode, frame, global);
        while let Some(decoded) = (self.inbox).with_mut(|inbox| inbox.next(max_len, decode))? {
            self.deliver(global, decoded?)?;
        }
        Ok(())
    }

    /// What a message's delivery throws is reported, and the next message is delivered.
    #[inline]
    fn deliver(
        &self,
        global: &JSGlobalObject,
        (kind, message): (Kind, JSValue),
    ) -> Result<(), ReadError> {
        log!("received {:?}", kind);
        crate::dispatch::fold(match kind {
            Kind::Version => Ok(()),
            Kind::Internal => self.on_internal_message(global, message),
            Kind::Data => self.on_message(global, message),
            Kind::DataWithBuffers => {
                let message = jsc::cpp::IPCRestoreAdvancedBuffers(global, message)?;
                self.on_message(global, message)
            }
        });
        Ok(())
    }

    fn on_message(&self, global: &JSGlobalObject, message: JSValue) -> JsResult<()> {
        if message.is_object()
            && let Some(cmd) = message.fast_get(global, jsc::BuiltinName::cmd)?
            && cmd.is_string()
        {
            let cmd = BunString::from_js(cmd, global)?;
            if cmd.eq_ascii(b"NODE_HANDLE") {
                if let Some(received) = self.accept_handle(global, message)?
                    && let Some(owner) = self.owner.get()
                {
                    let fd = received_fd_to_js(received.fd());
                    let emit = jsc::cpp::IPCParse(global, owner.to_js(), message, fd)?;
                    // The object that `parseHandle` made closes it.
                    received.into_raw();
                    if emit.is_callable() {
                        emit.call(global, JSValue::UNDEFINED, &[])?;
                    }
                }
                return Ok(());
            } else if cmd.eq_ascii(b"NODE_HANDLE_ACK") {
                self.on_ack_nack(global, Reply::Ack);
                return Ok(());
            } else if cmd.eq_ascii(b"NODE_HANDLE_NACK") {
                self.on_ack_nack(global, Reply::Nack);
                return Ok(());
            }
        }
        match self.owner.get() {
            Some(SendQueueOwner::Subprocess(it)) => {
                it.handle_ipc_message(message, JSValue::UNDEFINED)
            }
            Some(SendQueueOwner::Instance) => {
                IPCInstance::handle_ipc_message(message, JSValue::UNDEFINED)
            }
            None => {}
        }
        Ok(())
    }

    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/cluster/utils.js#L33-L49
    #[inline(never)]
    fn on_internal_message(&self, global: &JSGlobalObject, message: JSValue) -> JsResult<()> {
        let mut received = None;
        if message.is_object()
            && (message.get(global, "$hasHandle")?).is_some_and(|it| it.to_boolean())
        {
            received = self.accept_handle(global, message)?;
            if received.is_none() {
                return Ok(());
            }
        }
        let Some(owner) = self.owner.get() else {
            return Ok(());
        };
        if let SendQueueOwner::Subprocess(subprocess) = owner {
            return cluster::handle_internal_message_primary(
                global,
                &self.cluster,
                subprocess.context,
                message,
            );
        }
        let fd = (received.as_ref()).map_or(JSValue::UNDEFINED, |it| received_fd_to_js(it.fd()));
        if cluster::handle_internal_message_child(global, message, fd)
            && let Some(received) = received
        {
            received.into_raw();
        }
        Ok(())
    }

    /// Takes the descriptor that `message` announces, and tells the peer whether it came.
    fn accept_handle(
        &self,
        global: &JSGlobalObject,
        message: JSValue,
    ) -> JsResult<Option<CloseOnDrop>> {
        #[cfg(windows)]
        let received = import_windows_socket_payload(global, message)?;
        #[cfg(not(windows))]
        let _ = (global, message);
        #[cfg(not(windows))]
        let received = self.incoming_fd.take();
        let reply = match received {
            Some(_) => Reply::Ack,
            None => Reply::Nack,
        };
        (self.outbox).with_mut(|outbox| outbox.push_reply(self.mode.reply_packet(reply)));
        self.flush(WriteReason::Queued);
        Ok(received)
    }

    fn on_ack_nack(&self, global: &JSGlobalObject, reply: Reply) {
        let Some(cluster_seq) = self.outbox.get().unacked().map(|it| it.cluster_seq) else {
            return;
        };
        if reply == Reply::Nack && !self.outbox.with_mut(|it| it.resend(Handle::export_again)) {
            // The handle stays unacked meanwhile: what script sends from here is called back after it.
            if let Some(callback) =
                cluster_seq.and_then(|seq| self.cluster.with_mut(|it| it.take_callback(seq)))
            {
                let reply = JSValue::create_empty_object(global, 1);
                reply.put(global, b"accepted", JSValue::FALSE);
                let _ = JSValue::call_next_tick_1(callback.get(), global, reply);
            }
            let warning =
                BunString::static_("Handle did not reach the receiving process correctly");
            let name = BunString::static_("SentHandleNotReceivedWarning");
            if let Ok(warning) = warning.into_js(global)
                && let Ok(name) = name.into_js(global)
            {
                let _ = global.emit_warning(warning, name, JSValue::UNDEFINED, JSValue::UNDEFINED);
            }
        }
        if let Some(offer) = self.outbox.with_mut(Outbox::take_unacked) {
            complete(&offer, global);
        }
        self.flush(WriteReason::Queued);
    }
}

// SAFETY: nothing touches `inbox` between `on_read_alloc` and the report of the read.
#[cfg(windows)]
unsafe impl uv::StreamReader for SendQueue {
    fn on_read_alloc(this: &Self, suggested_size: usize) -> *mut [u8] {
        (this.inbox).with_mut(|inbox| inbox.buffer().uv_alloc_spare(suggested_size))
    }
    fn on_read_error(this: &Self, _: c_int) {
        this.advance(Event::ReadFailed);
    }
    unsafe fn on_read(this: &Self, nread: usize) {
        // SAFETY: `on_read_alloc` reserved at least `nread` bytes, which libuv initialised.
        (this.inbox).with_mut(|inbox| unsafe { inbox.buffer().uv_commit(nread) });
        this.on_data(&[]);
    }
}

impl bun_event_loop::RefTask for SendQueue {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::SendQueueDeferred;
    type Ref = RefPtr<Self>;
    fn release_unrun(_: Self::Ref) {}
    /// The channel's own close hop.
    fn context(_: &Self::Ref) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl Drop for SendQueue {
    fn drop(&mut self) {
        self.detach();
    }
}

#[cfg(windows)]
pub(crate) fn windows_export_socket_hex(fd: Fd, peer_pid: u32) -> Option<Box<[u8]>> {
    let size = bun_uws::socket_transfer::bsd_socket_export_size() as usize;
    let mut info = vec![0u8; size];
    // SAFETY: `info` is `size` bytes as required; `fd.native()` is the SOCKET.
    let rc = unsafe {
        bun_uws::socket_transfer::bsd_socket_export(
            fd.native() as bun_uws::LIBUS_SOCKET_DESCRIPTOR,
            peer_pid,
            info.as_mut_ptr().cast::<core::ffi::c_void>(),
        )
    };
    if rc != 0 {
        return None;
    }
    let mut hex = vec![0u8; size * 2];
    let n = bun_core::strings::encode_bytes_to_hex(&mut hex, &info);
    debug_assert!(n == size * 2);
    hex.truncate(n);
    Some(hex.into_boxed_slice())
}

#[cfg(windows)]
pub(crate) const WIN_SOCKET_INFO_KEY: &[u8] = b"$winSocketInfo";

#[cfg(windows)]
fn import_windows_socket_payload(
    global: &JSGlobalObject,
    msg_data: JSValue,
) -> JsResult<Option<CloseOnDrop>> {
    let Some(info_value) = msg_data
        .get(global, WIN_SOCKET_INFO_KEY)?
        .filter(|v| v.is_string())
    else {
        return Ok(None);
    };
    let hex_view = info_value.to_js_string_view(global)?;
    let hex = hex_view.to_utf8();
    let expected = bun_uws::socket_transfer::bsd_socket_export_size() as usize;
    let mut info = vec![0u8; expected];
    let decoded = strings::decode_hex_to_bytes_truncate(&mut info, hex.slice());
    if decoded != expected {
        log!(
            "importWindowsSocketPayload: bad blob length {} (want {})",
            decoded,
            expected
        );
        return Ok(None);
    }
    let mut err: c_int = 0;
    // SAFETY: `info` is a live buffer of export_size() bytes holding the
    let sock = unsafe {
        bun_uws::socket_transfer::bsd_socket_import(info.as_mut_ptr().cast::<c_void>(), &mut err)
    };
    if sock == bun_uws::LIBUS_SOCKET_DESCRIPTOR::MAX {
        log!("importWindowsSocketPayload: WSASocketW failed: {}", err);
        return Ok(None);
    }
    let socket = CloseOnDrop::new(Fd::from_system(sock as *mut c_void));
    msg_data.delete_property(global, WIN_SOCKET_INFO_KEY)?;
    Ok(Some(socket))
}

fn received_fd_to_js(fd: Fd) -> JSValue {
    #[cfg(windows)]
    {
        let v = fd.native() as u64;
        if v <= i32::MAX as u64 {
            JSValue::js_number_from_int32(v as i32)
        } else {
            JSValue::js_number_from_uint64(v)
        }
    }
    #[cfg(not(windows))]
    {
        JSValue::js_number_from_int32(fd.uv())
    }
}
