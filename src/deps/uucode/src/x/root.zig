pub const types = @import("./types.x.zig");
pub const grapheme = @import("./grapheme.zig");

test {
    std.testing.refAllDeclsRecursive(@This());
}

// wcwidth tests

test "wcwidth_standalone control characters are width 0" {
    const get = @import("./get.zig").get;
    try testing.expectEqual(@as(u2, 0), get(.wcwidth_standalone, 0x0000)); // NULL (C0)
    try testing.expectEqual(@as(u2, 0), get(.wcwidth_standalone, 0x001F)); // UNIT SEPARATOR (C0)
    try testing.expectEqual(@as(u2, 0), get(.wcwidth_standalone, 0x007F)); // DELETE (C0)
    try testing.expectEqual(@as(u2, 0), get(.wcwidth_standalone, 0x0080)); // C1 control
    try testing.expectEqual(@as(u2, 0), get(.wcwidth_standalone, 0x009F)); // C1 control
}

test "wcwidth_standalone surrogates are width 0" {
    const get = @import("./get.zig").get;
    try testing.expectEqual(@as(u2, 0), get(.wcwidth_standalone, 0xD800)); // High surrogate start
    try testing.expectEqual(@as(u2, 0), get(.wcwidth_standalone, 0xDBFF)); // High surrogate end
    try testing.expectEqual(@as(u2, 0), get(.wcwidth_standalone, 0xDC00)); // Low surrogate start
    try testing.expectEqual(@as(u2, 0), get(.wcwidth_standalone, 0xDFFF)); // Low surrogate end
}

test "wcwidth_standalone line and paragraph separators are width 0" {
    const get = @import("./get.zig").get;
    try testing.expectEqual(@as(u2, 0), get(.wcwidth_standalone, 0x2028)); // LINE SEPARATOR (Zl)
    try testing.expectEqual(@as(u2, 0), get(.wcwidth_standalone, 0x2029)); // PARAGRAPH SEPARATOR (Zp)
}

test "wcwidth_standalone default ignorable characters are width 0" {
    const get = @import("./get.zig").get;
    try testing.expectEqual(@as(u2, 0), get(.wcwidth_standalone, 0x200B)); // ZERO WIDTH SPACE
    try testing.expectEqual(@as(u2, 0), get(.wcwidth_standalone, 0x200C)); // ZERO WIDTH NON-JOINER (ZWNJ)
    try testing.expectEqual(@as(u2, 0), get(.wcwidth_standalone, 0x200D)); // ZERO WIDTH JOINER (ZWJ)
    try testing.expectEqual(@as(u2, 0), get(.wcwidth_standalone, 0xFE00)); // VARIATION SELECTOR-1
    try testing.expectEqual(@as(u2, 0), get(.wcwidth_standalone, 0xFE0F)); // VARIATION SELECTOR-16
    try testing.expectEqual(@as(u2, 0), get(.wcwidth_standalone, 0xFEFF)); // ZERO WIDTH NO-BREAK SPACE
}

test "wcwidth_standalone soft hyphen exception is width 1" {
    const get = @import("./get.zig").get;
    try testing.expectEqual(@as(u2, 1), get(.wcwidth_standalone, 0x00AD)); // SOFT HYPHEN
}

test "wcwidth_standalone combining marks are width 1" {
    const get = @import("./get.zig").get;
    try testing.expectEqual(@as(u2, 1), get(.wcwidth_standalone, 0x0300)); // COMBINING GRAVE ACCENT (Mn)
    try testing.expectEqual(@as(u2, 1), get(.wcwidth_standalone, 0x0903)); // DEVANAGARI SIGN VISARGA (Mc)
    try testing.expectEqual(@as(u2, 1), get(.wcwidth_standalone, 0x20DD)); // COMBINING ENCLOSING CIRCLE (Me)
}

test "wcwidth_zero_in_grapheme combining marks" {
    const get = @import("./get.zig").get;
    // mark_nonspacing (Mn) are true
    try testing.expect(get(.wcwidth_zero_in_grapheme, 0x0300)); // COMBINING GRAVE ACCENT (Mn)
    try testing.expect(get(.wcwidth_zero_in_grapheme, 0x0341)); // COMBINING GREEK PERISPOMENI (Mn)
    // mark_enclosing (Me) are true
    try testing.expect(get(.wcwidth_zero_in_grapheme, 0x20DD)); // COMBINING ENCLOSING CIRCLE (Me)
    try testing.expect(get(.wcwidth_zero_in_grapheme, 0x20DE)); // COMBINING ENCLOSING SQUARE (Me)
    // mark_spacing_combining (Mc) follow EAW - Neutral=1, so false
    try testing.expect(!get(.wcwidth_zero_in_grapheme, 0x0903)); // DEVANAGARI SIGN VISARGA (Mc, N)
    try testing.expect(!get(.wcwidth_zero_in_grapheme, 0x093E)); // DEVANAGARI VOWEL SIGN AA (Mc, N)
    // mark_spacing_combining with EAW=Wide are width 2, so false
    try testing.expect(!get(.wcwidth_zero_in_grapheme, 0x302E)); // HANGUL SINGLE DOT TONE MARK (Mc, W)
    try testing.expect(!get(.wcwidth_zero_in_grapheme, 0x302F)); // HANGUL DOUBLE DOT TONE MARK (Mc, W)
    try testing.expect(!get(.wcwidth_zero_in_grapheme, 0x16FF0)); // VIETNAMESE ALTERNATE READING MARK CA (Mc, W)
    try testing.expect(!get(.wcwidth_zero_in_grapheme, 0x16FF1)); // VIETNAMESE ALTERNATE READING MARK NHAY (Mc, W)
}

