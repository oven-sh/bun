//! A named-pipe server: a fixed number of instances wait for clients, and each
//! one a client takes is replaced when it is accepted.

use core::ptr::{self, NonNull};

use bun_sys::{self as sys, E, Tag};
use bun_uws_sys::Loop;
use bun_uws_sys::iocp::{self, Op, OverlappedEntry};

use super::sys as win;
use super::sys::{HANDLE, INVALID_HANDLE_VALUE, Win32Error};
use super::{Callback, Link, Pipe};

/// Instances kept waiting for clients unless the owner asks otherwise. A burst
/// of more clients than this finds the pipe busy and waits for the next one.
pub const DEFAULT_PENDING_INSTANCES: u32 = 4;

const PIPE_BUFFER_SIZE: u32 = 65536;

/// The owner's handle to a listening pipe. Dropping it stops listening without
/// telling anyone.
pub struct PipeServer {
    inner: NonNull<Inner>,
}

#[repr(C)]
struct Inner {
    link: Link,
    name: Vec<u16>,
    slots: Vec<*mut AcceptOp>,
    /// Connected instances nobody has accepted yet.
    connected: Vec<HANDLE>,
    on_connection: Callback<()>,
    refd: bool,
    keeping_alive: bool,
    closing: bool,
    detached: bool,
    owner_gone: bool,
    pending: u32,
    pins: u32,
}

#[repr(C)]
struct AcceptOp {
    op: Op,
    server: *mut Inner,
    handle: HANDLE,
    /// How the wait ended, when `arm` queued the packet itself. `None` while
    /// the packet out is the kernel's: the OVERLAPPED has the status then.
    posted: Option<Win32Error>,
    in_flight: bool,
}

impl PipeServer {
    /// Create the pipe `name` and wait for clients on `pending_instances`
    /// instances. `on_connection(ctx, ())` runs from the loop each time a
    /// client has connected; [`accept`](Self::accept) hands it over.
    ///
    /// `EADDRINUSE` when another server already owns the name, `EACCES` when
    /// the name is not one a pipe can have.
    pub fn listen<T>(
        loop_: *mut Loop,
        name: &[u8],
        pending_instances: u32,
        ctx: *mut T,
        on_connection: unsafe fn(*mut T, ()),
    ) -> sys::Result<PipeServer> {
        if name.is_empty() || bun_core::strings::contains_char(name, 0) {
            return Err(sys::Error::from_code(E::EINVAL, Tag::listen));
        }
        let name = super::to_wide_z(name);
        // The first instance proves nobody else serves this name.
        let first = match create_instance(loop_, &name, true) {
            Ok(handle) => handle,
            Err(err) => {
                let errno = if err == Win32Error::ACCESS_DENIED || err == Win32Error::PIPE_BUSY {
                    E::EADDRINUSE
                } else if err == Win32Error::PATH_NOT_FOUND || err == Win32Error::INVALID_NAME {
                    E::EACCES
                } else {
                    return Err(sys::Error::from_win32(err, Tag::listen));
                };
                return Err(sys::Error::from_code(errno, Tag::listen));
            }
        };

        let count = pending_instances.max(1) as usize;
        let inner = bun_core::heap::into_raw(Box::new(Inner {
            link: Link::new(loop_, Inner::shut),
            name,
            slots: Vec::with_capacity(count),
            connected: Vec::new(),
            on_connection: Callback::new(ctx, on_connection),
            refd: true,
            keeping_alive: false,
            closing: false,
            detached: false,
            owner_gone: false,
            pending: 0,
            pins: 0,
        }));
        // SAFETY: `inner` is at its final address with `link` first; the slots
        // are owned by it and freed only from their own completions.
        unsafe {
            Link::insert(inner.cast());
            for index in 0..count {
                let slot = bun_core::heap::into_raw(Box::new(AcceptOp {
                    op: Op::new(AcceptOp::complete),
                    server: inner,
                    handle: if index == 0 {
                        first
                    } else {
                        INVALID_HANDLE_VALUE
                    },
                    posted: None,
                    in_flight: false,
                }));
                (*inner).slots.push(slot);
                Inner::arm(inner, slot);
            }
            Inner::update_keep_alive(inner);
            Ok(PipeServer {
                inner: NonNull::new_unchecked(inner),
            })
        }
    }

