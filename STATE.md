# Working notes (not for merge)

## stdio write callbacks
- PR https://github.com/oven-sh/bun/pull/45552 (draft). Commits 59d02f6044 (the change), 37deab7846 (fixture: cat reads the FIFO of a parked row), 37dfd77971 (comments to one line each), 0768ad3bde (cork rows, broken state), 87786a6cc4 (broken rows of child.stdin skipped on Windows). Base main 5866b5f13d. Status comment id 6219056413 (node id IC_kwDOFVKCyc8AAAABcq9FHQ).
- Body: pr-body.md. Status comment: status-comment.md. Source: src/js/internal/fs/streams.ts. Tests: process-stdio-write-callback.test.ts and its fixture, child-process-stdio.test.js, tty.test.ts. 114 tests in the 3 files, 64 fail on main (debug build with main's JS), 65 with the release build of main.
- A bot flags every run of 2 or more added comment lines in src/ (.github/workflows/comment-cop.yml). comment-cop-local.py runs the same rule on `git diff origin/main -- src/`. Keep each added comment to one line.
- Checked on 0768ad3bde: debug build 114/114, with the CI ASAN lane environment (asan-env.sh) 114/114, release build 114/114 three times. Fixture table (all-rows.mjs, cmp2.mjs): 111 rows, Node against the PR 99 identical, 12 namesOnly rows differ, main differs in 78.
- Mutants (mutate-release.py, mutate-run.sh, MUT_BASE = a release build of the branch): 16 clauses, 15 fail a test. Survivor: keep-settled-run. Its effect is a stale EPIPE for a later write on process.stdout after a run failed (probes/stdout-late.js). No Node-equal row can cover it (#41568).
- The cork rows exist for settled-error-sync and error-always: probes/stdout-cork.js, probes/stdin-cork.js, probes/stdout-broken-first.js show the difference.
- CI on 0768ad3bde (build 126783): the two child.stdin rows of the broken state timed out after 90 s on Windows 2019 x64 and Windows 11 aarch64, all 4 attempts, no output from the child. Every other test of the file passed there (35 pass). 87786a6cc4 skips those two rows on Windows. Cause not found: no Windows machine. Other reds in that build were flaky tests in files this PR does not touch.
- No `ci: retrigger` commit was pushed so far.
- Draft until https://github.com/oven-sh/bun/pull/42031 is in. Then add the case: process.on('unhandledRejection', e => process.stderr.write(msg, () => process.exit(1))) exits 1 (probes/c-unhandled.js).
- Other open PRs: #45002 (one test expectation changes when both are in), #44954, #45195, #45318 (textual conflicts only).

## 2026-10-16 evening: the PR is on hold
- #45319 (dylan-conway, open since 2026-10-15, not in my earlier list): FileSink `write_empty` + one 'drain' per promise. Verified on a debug build of main + #45319: the repro prints 1,2,3 and the exit idiom delivers 1048576 bytes. It conflicts with this branch in src/js/internal/fs/streams.ts.
- Confirmed regressions of this branch (release build of its src), probes in probes/round3/:
  - headpipe.js once-end piped into `head -c 1`: 'error' twice, `.once` crashes (main, node: once). Two reporters of one sink failure: settleFastRun and the flush promise of _final. destroy + _undestroy between them resets errorEmitted.
  - window.js: prints A (main, node: ABC). The `state.length > 0` guard holds later writes in Writable, process.exit() drops them.
  - lost-end.js with stdout to a file: the end() callback never runs.
  - marker-leak.js: a replaced _write sees zero-length chunks.
  - fake-nexttick*.js: same as node, differs from main (callbacks need a real nextTick).
- Candidate repairs seen as binary patches (probes/round3/mutate2.py, alt.py): guard `state.length > state.writelen` (all 114 tests still pass), sync completion of an accepted real chunk in _write plus _final on a tick (114 pass), _final's promise and a real chunk's promise join the run.
- Variant B (one line on top of #45319: `if (cb !== streamNoop) process.nextTick(cb, null)` in writeFast's accepted arm): fixture table 67 of 111 rows equal node (main 33, main + #45319 44, this branch 99). Still different: failing and broken rows (error order), cork, Writable.prototype.write then write() on an unconstructed child.stdin, throw from a held write's callback, tick grouping. My test file: 68 pass, 24 fail.
- Local only branches: scratch/pr45319-on-main (main + the two commits of #45319), scratch/pr45319-tick (variant B). Binaries: /tmp/bins/pr45319/bun-debug with JS dirs /tmp/js-pr45319 and /tmp/js-pr45319-tick (run with /tmp/my-in.sh <js-dir> <binary> ...).
- The third self-review run was suspended by mistake while it still worked. Its verdict is lost: a resume needs the exact args of the first launch, and they are not known. Do not suspend a run because its status line looks stale.
- PR body and status comment say: on hold, do not merge. Next: a design review with this evidence, then build what it picks (repaired marker, variant B, or nothing until #45319 and #42031 are in). The choice of direction belongs to the maintainers.
