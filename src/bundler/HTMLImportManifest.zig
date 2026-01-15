//! HTMLImportManifest generates JSON manifests for HTML imports in Bun's bundler.
//!
//! When you import an HTML file in JavaScript:
//! ```javascript
//! import index from "./index.html";
//! console.log(index);
//! ```
//!
//! Bun transforms this into a call to `__jsonParse()` with a JSON manifest containing
//! metadata about all the files generated from the HTML import:
//!
//! ```javascript
//! var src_default = __jsonParse(
//!   '{"index":"./index.html","files":[{"input":"index.html","path":"./index-f2me3qnf.js","loader":"js","isEntry":true,"headers":{"etag": "eet6gn75","content-type": "text/javascript;charset=utf-8"}},{"input":"index.html","path":"./index.html","loader":"html","isEntry":true,"headers":{"etag": "r9njjakd","content-type": "text/html;charset=utf-8"}},{"input":"index.html","path":"./index-gysa5fmk.css","loader":"css","isEntry":true,"headers":{"etag": "50zb7x61","content-type": "text/css;charset=utf-8"}},{"input":"logo.svg","path":"./logo-kygw735p.svg","loader":"file","isEntry":false,"headers":{"etag": "kygw735p","content-type": "application/octet-stream"}},{"input":"react.svg","path":"./react-ck11dneg.svg","loader":"file","isEntry":false,"headers":{"etag": "ck11dneg","content-type": "application/octet-stream"}}]}'
//! );
//! ```
//!
//! The manifest JSON structure contains:
//! - `index`: The original HTML file path
//! - `files`: Array of all generated files with metadata:
//!   - `input`: Original source file path
//!   - `path`: Generated output file path (with content hash)
//!   - `loader`: File type/loader used (js, css, html, file, etc.)
//!   - `isEntry`: Whether this file is an entry point
//!   - `headers`: HTTP headers including ETag and Content-Type
//!
//! This enables applications to:
//! 1. Know all files generated from an HTML import
//! 2. Get proper MIME types and ETags for serving files
//! 3. Implement proper caching strategies
//! 4. Handle assets referenced by the HTML file
//!
//! The manifest is generated during the linking phase and serialized as a JSON string
//! that gets embedded directly into the JavaScript output.

const HTMLImportManifest = @This();

index: u32,
graph: *const Graph,
chunks: []Chunk,
linker_graph: *const LinkerGraph,

pub fn format(this: HTMLImportManifest, writer: *std.Io.Writer) bun.OOM!void {
    return write(this.index, this.graph, this.linker_graph, this.chunks, writer) catch |err| switch (err) {
        // We use std.fmt.count for this
        error.NoSpaceLeft => unreachable,
        error.OutOfMemory => return error.OutOfMemory,
        else => unreachable,
    };
}

fn writeEntryItem(
    writer: anytype,
    input: []const u8,
    path: []const u8,
    hash: u64,
    loader: options.Loader,
    kind: bun.jsc.API.BuildArtifact.OutputKind,
) !void {
    try writer.writeAll("{");

    if (input.len > 0) {
        try writer.writeAll("\"input\":");
        try bun.js_printer.writeJSONString(input, @TypeOf(writer), writer, .utf8);
        try writer.writeAll(",");
    }

    try writer.writeAll("\"path\":");
    try bun.js_printer.writeJSONString(path, @TypeOf(writer), writer, .utf8);

    try writer.writeAll(",\"loader\":\"");
    try writer.writeAll(@tagName(loader));
    try writer.writeAll("\",\"isEntry\":");
    try writer.writeAll(if (kind == .@"entry-point") "true" else "false");
    try writer.writeAll(",\"headers\":{");

    if (hash > 0) {
        var base64_buf: [bun.base64.encodeLenFromSize(@sizeOf(@TypeOf(hash))) + 2]u8 = undefined;
        const base64 = base64_buf[0..bun.base64.encodeURLSafe(&base64_buf, &std.mem.toBytes(hash))];
        try writer.print(
            \\"etag":"{s}",
        , .{base64});
    }

    try writer.print(
        \\"content-type":"{s}"
    , .{
        // Valid mime types are valid headers, which do not need to be escaped in JSON.
        loader.toMimeType(&.{
            path,
        }).value,
    });

    try writer.writeAll("}}");
}

// Extremely unfortunate, but necessary due to E.String not accepting pre-rescaped input and this happening at the very end.
pub fn writeEscapedJSON(index: u32, graph: *const Graph, linker_graph: *const LinkerGraph, chunks: []const Chunk, writer: anytype) !void {
    var stack = std.heap.stackFallback(4096, bun.default_allocator);
    const allocator = stack.get();
    var bytes = std.array_list.Managed(u8).init(allocator);
    defer bytes.deinit();
    try write(index, graph, linker_graph, chunks, bytes.writer());
    try bun.js_printer.writePreQuotedString(bytes.items, @TypeOf(writer), writer, '"', false, true, .utf8);
}

fn escapedJSONFormatter(this: HTMLImportManifest, writer: *std.Io.Writer) std.Io.Writer.Error!void {
    return writeEscapedJSON(this.index, this.graph, this.linker_graph, this.chunks, writer) catch |err| switch (err) {
        // We use std.fmt.count for this
        error.WriteFailed => unreachable,
        error.OutOfMemory => return error.WriteFailed,
        else => unreachable,
    };
}

pub fn formatEscapedJSON(this: HTMLImportManifest) std.fmt.Alt(HTMLImportManifest, escapedJSONFormatter) {
    return .{ .data = this };
}

