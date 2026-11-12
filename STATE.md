# State on 2026-11-12 ~18:40Z (PR oven-sh/bun#37171, branch farm/f00c9907/child-stdio-data-throw-uncaught)
- Work branch (not yet pushed to the PR): origin/robobun/f00c9907/arm-wip @ 9b4d6ad7497 (adds self-ending guards to the repl test scripts). PR body draft: measure/body-full.md (visible part 246 words). Self-review run fba84f8b169a launched 18:45Z, still running at 20:10Z.
- Design: FileReader read callback (handle mode). This session changed two things on top of the implementation run:
  1. Lifetime as on main: the reader is unref'd until the stream's first _read(); what it reads before waits in kUnread (native-readable.ts).
  2. After a callback throw the source waits for the loop's next turn (yield task). VirtualMachine.rs / Task.rs / repl.rs changes removed.
- Verified on debug: fixtures in fx/, fx2/, fx3/; child_process.test.ts (2 debug-only pre-existing failures: ">10240 fds" and "extra stdio pipes are not double-closed on GC" timeout), spawn-stdio-syscall-error, node-stream, repl all pass. `bun run rust:check-all`: 12 ok.
- Measurements: measure/RESULTS.md (release main 447ff870b60 vs 8ad649dafc8).
- Next: self-review (pushback) result, address concerns, merge origin/main, fast-forward push to the PR branch (never force), retitle, new body (measure/body-visible.md is the draft, must be <= 250 words), status comment 5951296651, thread PRRT_kwDOFVKCyc6omVBr, gh pr ready, Slack summary.
