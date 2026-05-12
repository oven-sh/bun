//! Per-input-file sourcemap used by the bundler to chain sourcemaps through
//! upstream compile steps (e.g. `.vue` → `.js`, `.svelte` → `.js`,
//! TypeScript plugins). When `Bun.build` reads an input file that carries
//! an inline `//# sourceMappingURL=data:application/json;...` comment, we
//! parse it into an `InputSourceMap` and store it on the file's
//! `Graph.InputFile`. `LinkerContext` then emits its `sources` /
//! `sourcesContent` in place of the intermediate, and `Chunk.Builder`
//! remaps each mapping through `map.findMapping` during printing so stack
//! traces surface in the authored source.

const InputSourceMap = @This();

/// Parsed mappings + `external_source_names` (the chained-in `sources[]`).
/// Owned — must be `deref`'d on cleanup.
map: *bun.SourceMap.ParsedSourceMap,

/// One entry per source in `map.external_source_names`. A slot is empty
/// (`""`) when the inner map did not carry content for that source.
/// Owned by `bun.default_allocator`.
sources_content: [][]const u8,

pub fn deinit(this: *InputSourceMap) void {
    this.map.deref();
    for (this.sources_content) |content| {
        if (content.len > 0) bun.default_allocator.free(content);
    }
    bun.default_allocator.free(this.sources_content);
    bun.destroy(this);
}

/// Signals a malformed sourcemap payload — the callers treat this as
/// "no chain available" and fall back to the raw file bytes. `OutOfMemory`
/// is deliberately *not* wrapped into this: it propagates out via the
/// internal error union so `bun.handleOom` can take Bun's fatal path
/// instead of silently pretending the map didn't exist.
const InvalidSourceMapError = error{InvalidSourceMap};
const ParseError = InvalidSourceMapError || std.mem.Allocator.Error;

/// Parse a sourcemap JSON blob intended to chain through a bundler input
/// file. Returns an owned `*InputSourceMap` (free with `deinit`) or `null`
/// when the payload is malformed — callers fall back to the raw file bytes.
/// Allocation failures bubble up via `bun.handleOom`.
///
/// `json_bytes` is borrowed; the function copies out what it needs.
pub fn parse(json_bytes: []const u8) ?*InputSourceMap {
    return parseInternal(json_bytes) catch |err| switch (err) {
        error.InvalidSourceMap => null,
        error.OutOfMemory => bun.outOfMemory(),
    };
}

/// Internal workhorse for `parse`. Returns an error union so `errdefer`
/// fires on malformed-payload bails — critical because JSON can pass the
/// structural checks but still have a malformed `mappings` VLQ, and we'd
/// otherwise leak everything allocated up to that point.
fn parseInternal(json_bytes: []const u8) ParseError!*InputSourceMap {
    const allocator = bun.default_allocator;

    var arena = bun.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const arena_allocator = arena.allocator();

    const json_src = bun.logger.Source.initPathString("sourcemap.json", json_bytes);
    var log = bun.logger.Log.init(arena_allocator);
    defer log.deinit();

    bun.ast.Expr.Data.Store.reset();
    bun.ast.Stmt.Data.Store.reset();
    defer {
        bun.ast.Expr.Data.Store.reset();
        bun.ast.Stmt.Data.Store.reset();
    }

    var json = bun.json.parse(&json_src, &log, arena_allocator, false) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return error.InvalidSourceMap,
    };

    if (json.get("version")) |version| {
        if (version.data != .e_number or version.data.e_number.value != 3.0) return error.InvalidSourceMap;
    }

    const mappings_str = json.get("mappings") orelse return error.InvalidSourceMap;
    if (mappings_str.data != .e_string) return error.InvalidSourceMap;

    const sources_paths = switch ((json.get("sources") orelse return error.InvalidSourceMap).data) {
        .e_array => |arr| arr,
        else => return error.InvalidSourceMap,
    };

    // `sourcesContent` is optional; when absent we leave every slot empty.
    const sources_content_opt: ?*bun.ast.E.Array = if (json.get("sourcesContent")) |sc| switch (sc.data) {
        .e_array => |arr| arr,
        .e_null => null,
        else => return error.InvalidSourceMap,
    } else null;

    if (sources_content_opt) |arr| {
        if (arr.items.len != sources_paths.items.len) return error.InvalidSourceMap;
    }

    const source_count = sources_paths.items.len;

    // Everything below is owned by `bun.default_allocator`, not the arena,
    // because it survives past this function. `errdefer`s clean up on any
    // thrown error — which now actually fires thanks to the error-union
    // return type.
    var source_paths_slice = try allocator.alloc([]const u8, source_count);
    var paths_written: usize = 0;
    errdefer {
        for (source_paths_slice[0..paths_written]) |p| allocator.free(p);
        allocator.free(source_paths_slice);
    }

    for (sources_paths.items.slice()) |item| {
        if (item.data != .e_string) return error.InvalidSourceMap;
        const str = try item.data.e_string.string(arena_allocator);
        source_paths_slice[paths_written] = try allocator.dupe(u8, str);
        paths_written += 1;
    }

    var sources_content_slice = try allocator.alloc([]const u8, source_count);
    var contents_written: usize = 0;
    errdefer {
        for (sources_content_slice[0..contents_written]) |c| if (c.len > 0) allocator.free(c);
        allocator.free(sources_content_slice);
    }

    if (sources_content_opt) |arr| {
        for (arr.items.slice()) |item| {
            if (item.data == .e_string) {
                const str = try item.data.e_string.string(arena_allocator);
                sources_content_slice[contents_written] = if (str.len == 0)
                    ""
                else
                    try allocator.dupe(u8, str);
            } else {
                // Non-strings (null, etc.) get empty content.
                sources_content_slice[contents_written] = "";
            }
            contents_written += 1;
        }
    } else {
        for (0..source_count) |i| sources_content_slice[i] = "";
        contents_written = source_count;
    }

    const map_data = switch (bun.SourceMap.Mapping.parse(
        allocator,
        mappings_str.data.e_string.slice(arena_allocator),
        null,
        std.math.maxInt(i32),
        std.math.maxInt(i32),
        .{ .allow_names = false, .sort = true },
    )) {
        .success => |x| x,
        .fail => |fail| switch (fail.err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.InvalidSourceMap,
        },
    };

    const psm = bun.new(bun.SourceMap.ParsedSourceMap, map_data);
    psm.external_source_names = source_paths_slice;
    // Ownership of `source_paths_slice` has transferred to `psm`; neuter
    // the earlier `errdefer` so a later failure doesn't double-free via
    // both it and `psm.deref()`. (Currently unreachable because nothing
    // between here and `return result` can fail, but this keeps the
    // invariant local and robust to future additions.)
    paths_written = 0;
    source_paths_slice = &.{};

    const result = bun.new(InputSourceMap, .{
        .map = psm,
        .sources_content = sources_content_slice,
    });
    // Ownership of `sources_content_slice` and `psm` has transferred to
    // `result`; neuter their earlier `errdefer`s for the same reason.
    contents_written = 0;
    sources_content_slice = &.{};
    return result;
}

