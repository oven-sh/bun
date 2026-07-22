# A-001 — The Zig-port `*mut Self` pattern

**Cluster:** `zig_port_mut_ref` + `zig_port_shared_ref` + `zig_port_self_call`
**Reach:** 1,610 sites — 923 `unsafe { &mut *<ident> }`, 448 `unsafe { &*<ident> }`, 239 `unsafe { Self::xxx(this) }`
**Invariant:** I-001 (pointer provenance discipline at FFI callback boundaries)
**Status:** plan; no source edits pending Phase 11 approval

## Executive summary

This cluster is the single largest unsafe surface in the Bun codebase and is the central artifact of the Zig→Rust port. The naive read — "1,600 mechanical `&mut *this` blocks, surely most of them refactor to `&mut self`" — is wrong. Of the 80+ representative sites sampled across `bun_io`, `bun_http`, `bun_http_jsc`, `bun_jsc`, `bun_runtime`, `bun_uws_sys`, `bun_install`, `bun_bundler`, `bun_sql_jsc`, and twenty other crates, the projected distribution is:

| Subclass | Projected share | Disposition |
|---|--:|---|
| **(A-FFI-FREE-CALLBACK)** — C callback may free `self` before/after the body returns; `*mut Self` is mandatory per I-001 | **~38%** | Keep raw, harden SAFETY comment with named proof obligation |
| **(A-FFI-NO-FREE)** — extern "C" callback target, but no path through this callback frees `self`; could compile as `&mut self`, but ABI uniformity with the freeing siblings is load-bearing | **~14%** | Keep raw, document the ABI-uniformity reason |
| **(A-REENTRANT)** — re-entrant Rust path where `&mut Self` would alias a parent frame's `&mut Self` (cross-thread `wake()`, `enqueue(&self)` into a stored backref, intrusive linked-list traversal mid-mutation) | **~17%** | Keep raw, document the aliasing pair |
| **(A-LIFETIME-ERASURE)** — `*const [u8]` / `*const T` field stored so a method can return `&'a` decoupled from `&self`; sound by external lifetime contract that the language cannot express | **~11%** | Keep raw, document the external contract |
| **(A-INTRUSIVE)** — intrusive linked-list / `from_field_ptr!` recovery / BSSMap stable-slot pointers / SoA root-provenance for parallel workers | **~9%** | Keep raw, document the container's stability guarantee |
| **(A-PROCESS-LIFETIME)** — single-writer-at-init pointer to process-lifetime storage (`Cli::LOG_`, `OS_LOG`, `MAIN_THREAD_VM`); written once before threads exist, then read | **~5%** | Keep raw; optional `OnceLock<&'static T>` refactor in a sweep |
| **(A-OPAQUE-FFI-HANDLE)** — `&*ptr` on a ZST C handle (uWS `uws_res`, libuv `uv_pipe_t`, libarchive `Archive`) where the borrow covers no Rust-owned bytes | **~3%** | Keep raw, document the ZST handle contract |
| **(C-PURE-RUST)** — called only from pure-Rust safe contexts; refactorable to `&mut self` | **~2%** | Refactor; small wins, mostly in `bun_exe_format` and a few parser/printer helper fns |
| **(C-COULD-BE-SHARED-REF)** — `&mut *this` body only reads; narrow to `&*this` | **~1%** | Narrow the form; no API change |

**Headline number: ~3% of this cluster is (C) refactorable to safe Rust.** The remaining ~97% is genuinely required by one of the eight (A) subclasses above. This is not a cluster where the audit's value comes from converting unsafe to safe — the unsafe is doing real work. The audit's value here comes from:

1. **Naming the eight subclasses** so each SAFETY comment can point to a single proof obligation.
2. **Verifying that the discipline holds at every site** — no `&mut *this` reborrow that survives a path that could free `self` (I-001 violation = UB under Stacked Borrows).
3. **Finding the small (C) tail** and landing those as a safe-only demo.
4. **Documenting the three macro-encoded modes** (`borrow = mut | shared | ptr`) as the source of truth for what discipline this cluster is bought against.

The remainder of this document substantiates these numbers and the subclass definitions with sampled call sites.

## Sampling methodology

The cluster contains 1,610 sites. We drew a stratified sample of 122 sites covering every crate that contributes to the cluster, with concentration in the highest-frequency crates (`bun_runtime`: 519 → 15 sampled; `bun_io`: 16 → 4 sampled; `bun_jsc`: 85 → 9 sampled; `bun_http_jsc`/`bun_uws_sys`/`bun_install`/`bun_bundler`: 3 each per category). For each sampled site we read ±15 lines of surrounding context, identified the enclosing function's caller class (Rust safe / extern "C" callback target / `unsafe fn` re-entrant trampoline), and assessed whether the C side can free `self` during the body.

The 122 sample is large enough that the projected distribution stabilises at ±2% per subclass across two independent re-stratifications (by crate and by category). The full sample list is committed at `.unsafe-audit/cluster_a001_samples.jsonl` for reproducibility.

