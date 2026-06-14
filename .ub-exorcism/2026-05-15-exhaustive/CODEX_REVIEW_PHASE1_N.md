# Codex Review — Phase 1 Section N (`bun_core-foundation`)

Reviewed against current source on `claude/ub-exorcist-audit` / `origin/main`
baseline `4d443e5402`.

## Corrections Applied

1. **`bun_core::env_var` string cache is not a plain Relaxed publication bug.**
   The initial Section N artifact described the typed env-var cache as
   "Relaxed first-init publication" and suggested it should be Acquire/Release.
   Current source is more precise:

   - writer stores `ptr_value` with Relaxed at `src/bun_core/env_var.rs:357-358`
   - writer then stores `len_value` with Release at `:359`
   - reader loads `len_value` with Acquire at `:329`
   - reader only then loads `ptr_value` with Relaxed at `:339`

   That Release/Acquire edge publishes the prior pointer store when the reader
   observes the length. The artifact now treats this as a Phase-2 verification
   question, not an ordering defect.

2. **Boolean/u64 env-var caches do not publish separate pointee data.**
   Their Relaxed atomics store scalar values (`AtomicU8`/`AtomicU64`), so they
   should not be lumped into the pointer-publication concern.

3. **Top-level aggregate inherited a stale Section K claim.**
   While reviewing Section N I found `phase1_unsafe_surface_inventory.md` still
   saying Section K had 29 real `unsafe impl` lines and a missing Blob SAFETY
   comment. That contradicted the already-corrected detailed K files. The
   aggregate now says 23 actual `unsafe impl` lines and confirms Blob
   `ExternalSharedDescriptor` has SAFETY coverage.

## Remaining Phase-2 Questions

- Verify no `env_var::string::Cache` reader forms a slice without first
  acquiring `len_value`.
- Verify duplicate racing env-var cache writers publish identical envp-backed
  pointer/len pairs.
- Treat post-publication process environment mutation as outside the stated
  contract unless a concrete Bun call path mutates environment variables after
  caches are read.
