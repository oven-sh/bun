//! Contains state relevant to stack unwinding through the DWARF `.debug_frame` section, or the
//! `.eh_frame` section which is an extension of the former specified by Linux Standard Base Core.
//! Like `Dwarf`, no assumptions are made about the host's relationship to the target of the unwind
//! information -- unwind data for any target can be read by any host.
//!
//! `Unwind` specifically deals with loading the data from CIEs and FDEs in the section, and with
//! performing fast lookups of a program counter's corresponding FDE. The CFI instructions in the
//! CIEs and FDEs can be interpreted by `VirtualMachine`.
//!
//! The typical usage of `Unwind` is as follows:
//!
//! * Initialize with `initEhFrameHdr` or `initSection`, depending on the available data
//! * Call `prepare` to scan CIEs and, if necessary, construct a search table
//! * Call `lookupPc` to find the section offset of the FDE corresponding to a PC
//! * Call `getFde` to load the corresponding FDE and CIE
//! * Check that the PC does indeed fall in that range (`lookupPc` may return a false positive)
//! * Interpret the embedded CFI instructions using `VirtualMachine`
//!
//! In some cases, such as when using the "compact unwind" data in Mach-O binaries, the FDE offsets
//! may already be known. In that case, no call to `lookupPc` is necessary, which means the call to
//! `prepare` can be optimized to only scan CIEs.

pub const VirtualMachine = @import("Unwind/VirtualMachine.zig");

frame_section: struct {
    id: Section,
    /// The virtual address of the start of the section. "Virtual address" refers to the address in
    /// the binary (e.g. `sh_addr` in an ELF file); the equivalent runtime address may be relocated
    /// in position-independent binaries.
    vaddr: u64,
    /// The full contents of the section. May have imprecise bounds depending on `section`. This
    /// memory is externally managed.
    ///
    /// For `.debug_frame`, the slice length is exactly equal to the section length. This is needed
    /// to know the number of CIEs and FDEs.
    ///
    /// For `.eh_frame`, the slice length may exceed the section length, i.e. the slice may refer to
    /// more bytes than are in the second. This restriction exists because `.eh_frame_hdr` only
    /// includes the address of the loaded `.eh_frame` data, not its length. It is not a problem
    /// because unlike `.debug_frame`, the end of the CIE/FDE list is signaled through a sentinel
    /// value. If this slice does have bounds, they will still be checked, preventing crashes when
    /// reading potentially-invalid `.eh_frame` data from files.
    bytes: []const u8,
},

/// A structure allowing fast lookups of the FDE corresponding to a particular PC. We use a binary
/// search table for the lookup; essentially, a list of all FDEs ordered by PC range. `null` means
/// the lookup data is not yet populated, so `prepare` must be called before `lookupPc`.
lookup: ?union(enum) {
    /// The `.eh_frame_hdr` section contains a pre-computed search table which we can use.
    eh_frame_hdr: struct {
        /// Virtual address of the `.eh_frame_hdr` section.
        vaddr: u64,
        table: EhFrameHeader.SearchTable,
    },
    /// There is no pre-computed search table, so we have built one ourselves.
    /// Allocated into `gpa` and freed by `deinit`.
    sorted_fdes: []SortedFdeEntry,
},

/// Initially empty; populated by `prepare`.
cie_list: std.MultiArrayList(struct {
    offset: u64,
    cie: CommonInformationEntry,
}),

const SortedFdeEntry = struct {
    /// This FDE's value of `pc_begin`.
    pc_begin: u64,
    /// Offset into the section of the corresponding FDE, including the entry header.
    fde_offset: u64,
};

pub const Section = enum { debug_frame, eh_frame };

