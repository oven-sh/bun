---
allowed-tools: Bash(bun run regenerate-no-parallel:*), Bash(bun scripts/generate-no-parallel.ts:*), Bash(git diff:*), Bash(git status:*), Read
description: Regenerate test/no-parallel.txt (denylist for the CI parallel batch)
---

# Regenerate `test/no-parallel.txt`

`scripts/runner.node.mjs --parallel-batch` runs most test files in a single `bun test --parallel` invocation, then runs the rest one-per-process. `test/no-parallel.txt` is the explicit denylist for files whose **contents** make them unsafe to share a machine with other workers (GC counting, RSS measurement, heap snapshots, `Bun.WebView`, etc.). Path-based excludes — `napi/`, `v8/`, `ffi/`, `webview/`, the node-test tree, and any basename containing `leak|stress|memory|heap|gc|rss` — are applied in the runner directly and are **not** listed in the file.

Do exactly this:

1. Run `bun run regenerate-no-parallel`.
2. `git diff -- test/no-parallel.txt` and summarise what changed (new files added, files removed because they no longer match, manual section preserved).
3. If the user named a specific test that should be excluded but the script didn't pick it up, append it under the `# manual` marker at the bottom of `test/no-parallel.txt` — entries there survive regeneration.
4. If the diff added or removed more than ~20 files, mention which content pattern in `scripts/generate-no-parallel.ts` is responsible so the user can sanity-check it.

Do not edit the auto-generated section by hand; change `CONTENT_PATTERNS` in `scripts/generate-no-parallel.ts` instead and re-run.
