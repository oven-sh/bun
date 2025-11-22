//! Implements parsing, decoding, and caching of DWARF information.
//!
//! This API makes no assumptions about the relationship between the host and
//! the target being debugged. In other words, any DWARF information can be used
//! from any host via this API. Note, however, that the limits of 32-bit
//! addressing can cause very large 64-bit binaries to be impossible to open on
//! 32-bit hosts.
//!
//! For unopinionated types and bits, see `std.dwarf`.

const std = @import("std");
const Allocator = std.mem.Allocator;
const mem = std.mem;
const DW = std.dwarf;
const AT = DW.AT;
const FORM = DW.FORM;
const Format = DW.Format;
const RLE = DW.RLE;
const UT = DW.UT;
const assert = std.debug.assert;
const cast = std.math.cast;
const maxInt = std.math.maxInt;
const ArrayList = std.ArrayList;
const Endian = std.builtin.Endian;
const Reader = std.Io.Reader;

const Dwarf = @This();

pub const expression = @import("Dwarf/expression.zig");
pub const Unwind = @import("Dwarf/Unwind.zig");
pub const SelfUnwinder = @import("Dwarf/SelfUnwinder.zig");

/// Useful to temporarily enable while working on this file.
const debug_debug_mode = false;

sections: SectionArray = @splat(null),

/// Filled later by the initializer
abbrev_table_list: ArrayList(Abbrev.Table) = .empty,
/// Filled later by the initializer
compile_unit_list: ArrayList(CompileUnit) = .empty,
/// Filled later by the initializer
func_list: ArrayList(Func) = .empty,

/// Populated by `populateRanges`.
ranges: ArrayList(Range) = .empty,

pub const Range = struct {
    start: u64,
    end: u64,
    /// Index into `compile_unit_list`.
    compile_unit_index: usize,
};

pub const Section = struct {
    data: []const u8,
    /// If `data` is owned by this Dwarf.
    owned: bool,

    pub const Id = enum {
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
    };
};

pub const Abbrev = struct {
    code: u64,
    tag_id: u64,
    has_children: bool,
    attrs: []Attr,

    fn deinit(abbrev: *Abbrev, gpa: Allocator) void {
        gpa.free(abbrev.attrs);
        abbrev.* = undefined;
    }

    const Attr = struct {
        id: u64,
        form_id: u64,
        /// Only valid if form_id is .implicit_const
        payload: i64,
    };

    const Table = struct {
        // offset from .debug_abbrev
        offset: u64,
        abbrevs: []Abbrev,

        fn deinit(table: *Table, gpa: Allocator) void {
            for (table.abbrevs) |*abbrev| {
                abbrev.deinit(gpa);
            }
            gpa.free(table.abbrevs);
            table.* = undefined;
        }

        fn get(table: *const Table, abbrev_code: u64) ?*const Abbrev {
            return for (table.abbrevs) |*abbrev| {
                if (abbrev.code == abbrev_code) break abbrev;
            } else null;
        }
    };
};

pub const CompileUnit = struct {
    version: u16,
    format: Format,
    addr_size_bytes: u8,
    die: Die,
    pc_range: ?PcRange,

    str_offsets_base: usize,
    addr_base: usize,
    rnglists_base: usize,
    loclists_base: usize,
    frame_base: ?*const FormValue,

    src_loc_cache: ?SrcLocCache,

    pub const SrcLocCache = struct {
        line_table: LineTable,
        directories: []const FileEntry,
        files: []FileEntry,
        version: u16,

        pub const LineTable = std.AutoArrayHashMapUnmanaged(u64, LineEntry);

        pub const LineEntry = struct {
            line: u32,
            column: u32,
            /// Offset by 1 depending on whether Dwarf version is >= 5.
            file: u32,

            pub const invalid: LineEntry = .{
                .line = undefined,
                .column = undefined,
                .file = std.math.maxInt(u32),
            };

            pub fn isInvalid(le: LineEntry) bool {
                return le.file == invalid.file;
            }
        };

        pub fn findSource(slc: *const SrcLocCache, address: u64) !LineEntry {
            const index = std.sort.upperBound(u64, slc.line_table.keys(), address, struct {
                fn order(context: u64, item: u64) std.math.Order {
                    return std.math.order(context, item);
                }
            }.order);
            if (index == 0) return missing();
            return slc.line_table.values()[index - 1];
        }
    };
};

pub const FormValue = union(enum) {
    addr: u64,
    addrx: u64,
    block: []const u8,
    udata: u64,
    data16: *const [16]u8,
    sdata: i64,
    exprloc: []const u8,
    flag: bool,
    sec_offset: u64,
    ref: u64,
    ref_addr: u64,
    string: [:0]const u8,
    strp: u64,
    strx: u64,
    line_strp: u64,
    loclistx: u64,
    rnglistx: u64,

    fn getString(fv: FormValue, di: Dwarf) ![:0]const u8 {
        switch (fv) {
            .string => |s| return s,
            .strp => |off| return di.getString(off),
            .line_strp => |off| return di.getLineString(off),
            else => return bad(),
        }
    }

    fn getUInt(fv: FormValue, comptime U: type) !U {
        return switch (fv) {
            inline .udata,
            .sdata,
            .sec_offset,
            => |c| cast(U, c) orelse bad(),
            else => bad(),
        };
    }
};

pub const Die = struct {
    tag_id: u64,
    has_children: bool,
    attrs: []Attr,

    const Attr = struct {
        id: u64,
        value: FormValue,
    };

    fn deinit(self: *Die, gpa: Allocator) void {
        gpa.free(self.attrs);
        self.* = undefined;
    }

    fn getAttr(self: *const Die, id: u64) ?*const FormValue {
        for (self.attrs) |*attr| {
            if (attr.id == id) return &attr.value;
        }
        return null;
    }

    fn getAttrAddr(
        self: *const Die,
        di: *const Dwarf,
        endian: Endian,
        id: u64,
        compile_unit: *const CompileUnit,
    ) error{ InvalidDebugInfo, MissingDebugInfo }!u64 {
        const form_value = self.getAttr(id) orelse return error.MissingDebugInfo;
        return switch (form_value.*) {
            .addr => |value| value,
            .addrx => |index| di.readDebugAddr(endian, compile_unit, index),
            else => bad(),
        };
    }

    fn getAttrSecOffset(self: *const Die, id: u64) !u64 {
        const form_value = self.getAttr(id) orelse return error.MissingDebugInfo;
        return form_value.getUInt(u64);
    }

    fn getAttrUnsignedLe(self: *const Die, id: u64) !u64 {
        const form_value = self.getAttr(id) orelse return error.MissingDebugInfo;
        return switch (form_value.*) {
            .Const => |value| value.asUnsignedLe(),
            else => bad(),
        };
    }

    fn getAttrRef(self: *const Die, id: u64, unit_offset: u64, unit_len: u64) !u64 {
        const form_value = self.getAttr(id) orelse return error.MissingDebugInfo;
        return switch (form_value.*) {
            .ref => |offset| if (offset < unit_len) unit_offset + offset else bad(),
            .ref_addr => |addr| addr,
            else => bad(),
        };
    }

    pub fn getAttrString(
        self: *const Die,
        di: *Dwarf,
        endian: Endian,
        id: u64,
        opt_str: ?[]const u8,
        compile_unit: *const CompileUnit,
    ) error{ InvalidDebugInfo, MissingDebugInfo }![]const u8 {
        const form_value = self.getAttr(id) orelse return error.MissingDebugInfo;
        switch (form_value.*) {
            .string => |value| return value,
            .strp => |offset| return di.getString(offset),
            .strx => |index| {
                const debug_str_offsets = di.section(.debug_str_offsets) orelse return bad();
                if (compile_unit.str_offsets_base == 0) return bad();
                switch (compile_unit.format) {
                    .@"32" => {
                        const byte_offset = compile_unit.str_offsets_base + 4 * index;
                        if (byte_offset + 4 > debug_str_offsets.len) return bad();
                        const offset = mem.readInt(u32, debug_str_offsets[@intCast(byte_offset)..][0..4], endian);
                        return getStringGeneric(opt_str, offset);
                    },
                    .@"64" => {
                        const byte_offset = compile_unit.str_offsets_base + 8 * index;
                        if (byte_offset + 8 > debug_str_offsets.len) return bad();
                        const offset = mem.readInt(u64, debug_str_offsets[@intCast(byte_offset)..][0..8], endian);
                        return getStringGeneric(opt_str, offset);
                    },
                }
            },
            .line_strp => |offset| return di.getLineString(offset),
            else => return bad(),
        }
    }
};

