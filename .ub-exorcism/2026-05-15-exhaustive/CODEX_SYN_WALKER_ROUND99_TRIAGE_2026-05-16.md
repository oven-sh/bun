# Codex Syn-Walker Round 99 Triage — 2026-05-16

Scope: rerun the UB-exorcist skill's `syn-walkers` after the direct Bun-crate
EXP-080 / EXP-081 / EXP-072 witness upgrades. The first attempted invocation
used the README's local `target/release/...` path, but this environment builds
the skill binaries into the shared Cargo target directory at `/tmp/cargo-target`.
Those failed round-98 logs are retained as failed-invocation evidence only. This
round uses the correct binary paths.

## Commands

```bash
/tmp/cargo-target/release/data_races /data/projects/bun/src \
  > phase2_raw/codex_syn_data_races_round99_2026-05-16.log \
  2> phase2_raw/codex_syn_data_races_round99_2026-05-16.stderr

/tmp/cargo-target/release/transmute_pairs /data/projects/bun/src \
  > phase2_raw/codex_syn_transmute_pairs_round99_2026-05-16.jsonl \
  2> phase2_raw/codex_syn_transmute_pairs_round99_2026-05-16.stderr

/tmp/cargo-target/release/pin_walker /data/projects/bun/src \
  > phase2_raw/codex_syn_pin_round99_2026-05-16.log \
  2> phase2_raw/codex_syn_pin_round99_2026-05-16.stderr

/tmp/cargo-target/release/safety_doc_coverage /data/projects/bun/src \
  > phase2_raw/codex_syn_safety_doc_round99_2026-05-16.log \
  2> phase2_raw/codex_syn_safety_doc_round99_2026-05-16.stderr

/tmp/cargo-target/release/escape /data/projects/bun/src \
  > phase2_raw/codex_syn_escape_round99_2026-05-16.log \
  2> phase2_raw/codex_syn_escape_round99_2026-05-16.stderr

/tmp/cargo-target/release/aliasing /data/projects/bun/src \
  > phase2_raw/codex_syn_aliasing_round99_2026-05-16.log \
  2> phase2_raw/codex_syn_aliasing_round99_2026-05-16.stderr

/tmp/cargo-target/release/validity /data/projects/bun/src \
  > phase2_raw/codex_syn_validity_round99_2026-05-16.log \
  2> phase2_raw/codex_syn_validity_round99_2026-05-16.stderr
```

## Raw Results

| Walker | Exit | Raw signal | Triage verdict |
|---|---:|---:|---|
| `data_races` | 1 | 155 unsafe `Send` / `Sync` impl rows | Mapped to existing Send/Sync owners; no new EXP |
| `transmute_pairs` | 0 | 24 typed transmute rows | Mapped to existing EXP / hardening rows; no new EXP |
| `pin_walker` | 1 | 197 `mem::replace` rows, 0 `Pin::new_unchecked` rows | broad lint only; no Pin UB found |
| `safety_doc_coverage` | 1 | 2,565 missing/weak safety docs | documentation debt, not a UB verdict source |
| `escape` | 0 | 0 rows | clean |
| `aliasing` | 2 | scaffold only | not an implemented detector; see round-85 manual aliasing sweep |
| `validity` | 2 | scaffold only | not an implemented detector; validity is covered by ast-grep + manual sweeps |

## High-Signal Data-Race Mapping

The `data_races` walker is deliberately broad: it flags every manual unsafe
`Send` / `Sync` impl and uses a type-name heuristic for `Cell`-shaped types.
The high-signal rows are already owned:

| Source row | Existing owner | Current verdict |
|---|---|---|
| `src/ast/nodes.rs:339-340` `StoreSlice<T>` | EXP-019 | `CONFIRMED_UB` with direct `bun_ast` witness |
| `src/jsc/JSCell.rs:126-128` `JsCell<T>` | EXP-045 | `CONFIRMED_UB` with Miri data-race witness |
| `src/bun_core/util.rs:2276-2277` `RacyCell<T>` | EXP-047 | hardening / `NO_EVIDENCE` as project UB after safe-boundary correction |
| `src/bun_core/atomic_cell.rs:503-504` `ThreadCell<T>` | EXP-047 | hardening / `NO_EVIDENCE` as project UB after safe-boundary correction |
| `src/runtime/shell/IOWriter.rs:243-244` / `IOReader.rs:82-83` | EXP-083 | `CONFIRMED_UB` generic safe-API contract |
| `src/jsc/VirtualMachine.rs:611-612` | EXP-084 | `CONFIRMED_UB` safe TLS-backed off-thread trap |
| `src/bundler/BundleThread.rs:173` and `src/runtime/dns_jsc/dns.rs:107` `SendPtr<T>` | Phase-4 cluster B / Phase-8 hardening siblings | private or function-local wrappers; no safe public misuse witness found |

