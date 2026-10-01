//! A named-pipe server: a fixed number of instances wait for clients, and each
//! one a client takes is replaced.
//!
//! A slot whose instance cannot be made to wait for a client is left idle and
//! tried again at the start of each tick of the loop ([`Starved`]); the owner
//! does not hear of it, as with libuv and so Node.

use core::ptr::{self, NonNull};

use bun_sys::{self as sys, E, Tag};
use bun_uws_sys::Loop;
use bun_uws_sys::iocp::{self, Op, Starved};

use super::sys as win;
use super::sys::{HANDLE, INVALID_HANDLE_VALUE, Win32Error};
use super::{Callback, Link, Pipe};

/// Instances kept waiting for clients. A burst of more clients than this finds
/// the pipe busy and waits for the next one.
const PENDING_INSTANCES: usize = 4;

const PIPE_BUFFER_SIZE: u32 = 65536;

/// The owner's handle to a listening pipe. Dropping it stops listening without
/// telling anyone. Listening does not keep the loop alive: that is the owner's.
pub struct PipeServer {
    inner: NonNull<Inner>,
}

#[repr(C)]
struct Inner {
    link: Link,
    starved: Starved,
    /// `starved` is linked: a slot is idle.
    is_starved: bool,
    name: Vec<u16>,
    slots: Vec<*mut AcceptOp>,
    on_connection: Callback<Pipe>,
    closing: bool,
    owner_gone: bool,
    pending: u32,
    pins: u32,
}

#[repr(C)]
struct AcceptOp {
    op: Op,
    server: *mut Inner,
    handle: HANDLE,
    /// `arm` found a client connected already and queued the packet itself.
    /// Otherwise the packet out is the kernel's and the OVERLAPPED has the
    /// status.
    posted: bool,
    in_flight: bool,
}

