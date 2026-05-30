//! Native Pipe handle for `process.binding('pipe_wrap').Pipe`.
//!
//! Node's `net.Socket({fd})` calls `createHandle(fd)` which constructs
//! `new Pipe(SOCKET)` then `.open(fd)`. The handle exposes the StreamBase
//! readStart/readStop/onread surface that `net.Socket` uses for backpressure-
//! driven fd release (push() === false → readStop(), _read → readStart()).
//!
//! Two-step construction: ctor stores only the pipe type; `open(fd)` attaches
//! the fd. This mirrors libuv's `uv_pipe_init` + `uv_pipe_open`.
//!
//! Lifecycle: JSRef starts weak, upgrades to strong on readStart and back to
//! weak on readStop so the JS wrapper survives GC while the poll is live. The
//! struct is separately ref-counted: the JS wrapper holds one ref (released in
//! finalize), and the reader holds one while started — so reader callbacks
//! never fire on freed memory even if GC finalizes mid-read.
//!
//! Ported from: src/bun.js/node/Pipe.zig (pre-Rust-migration).

use core::cell::Cell;
use core::ffi::c_void;

use bun_io::pipe_reader::BufferedReaderParent;
#[cfg(unix)]
use bun_io::pipe_reader::PosixFlags;
use bun_io::{BufferedReader, ReadState};
use bun_jsc::{
    self as jsc, CallFrame, EventLoopHandle, JSGlobalObject, JSValue, JsCell, JsRef, JsResult,
};
use bun_sys::{self as sys, Fd, UV_E};

bun_output::declare_scope!(PipeHandle, hidden);

// Generated bindings — `jsc.Codegen.JSPipe`. The `.classes.ts` codegen emits
// `crate::generated_classes::js_Pipe` with `from_js`/`to_js` and the cached-value
// accessors; re-export here so callers spell `js::*` (matching Zig's `js.gc`).
pub use self::js::{from_js, from_js_direct, to_js};
pub mod js {
    pub use crate::generated_classes::js_Pipe::{
        from_js, from_js_direct, get_constructor, onread_get_cached, onread_set_cached, to_js,
    };

    /// Zig: `js.gc` — typed accessor for the single `onread` `values:` slot.
    pub mod gc {
        use bun_jsc::{JSGlobalObject, JSValue};

        #[inline]
        pub fn get_onread(this_value: JSValue) -> Option<JSValue> {
            super::onread_get_cached(this_value)
        }

        #[inline]
        pub fn set_onread(this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
            super::onread_set_cached(this_value, global, value);
        }
    }
}

pub type IOReader = BufferedReader;

const UV_EOF: i32 = -4095;

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    pub struct Flags: u8 {
        const READING = 1 << 0;
        const CLOSED = 1 << 1;
        /// reader.start() succeeded (and the reader holds a ref on this struct)
        const READER_STARTED = 1 << 2;
        /// user called handle.unref(); readStart must not re-ref
        const UNREFFED = 1 << 3;
    }
}

/// `.classes.ts`-backed payload (`m_ctx`) for `JSPipe`. `fromJS`/`toJS` come
/// from the codegen (`rustPath: crate::node::pipe::Pipe` in `node.classes.ts`,
/// needed to disambiguate from the unrelated `webcore::Pipe` streaming struct).
///
/// `no_construct, no_finalize`: `constructNeedsThis: true` (3-arg constructor)
/// + intrusive refcounting (finalize → deref, not heap::take), neither of which
/// the macro's default hooks support — C-ABI shims are `constructor`/`finalize`
/// below. R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`;
/// per-field interior mutability via `Cell` (Copy) / `JsCell` (non-Copy).
#[bun_jsc::JsClass(no_construct, no_finalize)]
#[derive(bun_ptr::RefCounted)]
#[ref_count(destroy = deinit_and_destroy)]
pub struct Pipe {
    ref_count: bun_ptr::RefCount<Pipe>,

    /// 0=SOCKET, 1=SERVER, 2=IPC. Read-only after construction.
    _pipe_type: u8,

    /// `Fd::INVALID` until open() is called.
    fd: Cell<Fd>,
    fd_int: Cell<i32>,

    reader: JsCell<IOReader>,

    /// - weak: allows GC when idle
    /// - strong: prevents GC while the poll is live
    this_value: JsCell<JsRef>,

    event_loop_handle: EventLoopHandle,

    // Heap-allocated `m_ctx` payload recovered from C++ by raw pointer, so a
    // borrowed `&JSGlobalObject` lifetime cannot be threaded through; store a
    // BackRef and deref via `self.global()`.
    global_this: bun_ptr::BackRef<JSGlobalObject>,

