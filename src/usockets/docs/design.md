# bun_usockets: Rust API design

Companion documents: behavioral rules in `semantics.md` (non-TLS core) and
`tls.md` (TLS layer); the C boundary in `cabi.md`.

## Strategy

The consumer-facing surface (Copy word-sized handles, one-pointer ext
backrefs, static per-kind vtables, `Handler` trait) keeps the shape of the
crates it replaced (`bun_uws_sys` safe wrappers + `bun_uws`), so consumer code
stays mechanical; what changed is everything underneath:

### Strategy 1: per-loop chunked slab

Sockets live in a per-loop chunked slab (`unsafe_core/slab.rs`): pages never
move or free while the loop lives; slots are reused with a **generation
bump**. The loop OWNS all socket storage.

### Strategy 2: generation-checked handles

`SocketRef { ptr: NonNull<SocketHeader>, gen }` (Copy) replaces every raw
`*mut us_socket_t` in handles. Every operation validates `gen == header.gen`;
mismatch behaves exactly like the `Detached`/`is_closed` path (no-op / 0 /
None). Reading a stale slot is safe: slab memory is never returned to the OS
while the loop lives (see "Slab reclamation" — decommitted ranges stay
reserved and read as dead). **UAF through a handle is impossible by
construction.**

### Strategy 3: no relocation, ever

`adopt`/`adopt_tls` re-stamp kind + repoint ext in place. Ext capacity is
fixed at creation to the max of the socket's *adoption family* (a `const fn`
over the closed `SocketKind` set; Rust kinds all use 8-byte ext, uWS kinds use
`max(sizeof HttpResponseData, sizeof WebSocketData)` passed in at
listen/context creation). Adoption never crosses families — crossing would
reinterpret the ext word. `us_internal_ssl_socket_relocated` and "callback
returns the possibly-new pointer" are gone. The C vtable keeps the
`-> *mut us_socket_t` return type for ABI stability but it is always the
input pointer.

### Strategy 4: deferred close is the only death path

Close unlinks to the loop's closed list immediately; the generation bumps and
the slot returns to the free list in the tick postlude
(`drain_closed_sockets`). SEMI_SOCKET close dispatches nothing (contract,
relied on by multiple consumers).

### Strategy 5: unsafe confined to unsafe_core

`#![forbid(unsafe_code)]` everywhere except `unsafe_core/` (slab, ext
downcast, syscall/FFI edges, cabi trampolines).

## Crate layout

