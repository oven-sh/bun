const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const strings = bun.strings;
const String = bun.String;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ConsoleObject = JSC.ConsoleObject;
const ZigString = JSC.ZigString;
const MutableString = bun.MutableString;

const validators = @import("./validators.zig");
const validateObject = validators.validateObject;

/// Object containing options that can be passed to util.inspect
/// (note that not all are supported)
pub const InspectOptions = struct {
    /// If true, object's non-enumerable symbols and properties are included in the formatted result.
    /// WeakMap and WeakSet entries are also included as well as user defined prototype properties (excluding method properties).
    showHidden: bool = false,
    /// Specifies the number of times to recurse while formatting object.
    /// This is useful for inspecting large objects.
    /// To recurse up to the maximum call stack size pass Infinity or null.
    depth: u16 = 2,
    /// If true, the output is styled with ANSI color codes. Colors are customizable. See Customizing util.inspect colors.
    colors: bool = false,
    /// If false, [util.inspect.custom](depth, opts, inspect) functions are not invoked.
    customInspect: bool = true,
    /// If true, Proxy inspection includes the target and handler objects.
    showProxy: bool = false,
    /// Specifies the maximum number of Array, TypedArray, Map, Set, WeakMap, and WeakSet elements to include when formatting.
    /// Set to null or Infinity to show all elements.
    /// Set to 0 or negative to show no elements.
    maxArrayLength: u32 = 100,
    /// Specifies the maximum number of characters to include when formatting. Set to null or Infinity to show all elements.
    /// Set to 0 or negative to show no characters.
    maxStringLength: u32 = 10000,
    /// The length at which input values are split across multiple lines.
    /// Set to Infinity to format the input as a single line (in combination with compact set to true or any number >= 1).
    breakLength: u32 = 80,
    /// Setting this to false causes each object key to be displayed on a new line.
    /// It will break on new lines in text that is longer than breakLength.
    /// If set to a number, the most n inner elements are united on a single line as long as all properties fit into breakLength.
    /// Short array elements are also grouped together.
    /// For more information, see the example below.
    compact: ?u32 = 3,
    /// If set to true or a function, all properties of an object, and Set and Map entries are sorted in the resulting string.
    /// If set to true the default sort is used.
    /// If set to a function, it is used as a compare function.
    sorted: JSValue = .undefined,
    /// If set to true, getters are inspected.
    /// If set to 'get', only getters without a corresponding setter are inspected.
    /// If set to 'set', only getters with a corresponding setter are inspected.
    /// This might cause side effects depending on the getter function.
    getters: enum { false, true, get, set } = .false,
    /// If set to true, an underscore is used to separate every three digits in all bigints and numbers.
    numericSeparator: bool = false,
};

pub fn parseInspectOptions(obj: JSValue, globalObject: *JSGlobalObject) !InspectOptions {
    return try validators.parseStruct(obj, globalObject, InspectOptions, "inspectOptions", .{
        .throw = true,
        .allowUndefinedFields = true,
    });
}

/// Maps options of InspectOptions into an ConsoleObject.Formatter instance
pub fn applyInspectOptionsToFormatter(options: *const InspectOptions, formatter: *ConsoleObject.Formatter) void {
    formatter.max_depth = options.depth + 1; // bun max_depth=1 corresponds to util.inspect depth=0
    formatter.hide_native = !options.showHidden;
    //formatter.color = options.color;

    // TODO: support other options in the formatter
}

pub const TestLabelFormatExtras = struct {
    test_idx: usize,
    table_headers: ?JSValue,
    root_object: ?JSValue,
};

/// Signatures:
///   util.inspect(object[, options])
///   util.inspect(object[, showHidden[, depth[, colors]]])
pub fn inspect(
    globalObject: *JSGlobalObject,
    callFrame: *JSC.CallFrame,
) callconv(.C) JSValue {
    JSC.markBinding(@src());
    const arguments = callFrame.argumentsSlice();

    const target_value = if (arguments.len > 0) arguments[0] else JSValue.undefined;

    var inspect_options: InspectOptions = InspectOptions{};
    if (arguments.len > 1) {
        if (arguments[1].isBoolean()) { // Signature #2: inspect(object[, showHidden[, depth[, colors]]])
            inspect_options.showHidden = validators.validateBoolean(globalObject, arguments[1], "showHidden", .{}) catch return .zero;
            if (arguments.len > 2) {
                inspect_options.depth = validators.validateInteger(u16, globalObject, arguments[2], "depth", .{}, null, null) catch return .zero;
                if (arguments.len > 3) {
                    inspect_options.colors = validators.validateBoolean(globalObject, arguments[3], "colors", .{}) catch return .zero;
                }
            }
        } else { // Signature #1: inspect(object[, options])
            inspect_options = parseInspectOptions(arguments[1], globalObject) catch return .zero;
        }
    }

    var formatter = ConsoleObject.Formatter{
        .remaining_values = &[_]JSValue{},
        .globalThis = globalObject,
        //.ordered_properties = false,
        //.quote_strings = true,
    };
    applyInspectOptionsToFormatter(&inspect_options, &formatter);

    return JSValue.printString(globalObject, 512, "{}", .{
        target_value.toFmt(globalObject, &formatter),
    }) catch {
        globalObject.throwOutOfMemory();
        return .zero;
    };
}

