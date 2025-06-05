const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;

// External C functions from NodeTraceEvents.cpp
extern "C" fn Bun__enableTraceEvents(categories: [*:0]const u8) void;
extern "C" fn Bun__disableTraceEvents() void;
extern "C" fn Bun__emitTraceEvent(name: [*:0]const u8, category: [*:0]const u8) void;

pub const NodeTraceEvents = struct {
    var enabled: bool = false;
    var categories: []const u8 = "";

    pub fn init() void {
        // Check if trace events were enabled via CLI
        if (bun.getenvZ("NODE_TRACE_EVENT_CATEGORIES")) |cats| {
            enable(cats);

            // Emit initial environment event
            emitEvent("Environment", "node.environment");
        }
    }

    pub fn enable(cats: []const u8) void {
        if (enabled) return;

        enabled = true;
        categories = cats;

        // Add null terminator for C function
        var buf: [4096]u8 = undefined;
        const len = @min(cats.len, buf.len - 1);
        @memcpy(buf[0..len], cats[0..len]);
        buf[len] = 0;

        Bun__enableTraceEvents(&buf);
    }

    pub fn disable() void {
        if (!enabled) return;

        enabled = false;
        Bun__disableTraceEvents();
    }

    pub fn emitEvent(name: []const u8, category: []const u8) void {
        if (!enabled) return;

        // Add null terminators for C functions
        var name_buf: [256]u8 = undefined;
        var cat_buf: [256]u8 = undefined;

        const name_len = @min(name.len, name_buf.len - 1);
        @memcpy(name_buf[0..name_len], name[0..name_len]);
        name_buf[name_len] = 0;

        const cat_len = @min(category.len, cat_buf.len - 1);
        @memcpy(cat_buf[0..cat_len], category[0..cat_len]);
        cat_buf[cat_len] = 0;

        Bun__emitTraceEvent(&name_buf, &cat_buf);
    }

    // Lifecycle event emitters
    pub fn emitRunAndClearNativeImmediates() void {
        emitEvent("RunAndClearNativeImmediates", "node.environment");
    }

    pub fn emitCheckImmediate() void {
        emitEvent("CheckImmediate", "node.environment");
    }

    pub fn emitRunTimers() void {
        emitEvent("RunTimers", "node.environment");
    }

    pub fn emitBeforeExit() void {
        emitEvent("BeforeExit", "node.environment");
    }

    pub fn emitRunCleanup() void {
        emitEvent("RunCleanup", "node.environment");
    }

    pub fn emitAtExit() void {
        emitEvent("AtExit", "node.environment");
        // Disable trace events at exit to ensure file is written
        disable();
    }
};
