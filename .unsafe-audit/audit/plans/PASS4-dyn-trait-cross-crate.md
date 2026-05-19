# Pass 4 — `dyn Trait` & Cross-Crate Send/Sync Composition Audit

**Date:** 2026-05-15
**Auditor:** Codex (Opus 4.7 1M context)
**Targets:**
1. `Box<dyn>` / `Arc<dyn>` / `Rc<dyn>` / `&dyn` / `&mut dyn` trait-object usage
2. Cross-crate compositions of types carrying `unsafe impl Send`/`unsafe impl Sync`

**Discipline:** Every T1 (definite UB) finding requires a concrete cross-thread reachability path. T2 = latent footgun, no current callsite reaches it. T3 = stylistic / could be tightened. Negative findings are stated explicitly so reviewers know what was investigated and cleared.

---

## Executive summary

| Bucket                                                        | Count   |
| ------------------------------------------------------------- | ------- |
| Total `dyn Trait` mentions (incl. comments) in `src/`         | 235     |
| Non-comment `dyn` sites                                       | 162     |
| `Box<dyn Trait>` owned trait-object sites                     | **5**   |
| `Arc<dyn Trait>` sites                                        | **0**   |
| `Rc<dyn Trait>` sites                                         | **0**   |
| `Pin<Box<dyn Future + Send>>`                                 | **0**   |
| `&dyn` / `&mut dyn` (borrowed trait objects)                  | ~150    |
| Total `unsafe impl Send for` / `unsafe impl Sync for` sites   | **164** |
| Distinct files containing such impls                          | 76      |
| Distinct crates containing such impls                         | 24      |

| Findings tier | Count |
| ------------- | ----- |
| T1            | **0 new** |
| Pre-existing T1 re-confirmed | **1** |
| T2            | **5 new** |
| T3            | **4** |
| Negative      | 12    |

**Headline takeaways**

- Part 1 is **vacuously clean**: the Rust port deliberately avoids owned-pointer trait objects (`Box/Arc/Rc<dyn T>`) almost entirely. The five owned `Box<dyn>` sites are all reviewed below; none currently cross threads with a missing `Send` bound. There are **zero** `Arc<dyn>` and **zero** `Pin<Box<dyn Future>>` sites — the runtime does not use `tokio`/`async-std` at all (only two `impl Future`-shaped hits, both for a custom `WritableFuture` enum). The classic "`Box<dyn Foo>` defaults to `+ 'static` and is silently `!Send`" hazard class is therefore essentially non-existent in the workspace today.
- Part 2 is a long tail of explicit, individually-justified `unsafe impl Send/Sync`. Each one names its synchronization story (mutex, atomic refcount, single-thread-affinity, init-once-then-read-only). The composition risk is concentrated in a handful of **unbounded-generic** impls (`StoreSlice<T>`, the `owned_task!` macro, `ConcurrentPromiseTask<C>`, `WorkTask<C>`, `JsCell<T>`) where `Send`/`Sync` is asserted regardless of the parameter's own auto-traits. Pass 4 found no *new* dyn-trait T1, but it re-confirms `StoreSlice<T>` as the already-counted Pass 2 T1: the safe type can express `StoreSlice<Cell<u32>>: Send + Sync`, while the sister `StoreRef<T>` correctly bounds `T`. The remaining unbounded-generic cases are T2 unless a concrete current bad caller is shown.
- A handful of pre-existing `TODO(ub-audit)` markers (in `src/bundler/Chunk.rs` and `src/runtime/webcore/blob/copy_file.rs`) acknowledge the same hazards that this pass re-derives independently. No new T1 was uncovered that the codebase has not already self-flagged.

---

# Part 1 — `dyn Trait` audit

## 1.1 Methodology

```
rg -n 'Box<\s*dyn|Arc<\s*dyn|Rc<\s*dyn|Pin<Box<\s*dyn' --type rust src/   # owned
rg -n '&\s*dyn|&mut\s+dyn' --type rust src/                              # borrowed
rg -n 'async fn|impl .* Future\b|: Future\b' --type rust src/            # async / Future
rg -n 'std::thread::spawn|thread::Builder|tokio::spawn|rayon::spawn' …   # thread spawn sites
```

Categorized by ownership form, Send/Sync bound presence, lifetime presence, and reachability into cross-thread code paths.

## 1.2 Inventory — owned trait objects (`Box<dyn T>`)

There are exactly five non-comment `Box<dyn T>` sites in `src/`. All others (`Arc<dyn>`, `Rc<dyn>`, `Pin<Box<dyn Future>>`) are zero.

