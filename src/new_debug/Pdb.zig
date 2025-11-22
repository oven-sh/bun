const std = @import("std");
const File = std.fs.File;
const Allocator = std.mem.Allocator;
const pdb = std.pdb;
const assert = std.debug.assert;

const Pdb = @This();

file_reader: *File.Reader,
msf: Msf,
allocator: Allocator,
string_table: ?*MsfStream,
dbi: ?*MsfStream,
modules: []Module,
sect_contribs: []pdb.SectionContribEntry,
guid: [16]u8,
age: u32,

pub const Module = struct {
    mod_info: pdb.ModInfo,
    module_name: []u8,
    obj_file_name: []u8,
    // The fields below are filled on demand.
    populated: bool,
    symbols: []u8,
    subsect_info: []u8,
    checksum_offset: ?usize,

    pub fn deinit(self: *Module, allocator: Allocator) void {
        allocator.free(self.module_name);
        allocator.free(self.obj_file_name);
        if (self.populated) {
            allocator.free(self.symbols);
            allocator.free(self.subsect_info);
        }
    }
};

pub fn init(gpa: Allocator, file_reader: *File.Reader) !Pdb {
    return .{
        .file_reader = file_reader,
        .allocator = gpa,
        .string_table = null,
        .dbi = null,
        .msf = try Msf.init(gpa, file_reader),
        .modules = &.{},
        .sect_contribs = &.{},
        .guid = undefined,
        .age = undefined,
    };
}

pub fn deinit(self: *Pdb) void {
    const gpa = self.allocator;
    self.msf.deinit(gpa);
    for (self.modules) |*module| {
        module.deinit(gpa);
    }
    gpa.free(self.modules);
    gpa.free(self.sect_contribs);
}

pub fn parseDbiStream(self: *Pdb) !void {
    var stream = self.getStream(pdb.StreamType.dbi) orelse
        return error.InvalidDebugInfo;

    const gpa = self.allocator;
    const reader = &stream.interface;

    const header = try reader.takeStruct(std.pdb.DbiStreamHeader, .little);
    if (header.version_header != 19990903) // V70, only value observed by LLVM team
        return error.UnknownPDBVersion;
    // if (header.Age != age)
    //     return error.UnmatchingPDB;

    const mod_info_size = header.mod_info_size;
    const section_contrib_size = header.section_contribution_size;

    var modules = std.array_list.Managed(Module).init(gpa);
    errdefer modules.deinit();

    // Module Info Substream
    var mod_info_offset: usize = 0;
    while (mod_info_offset != mod_info_size) {
        const mod_info = try reader.takeStruct(pdb.ModInfo, .little);
        var this_record_len: usize = @sizeOf(pdb.ModInfo);

        var module_name: std.Io.Writer.Allocating = .init(gpa);
        defer module_name.deinit();
        this_record_len += try reader.streamDelimiterLimit(&module_name.writer, 0, .limited(1024));
        assert(reader.buffered()[0] == 0); // TODO change streamDelimiterLimit API
        reader.toss(1);
        this_record_len += 1;

        var obj_file_name: std.Io.Writer.Allocating = .init(gpa);
        defer obj_file_name.deinit();
        this_record_len += try reader.streamDelimiterLimit(&obj_file_name.writer, 0, .limited(1024));
        assert(reader.buffered()[0] == 0); // TODO change streamDelimiterLimit API
        reader.toss(1);
        this_record_len += 1;

        if (this_record_len % 4 != 0) {
            const round_to_next_4 = (this_record_len | 0x3) + 1;
            const march_forward_bytes = round_to_next_4 - this_record_len;
            try stream.seekBy(@as(isize, @intCast(march_forward_bytes)));
            this_record_len += march_forward_bytes;
        }

        try modules.append(.{
            .mod_info = mod_info,
            .module_name = try module_name.toOwnedSlice(),
            .obj_file_name = try obj_file_name.toOwnedSlice(),

            .populated = false,
            .symbols = undefined,
            .subsect_info = undefined,
            .checksum_offset = null,
        });

        mod_info_offset += this_record_len;
        if (mod_info_offset > mod_info_size)
            return error.InvalidDebugInfo;
    }

    // Section Contribution Substream
    var sect_contribs = std.array_list.Managed(pdb.SectionContribEntry).init(gpa);
    errdefer sect_contribs.deinit();

    var sect_cont_offset: usize = 0;
    if (section_contrib_size != 0) {
        const version = reader.takeEnum(std.pdb.SectionContrSubstreamVersion, .little) catch |err| switch (err) {
            error.InvalidEnumTag, error.EndOfStream => return error.InvalidDebugInfo,
            error.ReadFailed => return error.ReadFailed,
        };
        _ = version;
        sect_cont_offset += @sizeOf(u32);
    }
    while (sect_cont_offset != section_contrib_size) {
        const entry = try sect_contribs.addOne();
        entry.* = try reader.takeStruct(pdb.SectionContribEntry, .little);
        sect_cont_offset += @sizeOf(pdb.SectionContribEntry);

        if (sect_cont_offset > section_contrib_size)
            return error.InvalidDebugInfo;
    }

    self.modules = try modules.toOwnedSlice();
    self.sect_contribs = try sect_contribs.toOwnedSlice();
}

