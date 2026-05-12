//! This `x.grapheme.wcwidth` (and `wcwidthRemaining`/`utf8Wcwidth`) are the
//! full grapheme cluster calculation of the expected width in cells of a
//! monospaced font. It is not part of the Unicode standard.
//!
//! See `src/x/config_x/wcwidth.zig` for the logic determining the width of a
//! single code point standing alone, as well as a number of notes describing
//! the choices the implementation makes.
//!
//! This implementation makes the following choices:
//!
//! * Only the context of the current grapheme cluster affects the width. The
//!   width of a string of grapheme clusters is the sum of the widths of the
//!   individual clusters.
//!
//! * Grapheme clusters with a single code point simply return
//!   `wcwidth_standalone`. See `src/x/config_x/wcwidth.zig` for all the
//!   considerations determining this value.
//!
//! * The general calculation of the width of a grapheme cluster is the sum of
//!   the widths of the individual code points (clamped to 3), using
//!   `wcwidth_zero_in_grapheme` to treat a code point as width 0 in a multi-
//!   code-point grapheme cluster, otherwise using `wcwidth_standalone` for the
//!   widths of the code points.
//!
//!   Some alternative wcwidth implementations (see resources/wcwidth) only use
//!   the width of the first non-zero width code point, but this does not
//!   properly handle scripts such as Devanagari and Hangul, where multiple
//!   code points in the grapheme cluster may have non-zero width, and the
//!   resulting width is better represented by the sum.
//!
//! * Valid emoji sequences with VS16 (U+FEOF) return width 2, while
//!   valid text sequences with VS15 (U+FE0E) return width 1.
//!
//! * Emoji ZWJ (zero-width joiner) sequences are a special case and the width
//!   of the emoji code points following the ZWJ are not added to the sum.
//!
//! * Regional indicator sequences are given a width of 2.
//!
//! * In contrast to `resources/wcwidth/unicode_width.rs`, this implementation
//!   does not include a large number of exceptions, in order to keep the
//!   complexity down.
//!
//!   While the Unicode General Punctuation doc
//!   (https://www.unicode.org/charts/PDF/Unicode-17.0/U170-2000.pdf) notes
//!   that U+2018, U+2019, U+201C and U+201D followed by U+FE02 (VS-2) should
//!   be fullwidth (width 2), we treat them as width 1 for simplicity.
//!
//!   Rather than treat CJK contexts differently, we always choose East Asian
//!   Width (UAX #11) Ambiguous width (A) as width 1. See
//!   `src/x/config_x/wcwidth.zig` for more info.
//!

// This calculates the width of just a single grapheme, advancing the iterator.
// See `wcwidth` for a version that doesn't advance the iterator (accepting a
// constant iterator), `wcwidthRemaining` for a version that calculates the
// width of the remaining graphemes in the iterator, and `utf8Wcwidth` for the
// width of a string.
pub fn wcwidthNext(it: anytype) u2 {
    std.debug.assert(@typeInfo(@TypeOf(it)) == .pointer);

    const first = it.nextCodePoint() orelse return 0;

    var prev_cp: u21 = first.code_point;
    const standalone = uucode.get(.wcwidth_standalone, prev_cp);

    if (first.is_break) return standalone;

    var width: u2 = if (uucode.get(.wcwidth_zero_in_grapheme, prev_cp))
        0
    else
        standalone;

    var prev_state: uucode.grapheme.BreakState = it.state;
    std.debug.assert(it.peekCodePoint() != null);

    while (it.nextCodePoint()) |result| {
        var cp = result.code_point;
        if (cp == 0xFE0F) {
            // Emoji presentation selector. Only apply to base code points from
            // emoji variation sequences.
            if (uucode.get(.is_emoji_vs_base, prev_cp)) {
                width = 2;
            }
        } else if (cp == 0xFE0E) {
            // Text presentation selector. Only apply to base code points from
            // emoji variation sequences.
            if (uucode.get(.is_emoji_vs_base, prev_cp)) {
                width = 1;
            }
        } else if (cp == uucode.config.zero_width_joiner and
            prev_state == .extended_pictographic and
            !result.is_break)
        {
            // Make sure Emoji ZWJ sequences collapse to a single emoji by
            // skipping the next emoji base code point.
            const next = it.nextCodePoint() orelse unreachable;
            if (next.is_break) break;
            cp = next.code_point;
        } else if (prev_state == .regional_indicator) {
            width = 2;
        } else {
            if (!uucode.get(.wcwidth_zero_in_grapheme, cp)) {
                const added_width = uucode.get(.wcwidth_standalone, cp);
                if (@as(usize, added_width) + @as(usize, width) > 3) {
                    width = 3;
                } else {
                    width += added_width;
                }
            }
        }

        if (result.is_break) break;

        prev_cp = cp;
        prev_state = it.state;
    }

    return width;
}

