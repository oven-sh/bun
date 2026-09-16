//! Anything that is neither a pipe nor a console: regular files, `NUL`, other
//! devices. There is no readiness or completion to wait for, so each read or
//! write runs on the work pool and its result comes back through the loop's
//! port. One operation at a time.
//!
//! A request that is out belongs to the work pool until it has handed the
//! result to the port. `state` is how it changes hands: the pool thread moves
//! it forward with a compare-exchange at each step, and the loop thread claims
//! it the same way when it no longer wants the result, so exactly one side
//! finds out that the other got there first.

use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use bun_sys::{self as sys, E, Fd, FdExt as _, Tag};
use bun_threading::Futex;
use bun_threading::work_pool::{IntrusiveWorkTask as _, Task, WorkPool};
use bun_uws_sys::Loop;
use bun_uws_sys::iocp::{self, Op, OverlappedEntry};

use super::pipe::ReadEvent;
use super::{Callback, Link, Port};

/// The owner's handle to a file. Dropping it lets an operation that is already
/// running finish unobserved, then closes the fd if it is owned.
pub struct File {
    inner: NonNull<Inner>,
}

const IDLE: u32 = 0;
/// On the work pool's queue: [`File::cancel`] can still win.
const QUEUED: u32 = 1;
const RUNNING: u32 = 2;
/// [`File::cancel`] won: the pool thread reports `ECANCELED` without doing the I/O.
const CANCELED: u32 = 3;
/// The pool thread is done and is handing the result to the port.
const POSTED: u32 = 4;
/// The loop is gone and nobody will dequeue a result: the pool thread lets go
/// of the request instead of posting it.
const ORPHANED: u32 = 5;