pub fn parseInfoStream(self: *Pdb) !void {
    var stream = self.getStream(pdb.StreamType.pdb) orelse return error.InvalidDebugInfo;
    const reader = &stream.interface;

    // Parse the InfoStreamHeader.
    const version = try reader.takeInt(u32, .little);
    const signature = try reader.takeInt(u32, .little);
    _ = signature;
    const age = try reader.takeInt(u32, .little);
    const guid = try reader.takeArray(16);

    if (version != 20000404) // VC70, only value observed by LLVM team
        return error.UnknownPDBVersion;

    self.guid = guid.*;
    self.age = age;

    const gpa = self.allocator;

    // Find the string table.
    const string_table_index = str_tab_index: {
        const name_bytes_len = try reader.takeInt(u32, .little);
        const name_bytes = try reader.readAlloc(gpa, name_bytes_len);
        defer gpa.free(name_bytes);

        const HashTableHeader = extern struct {
            size: u32,
            capacity: u32,

            fn maxLoad(cap: u32) u32 {
                return cap * 2 / 3 + 1;
            }
        };
        const hash_tbl_hdr = try reader.takeStruct(HashTableHeader, .little);
        if (hash_tbl_hdr.capacity == 0)
            return error.InvalidDebugInfo;

        if (hash_tbl_hdr.size > HashTableHeader.maxLoad(hash_tbl_hdr.capacity))
            return error.InvalidDebugInfo;

        const present = try readSparseBitVector(reader, gpa);
        defer gpa.free(present);
        if (present.len != hash_tbl_hdr.size)
            return error.InvalidDebugInfo;
        const deleted = try readSparseBitVector(reader, gpa);
        defer gpa.free(deleted);

        for (present) |_| {
            const name_offset = try reader.takeInt(u32, .little);
            const name_index = try reader.takeInt(u32, .little);
            if (name_offset > name_bytes.len)
                return error.InvalidDebugInfo;
            const name = std.mem.sliceTo(name_bytes[name_offset..], 0);
            if (std.mem.eql(u8, name, "/names")) {
                break :str_tab_index name_index;
            }
        }
        return error.MissingDebugInfo;
    };

    self.string_table = self.getStreamById(string_table_index) orelse
        return error.MissingDebugInfo;
}

