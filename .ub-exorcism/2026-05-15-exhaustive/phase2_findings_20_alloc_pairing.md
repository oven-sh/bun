# Phase 2 — Bucket 20 Findings: Dangling `Box` / Manual Allocator Pairing

**Run:** `2026-05-15-exhaustive`
**Bucket:** 20 — `Box::from_raw` / `Vec::from_raw_parts` allocator-pairing
**Source skill ref:** `references/UB-TAXONOMY.md` §20
**Author:** Phase 2 static-bucket-sweeper for Bucket 20
**Inputs read:** all `phase1_inventory_*.md`, all `phase1_notes/*.md`,
existing EXP-001..EXP-029, `phase1_unsafe_surface_inventory.md`.

---

## Scope clarification

`Box::from_raw(p)` is sound iff `p` was produced by `Box::into_raw`/
`Box::leak`/`heap::into_raw` (i.e. the **global** allocator) of an *exactly
matching* `T`. `Vec::from_raw_parts(ptr, len, cap)` is sound iff `ptr` was
produced by allocating a `Vec<T>` (or layout-compatible `Box<[T]>`/
`Vec<U>` in the global allocator) of exactly that capacity, and the `T`
type used for reconstruction has identical `Layout::array(cap)` to the
allocator-side layout.

Bucket 20 fails when:

1. The pointer came from a **different allocator** (libc malloc, custom
   vtable, mmap, foreign C++ heap).
2. The reconstructed element type changes `Layout::array::<T>(cap)` —
   especially **size** or **align** mismatch (Vec's eventual dealloc
   passes `Layout::array::<T>(cap)` to the global allocator, which is
   UB if it doesn't match the original allocation).

**Bun's global allocator IS mimalloc** (per `src/CLAUDE.md` and
`bun_bin/lib.rs:210-213`). This means a `Box<T>` allocation and a
mimalloc-direct (`mi_malloc`) allocation **share the same heap**, but
they do **not** share the same `Layout` discipline — the global allocator
contract is "free with the *exact* layout you allocated with", and Vec's
dealloc derives that layout from `(T, cap)`, not from mimalloc's
size-class introspection. Mimalloc's `mi_free` is layout-agnostic in
practice, but Rust's safety contract is layout-strict, so Miri/MIR-level
tooling will flag the layout mismatch even though the runtime free would
succeed.

---

## Phase 1 inventory totals (this bucket)

| Source | Count | Status from Phase 1 |
|---|---|---|
| `Box::from_raw` (Rust src) | 25 sites | All `Box::into_raw`/`heap::into_raw`-paired except SQLDataCell.rs:226/254 (heap origin in Zig producer trace) |
| `Vec::from_raw_parts` / `_in` (Rust src) | 18 sites | All paired-on-Global except encoding.rs:303 (EXP-004), streams.rs:2590/2596 (EXP-092 safe-API ownership defect), and bindgen.rs:256/275/353 (EXP-091 layout contract defect despite USE_MIMALLOC) |
| `bun_core::heap::take` / `destroy` | ~30 sites (per K notes) | Centralized `Box::from_raw` chokepoint; clean by construction |
| Cross-allocator C-side wiring | 5 sites in T (per T inventory L80-86) | All `mi_malloc + mi_free` registered together, sound |

**Net dirty count after Codex follow-up: 3 confirmed (EXP-004, EXP-091,
EXP-092), 2 suspect-but-trace-defended, 0 unresolved T1 rows.**

---

## Existing EXP cross-references

### EXP-004 — CONFIRMED
- **Site**: `src/runtime/webcore/encoding.rs:303-310`
- **Shape**: `Vec<u8> → Vec<u16>` reinterpret (`Vec::from_raw_parts(ptr.cast::<u16>(), usable_len/2, capacity/2)`).
- **Status**: Miri-confirmed in `experiments/EXP-004/`; T1 (UB confirmed).
  Vec<u8>'s drop will pass `Layout::array::<u16>(cap/2)` (align 2) where
  the original alloc was `Layout::array::<u8>(cap)` (align 1) — layout
  mismatch even without the alignment escalation issue.
