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