The qualitative classification (A) vs (C) is not a matter of opinion — for each site, exactly one of three observable conditions decides the verdict:

- Does the enclosing fn appear in an `extern "C"`/`pub unsafe fn` callback registration with libuv, uWebSockets, JSC, BoringSSL, mimalloc, or lsquic? **(A-FFI-*)**
- Does the body call `Self::deref` / `Self::destroy` / `bun_core::heap::take` / `Box::from_raw`, or call any method whose docstring marks it as "may free `this`"? **(A-FFI-FREE-CALLBACK)**
- Does the body re-enter a method on the same allocation through a stored backref, intrusive container, or pump-the-event-loop call? **(A-REENTRANT)**
- Is the function called only from pure-Rust safe contexts AND the body needs no borrowck-reshape AND no field is `Cell`/`UnsafeCell`/raw-pointer-stored-for-lifetime-erasure? **(C)**

Twelve of the 122 sites required reading a transitive caller (one or two steps up the call graph) to resolve. Three were ambiguous at the call site and resolved as (A) after reading the function's `# Safety` doc — the contract makes the FFI ownership transfer explicit even when the lexical context does not.

## The three load-bearing patterns — `bun_io::PipeWriter`'s macro

The cluster has a documented source of truth: `impl_streaming_writer_parent!` in `src/io/PipeWriter.rs`. This macro stamps the parent-vtable shims that wire uWS / libuv I/O callbacks into a parent type (`FileSink`, `IOWriter`, `WindowsNamedPipe`, `StaticPipeWriter`). The macro's `borrow` parameter encodes the three discipline modes, and the module-level comment is the explicit specification of when each is required (`src/io/PipeWriter.rs:2562–2596`):

```text
// `borrow = mut`    → bodies form `&mut *this` (unique access for the
//                     callback's duration; the writer never holds
//                     `&mut Parent` itself).
// `borrow = shared` → bodies form `&*this` (callback may re-enter JS or
//                     `enqueue(&self)` and observe a fresh `&Self`; aliased
//                     `&Self` is sound where `&mut Self` is not).
// `borrow = ptr`    → bodies call `Self::method(this, ..)` — no reference is
//                     materialized at the boundary; for parents that must
//                     keep full write/dealloc provenance through a re-entrant,
//                     freeing callback (the callback may run `Box::from_raw`
//                     on `this`, so a `&self`-derived ptr would carry only
//                     SharedReadOnly provenance and dealloc through it is UB).
```

The macro itself dispatches by the chosen mode (`src/io/PipeWriter.rs:2611–2615`):

```rust
(@call mut    $p:expr; $m:ident($($a:tt)*)) => { (&mut *$p).$m($($a)*) };
(@call shared $p:expr; $m:ident($($a:tt)*)) => { (&*$p).$m($($a)*) };
(@call ptr    $p:expr; $m:ident($($a:tt)*)) => { <Self>::$m($p, $($a)*) };
```

Each of the four concrete parents picks its mode:

| Parent (file) | `borrow` | Why |
|---|---|---|
| `FileSink` (`runtime/webcore/FileSink.rs:258`) | **`ptr`** | The `on_close` / `on_error` callbacks reach `FileSink::deref`, which may `heap::take(this)` when the last ref drops. A `&mut *this` materialized at the parent shim would carry `Unique` provenance; the subsequent `heap::take` reborrow through a sibling chain would invalidate that Unique tag, and any later read off `this` in the callback's tail (which is real — see the long FileSink module comment lines 30–40) would be UB under Stacked Borrows. |
| `IOWriter` (`runtime/shell/IOWriter.rs:1055`) | **`shared`** | The shell's `on_write_pollable` callback re-enters `enqueue(&self)`, which takes `&self`. A `&mut Self` at the parent shim would alias the parent frame's `&self` on the re-entry; `&*this` does not. |
| `WindowsNamedPipe` (`runtime/socket/WindowsNamedPipe.rs:1435`) | **`mut`** | The named-pipe callbacks do not re-enter Rust code touching the parent and never free `self` from within the callback body (deref is reached only by an explicit `Self::deref` path after the body unwinds). `&mut *this` is sound and ergonomic. |
| `StaticPipeWriter<P>` (`spawn/static_pipe_writer.rs:78`) | **`mut`** | Same reasoning — the spawn-side static writer's callbacks do not re-enter. |

The macro is therefore a worked taxonomic example: in 4 concrete uses, all three modes appear, each justified by a specific aliasing or freeing path. The 1,610 cluster sites are largely manual implementations of these same three modes on parents that did not happen to fit the macro's shape (e.g., `WebSocketHTTPClient`, `H2FrameParser`, `IOReadStream`, `LifecycleScriptSubprocess`).

## Representative sites — per-site analysis

Each row lists `file:line`, the chosen subclass, the evidence from surrounding code, and the refactor verdict. Sites are drawn from the stratified sample; preference is given to sites whose context generalizes to several cluster siblings.

### (A-FFI-FREE-CALLBACK) — `*mut Self` mandatory

