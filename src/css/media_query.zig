const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("./css_parser.zig");
pub const Error = css.Error;
const ArrayList = std.ArrayListUnmanaged;

const Length = css.css_values.length.Length;
const CSSNumber = css.css_values.number.CSSNumber;
const Integer = css.css_values.number.Integer;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const CSSInteger = css.css_values.number.CSSInteger;
const CSSIntegerFns = css.css_values.number.CSSIntegerFns;
const Resolution = css.css_values.resolution.Resolution;
const Ratio = css.css_values.ratio.Ratio;
const Ident = css.css_values.ident.Ident;
const IdentFns = css.css_values.ident.IdentFns;
const EnvironmentVariable = css.css_properties.custom.EnvironmentVariable;
const DashedIdent = css.css_values.ident.DashedIdent;

const Printer = css.Printer;
const PrintErr = css.PrintErr;

pub fn ValidQueryCondition(comptime T: type) void {
    //   fn parse_feature<'t>(input: &mut Parser<'i, 't>) -> Result<Self, ParseError<'i, ParserError<'i>>>;
    _ = T.parseFeature;
    //   fn create_negation(condition: Box<Self>) -> Self;
    _ = T.createNegation;
    //   fn create_operation(operator: Operator, conditions: Vec<Self>) -> Self;
    _ = T.createOperation;
    //   fn parse_style_query<'t>(input: &mut Parser<'i, 't>) -> Result<Self, ParseError<'i, ParserError<'i>>> {
    _ = T.parseStyleQuery;
    //   fn needs_parens(&self, parent_operator: Option<Operator>, targets: &Targets) -> bool;
    _ = T.needsParens;
}

/// A [media query list](https://drafts.csswg.org/mediaqueries/#mq-list).
pub const MediaList = struct {
    /// The list of media queries.
    media_queries: ArrayList(MediaQuery),

    /// Parse a media query list from CSS.
    pub fn parse(input: *css.Parser) Error!MediaList {
        var media_queries = ArrayList(MediaList){};
        while (true) {
            const mq = input.parseUntilBefore(
                css.Delimiters{ .comma = true },
                MediaQuery,
                {},
                css.voidWrap(MediaQuery, MediaQuery.parse),
            ) catch |e| {
                _ = e; // autofix
                @compileError(css.todo_stuff.errors);
            };
            media_queries.append(@compileError(css.todo_stuff.think_about_allocator), mq) catch bun.outOfMemory();

            if (input.next()) |tok| {
                if (tok.* != .comma) {
                    bun.Output.panic("Unreachable code: expected a comma after parsing a MediaQuery.\n\nThis is a bug in Bun's CSS parser. Please file a bug report at https://github.com/oven-sh/bun/issues/new/choose", .{});
                }
            } else break;
        }

        return MediaList{ .media_queries = media_queries };
    }

    pub fn toCss(this: *const MediaList, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        if (this.media_queries.items.len == 0) {
            try dest.writeStr("not all");
            return;
        }

        var first = true;
        for (this.media_queries.items) |*query| {
            if (!first) {
                try dest.delim(',', false);
            }
            first = false;
            try query.toCss(W, dest);
        }
    }

    /// Returns whether the media query list always matches.
    pub fn alwaysMatches(this: *const MediaList) bool {
        // If the media list is empty, it always matches.
        return this.media_queries.items.len == 0 or brk: {
            for (this.media_queries.items) |*query| {
                if (!query.alwaysMatches()) break :brk false;
            }
            break :brk true;
        };
    }
};

