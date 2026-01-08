//! MetafileBuilder generates metafile JSON output compatible with esbuild's format.
//!
//! The metafile format is:
//! ```json
//! {
//!   "inputs": {
//!     "path/to/file.js": {
//!       "bytes": 1234,
//!       "imports": [
//!         { "path": "dependency.js", "kind": "import-statement" },
//!         { "path": "external", "kind": "require-call", "external": true }
//!       ],
//!       "format": "esm"
//!     }
//!   },
//!   "outputs": {
//!     "path/to/output.js": {
//!       "bytes": 5678,
//!       "inputs": {
//!         "path/to/file.js": { "bytesInOutput": 1200 }
//!       },
//!       "imports": [
//!         { "path": "chunk.js", "kind": "import-statement" }
//!       ],
//!       "exports": ["default", "foo"],
//!       "entryPoint": "path/to/file.js"
//!     }
//!   }
//! }
//! ```
const MetafileBuilder = @This();

/// Generates the JSON fragment for a single output chunk.
/// Called during parallel chunk generation in postProcessJSChunk/postProcessCSSChunk.
/// The result is stored in chunk.metafile_chunk_json and assembled later.
pub fn generateChunkJson(
    allocator: std.mem.Allocator,
    c: *const LinkerContext,
    chunk: *const Chunk,
    chunks: []const Chunk,
) ![]const u8 {
    var json = std.array_list.Managed(u8).init(allocator);
    errdefer json.deinit();

    const writer = json.writer();
    const sources = c.parse_graph.input_files.items(.source);

    // Start chunk entry: "path/to/output.js": {
    try writeJSONString(writer, chunk.final_rel_path);
    try writer.writeAll(": {");

    // Write bytes
    const chunk_bytes = chunk.intermediate_output.getSize();
    try writer.print("\n      \"bytes\": {d}", .{chunk_bytes});

    // Write inputs for this output (bytesInOutput is pre-computed during chunk generation)
    try writer.writeAll(",\n      \"inputs\": {");
    var first_chunk_input = true;
    var chunk_iter = chunk.files_with_parts_in_chunk.iterator();
    while (chunk_iter.next()) |entry| {
        const file_source_index = entry.key_ptr.*;
        const bytes_in_output = entry.value_ptr.*;
        if (file_source_index >= sources.len) continue;
        if (file_source_index == Index.runtime.get()) continue;

        const file_source = &sources[file_source_index];
        if (file_source.path.text.len == 0) continue;
        const file_path = file_source.path.pretty;
        if (file_path.len == 0) continue;

        if (!first_chunk_input) {
            try writer.writeAll(",");
        }
        first_chunk_input = false;

        try writer.writeAll("\n        ");
        try writeJSONString(writer, file_path);
        try writer.print(": {{\n          \"bytesInOutput\": {d}\n        }}", .{bytes_in_output});
    }
    try writer.writeAll("\n      }");

    // Write cross-chunk imports
    try writer.writeAll(",\n      \"imports\": [");
    var first_chunk_import = true;
    for (chunk.cross_chunk_imports.slice()) |cross_import| {
        // Bounds check to prevent OOB access from corrupted data
        if (cross_import.chunk_index >= chunks.len) continue;

        if (!first_chunk_import) {
            try writer.writeAll(",");
        }
        first_chunk_import = false;

        const imported_chunk = &chunks[cross_import.chunk_index];
        try writer.writeAll("\n        {\n          \"path\": ");
        try writeJSONString(writer, imported_chunk.final_rel_path);
        try writer.writeAll(",\n          \"kind\": ");
        try writeJSONString(writer, cross_import.import_kind.label());
        try writer.writeAll("\n        }");
    }
    try writer.writeAll("\n      ]");

    // Write exports and entry point if applicable
    // Use sorted_and_filtered_export_aliases for deterministic output and to exclude internal exports
    try writer.writeAll(",\n      \"exports\": [");
    if (chunk.entry_point.is_entry_point) {
        const entry_source_index = chunk.entry_point.source_index;
        // Use sources.len as the authoritative bounds check
        if (entry_source_index < sources.len) {
            const sorted_exports = c.graph.meta.items(.sorted_and_filtered_export_aliases)[entry_source_index];
            var first_export = true;
            for (sorted_exports) |alias| {
                if (!first_export) {
                    try writer.writeAll(",");
                }
                first_export = false;
                try writer.writeAll("\n        ");
                try writeJSONString(writer, alias);
            }
            if (!first_export) {
                try writer.writeAll("\n      ");
            }
        }
    }
    try writer.writeAll("]");

    // Write entry point path
    if (chunk.entry_point.is_entry_point) {
        const entry_source_index = chunk.entry_point.source_index;
        if (entry_source_index < sources.len) {
            const entry_source = &sources[entry_source_index];
            if (entry_source.path.text.len > 0 and entry_source.path.pretty.len > 0) {
                try writer.writeAll(",\n      \"entryPoint\": ");
                try writeJSONString(writer, entry_source.path.pretty);
            }
        }
    }

    // Write cssBundle if this JS chunk has associated CSS
    if (chunk.content == .javascript) {
        const css_chunks = chunk.content.javascript.css_chunks;
        if (css_chunks.len > 0) {
            // Get the first CSS chunk path
            const css_chunk_index = css_chunks[0];
            if (css_chunk_index < chunks.len) {
                const css_chunk = &chunks[css_chunk_index];
                if (css_chunk.final_rel_path.len > 0) {
                    try writer.writeAll(",\n      \"cssBundle\": ");
                    try writeJSONString(writer, css_chunk.final_rel_path);
                }
            }
        }
    }

    try writer.writeAll("\n    }");

    return json.toOwnedSlice();
}

