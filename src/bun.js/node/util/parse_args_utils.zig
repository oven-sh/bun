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
/// ```zig
/// findOptionByShortName('a', {}) // returns 'a'
/// findOptionByShortName('b', {
///   options: { bar: { short: 'b' } }
/// }) // returns "bar"
/// ```
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

const bun = @import("bun");
const String = bun.String;
const JSValue = bun.jsc.JSValue;