pub fn wcwidth(const_it: anytype) u2 {
    var it = const_it;
    return wcwidthNext(&it);
}

pub fn wcwidthRemaining(it: anytype) usize {
    var width: usize = 0;
    while (it.next_cp != null) {
        width += wcwidthNext(it);
    }
    return width;
}

pub fn utf8Wcwidth(s: []const u8) usize {
    var it = uucode.grapheme.utf8Iterator(s);
    return wcwidthRemaining(&it);
}

test "wcwidthNext iterator state" {
    const str = "A\u{0300}B";
    var it = uucode.grapheme.utf8Iterator(str);

    // First grapheme: A + Combining Grave
    const w1 = wcwidthNext(&it);
    try std.testing.expectEqual(@as(u2, 1), w1);
    try std.testing.expectEqual(3, it.i); // 'A' (1) + 0x0300 (2) = 3 bytes

    // Second grapheme: B
    const w2 = wcwidthNext(&it);
    try std.testing.expectEqual(@as(u2, 1), w2);
    try std.testing.expectEqual(4, it.i); // + 'B' (1) = 4 bytes

    try std.testing.expect(it.peekCodePoint() == null);
}

test "wcwidthRemaining" {
    var it1 = uucode.grapheme.utf8Iterator("A\u{0300}B");
    try std.testing.expectEqual(@as(usize, 2), wcwidthRemaining(&it1));

    var it2 = uucode.grapheme.utf8Iterator("ABC");
    try std.testing.expectEqual(@as(usize, 3), wcwidthRemaining(&it2));

    var it3 = uucode.grapheme.utf8Iterator("😀AB");
    try std.testing.expectEqual(@as(usize, 4), wcwidthRemaining(&it3)); // 2 + 1 + 1

    var it4 = uucode.grapheme.utf8Iterator("");
    try std.testing.expectEqual(@as(usize, 0), wcwidthRemaining(&it4));

    // Test partial consumption
    var it5 = uucode.grapheme.utf8Iterator("ABC");
    _ = wcwidthNext(&it5); // Consume 'A'
    try std.testing.expectEqual(@as(usize, 2), wcwidthRemaining(&it5)); // Remaining "BC"
}

test "utf8Wcwidth" {
    try std.testing.expectEqual(@as(usize, 2), utf8Wcwidth("A\u{0300}B"));
}

test "wcwidth{,Next,Remaining} README example" {
    const str = "ò👨🏻‍❤️‍👨🏿_";
    var it = uucode.grapheme.utf8Iterator(str);

    // Requires the `wcwidth` builtin extension (see below)
    try std.testing.expectEqual(1, uucode.x.grapheme.wcwidth(it)); // 1 for 'ò'

    try std.testing.expectEqual(1, uucode.x.grapheme.wcwidthNext(&it)); // 1 for 'ò'
    const result = it.peekGrapheme();
    try std.testing.expectEqualStrings("👨🏻‍❤️‍👨🏿", str[result.?.start..result.?.end]);

    try std.testing.expectEqual(3, uucode.x.grapheme.wcwidthRemaining(&it)); // 3 for "👨🏻‍❤️‍👨🏿_"

    try std.testing.expectEqual(4, uucode.x.grapheme.utf8Wcwidth(str));
}

