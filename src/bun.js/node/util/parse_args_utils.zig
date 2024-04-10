const std = @import("std");
const bun = @import("root").bun;
const testing = std.testing;
const String = if (@import("builtin").is_test) TestString else bun.String;
const JSValue = if (@import("builtin").is_test) usize else bun.JSC.JSValue;

pub const OptionValueType = enum { boolean, string };

/// Metadata of an option known to the args parser,
/// i.e. the values passed to `parseArgs(..., { options: <values> })`
pub const OptionDefinition = struct {
    // e.g. "abc" for --abc
    long_name: String,

    /// e.g. "a" for -a
    /// if len is 0, it has no short name
    short_name: String = String.empty,

    type: OptionValueType = .boolean,

    multiple: bool = false,

    default_value: ?JSValue = null,
};

pub const TokenSubtype = enum {
    /// '--'
    option_terminator,
    /// e.g. '-f'
    lone_short_option,
    /// e.g. '-fXzy'
    short_option_group,
    /// e.g. '-fFILE'
    short_option_and_value,
    /// e.g. '--foo'
    lone_long_option,
    /// e.g. '--foo=barconst'
    long_option_and_value,

    positional,
};

pub inline fn classifyToken(arg: String, options: []const OptionDefinition) TokenSubtype {
    const len = arg.length();

    if (len == 2) {
        if (arg.hasPrefixComptime("-")) {
            return if (arg.hasPrefixComptime("--")) .option_terminator else .lone_short_option;
        }
    } else if (len > 2) {
        if (arg.hasPrefixComptime("--")) {
            return if ((arg.indexOfAsciiChar('=') orelse 0) >= 3) .long_option_and_value else .lone_long_option;
        } else if (arg.hasPrefixComptime("-")) {
            const first_char = arg.substringWithLen(1, 2);
            const option_idx = findOptionByShortName(first_char, options);
            if (option_idx) |i| {
                return if (options[i].type == .string) .short_option_and_value else return .short_option_group;
            } else {
                return .short_option_group;
            }
        }
    }

    return .positional;
}

/// Detect whether there is possible confusion and user may have omitted
/// the option argument, like `--port --verbose` when `port` of type:string.
/// In strict mode we throw errors if value is option-like.
pub fn isOptionLikeValue(value: String) bool {
    return value.length() > 1 and value.hasPrefixComptime("-");
}

/// Find the long option associated with a short option. Looks for a configured
/// `short` and returns the short option itself if a long option is not found.
/// Example:
/// findOptionByShortName('a', {}) // returns 'a'
/// findOptionByShortName('b', {
///   options: { bar: { short: 'b' } }
/// }) // returns "bar"
pub fn findOptionByShortName(short_name: String, options: []const OptionDefinition) ?usize {
    var long_option_index: ?usize = null;
    for (options, 0..) |option, i| {
        if (short_name.eql(option.short_name)) {
            return i;
        }
        if (option.long_name.length() == 1 and short_name.eql(option.long_name)) {
            long_option_index = i;
        }
    }
    return long_option_index;
}

//
// TESTS
//

var no_options: []const OptionDefinition = &[_]OptionDefinition{};

/// Used only for tests, as lightweight substitute for bun.String
const TestString = struct {
    str: []const u8,
    fn length(this: TestString) usize {
        return this.str.len;
    }
    fn hasPrefixComptime(this: TestString, comptime prefix: []const u8) bool {
        return std.mem.startsWith(u8, this.str, prefix);
    }
    fn charAtU8(this: TestString, i: usize) u8 {
        return this.str[i];
    }
    fn indexOfCharU8(this: TestString, chr: u8) ?usize {
        return std.mem.indexOfScalar(u8, this.str, chr);
    }
};
fn s(str: []const u8) TestString {
    return TestString{ .str = str };
}

//
// misc
//

test "classifyToken: is option terminator" {
    try testing.expectEqual(classifyToken(s("--"), no_options), .option_terminator);
}

test "classifyToken: is positional" {
    try testing.expectEqual(classifyToken(s("abc"), no_options), .positional);
}

//
// isLoneLongOption
//

