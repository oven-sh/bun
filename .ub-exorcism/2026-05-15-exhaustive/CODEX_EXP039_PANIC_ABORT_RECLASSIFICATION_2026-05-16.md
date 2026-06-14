# EXP-039 Reclassification — `Listener.rs` Panic Window

Date: 2026-05-16

## Verdict

EXP-039 is **NO_EVIDENCE for current production UB** under Bun's configured
profiles. It remains a useful unwind-regression guard.

## What Was Correct

The standalone Miri witness is real for a `panic = "unwind"` model. If code
does:

```rust
let handlers_moved = ptr::read(&socket_config.handlers);
take_protos_that_panics();
mem::forget(socket_config);
```

then unwinding before `mem::forget` runs `Drop for SocketConfig`, which drops
the original `handlers` bytes after `handlers_moved` already owns the same
resources. The witness correctly demonstrates a double-drop / dangling `Box`
under that model.

## What Was Overstated

Two independent overclaims were present in the earlier artifacts.

1. **Production panic policy.** Bun's root `Cargo.toml` sets `panic = "abort"`
   for `dev`, `release`, release-derived profiles, and `shim`.
   `src/bun_core/lib.rs:2701-2707` and
   `src/crash_handler/lib.rs:1797-1804` explicitly document that panics abort
   before unwinding. The EXP-039 witness therefore does not describe a
   continuing production process under current supported profiles. This is the
   same rule already applied to EXP-038.

2. **Site count.** The earlier "4 sites" wording was too broad. Re-reading
   audited base `4d443e5402` and latest fetched `origin/main@e750984db6`
   shows only the two `listen()` sites have allocation-prone work before
   `mem::forget`:

   - `src/runtime/socket/Listener.rs:235`
   - `src/runtime/socket/Listener.rs:317`

   The connect-path sites (`:1069` and shifted `:1296`) do `ptr::read`, then
   `Option::take()`, then `mem::forget`. Their `take_protos()` calls happen
   later, after the source has been forgotten, so they do not share the same
   panic-window proof.

## Current Artifact Rule

Count EXP-039 as:

- `NO_EVIDENCE` for current production UB.
- A regression guard if Bun ever enables unwinding on these paths.
- A small two-site hardening candidate only if an unwind-enabled profile
  becomes supported.

Do **not** count it as a confirmed current-production UB witness, and do not
say four production sites share the exact `ptr::read -> take_protos ->
mem::forget` ordering.
