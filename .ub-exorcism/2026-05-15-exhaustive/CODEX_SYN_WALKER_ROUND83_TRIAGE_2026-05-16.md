# Codex Syn-Walker Round-83 Triage — 2026-05-16

Scope: run the UB-exorcist skill's implemented `syn-walkers` after the
round-82 ast-grep sweep. Raw outputs live under `phase2_raw/`.

## Raw Outputs

| Walker | Output | Hits | Triage |
|---|---|---:|---|
| `data_races` | `phase2_raw/codex_syn_data_races_round83_2026-05-16.log` | 155 | Manual `unsafe impl Send/Sync` inventory. Existing owners cover the high-risk generic/safe-API defects: EXP-019, EXP-045, EXP-080, EXP-082, EXP-083, EXP-084; EXP-047 is now hardening-only after the later safe-boundary correction. No unregistered Send/Sync EXP promoted from this pass. |
| `escape` | `phase2_raw/codex_syn_escape_round83_2026-05-16.log` | 0 | No function shape of "takes reference and returns raw pointer" matched this walker. |
| `pin_walker` | `phase2_raw/codex_syn_pin_round83_2026-05-16.log` | 197 | All reported hits are `mem::replace`, not `Pin::new_unchecked`. The walker is intentionally broad; no `Pin`-specific UB was promoted. |
| `transmute_pairs` | `phase2_raw/codex_syn_transmute_pairs_round83_2026-05-16.jsonl` | 24 | Reconfirmed Bucket-6 coverage and surfaced one under-promoted issue: safe errno `from_raw` helpers. Promoted as EXP-097. |
| `safety_doc_coverage` | `phase2_raw/codex_syn_safety_doc_round83_2026-05-16.log` | 2,565 | Documentation-hardening backlog only. Missing/weak SAFETY comments are not UB by themselves; promote only when paired with a concrete contract defect. |

## Promoted Finding

### EXP-097 — safe errno `from_raw` helpers

`src/errno/windows_errno.rs:248-255` and `src/errno/lib.rs:303-310` were
already listed in Bucket 6 as weak/caller-contract transmutes, but the prior
wording was too soft and partly wrong:

- `E::from_raw` is a safe `pub const fn`, not an `unsafe fn`.
- `SystemErrno::from_raw` is also a safe `pub const fn`.
- The functions contain unchecked `transmute::<u16, E/SystemErrno>`.
- `E::from_raw` uses only a `debug_assert!(from_repr(n).is_some())`, which is
  compiled out in release builds.
- `SystemErrno::from_raw` has no Windows validity check at all.

The corrected judgment is: this is a safe-API contract defect. Safe Rust can
call `from_raw(138)` / another undeclared discriminant and construct an invalid
enum value.

Reproducer:

- `experiments/EXP-097/src/main.rs`
- `phase5_experiment_results/EXP-097.log`
- `experiments/EXP-097-bun-errno-crate/src/main.rs`
- `phase5_experiment_results/EXP-097-bun-errno-crate.log`

The direct Bun-crate witness depends on `bun_errno` by path and calls
`bun_errno::SystemErrno::from_raw(138)` from safe Rust. Miri reports the
invalid enum tag at `/data/projects/bun/src/errno/lib.rs:310`, inside Bun's
actual `SystemErrno::from_raw`, not just in the mirror.

Signal:

```text
error: Undefined Behavior: constructing invalid value of type SparseErrno:
at .<enum-tag>, encountered 0x008a, but expected a valid enum tag
  --> src/main.rs:25:18
```

This is distinct from EXP-002. EXP-002 covers the Linux raw-syscall return
decoder that reaches an invalid errno transmute. EXP-097 covers the safe
`from_raw` API family itself.

## Non-Promotions

- `StoreRef<T>` is already bounded (`T: Send` / `T: Sync`) and is not the same
  auto-trait defect as EXP-019's unbounded `StoreSlice<T>`.
- Private/function-local `SendPtr<T>` wrappers remain hardening-only unless a
  caller can construct a bad payload through safe API. Existing rows F-S-2 /
  F-S-3 / F-S-31 cover that distinction.
- `ThreadCell<T>` / `RacyCell<T>` remain covered by EXP-047, but later
  safe-boundary review corrected that entry to hardening / `NO_EVIDENCE` as
  project UB; this pass did not prove a production payload race.
- The `pin_walker` output is mostly `mem::replace` over ordinary values. No
  `Pin::new_unchecked` / move-after-pin evidence surfaced.
- SAFETY-comment coverage is useful for a hardening PR but does not change the
  UB count.

## Artifact Changes From This Triage

- Added EXP-097 with a release-mode Miri witness.
- Corrected `phase2_findings_06_type_punning.md` so errno `from_raw` sites are
  counted as safe-API UB, not weak caller-contract sites.
- Corrected `phase2_findings_04_validity.md` where it incorrectly described
  `windows_errno.rs:254` as an unsafe-function caller contract.
- Added F-NF6-4 to the unified findings table.
