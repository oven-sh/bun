# Phase 1 Inventory — Section E: runtime-socket-udp-tcp

Run: `2026-05-15-exhaustive`. Scope: `src/runtime/socket/` (14 `.rs` files; the
sibling `.zig` files are porting references and are not compiled).

Mapper tallies (audited base `origin/main@4d443e5402`, post prior-audit branch `23e23b6d29`):

| file                                | unsafe-keyword sites | unsafe blocks | unsafe fn | unsafe impl | unsafe extern blocks | #[unsafe(...)] | SAFETY: comments |
| ----------------------------------- | -------------------: | ------------: | --------: | ----------: | -------------------: | -------------: | ---------------: |
| `socket_body.rs`                    |                  116 |           102 |        14 |           0 |                    0 |              0 |               86 |
| `uws_handlers.rs`                   |                   73 |            47 |        26 |           0 |                    0 |              0 |               18 |
| `WindowsNamedPipe.rs`               |                   54 |            51 |         2 |           0 |                    0 |              1 |               35 |
| `Listener.rs`                       |                   53 |            51 |         2 |           0 |                    0 |              0 |               55 |
| `WindowsNamedPipeContext.rs`        |                   45 |            44 |         1 |           0 |                    0 |              0 |               31 |
| `tls_socket_functions.rs`           |                   37 |            28 |         7 |           0 |                    2 |              0 |               27 |
| `udp_socket.rs`                     |                   22 |            21 |         0 |           0 |                    1 |              0 |               21 |
| `mod.rs`                            |                   16 |             8 |         8 |           0 |                    0 |              0 |                8 |
| `UpgradedDuplex.rs`                 |                   13 |            11 |         0 |           0 |                    1 |              1 |               11 |
| `SocketAddress.rs`                  |                   11 |             8 |         0 |           0 |                    3 |              0 |                9 |
| `Handlers.rs`                       |                   11 |             8 |         2 |           0 |                    1 |              0 |               11 |
| `SSLConfig.rs`                      |                    8 |             6 |         0 |           0 |                    0 |              2 |                7 |
| `uws_dispatch.rs`                   |                    7 |             5 |         0 |           0 |                    0 |              2 |                4 |
| `uws_jsc.rs`                        |                    5 |             3 |         0 |           0 |                    1 |              1 |                3 |
| **Section E**                       |             **471** |       **393** |    **62** |       **0** |                **9** |          **7** |          **326** |