impl PipeServer {
    /// Create the pipe `name` and wait for clients. `on_connection(ctx, pipe)`
    /// runs from the loop each time a client has connected.
    ///
    /// `EADDRINUSE` when another server already owns the name, `EACCES` when
    /// the name is not one a pipe can have.
    pub fn listen<T>(
        loop_: *mut Loop,
        name: &[u8],
        ctx: *mut T,
        on_connection: unsafe fn(*mut T, Pipe),
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

        let inner = bun_core::heap::into_raw(Box::new(Inner {
            link: Link::new(loop_, Inner::shut),
            starved: Starved::new(Inner::retry),
            is_starved: false,
            name,
            slots: Vec::with_capacity(PENDING_INSTANCES),
            on_connection: Callback::new(ctx, on_connection),
            closing: false,
            owner_gone: false,
            pending: 0,
            pins: 0,
        }));
        // SAFETY: `inner` is at its final address with `link` first; the slots
        // are owned by it and freed only from their own completions.
        unsafe {
            Link::insert(inner.cast());
            for index in 0..PENDING_INSTANCES {
                let slot = bun_core::heap::into_raw(Box::new(AcceptOp {
                    op: Op::new(AcceptOp::complete),
                    server: inner,
                    handle: if index == 0 {
                        first
                    } else {
                        INVALID_HANDLE_VALUE
                    },
                    posted: false,
                    in_flight: false,
                }));
                (*inner).slots.push(slot);
                Inner::arm(inner, slot);
            }
            Inner::update_starved(inner);
            Ok(PipeServer {
                inner: NonNull::new_unchecked(inner),
            })
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
    // WRITE_DAC as libuv asks for it: nothing here changes the access control.
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
    /// Wait for a client on `slot`, creating its instance first if it has none.
    /// A slot that cannot be made to wait stays idle, without an instance.
    ///
    /// # Safety
    /// `this` and the idle `slot` are live; `this` is not closing.
    unsafe fn arm(this: *mut Inner, slot: *mut AcceptOp) {
        // SAFETY: caller contract. The OVERLAPPED lives in `slot`, which is
        // freed only from its own completion.
        unsafe {
            let loop_ = (*this).link.loop_;
            if (*slot).handle == INVALID_HANDLE_VALUE {
                match create_instance(loop_, &(*this).name, false) {
                    Ok(handle) => (*slot).handle = handle,
                    Err(_) => return,
                }
            }
            (*slot).op.reset(ptr::null_mut());
            // A call that succeeded at once queues its packet like one that pends.
            let queued = win::ConnectNamedPipe((*slot).handle, (&raw mut (*slot).op).cast()) != 0
                || match win::last_error() {
                    Win32Error::IO_PENDING => true,
                    // A client got in between the instance's creation and this
                    // call, and nothing is queued. `NO_DATA`: it has closed its
                    // end already; what it wrote is still there to read.
                    Win32Error::PIPE_CONNECTED | Win32Error::NO_DATA => false,
                    _ => {
                        win::CloseHandle((*slot).handle);
                        (*slot).handle = INVALID_HANDLE_VALUE;
                        return;
                    }
                };
            (*slot).posted = !queued;
            // The owner hears of every client from the loop.
            if queued {
                super::op_submitted(loop_);
            } else {
                super::complete_from_loop(loop_, &raw mut (*slot).op);
            }
            (*slot).in_flight = true;
            (*this).pending += 1;
        }
    }

    /// Link or unlink `starved` to match whether a slot is idle.
    ///
    /// # Safety
    /// `this` is live and its loop is too. Must run on the loop's thread.
    unsafe fn update_starved(this: *mut Inner) {
        // SAFETY: caller contract; slots are live while listed.
        unsafe {
            let wanted = !(*this).closing && (*this).slots.iter().any(|&slot| !(*slot).in_flight);
            if wanted == (*this).is_starved {
                return;
            }
            (*this).is_starved = wanted;
            if wanted {
                iocp::us_iocp_starved_link((*this).link.loop_, &raw mut (*this).starved);
            } else {
                iocp::us_iocp_starved_unlink((*this).link.loop_, &raw mut (*this).starved);
            }
        }
    }

    /// The start of a tick with a slot idle. No owner callback runs from here:
    /// a client `arm` finds connected is reported from the ready list.
    unsafe extern "C" fn retry(starved: *mut Starved) {
        // SAFETY: `starved` is the field of a live `Inner` that linked it,
        // which is listening. `arm` leaves `slots` alone.
        unsafe {
            let this = starved
                .byte_sub(core::mem::offset_of!(Inner, starved))
                .cast::<Inner>();
            for index in 0..(&(*this).slots).len() {
                let slot = (&(*this).slots)[index];
                if !(*slot).in_flight {
                    Self::arm(this, slot);
                }
            }
            Self::update_starved(this);
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
                Self::update_starved(this);
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
                Self::update_starved(this);
            }
            Link::remove(link);
            Self::maybe_finish(this);
        }
    }

    /// # Safety
    /// `this` is live and not closing.
    unsafe fn stop(this: *mut Inner) {
        // SAFETY: caller contract.
        unsafe {
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
            // `stop` closed their instances.
            for slot in (*this).slots.drain(..) {
                drop(bun_core::heap::take(slot));
            }
            if !(*this).owner_gone {
                return;
            }
            Link::remove(this.cast());
            drop(bun_core::heap::take(this));
        }
    }
}

impl AcceptOp {
    unsafe extern "C" fn complete(loop_: *mut Loop, op: *mut Op) {
        let slot = op.cast::<AcceptOp>();
        // SAFETY: `op` is the first field of the `AcceptOp` this packet was
        // submitted for. The server outlives its slots' packets (`pending`).
        unsafe {
            let this = (*slot).server;
            (*slot).in_flight = false;
            (*this).pending -= 1;
            if (*this).closing {
                Inner::maybe_finish(this);
                return;
            }
            let connected = core::mem::take(&mut (*slot).posted)
                || win::status_to_win32((*slot).op.status()) == Win32Error::SUCCESS;
            if !connected {
                // The wait failed and took the instance with it.
                win::CloseHandle((*slot).handle);
                (*slot).handle = INVALID_HANDLE_VALUE;
                Inner::update_starved(this);
                return;
            }

            let pipe = Pipe::from_associated(loop_, (*slot).handle);
            (*slot).handle = INVALID_HANDLE_VALUE;
            // A fresh instance waits for the next client before the owner
            // hears of this one.
            Inner::arm(this, slot);
            Inner::update_starved(this);
            let on_connection = (*this).on_connection;
            (*this).pins += 1;
            on_connection.invoke(pipe);
            (*this).pins -= 1;
            Inner::maybe_finish(this);
        }
    }
}
