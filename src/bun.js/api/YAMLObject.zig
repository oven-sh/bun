pub fn create(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    const object = JSValue.createEmptyObject(globalThis, 2);
    object.put(
        globalThis,
        ZigString.static("parse"),
        jsc.JSFunction.create(
            globalThis,
            "parse",
            parse,
            1,
            .{},
        ),
    );
    object.put(
        globalThis,
        ZigString.static("stringify"),
        jsc.JSFunction.create(
            globalThis,
            "stringify",
            stringify,
            3,
            .{},
        ),
    );

    return object;
}

pub fn stringify(global: *JSGlobalObject, callFrame: *jsc.CallFrame) JSError!JSValue {
    const value, const replacer, const space_value = callFrame.argumentsAsArray(3);

    value.ensureStillAlive();

    if (value.isUndefined() or value.isSymbol() or value.isFunction()) {
        return .js_undefined;
    }

    if (!replacer.isUndefinedOrNull()) {
        return global.throw("YAML.stringify does not support the replacer argument", .{});
    }

    var scope: bun.AllocationScope = .init(bun.default_allocator);
    defer scope.deinit();

    var stringifier: Stringifier = try .init(scope.allocator(), global, space_value);
    defer stringifier.deinit();

    stringifier.findAnchorsAndAliases(global, value, .root) catch |err| return switch (err) {
        error.OutOfMemory, error.JSError, error.JSTerminated => |js_err| js_err,
        error.StackOverflow => global.throwStackOverflow(),
    };

    stringifier.stringify(global, value) catch |err| return switch (err) {
        error.OutOfMemory, error.JSError, error.JSTerminated => |js_err| js_err,
        error.StackOverflow => global.throwStackOverflow(),
    };

    return stringifier.builder.toString(global);
}

