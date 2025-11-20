/// Fetched when a client-side error happens. This performs two actions
/// - Logs the remapped stack trace to the console.
/// - Replies with the remapped stack trace.
/// Payload:
/// - `u32`: Responding message ID (echoed back)
/// - `u32`: Length of message
/// - `[n]u8`: Message
/// - `u32`: Length of error name
/// - `[n]u8`: Error name
/// - `u32`: Number of stack frames. For each
///   - `u32`: Line number (0 for unavailable)
///   - `u32`: Column number (0 for unavailable)
///   - `u32`: Length of file name (0 for unavailable)
///   - `[n]u8`: File name
///   - `u32`: Length of function name (0 for unavailable)
///   - `[n]u8`: Function name
const ErrorReportRequest = @This();

dev: *DevServer,
body: uws.BodyReaderMixin(@This(), "body", runWithBody, finalize),

pub fn run(dev: *DevServer, _: *Request, resp: anytype) void {
    const ctx = bun.new(ErrorReportRequest, .{
        .dev = dev,
        .body = .init(dev.allocator()),
    });
    ctx.dev.server.?.onPendingRequest();
    ctx.body.readBody(resp);
}

pub fn finalize(ctx: *ErrorReportRequest) void {
    ctx.dev.server.?.onStaticRequestComplete();
    bun.destroy(ctx);
}

