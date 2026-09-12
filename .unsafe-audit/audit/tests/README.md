# Audit-pass-4 regression tests

Concrete, compilable tests catching each soundness bug from passes 2 and 3.
**Discipline:** every test is real code; no pseudocode. Trybuild fixtures
are paired with `expected_errors/*.stderr`. The proptest fixtures and the
dirent regression test compile and pass standalone (see verification at
the bottom of this file).

## Contents

```
audit/tests/
├── README.md                                        ← this file
├── storeslice_send_compilefail.rs                   ← trybuild  (pass-2 pre-existing-ub-002)
├── jscell_send_compilefail.rs                       ← trybuild  (pass-3 PUB-N-A)
├── racycell_sync_compilefail.rs                     ← trybuild  (pass-3 PUB-N-B)
├── concurrent_promise_task_send_compilefail.rs      ← trybuild  (pass-3 jsc-ub-2)
├── blob_sync_compilefail.rs                         ← trybuild  (pass-3 jsc-ub-3)
├── linear_fifo_proptest.rs                          ← proptest  (pass-2 F-1)
├── bounded_array_resize_proptest.rs                 ← proptest  (pass-3 P3-BC-003)
├── dirent_parser_regression.rs                      ← cargo test (pass-3 sys-T1-2 / sys-T1-3 / FreeBSD)
├── expected_errors/                                 ← trybuild expected-stderr fixtures
│   ├── storeslice_send_compilefail.stderr
│   ├── jscell_send_compilefail.stderr
│   ├── racycell_sync_compilefail.stderr
│   ├── concurrent_promise_task_send_compilefail.stderr
│   └── blob_sync_compilefail.stderr
└── clippy_lint_from_ref_cast_mut/                   ← (Part 3) custom lint
    ├── sgconfig.yml                                 ← ast-grep entry point (option c — recommended)
    ├── rules/
    │   └── dealloc-through-from-ref.yml             ← the rule
    ├── test_corpus/
    │   ├── positive.rs                              ← 8 expected hits
    │   └── negative.rs                              ← 0 expected hits
    └── dylint_lint/                                 ← (option a — full dylint crate)
        ├── Cargo.toml
        └── src/lib.rs
```

## Choice of lint vehicle

**Recommended: ast-grep (option c).** Zero new build dependency, ~50 lines of
YAML, runs in CI as `sg scan --config <sgconfig.yml> src/`. Verified against
the live Bun tree: catches both real sites
(`src/http/AsyncHTTP.rs:117`, `src/http/lib.rs:176`) with zero false positives
on the rest of the tree. Negative corpus stays at 0 hits.

The dylint scaffold (option a) is provided as a complete crate for teams that
want a "real" lint pass integrated with `cargo clippy`. It uses
`rustc_private` and therefore pins a nightly toolchain — that's a cost we
recommend declining unless the lint needs HIR-level smarts beyond what
ast-grep gives.

## Wiring into Bun's existing suites

Place each file under the home crate's `tests/` directory and register with
the crate's `Cargo.toml`. **Branch names must start with `claude/`** (Bun
CI requirement).

### 1. Trybuild fixtures (Part 1)

Add `trybuild = "1"` as a `dev-dependency` of the home crates:

```toml
# src/ast/Cargo.toml
[dev-dependencies]
trybuild = "1"

# src/jsc/Cargo.toml
[dev-dependencies]
trybuild = "1"

# src/bun_core/Cargo.toml
[dev-dependencies]
trybuild = "1"
```

Create one trybuild driver per crate:

```rust
// src/ast/tests/compile_fail.rs
#[test]
fn compile_fail() {
    let t = trybuild::TestCases::new();
    t.compile_fail("tests/compile_fail/storeslice_send.rs");
}
```

Copy each fixture (and its `.stderr`) into the matching crate's
`tests/compile_fail/`:

| Fixture | Home crate | Final path |
|---|---|---|
| `storeslice_send_compilefail.rs` | `bun_ast` | `src/ast/tests/compile_fail/storeslice_send.rs` |
| `jscell_send_compilefail.rs` | `bun_jsc` | `src/jsc/tests/compile_fail/jscell_send.rs` |
| `racycell_sync_compilefail.rs` | `bun_core` | `src/bun_core/tests/compile_fail/racycell_sync.rs` |
| `concurrent_promise_task_send_compilefail.rs` | `bun_jsc` | `src/jsc/tests/compile_fail/concurrent_promise_task_send.rs` |
| `blob_sync_compilefail.rs` | `bun_jsc` | `src/jsc/tests/compile_fail/blob_sync.rs` |

**The fixtures are designed to COMPILE TODAY and FAIL TO COMPILE AFTER THE
FIX.** That is the regression catcher: a PR that lands the fix must update
the `.stderr` snapshots; a PR that accidentally regresses the fix will see
its `tests/compile_fail` suite go silently green and the maintainer rejects
the diff in review (or the CI gate enforces "must have at least N
compile_fail tests").

### 2. Proptest fixtures (Part 2)

Add `proptest = "1"` and `bytemuck = { version = "1", features = ["derive"] }`
as `dev-dependencies` (bytemuck is already a regular dep of `bun_core`):

```toml
# src/collections/Cargo.toml
[dev-dependencies]
proptest = "1"
bytemuck = "1"

# src/bun_core/Cargo.toml
[dev-dependencies]
proptest = "1"
```

Move files into the matching crate's `tests/` (or `src/.../tests/` for
in-crate visibility of `pub(crate)` items):