/// Initialize with unwind information from a header loaded from an `.eh_frame_hdr` section, and a
/// pointer to the contents of the `.eh_frame` section.
///
/// `.eh_frame_hdr` may embed a binary search table of FDEs. If it does, we will use that table for
/// PC lookups rather than spending time constructing our own search table.
pub fn initEhFrameHdr(header: EhFrameHeader, section_vaddr: u64, section_bytes_ptr: [*]const u8) Unwind {
    return .{
        .frame_section = .{
            .id = .eh_frame,
            .bytes = maxSlice(section_bytes_ptr),
            .vaddr = header.eh_frame_vaddr,
        },
        .lookup = if (header.search_table) |table| .{ .eh_frame_hdr = .{
            .vaddr = section_vaddr,
            .table = table,
        } } else null,
        .cie_list = .empty,
    };
}

/// Initialize with unwind information from the contents of a `.debug_frame` or `.eh_frame` section.
///
/// If the `.eh_frame_hdr` section is available, consider instead using `initEhFrameHdr`, which
/// allows the implementation to use a search table embedded in that section if it is available.
pub fn initSection(section: Section, section_vaddr: u64, section_bytes: []const u8) Unwind {
    return .{
        .frame_section = .{
            .id = section,
            .bytes = section_bytes,
            .vaddr = section_vaddr,
        },
        .lookup = null,
        .cie_list = .empty,
    };
}

pub fn deinit(unwind: *Unwind, gpa: Allocator) void {
    if (unwind.lookup) |lookup| switch (lookup) {
        .eh_frame_hdr => {},
        .sorted_fdes => |fdes| gpa.free(fdes),
    };
    for (unwind.cie_list.items(.cie)) |*cie| {
        if (cie.last_row) |*lr| {
            gpa.free(lr.cols);
        }
    }
    unwind.cie_list.deinit(gpa);
}

/// Decoded version of the `.eh_frame_hdr` section.
pub const EhFrameHeader = struct {
    /// The virtual address (i.e. as given in the binary, before relocations) of the `.eh_frame`
    /// section. This value is important when using `.eh_frame_hdr` to find debug information for
    /// the current binary, because it allows locating where the `.eh_frame` section is loaded in
    /// memory (by adding it to the ELF module's base address).
    eh_frame_vaddr: u64,
    search_table: ?SearchTable,

    pub const SearchTable = struct {
        /// The byte offset of the search table into the `.eh_frame_hdr` section.
        offset: u8,
        encoding: EH_PE,
        fde_count: usize,
        /// The actual table entries are viewed as a plain byte slice because `encoding` causes the
        /// size of entries in the table to vary.
        entries: []const u8,

        /// Returns the vaddr of the FDE for `pc`, or `null` if no matching FDE was found.
        fn findEntry(
            table: *const SearchTable,
            eh_frame_hdr_vaddr: u64,
            pc: u64,
            addr_size_bytes: u8,
            endian: Endian,
        ) !?u64 {
            const table_vaddr = eh_frame_hdr_vaddr + table.offset;
            const entry_size = try entrySize(table.encoding, addr_size_bytes);
            var left: usize = 0;
            var len: usize = table.fde_count;
            while (len > 1) {
                const mid = left + len / 2;
                var entry_reader: Reader = .fixed(table.entries[mid * entry_size ..][0..entry_size]);
                const pc_begin = try readEhPointer(&entry_reader, table.encoding, addr_size_bytes, .{
                    .pc_rel_base = table_vaddr + left * entry_size,
                    .data_rel_base = eh_frame_hdr_vaddr,
                }, endian);
                if (pc < pc_begin) {
                    len /= 2;
                } else {
                    left = mid;
                    len -= len / 2;
                }
            }
            if (len == 0) return null;
            var entry_reader: Reader = .fixed(table.entries[left * entry_size ..][0..entry_size]);
            // Skip past `pc_begin`; we're now interested in the fde offset
            _ = try readEhPointerAbs(&entry_reader, table.encoding.type, addr_size_bytes, endian);
            const fde_ptr = try readEhPointer(&entry_reader, table.encoding, addr_size_bytes, .{
                .pc_rel_base = table_vaddr + left * entry_size,
                .data_rel_base = eh_frame_hdr_vaddr,
            }, endian);
            return fde_ptr;
        }

        fn entrySize(table_enc: EH_PE, addr_size_bytes: u8) !u8 {
            return switch (table_enc.type) {
                .absptr => 2 * addr_size_bytes,
                .udata2, .sdata2 => 4,
                .udata4, .sdata4 => 8,
                .udata8, .sdata8 => 16,
                .uleb128, .sleb128 => return bad(), // this is a binary search table; all entries must be the same size
                _ => return bad(),
            };
        }
    };

    pub fn parse(
        eh_frame_hdr_vaddr: u64,
        eh_frame_hdr_bytes: []const u8,
        addr_size_bytes: u8,
        endian: Endian,
    ) !EhFrameHeader {
        var r: Reader = .fixed(eh_frame_hdr_bytes);

        const version = try r.takeByte();
        if (version != 1) return bad();

        const eh_frame_ptr_enc: EH_PE = @bitCast(try r.takeByte());
        const fde_count_enc: EH_PE = @bitCast(try r.takeByte());
        const table_enc: EH_PE = @bitCast(try r.takeByte());

        const eh_frame_ptr = try readEhPointer(&r, eh_frame_ptr_enc, addr_size_bytes, .{
            .pc_rel_base = eh_frame_hdr_vaddr + r.seek,
        }, endian);

        const table: ?SearchTable = table: {
            if (fde_count_enc == EH_PE.omit) break :table null;
            if (table_enc == EH_PE.omit) break :table null;
            const fde_count = try readEhPointer(&r, fde_count_enc, addr_size_bytes, .{
                .pc_rel_base = eh_frame_hdr_vaddr + r.seek,
            }, endian);
            const entry_size = try SearchTable.entrySize(table_enc, addr_size_bytes);
            const bytes_offset = r.seek;
            const bytes_len = cast(usize, fde_count * entry_size) orelse return error.EndOfStream;
            const bytes = try r.take(bytes_len);
            break :table .{
                .encoding = table_enc,
                .fde_count = @intCast(fde_count),
                .entries = bytes,
                .offset = @intCast(bytes_offset),
            };
        };

        return .{
            .eh_frame_vaddr = eh_frame_ptr,
            .search_table = table,
        };
    }
};

