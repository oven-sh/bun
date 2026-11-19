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
    Answer, Audience, Body, Due, Event, Frame, FrameError, Inbox, Kind, Link, Mode, Offer, Outbox,
    Packet, Reply, Write, WriteReason, Wrote,
};
use bun_jsc as jsc;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::js_value::Protected;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    GlobalRef, JSGlobalObject, JSObject, JSValue, JsCell, JsError, JsResult, SerializedFlags,
    StringJsc as _, Task,
};
use bun_ptr::{BackRef, RefPtr, Root};
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
#[inline(always)]
fn decode(frame: Frame<Body<'_>>, global: &JSGlobalObject) -> Result<Frame<JSValue>, ReadError> {
    // The previous handler may have taken a worker's termination trap, which JSONParse asserts against.
    if global.bun_vm().script_execution_status() != jsc::ScriptExecutionStatus::Running {
        return Err(ReadError::Silent);
    }
    Ok(match frame {
        Frame::Version => Frame::Version,
        Frame::Message(kind, Body::Clone(body)) => {
            Frame::Message(kind, JSValue::deserialize(body, global)?)
        }
        Frame::Message(kind, Body::Json(body)) => Frame::Message(kind, parse_json(body, global)?),
    })
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

fn serialize_json(global: &JSGlobalObject, value: JSValue, audience: Audience) -> JsResult<Packet> {
    let json = value.json_stringify_fast(global)?;
    if json.tag() == bun_core::Tag::Dead {
        return Err(JsError::OutOfMemory);
    }
    Ok(bun_ipc::encode_json(audience, json.to_utf8().slice()))
}

fn serialize_advanced(
    global: &JSGlobalObject,
    value: JSValue,
    audience: Audience,
) -> JsResult<Packet> {
    let (kind, value) = match audience {
        Audience::Cluster => (Kind::Internal, value),
        Audience::User => match jsc::cpp::IPCTagAdvancedBuffers(global, value)? {
            JSValue::NULL => (Kind::Data, value),
            envelope => (Kind::DataWithBuffers, envelope),
        },
    };
    let flags = SerializedFlags {
        for_cross_process_transfer: true,
        for_storage: false,
    };
    bun_ipc::encode_advanced(kind, value.serialize(global, flags)?.data())
        .ok_or(JsError::OutOfMemory)
}

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
        if !callback.is_callable() {
            return Ok(());
        }
        match self {
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

type This = BackRef<SendQueue, Root>;

#[cfg(not(windows))]
struct Transport {
    this: This,
    socket: bun_uws::SocketHandler<false>,
}

#[cfg(windows)]
struct Transport {
    this: This,
    pipe: uv::Owned<uv::Pipe>,
    /// libuv's until `windows_on_write_complete`.
    write: Option<*mut WindowsWrite>,
}

#[cfg(windows)]
struct WindowsWrite {
    write_req: uv::uv_write_t,
    write_buffer: uv::uv_buf_t,
    write_slice: Box<[u8]>,
    /// Taken by whichever comes first, the completion or the close.
    pending: Option<(This, SendQueueOwner, Write<Handle, Callbacks>)>,
}

#[cfg(windows)]
impl Transport {
    /// Gives `write` back if it did not start.
    fn start(
        &mut self,
        owner: SendQueueOwner,
        write: Write<Handle, Callbacks>,
    ) -> Option<Write<Handle, Callbacks>> {
        self.pipe.ref_(); // ref on write
        let mut write_req = Box::new(WindowsWrite {
            write_slice: write.bytes().into(),
            write_req: bun_core::ffi::zeroed(),
            write_buffer: uv::uv_buf_t::init(b""), // re-init below after slice address is stable
            pending: Some((self.this, owner, write)),
        });
        write_req.write_buffer = uv::uv_buf_t::init(&write_req.write_slice);
        let write_req = bun_ptr::AliasableBox::from(write_req);
        let req = write_req.as_ptr();

        // SAFETY: `req` stays put until the write callback takes it.
        let result = unsafe {
            (*req).write_req.write(
                self.pipe.as_stream(),
                &(*req).write_buffer,
                req,
                SendQueue::windows_on_write_complete,
            )
        };
        if result.is_err() {
            self.pipe.unref();
            return write_req.into_box().pending.map(|(.., write)| write);
        }
        self.write = Some(write_req.into_raw());
        None
    }
}

/// `decode`, `Callbacks::add`, the socket's write and `Handle::export_again` run under a borrow of `inbox` or `outbox`: they must not run script.
#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct SendQueue {
    ref_count: Cell<u32>,
    mode: Mode,
    link: JsCell<Link<SendQueueOwner, Transport>>,
    outbox: JsCell<Outbox<Handle, Callbacks>>,
    inbox: JsCell<Inbox>,
    #[cfg(not(windows))]
    incoming_fd: Cell<Option<CloseOnDrop>>,
    keep_alive: KeepAlive,
    pub(crate) cluster: JsCell<ClusterPeer>,
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

/// Script can run the event loop until the close is reported. This keeps a `Subprocess`, and so its channel, past that.
struct Held {
    owner: SendQueueOwner,
    global: GlobalRef,
    _alive: jsc::EnsureStillAlive,
}

impl SendQueue {
    fn detached(mode: Mode) -> RefPtr<SendQueue> {
        RefPtr::new(Self {
            ref_count: Cell::new(1),
            mode,
            link: JsCell::new(Link::detached()),
            outbox: JsCell::default(),
            inbox: JsCell::new(Inbox::new(mode)),
            #[cfg(not(windows))]
            incoming_fd: Cell::new(None),
            keep_alive: KeepAlive::default(),
            cluster: JsCell::default(),
        })
    }

    /// `Some`: the channel owns `fd`.
    #[cfg(not(windows))]
    pub(crate) fn open(mode: Mode, owner: SendQueueOwner, fd: Fd) -> Option<RefPtr<SendQueue>> {
        let vm = VirtualMachine::get();
        let group = vm.rare_data().spawn_ipc_group(vm.uws_loop());
        let queue = Self::detached(mode);
        let kind = bun_uws::SocketKind::SpawnIpc;
        let socket = bun_uws::SocketHandler::from_fd(group, kind, fd, queue.as_ptr(), true)?;
        let this = queue.this_ptr().into();
        (queue.link).set(Link::open(owner, Transport { this, socket }));
        Some(queue)
    }

    /// A channel that could not start to read is closed, and reports it like any other.
    #[cfg(windows)]
    pub(crate) fn open(
        mode: Mode,
        owner: SendQueueOwner,
        mut pipe: uv::Owned<uv::Pipe>,
    ) -> (RefPtr<SendQueue>, bun_sys::Result<()>) {
        let queue = Self::detached(mode);
        pipe.unref();
        pipe.set_owner(queue.as_ptr().cast(), Self::stop_for_vm_teardown);
        // Routes through the `StreamReader for SendQueue` impl below.
        let result = pipe.read_start_ctx::<SendQueue>(queue.as_ptr());
        let (this, write) = (queue.this_ptr().into(), None);
        (queue.link).set(Link::open(owner, Transport { this, pipe, write }));
        let result = (result.to_result(bun_sys::Tag::listen))
            .inspect_err(|_| queue.close_socket(CloseCode::Failure));
        (queue, result)
    }

    #[cfg(windows)]
    pub(crate) fn open_inherited(mode: Mode, pipe_fd: Fd) -> bun_sys::Result<RefPtr<SendQueue>> {
        let mut pipe = uv::Owned::<uv::Pipe>::zeroed();
        (pipe.init(uv::Loop::get(), true)).to_result(bun_sys::Tag::pipe)?;
        pipe.open(pipe_fd.uv()).to_result(bun_sys::Tag::open)?;
        let (queue, result) = Self::open(mode, SendQueueOwner::Instance, pipe);
        result.inspect_err(|_| queue.detach())?;
        Ok(queue)
    }

    pub(crate) fn detach(&self) {
        #[cfg(windows)]
        self.with_transport(|it| it.pipe.read_stop());
        if let Some(transport) = self.link.with_mut(Link::detach) {
            #[cfg(not(windows))]
            transport.socket.close(CloseCode::Failure);
            self.release(transport);
        }
    }

    pub(crate) fn is_connected(&self) -> bool {
        self.link.get().is_open()
    }

    pub(crate) fn is_close_reported(&self) -> bool {
        self.link.get().is_over()
    }

    pub(crate) fn disconnect(&self) {
        let unacked = self.outbox.get().unacked();
        self.advance(unacked.map_or(Event::Disconnect, Event::DisconnectBeforeAck));
    }

    pub(crate) fn close_after_exit(&self) {
        self.advance(Event::PeerExited);
    }

    fn advance(&self, event: Event) {
        if let Some(this) = (self.link).with_mut(|link| Some(link.advance(event)?.this)) {
            Self::queue_task(this);
        }
    }

    fn queue_task(this: This) {
        let this = RefPtr::from_this(this.this_ptr());
        (VirtualMachine::get().event_loop()).enqueue_task(Task::from_ref::<Self>(this));
    }

    fn hold_owner(&self) -> Option<Held> {
        let owner = self.link.get().owner()?;
        Some(Held {
            owner,
            global: owner.global(),
            _alive: jsc::EnsureStillAlive(owner.to_js()),
        })
    }

    fn with_transport<R>(&self, f: impl FnOnce(&mut Transport) -> R) -> Option<R> {
        (self.link).with_mut(|link| link.live().map(|(_, transport)| f(transport)))
    }

    fn close_socket(&self, code: CloseCode) {
        #[cfg(windows)]
        {
            let _ = code;
            self.with_transport(|it| it.pipe.read_stop());
            if self.with_transport(|it| it.write).flatten().is_some() {
                return self.advance(Event::CloseBlocked);
            }
        }
        #[cfg(not(windows))]
        if let Some(socket) = self.with_transport(|it| it.socket) {
            socket.close(code);
        }
        self.socket_closed();
    }

    pub(crate) fn socket_closed(&self) {
        if let Some(transport) = self.link.with_mut(Link::close) {
            let this = transport.this;
            self.release(transport);
            Self::queue_task(this);
        }
    }

    #[cfg(not(windows))]
    fn release(&self, _: Transport) {
        self.keep_alive.disable();
    }

    #[cfg(windows)]
    fn release(&self, Transport { pipe, write, .. }: Transport) {
        // SAFETY: libuv holds it until `windows_on_write_complete`, which frees it.
        if let Some((.., write)) = write.and_then(|it| unsafe { (*it).pending.take() }) {
            self.outbox.with_mut(|outbox| outbox.cancel_write(write));
        }
        self.keep_alive.disable();
        drop(pipe);
    }

    /// `task_tag::SendQueueDeferred` dispatch, under the task's ref.
    pub(crate) fn run_deferred(&self) {
        let Some(held) = self.hold_owner() else {
            return;
        };
        match self.link.get().due() {
            Due::Nothing => {}
            Due::Close => self.close_socket(CloseCode::Normal),
            Due::ReadAndClose => {
                #[cfg(not(windows))]
                if let Some(socket) = self.with_transport(|it| it.socket) {
                    socket.read_now();
                }
                self.close_socket(CloseCode::Normal);
            }
        }
        let Some(owner) = self.link.with_mut(Link::report) else {
            return;
        };
        if let Some(offer) = self.outbox.with_mut(Outbox::take_unacked) {
            complete(&offer, &held.global);
        }
        for handle in self.outbox.with_mut(Outbox::take_unsent) {
            handle.close_next_tick(&held.global);
        }
        match owner {
            SendQueueOwner::Subprocess(subprocess) => subprocess.handle_ipc_close(),
            SendQueueOwner::Instance => IPCInstance::handle_ipc_close(),
        }
    }

    /// `uv::open_handles` closes the channel's pipe through here at a thread
    /// teardown: close now (pending writes finish ECANCELED) and let the owner
    /// observe the disconnect, rather than waiting for writes as a user close does.
    #[cfg(windows)]
    unsafe fn stop_for_vm_teardown(this: *mut c_void) {
        // SAFETY: recorded in `open` by this live SendQueue; the pipe
        // leaves the list when it drops.
        unsafe { &*this.cast::<SendQueue>() }.socket_closed();
    }

    pub(crate) fn write_version_packet(&self) {
        if let Some(packet) = self.mode.version_packet() {
            let no_callback = |_: &mut Callbacks| Ok::<_, Infallible>(());
            let Ok(()) = (self.outbox).with_mut(|it| it.push(packet, None, no_callback));
            self.flush(WriteReason::Queued);
        }
    }

    pub(crate) fn serialize_and_send(
        &self,
        global: &JSGlobalObject,
        value: JSValue,
        audience: Audience,
        callback: JSValue,
        handle: Option<Handle>,
    ) -> SerializeAndSendResult {
        let is_backed_up = self.outbox.get().is_backed_up();
        let Ok(bytes) = (match self.mode {
            Mode::Json => serialize_json(global, value, audience),
            Mode::Advanced => serialize_advanced(global, value, audience),
        }) else {
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
        if let Some(idle) = self.outbox.get().idle() {
            self.advance(Event::Idle(idle));
            self.keep_alive.unref(bun_io::js_vm_ctx());
        } else {
            self.keep_alive.ref_(bun_io::js_vm_ctx());
        }
    }

    /// Returns whether to write on.
    fn on_write_complete(&self, owner: SendQueueOwner, wrote: Wrote<Callbacks>) -> bool {
        match wrote {
            Wrote::Sent(callbacks) => {
                let _ = callbacks.call_next_tick(&owner.global());
                true
            }
            Wrote::Continue => true,
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
        let live = (self.link).with_mut(|link| link.live().map(|(owner, it)| (owner, it.socket)));
        let Some((owner, socket)) = live else {
            return false;
        };
        let write = |write: &Write<Handle, Callbacks>| {
            let written = match write.handle() {
                None => socket.write(write.bytes()),
                Some(handle) => socket.write_fd(write.bytes(), handle.duplicate.fd().native()),
            };
            log!("wrote {}", written);
            usize::try_from(written).ok()
        };
        let wrote = self.outbox.with_mut(|it| it.write(reason, write));
        wrote.is_some_and(|wrote| self.on_write_complete(owner, wrote))
    }

    /// Returns whether to write on. `windows_on_write_complete` has the result of a write that started.
    #[cfg(windows)]
    fn write(&self, reason: WriteReason) -> bool {
        let failed = self.link.with_mut(|link| {
            let (owner, transport) = link.live()?;
            let write = self.outbox.with_mut(|it| it.begin_write(reason))?;
            Some((owner, transport.start(owner, write)?))
        });
        failed.is_some_and(|(owner, write)| {
            let wrote = self.outbox.with_mut(|it| it.end_write(write, None));
            self.on_write_complete(owner, wrote)
        })
    }

    #[cfg(windows)]
    fn windows_on_write_complete(write_req: *mut WindowsWrite, status: uv::ReturnCode) {
        // SAFETY: the box `start` gave up, which libuv hands back once.
        let Some((this, owner, write)) = unsafe { bun_core::heap::take(write_req) }.pending else {
            return; // disconnected before the write completes
        };
        let _alive = jsc::EnsureStillAlive(owner.to_js());
        let _scope = VirtualMachine::get().enter_event_loop_scope();
        this.with_transport(|it| {
            it.write = None;
            it.pipe.unref(); // write complete; unref
        });
        let is_written = status.to_error(bun_sys::Tag::write).is_none();
        let written = is_written.then_some(write.bytes().len());
        let wrote = this.outbox.with_mut(|it| it.end_write(write, written));
        if this.on_write_complete(owner, wrote) {
            this.flush(WriteReason::Writable);
        }
        if this.link.get().closes_after_write() {
            this.close_socket(CloseCode::Normal);
        }
    }

    #[cfg(windows)]
    pub(crate) fn ipc_peer_pid(&self) -> u32 {
        (self.with_transport(|it| it.pipe.ipc_remote_pid())).unwrap_or(0)
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
        let Some(held) = self.hold_owner() else {
            return;
        };
        let _scope = held.global.bun_vm().enter_event_loop_scope();
        let Err(err) = self.deliver_all(&held, data) else {
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

    /// `data` is the loop's receive buffer, which a handler that runs the event loop overwrites.
    fn deliver_all(&self, held: &Held, data: &[u8]) -> Result<(), ReadError> {
        let max_len = BunString::max_length();
        let decode = |frame: Frame<Body<'_>>| decode(frame, &held.global);
        if let Some(first) = (self.inbox).with_mut(|inbox| inbox.receive(data, max_len, decode))? {
            self.deliver(held, first?)?;
        }
        while let Some(next) = (self.inbox).with_mut(|inbox| inbox.next(max_len, decode))? {
            self.deliver(held, next?)?;
        }
        Ok(())
    }

    /// What a message's delivery throws is reported, and the next message is delivered.
    #[inline]
    fn deliver(&self, held: &Held, frame: Frame<JSValue>) -> Result<(), ReadError> {
        crate::dispatch::fold(match frame {
            Frame::Version => Ok(()),
            Frame::Message(Kind::Internal, message) => self.on_internal_message(held, message),
            Frame::Message(Kind::Data, message) => self.on_message(held, message),
            Frame::Message(Kind::DataWithBuffers, envelope) => {
                let message = jsc::cpp::IPCRestoreAdvancedBuffers(&held.global, envelope)?;
                self.on_message(held, message)
            }
        });
        Ok(())
    }

    fn on_message(&self, held: &Held, message: JSValue) -> JsResult<()> {
        let global = &*held.global;
        if message.is_object()
            && let Some(cmd) = message.fast_get(global, jsc::BuiltinName::cmd)?
            && cmd.is_string()
        {
            let cmd = BunString::from_js(cmd, global)?;
            if cmd.eq_ascii(b"NODE_HANDLE") {
                if let Some(received) = self.accept_handle(global, message)? {
                    let fd = received_fd_to_js(received.fd());
                    let emit = jsc::cpp::IPCParse(global, held.owner.to_js(), message, fd)?;
                    // The object that `parseHandle` made closes it. Before the listener, which can end the thread.
                    received.into_raw();
                    if emit.is_callable() {
                        emit.call_for_running_script(global, JSValue::UNDEFINED, &[])?;
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
        match held.owner {
            SendQueueOwner::Subprocess(it) => it.handle_ipc_message(message, JSValue::UNDEFINED),
            SendQueueOwner::Instance => {
                IPCInstance::handle_ipc_message(message, JSValue::UNDEFINED)
            }
        }
        Ok(())
    }

    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/cluster/utils.js#L33-L49
    #[inline(never)]
    fn on_internal_message(&self, held: &Held, message: JSValue) -> JsResult<()> {
        let global = &*held.global;
        let mut received = None;
        if message.is_object()
            && (message.get(global, "$hasHandle")?).is_some_and(|it| it.to_boolean())
        {
            received = self.accept_handle(global, message)?;
            if received.is_none() {
                return Ok(());
            }
        }
        match held.owner {
            SendQueueOwner::Subprocess(subprocess) => {
                drop(received);
                let context = subprocess.context;
                cluster::handle_internal_message_primary(global, &self.cluster, context, message)?;
            }
            SendQueueOwner::Instance => {
                cluster::handle_internal_message_child(global, message, || {
                    received.map_or(JSValue::UNDEFINED, |it| received_fd_to_js(it.into_raw()))
                });
            }
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
        let answer = (self.outbox)
            .with_mut(|it| it.answer(reply, Handle::export_again, |handle| handle.cluster_seq));
        match answer {
            Answer::Stray => return,
            Answer::Resent => {}
            Answer::Acked(offer) => complete(&offer, global),
            Answer::GaveUp(cluster_seq) => self.give_up_handle(global, cluster_seq),
        }
        self.flush(WriteReason::Queued);
    }

    /// The handle stays unacked to the end: what script sends from here is called back after it.
    #[cold]
    fn give_up_handle(&self, global: &JSGlobalObject, cluster_seq: Option<i32>) {
        if let Some(callback) =
            cluster_seq.and_then(|seq| self.cluster.with_mut(|it| it.take_callback(seq)))
        {
            let reply = JSValue::create_empty_object(global, 1);
            reply.put(global, b"accepted", JSValue::FALSE);
            let _ = JSValue::call_next_tick_1(callback.get(), global, reply);
        }
        let warning = BunString::static_("Handle did not reach the receiving process correctly");
        let name = BunString::static_("SentHandleNotReceivedWarning");
        if let Ok(warning) = warning.into_js(global)
            && let Ok(name) = name.into_js(global)
        {
            let _ = global.emit_warning(warning, name, JSValue::UNDEFINED, JSValue::UNDEFINED);
        }
        if let Some(offer) = self.outbox.with_mut(Outbox::take_unacked) {
            complete(&offer, global);
        }
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
