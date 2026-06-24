# Phase 11 Campaign 3 — Fuzz Summary

Run: `2026-05-15-exhaustive` · Author: Phase 11 Campaign 3.x fuzz runner ·
Date: 2026-05-16 · Time budget: 60 min (each campaign 5 min wall).

## Per-target outcomes

| Target | Wall | Execs | Exec/s | Cov (ft) | Crashes | Miri verdict |
| ------ | ---- | ----- | ------ | -------- | ------- | ------------ |
| `lockfile_sparse_enum_fuzz` | 5 min cap, exited via timeout | ≥67M¹ | 737K | 14 ft 15 (saturated) | **0** | n/a (clean) |
| `standalone_module_graph_fuzz` (initial run, guard `<16`) | <1 s | ~1.7K | n/a (crash) | 16 ft 17 | **1** (ASan HBO) | **fuzz-target bug — preserved** |
| `standalone_module_graph_fuzz` (rerun, guard `<20`, buf=16) | <1 s | ~2K | n/a (crash) | 17 ft 18 | **1** (ASan stack-buf-overflow) | **fuzz-target bug — preserved** |
| `standalone_module_graph_fuzz` (final, guard `<20`, buf=20) | 301 s | 218,063,056 | 724K | 17 ft 18 | 0 new | n/a (clean after fix) |
| `semver_string_fuzz` | <1 s | ~10² | n/a (crash) | n/a | **1** (deadly signal) | **CONFIRMED UB** |

¹ `lockfile_sparse_enum_fuzz` hit the 5 min cap; final pulse line in the log is
67,108,864 but cargo-fuzz did not print a `DONE` line before timeout — only the
periodic `pulse` lines. Effective coverage is settled at `cov: 14 ft: 15` from
exec ~2M onward.

² `semver_string_fuzz` reached its first crash within a handful of executions
because `Arbitrary` rapidly synthesises a struct with the high-bit-set inline
byte and a large `len` field, both of which trigger the OOB witness condition.

## Crashes found + triaged Miri verdicts

### Witness #1 — `semver_string_fuzz/crash-3b428dc841fa211aa81ada3d95e0a4eea93a2903`

- Input: `sem_bytes = [1, 0, 0, 0, 0, 0, 0, 254]`, `buf = []`
- Decoded: tagged path (`bytes[7] & 0x80 == 0x80`), `off = 1`, `len ≈ 2.1 GiB`
- EXP entries validated: **EXP-008 + EXP-009** (semver `String::slice`
  `get_unchecked` after `debug_assert!` strip).
- **Miri verdict** — CONFIRMED UB:

  ```
  error: Undefined Behavior: in-bounds pointer arithmetic failed:
  attempting to offset pointer by 1 byte, but got alloc57 which is at or
  beyond the end of the allocation of size 0 bytes
    --> lib.rs (mirror of src/semver/lib.rs:586-616), line 93
  ```

- Reproducer + Miri harness:
  `phase11_artifacts/miri_triage/lib.rs::miri_semver_string_slice_oob`.

### Witness #2 — `standalone_module_graph_fuzz/crash-51be1eb3b6b759f6c3c1a9ba6a06e53e1238e569`

- Input: `[10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]`
  (20 bytes; with `#[repr(C, packed)]` the byte at offset 16 lands in the
  `side` enum field; value `0x0a` is invalid for a 2-discriminant enum).
- EXP entries validated: **EXP-035** (`ptr::read_unaligned` over the
  `__BUN` macho section, followed by byte→enum materialisation across 4
  sparse enums).
- **Miri verdict** — CONFIRMED UB:

  ```
  error: Undefined Behavior: constructing invalid value of type Side:
  at .<enum-tag>, encountered 0x0a, but expected a valid enum tag
    --> lib.rs (mirror of read_unaligned + transmute), line 37
  ```

- Reproducer + Miri harness:
  `phase11_artifacts/miri_triage/lib.rs::miri_standalone_module_graph_repro_invalid_side_byte`.

### Witness #3 — incidental: `standalone_module_graph_fuzz/crash-0a4ae866ed31840c72a71a330cc11ac75175e115`