test "wcwidth ascii" {
    const it1 = uucode.grapheme.utf8Iterator("A");
    try std.testing.expectEqual(@as(u2, 1), wcwidth(it1));
    const it2 = uucode.grapheme.utf8Iterator("1");
    try std.testing.expectEqual(@as(u2, 1), wcwidth(it2));
}

test "wcwidth control" {
    const it1 = uucode.grapheme.utf8Iterator("\x00");
    try std.testing.expectEqual(@as(u2, 0), wcwidth(it1));
    const it2 = uucode.grapheme.utf8Iterator("\x7F");
    try std.testing.expectEqual(@as(u2, 0), wcwidth(it2));
}

test "wcwidth default ignorable" {
    const it1 = uucode.grapheme.utf8Iterator("\u{200B}"); // ZWSP
    try std.testing.expectEqual(@as(u2, 0), wcwidth(it1));
    const it2 = uucode.grapheme.utf8Iterator("\u{3164}"); // Hangul Filler
    try std.testing.expectEqual(@as(u2, 0), wcwidth(it2));
}

test "wcwidth marks standing alone" {
    const it = uucode.grapheme.utf8Iterator("\u{0300}"); // Mn
    try std.testing.expectEqual(@as(u2, 1), wcwidth(it));
}

test "wcwidth keycap standing alone" {
    const it = uucode.grapheme.utf8Iterator("\u{20E3}");
    try std.testing.expectEqual(@as(u2, 2), wcwidth(it));
}

test "wcwidth regional indicator standing alone" {
    const it = uucode.grapheme.utf8Iterator("\u{1F1E6}");
    try std.testing.expectEqual(@as(u2, 2), wcwidth(it));
}

test "wcwidth emoji" {
    const it = uucode.grapheme.utf8Iterator("😀");
    try std.testing.expectEqual(@as(u2, 2), wcwidth(it));
}

test "wcwidth ambiguous" {
    const it = uucode.grapheme.utf8Iterator("\u{00A1}");
    try std.testing.expectEqual(@as(u2, 1), wcwidth(it));
}

test "wcwidth fullwidth" {
    const it = uucode.grapheme.utf8Iterator("\u{3000}");
    try std.testing.expectEqual(@as(u2, 2), wcwidth(it));
}

test "wcwidth soft hyphen" {
    const it = uucode.grapheme.utf8Iterator("\u{00AD}");
    try std.testing.expectEqual(@as(u2, 1), wcwidth(it));
}

test "wcwidth sequence base + Mn" {
    const it = uucode.grapheme.utf8Iterator("A\u{0300}");
    try std.testing.expectEqual(@as(u2, 1), wcwidth(it));
}

test "wcwidth sequence base + Mc" {
    const it = uucode.grapheme.utf8Iterator("\u{0905}\u{0903}"); // A + Visarga
    try std.testing.expectEqual(@as(u2, 2), wcwidth(it));
}

test "wcwidth sequence emoji + modifier" {
    // Boy + Light Skin Tone
    const it = uucode.grapheme.utf8Iterator("\u{1F466}\u{1F3FB}");
    try std.testing.expectEqual(@as(u2, 2), wcwidth(it));
}

test "wcwidth sequence emoji + VS16" {
    // ☁️ (Cloud + VS16)
    const it = uucode.grapheme.utf8Iterator("\u{2601}\u{FE0F}");
    try std.testing.expectEqual(@as(u2, 2), wcwidth(it));
}

test "wcwidth sequence emoji + VS15" {
    // ☁︎ (Cloud + VS15)
    const it = uucode.grapheme.utf8Iterator("\u{2601}\u{FE0E}");
    try std.testing.expectEqual(@as(u2, 1), wcwidth(it));
}

test "wcwidth sequence keycap" {
    // 1️⃣
    const it = uucode.grapheme.utf8Iterator("1\u{FE0F}\u{20E3}");
    try std.testing.expectEqual(@as(u2, 2), wcwidth(it));
}

