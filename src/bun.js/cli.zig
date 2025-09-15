const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const strings = bun.strings;
const MutableString = bun.MutableString;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;

/// Fast, zero-allocation flag parser for common cases
pub const FlagParser = struct {
    const ParseError = error{
        InvalidFlag,
        MissingValue,
        InvalidNumber,
        UnknownFlag,
    };

    pub const ParseResult = struct {
        flags: std.StringHashMap(Value),
        positional: std.ArrayList([]const u8),
        unknown: std.ArrayList([]const u8),
        allocator: std.mem.Allocator,

        pub fn deinit(self: *ParseResult) void {
            self.flags.deinit();
            self.positional.deinit();
            self.unknown.deinit();
        }

        pub fn toJS(self: *ParseResult, globalObject: *JSGlobalObject) JSValue {
            const obj = JSValue.createEmptyObject(globalObject, 3);

            // Add flags
            var iter = self.flags.iterator();
            while (iter.next()) |entry| {
                const key = entry.key_ptr.*;
                const value = entry.value_ptr.*;
                obj.put(globalObject, &ZigString.init(key), value.toJS(globalObject));
            }

            // Add positional args as "_"
            const positional_array = JSValue.createEmptyArray(globalObject, self.positional.items.len);
            for (self.positional.items, 0..) |arg, i| {
                positional_array.putIndex(globalObject, @intCast(i), ZigString.init(arg).toJS(globalObject));
            }
            obj.put(globalObject, &ZigString.init("_"), positional_array);

            return obj;
        }
    };

    pub const Value = union(enum) {
        boolean: bool,
        number: f64,
        string: []const u8,
        array: std.ArrayList([]const u8),

        pub fn toJS(self: Value, globalObject: *JSGlobalObject) JSValue {
            return switch (self) {
                .boolean => |b| JSValue.jsBoolean(b),
                .number => |n| JSValue.jsNumber(n),
                .string => |s| ZigString.init(s).toJS(globalObject),
                .array => |a| {
                    const arr = JSValue.createEmptyArray(globalObject, a.items.len);
                    for (a.items, 0..) |item, i| {
                        arr.putIndex(globalObject, @intCast(i), ZigString.init(item).toJS(globalObject));
                    }
                    return arr;
                },
            };
        }
    };

    pub const Options = struct {
        stop_early: bool = false,
        allow_unknown: bool = true,
        auto_type: bool = true,
        boolean_flags: ?[]const []const u8 = null,
        string_flags: ?[]const []const u8 = null,
        array_flags: ?[]const []const u8 = null,
        aliases: ?std.StringHashMap([]const u8) = null,
    };

    allocator: std.mem.Allocator,
    options: Options,

    pub fn init(allocator: std.mem.Allocator, options: Options) FlagParser {
        return .{
            .allocator = allocator,
            .options = options,
        };
    }

    pub fn parse(self: *FlagParser, args: []const []const u8) !ParseResult {
        var result = ParseResult{
            .flags = std.StringHashMap(Value).init(self.allocator),
            .positional = std.ArrayList([]const u8).init(self.allocator),
            .unknown = std.ArrayList([]const u8).init(self.allocator),
            .allocator = self.allocator,
        };
        errdefer result.deinit();

        var i: usize = 0;
        var parsing_flags = true;

        while (i < args.len) : (i += 1) {
            const arg = args[i];

            // Stop parsing flags after --
            if (parsing_flags and strings.eqlComptime(arg, "--")) {
                parsing_flags = false;
                continue;
            }

            // Not a flag or stopped parsing flags
            if (!parsing_flags or !strings.hasPrefixComptime(arg, "-")) {
                try result.positional.append(arg);
                if (self.options.stop_early) {
                    parsing_flags = false;
                }
                continue;
            }

            // Parse flag
            if (strings.hasPrefixComptime(arg, "--")) {
                // Long flag
                const flag_part = arg[2..];
                if (flag_part.len == 0) {
                    parsing_flags = false;
                    continue;
                }

                // Handle --flag=value
                if (std.mem.indexOf(u8, flag_part, "=")) |eq_idx| {
                    const flag_name = flag_part[0..eq_idx];
                    const flag_value = flag_part[eq_idx + 1 ..];
                    try self.setFlag(&result, flag_name, flag_value);
                } else {
                    // Check if it's a boolean flag or needs a value
                    const needs_value = self.needsValue(flag_part);
                    if (needs_value) {
                        if (i + 1 < args.len and !strings.hasPrefixComptime(args[i + 1], "-")) {
                            i += 1;
                            try self.setFlag(&result, flag_part, args[i]);
                        } else {
                            try self.setFlag(&result, flag_part, "");
                        }
                    } else {
                        // Handle --no-flag pattern
                        if (strings.hasPrefixComptime(flag_part, "no-")) {
                            const actual_flag = flag_part[3..];
                            try self.setBooleanFlag(&result, actual_flag, false);
                        } else {
                            try self.setBooleanFlag(&result, flag_part, true);
                        }
                    }
                }
            } else if (arg.len > 1) {
                // Short flags
                const flags = arg[1..];

                // Handle multiple short flags like -abc
                for (flags, 0..) |flag_char, idx| {
                    const flag_str = &[_]u8{flag_char};

                    // Last flag in the group might have a value
                    if (idx == flags.len - 1 and self.needsValue(flag_str)) {
                        if (i + 1 < args.len and !strings.hasPrefixComptime(args[i + 1], "-")) {
                            i += 1;
                            try self.setFlag(&result, flag_str, args[i]);
                        } else {
                            try self.setFlag(&result, flag_str, "");
                        }
                    } else {
                        try self.setBooleanFlag(&result, flag_str, true);
                    }
                }
            }
        }

        return result;
    }

    fn needsValue(self: *FlagParser, flag: []const u8) bool {
        // Check if flag is explicitly marked as boolean
        if (self.options.boolean_flags) |boolean_flags| {
            for (boolean_flags) |bf| {
                if (strings.eql(bf, flag)) return false;
            }
        }

        // Check if flag is explicitly marked as string or array
        if (self.options.string_flags) |string_flags| {
            for (string_flags) |sf| {
                if (strings.eql(sf, flag)) return true;
            }
        }

        if (self.options.array_flags) |array_flags| {
            for (array_flags) |af| {
                if (strings.eql(af, flag)) return true;
            }
        }

        // Default: boolean flags don't need values
        return false;
    }

    fn setFlag(self: *FlagParser, result: *ParseResult, flag: []const u8, value: []const u8) !void {
        const resolved_flag = self.resolveAlias(flag);

        // Check if it's an array flag
        if (self.options.array_flags) |array_flags| {
            for (array_flags) |af| {
                if (strings.eql(af, resolved_flag)) {
                    const entry = try result.flags.getOrPut(resolved_flag);
                    if (!entry.found_existing) {
                        entry.value_ptr.* = Value{ .array = std.ArrayList([]const u8).init(self.allocator) };
                    }
                    switch (entry.value_ptr.*) {
                        .array => |*arr| try arr.append(value),
                        else => {},
                    }
                    return;
                }
            }
        }

        // Auto-type detection if enabled
        if (self.options.auto_type) {
            // Try to parse as number
            if (std.fmt.parseFloat(f64, value)) |num| {
                try result.flags.put(resolved_flag, Value{ .number = num });
                return;
            } else |_| {}

            // Check for boolean strings
            if (strings.eqlComptime(value, "true")) {
                try result.flags.put(resolved_flag, Value{ .boolean = true });
                return;
            }
            if (strings.eqlComptime(value, "false")) {
                try result.flags.put(resolved_flag, Value{ .boolean = false });
                return;
            }
        }

        // Default to string
        try result.flags.put(resolved_flag, Value{ .string = value });
    }

    fn setBooleanFlag(self: *FlagParser, result: *ParseResult, flag: []const u8, value: bool) !void {
        const resolved_flag = self.resolveAlias(flag);
        try result.flags.put(resolved_flag, Value{ .boolean = value });
    }

    fn resolveAlias(self: *FlagParser, flag: []const u8) []const u8 {
        if (self.options.aliases) |aliases| {
            return aliases.get(flag) orelse flag;
        }
        return flag;
    }
};