```
src/usockets/               crate bun_usockets (replaces bun_uws_sys + bun_uws + C sources)
  lib.rs                    re-exports; lint config (forbid unsafe outside unsafe_core)
  kind.rs                   SocketKind (same discriminants; closed world; adoption families)
  handle.rs                 InternalSocket, SocketRef, NewSocketHandler<SSL>, AnySocket, CloseCode,
                            ListenSocket, ConnectingRef (see "Handle surface" below)
  socket.rs                 SocketHeader (slab slot: fd, gen, flags, kind, timeout bytes, links,
                            transport, ext word/area) + internal open/close/write/read paths
  group.rs                  SocketGroup (repr(C), embedded-by-value; vtable slot kept for
                            Dynamic/uWS kinds), listen/connect/from_fd/pair/adopt
  connecting.rs             Connecting state machine: DNS bridge + happy-eyeballs (4 concurrent,
                            interleaved families) + cancel/tombstone
  dispatch.rs               kind -> static vtable tables; Handler trait + vtable::make;
                            trampolines live in unsafe_core
  protocol.rs               Protocol v2 — the safe consumer socket interface (below)
  loop_/
    mod.rs                  Loop: num_polls/active/fd/ready_polls/current_ready_poll/
                            pending_wakeups + InternalLoopData fields (jsc_vm, parent tag/ptr,
                            quic_head, recv/send buf, low_prio, closed lists, dns_ready, mutex,
                            iteration_nr, tick_depth)
    tick.rs                 us_loop_run_bun_tick / run / pump; pre/post; sweep-deadline folding;
                            low-prio budget (5/tick); closed drain; dns_ready drain
    timeouts.rs             4s + minute wheels over group lists; refcounted sweep enable
    wakeup.rs               pending_wakeups atomic; wakeup_async; defer
    poll_registry.rs        first-class non-socket poll registrations (below)
  write.rs                  write/write2/raw_write(v)/write_check_error (ENOBUFS/ENOMEM=would-block)
                            /flush/sendfile mark/ipc fd write (SCM_RIGHTS)
  tls/
    mod.rs                  Transport { Plain, Tls(Box<TlsState>) } on the SocketHeader
    state.rs                per-socket SSL* + BIOs; handshake/read/write/shutdown per tls.md;
                            loop-shared plaintext scratch (see "TLS buffer ownership")
    context.rs              ssl_ctx_from_options (BunSocketContextOptions unchanged repr(C)),
                            verify errors, default CA store, pending session/keylog queues,
                            raw tap, tls_feed, adopt_tls
    sni.rs                  server-name map + wildcard matching (replaces sni_tree.cpp);
                            on_server_name callback; sni_resolve suspend/resume
  udp.rs                    UdpSocket + PacketBuffer
  backend/
    mod.rs                  trait Backend (cfg-selected); poll types incl. SEMI_SOCKET/CALLBACK/UDP
    epoll.rs kqueue.rs      Linux/Android and macOS/FreeBSD eventing
    libuv.rs                Windows: uv_poll/prepare/check, us_timer_t, active-handle proxying
  fault.rs                  fault injection (cfg feature socket_fault_injection), same us_fault_* API
  cabi.rs                   the extern "C" fns + repr(C) types from cabi.md (uWS C++, quic.c,
                            NodeTLS.cpp, JSNodeHTTPServerSocket, webview backends)
  unsafe_core/
    slab.rs                 chunked slab + generations (Miri-tested standalone)
    ext.rs                  kind-tag-checked ext access
    trampolines.rs          extern "C" vtable/dispatch shims
    io.rs ffi.rs            syscall edges beyond bun_sys; bssl-sys/libuv/lsquic helpers
```

The C++-shim bindings (`uws_app_*`/`uws_res_*`, App.rs/Response.rs/Request.rs/
WebSocket.rs/h3.rs, `#[uws_callback]`, SSLWrapper, quic.rs) live in the sibling
`bun_uws_shim` crate unchanged — they point INTO surviving C++, not into the
deleted C. SSLWrapper's five `us_ssl_*` helper deps are provided by
tls/context.rs.

## Handle surface (unchanged names, new internals)

`InternalSocket`: `Connected(SocketRef) | Connecting(ConnectingRef) | Detached |
UpgradedDuplex(*mut UpgradedDuplex) | Pipe(*mut WindowsNamedPipe)`; still Copy.
All `NewSocketHandler<SSL>` / `AnySocket` method names and semantics are
preserved, including:
- state: is_closed/is_shutdown/is_established/is_detached/get_error/dns_error/get_verify_error
- io: write/write2/raw_write/raw_writev/write_check_error/write_fd/flush/tls_feed
- lifecycle: open/close(CloseCode)/shutdown/shutdown_read/pause/resume/adopt/adopt_tls/
  start_tls_handshake/set_ssl_raw_tap/sni_resolve
- options: set_timeout (240s split) / set_timeout_minutes / nodelay / keepalive / tos
- identity: local/remote address+port, fd, get_native_handle, ssl(), kind/set_kind, ext, group

Stale-generation behavior == Detached behavior for every method.

`ext<T>()`: the kind registry records each kind's ext type id (debug-checked)
+ size; access goes through unsafe_core::ext with a kind check. Rust kinds
keep `Option<NonNull<Owner>>` 8-byte slots; uWS kinds expose `ext_ptr()` bytes
via cabi only.