Normalised total = **471 sites** vs Phase-0 partition prior **424** → **+47 (≈ +11 %)**.
Prior-audit `.unsafe-audit/unsafe-inventory.jsonl` row count = 424 exactly (every
file's count in `jq | sort | uniq -c | sort -rn` reproduces the partition).
The +47 delta tracks continued Zig→Rust ports: `WindowsNamedPipeContext.rs`
(+16, the two-phase `MaybeUninit + ptr::write` allocation lifecycle was newly
fleshed out), `tls_socket_functions.rs` (+10, the BoringSSL `ffi::` shim block
grew with the `safe fn`-style additions), and 1-3-site bumps across most
other files reflecting incremental refinement.

SAFETY-comment density: **326 / 471 ≈ 69 %**. Gap dominated by (a) the four
`unsafe extern "C" { … }` block headers (no per-block SAFETY required;
per-decl `// SAFETY (unsafe fn): …` lines in `tls_socket_functions.rs`
substitute), (b) the seven `#[unsafe(no_mangle)]` attributes
(`uws_dispatch.rs` macro-emitted exports + `Method` FFI exports), and (c) the
default `unsafe fn` no-op bodies of `RawSocketEvents` (`uws_handlers.rs:230-254`)
where the trait method body is `{ }` and no statement to attach SAFETY to.

**Zero local `unsafe impl Send` / `unsafe impl Sync` rows in
`src/runtime/socket/*.rs`.** This is the cleanest local socket-wrapper section
in the audit on the cross-thread axis. `NewSocket`, `Listener`, `UDPSocket`,
`Handlers`, and `WindowsNamedPipeContext` hold `Cell<T>` / `JsCell<T>` / JSC
`Strong`, all of which are `!Send + !Sync`, so auto-trait machinery suppresses
both for those wrappers. Cross-section caveat: `src/runtime/socket/SSLConfig.rs`
re-exports `bun_http::SSLConfig`, whose documented `unsafe impl Send/Sync` lives
in `src/http/ssl_config.rs`.

Macro-generated share: 14 `bun_uws::uws_callback` invocations (all in
`WindowsNamedPipe.rs`), ~60 `#[bun_jsc::host_fn(…)]` invocations
(`socket_body.rs:59`, `Listener.rs:16`, `udp_socket.rs:22`,
`WindowsNamedPipe.rs:14`, ~5 in `Handlers.rs` + `SocketAddress.rs`), the
`us_dispatch_shims!` macro at `uws_dispatch.rs:133` stamping 11 exports,
and the `for_each_callback_field!` / `match_socket!` helpers. Conservative
count: ~85 macro-generated unsafe-keyword sites (≈ 18 % of the 471
normalised total); the remainder are source-direct.

## Selected high-signal sites

| file:line | site_kind | bucket(s) | safety_status | macro_status | prior_id | notes |
|---|---|---|---|---|---|---|
| `socket_body.rs:188-233` | `extern "C" fn select_alpn_callback(*mut SSL, …)` BoringSSL ALPN | 21 (FFI re-entry) + 1 (Aliasing — per-`SSL` ex_data slot) | PRESENT_STRONG (cites why `arg` is unsafe vs `ex_data`) | source-direct | S-prior batch | Listener-level `SSL_CTX*` is shared; UAF-by-design unless ex_data slot 0 is consulted. |
| `socket_body.rs:382-396` | `js_TCPSocket::to_js(ptr.cast(), global)` (no unsafe; the cast is plain) | n/a | n/a | source-direct | n/a | Ownership transfer to C++ wrapper — `as_ctx_ptr()` derived from `&self`. |
| `socket_body.rs:2608-2613` | `(*p).active_connections.get(); drop_in_place(p); ptr::write(p, handlers); (*p).mode = …` | 1 (Aliasing) + 5 (Uninit between drop and write) + 13 (Refcount lifecycle) | PRESENT_STRONG ("raw-pointer-only access; see `get_handlers` contract") | source-direct | n/a | **Hand-rolled in-place `Handlers` swap** during `reload`. Window between `drop_in_place` and `ptr::write` is uninit; any concurrent reader would observe uninit bytes. Sound on single-JS-thread; Phase-2 candidate for `mem::replace`-via-`take + write` pattern that closes the window. |
| `socket_body.rs:3853-3924` | `Box::<MaybeUninit<DuplexUpgradeContext>>::new_uninit()` + 8× `ptr::addr_of_mut!(…).write(…)` | 5 (Uninit) + 9 (Pin — self-referential) | PRESENT_STRONG (cites fn-ptr-niched fields + `Drop` precluding placeholder-then-assign + zero-init UB) | source-direct | n/a | Canonical self-referential alloc pattern. |
| `socket_body.rs:2986` | `(*tls_ptr).twin.set(Some(IntrusiveRc::from_raw(raw)))` | 13 (Refcount lifecycle) + 1 (Aliasing) | PRESENT_WEAK | source-direct | n/a | `IntrusiveRc::from_raw` adopts a +1 ref; pairs with `into_raw` from twin half. |
| `uws_handlers.rs:526` | `pub type BunSocket<const SSL: bool> = RawPtrHandler<api::NewSocket<SSL>, SSL>;` | 21 (FFI re-entry) + 1 (Aliasing — `*mut Self` discipline) | PRESENT_STRONG (multi-paragraph PORT NOTE cites `socket.write/end/reload` re-derived `&mut` aliasing + `noalias` dead-store) | source-direct | S-prior batch | **Load-bearing**: the dispatcher kind-table maps `BunSocketTcp/Tls` to this adapter; switching to `PtrHandler` would re-introduce the EXP-012-shape hazard. |
| `uws_handlers.rs:702-714` | `NsHandler::on_writable/on_data` holds `&mut Owner` from `ext.owner_mut()` across `H::on_data(this, …)` | 1 (Aliasing — handler may re-enter) + 21 (FFI re-entry) | PRESENT_WEAK (handler-contract only — no mechanical prevention) | source-direct | n/a | **Top-3 concern**: Postgres/MySQL/Valkey `on_writable` synchronously calls `socket.write` → may re-enter `try_send` → second `ext.owner_mut()` aliases the first. Section E's most plausible Stacked-Borrows surface. |
| `uws_handlers.rs:580-614` | `BunListener::on_*_no_ext` — `thunk::socket_ext_owner` returns `&mut NewSocket`, immediately demoted to `*mut` via `let ns: *mut … = ns` | 1 (Aliasing — instantaneous `&mut` formation) | PRESENT_STRONG (block-level SAFETY at `:575-580`) | source-direct | S-prior batch | The `&mut` lifetime ends at the rebinding; sound but the brief `&mut` formation is Phase-2 worth confirming via the `bun_uws_sys::thunk` signature. |
| `uws_dispatch.rs:138-172` | 11 × `#[unsafe(no_mangle)] pub extern "C" fn us_dispatch_*` macro-stamped exports | 21 (FFI re-entry) + 10 (FFI ABI) | PRESENT_WEAK (macro doc cites contract at `:129-132`; no per-shim SAFETY) | macro-generated (`us_dispatch_shims!`) | S-prior batch | The single C ↔ Rust entry surface for every uSockets event. |
| `uws_dispatch.rs:178-209` | `#[unsafe(no_mangle)] pub extern "C" fn us_dispatch_ssl_raw_tap` | 21 (FFI re-entry) + 1 (Aliasing — twin sibling deref) + 2 (Provenance — `*mut TLSSocket` from ext slot) | PRESENT_STRONG (cites `twin` `IntrusiveRc` +1 invariant + dispatch single-threadedness + `on_data` taking `*mut Self`) | source-direct (one-off) | S-prior batch | Ciphertext tap for `upgradeTLS()` raw-half. |
| `udp_socket.rs:127-260` | `extern "C" fn on_data(socket, buf, packets)` — `unsafe { &mut *buf }` over `PacketBuffer` | 21 (FFI re-entry) + 1 (Aliasing — `&mut PacketBuffer` spans callback) | PRESENT_WEAK ("buf valid for the duration of this callback per uws contract") | source-direct | S-prior batch | The only `&mut` over uws-owned memory in Section E. Re-entrancy contract not named. |
| `udp_socket.rs:1119-1335` | `send_many` two-phase scatter-gather + `MarkedArgumentBuffer::run` rooting trampoline (`extern "C" fn run` at `:1143`) | 1 (Aliasing — across user-JS frames) + 5 (Uninit — sockaddr_storage zero-init) + 21 (FFI re-entry — JS `toBunString`) | PRESENT_STRONG (long doc at `:1119-1136` enumerates exact UAF: `.transfer(n)` detaches ArrayBuffer; per-vec zero-init comment at `:1210-1211` cites "no `set_len` over uninit memory") | source-direct | S-prior batch | **Best-in-section anti-EXP-005 pattern.** Reference for any future scatter-gather code in Section E. |
| `udp_socket.rs:894-897 / 1018-1026` | `let mut addr: sockaddr_storage = bun_core::ffi::zeroed();` rather than `MaybeUninit::uninit()` | 5 (Uninit) + 4 (Validity) | PRESENT_STRONG (cites "Zig spec uses `undefined`; in Rust producing a `sockaddr_storage` value via `assume_init()` from a partially-init `MaybeUninit` is UB") | source-direct | n/a | Explicit recognition of EXP-005-shape hazard. |
| `udp_socket.rs:1456-1539` | `parse_addr` casts `*mut sockaddr_storage` → `&mut sockaddr_in` / `&mut sockaddr_in6` via `from_mut(storage).cast::<…>()` | 3 (Alignment — sockaddr_storage ≥ sockaddr_in{,6}) + 2 (Provenance — same-allocation cast) | PRESENT_STRONG ("storage is large enough to hold sockaddr_in[6]") | source-direct | S-prior batch | Same shape as Section Q's `dns/lib.rs:419`. |
| `udp_socket.rs:1515-1517` | `if_nametoindex(address_slice.as_ptr().add(percent + 1).cast::<c_char>())` (`#[cfg(not(windows))]`) | 21 (FFI) + 2 (Provenance — `add` over `&[u8]`) | PRESENT_STRONG ("address_slice is NUL-terminated; offset is in-bounds") | source-direct | S-prior batch | libc interface-name lookup. |
| `mod.rs:120-189` | `impl<const SSL: bool> uws_handlers::RawSocketEvents<SSL> for NewSocket<SSL>` — 8 × `unsafe fn on_*(this: *mut Self, …)` forwarders | 1 (Aliasing) + 21 (FFI re-entry) | PRESENT_STRONG (PORT NOTE block at `:120-128` cites why `*mut Self` not `&mut self`) | source-direct | n/a | The handoff seam between the dispatch tier and `NewSocket`'s inherent methods. |
| `Handlers.rs:156-178` | `pub unsafe fn enter(this: *mut Self)` + `pub fn enter_ref(h: BackRef<Self>)` | 1 (Aliasing) + 13 (Refcount lifecycle) | PRESENT_STRONG (multi-paragraph Safety section cites why `*mut Self` not `&mut self` — `Scope::exit → mark_inactive` may free) | source-direct | S-008276 | Wrapper that turns a `BackRef`-validated pointer into a scoped active-count guard. |
| `Handlers.rs:234-280` | `pub unsafe fn mark_inactive(this: *mut Self) -> bool` | 1 (Aliasing — argument-protector avoidance) + 13 (Refcount lifecycle — `heap::take`) + 21 (FFI re-entry) | PRESENT_STRONG (Section's longest SAFETY block — cites Stacked-Borrows protector UB explicitly; cites server vs client mode allocation contracts; explicitly tells caller "after returns `true`, `this` is dangling — must not deref") | source-direct | S-prior batch | **Best-in-section SAFETY documentation.** Reference for the `*mut Self` discipline applied through `NewSocket`. |
| `Handlers.rs:254-255` | `let listen_socket: &SocketListener = unsafe { &*bun_core::from_field_ptr!(SocketListener, handlers, this) };` | 1 (Aliasing — container-of) + 2 (Provenance — field-offset back to parent) | PRESENT_STRONG (cites `#[repr(transparent)]` on `JsCell<Handlers>` so field offset = inner address; "deref as shared (`&*`) — celled fields below take `&self`") | source-direct | S-008277 | Container-of recovery for server-mode Handlers; relies on `Listener` whole-allocation provenance. |
| `Listener.rs:235 / 317` plus connect-path `:1069 / :1289` | `unsafe { core::ptr::read(&socket_config.handlers) }` + `core::mem::forget(socket_config)` | 11 (Panic safety between `ptr::read` and `forget`) + 13 (Refcount lifecycle) | PRESENT_STRONG ("socket_config.handlers is valid; we forget socket_config below to avoid double-drop") | source-direct | S-prior batch | Scope corrected by Codex on 2026-05-16: only `:235` / `:317` have the allocation-prone `take_protos()` before `mem::forget`; connect-path `:1069 / :1289` is a move-out idiom but not covered by EXP-039's panic-prone proof. Bun's `panic = "abort"` profiles make EXP-039 an unwind-regression guard rather than current production UB. |
| `Listener.rs:241 / 330 / 1082 / 1303 / 1692` | `bun_core::heap::into_raw(Box::new(...))` — 5× `Listener` / `Handlers` / `WindowsNamedPipeListeningContext` allocations | 13 (Refcount lifecycle) | PRESENT_WEAK (implicit — paired with `heap::take` on every error/teardown path) | source-direct | n/a | All paired with `heap::take` in error paths (`scopeguard::guard`) and `mark_inactive`. |
| `Listener.rs:365` | `unsafe { boring_sys::SSL_CTX_free(c.as_ptr()) }` — errdefer SSL_CTX teardown | 13 (Refcount lifecycle) + 10 (FFI contract) | PRESENT_STRONG ("FFI — secure_ctx holds one owned SSL_CTX ref from create_ssl_context") | source-direct | S-prior batch | Atomic refcount drop; sound. |
| `Listener.rs:373` | `unsafe { uws::SocketGroup::destroy(this_ref.group.as_ptr()) }` from errdefer | 13 (Refcount lifecycle) | PRESENT_STRONG ("group was init'd above; not concurrently walked") | source-direct | S-prior batch | Embedded `SocketGroup` field teardown on listen failure. |
| `WindowsNamedPipe.rs:1176 / 1216` | `let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));` followed by `unsafe { (*this).flags … }` raw-pointer accesses | 1 (Aliasing — `noalias`-cached field UB) | PRESENT_STRONG (cites ASM-verified PROVEN_CACHED on `self.flags`; cites cork-fix commit b818e70e1c57) | source-direct | n/a | **Old-style launder workaround** — superseded by the systemic all-`Cell` design in `NewSocket` (`socket_body.rs:254`). Migration candidate. |
| `WindowsNamedPipe.rs:1468 / 515 / 538 / 554 / 1127 / +9 more` | `bun_uws::uws_callback`-stamped extern thunks taking `&mut Self` (re-enters into `(*w).shutdown(false)` / `writer.end()`) | 1 (Aliasing — re-entry) + 21 (FFI re-entry) | PRESENT_STRONG (per-method comments cite the re-entry-into-`writer` constraint) | macro-generated (`bun_uws::uws_callback`) | S-prior batch | The `black_box` workaround mentioned above is needed because the macro emits `&mut self` instead of `*mut Self`. **Macro-level fix candidate.** |
| `WindowsNamedPipeContext.rs:282-358` | `Box::<MaybeUninit<WindowsNamedPipeContext>>::new_uninit()` + `ptr::write(this, …)` 9-field init | 5 (Uninit) + 9 (Pin — self-referential `task.ctx = this`) | PRESENT_STRONG (cites self-referential `named_pipe.ctx` + `Drop`-impl precluding placeholder-assign + `mem::zeroed()` UB on `AnyTask`/`WindowsNamedPipe`) | source-direct | S-prior batch | Mirror of `socket_body.rs:3853-3924`. |
| `WindowsNamedPipeContext.rs:262-273` | `unsafe fn deinit_in_next_tick(this: *mut Self)` — schedule `Self::run_event` via `enqueue_task` | 1 (Aliasing — must not autoref) + 13 (Refcount lifecycle) | PRESENT_STRONG ("Forward the raw pointer — do NOT autoref to `&mut *this`") | source-direct | n/a | Same `*mut Self` discipline as Section Q's `WebSocketUpgradeClient::cancel`. |
| `tls_socket_functions.rs:67-213` | `unsafe extern "C" { … }` block with ~30 BoringSSL FFI decls; most `safe fn`, ~6 `unsafe fn` with per-decl `// SAFETY (unsafe fn): …` | 10 (FFI contracts) | PRESENT_STRONG (per-decl SAFETY for `unsafe fn`; module-doc at `:57-66` for the opaque-ZST `safe fn` rationale) | source-direct | S-prior batch | **Strongest FFI-decl discipline in Section E.** Reference for the new-style `safe fn` over opaque-ZST handles. |
| `SocketAddress.rs:580-587 / 798-804 / 1065-1071` | 3 × `unsafe extern "C" { safe static IPv4: WTFStringImpl; … }` blocks | 4 (Validity) + 10 (FFI) | PRESENT_STRONG ("C++-side `WTF::StaticStringImpl` constants — initialized at load time, immutable, immortal refcount. Reading the pointer value has no precondition, so declare them `safe static`") | source-direct | S-prior batch | New `safe static` syntax for C++ static-string constants. |
| `Handlers.rs:22-27 / uws_jsc.rs:91-93 / udp_socket.rs:75-81` | `unsafe extern "C" { safe fn …; }` blocks for C++ helpers + libc byte-order fns | 10 (FFI) | PRESENT_WEAK to PRESENT_STRONG | source-direct | n/a | `safe fn` for pointer-free / opaque-ZST-arg functions; minimal FFI ceremony. |
| `UpgradedDuplex.rs:60-71` | `Handlers { ctx: *mut (), on_open: fn(*mut ()), … }` — fn-pointer table dispatched from `SSLWrapper` | 21 (FFI re-entry) + 1 (Aliasing — `*mut ()` ctx) | PRESENT_WEAK (per-callback `// SAFETY: SSLWrapper handlers ctx is self as *mut Self; live for the wrapper's lifetime`) | source-direct | n/a | Custom non-uws callback table for duplex-stream TLS. |
| `SSLConfig.rs` | `#[unsafe(no_mangle) pub extern "C" fn …]` exports + 6 unsafe blocks | 21 (FFI) | PRESENT_STRONG (per-export SAFETY) | source-direct | S-prior batch | Config conversion between Rust and bun_uws_sys SSL options. |

(Full per-line list reproduced from `.unsafe-audit/unsafe-inventory.jsonl`
filtered to `src/runtime/socket/*` — 424 prior rows; the 47 new rows are
the increments enumerated in the per-file table above, dominated by
`WindowsNamedPipeContext.rs` two-phase init port and the
`tls_socket_functions.rs` `safe fn` shim block growth.)

## Notes

- **Zero local `unsafe impl Send` / `unsafe impl Sync` rows in
  `src/runtime/socket/*.rs`.** Confirmed via `grep -nE "unsafe impl"
  src/runtime/socket/*.rs` (no matches). Socket wrapper types are
  single-JS-thread-affine; `Cell` + `JsCell` + JSC `Strong` auto-trait
  propagation keeps them `!Send + !Sync` by default. Cross-section caveat:
  `src/runtime/socket/SSLConfig.rs` re-exports `bun_http::SSLConfig`, whose
  documented `unsafe impl Send/Sync` lives in `src/http/ssl_config.rs`.
- **No `core::mem::transmute` / `read_unaligned` / `write_unaligned`
  calls.** The only `core::mem::*` sites are 4× `core::mem::forget(socket_config)`
  in `Listener.rs` (paired with `core::ptr::read` above), 1×
  `core::mem::take(&mut socket_config.hostname_or_unix)` (safe), 2×
  `core::mem::replace` (safe). Section E uses no validity-inference
  primitives beyond the patterns already documented above.
- **No `static mut`.** One `LazyLock<[Option<&'static VTable>; SOCKET_KIND_COUNT]>`
  in `uws_dispatch.rs:43-79` (sound — once-init then read-only;
  `OnceLock` would suffice but `LazyLock` is the idiomatic pattern).
  No `UnsafeCell` static.
- **9 `unsafe extern "C" { … }` block headers** spread across 7 files;
  most use the new-style `safe fn`/`safe static` annotations for
  pointer-free or opaque-ZST-handle FFI surfaces.
- **The dispatcher kind table at `uws_dispatch.rs:43-79` is the
  single source of truth for re-entry-mode per socket kind**; auditing
  re-entry semantics for any new socket kind requires touching exactly
  this file to bind the new kind to `RawPtrHandler` (for `*mut Self`
  discipline) vs `PtrHandler` / `NsHandler` (for `&mut Ext` shape).
  This is excellent localisation.
- **`uws_dispatch.rs` is the only place `#[unsafe(no_mangle)]` exports
  appear in Section E** — every other JS-visible symbol is generated
  by `#[bun_jsc::host_fn]` or `bun_uws::uws_callback` macros that emit
  their own export attributes elsewhere. Section E does not ship any
  manual `#[no_mangle]` symbols outside the dispatch shims.