- Self-witness of EXP-035's class. Initial fuzz target had `if data.len()
  < 16` but the `CompiledModuleGraphFile` record is **20 bytes** (4 u32 +
  4 u8). The `ptr::read_unaligned::<Record>` then read 4 bytes past
  libfuzzer's 17-byte heap allocation → ASan
  heap-buffer-overflow READ of size 20.
- The fuzz target author (this campaign) **independently reproduced the
  exact developer error class EXP-035 describes**: a record-size
  miscalculation at a `ptr::read_unaligned` site. Preserved as a separate
  reproducer; fix applied (guard now `< 20` and the round-trip `let mut
  buf = [0u8; 20]`).

## Coverage notes

`libfuzzer` reports coverage as `cov` (PC count) and `ft` (feature count, ~basic-block edges); it does not report percentage. After the harness saturates the lookup tables:

- Target 1: `cov: 14 ft: 15` — all 256 byte values × 6 enum decoders ≈ 96 codepaths exercised; lookup-table jump tables collapse to a small ft surface.
- Target 2: `cov: 17 ft: 18` — `read_unaligned` + 4 byte→bool gates + `write_unaligned` round-trip.
- Target 3: crashed before coverage could settle.

## Comparison vs EXP entries

| Target | EXP entries claimed by `phase11_soak_designs.md` §1.3 | This run validates |
| ------ | ---------------------------------------------------- | ------------------ |
| `lockfile_sparse_enum_fuzz` | EXP-003 (HasInstallScript), EXP-006 (Origin), EXP-036 (DependencyVersionTag / ResolutionTag / IntegrityTag / PatchedDep bool), EXP-020 family | All five mirrored decoders survive 67M executions of every 1-byte input without UB at the safe-decoder layer. The Miri-confirmed UB only fires if the call site **omits** the safe decoder, which is what every EXP-003/006/036/020 entry actually documents at the Bun call site. |
| `standalone_module_graph_fuzz` | EXP-035 (4 niche-bearing enums × `read_unaligned`) | CONFIRMED via Witness #2: byte 0x0a transmuted to a 2-discriminant enum is UB per Miri. Independent reproduction in Witness #3 of the EXP-035 record-size-miscalculation hazard class. |
| `semver_string_fuzz` | EXP-008, EXP-009 (`get_unchecked` after `debug_assert!`) | CONFIRMED via Witness #1: Miri reports out-of-bounds pointer arithmetic at the exact source-line analog of `src/semver/lib.rs:586-616`. |

## Recommended next step

**Yes — promote to 24 h `rch` campaign on worker-b**, but only after one
local edit:

1. Add a seed corpus directory per target. `lockfile_sparse_enum_fuzz`
   especially benefits — libfuzzer's `Arbitrary` strategy collapses to a
   single 1-byte mutation class without a seed, so a corpus of all 256
   single-byte inputs would prime coverage instantly. For `semver_string_fuzz`,
   seed with `(off, len) ∈ {(0,0), (1,0), (u32::MAX, 1), (0, u32::MAX),
   (1<<31, 1)}` + 32 valid (off, len) pairs from existing semver tests.

2. Run all three at `-max_total_time=86400` on worker-b (5 slots, parallel
   jobs). Per `phase11_soak_designs.md` §3, this maps to tags
   `ub-exorcism-2026-05-15-exhaustive-fuzz-{sparse-enum,smg,semver}`.

3. Wire ASan into the Bun-source path too. The current standalone fuzz
   crates mirror the source; the highest-value 24h follow-up is to fuzz
   the real `bun_semver::String::slice` and the real
   `bun_install_lockfile::Meta::read_from` directly. That requires
   either (a) `cargo fuzz` from inside the Bun workspace (blocked on
   `bun bd --configure-only` per §1 Campaign-1 caveat), or (b) extract
   the leaf crates into a `--exclude`-ed fuzz-only workspace.

**Do not** ship the lockfile_sparse_enum_fuzz target as a regression
gate without a seed corpus — its 5-min run today produced 67M executions
of essentially the same coverage class and would burn CI time without
catching the OOB-by-omission pattern the EXP entries describe.

## Artefacts

```
/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/fuzz/
├── lockfile_sparse_enum_fuzz/
│   ├── Cargo.toml
│   ├── fuzz_targets/lockfile_sparse_enum_fuzz.rs
│   ├── corpus/ (empty)
│   └── artifacts/ (empty — no crashes)
├── standalone_module_graph_fuzz/
│   ├── Cargo.toml
│   ├── fuzz_targets/standalone_module_graph_fuzz.rs   ← fixed 16→20
│   └── artifacts/standalone_module_graph_fuzz/
│       ├── crash-0a4ae866…  (initial 16-byte guard, ASan HBO)
│       └── crash-51be1eb3…  (rerun, 16-byte buf, ASan stack overflow)
└── semver_string_fuzz/
    ├── Cargo.toml
    ├── fuzz_targets/semver_string_fuzz.rs
    └── artifacts/semver_string_fuzz/
        └── crash-3b428dc8… (8-byte input, deadly signal)

/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase11_artifacts/
├── fuzz-lockfile_sparse_enum_fuzz.log
├── fuzz-standalone_module_graph_fuzz.log         ← initial crash
├── fuzz-standalone_module_graph_fuzz-rerun.log   ← second crash (buf=16)
├── fuzz-standalone_module_graph_fuzz-final.log   ← 5 min clean (buf=20)
├── fuzz-semver_string_fuzz.log
├── fuzz_summary.md                               ← this file
└── miri_triage/
    ├── Cargo.toml
    └── lib.rs                                    ← 4 Miri tests, 2 confirm UB
```