`SocketGroup`: stays repr(C) embedded-by-value (uWS C++ embeds it; sizeof
static_asserted there). init/destroy/close_all/listen/listen_unix/connect/
connect_unix/from_fd/pair/owner/is_empty/next_in_loop unchanged.

`Loop`: native struct. Cross-thread contract: `wakeup` and `defer` take
`*mut Loop` (never `&mut`); pending_wakeups atomic swap semantics preserved.

## Load-bearing contracts (treat as tests)

C1. SEMI_SOCKET explicit close dispatches NO callbacks (valkey/sql/ws compensate).
C2. Exactly one of on_close/on_connect_error per successful connect, EXCEPT C1.
C3. on_close: ext still readable; code 0/1/2 = CloseCode, >2 = real errno; reason ptr passthrough.
C4. Connecting close: on_connecting_error dispatched synchronously; ext-null ⇒ silent no-op.
C5. connect_* may dispatch connect_error synchronously before returning; close-then-notify order.
C6. Deferred free: header memory (incl. ext) readable until tick postlude; closed_head drainable
    post-last-tick (drain_closed_sockets).
C7. write returns bytes accepted; 0 = would-block; <0 fatal; ENOBUFS/ENOMEM => 0; no MSG_MORE.
    on_writable after kernel drain; paused bit must reset on pool reuse (resettable/introspectable).
C8. Low-prio queue: 5/tick, parked off head_sockets, group.low_prio_count coherent with is_empty.
C9. Timeout wheels: 4s ticks (255=off) + minute wheel; sweep folded into poll deadline; sweep
    enable refcounted; connecting sockets copy timeout bytes onto attempt children; pooled sockets'
    minute wheel works with no active request attached.
C10. adopt/adopt_tls: in-place, no handshake kick (caller repoints ext then start_tls_handshake);
     cork slot ownership transfers (uWS C++ HttpResponse depends on it).
C11. TLS: on_handshake(success, us_bun_verify_error_t) always delivered (verify decided by
     consumer); get_native_handle live SSL* during handshake cb; session/keylog delivered ONLY
     after the SSL stack unwinds (pending queues); loop TLS routing state save/restore equivalent
     around JS run inside handshakes (ALPN/SNI callbacks) — encoded as RAII scratch take/restore.
C12. CloseCode: normal (TLS close_notify + deferred fd close), fast_shutdown, failure (SO_LINGER 0
     RST). shutdown_read + shutdown after queued close frame => CLEAN_SHUTDOWN branch on EOF, not
     on_end (ws client close-frame flush depends on it).
C13. DNS bridge (five fns): cancel linearization, cache poisoning rules, dns_ready_head
     non-wakeup vs threadsafe enqueue, keep-alive balance (semantics.md §6).
C14. from_fd: owns fd only on success; sets nonblocking itself; no on_open self-dispatch;
     ipc flag enables SCM_RIGHTS receive (on_fd) and write_fd.
C15. UDP: sync on_close, closed_udp_head lifetime, one-shot drain, Linux MSG_ERRQUEUE vs
     non-Linux close-on-error, batch recv loop close recheck (semantics.md §9).
C16. Loop: parks only when num_polls>0; pending_wakeups!=0 skips GC-safepoint sleep; parent
     tag/ptr + jsc_vm slots; quic pre/post hooks + quic_next_tick_us readable; close_all_groups
     walks the FULL linked list and reports progress (rare_data retry loop).
C17. Every callback may synchronously re-enter (write/close/connect/adopt from inside any
     callback); dispatch never touches ext after a terminal callback; no &mut formed over
     consumer-owned state.

## Consumer protocol (Protocol v2)

Consumers (HTTP client, Valkey, Postgres, MySQL, WS client, IPC, UDP,
Bun.listen/connect) contain NO unsafe for socket interaction; the socket
interface is safe and handles re-entrancy itself. The v1 raw `Handler` stays
for uWS/Dynamic kinds.