const num_sections = std.enums.directEnumArrayLen(Section.Id, 0);
pub const SectionArray = [num_sections]?Section;

pub const OpenError = ScanError;

/// Initialize DWARF info. The caller has the responsibility to initialize most
/// the `Dwarf` fields before calling. `binary_mem` is the raw bytes of the
/// main binary file (not the secondary debug info file).
pub fn open(d: *Dwarf, gpa: Allocator, endian: Endian) OpenError!void {
    try d.scanAllFunctions(gpa, endian);
    try d.scanAllCompileUnits(gpa, endian);
}

const PcRange = struct {
    start: u64,
    end: u64,
};

const Func = struct {
    pc_range: ?PcRange,
    name: ?[]const u8,
};

pub fn section(di: Dwarf, dwarf_section: Section.Id) ?[]const u8 {
    return if (di.sections[@intFromEnum(dwarf_section)]) |s| s.data else null;
}

pub fn deinit(di: *Dwarf, gpa: Allocator) void {
    for (di.sections) |opt_section| {
        if (opt_section) |s| if (s.owned) gpa.free(s.data);
    }
    for (di.abbrev_table_list.items) |*abbrev| {
        abbrev.deinit(gpa);
    }
    di.abbrev_table_list.deinit(gpa);
    for (di.compile_unit_list.items) |*cu| {
        if (cu.src_loc_cache) |*slc| {
            slc.line_table.deinit(gpa);
            gpa.free(slc.directories);
            gpa.free(slc.files);
        }
        cu.die.deinit(gpa);
    }
    di.compile_unit_list.deinit(gpa);
    di.func_list.deinit(gpa);
    di.ranges.deinit(gpa);
    di.* = undefined;
}

pub fn getSymbolName(di: *const Dwarf, address: u64) ?[]const u8 {
    // Iterate the function list backwards so that we see child DIEs before their parents. This is
    // important because `DW_TAG_inlined_subroutine` DIEs will have a range which is a sub-range of
    // their caller, and we want to return the callee's name, not the caller's.
    var i: usize = di.func_list.items.len;
    while (i > 0) {
        i -= 1;
        const func = &di.func_list.items[i];
        if (func.pc_range) |range| {
            if (address >= range.start and address < range.end) {
                return func.name;
            }
        }
    }

    return null;
}

pub const ScanError = error{
    InvalidDebugInfo,
    MissingDebugInfo,
    ReadFailed,
    EndOfStream,
    Overflow,
    StreamTooLong,
} || Allocator.Error;