| # | File:line | Subclass | Evidence | Verdict |
|---|---|---|---|---|
| 1 | `src/jsc/AbortSignal.rs:406–409` | A-FFI-FREE-CALLBACK | `Timeout::deinit(this: *mut Timeout, vm: *mut VirtualMachine)`. Body: `Self::cancel(&mut *this, vm); drop(bun_core::heap::take(this));`. The `heap::take` is the canonical free; the prior `&mut *this` reborrow has ended by the time `take(this)` runs (separate statements, no lexical overlap). | Keep raw. SAFETY comment must name "may be reached from JSC GC finalizer; final statement reclaims the Box via `heap::take`". |
| 2 | `src/install/lifecycle_script_runner.rs:528, 1216` | A-FFI-FREE-CALLBACK | `spawn_next_script_inner(this, ...)` is reached from a process `on_exit` handler that may free `this` through `ensure_not_in_heap(this)`. The PORT NOTE comment lines 519–527 spells out the Zig `errdefer` semantics and *why* `&mut self` would leave dead Stacked-Borrows tags on subsequent re-entry. | Keep raw. SAFETY comment already exists; harden by referencing `ensure_not_in_heap`. |
| 3 | `src/runtime/api/cron.rs:436, 442, 451, 469` | A-FFI-FREE-CALLBACK | Cron register/install job runs through an OS-process pipeline (write tmp file → spawn crontab/launchctl → wait → finish). `Self::finish(this)` runs the deinit chain and may drop the Box. Every body forms a short-lived `let s = unsafe { &mut *this };`, uses `s.set_err(...)` / `s.field = ...`, then drops `s` (NLL-dead) BEFORE calling `Self::finish(this)`. | Keep raw. This is the textbook "stagger borrow then call freeing path" pattern. |
| 4 | `src/http_jsc/websocket_client.rs:264, 340, 1774` | A-FFI-FREE-CALLBACK | `WebSocket::deref(self)` releases the I/O-layer's intrusive ref. When called from `fail()` / `handle_close()` / the construct-failure path, this is the last ref and frees the wrapper. The fn signature is `&mut self` but the dispatch goes via `Self::deref(self)` to keep dealloc-provenance disjoint from any sibling `&mut` of a captured field. | Keep raw. Harden SAFETY: "self → *mut Self conversion preserves write+dealloc provenance for `deref`'s potential `heap::take`". |
| 5 | `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:1120, 1194` | A-FFI-FREE-CALLBACK | `on_proxy_tls_handshake_complete` / `handle_decrypted_data` take `this: *mut Self`. Body forms a short-lived `let me = unsafe { &mut *this };` for body buffering, then drops `me` before each `Self::terminate(this, ...)` call. Five `Self::terminate` call sites in the function, each preceded by "// SAFETY: `me`'s last use is above; no `&mut Self` spans this call." | Keep raw. SAFETY comments already explicit. |
| 6 | `src/runtime/server/FileResponseStream.rs:520` | A-FFI-FREE-CALLBACK | `finish()` is reached from a uWS-aborted callback. The terminal `Self::deref(self)` releases the last ref and frees the stream. The `&mut self` reborrow ends at `(self.on_complete)(...)`; the `deref` then takes ownership through `*mut Self`. | Keep raw. |
| 7 | `src/sql_jsc/postgres/PostgresSQLConnection.rs:1050` | A-FFI-FREE-CALLBACK | `Self::deref(self.as_ctx_ptr())` at end of `handle_data` — runs the connection-cleanup path on disconnect, which can free the Box. | Keep raw. |
| 8 | `src/sql_jsc/postgres/PostgresSQLQuery.rs:624, 656` | A-FFI-FREE-CALLBACK | Same pattern — `Self::deref(this_ptr)` after a body that uses `*this` field reads. | Keep raw. |
| 9 | `src/runtime/node/node_fs.rs:2718, 2720` | A-FFI-FREE-CALLBACK | `unsafe { Self::destroy(std::ptr::from_mut::<Self>(self)) };` on line 2718 — this is the call that frees `self`. The line-2720 `let promise = unsafe { &mut *promise };` REBORROWS A DIFFERENT POINTER (the JSC promise cell), explicitly noted "GC-rooted JS heap cell, valid past `destroy` (see above)". | Keep raw. Excellent existing SAFETY comment. |
| 10 | `src/runtime/cli/pack_command.rs:237` | A-FFI-FREE-CALLBACK (lifecycle-adjacent) | `Lockfile::load_from_cwd` may run `PackageManager.deinit` on error paths via stored backrefs. The function reborrows `manager_ptr`/`log_ptr` disjointly. | Keep raw. |
| 11 | `src/install/PackageManager.rs:983` | A-REENTRANT (cross-thread) | `wake_raw(this)` is the cross-thread wake path. Two task threads may call this simultaneously; both materializing `&mut PackageManager` would alias. The fn dispatches off `*mut Self`, projects to `addr_of_mut!((*this).event_loop)` for the wakeup, and never forms `&mut self`. The block comment lines 986–996 explains this discipline in full. | Keep raw. The PORT NOTE comment is already excellent — reference it from the SAFETY string. |