```rust
pub trait Protocol: Sized + 'static {
    type Owner: bun_ptr::RefCounted;           // interior-mutable; !Send (loop-local)
    const KIND: SocketKind;                     // or a family pair for SSL variants
    fn on_open(o: &Self::Owner, s: Socket, is_client: bool, ip: &[u8]) {}
    fn on_data(o: &Self::Owner, s: Socket, data: &mut [u8]) {}
    fn on_writable(o: &Self::Owner, s: Socket) {}
    fn on_close(o: &Self::Owner, s: Socket, code: CloseCode2, errno: i32) {}
    fn on_end(o: &Self::Owner, s: Socket) {}
    fn on_timeout(o: &Self::Owner, s: Socket) {}
    fn on_long_timeout(o: &Self::Owner, s: Socket) {}
    fn on_connect_error(o: &Self::Owner, err: ConnectFailure) {}   // covers connecting too
    fn on_handshake(o: &Self::Owner, s: Socket, ok: bool, err: VerifyError) {}
    fn on_fd(o: &Self::Owner, s: Socket, fd: OwnedFd) {}
}
```

- `Socket` is the generation-checked Copy handle (safe methods only).
- Registration: `register::<P>()` monomorphizes into the static kind table;
  the trampoline (unsafe_core, written once) does: validate generation → load
  owner ref → take dispatch guard (`owner.ref_()`) → call safe handler → drop
  guard. An owner can drop to zero refs mid-callback and stays alive until
  dispatch returns; its LAST release happens outside dispatch by core
  guarantee. Handlers receive `&Owner` (shared), never `&mut` — owners are
  interior-mutable.
- Owner attach: `connect(.., owner)`, `from_fd(.., owner)`, `adopt(.., owner)`;
  `Listener::on_create` supplies the owner for accepted sockets.
  `adopt_tls(.., new_owner)` swaps owner and kind atomically — no window where
  dispatch sees a stale owner. `Handle::detach_owner()` clears the owner
  atomically w.r.t. dispatch; subsequent events no-op.
- **Terminal contract**: after on_close/on_connect_error returns, the core
  drops ITS owner ref (the one the ext held). Exactly once, on every terminal
  path — including C1 SEMI_SOCKET silent close, where no callback fires but
  the ext ref is still released by the core (a deliberate, documented
  improvement over C parity: consumers keep no compensation ref bookkeeping).
- Re-entrancy: handlers may synchronously call any safe Socket method incl.
  close/adopt/connect (C17).
- Cross-thread: unchanged (wakeup + queues); `Socket` is !Send.

## Ext storage

uWS/Dynamic (group-vtable) ext is CONTIGUOUS with the socket header (C parity:
`us_socket_ext` == fixed offset). Per-loop slab size classes: group-vtable
kinds allocate from a size-class slab whose slot = header + ext bytes inline
(class chosen by the family-max ext size registered at listen/context
creation). Rust kinds use the uniform slab + inline 8-byte ext word.
`ext_ptr` for group-vtable kinds is a header+1 projection.
Generation/deferred-close semantics are identical across classes.

## Slab reclamation

- Chunks are mmap-reserved, 256 slots each. When a chunk reaches 0 occupied
  slots (hysteresis: the most-recently-emptied chunk stays committed), its
  pages are reclaimed — `madvise(MADV_DONTNEED)` on Linux/macOS
  (MADV_DONTNEED specifically, NEVER MADV_FREE: the zero-fill guarantee is
  load-bearing) / `VirtualAlloc(MEM_RESET)` on Windows (NOT MEM_DECOMMIT:
  stale-handle probes must stay a plain slot deref, and decommitted pages
  would fault; MEM_RESET stays committed+readable while the OS discards the
  contents). The address range stays reserved, so stale-handle validation
  remains a single slot deref: a reclaimed page reads generation 0 ⇒ dead.