    bytes_read: Cell<u64>,

    flags: Cell<Flags>,
}

impl Pipe {
    #[inline]
    fn as_ctx_ptr(&self) -> *mut Self {
        core::ptr::from_ref::<Self>(self).cast_mut()
    }

    /// Recover `&Pipe` from the parent back-pointer stashed via `reader.set_parent`.
    #[inline]
    fn from_parent_ptr<'a>(this: *mut Self) -> &'a Self {
        // SAFETY: `this` is the BACKREF set via `reader.set_parent` in
        // `constructor`. The Pipe is heap-stable (`heap::into_raw`) and outlives
        // every reader callback (the intrusive +1 ref held while reader_started
        // is dropped only after the terminal callback fires). R-2: shared borrow
        // only — bodies take `&self`; field writes route through `Cell`/`JsCell`.
        unsafe { &*this }
    }

    #[inline]
    fn global(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut flags = self.flags.get();
        f(&mut flags);
        self.flags.set(flags);
    }

    pub(crate) fn ref_(&self) {
        // SAFETY: `self` is a heap allocation; the intrusive refcount mixin only
        // reads/writes `ref_count` via Cell, so the `&T → *mut` cast is sound.
        unsafe { bun_ptr::RefCount::<Pipe>::ref_(self.as_ctx_ptr()) };
    }

    pub(crate) fn deref_(&self) {
        // SAFETY: as above; `deref` runs `destructor()` (→ deinit_and_destroy)
        // iff the count hits zero. Callers treat `self` as possibly-freed after
        // return (always tail-position here).
        unsafe { bun_ptr::RefCount::<Pipe>::deref(self.as_ctx_ptr()) };
    }

    /// `downgrade()` asserts on `.finalized`; reader callbacks may run after
    /// finalize (struct stays alive via ref_count), so check strong first.
    fn safe_downgrade(&self) {
        self.this_value.with_mut(|v| {
            if v.is_strong() {
                v.downgrade();
            }
        });
    }