pub fn getSymbolName(self: *Pdb, module: *Module, address: u64) ?[]const u8 {
    _ = self;
    std.debug.assert(module.populated);

    var symbol_i: usize = 0;
    while (symbol_i != module.symbols.len) {
        const prefix: *align(1) pdb.RecordPrefix = @ptrCast(&module.symbols[symbol_i]);
        if (prefix.record_len < 2)
            return null;
        switch (prefix.record_kind) {
            .lproc32, .gproc32 => {
                const proc_sym: *align(1) pdb.ProcSym = @ptrCast(&module.symbols[symbol_i + @sizeOf(pdb.RecordPrefix)]);
                if (address >= proc_sym.code_offset and address < proc_sym.code_offset + proc_sym.code_size) {
                    return std.mem.sliceTo(@as([*:0]u8, @ptrCast(&proc_sym.name[0])), 0);
                }
            },
            else => {},
        }
        symbol_i += prefix.record_len + @sizeOf(u16);
    }

    return null;
}

pub fn getLineNumberInfo(self: *Pdb, module: *Module, address: u64) !std.debug.SourceLocation {
    std.debug.assert(module.populated);
    const subsect_info = module.subsect_info;
    const gpa = self.allocator;

    var sect_offset: usize = 0;
    var skip_len: usize = undefined;
    const checksum_offset = module.checksum_offset orelse return error.MissingDebugInfo;
    while (sect_offset != subsect_info.len) : (sect_offset += skip_len) {
        const subsect_hdr: *align(1) pdb.DebugSubsectionHeader = @ptrCast(&subsect_info[sect_offset]);
        skip_len = subsect_hdr.length;
        sect_offset += @sizeOf(pdb.DebugSubsectionHeader);

        switch (subsect_hdr.kind) {
            .lines => {
                var line_index = sect_offset;

                const line_hdr: *align(1) pdb.LineFragmentHeader = @ptrCast(&subsect_info[line_index]);
                if (line_hdr.reloc_segment == 0)
                    return error.MissingDebugInfo;
                line_index += @sizeOf(pdb.LineFragmentHeader);
                const frag_vaddr_start = line_hdr.reloc_offset;
                const frag_vaddr_end = frag_vaddr_start + line_hdr.code_size;

                if (address >= frag_vaddr_start and address < frag_vaddr_end) {
                    // There is an unknown number of LineBlockFragmentHeaders (and their accompanying line and column records)
                    // from now on. We will iterate through them, and eventually find a SourceLocation that we're interested in,
                    // breaking out to :subsections. If not, we will make sure to not read anything outside of this subsection.
                    const subsection_end_index = sect_offset + subsect_hdr.length;

                    while (line_index < subsection_end_index) {
                        const block_hdr: *align(1) pdb.LineBlockFragmentHeader = @ptrCast(&subsect_info[line_index]);
                        line_index += @sizeOf(pdb.LineBlockFragmentHeader);
                        const start_line_index = line_index;

                        const has_column = line_hdr.flags.have_columns;

                        // All line entries are stored inside their line block by ascending start address.
                        // Heuristic: we want to find the last line entry
                        // that has a vaddr_start <= address.
                        // This is done with a simple linear search.
                        var line_i: u32 = 0;
                        while (line_i < block_hdr.num_lines) : (line_i += 1) {
                            const line_num_entry: *align(1) pdb.LineNumberEntry = @ptrCast(&subsect_info[line_index]);
                            line_index += @sizeOf(pdb.LineNumberEntry);

                            const vaddr_start = frag_vaddr_start + line_num_entry.offset;
                            if (address < vaddr_start) {
                                break;
                            }
                        }

                        // line_i == 0 would mean that no matching pdb.LineNumberEntry was found.
                        if (line_i > 0) {
                            const subsect_index = checksum_offset + block_hdr.name_index;
                            const chksum_hdr: *align(1) pdb.FileChecksumEntryHeader = @ptrCast(&module.subsect_info[subsect_index]);
                            const strtab_offset = @sizeOf(pdb.StringTableHeader) + chksum_hdr.file_name_offset;
                            try self.string_table.?.seekTo(strtab_offset);
                            const source_file_name = s: {
                                const string_reader = &self.string_table.?.interface;
                                var source_file_name: std.Io.Writer.Allocating = .init(gpa);
                                defer source_file_name.deinit();
                                _ = try string_reader.streamDelimiterLimit(&source_file_name.writer, 0, .limited(1024));
                                assert(string_reader.buffered()[0] == 0); // TODO change streamDelimiterLimit API
                                string_reader.toss(1);
                                break :s try source_file_name.toOwnedSlice();
                            };
                            errdefer gpa.free(source_file_name);

                            const line_entry_idx = line_i - 1;

                            const column = if (has_column) blk: {
                                const start_col_index = start_line_index + @sizeOf(pdb.LineNumberEntry) * block_hdr.num_lines;
                                const col_index = start_col_index + @sizeOf(pdb.ColumnNumberEntry) * line_entry_idx;
                                const col_num_entry: *align(1) pdb.ColumnNumberEntry = @ptrCast(&subsect_info[col_index]);
                                break :blk col_num_entry.start_column;
                            } else 0;

                            const found_line_index = start_line_index + line_entry_idx * @sizeOf(pdb.LineNumberEntry);
                            const line_num_entry: *align(1) pdb.LineNumberEntry = @ptrCast(&subsect_info[found_line_index]);

                            return .{
                                .file_name = source_file_name,
                                .line = line_num_entry.flags.start,
                                .column = column,
                            };
                        }
                    }

                    // Checking that we are not reading garbage after the (possibly) multiple block fragments.
                    if (line_index != subsection_end_index) {
                        return error.InvalidDebugInfo;
                    }
                }
            },
            else => {},
        }

        if (sect_offset > subsect_info.len)
            return error.InvalidDebugInfo;
    }

    return error.MissingDebugInfo;
}

