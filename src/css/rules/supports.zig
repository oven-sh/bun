const std = @import("std");
pub const css = @import("../css_parser.zig");
const bun = @import("root").bun;
const Result = css.Result;
const ArrayList = std.ArrayListUnmanaged;
const MediaList = css.MediaList;
const CustomMedia = css.CustomMedia;
const Printer = css.Printer;
const Maybe = css.Maybe;
const PrinterError = css.PrinterError;
const PrintErr = css.PrintErr;
const Dependency = css.Dependency;
const dependencies = css.dependencies;
const Url = css.css_values.url.Url;
const Size2D = css.css_values.size.Size2D;
const fontprops = css.css_properties.font;
const LayerName = css.css_rules.layer.LayerName;
const Location = css.css_rules.Location;
const Angle = css.css_values.angle.Angle;
const FontStyleProperty = css.css_properties.font.FontStyle;
const FontFamily = css.css_properties.font.FontFamily;
const FontWeight = css.css_properties.font.FontWeight;
const FontStretch = css.css_properties.font.FontStretch;
const CustomProperty = css.css_properties.custom.CustomProperty;
const CustomPropertyName = css.css_properties.custom.CustomPropertyName;
const DashedIdent = css.css_values.ident.DashedIdent;

/// A [`<supports-condition>`](https://drafts.csswg.org/css-conditional-3/#typedef-supports-condition),
/// as used in the `@supports` and `@import` rules.
pub const SupportsCondition = union(enum) {
    /// A `not` expression.
    not: *SupportsCondition,

    /// An `and` expression.
    @"and": ArrayList(SupportsCondition),

    /// An `or` expression.
    @"or": ArrayList(SupportsCondition),

    /// A declaration to evaluate.
    declaration: struct {
        /// The property id for the declaration.
        property_id: css.PropertyId,
        /// The raw value of the declaration.
        value: []const u8,

        pub fn eql(this: *const @This(), other: *const @This()) bool {
            return css.implementEql(@This(), this, other);
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },

    /// A selector to evaluate.
    selector: []const u8,

    /// An unknown condition.
    unknown: []const u8,

    pub fn deinit(this: *@This(), allocator: std.mem.Allocator) void {
        switch (this.*) {
            .not => |not| {
                not.deinit(allocator);
                allocator.destroy(not);
            },
            inline .@"and", .@"or" => |*list| {
                css.deepDeinit(SupportsCondition, allocator, list);
            },
            .declaration => {},
            .selector => {},
            .unknown => {},
        }
    }

    pub fn eql(this: *const SupportsCondition, other: *const SupportsCondition) bool {
        return css.implementEql(SupportsCondition, this, other);
    }

    pub fn deepClone(this: *const SupportsCondition, allocator: std.mem.Allocator) SupportsCondition {
        return css.implementDeepClone(SupportsCondition, this, allocator);
    }

    fn needsParens(this: *const SupportsCondition, parent: *const SupportsCondition) bool {
        return switch (this.*) {
            .not => true,
            .@"and" => parent.* != .@"and",
            .@"or" => parent.* != .@"or",
            else => false,
        };
    }

    const SeenDeclKey = struct {
        css.PropertyId,
        []const u8,
    };

    pub fn parse(input: *css.Parser) Result(SupportsCondition) {
        if (input.tryParse(css.Parser.expectIdentMatching, .{"not"}).isOk()) {
            const in_parens = switch (SupportsCondition.parseInParens(input)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            return .{
                .result = .{
                    .not = bun.create(
                        input.allocator(),
                        SupportsCondition,
                        in_parens,
                    ),
                },
            };
        }

        const in_parens: SupportsCondition = switch (SupportsCondition.parseInParens(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        var expected_type: ?i32 = null;
        var conditions = ArrayList(SupportsCondition){};
        const mapalloc: std.mem.Allocator = input.allocator();
        var seen_declarations = std.ArrayHashMap(
            SeenDeclKey,
            usize,
            struct {
                pub fn hash(self: @This(), s: SeenDeclKey) u32 {
                    _ = self; // autofix
                    return std.array_hash_map.hashString(s[1]) +% @intFromEnum(s[0]);
                }
                pub fn eql(self: @This(), a: SeenDeclKey, b: SeenDeclKey, b_index: usize) bool {
                    _ = self; // autofix
                    _ = b_index; // autofix
                    return seenDeclKeyEql(a, b);
                }

                pub inline fn seenDeclKeyEql(this: SeenDeclKey, that: SeenDeclKey) bool {
                    return @intFromEnum(this[0]) == @intFromEnum(that[0]) and bun.strings.eql(this[1], that[1]);
                }
            },
            false,
        ).init(mapalloc);
        defer seen_declarations.deinit();

        while (true) {
            const Closure = struct {
                expected_type: *?i32,
                pub fn tryParseFn(i: *css.Parser, this: *@This()) Result(SupportsCondition) {
                    const location = i.currentSourceLocation();
                    const s = switch (i.expectIdent()) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    };
                    const found_type: i32 = found_type: {
                        // todo_stuff.match_ignore_ascii_case
                        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("and", s)) break :found_type 1;
                        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("or", s)) break :found_type 2;
                        return .{ .err = location.newUnexpectedTokenError(.{ .ident = s }) };
                    };

                    if (this.expected_type.*) |expected| {
                        if (found_type != expected) {
                            return .{ .err = location.newUnexpectedTokenError(.{ .ident = s }) };
                        }
                    } else {
                        this.expected_type.* = found_type;
                    }

                    return SupportsCondition.parseInParens(i);
                }
            };
            var closure = Closure{
                .expected_type = &expected_type,
            };
            const _condition = input.tryParse(Closure.tryParseFn, .{&closure});

            switch (_condition) {
                .result => |condition| {
                    if (conditions.items.len == 0) {
                        conditions.append(input.allocator(), in_parens.deepClone(input.allocator())) catch bun.outOfMemory();
                        if (in_parens == .declaration) {
                            const property_id = in_parens.declaration.property_id;
                            const value = in_parens.declaration.value;
                            seen_declarations.put(
                                .{ property_id.withPrefix(css.VendorPrefix{ .none = true }), value },
                                0,
                            ) catch bun.outOfMemory();
                        }
                    }

                    if (condition == .declaration) {
                        // Merge multiple declarations with the same property id (minus prefix) and value together.
                        const property_id_ = condition.declaration.property_id;
                        const value = condition.declaration.value;

                        const property_id = property_id_.withPrefix(css.VendorPrefix{ .none = true });
                        const key = SeenDeclKey{ property_id, value };
                        if (seen_declarations.get(key)) |index| {
                            const cond = &conditions.items[index];
                            if (cond.* == .declaration) {
                                cond.declaration.property_id.addPrefix(property_id.prefix());
                            }
                        } else {
                            seen_declarations.put(key, conditions.items.len) catch bun.outOfMemory();
                            conditions.append(input.allocator(), SupportsCondition{ .declaration = .{
                                .property_id = property_id,
                                .value = value,
                            } }) catch bun.outOfMemory();
                        }
                    } else {
                        conditions.append(
                            input.allocator(),
                            condition,
                        ) catch bun.outOfMemory();
                    }
                },
                else => break,
            }
        }

        if (conditions.items.len == 1) {
            const ret = conditions.pop();
            defer conditions.deinit(input.allocator());
            return .{ .result = ret };
        }

        if (expected_type == 1) return .{ .result = .{ .@"and" = conditions } };
        if (expected_type == 2) return .{ .result = .{ .@"or" = conditions } };
        return .{ .result = in_parens };
    }

    pub fn parseDeclaration(input: *css.Parser) Result(SupportsCondition) {
        const property_id = switch (css.PropertyId.parse(input)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        if (input.expectColon().asErr()) |e| return .{ .err = e };
        input.skipWhitespace();
        const pos = input.position();
        if (input.expectNoErrorToken().asErr()) |e| return .{ .err = e };
        return .{ .result = SupportsCondition{
            .declaration = .{
                .property_id = property_id,
                .value = input.sliceFrom(pos),
            },
        } };
    }

    fn parseInParens(input: *css.Parser) Result(SupportsCondition) {
        input.skipWhitespace();
        const location = input.currentSourceLocation();
        const pos = input.position();
        const tok = switch (input.next()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        switch (tok.*) {
            .function => |f| {
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("selector", f)) {
                    const Fn = struct {
                        pub fn tryParseFn(i: *css.Parser) Result(SupportsCondition) {
                            return i.parseNestedBlock(SupportsCondition, {}, @This().parseNestedBlockFn);
                        }
                        pub fn parseNestedBlockFn(_: void, i: *css.Parser) Result(SupportsCondition) {
                            const p = i.position();
                            if (i.expectNoErrorToken().asErr()) |e| return .{ .err = e };
                            return .{ .result = SupportsCondition{ .selector = i.sliceFrom(p) } };
                        }
                    };
                    const res = input.tryParse(Fn.tryParseFn, .{});
                    if (res.isOk()) return res;
                }
            },
            .open_paren => {
                const res = input.tryParse(struct {
                    pub fn parseFn(i: *css.Parser) Result(SupportsCondition) {
                        return i.parseNestedBlock(SupportsCondition, {}, css.voidWrap(SupportsCondition, parse));
                    }
                }.parseFn, .{});
                if (res.isOk()) return res;
            },
            else => return .{ .err = location.newUnexpectedTokenError(tok.*) },
        }

        if (input.parseNestedBlock(void, {}, struct {
            pub fn parseFn(_: void, i: *css.Parser) Result(void) {
                return i.expectNoErrorToken();
            }
        }.parseFn).asErr()) |err| {
            return .{ .err = err };
        }

        return .{ .result = SupportsCondition{ .unknown = input.sliceFrom(pos) } };
    }

    pub fn toCss(this: *const SupportsCondition, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        switch (this.*) {
            .not => |condition| {
                try dest.writeStr(" not ");
                try condition.toCssWithParensIfNeeded(W, dest, condition.needsParens(this));
            },
            .@"and" => |conditions| {
                var first = true;
                for (conditions.items) |*cond| {
                    if (first) {
                        first = false;
                    } else {
                        try dest.writeStr(" and ");
                    }
                    try cond.toCssWithParensIfNeeded(W, dest, cond.needsParens(this));
                }
            },
            .@"or" => |conditions| {
                var first = true;
                for (conditions.items) |*cond| {
                    if (first) {
                        first = false;
                    } else {
                        try dest.writeStr(" or ");
                    }
                    try cond.toCssWithParensIfNeeded(W, dest, cond.needsParens(this));
                }
            },
            .declaration => |decl| {
                const property_id = decl.property_id;
                const value = decl.value;

                try dest.writeChar('(');

                const prefix: css.VendorPrefix = property_id.prefix().orNone();
                if (!prefix.eq(css.VendorPrefix{ .none = true })) {
                    try dest.writeChar('(');
                }

                const name = property_id.name();
                var first = true;
                inline for (css.VendorPrefix.FIELDS) |field| {
                    if (@field(prefix, field)) {
                        if (first) {
                            first = false;
                        } else {
                            try dest.writeStr(") or (");
                        }

                        var p = css.VendorPrefix{};
                        @field(p, field) = true;
                        css.serializer.serializeName(name, dest) catch return dest.addFmtError();
                        try dest.delim(':', false);
                        try dest.writeStr(value);
                    }
                }

                if (!prefix.eq(css.VendorPrefix{ .none = true })) {
                    try dest.writeChar(')');
                }
                try dest.writeChar(')');
            },
            .selector => |sel| {
                try dest.writeStr("selector(");
                try dest.writeStr(sel);
                try dest.writeChar(')');
            },
            .unknown => |unk| {
                try dest.writeStr(unk);
            },
        }
    }

    pub fn toCssWithParensIfNeeded(
        this: *const SupportsCondition,
        comptime W: type,
        dest: *css.Printer(
            W,
        ),
        needs_parens: bool,
    ) css.PrintErr!void {
        if (needs_parens) try dest.writeStr("(");
        try this.toCss(W, dest);
        if (needs_parens) try dest.writeStr(")");
    }
};

/// A [@supports](https://drafts.csswg.org/css-conditional-3/#at-supports) rule.
pub fn SupportsRule(comptime R: type) type {
    return struct {
        /// The supports condition.
        condition: SupportsCondition,
        /// The rules within the `@supports` rule.
        rules: css.CssRuleList(R),
        /// The location of the rule in the source file.
        loc: Location,

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            // #[cfg(feature = "sourcemap")]
            // dest.add_mapping(self.loc);

            try dest.writeStr("@supports ");
            try this.condition.toCss(W, dest);
            try dest.whitespace();
            try dest.writeChar('{');
            dest.indent();
            try dest.newline();
            try this.rules.toCss(W, dest);
            dest.dedent();
            try dest.newline();
            try dest.writeChar('}');
        }

        pub fn minify(this: *This, context: *css.MinifyContext, parent_is_unused: bool) css.MinifyErr!void {
            _ = this; // autofix
            _ = context; // autofix
            _ = parent_is_unused; // autofix
            // TODO: Implement this
            return;
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
            return css.implementDeepClone(@This(), this, allocator);
        }
    };
}