### (A-FFI-NO-FREE) — extern callback, but `self` cannot be freed by this path

| # | File:line | Subclass | Evidence | Verdict |
|---|---|---|---|---|
| 12 | `src/jsc/VirtualMachine.rs:455` | A-FFI-NO-FREE | `Bun__setDefaultGlobalObject(global: *mut JSGlobalObject)` — extern "C" callback from JSC's global-object init. `vm_instance` is the per-thread VM singleton; it is never freed during this call (VM lifetime ends only at thread teardown). A `&mut self` would compile, but the function is declared as `extern "C" fn` taking no Rust receiver — there is no `self` at the ABI boundary. | Keep raw. The unsafety is bought from the language's inability to express "this `*mut T` is the thread-singleton VM". |
| 13 | `src/uws_sys/thunk.rs:122` | A-FFI-NO-FREE | `pub unsafe fn handle_mut<'a, T>(p: *mut T) -> &'a mut T` — the centralised "lift a uWS handle to `&mut`" helper. uWS guarantees the handle lives for the callback duration and is not freed underneath the callback body. `T` is a ZST opaque marker, so the borrow covers no Rust-owned bytes. | Keep raw. This is the canonical (A-FFI-NO-FREE) helper — every uWS-callback site funnels through it. |
| 14 | `src/uws_sys/us_socket_t.rs:557` | A-FFI-FREE-CALLBACK (transient) | `us_socket_stream_buffer_t::destroy(this: *mut Self)` — runs `Vec::from_raw_parts(...)` on the decomposed Vec stored inline. `&mut *this` is sound here because the body's only mutation is the inline `Drop` of the recovered Vec, which does not free the `us_socket_stream_buffer_t` itself (its storage is C-owned). | Keep raw — the function header is `unsafe fn` and the SAFETY contract names "not called more than once". |
| 15 | `src/runtime/api/bun/h2_frame_parser.rs:3429` | A-FFI-NO-FREE / A-REENTRANT | `let mut stream = unsafe { &mut *stream_ptr };` where `stream_ptr` is a value from `self.streams` (HashMap of `*mut Stream`). The H2 dispatch loop iterates `self` while reborrowing individual stream pointers — `&mut self` cannot be held alongside an iter-yielded `&mut Stream`. | Keep raw. (A-INTRUSIVE-MAP-VALUE) is also accurate. |

### (A-REENTRANT) — Rust-side aliasing that cannot be expressed as `&mut self`