/// Assembles the final metafile JSON from pre-built chunk fragments.
/// Called after all chunks have been generated in parallel.
/// Chunk references (unique_keys) are resolved to their final output paths.
/// The caller is responsible for freeing the returned slice.
pub fn generate(
    allocator: std.mem.Allocator,
    c: *LinkerContext,
    chunks: []Chunk,
) ![]const u8 {
    // Use StringJoiner so we can use breakOutputIntoPieces to resolve chunk references
    var j = StringJoiner{
        .allocator = allocator,
    };
    errdefer j.deinit();

    j.pushStatic("{\n  \"inputs\": {");

    // Collect all input files that are reachable
    var first_input = true;
    const sources = c.parse_graph.input_files.items(.source);
    const loaders = c.parse_graph.input_files.items(.loader);
    const import_records_list = c.parse_graph.ast.items(.import_records);

    // Iterate through all files in chunks to collect unique source indices
    var seen_sources = try std.DynamicBitSet.initEmpty(allocator, sources.len);
    defer seen_sources.deinit();

    // Mark all files that appear in chunks
    for (chunks) |*chunk| {
        var iter = chunk.files_with_parts_in_chunk.iterator();
        while (iter.next()) |entry| {
            const source_index = entry.key_ptr.*;
            if (source_index < sources.len) {
                seen_sources.set(source_index);
            }
        }
    }

    // Write inputs
    var source_index: u32 = 0;
    while (source_index < sources.len) : (source_index += 1) {
        if (!seen_sources.isSet(source_index)) continue;

        // Skip runtime and other special files
        if (source_index == Index.runtime.get()) continue;

        const source = &sources[source_index];
        if (source.path.text.len == 0) continue;

        const path = source.path.pretty;
        if (path.len == 0) continue;

        if (!first_input) {
            j.pushStatic(",");
        }
        first_input = false;

        j.pushStatic("\n    ");
        j.push(try std.fmt.allocPrint(allocator, "{f}", .{bun.fmt.formatJSONStringUTF8(path, .{})}), allocator);
        j.push(try std.fmt.allocPrint(allocator, ": {{\n      \"bytes\": {d}", .{source.contents.len}), allocator);

        // Write imports
        j.pushStatic(",\n      \"imports\": [");
        if (source_index < import_records_list.len) {
            const import_records = import_records_list[source_index];
            var first_import = true;
            for (import_records.slice()) |record| {
                if (record.kind == .internal) continue;

                if (!first_import) {
                    j.pushStatic(",");
                }
                first_import = false;

                j.pushStatic("\n        {\n          \"path\": ");
                // Write path with JSON escaping - chunk references (unique_keys) will be resolved
                // by breakOutputIntoPieces and code() below
                j.push(try std.fmt.allocPrint(allocator, "{f}", .{bun.fmt.formatJSONStringUTF8(record.path.text, .{})}), allocator);
                j.pushStatic(",\n          \"kind\": \"");
                j.pushStatic(record.kind.label());
                j.pushStatic("\"");

                // Add "original" field if different from path
                if (record.original_path.len > 0 and !std.mem.eql(u8, record.original_path, record.path.text)) {
                    j.pushStatic(",\n          \"original\": ");
                    j.push(try std.fmt.allocPrint(allocator, "{f}", .{bun.fmt.formatJSONStringUTF8(record.original_path, .{})}), allocator);
                }

                // Add "external": true for external imports
                if (record.flags.is_external_without_side_effects or !record.source_index.isValid()) {
                    j.pushStatic(",\n          \"external\": true");
                }

                // Add "with" for import attributes (json, toml, text loaders)
                if (record.source_index.isValid() and record.source_index.get() < loaders.len) {
                    const loader = loaders[record.source_index.get()];
                    const with_type: ?[]const u8 = switch (loader) {
                        .json => "json",
                        .toml => "toml",
                        .text => "text",
                        else => null,
                    };
                    if (with_type) |wt| {
                        j.pushStatic(",\n          \"with\": { \"type\": \"");
                        j.pushStatic(wt);
                        j.pushStatic("\" }");
                    }
                }

                j.pushStatic("\n        }");
            }
        }
        j.pushStatic("\n      ]");

        // Write format based on exports_kind (esm vs cjs detection)
        const loader = loaders[source_index];
        const format: ?[]const u8 = switch (loader) {
            .js, .jsx, .ts, .tsx => blk: {
                const exports_kind = c.graph.ast.items(.exports_kind);
                if (source_index < exports_kind.len) {
                    break :blk switch (exports_kind[source_index]) {
                        .cjs, .esm_with_dynamic_fallback_from_cjs => "cjs",
                        .esm, .esm_with_dynamic_fallback => "esm",
                        .none => null, // Unknown format, don't emit
                    };
                }
                break :blk null;
            },
            .json => "json",
            .css => "css",
            else => null,
        };
        if (format) |fmt| {
            j.pushStatic(",\n      \"format\": \"");
            j.pushStatic(fmt);
            j.pushStatic("\"");
        }

        j.pushStatic("\n    }");
    }

    j.pushStatic("\n  },\n  \"outputs\": {");

    // Write outputs by joining pre-built chunk JSON fragments
    var first_output = true;
    for (chunks) |*chunk| {
        if (chunk.final_rel_path.len == 0) continue;

        if (!first_output) {
            j.pushStatic(",");
        }
        first_output = false;

        j.pushStatic("\n    ");
        j.pushStatic(chunk.metafile_chunk_json);
    }

    j.pushStatic("\n  }\n}\n");

    // If no chunks, there are no chunk references to resolve, so just return the joined string
    if (chunks.len == 0) {
        return j.done(allocator);
    }

    // Break output into pieces and resolve chunk references to final paths
    var intermediate = try c.breakOutputIntoPieces(allocator, &j, @intCast(chunks.len));

    // Get final output with all chunk references resolved
    const code_result = try intermediate.code(
        allocator,
        c.parse_graph,
        &c.graph,
        "", // no import prefix for metafile
        &chunks[0], // dummy chunk, not used for metafile
        chunks,
        null, // no display size
        false, // not force absolute path
        false, // no source map shifts
    );

    return code_result.buffer;
}

fn writeJSONString(writer: anytype, str: []const u8) !void {
    try writer.print("{f}", .{bun.fmt.formatJSONStringUTF8(str, .{})});
}

const std = @import("std");

const bun = @import("bun");
const StringJoiner = bun.StringJoiner;

const Chunk = bun.bundle_v2.Chunk;
const Index = bun.bundle_v2.Index;
const LinkerContext = bun.bundle_v2.LinkerContext;
