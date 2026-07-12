//! `Bun.file().lock()` / `FileLock` — advisory file locking.
//!
//! POSIX uses `flock(2)` (BSD whole-file advisory lock); Windows uses
//! `LockFileEx` over the full 64-bit range. Lock acquisition runs on the
//! WorkPool so the JS thread stays responsive; the wait is an `flock(LOCK_NB)`
//! poll with a futex-backed sleep so an `AbortSignal` can break it early.

use core::cell::Cell;
use core::ffi::c_void;
use core::sync::atomic::{AtomicU32, Ordering};

use crate::node::types::{PathLikeExt as _, StringOrBuffer};
use crate::webcore::node_types::PathLike;
use bun_jsc::concurrent_promise_task::{ConcurrentPromiseTask, ConcurrentPromiseTaskContext};
use bun_jsc::{
    self as jsc, AbortSignal, CallFrame, JSGlobalObject, JSPromise, JSValue, JsClass as _,
    JsResult, StringJsc as _, SysErrorJsc as _,
};
use bun_paths::PathBuffer;
use bun_sys::{self, Fd, FdExt as _, File, O};
use bun_threading::Futex;

// ───────────────────────────── FileLock (JS class) ──────────────────────────

/// Returned from `Bun.file().lock()`. Owns (or borrows) the locked fd and
/// exposes I/O on it while held. `unlock()` / `close()` / `[Symbol.asyncDispose]`
/// release the lock and, if we opened it, close the fd.
#[bun_jsc::JsClass(no_constructor)]
pub struct FileLock {
    fd: Cell<Fd>,
    owns_fd: bool,
    unlocked: Cell<bool>,
}

impl FileLock {
    fn release(&self) -> Result<(), bun_sys::Error> {
        if self.unlocked.replace(true) {
            return Ok(());
        }
        let fd = self.fd.replace(Fd::INVALID);
        let result = bun_sys::funlock(fd);
        if self.owns_fd {
            fd.close();
        }
        result
    }