- Generations are u64: chunk epoch (loop-side array, bumped per decommit) in
  the high 32 bits, slot counter in the low 32 — so a handle from one commit
  cycle can never validate in a later one (ABA guard), and epoch wrap is
  unreachable. The epoch array is the deliberate irreducible residue (~8B per
  256 peak sockets); it lives until loop teardown.
- Loop teardown fully releases: munmap / `VirtualFree(MEM_RELEASE)` every
  reservation + free the epoch array (workers + HTTP thread churn must not
  accumulate reservations). Safe under the existing ordering: validation only
  runs on the loop's thread and teardown is its final act after group drain.

## Non-socket poll registrations

First-class non-socket polls (`loop_/poll_registry.rs`): `PollSource` =
`Fd{readable,writable}` | (darwin) `Proc(pid)`, `Machport(port)`,
`Memorystatus`. The registry uses the same slab/generation scheme as sockets
(a poll kind byte distinguishes); dispatch goes through a refcounted owner +
held guard (the Protocol v2 trampoline); keep-alive is integrated with
num_polls/active. This replaces the old ready_polls back-channel,
`Bun__internal_dispatch_ready_poll` extern, and tagged-pointer udata
convention.

## TLS buffer ownership

The loop-shared C architecture is kept: loop-shared ciphertext BIO buffers +
ONE loop-shared plaintext spill slot per loop (O(1) memory; the slab already
eliminated relocation, so per-socket spill would buy nothing). The two C
hazards are made safe: the spill/fatal-reason OWNER is a generation-checked
`SocketRef` (stale = drop, never dangles), and the save/restore re-entrancy
protocol around JS re-entry is an RAII scope guard (nested TLS entry restores
on drop, enforced by type). Batch thresholds (16KB records, 128KB flush) are
preserved verbatim. See tls.md "Resolved design notes".

## Resolved design decisions

1. TLS bindings: bssl-sys (vendor/boringssl/rust) as the raw layer inside
   TlsState; pre-generated bindings via BINDGEN_RS_FILE + wrapper.c for
   static-inlines wired into scripts/build/deps/boringssl.ts; build.rs link
   directives neutered (Bun links its own BoringSSL objects). bssl-tls is NOT
   used (missing ALPN/server-SNI/client-CA/new-session/PKCS12); see tls.md
   PART 2.
2. SSLWrapper (`bun_uws_shim::ssl_wrapper`) survives unchanged (already Rust,
   targets BoringSSL, not the deleted C); its five us_ssl_* helper deps come
   from tls/context.rs. Unification with TlsState is a follow-up.
3. sni_tree.cpp → tls/sni.rs (verbatim matching semantics incl. case
   behavior); root_certs*.cpp stay as C++ data TUs. openssl.c deleted.
   wolfSSL cfg paths dropped.
4. cabi keeps us_ssl_ctx_build_raw (quic.c) + the surface in cabi.md §1/§9.1;
   `us_socket_t`/`us_listen_socket_t`/`us_loop_t` are opaque to all surviving
   C/C++; only `us_socket_group_t` stays public repr(C). The 3 formerly
   shim-defined us_* helpers (poking s->p / group->loop / last_write_failed)
   live in cabi.rs.
5. The C-parity quirks OQ-1..16 (semantics.md) are ALL preserved verbatim as
   documented quirks, EXCEPT OQ-4 (stale kernel data.ptr after zero-event
   resize — structurally fixed by generation-checked dispatch: stale kernel
   pointers resolve to dead slots and the event is dropped) and OQ-10
   (SEMI_SOCKET close test implemented as equality, not bitmask).
6. us_socket_stream_buffer_t: does not exist in the core (buffering lives
   above it); the existing Rust-side type stays where it lives today;
   write.rs does NOT reimplement it.
7. sessionTimeout/ticketKeys stay unplumbed (parity).
