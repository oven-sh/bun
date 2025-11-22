mapped_memory: []align(std.heap.page_size_min) const u8,
symbols: []const Symbol,
strings: []const u8,
text_vmaddr: u64,

/// Key is index into `strings` of the file path.
ofiles: std.AutoArrayHashMapUnmanaged(u32, Error!OFile),

pub const Error = error{
    InvalidMachO,
    InvalidDwarf,
    MissingDebugInfo,
    UnsupportedDebugInfo,
    ReadFailed,
    OutOfMemory,
};

pub fn deinit(mf: *MachOFile, gpa: Allocator) void {
    for (mf.ofiles.values()) |*maybe_of| {
        const of = &(maybe_of.* catch continue);
        posix.munmap(of.mapped_memory);
        of.dwarf.deinit(gpa);
        of.symbols_by_name.deinit(gpa);
    }
    mf.ofiles.deinit(gpa);
    gpa.free(mf.symbols);
    posix.munmap(mf.mapped_memory);
}

pub fn load(gpa: Allocator, path: []const u8, arch: std.Target.Cpu.Arch) Error!MachOFile {
    switch (arch) {
        .x86_64, .aarch64 => {},
        else => unreachable,
    }

    const all_mapped_memory = try mapDebugInfoFile(path);
    errdefer posix.munmap(all_mapped_memory);

    // In most cases, the file we just mapped is a Mach-O binary. However, it could be a "universal
    // binary": a simple file format which contains Mach-O binaries for multiple targets. For
    // instance, `/usr/lib/dyld` is currently distributed as a universal binary containing images
    // for both ARM64 macOS and x86_64 macOS.
    if (all_mapped_memory.len < 4) return error.InvalidMachO;
    const magic = std.mem.readInt(u32, all_mapped_memory.ptr[0..4], .little);

    // The contents of a Mach-O file, which may or may not be the whole of `all_mapped_memory`.
    const mapped_macho = switch (magic) {
        macho.MH_MAGIC_64 => all_mapped_memory,

        macho.FAT_CIGAM => mapped_macho: {
            // This is the universal binary format (aka a "fat binary").
            var fat_r: Io.Reader = .fixed(all_mapped_memory);
            const hdr = fat_r.takeStruct(macho.fat_header, .big) catch |err| switch (err) {
                error.ReadFailed => unreachable,
                error.EndOfStream => return error.InvalidMachO,
            };
            const want_cpu_type = switch (arch) {
                .x86_64 => macho.CPU_TYPE_X86_64,
                .aarch64 => macho.CPU_TYPE_ARM64,
                else => unreachable,
            };
            for (0..hdr.nfat_arch) |_| {
                const fat_arch = fat_r.takeStruct(macho.fat_arch, .big) catch |err| switch (err) {
                    error.ReadFailed => unreachable,
                    error.EndOfStream => return error.InvalidMachO,
                };
                if (fat_arch.cputype != want_cpu_type) continue;
                if (fat_arch.offset + fat_arch.size > all_mapped_memory.len) return error.InvalidMachO;
                break :mapped_macho all_mapped_memory[fat_arch.offset..][0..fat_arch.size];
            }
            // `arch` was not present in the fat binary.
            return error.MissingDebugInfo;
        },

        // Even on modern 64-bit targets, this format doesn't seem to be too extensively used. It
        // will be fairly easy to add support here if necessary; it's very similar to above.
        macho.FAT_CIGAM_64 => return error.UnsupportedDebugInfo,

        else => return error.InvalidMachO,
    };

    var r: Io.Reader = .fixed(mapped_macho);
    const hdr = r.takeStruct(macho.mach_header_64, .little) catch |err| switch (err) {
        error.ReadFailed => unreachable,
        error.EndOfStream => return error.InvalidMachO,
    };

    if (hdr.magic != macho.MH_MAGIC_64)
        return error.InvalidMachO;

    const symtab: macho.symtab_command, const text_vmaddr: u64 = lcs: {
        var it: macho.LoadCommandIterator = try .init(&hdr, mapped_macho[@sizeOf(macho.mach_header_64)..]);
        var symtab: ?macho.symtab_command = null;
        var text_vmaddr: ?u64 = null;
        while (try it.next()) |cmd| switch (cmd.hdr.cmd) {
            .SYMTAB => symtab = cmd.cast(macho.symtab_command) orelse return error.InvalidMachO,
            .SEGMENT_64 => if (cmd.cast(macho.segment_command_64)) |seg_cmd| {
                if (!mem.eql(u8, seg_cmd.segName(), "__TEXT")) continue;
                text_vmaddr = seg_cmd.vmaddr;
            },
            else => {},
        };
        break :lcs .{
            symtab orelse return error.MissingDebugInfo,
            text_vmaddr orelse return error.MissingDebugInfo,
        };
    };

    const strings = mapped_macho[symtab.stroff..][0 .. symtab.strsize - 1];

    var symbols: std.ArrayList(Symbol) = try .initCapacity(gpa, symtab.nsyms);
    defer symbols.deinit(gpa);

    // This map is temporary; it is used only to detect duplicates here. This is
    // necessary because we prefer to use STAB ("symbolic debugging table") symbols,
    // but they might not be present, so we track normal symbols too.
    // Indices match 1-1 with those of `symbols`.
    var symbol_names: std.StringArrayHashMapUnmanaged(void) = .empty;
    defer symbol_names.deinit(gpa);
    try symbol_names.ensureUnusedCapacity(gpa, symtab.nsyms);

    var ofile: u32 = undefined;
    var last_sym: Symbol = undefined;
    var state: enum {
        init,
        oso_open,
        oso_close,
        bnsym,
        fun_strx,
        fun_size,
        ensym,
    } = .init;

    var sym_r: Io.Reader = .fixed(mapped_macho[symtab.symoff..]);
    for (0..symtab.nsyms) |_| {
        const sym = sym_r.takeStruct(macho.nlist_64, .little) catch |err| switch (err) {
            error.ReadFailed => unreachable,
            error.EndOfStream => return error.InvalidMachO,
        };
        if (sym.n_type.bits.is_stab == 0) {
            if (sym.n_strx == 0) continue;
            switch (sym.n_type.bits.type) {
                .undf, .pbud, .indr, .abs, _ => continue,
                .sect => {
                    const name = std.mem.sliceTo(strings[sym.n_strx..], 0);
                    const gop = symbol_names.getOrPutAssumeCapacity(name);
                    if (!gop.found_existing) {
                        assert(gop.index == symbols.items.len);
                        symbols.appendAssumeCapacity(.{
                            .strx = sym.n_strx,
                            .addr = sym.n_value,
                            .ofile = Symbol.unknown_ofile,
                        });
                    }
                },
            }
            continue;
        }

        // TODO handle globals N_GSYM, and statics N_STSYM
        switch (sym.n_type.stab) {
            .oso => switch (state) {
                .init, .oso_close => {
                    state = .oso_open;
                    ofile = sym.n_strx;
                },
                else => return error.InvalidMachO,
            },
            .bnsym => switch (state) {
                .oso_open, .ensym => {
                    state = .bnsym;
                    last_sym = .{
                        .strx = 0,
                        .addr = sym.n_value,
                        .ofile = ofile,
                    };
                },
                else => return error.InvalidMachO,
            },
            .fun => switch (state) {
                .bnsym => {
                    state = .fun_strx;
                    last_sym.strx = sym.n_strx;
                },
                .fun_strx => {
                    state = .fun_size;
                },
                else => return error.InvalidMachO,
            },
            .ensym => switch (state) {
                .fun_size => {
                    state = .ensym;
                    if (last_sym.strx != 0) {
                        const name = std.mem.sliceTo(strings[last_sym.strx..], 0);
                        const gop = symbol_names.getOrPutAssumeCapacity(name);
                        if (!gop.found_existing) {
                            assert(gop.index == symbols.items.len);
                            symbols.appendAssumeCapacity(last_sym);
                        } else {
                            symbols.items[gop.index] = last_sym;
                        }
                    }
                },
                else => return error.InvalidMachO,
            },
            .so => switch (state) {
                .init, .oso_close => {},
                .oso_open, .ensym => {
                    state = .oso_close;
                },
                else => return error.InvalidMachO,
            },
            else => {},
        }
    }

    switch (state) {
        .init => {
            // Missing STAB symtab entries is still okay, unless there were also no normal symbols.
            if (symbols.items.len == 0) return error.MissingDebugInfo;
        },
        .oso_close => {},
        else => return error.InvalidMachO, // corrupted STAB entries in symtab
    }

    const symbols_slice = try symbols.toOwnedSlice(gpa);
    errdefer gpa.free(symbols_slice);

    // Even though lld emits symbols in ascending order, this debug code
    // should work for programs linked in any valid way.
    // This sort is so that we can binary search later.
    mem.sort(Symbol, symbols_slice, {}, Symbol.addressLessThan);

    return .{
        .mapped_memory = all_mapped_memory,
        .symbols = symbols_slice,
        .strings = strings,
        .ofiles = .empty,
        .text_vmaddr = text_vmaddr,
    };
}
pub fn getDwarfForAddress(mf: *MachOFile, gpa: Allocator, vaddr: u64) !struct { *Dwarf, u64 } {
    const symbol = Symbol.find(mf.symbols, vaddr) orelse return error.MissingDebugInfo;

    if (symbol.ofile == Symbol.unknown_ofile) return error.MissingDebugInfo;

    // offset of `address` from start of `symbol`
    const address_symbol_offset = vaddr - symbol.addr;

    // Take the symbol name from the N_FUN STAB entry, we're going to
    // use it if we fail to find the DWARF infos
    const stab_symbol = mem.sliceTo(mf.strings[symbol.strx..], 0);

    const gop = try mf.ofiles.getOrPut(gpa, symbol.ofile);
    if (!gop.found_existing) {
        const name = mem.sliceTo(mf.strings[symbol.ofile..], 0);
        gop.value_ptr.* = loadOFile(gpa, name);
    }
    const of = &(gop.value_ptr.* catch |err| return err);

    const symbol_index = of.symbols_by_name.getKeyAdapted(
        @as([]const u8, stab_symbol),
        @as(OFile.SymbolAdapter, .{ .strtab = of.strtab, .symtab_raw = of.symtab_raw }),
    ) orelse return error.MissingDebugInfo;

    const symbol_ofile_vaddr = vaddr: {
        var sym = of.symtab_raw[symbol_index];
        if (builtin.cpu.arch.endian() != .little) std.mem.byteSwapAllFields(macho.nlist_64, &sym);
        break :vaddr sym.n_value;
    };

    return .{ &of.dwarf, symbol_ofile_vaddr + address_symbol_offset };
}
pub fn lookupSymbolName(mf: *MachOFile, vaddr: u64) error{MissingDebugInfo}![]const u8 {
    const symbol = Symbol.find(mf.symbols, vaddr) orelse return error.MissingDebugInfo;
    return mem.sliceTo(mf.strings[symbol.strx..], 0);
}

