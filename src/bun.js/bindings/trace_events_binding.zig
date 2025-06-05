const std = @import("std");
const JSC = @import("bun").JSC;

// Extern declarations for C++ functions
extern fn Bun__TraceEvent__record(name: [*:0]const u8, category: [*:0]const u8) void;
extern fn Bun__TraceEvent__writeToFile() void;
extern fn Bun__TraceEvent__enable(categories: *const JSC.WTFStringImpl) void;

pub const TraceEventRecorder = struct {
    pub fn enable(categories: JSC.WTFStringImpl) void {
        Bun__TraceEvent__enable(&categories);
    }

    pub fn record(name: [:0]const u8, category: [:0]const u8) void {
        Bun__TraceEvent__record(name.ptr, category.ptr);
    }

    pub fn writeToFile() void {
        Bun__TraceEvent__writeToFile();
    }
};