    /// Constructor — called from JS with `constructNeedsThis: true`, so the
    /// wrapper JSValue arrives directly. Thunk: `PipeClass__construct`.
    pub(crate) fn constructor(
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<*mut Pipe> {
        let args = callframe.arguments_as_array::<1>();
        let type_int: u8 = if args[0].is_number() {
            args[0].to_int32().clamp(0, 2) as u8
        } else {
            0
        };

        // `bun.new(Pipe, .{...})` → heap::alloc; ref_count starts at 1 (the JS
        // wrapper's ref, released in finalize()).
        let pipe: *mut Pipe = bun_core::heap::into_raw(Box::new(Pipe {
            ref_count: bun_ptr::RefCount::init(),
            _pipe_type: type_int,
            fd: Cell::new(Fd::INVALID),
            fd_int: Cell::new(-1),
            reader: JsCell::new(IOReader::init::<Pipe>()),
            this_value: JsCell::new(JsRef::init_weak(this_value)),
            event_loop_handle: EventLoopHandle::init(
                global_object.bun_vm().as_mut().event_loop().cast(),
            ),
            global_this: bun_ptr::BackRef::new(global_object),
            bytes_read: Cell::new(0),
            flags: Cell::new(Flags::empty()),
        }));
        // SAFETY: just allocated, non-null, exclusively owned here. R-2: `&`
        // (not `&mut`) — every method takes `&self`; writes go through cells.
        let pipe = unsafe { &*pipe };
        pipe.reader
            .with_mut(|r| r.set_parent(pipe.as_ctx_ptr().cast::<c_void>()));

        Ok(pipe.as_ctx_ptr())
    }

    pub(crate) fn open(&self, _g: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_as_array::<1>();
        if !args[0].is_number() {
            return Ok(JSValue::js_number_from_int32(-UV_E::INVAL));
        }
        let fd_int = args[0].to_int32();
        if fd_int < 0 {
            return Ok(JSValue::js_number_from_int32(-UV_E::BADF));
        }

        let fd = Fd::from_uv(fd_int);

        #[cfg(unix)]
        {
            // Set O_NONBLOCK like uv_pipe_open. Failure → return -errno.
            let cur: sys::FcntlInt = match sys::fcntl(fd, libc::F_GETFL, 0) {
                sys::Result::Ok(f) => f,
                sys::Result::Err(err) => {
                    return Ok(JSValue::js_number_from_int32(to_uv_errno(&err)));
                }
            };
            if let sys::Result::Err(err) =
                sys::fcntl(fd, libc::F_SETFL, cur | sys::O::NONBLOCK as sys::FcntlInt)
            {
                return Ok(JSValue::js_number_from_int32(to_uv_errno(&err)));
            }
            self.reader.with_mut(|r| {
                r.flags
                    .insert(PosixFlags::NONBLOCKING | PosixFlags::POLLABLE);
                // We never own the fd (caller-provided via open()).
                r.flags.remove(PosixFlags::CLOSE_HANDLE);
            });
        }
        #[cfg(windows)]
        {
            // Source open is deferred to the first readStart().
            self.reader.with_mut(|r| {
                r.flags
                    .remove(bun_io::pipe_reader::WindowsFlags::CLOSE_HANDLE)
            });
        }

        self.fd.set(fd);
        self.fd_int.set(fd_int);
        Ok(JSValue::js_number_from_int32(0))
    }

    pub(crate) fn read_start(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        bun_output::scoped_log!(PipeHandle, "readStart");
        if self.flags.get().contains(Flags::CLOSED) {
            return Ok(JSValue::js_number_from_int32(0));
        }
        if self.fd.get() == Fd::INVALID {
            return Ok(JSValue::js_number_from_int32(-UV_E::BADF));
        }

        self.update_flags(|f| f.insert(Flags::READING));
        let global = self.global();
        self.this_value.with_mut(|v| v.upgrade(global));

        if !self.flags.get().contains(Flags::READER_STARTED) {
            let fd = self.fd.get();
            match self.reader.with_mut(|r| r.start(fd, true)) {
                sys::Result::Ok(()) => {
                    self.update_flags(|f| f.insert(Flags::READER_STARTED));
                    // Reader now holds a ref on this struct until its terminal
                    // callback (on_reader_done/on_reader_error) fires.
                    self.ref_();
                    #[cfg(unix)]
                    self.reader.with_mut(|r| {
                        if let Some(poll) = r.handle.get_poll() {
                            poll.set_flag(bun_io::FilePollFlag::Nonblocking);
                        }
                    });
                    // reader.start() calls update_ref(true) internally; honor a
                    // prior unref().
                    if self.flags.get().contains(Flags::UNREFFED) {
                        self.reader.with_mut(|r| r.update_ref(false));
                    }
                    // start() only registers the poll; drain data already
                    // waiting in the pipe now. Without this the first chunk is
                    // only delivered on the next poll wakeup (~1s latency with a
                    // level vs edge mismatch), stalling readers that expect the
                    // data promptly. read() can re-enter via on_read_chunk /
                    // on_reader_done, so it must run outside a with_mut borrow
                    // (accessor idiom — see the restart branch below).
                    // SAFETY: single JS thread; no other &mut IOReader is held
                    // live across this call (the `&mut` is released at the end
                    // of this statement, so a re-entrant callback reborrows).
                    unsafe { &mut *self.reader.as_ptr() }.read();
                }
                sys::Result::Err(err) => {
                    // Roll back the READING flag + strong JSRef taken above, so
                    // a caller that starts reading, gets an error, and neither
                    // readStop()s nor close()s doesn't leave the wrapper
                    // permanently GC-rooted. (The in-tree caller destroy()s on a
                    // nonzero return, which also cleans up via close_internal.)
                    self.update_flags(|f| f.remove(Flags::READING));
                    self.safe_downgrade();
                    return Ok(JSValue::js_number_from_int32(to_uv_errno(&err)));
                }
            }
        } else {
            // unpause() clears the paused flag; watch() re-arms the poll.
            // update_ref re-activates the loop keepalive that pause()'s
            // unregister dropped (unless the user explicitly unref'd).
            self.reader.with_mut(|r| r.unpause());
            let should_read = self
                .reader
                .with_mut(|r| !r.is_done() && !r.has_pending_read());
            if should_read {
                // read() drains data already sitting in the kernel buffer
                // (arrived while paused) AND re-registers the poll for future
                // readability. A bare watch() would only wait for a *new* epoll
                // event, which never comes if the readable edge already fired
                // before resume() — stdin pause()/resume() then silently drops
                // the buffered data.
                //
                // read() can synchronously drive on_read_chunk / on_reader_done
                // (which themselves touch self.reader), so it must NOT run
                // inside a with_mut borrow. Use the accessor idiom (FileReader
                // pattern): the `&mut` roots at the UnsafeCell and is released
                // at the end of this statement, so a re-entrant callback forms
                // its own independent borrow. SAFETY: single JS thread; no
                // other &mut IOReader is held live across this call.
                unsafe { &mut *self.reader.as_ptr() }.read();
            }
            if !self.flags.get().contains(Flags::UNREFFED) {
                self.reader.with_mut(|r| r.update_ref(true));
            }
        }

        Ok(JSValue::js_number_from_int32(0))
    }

    pub(crate) fn read_stop(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        bun_output::scoped_log!(PipeHandle, "readStop");
        self.update_flags(|f| f.remove(Flags::READING));
        if self.flags.get().contains(Flags::READER_STARTED) {
            self.reader.with_mut(|r| {
                // Drop the loop keepalive first: pause()/unregister deactivates
                // the poll, but readStart re-arms via update_ref(true), and the
                // active-count bookkeeping must be released symmetrically or the
                // process stays alive after the last pause() (stdin never exits
                // while a writer holds the pipe open).
                r.update_ref(false);
                r.pause();
            });
        }
        self.this_value.with_mut(|v| v.downgrade());
        Ok(JSValue::js_number_from_int32(0))
    }

    pub(crate) fn do_ref(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        self.update_flags(|f| f.remove(Flags::UNREFFED));
        self.reader.with_mut(|r| r.update_ref(true));
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn do_unref(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        self.update_flags(|f| f.insert(Flags::UNREFFED));
        self.reader.with_mut(|r| r.update_ref(false));
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn close(&self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        self.close_internal();
        // Node's HandleWrap.close(cb) invokes the callback after uv_close
        // completes (next loop iteration). close_internal() closes
        // synchronously, so schedule the callback on a microtask — the closest
        // analogue — instead of silently dropping it.
        let cb = f.argument(0);
        if cb.is_callable() {
            g.queue_microtask(cb, &[]);
        }
        Ok(JSValue::UNDEFINED)
    }

    fn close_internal(&self) {
        if self.flags.get().contains(Flags::CLOSED) {
            return;
        }
        self.update_flags(|f| f.insert(Flags::CLOSED));
        self.update_flags(|f| f.remove(Flags::READING));

        if self.flags.get().contains(Flags::READER_STARTED) {
            self.reader.with_mut(|r| r.close());
        }
        // We never own the fd (caller-provided via open()).
        self.safe_downgrade();
    }

    /// writeBuffer/writeUtf8String/shutdown/bind/listen/connect/fchmod are not
    /// reachable for `process.stdin` (constructed with `writable: false`). Full
    /// duplex `net.Socket({fd})` is a follow-up.
    pub(crate) fn notsup(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::js_number_from_int32(-UV_E::NOTSUP))
    }

    pub(crate) fn get_on_read(
        &self,
        this_value: JSValue,
        _g: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        Ok(js::gc::get_onread(this_value).unwrap_or(JSValue::UNDEFINED))
    }

    pub(crate) fn set_on_read(
        &self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<()> {
        js::gc::set_onread(this_value, global, value);
        Ok(())
    }

    pub(crate) fn get_bytes_read(&self, _g: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number(self.bytes_read.get() as f64))
    }

    pub(crate) fn get_bytes_written(&self, _g: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number_from_int32(0))
    }

    pub(crate) fn get_fd(&self, _g: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number_from_int32(self.fd_int.get()))
    }

