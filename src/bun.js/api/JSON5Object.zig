pub fn create(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    const object = JSValue.createEmptyObject(globalThis, 2);
    object.put(
        globalThis,
        ZigString.static("parse"),
        jsc.JSFunction.create(globalThis, "parse", parse, 1, .{}),
    );
    object.put(
        globalThis,
        ZigString.static("stringify"),
        jsc.JSFunction.create(globalThis, "stringify", stringify, 3, .{}),
    );
    return object;
}

pub fn stringify(
    global: *jsc.JSGlobalObject,
    callFrame: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    const value, const replacer, const space_value = callFrame.argumentsAsArray(3);

    value.ensureStillAlive();

    if (value.isUndefined() or value.isSymbol() or value.isFunction()) {
        return .js_undefined;
    }

    if (!replacer.isUndefinedOrNull()) {
        return global.throw("JSON5.stringify does not support the replacer argument", .{});
    }

    var stringifier: Stringifier = try .init(global, space_value);
    defer stringifier.deinit();

    stringifier.stringifyValue(global, value) catch |err| return switch (err) {
        error.OutOfMemory, error.JSError, error.JSTerminated => |js_err| js_err,
        error.StackOverflow => global.throwStackOverflow(),
    };

    return stringifier.builder.toString(global);
}

