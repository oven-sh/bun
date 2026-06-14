# Phase 11 SOAK Campaign Designs

Run: `2026-05-15-exhaustive` · Author: Phase 11 soak-designer · Mode:
Exhaustive / read-only source · Date: 2026-05-16.

**Current-status correction (Codex, 2026-05-16):** this file was drafted
before the late EXP-109/110/111 normalization and subsequent EXP-109
source-root-graph correction. The current registry has 106 entries with 70
`CONFIRMED_UB`, 17 `NO_EVIDENCE`, 17 `DEFERRED`, 2 `RESOLVED`, **0 `OPEN`**,
and **0 `NEEDS_REFINEMENT`**. Treat the campaigns below as broad-coverage soak
plans; there is no remaining registry evidence gap.

This document is the **execution plan** for the multi-day dynamic campaigns
that Phase 3 path-(c) deferred. Inputs:

- `phase4_unified_findings.md` (182 finding rows after the late EXP-109/110/111
  normalization; 106-entry registry, EXP-001..EXP-111 with EXP-022..025
  intentionally unused and EXP-105 reserved for non-counted support-model logs)
- `phase3_dynamic_findings.md` (path-c deferral list)
- `phase8_remediation_plan.md` (4 explicit `/multi-model-triangulation`
  flags: R-EXP-010, R-EXP-035, R-EXP-051 (2x))
- `rch workers capabilities` (worker-a, worker-b — both healthy, both nightly
  rustc 1.97.0)
- `.unsafe-audit/fuzz-{lockfile,inverse}/` (prior-audit fuzz scaffolding)

**This phase authors NO Bun source edits.** It (a) designs campaigns,
(b) probes rch worker connectivity, (c) emits a single read-only layout-
assert proof-of-concept under `experiments/layout_asserts/napi.rs`.

---

## 0. Worker capacity inventory (probed 2026-05-16)

```
worker-a  <user>@<worker-a-host-redacted>   slots=8  priority=100  tags=bun,go,rust
worker-b  <user>@<worker-b-host-redacted>   slots=8  priority=90   tags=bun,go,rust
```

Both probed healthy (`rch workers probe --all`): worker-a 193ms, worker-b 329ms.
Both have nightly rustc 1.97.0 (parity with local). Total: **16 concurrent
worker slots**.

**Critical rch limitation discovered during probe** (`rch diagnose`):
`cargo miri test`, `cargo fuzz run`, `cargo test` with sanitizer flags
are **not** classified as compile commands. `rch exec --` falls through
to local execution. Two workable paths:

- (A) Wrap each campaign in a thin `cargo build --release --target-dir
  /worker/soak/<tag>` step (intercepted) followed by an in-tree `cargo
  miri test` step run via `ssh ubuntu@<worker> -- bash -lc '…'` directly.
- (B) Install an explicit `rch` classifier for `miri test`/`fuzz run` (out
  of scope here — file as a follow-up bead).

Path (A) is what the dispatch commands below assume.

---

## 1. Campaign catalogue

Five soak campaigns plus the layout-assert CI gate. Wall-times below are
**budgets**, not promises — Miri is 5–100× native and `--workspace`
expansion may overshoot. Per-tag rch slot accounting assumes campaigns
run in parallel where possible.

| # | Campaign | Workers / Slots | Wall budget | Covers / stresses |
| - | -------- | --------------- | ----------- | ------ |
| 1 | 4-config Miri matrix × full workspace | worker-a:4 + worker-b:4 | 24–72h / config | EXP-001..009, EXP-014, EXP-019, EXP-021, EXP-026..029, EXP-033..037, EXP-041..045, EXP-049..050, EXP-057..059 |
| 2 | Sanitizer matrix (ASan/TSan/MSan/LSan) | worker-a:4 | 12–48h / sanitizer | EXP-010 (TSan), EXP-017 (TSan), EXP-018 (TSan/compile-time) |
| 3 | Fuzz campaigns (24h each, 5 targets) | worker-b:5 | 24h × 5 | EXP-003/006/036/EXP-020 (sparse enum); EXP-035 standalone module graph; EXP-008/009 SmallString |
| 4 | Loom matrix (8 models) | worker-a:2 + worker-b:2 | 4–24h / model | EXP-010, EXP-017, EXP-018, EXP-030, EXP-031, EXP-032, EXP-033, EXP-052 |
| 5 | Shuttle complement (overflow from loom) | worker-a:1 | 12h / model | Same as #4 for >3-thread blowups |
| L | Layout-assert build-script CI gate | local | one-off | F-10-2/3/4/5 (NAPI, HandleType, windows_sys, boringssl_sys) |