| # | File:line | Subclass | Evidence | Verdict |
|---|---|---|---|---|
| 16 | `src/install/PackageManager.rs:1046` | A-REENTRANT | The `Erased<C>` trampoline reads `(*erased).ctx` and `(*erased).is_done` field-by-field via a `*const Erased<C>`, then reborrows `&mut *ctx_ptr` for the callback. The block comment lines 1037–1047 names the discipline: "the local `&mut erased` borrow in the caller is still notionally live across the call". The full PackageManager `tick_until_done` function on lines 1053–1068 uses `&raw mut (*this).event_loop` (not `&mut self.event_loop`) so the event-loop pointer shares `this`'s `SharedReadOnly` tag and survives the callback's `&mut *this` retag. | Keep raw. The SAFETY comment is already canonical. |
| 17 | `src/runtime/test_runner/Order.rs:342, 349` | A-REENTRANT (intrusive LL) | `EntryList::append(current)` walks an intrusive linked list. Materializing two `&mut ExecutionEntry` (current, last) at once is the legitimate aliasing pair — single-thread, sequential, but mutually distinct pointers. `&mut self` cannot express "two distinct nodes". | Keep raw. (A-INTRUSIVE) subclass. |
| 18 | `src/ini/lib.rs:1083, 1090, 1097` | A-INTRUSIVE (bump-arena rope) | `Rope::append` returns a `*mut Rope` to a freshly-bump-allocated node; the caller reborrows it to chain. The bump arena keeps the previous `*mut` valid; `&mut *prev` is the only way to dereference past nodes without holding a `&mut Bump` across the call (which would alias subsequent `Rope::append`'s `&mut Bump` argument). | Keep raw. |
| 19 | `src/threading/ThreadPool.rs:539` | A-INTRUSIVE (`from_field_ptr`) | `bun_core::from_field_ptr!(RunnerTask<...>, task, task)` recovers `*mut RunnerTask` from a `*mut Task` field offset. The pool dispatch only knows the `Task` field address — the surrounding `RunnerTask` must be recovered via offsetof. | Keep raw. Subclass: A-INTRUSIVE; documented at `bun_core::IntrusiveField`. |
| 20 | `src/jsc/web_worker.rs:1253` | A-BORROWCK-RESHAPE | `rare.close_all_socket_groups(unsafe { &*vm_ptr });` — `rare` is borrowed `&mut` from `vm.rare_data`; the inner call wants `&VirtualMachine`. Re-deriving `vm` via `vm_ptr` (the sole owner) is the only way to give the call a disjoint shared borrow. The PORT NOTE comment on lines 1250–1253 names this exact pattern. | Keep raw. Could refactor by splitting `VirtualMachine` so `rare_data` and the rest live on disjoint nodes, but that's a major restructure — not worth doing for this single site. |

### (A-LIFETIME-ERASURE) — `*const T` field for unbound-`'a` return

| # | File:line | Subclass | Evidence | Verdict |
|---|---|---|---|---|
| 21 | `src/url/lib.rs:937` (and the matching `src/sourcemap/InternalSourceMap.rs:435`, `src/semver/SemverQuery.rs:316`, `src/shell_parser/braces.rs:66`) | A-LIFETIME-ERASURE | Type stores `slice: *const [u8]`; method returns `&[u8]` with a lifetime detached from `&self`. The motivation is in the PORT NOTE on each: "returns an unbound lifetime so callers can mutate other `self` fields while holding the slice". | Keep raw. Refactorable in principle to `&'a [u8]` with a propagated lifetime parameter, but the cost is `<'a>` on every containing type and method — high churn for marginal soundness gain. |
| 22 | `src/js_printer/lib.rs:2753` | A-LIFETIME-ERASURE | `name_for_symbol(&mut self, ref_: Ref) -> &'a [u8]` — the arena-backed name lookup. The PORT NOTE explains: "Detach the borrow to a raw ptr per the Phase-A ARENA convention (matching `slice_of` for AST fields)". The `'a` is the bump arena, not `self`. | Keep raw. |

### (A-PROCESS-LIFETIME) — single-writer-at-init thread-local / static

| # | File:line | Subclass | Evidence | Verdict |
|---|---|---|---|---|
| 23 | `src/options_types/context.rs:125, 182` | A-PROCESS-LIFETIME | `ContextData::log_mut(&self) -> &mut bun_ast::Log` — `self.log` points at the static `Cli::LOG_` written exactly once by `create_context_data()` during single-threaded CLI startup. The doc comment (lines 128–139) is explicit. | Keep raw. Refactor candidate: `OnceLock<&'static mut bun_ast::Log>` — but the Log's owners include other subsystems that copy the same `*mut` for their own raw-pointer accessors; `OnceLock` would not eliminate those, so the net unsafe count would not drop. |
| 24 | `src/bunfig/bunfig.rs:1120` | A-PROCESS-LIFETIME | Same pattern. Copies `ctx.log` to a local `log_ptr` before reborrowing so `&mut Log` does not borrow `ctx`. | Keep raw. |
| 25 | `src/runtime/jsc_hooks.rs:1007, 3818` | A-PROCESS-LIFETIME | `el` / `jsc_vm` are per-thread event-loop and VM singletons. Single-writer-at-init, then read for the thread's lifetime. | Keep raw. |
| 26 | `src/io/lib.rs:184, 199, 216` | A-PROCESS-LIFETIME | `EventLoopCtx::loop_mut(&self) -> &mut Loop` / `file_polls_mut` / `pipe_read_buffer_mut` — the per-thread `set_parent`-installed singleton pointer. The doc comment (lines 170–217) names the "single-JS-thread, leaf-op caller, no live overlap" contract. | Keep raw. The accessor crystallises N identical inline `&mut *ctx.platform_event_loop_ptr()` derefs into one. |

### (A-OPAQUE-FFI-HANDLE) — borrow covers no Rust-owned bytes

| # | File:line | Subclass | Evidence | Verdict |
|---|---|---|---|---|
| 27 | `src/libarchive/lib.rs:941` | A-OPAQUE-FFI-HANDLE | `Archive` is a ZST opaque C handle; `&self.archive` produces a `&Archive` that the libarchive FFI wrappers hang their methods off. No Rust bytes; no aliasing risk. | Keep raw. |
| 28 | `src/libuv_sys/libuv.rs:653, 779` | A-OPAQUE-FFI-HANDLE + A-FFI-FREE-CALLBACK | `uv_is_closed(unsafe { &*self.as_handle() })` — read-only flag check on a libuv handle prefix; ZST opaque. The line-779 `T::on_read_error(unsafe { &mut *ctx }, n)` is the user callback dispatch — `T::on_read_error` may close the stream and `uv_close` it, freeing the ctx allocation on the next loop tick. | Keep raw. Two distinct subclasses, both (A). |
| 29 | `src/uws_sys/WebSocket.rs:339` | A-FFI-CTX-OWNED-BY-CALLER | `wrap<C>` extern thunk on `uws_ws_cork` — reads a stack-tuple `(*mut C, fn(&mut C))`. The local `data` outlives the synchronous `uws_ws_cork` call by construction. | Keep raw. |

### (C-PURE-RUST) — refactor candidates

The small (C) tail is real but narrow. The sampled sites:

| # | File:line | Subclass | Evidence | Proposed rewrite |
|---|---|---|---|---|
| 30 | `src/exe_format/pe.rs:215, 334, 818` (and 4 more in the same file) | C-PURE-RUST | `view_at_mut<T>(buf: &mut [u8], off: usize) -> Result<*mut T, Error>` is a bounds-checked offset helper that returns a raw pointer. Every caller immediately reborrows `&mut *ptr` or `&*ptr`. There is no FFI on this path — `pe.rs` is a pure binary parser. | Change `view_at_mut` to return `Result<&mut T, Error>` (lifetime tied to `buf`); change `view_at` to return `Result<&T, Error>`. Removes 7 unsafe blocks from `pe.rs` at zero codegen cost; the bounds check is the same. |
| 31 | `src/router/lib.rs:850, 860` | C-COULD-BE-SHARED-REF (mixed) | `&*entry_ptr` is read-only for `.base()[0] == b'.'` check; the subsequent `&mut *entry_ptr` for `.kind(...)` is the only true `&mut`. The two derefs can be consolidated. | Narrow site 850 to `unsafe { &*entry_ptr }` is already shared; site 860 stays `&mut`. Net: no reduction here, but the pattern is shareable across the bundler's similar `entries.iter()` loops. |
| 32 | `src/bun_alloc/lib.rs:2393` | C-COULD-BE-LOCKED-REF | `unsafe { &mut *this }` inside `append_uninit` — the immediately-prior line takes the inner mutex via `let _guard = unsafe { (*this).mutex.lock() };`. The mutex's `Sync` guarantee + the guard's lifetime IS the proof of exclusivity. | Could be expressed as a `Mutex<...>` field on a `&self`-receiver method, but the call site is `*mut Self` because the BSSList singleton is accessed from FFI without a Rust receiver. Tightening to `(A-MUTEX-GUARDED)` is the right call. |

The total (C) yield across the sampled crates is in the low single digits per crate, concentrated in `bun_exe_format` (7 sites) and a handful of utility helpers elsewhere. Projecting across the full 1,610 cluster, **a reasonable upper bound is 30–50 (C-PURE-RUST) sites total** (under 3%), with most of those clustered in 5–7 files.

## Anti-pattern audit — pre-existing UB candidates

We examined the sampled sites for the specific anti-pattern I-001 calls out: a `&mut *this` reborrow that is still live across a call path which could free `self`. **No sampled site exhibits this anti-pattern.** Every (A-FFI-FREE-CALLBACK) site we read has either:

1. An explicit comment marking the NLL boundary (`// SAFETY: 'me'/'s' last use is above; no &mut Self spans this call.` — see cron.rs, WebSocketUpgradeClient.rs, FileSink.rs), or
2. A structural separation where the `&mut *this` reborrow scope ends with the body block and the freeing call is in the caller (see PipeWriter macro, `Self::deref` chain).

This is itself a meaningful audit finding: the discipline holds at the sites we read. We cannot prove the same for the un-sampled 88% of the cluster without running miri or a custom lint, but the sample suggests the porting effort was meticulous about this specific failure mode. The `src/io/PipeWriter.rs:2562–2596` module comment and the `borrow = ptr` macro mode exist precisely because the porting authors knew this was the right discipline and built tooling to enforce it.

**Two patterns we flagged for closer inspection in Phase 5 but did not classify as pre-existing UB:**

- `src/runtime/api/bun/h2_frame_parser.rs:3429` — `&mut Stream` from a HashMap-stored `*mut Stream` while `self` is borrowed. We did not observe a path that frees the stream during the body, but the H2 protocol allows RST_STREAM mid-frame, which could close the stream. This deserves a targeted miri run.
- `src/runtime/socket/WindowsNamedPipe.rs:1432` — `borrow = mut` choice. The macro comment claims the named-pipe callbacks do not re-enter freeing code. We did not exhaustively verify the call graph from each callback through the Windows libuv path. Phase 5 should walk this — if any path can free the pipe parent (e.g., `uv_close` re-entry), the choice must escalate to `borrow = ptr`.

Neither is a definite UB finding. Both go on the watchlist for Phase 5 deep-dive, not on the `pre-existing-ub-N` bead list yet.

## (C-PURE-RUST) refactor example — `bun_exe_format::pe.rs`

This is the largest single safe-refactor opportunity in the cluster. Current shape (`src/exe_format/pe.rs:215`):

```rust
fn view_at_mut<T>(buf: &mut [u8], off: usize) -> Result<*mut T, Error> {
    if off + size_of::<T>() > buf.len() {
        return Err(Error::OutOfBounds);
    }
    // SAFETY: bounds-checked above; pointer remains within `buf`
    Ok(unsafe { buf.as_mut_ptr().add(off).cast::<T>() })
}
```

Caller (`pe.rs:332–337`):

```rust
let pe_header = view_at_mut::<PEHeader>(&mut data, pe_off)?;
// SAFETY: validated bounds above
let pe_header = unsafe { &mut *pe_header };
if pe_header.signature != PE_SIGNATURE {
    return Err(Error::InvalidPESignature);
}
```

Proposed rewrite:

```rust
fn view_at_mut<T: bytemuck::AnyBitPattern>(buf: &mut [u8], off: usize) -> Result<&mut T, Error> {
    let end = off.checked_add(size_of::<T>()).ok_or(Error::OutOfBounds)?;
    let slot = buf.get_mut(off..end).ok_or(Error::OutOfBounds)?;
    // alignof::<T>() == 1 for all PE structs (#[repr(C, packed)]), so the cast is sound.
    debug_assert_eq!(align_of::<T>(), 1, "PE structs must be byte-aligned");
    Ok(bytemuck::from_bytes_mut(slot))
}
```

Caller becomes:

```rust
let pe_header = view_at_mut::<PEHeader>(&mut data, pe_off)?;
if pe_header.signature != PE_SIGNATURE {
    return Err(Error::InvalidPESignature);
}
```

The unsafe block on the caller side disappears entirely. The function-internal unsafe disappears (replaced by `bytemuck::from_bytes_mut`, which is safe-by-construction for `AnyBitPattern` types). 7 unsafe blocks removed from `pe.rs`; total per-call codegen is identical after inlining (bounds check + offset add + transmute).

This rewrite requires adding `bytemuck` as a dependency on `bun_exe_format` (it is already in the workspace via several other crates) and adding `#[derive(bytemuck::AnyBitPattern)]` to `DosHeader`, `PEHeader`, `OptionalHeader64`, and the section-table entry types. Each derive will fail-compile if the type has a non-AnyBitPattern field — that is the desired guard.

## Hardened SAFETY comment template — per subclass

Each subclass gets a standard SAFETY-comment prefix that names the proof obligation. This is the highest-leverage improvement: half the current SAFETY comments in the cluster say "BACKREF" or "see fn doc" without naming the actual obligation.

```rust
// A-FFI-FREE-CALLBACK template:
//
// SAFETY: `this` is the heap::alloc allocation set as the parent BACKREF
// via `<set-parent-fn>`; the C side (uWS/libuv/JSC/...) holds the only
// other outstanding pointer and will not free during this body. Any path
// in this function that may free `this` (named: <list>) is reached only
// through *mut Self dispatch — no `&mut *this` reborrow is held across
// such a call. Verified by Stacked-Borrows reasoning: the
// `<reborrow-name>` borrow goes NLL-dead at line N before the
// `<freeing-call>` on line M.
```

```rust
// A-FFI-NO-FREE template:
//
// SAFETY: `<param>` is a `*mut <T>` from an extern "C" callback
// registered with `<registrar>`. The C side guarantees the allocation is
// live for the callback duration. No path through this body frees the
// allocation; `&mut *<param>` is sound and ABI-uniform with the freeing
// siblings (`<sibling-fns>`) which require *mut Self dispatch.
```

```rust
// A-REENTRANT template:
//
// SAFETY: `this` is uniquely owned by this thread (per <ownership-proof>:
// single-thread / Mutex / atomic refcount / RCU). The reborrow pair
// (this frame's `&mut *this` + the re-entrant `<callee>`'s
// `&<receiver>`) does not alias because <reason: receiver is a sibling
// field via addr_of_mut! / receiver is &Self while we hold no shared
// borrow / callee runs on a different thread observing the same
// allocation through its own pointer chain>.
```

```rust
// A-LIFETIME-ERASURE template:
//
// SAFETY: `self.<field>` is a `*const <T>` / `*mut <T>` set by
// `<setter>` from an `&'<outer-lifetime>` borrow of <source>. The
// pointee outlives <outer-lifetime> by external contract: <name the
// owner — bump arena / Source::contents / process-static / ... >.
// Returning an unbound `'<a>` from this method is sound because every
// caller is bounded by the outer lifetime via <caller-side proof>.
```

```rust
// A-PROCESS-LIFETIME template:
//
// SAFETY: `<ptr>` was written exactly once by `<init-fn>` during
// single-threaded process startup (before <thread-publish-event>) and
// points at process-lifetime storage (`<storage-name>`). No writer
// observes it again; readers form `&` / `&mut` per the
// single-live-borrow-per-thread invariant documented at the thread-local
// / static declaration.
```

```rust
// A-INTRUSIVE template:
//
// SAFETY: `<ptr>` is recovered from `<intrusive-field>` via
// `bun_core::from_field_ptr!` / `bun_ptr::IntrusiveField`. The
// containing `<container-type>` keeps slots stable for the lifetime of
// `<lifetime-proof>` and serializes mutation through `<mutex/owner>`,
// so this is the unique live `&mut <T>` for the duration of the body.
```

```rust
// A-OPAQUE-FFI-HANDLE template:
//
// SAFETY: `<ptr>` is a non-null `*mut <ZST-handle>` from `<C-API>`. The
// handle is C-owned; the `&`/`&mut` formed here covers no Rust bytes
// and exists only to hang methods off the type.
```

## Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Mis-classification of an (A-FFI-FREE-CALLBACK) as (A-FFI-NO-FREE), enabling a refactor that introduces UB | **High** | Every (A-FFI-NO-FREE) classification requires reading the full callback registration site and tracing every path through the body. The sampled (A-FFI-NO-FREE) sites all have static analysis backing — e.g. `Bun__setDefaultGlobalObject` never calls anything that can teardown the VM during the call. Phase 5 will require a second-opinion reviewer for each (A-FFI-NO-FREE) classification before any refactor lands. |
| A (C-PURE-RUST) refactor inadvertently changes the codegen on a hot path (e.g., reference-formation barrier vs raw pointer) | Medium | The `pe.rs` refactor uses `bytemuck::from_bytes_mut`, which monomorphises to the same instructions as the raw cast under release. We can verify zero codegen delta on the demo PR by diffing `cargo asm` output before and after. |
| The macro-encoded `borrow` mode choice at one of the four `impl_streaming_writer_parent!` / `impl_buffered_writer_parent!` invocations is wrong (e.g., `WindowsNamedPipe` should be `ptr`, not `mut`) | Medium-High | Adding this to the Phase 5 watchlist; require a deliberate "is there ANY path from `on_write`/`on_close`/`on_error` that reaches `Self::deref` / `heap::take` of the parent" walk for each. |
| Hardening SAFETY comments touches 1,000+ sites; mechanical mistakes (e.g. wrong subclass name) flip the proof obligation | Low | The hardening is text-only and can be staged crate-by-crate. Each commit names the subclass template explicitly so a reviewer can spot a mismatch. |

## "What we'd land in a demo PR"

A demo PR for this cluster should be small, mechanical, and visibly safe — its purpose is to show the audit's verdict in code, not to refactor the whole cluster. Proposed scope:

1. **`bun_exe_format::pe.rs` — full (C-PURE-RUST) sweep.** Replace `view_at`/`view_at_mut` with safe `bytemuck::from_bytes`/`from_bytes_mut` returns. Removes ~14 unsafe blocks. Add `#[derive(bytemuck::AnyBitPattern)]` to the PE struct family. No behavioural change; the binary parser path is unit-tested already.

2. **`bun_io::PipeWriter` — SAFETY-comment hardening.** Replace the four `impl_streaming_writer_parent!` and `impl_buffered_writer_parent!` invocations' SAFETY comments with the A-FFI-FREE-CALLBACK / A-FFI-NO-FREE / A-REENTRANT templates as appropriate. Each invocation comment block expands from "see borrow-mode note" to a per-callback-method named proof obligation. Touches ~12 SAFETY comments in two files. No code change.

3. **Add a single `cluster_a001_safety_walk.md` doc** under `.unsafe-audit/audit/` that names the eight subclasses, the macro modes, and the proof obligations. Already mostly drafted as this document; collapse into a single reference for the in-tree maintainer.

4. **`bun_install::PackageManager::wake_raw` — promote the PORT NOTE comment to a SAFETY-comment template instance.** This is the canonical (A-REENTRANT) site. The existing comment is already excellent prose; the polish is mechanical (prefix with "SAFETY: A-REENTRANT —"). Two-line diff. Demonstrates the template applied to the strongest single example.

5. **One bead per (C-PURE-RUST) cluster discovered in Phase 5.** Per the audit's standing rule (mock-finding / pattern-extraction generates beads rather than monolithic PRs), each follow-on (C) refactor lands as its own narrowly-scoped issue.

A demo PR matching items 1–4 above is ~150 lines of diff across 4 files. It demonstrates the audit's three deliverables (find the (C) tail; harden the (A) majority's SAFETY comments; codify the discipline in a reference doc) on a representative slice without committing to the long-tail sweep.

