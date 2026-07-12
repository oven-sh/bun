//! Connecting state machine: DNS bridge + happy-eyeballs (4 concurrent,
//! interleaved families) + cancel/tombstone. Implements docs/semantics.md §6
//! and the DNS-bridge contract C13 (docs/design.md).

use core::ffi::{c_int, c_void};

use crate::dispatch;
use crate::group::SocketGroup;
use crate::kind::SocketKind;
use crate::loop_::Loop;
use crate::socket::us_socket_t;
use crate::tls::context::{self, SslCtx};
use crate::unsafe_core::ext::{deref_mut, header_mut};
use crate::unsafe_core::ffi;
use crate::unsafe_core::io;

/// R6.7 (context.c:27): simultaneous happy-eyeballs attempts; the resolver
/// interleaves AAAA/A so the first 4 alternate families. No per-attempt delay.
pub(crate) const CONCURRENT_CONNECTIONS: usize = 4;

/// Opaque `dns_jsc::Request` — owned by the process-wide DNS cache; we hold
/// one refcount from `Bun__addrinfo_get` until `Bun__addrinfo_freeRequest`.
#[repr(C)]
pub struct AddrinfoRequest {
    _opaque: [u8; 0],
}

/// Borrowed view of `dns_jsc::RequestResult` — layout frozen
/// `{ info: ?*ResultEntry, err: c_int }`; entry memory lives in the request's
/// result buffer until `freeRequest` (never freed through this view).
#[repr(C)]
pub(crate) struct AddrinfoResult {
    /// Head of the `ai_next` chain (a ResultEntry starts with its addrinfo).
    pub(crate) info: *mut bun_dns::addrinfo,
    pub(crate) err: c_int,
}

/// Connect in flight (DNS / non-blocking connect / happy-eyeballs); no I/O.
/// The loop promotes it to a `SocketHeader` + on_open on success, or fires
/// on_connecting_error on failure. Lives in the per-loop slab like sockets;
/// referenced externally only through `handle::ConnectingRef`.
pub struct ConnectingSocket {
    pub(crate) kind: SocketKind,
    pub(crate) group: *mut SocketGroup,
    /// Captured at create; survives group detach so the late after_resolve /
    /// dns_callback / free path never derefs freed owner storage (R6.1).
    pub(crate) loop_: *mut Loop,
    /// DNS cache request; one refcount held while non-null (R6.5).
    pub(crate) addrinfo_req: *mut AddrinfoRequest,
    /// Borrowed SSL_CTX, up_ref'd while in flight; attached only to the
    /// winning attempt, unref'd at detach (R6.9/R6.11).
    pub(crate) ssl_ctx: *mut SslCtx,
    pub(crate) options: c_int,
    pub(crate) port: u16,
    /// Raw getaddrinfo rc; 0 if the failure was past resolution. Non-zero is
    /// the `error_is_dns` tag — `error` then holds the same rc, a different
    /// namespace that overlaps errnos numerically (R6.6, R6.13).
    pub(crate) dns_error: i32,
    /// errno namespace (unless `dns_error != 0`).
    pub(crate) error: i32,
    pub(crate) closed: bool,
    pub(crate) shut_down: bool,
    pub(crate) shut_down_read: bool,
    /// Set until after_resolve runs or a successful cancel; while set, exactly
    /// one of {request notify list, loop dns_ready list} owns `self` (C13).
    pub(crate) pending_resolve_callback: bool,
    /// Timeout bytes copied onto attempt children (C9).
    pub(crate) timeout: u8,
    pub(crate) long_timeout: u8,
    /// dns_ready / closed_connecting intrusive link — never both at once;
    /// drain saves the next pointer before after_resolve can free (R6.11).
    pub(crate) next: *mut ConnectingSocket,
    /// `group.head_connecting_sockets` doubly-linked list (R3.11).
    pub(crate) prev_pending: *mut ConnectingSocket,
    pub(crate) next_pending: *mut ConnectingSocket,
    /// Cursor into the resolved `ai_next` chain (borrows the request buffer).
    pub(crate) addrinfo_head: *mut bun_dns::addrinfo,
    /// In-flight attempt sockets; top-up rules keep the live count ≤ 4 (R6.7).
    pub(crate) attempts: [*mut us_socket_t; CONCURRENT_CONNECTIONS],
    /// One 8-byte owner word, same layout rule as socket ext.
    pub(crate) ext: *mut c_void,
}