pub fn getModule(self: *Pdb, index: usize) !?*Module {
    if (index >= self.modules.len)
        return null;

    const mod = &self.modules[index];
    if (mod.populated)
        return mod;

    // At most one can be non-zero.
    if (mod.mod_info.c11_byte_size != 0 and mod.mod_info.c13_byte_size != 0)
        return error.InvalidDebugInfo;
    if (mod.mod_info.c13_byte_size == 0)
        return error.InvalidDebugInfo;

    const stream = self.getStreamById(mod.mod_info.module_sym_stream) orelse
        return error.MissingDebugInfo;
    const reader = &stream.interface;

    const signature = try reader.takeInt(u32, .little);
    if (signature != 4)
        return error.InvalidDebugInfo;

    const gpa = self.allocator;

    mod.symbols = try reader.readAlloc(gpa, mod.mod_info.sym_byte_size - 4);
    mod.subsect_info = try reader.readAlloc(gpa, mod.mod_info.c13_byte_size);

    var sect_offset: usize = 0;
    var skip_len: usize = undefined;
    while (sect_offset != mod.subsect_info.len) : (sect_offset += skip_len) {
        const subsect_hdr: *align(1) pdb.DebugSubsectionHeader = @ptrCast(&mod.subsect_info[sect_offset]);
        skip_len = subsect_hdr.length;
        sect_offset += @sizeOf(pdb.DebugSubsectionHeader);

        switch (subsect_hdr.kind) {
            .file_checksums => {
                mod.checksum_offset = sect_offset;
                break;
            },
            else => {},
        }

        if (sect_offset > mod.subsect_info.len)
            return error.InvalidDebugInfo;
    }

    mod.populated = true;
    return mod;
}

pub fn getStreamById(self: *Pdb, id: u32) ?*MsfStream {
    if (id >= self.msf.streams.len) return null;
    return &self.msf.streams[id];
}

pub fn getStream(self: *Pdb, stream: pdb.StreamType) ?*MsfStream {
    const id = @intFromEnum(stream);
    return self.getStreamById(id);
}