- **Source-side TODO**: line 298-301 already flags "Vec<u8> as Vec<u16>
  is not generally sound in Rust"; remediation route documented (route
  through `bun_core::String` raw-bytes API).

### EXP-017 — UNRELATED
The user's brief mis-identified EXP-017. EXP-017 is about
**volatile-fn-ptr cross-thread publication race**
(`src/io/lib.rs` `Request::store_callback_seq_cst`), per
`phase1_inventory_P.md:112`. It is **not** an alloc-pairing issue. The
streams.rs:2589/2595 site IS the EXP-004-shape allocator-pairing twin this
brief intended to flag — it is now tracked directly as EXP-092.

---

## New findings

### NF-1 (no new EXP — SQLDataCell.rs:226/254 trace clean)

- **Sites**: `src/sql_jsc/shared/SQLDataCell.rs:226`, `:254`
- **Shape**: `Box::<[u8]>::from_raw(ptr::slice_from_raw_parts_mut(p, len))`
  for `Bytea` (line 226) and `TypedArray` (line 254) tagged-union
  branches.
- **Status**: **Source TODO is stale; producer trace defends both
  sites.** Per `phase1_notes/S_sql_redis.md:66-89` (already verified):
  - Bytea: `postgres/DataCell.rs:30-47` allocates exactly `hex.len()/2`
    via `bun_core::heap::into_raw(buf)`; layout matches `[u8; len]`.
  - TypedArray: `from_bytes_typed_array` allocates `out_bytes` and
    stores `byte_len = out_bytes`; the deinit frees the same byte
    count.
