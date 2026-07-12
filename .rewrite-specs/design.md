# uSockets → Rust rewrite: architecture contract

Status: DRAFT — API section freezes after consumer-inventory.md and cabi-surface.md land.
Companion specs (same dir): core-semantics.md, tls-semantics.md, consumer-inventory.md, cabi-surface.md.

## Goals

1. **Memory safety**: UAF structurally impossible outside one audited folder. All socket references
   outside `unsafe_core/` are generational `SocketId`s; a dead socket is a failed lookup, never a
   dangling pointer. Every module except `unsafe_core/` carries `#![forbid(unsafe_code)]`.
2. **Code cleanup**: one definition per type (no C header + Rust mirror + C++ shim triplication),
   consumers shed ext-pointer casting/liveness ceremony, `src/uws_sys` layout mirrors and the C
   sources are deleted in the same PR.
3. **Perf parity**: same syscall patterns, same batching/corking, static dispatch, no per-socket
   Arc/Mutex/RefCell, hot header in one cache line.

Non-goals: tokio/mio/async-await (the loop's JSC contract is bespoke), io_uring (later, behind the
Backend seam), rewriting uWS C++ (survives behind a minimal extern "C" boundary), rewriting lsquic
glue beyond what deletion of the C core forces.

## Crate: `bun_usockets` at `src/usockets/`

```
src/usockets/
  lib.rs               forbid(unsafe_code) via lint config for all modules except unsafe_core
  loop_.rs             Loop: owns slab, backend, sweeps, closed list, low-prio, scratch buffers
  tick.rs              run_bun_tick: pre → wakeups → poll → dispatch → post → drain closed → low-prio
  socket.rs            SocketId, socket header (fd, flags, kind, timeout bytes, links), safe ops
  ctx.rs               Ctx<'_, P>: capability handle passed to callbacks (write/close/timeout/adopt/…)
  protocol.rs          trait Protocol { type State; fn on_data(ctx, &mut State, &mut [u8]); … }
                       + kind registry → monomorphized static dispatch tables (successor of vtable.rs)
  listener.rs          Listener: options, accept path, ext stamping
  connecting.rs        Connecting: DNS bridge + happy-eyeballs + cancel; promotes to Socket
  timeouts.rs          4s sweep + minute long-timeout sweep, poll-deadline folding, refcounted enable
  write.rs             write/write2/writev, ENOBUFS/ENOMEM-as-would-block, stream buffer, sendfile
  cork.rs              Cork RAII guard over loop scratch; cork slots live on Loop (uWS C++ interop)
  udp.rs
  tls/
    mod.rs             Transport { Plain, Tls(Box<TlsState>) }
    state.rs           per-socket SSL* + BIOs + pending buffers; handshake/read/write/shutdown machine
    context.rs         SSL_CTX construction from options; digest cache; verify errors
    sni.rs             server-name map with wildcard matching (replaces sni_tree.cpp)
  backend/
    mod.rs             trait Backend (cfg-selected, static dispatch; the future io_uring seam)
    epoll.rs kqueue.rs libuv.rs
  cabi.rs              extern "C" surface for packages/bun-uws + lsquic glue ONLY (see cabi-surface.md)
  fault.rs             fault injection hooks (cfg(feature = "fault-injection"))
  unsafe_core/         THE ONLY MODULE ALLOWED unsafe
    slab.rs            chunked slab: page-allocated, stable addresses, free list, generation bump
    ext.rs             kind-tag-checked ext downcast (one function)
    io.rs              syscall edges not already covered by bun_sys
    ffi.rs             bssl-sys / libuv / lsquic boundary helpers
```

TLS bindings: official vendored crates at `vendor/boringssl/rust/` (`bssl-sys`; safe layers only if
tls-semantics.md Part 2 finds them viable for external-ciphertext nonblocking use). `src/boringssl_sys`
(hand-written externs) is replaced; audit its other consumers before deletion.

## Ownership model (the keystone)

