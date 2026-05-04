#[repr(i32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ScriptExecutionStatus {
    Running = 0,
    Suspended = 1,
    Stopped = 2,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/ScriptExecutionStatus.zig (5 lines)
//   confidence: high
//   todos:      0
//   notes:      trivial #[repr(i32)] enum; mirrors JSC::ScriptExecutionStatus
// ──────────────────────────────────────────────────────────────────────────