fn scanAllFunctions(di: *Dwarf, gpa: Allocator, endian: Endian) ScanError!void {
    var fr: Reader = .fixed(di.section(.debug_info).?);
    var this_unit_offset: u64 = 0;

    while (this_unit_offset < fr.buffer.len) {
        fr.seek = @intCast(this_unit_offset);

        const unit_header = try readUnitHeader(&fr, endian);
        if (unit_header.unit_length == 0) return;
        const next_offset = unit_header.header_length + unit_header.unit_length;

        const version = try fr.takeInt(u16, endian);
        if (version < 2 or version > 5) return bad();

        var address_size: u8 = undefined;
        var debug_abbrev_offset: u64 = undefined;
        if (version >= 5) {
            const unit_type = try fr.takeByte();
            if (unit_type != DW.UT.compile) return bad();
            address_size = try fr.takeByte();
            debug_abbrev_offset = try readFormatSizedInt(&fr, unit_header.format, endian);
        } else {
            debug_abbrev_offset = try readFormatSizedInt(&fr, unit_header.format, endian);
            address_size = try fr.takeByte();
        }

        const abbrev_table = try di.getAbbrevTable(gpa, debug_abbrev_offset);

        var max_attrs: usize = 0;
        var zig_padding_abbrev_code: u7 = 0;
        for (abbrev_table.abbrevs) |abbrev| {
            max_attrs = @max(max_attrs, abbrev.attrs.len);
            if (cast(u7, abbrev.code)) |code| {
                if (abbrev.tag_id == DW.TAG.ZIG_padding and
                    !abbrev.has_children and
                    abbrev.attrs.len == 0)
                {
                    zig_padding_abbrev_code = code;
                }
            }
        }
        const attrs_buf = try gpa.alloc(Die.Attr, max_attrs * 3);
        defer gpa.free(attrs_buf);
        var attrs_bufs: [3][]Die.Attr = undefined;
        for (&attrs_bufs, 0..) |*buf, index| buf.* = attrs_buf[index * max_attrs ..][0..max_attrs];

        const next_unit_pos = this_unit_offset + next_offset;

        var compile_unit: CompileUnit = .{
            .version = version,
            .format = unit_header.format,
            .addr_size_bytes = address_size,
            .die = undefined,
            .pc_range = null,

            .str_offsets_base = 0,
            .addr_base = 0,
            .rnglists_base = 0,
            .loclists_base = 0,
            .frame_base = null,
            .src_loc_cache = null,
        };

        while (true) {
            fr.seek = std.mem.indexOfNonePos(u8, fr.buffer, fr.seek, &.{
                zig_padding_abbrev_code, 0,
            }) orelse fr.buffer.len;
            if (fr.seek >= next_unit_pos) break;
            var die_obj = (try parseDie(
                &fr,
                attrs_bufs[0],
                abbrev_table,
                unit_header.format,
                endian,
                address_size,
            )) orelse continue;

            switch (die_obj.tag_id) {
                DW.TAG.compile_unit => {
                    compile_unit.die = die_obj;
                    compile_unit.die.attrs = attrs_bufs[1][0..die_obj.attrs.len];
                    @memcpy(compile_unit.die.attrs, die_obj.attrs);

                    compile_unit.str_offsets_base = if (die_obj.getAttr(AT.str_offsets_base)) |fv| try fv.getUInt(usize) else 0;
                    compile_unit.addr_base = if (die_obj.getAttr(AT.addr_base)) |fv| try fv.getUInt(usize) else 0;
                    compile_unit.rnglists_base = if (die_obj.getAttr(AT.rnglists_base)) |fv| try fv.getUInt(usize) else 0;
                    compile_unit.loclists_base = if (die_obj.getAttr(AT.loclists_base)) |fv| try fv.getUInt(usize) else 0;
                    compile_unit.frame_base = die_obj.getAttr(AT.frame_base);
                },
                DW.TAG.subprogram, DW.TAG.inlined_subroutine, DW.TAG.subroutine, DW.TAG.entry_point => {
                    const fn_name = x: {
                        var this_die_obj = die_obj;
                        // Prevent endless loops
                        for (0..3) |_| {
                            if (this_die_obj.getAttr(AT.name)) |_| {
                                break :x try this_die_obj.getAttrString(di, endian, AT.name, di.section(.debug_str), &compile_unit);
                            } else if (this_die_obj.getAttr(AT.abstract_origin)) |_| {
                                const after_die_offset = fr.seek;
                                defer fr.seek = after_die_offset;

                                // Follow the DIE it points to and repeat
                                const ref_offset = try this_die_obj.getAttrRef(AT.abstract_origin, this_unit_offset, next_offset);
                                fr.seek = @intCast(ref_offset);
                                this_die_obj = (try parseDie(
                                    &fr,
                                    attrs_bufs[2],
                                    abbrev_table, // wrong abbrev table for different cu
                                    unit_header.format,
                                    endian,
                                    address_size,
                                )) orelse return bad();
                            } else if (this_die_obj.getAttr(AT.specification)) |_| {
                                const after_die_offset = fr.seek;
                                defer fr.seek = after_die_offset;

                                // Follow the DIE it points to and repeat
                                const ref_offset = try this_die_obj.getAttrRef(AT.specification, this_unit_offset, next_offset);
                                fr.seek = @intCast(ref_offset);
                                this_die_obj = (try parseDie(
                                    &fr,
                                    attrs_bufs[2],
                                    abbrev_table, // wrong abbrev table for different cu
                                    unit_header.format,
                                    endian,
                                    address_size,
                                )) orelse return bad();
                            } else {
                                break :x null;
                            }
                        }

                        break :x null;
                    };

                    var range_added = if (die_obj.getAttrAddr(di, endian, AT.low_pc, &compile_unit)) |low_pc| blk: {
                        if (die_obj.getAttr(AT.high_pc)) |high_pc_value| {
                            const pc_end = switch (high_pc_value.*) {
                                .addr => |value| value,
                                .udata => |offset| low_pc + offset,
                                else => return bad(),
                            };

                            try di.func_list.append(gpa, .{
                                .name = fn_name,
                                .pc_range = .{
                                    .start = low_pc,
                                    .end = pc_end,
                                },
                            });

                            break :blk true;
                        }

                        break :blk false;
                    } else |err| blk: {
                        if (err != error.MissingDebugInfo) return err;
                        break :blk false;
                    };

                    if (die_obj.getAttr(AT.ranges)) |ranges_value| blk: {
                        var iter = DebugRangeIterator.init(ranges_value, di, endian, &compile_unit) catch |err| {
                            if (err != error.MissingDebugInfo) return err;
                            break :blk;
                        };

                        while (try iter.next()) |range| {
                            range_added = true;
                            try di.func_list.append(gpa, .{
                                .name = fn_name,
                                .pc_range = .{
                                    .start = range.start,
                                    .end = range.end,
                                },
                            });
                        }
                    }

                    if (fn_name != null and !range_added) {
                        try di.func_list.append(gpa, .{
                            .name = fn_name,
                            .pc_range = null,
                        });
                    }
                },
                else => {},
            }
        }

        this_unit_offset += next_offset;
    }
}

fn scanAllCompileUnits(di: *Dwarf, gpa: Allocator, endian: Endian) ScanError!void {
    var fr: Reader = .fixed(di.section(.debug_info).?);
    var this_unit_offset: u64 = 0;

    var attrs_buf = std.array_list.Managed(Die.Attr).init(gpa);
    defer attrs_buf.deinit();

    while (this_unit_offset < fr.buffer.len) {
        fr.seek = @intCast(this_unit_offset);

        const unit_header = try readUnitHeader(&fr, endian);
        if (unit_header.unit_length == 0) return;
        const next_offset = unit_header.header_length + unit_header.unit_length;

        const version = try fr.takeInt(u16, endian);
        if (version < 2 or version > 5) return bad();

        var address_size: u8 = undefined;
        var debug_abbrev_offset: u64 = undefined;
        if (version >= 5) {
            const unit_type = try fr.takeByte();
            if (unit_type != UT.compile) return bad();
            address_size = try fr.takeByte();
            debug_abbrev_offset = try readFormatSizedInt(&fr, unit_header.format, endian);
        } else {
            debug_abbrev_offset = try readFormatSizedInt(&fr, unit_header.format, endian);
            address_size = try fr.takeByte();
        }

        const abbrev_table = try di.getAbbrevTable(gpa, debug_abbrev_offset);

        var max_attrs: usize = 0;
        for (abbrev_table.abbrevs) |abbrev| {
            max_attrs = @max(max_attrs, abbrev.attrs.len);
        }
        try attrs_buf.resize(max_attrs);

        var compile_unit_die = (try parseDie(
            &fr,
            attrs_buf.items,
            abbrev_table,
            unit_header.format,
            endian,
            address_size,
        )) orelse return bad();

        if (compile_unit_die.tag_id != DW.TAG.compile_unit) return bad();

        compile_unit_die.attrs = try gpa.dupe(Die.Attr, compile_unit_die.attrs);

        var compile_unit: CompileUnit = .{
            .version = version,
            .format = unit_header.format,
            .addr_size_bytes = address_size,
            .pc_range = null,
            .die = compile_unit_die,
            .str_offsets_base = if (compile_unit_die.getAttr(AT.str_offsets_base)) |fv| try fv.getUInt(usize) else 0,
            .addr_base = if (compile_unit_die.getAttr(AT.addr_base)) |fv| try fv.getUInt(usize) else 0,
            .rnglists_base = if (compile_unit_die.getAttr(AT.rnglists_base)) |fv| try fv.getUInt(usize) else 0,
            .loclists_base = if (compile_unit_die.getAttr(AT.loclists_base)) |fv| try fv.getUInt(usize) else 0,
            .frame_base = compile_unit_die.getAttr(AT.frame_base),
            .src_loc_cache = null,
        };

        compile_unit.pc_range = x: {
            if (compile_unit_die.getAttrAddr(di, endian, AT.low_pc, &compile_unit)) |low_pc| {
                if (compile_unit_die.getAttr(AT.high_pc)) |high_pc_value| {
                    const pc_end = switch (high_pc_value.*) {
                        .addr => |value| value,
                        .udata => |offset| low_pc + offset,
                        else => return bad(),
                    };
                    break :x PcRange{
                        .start = low_pc,
                        .end = pc_end,
                    };
                } else {
                    break :x null;
                }
            } else |err| {
                if (err != error.MissingDebugInfo) return err;
                break :x null;
            }
        };

        try di.compile_unit_list.append(gpa, compile_unit);

        this_unit_offset += next_offset;
    }
}