### Campaign 1 — Miri matrix × full workspace

**Configs (run independently per-worker):**

```
miri-sb  : MIRIFLAGS="-Zmiri-strict-provenance -Zmiri-ignore-leaks"      # default Stacked Borrows
miri-tb  : MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-strict-provenance"      # tree borrows
miri-sp  : MIRIFLAGS="-Zmiri-strict-provenance -Zmiri-disable-isolation" # strict-provenance gate
miri-sa  : MIRIFLAGS="-Zmiri-symbolic-alignment-check"                    # allocator-layout-mismatch
```

**Command template** (per-config, run on a disposable worker clone):

```bash
ssh ubuntu@$WORKER -t -- bash -lc '
  cd /data/projects/bun &&
  git fetch origin main &&
  git checkout --detach 4d443e5402 &&
  export MIRIFLAGS="<flags-per-config>" &&
  bun bd --configure-only &&  # materializes build_options.rs
  cargo +nightly miri test --workspace \
    --no-fail-fast -j1 \
    2>&1 | tee /worker/soak/miri-<cfg>-$(date +%Y%m%d).log
'
```

**Pre-flight blocker:** `bun bd --configure-only` requires clang-21 + lld-21
on each worker. **Capabilities probe needed before dispatch** — `apt list
--installed | rg clang-21|lld-21` on each worker. If absent, the rch
`workers sync-toolchain` subcommand is the wrong tool (it syncs Rust
only). Either (a) `ssh sudo apt-get install -y clang-21 lld-21` on each
worker, or (b) leaf-crate fallback (path-b: `cargo miri test -p
bun_collections -p bun_semver -p bun_safety -p bun_install_lockfile`)
which doesn't depend on `build_options.rs`.

**Per-config tag**: `ub-exorcism-2026-05-15-exhaustive-miri-{sb,tb,sp,sa}`

**Expected findings — in-tree confirmations of standalone-only
witnesses:** EXP-001 (uninit-via-`assume_init_slice`), EXP-002 (errno
transmute), EXP-003/006 (Meta enum from disk), EXP-004 (Vec layout
mismatch), EXP-005/034 (yarn/migration uninit slices), EXP-007
(`get_unchecked` dep_id), EXP-008/009 (semver `String::slice`), and the
in-tree variants of all 25+ TB-model findings (EXP-010, EXP-014, EXP-026,
EXP-028, EXP-041..044).

### Campaign 2 — Sanitizer matrix

```
asan  : RUSTFLAGS="-Zsanitizer=address"  cargo +nightly test --workspace --target x86_64-unknown-linux-gnu
tsan  : RUSTFLAGS="-Zsanitizer=thread"   cargo +nightly test --workspace --target x86_64-unknown-linux-gnu --test-threads=1
msan  : RUSTFLAGS="-Zsanitizer=memory -Zsanitizer-memory-track-origins" cargo +nightly test --workspace -Z build-std --target x86_64-unknown-linux-gnu
lsan  : RUSTFLAGS="-Zsanitizer=leak"     cargo +nightly test --workspace --target x86_64-unknown-linux-gnu
```

**TSan is the headline tool here** — it's the only confirmation path for
the Bucket-7 race cluster:

