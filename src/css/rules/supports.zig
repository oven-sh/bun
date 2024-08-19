const std = @import("std");
pub const css = @import("../css_parser.zig");
const bun = @import("root").bun;
const Error = css.Error;
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
    },

    /// A selector to evaluate.
    selector: []const u8,

    /// An unknown condition.
    unknown: []const u8,

    fn clone(this: *const SupportsCondition) SupportsCondition {
        _ = this; // autofix
        @compileError(css.todo_stuff.think_about_allocator);
    }

    fn needsParens(this: *const SupportsCondition, parent: *const SupportsCondition) bool {
        return switch (this.*) {
            .not => true,
            .@"and" => parent.* != .@"and",
            .@"or" => parent.* != .@"or",
            _ => false,
        };
    }

    const SeenDeclKey = struct {
        css.PropertyId,
        []const u8,
    };

    pub fn parse(input: *css.Parser) Error!SupportsCondition {
        if (input.tryParse(css.Parser.expectIdentMatching, .{"not"})) |_| {
            const in_parens = try SupportsCondition.parseInParens(input);
            return .{
                .not = bun.create(
                    @compileError(css.todo_stuff.think_about_allocator),
                    SupportsCondition,
                    in_parens,
                ),
            };
        }

        const in_parens: SupportsCondition = try SupportsCondition.parseInParens(input);
        var expected_type: ?i32 = null;
        var conditions = ArrayList(SupportsCondition){};
        const mapalloc: std.mem.Allocator = {
            @compileError(css.todo_stuff.think_about_allocator);
        };
        var seen_declarations = std.ArrayHashMap(
            SeenDeclKey,
            usize,
            struct {
                pub fn hash(self: @This(), s: SeenDeclKey) u32 {
                    _ = self;
                    return std.hash_map.hashString(s[1]) +% @as(u32, @intFromEnum(s[0]));
                }
                pub fn eql(self: @This(), a: SeenDeclKey, b: SeenDeclKey, b_index: usize) bool {
                    _ = self; // autofix
                    _ = b_index; // autofix
                    if (a[0].eq(b[0])) return false;
                    return bun.strings.eqlCaseInsensitiveASCIIICheckLength(a[1], b[1]);
                }
            },
            false,
        ).init(mapalloc);

        while (true) {
            const Closure = struct {
                expected_type: *?i32 = null,
                pub fn tryParseFn(i: *css.Parser, this: *@This()) Error!SupportsCondition {
                    _ = i; // autofix
                    const location = input.currentSourceLocation();
                    const s = try input.expectIdent();
                    const found_type: i32 = found_type: {
                        // todo_stuff.match_ignore_ascii_case
                        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("and", s)) break :found_type 1;
                        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("or", s)) break :found_type 2;
                        return location.newUnexpectedTokenError(.{ .ident = s });
                    };

                    if (this.expected_type) |expected| {
                        if (found_type != expected) {
                            return location.newUnexpectedTokenError(.{ .ident = s });
                        }
                    } else {
                        this.expected_type.* = found_type;
                    }

                    return SupportsCondition.parseInParens(input);
                }
            };
            var closure = Closure{
                .expected_type = &expected_type,
            };
            const _condition = input.tryParse(Closure.tryParseFn, .{&closure});

            if (_condition) |condition| {
                if (conditions.items.len == 0) {
                    conditions.append(@compileError(css.todo_stuff.think_about_allocator), in_parens.clone());
                    if (in_parens == .declaration) {
                        const property_id = in_parens.declaration.property_id;
                        const value = in_parens.declaration.value;
                        seen_declarations.put(
                            property_id.withPrefix(css.VendorPrefix{ .none = true }),
                            value,
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
                        if (cond == .declaration) {
                            cond.declaration.property_id.addPrefix(property_id.prefix());
                        }
                    } else {
                        seen_declarations.put(key, conditions.items.len) catch bun.outOfMemory();
                        conditions.append(@compileError(css.todo_stuff.think_about_allocator), SupportsCondition{
                            .property_id = property_id,
                            .value = value,
                        }) catch bun.outOfMemory();
                    }
                } else {
                    conditions.append(
                        @compileError(css.todo_stuff.think_about_allocator),
                        condition,
                    ) catch bun.outOfMemory();
                }
            } else break;
        }

        if (conditions.items.len() == 1) {
            return conditions.pop();
        }

        if (expected_type == 1) return .{ .@"and" = conditions };
        if (expected_type == 2) return .{ .@"or" = conditions };
        return in_parens;
    }

    pub fn parseDeclaration(input: *css.Parser) Error!SupportsCondition {
        const property_id = try css.PropertyId.parse(input);
        try input.expectColon();
        try input.skipWhitespace();
        const pos = input.position();
        try input.expectNoErrorToken();
        return SupportsCondition{
            .declaration = .{
                .property_id = property_id,
                .value = input.sliceFrom(pos),
            },
        };
    }

    fn parseInParens(input: *css.Parser) Error!SupportsCondition {
        input.skipWhitespace();
        const location = input.currentSourceLocation();
        const pos = input.position();
        const tok = try input.next();
        switch (tok.*) {
            .function => |f| {
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("selector", f)) {
                    const Fn = struct {
                        pub fn tryParseFn(i: *css.Parser) Error!SupportsCondition {
                            return try i.parseNestedBlock(SupportsCondition, void, @This().parseNestedBlockFn);
                        }
                        pub fn parseNestedBlockFn(_: void, i: *css.Parser) Error!SupportsCondition {
                            const p = i.position();
                            try i.expectNoErrorToken();
                            return SupportsCondition{ .selector = i.sliceFrom(p) };
                        }
                    };
                    const res = input.tryParse(Fn.tryParseFn, .{});
                    if (res) |_| return res;
                }
            },
            .open_curly => {},
            else => return location.newUnexpectedTokenError(tok.*),
        }

        input.parseNestedBlock(void, {}, css.voidWrap(void, css.Parser.expectNoErrorToken)) catch |err| {
            return err;
        };

        return SupportsCondition{ .unknown = input.sliceFrom(pos) };
    }

    pub fn toCss(this: *const SupportsCondition, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        switch (this.*) {
            .not => |condition| {
                try dest.writeStr(" not ");
                condition.toCssWithParensIfNeeded(dest, condition.needsParens(this));
            },
            .@"and" => |conditions| {
                var first = true;
                for (conditions.items) |*cond| {
                    if (first) {
                        first = false;
                    } else {
                        try dest.writeStr(" and ");
                    }
                    try cond.toCssWithParensIfNeeded(dest, cond.needsParens(this));
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
                    try cond.toCssWithParensIfNeeded(dest, cond.needsParens(this));
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
                inline for (std.meta.fields(css.VendorPrefix)) |field_| {
                    const field: std.builtin.Type.StructField = field_;
                    if (!@field(prefix, field.name)) continue;

                    if (first) {
                        first = false;
                    } else {
                        try dest.writeStr(") or (");
                    }

                    var p = css.VendorPrefix{};
                    @field(p, field.name) = true;
                    try css.serializer.serializeName(name, dest);
                    try dest.delim(':', false);
                    try dest.writeStr(value);
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
            this.rules.toCss(W, dest);
            dest.dedent();
            try dest.newline();
            try dest.writeChar('}');
        }
    };
}