    pub(crate) fn get_external_stream(&self, _g: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::NULL)
    }

    // Reader vtable callbacks ------------------------------------------------

    pub(crate) fn on_read_chunk(&self, chunk: &[u8], has_more: ReadState) -> bool {
        let _ = has_more;
        bun_output::scoped_log!(PipeHandle, "onReadChunk: {} bytes", chunk.len());
        let reading = self.flags.get().contains(Flags::READING);
        if chunk.is_empty() {
            return reading;
        }

        let Some(this_jsvalue) = self.this_value.get().try_get() else {
            return reading;
        };
        let Some(callback) = js::gc::get_onread(this_jsvalue) else {
            return reading;
        };

        let global_this = self.global();
        // create_buffer memcpy's into a fresh JS-owned Uint8Array, so the
        // borrowed reader buffer can be passed directly (no dupe).
        let buf = match jsc::ArrayBuffer::create_buffer(global_this, chunk) {
            Ok(b) => b,
            Err(_) => return reading,
        };

        self.bytes_read
            .set(self.bytes_read.get() + chunk.len() as u64);

        global_this.bun_vm().event_loop_mut().run_callback(
            callback,
            global_this,
            this_jsvalue,
            &[JSValue::js_number_from_int32(chunk.len() as i32), buf],
        );

        self.flags.get().contains(Flags::READING)
    }

    pub(crate) fn on_reader_done(&self) {
        bun_output::scoped_log!(PipeHandle, "onReaderDone");
        self.update_flags(|f| f.remove(Flags::READING));
        // close_handle=false means BufferedReader leaves the poll registered and
        // ref'd; drop both so the process can exit after EOF.
        self.reader.with_mut(|r| {
            r.pause();
            r.update_ref(false);
        });
        self.call_on_read(JSValue::js_number_from_int32(UV_EOF), JSValue::UNDEFINED);
        self.safe_downgrade();
        self.reader_terminated();
    }

    pub(crate) fn on_reader_error(&self, err: &sys::Error) {
        bun_output::scoped_log!(PipeHandle, "onReaderError: {:?}", err);
        self.update_flags(|f| f.remove(Flags::READING));
        self.reader.with_mut(|r| {
            r.pause();
            r.update_ref(false);
        });
        self.call_on_read(
            JSValue::js_number_from_int32(to_uv_errno(err)),
            JSValue::UNDEFINED,
        );
        self.safe_downgrade();
        self.reader_terminated();
    }

    /// Reader's terminal callback fired — release the ref it held. Must be the
    /// last thing the callback does: `deref_` may free `self`.
    fn reader_terminated(&self) {
        if self.flags.get().contains(Flags::READER_STARTED) {
            self.update_flags(|f| f.remove(Flags::READER_STARTED));
            self.deref_();
        }
    }

    fn call_on_read(&self, nread: JSValue, buf: JSValue) {
        let Some(this_jsvalue) = self.this_value.get().try_get() else {
            return;
        };
        let Some(callback) = js::gc::get_onread(this_jsvalue) else {
            return;
        };
        let global_this = self.global();
        global_this.bun_vm().event_loop_mut().run_callback(
            callback,
            global_this,
            this_jsvalue,
            &[nread, buf],
        );
    }

    pub(crate) fn loop_(&self) -> *mut bun_io::pipe_reader::Loop {
        #[cfg(windows)]
        {
            self.event_loop_handle.uv_loop().cast()
        }
        #[cfg(not(windows))]
        {
            self.event_loop_handle.r#loop().cast()
        }
    }

    /// Finalize — called by GC when the JS wrapper is collected. Thunk:
    /// `PipeClass__finalize`.
    pub(crate) fn finalize(self: Box<Self>) {
        bun_output::scoped_log!(PipeHandle, "finalize");
        jsc::mark_binding();
        bun_ptr::finalize_js_box(self, |this| {
            this.close_internal();
            this.this_value.with_mut(|v| v.finalize());
        });
    }
}