test "wcwidth sequence regional indicator full" {
    // 🇺🇸
    const it = uucode.grapheme.utf8Iterator("\u{1F1FA}\u{1F1F8}");
    try std.testing.expectEqual(@as(u2, 2), wcwidth(it));
}

test "wcwidth sequence emoji zwj" {
    // 👨‍🌾 (Farmer)
    const it = uucode.grapheme.utf8Iterator("\u{1F468}\u{200D}\u{1F33E}_");
    try std.testing.expectEqual(@as(u2, 2), wcwidth(it));
}

test "wcwidth sequence emoji zwj long" {
    // 👩‍👩‍👧‍👦 (family: woman, woman, girl, boy)
    const it = uucode.grapheme.utf8Iterator("\u{1F469}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}_");
    try std.testing.expectEqual(@as(u2, 2), wcwidth(it));
}

test "wcwidth sequence emoji zwj long with emoji modifiers" {
    // 👨🏻‍❤️‍💋‍👨🏿 Kiss: man, man, light skin tone, dark skin tone
    const it = uucode.grapheme.utf8Iterator("\u{1F468}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FF}_");
    try std.testing.expectEqual(@as(u2, 2), wcwidth(it));
}

test "wcwidth Hangul L+V" {
    // ᄀ (U+1100) + ᅡ (U+1161)
    const it = uucode.grapheme.utf8Iterator("\u{1100}\u{1161}");
    try std.testing.expectEqual(@as(u2, 2), wcwidth(it));
}

test "wcwidth Hangul L+V+T" {
    // ᄀ (U+1100) + ᅡ (U+1161) + ᆨ (U+11A8)
    const it = uucode.grapheme.utf8Iterator("\u{1100}\u{1161}\u{11A8}");
    try std.testing.expectEqual(@as(u2, 2), wcwidth(it));
}

test "wcwidth Hangul L+L+V" {
    // ᄀ (U+1100) + ᄀ (U+1100) + ᅡ (U+1161)
    // This is an archaic/complex sequence. 2 + 2 + 0 = 4 -> 3.
    const it = uucode.grapheme.utf8Iterator("\u{1100}\u{1100}\u{1161}");
    try std.testing.expectEqual(@as(u2, 3), wcwidth(it));
}

test "wcwidth Hangul LV+T" {
    // 가 (U+AC00) + ᆨ (U+11A8)
    const it = uucode.grapheme.utf8Iterator("\u{AC00}\u{11A8}");
    try std.testing.expectEqual(@as(u2, 2), wcwidth(it));
}

test "wcwidth Devanagari with ZWJ" {
    const str = "क्‍ष";
    const it = uucode.grapheme.Iterator(uucode.utf8.Iterator).init(.init(str));
    try std.testing.expect(wcwidth(it) == 2);
}

test "wcwidth Devanagari 3 consonants" {
    // Ka + Virama + Ka + Virama + Ka
    // 1 + 0 + 1 + 0 + 1 = 3
    const it = uucode.grapheme.utf8Iterator("\u{0915}\u{094D}\u{0915}\u{094D}\u{0915}");
    try std.testing.expectEqual(@as(u2, 3), wcwidth(it));
}

pub fn IteratorNoControl(comptime CodePointIterator: type) type {
    return uucode.grapheme.CustomIterator(
        CodePointIterator,
        types_x.GraphemeBreakNoControl,
        uucode.grapheme.BreakState,
        .grapheme_break_no_control,
        precomputedGraphemeBreakNoControl,
    );
}

pub fn utf8IteratorNoControl(bytes: []const u8) IteratorNoControl(uucode.utf8.Iterator) {
    return IteratorNoControl(uucode.utf8.Iterator).init(.init(bytes));
}

