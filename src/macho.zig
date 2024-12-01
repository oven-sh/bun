const std = @import("std");
const mem = std.mem;
const fs = std.fs;
const io = std.io;
const macho = std.macho;
const Allocator = mem.Allocator;
const bun = @import("root").bun;

pub const Error = error{
    InvalidObject,
    InternalError,
    IoError,
};

pub const SEGNAME_BUN = "__BUN\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00".*;
pub const SECTNAME = "__BUN\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00".*;

pub const MachoFile = struct {
    header: macho.mach_header_64,
    commands: std.ArrayList(LoadCommand),
    linkedit_cmd: macho.segment_command_64,
    rest_size: u64,
    data: std.ArrayList(u8),
    seg: macho.segment_command_64,
    sec: macho.section_64,
    sectdata: ?[]const u8,
    allocator: Allocator,

    const LoadCommand = struct {
        cmd: u32,
        cmdsize: u32,
        offset: usize,
    };

    pub fn init(allocator: Allocator, obj: []const u8) !*MachoFile {
        const self = try allocator.create(MachoFile);
        errdefer allocator.destroy(self);

        const header = @as(*const macho.mach_header_64, @alignCast(@ptrCast(obj.ptr))).*;
        var commands = std.ArrayList(LoadCommand).init(allocator);
        errdefer commands.deinit();

        var linkedit_cmd: ?macho.segment_command_64 = null;

        var it = macho.LoadCommandIterator{
            .ncmds = header.ncmds,
            .buffer = obj[@sizeOf(macho.mach_header_64)..][0..header.sizeofcmds],
        };

        while (it.next()) |cmd| {
            const cmd_data = cmd.data;
            try commands.append(.{
                .cmd = @intFromEnum(cmd.cmd()),
                .cmdsize = cmd.cmdsize(),
                .offset = @intFromPtr(cmd_data.ptr) - @intFromPtr(obj.ptr),
            });

            if (cmd.cmd() == .SEGMENT_64 and linkedit_cmd == null) {
                const seg = cmd.cast(macho.segment_command_64).?;

                if (mem.eql(u8, seg.segName(), "__LINKEDIT")) {
                    linkedit_cmd = seg;
                }
            }
        }

        const linkedit = linkedit_cmd orelse return error.InvalidObject;
        const rest_size = linkedit.fileoff - @sizeOf(macho.mach_header_64) - header.sizeofcmds;

        var data = try std.ArrayList(u8).initCapacity(allocator, obj.len);
        try data.appendSlice(obj);

        self.* = .{
            .header = header,
            .commands = commands,
            .linkedit_cmd = linkedit,
            .rest_size = rest_size,
            .data = data,
            .seg = std.mem.zeroes(macho.segment_command_64),
            .sec = std.mem.zeroes(macho.section_64),
            .sectdata = null,
            .allocator = allocator,
        };

        return self;
    }

    pub fn deinit(self: *MachoFile) void {
        self.commands.deinit();
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
        var existing_cmd_idx: ?usize = null;
        var existing_cmd_offset: ?usize = null;

        outer: for (self.commands.items, 0..) |cmd, i| {
            if (cmd.cmd == @intFromEnum(macho.LC.SEGMENT_64)) {
                const command = @as(*const macho.segment_command_64, @ptrCast(@alignCast(&self.data.items[cmd.offset]))).*;
                if (mem.eql(u8, command.segName(), "__BUN")) {
                    if (command.nsects > 0) {
                        const sections = @as([*]const macho.section_64, @ptrCast(@alignCast(&self.data.items[cmd.offset + @sizeOf(macho.segment_command_64)])))[0..command.nsects];
                        for (sections) |*sect| {
                            if (mem.eql(u8, sect.sectName(), "__BUN")) {
                                existing_cmd_idx = i;
                                existing_cmd_offset = cmd.offset;
                                self.seg = command;
                                self.sec = sect.*;
                                self.seg.vmsize = alignVmsize(total_size, blob_alignment);
                                self.seg.filesize = alignVmsize(total_size, blob_alignment);
                                self.sec.size = @intCast(total_size);
                                self.sec.offset = @intCast(self.linkedit_cmd.fileoff);
                                break :outer;
                            }
                        }
                    }
                }
            }
        }

        var blob_data = try self.allocator.alloc(u8, aligned_size);
        @memset(blob_data, 0);

        var size: u32 = @intCast(data.len);
        const size_bytes = mem.asBytes(&size);
        @memcpy(blob_data[0..size_bytes.len], size_bytes);
        @memcpy(blob_data[header_size..][0..data.len], data);

        if (existing_cmd_idx) |idx| {
            // Update existing section
            const cmd = self.commands.items[idx];
            const old_seg = @as(*const macho.segment_command_64, @ptrCast(@alignCast(&self.data.items[cmd.offset]))).*;

            // Adjust linkedit offsets only if new size is different
            if (old_seg.filesize != self.seg.filesize) {
                const size_diff = @as(i64, @intCast(self.seg.filesize)) - @as(i64, @intCast(old_seg.filesize));
                self.linkedit_cmd.fileoff = @intCast(@as(i64, @intCast(self.linkedit_cmd.fileoff)) + size_diff);
                try self.updateLoadCommandOffsets(old_seg.fileoff, size_diff);
            }
        } else {
            // Add new section
            self.linkedit_cmd.vmaddr += self.seg.vmsize;
            self.linkedit_cmd.fileoff += self.seg.filesize;
            self.header.ncmds += 1;
            self.header.sizeofcmds += self.seg.cmdsize;
        }

        self.sectdata = blob_data;
    }

    // Helper function to update load command offsets when resizing an existing section
    fn updateLoadCommandOffsets(self: *MachoFile, start_offset: u64, size_diff: i64) !void {
        for (self.commands.items) |*cmd| {
            const cmd_ptr = @as([*]u8, @ptrCast(self.data.items.ptr))[cmd.offset..];

            switch (@as(macho.LC, @enumFromInt(cmd.cmd))) {
                .SYMTAB => {
                    var symtab: *macho.symtab_command = @ptrCast(@alignCast(cmd_ptr));
                    if (symtab.symoff > start_offset) {
                        symtab.symoff = @intCast(@as(i64, @intCast(symtab.symoff)) + size_diff);
                    }
                    if (symtab.stroff > start_offset) {
                        symtab.stroff = @intCast(@as(i64, @intCast(symtab.stroff)) + size_diff);
                    }
                },
                .DYSYMTAB => {
                    var dysymtab: *macho.dysymtab_command = @ptrCast(@alignCast(cmd_ptr));
                    if (dysymtab.tocoff > start_offset) {
                        dysymtab.tocoff = @intCast(@as(i64, @intCast(dysymtab.tocoff)) + size_diff);
                    }
                    if (dysymtab.modtaboff > start_offset) {
                        dysymtab.modtaboff = @intCast(@as(i64, @intCast(dysymtab.modtaboff)) + size_diff);
                    }
                    if (dysymtab.extrefsymoff > start_offset) {
                        dysymtab.extrefsymoff = @intCast(@as(i64, @intCast(dysymtab.extrefsymoff)) + size_diff);
                    }
                    if (dysymtab.indirectsymoff > start_offset) {
                        dysymtab.indirectsymoff = @intCast(@as(i64, @intCast(dysymtab.indirectsymoff)) + size_diff);
                    }
                    if (dysymtab.extreloff > start_offset) {
                        dysymtab.extreloff = @intCast(@as(i64, @intCast(dysymtab.extreloff)) + size_diff);
                    }
                    if (dysymtab.locreloff > start_offset) {
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
                    if (linkedit.dataoff > start_offset) {
                        linkedit.dataoff = @intCast(@as(i64, @intCast(linkedit.dataoff)) + size_diff);
                    }
                },
                .DYLD_INFO, .DYLD_INFO_ONLY => {
                    var dyld_info: *macho.dyld_info_command = @ptrCast(@alignCast(cmd_ptr));
                    if (dyld_info.rebase_off > start_offset) {
                        dyld_info.rebase_off = @intCast(@as(i64, @intCast(dyld_info.rebase_off)) + size_diff);
                    }
                    if (dyld_info.bind_off > start_offset) {
                        dyld_info.bind_off = @intCast(@as(i64, @intCast(dyld_info.bind_off)) + size_diff);
                    }
                    if (dyld_info.weak_bind_off > start_offset) {
                        dyld_info.weak_bind_off = @intCast(@as(i64, @intCast(dyld_info.weak_bind_off)) + size_diff);
                    }
                    if (dyld_info.lazy_bind_off > start_offset) {
                        dyld_info.lazy_bind_off = @intCast(@as(i64, @intCast(dyld_info.lazy_bind_off)) + size_diff);
                    }
                    if (dyld_info.export_off > start_offset) {
                        dyld_info.export_off = @intCast(@as(i64, @intCast(dyld_info.export_off)) + size_diff);
                    }
                },
                else => {},
            }
        }
    }

    pub fn build(self: *MachoFile, writer: anytype) !void {
        try writer.writeAll(mem.asBytes(&self.header));

        for (self.commands.items) |cmd| {
            if (cmd.cmd == @intFromEnum(macho.LC.SEGMENT_64)) {
                const segname = self.data.items[cmd.offset..][0..16];
                if (mem.eql(u8, segname[0..SEG_LINKEDIT.len], SEG_LINKEDIT)) {
                    try writer.writeAll(mem.asBytes(&self.seg));
                    try writer.writeAll(mem.asBytes(&self.sec));
                    try writer.writeAll(mem.asBytes(&self.linkedit_cmd));
                    continue;
                }
            }
            try writer.writeAll(self.data.items[cmd.offset..][0..cmd.cmdsize]);
        }

        var off = self.header.sizeofcmds + @sizeOf(macho.mach_header_64);
        const len: u32 = @truncate(self.rest_size - self.seg.cmdsize);
        try writer.writeAll(self.data.items[off..][0..len]);

        off += len;

        if (self.sectdata) |sectdata| {
            try writer.writeAll(sectdata);
            if (self.seg.filesize > sectdata.len) {
                const padding = try self.allocator.alloc(u8, @intCast(self.seg.filesize - sectdata.len));
                defer self.allocator.free(padding);
                @memset(padding, 0);
                try writer.writeAll(padding);
            }
        }

        try writer.writeAll(self.data.items[off..][0..self.linkedit_cmd.filesize]);
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

    // Add the MachoSigner implementation from the original file
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
                        const segname = cmd.data[0..16];
                        if (mem.eql(u8, segname[0..SEG_LINKEDIT.len], SEG_LINKEDIT)) {
                            linkedit_off = @intFromPtr(cmd.data.ptr) - @intFromPtr(obj.ptr);
                            linkedit_seg = seg;
                        } else if (mem.eql(u8, segname[0..6], "__TEXT")) {
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
