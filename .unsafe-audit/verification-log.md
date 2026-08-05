# Bun unsafe-audit Phase 9 — Real Verification Log

Real runs performed on 2026-05-15. Toolchain: nightly 1.97.0 with miri component.

## Vendor-deps blocker workaround

The first audit pass reported that `cargo metadata` failed because Bun's `vendor/lolhtml/c-api/Cargo.toml` is fetched at build time and isn't checked in. We bypassed this by creating an audit-only stub:

```
vendor/lolhtml/c-api/Cargo.toml  (stub package "lol_html_c_api")
vendor/lolhtml/c-api/src/lib.rs  (empty)
```

This is sufficient for `cargo metadata` / `cargo check` / `cargo +nightly miri test` to run on individual crates that don't transitively call into lol-html. The stub is NOT a substitute for the real vendor dep — it's there to unblock verification only.

## Miri runs (`-Zmiri-strict-provenance`)

| Crate | Tests | Result | Notes |
|-------|------:|--------|-------|
| `bun_errno` | 3 | ✓ PASS | All errno-table tests pass under strict provenance. Including the lib that contains the latent-UB `impl GetErrno for usize` from C-002 — but the test suite doesn't currently exercise that impl, so miri can't surface the bug. |
| `bun_ast` | 5 | ✓ PASS | Includes the crate where the `StoreSlice<T>` latent-soundness bug lives. Miri doesn't fail here because the existing tests don't try to send a `StoreSlice<Cell<u32>>` across threads — the bug is at the type-level Send/Sync impl, not in the runtime code path. **A property test that constructs `StoreSlice<Cell<u32>>` and spawns it across threads would be miri-detectable** — proposed as part of the C-003 patch verification. |
| `bun_alloc` | 10 | ✓ PASS | All `stack_fallback` allocator tests pass. Important: this is the allocator crate (Invariant I-005), and 10 unit tests passing under strict provenance is strong evidence the allocator's unsafe surface is sound for the cases exercised. |
| `bun_semver` | 0 | ✓ PASS (vacuous) | No unit tests in the lib target. |
| `bun_url` | 0 | ✓ PASS (vacuous) | No unit tests in the lib target. |
| `bun_paths` | 3 | ✗ **FAIL** | See finding below. |
| `bun_collections` | n/a | ✗ COMPILE ERROR | E0034 / E0433 in test code; not a miri UB. Pre-existing test-only error. |
| `bun_ptr` | 1 | ✓ PASS | `cow_slice` test under strict provenance. |
| `bun_threading` | 2 | ✓ PASS | `rwlock::raw_internal_state` + `rwlock::smoke`. |
| `bun_event_loop` | 0 | ✓ PASS (vacuous) | No unit tests. |
| `bun_io` | n/a | ✗ MIRI-UNSUPPORTED | Test calls `simdutf__validate_utf8` FFI which miri can't link. This is a miri *limitation*, not a UB finding. A `cfg(miri)` shim would make the test miri-runnable. |
| `bun_glob` | 0 | ✓ PASS (vacuous) | No unit tests. |
| `bun_resolver` | 0 | ✓ PASS (vacuous) | No unit tests. |
| `bun_wyhash` | 8 | ✓ PASS | All wyhash test vectors pass under strict provenance. |
| `bun_base64` | 2 | ✗ **FAIL** (1/2) | `test_base64_url_safe_no_pad` panics with `NoSpaceLeft`. Fails under plain `cargo test` too — another pre-existing broken test in main (not miri-specific). |
| `bun_sha_hmac` | 0 | ✓ PASS (vacuous) | No unit tests. |
| `bun_dotenv` | 0 | ✓ PASS (vacuous) | No unit tests. |
| `bun_unicode` | 0 | ✓ PASS (vacuous) | No unit tests. |
| `bun_css` | 0 | ✓ PASS (vacuous) | No unit tests. |
| `bun_ini` | 0 | ✓ PASS (vacuous) | No unit tests. |
| `bun_md` | 14 | ✓ PASS | Unicode/case-fold tests all pass under strict provenance. |
| `bun_csrf` | 0 | ✓ PASS (vacuous) | No unit tests. |
| `bun_perf` | 0 | ✓ PASS (vacuous) | No unit tests. |

**Aggregate:** 23 crate attempts under `-Zmiri-strict-provenance`.

- 7 crates passed with real tests: `bun_errno`, `bun_ast`, `bun_alloc`,
  `bun_ptr`, `bun_threading`, `bun_wyhash`, `bun_md` (**43 tests in fully
  passing crates**).
- 12 crates passed vacuously because their lib targets had zero unit tests.
- 2 crates had pre-existing assertion failures (`bun_paths`, `bun_base64`);
  both also fail outside miri and are not UB findings.