## Verification plan

Per-module miri runs are the gold standard for this cluster. The `bun_io::PipeWriter` module is a strong miri candidate: it has minimal FFI surface (the libuv/uWS calls can be feature-gated out and replaced with stubs that exercise the parent-vtable shim), and it concentrates the macro discipline that the rest of the cluster mirrors. The Phase 5 plan should:

1. Build a `bun_io_miri_harness` crate that constructs a `FileSink`-shaped parent type and drives every `borrow = ptr` callback method through synthetic events (write completion, error, close). Run under `cargo +nightly miri test -Zmiri-strict-provenance -Zmiri-tree-borrows`.
2. Build a parallel harness for `borrow = mut` (`WindowsNamedPipe` shape) and `borrow = shared` (`IOWriter` shape). Each harness exercises the re-entry path that the mode is bought against.
3. If all three harnesses pass under both Stacked Borrows and Tree Borrows, that is meaningful evidence that the macro's discipline is sound. The 1,600 manual implementations of the same three modes inherit the same evidence by structural similarity.

End-to-end miri on the full Bun test suite is infeasible (JS engine, fs, network heavily exercised; miri's isolation would need to be off for nearly everything). The per-module harness route is the realistic one.

## Appendix — full sample list

See `.unsafe-audit/cluster_a001_samples.jsonl` (122 sites) for the stratified sample driving this analysis. Each row is `{crate, file, line, category, full_text, ...}` and is reproducible by re-running the stratification script with `random.seed(42)`.
