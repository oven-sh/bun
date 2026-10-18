//! The native Pipe handle of `process.binding('pipe_wrap')`.
//!
//! node's `net.Socket({ fd })` makes one with `new Pipe(SOCKET)` and then
//! `open(fd)`. `net.Socket` drives it through the StreamBase read surface:
//! `readStart()`, `readStop()` and the `onread(nread, buffer)` callback. That
//! is the part implemented here. The write side is not.
//!
//! Lifetime: the struct is intrusively refcounted. The JS wrapper holds one
//! ref (released after `finalize`). The reader holds one from its first start
//! until its terminal callback or `close()`. `this_value` is strong only while
//! the handle reads, so an idle handle can be collected.
//!
//! The fd belongs to the caller: the handle never closes it.

use core::cell::Cell;
use core::ffi::c_void;

use bun_io::pipe_reader::BufferedReaderParent;
#[cfg(unix)]
use bun_io::pipe_reader::PosixFlags;
#[cfg(windows)]
use bun_io::pipe_reader::WindowsFlags;
use bun_io::{BufferedReader, ReadState};
use bun_jsc::{
    self as jsc, CallFrame, EventLoopHandle, JSGlobalObject, JSValue, JsCell, JsRef, JsResult,
};
use bun_sys::{self as sys, Fd, UV_E};

bun_output::declare_scope!(PipeHandle, hidden);

mod js {
    pub(super) use crate::generated_classes::js_Pipe::{onread_get_cached, onread_set_cached};
}

type IOReader = BufferedReader;

const UV_EOF: i32 = -4095;

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    struct Flags: u8 {
        /// Between `readStart()` and `readStop()`.
        const READING = 1 << 0;
        const CLOSED = 1 << 1;
        /// The reader started, and holds a ref on this struct.
        const READER_STARTED = 1 << 2;
        /// The user called `unref()`.
        const UNREFFED = 1 << 3;
        /// The reader reported EOF or an error. The reader does not latch this
        /// for an fd it does not own, and the stream layer calls `readStart()`
        /// again after the EOF push, so the handle keeps it.
        const DONE = 1 << 4;
    }
}

// `no_construct, no_finalize`: the class is `constructNeedsThis` and
// `refCounted` in `node.classes.ts`, and the codegen emits both hooks.
// Every JS-exposed method takes `&self`: `onread` can re-enter them.
#[bun_jsc::JsClass(no_construct, no_finalize)]
#[derive(bun_ptr::RefCounted)]
pub(crate) struct Pipe {
    ref_count: bun_ptr::RefCount<Pipe>,
    /// `Fd::INVALID` until `open()`.
    fd: Cell<Fd>,
    reader: JsCell<IOReader>,
    this_value: JsCell<JsRef>,
    event_loop_handle: EventLoopHandle,
    global_this: bun_ptr::BackRef<JSGlobalObject>,
    bytes_read: Cell<u64>,
    flags: Cell<Flags>,
}

impl Pipe {
    #[inline]
    fn as_ctx_ptr(&self) -> *mut Self {
        core::ptr::from_ref::<Self>(self).cast_mut()
    }

    /// `&Pipe` from the parent pointer the reader got in `constructor`.
    #[inline]
    fn from_parent_ptr<'a>(this: *mut Self) -> &'a Self {
        // SAFETY: `this` is the heap allocation from `constructor`. It outlives
        // every reader callback: the reader holds a ref until its terminal
        // callback, and the read loop holds one across each dispatch. Only a
        // shared borrow is formed. All mutation goes through `Cell`/`JsCell`.
        unsafe { &*this }
    }

    #[inline]
    fn global(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    #[inline]
    fn has(&self, flags: Flags) -> bool {
        self.flags.get().intersects(flags)
    }

    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut flags = self.flags.get();
        f(&mut flags);
        self.flags.set(flags);
    }

    fn ref_(&self) {
        // SAFETY: `self` is the live heap allocation. The count is a `Cell`.
        unsafe { bun_ptr::RefCount::<Pipe>::ref_(self.as_ctx_ptr()) };
    }

