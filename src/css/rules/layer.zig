const std = @import("std");
const bun = @import("bun");
pub const css = @import("../css_parser.zig");
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Location = css.css_rules.Location;
const Result = css.Result;

/// Stored as a list of strings as dot notation can be used
/// to create sublayers
pub const LayerName = struct {
    v: css.SmallList([]const u8, 1) = .{},

    pub fn HashMap(comptime V: type) type {
        return std.ArrayHashMapUnmanaged(LayerName, V, struct {
            pub fn hash(_: @This(), key: LayerName) u32 {
                var hasher = std.hash.Wyhash.init(0);
                for (key.v.items) |part| {
                    hasher.update(part);
                }
                return hasher.final();
            }

            pub fn eql(_: @This(), a: LayerName, b: LayerName, _: usize) bool {
                if (a.v.len != b.v.len) return false;
                for (a.v.items, 0..) |part, i| {
                    if (!bun.strings.eql(part, b.v.items[i])) return false;
                }
                return true;
            }
        }, false);
    }

    pub fn hash(this: *const LayerName, hasher: anytype) void {
        return css.implementHash(@This(), this, hasher);
    }

    pub fn cloneWithImportRecords(
        this: *const @This(),
        allocator: std.mem.Allocator,
        _: *bun.BabyList(bun.ImportRecord),
    ) @This() {
        return LayerName{ .v = this.v.deepClone(allocator) };
    }

    pub fn deepClone(this: *const LayerName, allocator: std.mem.Allocator) LayerName {
        return LayerName{
            .v = this.v.clone(allocator),
        };
    }

    pub fn eql(lhs: *const LayerName, rhs: *const LayerName) bool {
        if (lhs.v.len() != rhs.v.len()) return false;
        for (lhs.v.slice(), rhs.v.slice()) |l, r| {
            if (!bun.strings.eql(l, r)) return false;
        }
        return true;
    }

    pub fn parse(input: *css.Parser) Result(LayerName) {
        var parts: css.SmallList([]const u8, 1) = .{};
        const ident = switch (input.expectIdent()) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        parts.append(
            input.allocator(),
            ident,
        );

        while (true) {
            const Fn = struct {
                pub fn tryParseFn(
                    i: *css.Parser,
                ) Result([]const u8) {
                    const name = name: {
                        out: {
                            const start_location = i.currentSourceLocation();
                            const tok = switch (i.nextIncludingWhitespace()) {
                                .err => |e| return .{ .err = e },
                                .result => |vvv| vvv,
                            };
                            if (tok.* == .delim and tok.delim == '.') {
                                break :out;
                            }
                            return .{ .err = start_location.newBasicUnexpectedTokenError(tok.*) };
                        }

                        const start_location = i.currentSourceLocation();
                        const tok = switch (i.nextIncludingWhitespace()) {
                            .err => |e| return .{ .err = e },
                            .result => |vvv| vvv,
                        };
                        if (tok.* == .ident) {
                            break :name tok.ident;
                        }
                        return .{ .err = start_location.newBasicUnexpectedTokenError(tok.*) };
                    };
                    return .{ .result = name };
                }
            };

            while (true) {
                const name = switch (input.tryParse(Fn.tryParseFn, .{})) {
                    .err => break,
                    .result => |vvv| vvv,
                };
                parts.append(
                    input.allocator(),
                    name,
                );
            }

            return .{ .result = LayerName{ .v = parts } };
        }
    }

    pub fn toCss(this: *const LayerName, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        var first = true;
        for (this.v.slice()) |name| {
            if (first) {
                first = false;
            } else {
                try dest.writeChar('.');
            }

            css.serializer.serializeIdentifier(name, dest) catch return dest.addFmtError();
        }
    }

    pub fn format(this: *const LayerName, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        var first = true;
        for (this.v.slice()) |name| {
            if (first) {
                first = false;
            } else {
                try writer.writeAll(".");
            }
            try writer.writeAll(name);
        }
    }
};

/// A [@layer block](https://drafts.csswg.org/css-cascade-5/#layer-block) rule.
pub fn LayerBlockRule(comptime R: type) type {
    return struct {
        /// PERF: null pointer optimizaiton, nullable
        /// The name of the layer to declare, or `None` to declare an anonymous layer.
        name: ?LayerName,
        /// The rules within the `@layer` rule.
        rules: css.CssRuleList(R),
        /// The location of the rule in the source file.
        loc: Location,

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            // #[cfg(feature = "sourcemap")]
            // dest.add_mapping(self.loc);

            try dest.writeStr("@layer");
            if (this.name) |*name| {
                try dest.writeChar(' ');
                try name.toCss(W, dest);
            }

            try dest.whitespace();
            try dest.writeChar('{');
            dest.indent();
            try dest.newline();
            try this.rules.toCss(W, dest);
            dest.dedent();
            try dest.newline();
            try dest.writeChar('}');
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
            return css.implementDeepClone(@This(), this, allocator);
        }
    };
}

/// A [@layer statement](https://drafts.csswg.org/css-cascade-5/#layer-empty) rule.
///
/// See also [LayerBlockRule](LayerBlockRule).
pub const LayerStatementRule = struct {
    /// The layer names to declare.
    names: bun.css.SmallList(LayerName, 1),
    /// The location of the rule in the source file.
    loc: Location,

    const This = @This();

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        if (this.names.len() > 0) {
            try dest.writeStr("@layer ");
            try css.to_css.fromList(LayerName, this.names.slice(), W, dest);
            try dest.writeChar(';');
        } else {
            try dest.writeStr("@layer;");
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
        return css.implementDeepClone(@This(), this, allocator);
    }
};