impl ConnectingSocket {
    /// Cancellation: dispatches on_connecting_error synchronously; ext-null
    /// means silent no-op (C4). Cancel is linearized against DNS completion
    /// (C13); `&mut self` surface — every
    /// in-crate caller uses [`close_raw`] (C17 re-entry + pending window).
    pub fn close(&mut self) {
        close_raw(self);
    }

    pub fn group(&mut self) -> *mut SocketGroup {
        self.group
    }

    pub fn raw_group(&self) -> *mut SocketGroup {
        self.group
    }

    pub fn kind(&self) -> SocketKind {
        self.kind
    }

    pub fn r#loop(&self) -> *mut Loop {
        self.loop_
    }

    /// The 8-byte ext word IS the storage (`T` is typically `ExtSlot<Owner>`).
    pub fn ext<T>(&mut self) -> &mut T {
        const {
            assert!(
                core::mem::size_of::<T>() <= core::mem::size_of::<*mut c_void>()
                    && core::mem::align_of::<T>() <= core::mem::align_of::<*mut c_void>(),
                "connecting ext type must fit the 8-byte ext word"
            );
        }
        deref_mut(core::ptr::from_mut(&mut self.ext).cast::<T>())
    }

    /// errno.
    pub fn get_error(&self) -> i32 {
        self.error
    }

    /// Raw getaddrinfo rc; 0 if the failure was past resolution.
    pub fn get_dns_error(&self) -> i32 {
        self.dns_error
    }

    /// `(void*)-1` for connecting sockets (R3.24, R6.13).
    pub fn get_native_handle(&self) -> *mut c_void {
        usize::MAX as *mut c_void
    }

    pub fn is_closed(&self) -> bool {
        self.closed
    }

    pub fn is_shutdown(&self) -> bool {
        self.shut_down
    }

    /// Minute wheel; copied onto attempt children. OQ-5: the sweep never
    /// walks connecting sockets, so the bucket is inert until attempts exist.
    pub fn long_timeout(&mut self, minutes: u32) {
        long_timeout_raw(self, minutes);
    }

    /// Seconds wheel; copied onto attempt children. OQ-5 as above.
    pub fn timeout(&mut self, seconds: u32) {
        timeout_raw(self, seconds);
    }

    /// Latched bit consumed after promotion by the embedder (R6.13).
    pub fn shutdown(&mut self) {
        self.shut_down = true;
    }

    pub fn shutdown_read(&mut self) {
        self.shut_down_read = true;
    }
}

// ── raw-place handle surface (loop thread, possibly-pending nodes) ───────────
// While `pending_resolve_callback` is set the resolver thread touches `c.next`
// and `c.loop_`, so consumer entry points (handle.rs, group close_all) must
// not form `&`/`&mut ConnectingSocket`; they route through these (C13, R6.5).

pub(crate) fn is_closed_raw(c: *mut ConnectingSocket) -> bool {
    ffi::conn_closed(c)
}

pub(crate) fn is_shutdown_raw(c: *mut ConnectingSocket) -> bool {
    ffi::conn_shut_down(c)
}

pub(crate) fn get_error_raw(c: *mut ConnectingSocket) -> i32 {
    ffi::conn_error(c)
}

pub(crate) fn get_dns_error_raw(c: *mut ConnectingSocket) -> i32 {
    ffi::conn_dns_error(c)
}

