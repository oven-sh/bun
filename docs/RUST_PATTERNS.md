# Zig-like Anti-Patterns in the Rust Port — Catalog

Repo: `/root/bun-5` @ branch `claude/phase-a-port` (HEAD `9712c4542e2`)
Scope: 1,414 `.rs` files under `src/` (excludes `vendor/`, `test/`, `packages/`)
Reference doc: `docs/PORTING.md`

---

## 1. `unsafe { &mut *raw_ptr }` held across calls (aliasing UB)

**Zig:** `*T` is just a pointer; multiple live mutable views are legal. `var p: *Scope = ...; p.children.append(...); other_fn(p);` is fine.

**Rust port (current):** Raw `*mut T` upgraded to `&mut T` at every use site, often while another `&mut` to overlapping memory is live or the pointee is reachable through `self`.

- `src/bundler/AstBuilder.rs:131,144,168` — `unsafe { &mut *self.current_scope }` taken three times in `push_scope` while `self` (which contains `current_scope`) is `&mut`.
- `src/bundler/ThreadPool.rs:379,495,625` — `&mut *worker_ptr` while pool owns the same Worker.
- `src/bundler/linker_context/postProcessJSChunk.rs:51` — `let c: &mut LinkerContext = unsafe { &mut *ctx.c };` held for entire function body across reentrant calls.

**Why it's wrong in Rust:** Stacked Borrows / Tree Borrows: creating `&mut T` asserts exclusive access for its lifetime. A second `&mut` (or `&`) derived from the same allocation while the first is live is **instant UB**, even if never dereferenced concurrently. LLVM's `noalias` lets the optimizer reorder stores past loads. Miri fails on these.

**Idiomatic fix:** Three tiers depending on shape:

1. **Short-lived, non-overlapping:** keep `*mut`, but only materialize `&mut` for a single statement; never hold across a call that could re-derive. Use `(*ptr).field = x` raw-place syntax (stable since 1.82) instead of `(&mut *ptr).field = x`.
2. **Tree/graph backrefs (Scope, parent links):** wrap node payload in `UnsafeCell<T>` (or `Cell<T>` for Copy fields), store `NonNull<ScopeNode>`, expose `fn cell(&self) -> &UnsafeCell<Scope>`. The `UnsafeCell` is the _only_ legal way to get interior mutability through a shared path.
3. **"God object" passed everywhere (LinkerContext, BundleV2):** split into `&Shared` (read-only graph data) + `&mut Local` (per-pass scratch), or pass `&LinkerContext` with `Cell`/`RefCell` on the few mutated fields.

**Perf:** Tier 1 is zero-cost. Tier 2 adds 0 bytes (`UnsafeCell` is `repr(transparent)`). Tier 3 `Cell` is zero-cost; `RefCell` adds 1 branch + 1 usize per borrow (~1-2ns) — acceptable outside the lexer/printer hot loop, and elidable with `borrow_mut()` hoisted out of loops.

**Count in tree:** **2,440** occurrences of `unsafe { &mut *`. (Phase-f commits `b5c1f4613a2`, `9712c4542e2` fixed ~14 high-risk sites; the long tail remains.)

**Sweep difficulty:** Per-site judgment. ~60% are tier-1 mechanical (single-statement deref), ~30% tier-2 (graph nodes — needs `UnsafeCell` retyping in one place, then mechanical), ~10% tier-3 architectural (LinkerContext/BundleV2/Transpiler split).

---

## 2. `static mut X` + `unsafe { &mut X }` (singleton aliasing)

**Zig:** `var global: T = ...;` — module-level mutable state, freely aliased.

**Rust port (current):**

- `src/http/state_machine_prelude.rs:82-96` — `static mut PRINT_EVERY_I`, `SHARED_REQUEST_HEADERS_BUF`, `SHARED_RESPONSE_HEADERS_BUF`, `SINGLE_PACKET_SMALL_BUFFER` (16KB).
- `src/bundler/ThreadPool.rs:95` — `static mut THREAD_POOL: MaybeUninit<ThreadPool>`.
- `src/main_wasm.rs:196-266` — 7× `static mut` for parser/printer globals.
- `src/collections/bit_set.rs:796` — `static mut EMPTY_MASKS_DATA`.
- Plus **36** functions returning `&'static mut T` (e.g. `src/io/lib.rs:269 Loop::get()`, `src/http/lib.rs:553 http_thread()`).

**Why it's wrong in Rust:** `&'static mut` is a uniqueness claim for the entire program lifetime. Calling `http_thread()` twice produces two live `&'static mut HTTPThread` → UB. Rust 2024 edition makes `&mut STATIC_MUT` a hard error (`static_mut_refs` lint is deny-by-default).

**Idiomatic fix:**

- **Single-threaded singletons (HTTPThread, Loop, abort_tracker):** `static X: SyncUnsafeCell<T>` (or stable equivalent: `struct RacyCell<T>(UnsafeCell<T>); unsafe impl Sync for RacyCell<T> {}`) + accessor returning `*mut T`, never `&mut`. Callers do single-statement raw access. Document the thread-affinity invariant.
- **Lazy-init singletons:** `static X: OnceLock<T>` + `fn get() -> &'static T` with interior mutability for hot fields. (192 `OnceLock`/`OnceCell` already in tree — pattern is established.)
- **Thread-local scratch buffers (`SHARED_*_HEADERS_BUF`, `SINGLE_PACKET_SMALL_BUFFER`):** `thread_local! { static BUF: UnsafeCell<[Header; N]> = ... }` — these are HTTP-thread-only anyway.
- **Truly immutable after init (`EMPTY_MASKS_DATA`):** `static X: [usize; 2] = [0, 0]` — drop the `mut`, it's never written.