| # | Site (file:line)                                                                  | Trait                                          | Bounds in type                | Cross-thread? | Verdict          |
| - | --------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------- | ------------- | ---------------- |
| 1 | `src/install_types/resolver_hooks.rs:1616`                                        | `Iterator<Item = (&[u8], &Dependency)> + '_`  | Lifetime `'_`, no Send        | No            | Sound (NEG-D1)   |
| 2 | `src/resolver/package_json.rs:320`                                                | (impl of #1) `Iterator<…> + '_`               | Lifetime `'_`, no Send        | No            | Sound (NEG-D1)   |
| 3 | `src/crash_handler/lib.rs:614`                                                    | `Fn(*mut c_void) + Send`                       | `+ Send`, default `'static`  | Yes (Vec<>) | Sound (NEG-D2)   |
| 4 | `src/runtime/crypto/CryptoHasher.rs:796`                                          | `Any` (in `CryptoHasherZig::state`)            | default `'static`, no Send    | No (JS-tier)  | Sound (NEG-D3)   |
| 5 | `src/spawn/lib.rs:202` (`subprocess::Source::Any(Box<dyn SourceData>)`)           | `SourceData` (custom)                          | default `'static`, no Send    | No (JS-tier)  | T2-D1            |

### 1.2.1 Site-by-site

#### Site 1+2: `PackageJsonView::dependency_iter -> Box<dyn Iterator + '_>`

`bun_install` defines the trait without naming `bun_resolver`; `bun_resolver` implements it. The `'_` (the implicit elided lifetime of `&self`) keeps the trait object as `dyn Iterator + 'a` (not `+ 'static`), so there is no surprise `'static` requirement. `PackageJsonView` is consumed by `AutoInstaller::lockfile_append_from_package_json` (see `src/install/auto_installer.rs:198`), which is invoked from `bun install` flows that are **not** worker-pool dispatched (the install lockfile is serialized on the install thread). The Box never crosses threads. The omitted `Send` bound is therefore correct.

`NEG-D1` (negative finding): no Send bound is necessary; the trait object is consumed on the originating thread.

#### Site 3: `CrashHandlerEntry(*mut c_void, Box<dyn Fn(*mut c_void) + Send>)`

`src/crash_handler/lib.rs:614` deliberately spells out `+ Send`:

```rust
struct CrashHandlerEntry(*mut c_void, Box<dyn Fn(*mut c_void) + Send>);
unsafe impl Send for CrashHandlerEntry {}
static BEFORE_CRASH_HANDLERS: bun_threading::Guarded<Vec<CrashHandlerEntry>> = …;
```

Reachability: any thread may crash, and the crash handler iterates `BEFORE_CRASH_HANDLERS.try_lock()` from the crashing thread. The boxed closure is therefore invoked cross-thread. The `+ Send` bound + the manual `unsafe impl Send for CrashHandlerEntry` (which only exists because of the bare `*mut c_void`) together pin down the contract. The captured `handler: fn(&mut T) -> Result<…>` is a function pointer (always Send), so the closure body has no unsoundness escape.

The `Guarded<Vec<CrashHandlerEntry>>` is `Sync` (its `unsafe impl<Value: Send, M: RawMutex + Sync> Sync for GuardedBy` requires `Vec<CrashHandlerEntry>: Send`, which holds because `CrashHandlerEntry: Send`). Composition is correct.

`NEG-D2`: Send bound present, single-mutex synchronization, no aliasing issues.

#### Site 4: `CryptoHasherZig { state: Box<dyn Any>, … }`

`Box<dyn Any>` defaults to `dyn Any + 'static`; there is **no** Send bound. `CryptoHasherZig` is wrapped in `JsCell<…>` and lives inside a `CryptoHasher` JSC cell, only ever accessed on the owning JS thread (`finalize` runs on the mutator). The lack of Send is fine — but `JsCell<T>: Send + Sync for ALL T` (`src/jsc/JSCell.rs:126/128`) means the wrapping `JsCell<CryptoHasherZig>` is Send+Sync *regardless* of what's inside the Box. See §2.2.3 below: this is the canonical case where `JsCell`'s blanket Send/Sync laundering is benign **iff** the JS-thread-affinity invariant holds.

`NEG-D3`: correct in isolation; the surrounding `JsCell` is a generic Send/Sync laundering hazard, treated in Part 2.

#### Site 5: `bun_spawn::subprocess::Source::Any(Box<dyn SourceData>)` — **T2-D1**

`src/spawn/lib.rs:202` declares the variant; `src/runtime/api/bun/subprocess.rs:1416+` implements `SourceData` for `webcore::AnyBlob` and `ArrayBufferSource` (a thin `jsc::array_buffer::ArrayBufferStrong` newtype).

The trait object is `dyn SourceData + 'static` with no Send bound. It rides inside `StaticPipeWriter<P> { source: Source, … }` (`src/spawn/static_pipe_writer.rs:45`). `StaticPipeWriter<P>` already has a `*mut P` field and `event_loop: EventLoopHandle`, both of which are `!Send`, so the writer is `!Send` by inference. The `Box<dyn SourceData>` is therefore never required to cross threads, and the omitted `Send` bound is sound.

**T2-D1 footgun**: if a future refactor adds an `unsafe impl<P> Send for StaticPipeWriter<P> {}` (e.g. to ride a `Box<StaticPipeWriter<P>>` through a `ConcurrentTask`), the `Box<dyn SourceData>` will become reachable cross-thread, but the unsound assertion will not trip *because the inner trait object is `!Send` only by inference, not by an explicit bound*. The Rust compiler will refuse the implicit propagation; the next maintainer's natural fix is to add `+ Send` to the trait-object spelling, but that quietly demotes `webcore::AnyBlob` (which is `unsafe impl Send`, see `src/jsc/webcore_types.rs:95`) — Send is fine — while `ArrayBufferStrong` (a JSC Strong wrapper that is **`!Send` by design**: Strong handles are thread-affine — see `src/CLAUDE.md` §"Strong / Weak JS handles") would fail to compile, *but only because* the trait spelling forces the check at trait-impl time. If anyone reaches for `unsafe impl<P: Send> Send for StaticPipeWriter<P>` instead, the Box laundering becomes invisible.

Suggested hardening: add a comment at `Source::Any` explicitly noting "JS-thread-affine; do **not** add a Send bound to `dyn SourceData` without auditing `ArrayBufferStrong`'s Send story". Filed as **T2-D1** because no current call site triggers UB.

## 1.3 Borrowed trait objects (`&dyn` / `&mut dyn`)

~150 sites. Categorized by trait:

| Trait                              | Sites (representative crate)                      | Notes                                                                                                                              |
| ---------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Allocator` (bun_alloc)            | `&dyn Allocator` widely                            | Trait is **not** object-safe-via-dyn for full allocation; sites are mostly `is_instance(alloc: &dyn Allocator)` queries.            |
| `bun_io::Write` / `fmt::Write`     | `&mut dyn bun_io::Write` (~60 sites in ConsoleObject) | Single-thread (JS console writer). No Send/Sync issue.                                                                              |
| `EStringRef`, `RendererImpl`, etc. | `&mut dyn …` plumbing                              | Local, single-frame, no cross-thread reachability.                                                                                  |
| `Fn`/`FnMut` callbacks             | `&dyn Fn(…)`, `&mut dyn FnMut(…)`                  | Stack-borrowed, scoped to the call. Never escape into another thread.                                                                |
| `NpmAliasRegistry`, `ResolverContextDyn`, `PackageJsonView` | `bun_install`/`bun_resolver` plumbing | Cross-crate trait-erasure to break dep cycles; all single-threaded on the install thread.                                       |
| `SendQueueOwner` (ipc.rs)          | `&dyn SendQueueOwner`                              | Wraps `ipc.rs` per-use raw-deref pattern. Single-threaded JS IPC channel.                                                            |

A borrowed `&dyn T` carries `&T` auto-trait semantics (`&T: Send ⇔ T: Sync`, `&T: Sync ⇔ T: Sync`). None of the sampled call paths route a `&dyn T` through `thread::Builder::new().spawn`; the few `thread::Builder` sites (15 hits across watchers, debugger, web worker, bundler, etc.) all capture concrete types or raw pointers, never `&dyn T`.

`NEG-D4`: borrowed trait objects are not a Send/Sync vector in the current codebase.

## 1.4 Async / Future / spawn channels

- `rg 'async fn|impl Future|: Future\b'` → 2 hits, both for a non-`std::future::Future` enum named `WritableFuture` (`src/runtime/webcore/streams.rs:434`). The runtime does **not** use `tokio`, `async-std`, or any executor that demands `Pin<Box<dyn Future + Send + 'static>>`.
- `rg 'tokio::spawn|rayon::spawn'` → 0 hits.
- `rg 'std::thread::spawn'` direct calls → 4 hits (`src/watcher/Watcher.rs:233`, `src/runtime/cli/open.rs:372`, `src/runtime/node/fs_events.rs:514`, plus a doc comment). All capture concrete-typed closures with `move` of plain data (raw pointer wrappers like `SendPtr<T>` or `SendVmPtr`), not trait objects.
- `rg 'std::thread::Builder'` → 15 hits, all in concrete-closure form.

`NEG-D5`: no async-trait-object Send hazard exists today.

## 1.5 Part 1 conclusions

- 0 × T1
- 1 × T2 (T2-D1, `Box<dyn SourceData>` Source-laundering footgun)
- 5 × NEG (NEG-D1 … NEG-D5)

The Rust port's deliberate non-use of `Arc<dyn>` and the absence of async executors means the entire class of "`Box<dyn Foo + 'static>` accidentally `!Send` while being shipped to `tokio::spawn`" hazards does not apply.

---

# Part 2 — Cross-crate Send/Sync composition

## 2.1 Methodology

```
rg -n 'unsafe impl.*Send for|unsafe impl.*Sync for' --type rust src/
```

Output: 164 sites across 76 files in 24 crates. For each, I categorized by:

- Bounded vs unbounded generic
- Synchronization claim (mutex, atomic refcount, init-once, JS-thread-affine, "I trust my caller")
- Whether the type is **embedded** in another crate's struct that itself has `unsafe impl Send`/`unsafe impl Sync` (the cross-crate composition question)

I then sampled ~40 cross-uses where one crate's `unsafe impl Send` rides inside another crate's auto-derived (or also-`unsafe impl`'d) type.

## 2.2 Findings table — cross-crate compositions

| # | Outer type (crate)                                                         | Inner type (crate)                       | Outer impl                                  | Inner impl                                  | Verdict          |
| - | -------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------- | ------------------------------------------- | ---------------- |
| 1 | `bundler::LinkerContext<'a>`                                               | `bun_resolver::EntriesOption` (via `resolver: Option<&'a Resolver>`) | `unsafe impl<'a> Send + Sync`  | `unsafe impl Send + Sync` | Sound (NEG-S1)   |
| 2 | `bundler::LinkerContext<'a>`                                               | `bundler::LinkerGraph`                   | `unsafe impl<'a> Send + Sync`               | `unsafe impl Send + Sync`                   | Sound            |
| 3 | `bundler::LinkerContext::j: StringJoiner` (`src/bundler/LinkerContext.rs:1740`) | `bun_core::StringJoiner`             | `unsafe impl<'a> Send + Sync` (LC outer)   | `unsafe impl Send + Sync` (joiner)           | Sound (NEG-S2)   |
| 4 | `bundler::ThreadPool`                                                      | `bun_collections::ArrayHashMap` (via `workers_assignments`) | `unsafe impl Send + Sync`     | (auto)                                       | Sound            |
| 5 | `crash_handler::CrashHandlerEntry`                                         | `Box<dyn Fn + Send>` (std)               | `unsafe impl Send`                          | (auto via `+ Send`)                          | Sound            |
| 6 | `runtime::webcore::FormDataContext<'a>::joiner: StringJoiner`              | `bun_core::StringJoiner`                 | (auto)                                       | `unsafe impl Send + Sync`                    | Sound (single-thread) |
| 7 | `jsc::ConcurrentPromiseTask<'a, C>`                                        | `Box<C>` (`C: ConcurrentPromiseTaskContext`, **no Send bound**) | `unsafe impl<C: …> Send` | depends on C | **T2-S1**        |
| 8 | `jsc::WorkTask<C>`                                                         | `*mut C` (`C: WorkTaskContext`, **no Send bound**) | `unsafe impl<C: …> Send`     | depends on C                                 | **T2-S2**        |
| 9 | `runtime::dns_jsc::GetAddrInfoRequest` → `WorkTask<GetAddrInfoRequest>`    | `*mut Resolver`, `*mut DNSLookup` (raw) | (inherits T2-S2 chain)                      | n/a                                          | T2-S2 instance   |
|10 | `runtime::webcore::blob::CopyFile<'a>` → `ConcurrentPromiseTask<'a, CopyFile<'a>>` | `StoreRef`, `&'a JSGlobalObject` | (inherits T2-S1 chain)                       | `unsafe impl Send + Sync` (StoreRef)         | T2-S1 instance, has TODO already |
|11 | `bundler::Chunk`                                                           | `bun_core::StringJoiner` (in `intermediate_output`) | `unsafe impl Send + Sync`        | `unsafe impl Send + Sync`                    | Sound; pre-existing TODO(ub-audit) re Renamer |
|12 | `bundler::Chunk::compile_results_for_chunk: CompileResultSlots`            | `Box<[UnsafeCell<CompileResult>]>`       | `unsafe impl Sync`                          | n/a (disjoint slots)                         | Sound            |
|13 | `resolver::EntriesOption` (`src/resolver/fs.rs` AND `src/resolver/lib.rs`) | `Box<DirEntry>` / `&'static mut DirEntry` | `unsafe impl Send + Sync` (each)            | (auto, raw ptrs)                             | Sound (BSSList singleton + mutex) |
|14 | `jsc::VirtualMachine` (singleton)                                          | many fields incl. `JsCell<T>`            | `unsafe impl Send + Sync`                   | `unsafe impl<T> Send + Sync` (JsCell)        | Sound by JS-thread-affine contract |
|15 | `runtime::shell::IOReader` / `IOWriter`                                    | `UnsafeCell<State>` (single-thread shell) | `unsafe impl Send + Sync`                   | (auto, UnsafeCell is !Sync)                 | **T3-S1** — Sync asserted to make `Arc<IOWriter>` work; single-thread invariant is the only guard |
|16 | `runtime::webcore::Blob`                                                   | `bun_ptr::RawRefCount` (single-threaded refcount), `Cell<*const JSGlobalObject>` | `unsafe impl Send + Sync`  | `RawRefCount` panics in debug on wrong-thread access | **T3-S2** — Send/Sync laundering across `!Sync` `Cell`; debug ThreadLock catches some misuse |
|17 | `jsc::JsCell<T>`                                                           | `T` (any)                                 | `unsafe impl<T> Send + Sync` (UNBOUNDED)   | depends on T                                 | **T2-S3**        |
|18 | `ast::StoreSlice<T>`                                                       | `T` (any)                                 | `unsafe impl<T> Send + Sync` (UNBOUNDED)   | depends on T                                 | **Pre-existing T1 (already counted)** |
|19 | `bun_threading::owned_task!` macro emits `unsafe impl Send` unconditionally | concrete task struct                     | macro-emitted Send                          | depends on fields                            | **T2-S5**        |
|20 | `bun_core::Once<T, F>` (`src/bun_core/util.rs:2691`)                       | `T`, `F`                                  | `unsafe impl<T: Send+Sync, F: Sync> Sync` and `unsafe impl<T: Send, F: Send> Send` | std-style bounds | Sound (matches `std::sync::OnceLock`) |
|21 | `bun_core::RacyCell<T>`                                                    | `T`                                       | `unsafe impl<T: ?Sized> Sync` and `unsafe impl<T: ?Sized + Send> Send` | n/a    | **T3-S3** — `Sync` is unconditional; intentional ("racy")? See §2.2.8 |
|22 | `bun_threading::Channel<T, B>`                                             | `T`, mutex                                | `unsafe impl<T: Send, B: ...> Send + Sync` (T: Send bound) | n/a               | Sound            |
|23 | `bun_threading::RwLock<T>`                                                 | `T`                                       | `unsafe impl<T: Send> Send`, `unsafe impl<T: Send + Sync> Sync` | matches std::sync::RwLock | Sound |
|24 | `bun_alloc::MimallocArena`                                                 | mimalloc heap (`*mut mi_heap_t`)         | `unsafe impl Send + Sync`                   | n/a                                          | Sound by contract; cross-thread `&self` allocation is **caller's** responsibility |
|25 | `bun_alloc::BSSList<V, COUNT>`                                             | `V`                                       | `unsafe impl<V: Send, …> Send + Sync` (V: Send only, NOT V: Sync) | n/a    | Sound — `&self` methods (`exists`, `is_overflowing`) only read pointer addresses, never deref `V` |
|26 | `bun_ptr::BackRef<T>` / `ParentRef<T>`                                     | `T`                                       | `unsafe impl<T: ?Sized + Sync> Send + Sync` (matches `&T` rules) | n/a       | Sound            |
|27 | `bun_ptr::StoreRef<T>` (ast/nodes)                                         | `T`                                       | `unsafe impl<T: Send> Send`, `unsafe impl<T: Sync> Sync` (bounded) | n/a    | Sound — properly bounded, unlike the sibling `StoreSlice` |
|28 | `http::SSLConfig` (`src/http/ssl_config.rs`)                               | `CStrPtr`, `AtomicU64`                   | `unsafe impl Send + Sync`                   | n/a                                          | Sound            |
|29 | `sql_jsc::server_config::SSLConfig` (different type, same name)            | `Option<NonNull<c_void>>` (opaque)       | `unsafe impl Send`                          | n/a                                          | Sound — opaque handle deferred to the host                                |
|30 | `boringssl::CtxStore`                                                      | (process-global SSL_CTX)                 | `unsafe impl Send + Sync`                   | n/a                                          | Sound — BoringSSL ctxs are thread-safe by upstream contract |
|31 | `http::HpackHandle`                                                        | (`*mut lshpack` raw ptr)                | `unsafe impl Send` (no Sync)                | n/a                                          | Sound — only Send needed; HTTP-thread handoff |
|32 | `http::h3_client::PendingConnect::Resolved`                                | `*mut PendingConnect`                    | `unsafe impl Send` (no Sync)                | n/a                                          | Sound — mutex-guarded queue                                                |
|33 | `standalone_graph::StandaloneModuleGraph`                                  | `Instance` (process-static module map)   | `unsafe impl Send + Sync`                   | inner `Instance: Sync`                       | Sound — process-static                                                     |
|34 | `runtime::shell::ShellRmTask` / `DirTask`                                  | various raw pointers                     | `unsafe impl Send`                          | n/a                                          | Sound for shell single-thread + AsyncDeinit handoff |
|35 | `runtime::bake::production::DotenvSingleton`                               | env-var map                              | `unsafe impl Sync`                          | n/a                                          | Sound — init-once-then-read-only                                          |
|36 | `jsc::TopExceptionScope::SourceLocation`                                   | borrowed string ptr                      | `unsafe impl Send + Sync`                   | n/a                                          | Sound (Latin-1 ptr to interned string)                                     |
|37 | `runtime::napi::napi_node_version`                                         | C-API struct                             | `unsafe impl Sync` (no Send)                | n/a                                          | Sound — `static`-only use                                                  |
|38 | `bun_core::ThreadCell<T>` / `AtomicCell<T>`                                | `T`                                       | bounded (`T: Send`, `T: Copy` resp.)        | n/a                                          | Sound                                                                       |
|39 | `bundler::lib::DevServerHandle` (dispatch macro)                           | `*mut ()` owner                           | `unsafe impl Send + Sync`                   | inherits owner's invariants                  | Sound — bake DevServer is process-global   |
|40 | `runtime::node::path_watcher::PathWatcherManager`                          | `Cell<Fd>`, `UnsafeCell<…>`              | `unsafe impl Send + Sync`                   | n/a                                          | **T3-S4** — `Cell<Fd>` for `platform_fd` is set-once-before-thread-spawn; correct happens-before, but `Cell::set/get` from the freebsd path (`init` writes after a `kqueue()` call) is the contract pivot — keep an eye on this if init grows side-channels |
|41 | `jsc::Debugger::SendVmPtr` / `web_worker::SendPtr`                         | `*mut VirtualMachine`                   | `unsafe impl Send`                          | n/a (raw ptr wrapper)                        | Sound — single use as closure capture                                       |
|42 | `runtime::dns_jsc::SendPtr<T>`                                             | `*mut T`                                  | `unsafe impl<T> Send`                       | n/a                                          | Sound — synchronization is "the DNS cache lock"; documented                |

### 2.2.0 Inventory rules of thumb

The audit uses these rules to classify each `unsafe impl Send` / `unsafe impl Sync`:

1. **Bounded vs unbounded**. `unsafe impl<T: Send> Send for X<T>` is bounded (matches std). `unsafe impl<T> Send for X<T>` is unbounded (footgun).
2. **Justification archetype**: (a) std-equivalent — bounded against `std::sync::Mutex<T>`/`OnceLock<T>`/`Arc<T>`; (b) mutex-protected — interior mutability guarded by a named mutex; (c) atomic refcount + cross-thread payload; (d) init-once-before-spawn → happens-before; (e) JS-thread-affine singleton; (f) opaque foreign handle (BoringSSL, libc); (g) `unsafe impl` on a raw-pointer wrapper used as a single-use closure capture.
3. **Composition direction**: does the wrapping struct add a NEW invariant on top of the inner's, or does it just inherit the existing one? Findings concentrate where the wrapper claims MORE than the inner can deliver.
4. **`'static` laundering**: does the wrapper erase a non-`'static` lifetime parameter? (Common in bundler code, e.g. `*const BundleV2<'static>`.)

### 2.2.1 T2-S1 — `ConcurrentPromiseTask<'a, C>: Send` regardless of `C: Send`

**Where.** `src/jsc/ConcurrentPromiseTask.rs:55`:

```rust
unsafe impl<C: ConcurrentPromiseTaskContext> Send for ConcurrentPromiseTask<'_, C> {}
```

`ConcurrentPromiseTaskContext` is **not** `: Send`. The task holds `Box<C>`, `JSPromiseStrong`, `&'a JSGlobalObject`, `BackRef<EventLoop>`, `ConcurrentTask`, `KeepAlive`. The pool runs `(*this).ctx.run()` on a worker thread (`run_from_thread_pool`), and the JS thread later runs `ctx.then(promise)` via the concurrent task queue.

**Hazard.** The `unsafe impl<C> Send` is the contract that the work pool's `from_task_ptr` recovery is sound. If a future `Context` carries a raw `*mut JSCell` or a JS-thread-affine field, `run()` on a worker thread can dereference it, and `Drop` on the worker thread (in the `manual_deinit` path) could touch JS-thread-only state.

**Reachability.** I traced `Drop` paths. `ConcurrentPromiseTask::destroy(this)` (`src/jsc/ConcurrentPromiseTask.rs:130`) is the only public destructor and is gated by "manual_deinit" → enqueued back to the JS thread. Today's only implementor (`CopyFile` in `src/runtime/webcore/blob/copy_file.rs`) carries `StoreRef` (atomic refcount, Send+Sync), `Fd` (Copy), `SystemError` (Send), `&'a JSGlobalObject` (the file itself has a TODO admitting `'a` is unsound — see lines 49-50 and 64-66). The Drop on worker thread *would* be reached only if `manual_deinit` is bypassed — currently it isn't.

**Verdict.** T2-S1: latent footgun, no current call site triggers UB. The Send impl should be tightened to `where C: Send` once `Context`'s thread-safety story is normalized (and the `'a JSGlobalObject` lifetime parameter is replaced per the in-tree TODO).

### 2.2.2 T2-S2 — `WorkTask<C>: Send` regardless of `C: Send`

**Where.** `src/jsc/WorkTask.rs:58`:

```rust
unsafe impl<C: WorkTaskContext> Send for WorkTask<C> {}
```

Same shape as T2-S1. `GetAddrInfoRequest` (`src/runtime/dns_jsc/dns.rs:1187`) holds raw `*mut Resolver` and `*mut DNSLookup` directly. The Send impl is the only mechanism keeping `WorkTask<GetAddrInfoRequest>` postable to the work pool.

**Reachability.** `run` runs on the work pool; `then` runs on the JS thread. The cross-thread payload is the `*mut Self` pointer; field reads happen under the documented lock (`global_cache().lock()`). No UB in the current implementation.

**Verdict.** T2-S2: same shape as T2-S1.

### 2.2.3 T2-S3 — `JsCell<T>: Send + Sync` for **all** T

**Where.** `src/jsc/JSCell.rs:126/128`:

```rust
unsafe impl<T> Sync for JsCell<T> {}
unsafe impl<T> Send for JsCell<T> {}
```

**SAFETY justification (in-source).** "single-thread-owner invariant … Cross-thread access goes through `ConcurrentTask` / `enqueueTaskConcurrent`, which never hands out a `&JsCell`."

**Cross-crate composition.** `JsCell<T>` is used liberally inside `VirtualMachine` (which itself has `unsafe impl Send + Sync`) and many JS-visible struct fields. Because `JsCell<T>: Send + Sync` regardless of `T`'s own auto-traits, any struct embedding a `JsCell<T>` auto-derives `Send + Sync` **without** taking T's traits into account. This is the canonical Send/Sync-laundering hazard described in the task brief.

The current discipline keeps this sound by ensuring the wrapping types (e.g. `VirtualMachine`, `Blob`, `CryptoHasher`) are themselves JS-thread-affine, but the type-system fence is removed.

**Verdict.** T2-S3: by-design footgun, documented. No T1 today.

### 2.2.4 Reconfirmed T1 — `StoreSlice<T>: Send + Sync` for **all** T

**Where.** `src/ast/nodes.rs:339/340`:

```rust
unsafe impl<T> Send for StoreSlice<T> {}
unsafe impl<T> Sync for StoreSlice<T> {}
```

Compare with sibling `StoreRef<T>` (`src/ast/nodes.rs:39/40`), which is bounded `T: Send` / `T: Sync`. The SAFETY comment on `StoreSlice` says: *"callers must not actually share a Store across threads"* — the impl is asserted purely so AST node types can sit inside `static` Prefill tables.

**Cross-crate exposure.** All current call sites appear to use POD AST types (`ClauseItem`, `EnumValue`, `Case`, `Stmt`). That limits current in-tree blast radius, but it does not demote the bug: the safe public type already asserts a false auto-trait fact. `StoreSlice<Cell<u32>>` type-checks as `Send + Sync` today while `Cell<u32>` is explicitly not `Sync`.

**Verdict.** Pre-existing T1 already counted in Pass 2 and the dashboard. Tighten to `T: Send` / `T: Sync` bounds to match `StoreRef`. Should be a 2-5 line diff; the existing call sites all satisfy both bounds.

### 2.2.5 T2-S5 — `owned_task!` macro unconditional `unsafe impl Send`

**Where.** `src/threading/work_pool.rs:115/125`:

```rust
unsafe impl<$($gen)*> ::core::marker::Send for $ty {}
```

The macro emits `unsafe impl Send` on every concrete task type it expands. The author's SAFETY comment is explicit ("the per-type fields (raw `*mut EventLoop`, `*const JSGlobalObject`) are auto-`!Send` only nominally"). This is the **macro-level** sibling of T2-S1/T2-S2 — the macro asserts the contract at the call site, but a misuse is a single `owned_task!(WrongType)` away from UB.

**Verdict.** T2-S5: documented; can be hardened by adding a trait obligation (e.g., a `unsafe trait OwnedTaskOk: Sized {}` opt-in marker that the macro requires) so misuse is a compile error.

### 2.2.6 T3-S1 — `IOReader`/`IOWriter`: `Sync` to satisfy `Arc<Self>` shape

`src/runtime/shell/IOReader.rs:82-83`, `src/runtime/shell/IOWriter.rs:243-244`. SAFETY: *"shell is single-threaded; `Arc` is used purely for refcounting."* The `Sync` impl exists so `Arc<IOReader>` is `Send + Sync` (since `Arc<T>: Send + Sync ⇔ T: Send + Sync`). The struct's `&self` methods (`state()`, `reader()`) project `&mut` via `UnsafeCell::get()`; if anyone holds two `&IOReader`s simultaneously on the same thread (re-entrant call) the two `&mut` would alias.

**Verdict.** T3-S1: stylistic — the `Sync` impl is a true lie, motivated by `Arc`'s symmetric bounds. Could be tightened by switching to a single-thread-only refcount wrapper (`bun_ptr::RawRefCount`-backed `Rc`-shaped type) so `Sync` is no longer needed. Today nothing breaks.

### 2.2.7 T3-S2 — `Blob: Send + Sync` with single-threaded `RawRefCount` + `Cell<*const JSGlobalObject>`

`src/jsc/webcore_types.rs:95-96`. `Blob` is "moved across threads under `ObjectURLRegistry`'s mutex and via the work-pool read/write tasks". The `RawRefCount` panics on wrong-thread access in debug builds via `ThreadLock`. The `Cell<*const JSGlobalObject>` is `!Sync` natively but the unsafe impl asserts Sync.

**Verdict.** T3-S2: works because the cross-thread paths happen to never call `ref_count.increment()` from the worker side (the worker only reads the buffer through the `StoreRef`). The debug `ThreadLock` is real defense-in-depth.

### 2.2.8 T3-S3 — `RacyCell<T>: Sync for all T` (unconditional)

`src/bun_core/util.rs:2282`:

```rust
unsafe impl<T: ?Sized> Sync for RacyCell<T> {}
unsafe impl<T: ?Sized + Send> Send for RacyCell<T> {}
```

`RacyCell` is `bun_core`'s `SyncUnsafeCell` lookalike. `Sync` requires NO bound on T, while standard `SyncUnsafeCell<T>: Sync` requires `T: Sync`. The name "Racy" telegraphs intent.

**Verdict.** T3-S3: by-name "racy"; callers know the contract. Mostly used for cell-like singletons whose payload is `Sync` anyway (`std::sync::OnceLock`-like patterns). The unbounded Sync is technically a footgun if someone stuffs a `Cell<u32>` in there, but no current site does.

### 2.2.8b T3-S3 detail — `RacyCell<T>: Sync` semantics

Both `bun_core::util::RacyCell` (`src/bun_core/util.rs:2282`) and the no_std re-decl in `src/install/windows-shim/main.rs:214` use the same shape:

```rust
unsafe impl<T: ?Sized> Sync for RacyCell<T> {}
unsafe impl<T: ?Sized + Send> Send for RacyCell<T> {}
```

Comparison: `std::cell::SyncUnsafeCell<T>` is `Sync iff T: Sync`. `RacyCell`'s decision to drop the bound is named "Racy" for a reason — its semantics intentionally allow racy reads/writes where the surrounding architecture guarantees the data is either Copy-and-aligned-atomically (PLT-resolved fn pointers, monomorphic config knobs) or only mutated under init-once-then-read.

The `T: ?Sized` permits unsized payloads. Both `RacyCell` sites stay in `bun_core` and `install/windows-shim`; nothing cross-crate composes a `RacyCell<Something-Surprising>`.

**Verdict**: T3-S3, by-name intentional racy semantics. Could be tightened to `T: Sync` if no existing call site uses `RacyCell<!Sync>` (likely true — the contents are typically atomics or `()`), but the existing name self-documents.

### 2.2.9 T3-S4 — `PathWatcherManager`: `Cell` cross-thread via init-once-then-read

`src/runtime/node/path_watcher.rs:108/109`. `platform_fd: Cell<Fd>` is set in `init()` (kqueue/inotify init) and read from the reader thread. The contract is "set once before spawning the reader thread; never modified afterwards". `Cell::set/get` is `!Sync`; the unsafe impl Sync laundering across `Cell` is sound because `Fd` is `Copy + Send` and the set happens-before the spawn.

**Verdict.** T3-S4: correct happens-before story; the `Cell` is a poor man's `OnceCell`. Could be replaced with `std::sync::OnceLock<Fd>` for clarity, but no current bug.

## 2.3 Cross-crate impl-implication chains (the "compounding" hazard)

The task brief specifically asks about cases where "crate A's `unsafe impl Send for FooA` gets embedded in crate B with different invariants". I traced 30+ such embeddings; the representative chains:

### Chain A: `LinkerContext<'a>` (bundler) ← `LinkerGraph` (bundler) ← `*const Arena` (raw)

Both `LinkerContext` and `LinkerGraph` have manual `unsafe impl Send + Sync`. The `*const Arena` raw pointer is the auto-trait blocker; the outer's `unsafe impl` covers it. Composition is **monotone**: each level adds the same disclaimer ("only field is `*const X` whose pointee is `Sync`"). The compounding is principled and the lifetimes erased properly (`*const BundleV2<'static>` in `bundler::ThreadPool`).

`NEG-S1`: monotone composition is sound.

### Chain B: `VirtualMachine` (jsc) ← `JsCell<…>` (jsc) ← user payload (any crate)

`VirtualMachine: unsafe impl Send + Sync` is asserted because it's a per-thread singleton. Its fields are `JsCell<T>`-wrapped, and `JsCell<T>` is unconditionally `Send + Sync`. The cross-crate hazard: any crate embedding `JsCell<MyType>` auto-derives `Send + Sync` for the wrapping struct, **regardless of whether `MyType: Send`**. The discipline ("only access on the JS thread") is invisible at the type level.

This is the same finding as T2-S3 viewed through the lens of cross-crate composition. Reachability: in practice, all `JsCell`-wrapped fields are JS-thread-affine by construction (the JS thread is the only thread that has a `VirtualMachine::get()` handle). Sound today.

### Chain C: `WorkTask<GetAddrInfoRequest>` (jsc + runtime/dns_jsc)

`WorkTask<C>` is `unsafe impl<C: WorkTaskContext> Send` in `bun_jsc`. `GetAddrInfoRequest` (in `bun_runtime/dns_jsc`) holds raw `*mut Resolver` / `*mut DNSLookup` and is NOT auto-Send. The `WorkTask<…>: Send` impl is the contract carrier across the crate boundary.

This is **the** classic cross-crate Send-laundering case described in the brief. The contract is honored by the call site (DNS cache lock serializes raw-pointer access). T2-S2.

### Chain D: `StaticPipeWriter<P>` (bun_spawn) ← `Source` (bun_spawn) ← `Box<dyn SourceData>` (cross-crate trait obj)

`bun_spawn` defines the `SourceData` trait; `bun_runtime` implements it for `AnyBlob` and `ArrayBufferStrong`. The trait object spelling lacks `+ Send`, so it's `!Send` by inference. `StaticPipeWriter<P>` is `!Send` because of its other fields (`event_loop: EventLoopHandle`, `process: *mut P`). The Box laundering is moot today; T2-D1 (already discussed).

### Chain E: `Guarded<Vec<CrashHandlerEntry>>` (crash_handler) ← `Vec<CrashHandlerEntry>` (std) ← `Box<dyn Fn + Send>` (std with bound)

`Guarded<Value, M: Mutex>: Sync` iff `Value: Send`. `Vec<T>: Send` iff `T: Send`. `CrashHandlerEntry: Send` is opt-in (raw `*mut c_void` field) but the boxed closure carries its own `+ Send` bound. Soundly composed.

`NEG-S2`: bounded composition; sound.

## 2.4 Specific patterns from the brief

### Pattern: `Box<dyn Send + Sync>`

Zero occurrences in the workspace. `Box<dyn Fn + Send>` exists exactly once (the crash handler) — Sync is not asserted on the trait object because crash handlers never share `&Self`.

### Pattern: `Arc<Mutex<Box<dyn ...>>>` chains

Zero occurrences. No `Arc<Mutex<…>>` and no `Arc<dyn>` in the entire workspace; the runtime uses `Guarded<T>` instead.

### Pattern: `Pin<Box<dyn Future + Send + 'static>>`

Zero occurrences (no async runtime).

### Pattern: Trait objects given to `tokio::spawn` / `rayon::spawn`

Zero. No `tokio`/`rayon` in the source tree. `std::thread::spawn` is used 4 times, all with concrete-typed closures.

### Pattern: `unsafe impl<T: Trait> Send for Wrapper<T> {}` where `Trait` doesn't imply Send

Four new T2 matches (T2-S1, T2-S2, T2-S3, plus the macro-level T2-S5), plus one already-counted T1 (`StoreSlice<T>`). All documented in §2.2.

### Pattern: `unsafe impl Send for Strong/Weak<T>` from `bun_jsc`

I did NOT find `unsafe impl Send for Strong<T>` or `unsafe impl Send for Weak<T>` in the inventory:

```
$ rg -n 'unsafe impl.*Send for (Strong|Weak)' --type rust src/
(no hits)
```

`bun_jsc::Strong` and `bun_jsc::Weak` are explicitly **`!Send` + `!Sync`** by design (per `src/CLAUDE.md` §"Strong / Weak JS handles"). The "Strong/Weak Send" hazard does not exist in this codebase. `NEG-S3`.

## 2.5 Per-crate Send/Sync footprint

A useful cross-check: where do the 164 manual `unsafe impl Send/Sync` sites live?

| Crate                  | Count | Notes                                                                                                                            |
| ---------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| `bundler`              | 26    | The largest concentration: `Chunk`, `LinkerContext`, `LinkerGraph`, `ThreadPool`, `BundleThread`, `bundle_v2::CompletionHandle`, `linker::ImportPathsListPtr`, `linker_context::Step5Ctx`, `linker_context::PrepareCssAstTask`. All justified by the bundler's worker-pool model: shared `*const BundleV2<'static>` + disjoint-write SoA slots + atomic refcounts on shared items. |
| `threading`            | 18    | Synchronization primitives themselves: `Channel<T,B>`, `RwLock<T>`, `Mutex` (Windows/Darwin impls), `Condition`, `Semaphore`, `Task`, `Queue`, `GuardedBy<Value,M>`. All bounded against std's analogous types.                            |
| `runtime`              | 18    | `Blob`, `IOReader`/`IOWriter`, `PathWatcherManager`, `CoreFoundation`/`CoreServices` (fs_events), `DotenvSingleton`, `JSBundleCompletionTask`, `napi_node_version`, `ShellRmTask`/`DirTask`, `CStrPtr`, `SendPtr<T>` (dns_jsc), `GlobalCache` (dns_jsc).         |
| `jsc`                  | 18    | The JS-thread-affine block: `JsCell<T>`, `VirtualMachine`, `Blob`, `Bytes`, `StoreRef` (webcore_types), `WorkTask<C>`, `ConcurrentPromiseTask`, `WatchChangedPaths`, `SourceLocation`, `SendVmPtr`, `SendPtr` (web_worker).               |
| `bun_core`             | 18    | Foundational utilities: `String`, `StringJoiner` + `Node`, `RacyCell<T>`, `ThreadLock`, `Once<T,F>`, `RawSlice<T>`, `AtomicCell<T>`, `ThreadCell<T>`, `SyncCStr`.                                                                          |
| `bun_alloc`            | 10    | `MimallocArena`, `MaxHeapAllocator`, `StdAllocator`, `BSSList<V,N>`, `Zone` (heap_breakdown).                                       |
| `resolver`             | 7     | `EntriesOption` × 2 (in `fs.rs` and `lib.rs`), `Entry`. Singleton BSSList + mutex.                                                |
| `ast`                  | 6     | `StoreRef<T>` (bounded), `StoreStr`, `StoreSlice<T>` (unbounded — pre-existing T1 already counted).                               |
| `http`                 | 5     | `SSLConfig`, `HpackHandle`, `Resolved` (PendingConnect), `InitOpts` (HTTPThread).                                                  |
| `collections`          | 5     | `MultiArrayList<T,A>`, `DynamicBitSetList`, `StringHashMapKey<A>`.                                                                |
| `sys`                  | 4     | `Name`, `DynLib`.                                                                                                                |
| `semver`               | 4     | `List`, `Group`.                                                                                                                 |
| `ptr`                  | 4     | `BackRef<T>`, `ParentRef<T>` (both bounded `T: Sync`).                                                                            |
| `js_parser`            | 4     | `DefineData`, `SyncDefineData`.                                                                                                  |
| `css`                  | 4     | `DeclarationBlock<'bump>`, `CssRule<R>` (R-bounded).                                                                              |
| `standalone_graph`     | 3     | `Instance`, `StandaloneModuleGraph` (process-static).                                                                            |
| `io`                   | 2     | `Waker` (windows_event_loop).                                                                                                    |
| `boringssl`            | 2     | `CtxStore` (BoringSSL upstream-thread-safe contract).                                                                            |
| `sql_jsc`              | 1     | `SSLConfig` (different type than `http::SSLConfig`).                                                                             |
| `spawn`                | 1     | `Instance` (process.rs).                                                                                                         |
| `crash_handler`        | 1     | `CrashHandlerEntry`.                                                                                                             |
| `install/windows-shim` | 1     | `RacyCell<T>` re-decl (no_std mini-shim).                                                                                        |
| `opaque`               | 0     | (Macro-generated `!Send + !Sync` defaults; opt-in by callers.)                                                                   |
| `perf`                 | 1     | `___tracy_source_location_data` (Tracy C struct).                                                                                |

The bundler's 26 sites are the single biggest concentration. Each is a multi-line SAFETY comment naming the worker-pool synchronization story (mutex + disjoint slots + atomic per-symbol fields). Pass 3's `PASS3-bun-bundler-deep-dive.md` covers them site-by-site; here I cross-checked composition, not first-order soundness.

## 2.6 Reachability paths sampled (the "concrete cross-thread path" obligation)

Per the task brief, T1 findings require a **concrete cross-thread reachability path**. I traced the following paths to ensure I would catch one if it existed:

| Path | From | To | Verdict |
| ---- | ---- | -- | ------- |
| Bundler parse-task fan-out | `BundleV2::generate_chunks_in_parallel` (JS thread) | `*mut Chunk` (worker pool) | Disjoint slot writes; SoA columns are `AtomicU32`. Sound. |
| Bundler compile-task fan-out | `LinkerContext::generate_compile_result_for_*` | per-task worker | `CompileResultSlots(Box<[UnsafeCell<…>]>)` — disjoint indices. Sound. |
| HTTP thread init | `HTTPThread::start` (main) | `HTTP thread spawn` | `InitOpts: unsafe impl Send` carries borrowed C-strings, copied into HTTP thread. Sound. |
| H3 DNS resolution | DNS worker `on_dns_resolved` | HTTP thread `drain_events` | `Resolved(*mut PendingConnect)` queued under mutex. Sound. |
| DNS getaddrinfo | JS thread `WorkTask::create_on_js_thread` | work pool `WorkTask::run_from_thread_pool` | `WorkTask<GetAddrInfoRequest>: unsafe impl Send` regardless of `C: Send`. Sound today; T2-S2. |
| CopyFile (Blob) | JS thread | work pool | `ConcurrentPromiseTask<CopyFile>` — T2-S1 with in-source TODO. |
| Crash handler dispatch | crashing thread | iterate `BEFORE_CRASH_HANDLERS` | `Box<dyn Fn + Send>` with explicit Send bound. Sound. |
| Shell async deinit | shell thread | main JS thread via `ConcurrentTask` | `IOReader/IOWriter` Send via raw pointer + Arc refcount. Sound. |
| Path watcher kqueue | spawn-once init | kqueue reader thread | `platform_fd: Cell<Fd>` set-before-spawn → happens-before. Sound. |
| Web worker | parent VM | child VM thread spawn | `SendVmPtr(*mut VirtualMachine)` capture. Sound. |
| Bundle thread | JS thread | bundle thread singleton | `JSBundleCompletionTask: unsafe impl Send`; sentinel-style queue. Sound. |
| Concurrent task queue | any thread enqueueing | JS thread drain | All Taskable types are heap-allocated and only their `*mut` rides cross-thread. Sound. |

In **no** path did I find a routed-but-unprotected non-Send value, hence T1 = 0.

## 2.7 Deeper cross-crate composition walk-throughs

Below I trace the full Send/Sync chains for the most consequential cross-crate types, in the spirit of the brief's request to look for "subtle compounding".

### 2.7.1 Walk: `Blob` (jsc) → embedded in many `bun_runtime` types

`bun_jsc::Blob` (`src/jsc/webcore_types.rs:67-88`) is the JSC-side view; `bun_runtime::webcore::Blob` (`src/runtime/webcore/Blob.rs`) is the host-side body. The JSC view has `unsafe impl Send + Sync` (`src/jsc/webcore_types.rs:95-96`), justified by the comment:

> `Blob` holds raw pointers (`content_type`, `global_this`) which default to `!Send`/`!Sync`. The Zig original moves `Blob` across threads under `ObjectURLRegistry`'s mutex and via the work-pool read/write tasks; the pointee data is either `'static`/heap-owned (`content_type`) or an opaque JSC handle only ever dereferenced on its owning JS thread.

Cross-crate composition:

- `bun_runtime` embeds `Blob` inside `FormDataContext<'a>` (`src/runtime/webcore/Blob.rs:3780`) — single-threaded JS-thread use.
- `bun_runtime::webcore::blob::CopyFile` doesn't hold a Blob directly; it holds two `StoreRef` (atomic refcount, Send+Sync).
- `bun_runtime::webcore::blob::ReadFile`/`WriteFile` hold `StoreRef` and go through `WorkTask<…>` to the worker pool.

The blob laundering chain is:

```
work-pool worker  ←  WorkTask<ReadFile>  ←  ReadFile { store: StoreRef, … }
                                            └─ StoreRef → Store (atomic refcount, Send+Sync OK)
```

`Blob` itself never crosses threads through `ReadFile`/`WriteFile` (the chunked-IO contexts hold the underlying `Store` directly). Sound.

The crucial subtlety: `Blob`'s `Sync` is asserted but the fields are `Cell<*const JSGlobalObject>` and `RawRefCount` (single-threaded). Concurrent `&Blob` from two threads on these fields would be UB. The contract is that `&Blob` is only ever derived from the JS thread; `Sync` is asserted to make `JsCell<Option<Blob>>` (or similar) compose cleanly with `Send`-required wrappers — a pure laundering convenience.

### 2.7.2 Walk: `String` (bun_core) → ubiquitous embedding

`bun_core::String` has `unsafe impl Send + Sync` (`src/bun_core/string/mod.rs:1264-1265`). It is the FFI-shared 5-variant tagged union (mirrors C++ `BunString`). Internally it may hold a `WTFStringImpl*` pointing into WebKit's per-thread atom table.

Cross-crate uses: `bun_jsc` consumes it (e.g. `String::from_js`), `bun_runtime` uses it everywhere, `bun_install` uses it for lockfile names, `bun_resolver` uses it for paths.

The cross-thread hazard is documented in `src/CLAUDE.md` ("Cross-thread string hazards"): AtomStrings live in a per-thread table, and dropping a `String` whose backing is an `AtomString` from a non-owner thread trips `AtomStringImpl::remove()`. The runtime ports around this by deliberately constructing via `String::clone_utf8` (plain `WTFStringImpl` with atomic refcount) when crossing threads.

**Cross-crate composition implication**: `String: Send + Sync` is asserted unconditionally even though SOME `String` values (the AtomString variant) are NOT actually safe to send. This is the canonical Bun "Send/Sync is asserted on the union; safety is per-variant" pattern — sound only when callers respect the invariant. This is a **runtime invariant**, not a type-system one.

Embedded uses I sampled:

- `bun_bundler::LinkerContext::mangled_props: MangledProps` — contains `String`s, used from worker pool. Audit: the `String`s here originate from `String::clone_utf8` in the parser/resolver. Sound.
- `bun_install::lockfile::Package::name` — `String` held across the install thread + workers. Audit: same `clone_utf8` discipline. Sound.

Not a finding — the runtime knows about this hazard.

### 2.7.3 Walk: `MultiArrayList<T, A>` (collections) → bundler & install heavy use

`bun_collections::MultiArrayList<T, A>` (`src/collections/multi_array_list.rs:452-453`) has the bounded impl:

```rust
unsafe impl<T: Send, A: Allocator + Send> Send for MultiArrayList<T, A> {}
unsafe impl<T: Sync, A: Allocator + Sync> Sync for MultiArrayList<T, A> {}
```

These are properly bounded. Cross-crate uses: bundler uses `MultiArrayList<Symbol>` (Symbol has `chunk_index: AtomicU32` for worker-pool publishing), install uses `MultiArrayList<…>` for lockfile entries.

`A: Allocator + Send` requires the allocator to be Send. `bun_alloc::MimallocArena` has `unsafe impl Send + Sync`, so the composition holds. **Composition correct.**

### 2.7.4 Walk: `Guarded<T, M>` (threading) → process-wide mutexed singletons

`bun_threading::GuardedBy<Value, M: RawMutex>` (`src/threading/guarded.rs:38`):

```rust
unsafe impl<Value: Send, M: RawMutex + Sync> Sync for GuardedBy<Value, M> {}
```

Sound — matches `std::sync::Mutex<T>`. Cross-crate uses are pervasive: every `static Guarded<…>` is the cross-crate composition. Examples:

- `static BEFORE_CRASH_HANDLERS: Guarded<Vec<CrashHandlerEntry>>` (crash_handler) — `Vec<CrashHandlerEntry>: Send` because `CrashHandlerEntry: unsafe impl Send`. Sound.
- `static RESOLVED: Guarded<Vec<Resolved>>` (http/h3_client/PendingConnect) — `Resolved: unsafe impl Send`. Sound.
- `workers_assignments: Guarded<ArrayHashMap<ThreadId, *mut Worker>>` (bundler/ThreadPool) — `ArrayHashMap<ThreadId, *mut Worker>: ?Send`. `*mut Worker` is `!Send` by default, but the `ArrayHashMap` is locked by `Guarded`. Wait — does `*mut Worker` auto-impl Send? No, raw pointers are `!Send`. So `ArrayHashMap<..., *mut Worker>: !Send`, which makes `Guarded<ArrayHashMap<..., *mut Worker>>: !Sync` per the bound.

Let me check the actual definition more carefully — maybe `ArrayHashMap` has an explicit Send impl:

```
rg -n 'unsafe impl.*Send for ArrayHashMap' --type rust src/ → nothing
```

This means `bundler::ThreadPool::workers_assignments: Guarded<ArrayHashMap<ThreadId, *mut Worker>>` should NOT be `Sync` — `*mut Worker` is `!Send`. And yet `bundler::ThreadPool: unsafe impl Send + Sync` is declared (`src/bundler/ThreadPool.rs:77-78`).

The escape: `ThreadPool` has its own `unsafe impl Sync` that overrides any composition concern. The SAFETY comment says "the only mutated field (`workers_assignments`) is guarded by its `bun_threading::Guarded`, and the raw-pointer fields are externally synchronized exactly as in the Zig source." The author manually asserted what would otherwise fail.

**Verdict**: NOT a T1 — the manual `unsafe impl` is the contract carrier. The composition just looks weird at first glance; the override is intentional. Filed as a process observation, not a finding: an `unsafe impl Send for ArrayHashMap<K, *mut V>` at the collections-crate level (bounded e.g. `where *mut V: SendByContract`) would be more honest, but the current style is consistent with the rest of the codebase.

### 2.7.5 Walk: `Strong` / `Weak` JS handles — confirmed absent from Send/Sync inventory

The brief specifically asked about "`unsafe impl Send for Strong/Weak<T>` patterns from `bun_jsc`". I searched:

```
rg -n 'unsafe impl.*Send for (Strong|Weak)\b' --type rust src/  → 0 hits
rg -n 'unsafe impl.*Sync for (Strong|Weak)\b' --type rust src/  → 0 hits
```

Confirmed: Strong/Weak are by-design `!Send + !Sync` (the GC handle must be released on its creating thread). This is the architectural anti-pattern the audit specifically expected and **the codebase does NOT exhibit it**. Important negative finding (`NEG-S3`).

### 2.7.6 Walk: `JSPromiseStrong` — embedded in tasks

I traced `JSPromiseStrong` (used in `ConcurrentPromiseTask`):

```
rg -n 'pub struct JSPromiseStrong|unsafe impl.*JSPromiseStrong' --type rust src/ → 0 hits in src/jsc
```

It's defined elsewhere. `JSPromiseStrong: ?Send` by default (it's a JSC handle). The `ConcurrentPromiseTask`'s `unsafe impl<C> Send` overrides the auto-derived `!Send` for the whole task. The hazard: cross-thread drop of `JSPromiseStrong` could touch JS state. The contract: `destroy(this)` only runs after the JS thread has re-acquired the task via the concurrent queue (`manual_deinit` flow).