/// The shared header of an FDE/CIE, containing a length in bytes (DWARF's "initial length field")
/// and a value which differentiates CIEs from FDEs and maps FDEs to their corresponding CIEs. The
/// `.eh_frame` format also includes a third variation, here called `.terminator`, which acts as a
/// sentinel for the whole section.
///
/// `CommonInformationEntry.parse` and `FrameDescriptionEntry.parse` expect the `EntryHeader` to
/// have been parsed first: they accept data stored in the `EntryHeader`, and only read the bytes
/// following this header.
const EntryHeader = union(enum) {
    cie: struct {
        format: Format,
        /// Remaining bytes in the CIE. These are parseable by `CommonInformationEntry.parse`.
        bytes_len: u64,
    },
    fde: struct {
        /// Offset into the section of the corresponding CIE, *including* its entry header.
        cie_offset: u64,
        /// Remaining bytes in the FDE. These are parseable by `FrameDescriptionEntry.parse`.
        bytes_len: u64,
    },
    /// The `.eh_frame` format includes terminators which indicate that the last CIE/FDE has been
    /// reached. However, `.debug_frame` does not include such a terminator, so the caller must
    /// keep track of how many section bytes remain when parsing all entries in `.debug_frame`.
    terminator,

    fn read(r: *Reader, header_section_offset: u64, section: Section, endian: Endian) !EntryHeader {
        const unit_header = try Dwarf.readUnitHeader(r, endian);
        if (unit_header.unit_length == 0) return .terminator;

        // Next is a value which will disambiguate CIEs and FDEs. Annoyingly, LSB Core makes this
        // value always 4-byte, whereas DWARF makes it depend on the `dwarf.Format`.
        const cie_ptr_or_id_size: u8 = switch (section) {
            .eh_frame => 4,
            .debug_frame => switch (unit_header.format) {
                .@"32" => 4,
                .@"64" => 8,
            },
        };
        const cie_ptr_or_id = switch (cie_ptr_or_id_size) {
            4 => try r.takeInt(u32, endian),
            8 => try r.takeInt(u64, endian),
            else => unreachable,
        };
        const remaining_bytes = unit_header.unit_length - cie_ptr_or_id_size;

        // If this entry is a CIE, then `cie_ptr_or_id` will have this value, which is different
        // between the DWARF `.debug_frame` section and the LSB Core `.eh_frame` section.
        const cie_id: u64 = switch (section) {
            .eh_frame => 0,
            .debug_frame => switch (unit_header.format) {
                .@"32" => maxInt(u32),
                .@"64" => maxInt(u64),
            },
        };
        if (cie_ptr_or_id == cie_id) {
            return .{ .cie = .{
                .format = unit_header.format,
                .bytes_len = remaining_bytes,
            } };
        }

        // This is an FDE -- `cie_ptr_or_id` points to the associated CIE. Unfortunately, the format
        // of that pointer again differs between `.debug_frame` and `.eh_frame`.
        const cie_offset = switch (section) {
            .eh_frame => try std.math.sub(u64, header_section_offset + unit_header.header_length, cie_ptr_or_id),
            .debug_frame => cie_ptr_or_id,
        };
        return .{ .fde = .{
            .cie_offset = cie_offset,
            .bytes_len = remaining_bytes,
        } };
    }
};