    /// Take a connected client. `None` when none is waiting.
    pub fn accept(&mut self) -> Option<Pipe> {
        let this = self.inner.as_ptr();
        // SAFETY: `inner` is live while the owner's `PipeServer` is.
        unsafe {
            let handle = (*this).connected.pop()?;
            Some(Pipe::from_associated((*this).link.loop_, handle))
        }
    }

    /// Let listening keep the loop alive (the default).
    pub fn ref_(&self) {
        // SAFETY: `inner` is live while the owner's `PipeServer` is.
        unsafe {
            (*self.inner.as_ptr()).refd = true;
            Inner::update_keep_alive(self.inner.as_ptr());
        }
    }

    pub fn unref(&self) {
        // SAFETY: `inner` is live while the owner's `PipeServer` is.
        unsafe {
            (*self.inner.as_ptr()).refd = false;
            Inner::update_keep_alive(self.inner.as_ptr());
        }
    }
}

impl Drop for PipeServer {
    fn drop(&mut self) {
        // SAFETY: `inner` is live until `Inner::close` decides otherwise.
        unsafe { Inner::close(self.inner.as_ptr()) };
    }
}

/// One more instance of `name`, associated with the loop's port.
fn create_instance(loop_: *mut Loop, name: &[u16], first: bool) -> Result<HANDLE, Win32Error> {
    // WRITE_DAC so the pipe's access control can be changed after the fact.
    let open_mode = win::PIPE_ACCESS_DUPLEX
        | win::FILE_FLAG_OVERLAPPED
        | win::WRITE_DAC
        | if first {
            win::FILE_FLAG_FIRST_PIPE_INSTANCE
        } else {
            0
        };
    // SAFETY: `name` is NUL-terminated; `loop_` is the caller's live loop.
    unsafe {
        let handle = win::CreateNamedPipeW(
            name.as_ptr(),
            open_mode,
            win::PIPE_TYPE_BYTE | win::PIPE_READMODE_BYTE | win::PIPE_WAIT,
            win::PIPE_UNLIMITED_INSTANCES,
            PIPE_BUFFER_SIZE,
            PIPE_BUFFER_SIZE,
            0,
            ptr::null_mut(),
        );
        if handle == INVALID_HANDLE_VALUE {
            return Err(win::last_error());
        }
        if bun_sys::windows::CreateIoCompletionPort(handle, iocp::us_loop_iocp(loop_), 0, 0)
            .is_err()
        {
            let err = win::last_error();
            win::CloseHandle(handle);
            return Err(err);
        }
        Ok(handle)
    }
}

impl Inner {
    /// # Safety
    /// `this` is live. Must run on the loop's thread.
    unsafe fn update_keep_alive(this: *mut Inner) {
        // SAFETY: caller contract.
        unsafe {
            if (*this).detached {
                return;
            }
            let wanted = !(*this).closing && (*this).refd;
            if wanted == (*this).keeping_alive {
                return;
            }
            (*this).keeping_alive = wanted;
            if wanted {
                (*(*this).link.loop_).add_active(1);
            } else {
                (*(*this).link.loop_).sub_active(1);
            }
        }
    }