/// A binary `and` or `or` operator.
pub const Operator = enum {
    /// The `and` operator.
    @"and",
    /// The `or` operator.
    @"or",
    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A [media query](https://drafts.csswg.org/mediaqueries/#media).
pub const MediaQuery = struct {
    /// The qualifier for this query.
    qualifier: ?Qualifier,
    /// The media type for this query, that can be known, unknown, or "all".
    media_type: MediaType,
    /// The condition that this media query contains. This cannot have `or`
    /// in the first level.
    condition: ?MediaCondition,
    // ~toCssImpl
    const This = @This();

    /// Returns whether the media query is guaranteed to always match.
    pub fn alwaysMatches(this: *const MediaQuery) bool {
        return this.qualifier == null and this.media_type == .all and this.condition == null;
    }

    pub fn parse(input: *css.Parser) Error!MediaQuery {
        const Fn = struct {
            pub fn tryParseFn(i: *css.Parser) Error!struct { ?Qualifier, ?MediaType } {
                const qualifier = i.tryParse(Qualifier.parse, .{}) catch null;
                const media_type = try MediaType.parse(i);
                return .{ qualifier, media_type };
            }
        };
        const qualifier, const explicit_media_type = (try input.tryParse(Fn.tryParseFn, .{})) catch .{ null, null };

        const condition = if (explicit_media_type == null)
            MediaCondition.parseWithFlags(input, QueryConditionFlags{ .allow_or = true })
        else if (input.tryParse(css.Parser.expectIdentMatching, .{"and"}))
            MediaCondition.parseWithFlags(input, QueryConditionFlags.empty())
        else
            null;

        const media_type = explicit_media_type orelse MediaType.all;

        return MediaQuery{
            .qualifier = qualifier,
            .media_type = media_type,
            .condition = condition,
        };
    }

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        if (this.qualifier) |qual| {
            try qual.toCss(W, dest);
            try dest.writeChar(' ');
        }

        switch (this.media_type) {
            .all => {
                // We need to print "all" if there's a qualifier, or there's
                // just an empty list of expressions.
                //
                // Otherwise, we'd serialize media queries like "(min-width:
                // 40px)" in "all (min-width: 40px)", which is unexpected.
                if (this.qualifier != null or this.condition != null) {
                    try dest.writeStr("all");
                }
            },
            .print => {
                try dest.writeStr("print");
            },
            .screen => {
                try dest.writeStr("screen");
            },
            .custom => |desc| {
                try dest.writeStr(desc);
            },
        }

        const condition = if (this.condition) |*cond| cond else return;

        const needs_parens = if (this.media_type != .all or this.qualifier != null) needs_parens: {
            break :needs_parens condition.* == .operation and condition.operation.operator != .@"and";
        } else false;

        return toCssWithParensIfNeeded(W, condition, dest, needs_parens);
    }
};

/// Flags for `parse_query_condition`.
pub const QueryConditionFlags = packed struct(u8) {
    /// Whether to allow top-level "or" boolean logic.
    allow_or: bool = false,
    /// Whether to allow style container queries.
    allow_style: bool = false,

    pub usingnamespace css.Bitflags(@This());
};

pub fn toCssWithParensIfNeeded(
    v: anytype,
    comptime W: type,
    dest: *Printer(W),
    needs_parens: bool,
) PrintErr!void {
    if (needs_parens) {
        try dest.writeChar('(');
    }
    try v.toCss(W, dest);
    if (needs_parens) {
        try dest.writeChar(')');
    }
}

/// A [media query qualifier](https://drafts.csswg.org/mediaqueries/#mq-prefix).
pub const Qualifier = enum {
    /// Prevents older browsers from matching the media query.
    only,
    /// Negates a media query.
    not,

    pub usingnamespace css.DefineEnumProperty(@This());

    // ~toCssImpl
    const This = @This();
};

/// A [media type](https://drafts.csswg.org/mediaqueries/#media-types) within a media query.
pub const MediaType = union(enum) {
    /// Matches all devices.
    all,
    /// Matches printers, and devices intended to reproduce a printed
    /// display, such as a web browser showing a document in “Print Preview”.
    print,
    /// Matches all devices that aren’t matched by print.
    screen,
    /// An unknown media type.
    custom: []const u8,

    pub fn parse(input: *css.Parser) Error!MediaType {
        const name = try input.expectIdent();
        return MediaType.fromStr(name);
    }

    pub fn fromStr(name: []const u8) MediaType {
        // css.todo_stuff.match_ignore_ascii_case
        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "all")) return .all;
        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "print")) return .print;
        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "screen")) return .print;
        return .{ .custom = name };
    }
};

pub fn operationToCss(comptime QueryCondition: type, operator: Operator, conditions: *const ArrayList(QueryCondition), comptime W: type, dest: *Printer(W)) PrintErr!void {
    ValidQueryCondition(QueryCondition);
    const first = &conditions.items[0];
    try toCssWithParensIfNeeded(first, W, dest, first.needsParens(operator, &dest.targets));
    if (conditions.items.len == 1) return;
    for (conditions.items[1..]) |*item| {
        try dest.writeChar(' ');
        try operator.toCss(W, dest);
        try dest.writeChar(' ');
        try toCssWithParensIfNeeded(item, W, dest, item.needsParens(operator, &dest.targets));
    }
}

