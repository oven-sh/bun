//! A helper type for loading an ELF file and collecting its DWARF debug information, unwind
//! information, and symbol table.

is_64: bool,
endian: Endian,

/// This is `null` iff any of the required DWARF sections were missing. `ElfFile.load` does *not*
/// call `Dwarf.open`, `Dwarf.scanAllFunctions`, etc; that is the caller's responsibility.
dwarf: ?Dwarf,

/// If non-`null`, describes the `.eh_frame` section, which can be used with `Dwarf.Unwind`.
eh_frame: ?UnwindSection,
/// If non-`null`, describes the `.debug_frame` section, which can be used with `Dwarf.Unwind`.
debug_frame: ?UnwindSection,

/// If non-`null`, this is the contents of the `.strtab` section.
strtab: ?[]const u8,
/// If non-`null`, describes the `.symtab` section.
symtab: ?SymtabSection,

/// Binary search table lazily populated by `searchSymtab`.
symbol_search_table: ?[]usize,

/// The memory-mapped ELF file, which is referenced by `dwarf`. This field is here only so that
/// this memory can be unmapped by `ElfFile.deinit`.
mapped_file: []align(std.heap.page_size_min) const u8,
/// Sometimes, debug info is stored separately to the main ELF file. In that case, `mapped_file`
/// is the mapped ELF binary, and `mapped_debug_file` is the mapped debug info file. Both must
/// be unmapped by `ElfFile.deinit`.
mapped_debug_file: ?[]align(std.heap.page_size_min) const u8,

arena: std.heap.ArenaAllocator.State,

pub const UnwindSection = struct {
    vaddr: u64,
    bytes: []const u8,
};
pub const SymtabSection = struct {
    entry_size: u64,
    bytes: []const u8,
};

pub const DebugInfoSearchPaths = struct {
    /// The location of a debuginfod client directory, which acts as a search path for build IDs. If
    /// given, we can load from this directory opportunistically, but make no effort to populate it.
    /// To avoid allocation when building the search paths, this is given as two components which
    /// will be concatenated.
    debuginfod_client: ?[2][]const u8,
    /// All "global debug directories" on the system. These are used as search paths for both debug
    /// links and build IDs. On typical systems this is just "/usr/lib/debug".
    global_debug: []const []const u8,
    /// The path to the dirname of the ELF file, which acts as a search path for debug links.
    exe_dir: ?[]const u8,

    pub const none: DebugInfoSearchPaths = .{
        .debuginfod_client = null,
        .global_debug = &.{},
        .exe_dir = null,
    };

    pub fn native(exe_path: []const u8) DebugInfoSearchPaths {
        return .{
            .debuginfod_client = p: {
                if (std.posix.getenv("DEBUGINFOD_CACHE_PATH")) |p| {
                    break :p .{ p, "" };
                }
                if (std.posix.getenv("XDG_CACHE_HOME")) |cache_path| {
                    break :p .{ cache_path, "/debuginfod_client" };
                }
                if (std.posix.getenv("HOME")) |home_path| {
                    break :p .{ home_path, "/.cache/debuginfod_client" };
                }
                break :p null;
            },
            .global_debug = &.{
                "/usr/lib/debug",
            },
            .exe_dir = std.fs.path.dirname(exe_path) orelse ".",
        };
    }
};

pub fn deinit(ef: *ElfFile, gpa: Allocator) void {
    if (ef.dwarf) |*dwarf| dwarf.deinit(gpa);
    if (ef.symbol_search_table) |t| gpa.free(t);
    var arena = ef.arena.promote(gpa);
    arena.deinit();

    std.posix.munmap(ef.mapped_file);
    if (ef.mapped_debug_file) |m| std.posix.munmap(m);

    ef.* = undefined;
}

pub const LoadError = error{
    OutOfMemory,
    Overflow,
    TruncatedElfFile,
    InvalidCompressedSection,
    InvalidElfMagic,
    InvalidElfVersion,
    InvalidElfClass,
    InvalidElfEndian,
    // The remaining errors all occur when attemping to stat or mmap a file.
    SystemResources,
    MemoryMappingNotSupported,
    AccessDenied,
    LockedMemoryLimitExceeded,
    ProcessFdQuotaExceeded,
    SystemFdQuotaExceeded,
    Streaming,
    Canceled,
    Unexpected,
};

