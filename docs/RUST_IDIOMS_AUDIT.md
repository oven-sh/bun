# Rust Idioms Audit — 2026-05-08

Adversarial review of 30 crates. Each candidate pattern was independently verified by two reviewers reading the cited code in context; only patterns where **both** reviewers confirmed the finding as a genuine, sweep-worthy anti-pattern appear in §1. Patterns where either reviewer demonstrated the finding was context-blind, factually wrong, or already-policy are listed in §2 with the refutation. Ranked by (severity × instances).

---

## 1. Top patterns to fix

### 1. Raw-pointer round-trips solely to defeat borrowck (the `mgr_ptr` dance) — ~242 instances [UB]

**What:** `let mgr_ptr: *mut PackageManager = this; let this = unsafe { &mut *mgr_ptr };` then re-derive overlapping `&mut` from the same provenance root a dozen times in one function.

**Why it's wrong:** This is the canonical "I gave up on borrowck" pattern. Several sites materialize two live `&mut` to the same `PackageManager` simultaneously (e.g. `Wait::is_done` in `isolated_install/Installer.rs:195` passes `&mut *pkg_manager` while `self.installer.manager` still borrows the same object). Stacked Borrows / Tree Borrows reject this; it is UB even though it runs today. The struct fields that force it (`PackageInstaller.manager: &'a mut PackageManager`, `.lockfile: &'a mut Lockfile`) are mis-classified in `LIFETIMES.tsv` as `BORROW_PARAM` when they are self-aliasing `BACKREF`s.

**Example:** `src/install/hoisted_install.rs:73-77,351,364` — 12× in one function; `src/install/isolated_install/Installer.rs:780-1836` — 20+.

**Fix:** Do **not** introduce `RefCell` (panics at exactly the alias points) or split `PackageManager` (breaks `.zig` diff parity). Retype the BACKREF fields to raw pointers — `PackageInstaller { manager: *mut PackageManager, lockfile: *mut Lockfile, options: *const Options }`, matching `progress: *mut Progress` which was already done — and add `#[inline] fn manager(&self) -> &PackageManager` / `fn manager_mut(&mut self) -> &mut PackageManager` accessors that confine the `unsafe { &* }` to one audited site. Then the 30+ `unsafe { &mut *mgr_ptr }` locals and the provenance-laundering prologues disappear. This is exactly the `phase-f-accessor-sweep` remit.

**Perf cost:** None. `&'a mut T` and `*mut T` are identical codegen minus an LLVM `noalias` hint.

**Verify notes:** Both reviewers independently rejected the original suggestion of `RefCell`/struct-split and converged on "retype BACKREF fields to `*mut` + centralized accessor", citing `PORTING.md:114` and the in-file comment at `hoisted_install.rs:345-348` which already prescribes this.

---

### 2. AST node fields typed `*mut [T]` / `*const [T]` instead of an arena-slice newtype — ~380 instances [maintainability]

**What:** 43 AST struct fields carry raw fat slice pointers with no lifetime; 340 read sites are open-coded `unsafe { &*ptr }` / `unsafe { &mut *ptr }`; ~40 hand-written `Default` impls build dangling slices via `slice_from_raw_parts_mut(NonNull::dangling(), 0)`.

**Why it's wrong:** No null/dangling invariant, no lifetime, and `lowerDecorators.rs:134 unsafe fn slice_mut<'r, T>(ptr: *mut [T]) -> &'r mut [T]` lets the caller pick any lifetime — a transmute in disguise. The "Phase B threads `'bump`" TODO is months old and the workaround layer (`StoreStr`, `StoreSlice`, per-file `items_mut` helpers) keeps growing.

**Example:** `src/js_parser/ast/S.rs:50` `pub items: *mut [ClauseItem]`; `ast/E.rs:1709` `pub parts: *mut [TemplatePart]`; `lib.rs:1162` `pub stmts: *mut [Stmt] // TODO(port): &'bump mut [Stmt]`.

