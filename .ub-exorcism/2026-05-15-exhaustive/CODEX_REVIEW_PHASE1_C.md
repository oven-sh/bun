# Codex Review — Phase 1 Section C (`runtime-cli`)

Reviewed against current source on `claude/ub-exorcist-audit` / `origin/main`
baseline `4d443e5402`.

## Correction Applied

The detailed Section C body correctly says the `fmt::Raw` UTF-8 primitive is
owned by Section N and has **no current `src/runtime/cli/` caller**. The section
heading still said "reachable from argv", which was too strong. It now says the
anchor is not currently reachable from Section C.

Current defensible wording:

- `src/bun_core/fmt.rs:725-732` remains the unsafe primitive.
- CLI argv bytes are currently byte-compared, copied, or displayed through
  `bstr::BStr::new`, not through `fmt::raw` / `fmt::s`.
- The Phase-2 action is a CI/lint guard against future `fmt::Raw` use on
  argv-origin bytes, not a current live CLI UB claim.
