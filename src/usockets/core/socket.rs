//! Safe `SocketHeader` / `Socket<'l>` / `SocketBox`.
//!
//! `SocketHeader` is the fixed-layout prefix every stream socket allocation
//! starts with; it is field-for-field identical to `us_socket_t` (`types.rs`)
//! so `*mut SocketHeader` and `*mut us_socket_t` are interchangeable across
//! the FFI boundary. Every mutable field is a `Cell` because dispatch holds
//! `&SocketHeader` while user callbacks may re-enter and call
//! `close()`/`set_timeout()`/`adopt()` on the same socket.

use core::cell::{Cell, UnsafeCell};
use core::ffi::c_void;
use core::marker::PhantomData;
use core::ptr::NonNull;

use crate::core::connecting::ConnectingSocket;
use crate::core::group::SocketGroup;
use crate::core::list::{Linked, ListLinks};
use crate::core::poll::Poll;
use crate::core::sys::Fd;
use crate::types::{Bun__outOfMemory, us_calloc, us_free, us_socket_t};

// ═══════════════════════════════════════════════════════════════════════════
// SocketFlags — 1-byte bitfield with interior mutability
// ═══════════════════════════════════════════════════════════════════════════

/// `struct us_socket_flags` (1 packed byte). Bit positions match the C
/// bitfield packing (LSB-first).
#[repr(transparent)]
pub struct SocketFlags(Cell<u8>);

impl SocketFlags {
    const IS_PAUSED: u8 = 1 << 0;
    const ALLOW_HALF_OPEN: u8 = 1 << 1;
    const LOW_PRIO_STATE_MASK: u8 = 0b0000_1100;
    const LOW_PRIO_STATE_SHIFT: u8 = 2;
    const IS_IPC: u8 = 1 << 4;
    const IS_CLOSED: u8 = 1 << 5;
    const ADOPTED: u8 = 1 << 6;
    const LAST_WRITE_FAILED: u8 = 1 << 7;

    #[inline]
    pub const fn new() -> Self {
        Self(Cell::new(0))
    }

    #[inline]
    pub fn is_paused(&self) -> bool {
        self.0.get() & Self::IS_PAUSED != 0
    }
    #[inline]
    pub fn set_is_paused(&self, v: bool) {
        self.set_bit(Self::IS_PAUSED, v)
    }
    #[inline]
    pub fn allow_half_open(&self) -> bool {
        self.0.get() & Self::ALLOW_HALF_OPEN != 0
    }
    #[inline]
    pub fn set_allow_half_open(&self, v: bool) {
        self.set_bit(Self::ALLOW_HALF_OPEN, v)
    }
    /// 0 = not queued, 1 = queued, 2 = was queued this iteration.
    #[inline]
    pub fn low_prio_state(&self) -> u8 {
        (self.0.get() & Self::LOW_PRIO_STATE_MASK) >> Self::LOW_PRIO_STATE_SHIFT
    }
    #[inline]
    pub fn set_low_prio_state(&self, v: u8) {
        self.0.set(
            (self.0.get() & !Self::LOW_PRIO_STATE_MASK)
                | ((v << Self::LOW_PRIO_STATE_SHIFT) & Self::LOW_PRIO_STATE_MASK),
        );
    }
    #[inline]
    pub fn is_ipc(&self) -> bool {
        self.0.get() & Self::IS_IPC != 0
    }
    #[inline]
    pub fn set_is_ipc(&self, v: bool) {
        self.set_bit(Self::IS_IPC, v)
    }
    #[inline]
    pub fn is_closed(&self) -> bool {
        self.0.get() & Self::IS_CLOSED != 0
    }
    #[inline]
    pub fn set_is_closed(&self, v: bool) {
        self.set_bit(Self::IS_CLOSED, v)
    }
    #[inline]
    pub fn adopted(&self) -> bool {
        self.0.get() & Self::ADOPTED != 0
    }
    #[inline]
    pub fn set_adopted(&self, v: bool) {
        self.set_bit(Self::ADOPTED, v)
    }
    #[inline]
    pub fn last_write_failed(&self) -> bool {
        self.0.get() & Self::LAST_WRITE_FAILED != 0
    }
    #[inline]
    pub fn set_last_write_failed(&self, v: bool) {
        self.set_bit(Self::LAST_WRITE_FAILED, v)
    }

