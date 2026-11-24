//! What HTTP/1 connections and WebSockets write through. Derives from uWebSockets (LICENSE.md).

use core::cell::{Cell, RefCell};
use core::ffi::{c_int, c_void};
use core::ptr;

use bun_core::vec::{BorrowedCursor, append_with};
use bun_http1::queue::Queue;

use crate::loop_::LoopData;
use crate::{CloseCode, UsIoVec, us_socket_t};

const CORK_CAPACITY: usize = 128 * 1024;
/// A longer write goes out behind the corked bytes, in the same system call.
pub(crate) const MAX_CORKED_WRITE_LEN: usize = 16 * 1024;
const MAX_SEND_LEN: usize = c_int::MAX as usize;

struct CorkSlot {
    owner: Cell<*const AsyncSocket>,
    bytes: RefCell<Vec<u8>>,
}

impl CorkSlot {
    fn new() -> Self {
        Self {
            owner: Cell::new(ptr::null()),
            bytes: RefCell::new(Vec::with_capacity(CORK_CAPACITY)),
        }
    }

    fn len(&self) -> usize {
        self.bytes.borrow().len()
    }

    fn has_room(&self, len: usize) -> bool {
        CORK_CAPACITY - self.len() >= len
    }

    fn release(&self) {
        self.owner.set(ptr::null());
        self.bytes.borrow_mut().clear();
    }

    /// `send` gets what it held.
    fn release_into<R>(&self, send: impl FnOnce(&[u8]) -> R) -> R {
        self.owner.set(ptr::null());
        let result = send(&self.bytes.borrow());
        self.bytes.borrow_mut().clear();
        result
    }
}

/// Two, so that a response that resumes under the handler of another one is corked too.
pub(crate) struct CorkSlots {
    slots: [CorkSlot; 2],
    last_written: Cell<*const CorkSlot>,
}

impl CorkSlots {
    pub(crate) fn new() -> Self {
        Self {
            slots: [CorkSlot::new(), CorkSlot::new()],
            last_written: Cell::new(ptr::null()),
        }
    }

    fn find(&self, owner: *const AsyncSocket) -> Option<&CorkSlot> {
        self.slots.iter().find(|slot| slot.owner.get() == owner)
    }

    /// A free one, or one whose owner has written nothing.
    fn take(&self, owner: &AsyncSocket) -> Option<&CorkSlot> {
        let slot =
            (self.find(ptr::null())).or_else(|| self.slots.iter().find(|slot| slot.len() == 0))?;
        slot.owner.set(owner);
        Some(slot)
    }

    pub(crate) fn uncork_all(&self) {
        for slot in &self.slots {
            if !slot.owner.get().is_null() {
                AsyncSocket::opaque_ref(slot.owner.get()).uncork();
            }
        }
    }
}

/// What the ext of such a socket starts with. Never dropped: the close event empties it.
#[repr(C)]
#[derive(Default)]
pub(crate) struct SocketData {
    /// The `JSNodeHTTPServerSocket`.
    pub(crate) node_socket: Cell<*mut c_void>,
    unsent: RefCell<Queue>,
}

pub(crate) struct Written {
    /// Sent, corked or buffered.
    pub(crate) len: usize,
    /// A writable event follows.
    pub(crate) has_backpressure: bool,
}

impl Written {
    fn sent(len: usize) -> Self {
        Self {
            len,
            has_backpressure: false,
        }
    }

    fn stalled(len: usize) -> Self {
        Self {
            len,
            has_backpressure: true,
        }
    }
}

/// What becomes of the bytes that the socket does not take.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Rest {
    Buffer,
    LeaveToCaller,
}

/// What it takes to send appended bytes.
pub(crate) enum Appended {
    ToCork,
    ToNewCork,
    ToBuffer,
}

bun_opaque::opaque_ffi! { pub(crate) struct AsyncSocket; }