/// Represents a media condition.
///
/// Implements QueryCondition interface.
pub const MediaCondition = struct {
    feature: MediaFeature,
    not: *MediaCondition,
    operation: struct {
        operator: Operator,
        conditions: ArrayList(MediaCondition),
    },

    const This = @This();

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        switch (this.*) {
            .feature => |*f| {
                try f.toCss(W, dest);
            },
            .not => |*c| {
                try dest.writeStr("not ");
                try toCssWithParensIfNeeded(c, W, dest, c.needsParens(null, &dest.targets));
            },
            .operation => |operation| {
                operationToCss(operation.operator, &operation.conditions, W, dest);
            },
        }
    }

    /// QueryCondition.parseFeature
    pub fn parseFeature(input: *css.Parser) Error!MediaCondition {
        const feature = try MediaFeature.parse(input);
        return MediaCondition{ .feature = feature };
    }

    /// QueryCondition.createNegation
    pub fn createNegation(condition: *MediaCondition) MediaCondition {
        return MediaCondition{ .not = condition };
    }

    /// QueryCondition.createOperation
    pub fn createOperation(operator: Operator, conditions: ArrayList(MediaCondition)) MediaCondition {
        return MediaCondition{
            .operation = .{
                .operator = operator,
                .conditions = conditions,
            },
        };
    }

    /// QueryCondition.parseStyleQuery
    pub fn parseStyleQuery(input: *css.Parser) Error!MediaCondition {
        return try input.newErrorForNextToken();
    }

    /// QueryCondition.needsParens
    pub fn needsParens(this: *const MediaCondition, parent_operator: ?Operator, targets: *const css.Targets) bool {
        return switch (this.*) {
            .not => true,
            .operation => |operation| operation.operator != parent_operator,
            .feature => |f| f.needsParens(parent_operator, targets),
        };
    }

    pub fn parseWithFlags(input: *css.Parser, flags: QueryConditionFlags) Error!MediaCondition {
        return parseQueryCondition(MediaCondition, input, flags);
    }
};

/// Parse a single query condition.
pub fn parseQueryCondition(
    comptime QueryCondition: type,
    input: *css.Parser,
    flags: QueryConditionFlags,
) Error!QueryCondition {
    const location = input.currentSourceLocation();
    const is_negation, const is_style = brk: {
        const tok = try input.next();
        switch (tok.*) {
            .open_paren => break :brk .{ false, false },
            .ident => |ident| {
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "not")) break :brk .{ true, false };
            },
            .function => |f| {
                if (flags.contains(QueryConditionFlags{ .allow_style = true }) and
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(f, "style"))
                {
                    break :brk .{ false, true };
                }
            },
            else => {},
        }
        return location.newUnexpectedTokenError(tok.*);
    };

    const alloc: Allocator = {
        @compileError(css.todo_stuff.think_about_allocator);
    };

    const first_condition: QueryCondition = first_condition: {
        const val: u8 = @as(u8, @intFromBool(is_negation)) << 1 | @as(u8, @intFromBool(is_style));
        // (is_negation, is_style)
        switch (val) {
            // (true, false)
            0b10 => {
                const inner_condition = try parseParensOrFunction(QueryCondition, input, flags);
                return QueryCondition.createNegation(bun.create(alloc, QueryCondition, inner_condition));
            },
            // (true, true)
            0b11 => {
                const inner_condition = try QueryCondition.parseStyleQuery(input);
                return QueryCondition.createNegation(bun.create(alloc, QueryCondition, inner_condition));
            },
            0b00 => break :first_condition try parseParenBlock(QueryCondition, input, flags),
            0b01 => break :first_condition try QueryCondition.parseStyleQuery(input),
            else => unreachable,
        }
    };

    const operator: Operator = if (input.tryParse(Operator.parse, .{})) |op|
        op
    else
        return first_condition;

    if (!flags.contains(QueryConditionFlags{ .allow_or = true }) and operator == .@"or") {
        return location.newUnexpectedTokenError(css.Token{ .ident = "or" });
    }

    var conditions = ArrayList(QueryCondition){};
    conditions.append(
        @compileError(css.todo_stuff.think_about_allocator),
        first_condition,
    ) catch unreachable;
    conditions.append(
        @compileError(css.todo_stuff.think_about_allocator),
        try parseParensOrFunction(QueryCondition, input, flags),
    ) catch unreachable;

    const delim = switch (operator) {
        .@"and" => "and",
        .@"or" => "or",
    };

    while (true) {
        input.tryParse(css.Parser.expectIdentMatching, .{delim}) catch {
            return QueryCondition.createOperation(operator, conditions);
        };

        conditions.append(
            @compileError(css.todo_stuff.think_about_allocator),
            try parseParensOrFunction(QueryCondition, input, flags),
        ) catch unreachable;
    }
}