    #[inline(always)]
    fn set_bit(&self, mask: u8, v: bool) {
        let cur = self.0.get();
        self.0.set(if v { cur | mask } else { cur & !mask });
    }
}

impl Default for SocketFlags {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SslBits — 11 bits of TLS state in the pad-to-pointer gap
// ═══════════════════════════════════════════════════════════════════════════

/// The `ssl_*` bitfields of `us_socket_t`. Bit positions match clang's
/// LSB-first packing (see `types.rs::us_socket_t::SSL_*`).
#[repr(transparent)]
pub struct SslBits(Cell<u16>);

impl SslBits {
    const HANDSHAKE_STATE_MASK: u16 = 0b0000_0000_0000_0011;
    const WRITE_WANTS_READ: u16 = 1 << 2;
    const READ_WANTS_WRITE: u16 = 1 << 3;
    const FATAL_ERROR: u16 = 1 << 4;
    const IS_SERVER: u16 = 1 << 5;
    const RAW_TAP: u16 = 1 << 6;
    const SHUTDOWN_AFTER_SPILL: u16 = 1 << 7;
    const CLOSE_AFTER_SPILL: u16 = 1 << 8;
    const IN_USE: u16 = 1 << 9;
    const PENDING_DETACH: u16 = 1 << 10;

    #[inline]
    pub const fn new() -> Self {
        Self(Cell::new(0))
    }

    #[inline]
    pub fn handshake_state(&self) -> u8 {
        (self.0.get() & Self::HANDSHAKE_STATE_MASK) as u8
    }
    #[inline]
    pub fn set_handshake_state(&self, v: u8) {
        self.0.set(
            (self.0.get() & !Self::HANDSHAKE_STATE_MASK)
                | (u16::from(v) & Self::HANDSHAKE_STATE_MASK),
        );
    }
    #[inline]
    pub fn write_wants_read(&self) -> bool {
        self.0.get() & Self::WRITE_WANTS_READ != 0
    }
    #[inline]
    pub fn set_write_wants_read(&self, v: bool) {
        self.set_bit(Self::WRITE_WANTS_READ, v)
    }
    #[inline]
    pub fn read_wants_write(&self) -> bool {
        self.0.get() & Self::READ_WANTS_WRITE != 0
    }
    #[inline]
    pub fn set_read_wants_write(&self, v: bool) {
        self.set_bit(Self::READ_WANTS_WRITE, v)
    }
    #[inline]
    pub fn fatal_error(&self) -> bool {
        self.0.get() & Self::FATAL_ERROR != 0
    }
    #[inline]
    pub fn set_fatal_error(&self, v: bool) {
        self.set_bit(Self::FATAL_ERROR, v)
    }
    #[inline]
    pub fn is_server(&self) -> bool {
        self.0.get() & Self::IS_SERVER != 0
    }
    #[inline]
    pub fn set_is_server(&self, v: bool) {
        self.set_bit(Self::IS_SERVER, v)
    }
    #[inline]
    pub fn raw_tap(&self) -> bool {
        self.0.get() & Self::RAW_TAP != 0
    }
    #[inline]
    pub fn set_raw_tap(&self, v: bool) {
        self.set_bit(Self::RAW_TAP, v)
    }
    #[inline]
    pub fn shutdown_after_spill(&self) -> bool {
        self.0.get() & Self::SHUTDOWN_AFTER_SPILL != 0
    }
    #[inline]
    pub fn set_shutdown_after_spill(&self, v: bool) {
        self.set_bit(Self::SHUTDOWN_AFTER_SPILL, v)
    }
    #[inline]
    pub fn close_after_spill(&self) -> bool {
        self.0.get() & Self::CLOSE_AFTER_SPILL != 0
    }
    #[inline]
    pub fn set_close_after_spill(&self, v: bool) {
        self.set_bit(Self::CLOSE_AFTER_SPILL, v)
    }
    #[inline]
    pub fn in_use(&self) -> bool {
        self.0.get() & Self::IN_USE != 0
    }
    #[inline]
    pub fn set_in_use(&self, v: bool) {
        self.set_bit(Self::IN_USE, v)
    }
    #[inline]
    pub fn pending_detach(&self) -> bool {
        self.0.get() & Self::PENDING_DETACH != 0
    }
    #[inline]
    pub fn set_pending_detach(&self, v: bool) {
        self.set_bit(Self::PENDING_DETACH, v)
    }