- 1 crate was miri-unsupported (`bun_io`, FFI to simdutf).
- 1 crate had a test-code compile error (`bun_collections`).

Do not summarize this as "43/47 tests pass" without the qualifier above; that
wording hides the vacuous passes and partial-failing crates.

### Finding: `bun_paths::component_iterator::tests::back_then_forward` fails

**Status:** This is a real bug, but NOT miri-found UB — the test fails under plain `cargo test` too.

```
running 1 test
test component_iterator::tests::back_then_forward ...
thread 'component_iterator::tests::back_then_forward' panicked at
  src/paths/component_iterator.rs:416:9:
  assertion `left == right` failed
    left:  [98]   (= b'b')
    right: [97]   (= b'a')
```

The test exercises `ComponentIterator::previous()` and `next()` on `/a/b/c`. After consuming the iterator forward to `c` via `last()`, it expects `previous()` to yield `b`, then `a`, then None. Then `next()` should yield `a`, `b` again.

The failure on line 416 is the assertion `it.next().unwrap().name == b"a"` returning `b"b"` instead. **The iterator's previous/next bidirectional logic appears off-by-one** — after walking all the way back past `a` and getting None, the forward step lands on `b` instead of `a`.

This finding is **not in the inventory** because the inventory is for `unsafe` sites; the bug is in safe code. But it's still an audit-quality concern — the test infrastructure for verifying soundness in this crate isn't passing. A miri run of `cargo test -p bun_paths` would technically pass the miri portion (the failure is an assertion, not UB) but the existing test suite is broken before miri can even attempt soundness verification.

**Recommended:** File as a separate non-unsafe bug bead for the maintainers, OR investigate whether the bidirectional `ComponentIterator` has a state-machine bug that could cascade into unsafe code further up the stack.

### Finding: `bun_base64::zig_base64::tests::test_base64_url_safe_no_pad` fails

**Status:** Another pre-existing broken test on main (fails under plain `cargo test`).

```
thread 'zig_base64::tests::test_base64_url_safe_no_pad' panicked at
  src/base64/lib.rs:885:22:
  called `Result::unwrap()` on an `Err` value: NoSpaceLeft
```

The test is calling base64 URL-safe-no-pad encode/decode and the buffer ran out of space. Either:
- The output buffer was sized too small for the test input
- An off-by-one in the URL-safe-no-pad encoder's length-calculation logic

Either way, the test should be passing on main. The audit notes this as a separate non-unsafe bug for the maintainers.

### `bun_collections` compile error

```
error[E0034]: multiple applicable items in scope
error[E0433]: failed to resolve: use of undeclared type
```

This is a pre-existing compile error in `bun_collections`'s test code (visible under `cargo +nightly check -p bun_collections --tests`). NOT a soundness finding — it's a test that doesn't compile, which means part of `bun_collections`'s test surface hasn't been exercised on nightly.

**Recommended:** File as a separate bug for the test code to be updated to nightly-compatible imports.

## What this verification log proves

- The audit's **strict-provenance compliance claim is real** for the 7 crates
  with actual tests that passed, plus useful but weaker evidence from the
  vacuous zero-test crates.
- The **latent-soundness bugs found via static analysis** are not yet miri-detectable because the existing tests don't construct the adversarial inputs (a `StoreSlice<Cell<u32>>` cross-thread send, or a `linux_errno::GetErrno for usize` call with `n >= 134`). The audit's C-003 and C-002 plans propose ADDING those tests; once added, miri would catch the bugs.
- The **vendor-deps blocker is workaroundable** for per-crate verification. Full-workspace miri still needs `bun bd` to fetch the real deps.
- **One unrelated broken test surfaced** (`bun_paths::component_iterator`) — file as a separate bead for the maintainers.

## What this verification log does NOT prove

- Full-workspace soundness. Per-crate miri isn't equivalent to whole-program miri.
- The (B) PERF_ONLY claims. Bench logs (hyperfine + criterion + flamegraph) are still needed before any (B) site is declared "PROVEN_HOT."
- That the existing SAFETY comments are correct. They were spot-checked but not exhaustively reviewed.

## What would close these gaps in a pass-3 audit

1. `bun bd` runs to fetch real vendor deps → workspace-wide cargo geiger baseline + `cargo expand` accounting → adds macro-generated unsafe to the inventory.
2. Property tests for `StoreSlice<Cell<u32>>` cross-thread + `linux_errno::GetErrno for usize` with `n=200` — both currently absent. Adding them under miri would surface the C-003 and C-002 latent UBs.
3. Workspace-wide miri smoke (run miri once across every miri-buildable crate; record the per-crate pass/fail/skip set).
4. Bench-driven verification of the B-PROVEN-HOT sites.