**Fix:** Finish the migration `StoreSlice<T>` (`src/js_parser/lib.rs:433`) already started: retype every remaining `*mut [T]` / `*const [T]` AST field to `StoreSlice<T>` / `StoreStr`, derive `Default`, delete the per-file `slice_mut` helpers and the 340 open-coded derefs in favor of `field.slice()` / `field.slice_mut()`. Keeps nodes `Copy`, keeps `Default`, confines `unsafe` to one audited type, and a `PhantomData<&'arena ()>` can be added to `StoreSlice` later as a one-struct change.

**Perf cost:** None — `StoreSlice` is `NonNull<T> + u32` (12 bytes vs 16 for `*mut [T]`, so nodes shrink); accessors are `#[inline]` raw derefs, identical codegen.

**Verify notes:** Reviewers rejected the initial proposal of `&'arena mut [T]` fields (loses `Copy`, forces deep-clone in `class_copy`/`prop_copy`, cascades a lifetime through 100+ files) and the offset-index alternative (adds base-pointer load + arena handle threading). Both converged on completing the existing `StoreSlice` newtype.

---

### 3. SoA borrowck evasion: raw `*mut [T]` columns + 300 `unsafe { &mut * }` — ~328 instances [maintainability]

**What:** `MultiArrayList` hands out raw `*mut [T]` to every column so callers hold N mutable slices into one container simultaneously; every linker hot-loop body is 80% `unsafe { &mut * }` ceremony with SAFETY comments that just say "disjoint field".

**Why it's wrong:** Nothing stops `all_parts[i]` and `all_module_scopes[i]` from pointing into freed storage after a `push`. The disjointness is real (SoA columns are physically non-overlapping by layout) but unproven to the type system, so it's re-asserted at 99 `items_raw`/`addr_of_mut!` sites and 328 deref sites. `scanImportsAndExports.rs:105` already pays a `to_vec()` clone of `reachable_files` purely to dodge a borrow conflict.

**Example:** `src/bundler/linker_context/renameSymbolsInChunk.rs:40-66` — `macro col_ptr! { unsafe { $slice.items_raw::<…>() } }` × 12 columns + `symbols_ptr: *mut symbol::Map = addr_of_mut!(c.graph.symbols)`.

**Fix:** Extend `multi_array_columns!` (`src/collections/multi_array_list.rs:53`) to additionally emit `struct {Name}ColumnsMut<'a> { pub field: &'a mut [Ty], … }` and `fn split_mut(&mut self) -> {Name}ColumnsMut<'_>` — one internal `unsafe` block, soundness provable from `COLUMN_OFFSET_PER_CAP`. This kills `col_ptr!`/`col!`/`col_mut!` and ~60-70% of derefs. For the interleaved-`&mut self` cases (`scanImportsAndExports`/`doStep5`), refactor `LinkerGraph::{generate_new_symbol, add_part_to_file, generate_symbol_import_and_use}` from `&mut self` methods to free fns taking `(&mut symbol::Map, &JSAstColumnsMut<'_>, …)` so the caller does one split-borrow at the top. Separately fix the `Slice<T>: Copy` + `items_mut(&mut self)` soundness hole.

**Perf cost:** None. Identical pointer arithmetic, encapsulated once. Removing the `to_vec()` workaround in `scanImportsAndExports` is a net alloc *win*.

**Verify notes:** Both reviewers agreed the "zero unsafe in linker_context" target is right for ~60% of sites and aspirational for the rest; staged the fix as macro-extension first, callee-signature refactor second. Do not reshuffle `LinkerGraph` struct fields.

---

### 4. `Option<*mut T>` / `Option<*const T>` fields (double-nullability, no niche) — ~324 instances [maintainability]

**What:** `*mut T` is already nullable, so `Option<*mut T>` has two "absent" encodings (`None` vs `Some(null)`) and is 16 bytes instead of 8.

**Why it's wrong:** Forces `opt.map(|p| unsafe { &*p })` gymnastics everywhere; `Order.rs:94 fn nn` exists solely to convert this back to `Option<NonNull<_>>`. Wastes 8 bytes per field on hot per-request structs (`RequestContext`) and per-source-file SoA arrays.