test "IteratorNoControl nextCodePoint/peekCodePoint" {
    const str = "👩🏽‍🚀🇨🇭";
    var it = utf8IteratorNoControl(str);
    try std.testing.expect(it.i == 0);

    var result = it.peekCodePoint();
    try std.testing.expect(it.i == 0);
    try std.testing.expect(result.?.code_point == 0x1F469); // 👩
    try std.testing.expect(result.?.is_break == false);

    result = it.nextCodePoint();
    try std.testing.expect(it.i == 4);
    try std.testing.expect(result.?.code_point == 0x1F469); // 👩
    try std.testing.expect(result.?.is_break == false);

    result = it.nextCodePoint();
    try std.testing.expect(result.?.code_point == 0x1F3FD); // 🏽
    try std.testing.expect(result.?.is_break == false);

    result = it.nextCodePoint();
    try std.testing.expect(result.?.code_point == 0x200D); // Zero width joiner
    try std.testing.expect(result.?.is_break == false);

    result = it.peekCodePoint();
    try std.testing.expect(result.?.code_point == 0x1F680); // 🚀
    try std.testing.expect(result.?.is_break == true);

    result = it.nextCodePoint();
    try std.testing.expect(it.i == 15);
    try std.testing.expect(result.?.code_point == 0x1F680); // 🚀
    try std.testing.expect(result.?.is_break == true);
    try std.testing.expect(std.mem.eql(u8, str[0..it.i], "👩🏽‍🚀"));

    result = it.nextCodePoint();
    try std.testing.expect(result.?.code_point == 0x1F1E8); // Regional Indicator "C"
    try std.testing.expect(result.?.is_break == false);

    result = it.nextCodePoint();
    try std.testing.expect(it.i == str.len);
    try std.testing.expect(result.?.code_point == 0x1F1ED); // Regional Indicator "H"
    try std.testing.expect(result.?.is_break == true);

    try std.testing.expect(it.peekCodePoint() == null);
    try std.testing.expect(it.nextCodePoint() == null);
    try std.testing.expect(it.nextCodePoint() == null);
}