pub fn write(index: u32, graph: *const Graph, linker_graph: *const LinkerGraph, chunks: []const Chunk, writer: anytype) !void {
    const browser_source_index = graph.html_imports.html_source_indices.slice()[index];
    const server_source_index = graph.html_imports.server_source_indices.slice()[index];
    const sources: []const bun.logger.Source = graph.input_files.items(.source);
    const bv2: *const BundleV2 = @alignCast(@fieldParentPtr("graph", graph));
    var entry_point_bits = try bun.bit_set.AutoBitSet.initEmpty(bun.default_allocator, graph.entry_points.items.len);
    defer entry_point_bits.deinit(bun.default_allocator);

    const root_dir = if (bv2.transpiler.options.root_dir.len > 0) bv2.transpiler.options.root_dir else bun.fs.FileSystem.instance.top_level_dir;

    try writer.writeAll("{");

    const inject_compiler_filesystem_prefix = bv2.transpiler.options.compile;
    // Use the server-side public path here.
    const public_path = bv2.transpiler.options.public_path;
    var temp_buffer = std.array_list.Managed(u8).init(bun.default_allocator);
    defer temp_buffer.deinit();

    for (chunks) |*ch| {
        if (ch.entry_point.source_index == browser_source_index and ch.entry_point.is_entry_point) {
            entry_point_bits.set(ch.entry_point.entry_point_id);

            if (ch.content == .html) {
                try writer.writeAll("\"index\":");
                if (inject_compiler_filesystem_prefix) {
                    temp_buffer.clearRetainingCapacity();
                    try temp_buffer.appendSlice(public_path);
                    try temp_buffer.appendSlice(bun.strings.removeLeadingDotSlash(ch.final_rel_path));
                    try bun.js_printer.writeJSONString(temp_buffer.items, @TypeOf(writer), writer, .utf8);
                } else {
                    try bun.js_printer.writeJSONString(ch.final_rel_path, @TypeOf(writer), writer, .utf8);
                }
                try writer.writeAll(",");
            }
        }
    }

    // Start the files array

    try writer.writeAll("\"files\":[");

    var first = true;

    const additional_output_files = graph.additional_output_files.items;
    const file_entry_bits: []const AutoBitSet = linker_graph.files.items(.entry_bits);
    var already_visited_output_file = try bun.bit_set.AutoBitSet.initEmpty(bun.default_allocator, additional_output_files.len);
    defer already_visited_output_file.deinit(bun.default_allocator);

    // Write all chunks that have files associated with this entry point.
    // Also include browser chunks from server builds (lazy-loaded chunks from dynamic imports).
    // When there's only one HTML import, all browser chunks belong to that manifest.
    // When there are multiple HTML imports, only include chunks that intersect with this entry's bits.
    const has_single_html_import = graph.html_imports.html_source_indices.len == 1;
    for (chunks) |*ch| {
        if (ch.entryBits().hasIntersection(&entry_point_bits) or
            (has_single_html_import and ch.flags.is_browser_chunk_from_server_build))
        {
            if (!first) try writer.writeAll(",");
            first = false;

            try writeEntryItem(
                writer,
                brk: {
                    if (!ch.entry_point.is_entry_point) break :brk "";
                    var path_for_key = bun.path.relativeNormalized(
                        root_dir,
                        sources[ch.entry_point.source_index].path.text,
                        .posix,
                        false,
                    );

                    path_for_key = bun.strings.removeLeadingDotSlash(path_for_key);

                    break :brk path_for_key;
                },
                brk: {
                    if (inject_compiler_filesystem_prefix) {
                        temp_buffer.clearRetainingCapacity();
                        try temp_buffer.appendSlice(public_path);
                        try temp_buffer.appendSlice(bun.strings.removeLeadingDotSlash(ch.final_rel_path));
                        break :brk temp_buffer.items;
                    }
                    break :brk ch.final_rel_path;
                },
                ch.isolated_hash,
                ch.content.loader(),
                if (ch.entry_point.is_entry_point)
                    .@"entry-point"
                else
                    .chunk,
            );
        }
    }

    for (additional_output_files, 0..) |*output_file, i| {
        // Only print the file once.
        if (already_visited_output_file.isSet(i)) continue;

        if (output_file.source_index.unwrap()) |source_index| {
            if (source_index.get() == server_source_index) continue;
            const bits: *const AutoBitSet = &file_entry_bits[source_index.get()];

            if (bits.hasIntersection(&entry_point_bits)) {
                already_visited_output_file.set(i);
                if (!first) try writer.writeAll(",");
                first = false;

                var path_for_key = bun.path.relativeNormalized(
                    root_dir,
                    sources[source_index.get()].path.text,
                    .posix,
                    false,
                );
                path_for_key = bun.strings.removeLeadingDotSlash(path_for_key);

                try writeEntryItem(
                    writer,
                    path_for_key,
                    brk: {
                        if (inject_compiler_filesystem_prefix) {
                            temp_buffer.clearRetainingCapacity();
                            try temp_buffer.appendSlice(public_path);
                            try temp_buffer.appendSlice(bun.strings.removeLeadingDotSlash(output_file.dest_path));
                            break :brk temp_buffer.items;
                        }
                        break :brk output_file.dest_path;
                    },
                    output_file.hash,
                    output_file.loader,
                    output_file.output_kind,
                );
            }
        }
    }

    try writer.writeAll("]}");
}

const std = @import("std");

const options = @import("../options.zig");
const Loader = options.Loader;

const bun = @import("bun");
const default_allocator = bun.default_allocator;
const strings = bun.strings;
const AutoBitSet = bun.bit_set.AutoBitSet;

const bundler = bun.bundle_v2;
const BundleV2 = bundler.BundleV2;
const Chunk = bundler.Chunk;
const Graph = bundler.Graph;
const LinkerGraph = bundler.LinkerGraph;
