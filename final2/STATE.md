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