- EXP-010 (`LinkerContext` parallel-callback `&mut`) — bundler hot path
- EXP-017 (`Request::store_callback_seq_cst` write_volatile + fence)
- EXP-018 (`GuardedLock<…, Mutex>` cross-thread Send)
- EXP-030 (`ThreadPool::Queue` lock-free)
- EXP-031 (`WatcherAtomics` slot picker)
- EXP-032 (`WebWorker` `Cell::get` cross-thread)
- EXP-052 (`UnboundedQueue<T>` MPSC Relaxed swap)

**Per-tag**: `ub-exorcism-2026-05-15-exhaustive-sanitizer-{asan,tsan,msan,lsan}`

MSan needs `-Z build-std` and a clean target dir — expect a 6-12h cold
start before tests run. Run on worker-a only (sanitizers don't parallelise
across workers — each test process reads/writes its own shadow memory).

### Campaign 3 — Fuzz (24h each, 5 targets)

Adopt the prior-audit fuzz scaffolding from `.unsafe-audit/fuzz-lockfile/`
and `.unsafe-audit/fuzz-inverse/`. **Three NEW targets needed:**

#### 3.1 `lockfile_sparse_enum_fuzz` — NEW

Feeds 1-byte buffers through every `#[repr(u8)]` enum reader on the
lockfile path. Validates: EXP-003 (HasInstallScript), EXP-006 (Origin),
EXP-036 (DependencyVersionTag/ResolutionTag/IntegrityTag/PatchedDep
bool), EXP-020 family. Density: ~250/256 bytes are invalid tags for
the sparsest enum (HasInstallScript 3/256, Origin 3/256).

```rust
// fuzz_targets/lockfile_sparse_enum.rs
#![no_main]
use libfuzzer_sys::fuzz_target;
fuzz_target!(|data: &[u8]| {
    if data.len() < 8 { return; }
    let _ = bun_install_lockfile::Meta::try_from_bytes(&data[0..1]);
    let _ = bun_install::lib::Origin::try_from_bytes(&data[1..2]);
    let _ = bun_install_lockfile::DependencyVersionTag::try_from_bytes(&data[2..3]);
    let _ = bun_install_lockfile::ResolutionTag::try_from_bytes(&data[3..4]);
    let _ = bun_install_lockfile::IntegrityTag::try_from_bytes(&data[4..5]);
    let _ = bun_install_lockfile::PatchedDep::read_from(&data[5..]);
});
```

Run under `cargo +nightly fuzz run lockfile_sparse_enum -- -timeout=10
-max_total_time=86400 -jobs=4 -workers=4`.

#### 3.2 `standalone_module_graph_fuzz` — NEW

Validates EXP-035: `read_unaligned::<CompiledModuleGraphFile>` over the
`__BUN` macho section. Feeds the 4-niche-enum record. Reuse the
standalone repro from `experiments/EXP-035/src/main.rs` as the seed
corpus.

#### 3.3 `semver_string_fuzz` — NEW

Feeds packed `(off: u32, len: u32)` words into `bun_semver::String::slice`
/ `::eql`. Validates EXP-008/009. Run **in release mode** (debug-assert
strip is the hazard). Seed corpus: every (off, len) pair from existing
semver corpus + `(u32::MAX, u32::MAX)`, `(0, u32::MAX)`, `(1<<31, 1)`.

#### 3.4 Adopted: `fuzz-lockfile/` (prior corpus)

Existing artifacts under `.unsafe-audit/fuzz-lockfile/artifacts/` — point
new run at same corpus dir, add 24h fresh run. Catches whole-lockfile
deserialiser regressions across the 60+ field types.

#### 3.5 Adopted: `fuzz-inverse/` (prior corpus)

Same pattern. Inverse-write tests.

**Per-tag**: `ub-exorcism-2026-05-15-exhaustive-fuzz-{sparse-enum,smg,semver,lockfile,inverse}`

### Campaign 4 — Loom matrix

8 models, 10000+ iterations each (`LOOM_MAX_PREEMPTIONS=3`,
`LOOM_LOG=1`).