test "wcwidth_standalone combining enclosing keycap exception is width 2" {
    const get = @import("./get.zig").get;
    try testing.expectEqual(@as(u2, 2), get(.wcwidth_standalone, 0x20E3)); // COMBINING ENCLOSING KEYCAP
}

test "wcwidth_zero_in_grapheme combining enclosing keycap exception is true" {
    const get = @import("./get.zig").get;
    try testing.expect(get(.wcwidth_zero_in_grapheme, 0x20E3)); // COMBINING ENCLOSING KEYCAP
}

test "wcwidth_standalone regional indicators are width 2" {
    const get = @import("./get.zig").get;
    try testing.expectEqual(@as(u2, 2), get(.wcwidth_standalone, 0x1F1E6)); // Regional Indicator A
    try testing.expectEqual(@as(u2, 2), get(.wcwidth_standalone, 0x1F1FA)); // Regional Indicator U
    try testing.expectEqual(@as(u2, 2), get(.wcwidth_standalone, 0x1F1F8)); // Regional Indicator S
    try testing.expectEqual(@as(u2, 2), get(.wcwidth_standalone, 0x1F1FF)); // Regional Indicator Z
}

test "wcwidth_standalone em dashes have special widths" {
    const get = @import("./get.zig").get;
    try testing.expectEqual(@as(u2, 2), get(.wcwidth_standalone, 0x2E3A)); // TWO-EM DASH
    try testing.expectEqual(@as(u2, 3), get(.wcwidth_standalone, 0x2E3B)); // THREE-EM DASH
}

test "wcwidth_standalone ambiguous width characters are width 1" {
    const get = @import("./get.zig").get;
    try testing.expectEqual(@as(u2, 1), get(.wcwidth_standalone, 0x00A1)); // INVERTED EXCLAMATION MARK (A)
    try testing.expectEqual(@as(u2, 1), get(.wcwidth_standalone, 0x00B1)); // PLUS-MINUS SIGN (A)
    try testing.expectEqual(@as(u2, 1), get(.wcwidth_standalone, 0x2664)); // WHITE SPADE SUIT (A)
}

test "wcwidth_standalone east asian wide and fullwidth are width 2" {
    const get = @import("./get.zig").get;
    try testing.expectEqual(@as(u2, 2), get(.wcwidth_standalone, 0x3000)); // IDEOGRAPHIC SPACE (F)
    try testing.expectEqual(@as(u2, 2), get(.wcwidth_standalone, 0xFF01)); // FULLWIDTH EXCLAMATION MARK (F)
    try testing.expectEqual(@as(u2, 2), get(.wcwidth_standalone, 0x4E00)); // CJK UNIFIED IDEOGRAPH (W)
    try testing.expectEqual(@as(u2, 2), get(.wcwidth_standalone, 0xAC00)); // HANGUL SYLLABLE (W)
}

test "wcwidth_standalone hangul jamo V and T are width 1" {
    const get = @import("./get.zig").get;
    try testing.expectEqual(@as(u2, 1), get(.wcwidth_standalone, 0x1161)); // HANGUL JUNGSEONG A (V)
    try testing.expectEqual(@as(u2, 1), get(.wcwidth_standalone, 0x11A8)); // HANGUL JONGSEONG KIYEOK (T)
    try testing.expectEqual(@as(u2, 1), get(.wcwidth_standalone, 0xD7B0)); // HANGUL JUNGSEONG O-YEO (V)
    try testing.expectEqual(@as(u2, 1), get(.wcwidth_standalone, 0xD7CB)); // HANGUL JONGSEONG NIEUN-RIEUL (T)
}

test "wcwidth_zero_in_grapheme hangul jamo V and T are true" {
    const get = @import("./get.zig").get;
    try testing.expect(get(.wcwidth_zero_in_grapheme, 0x1161)); // HANGUL JUNGSEONG A (V)
    try testing.expect(get(.wcwidth_zero_in_grapheme, 0x11A8)); // HANGUL JONGSEONG KIYEOK (T)
    try testing.expect(get(.wcwidth_zero_in_grapheme, 0xD7B0)); // HANGUL JUNGSEONG O-YEO (V)
    try testing.expect(get(.wcwidth_zero_in_grapheme, 0xD7CB)); // HANGUL JONGSEONG NIEUN-RIEUL (T)
    try testing.expect(get(.wcwidth_zero_in_grapheme, 0x16D63)); // KIRAT RAI VOWEL SIGN AA (V)
}

test "wcwidth_standalone format characters non-DI are width 1" {
    const get = @import("./get.zig").get;
    try testing.expectEqual(@as(u2, 1), get(.wcwidth_standalone, 0x0600)); // ARABIC NUMBER SIGN (Cf, not DI)
}

test "wcwidth_standalone emoji_modifier is 2" {
    const get = @import("./get.zig").get;
    try testing.expectEqual(@as(u2, 2), get(.wcwidth_standalone, 0x1F3FB)); // 🏻 EMOJI MODIFIER FITZPATRICK TYPE-1-2
    try testing.expectEqual(@as(u2, 2), get(.wcwidth_standalone, 0x1F3FF)); // 🏿 EMOJI MODIFIER FITZPATRICK TYPE-6
}

test "wcwidth_zero_in_grapheme emoji_modifier is true" {
    const get = @import("./get.zig").get;
    try testing.expect(get(.wcwidth_zero_in_grapheme, 0x1F3FB)); // 🏻 EMOJI MODIFIER FITZPATRICK TYPE-1-2
    try testing.expect(get(.wcwidth_zero_in_grapheme, 0x1F3FF)); // 🏿 EMOJI MODIFIER FITZPATRICK TYPE-6
}

const std = @import("std");
const testing = std.testing;