/// Locate a `//# sourceMappingURL=` trailing comment in the source text and
/// parse the inline `data:application/json;base64,...` (or `;,...`) map
/// into an owned `*InputSourceMap`. Returns `null` when no URL is present,
/// when the URL is not a data URL (e.g. a `.map` filename), or when the
/// payload fails to parse. External `.map` file resolution is the caller's
/// responsibility.
pub fn parseFromSource(source: []const u8) ?*InputSourceMap {
    const url = findSourceMappingURL(source) orelse return null;
    return parseDataUrl(url);
}

/// Find the trailing `//# sourceMappingURL=<url>` comment in a file. The
/// spec calls for the *last* such comment, hence `lastIndexOf`.
fn findSourceMappingURL(source: []const u8) ?[]const u8 {
    const needle = "//# sourceMappingURL=";
    // Require a preceding newline so we don't mis-detect the comment as
    // the opening line of a compiled-away string literal etc.
    const found = std.mem.lastIndexOf(u8, source, "\n" ++ needle) orelse {
        // First line edge case: if the file literally starts with the
        // comment, `lastIndexOf` with a leading newline would miss it.
        if (bun.strings.hasPrefixComptime(source, needle)) {
            const end = std.mem.indexOfScalarPos(u8, source, needle.len, '\n') orelse source.len;
            return bun.strings.trim(source[needle.len..end], " \r\t");
        }
        return null;
    };
    const start = found + 1 + needle.len;
    const end = std.mem.indexOfScalarPos(u8, source, start, '\n') orelse source.len;
    return bun.strings.trim(source[start..end], " \r\t");
}

/// Decode `data:application/json[;base64],...` payloads. Returns `null`
/// when the URL is not a supported data scheme.
fn parseDataUrl(url: []const u8) ?*InputSourceMap {
    const prefix = "data:application/json";
    if (!bun.strings.hasPrefixComptime(url, prefix)) return null;
    if (url.len <= prefix.len + 1) return null;

    const remainder = url[prefix.len..];
    // `data:application/json;charset=utf-8;base64,...` is permitted in
    // the wild; we tolerate any number of `;name[=value]` parameters
    // between the prefix and the final `;base64,` / `,` separator.
    var rest = remainder;
    var is_base64 = false;
    while (rest.len > 0 and rest[0] == ';') {
        // Advance past one parameter up to the next ';' or ','.
        const after = rest[1..];
        const param_end = std.mem.indexOfAny(u8, after, ";,") orelse return null;
        const param = after[0..param_end];
        if (bun.strings.eqlComptime(param, "base64")) is_base64 = true;
        rest = after[param_end..];
    }
    if (rest.len == 0 or rest[0] != ',') return null;
    const payload = rest[1..];

    if (is_base64) {
        const decoded_len = bun.base64.decodeLen(payload);
        const buf = bun.handleOom(bun.default_allocator.alloc(u8, decoded_len));
        defer bun.default_allocator.free(buf);
        const decoded = bun.base64.decode(buf, payload);
        if (!decoded.isSuccessful()) return null;
        return parse(buf[0..decoded.count]);
    }

    // Not base64; treat the payload as the raw JSON text (sometimes
    // percent-encoded in URLs, but bundlers emit the literal form).
    return parse(payload);
}

const bun = @import("bun");
const std = @import("std");
