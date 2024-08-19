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
const Location = css.css_rules.Location;
const CustomIdent = css.css_values.ident.CustomIdent;
const CustomIdentFns = css.css_values.ident.CustomIdentFns;
const QueryFeature = css.media_query.QueryFeature;
const QueryConditionFlags = css.media_query.QueryConditionFlags;
const Operator = css.media_query.Operator;

pub const ContainerName = struct {
    v: css.css_values.ident.CustomIdent,
    pub fn parse(input: *css.Parser) Error!ContainerName {
        const ident = try CustomIdentFns.parse(input);

        // todo_stuff.match_ignore_ascii_case;
        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("none", ident) or
            bun.strings.eqlCaseInsensitiveASCIIICheckLength("and", ident) or
            bun.strings.eqlCaseInsensitiveASCIIICheckLength("not", ident) or
            bun.strings.eqlCaseInsensitiveASCIIICheckLength("or", ident))
            return input.newUnexpectedtokenError(.{ .ident = ident });

        return ContainerName{ .v = ident };
    }

    const This = @This();

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        return try CustomIdentFns.toCss(&this.v, W, dest);
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

    pub usingnamespace css.DefineEnumProperty(@This());
    pub usingnamespace css.DeriveValueType(@This());

    pub const ValueTypeMap = .{
        .width = css.MediaFeatureType.length,
        .height = css.MediaFeatureType.length,
        .@"inline-size" = css.MediaFeatureType.length,
        .@"block-size" = css.MediaFeatureType.length,
        .@"aspect-ratio" = css.MediaFeatureType.ratio,
        .orientation = css.MediaFeatureType.ident,
    };
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
    },

    pub fn toCss(this: *const StyleQuery, comptime W: type, dest: *Printer(W)) PrintErr!void {
        switch (this.*) {
            .feature => |f| try f.toCss(W, dest, false),
            .not => |c| {
                try dest.writeStr("not ");
                return try css.media_query.toCssWithParensIfNeeded(
                    c,
                    W,
                    dest,
                    c.needsParens(null, &dest.targets),
                );
            },
            .operation => |op| return css.media_query.operationToCss(
                StyleQuery,
                op.operator,
                &op.conditions,
                W,
                dest,
            ),
        }
    }

    pub fn parseFeature(input: *css.Parser) Error!StyleQuery {
        const property_id = try css.PropertyId.parse(input);
        try input.expectColon();
        try input.skipWhitespace();
        const opts = css.ParserOptions{};
        const feature = .{
            .feature = try css.Property.parse(
                property_id,
                input,
                &opts,
            ),
        };
        _ = input.tryParse(css.parseImportant, .{});
        return feature;
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
    },
    /// A style query.
    style: StyleQuery,

    const This = @This();

    pub fn parse(input: *css.Parser) Error!ContainerCondition {
        return try css.media_query.parseQueryCondition(
            ContainerCondition,
            input,
            QueryConditionFlags{
                .allow_or = true,
                .allow_style = true,
            },
        );
    }

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        switch (this.*) {
            .feature => |f| try f.toCss(W, dest),
            .not => |c| {
                try dest.writeStr("not ");
                return try css.media_query.toCssWithParensIfNeeded(
                    c,
                    W,
                    dest,
                    c.needsParens(null, &dest.targets),
                );
            },
            .operation => |op| css.media_query.operationToCss(ContainerCondition, op.operator, &op.conditions, W, dest),
            .style => |query| {
                try dest.writeStr("style(");
                try query.toCss(W, dest);
                try dest.writeChar(')');
            },
        }
    }

    pub fn parseFeature(input: *css.Parser) Error!ContainerCondition {
        const feature = try QueryFeature(ContainerSizeFeatureId).parse(input);
        return .{ .feature = feature };
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

    pub fn parseStyleQuery(input: *css.Parser) Error!ContainerCondition {
        const Fns = struct {
            pub inline fn adaptedParseQueryCondition(i: *css.Parser, flags: QueryConditionFlags) Error!ContainerCondition {
                return css.media_query.parseParensOrFunction(ContainerCondition, i, flags);
            }

            pub fn parseNestedBlockFn(_: void, i: *css.Parser) Error!ContainerCondition {
                if (i.tryParse(
                    @This().adaptedParseQueryCondition,
                    .{
                        QueryConditionFlags{ .allow_or = true },
                    },
                )) |res| {
                    return .{ .style = res };
                }

                return .{
                    .style = try StyleQuery.parseFeature(input),
                };
            }
        };
        return try input.parseNestedBlock(ContainerCondition, {}, Fns.parseNestedBlockFn);
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

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            // #[cfg(feature = "sourcemap")]
            // dest.add_mapping(self.loc);

            try dest.writeStr("@container ");
            if (this.name) |*name| {
                try name.toCss(W, dest);
                try dest.writeChar(' ');
            }

            // Don't downlevel range syntax in container queries.
            const exclude = dest.targets.exclude;
            dest.targets.exclude.insert(css.Features{ .media_queries = true });
            try this.condition.toCss(W, dest);
            dest.targets.exclude = exclude;

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