    /// May free `self`: callers do nothing with it afterwards.
    fn deref_(&self) {
        // SAFETY: as `ref_`. Drops the allocation when the count reaches zero.
        unsafe { bun_ptr::RefCount::<Pipe>::deref(self.as_ctx_ptr()) };
    }

    /// The codegen thunk `PipeClass__construct` calls this with the wrapper.
    pub(crate) fn constructor(
        global_object: &JSGlobalObject,
        _callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<*mut Pipe> {
        // The count starts at 1: the JS wrapper's ref.
        let pipe: *mut Pipe = bun_core::heap::into_raw(Box::new(Pipe {
            ref_count: bun_ptr::RefCount::init(),
            fd: Cell::new(Fd::INVALID),
            reader: JsCell::new(IOReader::init::<Pipe>()),
            this_value: JsCell::new(JsRef::init_weak(this_value)),
            event_loop_handle: EventLoopHandle::init(
                global_object.bun_vm().as_mut().event_loop().cast(),
            ),
            global_this: bun_ptr::BackRef::new(global_object),
            bytes_read: Cell::new(0),
            flags: Cell::new(Flags::empty()),
        }));
        // SAFETY: just allocated, and nothing else has the pointer yet.
        let this = unsafe { &*pipe };
        this.reader
            .with_mut(|r| r.set_parent(pipe.cast::<c_void>()));
        Ok(pipe)
    }

    /// `open(fd)`: returns 0 or a negative errno, as `uv_pipe_open` does.
    pub(crate) fn open(&self, _g: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let [arg] = callframe.arguments_as_array::<1>();
        if !arg.is_number() {
            return Ok(JSValue::js_number_from_int32(-UV_E::INVAL));
        }
        let fd_int = arg.to_int32();
        if fd_int < 0 {
            return Ok(JSValue::js_number_from_int32(-UV_E::BADF));
        }
        let fd = Fd::from_uv(fd_int);
        if let Err(err) = sys::set_nonblocking(fd) {
            return Ok(JSValue::js_number_from_int32(to_uv_errno(&err)));
        }
        self.reader.with_mut(|r| {
            #[cfg(unix)]
            {
                r.flags
                    .insert(PosixFlags::NONBLOCKING | PosixFlags::POLLABLE);
                r.flags.remove(PosixFlags::CLOSE_HANDLE);
            }
            #[cfg(windows)]
            r.flags.remove(WindowsFlags::CLOSE_HANDLE);
        });
        self.fd.set(fd);
        Ok(JSValue::js_number_from_int32(0))
    }

    pub(crate) fn read_start(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        bun_output::scoped_log!(PipeHandle, "readStart");
        if self.has(Flags::CLOSED | Flags::DONE) {
            return Ok(JSValue::js_number_from_int32(0));
        }
        let fd = self.fd.get();
        if fd == Fd::INVALID {
            return Ok(JSValue::js_number_from_int32(-UV_E::BADF));
        }
        self.update_flags(|f| f.insert(Flags::READING));
        let global = self.global();
        self.this_value.with_mut(|v| v.upgrade(global));

        // Nothing is delivered inside this call: the poll reports what the
        // pipe holds on the next loop turn. node never runs `onread` from
        // `readStart()`, and the stream layer counts on it: an EOF pushed
        // from inside `_read()` does not emit the last 'readable'.
        if self.has(Flags::READER_STARTED) {
            self.reader.with_mut(|r| {
                r.unpause();
                r.watch();
            });
            return Ok(JSValue::js_number_from_int32(0));
        }

        // The reader's ref. It is taken before `start()`: when the poll
        // registration fails, POSIX `start()` reports that through
        // `on_reader_error` (which releases the ref) and still returns Ok.
        self.update_flags(|f| f.insert(Flags::READER_STARTED));
        self.ref_();
        if let Err(err) = self.reader.with_mut(|r| r.start(fd, true)) {
            // No callback ran. The wrapper's ref keeps `self` alive.
            self.update_flags(|f| f.remove(Flags::READER_STARTED | Flags::READING));
            self.this_value.with_mut(|v| v.downgrade());
            self.deref_();
            return Ok(JSValue::js_number_from_int32(to_uv_errno(&err)));
        }
        if self.has(Flags::CLOSED | Flags::DONE) {
            return Ok(JSValue::js_number_from_int32(0));
        }
        self.reader.with_mut(|r| {
            #[cfg(unix)]
            if let Some(poll) = r.handle.get_poll() {
                poll.set_flag(bun_io::FilePollFlag::Nonblocking);
            }
            // An `unref()` from before the start. On Windows there was no
            // handle to apply it to until now.
            if self.has(Flags::UNREFFED) {
                r.update_ref(false);
            }
        });
        Ok(JSValue::js_number_from_int32(0))
    }

    pub(crate) fn read_stop(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        bun_output::scoped_log!(PipeHandle, "readStop");
        self.update_flags(|f| f.remove(Flags::READING));
        if self.has(Flags::READER_STARTED) {
            // A paused reader has no armed poll, so it does not hold the loop.
            self.reader.with_mut(|r| r.pause());
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

    /// `close(callback)`. node runs the callback when `uv_close` completes, one
    /// loop turn later. Here the close is synchronous, so the callback is a
    /// microtask.
    pub(crate) fn close(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.close_internal();
        let callback = frame.argument(0);
        if callback.is_callable() {
            global.queue_microtask(callback, &[]);
        }
        Ok(JSValue::UNDEFINED)
    }

    fn close_internal(&self) {
        if self.has(Flags::CLOSED) {
            return;
        }
        self.update_flags(|f| {
            f.insert(Flags::CLOSED);
            f.remove(Flags::READING);
        });
        self.this_value.with_mut(|v| v.downgrade());
        self.release_reader();
    }

    /// Stops the reader for good and drops its ref. The fd stays open.
    /// May free `self`: callers do nothing with it afterwards.
    fn release_reader(&self) {
        self.reader.with_mut(|r| {
            // `reader.close()` would not do: without `CLOSE_HANDLE` it leaves
            // the poll armed, and the armed poll holds the loop and points at
            // this struct.
            #[cfg(unix)]
            r.handle.close_without_closing_fd();
            // The uv handle closes when the reader drops.
            #[cfg(windows)]
            {
                r.update_ref(false);
                r.pause();
            }
        });
        if self.has(Flags::READER_STARTED) {
            self.update_flags(|f| f.remove(Flags::READER_STARTED));
            self.deref_();
        }
    }

    /// The write side and the server side are not implemented.
    pub(crate) fn notsup(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::js_number_from_int32(-UV_E::NOTSUP))
    }

    pub(crate) fn get_on_read(
        &self,
        this_value: JSValue,
        _g: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        Ok(js::onread_get_cached(this_value).unwrap_or(JSValue::UNDEFINED))
    }

    pub(crate) fn set_on_read(
        &self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<()> {
        js::onread_set_cached(this_value, global, value);
        Ok(())
    }

    pub(crate) fn get_bytes_read(&self, _g: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number(self.bytes_read.get() as f64))
    }

    pub(crate) fn get_bytes_written(&self, _g: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number_from_int32(0))
    }

    pub(crate) fn get_fd(&self, _g: &JSGlobalObject) -> JsResult<JSValue> {
        let fd = self.fd.get();
        Ok(JSValue::js_number_from_int32(if fd == Fd::INVALID {
            -1
        } else {
            fd.uv()
        }))
    }

    pub(crate) fn get_external_stream(&self, _g: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::NULL)
    }

