//! `Bun.file().lock()` / `FileLock` — advisory file locking.
//!
//! POSIX uses `flock(2)` (BSD whole-file advisory lock); Windows uses
//! `LockFileEx` over the full 64-bit range. Lock acquisition runs on the
//! WorkPool so the JS thread stays responsive; the wait is an `flock(LOCK_NB)`
//! poll with a futex-backed sleep so an `AbortSignal` can break it early.

use core::cell::Cell;
use core::ffi::c_void;
use core::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use crate::node::types::StringOrBuffer;
use bun_jsc::concurrent_promise_task::{ConcurrentPromiseTask, ConcurrentPromiseTaskContext};
use bun_jsc::{
    self as jsc, AbortSignal, CallFrame, JSGlobalObject, JSPromise, JSValue, JsClass as _,
    JsResult, StringJsc as _, SysErrorJsc as _,
};
use bun_sys::{self, Fd, FdExt as _, File, O};
use bun_threading::Futex;

// ───────────────────────────── FileLock (JS class) ──────────────────────────

/// The fd held by a `FileLock`, shared via `Arc` with in-flight I/O tasks so
/// `unlock()` cannot close it out from under a pending `pread`/`pwrite`.
/// `Drop` closes the fd when the last owner releases.
struct HeldFd {
    fd: Fd,
    owns_fd: bool,
}

impl Drop for HeldFd {
    fn drop(&mut self) {
        if self.owns_fd && self.fd != Fd::INVALID {
            self.fd.close();
        }
    }
}

/// Returned from `Bun.file().lock()`. Owns (or borrows) the locked fd and
/// exposes I/O on it while held. `unlock()` / `close()` / `[Symbol.asyncDispose]`
/// release the lock; the underlying fd closes once all pending I/O settles.
#[bun_jsc::JsClass(no_constructor)]
pub struct FileLock {
    held: Cell<Option<Arc<HeldFd>>>,
    unlocked: Cell<bool>,
}

impl Drop for FileLock {
    fn drop(&mut self) {
        let _ = self.release();
    }
}

impl FileLock {
    fn release(&self) -> Result<(), bun_sys::Error> {
        if self.unlocked.replace(true) {
            return Ok(());
        }
        // Drop our ref; in-flight I/O tasks keep theirs until they finish.
        let Some(held) = self.held.take() else {
            return Ok(());
        };
        bun_sys::funlock(held.fd)
    }

