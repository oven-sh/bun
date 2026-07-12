# bun_usockets: frozen Rust API design

Status: FROZEN once core-semantics.md and tls-semantics.md land (amendments noted in CHANGES at
bottom). Writers implement against this + the numbered rules in core-semantics.md / tls-semantics.md.
Consumer requirements: consumers/*.md (12 files). C++ boundary: cabi-surface.md.

## Strategy recap

The existing consumer-facing surface (`bun_uws_sys` safe wrappers + `bun_uws`) is already a decent
Rust API: Copy word-sized handles, one-pointer ext backrefs, static per-kind vtables, `Handler`
trait. We KEEP that shape so the one-PR consumer migration is mechanical (import changes + deleting
workarounds), and replace what's underneath:

1. **Sockets live in a per-loop chunked slab** (unsafe_core/slab.rs): pages never move or free
   while the loop lives; slots are reused with a **generation bump**.
2. **`SocketRef { ptr: NonNull<SocketHeader>, gen: u32 }`** (16-byte Copy) replaces every raw
   `*mut us_socket_t` in handles. Every operation validates `gen == header.gen`; mismatch behaves
   exactly like today's `Detached`/`is_closed` path (no-op / 0 / None). Reading a stale slot is
   safe: slab memory is never returned to the OS while the loop lives. **UAF through a handle is
   impossible by construction.**
3. **No relocation, ever.** `adopt`/`adopt_tls` re-stamp kind + repoint ext in place. Ext capacity
   is fixed at creation to the max of the socket's *adoption family* (a `const fn` over the closed
   `SocketKind` set; Rust kinds all use 8-byte ext, uWS kinds use
   `max(sizeof HttpResponseData, sizeof WebSocketData)` passed in at listen/context creation).
   `us_internal_ssl_socket_relocated` and "callback returns the possibly-new pointer" die. The C
   vtable keeps the `-> *mut us_socket_t` return type for ABI stability but it is always the input.
4. **Deferred close is the only death path**: close unlinks to the loop's closed list immediately;
   the generation bumps and the slot returns to the free list in the tick postlude
   (`drain_closed_sockets`). SEMI_SOCKET close dispatches nothing (contract, 4+ consumers).
5. **`#![forbid(unsafe_code)]`** everywhere except `unsafe_core/` (slab, ext downcast, syscall/FFI
   edges, cabi trampolines).

## Crate layout

```
src/usockets/               crate bun_usockets (replaces bun_uws_sys + bun_uws + C sources)
  lib.rs                    re-exports; lint config (forbid unsafe outside unsafe_core)
  kind.rs                   SocketKind (same discriminants; closed world; adoption families)
  handle.rs                 InternalSocket, SocketRef, NewSocketHandler<SSL>, AnySocket, CloseCode,
                            ListenSocket, ConnectingRef — same method surface as today's socket.rs
                            + us_socket_t.rs (see "Handle surface" below)
  socket.rs                 SocketHeader (slab slot: fd, gen, flags, kind, timeout bytes, links,
                            transport, ext word/area) + internal open/close/write/read paths
  group.rs                  SocketGroup (repr(C), embedded-by-value, same field meaning; vtable slot
                            kept for Dynamic/uWS kinds), listen/connect/from_fd/pair/adopt
  connecting.rs             Connecting state machine: DNS bridge + happy-eyeballs (4 concurrent,
                            interleaved families) + cancel/tombstone; per core-semantics rules
  dispatch.rs               kind -> static vtable tables (absorbs uws_dispatch.rs registration);
                            Handler trait + vtable::make (moved from uws_sys/vtable.rs, unchanged
                            signatures); trampolines live in unsafe_core
  loop_/
    mod.rs                  Loop (native struct, no longer a mirror): num_polls/active/fd/
                            ready_polls/current_ready_poll/pending_wakeups + InternalLoopData
                            fields as today (jsc_vm, parent tag/ptr, quic_head, recv/send buf,
                            low_prio, closed lists, dns_ready, mutex, iteration_nr, tick_depth)
    tick.rs                 us_loop_run_bun_tick / run / pump; pre/post; sweep-deadline folding;
                            low-prio budget (5/tick); closed drain; dns_ready drain
    timeouts.rs             4s + minute wheels over group lists; refcounted sweep enable
    wakeup.rs               pending_wakeups atomic; wakeup_async; defer (uws_loop_defer)
  write.rs                  write/write2/raw_write(v)/write_check_error (ENOBUFS/ENOMEM=would-block)
                            /flush/sendfile mark/stream buffer/ipc fd write (SCM_RIGHTS)
  tls/
    mod.rs                  Transport { Plain, Tls(Box<TlsState>) } on the SocketHeader
    state.rs                per-socket SSL* + BIOs + pending buffers; handshake/read/write/shutdown
                            per tls-semantics.md; loop plaintext scratch via Option::take
    context.rs              ssl_ctx_from_options (BunSocketContextOptions unchanged repr(C)),
                            verify errors (us_bun_verify_error_t unchanged), default CA store,
                            pending session/keylog queues, raw tap, tls_feed, adopt_tls
    sni.rs                  server-name map + wildcard matching (replaces sni_tree.cpp);
                            on_server_name callback; sni_resolve suspend/resume
  udp.rs                    UdpSocket + PacketBuffer per consumers/05-udp.md contract
  backend/
    mod.rs                  trait Backend (cfg-selected); poll types incl. SEMI_SOCKET/CALLBACK/UDP
    epoll.rs kqueue.rs      + FilePoll back-channel: Bun__internal_dispatch_ready_poll, ready_polls
    libuv.rs                Windows: uv_poll/prepare/check, us_timer_t, active-handle proxying
  fault.rs                  fault injection (cfg feature socket_fault_injection), same us_fault_* API
  cabi.rs                   the ~62 extern "C" fns + repr(C) types from cabi-surface.md (uWS C++,
                            quic.c, NodeTLS.cpp, JSNodeHTTPServerSocket, webview backends)
  unsafe_core/
    slab.rs                 chunked slab + generations (Miri-tested standalone)
    ext.rs                  kind-tag-checked ext access (single unsafe fn)
    trampolines.rs          extern "C" vtable/dispatch shims
    io.rs ffi.rs            syscall edges beyond bun_sys; bssl-sys/libuv/lsquic helpers
```

`bun_uws` / `bun_uws_sys` crates are DELETED; the C++-shim bindings (`uws_app_*`/`uws_res_*`
App.rs/Response.rs/Request.rs/WebSocket.rs/h3.rs, `#[uws_callback]`, SSLWrapper, quic.rs) MOVE into
this crate (or a sibling `bun_uws_shim` crate) unchanged — they point INTO surviving C++, not into
the deleted C. SSLWrapper's five `us_ssl_*` helper deps are provided by tls/context.rs.

## Handle surface (unchanged names, new internals)

`InternalSocket`: `Connected(SocketRef) | Connecting(ConnectingRef) | Detached |
UpgradedDuplex(*mut UpgradedDuplex) | Pipe(*mut WindowsNamedPipe)` — grows from 8 to 16+tag bytes;
still Copy. All `NewSocketHandler<SSL>` / `AnySocket` / `us_socket_t`-method names and semantics
from consumers/01-api-surface.md are preserved verbatim, including:
- state: is_closed/is_shutdown/is_established/is_detached/get_error/dns_error/get_verify_error
- io: write/write2/raw_write/raw_writev/write_check_error/write_fd/flush/tls_feed
- lifecycle: open/close(CloseCode)/shutdown/shutdown_read/pause/resume/adopt/adopt_tls/
  start_tls_handshake/set_ssl_raw_tap/sni_resolve
- options: set_timeout (240s split) / set_timeout_minutes / nodelay / keepalive / tos
- identity: local/remote address+port, fd, get_native_handle, ssl(), kind/set_kind, ext, group
Stale-generation behavior == today's Detached behavior for every method.

`ext<T>()`: kind registry records each kind's ext type id (debug) + size; access goes through
unsafe_core::ext with a kind check. Rust kinds keep `Option<NonNull<Owner>>` 8-byte slots
(ExtSlot<T> preserved). uWS kinds expose `ext_ptr()` bytes via cabi only.

`SocketGroup`: stays repr(C) embedded-by-value (uWS C++ embeds it; sizeof static_asserted there).
Same fields/meaning; now defined once, here. init/destroy/close_all/listen/listen_unix/connect/
connect_unix/from_fd/pair/owner/is_empty/next_in_loop unchanged.

`Loop`: native struct, same field set as today's mirror (consumers field-poke num_polls/active/fd —
those ~10 sites migrate to inherent methods in this PR since the type is now ours). All methods from
consumers/10-event-loop.md §8 kept. Cross-thread contract: `wakeup` and `defer` take `*mut Loop`
(never `&mut`), pending_wakeups atomic swap semantics preserved.

## Contracts that are load-bearing (writers + reviewers: treat as tests)

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
     around JS run inside handshakes (ALPN/SNI callbacks) — encode as RAII scratch take/restore.
C12. CloseCode: normal (TLS close_notify + deferred fd close), fast_shutdown, failure (SO_LINGER 0
     RST). shutdown_read + shutdown after queued close frame => CLEAN_SHUTDOWN branch on EOF, not
     on_end (ws client close-frame flush depends on it).
C13. DNS bridge (five fns) semantics per consumers/04-dns-bridge.md incl. cancel linearization,
     cache poisoning rules, dns_ready_head non-wakeup vs threadsafe enqueue, keep-alive balance.
C14. from_fd: owns fd only on success; sets nonblocking itself; no on_open self-dispatch;
     ipc flag enables SCM_RIGHTS receive (on_fd) and write_fd.
C15. UDP: contract per consumers/05-udp.md §13 (sync on_close, closed_udp_head lifetime, one-shot
     drain, Linux MSG_ERRQUEUE vs non-Linux close-on-error, batch recv loop close recheck).
C16. Loop: parks only when num_polls>0; pending_wakeups!=0 skips GC-safepoint sleep; parent
     tag/ptr + jsc_vm slots; quic pre/post hooks + quic_next_tick_us readable; close_all_groups
     walks the FULL linked list and reports progress (rare_data retry loop).
C17. Every callback may synchronously re-enter (write/close/connect/adopt from inside any
     callback); dispatch never touches ext after a terminal callback; no &mut formed over
     consumer-owned state.

## CHANGES (amendments after semantics specs) — API IS NOW FROZEN

Resolved decisions (binding on all writers/reviewers):
1. TLS bindings: bssl-sys (vendor/boringssl/rust) as raw layer inside TlsState; pre-generated
   bindings via BINDGEN_RS_FILE + wrapper.c for static-inlines wired into scripts/build/deps/
   boringssl.ts; build.rs link directives neutered (Bun links its own BoringSSL objects).
   bssl-tls NOT used (missing ALPN/server-SNI/client-CA/new-session/PKCS12).
2. TLS spill + fatal-reason storage: PER-SOCKET (in TlsState), not loop-shared. This is what
   deletes relocation. Loop keeps one shared plaintext read scratch via Option::take (re-entrant
   nesting allocates fresh). Batch thresholds (16KB records, 128KB flush) ported verbatim.
3. SSLWrapper (bun_uws ssl_wrapper) survives UNCHANGED this PR (already Rust, targets BoringSSL
   not the deleted C); it moves into this crate/shim-crate with its five us_ssl_* helper deps
   provided by tls/context.rs. Unification with TlsState = follow-up.
4. sni_tree.cpp -> tls/sni.rs (verbatim matching semantics incl. case behavior);
   root_certs*.cpp stay as C++ data TUs. openssl.c deleted. wolfSSL cfg paths dropped.
5. cabi keeps us_ssl_ctx_build_raw (quic.c) + the ~62-fn surface; the 5 recommended C++
   accessor patches (cabi-surface.md) are IN SCOPE: us_socket_t/us_listen_socket_t/us_loop_t
   become opaque to all surviving C/C++; only us_socket_group_t stays public repr(C).
   The 3 shim-defined us_* helpers (poking s->p / group->loop / last_write_failed) move to cabi.rs.
6. Core open questions OQ-1..16 (core-semantics.md): ALL ported verbatim as documented quirks,
   EXCEPT OQ-4 (stale kernel data.ptr after zero-event resize — structurally fixed by
   generation-checked dispatch: stale kernel pointers resolve to dead slots and the event is
   dropped) and OQ-10 (SEMI_SOCKET close test ported as equality, not bitmask). Quirks list goes
   in the PR description.
7. us_socket_stream_buffer_t: does not exist in the C core (buffering lives above); keep the
   existing Rust-side type where it lives today; write.rs does NOT reimplement it.
8. sessionTimeout/ticketKeys stay unplumbed (parity).