**Example:** `src/runtime/test_runner/bun_test.rs:1638` `pub parent: Option<*mut DescribeScope>`; `:1846` `pub next: Option<*mut ExecutionEntry>`; `shell/IO.rs:88`; `server/RequestContext.rs:121,135,178`.

**Fix:** Mechanical sweep to `Option<NonNull<T>>` only — niche-optimized to pointer size, still `Copy`, single null state. Do **not** attempt `Option<&'a T>` / `Option<Box<T>>` as a sweep: most sites are intrusive linked lists, parent backrefs, and self-referential graphs where Rust lifetimes can't be expressed without restructuring. Treat references/Box as opportunistic per-site follow-ups (e.g. `RequestContext.defer_deinit_until_callback_completes` per its own TODO). Add a PORTING.md note so new Zig `?*T` translations go straight to `Option<NonNull<T>>`.

**Perf cost:** Net win — halves field size 16→8 bytes, no allocation, no indirection. `NonNull` is `#[repr(transparent)]`.

**Verify notes:** ~648-651 sites repo-wide. Variance difference (`NonNull<T>` covariant vs `*mut T` invariant) is irrelevant for concrete-typed backrefs.

---

### 5. `pub` on every field including raw-pointer internals — ~250 instances [maintainability]

**What:** Zig has no privacy so everything was ported `pub`, including `*mut Parser`, `*mut Log`, `*const [Enc::Unit]` as public fields.

**Why it's wrong:** Exposing `*mut Parser` and `*mut Log` as public fields/accessors means every SAFETY comment in the crate is unenforceable — any downstream crate can write `builder.parser = ptr::null_mut()` or call `log_ptr()` and alias. `#![warn(unreachable_pub)]` is set in `lib.rs` but suppressed by blanket `pub mod` re-exports.

**Example:** `src/interchange/yaml.rs:848` `pub parser: *mut Parser<'a,Enc>`; `:1097`, `:1837` `pub input: *const [Enc::Unit]`; `json_lexer.rs:305` `pub fn log_ptr(&self) -> *mut Log`. 406 `pub` occurrences crate-wide.

**Fix:** Do **not** blanket-privatize all 406. Targeted: (1) raw-pointer fields → drop `pub`, keep the existing `pub(crate)` accessors (`yaml.rs:857-863` already has `parser()`/`parser_mut()`); (2) internal helper structs never named outside the crate → `pub(crate)`; (3) `log_ptr()` → `pub(crate)`; (4) change `pub mod` → `mod` + explicit `pub use` re-exports in `lib.rs` so `unreachable_pub` actually fires going forward; (5) for `Stream.input`, replace `*const [Enc::Unit]` with `&'a [Enc::Unit]` per the existing `// TODO(port): lifetime` comment rather than just hiding it.

**Perf cost:** None. Visibility is compile-time only.

**Verify notes:** Schedule after the active phase-D/E ungate workflows quiesce to avoid 30-way merge conflicts. Leave `pub` on plain-data value types (`TokenInit`, `Pos`, `NodeTag`, `Directive`, `Document`).

---

### 6. Port-tracking metadata embedded in source — ~227 instances in bun_sql, ~9k lines repo-wide [maintainability]

**What:** Every `.rs` file ends with a 7-line `// ─── PORT STATUS ─── confidence: medium … todos: 3 …` block; 30× identical `// TODO(port): narrow error set`; 15× identical `DecoderWrap` design-debate essays describing an already-solved problem.

**Why it's wrong:** ~3% of the crate is migration bookkeeping. The PORT STATUS footers are out of date (e.g. `AnyPostgresError.rs:129` says "`&'static` placeholder" but the code already has `<'a>`). The repeated `DecoderWrap`/`WriteWrap` TODOs all describe the same decision that was already made (the `Decode` trait at `mysql/NewReader.rs:187`). Changelog-in-source actively misleads readers about what's still broken.

**Example:** `src/sql/postgres/CopyData.rs:26`, `NoticeResponse.rs:31`, `SSLRequest.rs:67`, `StartupMessage.rs:68`; `src/sql/lib.rs:3`.