/// Parse a media condition in parentheses, or a style() function.
pub fn parseParensOrFunction(
    comptime QueryCondition: type,
    input: *css.Parser,
    flags: QueryConditionFlags,
) Error!QueryCondition {
    const location = input.currentSourceLocation();
    const t = try input.next();
    switch (t.*) {
        .open_paren => return parseParenBlock(QueryCondition, input, flags),
        .function => |f| {
            if (flags.contains(QueryConditionFlags{ .allow_style = true }) and
                bun.strings.eqlCaseInsensitiveASCIIICheckLength(f, "style"))
            {
                return QueryCondition.parseStyleQuery(input);
            }
        },
        else => {},
    }
    return location.newUnexpectedTokenError(t.*);
}

fn parseParenBlock(
    comptime QueryCondition: type,
    input: *css.Parser,
    flags: QueryConditionFlags,
) Error!QueryCondition {
    const Closure = struct {
        flags: QueryConditionFlags,
        pub fn parseNestedBlockFn(this: *@This(), i: *css.Parser) Error!QueryCondition {
            if (i.tryParse(@This().tryParseFn, .{this})) |inner| {
                return inner;
            }

            return QueryCondition.parseFeature(i);
        }

        pub fn tryParseFn(i: *css.Parser, this: *@This()) Error!QueryCondition {
            return parseQueryCondition(QueryCondition, i, this.flags);
        }
    };

    var closure = Closure{
        .flags = flags,
    };
    return try input.parseNestedBlock(QueryCondition, &closure, Closure.parseNestedBlockFn);
}

/// A [media feature](https://drafts.csswg.org/mediaqueries/#typedef-media-feature)
pub const MediaFeature = QueryFeature(MediaFeatureId);

