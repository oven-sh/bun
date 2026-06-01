# Review lane prompts

Lane focuses are defined inline in the workflow, not as separate prompt files,
so there is a single source of truth and no drift between a prompt file and the
lane that runs it.

See `.github/workflows/bun-ai-review-gh-hosted.yml`:

- the `lanes.json` heredoc lists every lane `id`, `model`, and `focus`
- the shared per-lane preamble (read-only mode, standards, required finding
  fields) is the `PROMPT` heredoc in the "Run review lanes concurrently" step

To add, remove, or retune a lane, edit `lanes.json` in that workflow. To change
the standing review posture for every lane, edit
`.factory/skills/review-guidelines/SKILL.md`.

## Lanes

| id | model | focus |
|----|-------|-------|
| glm51-ub | GLM-5.1 | UB, stale pointer/length, worker handoff, JS-backed memory, allocator/lifetime/refcount |
| glm51-tests | GLM-5.1 | red/green proof, ASAN evidence, deterministic repros |
| glm47-source-route | GLM-4.7 | source-route verification, sibling paths |
| glm47-compat | GLM-4.7 | Node/Web API compatibility, observable behavior |
| glm47-claims | GLM-4.7 | claim verification, overclaim/underclaim |
| kimi-opposition | Kimi K2.6 Turbo | strongest argument the PR is wrong |
| kimi-perf | Kimi K2.6 Turbo | performance, allocations, hot-path cost |
| kimi-pr-body | Kimi K2.6 Turbo | reviewer-cost, PR body, verification map |
| minimax-architecture | MiniMax M3 | boundary placement, helper extraction, missed siblings |
| minimax-tests | MiniMax M3 | test design, flakes, stress vs normal CI |
| minimax-simplicity | MiniMax M3 | smallest complete fix, no scope creep |

Synthesis is a single GLM-5.1 pass over the internal ledger (all lane outputs).
