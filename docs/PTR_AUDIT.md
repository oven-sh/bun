# `ptr::` / `mem::` low-level operation audit

**Round 1** — survey of every site where the Rust port reaches for raw `ptr::`
/ `mem::` machinery to compensate for an ownership/lifetime design that Zig
expressed natively (no destructors, bitwise struct copy, `undefined` fields).

The motivating bug class is **95866a507c9f**: `clone_for_worker` bitwise-copied
a `Transpiler` (Drop-carrying), then plain `t.field = …` ran `Drop` on the
*aliased* old value, destroying the parent's `MimallocArena` heap.

| pattern | count | audited | unsound | hardened R1 |
|---|--:|--:|--:|--:|
| #1 `ptr::copy_nonoverlapping` (Drop-carrying) | 83 | 83 | 0 | 2 |
| #2 `ptr::write` to skip Drop | 98 | spot | 0 | — |
| #3 `ptr::read` move-out | 135 | spot | 0 | — |
| #4 `mem::forget` / `ManuallyDrop` | 84 / 261 | spot | 0 | — |
| #5 `MaybeUninit` struct fields | 18 | 18 | 0 | — |
| #6 `<'static>` erasure on borrowed | ~570 | spot | — | — |
| #7 `detach_lifetime`/`erase_lifetime` | 142 | spot | — | — |

"Hardened" = sound today but one invariant-change away from the bug class;
fixed defensively this round (see §Fixes).

---

## Class #1 — `ptr::copy_nonoverlapping` of a Drop-carrying type

The hazard: bitwise-copy a struct with owned fields, then either (a) reassign a
field on the copy with plain `=` (drops aliased data) or (b) let the source
drop normally (double-free).

### Per-site classification