    /// Calls `onread(nread, buffer)` with the wrapper as `this`.
    fn call_on_read(&self, nread: i32, buffer: JSValue) {
        let Some(this_value) = self.this_value.get().try_get() else {
            return;
        };
        let Some(callback) = js::onread_get_cached(this_value) else {
            return;
        };
        let global = self.global();
        global.bun_vm().event_loop_mut().run_callback(
            bun_event_loop::ContextId::NONE,
            callback,
            global,
            this_value,
            &[JSValue::js_number_from_int32(nread), buffer],
        );
    }

    /// Returns whether the read loop goes on. `false` ends only the current
    /// loop: `readStop()` is what pauses the reader.
    fn on_read_chunk(&self, chunk: &[u8], _state: ReadState) -> bool {
        bun_output::scoped_log!(PipeHandle, "onReadChunk: {} bytes", chunk.len());
        if !chunk.is_empty() && !self.has(Flags::CLOSED) {
            // The bytes are out of the pipe already, so they are delivered
            // even when `readStop()` ran in the meantime.
            match jsc::ArrayBuffer::create_buffer(self.global(), chunk) {
                Ok(buffer) => {
                    self.bytes_read
                        .set(self.bytes_read.get() + chunk.len() as u64);
                    self.call_on_read(chunk.len() as i32, buffer);
                }
                Err(err) => crate::dispatch::fold(Err(err)),
            }
        }
        self.has(Flags::READING)
    }