| Model file | Anchor | Notes |
| ---------- | ------ | ----- |
| `experiments/EXP-030/` | ThreadPool Queue cache CAS | exists; rerun fresh |
| `experiments/EXP-031/` | WatcherAtomics slot-picker | exists; rerun fresh |
| `experiments/EXP-032/` | WebWorker Cell cross-thread | exists; rerun fresh |
| `experiments/EXP-033/` | Channel<T,B> uninit `&mut [T]` validity | exists; rerun fresh |
| **EXP-010-loom** (NEW) | LinkerContext parallel-callback | Phase 5 flagged as needing hand-scheduled; **highest priority NEW model** |
| **EXP-017-loom** (NEW) | write_volatile + fence vs atomic store | tests "non-atomic store as publication" |
| **EXP-018-loom** (NEW) | GuardedLock cross-thread Send | type-system witness possible but loom firms it |
| **EXP-052-loom** (NEW) | UnboundedQueue<T> MPSC | F-DR-3 now `NO_EVIDENCE`; keep as a regression soak |

Workers: 2 slots per worker, 4 models in flight at once.

**Per-tag**: `ub-exorcism-2026-05-15-exhaustive-loom-{exp-id}`

### Campaign 5 — Shuttle complement

For loom models that exceed `LOOM_MAX_PREEMPTIONS=3` or hit explosive
schedule counts (>3 threads, >1000 iters/30min). Drop those to **shuttle
100k random schedules** — randomised exploration that scales linearly.

Candidates: EXP-010-loom (5-callback fan-out — likely >3 threads),
EXP-052-loom (MPSC with multiple producers — pathological under
exhaustive loom).

**Per-tag**: `ub-exorcism-2026-05-15-exhaustive-shuttle-{exp-id}`

---

## 2. Layout-assert build-script CI gate

Captured as a separate work item because it is (a) cheap, (b)
deterministic, (c) closes 4 Bucket-10 findings in one PR.

**Scope:**

- F-10-2 (NAPI 5 structs — primary; PoC delivered below)
- F-10-3 (`HandleType` 18-discriminant enum hand-transcribed from `uv.h`: `UV_UNKNOWN_HANDLE`, 16 `UV_HANDLE_TYPE_MAP` entries, and `UV_FILE`)
- F-10-4 (`bun_windows_sys` 48 structs, 4 asserts)
- F-10-5 (`bun_boringssl_sys` 15 structs, 0 asserts)

**Pattern (gold standard):** `src/libuv_sys/libuv.rs:3480-3523` — `const
_: () = { assert_size!(…); assert_offset!(…); }` block, cfg-gated per
target triple. 74 asserts in libuv_sys; we are adding ~80 more across
the 3 sibling _sys crates.

**Cross-validation method** (mandatory before merge):

1. Author a tiny C program per _sys crate (`scripts/<crate>_layout_dump.c`)
   that `#include`s the upstream header and `printf`s `sizeof(T)`,
   `_Alignof(T)`, `offsetof(T, field)` for every relevant struct.
2. Compile + run on each target triple in CI (`x86_64-linux-gnu`,
   `x86_64-apple-darwin`, `aarch64-apple-darwin`, `x86_64-pc-windows-msvc`,
   `aarch64-unknown-linux-gnu`).
3. Diff the C numbers against the Rust asserts. **Mismatches block the
   PR.**

**Phase 11 PoC delivered:** `experiments/layout_asserts/napi.rs` —
analytically derived size/offset/align asserts for the 5 NAPI POD
structs (`napi_property_descriptor`, `napi_extended_error_info`,
`napi_type_tag`, `napi_node_version`, `struct_napi_module`), scoped to
`x86_64 + (linux | macos)`. Each row carries an inline comment showing
how the offset was computed from the C struct layout + System V AMD64
padding rules. Header line-numbers cross-referenced from
`src/runtime/napi/{js_native_api_types.h,node_api_types.h,node_api.h}`;
Rust struct line-numbers cross-referenced from
`src/runtime/napi/napi_body.rs`.

