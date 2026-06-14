# Phase 11 SOAK — execution log

Run `2026-05-15-exhaustive`. Started 2026-05-16. This log captures the **actual campaign dispatches** as opposed to `phase11_soak_designs.md` which captured the plans.

## Campaign L (Layout asserts) — IN FLIGHT (local agent)

Agent authoring `windows_sys.rs`, `boringssl_sys.rs`, `handle_type_enum.rs` PoCs alongside the existing `napi.rs` PoC at `experiments/layout_asserts/`. Smoke-compile via `experiments/layout_asserts_smoke/`.

## Campaign 3.x (Fuzz authoring) — IN FLIGHT (local agent)

Agent authoring 3 fuzz targets at `.ub-exorcism/2026-05-15-exhaustive/fuzz/`:
- `lockfile_sparse_enum_fuzz` (validates EXP-003/006/036/020 cluster)
- `standalone_module_graph_fuzz` (validates EXP-035)
- `semver_string_fuzz` (validates EXP-008/009)

Each will run `cargo +nightly fuzz run <target> -- -max_total_time=300` for 5-minute campaigns. Crashes triaged under Miri.

## Campaign C1 (Miri matrix) + C2 (Sanitizers) — DISPATCHED to worker-b

**Host:** `<user>@<worker-b-host-redacted>` (worker-b worker, `bun,go,rust` tagged)
**Pre-flight verified:** clang-21 ✓, lld-21 ✓, miri ✓, rust-src ✓, ninja ✓, 214GB free disk, 31GB RAM

**Dispatch script:** `/tmp/bun_soak_dispatch.sh` (uploaded; chmod +x)
**Master log on worker:** `/tmp/bun_soak_master.log`
**Per-campaign logs on worker:** `/home/ubuntu/bun-ub-soak/logs/<tag>.log`
**Per-campaign PIDs:** `/home/ubuntu/bun-ub-soak/logs/<tag>.pid`

**Dispatched campaigns (6 total)**:

| Tag | MIRIFLAGS / RUSTFLAGS | Expected wall-time |
|-----|----------------------|---------------------|
| `miri-sb` | (default Stacked Borrows) | 24-72h |
| `miri-tb` | `-Zmiri-tree-borrows` | 24-72h |
| `miri-sp` | `-Zmiri-strict-provenance` | 24-72h |
| `miri-sa` | `-Zmiri-symbolic-alignment-check` | 24-72h |
| `san-address` | `-Zsanitizer=address` | 1-2h |
| `san-thread` | `-Zsanitizer=thread` (with `--test-threads=1`) | 1-2h |

**Worker setup performed**:
1. `git clone --depth 200 --branch main https://github.com/oven-sh/bun.git bun`
2. `git checkout --detach 4d443e5402` (audited-base main commit this run targets; worker clone only)
3. `bun bd --configure-only`
4. Bootstrap `vendor/lolhtml` at pinned commit `77127cd2b8545998756e8d64e36ee2313c4bb312`
5. `ninja -C build/debug codegen/{cpp.rs,generated_classes.rs,generated_host_exports.rs,generated_js2native.rs,generated_jssink.rs}`
6. `cargo check --workspace` sanity verify
7. Dispatch 4 Miri configs + 2 sanitizers via `nohup bash -c '...' &`

**Check-back command** (run from local):
```bash
ssh -i <your-ssh-key>.pem <user>@<worker-b-host-redacted> 'for p in /home/ubuntu/bun-ub-soak/logs/*.pid; do
  tag=$(basename $p .pid)
  pid=$(cat $p)
  if kill -0 $pid 2>/dev/null; then
    echo "$tag: RUNNING (pid $pid; log line count: $(wc -l < /home/ubuntu/bun-ub-soak/logs/$tag.log))"
  else
    echo "$tag: DONE"
  fi
done'
```

**Pull results back** (when campaigns finish):
```bash
rsync -avz -e "ssh -i <your-ssh-key>.pem" \
  <user>@<worker-b-host-redacted>:/home/ubuntu/bun-ub-soak/logs/ \
  /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase11_artifacts/soak-results/
```

## Campaign C4 (Loom) — COMPLETED earlier

3 Loom models authored in Phase 5 Tier-1:
- `experiments/EXP-030/` ThreadPool::Queue 1P+2C: NO_EVIDENCE (negative control catches Relaxed)
- `experiments/EXP-031/` WatcherAtomics 2-slot: NO_EVIDENCE (AcqRel sufficient)
- `experiments/EXP-032/` WebWorker Cell cross-thread: NO_EVIDENCE at memory-model layer
1 additional in Tier-3:
- `experiments/EXP-052/` UnboundedQueue MPSC 2P/1C: NO_EVIDENCE both AcqRel + Relaxed pass (regression guard on file)

## Campaign C5 (Shuttle) — DEFERRED

None of the loom models blew up; shuttle complement not needed yet. Re-evaluate if EXP-030..032 expand past 3 threads.

## Local cargo +nightly miri test --workspace (B4 probe)

Ran against current local tree (post-codegen + vendor-bootstrap). Reached `bun_base64` before stopping on:
**Incidental finding I-6**: `bun_base64::zig_base64::tests::test_base64_url_safe_no_pad` panics under Miri with `Result::unwrap() on Err(NoSpaceLeft)` at `src/base64/lib.rs:885:22` — buffer-sizing logic bug (not strict UB). Re-running with `--no-fail-fast` to get full coverage.

Verified passing under local Miri (before halt):
- `bun_alloc` lib tests
- `bun_ast` lib tests (5 passed)
- `bun_ast_jsc` lib tests
- `bun_base64::test_base64` (1 passed)
- earlier Path-(b) confirmations: `bun_threading`, `bun_semver`, `bun_safety` (lib tests)

## Soft blockers documented for follow-up

1. ~~clang-21+lld-21 install on worker-b~~ (resolved — already installed)
2. `bun bd --configure-only` caching strategy per worker — fresh clone re-runs configure (~30s overhead per Miri config). Acceptable for 24-72h campaigns.
3. rch classifier extension for `miri test` / `fuzz run` — workaround: direct ssh + nohup (used here)
4. `napi_type_tag` field visibility bump for layout-assert PoC (Campaign L)

## Status snapshot (will be updated as campaigns finish)

| Campaign | State | First-result expected |
|----------|-------|----------------------|
| L | local agent in flight | 60min |
| 3.x | local agent in flight (3x300s fuzz) | 25min |
| C1 (Miri ×4) | dispatched to worker-b; `bun_soak_master.log` IN PROGRESS | 24h+ |
| C2 (Sanitizers ×2) | dispatched to worker-b; same | 1-2h |
| C4 (Loom) | completed | done |
| C5 (Shuttle) | not needed | n/a |
| B4 (local Miri workspace) | re-run with --no-fail-fast in flight | 30min |