    fn live_fd(&self, global: &JSGlobalObject, op: &str) -> JsResult<Fd> {
        if self.unlocked.get() {
            return Err(global.throw_invalid_arguments(format_args!(
                "FileLock is already released; cannot {op}()"
            )));
        }
        Ok(self.fd.get())
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_unlock(&self, global: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        match self.release() {
            Ok(()) => Ok(JSPromise::resolved_promise_value(
                global,
                JSValue::UNDEFINED,
            )),
            Err(err) => Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global,
                    err.to_js(global),
                ),
            ),
        }
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_bytes(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let fd = self.live_fd(global, "bytes")?;
        let len = optional_byte_count(global, frame)?;
        Ok(schedule_io(
            global,
            IoOp::Read {
                fd,
                len,
                kind: ReadKind::Uint8Array,
            },
        ))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_text(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let fd = self.live_fd(global, "text")?;
        let len = optional_byte_count(global, frame)?;
        Ok(schedule_io(
            global,
            IoOp::Read {
                fd,
                len,
                kind: ReadKind::Text,
            },
        ))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_array_buffer(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let fd = self.live_fd(global, "arrayBuffer")?;
        let len = optional_byte_count(global, frame)?;
        Ok(schedule_io(
            global,
            IoOp::Read {
                fd,
                len,
                kind: ReadKind::ArrayBuffer,
            },
        ))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_write(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let fd = self.live_fd(global, "write")?;
        let Some(arg) = frame.arguments().first().copied() else {
            return Err(global.throw_invalid_arguments(format_args!(
                "FileLock.write(data) requires a string, ArrayBuffer, or ArrayBufferView"
            )));
        };
        let Some(data) = StringOrBuffer::from_js(global, arg)? else {
            return Err(global.throw_invalid_argument_type("write", "data", "string or buffer"));
        };
        let data = data.into_thread_safe();
        Ok(schedule_io(global, IoOp::Write { fd, data }))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_truncate(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let fd = self.live_fd(global, "truncate")?;
        let len = match frame.arguments().first().copied() {
            Some(v) if !v.is_undefined_or_null() => {
                let n = v.coerce_to_int64(global)?;
                if n < 0 {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "truncate length must be >= 0, received {n}"
                    )));
                }
                n
            }
            _ => 0,
        };
        Ok(schedule_io(global, IoOp::Truncate { fd, len }))
    }
}

impl Drop for FileLock {
    fn drop(&mut self) {
        // Closing the fd releases the OS lock; no separate funlock needed.
        if !self.unlocked.get() && self.owns_fd {
            let fd = self.fd.get();
            if fd != Fd::INVALID {
                fd.close();
            }
        }
    }
}

fn optional_byte_count(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<Option<usize>> {
    match frame.arguments().first().copied() {
        Some(v) if !v.is_undefined_or_null() => {
            let n = v.coerce_to_int64(global)?;
            if n < 0 {
                return Err(global.throw_invalid_arguments(format_args!(
                    "byte count must be >= 0, received {n}"
                )));
            }
            Ok(Some(n as usize))
        }
        _ => Ok(None),
    }
}

// ───────────────────────────── Lock acquisition task ────────────────────────

pub type FileLockTask<'a> = ConcurrentPromiseTask<'a, LockTaskCtx<'a>>;

pub struct LockTaskCtx<'a> {
    global_this: &'a JSGlobalObject,
    source: LockSource,
    exclusive: bool,
    nonblocking: bool,
    /// Set to 1 by the abort listener (JS thread); polled by `run()`.
    aborted: AtomicU32,
    /// +1 ref held via `AbortSignal::ref_()`; released in `then()`.
    signal: Option<*mut AbortSignal>,
    result: Option<Result<LockedFd, bun_sys::Error>>,
}

pub(crate) enum LockSource {
    Fd(Fd),
    Path(PathLike),
}

struct LockedFd {
    fd: Fd,
    owns_fd: bool,
}

extern "C" fn lock_abort_cb(ctx: *mut c_void, _reason: JSValue) {
    // SAFETY: `ctx` is the `LockTaskCtx` inside the heap `FileLockTask`; the
    // listener is detached before the task is destroyed.
    let ctx = unsafe { &*(ctx.cast::<LockTaskCtx<'_>>()) };
    ctx.aborted.store(1, Ordering::SeqCst);
    Futex::wake(&ctx.aborted, 1);
}

impl ConcurrentPromiseTaskContext for LockTaskCtx<'_> {
    const TASK_TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FileLockTask;

    fn run(&mut self) {
        let (fd, owns_fd) = match &self.source {
            LockSource::Fd(fd) => (*fd, false),
            LockSource::Path(path_like) => {
                let mut buf = PathBuffer::uninit();
                let path = path_like.slice_z(&mut buf);
                match bun_sys::open(path, O::RDWR | O::CREAT | O::CLOEXEC, 0o666) {
                    Ok(fd) => (fd, true),
                    Err(err) => {
                        self.result = Some(Err(err));
                        return;
                    }
                }
            }
        };
        if self.nonblocking {
            self.result =
                Some(bun_sys::flock(fd, self.exclusive, true).map(|()| LockedFd { fd, owns_fd }));
        } else {
            // Abortable wait: poll LOCK_NB, sleeping on the `aborted` futex
            // between attempts so an abort wakes us immediately.
            loop {
                if self.aborted.load(Ordering::SeqCst) != 0 {
                    break;
                }
                match bun_sys::flock(fd, self.exclusive, true) {
                    Ok(()) => {
                        self.result = Some(Ok(LockedFd { fd, owns_fd }));
                        return;
                    }
                    // POSIX flock → EWOULDBLOCK (== EAGAIN); Win32
                    // ERROR_LOCK_VIOLATION → EBUSY.
                    Err(e) if e.is_retry() || e.get_errno() == bun_sys::E::EBUSY => {
                        let _ = Futex::wait(&self.aborted, 0, Some(10_000_000));
                    }
                    Err(e) => {
                        self.result = Some(Err(e));
                        break;
                    }
                }
            }
        }
        if self.result.as_ref().is_none_or(|r| r.is_err()) && owns_fd {
            fd.close();
        }
    }

    fn then(&mut self, promise: &mut JSPromise) -> Result<(), jsc::JsTerminated> {
        let global = self.global_this;
        if let Some(signal) = self.signal.take() {
            // SAFETY: `signal` holds a +1 ref taken in `schedule_lock`.
            unsafe { (*signal).detach(core::ptr::from_mut(self).cast::<c_void>()) };
        }
        if self.aborted.load(Ordering::SeqCst) != 0 {
            if let Some(Ok(locked)) = self.result.take() {
                let _ = bun_sys::funlock(locked.fd);
                if locked.owns_fd {
                    locked.fd.close();
                }
            }
            let err = global.create_dom_exception_instance(
                jsc::DOMExceptionCode::AbortError,
                format_args!("The operation was aborted."),
            );
            return match err {
                Ok(v) => promise.reject(global, Ok(v)),
                Err(_) => promise.reject(global, Err(jsc::JsError::Thrown)),
            };
        }
        match self.result.take() {
            Some(Ok(locked)) => {
                let lock = FileLock {
                    fd: Cell::new(locked.fd),
                    owns_fd: locked.owns_fd,
                    unlocked: Cell::new(false),
                };
                promise.resolve(global, lock.to_js(global))
            }
            Some(Err(err)) => promise.reject(global, Ok(err.to_js(global))),
            None => promise.reject(
                global,
                Ok(global.create_error_instance(format_args!("lock() task produced no result"))),
            ),
        }
    }
}

pub(crate) fn schedule_lock<'a>(
    global_this: &'a JSGlobalObject,
    source: LockSource,
    exclusive: bool,
    nonblocking: bool,
    signal: Option<*mut AbortSignal>,
) -> JSValue {
    let ctx = Box::new(LockTaskCtx {
        global_this,
        source,
        exclusive,
        nonblocking,
        aborted: AtomicU32::new(0),
        signal,
        result: None,
    });
    let task = FileLockTask::create_on_js_thread(global_this, ctx);
    let promise_value = task.promise.value();
    let raw = bun_core::heap::into_raw(task);
    // SAFETY: `raw` is freshly leaked; ownership transfers to the
    // WorkPool → event-loop dispatch (`task_tag::FileLockTask`).
    let ctx_ptr: *mut LockTaskCtx<'_> = unsafe { &mut *(*raw).ctx };
    if let Some(signal) = signal {
        // SAFETY: `signal` holds a +1 ref taken by the caller; `ctx_ptr` is
        // stable for the task's lifetime and detached in `then()`.
        unsafe { (*signal).add_listener(ctx_ptr.cast::<c_void>(), lock_abort_cb) };
    }
    // SAFETY: see above; `schedule()` only enqueues the intrusive task node.
    unsafe { (*raw).schedule() };
    promise_value
}

pub(crate) fn unlock_fd(global: &JSGlobalObject, fd: Fd) -> JSValue {
    match bun_sys::funlock(fd) {
        Ok(()) => JSPromise::resolved_promise_value(global, JSValue::UNDEFINED),
        Err(err) => JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
            global,
            err.to_js(global),
        ),
    }
}

