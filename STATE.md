# Working notes (not for merge)

## stdio write callbacks
- PR https://github.com/oven-sh/bun/pull/45552 (draft). Commit 59d02f6044, base main 5866b5f13d. Status comment id 6219056413.
- Body: pr-body.md. Source: src/js/internal/fs/streams.ts +106/-22. Tests: process-stdio-write-callback.test.ts and its fixture, child-process-stdio.test.js, tty.test.ts. 103 tests in the 3 files, 56 fail on main.
- Checked on the final commit: debug build 103/103, release build 103/103, the 141-row Node contract table (review-table/) 0 rows fail, 13 of 16 clause mutants fail a test (mutate-release.py, mutate-run.sh), related suites and 238 vendored Node tests same as main.
- Draft until https://github.com/oven-sh/bun/pull/42031 is in. Then add the case: process.on('unhandledRejection', e => process.stderr.write(msg, () => process.exit(1))) exits 1 (probes/c-unhandled.js).
- Not run: Windows, macOS. On Windows the failing-pipe rows of child.stdin and the 'drain' once test are skipped.
- Other open PRs: #45002 (one test expectation changes when both are in), #44954, #45195, #45318 (textual conflicts only).