The remaining rows are bounded container impls, concrete FFI handles, or
previously reviewed hardening/doc items. Promoting them mechanically would
inflate the report; the defensible action is to keep them in the bounded-impl
hardening queue unless a concrete safe misuse path is proved.

## Transmute-Pair Mapping

The 24 typed transmute rows split cleanly:

| Source row(s) | Existing owner / verdict |
|---|---|
| `src/errno/linux_errno.rs:192` | EXP-002 `CONFIRMED_UB` |
| `src/errno/lib.rs:310`, `src/errno/windows_errno.rs:254` | EXP-097 `CONFIRMED_UB` |
| `src/bun_alloc/lib.rs:560` MutexGuard lifetime widening | EXP-059 `CONFIRMED_UB` as latent public-API hazard |
| `src/css/css_parser.rs:2718,2723` lifetime-to-`'static` widening | EXP-077 `CONFIRMED_UB` |
| `src/bundler/linker_context/scanImportsAndExports.rs:1682` `PropertyIdTag` | F-NF6-1 / EXP-064 vehicle; deferred checked-bit-pattern remediation |
| `src/libuv_sys/libuv.rs:292,623,989` | EXP-055 / F-P-14; `NO_EVIDENCE` / portability hardening after header and width checks |
| `src/sys/linux_syscall.rs:209` `rustix::fs::Stat` -> `libc::stat` | CODEX type-punning layout sweep; sound on x86_64/aarch64 after field-offset witness |
| FFI function-pointer casts (`boringssl_sys`, `AnyTask`, `DynLib::lookup`, WIC, fs_events, Tracy) | FFI hardening / typed trampoline queue; no current invalid-value or width proof |
| Lifetime-only widening (`BundleOptions`, `Renamer`, `StandaloneModuleGraph`) | already covered by lifetime-escape / worker-lifetime proof obligations where relevant |

No new `transmute_pairs` row justifies a fresh EXP today. The row that did
matter most, safe errno `from_raw`, was already promoted in round 83 as EXP-097.

## Pin Walker Calibration

The round-99 `pin_walker` output contains 197 `mem::replace` rows and **zero**
`Pin::new_unchecked` rows. A direct source `rg` also found no
`Pin::new_unchecked` in `src/**/*.rs`; the only textual `pin!` hits are
padding/layout assertions in `src/install/padding_checker.rs`, not `Pin`.

Verdict: no Pin UB promoted. Keep the `mem::replace` list as a lint backlog
only; without a pinned receiver or `!Unpin` proof, these rows are not evidence.

## Safety-Doc Walker Calibration

The `safety_doc_coverage` walker reports 2,565 missing or weak safety-comment
rows. That is useful documentation debt, not a UB detector by itself. Several
top files (`src/sys/lib.rs`, `src/runtime/jsc_hooks.rs`, `src/runtime/api/cron.rs`,
`src/runtime/dns_jsc/dns.rs`, `src/runtime/node/node_fs.rs`, `src/libuv_sys/libuv.rs`)
already have substantial source audits elsewhere in this workspace.

Do not add to the confirmed-UB count from safety-comment absence alone. Use
these rows to prioritize hardening only after the actual contract is inspected.

## Registry Impact

- New EXP entries: **0**
- Verdict changes: **0**
- Convergence checkpoint: `phase7_convergence_round_99.json` was quiet with
  `OPEN=0`, `NEEDS_REFINEMENT=0`, `CONFIRMED_UB=59`, `NO_EVIDENCE=15`,
  `DEFERRED=17`, `RESOLVED=2`. Later passes supersede this count; use
  `FINAL_UB_REPORT.md` for the current pinned-base totals.

This round is valuable precisely because it prevents embarrassment: a naive
report would quote 2,941 fresh raw walker hits. The defensible report says:
raw signal was rerun, every high-signal row was mapped to an existing owner or
hardening queue, and the registry did not inflate.