**Fix:** Three tiers: (1) PORT STATUS footers — reduce each 7-line block to a single `// ported from: <zig path>` provenance line (the one piece that doesn't rot), repo-wide `sed` pass over 1303 files; (2) collapse each `DecoderWrap`/`WriteWrap` essay to one line pointing at `decoder_wrap.rs`; (3) keep `// TODO(port): narrow error set` per-site (each fn's error set narrows independently) but the `B-2: module tree fully wired in` done-stamps go.

**Perf cost:** None. Comments only; binary byte-identical.

**Verify notes:** Reviewers disagreed on whether to delete footers wholesale or keep the provenance line; both agreed `confidence`/`todos`/`notes` are the rotting parts. The genuine open questions (`u24` wire encoding, `free_sensitive`) stay as inline TODOs co-located with the affected field.

---

### 7. Struct fields are `*mut T` with the lifetime explained in prose — ~199 instances [maintainability]

**What:** `Resolver<'a> { fs: *mut FileSystem, log: *mut Log, dir_cache: *mut DirInfo::HashMap, extension_order: *const [Box<[u8]>] }` with 380+ PORT NOTE/SAFETY essays, then `unsafe { &mut *r.fs() }` at ~199 sites.

**Why it's wrong:** Ownership is encoded in comments instead of types. Every read of `fs`/`log`/`dir_cache` is an `unsafe` block whose correctness depends on a global mutex the type system can't see. `extension_order: *const [Box<[u8]>]` self-references `self.opts` — a hand-rolled self-referential struct with no `Pin`.

**Example:** `src/resolver/lib.rs:4358-4460`; `package_json.rs:942` `let r_fs: &mut FileSystem = unsafe { &mut *r.fs() }; let r_log: &mut Log = unsafe { &mut *r.log() };`.

**Fix:** Do **not** push `Mutex`/`RwLock`/`DashMap` into `FileSystem`/`Log`/`dir_cache` — the outer `Resolver::mutex` already serializes everything and per-field locking is a documented ~2× regression on the React-admin bundler benchmark (`lib.rs:4432-4447`). Instead: (a) finish the accessor sweep — add `fs_mut(&mut self) -> &mut FileSystem` alongside the existing `log_mut`/`dir_cache_mut` (`lib.rs:4596,4629`) and replace ~200 open-coded derefs; (b) replace `extension_order: *const [_]` with a `Copy` enum tag `{ DefaultDefault, DefaultEsm, NodeModules*, Css }` + `fn extension_order(&self) -> &[Box<[u8]>]` matching into `self.opts` — kills the self-reference at zero cost; (c) long-term, store `fs`/`dir_cache` as `&'static SyncUnsafeCell<T>` with one `unsafe fn get_mut()` whose safety doc says "caller holds resolver mutex" (optionally taking a `&mut ResolverMutexGuard` witness token).

**Perf cost:** None for the corrected fix. The originally-proposed `DashMap`/`Mutex<RealFS>` would have been a measurable regression.

**Verify notes:** Both reviewers independently flagged the original `RwLock`/`DashMap` proposal as a benchmark regression and converged on accessor-sweep + enum-tag for `extension_order`.

---

### 8. `pub` on every field including `ref_count`, `UnsafeCell`, and self-referential buffers — ~184 instances [maintainability]

**What:** Every one of 30+ `PostgresSQLConnection` fields is `pub`, including `pub ref_count: Cell<u32>`, `pub read_buffer: UnsafeCell<OffsetByteList>`, and `pub options_buf` whose self-referential `*const [u8]` slices point into it.

**Why it's wrong:** External code can set `ref_count` to 0, swap the `UnsafeCell` while a `Reader` aliases it, or reassign `options_buf` (instant UAF — five `*const [u8]` siblings point into it). Every SAFETY comment in the file is unenforceable.

**Example:** `src/sql_jsc/postgres/PostgresSQLConnection.rs:86-158`.

