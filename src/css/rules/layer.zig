const std = @import("std");
const bun = @import("root").bun;
pub const css = @import("../css_parser.zig");
const ArrayList = std.ArrayListUnmanaged;
const MediaList = css.MediaList;
const CustomMedia = css.CustomMedia;
const Printer = css.Printer;
const Maybe = css.Maybe;
const PrinterError = css.PrinterError;
const PrintErr = css.PrintErr;
const SupportsCondition = css.css_rules.supports.SupportsCondition;
const Location = css.css_rules.Location;
const Result = css.Result;

// TODO: make this equivalent of SmallVec<[CowArcStr<'i>; 1]
pub const LayerName = struct {
    v: css.SmallList([]const u8, 1) = .{},

    pub fn parse(input: *css.Parser) Result(LayerName) {
        var parts: css.SmallList([]const u8, 1) = .{};
        const ident = switch (input.expectIdent()) {
            .result => |v| v,
            .err => |e| return .{ .err = e.intoDefaultParseError() },
        };
        parts.append(
            input.allocator(),
            ident,
        ) catch bun.outOfMemory();

        while (true) {
            const Fn = struct {
                pub fn tryParseFn(
                    i: *css.Parser,
                ) Result([]const u8) {
                    const name = name: {
                        out: {
                            const start_location = i.currentSourceLocation();
                            const tok = switch (i.nextIncludingWhitespace()) {
                                .err => |e| return .{ .err = e.intoDefaultParseError() },
                                .result => |vvv| vvv,
                            };
                            if (tok.* == .delim or tok.* == '.') {
                                break :out;
                            }
                            return start_location.newBasicUnexpectedTokenError(tok.*);
                        }

                        const start_location = i.currentSourceLocation();
                        const tok = switch (i.nextIncludingWhitespace()) {
                            .err => |e| return .{ .err = e },
                            .result => |vvv| vvv,
                        };
                        if (tok.* == .ident) {
                            break :name tok.ident;
                        }
                        return start_location.newBasicUnexpectedTokenError(tok.*);
                    };
                    return name;
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
                ) catch bun.outOfMemory();
            }

            return .{ .result = LayerName{ .v = parts } };
        }
    }

    pub fn toCss(this: *const LayerName, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        var first = true;
        for (this.v.items) |name| {
            if (first) {
                first = false;
            } else {
                try dest.writeChar('.');
            }

            css.serializer.serializeIdentifier(name, dest) catch return dest.addFmtError();
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
    };
}

/// A [@layer statement](https://drafts.csswg.org/css-cascade-5/#layer-empty) rule.
///
/// See also [LayerBlockRule](LayerBlockRule).
pub const LayerStatementRule = struct {
    /// The layer names to declare.
    names: ArrayList(LayerName),
    /// The location of the rule in the source file.
    loc: Location,

    const This = @This();

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        try dest.writeStr("@layer ");
        try css.to_css.fromList(LayerName, &this.names, W, dest);
        try dest.writeChar(';');
    }
};
