const bun = @import("bun");

/// Safe handle to a JavaScript execution environment that may have exited.
/// Obtain with global_object.scriptExecutionContextIdentifier()
pub const Identifier = enum(bun.c.WebCore__ScriptExecutionContextIdentifier) {
    _,

    /// Returns null if the context referred to by `self` no longer exists
    pub fn globalObject(self: Identifier) ?*bun.jsc.JSGlobalObject {
        return @ptrCast(bun.c.ScriptExecutionContextIdentifier__getGlobalObject(@intFromEnum(self)));
    }

    /// Returns null if the context referred to by `self` no longer exists
    pub fn bunVM(self: Identifier) ?*bun.jsc.VirtualMachine {
        // concurrently because we expect these identifiers are mostly used by off-thread tasks
        return (self.globalObject() orelse return null).bunVMConcurrently();
    }
};