pub fn load(
    gpa: Allocator,
    elf_file: std.fs.File,
    opt_build_id: ?[]const u8,
    di_search_paths: *const DebugInfoSearchPaths,
) LoadError!ElfFile {
    var arena_instance: std.heap.ArenaAllocator = .init(gpa);
    errdefer arena_instance.deinit();
    const arena = arena_instance.allocator();

    var result = loadInner(arena, elf_file, null) catch |err| switch (err) {
        error.CrcMismatch => unreachable, // we passed crc as null
        else => |e| return e,
    };
    errdefer std.posix.munmap(result.mapped_mem);

    // `loadInner` did most of the work, but we might need to load an external debug info file

    const di_mapped_mem: ?[]align(std.heap.page_size_min) const u8 = load_di: {
        if (result.sections.get(.debug_info) != null and
            result.sections.get(.debug_abbrev) != null and
            result.sections.get(.debug_str) != null and
            result.sections.get(.debug_line) != null)
        {
            // The info is already loaded from this file alone!
            break :load_di null;
        }

        // We're missing some debug info---let's try and load it from a separate file.

        build_id: {
            const build_id = opt_build_id orelse break :build_id;
            if (build_id.len < 3) break :build_id;

            for (di_search_paths.global_debug) |global_debug| {
                if (try loadSeparateDebugFile(arena, &result, null, "{s}/.build-id/{x}/{x}.debug", .{
                    global_debug,
                    build_id[0..1],
                    build_id[1..],
                })) |mapped| break :load_di mapped;
            }

            if (di_search_paths.debuginfod_client) |components| {
                if (try loadSeparateDebugFile(arena, &result, null, "{s}{s}/{x}/debuginfo", .{
                    components[0],
                    components[1],
                    build_id,
                })) |mapped| break :load_di mapped;
            }
        }

        debug_link: {
            const section = result.sections.get(.gnu_debuglink) orelse break :debug_link;
            const debug_filename = std.mem.sliceTo(section.bytes, 0);
            const crc_offset = std.mem.alignForward(usize, debug_filename.len + 1, 4);
            if (section.bytes.len < crc_offset + 4) break :debug_link;
            const debug_crc = std.mem.readInt(u32, section.bytes[crc_offset..][0..4], result.endian);

            const exe_dir = di_search_paths.exe_dir orelse break :debug_link;

            if (try loadSeparateDebugFile(arena, &result, debug_crc, "{s}/{s}", .{
                exe_dir,
                debug_filename,
            })) |mapped| break :load_di mapped;
            if (try loadSeparateDebugFile(arena, &result, debug_crc, "{s}/.debug/{s}", .{
                exe_dir,
                debug_filename,
            })) |mapped| break :load_di mapped;
            for (di_search_paths.global_debug) |global_debug| {
                // This looks like a bug; it isn't. They really do embed the absolute path to the
                // exe's dirname, *under* the global debug path.
                if (try loadSeparateDebugFile(arena, &result, debug_crc, "{s}/{s}/{s}", .{
                    global_debug,
                    exe_dir,
                    debug_filename,
                })) |mapped| break :load_di mapped;
            }
        }

        break :load_di null;
    };
    errdefer comptime unreachable;

    return .{
        .is_64 = result.is_64,
        .endian = result.endian,
        .dwarf = dwarf: {
            if (result.sections.get(.debug_info) == null or
                result.sections.get(.debug_abbrev) == null or
                result.sections.get(.debug_str) == null or
                result.sections.get(.debug_line) == null)
            {
                break :dwarf null; // debug info not present
            }
            var sections: Dwarf.SectionArray = @splat(null);
            inline for (@typeInfo(Dwarf.Section.Id).@"enum".fields) |f| {
                if (result.sections.get(@field(Section.Id, f.name))) |s| {
                    sections[f.value] = .{ .data = s.bytes, .owned = false };
                }
            }
            break :dwarf .{ .sections = sections };
        },
        .eh_frame = if (result.sections.get(.eh_frame)) |s| .{
            .vaddr = s.header.sh_addr,
            .bytes = s.bytes,
        } else null,
        .debug_frame = if (result.sections.get(.debug_frame)) |s| .{
            .vaddr = s.header.sh_addr,
            .bytes = s.bytes,
        } else null,
        .strtab = if (result.sections.get(.strtab)) |s| s.bytes else null,
        .symtab = if (result.sections.get(.symtab)) |s| .{
            .entry_size = s.header.sh_entsize,
            .bytes = s.bytes,
        } else null,
        .symbol_search_table = null,
        .mapped_file = result.mapped_mem,
        .mapped_debug_file = di_mapped_mem,
        .arena = arena_instance.state,
    };
}