pub const CommonInformationEntry = struct {
    version: u8,
    format: Format,

    /// In version 4, CIEs can specify the address size used in the CIE and associated FDEs.
    /// This value must be used *only* to parse associated FDEs in `FrameDescriptionEntry.parse`.
    addr_size_bytes: u8,

    /// Always 0 for versions which do not specify this (currently all versions other than 4).
    segment_selector_size: u8,

    code_alignment_factor: u32,
    data_alignment_factor: i32,
    return_address_register: u8,

    fde_pointer_enc: EH_PE,
    is_signal_frame: bool,

    augmentation_kind: AugmentationKind,

    initial_instructions: []const u8,

    last_row: ?struct {
        offset: u64,
        cfa: VirtualMachine.CfaRule,
        cols: []VirtualMachine.Column,
    },

    pub const AugmentationKind = enum { none, gcc_eh, lsb_z };

    /// This function expects to read the CIE starting with the version field.
    /// The returned struct references memory backed by `cie_bytes`.
    ///
    /// `length_offset` specifies the offset of this CIE's length field in the
    /// .eh_frame / .debug_frame section.
    fn parse(
        format: Format,
        cie_bytes: []const u8,
        section: Section,
        default_addr_size_bytes: u8,
    ) !CommonInformationEntry {
        // We only read the data through this reader.
        var r: Reader = .fixed(cie_bytes);

        const version = try r.takeByte();
        switch (section) {
            .eh_frame => if (version != 1 and version != 3) return error.UnsupportedDwarfVersion,
            .debug_frame => if (version != 4) return error.UnsupportedDwarfVersion,
        }

        const aug_str = try r.takeSentinel(0);
        const aug_kind: AugmentationKind = aug: {
            if (aug_str.len == 0) break :aug .none;
            if (aug_str[0] == 'z') break :aug .lsb_z;
            if (std.mem.eql(u8, aug_str, "eh")) break :aug .gcc_eh;
            // We can't finish parsing the CIE if we don't know what its augmentation means.
            return bad();
        };

        switch (aug_kind) {
            .none => {}, // no extra data
            .lsb_z => {}, // no extra data yet, but there is a bit later
            .gcc_eh => try r.discardAll(default_addr_size_bytes), // unsupported data
        }

        const addr_size_bytes = if (version == 4) try r.takeByte() else default_addr_size_bytes;
        const segment_selector_size: u8 = if (version == 4) try r.takeByte() else 0;
        const code_alignment_factor = try r.takeLeb128(u32);
        const data_alignment_factor = try r.takeLeb128(i32);
        const return_address_register = if (version == 1) try r.takeByte() else try r.takeLeb128(u8);

        // This is where LSB's augmentation might add some data.
        const fde_pointer_enc: EH_PE, const is_signal_frame: bool = aug: {
            const default_fde_pointer_enc: EH_PE = .{ .type = .absptr, .rel = .abs };
            if (aug_kind != .lsb_z) break :aug .{ default_fde_pointer_enc, false };
            const aug_data_len = try r.takeLeb128(u32);
            var aug_data: Reader = .fixed(try r.take(aug_data_len));
            var fde_pointer_enc: EH_PE = default_fde_pointer_enc;
            var is_signal_frame = false;
            for (aug_str[1..]) |byte| switch (byte) {
                'L' => _ = try aug_data.takeByte(), // we ignore the LSDA pointer
                'P' => {
                    const enc: EH_PE = @bitCast(try aug_data.takeByte());
                    const endian: Endian = .little; // irrelevant because we're discarding the value anyway
                    _ = try readEhPointerAbs(&aug_data, enc.type, addr_size_bytes, endian); // we ignore the personality routine; endianness is irrelevant since we're discarding
                },
                'R' => fde_pointer_enc = @bitCast(try aug_data.takeByte()),
                'S' => is_signal_frame = true,
                'B', 'G' => {},
                else => return bad(),
            };
            break :aug .{ fde_pointer_enc, is_signal_frame };
        };

        return .{
            .format = format,
            .version = version,
            .addr_size_bytes = addr_size_bytes,
            .segment_selector_size = segment_selector_size,
            .code_alignment_factor = code_alignment_factor,
            .data_alignment_factor = data_alignment_factor,
            .return_address_register = return_address_register,
            .fde_pointer_enc = fde_pointer_enc,
            .is_signal_frame = is_signal_frame,
            .augmentation_kind = aug_kind,
            .initial_instructions = r.buffered(),
            .last_row = null,
        };
    }
};

