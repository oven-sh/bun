const std = @import("std");
const bun = @import("bun");

extern fn Bun__NodeTraceEvents__initialize(categories: [*:0]const u8, filePattern: ?[*:0]const u8) void;
extern fn Bun__NodeTraceEvents__isEnabled() bool;
extern fn Bun__NodeTraceEvents__emitEnvironmentEvent(name: [*:0]const u8) void;
extern fn Bun__NodeTraceEvents__shutdown() void;

pub const TraceEvents = struct {
    pub fn initialize(categories: ?[]const u8, file_pattern: ?[]const u8) void {
        if (categories) |cats| {
            const cat_str = bun.default_allocator.dupeZ(u8, cats) catch return;
            defer bun.default_allocator.free(cat_str);

            if (file_pattern) |pattern| {
                const pattern_str = bun.default_allocator.dupeZ(u8, pattern) catch return;
                defer bun.default_allocator.free(pattern_str);
                Bun__NodeTraceEvents__initialize(cat_str, pattern_str);
            } else {
                Bun__NodeTraceEvents__initialize(cat_str, null);
            }
        }
    }

    pub fn isEnabled() bool {
        return Bun__NodeTraceEvents__isEnabled();
    }

    pub fn emitEnvironmentEvent(name: []const u8) void {
        if (!isEnabled()) return;
        const name_str = bun.default_allocator.dupeZ(u8, name) catch return;
        defer bun.default_allocator.free(name_str);
        Bun__NodeTraceEvents__emitEnvironmentEvent(name_str);
    }

    pub fn shutdown() void {
        Bun__NodeTraceEvents__shutdown();
    }
};
