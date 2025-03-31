const std = @import("std");
const bun = @import("root").bun;

extern const jsc_llint_begin: u8;
extern const jsc_llint_end: u8;
/// allocated using bun.default_allocator. when called from lldb, it is never freed.
pub export fn dumpBtjsTrace() [*:0]const u8 {
    if (comptime bun.Environment.isDebug) {
        return dumpBtjsTraceDebugImpl();
    }

    return "btjs is disabled in release builds";
}

fn dumpBtjsTraceDebugImpl() [*:0]const u8 {
    var result_writer = std.ArrayList(u8).init(bun.default_allocator);
    const w = result_writer.writer();

    const debug_info = std.debug.getSelfDebugInfo() catch |err| {
        w.print("Unable to dump stack trace: Unable to open debug info: {s}\x00", .{@errorName(err)}) catch {
            result_writer.deinit();
            return "<oom>".ptr;
        };
        return @ptrCast((result_writer.toOwnedSlice() catch {
            result_writer.deinit();
            return "<oom>".ptr;
        }).ptr);
    };

    // std.log.info("jsc_llint_begin: {x}", .{@intFromPtr(&jsc_llint_begin)});
    // std.log.info("jsc_llint_end: {x}", .{@intFromPtr(&jsc_llint_end)});

    const tty_config = std.io.tty.detectConfig(std.io.getStdOut());

    var context: std.debug.ThreadContext = undefined;
    const has_context = std.debug.getContext(&context);

    var it: std.debug.StackIterator = (if (has_context and !bun.Environment.isWindows) blk: {
        break :blk std.debug.StackIterator.initWithContext(null, debug_info, &context) catch null;
    } else null) orelse std.debug.StackIterator.init(null, null);
    defer it.deinit();

    while (it.next()) |return_address| {
        printLastUnwindError(&it, debug_info, w, tty_config);

        // On arm64 macOS, the address of the last frame is 0x0 rather than 0x1 as on x86_64 macOS,
        // therefore, we do a check for `return_address == 0` before subtracting 1 from it to avoid
        // an overflow. We do not need to signal `StackIterator` as it will correctly detect this
        // condition on the subsequent iteration and return `null` thus terminating the loop.
        // same behaviour for x86-windows-msvc
        const address = return_address -| 1;
        printSourceAtAddress(debug_info, w, address, tty_config, it.fp) catch {};
    } else {
        printLastUnwindError(&it, debug_info, w, tty_config);
    }

    // remove nulls
    for (result_writer.items) |*itm| if (itm.* == 0) {
        itm.* = ' ';
    };
    // add null terminator
    result_writer.append(0) catch {
        result_writer.deinit();
        return "<oom>".ptr;
    };
    return @ptrCast((result_writer.toOwnedSlice() catch {
        result_writer.deinit();
        return "<oom>".ptr;
    }).ptr);
}

fn printSourceAtAddress(debug_info: *std.debug.SelfInfo, out_stream: anytype, address: usize, tty_config: std.io.tty.Config, fp: usize) !void {
    if (!bun.Environment.isDebug) unreachable;
    const module = debug_info.getModuleForAddress(address) catch |err| switch (err) {
        error.MissingDebugInfo, error.InvalidDebugInfo => return printUnknownSource(debug_info, out_stream, address, tty_config),
        else => return err,
    };

    const symbol_info = module.getSymbolAtAddress(debug_info.allocator, address) catch |err| switch (err) {
        error.MissingDebugInfo, error.InvalidDebugInfo => return printUnknownSource(debug_info, out_stream, address, tty_config),
        else => return err,
    };
    defer if (symbol_info.source_location) |sl| debug_info.allocator.free(sl.file_name);

    const probably_llint = address > @intFromPtr(&jsc_llint_begin) and address < @intFromPtr(&jsc_llint_end);
    var allow_llint = true;
    if (std.mem.startsWith(u8, symbol_info.name, "__")) {
        allow_llint = false; // disallow llint for __ZN3JSC11Interpreter20executeModuleProgramEPNS_14JSModuleRecordEPNS_23ModuleProgramExecutableEPNS_14JSGlobalObjectEPNS_19JSModuleEnvironmentENS_7JSValueES9_
    }
    if (std.mem.startsWith(u8, symbol_info.name, "_llint_call_javascript")) {
        allow_llint = false; // disallow llint for _llint_call_javascript
    }
    const do_llint = probably_llint and allow_llint;

    const frame: *const bun.JSC.CallFrame = @ptrFromInt(fp);
    if (do_llint) {
        const srcloc = frame.getCallerSrcLoc(bun.JSC.Bun__getVM().global);
        try tty_config.setColor(out_stream, .bold);
        try out_stream.print("{s}:{d}:{d}: ", .{ srcloc.str, srcloc.line, srcloc.column });
        try tty_config.setColor(out_stream, .reset);
    }

    try printLineInfo(
        out_stream,
        symbol_info.source_location,
        address,
        symbol_info.name,
        symbol_info.compile_unit_name,
        tty_config,
        printLineFromFileAnyOs,
        do_llint,
    );
    if (do_llint) {
        const desc = frame.describeFrame();
        try out_stream.print("    {s}\n    ", .{desc});
        try tty_config.setColor(out_stream, .green);
        try out_stream.writeAll("^");
        try tty_config.setColor(out_stream, .reset);
        try out_stream.writeAll("\n");
    }
}