pub const FrameDescriptionEntry = struct {
    pc_begin: u64,
    pc_range: u64,
    instructions: []const u8,

    /// This function expects to read the FDE starting at the PC Begin field.
    /// The returned struct references memory backed by `fde_bytes`.
    fn parse(
        /// The virtual address of the FDE we're parsing, *excluding* its entry header (i.e. the
        /// address is after the header). If `fde_bytes` is backed by the memory of a loaded
        /// module's `.eh_frame` section, this will equal `fde_bytes.ptr`.
        fde_vaddr: u64,
        fde_bytes: []const u8,
        cie: *const CommonInformationEntry,
        endian: Endian,
    ) !FrameDescriptionEntry {
        if (cie.segment_selector_size != 0) return error.UnsupportedAddrSize;

        var r: Reader = .fixed(fde_bytes);

        const pc_begin = try readEhPointer(&r, cie.fde_pointer_enc, cie.addr_size_bytes, .{
            .pc_rel_base = fde_vaddr,
        }, endian);

        // I swear I'm not kidding when I say that PC Range is encoded with `cie.fde_pointer_enc`, but ignoring `rel`.
        const pc_range = switch (try readEhPointerAbs(&r, cie.fde_pointer_enc.type, cie.addr_size_bytes, endian)) {
            .unsigned => |x| x,
            .signed => |x| cast(u64, x) orelse return bad(),
        };

        switch (cie.augmentation_kind) {
            .none, .gcc_eh => {},
            .lsb_z => {
                // There is augmentation data, but it's irrelevant to us -- it
                // only contains the LSDA pointer, which we don't care about.
                const aug_data_len = try r.takeLeb128(usize);
                _ = try r.discardAll(aug_data_len);
            },
        }

        return .{
            .pc_begin = pc_begin,
            .pc_range = pc_range,
            .instructions = r.buffered(),
        };
    }
};