**Perf:** `SyncUnsafeCell` is zero-cost. `OnceLock::get()` is one relaxed atomic load + branch (~1ns, predicted). `thread_local!` on Linux is one `fs:`-relative load (same as Zig `threadlocal`). **Better** in one case: `EMPTY_MASKS_DATA` as `static` (not `static mut`) goes in `.rodata` and gets full constant-propagation.

**Count in tree:** **302** `static mut` declarations; **36** `-> &'static mut` functions.

**Sweep difficulty:** Mechanical for ~250 (wrap in `SyncUnsafeCell`/`OnceLock`). Per-site judgment for the ~50 that are scratch buffers vs. true singletons vs. actually-const.

---

## 3. `AtomicPtr<()>` runtime-registered hooks (layering workaround)

**Zig:** Not needed — Zig has no crate-dependency DAG; any file can `@import` any other.

**Rust port (current):** Low-tier crates store fn-ptrs in `AtomicPtr<()>` slots that high-tier crates fill at startup, to break dependency cycles.

- `src/ptr/ref_count.rs:47` — `static DUMP_STACK: AtomicPtr<()>` → `transmute` to fn ptr.
- `src/safety/lib.rs:27,36,40` — `DUMP_STACK`, `ALLOC_HAS_PTR`, `IS_MIMALLOC_ARENA`.
- `src/bun_core/util.rs:2755,2841` — `NowHookSlot`, `BACKEND`.
- `src/io/lib.rs:1258` — `FILE_POLL_VTABLE: AtomicPtr<FilePollVTable>`.

**Why it's wrong in Rust:** (a) `transmute::<*mut (), fn(...)>` is UB on CHERI/Harvard arches and a footgun on the rest (fn-ptrs are not data ptrs in the C abstract machine — works on x64/arm64 by accident). (b) Init-order hazard: any code running before `bun_runtime::init()` silently no-ops. (c) Loses inlining; every debug-print pays an indirect call.

**Idiomatic fix:**

- **Preferred:** move the implementation **down** to the crate that needs it (commit `0e9effb50dd` already did this for most — `runtime/dispatch.rs:16` documents the win). Remaining 8 slots are the hard cases.
- **When move-down is impossible:** `extern "Rust" { fn __bun_dump_stack(...); }` — link-time binding, no init order, no atomic, fully inlinable with LTO. Define a weak default in `bun_core`, strong override in `bun_runtime`.
- **For optional hooks:** `static HOOK: AtomicPtr<FnRecord>` where `FnRecord` is `#[repr(C)] struct { f: fn(...) }` — store a real fn-ptr field, no transmute.

**Perf:** `extern "Rust"` link-time is **better** (direct call, LTO-inlinable). Current pattern costs 1 atomic load + indirect call per invocation (~3-5ns).

**Count in tree:** **143** `AtomicPtr` total; **~21** are hook-slot pattern (`static.*AtomicPtr` with null init); remainder are legitimate lock-free queue links.

**Sweep difficulty:** Architectural (8 remaining slots). Each needs a per-crate decision: move-down vs extern-link vs keep. Phase-f already swept the easy ones.

---

## 4. Manual refcounting (`ref_count: Cell<u32>` + `ref_()`/`deref()`)

**Zig:** `bun.ptr.RefCount(T, "ref_count", deinit, .{})` mixin generates `ref()`/`deref()`; caller manually balances.

**Rust port (current):** Intrusive `ref_count: Cell<u32>` / `AtomicU32` field + hand-written `ref_()`/`deref()` that `Box::from_raw` on zero.

- `src/http/ProxyTunnel.rs:72` — `ref_count: Cell<u32>` + `pub fn ref_(&self)`.
- `src/http/ThreadSafeStreamBuffer.rs:11` — `ref_count: AtomicU32` (init to **2**!).
- `src/http/h2_client/ClientSession.rs:43`, `h3_client/ClientSession.rs:32`, `HTTPContext.rs:34`, `sourcemap/ParsedSourceMap.rs:19`.
- Generic mixin: `src/ptr/ref_count.rs` (`RefCounted` trait + `RefCount<T>` embed).

**Why it's wrong in Rust:** No RAII — every early-return / `?` is a leak hazard. `deref()` taking `&self` then `Box::from_raw(self as *const _ as *mut _)` is UB (deallocating through a shared borrow). No `Clone`/`Drop` integration means `.clone()` on a containing struct double-frees. The `pub fn deref` name **shadows `std::ops::Deref::deref`** — silent footgun.

**Idiomatic fix:**

- **Non-intrusive cases (ProxyTunnel, ParsedSourceMap):** plain `Rc<T>` / `Arc<T>`. Init-to-2 in `ThreadSafeStreamBuffer` becomes `let a = Arc::new(...); let b = a.clone();`.
- **Intrusive cases (FFI hands out `*mut T`, refcount must be at known offset):** keep `src/ptr/ref_count.rs` but expose **only** `RefPtr<T>` (RAII handle, `Clone` bumps, `Drop` decs) — never `pub fn ref_/deref` on the host type. Model after `triomphe::Arc` or WebKit's `WTF::Ref`.
- **JSC-adjacent (`SystemError::ref_/deref`):** these are bun_str::String refcount fan-outs, not self-ownership — rename to `retain_strings()/release_strings()` to stop shadowing `Deref`.

**Perf:** `Rc<T>` is **identical** to `Cell<u32>` (both non-atomic inc/dec). `Arc<T>` vs `AtomicU32` is identical. Intrusive saves one allocation only when the object is _also_ allocated by C++ — true for ~6 types, false for the rest. `Rc` adds 1 usize (weak count) — use `triomphe::Arc` (no weak) if that matters.

**Count in tree:** **228** matches for `ref_count:` field / `fn ref_` / `fn deref_`; **96** distinct `pub fn ref_` definitions.