**Known caveat in the PoC** (documented inline): `napi_type_tag` fields
`lower`/`upper` are `pub(crate)` not `pub`, so the `assert_offset!`
macro can't reach them by name. The two-`u64` total size + 8-byte align
asserts still catch any field reorder or width drift; field-name asserts
require either a visibility bump or a `#[repr(C)]` introspection helper.
**Recommendation:** bump to `pub` on the same PR that lands the
asserts — these fields are public ABI by construction.

---

## 3. rch dispatch — actual probe attempts

### Probe 1: Worker connectivity (`rch workers probe --all`)

```
worker-a <user>@<worker-a-host-redacted>  ✓ OK (193ms)
worker-b <user>@<worker-b-host-redacted>  ✓ OK (329ms)
2 worker(s) probed: 2 healthy.
```

### Probe 2: Toolchain parity (`rch workers capabilities`)

Both workers: `rustc 1.97.0-nightly` (parity with local `1.97.0-nightly
e95e73209 2026-05-05`). worker-b has older Node/npm; irrelevant for these
campaigns.

### Probe 3: `rch exec` classification (`rch diagnose -- cargo miri
test …`)

Result: **`Decision: ⚠ WOULD NOT INTERCEPT — Reason: Command not
classified as compilation`**. `cargo +nightly miri test`, `cargo +nightly
fuzz run`, `cargo +nightly test --target` with sanitizer envs all fail
classification. Confidence 0.00, threshold 0.85.

**Implication:** the rch hook cannot transparently route these soak
campaigns. Direct `ssh ubuntu@<worker> -t -- bash -lc '<command>'` is the
working dispatch path, with `nohup` + `disown` for 24h+ campaigns. The
rch fleet management surface (`rch workers list/probe/capabilities`)
remains useful for health monitoring; the `exec` subcommand is not the
right tool for non-compile work.

### Probe 4: Trivial compile through rch (`rch exec -- cargo +nightly
build` on EXP-001 standalone)

```
Compiling exp_001_linear_fifo_niche v0.0.1
Finished `dev` profile … in 0.15s
WARN  rch::hook: exec called with non-compilation command
```

0.15s elapsed → not actually remoted. The rch hook short-circuits to
local when the heuristic doesn't fire, or when there are no link
artifacts that justify offload. The standalone-experiment scale is too
small to benefit from rch in either direction.

### Recommended dispatch pattern (going forward)

```bash
# Long-running soak: bypass rch, use direct ssh with logfile.
WORKER=worker-a
TAG=ub-exorcism-2026-05-15-exhaustive-miri-tb
ssh <user>@<worker-a-host-redacted> -- bash -lc "
  mkdir -p /home/ubuntu/soak/$TAG &&
  cd /home/ubuntu/soak/$TAG &&
  git clone --depth=200 https://github.com/oven-sh/bun.git . 2>/dev/null || git fetch origin main &&
  git checkout --detach 4d443e5402 &&
  nohup env MIRIFLAGS='-Zmiri-tree-borrows -Zmiri-strict-provenance' \
    cargo +nightly miri test --workspace --no-fail-fast -j1 \
    > $TAG.log 2>&1 &
  disown