/// `deinit` — NOT `impl Drop`: Pipe is an intrusive-refcounted `.classes.ts`
/// m_ctx payload; destruction is driven by `deref_()` reaching zero and the
/// body frees its own allocation (`bun.destroy`). Reachable only via the
/// `#[ref_count(destroy = …)]` derive, which upholds the sole-owner contract.
fn deinit_and_destroy(this: *mut Pipe) {
    bun_output::scoped_log!(PipeHandle, "deinit");
    // SAFETY: caller is `deref_()` with ref_count == 0; `this` was heap-allocated
    // in `constructor`. `reader`'s Drop runs via `heap::take` below.
    drop(unsafe { bun_core::heap::take(this) });
}

/// Zig `toUVErrno`: POSIX returns `-errno`; the Rust `Error.errno` is the
/// positive magnitude, so negate. (On Windows the reader's errno is already
/// normalized through the same `Error` path.)
#[inline]
fn to_uv_errno(err: &sys::Error) -> i32 {
    -(err.errno as i32)
}

// `bun.io.BufferedReader.init(@This())` vtable parent. Pipe declares
// onReadChunk/onReaderDone/onReaderError/loop/eventLoop (Pipe.zig).
bun_io::buffered_reader_parent_link!(Pipe for Pipe);
impl BufferedReaderParent for Pipe {
    const KIND: bun_io::BufferedReaderParentLinkKind = bun_io::BufferedReaderParentLinkKind::Pipe;
    const HAS_ON_READ_CHUNK: bool = true;

    unsafe fn on_read_chunk(this: *mut Self, chunk: &[u8], has_more: ReadState) -> bool {
        Self::from_parent_ptr(this).on_read_chunk(chunk, has_more)
    }
    unsafe fn on_reader_done(this: *mut Self) {
        Self::from_parent_ptr(this).on_reader_done()
    }
    unsafe fn on_reader_error(this: *mut Self, err: sys::Error) {
        Self::from_parent_ptr(this).on_reader_error(&err)
    }
    unsafe fn loop_(this: *mut Self) -> *mut bun_io::pipe_reader::Loop {
        Self::from_parent_ptr(this).loop_()
    }
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        Self::from_parent_ptr(this)
            .event_loop_handle
            .as_event_loop_ctx()
    }
}