pub fn runWithBody(ctx: *ErrorReportRequest, body: []const u8, r: AnyResponse) !void {
    // .finalize has to be called last, but only in the non-error path.
    var should_finalize_self = false;
    defer if (should_finalize_self) ctx.finalize();

    var s = std.io.fixedBufferStream(body);
    const reader = s.reader();

    var sfa_general = std.heap.stackFallback(65536, ctx.dev.allocator());
    var sfa_sourcemap = std.heap.stackFallback(65536, ctx.dev.allocator());
    const temp_alloc = sfa_general.get();
    var arena = std.heap.ArenaAllocator.init(temp_alloc);
    defer arena.deinit();
    var source_map_arena = std.heap.ArenaAllocator.init(sfa_sourcemap.get());
    defer source_map_arena.deinit();

    // Read payload, assemble ZigException
    const name = try readString32(reader, temp_alloc);
    defer temp_alloc.free(name);
    const message = try readString32(reader, temp_alloc);
    defer temp_alloc.free(message);
    const browser_url = try readString32(reader, temp_alloc);
    defer temp_alloc.free(browser_url);
    var frames: ArrayListUnmanaged(jsc.ZigStackFrame) = .empty;
    defer frames.deinit(temp_alloc);
    const stack_count = @min(try reader.readInt(u32, .little), 255); // does not support more than 255
    try frames.ensureTotalCapacity(temp_alloc, stack_count);
    for (0..stack_count) |_| {
        const line = try reader.readInt(i32, .little);
        const column = try reader.readInt(i32, .little);
        const function_name = try readString32(reader, temp_alloc);
        const file_name = try readString32(reader, temp_alloc);
        frames.appendAssumeCapacity(.{
            .function_name = .init(function_name),
            .source_url = .init(file_name),
            .position = if (line > 0) .{
                .line = .fromOneBased(line),
                .column = if (column < 1) .invalid else .fromOneBased(column),
                .line_start_byte = 0,
            } else .{
                .line = .invalid,
                .column = .invalid,
                .line_start_byte = 0,
            },
            .code_type = .None,
            .is_async = false,
            .remapped = false,
        });
    }

    const runtime_name = "Bun HMR Runtime";

    const browser_url_origin = bun.jsc.URL.originFromSlice(browser_url) orelse browser_url;

    // All files that DevServer could provide a source map fit the pattern:
    // `/_bun/client/<label>-{u64}.js`
    // Where the u64 is a unique identifier pointing into sourcemaps.
    //
    // HMR chunks use this too, but currently do not host their JS code.
    var parsed_source_maps: AutoArrayHashMapUnmanaged(SourceMapStore.Key, ?SourceMapStore.GetResult) = .empty;
    try parsed_source_maps.ensureTotalCapacity(temp_alloc, 4);
    defer for (parsed_source_maps.values()) |*value| {
        if (value.*) |*v| v.deinit(temp_alloc);
    };

    var runtime_lines: ?[5][]const u8 = null;
    var first_line_of_interest: usize = 0;
    var top_frame_position: jsc.ZigStackFramePosition = undefined;
    var region_of_interest_line: u32 = 0;
    for (frames.items) |*frame| {
        const source_url = frame.source_url.value.ZigString.slice();
        // The browser code strips "http://localhost:3000" when the string
        // has /_bun/client. It's done because JS can refer to `location`
        const id = parseId(source_url, browser_url_origin) orelse continue;

        // Get and cache the parsed source map
        const gop = try parsed_source_maps.getOrPut(temp_alloc, id);
        if (!gop.found_existing) {
            defer _ = source_map_arena.reset(.retain_capacity);
            const psm = ctx.dev.source_maps.getParsedSourceMap(
                id,
                source_map_arena.allocator(), // arena for parsing
                temp_alloc, // store results into first arena
            ) orelse {
                Output.debugWarn("Failed to find mapping for {s}, {d}", .{ source_url, id.get() });
                gop.value_ptr.* = null;
                continue;
            };
            gop.value_ptr.* = psm;
        }
        const result: *const SourceMapStore.GetResult = &(gop.value_ptr.* orelse continue);

        // When before the first generated line, remap to the HMR runtime.
        //
        // Reminder that the HMR runtime is *not* sourcemapped. And appears
        // first in the bundle. This means that the mappings usually looks like
        // this:
        //
        // AAAA;;;;;;;;;;;ICGA,qCAA4B;
        // ^              ^ generated_mappings[1], actual code
        // ^
        // ^ generated_mappings[0], we always start it with this
        //
        // So we can know if the frame is inside the HMR runtime if
        // `frame.position.line < generated_mappings[1].lines`.
        const generated_mappings = result.mappings.generated();
        if (generated_mappings.len <= 1 or frame.position.line.zeroBased() < generated_mappings[1].lines.zeroBased()) {
            frame.source_url = .init(runtime_name); // matches value in source map
            frame.position = .invalid;
            continue;
        }

        // Remap the frame
        const remapped = result.mappings.find(
            frame.position.line,
            frame.position.column,
        );
        if (remapped) |*remapped_position| {
            frame.position = .{
                .line = .fromZeroBased(remapped_position.originalLine()),
                .column = .fromZeroBased(remapped_position.originalColumn()),
                .line_start_byte = 0,
            };
            const index = remapped_position.source_index;
            if (index >= 1 and (index - 1) < result.file_paths.len) {
                const abs_path = result.file_paths[@intCast(index - 1)];
                frame.source_url = .init(abs_path);
                const relative_path_buf = bun.path_buffer_pool.get();
                defer bun.path_buffer_pool.put(relative_path_buf);
                const rel_path = ctx.dev.relativePath(relative_path_buf, abs_path);
                if (bun.strings.eql(frame.function_name.value.ZigString.slice(), rel_path)) {
                    frame.function_name = .empty;
                }
                frame.remapped = true;

                if (runtime_lines == null) {
                    const file = result.entry_files.get(@intCast(index - 1));
                    if (file.get()) |source_map| {
                        const json_encoded_source_code = source_map.quotedContents();
                        // First line of interest is two above the target line.
                        const target_line = @as(usize, @intCast(frame.position.line.zeroBased()));
                        first_line_of_interest = target_line -| 2;
                        region_of_interest_line = @intCast(target_line - first_line_of_interest);
                        runtime_lines = try extractJsonEncodedSourceCode(
                            json_encoded_source_code,
                            @intCast(first_line_of_interest),
                            5,
                            arena.allocator(),
                        );
                        top_frame_position = frame.position;
                    }
                }
            } else if (index == 0) {
                // Should be picked up by above but just in case.
                frame.source_url = .init(runtime_name);
                frame.position = .invalid;
            }
        }
    }

    // Stack traces can often end with random runtime frames that are not relevant.
    trim_runtime_frames: {
        // Ensure that trimming will not remove ALL frames.
        for (frames.items) |frame| {
            if (!frame.position.isInvalid() or frame.source_url.value.ZigString.slice().ptr != runtime_name) {
                break;
            }
        } else break :trim_runtime_frames;

        // Move all frames up
        var i: usize = 0;
        for (frames.items[i..]) |frame| {
            if (frame.position.isInvalid() and frame.source_url.value.ZigString.slice().ptr == runtime_name) {
                continue; // skip runtime frames
            }

            frames.items[i] = frame;
            i += 1;
        }
        frames.items.len = i;
    }

    var exception: jsc.ZigException = .{
        .type = .Error,
        .runtime_type = .Nothing,
        .name = .init(name),
        .message = .init(message),
        .stack = .fromFrames(frames.items),
        .exception = null,
        .remapped = false,
        .browser_url = .init(browser_url),
    };

    const stderr = Output.errorWriterBuffered();
    defer Output.flush();
    switch (Output.enable_ansi_colors_stderr) {
        inline else => |ansi_colors| ctx.dev.vm.printExternallyRemappedZigException(
            &exception,
            null,
            @TypeOf(stderr),
            stderr,
            true,
            ansi_colors,
        ) catch {},
    }

    var out: std.array_list.Managed(u8) = .init(ctx.dev.allocator());
    errdefer out.deinit();
    const w = out.writer();

    try w.writeInt(u32, exception.stack.frames_len, .little);
    for (exception.stack.frames()) |frame| {
        try w.writeInt(i32, frame.position.line.oneBased(), .little);
        try w.writeInt(i32, frame.position.column.oneBased(), .little);

        const function_name = frame.function_name.value.ZigString.slice();
        try w.writeInt(u32, @intCast(function_name.len), .little);
        try w.writeAll(function_name);

        const src_to_write = frame.source_url.value.ZigString.slice();
        if (bun.strings.hasPrefixComptime(src_to_write, "/")) {
            const relative_path_buf = bun.path_buffer_pool.get();
            defer bun.path_buffer_pool.put(relative_path_buf);
            const file = ctx.dev.relativePath(relative_path_buf, src_to_write);
            try w.writeInt(u32, @intCast(file.len), .little);
            try w.writeAll(file);
        } else {
            try w.writeInt(u32, @intCast(src_to_write.len), .little);
            try w.writeAll(src_to_write);
        }
    }

    if (runtime_lines) |*lines| {
        // trim empty lines
        var adjusted_lines: [][]const u8 = lines;
        while (adjusted_lines.len > 0 and adjusted_lines[0].len == 0) {
            adjusted_lines = adjusted_lines[1..];
            region_of_interest_line -|= 1;
            first_line_of_interest += 1;
        }
        while (adjusted_lines.len > 0 and adjusted_lines[adjusted_lines.len - 1].len == 0) {
            adjusted_lines.len -= 1;
        }

        try w.writeInt(u8, @intCast(adjusted_lines.len), .little);
        try w.writeInt(u32, @intCast(region_of_interest_line), .little);
        try w.writeInt(u32, @intCast(first_line_of_interest + 1), .little);
        try w.writeInt(u32, @intCast(top_frame_position.column.oneBased()), .little);

        for (adjusted_lines) |line| {
            try w.writeInt(u32, @intCast(line.len), .little);
            try w.writeAll(line);
        }
    } else {
        try w.writeInt(u8, 0, .little);
    }

    StaticRoute.sendBlobThenDeinit(r, &.fromArrayList(out), .{
        .mime_type = &.other,
        .server = ctx.dev.server.?,
    });
    should_finalize_self = true;
}