/// https://llvm.org/docs/PDB/MsfFile.html
const Msf = struct {
    directory: MsfStream,
    streams: []MsfStream,

    fn init(gpa: Allocator, file_reader: *File.Reader) !Msf {
        const superblock = try file_reader.interface.takeStruct(pdb.SuperBlock, .little);

        if (!std.mem.eql(u8, &superblock.file_magic, pdb.SuperBlock.expect_magic))
            return error.InvalidDebugInfo;
        if (superblock.free_block_map_block != 1 and superblock.free_block_map_block != 2)
            return error.InvalidDebugInfo;
        if (superblock.num_blocks * superblock.block_size != try file_reader.getSize())
            return error.InvalidDebugInfo;
        switch (superblock.block_size) {
            // llvm only supports 4096 but we can handle any of these values
            512, 1024, 2048, 4096 => {},
            else => return error.InvalidDebugInfo,
        }

        const dir_block_count = blockCountFromSize(superblock.num_directory_bytes, superblock.block_size);
        if (dir_block_count > superblock.block_size / @sizeOf(u32))
            return error.UnhandledBigDirectoryStream; // cf. BlockMapAddr comment.

        try file_reader.seekTo(superblock.block_size * superblock.block_map_addr);
        const dir_blocks = try gpa.alloc(u32, dir_block_count);
        errdefer gpa.free(dir_blocks);
        for (dir_blocks) |*b| {
            b.* = try file_reader.interface.takeInt(u32, .little);
        }
        var directory_buffer: [64]u8 = undefined;
        var directory = MsfStream.init(superblock.block_size, file_reader, dir_blocks, &directory_buffer);

        const begin = directory.logicalPos();
        const stream_count = try directory.interface.takeInt(u32, .little);
        const stream_sizes = try gpa.alloc(u32, stream_count);
        defer gpa.free(stream_sizes);

        // Microsoft's implementation uses @as(u32, -1) for inexistent streams.
        // These streams are not used, but still participate in the file
        // and must be taken into account when resolving stream indices.
        const nil_size = 0xFFFFFFFF;
        for (stream_sizes) |*s| {
            const size = try directory.interface.takeInt(u32, .little);
            s.* = if (size == nil_size) 0 else blockCountFromSize(size, superblock.block_size);
        }

        const streams = try gpa.alloc(MsfStream, stream_count);
        errdefer gpa.free(streams);

        for (streams, stream_sizes) |*stream, size| {
            if (size == 0) {
                stream.* = .empty;
                continue;
            }
            const blocks = try gpa.alloc(u32, size);
            errdefer gpa.free(blocks);
            for (blocks) |*block| {
                const block_id = try directory.interface.takeInt(u32, .little);
                // Index 0 is reserved for the superblock.
                // In theory, every page which is `n * block_size + 1` or `n * block_size + 2`
                // is also reserved, for one of the FPMs. However, LLVM has been observed to map
                // these into actual streams, so allow it for compatibility.
                if (block_id == 0 or block_id >= superblock.num_blocks) return error.InvalidBlockIndex;
                block.* = block_id;
            }
            const buffer = try gpa.alloc(u8, 64);
            errdefer gpa.free(buffer);
            stream.* = .init(superblock.block_size, file_reader, blocks, buffer);
        }

        const end = directory.logicalPos();
        if (end - begin != superblock.num_directory_bytes)
            return error.InvalidStreamDirectory;

        return .{
            .directory = directory,
            .streams = streams,
        };
    }

    fn deinit(self: *Msf, gpa: Allocator) void {
        gpa.free(self.directory.blocks);
        for (self.streams) |*stream| {
            gpa.free(stream.interface.buffer);
            gpa.free(stream.blocks);
        }
        gpa.free(self.streams);
    }
};