/// Builds the CIE list and FDE lookup table if they are not already built. It is required to call
/// this function at least once before calling `lookupPc` or `getFde`. If only `getFde` is needed,
/// then `need_lookup` can be set to `false` to make this function more efficient.
pub fn prepare(
    unwind: *Unwind,
    gpa: Allocator,
    addr_size_bytes: u8,
    endian: Endian,
    need_lookup: bool,
    /// The `__eh_frame` section in Mach-O binaries deviates from the standard `.eh_frame` section
    /// in one way which this function needs to be aware of.
    is_macho: bool,
) !void {
    if (unwind.cie_list.len > 0 and (!need_lookup or unwind.lookup != null)) return;
    unwind.cie_list.clearRetainingCapacity();

    if (is_macho) assert(unwind.lookup == null or unwind.lookup.? != .eh_frame_hdr);

    const section = unwind.frame_section;

    var r: Reader = .fixed(section.bytes);
    var fde_list: std.ArrayList(SortedFdeEntry) = .empty;
    defer fde_list.deinit(gpa);

    const saw_terminator = while (r.seek < r.buffer.len) {
        const entry_offset = r.seek;
        switch (try EntryHeader.read(&r, entry_offset, section.id, endian)) {
            .cie => |cie_info| {
                // We will pre-populate a list of CIEs for efficiency: this avoids work re-parsing
                // them every time we look up an FDE. It also lets us cache the result of evaluating
                // the CIE's initial CFI instructions, which is useful because in the vast majority
                // of cases those instructions will be needed to reach the PC we are unwinding to.
                const bytes_len = cast(usize, cie_info.bytes_len) orelse return error.EndOfStream;
                const idx = unwind.cie_list.len;
                try unwind.cie_list.append(gpa, .{
                    .offset = entry_offset,
                    .cie = try .parse(cie_info.format, try r.take(bytes_len), section.id, addr_size_bytes),
                });
                errdefer _ = unwind.cie_list.pop().?;
                try VirtualMachine.populateCieLastRow(gpa, &unwind.cie_list.items(.cie)[idx], addr_size_bytes, endian);
                continue;
            },
            .fde => |fde_info| {
                const bytes_len = cast(usize, fde_info.bytes_len) orelse return error.EndOfStream;
                if (!need_lookup) {
                    try r.discardAll(bytes_len);
                    continue;
                }
                const cie = unwind.findCie(fde_info.cie_offset) orelse return error.InvalidDebugInfo;
                const fde: FrameDescriptionEntry = try .parse(section.vaddr + r.seek, try r.take(bytes_len), cie, endian);
                try fde_list.append(gpa, .{
                    .pc_begin = fde.pc_begin,
                    .fde_offset = entry_offset,
                });
            },
            .terminator => break true,
        }
    } else false;
    const expect_terminator = switch (section.id) {
        .eh_frame => !is_macho, // `.eh_frame` indicates the end of the CIE/FDE list with a sentinel entry, though macOS omits this
        .debug_frame => false, // `.debug_frame` uses the section bounds and does not specify a sentinel entry
    };
    if (saw_terminator != expect_terminator) return bad();

    if (need_lookup) {
        std.mem.sortUnstable(SortedFdeEntry, fde_list.items, {}, struct {
            fn lessThan(ctx: void, a: SortedFdeEntry, b: SortedFdeEntry) bool {
                ctx;
                return a.pc_begin < b.pc_begin;
            }
        }.lessThan);

        // This temporary is necessary to avoid an RLS footgun where `lookup` ends up non-null `undefined` on OOM.
        const final_fdes = try fde_list.toOwnedSlice(gpa);
        unwind.lookup = .{ .sorted_fdes = final_fdes };
    }
}