type ReadCallback = unsafe fn(*const (), *mut c_void, ReadEvent<'_>);

/// Who hears about reads. Kept apart from the request so it can change while
/// the work pool holds the request.
#[derive(Clone, Copy)]
struct Reader {
    ctx: *mut c_void,
    f: *const (),
    call: ReadCallback,
}

enum Request {
    None,
    Read {
        len: usize,
        offset: Option<u64>,
    },
    Write {
        data: *const u8,
        len: usize,
        callback: Callback<sys::Result<usize>>,
    },
}

impl Request {
    fn tag(&self) -> Tag {
        match self {
            Request::None | Request::Read { .. } => Tag::read,
            Request::Write { .. } => Tag::write,
        }
    }
}

#[repr(C)]
struct Inner {
    op: Op,
    link: Link,
    task: Task,
    fd: Fd,
    close_fd: bool,
    loop_: *mut Loop,
    port: Arc<Port>,
    state: AtomicU32,
    /// The loop thread sleeps on `state` ([`Inner::shut`]).
    shut_waiting: AtomicBool,
    /// After the request was orphaned, the owner and the pool thread each let
    /// go once; the second one frees.
    released: AtomicBool,
    request: Request,
    reader: Option<Reader>,
    buf: Vec<u8>,
    result: sys::Result<usize>,
    owner_gone: bool,
    /// The loop was torn down ([`Link::shut`]): an operation still out
    /// finishes unobserved, since its callback would run in a dead VM.
    detached: bool,
    /// `shut` found a request out and orphaned it.
    orphaned: bool,
    /// Inside the owner's callback: the allocation and `buf` are in use by
    /// `complete`'s frame, so a request made now is scheduled when it returns.
    completing: bool,
    deferred: bool,
}

bun_threading::intrusive_work_task!(Inner, task);

impl File {
    /// `fd` is closed with the file when `close_fd` is set.
    pub fn open(loop_: *mut Loop, fd: Fd, close_fd: bool) -> sys::Result<File> {
        // SAFETY: `loop_` is the caller's live loop.
        let Some(port) = (unsafe { super::port_for(loop_) }) else {
            return Err(sys::Error::from_win32(super::sys::last_error(), Tag::open).with_fd(fd));
        };
        let inner = bun_core::heap::into_raw(Box::new(Inner {
            op: Op::new(Inner::complete),
            link: Link::new(loop_, Inner::shut),
            task: Task {
                node: Default::default(),
                callback: Inner::run,
            },
            fd,
            close_fd,
            loop_,
            port,
            state: AtomicU32::new(IDLE),
            shut_waiting: AtomicBool::new(false),
            released: AtomicBool::new(false),
            request: Request::None,
            reader: None,
            buf: Vec::new(),
            result: Ok(0),
            owner_gone: false,
            detached: false,
            orphaned: false,
            completing: false,
            deferred: false,
        }));
        // SAFETY: `inner` is at its final address.
        unsafe { Link::insert(&raw mut (*inner).link) };
        // SAFETY: `into_raw` never returns null.
        Ok(File {
            inner: unsafe { NonNull::new_unchecked(inner) },
        })
    }

    pub fn fd(&self) -> Fd {
        // SAFETY: `inner` is live while the owner's `File` is.
        unsafe { (*self.inner.as_ptr()).fd }
    }

    /// Leave the `Fd` open when the file goes away.
    pub fn disown(&mut self) {
        // SAFETY: `inner` is live while the owner's `File` is; the work pool
        // looks at `close_fd` only after the owner has let go.
        unsafe { (*self.inner.as_ptr()).close_fd = false };
    }

    /// An operation has been started and its callback has not run yet.
    pub fn is_busy(&self) -> bool {
        // SAFETY: `inner` is live while the owner's `File` is.
        unsafe { (*self.inner.as_ptr()).state.load(Ordering::Acquire) != IDLE }
    }

    /// Read up to `len` bytes, at `offset` or at the file position, then call
    /// `on_read(ctx, ..)` from the loop. `ctx` must stay valid until then or
    /// until the `File` is dropped.
    pub fn read<T>(
        &mut self,
        len: usize,
        offset: Option<u64>,
        ctx: *mut T,
        on_read: unsafe fn(*mut T, ReadEvent<'_>),
    ) -> sys::Result<()> {
        self.start(Request::Read {
            len: len.max(1),
            offset,
        })?;
        self.set_reader(ctx, on_read);
        Ok(())
    }

    /// Who the read that is out (if any) reports to: for an owner that moved.
    pub fn set_reader<T>(&mut self, ctx: *mut T, on_read: unsafe fn(*mut T, ReadEvent<'_>)) {
        unsafe fn call<T>(f: *const (), ctx: *mut c_void, event: ReadEvent<'_>) {
            // SAFETY: `f` was erased from exactly this type below.
            let f =
                unsafe { core::mem::transmute::<*const (), unsafe fn(*mut T, ReadEvent<'_>)>(f) };
            // SAFETY: the owner keeps `ctx` valid while the read is out.
            unsafe { f(ctx.cast::<T>(), event) }
        }
        // SAFETY: `inner` is live while the owner's `File` is; the work pool
        // never looks at `reader`.
        unsafe {
            (*self.inner.as_ptr()).reader = Some(Reader {
                ctx: ctx.cast(),
                f: on_read as *const (),
                call: call::<T>,
            });
        }
    }

    /// Write all of `data` at the file position, then call `on_write(ctx, ..)`
    /// from the loop.
    ///
    /// # Safety
    /// `data` must stay valid until `on_write` runs — also when the `File` is
    /// dropped first, in which case `on_write` still runs — or until the loop
    /// has been torn down ([`super::close_all_for_loop`]), after which
    /// `on_write` does not run.
    pub unsafe fn write<T>(
        &mut self,
        data: &[u8],
        ctx: *mut T,
        on_write: unsafe fn(*mut T, sys::Result<usize>),
    ) -> sys::Result<()> {
        self.start(Request::Write {
            data: data.as_ptr(),
            len: data.len(),
            callback: Callback::new(ctx, on_write),
        })
    }

    fn start(&mut self, request: Request) -> sys::Result<()> {
        let this = self.inner.as_ptr();
        // SAFETY: `inner` is live while the owner's `File` is, and idle (checked
        // first), so the work pool is not looking at it.
        unsafe {
            if (*this).detached {
                return Err(sys::Error::from_code(E::EBADF, request.tag()).with_fd((*this).fd));
            }
            if (*this).state.load(Ordering::Acquire) != IDLE {
                return Err(sys::Error::from_code(E::EBUSY, request.tag()).with_fd((*this).fd));
            }
            (*this).request = request;
            (*this).state.store(QUEUED, Ordering::Release);
            if (*this).completing {
                (*this).deferred = true;
            } else {
                Inner::schedule(this);
            }
        }
        Ok(())
    }

    /// Ask the pending operation not to happen. `true` if it had not started:
    /// its callback then reports `ECANCELED`. Otherwise it completes normally.
    pub fn cancel(&mut self) -> bool {
        // SAFETY: `inner` is live while the owner's `File` is.
        unsafe {
            (*self.inner.as_ptr())
                .state
                .compare_exchange(QUEUED, CANCELED, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
        }
    }
}

impl Drop for File {
    fn drop(&mut self) {
        let this = self.inner.as_ptr();
        // SAFETY: `inner` is live; once `owner_gone` is set and an operation is
        // out, whoever finishes it is the only one to touch it again.
        unsafe {
            (*this).owner_gone = true;
            if (*this).orphaned {
                Inner::release(this);
                return;
            }
            if (*this).state.load(Ordering::Acquire) == IDLE && !(*this).completing {
                Inner::destroy(this);
                return;
            }
            let _ = self.cancel();
        }
    }
}

/// Carries to the loop's teardown drain the bookkeeping of a request that was
/// orphaned: what [`Inner::schedule`] added is taken off as it is dequeued.
#[repr(C)]
struct Settle {
    op: Op,
}

impl Settle {
    /// # Safety
    /// `loop_` is the live loop of the calling thread, with one
    /// [`Inner::schedule`] to undo.
    unsafe fn post(loop_: *mut Loop) {
        let settle = bun_core::heap::into_raw(Box::new(Settle {
            op: Op::new(Settle::complete),
        }));
        // SAFETY: caller contract; `settle` is freed by its completion. The
        // loop already counts the request's packet as owed.
        unsafe { iocp::us_iocp_op_ready(loop_, &raw mut (*settle).op) };
    }

    unsafe extern "C" fn complete(loop_: *mut Loop, op: *mut Op, _entry: *mut OverlappedEntry) {
        // SAFETY: `op` is the first field of the `Settle` posted above.
        unsafe {
            super::op_dequeued(loop_);
            (*loop_).sub_active(1);
            drop(bun_core::heap::take(op.cast::<Settle>()));
        }
    }
}

impl Inner {
    /// [`Link::shut`]: the loop is about to be freed.
    unsafe fn shut(link: *mut Link) {
        // SAFETY: `link` is the `link` field of a listed (live) `Inner`.
        unsafe {
            let this = link
                .byte_sub(core::mem::offset_of!(Inner, link))
                .cast::<Inner>();
            (*this).detached = true;
            (*this).reader = None;
            Link::remove(link);
            if core::mem::take(&mut (*this).deferred) {
                // Asked for from inside the owner's callback; the pool has not seen it.
                (*this).request = Request::None;
                (*this).state.store(IDLE, Ordering::Release);
                return;
            }
            loop {
                let state = (*this).state.load(Ordering::SeqCst);
                match state {
                    // A result that is on its way to the port is collected by
                    // the loop's teardown drain.
                    IDLE | POSTED => return,
                    // A write that is running reads the owner's bytes, and the
                    // owner goes away with the loop: see it through.
                    RUNNING if matches!((*this).request, Request::Write { .. }) => {
                        (*this).shut_waiting.store(true, Ordering::SeqCst);
                        Futex::wait_forever(&(*this).state, RUNNING);
                    }
                    // Everything else the request needs is its own: the pool
                    // thread is left to finish (or skip) it by itself.
                    _ => {
                        if (*this)
                            .state
                            .compare_exchange(state, ORPHANED, Ordering::SeqCst, Ordering::SeqCst)
                            .is_ok()
                        {
                            break;
                        }
                    }
                }
            }
            (*this).orphaned = true;
            Settle::post((*this).loop_);
            if (*this).owner_gone {
                Self::release(this);
            }
        }
    }

    /// One of the two that still know about an orphaned request lets go.
    ///
    /// # Safety
    /// `this` is live and orphaned; the caller does not touch it afterwards.
    unsafe fn release(this: *mut Inner) {
        // SAFETY: caller contract; the second caller is the only one left.
        unsafe {
            if (*this).released.swap(true, Ordering::AcqRel) {
                let inner = bun_core::heap::take(this);
                if inner.close_fd {
                    inner.fd.close();
                }
            }
        }
    }

    /// # Safety
    /// `this` is idle and its owner is gone.
    unsafe fn destroy(this: *mut Inner) {
        // SAFETY: caller contract; `remove` is idempotent.
        unsafe { Link::remove(&raw mut (*this).link) };
        // SAFETY: caller contract.
        let inner = unsafe { bun_core::heap::take(this) };
        if inner.close_fd {
            crate::closer::Closer::close(inner.fd, ());
        }
    }

    /// # Safety
    /// `this` is live with a request in `QUEUED` (or `CANCELED`) state.
    unsafe fn schedule(this: *mut Inner) {
        // SAFETY: caller contract.
        unsafe {
            super::op_submitted((*this).loop_);
            (*(*this).loop_).add_active(1);
            WorkPool::schedule(&raw mut (*this).task);
        }
    }

    /// Work-pool half.
    unsafe fn run(task: *mut Task) {
        // SAFETY: `task` is the field of an `Inner` that `File::start` scheduled.
        // Until `state` leaves `RUNNING` (or `QUEUED`/`CANCELED`) this thread
        // owns `request`, `buf` and `result`; the loop thread touches only
        // `state`, `reader`, `owner_gone` and the teardown flags in the
        // meantime.
        unsafe {
            let this = Inner::from_task_ptr(task);
            let fd = (*this).fd;
            let from = match (*this).state.compare_exchange(
                QUEUED,
                RUNNING,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => {
                    (*this).result = Self::perform(this);
                    RUNNING
                }
                Err(CANCELED) => {
                    (*this).result =
                        Err(sys::Error::from_code(E::ECANCELED, (*this).request.tag()).with_fd(fd));
                    CANCELED
                }
                Err(_) => return Self::release(this),
            };
            // The loop thread frees `this` when it has dequeued the packet,
            // which can be before `post` returns: nothing of `this` is
            // borrowed across it.
            let port = (*this).port.clone();
            if (*this)
                .state
                .compare_exchange(from, POSTED, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
            {
                return Self::release(this);
            }
            if (*this).shut_waiting.load(Ordering::SeqCst) {
                Futex::wake(&(*this).state, 1);
            }
            port.post(&raw mut (*this).op);
        }
    }

    /// # Safety
    /// `this` is live and `RUNNING`; called from the work pool.
    unsafe fn perform(this: *mut Inner) -> sys::Result<usize> {
        // SAFETY: caller contract.
        unsafe {
            let fd = (*this).fd;
            match &(*this).request {
                Request::None => Ok(0),
                Request::Read { len, offset, .. } => {
                    let buf = &mut (*this).buf;
                    buf.clear();
                    buf.reserve(*len);
                    let spare = bun_core::vec::spare_bytes_mut(buf);
                    let spare = &mut spare[..*len];
                    let result = match offset {
                        Some(offset) => sys::pread(fd, spare, *offset as i64),
                        None => sys::read(fd, spare),
                    };
                    if let Ok(n) = result {
                        bun_core::vec::commit_spare(buf, n);
                    }
                    result
                }
                Request::Write { data, len, .. } => {
                    let data = core::slice::from_raw_parts(*data, *len);
                    let mut written = 0usize;
                    let mut failure = None;
                    while written < data.len() {
                        match sys::write(fd, &data[written..]) {
                            Ok(0) => break,
                            Ok(n) => written += n,
                            Err(err) => {
                                failure = Some(err);
                                break;
                            }
                        }
                    }
                    match failure {
                        Some(err) if written == 0 => Err(err),
                        _ => Ok(written),
                    }
                }
            }
        }
    }

    unsafe extern "C" fn complete(loop_: *mut Loop, op: *mut Op, _entry: *mut OverlappedEntry) {
        let this = op.cast::<Inner>();
        // SAFETY: `op` is the first field of the `Inner` whose worker posted
        // this packet; the worker is done with it.
        unsafe {
            super::op_dequeued(loop_);
            (*loop_).sub_active(1);
            (*this).state.store(IDLE, Ordering::Release);
            (*this).completing = true;
            let request = core::mem::replace(&mut (*this).request, Request::None);
            let result = core::mem::replace(&mut (*this).result, Ok(0));
            match request {
                _ if (*this).detached => {}
                Request::None => {}
                // Nobody is left to hear about a read once the owner is gone;
                // a write's callback still runs because it is what releases
                // the borrowed bytes.
                Request::Read { .. } => {
                    if let Some(reader) = (*this).reader
                        && !(*this).owner_gone
                    {
                        let event = match result {
                            Ok(0) => ReadEvent::Eof,
                            Ok(_) => ReadEvent::Data(&mut (*this).buf),
                            Err(err) => ReadEvent::Err(err),
                        };
                        (reader.call)(reader.f, reader.ctx, event);
                    }
                }
                Request::Write { callback, .. } => callback.invoke(result),
            }
            (*this).completing = false;
            // The callback may have dropped the owner's `File`, or asked for
            // the next operation.
            if core::mem::take(&mut (*this).deferred) {
                if !(*this).detached {
                    Self::schedule(this);
                    return;
                }
                (*this).request = Request::None;
                (*this).state.store(IDLE, Ordering::Release);
            }
            if (*this).owner_gone {
                Self::destroy(this);
            }
        }
    }
}