pub(crate) fn shutdown_raw(c: *mut ConnectingSocket) {
    ffi::conn_set_shut_down(c, true);
}

pub(crate) fn shutdown_read_raw(c: *mut ConnectingSocket) {
    ffi::conn_set_shut_down_read(c, true);
}

pub(crate) fn group_raw(c: *mut ConnectingSocket) -> *mut SocketGroup {
    ffi::conn_group(c)
}

/// Place pointer of the 8-byte ext word.
pub(crate) fn ext_place_raw(c: *mut ConnectingSocket) -> *mut *mut c_void {
    ffi::conn_ext_place(c)
}

pub(crate) fn set_ext_raw(c: *mut ConnectingSocket, ext: *mut c_void) {
    ffi::conn_set_ext(c, ext);
}

/// Seconds wheel. No-op once detached (group NULL'd by the cannot-cancel
/// tombstone, R6.10 step 4) — C null-derefs here; divergence kept deliberate.
pub(crate) fn timeout_raw(c: *mut ConnectingSocket, seconds: u32) {
    let group = ffi::conn_group(c);
    if group.is_null() {
        return;
    }
    let byte = if seconds != 0 {
        // wrapping: C parity for seconds near u32::MAX (R6.13).
        ((u32::from(deref_mut(group).timestamp).wrapping_add(seconds.wrapping_add(3) >> 2)) % 240)
            as u8
    } else {
        255
    };
    ffi::conn_set_timeout(c, byte);
}

/// Minute wheel; same detach guard as [`timeout_raw`].
pub(crate) fn long_timeout_raw(c: *mut ConnectingSocket, minutes: u32) {
    let group = ffi::conn_group(c);
    if group.is_null() {
        return;
    }
    let byte = if minutes != 0 {
        (u32::from(deref_mut(group).long_timestamp).wrapping_add(minutes) % 240) as u8
    } else {
        255
    };
    ffi::conn_set_long_timeout(c, byte);
}

// ── creation (slow path of SocketGroup::connect, R6.2 step 4) ────────────────

/// Allocate + register a connecting socket for an unresolved / multi-address /
/// cached-error host. Holds one loop keep-alive until exactly one of
/// after_resolve / close-cancel / close-tombstone balances it (C13).
pub(crate) fn create(
    group: *mut SocketGroup,
    kind: SocketKind,
    ssl_ctx: *mut SslCtx,
    addrinfo_req: *mut AddrinfoRequest,
    port: u16,
    options: c_int,
) -> *mut ConnectingSocket {
    let loop_ = deref_mut(group).loop_;
    if !ssl_ctx.is_null() {
        context::ssl_ctx_up_ref(ssl_ctx);
    }
    let c = crate::loop_::alloc_connecting(
        loop_,
        ConnectingSocket {
            kind,
            group,
            loop_,
            addrinfo_req,
            ssl_ctx,
            options,
            port,
            dns_error: 0,
            error: 0,
            closed: false,
            shut_down: false,
            shut_down_read: false,
            pending_resolve_callback: true,
            timeout: 255,
            long_timeout: 255,
            next: core::ptr::null_mut(),
            prev_pending: core::ptr::null_mut(),
            next_pending: core::ptr::null_mut(),
            addrinfo_head: core::ptr::null_mut(),
            attempts: [core::ptr::null_mut(); CONCURRENT_CONNECTIONS],
            ext: core::ptr::null_mut(),
        },
    );
    crate::group::link_connecting_socket(group, c);
    keepalive_inc(loop_);
    // May enqueue onto dns_ready (non-wakeup) if already resolved; never
    // re-enters this thread's stack (R6.5).
    ffi::addrinfo_set(addrinfo_req, c);
    c
}

// ── DNS completion enqueue (resolver side of C13) ────────────────────────────

