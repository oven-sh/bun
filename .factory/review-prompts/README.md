# Review lanes

The review swarm runs on the stock [`Factory-AI/droid-action`][droid-action]
rather than a hand-rolled `droid exec` pipeline. The action owns PR context
gathering, inline comment placement, the summary comment, dedup, and its own
internal candidate -> validate pass. We supply only two things on top:

1. **BYOK models** (z.ai GLM, Fireworks Kimi, MiniMax) via `~/.factory`.
2. **Review posture + per-lane focus**, injected with
   `--append-system-prompt-file` through the action's `droid_args` input. The
   action loads Factory's *bundled* `review` skill, not this repo's
   `.factory/skills`, so the Bun-fork UB posture has to be appended explicitly.

There is no custom poster, internal ledger, adversarial-critic step, or
synthesized-JSON stage anymore — the action posts its own findings directly.

## Files

- `.github/workflows/bun-ai-review-gh-hosted.yml` — always-on multi-model swarm.
  Each matrix lane is one `droid-action` review run pinned to a different model
  and focus. Edit the `matrix.lane` list to add, remove, or retune a lane.
- `.github/workflows/droid-tag.yml` — on-demand `@droid review` / `@droid
  security` / `@droid fill`. Security review lives here only, to keep per-PR
  noise down.
- `.factory/skills/review-guidelines/SKILL.md` — the standing review posture
  appended to every lane. Edit this to change the bar for all lanes at once.

## Lanes (bun-ai-review-gh-hosted.yml)

| id | model | single-angle focus |
|----|-------|--------------------|
| ub | GLM-5.1 | memory-safety / UB at the native boundary (stale ptr/len across async hop, whole-store-vs-view snapshot, lifetime/allocator) |
| source-route | GLM-5.1 | did the fix cover EVERY sibling path; are PR claims true |
| opposition | MiniMax M3 | argue the PR is wrong — one sharp objection, missing test, perf/portability |
| arch | MiniMax M3 | right fix at the right layer, smallest complete fix, no scope creep |
| tests | GLM-5.1 | do the tests actually PROVE the fix (fail on old, pass on new) |
| security | MiniMax M3 | STRIDE/OWASP security review (runs on every PR) — UB-as-exploit-primitive, input validation, info disclosure, DoS, crypto specifics when present |

Lane focuses are defined inline in the workflow's `matrix.lane` block (one source
of truth). Each lane is focused by **positive priming** — "this is your
specialty, go deeper here than a generalist" — so the angles are reliably
covered, but a lane that spots a serious defect outside its specialty still
reports it (we never tell a reviewer to suppress a real finding). Each inline
comment is prefixed with the lane id only — `[ub]`, `[security]`, etc. (the
review role; the model is the engine, not the lane). The completion comment
shows lane and model as separate lines (`Lane:` + `Model:`) via the action's
`review_label` + `completion_show_model` inputs.

[droid-action]: https://github.com/Factory-AI/droid-action