**Sweep difficulty:** Per-site judgment (intrusive-required vs. not). ~70% can be `Rc`/`Arc` mechanically; ~30% are FFI-intrusive and need the `RefPtr<T>` wrapper.

---

## 5. `*mut T` struct fields with no lifetime / invariant doc

**Zig:** `field: *T` — Zig has no lifetimes; ownership is by convention.

**Rust port (current):** Bare `*mut T` / `*const T` as struct fields where the pointee is a Rust-owned object (not FFI).

- `src/bundler/AstBuilder.rs:50` — `current_scope: *mut Scope`, `scopes: Vec<*mut Scope>`.
- `src/bundler/BundleThread.rs:107,206` — `*mut BundleV2`, `*mut Completion`.
- `src/bundler/ParseTask.rs:1710` — `user_context: *mut c_void` (legitimate FFI — different category).

**Why it's wrong in Rust:** (a) `*mut T` is nullable but most sites assume non-null → missed `NonNull` niche, `Option<*mut T>` is 16 bytes instead of 8. (b) Auto-derives `!Send + !Sync` _correctly_ — but then `unsafe impl Send` is slapped on the container (101 in tree) defeating the check. (c) No variance, no drop-check, no provenance tracking in type. (d) `docs/LIFETIMES.tsv` exists precisely to classify these but ~40% of fields don't match its `rust_type` column.

**Idiomatic fix:** Per `docs/PORTING.md` type-map row for `?*T` struct fields — apply the LIFETIMES.tsv classification:

- OWNED → `Box<T>`; SHARED → `Rc<T>`/`Arc<T>`; BACKREF/INTRUSIVE → `NonNull<T>` + `// INVARIANT:` doc; ARENA → `&'bump T` (once `'bump` is threaded); UNKNOWN → `Option<NonNull<T>>` + `// TODO(port): lifetime`.
- Minimum bar even when staying raw: `NonNull<T>` (681 already in tree) instead of `*mut T` for never-null fields — recovers the niche, documents the invariant.

**Perf:** `NonNull<T>` is zero-cost (`repr(transparent)`). `Box<T>` is zero-cost over `*mut T` + manual free. `&'bump T` is zero-cost. Only `Rc`/`Arc` add a header word.

**Count in tree:** **3,409** `: *mut [A-Z]` struct fields/params (excluding `_sys`/`ffi`/`c_void`). Compare: **681** `NonNull<` — ratio is 5:1 wrong direction.

**Sweep difficulty:** Mechanical for `*mut → NonNull` (regex + null-check audit). Per-site for ownership reclassification — but `LIFETIMES.tsv` already has the answers; sweep is "apply the TSV".

---

## 6. `[]const u8` → `&'static [u8]` / `*const [u8]` lifetime erasure (the EString UAF class)

**Zig:** `[]const u8` is `(ptr, len)` with no lifetime; arena outlives everything by convention.

**Rust port (current):** Arena-backed slices stored as either `&'static [u8]` (via `transmute`) or `*const [u8]`.

- `src/bundler/defines.rs:445` — `transmute::<&[u8], &'static [u8]>(arena_value)`.
- `src/bundler/ServerComponentParseTask.rs:224,259,262` — three `transmute` to `&'static [u8]`.
- `src/css/context.rs:117` — `transmute::<&Bump, &'static Bump>`.
- `src/js_parser/ast/TS.rs:131` — `EnumString(*const EString)` with `// TODO(port): &'bump EString`.
- `Symbol.original_name: *const [u8]` (referenced in `linker_context/generateCodeForLazyExport.rs:197` etc.).

**Why it's wrong in Rust:** `&'static` is a _promise to LLVM_ that the bytes live forever; the optimizer may hoist loads across `arena.reset()`. `*const [u8]` is sound but loses bounds-check elision (every `.len()` is a raw deref) and auto-traits. This is the exact bug class that caused the historical EString UAF in Zig — Rust _can_ prevent it but the port opts out.

**Idiomatic fix:**

- **Thread `'bump` / `'arena` lifetime through the AST.** `Expr<'bump>`, `Symbol<'bump>`, `EString<'bump>`. The codebase already has **701** occurrences of `'arena|'bump|'alloc` — the parameter exists, it's just not on the leaf types yet (`TS.rs:130` literally says `TODO(port): &'bump EString once 'bump threaded crate-wide`).
- **Interim (where `'bump` can't reach):** newtype `struct ArenaStr(*const [u8])` with `unsafe fn as_slice<'a>(&self, _proof: &'a Bump) -> &'a [u8]` — forces caller to present the arena as a witness.
- **Never** `transmute` to `'static`. If you must erase, erase to `*const [u8]` (sound, just unergonomic).

**Perf:** `&'bump [u8]` is **identical** to `&'static [u8]` at codegen (same `(ptr, len)` pair, same bounds-check elision). Threading `'bump` is zero runtime cost. **Better** than `*const [u8]`: `&'bump [u8]` lets LLVM assume `dereferenceable(len)` + `noalias`-readonly.

**Count in tree:** **161** `transmute` to `'static` / `erase_lifetime` / `extend_lifetime`; **509** `*const [u8]` fields/casts; **16** `*const [u8]` fields in `js_parser`/`css` specifically.

**Sweep difficulty:** Architectural. Threading `'bump` through `js_ast` is one large but mechanical change (add `<'bump>` to ~40 types, propagate). The `transmute`-to-`'static` sites are then mechanical deletions. Estimate: 1 focused PR per crate (js_parser, css, bundler).

---

## 7. `MaybeUninit<T>` for "fill later" struct fields

**Zig:** `field: T = undefined` — bit-pattern is garbage until first write; reading is safety-checked UB in debug.