pub fn populateRanges(d: *Dwarf, gpa: Allocator, endian: Endian) ScanError!void {
    assert(d.ranges.items.len == 0);

    for (d.compile_unit_list.items, 0..) |*cu, cu_index| {
        if (cu.pc_range) |range| {
            try d.ranges.append(gpa, .{
                .start = range.start,
                .end = range.end,
                .compile_unit_index = cu_index,
            });
            continue;
        }
        const ranges_value = cu.die.getAttr(AT.ranges) orelse continue;
        var iter = DebugRangeIterator.init(ranges_value, d, endian, cu) catch continue;
        while (try iter.next()) |range| {
            // Not sure why LLVM thinks it's OK to emit these...
            if (range.start == range.end) continue;

            try d.ranges.append(gpa, .{
                .start = range.start,
                .end = range.end,
                .compile_unit_index = cu_index,
            });
        }
    }

    std.mem.sortUnstable(Range, d.ranges.items, {}, struct {
        pub fn lessThan(ctx: void, a: Range, b: Range) bool {
            _ = ctx;
            return a.start < b.start;
        }
    }.lessThan);
}

const DebugRangeIterator = struct {
    base_address: u64,
    section_type: Section.Id,
    di: *const Dwarf,
    endian: Endian,
    compile_unit: *const CompileUnit,
    fr: Reader,

    pub fn init(ranges_value: *const FormValue, di: *const Dwarf, endian: Endian, compile_unit: *const CompileUnit) !@This() {
        const section_type = if (compile_unit.version >= 5) Section.Id.debug_rnglists else Section.Id.debug_ranges;
        const debug_ranges = di.section(section_type) orelse return error.MissingDebugInfo;

        const ranges_offset = switch (ranges_value.*) {
            .sec_offset, .udata => |off| off,
            .rnglistx => |idx| off: {
                switch (compile_unit.format) {
                    .@"32" => {
                        const offset_loc = compile_unit.rnglists_base + 4 * idx;
                        if (offset_loc + 4 > debug_ranges.len) return bad();
                        const offset = mem.readInt(u32, debug_ranges[@intCast(offset_loc)..][0..4], endian);
                        break :off compile_unit.rnglists_base + offset;
                    },
                    .@"64" => {
                        const offset_loc = compile_unit.rnglists_base + 8 * idx;
                        if (offset_loc + 8 > debug_ranges.len) return bad();
                        const offset = mem.readInt(u64, debug_ranges[@intCast(offset_loc)..][0..8], endian);
                        break :off compile_unit.rnglists_base + offset;
                    },
                }
            },
            else => return bad(),
        };

        // All the addresses in the list are relative to the value
        // specified by DW_AT.low_pc or to some other value encoded
        // in the list itself.
        // If no starting value is specified use zero.
        const base_address = compile_unit.die.getAttrAddr(di, endian, AT.low_pc, compile_unit) catch |err| switch (err) {
            error.MissingDebugInfo => 0,
            else => return err,
        };

        var fr: Reader = .fixed(debug_ranges);
        fr.seek = cast(usize, ranges_offset) orelse return bad();

        return .{
            .base_address = base_address,
            .section_type = section_type,
            .di = di,
            .endian = endian,
            .compile_unit = compile_unit,
            .fr = fr,
        };
    }

    // Returns the next range in the list, or null if the end was reached.
    pub fn next(self: *@This()) !?PcRange {
        const endian = self.endian;
        const addr_size_bytes = self.compile_unit.addr_size_bytes;
        switch (self.section_type) {
            .debug_rnglists => {
                const kind = try self.fr.takeByte();
                switch (kind) {
                    RLE.end_of_list => return null,
                    RLE.base_addressx => {
                        const index = try self.fr.takeLeb128(u64);
                        self.base_address = try self.di.readDebugAddr(endian, self.compile_unit, index);
                        return try self.next();
                    },
                    RLE.startx_endx => {
                        const start_index = try self.fr.takeLeb128(u64);
                        const start_addr = try self.di.readDebugAddr(endian, self.compile_unit, start_index);

                        const end_index = try self.fr.takeLeb128(u64);
                        const end_addr = try self.di.readDebugAddr(endian, self.compile_unit, end_index);

                        return .{
                            .start = start_addr,
                            .end = end_addr,
                        };
                    },
                    RLE.startx_length => {
                        const start_index = try self.fr.takeLeb128(u64);
                        const start_addr = try self.di.readDebugAddr(endian, self.compile_unit, start_index);

                        const len = try self.fr.takeLeb128(u64);
                        const end_addr = start_addr + len;

                        return .{
                            .start = start_addr,
                            .end = end_addr,
                        };
                    },
                    RLE.offset_pair => {
                        const start_addr = try self.fr.takeLeb128(u64);
                        const end_addr = try self.fr.takeLeb128(u64);

                        // This is the only kind that uses the base address
                        return .{
                            .start = self.base_address + start_addr,
                            .end = self.base_address + end_addr,
                        };
                    },
                    RLE.base_address => {
                        self.base_address = try readAddress(&self.fr, endian, addr_size_bytes);
                        return try self.next();
                    },
                    RLE.start_end => {
                        const start_addr = try readAddress(&self.fr, endian, addr_size_bytes);
                        const end_addr = try readAddress(&self.fr, endian, addr_size_bytes);

                        return .{
                            .start = start_addr,
                            .end = end_addr,
                        };
                    },
                    RLE.start_length => {
                        const start_addr = try readAddress(&self.fr, endian, addr_size_bytes);
                        const len = try self.fr.takeLeb128(u64);
                        const end_addr = start_addr + len;

                        return .{
                            .start = start_addr,
                            .end = end_addr,
                        };
                    },
                    else => return bad(),
                }
            },
            .debug_ranges => {
                const start_addr = try readAddress(&self.fr, endian, addr_size_bytes);
                const end_addr = try readAddress(&self.fr, endian, addr_size_bytes);
                if (start_addr == 0 and end_addr == 0) return null;

                // The entry with start_addr = max_representable_address selects a new value for the base address
                const max_representable_address = ~@as(u64, 0) >> @intCast(64 - addr_size_bytes);
                if (start_addr == max_representable_address) {
                    self.base_address = end_addr;
                    return try self.next();
                }

                return .{
                    .start = self.base_address + start_addr,
                    .end = self.base_address + end_addr,
                };
            },
            else => unreachable,
        }
    }
};