// ───────────────────────────── I/O task (read/write/truncate) ───────────────

pub type FileLockIOTask<'a> = ConcurrentPromiseTask<'a, IoTaskCtx<'a>>;

pub struct IoTaskCtx<'a> {
    global_this: &'a JSGlobalObject,
    op: IoOp,
    result: Option<Result<IoResult, bun_sys::Error>>,
}

enum IoOp {
    Read {
        fd: Fd,
        len: Option<usize>,
        kind: ReadKind,
    },
    Write {
        fd: Fd,
        data: jsc::ThreadSafe<StringOrBuffer>,
    },
    Truncate {
        fd: Fd,
        len: i64,
    },
}

#[derive(Clone, Copy)]
enum ReadKind {
    Uint8Array,
    ArrayBuffer,
    Text,
}

enum IoResult {
    Read(Vec<u8>, ReadKind),
    Wrote(usize),
    Truncated,
}

impl ConcurrentPromiseTaskContext for IoTaskCtx<'_> {
    const TASK_TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FileLockIOTask;

    fn run(&mut self) {
        self.result = Some(match &self.op {
            IoOp::Read { fd, len, kind } => {
                let file = File::borrow(fd);
                match *len {
                    Some(n) => {
                        let mut buf = vec![0u8; n];
                        file.pread_all(&mut buf, 0).map(|read| {
                            buf.truncate(read);
                            IoResult::Read(buf, *kind)
                        })
                    }
                    None => file.read_to_end().map(|v| IoResult::Read(v, *kind)),
                }
            }
            IoOp::Write { fd, data } => {
                let bytes = data.slice();
                File::borrow(fd)
                    .pwrite_all(bytes, 0)
                    .map(|()| IoResult::Wrote(bytes.len()))
            }
            IoOp::Truncate { fd, len } => {
                bun_sys::ftruncate(*fd, *len).map(|()| IoResult::Truncated)
            }
        });
    }

    fn then(&mut self, promise: &mut JSPromise) -> Result<(), jsc::JsTerminated> {
        let global = self.global_this;
        match self.result.take() {
            Some(Ok(IoResult::Read(bytes, kind))) => {
                let value = match kind {
                    ReadKind::Uint8Array => {
                        jsc::array_buffer::ArrayBuffer::create_uint8_array(global, &bytes)
                    }
                    ReadKind::ArrayBuffer => jsc::array_buffer::ArrayBuffer::create::<
                        { jsc::JSType::ArrayBuffer },
                    >(global, &bytes),
                    ReadKind::Text => bun_core::String::clone_utf8(&bytes).to_js(global),
                };
                match value {
                    Ok(v) => promise.resolve(global, v),
                    Err(_) => promise.reject(global, Err(jsc::JsError::Thrown)),
                }
            }
            Some(Ok(IoResult::Wrote(n))) => promise.resolve(global, JSValue::js_number(n as f64)),
            Some(Ok(IoResult::Truncated)) => promise.resolve(global, JSValue::UNDEFINED),
            Some(Err(err)) => promise.reject(global, Ok(err.to_js(global))),
            None => promise.reject(
                global,
                Ok(global.create_error_instance(format_args!("FileLock I/O produced no result"))),
            ),
        }
    }
}

fn schedule_io<'a>(global_this: &'a JSGlobalObject, op: IoOp) -> JSValue {
    let ctx = Box::new(IoTaskCtx {
        global_this,
        op,
        result: None,
    });
    let task = FileLockIOTask::create_on_js_thread(global_this, ctx);
    let promise_value = task.promise.value();
    let raw = bun_core::heap::into_raw(task);
    // SAFETY: `raw` is freshly leaked; ownership transfers to the
    // WorkPool → event-loop dispatch (`task_tag::FileLockIOTask`).
    unsafe { (*raw).schedule() };
    promise_value
}