**Rust port (current):** `MaybeUninit<T>` as a struct field for late-init, with `assume_init_mut()` at every read.

- `src/bundler/ThreadPool.rs:427,438` — `heap: MaybeUninit<ThreadLocalArena>`, `data: MaybeUninit<WorkerData>`.
- `src/main_wasm.rs:196-266` — 7× `static mut MaybeUninit<_>`.
- `src/collections/pool.rs:34` — `data: MaybeUninit<T>` (legitimate — pool slot).

**Why it's wrong in Rust:** Every access is `unsafe { x.assume_init_ref() }` (205 in tree) — no compiler check that init happened. `Drop` on the container does **not** drop the `MaybeUninit` payload → leak unless hand-dropped. For types with niche (`Box`, `NonNull`, `enum`), `MaybeUninit` defeats the niche so `Option<MaybeUninit<Box<T>>>` is 16 bytes.

**Idiomatic fix:**

- **Late-init that always happens before use:** `Option<T>` + `fn data(&self) -> &T { self.data.as_ref().unwrap_unchecked() }` in release / `.unwrap()` in debug. One-line `#[cfg]` wrapper.
- **Two-phase construction:** builder pattern — `WorkerBuilder { ... } -> Worker`. Init-at-construction; no uninit field ever exists.
- **Legitimate uses (keep):** pool slots, FFI out-params, `[MaybeUninit<u8>; N]` scratch buffers — these are correct.

**Perf:** `Option<T>` where `T` has a niche (`Box`, `NonNull`, `&T`) is **zero-cost** (same size as `T`). `Option<ThreadLocalArena>` adds 1 discriminant byte + padding only if no niche — `ThreadLocalArena` contains a `NonNull` so it's free. `unwrap_unchecked()` in release is identical codegen to `assume_init_ref()`.

**Count in tree:** **236** `MaybeUninit` mentions; **205** `assume_init*()` calls. Est. ~40% are legitimate (buffers/pools/FFI), ~60% are "Zig `= undefined`" late-init.

**Sweep difficulty:** Mechanical. Grep `: MaybeUninit<` in struct defs, check if `T` has a niche → `Option<T>`.

---

## 8. `(tag: u8, ptr: *mut ())` erased unions vs Rust `enum`

**Zig:** `union(enum) { a: *A, b: *B }` or hand-packed `TaggedPointer` (tag in high 15 bits).

**Rust port (current):** Two flavors:

- (a) `struct { tag: Tag, value: Union }` with `#[repr(C)] union` — `src/install/resolution.rs:25`, `src/semver/Version.rs:63,942,1250`, `src/install/integrity.rs:16`.
- (b) `TaggedPtr(u64)` packing addr in bits 0..49, tag in 49..64 — `src/ptr/tagged_pointer.rs`. Dispatch via `match tag { ... unsafe { &*(ptr as *mut A) } }`.
- (c) `(tag: u8, ptr: *mut ())` event-loop tasks — `src/bundler/DeferredBatchTask.rs:10`, `src/io/lib.rs:707`.

**Why it's wrong in Rust:** Rust `enum` **is** a tagged union with compiler-checked exhaustiveness, niche optimization, and auto-`Drop`. Hand-rolled `(tag, union)` loses: exhaustive match, niche packing (Rust `enum { A(Box<X>), B(Box<Y>) }` is 8 bytes via pointer-tag niche; manual struct is 16), auto-drop of the active variant. `TaggedPtr` strips provenance (`ptr as usize as *mut T`) — Strict Provenance violation, breaks under `-Zmiri-strict-provenance`.

**Idiomatic fix:**

- **(a) tag+union structs:** Rust `enum` with payload variants. Where on-disk layout matters (`install/resolution.rs`, lockfile format) keep `#[repr(C)]` manual union but wrap in safe `enum` view via `From`/`Into` at the serialization boundary only.
- **(b) TaggedPtr:** `enum AnyTask { Parse(NonNull<ParseTask>), Resolve(NonNull<ResolveTask>), ... }` — rustc already packs the discriminant into pointer alignment bits when variants ≤ align (up to 8 on 64-bit). For >8 variants, accept 16 bytes or use `tagged-pointer` crate (uses `ptr::map_addr` — provenance-preserving).
- **(c) Event-loop dispatch:** trait object `NonNull<dyn Task>` (16 bytes, vtable dispatch) **or** `enum Task` (8-16 bytes, monomorphized match — faster).

**Perf:** Rust `enum` match is a jump table — **identical** to manual tag switch. Niche-packed `enum` is **smaller** (8B vs 16B) than `(tag: u8, ptr)` after padding. `TaggedPtr` 49-bit packing saves nothing over Rust niche on 64-bit (both 8B). Only loss: lockfile on-disk compat needs explicit `#[repr]`.

**Count in tree:** **251** `tag: Tag`/`tag: u8`/`ptr: *mut ()` matches. `TaggedPointerUnion` used in ~18 distinct types.

**Sweep difficulty:** Per-site judgment (on-disk format vs in-memory). ~80% in-memory → mechanical enum conversion. ~20% serialized (lockfile, npm cache) → keep repr, add safe view.

---

## 9. `@fieldParentPtr` → `offset_of!` + ptr arithmetic (intrusive containers)

**Zig:** `@fieldParentPtr("linker", c)` — recover `*BundleV2` from `*LinkerContext` field.

**Rust port (current):** `(field_ptr as *mut u8).sub(offset_of!(Parent, field)) as *mut Parent`.

- `src/bundler/HTMLImportManifest.rs:185` — `.sub(offset_of!(BundleV2<'static>, graph))`.
- `src/bundler/linker_context/generateChunksInParallel.rs:453,562`, `computeChunks.rs:559`, `writeOutputFilesToDisk.rs:100` — all recovering `*BundleV2` from `*LinkerContext`.
- `src/bundler/DeferredBatchTask.rs:47`, `ThreadPool.rs:475`.

