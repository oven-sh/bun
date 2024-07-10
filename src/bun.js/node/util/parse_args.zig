const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const strings = bun.strings;
const String = bun.String;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;

const validators = @import("./validators.zig");
const validateArray = validators.validateArray;
const validateBoolean = validators.validateBoolean;
const validateBooleanArray = validators.validateBooleanArray;
const validateObject = validators.validateObject;
const validateString = validators.validateString;
const validateStringArray = validators.validateStringArray;
const validateStringEnum = validators.validateStringEnum;

const utils = @import("./parse_args_utils.zig");
const OptionValueType = utils.OptionValueType;
const OptionDefinition = utils.OptionDefinition;
const findOptionByShortName = utils.findOptionByShortName;
const classifyToken = utils.classifyToken;
const isOptionLikeValue = utils.isOptionLikeValue;

const log = bun.Output.scoped(.parseArgs, true);

const ParseArgsError = error{ParseError};

/// Represents a slice of a JSValue array
const ArgsSlice = struct {
    array: JSValue,
    start: u32,
    end: u32,

    pub inline fn get(this: ArgsSlice, globalThis: *JSGlobalObject, i: u32) JSValue {
        return this.array.getIndex(globalThis, this.start + i);
    }
};

/// Helper ref to either a JSValue or a String,
/// used in order to avoid creating unneeded JSValue as much as possible
const ValueRef = union(Tag) {
    jsvalue: JSValue,
    bunstr: String,

    const Tag = enum { jsvalue, bunstr };

    pub fn asBunString(this: ValueRef, globalObject: *JSGlobalObject) bun.String {
        return switch (this) {
            .jsvalue => |str| str.toBunString(globalObject),
            .bunstr => |str| return str,
        };
    }

    pub fn asJSValue(this: ValueRef, globalObject: *JSGlobalObject) JSValue {
        return switch (this) {
            .jsvalue => |str| str,
            .bunstr => |str| return str.toJS(globalObject),
        };
    }
};

const TokenKind = enum {
    positional,
    option,
    @"option-terminator",

    const COUNT = @typeInfo(TokenKind).Enum.fields.len;
};
const Token = union(TokenKind) {
    positional: struct { index: u32, value: ValueRef },
    option: OptionToken,
    @"option-terminator": struct { index: u32 },
};

const OptionToken = struct {
    index: u32,
    name: ValueRef,
    parse_type: enum {
        lone_short_option,
        short_option_and_value,
        lone_long_option,
        long_option_and_value,
    },
    value: ValueRef,
    inline_value: bool,
    optgroup_idx: ?u32 = null,
    option_idx: ?usize,

    /// The full raw arg string (e.g. "--arg=1").
    /// If the value existed as-is in the input "args" list, it is stored as so, otherwise is null
    raw: ValueRef,

    const RawNameFormatter = struct {
        token: OptionToken,
        globalThis: *JSGlobalObject,

        /// Formats the raw name of the arg (includes any dashes and excludes inline values)
        pub fn format(this: RawNameFormatter, comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
            const token = this.token;
            const raw = token.raw.asBunString(this.globalThis);
            if (token.optgroup_idx) |optgroup_idx| {
                try raw.substringWithLen(optgroup_idx, optgroup_idx + 1).format(fmt, opts, writer);
            } else {
                switch (token.parse_type) {
                    .lone_short_option, .lone_long_option => {
                        try raw.format(fmt, opts, writer);
                    },
                    .short_option_and_value => {
                        var susbtr = raw.substringWithLen(0, 2);
                        try susbtr.format(fmt, opts, writer);
                    },
                    .long_option_and_value => {
                        const equal_index = raw.indexOfAsciiChar('=').?;
                        var substr = raw.substringWithLen(0, equal_index);
                        try substr.format(fmt, opts, writer);
                    },
                }
            }
        }
    };

    /// Returns the raw name of the arg (includes any dashes and excludes inline values), as a JSValue
    fn makeRawNameJSValue(this: OptionToken, globalThis: *JSGlobalObject) JSValue {
        if (this.optgroup_idx) |optgroup_idx| {
            const raw = this.raw.asBunString(globalThis);
            var buf: [8]u8 = undefined;
            const str = std.fmt.bufPrint(&buf, "-{}", .{raw.substringWithLen(optgroup_idx, optgroup_idx + 1)}) catch unreachable;
            return String.fromUTF8(str).toJS(globalThis);
        } else {
            switch (this.parse_type) {
                .lone_short_option, .lone_long_option => {
                    return this.raw.asJSValue(globalThis);
                },
                .short_option_and_value => {
                    var raw = this.raw.asBunString(globalThis);
                    var substr = raw.substringWithLen(0, 2);
                    return substr.toJS(globalThis);
                },
                .long_option_and_value => {
                    var raw = this.raw.asBunString(globalThis);
                    const equal_index = raw.indexOfAsciiChar('=').?;
                    var substr = raw.substringWithLen(0, equal_index);
                    return substr.toJS(globalThis);
                },
            }
        }
    }
};

