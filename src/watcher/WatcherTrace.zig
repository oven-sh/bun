/// Optional trace file for debugging watcher events
var trace_file: ?bun.FileDescriptor = null;

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
                    trace_file = fd;
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
    const fd = trace_file orelse return;

    var buf: [16384]u8 = undefined;
    var stream = std.io.fixedBufferStream(&buf);
    const writer = stream.writer();

    // Get current timestamp
    const timestamp = std.time.milliTimestamp();

    for (events) |event| {
        stream.reset();

        const watchlist_slice = watcher.watchlist.slice();
        const file_paths = watchlist_slice.items(.file_path);
        const file_path = if (event.index < file_paths.len) file_paths[event.index] else "(unknown)";

        // Write JSON manually for each event
        writer.writeAll("{\"timestamp\":") catch return;
        writer.print("{d}", .{timestamp}) catch return;
        writer.writeAll(",\"index\":") catch return;
        writer.print("{d}", .{event.index}) catch return;
        writer.writeAll(",\"path\":\"") catch return;

        // Escape quotes and backslashes in path
        for (file_path) |c| {
            if (c == '"' or c == '\\') {
                writer.writeByte('\\') catch return;
            }
            writer.writeByte(c) catch return;
        }
        writer.writeAll("\"") catch return;

        // Write individual operation flags
        writer.writeAll(",\"delete\":") catch return;
        writer.writeAll(if (event.op.delete) "true" else "false") catch return;
        writer.writeAll(",\"write\":") catch return;
        writer.writeAll(if (event.op.write) "true" else "false") catch return;
        writer.writeAll(",\"rename\":") catch return;
        writer.writeAll(if (event.op.rename) "true" else "false") catch return;
        writer.writeAll(",\"metadata\":") catch return;
        writer.writeAll(if (event.op.metadata) "true" else "false") catch return;
        writer.writeAll(",\"move_to\":") catch return;
        writer.writeAll(if (event.op.move_to) "true" else "false") catch return;

        // Add changed file names if any
        const names = event.names(changed_files);
        writer.writeAll(",\"changed_files\":[") catch return;
        var first = true;
        for (names) |name_opt| {
            if (name_opt) |name| {
                if (!first) writer.writeAll(",") catch return;
                first = false;
                writer.writeAll("\"") catch return;
                // Escape quotes and backslashes in filename
                for (name) |c| {
                    if (c == '"' or c == '\\') {
                        writer.writeByte('\\') catch return;
                    }
                    writer.writeByte(c) catch return;
                }
                writer.writeAll("\"") catch return;
            }
        }
        writer.writeAll("]}\n") catch return;

        const written = stream.getWritten();
        _ = bun.sys.write(fd, written);
    }
}

/// Close the trace file if open
pub fn deinit() void {
    if (trace_file) |fd| {
        fd.close();
        trace_file = null;
    }
}

const Watcher = @import("../Watcher.zig");
const bun = @import("../bun.zig");
const std = @import("std");