/// Same-thread completion enqueue: push onto `dns_ready_head` under the loop
/// mutex; does NOT wake the loop (loop.c:324-331). Exported to the resolver as
/// `us_internal_dns_callback` via cabi.rs (DNS-bridge contract C13).
pub(crate) fn dns_callback(c: *mut ConnectingSocket) {
    let loop_ = ffi::connecting_loop(c);
    ffi::dns_ready_push(loop_, c);
}

/// Cross-thread completion enqueue: same + wakeup (loop.c:336-340). Exported
/// as `us_internal_dns_callback_threadsafe` via cabi.rs.
pub(crate) fn dns_callback_threadsafe(c: *mut ConnectingSocket) {
    let loop_ = ffi::connecting_loop(c);
    ffi::dns_ready_push(loop_, c);
    crate::loop_::wakeup::us_wakeup_loop(loop_);
}

/// Drain `loop.data.dns_ready_head` (resolved connects queued off-thread):
/// start the happy-eyeballs attempt fan-out. Runs in loop pre AND post per
/// docs/semantics.md §1; non-wakeup vs threadsafe enqueue rules per C13.
pub(crate) fn drain_dns_ready(loop_: *mut Loop) {
    let mut c = ffi::dns_ready_take(loop_);
    while !c.is_null() {
        // after_resolve may repurpose `next` for the closed list (R6.11).
        let next = deref_mut(c).next;
        after_resolve(c);
        c = next;
    }
}

/// R6.6 (context.c:702-745).
fn after_resolve(c: *mut ConnectingSocket) {
    {
        let cm = deref_mut(c);
        cm.pending_resolve_callback = false;
        if cm.closed {
            // close_all()/close raced the queued callback; group may be gone
            // (NULL'd at detach) and the keep-alive was balanced there (R6.6).
            if !cm.addrinfo_req.is_null() {
                ffi::addrinfo_free_request(cm.addrinfo_req, false);
                cm.addrinfo_req = core::ptr::null_mut();
            }
            free_connecting(c);
            return;
        }
        keepalive_dec(cm.loop_);
        debug_assert!(!cm.addrinfo_req.is_null());
        let (entries, err) = ffi::addrinfo_result(cm.addrinfo_req);
        if err != 0 {
            // Preserve the resolver failure (ENOTFOUND, ...) instead of the
            // fabricated ECONNABORTED; tag the namespace (R6.6).
            cm.error = err;
            cm.dns_error = err;
            close_raw(c);
            return;
        }
        cm.addrinfo_head = entries;
    }
    let opened = start_connections(c, CONCURRENT_CONNECTIONS);
    if opened == 0 {
        // A real connect failure must not read as caller abort (R6.6).
        deref_mut(c).error = libc::ECONNREFUSED;
        close_raw(c);
    }
}

/// R6.7 (context.c:665-700): walk the resolved-address cursor, opening up to
/// `count` SEMI_SOCKET attempts. Syscall/registration failure skips to the
/// next address. No local bind on this path.
fn start_connections(c: *mut ConnectingSocket, count: usize) -> usize {
    let mut opened = 0usize;
    loop {
        let cm = deref_mut(c);
        let info = cm.addrinfo_head;
        if info.is_null() || opened >= count {
            break;
        }
        cm.addrinfo_head = ffi::addrinfo_next(info);
        let addr = io::addr_from_entry(info, cm.port);
        let (group, kind, options) = (cm.group, cm.kind, cm.options);
        let s = crate::group::connect_attempt(group, kind, &addr, options, c);
        if s.is_null() {
            continue;
        }
        opened += 1;
        let cm = deref_mut(c);
        let sm = header_mut(s);
        sm.timeout = cm.timeout;
        sm.long_timeout = cm.long_timeout;
        sm.ext = cm.ext;
        attempts_push(cm, s);
    }
    opened
}

// ── per-attempt outcome (called from socket::on_connect, R6.9) ───────────────

