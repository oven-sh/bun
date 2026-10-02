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