pub fn findOptionByLongName(long_name: String, options: []const OptionDefinition) ?usize {
    for (options, 0..) |option, i| {
        if (long_name.eql(option.long_name)) {
            return i;
        }
    }
    return null;
}

/// Gets the default args from the process argv
fn getDefaultArgs(globalThis: *JSGlobalObject) !ArgsSlice {
    // Work out where to slice process.argv for user supplied arguments

    // Check options for scenarios where user CLI args follow executable
    const argv: JSValue = JSC.Node.Process.getArgv(globalThis);

    //var found = false;
    //var iter = argv.arrayIterator(globalThis);
    //while (iter.next()) |arg| {
    //    const str = arg.toBunString(globalThis);
    //    if (str.eqlComptime("-e") or str.eqlComptime("--eval") or str.eqlComptime("-p") or str.eqlComptime("--print")) {
    //        found = true;
    //        break;
    //    }
    //}
    // Normally first two arguments are executable and script, then CLI arguments
    //args_offset.* = if (found) 1 else 2;

    // argv[0] is the bun executable name
    // argv[1] is the script path, or a placeholder in case of eval
    // so actual args start from argv[2]
    return .{ .array = argv, .start = 2, .end = @intCast(argv.getLength(globalThis)) };
}

/// In strict mode, throw for possible usage errors like "--foo --bar" where foo was defined as a string-valued arg
fn checkOptionLikeValue(globalThis: *JSGlobalObject, token: OptionToken) ParseArgsError!void {
    if (!token.inline_value and isOptionLikeValue(token.value.asBunString(globalThis))) {
        const raw_name = OptionToken.RawNameFormatter{ .token = token, .globalThis = globalThis };

        // Only show short example if user used short option.
        var err: JSValue = undefined;
        if (token.raw.asBunString(globalThis).hasPrefixComptime("--")) {
            err = JSC.toTypeError(
                JSC.Node.ErrorCode.ERR_PARSE_ARGS_INVALID_OPTION_VALUE,
                "Option '{}' argument is ambiguous.\nDid you forget to specify the option argument for '{}'?\nTo specify an option argument starting with a dash use '{}=-XYZ'.",
                .{ raw_name, raw_name, raw_name },
                globalThis,
            );
        } else {
            const token_name = token.name.asBunString(globalThis);
            err = JSC.toTypeError(
                JSC.Node.ErrorCode.ERR_PARSE_ARGS_INVALID_OPTION_VALUE,
                "Option '{}' argument is ambiguous.\nDid you forget to specify the option argument for '{}'?\nTo specify an option argument starting with a dash use '--{}=-XYZ' or '{}-XYZ'.",
                .{ raw_name, raw_name, token_name, raw_name },
                globalThis,
            );
        }
        globalThis.vm().throwError(globalThis, err);
        return error.ParseError;
    }
}