- **Recommendation**: **delete the stale `TODO(port)` comments** on
  lines 225 and 251-253 (and the "Mimalloc's free ignores size so Zig
  got away with it" justification at 246-248). No new EXP. Not a T1
  find. Optional remediation bead: rephrase the SAFETY blocks once the
  producers are migrated to `Box::<[u8]>::leak` so the layout invariant
  is type-system-enforced rather than prose-enforced.

### NF-2 — EXP-092 CONFIRMED (`streams.rs` `ReadResult::to_stream`)

- **Sites**: `src/runtime/webcore/streams.rs:2590`, `:2596`
- **Shape**: `Vec::from_raw_parts(slice_ptr, len, len)` reconstructing
  a `Vec<u8>` over a slice whose origin is the producer's "owned" slice
  variant (Zig: `bun.Vec<u8>.fromOwnedSlice(slice)`).
- **Hazard**: the old wording under-stated this as producer discipline.
  The safe API shape itself is unsound: `ReadResult::Read(*mut [u8])` is a
  public safe enum variant and `ReadResult::to_stream(...)` is safe. Safe
  Rust can create a raw fat pointer to stack memory (or any non-Vec
  allocation) and pass a different `buf`; pointer inequality then implies
  `owned == true`, so the method reconstructs a `Vec<u8>` over memory it
  does not own.
- **Concrete risk surface**: any caller that constructs the slice via a
  stack buffer, C allocator path (`bun_alloc::basic::C_ALLOCATOR`, mmap,
  JSC's `MarkedArrayBuffer`), or any allocation not owned by a
  `Vec<u8>` with `cap == len` will produce a `Vec<u8>` whose drop
  deallocates the wrong allocation.
- **Verdict**: **EXP-092 CONFIRMED_UB**. The source-shaped safe-API
  witness (`experiments/EXP-092`) passes a stack slice through the safe
  method; Miri rejects `Vec` drop with `deallocating ... stack variable
  memory, using Rust heap deallocation operation`.
- **Recommendation**: split the representation: owned bytes should enter
  `ReadResult` as an owned allocation token (`Vec<u8>`, `Box<[u8]>`, or a
  Bun byte-list wrapper); borrowed raw slices should stay in a distinct
  borrowed variant. Pointer inequality must not imply heap ownership.

### NF-3 — EXP-091 CONFIRMED (bindgen.rs cross-layout Vec round-trip)

- **Sites**: `src/jsc/bindgen.rs:255-256` (initial reconstruct),
  `:274-275` (`SAME_REPR` round-trip), `:351-353` (post-conversion
  reconstitute with potentially different `T`).
- **Shape**: Reconstructs `Vec<Child::ExternType>` over a C++-allocated
  pointer from `ArrayList`/`bindgen` codegen, then potentially
  reinterprets as `Vec<Child::ZigType>` after in-place element
  conversion at `:353`.
- **Defence**: The `bun_alloc::USE_MIMALLOC` const guard at line 258
  short-circuits to a fresh-alloc path when mimalloc isn't the global
  allocator (so layout mismatch can't escape). The `SAME_REPR`
  fast-path at :260-276 only fires when `size_of` AND `align_of` match.
  The post-conversion reslice at :330-353 ensures
  `align_of::<ZigType>() <= MI_MAX_ALIGN_SIZE` (16) and
  `size_of::<ZigType>() <= size_of::<ExternType>()`, and explicitly
  `mi_realloc`s when the new total size would change.
- **Residual hazard**: the explicit comment at lines 345-350 says
  > "the block is mimalloc-owned and the global allocator is mimalloc
  > […] so `Vec`'s eventual dealloc — even with `ZigType`'s layout —
  > routes to `mi_free`, which ignores layout."

  This is **load-bearing on mimalloc-specific behaviour**. Under Rust's
  abstract memory model, `Vec<ZigType>::dealloc` will pass
  `Layout::array::<ZigType>(new_capacity)` to the `#[global_allocator]`,
  not to `mi_free` directly. Miri WILL flag this as a Layout mismatch
  if `ZigType`'s array layout differs from the original
  `ExternType`'s array layout that the C++ side allocated.
- **Codex follow-up**: promoted to **EXP-091**. The Miri witness mirrors the
  safe generic API with `Extern` size 8 align 8 and `Zig` size 8 align 4.
  Dropping the returned `Vec<Zig>` reports:
  `incorrect layout on deallocation: ... size 8 and alignment 8, but gave size
  8 and alignment 4`.
- **Remediation**: either (a) always allocate fresh for the type-converted
  output, (b) require exact allocation-layout equality before storage reuse
  (`align_of::<ZigType>() == align_of::<ExternType>()` and
  `size_of::<ZigType>() * new_capacity == size_of::<ExternType>() *
  old_capacity`), or (c) wrap the buffer in a raw-allocation object that
  preserves the original allocation layout for deallocation.

### NF-4 — DOCUMENTATION HARDENING (no new EXP)

- **Site**: `src/runtime/webcore/encoding.rs:298-301`
- **Status**: TODO comment correctly identifies the EXP-004 hazard;
  remediation route already documented.
- **Recommendation**: no new EXP, but bead this with a `block:EXP-004`
  reference so the Phase-11 fix lands the `bun_core::String` raw-bytes
  API and removes the `Vec::from_raw_parts(_.cast::<u16>(), …)` site.

---

## mimalloc vs Box mixing audit

**No mixing found that materializes a Box from a `mi_malloc` direct
pointer or vice-versa.**

The codebase rigorously segregates the four allocation surfaces:

1. **Global allocator** (= mimalloc via `#[global_allocator]` in
   `bun_bin/lib.rs:208-217`) — backs `Box<T>`/`Vec<T>`/`String` and the
   `bun_core::heap::*` round-trip helpers (`heap.rs:33-122`).
2. **`bun_mimalloc_sys::mimalloc::mi_*`** direct calls — only used by
   ABI-bridge code that explicitly registers BOTH alloc and free into a
   foreign library's vtable: `libdeflate.rs:73-81` (libdeflate),
   `zlib::lib.rs:189-190` and `:923-924` (zlib),
   `boringssl::lib.rs:209-225` (BoringSSL via `OPENSSL_memory_alloc`),
   and `lshpack.rs:61-62` (ls-hpack). Each of these hands paired
   `(mi_malloc, mi_free)` callbacks so the foreign library never frees
   through the Rust global allocator. **Sound.**
3. **`bun_alloc::basic::C_ALLOCATOR`** (libc malloc/free via
   `fallback.rs:11-117`) — explicit ZST allocator vtable. Its produced
   pointers are tagged at the call site (e.g. `Bytes::init` at
   `webcore_types.rs:632-646` records the allocator vtable in the
   payload, and `to_internal_blob` at `Store.rs:580-602` switches on
   `core::ptr::eq(self.allocator.vtable, C_ALLOCATOR.vtable)` before
   choosing `Vec::from_raw_parts` vs `allocator.free`). **Sound** — the
   Vec reconstruction only fires on pointers that came from a
   `Vec::into_raw_parts`-equivalent decomposition (recorded in
   `Bytes::init`), and the `C_ALLOCATOR` vtable is in fact mimalloc on
   USE_MIMALLOC builds (transitively via Bun's global allocator), so
   reconstructing the Vec is allocator-coherent in addition to
   layout-coherent.
4. **`bun_alloc::MimallocArena`** — bump-style arena used by the AST
   parser. Reset via bulk dealloc; values that own heap (Vec, String,
   Box) MUST explicitly free before reset (per CLAUDE.md "Arena
   gotcha"). Not relevant to bucket 20 directly.

**No site converts a `mi_malloc` pointer into a `Box<T>` via
`Box::from_raw`** (verified by enumerating all 25 `Box::from_raw` sites
above — every one is paired with a `Box::into_raw` / `heap::into_raw`
producer in the same module or module-pair).

---

## Top-3 concerning sites (Bucket 20 priority)

1. **`src/runtime/webcore/encoding.rs:303-310`** — anchored EXP-004,
   T1 confirmed. Highest priority because the Vec<u8>→Vec<u16> shape
   has the largest layout drift (size *and* align). Remediation route
   is documented and lands cleanly via the `bun_core::String` API.
2. **`src/runtime/webcore/streams.rs:2590, 2596`** — promoted to EXP-092.
   Safe `ReadResult::Read(*mut [u8])` + safe `to_stream(...)` lets safe
   Rust turn a disjoint stack/non-Vec slice into `StreamResult::Owned(Vec)`.
   A typed owned-allocation token closes it.
3. **`src/jsc/bindgen.rs:255-353`** — promoted to EXP-091. T1-shape
   candidate defended by `USE_MIMALLOC` plus a load-bearing "mi_free ignores
   layout" comment; Miri confirms the Rust allocator-layout contract is broken
   when `ZigType` and `ExternType` have equal size but different alignment.

---

## Deliverable summary

- **Total alloc-pairing sites enumerated**: 73 (`Box::from_raw` 25,
  `Vec::from_raw_parts(_in)` 18, helpers/comment-only 30).
- **Confirmed UB**: 3 (EXP-004 `encoding.rs:303`, EXP-092
  `streams.rs:2590/2596`, EXP-091 `bindgen.rs:255-353`).
- **Strong T1 candidates needing Miri model**: 0 remaining. NF-2 and NF-3
  were both promoted and confirmed.
- **Source TODO cleanup, no UB**: 2 (SQLDataCell.rs:226/254 — producer
  trace defends; encoding.rs:298 TODO is correct and feeds EXP-004
  remediation).
- **mimalloc-vs-Box mixing**: none found.
- **Cross-allocator C-side wiring**: all paired (mi_malloc+mi_free
  registered together, per Section T inventory).
- **bun_core::heap::* helpers**: clean — single chokepoint, audited
  prior + this round.
- **libuv Box::from_raw (libuv.rs:608/1282/1288)**: paired with
  `Box::into_raw` at libuv.rs:590; sound.

**Recommended new experiment IDs**: none remain open. The historical EXP-30
streams recommendation is now **EXP-092** with a confirmed stack-deallocation
Miri witness. The historical EXP-31 bindgen recommendation is now **EXP-091**
with a confirmed allocator-layout Miri witness.