    /// The reader's terminal callback. `nread` is `UV_EOF` or a negative errno.
    fn on_reader_end(&self, nread: i32) {
        // After `close()` there is nothing to report and nothing to release.
        if self.has(Flags::CLOSED | Flags::DONE) {
            return;
        }
        // DONE comes before the callback: the EOF push makes the stream layer
        // call `readStart()` again.
        self.update_flags(|f| {
            f.insert(Flags::DONE);
            f.remove(Flags::READING);
        });
        self.call_on_read(nread, JSValue::UNDEFINED);
        self.this_value.with_mut(|v| v.downgrade());
        self.release_reader();
    }

    fn loop_(&self) -> *mut bun_io::pipe_reader::Loop {
        #[cfg(windows)]
        {
            self.event_loop_handle.uv_loop().cast()
        }
        #[cfg(not(windows))]
        {
            self.event_loop_handle.r#loop().cast()
        }
    }

    /// The wrapper was collected. The codegen drops the wrapper's ref next.
    pub(crate) fn finalize(&self) {
        bun_output::scoped_log!(PipeHandle, "finalize");
        self.this_value.with_mut(|v| v.finalize());
        self.close_internal();
    }
}

/// `err` as the negative errno that the handle's methods and `onread` report.
#[inline]
fn to_uv_errno(err: &sys::Error) -> i32 {
    -(err.errno as i32)
}

bun_io::buffered_reader_parent_link!(Pipe for Pipe);
impl BufferedReaderParent for Pipe {
    const KIND: bun_io::BufferedReaderParentLinkKind = bun_io::BufferedReaderParentLinkKind::Pipe;
    const HAS_ON_READ_CHUNK: bool = true;

    unsafe fn on_read_chunk(
        this: *mut Self,
        chunk: bun_io::Chunk<'_>,
        has_more: ReadState,
    ) -> bool {
        Self::from_parent_ptr(this).on_read_chunk(&chunk, has_more)
    }
    unsafe fn on_reader_done(this: *mut Self) {
        bun_output::scoped_log!(PipeHandle, "onReaderDone");
        Self::from_parent_ptr(this).on_reader_end(UV_EOF);
    }
    unsafe fn on_reader_error(this: *mut Self, err: sys::Error) {
        bun_output::scoped_log!(PipeHandle, "onReaderError: {:?}", err);
        Self::from_parent_ptr(this).on_reader_end(to_uv_errno(&err));
    }
    unsafe fn loop_(this: *mut Self) -> *mut bun_io::pipe_reader::Loop {
        Self::from_parent_ptr(this).loop_()
    }
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        Self::from_parent_ptr(this)
            .event_loop_handle
            .as_event_loop_ctx()
    }
    // The read loop holds the struct across each dispatch: `onread` can
    // `close()` the handle and drop its last JS reference.
    unsafe fn ref_(this: *mut Self) {
        // SAFETY: `this` is the live parent pointer. No `&Pipe` is formed.
        unsafe { bun_ptr::RefCount::<Pipe>::ref_(this) };
    }
    unsafe fn deref(this: *mut Self) {
        // SAFETY: as `ref_`. May free `this`.
        unsafe { bun_ptr::RefCount::<Pipe>::deref(this) };
    }
}
