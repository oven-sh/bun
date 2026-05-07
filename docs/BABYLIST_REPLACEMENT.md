# `BabyList<T>` Replacement Plan

Repo: `/root/bun-5` @ `claude/phase-a-port` (HEAD `1048a9cba13`)
Ref: `docs/RUST_PATTERNS.md` §11

---

## Top-line numbers

| Metric | Count |
|---|---|
| `grep -rn 'BabyList<' src/ --include='*.rs'` | **272** |
| …minus definition file (`baby_list.rs`) | **257** use sites |
| `ByteList` alias (= `BabyList<u8>`) | **+204** |
| Type aliases (`ExprNodeList`/`PropertyList`/`DeclList`/`PartList`/`symbol::List`) | **+293** |
| **Effective total surface** | **~754** |

---

## Does C++ read the layout?

**No.** `cpp_reads_layout = false`.

- `grep -rn 'BabyList\|ByteList\|baby_list' src/**/*.{cpp,h,hpp,mm,c}` → **0 hits**
- `grep -rn 'BabyList\|ByteList\|baby_list' src/jsc/bindings/` → **0 hits**
- No `extern "C"` fn signatures mention `BabyList`/`ByteList`
- No `#[no_mangle]` fn signatures mention `BabyList`/`ByteList`
- Remaining `.zig` shims (`main.zig`, `jsc_stub.zig`, `main_test.zig`) → **0 hits**
- `src/codegen/` → **0 hits** (only mention is a string literal in `css/properties/generate_properties.ts` mapping Zig type names → Rust)

The `#[repr(C)]` on `BabyList` (`src/collections/baby_list.rs:27`) is **vestigial** from the Zig port. The two comments claiming `#[repr(C)] ptr+len+cap` matters (`src/string/SmolStr.rs:117`, `src/jsc/JSONLineBuffer.rs:1`) are about Rust↔Rust field-order assumptions for `into_raw_parts`-style transmutes, not FFI — they survive a switch to `Vec<T>`.

**→ Category 1 (FFI-shared) is empty. No `BabyListView<T>` newtype is needed. BabyList can be deleted entirely.**

---

## Allocator reality check (affects category targets)

`src/bun_alloc/lib.rs:155-158`:
```rust
pub type Arena = bumpalo::Bump;
pub type MimallocArena = bumpalo::Bump; // legacy alias
pub type ArenaVec<'bump, T> = bumpalo::collections::Vec<'bump, T>;
```

The port **already replaced** Zig's per-heap mimalloc arena with `bumpalo::Bump`. Bumpalo cannot free individual allocations, so `bumpalo::Vec` **leaks the old buffer on every grow**. There is currently **no `Allocator`-trait impl for a mimalloc heap** in `bun_alloc` (the `impl Allocator for ...` hits are all marker no-ops on `MaxHeapAllocator`/`Zone`/`CAllocator`, not `core::alloc::Allocator`).

This is *why* `BabyList` grew the `origin` field: arena-backed buffers cannot be passed to `Vec::from_raw_parts` for growth, so `transfer_ownership()` (`src/collections/baby_list.rs:786`) does a **full copy** into a fresh global allocation. Commit `3746cc3f093` added this.