/// Error arm of `us_internal_socket_after_open` for a happy-eyeballs attempt:
/// drop the loser, top up (1 while another attempt survives, a full burst of
/// 4 when none do), and report ECONNREFUSED only when every address failed.
pub(crate) fn attempt_failed(c: *mut ConnectingSocket, s: *mut us_socket_t) {
    attempts_remove(deref_mut(c), s);
    // SEMI_SOCKET close dispatches nothing (C1); RESET matches context.c:775.
    header_mut(s).close(crate::handle::CloseCode::failure);

    let remaining = attempts_count(deref_mut(c));
    if remaining <= 1 {
        let opened = start_connections(
            c,
            if remaining == 0 {
                CONCURRENT_CONNECTIONS
            } else {
                1
            },
        );
        if opened == 0 && attempts_count(deref_mut(c)) == 0 {
            deref_mut(c).error = libc::ECONNREFUSED;
            close_raw(c);
        }
    }
}

/// Success arm, part 1: close every losing sibling with RESET and hand back
/// the staged `SSL_CTX` (still owned by `c`) so the caller attaches it to the
/// winner BEFORE `finish_promotion` drops c's ref (R6.9 ordering).
pub(crate) fn promote_winner(c: *mut ConnectingSocket, winner: *mut us_socket_t) -> *mut SslCtx {
    let cm = deref_mut(c);
    let attempts = core::mem::replace(
        &mut cm.attempts,
        [core::ptr::null_mut(); CONCURRENT_CONNECTIONS],
    );
    let ssl_ctx = cm.ssl_ctx;
    for s in attempts {
        if !s.is_null() && s != winner {
            header_mut(s).close(crate::handle::CloseCode::failure);
        }
    }
    ssl_ctx
}

/// Success arm, part 2: release the DNS request (no cache invalidation) and
/// defer-free `c`. Caller clears the winner's connect_state and fires on_open
/// afterwards — exactly one of {on_open, on_connect_error,
/// on_connecting_error} terminates a connect (C2, R6.12).
pub(crate) fn finish_promotion(c: *mut ConnectingSocket) {
    let cm = deref_mut(c);
    // Owner-ref transfer: the winner's header ext now carries the owned word.
    // Null + mark closed so the consumer's still-live Connecting handle can't
    // release (detach_owner) or re-terminate (close) the same ref again.
    cm.ext = core::ptr::null_mut();
    cm.closed = true;
    if !cm.addrinfo_req.is_null() {
        ffi::addrinfo_free_request(cm.addrinfo_req, false);
        cm.addrinfo_req = core::ptr::null_mut();
    }
    free_connecting(c);
}

// ── close / tombstone / deferred free (R6.10, R6.11) ─────────────────────────

/// `us_connecting_socket_close` (socket.c:192-255). Idempotent. Raw-pointer
/// entry — no `&`/`&mut ConnectingSocket` is ever formed here: the dispatch
/// may synchronously re-enter through an aliasing handle (C17), and on the
/// cannot-cancel path the resolver may be publishing `c.next` concurrently.
/// ALL in-crate callers (group close_all, handle close) must use this.
pub(crate) fn close_raw(c: *mut ConnectingSocket) {
    if ffi::conn_closed(c) {
        return;
    }
    ffi::conn_set_closed(c, true);
    for s in ffi::conn_take_attempts(c) {
        if !s.is_null() {
            // Direct fd teardown — deliberately NOT the close path; no
            // dispatch, no linger RST (R6.10 step 2).
            crate::socket::teardown_connecting_attempt(s);
        }
    }

    if ffi::conn_error(c) == 0 {
        // No error means the caller aborted us (socket.c:209-212).
        ffi::conn_set_error(c, libc::ECONNABORTED);
    }
    let req = ffi::conn_addrinfo_req(c);
    let loop_ = ffi::connecting_loop(c);
    let error = ffi::conn_error(c);

    if ffi::conn_pending(c) {
        // create() sets pending and the request together; pending ⇒ req ≠ 0
        // or the cannot-cancel arm below would leak `c` forever.
        debug_assert!(!req.is_null());
        if !req.is_null() && ffi::addrinfo_cancel(req, c) {
            // Removed from the notify list before it fired: the callback will
            // never run, so finish teardown here (C13 linearization).
            keepalive_dec(loop_);
            ffi::conn_set_pending(c, false);
            ffi::conn_set_addrinfo_req(c, core::ptr::null_mut());
            ffi::addrinfo_free_request(req, false);
            dispatch::dispatch_connecting_error(c, error);
            free_connecting(c);
        } else {
            // Can't cancel — the resolve callback is already queued. Detach
            // from the group NOW so the owner can deinit; after_resolve will
            // see `closed` and finish without touching the group. Balance the
            // keep-alive here for the same reason (socket.c:229-243).
            keepalive_dec(loop_);
            dispatch::dispatch_connecting_error(c, error);
            detach(c);
        }
        return;
    }

    if !req.is_null() {
        // Invalidate the cache entry for a refused connect (addresses may be
        // stale) and for a resolver failure (never cache a negative result).
        ffi::conn_set_addrinfo_req(c, core::ptr::null_mut());
        let invalidate = error == libc::ECONNREFUSED || ffi::conn_dns_error(c) != 0;
        ffi::addrinfo_free_request(req, invalidate);
    }
    dispatch::dispatch_connecting_error(c, error);
    free_connecting(c);
}

