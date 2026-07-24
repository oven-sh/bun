---

## review-whole:cycles

# Adversarial Review — DEPENDENCY CYCLES & BUILD

## Hard cycles the proposal introduces

**1. `bun_sys` ↔ `bun_crypto` via `exe_format → sha_hmac`.**
`bun_sys` absorbs `bun_exe_format`. `/workspace/bun/src/exe_format/macho.rs:814` calls `bun_sha_hmac::sha::SHA256::hash(...)`. `bun_sha_hmac` is absorbed into `bun_crypto`, whose stated deps are `bun_core, bun_sys`. Result: `bun_sys → bun_crypto → bun_sys`.
**Must change:** either keep `exe_format` out of `bun_sys` (put it in `bun_crypto` or higher — its only importer is `standalone_graph`), or host a raw `SHA256` FFI in `bun_core`/`bun_sys`.

**2. `bun_sys` ↔ `bun_loop` via `crash_handler → FmtAdapter`.**
Proposal states crash_handler "drops its `bun_io` dep (use `bun_core::io::Write`)". But `/workspace/bun/src/crash_handler/lib.rs:402` is `pub use bun_io::{FmtAdapter, Write};`. `FmtAdapter` is defined at `/workspace/bun/src/io/write.rs:312` (in `bun_io`, NOT re-exported from `bun_core` — only `Write`/`IntBe`/`IntLe` are, per `/workspace/bun/src/io/write.rs:32`). `bun_io` → `bun_loop` → `bun_sys` = cycle.
**Must change:** explicitly move `/workspace/bun/src/io/write.rs` helpers (`FmtAdapter`, `FixedBufferStream`, `BufWriter`, `DiscardingWriter`, `AsFmt`, ~400 LOC, zero event-loop coupling) into `bun_core`. This is unstated and also blocks objections 5 and 6.

**3. `bun_jsc` ↔ `bun_bundler` via `BunPluginTarget`.**
`JSGlobalObject` is listed as group-A. `/workspace/bun/src/jsc/JSGlobalObject.rs:1510` is `pub use bun_bundler::transpiler::BunPluginTarget;`; `:632-664` `run_on_load_plugins`/`run_on_resolve_plugins` take `BunPluginTarget` by value and pass it to `extern "C" Bun__runOn{Load,Resolve}Plugins` (`:1646,1653`). The proposal's payoff is `bun_bundler → bun_jsc` (direct `generate_cached_bytecode` call). That closes `bun_jsc → bun_bundler → bun_jsc`.
**Must change:** move the 3-variant `BunPluginTarget` enum down to `bun_jsc` (or `bun_ast`), and move `run_on_{load,resolve}_plugins`/`throw_invalid_scrypt_params` off `JSGlobalObject` into group-B or an ext trait.

