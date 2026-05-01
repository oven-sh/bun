pub const max_code_point = 0x10FFFF;
pub const zero_width_non_joiner = 0x200C;
pub const zero_width_joiner = 0x200D;

pub const default = Table{
    .fields = &.{
        // UnicodeData
        .{
            .name = "name",
            .type = []const u8,
            .max_len = 88,
            .max_offset = 1030461,
            .embedded_len = 2,
        },
        .{ .name = "general_category", .type = types.GeneralCategory },
        .{ .name = "canonical_combining_class", .type = u8 },
        .{ .name = "bidi_class", .type = types.BidiClass },
        .{ .name = "decomposition_type", .type = types.DecompositionType },
        .{
            .name = "decomposition_mapping",
            .type = []const u21,
            .cp_packing = .shift,
            .shift_low = -181519,
            .shift_high = 99324,
            .max_len = 18,
            .max_offset = 4602,
            .embedded_len = 0,
        },
        .{ .name = "numeric_type", .type = types.NumericType },
        .{ .name = "numeric_value_decimal", .type = ?u4 },
        .{ .name = "numeric_value_digit", .type = ?u4 },
        .{
            .name = "numeric_value_numeric",
            .type = []const u8,
            .max_len = 13,
            .max_offset = 503,
            .embedded_len = 1,
        },
        .{ .name = "is_bidi_mirrored", .type = bool },
        .{
            .name = "unicode_1_name",
            .type = []const u8,
            .max_len = 55,
            .max_offset = 49956,
            .embedded_len = 0,
        },
        .{
            .name = "simple_uppercase_mapping",
            .type = ?u21,
            .cp_packing = .shift,
            .shift_low = -38864,
            .shift_high = 42561,
        },
        .{
            .name = "simple_lowercase_mapping",
            .type = ?u21,
            .cp_packing = .shift,
            .shift_low = -42561,
            .shift_high = 38864,
        },
        .{
            .name = "simple_titlecase_mapping",
            .type = ?u21,
            .cp_packing = .shift,
            .shift_low = -38864,
            .shift_high = 42561,
        },

        // CaseFolding
        .{
            .name = "case_folding_simple",
            .type = u21,
            .cp_packing = .shift,
            .shift_low = -42561,
            .shift_high = 35267,
        },
        .{
            .name = "case_folding_full",
            .type = []const u21,
            .cp_packing = .shift,
            .shift_low = -42561,
            .shift_high = 35267,
            .max_len = 3,
            .max_offset = 160,
            .embedded_len = 0,
        },
        .{
            .name = "case_folding_turkish_only",
            .type = []const u21,
            .cp_packing = .direct,
            .shift_low = -199,
            .shift_high = 232,
            .max_len = 1,
            .max_offset = 2,
            .embedded_len = 0,
        },
        .{
            .name = "case_folding_common_only",
            .type = []const u21,
            .cp_packing = .direct,
            .shift_low = -42561,
            .shift_high = 35267,
            .max_len = 1,
            .max_offset = 1423,
            .embedded_len = 0,
        },
        .{
            .name = "case_folding_simple_only",
            .type = []const u21,
            .cp_packing = .direct,
            .shift_low = -7615,
            .shift_high = 1,
            .max_len = 1,
            .max_offset = 31,
            .embedded_len = 0,
        },
        .{
            .name = "case_folding_full_only",
            .type = []const u21,
            .max_len = 3,
            .max_offset = 160,
            .embedded_len = 0,
        },

        // SpecialCasing
        .{ .name = "has_special_casing", .type = bool },
        .{
            .name = "special_lowercase_mapping",
            .type = []const u21,
            .cp_packing = .shift,
            .shift_low = -199,
            .shift_high = 232,
            .max_len = 3,
            .max_offset = 13,
            .embedded_len = 0,
        },
        .{
            .name = "special_titlecase_mapping",
            .type = []const u21,
            .cp_packing = .shift,
            .shift_low = 0,
            .shift_high = 199,
            .max_len = 3,
            .max_offset = 104,
            .embedded_len = 0,
        },
        .{
            .name = "special_uppercase_mapping",
            .type = []const u21,
            .cp_packing = .shift,
            .shift_low = 0,
            .shift_high = 199,
            .max_len = 3,
            .max_offset = 158,
            .embedded_len = 0,
        },
        .{
            .name = "special_casing_condition",
            .type = []const types.SpecialCasingCondition,
            .max_len = 2,
            .max_offset = 9,
            .embedded_len = 0,
        },

        // Case mappings
        .{
            .name = "lowercase_mapping",
            .type = []const u21,
            .cp_packing = .shift,
            .shift_low = -42561,
            .shift_high = 38864,
            .max_len = 1,
            .max_offset = 0,
            .embedded_len = 0,
        },
        .{
            .name = "titlecase_mapping",
            .type = []const u21,
            .cp_packing = .shift,
            .shift_low = -38864,
            .shift_high = 42561,
            .max_len = 3,
            .max_offset = 104,
            .embedded_len = 0,
        },
        .{
            .name = "uppercase_mapping",
            .type = []const u21,
            .cp_packing = .shift,
            .shift_low = -38864,
            .shift_high = 42561,
            .max_len = 3,
            .max_offset = 158,
            .embedded_len = 0,
        },

        // DerivedCoreProperties
        .{ .name = "is_math", .type = bool },
        .{ .name = "is_alphabetic", .type = bool },
        .{ .name = "is_lowercase", .type = bool },
        .{ .name = "is_uppercase", .type = bool },
        .{ .name = "is_cased", .type = bool },
        .{ .name = "is_case_ignorable", .type = bool },
        .{ .name = "changes_when_lowercased", .type = bool },
        .{ .name = "changes_when_uppercased", .type = bool },
        .{ .name = "changes_when_titlecased", .type = bool },
        .{ .name = "changes_when_casefolded", .type = bool },
        .{ .name = "changes_when_casemapped", .type = bool },
        .{ .name = "is_id_start", .type = bool },
        .{ .name = "is_id_continue", .type = bool },
        .{ .name = "is_xid_start", .type = bool },
        .{ .name = "is_xid_continue", .type = bool },
        .{ .name = "is_default_ignorable", .type = bool },
        .{ .name = "is_grapheme_extend", .type = bool },
        .{ .name = "is_grapheme_base", .type = bool },
        .{ .name = "is_grapheme_link", .type = bool },
        .{ .name = "indic_conjunct_break", .type = types.IndicConjunctBreak },

        // EastAsianWidth
        .{ .name = "east_asian_width", .type = types.EastAsianWidth },

        // OriginalGraphemeBreak
        // This is the field from GraphemeBreakProperty.txt, without combining
        // `indic_conjunct_break`, `is_emoji_modifier`,
        // `is_emoji_modifier_base`, and `is_extended_pictographic`
        .{ .name = "original_grapheme_break", .type = types.OriginalGraphemeBreak },

        // EmojiData
        .{ .name = "is_emoji", .type = bool },
        .{ .name = "is_emoji_presentation", .type = bool },
        .{ .name = "is_emoji_modifier", .type = bool },
        .{ .name = "is_emoji_modifier_base", .type = bool },
        .{ .name = "is_emoji_component", .type = bool },
        .{ .name = "is_extended_pictographic", .type = bool },

        // EmojiVariationSequences
        // These are all going to be equivalent, but
        // `emoji-variation-sequences.txt` and UTS #51 split out the emoji and
        // text variation sequences separately. However, ever since these were
        // introduced in Unicode 6.1 (see
        // https://unicode.org/Public/6.1.0/ucd/StandardizedVariants.txt --
        // dated 2011-11-10), until present, there has never been an emoji
        // variation sequence that isn't also a valid text variation sequence,
        // and vice versa, so the recommendation is to just use
        // `is_emoji_vs_base`.
        .{ .name = "is_emoji_vs_base", .type = bool },
        .{ .name = "is_emoji_vs_text", .type = bool },
        .{ .name = "is_emoji_vs_emoji", .type = bool },

        // GraphemeBreak (derived)
        // This is derived from `original_grapheme_break`
        // (GraphemeBreakProperty.txt), `indic_conjunct_break`,
        // `is_emoji_modifier`, `is_emoji_modifier_base`, and
        // `is_extended_pictographic`
        .{ .name = "grapheme_break", .type = types.GraphemeBreak },

        // BidiPairedBracket
        .{
            .name = "bidi_paired_bracket",
            .type = types.BidiPairedBracket,
            .cp_packing = .shift,
            .shift_low = -3,
            .shift_high = 3,
        },

        // Block
        .{ .name = "block", .type = types.Block },
    },
};