    fn held_ref(&self, global: &JSGlobalObject, op: &str) -> JsResult<Arc<HeldFd>> {
        if self.unlocked.get() {
            return Err(global.throw_invalid_arguments(format_args!(
                "FileLock is already released; cannot {op}()"
            )));
        }
        // SAFETY: JS-thread interior mutability; no concurrent mutation.
        let held = unsafe { &*self.held.as_ptr() };
        Ok(Arc::clone(held.as_ref().expect("live FileLock has fd")))
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
        let held = self.held_ref(global, "bytes")?;
        let len = optional_byte_count(global, frame)?;
        Ok(schedule_io(
            global,
            held,
            IoOp::Read {
                len,
                kind: ReadKind::Uint8Array,
            },
        ))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_text(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let held = self.held_ref(global, "text")?;
        let len = optional_byte_count(global, frame)?;
        Ok(schedule_io(
            global,
            held,
            IoOp::Read {
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
        let held = self.held_ref(global, "arrayBuffer")?;
        let len = optional_byte_count(global, frame)?;
        Ok(schedule_io(
            global,
            held,
            IoOp::Read {
                len,
                kind: ReadKind::ArrayBuffer,
            },
        ))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_write(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let held = self.held_ref(global, "write")?;
        let Some(arg) = frame.arguments().first().copied() else {
            return Err(global.throw_invalid_arguments(format_args!(
                "FileLock.write(data) requires a string, ArrayBuffer, or ArrayBufferView"
            )));
        };
        // is_async=true pins + protects ArrayBuffer inputs so a `transfer()`
        // between now and the WorkPool read can't detach the backing store.
        let Some(data) = StringOrBuffer::from_js_maybe_async(global, arg, true, true)? else {
            return Err(global.throw_invalid_argument_type("write", "data", "string or buffer"));
        };
        let data = jsc::ThreadSafe::adopt(data);
        Ok(schedule_io(global, held, IoOp::Write { data }))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_truncate(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let held = self.held_ref(global, "truncate")?;
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
        Ok(schedule_io(global, held, IoOp::Truncate { len }))
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

const LOCK_POLL_INTERVAL_NS: u64 = 10_000_000;

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
    result: Option<Result<HeldFd, bun_sys::Error>>,
}

pub(crate) enum LockSource {
    Fd(Fd),
    /// Owned copy of the path bytes; the `PathLike` inside the Blob's store
    /// may borrow JS-heap memory that nothing on this task roots.
    Path(Vec<u8>),
}

extern "C" fn lock_abort_cb(ctx: *mut c_void, _reason: JSValue) {
    // SAFETY: `ctx` is the `LockTaskCtx` inside the heap `FileLockTask`; the
    // listener is detached before the task is destroyed. `run()` may hold
    // `&mut LockTaskCtx` on a WorkPool thread, so project directly to the
    // `UnsafeCell`-backed atomic instead of forming `&LockTaskCtx`.
    let aborted = unsafe { &*core::ptr::addr_of!((*ctx.cast::<LockTaskCtx<'_>>()).aborted) };
    aborted.store(1, Ordering::SeqCst);
    Futex::wake(aborted, 1);
}

impl ConcurrentPromiseTaskContext for LockTaskCtx<'_> {
    const TASK_TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FileLockTask;

    fn run(&mut self) {
        let (fd, owns_fd) = match &self.source {
            LockSource::Fd(fd) => (*fd, false),
            LockSource::Path(bytes) => {
                let mut buf = bun_paths::path_buffer_pool::get();
                if bytes.len() >= buf.len() {
                    self.result = Some(Err(bun_sys::Error::new(
                        bun_sys::E::ENAMETOOLONG,
                        bun_sys::Tag::open,
                    )
                    .with_path(bytes)));
                    return;
                }
                let n = bytes.len();
                buf[..n].copy_from_slice(bytes);
                buf[n] = 0;
                let path = bun_core::ZStr::from_buf(&buf[..], n);
                let opened = match bun_sys::open(path, O::RDWR | O::CREAT | O::CLOEXEC, 0o666) {
                    Ok(fd) => Ok(fd),
                    // flock(2) permits shared locks regardless of open mode;
                    // fall back so read-only files can still be shared-locked.
                    Err(e)
                        if matches!(
                            e.get_errno(),
                            bun_sys::E::EACCES | bun_sys::E::EROFS | bun_sys::E::EISDIR
                        ) =>
                    {
                        bun_sys::open(path, O::RDONLY | O::CLOEXEC, 0)
                    }
                    Err(e) => Err(e),
                };
                match opened {
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
                Some(bun_sys::flock(fd, self.exclusive, true).map(|()| HeldFd { fd, owns_fd }));
        } else {
            // Abortable wait: poll LOCK_NB, sleeping on the `aborted` futex
            // between attempts so an abort wakes us immediately.
            loop {
                if self.aborted.load(Ordering::SeqCst) != 0 {
                    break;
                }
                match bun_sys::flock(fd, self.exclusive, true) {
                    Ok(()) => {
                        self.result = Some(Ok(HeldFd { fd, owns_fd }));
                        return;
                    }
                    // POSIX flock → EWOULDBLOCK (== EAGAIN); Win32
                    // ERROR_LOCK_VIOLATION → EBUSY.
                    Err(e) if e.is_retry() || e.get_errno() == bun_sys::E::EBUSY => {
                        let _ = Futex::wait(&self.aborted, 0, Some(LOCK_POLL_INTERVAL_NS));
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
        let aborted = self.aborted.load(Ordering::SeqCst) != 0;
        // Build the same Node-style AbortError (`code: 'ABORT_ERR'`,
        // `cause === signal.reason`) the pre-aborted path uses, before
        // detaching the listener and releasing the ref.
        let abort_err = self.signal.take().and_then(|signal| {
            // SAFETY: `signal` holds a +1 ref taken in `schedule_lock`.
            let err = aborted
                .then(|| unsafe { (*signal).node_abort_error_if_aborted(global) })
                .flatten();
            unsafe { (*signal).detach(core::ptr::from_mut(self).cast::<c_void>()) };
            err
        });
        if aborted {
            if let Some(Ok(held)) = self.result.take() {
                let _ = bun_sys::funlock(held.fd);
                drop(held);
            }
            let err = abort_err.unwrap_or_else(|| {
                global.create_error_instance(format_args!("The operation was aborted."))
            });
            return promise.reject(global, Ok(err));
        }
        match self.result.take() {
            Some(Ok(held)) => {
                let lock = FileLock {
                    held: Cell::new(Some(Arc::new(held))),
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
    held: Arc<HeldFd>,
    op: IoOp,
    result: Option<Result<IoResult, bun_sys::Error>>,
}

enum IoOp {
    Read {
        len: Option<usize>,
        kind: ReadKind,
    },
    Write {
        data: jsc::ThreadSafe<StringOrBuffer>,
    },
    Truncate {
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
        let fd = self.held.fd;
        self.result = Some(match &self.op {
            IoOp::Read { len, kind } => (|| {
                let file = File::borrow(&fd);
                // Always positional from offset 0 so repeated reads are
                // idempotent (Windows `read_to_end()` is cursor-based).
                let size = file.get_end_pos()?;
                let want = len.map_or(size, |n| n.min(size));
                let mut buf = Vec::new();
                buf.try_reserve_exact(want)
                    .map_err(|_| bun_sys::Error::oom())?;
                buf.resize(want, 0);
                let read = file.pread_all(&mut buf, 0)?;
                buf.truncate(read);
                Ok(IoResult::Read(buf, *kind))
            })(),
            IoOp::Write { data } => {
                let bytes = data.slice();
                File::borrow(&fd)
                    .pwrite_all(bytes, 0)
                    .map(|()| IoResult::Wrote(bytes.len()))
            }
            IoOp::Truncate { len } => bun_sys::ftruncate(fd, *len).map(|()| IoResult::Truncated),
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

fn schedule_io<'a>(global_this: &'a JSGlobalObject, held: Arc<HeldFd>, op: IoOp) -> JSValue {
    let ctx = Box::new(IoTaskCtx {
        global_this,
        held,
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