/// TODO: change this to binary searching the sorted compile unit list
pub fn findCompileUnit(di: *const Dwarf, endian: Endian, target_address: u64) !*CompileUnit {
    for (di.compile_unit_list.items) |*compile_unit| {
        if (compile_unit.pc_range) |range| {
            if (target_address >= range.start and target_address < range.end) return compile_unit;
        }

        const ranges_value = compile_unit.die.getAttr(AT.ranges) orelse continue;
        var iter = DebugRangeIterator.init(ranges_value, di, endian, compile_unit) catch continue;
        while (try iter.next()) |range| {
            if (target_address >= range.start and target_address < range.end) return compile_unit;
        }
    }

    return missing();
}

/// Gets an already existing AbbrevTable given the abbrev_offset, or if not found,
/// seeks in the stream and parses it.
fn getAbbrevTable(di: *Dwarf, gpa: Allocator, abbrev_offset: u64) !*const Abbrev.Table {
    for (di.abbrev_table_list.items) |*table| {
        if (table.offset == abbrev_offset) {
            return table;
        }
    }
    try di.abbrev_table_list.append(
        gpa,
        try di.parseAbbrevTable(gpa, abbrev_offset),
    );
    return &di.abbrev_table_list.items[di.abbrev_table_list.items.len - 1];
}

fn parseAbbrevTable(di: *Dwarf, gpa: Allocator, offset: u64) !Abbrev.Table {
    var fr: Reader = .fixed(di.section(.debug_abbrev).?);
    fr.seek = cast(usize, offset) orelse return bad();

    var abbrevs = std.array_list.Managed(Abbrev).init(gpa);
    defer {
        for (abbrevs.items) |*abbrev| {
            abbrev.deinit(gpa);
        }
        abbrevs.deinit();
    }

    var attrs = std.array_list.Managed(Abbrev.Attr).init(gpa);
    defer attrs.deinit();

    while (true) {
        const code = try fr.takeLeb128(u64);
        if (code == 0) break;
        const tag_id = try fr.takeLeb128(u64);
        const has_children = (try fr.takeByte()) == DW.CHILDREN.yes;

        while (true) {
            const attr_id = try fr.takeLeb128(u64);
            const form_id = try fr.takeLeb128(u64);
            if (attr_id == 0 and form_id == 0) break;
            try attrs.append(.{
                .id = attr_id,
                .form_id = form_id,
                .payload = switch (form_id) {
                    FORM.implicit_const => try fr.takeLeb128(i64),
                    else => undefined,
                },
            });
        }

        try abbrevs.append(.{
            .code = code,
            .tag_id = tag_id,
            .has_children = has_children,
            .attrs = try attrs.toOwnedSlice(),
        });
    }

    return .{
        .offset = offset,
        .abbrevs = try abbrevs.toOwnedSlice(),
    };
}

fn parseDie(
    fr: *Reader,
    attrs_buf: []Die.Attr,
    abbrev_table: *const Abbrev.Table,
    format: Format,
    endian: Endian,
    addr_size_bytes: u8,
) ScanError!?Die {
    const abbrev_code = try fr.takeLeb128(u64);
    if (abbrev_code == 0) return null;
    const table_entry = abbrev_table.get(abbrev_code) orelse return bad();

    const attrs = attrs_buf[0..table_entry.attrs.len];
    for (attrs, table_entry.attrs) |*result_attr, attr| result_attr.* = .{
        .id = attr.id,
        .value = try parseFormValue(fr, attr.form_id, format, endian, addr_size_bytes, attr.payload),
    };
    return .{
        .tag_id = table_entry.tag_id,
        .has_children = table_entry.has_children,
        .attrs = attrs,
    };
}

