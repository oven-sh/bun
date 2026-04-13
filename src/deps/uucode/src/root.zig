pub const config = @import("./config.zig");
pub const types = @import("./types.zig");
pub const ascii = @import("./ascii.zig");
pub const grapheme = @import("./grapheme.zig");
pub const utf8 = @import("./utf8.zig");
pub const x = @import("./x/root.zig");

pub const FieldEnum = getpkg.FieldEnum;
pub const TypeOf = getpkg.TypeOf;
pub const TypeOfAll = getpkg.TypeOfAll;
pub const get = getpkg.get;
pub const getAll = getpkg.getAll;

test {
    std.testing.refAllDeclsRecursive(@This());
}

test "name" {
    try testing.expect(std.mem.eql(u8, get(.name, 65), "LATIN CAPITAL LETTER A"));
}

test "is_alphabetic" {
    try testing.expect(get(.is_alphabetic, 65)); // 'A'
    try testing.expect(get(.is_alphabetic, 97)); // 'a'
    try testing.expect(!get(.is_alphabetic, 0));
}

test "case_folding_simple" {
    try testing.expectEqual(97, get(.case_folding_simple, 65)); // 'a'
    try testing.expectEqual(97, get(.case_folding_simple, 97)); // 'a'
}

test "simple_uppercase_mapping" {
    try testing.expectEqual(65, get(.simple_uppercase_mapping, 97)); // 'a'
    try testing.expectEqual(null, get(.simple_uppercase_mapping, 65)); // 'A'
}

test "generalCategory" {
    try testing.expect(get(.general_category, 65) == .letter_uppercase); // 'A'
}

test "getAll" {
    const d1 = getAll("1", 65);
    try testing.expect(d1.general_category == .letter_uppercase);
    try testing.expect(d1.case_folding_simple.unshift(65) == 97);

    const d_checks = getAll("checks", 65);
    // auto should become packed for these checks
    try testing.expectEqual(.@"packed", @typeInfo(TypeOfAll("checks")).@"struct".layout);
    try testing.expect(d_checks.simple_uppercase_mapping.unshift(65) == null);
    try testing.expect(d_checks.is_alphabetic);
    try testing.expect(d_checks.is_uppercase);
    try testing.expect(!d_checks.is_lowercase);
}

test "get extension foo" {
    try testing.expectEqual(0, get(.foo, 65));
    try testing.expectEqual(3, get(.foo, 0));
}

test "get extension emoji_odd_or_even" {
    try testing.expectEqual(.odd_emoji, get(.emoji_odd_or_even, 0x1F34B)); // 🍋
}

test "get packed optional enum works" {
    try testing.expectEqual(.odd_emoji, get(.opt_emoji_odd_or_even, 0x1F34B)); // 🍋
    try testing.expectEqual(null, get(.opt_emoji_odd_or_even, 0x01D8)); // ǘ
}

test "get packed optional bool works" {
    try testing.expectEqual(true, get(.maybe_bit, 0x1200));
    try testing.expectEqual(false, get(.maybe_bit, 0x1235));
    try testing.expectEqual(null, get(.maybe_bit, 0x1236));
}

test "get union unpacked, shift" {
    try testing.expectEqual(@as(u21, 0x1234), get(.next_or_prev, 0x1233).next);
    try testing.expectEqual(@as(u21, 0x1200), get(.next_or_prev, 0x1201).prev);
    try testing.expectEqual(.none, get(.next_or_prev, 0x1235));
}

test "get union unpacked, direct" {
    try testing.expectEqual(@as(u21, 0x1234), get(.next_or_prev_direct, 0x1233).next);
    try testing.expectEqual(@as(u21, 0x1200), get(.next_or_prev_direct, 0x1201).prev);
    try testing.expectEqual(.none, get(.next_or_prev_direct, 0x1235));
}

test "get union packed, shift" {
    try testing.expectEqual(5, @bitSizeOf(@FieldType(TypeOfAll("pack"), "bidi_paired_bracket")));
    try testing.expectEqual(@as(u21, 0x0029), get(.bidi_paired_bracket, 0x0028).open);
    try testing.expectEqual(@as(u21, 0x2997), get(.bidi_paired_bracket, 0x2998).close);
    try testing.expectEqual(.none, get(.bidi_paired_bracket, 0x4000));
}

test "get union packed, direct" {
    try testing.expectEqual(@as(u21, 0x0029), get(.bidi_paired_bracket_direct, 0x0028).open);
    try testing.expectEqual(@as(u21, 0x2997), get(.bidi_paired_bracket_direct, 0x2998).close);
    try testing.expectEqual(.none, get(.bidi_paired_bracket_direct, 0x4000));
}

test "special_casing_condition" {
    const conditions1 = get(.special_casing_condition, 65); // 'A'
    try testing.expectEqual(0, conditions1.len);

    // Greek Capital Sigma (U+03A3) which has Final_Sigma condition
    const conditions = get(.special_casing_condition, 0x03A3);
    try testing.expectEqual(1, conditions.len);
    try testing.expectEqual(types.SpecialCasingCondition.final_sigma, conditions[0]);
}

test "special_lowercase_mapping" {
    var buffer: [1]u21 = undefined;

    // Greek Capital Sigma (U+03A3) which has Final_Sigma condition
    const mapping = get(.special_lowercase_mapping, 0x03A3).with(&buffer, 0x03A3);
    try testing.expectEqual(1, mapping.len);
    try testing.expectEqual(0x03C2, mapping[0]); // Should map to Greek Small Letter Final Sigma
}

test "info extension" {
    // ǰ -> J
    try testing.expectEqual(0x004A, get(.uppercase_mapping_first_char, 0x01F0));

    try testing.expect(get(.has_simple_lowercase, 0x1FD9)); // Ῑ
    try testing.expect(!get(.has_simple_lowercase, 0x1FE0)); // ῠ

    // MALAYALAM FRACTION ONE ONE-HUNDRED-AND-SIXTIETH
    try testing.expect(std.mem.eql(u8, "061/1", get(.numeric_value_numeric_reversed, 0x0D58)));
}

test "is_emoji_vs_base" {
    try testing.expect(get(.is_emoji_vs_base, 0x231B)); // ⌛
    try testing.expect(get(.is_emoji_vs_base, 0x1F327)); // 🌧
    try testing.expect(!get(.is_emoji_vs_base, 0x1F46C)); // 👬
}

const getpkg = @import("./get.zig");

const std = @import("std");
const testing = std.testing;