pub fn isLoneLongOption(value: String) bool {
    return classifyToken(value, no_options) == .lone_long_option;
}

test "isLoneLongOption: when passed short option then returns false" {
    try testing.expectEqual(isLoneLongOption(s("-s")), false);
}

test "isLoneLongOption: when passed short option group then returns false" {
    try testing.expectEqual(isLoneLongOption(s("-abc")), false);
}

test "isLoneLongOption: when passed lone long option then returns true" {
    try testing.expectEqual(isLoneLongOption(s("--foo")), true);
}

test "isLoneLongOption: when passed single character long option then returns true" {
    try testing.expectEqual(isLoneLongOption(s("--f")), true);
}

test "isLoneLongOption: when passed long option and value then returns false" {
    try testing.expectEqual(isLoneLongOption(s("--foo=bar")), false);
}

test "isLoneLongOption: when passed empty string then returns false" {
    try testing.expectEqual(isLoneLongOption(s("")), false);
}

test "isLoneLongOption: when passed plain text then returns false" {
    try testing.expectEqual(isLoneLongOption(s("foo")), false);
}

test "isLoneLongOption: when passed single dash then returns false" {
    try testing.expectEqual(isLoneLongOption(s("-")), false);
}

test "isLoneLongOption: when passed double dash then returns false" {
    try testing.expectEqual(isLoneLongOption(s("--")), false);
}

// This is a bit bogus, but simple consistent behaviour: long option follows double dash.
test "isLoneLongOption: when passed arg starting with triple dash then returns true" {
    try testing.expectEqual(isLoneLongOption(s("---foo")), true);
}

// This is a bit bogus, but simple consistent behaviour: long option follows double dash.
test "isLoneLongOption: when passed '--=' then returns true" {
    try testing.expectEqual(isLoneLongOption(s("--=")), true);
}

//
// isLoneShortOption
//

pub fn isLoneShortOption(value: String) bool {
    return classifyToken(value, no_options) == .lone_short_option;
}

test "isLoneShortOption: when passed short option then returns true" {
    try testing.expectEqual(isLoneShortOption(s("-s")), true);
}

test "isLoneShortOption: when passed short option group (or might be short and value) then returns false" {
    try testing.expectEqual(isLoneShortOption(s("-abc")), false);
}

test "isLoneShortOption: when passed long option then returns false" {
    try testing.expectEqual(isLoneShortOption(s("--foo")), false);
}

test "isLoneShortOption: when passed long option with value then returns false" {
    try testing.expectEqual(isLoneShortOption(s("--foo=bar")), false);
}

test "isLoneShortOption: when passed empty string then returns false" {
    try testing.expectEqual(isLoneShortOption(s("")), false);
}

test "isLoneShortOption: when passed plain text then returns false" {
    try testing.expectEqual(isLoneShortOption(s("foo")), false);
}

test "isLoneShortOption: when passed single dash then returns false" {
    try testing.expectEqual(isLoneShortOption(s("-")), false);
}

test "isLoneShortOption: when passed double dash then returns false" {
    try testing.expectEqual(isLoneShortOption(s("--")), false);
}

//
// isLongOptionAndValue
//

pub fn isLongOptionAndValue(value: String) bool {
    return classifyToken(value, no_options) == .long_option_and_value;
}

test "isLongOptionAndValue: when passed short option then returns false" {
    try testing.expectEqual(isLongOptionAndValue(s("-s")), false);
}

test "isLongOptionAndValue: when passed short option group then returns false" {
    try testing.expectEqual(isLongOptionAndValue(s("-abc")), false);
}

test "isLongOptionAndValue: when passed lone long option then returns false" {
    try testing.expectEqual(isLongOptionAndValue(s("--foo")), false);
}

test "isLongOptionAndValue: when passed long option and value then returns true" {
    try testing.expectEqual(isLongOptionAndValue(s("--foo=bar")), true);
}

test "isLongOptionAndValue: when passed single character long option and value then returns true" {
    try testing.expectEqual(isLongOptionAndValue(s("--f=bar")), true);
}

test "isLongOptionAndValue: when passed empty string then returns false" {
    try testing.expectEqual(isLongOptionAndValue(s("")), false);
}