const MsfStream = struct {
    file_reader: *File.Reader,
    next_read_pos: u64,
    blocks: []u32,
    block_size: u32,
    interface: std.Io.Reader,
    err: ?Error,

    const Error = File.Reader.SeekError;

    const empty: MsfStream = .{
        .file_reader = undefined,
        .next_read_pos = 0,
        .blocks = &.{},
        .block_size = undefined,
        .interface = .ending_instance,
        .err = null,
    };

    fn init(block_size: u32, file_reader: *File.Reader, blocks: []u32, buffer: []u8) MsfStream {
        return .{
            .file_reader = file_reader,
            .next_read_pos = 0,
            .blocks = blocks,
            .block_size = block_size,
            .interface = .{
                .vtable = &.{ .stream = stream },
                .buffer = buffer,
                .seek = 0,
                .end = 0,
            },
            .err = null,
        };
    }

    fn stream(r: *std.Io.Reader, w: *std.Io.Writer, limit: std.Io.Limit) std.Io.Reader.StreamError!usize {
        const ms: *MsfStream = @alignCast(@fieldParentPtr("interface", r));

        var block_id: usize = @intCast(ms.next_read_pos / ms.block_size);
        if (block_id >= ms.blocks.len) return error.EndOfStream;
        var block = ms.blocks[block_id];
        var offset = ms.next_read_pos % ms.block_size;

        ms.file_reader.seekTo(block * ms.block_size + offset) catch |err| {
            ms.err = err;
            return error.ReadFailed;
        };

        var remaining = @intFromEnum(limit);
        while (remaining != 0) {
            const stream_len: usize = @min(remaining, ms.block_size - offset);
            const n = try ms.file_reader.interface.stream(w, .limited(stream_len));
            remaining -= n;
            offset += n;

            // If we're at the end of a block, go to the next one.
            if (offset == ms.block_size) {
                offset = 0;
                block_id += 1;
                if (block_id >= ms.blocks.len) break; // End of Stream
                block = ms.blocks[block_id];
                ms.file_reader.seekTo(block * ms.block_size) catch |err| {
                    ms.err = err;
                    return error.ReadFailed;
                };
            }
        }

        const total = @intFromEnum(limit) - remaining;
        ms.next_read_pos += total;
        return total;
    }

    pub fn logicalPos(ms: *const MsfStream) u64 {
        return ms.next_read_pos - ms.interface.bufferedLen();
    }

    pub fn seekBy(ms: *MsfStream, len: i64) !void {
        ms.next_read_pos = @as(u64, @intCast(@as(i64, @intCast(ms.logicalPos())) + len));
        if (ms.next_read_pos >= ms.blocks.len * ms.block_size) return error.EOF;
        ms.interface.tossBuffered();
    }

    pub fn seekTo(ms: *MsfStream, len: u64) !void {
        ms.next_read_pos = len;
        if (ms.next_read_pos >= ms.blocks.len * ms.block_size) return error.EOF;
        ms.interface.tossBuffered();
    }

    fn getSize(ms: *const MsfStream) u64 {
        return ms.blocks.len * ms.block_size;
    }

    fn getFilePos(ms: *const MsfStream) u64 {
        const pos = ms.logicalPos();
        const block_id = pos / ms.block_size;
        const block = ms.blocks[block_id];
        const offset = pos % ms.block_size;

        return block * ms.block_size + offset;
    }
};

fn readSparseBitVector(reader: *std.Io.Reader, allocator: Allocator) ![]u32 {
    const num_words = try reader.takeInt(u32, .little);
    var list = std.array_list.Managed(u32).init(allocator);
    errdefer list.deinit();
    var word_i: u32 = 0;
    while (word_i != num_words) : (word_i += 1) {
        const word = try reader.takeInt(u32, .little);
        var bit_i: u5 = 0;
        while (true) : (bit_i += 1) {
            if (word & (@as(u32, 1) << bit_i) != 0) {
                try list.append(word_i * 32 + bit_i);
            }
            if (bit_i == std.math.maxInt(u5)) break;
        }
    }
    return try list.toOwnedSlice();
}

fn blockCountFromSize(size: u32, block_size: u32) u32 {
    return (size + block_size - 1) / block_size;
}