**4. `bun_ast` ↔ `bun_install` via `PnpmMatcher` in `schema::api::BunInstall` — the `__bun_regex_*` elimination is not achievable as stated.**
Proposal: "`PnpmMatcher` moves UP to `bun_install` (its only callers — ini/bunfig/install — are all there)". FALSE for the *type*. `PnpmMatcher` is a struct field of `options_types::schema::api::BunInstall` (`/workspace/bun/src/options_types/schema.rs:325-326`), and `BunInstall` is stored/referenced from: `/workspace/bun/src/options_types/context.rs:31` (`ContextData.install`, absorbed into `bun_ast`), `/workspace/bun/src/resolver/options.rs:221` + `/workspace/bun/src/resolver/resolver.rs:43` (absorbed into `bun_resolver`), `/workspace/bun/src/bundler/options.rs:1347` (`bun_bundler`). `bun_install` depends on `bun_resolver`. Moving `PnpmMatcher` to `bun_install` forces `bun_ast`/`bun_resolver` → `bun_install` → cycle.
**Must change:** either the `PnpmMatcher` *type* (struct of `Box<[Matcher]>` + `Behavior`, `/workspace/bun/src/install_types/NodeLinker.rs:126-139`) stays in `bun_ast` with the `__bun_regex_*` extern retained (proposal's elimination claim is wrong), or `BunInstall.{public_,}hoist_pattern` become `Option<NonNull<()>>` (a *new* type-erasure workaround).

## "Depends on" lines that don't match reality

**5. `bun_jsc` "Depends on: bun_core, bun_sys, bun_macros" omits at least `bun_ast`, `bun_crypto`, `bun_uws`, `bun_loop`.**
Group-A files as listed in the proposal actually import:
- `/workspace/bun/src/jsc/JSGlobalObject.rs:431,437` → `bun_boringssl::c::{ERR_peek_last_error,ERR_error_string_n}` (in `bun_crypto`)
- `/workspace/bun/src/jsc/FetchHeaders.rs:7,93,205` → `bun_uws::ResponseKind` (parameter type, defined `/workspace/bun/src/uws/lib.rs:54`; in merged `bun_uws`)
- `/workspace/bun/src/jsc/AbortSignal.rs:9,291,308` → `bun_event_loop::EventLoopTimer` **embedded by value** in `struct Timeout` + `impl_timer_owner!` (in `bun_loop`)
- `/workspace/bun/src/jsc/CachedBytecode.rs:4` → `bun_options_types::Format` (in `bun_ast`)
- `/workspace/bun/src/jsc/BuildMessage.rs:14`, `/workspace/bun/src/jsc/ResolveMessage.rs:18` → `bun_ast::Msg` as struct field; `/workspace/bun/src/jsc/error.rs:78,82` → `bun_ast::{Error,ToJSError}` (proposal says error.rs drops Resolver/Bundler/Install/Patch arms but not Ast)

These are all acyclic *if added*, but (a) the declared dep line is false, and (b) adding them destroys the "compile parallel with `bun_ast`" property and pushes `bun_jsc` behind `bun_loop` on the critical path — which in turn delays `bun_install`/`bun_bundler` (both need `bun_jsc` for `RegularExpression`/`CachedBytecode`).
**Must change:** either reclassify `AbortSignal`/`FetchHeaders`/`BuildMessage`/`ResolveMessage`/`throw_invalid_scrypt_params` as group-B, move `ResponseKind`/`Format`/`BunPluginTarget` down, or amend the dep line to `bun_core, bun_sys, bun_ast, bun_crypto, bun_uws, bun_loop, bun_macros` and accept the build-graph consequence.

**6. `AbortSignal` is misclassified as group-A; it is structurally group-B.**
`/workspace/bun/src/jsc/AbortSignal.rs:328,342,355,389,448` call `VirtualMachine::get()`, `VirtualMachine::timer_insert(vm, ...)`, `VirtualMachine::timer_remove(vm, ...)`, `VirtualMachine::get_mut_ptr()`. `VirtualMachine` is group-B → `bun_runtime`. Keeping `AbortSignal` in `bun_jsc` re-creates a `bun_jsc → bun_runtime` back-edge (exactly the `RuntimeHooks::timer_insert/remove` slot the proposal claims to delete).
**Must change:** move `AbortSignal`'s `Timeout` (or all of `AbortSignal.rs`) to group-B.

**7. `bun_ast` / `bun_css` "Depends on" lines omit the `bun_io` write-helpers (or the move is unstated).**
- `bun_ast` absorbs `sourcemap`; `/workspace/bun/src/sourcemap/ParsedSourceMap.rs:347` uses `bun_io::FmtAdapter::new`.
- `/workspace/bun/src/css/css_parser.rs:6459` `pub type FixedBufWriter<'a> = bun_io::FixedBufferStream<&'a mut [u8]>;`

Neither `FmtAdapter` nor `FixedBufferStream` is in `bun_core` today. Same fix as objection 2.

**8. `bun_loop` "Depends on: bun_core, bun_sys, bun_uws" — `dotenv` severance is under-specified.**
Drops `event_loop→dotenv` (env map passed as parameter)" does not match the code: `MiniEventLoop` *constructs* `dotenv::Map` and `DotEnvLoader` (`/workspace/bun/src/event_loop/MiniEventLoop.rs:162-173`), and the `JsEventLoop` interface signatures `env() -> *mut bun_dotenv::Loader<'static>` + `create_null_delimited_env_map() -> Result<bun_dotenv::NullDelimitedEnvMap, _>` (`/workspace/bun/src/event_loop/lib.rs:68,70`) name `dotenv` types in their return types. These also reach `bun_install` (`/workspace/bun/src/install/lifecycle_script_runner.rs:274`). Dropping the dep requires changing the public types of the event-loop env accessors, not just the call site.
**Must change:** either add `bun_ast` to `bun_loop`'s deps (acyclic; `bun_ast` has no `bun_loop` edge) or specify that `NullDelimitedEnvMap`/`Loader` move to `bun_core`.

## "Workaround eliminated" claims that don't hold

**9. "25 `extern "C" UpgradedDuplex__*`/`WindowsNamedPipe__*` Rust→Rust shims (replaced by handler registration)" conflates two different dispatch layers.**
`vtable::Handler` (`/workspace/bun/src/uws_sys/vtable.rs:38`) is the C→Rust `us_socket_vtable_t` (on_open/on_data/on_close). The `UpgradedDuplex__*` shims back the *opposite* direction: the ~40 Rust methods on `NewSocketHandler<IS_SSL>` (`write`, `close`, `shutdown`, `timeout`, `ssl`, `set_no_delay`, … — `/workspace/bun/src/uws_sys/socket.rs:264-645`) which `match_sock!` across `InternalSocket`'s 5 variants (18 match sites). `InternalSocket` is consumed by value in `bun_http` (`/workspace/bun/src/http/lib.rs:1183`) and `sql_jsc`. Removing `UpgradedDuplex`/`Pipe` variants requires a new ~40-method socket-ops vtable, not "the existing C-vtable mechanism".
**Must change:** retract the elimination claim, or specify the new `dyn SocketOps` replacement and where `NewSocketHandler` dispatches to it.

**10. `__bun_jsc_enable_hot_module_reloading_for_bundler` cannot be eliminated by the split.**
Impl is `/workspace/bun/src/jsc/hot_reloader.rs:1418`; `hot_reloader.rs` is group-B → `bun_runtime`. Declarer is `/workspace/bun/src/bundler/bundle_v2.rs:1427` in `bun_bundler`. After the split this becomes `bun_bundler → bun_runtime`, and `bun_runtime → bun_bundler` already exists. This extern stays (same status as `DevServerHandle`/`VmLoaderCtx`). Only the sibling `__bun_jsc_generate_cached_bytecode` (impl in group-A `CachedBytecode.rs`) is actually eliminable.
**Must change:** move this symbol to the "remaining seams" list, not the eliminated list.

## Build-parallelism damage

**11. `bun_core` at 88k LOC serializes the build start.**
Today `bun_core` is 33k; `collections`(12.5k)/`paths`(6.8k)/`url`(1.8k)/`semver`(3.7k)/`http_types`(5.5k)/`errno`(2k)/`base64`(1k)/`analytics`(0.8k)/`libuv_sys`(3.6k) each start as soon as *their* small dep subset finishes. Under the proposal, none of `bun_sys`/`bun_ast`/`bun_crypto`/`bun_jsc` can begin until all 88k finish frontend. `/workspace/bun/scripts/build/rust.ts:423-438` already flags the single-threaded frontend as the bottleneck; `-Zthreads=8` helps but "returns flatten past ~8 (the query DAG has its own serial spine)".
**Must change:** consider keeping `libuv_sys`/`http_types`/`semver`/`url`/`picohttp` out of `bun_core` (they have ≤2 internal deps and many parallel consumers), or accept and document the ~2.5× first-gate regression for debug cold-build.

**12. `bun_runtime` grows ~22% (330k → ~400k+) while already being the documented long pole.**
Group-B (~37k) + eleven `*_jsc` crates (~28k) + `sql`(6k) + `valkey`/`csrf`/`tcc_sys` ≈ 72k added. `/workspace/bun/scripts/build/rust.ts:423-434`: "the critical-path crate (`bun_runtime`) sits on one core while the rest idle". Today `sql_jsc`(15k)/`http_jsc`(6k)/`js_parser_jsc`/etc. compile in parallel with each other after `bun_jsc` finishes; under the proposal that parallelism is gone.
**Must change:** either accept and document, or keep `sql_jsc` (15k driver) and `http_jsc::websocket_client` (5.8k) as separate leaf crates above `bun_runtime`'s deps but below `bun_bin` — they have no inbound edge except `bun_runtime` itself, so they can compile in parallel with `bun_runtime` and link in `bun_bin`.

**13. Critical path through the parser stack is fully serial: `core(88k) → sys(49k) → ast(68k) → react_compiler(63k) → js(57k) → resolver(20k)` = 345k LOC before `bun_bundler`/`bun_install` can start frontend.**
`bun_js` "Depends on: … `bun_react_compiler`" and `bun_react_compiler` "Depends on: … `bun_ast`" means these three 60k-class crates are strictly serial. `bun_css` (72k) is the only thing running alongside `react_compiler`+`js`. Contrast current graph: `js_parser`(47k) and `react_compiler`(63k) are already serial, but `ast`(20k)/`parsers`(14k)/`sourcemap`(5k)/`dotenv`/`options_types` compile in parallel among themselves and alongside `resolver`.
**Must change:** nothing structural if this is accepted; but the proposal's "Kept separate for build parallelism — 72k LOC that compiles in parallel with `bun_react_compiler`+`bun_js`" rationale for `bun_css` is the *only* parallelism analysis given, and it ignores that the proposal simultaneously deletes far more parallelism on the `ast`/`sys`/`core` side.

## Minor / dead-edge corrections

**14. `bun_analytics → bun_sys` is a dead Cargo.toml edge, not a real dep** — `/workspace/bun/src/analytics/Cargo.toml:23` declares it, but zero `.rs` references (only a comment at `lib.rs:415`). The proposal's `bun_core` absorption of `analytics` is therefore acyclic, but the dead edge must be deleted or `cargo` will reject the cycle anyway.

**15. `bun_sys` absorbs `zlib`/`brotli`; both declare `bun_io` in Cargo.toml.** `/workspace/bun/src/zlib/lib.rs:251` and `/workspace/bun/src/brotli/lib.rs:552-605` only use `bun_io::Write`/`bun_io::Result`, which are `pub use bun_core::write::{...}` per `/workspace/bun/src/io/write.rs:32`. Acyclic once rewritten to `bun_core::write::Write`, but the proposal doesn't state this rewrite and as-written `bun_sys → bun_loop → bun_sys` at the Cargo level.

---

## review-whole:semantics

# Adversarial Review — Semantic Correctness & Rust Idiom

## 1. `BufferedReader` → `*const dyn BufferedReaderParent` is not object-safe and violates the documented aliasing contract

**What's wrong:** The proposal says "`BufferedReader` holds `*const dyn BufferedReaderParent` (trait takes `&self` + interior mutability for the aliasing case)." The actual trait at `/workspace/bun/src/io/PipeReader.rs:69-91` takes **`*mut Self`** on every method, with a 17-line SAFETY comment explaining why: the parent _embeds_ the `BufferedReader` as a field, and callbacks fire while `&mut BufferedReader` is live on the caller's stack — forming `&self` on the parent would alias that live `&mut` (Stacked-Borrows UB). "Interior mutability" doesn't fix this: `UnsafeCell` on the reader field still doesn't permit `&Parent` while `&mut parent.reader` is outstanding. Additionally the trait has `const KIND` and `const HAS_ON_READ_CHUNK: bool` (PipeReader.rs:72,74) — associated consts without `where Self: Sized` bounds make the trait non-object-safe.

**Evidence:** `/workspace/bun/src/io/PipeReader.rs:52-68` (aliasing contract), `:72-90` (trait signature).

**What must change:** Either keep a tagged-handle form (drop the "delete `bun_dispatch`" claim for this interface and implement an equivalent in-tree macro in `bun_loop`), or redesign so the reader is not embedded in the parent (heap-allocated reader with a back-pointer) — a much larger change the proposal does not acknowledge.

## 2. `ProcessExit` → `Option<Box<dyn ProcessExitHandler>>` breaks the `Copy` semantics that `Process::on_exit` relies on

**What's wrong:** The proposal says `Process` holds `Option<Box<dyn ProcessExitHandler>>`. But `/workspace/bun/src/spawn/process.rs:270-277` does `let exit_handler = self.exit_handler;` (a `Copy`), then `self.detach()`, then calls the handler with `&mut self`. With `Box<dyn>` this becomes `let exit_handler = self.exit_handler.take();` — semantically different (the handler is now gone from `self`), and more importantly the handler types (`Subprocess`, `LifecycleScriptSubprocess`, etc.) are **not owned by `Process`**; they own `Process` (the `link_impl_ProcessExit!` body at `/workspace/bun/src/runtime/api/bun/subprocess.rs:343-351` dereferences `|this|` = `*mut Subprocess`). `Box<dyn>` implies `Process` owns and will drop the handler — wrong direction.

**Evidence:** `/workspace/bun/src/spawn/process.rs:271-277` (comment: "ProcessExitHandler is Copy (owner ptr + &'static vtable)"); `/workspace/bun/src/spawn/lib.rs:72-92`.

**What must change:** If going `dyn`, it must be `Option<NonNull<dyn ProcessExitHandler>>` (non-owning, `Copy`-able via `*mut dyn`). State this explicitly and note that every `set_exit_handler` call site must now coerce `*mut ConcreteType` → `*mut dyn` at the boundary.

## 3. `EventLoopCtx` → `enum { Mini(MiniEventLoop), Js(...) }` stores a 256KB+ struct by value

**What's wrong:** `MiniEventLoop` (`/workspace/bun/src/event_loop/MiniEventLoop.rs:82-100`) contains `tasks: Queue`, `concurrent_tasks: UnboundedQueue`, `file_polls_: Option<Box<FilePollStore>>`, `pipe_read_buffer: Option<Box<[u8; 256*1024]>>`, `env`, `top_level_dir: Box<[u8]>`, etc. Storing it by value in an enum handle that today is `{kind: u8, owner: *mut ()}` (16 bytes, `Copy`, passed by value through `FilePoll`/`KeepAlive`/`BufferedReader::event_loop()`) is nonsensical. `EventLoopCtx` is returned by value from `BufferedReaderParent::event_loop()` (`PipeReader.rs:84`) and stored in `FilePoll`.

**Evidence:** `/workspace/bun/src/event_loop/MiniEventLoop.rs:62-100`; `/workspace/bun/src/io/lib.rs:1784` (`pub type EventLoopHandle = EventLoopCtx`); `/workspace/bun/src/io/PipeReader.rs:84,108,486`.

**What must change:** `enum { Mini(NonNull<MiniEventLoop>), Js(NonNull<dyn JsEventLoopHooks>) }` — both arms pointers. And since `bun_install` constructs the `Mini` variant (`/workspace/bun/src/install/PackageManager.rs:18-20`), the `Js` arm's `dyn` trait must be defined in `bun_loop` (not runtime), so install can name the enum without naming the impl.

## 4. `Task` → `NonNull<dyn Runnable>` hand-waves over non-uniform dispatch signatures

**What's wrong:** The proposal says "`Task` holds `NonNull<dyn Runnable>` (intrusive, zero-alloc — task structs embed the vtable ptr)". Two errors: (a) `NonNull<dyn T>` is a fat pointer — the vtable lives in the _pointer_, not embedded in the task struct; (b) the 96 arms in `/workspace/bun/src/runtime/dispatch.rs:252-620` are **not uniform**: some call `.run_from_js()`, some `.run_from_js(vm, global)`, some `.run_from_js_thread(el, global, vm)`, some `.on_progress_update()`, some `.on_poll()` (without even using `task.ptr` — `PollPendingModulesTask` at :348 calls `vm.modules.on_poll()`), some return `RunTaskResult::EarlyReturn` (`:364`), and ~50 of them `destroy()` after running (`run_then_destroy!` at :231). A single `fn run(&mut self)` trait cannot express "run then destroy via `heap::destroy`", nor "return early-exit from the drain loop", nor "access `&mut VirtualMachine`" without threading it as a parameter.

**Evidence:** `/workspace/bun/src/runtime/dispatch.rs:196-460`.

**What must change:** Either (a) the trait becomes `unsafe fn run(this: *mut (), el: &mut EventLoop, vm: &mut VirtualMachine, global: &JSGlobalObject) -> Result<RunTaskResult, JsTerminated>` stored alongside an `unsafe fn release(this: *mut ())` — i.e., a two-slot manual vtable, which is what you'd have anyway; or (b) acknowledge that `dispatch.rs` doesn't delete, it becomes ~96 `impl Runnable` blocks scattered across runtime modules with net-zero LOC change. The "dispatch.rs deletes entirely" claim is false as a LOC reduction.

## 5. "Remove `UpgradedDuplex`/`WindowsNamedPipe` from `InternalSocket`; register as `vtable::Handler`" conflates C event callbacks with Rust-side imperative methods

**What's wrong:** `InternalSocket` is matched in **38 places** across `/workspace/bun/src/uws_sys/socket.rs` (16 via the `on_socket!` macro) to dispatch **imperative** methods: `write()`, `raw_write()`, `raw_writev()`, `flush()`, `write_fd()`, `timeout()`, `set_timeout()`, `set_timeout_minutes()`, `pause_stream()`, `ssl()`, etc. These are calls _from_ Rust _into_ the variant type. `vtable::Handler` (`/workspace/bun/src/uws_sys/vtable.rs:38`) covers only the 11 _event_ callbacks (on*open/on_data/on_close/...) that C calls \_into* Rust. Removing the enum variants doesn't remove the need to dispatch `write`/`flush`/`timeout` to `UpgradedDuplex` — and since `UpgradedDuplex` is a JS Duplex stream wrapper (not a real C socket), it cannot be registered as a `us_socket_t`.

**Evidence:** `/workspace/bun/src/uws_sys/socket.rs:60,62` (enum variants), `:380-500` (imperative dispatches), grep count = 38 match sites.

**What must change:** Either keep the enum with opaque `*mut ()` payloads + keep the 25 `extern "C"` shims (they're Rust→Rust but C-ABI, independent of `bun_dispatch`), or add a second Rust-side `dyn SocketTransport` vtable for the imperative methods and store `InternalSocket::Virtual(*mut dyn SocketTransport)` — a net addition, not the claimed elimination.

## 6. "`PnpmMatcher` moves UP to `bun_install`" leaves `schema::api::BunInstall` with a dangling field type

**What's wrong:** `/workspace/bun/src/options_types/schema.rs:325-326` has `pub public_hoist_pattern: Option<PnpmMatcher>` and `pub hoist_pattern: Option<PnpmMatcher>` as **struct fields** on `BunInstall`. The proposal puts `options_types` into `bun_ast` and moves `PnpmMatcher` up to `bun_install` "so this crate has no JSC regex dependency". But `bun_ast < bun_install`, so `BunInstall` can no longer name its own field type.

**Evidence:** `/workspace/bun/src/options_types/schema.rs:263,325-326`; `/workspace/bun/src/ini/lib.rs:1807-1920` and `/workspace/bun/src/bunfig/bunfig.rs:1541-1547` construct `PnpmMatcher` and store into `BunInstall` — both ini/bunfig are also below install.

**What must change:** Either (a) `PnpmMatcher` stays in `bun_ast` and the `__bun_regex_*` extern survives (or is replaced with a `regex` crate so no JSC call-up); or (b) the `BunInstall` struct itself moves up to `bun_install`, which breaks the 17 `options_types` importers below install; or (c) the fields become `Option<Box<dyn PatternMatcher>>` with the trait in `bun_ast` — a new workaround, not an elimination.

## 7. "css/js/sourcemap/crash_handler drop `bun_io` dep" ignores that `FixedBufferStream`/`FmtAdapter`/`BufWriter` live in `bun_io`, not `bun_core`

**What's wrong:** The proposal puts `bun_io` into `bun_loop` (which depends on `bun_uws` → `bun_crypto`), and lists `bun_css`, `bun_js`, `bun_ast` (absorbing sourcemap), and `bun_sys` (absorbing crash_handler) as NOT depending on `bun_loop`. But:

- `/workspace/bun/src/css/css_parser.rs:6459` uses `bun_io::FixedBufferStream`
- `/workspace/bun/src/sourcemap/ParsedSourceMap.rs:347` uses `bun_io::FmtAdapter`
- `/workspace/bun/src/crash_handler/lib.rs:402` `pub use bun_io::{FmtAdapter, Write}`
- `/workspace/bun/src/js_parser/parser.rs:501-546` uses `bun_io::Write` (OK, that's re-exported from core) but css/sourcemap/crash_handler need the concrete helper types.

`FixedBufferStream`, `FmtAdapter`, `BufWriter` are defined in `/workspace/bun/src/io/write.rs:76,230,312` — in `bun_io`, not `bun_core`. The proposal says "use `bun_core::io::Write`" but only the **trait** is in core; the helper types are not.

**What must change:** Explicitly state that `src/io/write.rs` (~400 LOC, pure formatting, zero event-loop coupling per REGION 2's open question) moves to `bun_core::io` as a prerequisite. Without this, `bun_css`/`bun_ast`/`bun_sys` would need `bun_loop` → `bun_uws` → `bun_crypto`, destroying the "parallel with react_compiler/js" build-graph claim.

## 8. Slim `bun_jsc` dep list omits `bun_ast` but `CachedBytecode` needs `options_types::Format`

**What's wrong:** Proposal lists `bun_jsc` deps as `bun_core, bun_sys, bun_macros`. But `/workspace/bun/src/jsc/CachedBytecode.rs:4` is `use bun_options_types::Format;` and `CachedBytecode::generate(format: Format, ...)` branches on `Format::{Esm, Cjs}`. Under the proposal, `Format` lives in `bun_ast`. Also `/workspace/bun/src/jsc/JSGlobalObject.rs:1510` has `pub use bun_bundler::transpiler::BunPluginTarget;` — a group-A file re-exporting from bundler.

**Evidence:** `/workspace/bun/src/jsc/CachedBytecode.rs:4,144-152`; `/workspace/bun/src/jsc/JSGlobalObject.rs:1510`.

**What must change:** Either `bun_jsc` depends on `bun_ast` (acceptable — ast is below bundler/install so no cycle), or `CachedBytecode::generate` is split into `generate_esm`/`generate_cjs` and the caller (now bundler, directly) picks. The `BunPluginTarget` re-export must be deleted from `JSGlobalObject.rs` and callers updated.

## 9. `__bun_jsc_generate_cached_bytecode` body references `crate::virtual_machine` — can't stay in slim `bun_jsc`

**What's wrong:** The proposal says bundler calls `generate_cached_bytecode` directly (extern shim deleted). But the current body at `/workspace/bun/src/jsc/CachedBytecode.rs:144-158` does `crate::virtual_machine::IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE.set(true)` and `crate::initialize(false)`. `VirtualMachine` moves to runtime. So either the thread-local and `initialize()` stay in slim `bun_jsc` (plausible — need to verify `initialize()` doesn't touch group-B types), or bundler must call three things instead of one.

**What must change:** State where `IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE` and `jsc::initialize()` live. If in slim `bun_jsc`, verify `initialize()` has no group-B dependencies.

## 10. `bun_runtime` becomes ~400k LOC; the proposal's truncation hides this

**What's wrong:** The proposal is cut off before `bun_runtime`, but the arithmetic is: current 330,861 + bun_jsc group-B ~37k (incl. ConsoleObject 6,134) + 11 `*_jsc` crates ~28,342 + `bun_sql` 5,969 + `bun_valkey` 832 + `bun_csrf` 276 + `bun_tcc_sys` 493 − `jsc_hooks.rs` 5,378 − assorted hooks ≈ **~398,000 LOC**. The research (REGION 10) notes `bun_runtime` is already the serial long-pole for debug builds (`scripts/build/rust.ts:423-438` `-Zthreads=8` comment). Growing it 20% makes incremental rebuild scope and debug cold-build measurably worse.

**Evidence:** `/workspace/bun/src` total = 1,040,273 LOC; per-crate counts from REGION 9/10/11.

**What must change:** The proposal should show the `bun_runtime` entry with its LOC estimate and acknowledge the debug-build cost, or propose a `bun_runtime_core` / `bun_runtime_cli` split (cli/ 54k + test_runner/ 21k + bake/ 20k are candidates for a second crate).

## 11. "`bun_dispatch` is deleted" but `DevServerHandle`/`VmLoaderCtx` (bundler→runtime) still need a mechanism

**What's wrong:** Proposal says "`bun_dispatch` proc-macro crate (407 LOC) deleted outright" and "every `link_interface!` is replaced by a trait object or direct call". But `DevServerHandle[Bake]` (`/workspace/bun/src/bundler/lib.rs:338`, 11 methods) and `VmLoaderCtx[Runtime]` (`:364`, 12 methods) are bundler→runtime, which survives the split. The proposal is truncated before bundler, so we can't see what replaces them, but "direct call" is impossible (bundler < runtime) and the proposal's `bun_loop` section already demonstrates the author's replacement strategy (`&'static dyn`) has issues (#1-#3). Meanwhile objection #1 shows at least one interface (`BufferedReaderParentLink`) **cannot** become a trait object — so "every `link_interface!` is replaced" is overstatement.

**What must change:** Either keep a minimal `link_interface!`-equivalent macro in `bun_macros` (don't delete the mechanism, delete the crate), or explicitly enumerate which of the 10 interfaces become `dyn` and which stay tagged-enum-over-extern.

## 12. Self-contradictory `bun_http` claim

**What's wrong:** Proposal's `bun_http` section says "Drops `bun_http→bun_ast` edge by moving `Log`/`Loc` usage to take `&dyn` or by using `bun_ast` which is already a dep here now." You can't drop an edge by using it. The dep list for `bun_http` includes `bun_ast`, so the edge isn't dropped.

**Evidence:** Proposal text; `/workspace/bun/src/http/AsyncHTTP.rs:4` uses `bun_ast::{Loc, Log}`.

**What must change:** Delete the "drops" sentence; the edge stays.

## 13. -100k LOC claim (if made) is inflated by an order of magnitude

**What's wrong:** The visible proposal text makes no explicit total, but the reviewer brief asks about a "-100k LOC" claim. Actual _deletable_ code (not moved): `jsc_hooks.rs` 5,378 + `bun_dispatch` 407 + `bun_output` 51 + `bun_api` 78 + `bun_transpiler` 10 + `bun_uws` façade ~1,000 + `sql_jsc/jsc.rs` façade ~903 + `RuntimeHooks`/`LoaderHooks`/`SqlRuntimeHooks` structs+statics ~500 + `hw_exports.rs` SQL hooks ~100 + `ErasedJsError` twin ~50 + `BundleOptions` dup ~90 + 2 `js_printer` vtables ~100 + misc opaque_ffi stubs ~200 ≈ **~9k LOC** of genuine deletions. `dispatch.rs` (1,236) doesn't net-delete — arms become `impl` blocks (objection #4). Everything else is relocation. ~80 removed `Cargo.toml`+`lib.rs` boilerplate adds maybe ~3k. Total honest deletion: **~12-15k LOC**, not 100k.

**What must change:** State the LOC delta as "~12-15k deleted, ~400k relocated" or drop the claim.

## 14. `bun_core` absorbs `bun_analytics` but proposal doesn't address `analytics→bun_semver→bun_core` ordering

**What's wrong:** Proposal puts `bun_analytics` and `bun_semver` both into `bun_core`. Current `bun_analytics` depends on `bun_semver` (`/workspace/bun/src/analytics/lib.rs:475,499` for kernel-version parsing) and `bun_errno`+`bun_sys` per Cargo.toml. `bun_sys` is NOT in `bun_core` under the proposal. REGION 12 notes the `bun_sys` dep may be unused in `.rs` (my grep found zero code references), so it's probably a dead Cargo edge — but this should be stated, not assumed.

**Evidence:** `/workspace/bun/src/analytics/Cargo.toml:23` lists `bun_sys`; no `use bun_sys`/`bun_sys::` in `src/analytics/*.rs`.

**What must change:** State "analytics's `bun_sys` Cargo dep is dead (0 refs); delete before merging into `bun_core`."

---

## review-whole:migration

# MIGRATION RISK & COMPLETENESS — Objections

## 1. Proposal is truncated; 24 crates unassigned

**What's wrong:** The proposal text cuts off mid-sentence ("inversion of control, the idi"). Of the 99 workspace crates + `bun_shim_impl`, 24 have no stated destination: `bun_api`, `bun_bin`, `bun_bundler`, `bun_bunfig`, `bun_ini`, `bun_install`, `bun_standalone_graph`, `bun_transpiler`, `bun_tcc_sys`, `bun_valkey`, `bun_sql`, `bun_runtime`, `bun_shim_impl`, and all 11 `*_jsc` crates (`ast_jsc`, `bundler_jsc`, `css_jsc`, `http_jsc`, `install_jsc`, `js_parser_jsc`, `patch_jsc`, `semver_jsc`, `sourcemap_jsc`, `sql_jsc`, `sys_jsc`).
**Evidence:** `/workspace/bun/Cargo.toml:3-103` lists 100 members; proposal's visible "Absorbs" lists cover 76.
**What must change:** Every crate must be explicitly assigned before migration order can be validated. The architectural direction says \*\_jsc fold into runtime modules, but the proposal must state this and state `bun_bundler`/`bun_install`/`bun_bunfig`/`bun_standalone_graph`/`bun_ini` placement — the `bun_dispatch` deletion claim (obj #6) and `PnpmMatcher` move both hinge on it.

## 2. `bun_sys` ↔ `bun_crypto` hard cycle via `bun_exe_format`

**What's wrong:** Proposal puts `bun_exe_format` into `bun_sys`, and `bun_sha_hmac` into `bun_crypto`. But `bun_exe_format` calls `bun_sha_hmac::sha::SHA256::hash` for Mach-O code-signing. Proposal's `bun_crypto` → `bun_sys`. So `bun_sys` → `bun_crypto` → `bun_sys` — Cargo rejects this.
**Evidence:** `/workspace/bun/src/exe_format/macho.rs:814`; dep graph `bun_exe_format: … bun_sha_hmac …`; proposal's `bun_crypto` "Depends on: bun_core, bun_sys".
**What must change:** Either (a) move `bun_exe_format` out of `bun_sys` (it has exactly one consumer, `bun_standalone_graph`, so it can merge there or into `bun_bundler`/`bun_runtime`); or (b) put a small SHA256 impl in `bun_sys` (it's ~200 LOC of BoringSSL FFI from `bun_boringssl_sys`, which is zero-dep); or (c) move `bun_crypto` below `bun_sys` (infeasible — `bun_boringssl` uses `bun_sys`).

## 3. Proposal's `bun_jsc` group-A dep list won't compile — listed files need `bun_loop`/`bun_uws`

**What's wrong:** Proposal says slimmed `bun_jsc` "Depends on: bun_core, bun_sys, bun_macros" and explicitly includes `AbortSignal` and `FetchHeaders` in group A. Both import from higher tiers.
**Evidence:**

- `/workspace/bun/src/jsc/AbortSignal.rs:9-12` — `use bun_event_loop::EventLoopTimer::{EventLoopTimer, InHeap, IntrusiveField, State, Tag, TimerFlags, Timespec}` (→ `bun_loop`). AbortSignal embeds an intrusive timer for `AbortSignal.timeout()`.
- `/workspace/bun/src/jsc/FetchHeaders.rs:7,93,205` — `use bun_uws::ResponseKind`; `pub fn to_uws_response(&mut self, kind: ResponseKind, …)` (→ `bun_uws`).
  **What must change:** Either add `bun_loop` + `bun_uws` to `bun_jsc`'s deps (acyclic: `bundler`/`install`/`http` all already sit above `bun_loop`+`bun_uws`, so `bun_jsc` can too), or move the timer field / `to_uws_response` out of these types (the latter is hard — `AbortSignal` stores the `EventLoopTimer` by value).

## 4. `bun_jsc` group-A/B classification omits ~50 files; several "obvious group-A" files pull higher-tier deps

**What's wrong:** `src/jsc/` has 119 `.rs` files. Proposal lists ~26 for group A and the architectural direction names ~13 for group B (runtime). At least 50 are unclassified, and spot-checks show many need deps the proposal doesn't grant `bun_jsc`:
**Evidence:**

- `/workspace/bun/src/jsc/BuildMessage.rs:14,86` and `/workspace/bun/src/jsc/ResolveMessage.rs:4,18,71,160,204` — use `bun_ast::Msg`/`ImportKind` and `bun_resolver::is_package_path`. Proposal's `bun_jsc` doesn't depend on `bun_ast`. Proposal mentions only "ResolveMessage::is_package_path inlines the 3-line helper" but says nothing about the `bun_ast::Msg` field these structs hold by value.
- `/workspace/bun/src/jsc/SystemError.rs:169` — `err: &bun_uws::us_bun_verify_error_t`.
- `/workspace/bun/src/jsc/WorkTask.rs:1-3`, `/workspace/bun/src/jsc/ConcurrentPromiseTask.rs:1-3`, `/workspace/bun/src/jsc/CppTask.rs:4-5`, `/workspace/bun/src/jsc/JSCScheduler.rs:3`, `/workspace/bun/src/jsc/Task.rs:22`, `/workspace/bun/src/jsc/EventLoopHandle.rs:14` — all use `bun_event_loop` / `bun_io::KeepAlive` / `bun_threading`.
- `/workspace/bun/src/jsc/GarbageCollectionController.rs:24-25,46` — `bun_event_loop::EventLoopTimer` + `bun_uws` + `impl_timer_owner!`.
- `/workspace/bun/src/jsc/uuid.rs:23` — `bun_boringssl::rand_bytes` (→ `bun_crypto`).
- `/workspace/bun/src/jsc/SavedSourceMap.rs:11-13,221-226` — `bun_sourcemap` (OK, → `bun_ast`) but also `bun_js_printer::OnSourceMapChunk` (→ `bun_js`). Unclassified; moves to group B presumably, but then `bun_jsc` group A loses the `SourceMapHandler` impl that `bun_js_printer` calls through — proposal says this becomes `Option<&mut dyn Trait>` with "one impl in bundler/runtime", so SavedSourceMap must move to runtime.
  **What must change:** Produce an explicit per-file A/B assignment table for all of `src/jsc/*.rs`. The realistic outcome is that `bun_jsc`'s dep list grows to at least `bun_core, bun_sys, bun_ast, bun_crypto, bun_uws, bun_loop, bun_macros` — still acyclic but materially different from "pure FFI depending only on bun_core-tier crates".

## 5. `bun_dispatch` deletion contradicts `BufferedReaderParent` aliasing contract

**What's wrong:** Proposal asserts `bun_dispatch` is "deleted, not absorbed" and `BufferedReader` becomes `*const dyn BufferedReaderParent` "(trait takes `&self` + interior mutability for the aliasing case)". The existing trait takes raw `*mut Self` specifically because forming `&Self` while `&mut self.reader` is live is Stacked-Borrows UB. Converting to `&self`+interior-mutability means all 13 parent structs must wrap their embedded `BufferedReader` in `UnsafeCell`, and every `&mut reader` access site across `bun_io`, `bun_runtime` (11 impls), and `bun_install` (2 impls) must go through `.get()`. This is a multi-thousand-line refactor stated as a throwaway.
**Evidence:** `/workspace/bun/src/io/PipeReader.rs:50-91` — the "Aliasing contract (raw `*mut Self`, not `&mut self`)" doc block. The trait also has `const KIND` and `const HAS_ON_READ_CHUNK` associated constants (lines 72-74), which make it not object-safe as-is. The dyn_vtable catalog (CATALOG §Pattern 2) explicitly recommends "Keep `link_interface!`" for this interface.
**What must change:** Either (a) keep `link_interface!` for `BufferedReaderParentLink` + `ProcessExit` (so `bun_dispatch` folds into `bun_macros`, not deleted), or (b) spell out the UnsafeCell refactor as a separate line item with its own risk assessment, or (c) hand-write a fn-ptr vtable struct (dropping the `link_interface!` macro but keeping the dispatch shape).

## 6. `bun_dispatch` deletion is unverifiable for `bun_bundler`'s two interfaces

**What's wrong:** `link_interface! DevServerHandle[Bake]` and `link_interface! VmLoaderCtx[Runtime]` at `/workspace/bun/src/bundler/lib.rs:338,364` exist for `bun_bundler → bun_runtime` back-edges. Proposal is truncated before showing `bun_bundler`'s fate. If `bun_bundler` stays a separate crate (likely — 48k LOC, `bun_install`+`bun_standalone_graph`+`bun_bunfig` depend on it JSC-free), those two interfaces survive and `bun_dispatch` cannot be "deleted outright". Additionally, `BundleGenerateChunkCtx[Linker]` at `/workspace/bun/src/crash_handler/lib.rs:713` is `bun_sys → bun_bundler` after the merge — proposal replaces it with "`register_action_formatter(fn(&mut dyn Write, *const ()))`" but the existing interface passes typed `(chunk_index, part_range)` args that the formatter needs to print `Chunk`/`PartRange`, which live in `bun_bundler`.
**Evidence:** `/workspace/bun/src/bundler/lib.rs:338-379`; `/workspace/bun/src/crash_handler/lib.rs:713`; impl at `/workspace/bun/src/bundler/LinkerContext.rs:60`.
**What must change:** Change "deleted" to "absorbed into `bun_macros`" for `bun_dispatch`, OR show `bun_bundler` merging into `bun_runtime`. The crash-handler callback redesign must preserve enough type info for the formatter to actually print chunk context.

## 7. Codegen scripts hardcode crate names/paths that the split invalidates

**What's wrong:** Multiple codegen `.ts` files embed `bun_jsc::`/`bun_runtime::` paths and filesystem locations that the VM→runtime move breaks.
**Evidence:**

- `/workspace/bun/src/codegen/generate-host-exports.ts:59-60` — `scanRoots = [{dir: src/runtime, crate: "bun_runtime"}, {dir: src/jsc, crate: "bun_jsc"}]`. After the split, group-B files (VirtualMachine, ModuleLoader, event_loop, Debugger, …) either physically move to `src/runtime/` or are `#[path]`-mounted; either way the scraper's `fm.crate === "bun_jsc"` branch (line 285,308) misroutes them.
- `/workspace/bun/src/codegen/generate-host-exports.ts:503,505-506` — hardcodes import paths `["bun_jsc::virtual_machine", "VirtualMachine"]`, `["bun_jsc::debugger", "LifecycleHandle"]`, `["bun_jsc::debugger", "TestReporterHandle"]`. All three move to `bun_runtime` per architectural direction.
- `/workspace/bun/src/codegen/generate-classes.ts:2020,2123,2141-2143` — walks only `src/runtime/lib.rs`; routes out-of-crate `.classes.ts` (i.e. `/workspace/bun/src/jsc/resolve_message.classes.ts`) to `crate::api::Name` assuming `/workspace/bun/src/runtime/api.rs:38-39` still has `pub use bun_jsc::{BuildMessage, ResolveMessage}`. If those types move to runtime (likely per obj #4), the `.classes.ts` file must move too.
  **What must change:** Add a migration line item: update `generate-host-exports.ts` scanRoots + import-path table, and update `generate-classes.ts` fallback routing, in the same PR that moves VirtualMachine.

## 8. `build.rs` files assume fixed directory depth from repo root

**What's wrong:** Each crate's `build.rs` computes repo root as `CARGO_MANIFEST_DIR/../..`. Absorbing crates may relocate manifest dirs (e.g., if `bun_parsers` becomes `src/ast/parsers/` the depth changes to 3).
**Evidence:** `/workspace/bun/src/jsc/build.rs:22-26`, `/workspace/bun/src/parsers/build.rs:13-17` (same pattern in `src/runtime/build.rs`, `src/install/build.rs`, `src/bun_core/build.rs`). All do `manifest.parent().and_then(Path::parent)`.
**What must change:** State whether absorbed crates' source files stay in place (via `#[path = "../parsers/lib.rs"]` mounts from the absorbing crate's `lib.rs`) or physically move. If they move, every `build.rs` needs the depth fixed; if they stay, the absorbing crate needs a single `build.rs` that re-exports `BUN_CODEGEN_DIR` for all included files.

## 9. Cargo bench/test targets and helper shims break

**What's wrong:**

- `/workspace/bun/scripts/bench-json-rust.sh:59,61` invokes `cargo test -p bun_parsers` / `cargo bench -p bun_parsers` — crate name disappears.
- `/workspace/bun/src/js_parser/Cargo.toml:46-47` `[[bench]] name = "string_map_vs_hashmap"` — must move to `bun_js` (or `bun_react_compiler`?); the bench binary's link requirements will grow.
- `/workspace/bun/src/parsers/native_test_shims.rs` defines `#[no_mangle]` stubs for `highway_*` and `__bun_crash_handler_out_of_memory` so `cargo test -p bun_parsers` links standalone. After `bun_parsers` folds into `bun_ast` (which now also contains sourcemap, dotenv, clap, …), the merged crate's `cargo test` binary references a much larger extern-C surface (simdutf, zstd, etc.) — shims must expand or `cargo test -p bun_ast` becomes unlinkable.
- `/workspace/bun/src/dispatch/Cargo.toml:18` `[[test]]` (the `tests/shape.rs` fixture) — orphaned if `bun_dispatch` is deleted; must move to `bun_macros` if the macro survives (obj #5/#6).
  **What must change:** Add explicit migration steps for each `[[bench]]`/`[[test]]` target and for `native_test_shims.rs`; update `scripts/bench-json-rust.sh`.

## 10. `show_crash_trace` feature-forwarding chain not rewired

**What's wrong:** Feature chain is `bun_runtime/show_crash_trace → bun_bundler/show_crash_trace → bun_crash_handler/show_crash_trace`. Proposal folds `bun_crash_handler` into `bun_sys` but doesn't mention the feature.
**Evidence:** `/workspace/bun/src/runtime/Cargo.toml:113`, `/workspace/bun/src/bundler/Cargo.toml:73`, `/workspace/bun/src/crash_handler/Cargo.toml:40`.
**What must change:** `bun_sys` must declare `[features] show_crash_trace = []` and `bun_bundler` (wherever it lands) must forward to `bun_sys/show_crash_trace`.

## 11. `shim_standalone` feature must be declared by `bun_install`'s absorbing crate

**What's wrong:** `/workspace/bun/src/install/windows-shim/bun_shim_impl.rs` is `#[path]`-mounted into `bun_install` and is riddled with `#[cfg(feature = "shim_standalone")]`. `/workspace/bun/src/install/lib.rs:256` + `src/install/Cargo.toml` declare an always-off `shim_standalone = []` feature solely so `unexpected_cfgs` (workspace lint, `/workspace/bun/Cargo.toml:188`) doesn't fire. Whatever crate absorbs `bun_install` must declare this feature or the workspace `-D warnings` fails the build.
**Evidence:** `/workspace/bun/src/install/windows-shim/bun_shim_impl.rs:59,61,63,75,77,…`; `/workspace/bun/src/install/windows-shim/Cargo.toml` `required-features = ["shim_standalone"]`.
**What must change:** Add `shim_standalone = []` to the `[features]` of whichever crate ends up `mod`-mounting `windows-shim/*.rs` (proposal truncated — unclear which).

## 12. `bun_ast` dep list omits `bun_macros` though it absorbs `bun_clap`

**What's wrong:** Proposal's `bun_ast` "Depends on: bun_core, bun_sys" but absorbs `bun_clap`, whose `parse_param!` / `param!` wrap proc-macros from `bun_clap_macros` (→ `bun_macros`). Cargo requires a direct dep to invoke a proc-macro.
**Evidence:** `/workspace/bun/src/clap/lib.rs` uses `bun_clap_macros::__parse_param_impl`; `/workspace/bun/src/clap_macros/lib.rs:1`. Proposal's `bun_css` correctly lists `bun_macros`; `bun_ast` does not.
**What must change:** Add `bun_macros` to `bun_ast`'s deps.

## 13. `bun_css` / `bun_ast` use `bun_io::{FixedBufferStream, FmtAdapter}` — not in `bun_core`

**What's wrong:** The `Write` _trait_ lives in `bun_core::write`, but the helper types `FixedBufferStream` and `FmtAdapter` are defined only in `bun_io` (→ `bun_loop`). Proposal's `bun_css` and `bun_ast` don't depend on `bun_loop`.
**Evidence:** `/workspace/bun/src/io/write.rs:76,312` (definitions). Consumers: `/workspace/bun/src/css/css_parser.rs:6459` (`pub type FixedBufWriter<'a> = bun_io::FixedBufferStream<&'a mut [u8]>`); `/workspace/bun/src/sourcemap/ParsedSourceMap.rs:347` (`bun_io::FmtAdapter::new(f)`). Also `/workspace/bun/src/jsc/lib.rs:374,381` (`bun_io::FmtAdapter`) — group-A file per proposal, but `bun_jsc` doesn't list `bun_loop` either (see obj #3).
**What must change:** Move `src/io/write.rs` (the ~400-LOC helper types, no event-loop coupling) into `bun_core::io` alongside the `Write` trait. Region-2 research already flags this ("unclear why the helpers are stranded in `io`"). Proposal must call this out as a prerequisite step.

## 14. `bun_jsc_macros` → `bun_macros` merge leaves emitted `::bun_jsc::` paths fragile during migration

**What's wrong:** `#[host_fn]`/`#[host_call]`/`JsClass` derive emit `::bun_jsc::JSGlobalObject`, `::bun_jsc::__macro_support::host_fn_result`, etc. These are consumed by `bun_runtime` and by every `*_jsc` crate. During a single-PR migration, if `bun_jsc` is renamed, split, or its `__macro_support` module moves, every `#[host_fn]` expansion in ~200 files breaks simultaneously.
**Evidence:** `/workspace/bun/src/jsc_macros/lib.rs:161-378` (30+ `::bun_jsc::` quote! emissions).
**What must change:** State explicitly that `bun_jsc` keeps its crate name and the `__macro_support`/`host_fn` module paths unchanged, OR sequence the macro update before the crate rename.

## 15. `/workspace/bun/src/CLAUDE.md` prescribes `bun_sys_jsc::ErrorJsc::to_js` — crate disappears

**What's wrong:** The project's in-tree Rust guide tells contributors to use `bun_sys_jsc::ErrorJsc` for syscall-error→JS conversion. `bun_sys_jsc` folds into `bun_runtime` per architectural direction (all \*\_jsc crates). Research also notes `bun_jsc::SysErrorJsc` is the dominant in-tree duplicate (30+ vs ~6 callers).
**Evidence:** `/workspace/bun/src/CLAUDE.md` "Convert to a JS exception via `bun_sys_jsc::ErrorJsc::to_js`"; `/workspace/bun/src/sys_jsc/error_jsc.rs:7` vs `/workspace/bun/src/jsc/lib.rs:1911`.
**What must change:** Pick one (`bun_jsc::SysErrorJsc` survives in group A and is what the doc should name) and add a doc-update line item. Contributor-facing docs that reference disappearing crate names are a migration completeness item.

## 16. `rust.ts:775` comment claims shim crate graph is "bun_core/bun_sys/bun_string only" — contradicts both reality and proposal

**What's wrong:** The build script has a stale comment and the proposal doesn't touch `rust.ts`. More substantively: `/workspace/bun/scripts/build/rust.ts:793-795` invokes `cargo build -p bun_shim_impl --features shim_standalone`. Proposal keeps `bun_shim_impl`, `bun_opaque`, `bun_windows_sys` intact — OK. But the shim's shared source (`/workspace/bun/src/install/windows-shim/bun_shim_impl.rs:60,64,206,274,343,386,…`) references `bun_core::ffi::{slice,slice_mut,zeroed}`, `bun_core::Environment`, `bun_core::RacyCell`, `bun_core::w!`, `bun_sys::windows`. These resolve to the _local stand-in modules_ in `/workspace/bun/src/install/windows-shim/main.rs:166-end` when `shim_standalone` is set. After `bun_core` absorbs 20 crates and `bun_sys` absorbs 17, anyone editing the shared source may inadvertently reach for a newly-in-`bun_core` item (e.g., `bun_core::errno::E`), which compiles in the `bun_install` context but fails in the `bun_shim_impl` context with no CI coverage on non-Windows.
**Evidence:** `/workspace/bun/src/install/windows-shim/main.rs:9-15,167-174`; `/workspace/bun/scripts/build/rust.ts:768-807` only runs on Windows targets.
**What must change:** Add a CI lint (or `cargo check -p bun_shim_impl --features shim_standalone --target x86_64-pc-windows-msvc` on linux via `--target` without linking) to the migration checklist, and update the `main.rs` stand-in module to document the expanded `bun_core`/`bun_sys` surface it must shadow.

---

## review-decision:cycles

## Objections (dependency-cycle & build angle)

### 1. `bun_sys` ↔ `bun_crypto` cycle via `exe_format` → `sha_hmac` — unaddressed

`bun_sys` absorbs `bun_exe_format`; `bun_crypto` absorbs `bun_sha_hmac`; `bun_crypto` "Depends on: bun_core, bun_sys". But `/workspace/bun/src/exe_format/macho.rs:814` calls `bun_sha_hmac::sha::SHA256::hash()` for Mach-O ad-hoc code-signing. That is **bun_sys → bun_crypto → bun_sys**. The proposal's `bun_sys` section lists no mitigation for this edge. Any LOC credited to "6 `*_sys`/wrapper crate pairs collapse" or "exe_format folds into sys" is unearned until this is fixed.
**Required change:** either move `bun_exe_format` up to `bun_crypto` (its only caller, `bun_standalone_graph`, is above both), or inline the single `extern "C" fn SHA256(d: *const u8, n: usize, md: *mut u8)` BoringSSL prototype in `bun_sys` so macho.rs doesn't need the wrapper crate.

### 2. Six crates need `bun_io` helpers that stay in `bun_loop` — four "Depends on" lines are unsatisfiable

The proposal drops the `bun_io` edge from `bun_sys`/`bun_ast`/`bun_css`/`bun_js` on the basis that the `Write` trait lives in `bun_core::write`. That is true for the trait (`/workspace/bun/src/io/write.rs:32` re-exports it), but these crates also use items defined **in** `src/io/write.rs` (absorbed into `bun_loop`):

- `bun_io::FmtAdapter` — `src/sourcemap/ParsedSourceMap.rs:347`, `src/crash_handler/lib.rs:402`
- `bun_io::FixedBufferStream` — `src/css/css_parser.rs:6459`
- `bun_io::Result` alias — `src/zlib/lib.rs:251`, `src/brotli/lib.rs:599`, `src/js_parser/parser.rs:502`, `src/js_printer/lib.rs:7346`, `src/css/printer.rs:474`

Adding `bun_loop` as a dep of `bun_sys` is a cycle (`bun_loop → bun_uws → bun_crypto → bun_sys`). Adding it to `bun_ast`/`bun_css`/`bun_js` puts `bun_uws`+`bun_crypto` on the compiler-frontend critical path for no reason.
**Required change:** the accounting must explicitly move all 470 LOC of `/workspace/bun/src/io/write.rs` into `bun_core` (it depends only on `bun_core::Error`), not just hand-wave "use the real `Write` trait". Otherwise four "Depends on" lines are wrong and the claimed `bun_io`-edge eliminations in `bun_sys`/`bun_ast`/`bun_css`/`bun_js` don't hold.

### 3. Two `link_interface!` sites in `bun_bundler` block the "`bun_dispatch` deleted outright (-407 LOC)" claim

`/workspace/bun/src/bundler/lib.rs:338` defines `DevServerHandle[Bake]` (11 methods) and `:364` defines `VmLoaderCtx[Runtime]` (13 methods). The proposal enumerates conversions for `OutputSink`, `ErrnoNames`, `TranspilerCacheImpl`, `EventLoopCtx`, `JsEventLoop`, `BufferedReaderParentLink`, `ProcessExit`, `BundleGenerateChunkCtx` — but never these two. Both dispatch **upward** (to `bake::DevServer` / `bun_runtime`), so they can legitimately become `Option<&dyn Trait>` without a cycle, but that is 24 method signatures of conversion work that is nowhere in the accounting. If either is left as-is, `bun_dispatch` cannot be deleted and the -407 LOC line item is void.
**Required change:** add `DevServerHandle`→`&dyn DevServerHooks` and `VmLoaderCtx`→`&dyn VmLoaderHooks` to the bundler section, or drop the "`bun_dispatch` deleted outright" claim.

### 4. `__bun_jsc_enable_hot_module_reloading_for_bundler` cannot become a direct call — do not count it in the "14 vanish

`/workspace/bun/src/bundler/bundle_v2.rs:1417` is an `extern "Rust"` into `bun_jsc::hot_reloader`. The architectural directive places `hot_reloader` in **group B** (moves to `bun_runtime`). `bun_bundler → bun_runtime` is a cycle (runtime depends on bundler). The sibling extern at `:1403` (`__bun_jsc_generate_cached_bytecode`) _is_ eliminable because `CachedBytecode` stays in group-A `bun_jsc`, but the hot-reloader one is not.
**Required change:** classify this extern as one of the surviving 7 (convert to `OnceLock<fn(NonNull<BundleV2<'static>>)>` set by runtime), and ensure the -100k tally does not double-count it under both "`bun_bundler` calls jsc directly" and "14 of 21 extern blocks vanish".

### 5. 88k `bun_core` + 49k `bun_sys` roughly doubles the serial critical-path prefix

Today `bun_core` is 33k LOC; after it, ~14 crates (collections 12.5k, paths 6.8k, http_types 5.5k, semver 3.7k, errno 2k, url 1.8k, base64 1k, analytics 0.8k, …) compile **in parallel**, so the wall-clock cost of that tier ≈ 33k + 12.5k = 45.5k before `bun_sys` (20k) can start. Under the proposal that whole tier is one 88k serial unit, then one 49k `bun_sys` unit, then 68k `bun_ast`. Critical-path prefix goes from ~73k → ~205k serial LOC before any fan-out; end-to-end critical path (through `react_compiler`→`bun_js`) goes ~193k → ~325k. The -100k accounting trades LOC for wall-clock: nothing in `url`/`semver`/`http_types`/`base64`/`analytics`/`picohttp` (~13k combined) needs `bun_sys`, so leaving them as a thin sibling tier that builds parallel with `bun_sys` costs zero workarounds and recovers most of the fan-out.
**Required change:** either justify the build-time regression explicitly, or cap `bun_core` at the allocator/string/collections core (~60k) and keep `url+semver+http_types+analytics+picohttp` as one small `bun_vocab` crate parallel with `bun_sys`.

---

## review-decision:semantics

## Objections to the −100k LOC accounting

**1. The headline number is off by an order of magnitude — realistic net deletion is ~5–8k LOC, not 100k.**
The proposal's per-crate "LOC estimate" rows are _target sizes equal to the sum of absorbed crates_ (verified: bun*core target 88k ≈ measured 88,687; bun_sys 49k ≈ 48,676; bun_ast 68k ≈ 69,988; bun_js 57k ≈ 57,368; bun_loop 22k ≈ 22,116; bun_crypto 6.7k ≈ 6,701; bun_resolver 20k ≈ 19,810). Merging crates moves code, it does not delete it. The only sources of \_net* deletion the proposal itemizes are `jsc_hooks.rs` (5,378), `runtime/dispatch.rs` (1,236), `bun_dispatch` (345 — proposal says 407, wrong), `bun_output` (51), plus scattered `extern "Rust"`/`link_interface!` glue. Even counting all of that as 100 % deletable yields <8k. Total repo is 1,040,273 LOC of Rust; there is no path to −100k in what's written.
**Required change:** restate the claim as ~−6k LOC of hand-maintained indirection glue, or produce a line-by-line table that actually sums to ≥100k.

**2. "`jsc_hooks.rs` (5,378 LOC) deletes entirely" is false — most of it is logic that must relocate, not vanish.**
`/workspace/bun/src/runtime/jsc_hooks.rs` contains 52 function bodies including `transpile_source_code`, `fetch_builtin_module`, `load_preloads`, `generate_entry_point`, `ensure_debugger`, `auto_tick`, plus the `RuntimeState` struct holding `timer::All`, `sql_rare`, `ssl_ctx_cache`, `editor_context`, `global_dns_data`, `entry_point`, `transpiler_arena`, `body_value_pool`. When `VirtualMachine` moves to `bun_runtime`, those fields become direct `VirtualMachine` fields and those bodies become direct methods — the **logic survives 1:1**. Only the hook-table statics (`__BUN_RUNTIME_HOOKS`/`__BUN_LOADER_HOOKS`, 2 statics), 7 `#[no_mangle]` wrappers, and the `*mut c_void` casts delete — roughly 1–1.5k LOC, not 5,378.
**Required change:** credit ~1.5k, not 5.4k, and note the remaining ~4k moves onto `VirtualMachine`.

**3. "`runtime/dispatch.rs` (1,236 LOC) deletes entirely" double-counts — replacing `task_tag` with `dyn Runnable` adds back most of it at the impl sites.**
`/workspace/bun/src/runtime/dispatch.rs` is a single `match` over 96 `task_tag` arms + a 42-row `for_each_fs_async_op!` x-macro + `run_file_poll`. The proposal replaces this with `NonNull<dyn Runnable>` / `*mut dyn TimerCallback` / `*mut dyn FilePollOwner`. That means **each of the 96 task types, 24 timer types, and 15 poll types needs an `impl Trait { fn run(...) }` block** at its definition site — ≥4 lines each × ~135 types ≈ 540+ LOC added, plus the three trait definitions. The `pub mod task_tag { tags!{…} }` block in `/workspace/bun/src/event_loop/ConcurrentTask.rs` (≈100 LOC) and the `impl Taskable { const TAG }` blocks that already exist do delete, but net savings is ~400–600 LOC, not 1,236.
**Required change:** account for the per-type `impl Runnable/TimerCallback/FilePollOwner` blocks as offsetting additions; present a net figure.

**4. "`bun_uws` re-export façade (~1,000 LOC of `pub use`)" is fabricated — the file has 22 `pub use` lines.**
`/workspace/bun/src/uws/lib.rs` is 1,444 LOC with exactly 22 `pub use` statements. The remaining ~1,400 lines are real definitions: `ResponseKind` enum, compressor constants, owned `SocketAddress`, `SslCtx` alias, `InternalSocket`/`AnySocket` safe wrappers, doc comments explaining type reconciliation with `uws_sys`. Merging `uws`+`uws_sys` (1,444 + 9,715 = 11,159, matching the proposal's ~11,000 target) loses at most those 22 re-export lines plus ~30 lines of now-redundant "distinct-from-sys" doc commentary.
**Required change:** drop this line item from the savings column or restate it as ~50 LOC.

**5. "11 `*_jsc` crates fold into runtime" and "25 `UpgradedDuplex__*`/`WindowsNamedPipe__*` shims" are counted as deletions but are moves/rewrites.**
The 11 `*_jsc` crates total 28,342 LOC (`sql_jsc` alone is 15,461; `http_jsc` 6,117; `js_parser_jsc` 1,487; `sourcemap_jsc` 1,453; `css_jsc` 1,049; `install_jsc` 994; `bundler_jsc` 858; `sys_jsc` 465; `patch_jsc` 223; `semver_jsc` 144; `ast_jsc` 91). "Fold into runtime" means `bun_runtime` grows from 330,861 to ~390k+ LOC — no deletion beyond ~11 × ~30 LOC of `lib.rs`/`Cargo.toml` boilerplate (~300). The `UpgradedDuplex__*`/`WindowsNamedPipe__*` "shims" are **one-line `#[uws_callback(export = "...")]` attribute annotations** on existing methods in `/workspace/bun/src/runtime/socket/UpgradedDuplex.rs` and `WindowsNamedPipe.rs`, plus 84 matching extern declarations consumed by `uws_sys`'s C-ABI vtable (which crosses the Rust↔C++ boundary, not just Rust↔Rust). Replacing them with "handler registration" is equal-or-more LOC and still needs a C-ABI surface because uSockets is C++.
**Required change:** remove `*_jsc` folding and the uws shims from the deletion tally; count only per-crate boilerplate (~300 LOC) and acknowledge the C-ABI `UpgradedDuplex__*` surface cannot be replaced by a Rust trait object.

---

**Files inspected:** `/workspace/bun/src/runtime/jsc_hooks.rs`, `/workspace/bun/src/runtime/dispatch.rs`, `/workspace/bun/src/dispatch/lib.rs`, `/workspace/bun/src/uws/lib.rs`, `/workspace/bun/src/event_loop/ConcurrentTask.rs`, `/workspace/bun/src/io/lib.rs`, `/workspace/bun/src/io/posix_event_loop.rs`, `/workspace/bun/src/spawn/lib.rs`, `/workspace/bun/src/runtime/socket/UpgradedDuplex.rs`, `/workspace/bun/src/uws_sys/lib.rs`, plus per-crate `wc -l` across all ~100 crates.

---

## review-decision:migration

# Objections to "-100k LOC accounting" — Migration Risk & Completeness

## 1. Hard dep cycle: `bun_sys` ↔ `bun_crypto` via `exe_format → sha_hmac` (build-breaking)

Proposal assigns `bun_exe_format` → `bun_sys` and `bun_sha_hmac` → `bun_crypto`, with `bun_crypto` declared `Depends on: bun_core, bun_sys`. But:

```rust
// /workspace/bun/src/exe_format/macho.rs:814
unsafe { bun_sha_hmac::sha::SHA256::hash(bytes, out, core::ptr::null_mut()) };
```

This gives `bun_sys → bun_crypto → bun_sys`. The "single PR" stops compiling at `cargo check -p bun_sys`. **Required change:** either move `bun_exe_format` UP into `bun_crypto` (its only above-sys dep is that one SHA256 call), or sink the raw `SHA256::hash` FFI extern into `bun_sys` (it's a stateless BoringSSL libcrypto call, no engine), or drop `bun_crypto → bun_sys` (but `bun_boringssl`, `bun_dns`, `bun_cares_sys` all genuinely use `bun_sys` today).

## 2. Codegen hardcodes `bun_jsc::virtual_machine` / `bun_jsc::debugger` / `crate::dispatch` — all move or delete

Three generators emit paths the split relocates, and the accounting never lists them as same-PR edits:

- `/workspace/bun/src/codegen/generate-host-exports.ts:503,505-506` — emits `use bun_jsc::virtual_machine::VirtualMachine;` and `use bun_jsc::debugger::{LifecycleHandle, TestReporterHandle};`. Per the architectural direction `VirtualMachine` + `Debugger` move to `bun_runtime`; generated `generated_host_exports.rs` stops compiling.
- `/workspace/bun/src/codegen/generate-js2native.ts:98` — hardcodes `"virtual_machine_exports.rs": "jsc/virtual_machine_exports.rs"` (file moves to `runtime/`).
- `/workspace/bun/src/codegen/generate-js2native.ts:330` + `/workspace/bun/src/runtime/dispatch_js2native.rs` — out-of-runtime `$rust()` calls route through `crate::dispatch::js2native::*`. The broadcast says "`runtime/dispatch.rs (1236 LOC) delete entirely`"; if that's read as deleting `mod dispatch`, the generator emits unresolvable paths. `dispatch_js2native.rs` (100 LOC, separate file) must survive as `mod dispatch { pub mod js2native; }` or the generator rewritten.
- `/workspace/bun/src/codegen/generate-classes.ts:2141-2142` — routes `src/jsc/*.classes.ts` classes (BuildMessage, ResolveMessage) through `bun_jsc::` re-exports; those are in `error.rs` which "shrinks to JsError only" per proposal.

**Required change:** add `generate-host-exports.ts`, `generate-js2native.ts`, `generate-classes.ts`, `cppbind.ts` to the migration's same-PR edit list; explicitly state `dispatch_js2native.rs` survives (it's the landing-pad, not the 1236-LOC hooks file).

## 3. Three crates (~7,300 LOC) never assigned: `bun_sql`, `bun_valkey`, `bun_tcc_sys`

These sit in the dep tiers already covered by the proposal (below `bun_resolver`, so not victims of truncation) and appear in no `Absorbs:` list:

| crate                                         | LOC   | current deps                                        | obvious home                 |
| --------------------------------------------- | ----- | --------------------------------------------------- | ---------------------------- |
| `bun_sql` (`/workspace/bun/src/sql/`)         | 5,969 | core/ptr/collections/sys/**boringssl**/**sha_hmac** | `bun_crypto` or new `bun_db` |
| `bun_valkey` (`/workspace/bun/src/valkey/`)   | 832   | core only                                           | `bun_core` or `bun_crypto`   |
| `bun_tcc_sys` (`/workspace/bun/src/tcc_sys/`) | 493   | opaque/alloc/core/ptr                               | `bun_sys`                    |

`/workspace/bun/Cargo.toml` workspace `members` still lists `"src/sql"`, `"src/valkey"`, `"src/tcc_sys"` with no destination. **Required change:** assign all three; the "-100k" delta is off by ~7.3k LOC.

## 4. `bun_io` goes wholesale to `bun_loop`, but `write.rs` helpers are used below `bun_loop`

Proposal: "`bun_loop` Absorbs: bun_io"; `bun_ast`/`bun_css`/`bun_js`/`bun_sys` do **not** depend on `bun_loop`. But:

- `/workspace/bun/src/sourcemap/ParsedSourceMap.rs:347` (→`bun_ast`): `bun_io::FmtAdapter::new(f)`
- `/workspace/bun/src/css/css_parser.rs:6459` (→`bun_css`): `pub type FixedBufWriter<'a> = bun_io::FixedBufferStream<&'a mut [u8]>;`
- `/workspace/bun/src/brotli/lib.rs:552-605`, `/workspace/bun/src/zlib/lib.rs:251` (→`bun_sys`): `bun_io::Write` generic bounds
- `/workspace/bun/src/js_printer/lib.rs:41`, `/workspace/bun/src/js_parser/parser.rs:501-546` (→`bun_js`): `bun_io::Write`

The `Write` trait itself is already canonical in `bun_core::io` (`/workspace/bun/src/bun_core/util.rs:1813+`), but `FmtAdapter`, `FixedBufferStream<B>`, `BufWriter` live **only** in `/workspace/bun/src/io/write.rs` (470 LOC). The proposal's sole nod is "crash_handler … use `bun_core::io::Write`" — it never says `src/io/write.rs` moves down. **Required change:** state that `bun_io::write.rs` (pure-computation, no syscalls) is absorbed by **`bun_core`**, not `bun_loop`; only the poll/pipe/reader half of `bun_io` goes to `bun_loop`. Otherwise `bun_sys`, `bun_ast`, `bun_css`, `bun_js` all fail `cargo check`.

## 5. Windows-shim build coupling spans 3 files the accounting never mentions

The shim is acknowledged in rationale ("`bun_shim_impl` … can use `opaque_ffi!`") but the on-disk/build-system coupling isn't in the edit list:

- `/workspace/bun/scripts/build/rust.ts:148,793-807` — hardcodes `src/install/windows-shim/bun_shim_impl.exe` and `cargo build -p bun_shim_impl`
- `/workspace/bun/src/install/build.rs:75` — `manifest.join("windows-shim").join("bun_shim_impl.exe")` (the `rerun-if-changed` + placeholder-emit)
- `/workspace/bun/src/install/lib.rs:259` — `#[path = "windows-shim/bun_shim_impl.rs"] pub mod _bun_shim_impl;` (shares source file with the freestanding crate)
- `/workspace/bun/Cargo.toml` — workspace `members` entry `"src/install/windows-shim"`

Wherever `bun_install` lands (runtime or its own crate — truncated), the shim's disk location, `build.rs`, `#[path=…]`, and `rust.ts` must move/update atomically or the Windows build fails at `include_bytes!("bun_shim_impl.exe")`. **Required change:** add `scripts/build/rust.ts`, the `build.rs` that owns the shim placeholder, the `#[path]` re-mount, and the workspace-members entry to the same-PR edit list; explicitly decide whether `src/install/windows-shim/` stays on disk (simplest) even if `bun_install` merges elsewhere.
