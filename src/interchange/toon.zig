const std = @import("std");
const bun = @import("bun");
const logger = bun.logger;
const JSC = bun.jsc;
const ast = bun.ast;
const wtf = bun.jsc.wtf;

const Expr = ast.Expr;
const E = ast.E;
const G = ast.G;

const OOM = bun.OOM;
const JSError = bun.JSError;

/// Token-Oriented Object Notation (TOON) parser and stringifier
/// TOON is a compact, human-readable format designed for passing structured data
/// to Large Language Models with significantly reduced token usage.
pub const TOON = struct {
    /// Parse TOON text into a JavaScript AST Expr
    pub fn parse(source: *const logger.Source, log: *logger.Log, allocator: std.mem.Allocator) (OOM || error{SyntaxError})!Expr {
        bun.analytics.Features.toon_parse += 1;

        var parser = Parser.init(allocator, source.contents);

        const result = parser.parseValue() catch |err| {
            if (err == error.SyntaxError) {
                try log.addErrorFmt(
                    source,
                    logger.Loc{ .start = @as(i32, @intCast(parser.pos)) },
                    allocator,
                    "Syntax error parsing TOON: {s}",
                    .{parser.error_msg orelse "unexpected input"},
                );
            }
            return err;
        };

        return result;
    }

    /// Stringify a JavaScript value to TOON format
    /// Returns a Stringifier that owns the string builder
    pub fn stringify(
        allocator: std.mem.Allocator,
        globalThis: *JSC.JSGlobalObject,
        value: JSC.JSValue,
        space_value: JSC.JSValue,
    ) (OOM || error{ JSError, JSTerminated, StackOverflow })!Stringifier {
        bun.analytics.Features.toon_stringify += 1;

        var stringifier = try Stringifier.init(allocator, globalThis, space_value);
        errdefer stringifier.deinit();

        try stringifier.stringify(globalThis, value, 0);

        return stringifier;
    }
};

const Parser = struct {
    allocator: std.mem.Allocator,
    input: []const u8,
    pos: usize = 0,
    error_msg: ?[]const u8 = null,

    fn init(allocator: std.mem.Allocator, input: []const u8) Parser {
        return .{
            .allocator = allocator,
            .input = input,
        };
    }

    fn parseValue(self: *Parser) (OOM || error{SyntaxError})!Expr {
        self.skipWhitespace();

        if (self.pos >= self.input.len) {
            return Expr.init(E.Null, .{}, .Empty);
        }

        // For now, return a placeholder
        // Full implementation would parse the TOON format here
        self.error_msg = "TOON parsing not fully implemented yet";
        return error.SyntaxError;
    }

    fn skipWhitespace(self: *Parser) void {
        while (self.pos < self.input.len) {
            switch (self.input[self.pos]) {
                ' ', '\t', '\r', '\n' => self.pos += 1,
                else => break,
            }
        }
    }
};