pub fn format(
    globalObject: *JSGlobalObject,
    callFrame: *JSC.CallFrame,
) callconv(.C) JSValue {
    JSC.markBinding(@src());
    const arguments = callFrame.argumentsSlice();

    return formatWithOptionsInternal(globalObject, .undefined, arguments) catch {
        return .zero;
    };
}

pub fn formatWithOptions(
    globalObject: *JSGlobalObject,
    callFrame: *JSC.CallFrame,
) callconv(.C) JSValue {
    JSC.markBinding(@src());
    const arguments = callFrame.argumentsSlice();

    const inspect_options = if (arguments.len > 0) arguments[0] else JSValue.zero;

    return formatWithOptionsInternal(globalObject, inspect_options, arguments[1..]) catch {
        return .zero;
    };
}

fn formatWithOptionsInternal(
    globalObject: *JSGlobalObject,
    inspect_options_value: JSValue,
    format_args: []const JSValue,
) !JSValue {
    var inspect_options = InspectOptions{};
    if (inspect_options_value != .zero) {
        inspect_options = try parseInspectOptions(inspect_options_value, globalObject);
    }

    var format_bunstr = bun.String.static("");
    var args = format_args;
    const first_arg = if (args.len > 0) args[0] else JSValue.undefined;
    if (first_arg.isString()) {
        format_bunstr = first_arg.toBunString(globalObject);
        args = args[1..];
    }

    var format_str = format_bunstr.toUTF8(globalObject.allocator());
    defer format_str.deinit();

    const WRITER_STACK_CAPACITY = 1024;
    var heap_fallback = std.heap.stackFallback(WRITER_STACK_CAPACITY, globalObject.allocator());

    var buf = try MutableString.init(heap_fallback.get(), @max(WRITER_STACK_CAPACITY, format_str.len));
    defer buf.deinit();

    try formatImpl(buf.writer(), globalObject, &inspect_options, format_str.slice(), args, void);

    return String.init(buf.toOwnedSliceLeaky()).toJS(globalObject);
}

const default_format_inspect_options = InspectOptions{
    .depth = 5,
    .colors = false,
    .compact = 3,
};