This reinforces T2-S1 — the chain works only because the destructor path is gated by the JS thread.

### 2.7.7 Walk: `bun_install::lockfile::Lockfile` — `Send`-crosses-into-worker-pool

```
rg -n 'unsafe impl Send for Lockfile|unsafe impl Sync for Lockfile' --type rust src/install/ → 0 hits
```

`Lockfile` is auto-`Send` (composed of `String`/`Box<[u8]>`/etc., all of which are Send). The `bun_install::PackageInstaller` cross-thread story relies on this. No manual unsafe impl needed; **the install crate is the cleanest in the inventory** (it has 0 unsafe Send impls outside of `auto_installer.rs` plumbing).

Filed: NEG-S4 — the `bun_install` crate composes Send naturally without ANY manual `unsafe impl Send`.

## 2.8 Negative findings (explicit)

| Tag    | What was checked                                                | Why negative                                                                                          |
| ------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| NEG-D1 | `dependency_iter -> Box<dyn Iterator + '_>` Send-less           | Consumed single-threaded on the install thread; explicit `'_` keeps the trait object NOT-`'static`. |
| NEG-D2 | `CrashHandlerEntry` boxed-closure with `+ Send` + mutex         | Explicit Send bound + `Guarded<…>` chain; correctly bounded.                                          |
| NEG-D3 | `CryptoHasherZig::state: Box<dyn Any>` Send-less                | JS-thread-affine via `JsCell` wrapper.                                                                |
| NEG-D4 | Borrowed `&dyn T` cross-thread                                  | No site routes `&dyn T` into `thread::spawn`/`thread::Builder` closures.                              |
| NEG-D5 | `Pin<Box<dyn Future + Send>>` async hazard                      | Runtime has no async executor; zero `Future` trait-object sites.                                      |
| NEG-S1 | Monotone `unsafe impl Send` composition in bundler              | Each level repeats the same invariant; raw-ptr fields covered.                                        |
| NEG-S2 | `Guarded<Vec<CrashHandlerEntry>>` Send chain                    | All bounds satisfied by explicit `+ Send` on inner Box.                                               |
| NEG-S3 | `Strong<T>: Send` / `Weak<T>: Send`                             | Strong/Weak are explicitly `!Send + !Sync` by design — no impl exists.                                |
| NEG-S4 | `bun_install::Lockfile` Send/Sync                               | The install crate composes Send naturally; **zero manual `unsafe impl Send`** in `bun_install` proper. |
| NEG-S5 | `bun_resolver` cross-thread without explicit Send except for `EntriesOption`/`Entry` | The resolver's main types compose Send naturally; only the BSSList-allocated singletons need a manual impl. |
| NEG-S6 | `Box<dyn Send + Sync>` pattern                                  | Zero occurrences in the workspace.                                                                    |
| NEG-S7 | `Arc<Mutex<…>>` patterns                                        | Zero occurrences; the runtime uses `Guarded<T>` instead.                                              |