fn printUnknownSource(debug_info: *std.debug.SelfInfo, out_stream: anytype, address: usize, tty_config: std.io.tty.Config) !void {
    if (!bun.Environment.isDebug) unreachable;
    const module_name = debug_info.getModuleNameForAddress(address);
    return printLineInfo(
        out_stream,
        null,
        address,
        "???",
        module_name orelse "???",
        tty_config,
        printLineFromFileAnyOs,
        false,
    );
}
fn printLineInfo(
    out_stream: anytype,
    source_location: ?std.debug.SourceLocation,
    address: usize,
    symbol_name: []const u8,
    compile_unit_name: []const u8,
    tty_config: std.io.tty.Config,
    comptime printLineFromFile: anytype,
    do_llint: bool,
) !void {
    if (!bun.Environment.isDebug) unreachable;

    nosuspend {
        try tty_config.setColor(out_stream, .bold);

        if (source_location) |*sl| {
            try out_stream.print("{s}:{d}:{d}", .{ sl.file_name, sl.line, sl.column });
        } else if (!do_llint) {
            try out_stream.writeAll("???:?:?");
        }

        try tty_config.setColor(out_stream, .reset);
        if (!do_llint or source_location != null) try out_stream.writeAll(": ");
        try tty_config.setColor(out_stream, .dim);
        try out_stream.print("0x{x} in {s} ({s})", .{ address, symbol_name, compile_unit_name });
        try tty_config.setColor(out_stream, .reset);
        try out_stream.writeAll("\n");

        // Show the matching source code line if possible
        if (source_location) |sl| {
            if (printLineFromFile(out_stream, sl)) {
                if (sl.column > 0) {
                    // The caret already takes one char
                    const space_needed = @as(usize, @intCast(sl.column - 1));

                    try out_stream.writeByteNTimes(' ', space_needed);
                    try tty_config.setColor(out_stream, .green);
                    try out_stream.writeAll("^");
                    try tty_config.setColor(out_stream, .reset);
                }
                try out_stream.writeAll("\n");
            } else |err| switch (err) {
                error.EndOfFile, error.FileNotFound => {},
                error.BadPathName => {},
                error.AccessDenied => {},
                else => return err,
            }
        }
    }
}

fn printLineFromFileAnyOs(out_stream: anytype, source_location: std.debug.SourceLocation) !void {
    if (!bun.Environment.isDebug) unreachable;

    // Need this to always block even in async I/O mode, because this could potentially
    // be called from e.g. the event loop code crashing.
    var f = try std.fs.cwd().openFile(source_location.file_name, .{});
    defer f.close();
    // TODO fstat and make sure that the file has the correct size

    var buf: [4096]u8 = undefined;
    var amt_read = try f.read(buf[0..]);
    const line_start = seek: {
        var current_line_start: usize = 0;
        var next_line: usize = 1;
        while (next_line != source_location.line) {
            const slice = buf[current_line_start..amt_read];
            if (std.mem.indexOfScalar(u8, slice, '\n')) |pos| {
                next_line += 1;
                if (pos == slice.len - 1) {
                    amt_read = try f.read(buf[0..]);
                    current_line_start = 0;
                } else current_line_start += pos + 1;
            } else if (amt_read < buf.len) {
                return error.EndOfFile;
            } else {
                amt_read = try f.read(buf[0..]);
                current_line_start = 0;
            }
        }
        break :seek current_line_start;
    };
    const slice = buf[line_start..amt_read];
    if (std.mem.indexOfScalar(u8, slice, '\n')) |pos| {
        const line = slice[0 .. pos + 1];
        std.mem.replaceScalar(u8, line, '\t', ' ');
        return out_stream.writeAll(line);
    } else { // Line is the last inside the buffer, and requires another read to find delimiter. Alternatively the file ends.
        std.mem.replaceScalar(u8, slice, '\t', ' ');
        try out_stream.writeAll(slice);
        while (amt_read == buf.len) {
            amt_read = try f.read(buf[0..]);
            if (std.mem.indexOfScalar(u8, buf[0..amt_read], '\n')) |pos| {
                const line = buf[0 .. pos + 1];
                std.mem.replaceScalar(u8, line, '\t', ' ');
                return out_stream.writeAll(line);
            } else {
                const line = buf[0..amt_read];
                std.mem.replaceScalar(u8, line, '\t', ' ');
                try out_stream.writeAll(line);
            }
        }
        // Make sure printing last line of file inserts extra newline
        try out_stream.writeByte('\n');
    }
}

fn printLastUnwindError(it: *std.debug.StackIterator, debug_info: *std.debug.SelfInfo, out_stream: anytype, tty_config: std.io.tty.Config) void {
    if (!bun.Environment.isDebug) unreachable;
    if (!std.debug.have_ucontext) return;
    if (it.getLastError()) |unwind_error| {
        printUnwindError(debug_info, out_stream, unwind_error.address, unwind_error.err, tty_config) catch {};
    }
}

fn printUnwindError(debug_info: *std.debug.SelfInfo, out_stream: anytype, address: usize, err: std.debug.UnwindError, tty_config: std.io.tty.Config) !void {
    if (!bun.Environment.isDebug) unreachable;

    const module_name = debug_info.getModuleNameForAddress(address) orelse "???";
    try tty_config.setColor(out_stream, .dim);
    if (err == error.MissingDebugInfo) {
        try out_stream.print("Unwind information for `{s}:0x{x}` was not available, trace may be incomplete\n\n", .{ module_name, address });
    } else {
        try out_stream.print("Unwind error at address `{s}:0x{x}` ({}), trace may be incomplete\n\n", .{ module_name, address, err });
    }
    try tty_config.setColor(out_stream, .reset);
}