/// Ensures that addresses in the returned LineTable are monotonically increasing.
fn runLineNumberProgram(d: *Dwarf, gpa: Allocator, endian: Endian, compile_unit: *const CompileUnit) !CompileUnit.SrcLocCache {
    const compile_unit_cwd = try compile_unit.die.getAttrString(d, endian, AT.comp_dir, d.section(.debug_line_str), compile_unit);
    const line_info_offset = try compile_unit.die.getAttrSecOffset(AT.stmt_list);

    var fr: Reader = .fixed(d.section(.debug_line).?);
    fr.seek = @intCast(line_info_offset);

    const unit_header = try readUnitHeader(&fr, endian);
    if (unit_header.unit_length == 0) return missing();

    const next_offset = unit_header.header_length + unit_header.unit_length;

    const version = try fr.takeInt(u16, endian);
    if (version < 2) return bad();

    const addr_size_bytes: u8, const seg_size: u8 = if (version >= 5) .{
        try fr.takeByte(),
        try fr.takeByte(),
    } else .{
        compile_unit.addr_size_bytes,
        0,
    };
    if (seg_size != 0) return bad(); // unsupported

    const prologue_length = try readFormatSizedInt(&fr, unit_header.format, endian);
    const prog_start_offset = fr.seek + prologue_length;

    const minimum_instruction_length = try fr.takeByte();
    if (minimum_instruction_length == 0) return bad();

    if (version >= 4) {
        const maximum_operations_per_instruction = try fr.takeByte();
        _ = maximum_operations_per_instruction;
    }

    const default_is_stmt = (try fr.takeByte()) != 0;
    const line_base = try fr.takeByteSigned();

    const line_range = try fr.takeByte();
    if (line_range == 0) return bad();

    const opcode_base = try fr.takeByte();

    const standard_opcode_lengths = try fr.take(opcode_base - 1);

    var directories: ArrayList(FileEntry) = .empty;
    defer directories.deinit(gpa);
    var file_entries: ArrayList(FileEntry) = .empty;
    defer file_entries.deinit(gpa);

    if (version < 5) {
        try directories.append(gpa, .{ .path = compile_unit_cwd });

        while (true) {
            const dir = try fr.takeSentinel(0);
            if (dir.len == 0) break;
            try directories.append(gpa, .{ .path = dir });
        }

        while (true) {
            const file_name = try fr.takeSentinel(0);
            if (file_name.len == 0) break;
            const dir_index = try fr.takeLeb128(u32);
            const mtime = try fr.takeLeb128(u64);
            const size = try fr.takeLeb128(u64);
            try file_entries.append(gpa, .{
                .path = file_name,
                .dir_index = dir_index,
                .mtime = mtime,
                .size = size,
            });
        }
    } else {
        const FileEntFmt = struct {
            content_type_code: u16,
            form_code: u16,
        };
        {
            var dir_ent_fmt_buf: [10]FileEntFmt = undefined;
            const directory_entry_format_count = try fr.takeByte();
            if (directory_entry_format_count > dir_ent_fmt_buf.len) return bad();
            for (dir_ent_fmt_buf[0..directory_entry_format_count]) |*ent_fmt| {
                ent_fmt.* = .{
                    .content_type_code = try fr.takeLeb128(u8),
                    .form_code = try fr.takeLeb128(u16),
                };
            }

            const directories_count = try fr.takeLeb128(usize);

            for (try directories.addManyAsSlice(gpa, directories_count)) |*e| {
                e.* = .{ .path = &.{} };
                for (dir_ent_fmt_buf[0..directory_entry_format_count]) |ent_fmt| {
                    const form_value = try parseFormValue(&fr, ent_fmt.form_code, unit_header.format, endian, addr_size_bytes, null);
                    switch (ent_fmt.content_type_code) {
                        DW.LNCT.path => e.path = try form_value.getString(d.*),
                        DW.LNCT.directory_index => e.dir_index = try form_value.getUInt(u32),
                        DW.LNCT.timestamp => e.mtime = try form_value.getUInt(u64),
                        DW.LNCT.size => e.size = try form_value.getUInt(u64),
                        DW.LNCT.MD5 => e.md5 = switch (form_value) {
                            .data16 => |data16| data16.*,
                            else => return bad(),
                        },
                        else => continue,
                    }
                }
            }
        }

        var file_ent_fmt_buf: [10]FileEntFmt = undefined;
        const file_name_entry_format_count = try fr.takeByte();
        if (file_name_entry_format_count > file_ent_fmt_buf.len) return bad();
        for (file_ent_fmt_buf[0..file_name_entry_format_count]) |*ent_fmt| {
            ent_fmt.* = .{
                .content_type_code = try fr.takeLeb128(u16),
                .form_code = try fr.takeLeb128(u16),
            };
        }

        const file_names_count = try fr.takeLeb128(usize);
        try file_entries.ensureUnusedCapacity(gpa, file_names_count);

        for (try file_entries.addManyAsSlice(gpa, file_names_count)) |*e| {
            e.* = .{ .path = &.{} };
            for (file_ent_fmt_buf[0..file_name_entry_format_count]) |ent_fmt| {
                const form_value = try parseFormValue(&fr, ent_fmt.form_code, unit_header.format, endian, addr_size_bytes, null);
                switch (ent_fmt.content_type_code) {
                    DW.LNCT.path => e.path = try form_value.getString(d.*),
                    DW.LNCT.directory_index => e.dir_index = try form_value.getUInt(u32),
                    DW.LNCT.timestamp => e.mtime = try form_value.getUInt(u64),
                    DW.LNCT.size => e.size = try form_value.getUInt(u64),
                    DW.LNCT.MD5 => e.md5 = switch (form_value) {
                        .data16 => |data16| data16.*,
                        else => return bad(),
                    },
                    else => continue,
                }
            }
        }
    }

    var prog = LineNumberProgram.init(default_is_stmt, version);
    var line_table: CompileUnit.SrcLocCache.LineTable = .{};
    errdefer line_table.deinit(gpa);

    fr.seek = @intCast(prog_start_offset);

    const next_unit_pos = line_info_offset + next_offset;

    while (fr.seek < next_unit_pos) {
        const opcode = try fr.takeByte();

        if (opcode == DW.LNS.extended_op) {
            const op_size = try fr.takeLeb128(u64);
            if (op_size < 1) return bad();
            const sub_op = try fr.takeByte();
            switch (sub_op) {
                DW.LNE.end_sequence => {
                    // The row being added here is an "end" address, meaning
                    // that it does not map to the source location here -
                    // rather it marks the previous address as the last address
                    // that maps to this source location.

                    // In this implementation we don't mark end of addresses.
                    // This is a performance optimization based on the fact
                    // that we don't need to know if an address is missing
                    // source location info; we are only interested in being
                    // able to look up source location info for addresses that
                    // are known to have debug info.
                    //if (debug_debug_mode) assert(!line_table.contains(prog.address));
                    //try line_table.put(gpa, prog.address, CompileUnit.SrcLocCache.LineEntry.invalid);
                    prog.reset();
                },
                DW.LNE.set_address => {
                    prog.address = try readAddress(&fr, endian, addr_size_bytes);
                },
                DW.LNE.define_file => {
                    const path = try fr.takeSentinel(0);
                    const dir_index = try fr.takeLeb128(u32);
                    const mtime = try fr.takeLeb128(u64);
                    const size = try fr.takeLeb128(u64);
                    try file_entries.append(gpa, .{
                        .path = path,
                        .dir_index = dir_index,
                        .mtime = mtime,
                        .size = size,
                    });
                },
                else => try fr.discardAll64(op_size - 1),
            }
        } else if (opcode >= opcode_base) {
            // special opcodes
            const adjusted_opcode = opcode - opcode_base;
            const inc_addr = minimum_instruction_length * (adjusted_opcode / line_range);
            const inc_line = @as(i32, line_base) + @as(i32, adjusted_opcode % line_range);
            prog.line += inc_line;
            prog.address += inc_addr;
            try prog.addRow(gpa, &line_table);
            prog.basic_block = false;
        } else {
            switch (opcode) {
                DW.LNS.copy => {
                    try prog.addRow(gpa, &line_table);
                    prog.basic_block = false;
                },
                DW.LNS.advance_pc => {
                    const arg = try fr.takeLeb128(u64);
                    prog.address += arg * minimum_instruction_length;
                },
                DW.LNS.advance_line => {
                    const arg = try fr.takeLeb128(i64);
                    prog.line += arg;
                },
                DW.LNS.set_file => {
                    const arg = try fr.takeLeb128(usize);
                    prog.file = arg;
                },
                DW.LNS.set_column => {
                    const arg = try fr.takeLeb128(u64);
                    prog.column = arg;
                },
                DW.LNS.negate_stmt => {
                    prog.is_stmt = !prog.is_stmt;
                },
                DW.LNS.set_basic_block => {
                    prog.basic_block = true;
                },
                DW.LNS.const_add_pc => {
                    const inc_addr = minimum_instruction_length * ((255 - opcode_base) / line_range);
                    prog.address += inc_addr;
                },
                DW.LNS.fixed_advance_pc => {
                    const arg = try fr.takeInt(u16, endian);
                    prog.address += arg;
                },
                DW.LNS.set_prologue_end => {},
                else => {
                    if (opcode - 1 >= standard_opcode_lengths.len) return bad();
                    try fr.discardAll(standard_opcode_lengths[opcode - 1]);
                },
            }
        }
    }

    // Dwarf standard v5, 6.2.5 says
    // > Within a sequence, addresses and operation pointers may only increase.
    // However, this is empirically not the case in reality, so we sort here.
    line_table.sortUnstable(struct {
        keys: []const u64,

        pub fn lessThan(ctx: @This(), a_index: usize, b_index: usize) bool {
            return ctx.keys[a_index] < ctx.keys[b_index];
        }
    }{ .keys = line_table.keys() });

    return .{
        .line_table = line_table,
        .directories = try directories.toOwnedSlice(gpa),
        .files = try file_entries.toOwnedSlice(gpa),
        .version = version,
    };
}

pub fn populateSrcLocCache(d: *Dwarf, gpa: Allocator, endian: Endian, cu: *CompileUnit) ScanError!void {
    if (cu.src_loc_cache != null) return;
    cu.src_loc_cache = try d.runLineNumberProgram(gpa, endian, cu);
}