fn findCie(unwind: *const Unwind, offset: u64) ?*const CommonInformationEntry {
    const offsets = unwind.cie_list.items(.offset);
    if (offsets.len == 0) return null;
    var start: usize = 0;
    var len: usize = offsets.len;
    while (len > 1) {
        const mid = len / 2;
        if (offset < offsets[start + mid]) {
            len = mid;
        } else {
            start += mid;
            len -= mid;
        }
    }
    if (offsets[start] != offset) return null;
    return &unwind.cie_list.items(.cie)[start];
}

/// Given a program counter value, returns the offset of the corresponding FDE, or `null` if no
/// matching FDE was found. The returned offset can be passed to `getFde` to load the data
/// associated with the FDE.
///
/// Before calling this function, `prepare` must return successfully at least once, to ensure that
/// `unwind.lookup` is populated.
///
/// The return value may be a false positive. After loading the FDE with `loadFde`, the caller must
/// validate that `pc` is indeed in its range -- if it is not, then no FDE matches `pc`.
pub fn lookupPc(unwind: *const Unwind, pc: u64, addr_size_bytes: u8, endian: Endian) !?u64 {
    const sorted_fdes: []const SortedFdeEntry = switch (unwind.lookup.?) {
        .eh_frame_hdr => |eh_frame_hdr| {
            const fde_vaddr = try eh_frame_hdr.table.findEntry(
                eh_frame_hdr.vaddr,
                pc,
                addr_size_bytes,
                endian,
            ) orelse return null;
            return std.math.sub(u64, fde_vaddr, unwind.frame_section.vaddr) catch bad(); // convert vaddr to offset
        },
        .sorted_fdes => |sorted_fdes| sorted_fdes,
    };
    if (sorted_fdes.len == 0) return null;
    var start: usize = 0;
    var len: usize = sorted_fdes.len;
    while (len > 1) {
        const half = len / 2;
        if (pc < sorted_fdes[start + half].pc_begin) {
            len = half;
        } else {
            start += half;
            len -= half;
        }
    }
    // If any FDE matches, it'll be the one at `start` (maybe false positive).
    return sorted_fdes[start].fde_offset;
}

/// Get the FDE at a given offset, as well as its associated CIE. This offset typically comes from
/// `lookupPc`. The CFI instructions within can be evaluated with `VirtualMachine`.
pub fn getFde(unwind: *const Unwind, fde_offset: u64, endian: Endian) !struct { *const CommonInformationEntry, FrameDescriptionEntry } {
    const section = unwind.frame_section;

    if (fde_offset > section.bytes.len) return error.EndOfStream;
    var fde_reader: Reader = .fixed(section.bytes[@intCast(fde_offset)..]);
    const fde_info = switch (try EntryHeader.read(&fde_reader, fde_offset, section.id, endian)) {
        .fde => |info| info,
        .cie, .terminator => return bad(), // This is meant to be an FDE
    };

    const cie = unwind.findCie(fde_info.cie_offset) orelse return error.InvalidDebugInfo;
    const fde: FrameDescriptionEntry = try .parse(
        section.vaddr + fde_offset + fde_reader.seek,
        try fde_reader.take(cast(usize, fde_info.bytes_len) orelse return error.EndOfStream),
        cie,
        endian,
    );

    return .{ cie, fde };
}

