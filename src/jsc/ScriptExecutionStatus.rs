#[repr(i32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ScriptExecutionStatus {
    Running = 0,
    Suspended = 1,
    Stopped = 2,
}

// ported from: src/jsc/ScriptExecutionStatus.zig
