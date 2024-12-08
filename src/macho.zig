const std = @import("std");
const mem = std.mem;
const fs = std.fs;
const io = std.io;
const macho = std.macho;
const Allocator = mem.Allocator;
const bun = @import("root").bun;

pub const SEGNAME_BUN = "__BUN\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00".*;
pub const SECTNAME = "__bun\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00".*;
const strings = bun.strings;

pub const MachoFile = struct {
    header: macho.mach_header_64,
    data: std.ArrayList(u8),
    segment: macho.segment_command_64,
    section: macho.section_64,
    allocator: Allocator,

    const LoadCommand = struct {
        cmd: u32,
        cmdsize: u32,
        offset: usize,
    };

    pub fn init(allocator: Allocator, obj_file: []const u8, blob_to_embed_length: usize) !*MachoFile {
        var data = try std.ArrayList(u8).initCapacity(allocator, obj_file.len + blob_to_embed_length);
        try data.appendSlice(obj_file);

        const header: *const macho.mach_header_64 = @alignCast(@ptrCast(data.items.ptr));

        const self = try allocator.create(MachoFile);
        errdefer allocator.destroy(self);

        self.* = .{
            .header = header.*,
            .data = data,
            .segment = std.mem.zeroes(macho.segment_command_64),
            .section = std.mem.zeroes(macho.section_64),
            .allocator = allocator,
        };

        return self;
    }

    pub fn deinit(self: *MachoFile) void {
        self.data.deinit();
        self.allocator.destroy(self);
    }

    pub fn writeSection(self: *MachoFile, data: []const u8) !void {
        const blob_alignment: u64 = if (self.header.cputype == macho.CPU_TYPE_ARM64)
            16 * 1024
        else
            4 * 1024;

        const header_size = @sizeOf(u32);
        const total_size = header_size + data.len;
        const aligned_size = alignSize(total_size, blob_alignment);

        // Look for existing __BUN,__BUN section

        var original_fileoff: u64 = 0;
        var original_vmaddr: u64 = 0;
        var original_data_end: u64 = 0;
        var original_segsize: u64 = blob_alignment;

        // Use an index instead of a pointer to avoid issues with resizing the arraylist later.
        var code_sign_cmd_idx: ?usize = null;
        var linkedit_seg_idx: ?usize = null;

        var found_bun = false;

        var iter = self.iterator();

        while (iter.next()) |entry| {
            const cmd = entry.hdr;
            switch (cmd.cmd) {
                .SEGMENT_64 => {
                    const command = entry.cast(macho.segment_command_64).?;
                    if (strings.eqlComptime(command.segName(), "__BUN")) {
                        if (command.nsects > 0) {
                            const section_offset = @intFromPtr(entry.data.ptr) - @intFromPtr(self.data.items.ptr);
                            const sections = @as([*]macho.section_64, @ptrCast(@alignCast(&self.data.items[section_offset + @sizeOf(macho.segment_command_64)])))[0..command.nsects];
                            for (sections) |*sect| {
                                if (strings.eqlComptime(sect.sectName(), "__bun")) {
                                    found_bun = true;
                                    original_fileoff = sect.offset;
                                    original_vmaddr = sect.addr;
                                    original_data_end = original_fileoff + blob_alignment;
                                    original_segsize = sect.size;
                                    self.segment = command;
                                    self.section = sect.*;

                                    // Update segment with proper sizes and alignment
                                    self.segment.vmsize = alignVmsize(aligned_size, blob_alignment);
                                    self.segment.filesize = aligned_size;
                                    self.segment.maxprot = macho.PROT.READ | macho.PROT.WRITE;
                                    self.segment.initprot = macho.PROT.READ | macho.PROT.WRITE;

                                    self.section = .{
                                        .sectname = SECTNAME,
                                        .segname = SEGNAME_BUN,
                                        .addr = original_vmaddr,
                                        .size = @intCast(total_size),
                                        .offset = @intCast(original_fileoff),
                                        .@"align" = @intFromFloat(@log2(@as(f64, @floatFromInt(blob_alignment)))),
                                        .reloff = 0,
                                        .nreloc = 0,
                                        .flags = macho.S_REGULAR | macho.S_ATTR_NO_DEAD_STRIP,
                                        .reserved1 = 0,
                                        .reserved2 = 0,
                                        .reserved3 = 0,
                                    };
                                    const entry_ptr: [*]u8 = @constCast(entry.data.ptr);
                                    const segment_command_ptr: *align(1) macho.segment_command_64 = @ptrCast(@alignCast(entry_ptr));
                                    segment_command_ptr.* = self.segment;
                                    sect.* = self.section;
                                }
                            }
                        }
                    } else if (strings.eqlComptime(command.segName(), SEG_LINKEDIT)) {
                        linkedit_seg_idx = @intFromPtr(entry.data.ptr) - @intFromPtr(self.data.items.ptr);
                    }
                },
                .CODE_SIGNATURE => {
                    code_sign_cmd_idx = @intFromPtr(entry.data.ptr) - @intFromPtr(self.data.items.ptr);
                },
                else => {},
            }
        }

        if (!found_bun) {
            return error.InvalidObject;
        }

        // Calculate how much larger/smaller the section will be compared to its current size
        const size_diff = @as(i64, @intCast(aligned_size)) - @as(i64, @intCast(original_segsize));

        try self.data.ensureUnusedCapacity(@intCast(size_diff));

        const code_sign_cmd: ?*align(1) macho.linkedit_data_command =
            if (code_sign_cmd_idx) |idx|
            @as(*align(1) macho.linkedit_data_command, @ptrCast(@constCast(@alignCast(&self.data.items[idx]))))
        else
            null;
        const linkedit_seg: *align(1) macho.segment_command_64 =
            if (linkedit_seg_idx) |idx|
            @as(*align(1) macho.segment_command_64, @ptrCast(@constCast(@alignCast(&self.data.items[idx]))))
        else
            return error.MissingLinkeditSegment;

        // Handle code signature specially
        var sig_data: ?[]u8 = null;
        var sig_size: usize = 0;
        defer if (sig_data) |sd| self.allocator.free(sd);

        const prev_data_slice = self.data.items[original_fileoff..];
        self.data.items.len += @as(usize, @intCast(size_diff));

        // Binary is:
        // [header][...data before __BUN][__BUN][...data after __BUN]
        // We need to shift [...data after __BUN] forward by size_diff bytes.
        const after_bun_slice = self.data.items[original_data_end + @as(usize, @intCast(size_diff)) ..];
        const prev_after_bun_slice = prev_data_slice[original_segsize..];
        bun.C.move(after_bun_slice, prev_after_bun_slice);

        // Now we copy the u32 size header
        std.mem.writeInt(u32, self.data.items[original_fileoff..][0..4], @intCast(data.len), .little);

        // Now we copy the data itself
        @memcpy(self.data.items[original_fileoff + 4 ..][0..data.len], data);

        // Lastly, we zero any of the padding that was added
        const padding_bytes = self.data.items[original_fileoff..][data.len + 4 .. aligned_size];
        @memset(padding_bytes, 0);

        if (code_sign_cmd) |cs| {
            sig_size = cs.datasize;
            // Save existing signature if present
            sig_data = try self.allocator.alloc(u8, sig_size);
            @memcpy(sig_data.?, self.data.items[cs.dataoff..][0..sig_size]);
        }

        // Only update offsets if the size actually changed
        if (size_diff != 0) {
            linkedit_seg.fileoff += @as(usize, @intCast(size_diff));
            try self.updateLoadCommandOffsets(original_fileoff, @intCast(size_diff), linkedit_seg.fileoff, linkedit_seg.filesize);
        }

        if (code_sign_cmd) |cs| {
            // Calculate new end of LINKEDIT excluding signature
            var new_linkedit_end = linkedit_seg.fileoff + linkedit_seg.filesize;
            if (sig_size > 0) {
                new_linkedit_end -= sig_size;
            }

            // Place signature at new end
            cs.dataoff = @intCast(new_linkedit_end);
        }
    }

    const Shifter = struct {
        start: u64,
        amount: u64,
        linkedit_fileoff: u64,
        linkedit_filesize: u64,

        fn do(value: u64, amount: u64, range_min: u64, range_max: u64) !u64 {
            if (value == 0) return 0;
            if (value < range_min) return error.OffsetOutOfRange;
            if (value > range_max) return error.OffsetOutOfRange;

            // Check for overflow
            if (value > std.math.maxInt(u64) - amount) {
                return error.OffsetOverflow;
            }

            return value + amount;
        }

        pub fn shift(this: *const Shifter, value: anytype, comptime fields: []const []const u8) !void {
            inline for (fields) |field| {
                @field(value, field) = @intCast(try do(@field(value, field), this.amount, this.start, this.linkedit_fileoff + this.linkedit_filesize));
            }
        }
    };

    // Helper function to update load command offsets when resizing an existing section
    fn updateLoadCommandOffsets(self: *MachoFile, previous_fileoff: u64, size_diff: u64, new_linkedit_fileoff: u64, new_linkedit_filesize: u64) !void {
        // Validate inputs
        if (new_linkedit_fileoff < previous_fileoff) {
            return error.InvalidLinkeditOffset;
        }

        const PAGE_SIZE: u64 = 1 << 12;

        // Ensure all offsets are page-aligned
        const aligned_previous = alignSize(previous_fileoff, PAGE_SIZE);
        const aligned_linkedit = alignSize(new_linkedit_fileoff, PAGE_SIZE);

        var iter = self.iterator();

        // Create shifter with validated parameters
        const shifter = Shifter{
            .start = aligned_previous,
            .amount = size_diff,
            .linkedit_fileoff = aligned_linkedit,
            .linkedit_filesize = new_linkedit_filesize,
        };

        while (iter.next()) |entry| {
            const cmd = entry.hdr;
            const cmd_ptr: [*]u8 = @constCast(entry.data.ptr);

            switch (cmd.cmd) {
                .SYMTAB => {
                    const symtab: *align(1) macho.symtab_command = @ptrCast(@alignCast(cmd_ptr));

                    try shifter.shift(symtab, &.{
                        "symoff",
                        "stroff",
                    });
                },
                .DYSYMTAB => {
                    const dysymtab: *align(1) macho.dysymtab_command = @ptrCast(@alignCast(cmd_ptr));

                    try shifter.shift(dysymtab, &.{
                        "tocoff",
                        "modtaboff",
                        "extrefsymoff",
                        "indirectsymoff",
                        "extreloff",
                        "locreloff",
                    });
                },
                .DYLD_CHAINED_FIXUPS,
                .CODE_SIGNATURE,
                .FUNCTION_STARTS,
                .DATA_IN_CODE,
                .DYLIB_CODE_SIGN_DRS,
                .LINKER_OPTIMIZATION_HINT,
                .DYLD_EXPORTS_TRIE,
                => {
                    const linkedit_cmd: *align(1) macho.linkedit_data_command = @ptrCast(@alignCast(cmd_ptr));

                    try shifter.shift(linkedit_cmd, &.{"dataoff"});

                    // Special handling for code signature
                    if (cmd.cmd == .CODE_SIGNATURE) {
                        // Ensure code signature is at the end of LINKEDIT
                        linkedit_cmd.dataoff = @intCast(new_linkedit_fileoff + new_linkedit_filesize - linkedit_cmd.datasize);
                    }
                },
                .DYLD_INFO, .DYLD_INFO_ONLY => {
                    const dyld_info: *align(1) macho.dyld_info_command = @ptrCast(@alignCast(cmd_ptr));

                    try shifter.shift(dyld_info, &.{
                        "rebase_off",
                        "bind_off",
                        "weak_bind_off",
                        "lazy_bind_off",
                        "export_off",
                    });
                },
                else => {},
            }
        }
    }

    pub fn iterator(self: *const MachoFile) macho.LoadCommandIterator {
        return .{
            .buffer = self.data.items[@sizeOf(macho.mach_header_64)..][0..self.header.sizeofcmds],
            .ncmds = self.header.ncmds,
        };
    }

    pub fn build(self: *MachoFile, writer: anytype) !void {
        try writer.writeAll(self.data.items);
    }

    pub fn buildAndSign(self: *MachoFile, writer: anytype) !void {
        if (self.header.cputype == macho.CPU_TYPE_ARM64 and !bun.getRuntimeFeatureFlag("BUN_NO_CODESIGN_MACHO_BINARY")) {
            var data = std.ArrayList(u8).init(self.allocator);
            defer data.deinit();
            try self.build(data.writer());
            var signer = try MachoSigner.init(self.allocator, data.items);
            defer signer.deinit();
            try signer.sign(writer);
        } else {
            try self.build(writer);
        }
    }

    const MachoSigner = struct {
        data: std.ArrayList(u8),
        sig_off: usize,
        sig_sz: usize,
        cs_cmd_off: usize,
        linkedit_off: usize,
        linkedit_seg: macho.segment_command_64,
        text_seg: macho.segment_command_64,
        allocator: Allocator,

        pub fn init(allocator: Allocator, obj: []const u8) !*MachoSigner {
            var self = try allocator.create(MachoSigner);
            errdefer allocator.destroy(self);

            const header = @as(*align(1) const macho.mach_header_64, @ptrCast(obj.ptr)).*;
            const header_size = @sizeOf(macho.mach_header_64);

            var sig_off: usize = 0;
            var sig_sz: usize = 0;
            var cs_cmd_off: usize = 0;
            var linkedit_off: usize = 0;

            var text_seg = std.mem.zeroes(macho.segment_command_64);
            var linkedit_seg = std.mem.zeroes(macho.segment_command_64);

            var it = macho.LoadCommandIterator{
                .ncmds = header.ncmds,
                .buffer = obj[header_size..][0..header.sizeofcmds],
            };

            // First pass: find segments to establish bounds
            while (it.next()) |cmd| {
                if (cmd.cmd() == .SEGMENT_64) {
                    const seg = cmd.cast(macho.segment_command_64).?;

                    // Store segment info
                    if (strings.eqlComptime(seg.segName(), SEG_LINKEDIT)) {
                        linkedit_seg = seg;
                        linkedit_off = @intFromPtr(cmd.data.ptr) - @intFromPtr(obj.ptr);

                        // Validate linkedit is after text
                        if (linkedit_seg.fileoff < text_seg.fileoff + text_seg.filesize) {
                            return error.InvalidLinkeditOffset;
                        }
                    } else if (strings.eqlComptime(seg.segName(), "__TEXT")) {
                        text_seg = seg;
                    }
                }
            }

            // Reset iterator
            it = macho.LoadCommandIterator{
                .ncmds = header.ncmds,
                .buffer = obj[header_size..][0..header.sizeofcmds],
            };

            // Second pass: find code signature
            while (it.next()) |cmd| {
                switch (cmd.cmd()) {
                    .CODE_SIGNATURE => {
                        const cs = cmd.cast(macho.linkedit_data_command).?;
                        sig_off = cs.dataoff;
                        sig_sz = cs.datasize;
                        cs_cmd_off = @intFromPtr(cmd.data.ptr) - @intFromPtr(obj.ptr);
                    },
                    else => {},
                }
            }

            if (linkedit_off == 0 or sig_off == 0) {
                return error.MissingRequiredSegment;
            }

            self.* = .{
                .data = try std.ArrayList(u8).initCapacity(allocator, obj.len),
                .sig_off = sig_off,
                .sig_sz = sig_sz,
                .cs_cmd_off = cs_cmd_off,
                .linkedit_off = linkedit_off,
                .linkedit_seg = linkedit_seg,
                .text_seg = text_seg,
                .allocator = allocator,
            };

            try self.data.appendSlice(obj);
            return self;
        }

        pub fn deinit(self: *MachoSigner) void {
            self.data.deinit();
            self.allocator.destroy(self);
        }

        pub fn sign(self: *MachoSigner, writer: anytype) !void {
            const PAGE_SIZE: usize = 1 << 12;

            // Ensure signature offset is page-aligned
            if (self.sig_off % PAGE_SIZE != 0) {
                self.sig_off = alignSize(self.sig_off, PAGE_SIZE);
            }

            const id = "a.out\x00";
            const n_hashes = (self.sig_off + PAGE_SIZE - 1) / PAGE_SIZE;

            // Calculate offsets and sizes
            const super_blob_size = @sizeOf(SuperBlob);
            const blob_size = @sizeOf(Blob);
            const code_dir_size = @sizeOf(CodeDirectory);
            const id_offset = super_blob_size + blob_size + code_dir_size;
            const hash_offset = id_offset + id.len;
            const total_size = alignSize(hash_offset + n_hashes * 32, PAGE_SIZE);

            // Create the signature components
            const super_blob = SuperBlob{
                .magic = @byteSwap(CSMAGIC_EMBEDDED_SIGNATURE),
                .length = @byteSwap(@as(u32, @truncate(total_size))),
                .count = @byteSwap(@as(u32, 1)),
            };

            const blob = Blob{
                .magic = @byteSwap(CSSLOT_CODEDIRECTORY),
                .length = @byteSwap(@as(u32, @truncate(super_blob_size))),
            };

            var code_dir = CodeDirectory.init();
            code_dir.magic = @byteSwap(CSMAGIC_CODEDIRECTORY);
            code_dir.length = @byteSwap(@as(u32, @truncate(total_size - super_blob_size - blob_size)));
            code_dir.version = @byteSwap(@as(u32, 0x20400));
            code_dir.flags = @byteSwap(@as(u32, 0x20002));
            code_dir.hash_offset = @byteSwap(@as(u32, @truncate(hash_offset - (super_blob_size + blob_size))));
            code_dir.ident_offset = @byteSwap(@as(u32, @truncate(id_offset - (super_blob_size + blob_size))));
            code_dir.n_code_slots = @byteSwap(@as(u32, @truncate(n_hashes)));
            code_dir.code_limit = @byteSwap(@as(u32, @truncate(self.sig_off)));
            code_dir.hash_size = 32;
            code_dir.hash_type = SEC_CODE_SIGNATURE_HASH_SHA256;
            code_dir.page_size = 12;
            code_dir.exec_seg_base = @byteSwap(self.text_seg.fileoff);
            code_dir.exec_seg_limit = @byteSwap(self.text_seg.filesize);
            code_dir.exec_seg_flags = @byteSwap(CS_EXECSEG_MAIN_BINARY);

            var out = try std.ArrayList(u8).initCapacity(self.allocator, total_size);
            defer out.deinit();

            try out.appendSlice(mem.asBytes(&super_blob));
            try out.appendSlice(mem.asBytes(&blob));
            try out.appendSlice(mem.asBytes(&code_dir));
            try out.appendSlice(id);

            // Calculate page hashes, ensuring we don't read past the end
            var fileoff: usize = 0;
            const bytes_to_hash = self.sig_off;
            while (fileoff < bytes_to_hash) {
                const remaining = bytes_to_hash - fileoff;
                const n = @min(PAGE_SIZE, remaining);
                const chunk = self.data.items[fileoff..][0..n];
                var digest: bun.sha.SHA256.Digest = undefined;
                bun.sha.SHA256.hash(chunk, &digest, null);
                try out.appendSlice(&digest);
                fileoff += n;
            }

            // Update array size and copy signature
            if (self.data.items.len < self.sig_off + total_size) {
                try self.data.resize(self.sig_off + total_size);
            }
            @memcpy(self.data.items[self.sig_off..][0..out.items.len], out.items);

            try writer.writeAll(self.data.items);
        }
    };
};

