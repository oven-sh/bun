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

/// Generates a markdown visualization of the module graph from metafile JSON.
/// This is a post-processing step that parses the JSON and produces LLM-friendly output.
/// Designed to help diagnose bundle bloat, dependency chains, and entry point analysis.
/// The caller is responsible for freeing the returned slice.
pub fn generateMarkdown(allocator: std.mem.Allocator, metafile_json: []const u8) ![]const u8 {
    const parsed = std.json.parseFromSlice(std.json.Value, allocator, metafile_json, .{}) catch {
        return error.InvalidJSON;
    };
    defer parsed.deinit();

    const root = parsed.value;
    if (root != .object) return error.InvalidJSON;

    var md = std.array_list.Managed(u8).init(allocator);
    errdefer md.deinit();
    const writer = md.writer();

    // Get inputs and outputs
    const inputs = root.object.get("inputs") orelse return error.InvalidJSON;
    const outputs = root.object.get("outputs") orelse return error.InvalidJSON;

    if (inputs != .object or outputs != .object) return error.InvalidJSON;

    // Header
    try writer.writeAll("# Bundle Analysis Report\n\n");
    try writer.writeAll("This report helps identify bundle size issues, dependency bloat, and optimization opportunities.\n\n");

    // Table of Contents for easy navigation
    try writer.writeAll("## Table of Contents\n\n");
    try writer.writeAll("- [Quick Summary](#quick-summary)\n");
    try writer.writeAll("- [Largest Input Files](#largest-input-files-potential-bloat)\n");
    try writer.writeAll("- [Entry Point Analysis](#entry-point-analysis)\n");
    try writer.writeAll("- [Dependency Chains](#dependency-chains)\n");
    try writer.writeAll("- [Full Module Graph](#full-module-graph)\n");
    try writer.writeAll("- [Raw Data for Searching](#raw-data-for-searching)\n\n");
    try writer.writeAll("---\n\n");

    // ==================== SUMMARY ====================
    try writer.writeAll("## Quick Summary\n\n");

    var total_input_bytes: u64 = 0;
    var total_output_bytes: u64 = 0;
    var esm_count: u32 = 0;
    var cjs_count: u32 = 0;
    var json_count: u32 = 0;
    var external_count: u32 = 0;
    var node_modules_count: u32 = 0;
    var node_modules_bytes: u64 = 0;

    // Build reverse dependency map: who imports each file?
    // Also collect input file data for sorting
    const InputFileInfo = struct {
        path: []const u8,
        bytes: u64,
        import_count: u32,
        is_node_modules: bool,
        format: []const u8,
    };

    var input_files: std.ArrayListUnmanaged(InputFileInfo) = .{};
    defer input_files.deinit(allocator);

    var imported_by = bun.StringHashMap(std.ArrayListUnmanaged([]const u8)).init(allocator);
    defer {
        var it = imported_by.valueIterator();
        while (it.next()) |list| {
            list.deinit(allocator);
        }
        imported_by.deinit();
    }

    // First pass: collect all input file info and build reverse dependency map
    var input_iter = inputs.object.iterator();
    while (input_iter.next()) |entry| {
        const path = entry.key_ptr.*;
        const input = entry.value_ptr.*;
        if (input != .object) continue;

        var info = InputFileInfo{
            .path = path,
            .bytes = 0,
            .import_count = 0,
            .is_node_modules = std.mem.indexOf(u8, path, "node_modules") != null,
            .format = "",
        };

        if (input.object.get("bytes")) |bytes| {
            if (bytes == .integer) {
                info.bytes = @intCast(bytes.integer);
                total_input_bytes += info.bytes;
                if (info.is_node_modules) {
                    node_modules_bytes += info.bytes;
                    node_modules_count += 1;
                }
            }
        }

        if (input.object.get("format")) |format| {
            if (format == .string) {
                info.format = format.string;
                if (std.mem.eql(u8, format.string, "esm")) {
                    esm_count += 1;
                } else if (std.mem.eql(u8, format.string, "cjs")) {
                    cjs_count += 1;
                } else if (std.mem.eql(u8, format.string, "json")) {
                    json_count += 1;
                }
            }
        }

        // Build reverse dependency map
        if (input.object.get("imports")) |imps| {
            if (imps == .array) {
                info.import_count = @intCast(imps.array.items.len);
                for (imps.array.items) |imp| {
                    if (imp == .object) {
                        if (imp.object.get("external")) |ext| {
                            if (ext == .bool and ext.bool) {
                                external_count += 1;
                                continue;
                            }
                        }
                        if (imp.object.get("path")) |imp_path| {
                            if (imp_path == .string) {
                                // Try to find the matching input key for this import
                                // The import path may be absolute while input keys are relative
                                // Or it may be a relative path like "../utils/logger.js"
                                const target = imp_path.string;

                                // First, try exact match
                                var matched_key: ?[]const u8 = null;
                                if (inputs.object.contains(target)) {
                                    matched_key = target;
                                } else {
                                    // Try matching by basename or suffix
                                    var key_iter = inputs.object.iterator();
                                    while (key_iter.next()) |key_entry| {
                                        const input_key = key_entry.key_ptr.*;
                                        // Check if target ends with the input key
                                        if (std.mem.endsWith(u8, target, input_key)) {
                                            // Make sure it's a path boundary (preceded by / or start)
                                            if (target.len == input_key.len or
                                                (target.len > input_key.len and target[target.len - input_key.len - 1] == '/'))
                                            {
                                                matched_key = input_key;
                                                break;
                                            }
                                        }
                                        // Also check if input_key ends with target (for relative paths)
                                        // e.g., target="../utils/logger.js" might match "src/utils/logger.js"
                                        if (std.mem.indexOf(u8, target, "..") != null) {
                                            // This is a relative path, try matching just the filename parts
                                            const target_base = std.fs.path.basename(target);
                                            const key_base = std.fs.path.basename(input_key);
                                            if (std.mem.eql(u8, target_base, key_base)) {
                                                // Check if paths share common suffix
                                                const target_without_dots = stripParentRefs(target);
                                                if (std.mem.endsWith(u8, input_key, target_without_dots)) {
                                                    matched_key = input_key;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }

                                if (matched_key) |key| {
                                    const gop = try imported_by.getOrPut(key);
                                    if (!gop.found_existing) {
                                        gop.value_ptr.* = .{};
                                    }
                                    try gop.value_ptr.append(allocator, path);
                                }
                            }
                        }
                    }
                }
            }
        }

        try input_files.append(allocator, info);
    }

    // Count outputs and entry points
    var entry_point_count: u32 = 0;
    var chunk_count: u32 = 0;
    var output_iter = outputs.object.iterator();
    while (output_iter.next()) |entry| {
        if (entry.value_ptr.* == .object) {
            if (entry.value_ptr.object.get("bytes")) |bytes| {
                if (bytes == .integer) {
                    total_output_bytes += @intCast(bytes.integer);
                }
            }
            if (entry.value_ptr.object.get("entryPoint")) |_| {
                entry_point_count += 1;
            } else {
                chunk_count += 1;
            }
        }
    }

    // Summary table
    try writer.writeAll("| Metric | Value |\n");
    try writer.writeAll("|--------|-------|\n");
    try writer.print("| Total input size | {f} |\n", .{bun.fmt.size(total_input_bytes, .{})});
    try writer.print("| Total output size | {f} |\n", .{bun.fmt.size(total_output_bytes, .{})});
    try writer.print("| Input modules | {d} |\n", .{inputs.object.count()});
    if (entry_point_count > 0) {
        try writer.print("| Entry points | {d} |\n", .{entry_point_count});
    }
    if (chunk_count > 0) {
        try writer.print("| Code-split chunks | {d} |\n", .{chunk_count});
    }
    if (node_modules_count > 0) {
        try writer.print("| node_modules files | {d} ({f}) |\n", .{ node_modules_count, bun.fmt.size(node_modules_bytes, .{}) });
    }
    if (esm_count > 0) try writer.print("| ESM modules | {d} |\n", .{esm_count});
    if (cjs_count > 0) try writer.print("| CommonJS modules | {d} |\n", .{cjs_count});
    if (json_count > 0) try writer.print("| JSON files | {d} |\n", .{json_count});
    if (external_count > 0) try writer.print("| External imports | {d} |\n", .{external_count});

    // Compression ratio
    if (total_input_bytes > 0) {
        const ratio = @as(f64, @floatFromInt(total_output_bytes)) / @as(f64, @floatFromInt(total_input_bytes)) * 100.0;
        try writer.print("| Output/Input ratio | {d:.1}% |\n", .{ratio});
    }

    // ==================== LARGEST FILES (BLOAT ANALYSIS) ====================
    try writer.writeAll("\n## Largest Input Files (Potential Bloat)\n\n");
    try writer.writeAll("Files sorted by source size. Large files may indicate bloat or vendored code.\n\n");

    // Sort by bytes descending
    std.mem.sort(InputFileInfo, input_files.items, {}, struct {
        fn lessThan(_: void, a: InputFileInfo, b: InputFileInfo) bool {
            return a.bytes > b.bytes;
        }
    }.lessThan);

    try writer.writeAll("| Size | % of Total | Module | Format |\n");
    try writer.writeAll("|------|------------|--------|--------|\n");

    const max_to_show: usize = 20;
    for (input_files.items, 0..) |info, i| {
        if (i >= max_to_show) break;
        const pct = if (total_input_bytes > 0)
            @as(f64, @floatFromInt(info.bytes)) / @as(f64, @floatFromInt(total_input_bytes)) * 100.0
        else
            0.0;
        try writer.print("| {f} | {d:.1}% | `{s}` | {s} |\n", .{
            bun.fmt.size(info.bytes, .{}),
            pct,
            info.path,
            if (info.format.len > 0) info.format else "-",
        });
    }

    if (input_files.items.len > max_to_show) {
        try writer.print("\n*...and {d} more files*\n", .{input_files.items.len - max_to_show});
    }

    // ==================== ENTRY POINT ANALYSIS ====================
    try writer.writeAll("\n## Entry Point Analysis\n\n");
    try writer.writeAll("Each entry point and the total code it loads (including shared chunks).\n\n");

    var out_iter2 = outputs.object.iterator();
    while (out_iter2.next()) |entry| {
        const output_path = entry.key_ptr.*;
        const output = entry.value_ptr.*;
        if (output != .object) continue;

        const entry_point = output.object.get("entryPoint") orelse continue;
        if (entry_point != .string) continue;

        try writer.print("### Entry: `{s}`\n\n", .{entry_point.string});

        // Output file info
        try writer.print("**Output file**: `{s}`\n", .{output_path});

        if (output.object.get("bytes")) |bytes| {
            if (bytes == .integer) {
                try writer.print("**Bundle size**: {f}\n", .{bun.fmt.size(@as(u64, @intCast(bytes.integer)), .{})});
            }
        }

        // CSS bundle
        if (output.object.get("cssBundle")) |css_bundle| {
            if (css_bundle == .string) {
                try writer.print("**CSS bundle**: `{s}`\n", .{css_bundle.string});
            }
        }

        // Exports
        if (output.object.get("exports")) |exports| {
            if (exports == .array and exports.array.items.len > 0) {
                try writer.writeAll("**Exports**: ");
                var first = true;
                const max_exports: usize = 10;
                for (exports.array.items, 0..) |exp, i| {
                    if (i >= max_exports) {
                        try writer.print(" ...+{d} more", .{exports.array.items.len - max_exports});
                        break;
                    }
                    if (exp == .string) {
                        if (!first) try writer.writeAll(", ");
                        first = false;
                        try writer.print("`{s}`", .{exp.string});
                    }
                }
                try writer.writeAll("\n");
            }
        }

        // Chunk dependencies
        if (output.object.get("imports")) |chunk_imports| {
            if (chunk_imports == .array and chunk_imports.array.items.len > 0) {
                try writer.writeAll("\n**Loads these chunks** (code-splitting):\n");
                for (chunk_imports.array.items) |imp| {
                    if (imp == .object) {
                        const path = imp.object.get("path") orelse continue;
                        const kind = imp.object.get("kind") orelse continue;
                        if (path == .string and kind == .string) {
                            // Try to get chunk size
                            if (outputs.object.get(path.string)) |chunk| {
                                if (chunk == .object) {
                                    if (chunk.object.get("bytes")) |bytes| {
                                        if (bytes == .integer) {
                                            try writer.print("- `{s}` ({f}, {s})\n", .{
                                                path.string,
                                                bun.fmt.size(@as(u64, @intCast(bytes.integer)), .{}),
                                                kind.string,
                                            });
                                            continue;
                                        }
                                    }
                                }
                            }
                            try writer.print("- `{s}` ({s})\n", .{ path.string, kind.string });
                        }
                    }
                }
            }
        }

        // Modules bundled into this entry
        if (output.object.get("inputs")) |output_inputs| {
            if (output_inputs == .object and output_inputs.object.count() > 0) {
                try writer.writeAll("\n**Bundled modules** (sorted by contribution):\n\n");
                try writer.writeAll("| Bytes | Module |\n");
                try writer.writeAll("|-------|--------|\n");

                // Collect and sort by size
                const ModuleSize = struct { path: []const u8, bytes: u64 };
                var module_sizes: std.ArrayListUnmanaged(ModuleSize) = .{};
                defer module_sizes.deinit(allocator);

                var oi_iter = output_inputs.object.iterator();
                while (oi_iter.next()) |oi_entry| {
                    const module_path = oi_entry.key_ptr.*;
                    const module_info = oi_entry.value_ptr.*;
                    if (module_info == .object) {
                        if (module_info.object.get("bytesInOutput")) |bio| {
                            if (bio == .integer) {
                                try module_sizes.append(allocator, .{ .path = module_path, .bytes = @intCast(bio.integer) });
                            }
                        }
                    }
                }

                std.mem.sort(ModuleSize, module_sizes.items, {}, struct {
                    fn lessThan(_: void, a: ModuleSize, b: ModuleSize) bool {
                        return a.bytes > b.bytes;
                    }
                }.lessThan);

                const max_modules: usize = 15;
                for (module_sizes.items, 0..) |ms, i| {
                    if (i >= max_modules) break;
                    try writer.print("| {f} | `{s}` |\n", .{ bun.fmt.size(ms.bytes, .{}), ms.path });
                }
                if (module_sizes.items.len > max_modules) {
                    try writer.print("\n*...and {d} more modules*\n", .{module_sizes.items.len - max_modules});
                }
            }
        }

        try writer.writeAll("\n");
    }

    // ==================== DEPENDENCY CHAINS (WHY IS THIS INCLUDED?) ====================
    try writer.writeAll("## Dependency Chains\n\n");
    try writer.writeAll("For each module, shows what files import it. Use this to understand why a module is included.\n\n");

    // Show modules that are imported by many files (potential optimization targets)
    const ImportedByInfo = struct { path: []const u8, count: usize };
    var highly_imported: std.ArrayListUnmanaged(ImportedByInfo) = .{};
    defer highly_imported.deinit(allocator);

    var ib_iter = imported_by.iterator();
    while (ib_iter.next()) |entry| {
        try highly_imported.append(allocator, .{ .path = entry.key_ptr.*, .count = entry.value_ptr.items.len });
    }

    std.mem.sort(ImportedByInfo, highly_imported.items, {}, struct {
        fn lessThan(_: void, a: ImportedByInfo, b: ImportedByInfo) bool {
            return a.count > b.count;
        }
    }.lessThan);

    // Show most commonly imported modules
    if (highly_imported.items.len > 0) {
        try writer.writeAll("### Most Commonly Imported Modules\n\n");
        try writer.writeAll("Modules imported by many files. Extracting these to shared chunks may help.\n\n");
        try writer.writeAll("| Import Count | Module | Imported By |\n");
        try writer.writeAll("|--------------|--------|-------------|\n");

        const max_common: usize = 15;
        for (highly_imported.items, 0..) |hi, i| {
            if (i >= max_common) break;
            if (hi.count < 2) break; // Only show if imported by 2+ files

            try writer.print("| {d} | `{s}` | ", .{ hi.count, hi.path });

            // Show first few importers
            if (imported_by.get(hi.path)) |importers| {
                const max_importers: usize = 3;
                for (importers.items, 0..) |importer, j| {
                    if (j >= max_importers) {
                        try writer.print("+{d} more", .{importers.items.len - max_importers});
                        break;
                    }
                    if (j > 0) try writer.writeAll(", ");
                    try writer.print("`{s}`", .{importer});
                }
            }
            try writer.writeAll(" |\n");
        }
    }

    // ==================== FULL MODULE GRAPH ====================
    try writer.writeAll("\n## Full Module Graph\n\n");
    try writer.writeAll("Complete dependency information for each module.\n\n");

    // Sort inputs alphabetically for easier navigation
    const PathOnly = struct { path: []const u8 };
    var sorted_paths: std.ArrayListUnmanaged(PathOnly) = .{};
    defer sorted_paths.deinit(allocator);

    var path_iter = inputs.object.iterator();
    while (path_iter.next()) |entry| {
        try sorted_paths.append(allocator, .{ .path = entry.key_ptr.* });
    }

    std.mem.sort(PathOnly, sorted_paths.items, {}, struct {
        fn lessThan(_: void, a: PathOnly, b: PathOnly) bool {
            return std.mem.lessThan(u8, a.path, b.path);
        }
    }.lessThan);

    for (sorted_paths.items) |sp| {
        const input_path = sp.path;
        const input = inputs.object.get(input_path) orelse continue;
        if (input != .object) continue;

        try writer.print("### `{s}`\n\n", .{input_path});

        // Input metadata
        if (input.object.get("bytes")) |bytes| {
            if (bytes == .integer) {
                try writer.print("- **Size**: {f}\n", .{bun.fmt.size(@as(u64, @intCast(bytes.integer)), .{})});
            }
        }

        if (input.object.get("format")) |format| {
            if (format == .string) {
                try writer.print("- **Format**: {s}\n", .{format.string});
            }
        }

        // Who imports this file?
        if (imported_by.get(input_path)) |importers| {
            try writer.print("- **Imported by** ({d} files):", .{importers.items.len});
            if (importers.items.len <= 5) {
                for (importers.items) |importer| {
                    try writer.print(" `{s}`", .{importer});
                }
            } else {
                for (importers.items[0..5]) |importer| {
                    try writer.print(" `{s}`", .{importer});
                }
                try writer.print(" +{d} more", .{importers.items.len - 5});
            }
            try writer.writeAll("\n");
        } else {
            // This is likely an entry point
            try writer.writeAll("- **Imported by**: (entry point or orphan)\n");
        }

        // What does this file import?
        if (input.object.get("imports")) |imps| {
            if (imps == .array and imps.array.items.len > 0) {
                try writer.writeAll("- **Imports**:\n");
                for (imps.array.items) |imp| {
                    if (imp == .object) {
                        const path = imp.object.get("path") orelse continue;
                        const kind = imp.object.get("kind") orelse continue;
                        if (path != .string or kind != .string) continue;

                        const is_external = blk: {
                            if (imp.object.get("external")) |ext| {
                                if (ext == .bool) break :blk ext.bool;
                            }
                            break :blk false;
                        };

                        const original = blk: {
                            if (imp.object.get("original")) |orig| {
                                if (orig == .string) break :blk orig.string;
                            }
                            break :blk null;
                        };

                        // Get size of imported file if available
                        var imported_size: ?u64 = null;
                        if (!is_external) {
                            if (inputs.object.get(path.string)) |imported_input| {
                                if (imported_input == .object) {
                                    if (imported_input.object.get("bytes")) |bytes| {
                                        if (bytes == .integer) {
                                            imported_size = @intCast(bytes.integer);
                                        }
                                    }
                                }
                            }
                        }

                        if (is_external) {
                            if (original) |orig| {
                                try writer.print("  - `{s}` ({s}, **external**, specifier: `{s}`)\n", .{ path.string, kind.string, orig });
                            } else {
                                try writer.print("  - `{s}` ({s}, **external**)\n", .{ path.string, kind.string });
                            }
                        } else if (imported_size) |size| {
                            if (original) |orig| {
                                try writer.print("  - `{s}` ({s}, {f}, specifier: `{s}`)\n", .{ path.string, kind.string, bun.fmt.size(size, .{}), orig });
                            } else {
                                try writer.print("  - `{s}` ({s}, {f})\n", .{ path.string, kind.string, bun.fmt.size(size, .{}) });
                            }
                        } else {
                            if (original) |orig| {
                                try writer.print("  - `{s}` ({s}, specifier: `{s}`)\n", .{ path.string, kind.string, orig });
                            } else {
                                try writer.print("  - `{s}` ({s})\n", .{ path.string, kind.string });
                            }
                        }

                        // Show import attributes if present
                        if (imp.object.get("with")) |with| {
                            if (with == .object) {
                                if (with.object.get("type")) |type_val| {
                                    if (type_val == .string) {
                                        try writer.print("    - with type: `{s}`\n", .{type_val.string});
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        try writer.writeAll("\n");
    }

    // ==================== RAW DATA FOR SEARCHING ====================
    try writer.writeAll("## Raw Data for Searching\n\n");
    try writer.writeAll("This section contains raw, grep-friendly data. Use these patterns:\n");
    try writer.writeAll("- `[MODULE:` - Find all modules\n");
    try writer.writeAll("- `[SIZE:` - Find all file sizes\n");
    try writer.writeAll("- `[IMPORT:` - Find all import relationships\n");
    try writer.writeAll("- `[IMPORTED_BY:` - Find reverse dependencies\n");
    try writer.writeAll("- `[ENTRY:` - Find entry points\n");
    try writer.writeAll("- `[EXTERNAL:` - Find external imports\n");
    try writer.writeAll("- `[NODE_MODULES:` - Find node_modules files\n\n");

    // All modules with sizes
    try writer.writeAll("### All Modules\n\n");
    try writer.writeAll("```\n");
    for (input_files.items) |info| {
        try writer.print("[MODULE: {s}]\n", .{info.path});
        try writer.print("[SIZE: {s} = {d} bytes]\n", .{ info.path, info.bytes });
        if (info.format.len > 0) {
            try writer.print("[FORMAT: {s} = {s}]\n", .{ info.path, info.format });
        }
        if (info.is_node_modules) {
            try writer.print("[NODE_MODULES: {s}]\n", .{info.path});
        }
    }
    try writer.writeAll("```\n\n");

    // All import relationships
    try writer.writeAll("### All Imports\n\n");
    try writer.writeAll("```\n");
    var import_iter2 = inputs.object.iterator();
    while (import_iter2.next()) |entry| {
        const source_path = entry.key_ptr.*;
        const input2 = entry.value_ptr.*;
        if (input2 != .object) continue;

        if (input2.object.get("imports")) |imps| {
            if (imps == .array) {
                for (imps.array.items) |imp| {
                    if (imp == .object) {
                        const is_ext = blk: {
                            if (imp.object.get("external")) |ext| {
                                if (ext == .bool) break :blk ext.bool;
                            }
                            break :blk false;
                        };

                        if (imp.object.get("path")) |imp_path| {
                            if (imp_path == .string) {
                                if (is_ext) {
                                    try writer.print("[EXTERNAL: {s} imports {s}]\n", .{ source_path, imp_path.string });
                                } else {
                                    try writer.print("[IMPORT: {s} -> {s}]\n", .{ source_path, imp_path.string });
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    try writer.writeAll("```\n\n");

    // All reverse dependencies (imported by)
    try writer.writeAll("### Reverse Dependencies (Imported By)\n\n");
    try writer.writeAll("```\n");
    var ib_iter2 = imported_by.iterator();
    while (ib_iter2.next()) |entry| {
        const target = entry.key_ptr.*;
        for (entry.value_ptr.items) |importer| {
            try writer.print("[IMPORTED_BY: {s} <- {s}]\n", .{ target, importer });
        }
    }
    try writer.writeAll("```\n\n");

    // Entry points
    try writer.writeAll("### Entry Points\n\n");
    try writer.writeAll("```\n");
    var out_iter3 = outputs.object.iterator();
    while (out_iter3.next()) |entry| {
        const output_path2 = entry.key_ptr.*;
        const output2 = entry.value_ptr.*;
        if (output2 != .object) continue;

        if (output2.object.get("entryPoint")) |ep| {
            if (ep == .string) {
                var size: u64 = 0;
                if (output2.object.get("bytes")) |bytes| {
                    if (bytes == .integer) {
                        size = @intCast(bytes.integer);
                    }
                }
                try writer.print("[ENTRY: {s} -> {s} ({d} bytes)]\n", .{ ep.string, output_path2, size });
            }
        }
    }
    try writer.writeAll("```\n\n");

    // node_modules summary
    if (node_modules_count > 0) {
        try writer.writeAll("### node_modules Summary\n\n");
        try writer.writeAll("```\n");
        for (input_files.items) |info| {
            if (info.is_node_modules) {
                try writer.print("[NODE_MODULES: {s} ({d} bytes)]\n", .{ info.path, info.bytes });
            }
        }
        try writer.writeAll("```\n");
    }

    return md.toOwnedSlice();
}

/// Strips leading "../" sequences from a relative path.
/// e.g., "../utils/logger.js" -> "utils/logger.js"
fn stripParentRefs(path: []const u8) []const u8 {
    var result = path;
    while (result.len >= 3 and std.mem.startsWith(u8, result, "../")) {
        result = result[3..];
    }
    // Also handle ./ prefix
    while (result.len >= 2 and std.mem.startsWith(u8, result, "./")) {
        result = result[2..];
    }
    return result;
}

const std = @import("std");

const bun = @import("bun");
const StringJoiner = bun.StringJoiner;

const Chunk = bun.bundle_v2.Chunk;
const Index = bun.bundle_v2.Index;
const LinkerContext = bun.bundle_v2.LinkerContext;