pub fn searchSymtab(ef: *ElfFile, gpa: Allocator, vaddr: u64) error{
    NoSymtab,
    NoStrtab,
    BadSymtab,
    OutOfMemory,
}!std.debug.Symbol {
    const symtab = ef.symtab orelse return error.NoSymtab;
    const strtab = ef.strtab orelse return error.NoStrtab;

    if (symtab.bytes.len % symtab.entry_size != 0) return error.BadSymtab;

    const swap_endian = ef.endian != @import("builtin").cpu.arch.endian();

    switch (ef.is_64) {
        inline true, false => |is_64| {
            const Sym = if (is_64) elf.Elf64_Sym else elf.Elf32_Sym;
            if (symtab.entry_size != @sizeOf(Sym)) return error.BadSymtab;
            const symbols: []align(1) const Sym = @ptrCast(symtab.bytes);
            if (ef.symbol_search_table == null) {
                ef.symbol_search_table = try buildSymbolSearchTable(gpa, ef.endian, Sym, symbols);
            }
            const search_table = ef.symbol_search_table.?;
            const SearchContext = struct {
                swap_endian: bool,
                target: u64,
                symbols: []align(1) const Sym,
                fn predicate(ctx: @This(), sym_index: usize) bool {
                    // We need to return `true` for the first N items, then `false` for the rest --
                    // the index we'll get out is the first `false` one. So, we'll return `true` iff
                    // the target address is after the *end* of this symbol. This synchronizes with
                    // the logic in `buildSymbolSearchTable` which sorts by *end* address.
                    var sym = ctx.symbols[sym_index];
                    if (ctx.swap_endian) std.mem.byteSwapAllFields(Sym, &sym);
                    const sym_end = sym.st_value + sym.st_size;
                    return ctx.target >= sym_end;
                }
            };
            const sym_index_index = std.sort.partitionPoint(usize, search_table, @as(SearchContext, .{
                .swap_endian = swap_endian,
                .target = vaddr,
                .symbols = symbols,
            }), SearchContext.predicate);
            if (sym_index_index == search_table.len) return .unknown;
            var sym = symbols[search_table[sym_index_index]];
            if (swap_endian) std.mem.byteSwapAllFields(Sym, &sym);
            if (vaddr < sym.st_value or vaddr >= sym.st_value + sym.st_size) return .unknown;
            return .{
                .name = std.mem.sliceTo(strtab[sym.st_name..], 0),
                .compile_unit_name = null,
                .source_location = null,
            };
        },
    }
}

fn buildSymbolSearchTable(gpa: Allocator, endian: Endian, comptime Sym: type, symbols: []align(1) const Sym) error{
    OutOfMemory,
    BadSymtab,
}![]usize {
    var result: std.ArrayList(usize) = .empty;
    defer result.deinit(gpa);

    const swap_endian = endian != @import("builtin").cpu.arch.endian();

    for (symbols, 0..) |sym_orig, sym_index| {
        var sym = sym_orig;
        if (swap_endian) std.mem.byteSwapAllFields(Sym, &sym);
        if (sym.st_name == 0) continue;
        if (sym.st_shndx == elf.SHN_UNDEF) continue;
        try result.append(gpa, sym_index);
    }

    const SortContext = struct {
        swap_endian: bool,
        symbols: []align(1) const Sym,
        fn lessThan(ctx: @This(), lhs_sym_index: usize, rhs_sym_index: usize) bool {
            // We sort by *end* address, not start address. This matches up with logic in `searchSymtab`.
            var lhs_sym = ctx.symbols[lhs_sym_index];
            var rhs_sym = ctx.symbols[rhs_sym_index];
            if (ctx.swap_endian) {
                std.mem.byteSwapAllFields(Sym, &lhs_sym);
                std.mem.byteSwapAllFields(Sym, &rhs_sym);
            }
            const lhs_val = lhs_sym.st_value + lhs_sym.st_size;
            const rhs_val = rhs_sym.st_value + rhs_sym.st_size;
            return lhs_val < rhs_val;
        }
    };
    std.mem.sort(usize, result.items, @as(SortContext, .{
        .swap_endian = swap_endian,
        .symbols = symbols,
    }), SortContext.lessThan);

    return result.toOwnedSlice(gpa);
}

