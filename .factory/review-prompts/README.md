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

| id | model | focus |
|----|-------|-------|
| glm51-ub | GLM-5.1 | UB, stale pointer/length, worker handoff, lifetime/allocator |
| glm51-source-route | GLM-5.1 | source-route verification, sibling paths, claim discipline |
| kimi-opposition | Kimi K2.6 Turbo | strongest argument the PR is wrong, perf |
| minimax-architecture | MiniMax M3 | boundary placement, smallest complete fix |
| glm51-tests | GLM-5.1 | red/green proof, flakes, public-API coverage |

Lane focuses are defined inline in the workflow's `matrix.lane` block, so there
is a single source of truth and no drift between a prompt file and the lane that
runs it.

[droid-action]: https://github.com/Factory-AI/droid-action
