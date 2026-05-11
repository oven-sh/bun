// Grapheme break implementation using uucode's approach.
// Includes GB9c (Indic Conjunct Break) support.
// Types and algorithm are self-contained; no runtime dependency on uucode.
// Tables are pre-generated and committed as grapheme_tables.zig.

/// Grapheme break property for codepoints, excluding control/CR/LF
/// which are assumed to be handled externally.
pub const GraphemeBreakNoControl = enum(u5) {
    other,
    prepend,
    regional_indicator,
    spacing_mark,
    l,
    v,
    t,
    lv,
    lvt,
    zwj,
    zwnj,
    extended_pictographic,
    emoji_modifier_base,
    emoji_modifier,
    // extend ==
    //   zwnj +
    //   indic_conjunct_break_extend +
    //   indic_conjunct_break_linker
    indic_conjunct_break_extend,
    indic_conjunct_break_linker,
    indic_conjunct_break_consonant,
};

/// State maintained between sequential calls to graphemeBreak.
pub const BreakState = enum(u3) {
    default,
    regional_indicator,
    extended_pictographic,
    indic_conjunct_break_consonant,
    indic_conjunct_break_linker,
};

/// 3-level lookup table for codepoint → element mapping.
/// stage1 maps high byte → stage2 offset (u16)
/// stage2 maps to stage3 index (u8, max 255 unique values)
/// stage3 stores the actual element values
pub fn Tables(comptime Elem: type) type {
    return struct {
        stage1: []const u16,
        stage2: []const u8,
        stage3: []const Elem,

        pub inline fn get(self: *const @This(), cp: u21) Elem {
            const high = cp >> 8;
            const low = cp & 0xFF;
            return self.stage3[self.stage2[@as(usize, self.stage1[high]) + low]];
        }
    };
}

pub const table = grapheme_tables.table;

/// Determines if there is a grapheme break between two codepoints.
/// Must be called sequentially maintaining the state between calls.
///
/// This function does NOT handle control characters, line feeds, or
/// carriage returns. Those must be filtered out before calling.
pub fn graphemeBreak(cp1: u21, cp2: u21, state: *BreakState) bool {
    const value = Precompute.data[
        (Precompute.Key{
            .gb1 = grapheme_tables.table.get(cp1),
            .gb2 = grapheme_tables.table.get(cp2),
            .state = state.*,
        }).index()
    ];
    state.* = value.state;
    return value.result;
}

/// Precomputed lookup table for all possible permutations of
/// state x grapheme_break_1 x grapheme_break_2.
/// 2^13 keys of 4-bit values = 8KB total.
const Precompute = struct {
    const Key = packed struct(u13) {
        state: BreakState,
        gb1: GraphemeBreakNoControl,
        gb2: GraphemeBreakNoControl,

        fn index(self: Key) usize {
            return @intCast(@as(u13, @bitCast(self)));
        }
    };

    const Value = packed struct(u4) {
        result: bool,
        state: BreakState,
    };

    const data = precompute: {
        var result: [std.math.maxInt(u13) + 1]Value = undefined;

        const max_state_int = blk: {
            var max: usize = 0;
            for (@typeInfo(BreakState).@"enum".fields) |field| {
                if (field.value > max) max = field.value;
            }
            break :blk max;
        };

        @setEvalBranchQuota(10_000);
        const info = @typeInfo(GraphemeBreakNoControl).@"enum";
        for (0..max_state_int + 1) |state_int| {
            for (info.fields) |field1| {
                for (info.fields) |field2| {
                    var state: BreakState = @enumFromInt(state_int);

                    const key: Key = .{
                        .gb1 = @field(GraphemeBreakNoControl, field1.name),
                        .gb2 = @field(GraphemeBreakNoControl, field2.name),
                        .state = state,
                    };
                    const v = computeGraphemeBreakNoControl(
                        key.gb1,
                        key.gb2,
                        &state,
                    );
                    result[key.index()] = .{ .result = v, .state = state };
                }
            }
        }

        bun.assert(@sizeOf(@TypeOf(result)) == 8192);
        break :precompute result;
    };
};