**Fix:** Do **not** sweep all 184. Target only the ~8-10 invariant-bearing fields per struct: (1) `ref_count` → drop `pub` (the `impl_cell_ref_counted!` macro already exposes `incref`/`deref`; the two construction-time `Cell::new(2)` sites become a `with_ref_count(n)` ctor); (2) `read_buffer: UnsafeCell<_>` + `last_message_start: Cell<u32>` → drop `pub` (only touched in-file); (3) `options_buf` and the five self-referential slices → drop `pub` (accessors `database()`/`user()`/`password()`/`path()`/`options()` already exist at `:213-241`); (4) for the cross-crate `container_of!` in `runtime/dispatch.rs`, expose `pub fn from_timer_ptr(*mut EventLoopTimer) -> *mut Self` instead of keeping `timer` field-public. Leave FFI handles and plain-state fields `pub`.

**Perf cost:** None. `#[inline]` accessors compile to the same field load.

**Verify notes:** Net diff is ~12 `pub` removals + 1 ctor per refcounted type, zero new accessor boilerplate. Skip `#[doc(hidden)] pub fn __field_mut()` ceremony — this is an internal binary crate.

---

## 2. Refuted (looked like problems, aren't)

These were flagged by the initial sweep but **rejected** by adversarial review as context-blind, factually wrong, or contradicting documented port policy. Do not action them as codebase-wide sweeps.

| Pattern | Crate(s) | Why refuted |
|---|---|---|
| `unsafe { &mut *ptr }` at every read site instead of typing the param as a reference once | bun_runtime (1924 sites) | Proposed fix is **banned** by `PORTING.md:725-745` ("hold `*mut T` and deref per-access; don't bind `let vm = &mut *get()` across calls"). Threading `&'a mut VirtualMachine` through re-entrant hooks *creates* the overlapping-`&mut` UB the finding warns about. `JSValue::as_<T>() -> *mut T` returns raw deliberately (no lifetime to anchor a `&mut` to a GC-heap cell). The "overlapping &mut" claim was a misread (`vm_ref.global` is a separate heap allocation). Real fix is field-level `Cell`/`UnsafeCell` on the singletons — already targeted by `phase-f-accessor-sweep`. |
| Zero encapsulation: every `PackageManager` field `pub`, free fns instead of methods | bun_install (1600) | "No methods" is false — every cited file already has an `impl PackageManager { #[inline] fn ...(&mut self) }` facade. Proposed `lockfile_mut()`/`options()` accessors **break** field-disjoint borrows (the reviewer had borrowck backwards). All-`pub` is documented Phase-A `.zig`-diff parity; `phase-f-accessor-sweep` is the scheduled cleanup. |
| Zero encapsulation: `pub` raw-pointer fields in bundler | bun_bundler (1300) | `options.rs:1875 pub log: *mut Log` already has `log()`/`log_mut()` accessors with SAFETY docs at `:2014-2028`. Proposed `fn log(&mut self) -> &mut Log` would alias the `*mut` held by Transpiler/Resolver/Linker — actively unsound. Scheduled as `phase-f-accessor-sweep`. |
| C-style `this: *mut Self` instead of `&mut self` | bun_runtime (539) | All four cited examples are self-freeing (`Box::from_raw(this)`), reentrant-aliased (lol-html callback writes through the same allocation mid-call), or pointer-identity-returning. `&mut self` there is Stacked-Borrows UB. `PORTING.md:625` mandates `extern fn(*mut Self)` for `.classes.ts` finalize. Real fix is the `bun_ptr::IntrusiveRc<T>` migration (312 TODO refs). |
| Crate-wide `#![allow(clippy::all)]` + `init()` ctors + all-`pub` fields | bun_js_printer (420), bun_options_types (308), bun_string (200) | `PORTING.md:33` mandates "same fn names, same field order — Phase B reviewers diff `.zig` ↔ `.rs` side-by-side". `pub(crate)` would break compilation in `bun_bundler` (cross-crate field access). The blanket allow appears in 77 crate roots as port-wide policy. `WTFStringImplStruct` is a `#[repr(C)]` FFI mirror (bindgen convention). `schema.rs` is peechy-generated wire format. Defer to post-port. |
| Parallel `eql`/`hash`/`deep_clone` trait universe | bun_css (400) | `CSSNumber = f32` and `f32: !Hash + !Eq`, so `#[derive(Eq, Hash)]` does not compile on the bulk of the crate. `Ident { v: *const [u8] }` — `derive(PartialEq)` would compare pointer identity, hand `eql` compares arena bytes. `DeepClone<'bump>` reallocates into a *target arena*; `Clone` has no allocator param. Derive macros already exist (`bun_css_derive`). Only legitimate cleanup: delete the ~26 free-fn shims. |
| `init()`/`deinit()` instead of `new()`/`Drop` | bun_runtime (210) | Headline cite (`NodeHTTPResponse.rs` "both deinit() AND Drop → double-free") is a grep hit on a **comment**. Zero files have both `pub fn deinit` and `impl Drop` for the same type. `PORTING.md:44-45,146-147` already mandates exactly the proposed rule. `init` naming is intentional `.zig`-grep parity. |
| `pub` on every field + `init()` (bun_md) | bun_md (300) — *split 1-1* | `parser.rs:170` is *private* `fn init`. Zero external field access (only `bun_md::root::render_to_html` is used). The `pub` is structurally required: `impl Parser` is split across 8 sibling modules. Valid 5-min hygiene: `pub` → `pub(crate)` + `mod` instead of `pub mod` in lib.rs; not a sweep. |
| Zig surface transliteration (`LineColumnOffsetOptional`, `ParseResult`, `init()`) | bun_sourcemap (300) — *split 1-1* | `impl Parse/ToCss for f32` already exist; `LineColumnOffsetOptional` is a behavioral type (`.advance()` no-ops on Null = "tracking disabled"). `ParseResult` → `Result` is a valid 15-line localized change but not the bundled sweep. |
| `XxxFns` namespace modules instead of trait impls | bun_css (198) — *split 1-1* | Central claim factually wrong: `generics.rs:1268-1400` already has `impl Parse for f32`/`impl ToCss for f32` etc. forwarding to the Fns bodies. Generic dispatch works today. `CssString = *const [u8]` cannot have inherent methods. Cosmetic cleanup deferrable to post-port. |