**Why it's wrong in Rust:** The arithmetic itself is sound (since `offset_of!` stabilized in 1.77), **but** the input pointer's provenance only covers the field, not the parent. `&mut bundle.linker as *mut _` then `.sub(offset)` then deref of `bundle.graph` is UB under Stacked Borrows (out-of-provenance access). Only sound if the original pointer was derived from `&mut bundle` (whole struct) — which defeats the purpose.

**Idiomatic fix:**

- **Best:** stop needing it. Pass `&mut BundleV2` (or `*mut BundleV2`) instead of `&mut LinkerContext`; `linker` becomes `bundle.linker`. The 6 BundleV2 sites all have `bundle` in scope two frames up.
- **When intrusive is required (linked-list nodes, task queues):** define `container_of!` macro that takes `*mut Field` (not `&mut`) and document the provenance requirement: caller must derive the field ptr from a whole-struct ptr via `addr_of_mut!((*parent).field)`. The 457 `addr_of_mut!` in tree suggest this is half-done.
- **Alternative:** store backpointer `parent: NonNull<BundleV2>` in `LinkerContext` — costs 8 bytes, zero unsafe.

**Perf:** Backpointer costs 8B/struct, zero per-access. `container_of!` is zero-cost. Passing `&mut BundleV2` instead is zero-cost and **better** (one fewer indirection at use sites).

**Count in tree:** **400** `offset_of!`/`fieldParentPtr`/`container_of` matches; ~30 are the recover-parent pattern (rest are layout asserts / serialization).

**Sweep difficulty:** Architectural for BundleV2/LinkerContext (6 sites, one design decision). Mechanical for intrusive lists (wrap in `container_of!` macro with provenance doc).

---

## 10. `anytype` → `&dyn Trait` (vs generic `<T: Trait>`)

**Zig:** `fn foo(writer: anytype)` — comptime duck-typing, monomorphized.

**Rust port (current):** Mostly done right (`impl Trait` / generics per `PORTING.md`). Remaining `&dyn`:

- `src/io/openForWriting.rs:16,28,48,61` — `openat: &dyn Fn(Fd, &ZStr, i32, Mode) -> Result<Fd>` (called once per file open).
- `src/js_parser/ast/Parser.rs:608` — `callback: &dyn Fn(*mut c_void, &mut TSXParser, &mut [Part]) -> Result<...>`.
- `src/install/auto_installer.rs:127`, `src/install_types/resolver_hooks.rs:1346` — `&dyn PackageJsonView`.

**Why it's wrong in Rust:** `&dyn Fn` is a fat pointer (16B) + vtable indirect call + cannot inline. Zig's `anytype` was monomorphized — the port silently demoted to dynamic dispatch. Fine for cold paths; regression for hot ones.

**Idiomatic fix:** `fn open_for_writing<F: Fn(Fd, &ZStr, i32, Mode) -> Result<Fd>>(openat: F)`. For trait objects used polymorphically at runtime (rare — `PackageJsonView` is one), `&dyn` is correct.

**Perf:** Generic = inlined, zero-cost (matches Zig). `&dyn Fn` = ~2-5ns indirect call + register spill. `openForWriting` is per-file-open (cold) → fine. `Parser.rs:608` callback is per-parse-result → borderline.

**Count in tree:** **40** `&dyn`/`Box<dyn>` total; **31** after excluding `fmt::Display`/`Debug`/`Error`. Only ~5 are in hot-ish paths.

**Sweep difficulty:** Mechanical. Low priority — already mostly correct; ~5 sites worth changing.

---

## 11. `BabyList<T>` vs `Vec<T>`

**Zig:** `BabyList(T)` = `{ ptr, len: u32, cap: u32 }` — 16 bytes vs `ArrayList`'s 24, used in AST nodes where millions exist.

**Rust port (current):** `src/collections/baby_list.rs:28` — `#[repr(C)] struct BabyList<T> { ptr: NonNull<T>, len: u32, cap: u32, origin: Origin }`. Used in 438 sites, mostly AST.

**Why it's wrong in Rust:** It's not _wrong_ — the 16B-vs-24B win is real for AST nodes. Problems: (a) `origin: Origin` field added for borrow-tracking makes it **17+ bytes** in release (defeating the entire point — comment at line 38 admits this). (b) No `Deref<Target=[T]>`, no `IntoIterator`, no `FromIterator` — every use site is `list.slice()` instead of `&list[..]`. (c) `Drop` checks `origin` at runtime → branch on every drop. (d) Doesn't implement `Allocator` API so can't use `Vec<T, &Bump>`.

**Idiomatic fix:**

- **AST-node case (the real use):** `bumpalo::collections::Vec<'bump, T>` — 24B but arena-backed, no Drop, no `origin` tracking needed (arena owns). Or `thin-vec` crate (ptr-only, len/cap in heap header) — 8B on stack.
- **Owned case:** `smallvec::SmallVec<[T; 0]>` is 24B (same as `Vec`); just use `Vec<T>`.
- **If 16B is genuinely load-bearing (profile first):** keep `BabyList` but (1) drop `origin` in release (make borrowed-ness a _type_ — `BabyList<T>` vs `BorrowedList<'a, T>`), (2) impl `Deref`/`IntoIterator`/`Extend`.

**Perf:** Current `BabyList` with `origin` is **worse** than `Vec` (17-24B + drop branch). `bumpalo::Vec<'bump>` is 24B but **zero drop cost** (arena bulk-free). `thin-vec` is 8B + 1 extra indirection per `.len()`.

**Count in tree:** **438** `BabyList<` usages.