impl AsyncSocket {
    pub(crate) fn raw<'a>(&self) -> &'a mut us_socket_t {
        us_socket_t::opaque_mut(self.as_mut_ptr().cast())
    }

    pub(crate) fn data(&self) -> &SocketData {
        // SAFETY: written by the open event. No tick under a handler frees a socket that its caller uses again.
        unsafe { &*self.raw().ext_ptr().cast() }
    }

    pub(crate) fn loop_data<'a>(&self) -> &'a LoopData {
        // SAFETY: apps are on the loop of their thread, which outlives its sockets.
        unsafe { LoopData::of(self.raw().group().loop_.get()) }
    }

    fn cork_slot<'a>(&self) -> Option<&'a CorkSlot> {
        self.loop_data().cork_slots.find(self)
    }

    fn send(&self, bytes: &[u8]) -> usize {
        self.raw().write(bytes).max(0) as usize
    }

    pub(crate) fn close(&self) {
        self.uncork();
        self.raw().close(CloseCode::normal);
    }

    #[inline]
    pub(crate) fn cork(&self) {
        if !self.is_corked() {
            self.take_cork_slot();
        }
    }

    fn take_cork_slot(&self) {
        let corks = &self.loop_data().cork_slots;
        if corks.take(self).is_none() {
            let [first, second] = &corks.slots;
            let is_second_newer = ptr::eq(corks.last_written.get(), second);
            let older = if is_second_newer { first } else { second };
            Self::opaque_ref(older.owner.get()).uncork();
            corks.take(self);
        }
    }

    pub(crate) fn is_corked(&self) -> bool {
        self.cork_slot().is_some()
    }

    pub(crate) fn has_corked_bytes(&self) -> bool {
        self.cork_slot().is_some_and(|slot| slot.len() != 0)
    }

    /// It stays corked.
    pub(crate) fn send_corked(&self) {
        if self.has_corked_bytes() {
            self.uncork();
            self.cork();
        }
    }

    #[inline]
    pub(crate) fn uncork(&self) -> Written {
        match self.cork_slot() {
            Some(slot) => self.uncork_with(slot, b"", Rest::Buffer),
            None => Written::sent(0),
        }
    }

    pub(crate) fn uncork_without_sending(&self) {
        if let Some(slot) = self.cork_slot() {
            slot.release();
        }
    }

    /// The corked bytes only count if there are no others.
    fn uncork_with(&self, slot: &CorkSlot, bytes: &[u8], rest: Rest) -> Written {
        let next_len = if rest == Rest::Buffer { bytes.len() } else { 0 };
        let corked = slot.release_into(|corked| {
            (!corked.is_empty()).then(|| self.write_with(corked, Rest::Buffer, next_len))
        });
        match corked {
            Some(corked) if corked.has_backpressure && rest == Rest::LeaveToCaller => {
                Written::stalled(0)
            }
            Some(corked) if bytes.is_empty() => corked,
            _ => self.write_with(bytes, rest, 0),
        }
    }

    pub(crate) fn buffered_amount(&self) -> usize {
        self.data().unsent.borrow().len()
    }

    pub(crate) fn buffer_capacity(&self) -> usize {
        self.data().unsent.borrow().capacity()
    }

    pub(crate) fn buffer(&self, bytes: &[u8]) {
        self.data().unsent.borrow_mut().append(bytes);
    }

    pub(crate) fn clear_buffer(&self) {
        self.data().unsent.take();
    }

    /// TLS can hold back records of what it has taken.
    pub(crate) fn has_fully_drained(&self) -> bool {
        self.buffered_amount() == 0 && !self.raw().has_ssl_spill()
    }

    fn send_buffered(&self) -> usize {
        let unsent = &self.data().unsent;
        let sent = self.send(unsent.borrow().as_slice());
        unsent.borrow_mut().erase(sent);
        sent
    }