const MediaFeatureId = union(enum) {
    /// The [width](https://w3c.github.io/csswg-drafts/mediaqueries-5/#width) media feature.
    width,
    /// The [height](https://w3c.github.io/csswg-drafts/mediaqueries-5/#height) media feature.
    height,
    /// The [aspect-ratio](https://w3c.github.io/csswg-drafts/mediaqueries-5/#aspect-ratio) media feature.
    @"aspect-ratio",
    /// The [orientation](https://w3c.github.io/csswg-drafts/mediaqueries-5/#orientation) media feature.
    orientation,
    /// The [overflow-block](https://w3c.github.io/csswg-drafts/mediaqueries-5/#overflow-block) media feature.
    @"overflow-block",
    /// The [overflow-inline](https://w3c.github.io/csswg-drafts/mediaqueries-5/#overflow-inline) media feature.
    @"overflow-inline",
    /// The [horizontal-viewport-segments](https://w3c.github.io/csswg-drafts/mediaqueries-5/#horizontal-viewport-segments) media feature.
    @"horizontal-viewport-segments",
    /// The [vertical-viewport-segments](https://w3c.github.io/csswg-drafts/mediaqueries-5/#vertical-viewport-segments) media feature.
    @"vertical-viewport-segments",
    /// The [display-mode](https://w3c.github.io/csswg-drafts/mediaqueries-5/#display-mode) media feature.
    @"display-mode",
    /// The [resolution](https://w3c.github.io/csswg-drafts/mediaqueries-5/#resolution) media feature.
    resolution,
    /// The [scan](https://w3c.github.io/csswg-drafts/mediaqueries-5/#scan) media feature.
    scan,
    /// The [grid](https://w3c.github.io/csswg-drafts/mediaqueries-5/#grid) media feature.
    grid,
    /// The [update](https://w3c.github.io/csswg-drafts/mediaqueries-5/#update) media feature.
    update,
    /// The [environment-blending](https://w3c.github.io/csswg-drafts/mediaqueries-5/#environment-blending) media feature.
    @"environment-blending",
    /// The [color](https://w3c.github.io/csswg-drafts/mediaqueries-5/#color) media feature.
    color,
    /// The [color-index](https://w3c.github.io/csswg-drafts/mediaqueries-5/#color-index) media feature.
    @"color-index",
    /// The [monochrome](https://w3c.github.io/csswg-drafts/mediaqueries-5/#monochrome) media feature.
    monochrome,
    /// The [color-gamut](https://w3c.github.io/csswg-drafts/mediaqueries-5/#color-gamut) media feature.
    @"color-gamut",
    /// The [dynamic-range](https://w3c.github.io/csswg-drafts/mediaqueries-5/#dynamic-range) media feature.
    @"dynamic-range",
    /// The [inverted-colors](https://w3c.github.io/csswg-drafts/mediaqueries-5/#inverted-colors) media feature.
    @"inverted-colors",
    /// The [pointer](https://w3c.github.io/csswg-drafts/mediaqueries-5/#pointer) media feature.
    pointer,
    /// The [hover](https://w3c.github.io/csswg-drafts/mediaqueries-5/#hover) media feature.
    hover,
    /// The [any-pointer](https://w3c.github.io/csswg-drafts/mediaqueries-5/#any-pointer) media feature.
    @"any-pointer",
    /// The [any-hover](https://w3c.github.io/csswg-drafts/mediaqueries-5/#any-hover) media feature.
    @"any-hover",
    /// The [nav-controls](https://w3c.github.io/csswg-drafts/mediaqueries-5/#nav-controls) media feature.
    @"nav-controls",
    /// The [video-color-gamut](https://w3c.github.io/csswg-drafts/mediaqueries-5/#video-color-gamut) media feature.
    @"video-color-gamut",
    /// The [video-dynamic-range](https://w3c.github.io/csswg-drafts/mediaqueries-5/#video-dynamic-range) media feature.
    @"video-dynamic-range",
    /// The [scripting](https://w3c.github.io/csswg-drafts/mediaqueries-5/#scripting) media feature.
    scripting,
    /// The [prefers-reduced-motion](https://w3c.github.io/csswg-drafts/mediaqueries-5/#prefers-reduced-motion) media feature.
    @"prefers-reduced-motion",
    /// The [prefers-reduced-transparency](https://w3c.github.io/csswg-drafts/mediaqueries-5/#prefers-reduced-transparency) media feature.
    @"prefers-reduced-transparency",
    /// The [prefers-contrast](https://w3c.github.io/csswg-drafts/mediaqueries-5/#prefers-contrast) media feature.
    @"prefers-contrast",
    /// The [forced-colors](https://w3c.github.io/csswg-drafts/mediaqueries-5/#forced-colors) media feature.
    @"forced-colors",
    /// The [prefers-color-scheme](https://w3c.github.io/csswg-drafts/mediaqueries-5/#prefers-color-scheme) media feature.
    @"prefers-color-scheme",
    /// The [prefers-reduced-data](https://w3c.github.io/csswg-drafts/mediaqueries-5/#prefers-reduced-data) media feature.
    @"prefers-reduced-data",
    /// The [device-width](https://w3c.github.io/csswg-drafts/mediaqueries-5/#device-width) media feature.
    @"device-width",
    /// The [device-height](https://w3c.github.io/csswg-drafts/mediaqueries-5/#device-height) media feature.
    @"device-height",
    /// The [device-aspect-ratio](https://w3c.github.io/csswg-drafts/mediaqueries-5/#device-aspect-ratio) media feature.
    @"device-aspect-ratio",

    /// The non-standard -webkit-device-pixel-ratio media feature.
    @"-webkit-device-pixel-ratio",
    /// The non-standard -moz-device-pixel-ratio media feature.
    @"-moz-device-pixel-ratio",

    pub usingnamespace css.DefineEnumProperty(@This());

    const meta = .{
        .width = MediaFeatureType.length,
        .height = MediaFeatureType.length,
        .@"aspect-ratio" = MediaFeatureType.ratio,
        .orientation = MediaFeatureType.ident,
        .@"overflow-block" = MediaFeatureType.ident,
        .@"overflow-inline" = MediaFeatureType.ident,
        .@"horizontal-viewport-segments" = MediaFeatureType.integer,
        .@"vertical-viewport-segments" = MediaFeatureType.integer,
        .@"display-mode" = MediaFeatureType.ident,
        .resolution = MediaFeatureType.resolution,
        .scan = MediaFeatureType.ident,
        .grid = MediaFeatureType.boolean,
        .update = MediaFeatureType.ident,
        .@"environment-blending" = MediaFeatureType.ident,
        .color = MediaFeatureType.integer,
        .@"color-index" = MediaFeatureType.integer,
        .monochrome = MediaFeatureType.integer,
        .@"color-gamut" = MediaFeatureType.ident,
        .@"dynamic-range" = MediaFeatureType.ident,
        .@"inverted-colors" = MediaFeatureType.ident,
        .pointer = MediaFeatureType.ident,
        .hover = MediaFeatureType.ident,
        .@"any-pointer" = MediaFeatureType.ident,
        .@"any-hover" = MediaFeatureType.ident,
        .@"nav-controls" = MediaFeatureType.ident,
        .@"video-color-gamut" = MediaFeatureType.ident,
        .@"video-dynamic-range" = MediaFeatureType.ident,
        .scripting = MediaFeatureType.ident,
        .@"prefers-reduced-motion" = MediaFeatureType.ident,
        .@"prefers-reduced-transparency" = MediaFeatureType.ident,
        .@"prefers-contrast" = MediaFeatureType.ident,
        .@"forced-colors" = MediaFeatureType.ident,
        .@"prefers-color-scheme" = MediaFeatureType.ident,
        .@"prefers-reduced-data" = MediaFeatureType.ident,
        .@"device-width" = MediaFeatureType.length,
        .@"device-height" = MediaFeatureType.length,
        .@"device-aspect-ratio" = MediaFeatureType.ratio,
        .@"-webkit-device-pixel-ratio" = MediaFeatureType.number,
        .@"-moz-device-pixel-ratio" = MediaFeatureType.number,
    };

    // Make sure we defined ecah field
    comptime {
        const fields = std.meta.fields(@This());
        for (fields) |field| {
            _ = @field(meta, field.name);
        }
    }

    pub fn valueType(this: *const MediaFeatureId) MediaFeatureType {
        return @field(meta, @tagName(this.*));
    }
};

