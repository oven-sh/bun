const std = @import("std");
const bun = @import("../bun.zig");
const Watcher = @import("../Watcher.zig");

/// Optional trace file for debugging watcher events
var trace_file: ?bun.sys.File = null;

/// Initialize trace file if BUN_WATCHER_TRACE env var is set.
/// Only checks once on first call.
pub fn init() void {
    if (trace_file != null) return;

    if (bun.getenvZ("BUN_WATCHER_TRACE")) |trace_path| {
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
pub fn writeEvents(watcher: *Watcher, events: []Watcher.WatchEvent, changed_files: []?[:0]u8) void {
    const file = trace_file orelse return;

    var buffered = std.io.bufferedWriter(file.writer());
    defer buffered.flush() catch {};
    const writer = buffered.writer();

    // Get current timestamp
    const timestamp = std.time.milliTimestamp();

    for (events) |event| {
        const watchlist_slice = watcher.watchlist.slice();
        const file_paths = watchlist_slice.items(.file_path);
        const file_path = if (event.index < file_paths.len) file_paths[event.index] else "(unknown)";

        // Build array of operation types
        const names = event.names(changed_files);

        // Write JSON for each event
        writer.writeAll("{\"timestamp\":") catch continue;
        writer.print("{d}", .{timestamp}) catch continue;
        writer.writeAll(",\"index\":") catch continue;
        writer.print("{d}", .{event.index}) catch continue;
        writer.writeAll(",\"path\":") catch continue;
        writer.print("{}", .{bun.fmt.formatJSONStringUTF8(file_path, .{})}) catch continue;
        writer.writeAll(",\"events\":[") catch continue;

        // Write array of event types that occurred
        var first = true;
        if (event.op.delete) {
            if (!first) writer.writeAll(",") catch continue;
            writer.writeAll("\"delete\"") catch continue;
            first = false;
        }
        if (event.op.write) {
            if (!first) writer.writeAll(",") catch continue;
            writer.writeAll("\"write\"") catch continue;
            first = false;
        }
        if (event.op.rename) {
            if (!first) writer.writeAll(",") catch continue;
            writer.writeAll("\"rename\"") catch continue;
            first = false;
        }
        if (event.op.metadata) {
            if (!first) writer.writeAll(",") catch continue;
            writer.writeAll("\"metadata\"") catch continue;
            first = false;
        }
        if (event.op.move_to) {
            if (!first) writer.writeAll(",") catch continue;
            writer.writeAll("\"move_to\"") catch continue;
            first = false;
        }

        writer.writeAll("],\"changed_files\":[") catch continue;
        first = true;
        for (names) |name_opt| {
            if (name_opt) |name| {
                if (!first) writer.writeAll(",") catch continue;
                first = false;
                writer.print("{}", .{bun.fmt.formatJSONStringUTF8(name, .{})}) catch continue;
            }
        }
        writer.writeAll("]}\n") catch continue;
    }
}

/// Close the trace file if open
pub fn deinit() void {
    if (trace_file) |file| {
        file.close();
        trace_file = null;
    }
}