/// In strict mode, throw for usage errors.
fn checkOptionUsage(globalThis: *JSGlobalObject, options: []const OptionDefinition, allow_positionals: bool, token: OptionToken) ParseArgsError!void {
    if (token.option_idx) |option_idx| {
        const option = options[option_idx];
        switch (option.type) {
            .string => if (token.value == .jsvalue and !token.value.jsvalue.isString()) {
                const err = JSC.toTypeError(
                    JSC.Node.ErrorCode.ERR_PARSE_ARGS_INVALID_OPTION_VALUE,
                    "Option '{s}{s}{s}--{s} <value>' argument missing",
                    .{
                        if (!option.short_name.isEmpty()) "-" else "",
                        option.short_name,
                        if (!option.short_name.isEmpty()) ", " else "",
                        token.name.asBunString(globalThis),
                    },
                    globalThis,
                );
                globalThis.vm().throwError(globalThis, err);
                return error.ParseError;
            },
            .boolean => if (token.value != .jsvalue or !token.value.jsvalue.isUndefined()) {
                const err = JSC.toTypeError(
                    JSC.Node.ErrorCode.ERR_PARSE_ARGS_INVALID_OPTION_VALUE,
                    "Option '{s}{s}{s}--{s}' does not take an argument",
                    .{
                        if (!option.short_name.isEmpty()) "-" else "",
                        option.short_name,
                        if (!option.short_name.isEmpty()) ", " else "",
                        token.name.asBunString(globalThis),
                    },
                    globalThis,
                );
                globalThis.vm().throwError(globalThis, err);
                return error.ParseError;
            },
        }
    } else {
        const raw_name = OptionToken.RawNameFormatter{ .token = token, .globalThis = globalThis };

        const err = if (allow_positionals) (JSC.toTypeError(
            JSC.Node.ErrorCode.ERR_PARSE_ARGS_UNKNOWN_OPTION,
            "Unknown option '{}'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"{}\"",
            .{ raw_name, raw_name },
            globalThis,
        )) else (JSC.toTypeError(
            JSC.Node.ErrorCode.ERR_PARSE_ARGS_UNKNOWN_OPTION,
            "Unknown option '{}'",
            .{raw_name},
            globalThis,
        ));
        globalThis.vm().throwError(globalThis, err);
        return error.ParseError;
    }
}

/// Store the option value in `values`.
/// Parameters:
/// - `option_name`: long option name e.g. "foo"
/// - `option_value`: value from user args
/// - `options`: option configs, from `parseArgs({ options })`
/// - `values`: option values returned in `values` by parseArgs
fn storeOption(globalThis: *JSGlobalObject, option_name: ValueRef, option_value: ValueRef, option_idx: ?usize, options: []const OptionDefinition, values: JSValue) void {
    var key = option_name.asBunString(globalThis);
    if (key.eqlComptime("__proto__")) {
        return;
    }

    var value = option_value.asJSValue(globalThis);

    // We store based on the option value rather than option type,
    // preserving the users intent for author to deal with.
    const new_value = if (value.isUndefined()) JSValue.true else value;

    const is_multiple = if (option_idx) |idx| options[idx].multiple else false;
    if (is_multiple) {
        // Always store value in array, including for boolean.
        // values[long_option] starts out not present,
        // first value is added as new array [new_value],
        // subsequent values are pushed to existing array.
        if (values.getOwn(globalThis, key)) |value_list| {
            value_list.push(globalThis, new_value);
        } else {
            var value_list = JSValue.createEmptyArray(globalThis, 1);
            value_list.putIndex(globalThis, 0, new_value);
            values.putMayBeIndex(globalThis, &key, value_list);
        }
    } else {
        values.putMayBeIndex(globalThis, &key, new_value);
    }
}