pub fn QueryFeature(comptime FeatureId: type) type {
    return union(enum) {
        /// A plain media feature, e.g. `(min-width: 240px)`.
        plain: struct {
            /// The name of the feature.
            name: MediaFeatureName(FeatureId),
            /// The feature value.
            value: MediaFeatureValue,
        },

        /// A boolean feature, e.g. `(hover)`.
        boolean: struct {
            /// The name of the feature.
            name: MediaFeatureName(FeatureId),
        },

        /// A range, e.g. `(width > 240px)`.
        range: struct {
            /// The name of the feature.
            name: MediaFeatureName(FeatureId),
            /// A comparator.
            operator: MediaFeatureComparison,
            /// The feature value.
            value: MediaFeatureValue,
        },

        /// An interval, e.g. `(120px < width < 240px)`.
        interval: struct {
            /// The name of the feature.
            name: MediaFeatureName(FeatureId),
            /// A start value.
            start: MediaFeatureValue,
            /// A comparator for the start value.
            start_operator: MediaFeatureComparison,
            /// The end value.
            end: MediaFeatureValue,
            /// A comparator for the end value.
            end_operator: MediaFeatureComparison,
        },

        const This = @This();

        pub fn needsParens(this: *const This, parent_operator: ?Operator, targets: *const css.Targets) bool {
            return parent_operator != .@"and" and
                this.* == .interval and
                targets.shouldCompile(css.Features{ .media_interval_syntax = true });
        }

        pub fn parse(input: *css.Parser) Error!This {
            if (input.tryParse(parseNameFirst, .{})) |res| {
                return res;
            } else |e| {
                if (e == css.ParserError.invalid_media_query) {
                    @compileError(css.todo_stuff.errors);
                }
                return parseValueFirst(input);
            }
        }

        pub fn parseNameFirst(input: *css.Parser) Error!This {
            const name, const legacy_op = try MediaFeatureName(FeatureId).parse(input);

            const operator = if (input.tryParse(consumeOperationOrColon, .{true})) |operator| operator else return .{
                .boolean = .{ .name = name },
            };

            if (operator != null and legacy_op != null) {
                return try input.newCustomError(css.ParserError.invalid_media_query);
            }

            const value = try MediaFeatureValue.parse(input, name.valueType());
            if (!value.checkType(name.valueType())) {
                return try input.newCustomError(css.ParserError.invalid_media_query);
            }

            if (operator orelse legacy_op) |op| {
                if (!name.valueType().allowsRanges()) {
                    return try input.newCustomError(css.ParserError.invalid_media_query);
                }

                return .{
                    .range = .{
                        .name = name,
                        .operator = op,
                        .value = value,
                    },
                };
            } else {
                return .{
                    .plain = .{
                        .name = name,
                        .value = value,
                    },
                };
            }
        }

        pub fn parseValueFirst(input: *css.Parser) Error!This {
            // We need to find the feature name first so we know the type.
            const start = input.state();
            const name = name: {
                while (true) {
                    if (MediaFeatureName(FeatureId).parse(input)) |result| {
                        const name: MediaFeatureName(FeatureId) = result[0];
                        const legacy_op: ?MediaFeatureComparison = result[1];
                        if (legacy_op != null) {
                            return input.newCustomError(css.ParserError.invalid_media_query);
                        }
                        break :name name;
                    }
                    if (input.isExhausted()) {
                        return input.newCustomError(css.ParserError.invalid_media_query);
                    }
                }
            };

            input.reset(&start);

            // Now we can parse the first value.
            const value = try MediaFeatureValue.parse(input, name.valueType());
            const operator = try consumeOperationOrColon(input, false);

            // Skip over the feature name again.
            {
                const feature_name, const blah = try MediaFeatureName(FeatureId).parse(input);
                _ = blah;
                bun.debugAssert(bun.strings.eql(feature_name, name));
            }

            if (!name.valueType().allowsRanges() or !value.checkType(name.valueType())) {
                return input.newCustomError(css.ParserError.invalid_media_query);
            }

            if (input.tryParse(consumeOperationOrColon, .{ input, false })) |end_operator_| {
                const start_operator = operator.?;
                const end_operator = end_operator_.?;
                // Start and end operators must be matching.
                const GT: u8 = comptime @intFromEnum(MediaFeatureComparison.@"greater-than");
                const GTE: u8 = comptime @intFromEnum(MediaFeatureComparison.@"greater-than-equal");
                const LT: u8 = comptime @intFromEnum(MediaFeatureComparison.@"less-than");
                const LTE: u8 = comptime @intFromEnum(MediaFeatureComparison.@"less-than-equal");
                const check_val: u8 = @intFromEnum(start_operator) | @intFromEnum(end_operator);
                switch (check_val) {
                    GT | GT,
                    GT | GTE,
                    GTE | GTE,
                    LT | LT,
                    LT | LTE,
                    LTE | LTE,
                    => {},
                    else => return input.newCustomError(css.ParserError.invalid_media_query),
                }

                const end_value = try MediaFeatureValue.parse(input, name.valueType());
                if (!end_value.checkType(name.valueType())) {
                    return input.newCustomError(css.ParserError.invalid_media_query);
                }

                return .{
                    .interval = .{
                        .name = name,
                        .start = value,
                        .start_operator = start_operator,
                        .end = end_value,
                        .end_operator = end_operator,
                    },
                };
            } else {
                const final_operator = operator.?.opposite();
                _ = final_operator; // autofix
                return .{
                    .range = .{
                        .name = name,
                        .operator = operator,
                        .value = value,
                    },
                };
            }
        }
    };
}