"
```

Then poll progress with `ssh ubuntu@<worker> tail -F /home/ubuntu/soak/$TAG/$TAG.log`.

---

## 4. Recommended priority order (which campaigns ship first)

Score = (confirmed/regression evidence produced per worker-hour) × (severity weight) ÷
(prerequisite blockers). Lower index = ship sooner.

1. **Campaign L (layout asserts)** — runs locally, no prereqs, closes 4
   findings (F-10-2/3/4/5), PoC already in tree. **Ship in this run.**
2. **Campaign 3.1 (`lockfile_sparse_enum_fuzz`)** — no `bun bd`
   prerequisite (fuzzes leaf-crate readers), closes 4 confirmed-UB
   entries (EXP-003/006/036 + EXP-020-family). 24h on worker-b.
3. **Campaign 3.2 (`standalone_module_graph_fuzz`)** — same profile,
   different surface; covers EXP-035 (4 sparse enums × 256^4).
4. **Campaign 3.3 (`semver_string_fuzz`)** — release-mode required;
   covers EXP-008/009.
5. **Campaign 4 — EXP-010-loom (NEW model)** — Phase 5 explicitly
   flagged bundler as needing hand-scheduled loom. Highest-value NEW
   model. Triangulation already recommended.
6. **Campaign 2 — TSan only** — covers EXP-010/017/018/030/031/032/052
   if it fires. worker-a, 24h, no MSan build-std cold start.
7. **Campaign 1 — Miri TB model** — most settled config, broadest
   confirmation surface. **Blocked on clang-21/lld-21 install on
   workers** OR fallback to leaf-crate path-b (which can run today).
8. **Campaign 1 — Miri SP/SA configs** — strict-provenance + symbolic
   alignment; covers EXP-020 cluster + EXP-004 family.
9. **Campaign 1 — Miri SB model** — last (default config is what we
   already implicitly soaked in Phase-3 standalone repros).
10. **Campaign 5 (shuttle)** — only if Campaign 4 over-runs.
11. **Campaign 2 — MSan/LSan/ASan** — lowest yield; sanitizer matrix is
    completeness-driven, not finding-driven.

---

## 5. Recommended Phase-7 iteration anchors

These are the **two campaigns that would add the broadest post-convergence
evidence** if you only had budget to run two:

- **Campaign 1 Miri TB model** — covers EXP-010/014/026/028/041/042/043/044
  (8 TB-sensitive findings / structural cases), plus in-tree confirmations of all the
  standalone-only CONFIRMED witnesses. Single largest reach. **Soft
  blocker: clang-21/lld-21 on workers** — resolve before ship.
- **Campaign 3.1 sparse-enum fuzz** — cheapest entry, closes 4
  confirmed-UB findings, no toolchain prerequisites. **Run first to
  generate corpus, then feed corpus into Campaign 1 Miri.**

Phase 7 (iterate) should anchor each loop on (a) one Miri config making
progress + (b) one fuzz target generating fresh inputs + (c) one loom
model confirming concurrency assumptions, rotating which slots own
which campaigns as wall-clock budget permits.

---

## 6. What this phase did NOT do

Per constraints:

- **No source edits** to anything under `src/`. The layout-assert PoC
  lives under `.ub-exorcism/.../experiments/layout_asserts/napi.rs`,
  not in `src/runtime/napi/napi_body.rs`. The header of the PoC file
  documents the exact upstream patch site.
- **No 24h campaigns dispatched.** Probe-only (30s budget). The four
  rch probes above are the actual probe deliverable.
- **No new fuzz target crates created.** Specs + seed-corpus pointers
  + `fuzz_target!` skeletons are in §1.3 — landing them requires a
  follow-up under `fuzz/fuzz_targets/` once Phase 11 is greenlit.
- **No sub-agents.** Single-agent pass, ~50 min.

---

## 7. Follow-up beads (deferred to Phase 12+)

1. **Worker prerequisite probe**: `ssh ubuntu@<worker> 'apt list
   --installed 2>/dev/null | rg "^(clang|lld)-21"'` for both workers.
   If absent, install. Blocks Campaign 1 full-workspace path.
2. **Bun bd configure-only sync**: cache the generated
   `build_options.rs` on each worker (or treat it as a per-soak
   prerequisite step in the dispatch script).
3. **rch classifier extension**: add `miri test`, `fuzz run`, and
   `cargo test --target … RUSTFLAGS=-Zsanitizer=…` to the classifier
   so future runs benefit from transparent routing. Out of scope here.
4. **Layout-asserts cross-validation**: create, compile, and run the future
   proposed N-API layout-dump helper sketched in
   `experiments/layout_asserts/napi.rs` on Linux + macOS + Windows.
   Adjust offsets where MSVC differs; gate Windows asserts in their
   own cfg block.
5. **`napi_type_tag` field visibility**: bump `lower`/`upper` to `pub`
   so `assert_offset!` can name them. Same PR as the asserts.