pub const is_updating_ucd = false;

pub const Field = struct {
    name: [:0]const u8,
    type: type,

    // For Shift + Slice fields
    cp_packing: CpPacking = .direct,
    shift_low: isize = 0,
    shift_high: isize = 0,

    // For Slice fields
    max_len: usize = 0,
    max_offset: usize = 0,
    embedded_len: usize = 0,

    // For PackedOptional fields
    min_value: isize = 0,
    max_value: isize = 0,

    pub const CpPacking = enum {
        direct,
        shift,
    };

    pub const Runtime = struct {
        name: []const u8,
        type: []const u8,
        cp_packing: CpPacking,
        shift_low: isize,
        shift_high: isize,
        max_len: usize,
        max_offset: usize,
        embedded_len: usize,
        min_value: isize,
        max_value: isize,

        pub fn eql(a: Runtime, b: Runtime) bool {
            return a.cp_packing == b.cp_packing and
                a.shift_low == b.shift_low and
                a.shift_high == b.shift_high and
                a.max_len == b.max_len and
                a.max_offset == b.max_offset and
                a.embedded_len == b.embedded_len and
                a.min_value == b.min_value and
                a.max_value == b.max_value and
                std.mem.eql(u8, a.type, b.type) and
                std.mem.eql(u8, a.name, b.name);
        }

        pub fn override(self: Runtime, overrides: anytype) Runtime {
            var result: Runtime = .{
                .name = self.name,
                .type = self.type,
                .cp_packing = self.cp_packing,
                .shift_low = self.shift_low,
                .shift_high = self.shift_high,
                .max_len = self.max_len,
                .max_offset = self.max_offset,
                .embedded_len = self.embedded_len,
                .min_value = self.min_value,
                .max_value = self.max_value,
            };

            inline for (@typeInfo(@TypeOf(overrides)).@"struct".fields) |f| {
                @field(result, f.name) = @field(overrides, f.name);
            }

            return result;
        }

        pub fn compareActual(self: Runtime, actual: Runtime) bool {
            var is_okay = true;

            if (self.shift_low != actual.shift_low) {
                std.log.err("Config for field '{s}' does not match actual. Set .shift_low = {d}, // change from {d}", .{ self.name, actual.shift_low, self.shift_low });
                is_okay = false;
            }

            if (self.shift_high != actual.shift_high) {
                std.log.err("Config for field '{s}' does not match actual. Set .shift_high = {d}, // change from {d}", .{ self.name, actual.shift_high, self.shift_high });
                is_okay = false;
            }

            if (self.max_len != actual.max_len) {
                std.log.err("Config for field '{s}' does not match actual. Set .max_len = {d}, // change from {d}", .{ self.name, actual.max_len, self.max_len });
                is_okay = false;
            }

            if (self.max_offset != actual.max_offset) {
                std.log.err("Config for field '{s}' does not match actual. Set .max_offset = {d}, // change from {d}", .{ self.name, actual.max_offset, self.max_offset });
                is_okay = false;
            }

            if (self.min_value != actual.min_value) {
                std.log.err("Config for field '{s}' does not match actual. Set .min_value = {d}, // change from {d}", .{ self.name, actual.min_value, self.min_value });
                is_okay = false;
            }

            if (self.max_value != actual.max_value) {
                std.log.err("Config for field '{s}' does not match actual. Set .max_value = {d}, // change from {d}", .{ self.name, actual.max_value, self.max_value });
                is_okay = false;
            }

            return is_okay;
        }

        pub fn write(self: Runtime, writer: *std.Io.Writer) !void {
            try writer.print(
                \\.{{
                \\    .name = "{s}",
                \\
            , .{self.name});

            var type_parts = std.mem.splitScalar(u8, self.type, '.');
            const base_type = type_parts.next().?;
            const rest_type = type_parts.rest();

            if (std.mem.endsWith(u8, base_type, "types") or
                std.mem.endsWith(u8, base_type, "types_x") or
                rest_type.len == 0)
            {
                try writer.print(
                    \\    .type = {s},
                    \\
                , .{self.type});
            } else {
                const prefix = if (base_type[0] == '?') "?" else "";
                try writer.print(
                    \\    .type = {s}build_config.{s},
                    \\
                , .{ prefix, rest_type });
            }

            if (self.cp_packing != .direct or
                self.shift_low != 0 or
                self.shift_high != 0)
            {
                try writer.print(
                    \\    .cp_packing = .{s},
                    \\    .shift_low = {},
                    \\    .shift_high = {},
                    \\
                , .{ @tagName(self.cp_packing), self.shift_low, self.shift_high });
            }
            if (self.max_len != 0) {
                try writer.print(
                    \\    .max_len = {},
                    \\    .max_offset = {},
                    \\    .embedded_len = {},
                    \\
                , .{ self.max_len, self.max_offset, self.embedded_len });
            }
            if (self.min_value != 0 or self.max_value != 0) {
                try writer.print(
                    \\    .min_value = {},
                    \\    .max_value = {},
                    \\
                , .{ self.min_value, self.max_value });
            }

            try writer.writeAll(
                \\},
                \\
            );
        }
    };

    pub const Kind = enum {
        basic,
        slice,
        shift,
        optional,
        @"union",
    };

    pub fn kind(self: Field) Kind {
        switch (@typeInfo(self.type)) {
            .pointer => return .slice,
            .optional => |optional| {
                if (!isPackable(optional.child)) {
                    return .basic;
                }

                switch (self.cp_packing) {
                    .direct => return .optional,
                    .shift => return .shift,
                }
            },
            .@"union" => return .@"union",
            else => {
                switch (self.cp_packing) {
                    .direct => return .basic,
                    .shift => return .shift,
                }
            },
        }
    }

    pub fn canBePacked(self: Field) bool {
        if (self.kind() == .slice) {
            return false;
        }

        switch (@typeInfo(self.type)) {
            .optional => |optional| {
                return isPackable(optional.child);
            },
            .@"union" => |info| {
                return for (info.fields) |f| {
                    if (f.type != void and !isPackable(f.type)) {
                        break false;
                    }
                } else true;
            },
            else => return true,
        }
    }

    pub fn runtime(self: Field) Runtime {
        return .{
            .name = self.name,
            .type = @typeName(self.type),
            .cp_packing = self.cp_packing,
            .shift_low = self.shift_low,
            .shift_high = self.shift_high,
            .max_len = self.max_len,
            .max_offset = self.max_offset,
            .embedded_len = self.embedded_len,
            .min_value = self.min_value,
            .max_value = self.max_value,
        };
    }

    pub fn eql(a: Field, b: Field) bool {
        // Use runtime `eql` just to be lazy
        return a.runtime().eql(b.runtime());
    }

    pub fn override(self: Field, overrides: anytype) Field {
        var result = self;

        inline for (@typeInfo(@TypeOf(overrides)).@"struct".fields) |f| {
            if (!is_updating_ucd and (std.mem.eql(u8, f.name, "name") or
                std.mem.eql(u8, f.name, "type") or
                std.mem.eql(u8, f.name, "shift_low") or
                std.mem.eql(u8, f.name, "shift_high") or
                std.mem.eql(u8, f.name, "max_len")) or
                std.mem.eql(u8, f.name, "min_value") or
                std.mem.eql(u8, f.name, "max_value"))
            {
                @compileError("Cannot override field '" ++ f.name ++ "'");
            }

            @field(result, f.name) = @field(overrides, f.name);
        }

        return result;
    }
};

pub fn isPackable(comptime T: type) bool {
    switch (@typeInfo(T)) {
        .int => |int| {
            return int.bits <= @bitSizeOf(isize);
        },
        .@"enum" => |e| {
            return @typeInfo(e.tag_type).int.bits <= @bitSizeOf(isize);
        },
        .bool => return true,
        else => return false,
    }
}

pub const Table = struct {
    name: ?[]const u8 = null,
    stages: Stages = .auto,
    packing: Packing = .auto,
    extensions: []const Extension = &.{},
    fields: []const Field,

    pub const Stages = enum {
        auto,
        two,
        three,
    };

    pub const Packing = enum {
        auto, // as in decide automatically, not as in Type.ContainerLayout.auto
        @"packed",
        unpacked,

        pub fn write(self: Packing, writer: *std.Io.Writer) !void {
            switch (self) {
                .auto => unreachable,
                .unpacked => try writer.writeAll(".unpacked"),
                .@"packed" => try writer.writeAll(".@\"packed\""),
            }
        }
    };

    pub fn hasField(comptime self: *const Table, name: []const u8) bool {
        @setEvalBranchQuota(10_000);

        return inline for (self.fields) |f| {
            if (std.mem.eql(u8, f.name, name)) {
                break true;
            }
        } else false;
    }

    pub fn field(comptime self: *const Table, name: []const u8) Field {
        @setEvalBranchQuota(20_000);

        return for (self.fields) |f| {
            if (std.mem.eql(u8, f.name, name)) {
                break f;
            }
        } else @compileError("Field '" ++ name ++ "' not found in Table");
    }

    // TODO: benchmark this more
    const two_stage_size_threshold = 4;

    pub fn resolve(comptime self: *const Table) Table {
        if (self.stages != .auto and self.packing != .auto) {
            return self;
        }

        const can_be_packed = switch (self.packing) {
            .auto, .@"packed" => blk: {
                for (self.fields) |f| {
                    if (!f.canBePacked()) {
                        break :blk false;
                    }
                }

                break :blk true;
            },
            .unpacked => false,
        };

        const DataUnpacked = types.Data(.{
            .packing = .unpacked,
            .fields = self.fields,
        });
        const DataPacked = if (can_be_packed)
            types.Data(.{
                .packing = .@"packed",
                .fields = self.fields,
            })
        else
            DataUnpacked;

        const unpacked_size = @sizeOf(DataUnpacked);
        const packed_size = @sizeOf(DataPacked);
        const min_size = @min(unpacked_size, packed_size);

        const stages: Stages = switch (self.stages) {
            .auto => blk: {
                if (min_size <= two_stage_size_threshold) {
                    break :blk .two;
                } else {
                    break :blk .three;
                }
            },
            .two => .two,
            .three => .three,
        };

        const packing: Packing = switch (self.packing) {
            .auto => blk: {
                if (!can_be_packed) {
                    break :blk .unpacked;
                }

                if (unpacked_size == min_size or unpacked_size <= two_stage_size_threshold) {
                    break :blk .unpacked;
                }

                if (stages == .two) {
                    if (packed_size <= two_stage_size_threshold) {
                        break :blk .@"packed";
                    } else if (3 * packed_size <= 2 * unpacked_size) {
                        break :blk .@"packed";
                    } else {
                        break :blk .unpacked;
                    }
                } else {
                    if (packed_size <= unpacked_size / 2) {
                        break :blk .@"packed";
                    } else {
                        break :blk .unpacked;
                    }
                }
            },
            .@"packed" => .@"packed",
            .unpacked => .unpacked,
        };

        return .{
            .stages = stages,
            .packing = packing,
            .name = self.name,
            .extensions = self.extensions,
            .fields = self.fields,
        };
    }
};

pub const Extension = struct {
    inputs: []const [:0]const u8,
    fields: []const Field,

    compute: *const fn (
        allocator: std.mem.Allocator,
        cp: u21,
        data: anytype,
        backing: anytype,
        tracking: anytype,
    ) std.mem.Allocator.Error!void,

    pub fn hasField(comptime self: *const Extension, name: []const u8) bool {
        return inline for (self.fields) |f| {
            if (std.mem.eql(u8, f.name, name)) {
                break true;
            }
        } else false;
    }

    pub fn field(comptime self: *const Extension, name: []const u8) Field {
        return for (self.fields) |f| {
            if (std.mem.eql(u8, f.name, name)) {
                break f;
            }
        } else @compileError("Field '" ++ name ++ "' not found in Extension");
    }
};

// This is used by generated build_config.zig, and not intended for direct use
// when using advanced configuration.
pub fn _resolveFields(
    comptime config_x: type,
    comptime field_names: []const []const u8,
    comptime extension_names: []const []const u8,
) [field_names.len]Field {
    @setEvalBranchQuota(100_000);
    var result: [field_names.len]Field = undefined;
    for (field_names, 0..) |field_name, i| {
        result[i] = extensions_loop: inline for (@typeInfo(config_x).@"struct".decls) |decl| {
            for (extension_names) |ext_name| {
                if (std.mem.eql(u8, decl.name, ext_name)) {
                    const extension = @field(config_x, decl.name);
                    if (extension.hasField(field_name)) {
                        break :extensions_loop extension.field(field_name);
                    }
                }
            }
        } else default.field(field_name);
    }
    return result;
}

const std = @import("std");
const types = @import("./types.zig");
