//! Q: What does this struct do?
//! A: This struct segments the `OutputFile` list into 3 separate spaces so
//!    chunk indexing remains the same:
//!
//!      1. chunks
//!      2. sourcemaps and bytecode
//!      3. additional output files
//!
//!    We can calculate the space ahead of time and avoid having to do something
//!    more complicated or which requires extra work.
//!
//! Q: Why does it need to do that?
//! A: We would like it so if we have a chunk index, we can also index its
//!    corresponding output file in the output file list.
//!
//!    The DevServer uses the `referenced_css_chunks` (a list of chunk indices)
//!    field on `OutputFile` to know which CSS files to hand to the rendering
//!    function. For React this just adds <link> tags that point to each output CSS
//!    file.
//!
//!    However, we previously were pushing sourcemaps and bytecode output files
//!    to the output file list directly after their corresponding chunk, meaning
//!    the index of the chunk in the chunk list and its corresponding
//!    `OutputFile` in the output file list got scrambled.
//!
//!    If we maintain the property that `outputIndexForChunk(chunk[i]) == i`
//!    then we don't need to do any allocations or extra work to get the output
//!    file for a chunk.
pub const OutputFileList = @This();

output_files: std.array_list.Managed(options.OutputFile),
index_for_chunk: u32,
index_for_sourcemaps_and_bytecode: ?u32,
additional_output_files_start: u32,

total_insertions: u32,

pub fn init(
    allocator: std.mem.Allocator,
    c: *const bun.bundle_v2.LinkerContext,
    chunks: []const bun.bundle_v2.Chunk,
    _: usize,
) !@This() {
    const length, const source_map_and_bytecode_count = OutputFileList.calculateOutputFileListCapacity(c, chunks);
    var output_files = try std.array_list.Managed(options.OutputFile).initCapacity(
        allocator,
        length,
    );
    output_files.appendNTimesAssumeCapacity(OutputFile.zero_value, length);

    return .{
        .output_files = output_files,
        .index_for_chunk = 0,
        .index_for_sourcemaps_and_bytecode = if (source_map_and_bytecode_count == 0) null else @as(u32, @truncate(chunks.len)),
        .additional_output_files_start = @as(u32, @intCast(chunks.len)) + source_map_and_bytecode_count,
        .total_insertions = 0,
    };
}

pub fn take(this: *@This()) std.array_list.Managed(options.OutputFile) {
    // TODO: should this return an error
    bun.assertf(this.total_insertions == this.output_files.items.len, "total_insertions ({d}) != output_files.items.len ({d})", .{ this.total_insertions, this.output_files.items.len });
    // Set the length just in case so the list doesn't have undefined memory
    this.output_files.items.len = this.total_insertions;
    const list = this.output_files;
    this.output_files = std.array_list.Managed(options.OutputFile).init(bun.default_allocator);
    return list;
}

pub fn calculateOutputFileListCapacity(c: *const bun.bundle_v2.LinkerContext, chunks: []const bun.bundle_v2.Chunk) struct { u32, u32 } {
    const source_map_count = if (c.options.source_maps.hasExternalFiles()) brk: {
        var count: usize = 0;
        for (chunks) |*chunk| {
            if (chunk.content.sourcemap(c.options.source_maps).hasExternalFiles()) {
                count += 1;
            }
        }
        break :brk count;
    } else 0;
    const bytecode_count = if (c.options.generate_bytecode_cache) bytecode_count: {
        var bytecode_count: usize = 0;
        for (chunks) |*chunk| {
            const loader: bun.options.Loader = if (chunk.entry_point.is_entry_point)
                c.parse_graph.input_files.items(.loader)[
                    chunk.entry_point.source_index
                ]
            else
                .js;

            if (chunk.content == .javascript and loader.isJavaScriptLike()) {
                bytecode_count += 1;
            }
        }
        break :bytecode_count bytecode_count;
    } else 0;

    return .{ @intCast(chunks.len + source_map_count + bytecode_count + c.parse_graph.additional_output_files.items.len), @intCast(source_map_count + bytecode_count) };
}

pub fn insertForChunk(this: *OutputFileList, output_file: options.OutputFile) u32 {
    const index = this.indexForChunk();
    bun.assertf(index < this.index_for_sourcemaps_and_bytecode orelse std.math.maxInt(u32), "index ({d}) \\< index_for_sourcemaps_and_bytecode ({d})", .{ index, this.index_for_sourcemaps_and_bytecode orelse std.math.maxInt(u32) });
    this.output_files.items[index] = output_file;
    this.total_insertions += 1;
    return index;
}

pub fn insertForSourcemapOrBytecode(this: *OutputFileList, output_file: options.OutputFile) !u32 {
    const index = this.indexForSourcemapOrBytecode() orelse return error.NoSourceMapsOrBytecode;
    bun.assertf(index < this.additional_output_files_start, "index ({d}) \\< additional_output_files_start ({d})", .{ index, this.additional_output_files_start });
    this.output_files.items[index] = output_file;
    this.total_insertions += 1;
    return index;
}

pub fn insertAdditionalOutputFiles(this: *OutputFileList, additional_output_files: []const options.OutputFile) void {
    bun.assertf(this.index_for_sourcemaps_and_bytecode orelse 0 <= this.additional_output_files_start, "index_for_sourcemaps_and_bytecode ({d}) \\< additional_output_files_start ({d})", .{ this.index_for_sourcemaps_and_bytecode orelse 0, this.additional_output_files_start });
    bun.copy(
        options.OutputFile,
        this.getMutableAdditionalOutputFiles(),
        additional_output_files,
    );
    this.total_insertions += @as(u32, @intCast(additional_output_files.len));
}

pub fn getMutableAdditionalOutputFiles(this: *OutputFileList) []options.OutputFile {
    return this.output_files.items[this.additional_output_files_start..];
}

fn indexForChunk(this: *@This()) u32 {
    const result = this.index_for_chunk;
    this.index_for_chunk += 1;
    return result;
}

fn indexForSourcemapOrBytecode(this: *@This()) ?u32 {
    const result = this.index_for_sourcemaps_and_bytecode orelse return null;
    this.index_for_sourcemaps_and_bytecode.? += 1;
    return result;
}

const bun = @import("bun");
const std = @import("std");

const options = bun.options;
const OutputFile = options.OutputFile;