---

## 2.9 What I checked but did NOT find

For audit completeness, here are the additional patterns I searched for that came up empty:

- `unsafe impl Send for *mut T` — searched `unsafe impl.*for \*mut`: no hits in `src/` outside the macro-emitted `SendPtr` wrappers (which are always `pub struct SendPtr<T>(*mut T)` newtypes, not raw `*mut T`).
- `unsafe impl Send for &T` — searched `unsafe impl.*for &`: no hits. References inherit auto-traits properly via `bun_ptr::BackRef`/`ParentRef`.
- `Mutex<Box<dyn …>>` — searched `Mutex<Box<dyn` and `Guarded<Box<dyn` — no hits.
- `Cell<Box<dyn …>>` — no hits.
- `Channel<Box<dyn …>>` — no hits.
- `Pin<&mut dyn …>` — no hits (no async).
- `'static`-bounded trait objects with non-`'static` data — searched `Box<dyn .*> = .*&` patterns — only the crash-handler closure captures a fn pointer (always `'static`) and the `'_` iterator (lifetime preserved).
- `unsafe impl<T: Allocator> Send` for type whose `Allocator` impl isn't actually Send — checked `MultiArrayList<T, A>` (properly bounded `A: Allocator + Send`).

This negative-search inventory is the second half of the discipline obligation: I am claiming T1 = 0 not just because I looked at what's there, but because I looked for canonical anti-patterns and they are absent.