pub fn parse(
    global: *jsc.JSGlobalObject,
    callFrame: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    var arena: bun.ArenaAllocator = .init(bun.default_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var ast_memory_allocator = bun.handleOom(allocator.create(ast.ASTMemoryAllocator));
    var ast_scope = ast_memory_allocator.enter(allocator);
    defer ast_scope.exit();

    const input_value = callFrame.argument(0);

    if (input_value.isEmptyOrUndefinedOrNull()) {
        return global.throwInvalidArguments("Expected a string to parse", .{});
    }

    const input: jsc.Node.BlobOrStringOrBuffer =
        try jsc.Node.BlobOrStringOrBuffer.fromJS(global, allocator, input_value) orelse input: {
            var str = try input_value.toBunString(global);
            defer str.deref();
            break :input .{ .string_or_buffer = .{ .string = str.toSlice(allocator) } };
        };
    defer input.deinit();

    var log = logger.Log.init(bun.default_allocator);
    defer log.deinit();

    const source = &logger.Source.initPathString("input.json5", input.slice());

    const root = json5.JSON5Parser.parse(source, &log, allocator) catch |err| return switch (err) {
        error.OutOfMemory => |oom| oom,
        error.StackOverflow => global.throwStackOverflow(),
        else => {
            if (log.msgs.items.len > 0) {
                const first_msg = log.msgs.items[0];
                return global.throwValue(global.createSyntaxErrorInstance(
                    "JSON5 Parse error: {s}",
                    .{first_msg.data.text},
                ));
            }
            return global.throwValue(global.createSyntaxErrorInstance(
                "JSON5 Parse error: Unable to parse JSON5 string",
                .{},
            ));
        },
    };

    return exprToJS(root, global);
}

const Stringifier = struct {
    stack_check: bun.StackCheck,
    builder: wtf.StringBuilder,
    indent: usize,
    space: Space,
    visiting: std.AutoHashMapUnmanaged(JSValue, void),
    allocator: std.mem.Allocator,

    const StringifyError = bun.JSError || bun.StackOverflow;

    const Space = union(enum) {
        minified,
        number: u32,
        str: bun.String,

        pub fn init(global: *jsc.JSGlobalObject, space_value: JSValue) bun.JSError!Space {
            const space = try space_value.unwrapBoxedPrimitive(global);
            if (space.isNumber()) {
                // Clamp on the float to match the spec's min(10, ToIntegerOrInfinity(space)).
                // toInt32() wraps large values and Infinity to 0, which is wrong.
                const num_f = space.asNumber();
                if (!(num_f >= 1)) return .minified; // handles NaN, -Infinity, 0, negatives
                return .{ .number = if (num_f > 10) 10 else @intFromFloat(num_f) };
            }
            if (space.isString()) {
                const str = try space.toBunString(global);
                if (str.length() == 0) {
                    str.deref();
                    return .minified;
                }
                return .{ .str = str };
            }
            return .minified;
        }

        pub fn deinit(this: *const Space) void {
            switch (this.*) {
                .str => |str| str.deref(),
                .minified, .number => {},
            }
        }
    };

    pub fn init(global: *jsc.JSGlobalObject, space_value: JSValue) bun.JSError!Stringifier {
        return .{
            .stack_check = .init(),
            .builder = .init(),
            .indent = 0,
            .space = try Space.init(global, space_value),
            .visiting = .empty,
            .allocator = bun.default_allocator,
        };
    }

    pub fn deinit(this: *Stringifier) void {
        this.builder.deinit();
        this.space.deinit();
        this.visiting.deinit(this.allocator);
    }

    pub fn stringifyValue(this: *Stringifier, global: *jsc.JSGlobalObject, value: JSValue) StringifyError!void {
        if (!this.stack_check.isSafeToRecurse()) {
            return error.StackOverflow;
        }

        const unwrapped = try value.unwrapBoxedPrimitive(global);

        if (unwrapped.isNull()) {
            this.builder.append(.latin1, "null");
            return;
        }

        if (unwrapped.isNumber()) {
            if (unwrapped.isInt32()) {
                this.builder.append(.int, unwrapped.asInt32());
                return;
            }
            const num = unwrapped.asNumber();
            if (std.math.isNegativeInf(num)) {
                this.builder.append(.latin1, "-Infinity");
            } else if (std.math.isInf(num)) {
                this.builder.append(.latin1, "Infinity");
            } else if (std.math.isNan(num)) {
                this.builder.append(.latin1, "NaN");
            } else {
                this.builder.append(.double, num);
            }
            return;
        }

        if (unwrapped.isBigInt()) {
            return global.throw("JSON5.stringify cannot serialize BigInt", .{});
        }

        if (unwrapped.isBoolean()) {
            this.builder.append(.latin1, if (unwrapped.asBoolean()) "true" else "false");
            return;
        }

        if (unwrapped.isString()) {
            const str = try unwrapped.toBunString(global);
            defer str.deref();
            this.appendQuotedString(str);
            return;
        }

        // Object or array — check for circular references
        const gop = try this.visiting.getOrPut(this.allocator, unwrapped);
        if (gop.found_existing) {
            return global.throw("Converting circular structure to JSON5", .{});
        }
        defer _ = this.visiting.remove(unwrapped);

        if (unwrapped.isArray()) {
            try this.stringifyArray(global, unwrapped);
        } else {
            try this.stringifyObject(global, unwrapped);
        }
    }

    fn stringifyArray(this: *Stringifier, global: *jsc.JSGlobalObject, value: JSValue) StringifyError!void {
        var iter = try value.arrayIterator(global);

        if (iter.len == 0) {
            this.builder.append(.latin1, "[]");
            return;
        }

        this.builder.append(.lchar, '[');

        switch (this.space) {
            .minified => {
                var first = true;
                while (try iter.next()) |item| {
                    if (!first) this.builder.append(.lchar, ',');
                    first = false;
                    if (item.isUndefined() or item.isSymbol() or item.isFunction()) {
                        this.builder.append(.latin1, "null");
                    } else {
                        try this.stringifyValue(global, item);
                    }
                }
            },
            .number, .str => {
                this.indent += 1;
                var first = true;
                while (try iter.next()) |item| {
                    if (!first) this.builder.append(.lchar, ',');
                    first = false;
                    this.newline();
                    if (item.isUndefined() or item.isSymbol() or item.isFunction()) {
                        this.builder.append(.latin1, "null");
                    } else {
                        try this.stringifyValue(global, item);
                    }
                }
                // Trailing comma
                this.builder.append(.lchar, ',');
                this.indent -= 1;
                this.newline();
            },
        }

        this.builder.append(.lchar, ']');
    }

    fn stringifyObject(this: *Stringifier, global: *jsc.JSGlobalObject, value: JSValue) StringifyError!void {
        var iter: jsc.JSPropertyIterator(.{ .skip_empty_name = false, .include_value = true }) = try .init(
            global,
            try value.toObject(global),
        );
        defer iter.deinit();

        if (iter.len == 0) {
            this.builder.append(.latin1, "{}");
            return;
        }

        this.builder.append(.lchar, '{');

        switch (this.space) {
            .minified => {
                var first = true;
                while (try iter.next()) |prop_name| {
                    if (iter.value.isUndefined() or iter.value.isSymbol() or iter.value.isFunction()) {
                        continue;
                    }
                    if (!first) this.builder.append(.lchar, ',');
                    first = false;
                    this.appendKey(prop_name);
                    this.builder.append(.lchar, ':');
                    try this.stringifyValue(global, iter.value);
                }
            },
            .number, .str => {
                this.indent += 1;
                var first = true;
                while (try iter.next()) |prop_name| {
                    if (iter.value.isUndefined() or iter.value.isSymbol() or iter.value.isFunction()) {
                        continue;
                    }
                    if (!first) this.builder.append(.lchar, ',');
                    first = false;
                    this.newline();
                    this.appendKey(prop_name);
                    this.builder.append(.latin1, ": ");
                    try this.stringifyValue(global, iter.value);
                }
                this.indent -= 1;
                if (!first) {
                    // Trailing comma
                    this.builder.append(.lchar, ',');
                    this.newline();
                }
            },
        }

        this.builder.append(.lchar, '}');
    }

    fn appendKey(this: *Stringifier, name: bun.String) void {
        const is_identifier = is_identifier: {
            if (name.length() == 0) break :is_identifier false;
            if (!bun.js_lexer.isIdentifierStart(@intCast(name.charAt(0)))) break :is_identifier false;
            for (1..name.length()) |i| {
                if (!bun.js_lexer.isIdentifierContinue(@intCast(name.charAt(i)))) break :is_identifier false;
            }
            break :is_identifier true;
        };

        if (is_identifier) {
            this.builder.append(.string, name);
        } else {
            this.appendQuotedString(name);
        }
    }

    fn appendQuotedString(this: *Stringifier, str: bun.String) void {
        this.builder.append(.lchar, '\'');
        for (0..str.length()) |i| {
            const c = str.charAt(i);
            switch (c) {
                0x00 => this.builder.append(.latin1, "\\0"),
                0x08 => this.builder.append(.latin1, "\\b"),
                0x09 => this.builder.append(.latin1, "\\t"),
                0x0a => this.builder.append(.latin1, "\\n"),
                0x0b => this.builder.append(.latin1, "\\v"),
                0x0c => this.builder.append(.latin1, "\\f"),
                0x0d => this.builder.append(.latin1, "\\r"),
                0x27 => this.builder.append(.latin1, "\\'"), // single quote
                0x5c => this.builder.append(.latin1, "\\\\"), // backslash
                0x2028 => this.builder.append(.latin1, "\\u2028"),
                0x2029 => this.builder.append(.latin1, "\\u2029"),
                0x01...0x07, 0x0e...0x1f, 0x7f => {
                    // Other control chars → \xHH
                    this.builder.append(.latin1, "\\x");
                    this.builder.append(.lchar, hexDigit(c >> 4));
                    this.builder.append(.lchar, hexDigit(c & 0x0f));
                },
                else => this.builder.append(.uchar, c),
            }
        }
        this.builder.append(.lchar, '\'');
    }

    fn hexDigit(v: u16) u8 {
        const nibble: u8 = @intCast(v & 0x0f);
        return if (nibble < 10) '0' + nibble else 'a' + nibble - 10;
    }

    fn newline(this: *Stringifier) void {
        switch (this.space) {
            .minified => {},
            .number => |space_num| {
                this.builder.append(.lchar, '\n');
                for (0..this.indent * space_num) |_| {
                    this.builder.append(.lchar, ' ');
                }
            },
            .str => |space_str| {
                this.builder.append(.lchar, '\n');
                const clamped = if (space_str.length() > 10)
                    space_str.substringWithLen(0, 10)
                else
                    space_str;
                for (0..this.indent) |_| {
                    this.builder.append(.string, clamped);
                }
            },
        }
    }
};

fn exprToJS(expr: Expr, global: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    switch (expr.data) {
        .e_null => return .null,
        .e_boolean => |boolean| return .jsBoolean(boolean.value),
        .e_number => |number| return .jsNumber(number.value),
        .e_string => |str| {
            return str.toJS(bun.default_allocator, global);
        },
        .e_array => |arr| {
            var js_arr = try JSValue.createEmptyArray(global, arr.items.len);
            for (arr.slice(), 0..) |item, _i| {
                const i: u32 = @intCast(_i);
                const value = try exprToJS(item, global);
                try js_arr.putIndex(global, i, value);
            }
            return js_arr;
        },
        .e_object => |obj| {
            var js_obj = JSValue.createEmptyObject(global, obj.properties.len);
            for (obj.properties.slice()) |prop| {
                const key_expr = prop.key.?;
                const value = try exprToJS(prop.value.?, global);
                const key_js = try exprToJS(key_expr, global);
                const key_str = try key_js.toBunString(global);
                defer key_str.deref();
                try js_obj.putMayBeIndex(global, &key_str, value);
            }
            return js_obj;
        },
        else => return .js_undefined,
    }
}

const std = @import("std");

const bun = @import("bun");
const logger = bun.logger;
const json5 = bun.interchange.json5;

const ast = bun.ast;
const Expr = ast.Expr;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
const wtf = jsc.wtf;