/// Only used locally, during `load`.
const Section = struct {
    header: elf.Elf64_Shdr,
    bytes: []const u8,
    const Id = enum {
        // DWARF sections: see `Dwarf.Section.Id`.
        debug_info,
        debug_abbrev,
        debug_str,
        debug_str_offsets,
        debug_line,
        debug_line_str,
        debug_ranges,
        debug_loclists,
        debug_rnglists,
        debug_addr,
        debug_names,
        // Then anything else we're interested in.
        gnu_debuglink,
        eh_frame,
        debug_frame,
        symtab,
        strtab,
    };
    const Array = std.enums.EnumArray(Section.Id, ?Section);
};

fn loadSeparateDebugFile(arena: Allocator, main_loaded: *LoadInnerResult, opt_crc: ?u32, comptime fmt: []const u8, args: anytype) Allocator.Error!?[]align(std.heap.page_size_min) const u8 {
    const path = try std.fmt.allocPrint(arena, fmt, args);
    const elf_file = std.fs.cwd().openFile(path, .{}) catch return null;
    defer elf_file.close();

    const result = loadInner(arena, elf_file, opt_crc) catch |err| switch (err) {
        error.OutOfMemory => |e| return e,
        error.CrcMismatch => return null,
        else => return null,
    };
    errdefer comptime unreachable;

    const have_debug_sections = inline for (@as([]const []const u8, &.{
        "debug_info",
        "debug_abbrev",
        "debug_str",
        "debug_line",
    })) |name| {
        const s = @field(Section.Id, name);
        if (main_loaded.sections.get(s) == null and result.sections.get(s) == null) {
            break false;
        }
    } else true;

    if (result.is_64 != main_loaded.is_64 or
        result.endian != main_loaded.endian or
        !have_debug_sections)
    {
        std.posix.munmap(result.mapped_mem);
        return null;
    }

    inline for (@typeInfo(Dwarf.Section.Id).@"enum".fields) |f| {
        const id = @field(Section.Id, f.name);
        if (main_loaded.sections.get(id) == null) {
            main_loaded.sections.set(id, result.sections.get(id));
        }
    }

    return result.mapped_mem;
}

