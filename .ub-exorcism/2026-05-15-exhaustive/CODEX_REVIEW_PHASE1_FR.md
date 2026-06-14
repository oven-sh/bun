# Codex Review — Phase 1 Sections F/R

Run: `2026-05-15-exhaustive`

Scope reviewed:
- `phase1_inventory_F.md`
- `phase1_notes/F_server_jsc_hooks.md`
- `phase1_inventory_R.md`
- `phase1_notes/R_parsers_lang.md`
- Related EXP entries in `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`

## Corrections applied

1. **EXP-012 reconciled with current source.**
   The named WebSocket client cancel path maps to
   `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:599-637` on current
   `origin/main`. It already uses `*mut Self`, `ThisPtr`, `ref_guard`, raw-place
   field access, and copies `tcp` out before `tcp.close()`. I changed EXP-012
   from an open `LIKELY-UB` bug to a resolved current-source watchpoint. The F
   inventory now says this resolves the named path only; it is not a blanket
   proof for all future close/cancel code.

2. **Semver EXP-008/009 reachability demoted to `NEEDS_REFINEMENT`.**
   `src/semver/lib.rs:536/537/613` still contain unchecked slices from packed
   `(off, len)`, so the UB primitive is real for a corrupted `String` handle.
   What is not yet proven in these artifacts is crafted binary-lockfile control
   of arbitrary packed `String` bytes. Text lockfile/package-manifest paths often
   reconstruct strings through `StringBuilder::append_with_hash`, which derives
   in-bounds pointers. Public wording now says Phase 3/5 must prove a raw
   binary-lockfile import path before claiming confirmed crafted-lockfile UB.

3. **Section R count language softened.**
   The R inventory is a highest-signal mapper output, not a 1:1 row for every
   site. I changed "all 826 sites are covered" language to mapper-local counts
   and told Phase 2 to re-normalize anything used for public headline math.

4. **Alignment cluster wording fixed.**
   The previous phrase "currently safe by chance" was not defensible. The R
   inventory now says the alignment sites need explicit proof or an unaligned-read
   refactor, with `pe.rs` TODOs as source evidence.

## Source checks run

- Verified zero `unsafe impl Send/Sync` declarations in Section F paths:
  `src/runtime/server`, `src/runtime/dispatch.rs`, `src/runtime/jsc_hooks.rs`,
  `src/runtime/ipc_host.rs`, `src/runtime/hw_exports.rs`.
- Re-read `WebSocketUpgradeClient::cancel` at lines 599-637 and confirmed the
  `*mut Self` / guard / raw-projection pattern.
- Re-read `RequestContext::as_response` at lines 310-323 and kept it as a
  caller-fragile watchpoint rather than a confirmed bug.
- Re-read `runtime/dispatch.rs:388-396` and `:455-463`; the artifact's
  `unreachable_unchecked` analysis is accurate.
- Re-read `semver/lib.rs:520-540`, `:586-616`, `:863-903`; source shape matches
  EXP-008/009, but reachability is still the missing proof.
- Re-ran Section R `get_unchecked` enumeration. The artifact's list matches the
  current source paths.

## Remaining review risk

Section F is mostly high-quality. Section R still needs Phase 3 to answer the
semver crafted-lockfile question and to produce alignment witnesses for the PE /
UTF-16 / Markdown reinterpretation cluster.
