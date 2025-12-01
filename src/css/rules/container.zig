pub const css = @import("../css_parser.zig");
const Result = css.Result;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Location = css.css_rules.Location;
const CustomIdent = css.css_values.ident.CustomIdent;
const CustomIdentFns = css.css_values.ident.CustomIdentFns;
const QueryFeature = css.media_query.QueryFeature;
const QueryConditionFlags = css.media_query.QueryConditionFlags;
const Operator = css.media_query.Operator;

pub const ContainerName = struct {
    v: css.css_values.ident.CustomIdent,
    pub fn parse(input: *css.Parser) Result(ContainerName) {
        const ident = switch (CustomIdentFns.parse(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };

        // todo_stuff.match_ignore_ascii_case;
        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("none", ident.v) or
            bun.strings.eqlCaseInsensitiveASCIIICheckLength("and", ident.v) or
            bun.strings.eqlCaseInsensitiveASCIIICheckLength("not", ident.v) or
            bun.strings.eqlCaseInsensitiveASCIIICheckLength("or", ident.v))
            return .{ .err = input.newUnexpectedTokenError(.{ .ident = ident.v }) };

        return .{ .result = ContainerName{ .v = ident } };
    }

    const This = @This();

    pub fn toCss(this: *const This, dest: *Printer) PrintErr!void {
        return try CustomIdentFns.toCss(&this.v, dest);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

pub const ContainerNameFns = ContainerName;
pub const ContainerSizeFeature = QueryFeature(ContainerSizeFeatureId);

pub const ContainerSizeFeatureId = enum {
    /// The [width](https://w3c.github.io/csswg-drafts/css-contain-3/#width) size container feature.
    width,
    /// The [height](https://w3c.github.io/csswg-drafts/css-contain-3/#height) size container feature.
    height,
    /// The [inline-size](https://w3c.github.io/csswg-drafts/css-contain-3/#inline-size) size container feature.
    @"inline-size",
    /// The [block-size](https://w3c.github.io/csswg-drafts/css-contain-3/#block-size) size container feature.
    @"block-size",
    /// The [aspect-ratio](https://w3c.github.io/csswg-drafts/css-contain-3/#aspect-ratio) size container feature.
    @"aspect-ratio",
    /// The [orientation](https://w3c.github.io/csswg-drafts/css-contain-3/#orientation) size container feature.
    orientation,

    pub const valueType = css.DeriveValueType(@This(), ValueTypeMap).valueType;

    pub const ValueTypeMap = .{
        .width = css.MediaFeatureType.length,
        .height = css.MediaFeatureType.length,
        .@"inline-size" = css.MediaFeatureType.length,
        .@"block-size" = css.MediaFeatureType.length,
        .@"aspect-ratio" = css.MediaFeatureType.ratio,
        .orientation = css.MediaFeatureType.ident,
    };

    pub fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn parse(input: *css.Parser) Result(@This()) {
        return css.enum_property_util.parse(@This(), input);
    }

    pub fn toCss(this: *const @This(), dest: *Printer) PrintErr!void {
        return css.enum_property_util.toCss(@This(), this, dest);
    }

    pub fn toCssWithPrefix(this: *const @This(), prefix: []const u8, dest: *Printer) PrintErr!void {
        try dest.writeStr(prefix);
        try this.toCss(dest);
    }
};

/// Represents a style query within a container condition.
pub const StyleQuery = union(enum) {
    /// A style feature, implicitly parenthesized.
    feature: css.Property,

    /// A negation of a condition.
    not: *StyleQuery,

    /// A set of joint operations.
    operation: struct {
        /// The operator for the conditions.
        operator: css.media_query.Operator,
        /// The conditions for the operator.
        conditions: ArrayList(StyleQuery),

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },

    pub fn toCss(this: *const StyleQuery, dest: *Printer) PrintErr!void {
        switch (this.*) {
            .feature => |f| try f.toCss(dest, false),
            .not => |c| {
                try dest.writeStr("not ");
                return try css.media_query.toCssWithParensIfNeeded(
                    c,
                    dest,
                    c.needsParens(null, &dest.targets),
                );
            },
            .operation => |op| return css.media_query.operationToCss(
                StyleQuery,
                op.operator,
                &op.conditions,
                dest,
            ),
        }
    }

    pub fn parseFeature(input: *css.Parser) Result(StyleQuery) {
        const property_id = switch (css.PropertyId.parse(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        if (input.expectColon().asErr()) |e| return .{ .err = e };
        input.skipWhitespace();
        const opts = css.ParserOptions.default(input.allocator(), null);
        const feature: StyleQuery = .{
            .feature = switch (css.Property.parse(
                property_id,
                input,
                &opts,
            )) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            },
        };
        _ = input.tryParse(css.parseImportant, .{});
        return .{ .result = feature };
    }

    pub fn createNegation(condition: *StyleQuery) StyleQuery {
        return .{ .not = condition };
    }

    pub fn createOperation(operator: Operator, conditions: ArrayList(StyleQuery)) StyleQuery {
        return .{
            .operation = .{
                .operator = operator,
                .conditions = conditions,
            },
        };
    }

    pub fn needsParens(
        this: *const StyleQuery,
        parent_operator: ?Operator,
        _: *const css.Targets,
    ) bool {
        return switch (this.*) {
            .not => true,
            .operation => |op| op.operator == parent_operator,
            .feature => true,
        };
    }

    pub fn parseStyleQuery(input: *css.Parser) Result(@This()) {
        return .{ .err = input.newErrorForNextToken() };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

pub const ContainerCondition = union(enum) {
    /// A size container feature, implicitly parenthesized.
    feature: ContainerSizeFeature,
    /// A negation of a condition.
    not: *ContainerCondition,
    /// A set of joint operations.
    operation: struct {
        /// The operator for the conditions.
        operator: css.media_query.Operator,
        /// The conditions for the operator.
        conditions: ArrayList(ContainerCondition),

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },
    /// A style query.
    style: StyleQuery,

    const This = @This();

    pub fn parse(input: *css.Parser) Result(ContainerCondition) {
        return css.media_query.parseQueryCondition(
            ContainerCondition,
            input,
            QueryConditionFlags{
                .allow_or = true,
                .allow_style = true,
            },
        );
    }

    pub fn toCss(this: *const This, dest: *Printer) PrintErr!void {
        switch (this.*) {
            .feature => |f| try f.toCss(dest),
            .not => |c| {
                try dest.writeStr("not ");
                return try css.media_query.toCssWithParensIfNeeded(
                    c,
                    dest,
                    c.needsParens(null, &dest.targets),
                );
            },
            .operation => |op| try css.media_query.operationToCss(ContainerCondition, op.operator, &op.conditions, dest),
            .style => |query| {
                try dest.writeStr("style(");
                try query.toCss(dest);
                try dest.writeChar(')');
            },
        }
    }

    pub fn parseFeature(input: *css.Parser) Result(ContainerCondition) {
        const feature = switch (QueryFeature(ContainerSizeFeatureId).parse(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        return .{ .result = .{ .feature = feature } };
    }

    pub fn createNegation(condition: *ContainerCondition) ContainerCondition {
        return .{ .not = condition };
    }

    pub fn createOperation(operator: Operator, conditions: ArrayList(ContainerCondition)) ContainerCondition {
        return .{
            .operation = .{
                .operator = operator,
                .conditions = conditions,
            },
        };
    }

    pub fn parseStyleQuery(input: *css.Parser) Result(ContainerCondition) {
        const Fns = struct {
            pub inline fn adaptedParseQueryCondition(i: *css.Parser, flags: QueryConditionFlags) Result(StyleQuery) {
                return css.media_query.parseQueryCondition(StyleQuery, i, flags);
            }

            pub fn parseNestedBlockFn(_: void, i: *css.Parser) Result(ContainerCondition) {
                if (i.tryParse(
                    @This().adaptedParseQueryCondition,
                    .{
                        QueryConditionFlags{ .allow_or = true },
                    },
                ).asValue()) |res| {
                    return .{ .result = .{ .style = res } };
                }

                return .{ .result = .{
                    .style = switch (StyleQuery.parseFeature(i)) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    },
                } };
            }
        };
        return input.parseNestedBlock(ContainerCondition, {}, Fns.parseNestedBlockFn);
    }

    pub fn needsParens(
        this: *const ContainerCondition,
        parent_operator: ?Operator,
        targets: *const css.Targets,
    ) bool {
        return switch (this.*) {
            .not => true,
            .operation => |op| op.operator == parent_operator,
            .feature => |f| f.needsParens(parent_operator, targets),
            .style => false,
        };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A [@container](https://drafts.csswg.org/css-contain-3/#container-rule) rule.
pub fn ContainerRule(comptime R: type) type {
    return struct {
        /// The name of the container.
        name: ?ContainerName,
        /// The container condition.
        condition: ContainerCondition,
        /// The rules within the `@container` rule.
        rules: css.CssRuleList(R),
        /// The location of the rule in the source file.
        loc: Location,

        const This = @This();

        pub fn toCss(this: *const This, dest: *Printer) PrintErr!void {
            // #[cfg(feature = "sourcemap")]
            // dest.add_mapping(self.loc);

            try dest.writeStr("@container ");
            if (this.name) |*name| {
                try name.toCss(dest);
                try dest.writeChar(' ');
            }

            // Don't downlevel range syntax in container queries.
            const exclude = dest.targets.exclude;
            bun.bits.insert(css.targets.Features, &dest.targets.exclude, .media_queries);
            try this.condition.toCss(dest);
            dest.targets.exclude = exclude;

            try dest.whitespace();
            try dest.writeChar('{');
            dest.indent();
            try dest.newline();
            try this.rules.toCss(dest);
            dest.dedent();
            try dest.newline();
            try dest.writeChar('}');
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
            return css.implementDeepClone(@This(), this, allocator);
        }
    };
}

const bun = @import("bun");

const std = @import("std");
const ArrayList = std.ArrayListUnmanaged;
