# Phase 2 — Bucket 24: Coherence-Violating Trait Impls

**Run:** 2026-05-15-exhaustive
**Bucket:** UB-TAXONOMY §24 — Coherence-Violating Trait Impls (`specialization`,
`min_specialization`, overlapping blanket impls, orphan-rule bypasses)
**Verdict:** **N/A — no exposure.** Bun does not enable
`feature(specialization)` or `feature(min_specialization)` anywhere in the
~200-crate workspace, and an explicit design note documents that the workspace
nightly *rejects* `min_specialization` so we cannot accidentally start using
it via a transitive `hashbrown/nightly` flip.

## What §24 looks for

Soundness defects that arise when two trait impls would both apply to the same
concrete type. The classic vectors are:

1. `#![feature(specialization)]` — full nightly specialization, unsound by
   construction (lifetime-dependent specialization is the canonical hole).
2. `#![feature(min_specialization)]` — the restricted variant; still risky if a
   `default impl` is added on top of a generic blanket and a downstream `impl`
   shadows it on a `Copy`/lifetime bound.
3. Overlapping blanket impls or `Send`/`Sync` impls authored to "win" against a
   library impl by exploiting orphan-rule loopholes.

For this bucket we treat any presence of (1) or (2) as a Phase-2 hit; (3) is
covered by Bucket 17/18 (`Send`/`Sync` audit) and is not re-counted here.

## Workspace sweep

Searched all Rust source under the workspace root (no `--type` filter omits
generated code; ripgrep visits every tracked `.rs`).

```text
$ rg -n 'feature\(specialization'  --type rust         # 0 hits
$ rg -n 'feature\(min_specialization' --type rust      # 0 hits in code
$ rg -n 'specialization|min_specialization|default impl|default fn' \
       --type rust | grep -v 'test/\|//'               # 0 hits
```

The only mention of `min_specialization` anywhere in the tree is a load-bearing
*explanatory comment* at `src/bun_alloc/hashbrown_bridge.rs:6` that explains why
Bun cannot turn on `hashbrown/nightly`:

> The obvious route — enable `hashbrown/nightly` so its `A` bound is the real
> `core::alloc::Allocator` — is closed: that feature also turns on
> `min_specialization` and specialises `RawTableClone` on `T: Copy`, which the
> workspace's pinned nightly rejects ("cannot specialize on trait `Copy`").

The bridge crate exists *specifically* to keep the `min_specialization` blast
radius out of Bun's dependency graph. That's a stronger guarantee than a
greenfield audit could give: even an upstream `hashbrown` bump cannot silently
pull specialization in, because the nightly Bun pins refuses to compile it.

`default impl` / `default fn` (the surface syntax those features unlock) also
returns zero hits anywhere in `src/`.

## Other unstable `#![feature(...)]` flags in use

For completeness — these are all *out of scope* for §24 (none enable
specialization-style coherence relaxation), but the sweep enumerated them so
Phase 2 can cite a closed list:

- `adt_const_params` (~14 crates) — enum-typed const generics
- `allocator_api` (~12 crates) — `A: Allocator` parameterized containers
- `generic_const_exprs` (`js_parser`, `shell_parser`)
- `inherent_associated_types` (`bundler`)
- `arbitrary_self_types_pointers`, `thread_local` (`bun_alloc`, `ast`, `jsc`)
- `core_intrinsics` (`crash_handler`)
- `hasher_prefixfree_extras` (`wyhash`)
- `macro_metavar_expr` (`bun_core` — `$$` in `define_scoped_log!`)

None of these are coherence-affecting. `adt_const_params` and
`generic_const_exprs` interact with the type system but cannot create
overlapping trait impls; the rest are pure capability flags.

## Phase 2 disposition

- **§24 count for Bun:** 0 sites.
- **No remediation needed.** Bucket may be marked closed for this run.
- **Drift guard already in place:** the `hashbrown_bridge` module's documented
  rationale + the pinned nightly's rejection of `min_specialization` together
  prevent regressions; no new lint or CI gate is required.

**Bucket 24: N/A — confirmed clean workspace-wide.**
