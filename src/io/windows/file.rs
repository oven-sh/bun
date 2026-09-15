//! Anything that is neither a pipe nor a console: regular files, `NUL`, other
//! devices. There is no readiness or completion to wait for, so each read or
//! write runs on the work pool and its result comes back through the loop's
//! port. One operation at a time.

use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;

use bun_sys::{self as sys, E, Fd, Tag};
use bun_threading::work_pool::{IntrusiveWorkTask as _, Task, WorkPool};
use bun_uws_sys::Loop;
use bun_uws_sys::iocp::{Op, OverlappedEntry};

use super::pipe::ReadEvent;
use super::{Callback, Link, Port};

/// The owner's handle to a file. Dropping it lets an operation that is already
/// running finish unobserved, then closes the fd if it is owned.
pub struct File {
    inner: NonNull<Inner>,
}

const IDLE: u8 = 0;
/// On the work pool's queue: [`File::cancel`] can still win.
const QUEUED: u8 = 1;
const RUNNING: u8 = 2;
const CANCELED: u8 = 3;

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
    state: AtomicU8,
    /// The worker has handed the result to the port.
    posted: AtomicBool,
    request: Request,
    reader: Option<Reader>,
    buf: Vec<u8>,
    result: sys::Result<usize>,
    owner_gone: bool,
    /// The loop was torn down ([`Link::shut`]): an operation still out
    /// finishes unobserved, since its callback would run in a dead VM.
    detached: bool,
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
            state: AtomicU8::new(IDLE),
            posted: AtomicBool::new(false),
            request: Request::None,
            reader: None,
            buf: Vec::new(),
            result: Ok(0),
            owner_gone: false,
            detached: false,
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
        // never looks at `close_fd`.
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
    /// dropped first, in which case `on_write` still runs.
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
        // out, its completion is the only thing that touches it again.
        unsafe {
            (*this).owner_gone = true;
            if (*this).state.load(Ordering::Acquire) == IDLE && !(*this).completing {
                Inner::destroy(this);
                return;
            }
            let _ = self.cancel();
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
            let _ = (*this).state.compare_exchange(
                QUEUED,
                CANCELED,
                Ordering::AcqRel,
                Ordering::Acquire,
            );
            // A write that is running reads the owner's bytes, and the owner
            // goes away with the loop: see it through. Its packet is then
            // queued before the loop's teardown drain looks for it.
            while (*this).state.load(Ordering::Acquire) == RUNNING
                && !(*this).posted.load(Ordering::Acquire)
            {
                std::thread::yield_now();
            }
            Link::remove(link);
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
            (*this).posted.store(false, Ordering::Release);
            super::op_submitted((*this).loop_);
            (*(*this).loop_).add_active(1);
            WorkPool::schedule(&raw mut (*this).task);
        }
    }

    /// Work-pool half.
    unsafe fn run(task: *mut Task) {
        // SAFETY: `task` is the field of an `Inner` that `File::start` scheduled;
        // it stays allocated until the packet posted below is dequeued, and the
        // loop thread touches only `state`, `reader` and `owner_gone` in the
        // meantime.
        unsafe {
            let this = Inner::from_task_ptr(task);
            let started = (*this)
                .state
                .compare_exchange(QUEUED, RUNNING, Ordering::AcqRel, Ordering::Acquire)
                .is_ok();
            let fd = (*this).fd;
            (*this).result = if !started {
                Err(sys::Error::from_code(E::ECANCELED, (*this).request.tag()).with_fd(fd))
            } else {
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
            };
            // Before the post: the loop thread may free `this` as soon as the
            // packet is queued.
            (*this).posted.store(true, Ordering::Release);
            (*this).port.post(&raw mut (*this).op);
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