- Per-loop **chunked slab** holds all sockets: chunks never move or free during loop life, so
  addresses are stable (cabi can hand `us_socket_t*` to C++; internal code may cache a raw ptr
  within one callback frame only). Free-list reuse bumps a **generation** counter.
- `SocketId { index: u32, generation: u32 }` is the only externally storable reference. Lookup:
  one bounds check + one generation compare → `Option<&mut …>`.
- Ext state is a real type per Protocol (`Protocol::State`), stored inline in the slab slot, sized
  at creation for the **adoption family** max (kinds are a closed set → const), so adopt/upgradeTLS
  re-stamps the kind and never reallocates. `us_internal_ssl_socket_relocated` has no successor.
- **Deferred close**: close unlinks from group lists onto the loop's closed list immediately
  (callbacks may run user JS that closes anything); generation bumps and the slot returns to the
  free list only in the tick postlude. This is the ONLY death path.
- Aliasing: exactly one `&mut Loop`, held by the tick. Callbacks receive `Ctx` which split-borrows
  loop internals; no `&mut SocketGroup`/`&mut Loop` ever materializes inside a callback.
- Cross-thread: `SocketId` + loop wakeup queue only; no cross-thread pointers. (HTTP thread pool,
  queued shutdowns.)

## Semantics preserved verbatim (checklist for reviewers)

From core-semantics.md / tls-semantics.md, headline items:
- 4s timeout sweep folded into poll deadline (no timerfd), minute-granularity long timeout,
  refcounted sweep enable.
- Low-prio queue: max 5 sockets/tick, states 0/1/2, parked sockets off head list (shutdown
  accounting depends on it).
- `pending_wakeups` atomic swap before poll; GC-safepoint skip interplay.
- ENOBUFS/ENOMEM treated as would-block on write.
- CloseCode: normal = close_notify/FIN + deferred fd close; fast_shutdown; failure = SO_LINGER(0) RST.
- Half-open (ALLOW_HALF_OPEN), shutdown_read, pause/resume, on_end vs on_close ordering.
- Cork slots on loop data, surviving adoption (uWS C++ HttpResponse depends on this).
- Group iteration safe against removal-during-iteration (close_all).
- Connecting: async DNS bridge, happy-eyeballs, cancellation; on_connect_error vs on_connecting_error.
- TLS: write batching, fail-closed verification with Node-compat verify error surface, SNI wildcard
  rules, adopt_tls/tls_feed for UpgradedDuplex/named pipes.
- Windows: libuv backend, active-handle refcounting, uv timer.

## Delivery: one PR

- Deleted: `packages/bun-usockets/src/*.c` + eventing + crypto/openssl.c + sni_tree.cpp (root cert
  TABLES may survive as data per tls spec), `src/uws_sys` layout mirrors (`Loop.rs` PosixLoop mirror,
  `SocketGroup.rs`, `us_socket_t.rs` externs, `SocketContext.rs` option mirrors, vtable.rs),
  `src/boringssl_sys` (if consumer audit allows), `bun_uws` wrapper types superseded by native API.
- Kept: `packages/bun-uws` C++ (+ its `uws_app_*` shim and the Rust bindings pointing INTO it),
  lsquic glue, root-cert data tables.
- Migrated in-PR: every Rust consumer listed in consumer-inventory.md.
- Branch `claude/usockets-rust-rewrite`; single push after full local green (batch commits, one CI build).

## Workflow shape (per standing rules)

1. Frozen skeleton: compiling stubs of every module signature above, written before sharding.
2. Writer shard per file (edit-only agents; no cargo, no git). Core shards + one shard per consumer
   migration + deletion shards.
3. Two adversarial reviewers per file with disjoint lenses: (a) lifetime/reentrancy/aliasing,
   (b) semantics diff against the normative specs. Findings loop back to writers until dry.
4. ONE applier: serial integration, `cargo check` per merge, `bun bd`, per-subsystem test suites,
   then full suite + ASAN. Only the applier runs git/cargo. No stash (shared across worktrees).
5. No benchmarking on this box; perf validation via off-box/CI after PR opens.
