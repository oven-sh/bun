# Bun UB Experiment Registry — Run 2026-05-15-exhaustive

> Every UB hypothesis lives here until it has a verdict. Verdicts: `OPEN` | `CONFIRMED_UB` | `NO_EVIDENCE` | `NEEDS_REFINEMENT` | `DEFERRED` | `RESOLVED`.
> Numbering note: `EXP-022` through `EXP-025` are intentionally unused after
> concurrent Phase-1 edits were renumbered to keep later experiment IDs stable.
> `EXP-105` is also intentionally non-canonical: it names a support-model
> directory/log trio for the `LaunderedSelf` / `black_box` guardrail, not a
> registry verdict block. These are the only absent IDs in the `EXP-001..111`
> range.
> Legacy-artifact note: `experiments/EXP-022/` and
> `phase5_experiment_results/EXP-022_run.log` are the old DirectoryWatchStore
> witness, now tracked by registry entry `EXP-028`. Phase-5 executor sweep also
> produced two off-by-one directories: design `EXP-037` uses
> `experiments/EXP-038/` + `phase5_experiment_results/EXP-038.log`, and design
> `EXP-038` uses `experiments/EXP-039/` +
> `phase5_experiment_results/EXP-039.log`. The registry IDs are canonical.

## Seeded Anchor Entries (from prior `/rust-unsafe-code-exorcist` audit)

The prior audit ran on branch `claude/unsafe-exorcist-audit` (HEAD `23e23b6d29`). The UB run's audited base was `origin/main@4d443e5402` — 5 commits ahead of the prior audit branch at run start. Material changes touched:
- `bbd3e624af bun:ffi: extract embedded shared libraries from bunfs in dlopen()`
- `314d044c0a JSON lexer: tokenize ?/*/( /) so define auto-quote can recover`
- `bb1973e485 build: generate bun_core::build_options from Config` (collides with audit branch)
- `4d443e5402 collections: funnel multi_array_list SoA ops through Col/ColMut primitives` (relevant to EXP-001)

**Post-run drift note (Codex 2026-05-16):** a later fetch found upstream
`origin/main@e750984db6`, including `e520065ebb Harden 36 reachable security
findings across runtime, install, parsers, http (#30722)`. Entries below remain
the registry for audited base `4d443e5402`; latest-main status requires a W4
refresh pass. See `CODEX_MAIN_DRIFT_NOTE_2026-05-16.md`.

**Run-start policy:** the 5 prior-miri witnesses were seeded as
`NEEDS_REFINEMENT` until re-confirmed against the audited base
`origin/main@4d443e5402`; other anchors were seeded `OPEN`. Later entries
below carry their settled Phase-1/Phase-5 verdicts. Phrases like "current
source" inside individual entries refer to that audited base unless they
explicitly name a later fetched `origin/main@...` commit. None are
assumed-resolved without re-evidence.

---

## EXP-001: `linear_fifo::assume_init_slice<T>` exposes uninitialized backing slots as `T`

**Finding ref:** prior-audit pass-2 F-1 / pre-existing-ub-13; seed witness #1 in `.unsafe-audit/verification/miri-confirmed-linear-fifo-niche-ub.md`
**Section:** O (alloc-and-collections)
**Bucket:** 5 (Uninitialized memory) + 4 (Validity invariants) + 12 (Library trait invariants — caller-API contract)
**Severity:** MUST-BE-UB
**Hypothesis:** `assume_init_slice<T>` in `src/collections/linear_fifo.rs:67-71` reinterprets `&[MaybeUninit<T>]` as `&[T]` for the entire backing buffer (including uninitialized slots). This is not limited to niche-bearing element types: the cast exposes bytes that have not been initialized as a `T` value. Niche-bearing or otherwise validity-constrained `T` (`NonZeroU32`, `NonNull<U>`, `&U`, enum-with-niche) are simply the easiest witnesses because Miri reports the invalid read/tag immediately.

**Minimal reproducer:**
```rust
// experiments/EXP-001/src/main.rs
use std::mem::MaybeUninit;
use std::num::NonZeroU32;

fn assume_init_slice<T>(s: &[MaybeUninit<T>]) -> &[T] {
    unsafe { &*(std::ptr::from_ref::<[MaybeUninit<T>]>(s) as *const [T]) }
}

fn main() {
    let buf: [MaybeUninit<NonZeroU32>; 4] = [
        MaybeUninit::uninit(), MaybeUninit::uninit(),
        MaybeUninit::uninit(), MaybeUninit::uninit(),
    ];
    let view: &[NonZeroU32] = assume_init_slice(&buf);
    println!("view.len() = {}", view.len());
    let _ = view[0].get();
}
```

**Expected signal (verified by prior audit):**
- Miri: `reading memory at allocN[0x0..0x4], but memory is uninitialized at [0x0..0x4], and this operation requires initialized memory`

**Falsifiability:** if miri reports clean against the current source `assume_init_slice` shape, hypothesis is wrong; check whether the `multi_array_list` refactor (`4d443e5402`) replaced linear_fifo's use of this helper.

**Invocation:**
```
mkdir -p experiments/EXP-001
# write src/main.rs + Cargo.toml; then:
cd experiments/EXP-001
MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-001_preflight.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Prior-audit miri confirmed on commit `23e23b6d29`.
- Standalone preflight (2026-05-15) reproduces verbatim: `reading memory at alloc119[0x0..0x4], but memory is uninitialized` (raw log: `phase5_experiment_results/EXP-001_preflight.log`).
- Phase 1 Section O subagent re-confirmed against audited base `4d443e5402`: `src/collections/linear_fifo.rs:62-80` shape is **byte-identical** to the miri reproduction. The `4d443e5402` `multi_array_list` refactor did **not** land the fix despite the team performing invasive container surgery in the same crate. In-source `// TODO(port)` at lines 115-118 explicitly flags this as the unlanded Phase-B fix. Important correction: a `T: bytemuck::AnyBitPattern` bound alone would not make uninitialized backing slots sound; the implementation must either initialize every exposed slot or expose only the initialized prefix / `MaybeUninit<T>` views.
- Hot callers (4 sites inside `linear_fifo.rs` itself): `StaticBuffer::as_slice` (127), `StaticBuffer::as_mut_slice` (131), `DynamicBuffer::as_slice` (168), `DynamicBuffer::as_mut_slice` (172).
- Prior-audit caller chains beyond this file: `LinearFifo<RefDataValue, _>` (test_runner ResultQueue), `LinearFifo<{Entry, PromisePair}, _>` (Valkey client).

---

## EXP-002: `linux_errno::impl GetErrno for usize` transmute hits invalid enum tag

**Finding ref:** prior-audit witness #2 in `.unsafe-audit/verification/miri-confirmed-linux-errno-transmute.md`
**Section:** P (sys-io-event-loop-threading) — anchored on src/errno
**Bucket:** 4 (Validity invariants) + 6 (Type punning)
**Severity:** MUST-BE-UB
**Hypothesis:** `src/errno/linux_errno.rs:175-188` transmutes a raw `usize` syscall error code into a `SystemErrno` enum without first range-checking; any value outside the declared discriminants is UB.

**Minimal reproducer:**
```rust
// experiments/EXP-002/src/main.rs - mirror of impl GetErrno for usize
#[repr(u16)]
enum SystemErrno { Success = 0, Ehwpoison = 133 }

fn get_errno(raw: usize) -> SystemErrno {
    let signed = raw as isize;
    let int = if signed > -4096 && signed < 0 { -signed } else { 0 };
    unsafe { std::mem::transmute::<u16, SystemErrno>(int as u16) }
}

fn main() {
    let raw_minus_134 = usize::MAX - 133;
    let e = get_errno(raw_minus_134);
    let _tag = e as u16;       // UB: invalid enum tag 0x0086
}
```
The direct Bun-crate witness at
`experiments/EXP-002-bun-errno-crate/src/main.rs` depends on `bun_errno` by
path and calls the real Linux `GetErrno for usize` implementation with the
raw-syscall bit pattern for `-134`.

**Expected signal (verified by prior audit):**
- Miri: `constructing invalid value of type SystemErrno: at .<enum-tag>, encountered 0x0086, but expected a valid enum tag`

**Falsifiability:** if `linux_errno.rs` now uses a checked path (e.g., `SystemErrno::init` / `try_from_raw` returning `Option`) or if miri runs clean on the exact current-source shape, hypothesis stale — close as RESOLVED with evidence.

**Invocation:**
```
cd .ub-exorcism/2026-05-15-exhaustive/experiments/EXP-002 && cargo +nightly miri run
cd ../EXP-002-bun-errno-crate && \
  CARGO_TARGET_DIR=/tmp/cargo-target/exp-002-bun-errno-crate \
  MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Standalone preflight (2026-05-15) reproduces verbatim: `constructing invalid value of type SystemErrno: at .<enum-tag>, encountered 0x0086, but expected a valid enum tag` (raw log: `phase5_experiment_results/EXP-002_preflight.log`).
- Codex follow-up added `experiments/EXP-002-bun-errno-crate/`, a source-linked
  harness over the real `bun_errno` crate. Raw log:
  `phase5_experiment_results/EXP-002-bun-errno-crate.log`. Miri reports the
  invalid enum tag at `/data/projects/bun/src/errno/linux_errno.rs:192`, inside
  Bun's actual `impl GetErrno for usize`.
- Phase 1 Section P subagent re-confirmed against audited base `4d443e5402`: `src/errno/linux_errno.rs:192` raw `transmute::<u16, E>` shape **unchanged**. The Linux `impl GetErrno for usize` was **NOT patched** even though sibling checked paths already exist (`SystemErrno::init` at `src/errno/lib.rs:322`, `E::try_from_raw` at `src/errno/windows_errno.rs:262`). Open PR #30765 proposes the Linux checked-path fix, but it is still unmerged.
- No live in-tree caller per Section P, but the impl is `pub`; any future Linux raw-syscall path that feeds an unmapped errno into this trait would recreate the Miri-confirmed invalid-enum-value UB. This is the latent public-API trap the prior witness file documents.

---

## EXP-003: `Meta::has_install_script` enum read directly from lockfile disk bytes (PUB-INSTALL-1)

**Finding ref:** prior-audit witness #3 in `.unsafe-audit/verification/miri-confirmed-pub-install-1.md`
**Section:** L (install-and-pkg-manager)
**Bucket:** 4 (Validity invariants) + supply-chain attack primitive
**Severity:** MUST-BE-UB (ceiling-score supply-chain P0)
**Hypothesis:** `src/install/lockfile/Package/Meta.rs:38-46` reads a `#[repr(u8)]` enum byte directly from `mmap`-backed lockfile contents; an attacker-controlled byte in `bun.lockb` outside the 3 valid discriminants (0/1/2) is a niche-violating validity UB on `bun install`.

**Minimal reproducer:**
```rust
// experiments/EXP-003/src/main.rs
#[repr(u8)]
enum HasInstallScript { Old = 0, False = 1, True = 2 }

fn read_from_lockfile_bytes(bytes: &[u8]) -> HasInstallScript {
    unsafe { std::ptr::read(bytes.as_ptr() as *const HasInstallScript) }
}

fn main() {
    let attacker_bytes = [0x2au8; 1];  // crafted malicious byte
    let _ = read_from_lockfile_bytes(&attacker_bytes);
}
```

**Expected signal (verified by prior audit):** Miri: `enum value has invalid tag: 0x2a`

**Falsifiability:** if `Meta.rs` now uses a checked deserializer (e.g., `match raw { 0..=2 => ..., _ => Err(...) }`), close RESOLVED.

**Invocation:** as EXP-001 with `EXP-003`.

**Verdict:** CONFIRMED_UB

**Notes:**
- Standalone preflight (2026-05-15) reproduces verbatim: `enum value has invalid tag: 0x2a` (raw log: `phase5_experiment_results/EXP-003_preflight.log`).
- Phase 1 Section L subagent re-confirmed against audited base `4d443e5402`: `src/install/lockfile/Package/Meta.rs:39-46` shape verbatim unchanged; read path at `Package.rs:3466-3478` is columnar `copy_from_slice` then `items_mut::<"meta", Meta>()` iter calling `meta.needs_update()`. **Structural fix point:** this specific bug is in `Package::load_fields`' typed-column deserialization, not `Buffers::read_array<T>`. Fix requires checked decoding for `Meta` (or open-byte newtypes for disk fields).
- Triage rationale: every developer who runs `bun install` against a hostile lockfile reaches this path. Single highest-priority anchor for re-confirmation.

---

## EXP-004: `webcore/encoding.rs` `Vec<u8>→Vec<u16>` allocator-layout mismatch on dealloc

**Finding ref:** prior-audit witness #4 (UB-RT-001) in `.unsafe-audit/verification/miri-confirmed-encoding-vec-layout.md`
**Section:** A (runtime-webcore)
**Bucket:** 20 (Dangling Box / allocator pairing) + 6 (Type punning)
**Severity:** MUST-BE-UB
**Hypothesis:** `src/runtime/webcore/encoding.rs:303-310` constructs a `Vec<u16>` from a `Vec<u8>` via `Vec::from_raw_parts` reusing the `u8` capacity. When `Vec<u16>` is later dropped, it asks the global allocator to deallocate with `align=2` while the original allocation was made with `align=1` — UB by the `GlobalAlloc` contract.

**Minimal reproducer:**
```rust
// experiments/EXP-004/src/main.rs
fn main() {
    let v8: Vec<u8> = Vec::with_capacity(6);
    let (ptr, len, cap) = (v8.as_ptr() as *mut u16, 0, 3);
    std::mem::forget(v8);
    let v16: Vec<u16> = unsafe { Vec::from_raw_parts(ptr, len, cap) };
    drop(v16);  // UB: dealloc(size=6, align=2) on alloc made with align=1
}
```

**Expected signal (verified by prior audit):**
- Miri: `incorrect layout on deallocation: allocN has size 6 and alignment 1, but gave size 6 and alignment 2`

**Falsifiability:** mimalloc is more permissive in practice than the abstract `GlobalAlloc` contract; production binaries may not crash. But Miri's abstract-machine verdict is the authority here.

**Invocation:** as EXP-001 with `EXP-004`.

**Verdict:** CONFIRMED_UB

**Notes:**
- Standalone preflight (2026-05-15) reproduces allocator-layout mismatch on `Vec::<u16>::drop` (raw log: `phase5_experiment_results/EXP-004_preflight.log`); checked with `-Zmiri-symbolic-alignment-check`.
- Phase 1 Section A subagent re-confirmed against audited base `4d443e5402`: `src/runtime/webcore/encoding.rs:303-310` still contains `Vec::from_raw_parts(input.as_mut_ptr().cast::<u16>(), usable_len / 2, input.capacity() / 2)` wrapped in `ManuallyDrop::new(input)`. The preceding `TODO(port)` block (lines 298-301) explicitly names the alignment + allocator-layout soundness gap and proposes a `bun_core::String` raw-(ptr,len,cap) Phase-B route. SAFETY comment is intentionally PRESENT_WEAK — author admits the cast is unsound in the general case.
- Shape-twin now covered by **EXP-092**: `src/runtime/webcore/streams.rs:2590/2596` does `Vec::from_raw_parts(slice_ptr, len, len)` when pointer inequality from `buf` is treated as heap ownership. The older Phase-1 note framed this as a producer-discipline question; the later EXP-092 source-shaped witness proves the safe API itself is unsound because safe Rust can pass a disjoint stack/non-Vec raw slice.

---

## EXP-005: `yarn.rs` `&mut [Dependency]` constructed over uninitialized `Vec` capacity (PUB-INSTALL-3)

**Finding ref:** prior-audit witness #5 in `.unsafe-audit/verification/miri-confirmed-summary.md`
**Section:** L (install-and-pkg-manager)
**Bucket:** 5 (Uninitialized memory) + supply-chain attack primitive
**Severity:** MUST-BE-UB
**Hypothesis:** `src/install/yarn.rs:918-925` builds a `&mut [Dependency]` slice over a `Vec<Dependency>`'s allocated-but-not-yet-initialized capacity region; subsequent reads of any unwritten element are UB.

**Minimal reproducer:**
```rust
// experiments/EXP-005/src/main.rs
#[derive(Default)] struct Dependency { name: u32 }

fn build_uninit_slice(cap: usize) -> *mut Dependency {
    let mut v: Vec<Dependency> = Vec::with_capacity(cap);
    let ptr = v.as_mut_ptr();
    std::mem::forget(v);
    ptr
}

fn main() {
    let cap = 4;
    let ptr = build_uninit_slice(cap);
    let s: &mut [Dependency] = unsafe { std::slice::from_raw_parts_mut(ptr, cap) };
    let _ = s[0].name;  // UB: reads uninit
}
```

**Expected signal (verified by prior audit):**
- Miri: `reading memory at allocN[0x0..0x1], but memory is uninitialized`

**Falsifiability:** if the current `yarn.rs` uses `Vec::resize_with(cap, Default::default)` before slice construction, close RESOLVED.

**Invocation:** as EXP-001 with `EXP-005`.

**Verdict:** CONFIRMED_UB

**Notes:**
- PUB-INSTALL-3 was summary-only in prior audit (no dedicated detail file). EXP-005 preflight produces the first standalone trace; verbatim: `Uninitialized memory occurred at alloc211[0x0..0x4]` (raw log: `phase5_experiment_results/EXP-005_preflight.log`); required `-Zmiri-ignore-leaks` because the `forget(v)` triggers leak-check first.
- Required a validity-bearing field in the reproducer to produce a visible Miri error. Bun's actual `Dependency` contains `DependencyVersionTag` (`#[repr(u8)]`, valid 0..=9), so arbitrary uninitialized bytes can violate validity there; the production type is not a `NonZero*` pool.
- Phase 1 Section L subagent re-confirmed against audited base `4d443e5402`: `src/install/yarn.rs:918-925` shape verbatim unchanged; the in-source SAFETY comment **discharges capacity only, not uninit**. Same shape may repeat at `src/install/migration.rs:1492-1493`; that path needs its own experiment instead of a dangling EXP reference.

---

## EXP-006: `Meta::origin` enum-from-disk (PUB-INSTALL-2, same shape as EXP-003)

**Finding ref:** prior-audit PUB-INSTALL-2; Phase-5 standalone Miri witness
**Section:** L
**Bucket:** 4 (Validity invariants)
**Severity:** MUST-BE-UB (upgraded from LIKELY-UB after Section L re-confirmation)
**Hypothesis:** Same shape as PUB-INSTALL-1 against a different `#[repr(u8)]` enum (`Meta::origin`) read from lockfile disk bytes.

**Minimal reproducer:** `experiments/EXP-006/src/main.rs` mirrors `Meta::origin`'s actual discriminant set (`Local=0, Npm=1, Tarball=2`) and reads attacker-controlled lockfile bytes as `Origin`.

**Expected signal:** Miri: `constructing invalid value of type Origin: at .<enum-tag>, encountered 0x2a, but expected a valid enum tag`.

**Falsifiability:** as EXP-003.

**Invocation:** `cd .ub-exorcism/2026-05-15-exhaustive/experiments/EXP-006 && cargo +nightly miri run`

**Verdict:** CONFIRMED_UB

**Notes:**
- Phase 1 Section L subagent re-confirmed against audited base `4d443e5402`: `src/install/lib.rs:1128-1135` shape verbatim unchanged; flows through the same `Meta` columnar memcpy as EXP-003. Same fix-point applies as EXP-003: checked decoding or open-byte newtypes for disk-backed `Meta` fields.
- Phase 5 standalone preflight reproduced the invalid-tag UB (raw log: `phase5_experiment_results/EXP-006.log`).

---

## EXP-007: `Tree.rs` `get_unchecked` over attacker-controlled dependency ID (PUB-INSTALL-4)

**Finding ref:** prior-audit PUB-INSTALL-4; Phase-5 standalone Miri witness
**Section:** L
**Bucket:** 4 (Validity invariants) + 15 (Lifetimes & escape) — OOB index
**Severity:** MUST-BE-UB if hostile lockfile bytes can set `dep_id >= deps.len()`; supply-chain reachability remains the same current-source path described below.
**Hypothesis:** `src/install/lockfile/Tree.rs` calls `get_unchecked(idx)` with `idx` deserialized from attacker-controlled lockfile bytes; bytes outside `0..tree.len()` produce OOB read UB.

**Minimal reproducer:** `experiments/EXP-007/src/main.rs` mirrors the current `Tree.rs:1014-1020` loop: read a `DependencyID` from the dependency-id list and use it as `deps.get_unchecked(dep_id as usize)`.

**Expected signal:** Miri reports UB at `get_unchecked`; current log says ``assume` called with `false``.

**Falsifiability:** if current `Tree.rs` validates `dep_id < deps.len()` before `get_unchecked`, or if a minimized current-source witness cannot drive attacker-controlled bytes into the unchecked index, demote or close.

**Invocation:**
```
# Phase 5 populated this standalone current-shape witness.
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-007
cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-007.log
```

**Verdict:** CONFIRMED_UB (standalone mirror of the current unchecked-index contract; actual lockfile integration witness still useful for exploitability documentation)

**Notes:**
- Phase 1 Section L subagent re-confirmed against audited base `4d443e5402`: `src/install/lockfile/Tree.rs:1014-1020` shape verbatim unchanged. SAFETY comment is contractual but the contract **trusts attacker bytes**. Fix point is a local `dep_id < deps.len()` validation before `get_unchecked`; `Buffers::read_array<T>` does not close this.
- Phase 5 standalone preflight reproduced the unchecked-index UB (raw log: `phase5_experiment_results/EXP-007.log`).

---

## EXP-008: `bun_semver::String::slice` packed `(off, len)` `get_unchecked` OOB up to ~6 GiB (F-NEW-1)

**Finding ref:** prior-audit F-NEW-1
**Section:** R (parsers-and-lang) — anchored on src/semver
**Bucket:** 15 (Lifetimes & escape) — OOB; 4 (Validity invariants)
**Severity:** CONFIRMED_UB primitive; supply-chain reachability depends on serialized lockfile/string-pool bytes reaching this helper with attacker-controlled packed `(off, len)`.
**Hypothesis:** `bun_semver::String::slice` decodes a 64-bit packed `(off:u32, len:u32)` directly from disk bytes and feeds them to `get_unchecked(off..off+len)` without verifying against the backing buffer's length; max `len`/`off` can address up to ~6 GiB OOB.

**Minimal reproducer:** `experiments/EXP-008/src/main.rs` mirrors current `src/semver/lib.rs:586-614` with a forged long-form `String { bytes }` and a short backing buffer.

**Expected signal:** release-mode Miri: `in-bounds pointer arithmetic failed: attempting to offset pointer by 100 bytes, but got ... only 1 byte from the end of the allocation`.

**Falsifiability:** if current lockfile loading validates every packed `(off, len)` before any call to `String::slice`, or if the forged packed representation cannot be constructed from untrusted bytes in current code, demote reachability while keeping the unsafe helper contract finding.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-008
cargo +nightly miri run --release 2>&1 | tee ../../phase5_experiment_results/EXP-008.log
```

**Verdict:** CONFIRMED_UB (standalone helper-contract witness; lockfile integration witness still useful for exploitability documentation)

**Notes:**
- Debug-mode Miri trips the source-shaped `debug_assert!` first. The release
  profile is required to match the production path where the debug assertion
  is absent. Miri notes that `--release` disables debug assertions even though
  it does not model LLVM optimizations.
- Phase 5 standalone preflight reproduced the OOB slice formation (raw log:
  `phase5_experiment_results/EXP-008.log`).

---

## EXP-009: `bun_semver::String::eql` packed `(off, len)` `get_unchecked` OOB (F-NEW-2)

**Finding ref:** prior-audit F-NEW-2
**Section:** R
**Bucket:** 15 + 4
**Severity:** CONFIRMED_UB primitive; same lockfile/string-pool reachability caveat as EXP-008.
**Hypothesis:** Same packed-decode-then-`get_unchecked` shape as EXP-008 but in the equality path.

**Minimal reproducer:** `experiments/EXP-009/src/main.rs` mirrors current `src/semver/lib.rs:520-538` with forged `String { bytes }` values and short backing buffers.

**Expected signal:** release-mode Miri: `in-bounds pointer arithmetic failed` inside the first unchecked subslice.

**Falsifiability:** if current lockfile loading validates every packed `(off, len)` before equality is called, or if equality is never reachable on untrusted packed strings, demote reachability while keeping the unsafe helper contract finding.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-009
cargo +nightly miri run --release 2>&1 | tee ../../phase5_experiment_results/EXP-009.log
```

**Verdict:** CONFIRMED_UB (standalone helper-contract witness; lockfile integration witness still useful for exploitability documentation)

**Notes:**
- Same debug/release nuance as EXP-008.
- Phase 5 standalone preflight reproduced the OOB slice formation (raw log:
  `phase5_experiment_results/EXP-009.log`).

---

## EXP-010: Bundler parallel-callback `&mut LinkerContext` aliasing (5-site cluster)

**Finding ref:** prior-audit bundler B-1..B-5
**Section:** M (bundler-and-transpiler)
**Bucket:** 1 (Aliasing) + 7 (Data races) + 21 (FFI callback aliasing)
**Severity:** CONFIRMED_UB_SHAPE under Tree Borrows; integrated production trace still desirable.
**Hypothesis:** The parallel bundler dispatches work across threads with each task holding `&mut LinkerContext` to overlapping regions. The current source even contradicts its own comment: `generateCompileResultForJSChunk.rs:21-23` says the callback "never forms `&mut LinkerContext`", but lines 54-62 immediately materialize `let c_mut: &mut LinkerContext = unsafe { &mut *c_ptr };`.

**Minimal reproducer:** `experiments/EXP-010/src/main.rs` mirrors two worker callbacks each deriving `&mut LinkerContext` from the same raw parent pointer, then overlapping the unique borrows.

**Expected signal:** Miri with Tree Borrows reports disabled-tag access after the first unique borrow writes: `read access through <...> is forbidden`.

**Falsifiability:** if current code can prove that no two live `&mut LinkerContext` / `&mut Chunk` references overlap, or if the worker body is refactored to raw/shared read-only access before any parallel execution, close as RESOLVED.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-010
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-010-tree-borrows-model.log
```

**Verdict:** CONFIRMED_UB (Tree-Borrows model of the exact aliased-`&mut` pattern; still not an actual `bun build` trace)

**Notes:**
- Phase 5 model reproduced the Tree-Borrows violation (raw log:
  `phase5_experiment_results/EXP-010-tree-borrows-model.log`). Wording should
  be precise: this is a Miri-confirmed model of the current source shape, not
  a full integrated `bun build` run under Miri.
- Loom/Shuttle can prove scheduling overlap, but they are not aliasing oracles.
  Do not say "needs Loom" as if Loom could confirm Stacked/Tree Borrows.
- Important correction from source review: `SymbolMap::follow()` is **not** read-only. It performs path compression through `Cell` (`src/ast/symbol.rs:706-727`). A remediation that merely changes `&mut LinkerContext` to `&LinkerContext` is incomplete unless it proves `follow_all()` made all parallel `follow()` calls store-free, or introduces a no-compress/read-only follow path for parallel codegen.

---

## EXP-011: picohttp NUL-write through `SharedReadOnly` provenance (H9 / U2 family)

**Finding ref:** prior-audit picohttp H9 + 8-site dealloc-through-shared-provenance cluster (U2)
**Section:** Q (http-network-stack) — anchored on src/picohttp + cross-cuts to runtime/server
**Bucket:** 1 (Aliasing) + 14 (`*const T` mutation) + 23 (Observed type changes)
**Severity:** CONFIRMED_UB_MODEL
**Hypothesis:** The picohttp wrapper takes a `*const u8` to an HTTP request buffer (provenance: `SharedReadOnly`) and writes a NUL byte at the path terminator for C-string parsing; writing through a `*const` derived from a shared borrow is UB under TB.

**Minimal reproducer:** `experiments/EXP-011/src/main.rs` — models the current `Request::parse(buf: &[u8], ...)` source shape: `buf.as_ptr()` supplies the path pointer, then `path_ptr.cast_mut().add(path_len).write(0)` performs the sentinel write.

**Expected signal:** Miri Tree Borrows rejects the write because the pointer was derived from a shared slice: `write access through <tag> ... is forbidden`; rustc `invalid_reference_casting` lint (post-stabilization).

**Falsifiability:** if the current parse path receives an owning mutable buffer and the NUL write uses mutable provenance, or if no shared borrow remains live across the write in the minimized witness, demote.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-011
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-011-tree-borrows-model.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Confirmed by a standalone Tree-Borrows model on 2026-05-15. Raw log: `phase5_experiment_results/EXP-011-tree-borrows-model.log`.
- Miri signal: `write access through <232> at alloc108[0x6] is forbidden`; the tag was created by `buf.as_ptr()` and remained `Frozen`, so the later `cast_mut().write(0)` is illegal.
- This is a **model of the exact current-source provenance shape**, not a full integrated `bun_picohttp::Request::parse` Miri run. It proves the claimed abstract-machine issue in the wrapper's pattern; a full integration witness would be useful for documentation but is not required to keep the finding counted.
- The existing SAFETY comment proves the write is in-bounds. It does not prove write provenance. The likely fix is to require an owning/mutable request buffer or to recover mutable provenance from the original mutable storage before passing the buffer to picohttpparser, analogous to the positive pattern at `src/http/lib.rs:4136-4141`.

---

## EXP-012: WebSocket client cancel re-entry watchpoint

**Finding ref:** prior-audit (no specific ID; called out in executive summary)
**Section:** F (runtime-server-and-jsc-hooks)
**Bucket:** 1 (Aliasing) + 21 (FFI callback aliasing) — re-entrant FFI under `&mut self`
**Severity:** WATCHLIST
**Hypothesis:** A C callback invoked by a WebSocket client cancel/close path could re-enter Rust while the client is still live as `&mut`, producing Stacked/Tree Borrows UB or a use-after-free if the re-entry drops the final ref.

**Minimal reproducer:** not required for the current named path unless a later sweep finds a remaining `&mut self` cancel/close receiver. Phase-1 current-source validation found the only `cancel(this)` path (`src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:599-637`) already uses `*mut Self`, `ThisPtr`, `ref_guard`, raw-place field access, and copies `tcp` out before `tcp.close()`.

**Expected signal:** if a future bad path is found, Miri TB aliasing violation, or ASan heap-use-after-free if the re-entry frees `self`.

**Falsifiability:** if current `WebSocketClient::cancel` no longer holds `&mut self` across the re-entrant callback, or if the callback cannot free/re-enter the client on current source, close or demote to watchlist.

**Invocation:**
```
# No current-source experiment to run for the named path; re-open only if a
# new receiver holding &mut self across tcp.close()/handle_close is found.
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-012
```

**Verdict:** RESOLVED (falsified on current `origin/main` for `WebSocketUpgradeClient::cancel`; keep as a pattern watchpoint for other close/cancel paths)

---

## EXP-013: `crash_handler` signal-handler async-signal-safety violations

**Finding ref:** prior-audit (called out in executive summary)
**Section:** U (crash-meta-utility) — anchored on src/crash_handler
**Bucket:** 11 (panic/signal-safety) + 21 (FFI/signal-handler contract) — async-signal-safety is soundness-adjacent, not a Miri-confirmed Rust abstract-machine trace, but violating it can produce deadlock, allocator corruption, or undefined behavior in interrupted C/Rust runtime state.
**Severity:** CONFIRMED_UB (POSIX / libc contract violation, not Miri Rust abstract-machine UB)
**Hypothesis:** The POSIX signal handler in `src/crash_handler/` enters code not on the POSIX async-signal-safe whitelist (`PANIC_MUTEX.lock`, `Output::flush`, `Output::pretty_fmt_args`, metadata formatting, `dladdr`-backtrace work, path lookup through `bun_which::which`, and reload/report setup). Reentrancy from within a signal can corrupt runtime/library state or deadlock on locks held by the interrupted thread.

**Minimal reproducer:** source-level call-graph audit. `phase5_experiment_results/EXP-013-signal-safety-source-audit.log` captures the POSIX signal-safety contract excerpt plus the source path from `handle_segfault_posix` to non-whitelisted operations.

**Expected signal:** Manual/source audit; no Miri equivalent. The confirmed signal is the POSIX handler's reachable calls to non-async-signal-safe operations (`Mutex::lock`, `Output::flush`, formatting, stack/report path, path lookup) before process termination.

**Falsifiability:** if the current POSIX signal path only calls async-signal-safe functions before `_exit`/`execve`, or if the problematic calls are reachable only from the ordinary Rust panic path and not from an actual signal handler, remove from UB registry and track as reliability debt. Current source falsifies that escape hatch: `handle_segfault_posix` calls `crash_handler()` directly.

**Invocation:**
```
# Manual/source audit: POSIX signal-safety excerpt + source grep for the POSIX
# signal entry and non-AS-safe callees.
cat /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase5_experiment_results/EXP-013-signal-safety-source-audit.log
```

**Verdict:** CONFIRMED_UB (POSIX async-signal-safety contract violation; not a Miri Rust abstract-machine trace)

**Notes (Phase 1 Section U):**
- Contract violation is manually confirmed by the call-graph audit. This is counted separately from Miri-confirmed Rust memory UB: the contract violated is POSIX async-signal-safety.
- **Entry points (3)**: `handle_segfault_posix` at `src/crash_handler/lib.rs:1657` (POSIX SIGSEGV); panic hook at `lib.rs:1801` (non-signal); Windows VEH at `lib.rs:2029`. All funnel into `crash_handler()` at `lib.rs:878`.
- **At least 8 distinct operation classes violate POSIX async-signal-safety**: `Mutex::lock` / `try_lock` (PANIC_MUTEX + BEFORE_CRASH_HANDLERS); `Output::flush`; `write!` / arbitrary formatting call sites; `Output::pretty_fmt_args`; `dump_stack_trace` via dladdr's libc-internal locks; `bun_core::reload_process` re-exec setup; `bun_which::which` path lookup (getcwd/stat/dirent); `print_metadata` formatting. Section U's step table counts these as 9 of 14 audited call-graph steps because the output-state restore is a separate non-whitelisted step.
- **Maintainer-acknowledged**: in-source TODO at `lib.rs:588` — "I don't think it's safe to lock/unlock a mutex inside a signal handler."
- **Current mitigation**: `SA_RESETHAND` (line 1737) re-raises after first handler returns. Reduces blast radius but doesn't fix the underlying violation.
- **Origin**: same shape exists in the Zig sibling; the Rust port carried the pattern forward rather than introducing it.
- **Phase-2/8 fix sketch** (Section U): split signal entry (`write(2)` + re-raise) from report path (sibling thread woken via eventfd). Signal handler does only async-signal-safe primitives + wakeup; report formatting runs on a thread that was already running.

---

# New experiments (Phase 1+ will append below as EXP-014, EXP-015, …)

---

## EXP-014: `multi_array_list::Slice<T>: Copy` allows overlapping mutable column views

**Finding ref:** Phase-1 Section O subagent (alloc-and-collections); flagged in-source as a known soundness gap at `src/collections/multi_array_list.rs:564-568`
**Section:** O (alloc-and-collections)
**Bucket:** 1 (Aliasing) + 12 (Library trait invariants — `Copy` contract drift)
**Severity:** CONFIRMED_UB_SHAPE
**Hypothesis:** `Slice<T>` (multi_array_list's typed view) derives or implements `Copy` even though copying it produces two independent handles that can mutably alias overlapping column memory. The in-source comment names live exploiters (`LinkerGraph::load`, `bundle_v2`); the gap is documented but not closed.

**Minimal reproducer:** `experiments/EXP-014/src/main.rs` — minimal mirror of the `Slice<T>: Copy` + `items_mut(&mut self) -> &mut [F]` shape. Copy the slice view, take two mutable column slices from the two copies, then write through both.

**Expected signal:** Miri Tree Borrows: `write access ... is forbidden`; the second mutable view is disabled by a foreign write through the first mutable view.

**Falsifiability:** if the `Copy` impl has been removed in the audited-base
successor being checked, or if `ColMut::as_mut_slice` checks for aliasing
copies at runtime, hypothesis is closed.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-014
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-014-tree-borrows.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- In-source self-acknowledged. The fix is non-trivial: either drop `Copy` (breaks LinkerGraph::load/bundle_v2 call shape) or thread a lifetime that aliasing-tracks copies.
- High-stakes: the named exploiters are in the bundler hot path. May need EXP-010 (bundler parallel-callback aliasing) to compose.
- Phase-5 Miri confirms the abstract API hole: `right[0] = 20` fails with `write access through <259> ... is forbidden`; the right view was disabled by the prior foreign write through the left view. Raw log: `phase5_experiment_results/EXP-014-tree-borrows.log`.
- This is a minimal model witness, not a full `MultiArrayList<T>` integration test. It is still enough to keep the source comment's "Known soundness gap" as a counted UB-shape finding because the public local API explicitly permits the modeled copy-and-mutably-reborrow sequence.
- **Phase 5 (Miri/Loom, 2026-05-16) Tier-2:** Re-ran the existing standalone reproducer (`experiments/EXP-014/src/main.rs`) under `MIRIFLAGS=-Zmiri-tree-borrows cargo +nightly miri run`; Tree Borrows again rejects `right[0] = 20` with `write access through <259> ... is forbidden` (tag <259> Disabled by foreign write through the `left` copy). Verdict CONFIRMED_UB unchanged. Log: `phase5_experiment_results/EXP-014-tree-borrows.log`.

---

## EXP-015: `array_hash_map.rs::put_borrowed`/`get_or_put_borrowed` launders `&[u8]` to `&'static [u8]`

**Finding ref:** Phase-1 Section O subagent; `src/collections/array_hash_map.rs:1898-2014`
**Section:** O (alloc-and-collections)
**Bucket:** 15 (Lifetimes & escape) + 1 (Aliasing) + 23 (Observed type changes)
**Severity:** NO_EVIDENCE_ON_CURRENT_CALLERS / unsafe-contract surface
**Hypothesis:** `put_borrowed` and `get_or_put_borrowed` accept a `&[u8]` key but store it in the map without threading the input lifetime through to the entry, effectively laundering the borrow to `'static`. Caller discipline is required: any caller that drops the source buffer while the map still holds the entry would produce a dangling slice read on the next lookup.

**Minimal reproducer:** not authored for the library misuse shape; the relevant current-source question is caller discipline, because both entry points are already `unsafe fn` and carry the lifetime contract in their docs.

**Expected signal:** source-callsite audit. If a current caller passes a temporary / soon-dropped allocation, write a Miri dangling-read reproducer. If all callers pass source text / lexer string-table / existing map keys that outlive the arena-backed `Scope`, close as no current evidence.

**Falsifiability:** if the put/get path actually clones the key into a map-owned allocation before storing, hypothesis is wrong.

**Invocation:**
```
rg -n '\.(put_borrowed|get_or_put_borrowed)\(|put_borrowed\(|get_or_put_borrowed\(' src -g '*.rs' \
  > .ub-exorcism/2026-05-15-exhaustive/phase5_experiment_results/EXP-015-callsite-audit.log
```

**Verdict:** NO_EVIDENCE

**Notes:**
- Phase-5 callsite audit found exactly three real call sites, all in parser scope handling:
  - `src/ast/scope.rs:124` documents that `name` is from source-file contents or lexer string-table and both outlive the `AstAlloc` arena that owns the `Scope`.
  - `src/js_parser/p.rs:3697` copies keys from a parent `members` map whose keys already satisfy the same source/string-table lifetime contract.
  - `src/js_parser/p.rs:4921` repeats the same source/string-table safety contract for `declare_symbol_maybe_generated`.
- The functions are `unsafe fn`, not unsound safe APIs. A malicious safe caller cannot trigger this without entering an unsafe block.
- Keep this as a hardening/API-contract surface, not a counted confirmed UB. A future call site outside parser-owned source/string-table storage should reopen the experiment.
- **Phase 5 (Miri/Loom, 2026-05-16) Tier-2:** Re-audited callsites with `rg -n '\.(put_borrowed|get_or_put_borrowed)\(|put_borrowed\(|get_or_put_borrowed\('` against current `src/`; output identical to the Phase-5 enumeration (`src/collections/array_hash_map.rs:1898,2011` definitions + the three documented unsafe-fn callers at `src/ast/scope.rs:124`, `src/js_parser/p.rs:3697,4921`). No new caller has appeared since the original audit; no Miri reproducer is justified because the entry points remain `unsafe fn` with documented source/string-table lifetime contracts. Verdict NO_EVIDENCE preserved. Log: `phase5_experiment_results/EXP-015-callsite-audit-tier2.log`.

---

## EXP-016: `Vec<T, AstAlloc> where T: Drop` — per-element destructors never run on arena reset

**Finding ref:** Phase-1 Section O subagent; bun_alloc arena discipline (referenced in CLAUDE.md "arena edge case")
**Section:** O (alloc-and-collections) — cross-cuts to every caller using AstAlloc
**Bucket:** 11 (Panic safety, broadly: resource-leak in Drop semantics) + 13 (Refcount lifecycle, if T contains Arc/Rc) — soundness-adjacent rather than strict Rustonomicon UB unless the leaked Drop releases a resource on which another invariant depends
**Severity:** NO_EVIDENCE for current source / arena-invariant hardening target
**Hypothesis:** Values allocated in the AST arena do not run destructors on `AstAlloc::reset`; this is intentional and documented in `src/bun_alloc/ast_alloc.rs` and `src/ast/lib.rs`. The UB-relevant question is narrower: does any arena-resident `Vec<T, AstAlloc>` or arena-resident AST node contain a `T` whose destructor is required for soundness (lock guard, refcount decrement that guards aliasing, FFI handle with later reuse, etc.)? For benign AST value types, bypassing Drop is a leak/ownership-model choice, not UB.

**Minimal reproducer:** not appropriate unless a concrete destructor-bearing `T` with a soundness-critical destructor is found. Current Phase-5 work wrote `phase5_experiment_results/EXP-016-astalloc-enumeration.log`, `phase5_experiment_results/EXP-016-astalloc-enumeration-tier2.log`, and `phase5_experiment_results/EXP-016-needs-drop.log`.

**Expected signal:** static analysis first. Promote only if a concrete arena-resident type with soundness-critical Drop is found. A Miri witness should then model that specific `T`, not the generic arena reset policy. `G::Property` is destructor-bearing today, but the destructor-bearing member is `TypeScript::Metadata::MDot(Vec<Ref>)`; skipped Drop leaks the inner vector and does not by itself create Rust UB.

**Falsifiability:** if no `Vec<T, AstAlloc>` instance exists with non-trivial `T::drop`, or if the only non-trivial payloads are leak-only value containers, hypothesis is wrong as a UB claim; downgrade to preventive hardening.

**Invocation:**
```
rg -n 'AstVec<|Vec<[^>]+AstAlloc|Vec<.*AstAlloc|AstAlloc::vec' src/ast src/js_parser src/js_parser_jsc -g '*.rs'
rg -n 'impl Drop for' src/ast src/js_parser src/js_parser_jsc -g '*.rs'
```

**Verdict:** NO_EVIDENCE

**Notes:**
- CLAUDE.md Note #8 documents this as the "arena edge case." Section O's flag is the first enumeration request.
- If any caller stores `Arc<...>` in `Vec<_, AstAlloc>` and resets the arena, that's an Arc leak (not UB by itself but resource leak). If `T = MutexGuard` or similar, the lock stays held forever.
- Phase-5 correction: do not describe "Vec<T, AstAlloc> where T: Drop" as already found. The direct grep shows the main arena vector element types are AST value/reference types (`Expr`, `Stmt`, `Decl`, `Property`, `Ref`, `StoreRef<Scope>`, etc.) and explicit Drop impls are sparse (`ASTMemoryAllocator`, generated store scaffolding). This still needs a structured ownership/type-field audit before it belongs in a confirmed-finding table.
- **Phase 5 (Miri/Loom, 2026-05-16) Tier-2:** Re-ran the enumeration (`rg -n 'AstVec<|Vec<[^>]+AstAlloc|Vec<.*AstAlloc|AstAlloc::vec'` and `rg -n 'impl Drop for'` over `src/ast`, `src/js_parser`, `src/js_parser_jsc`). Output unchanged from the Phase-5 baseline: arena vector element types remain AST value types (`Expr`, `Stmt`, `Decl`, `Property`, `Ref`, `StoreRef<Scope>`, `Stmt`/`Decl`/`Property`/`Ref`/`u8` payloads, etc.) and the only `Drop` impls in scope are arena-bookkeeping types (`StoreAstAllocHeap`, `StoreResetGuard`, `DisableStoreReset`, `ASTMemoryAllocator`, the generated `new_store::Store`, `JsArgs`), none of which are stored as elements inside a `Vec<_, AstAlloc>`. No soundness-critical destructor-bearing element type surfaced; a generic Miri reproducer remained unjustified. Log: `phase5_experiment_results/EXP-016-astalloc-enumeration-tier2.log`.
- **Phase 5 (Codex follow-up, 2026-05-16):** Added a compiler probe for `core::mem::needs_drop::<T>()` over the concrete direct `AstAlloc` vector payloads. It found `Expr=false`, `Stmt=false`, `G::Decl=false`, `B::Property=false`, `Ref=false`, `StoreRef<Scope>=false`, `u8=false`, and `G::Property=true`. Source audit traced the `G::Property` destructor requirement to `ts_metadata: TypeScript::Metadata`, specifically the `MDot(Vec<Ref>)` variant. Current object-literal `G::PropertyList` paths do not populate decorator metadata; class-property metadata lives in `StoreSlice<Property>` class bodies. Skipping `MDot(Vec<Ref>)` destruction is a leak/arena-policy issue, not UB. Detailed audit: `phase5_exp016_astalloc_drop_audit.md`. Verdict demoted to `NO_EVIDENCE` for current source, while EXP-066 remains worthwhile preventive hardening.

---

## EXP-017: `bun_io::Request::store_callback_seq_cst` volatile write used as cross-thread publication

**Finding ref:** prior-audit `pre-existing-ub-ptr-3`; current-source recheck in Section P (`src/io/lib.rs:1153-1168`)
**Section:** P (sys-io-event-loop-threading)
**Bucket:** 7 (Data races) + 17 (Atomic ordering) + 25 (Unsafe API contract)
**Severity:** CONFIRMED_UB_MODEL / current-source overlap `NO_EVIDENCE`
**Hypothesis:** `Request::store_callback_seq_cst` publishes a function pointer to another thread with `core::ptr::write_volatile(&raw mut self.callback, cb)` followed by `atomic::fence(SeqCst)`. Volatile is not atomic in Rust; if the I/O thread reads `request.callback` concurrently with this write, the program has a non-atomic data race even though both sides use fences/queue ordering elsewhere.

**Minimal reproducer:** `experiments/EXP-017/src/main.rs` — small model with `Request { callback: fn() }`, one thread doing `write_volatile` + `fence(SeqCst)` and another taking a shared reference and reading/calling the plain function pointer.

**Expected signal:** Miri data-race report in the minimized model. Source audit must still prove whether a current `store_callback_seq_cst` call can overlap with the I/O-thread plain read at `src/io/lib.rs:870` / `:1020`.

**Falsifiability:** if all call sites mutate `callback` before the request is ever shared with another thread, or if the MPSC queue's release/acquire edge fully orders the plain field write and no concurrent read is possible, demote to "misleading comment / hardening." If any live path stores after sharing, promote to `CONFIRMED_UB` and replace the field with an atomic function-pointer representation or a lock-protected state transition.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-017
cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-017-miri-race-model.log
```

**Verdict:** NO_EVIDENCE (primitive race model confirmed; current-source overlap audit found no live overlapping callback read/write)

**Notes:**
- Phase-5 Miri model confirms the primitive claim: `write_volatile` + `fence(SeqCst)` is still a non-atomic write and races with a plain read/retag on another thread. Raw log: `phase5_experiment_results/EXP-017-miri-race-model.log`.
- Miri signal: `Data race detected between (1) non-atomic write ... core::ptr::write_volatile` and `(2) retag read of type Request`.
- Do **not** overstate this as full production UB until the call graph proves overlap. Current source has three call sites (`Blob.rs:7086`, `read_file.rs:470`, `write_file.rs:265`), and the worrying shape is the `if !io_request.scheduled { schedule(...) }` branch: the store happens even if `scheduled` is already true, which may mean the request has already been shared with the I/O queue/thread. That needs a source-specific proof.
- If source-overlap is confirmed, the fix is not a stronger fence; it is an actual atomic representation (`AtomicPtr`/`AtomicUsize` function pointer encoding) or a lock/state transition that prevents concurrent read/write.
- **Phase 5 (Miri/Loom, 2026-05-16) Tier-2:** Re-ran the existing publication-race model (`experiments/EXP-017/src/main.rs`: writer thread calls `write_volatile(&raw mut self.callback, cb)` + `fence(SeqCst)` through `UnsafeCell`; reader thread does a plain `&*shared.get()` retag, reads `request.callback`, and calls it) under `cargo +nightly miri run`. Miri's abstract memory model again raises `Data race detected between (1) non-atomic write on thread unnamed-1 ... core::ptr::write_volatile` and `(2) retag read of type Request on thread unnamed-2`. This re-confirms the primitive claim that `write_volatile` + `fence(SeqCst)` does **not** rescue a non-atomic write from racing with a plain read — the fence orders surrounding memory ops but does not promote the volatile write to an atomic in the C/Rust memory model, so retag-as-read on the consumer side is still a data race. A loom model is unnecessary: the violation is at the per-access level, not at the inter-thread interleaving level. This primitive verdict was later superseded by the source-overlap closure below: the model remains a regression guard, but current Bun source did not provide the required overlapping accesses. Log: `phase5_experiment_results/EXP-017-miri-race-model.log`.
- **Phase 5 source-overlap closure (2026-05-16):** demoted the production-source claim to `NO_EVIDENCE`; see `phase5_exp017_source_overlap_audit.md`. `FileCloser::do_close` (`src/runtime/webcore/Blob.rs:7075-7088`) still looks suspicious because it writes the callback first and only then checks `if !io_request.scheduled`, but all current `do_close` call sites route through `ReadFile::on_finish` / `WriteFile::on_finish` after ordinary work-pool completion or after the IO thread has already popped the request and set `scheduled = false`. The two wait paths (`write_file.rs:261-267`, `read_file.rs:465-472`) are straightforward write-before-`IoRequestLoop::schedule` publication. `UnboundedQueue::push_batch` / `pop_batch` provide the Release/Acquire edge for those pre-publication writes. Conclusion: keep the primitive Miri race model as a regression guard, but do **not** count EXP-017 as current production UB without a new caller that mutates `callback` after queue publication.

---

## EXP-018: `GuardedLock` `_not_send` marker MISSING — unmerged fix in open PR #30765

**Finding ref:** Phase-1 Section P subagent — prior-audit T1 with a proposed fix in PR #30765 (state: OPEN as of 2026-05-16, never merged)
**Section:** P (sys-io-event-loop-threading) — `src/threading/guarded.rs:132-134`
**Bucket:** 8 (Send/Sync invariants) + 7 (Data races) — cross-thread lock-guard escape
**Severity:** LIKELY_UB / unsafe-contract defect
**Hypothesis:** `src/threading/guarded.rs:132-134` defines `GuardedLock<…, Mutex>` without the `_not_send: PhantomData<*const ()>` marker. Because the backend mutex type is sendable, `GuardedLock<…, Mutex>: Send` auto-derives even though its sibling guard types (`MutexGuard`, `RwLockReadGuard`, `RwLockWriteGuard`) explicitly carry `_not_send`. Safe Rust can therefore move a held guard to another thread. The consequence is backend-specific but soundness-relevant: Windows `ReleaseSRWLockExclusive` documents undefined behavior when unlocking a lock the calling thread does not own; Darwin `os_unfair_lock_unlock` aborts on misuse; the futex backend lacks an owner check and violates the guard's same-thread critical-section contract.

**Status:** The proposed fix lives in open PR #30765 (`claude/unsafe-exorcist-demo` branch) which is still OPEN and unmerged as of 2026-05-16 (`gh pr view 30765 --repo oven-sh/bun`). Verified via `git log src/threading/guarded.rs` (only `23427dbc12 Rewrite Bun in Rust` shows; no follow-up). The patch needs maintainer review + merge.

**Minimal reproducer:** source-faithful compile-time witness:
```rust
// experiments/EXP-018/src/main.rs
static GUARDED: bun_threading::Guarded<u32> = bun_threading::Guarded::new(0);

fn assert_send<T: Send>() {}

fn main() {
    assert_send::<bun_threading::GuardedLock<'static, u32, bun_threading::Mutex>>();
    let guard = GUARDED.lock();
    let _join = std::thread::spawn(move || drop(guard));
}
```

**Expected signal:** compile-time auto-trait witness showing
`GuardedLock<_, Mutex>: Send` on the checked source revision. Runtime
consequence is platform-specific: Windows UB per SRWLOCK contract, Darwin
abort, Linux/futex contract violation with debug owner assertion.

**Falsifiability:** if `git log` shows the patch landed since the prior audit,
close RESOLVED. If `GuardedLock<_, Mutex>` is not `Send` on the checked source
revision, or if the only constructible `GuardedLock` instantiations use a
backend that is itself `!Send`, close as stale. If it remains `Send`, the safe
API admits the wrong-thread-unlock operation; production callsite reachability
is not required for the safe-API contract finding.

**Invocation:**
```
# Source-side verification first:
git log --all --oneline --follow -- src/threading/guarded.rs | head -10
rg -n '_not_send|PhantomData<\*const' src/threading/guarded.rs
# Source-faithful auto-trait witness:
cd .ub-exorcism/2026-05-15-exhaustive/experiments/EXP-018 && cargo +nightly check
```

**Verdict:** CONFIRMED_UB (safe API admits wrong-thread unlock; OS/backend consequence is platform-specific)

**Notes:**
- Phase 5 compile-time witness passed (raw log:
  `phase5_experiment_results/EXP-018-autotrait.log`): the mirrored current
  `GuardedLock<'static, u32, Mutex>` shape satisfies `T: Send`. This confirms
  the auto-trait defect half of the hypothesis without overstating Linux
  runtime UB.
- Phase 5 source-faithful follow-up passed against Bun's real `bun_threading`
  crate (raw log: `phase5_experiment_results/EXP-018-source-faithful-autotrait.log`).
  The witness uses a `static Guarded<u32>`, acquires `GUARDED.lock()`, and moves
  the held guard into `std::thread::spawn`. That line only type-checks if safe
  Rust can move the guard to another OS thread. `GuardedLock::drop` calls
  `Mutex::unlock()`, and `src/threading/Mutex.rs` documents wrong-thread unlock
  as undefined behavior. Detailed source audit:
  `phase5_exp018_guarded_lock_autotrait_audit.md`.
- Phase 9 (beads) and Phase 12 (UB_RUNBOOK) should call out that open audit-PR fixes need land-tracking — three independent fixes in PR #30765 (this one, EXP-002 linux_errno, EXP-019 StoreSlice<T>) are all sitting unmerged.
- Section P also surfaced 4 other Phase-2-worthy items (impl_streaming_writer_parent LaunderedSelf in risky-user sections A/E/H; hand-rolled lock-free queues with Cell/UnsafeCell tag-bit Acquire/Release in ThreadPool::Queue/Channel<T,B>/UnboundedQueue<T> — no loom or Tree-Borrows verification on file; 51 unsafe extern "C" syscall trampolines including fragile macOS `__getdirentries64`; `AlignedBuf::filled` as single shared `unsafe fn` for all 4 dirent-platform branches). Those are captured in `phase1_notes/P_sys_io_event_loop.md` for the Phase 4 synthesizer to lift.

---

## EXP-019: `StoreSlice<T>` unbounded `Send`/`Sync` — third unmerged fix from open PR #30765

**Finding ref:** Phase-1 Section P subagent note (cross-references Section R, where `StoreSlice<T>` lives at `src/ast/nodes.rs:339-340`); proposed fix in open PR #30765
**Section:** R (parsers-and-lang) — `src/ast/nodes.rs:339-340`
**Bucket:** 8 (Send/Sync invariants)
**Severity:** MUST-BE-UB
**Hypothesis:** `StoreSlice<T>` is declared with an unbounded `Send`/`Sync` impl: the inner type `T` is allowed to be `!Send`/`!Sync` and the type still auto-conjures cross-thread shareability. The safe `StoreSlice::new(&[T])` plus safe `Deref<Target=[T]>`/`slice()` methods allow safe callers to construct `StoreSlice<Cell<u32>>`, copy the lifetime-erased slice wrapper into scoped threads, and race through `Cell`.

**Status:** Same as EXP-018 — fix proposed in open PR #30765, never merged. Verify with `git log src/ast/nodes.rs` and `rg 'unsafe impl (Send|Sync) for StoreSlice' src/ast/`.

**Minimal reproducer:** `experiments/EXP-019/src/main.rs` mirrors the current `StoreSlice<T>` shape (`NonNull<T>`, unbounded `unsafe impl<T> Send/Sync`, safe `new`, safe `slice`) and races a `Cell<u32>` through two scoped threads. The direct Bun-crate witness at `experiments/EXP-019-bun-ast-crate/src/main.rs` then repeats the same safe-code race using the real `bun_ast::StoreSlice::new(&[Cell<u32>])` API.

**Expected signal:** Miri data race at `Cell::set`; current log says `Data race detected between ... retag write ... on thread unnamed-1 ... and ... unnamed-2`.

**Falsifiability:** if current `src/ast/nodes.rs` has already changed to `unsafe impl<T: Send> Send for StoreSlice<T>` and `unsafe impl<T: Sync> Sync for StoreSlice<T>`, close RESOLVED. If `StoreSlice<T>` is no longer constructible for arbitrary `T` or carries a private invariant that prevents safe construction with `!Send`/`!Sync` payloads, demote to documentation/hardening.

**Invocation:**
```
rg -n 'unsafe impl.*StoreSlice|struct StoreSlice' src/ast/nodes.rs
cd .ub-exorcism/2026-05-15-exhaustive/experiments/EXP-019 && cargo +nightly miri run
cd ../EXP-019-bun-ast-crate && \
  CARGO_TARGET_DIR=/tmp/cargo-target/exp-019-bun-ast-crate \
  MIRIFLAGS="-Zmiri-preemption-rate=0" cargo +nightly miri run
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Phase 5 standalone preflight reproduced the safe-code data race (raw log:
  `phase5_experiment_results/EXP-019.log`). This is stronger than a
  compile-fail witness: the current public API lets safe code race a
  `!Sync` payload through the unbounded `Sync` impl.
- Codex follow-up added a source-linked harness depending on Bun's actual
  `bun_ast` crate. Raw log:
  `phase5_experiment_results/EXP-019-bun-ast-crate.log`. Miri reports:
  `Data race detected between ... non-atomic write ... and ... retag write`
  in `Cell::set`, with the two safe scoped-thread call sites in
  `experiments/EXP-019-bun-ast-crate/src/main.rs`. This upgrades the evidence
  from mirror-only to mirror + direct Bun-crate witness without changing the
  registry count.
- Composes with EXP-018 in Phase 8 remediation — both are one-line / two-line patches in PR #30765 that should land together.

---

## EXP-020: `bun_url::URL::host_with_path` int-to-pointer round-trip loses provenance

**Finding ref:** Phase-1 Section Q subagent — new concrete provenance violation
**Section:** Q (http-network-stack) — `src/url/lib.rs:340-351`
**Bucket:** 2 (Provenance)
**Severity:** STRICT_PROVENANCE_FAIL (concrete `-Zmiri-strict-provenance` hit)
**Hypothesis:** `bun_url::URL::host_with_path` does an `int-to-pointer` round-trip at lines 340-351: the original pointer's address is converted to `usize`, arithmetic is performed, then cast back to `*const u8`. Under Rust's strict-provenance model (`-Zmiri-strict-provenance`), the integer-to-pointer cast itself is rejected before the deref. The source should derive the returned slice from the original `self.href`/`self.host` pointer with provenance-preserving pointer APIs instead of reconstructing a pointer from an integer address.

**Minimal reproducer:**
```rust
// experiments/EXP-020/src/main.rs - mirror of host_with_path's arithmetic shape
fn main() {
    let buf: Vec<u8> = b"https://example.com/path".to_vec();
    let base = buf.as_ptr() as usize;
    // simulated host_with_path offset arithmetic
    let offset = 8usize; // arbitrary; mirrors the lib.rs:340-351 calc
    let p = (base + offset) as *const u8;
    let _b = unsafe { p.read() };
}
```

**Expected signal:** Miri: `unsupported operation: integer-to-pointer casts and ptr::with_exposed_provenance are not supported with -Zmiri-strict-provenance` at the `as *const u8` cast. Captured in `phase5_experiment_results/EXP-020.log`.

**Falsifiability:** if the current source uses provenance-preserving pointer derivation from the original slice base (for example compute offsets as integers but form the pointer with `self.href.as_ptr().add(start_off)`) instead of `(ptr as usize + n) as *const _`, close as RESOLVED.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-020
MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-020.log
```

**Verdict:** DEFERRED (strict-provenance release-gate failure; not default-Miri/runtime UB; recheck when Bun adopts strict provenance as a gate)

**Notes:**
- Same fix shape as the canonical good example Section Q surfaced: `src/http/lib.rs:4136-4141` chunked-decoder Vec-base provenance recovery (explicitly cites the U2 hazard and avoids it).
- This is a concrete `-Zmiri-strict-provenance` failure, not a default-Miri crash. It belongs in the UB runbook because the fix is local and provenance-preserving, but public summaries should count it separately from validity/aliasing/data-race UB traces.
- Section Q also surfaced ~15 instances of the Opaque-ZST `UnsafeCell<[u8; 0]>` aliasing escape hatch across `bun_uws_sys` + 1 in `bun_cares_sys::Channel` (only Channel carries the load-bearing `size_of == 0` static assertion); captured in `phase1_notes/Q_http_network.md` for the Phase 4 synthesizer to lift.
- **Phase 5 policy correction (2026-05-16):** moved from `NEEDS_REFINEMENT` to `DEFERRED`; the witness is already decisive under `-Zmiri-strict-provenance`, and the unresolved question is whether Bun adopts strict provenance as a release gate. See `phase5_strict_provenance_policy_reclassification.md`.

---

## EXP-021: `bun_ast` lifetime-erased Store wrappers expose safe dangling-reference APIs

**Finding ref:** Codex Phase-1 Section R review — current-source safe API unsoundness in `StoreRef`, `StoreStr`, and `StoreSlice<T>`.
**Section:** R (parsers-and-lang) — `src/ast/nodes.rs:42-113`, `:170-208`, `:342-413`
**Bucket:** 15 (lifetime/escape) + 1 (aliasing via `slice_mut`) + 4/5 (reference validity)
**Severity:** CONFIRMED_UB_SHAPE / unsafe safe-API contract
**Hypothesis:** `StoreRef<T>`, `StoreStr`, and `StoreSlice<T>` intentionally erase arena lifetimes into raw pointers, but they expose safe constructors (`StoreRef::from_bump`, `StoreStr::new`, `StoreSlice::new`, `From<&[T]>`, `From<&mut [T]>`) and safe reborrows with caller-chosen lifetimes (`StoreStr::slice<'a>`, `StoreSlice::slice<'a>`, `StoreSlice::slice_mut<'a>`, `Deref`). Safe Rust can construct one from a stack/temporary slice, let the backing allocation die, and later obtain `&[T]`/`&mut [T]` from a dangling raw pointer. The production parser may be disciplined, but the API boundary itself is unsound unless the constructors/reborrows are `unsafe` or the arena lifetime is carried in the type.

**Minimal reproducer:** `experiments/EXP-021/src/main.rs` mirrors `src/ast/nodes.rs:322-397`: safe `StoreSlice::new(&[T])`, raw `NonNull<T>` storage, and safe `slice<'a>() -> &'a [T]`.

**Expected signal:** Miri reports a dangling-pointer dereference when a `StoreSlice` built from a local `Vec` is used after the `Vec` drops.

**Falsifiability:** if current source makes the lifetime-erased constructors or reborrow methods `unsafe`, carries a real lifetime parameter (for example `StoreSlice<'arena, T>`), or restricts construction to private arena-owned call sites that cannot be invoked by safe callers with temporary storage, close as RESOLVED. If only internal disciplined use is proven while the safe API remains public, keep as an unsafe-contract defect rather than demoting.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-021
cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-021.log
```

**Verdict:** CONFIRMED_UB (standalone mirror of the current source shape; actual-crate integration witness still desirable)

**Notes:**
- This is distinct from EXP-019. EXP-019 is auto-trait laundering (`StoreSlice<T>: Send/Sync` without `T` bounds). EXP-021 is lifetime escape/dangling reference through safe constructors and safe `Deref`/`slice`.
- A direct fix may be larger than the two-line Send/Sync patch: the sound type-level fix is to carry an arena lifetime, while the conservative minimal fix is to make the lifetime-erasing constructors/reborrow methods `unsafe` and force callers to name the arena-lifetime contract at each use site.
- **Phase 5 (Miri/Loom, 2026-05-16) Tier-2:** Re-ran `experiments/EXP-021/src/main.rs` (safe `StoreSlice::new(&[u8])` over a function-local `Vec`, return the lifetime-erased wrapper, then call `.slice::<'static>()` after the backing `Vec` drops) under `cargo +nightly miri run`. Miri again reports `Undefined Behavior: pointer not dereferenceable: alloc194 has been freed, so this pointer is dangling` at `StoreSlice::<u8>::slice` line 22, with the allocation/dealloc points correctly identified (Vec allocated at the local `vec![42_u8]`, freed at the end of `make_dangling()`). Note that this reproducer reaches the dangling read via **safe** Rust only — `StoreSlice::new` and `StoreSlice::slice` carry no `unsafe` boundary, which is the actual unsafe-API-contract defect. Verdict CONFIRMED_UB preserved. Log: `phase5_experiment_results/EXP-021.log`.

---


---

## EXP-026: `runtime::timer::All` re-entrant timer callbacks still enter through `&mut self` receivers

**Finding ref:** Phase-1 Section J (`phase1_inventory_J.md`, `phase1_notes/J_runtime_misc.md`)
**Section:** J (runtime-misc) — `src/runtime/timer/mod.rs:897`, `:1016`; call sites in `src/runtime/jsc_hooks.rs`
**Bucket:** 1 (aliasing / Tree-Borrows re-entrant `&mut`) + 21 (FFI/JSC callback re-entry)
**Severity:** CONFIRMED_UB_MODEL / integrated timer trace still desirable
**Hypothesis:** `timer::All::get_timeout` and `timer::All::drain_timers` document the known re-entry hazard: a fired timer callback can re-enter `runtime_state().timer.{update,remove}` while the scheduler is iterating timers. Current bodies mitigate the inner hazard by immediately converting `self` to `*mut Self` and forming only short-lived `&mut *this` borrows around `peek()`/`delete_min()`, dropping them before `fire()`. However, the public receiver still binds `&mut self`, and the `jsc_hooks.rs` call-site auto-ref still creates a `&mut All` for the duration of the call frame. A future Tree-Borrows/Miri model could treat that call-frame borrow as conflicting with re-entrant fresh `&mut All` creation, even if the current body avoids holding a local `&mut` across `fire()`.

**Minimal reproducer:** `experiments/EXP-026/src/main.rs` — small `All`-like type with an `&mut self` receiver, immediate raw-pointer conversion, short-lived inner borrow, and a callback that re-enters through a global/raw owner.

**Expected signal:** Miri/Tree-Borrows flags re-entrant unique-borrow conflict at the call-frame `&mut self` receiver even though the body does not hold a local `&mut` across the callback.

**Falsifiability:** if the receiver is changed to `this: *mut Self` (or an equivalent raw-owner token) and `jsc_hooks.rs` call sites use `addr_of_mut!` / raw pointer dispatch so no call-frame `&mut All` is created before callback re-entry, close as RESOLVED. If a minimized Miri/Tree-Borrows witness accepts the current source shape, demote to documentation/hardening.

**Invocation:**
```
rg -n 'fn (get_timeout|drain_timers)\\(&mut self|TODO\\(b2\\)|timer_all_mut|drain_timers\\(' src/runtime/timer src/runtime/jsc_hooks.rs
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-026-tree-borrows-model.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Phase-5 Tree-Borrows model confirms the source TODO's concern: the `&mut self` receiver's protected tag remains live for the call frame, and re-entry through a raw/global owner fails with `reborrow ... is forbidden`. Raw log: `phase5_experiment_results/EXP-026-tree-borrows-model.log`.
- Miri signal: protected tag was created at `fn drain_timers_like(&mut self)`, transitioned to Unique by an inner write, then re-entry through the raw owner attempted a foreign reborrow.
- This is still a model witness rather than an integrated timer/JSC trace. However, it directly targets the exact TODO(b2) signature issue at `src/runtime/timer/mod.rs:908` and `:1029`: changing the receiver to `this: *mut Self` would remove the call-frame `&mut All`.
- **Phase 5 (Miri/Loom, 2026-05-16) Tier-2:** Re-ran the existing standalone reproducer (`experiments/EXP-026/src/main.rs`: `All::drain_timers_like(&mut self)` immediately rebinds `self` as `*mut Self`, increments through a short-lived inner `&mut *this`, then calls `fire_reentrant_callback()` which re-enters via a `static mut ALL: Option<NonNull<All>>` owner) under `MIRIFLAGS=-Zmiri-tree-borrows cargo +nightly miri run`. Tree Borrows again rejects the re-entry with `reborrow through <224> (root of the allocation) at alloc109[0x0] is forbidden`: the accessed tag is foreign to the protected tag `<232>` (in state `Unique`) installed by `drain_timers_like`'s `&mut self` receiver and promoted by the first inner write at `all.ticks += 1`. The reborrow would force the protected tag to `Disabled`, which Tree Borrows forbids — i.e. the call-frame `&mut self` retag is still live for the duration of the call and re-entry through any sibling owner (raw / global / `NonNull`) is rejected. Verdict CONFIRMED_UB preserved. Note this remains a TB-model witness rather than an integrated timer/JSC trace; the recommended structural fix (change receiver to `this: *mut Self` and update `jsc_hooks.rs` to dispatch via `addr_of_mut!`) directly removes the protected tag and would make the TB model run clean. Log: `phase5_experiment_results/EXP-026-tree-borrows-model-tier2.log`.

---

## EXP-027: Windows `dir_iterator::IteratorResultWName` returns a sendable lifetime-erased `RawSlice<u16>`

**Finding ref:** Codex Phase-1 Section D review — correction to the initial mapper claim that `RawSlice<u16>` was `!Send`.
**Section:** D (runtime-node-compat) — `src/runtime/node/dir_iterator.rs:44-67`, `:499-522`, `:895-899`; auto-trait source in `src/bun_core/lib.rs:208-212`
**Bucket:** 15 (lifetime/escape) + 8 (Send/Sync invariants) + 4 (reference validity)
**Severity:** CONFIRMED_UB / unsafe safe-API contract
**Hypothesis:** The Windows `IteratorW` path returns `IteratorResultW { name: IteratorResultWName { data: RawSlice<u16> }, kind }`, where `RawSlice<u16>` points into the iterator-owned `name_data` scratch buffer. The source comment says the result is invalidated by the next `next()` call or by iterator drop, but that contract is not encoded in the type. `RawSlice<T>` explicitly implements `Send + Sync` for `T: Sync`, so `IteratorResultW` is sendable. Safe Rust can store the result after the iterator is dropped or send it to another thread, then call the safe `IteratorResultWName::slice()` and materialize a dangling `&[u16]`.

**Minimal reproducer:** `experiments/EXP-027/src/main.rs` mirrors the current source shape: `RawSlice<T>` wraps `*const [T]`, has `unsafe impl<T: Sync> Send + Sync`, `FakeWindowsIterator::next()` returns an owned result pointing at its `name_data`, and main drops the iterator before calling the safe `slice()`.

**Expected signal:** Miri reports `pointer not dereferenceable: allocN has been freed, so this pointer is dangling` at the safe `RawSlice::slice()` reborrow. The reproducer also includes `assert_send_sync::<IteratorResultW>()`, proving the Windows result auto-trait surface is `Send + Sync`.

**Falsifiability:** if current source changes `IteratorResultWName` to carry a real lifetime tied to `&mut self`, returns owned UTF-16/UTF-8 storage, makes the reborrow method unsafe, or adds a `PhantomData<*const ()>`/equivalent marker making the result `!Send + !Sync` while also preventing post-iterator lifetime escape, close RESOLVED. If only current in-tree consumers copy immediately, keep as a safe-API contract defect rather than demoting: the type boundary remains unsound.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-027
cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-027.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-027.log`.
- This does not require claiming a currently observed production Windows crash. It proves the safe API shape is unsound: the returned value is owned, lifetime-erased, sendable, and can safely request a borrowed slice after its backing iterator storage is gone.
- Current `node_fs.rs` consumers appear disciplined: the Windows readdir paths call `current.name.slice()` immediately and copy/transcode before the next iterator advance. That limits live exploitability but does not repair the exported Rust API contract.
- **Phase 5 (Miri/Loom, 2026-05-16) Tier-2:** Re-ran the existing standalone reproducer (`experiments/EXP-027/src/main.rs`) under `cargo +nightly miri run`. Miri again reports `pointer not dereferenceable: alloc109 has been freed, so this pointer is dangling` at `RawSlice::<u16>::slice` line 12, with the dangling allocation tracked precisely: allocated at the `FakeWindowsIterator` constructor inside an inner scope, deallocated when that scope closes, then the leaked `IteratorResultW` (returned out of the scope) invokes `.name.slice()` against the now-freed buffer. The standalone reproducer also retains the `assert_send_sync::<IteratorResultW>()` compile-time check at line 53, which succeeds today thanks to `unsafe impl<T: Sync> Send + Sync for RawSlice<T>` — i.e. the type-system signal that this value *can* cross threads is intact, complementing the lifetime-erasure runtime witness. Verdict CONFIRMED_UB preserved. Log: `phase5_experiment_results/EXP-027-tier2.log`.

---

## EXP-028: `DirectoryWatchStore::owner(&mut self) -> &mut DevServer` sibling-projection flagged unsound under stacked borrows (author TODO)

**Finding ref:** Phase-1 Section G subagent — author-acknowledged unsoundness with in-source `TODO(port)` comment
**Section:** G (runtime-bake-dev-server) — `src/runtime/bake/DevServer/DirectoryWatchStore.rs:69-81`
**Bucket:** 1 (Aliasing) + 14 (`*const T` mutation) — sibling-projection from `&mut self` to `&mut sibling`
**Severity:** NO_EVIDENCE / stale Phase-A draft hygiene
**Hypothesis:** `DirectoryWatchStore::owner(&mut self) -> &mut DevServer` performs sibling-projection via `from_field_ptr!` while `&mut self` is on the stack: from a `&mut DirectoryWatchStore` (which is a field inside `DevServer`), the macro re-derives a `&mut DevServer` to the containing struct. Author flagged in-source: `TODO(port) "unsound under stacked borrows"`. Phase-5 correction: the author TODO is real for `src/runtime/bake/DevServer/DirectoryWatchStore.rs`, but current `crate::bake::dev_server::DirectoryWatchStore` is defined in `src/runtime/bake/dev_server/mod.rs` and already uses `owner(&mut self) -> *mut DevServer` plus scoped disjoint-field reborrows. The TODO-marked file is still mounted as `directory_watch_store_body`, but `rg` found no call sites of that draft type. Do not count this as current production UB.

**Minimal reproducer:** `experiments/EXP-028/src/main.rs` — mirrors the `from_field_ptr!` shape and the current `ThreadLock::lock()` call style (`lock()` returns `()`, not an RAII borrow into the parent).

**Expected signal:** Current minimal signal is **negative**: Miri Tree Borrows accepts the source-shaped model. Current source audit is also negative for the production path: the canonical implementation in `dev_server/mod.rs` already returns a raw `*mut DevServer`, not `&mut DevServer`.

**Falsifiability:** if a real call site of `directory_watch_store_body::DirectoryWatchStore::owner` is found, or if the canonical `dev_server::DirectoryWatchStore` regresses back to returning `&mut DevServer`, reopen and build a production-caller Tree-Borrows witness. Otherwise keep closed as stale-draft hygiene.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-028
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-028.log
```

**Verdict:** NO_EVIDENCE

**Notes:**
- The in-source `TODO(port)` is still useful evidence of the historical unsafe shape, but it is in the Phase-A draft module, not the canonical live `DirectoryWatchStore` type.
- Phase-5 correction: the first executable witness did **not** validate the over-strong claim. The simple `&mut field -> &mut parent` projection and source-shaped parent-use-then-child-use sequence ran clean under `-Zmiri-tree-borrows` (raw log: `phase5_experiment_results/EXP-028.log`; rerun log: `phase5_experiment_results/EXP-028-rerun.log`). A deliberately stronger model where a parent-borrowing RAII guard stays live while `self` is used fails to compile under Rust's borrow checker and does not match current canonical `dev_server/mod.rs`, where `owner()` returns raw.
- Phase-5 source audit closed the production claim; see `phase5_exp028_canonical_vs_draft_audit.md`.
- Companion concerns in Section G's notes (not promoted to EXP entries — Phase 4 synthesizer will lift):
  - `Drop for DevServer` synchronous WS-close cascade (DevServer.rs:1072-1099) — mitigated by upfront `keys().copied().collect::<Vec<_>>` snapshot, but the snapshot is the only thing preventing iterator-while-modifying.
  - Windows watcher `Box` hand-off race (DevServer.rs:1117-1118) — `ManuallyDrop::take` + `Box::into_raw` documented but unproven against `ReadDirectoryChangesW` completion racing with the watcher's exit check.

---

## EXP-029: `shell::EnvStr` stores borrowed pointers as masked integers, then rebuilds slices from integer addresses

**Finding ref:** Codex Phase-1 Section H review — promotion of Section H "open question" into a strict-provenance experiment.
**Section:** H (runtime-shell) — `src/runtime/shell/EnvStr.rs:76-80`, `:188-200`, `:216-220`
**Bucket:** 2 (Provenance) + 15 (lifetime/escape for `Tag::Slice`) + 4 (reference validity)
**Severity:** STRICT_PROVENANCE_FAIL (concrete `-Zmiri-strict-provenance` hit)
**Hypothesis:** `EnvStr::init_slice` packs `str.as_ptr()` into the low 48 bits of a `u128` via `to_ptr(ptr as usize as u64)`, and `EnvStr::cast_slice` later reconstructs `*const u8` with `self.ptr() as usize as *const u8` before calling `slice::from_raw_parts`. This loses pointer provenance by design. Under Miri strict provenance, the integer-to-pointer cast is rejected before the slice deref. The `Tag::Refcounted` path has the same integer-to-pointer shape in `cast_ref_counted`, but the minimal witness exercises the simpler borrowed-slice path.

**Minimal reproducer:** `experiments/EXP-029/src/main.rs` mirrors the current `EnvStr` layout: `EnvStr(u128)`, `pack`, `init_slice`, `to_ptr`, and `cast_slice`.

**Expected signal:** Miri strict provenance reports `unsupported operation: integer-to-pointer casts and ptr::with_exposed_provenance are not supported with -Zmiri-strict-provenance` at the `self.ptr() as usize as *const u8` cast. Captured in `phase5_experiment_results/EXP-029.log`.

**Falsifiability:** if current source stops rebuilding pointers from integer addresses and instead stores a provenance-carrying pointer representation (for example a typed raw pointer/`NonNull` plus metadata, or an enum separating borrowed and refcounted variants), close as RESOLVED. Replacing the cast with `ptr::with_exposed_provenance` is not sufficient for strict-provenance cleanliness because Miri strict provenance rejects both forms; it only makes the exposed-provenance dependency explicit.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-029
MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-029.log
```

**Verdict:** DEFERRED (strict-provenance release-gate failure; not default-Miri/runtime UB; recheck when Bun adopts strict provenance as a gate)

**Notes:**
- Default Miri emits a warning for this mirror; strict-provenance Miri turns it into a hard error. This is the same evidence standard used by EXP-020 (`bun_url::URL::host_with_path`).
- Current safe callers usually pass string literals, AST slices, or interpreter-owned buffers, so this entry should not be over-described as an immediate shell exploit. The concrete finding is a strict-provenance-incompatible representation, not a demonstrated attacker-controlled crash and not a default-Miri runtime trace.
- The source already contains `TODO(port): strict-provenance` at `EnvStr.rs:192`; EXP-029 supplies the missing executable witness and keeps the issue in the registry instead of leaving it as a prose-only open question.
- **Phase 5 (Miri/Loom, 2026-05-16) Tier-2:** Re-ran the existing standalone reproducer (`experiments/EXP-029/src/main.rs`: mirrors `EnvStr(u128)` with the same `pack` / `init_slice` / `to_ptr` / `cast_slice` layout — pointer packed into low 48 bits via `ptr as usize as u64`, recovered via `self.ptr() as usize as *const u8`) under `MIRIFLAGS=-Zmiri-strict-provenance cargo +nightly miri run`. Miri again rejects with `unsupported operation: integer-to-pointer casts and ptr::with_exposed_provenance are not supported with -Zmiri-strict-provenance` at `EnvStr::cast_slice` line 45 (the `self.ptr() as usize as *const u8` cast inside `slice::from_raw_parts`). Default Miri (no strict-provenance) accepts the same code; the failure is provenance-mode-gated, not a default-Miri runtime violation. Log: `phase5_experiment_results/EXP-029-tier2.log`.
- **Phase 5 policy correction (2026-05-16):** moved from `NEEDS_REFINEMENT` to `DEFERRED`; evidence is complete for the strict-provenance gate, and re-check criteria are documented in `phase5_strict_provenance_policy_reclassification.md`.

---

## EXP-030: `bun_threading::ThreadPool::Queue::cache: Cell<*mut Node>` lock-free MPMC under `IS_CONSUMING` CAS — loom model clean

**Finding ref:** F-DR-1 in `phase4_unified_findings.md`; Bucket 7 sweeper §"Lock-free queue / channel surfaces with no loom or TB on file"; Section P open question #4.
**Section:** P (sys-io-event-loop-threading) — `src/threading/ThreadPool.rs:1480-1599`
**Bucket:** 7 (Data Races) + 8 (Send/Sync) + 1 (Aliasing)
**Severity (Phase 2):** LIKELY-UB-SHAPE
**Hypothesis:** `unsafe impl Sync for Queue {}` allows `&Queue` to cross threads. `cache: Cell<*mut Node>` is `!Sync` by auto-trait; the SAFETY comment claims "only the IS_CONSUMING-CAS-holder reads/writes". A loom model: 2 producers + 2 consumers racing on `try_acquire_consumer` / `release_consumer`. Assert that the `Cell::get` at line 1568 happens-before the `Cell::set` at line 1595 only when both observed `IS_CONSUMING=1` via the Acquire-CAS / Release-`fetch_sub` edge. Falsifiable: loom finds an interleaving where two consumers see `IS_CONSUMING=0` between two `cache` writes.

**Minimal reproducer:** `experiments/EXP-030/src/lib.rs` mirrors `Queue::push`/`Queue::pop`/`try_acquire_consumer`/`release_consumer` with `Cell<*mut Node>` represented by `loom::cell::UnsafeCell` and the `IS_CONSUMING` tag-bit CAS represented by `loom::sync::atomic::AtomicUsize`. Producer threads push intrusive `Node`s; consumer threads contend on the tag-bit and read the cache.

**Expected signal:** loom finds a schedule where two consumers concurrently touch the cache (`Cell::get` then `Cell::set`), producing a torn `*mut Node` pointer or a use-after-free if one consumer's `set` lands between the other's `get` and dereference.

**Falsifiability:** if loom enumerates all interleavings up to 16 threads × 32 ops with no violation, the IS_CONSUMING-CAS-holder discipline holds and the impl is sound; demote to DEFENSIBLE-VERIFIED and document the loom model as the per-refactor regression guard.

**Invocation:**
```
RUSTFLAGS="--cfg loom" cargo +nightly test --release --test exp_030_threadpool_queue_loom 2>&1 | tee phase5_experiment_results/EXP-030.log
```

**Verdict:** NO_EVIDENCE

**Notes:**
- Cross-bucket with EXP-019 (StoreSlice Send/Sync) and F-DR-5 (WebWorker Cell cross-thread): the **`unsafe impl Sync` + `Cell<*mut T>` field** pattern is a recurring shape in Bun's hand-rolled concurrency primitives.
- Section P explicitly cites this as the highest-suspicion lock-free queue surface ("hot path — every worker pool tick").
- Tractable model size: ThreadPool::Queue's state space is small (3 tag bits × 1 cache slot × small Node count); loom should terminate.
- **Phase 5 (2026-05-16) loom result:** model under `experiments/EXP-030/src/lib.rs` mirrors the `stack: AtomicUsize` + `cache: Cell<*mut Node>` (modeled as `loom::cell::UnsafeCell`) discipline. Two tests: (1) 1-producer + 2-consumers exclusivity, (2) 2-producer + 2-consumer handoff stress. Both `RUSTFLAGS="--cfg loom" cargo +nightly test --release --lib` runs are clean — loom's UnsafeCell permit-tracking finds no concurrent access on `cache` across the explored interleavings (`preemption_bound=2..3`). A negative-control sanity test (`loom_sanity_relaxed_should_race`, `#[ignore]`d in default runs) with Acquire/Release dropped to Relaxed IS caught by loom ("Causality violation: Concurrent read and write accesses"), so the green default run is non-vacuous evidence that the IS_CONSUMING Acquire-CAS / Release-fetch_sub edge is doing the work the SAFETY comment claims. Loom only proves the model, not the production code; if the real `pop()` or `try_acquire_consumer` deviates from this mirror (e.g. an unsynchronized peek anywhere), the model misses it. Verdict signal: **NO_EVIDENCE** of the hypothesized race within the modeled discipline. Log: `phase5_experiment_results/EXP-030.log`. Recommendation: keep the model as a per-refactor regression guard and consider extending to a shuttle run if a future PR materially changes the tag-bit FSM.

---

## EXP-031: `WatcherAtomics` triple-buffered HotReloadEvent slots + `AtomicU8 next_event` channel — loom model clean

**Finding ref:** F-DR-4 in `phase4_unified_findings.md`; Bucket 7 sweeper; Section G open question #2.
**Section:** G (runtime-bake-dev-server) — `src/runtime/bake/DevServer/WatcherAtomics.rs:27, 128-225, 232-285`
**Bucket:** 7 (Data Races) + 1 (Aliasing)
**Severity (Phase 2):** DEFENSIBLE-BUT-UNVERIFIED
**Hypothesis:** Triple-buffered `events: [HotReloadEvent; 3]` plus `next_event: AtomicU8` channel (DONE / WAITING / index). Watcher thread writes `current_event`/`pending_event` non-atomically (`:32-33`; the SAFETY comment claims watcher-thread-exclusive); JS thread writes `events[i]` via `&mut *ev` re-borrows. The handoff edge is `swap(ev_index, AcqRel)` at `:171` paired with `swap(WAITING, AcqRel)` at `:254` on the JS side. Phase 5 added the missing loom model; the assertion was that no JS thread ever observes a slot index that the watcher writes through and that the AcqRel chain is correctly anchored.

**Minimal reproducer:** `experiments/EXP-031/src/lib.rs` mirrors the `WatcherAtomics::{publish_pending_event, take_pending_event, take_current_event}` handoff with a reduced two-slot model. Two threads: watcher publishes through `next_event`; JS CAS-loops on `next_event`, takes the slot, and writes through `&mut`.

**Expected signal:** loom finds an interleaving where the JS thread observes a slot index whose backing `HotReloadEvent` is still being written by the watcher thread (i.e. the AcqRel edge is insufficient for the non-atomic field writes).

**Falsifiability:** if loom is clean across all 2-thread × 3-slot × 4-state interleavings, the triple-buffer + AcqRel discipline is sound; document model as the per-refactor regression guard.

**Invocation:**
```
RUSTFLAGS="--cfg loom" cargo +nightly test --release --test exp_031_watcher_atomics_loom 2>&1 | tee phase5_experiment_results/EXP-031.log
```

**Verdict:** NO_EVIDENCE

**Notes:**
- Cross-bucket with EXP-028 (DirectoryWatchStore::owner sibling-projection): both touch the DevServer's watcher subsystem.
- Section G calls WatcherAtomics "the most rigorously-documented concurrency type in the project" — a clean loom run upgrades the documentation into a checkable invariant.
- Critical for Windows watcher Box hand-off: structural fix point #2 (dirent migration) is independent but the loom result here informs whether the AcqRel handoff is enough or whether a different synchronisation strategy is needed.
- **Phase 5 (2026-05-16) loom result:** model under `experiments/EXP-031/src/lib.rs` reduces the triple-buffer to a 2-slot mirror (the AcqRel edge — not the slot count — is load-bearing) with `events: [UnsafeCell<u64>; 2]` + `next_event: AtomicU8`. Two tests cover (1) single watcher publish → JS take and (2) two distinct-slot publishes racing with one JS take. Both runs are clean under `RUSTFLAGS="--cfg loom" cargo +nightly test --release --lib` — loom's UnsafeCell permit-tracking finds no concurrent slot access across the explored interleavings (`preemption_bound=2..3`). The negative-control sanity test (`loom_sanity_relaxed_should_race`, `#[ignore]`d) replaces both AcqRel swaps with Relaxed and is immediately caught by loom ("Causality violation: Concurrent read and write accesses") — proving the model exercises the ordering primitive and the default-pass result is real evidence. Verdict signal: **NO_EVIDENCE** that the AcqRel discipline is insufficient. Caveats: (1) the model elides the `current_event`/`pending_event` bookkeeping that the production code uses to pick the next free slot — that bookkeeping is watcher-thread-local and not itself a data-race surface, but if it ever picks the slot the JS thread is reading, the AcqRel edge will not save it; (2) `HotReloadEvent`'s internal field-level writes are modeled as a single `u64` store, so torn-write shapes inside the event struct are out of scope. Log: `phase5_experiment_results/EXP-031.log`. Recommendation: pair this loom model with a Phase-5 read of `WatcherAtomics::watcher_acquire_event` to confirm the slot-picker's invariant; if anything looks suspicious there, expand the model to 3 slots and track `current_event`/`pending_event` explicitly.

---

## EXP-032: `WebWorker` `Cell<*mut WebWorker>` / `Cell<*mut VirtualMachine>` fields touched cross-thread via `live_workers::HEAD`

**Finding ref:** F-DR-5 + F-DR-11 in `phase4_unified_findings.md`; Bucket 7 sweeper.
**Section:** K (jsc-core) — `src/jsc/web_worker.rs:127-128, 145, 246-326, 332-388`
**Bucket:** 7 (Data Races) + 1 (Aliasing) + 8 (Send/Sync)
**Severity (Phase 2):** LIKELY-UB-SHAPE
**Hypothesis:** `WebWorker` has `Cell<*mut WebWorker>` (live_next, live_prev), `Cell<*mut VirtualMachine>` (vm), `Cell<Status>` (status), `Cell<*mut Map>`/`Cell<*mut Loader>`. Auto-trait: `WebWorker: !Sync`. `terminate_all_and_wait` (`:331`) loads `live_workers::HEAD: AtomicCell<*mut WebWorker>` (`:252`) on the main thread, wraps in `ParentRef::from(nn)` (`:352`), and calls `w.live_next.get()` / `w.requested_terminate.swap(...)` / `w.vm_ptr()` — i.e. forms `&WebWorker` on a non-owner thread. The UB question is not "`WebWorker` is `!Sync`"; `!Sync` only blocks safe sharing. The UB question is whether the unsafe sharing violates an actual memory-model invariant (unsynchronised `Cell` access, invalid aliasing, dangling pointer, etc.).

**Minimal reproducer:** `experiments/EXP-032/src/lib.rs` models two worker-spawn threads plus one terminate-all sweep. Spawn-thread does `register(worker)` (Cell sets under `MUTEX`) and sets `vm`; terminate-all sweep walks the linked list and writes `requested_terminate`. The model asserts no `Cell::get` observes a torn `*mut` value while a peer `Cell::set` runs.

**Expected signal:** loom finds an interleaving where the terminate sweep's `Cell::get(live_next)` reads a partially-updated pointer between a spawn-thread's two Cell::sets, or a follow-up Miri/TB harness finds invalid aliasing despite the locks.

**Falsifiability:** if loom is clean with a negative control and source review shows every cross-thread `Cell` access is serialized by `live_workers::MUTEX` / `vm_lock`, demote to `NO_EVIDENCE` for current UB. `AtomicCell` / marker work remains hardening, not proof of a live defect.

**Invocation:**
```
RUSTFLAGS="--cfg loom" cargo +nightly test --release --test exp_032_webworker_cell_loom 2>&1 | tee phase5_experiment_results/EXP-032.log
```

**Verdict:** NO_EVIDENCE

**Notes:**
- The simplest hardening is to switch `Cell<*mut WebWorker>` to `AtomicCell<*mut WebWorker>` (`bun_core::atomic_cell`); the mutex would still serialise the broader operations, but the field-level synchronization would be harder to accidentally bypass.
- Related to EXP-019 only as an auto-trait hardening pattern. Unlike EXP-019, this path has explicit unsafe sharing plus locks and a non-vacuous clean loom model.
- Section K open question on Strong/Weak auto-trait inference is adjacent, but no current EXP-032 UB witness remains.
- **Phase 5 (2026-05-16) loom result:** model under `experiments/EXP-032/src/lib.rs` mirrors `WebWorker { live_next, live_prev, vm }` as `loom::cell::UnsafeCell` fields, `live_workers::{MUTEX, HEAD}` as `loom::sync::Mutex<()>` + `AtomicUsize`, and ports `register` / `unregister` / `terminate_sweep` to use `.with`/`.with_mut` accesses identical to the production `Cell::get`/`Cell::set` call sites at `web_worker.rs:262-303` and `:352-373`. Three tests cover (1) 1 register + 1 sweep on a single worker, (2) 2 concurrent registers + 1 sweep on two workers, (3) `vm` Cell publish/read serialised by `vm_lock`. All three are clean under `RUSTFLAGS="--cfg loom" cargo +nightly test --release --lib` — every Cell access inside `register` / `unregister` / `terminate_sweep` is serialised by `live_workers::MUTEX`, and the `vm` Cell access is serialised by `vm_lock`. Negative-control sanity test (`loom_sanity_unsynchronized_sweep_should_race`, `#[ignore]`d) drops the mutex from the sweep and is immediately caught by loom ("Causality violation: Concurrent read and write accesses"). So the default-pass result is non-vacuous evidence that the mutex discipline closes the race window.
- **Phase 5 (Codex conceptual correction, 2026-05-16):** `!Sync` is a safe-code auto-trait boundary, not itself a UB rule. Unsafe code may share a `!Sync` type across threads if it upholds the actual memory-model invariants. The source and loom model show the `Cell` accesses are serialized by `live_workers::MUTEX` / `vm_lock`; no unsynchronized access or invalid aliasing witness remains. Detailed note: `phase5_exp032_webworker_cell_conceptual_review.md`. Verdict demoted to `NO_EVIDENCE`; keep `AtomicCell` / marker hardening if the team wants stronger local invariants.

---

## EXP-033: `bun_threading::Channel::{try_read_item, read_item}` materialize `&mut [T]` over uninitialized storage

**Finding ref:** NEW-U-1 in `phase4_unified_findings.md`; Bucket 5 sweeper §2 NEW-U-1.
**Section:** P (sys-io-event-loop-threading) — `src/threading/channel.rs:121-142, 208-242`
**Bucket:** 5 (Uninit) + 11 (Panic Safety)
**Severity (Phase 2):** NO_EVIDENCE for current production UB under Bun's `panic = "abort"` profiles; panic-policy hardening / regression guard for unwind-enabled builds
**Hypothesis:** `Channel::try_read_item` and `Channel::read_item` declare `let mut items: [MaybeUninit<T>; 1]`, then cast that storage to `&mut [T; 1]` via `as_mut_ptr().cast::<[T; 1]>()` before the channel has written any element. This is not justified by the current `T: Copy` bound: `Copy` does **not** imply "every byte pattern, including uninitialized bytes, is a valid `T`." A `T = bool` instantiation is enough to make the materialized `&mut [T]` invalid until the slot has actually been written. Safe-by-luck today: every observed in-tree `Channel<T>` instantiation uses payloads such as raw pointers or integer-like POD values, but the public generic API permits validity-bearing `Copy` types.

**Minimal reproducer:**
```rust
// experiments/EXP-033/src/main.rs
use core::mem::MaybeUninit;

fn channel_read_items_shape() {
    let mut items: [MaybeUninit<bool>; 1] = [MaybeUninit::uninit()];
    let slice = unsafe { &mut *items.as_mut_ptr().cast::<[bool; 1]>() };
    if std::hint::black_box(slice[0]) {
        std::hint::black_box(());
    }
}
fn main() { channel_read_items_shape(); }
```

**Expected signal:** Miri reports a read of uninitialized memory when the witness observes the invalid `bool` through the prematurely materialized `&mut [bool; 1]`.

**Falsifiability:** if the implementation changes to keep the temporary storage typed as `MaybeUninit<T>` until after `read_items` writes a slot, or if `Channel<T>` is constrained to a sealed "plain-old-data/all-bit-patterns-valid" trait, close or reclassify.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-033
MIRIFLAGS="" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-033.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Fix: implementation should pass `&mut [MaybeUninit<T>]` into the read path and use `MaybeUninit::write` for initialized slots, only creating `&mut [T]` / reading `T` after the returned count proves initialization.
- Cross-bucket with Bucket 11: a panic between writing a slot and `assume_init_read` would leak initialized payloads unless the implementation tracks initialized count.
- The prior Drop-based witness was too broad because current Bun constrains `Channel<T>` to `T: Copy`. The corrected witness uses `T = bool`, which is source-faithful (`bool: Copy`) and still validity-bearing.
- **Phase 5 (Miri, 2026-05-16; corrected source-faithful witness):** Confirmed UB. Standalone repro at `experiments/EXP-033/` with `T = bool`. Miri: `Undefined Behavior: reading memory at alloc109[0x0..0x1], but memory is uninitialized at [0x0..0x1]` at `std::hint::black_box(slice[0])`, after materializing `&mut [bool; 1]` over `[MaybeUninit<bool>; 1]`. Log: `phase5_experiment_results/EXP-033.log`.

---

## EXP-034: `install/migration.rs:1492-1493` set_len-over-cursor — same shape as EXP-005 in npm migrate path

**Finding ref:** NEW-U-2 in `phase4_unified_findings.md`; Bucket 5 sweeper §2 NEW-U-2; Section L Phase-1 explicit cross-ref.
**Section:** L (install-and-pkg-manager) — `src/install/migration.rs:1490-1494, 1499-1518`
**Bucket:** 5 (Uninit) + 4 (Validity)
**Severity (Phase 2):** MUST-BE-UB
**Hypothesis:** Structurally identical to EXP-005: `set_len(res_cursor)` on `this.buffers.resolutions` / `this.buffers.dependencies` after a populate loop that contains multiple `continue 'dep_loop` shortcuts. If any path bumps `deps_cursor` without bumping `res_cursor` (or vice versa), `set_len` covers slots that were never written. The `#[cfg(debug_assertions)]` block at `:1499-1518` spot-checks `Behavior::default()` and `UNSET_PACKAGE_ID` sentinels — but only in debug. Production type contains `DependencyVersionTag` (`#[repr(u8)]`, 10/256 valid), so the slot reads validity-fail under Miri.

**Minimal reproducer:** mirror of `experiments/EXP-005/src/main.rs` adjusted for the migration code path: construct a `Vec<Dependency>` reserved capacity, run an EXP-005-shaped pop-and-skip loop that increments cursor inconsistently, `set_len` to the higher of the two, then read the validity-bearing tag.

**Expected signal:** Miri reports the same `Uninitialized memory occurred at alloc<...>` shape as EXP-005, fired by `DependencyVersionTag` validity invariant.

**Falsifiability:** if every continue-loop in the npm migrate path provably bumps both cursors in lockstep (call-graph proof), demote to SUSPICIOUS / requires-call-graph-check.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-034
MIRIFLAGS="-Zmiri-strict-provenance -Zmiri-ignore-leaks" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-034.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Supply-chain reachable via `bun install` against a hostile npm `package-lock.json` containing a `patchedDependencies` entry that exercises the migrate path.
- Same fix template as EXP-005: replace `set_len` with `Vec::push` per slot or use a validity-tracking wrapper.
- **Phase 5 (Miri, 2026-05-16):** Confirmed UB. Standalone repro at `experiments/EXP-034/` mirrors the lockfile `Dependency` shape (`NonZeroU32` ids + `DependencyVersionTag` `#[repr(u8)]` 10/256-valid) and reproduces the EXP-005 set_len-over-cursor shape. Miri (`-Zmiri-strict-provenance -Zmiri-ignore-leaks`): `Undefined Behavior: reading memory at alloc212[0x8..0x9], but memory is uninitialized` at `std::ptr::read(&dep0.version_tag)`. Same failure class and witness as EXP-005, fired at the `DependencyVersionTag` validity site. Log: `phase5_experiment_results/EXP-034.log`.

---

## EXP-035: `StandaloneModuleGraph` `read_unaligned::<CompiledModuleGraphFile>` reads 4 sparse enums from tampered Mach-O `__BUN` section

**Finding ref:** NEW-V-1 in `phase4_unified_findings.md`; Bucket 4 sweeper §3.1; Section M phase-1 flagged as Phase-3 surface.
**Section:** M (bundler-and-transpiler, but reader lives in standalone_graph) — `src/standalone_graph/StandaloneModuleGraph.rs:230-246, 577-580`
**Bucket:** 4 (Validity) + 6 (Type pun via read_unaligned)
**Severity (Phase 2):** MUST-BE-UB
**Hypothesis:** `let module: CompiledModuleGraphFile = unsafe { core::ptr::read_unaligned(modules_list_base.add(i)) };` where `CompiledModuleGraphFile` contains four closed enums: `Encoding` (3/256 valid), `Loader` (21/256), `ModuleFormat` (3/256), `FileSide` (2/256). Any single tampered byte outside the live discriminant set is immediate validity UB at the `read_unaligned` materialisation. Combined `(2 × 3 × 21 × 3) / 256^4 ≈ 8.8 × 10^-8`; once an attacker can tamper the `__BUN` module bytes, a single invalid enum byte is sufficient to trigger the validity violation.

**Minimal reproducer:**
```rust
// experiments/EXP-035/src/main.rs
#[repr(u8)] enum Loader { Js, Ts, Tsx, Jsx, /* ...21 valid */ }
#[repr(u8)] enum Encoding { Utf8, Latin1, Utf16 }
#[repr(C)] struct CompiledModuleGraphFile { loader: Loader, encoding: Encoding, /* etc. */ pad: u8 }

fn main() {
    let tampered: [u8; 4] = [0xff, 0x00, 0x00, 0x00]; // loader = 0xff (invalid)
    let module: CompiledModuleGraphFile = unsafe {
        core::ptr::read_unaligned(tampered.as_ptr().cast())
    };
    // Materializing the value with an invalid `loader` is UB at the read_unaligned point.
    let _ = module.loader;
}
```

**Expected signal:** Miri reports `constructing invalid value at .loader.<enum-tag>, encountered 0xff, but expected a valid enum tag`.

**Falsifiability:** if Miri is clean (somehow), inspect whether the read truly materialises `Loader` or whether the type-system delays validity until a use site. Either way the fix is to gate per-enum via `try_from_repr` or a defensive transparent newtype before the `read_unaligned`.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-035
MIRIFLAGS="" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-035.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Attack model: a tampered Bun-built standalone executable (`bun build --compile`). Any developer/CI runner that executes a downloaded standalone binary has reached this path. **Supply-chain blast radius equivalent to PUB-INSTALL anchors.**
- Same structural fix as EXP-003/006: defensive transparent newtype + checked decode per enum byte before materialisation.
- Section M phase-1 note explicitly flags as Phase-3 candidate; no EXP entry existed before this Phase 4.
- **Phase 5 (Miri, 2026-05-16):** Confirmed UB. Standalone repro at `experiments/EXP-035/` mirrors `CompiledModuleGraphFile` with all four niche-bearing enums (`Loader` 21/256, `Encoding` 3/256, `ModuleFormat` 3/256, `FileSide` 2/256) and tampers byte 0 to `0xff`. Miri: `Undefined Behavior: constructing invalid value of type CompiledModuleGraphFile: at .loader.<enum-tag>, encountered 0xff, but expected a valid enum tag` — fires at the `core::ptr::read_unaligned` materialisation point, exactly as hypothesised. Confirms the tampered-standalone-binary validity hazard and its supply-chain relevance when such binaries are distributed or executed. Log: `phase5_experiment_results/EXP-035.log`.

---

## EXP-036: `Buffers::read_array::<PatchedDep>` validity-fails on `patchfile_hash_is_null: bool` for bytes `2..=255`

**Finding ref:** NEW-V-2 in `phase4_unified_findings.md`; Bucket 4 sweeper §3.2; Section L Phase-1 note.
**Section:** L (install-and-pkg-manager) — `src/install/lockfile/bun.lockb.rs:590`; `src/install/lockfile.rs:3369-3378`
**Bucket:** 4 (Validity)
**Severity (Phase 2):** MUST-BE-UB
**Hypothesis:** `Buffers::read_array<T: Copy>` at `Buffers.rs:104-178` does `bun_core::ffi::slice(stream.buffer.as_ptr().add(start_pos).cast::<T>(), ...).to_vec()` — bytes verbatim from disk reinterpreted as `[PatchedDep]`. Rust `bool` has validity `{0, 1}`; bytes `2..=255` at the `patchfile_hash_is_null` offset are immediate validity UB when `read_array` materialises the `&[T]` view.

**Minimal reproducer:**
```rust
// experiments/EXP-036/src/main.rs
#[derive(Copy, Clone)]
#[repr(C)]
struct PatchedDep {
    patchfile_hash_is_null: bool,
    _padding: [u8; 7],
}

fn main() {
    let tampered: [u8; 8] = [0xff, 0, 0, 0, 0, 0, 0, 0]; // bool byte = 0xff
    let view: &[PatchedDep] = unsafe {
        core::slice::from_raw_parts(tampered.as_ptr().cast(), 1)
    };
    // Materialising the &[PatchedDep] view (or the to_vec()) is UB:
    let v: Vec<PatchedDep> = view.to_vec();
    let _ = v[0].patchfile_hash_is_null;
}
```

**Expected signal:** Miri reports `constructing invalid value at [0].patchfile_hash_is_null, encountered 0xff, but expected a boolean`.

**Falsifiability:** if Miri tolerates the `slice::from_raw_parts` until field access — confirm at the actual field read site; either way the fix is to bound `read_array<T: LockfileArrayElem>` with hand-audited per-`T` impls (structural fix point #1).

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-036
MIRIFLAGS="" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-036.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Attack model: hostile `bun.lockb` containing `patchedDependencies` entry. Reachable on every `bun install` against such a lockfile.
- **First lockfile reader whose `T` carries a validity-bearing field** — validates Section L's recommendation that `read_array` needs a `LockfileArrayElem` bound.
- Does **not** close EXP-003/005/006/007 — those land at different layers per Section L's correction.
- Phase 5 standalone reproducer at `experiments/EXP-036/src/main.rs` mirrors `PatchedDep`'s `patchfile_hash_is_null: bool` and feeds it through a `Buffers::read_array`-shaped `slice::from_raw_parts<PatchedDep>(...) .to_vec()`. Miri reports `Undefined Behavior: constructing invalid value of type bool: encountered 0xff, but expected a boolean` at the field read; raw log: `phase5_experiment_results/EXP-036.log`. Verdict promoted OPEN → CONFIRMED_UB.

---

## EXP-037: Windows `WindowsWatcher::Action` enum read from `ReadDirectoryChangesW` IO buffer — resolved by checked match in current source

**Finding ref:** NEW-V-3 in `phase4_unified_findings.md`; Bucket 4 sweeper §3.3.
**Section:** P (sys-io-event-loop-threading) — `src/watcher/WindowsWatcher.rs:55, 196-211`
**Bucket:** 4 (Validity)
**Severity (Phase 2):** RESOLVED / stale candidate
**Hypothesis:** The Phase-2 candidate assumed `FILE_NOTIFY_INFORMATION.Action` was transmuted directly into Bun's 5-variant `WindowsWatcher::Action` enum. That shape would be immediate UB for any future/adversarial action code outside Win32's documented `FILE_ACTION_*` 1..=5 set. Current `origin/main` does **not** do that: `src/watcher/WindowsWatcher.rs:196-211` matches the raw `DWORD` and skips unknown actions before constructing `Action`.

**Minimal reproducer:**
```rust
// experiments/EXP-038/src/main.rs (on-disk witness for design-doc EXP-037)
#[repr(u32)] enum Action { Added = 1, Removed = 2, Modified = 3, RenamedOldName = 4, RenamedNewName = 5 }

fn main() {
    let bytes: [u8; 4] = [0xff, 0xff, 0xff, 0xff]; // kernel returns 0xffffffff
    let action: Action = unsafe { core::mem::transmute(bytes) };
    let _ = action;
}
```

**Expected signal:** The standalone stale-shape reproducer reports `constructing invalid value: encountered 0xffffffff, but expected a valid enum tag`; current Bun's checked `match` should not.

**Falsifiability:** source-side falsification already happened: the live code does a checked raw-`DWORD` match. Reopen only if a future edit reintroduces `transmute`, `read_unaligned::<Action>`, or equivalent enum materialization from the IO buffer.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-038
MIRIFLAGS="" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-038.log
```

**Verdict:** RESOLVED

**Notes:**
- The on-disk reproducer at `experiments/EXP-038/src/main.rs` remains useful as a negative pattern: it mirrors what a direct `transmute` from a raw kernel `DWORD` would do. It is **not** a witness of current Bun source.
- Current source has the correct shape:
  - raw kernel value: `info.Action`
  - checked match at `src/watcher/WindowsWatcher.rs:196-211`
  - unknown values advance/skip the record rather than constructing `Action`
- This should be kept as a regression guard / lint candidate, not counted as a current confirmed UB finding.

---

## EXP-038: `AnyTaskJob<C>::run_task` lacks `catch_unwind` — panic across WorkPool callback FFI boundary

**Finding ref:** NEW-U-PS-1 in `phase4_unified_findings.md`; Bucket 11 sweeper §NF-1; Section K open question #4.
**Section:** K (jsc-core) + F (server + jsc_hooks) — `src/jsc/any_task_job.rs:141-153, :80-83`
**Bucket:** 11 (Panic Safety) + 18 (FFI / cross-thread)
**Severity (Phase 2):** NO_EVIDENCE for current production UB under Bun's `panic = "abort"` profiles; panic-policy hardening / regression guard for unwind-enabled builds.
**Hypothesis:** `AnyTaskJob::run_task` invokes `job.ctx.run(vm.global)` (line 147) followed by `enqueue_task_concurrent(...)` (line 151) with **no `catch_unwind` barrier**. Under a `panic = "unwind"` build, a panic from `C::run` would skip the enqueue and leak the job. Current Bun dev/release profiles use `panic = "abort"`, so that unwind path is not the configured production execution model.

**Minimal reproducer:**
```rust
// experiments/EXP-039/src/main.rs
// (on-disk witness for design-doc EXP-038; see registry legacy-artifact note)
struct PanickyCtx;
impl PanickyCtx { fn run(&mut self) { panic!("boom"); } }

fn workpool_thread_main(mut ctx: PanickyCtx) {
    // Simulate AnyTaskJob::run_task — no catch_unwind:
    ctx.run();
    // Never reached: completion enqueue
    println!("never reached");
}

fn main() {
    let handle = std::thread::spawn(|| {
        workpool_thread_main(PanickyCtx);
    });
    let r = handle.join();
    // Assert: handle.join() returns Err(payload); JS-side never received completion.
    assert!(r.is_err(), "expected thread panic");
}
```

**Expected signal:** `handle.join().is_err()`; the JS-side completion path is never invoked. Run under TSan or LSan to confirm `KeepAlive::ref_` leak.

**Falsifiability:** if Bun's `bun_threading::ThreadPool` actually installs `catch_unwind` upstream of `run_task`, demote to SUSPICIOUS and document the location of the barrier.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-039
cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-039.log
```

**Verdict:** NO_EVIDENCE (current Bun profiles abort on panic; the unwind/leak witness applies only to a hypothetical `panic = "unwind"` build)

**Notes:**
- Phase 5 confirms a panic-safety bug only for an unwind-enabled model. Under Bun's configured `panic = "abort"` profiles, Rust panics terminate via the crash-handler hook before unwinding, so the leak / Drop-skip / promise-never-resolves path does not materialise in a continuing process.
- Co-authored with Section K Phase-1 open question #4 ("What happens if WorkPool panic-aborts mid-`run_task`? Should `AnyTaskJobCtx::run` carry an `UnwindSafe` bound or document that panics abort the process?").
- Remediation under current Bun policy: document that `AnyTaskJobCtx::run` panics are fatal and keep the panic-abort profile invariant. A `catch_unwind` wrapper would only make sense if Bun deliberately re-enabled unwinding for this path.
- Phase 5 standalone reproducer at `experiments/EXP-039/src/main.rs` (NB: on-disk experiment directory is `EXP-039/` per the Phase-5 executor sweep numbering; finding maps to design-doc EXP-038) mirrors `AnyTaskJob` as a heap-allocated struct holding a `KeepAlive`-analogue `Box<()>`, dispatches `run_task` on a worker thread, and panics inside the `C::run` analogue with no `catch_unwind` around the body. Result under the standalone `panic = "unwind"` model: the trailing teardown enqueue is skipped (`teardown_enqueues == 0`), the heap allocation is never reclaimed (`LIVE_JOBS == 1`), and Miri additionally reports `error: memory leaked: alloc254 (Rust heap, size: 8, align: 8)` for the `KeepAlive`-analogue `Box`. Raw log: `phase5_experiment_results/EXP-039.log`. This is a useful regression guard if Bun ever re-enables unwinding here; it is not current production UB under the repo's `panic = "abort"` profile.
- **Phase 5 policy correction (2026-05-16):** demoted to `NO_EVIDENCE` for current production UB. Bun sets `panic = "abort"` in dev and release profiles, and `src/bun_core/lib.rs:2701-2707` / `src/crash_handler/lib.rs:1797-1804` explicitly document that `catch_unwind` is unreachable because the panic hook aborts before unwinding. The standalone witness remains valid only for a hypothetical unwind-enabled build. See `phase5_exp038_panic_abort_reclassification.md`.
- Source-local comments still contain unwind-era phrasing in a few places (`BinLinkingShim.rs:158`, `PackageManagerEnqueue.rs:1725-1729`, and the Phase-A `DevServer.rs` draft's `panic!()` contrast comments). Those are hardening/stale-comment cleanup items, not evidence that current production profiles unwind; root `Cargo.toml` remains the authority for this verdict.

---

## EXP-039: `Listener.rs` `ptr::read` → `mem::forget` panic-window regression guard (2 live panic-prone sites)

**Finding ref:** NEW-U-PS-2 in `phase4_unified_findings.md`; Bucket 11 sweeper §NF-2; Section E Phase-1 §5.
**Section:** E (runtime-socket-udp-tcp) — `src/runtime/socket/Listener.rs:235, 317`
**Bucket:** 11 (Panic Safety) + 13 (Refcount / Drop pairing)
**Severity (Phase 2):** NO_EVIDENCE for current production UB under Bun's `panic = "abort"` profiles; panic-policy hardening / regression guard for unwind-enabled builds.
**Hypothesis:** The two `listen()` sites at `src/runtime/socket/Listener.rs:235` and `:317` do:
```
let handlers_moved: Handlers = unsafe { core::ptr::read(&socket_config.handlers) };
let protos_taken = socket_config.ssl.as_mut().and_then(|s| s.take_protos()); // may panic (Vec::with_capacity OOM)
let default_data = socket_config.default_data;
let ssl_cfg_taken = socket_config.ssl.take();
core::mem::forget(socket_config);
```
Under an unwind-enabled model, a panic between line 1 (`ptr::read`) and line 5 (`mem::forget`) leaves `socket_config` un-forgotten. The compiler-inserted unwind runs `Drop for SocketConfig`, which runs `Drop for Handlers` on bytes the `ptr::read` already moved into `handlers_moved` → **double-free / double-drop UB**.

**Scope correction (Codex 2026-05-16):** the previous wording claimed four production sites at `:235, :317, :1069, :1289` all had the same panic-prone window. Re-checking latest fetched `origin/main@e750984db6` and audited base `4d443e5402` shows only `:235` and `:317` call allocation-prone `take_protos()` before `mem::forget`. The connect-path sites now at `:1069` and `:1296` move `ssl` with `Option::take()` immediately before `mem::forget`; the allocation-prone `take_protos()` calls occur later, after `socket_config` has been forgotten. They should not be counted in this EXP unless a separate panic-prone operation is proven in their pre-`mem::forget` window.

**Minimal reproducer:**
```rust
// experiments/EXP-039/src/main.rs
struct Handlers { buf: Box<u32> }
struct SocketConfig { handlers: Handlers, ssl: Option<Box<u8>> }
impl Drop for SocketConfig { fn drop(&mut self) { println!("Drop SocketConfig"); } }
impl Drop for Handlers { fn drop(&mut self) { println!("Drop Handlers (free Box)"); } }

fn take_protos(_s: &mut Box<u8>) { panic!("OOM"); }

fn main() {
    let config = SocketConfig {
        handlers: Handlers { buf: Box::new(42) },
        ssl: Some(Box::new(1)),
    };
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _handlers_moved: Handlers = unsafe { core::ptr::read(&config.handlers) };
        // PANIC HERE — config still un-forgotten:
        take_protos(config.ssl.as_mut().unwrap());
        core::mem::forget(config); // never reached
    }));
    // Drop ran twice on `handlers.buf` — double-free observable as Miri UB or ASan heap-buffer-overflow.
    assert!(result.is_err());
}
```

**Expected signal:** Miri reports `attempting to use uninitialised data, type Box<u32>` on the second drop, or ASan reports double-free.

**Falsifiability:** if Bun's supported build profiles continue to enforce `panic = "abort"` and no supported `panic = "unwind"` profile is used for these paths, this remains a regression guard rather than current production UB. If a supported unwind-enabled profile is introduced, or if a non-aborting panic source is proven in the `:235` / `:317` window under that profile, promote back to current UB.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-039
cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-039.log
```

**Verdict:** NO_EVIDENCE

**Notes:**
- Remediation if Bun ever supports unwinding here: reorder so that `take_protos` runs before the `ptr::read(&handlers)`, or use a guard that owns/drops exactly one copy of the half-moved state on unwind.
- **Phase 5 result (2026-05-16):** standalone reproducer at `experiments/EXP-039-listener-panic/src/main.rs` (the on-disk dir `EXP-039/` was already taken by design-doc EXP-038's off-by-one allocation, so this finding uses the suffixed dir). It mirrors the `ptr::read → take_protos panic → mem::forget` pattern with `Handlers { buf: Box<u32> }` and a `take_protos` that panics. Miri (default Stacked Borrows) confirms the unwind-model double-drop: `Drop for Handlers` runs first on the bit-copy minted by `ptr::read`, freeing the `Box<u32>`, then `Drop for SocketConfig`'s recursive drop runs `Drop for Handlers` *again* on the original `config.handlers` whose backing was just freed — `error: Undefined Behavior: constructing invalid value of type std::boxed::Box<u32>: encountered a dangling box (use-after-free)`. Raw log: `phase5_experiment_results/EXP-039-Listener.log`.
- **Policy correction (Codex 2026-05-16):** current Bun `dev`, `release`, release-derived, and `shim` profiles set `panic = "abort"`; `src/bun_core/lib.rs:2701-2707` and `src/crash_handler/lib.rs:1797-1804` document that panics abort before unwinding. Therefore this witness proves a real unwind-model hazard but should not be counted as current production UB. This is the same conceptual correction already applied to EXP-038.

---

## EXP-040: `S3HttpSimpleTask::Drop` `assume_init_mut` trip-hazard

**Finding ref:** NEW-U-PS-3 in `phase4_unified_findings.md`; Bucket 11 sweeper §NF-5.
**Section:** A (runtime-webcore) — `src/runtime/webcore/s3/simple_request.rs:476-495, 599-670`
**Bucket:** 11 (Panic Safety)
**Severity (Phase 2):** NO_EVIDENCE for current production UB; panic-safety hardening / future-reclaim trip-hazard
**Hypothesis:** `S3HttpSimpleTask::new(...)` initialises `http: MaybeUninit::uninit()`; pointer escapes via `bun_core::heap::into_raw(Box::new(init))`. After the escape at line 599-613, the call expression `task.http.write(AsyncHTTP::init(...))` begins at line 652, but Rust evaluates the `AsyncHTTP::init` arguments before `MaybeUninit::write` stores the initialized value. That means `task.headers.entries.clone().expect("OOM")` at line 655 can panic while `http` is still uninitialized. `Drop for S3HttpSimpleTask` at `:476-495` calls `unsafe { self.http.assume_init_mut() }.clear_data()` **unconditionally**. The "always initialised" preamble is false for the panic-window case. Today: leak-on-panic, no UB (raw pointer escape means no Drop on unwind). The Drop UB is reached only if a future code path reclaims the task via `heap::take` while in half-init state.

**Minimal reproducer:** `experiments/EXP-040/src/main.rs` injects a scopeguard around the `S3HttpSimpleTask::new` path that triggers Drop on panic, then panics at the line-655 analogue; Miri witnesses `assume_init_mut` UB in the future reclaim-on-unwind shape.

**Expected signal:** Miri reports `attempting to use uninitialised value of type AsyncHTTP` at the `assume_init_mut` call.

**Falsifiability:** if no panic site exists between task escape and `http.write(...)`, demote.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-040
MIRIFLAGS="" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-040.log
```

**Verdict:** NO_EVIDENCE (current production path leaks instead of dropping; Miri witness proves a future reclaim-on-unwind trip-hazard)

**Notes:**
- Add `initialized: bool` to `S3HttpSimpleTask` (or move `http` into `Option<AsyncHTTP>`); Drop skips `clear_data()` when not initialized. Defends against future refactors.
- Today's Drop unreachability is fragile — keep this as panic-safety hardening even though no current call-path materialises the UB.
- **Phase 5 result (2026-05-16):** standalone reproducer at `experiments/EXP-040/src/main.rs` models the post-refactor state where a `ReclaimOnUnwind` scopeguard (the natural leak-fix) reclaims the half-init `Box<S3HttpSimpleTask>` on panic. With `http: MaybeUninit<AsyncHttp>` left uninit (panic during argument evaluation before `MaybeUninit::write` stores the initialized `AsyncHTTP`), Drop unconditionally calls `assume_init_mut().clear_data()` → Miri reports `error: Undefined Behavior: reading memory at alloc216[0x8..0x10], but memory is uninitialized at [0x8..0x10], and this operation requires initialized memory` at `Vec::<u8>::as_mut_ptr` inside `AsyncHttp::clear_data`. Raw log: `phase5_experiment_results/EXP-040.log`. **Verdict shape:** confirmed *as a trip-hazard for the leak fix*, not confirmed current production UB — the production code today escapes the task via `Box::into_raw` before the panic site, so unwind cannot reach Drop and the bug manifests as a leak, not UB. The exact moment a reclaim path lands (which the leak fix demands), this becomes T1 unconditional UB. The recommended pre-fix is the `initialized: bool` (or `Option<AsyncHTTP>`) refactor.
- See `phase5_exp040_s3_trip_hazard_reclassification.md` for the source audit: current `on_response`/callback reclamation only occurs after `http.write` + schedule; the mid-init panic window has no owner that can run `Drop`.

---

## EXP-041: `WebSocketServerContext::active_connections_saturating_{add,sub}` writes through `addr_of!.cast_mut()` on `&self` — Bucket-14 canonical

**Finding ref:** F14-A / F-A14-A in `phase4_unified_findings.md`; Bucket 14 sweeper top-3.
**Section:** F (runtime-server-and-jsc-hooks) — `src/runtime/server/WebSocketServerContext.rs:79-96`
**Bucket:** 14 (`*const T` mutation) + 1 (Aliasing)
**Severity (Phase 2):** MUST-BE-UB
**Hypothesis:** `pub fn active_connections_saturating_add(&self, n: usize)` does `let p = core::ptr::addr_of!(self.active_connections).cast_mut(); *p = (*p).saturating_add(n);`. `&self` projects to `self.active_connections`; the resulting raw pointer inherits SharedReadOnly/frozen-mut-disallowed provenance. Writing through it is UB under Tree Borrows regardless of thread count. The TODO already names the fix (`Cell<usize>`).

**Minimal reproducer:**
```rust
// experiments/EXP-041/src/main.rs
struct Ctx { active_connections: usize }
impl Ctx {
    fn add(&self, n: usize) {
        let p = core::ptr::addr_of!(self.active_connections).cast_mut();
        unsafe { *p = (*p).saturating_add(n); }
    }
}
fn main() {
    let ctx = Ctx { active_connections: 0 };
    ctx.add(1);
    ctx.add(2);
    println!("{}", ctx.active_connections);
}
```

**Expected signal:** Miri Tree Borrows reports "write access ... is forbidden" at the `*p = ...` line.

**Falsifiability:** if Miri TB is clean (it should not be), the field is somehow not under SharedReadOnly; either way the fix is to convert to `Cell<usize>`.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-041
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-041.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Sibling sites: `subprocess.rs:265`, `Terminal.rs:373`, `cron.rs:1401`, `node_fs_watcher.rs:107`, `node_fs_stat_watcher.rs:550`, `interpreter.rs:894`, `JSTranspiler.rs:1192`, `dns.rs:4017`, `socket_body.rs:347`, `h2_frame_parser.rs:1340` — all `fn as_mut_ptr(&self) -> *mut Self { (self as *const Self).cast_mut() }`. Dormant landmines: cast itself does not write, but every caller writing through inherits the SharedReadOnly tag. Fix template lands once, removes all.
- The "single-threaded JS heap; `addr_of!` avoids materialising `&usize`" SAFETY argument confuses bucket 7 (races) with bucket 14 (mutation). `addr_of!` only avoids the *intermediate* `&usize` reborrow; the parent `&self → &self.active_connections` projection still installs read-only tag.
- Phase-5 Miri TB witness: `write access through <226> ... is forbidden` at `*p = (*p).saturating_add(n)`; the accessed tag is in state `Frozen`, created at the `fn add(&self, n: usize)` entry. The `addr_of!.cast_mut()` reborrow is denied at first write — Bucket-14 hypothesis confirmed exactly as stated. The as_mut_ptr cluster-site write was never reached because the first `add` aborted; symbolic equivalence is sufficient (same Frozen-tag root, same write-through-`*const`-derived raw pointer). Raw log: `phase5_experiment_results/EXP-041.log`.

---

## EXP-042: `runtime::cli::repl::vm_mut` forges `&mut VirtualMachine` from `&VirtualMachine` via `cast_mut`

**Finding ref:** F14-B / F-A14-B in `phase4_unified_findings.md`; Bucket 14 sweeper top-3.
**Section:** C (runtime-cli) — `src/runtime/cli/repl.rs:94-101`
**Bucket:** 14 (`*const T` mutation) + 1 (Aliasing)
**Severity (Phase 2):** MUST-BE-UB
**Hypothesis:** `#[allow(invalid_reference_casting)] fn vm_mut<'a>(vm: &'a VirtualMachine) -> &'a mut VirtualMachine` casts `core::ptr::from_ref(vm).cast_mut()` and dereferences as `&mut *ptr`. Even with `!Sync`/single-threaded execution, the function hands safe callers a mutable-reference capability derived from a shared reference; Miri Tree Borrows confirms UB when that capability is used for mutation. The single-thread argument addresses bucket 7 (races) but is silent on bucket 1 + bucket 14.

**Minimal reproducer:**
```rust
// experiments/EXP-042/src/main.rs
struct VM { counter: u32 }

#[allow(invalid_reference_casting)]
fn vm_mut<'a>(vm: &'a VM) -> &'a mut VM {
    let ptr: *mut VM = core::ptr::from_ref(vm).cast_mut();
    unsafe { &mut *ptr }
}

fn main() {
    let vm = VM { counter: 0 };
    let m = vm_mut(&vm);
    m.counter += 1;
    // Miri TB rejects at the `&mut *ptr` reborrow.
}
```

**Expected signal:** Miri Tree Borrows reports "attempting reborrow from disabled location" at the `&mut *ptr`.

**Falsifiability:** if Miri TB is clean (impossible barring borrow-checker workaround), the cast is somehow sound; either way the fix is to convert `VirtualMachine` interior fields to `Cell`/atomics or introduce a `RefCell` boundary.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-042
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-042.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- This is exactly the example rustc's `invalid_reference_casting` lint exists to catch — the `#[allow]` is the visible declaration of intent.
- Severity higher than EXP-041 because the cast immediately yields a `&mut T` API surface rather than only a raw pointer; the recorded Miri witness rejects the first write through that forged mutable reference.
- Phase-5 Miri TB witness: `write access through <234> ... is forbidden` at `m.counter += 1`; the accessed tag is a child of conflicting tag `<229>` (state `Frozen`), which was created at `core::ptr::from_ref(vm).cast_mut()`. Miri admits the `&mut *ptr` reborrow optimistically (Reserved) but rejects the first write because the parent `&vm` projection installed a Frozen tag. Hypothesis confirmed verbatim. Raw log: `phase5_experiment_results/EXP-042.log`.

---

## EXP-043: `runtime::cli::test::Scanner::resolve_dir_for_test` forges `&mut RealFS` from `&self.fs.fs`

**Finding ref:** F14-C / F-A14-C in `phase4_unified_findings.md`; Bucket 14 sweeper top-3.
**Section:** C (runtime-cli) — `src/runtime/cli/test/Scanner.rs:255-265, 365`
**Bucket:** 14 (`*const T` mutation) + 1 (Aliasing)
**Severity (Phase 2):** MUST-BE-UB
**Hypothesis:** `let real_fs = core::ptr::from_ref(&self.fs.fs).cast_mut(); #[allow(invalid_reference_casting)] unsafe { &mut *real_fs }.read_directory_with_iterator(...)`. The borrow chain is `&mut self → &self.fs (shared reborrow over &'a FileSystem) → &self.fs.fs (shared reborrow over &RealFS) → from_ref → cast_mut → &mut RealFS`. The `entries_mutex` defense only synchronizes data races, not aliasing tags.

**Minimal reproducer:** mirror of EXP-042 with sibling-projection through two shared reborrows; Miri TB witness expected.

**Expected signal:** Miri TB reports "attempting reborrow from disabled location" at the `&mut *real_fs`.

**Falsifiability:** as EXP-042.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-043
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-043.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Companion site at `Scanner.rs:365` for `Scanner::next(&mut self, ...)` has the same shape (`(&raw const self.fs.fs).cast_mut()`).
- Fix: store `RealFS` behind a `parking_lot::Mutex` and take `&Mutex<RealFS>` instead of cast-laundering.
- Phase-5 Miri TB witness: `write access through <238> ... is forbidden` at `self.counter = self.counter.wrapping_add(1)` inside `RealFS::read_directory_with_iterator(&mut self)`; the accessed tag is a child of conflicting tag `<234>` (state `Frozen`), created at `core::ptr::from_ref(&self.fs.fs).cast_mut()`. Same family as EXP-042 but with the projection-through-shared-reborrow shape (`&mut Scanner → &self.fs → &self.fs.fs → from_ref → cast_mut → &mut RealFS`). Hypothesis confirmed verbatim. Raw log: `phase5_experiment_results/EXP-043.log`.

---

## EXP-044: `bundler/bundle_v2.rs:1216, 1227, 1362, 1376` `&mut *self.bv2` JS-loop trampoline reborrow of `&mut BundleV2`

**Finding ref:** F-A-7/F-21-5 in `phase4_unified_findings.md`; Bucket 21 sweeper. Early Phase-2 notes briefly mis-referenced this BundleV2 issue as `EXP-030` before registry normalization; the canonical ID is `EXP-044` (`EXP-030` is now the ThreadPool::Queue loom model).
**Section:** M (bundler-and-transpiler) — `src/bundler/bundle_v2.rs:1216, 1227, 1362, 1376`; `src/runtime/api/JSBundler.rs:1387-1405`
**Bucket:** 21 (FFI callback aliasing) + 1 (Aliasing)
**Severity (Phase 2):** CONFIRMED_UB_SHAPE
**Hypothesis:** `Resolve` and `Load` plugin contexts each carry a `bv2: *mut BundleV2<'static>` raw backref. JS-loop trampolines `unsafe { &mut *self.bv2 }` while a bundler-thread worker may still hold a `&mut BundleV2`. Cross-thread same-allocation `&mut BundleV2` shape — same family as EXP-010 but on the root bundler object. The centralised `bv2_mut`/`bv2_plugin` helpers at `JSBundler.rs:1387-1405` document "single JS thread + disjoint heap" but the returned `&'a mut` lifetime is caller-chosen.

**Minimal reproducer:** `experiments/EXP-044/src/main.rs` stages the root pattern: an outer `bv2_mut()` call holds `&mut BundleV2`, a nested callback takes a second `bv2_mut()`, and the outer reference is used after the nested callback returns. This is the minimized two-borrow shape behind a plugin whose `onLoad` synchronously triggers another `JSBundlerPlugin__matchOnLoad`-style path.

**Expected signal:** Miri Tree Borrows fires on the second `&mut *bv2` reborrow.

**Falsifiability:** if no plugin code path produces overlapping `bv2_mut` calls (per-call-frame audit), demote to LIKELY-UB-LATENT and document the call-graph proof.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-044
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-044.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Canonical registry entry for the BundleV2 `self.bv2` reborrow family. Any remaining legacy prose that calls this `EXP-030` is stale; `EXP-030` now refers to `ThreadPool::Queue::cache`.
- Remediation: migrate to `*mut BundleV2` discipline + `BackRef`-based safe accessor mirroring `parse_task_mut(&mut self)` pattern at `bundle_v2.rs:1337-1341`.
- Phase-5 Miri TB witness: `read access through <237> ... is forbidden` at `outer.state = outer.state.wrapping_add(1)` after the inner `bv2_mut()` callback returned; accessed tag was `Reserved` then transitioned to `Disabled` due to a *foreign write* through the tag installed at the inner `inner.state = ...` reborrow. Two simultaneously-live `&mut BundleV2` from the same `self.bv2` raw pointer → first borrow disabled on second borrow's write; the post-callback re-read on `outer` is the UB site. Same family as EXP-010 B-2 on the parent `BundleV2` type, exactly as hypothesised. Raw log: `phase5_experiment_results/EXP-044.log`.

---

## EXP-045: `JsCell<T>` unbounded `unsafe impl Send/Sync` — sibling to EXP-019

**Finding ref:** F-S-1 / F-A-8 in `phase4_unified_findings.md`; Bucket 8 sweeper.
**Section:** K (jsc-core) — `src/jsc/JSCell.rs:126-128`
**Bucket:** 8 (Send/Sync) + 1 (Aliasing) + 7 (Data Races)
**Severity (Phase 2):** MUST-BE-UB
**Hypothesis:** `unsafe impl<T> Send/Sync for JsCell<T>` is unbounded while the public safe API exposes `JsCell::new(value)` and `JsCell::get(&self) -> &T`. Because a shared `static` requires `Sync`, the impl lets safe Rust construct a `static JsCell<Cell<u32>>`, share it across threads, and call safe `get().get()` / `get().set()` concurrently. Runtime: Miri reports a data race at the cross-thread `Cell` access.

**Minimal reproducer:**
```rust
// experiments/EXP-045/src/main.rs
use core::cell::{Cell, UnsafeCell};

#[repr(transparent)]
struct JsCell<T>(UnsafeCell<T>);
impl<T> JsCell<T> {
    const fn new(v: T) -> Self { JsCell(UnsafeCell::new(v)) }
    fn get(&self) -> &T { unsafe { &*self.0.get() } }
}
unsafe impl<T> Sync for JsCell<T> {}
unsafe impl<T> Send for JsCell<T> {}

static JC: JsCell<Cell<u32>> = JsCell::new(Cell::new(0));

fn main() {
    let h = std::thread::spawn(|| {
        for _ in 0..10_000 { JC.get().set(JC.get().get() + 1); }
    });
    for _ in 0..10_000 { JC.get().set(JC.get().get() + 1); }
    h.join().unwrap();
}
```

**Expected signal:** Miri reports `Data race detected between (1) non-atomic write on thread main and (2) non-atomic read on thread unnamed-1` at the `Cell` access.

**Falsifiability:** if Miri is clean (impossible for racing Cell), the impl is sound; demote.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-045
cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-045.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Confirmed 2026-05-16 with the faithful `UnsafeCell` + safe `get()` model in `experiments/EXP-045/`. Raw log: `phase5_experiment_results/EXP-045.log`.
- Fix: add `T: Send` / `T: Sync` bounds, same one-line shape as PR #30765's StoreSlice fix.
- Scope nuance: this confirms the generic public type contract is unsound. In-tree production exploitability still depends on whether any JS-affine `JsCell<T>` can be reached cross-thread, but the safe Rust API already permits UB in a standalone crate-shaped use.
- Cluster B in `phase4_unified_findings.md` — EXP-019 and `JsCell<T>` are the confirmed same-shape safe-API defects. The F-S-2/F-S-3 `SendPtr<T>` siblings are syntactically similar but now source-audited as private/function-local hardening targets, not confirmed UB.
- **Phase 5 (Miri/Loom, 2026-05-16) Tier-2:** Re-ran the standalone reproducer at `experiments/EXP-045/src/main.rs` (`#[repr(transparent)] struct JsCell<T>(UnsafeCell<T>)` with unbounded `unsafe impl<T> Sync/Send for JsCell<T>`, instantiated as `static CELL: JsCell<Cell<u32>>`, both main and worker threads loop `CELL.get().set(v.wrapping_add(1))`) under `cargo +nightly miri run`. Miri again reports `Undefined Behavior: Data race detected between (1) non-atomic write on thread main and (2) non-atomic read on thread unnamed-1` at `core/src/cell.rs:555` (the `unsafe { *self.value.get() }` in `Cell::get`), with the racing main-thread write located at `src/main.rs:33` (`CELL.get().set(v.wrapping_add(1))`). The static-field-only access path makes it unambiguous that the unbounded `unsafe impl<T> Sync for JsCell<T>` is the only thing letting `&CELL` cross threads — without it, `JsCell<Cell<u32>>: !Sync` (inheriting `!Sync` from the inner `Cell<u32>`) would reject the closure capture. Verdict CONFIRMED_UB preserved. Log: `phase5_experiment_results/EXP-045-tier2.log`.

---

## EXP-046: `WorkTask<C>` / `ConcurrentPromiseTask<C>` `unsafe impl Send` lacks `C: Send` on the Context trait

**Finding ref:** F-S-8 + F-S-9 in `phase4_unified_findings.md`; Bucket 8 sweeper current registry mapping.
**Section:** K (jsc-core) — `src/jsc/WorkTask.rs:58`; `src/jsc/ConcurrentPromiseTask.rs:55`
**Bucket:** 8 (Send/Sync) + 21 (FFI callback aliasing)
**Severity (Phase 2):** LIKELY-UB
**Hypothesis:** `unsafe impl<C: WorkTaskContext> Send for WorkTask<C>` and `unsafe impl<C: ConcurrentPromiseTaskContext> Send for ConcurrentPromiseTask<C>` lack a `C: Send` bound. The type-system gap is real, but the proof has to split the two wrappers: production `WorkTask<C>` stores `ctx: *mut C` (not an owned `C`), while `ConcurrentPromiseTask<C>` stores `ctx: Box<C>` and is closer to the owned-context witness.

**Minimal reproducer:** `experiments/EXP-046/src/main.rs` proves the generic owned-context laundering shape, but it is **not** a faithful `WorkTask<C>` layout model because production `WorkTask` stores `*mut C`. Treat it as a valid lower-bound witness for an owned-task wrapper and a strong design warning for `ConcurrentPromiseTask`, not as proof that current `WorkTask` drops an in-tree `C` off-thread.

**Expected signal:** compile-time impl-walker finds in-tree `Context` impls that are `!Send` while the wrapper-level `unsafe impl Send` still moves them across the work-pool boundary; Miri / TSan remains useful for per-context production exploitability, but the generic safe-API boundary is already proven unsound by the owned-wrapper witness.

**Falsifiability:** if every in-tree `WorkTaskContext` / `ConcurrentPromiseTaskContext` impl turns out to be Send, the trait-level missing-bound is a latent hazard only; tighten the bound preemptively.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-046
cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-046.log
```

**Verdict:** CONFIRMED_UB (unsafe-contract defect / generic safe-API boundary; per-context production exploitability remains follow-up)

**Notes:**
- Trait-level fix candidate: `pub trait WorkTaskContext: Sized + Send` (and similar for ConcurrentPromiseTaskContext). Breaking-change scope depends on impl-walker results.
- Cross-bucket with Cluster B in `phase4_unified_findings.md`.
- **Phase 5 (Miri/Loom, 2026-05-16) Tier-2:** `experiments/EXP-046/src/main.rs` confirms the owned-wrapper anti-pattern: if a task wrapper owns `C` and unsafely implements `Send` without `C: Send`, safe code can move a `!Send` `Strong`-like payload to a worker and Miri reports an `Rc` refcount data race. That is a useful witness for the **shape**, but the text above must not claim it is a verbatim `WorkTask` proof: production `WorkTask<C>` uses `ctx: *mut C`, and normal `ConcurrentPromiseTask` touches `JSPromiseStrong` on the JS-thread `then` path. Next experiment: an impl-walker that classifies every in-tree `Context` by (a) owned vs raw, (b) worker-side `run()` field touches, (c) drop thread, and (d) panic path.
- **Fresh-eyes correction (2026-05-16):** the reproducer header was tightened to say "generic owned-wrapper witness" explicitly. The Miri rerun at `phase5_experiment_results/EXP-046-rerun.log` still reports the expected `Rc` refcount data race. Current in-tree context inventory is small enough to audit by hand: WorkTask contexts are `WriteFile`, `ReadFile`, `GetAddrInfoRequest` (raw `*mut C` wrapper); ConcurrentPromiseTask contexts are `CopyFile<'_>`, `PipelineTask<'_>`, `TransformTask<'_>`, `WalkTask<'_>` (owned `Box<C>` wrapper).
- **Send-bound compile experiment (2026-05-16):** temporarily adding `+ Send` to both context traits and running `cargo check -p bun_runtime` fails on **all seven** real context impls with **57** `E0277` errors (`phase5_experiment_results/EXP-046-send-bound-check.log`; summary in `phase5_exp046_send_bound_check.md`). This closes the trait-level question: current source relies on wrapper-level unsafe `Send` to move non-`Send` contexts across the work-pool boundary. Per-context crash/exploitability is still a follow-up, but the safe abstraction boundary is unsound.

---

## EXP-047: `ThreadCell<T>` / `RacyCell<T>` `unsafe impl<T: ?Sized> Sync` unbounded — hardening issue, not confirmed Bun UB

**Finding ref:** F-S-5 + F-S-6 / F-DR-8 + F-DR-9 in `phase4_unified_findings.md`; Bucket 7 + 8 sweepers.
**Section:** N (bun_core-foundation) — `src/bun_core/atomic_cell.rs:503-504` (ThreadCell), `src/bun_core/util.rs:2276-2277` (RacyCell)
**Bucket:** 8 (Send/Sync) + 7 (Data Races)
**Severity (Phase 2):** HARDENING / CONTRACT-FRAGILITY
**Hypothesis:** Both `ThreadCell<T>` and `RacyCell<T>` have `unsafe impl<T: ?Sized> Sync` with no bound on `T`. ThreadCell's `assert_owner()` is debug-build-only and compiles away in release (line 484). RacyCell has no enforcement at all. Current main has 87 textual `RacyCell<...>` mentions and two real `ThreadCell` statics. The original concern was that `RacyCell<Cell<U>>` could become a safe-code data race.

**Minimal reproducer:**
```rust
// experiments/EXP-047/src/main.rs
use core::cell::Cell;

pub struct RacyCell<T: ?Sized>(core::cell::UnsafeCell<T>);
unsafe impl<T: ?Sized> Sync for RacyCell<T> {}

fn main() {
    let rc: &'static RacyCell<Cell<u32>> = Box::leak(Box::new(RacyCell(core::cell::UnsafeCell::new(Cell::new(0)))));
    let h = std::thread::spawn(move || {
        let inner = unsafe { &*rc.0.get() };
        for _ in 0..1000 { inner.set(inner.get() + 1); }
    });
    let inner = unsafe { &*rc.0.get() };
    for _ in 0..1000 { inner.set(inner.get() + 1); }
    h.join().unwrap();
}
```

**Expected signal:** Miri reports data race on the Cell::set.

**Falsifiability:** if Miri is clean (impossible), the type is somehow safe; tighten bound regardless.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-047
cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-047.log
```

**Verdict:** NO_EVIDENCE

Phase 5 correction, 2026-05-16: the original Miri log at `phase5_experiment_results/EXP-047.log` is a real data race in the standalone reproducer, but it dereferences the raw pointer inside caller-side `unsafe` blocks. That proves the contract can be violated; it does **not** prove `RacyCell` / `ThreadCell` expose an unsound safe API or that an in-tree payload currently races.

**Notes:**
- Safe-boundary check: `experiments/EXP-047-safe-boundary-bun-core/` compiles safe code that shares `&'static RacyCell<Cell<u32>>` / `&'static ThreadCell<Cell<u32>>` and calls `.get()` / `.get_unchecked()`, but Rust refuses to send the resulting raw pointer across threads (`*mut Cell<u32>` is not `Send`). Raw log: `phase5_experiment_results/EXP-047-safe-boundary-bun-core.log`.
- Workspace payload audit: only two real `ThreadCell` statics exist (`src/io/lib.rs:674`, `src/http/lib.rs:727`). Their cross-thread paths intentionally touch lock-free queues/wakers (`IoRequestLoop::schedule`, `HTTPThread::schedule`) while thread-owned mutation goes through the owner thread. This is auditor-fragile but not currently a confirmed race.
- Keep as hardening: tighten `ThreadCell` / `RacyCell` naming and SAFETY comments, consider a `T: Sync`-bounded safe wrapper for ordinary uses, and reserve unconditional Sync for explicitly unsafe, private, per-site cells. Do **not** count EXP-047 in the confirmed-UB headline.

---

## EXP-048: `bun_ptr::TaggedPtr::get` / `TaggedPtr::to` centralised int-to-pointer round-trip — strict-provenance fix-point

**Finding ref:** F-P-4 in `phase4_unified_findings.md`; Bucket 2 sweeper §A row; structural fix point #4.
**Section:** N (bun_core-foundation) — `src/ptr/tagged_pointer.rs:53-56, 60-64`
**Bucket:** 2 (Provenance)
**Severity (Phase 2):** STRICT_PROVENANCE_FAIL (release-gate; central helper)
**Hypothesis:** `TaggedPtr::get<Type>` does `self.ptr_bits() as usize as *mut Type`; `TaggedPtr::to` does `self.0 as usize as *mut c_void`. Both are int-to-pointer casts. Under `-Zmiri-strict-provenance`, both are rejected. This is the central helper for true `TaggedPtr` / `TaggedPtrUnion` consumers. It does **not** automatically fix every row in the broader packed-pointer family: several F-P rows are custom bit-packers, FFI numeric-pointer boundaries, or layout-only integer-as-value slots.

**Minimal reproducer:**
```rust
// experiments/EXP-048/src/main.rs
struct TaggedPtr(u64);
impl TaggedPtr {
    fn pack<T>(p: *mut T) -> Self { Self(p as usize as u64 & 0xffff_ffff_ffff_ffff) }
    fn get<T>(&self) -> *mut T { (self.0 & 0xffff_ffff_ffff_ffff) as usize as *mut T }
}

fn main() {
    let b: Box<u32> = Box::new(42);
    let p = Box::into_raw(b);
    let tp = TaggedPtr::pack(p);
    let recovered: *mut u32 = tp.get();
    let v = unsafe { *recovered };
    println!("{}", v);
    let _ = unsafe { Box::from_raw(recovered) };
}
```

**Expected signal:** `MIRIFLAGS="-Zmiri-strict-provenance"` rejects with `unsupported operation: integer-to-pointer casts and ptr::with_exposed_provenance are not supported with -Zmiri-strict-provenance` at the `get()` cast.

**Falsifiability:** if strict-provenance is clean (impossible), the cast was somehow `ptr::with_exposed_provenance`-shaped already.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-048
MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-048.log
```

**Verdict:** DEFERRED (strict-provenance release-gate failure; not default-Miri/runtime UB; recheck when Bun adopts strict provenance as a gate)

**Notes:**
- **Strict-provenance is a release-gate decision, not a runtime-UB classification** — none of these cause default-Miri UB. This entry exists so strict-provenance adoption work has a single registry handle.
- Fix candidates: (a) `ptr::with_exposed_provenance` (still rejected by `-Zmiri-strict-provenance` but at least declares the dependency), (b) typed `NonNull<T>` + tag metadata in a wider repr (`u128` or struct).
- Directly covers: EXP-048 / F-P-4 (`TaggedPtr::get/to`) and any true `TaggedPtrUnion::{get,as_unchecked,ptr,ptr_unsafe}` caller. It also informs F-A-1 (`Sink.rs:1232`), because that site manually reaches through `TaggedPtrUnion::as_uintptr()`, but `as_uintptr()` is a separate integer-returning API and must be handled explicitly. It does **not** close F-P-1/F-P-2/F-P-3/F-P-8/F-P-9/F-P-10/F-P-11/F-P-12, which are independent packed-pointer or layout-only sites, and it does not apply to reviewed FFI numeric-pointer boundaries F-P-5/F-P-6/F-P-15.
- **Phase 5 result (2026-05-16):** `MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run` rejects with `unsupported operation: integer-to-pointer casts and ptr::with_exposed_provenance are not supported with -Zmiri-strict-provenance` at `src/main.rs:35` — the body of `TaggedPtr::get<T>`, `(self.0 & 0xffff_ffff_ffff_ffff) as usize as *mut T`. The fail is at the `usize → *mut T` cast, before the deref — the same shape as the production `TaggedPtr::get<Type>` at `src/ptr/tagged_pointer.rs:53-56`. Together with EXP-049 (`StringOrTinyString` bytes-to-ptr), EXP-050 (ZigString tag-bit OR/mask), and EXP-096 (`SmolStr` packed pointer bits), this is the **strict-provenance representation family**. Only EXP-048 is a `TaggedPtr` central-helper issue; EXP-049/050/096 each need their own representation change because they don't route through `TaggedPtr`.
- **Phase 5 policy correction (2026-05-16):** moved from `NEEDS_REFINEMENT` to `DEFERRED`; strict-provenance evidence is complete, but remediation is a release-gate adoption decision. See `phase5_strict_provenance_policy_reclassification.md`.

---

## EXP-049: `bun_core::StringOrTinyString::slice` reconstructs pointer from raw `usize::from_le_bytes` byte buffer

**Finding ref:** F-P-13 in `phase4_unified_findings.md`; Bucket 2 sweeper §A.
**Section:** N (bun_core-foundation) — `src/bun_core/string/immutable.rs:1076`
**Bucket:** 2 (Provenance) + 4 (Validity)
**Severity (Phase 2):** STRICT_PROVENANCE_FAIL (release-gate; separate representation rewrite)
**Hypothesis:** `let ptr = usize::from_le_bytes(ptr_bytes) as *const u8;` after `copy_nonoverlapping` reads 8 bytes from `remainder_buf`. This is a **pure bytes → usize → pointer reconstruction** — no `as usize as *` shortcut, just raw bytes turned into address bits. Strict-provenance fails unambiguously; the recovery cannot be made sound without a structural change to `StringOrTinyString`'s representation (carry the pointer typed, not byte-encoded).

**Minimal reproducer:**
```rust
// experiments/EXP-049/src/main.rs
fn main() {
    let buf: Box<[u8]> = Box::new([0u8; 32]);
    let raw = Box::into_raw(buf);
    let original_ptr = raw as *const u8 as usize;

    // StringOrTinyString init writes the ptr to a byte buffer:
    let mut remainder_buf = [0u8; 8];
    remainder_buf.copy_from_slice(&original_ptr.to_le_bytes());

    // StringOrTinyString::slice reads it back:
    let mut ptr_bytes = [0u8; 8];
    ptr_bytes.copy_from_slice(&remainder_buf[..8]);
    let ptr = usize::from_le_bytes(ptr_bytes) as *const u8;
    let v = unsafe { *ptr };
    println!("{}", v);

    let _ = unsafe { Box::from_raw(raw as *mut [u8; 32]) };
}
```

**Expected signal:** `MIRIFLAGS="-Zmiri-strict-provenance"` rejects at the deref of `ptr` because the integer round-trip stripped provenance.

**Falsifiability:** if strict-provenance is clean (impossible — bytes have no provenance metadata), the `StringOrTinyString` representation is somehow safe.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-049
MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-049.log
```

**Verdict:** DEFERRED (strict-provenance release-gate failure; not default-Miri/runtime UB; recheck when Bun adopts strict provenance as a gate)

**Notes:**
- The **only pure-byte-buffer pointer reconstruction** in the workspace.
- Fix requires a structural change: carry the typed pointer in the `StringOrTinyString` layout instead of byte-encoded.
- SAFETY comment at line 1078 cites lifetime, not provenance.
- **Phase 5 result (2026-05-16):** `MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run` rejects with `unsupported operation: integer-to-pointer casts and ptr::with_exposed_provenance are not supported with -Zmiri-strict-provenance` at `src/main.rs:36`, on `let ptr = recovered_addr as *const u8;` after the `usize::from_le_bytes(ptr_bytes)` byte→usize step. Confirms the structural diagnosis: bytes carry no provenance metadata, so even `ptr::with_exposed_provenance` cannot fix this site — `StringOrTinyString` has to carry the typed pointer directly in its layout. Part of the strict-provenance family with EXP-048, EXP-050, and EXP-096; **does not share `TaggedPtr` as a centralisation site** — needs its own representation rewrite.
- **Phase 5 policy correction (2026-05-16):** moved from `NEEDS_REFINEMENT` to `DEFERRED`; strict-provenance evidence is complete, but this is a representation migration tracked by policy, not an unproven production crash. See `phase5_strict_provenance_policy_reclassification.md`.

---

## EXP-050: `bun_alloc::ZigString` tag-bit mark/untag (5 sites) — hot path for Bun↔JSC string ABI

**Finding ref:** F-P-16 in `phase4_unified_findings.md`; Bucket 2 sweeper §A.
**Section:** O (alloc-and-collections) — `src/bun_alloc/lib.rs:925, 930, 935, 940, 946`
**Bucket:** 2 (Provenance) + 4 (Validity)
**Severity (Phase 2):** STRICT_PROVENANCE_FAIL (release-gate; hot-path separate representation rewrite)
**Hypothesis:** `ZigString` tag-bit setters: `((self._unsafe_ptr_do_not_use as usize) | ZS_*_BIT) as *const u8` (4 sites) and matching `untagged()` mask at `:946`. Every mark/untag operation strips provenance. Tag bits are stored in the **high** bits (16BIT/UTF8/GLOBAL/STATIC flags), so structure is identical to EXP-029 (`EnvStr`, low-48-bit truncation cousin), just with explicit OR/AND on the high bits.

**Minimal reproducer:** EnvStr-shaped mirror (see EXP-029) adjusted to use OR/AND on high bits instead of mask-of-low-48.

**Expected signal:** `MIRIFLAGS="-Zmiri-strict-provenance"` rejects at the deref of the recovered pointer.

**Falsifiability:** as EXP-029.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-050
MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-050.log
```

**Verdict:** DEFERRED (strict-provenance release-gate failure; not default-Miri/runtime UB; recheck when Bun adopts strict provenance as a gate)

**Notes:**
- **Strongest blast radius** of the strict-provenance family — ZigString is the cross-language string ABI between Bun and JSC; every JS string surfaced through `bun_core::String` traverses this.
- Fix requires representation change: carry typed pointer + separate tag byte, or use `ptr::with_exposed_provenance` (still strict-fail but declares the dependency).
- **Phase 5 result (2026-05-16):** `MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run` rejects at the **first** tag-OR step (`ZigString::mark_utf8` at `src/main.rs:56-57`, `((self._unsafe_ptr_do_not_use as usize) | ZS_UTF8_BIT) as *const u8`) before the program ever reaches `untagged()`. Mirror of the production sites at `src/bun_alloc/lib.rs:925, 930, 935, 940` — each of the 5 mark/untag operations strips provenance, but Miri short-circuits on the first one. Part of the strict-provenance family with EXP-048, EXP-049, and EXP-096; same `(int-bits) as *const _` shape, but the fix here is **not** a TaggedPtr centralisation — ZigString is an FFI-stable repr that the Zig/C++ side reads directly, so the structural fix has to preserve the layout (likely: separate `tag: u8` byte alongside `ptr: *const u8` rather than packing into the high bits, mirrored on both sides of the ABI).
- **Phase 5 policy correction (2026-05-16):** moved from `NEEDS_REFINEMENT` to `DEFERRED`; strict-provenance evidence is complete, but this is a Bun/JSC ABI migration tracked by policy, not an unproven production crash. See `phase5_strict_provenance_policy_reclassification.md`.

---

## EXP-051: `bun-native-plugin-rs::BunLoader` `(u8 as u32)` transmute into `#[repr(u32)]` enum lacks validity check

**Finding ref:** F-NF6-26 (NF-4) in `phase4_unified_findings.md`; Bucket 6 sweeper's BunLoader row.
**Section:** Plugin API — `packages/bun-native-plugin-rs/src/lib.rs:637`
**Bucket:** 6 (Type pun via transmute) + 4 (Validity)
**Severity (Phase 2):** MUST-BE-UB (hostile host)
**Hypothesis:** `(self.result_raw.loader as u8 as u32)` transmute into `#[repr(u32)]` `BunLoader` (variants `0..=12`). The source field is `u8` (cast back to `u32`), AND no validity check guards values `13..=255`. The cast is wrong twice: width mismatch (source u8 vs enum u32) and validity (any byte outside `0..=12` is UB).

**Minimal reproducer:**
```rust
// experiments/EXP-051/src/main.rs
#[repr(u32)] enum BunLoader { Js = 0, Ts = 1, /* ...12 valid */ }

fn main() {
    let hostile_byte: u8 = 0xff; // host sends invalid loader
    let loader: BunLoader = unsafe { core::mem::transmute(hostile_byte as u32) };
    let _ = loader;
}
```

**Expected signal:** Miri reports `constructing invalid value: encountered 0xff, but expected a valid enum tag`.

**Falsifiability:** if Miri is clean (impossible for hostile-byte input), the enum has somehow added an open variant.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-051
MIRIFLAGS="" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-051.log
```

**Verdict:** CONFIRMED_UB (Phase 5, 2026-05-16; reproducer at `experiments/EXP-051/`, Miri log at `phase5_experiment_results/EXP-051.log`).

**Notes:**
- Live public API surface; native addon authors are the attacker model.
- Low-level fix: change `BunLoader` to `#[repr(u8)]` (matches C struct field width) and validate the byte via hand-written `TryFrom<u8>` or `bytemuck::CheckedBitPattern` before constructing the enum.
- API rollout (Phase 8 v2): use option D, not the earlier v1 coexistence plan. Keep `output_loader(&self) -> BunLoader` source-compatible and safe, but remove the transmute by routing through the checked conversion with a documented legacy invalid-byte behavior (precise panic or sentinel default + warning). Add `try_output_loader(&self) -> Result<BunLoader, InvalidLoader>` as the recommended API and deprecate the legacy method with migration guidance. Do **not** change safe `fn` to `unsafe fn`; that is also a source-compatibility break and still does not eliminate misuse.
- Also closes adjacent **F-NF6-1** (`PropertyIdTag` u16 transmute, scanImportsAndExports.rs:1682) which has the same fix shape with `CheckedBitPattern`.
- **Phase 5 result (2026-05-16):** stable nightly Miri rejects with `Undefined Behavior: constructing invalid value of type BunLoader: at .<enum-tag>, encountered 0x000000ff, but expected a valid enum tag` at `src/main.rs:63:14`, on the `std::mem::transmute((*result_raw).loader as u32)` line — i.e. *at the transmute itself*, before any pattern match or downstream use. The width bug (`u8 as u32` widening to a four-byte zero-extended discriminant) is independently unsound: even if the host wrote a *valid* `0..=12` byte, the read is morally a `transmute<u32, BunLoader>` over a value that on a hostile/buggy host could be anything in `13..=255`. The same checked-bit-pattern shape closes F-NF6-1 (`PropertyIdTag` u16 transmute). **Cross-refs (also in `bun-native-plugin-rs/src/lib.rs`):** (a) `sys::OnBeforeParseArguments.default_loader: u8` at `sys.rs:146` is the symmetric input-side hazard — currently never read into a `BunLoader` from the safe wrapper, so latent rather than live, but should be re-audited if a future `input_loader()` getter is added; (b) `level: level as i8` at `lib.rs:673` and `BUN_LOG_LEVEL_ERROR as i8` at `lib.rs:442` widen a `#[repr(u32)]` `BunLogLevel` (0..=4) into a signed `i8` `BunLogOptions.level` field for the write path — sound today (all five discriminants fit in `i8`), but a future variant past `127` would silently wrap, and the read direction (if ever added) would have the identical UB shape as `BunLoader`. No new EXP entry filed (per role instructions); flagged here for Phase 4/6.

---

## EXP-052: `bun_threading::UnboundedQueue<T>` lock-free MPSC — loom model clean

**Finding ref:** F-DR-3 in `phase4_unified_findings.md`; Bucket 7 sweeper §"Lock-free queue / channel surfaces with no loom or TB on file".
**Section:** P (sys-io-event-loop-threading) — `src/threading/unbounded_queue.rs:216-369`
**Bucket:** 7 (Data Races)
**Severity (Phase 2):** DEFENSIBLE-BUT-UNVERIFIED
**Hypothesis:** Lock-free MPSC: producers CAS `back` then `Release`-store `next` on the previous tail; consumer Acquire-loads `front → next`, then CASes `front`. Three subtle points: (a) `push_batch` at `:263` `Release`-stores `next` AFTER the swap — reader that wins the CAS on `front` may spin on null `next` (handled by `hint::spin_loop` at `:324`); (b) `pop_batch` at `:345` `Relaxed`-swaps `back` (comment claims safe because front's Acquire syncs with push's Release); (c) `Link<T>` `get_next`/`set_next` are Relaxed (non-atomic-equivalent) — sound because only producer-owning or unique-consumer touches.

**Minimal reproducer:** `experiments/EXP-052/{src/lib.rs,tests/unbounded_queue_loom.rs}` is a loom 2-producer + 1-consumer model. It asserts no torn pointer and no value loss across the bounded interleavings.

**Expected signal:** loom finds an interleaving where the consumer observes a non-null `next` whose value was stored in a different epoch than the `front` Acquire-load (proving the Acquire-Release pair is insufficient).

**Falsifiability:** if loom is clean across all interleavings up to 4 producers × 8 pushes × 1 consumer × 8 pops, the lock-free MPSC is sound; document as regression guard.

**Invocation:**
```
RUSTFLAGS="--cfg loom" cargo +nightly test --release --test exp_052_unbounded_queue_loom 2>&1 | tee phase5_experiment_results/EXP-052.log
```

**Verdict:** NO_EVIDENCE (regression-guard loom model now on file; AcqRel/Acquire pair is loom-clean)

**Notes:**
- Per Section P open question #4 — "no loom or TB model on file" for any of the hand-rolled lock-free primitives. UnboundedQueue is the simplest (single consumer) and thus the easiest to model.
- Companion to EXP-030 (ThreadPool::Queue MPMC) — that's harder; do UnboundedQueue first as a methodology validator.
- **Phase 5 result (2026-05-16):** loom model at `experiments/EXP-052/{src/lib.rs,tests/unbounded_queue_loom.rs}` mirrors `push_batch :263` (AcqRel swap of `back`, Release-store of `next` on the prior tail) and `pop_batch :345` + spin @ :324 (Acquire-load of `front`, Acquire-load of `front.next`, advance front on success). 2-producer / 1-consumer harness with `LOOM_MAX_PREEMPTIONS=3`. Both the `correct_orderings_are_sound` test (AcqRel/Release/Acquire) and the `racy_relaxed_negative_control` test (all-Relaxed) pass — loom finds no torn-pointer or value-loss interleaving in either, across the bounded state space. Raw log: `phase5_experiment_results/EXP-052.log`. **Interpretation:** the Bun queue's AcqRel/Acquire pair is sufficient for the 2P/1C shape under loom (lock-free MPSC is a well-known sound pattern with these orderings). The Relaxed negative control did not fire in this particular harness — loom probes operational interleavings rather than strict TSO permissiveness, so a single-iteration test on this shape is not enough to force a Relaxed-induced anomaly. Treat as a methodology-validating regression guard, not a UB witness. To exercise the Relaxed variant more aggressively, scale to ≥3 producers and/or remove the `LOOM_MAX_PREEMPTIONS` cap — out of scope for the 50-min Tier-3 budget.

---

## EXP-053: `Source::get_handle` / `Source::to_stream` bypass the `UvHandle::as_handle_mut()` discipline via `.cast()`

**Finding ref:** F-10-1 in `phase4_unified_findings.md`; Bucket 10 sweeper §F-10-1; Section T Open Question #5.
**Section:** T (ffi-c-libs) / P (sys-io) — `src/io/source.rs:260, 270`
**Bucket:** 10 (FFI Contracts) + 21 (FFI callback aliasing)
**Severity:** NO_EVIDENCE / layout-drift hardening
**Hypothesis:** Direct `core::ptr::from_mut::<Pipe>(pipe.as_mut()).cast()` to `*mut uv_handle_t` / `*mut uv_stream_t` **without** going through `UvHandle::as_handle_mut()` / `UvStream::as_stream()`. SAFETY claims "uv::Pipe / uv::uv_tty_t embed uv_handle_t as their first member" — but that invariant is the very thing the `unsafe trait UvHandle` machinery exists to prove at compile time. A future refactor of `Pipe` that breaks the prefix invariant would compile cleanly.

**Minimal reproducer:** `experiments/EXP-053/src/main.rs` declares two `#[repr(C)]` "pipe" structs (one with a `uv_handle_t` prefix, one without) and exercises both code paths. The `.cast()` form accepts the broken layout and reads the wrong field; the trait-gated form refuses to compile for the broken layout.

**Expected signal:** the broken-layout build succeeds (proving the cast is too permissive); the `as_handle_mut()` form via `unsafe trait UvHandle` correctly fails to compile because `UvHandle` is not impl'd for the broken layout.

**Falsifiability:** if both forms catch the drift, the trait machinery is providing zero compile-time guard; in either case the source-level fix is to delete the direct `.cast()` and route through `as_handle_mut()`.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-053
cargo +nightly check 2>&1 | tee ../../phase5_experiment_results/EXP-053.log
```

**Verdict:** NO_EVIDENCE (latent layout-drift witness confirmed; current `Pipe` layout satisfies the prefix invariant)

**Notes:**
- Section T's Open Question #5 confirmed at a real site as hardening debt, not current UB.
- Fix: replace `.cast()` with `pipe.as_handle_mut()` / `pipe.as_stream()`.
- Closes a category of bug rather than a specific UB; LIKELY-LATENT-DRIFT severity reflects "the cast is sound today, but the discipline that protects against future drift is bypassed".
- Current-source closure (2026-05-16): `Pipe` is `#[repr(C)]`, implements both `UvHandle` and `UvStream`, and has layout asserts confirming `Pipe.data` is offset 0 (`src/libuv_sys/libuv.rs:3590`). Therefore the present cast is sound today; the issue is that `src/io/source.rs` bypasses the compile-time guard that would catch future layout drift. See `phase5_exp053_uvhandle_bypass_reclassification.md`.
- **Phase 5 result (2026-05-16):** the reproducer declares two `#[repr(C)]` pipe wrappers — `GoodPipe` (prefix invariant holds, impls `unsafe trait UvHandle`) and `BrokenPipe` (a 64-bit `generation` field at offset 0 displaces the `uv_handle_t` to offset 8, no `UvHandle` impl). Three verdict-confirming runs:
  1. `cargo +nightly check` on `src/main.rs` (the `.cast()` path) succeeds silently — the bypass admits the broken layout (`phase5_experiment_results/EXP-053.log`).
  2. `cargo +nightly run` confirms the runtime damage: `get_handle_via_cast(&mut broken)` returns a `*mut uv_handle_t` that, when deref'd, reports `data = 0xdeadbeef` (the misaligned `generation` field) instead of the zeroed `uv_handle_t::data` (`phase5_experiment_results/EXP-053_run.log`).
  3. `rustc +nightly --edition 2021 compile_fail_demo.rs` (which uncomments the `get_handle_via_trait(&mut broken)` call) fails with `error[E0277]: the trait bound BrokenPipe: UvHandle is not satisfied`, proving the trait discipline catches the drift the `.cast()` form silently accepts (`phase5_experiment_results/EXP-053_compile_fail.log`).
- The three-log triple is the canonical Bucket-10 latent-drift witness shape: `.cast()` accepts → runtime wrong-type read → trait form refuses to compile. **Fix is one line per call-site** (`pipe.as_handle_mut()` instead of `core::ptr::from_mut::<Pipe>(pipe.as_mut()).cast()`); the production sites are `src/io/source.rs:260` and `src/io/source.rs:270`.

---

## EXP-054: N-API `#[repr(C)]` POD structs lack layout asserts — every native addon depends on layout

**Finding ref:** F-10-2 in `phase4_unified_findings.md`; Bucket 10 sweeper §F-10-2.
**Section:** J (runtime-misc/napi) — `src/runtime/napi/napi_body.rs:512, 524, 536, 1985, 2032`
**Bucket:** 10 (FFI Contracts)
**Severity (Phase 2):** LIKELY-LATENT-DRIFT
**Hypothesis:** 5 `#[repr(C)]` POD structs (`napi_property_descriptor`, `napi_extended_error_info`, `napi_type_tag`, `napi_node_version`, `struct_napi_module`) are passed by value across the addon ABI, but **no `const _: () = assert!(offset_of!(...) == X)` ties their offsets to upstream `js_native_api.h` / `node_api.h`**. A field reorder or padding change in Bun's Rust mirror miscompiles every addon.

**Minimal reproducer:** `experiments/EXP-054/` is a C-side reflector that emits `sizeof(napi_property_descriptor)`, `offsetof(napi_property_descriptor, getter)` etc. from Bun's real N-API headers, plus a Rust compile-time mirror that asserts the values match Bun's `#[repr(C)]` definitions.

**Expected signal:** Build-script fails on any mismatch.

**Falsifiability:** N/A — this is a CI gate, not a UB witness.

**Invocation:**
```
CARGO_TARGET_DIR=/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-054/target \
  cargo +nightly run \
  --manifest-path /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-054/Cargo.toml \
  2>&1 | tee /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase5_experiment_results/EXP-054-layout-crosscheck.log
```

**Verdict:** NO_EVIDENCE (current x86_64 Linux / LP64 C-header layout matches the Rust mirrors; hardening still owed)

**Notes:**
- Raw log: `phase5_experiment_results/EXP-054-layout-crosscheck.log`.
- Audit note: `phase5_exp054_napi_layout_crosscheck.md`.
- N-API remains a high-leverage hardening gap because every native addon depends on layout being correct. But the experiment found no current C/Rust layout drift for the 5 audited structs on LP64, so this should not be counted as live UB.
- Fix: extend `bun_libuv_sys::assert_size!`/`assert_offset!` discipline to `napi_body.rs`; build-script cross-validates via a tiny C reflector. This is now structural hardening under EXP-063, not a confirmed bug.
- The same template should propagate to F-10-4 (Win32 ABI mirrors) and F-10-5 (BoringSSL crypto state), but those should likewise require a concrete mismatch before being counted as live UB.

---

## EXP-055: `bun_libuv_sys::HandleType` 18 hand-transcribed enum discriminants (`Unknown` plus 17 handle kinds) lack per-variant compile-time asserts

**Finding ref:** F-10-3 / F-P-14 in `phase4_unified_findings.md`; Bucket 10 sweeper §F-10-3.
**Section:** T (ffi-c-libs) — `src/libuv_sys/libuv.rs:257-276, :292, :976, :989`
**Bucket:** 10 (FFI Contracts) + 6 (Type pun)
**Severity (Phase 2):** LIKELY-LATENT-DRIFT
**Hypothesis:** The 18-discriminant `HandleType` enum (`Unknown` plus 17 handle kinds) is hand-transcribed from `uv.h`'s `uv_handle_type` enum (`UV_UNKNOWN_HANDLE`, the 16 `UV_HANDLE_TYPE_MAP` entries, and `UV_FILE`), but no `const _: () = assert!(HandleType::Tcp as c_int == 12)`-style assertions tie each discriminant to its upstream value. The range-checked transmute at `:292` proves "raw is in 0..=17" but **not** that the mapping is correct — an off-by-one in transcription would silently misclassify every handle. Also covers the `usize → fn-ptr` transmute at `:989` which assumes target-width parity.

**Minimal reproducer:** `experiments/EXP-055/` extracts libuv's `uv_handle_type` values (`UV_UNKNOWN_HANDLE`, the `UV_HANDLE_TYPE_MAP` entries, and `UV_FILE`) via a C reflector and verifies 18 Rust `const _: () = assert!(HandleType::X as c_int == N)` lines (`Unknown` through `File`).

**Expected signal:** Compile-time fail if any discriminant mismatches.

**Falsifiability:** N/A — this is a CI gate.

**Invocation:**
```
CARGO_TARGET_DIR=/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-055/target \
  cargo +nightly run \
  --manifest-path /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-055/Cargo.toml \
  2>&1 | tee /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase5_experiment_results/EXP-055-handle-type-crosscheck.log
```

**Verdict:** NO_EVIDENCE (vendored libuv header constants match Rust `HandleType`; function-pointer width parity holds on current target)

**Notes:**
- Raw log: `phase5_experiment_results/EXP-055-handle-type-crosscheck.log`.
- Audit note: `phase5_exp055_libuv_handle_type_crosscheck.md`.
- Current source has no evidence of a `uv_handle_type` mapping mismatch. Keep the compile-time assertions as hardening under EXP-063 / layout-lock infrastructure.
- Companion: `bun_libuv_sys::libuv.rs:989` (`usize → fn-ptr` transmute through `req.reserved[0]`) now has target-width parity evidence in the EXP-055 witness. That remains portability hardening, not a counted live UB finding.

---

## EXP-056: `NodeHTTPResponse::deref(&self)` zero-ref path deallocates through shared provenance

**Finding ref:** F-NHR-1 in `phase4_unified_findings.md`; Bucket 13 sweeper §7; Section F notes line 119/179 open question 3.
**Section:** F (runtime-server-and-jsc-hooks) — `src/runtime/server/NodeHTTPResponse.rs` (per Section F phase-1 note)
**Bucket:** 13 (Refcount lifecycle) + 21 (FFI callback aliasing)
**Severity (Phase 5):** CONFIRMED_UB — zero-ref destructor path
**Hypothesis:** `NodeHTTPResponse` uses `AnyRefCounted` with `rc_ref(this: *mut Self)` and `rc_deref_with_context(this: *mut Self, ())`, but the hand-written bridge immediately calls safe `ref_(&self)` / `deref(&self)`. The comments at `NodeHTTPResponse.rs:1947-1954` understate the operation: `ref_()` only touches `Cell<u32>`, but `deref()` calls `deinit()` when the count reaches zero, and `deinit()` clears buffers, unrefs VM handles, deinitializes a promise, and frees the heap allocation via `heap::take(self.as_ctx_ptr())`. `AsCtxPtr` is documented at `src/ptr/lib.rs:638-643` as `&self -> *mut Self` with shared/read-only provenance, and Tree Borrows rejects deallocation through such a pointer.

**Minimal reproducer:** `experiments/EXP-056/src/main.rs` mirrors the zero-ref source shape: `&Self -> std::ptr::from_ref(self).cast_mut() -> Box::from_raw -> drop`, with a `Cell<u32>` refcount and non-refcount payload field.

**Expected signal:** Miri Tree Borrows reports `deallocation through ... is forbidden` because the allocation is being freed through a tag derived from shared/read-only provenance. The cross-thread `Cell<u32>` race variant remains unclaimed; no production cross-thread path is needed for the confirmed zero-ref deallocation bug.

**Falsifiability:** if `NodeHTTPResponse::deinit` is changed to reclaim the allocation from an original owning/raw pointer (for example the `CellRefCounted::deref(this: *mut Self)` pattern in `src/ptr/ref_count.rs:692-715`) rather than `self.as_ctx_ptr()`, this specific witness closes. If Miri no longer reports the shared-provenance deallocation on the source-shaped reproducer, demote to resolved/hardening.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-056
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-strict-provenance" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-056-shared-dealloc.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Fresh source check (2026-05-16): the old wording "touches only `Cell`/`JsCell` fields" is not accurate for the zero path. `NodeHTTPResponse.rs:1897-1919` `deinit()` mutates several fields and frees the allocation; `:1924-1934` `deref(&self)` calls that destructor; `:1947-1955` is the `AnyRefCounted` bridge. The artifact must not present this as a proven-clean shared-deref claim.
- Phase 5 source-shaped Miri witness (2026-05-16) confirms the zero-ref path: `phase5_experiment_results/EXP-056-shared-dealloc.log` reports `Undefined Behavior: deallocation through ... is forbidden`; the conflicting tag is the `std::ptr::from_ref(self).cast_mut()` tag.
- Source search found no `RefPtr<NodeHTTPResponse>` uses, so the confirmed claim is narrower than the original broad `AnyRefCounted` / `RefPtr` worry.
- No production cross-thread `Cell<u32>` race is claimed. The non-zero `ref_()` / `deref()` path is not the confirmed bug; the confirmed bug is deallocating the heap allocation through shared provenance on the zero path.
- Cross-bucket with EXP-012 fix-model propagation cluster.

---

## EXP-057: 17-site `fn(&self) -> &'a mut T` caller-chosen-`'a` cluster (install/, http/, sql_jsc/, …)

**Finding ref:** F-L-1 in `phase4_unified_findings.md`; Bucket 15 sweeper §"Top 3 new finds" #1.
**Section:** L + Q + S + D + G + J + P (cross-section cluster) — 17 sites enumerated in `phase4_unified_findings.md`
**Bucket:** 15 (Lifetimes & Escape) + 1 (Aliasing)
**Severity (Phase 2):** LIKELY-UB-SHAPE-CLUSTER
**Hypothesis:** 17 sites form `&'a mut *self.field_raw_ptr` where `'a` is caller-chosen, unconstrained. Two interleaved calls on `&self` mint coexisting `&mut T` to the same allocation without borrowck noticing. Every site cites "single-threaded JS/HTTP/install loop + heap-pinned target" as load-bearing invariant.

**Minimal reproducer:**
```rust
// experiments/EXP-057/src/main.rs
struct Container { inner: *mut Inner }
struct Inner { x: u32 }
impl Container {
    fn inner_mut<'a>(&'a self) -> &'a mut Inner {
        unsafe { &mut *self.inner }
    }
}
fn main() {
    let inner = Box::leak(Box::new(Inner { x: 0 }));
    let c = Container { inner };
    let a = c.inner_mut();
    let b = c.inner_mut();  // ← two simultaneously-live &mut Inner
    a.x += 1;
    b.x += 2;
    println!("{}", c.inner_mut().x);
}
```

**Expected signal:** Miri Tree Borrows reports "attempting reborrow ... is forbidden" at the second `inner_mut()` call.

**Falsifiability:** if each of the 17 sites is provably called at most once per stack frame (call-graph audit), the runtime invariant holds; document and demote to LIKELY-UB-LATENT.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-057
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-057.log
```

**Verdict:** CONFIRMED_UB

**Phase 5 result (2026-05-16):** standalone reproducer at `experiments/EXP-057/src/main.rs` mirrors the cluster shape exactly: `Container { inner: *mut Inner }` + `fn inner_mut<'a>(&'a self) -> &'a mut Inner { unsafe { &mut *self.inner } }`. Two interleaved `c.inner_mut()` calls mint coexisting `&mut Inner` to the heap-leaked target. Writing through both — `a.x = 1; b.x = 2;` — triggers `MIRIFLAGS="-Zmiri-tree-borrows"`: `error: Undefined Behavior: write access through <354> at alloc193[0x0] is forbidden`. The accessed tag was created at `c.inner_mut()` and transitioned to `Disabled` due to a foreign write at `a.x = 1`. Raw log: `phase5_experiment_results/EXP-057.log`. This confirms the shape-level UB for every site that hits the 2-call pattern; the runtime invariant ("called at most once per stack frame on the JS/HTTP/install single-threaded loop") is what holds it back at the 17 production sites enumerated below.

**Notes:**
- The 17 sites:
  - `src/install/PackageManager.rs:701, 719, 1100`
  - `src/install/PackageInstaller.rs:398, 412, 419`
  - `src/install/NetworkTask.rs:175`
  - `src/install/isolated_install/Installer.rs:138`
  - `src/http/h3_client/PendingConnect.rs:50`
  - `src/http/HTTPThread.rs:45, 287, 387`
  - `src/sql_jsc/postgres/PostgresSQLConnection.rs:219, 229`
  - `src/sql_jsc/mysql/JSMySQLQuery.rs:612`
  - `src/sql_jsc/mysql/JSMySQLConnection.rs:137, 146`
  - `src/runtime/node/node_fs_watcher.rs:76`
  - `src/runtime/bake/DevServer/HmrSocket.rs:56`
  - `src/runtime/test_runner/Execution.rs:132`
  - `src/io/lib.rs:211`
- Codex post-convergence sweep found a broader **70 textual hit** `&self -> &mut`
  family. This does not add a new EXP count because EXP-057 is already the
  canonical two-call witness for the shape, and EXP-079/083/084 cover the most
  severe concrete safe-API surfaces. See
  `CODEX_MUT_FROM_REF_SWEEP_2026-05-16.md` for the reviewed queue. Important
  framing: not every hit is production UB; many are private R-2 helpers with
  source discipline, but safe `&self -> &mut` should be linted and should
  require an `unsafe fn`, a guard/closure scope, or a named exception.
- Mechanical fix: return `*mut T` and require call-site `unsafe { &mut *p }` reborrow with per-site SAFETY (same model as `from_field_ptr!` cluster).

---

## EXP-058: `bun_core::output::source_writer_escape() → &'static mut Writer` + 5 wrappers — in-source TODO admits 2-call hazard

**Finding ref:** F-L-2 in `phase4_unified_findings.md`; Bucket 15 sweeper §"Top 3 new finds" #2.
**Section:** N (bun_core-foundation) — `src/bun_core/output.rs:1067-1108`
**Bucket:** 15 (Lifetimes & Escape) + 1 (Aliasing)
**Severity (Phase 2):** LIKELY-UB
**Hypothesis:** `source_writer_escape() → &'static mut io::Writer` (+ 5 public wrappers `writer`, `writer_buffered`, `error_writer`, `error_writer_buffered`, `error_stream`) returns `&'static mut` escaping the thread-local `RefCell<Source>` borrow. In-source TODO at `:1067-1070` explicitly admits "Returning `&'static mut` is *unsound* if two are alive at once". 5 callers across the runtime can hold two simultaneously (e.g. `crash_handler` writes one `error_stream()` while a panic hook holds another).

**Minimal reproducer:** `experiments/EXP-058/src/main.rs` mirrors the thread-local `RefCell<Source>` escape and calls the same accessor twice:

```rust
let a = writer();
let b = writer();
a.0 = 1;
b.0 = 2; // Miri TB violation: b's tag was disabled by a's write
```

**Expected signal:** Miri TB reports overlapping `&mut` reborrows at the second call.

**Falsifiability:** if no real-world caller pair lives simultaneously, fix is doc-only (admit in SAFETY); otherwise hoist to a `WriterGuard<'a>` with per-call lifetime tied to the borrow.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-058
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-058.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Source-acknowledged unsoundness; same EXP-026 / EXP-028 family ("author wrote the TODO themselves").
- Confirmed 2026-05-16 under `MIRIFLAGS="-Zmiri-tree-borrows"`: `write access through <665> ... is forbidden`; tag created by the second `writer()` call was disabled by the first `a.0 = 1` write. Raw log: `phase5_experiment_results/EXP-058.log`.

---

## EXP-059: `bun_alloc::Mutex::lock()` `'_ → 'static` MutexGuard transmute — sound today, latent API hazard

**Finding ref:** F-L-9 in `phase4_unified_findings.md`; Bucket 15 sweeper §"Top 3 new finds" #3.
**Section:** O (alloc-and-collections) — `src/bun_alloc/lib.rs:550-565`
**Bucket:** 15 (Lifetimes & Escape) + 8 (Send/Sync)
**Severity (Phase 2):** LIKELY-UB-LATENT
**Hypothesis:** `bun_alloc::Mutex::lock() → MutexGuard` transmutes a `std::sync::MutexGuard<'_, ()>` to `<'static, ()>`. SAFETY argument: every `bun_alloc::Mutex` lives in `'static` BSS, so the held `&Mutex` is `'static`-valid. True for current callers, but **`Mutex::new()` is a `pub const fn` at `src/bun_alloc/lib.rs:546-548`** and admits stack construction; the `MutexGuard<'static>` would then dangle on drop. The hazard is reachable by API.

**Minimal reproducer:**
```rust
// experiments/EXP-059/src/main.rs
// Mirrors bun_alloc::Mutex::lock's lifetime transmute on a stack-constructed Mutex.
use std::sync::Mutex;

fn lock_static<'a>(m: &'a Mutex<()>) -> std::sync::MutexGuard<'static, ()> {
    let g = m.lock().unwrap();
    unsafe { core::mem::transmute(g) }
}

fn main() {
    let g: std::sync::MutexGuard<'static, ()> = {
        let m = Mutex::new(());
        lock_static(&m) // m is dropped at end of scope; g still alive
    };
    drop(g); // dangling Mutex backing
}
```

**Expected signal:** Miri reports a dangling `MutexGuard<'static>` either when the returned guard is constructed/retagged or later when it is dropped. The observed run fires at construction of the returned guard, before `drop(g)`.

**Falsifiability:** if Miri is clean (e.g. std `MutexGuard::drop` is robust to deallocated backing), the hazard is even narrower; either way the fix is to make `Mutex::new()` `unsafe` or `pub(crate)`.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-059
cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-059.log
```

**Verdict:** CONFIRMED_UB (latent — sound today, witnessed under stack-construction)

**Notes:**
- Latent until a future caller stack-constructs a `bun_alloc::Mutex`.
- **Phase 5 result (2026-05-16):** standalone reproducer at `experiments/EXP-059/src/main.rs` mirrors the `'_ → 'static` `MutexGuard` transmute on a stack-constructed `Mutex`. `lock_static(&m: &'a Mutex<()>) -> MutexGuard<'static, ()>` does the same `core::mem::transmute` as `bun_alloc::Mutex::lock` at `src/bun_alloc/lib.rs:550-565`; `obtain_dangling_guard()` constructs `m` on its stack frame, calls `lock_static`, and returns the `'static`-tagged guard. Miri (default) immediately fires at the return: `error: Undefined Behavior: constructing invalid value of type std::sync::MutexGuard<'_, ()>: at .lock, encountered a dangling reference (use-after-free)`. Raw log: `phase5_experiment_results/EXP-059.log`. **Verdict shape:** the UB is real and immediate at the API call once a caller stack-constructs a `bun_alloc::Mutex`; today's sites all live in `'static` BSS so the precondition holds, but `Mutex::new()` is a public const constructor and admits the stack pattern. Fix: make `Mutex::new()` `unsafe` / `pub(crate)`, or replace the `transmute` with a `MutexGuard<'a, ()>` that tracks the Mutex's lifetime properly.

---

## EXP-060: `napi::ThreadSafeFunction` cross-thread protocol — auto-trait bypassed at C ABI boundary

**Finding ref:** F-21-1 + F-21-4 in `phase4_unified_findings.md`; Bucket 21 sweeper §"new findings" + §"Recommendation #3".
**Section:** J (runtime-misc/napi) — `src/runtime/napi/napi_body.rs:2461-2870` (struct + `dispatch_one`/`release`/`call`); plus `:2378, 2437, 2485` (finalizers)
**Bucket:** 21 (FFI callback aliasing) + 7 (Data Races) + 8 (Send/Sync) + 13 (Refcount lifecycle)
**Severity (Phase 5):** CONFIRMED_UB
**Hypothesis:** The exported handle `napi_threadsafe_function = *mut ThreadSafeFunction` is constructed via `bun_core::heap::into_raw(Box::new(init))` and returned to addon code on **any** thread; addon's `napi_call_threadsafe_function` runs from non-JS threads. Internal sync: `Mutex` + `Condvar` + `AtomicI64 thread_count` + `AtomicU8 dispatch_state/closing` + `AtomicBool aborted`. The handle is **not** `Send`/`Sync`-impl'd — Rust's auto-trait system is bypassed at the C ABI boundary. Phase 5 found the stronger pre-lock bug: exported wrappers form `unsafe { &mut *func }` before taking the internal mutex (`napi_call_threadsafe_function`, `napi_acquire_threadsafe_function`, `napi_release_threadsafe_function`, `napi_ref_threadsafe_function`, `napi_unref_threadsafe_function`). Concurrent addon calls therefore mint overlapping `&mut ThreadSafeFunction` references to the same allocation. The `dispatch_state` / finalizer teardown questions remain follow-up hardening, but are no longer needed to prove UB.

**Minimal reproducer:** `experiments/EXP-060/src/main.rs` — a source-shaped model with a `ThreadSafeFunction`-like object containing a `Mutex` and `AtomicU8`, two copied foreign raw handles, and an exported-function-like wrapper that first does `let tsfn = unsafe { &mut *func }` and only then enters the mutex-protected method.

**Expected signal:** Miri reports a retag/data-race violation when two foreign threads concurrently create `&mut ThreadSafeFunction` from the same raw handle. Additional Shuttle/loom work can still model finalizer/env-teardown races, but the primary EXP-060 claim is already confirmed.

**Falsifiability:** if the exported functions are rewritten to avoid `&mut *func` on producer-thread paths (raw pointer + interior mutability / `&self` methods only), this particular witness no longer applies. Merely proving the queue protocol under Shuttle does not falsify the current bug because the `&mut` retag occurs before queue synchronization.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-060
CARGO_TARGET_DIR=target cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-060-mut-raw-handle-miri.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- **Security-grade hazard**: addons run with the host's privileges. If the cross-thread protocol breaks, hostile addon code can race the TSFN.
- The only entry in the Bucket-21 audit where Rust's auto-trait system is *bypassed* (handle is `*mut`, no Send/Sync impl).
- Phase 5 Miri witness: `Data race detected between (1) atomic store on thread unnamed-1 and (2) retag write of type ThreadSafeFunction on thread unnamed-2`. Raw log: `phase5_experiment_results/EXP-060-mut-raw-handle-miri.log`.
- The internal `Mutex` is present in the witness. It does not help because the exported wrapper has already created the `&mut ThreadSafeFunction` by the time the method can lock.
- Highest ROI fix of the napi cluster: convert producer-thread exported wrappers (`call`, `acquire`, `release`) to raw-pointer / `&self` + interior-mutability methods; keep `&mut ThreadSafeFunction` only on JS-thread-owned paths where uniqueness is actually true.

---

## EXP-061: `#[bun_callback]` proc-macro — single-vehicle EXP-012 propagation closing the 3 remaining callback holes

**Finding ref:** Phase 6 idea-wizard W1 (`phase6_idea_wizard.md`). Cluster C in `phase4_unified_findings.md` (23-of-26 EXP-012 propagation success, 3 remaining callback holes: EXP-026 `timer::All`, EXP-044 `BundleV2`, F-21-2 `WindowsNamedPipe`).
**Section:** Project-wide tooling — anchor crate `src/ptr/lib.rs:518-546` (`ThisPtr` def, where `ref_guard` lives); 95 `from_field_ptr!` invocations workspace-wide; 60 `ref_guard` sites; `src/io/PipeWriter.rs:2623-2670` (`impl_streaming_writer_parent!` macro).
**Bucket:** 1 (Aliasing) + 21 (FFI callback aliasing) + tooling.
**Severity (Phase 6):** STRUCTURAL-FIX-POINT — does not classify as UB; classifies as a *fix-model propagation experiment* with three direct UB beneficiaries (EXP-026, EXP-044, F-21-2).
**Hypothesis:** The EXP-012 fix model (named-cancel pattern at `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:599-637` — `*mut Self` + `ThisPtr` + `ref_guard` RAII) is mechanically reproducible. A `#[bun_callback(this = *mut Self, refcount = ...)]` proc-macro that synthesises `let this = ThisPtr::new(raw)` + `let _g = this.ref_guard()` + per-field raw-place projection should make the boilerplate 1 line. The 3 remaining callback holes are not omitted because the pattern is hard; they are omitted because the boilerplate is 12 lines and easy to forget.

**Minimal reproducer:** design witness to build — proc-macro skeleton crate; per-target unit test that
- (a) compiles EXP-012 site cleanly,
- (b) refuses to compile EXP-026 site (`&mut self` receiver detected),
- (c) successfully rewrites EXP-026 site to `this: *mut Self`,
- (d) Miri witnesses pre/post: pre fails the EXP-026 reproducer, post passes.

**Expected signal:** the 3 remaining callback holes collapse to one macro-rewrite per site. Tree-Borrows witnesses for EXP-026/EXP-044/F-21-2 reproducers pass under the rewrite.

**Falsifiability:** if any of the 3 sites cannot mechanically accept the macro (e.g. `BundleV2` has a self-borrow web that resists `*mut Self`), report the obstruction and downgrade to "applies to N of 3 sites".

**Invocation:**
```
# scaffold
cargo new --lib bun_callback_macro
# apply to EXP-026 site under feature flag
cargo +nightly miri test --features bun_callback_macro --test exp_026_timer_all 2>&1 \
  | tee phase5_experiment_results/EXP-061.log
```

**Verdict:** DEFERRED (remediation-design vehicle; not an unresolved UB proof)

**Notes:**
- Highest mechanical-fix-leverage in the codebase: 26→26 EXP-012-pattern consumers.
- Should be staffed jointly with Phase 8 remediation plan §6 (EXP-012 propagation).

---

## EXP-062: `JsThreadAffine` sealed marker trait — 4-layer JS-thread-affinity compile-error fix

**Finding ref:** Phase 6 idea-wizard W2 (`phase6_idea_wizard.md`); F-S-14 + F-S-11 + EXP-019 + EXP-045 + EXP-032 + F-DR-11 in `phase4_unified_findings.md`.
**Section:** K (jsc) + A (runtime/webcore) — `src/jsc/VirtualMachine.rs:611-612` (`unsafe impl Sync for VirtualMachine` — the foundational JS-thread-singleton lie); `src/jsc/JSCell.rs:126-128` (EXP-045 — unbounded `Send/Sync for JsCell<T>`); `src/jsc/web_worker.rs:127-128, 246-326` (EXP-032 — `Cell<*mut WebWorker>` cross-thread); `src/ptr/lib.rs:627-628` (BackRef `get_mut(&self) -> &mut T`); 92 `thread_local!` sites workspace-wide.
**Bucket:** 8 (Send/Sync) + 7 (Data Races) + 1 (Aliasing) — type-system propagation.
**Severity (Phase 6):** STRUCTURAL-FIX-POINT — closes the JS-thread-affinity layer-cake by compile-error rather than enumeration.
**Hypothesis:** Add a sealed `pub trait JsThreadAffine: ?Sized {}` in `bun_core` with **no Send and no Sync auto-trait propagation** (achieved via a `PhantomData<*const ()>` in a `_marker` field on each JsThreadAffine type). Every JS-thread-affine type (`VirtualMachine`, `JsCell<T>`, `Strong/Weak`, `WebWorker`, `Blob`, `NodeHTTPResponse`, `JSGlobalObject`, the 92 thread-local-anchored types) implements `JsThreadAffine`. `JsThreadAffine: !Send + !Sync` becomes a compile-time wall: any `spawn(move || captures JsThreadAffine)` becomes `error[E0277]: T cannot be sent between threads safely`.

**Minimal reproducer:**
```rust
// experiments/EXP-062/src/lib.rs
pub trait JsThreadAffine {}
// Sealed: only this crate implements it.
// Marker types carrying *const () prevent auto-Send/Sync.
pub struct VirtualMachine { _na: core::marker::PhantomData<*const ()> }
impl JsThreadAffine for VirtualMachine {}

// User-side: this must NOT compile:
fn user_bug(vm: &'static VirtualMachine) {
    std::thread::spawn(move || { let _ = vm; }); // expected: E0277
}
```

**Expected signal:** `rustc` rejects with E0277 on the `spawn` call. Then for confirmed safe-API / unsafe-contract sites flagged in EXP-019/EXP-045/EXP-046 (plus EXP-047 hardening-only wrappers if maintainers choose to tighten them), drop the `unsafe impl Send/Sync` and observe the chain unwinds with sensible compile errors at the actual hazard sites.

**Falsifiability:** if `JsThreadAffine` cannot be added without breaking the JSC dispatch flow (e.g. JSC's `vm()` accessor *legitimately* hands the VM to a non-JS thread under a documented promise), report the contradiction and downgrade to "needs API split".

**Invocation:**
```
cargo +nightly check 2>&1 | tee phase5_experiment_results/EXP-062-rustc.log
cargo +nightly miri test --test exp_062_thread_capture 2>&1 \
  | tee phase5_experiment_results/EXP-062-miri.log
```

**Verdict:** DEFERRED (remediation-design vehicle; not an unresolved UB proof)

**Notes:**
- Composes with EXP-045/EXP-046 as the type-system replacement for the per-site `assert_impl_all!` smoke-tests; EXP-047 can join only as optional hardening after the safe-boundary correction.
- BackRef `get_mut(&self) -> &mut T` (F-S-10) becomes `where Self: !JsThreadAffine` — sound but auditor-visible.

---

## EXP-063: `#[layout_locked]` derive + C-reflector build-script — propagate `bun_libuv_sys` gold standard to NAPI/Win32/BoringSSL

**Finding ref:** Phase 6 idea-wizard W3 (`phase6_idea_wizard.md`); EXP-054 (NAPI) + F-10-4 (Win32) + F-10-5 (BoringSSL) in `phase4_unified_findings.md`.
**Section:** T (FFI C libs) — gold standard at `src/libuv_sys/libuv.rs:257-276, :395-396`; gaps at `src/runtime/napi/napi_body.rs:512, 524, 536, 1985, 2032` (5 NAPI POD structs, 0 asserts); `src/windows_sys/externs.rs` (48 structs, 4 asserts); `src/boringssl_sys/boringssl.rs` (15 structs, 0 asserts).
**Bucket:** 10 (FFI contracts).
**Severity (Phase 6):** STRUCTURAL-FIX-POINT — extends EXP-054 from a single experiment to a workspace-wide pattern.
**Hypothesis:** A `#[layout_locked(c_header = "node_api.h", c_struct = "napi_async_work")]` derive generates `const _: () = assert!(size_of::<Self>() == EXPECTED_FROM_HEADER && align_of::<Self>() == EXPECTED, ...)` for every field, where `EXPECTED_FROM_HEADER` is filled in by a build script that compiles a tiny C reflector program (`#include <node_api.h>` + `printf("%zu %zu", offsetof(...), sizeof(...))`). A CI matrix runs the reflector against the actual installed headers; any drift fails the build.

**Minimal reproducer:** design witness to build — proc-macro derive crate + build.rs reflector. Unit test:
```rust
#[derive(layout_locked)]
#[layout_locked(c_header = "fake.h", c_struct = "fake_t", c_size = 32)]
#[repr(C)]
struct Fake { a: u32, b: u32, c: u64, d: u64 }
// const _: () = assert!(size_of::<Fake>() == 32);  // generated
// const _: () = assert!(offset_of!(Fake, c) == 8); // generated
```

**Expected signal:** at the first NAPI struct mismatch (e.g. upstream adds a field to `napi_property_descriptor`), the build fails with a precise asserter message. EXP-054 graduates from "needs Miri witness" to "compile-time wall".

**Falsifiability:** if `offset_of!` semantics differ across rustc nightlies or if the C-reflector approach is impractical inside the existing `cmake`/`bun bd` build flow, scope to `size_of` + `needs_drop` asserts only (the EXP-054 reduced form).

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-063
cargo +nightly build 2>&1 | tee ../../phase5_experiment_results/EXP-063.log
```

**Verdict:** DEFERRED (remediation-design vehicle; not an unresolved UB proof)

**Notes:**
- Subsumes the 63 unasserted struct count (5 + 48 + 15 − the 4 Win32 sockaddr asserts) into one mechanical pass.
- Composable with `bun_core::ffi::Zeroable` audited trait (Bucket-4 CLEAN row).

---

## EXP-064: `#[const_validate]` enum / validity derive auto-inserting checked bit-pattern validation

**Finding ref:** Phase 6 idea-wizard W4 (`phase6_idea_wizard.md`); EXP-002, EXP-003, EXP-006, EXP-035, EXP-036, EXP-051 + F-NF6-1 (PropertyIdTag) in `phase4_unified_findings.md`. EXP-037 is excluded from the active closure set because current `WindowsWatcher.rs` already uses a checked raw-`DWORD` match.
**Section:** Disk / FFI validity-bearing byte cluster.
**Bucket:** 4 (Validity) + 6 (Type punning).
**Severity (Phase 6):** STRUCTURAL-FIX-POINT — replaces 7 active per-site fixes with 1 derive, plus one resolved Windows watcher regression guard.
**Hypothesis:** Add `#[derive(ConstValidate)]` / checked bit-pattern validation to every validity-bearing enum or POD-ish struct reachable from disk / IO buffer / host plugin input. For `#[repr(u8/u16/u32)]` enums, the derive synthesises `bytemuck::CheckedBitPattern::is_valid_bit_pattern`; for struct payloads such as `PatchedDep`, the generated check validates validity-bearing fields (`bool`, `char`, sparse enums) before materialising the typed value. Existing `transmute::<u32, E>()` / `read_unaligned::<E>()` / typed-byte-view sites are rewritten by a sibling `#[validate_read]` proc-macro to return `Err(InvalidEnumTagError)` / `Err(InvalidBitPattern)` instead of constructing invalid Rust values. Mechanical pass closes:
- EXP-002 `linux_errno::SystemErrno` (134/65536 valid)
- EXP-003 `Meta::has_install_script` (3/256)
- EXP-006 `Meta::origin` (3/256)
- EXP-035 `StandaloneModuleGraph` 4 sparse enums × 256^4
- EXP-036 `PatchedDep::patchfile_hash_is_null: bool` (2/256)
- EXP-051 `BunLoader` (`#[repr(u32)]`, 13/256 — host plugin)
- F-NF6-1 `PropertyIdTag` (`u16` → enum)

Regression guard (already fixed in current source):
- EXP-037 `WindowsWatcher::Action` (`#[repr(u32)]`) — current source matches the raw `DWORD` at `src/watcher/WindowsWatcher.rs:196-211`.

**Minimal reproducer:** design witness to build — derive crate + integration tests that consume the existing EXP-002/EXP-035/EXP-036/EXP-051 Miri repros under the derive and assert each fails *gracefully* (returns `Err`) instead of UB.

**Expected signal:** each of the 8 sites that today fails Miri now returns `Err(InvalidEnumTagError)` — no UB, malformed lockfile/binary/plugin is rejected.

**Falsifiability:** if any site has performance-critical hot read paths that cannot afford `CheckedBitPattern::from_bits` (panics or branch cost), confirm with a perf experiment; otherwise propagate.

**Invocation:**
```
cargo +nightly miri run --bin exp_064_meta_origin 2>&1 \
  | tee phase5_experiment_results/EXP-064.log
```

**Verdict:** DEFERRED (remediation-design vehicle; not an unresolved UB proof)

**Notes:**
- Companion to `LockfileArrayElem` bound (structural-fix-point #1 in Phase 4): the trait restricts *which* T is admissible; `ConstValidate` enforces *what* validity bits a tagged variant carries.

---

## EXP-065: Re-entrant-VM tripwire (`Cell<u32>` debug field) — runtime witness for `&T → &mut T` forgery family

**Finding ref:** Phase 6 idea-wizard W5 (`phase6_idea_wizard.md`); EXP-026, EXP-042, EXP-043, EXP-044 in `phase4_unified_findings.md`.
**Section:** J (runtime-misc) + L (install) + M (bundler) + K (jsc).
**Bucket:** 14 (`*const T` mutation) + 1 (Aliasing).
**Severity (Phase 6):** STRUCTURAL-FIX-POINT — catches the entire `&T → &mut T` forgery family at runtime without a static analyzer.
**Hypothesis:** Add a debug-only field `re_entry_count: Cell<u32>` to `VirtualMachine`, `BundleV2`, `RealFS`, `timer::All`. Every accessor that today forges a `&mut Self` from a `&Self` (EXP-026 `timer_all_mut`, EXP-042 `repl::vm_mut`, EXP-043 `Scanner::resolve_dir_for_test`, EXP-044 `bv2_mut`) is replaced with a `MutGuard<'a, Self>` RAII bracket that increments `re_entry_count` on entry, decrements on drop, and `debug_assert!(re_entry_count <= 1)` on the increment. In production builds the guard is `#[inline]`-empty (zero-cost). In debug/Miri builds, any re-entrant `&mut` materialisation traps.

**Minimal reproducer:**
```rust
// experiments/EXP-065/src/main.rs
use std::cell::Cell;
struct VM { _re: Cell<u32>, n: Cell<u32> }
struct MutGuard<'a, T> { _t: &'a T, _drop_n: &'a Cell<u32> }
impl<'a, T> Drop for MutGuard<'a, T> {
    fn drop(&mut self) { self._drop_n.set(self._drop_n.get() - 1); }
}
impl VM {
    fn vm_mut<'a>(&'a self) -> MutGuard<'a, Self> {
        let new = self._re.get() + 1;
        assert!(new <= 1, "re-entrant &mut materialisation");
        self._re.set(new);
        MutGuard { _t: self, _drop_n: &self._re }
    }
}
fn main() {
    let vm = VM { _re: Cell::new(0), n: Cell::new(0) };
    let g1 = vm.vm_mut();
    let g2 = vm.vm_mut(); // expected: panic on the assert
    drop((g1, g2));
}
```

**Expected signal:** the second `.vm_mut()` panics with "re-entrant &mut materialisation". Then for each of EXP-026/EXP-042/EXP-043/EXP-044, integrating the guard surfaces a debug-time witness whenever the production caller chain doubles up.

**Falsifiability:** if any site documentedly *requires* re-entrant `&mut` (none expected, but possible in `BundleV2` plugin chain), report and adjust to a stack-depth counter with explicit shape-bounds.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-065
cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-065.log
```

**Verdict:** DEFERRED (remediation-design vehicle; not an unresolved UB proof)

**Notes:**
- Composes with EXP-061 (`#[bun_callback]` proc-macro) for the callback subset — `ThisPtr::ref_guard` already implements the same bracket discipline.
- Useful even after the four EXP entries are fixed: a permanent regression guard against the forgery class.

---

## EXP-066: `BumpDrop<T: Drop>` arena-drop wrapper — types the CLAUDE.md arena gotcha

**Finding ref:** Phase 6 idea-wizard E1 (`phase6_idea_wizard.md`); EXP-016 + CLAUDE.md "Arena gotcha" note in `phase4_unified_findings.md`.
**Section:** O (alloc-collections) — `src/ast/new_store.rs` + every `Vec<T, AstAlloc>` consumer; 4 consumer files identified: `src/ast/nodes.rs:521` (`pub type ExprNodeList = Vec<Expr, bun_alloc::AstAlloc>`), `src/ast/g.rs:27, 83, 142, 149`.
**Bucket:** 11 (Panic safety) + 20 (Alloc pairing).
**Severity (Phase 6):** STRUCTURAL-FIX-POINT / preventive hardening — types the gotcha so future `AstAlloc` payloads cannot drift into soundness-critical Drop without an explicit policy.
**Hypothesis:** Wrap `Vec<T, AstAlloc> where T: Drop` in a `BumpDrop<T>` newtype or replace it with a compile-time `AstAllocPayload` policy. On `MimallocArena::reset()`, a registered destructor list could run Drop for opted-in payloads; default impl is "no soundness-critical Drop." The CLAUDE.md gotcha becomes a compile-time obligation.

**Minimal reproducer:** design witness to build — `BumpDrop<RcBox>` (where `RcBox` is a refcounted heap-allocated payload that *must* run Drop to release the refcount). Allocate via the wrapper; reset arena; observe Drop ran; observe refcount decremented. This is a future-proofing witness, not evidence that current Bun stores such a payload in `AstAlloc`.

**Expected signal:** Miri leak-check is clean for a synthetic destructor-bearing payload. Without the wrapper, the synthetic payload leaks on arena reset. Current `EXP-016` source audit found leak-only payload evidence, not UB.

**Falsifiability:** if the AST allocates no soundness-critical `T: Drop` payloads today (current EXP-016 result), the wrapper is preventive only. Its value is making the policy machine-checkable so a future `MutexGuard` / refcount / FFI-handle payload cannot silently enter `AstAlloc`.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-066
cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-066.log
```

**Verdict:** DEFERRED (remediation-design vehicle; not an unresolved UB proof)

**Notes:**
- Companion to EXP-016. After the 2026-05-16 follow-up, EXP-016 is `NO_EVIDENCE` for current UB; EXP-066 is "types the absence so future additions can't drift."

---

## EXP-067: `Ref(NonZeroU64)::normalize()` accessor with compile-error-on-unnormalised-hash

**Finding ref:** Phase 6 idea-wizard E2 (`phase6_idea_wizard.md`); F-L12-1 in `phase4_unified_findings.md`.
**Section:** R (parsers / AST) — `src/ast/lib.rs:398-410` (`Ref` Hash impl).
**Bucket:** 12 (Library traits — Hash/Eq correctness).
**Severity (Phase 6):** STRUCTURAL-FIX-POINT — closes Hash≥Eq drift by type-system check.
**Hypothesis:** Today `Ref::hash = as_u64()` hashes **all 64 bits** but `Ref::eql` masks user bits. Two `Ref` values can be `Hash`-distinct but `Eq`-equal — a silent map miss. Refactor `Ref` to expose only `Ref::normalize() -> NormalizedRef(NonZeroU64)` — `NormalizedRef` is `Hash + Eq` and is the **only** type that satisfies `Hash` impl bound. `Ref` itself is `!Hash`. Every `HashMap<Ref, …>` / `HashSet<Ref>` is now a compile error and must be rewritten to use `NormalizedRef`. The masked bits are computed in `normalize()` only.

**Minimal reproducer:**
```rust
// experiments/EXP-067/src/main.rs
#[derive(Copy, Clone, Eq, PartialEq)] // intentionally no Hash
pub struct Ref(core::num::NonZeroU64);
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct NormalizedRef(core::num::NonZeroU64);
impl Ref { pub fn normalize(self) -> NormalizedRef {
    let masked = self.0.get() & 0x0000_FFFF_FFFF_FFFF;
    NormalizedRef(core::num::NonZeroU64::new(masked.max(1)).unwrap())
} }
fn main() {
    // intentional: this must NOT compile — Ref is !Hash
    // let mut h: std::collections::HashMap<Ref, ()> = Default::default(); // expected: E0277
    let mut h: std::collections::HashMap<NormalizedRef, ()> = Default::default();
    h.insert(Ref(core::num::NonZeroU64::new(1).unwrap()).normalize(), ());
}
```

**Expected signal:** rustc rejects the commented line with E0277 (`Ref: Hash` not satisfied). The codebase no longer admits "hash all bits, eql masks bits" drift.

**Falsifiability:** if `Ref` is hashed in load-bearing hot loops (e.g. symbol table) and `normalize()` is too expensive, fall back to a `Ref::with_hash_consistent_with_eq()` accessor that does the masking up front and stores the masked form.

**Invocation:**
```
cargo +nightly check 2>&1 | tee phase5_experiment_results/EXP-067.log
```

**Verdict:** DEFERRED (remediation-design vehicle; not an unresolved UB proof)

**Notes:**
- Same shape applies to `StableRef` Ord/Eq drift (F-L12-2) and `EffectiveUrlContext::eql` (F-L12-3) — propagate after `Ref` lands.

---

## EXP-068: `bun_core::heap` chokepoint workspace lint — forbids `Box::leak` outside `heap::*`

**Finding ref:** Phase 6 idea-wizard E3 (`phase6_idea_wizard.md`); F-L-10 (CLEAN witnesses) + F-L-11 (9-site Box::leak/Vec::leak cluster) in `phase4_unified_findings.md`.
**Section:** N (bun_core foundation) + cluster across A/J/M sections.
**Bucket:** 15 (Lifetimes & Escape).
**Severity (Phase 6):** STRUCTURAL-FIX-POINT — promotes the documented `PORTING.md §Forbidden: no Box::leak` ban (F-L-10) from social to mechanical.
**Hypothesis:** A workspace-level `clippy.toml` or a custom `dylint` lint forbids `Box::leak`, `Vec::leak`, `Box::into_raw`, `alloc::alloc` *outside* the `bun_core::heap` module. The 9-site F-L-11 cluster is grandfathered with explicit `#[allow(bun::box_leak)]` annotations, each requiring a SAFETY comment explaining why the leak is JSC-owned / WTF-Adopt / `Strong<T>`-tracked.

**Minimal reproducer:**
```rust
// experiments/EXP-068/src/main.rs
fn main() {
    let b = Box::new(42);
    let _r: &'static u32 = Box::leak(b); // expected: lint error: use bun_core::heap::leak_static
}
```

**Expected signal:** clippy-driver emits the custom lint at every workspace-wide `Box::leak` site outside `bun_core::heap`. The 9 known sites become explicit annotations.

**Falsifiability:** if dylint integration into Bun's CI is impractical, a `ban_calls.toml` for `cargo-deny` + workspace-wide `#[deny(unsafe_code)]` allow-list combo gets ~80% coverage with off-the-shelf tooling.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-068
cargo +nightly dylint --workspace -- -D bun::box_leak 2>&1 \
  | tee ../../phase5_experiment_results/EXP-068.log
```

**Verdict:** DEFERRED (remediation-design vehicle; not an unresolved UB proof)

**Notes:**
- The same lint vehicle is the right home for "forbid `unsafe impl Send/Sync for X<T>` without a bound on T" — composable with EXP-062.

---

## EXP-069: Loom + Shuttle 95-site `from_field_ptr!` re-entry torture harness — cluster-wide dynamic oracle

**Finding ref:** Phase 6 idea-wizard E5 (`phase6_idea_wizard.md`); Cluster A in `phase4_unified_findings.md` (95-site `from_field_ptr!` enumeration). Note: the former densest dispatch subset at `src/runtime/dispatch.rs:794, 799, 823, 828` (F-A-12 / F-21-6) has been demoted for aliasing after source audit; keep it only as a regression-control case, not as the lead hypothesis.
**Section:** Project-wide — A/B/E/G/J/L sections all consume `from_field_ptr!`.
**Bucket:** 1 (Aliasing) + 21 (FFI callback aliasing).
**Severity (Phase 6):** CLUSTER-DYNAMIC-ORACLE — closes the still-risky subset of Cluster A by enumerated torture.
**Hypothesis:** Each still-risky `from_field_ptr!(Parent, field, child_ptr) → &mut Parent` site can be wrapped in a test scaffold that, under loom interleaving search, simulates the relevant callback/re-entry chain: thread A holds `&mut Parent` from `from_field_ptr!`; thread B re-enters via the same path. Tree-Borrows violation surfaces under loom. The raw enumeration has 13 `&mut Parent` sites; after source audit, the 4 dispatch io_poll sites are reviewed/demoted for aliasing, so automate the remaining subset first with a `#[from_field_ptr_loom_test]` proc-macro.

**Minimal reproducer:** design witness to build — pick a still-risky `from_field_ptr!` site where a live parent/child reference demonstrably overlaps (for example a bundler worker parent-recovery site), then generalise via macro. The dispatch io_poll subset is no longer the correct first target.

**Expected signal:** loom finds an interleaving where `&mut Parent` is materialised twice in overlapping logical time for a selected still-risky site. If the selected site is the already-reviewed dispatch io_poll subset, a clean run should preserve the F-A-12 / F-21-6 demotion and leave only the F-P-9 strict-provenance issue.

**Falsifiability:** if every site's parent type is JS-thread-affine (covered by EXP-062's `JsThreadAffine` marker — sites are serialised on the event loop), the harness is over-modelled; the actual UB risk is only at the 3 known bundler/timer/named-pipe holes.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-069
RUSTFLAGS="--cfg loom" cargo +nightly test --release --test exp_069_dispatch_loom 2>&1 \
  | tee ../../phase5_experiment_results/EXP-069.log
```

**Verdict:** DEFERRED (remediation-design vehicle; not an unresolved UB proof)

**Notes:**
- Companion to EXP-061 (`#[bun_callback]` proc-macro): EXP-069 is the *witness*; EXP-061 is the *fix*.
- Should be staffed jointly with Phase 11 soak (10⁴+ loom iterations).

---

## EXP-070: `impl_streaming_writer_parent!` re-entry-mode annotation linter — generalises Section P RawPtrHandler<T> escape hatch

**Finding ref:** Phase 6 idea-wizard E6 (`phase6_idea_wizard.md`); F-21-2 (WindowsNamedPipe `borrow = mut`) + F-21-9 (uws `RawPtrHandler<T>`) in `phase4_unified_findings.md`; macro def at `src/io/PipeWriter.rs:2623-2670`; uSockets surface at `src/uws_sys/vtable.rs:237-244`, `src/uws_sys/WebSocket.rs:248-255`.
**Section:** E (runtime/socket) + tooling.
**Bucket:** 1 (Aliasing) + 21 (FFI callback aliasing).
**Severity (Phase 6):** STRUCTURAL-FIX-POINT — promotes Section P's `RawPtrHandler<T>` two-mode pattern from "callsite escape hatch" to "macro-level borrow-mode annotation".
**Hypothesis:** Extend `impl_streaming_writer_parent!` (and the broader intrusive-callback macro family) to **require** a `borrow_mode = Shared | Mut | Raw` token per invocation. `Shared` is the default (single-thread, no callback can free `self`). `Mut` is restricted (lint warning; requires inline SAFETY comment justifying no-re-entry). `Raw` is the canonical EXP-012 mode (`*mut Self` return; no `&mut` form). The current `WindowsNamedPipe` `borrow = mut` consumer (F-21-2) is then forced to add a SAFETY comment or flip to `Raw`.

**Minimal reproducer:** design witness to build — refactor `impl_streaming_writer_parent!` to add the token; rebuild; observe F-21-2 site's compile-time obligation surface.

**Expected signal:** the F-21-2 site either gets a SAFETY comment (and stays `Mut`) or flips to `Raw` (closes the hazard). uWS `RawPtrHandler<T>` (F-21-9) generalises naturally.

**Falsifiability:** if macro-mechanic refactor is more invasive than expected, fall back to a clippy lint that pattern-matches `impl_streaming_writer_parent!(borrow = mut)` and flags it.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-070
cargo +nightly check 2>&1 | tee ../../phase5_experiment_results/EXP-070.log
```

**Verdict:** DEFERRED (remediation-design vehicle; not an unresolved UB proof)

**Notes:**
- Composable with EXP-061 (proc-macro replaces the entire macro family).

---

## EXP-071: Signal-handler async-signal-safety static analyzer — promotes EXP-013 non-AS-safe callgraph claim from comment-TODO to checkable artifact

**Finding ref:** Phase 6 idea-wizard E10 (`phase6_idea_wizard.md`); EXP-013 + F-13 in `phase4_unified_findings.md`.
**Section:** U (crash_handler) — `src/crash_handler/lib.rs:588` (in-source TODO acknowledging mutex-in-signal-handler hazard); `:1320-1450, 1801`; `:1737` (`SA_RESETHAND`).
**Bucket:** 18 (Inline asm + AS-safety) + 11 (Panic safety).
**Severity (Phase 6):** STATIC-ANALYZER — promotes EXP-013 from "comment-TODO + SA_RESETHAND mitigation" to "compile-time reachability witness".
**Hypothesis:** A `cargo`-integrated static analyzer (built on `rust-analyzer` IDE-AST or `cargo-call-stack`) walks every function transitively reachable from `signal_handler` symbols and checks each call against a POSIX AS-safety whitelist (`async-signal-safe functions` per POSIX.1-2008). The analyzer emits a JSON artifact listing each non-AS-safe call (e.g. `Mutex::lock`, `malloc`, `Display`, `panic!`) with the call chain from the signal handler. EXP-013's source-callgraph claim (9 of 14 audited steps, representing at least 8 distinct non-AS-safe operation classes) becomes a concrete file:line list with proof.

**Minimal reproducer:** design witness to build — `cargo-call-stack` invocation over `crash_handler::signal_handler`; cross-reference each callee against the POSIX whitelist crate (`async-signal-safe` crate exists for this); diff with `SA_RESETHAND` mitigation surface.

**Expected signal:** if implemented, the analyzer should emit a future artifact such as `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase5_experiment_results/EXP-071.json` listing the 8 non-AS-safe call sites by file:line, each with the full chain from `crash_handler::signal_handler`.

**Falsifiability:** if `cargo-call-stack` cannot resolve through C++ FFI boundaries (likely — JSC C++ calls are opaque), the analyzer covers only the Rust-side reachability; flag the C++-bound calls as "unknown AS-safety" rather than miss-claim safe.

**Invocation:**
```
cd /data/projects/bun
cargo install cargo-call-stack
cargo call-stack --bin bun-debug --start crash_handler::signal_handler 2>&1 \
  | tee .ub-exorcism/2026-05-15-exhaustive/phase5_experiment_results/EXP-071.log
```

**Verdict:** DEFERRED (remediation-design vehicle; not an unresolved UB proof)

**Notes:**
- Carries-forward Phase 1 Section U note 1: "EXP-013 is not a hidden bug — it is a known-and-accepted carry-over with `SA_RESETHAND` as the only mitigation". The analyzer puts numbers on the known-and-accepted scope.

---

## EXP-072: `HiveArray::get` + `HiveArrayFallback::{get, try_get, get_and_see_if_new}` — 4 deprecated raw-slot methods still called by 8 sites

**Finding ref:** Found during Phase-3 path-(b)-equivalent full-workspace `cargo check --workspace` (post-codegen + post-vendor-bootstrap). Author **explicitly marked the raw-slot methods deprecated** with the message `"returns *mut T to uninitialized memory; use get_init / emplace / claim"` but 8 unmigrated callers remain.
**Section:** O (alloc-and-collections) — anchored at `src/collections/hive_array.rs`; live callers in L (install) + F/G/J (runtime)
**Bucket:** 5 (Uninitialized memory) — same family as EXP-001 + EXP-005 + EXP-033 + EXP-034
**Severity:** MUST-BE-UB (the deprecation message itself is the hypothesis statement; author already documented the bug)
**Hypothesis:** Four deprecated raw-slot methods return `*mut T` pointing at a *claimed-but-uninitialized* slot:
- `HiveArray::get(&mut self) -> Option<*mut T>` — `src/collections/hive_array.rs:214-215`
- `HiveArrayFallback::get(&mut self) -> *mut T` — `src/collections/hive_array.rs:523-526`
- `HiveArrayFallback::get_and_see_if_new(&mut self, new: &mut bool) -> *mut T` — `src/collections/hive_array.rs:532-533`
- `HiveArrayFallback::try_get(&mut self) -> *mut T` — `src/collections/hive_array.rs:545-546`

Each is marked `#[deprecated = "returns *mut T to uninitialized memory; use get_init / emplace / claim"]`. The replacement API (`get_init` / `emplace` / `claim`) returns a typed handle that enforces init before deref. 8 callers haven't migrated:

| File:line | Method | Token slot |
|-----------|--------|------------|
| `src/install/PackageManager/PackageManagerEnqueue.rs:358` | `.get()` | `preallocated_resolve_tasks` |
| `src/install/PackageManager/PackageManagerEnqueue.rs:1659` | `.get()` | `preallocated_resolve_tasks` |
| `src/install/PackageManager/PackageManagerEnqueue.rs:1803` | `.get()` | `preallocated_resolve_tasks` |
| `src/install/PackageManager/runTasks.rs:1711` | `.get()` | `preallocated_network_tasks` |
| `src/runtime/server/server_body.rs:3415` | `.get()` | `request_pool: RequestContextStackAllocator = HiveArrayFallback<RequestContext<...>, 2048>` |
| `src/runtime/server/mod.rs:705` | `.try_get()` | `request_pool: RequestContextStackAllocator = HiveArrayFallback<RequestContext<...>, 2048>` |
| `src/runtime/bake/DevServer.rs:2097` | `.get()` | `deferred_request_pool: HiveArrayFallback<deferred_request::Node, DeferredRequest::MAX_PREALLOCATED>` |
| `src/runtime/api/bun/h2_frame_parser.rs:7375` | `.try_get()` | `H2FrameParserHiveAllocator = HiveArrayFallback<H2FrameParser, 256>` |

Per the deprecation comment at `src/collections/hive_array.rs`: "the caller's `ptr::write` leaves the slot claimed-but-uninit so a later `put` drops garbage". This is the **same UB class as EXP-001** (uninit slot exposed as `T`) but with a different access shape: `*mut T` instead of `&[T]`.

**Source-type re-check (Codex 2026-05-16):** the 8 callsites are not generic `.get()` string matches. The receivers resolve to `HiveArrayFallback` pools via `PackageManager.rs:320-321`, `PackageManager.rs:427-428`, `RequestContext.rs:115-123`, `DevServer.rs:448-449`, and `h2_frame_parser.rs:1233-1236`.

**Minimal reproducer:** `experiments/EXP-072/src/main.rs` mirrors the legacy `HiveArray::get` + `put` contract: `get()` marks a `MaybeUninit<T>` slot used and returns `*mut T`; a fallible path returns before `ptr::write`; later cleanup calls `put()` and drops the slot as initialized `T`. The witness uses `NeedsDrop(NonZeroU32)` so `Drop` must read initialized bytes. `experiments/EXP-072-bun-collections-crate/src/main.rs` is the direct Bun-crate witness: it depends on `bun_collections`, calls the real deprecated `HiveArray::<NeedsDrop, 1>::get()`, does not initialize the returned slot, then calls the real `HiveArray::put()`.

**Expected signal:** Miri reports uninitialized memory during `drop_in_place` of the claimed-but-unwritten slot.

**Observed signal:** `phase5_experiment_results/EXP-072.log` reports:
`Undefined Behavior: reading memory at alloc119[0x0..0x4], but memory is uninitialized` at `src/main.rs:8:17`, called from `MiniHive::<NeedsDrop, 1>::put`.

Direct Bun-crate logs:
- `phase5_experiment_results/EXP-072-bun-collections-crate.log`: default Miri reports a Stacked Borrows retag violation while `bun_collections::HiveArray::<NeedsDrop, 1>::put` calls `drop_in_place` at `/data/projects/bun/src/collections/hive_array.rs:347`; the raw pointer returned by `get()` was invalidated by the later `&mut self` receiver retag for `put()`.
- `phase5_experiment_results/EXP-072-bun-collections-crate-no-sb.log`: rerunning the same direct harness with `-Zmiri-disable-stacked-borrows` exposes the original validity bug behind the aliasing failure: `NeedsDrop::drop` reads an uninitialized `NonZeroU32`, called from `HiveArray::put` at `hive_array.rs:347`.

**Falsifiability:** the generic API-contract bug is confirmed by the Miri witness above. Per-caller live exploitability remains falsifiable: if each of the 8 Bun callers can be proven to perform infallible full initialization before any early return / panic / cleanup path reaches `put()`, keep this as a confirmed unsound API contract plus migration obligation rather than claiming a current production crash path.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-072
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-strict-provenance" cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-072.log

cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-072-bun-collections-crate
MIRIFLAGS="" CARGO_TARGET_DIR=/tmp/cargo-target cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-072-bun-collections-crate.log
MIRIFLAGS="-Zmiri-disable-stacked-borrows" CARGO_TARGET_DIR=/tmp/cargo-target cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-072-bun-collections-crate-no-sb.log
```

**Verdict:** CONFIRMED_UB (generic unsafe API contract; production caller proof still per-site)

**Notes:**
- **This is the largest single-template migration found in this audit pass**: 8 sites with a fully-documented and already-shipped replacement API. The Miri witness confirms the exact early-return-before-write hazard documented in the source comment.
- First-pass caller audit (2026-05-16) prevents overclaiming: the `server/mod.rs` and `h2_frame_parser.rs` callers cast the slot to `MaybeUninit<T>` and immediately call a placement constructor / `write`; the `DevServer.rs` caller receives `Node<DeferredRequest>` (bit-valid even while `data: MaybeUninit<_>` is unwritten) and uses `put_raw` on the pre-write `None` branch; the install callers mostly do immediate `ptr::write` of `Task` / `NetworkTask` shapes. These callers still should migrate because the API admits the confirmed UB, but the current artifact does **not** claim all eight sites are independently proven production crashes.
- Recommended Phase 8 R-block: one PR per crate (bun_install + bun_runtime), each migrating its 4 callers; after both land, delete the `#[deprecated]` methods from `bun_collections::hive_array`.
- Companion: Section O's EXP-001 confirms the same UB-class for the sibling `assume_init_slice` helper; both should land together.

---

## EXP-073: `CopyFileWindows.event_loop: &EventLoop` is mutated through `enter_scope(*mut EventLoop)`

**Finding ref:** Codex ast-grep follow-up sweep (`CODEX_AST_GREP_SWEEP_REVIEW_2026-05-16.md`) promoted after source + Miri verification.
**Section:** A (runtime-webcore) — `src/runtime/webcore/blob/copy_file.rs:1005, 1300, 1580, 1666`.
**Bucket:** 1 (Aliasing) + 14 (`*const T` mutation) + 23 (observed type/model drift).
**Severity:** MUST-BE-UB (Miri default Stacked Borrows + Tree Borrows witness).
**Hypothesis:** `CopyFileWindows` stores the VM event loop as `&'a EventLoop`, then `throw()` / `resolve_promise()` cast that shared reference to `*mut EventLoop` and call `EventLoop::enter_scope()`, which mutates `entered_event_loop_count`. `EventLoop` is not an `UnsafeCell` wrapper. Mutating through a raw pointer derived from a live shared reference violates Stacked Borrows / Tree Borrows. The sibling Windows writer already uses the correct representation: `WriteFileWindows.event_loop: *mut EventLoop` and passes that raw pointer to `enter_scope()`.

**Minimal reproducer:** `experiments/EXP-073/src/main.rs` mirrors the exact source shape: a `CopyFileWindowsShape { event_loop: &EventLoop }`, followed by `self.event_loop as *const EventLoop as *mut EventLoop`, followed by `enter_scope()` mutating `entered_event_loop_count`.

**Expected signal:** default Miri: `trying to retag ... for SharedReadWrite permission ... but that tag only grants SharedReadOnly`; Tree Borrows: `write access ... is forbidden`.

**Falsifiability:** if `CopyFileWindows.event_loop` changes to `*mut EventLoop` (like `WriteFileWindows`) or `EventLoop::enter_scope()` is changed to operate only through interior-mutability fields (`UnsafeCell` / atomics) without forming `&mut EventLoop`, close as RESOLVED. If the Windows cfg is no longer compiled, demote to `DEFERRED` but keep the source-shape note.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-073
MIRIFLAGS="" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-073-default-miri.log
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-073-tree-borrows.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Default Miri log: `phase5_experiment_results/EXP-073-default-miri.log`.
- Tree-Borrows log: `phase5_experiment_results/EXP-073-tree-borrows.log`.
- Fix shape is mechanical and isomorphic: store `event_loop: *mut jsc::event_loop::EventLoop` in `CopyFileWindows`, matching `WriteFileWindows`, and use shared references only for read-only pre-scheduling calls before the async object escapes.

---

## EXP-074: `TimerObjectInternals::parent_ptr(&self)` writes `EventLoopTimer.state` through shared provenance

**Finding ref:** F-A14-F in `phase4_unified_findings.md`; Bucket-14 `from_ref(self).cast_mut()` caller audit.
**Section:** J/runtime-timer — `src/runtime/timer/timer_object_internals.rs:106-131, 856-869, 970-1021`.
**Bucket:** 14 (`*const T` mutation) + 1 (aliasing/provenance) + 21 (callback/re-entry model).
**Severity:** MUST-BE-UB (default Miri + Tree Borrows witness).
**Hypothesis:** `TimerObjectInternals::parent_ptr(&self)` starts from `std::ptr::from_ref::<Self>(self).cast_mut()`, uses `from_field_ptr!` to recover the parent `TimeoutObject`/`ImmediateObject`, and `event_loop_timer(&self)` returns a raw `*mut EventLoopTimer`. `set_event_loop_timer_state(&self)` then writes the plain `EventLoopTimer.state` field through that pointer. Because the raw pointer lineage starts from a live shared reference, the write violates Stacked Borrows / Tree Borrows. The source comment says writes must go through `Cell`/`UnsafeCell`, but `EventLoopTimer.state` is a plain field.

**Minimal reproducer:** `experiments/EXP-074/src/main.rs` mirrors the source shape with `TimeoutObject { event_loop_timer, internals }`, `TimerObjectInternals::parent_ptr(&self)`, `event_loop_timer(&self) -> *mut EventLoopTimer`, and `set_event_loop_timer_state(&self)` writing `state`.

**Expected signal:** default Miri reports a write using a tag created by `SharedReadOnly`; Tree Borrows reports the same write through a `Frozen` tag.

**Falsifiability:** if production changes `parent_ptr` / `event_loop_timer` / `set_event_loop_timer_state` so writes are derived from `&mut self`, `std::ptr::from_mut`, raw parent provenance, or an interior-mutability field (`Cell`/`UnsafeCell`) rather than a shared reference, close as RESOLVED. If `set_event_loop_timer_state` is removed and all parent recovery is read-only, demote to REVIEWED.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-074
MIRIFLAGS="" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-074-default-miri.log
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-074-tree-borrows.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Default Miri log: `phase5_experiment_results/EXP-074-default-miri.log` (`tag ... was created by a SharedReadOnly retag` at `ptr::from_ref`).
- Tree-Borrows log: `phase5_experiment_results/EXP-074-tree-borrows.log` (`accessed tag ... has state Frozen`).
- This promotes F-A14-F from suspicious watchlist to confirmed. Fix shape should mirror the rest of the timer noalias-remediation work: carry raw parent/timer provenance for mutable state writes, or make `EventLoopTimer.state` an explicit interior-mutability field if the API must stay `&self`.

---

## EXP-075: `DevServer` stores `std::ptr::from_ref(self)` then mutates through `dev.cast_mut()`

**Finding ref:** F-A14-D in `phase4_unified_findings.md`; Bucket-14 DevServer caller audit.
**Section:** G (runtime-bake-dev-server) — `src/runtime/bake/DevServer.rs:2115, 3021`.
**Bucket:** 14 (`*const T` mutation) + 1 (aliasing/provenance).
**Severity:** MUST-BE-UB (default Miri + Tree Borrows witness).
**Hypothesis:** `DevServer::try_define_deferred_request(&mut self, ...)` stores `dev: std::ptr::from_ref(self)` inside `DeferredRequest`. Later, `DeferredRequest::__free(&mut self)` does `(*self.dev.cast_mut()).deferred_request_pool.put(node)`. The stored pointer was minted from a shared reborrow of `&mut DevServer`, so writing through `.cast_mut()` violates Stacked Borrows / Tree Borrows. The local one-line fix is to store `std::ptr::from_mut(self)` (or a raw `NonNull<DevServer>` derived from it) when constructing the backref.

**Minimal reproducer:** `experiments/EXP-075/src/main.rs` mirrors the source shape: `DevServer::define_deferred_request(&mut self)` stores `core::ptr::from_ref(self)`, and `DeferredRequest::free()` mutates `(*dev.cast_mut()).deferred_request_pool`.

**Expected signal:** default Miri reports the write tag only grants `SharedReadOnly`; Tree Borrows reports a write through a `Frozen` tag.

**Falsifiability:** if production changes `dev` construction to `std::ptr::from_mut(self)` / `NonNull::from(self)` or otherwise proves the backref originated with raw mutable provenance, close as RESOLVED. If `__free` no longer mutates `DevServer`, demote to REVIEWED.

**Invocation:**
```
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-075
MIRIFLAGS="" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-075-default-miri.log
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-075-tree-borrows.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Default Miri log: `phase5_experiment_results/EXP-075-default-miri.log` (`tag only grants SharedReadOnly permission`).
- Tree-Borrows log: `phase5_experiment_results/EXP-075-tree-borrows.log` (`tag ... has state Frozen`).
- This promotes F-A14-D from OPEN to confirmed. The remediation is intentionally tiny: change the origin pointer, not the pool logic.

---

## EXP-076: `WindowsNamedPipeContext::deinit_in_next_tick` mutates `VirtualMachine` through a `&'static VirtualMachine` backref

**Finding ref:** F-A14-E in `phase4_unified_findings.md`; Bucket-14 WindowsNamedPipe caller audit.
**Section:** E/P crossover (runtime-socket-udp-tcp + sys/event-loop/threading) — `src/runtime/socket/WindowsNamedPipeContext.rs:269-272`.
**Bucket:** 14 (`*const T` mutation) + 1 (aliasing)
**Severity:** MUST-BE-UB
**Hypothesis:** `WindowsNamedPipeContext::create` stores `vm: &'static VirtualMachine`, and `deinit_in_next_tick(this: *mut Self)` later does `ptr::from_ref::<VirtualMachine>((*this).vm).cast_mut()` followed by `(*vm).enqueue_task(...)`. `VirtualMachine::enqueue_task(&mut self)` mutates through `event_loop_mut()`. The single-thread/process-global argument can justify scheduling discipline, but it does not make a mutable reborrow derived from a shared reference valid under Stacked Borrows / Tree Borrows.

**Minimal reproducer:** `experiments/EXP-076/src/main.rs` mirrors the source shape: store `&'static VirtualMachine` inside a context, recover `*mut VirtualMachine` with `ptr::from_ref(...).cast_mut()`, and call `enqueue_task(&mut self)` to mutate the nested event loop.

**Expected signal:** default Miri rejects the two-phase `&mut self` retag as SharedReadOnly-derived; Tree Borrows rejects the nested event-loop write under a Frozen tag.

**Falsifiability:** if `WindowsNamedPipeContext` no longer stores `&'static VirtualMachine`, or if `deinit_in_next_tick` no longer calls a whole-VM `&mut self` API from a `ptr::from_ref(...).cast_mut()` origin, close as RESOLVED. If `VirtualMachine::enqueue_task` is changed to take `&self` and uses only audited interior mutability / raw event-loop projection internally, re-run the EXP-076 fix harness and mark RESOLVED if Miri-clean.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-076
MIRIFLAGS="" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-076-default-miri.log
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-076-tree-borrows.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Default Miri log: `phase5_experiment_results/EXP-076-default-miri.log` (`tag only grants SharedReadOnly permission` at the `(*vm).enqueue_task()` receiver retag).
- Tree-Borrows log: `phase5_experiment_results/EXP-076-tree-borrows.log` (`EventLoop::enqueue_task` write through a child of a Frozen tag).
- Fix-model logs: `phase5_experiment_results/EXP-076-fix-event-loop-ptr-default-miri.log` and `EXP-076-fix-event-loop-ptr-tree-borrows.log` are Miri-clean. They model the remediation by storing a stable raw event-loop pointer and enqueueing through that narrower projection, not by forging a whole-VM `&mut`.
- The remediation can reuse the EXP-042 family plan: stop storing a shared-reference origin when later mutation is required. Store a raw VM/event-loop pointer derived from mutable provenance, or use a VM API that takes `&VirtualMachine` and performs explicit interior mutability for the task queue.

---

## EXP-077: `CssModuleExports` / `CssModuleReferences` arena borrows are returned as `'static`

**Finding ref:** F-NF6-3 in `phase4_unified_findings.md`; Section R lifetime-transmute cluster; `src/css/css_parser.rs:2718, 2723`.
**Section:** R (parsers-and-lang) — `bun_css` CSS module printing result type.
**Bucket:** 6 (transmute / validity) + 15 (lifetime escape)
**Severity:** MUST-BE-UB as a safe-API shape; current in-tree consumers observed in this pass only read `result.code`, so production reachability of the dangling fields remains caller-dependent.
**Hypothesis:** `ToCssResult` and `ToCssResultInternal` expose `CssModuleExports<'static>` / `CssModuleReferences<'static>`, but those maps contain keys and payload slices borrowed from the parser/printer bump arena. The implementation explicitly transmutes `CssModuleExports<'_> -> CssModuleExports<'static>` and `CssModuleReferences<'_> -> CssModuleReferences<'static>`. A safe caller can keep the public result after the arena is dropped/reset and then read a dangling slice through a `'static`-typed field.

**Minimal reproducer:**
```rust
#[derive(Clone, Copy)] struct Export<'a> { name: &'a [u8] }
struct Result_ { exports: Option<Export<'static>> }
fn erase<'a>(x: Export<'a>) -> Export<'static> {
    unsafe { core::mem::transmute::<Export<'a>, Export<'static>>(x) }
}
fn make() -> Result_ {
    let backing = Vec::from(b"class_name".as_slice());
    let out = Result_ { exports: Some(erase(Export { name: &backing })) };
    drop(backing);
    out
}
fn main() {
    let out = make();
    std::hint::black_box(out.exports.unwrap().name[0]);
}
```

**Expected signal:** default Miri reports a dangling reference / use-after-free when constructing or reading the `'static`-typed result.

**Falsifiability:** if `ToCssResult` is retyped to carry the real bump lifetime (for example `ToCssResult<'bump>` with `CssModuleExports<'bump>` / `CssModuleReferences<'bump>`), or if the maps are deep-copied into owned `Box<[u8]>` / `Vec<u8>` storage before return, close as RESOLVED. If an in-tree call graph proves the dangerous fields never escape and the crate is made private to that call discipline, keep the Miri witness but demote public severity to hardening.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-077
MIRIFLAGS="" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-077-default-miri.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-077-default-miri.log` (`constructing invalid value of type ToCssResult ... dangling reference (use-after-free)`).
- This closes the previous "no EXP yet" gap for F-NF6-3. The exact Bun source lines are `src/css/css_parser.rs:2718` and `:2723`; the type-level TODO at `src/css/css_parser.rs:2309-2314` already identifies the missing arena lifetime.
- Current source audit found four `to_css` callers (`bundler/transpiler.rs`, `prepareCssAstsForChunk.rs`, `css_jsc/css_internals.rs` ×2). The reviewed snippets use `result.code` / `print_result.code` and drop `exports` / `references`. That limits current production exploitability, but it does not make the public safe result type sound.

---

## EXP-078: `ArrayLike::set_len_and_slice` is a safe API that returns `&mut [T]` over uninitialized `Vec` storage

**Finding ref:** NEW-U-3 in `phase4_unified_findings.md`; Bucket 5 uninit sweep; `src/bun_core/util.rs:111-119, 166, 294-301`.
**Section:** N (bun_core-foundation) / O (alloc-and-collections) crossover.
**Bucket:** 5 (uninitialized memory / `set_len`) + 11 (unsafe library contract exposed through safe API)
**Severity:** MUST-BE-UB as a safe-API shape; the intended in-tree `from_slice` caller fills immediately with `copy_from_slice`, but the trait method itself is safe and public.
**Hypothesis:** `ArrayLike::set_len_and_slice(&mut self, n) -> &mut [Self::Elem]` is a safe trait method. The `Vec<T>` implementation reserves capacity, calls `unsafe { self.set_len(n) }`, and immediately returns `self.as_mut_slice()`. Any safe caller can inspect the returned slice before writing all elements; for validity-sensitive `T` such as `bool`, that reads uninitialized memory through a safe API.

**Minimal reproducer:** `experiments/EXP-078/src/main.rs` mirrors the exact trait surface and `Vec<T>` implementation, calls the safe method on `Vec<bool>`, then forces an observable read with `std::hint::black_box(live[0])`. `experiments/EXP-078-bun-core-crate/` is the direct Bun-crate witness: it depends on the real `bun_core` crate, imports `bun_core::util::ArrayLike`, calls the actual `Vec<bool>` implementation, and reads the returned slice.

**Expected signal:** default Miri reports `reading memory ... but memory is uninitialized`.

**Falsifiability:** if `set_len_and_slice` becomes `unsafe fn` with caller-side initialization preconditions, or is replaced by a closure API that initializes every element before any typed slice escapes, close as RESOLVED. If the method is made private and every call site is proven to immediately fill the slice without panic/intermediate observation, demote to hardening.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-078
MIRIFLAGS="" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-078-default-miri.log

cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-078-bun-core-crate
CARGO_TARGET_DIR=/tmp/cargo-target cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-078-bun-core-crate.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-078-default-miri.log` (`reading memory at alloc... but memory is uninitialized` at `std::hint::black_box(live[0])`).
- Direct Bun-crate log: `phase5_experiment_results/EXP-078-bun-core-crate.log` repeats the same invalid uninitialized `bool` read through the real `bun_core::util::ArrayLike` trait implementation.
- The first weaker harness (`let _ = live[0]`) ran clean because the read was not forced strongly enough; the current witness uses `black_box` so the invalid read is observed. Keep this note to prevent overclaiming from a non-firing harness.
- This closes the previous "no EXP yet" gap for NEW-U-3. The optimal fix is not to rely on comments around `from_slice`; the trait method's signature must encode the unsafe precondition or avoid returning initialized-typed storage before initialization is complete.

---

## EXP-079: `Transpiler::env_mut(&self) -> &'a mut Loader<'a>` mints coexisting mutable borrows

**Finding ref:** F-L-7 in `phase4_unified_findings.md`; Bucket 15 lifetime escape / Bucket 1 aliasing; `src/bundler/transpiler.rs:262`.
**Section:** M/R crossover (bundler/transpiler and runtime callers).
**Bucket:** 15 (lifetime escape) + 1 (aliasing)
**Severity:** MUST-BE-UB as a safe-API shape; production callers often use it in carefully scoped statement-sized borrows, but the safe method itself allows the two-call witness.
**Hypothesis:** `Transpiler::env_mut(&self) -> &'a mut dot_env::Loader<'a>` derives a mutable reference from a shared receiver and a raw `self.env` pointer. For `Transpiler<'static>`, safe code can call `env_mut()` twice and obtain two coexisting `&'static mut Loader` references to the same allocation. This is the F-L-1 / EXP-057 caller-chosen-lifetime hazard, but confirmed here against the concrete `Transpiler::env_mut` API shape rather than only the abstract cluster model.

**Minimal reproducer:** `experiments/EXP-079/src/main.rs` mirrors the concrete shape:
```rust
struct Transpiler<'a> { env: *mut Loader, _marker: PhantomData<&'a mut Loader> }
impl<'a> Transpiler<'a> {
    fn env_mut(&self) -> &'a mut Loader { unsafe { &mut *self.env } }
}
let first = t.env_mut();
let second = t.env_mut();
first.value = 1;
second.value = 2;
```

**Expected signal:** Tree-Borrows Miri reports a write through a disabled tag after the first mutable borrow's write invalidates the second borrow's tag.

**Falsifiability:** if `env_mut` is changed to take `&mut self` and return `&mut Loader` tied to the receiver borrow, or changed to return a raw `*mut Loader` / callback-scoped closure so safe callers cannot hold two `&mut Loader`s, close as RESOLVED. If every public caller is made unsafe and documents the single-live-borrow invariant, demote to an unsafe-contract finding.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-079
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-079.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-079.log` (`write access through <354> ... is forbidden`; tag created at second `env_mut()`, disabled by the foreign write through the first borrow).
- This does **not** claim that every in-tree `env_mut()` call is currently live UB. Several call sites already contain statement-scoped reborrow comments and re-derive after invalidating calls. The finding is that the safe API boundary is unsound: safe callers can construct the UB witness with no `unsafe` at the call site.
- A second same-shape API exists at `src/install/PackageManager.rs:1100`: `pub fn env_mut<'a>(&self) -> &'a mut dot_env::Loader<'static>`. This is not separately counted here, but Phase 8 remediation must sweep both `env_mut(&self)` entry points rather than patching only `Transpiler`.
- The adjacent `set_arena(detach_lifetime_ref(&arena))` sites in `JSTranspiler.rs` are a separate per-call lifetime contract. They remain proof obligations, but EXP-079 specifically closes the `env_mut(&self)` portion of F-L-7.

---

## EXP-080: `bun_dispatch::link_interface!` emits public handle fields that bypass `unsafe fn new`

**Finding ref:** F-S-32 in `phase4_unified_findings.md`; Bucket 8 / Bucket 13 dispatch-handle contract defect; `src/dispatch/lib.rs:302-318` plus users such as `src/bundler/lib.rs:326-342`.
**Section:** Cross-cutting (`bun_dispatch` macro, `DevServerHandle`, `VmLoaderCtx`, `OutputSink`, `Pollable`, `SystemThread`, crash-handler dispatch handles).
**Bucket:** 8 (Send/Sync / unsafe trait-adjacent contracts) + 10 (FFI/extern dispatch) + 11 (unsafe library contract exposed through safe API)
**Severity:** MUST-BE-UB as a safe-API shape.
**Hypothesis:** `bun_dispatch::link_interface!` documents that the handle validity invariant is established by `unsafe fn <Iface>::new(kind, owner)`, but the generated handle type is:

```rust
#[derive(Copy, Clone)]
pub struct #name {
    pub kind: #kind,
    pub owner: *mut (),
}
```

Safe Rust can therefore bypass `unsafe fn new`, construct a handle with an arbitrary `kind`/`owner` pair (including null, dangling, or wrong-type pointers), and call the generated safe dispatch methods. Those methods pass `owner` into `unsafe extern "Rust"` implementation thunks, whose bodies immediately cast and dereference `*mut T` under the assumption that `new` validated the pair.

**Minimal reproducer:** `experiments/EXP-080-bun-dispatch-crate/src/main.rs` is the direct Bun-crate witness: it depends on the real `bun_dispatch` proc-macro crate, calls `bun_dispatch::link_interface!`, implements the generated `link_impl_Handle!` macro, then constructs the generated `Handle { kind, owner }` from safe code with `owner = null_mut()` and calls the generated safe `read_byte()` dispatcher. The older `experiments/EXP-080/src/main.rs` remains as a minimized mirror of the same public-fields shape.

**Expected signal:** default Miri reports a null-pointer access through the safe method.

**Falsifiability:** if the generated fields become private and the only constructor for external callers is `unsafe fn new`, the safe-forgery witness no longer compiles and this finding closes. If every generated dispatch method is made unsafe, the bug becomes an explicit unsafe-contract requirement rather than an unsound safe API.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-080
MIRIFLAGS="" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-080-default-miri.log

cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-080-bun-dispatch-crate
MIRIFLAGS="" CARGO_TARGET_DIR=/tmp/cargo-target cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-080-bun-dispatch-crate.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw logs: `phase5_experiment_results/EXP-080-default-miri.log` and direct `phase5_experiment_results/EXP-080-bun-dispatch-crate.log`; both report `memory access failed: attempting to access 1 byte, but got null pointer`. The direct witness proves the failure comes from Bun's actual `link_interface!` / `link_impl_*!` expansion, not just a hand-written model.
- This is the stronger, cleaner form of the `DevServerHandle` / `CompletionHandle` concern. The problem is not merely "no compile-time proof the erased owner is Send+Sync"; it is that safe code can forge an erased owner despite the macro comments saying `unsafe fn new` is the sole invariant-establishing point.
- Optimal fix: make `kind` and `owner` private in the generated handle, optionally add `as_raw_parts()` / `from_raw_parts_unchecked()` for the few call sites that truly need raw access, and keep dispatch methods safe only because construction is unsafe-gated.

---

## EXP-081: POSIX `bun_sys::dir_iterator::Name` is a lifetime-erased safe dangling-slice API

**Finding ref:** F-DR-10 in `phase4_unified_findings.md`; Bucket 7 / Bucket 8 / Bucket 15; `src/sys/lib.rs:154-159, 183-192, 207-221, 804-808`.
**Section:** P / D boundary (`bun_sys::dir_iterator` POSIX iterator, consumed by glob/install/resolver/shell/path-watcher code).
**Bucket:** 15 (lifetime escape) + 8 (unsafe Send/Sync invariants) + 7 (cross-thread sendability, but cross-thread use is not required for the UB witness).
**Severity:** MUST-BE-UB as a safe-API shape.
**Hypothesis:** On POSIX, `WrappedIterator::next(&mut self) -> Result<Option<IteratorResult>>` is a safe function returning an owned `IteratorResult` with no lifetime parameter tying it to the iterator borrow. Its `IteratorResult::name: Name` is `Copy + Clone` and contains `ptr: NonNull<u8>, len: usize` pointing into the iterator's inline `AlignedBuf`. The source comments correctly document that the name is invalidated by the next `next()` call and by moving/dropping the iterator, but Rust's type system does not encode that contract. Safe code can retain `IteratorResult`, drop the iterator, and then call `entry.name.slice_u8()`, which forms a slice from a dangling pointer.

**Minimal reproducer:** `experiments/EXP-081/src/main.rs` mirrors the current POSIX shape: `FakePosixIterator::next(&mut self) -> Option<IteratorResult>`, `IteratorResult { name: Name }`, `Name { ptr: NonNull<u8>, len }`, `unsafe impl Send/Sync for Name`, and safe `Name::slice_u8()`. `main()` obtains an entry, drops the iterator, then calls `entry.name.slice_u8()[0]` in safe code. A direct source-linked attempt also exists at `experiments/EXP-081-bun-sys-crate/`: it opens a real temp directory, feeds the fd into `bun_sys::dir_iterator::iterate`, and attempts to retain `IteratorResult` past iterator drop. That direct attempt currently stops at Miri's unsupported Linux `getdents64` syscall before producing an entry, so it is a tool-limit log rather than the primary confirmation.

**Expected signal:** default Miri reports a dangling-pointer dereference while constructing the slice.

**Falsifiability:** if POSIX `IteratorResult` becomes `IteratorResult<'iter>` with `name: Name<'iter>` borrowing `&'iter self`, or if `Name` owns/copys its bytes, the safe dangling witness no longer compiles. If all public accessors on `Name` become unsafe and document the caller obligation, this becomes an explicit unsafe contract instead of an unsound safe API.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-081
set -o pipefail
MIRIFLAGS="" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-081-rerun.log

cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-081-bun-sys-crate
MIRIFLAGS="-Zmiri-disable-isolation" CARGO_TARGET_DIR=/tmp/cargo-target cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-081-bun-sys-crate-disable-isolation.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-081-rerun.log` (`pointer not dereferenceable: alloc209 has been freed, so this pointer is dangling` at `Name::slice_u8`).
- Direct `bun_sys` attempt logs: `phase5_experiment_results/EXP-081-bun-sys-crate.log` first hit existing EXP-089 during Bun's path-opening helper; the revised `phase5_experiment_results/EXP-081-bun-sys-crate-disable-isolation.log` bypasses that opener and reaches `src/sys/lib.rs:345` / `src/sys/linux_syscall.rs:498`, then stops because Miri does not support `SYS_getdents64` (syscall 217). Do not cite the direct attempt as a confirming Miri UB trace; cite it as source-linked coverage blocked by Miri syscall support.
- This corrects the previous artifact framing. F-DR-10 is not merely a "cross-thread send of outstanding Name" watchlist item and does not need a live cross-thread caller. The safe lifetime-erased result value alone is enough to construct UB.
- The best fix remains S5's owned-result migration (copy the entry name out of the kernel buffer), or a lifetime-parameterized `IteratorResult<'iter>` if the per-entry copy is unacceptable.

---

## EXP-082: `Blob: Send + Sync` exposes safe `Option<&JSGlobalObject>` access across threads

**Finding ref:** F-S-11 in `phase4_unified_findings.md`; Bucket 8 / Bucket 21; `src/jsc/webcore_types.rs:60-96, 220-231`; downstream uses in `src/runtime/webcore/Blob.rs:1509,1557,1869,1911`.
**Section:** A / K boundary (`bun_jsc::webcore_types::Blob`, JSC-global thread affinity).
**Bucket:** 8 (unsafe Send/Sync invariants) + 21 (cross-thread callback / thread-affinity contracts).
**Severity:** MUST-BE-UB as a generic safe-API contract; production live path still needs per-caller classification.
**Hypothesis:** `Blob` contains `global_this: Cell<*const JSGlobalObject>` and declares `unsafe impl Send` + `unsafe impl Sync`. The safe method `Blob::global_this(&self) -> Option<&JSGlobalObject>` then exposes a `&JSGlobalObject` from any thread that can hold `&Blob` / `Arc<Blob>`. `JSGlobalObject` is explicitly an opaque `!Send + !Sync` JSC handle, and `JSGlobalObject::bun_vm()` documents "same-thread callers only; cross-thread paths must use bun_vm_concurrently". Several `BlobExt` paths immediately call `self.global_this().expect(...).bun_vm().as_mut().event_loop()` from a shared `&Blob`.

**Minimal reproducer:** `experiments/EXP-082/src/main.rs` mirrors the public contract with `Blob { global_this: Cell<*const Global> }`, `unsafe impl Send/Sync for Blob`, and safe `global_this(&self) -> &Global`. `Global` contains a `Cell<u32>` to model the JS-thread-only mutable state behind `JSGlobalObject`. Two threads use only safe code to obtain `&Global` from an `Arc<Blob>` and mutate the `Cell`.

**Expected signal:** default Miri reports a data race on the `Cell<u32>`.

**Falsifiability:** if `Blob` stops being `Send + Sync`, or if `Blob::global_this()` becomes JS-thread-checked / unsafe / raw-pointer-only for cross-thread contexts, the safe witness no longer applies. If every production `Blob` crossing a worker boundary first clears `global_this` and only reinstalls it on the JS thread before calling any JS-global accessor, keep this as a generic contract defect but downgrade production exploitability.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-082
set -o pipefail
MIRIFLAGS="" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-082.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-082.log` (`Data race detected between ... Cell::<u32>::set` on two threads).
- This deliberately does **not** claim a proven production race through `ObjectURLRegistry` or Blob read/write tasks. It proves the safe API boundary is unsound: a type that is explicitly sendable/syncable can expose a safe reference to a JS-thread-affine non-Sync handle.
- Best fix direction: remove `Sync` from `Blob` if possible; otherwise split the data-only, cross-thread blob payload from the JS-thread-affine wrapper that carries `global_this`. A raw-pointer `global_this_ptr_for_js_thread_only()` accessor is preferable to a safe `&JSGlobalObject` accessor on a `Send + Sync` type.

---

## EXP-083: `IOWriter` / `IOReader` `Sync` exposes safe `&self` mutation of `UnsafeCell<State>`

**Finding ref:** F-S-12 in `phase4_unified_findings.md`; Bucket 8 + Bucket 7; `src/runtime/shell/IOWriter.rs:237-252, 969-985`; `src/runtime/shell/IOReader.rs:72-100, 220-268`.

**Section:** H (runtime-shell) — shell IO reader/writer handles.
**Bucket:** 8 (unsafe Send/Sync), 7 (data race / unsynchronized interior mutation), 1 (aliasing through coexisting `&mut State`).
**Severity:** MUST-BE-UB as a generic safe-API contract; production live path still needs per-caller classification.

**Hypothesis:** `IOWriter` and `IOReader` both store `UnsafeCell<State>` and declare `unsafe impl Send` + `unsafe impl Sync`. They then expose safe `&self` methods that mutate the cell: `IOWriter::enqueue`, `cancel_chunks`, `set_interp`, and `IOReader::start`, `add_reader`, `remove_reader`. Because the types are `Sync`, safe Rust can share `Arc<IOWriter>` / `Arc<IOReader>` across threads and invoke those mutating methods concurrently. The previous artifact wording blamed cross-thread `Arc` drop; that is weaker. The actual UB boundary is the safe shared method set.

**Minimal reproducer:** `experiments/EXP-083/src/main.rs` mirrors `IOWriter { state: UnsafeCell<State> }`, `unsafe impl Send/Sync`, and a safe `enqueue(&self)` method that mutates `state.buf`. Two threads share `Arc<IOWriterShape>` and call `enqueue` simultaneously.

**Expected signal:** Miri default / Stacked Borrows rejects the second safe `&mut *self.state.get()` reborrow (or reports a data race on the underlying vector metadata), proving the safe API admits undefined behavior.

**Falsifiability:** if `IOWriter` / `IOReader` stop being `Sync`, or if all state-mutating methods become unsafe / thread-checked / serialized through a real mutex/event-loop queue, the witness no longer applies. If source audit proves these types never escape the shell thread and are not constructible from external safe code, production exploitability may be demoted, but the generic safe contract remains unsound while the safe methods exist.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-083
MIRIFLAGS="" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-083.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-083.log` (`not granting access to tag ... because that would remove [Unique] which is strongly protected` at the safe `enqueue(&self)` `UnsafeCell` reborrow).
- Remediation should remove `Sync` first. If background shell tasks genuinely need to hold references, move cross-thread work through an event-loop task handle or wrap mutable state in a real mutex; do not publish a `Sync` type whose safe methods call `&mut *UnsafeCell`.

---

## EXP-084: `VirtualMachine: Send + Sync` plus safe TLS-backed `as_mut()` / `get_mut()` is a cross-thread UB trap

**Finding ref:** F-S-14 in `phase4_unified_findings.md`; Bucket 8 / Bucket 7; `src/jsc/VirtualMachine.rs:604-688`.

**Section:** K (jsc-core) — foundational JS-thread-affinity contract.
**Bucket:** 8 (unsafe Send/Sync), 7 (thread-local state assumed by safe API), 21 (JS-thread-affinity boundary).
**Severity:** MUST-BE-UB as a generic safe-API contract; current production caller reachability remains separate.

**Hypothesis:** `VirtualMachine` declares `unsafe impl Sync` and `unsafe impl Send` so `&'static VirtualMachine` can satisfy `'static` / thread-bound APIs. But safe methods `VirtualMachine::as_mut(&self) -> &mut VirtualMachine` and `VirtualMachine::get_mut() -> &'static mut VirtualMachine` route through `get_mut_ptr()`, which reads a thread-local VM slot and then calls `unwrap_unchecked()`. A safe caller can capture `&'static VirtualMachine` from a VM-owning thread, move that shared reference to a non-VM thread (per the `Sync` impl), and call the safe `as_mut()` method. Even more directly, any safe code running on a non-VM thread can call the public safe `VirtualMachine::get_mut()` static method. On that thread the TLS slot is `None`; in release, the debug assertion is gone and `unwrap_unchecked(None)` is immediate UB.

**Minimal reproducer:** `experiments/EXP-084/src/main.rs` mirrors Bun's public contract: TLS `Cell<Option<NonNull<VirtualMachine>>>`, `unsafe impl Send/Sync`, safe `get() -> &'static VirtualMachine`, safe `as_mut(&self) -> &mut VirtualMachine`, and `get_mut_ptr().unwrap_unchecked()`. Main installs the TLS VM, captures `&'static VirtualMachine`, then sends the reference to a scoped thread with no VM installed and calls `as_mut()` using only safe code.

**Expected signal:** `cargo +nightly miri run --release` reports UB at `unwrap_unchecked()` (`entering unreachable code`) on the spawned thread.

**Falsifiability:** if `VirtualMachine` becomes `!Send + !Sync`, or if `as_mut()` / `get_mut()` become unsafe or return `Option`/panic instead of `unwrap_unchecked`, the safe-call UB trap closes. If all real cross-thread users can be proven to use only raw task handles and never capture `&VirtualMachine`, production exploitability can be demoted, but the safe API contract remains unsound while the methods and auto-traits coexist.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-084
set -o pipefail
cargo +nightly miri run --release 2>&1 | tee ../../phase5_experiment_results/EXP-084-release.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-084-release.log` (`Undefined Behavior: entering unreachable code` at the modeled `get_mut_ptr().unwrap_unchecked()` on `unnamed-1`).
- This tightens the prior F-S-14 wording. The old "foundational lie, defensible" framing is not precise enough: the cross-thread type assertion is load-bearing, but the safe methods must not use `unwrap_unchecked` for a caller-controlled thread-local precondition.
- The captured-`&VirtualMachine` witness is not the only proof path. Because `VirtualMachine::get_mut()` itself is a public safe static method at `src/jsc/VirtualMachine.rs:684-688`, calling it from any non-VM thread reaches the same unchecked TLS precondition without first obtaining a `&VirtualMachine`.
- This does **not** claim that a production Bun worker currently captures a `&VirtualMachine` and calls `as_mut()` off-thread. It proves the exported safe Rust API admits UB without an unsafe block. Phase 8 should pair this with the `JsThreadAffine` marker-trait plan already drafted in EXP-057.

---

## EXP-085: `bun_core::fmt::Raw` / `fmt::s` safe `Display` forms invalid `&str` from caller bytes

**Finding ref:** prior unsafe-audit P3-BC-001; Codex validity-API follow-up (2026-05-16); `src/bun_core/fmt.rs:724-731` (`Raw` + `Display`) and `src/bun_core/fmt.rs:3744-3749` (`fmt::s` safe constructor).

**Section:** N/C crossover (`bun_core` formatting primitive, CLI/install/runtime call sites).
**Bucket:** 4 (validity invariant: `str` must be valid UTF-8) + 12 (safe trait contract).
**Severity:** MUST-BE-UB as a generic safe-API contract; production reachability depends on each `fmt::s` caller's byte-source contract.

**Hypothesis:** `Raw<'a>(pub &'a [u8])` is a safe wrapper, and its `Display::fmt` implementation calls `core::str::from_utf8_unchecked(self.0)`. Safe callers can pass arbitrary non-UTF-8 bytes through `fmt::s` / `fmt::raw`; the implementation then constructs an invalid `&str`, violating Rust's `str` validity invariant. This was correctly recorded by the prior unsafe audit but was not promoted into the UB experiment registry. Current source still has the same shape.

**Minimal reproducer:**
```rust
use std::fmt;
#[repr(transparent)]
struct Raw<'a>(&'a [u8]);
impl fmt::Display for Raw<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(unsafe { core::str::from_utf8_unchecked(self.0) })
    }
}
fn main() {
    let attacker_bytes = [0xff_u8];
    let rendered = format!("{}", Raw(&attacker_bytes));
    let _ = std::hint::black_box(rendered.chars().next());
}
```
The direct Bun-crate witness at
`experiments/EXP-085-bun-core-crate/src/main.rs` depends on `bun_core` by path
and calls the real safe `bun_core::fmt::s(&[0xff])` adapter before consuming the
resulting formatted string.

**Expected signal:** Miri reports UB once the invalid `str` is consumed (`core::str::next_code_point` enters unreachable code). The abstract-machine violation occurs earlier at the `from_utf8_unchecked` precondition; the `chars()` call is only there to make the invalidity observable to the current Miri toolchain.

**Falsifiability:** if `Raw` / `fmt::s` becomes `unsafe fn`, validates via `str_utf8` / `from_utf8_lossy`, or changes to a byte-oriented formatter that never constructs `&str` for arbitrary bytes, close as RESOLVED. If all remaining call sites are statically ASCII / UTF-8 and the constructor is made private, downgrade production exploitability but keep the API contract audited.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-085
MIRIFLAGS="" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-085.log
cd ../EXP-085-bun-core-crate && \
  CARGO_TARGET_DIR=/tmp/cargo-target/exp-085-bun-core-crate \
  cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-085-bun-core-crate.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-085.log` (`Undefined Behavior: entering unreachable code` in `core::str::next_code_point`).
- Codex follow-up added `experiments/EXP-085-bun-core-crate/`, a source-linked
  harness over the real `bun_core` crate. Raw log:
  `phase5_experiment_results/EXP-085-bun-core-crate.log`. Miri again reports
  UB in `core::str::next_code_point` after safe code calls
  `bun_core::fmt::s(&[0xff])`; the Bun-source unsoundness is the safe adapter's
  unchecked `from_utf8_unchecked` contract at `src/bun_core/fmt.rs:724-731`.
- This correction matters because `fmt::Raw` is exactly the kind of safe-code UB surface the UB skill is meant to catch: the unsafe block is tiny, but the bug is the safe API contract. Do not overclaim the stale unsafe-audit wording that said "argv reachability" unless a current call path is shown; current source does have live `fmt::s` call sites in `bun_core::output`, `install/extract_tarball.rs`, `PackageManagerDirectories.rs`, and others, and those must each be classified by byte-source.
- Best remediation: either make `fmt::raw` / `fmt::s` unsafe with an explicit UTF-8 precondition, or replace the formatter with `bstr::BStr` / lossy display for arbitrary bytes. For user-visible paths and tarball names, byte-oriented display is the safer default.

---

## EXP-086: `bun::unsafe_assert(false)` safe function reaches `unreachable_unchecked`

**Finding ref:** Codex unchecked-intrinsics follow-up (2026-05-16); `src/bun.rs:1582-1586`.

**Section:** N/C crossover (`bun` foundation helper; currently no in-tree call sites).
**Bucket:** 4 (validity / impossible-state assertion) + 12 (safe API contract).
**Severity:** MUST-BE-UB as a safe API contract; current production reachability is zero because `rg 'unsafe_assert\(' src --glob '*.rs'` finds only the definition.

**Hypothesis:** `pub fn unsafe_assert(condition: bool)` is safe and accepts an arbitrary `bool`, but calls `core::hint::unreachable_unchecked()` when `condition` is false. Safe Rust can call `unsafe_assert(false)` and immediately trigger UB. The function name advertises danger, but the Rust type system does not: the precondition must be expressed by making the function `unsafe fn`, replacing the body with `panic!` / `unreachable!`, or deleting the dead helper.

**Minimal reproducer:**
```rust
#[inline(always)]
pub fn unsafe_assert(condition: bool) {
    if !condition {
        unsafe { core::hint::unreachable_unchecked() };
    }
}

fn main() {
    unsafe_assert(std::hint::black_box(false));
}
```

**Expected signal:** Miri reports `Undefined Behavior: entering unreachable code` at the `unreachable_unchecked()` call.

**Falsifiability:** if current source deletes `unsafe_assert`, makes it `pub unsafe fn`, or changes the false branch to `panic!` / `unreachable!`, close as RESOLVED. If future source adds callers that prove the condition from an enum/macro invariant, the helper may remain internally useful, but the safe API contract still has to be fixed.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-086
cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-086.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-086.log` (`Undefined Behavior: entering unreachable code` at the modeled `unsafe_assert(false)`).
- Current reachability is intentionally not overstated: the helper is dormant (`rg` finds no callers). This is still a soundness defect in the safe function contract, like the other generic safe-API findings, and the fix is trivial.
- Do not fold this into `NEW-V-4`: that watchlist is about exhaustiveness assertions in active control-flow sites. EXP-086 is simpler and stronger: a safe public helper exposes the unchecked precondition directly as a caller-controlled `bool`.

---

## EXP-087: `bundler::ThreadPool::get_worker(&self)` returns duplicate `&'static mut Worker` handles for the same thread id

**Finding ref:** Codex safe-API follow-up (2026-05-16); promotion of `phase4_unified_findings.md` F-L-6 from `CONTRACTUAL-BUT-DEFENSIBLE` to a concrete EXP.

**Section:** M / N crossover (`src/bundler/ThreadPool.rs:414-428`; public wrapper `Worker::get(ctx)` at `ThreadPool.rs:629-652`).
**Bucket:** 15 (lifetime escape) + 1 (aliasing) + 8 (thread-affine worker state).
**Severity:** CONFIRMED_UB as a safe API contract; production reachability depends on whether callers ever keep two `Worker::get(ctx)` / `get_worker(id)` results live for the same OS thread.

**Hypothesis:** `ThreadPool::get_worker(&self, id: ThreadId) -> &'static mut Worker` looks up a per-thread raw `*mut Worker` in `workers_assignments` and returns `unsafe { &mut *w }` after dropping the map lock. For the same `id`, a safe caller can call the method twice and hold two live `&'static mut Worker` references to the same heap allocation. The lock serializes map lookup/mutation, not the lifetime of the returned reference. This is the EXP-057 family, but with a specific source site previously under-demoted as "contractual but defensible."

**Minimal reproducer:**
```rust
use std::cell::UnsafeCell;

#[derive(Default)]
struct Worker { touched: usize }

struct Pool { worker: UnsafeCell<Worker> }

impl Pool {
    fn get_worker(&self) -> &'static mut Worker {
        unsafe { &mut *self.worker.get() }
    }
}

fn main() {
    let pool = Pool { worker: UnsafeCell::new(Worker::default()) };
    let first = pool.get_worker();
    let second = pool.get_worker();
    first.touched = 1;
    second.touched = 2;
}
```

**Expected signal:** Miri Tree Borrows rejects the second write because the second `&mut` tag has been disabled by the first handle's foreign write.

**Falsifiability:** if `get_worker` / `Worker::get` becomes `unsafe fn`, returns `*mut Worker` / `NonNull<Worker>` instead of `&'static mut Worker`, or returns a guard/token whose borrow lifetime is tied to the map lock or a per-thread worker token, close as RESOLVED. If production call sites are proven one-call-at-a-time, keep exploitability lower but do not demote the safe API contract while the method can be called twice from safe Rust.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-087
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-087.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-087.log` (`write access through <245> ... is forbidden`; the second handle's tag was disabled by the first handle's write).
- The source comments at `ThreadPool.rs:405-413` correctly explain why `&self` avoids borrow-checker pain and why workers are heap-pinned. They do not establish Rust reference uniqueness after the map lock is dropped. The optimal fix is the same as the high-confidence EXP-057 remediation: expose a raw pointer / `NonNull<Worker>` or a closure/guard-scoped API, and materialize the short `&mut Worker` only at the use site where uniqueness can be audited.

---

## EXP-088: `E::String::init_utf16` narrows byte-slice provenance, then `slice16()` expands it back to u16 length

**Finding ref:** Codex alignment/provenance follow-up (2026-05-16); promotion of Phase-2 `EXP-N3 (UTF-16 reinterp)` from "type-system gap / better fix than EXP" to a source-faithful Miri witness.

**Section:** R (parsers-and-lang) / AST core (`src/ast/e.rs:1449-1459` constructor, `src/ast/e.rs:1413-1424` accessor; callers include `src/js_parser/lexer.rs:2751-2752`, `src/parsers/json_lexer.rs:575-581`, `src/parsers/yaml.rs:1782-1785`).
**Bucket:** 3 (alignment/provenance for typed references) + 15 (lifetime/provenance escape) + 11 (safe API contract).
**Severity:** CONFIRMED_UB as a safe API / source-faithful constructor shape.

**Hypothesis:** `E::String::init_utf16(data: &[u16])` casts the full `&[u16]` to bytes, then stores only the first `data.len()` bytes in `Str`:

```rust
let bytes = &bytemuck::cast_slice::<u16, u8>(data)[..data.len()];
Self { data: Str::new(bytes), is_utf16: true, ..Default::default() }
```

Later `slice16()` treats `data.len()` as a u16 element count:

```rust
slice::from_raw_parts(self.data.as_ptr().cast::<u16>(), self.data.len())
```

For `N` UTF-16 code units, the stored `Str` provenance covers `N` bytes, while `slice16()` retags `2*N` bytes. Miri rejects the expanded retag even when the original input was correctly aligned `&[u16]`. This is stronger than the original Phase-2 alignment suspicion: the issue is not only odd alignment or forged public fields; the current constructor/accessor pair narrows and re-expands the byte range.

**Minimal reproducer:** `experiments/EXP-088/src/main.rs` mirrors `init_utf16` and `slice16` exactly with a small local `Str` / `EString` model. The direct Bun-crate witness at `experiments/EXP-088-bun-ast-crate/src/main.rs` depends on `bun_ast` by path and calls the real `bun_ast::E::String::init_utf16(&[u16; 2])` followed by `slice16()`.

**Expected signal:** Miri reports a Stacked-Borrows/provenance retag failure at the `from_raw_parts(..., len_u16)` call because the `Str` pointer tag was created for only `len_u16` bytes but `slice16()` needs `2 * len_u16` bytes.

**Falsifiability:** if `init_utf16` stores a byte slice whose length is `data.len() * 2`, or if `EString` stores a typed `*const u16` / `Utf16Bytes` representation and `slice16()` no longer expands a narrowed byte slice, close as RESOLVED. If a future source audit proves no `init_utf16` result ever calls `slice16()`, demote exploitability but keep the safe constructor/accessor contract defect until the representation is fixed.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-088
MIRIFLAGS="-Zmiri-symbolic-alignment-check" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-088.log
cd ../EXP-088-bun-ast-crate && \
  CARGO_TARGET_DIR=/tmp/cargo-target/exp-088-bun-ast-crate \
  MIRIFLAGS="-Zmiri-symbolic-alignment-check" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-088-bun-ast-crate.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-088.log` (`trying to retag ... at alloc108[0x2] ... tag does not exist`; the tag was created for offsets `[0x0..0x2]` and `slice16()` requested `[0x0..0x4]`).
- Codex follow-up added `experiments/EXP-088-bun-ast-crate/`, a source-linked
  harness over the real `bun_ast` crate. Raw log:
  `phase5_experiment_results/EXP-088-bun-ast-crate.log`. Miri rejects the retag
  at `/data/projects/bun/src/ast/e.rs:1424`, and identifies that the original
  `init_utf16` call created a tag only for offsets `[0x0..0x2]` while
  `slice16()` requested `[0x0..0x4]`.
- This supersedes the weaker Phase-2 wording that the UTF-16 reinterpret trio "requires misuse of internal API." Even source-shaped `init_utf16(&[u16; 2])` followed by `slice16()` is enough.
- The likely fix is a representation change, not a comment: store `Utf16Bytes { ptr: NonNull<u16>, len_u16 }`, or store a byte slice with byte length `2 * len_u16` plus a separate u16 length field. The current "lying-length" encoding is the load-bearing problem.

---

## EXP-089: `MaybeUninit::uninit().assume_init()` for primitive scratch arrays constructs invalid initialized values

**Finding ref:** Codex uninit-scratch follow-up (2026-05-16); correction to Phase-2 Anti-pattern C.

**Section:** N/L/P shared scratch buffers — `src/bun_core/util.rs:997-1003` (`PathBuffer::uninit`), `src/bun_core/util.rs:1045-1050` (`WPathBuffer::uninit`), `src/install/lockfile/Tree.rs:87-91` (`depth_buf_uninit`).
**Bucket:** 5 (uninitialized memory) + 4 (validity/initialization invariants) + 11 (safe API contract).
**Severity:** CONFIRMED_UB. Construction itself is UB; it is not merely a future read-before-write hazard.

**Hypothesis:** The earlier Phase-2 report treated primitive arrays as "bit-pattern-valid" and therefore allowed `MaybeUninit::uninit().assume_init()` as long as callers never read unwritten bytes. That conflates "all bit patterns are valid" with "uninitialized memory is an initialized value." Rust requires integer elements to be initialized; there is no valid uninitialized `u8`, `u16`, or `u32` value. Therefore constructing `PathBuffer([u8; N])`, `WPathBuffer([u16; N])`, or `DepthBuf([u32; N])` from fresh uninitialized storage is immediate UB even before the caller observes a byte.

**Minimal reproducer:** `experiments/EXP-089/src/main.rs` mirrors all three source shapes with small arrays. The direct Bun-crate witness at `experiments/EXP-089-bun-core-crate/src/main.rs` depends on `bun_core` by path and calls the real `bun_core::PathBuffer::uninit()`.

**Expected signal:** Miri rejects at the `assume_init()` call with an invalid-value error for the first primitive array wrapper.

**Falsifiability:** if the source changes to keep the scratch storage inside `MaybeUninit<[u8; N]>` / `[MaybeUninit<T>; N]`, or reverts to zero-initialized arrays, close as RESOLVED. If only documentation changes while the safe functions still return uninitialized primitive arrays, keep CONFIRMED_UB.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-089
cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-089.log
cd ../EXP-089-bun-core-crate && \
  CARGO_TARGET_DIR=/tmp/cargo-target/exp-089-bun-core-crate \
  cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-089-bun-core-crate.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-089.log` (`constructing invalid value of type PathBuffer: at .0[0], encountered uninitialized memory, but expected an integer`).
- Codex follow-up added `experiments/EXP-089-bun-core-crate/`, a source-linked
  harness over the real `bun_core` crate. Raw log:
  `phase5_experiment_results/EXP-089-bun-core-crate.log`. Miri reports the
  same invalid-value construction at `/data/projects/bun/src/bun_core/util.rs:1003`,
  inside Bun's actual `PathBuffer::uninit()`.
- `src/sql_jsc/shared/CachedStructure.rs:58` remains sound because it constructs `[MaybeUninit<ExternColumnIdentifier>; 70]`, where the element type itself is `MaybeUninit<T>`.
- `src/sys/lib.rs:275-292` `AlignedBuf(MaybeUninit<[u8; BUF_SIZE]>)` remains sound because it stores the uninitialized array inside `MaybeUninit` and only exposes initialized prefixes through `unsafe fn filled(len)`.
- The source comments at the three promoted sites should be replaced, not softened. "Every bit pattern is valid" is not a sufficient justification for `assume_init()` on uninitialized integers.

---

## EXP-090: `h3_client::encode` `Vec<Header>::set_len(4)` prefix-fill probe

**Finding ref:** Codex set-len follow-up (2026-05-16); falsification probe for a tempting Bucket-5 promotion.

**Section:** Q (http-network-stack) — `src/http/h3_client/encode.rs:58-107`.
**Bucket:** 5 (uninitialized memory) + 11 (safe API contract).
**Severity:** NO_EVIDENCE for UB in the current source shape.

**Hypothesis:** `send_headers` reserves `request.headers.len() + 4`, does `headers.set_len(4)`, pushes user headers after the uninitialized prefix, and then fills pseudo-header slots via `headers[0] = ...` through `headers[3] = ...`. This looks suspicious because `Vec::set_len` marks the prefix initialized before values are written.

**Minimal reproducer:** `experiments/EXP-090/src/main.rs` mirrors the exact vector shape with a local `#[repr(C)] Header { raw pointers + integer lengths + qpack index }`, including one pushed user header followed by index assignments to the uninitialized prefix.

**Expected signal:** If index assignment to a no-Drop `Header` slot produced an invalid-value read/drop of the previous slot contents, Miri would report uninitialized memory at the first `headers[0] = ...` assignment or at vector drop.

**Falsifiability:** if `quic::Header` gains `Drop`, a validity-bearing field whose assignment path reads the old slot, or a caller observes the prefix before lines 96-107 initialize it, reopen as a real Bucket-5 finding.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-090
cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-090.log
```

**Verdict:** NO_EVIDENCE

**Notes:**
- Raw log: `phase5_experiment_results/EXP-090.log` (Miri completes cleanly).
- The current source still deserves a style hardening note: `ptr::write(headers.as_mut_ptr().add(i), ...)` or pushing the four pseudo-headers first would make the initialization discipline obvious. But for the current no-Drop `quic::Header` shape, this audit should not count it as UB.

---

## EXP-091: `BindgenArray<Child>::convert_from_extern` can deallocate with a different element alignment

**Finding ref:** F-NF20-3 / Bucket-20 allocator-pairing follow-up; Codex source re-read 2026-05-16.

**Section:** K/T crossover — `src/jsc/bindgen.rs:235-353`; public `Bindgen` / `BindgenArray` / `ExternArrayList` safe API.
**Bucket:** 20 (allocator layout pairing) + 11 (safe API contract) + 6 (type layout conversion).
**Severity:** CONFIRMED_UB for the safe generic API shape; current generated call-site reachability remains a separate source question.

**Hypothesis:** `BindgenArray<Child>::convert_from_extern` is a safe trait method over public `Bindgen` / `ExternArrayList` types. When `Child::ZigType` and `Child::ExternType` have the same size but different alignment, the branch at `bindgen.rs:277-353` can return `Vec<Child::ZigType>` over storage allocated as `Vec<Child::ExternType>`. Dropping that vector calls the Rust allocator with `Layout::array::<Child::ZigType>(cap)`, not the original `Layout::array::<Child::ExternType>(cap)`. Mimalloc may ignore the layout at runtime, but Rust's `Vec::from_raw_parts` contract requires the eventual `Vec<T>` deallocation layout to match the allocation layout: same alignment, and the same total allocated byte size.

**Minimal reproducer:** `experiments/EXP-091/src/main.rs` mirrors the production generic branch with `Extern` size 8 align 8 and `Zig` size 8 align 4. Safe code builds an `ExternArrayList<Extern>` from a `Vec<Extern>`, calls the safe `BindgenArray::<BadChild>::convert_from_extern`, and drops the returned `Vec<Zig>`.

**Expected signal:** Miri rejects vector drop with an incorrect deallocation layout: original allocation align 8, deallocation align 4.

**Falsifiability:** if `BindgenArray` is made private/unreachable from safe code, or the branch reuses storage only when the eventual `Vec<ZigType>` layout exactly matches the original allocation layout (`align_of::<ZigType>() == align_of::<ExternType>()` and `size_of::<ZigType>() * new_capacity == size_of::<ExternType>() * old_capacity`), or carries a raw allocation object that deallocates with the original layout, close as RESOLVED. If generated Bun call sites never instantiate a mismatched `Child`, keep production exploitability lower but do not call the generic safe API sound.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-091
cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-091.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-091.log` (`incorrect layout on deallocation: alloc209 has size 8 and alignment 8, but gave size 8 and alignment 4`).
- This strengthens F-NF20-3 from an `OPEN` allocator-shape hypothesis into a confirmed safe generic API defect. The remediation is not "trust mimalloc"; the Rust `Vec` must be dropped with the same layout used for allocation, or the code must allocate fresh converted storage.
- Source note cross-check: `src/jsc/bindgen.rs:10-18` explicitly relies on "mimalloc's `mi_free` ignores the allocation layout" and pins `bun_alloc::USE_MIMALLOC`. That is not enough for `Vec::from_raw_parts`: the safety contract requires the eventual `Vec<T>` deallocation layout to match the allocation layout, independent of the current allocator's implementation detail.

---

## EXP-092: `ReadResult::to_stream` can adopt a non-owned raw slice as `Vec<u8>`

**Finding ref:** F-NF20-2 / Bucket-20 allocator-pairing follow-up; Codex source re-read 2026-05-16.

**Section:** A/Q crossover — `src/runtime/webcore/streams.rs:2533-2597`; public `ReadResult::Read(*mut [u8])` plus safe `ReadResult::to_stream(...)`.
**Bucket:** 20 (allocator layout/pairing) + 11 (safe API contract) + 1 (raw-pointer ownership/aliasing boundary).
**Severity:** CONFIRMED_UB for the safe API shape; current production producer reachability remains a separate source question.

**Hypothesis:** `ReadResult::Read(*mut [u8])` is a public safe enum variant containing a raw slice pointer, and `ReadResult::to_stream(...)` is a safe method. If the raw slice pointer is disjoint from `buf`, the method treats it as "owned" and returns `StreamResult::Owned(Vec::from_raw_parts(slice_ptr, len, len))`. Safe Rust can construct a raw fat pointer to stack memory or any non-Vec allocation and call this safe method. Dropping the returned `Vec<u8>` then deallocates memory it does not own.

**Minimal reproducer:** `experiments/EXP-092/src/main.rs` mirrors the production branch: create `raw_stack_slice: *mut [u8]` from a stack array, pass a different `buf` to the safe conversion method so `owned == true`, then drop the returned `Vec<u8>`.

**Expected signal:** Miri rejects the vector drop with heap deallocation of stack memory.

**Falsifiability:** if `ReadResult::Read` stops being safe-public, if `to_stream` becomes `unsafe` with an explicit ownership contract, or if the method copies into a fresh `Vec<u8>` unless the producer passes a typed owned-allocation token, close as RESOLVED. If source audit proves all in-tree producers currently pass only default-allocator owned Vec storage, keep production exploitability lower but do not call the safe API sound.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-092
cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-092.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-092.log` (`deallocating alloc111, which is stack variable memory, using Rust heap deallocation operation`).
- This closes the last status-column `OPEN` row in `phase4_unified_findings.md`. The old wording framed F-NF20-2 as a producer-discipline question. That is still relevant for production reachability, but the safe public shape itself is already unsound: raw-pointer construction is safe, and the safe method converts disjointness from `buf` into ownership.
- Preferred fix shape: represent the owned branch as an owned allocation token (`Vec<u8>`, `Box<[u8]>`, or a Bun byte-list wrapper) before entering `ReadResult`, and keep non-owned raw slices in a separate borrowed variant. Pointer inequality must not imply heap ownership.
- Visibility cross-check: `src/runtime/webcore.rs:404` declares `pub mod streams`, and both `ReadResult` and `to_stream` are `pub`. The "safe API shape" claim is therefore not relying on a private helper being abused inside one function.

---

## EXP-093: `bun_exe_format::pe` forms typed PE header references from byte-aligned `Vec<u8>` storage

**Finding ref:** Phase-2 Bucket-3 alignment sweep follow-up; stale `EXP-022` PE-alignment candidate promoted after Codex source re-read 2026-05-16.

**Section:** R (parsers-and-lang) / `bun_exe_format` — `src/exe_format/pe.rs:203-220, 281-302, 315-334, 389-396, 900-920`.
**Bucket:** 3 (alignment) + 10 (raw pointer / typed slice construction) + 11 (safe API contract over hostile bytes).
**Severity:** CONFIRMED_UB for the public `PEFile::init(&[u8])` path under symbolic alignment, plus the hostile/tampered PE offset variant. The direct Bun-crate witness shows `Vec<u8>` storage is not a valid source of typed `&DOSHeader` references by Rust guarantee; the existing mirror witness isolates the later attacker-controlled section-header-offset case.

**Hypothesis:** `view_at_const<T>` / `view_at_mut<T>` are explicitly documented as "unaligned views" and return raw pointers into `&[u8]` / `Vec<u8>` storage, but callers immediately convert those pointers into `&T`, `&mut T`, `&[SectionHeader]`, or `&mut [SectionHeader]`. `PEFile::init` copies hostile bytes into `Vec<u8>` and then materialises `&DOSHeader` at `pe.rs:317`; Miri symbolic alignment correctly treats `Vec<u8>` as only 1-byte-aligned by type guarantee. A PE file also controls `e_lfanew` and `size_of_optional_header`, which determine `pe_header_offset`, `optional_header_offset`, and `section_headers_offset`; the code bounds-checks those offsets but does not check `align_of::<T>()`. Under Rust's reference-validity rules, all of these typed references/slices require alignment the byte buffer does not guarantee.

**Minimal reproducer:** `experiments/EXP-093/src/main.rs` mirrors the `pe.rs:281-290` / `:389-396` shape: allocate a `Vec<u8>`, choose an odd `section_headers_offset`, cast to `*const SectionHeader`, then call `slice::from_raw_parts`. `experiments/EXP-093-bun-exe-format-crate/` is the direct Bun-crate witness: it depends on the real `bun_exe_format` crate, constructs a minimal PE byte buffer, and calls the real `PEFile::init(&data)`.

**Expected signal:** Miri with symbolic alignment checking rejects the mirror typed slice construction: `constructing invalid value of type &[SectionHeader]: encountered an unaligned reference (required 4 byte alignment but found 1)`. The direct Bun-crate witness rejects the earlier public-API typed reference: `constructing invalid value of type &bun_exe_format::pe::DOSHeader: encountered an unaligned reference (required 4 byte alignment but found 1)` at `/data/projects/bun/src/exe_format/pe.rs:317`.

**Falsifiability:** if `pe.rs` switches to `ptr::read_unaligned` / `ptr::write_unaligned`, byte-copy parsing, `#[repr(C, packed)]` plus `addr_of!` field reads, or explicit `offset % align_of::<T>() == 0` validation before every reference creation, close as RESOLVED. If a source audit proves all public entry points can only receive compiler-produced PE files with guaranteed aligned `e_lfanew` and section-header offsets, demote production exploitability, but keep the current hostile-byte safe API shape unsound.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-093
MIRIFLAGS="-Zmiri-symbolic-alignment-check" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-093.log

cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-093-bun-exe-format-crate
MIRIFLAGS="-Zmiri-symbolic-alignment-check" CARGO_TARGET_DIR=/tmp/cargo-target \
  cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-093-bun-exe-format-crate.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-093.log` (`constructing invalid value of type &[SectionHeader]: encountered an unaligned reference (required 4 byte alignment but found 1)`).
- Direct Bun-crate log: `phase5_experiment_results/EXP-093-bun-exe-format-crate.log` calls real `PEFile::init(&data)` and fails at `/data/projects/bun/src/exe_format/pe.rs:317` while materialising `&DOSHeader` from the byte-backed `Vec<u8>`.
- The source already acknowledges the issue: `pe.rs:203-206` says Zig used `*align(1) const T` and Rust references require alignment; `pe.rs:288` and `:300` repeat the TODO for section headers. The old Phase-2 alignment doc promised an `EXP-022` PE witness, but EXP-022..025 were later intentionally left unused after registry renumbering. EXP-093 is the canonical registry entry for this PE-alignment finding.


---

## EXP-094: `bun_core::deprecated::DoublyLinkedList<T>` intrusive list — in-tree Miri SB CONFIRMED_UB (unit-test failure)

**Finding ref:** Surfaced during Phase-11 path-(b) full-workspace `cargo +nightly miri test --workspace --lib --no-fail-fast` on 2026-05-16. **One of the strongest pieces of evidence in this audit — an in-tree unit-test failure under Miri, not a standalone reproducer.**

**Section:** N (bun_core-foundation) — anchored at `src/bun_core/deprecated.rs:114-410+`

**Bucket:** 1 (Aliasing) + 15 (Lifetimes & escape) — intrusive linked-list via raw pointers loses Rust aliasing tags

**Severity:** MUST-BE-UB

**Hypothesis:** `DoublyLinkedList<T>` (`src/bun_core/deprecated.rs:114-118`) stores `*mut DoublyLinkedNode<T>` raw pointers in `first`/`last` fields. The `#[test] fn basic_doubly_linked_list_test` at `src/bun_core/deprecated.rs:369-410` does:
```rust
list.append(&mut two);                       // mints &mut two -> raw -> list.last
list.append(&mut five);                      // mints &mut five -> raw
list.prepend(&mut one);                      // mints &mut one
list.insert_before(&mut five, &mut four);    // RE-mints &mut five (already in list as raw)
list.insert_after(&mut two, &mut three);     // RE-mints &mut two (already in list as raw)
// later: traversal via (*it).next reads through the raw chain
```
The second `&mut five` (and `&mut two`) re-borrows invalidate the prior tags stored in `list.last`/`list.first`. Under Stacked Borrows the traversal `(*it).next` reads with a stale tag that's no longer on the borrow stack — UB.

**Minimal reproducer:** The in-tree unit test is the reproducer:
```bash
cd /data/projects/bun
MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri test \
  -p bun_core --lib basic_doubly_linked_list_test
```

**Expected signal (CONFIRMED 2026-05-16):**
```
test deprecated::tests::basic_doubly_linked_list_test ...
error: Undefined Behavior: attempting a read access using <227806>
       at alloc89302[0x10], but that tag does not exist in the borrow stack
       for this location
```

**Falsifiability:** For the current source, Miri's verdict is decisive. Close as `RESOLVED` if the list is deleted, or if the implementation is redesigned so callers cannot re-mint `&mut node` while the list still stores raw links to that node (for example pinned/list-owned nodes or an intrusive adapter that owns the aliasing discipline). The author's SAFETY comment ("all nodes are stack-locals that outlive the list; intrusive-list invariants upheld by test sequencing") proves only the lifetime/outlives property; it does not prove the aliasing-tag invariant.

**Invocation:**
```bash
cd /data/projects/bun
MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri test \
  -p bun_core --lib basic_doubly_linked_list_test
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase11_artifacts/miri-leaf/cargo_miri_workspace_sp_nofailfast.log` (search for `basic_doubly_linked_list_test`).
- File is named `deprecated.rs` but the test is `#[test]`, the type is `pub struct DoublyLinkedList<T>`, and `pub unsafe fn append/insert_before/insert_after/...` are all `pub` within `bun_core`'s Rust API surface. Removing the test does not fix the underlying API soundness issue for any remaining crate/user that can name the type.
- **Remediation candidates:**
  - A (recommended if a list is still needed): replace `DoublyLinkedList<T>` with `intrusive-collections` crate's `LinkedList<A>` adapter or an equivalent pinned-node intrusive abstraction; same intrusive-list role, but without raw links whose tags go stale under SB/TB.
  - B: rewrite with `NonNull<DoublyLinkedNode<T>>` + `PhantomData<&'a mut DoublyLinkedNode<T>>` and require callers to pin nodes; compile-time aliasing safety but breaks current call sites.
  - C: keep raw pointers but require callers to pass `Box<DoublyLinkedNode<T>>` — list owns the boxes, no live `&mut node` in caller frame.
  - D: deprecate-and-delete (file is already named `deprecated.rs`; verify no remaining production callers, then delete).
- Cross-bucket overlap: F-A-2 (95-site `from_field_ptr!` enumeration) is the same class of intrusive-projection-loses-tag UB.
- **Marketing significance:** In-tree unit-test failure under Miri (not just a standalone reproducer) — gold-standard evidence shape for "Bun has UB Miri catches today." Cite alongside the 5 anchored prior-audit witnesses (EXP-001..005).

---

## EXP-095: `bun_exe_format::macho` mutates load commands through typed references over byte storage

**Finding ref:** Codex Mach-O alignment follow-up (2026-05-16); sibling to EXP-093 after re-reading `macho_types.rs` and `macho.rs`.

**Section:** R (parsers-and-lang) / `bun_exe_format` — `src/exe_format/macho_types.rs:1-12`; `src/exe_format/macho.rs:121-130, 163-170, 361-403`.

**Bucket:** 3 (alignment) + 10 (raw pointer / typed reference construction) + 11 (safe API contract over byte-backed object files).

**Severity:** CONFIRMED_UB for any call path whose Mach-O load-command byte storage is not aligned for the typed command being materialised. Normal Apple toolchain files conventionally use aligned command offsets and common allocators over-align `Vec<u8>` allocations in practice, so production exploitability is input/allocation dependent; the Rust API shape is still unsound because the code explicitly treats the region as byte storage and then forms `&mut T`.

**Hypothesis:** `macho_types.rs:1-12` states that Mach-O on-disk structs should be read/written via unaligned `ptr::{read,write}_unaligned`, exactly like Zig `*align(1) const T` casts. The iterator honors that contract: `LoadCommand::cast<T>()` returns an owned `T` via `read_unaligned`. But `macho.rs` later violates the same contract in mutation paths:

- `macho.rs:121-130` constructs `&mut [macho::section_64]` via `slice::from_raw_parts_mut` from `self.data.as_mut_ptr().add(...).cast::<section_64>()`.
- `macho.rs:366`, `:371`, `:392`, and `:403` cast load-command bytes to `&mut symtab_command`, `&mut dysymtab_command`, `&mut linkedit_data_command`, and `&mut dyld_info_command`.
- `macho.rs:163-170` is the in-file proof that the author knew this region is unaligned-capable: the adjacent segment write uses `ptr::write_unaligned` and says "unaligned, mirroring Zig *align(1)".

Under Rust's reference-validity rules, the `&mut T` / `&mut [T]` materialisation is UB unless the byte pointer is aligned for `T`. The confirmed mutation path is `MachoFile::init(obj_file: &[u8]) -> Vec<u8>` followed by in-place edits of that byte vector; `Vec<u8>` is allocated with an alignment-1 layout, and neither the vector base nor the Mach-O command offsets are validated against `align_of::<T>()`. The separate `MachoSigner::init(obj: &[u8])` path is useful context for public byte-slice entry points, but it is not the confirmed in-place mutation witness.

**Minimal reproducer:** `experiments/EXP-095/src/main.rs` mirrors the source shape: place a `SymtabCommand` at an odd byte offset, read its header with `ptr::read_unaligned` (the sound iterator pattern), then perform the production `&mut *cmd_ptr.cast::<SymtabCommand>()` operation from `macho.rs:366`. `experiments/EXP-095-bun-exe-format-crate/` is the direct Bun-crate witness: it depends on the real `bun_exe_format` crate, constructs a minimal Mach-O image with a `__BUN,__bun` section, calls `MachoFile::init(&data).unwrap().write_section(b"payload")`, and reaches the real section-array mutation path.

**Expected signal:** Miri with symbolic alignment checking rejects the typed mutable reference:

```text
Undefined Behavior: constructing invalid value of type &mut SymtabCommand:
encountered an unaligned reference (required 4 byte alignment but found 1)
```

The direct Bun-crate witness rejects the source path at `macho.rs:122`:

```text
Undefined Behavior: constructing invalid value of type &mut [bun_exe_format::macho_types::section_64]:
encountered an unaligned reference (required 8 byte alignment but found 1)
```

**Falsifiability:** if `macho.rs` switches all load-command/section mutation to by-value `read_unaligned` + `write_unaligned`, byte-copy parsing, or explicit alignment validation before every typed reference/slice creation, close as RESOLVED. If a source audit proves every public entry point copies into an allocation with a guaranteed alignment at least `max(align_of::<segment_command_64>(), align_of::<section_64>(), align_of::<symtab_command>(), ...)` and validates each command offset, demote to hardening. Common allocator behavior is not that proof.

**Invocation:**

```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-095
MIRIFLAGS="-Zmiri-symbolic-alignment-check" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-095.log

cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-095-bun-exe-format-crate
MIRIFLAGS="-Zmiri-symbolic-alignment-check" CARGO_TARGET_DIR=/tmp/cargo-target \
  cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-095-bun-exe-format-crate.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-095.log` (`constructing invalid value of type &mut SymtabCommand: encountered an unaligned reference (required 4 byte alignment but found 1)`).
- Direct Bun-crate log: `phase5_experiment_results/EXP-095-bun-exe-format-crate.log` calls real `MachoFile::write_section` and fails at `/data/projects/bun/src/exe_format/macho.rs:122` while materialising `&mut [section_64]` over the byte-backed load-command region.
- This is not a criticism of `LoadCommand::cast<T>()`; that helper is the good pattern because it uses `read_unaligned` and returns a value. The bug is the later in-place mutation path that converts the same byte region to typed references.
- Source-faithfulness nuance: compiler-produced 64-bit Mach-O load commands are normally 8-byte aligned, so the strongest current claim is hostile/tampered-byte UB, not "every ordinary Mach-O produced by clang is misaligned." The current `LoadCommandIterator` (`src/sys/lib.rs:5852-5878`) reads each header with `read_unaligned` and checks only `cmdsize >= sizeof(load_command)` and `cmdsize <= remaining_len`; it does **not** validate that `cmdsize` keeps the next command offset aligned. A malformed first command with an odd-but-in-bounds `cmdsize` can place the following `LC_SYMTAB` / `LC_DYSYMTAB` / linkedit command at the odd offset used by the witness, after which `macho.rs:366,371,392,403` materialise typed mutable references.
- The optimal fix is the same family as EXP-093: centralize `read_unaligned` / `write_unaligned` helpers for Mach-O load-command edits, mutate owned local copies, and write them back by value. For section arrays, either iterate element-by-element with unaligned reads/writes or copy into an aligned temporary `Vec<section_64>` before mutation.

---

## EXP-096: `bun_core::SmolStr` packs heap pointer bits into `u128` and reconstructs a raw pointer

**Finding ref:** Codex primitive-gap sweep (2026-05-16) over high-risk pointer/validity primitives after Phase 7 convergence; distinct from EXP-049 despite the earlier artifact wording using the `SmolStr` name.

**Section:** N (bun_core-foundation) — `src/bun_core/string/SmolStr.rs:56-91, 115-124, 156-164, 186-189, 218-222, 234-245`.

**Bucket:** 2 (Provenance) + 4 (Validity) + 20 (allocator pairing through recovered pointer).

**Severity:** DEFERRED strict-provenance release-gate failure. Do not count as default-Miri/runtime UB unless Bun adopts strict provenance as a release gate, or unless a later source audit proves a non-provenance validity/allocator bug in the same type.

**Hypothesis:** `SmolStr` is a separate packed-pointer representation from EXP-049. It stores heap strings as `u128` fields: low 32 bits `len`, next 32 bits `cap`, upper 64 bits raw pointer bits plus an inline-string tag (`SmolStr.rs:13-18`). `from_baby_list` writes `baby_list.as_mut_ptr() as usize` into those upper bits (`:120-124`). Later `ptr_const()` and `ptr()` recover the pointer with `(self.raw_ptr_bits() & NEGATED_TAG) as *const/*mut u8` (`:86-91`). Under `-Zmiri-strict-provenance`, the recovered pointer has no allocation provenance. The actual deref/use sites are `slice()` (`:156-164`), `append_char()` (`:186-189`), `append_slice()` (`:218-222`), and `Drop` (`:234-245`).

**Minimal reproducer:** `experiments/EXP-096/src/main.rs` mirrors the production representation exactly enough for the strict-provenance signal: store `Vec<u8>::as_mut_ptr() as usize` in the upper 64 bits of a `u128`, recover it with `(raw_ptr_bits & NEGATED_TAG) as *const u8`, then build a slice from it.

**Expected signal (CONFIRMED 2026-05-16 under strict provenance):**
```text
error: unsupported operation: integer-to-pointer casts and `ptr::with_exposed_provenance` are not supported with `-Zmiri-strict-provenance`
  --> src/main.rs:31:9
   |
31 |         (self.raw_ptr_bits() & NEGATED_TAG) as *const u8
```

**Falsifiability:** if current source stops storing heap pointers as integer bits (for example by carrying `NonNull<u8>` / `NonNull<[u8]>` in the heap representation), or if Rust's strict-provenance model explicitly blesses this exact exposed-address round trip as preserving allocation provenance, close or reclassify. If only the central `TaggedPtr` helper changes, keep EXP-096 open/deferred because `SmolStr` does not route through that helper.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-096
MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run 2>&1 | tee ../../phase5_experiment_results/EXP-096.log
```

**Verdict:** DEFERRED (strict-provenance release-gate failure; not default-Miri/runtime UB; recheck when Bun adopts strict provenance as a gate)

**Notes:**
- Raw log: `phase5_experiment_results/EXP-096.log`.
- This is **not** the same finding as EXP-049. EXP-049 is `StringOrTinyString` at `src/bun_core/string/immutable.rs:1076`, which reconstructs a pointer from bytes via `usize::from_le_bytes`. EXP-096 is the exported `bun_core::SmolStr` type in `src/bun_core/string/SmolStr.rs`, used by `shell_parser/braces.rs`.
- Remediation is representation work: store a typed `NonNull<u8>`/`NonNull<[u8]>` plus length/capacity/tag metadata, or split inline and heap variants into an enum whose heap variant carries the typed pointer. A helper-only `TaggedPtr` fix does not close this site.

---

## EXP-097: safe errno `from_raw` helpers transmute unchecked sparse enum discriminants

**Finding ref:** Codex syn-walker Round 83 transmute-pairs triage (2026-05-16); correction to the earlier Bucket-6 wording that treated `E::from_raw` / `SystemErrno::from_raw` as caller-contract sites.

**Section:** P (sys-io-event-loop-threading) / errno — `src/errno/windows_errno.rs:248-255` (`E::from_raw`) and `src/errno/lib.rs:303-310` (`SystemErrno::from_raw`).

**Bucket:** 4 (validity) + 6 (type punning) + 11 (safe API exposes unsafe contract).

**Severity:** CONFIRMED_UB safe-API contract defect. Production reachability is separate from the type-level contract: the important point is that safe Rust can call these `pub const fn`s with an invalid discriminant, and the function bodies then construct invalid enum values.

**Hypothesis:** The errno `from_raw` helpers are safe public functions but contain unchecked `core::mem::transmute::<u16, E/SystemErrno>(n)`. The comments say the caller guarantees `n` is a declared discriminant, but safe Rust functions cannot impose a UB precondition on callers. `windows_errno::E` is sparse (`0..=137` plus isolated UV-tail discriminants), and `SystemErrno` is also sparse on Windows. `E::from_raw` has only a `debug_assert!(from_repr(n).is_some())`; release builds compile that check out. `SystemErrno::from_raw` has no Windows validity check at all.

**Minimal reproducer:**
- `experiments/EXP-097/src/main.rs` mirrors the source shape with a sparse `#[repr(u16)]` enum and a safe `pub const fn from_raw(n: u16) -> Self` that debug-asserts validity, then transmutes. Running under `cargo +nightly miri run --release` disables debug assertions and exercises the safe invalid input.
- `experiments/EXP-097-bun-errno-crate/` is the direct Bun-crate witness for the non-Windows `SystemErrno::from_raw` half of the finding. It depends on `bun_errno` by path and calls `bun_errno::SystemErrno::from_raw(138)` from safe Rust.

**Expected signal (CONFIRMED 2026-05-16):**
```text
error: Undefined Behavior: constructing invalid value of type SparseErrno:
at .<enum-tag>, encountered 0x008a, but expected a valid enum tag
  --> src/main.rs:25:18
```

**Falsifiability:** close as RESOLVED if `from_raw` is made `unsafe`, removed, or routed through a checked `from_repr(n).expect(...)` / `try_from_raw(n)` path that cannot create invalid enum values from safe code. A debug-only assertion is not sufficient because the witness is release-mode.

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-097
cargo +nightly miri run --release 2>&1 | tee ../../phase5_experiment_results/EXP-097.log

cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-097-bun-errno-crate
CARGO_TARGET_DIR=/tmp/cargo-target/exp-097-bun-errno-crate \
  MIRIFLAGS="-Zmiri-strict-provenance" \
  cargo +nightly miri run --release \
  2>&1 | tee ../../phase5_experiment_results/EXP-097-bun-errno-crate.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-097.log`.
- Direct Bun-crate raw log: `phase5_experiment_results/EXP-097-bun-errno-crate.log`; Miri reports the invalid enum tag at `/data/projects/bun/src/errno/lib.rs:310`, inside Bun's actual `SystemErrno::from_raw`.
- This is distinct from EXP-002. EXP-002 is the Linux `impl GetErrno for usize` call path that reaches an invalid errno transmute from a raw syscall-style return. EXP-097 is the safe `from_raw` API family itself.
- Remediation should land with the EXP-002 fix: delete unchecked transmute bodies in errno `from_raw` helpers and use the existing checked `strum::FromRepr` / `try_from_raw` machinery.

---

## EXP-098: `AtomicCell<T: Copy>` unbounded `Send`/`Sync` lets safe code move `&Cell<T>` across threads

**Finding ref:** Correction to Phase-2 F-DR-7 / F-S-4 and Phase-4 row `src/bun_core/atomic_cell.rs:65-66`.

**Section:** N (bun_core-foundation) — `src/bun_core/atomic_cell.rs:50-83`.

**Bucket:** 7 (data races) + 8 (Send/Sync invariants) + 11 (safe API exposes unsafe contract).

**Severity:** CONFIRMED_UB generic safe-API contract defect. Current in-tree production instantiations still appear to use atomically-valid payloads; the bug is that the public safe type admits a `Copy + !Send/!Sync + !Atom` payload and then launders it across threads.

**Hypothesis:** `AtomicCell<T>` has `unsafe impl<T: Copy> Sync` and `unsafe impl<T: Copy> Send`, but only the atomic operation block requires `T: Atom`. The safe constructor and extractor (`AtomicCell::new(value)` and `AtomicCell::into_inner(self)`) require only `T: Copy`. Therefore a safe caller can construct `AtomicCell<&Cell<u32>>`, move that wrapper to another scoped thread because `AtomicCell<&Cell<u32>>: Send`, call `into_inner()` there, and mutate the same `Cell` concurrently with the original thread. This violates Rust's data-race rule without any unsafe code at the call site.

**Minimal reproducer:** `experiments/EXP-098-bun-core-crate/` depends on the real `bun_core` crate and uses the actual `bun_core::AtomicCell`:

```rust
use std::cell::Cell;

fn main() {
    let cell = Cell::new(0_u32);
    let wrapper = bun_core::AtomicCell::new(&cell);

    std::thread::scope(|scope| {
        scope.spawn(move || {
            let remote_ref = wrapper.into_inner();
            for _ in 0..1024 {
                remote_ref.set(remote_ref.get().wrapping_add(1));
            }
        });

        for _ in 0..1024 {
            cell.set(cell.get().wrapping_add(1));
        }
    });
}
```

**Expected signal (CONFIRMED 2026-05-16):**

```text
error: Undefined Behavior: Data race detected between (1) non-atomic write on thread `main`
and (2) non-atomic read on thread `unnamed-1` at alloc109
   --> .../core/src/cell.rs:555:18
```

**Falsifiability:** close if `AtomicCell` is changed so the auto-trait impls and/or the safe constructor/extractor cannot transport `T: Copy + !Send/!Sync` across threads. A future source audit may also prove every public constructor is crate-private or otherwise unreachable to safe external callers, but current `bun_core::AtomicCell` is `pub use`d from `bun_core::lib.rs:21`.

**Invocation:**

```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-098-bun-core-crate
CARGO_TARGET_DIR=/tmp/cargo-target cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-098-bun-core-crate-default.log

CARGO_TARGET_DIR=/tmp/cargo-target MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-098-bun-core-crate.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw logs: `phase5_experiment_results/EXP-098-bun-core-crate-default.log` and `phase5_experiment_results/EXP-098-bun-core-crate.log`.
- This supersedes the earlier "CONTRACTUAL-BUT-DEFENSIBLE" wording for F-DR-7 / F-S-4. The earlier mitigation argument was incomplete: method gating on `T: Atom` does not protect `new()` + `into_inner()`.
- W4 drift check (2026-05-16): latest fetched `origin/main@e750984db6` still has the same `unsafe impl<T: Copy> Sync/Send for AtomicCell<T>` and `new()` / `into_inner()` signatures at `src/bun_core/atomic_cell.rs:50-83`; `git diff --name-only 4d443e5402..origin/main -- src/bun_core/atomic_cell.rs` is empty.
- Remediation should tighten the safe abstraction, not merely the docs. Preferred: make the unsafe auto-trait impls require `T: Atom` (or at least `T: Send` / `T: Sync` in the same direction as the wrapper's own auto trait) and prevent `AtomicCell<T: Copy + !Atom>` from becoming a Send wrapper. If the type must remain constructible for non-Atom payloads, split that storage into a non-Send/non-Sync wrapper.

---

## EXP-099: `InternalMsgHolder::flush(&mut self)` re-enters `child_singleton()` while the receiver borrow is live

**Finding ref:** Codex RacyCell/singleton safe-boundary sweep (2026-05-16).

**Section:** D/F/K boundary (node cluster IPC + JSC IPC) — `src/runtime/node/node_cluster_binding.rs:35-51`, `:147-151`, `:155-158`; `src/jsc/ipc.rs:140-159`.

**Bucket:** 1 (aliasing / Tree-Borrows re-entrant `&mut`) + 15 (caller-chosen lifetime) + 21 (JSC callback re-entry).

**Severity:** CONFIRMED_UB shape, with source comments acknowledging the exact hazard. Production exploitability depends on whether the JS IPC listener can synchronously re-enter `child_singleton()` while `flush()` is processing queued child messages; the safe Rust boundary is still unsound because the helper and receiver create overlapping `&mut InternalMsgHolder` handles without an `unsafe` caller boundary.

**Hypothesis:** `node_cluster_binding::child_singleton<'a>() -> &'a mut InternalMsgHolder` returns a caller-chosen mutable reference from `static CHILD_SINGLETON: RacyCell<Option<InternalMsgHolder>>`. `on_internal_message_child()` stores `let singleton = child_singleton();` and then calls `singleton.flush(global)?`. Inside `InternalMsgHolder::flush(&mut self)`, the source comment explicitly says `&mut self` carries `noalias`, `dispatch_unsafe` runs a JS callback, and that callback can re-enter via a fresh `&mut Self`. The body launders `self` through `black_box(ptr::from_mut(self))`, but Tree Borrows still treats the `&mut self` receiver as a protected live unique borrow for the duration of the call. A re-entrant `child_singleton()` creates a foreign mutable reborrow of the same static allocation, disabling the protected receiver tag.

**Minimal reproducer:** `experiments/EXP-099/` mirrors the exact source shape:

- `static CHILD_SINGLETON: RacyCellShape<Option<InternalMsgHolderShape>>`.
- safe `child_singleton<'a>() -> &'a mut InternalMsgHolderShape`.
- `InternalMsgHolderShape::flush(&mut self)` uses `black_box(ptr::from_mut(self))`, `mem::take(&mut (*this).messages)`, then calls `unsafe { &mut *this }.dispatch_unsafe(...)`.
- `dispatch_unsafe` calls `reenter_via_global_owner()`, which calls `child_singleton()` again.

**Expected signal (CONFIRMED 2026-05-16):**

```text
error: Undefined Behavior: reborrow through <598> at alloc4[0x0] is forbidden
  --> src/main.rs:27:9
   |
27 |         (*CHILD_SINGLETON.get()).get_or_insert_with(InternalMsgHolderShape::default)
   |         ^^^^^^^^^^^^^^^^^^^^^^^^ Undefined Behavior occurred here
   = help: the protected tag <465> was created here
  --> src/main.rs:45:14
   |
45 |     fn flush(&mut self) {
   |              ^^^^^^^^^
   = help: the protected tag <465> later transitioned to Unique due to a child write access
  --> src/main.rs:47:24
   |
47 |         let messages = core::mem::take(unsafe { &mut (*this).messages });
```

**Falsifiability:** close as RESOLVED if `flush` no longer has an `&mut self` receiver on paths that run JS callbacks (for example `flush(this: *mut Self, global)` plus statement-scoped reborrows), or if `child_singleton` stops returning `&mut` and instead returns a raw/guard/closure-scoped owner that cannot be called twice safely. Demote production exploitability if a call-graph proof shows no JS callback invoked from `dispatch_unsafe` can reach `send_helper_child`, `on_internal_message_child`, or `handle_internal_message_child`, but do not demote the safe-contract finding while the two-call witness compiles.

**Invocation:**

```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-099
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-099.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- This is intentionally separate from the corrected EXP-047 `RacyCell` hardening note. EXP-047 was demoted because `RacyCell::get()` by itself exposes only raw pointers to safe callers. EXP-099 is stronger: Bun's own safe helper immediately turns the raw pointer into `&mut InternalMsgHolder`, and `flush(&mut self)` calls a re-entrant callback while that receiver borrow remains live.
- This is also separate from EXP-057's broad `&self -> &mut` cluster. EXP-099 has no receiver on `child_singleton()` and has a concrete source-acknowledged re-entry edge in `jsc/ipc.rs:142-149`.

---

## EXP-100: `UpgradedDuplex::{close,shutdown,flush}` hold `&mut SSLWrapper` across SSLWrapper callback re-entry

**Finding ref:** Codex R-2 / callback-receiver sweep, 2026-05-16.
**Section:** E / Q (runtime socket + HTTP proxy/tunnel) — `src/runtime/socket/UpgradedDuplex.rs:27-44,101-146,202-216,304-390,587-599`; source-facing opaque shims at `src/uws_sys/lib.rs:191-201`; contrast-safe pattern in `src/http/ProxyTunnel.rs:97-180,222-230,684-704,752-763`.
**Bucket:** 1 (Aliasing) + 21 (FFI / callback re-entry) + 15 (lifetime/protector escape).
**Severity:** MUST-BE-UB.
**Hypothesis:** `UpgradedDuplex` stores `wrapper: Option<SSLWrapper<*mut UpgradedDuplex>>`. Its public callback exports `flush(&mut self)`, `close(&mut self)`, `shutdown(&mut self)`, `encode_and_write(&mut self)`, and `on_internal_receive_data(&mut self)` borrow `&mut self.wrapper` and call `SSLWrapper::{flush,shutdown,write_data,receive_data,start}`. `SSLWrapper` synchronously calls the handler table with `ctx: *mut UpgradedDuplex`; the callbacks immediately materialize `&mut UpgradedDuplex` (`on_open`, `on_data`, `on_handshake`, `on_close`, `internal_write`) and `on_close` eventually runs `teardown()`, which writes `self.wrapper = None`. That overlaps the still-live `&mut self` / `&mut self.wrapper` receiver borrow from the exported method. The nearby `ProxyTunnel` code explicitly avoids this by projecting only disjoint fields with `addr_of!` / `addr_of_mut!`; `UpgradedDuplex` does not.

**Minimal reproducer:** `experiments/EXP-100/` mirrors the source shape:

```rust
struct UpgradedDuplex { wrapper: Option<Wrapper>, closed: bool }
impl UpgradedDuplex {
    fn close(&mut self) {
        if let Some(wrapper) = &mut self.wrapper {
            wrapper.shutdown();
        }
    }
    fn on_close(this: *mut Self) {
        let this = unsafe { &mut *this };
        this.closed = true;
        this.wrapper = None;
    }
}
```

**Expected signal:** Tree-Borrows Miri rejects the callback write through the re-entered `&mut UpgradedDuplex` while `close(&mut self)`'s protected tag is live.

**Falsifiability:** close as `RESOLVED` if current source is changed to the `ProxyTunnel` pattern: exported methods pass a raw owner / `NonNull<Self>` into the callback-capable operation without first holding a whole-struct `&mut self` or `&mut self.wrapper` borrow across the call, and callbacks only project disjoint fields through raw-pointer accessors. Demote if source audit proves `SSLWrapper::{flush,shutdown,write_data,receive_data,start}` cannot synchronously invoke any `UpgradedDuplex` handler in the audited build.

**Invocation:**

```sh
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-100
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-100.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw log: `phase5_experiment_results/EXP-100.log`.
- The witness was corrected to avoid a setup artifact: it initializes the wrapper through the raw owner before calling `close(&mut self)`, so the Miri failure is the callback reborrow / write itself, not stale setup provenance.
- `src/http/ProxyTunnel.rs` is the remediation template already present in the tree: do not materialize whole-struct `&mut ProxyTunnel` inside SSLWrapper callbacks; use raw owner pointer + disjoint-field accessors or a raw-owner close path.
- This belongs with EXP-026 and EXP-099 in the callback-running receiver cleanup: methods that can synchronously dispatch JS / SSLWrapper callbacks should not expose `&mut self` receivers spanning those calls.
- The source already contains the correct conceptual fix direction: "re-reads through an opaque pointer" is the right instinct, but the receiver signature must also stop creating a live protected `&mut self` tag before callback re-entry. The timer fix model from EXP-026 applies directly: raw owner parameter plus short scoped `&mut` reborrows only between callbacks.

---

## EXP-101: `ProxyTunnel::shutdown(&mut self)` still uses the pre-fix receiver shape

**Finding ref:** Codex follow-up while validating EXP-100's `ProxyTunnel` contrast model, 2026-05-16.
**Section:** Q (http-network-stack) — bad leftover at `src/http/ProxyTunnel.rs:707-711`; live call sites at `src/http/lib.rs:1347-1355` and `src/http/HTTPContext.rs:692-700`; in-tree good model at `src/http/ProxyTunnel.rs:165-180,684-704,714-763`.
**Bucket:** 1 (Aliasing) + 21 (FFI / callback re-entry) + 15 (receiver lifetime/protector escape).
**Severity:** MUST-BE-UB.
**Hypothesis:** The EXP-100 review correctly identified `ProxyTunnel` as containing the desired raw-owner/disjoint-field fix model, but not every `ProxyTunnel` method has been migrated to it. `ProxyTunnel::shutdown(&mut self)` still borrows `&mut self.wrapper` and calls `wrapper.shutdown(true)` while the whole-struct `&mut ProxyTunnel` receiver remains protected for the duration of the function. `SSLWrapper::shutdown` synchronously invokes the ProxyTunnel callbacks; those callbacks intentionally avoid `&mut ProxyTunnel` and use raw disjoint-field projections (`socket_of`, `write_buffer_of`, `shutdown_err_of`, `ref_scope`), but those field accesses are still inside the same allocation protected by the live receiver tag. The adjacent `close_raw(this: NonNull<Self>)` path is the correct version because it never creates a whole-struct `&mut ProxyTunnel` before entering `SSLWrapper`.

**Minimal reproducer:** `experiments/EXP-101/` has two paths over the same source-shaped model:

```rust
fn shutdown(&mut self) {
    if let Some(wrapper) = &mut self.wrapper {
        wrapper.shutdown();
    }
}

fn close_raw(this: *mut Self) {
    if let Some(wrapper) = Self::wrapper_mut(this) {
        wrapper.shutdown();
    }
}
```

The callback writes only through raw disjoint-field accessors, mirroring ProxyTunnel's callback discipline.

**Expected signal:** Tree-Borrows Miri rejects the bad `shutdown(&mut self)` path because callback raw-field writes are foreign to the protected receiver tag. The `--good` raw-owner path should complete cleanly.

**Falsifiability:** close as `RESOLVED` if `ProxyTunnel::shutdown(&mut self)` is deleted or changed to a raw-owner entry point and all live call sites (`close_proxy_tunnel`, `HTTPContext::close_socket`, and any future tunnel shutdown call) route through `close_raw` / `shutdown_raw` without holding a whole-struct `&mut ProxyTunnel` across `SSLWrapper::shutdown`. Demote if source audit proves `wrapper.shutdown(true)` from this method cannot synchronously invoke any ProxyTunnel callback in the audited build.

**Invocation:**

```sh
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-101
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-101.log
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run -- --good \
  2>&1 | tee ../../phase5_experiment_results/EXP-101-good.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- Raw bad-path log: `phase5_experiment_results/EXP-101.log` (`protected tag ... was created at fn shutdown(&mut self)`; callback write through `Cell::set` is forbidden).
- Raw good-path log: `phase5_experiment_results/EXP-101-good.log` (clean).
- This is not a contradiction of EXP-100's remediation advice. It sharpens it: `ProxyTunnel` contains the right pattern, and EXP-101 proves the remaining `shutdown(&mut self)` method must also be migrated to that pattern before ProxyTunnel can be cited as fully cleaned up.

---

## EXP-102: `ProxyTunnel::write(&mut self)` live request-body path still enters `SSLWrapper::write_data` under a protected receiver

**Finding ref:** Codex 2026-05-16 ProxyTunnel follow-up after EXP-101; live request-body write path
**Section:** Q (http-network-stack) — `src/http/ProxyTunnel.rs:768-775`; live callers at `src/http/lib.rs:2876-2888` and `src/http/lib.rs:2913-2947`
**Bucket:** 1 (Aliasing) + 15 (Lifetimes / escaping borrows) + 21 (FFI callback aliasing)
**Severity:** MUST-BE-UB
**Hypothesis:** `ProxyTunnel::write(&mut self, buf)` still borrows `&mut self.wrapper` directly and calls `wrapper.write_data(buf)`. `SSLWrapper::write_data` calls `handle_traffic()` on empty / WANT_READ / WANT_WRITE / success / error paths and can synchronously invoke `handlers.write`, `handlers.on_data`, `handlers.on_handshake`, or `handlers.on_close`. ProxyTunnel's handlers correctly avoid whole-struct `&mut ProxyTunnel` and use disjoint raw field accessors, but those writes still occur inside the same allocation protected by `write(&mut self)`'s live receiver tag. The same callback is used by live request-body paths in `HTTPClient::on_writable` for `RequestStage::ProxyBody` and `RequestStage::ProxyHeaders`.

**Minimal reproducer:** `experiments/EXP-102/` has two paths over the same source-shaped model:

```rust
fn write(&mut self, data: &[u8]) {
    if let Some(wrapper) = &mut self.wrapper {
        wrapper.write_data(data); // callback raw-writes write_buffer/socket/ref_count
    }
}

fn write_raw(this: *mut Self, data: &[u8]) {
    if let Some(wrapper) = Self::wrapper_mut(this) {
        wrapper.write_data(data);
    }
}
```

**Expected signal:** `MIRIFLAGS="-Zmiri-tree-borrows"` rejects the bad path with a protected tag created at `fn write(&mut self, ...)`, while the `--good` raw-owner path runs clean.

**Falsifiability:** close as `RESOLVED` if `ProxyTunnel::write(&mut self, ...)` is deleted or changed to a raw-owner entry point and both live callers route through that raw-owner path without holding a whole-struct `&mut ProxyTunnel` across `SSLWrapper::write_data`. Demote if source audit proves `SSLWrapper::write_data` cannot synchronously invoke any ProxyTunnel handler for these call paths in the audited build.

**Invocation:**

```sh
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-102
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-102.log
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run -- --good \
  2>&1 | tee ../../phase5_experiment_results/EXP-102-good.log
```

**Verdict:** CONFIRMED_UB (Tree-Borrows model)

**Notes:**
- Raw bad-path log: `phase5_experiment_results/EXP-102.log` (`protected tag ... was created at fn write(&mut self, data: &[u8])`; callback write through `Vec::extend_from_slice` is forbidden).
- Raw good-path log: `phase5_experiment_results/EXP-102-good.log` (clean).
- This is not a speculative sibling of EXP-101. The source itself states `write_encrypted` is fired from inside `SSLWrapper::flush/handle_traffic` and that the caller holds `&mut SSLWrapper` (`src/http/ProxyTunnel.rs:483-497`). `SSLWrapper::write_data` calls `handle_traffic()` at `src/uws/lib.rs:749-785`.

---

## EXP-103: `ProxyTunnel::on_writable(&mut self)` and `receive(&mut self)` raw-capture-first wrappers still carry a protected receiver

**Finding ref:** Codex 2026-05-16 ProxyTunnel follow-up after EXP-102; live `on_writable` / `on_data` tunnel paths
**Section:** Q (http-network-stack) — `src/http/ProxyTunnel.rs:714-749` and `src/http/ProxyTunnel.rs:752-765`; live callers at `src/http/lib.rs:2754-2755` and `src/http/lib.rs:3254-3258`
**Bucket:** 1 (Aliasing) + 15 (Lifetimes / escaping borrows) + 21 (FFI callback aliasing)
**Severity:** MUST-BE-UB
**Hypothesis:** `ProxyTunnel::on_writable(&mut self)` and `ProxyTunnel::receive(&mut self, buf)` try to avoid Stacked-Borrows trouble by capturing `NonNull::from(&mut *self)` first and then using raw field accessors. That is directionally right, but insufficient under Tree Borrows: the function still entered with a protected whole-struct `&mut self` receiver. `on_writable` writes `write_buffer`, then calls `SSLWrapper::flush`; `receive` calls `SSLWrapper::receive_data`. Both SSLWrapper paths can synchronously re-enter ProxyTunnel callbacks that write `write_buffer` / close state through raw disjoint-field accessors while the receiver protector remains live.

**Minimal reproducer:** `experiments/EXP-103/` has four modes over one source-shaped model:

```rust
fn on_writable(&mut self) {
    let this = NonNull::from(&mut *self);
    let _guard = RefScope::new(this);
    Tunnel::write_buffer_of(this).extend_from_slice(b"socket-drain");
    Tunnel::wrapper_mut(this).unwrap().flush(); // callback raw-writes write_buffer/closed
}

fn receive(&mut self, data: &[u8]) {
    let this = NonNull::from(&mut *self);
    let _guard = RefScope::new(this);
    Tunnel::wrapper_mut(this).unwrap().receive_data(data); // callback raw-writes
}

fn on_writable_raw(this: NonNull<Self>) { /* same field accesses, no receiver */ }
fn receive_raw(this: NonNull<Self>, data: &[u8]) { /* same field accesses, no receiver */ }
```

**Expected signal:** Tree-Borrows Miri rejects the two receiver-entry modes while both raw-owner controls run clean. The model uses `-Zmiri-ignore-leaks` so the raw-owner control is not polluted by end-of-program deallocation mechanics.

**Falsifiability:** close as `RESOLVED` if both `on_writable(&mut self)` and `receive(&mut self, ...)` are deleted/privatized or changed to raw-owner entry points and all live call sites route through those raw-owner paths. Demote if source audit proves `SSLWrapper::flush` and `SSLWrapper::receive_data` cannot synchronously invoke ProxyTunnel callbacks in these live audited call paths.

**Invocation:**

```sh
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-103
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-ignore-leaks" cargo +nightly miri run -- on-writable-bad \
  2>&1 | tee ../../phase5_experiment_results/EXP-103-on-writable.log
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-ignore-leaks" cargo +nightly miri run -- receive-bad \
  2>&1 | tee ../../phase5_experiment_results/EXP-103-receive.log
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-ignore-leaks" cargo +nightly miri run -- on-writable-good \
  2>&1 | tee ../../phase5_experiment_results/EXP-103-on-writable-good.log
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-ignore-leaks" cargo +nightly miri run -- receive-good \
  2>&1 | tee ../../phase5_experiment_results/EXP-103-receive-good.log
```

**Verdict:** CONFIRMED_UB (Tree-Borrows model)

**Notes:**
- `EXP-103-on-writable.log` fails at `write_buffer_of` during the re-entrant `write_encrypted` path after the receiver-created protected tag has gone `Unique`.
- `EXP-103-receive.log` fails during callback `Vec::extend_from_slice`; Miri reports the protected tag was created at `fn receive(&mut self, buf: &[u8])`.
- `EXP-103-on-writable-good.log` and `EXP-103-receive-good.log` run clean with the same field writes when the entry path is raw-owner.
- This corrects the in-source comment at `ProxyTunnel.rs:716-720`: capturing the raw pointer first and never using `self` again is not enough when the call frame itself still has a protected `&mut self` receiver.

---

## EXP-104: `WindowsNamedPipe` `WRAPPER_BUSY` guards prevent wrapper drop but not receiver-protector aliasing

**Finding ref:** Codex 2026-05-16 follow-up after EXP-100..103; Section E/P Windows named-pipe SSLWrapper surface.
**Section:** E/P (runtime socket + sys/event-loop) — `src/runtime/socket/WindowsNamedPipe.rs:261-315, 394-407, 554-610, 1038-1052, 1127-1152, 1166-1238`; generated receiver thunk in `src/jsc_macros/lib.rs:828-843`.
**Bucket:** 1 (Aliasing) + 15 (Lifetimes / protected receiver escape) + 21 (FFI callback aliasing)
**Severity:** MUST-BE-UB (Windows-only runtime surface; Tree-Borrows model)
**Hypothesis:** `WindowsNamedPipe` correctly recognized the SSLWrapper re-entry hazard and added a `WRAPPER_BUSY` flag so `release_resources()` does not drop `self.wrapper` while `SSLWrapper::{start,flush,receive_data,write_data,shutdown}` is still executing. That is necessary for UAF prevention, but it is not sufficient for Rust aliasing. The exported `#[bun_uws::uws_callback]` methods have `&mut self` receivers; the macro expands those receivers by creating `&mut *__ctx.cast::<Self>()` (`src/jsc_macros/lib.rs:839-843`). The internal `on_read`, `on_internal_receive_data`, and `start_tls` paths are not generated exports, but they are the same relevant shape: a whole-struct `&mut self` entry point drives `SSLWrapper` while callback trampolines can materialize fresh whole-struct `&mut WindowsNamedPipe` at `src/runtime/socket/WindowsNamedPipe.rs:394-407`. The source comments at `WindowsNamedPipe.rs:268-307` and `:554-605` describe the inner-wrapper and UAF part of the invariant, but they do not eliminate the outer receiver protector.

**Minimal reproducer:** `experiments/EXP-104/` mirrors the WindowsNamedPipe shape:

```rust
fn flush_bad(&mut self) {
    if let Some(w) = self.wrapper_ptr() {
        self.wrapper_busy = true;
        unsafe { (*w).flush() }; // callback calls ssl_write(ctx)
        self.wrapper_busy = false;
    }
}

fn ssl_write(this: *mut Self, data: &[u8]) {
    let this = unsafe { &mut *this }; // fresh whole-struct receiver
    this.writer.extend_from_slice(data);
}
```

The same harness also models a `receive_bad(&mut self, data)` path where `WRAPPER_BUSY` correctly defers wrapper teardown while `ssl_on_close(ctx)` still tries to materialize `&mut Self`.

**Expected signal:** Tree-Borrows Miri rejects the receiver-entry modes with a protected tag created at `fn flush_bad(&mut self)` / `fn receive_bad(&mut self, ...)`. Raw-owner controls (`flush_good(NonNull<Self>)`, `receive_good(NonNull<Self>, ...)`) run clean with the same callback writes and the same `WRAPPER_BUSY` deferral logic.

**Falsifiability:** close as `RESOLVED` if `WindowsNamedPipe`'s callback-driving methods are changed so exported C ABI thunks and internal callback entry points no longer hold a whole-struct `&mut Self` while entering `SSLWrapper` (for example raw-owner exports, raw-owner internal helpers, or a macro mode equivalent to EXP-012 / WebSocketProxyTunnel). Demote only if source audit proves `SSLWrapper::{start,flush,receive_data,write_data,shutdown}` cannot synchronously invoke any WindowsNamedPipe handler in the audited Windows runtime.

**Invocation:**

```sh
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-104
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-ignore-leaks" cargo +nightly miri run -- flush-bad \
  2>&1 | tee ../../phase5_experiment_results/EXP-104-flush.log
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-ignore-leaks" cargo +nightly miri run -- receive-bad \
  2>&1 | tee ../../phase5_experiment_results/EXP-104-receive.log
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-ignore-leaks" cargo +nightly miri run -- flush-good \
  2>&1 | tee ../../phase5_experiment_results/EXP-104-flush-good.log
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-ignore-leaks" cargo +nightly miri run -- receive-good \
  2>&1 | tee ../../phase5_experiment_results/EXP-104-receive-good.log
```

**Verdict:** CONFIRMED_UB (Tree-Borrows model)

**Notes:**
- `EXP-104-flush.log` fails in `ssl_write` with `reborrow through ... is forbidden`; Miri reports the protected tag was created at `fn flush_bad(&mut self)`. This is the source-shaped representative for generated exported methods such as `flush(&mut self)`.
- `EXP-104-receive.log` fails in `ssl_on_close` with the protected tag created at `fn receive_bad(&mut self, data: &[u8])`. This is the source-shaped representative for the `on_read` / `on_internal_receive_data` receive paths.
- `EXP-104-flush-good.log` and `EXP-104-receive-good.log` run clean with the same `WRAPPER_BUSY` logic when the entry path is raw-owner.
- This does **not** mean `WRAPPER_BUSY` is wrong. It is the right UAF/drop-under-wrapper guard. The defect is that the exported callback-driving methods still start from protected `&mut self` receivers. Remediation should keep the deferral guard and change the receiver shape.

---

## EXP-106: `PipeWriter::{on_write_complete,_on_write}` keeps `&mut self` live while parent callback re-enters `writer.with_mut`

**Finding ref:** Codex 2026-05-16 follow-up after the `LaunderedSelf` guardrail; `src/io/PipeWriter.rs` R-2 comments.
**Section:** A/E/H/J/P cross-section writer surface — `src/io/PipeWriter.rs:426-451,1572-1619,2105-2185`; concrete parent exemplar `src/runtime/webcore/FileSink.rs:463-531`; macro call `src/runtime/webcore/FileSink.rs:254-266`.
**Bucket:** 1 (Aliasing) + 15 (receiver lifetime/protector escape) + 21 (FFI/libuv callback aliasing)
**Severity:** MUST-BE-UB (Tree-Borrows model; live FileSink/Writer source shape)
**Hypothesis:** `PipeWriter`'s `LaunderedSelf` R-2 pattern fixes stale-field reloads but does not remove the protected receiver tag created by methods such as `WindowsStreamingWriter::on_write_complete(&mut self)` and `PosixBufferedWriter::_on_write(&mut self, ...)`. These methods call `Parent::on_write(parent, ...)`. The concrete `FileSink::on_write(this: *mut FileSink, ...)` handler can run pending JS/microtasks and then re-enter the same intrusive writer via `(*this).writer.with_mut(|w| w.end())` / `.close()` (`src/runtime/webcore/FileSink.rs:524-526`). That fresh `&mut Writer` aliases the live writer receiver from `on_write_complete(&mut self)`. `black_box(ptr::from_mut(self))` forces reloads, but it does not end the receiver's Tree-Borrows protector for the call frame.

**Minimal reproducer:** `experiments/EXP-106/` mirrors the source shape:

```rust
fn on_write_complete_bad(&mut self) {
    let this = black_box(ptr::from_mut(self));
    let parent = unsafe { (*this).parent };
    unsafe { Parent::on_write_reenter(parent) }; // mints fresh &mut Writer
    black_box(this);
    unsafe { (*this).is_done = false };
}
```

The control path starts from a raw-owner pointer:

```rust
fn on_write_complete_good(this: *mut Self) {
    let this = black_box(this);
    let parent = unsafe { (*this).parent };
    unsafe { Parent::on_write_reenter(parent) };
    black_box(this);
    unsafe { (*this).is_done = false };
}
```

**Expected signal:** Tree-Borrows rejects the bad path with a protected tag created at `fn on_write_complete_bad(&mut self)`; the raw-owner control passes.

**Falsifiability:** demote if source audit proves no current parent callback can re-enter the same intrusive writer while the writer callback frame is active. Close as `RESOLVED` if `PipeWriter` completion/error/write paths are migrated so callback-running entry points take raw owner pointers (`*mut Self` / `NonNull<Self>`) and only create statement-scoped borrows outside callback spans.

**Invocation:**

```sh
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-106
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-ignore-leaks" cargo +nightly miri run -- bad \
  2>&1 | tee ../../phase5_experiment_results/EXP-106-bad.log
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-ignore-leaks" cargo +nightly miri run -- good \
  2>&1 | tee ../../phase5_experiment_results/EXP-106-good.log
```

**Verdict:** CONFIRMED_UB (Tree-Borrows model)

**Notes:**
- `EXP-106-bad.log` fails at `Parent::on_write_reenter`: `write access through <...> ... is foreign to the protected tag <...>`; Miri reports the protected tag was created at `fn on_write_complete_bad(&mut self)`.
- `EXP-106-good.log` runs clean with the same parent re-entry write when the writer entry point starts from a raw owner rather than `&mut self`.
- This sharpens, rather than contradicts, the source comments. The comments correctly identify stale cached field loads and re-entry; the missing piece is that receiver signatures must also change. `LaunderedSelf` is not enough for callback-running methods.

---

## EXP-107: `RareData::close_all_watchers_for_isolation(&mut self)` re-enters watcher registration while the receiver borrow is live

**Finding ref:** Codex 2026-05-16 callback-receiver shape sweep; `src/jsc/rare_data.rs:864-891`.
**Section:** K/runtime test-isolation crossover — `RareData` watcher cleanup invoked from `VirtualMachine::swap_global_for_test_isolation` (`src/jsc/VirtualMachine.rs:4551`); concrete registration/removal edges in `src/runtime/node/node_fs_watcher.rs:997,1130-1135`.
**Bucket:** 1 (Aliasing) + 15 (receiver lifetime/protector escape) + 21 (JS callback re-entry)
**Severity:** MUST-BE-UB (Tree-Borrows model; source comment explicitly names same-Vec re-entry)
**Hypothesis:** `RareData::close_all_watchers_for_isolation(&mut self)` keeps a protected whole-object receiver for the duration of the cleanup loop, launders it through `black_box(ptr::from_mut(self))`, pops an `IsolationWatcher`, and calls its opaque close function. The source comment states that close re-enters JS (`FSWatcher.close -> "close" event`) and can call `add_*_watcher_for_isolation`, pushing back onto the same `fs_watchers_for_isolation` / `stat_watchers_for_isolation` vectors. That re-entry reaches `RareData` through the VM/raw-owner path, not as a child of the active `&mut self` receiver. Tree Borrows therefore rejects the callback's fresh mutable reborrow once the loop has made the receiver tag `Unique`. `black_box` prevents cached-vector metadata, but it does not end the receiver protector.

**Minimal reproducer:** `experiments/EXP-107/` mirrors the source shape:

```rust
fn close_all_watchers_for_isolation_bad(&mut self) {
    let this = black_box(ptr::from_mut(self));
    loop {
        let Some(w) = unsafe { &mut (*this).fs_watchers_for_isolation }.pop() else { break };
        unsafe { (w.close)(w.ptr) }; // callback pushes to the same Vec via raw-owner path
        black_box(this);
    }
}
```

The control path uses the same vector and same callback, but enters from a raw owner:

```rust
unsafe fn close_all_watchers_for_isolation_raw(this: *mut Self) { /* same loop */ }
```

**Expected signal:** Tree-Borrows rejects the bad path with a protected tag created at `fn close_all_watchers_for_isolation_bad(&mut self)`; the raw-owner control passes.

**Falsifiability:** close as `RESOLVED` if `close_all_watchers_for_isolation` is changed to a raw-owner entry point or otherwise proves that watcher close callbacks cannot re-enter `RareData` registration/removal. Demote if source audit shows the in-source `add_*_watcher_for_isolation` re-entry comment is stale and no current FS/stat watcher close path can reach JS.

**Invocation:**

```sh
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-107
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-107-bad.log
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run -- good \
  2>&1 | tee ../../phase5_experiment_results/EXP-107-good.log
```

**Verdict:** CONFIRMED_UB (Tree-Borrows model)

**Notes:**
- `EXP-107-bad.log` fails in the re-entrant push callback: the raw-owner tag is foreign to the protected receiver tag created at `close_all_watchers_for_isolation_bad(&mut self)`.
- `EXP-107-good.log` runs clean with the same re-entrant push when the cleanup loop starts from a raw owner.
- This is not a new criticism of `IsolationWatcher` storage. The per-entry `(ptr, close)` table is fine. The defect is the callback-running receiver signature around the loop.

---

## EXP-108: `EventLoop::run_callback(&mut self)` allows JS re-entry into the same loop while the receiver borrow is live

**Finding ref:** Codex 2026-05-16 callback-receiver shape sweep; `src/jsc/event_loop.rs:455-507` plus host exports `src/jsc/event_loop.rs:1147-1186`.
**Section:** K/runtime event-loop core — `EventLoop::{run_callback,run_callback_with_result}` are called from host exports through `global.bun_vm().event_loop_mut()`.
**Bucket:** 1 (Aliasing) + 15 (receiver lifetime/protector escape) + 21 (JS callback re-entry)
**Severity:** MUST-BE-UB (Tree-Borrows model; source comment explicitly names nested `event_loop()` re-entry)
**Hypothesis:** `EventLoop::run_callback(&mut self)` and `run_callback_with_result(&mut self)` launder `self`, call `enter()`, invoke `callback.call(...)`, then call `exit()`. The source comment states that the JS callback can re-enter through host functions that reach the same loop via `vm.event_loop()` and run nested `enter()/exit()` pairs or `drain_microtasks`. Because the exported entry path uses the safe `event_loop_mut(&self) -> &mut EventLoop` accessor, the outer method has a protected `&mut EventLoop` receiver while the callback can mint a fresh raw-owner/VM-derived mutable access to the same loop. The launder prevents cached `entered_event_loop_count`, but it does not make the nested mutable access a child of the outer receiver tag.

**Minimal reproducer:** `experiments/EXP-108/` mirrors the source shape:

```rust
fn run_callback_bad(&mut self, callback: fn(*mut EventLoop), owner: *mut EventLoop) {
    let this = black_box(ptr::from_mut(self));
    unsafe { (*this).enter() };
    callback(owner); // re-enters EventLoop through VM/raw-owner path
    let this = black_box(this);
    unsafe { (*this).exit() };
}
```

The control path enters from a raw owner and otherwise runs the same nested callback:

```rust
unsafe fn run_callback_raw(this: *mut Self, callback: fn(*mut EventLoop)) { /* same enter/callback/exit */ }
```

**Expected signal:** Tree-Borrows rejects the bad path with a protected tag created at `fn run_callback_bad(&mut self, ...)`; the raw-owner control passes.

**Falsifiability:** close as `RESOLVED` if `run_callback` / `run_callback_with_result` no longer take `&mut self` across JS execution, or if the host exports route callback-running entries through raw-owner helpers with statement-scoped reborrows. Demote if source audit proves JS callbacks cannot re-enter `event_loop_mut()` / `event_loop()` while these methods are active.

**Invocation:**

```sh
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-108
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-108-bad.log
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run -- good \
  2>&1 | tee ../../phase5_experiment_results/EXP-108-good.log
```

**Verdict:** CONFIRMED_UB (Tree-Borrows model)

**Notes:**
- `EXP-108-bad.log` fails in the nested callback's fresh `&mut EventLoop`; Miri reports the protected tag was created at `run_callback_bad(&mut self, ...)`.
- `EXP-108-good.log` runs clean with the same nested `enter()/exit()` when the outer callback runner starts from a raw owner.
- This is distinct from EXP-073 (`CopyFileWindows` stored `&EventLoop` then mutated it) and EXP-084 (`VirtualMachine: Send + Sync` plus unchecked TLS access). EXP-108 is the single-threaded callback-receiver variant for the core event-loop runner itself.

---

## EXP-110: `h2_frame_parser::Stream::queue_frame(&mut self)` dispatches JS while the stream receiver borrow is live

**Finding ref:** Codex 2026-05-16 callback-receiver shape sweep follow-up; promoted from the earlier "reviewed but not promoted" h2 suspect after a source-faithful Tree-Borrows model.
**Section:** F/runtime-api + Q/http-network-stack — `src/runtime/api/bun/h2_frame_parser.rs:1850-1981`, dispatch at `:2626-2628`, call sites at `:5594` and `:5637-5646`.
**Bucket:** 1 (Aliasing) + 15 (receiver lifetime/protector escape) + 21 (JS callback re-entry)
**Severity:** MUST-BE-UB (Tree-Borrows model; source comment explicitly names re-entry through `client.streams`)
**Hypothesis:** `Stream::queue_frame(&mut self, client: &H2FrameParser, ...)` launders `self`, then calls `client.dispatch_write_callback(old_callback)` while the function-frame `&mut Stream` receiver is still protected. The source comment says the JS callback can call back into h2 host functions such as `writeStream`, look the same `Stream` up from `client.streams`, and reach `queue_frame()` again with a fresh `&mut Stream` aliasing the original receiver. The `black_box` calls prevent stale-load optimization over the JS callback, but they do not remove the Rust receiver protector. Any re-entrant `&mut Stream` minted from the parser's raw stream map is foreign to the protected outer receiver tag.

**Minimal reproducer:** `experiments/EXP-110/` mirrors the current source shape:

```rust
fn queue_frame_bad(&mut self, client: &Client) {
    let this = black_box(ptr::from_mut(self));
    unsafe { (*this).data_frame_queue.push(PendingFrame { callback_live: true }) };
    client.dispatch_write_callback(); // re-enters through Client.stream raw owner
    unsafe { (*this).data_frame_queue.last_mut().unwrap().callback_live = false };
}
```

The control path enters from a raw owner and otherwise performs the same queue write, callback dispatch, re-entrant stream mutation, and post-callback queue mutation:

```rust
unsafe fn queue_frame_raw(this: *mut Stream, client: &Client) { /* same logic */ }
```

**Expected signal:** Tree-Borrows rejects the bad path with a protected tag created at `fn queue_frame_bad(&mut self, ...)`; the raw-owner control passes.

**Falsifiability:** close as `RESOLVED` if `Stream::queue_frame` no longer takes `&mut self` across `dispatch_write_callback`, or if h2 write callbacks cannot re-enter `client.streams` and reach the same `Stream`. Demote if an integrated source audit proves the in-source `writeStream` re-entry comment is stale and no current JS callback path can look up the same stream during dispatch.

**Invocation:**

```sh
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-110
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-110-bad.log
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run -- good \
  2>&1 | tee ../../phase5_experiment_results/EXP-110-good.log
```

**Verdict:** CONFIRMED_UB (Tree-Borrows model)

**Notes:**
- `EXP-110-bad.log` fails in the callback's fresh `&mut Stream`; Miri reports the protected tag was created at `queue_frame_bad(&mut self, ...)`.
- `EXP-110-good.log` runs clean with the same re-entrant queue mutation when the outer queue-frame path starts from a raw owner.
- This is narrower than "all h2 frame queuing is unsound." The counted defect is the callback-dispatching branch where `dispatch_write_callback` can synchronously run JS while a protected `&mut Stream` receiver is live.

---

## EXP-109: `bun:ffi` callback root-loss hypothesis — source disproves the production `JSCallback` path; stale-bits Miri model retained as non-source-faithful guard

**Finding ref:** Deep-pass Lane A audit (Codex/Claude collaboration, 2026-05-16), corrected by Codex source-root-graph audit on 2026-05-16.

**Section:** R (FFI / native bridge) — production callback path spans `src/js/bun/ffi.ts:84-109`, `src/runtime/ffi/ffi_body.rs:1295-1339`, `src/runtime/ffi/ffi_body.rs:2131-2271`, and `src/jsc/bindings/JSFFIFunction.cpp:47-70`.

**Bucket:** 13 (Refcount lifecycle / GC integration) + 15 (Lifetimes & escape) + 21 (FFI callback aliasing).

**Severity:** NO_EVIDENCE for the original production-UB hypothesis. The standalone Miri model is a valid stale-handle shape, but it is not source-faithful to Bun's current `JSCallback` rooting path.

**Hypothesis:** The original production-UB hypothesis was that `Compiled` stores `js_function: JSValue` as a bare bit-pattern, so JSC GC could collect the callback while a raw `cb.ptr` trampoline remains live. That hypothesis is now falsified for the production `JSCallback` path by the source-root graph below.

**Source correction:** the user-facing `new JSCallback(options, cb)` path does not rely on `Compiled.js_function` or `JSFFI.symbolsValue` as the callback root:

1. `src/js/bun/ffi.ts:84-109` calls native `ffi.callback`, stores the returned native context in private field `#ctx`, exposes `ptr`, and destroys the context only in `close()` / `[Symbol.dispose]`.
2. `src/runtime/ffi/ffi_body.rs:1322-1339` heap-allocates a `Function` and returns both `ptr` and `ctx`.
3. `src/runtime/ffi/ffi_body.rs:2141` calls `Bun__createFFICallbackFunction(js_context, js_function)`.
4. `src/runtime/ffi/ffi_body.rs:2263-2271` stores `ffi_callback_function_wrapper: NonNull::new(ffi_wrapper)` in the heap `Function`; `Function::drop` destroys the wrapper.
5. `src/jsc/bindings/JSFFIFunction.cpp:47-70` shows `FFICallbackFunctionWrapper` owns `JSC::Strong<JSC::JSFunction> m_function` and `JSC::Strong<Zig::GlobalObject> globalObject`.

That `JSC::Strong` wrapper is a GC root for the callback function and global object. Therefore, dropping a JS symbols table is not enough to invalidate the callback while `JSCallback.#ctx` remains live. The earlier artifact's `JSFFI.symbolsValue` argument applied to library symbol tables, not to the `JSCallback` callback wrapper root.

`src/runtime/ffi/mod.rs:438-445` still contains a duplicate `Compiled` scaffolding type with a bare `JSValue`, but the generated `closeCallback` / `callback` host path uses `ffi_body::FFI` (`src/runtime/ffi/FFIObject.rs:1069-1101`), not that duplicate as the production callback root. Treat the `mod.rs` duplicate as cleanup/hardening debt, not a live callback-root UB proof.

**Minimal reproducer:** `.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-109/src/main.rs` mirrors the bare-bits shape with a stand-in `FakeJsCell` whose `Drop` is observable. Sequence:
1. Allocate a `FakeJsCell` on the heap (mirrors a `JSFunction` JSCell)
2. Store its raw pointer bits in `FakeCompiled.js_function: FakeJsValue { bits }` (mirrors `Compiled.js_function: JSValue`)
3. Invoke `ffi_callback_call(&compiled)` — succeeds (NORMAL path)
4. `drop(cell_box)` — mimics JSC GC sweep while the symbols table is unrooted
5. Invoke `ffi_callback_call(&compiled)` again — reads through stale bits

Miri cannot directly model JSC GC, so this reproducer demonstrates only the SHAPE. A faithful confirmation requires a Bun integration test that calls `globalThis.gc()` between steps 3 and 5.

**Expected signal:**
- The existing standalone reproducer correctly demonstrates stale raw JSCell bits after the simulated cell is dropped, but it omits Bun's `FFICallbackFunctionWrapper` and `JSC::Strong` root.
- A source-faithful Bun/JSC integration test should **not** crash merely because GC runs while a `JSCallback` object with live `#ctx` exists.
- A test that calls a saved `ptr` after `JSCallback.close()` is a use-after-close contract violation, not the original GC-root-loss hypothesis.

**Falsifiability:**
- **Closed as NO_EVIDENCE** for the stated root-loss claim because the production callback path already owns a `JSC::Strong<JSFunction>` through `FFICallbackFunctionWrapper`.
- Re-open only if an integration test shows ordinary `new JSCallback(...)` usage can invoke the trampoline after GC while `#ctx` is live and the wrapper has not been destroyed.
- Keep a separate hardening recommendation to remove or align the duplicate `mod.rs` `Compiled` scaffolding so future readers do not mis-audit the wrong type.

**Invocation (standalone reproducer, Miri-shaped):**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-109
MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run \
  2>&1 | tee ../../phase11_artifacts/regression/EXP-109/miri-sp.log
```

**Invocation (Bun integration regression guard — DESIGN, not yet authored):**
```typescript
// Existing test files under test/js/bun/ffi/ should get this if maintainers want
// a GC-root regression guard; no fake issue-number regression file.
import { test, expect } from 'bun:test';
import { JSCallback } from 'bun:ffi';

test('JSCallback roots callback while ctx is live', () => {
  const cb = new JSCallback({ args: [], returns: 'i32' }, () => 42);
  const ptr = cb.ptr;
  globalThis.gc(); globalThis.gc();  // multiple cycles to force collection
  // Invoke ptr through a tiny native shim that calls the function pointer.
  // Expected: returns 42 while cb.#ctx remains live.
  expect(ptr).toBeTruthy();
  cb.close();
});
```

**Verdict:** NO_EVIDENCE

**Notes:**
- `phase5_experiment_results/EXP-109.log` remains useful as a generic stale-handle Miri witness, but the model is not source-faithful because it intentionally lacks the C++ `JSC::Strong` wrapper.
- The old text's claim that users can drop a `JSFFI.symbolsValue` table while retaining only `cb.ptr` mixed two surfaces: FFI library symbol tables and `JSCallback` callbacks. The latter owns a native context through `#ctx`.
- The real hardening follow-up is smaller: delete or reconcile the duplicate `src/runtime/ffi/mod.rs` `Compiled` scaffolding and add a GC regression test for `JSCallback` so this does not regress when `ffi_body.rs` is hoisted/refactored.
- Do not count EXP-109 as confirmed UB, a P0/P1, or a remediation bead requiring `Strong<JSValue>` migration in current source. It is a falsified hypothesis plus a regression-test idea.

- **Defensibility cross-check:** the orchestrator personally verified the bare-JSValue shape at `src/runtime/ffi/mod.rs:438-445` and the live use at `:469-479` (FFI_Callback_call extern calls) on 2026-05-16. Three SIBLING candidates from the same Lane-A subagent were DEMOTED after personal verification: EXP-FFI-002 (cross-thread dispatch lives in C++, not auditable from Rust); EXP-FFI-003 (tinycc allocator pairing — vendor/tinycc not vendored in current checkout, dormant); EXP-FFI-004/005 (user-trust API by design).


---

## EXP-111: bundler part-range fan-out still materializes concurrent `&mut LinkerContext` / `&mut Chunk`, and the `ChunkRenamer` view is still mutable

**Finding ref:** Deep-pass Lane B audit, source TODO at `src/bundler/Chunk.rs:130-132`, EXP-010 family source review, and default-Miri witness `phase5_experiment_results/EXP-111-sb.log`.

**Section:** M (bundler-and-transpiler) — `src/bundler/Chunk.rs:80-84,114-134`; `src/bundler/linker_context/generateCompileResultForJSChunk.rs:54-68,160-169`; `src/bundler/linker_context/generateCompileResultForCssChunk.rs:38-47`; `src/bundler/linker_context/generateCodeForFileInChunkJS.rs:30-35`; `src/bundler/ungate_support.rs:498-506`; `src/js_printer/renamer.rs:96-116,257-258,825-830`.

**Bucket:** 1 (Aliasing) + 7 (Cross-thread fan-out / data races) + 8 (unsafe Send/Sync invariants).

**Severity:** CONFIRMED_UB (default-Miri retag/data-race witness over the current fan-out shape; Tree Borrows accepts the read-only model, so do not claim a TB failure for EXP-111).

**Hypothesis:** the current bundler part-range worker path has two coupled aliasing defects:

1. **Whole-owner mutable reborrows during fan-out.** `generate_compile_result_for_js_chunk` and `generate_compile_result_for_css_chunk` both recover the same raw `*mut LinkerContext` / `*mut Chunk` from `PendingPartRange` and immediately materialize `&mut LinkerContext` plus `&mut Chunk` for the worker body (`generateCompileResultForJSChunk.rs:60-68`; `generateCompileResultForCssChunk.rs:44-47`). Multiple part-range tasks for the same chunk run concurrently, so the second `&mut Chunk` retag races the first even before any logical field write. The source comments at `generateCompileResultForJSChunk.rs:21-23` and `generateCompileResultForCssChunk.rs:18-20` still say this path "never forms `&mut LinkerContext`", but the code below those comments does.

2. **The renamer view remains mutable even though worker use is intended to be read-only.** `Chunk` carries `pub renamer: bun_renamer::ChunkRenamer` (`src/bundler/Chunk.rs:84`), and `ChunkRenamer::as_renamer(&mut self)` produces a `Renamer<'_, '_>` whose variants still hold `&mut {Number,NoOp,Minify}Renamer` (`src/js_printer/renamer.rs:96-116`; `src/bundler/ungate_support.rs:498-506`). The blanket `unsafe impl Send for Chunk` / `unsafe impl Sync for Chunk` (`Chunk.rs:133-134`) is justified by a multi-paragraph comment (`Chunk.rs:114-129`) explaining that worker-disjoint writes go through `CompileResultSlots`, file byte counters use atomic RMW, and the renamer "is fully populated before fan-out and treated as read-only by the printer."

The author then adds an explicit TODO at `:130-132`:
> "TODO(ub-audit): `Renamer<'r>` still borrows `&'r mut {Number,Minify}Renamer`, so the per-chunk renamer is reborrowed mutably from each part-range task; the printer never writes through it, but the borrow should become `&'r`."

This is author-acknowledged, but the defect is broader than the renamer TODO alone. The EXP-111 default-Miri witness fails at the **concurrent `&mut Chunk` retag**. Therefore a renamer-only patch is not sufficient if the worker callback still materializes aliased `&mut Chunk` / `&mut LinkerContext` references. Separately, a shared-renamer patch has to account for `SymbolMap::follow()`: it mutates path-compression links through `Cell` (`src/ast/symbol.rs:667-727`). `LinkerContext::link()` currently calls `self.graph.symbols.follow_all()` before returning chunks (`src/bundler/LinkerContext.rs:913`), which may make worker-time `follow()` calls store-free in practice, but a complete fix must either prove that precompression invariant for every parallel codegen path or introduce a no-compress/read-only follow path used during fan-out.

Under default Miri, concurrent workers minting `&mut Chunk` from the same raw owner race at the retag itself even if the lookups are semantically read-only, because `&mut` retags carry write implications for data-race purposes. Tree Borrows accepts the current read-only standalone model, so do **not** claim a TB failure for EXP-111 unless a source-shaped writing path is later added.

**Minimal reproducer:** `.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-111/src/main.rs` mirrors the fan-out borrow shape:
- Outer owner holds a `Chunk` that contains a mutable renamer view.
- Spawn N "worker" threads, each re-deriving `&mut Chunk` from a shared raw pointer captured at fan-out.
- Each worker only reads through the renamer.
- Drop the borrows when all workers join.

The reproducer deliberately proves that the **retag itself** is enough to make the current source shape invalid under default Miri. It does not prove that `Renamer<'r>` is the sole cause; the source-level root cause is the combined fan-out contract.

**Expected signal:**
- Under default Miri: `error: Undefined Behavior: Data race detected between (1) retag write on thread unnamed-1 and (2) retag write of type Chunk<'_> on thread unnamed-2` — fired by the second worker's reborrow attempt.
- Under Tree Borrows: the current read-only standalone model is accepted. Keep the finding counted on default-Miri retag/data-race evidence; do not claim a TB failure for EXP-111 unless a source-shaped write path is later added.

**Falsifiability:**
- **CLOSES only if** the part-range worker path stops materializing concurrent whole-owner `&mut LinkerContext` / `&mut Chunk` references. Acceptable shapes include a granular read-only `ChunkView` / `LinkerContextView`, raw-pointer field projection for the narrow disjoint writes already identified (`compile_results_for_chunk[i]`, atomic counters), or per-worker owned snapshots for data that is genuinely independent.
- **Also required:** flip the renamer fan-out view from `&mut` to shared/read-only, or otherwise prove that every worker gets a unique owned renamer snapshot. If the shared view still calls `SymbolMap::follow()`, the fix must prove `follow_all()` fully compressed all paths before worker fan-out or use a no-compress read-only follow function.
- Demote if integrated source review shows `generate_compile_result_for_*_chunk` never shares the same chunk across workers (contradicts Section M notes and the current scheduling in `generateChunksInParallel.rs:196-333`).

**Invocation:**
```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-111
cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-111-sb.log
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-111-tb.log
```

**Verdict:** CONFIRMED_UB

**Notes:**
- **Author-acknowledged**: this is *not* a third-party speculation. The `TODO(ub-audit)` at `src/bundler/Chunk.rs:130-132` is the implementer flagging exactly this concern, with the proposed fix (`&'r` instead of `&'r mut`) already named. The TODO predates this audit.
- Default Miri confirms the concurrent mutable-retag/data-race model in `phase5_experiment_results/EXP-111-sb.log`. The rerun uses a scoped-thread `SendChunkPtr<T>` wrapper rather than an integer pointer shuttle, so there is no provenance-warning escape hatch. `phase5_experiment_results/EXP-111-tb.log` is clean; this is explicitly a default-Miri finding, not a Tree-Borrows finding.
- The `CompileResultSlots` design and `files_with_parts_in_chunk` atomic RMW design are sound for their narrow writes. They do **not** justify the larger worker-body `&mut Chunk` / `&mut LinkerContext` reborrows.
- Treat EXP-111 as the `Chunk` / renamer-specific subcase of the EXP-010 bundler fan-out family, not as an isolated "renamer only" bug. A patch that changes only `Renamer<'r>` to `&'r` but leaves the worker callbacks forming concurrent whole-owner `&mut` references would not close EXP-111.
- Cross-bucket: same family as EXP-046/047/057/058 (unsafe impl Send/Sync over `&mut`-bearing types).
- **Remediation candidates (rubric pending; see META-RUBRIC-SCORING bead):**
  - A. Refactor worker entry points to take granular read-only views (`&LinkerContext`, `&Chunk`, or smaller view structs) and route the two real writes through the existing raw/interior-mutable primitives. Then flip `Renamer<'r>` to carry `&'r` instead of `&'r mut` for the fan-out lifetime; printer reads with `&'r` matching the type.
  - B. Snapshot the renamer to an owned per-worker copy at fan-out; perf cost = renamer-allocation per worker.
  - C. Keep `&'r mut` carry behind a dedicated interior-mutability wrapper only if the SAFETY block proves no worker-time mutation path exists, `follow()` cannot path-compress in parallel, and no worker constructs whole-owner `&mut` references. This is reviewer-hostile and inferior to A.

- **Defensibility cross-check:** the orchestrator personally verified the source at `src/bundler/Chunk.rs:80-134` on 2026-05-16, including the multi-paragraph SAFETY comment and the explicit TODO marker. Distinguished from THREE Lane B sibling candidates that were demoted: `bundler/LinkerGraph.rs:96-97` (well-justified by surrounding comments — symbols Map's AtomicU32 chunk_index sync via worker-pool join), `collections/array_hash_map.rs:1561-1562` (bounds-conditional auto-trait restoration, defensible), and `runtime/socket/WindowsNamedPipe.rs:1187/1222` (already covered by recently-added EXP-104).