fn alignSize(size: u64, base: u64) u64 {
    const over = size % base;
    return if (over == 0) size else size + (base - over);
}

fn alignVmsize(size: u64, page_size: u64) u64 {
    return alignSize(if (size > 0x4000) size else 0x4000, page_size);
}

fn shiftOffset(value: u64, amount: u64, range_min: u64, range_max: u64) u64 {
    if (value < range_min or value > (range_max + range_min)) {
        return value;
    }
    return value + amount;
}

const SEG_LINKEDIT = "__LINKEDIT";

pub const utils = struct {
    pub fn isElf(data: []const u8) bool {
        if (data.len < 4) return false;
        return mem.readInt(u32, data[0..4], .big) == 0x7f454c46;
    }

    pub fn isMacho(data: []const u8) bool {
        if (data.len < 4) return false;
        return mem.readInt(u32, data[0..4], .little) == macho.MH_MAGIC_64;
    }

    pub fn isPe(data: []const u8) bool {
        if (data.len < 2) return false;
        return mem.readInt(u16, data[0..2], .little) == 0x5a4d;
    }
};

const CSMAGIC_CODEDIRECTORY: u32 = 0xfade0c02;
const CSMAGIC_EMBEDDED_SIGNATURE: u32 = 0xfade0cc0;
const CSSLOT_CODEDIRECTORY: u32 = 0;
const SEC_CODE_SIGNATURE_HASH_SHA256: u8 = 2;
const CS_EXECSEG_MAIN_BINARY: u64 = 0x1;