/// Consumes an operation or a colon, or returns an error.
fn consumeOperationOrColon(input: *css.Parser, allow_colon: bool) Error!(?MediaFeatureComparison) {
    const location = input.currentSourceLocation();
    const first_delim = first_delim: {
        const loc = input.currentSourceLocation();
        const next_token = try input.next();
        switch (next_token.*) {
            .colon => if (allow_colon) return null,
            .delim => |oper| break :first_delim oper,
            else => {},
        }
        return loc.newUnexpectedTokenError(next_token.*);
    };

    switch (first_delim) {
        '=' => return .equal,
        '>' => {
            if (input.tryParse(css.Parser.expectDelim, .{'='})) {
                return .@"greater-than-equal";
            }
            return .@"greater-than";
        },
        '<' => {
            if (input.tryParse(css.Parser.expectDelim, .{'='})) {
                return .@"less-than-equal";
            }
            return .@"less-than";
        },
        else => return location.newUnexpectedTokenError(.{ .delim = first_delim }),
    }
}

pub const MediaFeatureComparison = enum(u8) {
    /// `=`
    equal = 1,
    /// `>`
    @"greater-than" = 2,
    /// `>=`
    @"greater-than-equal" = 4,
    /// `<`
    @"less-than" = 8,
    /// `<=`
    @"less-than-equal" = 16,

    pub usingnamespace css.DefineEnumProperty(@This());

    pub fn opposite(this: MediaFeatureComparison) MediaFeatureComparison {
        return switch (this) {
            .equal => .equal,
            .@"greater-than" => .@"less-than",
            .@"greater-than-equal" => .@"less-than-equal",
            .@"less-than" => .@"greater-than",
            .@"less-than-equal" => .@"greater-than-equal",
        };
    }
};