const Stringifier = struct {
    stack_check: bun.StackCheck,
    builder: wtf.StringBuilder,
    indent: usize,

    known_collections: std.AutoHashMap(JSValue, AnchorAlias),
    array_item_counter: usize,
    prop_names: bun.StringHashMap(usize),

    space: Space,

    pub const Space = union(enum) {
        minified,
        number: u32,
        str: String,

        pub fn init(global: *JSGlobalObject, space_value: JSValue) JSError!Space {
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
                .minified => {},
                .number => {},
                .str => |str| {
                    str.deref();
                },
            }
        }
    };

    const AnchorOrigin = enum {
        root,
        array_item,
        prop_value,
    };

    const AnchorAlias = struct {
        anchored: bool,
        used: bool,
        name: Name,

        pub fn init(origin: ValueOrigin) AnchorAlias {
            return .{
                .anchored = false,
                .used = false,
                .name = switch (origin) {
                    .root => .root,
                    .array_item => .{ .array_item = 0 },
                    .prop_value => .{ .prop_value = .{ .prop_name = origin.prop_value, .counter = 0 } },
                },
            };
        }

        pub const Name = union(AnchorOrigin) {
            // only one root anchor is possible
            root,
            array_item: usize,
            prop_value: struct {
                prop_name: String,
                // added after the name
                counter: usize,
            },
        };
    };

    pub fn init(allocator: std.mem.Allocator, global: *JSGlobalObject, space_value: JSValue) JSError!Stringifier {
        var prop_names: bun.StringHashMap(usize) = .init(allocator);
        // always rename anchors named "root" to avoid collision with
        // root anchor/alias
        try prop_names.put("root", 0);

        return .{
            .stack_check = .init(),
            .builder = .init(),
            .indent = 0,
            .known_collections = .init(allocator),
            .array_item_counter = 0,
            .prop_names = prop_names,
            .space = try .init(global, space_value),
        };
    }

    pub fn deinit(this: *Stringifier) void {
        this.builder.deinit();
        this.known_collections.deinit();
        this.prop_names.deinit();
        this.space.deinit();
    }

    const ValueOrigin = union(AnchorOrigin) {
        root,
        array_item,
        prop_value: String,
    };

    pub fn findAnchorsAndAliases(this: *Stringifier, global: *JSGlobalObject, value: JSValue, origin: ValueOrigin) StringifyError!void {
        if (!this.stack_check.isSafeToRecurse()) {
            return error.StackOverflow;
        }

        const unwrapped = try value.unwrapBoxedPrimitive(global);

        if (unwrapped.isNull()) {
            return;
        }

        if (unwrapped.isNumber()) {
            return;
        }

        if (unwrapped.isBigInt()) {
            return global.throw("YAML.stringify cannot serialize BigInt", .{});
        }

        if (unwrapped.isBoolean()) {
            return;
        }

        if (unwrapped.isString()) {
            return;
        }

        if (comptime Environment.ci_assert) {
            bun.assertWithLocation(unwrapped.isObject(), @src());
        }

        const object_entry = try this.known_collections.getOrPut(unwrapped);
        if (object_entry.found_existing) {
            // this will become an alias. increment counters here because
            // now the anchor/alias is confirmed used.

            if (object_entry.value_ptr.used) {
                return;
            }

            object_entry.value_ptr.used = true;

            switch (object_entry.value_ptr.name) {
                .root => {
                    // only one possible
                },
                .array_item => |*counter| {
                    counter.* = this.array_item_counter;
                    this.array_item_counter += 1;
                },
                .prop_value => |*prop_value| {
                    const name_entry = try this.prop_names.getOrPut(prop_value.prop_name.byteSlice());
                    if (name_entry.found_existing) {
                        name_entry.value_ptr.* += 1;
                    } else {
                        name_entry.value_ptr.* = 0;
                    }

                    prop_value.counter = name_entry.value_ptr.*;
                },
            }
            return;
        }

        object_entry.value_ptr.* = .init(origin);

        if (unwrapped.isArray()) {
            var iter = try unwrapped.arrayIterator(global);
            while (try iter.next()) |item| {
                if (item.isUndefined() or item.isSymbol() or item.isFunction()) {
                    continue;
                }

                try this.findAnchorsAndAliases(global, item, .array_item);
            }
            return;
        }

        var iter: jsc.JSPropertyIterator(.{ .skip_empty_name = false, .include_value = true }) = try .init(
            global,
            try unwrapped.toObject(global),
        );
        defer iter.deinit();

        while (try iter.next()) |prop_name| {
            if (iter.value.isUndefined() or iter.value.isSymbol() or iter.value.isFunction()) {
                continue;
            }
            try this.findAnchorsAndAliases(global, iter.value, .{ .prop_value = prop_name });
        }
    }

    const StringifyError = JSError || bun.StackOverflow;

    pub fn stringify(this: *Stringifier, global: *JSGlobalObject, value: JSValue) StringifyError!void {
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
                this.builder.append(.latin1, "-.inf");
                // } else if (std.math.isPositiveInf(num)) {
                //     builder.append(.latin1, "+.inf");
            } else if (std.math.isInf(num)) {
                this.builder.append(.latin1, ".inf");
            } else if (std.math.isNan(num)) {
                this.builder.append(.latin1, ".nan");
            } else if (std.math.isNegativeZero(num)) {
                this.builder.append(.latin1, "-0");
            } else if (std.math.isPositiveZero(num)) {
                this.builder.append(.latin1, "+0");
            } else {
                this.builder.append(.double, num);
            }
            return;
        }

        if (unwrapped.isBigInt()) {
            return global.throw("YAML.stringify cannot serialize BigInt", .{});
        }

        if (unwrapped.isBoolean()) {
            if (unwrapped.asBoolean()) {
                this.builder.append(.latin1, "true");
            } else {
                this.builder.append(.latin1, "false");
            }
            return;
        }

        if (unwrapped.isString()) {
            const value_str = try unwrapped.toBunString(global);
            defer value_str.deref();

            this.appendString(value_str);
            return;
        }

        if (comptime Environment.ci_assert) {
            bun.assertWithLocation(unwrapped.isObject(), @src());
        }

        const has_anchor: ?*AnchorAlias = has_anchor: {
            const anchor = this.known_collections.getPtr(unwrapped) orelse {
                break :has_anchor null;
            };

            if (!anchor.used) {
                break :has_anchor null;
            }

            break :has_anchor anchor;
        };

        if (has_anchor) |anchor| {
            this.builder.append(.lchar, if (anchor.anchored) '*' else '&');

            switch (anchor.name) {
                .root => {
                    this.builder.append(.latin1, "root");
                },
                .array_item => {
                    this.builder.append(.latin1, "item");
                    this.builder.append(.usize, anchor.name.array_item);
                },
                .prop_value => |prop_value| {
                    if (prop_value.prop_name.length() == 0) {
                        this.builder.append(.latin1, "value");
                        this.builder.append(.usize, prop_value.counter);
                    } else {
                        this.builder.append(.string, anchor.name.prop_value.prop_name);
                        if (anchor.name.prop_value.counter != 0) {
                            this.builder.append(.usize, anchor.name.prop_value.counter);
                        }
                    }
                },
            }

            if (anchor.anchored) {
                return;
            }

            switch (this.space) {
                .minified => {
                    this.builder.append(.lchar, ' ');
                },
                .number, .str => {
                    this.newline();
                },
            }
            anchor.anchored = true;
        }

        if (unwrapped.isArray()) {
            var iter = try unwrapped.arrayIterator(global);

            if (iter.len == 0) {
                this.builder.append(.latin1, "[]");
                return;
            }

            switch (this.space) {
                .minified => {
                    this.builder.append(.lchar, '[');
                    var first = true;
                    while (try iter.next()) |item| {
                        if (item.isUndefined() or item.isSymbol() or item.isFunction()) {
                            continue;
                        }

                        if (!first) {
                            this.builder.append(.lchar, ',');
                        }
                        first = false;

                        try this.stringify(global, item);
                    }
                    this.builder.append(.lchar, ']');
                },
                .number, .str => {
                    this.builder.ensureUnusedCapacity(iter.len * "- ".len);
                    var first = true;
                    while (try iter.next()) |item| {
                        if (item.isUndefined() or item.isSymbol() or item.isFunction()) {
                            continue;
                        }

                        if (!first) {
                            this.newline();
                        }
                        first = false;

                        this.builder.append(.latin1, "- ");

                        // don't need to print a newline here for any value

                        this.indent += 1;
                        try this.stringify(global, item);
                        this.indent -= 1;
                    }
                },
            }

            return;
        }

        var iter: jsc.JSPropertyIterator(.{ .skip_empty_name = false, .include_value = true }) = try .init(
            global,
            try unwrapped.toObject(global),
        );
        defer iter.deinit();

        if (iter.len == 0) {
            this.builder.append(.latin1, "{}");
            return;
        }

        switch (this.space) {
            .minified => {
                this.builder.append(.lchar, '{');
                var first = true;
                while (try iter.next()) |prop_name| {
                    if (iter.value.isUndefined() or iter.value.isSymbol() or iter.value.isFunction()) {
                        continue;
                    }

                    if (!first) {
                        this.builder.append(.lchar, ',');
                    }
                    first = false;

                    this.appendString(prop_name);
                    this.builder.append(.latin1, ": ");

                    try this.stringify(global, iter.value);
                }
                this.builder.append(.lchar, '}');
            },
            .number, .str => {
                this.builder.ensureUnusedCapacity(iter.len * ": ".len);

                var first = true;
                while (try iter.next()) |prop_name| {
                    if (iter.value.isUndefined() or iter.value.isSymbol() or iter.value.isFunction()) {
                        continue;
                    }

                    if (!first) {
                        this.newline();
                    }
                    first = false;

                    this.appendString(prop_name);
                    this.builder.append(.latin1, ": ");

                    this.indent += 1;

                    if (propValueNeedsNewline(iter.value)) {
                        this.newline();
                    }

                    try this.stringify(global, iter.value);
                    this.indent -= 1;
                }
                if (first) {
                    this.builder.append(.latin1, "{}");
                }
            },
        }
    }

    /// Does this object property value need a newline? True for arrays and objects.
    fn propValueNeedsNewline(value: JSValue) bool {
        return !value.isNumber() and !value.isBoolean() and !value.isNull() and !value.isString();
    }

    fn newline(this: *Stringifier) void {
        const indent_count = this.indent;

        switch (this.space) {
            .minified => {},
            .number => |space_num| {
                this.builder.append(.lchar, '\n');
                this.builder.ensureUnusedCapacity(indent_count * space_num);
                for (0..indent_count * space_num) |_| {
                    this.builder.append(.lchar, ' ');
                }
            },
            .str => |space_str| {
                this.builder.append(.lchar, '\n');

                const clamped = if (space_str.length() > 10)
                    space_str.substringWithLen(0, 10)
                else
                    space_str;

                this.builder.ensureUnusedCapacity(indent_count * clamped.length());
                for (0..indent_count) |_| {
                    this.builder.append(.string, clamped);
                }
            },
        }
    }

    fn appendDoubleQuotedString(this: *Stringifier, str: String) void {
        this.builder.append(.lchar, '"');

        for (0..str.length()) |i| {
            const c = str.charAt(i);

            switch (c) {
                0x00 => this.builder.append(.latin1, "\\0"),
                0x01 => this.builder.append(.latin1, "\\x01"),
                0x02 => this.builder.append(.latin1, "\\x02"),
                0x03 => this.builder.append(.latin1, "\\x03"),
                0x04 => this.builder.append(.latin1, "\\x04"),
                0x05 => this.builder.append(.latin1, "\\x05"),
                0x06 => this.builder.append(.latin1, "\\x06"),
                0x07 => this.builder.append(.latin1, "\\a"), // bell
                0x08 => this.builder.append(.latin1, "\\b"), // backspace
                0x09 => this.builder.append(.latin1, "\\t"), // tab
                0x0a => this.builder.append(.latin1, "\\n"), // line feed
                0x0b => this.builder.append(.latin1, "\\v"), // vertical tab
                0x0c => this.builder.append(.latin1, "\\f"), // form feed
                0x0d => this.builder.append(.latin1, "\\r"), // carriage return
                0x0e => this.builder.append(.latin1, "\\x0e"),
                0x0f => this.builder.append(.latin1, "\\x0f"),
                0x10 => this.builder.append(.latin1, "\\x10"),
                0x11 => this.builder.append(.latin1, "\\x11"),
                0x12 => this.builder.append(.latin1, "\\x12"),
                0x13 => this.builder.append(.latin1, "\\x13"),
                0x14 => this.builder.append(.latin1, "\\x14"),
                0x15 => this.builder.append(.latin1, "\\x15"),
                0x16 => this.builder.append(.latin1, "\\x16"),
                0x17 => this.builder.append(.latin1, "\\x17"),
                0x18 => this.builder.append(.latin1, "\\x18"),
                0x19 => this.builder.append(.latin1, "\\x19"),
                0x1a => this.builder.append(.latin1, "\\x1a"),
                0x1b => this.builder.append(.latin1, "\\e"), // escape
                0x1c => this.builder.append(.latin1, "\\x1c"),
                0x1d => this.builder.append(.latin1, "\\x1d"),
                0x1e => this.builder.append(.latin1, "\\x1e"),
                0x1f => this.builder.append(.latin1, "\\x1f"),
                0x22 => this.builder.append(.latin1, "\\\""), // "
                0x5c => this.builder.append(.latin1, "\\\\"), // \
                0x7f => this.builder.append(.latin1, "\\x7f"), // delete
                0x85 => this.builder.append(.latin1, "\\N"), // next line
                0xa0 => this.builder.append(.latin1, "\\_"), // non-breaking space
                0xa8 => this.builder.append(.latin1, "\\L"), // line separator
                0xa9 => this.builder.append(.latin1, "\\P"), // paragraph separator

                0x20...0x21,
                0x23...0x5b,
                0x5d...0x7e,
                0x80...0x84,
                0x86...0x9f,
                0xa1...0xa7,
                0xaa...std.math.maxInt(u16),
                => this.builder.append(.uchar, c),
            }
        }

        this.builder.append(.lchar, '"');
    }

    fn appendString(this: *Stringifier, str: String) void {
        if (stringNeedsQuotes(str)) {
            this.appendDoubleQuotedString(str);
            return;
        }
        this.builder.append(.string, str);
    }

    fn stringNeedsQuotes(str: String) bool {
        if (str.isEmpty()) {
            return true;
        }

        switch (str.charAt(str.length() - 1)) {
            // whitespace characters
            ' ',
            '\t',
            '\n',
            '\r',
            // trailing colon can be misinterpreted as a mapping indicator
            // https://github.com/oven-sh/bun/issues/25439
            ':',
            => return true,
            else => {},
        }

        switch (str.charAt(0)) {
            // starting with an indicator character requires quotes
            '&',
            '*',
            '?',
            '|',
            '-',
            '<',
            '>',
            '!',
            '%',
            '@',
            ':',
            ',',
            '[',
            ']',
            '{',
            '}',
            '#',
            '\'',
            '"',
            '`',
            // starting with whitespace requires quotes
            ' ',
            '\t',
            '\n',
            '\r',
            => return true,

            else => {},
        }

        const keywords = &.{
            "true",
            "True",
            "TRUE",
            "false",
            "False",
            "FALSE",
            "yes",
            "Yes",
            "YES",
            "no",
            "No",
            "NO",
            "on",
            "On",
            "ON",
            "off",
            "Off",
            "OFF",
            "n",
            "N",
            "y",
            "Y",
            "null",
            "Null",
            "NULL",
            "~",
            ".inf",
            ".Inf",
            ".INF",
            ".nan",
            ".NaN",
            ".NAN",
        };

        inline for (keywords) |keyword| {
            if (str.eqlComptime(keyword)) {
                return true;
            }
        }

        var i: usize = 0;
        while (i < str.length()) {
            switch (str.charAt(i)) {
                // flow indicators need to be quoted always
                '{',
                '}',
                '[',
                ']',
                ',',
                => return true,

                ':',
                => {
                    if (i + 1 < str.length()) {
                        switch (str.charAt(i + 1)) {
                            ' ',
                            '\t',
                            '\n',
                            '\r',
                            => return true,
                            else => {},
                        }
                    }
                    i += 1;
                },

                '#',
                '`',
                '\'',
                => return true,

                '-' => {
                    if (i + 2 < str.length() and str.charAt(i + 1) == '-' and str.charAt(i + 2) == '-') {
                        if (i + 3 >= str.length()) {
                            return true;
                        }
                        switch (str.charAt(i + 3)) {
                            ' ',
                            '\t',
                            '\r',
                            '\n',
                            '[',
                            ']',
                            '{',
                            '}',
                            ',',
                            => return true,
                            else => {},
                        }
                    }

                    if (i == 0 and stringIsNumber(str, &i)) {
                        return true;
                    }
                    i += 1;
                },
                '.' => {
                    if (i + 2 < str.length() and str.charAt(i + 1) == '.' and str.charAt(i + 2) == '.') {
                        if (i + 3 >= str.length()) {
                            return true;
                        }
                        switch (str.charAt(i + 3)) {
                            ' ',
                            '\t',
                            '\r',
                            '\n',
                            '[',
                            ']',
                            '{',
                            '}',
                            ',',
                            => return true,
                            else => {},
                        }
                    }

                    if (i == 0 and stringIsNumber(str, &i)) {
                        return true;
                    }
                    i += 1;
                },

                '0'...'9' => {
                    if (i == 0 and stringIsNumber(str, &i)) {
                        return true;
                    }
                    i += 1;
                },

                0x00...0x1f,
                0x22,
                0x7f,
                0x85,
                0xa0,
                0xa8,
                0xa9,
                => return true,

                else => {
                    i += 1;
                },
            }
        }

        return false;
    }

    fn stringIsNumber(str: String, offset: *usize) bool {
        const start = offset.*;
        var i = start;

        var @"+" = false;
        var @"-" = false;
        var e = false;
        var dot = false;

        var base: enum { dec, hex, oct } = .dec;

        next: switch (str.charAt(i)) {
            '.' => {
                if (dot or base != .dec) {
                    offset.* = i;
                    return false;
                }
                dot = true;
                i += 1;
                if (i < str.length()) {
                    continue :next str.charAt(i);
                }
                return true;
            },

            '+' => {
                if (@"+") {
                    offset.* = i;
                    return false;
                }
                @"+" = true;
                i += 1;
                if (i < str.length()) {
                    continue :next str.charAt(i);
                }
                return true;
            },

            '-' => {
                if (@"-") {
                    offset.* = i;
                    return false;
                }
                @"-" = true;
                i += 1;
                if (i < str.length()) {
                    continue :next str.charAt(i);
                }
                return true;
            },

            '0' => {
                if (i == start) {
                    if (i + 1 < str.length()) {
                        switch (str.charAt(i + 1)) {
                            'x', 'X' => {
                                base = .hex;
                            },
                            'o', 'O' => {
                                base = .oct;
                            },
                            '0'...'9' => {
                                // 0 prefix allowed
                            },
                            else => {
                                offset.* = i;
                                return false;
                            },
                        }
                        i += 1;
                    } else {
                        return true;
                    }
                }

                i += 1;
                if (i < str.length()) {
                    continue :next str.charAt(i);
                }
                return true;
            },

            'e',
            'E',
            => {
                if (base == .oct or (e and base == .dec)) {
                    offset.* = i;
                    return false;
                }
                e = true;
                i += 1;
                if (i < str.length()) {
                    continue :next str.charAt(i);
                }
                return true;
            },

            'a'...'d',
            'f',
            'A'...'D',
            'F',
            => {
                if (base != .hex) {
                    offset.* = i;
                    return false;
                }
                i += 1;
                if (i < str.length()) {
                    continue :next str.charAt(i);
                }
                return true;
            },

            '1'...'9' => {
                i += 1;
                if (i < str.length()) {
                    continue :next str.charAt(i);
                }
                return true;
            },

            else => {
                offset.* = i;
                return false;
            },
        }
    }
};

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

    const input_value = callFrame.argumentsAsArray(1)[0];

    const input: jsc.Node.BlobOrStringOrBuffer = try jsc.Node.BlobOrStringOrBuffer.fromJS(global, arena.allocator(), input_value) orelse input: {
        var str = try input_value.toBunString(global);
        defer str.deref();
        break :input .{ .string_or_buffer = .{ .string = str.toSlice(arena.allocator()) } };
    };
    defer input.deinit();

    var log = logger.Log.init(bun.default_allocator);
    defer log.deinit();

    const source = &logger.Source.initPathString("input.yaml", input.slice());

    const root = bun.interchange.yaml.YAML.parse(source, &log, arena.allocator()) catch |err| return switch (err) {
        error.OutOfMemory => |oom| oom,
        error.StackOverflow => global.throwStackOverflow(),
        else => {
            if (log.msgs.items.len > 0) {
                const first_msg = log.msgs.items[0];
                const error_text = first_msg.data.text;
                return global.throwValue(global.createSyntaxErrorInstance("YAML Parse error: {s}", .{error_text}));
            }
            return global.throwValue(global.createSyntaxErrorInstance("YAML Parse error: Unable to parse YAML string", .{}));
        },
    };

    var ctx: ParserCtx = .{
        .seen_objects = .init(arena.allocator()),
        .stack_check = .init(),
        .global = global,
        .root = root,
        .result = .zero,
    };
    defer ctx.deinit();

    MarkedArgumentBuffer.run(ParserCtx, &ctx, &ParserCtx.run);

    return ctx.result;
}