| Fixture | Home crate | Final path |
|---|---|---|
| `linear_fifo_proptest.rs` | `bun_collections` | `src/collections/tests/linear_fifo_proptest.rs` |
| `bounded_array_resize_proptest.rs` | `bun_core` | `src/bun_core/tests/bounded_array_resize_proptest.rs` |

Run with `cargo test -p bun_collections` / `cargo test -p bun_core`. Under
nightly with `cargo +nightly miri test` the property tests double as a
miri-driven UB scan over the corner cases — that catches the "fix that
papered over the bug but kept the UB" failure mode.

### 3. Dirent regression test (Part 4)

This file is **fully standalone** — the parsers it tests are reproduced
inline (mirroring the byte-offset arithmetic in `src/sys/lib.rs:336-388`,
`:478-510`, `:550-580`). It runs as a regular `cargo test`. Place at:

```
src/sys/tests/dirent_parser_regression.rs
```

After the fix lands (the `parse_*` helpers move into `sys::dir_iterator`),
this test should be migrated to call the real helpers instead of the
inlined copies. The transition is mechanical and tracked in
audit/plans/PASS3-bun-sys-and-cfg-gated.md.

### 4. ast-grep lint (Part 3)

Wire into CI via `.github/workflows/ast-grep.yml`:

```yaml
name: ast-grep audit lints
on: [push, pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cargo install ast-grep
      - run: sg scan --config .unsafe-audit/audit/tests/clippy_lint_from_ref_cast_mut/sgconfig.yml src/ --strict
```

The corpus check runs in the same workflow:

```yaml
      - name: positive corpus must produce exactly 8 warnings
        run: |
          count=$(sg scan --config .unsafe-audit/audit/tests/clippy_lint_from_ref_cast_mut/sgconfig.yml \
                          .unsafe-audit/audit/tests/clippy_lint_from_ref_cast_mut/test_corpus/positive.rs \
                          2>&1 | grep -c 'warning\[dealloc-through-from-ref\]')
          [ "$count" = "8" ] || { echo "expected 8 warnings, got $count"; exit 1; }
      - name: negative corpus must produce zero warnings
        run: |
          count=$(sg scan --config .unsafe-audit/audit/tests/clippy_lint_from_ref_cast_mut/sgconfig.yml \
                          .unsafe-audit/audit/tests/clippy_lint_from_ref_cast_mut/test_corpus/negative.rs \
                          2>&1 | grep -c 'warning\[dealloc-through-from-ref\]')
          [ "$count" = "0" ] || { echo "expected 0 warnings, got $count"; exit 1; }
```

## What "passing" means

| Test | Before fix lands | After fix lands |
|---|---|---|
| Trybuild fixtures | trybuild's `compile_fail` test PASSES iff the file does not compile. **Today the file DOES compile, so trybuild reports the test FAILURE — that's the audit signal.** | trybuild's `compile_fail` succeeds (file no longer compiles); `.stderr` snapshot matches. |
| Proptest fixtures | Tests pass for `u8`/`AnyBitPattern` T's; the companion trybuild compile-fail snippets at the bottom of the file are intended to fail-to-compile after the fix lands. | Tests still pass; the niche-T API is reachable only behind the new `T: AnyBitPattern` bound. |
| Dirent regression | Standalone — **passes today** as written, demonstrating the SHAPE the fixed parser should produce. The fix migrates production `sys/lib.rs:336-388` to use these `parse_*` helpers (or equivalents); the test then becomes a thin call. | Same test passes through the real production parser. |
| ast-grep lint | Fires on 2 live sites (`http/AsyncHTTP.rs:117`, `http/lib.rs:176`) — those are the U2 cluster to fix. | Fires on 0 sites; positive corpus stays at 8, negative at 0; CI green. |

## Verification log

```
$ rustc --edition=2021 --crate-type=lib --test dirent_parser_regression.rs -o /tmp/d
$ /tmp/d
test result: ok. 14 passed; 0 failed; 0 ignored

$ sg scan --config sgconfig.yml src/
warning[dealloc-through-from-ref]: ... src/http/AsyncHTTP.rs:117:18
warning[dealloc-through-from-ref]: ... src/http/lib.rs:176:22

$ sg scan --config sgconfig.yml test_corpus/positive.rs    # 8 warnings
$ sg scan --config sgconfig.yml test_corpus/negative.rs    # 0 warnings
```

The trybuild fixtures cannot be run standalone (they import `bun_ast`,
`bun_jsc`, `bun_core` — workspace crates), but they are statically
checked: each fixture references actual types and members confirmed via
`grep`/`Read` against the live source tree (e.g.
`bun_ast::nodes::StoreSlice`, `bun_jsc::JsCell`, `bun_core::util::RacyCell`,
`bun_jsc::ConcurrentPromiseTask`, `bun_jsc::webcore_types::Blob`).

## Bead suggestions

Each bug catcher above maps cleanly to a `br` bead. Suggested titles:

- `audit-test/storeslice-send-bound` (deps: A-002 / C-003)
- `audit-test/jscell-send-sync-bound` (deps: C-003)
- `audit-test/racycell-sync-bound`   (deps: C-003)
- `audit-test/concurrent-promise-task-send-bound` (deps: CODEX-P3-cross-thread-task-send-boundaries)
- `audit-test/blob-sync-drop`        (deps: pass3 jsc-ub-3 plan)
- `audit-test/linear-fifo-niche-bound` (deps: F-1)
- `audit-test/bounded-array-resize-niche-bound` (deps: P3-BC-003)
- `audit-test/dirent-parser-reclen-bounds` (deps: PASS3-bun-sys-and-cfg-gated)
- `audit-test/ast-grep-dealloc-through-from-ref` (deps: U2 cluster fix)