/// [media feature value](https://drafts.csswg.org/mediaqueries/#typedef-mf-value) within a media query.
///
/// See [MediaFeature](MediaFeature).
pub const MediaFeatureValue = union(enum) {
    /// A length value.
    length: Length,
    /// A number value.
    number: CSSNumber,
    /// An integer value.
    integer: CSSInteger,
    /// A boolean value.
    boolean: bool,
    /// A resolution.
    resolution: Resolution,
    /// A ratio.
    ratio: Ratio,
    /// An identifier.
    ident: Ident,
    /// An environment variable reference.
    env: EnvironmentVariable,

    pub fn checkType(this: *const @This(), expected_type: MediaFeatureType) bool {
        const vt = this.valueType();
        if (expected_type == .unknown or vt == .unknown) return true;
        return expected_type == vt;
    }

    /// Parses a single media query feature value, with an expected type.
    /// If the type is unknown, pass MediaFeatureType::Unknown instead.
    pub fn parse(input: *css.Parser, expected_type: MediaFeatureType) Error!MediaFeatureValue {
        if (input.tryParse(parseKnown, .{expected_type})) |value| {
            return value;
        }

        return parseUnknown(input);
    }

    pub fn parseKnown(input: *css.Parser, expected_type: MediaFeatureType) Error!MediaFeatureValue {
        return switch (expected_type) {
            .bool => {
                const value = try CSSIntegerFns.parse(input);
                if (value != 0 and value != 1) return input.newCustomError(css.ParserError.invalid_value);
                return .{ .boolean = value == 1 };
            },
            .number => .{ .number = try CSSNumberFns.parse(input) },
            .integer => .{ .integer = try CSSIntegerFns.parse(input) },
            .length => .{ .integer = try Length.parse(input) },
        };
    }

    pub fn parseUnknown(input: *css.Parser) Error!MediaFeatureValue {
        // Ratios are ambiguous with numbers because the second param is optional (e.g. 2/1 == 2).
        // We require the / delimiter when parsing ratios so that 2/1 ends up as a ratio and 2 is
        // parsed as a number.
        if (input.tryParse(Ratio.parseRequired, .{})) |ratio| return .{ .ratio = ratio };

        // Parse number next so that unitless values are not parsed as lengths.
        if (input.tryParse(CSSNumberFns.parse, .{})) |num| return .{ .number = num };

        if (input.tryParse(Length.parse, .{})) |res| return .{ .length = res };

        if (input.tryParse(Resolution.parse, .{})) |res| return .{ .resolution = res };

        if (input.tryParse(EnvironmentVariable.parse, .{})) |env| return .{ .env = env };

        const ident = try IdentFns.parse(input);
        return .{ .ident = ident };
    }
};

/// The type of a media feature.
pub const MediaFeatureType = enum {
    /// A length value.
    length,
    /// A number value.
    number,
    /// An integer value.
    integer,
    /// A boolean value, either 0 or 1.
    boolean,
    /// A resolution.
    resolution,
    /// A ratio.
    ratio,
    /// An identifier.
    ident,
    /// An unknown type.
    unknown,

    pub fn allowsRanges(this: MediaFeatureType) bool {
        return switch (this) {
            .length, .number, .integer, .resolution, .ratio, .unknown => true,
            .boolean, .ident => false,
        };
    }
};

pub fn MediaFeatureName(comptime FeatureId: type) type {
    return union(enum) {
        /// A standard media query feature identifier.
        standard: FeatureId,

        /// A custom author-defined environment variable.
        custom: DashedIdent,

        /// An unknown environment variable.
        unknown: Ident,

        const This = @This();

        pub fn valueType(this: *const This) MediaFeatureType {
            return switch (this) {
                .standard => |standard| standard.valueType(),
                _ => .unknown,
            };
        }

        /// Parses a media feature name.
        pub fn parse(input: *css.Parser) Error!struct { This, ?MediaFeatureComparison } {
            const alloc: Allocator = {
                @compileError(css.todo_stuff.think_about_allocator);
            };
            const ident = try input.expectIdent();

            if (bun.strings.startsWith(ident, "--")) {
                return .{
                    .{
                        .custom = .ident,
                    },
                    null,
                };
            }

            var name = ident;

            // Webkit places its prefixes before "min" and "max". Remove it first, and
            // re-add after removing min/max.
            const is_webkit = bun.strings.startsWithCaseInsensitiveAscii(name, "-webkit-");
            if (is_webkit) {
                name = name[8..];
            }

            const comparator = comparator: {
                if (bun.strings.startsWithCaseInsensitiveAscii(name, "min-")) {
                    name = name[4..];
                    break :comparator .@"greater-than-equal";
                } else if (bun.strings.startsWithCaseInsensitiveAscii(name, "max-")) {
                    name = name[4..];
                    break :comparator .@"less-than-equal";
                } else break :comparator null;
            };

            const final_name = if (is_webkit) name: {
                // PERF: stack buffer here?
                break :name std.fmt.allocPrint(alloc, "-webkit-{s}", .{}) catch bun.outOfMemory();
            } else name;

            if (FeatureId.parseString(final_name)) |standard| {
                return .{
                    .{ .standard = standard },
                    comparator,
                };
            }

            return .{
                .{
                    .unknown = ident,
                },
                null,
            };
        }
    };
}