/// Interactive CLI components with TTY detection
pub const Interactive = struct {
    pub const Terminal = struct {
        is_tty: bool,
        supports_color: bool,
        width: u16,
        height: u16,

        pub fn detect() Terminal {
            const stdout = std.io.getStdOut();
            const is_tty = std.os.isatty(stdout.handle);

            var width: u16 = 80;
            var height: u16 = 24;

            if (is_tty) {
                if (std.os.getWinSize(stdout.handle)) |size| {
                    width = size.ws_col;
                    height = size.ws_row;
                } else |_| {}
            }

            // Simple color detection
            const supports_color = is_tty and !isCI();

            return .{
                .is_tty = is_tty,
                .supports_color = supports_color,
                .width = width,
                .height = height,
            };
        }

        fn isCI() bool {
            return std.process.getEnvVarOwned(std.heap.page_allocator, "CI") catch null != null;
        }
    };

    pub const Renderer = struct {
        terminal: Terminal,
        last_lines: u16 = 0,
        allocator: std.mem.Allocator,

        const CLEAR_LINE = "\x1b[2K";
        const MOVE_UP = "\x1b[1A";
        const MOVE_TO_START = "\x1b[0G";
        const HIDE_CURSOR = "\x1b[?25l";
        const SHOW_CURSOR = "\x1b[?25h";

        pub fn init(allocator: std.mem.Allocator) Renderer {
            return .{
                .terminal = Terminal.detect(),
                .allocator = allocator,
            };
        }

        pub fn clear(self: *Renderer) !void {
            if (!self.terminal.is_tty) return;

            const stdout = std.io.getStdOut().writer();

            // Move up and clear each line
            var i: u16 = 0;
            while (i < self.last_lines) : (i += 1) {
                try stdout.print("{s}{s}", .{ MOVE_UP, CLEAR_LINE });
            }
            try stdout.writeAll(MOVE_TO_START);

            self.last_lines = 0;
        }

        pub fn render(self: *Renderer, content: []const u8) !void {
            if (!self.terminal.is_tty) {
                // Fallback for non-TTY
                const stdout = std.io.getStdOut().writer();
                try stdout.writeAll(content);
                try stdout.writeByte('\n');
                return;
            }

            try self.clear();

            const stdout = std.io.getStdOut().writer();
            try stdout.writeAll(HIDE_CURSOR);
            defer stdout.writeAll(SHOW_CURSOR) catch {};

            // Count lines for next clear
            self.last_lines = 1;
            for (content) |c| {
                if (c == '\n') self.last_lines += 1;
            }

            try stdout.writeAll(content);
        }

        pub fn renderInPlace(self: *Renderer, content: []const u8) !void {
            if (!self.terminal.is_tty) {
                return self.render(content);
            }

            const stdout = std.io.getStdOut().writer();
            try stdout.writeAll(CLEAR_LINE);
            try stdout.writeAll(MOVE_TO_START);
            try stdout.writeAll(content);
        }
    };

    pub const TextPrompt = struct {
        renderer: *Renderer,
        message: []const u8,
        default_value: ?[]const u8 = null,
        current_input: std.ArrayList(u8),

        pub fn init(renderer: *Renderer, message: []const u8, allocator: std.mem.Allocator) TextPrompt {
            return .{
                .renderer = renderer,
                .message = message,
                .current_input = std.ArrayList(u8).init(allocator),
            };
        }

        pub fn deinit(self: *TextPrompt) void {
            self.current_input.deinit();
        }

        pub fn run(self: *TextPrompt) ![]const u8 {
            if (!self.renderer.terminal.is_tty) {
                // Non-interactive fallback
                return self.default_value orelse "";
            }

            const stdin = std.io.getStdIn().reader();
            const stdout = std.io.getStdOut().writer();

            // Display prompt
            try stdout.print("{s}: ", .{self.message});
            if (self.default_value) |default| {
                try stdout.print("({s}) ", .{default});
            }

            // Read input
            try stdin.streamUntilDelimiter(self.current_input.writer(), '\n', null);

            // Use default if empty
            if (self.current_input.items.len == 0 and self.default_value != null) {
                return self.default_value.?;
            }

            return self.current_input.items;
        }
    };

    pub const SelectPrompt = struct {
        renderer: *Renderer,
        message: []const u8,
        choices: []const []const u8,
        selected: usize = 0,

        pub fn init(renderer: *Renderer, message: []const u8, choices: []const []const u8) SelectPrompt {
            return .{
                .renderer = renderer,
                .message = message,
                .choices = choices,
            };
        }

        pub fn run(self: *SelectPrompt) ![]const u8 {
            if (!self.renderer.terminal.is_tty) {
                // Non-interactive fallback: return first choice
                return if (self.choices.len > 0) self.choices[0] else "";
            }

            // TODO: Implement interactive selection with arrow keys
            // For now, simple numbered selection
            const stdout = std.io.getStdOut().writer();
            const stdin = std.io.getStdIn().reader();

            try stdout.print("{s}:\n", .{self.message});
            for (self.choices, 0..) |choice, i| {
                try stdout.print("  {d}. {s}\n", .{ i + 1, choice });
            }
            try stdout.print("Enter choice (1-{d}): ", .{self.choices.len});

            var buf: [16]u8 = undefined;
            if (try stdin.readUntilDelimiterOrEof(&buf, '\n')) |input| {
                const trimmed = std.mem.trim(u8, input, " \t\r\n");
                if (std.fmt.parseInt(usize, trimmed, 10)) |choice| {
                    if (choice > 0 and choice <= self.choices.len) {
                        return self.choices[choice - 1];
                    }
                } else |_| {}
            }

            return if (self.choices.len > 0) self.choices[0] else "";
        }
    };
};

