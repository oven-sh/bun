pub fn create(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
    const object = JSValue.createEmptyObject(globalObject, 1);
    object.put(
        globalObject,
        ZigString.static("parse"),
        JSC.createCallback(
            globalObject,
            ZigString.static("parse"),
            2,
            parse,
        ),
    );

    return object;
}

pub fn parse(
    globalObject: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    var arena = bun.ArenaAllocator.init(globalObject.allocator());
    const allocator = arena.allocator();
    defer arena.deinit();

    var log = logger.Log.init(default_allocator);
    defer log.deinit();

    const arguments = callframe.arguments();
    if (arguments.len == 0 or arguments[0].isEmptyOrUndefinedOrNull()) {
        return globalObject.throwInvalidArguments("Expected a string to parse", .{});
    }

    // Default parser options
    var parser_options = CSV.CSVParserOptions{};

    // Process options if provided
    if (arguments.len > 1 and !arguments[1].isEmptyOrUndefinedOrNull() and arguments[1].isObject()) {
        const options = arguments[1];

        const header_value = try options.get(globalObject, "header");
        if (header_value) |hv| {
            if (hv.isBoolean()) {
                parser_options.header = hv.asBoolean();
            }
        }

        const delimiter_value = try options.get(globalObject, "delimiter");
        if (delimiter_value) |dv| {
            if (dv.isString()) {
                const dv_ = try dv.toSlice(globalObject, allocator);
                defer dv_.deinit();
                if (!isSingleGrapheme(dv_.slice())) {
                    return globalObject.throwInvalidArguments("delimiter must be a single character", .{});
                }
                parser_options.delimiter = allocator.dupe(u8, dv_.slice()) catch return bun.outOfMemory();
            }
        }

        if (try options.get(globalObject, "comments")) |comments_value| {
            if (comments_value.isBoolean()) {
                parser_options.comments = comments_value.asBoolean();
            }
        }

        if (try options.get(globalObject, "commentChar")) |comment_char_value| {
            if (comment_char_value.isString()) {
                const js_string = comment_char_value.asString();
                if (js_string.length() != 1) {
                    return globalObject.throwInvalidArguments("commentChar must be a single character", .{});
                }
                const comment_char_value_ = try comment_char_value.toSlice(globalObject, allocator);
                defer comment_char_value_.deinit();
                parser_options.comment_char = allocator.dupe(u8, comment_char_value_.slice()) catch return bun.outOfMemory();
            }
        }

        if (try options.get(globalObject, "trimWhitespace")) |trim_value| {
            if (trim_value.isBoolean()) {
                parser_options.trim_whitespace = trim_value.asBoolean();
            }
        }

        if (try options.get(globalObject, "dynamicTyping")) |typing_value| {
            if (typing_value.isBoolean()) {
                parser_options.dynamic_typing = typing_value.asBoolean();
            }
        }

        if (try options.get(globalObject, "quote")) |quote_value| {
            if (quote_value.isString()) {
                const quote_value_ = try quote_value.toSlice(globalObject, allocator);
                defer quote_value_.deinit();
                if (!isSingleGrapheme(quote_value_.slice())) {
                    return globalObject.throwInvalidArguments("quote must be a single character", .{});
                }
                parser_options.quote = allocator.dupe(u8, quote_value_.slice()) catch return bun.outOfMemory();
            }
        }

        if (try options.get(globalObject, "preview")) |preview_value| {
            if (!preview_value.isNumber()) {
                return globalObject.throwInvalidArguments("Preview value must be a positive integer", .{});
            }

            const value = preview_value.asNumber();

            if (!std.math.isFinite(value)) {
                return globalObject.throwInvalidArguments("Preview value must be finite", .{});
            }

            if (!(value >= 1 and value == @floor(value))) {
                return globalObject.throwInvalidArguments("Preview value must be a positive integer", .{});
            }

            const max_preview = @as(f64, @floatFromInt(std.math.maxInt(usize)));
            if (value > max_preview) {
                return globalObject.throwInvalidArguments("Preview value too large", .{});
            }

            parser_options.preview = @intFromFloat(value);
        }

        if (try options.get(globalObject, "skipEmptyLines")) |skip_value| {
            if (skip_value.isBoolean()) {
                parser_options.skip_empty_lines = skip_value.asBoolean();
            }
        }
    }

    var input_slice = arguments[0].toSlice(globalObject, allocator) catch {
        return globalObject.throwValue(log.toJS(globalObject, default_allocator, "Failed to get the string out of the JS world") catch bun.outOfMemory());
    };
    defer input_slice.deinit();
    var source = logger.Source.initPathString("input.csv", input_slice.slice());

    // Parse the CSV data
    const parse_result = CSV.CSV.parse(&source, &log, allocator, parser_options) catch {
        return globalObject.throwValue(log.toJS(globalObject, default_allocator, "Failed to parse CSV") catch bun.outOfMemory());
    };

    const js_val = parse_result.toJS(allocator, globalObject) catch |err| switch (err) {
        error.OutOfMemory => return bun.outOfMemory(),
        else => {
            // clear the JSC exception so we can throw our own
            globalObject.clearException();
            return globalObject.throwValue(log.toJS(globalObject, default_allocator, "Failed to convert CSV to JS") catch bun.outOfMemory());
        },
    };

    return js_val;
}

fn isSingleGrapheme(str: []const u8) bool {
    const count = std.unicode.utf8CountCodepoints(str) catch 0;
    return count == 1;
}

const CSVObject = @This();
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const JSObject = JSC.JSObject;
const std = @import("std");
const ZigString = JSC.ZigString;
const logger = bun.logger;
const bun = @import("bun");
const js_printer = bun.js_printer;
const default_allocator = bun.default_allocator;
const CSV = bun.interchange.csv;