fn parseOptionDefinitions(globalThis: *JSGlobalObject, options_obj: JSValue, option_definitions: *std.ArrayList(OptionDefinition)) !void {
    try validateObject(globalThis, options_obj, "options", .{}, .{});

    var iter = JSC.JSPropertyIterator(.{
        .skip_empty_name = false,
        .include_value = true,
    }).init(globalThis, options_obj);
    defer iter.deinit();

    while (iter.next()) |long_option| {
        var option = OptionDefinition{
            .long_name = String.init(long_option),
        };

        const obj: JSValue = iter.value;
        try validateObject(globalThis, obj, "options.{s}", .{option.long_name}, .{});

        // type field is required
        const option_type = obj.getOwn(globalThis, "type") orelse JSValue.undefined;
        option.type = try validateStringEnum(OptionValueType, globalThis, option_type, "options.{s}.type", .{option.long_name});

        if (obj.getOwn(globalThis, "short")) |short_option| {
            try validateString(globalThis, short_option, "options.{s}.short", .{option.long_name});
            var short_option_str = short_option.toBunString(globalThis);
            if (short_option_str.length() != 1) {
                const err = JSC.toTypeError(JSC.Node.ErrorCode.ERR_INVALID_ARG_VALUE, "options.{s}.short must be a single character", .{option.long_name}, globalThis);
                globalThis.vm().throwError(globalThis, err);
                return error.ParseError;
            }
            option.short_name = short_option_str;
        }

        if (obj.getOwn(globalThis, "multiple")) |multiple_value| {
            if (!multiple_value.isUndefined()) {
                option.multiple = try validateBoolean(globalThis, multiple_value, "options.{s}.multiple", .{option.long_name});
            }
        }

        if (obj.getOwn(globalThis, "default")) |default_value| {
            if (!default_value.isUndefined()) {
                switch (option.type) {
                    .string => {
                        if (option.multiple) {
                            _ = try validateStringArray(globalThis, default_value, "options.{s}.default", .{option.long_name});
                        } else {
                            try validateString(globalThis, default_value, "options.{s}.default", .{option.long_name});
                        }
                    },
                    .boolean => {
                        if (option.multiple) {
                            _ = try validateBooleanArray(globalThis, default_value, "options.{s}.default", .{option.long_name});
                        } else {
                            _ = try validateBoolean(globalThis, default_value, "options.{s}.default", .{option.long_name});
                        }
                    },
                }
                option.default_value = default_value;
            }
        }

        log("[OptionDef] \"{s}\" (type={s}, short={s}, multiple={d}, default={?})", .{
            String.init(long_option),
            @tagName(option.type),
            if (!option.short_name.isEmpty()) option.short_name else String.static("none"),
            @intFromBool(option.multiple),
            option.default_value,
        });

        try option_definitions.append(option);
    }
}

