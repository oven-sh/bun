---
allowed-tools: Bash(bun run regenerate-no-parallel:*), Bash(bun scripts/generate-no-parallel.ts:*), Bash(git diff:*), Bash(git status:*), Read
description: Regenerate test/no-parallel.txt (denylist for the CI parallel batch)
---

# Regenerate `test/no-parallel.txt`

`scripts/runner.node.mjs --parallel-batch` runs most test files in a single `bun test --parallel` invocation, then runs the rest one-per-process. `test/no-parallel.txt` is the **single source of truth** for which files must take the per-process path. The generator denylists a file when its path is under `napi/`, `v8/`, `ffi/`, or `webview/`; its basename contains `leak|stress|memory|heap|gc|rss`; or its body references GC/RSS/heap measurement (`expectMaxObjectTypeCount`, `Bun.gc(`, `heapStats`, `process.memoryUsage`, `Bun.WebView`, etc.). The runner itself adds nothing on top except the node-test tree, which runs via `bun run` rather than `bun test` and so structurally can't join the batch.

Do exactly this:

1. Run `bun run regenerate-no-parallel`.
2. `git diff -- test/no-parallel.txt` and summarise what changed (new files added, files removed because they no longer match, manual section preserved).
3. If the user named a specific test that should be excluded but the script didn't pick it up, append it under the `# manual` marker at the bottom of `test/no-parallel.txt` — entries there survive regeneration.
4. If the diff added or removed more than ~20 files, mention which content pattern in `scripts/generate-no-parallel.ts` is responsible so the user can sanity-check it.

Do not edit the auto-generated section by hand; change `CONTENT_PATTERNS` in `scripts/generate-no-parallel.ts` instead and re-run.