pub fn parseId(source_url: []const u8, browser_url: []const u8) ?SourceMapStore.Key {
    if (!bun.strings.startsWith(source_url, browser_url))
        return null;
    const after_host = source_url[bun.strings.withoutTrailingSlash(browser_url).len..];
    if (!bun.strings.hasPrefixComptime(after_host, client_prefix ++ "/"))
        return null;
    const after_prefix = after_host[client_prefix.len + 1 ..];
    // Extract the ID
    if (!bun.strings.hasSuffixComptime(after_prefix, ".js"))
        return null;
    const min_len = "00000000FFFFFFFF.js".len;
    if (after_prefix.len < min_len)
        return null;
    const hex = after_prefix[after_prefix.len - min_len ..][0 .. @sizeOf(u64) * 2];
    if (hex.len != @sizeOf(u64) * 2)
        return null;
    return .init(DevServer.parseHexToInt(u64, hex) orelse
        return null);
}

/// Instead of decoding the entire file, just decode the desired section.
fn extractJsonEncodedSourceCode(contents: []const u8, target_line: u32, comptime n: usize, arena: Allocator) !?[n][]const u8 {
    var line: usize = 0;
    var prev: usize = 0;
    const index_of_first_line = if (target_line == 0)
        0 // no iteration needed
    else while (bun.strings.indexOfCharPos(contents, '\\', prev)) |i| : (prev = i + 2) {
        if (i >= contents.len - 2) return null;
        // Bun's JSON printer will not use a sillier encoding for newline.
        if (contents[i + 1] == 'n') {
            line += 1;
            if (line == target_line)
                break i + 2;
        }
    } else return null;

    var rest = contents[index_of_first_line..];

    // For decoding JSON escapes, the JS Lexer decoding function has
    // `decodeEscapeSequences`, which only supports decoding to UTF-16.
    // Alternatively, it appears the TOML lexer has copied this exact
    // function but for UTF-8. So the decoder can just use that.
    //
    // This function expects but does not assume the escape sequences
    // given are valid, and does not bubble errors up.
    var log = Log.init(arena);
    var l: bun.interchange.toml.Lexer = .{
        .log = &log,
        .source = .initEmptyFile(""),
        .allocator = arena,
        .should_redact_logs = false,
        .prev_error_loc = .Empty,
    };
    defer log.deinit();

    var result: [n][]const u8 = .{""} ** n;
    for (&result) |*decoded_line| {
        var has_extra_escapes = false;
        prev = 0;
        // Locate the line slice
        const end_of_line = while (bun.strings.indexOfCharPos(rest, '\\', prev)) |i| : (prev = i + 2) {
            if (i >= rest.len - 1) return null;
            if (rest[i + 1] == 'n') {
                break i;
            }
            has_extra_escapes = true;
        } else rest.len;
        const encoded_line = rest[0..end_of_line];

        // Decode it
        if (has_extra_escapes) {
            var bytes: std.array_list.Managed(u8) = try .initCapacity(arena, encoded_line.len);
            try l.decodeEscapeSequences(0, encoded_line, false, std.array_list.Managed(u8), &bytes);
            decoded_line.* = bytes.items;
        } else {
            decoded_line.* = encoded_line;
        }

        if (end_of_line + 2 >= rest.len) break;
        rest = rest[end_of_line + 2 ..];
    }

    return result;
}

const bun = @import("bun");
const Output = bun.Output;
const bake = bun.bake;
const jsc = bun.jsc;
const Log = bun.logger.Log;
const StaticRoute = bun.api.server.StaticRoute;

const DevServer = bake.DevServer;
const SourceMapStore = DevServer.SourceMapStore;
const client_prefix = DevServer.client_prefix;
const readString32 = DevServer.readString32;

const uws = bun.uws;
const AnyResponse = bun.uws.AnyResponse;
const Request = uws.Request;

const std = @import("std");
const ArrayListUnmanaged = std.ArrayListUnmanaged;
const AutoArrayHashMapUnmanaged = std.AutoArrayHashMapUnmanaged;
const Allocator = std.mem.Allocator;