    /// Wait for a client on `slot`, creating its instance first if it has none.
    ///
    /// # Safety
    /// `this` and the idle `slot` are live; `this` is not closing.
    unsafe fn arm(this: *mut Inner, slot: *mut AcceptOp) {
        // SAFETY: caller contract. The OVERLAPPED lives in `slot`, which is
        // freed only from its own completion.
        unsafe {
            let loop_ = (*this).link.loop_;
            (*slot).op.overlapped.Internal = 0;
            (*slot).op.overlapped.InternalHigh = 0;
            // `None`: the kernel queues the packet. `Some`: the call said how
            // the wait ended and nothing is queued.
            let ended: Option<Win32Error> = 'ended: {
                if (*slot).handle == INVALID_HANDLE_VALUE {
                    match create_instance(loop_, &(*this).name, false) {
                        Ok(handle) => (*slot).handle = handle,
                        Err(err) => break 'ended Some(err),
                    }
                }
                // A call that succeeded at once queues its packet like one that pends.
                if win::ConnectNamedPipe((*slot).handle, (&raw mut (*slot).op).cast()) != 0 {
                    break 'ended None;
                }
                match win::last_error() {
                    Win32Error::IO_PENDING => None,
                    // A client got in between the instance's creation and this call.
                    Win32Error::PIPE_CONNECTED => Some(Win32Error::SUCCESS),
                    err => Some(err),
                }
            };
            (*slot).posted = ended;
            // What the call decided is reported from the loop too, so the owner
            // hears of every client from there.
            match ended {
                None => super::op_submitted(loop_),
                Some(_) => super::complete_from_loop(loop_, &raw mut (*slot).op),
            }
            (*slot).in_flight = true;
            (*this).pending += 1;
        }
    }

    /// # Safety
    /// `this` is live; the owner's `PipeServer` is consumed or being dropped.
    unsafe fn close(this: *mut Inner) {
        // SAFETY: caller contract.
        unsafe {
            (*this).owner_gone = true;
            if !(*this).closing {
                Self::stop(this);
                (*this).closing = true;
                Self::update_keep_alive(this);
            }
            Self::maybe_finish(this);
        }
    }

    /// [`Link::shut`]: the loop is about to be freed.
    unsafe fn shut(link: *mut Link) {
        let this = link.cast::<Inner>();
        // SAFETY: `link` is the first field of a listed (live) `Inner`.
        unsafe {
            if !(*this).closing {
                Self::stop(this);
                (*this).closing = true;
            }
            Self::update_keep_alive(this);
            (*this).detached = true;
            Link::remove(link);
            Self::maybe_finish(this);
        }
    }

    /// # Safety
    /// `this` is live and not closing.
    unsafe fn stop(this: *mut Inner) {
        // SAFETY: caller contract.
        unsafe {
            for handle in (*this).connected.drain(..) {
                win::CloseHandle(handle);
            }
            // Closed now, not when the packets come back: the name is free
            // for the next listener as soon as this returns. Closing aborts
            // the pending `ConnectNamedPipe`, whose packet still arrives.
            for &slot in &(*this).slots {
                if (*slot).handle != INVALID_HANDLE_VALUE {
                    win::CloseHandle((*slot).handle);
                    (*slot).handle = INVALID_HANDLE_VALUE;
                }
            }
        }
    }

    /// # Safety
    /// `this` is live.
    unsafe fn maybe_finish(this: *mut Inner) {
        // SAFETY: caller contract.
        unsafe {
            if !(*this).closing || (*this).pending > 0 || (*this).pins > 0 {
                return;
            }
            for slot in (*this).slots.drain(..) {
                if (*slot).handle != INVALID_HANDLE_VALUE {
                    win::CloseHandle((*slot).handle);
                }
                drop(bun_core::heap::take(slot));
            }
            if !(*this).owner_gone {
                return;
            }
            if !(*this).detached {
                Self::update_keep_alive(this);
                Link::remove(this.cast());
            }
            drop(bun_core::heap::take(this));
        }
    }
}

impl AcceptOp {
    unsafe extern "C" fn complete(loop_: *mut Loop, op: *mut Op, _entry: *mut OverlappedEntry) {
        let slot = op.cast::<AcceptOp>();
        // SAFETY: `op` is the first field of the `AcceptOp` this packet was
        // submitted for. The server outlives its slots' packets (`pending`).
        unsafe {
            super::op_dequeued(loop_);
            let this = (*slot).server;
            (*slot).in_flight = false;
            (*this).pending -= 1;
            if (*this).closing {
                Inner::maybe_finish(this);
                return;
            }
            let err = match (*slot).posted.take() {
                Some(ended) => ended,
                None => win::status_to_win32((*slot).op.status()),
            };
            if err != Win32Error::SUCCESS {
                // Nothing the owner can act on: replace the instance.
                if (*slot).handle != INVALID_HANDLE_VALUE {
                    win::CloseHandle((*slot).handle);
                    (*slot).handle = INVALID_HANDLE_VALUE;
                }
                // Out of instances: retrying at once would spin.
                if err != Win32Error::PIPE_BUSY && err != Win32Error::NOT_ENOUGH_MEMORY {
                    Inner::arm(this, slot);
                }
                return;
            }

            (*this).connected.push((*slot).handle);
            (*slot).handle = INVALID_HANDLE_VALUE;
            // A fresh instance waits for the next client before the owner
            // hears of this one. So do the slots that ran out of resources
            // earlier and were left idle rather than retried in a loop.
            for index in 0..(&(*this).slots).len() {
                let other = (&(*this).slots)[index];
                if !(*other).in_flight {
                    Inner::arm(this, other);
                }
            }
            let on_connection = (*this).on_connection;
            (*this).pins += 1;
            on_connection.invoke(());
            (*this).pins -= 1;
            Inner::maybe_finish(this);
        }
    }
}
