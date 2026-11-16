//! The ext word of an HTTP-thread socket.

use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::{self, NonNull};

use bun_ptr::AliasableBox;

use crate::http_context::{HTTPSocket, HttpContextId, Transport};
use crate::{AsyncHTTP, HTTPThread, InFlightRequest, h2};

/// Null, a request, or integers with a tag in the bits that the alignment of a request leaves free.
#[repr(transparent)]
pub(crate) struct ExtSlot(Cell<*mut c_void>);

const SESSION: usize = 0b01;
const POOLED: usize = 0b10;
const _: () = assert!(align_of::<AsyncHTTP>() > SESSION | POOLED);

/// What the slot of a socket names when it does not hold a request.
#[derive(Clone, Copy)]
pub(crate) enum ActiveSocket {
    Dead,
    Pooled(PoolSlot),
    /// In `HTTPThread::active_h2_sessions`.
    Session(u32),
}

impl ActiveSocket {
    pub(crate) fn take_session(self, thread: &mut HTTPThread) -> Option<Box<h2::ClientSession>> {
        match self {
            Self::Session(index) => thread.active_h2_sessions.take(index),
            _ => None,
        }
    }
}

impl ExtSlot {
    pub(crate) fn of<const SSL: bool>(socket: &HTTPSocket<SSL>) -> Option<&ExtSlot> {
        // SAFETY: every HTTP-thread socket has one word of ext, which only this function reaches.
        // uSockets frees a closed socket only between two ticks.
        socket.ext().map(|slot| unsafe { &*slot })
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.0.get().is_null()
    }

    pub(crate) fn put_request(&self, request: InFlightRequest) {
        debug_assert!(self.is_empty());
        self.0.set(request.into_non_null().as_ptr().cast());
    }

    /// `Err` is what the slot holds instead of a request.
    pub(crate) fn take_request(&self) -> Result<InFlightRequest, ActiveSocket> {
        let ext = self.0.get();
        if ext.addr() & (SESSION | POOLED) != 0 {
            return Err(match self.session() {
                Some(index) => ActiveSocket::Session(index),
                None => ActiveSocket::Pooled(PoolSlot::from_ext(ext.addr())),
            });
        }
        let http = NonNull::new(ext.cast()).ok_or(ActiveSocket::Dead)?;
        self.0.set(ptr::null_mut());
        // SAFETY: only `put_request` writes neither null nor a tag, and the slot has given it up.
        // uSockets copies the slot of a connecting socket to each candidate, and then dispatches
        // either to the connecting socket or, once that is freed, to the one candidate that opened.
        // No timer is armed on a connecting socket, and `on_open` replaces the abort tracker's handle to it.
        let http = unsafe { AliasableBox::from_non_null(http) };
        Ok(InFlightRequest::new(http))
    }

    pub(crate) fn session(&self) -> Option<u32> {
        let ext = self.0.get().addr();
        (ext & SESSION != 0).then_some((ext >> 32) as u32)
    }

    pub(crate) fn set(&self, active: ActiveSocket) {
        debug_assert!(self.is_empty() != matches!(active, ActiveSocket::Dead));
        self.0.set(ptr::without_provenance_mut(match active {
            ActiveSocket::Dead => 0,
            ActiveSocket::Pooled(slot) => slot.to_ext(),
            ActiveSocket::Session(index) => (index as usize) << 32 | SESSION,
        }));
    }
}

#[derive(Clone, Copy)]
pub(crate) struct PoolSlot {
    pub(crate) context: HttpContextId,
    pub(crate) transport: Transport,
    pub(crate) index: usize,
}

impl PoolSlot {
    const UNIX: usize = 0b100;

    fn to_ext(self) -> usize {
        let transport = match self.transport {
            Transport::Tcp => 0,
            Transport::Unix => Self::UNIX,
        };
        (self.context.0 as usize) << 16 | self.index << 8 | transport | POOLED
    }

    fn from_ext(ext: usize) -> Self {
        Self {
            context: HttpContextId((ext >> 16) as u32),
            transport: match ext & Self::UNIX {
                0 => Transport::Tcp,
                _ => Transport::Unix,
            },
            index: usize::from((ext >> 8) as u8),
        }
    }
}