/// `us_internal_connecting_socket_detach` (socket.c:170-182): group unlink +
/// drop the borrowed SSL_CTX ref; leaves `c` allocated (only remaining link is
/// a loop-owned list). Raw field access only — runs inside the cannot-cancel
/// race window (see [`close_raw`]).
fn detach(c: *mut ConnectingSocket) {
    let group = ffi::conn_group(c);
    if !group.is_null() {
        crate::group::unlink_connecting_socket(group, c);
        ffi::conn_set_group(c, core::ptr::null_mut());
    }
    let ssl_ctx = ffi::conn_ssl_ctx(c);
    if !ssl_ctx.is_null() {
        context::ssl_ctx_unref(ssl_ctx);
        ffi::conn_set_ssl_ctx(c, core::ptr::null_mut());
    }
}

/// `us_connecting_socket_free` (socket.c:184-190): never frees inline — `c`
/// may still sit on the dns_ready list; the tick postlude releases the slab
/// slot from `closed_connecting_head` (C6, R1.15).
fn free_connecting(c: *mut ConnectingSocket) {
    detach(c);
    ffi::closed_connecting_push(ffi::connecting_loop(c), c);
}

// ── loop keep-alive during resolve (R6.2/R6.6/R6.10) ─────────────────────────

fn keepalive_inc(loop_: *mut Loop) {
    #[cfg(not(windows))]
    {
        deref_mut(loop_).num_polls += 1;
    }
    #[cfg(windows)]
    {
        crate::backend::libuv::inc_active(loop_);
    }
}

fn keepalive_dec(loop_: *mut Loop) {
    #[cfg(not(windows))]
    {
        deref_mut(loop_).num_polls -= 1;
    }
    #[cfg(windows)]
    {
        crate::backend::libuv::dec_active(loop_);
    }
}

// ── attempt-list bookkeeping (≤ CONCURRENT_CONNECTIONS live, R6.7) ───────────

fn attempts_push(c: &mut ConnectingSocket, s: *mut us_socket_t) {
    for slot in &mut c.attempts {
        if slot.is_null() {
            *slot = s;
            return;
        }
    }
    debug_assert!(false, "more than CONCURRENT_CONNECTIONS attempts in flight");
}

fn attempts_remove(c: &mut ConnectingSocket, s: *mut us_socket_t) {
    for slot in &mut c.attempts {
        if *slot == s {
            *slot = core::ptr::null_mut();
            return;
        }
    }
}

fn attempts_count(c: &mut ConnectingSocket) -> usize {
    c.attempts.iter().filter(|s| !s.is_null()).count()
}