/// Process the args string-array and build an array identified tokens:
/// - option (along with value, if any)
/// - positional
/// - option-terminator
fn tokenizeArgs(
    comptime T: type,
    globalThis: *JSGlobalObject,
    args: ArgsSlice,
    options: []const OptionDefinition,
    ctx: *T,
    emitToken: fn (ctx: *T, token: Token) ParseArgsError!void,
) !void {
    const num_args: u32 = args.end - args.start;
    var index: u32 = 0;
    while (index < num_args) : (index += 1) {
        const arg_ref: ValueRef = ValueRef{ .jsvalue = args.get(globalThis, index) };
        const arg = arg_ref.asBunString(globalThis);

        const token_rawtype = classifyToken(arg, options);
        log(" [Arg #{d}] {s} ({s})", .{ index, @tagName(token_rawtype), arg });

        switch (token_rawtype) {
            // Check if `arg` is an options terminator.
            // Guideline 10 in https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap12.html
            .option_terminator => {
                // Everything after a bare '--' is considered a positional argument.
                try emitToken(ctx, Token{ .@"option-terminator" = .{
                    .index = index,
                } });
                index += 1;

                while (index < num_args) : (index += 1) {
                    try emitToken(ctx, Token{ .positional = .{
                        .index = index,
                        .value = ValueRef{ .jsvalue = args.get(globalThis, index) },
                    } });
                }
                break; // Finished processing args, leave while loop.
            },

            // isLoneShortOption
            .lone_short_option => {
                // e.g. '-f'
                const short_option = arg.substringWithLen(1, 2);
                const option_idx = findOptionByShortName(short_option, options);
                const option_type: OptionValueType = if (option_idx) |idx| options[idx].type else .boolean;
                var value = ValueRef{ .jsvalue = JSValue.undefined };
                var has_inline_value = true;
                if (option_type == .string and index + 1 < num_args) {
                    // e.g. '-f', "bar"
                    value = ValueRef{ .jsvalue = args.get(globalThis, index + 1) };
                    has_inline_value = false;
                    log("   (lone_short_option consuming next token as value)", .{});
                }
                try emitToken(ctx, Token{ .option = .{
                    .index = index,
                    .value = value,
                    .inline_value = has_inline_value,
                    .name = ValueRef{ .bunstr = if (option_idx) |idx| options[idx].long_name else arg.substringWithLen(1, 2) },
                    .parse_type = .lone_short_option,
                    .raw = arg_ref,
                    .option_idx = option_idx,
                } });

                if (!has_inline_value) index += 1;
            },

            // isShortOptionGroup
            .short_option_group => {
                // Expand -fXzy to -f -X -z -y
                const original_arg_idx = index;
                const arg_len = arg.length();
                for (1..arg_len) |idx_in_optgroup| {
                    const short_option = arg.substringWithLen(idx_in_optgroup, idx_in_optgroup + 1);
                    const option_idx = findOptionByShortName(short_option, options);
                    const option_type: OptionValueType = if (option_idx) |idx| options[idx].type else .boolean;
                    if (option_type != .string or idx_in_optgroup == arg_len - 1) {
                        // Boolean option, or last short in group. Well formed.

                        // Immediately process as a lone_short_option (e.g. from input -abc, process -a -b -c)
                        var value = ValueRef{ .jsvalue = JSValue.undefined };
                        var has_inline_value = true;
                        if (option_type == .string and index + 1 < num_args) {
                            // e.g. '-f', "bar"
                            value = ValueRef{ .jsvalue = args.get(globalThis, index + 1) };
                            has_inline_value = false;
                            log("   (short_option_group short option consuming next token as value)", .{});
                        }
                        try emitToken(ctx, Token{ .option = .{
                            .index = original_arg_idx,
                            .optgroup_idx = @intCast(idx_in_optgroup),
                            .value = value,
                            .inline_value = has_inline_value,
                            .name = ValueRef{ .bunstr = if (option_idx) |i| options[i].long_name else short_option },
                            .parse_type = .lone_short_option,
                            .raw = arg_ref,
                            .option_idx = option_idx,
                        } });

                        if (!has_inline_value) index += 1;
                    } else {
                        // String option in middle. Yuck.
                        // Expand -abfFILE to -a -b -fFILE

                        // Immediately process as a short_option_and_value
                        try emitToken(ctx, Token{ .option = .{
                            .index = original_arg_idx,
                            .optgroup_idx = @intCast(idx_in_optgroup),
                            .value = ValueRef{ .bunstr = arg.substring(idx_in_optgroup + 1) },
                            .inline_value = true,
                            .name = ValueRef{ .bunstr = if (option_idx) |i| options[i].long_name else short_option },
                            .parse_type = .short_option_and_value,
                            .raw = arg_ref,
                            .option_idx = option_idx,
                        } });

                        break; // finished short group
                    }
                }
            },

            .short_option_and_value => {
                // e.g. -fFILE
                const short_option = arg.substringWithLen(1, 2);
                const option_idx = findOptionByShortName(short_option, options);
                const value = arg.substring(2);

                try emitToken(ctx, Token{ .option = .{
                    .index = index,
                    .value = ValueRef{ .bunstr = value },
                    .inline_value = true,
                    .name = ValueRef{ .bunstr = if (option_idx) |idx| options[idx].long_name else arg.substringWithLen(1, 2) },
                    .parse_type = .short_option_and_value,
                    .raw = ValueRef{ .bunstr = arg.substringWithLen(0, 2) },
                    .option_idx = option_idx,
                } });
            },

            .lone_long_option => {
                // e.g. '--foo'
                const long_option = arg.substring(2);
                var value: ?JSValue = null;
                const option_idx = findOptionByLongName(long_option, options);
                const option_type: OptionValueType = if (option_idx) |idx| options[idx].type else .boolean;
                if (option_type == .string and index + 1 < num_args) {
                    // e.g. '--foo', "bar"
                    value = args.get(globalThis, index + 1);
                    log("  (consuming next as value)", .{});
                }
                try emitToken(ctx, Token{ .option = .{
                    .index = index,
                    .value = ValueRef{ .jsvalue = value orelse JSValue.jsUndefined() },
                    .inline_value = (value == null),
                    .name = ValueRef{ .bunstr = long_option },
                    .parse_type = .lone_long_option,
                    .raw = arg_ref,
                    .option_idx = option_idx,
                } });
                if (value != null) index += 1;
            },

            .long_option_and_value => {
                // e.g. --foo=barconst
                const equal_index = arg.indexOfAsciiChar('=');
                const long_option = arg.substringWithLen(2, equal_index.?);
                const value = arg.substring(equal_index.? + 1);

                try emitToken(ctx, Token{ .option = .{
                    .index = index,
                    .value = ValueRef{ .bunstr = value },
                    .inline_value = true,
                    .name = ValueRef{ .bunstr = long_option },
                    .parse_type = .long_option_and_value,
                    .raw = arg_ref,
                    .option_idx = findOptionByLongName(long_option, options),
                } });
            },

            .positional => {
                try emitToken(ctx, Token{ .positional = .{
                    .index = index,
                    .value = arg_ref,
                } });
            },
        }
    }
}

