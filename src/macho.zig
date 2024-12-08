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
    seg: macho.segment_command_64,
    sec: macho.section_64,
    allocator: Allocator,

    const LoadCommand = struct {
        cmd: u32,
        cmdsize: u32,
        offset: usize,
    };

    pub fn init(allocator: Allocator, obj_file: []const u8, blob_to_embed_length: usize) !*MachoFile {
        var data = try std.ArrayList(u8).initCapacity(allocator, obj_file.len + blob_to_embed_length);
        try data.appendSlice(obj_file);

        const header = @as(*const macho.mach_header_64, @alignCast(@ptrCast(data.items.ptr))).*;

        const self = try allocator.create(MachoFile);
        errdefer allocator.destroy(self);

        self.* = .{
            .header = header,
            .data = data,
            .seg = std.mem.zeroes(macho.segment_command_64),
            .sec = std.mem.zeroes(macho.section_64),
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
        var found_bun = false;

        var iter = self.iterator();

        outer: while (iter.next()) |entry| {
            const cmd = entry.hdr;
            if (@intFromEnum(cmd.cmd) == @intFromEnum(macho.LC.SEGMENT_64)) {
                const command = entry.cast(macho.segment_command_64).?;
                if (mem.eql(u8, command.segName(), "__BUN")) {
                    if (command.nsects > 0) {
                        const section_offset = @intFromPtr(entry.data.ptr) - @intFromPtr(self.data.items.ptr);
                        const sections = @as([*]macho.section_64, @ptrCast(@alignCast(&self.data.items[section_offset + @sizeOf(macho.segment_command_64)])))[0..command.nsects];
                        for (sections) |*sect| {
                            if (mem.eql(u8, sect.sectName(), "__bun")) {
                                found_bun = true;
                                original_fileoff = sect.offset;
                                original_vmaddr = sect.addr;
                                original_data_end = original_fileoff + blob_alignment;
                                original_segsize = sect.size;
                                self.seg = command;
                                self.sec = sect.*;

                                // Update segment with proper sizes and alignment
                                self.seg.vmsize = alignVmsize(aligned_size, blob_alignment);
                                self.seg.filesize = aligned_size;
                                self.seg.maxprot = macho.PROT.READ | macho.PROT.WRITE;
                                self.seg.initprot = macho.PROT.READ | macho.PROT.WRITE;

                                self.sec = .{
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
                                const segment_command_ptr: *macho.segment_command_64 = @ptrCast(@constCast(@alignCast(&entry_ptr[0..@sizeOf(macho.segment_command_64)])));
                                segment_command_ptr.* = self.seg;
                                sect.* = self.sec;
                                break :outer;
                            }
                        }
                    }
                }
            }
        }

        if (!found_bun) {
            return error.InvalidObject;
        }

        // Calculate how much larger/smaller the section will be compared to its current size
        const size_diff = @as(i64, @intCast(aligned_size)) - @as(i64, @intCast(original_segsize));

        // Only update offsets if the size actually changed
        if (size_diff != 0) {
            try self.updateLoadCommandOffsets(original_data_end, size_diff);
        }

        try self.data.ensureUnusedCapacity(@intCast(size_diff));
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
    }

    // Helper function to update load command offsets when resizing an existing section
    fn updateLoadCommandOffsets(self: *MachoFile, start_offset: u64, size_diff: i64) !void {
        var iter = self.iterator();

        while (iter.next()) |entry| {
            const cmd = entry.hdr;
            const cmd_ptr: [*]u8 = @constCast(entry.data.ptr);

            switch (cmd.cmd) {
                .SYMTAB => {
                    var symtab: *macho.symtab_command = @ptrCast(@alignCast(cmd_ptr));
                    if (symtab.symoff >= start_offset) {
                        symtab.symoff = @intCast(@as(i64, @intCast(symtab.symoff)) + size_diff);
                    }
                    if (symtab.stroff >= start_offset) {
                        symtab.stroff = @intCast(@as(i64, @intCast(symtab.stroff)) + size_diff);
                    }
                },
                .DYSYMTAB => {
                    var dysymtab: *macho.dysymtab_command = @ptrCast(@alignCast(cmd_ptr));
                    if (dysymtab.tocoff >= start_offset) {
                        dysymtab.tocoff = @intCast(@as(i64, @intCast(dysymtab.tocoff)) + size_diff);
                    }
                    if (dysymtab.modtaboff >= start_offset) {
                        dysymtab.modtaboff = @intCast(@as(i64, @intCast(dysymtab.modtaboff)) + size_diff);
                    }
                    if (dysymtab.extrefsymoff > start_offset) {
                        dysymtab.extrefsymoff = @intCast(@as(i64, @intCast(dysymtab.extrefsymoff)) + size_diff);
                    }
                    if (dysymtab.indirectsymoff >= start_offset) {
                        dysymtab.indirectsymoff = @intCast(@as(i64, @intCast(dysymtab.indirectsymoff)) + size_diff);
                    }
                    if (dysymtab.extreloff >= start_offset) {
                        dysymtab.extreloff = @intCast(@as(i64, @intCast(dysymtab.extreloff)) + size_diff);
                    }
                    if (dysymtab.locreloff >= start_offset) {
                        dysymtab.locreloff = @intCast(@as(i64, @intCast(dysymtab.locreloff)) + size_diff);
                    }
                },
                .CODE_SIGNATURE,
                .FUNCTION_STARTS,
                .DATA_IN_CODE,
                .DYLIB_CODE_SIGN_DRS,
                .LINKER_OPTIMIZATION_HINT,
                .DYLD_EXPORTS_TRIE,
                .DYLD_CHAINED_FIXUPS,
                => {
                    var linkedit: *macho.linkedit_data_command = @ptrCast(@alignCast(cmd_ptr));
                    if (linkedit.dataoff >= start_offset) {
                        linkedit.dataoff = @intCast(@as(i64, @intCast(linkedit.dataoff)) + size_diff);
                    }
                },
                .DYLD_INFO, .DYLD_INFO_ONLY => {
                    var dyld_info: *macho.dyld_info_command = @ptrCast(@alignCast(cmd_ptr));
                    if (dyld_info.rebase_off >= start_offset) {
                        dyld_info.rebase_off = @intCast(@as(i64, @intCast(dyld_info.rebase_off)) + size_diff);
                    }
                    if (dyld_info.bind_off >= start_offset) {
                        dyld_info.bind_off = @intCast(@as(i64, @intCast(dyld_info.bind_off)) + size_diff);
                    }
                    if (dyld_info.weak_bind_off >= start_offset) {
                        dyld_info.weak_bind_off = @intCast(@as(i64, @intCast(dyld_info.weak_bind_off)) + size_diff);
                    }
                    if (dyld_info.lazy_bind_off >= start_offset) {
                        dyld_info.lazy_bind_off = @intCast(@as(i64, @intCast(dyld_info.lazy_bind_off)) + size_diff);
                    }
                    if (dyld_info.export_off >= start_offset) {
                        dyld_info.export_off = @intCast(@as(i64, @intCast(dyld_info.export_off)) + size_diff);
                    }
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
        if (self.header.cputype == macho.CPU_TYPE_ARM64) {
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

            while (it.next()) |cmd| {
                switch (cmd.cmd()) {
                    .CODE_SIGNATURE => {
                        const cs = cmd.cast(macho.linkedit_data_command).?;
                        sig_off = cs.dataoff;
                        sig_sz = cs.datasize;
                        cs_cmd_off = @intFromPtr(cmd.data.ptr) - @intFromPtr(obj.ptr);
                    },
                    .SEGMENT_64 => {
                        const seg = cmd.cast(macho.segment_command_64).?;

                        if (strings.eqlComptime(seg.segName(), SEG_LINKEDIT)) {
                            linkedit_off = @intFromPtr(cmd.data.ptr) - @intFromPtr(obj.ptr);
                            linkedit_seg = seg;
                        } else if (strings.eqlComptime(seg.segName(), "__TEXT")) {
                            text_seg = seg;
                        }
                    },
                    else => {},
                }
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

            const id = "a.out\x00";
            const n_hashes = (self.sig_off + PAGE_SIZE - 1) / PAGE_SIZE;
            const id_off = @sizeOf(CodeDirectory);
            const hash_off = id_off + id.len;
            const c_dir_sz = hash_off + n_hashes * 32;
            const sz = @sizeOf(SuperBlob) + @sizeOf(Blob) + c_dir_sz;

            if (self.sig_sz != sz) {
                // Update the load command
                var cs_cmd: *macho.linkedit_data_command = @constCast(@alignCast(@ptrCast(&self.data.items[self.cs_cmd_off..][0..@sizeOf(macho.linkedit_data_command)])));
                cs_cmd.datasize = @truncate(sz);

                // Update __LINKEDIT segment
                const seg_sz = self.sig_off + sz - self.linkedit_seg.fileoff;
                var linkedit_seg: *macho.segment_command_64 = @constCast(@alignCast(@ptrCast(&self.data.items[self.linkedit_off..][0..@sizeOf(macho.segment_command_64)])));
                linkedit_seg.filesize = seg_sz;
                linkedit_seg.vmsize = seg_sz;
            }

            const sb = SuperBlob{
                .magic = @byteSwap(CSMAGIC_EMBEDDED_SIGNATURE),
                .length = @byteSwap(@as(u32, @truncate(sz))),
                .count = @byteSwap(@as(u32, 1)),
            };
            const blob = Blob{
                .magic = @byteSwap(CSSLOT_CODEDIRECTORY),
                .length = @byteSwap(@as(u32, @sizeOf(SuperBlob) + @sizeOf(Blob))),
            };

            var c_dir = CodeDirectory.init();
            c_dir.magic = @byteSwap(CSMAGIC_CODEDIRECTORY);
            c_dir.length = @byteSwap(@as(u32, @truncate(sz - (@sizeOf(SuperBlob) + @sizeOf(Blob)))));
            c_dir.version = @byteSwap(@as(u32, 0x20400));
            c_dir.flags = @byteSwap(@as(u32, 0x20002)); // adhoc | linkerSigned
            c_dir.hash_offset = @byteSwap(@as(u32, @truncate(hash_off)));
            c_dir.ident_offset = @byteSwap(@as(u32, @truncate(id_off)));
            c_dir.n_code_slots = @byteSwap(@as(u32, @truncate(n_hashes)));
            c_dir.code_limit = @byteSwap(@as(u32, @truncate(self.sig_off)));
            c_dir.hash_size = 32; // SHA256 output size
            c_dir.hash_type = SEC_CODE_SIGNATURE_HASH_SHA256;
            c_dir.page_size = 12;
            c_dir.exec_seg_base = @byteSwap(self.text_seg.fileoff);
            c_dir.exec_seg_limit = @byteSwap(self.text_seg.filesize);
            c_dir.exec_seg_flags = @byteSwap(CS_EXECSEG_MAIN_BINARY);

            var out = try std.ArrayList(u8).initCapacity(self.allocator, sz);
            defer out.deinit();

            try out.appendSlice(mem.asBytes(&sb));
            try out.appendSlice(mem.asBytes(&blob));
            try out.appendSlice(mem.asBytes(&c_dir));
            try out.appendSlice(id);

            var fileoff: usize = 0;

            while (fileoff < self.sig_off) {
                var n = PAGE_SIZE;
                if (fileoff + n > self.sig_off) {
                    n = self.sig_off - fileoff;
                }
                const chunk = self.data.items[fileoff .. fileoff + n];
                var digest: bun.sha.SHA256.Digest = undefined;
                bun.sha.SHA256.hash(chunk, &digest, null);
                try out.appendSlice(&digest);
                fileoff += n;
            }

            if (self.data.items.len < self.sig_off + sz) {
                try self.data.resize(self.sig_off + sz);
                @memset(self.data.items[self.data.items.len..][0..sz], 0);
            }

            @memcpy(self.data.items[self.sig_off..][0..out.items.len], out.items);
            try self.data.resize(self.sig_off + sz);

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