| file:line | element type | classification | notes |
|---|---|---|---|
| `bundler/transpiler.rs:528` `clone_for_worker` | `Transpiler<'a>` | **sound** (caller invariant) | Writes into `MaybeUninit` (no Drop on dest). All post-clone field writes in `ThreadPool.rs:initialize_transpiler` go through `ptr::write` or are `Copy` (`set_log`/`set_arena`/`resolver.fs` all raw-ptr). Caller invariant documented in 048eed576f16. |
| `bundler/ThreadPool.rs:681,685` (`ptr::write` post-clone) | `Option<MacroContext>`, `cache::Set` | **sound** (band-aid #2) | The deliberate `ptr::write` band-aid. **Recommendation**: replace `clone_for_worker`'s bitwise copy with a per-field constructor that takes the parent's shared bits as `&` / `*const` and builds owned per-worker state directly — eliminates the band-aid. Round-2 candidate. |
| `runtime/bake/DevServer.rs:760` | `MaybeUninit<Transpiler<'static>>` | **suspicious** | When `!separate_ssr_graph`, bitwise-aliases `server_transpiler` into `ssr_transpiler`. The alias is never field-reassigned (line 800-801 are gated on `separate_ssr_graph`). It IS unconditionally `assume_init_mut()`'d at line 2977 to feed `BakeOptions.ssr_transpiler`, but `BundleV2::transpiler_for_target` only dereferences it for `Target::BakeServerComponentsSsr`, which is unreachable when `!separate_ssr_graph`. **Diverges from Zig**: zig passed `&server_transpiler` (same pointer); Rust passes a stale bitwise copy. **Recommendation**: store `separate_ssr_graph` on `DevServer` and pass `NonNull::from(server_transpiler)` at the `BakeOptions` construction site instead of materializing a second `Transpiler` value. Removes the `copy_nonoverlapping`. |
| `bundler/linker_context/generateCodeForFileInChunkJS.rs:400` | `G::Property` (embeds `Vec<Expr>`) | **sound** (invariant) → **hardened R1** | Bitwise-copies JSON object properties, then loop reassigns `*prop = G::Property { … }` (line 439) — runs Drop on aliased `prop.ts_decorators`. Invariant: JSON properties have empty `ts_decorators` so the drop is a no-op. **Fixed R1**: reassignment now uses `ptr::write` so the invariant is enforced structurally (matches the ThreadPool pattern). |
| `bundler/linker_context/findImportedFilesInCSSOrder.rs:36` `bitwise_copy<T>` + `:68` `memcpy_and_reset` | `CssImportOrder`, `Vec<ImportConditions>`, `Vec<ImportRecord>` | **sound** (no-op Drop) | Entire pass is a Zig-style bitwise shuffle. `Drop for CssImportOrder` (`Chunk.rs:1160`) `mem::forget`s both vecs *because* they are bitwise-shared across entries. `memcpy_and_reset` overwrites `order`'s old elements without Drop and `set_len(0)`s `wip` without Drop — both legal because element Drop is a no-op. **Recommendation**: replace `Vec<ImportConditions>` / `Vec<ImportRecord>` with `bun_ptr::RawSlice` (non-owning view) so the type system captures the "shared, never freed" intent and the custom `Drop` + `forget` go away. Round-2. |
| `bundler/LinkerGraph.rs:708` | `Symbol` | **sound** | `Symbol` has no `Drop` (comment-asserted; all fields are POD/index). |
| `collections/vec_ext.rs:166` `from_bump_slice` | generic `T` | **API-unsound** → **hardened R1** | Safe `fn` that bitwise-moves out of a `&mut [T]` borrow. All 40+ callers pass leaked bump-arena slices (`into_bump_slice_mut()` / `alloc_slice_*`) so no double-drop occurs in practice; element types in use (`ImportRecord`, `Expr`, `Stmt`, `G::Decl`, `G::Property`, `Part`, `Symbol`) either have no Drop or are arena-backed and never element-dropped at the source. **Fixed R1**: now `unsafe fn` with documented "leaked bump slice" contract. Next caller that passes `vec.as_mut_slice()` will be forced to read the `# Safety` doc instead of silently double-dropping. |
| `collections/multi_array_list.rs:631,654,889,908,954,996,1061,1089` | column bytes (`*mut u8`) | **sound** | Column-major byte moves; element Drop is the caller's responsibility (`MultiArrayList` is documented no-Drop-elements, matching `std.MultiArrayList`). |
| `collections/linear_fifo.rs:174,300,302,363` | `MaybeUninit<T>` | **sound** | Buffer is `Box<[MaybeUninit<T>]>`; old buffer drop never runs element destructors. Ring-buffer rotation. |
| `css/small_list.rs:100,176,216,245,331,447,502,651,720,740,796` | generic `T` | **sound** | Inline↔heap moves; every site either has `T: Copy` bound (`shallow_clone`/`clone`, lines 447/502) or pairs the move with `set_len(0)` / `mem::forget` on the source so ownership transfers exactly once. `clear_retaining_capacity` is documented no-element-Drop. |
| `js_parser/ast/Parser.rs:2140,2147` | `js_ast::Part` | **sound** | Explicit move-semantics: `before.set_len(0)` / `after.set_len(0)` *before* committing `parts.set_len(...)`. Comment block already documents the double-free window avoidance. |
| `js_parser/ast/ConvertESMExportsForHmr.rs:464,469,667` | `ClauseItem`, `G::Property` | **sound** | Paired with `set_len(0)` on the source (`export_star_props.set_len(0)`); `ClauseItem` is POD. |
| `js_parser/ast/ImportScanner.rs:232` | `ClauseItem` | **sound** | In-place compaction; `ClauseItem` is POD (arena-owned, no Drop). |
| `js_parser/ast/visit.rs:442` | `G::Decl` | **sound** | In-place compaction within a `&mut [Decl]`; tail elements are abandoned-in-arena (no Drop). |
| `js_parser/ast/foldStringAddition.rs:134-135` | `e::TemplatePart` | **sound** | POD-shaped; both source slices are arena-owned (never element-dropped). |
| `jsc/bindgen.rs:303,317` | `ExternType` bytes | **sound** | In-place layout repack inside a `ManuallyDrop<Vec>`; never double-dropped. |
| `bun_alloc/lib.rs:946,2395` · `MimallocArena.rs:306` · `picohttp/lib.rs:62` · `string/StringBuilder.rs:96` · `string/immutable/escapeHTML.rs:43` · `js_printer/lib.rs:277,1784` · `bun_core/util.rs:1073,2460` · `install/lockfile.rs:2562,2589,3023,3058` · `install/PackageManager.rs:1476` · `install/windows-shim/bun_shim_impl.rs:*` · `sys/lib.rs:6048,7265` · `sys/windows/mod.rs:4643,4837` · `runtime/node/path.rs:2458,2613` · `runtime/node/types.rs:713` · `runtime/webview/ChromeProcess.rs:630` · `runtime/api/bun/h2_frame_parser.rs:437,511` · `js_parser_jsc/expr_jsc.rs:157,163,170` · `js_parser/lexer.rs:1301` · `jsc/btjs.rs:205` · `exe_format/macho.rs:731` | `u8` / `u16` / `Copy` POD | **sound** | Pure byte-buffer / `Copy`-type memcpy. Out of scope for this audit. |

**Summary**: 0 active UAF/double-free; 1 API-level unsoundness (`from_bump_slice`
safe fn) hardened; 1 latent reassign-after-bitwise-copy (`generateCodeForFileInChunkJS`)
hardened; 2 design-level recommendations (DevServer ssr alias, CssImportOrder
no-op-Drop) deferred to round 2.

---

## Class #2 — `ptr::write` to skip Drop

Spot-check of the 98 sites: the dominant patterns are

* Writing into genuinely-uninitialized `MaybeUninit` slots (Vec spare capacity,
  `Box<MaybeUninit<T>>` heap init, `addr_of_mut!((*p).field).write(...)` during
  staged construction). **Legitimate.**
* `ThreadPool.rs:681,685` — the post-`clone_for_worker` band-aid (see #1).
  **Sound but ugly**; round-2 replaces with per-field ctor.
* `generateCodeForFileInChunkJS.rs` — added this round (see #1).

No site found where `ptr::write` is papering over a *different* still-live
bitwise-copy than the two #1 cases above.

---

## Class #3 — `ptr::read` move-out

Spot-check of 135 sites. Representative:

* `findImportedFilesInCSSOrder.rs:37` `bitwise_copy<T>` — `ptr::read(&T)` while
  the source remains live. Would be a double-drop except the only `T`s passed
  are `CssImportOrder` / `Vec<ImportConditions>` / `Vec<ImportRecord>`, all of
  which have a no-op (forget) `Drop` by design (see #1). **Sound (no-op Drop).**
  Same round-2 recommendation: switch to non-owning slice types.
* All other audited `ptr::read` sites are paired with `mem::forget(src)` /
  `ManuallyDrop` / `set_len(0)` or read from `MaybeUninit`. No new hazards.

---

## Class #4 — `mem::forget` / `ManuallyDrop`

Covered by the prior leak-audit. Spot-check of the entries *not* in that audit:

* `Chunk.rs:1164-1165` — `forget(take(&mut self.conditions))` inside
  `Drop for CssImportOrder`. Intentional: the vecs are bitwise-shared across
  entries (see #1). Not a "forget a value the parent also owns" — it's the
  inverse: forget *because* the parent owns it.
* `small_list.rs:334,739,793` — husk-forget after `ptr::read` move-out. Paired.
* `js_parser/ast/P.rs:7273` — `forget(replace(&mut field, …))` to overwrite a
  field that may alias bump storage. Mirrors Zig plain assign; the replaced
  value's `Drop` would be wrong (arena-owned). **Sound** but same shape as #2;
  round-2 should make `import_record_indices` a `RawSlice` so the `forget` goes
  away.

---

## Class #5 — `MaybeUninit` struct fields with Drop-carrying payload

| field | payload Drop? | classification | notes |
|---|---|---|---|
| `bundler/ThreadPool.rs:438` `Worker.heap: MaybeUninit<ThreadLocalArena>` | yes | **sound** | Self-referential (`Worker.arena` points into it). Init in `create()`, torn down in `deinit()`. `MaybeUninit` is necessary (init-order + suppress Drop on bitwise-aliased clones). |
| `bundler/ThreadPool.rs:449` `Worker.data: MaybeUninit<WorkerData>` | yes | **sound** | Late-init in `create()`; `deinit()` handles teardown manually. |
| `bundler/ThreadPool.rs:459,460` `temporary_arena`/`stmt_list` | yes | **sound** | Late-init in `create()`. |
| `bundler/ThreadPool.rs:488,493` `WorkerData.{transpiler,other_transpiler}` | yes (Transpiler) | **sound** | The `clone_for_worker` target. `MaybeUninit` is *required* so Drop never runs on the bitwise-aliased value. Explicitly documented. |
| `runtime/bake/DevServer.rs:428-430` `{server,client,ssr}_transpiler` | yes | **sound / suspicious** | `server`/`client`: late-init via `init_transpiler` (writes via `MaybeUninit::write`). `ssr`: see #1 (bitwise alias when `!separate_ssr_graph`). No `Drop for DevServer` touches these. **Recommendation**: `ssr_transpiler: Option<Box<Transpiler>>` + `*mut Transpiler` accessor pointing at `server_transpiler` when `None`. |
| `http/AsyncHTTP.rs:394` `Preconnect.async_http` | yes (HTTPClient) | **sound** | Self-referential (`response_buffer`). Explicit `drop_in_place` in `on_result` before `heap::take`. |
| `install/NetworkTask.rs:64` `unsafe_http_client` | yes | **sound** | Same self-ref pattern; explicit teardown. |
| `runtime/webcore/s3/{simple_request,download_stream}.rs` `http` | yes | **sound** | Same. |
| `jsc/hot_reloader.rs:497` `concurrent_task` | no (intrusive node) | **sound** | Late-init before queue push. |
| `jsc/ZigException.rs:156` `Holder.zig_exception` | yes (`String` fields) | **sound** | Gated on `loaded`; `Holder::deinit` (if any) handles it. Mirrors Zig `= undefined`. |
| `runtime/cli/filter_arg.rs:277,278` `walker`/`iter` | yes | **sound** (leak on error) | Self-referential (`iter` borrows `walker`). `Drop for PackageFilterIterator` gates on `valid`. **Minor leak**: if `iter.init()` fails after both fields are written but before `valid = true`, both leak. Not UAF. **Recommendation**: set `valid = true` *before* `iter.init()` (so Drop cleans up on error), or fold walker+iter into one `Pin<Box<_>>` per the existing TODO. |
| `collections/pool.rs:34` `data` | generic | **sound** | Explicit `assume_init_drop` in pool teardown. |
| `bun.rs:2933` `payload: MaybeUninit<R>` | generic | **sound** | One-shot result slot; written exactly once before read. |
| `main_wasm.rs` statics | mixed | **sound** | Process-lifetime singletons; never dropped. |
| `resolver/lib.rs:186` / `runtime/cli/*.rs` `LOG_` statics | yes | **sound** | Process-lifetime; never dropped. |

**Summary**: 0 unsound; all `MaybeUninit` fields exist for one of (a) self-reference,
(b) late-init mirroring Zig `= undefined`, (c) Drop-suppression on bitwise-aliased
clones. None are gratuitous porting artifacts that should be plain `T`.

---

## Class #6/#7 — `'static` erasure / `detach_lifetime`

Spot-check only this round (570 + 142 sites). Representative:

* `Transpiler<'static>` in `WorkerData`/`DevServer` — the arena IS process-
  lifetime (`ThreadLocalArena` / `UserOptions.arena`); documented sound.
* `filter_arg.rs:338` — `&'static mut GlobWalker` from a sibling field. Unsound
  if `PackageFilterIterator` moves; caller never moves it (stack-local in
  `filter_run::run`). Existing `TODO(port)` tracks the `Pin<Box<Self>>` fix.
* `AsyncHTTP<'static>` in `Preconnect`/`NetworkTask`/`S3` — borrows sibling
  `response_buffer`; struct is heap-pinned (`heap::into_raw`), never moves.

Round-2 will tabulate all 142 `detach_lifetime` calls per-site.

---

## Fixes applied (round 1)

1. **`collections/vec_ext.rs`** — `BabyListExt::from_bump_slice` is now
   `unsafe fn` with a `# Safety` contract. 40 call sites in `bun_js_parser` /
   `bun_bundler` updated to acknowledge the bitwise-move-out invariant. This
   closes the class-#1 API hole: a future caller that passes
   `live_vec.as_mut_slice()` will hit `unsafe` instead of silently
   double-dropping.

2. **`bundler/linker_context/generateCodeForFileInChunkJS.rs`** — the
   `*prop = G::Property { … }` reassignment after the bitwise property copy now
   uses `ptr::write`. Same rule as `ThreadPool.rs:initialize_transpiler`: every
   field-write on a bitwise-copied Drop-carrying struct must go through
   `ptr::write` or be `Copy`. The "JSON ⇒ `ts_decorators` empty" invariant made
   the old code sound *today*; this makes it sound *structurally*.

## Round-2 queue

* **`clone_for_worker`** — replace bitwise `copy_nonoverlapping` with a
  per-field worker-transpiler constructor; deletes the `ptr::write` band-aid.
* **`DevServer.ssr_transpiler`** — drop the bitwise alias; pass
  `&mut server_transpiler` to `BakeOptions` when `!separate_ssr_graph` (matches
  Zig). Removes one `copy_nonoverlapping` of `Transpiler`.
* **`CssImportOrder`** — switch `conditions` / `condition_import_records` to
  `RawSlice`; deletes the no-op `Drop` impl + the `bitwise_copy` helper.
* **`filter_arg::PackageFilterIterator`** — `Pin<Box<Self>>` per existing TODO.
* Full per-site table for #6/#7 lifetime erasure.
