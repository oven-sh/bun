# Shard manifest — one PR, three phases

Rules of engagement (from api.md + standing workflow policy):
- Writers are EDIT-ONLY: no cargo, no git, no stash, files listed in their shard only.
- Each shard gets 2 adversarial reviewers with disjoint lenses:
  L1 = lifetime/reentrancy/aliasing/unsafe-audit; L2 = semantics diff vs the governing spec rules.
- ONE applier serially integrates, compiles (`cargo check -p bun_usockets`, then workspace), runs
  `bun bd` + per-subsystem tests, loops findings back. Only the applier runs cargo/git.
- BoringSSL scope: bun_usockets uses bssl-sys; bun_boringssl_sys REMAINS for the rest of the tree
  (crypto etc.). TLS pointers cross as opaque *mut SslCtx, so no type unification needed this PR.

## Phase A — core implementation (against the frozen skeleton)

| id | files | governing spec |
|----|-------|----------------|
| W1 | unsafe_core/slab.rs hardening + Miri notes | api.md §strategy |
| W2 | backend/epoll.rs, backend/kqueue.rs, backend/mod.rs | core-semantics §2 |
| W3 | backend/libuv.rs (Windows) | core-semantics §2 libuv rules |
| W4 | loop_/tick.rs, loop_/wakeup.rs, loop_/mod.rs | core-semantics §1, §10 |
| W5 | loop_/timeouts.rs | core-semantics §5 |
| W6 | socket.rs + handle.rs (lifecycle/state/dispatch of readable/eof/error) | core-semantics §3 |
| W7 | write.rs | core-semantics §4; C7 |
| W8 | group.rs (listen/accept/adopt/from_fd/pair) | core-semantics §7, §3 adopt; C10, C14 |
| W9 | connecting.rs | core-semantics §6; consumers/04; C13 |
| W10 | udp.rs | core-semantics §9; consumers/05; C15 |
| W11 | tls/state.rs | tls-semantics §1-6 |
| W12 | tls/context.rs | tls-semantics §7-8; C11 |
| W13 | tls/sni.rs | tls-semantics SNI rules |
| W14 | dispatch.rs, unsafe_core/{trampolines,ext}.rs | consumers/01 §5; C17 |
| W15 | cabi.rs | cabi-surface.md |
| W16 | unsafe_core/io.rs (bsd layer), fault.rs | core-semantics §8, §11 |
| W17 | bssl-sys integration: vendor bindgen pre-gen, wrapper.c, scripts/build/deps/boringssl.ts, Cargo wiring | tls-semantics Part 2 |
| W18 | C++ patches: packages/bun-uws accessor patches (5 from cabi-surface.md), move 3 shim us_* helpers, libuwsockets.cpp/quic.c header fixes, scripts/glob-sources.ts C-file removal | cabi-surface.md |

## Phase B — consumer migration (imports → bun_usockets; delete workarounds ONLY where a
   contract explicitly changed — default is mechanical rewiring)

| id | scope |
|----|-------|
| M1 | src/runtime/socket/* (uws_dispatch, uws_handlers, socket_body, Listener, SSLConfig, SocketContext use, tls_socket_functions) |
| M2 | src/http/* (HTTPContext, HTTPThread, ProxyTunnel, lib.rs, h2_client socket use) |
| M3 | src/http_jsc/websocket_client/* |
| M4 | src/sql_jsc/{postgres,mysql} |
| M5 | src/runtime/valkey_jsc |
| M6 | src/jsc/ipc.rs, runtime/cli/test/parallel/Channel.rs, js_bun_spawn_bindings.rs, ipc_host.rs |
| M7 | src/runtime/socket/udp_socket.rs |
| M8 | event loop: src/jsc/event_loop.rs, rare_data.rs, VirtualMachine.rs bits, event_loop/MiniEventLoop.rs, SpawnSyncEventLoop.rs, runtime/jsc_hooks.rs, io/{lib,posix_event_loop,windows_event_loop}.rs, runtime/timer bits |
| M9 | src/runtime/dns_jsc/dns.rs (Bun__addrinfo_* keep no_mangle for quic.c; internals call crate directly), src/dns/lib.rs seam |
| M10 | src/runtime/server/*, src/runtime/bake/* (mostly shim-level; NodeHTTPResponse raw-socket casts; webview backends) |
| M11 | uws shim relocation: App.rs/Request.rs/Response.rs/WebSocket.rs/h3.rs/quic/*, SSLWrapper, thunk.rs, uws_callback re-export → new crate bun_uws_shim (points into surviving C++/lsquic); bun_uws + bun_uws_sys gutted to re-export shims OR deleted with all imports repointed (applier decides by churn) |
| M12 | misc: h2_frame_parser.rs, node_net_binding.rs, Terminal.rs loop nominals, hw_exports.rs, SSLContextCache.rs, SecureContext.rs, webcore/streams.rs, install/* loop nominals |

## Phase C — deletion + flip

| id | scope |
|----|-------|
| D1 | delete packages/bun-usockets/src/{*.c minus quic.c, eventing/, crypto/openssl.c, crypto/sni_tree.cpp}; keep crypto/root_certs*.cpp + quic.c (now compiling against cabi headers from W18); delete src/uws_sys layout mirrors + src/uws remnants per M11 outcome; flip `cabi` feature default-on |
| D2 | tests: port fault-injection tests; add slab Miri test target; GC-stress + adopt/upgradeTLS stress tests in test/js/bun/socket/ |

Applier integration order: W1→W2→W4→W5→W6→W7→W8→W9→W14→W16→W10→W17→W11→W12→W13→W15→W18→W3,
then M-shards (M11 first, then M1..M10, M12), then D1→D2, then full suite + ASAN + verify/code-review.