test "isLongOptionAndValue: when passed plain text then returns false" {
    try testing.expectEqual(isLongOptionAndValue(s("foo")), false);
}

test "isLongOptionAndValue: when passed single dash then returns false" {
    try testing.expectEqual(isLongOptionAndValue(s("-")), false);
}

test "isLongOptionAndValue: when passed double dash then returns false" {
    try testing.expectEqual(isLongOptionAndValue(s("--")), false);
}

// This is a bit bogus, but simple consistent behaviour: long option follows double dash.
test "isLongOptionAndValue: when passed arg starting with triple dash and value then returns true" {
    try testing.expectEqual(isLongOptionAndValue(s("---foo=bar")), true);
}

// This is a bit bogus, but simple consistent behaviour: long option follows double dash.
test "isLongOptionAndValue: when passed '--=' then returns false" {
    try testing.expectEqual(isLongOptionAndValue(s("--=")), false);
}

//
// isOptionLikeValue
//
// Basically rejecting values starting with a dash, but run through the interesting possibilities.

test "isOptionLikeValue: when passed plain text then returns false" {
    try testing.expectEqual(isOptionLikeValue(s("abc")), false);
}

//test "isOptionLikeValue: when passed digits then returns false" {
//    try testing.expectEqual(isOptionLikeValue(123), false);
//}

test "isOptionLikeValue: when passed empty string then returns false" {
    try testing.expectEqual(isOptionLikeValue(s("")), false);
}

// Special case, used as stdin/stdout et al and not reason to reject
test "isOptionLikeValue: when passed dash then returns false" {
    try testing.expectEqual(isOptionLikeValue(s("-")), false);
}

test "isOptionLikeValue: when passed -- then returns true" {
    // Not strictly option-like, but is supect
    try testing.expectEqual(isOptionLikeValue(s("--")), true);
}

// Supporting undefined so can pass element off end of array without checking
//test "isOptionLikeValue: when passed undefined then returns false" {
//    try testing.expectEqual(isOptionLikeValue(undefined), false);
//}

test "isOptionLikeValue: when passed short option then returns true" {
    try testing.expectEqual(isOptionLikeValue(s("-a")), true);
}

test "isOptionLikeValue: when passed short option digit then returns true" {
    try testing.expectEqual(isOptionLikeValue(s("-1")), true);
}

test "isOptionLikeValue: when passed negative number then returns true" {
    try testing.expectEqual(isOptionLikeValue(s("-123")), true);
}

test "isOptionLikeValue: when passed short option group of short option with value then returns true" {
    try testing.expectEqual(isOptionLikeValue(s("-abd")), true);
}

test "isOptionLikeValue: when passed long option then returns true" {
    try testing.expectEqual(isOptionLikeValue(s("--foo")), true);
}

test "isOptionLikeValue: when passed long option with value then returns true" {
    try testing.expectEqual(isOptionLikeValue(s("--foo=bar")), true);
}

//
// isShortOptionAndValue
//

pub fn isShortOptionAndValue(value: String, options: []const OptionDefinition) bool {
    return classifyToken(value, options) == .short_option_and_value;
}

test "isShortOptionAndValue: when passed lone short option then returns false" {
    try testing.expectEqual(isShortOptionAndValue(s("-s"), no_options), false);
}

test "isShortOptionAndValue: when passed group with leading zero-config boolean then returns false" {
    try testing.expectEqual(isShortOptionAndValue(s("-ab"), no_options), false);
}

test "isShortOptionAndValue: when passed group with leading configured implicit boolean then returns false" {
    const options = &[_]OptionDefinition{.{ .long_name = s("aaa"), .short_name = 'a' }};
    try testing.expectEqual(isShortOptionAndValue(s("-ab"), options), false);
}

test "isShortOptionAndValue: when passed group with leading configured explicit boolean then returns false" {
    const options = &[_]OptionDefinition{.{ .long_name = s("aaa"), .short_name = 'a', .type = .boolean }};
    try testing.expectEqual(isShortOptionAndValue(s("-ab"), options), false);
}

