State at the second self-review (module design):
- branch robobun/cd14648e/process-events-emitter, src at a5af856a09 (+ later test-only commits)
- design: methods in internal/events/prototype, lazy native prototype, Process::emit through process.emit,
  worker is_shutting_down line, bun test exit code (#41588 lines), exit callbacks for trace/quic
- dropped: bytecode root in the bundler (12 KB per executable, breaks two order-file tests)
- release binaries used for numbers: base 4b02e1031d, m2 = adeb164599 + root (runtime identical), f = a5af856a09
- pr-body.md is the body to use; fill nothing more