const ParseArgsState = struct {
    globalThis: *JSGlobalObject,

    option_defs: []const OptionDefinition,
    allow_positionals: bool,
    strict: bool,

    // Output
    values: JSValue,
    positionals: JSValue,
    tokens: JSValue,

    /// To reuse JSValue for the "kind" field in the output tokens array ("positional", "option", "option-terminator")
    kinds_jsvalues: [TokenKind.COUNT]?JSValue = [_]?JSValue{null} ** TokenKind.COUNT,

    pub fn handleToken(this: *ParseArgsState, token_generic: Token) ParseArgsError!void {
        var globalThis = this.globalThis;

        switch (token_generic) {
            .option => |token| {
                if (this.strict) {
                    try checkOptionUsage(globalThis, this.option_defs, this.allow_positionals, token);
                    try checkOptionLikeValue(globalThis, token);
                }
                storeOption(globalThis, token.name, token.value, token.option_idx, this.option_defs, this.values);
            },
            .positional => |token| {
                if (!this.allow_positionals) {
                    const err = JSC.toTypeError(
                        JSC.Node.ErrorCode.ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL,
                        "Unexpected argument '{s}'. This command does not take positional arguments",
                        .{token.value.asBunString(globalThis)},
                        globalThis,
                    );
                    globalThis.vm().throwError(globalThis, err);
                    return error.ParseError;
                }
                const value = token.value.asJSValue(globalThis);
                this.positionals.push(globalThis, value);
            },
            .@"option-terminator" => {},
        }

        // Append to the parseArgs result "tokens" field
        // This field is opt-in, and people usually don't ask for it, so only create the js values if they are asked for
        if (!this.tokens.isUndefined()) {
            const num_properties: usize = switch (token_generic) {
                .option => |token| if (token.value == .jsvalue and token.value.jsvalue.isUndefined()) 4 else 6,
                .positional => 3,
                .@"option-terminator" => 2,
            };

            // reuse JSValue for the kind names: "positional", "option", "option-terminator"
            const kind_idx = @intFromEnum(token_generic);
            const kind_jsvalue = this.kinds_jsvalues[kind_idx] orelse kindval: {
                const val = String.static(@as(string, @tagName(token_generic))).toJS(globalThis);
                this.kinds_jsvalues[kind_idx] = val;
                break :kindval val;
            };

            var obj = JSValue.createEmptyObject(globalThis, num_properties);
            obj.put(globalThis, ZigString.static("kind"), kind_jsvalue);
            switch (token_generic) {
                .option => |token| {
                    obj.put(globalThis, ZigString.static("index"), JSValue.jsNumber(token.index));
                    obj.put(globalThis, ZigString.static("name"), token.name.asJSValue(globalThis));
                    obj.put(globalThis, ZigString.static("rawName"), token.makeRawNameJSValue(globalThis));

                    // value exists only for string options, otherwise the property exists with "undefined" as value
                    var value = token.value.asJSValue(globalThis);
                    obj.put(globalThis, ZigString.static("value"), value);
                    obj.put(globalThis, ZigString.static("inlineValue"), if (value.isUndefined()) JSValue.undefined else JSValue.jsBoolean(token.inline_value));
                },
                .positional => |token| {
                    obj.put(globalThis, ZigString.static("index"), JSValue.jsNumber(token.index));
                    obj.put(globalThis, ZigString.static("value"), token.value.asJSValue(globalThis));
                },
                .@"option-terminator" => |token| {
                    obj.put(globalThis, ZigString.static("index"), JSValue.jsNumber(token.index));
                },
            }
            this.tokens.push(globalThis, obj);
        }
    }
};