// JavaScript bindings
pub export fn createCLI(globalObject: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.EncodedJSValue {
    _ = callframe;

    const obj = JSValue.createEmptyObject(globalObject, 4);

    // Add parse function
    const parse_fn = JSC.JSFunction.create(globalObject, "parse", parseCLI, 2, .{});
    obj.put(globalObject, &ZigString.init("parse"), parse_fn);

    // Add parseSimple function
    const parse_simple_fn = JSC.JSFunction.create(globalObject, "parseSimple", parseSimpleCLI, 1, .{});
    obj.put(globalObject, &ZigString.init("parseSimple"), parse_simple_fn);

    // Add terminal info
    const terminal = Interactive.Terminal.detect();
    obj.put(globalObject, &ZigString.init("isTTY"), JSValue.jsBoolean(terminal.is_tty));

    // Add prompt namespace
    const prompt_obj = JSValue.createEmptyObject(globalObject, 3);
    const text_fn = JSC.JSFunction.create(globalObject, "text", promptText, 1, .{});
    prompt_obj.put(globalObject, &ZigString.init("text"), text_fn);
    obj.put(globalObject, &ZigString.init("prompt"), prompt_obj);

    return obj.asEncoded();
}

fn parseCLI(globalObject: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
    const arguments = callframe.arguments(2);
    const allocator = bun.default_allocator;

    // Get args array (default to process.argv.slice(2))
    var args_list = std.ArrayList([]const u8).init(allocator);
    defer args_list.deinit();

    if (arguments.len > 0 and !arguments.ptr[0].isUndefinedOrNull()) {
        // Parse JS array
        const args_array = arguments.ptr[0];
        if (args_array.isArray()) {
            const len = args_array.getLength(globalObject);
            var i: u32 = 0;
            while (i < len) : (i += 1) {
                const item = args_array.getIndex(globalObject, i);
                if (item.isString()) {
                    const str = item.toBunString(globalObject);
                    args_list.append(str.toUTF8(allocator).slice()) catch {};
                }
            }
        }
    } else {
        // Use process.argv.slice(2)
        const process_argv = bun.argv;
        if (process_argv.len > 2) {
            for (process_argv[2..]) |arg| {
                args_list.append(arg) catch {};
            }
        }
    }

    // Parse options
    var options = FlagParser.Options{};
    if (arguments.len > 1 and !arguments.ptr[1].isUndefinedOrNull()) {
        const opts = arguments.ptr[1];
        if (opts.isObject()) {
            if (opts.get(globalObject, "stopEarly")) |v| {
                options.stop_early = v.toBoolean();
            }
            if (opts.get(globalObject, "allowUnknown")) |v| {
                options.allow_unknown = v.toBoolean();
            }
            if (opts.get(globalObject, "autoType")) |v| {
                options.auto_type = v.toBoolean();
            }
        }
    }

    // Parse flags
    var parser = FlagParser.init(allocator, options);
    var result = parser.parse(args_list.items) catch {
        return JSValue.createError(globalObject, "Failed to parse arguments", .{});
    };
    defer result.deinit();

    return result.toJS(globalObject);
}

fn parseSimpleCLI(globalObject: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
    const arguments = callframe.arguments(1);
    const allocator = bun.default_allocator;

    // Get args array
    var args_list = std.ArrayList([]const u8).init(allocator);
    defer args_list.deinit();

    if (arguments.len > 0 and !arguments.ptr[0].isUndefinedOrNull()) {
        const args_array = arguments.ptr[0];
        if (args_array.isArray()) {
            const len = args_array.getLength(globalObject);
            var i: u32 = 0;
            while (i < len) : (i += 1) {
                const item = args_array.getIndex(globalObject, i);
                if (item.isString()) {
                    const str = item.toBunString(globalObject);
                    args_list.append(str.toUTF8(allocator).slice()) catch {};
                }
            }
        }
    } else {
        const process_argv = bun.argv;
        if (process_argv.len > 2) {
            for (process_argv[2..]) |arg| {
                args_list.append(arg) catch {};
            }
        }
    }

    // Simple parsing with auto-type
    var parser = FlagParser.init(allocator, .{ .auto_type = true });
    var result = parser.parse(args_list.items) catch {
        return JSValue.createError(globalObject, "Failed to parse arguments", .{});
    };
    defer result.deinit();

    return result.toJS(globalObject);
}

fn promptText(globalObject: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
    const arguments = callframe.arguments(1);
    const allocator = bun.default_allocator;

    if (arguments.len == 0 or arguments.ptr[0].isUndefinedOrNull()) {
        return JSValue.createError(globalObject, "Options required", .{});
    }

    const options = arguments.ptr[0];
    if (!options.isObject()) {
        return JSValue.createError(globalObject, "Options must be an object", .{});
    }

    // Get message
    const message = if (options.get(globalObject, "message")) |msg| blk: {
        if (msg.isString()) {
            break :blk msg.toBunString(globalObject).toUTF8(allocator).slice();
        }
        break :blk "Input";
    } else "Input";

    // Create prompt
    var renderer = Interactive.Renderer.init(allocator);
    var prompt = Interactive.TextPrompt.init(&renderer, message, allocator);
    defer prompt.deinit();

    // Get default value
    if (options.get(globalObject, "default")) |def| {
        if (def.isString()) {
            prompt.default_value = def.toBunString(globalObject).toUTF8(allocator).slice();
        }
    }

    // Run prompt
    const result = prompt.run() catch {
        return JSValue.createError(globalObject, "Failed to run prompt", .{});
    };

    return ZigString.init(result).toJS(globalObject);
}