    /// Returns how much of the buffer was sent.
    pub(crate) fn flush(&self) -> usize {
        let mut total = 0;
        while !self.raw().is_closed() && self.buffered_amount() != 0 {
            let sent = self.send_buffered();
            total += sent;
            if sent < MAX_SEND_LEN {
                break;
            }
        }
        total
    }

    /// `fill` has room for `len` bytes, behind all that is unsent.
    pub(crate) fn append(&self, len: usize, fill: impl FnOnce(BorrowedCursor<'_, u8>)) -> Appended {
        let corks = &self.loop_data().cork_slots;
        let corked = corks.find(self);
        if self.buffered_amount() == 0
            && corked.map_or(len <= CORK_CAPACITY, |slot| slot.has_room(len))
            && let Some(slot) = corked.or_else(|| corks.take(self))
        {
            corks.last_written.set(slot);
            append_with(&mut slot.bytes.borrow_mut(), len, fill);
            return match corked {
                Some(_) => Appended::ToCork,
                None => Appended::ToNewCork,
            };
        }
        let mut unsent = self.data().unsent.borrow_mut();
        let unsent = unsent.reserve(corked.map_or(0, CorkSlot::len) + len);
        if let Some(slot) = corked {
            unsent.append(&mut slot.bytes.borrow_mut());
        }
        append_with(unsent, len, fill);
        Appended::ToBuffer
    }

    /// `None` if `len` bytes cannot be corked.
    pub(crate) fn append_to_cork<R>(
        &self,
        len: usize,
        fill: impl FnOnce(&mut Vec<u8>) -> R,
    ) -> Option<R> {
        if !(1..=MAX_CORKED_WRITE_LEN).contains(&len)
            || self.raw().is_closed()
            || self.buffered_amount() != 0
        {
            return None;
        }
        let corks = &self.loop_data().cork_slots;
        let slot = corks.find(self).filter(|slot| slot.has_room(len))?;
        corks.last_written.set(slot);
        Some(fill(&mut slot.bytes.borrow_mut()))
    }

    fn cork_all<const N: usize>(&self, parts: [&[u8]; N]) -> bool {
        let len = parts.iter().map(|part| part.len()).sum();
        let fill = |mut out: BorrowedCursor<'_, u8>| parts.iter().for_each(|part| out.append(part));
        (self.append_to_cork(len, |corked| append_with(corked, len, fill))).is_some()
    }

    pub(crate) fn write_all<const N: usize>(&self, parts: [&[u8]; N]) {
        if !self.cork_all(parts) {
            self.write_each(&parts);
        }
    }

    fn write_each(&self, parts: &[&[u8]]) {
        for part in parts {
            self.write(part);
        }
    }

    pub(crate) fn write(&self, bytes: &[u8]) -> Written {
        self.write_with(bytes, Rest::Buffer, 0)
    }

    /// To the cork, the kernel or the buffer. `next_len` bytes are going to follow.
    pub(crate) fn write_with(&self, bytes: &[u8], rest: Rest, next_len: usize) -> Written {
        if self.raw().is_closed() {
            return Written::sent(bytes.len());
        }
        if self.buffered_amount() != 0 {
            self.send_buffered();
            if self.buffered_amount() != 0 {
                return self.stall(bytes, 0, rest, 0);
            }
        }
        if bytes.is_empty() {
            return Written::sent(0);
        }
        let corks = &self.loop_data().cork_slots;
        if let Some(slot) = corks.find(self) {
            if bytes.len() > MAX_CORKED_WRITE_LEN || !slot.has_room(bytes.len()) {
                return self.write_framed_past_cork(b"", bytes, b"", rest);
            }
            slot.bytes.borrow_mut().extend_from_slice(bytes);
            corks.last_written.set(slot);
            return Written::sent(bytes.len());
        }
        if bytes.len() > MAX_SEND_LEN {
            return self.write_in_pieces(bytes, rest);
        }
        match self.send(bytes) {
            sent if sent < bytes.len() => self.stall(bytes, sent, rest, next_len),
            sent => Written::sent(sent),
        }
    }

    fn stall(&self, bytes: &[u8], sent: usize, rest: Rest, next_len: usize) -> Written {
        if rest == Rest::LeaveToCaller {
            return Written::stalled(sent);
        }
        let mut unsent = self.data().unsent.borrow_mut();
        (unsent.reserve(bytes.len() - sent + next_len)).extend_from_slice(&bytes[sent..]);
        Written::stalled(bytes.len())
    }

    #[cold]
    fn write_in_pieces(&self, bytes: &[u8], rest: Rest) -> Written {
        let mut sent = 0;
        // The corked bytes go with the first one.
        for piece in bytes.chunks(MAX_SEND_LEN - CORK_CAPACITY) {
            let len = self.write_with(piece, Rest::LeaveToCaller, 0).len;
            sent += len;
            if len < piece.len() {
                return self.stall(bytes, sent, rest, 0);
            }
        }
        Written::sent(sent)
    }

    /// In one system call if they cannot be corked. `rest` and the result are about `body`, and `tail` only follows all of it.
    #[inline]
    pub(crate) fn write_framed(
        &self,
        head: &[u8],
        body: &[u8],
        tail: &[u8],
        rest: Rest,
    ) -> Written {
        if !body.is_empty() && self.cork_all([head, body, tail]) {
            return Written::sent(body.len());
        }
        self.write_framed_past_cork(head, body, tail, rest)
    }

    fn write_framed_past_cork(&self, head: &[u8], body: &[u8], tail: &[u8], rest: Rest) -> Written {
        let slot = self.cork_slot();
        let framing_len = head.len() + tail.len();
        let fits_cork = body.len() <= MAX_CORKED_WRITE_LEN
            && slot.is_some_and(|slot| slot.has_room(body.len() + framing_len));
        if !fits_cork
            && body.len() <= MAX_SEND_LEN - CORK_CAPACITY - framing_len
            && self.buffered_amount() == 0
            && !self.raw().is_closed()
        {
            let send = |corked: &[u8]| self.send_framed(corked, head, body, tail, rest);
            return match slot {
                Some(slot) => slot.release_into(send),
                None => send(b""),
            };
        }

        if !head.is_empty() {
            self.write(head);
        }
        let mut written = if body.len() > MAX_SEND_LEN {
            self.write_in_pieces(body, rest)
        } else if let Some(slot) = slot.filter(|_| framing_len == 0 && !fits_cork) {
            // `write_with` would come back here.
            self.uncork_with(slot, body, rest)
        } else {
            self.write_with(body, rest, 0)
        };
        if !tail.is_empty() && written.len == body.len() {
            written.has_backpressure |= self.write(tail).has_backpressure;
        }
        written
    }

    fn send_framed(
        &self,
        corked: &[u8],
        head: &[u8],
        body: &[u8],
        tail: &[u8],
        rest: Rest,
    ) -> Written {
        let parts = [
            (corked, Rest::Buffer),
            (head, Rest::Buffer),
            (body, rest),
            (tail, Rest::Buffer),
        ];
        let (mut iov, mut count) = ([UsIoVec::new(b""); 4], 0);
        for (part, _) in parts.iter().filter(|(part, _)| !part.is_empty()) {
            iov[count] = UsIoVec::new(part);
            count += 1;
        }
        let mut left = self.raw().writev(&iov[..count]).max(0) as usize;
        let mut written = Written::sent(body.len());
        for (part, rest) in parts {
            let sent = left.min(part.len());
            left -= sent;
            if sent < part.len() {
                if rest == Rest::LeaveToCaller {
                    return Written::stalled(sent);
                }
                self.buffer(&part[sent..]);
                written.has_backpressure = true;
            }
        }
        written
    }
}