/// Core grapheme break algorithm including GB9c (Indic Conjunct Break).
/// Ported from uucode's computeGraphemeBreakNoControl.
fn computeGraphemeBreakNoControl(
    gb1: GraphemeBreakNoControl,
    gb2: GraphemeBreakNoControl,
    state: *BreakState,
) bool {
    // Set state back to default when gb1 or gb2 is not expected in sequence.
    switch (state.*) {
        .regional_indicator => {
            if (gb1 != .regional_indicator or gb2 != .regional_indicator) {
                state.* = .default;
            }
        },
        .extended_pictographic => {
            switch (gb1) {
                .indic_conjunct_break_extend,
                .indic_conjunct_break_linker,
                .zwnj,
                .zwj,
                .extended_pictographic,
                .emoji_modifier_base,
                .emoji_modifier,
                => {},
                else => state.* = .default,
            }

            switch (gb2) {
                .indic_conjunct_break_extend,
                .indic_conjunct_break_linker,
                .zwnj,
                .zwj,
                .extended_pictographic,
                .emoji_modifier_base,
                .emoji_modifier,
                => {},
                else => state.* = .default,
            }
        },
        .indic_conjunct_break_consonant, .indic_conjunct_break_linker => {
            switch (gb1) {
                .indic_conjunct_break_consonant,
                .indic_conjunct_break_linker,
                .indic_conjunct_break_extend,
                .zwj,
                => {},
                else => state.* = .default,
            }

            switch (gb2) {
                .indic_conjunct_break_consonant,
                .indic_conjunct_break_linker,
                .indic_conjunct_break_extend,
                .zwj,
                => {},
                else => state.* = .default,
            }
        },
        .default => {},
    }

    // GB6: L x (L | V | LV | LVT)
    if (gb1 == .l) {
        if (gb2 == .l or
            gb2 == .v or
            gb2 == .lv or
            gb2 == .lvt) return false;
    }

    // GB7: (LV | V) x (V | T)
    if (gb1 == .lv or gb1 == .v) {
        if (gb2 == .v or gb2 == .t) return false;
    }

    // GB8: (LVT | T) x T
    if (gb1 == .lvt or gb1 == .t) {
        if (gb2 == .t) return false;
    }

    // Handle GB9 (Extend | ZWJ) later, since it can also match the start of
    // GB9c (Indic) and GB11 (Emoji ZWJ)

    // GB9a: SpacingMark
    if (gb2 == .spacing_mark) return false;

    // GB9b: Prepend
    if (gb1 == .prepend) return false;

    // GB9c: Indic Conjunct Break
    if (gb1 == .indic_conjunct_break_consonant) {
        // start of sequence
        if (isIndicConjunctBreakExtend(gb2)) {
            state.* = .indic_conjunct_break_consonant;
            return false;
        } else if (gb2 == .indic_conjunct_break_linker) {
            // jump straight to linker state
            state.* = .indic_conjunct_break_linker;
            return false;
        }
        // else, not an Indic sequence
    } else if (state.* == .indic_conjunct_break_consonant) {
        // consonant state
        if (gb2 == .indic_conjunct_break_linker) {
            // consonant -> linker transition
            state.* = .indic_conjunct_break_linker;
            return false;
        } else if (isIndicConjunctBreakExtend(gb2)) {
            // continue [extend]* sequence
            return false;
        } else {
            // Not a valid Indic sequence
            state.* = .default;
        }
    } else if (state.* == .indic_conjunct_break_linker) {
        // linker state
        if (gb2 == .indic_conjunct_break_linker or
            isIndicConjunctBreakExtend(gb2))
        {
            // continue [extend linker]* sequence
            return false;
        } else if (gb2 == .indic_conjunct_break_consonant) {
            // linker -> end of sequence
            state.* = .default;
            return false;
        } else {
            // Not a valid Indic sequence
            state.* = .default;
        }
    }

    // GB11: Emoji ZWJ sequence and Emoji modifier sequence
    if (isExtendedPictographic(gb1)) {
        // start of sequence
        if (isExtend(gb2) or gb2 == .zwj) {
            state.* = .extended_pictographic;
            return false;
        }

        // emoji_modifier_sequence: emoji_modifier_base emoji_modifier
        if (gb1 == .emoji_modifier_base and gb2 == .emoji_modifier) {
            state.* = .extended_pictographic;
            return false;
        }

        // else, not an Emoji ZWJ sequence
    } else if (state.* == .extended_pictographic) {
        // continue or end sequence
        if ((isExtend(gb1) or gb1 == .emoji_modifier) and
            (isExtend(gb2) or gb2 == .zwj))
        {
            // continue extend* ZWJ sequence
            return false;
        } else if (gb1 == .zwj and isExtendedPictographic(gb2)) {
            // ZWJ -> end of sequence
            state.* = .default;
            return false;
        } else {
            // Not a valid Emoji ZWJ sequence
            state.* = .default;
        }
    }

    // GB12 and GB13: Regional Indicator
    if (gb1 == .regional_indicator and gb2 == .regional_indicator) {
        if (state.* == .default) {
            state.* = .regional_indicator;
            return false;
        } else {
            state.* = .default;
            return true;
        }
    }

    // GB9: x (Extend | ZWJ)
    if (isExtend(gb2) or gb2 == .zwj) return false;

    // GB999: Otherwise, break everywhere
    return true;
}

fn isIndicConjunctBreakExtend(gb: GraphemeBreakNoControl) bool {
    return gb == .indic_conjunct_break_extend or gb == .zwj;
}

fn isExtend(gb: GraphemeBreakNoControl) bool {
    return gb == .zwnj or
        gb == .indic_conjunct_break_extend or
        gb == .indic_conjunct_break_linker;
}

fn isExtendedPictographic(gb: GraphemeBreakNoControl) bool {
    return gb == .extended_pictographic or gb == .emoji_modifier_base;
}

const bun = @import("bun");
const grapheme_tables = @import("./grapheme_tables.zig");
const std = @import("std");