pub fn parseArgs(
    globalThis: *JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSValue {
    JSC.markBinding(@src());
    const arguments = callframe.arguments(1).slice();
    const config = if (arguments.len > 0) arguments[0] else JSValue.undefined;
    return parseArgsImpl(globalThis, config) catch |err| {
        // these two types of error will already throw their own js exception
        if (err != error.ParseError and err != error.InvalidArgument) {
            globalThis.throwOutOfMemory();
        }
        return JSValue.undefined;
    };
}

comptime {
    const parseArgsFn = JSC.toJSHostFunction(parseArgs);
    @export(parseArgsFn, .{ .name = "Bun__NodeUtil__jsParseArgs" });
}

pub fn parseArgsImpl(globalThis: *JSGlobalObject, config_obj: JSValue) !JSValue {
    //
    // Phase 0: parse the config object
    //

    const config = if (config_obj.isUndefinedOrNull()) null else config_obj;
    if (config) |c| {
        try validateObject(globalThis, c, "config", .{}, .{});
    }

    // Phase 0.A: Get and validate type of input args
    var args: ArgsSlice = undefined;
    const config_args_or_null: ?JSValue = if (config) |c| c.getOwn(globalThis, "args") else null;
    if (config_args_or_null) |config_args| {
        try validateArray(globalThis, config_args, "args", .{}, null);
        args = .{
            .array = config_args,
            .start = 0,
            .end = @intCast(config_args.getLength(globalThis)),
        };
    } else {
        args = try getDefaultArgs(globalThis);
    }

    // Phase 0.B: Parse and validate config

    const config_strict: JSValue = (if (config) |c| c.getOwn(globalThis, "strict") else null) orelse JSValue.jsBoolean(true);
    const config_allow_positionals: ?JSValue = if (config) |c| c.getOwn(globalThis, "allowPositionals") else null;
    const config_return_tokens: JSValue = (if (config) |c| c.getOwn(globalThis, "tokens") else null) orelse JSValue.jsBoolean(false);
    const config_options_obj: ?JSValue = if (config) |c| c.getOwn(globalThis, "options") else null;

    const strict = try validateBoolean(globalThis, config_strict, "strict", .{});

    var allow_positionals = !strict;
    if (config_allow_positionals) |config_allow_positionals_value| {
        allow_positionals = try validateBoolean(globalThis, config_allow_positionals_value, "allowPositionals", .{});
    }

    const return_tokens = try validateBoolean(globalThis, config_return_tokens, "tokens", .{});

    // Phase 0.C: Parse the options definitions

    var options_defs_allocator = std.heap.stackFallback(2048, globalThis.allocator());
    var option_defs = std.ArrayList(OptionDefinition).init(options_defs_allocator.get());
    defer option_defs.deinit();

    if (config_options_obj) |options_obj| {
        try parseOptionDefinitions(globalThis, options_obj, &option_defs);
    }

    //
    // Phase 1: tokenize the args string-array
    //  +
    // Phase 2: process tokens into parsed option values and positionals
    //
    log("Phase 1+2: tokenize args (args.len={d})", .{args.end - args.start});

    // note that "values" needs to have a null prototype instead of Object, to avoid issues such as "values.toString"` being defined
    const values = JSValue.createEmptyObjectWithNullPrototype(globalThis);
    const positionals = JSC.JSValue.createEmptyArray(globalThis, 0);
    const tokens = if (return_tokens) JSC.JSValue.createEmptyArray(globalThis, 0) else JSValue.undefined;

    var state = ParseArgsState{
        .globalThis = globalThis,

        .option_defs = option_defs.items,
        .allow_positionals = allow_positionals,
        .strict = strict,

        .values = values,
        .positionals = positionals,
        .tokens = tokens,
    };

    try tokenizeArgs(ParseArgsState, globalThis, args, option_defs.items, &state, ParseArgsState.handleToken);

    //
    // Phase 3: fill in default values for missing args
    //
    log("Phase 3: fill defaults", .{});

    for (option_defs.items) |option| {
        if (option.default_value) |default_value| {
            if (!option.long_name.eqlComptime("__proto__")) {
                if (state.values.getOwn(globalThis, option.long_name) == null) {
                    log("  Setting \"{}\" to default value", .{option.long_name});
                    state.values.putMayBeIndex(globalThis, &option.long_name, default_value);
                }
            }
        }
    }

    //
    // Phase 4: build the resulting object: `{ values: {...}, positionals: [...], tokens?: [...] }`
    //
    log("Phase 4: Build result object", .{});

    var result = JSValue.createEmptyObject(globalThis, if (return_tokens) 3 else 2);
    if (return_tokens) {
        result.put(globalThis, ZigString.static("tokens"), state.tokens);
    }
    result.put(globalThis, ZigString.static("values"), state.values);
    result.put(globalThis, ZigString.static("positionals"), state.positionals);
    return result;
}