const OFile = struct {
    mapped_memory: []align(std.heap.page_size_min) const u8,
    dwarf: Dwarf,
    strtab: []const u8,
    symtab_raw: []align(1) const macho.nlist_64,
    /// All named symbols in `symtab_raw`. Stored `u32` key is the index into `symtab_raw`. Accessed
    /// through `SymbolAdapter`, so that the symbol name is used as the logical key.
    symbols_by_name: std.ArrayHashMapUnmanaged(u32, void, void, true),

    const SymbolAdapter = struct {
        strtab: []const u8,
        symtab_raw: []align(1) const macho.nlist_64,
        pub fn hash(ctx: SymbolAdapter, sym_name: []const u8) u32 {
            _ = ctx;
            return @truncate(std.hash.Wyhash.hash(0, sym_name));
        }
        pub fn eql(ctx: SymbolAdapter, a_sym_name: []const u8, b_sym_index: u32, b_index: usize) bool {
            _ = b_index;
            var b_sym = ctx.symtab_raw[b_sym_index];
            if (builtin.cpu.arch.endian() != .little) std.mem.byteSwapAllFields(macho.nlist_64, &b_sym);
            const b_sym_name = std.mem.sliceTo(ctx.strtab[b_sym.n_strx..], 0);
            return mem.eql(u8, a_sym_name, b_sym_name);
        }
    };
};

