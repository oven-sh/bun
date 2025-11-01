/// Optional trace file for debugging watcher events
var trace_file: ?bun.sys.File = null;

/// Initialize trace file if BUN_WATCHER_TRACE env var is set.
/// Only checks once on first call.
pub fn init() void {
    if (trace_file != null) return;

    if (bun.env_var.BUN_WATCHER_TRACE.get()) |trace_path| {
        if (trace_path.len > 0) {
            const flags = bun.O.WRONLY | bun.O.CREAT | bun.O.APPEND;
            const mode = 0o644;
            switch (bun.sys.openA(trace_path, flags, mode)) {
                .result => |fd| {
                    trace_file = bun.sys.File{ .handle = fd };
                },
                .err => {
                    // Silently ignore errors opening trace file
                },
            }
        }
    }
}

/// Write trace events to the trace file if enabled.
/// This is called from the watcher thread, so no locking is needed.
/// Events are assumed to be already deduped by path.
pub fn writeEvents(watcher: *Watcher, events: []Watcher.WatchEvent, changed_files: []?[:0]u8) void {
    const file = trace_file orelse return;

    var buffer: [4096]u8 = undefined;
    var buffered = file.writer().adaptToNewApi(&buffer);
    defer buffered.new_interface.flush() catch |err| {
        bun.Output.err(err, "Failed to flush watcher trace file", .{});
    };
    const writer = &buffered.new_interface;

    // Get current timestamp
    const timestamp = std.time.milliTimestamp();

    // Write: { "timestamp": number, "files": { ... } }
    writer.writeAll("{\"timestamp\":") catch return;
    writer.print("{d}", .{timestamp}) catch return;
    writer.writeAll(",\"files\":{") catch return;

    const watchlist_slice = watcher.watchlist.slice();
    const file_paths = watchlist_slice.items(.file_path);

    var first_file = true;
    for (events) |event| {
        const file_path = if (event.index < file_paths.len) file_paths[event.index] else "(unknown)";
        const names = event.names(changed_files);

        if (!first_file) writer.writeAll(",") catch return;
        first_file = false;

        // Write path as key
        writer.print("{f}", .{bun.fmt.formatJSONStringUTF8(file_path, .{})}) catch return;
        writer.writeAll(":{\"events\":[") catch return;

        // Write array of event types using comptime reflection
        const fields = std.meta.fields(@TypeOf(event.op));
        var first = true;
        inline for (fields) |field| {
            // Only process bool fields (skip _padding and other non-bool fields)
            if (field.type == bool and @field(event.op, field.name)) {
                if (!first) writer.writeAll(",") catch return;
                writer.print("\"{s}\"", .{field.name}) catch return;
                first = false;
            }
        }
        writer.writeAll("]") catch return;

        // Only write "changed" field if there are changed files
        var has_changed = false;
        for (names) |name_opt| {
            if (name_opt != null) {
                has_changed = true;
                break;
            }
        }

        if (has_changed) {
            writer.writeAll(",\"changed\":[") catch return;
            first = true;
            for (names) |name_opt| {
                if (name_opt) |name| {
                    if (!first) writer.writeAll(",") catch return;
                    first = false;
                    writer.print("{f}", .{bun.fmt.formatJSONStringUTF8(name, .{})}) catch return;
                }
            }
            writer.writeAll("]") catch return;
        }

        writer.writeAll("}") catch return;
    }

    writer.writeAll("}}\n") catch return;
}

/// Close the trace file if open
pub fn deinit() void {
    if (trace_file) |file| {
        file.close();
        trace_file = null;
    }
}

const Watcher = @import("../Watcher.zig");
const bun = @import("bun");
const std = @import("std");
