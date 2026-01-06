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

/// Generates metafile JSON for the given chunks.
/// The caller is responsible for freeing the returned slice.
pub fn generate(
    allocator: std.mem.Allocator,
    c: *const LinkerContext,
    chunks: []const Chunk,
) ![]const u8 {
    var json = std.array_list.Managed(u8).init(allocator);
    errdefer json.deinit();

    const writer = json.writer();

    try writer.writeAll("{\n  \"inputs\": {");

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

        // Get the pretty path for this file
        const path = source.path.pretty;
        if (path.len == 0) continue;

        if (!first_input) {
            try writer.writeAll(",");
        }
        first_input = false;

        try writer.writeAll("\n    ");
        try writeJSONString(writer, path);
        try writer.print(": {{\n      \"bytes\": {d}", .{source.contents.len});

        // Write imports
        try writer.writeAll(",\n      \"imports\": [");

        if (source_index < import_records_list.len) {
            const import_records = import_records_list[source_index];
            var first_import = true;
            for (import_records.slice()) |*record| {
                // Skip internal imports
                if (record.kind == .internal) continue;
                if (record.flags.is_internal) continue;
                if (record.flags.is_unused) continue;

                if (!first_import) {
                    try writer.writeAll(",");
                }
                first_import = false;

                // Get the resolved path from the source index, or use the path if external
                const resolved_path = if (!record.source_index.isInvalid() and record.source_index.get() < sources.len)
                    sources[record.source_index.get()].path.pretty
                else
                    record.path.text;

                try writer.writeAll("\n        {\n          \"path\": ");
                try writeJSONString(writer, resolved_path);
                try writer.writeAll(",\n          \"kind\": ");
                try writeJSONString(writer, record.kind.label());

                // Check if external
                if (record.source_index.isInvalid() or record.flags.is_external_without_side_effects) {
                    try writer.writeAll(",\n          \"external\": true");
                }

                // Add original if we have it and it differs from resolved path
                if (record.original_path.len > 0 and !std.mem.eql(u8, record.original_path, resolved_path)) {
                    try writer.writeAll(",\n          \"original\": ");
                    try writeJSONString(writer, record.original_path);
                }

                // Add with clause for import attributes based on loader
                if (record.loader) |loader| {
                    const type_value: ?[]const u8 = switch (loader) {
                        .json => "json",
                        .toml => "toml",
                        .text => "text",
                        else => null,
                    };
                    if (type_value) |tv| {
                        try writer.writeAll(",\n          \"with\": {\n            \"type\": ");
                        try writeJSONString(writer, tv);
                        try writer.writeAll("\n          }");
                    }
                }

                try writer.writeAll("\n        }");
            }
        }

        try writer.writeAll("\n      ]");

        // Write format if it's JS
        const loader = loaders[source_index];
        if (loader.isJavaScriptLike()) {
            const exports_kind = c.parse_graph.ast.items(.exports_kind)[source_index];
            const format_str = switch (exports_kind) {
                .esm => "esm",
                .cjs => "cjs",
                else => null,
            };
            if (format_str) |fmt| {
                try writer.writeAll(",\n      \"format\": \"");
                try writer.writeAll(fmt);
                try writer.writeAll("\"");
            }
        }

        try writer.writeAll("\n    }");
    }

    try writer.writeAll("\n  },\n  \"outputs\": {");

    // Write outputs
    var first_output = true;
    for (chunks) |*chunk| {
        if (chunk.final_rel_path.len == 0) continue;

        if (!first_output) {
            try writer.writeAll(",");
        }
        first_output = false;

        try writer.writeAll("\n    ");
        try writeJSONString(writer, chunk.final_rel_path);
        try writer.writeAll(": {");

        // Calculate bytes
        const chunk_bytes = chunk.intermediate_output.getSize();

        try writer.print("\n      \"bytes\": {d}", .{chunk_bytes});

        // Compute per-source bytes from compile_results_for_chunk
        var source_bytes = std.AutoHashMap(u32, usize).init(allocator);
        defer source_bytes.deinit();

        for (chunk.compile_results_for_chunk) |compile_result| {
            const code_len = compile_result.code().len;
            if (code_len > 0) {
                const src_idx = compile_result.sourceIndex();
                // Bounds check: skip runtime and invalid source indices
                if (src_idx >= sources.len or src_idx == Index.runtime.get()) continue;
                const entry = try source_bytes.getOrPut(src_idx);
                if (!entry.found_existing) {
                    entry.value_ptr.* = 0;
                }
                entry.value_ptr.* += code_len;
            }
        }

        // Write inputs for this output
        try writer.writeAll(",\n      \"inputs\": {");
        var first_chunk_input = true;
        var chunk_iter = chunk.files_with_parts_in_chunk.iterator();
        while (chunk_iter.next()) |entry| {
            const file_source_index = entry.key_ptr.*;
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
            // Use the actual bytes emitted for this source in this chunk
            const bytes_in_output = source_bytes.get(file_source_index) orelse 0;
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
        try writer.writeAll(",\n      \"exports\": [");
        if (chunk.entry_point.is_entry_point) {
            const entry_source_index = chunk.entry_point.source_index;
            // Use sources.len as the authoritative bounds check
            if (entry_source_index < sources.len) {
                const resolved_exports = c.graph.meta.items(.resolved_exports)[entry_source_index];
                var first_export = true;
                var export_iter = resolved_exports.iterator();
                while (export_iter.next()) |export_entry| {
                    if (!first_export) {
                        try writer.writeAll(",");
                    }
                    first_export = false;
                    try writer.writeAll("\n        ");
                    try writeJSONString(writer, export_entry.key_ptr.*);
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
    }

    try writer.writeAll("\n  }\n}\n");

    return json.toOwnedSlice();
}

fn writeJSONString(writer: anytype, str: []const u8) !void {
    try writer.print("{f}", .{bun.fmt.formatJSONStringUTF8(str, .{})});
}

const bun = @import("bun");
const std = @import("std");

const Chunk = bun.bundle_v2.Chunk;
const Index = bun.bundle_v2.Index;
const LinkerContext = bun.bundle_v2.LinkerContext;