    #[inline(always)]
    fn set_bit(&self, mask: u16, v: bool) {
        let cur = self.0.get();
        self.0.set(if v { cur | mask } else { cur & !mask });
    }
}

impl Default for SslBits {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SocketHeader — layout-identical to `us_socket_t`
// ═══════════════════════════════════════════════════════════════════════════

/// Fixed-layout header. First field is [`Poll`] so `(&*s as *const Poll)` is
/// valid. Followed in memory by `ext_size` bytes of handler-specific storage
/// (see [`SocketBox::alloc`]).
#[repr(C, align(16))]
pub struct SocketHeader {
    pub(crate) poll: Poll,
    pub(crate) timeout: Cell<u8>,
    pub(crate) long_timeout: Cell<u8>,
    pub(crate) flags: SocketFlags,
    pub(crate) kind: Cell<u8>,
    pub(crate) ssl_bits: SslBits,
    pub(crate) ssl_pending_close_code: Cell<u8>,
    pub(crate) group: Cell<Option<NonNull<SocketGroup>>>,
    pub(crate) ssl: Cell<*mut bun_boringssl_sys::SSL>,
    pub(crate) links: ListLinks<SocketHeader>,
    pub(crate) connect_next: Cell<Option<NonNull<SocketHeader>>>,
    pub(crate) connect_state: Cell<Option<NonNull<ConnectingSocket>>>,
}

// SAFETY: `links` is an ordinary #[repr(C)] field; projecting `&raw mut
// (*p).links` stays in-bounds for any live `SocketHeader`.
unsafe impl Linked for SocketHeader {
    #[inline(always)]
    fn links(p: NonNull<Self>) -> NonNull<ListLinks<Self>> {
        // SAFETY: `p` is live per the `Linked` contract; field projection only.
        unsafe { NonNull::new_unchecked(&raw mut (*p.as_ptr()).links) }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SocketBox — the one unsafe alloc site (header + trailing ext)
// ═══════════════════════════════════════════════════════════════════════════

/// Owning handle for a `calloc`'d `SocketHeader` + `ext_size` trailing bytes.
/// Not `Drop` — sockets are deferred-freed via the loop's `closed_head` list,
/// so ownership always transits through [`into_raw`]/[`from_raw`].
#[repr(transparent)]
pub struct SocketBox(NonNull<SocketHeader>);

impl SocketBox {
    /// Allocate a zeroed `SocketHeader` with `ext_size` trailing bytes. The
    /// header is 16-byte aligned (`us_calloc` → libc `calloc`, which satisfies
    /// `LIBUS_EXT_ALIGNMENT` on every supported platform).
    pub fn alloc(ext_size: usize) -> SocketBox {
        let total = core::mem::size_of::<SocketHeader>() + ext_size;
        // SAFETY: `us_calloc` is libc `calloc`; any size is sound.
        let p = unsafe { us_calloc(1, total) }.cast::<SocketHeader>();
        let Some(p) = NonNull::new(p) else {
            // SAFETY: diverges.
            unsafe { Bun__outOfMemory() }
        };
        SocketBox(p)
    }

    /// Free a header previously returned by [`alloc`] / [`from_raw`].
    pub fn free(self) {
        // SAFETY: `self.0` was returned by `us_calloc`; `us_free` is libc `free`.
        unsafe { us_free(self.0.as_ptr().cast()) }
    }

    #[inline(always)]
    pub fn into_raw(self) -> NonNull<SocketHeader> {
        self.0
    }

    /// # Safety
    /// `p` must have been produced by [`SocketBox::alloc`] (or the FFI
    /// equivalent) and not already freed.
    #[inline(always)]
    pub unsafe fn from_raw(p: NonNull<SocketHeader>) -> SocketBox {
        SocketBox(p)
    }

    #[inline(always)]
    pub fn as_socket(&self) -> Socket<'_> {
        Socket(self.0, PhantomData)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Socket<'l> — borrowed handle, `Copy`, lifetime-bound to the loop tick
// ═══════════════════════════════════════════════════════════════════════════

/// Borrowed, `Copy` handle to a live socket for one loop tick. The `'l`
/// lifetime prevents a `Socket` from escaping the dispatch frame that
/// guarantees the allocation is still live (freeing is deferred to
/// `us_internal_free_closed_sockets` after dispatch returns).
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct Socket<'l>(NonNull<SocketHeader>, PhantomData<&'l ()>);

impl<'l> Socket<'l> {
    /// # Safety
    /// `p` must point at a live `SocketHeader` for at least `'l`.
    #[inline(always)]
    pub unsafe fn from_raw(p: NonNull<SocketHeader>) -> Self {
        Socket(p, PhantomData)
    }

    #[inline(always)]
    pub fn as_raw(self) -> NonNull<SocketHeader> {
        self.0
    }

    #[inline(always)]
    pub fn header(self) -> &'l SocketHeader {
        // SAFETY: `from_raw` contract — `self.0` is live for `'l`.
        unsafe { self.0.as_ref() }
    }

    /// Pointer to the trailing ext area (the bytes immediately after the header).
    #[inline(always)]
    pub fn ext_ptr(self) -> *mut c_void {
        // SAFETY: the header was allocated with trailing ext storage; `add(1)`
        // lands exactly on it.
        unsafe { self.0.as_ptr().add(1).cast() }
    }

    /// Typed view of the trailing ext area.
    ///
    /// # Safety
    /// Caller guarantees the socket was allocated with at least
    /// `size_of::<E>()` ext bytes and that `E` is the correct type for this
    /// socket's `kind`.
    #[inline(always)]
    pub unsafe fn ext<E>(self) -> &'l UnsafeCell<E> {
        // SAFETY: caller contract above; `UnsafeCell<E>` has the same layout as `E`.
        unsafe { &*self.ext_ptr().cast::<UnsafeCell<E>>() }
    }