test "isShortOptionAndValue: when passed group with leading configured string then returns true" {
    const options = &[_]OptionDefinition{.{ .long_name = s("aaa"), .short_name = 'a', .type = .string }};
    try testing.expectEqual(isShortOptionAndValue(s("-ab"), options), true);
}

test "isShortOptionAndValue: when passed long option then returns false" {
    try testing.expectEqual(isShortOptionAndValue(s("--foo"), no_options), false);
}

test "isShortOptionAndValue: when passed long option with value then returns false" {
    try testing.expectEqual(isShortOptionAndValue(s("--foo=bar"), no_options), false);
}

test "isShortOptionAndValue: when passed empty string then returns false" {
    try testing.expectEqual(isShortOptionAndValue(s(""), no_options), false);
}

test "isShortOptionAndValue: when passed plain text then returns false" {
    try testing.expectEqual(isShortOptionAndValue(s("foo"), no_options), false);
}

test "isShortOptionAndValue: when passed single dash then returns false" {
    try testing.expectEqual(isShortOptionAndValue(s("-"), no_options), false);
}

test "isShortOptionAndValue: when passed double dash then returns false" {
    try testing.expectEqual(isShortOptionAndValue(s("--"), no_options), false);
}

//
// isShortOptionGroup
//

pub fn isShortOptionGroup(value: String, options: []const OptionDefinition) bool {
    return classifyToken(value, options) == .short_option_group;
}

test "isShortOptionGroup: when passed lone short option then returns false" {
    try testing.expectEqual(isShortOptionGroup(s("-s"), no_options), false);
}

test "isShortOptionGroup: when passed group with leading zero-config boolean then returns true" {
    try testing.expectEqual(isShortOptionGroup(s("-ab"), no_options), true);
}

test "isShortOptionGroup: when passed group with leading configured implicit boolean then returns true" {
    const options = &[_]OptionDefinition{.{ .long_name = s("aaa"), .short_name = 'a' }};
    try testing.expectEqual(isShortOptionGroup(s("-ab"), options), true);
}

test "isShortOptionGroup: when passed group with leading configured explicit boolean then returns true" {
    const options = &[_]OptionDefinition{.{ .long_name = s("aaa"), .short_name = 'a', .type = .boolean }};
    try testing.expectEqual(isShortOptionGroup(s("-ab"), options), true);
}

test "isShortOptionGroup: when passed group with leading configured string then returns false" {
    const options = &[_]OptionDefinition{.{ .long_name = s("aaa"), .short_name = 'a', .type = .string }};
    try testing.expectEqual(isShortOptionGroup(s("-ab"), options), false);
}

test "isShortOptionGroup: when passed group with trailing configured string then returns true" {
    const options = &[_]OptionDefinition{.{ .long_name = s("bbb"), .short_name = 'b', .type = .string }};
    try testing.expectEqual(isShortOptionGroup(s("-ab"), options), true);
}

// This one is dubious, but leave it to caller to handle.
test "isShortOptionGroup: when passed group with middle configured string then returns true" {
    const options = &[_]OptionDefinition{.{ .long_name = s("bbb"), .short_name = 'b', .type = .string }};
    try testing.expectEqual(isShortOptionGroup(s("-abc"), options), true);
}

test "isShortOptionGroup: when passed long option then returns false" {
    try testing.expectEqual(isShortOptionGroup(s("--foo"), no_options), false);
}

test "isShortOptionGroup: when passed long option with value then returns false" {
    try testing.expectEqual(isShortOptionGroup(s("--foo=bar"), no_options), false);
}

test "isShortOptionGroup: when passed empty string then returns false" {
    try testing.expectEqual(isShortOptionGroup(s(""), no_options), false);
}

test "isShortOptionGroup: when passed plain text then returns false" {
    try testing.expectEqual(isShortOptionGroup(s("foo"), no_options), false);
}

test "isShortOptionGroup: when passed single dash then returns false" {
    try testing.expectEqual(isShortOptionGroup(s("-"), no_options), false);
}

test "isShortOptionGroup: when passed double dash then returns false" {
    try testing.expectEqual(isShortOptionGroup(s("--"), no_options), false);
}