**Consequence for category targets:**
- "Growable, arena-scoped → `Vec<T, ArenaAlloc>`" requires **new work**: a `core::alloc::Allocator` impl over `mi_heap_t` (or accept bumpalo's leak-on-grow for short-lived linker scratch).
- Alternatively, the "either" types can skip the arena entirely and go straight to `Vec<T>` from the parser — the `transfer_ownership` copy already pays the alloc cost; doing it eagerly is no worse.

---

## Categorization of the 257 `BabyList<` use sites

### Cat 1 — FFI-shared: **0**

None. See above.

---

### Cat 2 — Allocate-once-then-freeze (arena): **~25** direct + **255** via alias

**Target:** `&'arena [T]` (or `&'arena mut [T]`). Build with `bumpalo::collections::Vec<'arena, T>` → `.into_bump_slice()`. No `Drop`, no `origin`, lifetime-checked.

**What:** AST-node interior fields. Filled during parse via `from_bump_slice(v.into_bump_slice_mut())`, never grown afterward (the `from_bump_slice` doc *forbids* growth: `src/collections/baby_list.rs:200`).

**Element types:** `Expr` (12), `Property` (4), `Stmt` (3), `Decl` (1), `Ref` (1), `NonNull<Scope>` (2), `Decorator` (1), `&'static [u8]` (2).

**Type aliases (the real volume):** `ExprNodeList` (143), `PropertyList` (54), `DeclList` (58) = **255** alias uses.

**Examples:**
1. `src/js_parser/ast/G.rs:28` — `pub type DeclList = BabyList<Decl>;` + `:147 stmts: BabyList<Stmt>` + `:184 PropertyList = BabyList<Property>`
2. `src/logger/js_ast.rs:715` — `pub type ExprNodeList = BabyList<Expr>;`
3. `src/js_parser/ast/P.rs:6116` — `let full_items = unsafe { ExprNodeList::from_bump_slice(full.into_bump_slice_mut()) };` (representative of 52 `from_bump_slice` calls in `js_parser/`)

**Appended-to after fill?** No. All construction sites are `from_bump_slice` of a finalized `bumpalo::Vec`. The one near-miss is `src/js_parser/ast/visit.rs:1777` (`prev_local.decls.transfer_ownership()` → then append) — that single site promotes a `DeclList` to owned for one merge; can become `let mut v: Vec<Decl> = decls.iter().cloned().collect(); v.push(...)` or rebuild in arena.

**Effort:** **Architectural, then mechanical.** Threading `'arena` through `Expr`/`Stmt`/`G::*` is the same lifetime work already scheduled in RUST_PATTERNS §6 ("thread `'bump` through AST"). Once `<'arena>` is on the leaf types, this is a regex sweep: `BabyList<X>` → `&'arena [X]`, delete 52 `unsafe { from_bump_slice(...) }` wrappers (replace with `.into_bump_slice()`). ~2 days for js_parser, blocks on §6.

---

### Cat 3 — Growable, globally-owned: **~167** direct + **204** `ByteList`

**Target:** `Vec<T>` (or `Vec<u8>` / `bytes::BytesMut` for `ByteList`).

**What:** Everything outside the parser arena. Created via `BabyList::default()` / `init_capacity()` / `move_from_list()` / `from_slice()`, grown with `.append()`, dropped normally. The `origin` field is always `Owned` — pure overhead.

**Crates with zero arena-constructor calls** (verified `from_bump_slice|init_capacity_in` = 0): `css/`, `runtime/`, `sql/`, `sourcemap/`, `http/`, `io/`, `shell_parser/`, `install/`, `interchange/`, `resolver/`, `ini/`, `string/`.

**Element types:** `u8` (24+204), generic `T` (23, css helpers), `AdditionalFile` (12), `LayerName` (12), `CssImportOrder` (8), `FontFamily` (8), `Index` (6), `u32` (8), `i32` (6), `ImportConditions` (~5 owned), `SmallList<T,1>` (4), `CustomIdentList` (2), `Box<[u8]>` (2), `NameStr` (3), `SSLConfig` (2), and ~25 singletons (`Field`, `Composes`, `TrackSize`, `Chunk`, `OutputPiece`, `ChunkImport`, `CrossChunkImportItem`, `DuplicateEntry`, `PendingImport`, `FSEventsWatcher`, …).

**Examples:**
1. `src/css/css_parser.rs:854,2384,2477` — `layer_names: BabyList<LayerName>`, `composes: BabyList<Composes>`. CSS parser uses global allocator only.
2. `src/bundler/Chunk.rs` (16 sites) — `cross_chunk_suffix_stmts: BabyList<Stmt>`, `BabyList<OutputPiece>`, `BabyList<ChunkImport>`. Linker-phase, globally allocated, appended in `computeCrossChunkDependencies.rs:552,626,632`.
3. `src/runtime/webcore/streams.rs` + `Sink.rs` + `FileReader.rs` + `ArrayBufferSink.rs` (~60 `ByteList`) — I/O byte buffers. Straight `Vec<u8>`.

**Sub-pattern — `from_borrowed_slice_dangerous` (30 sites):** wraps a caller-owned `&[u8]`/`&[T]` as `ManuallyDrop<BabyList>` purely to satisfy a `BabyList`-typed parameter. The docstring (`baby_list.rs:704-724`) literally says "change the param to a slice instead". These vanish when the receiving fn takes `&[T]`:
- `src/runtime/webcore/Sink.rs` (10), `FileReader.rs` (5), `fetch/FetchTasklet.rs` (4), `s3/client.rs` (2), `html_rewriter.rs` (1), `RequestContext.rs` (1) — all `&[u8]` → sink
- `src/js_printer/lib.rs:7007-7009`, `src/bundler/LinkerGraph.rs:615`, `generateCompileResultForCssChunk.rs:207`, `Ast.rs:189`

**Appended-to after fill?** Yes — these are growable by nature. `Vec<T>` is the exact fit.

**Effort:** **Mechanical.** `BabyList<T>` → `Vec<T>`, `.append()` → `.push()`, `.append_slice()` → `.extend_from_slice()`, `.slice()` → `.as_slice()` / deref, `.init_capacity(n)?` → `Vec::with_capacity(n)`, `.move_from_list(v)` → `v`, `.clear_and_free()` → `*x = Vec::new()`. ~370 sites, regex-able with a small method-map. `ByteList` write helpers (`write_latin1`/`write_utf16`/`append_fmt`) move to a `trait ByteVecExt for Vec<u8>`. ~1 day for css+runtime+misc, ~0.5 day for bundler-owned.

---

### Cat 4 — "Either" (arena → owned via `transfer_ownership`): **~65** direct + **38** via alias

**Target:** **`Vec<T>` from the start** (skip the arena round-trip). Secondary option: `Vec<T, MiHeapAlloc>` if a `core::alloc::Allocator` impl over `mi_heap_t` is added — but see "is the transfer needed?" below.

**What:** The four `Ast` SoA columns that the parser fills and the linker then **grows**: `import_records`, `parts`, `symbols`, `part.dependencies`. Built arena-backed in `P::to_ast` (`src/js_parser/ast/P.rs:7622-7627` via `from_bump_slice`), then **copied** to global heap in `LinkerGraph` (`src/bundler/LinkerGraph.rs:736-745` `transfer_ownership()`), then appended (`LinkerGraph.rs:217 parts.append`, `scanImportsAndExports.rs:741-756 part.dependencies.append`, `HTMLScanner.rs:89 import_records.append`).

**Element types:** `ImportRecord` (~46), `Part` (9), `Symbol` (~11), `Dependency` (3), `ImportData` (2).

**Type aliases:** `PartList` (18), `symbol::List`/`NestedList` (20) = **38** alias uses.

**Examples:**
1. `src/js_parser/ast/P.rs:148-156` `move_to_baby_list()` — builds `BabyList<ImportRecord>` from `BumpVec` (arena) **or** `Vec` (scan-only). Already an enum-at-construction.
2. `src/bundler/LinkerGraph.rs:736-745` — `import_records.transfer_ownership(); parts.transfer_ownership(); part.dependencies.transfer_ownership(); symbols.transfer_ownership();`
3. `src/bundler/LinkerContext.rs:715-716,2115-2116,2209-2210` — `&[BabyList<Part>]` / `&[BabyList<ImportRecord>]` SoA column access (read-only slices over the now-owned lists).

**Is the transfer actually needed?** The parser builds these in `bumpalo::Vec<'bump>`, leaks to `&'bump mut [T]`, wraps as `BabyList` → linker copies to `Vec`. The arena step buys nothing: the data is **always** copied out (`transfer_ownership` is unconditional in `LinkerGraph::load`). Replacing with "parser fills a plain `Vec<T>` directly" eliminates one full copy of every `ImportRecord`/`Part`/`Symbol`/`Dependency` per file. The only reason it's arena-backed today is that `P.import_records` is `BumpVec<'a, ImportRecord>` for uniformity with other parser scratch — but `P.rs:112` already has `enum { Owned(BumpVec), Borrowed(&mut Vec) }`, so the owned variant can become `Vec<ImportRecord>` with zero structural change.

**Appended-to after fill?** **Yes** — that's the whole point of `transfer_ownership`. Cannot use `&'arena [T]`. Cannot use `bumpalo::Vec` (would leak on every linker append).

**Effort:** **Per-site judgment, ~1 day.** Four types, ~10 construction sites in `P::to_ast`/`AstBuilder`, ~5 `transfer_ownership` calls to delete, ~65 type mentions become `Vec<T>`. The `&[BabyList<ImportRecord>]` SoA accessors (`Graph.rs`, `LinkerContext.rs`) become `&[Vec<ImportRecord>]` — same shape, mechanical.

---

## Ancillary surfaces to update

- `src/css/small_list.rs:226,260` — `SmallList::from_baby_list[_no_deinit]` → `from_vec`
- `src/css/generics.rs` (10) — `DeepClone`/`Parse`/`ToCss` blanket impls for `BabyList<T>` → re-target to `Vec<T>` (or `[T]` for the read-only ones)
- `src/css_derive/lib.rs` — derive macro emits `BabyList` paths
- `src/css/properties/generate_properties.ts:208,1293` — codegen string `"BabyList("` → `"Vec<"`
- `src/string/SmolStr.rs:117` (10 sites) — `SmolStr::from(BabyList<u8>)` → `from(Vec<u8>)`
- `src/meta/lib.rs` — `looksLikeListContainerType` heuristic (referenced in `baby_list.rs:30` comment)
- `src/collections/pool.rs` — `Pool<ByteList>` → `Pool<Vec<u8>>`
- `src/collections/baby_list.rs:971-1010` — `ByteList` + `OffsetByteList` newtypes; `OffsetByteList` becomes `{ head: u32, list: Vec<u8> }`

---

## Recommendation

**Delete `BabyList<T>` entirely.** No FFI consumer exists; the `#[repr(C)]` is dead weight; the `origin` field defeats the original 16-byte goal (struct is 24B in release with padding — same as `Vec`, plus a drop branch).

**No "really good Rust list library" is needed** — `std::vec::Vec<T>` covers cat 3 + cat 4 (the 88% case), and `&'arena [T]` covers cat 2. `bumpalo::collections::Vec` is only needed as the *builder* for cat 2 (already in tree as `bun_alloc::ArenaVec`). `thin-vec`/`smallvec` are not warranted: the 16B-vs-24B win mattered in Zig because `ArrayList` carried an allocator pointer; Rust `Vec` is already 24B and the AST fields become 16B `&[T]` fat pointers — *smaller* than current BabyList.

**Sequencing:**
1. **Cat 3 first** (mechanical, no lifetime threading, ~370 sites, ~1.5 days). Unblocks deletion of `ByteList`, `from_borrowed_slice_dangerous`, `OffsetByteList`.
2. **Cat 4 next** (~100 sites incl. aliases, ~1 day). Delete `transfer_ownership`, `origin`, `shallow_copy`. Net perf win (one fewer copy per parsed file).
3. **Cat 2 last** (~280 sites incl. aliases, ~2 days). Gated on `'arena` threading (RUST_PATTERNS §6). Delete `from_bump_slice`, `init_capacity_in`.
4. `rm src/collections/baby_list.rs`.

**Optional (only if profiling shows linker-scratch alloc pressure after step 2):** add `struct MiHeapAlloc(mi_heap_t*); unsafe impl core::alloc::Allocator for MiHeapAlloc` in `bun_alloc` and use `Vec<T, MiHeapAlloc>` for linker-phase scratch — restores Zig's per-heap-free semantics without bespoke list code.

---

## Summary table

| Category | `BabyList<` sites | + aliases | Target | Grows post-fill? | Effort |
|---|---|---|---|---|---|
| 1. FFI-shared | **0** | — | — | — | — |
| 2. Arena/freeze | ~25 | +255 | `&'arena [T]` | No | 2d (gated on §6) |
| 3. Owned | ~167 | +204 `ByteList` | `Vec<T>` | Yes | 1.5d mechanical |
| 4. Either | ~65 | +38 | `Vec<T>` (skip arena) | Yes | 1d |
| **Total** | **257** | **+497** | | | **~4.5d** |