pub fn formatImpl(
    writer: anytype,
    globalObject: *JSGlobalObject,
    inspect_options: ?*const InspectOptions,
    pattern: []const u8,
    format_args: []const JSValue,
    extras: anytype,
) !void {
    var args_idx: usize = 0; // the current arg index of "format_args"
    var idx: usize = 0;
    var commited_idx: usize = 0;

    const allow_dollar_refs = comptime (@TypeOf(extras) == TestLabelFormatExtras);
    const print_remaining_args = comptime (@TypeOf(extras) != TestLabelFormatExtras);

    const root_object: ?JSValue = if (comptime @TypeOf(extras) == TestLabelFormatExtras) extras.root_object else null;

    while (idx < pattern.len) {
        const char = pattern[idx];
        if ((comptime allow_dollar_refs) and char == '$') {
            if (commited_idx < idx) { // flush pending unformatted chars
                try writer.writeAll(pattern[commited_idx..idx]);
            }

            idx += 1; // consume the '$'
            const path_start = idx;
            var key_start = idx;
            var value: ?JSValue = root_object;
            while (idx <= pattern.len) : (idx += 1) {
                const c = if (idx < pattern.len) pattern[idx] else ' ';
                if (!std.ascii.isAlphanumeric(c) and c != '_') {
                    // current key ends here
                    const end = idx;
                    if (key_start == end) { // path is invalid because includes a 0-length key, so just append the path as raw text
                        if (path_start - 1 < end) {
                            try writer.writeAll(pattern[(path_start - 1)..end]);
                        }
                        break;
                    }
                    const key = pattern[key_start..end];
                    if (value) |value_| { // resolve nested property
                        value = value_.get(globalObject, key);
                    } else { // resolve root object
                        value = JSValue.undefined; // default fallback
                        if (extras.table_headers) |headers_| {
                            const headers_len = headers_.getLength(globalObject);
                            for (0..headers_len) |col_idx| {
                                const header = headers_.getIndex(globalObject, @truncate(col_idx));
                                if (header.isString() and header.toBunString(globalObject).eqlUTF8(key)) {
                                    if (col_idx < format_args.len) {
                                        value = format_args[col_idx];
                                    }
                                    break;
                                }
                            }
                        }
                    }

                    if (c != '.') {
                        // we finished parsing this path, so print the resolved value
                        var formatter = ConsoleObject.Formatter{
                            .remaining_values = &[_]JSValue{},
                            .globalThis = globalObject,
                            .ordered_properties = false,
                            .quote_strings = true,
                        };
                        applyInspectOptionsToFormatter(inspect_options orelse &default_format_inspect_options, &formatter);
                        try writer.print("{}", .{(value orelse JSValue.undefined).toFmt(globalObject, &formatter)});
                        break;
                    }
                    key_start = idx + 1;
                }
            }
            commited_idx = idx;
        } else if (char == '%' and args_idx < format_args.len) {
            if (commited_idx < idx) { // flush pending unformatted chars
                try writer.writeAll(pattern[commited_idx..idx]);
            }

            const current_arg = format_args[args_idx];

            idx = idx + 1; // consume the '%'
            if (idx >= pattern.len) { // no followup char, reached end of pattern
                continue; // process this sole '%' as raw text
            }

            const percent_char = pattern[idx];
            idx = idx + 1; // consume the followup char

            var is_unknown_sequence = false;

            switch (percent_char) {
                's' => {
                    // %s: String will be used to convert all values except BigInt, Object and -0.
                    // BigInt values will be represented with an n and Objects that have no user defined toString function are inspected
                    // using util.inspect() with options { depth: 0, colors: false, compact: 3 }.
                    if (current_arg.isNumber() and current_arg.asNumber() == -0.0) {
                        try writer.writeAll("-0");
                    } else if (current_arg.isObject() and !current_arg.implementsToString(globalObject)) {
                        var formatter = ConsoleObject.Formatter{
                            .remaining_values = &[_]JSValue{},
                            .globalThis = globalObject,
                            .ordered_properties = false,
                            .quote_strings = true,
                        };
                        applyInspectOptionsToFormatter(inspect_options orelse &default_format_inspect_options, &formatter);

                        try writer.print("{}", .{current_arg.toFmt(globalObject, &formatter)});
                    } else {
                        var str = current_arg.toBunString(globalObject);
                        defer str.deref();

                        try writer.print("{}", .{str});
                        if (current_arg.isBigInt()) {
                            try writer.writeByte('n');
                        }
                    }

                    args_idx += 1; // consume arg
                },
                'd' => {
                    // %d: Number will be used to convert all values except BigInt and Symbol.
                    const num = current_arg.coerceToInt64(globalObject);
                    try writer.print("{d}", .{num});
                    args_idx += 1; // consume arg
                },
                'i' => {
                    // %i: parseInt(value, 10) is used for all values except BigInt and Symbol.
                    const num = current_arg.coerceToInt64(globalObject);
                    try writer.print("{d}", .{num});
                    args_idx += 1; // consume arg
                },
                'f' => {
                    // %f: parseFloat(value) is used for all values expect Symbol.
                    const num = current_arg.coerceToDouble(globalObject);
                    try writer.print("{d}", .{num});
                    args_idx += 1; // consume arg
                },
                'j', 'o', 'O' => {
                    // %j: JSON. Replaced with the string '[Circular]' if the argument contains circular references.
                    //
                    // %o: `Object`. A string representation of an object with generic JavaScript object formatting.
                    // Similar to util.inspect() with options { showHidden: true, showProxy: true }.
                    // This will show the full object including non-enumerable properties and proxies.
                    //
                    // %O: `Object`. A string representation of an object with generic JavaScript object formatting.
                    // Similar to util.inspect() without options.
                    // This will show the full object not including non-enumerable properties and proxies.

                    var str = bun.String.empty;
                    defer str.deref();
                    current_arg.jsonStringify(globalObject, 0, &str);

                    try writer.print("{}", .{str});
                    args_idx += 1;
                },
                'c' => {
                    // %c: CSS. This specifier is ignored and will skip any CSS passed in.
                    args_idx += 1; // consume arg
                },
                'p' => {
                    // %p: (bun only) pretty print
                    var formatter = ConsoleObject.Formatter{
                        .globalThis = globalObject,
                        .quote_strings = true,
                    };
                    applyInspectOptionsToFormatter(inspect_options orelse &default_format_inspect_options, &formatter);
                    try writer.print("{any}", .{current_arg.toFmt(globalObject, &formatter)});
                    args_idx += 1; // consume arg
                },
                '%' => {
                    // %%: single percent sign ('%'). This does not consume an argument.
                    try writer.writeByte('%');
                },
                else => {
                    if ((comptime @TypeOf(extras) == TestLabelFormatExtras) and (percent_char == '#')) {
                        // #: (only on test labels): the test index in a .each() sequence
                        try writer.print("{d}", .{extras.test_idx});
                    } else {
                        is_unknown_sequence = true;
                    }
                },
            }

            if (is_unknown_sequence) {
                // make the '%' and its followup char be printed as raw text
                commited_idx = idx - 2;
            } else {
                commited_idx = idx;
            }
        } else {
            idx += 1;
        }
    }

    // flush pending unformatted chars
    if (commited_idx < idx) {
        try writer.writeAll(pattern[commited_idx..idx]);
    }

    // print the remaining unused arguments
    if (comptime print_remaining_args) {
        while (args_idx < format_args.len) : (args_idx += 1) {
            var formatter = ConsoleObject.Formatter{
                .remaining_values = &[_]JSValue{},
                .globalThis = globalObject,
                .ordered_properties = false,
                .quote_strings = true,
            };
            applyInspectOptionsToFormatter(inspect_options orelse &default_format_inspect_options, &formatter);

            try writer.print(" {}", .{format_args[args_idx].toFmt(globalObject, &formatter)});
        }
    }
}