// This is a copy of `computeGraphemeBreak` from `src/grapheme.zig` but with
// the rules for `control`, `cr`, and `lf` ignored, since
// `grapheme_break_no_control` maps them to `other` as these are assumed to
// have been been handled prior or stripped from the input.
pub fn computeGraphemeBreakNoControl(
    gb1: types_x.GraphemeBreakNoControl,
    gb2: types_x.GraphemeBreakNoControl,
    state: *uucode.grapheme.BreakState,
) bool {
    // Set state back to default when `gb1` or `gb2` is not expected in sequence.
    switch (state.*) {
        .regional_indicator => {
            if (gb1 != .regional_indicator or gb2 != .regional_indicator) {
                state.* = .default;
            }
        },
        .extended_pictographic => {
            switch (gb1) {
                // Keep state if in possibly valid sequence
                .indic_conjunct_break_extend, // extend
                .indic_conjunct_break_linker, // extend
                .zwnj, // extend
                .zwj,
                .extended_pictographic,
                .emoji_modifier_base,
                .emoji_modifier,
                => {},

                else => state.* = .default,
            }

            switch (gb2) {
                // Keep state if in possibly valid sequence
                .indic_conjunct_break_extend, // extend
                .indic_conjunct_break_linker, // extend
                .zwnj, // extend
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
                // Keep state if in possibly valid sequence
                .indic_conjunct_break_consonant,
                .indic_conjunct_break_linker,
                .indic_conjunct_break_extend,
                .zwj, // indic_conjunct_break_extend
                => {},

                else => state.* = .default,
            }

            switch (gb2) {
                // Keep state if in possibly valid sequence
                .indic_conjunct_break_consonant,
                .indic_conjunct_break_linker,
                .indic_conjunct_break_extend,
                .zwj, // indic_conjunct_break_extend
                => {},

                else => state.* = .default,
            }
        },
        .default => {},
    }

    // GB3: CR x LF
    //if (gb1 == .cr and gb2 == .lf) return false;

    // GB4: Control
    //if (gb1 == .control or gb1 == .cr or gb1 == .lf) return true;

    // GB5: Control
    //if (gb2 == .control or gb2 == .cr or gb2 == .lf) return true;

    // GB6: L x (L | V | LV | VT)
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

    // GB9c: Indic
    if (gb1 == .indic_conjunct_break_consonant) {
        // start of sequence:

        // In normal operation, we'll be in this state, but
        // buildGraphemeBreakTable iterates all states.
        //std.debug.assert(state.* == .default);

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
        // consonant state:

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
        // linker state:

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
        // start of sequence:

        // In normal operation, we'll be in this state, but
        // buildGraphemeBreakTable iterates all states.
        // std.debug.assert(state.* == .default);

        if (isExtend(gb2) or gb2 == .zwj) {
            state.* = .extended_pictographic;
            return false;
        }

        // The `emoji_modifier_sequence` case is described in the comment for
        // `isExtend` above, from UTS #51.
        if (gb1 == .emoji_modifier_base and gb2 == .emoji_modifier) {
            state.* = .extended_pictographic;
            return false;
        }

        // else, not an Emoji ZWJ sequence
    } else if (state.* == .extended_pictographic) {
        // continue or end sequence:

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

fn isIndicConjunctBreakExtend(gb: types_x.GraphemeBreakNoControl) bool {
    return gb == .indic_conjunct_break_extend or gb == .zwj;
}

// Despite `emoji_modifier` being `extend` according to
// GraphemeBreakProperty.txt and UAX #29 (in addition to tests in
// GraphemeBreakTest.txt), UTS #51 states: `emoji_modifier_sequence :=
// emoji_modifier_base emoji_modifier` in ED-13 (emoji modifier sequence) under
// 1.4.4 (Emoji Modifiers), and: "When used alone, the default representation
// of these modifier characters is a color swatch... To have an effect on an
// emoji, an emoji modifier must immediately follow that base emoji
// character." in 2.4 (Diversity). Additionally it states "Skin tone
// modifiers and hair components should be
// displayed even in isolation" in ED-20 (basic emoji set) under 1.4.6 (Emoji
// Sets). See this revision of UAX #29 when the grapheme cluster break
// properties were simplified to remove `E_Base` and `E_Modifier`:
// http://www.unicode.org/reports/tr29/tr29-32.html
// Here we decide to diverge from the grapheme break spec, which is allowed
// under "tailored" grapheme clusters.
fn isExtend(gb: types_x.GraphemeBreakNoControl) bool {
    return gb == .zwnj or
        gb == .indic_conjunct_break_extend or
        gb == .indic_conjunct_break_linker;
}

fn isExtendedPictographic(gb: types_x.GraphemeBreakNoControl) bool {
    return gb == .extended_pictographic or gb == .emoji_modifier_base;
}

fn testGraphemeBreakNoControl(getActualIsBreak: fn (cp1: u21, cp2: u21, state: *uucode.grapheme.BreakState) bool) !void {
    const Ucd = @import("../build/Ucd.zig");

    const trim = Ucd.trim;
    const parseCp = Ucd.parseCp;

    const allocator = std.testing.allocator;
    const file_path = "ucd/auxiliary/GraphemeBreakTest.txt";

    const file = try std.fs.cwd().openFile(file_path, .{});
    defer file.close();

    const content = try file.readToEndAlloc(allocator, 1024 * 1024 * 10);
    defer allocator.free(content);

    var lines = std.mem.splitScalar(u8, content, '\n');
    var success = true;

    var line_num: usize = 1;

    line_loop: while (lines.next()) |line| : (line_num += 1) {
        const trimmed = trim(line);
        if (trimmed.len == 0) continue;

        var parts = std.mem.splitScalar(u8, trimmed, ' ');
        const start = parts.next().?;
        try std.testing.expect(std.mem.eql(u8, start, "÷"));

        var state: uucode.grapheme.BreakState = .default;
        var cp1 = try parseCp(parts.next().?);
        var expected_str = parts.next().?;
        var cp2 = try parseCp(parts.next().?);

        const original_gb1 = uucode.get(.grapheme_break, cp1);
        var original_gb2 = uucode.get(.grapheme_break, cp2);
        if (original_gb1 == .control or
            original_gb1 == .cr or
            original_gb1 == .lf or
            original_gb2 == .control or
            original_gb2 == .cr or
            original_gb2 == .lf) continue :line_loop;

        var gb1 = uucode.get(.grapheme_break_no_control, cp1);
        var gb2 = uucode.get(.grapheme_break_no_control, cp2);
        var next_expected_str = parts.next().?;

        while (true) {
            var expected_is_break = std.mem.eql(u8, expected_str, "÷");
            const actual_is_break = getActualIsBreak(cp1, cp2, &state);
            try std.testing.expect(expected_is_break or std.mem.eql(u8, expected_str, "×"));
            // GraphemeBreakTest.txt has tests for UAX #29 treating emoji
            // modifier as extend, always, but we diverge from that (see
            // comment above `isExtend`).
            if (gb2 == .emoji_modifier and gb1 != .emoji_modifier_base) {
                std.debug.assert(!expected_is_break);
                expected_is_break = true;
            }
            if (actual_is_break != expected_is_break) {
                std.log.err("line={d} cp1={x}, cp2={x}: gb1={}, gb2={}, state={}, expected={}, actual={}", .{
                    line_num,
                    cp1,
                    cp2,
                    gb1,
                    gb2,
                    state,
                    expected_is_break,
                    actual_is_break,
                });
                success = false;
            }

            if (parts.peek() == null) break;

            cp1 = cp2;
            gb1 = gb2;
            expected_str = next_expected_str;
            cp2 = try parseCp(parts.next().?);
            original_gb2 = uucode.get(.grapheme_break, cp2);
            if (original_gb2 == .control or
                original_gb2 == .cr or
                original_gb2 == .lf) continue :line_loop;

            gb2 = uucode.get(.grapheme_break_no_control, cp2);
            next_expected_str = parts.next().?;
        }

        try std.testing.expect(std.mem.eql(u8, next_expected_str, "÷"));
    }

    try std.testing.expect(success);
}

fn testGetActualComputedGraphemeBreakNoControl(cp1: u21, cp2: u21, state: *uucode.grapheme.BreakState) bool {
    const gb1 = uucode.get(.grapheme_break_no_control, cp1);
    const gb2 = uucode.get(.grapheme_break_no_control, cp2);
    return computeGraphemeBreakNoControl(gb1, gb2, state);
}

test "GraphemeBreakTest.txt - x.computeGraphemeBreakNoControl" {
    try testGraphemeBreakNoControl(testGetActualComputedGraphemeBreakNoControl);
}

pub fn precomputedGraphemeBreakNoControl(
    gb1: types_x.GraphemeBreakNoControl,
    gb2: types_x.GraphemeBreakNoControl,
    state: *uucode.grapheme.BreakState,
) bool {
    const table = comptime uucode.grapheme.buildGraphemeBreakTable(
        types_x.GraphemeBreakNoControl,
        uucode.grapheme.BreakState,
        computeGraphemeBreakNoControl,
    );
    // 5 BreakState fields x (17 GraphemeBreak fields)^2 = 1445
    std.debug.assert(@sizeOf(@TypeOf(table)) == 1445);
    const result = table.get(gb1, gb2, state.*);
    state.* = result.state;
    return result.result;
}

pub fn isBreakNoControl(
    cp1: u21,
    cp2: u21,
    state: *uucode.grapheme.BreakState,
) bool {
    const gb1 = uucode.get(.grapheme_break_no_control, cp1);
    const gb2 = uucode.get(.grapheme_break_no_control, cp2);
    return precomputedGraphemeBreakNoControl(gb1, gb2, state);
}

test "GraphemeBreakTest.txt - x.isBreakNoControl" {
    try testGraphemeBreakNoControl(isBreakNoControl);
}

const std = @import("std");
const types_x = @import("./types.x.zig");
const uucode = @import("../root.zig");