const Symbol = struct {
    strx: u32,
    addr: u64,
    /// Value may be `unknown_ofile`.
    ofile: u32,
    const unknown_ofile = std.math.maxInt(u32);
    fn addressLessThan(context: void, lhs: Symbol, rhs: Symbol) bool {
        _ = context;
        return lhs.addr < rhs.addr;
    }
    /// Assumes that `symbols` is sorted in order of ascending `addr`.
    fn find(symbols: []const Symbol, address: usize) ?*const Symbol {
        if (symbols.len == 0) return null; // no potential match
        if (address < symbols[0].addr) return null; // address is before the lowest-address symbol
        var left: usize = 0;
        var len: usize = symbols.len;
        while (len > 1) {
            const mid = left + len / 2;
            if (address < symbols[mid].addr) {
                len /= 2;
            } else {
                left = mid;
                len -= len / 2;
            }
        }
        return &symbols[left];
    }

    test find {
        const symbols: []const Symbol = &.{
            .{ .addr = 100, .strx = undefined, .ofile = undefined },
            .{ .addr = 200, .strx = undefined, .ofile = undefined },
            .{ .addr = 300, .strx = undefined, .ofile = undefined },
        };

        try testing.expectEqual(null, find(symbols, 0));
        try testing.expectEqual(null, find(symbols, 99));
        try testing.expectEqual(&symbols[0], find(symbols, 100).?);
        try testing.expectEqual(&symbols[0], find(symbols, 150).?);
        try testing.expectEqual(&symbols[0], find(symbols, 199).?);

        try testing.expectEqual(&symbols[1], find(symbols, 200).?);
        try testing.expectEqual(&symbols[1], find(symbols, 250).?);
        try testing.expectEqual(&symbols[1], find(symbols, 299).?);

        try testing.expectEqual(&symbols[2], find(symbols, 300).?);
        try testing.expectEqual(&symbols[2], find(symbols, 301).?);
        try testing.expectEqual(&symbols[2], find(symbols, 5000).?);
    }
};
test {
    _ = Symbol;
}