const SuperBlob = std.macho.SuperBlob;
const Blob = std.macho.GenericBlob;

const CodeDirectory = extern struct {
    magic: u32,
    length: u32,
    version: u32,
    flags: u32,
    hash_offset: u32,
    ident_offset: u32,
    n_special_slots: u32,
    n_code_slots: u32,
    code_limit: u32,
    hash_size: u8,
    hash_type: u8,
    _pad1: u8,
    page_size: u8,
    _pad2: u32,
    scatter_offset: u32,
    team_offset: u32,
    _pad3: u32,
    code_limit64: u64,
    exec_seg_base: u64,
    exec_seg_limit: u64,
    exec_seg_flags: u64,

    pub fn init() CodeDirectory {
        return .{
            .magic = 0,
            .length = 0,
            .version = 0,
            .flags = 0,
            .hash_offset = 0,
            .ident_offset = 0,
            .n_special_slots = 0,
            .n_code_slots = 0,
            .code_limit = 0,
            .hash_size = 0,
            .hash_type = 0,
            ._pad1 = 0,
            .page_size = 0,
            ._pad2 = 0,
            .scatter_offset = 0,
            .team_offset = 0,
            ._pad3 = 0,
            .code_limit64 = 0,
            .exec_seg_base = 0,
            .exec_seg_limit = 0,
            .exec_seg_flags = 0,
        };
    }
};
