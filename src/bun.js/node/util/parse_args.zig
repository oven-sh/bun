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
    start: usize,
    end: usize,
};

const TokenKind = enum { positional, option, @"option-terminator" };
const Token = union(TokenKind) {
    positional: struct { index: i32, value: JSValue },
    option: OptionToken,
    @"option-terminator": struct { index: i32 },
};

const OptionToken = struct {
    index: i32,
    name: JSValue,
    parse_type: enum {
        lone_short_option,
        short_option_and_value,
        lone_long_option,
        long_option_and_value,
    },
    value: JSValue,
    inline_value: bool,
    option_idx: ?usize,

    /// The full raw arg string (e.g. "--arg=1").
    /// It might not exist as-is on the input "args" list, like in the case of short option groups
    raw: JSValue,

    /// Returns the name of the arg including any dashes and excluding inline values, as a bun string
    ///
    /// Note: callee must call `.deref()` on the resulting string once done
    fn makeRawNameString(this: *const OptionToken, globalThis: *JSGlobalObject) !String {
        switch (this.parse_type) {
            .lone_short_option, .lone_long_option => {
                var str = this.raw.toBunString(globalThis);
                str.ref();
                return str;
            },
            .short_option_and_value => {
                const raw = this.raw.toBunString(globalThis);
                return try String.createFromConcat(globalThis.allocator(), &[_]String{ String.static("-"), raw.substringWithLen(1, 2) });
            },
            .long_option_and_value => {
                const raw = this.raw.toBunString(globalThis);
                const equal_index = raw.indexOfCharU8('=').?;
                var str = raw.substringWithLen(0, equal_index);
                str.ref();
                return str;
            },
        }
    }

    /// Returns the name of the arg including any dashes and excluding inline values, as a JSValue
    fn makeRawNameJSValue(this: *const OptionToken, globalThis: *JSGlobalObject) !JSValue {
        return switch (this.parse_type) {
            .lone_short_option, .lone_long_option => this.raw,
            else => {
                var str = try this.makeRawNameString(globalThis);
                defer str.deref();
                return str.toJSConst(globalThis);
            },
        };
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
fn checkOptionLikeValue(globalThis: *JSGlobalObject, token: OptionToken) !void {
    if (!token.inline_value and isOptionLikeValue(token.value.toBunString(globalThis))) {
        const raw_name = try token.makeRawNameString(globalThis);
        defer raw_name.deref();

        // Only show short example if user used short option.
        var err: JSValue = undefined;
        if (raw_name.hasPrefixComptime("--")) {
            err = JSC.toTypeError(
                JSC.Node.ErrorCode.ERR_PARSE_ARGS_INVALID_OPTION_VALUE,
                "Option '{}' argument is ambiguous.\nDid you forget to specify the option argument for '{}'?\nTo specify an option argument starting with a dash use '{}=-XYZ'.",
                .{ raw_name, raw_name, raw_name },
                globalThis,
            );
        } else {
            const token_name = token.name.toBunString(globalThis);
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
fn checkOptionUsage(globalThis: *JSGlobalObject, options: []const OptionDefinition, allow_positionals: bool, token: OptionToken) !void {
    if (token.option_idx) |option_idx| {
        const option = options[option_idx];
        switch (option.type) {
            .string => if (!token.value.isString()) {
                const err = JSC.toTypeError(
                    JSC.Node.ErrorCode.ERR_PARSE_ARGS_INVALID_OPTION_VALUE,
                    "Option '{s}{s}{s}--{s} <value>' argument missing",
                    .{
                        if (option.short_name != null) "-" else "",
                        if (option.short_name) |chr| &[_]u8{chr} else "",
                        if (option.short_name != null) ", " else "",
                        token.name.toBunString(globalThis),
                    },
                    globalThis,
                );
                globalThis.vm().throwError(globalThis, err);
                return error.ParseError;
            },
            .boolean => if (!token.value.isUndefined()) {
                const err = JSC.toTypeError(
                    JSC.Node.ErrorCode.ERR_PARSE_ARGS_INVALID_OPTION_VALUE,
                    "Option '{s}{s}{s}--{s}' does not take an argument",
                    .{
                        if (option.short_name != null) "-" else "",
                        if (option.short_name) |chr| &[_]u8{chr} else "",
                        if (option.short_name != null) ", " else "",
                        token.name.toBunString(globalThis),
                    },
                    globalThis,
                );
                globalThis.vm().throwError(globalThis, err);
                return error.ParseError;
            },
        }
    } else {
        const raw_name = try token.makeRawNameString(globalThis);
        defer raw_name.deref();

        const err = if (allow_positionals) (JSC.toTypeError(
            JSC.Node.ErrorCode.ERR_PARSE_ARGS_UNKNOWN_OPTION,
            "Unknown option '{}'. To specify a positional 'argument starting with a '-', place it at the end of the command after '--', as in '-- \"{}\"",
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
/// - `long_option`: long option name e.g. "foo"
/// - `optionValue`: value from user args
/// - `options`: option configs, from `parseArgs({ options })`
/// - `values`: option values returned in `values` by parseArgs
fn storeOption(globalThis: *JSGlobalObject, long_option: JSValue, option_value: JSValue, option_idx: ?usize, options: []const OptionDefinition, values: JSValue) void {
    if (long_option.toBunString(globalThis).eqlComptime("__proto__")) {
        return;
    }

    // We store based on the option value rather than option type,
    // preserving the users intent for author to deal with.
    const new_value = if (option_value.isUndefined()) JSValue.true else option_value;

    const is_multiple = if (option_idx) |idx| options[idx].multiple else false;
    if (is_multiple) {
        // Always store value in array, including for boolean.
        // values[long_option] starts out not present,
        // first value is added as new array [new_value],
        // subsequent values are pushed to existing array.
        var key = long_option.toBunString(globalThis);
        if (values.getOwn(globalThis, key)) |value_list| {
            value_list.push(globalThis, new_value);
        } else {
            var key_zig = key.toZigString();
            var value_list = JSValue.createEmptyArray(globalThis, 1);
            value_list.putIndex(globalThis, 0, new_value);
            values.put(globalThis, &key_zig, value_list);
        }
    } else {
        var key_zig = long_option.getZigString(globalThis);
        values.put(globalThis, &key_zig, new_value);
    }
}

fn parseOptionDefinitions(globalThis: *JSGlobalObject, options_obj: JSValue, option_definitions: *std.ArrayList(OptionDefinition)) !void {
    try validateObject(globalThis, options_obj, "options", .{}, .{});

    var iter = JSC.JSPropertyIterator(.{
        .skip_empty_name = false,
        .include_value = true,
    }).init(globalThis, options_obj.asObjectRef());
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
            option.short_name = short_option_str.charAtU8(0);
        }

        if (obj.getOwn(globalThis, "multiple")) |multiple_value| {
            if (!multiple_value.isUndefined()) {
                try validateBoolean(globalThis, multiple_value, "options.{s}.multiple", .{option.long_name});
                option.multiple = multiple_value.toBoolean();
            }
        }

        if (obj.getOwn(globalThis, "default")) |default_value| {
            if (!default_value.isUndefined()) {
                switch (option.type) {
                    .string => {
                        if (option.multiple) {
                            try validateStringArray(globalThis, default_value, "options.{s}.default", .{option.long_name});
                        } else {
                            try validateString(globalThis, default_value, "options.{s}.default", .{option.long_name});
                        }
                    },
                    .boolean => {
                        if (option.multiple) {
                            try validateBooleanArray(globalThis, default_value, "options.{s}.default", .{option.long_name});
                        } else {
                            try validateBoolean(globalThis, default_value, "options.{s}.default", .{option.long_name});
                        }
                    },
                }
                option.default_value = default_value;
            }
        }

        log("[OptionDef] \"{s}\" (type={s}, short={s}, multiple={d}, default={?})", .{
            String.init(long_option),
            @tagName(option.type),
            if (option.short_name) |chr| &[_]u8{chr} else "none",
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
fn tokenizeArgs(globalThis: *JSGlobalObject, args: ArgsSlice, options: []const OptionDefinition, tokens: *std.ArrayList(Token)) !void {
    var index: i32 = -1;
    var group_count: i32 = 0;

    // build a queue of args to process, because new args can be inserted during the processing
    var queue_allocator = std.heap.stackFallback(32 * @sizeOf(JSValue), globalThis.allocator());
    var queue = try std.ArrayList(JSValue).initCapacity(queue_allocator.get(), args.end - args.start);
    defer queue.deinit();
    for (args.start..args.end) |i| {
        queue.appendAssumeCapacity(args.array.getIndex(globalThis, @truncate(i)));
    }

    var queue_pos: usize = 0;

    while (queue_pos < queue.items.len) : (queue_pos += 1) {
        const arg_jsvalue: JSValue = queue.items[queue_pos];
        const arg = arg_jsvalue.toBunString(globalThis);
        if (group_count > 0) {
            group_count -= 1;
        } else {
            index += 1;
        }

        log("  (processing arg #{d}: \"{s}\")", .{ index, arg });

        const token_subtype = classifyToken(arg, options);
        log(" [Token #{d}] {s} ({s})", .{ index, @tagName(token_subtype), arg });

        switch (token_subtype) {
            // Check if `arg` is an options terminator.
            // Guideline 10 in https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap12.html
            .option_terminator => {
                // Everything after a bare '--' is considered a positional argument.
                try tokens.append(Token{ .@"option-terminator" = .{ .index = index } });
                queue_pos += 1;
                index += 1;
                while (queue_pos < queue.items.len) : (queue_pos += 1) {
                    var value = queue.items[queue_pos].toBunString(globalThis);
                    try tokens.append(Token{ .positional = .{ .index = index, .value = value.toJSConst(globalThis) } });
                    index += 1;
                }
                break; // Finished processing args, leave while loop.
            },

            // isLoneShortOption
            .lone_short_option => {
                // e.g. '-f'
                const short_option = arg.charAtU8(1);
                const option_idx = findOptionByShortName(short_option, options);
                const option_type: OptionValueType = if (option_idx) |idx| options[idx].type else .boolean;
                var value = JSValue.undefined;
                var has_inline_value = true;
                if (option_type == .string and queue_pos + 1 < queue.items.len) {
                    // e.g. '-f', "bar"
                    queue_pos += 1;
                    value = queue.items[queue_pos];
                    has_inline_value = false;
                    log("   (lone_short_option consuming next token as value)", .{});
                }
                try tokens.append(Token{ .option = .{
                    .index = index,
                    .value = value,
                    .inline_value = has_inline_value,
                    .name = if (option_idx) |idx| options[idx].long_name.toJSConst(globalThis) else arg.substringWithLen(1, 2).toJSConst(globalThis),
                    .parse_type = .lone_short_option,
                    .raw = arg_jsvalue,
                    .option_idx = option_idx,
                } });

                if (!has_inline_value) {
                    index += 1;
                }
            },

            // isShortOptionGroup
            .short_option_group => {
                // Expand -fXzy to -f -X -z -y
                var num_short_options: usize = 0;
                var string_option_index: ?usize = null;
                const arg_len = arg.length();
                for (1..arg_len) |i| {
                    group_count += 1;
                    const short_option = arg.charAtU8(i);
                    const option_type: OptionValueType = if (findOptionByShortName(short_option, options)) |idx| options[idx].type else .boolean;
                    if (option_type != .string or i == arg_len - 1) {
                        // Boolean option, or last short in group. Well formed.
                        num_short_options += 1;
                    } else {
                        // String option in middle. Yuck.
                        // Expand -abfFILE to -a -b -fFILE
                        string_option_index = i;
                        break; // finished short group
                    }
                }
                var num_args_to_enqueue: usize = num_short_options + if (string_option_index != null) @as(usize, 1) else @as(usize, 0);
                _ = try queue.addManyAt(queue_pos + 1, num_args_to_enqueue);
                if (num_short_options > 0) {
                    var buf: [2]u8 = undefined;
                    buf[0] = '-';
                    for (0..num_short_options) |i| {
                        buf[1] = arg.charAtU8(1 + i);
                        queue.items[queue_pos + 1 + i] = String.init(&buf).toJSConst(globalThis);
                        log("  ((enqueued: \"{s}\"))", .{String.init(&buf)});
                    }
                }
                if (string_option_index) |i| {
                    const new_arg = try String.createFromConcat(globalThis.allocator(), &[_]String{ String.static("-"), arg.substring(i) });
                    defer new_arg.deref();
                    queue.items[queue_pos + 1 + num_short_options] = new_arg.toJSConst(globalThis);
                    log("  ((enqueued: \"{s}\"))", .{new_arg});
                }
            },

            .short_option_and_value => {
                // e.g. -fFILE
                const short_option = arg.charAtU8(1);
                const option_idx = findOptionByShortName(short_option, options);
                const value = arg.substring(2);

                try tokens.append(Token{ .option = .{
                    .index = index,
                    .value = value.toJSConst(globalThis),
                    .inline_value = true,
                    .name = if (option_idx) |idx| options[idx].long_name.toJSConst(globalThis) else arg.substringWithLen(1, 2).toJSConst(globalThis),
                    .parse_type = .short_option_and_value,
                    .raw = arg_jsvalue,
                    .option_idx = option_idx,
                } });
            },

            .lone_long_option => {
                // e.g. '--foo'
                var long_option = arg.substring(2);
                var value: ?JSValue = null;
                var has_inline_value = true;
                var option_idx = findOptionByLongName(long_option, options);
                const option_type: OptionValueType = if (option_idx) |idx| options[idx].type else .boolean;
                if (option_type == .string and queue_pos + 1 < queue.items.len) {
                    // e.g. '--foo', "bar"
                    queue_pos += 1;
                    value = queue.items[queue_pos];
                    has_inline_value = false;
                    log("  (consuming next as value)", .{});
                }
                try tokens.append(Token{ .option = .{
                    .index = index,
                    .value = value orelse JSValue.jsUndefined(),
                    .inline_value = has_inline_value,
                    .name = long_option.toJSConst(globalThis),
                    .parse_type = .lone_long_option,
                    .raw = arg_jsvalue,
                    .option_idx = option_idx,
                } });
                if (value != null) index += 1;
            },

            .long_option_and_value => {
                // e.g. --foo=barconst
                const equal_index = arg.indexOfCharU8('=');
                const long_option = arg.substringWithLen(2, equal_index.?);
                const value = arg.substring(equal_index.? + 1);

                try tokens.append(Token{ .option = .{
                    .index = index,
                    .value = value.toJSConst(globalThis),
                    .inline_value = true,
                    .name = long_option.toJSConst(globalThis),
                    .parse_type = .long_option_and_value,
                    .raw = arg_jsvalue,
                    .option_idx = findOptionByLongName(long_option, options),
                } });
            },

            .positional => {
                try tokens.append(Token{ .positional = .{ .index = index, .value = arg.toJSConst(globalThis) } });
            },
        }
    }
}

/// Create the parseArgs result "tokens" field
/// This field is opt-in, and people usually don't ask for it,
/// so only create the js values if they are needed
pub fn createOutputTokensArray(globalThis: *JSGlobalObject, tokens: []const Token) !JSValue {
    const kinds_count = @typeInfo(TokenKind).Enum.fields.len;
    var kinds_jsvalues: [kinds_count]?JSValue = [_]?JSValue{null} ** kinds_count;

    var result = JSC.JSValue.createEmptyArray(globalThis, tokens.len);
    for (tokens, 0..) |token_generic, i| {
        const obj_fields_count: usize = switch (token_generic) {
            .option => |token| if (token.value.isUndefined()) 4 else 6,
            .positional => 3,
            .@"option-terminator" => 2,
        };

        // reuse JSValue for the kind names: "positional", "option", "option-terminator"
        var kind_idx = @intFromEnum(token_generic);
        var kind_jsvalue = kinds_jsvalues[kind_idx] orelse kindval: {
            var val = String.static(@as(string, @tagName(token_generic))).toJSConst(globalThis);
            kinds_jsvalues[kind_idx] = val;
            break :kindval val;
        };

        var obj = JSValue.createEmptyObject(globalThis, obj_fields_count);
        obj.put(globalThis, ZigString.static("kind"), kind_jsvalue);
        switch (token_generic) {
            .option => |token| {
                obj.put(globalThis, ZigString.static("index"), JSValue.jsNumberFromInt32(token.index));
                obj.put(globalThis, ZigString.static("name"), token.name);
                obj.put(globalThis, ZigString.static("rawName"), try token.makeRawNameJSValue(globalThis));

                // only for boolean options, it is "undefined"
                obj.put(globalThis, ZigString.static("value"), token.value);
                obj.put(globalThis, ZigString.static("inlineValue"), if (token.value.isUndefined()) JSValue.undefined else JSValue.jsBoolean(token.inline_value));
            },
            .positional => |token| {
                obj.put(globalThis, ZigString.static("index"), JSValue.jsNumberFromInt32(token.index));
                obj.put(globalThis, ZigString.static("value"), token.value);
            },
            .@"option-terminator" => |token| {
                obj.put(globalThis, ZigString.static("index"), JSValue.jsNumberFromInt32(token.index));
            },
        }
        result.putIndex(globalThis, @intCast(i), obj);
    }
    return result;
}

pub fn parseArgs(globalThis: *JSGlobalObject, config_obj: JSValue) !JSValue {
    //
    // Phase 0: parse the config object
    //

    const config = if (config_obj.isUndefinedOrNull()) null else config_obj;
    if (config) |c| {
        try validateObject(globalThis, c, "config", .{}, .{});
    }

    // Phase 0.A: Get and validate type of input args
    var args: ArgsSlice = undefined;
    const config_args_or_null = if (config) |c| c.getOwn(globalThis, "args") else null;
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

    try validateBoolean(globalThis, config_strict, "strict", .{});
    const strict = config_strict.toBoolean();

    var allow_positionals = !strict;
    if (config_allow_positionals) |config_allow_positionals_value| {
        try validateBoolean(globalThis, config_allow_positionals_value, "allowPositionals", .{});
        allow_positionals = config_allow_positionals_value.toBoolean();
    }

    try validateBoolean(globalThis, config_return_tokens, "tokens", .{});
    const return_tokens = config_return_tokens.toBoolean();

    // Phase 0.C: Parse the options definitions

    var options_defs_allocator = std.heap.stackFallback(2048, globalThis.allocator());
    var option_defs = std.ArrayList(OptionDefinition).init(options_defs_allocator.get());
    defer option_defs.deinit();

    if (config_options_obj) |options_obj| {
        try parseOptionDefinitions(globalThis, options_obj, &option_defs);
    }

    //
    // Phase 1: tokenize the args string-array
    //
    log("Phase 1: tokenize args (args.len={d})", .{args.end - args.start});

    var tokens_allocator = std.heap.stackFallback(32 * @sizeOf(Token), globalThis.allocator());
    var tokens = try std.ArrayList(Token).initCapacity(tokens_allocator.get(), args.end - args.start);
    defer tokens.deinit();

    try tokenizeArgs(globalThis, args, option_defs.items, &tokens);

    //
    // Phase 2: process tokens into parsed option values and positionals
    //
    log("Phase 2: parse options from tokens (tokens.len={d})", .{tokens.items.len});

    var result_values = JSValue.constructEmptyObject(globalThis, null, 0);
    var result_positionals = JSC.JSValue.createEmptyArray(globalThis, 0);
    var result_positionals_len: u32 = 0;
    for (tokens.items) |t| {
        switch (t) {
            .option => |token| {
                if (strict) {
                    try checkOptionUsage(globalThis, option_defs.items, allow_positionals, token);
                    try checkOptionLikeValue(globalThis, token);
                }
                storeOption(globalThis, token.name, token.value, token.option_idx, option_defs.items, result_values);
            },
            .positional => |token| {
                if (!allow_positionals) {
                    const err = JSC.toTypeError(
                        JSC.Node.ErrorCode.ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL,
                        "Unexpected argument '{s}'. This command does not take positional arguments",
                        .{token.value.toBunString(globalThis)},
                        globalThis,
                    );
                    globalThis.vm().throwError(globalThis, err);
                    return error.ParseError;
                }
                result_positionals.putIndex(globalThis, result_positionals_len, token.value);
                result_positionals_len += 1;
            },
            else => {},
        }
    }

    //
    // Phase 3: fill in default values for missing args
    //
    log("Phase 3: fill defaults", .{});

    for (option_defs.items) |option| {
        if (option.default_value) |default_value| {
            if (!option.long_name.eqlComptime("__proto__")) {
                if (result_values.getOwn(globalThis, option.long_name) == null) {
                    log("  Setting \"{}\" to default value", .{option.long_name});
                    result_values.put(globalThis, &option.long_name.toZigString(), default_value);
                }
            }
        }
    }

    //
    // Phase 4: build the resulting object: `{ values: [...], positionals: [...], tokens?: [...] }`
    //
    log("Phase 4: Build result object", .{});

    var result = JSValue.createEmptyObject(globalThis, if (return_tokens) 3 else 2);
    if (return_tokens) {
        const result_tokens = try createOutputTokensArray(globalThis, tokens.items);
        result.put(globalThis, ZigString.static("tokens"), result_tokens);
    }
    result.put(globalThis, ZigString.static("values"), result_values);
    result.put(globalThis, ZigString.static("positionals"), result_positionals);
    return result;
}