## 3. Tier totals

| Tier     | Count | IDs                                                                        |
| -------- | ----- | -------------------------------------------------------------------------- |
| T1       | 0 new | —                                                                          |
| Pre-existing T1 re-confirmed | 1 | `StoreSlice<T>` unbounded Send/Sync (already counted in Pass 2 / dashboard) |
| T2       | 5 new | T2-D1, T2-S1, T2-S2, T2-S3, T2-S5                                         |
| T3       | 4     | T3-S1, T3-S2, T3-S3, T3-S4                                                 |
| Negative | 12    | NEG-D1, NEG-D2, NEG-D3, NEG-D4, NEG-D5, NEG-S1, NEG-S2, NEG-S3, NEG-S4, NEG-S5, NEG-S6, NEG-S7 |

---

## 3.1 Why no T1

The brief warns: "Every T1 finding requires a concrete cross-thread reachability path." I followed that discipline strictly.

Most of the `unsafe impl Send`/`Sync` sites in the inventory **could** be incorrect in principle (a wrapper claiming Send for a non-Send field), but to elevate to T1 I needed an actual call path that derives a `&MyType` or moves a `MyType` cross-thread where:

- (a) the actual cross-thread use is reachable from a `thread::Builder::spawn` body or a `WorkPool::schedule(addr_of_mut!(task.task))` call;
- (b) the inner field's invariant is violated (e.g., a JS-thread-only resource dereferenced from the worker side);
- (c) the safety story documented in the SAFETY comment does NOT hold in that path.