pub fn getLineNumberInfo(
    d: *Dwarf,
    gpa: Allocator,
    endian: Endian,
    compile_unit: *CompileUnit,
    target_address: u64,
) !std.debug.SourceLocation {
    try d.populateSrcLocCache(gpa, endian, compile_unit);
    const slc = &compile_unit.src_loc_cache.?;
    const entry = try slc.findSource(target_address);
    const file_index = entry.file - @intFromBool(slc.version < 5);
    if (file_index >= slc.files.len) return bad();
    const file_entry = &slc.files[file_index];
    if (file_entry.dir_index >= slc.directories.len) return bad();
    const dir_name = slc.directories[file_entry.dir_index].path;
    const file_name = try std.fs.path.join(gpa, &.{ dir_name, file_entry.path });
    return .{
        .line = entry.line,
        .column = entry.column,
        .file_name = file_name,
    };
}

fn getString(di: Dwarf, offset: u64) ![:0]const u8 {
    return getStringGeneric(di.section(.debug_str), offset);
}

fn getLineString(di: Dwarf, offset: u64) ![:0]const u8 {
    return getStringGeneric(di.section(.debug_line_str), offset);
}

fn readDebugAddr(di: Dwarf, endian: Endian, compile_unit: *const CompileUnit, index: u64) !u64 {
    const debug_addr = di.section(.debug_addr) orelse return bad();

    // addr_base points to the first item after the header, however we
    // need to read the header to know the size of each item. Empirically,
    // it may disagree with is_64 on the compile unit.
    // The header is 8 or 12 bytes depending on is_64.
    if (compile_unit.addr_base < 8) return bad();

    const version = mem.readInt(u16, debug_addr[compile_unit.addr_base - 4 ..][0..2], endian);
    if (version != 5) return bad();

    const addr_size = debug_addr[compile_unit.addr_base - 2];
    const seg_size = debug_addr[compile_unit.addr_base - 1];

    const byte_offset = compile_unit.addr_base + (addr_size + seg_size) * index;
    if (byte_offset + addr_size > debug_addr.len) return bad();
    return switch (addr_size) {
        1 => debug_addr[@intCast(byte_offset)],
        2 => mem.readInt(u16, debug_addr[@intCast(byte_offset)..][0..2], endian),
        4 => mem.readInt(u32, debug_addr[@intCast(byte_offset)..][0..4], endian),
        8 => mem.readInt(u64, debug_addr[@intCast(byte_offset)..][0..8], endian),
        else => bad(),
    };
}

fn parseFormValue(
    r: *Reader,
    form_id: u64,
    format: Format,
    endian: Endian,
    addr_size_bytes: u8,
    implicit_const: ?i64,
) ScanError!FormValue {
    return switch (form_id) {
        // DWARF5.pdf page 213: the size of this value is encoded in the
        // compilation unit header as address size.
        FORM.addr => .{ .addr = try readAddress(r, endian, addr_size_bytes) },
        FORM.addrx1 => .{ .addrx = try r.takeByte() },
        FORM.addrx2 => .{ .addrx = try r.takeInt(u16, endian) },
        FORM.addrx3 => .{ .addrx = try r.takeInt(u24, endian) },
        FORM.addrx4 => .{ .addrx = try r.takeInt(u32, endian) },
        FORM.addrx => .{ .addrx = try r.takeLeb128(u64) },

        FORM.block1 => .{ .block = try r.take(try r.takeByte()) },
        FORM.block2 => .{ .block = try r.take(try r.takeInt(u16, endian)) },
        FORM.block4 => .{ .block = try r.take(try r.takeInt(u32, endian)) },
        FORM.block => .{ .block = try r.take(try r.takeLeb128(usize)) },

        FORM.data1 => .{ .udata = try r.takeByte() },
        FORM.data2 => .{ .udata = try r.takeInt(u16, endian) },
        FORM.data4 => .{ .udata = try r.takeInt(u32, endian) },
        FORM.data8 => .{ .udata = try r.takeInt(u64, endian) },
        FORM.data16 => .{ .data16 = try r.takeArray(16) },
        FORM.udata => .{ .udata = try r.takeLeb128(u64) },
        FORM.sdata => .{ .sdata = try r.takeLeb128(i64) },
        FORM.exprloc => .{ .exprloc = try r.take(try r.takeLeb128(usize)) },
        FORM.flag => .{ .flag = (try r.takeByte()) != 0 },
        FORM.flag_present => .{ .flag = true },
        FORM.sec_offset => .{ .sec_offset = try readFormatSizedInt(r, format, endian) },

        FORM.ref1 => .{ .ref = try r.takeByte() },
        FORM.ref2 => .{ .ref = try r.takeInt(u16, endian) },
        FORM.ref4 => .{ .ref = try r.takeInt(u32, endian) },
        FORM.ref8 => .{ .ref = try r.takeInt(u64, endian) },
        FORM.ref_udata => .{ .ref = try r.takeLeb128(u64) },

        FORM.ref_addr => .{ .ref_addr = try readFormatSizedInt(r, format, endian) },
        FORM.ref_sig8 => .{ .ref = try r.takeInt(u64, endian) },

        FORM.string => .{ .string = try r.takeSentinel(0) },
        FORM.strp => .{ .strp = try readFormatSizedInt(r, format, endian) },
        FORM.strx1 => .{ .strx = try r.takeByte() },
        FORM.strx2 => .{ .strx = try r.takeInt(u16, endian) },
        FORM.strx3 => .{ .strx = try r.takeInt(u24, endian) },
        FORM.strx4 => .{ .strx = try r.takeInt(u32, endian) },
        FORM.strx => .{ .strx = try r.takeLeb128(usize) },
        FORM.line_strp => .{ .line_strp = try readFormatSizedInt(r, format, endian) },
        FORM.indirect => parseFormValue(r, try r.takeLeb128(u64), format, endian, addr_size_bytes, implicit_const),
        FORM.implicit_const => .{ .sdata = implicit_const orelse return bad() },
        FORM.loclistx => .{ .loclistx = try r.takeLeb128(u64) },
        FORM.rnglistx => .{ .rnglistx = try r.takeLeb128(u64) },
        else => {
            //debug.print("unrecognized form id: {x}\n", .{form_id});
            return bad();
        },
    };
}

const FileEntry = struct {
    path: []const u8,
    dir_index: u32 = 0,
    mtime: u64 = 0,
    size: u64 = 0,
    md5: [16]u8 = [1]u8{0} ** 16,
};

const LineNumberProgram = struct {
    address: u64,
    file: usize,
    line: i64,
    column: u64,
    version: u16,
    is_stmt: bool,
    basic_block: bool,

    default_is_stmt: bool,

    // Reset the state machine following the DWARF specification
    pub fn reset(self: *LineNumberProgram) void {
        self.address = 0;
        self.file = 1;
        self.line = 1;
        self.column = 0;
        self.is_stmt = self.default_is_stmt;
        self.basic_block = false;
    }

    pub fn init(is_stmt: bool, version: u16) LineNumberProgram {
        return .{
            .address = 0,
            .file = 1,
            .line = 1,
            .column = 0,
            .version = version,
            .is_stmt = is_stmt,
            .basic_block = false,
            .default_is_stmt = is_stmt,
        };
    }

    pub fn addRow(prog: *LineNumberProgram, gpa: Allocator, table: *CompileUnit.SrcLocCache.LineTable) !void {
        if (prog.line == 0) {
            //if (debug_debug_mode) @panic("garbage line data");
            return;
        }
        if (debug_debug_mode) assert(!table.contains(prog.address));
        try table.put(gpa, prog.address, .{
            .line = cast(u32, prog.line) orelse maxInt(u32),
            .column = cast(u32, prog.column) orelse maxInt(u32),
            .file = cast(u32, prog.file) orelse return bad(),
        });
    }
};