**Sweep difficulty:** Architectural (one decision: fix BabyList vs replace with bumpalo::Vec). Then mechanical sweep.

---

## 12. `Maybe<T, E>` returning `.err`/`.result` vs `Result<T, E>` + `?`

**Zig:** `Maybe(T) = union(enum) { err: SystemError, result: T }` — Zig `!T` can't carry payload, so `Maybe` is the payload-error pattern.

**Rust port (current):** Three parallel `Maybe` types:

- `src/sys/lib_draft_b1.rs:4758` — `enum Maybe<R, E = Error> { Err(E), Ok(R) }` + `init_err`/`init_result`/`as_err`/`as_value`/`errno_sys`.
- `src/jsc/SystemError.rs:61` — `enum Maybe<R> { Err(SystemError), Result(R) }`.
- `src/runtime/node.rs:197` — `enum Maybe<R, E>`.
  None implement `Try`/`FromResidual` (grep confirms).

**Why it's wrong in Rust:** `Result<T, E>` **is** `Maybe`. The port reinvents it without `?`, `map`, `and_then`, `From`-conversion, or `#[must_use]` propagation through combinators. 369 call sites do `match x { Maybe::Ok(v) => v, Maybe::Err(e) => return Maybe::Err(e) }` — that's literally `?`. The "kept distinct so `.err`/`.result` field-style usage ports 1:1" comment (`lib_draft_b1.rs:4756`) is a Phase-A scaffolding rationale, not a runtime one.

**Idiomatic fix:** `pub type Maybe<R, E = SysError> = core::result::Result<R, E>;` + free fns / extension trait for `errno_sys`/`retry`/`aborted`. Instant `?` everywhere. `PORTING.md` already says `Maybe(T)` → `bun_sys::Result<T>` — the type alias just isn't `= core::result::Result` yet.

**Perf:** **Identical** layout (`Result<T, E>` and `Maybe<T, E>` are both `enum { Ok(T), Err(E) }`). `?` desugars to the same match. **Better** with niche: `Result<NonNull<T>, SysError>` packs discriminant into `SysError`'s padding.

**Count in tree:** **1,007** `Maybe<` / `.err(` / `.result(` matches; **369** explicit `Maybe::Ok`/`Maybe::Err`/`init_err`/`init_result` call sites.

**Sweep difficulty:** Mechanical. One-line type alias change + `sed` for `init_err(x)` → `Err(x)`, `init_result(x)` → `Ok(x)`, `.as_err()` → `.err()` (std method). The 3 duplicate definitions collapse to 1.

---

## 13. `catch unreachable` → `.unwrap()` on fallible-but-"can't-fail"

**Zig:** `list.append(x) catch unreachable;` — allocation can't fail because we just `ensureCapacity`'d.

**Rust port (current):** `.unwrap()` / `unreachable!()` — 7,109 total. Subset that mirrors `catch unreachable`: ~55 explicit comments + uncounted `.unwrap()` on `Result<_, OOM>` (244 `OOM` mentions).

**Why it's wrong in Rust:** Mostly **fine** — `.unwrap()` on `Vec::push` after `reserve` is correct. Anti-patterns hiding in the count:

- `.unwrap()` on `Result<T, OOM>` where Zig propagated `try` — the port _narrowed_ error handling. `src/bundler/options.rs:223` comment shows `catch unreachable` ported as no-op.
- `unreachable!()` in `match` arms that Zig's `else => unreachable` covered — but Rust exhaustiveness already proves it; the arm is dead code.
- `.unwrap()` on `RefCell::borrow_mut()` in reentrancy-possible paths.

**Idiomatic fix:**

- Allocation-after-reserve: use `Vec::push` (infallible) instead of `try_push().unwrap()` — **delete** the unwrap.
- `OOM` propagation: `?` (PORTING.md says `OOM!T → Result<T, AllocError>`). Since global allocator aborts on OOM anyway, `Vec::push` (panicking) is _more_ correct than `try_push().unwrap()`.
- Exhaustive-match `unreachable!()`: delete the arm; let rustc prove it.

**Perf:** Deleting `.unwrap()` removes a branch + panic-landing-pad. **Better.**

**Count in tree:** **7,109** `.unwrap()`/`unreachable!()`/`.expect(`. Est. ~10-15% are removable (post-reserve, dead match arms).

**Sweep difficulty:** Per-site judgment, but low-risk (each site is locally decidable). Clippy `unnecessary_unwrap` + `match_wildcard_for_single_variants` catch ~half.

---

## 14. Slices into `bumpalo` arenas without `'arena` lifetime param

**Zig:** Arena allocator hands out `[]T`; freed in bulk on `arena.deinit()`.

**Rust port (current):** `bumpalo::Bump` used (712 mentions), but output stored as `*const [u8]` / `&'static [u8]` instead of `&'bump [u8]`. Covered by Pattern 6 — listing separately because the **container** types (not just leaf strings) are affected.

- `src/css/context.rs:117` — `transmute::<&Bump, &'static Bump>` so downstream borrows are `'static`.
- `src/bundler/transpiler.rs:201` — `arena.alloc(ptr::read(self))` then return `*mut`.
- `src/js_parser/lexer.rs:18` — comment: "should use `&'bump bumpalo::Bump`. For Phase A we keep a `&dyn Allocator`-ish slot".

**Why it's wrong in Rust:** Same UAF class as #6. Additionally: `bumpalo::Bump` is `!Sync`, so `transmute`-ing to `&'static Bump` then sending to a thread pool (bundler does this) is a data race on the bump pointer.

**Idiomatic fix:** Thread `'bump` from `Bump` creation site through every type that holds arena data. `bumpalo::boxed::Box<'bump, T>`, `bumpalo::collections::Vec<'bump, T>`, `&'bump str`. Crate already has 701 `'arena|'bump|'alloc` — finish the threading.

