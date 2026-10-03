State at the second self-review (module design):
- branch robobun/cd14648e/process-events-emitter, src at a5af856a09 (+ later test-only commits)
- design: methods in internal/events/prototype, lazy native prototype, Process::emit through process.emit,
  worker is_shutting_down line, bun test exit code (#41588 lines), exit callbacks for trace/quic
- dropped: bytecode root in the bundler (12 KB per executable, breaks two order-file tests)
- release binaries used for numbers: base 4b02e1031d, m2 = adeb164599 + root (runtime identical), f = a5af856a09
- pr-body.md is the body to use; fill nothing more

Update (third container):
- branch rebased on main bc7a813b10 and squashed: f22a13ad29 + 0490760d6d (termination taken after a runtime emit)
- found with node's test-worker-exit-from-uncaught-exception.js on the debug build (JSC assertion)
- still to do: node worker/process/child-process tests on the debug build (457 files), GC cells at first
  process access (needs a release build of the PR; system bun 367d939d9 is fine as base: creation unchanged),
  second self-review, open the PR

Update (fourth container), verification of 0490760d6d on the debug build:
- process.test.js 205 pass / 0 fail (USER=root, --timeout 180000), worker_threads.test.ts 155/0, event-emitter 106/0,
  process-signal-listener-count 11/0, call-constructor 2/0, trace-events 5/0
- bun-test.test.ts 98 pass / 1 fail: "Skipped and todo tests are filtered out when not matching -t filter" prints
  "[2.31s]" under load and its snapshot only strips "[..ms]" (not from this change)
- node tests on debug: 457 worker/process/child-process/signal/events files: 447 pass, 10 fail = the 8 that fail on
  release base too + 2 emfile tests (debug builds load internal modules from disk, EMFILE)
- earlier: 293 trace/quic/exit files: 288 pass after the termination fix
- measurements added to the body: GC cells, host functions, rt_sigaction
- second self-review run id 66f961832a57 (resumed once); after it: open the PR with final2/pr-body.md

Second self-review (run 66f961832a57, 97 agents, finished with container deaths): wanted-in-a-different-shape (0.87),
pr_disposition rework, disposition restructure.
- The need is real: main differs from node on 9 of 12 emitter-contract probes, the branch matches node on all and
  prints node's output for the #12918 programs.
- Only #12918 has a human reporter (label `confirmed bug`). It can be fixed in the native emit sites of today's
  emitter at no startup cost: open PR #32228 does that for 'exit' and 'beforeExit' (it has merge conflicts now).
- The other 19 behaviour changes and the deletion of the native emitter come from fuzz-found issues, flip 0 of 609
  node tests, have no maintainer's yes, and cost 10,486 -> 1,466,055 instructions at the first process.on() without
  node:events. `.claude/docs/landing-prs.md` ("the common case pays zero", "must not regress ANY measured case")
  does not allow that without an explicit exception.
- One 35-file PR is the wrong shape: take the process.emit routing now (#32228), land #41588 and #42032 on their
  own, and let a maintainer decide the emitter swap separately with the cost table. No finding says to drop the swap.
- Also raised: a Worker whose 'exit' listener throws ends with exit code 1 (node 0, #42032 does node's), conflicts
  with 12 of 14 open PRs on these files, never ran in CI, the Windows signal hooks were compiled but not run.

Action taken: no PR opened. The decision was put to the Slack thread with the cost table. The branch
robobun/cd14648e/process-events-emitter (0490760d6d) stays as the built swap. #41830 stays open as the
no-startup-cost repair of three ledger symptoms.
If a maintainer says yes to the swap: rebase the branch on main after #32228, #41588 and #42032 (drop the lines
they own), open the PR with final2/pr-body.md (update the numbers' commit), assign Jarred-Sumner.
If no: continue with native repairs (next: errorMonitor and the rest are in #41830; 'removeListener' event,
rawListeners wrappers, emit('error') with no listener, throw propagation are not covered by any open PR).