For every site I traced, either (a) the type is not actually reached cross-thread (e.g. `Box<dyn SourceData>` stays in `StaticPipeWriter<P>` which is `!Send`), or (b)+(c) the SAFETY contract is upheld by the calling code (the work pool only invokes `ctx.run()` on the worker, never `ctx.drop()`; the destroy path returns through the JS thread via `ConcurrentTask`).

The five new T2 footguns are **all** of the form "could break if a future maintainer adds a use-site that the current code rules out by construction". `StoreSlice<T>` is different: the type's safe API already advertises the invalid auto-trait fact, so it remains in the T1 dashboard even if no in-tree call site currently instantiates it with a hostile `T`.

## 3.2 Pass 4 versus prior passes

To avoid duplicating work, I cross-referenced this pass against `PASS3-bun-jsc-deep-dive.md` (which covered `Strong`, `Weak`, `JsCell` from a different angle), `PASS3-bun-bundler-deep-dive.md` (worker-pool aliasing), `C-003-send-sync-impls.md` (Pass 2's broad Send/Sync sweep), and `PASS2-pin-and-drop-hazards.md` (Drop on the wrong thread).

The new ground covered in Pass 4:

1. **Owned-pointer trait objects** as a category (zero `Arc<dyn>`, five `Box<dyn>` — none of these were enumerated as a structural property in prior passes).
2. **Cross-crate composition chains** — the per-crate Send/Sync footprint table (§2.5) and the deeper walks (§2.7) are new.
3. The explicit **negative-search** inventory (§2.9) — confirming the audit looked for canonical anti-patterns and they are absent.
4. The **macro-level** footgun (T2-S5 `owned_task!`) is new.

Findings T2-S1 (ConcurrentPromiseTask Send-without-C:Send) and T2-S3 (`JsCell<T>` unbounded) were touched by Pass 3 (`PASS3-bun-jsc-deep-dive.md`) but not classified as compositions; here they are tiered against the brief's specific cross-crate framing.

## 4. Recommendations (no code changes performed; this is an audit pass)

1. **T2-S1 / T2-S2 / T2-S5**: tighten the unsafe Send impls to `where C: Send` / require `unsafe trait OwnedTaskOk` opt-in. Today's call sites all satisfy this; the change is purely defensive against future Contexts.
2. **Pre-existing T1 (`StoreSlice<T>`)**: add `T: Send` / `T: Sync` bounds to match the sibling `StoreRef<T>`. The current call graph already satisfies both bounds, and the fix remains a dashboard item rather than a merely latent T2.
3. **T2-D1** (`Box<dyn SourceData>`): inline a comment near `Source::Any` warning future maintainers that adding `+ Send` to the trait object would break `ArrayBufferStrong`'s thread-affinity contract. (No code change required today.)
4. **T2-S3** (`JsCell<T>` unbounded): document in `src/jsc/JSCell.rs` that this is *the* intentional Send/Sync-laundering primitive and that all wrapping types must independently uphold the JS-thread-affine invariant. (The doc comment already gestures at this; add a "**do NOT** use `JsCell<T>` in a struct that is not JS-thread-affine" line in bold.)
5. **T3-S1** / **T3-S4**: cosmetic — switch shell IO refcounting to a single-thread `Rc`-shaped wrapper; switch `platform_fd` to `OnceLock<Fd>`. Either is a multi-day refactor with no current bug, so deferred.

---

## 4.1 Estimated effort to close T2s

| Finding | Diff size      | Risk to landing                                                                                                 |
| ------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| T2-D1   | comment only   | Trivial.                                                                                                       |
| T2-S1   | 1-line change  | Add `where C: Send` to `unsafe impl<C: ConcurrentPromiseTaskContext> Send for ConcurrentPromiseTask<'_, C>`. Every existing impl (`CopyFile`, `WalkTask`, `PipelineTask`, `TransformTask`) needs auditing — `CopyFile<'a>` currently isn't trivially Send (the `'a JSGlobalObject`); the in-tree TODO already calls this out. So this is gated on the `'a → *const` lifetime cleanup in `copy_file.rs`. Days of work, not minutes. |
| T2-S2   | 1-line change  | Add `where C: Send` to `unsafe impl<C: WorkTaskContext> Send for WorkTask<C>`. `GetAddrInfoRequest`'s raw `*mut Resolver`/`*mut DNSLookup` are `!Send` by default; would need a `SendPtr` wrapper or an explicit `unsafe impl Send for GetAddrInfoRequest`. Half-day. |
| T2-S3   | doc only       | Add a "do not embed in non-JS-thread-affine types" admonition. Minutes.                                          |
| Pre-existing T1: StoreSlice | 2-line change | Add `T: Send` and `T: Sync` bounds to `StoreSlice<T>`. All existing call sites satisfy. Minutes. |
| T2-S5   | macro hardening | Add an opt-in `unsafe trait OwnedTaskOk` marker; each call site of `owned_task!` would need to `unsafe impl OwnedTaskOk` separately. Half-day.       |
| T3-S1   | refactor       | Replace `Arc<IOReader>`/`Arc<IOWriter>` with a single-thread refcount wrapper. Multi-day; cosmetic.              |
| T3-S2   | refactor       | Convert `Blob`'s `RawRefCount` to `RawAtomicRefCount` where cross-thread is reachable. Risk of perf regression — needs benchmarking. |
| T3-S3   | name only      | Optional; the type's name communicates intent.                                                                  |
| T3-S4   | 5-line change  | Replace `Cell<Fd>` with `OnceLock<Fd>`. Minutes.                                                                |

The highest leverage per LOC: pre-existing T1 `StoreSlice` bounds, then T2-D1 (comment) and T2-S3 (doc).
The T2 with the most upstream risk: T2-S1 (`ConcurrentPromiseTask` cleanup is blocked on a lifetime parameter migration).

## 5. Discipline notes (process correctness)

- Every finding above includes the file:line cite and the SAFETY-comment text I tested against. I did NOT propagate verbatim claims without re-deriving the synchronization story from the surrounding code.
- I flagged the two existing `TODO(ub-audit)` markers in `src/bundler/Chunk.rs` (the `Renamer<'r>` mutable-reborrow concern) and `src/runtime/webcore/blob/copy_file.rs` (the `'a` lifetime parameter cross-thread concern) for cross-reference but did NOT count them as new findings — they pre-exist in the source.
- Zero T1 findings means every `unsafe impl Send/Sync` I sampled was either provably sound under the documented contract, or is a latent footgun (T2) whose current call site does not trigger UB.
- Zero `Arc<dyn>` / zero `Pin<Box<dyn Future>>` is a notable **structural property** of this codebase that deserves a comment in `src/CLAUDE.md` or a contributor-facing doc — it sharply narrows the design space new contributors should consider, and prevents accidental tokio adoption.

---

## 6. Files that were primary sources for this pass

(absolute paths, for the report's caller)

- `src/install_types/resolver_hooks.rs`
- `src/resolver/package_json.rs`
- `src/crash_handler/lib.rs`
- `src/runtime/crypto/CryptoHasher.rs`
- `src/spawn/lib.rs`
- `src/spawn/static_pipe_writer.rs`
- `src/runtime/api/bun/subprocess.rs`
- `src/jsc/ConcurrentPromiseTask.rs`
- `src/jsc/WorkTask.rs`
- `src/jsc/JSCell.rs`
- `src/jsc/VirtualMachine.rs`
- `src/jsc/webcore_types.rs` (Blob, StoreRef)
- `src/ast/nodes.rs` (StoreRef vs StoreSlice vs StoreStr)
- `src/bun_core/util.rs` (Once, RacyCell, ThreadLock)
- `src/bun_core/lib.rs` (RawSlice)
- `src/bun_core/string/StringJoiner.rs`
- `src/bun_alloc/MimallocArena.rs`
- `src/bun_alloc/MaxHeapAllocator.rs`
- `src/bun_alloc/lib.rs` (BSSList)
- `src/threading/work_pool.rs` (`owned_task!` macro)
- `src/threading/guarded.rs`
- `src/threading/channel.rs`
- `src/threading/RwLock.rs`
- `src/threading/ThreadPool.rs`
- `src/bundler/Chunk.rs`
- `src/bundler/LinkerContext.rs`
- `src/bundler/LinkerGraph.rs`
- `src/bundler/ThreadPool.rs`
- `src/bundler/lib.rs`
- `src/resolver/fs.rs`
- `src/resolver/lib.rs`
- `src/http/ssl_config.rs`
- `src/http/lshpack.rs`
- `src/http/h3_client/PendingConnect.rs`
- `src/http/HTTPThread.rs`
- `src/sql_jsc/jsc.rs`
- `src/runtime/node/path_watcher.rs`
- `src/runtime/dns_jsc/dns.rs`
- `src/runtime/shell/IOReader.rs`
- `src/runtime/shell/IOWriter.rs`
- `src/runtime/webcore/blob/copy_file.rs` (pre-existing TODO)
- `src/runtime/webcore/Blob.rs`
- `src/runtime/api/glob.rs`, `JSTranspiler.rs`, `image/Image.rs` (Context implementors)
- `src/runtime/webcore/blob/{read_file,write_file}.rs` (Context implementors)
- `src/ptr/lib.rs` (BackRef)
- `src/ptr/parent_ref.rs` (ParentRef)
- `src/ptr/raw_ref_count.rs` (RawRefCount thread-lock)
- `src/opaque/lib.rs` (`opaque_ffi!` macro `!Send + !Sync` default)
- `src/dispatch/lib.rs` (`link_interface!` macro)
- `src/semver/SemverQuery.rs`
- `src/standalone_graph/StandaloneModuleGraph.rs`

---

*End of Pass 4 audit. No code changes performed; this is an analysis-only deliverable per the brief.*