**Perf:** Zero-cost. Lifetime params are erased.

**Count in tree:** **712** `Bump`/`bumpalo` mentions; **701** `'arena|'bump` params (so ~50% threaded); **161** `transmute`-to-`'static` escape hatches.

**Sweep difficulty:** Architectural — same PR(s) as #6.

---

# Additional patterns found (beyond starter list)

## 15. `pub fn deinit(&mut self)` instead of `impl Drop`

**Zig:** `pub fn deinit(self: *T) void` — explicit, caller calls it.

**Rust port (current):** 216 `fn deinit` definitions vs 266 `impl Drop`. Many types have **both** (Drop calls deinit), some have **only** deinit (leak if forgotten).

- `src/bundler/DeferredBatchTask.rs:93`, `src/bundler/analyze_transpiled_module.rs:176`.

**Why it's wrong in Rust:** No RAII; `?` early-return leaks. `PORTING.md` explicitly says "`pub fn deinit` becomes `impl Drop`, not an inherent method" — port didn't follow its own guide for ~216 types.

**Idiomatic fix:** `impl Drop`. If deinit body only frees `Box`/`Vec` fields → delete entirely (auto-drop). If it takes `allocator` param → retype fields to own allocator. If FFI-destroyed → `unsafe fn destroy(*mut Self)` (not `deinit`).

**Perf:** Zero-cost (Drop is the same call, just automatic). **Better:** fields that become `Box`/`Vec` get drop-flag elision.

**Count in tree:** **216** `fn deinit`.

**Sweep difficulty:** Mechanical (PORTING.md has the exact recipe per case).

---

## 16. `unsafe impl Send/Sync` to paper over raw-pointer fields

**Zig:** No `Send`/`Sync` — everything is shareable.

**Rust port (current):** 101 `unsafe impl Send/Sync`. Many are blanket overrides because a `*mut T` field made the struct `!Send`.

- `src/bundler/ThreadPool.rs:74-75`, `bundle_v2.rs:557-558,1291-1292`, `defines-table.rs:221-223`, `linker_context/computeCrossChunkDependencies.rs:165`.

**Why it's wrong in Rust:** The `*mut T` was `!Send` _for a reason_ — it points into a single-thread arena or a `Cell`-bearing struct. `unsafe impl Send` asserts thread-safety without proving it. `CrossChunkDependencies` is sent to a rayon-style pool while holding `*mut` into `LinkerContext` — actual data race if two chunks touch the same import record.

**Idiomatic fix:** Fix the field type (Pattern 5): `*mut T` → `NonNull<T>` (still `!Send` — correct) or `&'a T` (auto-`Send` if `T: Sync`) or `Arc<T>`. If genuinely thread-safe by external sync (mutex elsewhere), `unsafe impl Send` with `// SAFETY:` citing the lock. Audit each of the 101.

**Perf:** Zero-cost — these are marker traits.

**Count in tree:** **101**.

**Sweep difficulty:** Per-site judgment — each is a soundness claim that needs a one-paragraph proof or a field retype.

---

## 17. `mem::zeroed()` for non-`#[repr(C)]` / niche-bearing types

**Zig:** `std.mem.zeroes(T)` — fine for any T.

**Rust port (current):** 290 `mem::zeroed()`. Most are libc structs (fine). Some are Rust types:

- `src/bundler/ThreadPool.rs:103` — `unsafe { core::mem::zeroed() }` for a non-FFI return value.

**Why it's wrong in Rust:** Zeroing a type with `NonNull`/`NonZero`/`&T`/`Box`/`enum` field is **instant UB** (invalid bit pattern). `zeroed::<Option<NonNull<T>>>()` happens to be `None` (lucky), but `zeroed::<Box<T>>()` is UB.

**Idiomatic fix:** `Default::default()` for Rust types; `mem::zeroed()` only for `#[repr(C)]` POD with documented all-zero validity (libc structs). Clippy `invalid_value` / `uninit_assumed_init` catches the worst.

**Perf:** `Default` for POD compiles to the same `memset`. Zero-cost.

**Count in tree:** **290** total; est. ~15-20 are non-FFI Rust types.

**Sweep difficulty:** Mechanical (clippy-assisted).

---

## 18. `transmute` for `@enumFromInt` / `@intFromEnum`

**Zig:** `@enumFromInt(x)` — checked in safe builds.

**Rust port (current):** `unsafe { transmute::<u8, Kind>(raw) }` — 260 matches.

- `src/jsc/SystemError.rs:78` — `transmute((self.errno * -1) as u16)`.
- `src/bundler/ParseTask.rs:689,691`, `src/install/isolated_install/Installer.rs:696`, `src/md/types.rs:515`.

**Why it's wrong in Rust:** `transmute` to enum with no matching discriminant is UB (not a panic). Zig's `@enumFromInt` traps in safe mode; Rust `transmute` never does.

**Idiomatic fix:** `#[repr(u8)] enum` + `impl TryFrom<u8>` (via `num_enum::TryFromPrimitive` derive — already a dep). For known-valid (e.g. round-tripping our own discriminant): `transmute` is acceptable with `debug_assert!(raw < N)` guard, or `num_enum::FromPrimitive` with `#[default]` catch-all.

**Perf:** `TryFrom` adds one compare+branch (~1ns, predicted). For round-trip cases use `unsafe { transmute }` with `debug_assert` — zero-cost in release, checked in debug (matches Zig safe-mode semantics exactly).

**Count in tree:** **260** `transmute`/`@enumFromInt` matches; ~80 are int→enum.

**Sweep difficulty:** Mechanical (`num_enum` derive + sed).

---

## 19. `ctx: *mut c_void` + fn-ptr instead of closures/generics