const ParserCtx = struct {
    seen_objects: std.AutoHashMap(*const anyopaque, JSValue),
    stack_check: bun.StackCheck,

    global: *JSGlobalObject,
    root: Expr,

    result: JSValue,

    pub fn deinit(ctx: *ParserCtx) void {
        ctx.seen_objects.deinit();
    }

    pub fn run(ctx: *ParserCtx, args: *MarkedArgumentBuffer) callconv(.c) void {
        ctx.result = ctx.toJS(args, ctx.root) catch |err| switch (err) {
            error.OutOfMemory => {
                ctx.result = ctx.global.throwOutOfMemoryValue();
                return;
            },
            error.JSError, error.JSTerminated => {
                ctx.result = .zero;
                return;
            },
            error.StackOverflow => {
                ctx.result = ctx.global.throwStackOverflow() catch .zero;
                return;
            },
        };
    }

    const ToJSError = JSError || bun.StackOverflow;

    pub fn toJS(ctx: *ParserCtx, args: *MarkedArgumentBuffer, expr: Expr) ToJSError!JSValue {
        if (!ctx.stack_check.isSafeToRecurse()) {
            return error.StackOverflow;
        }
        switch (expr.data) {
            .e_null => return .null,
            .e_boolean => |boolean| return .jsBoolean(boolean.value),
            .e_number => |number| return .jsNumber(number.value),
            .e_string => |str| {
                return str.toJS(bun.default_allocator, ctx.global);
            },
            .e_array => {
                if (ctx.seen_objects.get(expr.data.e_array)) |arr| {
                    return arr;
                }

                var arr = try JSValue.createEmptyArray(ctx.global, expr.data.e_array.items.len);

                args.append(arr);
                try ctx.seen_objects.put(expr.data.e_array, arr);

                for (expr.data.e_array.slice(), 0..) |item, _i| {
                    const i: u32 = @intCast(_i);
                    const value = try ctx.toJS(args, item);
                    try arr.putIndex(ctx.global, i, value);
                }

                return arr;
            },
            .e_object => {
                if (ctx.seen_objects.get(expr.data.e_object)) |obj| {
                    return obj;
                }

                var obj = JSValue.createEmptyObject(ctx.global, expr.data.e_object.properties.len);

                args.append(obj);
                try ctx.seen_objects.put(expr.data.e_object, obj);

                for (expr.data.e_object.properties.slice()) |prop| {
                    const key_expr = prop.key.?;
                    const value_expr = prop.value.?;

                    const key = try ctx.toJS(args, key_expr);
                    const value = try ctx.toJS(args, value_expr);

                    const key_str = try key.toBunString(ctx.global);
                    defer key_str.deref();

                    try obj.putMayBeIndex(ctx.global, &key_str, value);
                }

                return obj;
            },

            // unreachable. the yaml AST does not use any other
            // expr types
            else => return .js_undefined,
        }
    }
};

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const JSError = bun.JSError;
const String = bun.String;
const default_allocator = bun.default_allocator;
const logger = bun.logger;
const YAML = bun.interchange.yaml.YAML;

const ast = bun.ast;
const Expr = ast.Expr;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const MarkedArgumentBuffer = jsc.MarkedArgumentBuffer;
const ZigString = jsc.ZigString;
const wtf = bun.jsc.wtf;
