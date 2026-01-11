/// Zig bindings for JSC::VMManager
///
/// VMManager coordinates multiple VMs (workers) and provides the StopTheWorld
/// mechanism for safely interrupting JavaScript execution at safe points.
///
/// Note: StopReason values are bitmasks (1 << bit_position), not sequential.
/// This matches the C++ enum in VMManager.h which uses:
///   enum class StopReason : StopRequestBits { None = 0, GC = 1, WasmDebugger = 2, MemoryDebugger = 4, JSDebugger = 8 }
pub const StopReason = enum(u32) {
    None = 0,
    GC = 1 << 0, // 1
    WasmDebugger = 1 << 1, // 2
    MemoryDebugger = 1 << 2, // 4
    JSDebugger = 1 << 3, // 8
};

extern fn VMManager__requestStopAll(reason: StopReason) void;
extern fn VMManager__requestResumeAll(reason: StopReason) void;

/// Request all VMs to stop at their next safe point.
/// The registered StopTheWorld callback for the given reason will be called
/// on the main thread once all VMs have stopped.
pub fn requestStopAll(reason: StopReason) void {
    VMManager__requestStopAll(reason);
}

/// Clear the pending stop request for the given reason.
/// This resumes VMs that were stopped and clears the trap.
pub fn requestResumeAll(reason: StopReason) void {
    VMManager__requestResumeAll(reason);
}