---

## 3. Appendix: per-crate raw findings

Unverified candidates surfaced by the initial sweep (not 2-vote reviewed). Included for completeness; treat as leads, not conclusions.

- **bun_sql_jsc** — Manual intrusive refcount: `ref_count: Cell<u32>` + `deref(&mut self)` that frees its own backing Box (Stacked Borrows protector violation). 6 types, ~155 `.ref_()`/`.deref()` sites. `PostgresSQLQuery.rs:131-165`. *Candidate fix:* `bun_ptr::IntrusiveRc<T>` smart pointer.
- **bun_sql_jsc** — 152 stale `TODO(b2-blocked)` markers on already-shipping code; `.zig` siblings still in-tree. `mysql.rs:67-83`.
- **bun_options_types** — `Box<[u8]>` / `Vec<Box<[u8]>>` as universal string type (147 occ). Heap-allocates literal defaults. *Candidate fix:* `Cow<'static, [u8]>`.
- **bun_install** — Error → print → `Global::crash()` instead of `Result` propagation (~70 sites in library code reused by auto-installer). `hoisted_install.rs:195-202`.
- **bun_resolver** — Porting scaffolding (`__phase_a_body`, `__forward_decls`, crate-name shadow modules, blanket `#![allow]`) left in tree. `lib.rs:2-6,3105,3188,3199-3320`.
- **bun_js_parser** — 93× `.expect("oom")` / `.expect("unreachable")` on infallible-in-Rust ops (`VecExt::append`). Zig `catch unreachable` translit. `ast/P.rs:2984`.
- **bun_bundler** — Fake `&'static [u8]` fields for arena-borrowed data. `Chunk.rs:47-83` `pub unique_key: &'static [u8]`, `final_rel_path`, `metafile_chunk_json`.