pub const Stringifier = struct {
    allocator: std.mem.Allocator,
    builder: wtf.StringBuilder,
    indent: usize,
    space: Space,
    known_collections: std.AutoHashMap(JSC.JSValue, void),

    const Space = union(enum) {
        none,
        spaces: u8,
        string: []const u8,
    };

    pub fn toString(this: *Stringifier, global: *JSC.JSGlobalObject) JSError!JSC.JSValue {
        return this.builder.toString(global);
    }

    fn init(
        allocator: std.mem.Allocator,
        globalThis: *JSC.JSGlobalObject,
        space_value: JSC.JSValue,
    ) (OOM || error{ JSError, JSTerminated })!Stringifier {
        const space = if (space_value.isNumber()) blk: {
            const num = space_value.toInt32();
            const clamped: u8 = @intCast(@max(0, @min(num, 10)));
            if (clamped == 0) {
                break :blk Space.none;
            }
            break :blk Space{ .spaces = clamped };
        } else if (space_value.isString()) blk: {
            const str = try space_value.toBunString(globalThis);
            defer str.deref();
            if (str.length() == 0) {
                break :blk Space.none;
            }
            const str_utf8 = str.toUTF8(allocator);
            defer str_utf8.deinit();
            const str_slice = try allocator.dupe(u8, str_utf8.slice());
            break :blk Space{ .string = str_slice };
        } else Space.none;

        return .{
            .allocator = allocator,
            .builder = wtf.StringBuilder.init(),
            .indent = 0,
            .space = space,
            .known_collections = std.AutoHashMap(JSC.JSValue, void).init(allocator),
        };
    }

    pub fn deinit(self: *Stringifier) void {
        self.builder.deinit();
        self.known_collections.deinit();
        if (self.space == .string) {
            self.allocator.free(self.space.string);
        }
    }

    fn stringify(
        self: *Stringifier,
        globalThis: *JSC.JSGlobalObject,
        value: JSC.JSValue,
        depth: usize,
    ) (OOM || error{ JSError, JSTerminated, StackOverflow })!void {
        _ = depth;

        // Check for circular references
        if (value.isObject()) {
            const gop = try self.known_collections.getOrPut(value);
            if (gop.found_existing) {
                // Circular reference - for now just write null
                self.builder.append(.latin1, "null");
                return;
            }
        }
        defer {
            if (value.isObject()) {
                _ = self.known_collections.remove(value);
            }
        }

        if (value.isNull()) {
            self.builder.append(.latin1, "null");
        } else if (value.isUndefinedOrNull()) {
            self.builder.append(.latin1, "null");
        } else if (value.isBoolean()) {
            if (value.asBoolean()) {
                self.builder.append(.latin1, "true");
            } else {
                self.builder.append(.latin1, "false");
            }
        } else if (value.isNumber()) {
            const num = value.asNumber();
            if (std.math.isNan(num) or std.math.isInf(num)) {
                self.builder.append(.latin1, "null");
            } else {
                self.builder.append(.double, num);
            }
        } else if (value.isString()) {
            const str = try value.toBunString(globalThis);
            defer str.deref();
            const slice = str.toUTF8(self.allocator);
            defer slice.deinit();
            try self.writeString(slice.slice());
        } else if (value.jsType().isArray()) {
            // Placeholder for array handling
            self.builder.append(.latin1, "[]");
        } else if (value.isObject()) {
            // Placeholder for object handling
            self.builder.append(.latin1, "{}");
        } else {
            self.builder.append(.latin1, "null");
        }
    }

    fn writeString(self: *Stringifier, str: []const u8) OOM!void {
        // Check if quoting is needed
        const needs_quotes = needsQuotes(str);

        if (needs_quotes) {
            self.builder.append(.lchar, '"');
            for (str) |c| {
                switch (c) {
                    '"' => self.builder.append(.latin1, "\\\""),
                    '\\' => self.builder.append(.latin1, "\\\\"),
                    '\n' => self.builder.append(.latin1, "\\n"),
                    '\r' => self.builder.append(.latin1, "\\r"),
                    '\t' => self.builder.append(.latin1, "\\t"),
                    else => self.builder.append(.lchar, c),
                }
            }
            self.builder.append(.lchar, '"');
        } else {
            self.builder.append(.latin1, str);
        }
    }

    fn needsQuotes(str: []const u8) bool {
        if (str.len == 0) return true;

        // Check for leading/trailing spaces
        if (str[0] == ' ' or str[str.len - 1] == ' ') return true;

        // Check for special characters or keywords
        if (std.mem.eql(u8, str, "true") or
            std.mem.eql(u8, str, "false") or
            std.mem.eql(u8, str, "null")) return true;

        // Check if it looks like a number
        if (str[0] >= '0' and str[0] <= '9') return true;
        if (str[0] == '-' and str.len > 1 and str[1] >= '0' and str[1] <= '9') return true;

        // Check for characters that need quoting
        for (str) |c| {
            switch (c) {
                ':', ',', '"', '\\', '\n', '\r', '\t', '[', ']', '{', '}' => return true,
                else => {},
            }
        }

        return false;
    }
};