**Zig:** `fn(ctx: *anyopaque, ...)` callback + `@ptrCast` inside — Zig has no closures.

**Rust port (current):** 251 `ctx: *mut c_void` / `context: *mut c_void` params paired with `fn(*mut c_void, ...)` callbacks.

- `src/http/ThreadSafeStreamBuffer.rs:19`, `src/bundler/bundle_v2.rs:6837`, `src/bundler/ParseTask.rs:73,90,1710`, `src/io/PipeWriter.rs:488`.

**Why it's wrong in Rust:** Rust has closures. `Box<dyn FnOnce(...)>` or `<F: FnOnce(...)>` captures the context type-safely. The `*mut c_void` round-trip loses the type, requires `unsafe` cast at both ends, and can't capture `!Send` data safely.

**Idiomatic fix:**

- **Non-FFI callbacks (ParseTask, PipeWriter):** generic `<C>` context param (PORTING.md row: "opaque context/userdata pattern → unbounded `<C>`; if stored across calls, `<C: 'static>`").
- **Stored callbacks (event loop tasks):** `enum Task { Parse(Box<ParseTask>), ... }` (Pattern 8) or `Box<dyn FnOnce() + Send>`.
- **True FFI (uws, libuv callbacks):** keep `*mut c_void` — required by C ABI.

**Perf:** Generic `<C>` is **better** (monomorphized, inlined — matches Zig). `Box<dyn FnOnce>` is +1 alloc + indirect call — only use when stored heterogeneously.

**Count in tree:** **251**; est. ~100 are non-FFI (rest are uws/libuv/JSC C boundaries — correct).

**Sweep difficulty:** Per-site judgment (FFI vs internal). Internal ones are mechanical once classified.

---

## 20. `core::ptr::read(self)` for move-out-of-`&T` (bitwise copy of non-Copy)

**Zig:** `var v = this.*;` — bitwise struct copy, always legal.

**Rust port (current):** `unsafe { core::ptr::read(self) }` to "clone" a non-`Clone` type.

- `src/jsc/SystemError.rs:108` — `ptr::read(self)` then `v.ref_()` (manual Clone).
- `src/bundler/transpiler.rs:201`, `src/css/css_parser.rs:3063`, `src/bundler/linker_context/convertStmtsForChunk.rs:405,420,506,521`.

**Why it's wrong in Rust:** `ptr::read` produces a second owner of the same `Drop` resources → double-free unless one is `mem::forget`-ten or refcount-bumped. The pattern is correct _only_ with the immediate `ref_()` / `ManuallyDrop` — fragile, and `convertStmtsForChunk.rs` does **not** bump anything (relies on arena no-drop — undocumented).

**Idiomatic fix:**

- If type is logically cloneable: `impl Clone` (with refcount bump inside).
- If moving out of an enum variant: `mem::replace(slot, Placeholder)` or `Option::take`.
- If arena-backed (no Drop): make the type `Copy` (it's just pointers+ints) — then `*self` works without `unsafe`.

**Perf:** `impl Clone` with same body is zero-cost. Making arena types `Copy` is zero-cost and **removes** the `unsafe`.

**Count in tree:** **81** `ptr::read(` (excluding unaligned/volatile).

**Sweep difficulty:** Per-site judgment (~3 categories above). ~50% become `Copy`, ~30% become `Clone`, ~20% become `mem::take`.

---

# Summary table

| #   | Pattern                       | Count         | Perf of fix                | Difficulty          |
| --- | ----------------------------- | ------------- | -------------------------- | ------------------- |
| 1   | `&mut *raw_ptr` aliasing      | 2,440         | zero-cost (UnsafeCell)     | per-site / arch     |
| 2   | `static mut` / `&'static mut` | 302 + 36      | zero-cost (SyncUnsafeCell) | mechanical          |
| 3   | `AtomicPtr<()>` hooks         | 21 slots      | **better** (LTO inline)    | architectural       |
| 4   | Manual refcount               | 228 / 96 fns  | identical (Rc/Arc)         | per-site            |
| 5   | `*mut T` fields, no invariant | 3,409         | zero-cost (NonNull)        | mechanical (TSV)    |
| 6   | `&'static [u8]` arena erasure | 161 + 509     | zero-cost (`'bump`)        | architectural       |
| 7   | `MaybeUninit` late-init       | 236 / 205     | zero-cost (Option+niche)   | mechanical          |
| 8   | `(tag, *mut ())` unions       | 251           | **better** (niche enum)    | per-site            |
| 9   | `offset_of!` parent recovery  | ~30           | zero-cost / +8B backptr    | architectural       |
| 10  | `&dyn` for `anytype`          | 31 (5 hot)    | **better** (mono)          | mechanical          |
| 11  | `BabyList<T>`                 | 438           | **better** (drop origin)   | architectural       |
| 12  | `Maybe<T,E>` ≠ `Result`       | 1,007 / 369   | identical                  | **mechanical**      |
| 13  | `catch unreachable`→unwrap    | ~7,109        | **better** (-branch)       | per-site (clippy)   |
| 14  | Arena slices sans `'arena`    | 712 / 161     | zero-cost                  | architectural (=6)  |
| 15  | `fn deinit` not `Drop`        | 216           | zero-cost                  | mechanical          |
| 16  | `unsafe impl Send/Sync`       | 101           | zero-cost                  | per-site audit      |
| 17  | `mem::zeroed()` non-POD       | ~20 risky     | zero-cost                  | mechanical (clippy) |
| 18  | `transmute` int→enum          | ~80           | +1 branch or zero          | mechanical          |
| 19  | `*mut c_void` ctx callback    | ~100 internal | **better** (mono)          | per-site            |
| 20  | `ptr::read(self)` to clone    | 81            | zero-cost                  | per-site            |