const UnitHeader = struct {
    format: Format,
    header_length: u4,
    unit_length: u64,
};

pub fn readUnitHeader(r: *Reader, endian: Endian) ScanError!UnitHeader {
    return switch (try r.takeInt(u32, endian)) {
        0...0xfffffff0 - 1 => |unit_length| .{
            .format = .@"32",
            .header_length = 4,
            .unit_length = unit_length,
        },
        0xfffffff0...0xffffffff - 1 => bad(),
        0xffffffff => .{
            .format = .@"64",
            .header_length = 12,
            .unit_length = try r.takeInt(u64, endian),
        },
    };
}

/// Returns the DWARF register number for an x86_64 register number found in compact unwind info
pub fn compactUnwindToDwarfRegNumber(unwind_reg_number: u3) !u16 {
    return switch (unwind_reg_number) {
        1 => 3, // RBX
        2 => 12, // R12
        3 => 13, // R13
        4 => 14, // R14
        5 => 15, // R15
        6 => 6, // RBP
        else => error.InvalidRegister,
    };
}

/// Returns `null` for CPU architectures without an instruction pointer register.
pub fn ipRegNum(arch: std.Target.Cpu.Arch) ?u16 {
    return switch (arch) {
        .aarch64, .aarch64_be => 32,
        .arc => 160,
        .arm, .armeb, .thumb, .thumbeb => 15,
        .csky => 64,
        .hexagon => 76,
        .lanai => 2,
        .loongarch32, .loongarch64 => 64,
        .m68k => 26,
        .mips, .mipsel, .mips64, .mips64el => 66,
        .or1k => 35,
        .powerpc, .powerpcle, .powerpc64, .powerpc64le => 67,
        .riscv32, .riscv64 => 65,
        .s390x => 65,
        .sparc, .sparc64 => 32,
        .ve => 144,
        .x86 => 8,
        .x86_64 => 16,
        else => null,
    };
}

pub fn fpRegNum(arch: std.Target.Cpu.Arch) u16 {
    return switch (arch) {
        .aarch64, .aarch64_be => 29,
        .arc => 27,
        .arm, .armeb, .thumb, .thumbeb => 11,
        .csky => 14,
        .hexagon => 30,
        .lanai => 5,
        .loongarch32, .loongarch64 => 22,
        .m68k => 14,
        .mips, .mipsel, .mips64, .mips64el => 30,
        .or1k => 2,
        .powerpc, .powerpcle, .powerpc64, .powerpc64le => 1,
        .riscv32, .riscv64 => 8,
        .s390x => 11,
        .sparc, .sparc64 => 30,
        .ve => 9,
        .x86 => 5,
        .x86_64 => 6,
        else => unreachable,
    };
}

pub fn spRegNum(arch: std.Target.Cpu.Arch) u16 {
    return switch (arch) {
        .aarch64, .aarch64_be => 31,
        .arc => 28,
        .arm, .armeb, .thumb, .thumbeb => 13,
        .csky => 14,
        .hexagon => 29,
        .lanai => 4,
        .loongarch32, .loongarch64 => 3,
        .m68k => 15,
        .mips, .mipsel, .mips64, .mips64el => 29,
        .or1k => 1,
        .powerpc, .powerpcle, .powerpc64, .powerpc64le => 1,
        .riscv32, .riscv64 => 2,
        .s390x => 15,
        .sparc, .sparc64 => 14,
        .ve => 11,
        .x86 => 4,
        .x86_64 => 7,
        else => unreachable,
    };
}

/// Tells whether unwinding for this target is supported by the Dwarf standard.
///
/// See also `std.debug.SelfInfo.can_unwind` which tells whether the Zig standard
/// library has a working implementation of unwinding for the current target.
pub fn supportsUnwinding(target: *const std.Target) bool {
    return switch (target.cpu.arch) {
        .amdgcn,
        .nvptx,
        .nvptx64,
        .spirv32,
        .spirv64,
        => false,

        // Conservative guess. Feel free to update this logic with any targets
        // that are known to not support Dwarf unwinding.
        else => true,
    };
}

/// This function is to make it handy to comment out the return and make it
/// into a crash when working on this file.
pub fn bad() error{InvalidDebugInfo} {
    invalidDebugInfoDetected();
    return error.InvalidDebugInfo;
}

pub fn invalidDebugInfoDetected() void {
    if (debug_debug_mode) @panic("bad dwarf");
}

pub fn missing() error{MissingDebugInfo} {
    if (debug_debug_mode) @panic("missing dwarf");
    return error.MissingDebugInfo;
}

fn getStringGeneric(opt_str: ?[]const u8, offset: u64) ![:0]const u8 {
    const str = opt_str orelse return bad();
    if (offset > str.len) return bad();
    const casted_offset = cast(usize, offset) orelse return bad();
    // Valid strings always have a terminating zero byte
    const last = std.mem.indexOfScalarPos(u8, str, casted_offset, 0) orelse return bad();
    return str[casted_offset..last :0];
}

pub fn getSymbol(di: *Dwarf, gpa: Allocator, endian: Endian, address: u64) !std.debug.Symbol {
    const compile_unit = di.findCompileUnit(endian, address) catch |err| switch (err) {
        error.MissingDebugInfo, error.InvalidDebugInfo => return .unknown,
        else => return err,
    };
    return .{
        .name = di.getSymbolName(address),
        .compile_unit_name = compile_unit.die.getAttrString(di, endian, std.dwarf.AT.name, di.section(.debug_str), compile_unit) catch |err| switch (err) {
            error.MissingDebugInfo, error.InvalidDebugInfo => null,
        },
        .source_location = di.getLineNumberInfo(gpa, endian, compile_unit, address) catch |err| switch (err) {
            error.MissingDebugInfo, error.InvalidDebugInfo => null,
            else => return err,
        },
    };
}

/// DWARF5 7.4: "In the 32-bit DWARF format, all values that represent lengths of DWARF sections and
/// offsets relative to the beginning of DWARF sections are represented using four bytes. In the
/// 64-bit DWARF format, all values that represent lengths of DWARF sections and offsets relative to
/// the beginning of DWARF sections are represented using eight bytes".
///
/// This function is for reading such values.
fn readFormatSizedInt(r: *Reader, format: std.dwarf.Format, endian: Endian) !u64 {
    return switch (format) {
        .@"32" => try r.takeInt(u32, endian),
        .@"64" => try r.takeInt(u64, endian),
    };
}

fn readAddress(r: *Reader, endian: Endian, addr_size_bytes: u8) !u64 {
    return switch (addr_size_bytes) {
        2 => try r.takeInt(u16, endian),
        4 => try r.takeInt(u32, endian),
        8 => try r.takeInt(u64, endian),
        else => return bad(),
    };
}