const EhPointerContext = struct {
    /// The address of the pointer field itself
    pc_rel_base: u64,
    // These relative addressing modes are only used in specific cases, and
    // might not be available / required in all parsing contexts
    data_rel_base: ?u64 = null,
    text_rel_base: ?u64 = null,
    function_rel_base: ?u64 = null,
};
/// Returns `error.InvalidDebugInfo` if the encoding is `EH.PE.omit`.
fn readEhPointerAbs(r: *Reader, enc_ty: EH_PE.Type, addr_size_bytes: u8, endian: Endian) !union(enum) {
    signed: i64,
    unsigned: u64,
} {
    return switch (enc_ty) {
        .absptr => .{
            .unsigned = switch (addr_size_bytes) {
                2 => try r.takeInt(u16, endian),
                4 => try r.takeInt(u32, endian),
                8 => try r.takeInt(u64, endian),
                else => return error.UnsupportedAddrSize,
            },
        },
        .uleb128 => .{ .unsigned = try r.takeLeb128(u64) },
        .udata2 => .{ .unsigned = try r.takeInt(u16, endian) },
        .udata4 => .{ .unsigned = try r.takeInt(u32, endian) },
        .udata8 => .{ .unsigned = try r.takeInt(u64, endian) },
        .sleb128 => .{ .signed = try r.takeLeb128(i64) },
        .sdata2 => .{ .signed = try r.takeInt(i16, endian) },
        .sdata4 => .{ .signed = try r.takeInt(i32, endian) },
        .sdata8 => .{ .signed = try r.takeInt(i64, endian) },
        else => return bad(),
    };
}
/// Returns `error.InvalidDebugInfo` if the encoding is `EH.PE.omit`.
fn readEhPointer(r: *Reader, enc: EH_PE, addr_size_bytes: u8, ctx: EhPointerContext, endian: Endian) !u64 {
    const offset = try readEhPointerAbs(r, enc.type, addr_size_bytes, endian);
    if (enc.indirect) return bad(); // GCC extension; not supported
    const base: u64 = switch (enc.rel) {
        .abs, .aligned => 0,
        .pcrel => ctx.pc_rel_base,
        .textrel => ctx.text_rel_base orelse return bad(),
        .datarel => ctx.data_rel_base orelse return bad(),
        .funcrel => ctx.function_rel_base orelse return bad(),
        _ => return bad(),
    };
    return switch (offset) {
        .signed => |s| if (s >= 0)
            try std.math.add(u64, base, @intCast(s))
        else
            try std.math.sub(u64, base, @intCast(-s)),
        // absptr can actually contain signed values in some cases (aarch64 MachO)
        .unsigned => |u| u +% base,
    };
}

/// Like `Reader.fixed`, but when the length of the data is unknown and we just want to allow
/// reading indefinitely.
fn maxSlice(ptr: [*]const u8) []const u8 {
    const len = std.math.maxInt(usize) - @intFromPtr(ptr);
    return ptr[0..len];
}

pub const EH_PE = packed struct(u8) {
    type: Type,
    rel: Rel,
    /// Undocumented GCC extension
    indirect: bool = false,

    /// This is a special encoding which does not correspond to named `type`/`rel` values.
    pub const omit: EH_PE = @bitCast(@as(u8, 0xFF));

    pub const Type = enum(u4) {
        absptr = 0x0,
        uleb128 = 0x1,
        udata2 = 0x2,
        udata4 = 0x3,
        udata8 = 0x4,
        sleb128 = 0x9,
        sdata2 = 0xA,
        sdata4 = 0xB,
        sdata8 = 0xC,
        _,
    };

    /// The specification considers this a `u4`, but the GCC `indirect` field extension conflicts
    /// with that, so we consider it a `u3` instead.
    pub const Rel = enum(u3) {
        abs = 0x0,
        pcrel = 0x1,
        textrel = 0x2,
        datarel = 0x3,
        funcrel = 0x4,
        aligned = 0x5,
        _,
    };
};

const Allocator = std.mem.Allocator;
const assert = std.debug.assert;
const bad = Dwarf.bad;
const cast = std.math.cast;
const DW = std.dwarf;
const debug = @import("../../new_debug.zig");
const Dwarf = debug.Dwarf;
const EH = DW.EH;
const Endian = std.builtin.Endian;
const Format = DW.Format;
const maxInt = std.math.maxInt;
const missing = Dwarf.missing;
const Reader = std.Io.Reader;
const std = @import("std");
const Unwind = @This();