const LoadInnerResult = struct {
    is_64: bool,
    endian: Endian,
    sections: Section.Array,
    mapped_mem: []align(std.heap.page_size_min) const u8,
};
fn loadInner(
    arena: Allocator,
    elf_file: std.fs.File,
    opt_crc: ?u32,
) (LoadError || error{ CrcMismatch, Streaming, Canceled })!LoadInnerResult {
    const mapped_mem: []align(std.heap.page_size_min) const u8 = mapped: {
        const file_len = std.math.cast(
            usize,
            elf_file.getEndPos() catch |err| switch (err) {
                error.PermissionDenied => unreachable, // not asking for PROT_EXEC
                else => |e| return e,
            },
        ) orelse return error.Overflow;

        break :mapped std.posix.mmap(
            null,
            file_len,
            std.posix.PROT.READ,
            .{ .TYPE = .SHARED },
            elf_file.handle,
            0,
        ) catch |err| switch (err) {
            error.MappingAlreadyExists => unreachable, // not using FIXED_NOREPLACE
            error.PermissionDenied => unreachable, // not asking for PROT_EXEC
            else => |e| return e,
        };
    };

    if (opt_crc) |crc| {
        if (std.hash.crc.Crc32.hash(mapped_mem) != crc) {
            return error.CrcMismatch;
        }
    }
    errdefer std.posix.munmap(mapped_mem);

    var fr: std.Io.Reader = .fixed(mapped_mem);

    const header = elf.Header.read(&fr) catch |err| switch (err) {
        error.ReadFailed => unreachable,
        error.EndOfStream => return error.TruncatedElfFile,

        error.InvalidElfMagic,
        error.InvalidElfVersion,
        error.InvalidElfClass,
        error.InvalidElfEndian,
        => |e| return e,
    };
    const endian = header.endian;

    const shstrtab_shdr_off = try std.math.add(
        u64,
        header.shoff,
        try std.math.mul(u64, header.shstrndx, header.shentsize),
    );
    fr.seek = std.math.cast(usize, shstrtab_shdr_off) orelse return error.Overflow;
    const shstrtab: []const u8 = if (header.is_64) shstrtab: {
        const shdr = fr.takeStruct(elf.Elf64_Shdr, endian) catch return error.TruncatedElfFile;
        if (shdr.sh_offset + shdr.sh_size > mapped_mem.len) return error.TruncatedElfFile;
        break :shstrtab mapped_mem[@intCast(shdr.sh_offset)..][0..@intCast(shdr.sh_size)];
    } else shstrtab: {
        const shdr = fr.takeStruct(elf.Elf32_Shdr, endian) catch return error.TruncatedElfFile;
        if (shdr.sh_offset + shdr.sh_size > mapped_mem.len) return error.TruncatedElfFile;
        break :shstrtab mapped_mem[@intCast(shdr.sh_offset)..][0..@intCast(shdr.sh_size)];
    };

    var sections: Section.Array = .initFill(null);

    var it = header.iterateSectionHeadersBuffer(mapped_mem);
    while (it.next() catch return error.TruncatedElfFile) |shdr| {
        if (shdr.sh_type == elf.SHT_NULL or shdr.sh_type == elf.SHT_NOBITS) continue;
        if (shdr.sh_name > shstrtab.len) return error.TruncatedElfFile;
        const name = std.mem.sliceTo(shstrtab[@intCast(shdr.sh_name)..], 0);

        const section_id: Section.Id = inline for (@typeInfo(Section.Id).@"enum".fields) |s| {
            if (std.mem.eql(u8, "." ++ s.name, name)) {
                break @enumFromInt(s.value);
            }
        } else continue;

        if (sections.get(section_id) != null) continue;

        if (shdr.sh_offset + shdr.sh_size > mapped_mem.len) return error.TruncatedElfFile;
        const raw_section_bytes = mapped_mem[@intCast(shdr.sh_offset)..][0..@intCast(shdr.sh_size)];
        const section_bytes: []const u8 = bytes: {
            if ((shdr.sh_flags & elf.SHF_COMPRESSED) == 0) break :bytes raw_section_bytes;

            var section_reader: std.Io.Reader = .fixed(raw_section_bytes);
            const ch_type: elf.COMPRESS, const ch_size: u64 = if (header.is_64) ch: {
                const chdr = section_reader.takeStruct(elf.Elf64_Chdr, endian) catch return error.InvalidCompressedSection;
                break :ch .{ chdr.ch_type, chdr.ch_size };
            } else ch: {
                const chdr = section_reader.takeStruct(elf.Elf32_Chdr, endian) catch return error.InvalidCompressedSection;
                break :ch .{ chdr.ch_type, chdr.ch_size };
            };
            if (ch_type != .ZLIB) {
                // The compression algorithm is unsupported, but don't make that a hard error; the
                // file might still be valid, and we might still be okay without this section.
                continue;
            }

            const buf = try arena.alloc(u8, std.math.cast(usize, ch_size) orelse return error.Overflow);
            var fw: std.Io.Writer = .fixed(buf);
            var decompress: std.compress.flate.Decompress = .init(&section_reader, .zlib, &.{});
            const n = decompress.reader.streamRemaining(&fw) catch |err| switch (err) {
                // If a write failed, then `buf` filled up, so `ch_size` was incorrect
                error.WriteFailed => return error.InvalidCompressedSection,
                // If a read failed, flate expected the section to have more data
                error.ReadFailed => return error.InvalidCompressedSection,
            };
            // It's also an error if the data is shorter than expected.
            if (n != buf.len) return error.InvalidCompressedSection;
            break :bytes buf;
        };
        sections.set(section_id, .{ .header = shdr, .bytes = section_bytes });
    }

    return .{
        .is_64 = header.is_64,
        .endian = endian,
        .sections = sections,
        .mapped_mem = mapped_mem,
    };
}

const std = @import("std");
const Endian = std.builtin.Endian;
const debug = @import("../new_debug.zig");
const Dwarf = debug.Dwarf;
const ElfFile = @This();
const Allocator = std.mem.Allocator;
const elf = std.elf;