    // ── Safe delegating accessors ───────────────────────────────────────────

    #[inline]
    pub fn is_closed(self) -> bool {
        self.header().flags.is_closed()
    }
    #[inline]
    pub fn fd(self) -> Fd {
        self.header().poll.fd()
    }
    #[inline]
    pub fn kind(self) -> u8 {
        self.header().kind.get()
    }
    #[inline]
    pub fn group(self) -> Option<NonNull<SocketGroup>> {
        self.header().group.get()
    }

    /// Seconds are bucketed to `LIBUS_TIMEOUT_GRANULARITY` (4s); 0 disables.
    #[inline]
    pub fn set_timeout(self, seconds: u32) {
        use crate::types::LIBUS_TIMEOUT_GRANULARITY as G;
        self.header().timeout.set(if seconds != 0 {
            seconds.div_ceil(G).min(u8::MAX as u32) as u8
        } else {
            u8::MAX
        });
    }

    /// Minutes are bucketed to 4-minute ticks; 0 disables.
    #[inline]
    pub fn set_long_timeout(self, minutes: u32) {
        use crate::types::LIBUS_TIMEOUT_GRANULARITY as G;
        self.header().long_timeout.set(if minutes != 0 {
            minutes.div_ceil(G).min(u8::MAX as u32) as u8
        } else {
            u8::MAX
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Layout assertions — SocketHeader must be ABI-identical to `us_socket_t`
// ═══════════════════════════════════════════════════════════════════════════

const _: () = {
    use core::mem::{align_of, offset_of, size_of};
    assert!(offset_of!(SocketHeader, poll) == 0);
    assert!(size_of::<SocketHeader>() == size_of::<us_socket_t>());
    assert!(align_of::<SocketHeader>() == align_of::<us_socket_t>());
    assert!(offset_of!(SocketHeader, group) == offset_of!(us_socket_t, group));
    assert!(offset_of!(SocketHeader, flags) == offset_of!(us_socket_t, flags));
    assert!(offset_of!(SocketHeader, ssl) == offset_of!(us_socket_t, ssl));
    assert!(offset_of!(SocketHeader, links) == offset_of!(us_socket_t, prev));
    assert!(size_of::<SocketFlags>() == 1);
    assert!(size_of::<SslBits>() == 2);
};