fn loadOFile(gpa: Allocator, o_file_name: []const u8) !OFile {
    const all_mapped_memory, const mapped_ofile = map: {
        const open_paren = paren: {
            if (std.mem.endsWith(u8, o_file_name, ")")) {
                if (std.mem.findScalarLast(u8, o_file_name, '(')) |i| {
                    break :paren i;
                }
            }
            // Not an archive, just a normal path to a .o file
            const m = try mapDebugInfoFile(o_file_name);
            break :map .{ m, m };
        };

        // We have the form 'path/to/archive.a(entry.o)'. Map the archive and find the object file in question.

        const archive_path = o_file_name[0..open_paren];
        const target_name_in_archive = o_file_name[open_paren + 1 .. o_file_name.len - 1];
        const mapped_archive = try mapDebugInfoFile(archive_path);
        errdefer posix.munmap(mapped_archive);

        var ar_reader: Io.Reader = .fixed(mapped_archive);
        const ar_magic = ar_reader.take(8) catch return error.InvalidMachO;
        if (!std.mem.eql(u8, ar_magic, "!<arch>\n")) return error.InvalidMachO;
        while (true) {
            if (ar_reader.seek == ar_reader.buffer.len) return error.MissingDebugInfo;

            const raw_name = ar_reader.takeArray(16) catch return error.InvalidMachO;
            ar_reader.discardAll(12 + 6 + 6 + 8) catch return error.InvalidMachO;
            const raw_size = ar_reader.takeArray(10) catch return error.InvalidMachO;
            const file_magic = ar_reader.takeArray(2) catch return error.InvalidMachO;
            if (!std.mem.eql(u8, file_magic, "`\n")) return error.InvalidMachO;

            const size = std.fmt.parseInt(u32, mem.sliceTo(raw_size, ' '), 10) catch return error.InvalidMachO;
            const raw_data = ar_reader.take(size) catch return error.InvalidMachO;

            const entry_name: []const u8, const entry_contents: []const u8 = entry: {
                if (!std.mem.startsWith(u8, raw_name, "#1/")) {
                    break :entry .{ mem.sliceTo(raw_name, '/'), raw_data };
                }
                const len = std.fmt.parseInt(u32, mem.sliceTo(raw_name[3..], ' '), 10) catch return error.InvalidMachO;
                if (len > size) return error.InvalidMachO;
                break :entry .{ mem.sliceTo(raw_data[0..len], 0), raw_data[len..] };
            };

            if (std.mem.eql(u8, entry_name, target_name_in_archive)) {
                break :map .{ mapped_archive, entry_contents };
            }
        }
    };
    errdefer posix.munmap(all_mapped_memory);

    var r: Io.Reader = .fixed(mapped_ofile);
    const hdr = r.takeStruct(macho.mach_header_64, .little) catch |err| switch (err) {
        error.ReadFailed => unreachable,
        error.EndOfStream => return error.InvalidMachO,
    };
    if (hdr.magic != std.macho.MH_MAGIC_64) return error.InvalidMachO;

    const seg_cmd: macho.LoadCommandIterator.LoadCommand, const symtab_cmd: macho.symtab_command = cmds: {
        var seg_cmd: ?macho.LoadCommandIterator.LoadCommand = null;
        var symtab_cmd: ?macho.symtab_command = null;
        var it: macho.LoadCommandIterator = try .init(&hdr, mapped_ofile[@sizeOf(macho.mach_header_64)..]);
        while (try it.next()) |lc| switch (lc.hdr.cmd) {
            .SEGMENT_64 => seg_cmd = lc,
            .SYMTAB => symtab_cmd = lc.cast(macho.symtab_command) orelse return error.InvalidMachO,
            else => {},
        };
        break :cmds .{
            seg_cmd orelse return error.MissingDebugInfo,
            symtab_cmd orelse return error.MissingDebugInfo,
        };
    };

    if (mapped_ofile.len < symtab_cmd.stroff + symtab_cmd.strsize) return error.InvalidMachO;
    if (mapped_ofile[symtab_cmd.stroff + symtab_cmd.strsize - 1] != 0) return error.InvalidMachO;
    const strtab = mapped_ofile[symtab_cmd.stroff..][0 .. symtab_cmd.strsize - 1];

    const n_sym_bytes = symtab_cmd.nsyms * @sizeOf(macho.nlist_64);
    if (mapped_ofile.len < symtab_cmd.symoff + n_sym_bytes) return error.InvalidMachO;
    const symtab_raw: []align(1) const macho.nlist_64 = @ptrCast(mapped_ofile[symtab_cmd.symoff..][0..n_sym_bytes]);

    // TODO handle tentative (common) symbols
    var symbols_by_name: std.ArrayHashMapUnmanaged(u32, void, void, true) = .empty;
    defer symbols_by_name.deinit(gpa);
    try symbols_by_name.ensureUnusedCapacity(gpa, @intCast(symtab_raw.len));
    for (symtab_raw, 0..) |sym_raw, sym_index| {
        var sym = sym_raw;
        if (builtin.cpu.arch.endian() != .little) std.mem.byteSwapAllFields(macho.nlist_64, &sym);
        if (sym.n_strx == 0) continue;
        switch (sym.n_type.bits.type) {
            .undf => continue, // includes tentative symbols
            .abs => continue,
            else => {},
        }
        const sym_name = mem.sliceTo(strtab[sym.n_strx..], 0);
        const gop = symbols_by_name.getOrPutAssumeCapacityAdapted(
            @as([]const u8, sym_name),
            @as(OFile.SymbolAdapter, .{ .strtab = strtab, .symtab_raw = symtab_raw }),
        );
        if (gop.found_existing) return error.InvalidMachO;
        gop.key_ptr.* = @intCast(sym_index);
    }

    var sections: Dwarf.SectionArray = @splat(null);
    for (seg_cmd.getSections()) |sect_raw| {
        var sect = sect_raw;
        if (builtin.cpu.arch.endian() != .little) std.mem.byteSwapAllFields(macho.section_64, &sect);

        if (!std.mem.eql(u8, "__DWARF", sect.segName())) continue;

        const section_index: usize = inline for (@typeInfo(Dwarf.Section.Id).@"enum".fields, 0..) |section, i| {
            if (mem.eql(u8, "__" ++ section.name, sect.sectName())) break i;
        } else continue;

        if (mapped_ofile.len < sect.offset + sect.size) return error.InvalidMachO;
        const section_bytes = mapped_ofile[sect.offset..][0..sect.size];
        sections[section_index] = .{
            .data = section_bytes,
            .owned = false,
        };
    }

    if (sections[@intFromEnum(Dwarf.Section.Id.debug_info)] == null or
        sections[@intFromEnum(Dwarf.Section.Id.debug_abbrev)] == null or
        sections[@intFromEnum(Dwarf.Section.Id.debug_str)] == null or
        sections[@intFromEnum(Dwarf.Section.Id.debug_line)] == null)
    {
        return error.MissingDebugInfo;
    }

    var dwarf: Dwarf = .{ .sections = sections };
    errdefer dwarf.deinit(gpa);
    dwarf.open(gpa, .little) catch |err| switch (err) {
        error.InvalidDebugInfo,
        error.EndOfStream,
        error.Overflow,
        error.StreamTooLong,
        => return error.InvalidDwarf,

        error.MissingDebugInfo,
        error.ReadFailed,
        error.OutOfMemory,
        => |e| return e,
    };

    return .{
        .mapped_memory = all_mapped_memory,
        .dwarf = dwarf,
        .strtab = strtab,
        .symtab_raw = symtab_raw,
        .symbols_by_name = symbols_by_name.move(),
    };
}

/// Uses `mmap` to map the file at `path` into memory.
fn mapDebugInfoFile(path: []const u8) ![]align(std.heap.page_size_min) const u8 {
    const file = std.fs.cwd().openFile(path, .{}) catch |err| switch (err) {
        error.FileNotFound => return error.MissingDebugInfo,
        else => return error.ReadFailed,
    };
    defer file.close();

    const file_len = std.math.cast(
        usize,
        file.getEndPos() catch return error.ReadFailed,
    ) orelse return error.ReadFailed;

    return posix.mmap(
        null,
        file_len,
        posix.PROT.READ,
        .{ .TYPE = .SHARED },
        file.handle,
        0,
    ) catch return error.ReadFailed;
}

const debug = @import("../new_debug.zig");
const std = @import("std");
const Allocator = std.mem.Allocator;
const Dwarf = debug.Dwarf;
const Io = std.Io;
const assert = std.debug.assert;
const posix = std.posix;
const macho = std.macho;
const mem = std.mem;
const testing = std.testing;

const builtin = @import("builtin");

const MachOFile = @This();
