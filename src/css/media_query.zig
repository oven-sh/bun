pub const css = @import("./css_parser.zig");
pub const Error = css.Error;

const Length = css.css_values.length.Length;
const CSSNumber = css.css_values.number.CSSNumber;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const CSSInteger = css.css_values.number.CSSInteger;
const CSSIntegerFns = css.css_values.number.CSSIntegerFns;
const Resolution = css.css_values.resolution.Resolution;
const Ratio = css.css_values.ratio.Ratio;
const Ident = css.css_values.ident.Ident;
const IdentFns = css.css_values.ident.IdentFns;
const EnvironmentVariable = css.css_properties.custom.EnvironmentVariable;
const DashedIdent = css.css_values.ident.DashedIdent;
const DashedIdentFns = css.css_values.ident.DashedIdentFns;

const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Result = css.Result;

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
    media_queries: ArrayList(MediaQuery) = .{},

    /// Parse a media query list from CSS.
    pub fn parse(input: *css.Parser) Result(MediaList) {
        var media_queries = ArrayList(MediaQuery){};
        while (true) {
            const mq = switch (input.parseUntilBefore(css.Delimiters{ .comma = true }, MediaQuery, {}, css.voidWrap(MediaQuery, MediaQuery.parse))) {
                .result => |v| v,
                .err => |e| {
                    if (e.kind == .basic and e.kind.basic == .end_of_input) break;
                    return .{ .err = e };
                },
            };
            bun.handleOom(media_queries.append(input.allocator(), mq));

            if (input.next().asValue()) |tok| {
                if (tok.* != .comma) {
                    bun.Output.panic("Unreachable code: expected a comma after parsing a MediaQuery.\n\nThis is a bug in Bun's CSS parser. Please file a bug report at https://github.com/oven-sh/bun/issues/new/choose", .{});
                }
            } else break;
        }

        return .{ .result = MediaList{ .media_queries = media_queries } };
    }

    pub fn toCss(this: *const MediaList, dest: *css.Printer) PrintErr!void {
        if (this.media_queries.items.len == 0) {
            return dest.writeStr("not all");
        }

        var first = true;
        for (this.media_queries.items) |*query| {
            if (!first) {
                try dest.delim(',', false);
            }
            first = false;
            try query.toCss(dest);
        }
        return;
    }

    pub fn hash(this: *const @This(), hasher: anytype) void {
        return css.implementHash(@This(), this, hasher);
    }

    pub fn eql(lhs: *const MediaList, rhs: *const MediaList) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const MediaList, allocator: std.mem.Allocator) MediaList {
        return MediaList{
            .media_queries = css.deepClone(MediaQuery, allocator, &this.media_queries),
        };
    }

    pub fn cloneWithImportRecords(
        this: *const @This(),
        allocator: std.mem.Allocator,
        _: *bun.BabyList(bun.ImportRecord),
    ) @This() {
        return deepClone(this, allocator);
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

    /// Returns whether the media query list never matches.
    pub fn neverMatches(this: *const MediaList) bool {
        return this.media_queries.items.len > 0 and brk: {
            for (this.media_queries.items) |*query| {
                if (!query.neverMatches()) break :brk false;
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

    pub fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn parse(input: *css.Parser) Result(@This()) {
        return css.enum_property_util.parse(@This(), input);
    }

    pub fn toCss(this: *const @This(), dest: *Printer) PrintErr!void {
        return css.enum_property_util.toCss(@This(), this, dest);
    }
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

    pub fn deepClone(this: *const MediaQuery, allocator: std.mem.Allocator) MediaQuery {
        return MediaQuery{
            .qualifier = if (this.qualifier) |q| q else null,
            .media_type = this.media_type,
            .condition = if (this.condition) |*c| c.deepClone(allocator) else null,
        };
    }

    pub fn hash(this: *const @This(), hasher: anytype) void {
        return css.implementHash(@This(), this, hasher);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    /// Returns whether the media query is guaranteed to always match.
    pub fn alwaysMatches(this: *const MediaQuery) bool {
        return this.qualifier == null and this.media_type == .all and this.condition == null;
    }

    pub fn parse(input: *css.Parser) Result(MediaQuery) {
        const Fn = struct {
            pub fn tryParseFn(i: *css.Parser) Result(struct { ?Qualifier, ?MediaType }) {
                const qualifier = switch (i.tryParse(Qualifier.parse, .{})) {
                    .result => |vv| vv,
                    .err => null,
                };
                const media_type = switch (MediaType.parse(i)) {
                    .result => |vv| vv,
                    .err => |e| return .{ .err = e },
                };
                return .{ .result = .{ qualifier, media_type } };
            }
        };
        const qualifier, const explicit_media_type = switch (input.tryParse(Fn.tryParseFn, .{})) {
            .result => |v| v,
            .err => .{ null, null },
        };

        const condition = if (explicit_media_type == null)
            switch (MediaCondition.parseWithFlags(input, .{ .allow_or = true })) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            }
        else if (input.tryParse(css.Parser.expectIdentMatching, .{"and"}).isOk())
            switch (MediaCondition.parseWithFlags(input, .{})) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            }
        else
            null;

        const media_type = explicit_media_type orelse MediaType.all;

        return .{
            .result = MediaQuery{
                .qualifier = qualifier,
                .media_type = media_type,
                .condition = condition,
            },
        };
    }

    pub fn toCss(this: *const This, dest: *Printer) PrintErr!void {
        if (this.qualifier) |qual| {
            try qual.toCss(dest);
            try dest.writeChar(' ');
        }

        switch (this.media_type) {
            .all => {
                // We need to print "all" if there's a qualifier, or there's
                // just an empty list of expressions.
                //
                // Otherwise, we'd serialize media queries like "(min-width:
                // 40px)" in "all (min-width: 40px)", which is unexpected.
                if (this.qualifier != null or this.condition == null) {
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
            try dest.writeStr(" and ");
            break :needs_parens condition.* == .operation and condition.operation.operator != .@"and";
        } else false;

        return toCssWithParensIfNeeded(condition, dest, needs_parens);
    }

    pub fn neverMatches(this: *const MediaQuery) bool {
        return this.qualifier == .not and this.media_type == .all and this.condition == null;
    }
};

/// Flags for `parse_query_condition`.
pub const QueryConditionFlags = packed struct(u8) {
    /// Whether to allow top-level "or" boolean logic.
    allow_or: bool = false,
    /// Whether to allow style container queries.
    allow_style: bool = false,
    __unused: u6 = 0,
};

pub fn toCssWithParensIfNeeded(
    v: anytype,
    dest: *Printer,
    needs_parens: bool,
) PrintErr!void {
    if (needs_parens) {
        try dest.writeChar('(');
    }
    try v.toCss(dest);
    if (needs_parens) {
        try dest.writeChar(')');
    }
    return;
}

/// A [media query qualifier](https://drafts.csswg.org/mediaqueries/#mq-prefix).
pub const Qualifier = enum {
    /// Prevents older browsers from matching the media query.
    only,
    /// Negates a media query.
    not,

    pub fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn parse(input: *css.Parser) Result(@This()) {
        return css.enum_property_util.parse(@This(), input);
    }

    pub fn toCss(this: *const @This(), dest: *Printer) PrintErr!void {
        return css.enum_property_util.toCss(@This(), this, dest);
    }

    pub fn hash(this: *const @This(), hasher: anytype) void {
        return css.implementHash(@This(), this, hasher);
    }
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

    pub fn parse(input: *css.Parser) Result(MediaType) {
        const name = switch (input.expectIdent()) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        return .{ .result = MediaType.fromStr(name) };
    }

    pub fn fromStr(name: []const u8) MediaType {
        const Enumerations = enum { all, print, screen };
        const Map = comptime bun.ComptimeEnumMap(Enumerations);
        if (Map.getASCIIICaseInsensitive(name)) |x| return switch (x) {
            .all => .all,
            .print => .print,
            .screen => .screen,
        };
        return .{ .custom = name };
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn hash(this: *const @This(), hasher: anytype) void {
        return css.implementHash(@This(), this, hasher);
    }
};

pub fn operationToCss(comptime QueryCondition: type, operator: Operator, conditions: *const ArrayList(QueryCondition), dest: *Printer) PrintErr!void {
    ValidQueryCondition(QueryCondition);
    const first = &conditions.items[0];
    try toCssWithParensIfNeeded(first, dest, first.needsParens(operator, &dest.targets));
    if (conditions.items.len == 1) return;
    for (conditions.items[1..]) |*item| {
        try dest.writeChar(' ');
        try operator.toCss(dest);
        try dest.writeChar(' ');
        try toCssWithParensIfNeeded(item, dest, item.needsParens(operator, &dest.targets));
    }
    return;
}

/// Represents a media condition.
///
/// Implements QueryCondition interface.
pub const MediaCondition = union(enum) {
    feature: MediaFeature,
    not: *MediaCondition,
    operation: struct {
        operator: Operator,
        conditions: ArrayList(MediaCondition),

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }
    },

    const This = @This();

    pub fn toCss(this: *const This, dest: *Printer) PrintErr!void {
        switch (this.*) {
            .feature => |*f| {
                try f.toCss(dest);
            },
            .not => |c| {
                try dest.writeStr("not ");
                try toCssWithParensIfNeeded(c, dest, c.needsParens(null, &dest.targets));
            },
            .operation => |operation| {
                try operationToCss(MediaCondition, operation.operator, &operation.conditions, dest);
            },
        }

        return;
    }

    /// QueryCondition.parseFeature
    pub fn parseFeature(input: *css.Parser) Result(MediaCondition) {
        const feature = switch (MediaFeature.parse(input)) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        return .{ .result = MediaCondition{ .feature = feature } };
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
    pub fn parseStyleQuery(input: *css.Parser) Result(MediaCondition) {
        return .{ .err = input.newErrorForNextToken() };
    }

    /// QueryCondition.needsParens
    pub fn needsParens(this: *const MediaCondition, parent_operator: ?Operator, targets: *const css.targets.Targets) bool {
        return switch (this.*) {
            .not => true,
            .operation => |operation| operation.operator != parent_operator,
            .feature => |f| f.needsParens(parent_operator, targets),
        };
    }

    pub fn parseWithFlags(input: *css.Parser, flags: QueryConditionFlags) Result(MediaCondition) {
        return parseQueryCondition(MediaCondition, input, flags);
    }

    pub fn deepClone(this: *const MediaCondition, allocator: std.mem.Allocator) MediaCondition {
        return switch (this.*) {
            .feature => |*f| MediaCondition{ .feature = f.deepClone(allocator) },
            .not => |c| MediaCondition{ .not = bun.create(allocator, MediaCondition, c.deepClone(allocator)) },
            .operation => |op| MediaCondition{
                .operation = .{
                    .operator = op.operator,
                    .conditions = css.deepClone(MediaCondition, allocator, &op.conditions),
                },
            },
        };
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn hash(this: *const @This(), hasher: anytype) void {
        return css.implementHash(@This(), this, hasher);
    }
};

/// Parse a single query condition.
pub fn parseQueryCondition(
    comptime QueryCondition: type,
    input: *css.Parser,
    flags: QueryConditionFlags,
) Result(QueryCondition) {
    const location = input.currentSourceLocation();
    const is_negation, const is_style = brk: {
        const tok = switch (input.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        switch (tok.*) {
            .open_paren => break :brk .{ false, false },
            .ident => |ident| {
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "not")) break :brk .{ true, false };
            },
            .function => |f| {
                if (flags.allow_style and
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(f, "style"))
                {
                    break :brk .{ false, true };
                }
            },
            else => {},
        }
        return .{ .err = location.newUnexpectedTokenError(tok.*) };
    };

    const first_condition: QueryCondition = first_condition: {
        const val: u8 = @as(u8, @intFromBool(is_negation)) << 1 | @as(u8, @intFromBool(is_style));
        // (is_negation, is_style)
        switch (val) {
            // (true, false)
            0b10 => {
                const inner_condition = switch (parseParensOrFunction(QueryCondition, input, flags)) {
                    .err => |e| return .{ .err = e },
                    .result => |v| v,
                };
                return .{ .result = QueryCondition.createNegation(bun.create(input.allocator(), QueryCondition, inner_condition)) };
            },
            // (true, true)
            0b11 => {
                const inner_condition = switch (QueryCondition.parseStyleQuery(input)) {
                    .err => |e| return .{ .err = e },
                    .result => |v| v,
                };
                return .{ .result = QueryCondition.createNegation(bun.create(input.allocator(), QueryCondition, inner_condition)) };
            },
            0b00 => break :first_condition switch (parseParenBlock(QueryCondition, input, flags)) {
                .err => |e| return .{ .err = e },
                .result => |v| v,
            },
            0b01 => break :first_condition switch (QueryCondition.parseStyleQuery(input)) {
                .err => |e| return .{ .err = e },
                .result => |v| v,
            },
            else => unreachable,
        }
    };

    const operator: Operator = if (input.tryParse(Operator.parse, .{}).asValue()) |op|
        op
    else
        return .{ .result = first_condition };

    if (!flags.allow_or and operator == .@"or") {
        return .{ .err = location.newUnexpectedTokenError(css.Token{ .ident = "or" }) };
    }

    var conditions = ArrayList(QueryCondition){};
    conditions.append(
        input.allocator(),
        first_condition,
    ) catch unreachable;
    conditions.append(
        input.allocator(),
        switch (parseParensOrFunction(QueryCondition, input, flags)) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        },
    ) catch unreachable;

    const delim = switch (operator) {
        .@"and" => "and",
        .@"or" => "or",
    };

    while (true) {
        if (input.tryParse(css.Parser.expectIdentMatching, .{delim}).isErr()) {
            return .{ .result = QueryCondition.createOperation(operator, conditions) };
        }

        conditions.append(
            input.allocator(),
            switch (parseParensOrFunction(QueryCondition, input, flags)) {
                .err => |e| return .{ .err = e },
                .result => |v| v,
            },
        ) catch unreachable;
    }
}

/// Parse a media condition in parentheses, or a style() function.
pub fn parseParensOrFunction(
    comptime QueryCondition: type,
    input: *css.Parser,
    flags: QueryConditionFlags,
) Result(QueryCondition) {
    const location = input.currentSourceLocation();
    const t = switch (input.next()) {
        .err => |e| return .{ .err = e },
        .result => |v| v,
    };
    switch (t.*) {
        .open_paren => return parseParenBlock(QueryCondition, input, flags),
        .function => |f| {
            if (flags.allow_style and
                bun.strings.eqlCaseInsensitiveASCIIICheckLength(f, "style"))
            {
                return QueryCondition.parseStyleQuery(input);
            }
        },
        else => {},
    }
    return .{ .err = location.newUnexpectedTokenError(t.*) };
}

fn parseParenBlock(
    comptime QueryCondition: type,
    input: *css.Parser,
    flags: QueryConditionFlags,
) Result(QueryCondition) {
    const Closure = struct {
        flags: QueryConditionFlags,
        pub fn parseNestedBlockFn(this: *@This(), i: *css.Parser) Result(QueryCondition) {
            if (i.tryParse(@This().tryParseFn, .{this}).asValue()) |inner| {
                return .{ .result = inner };
            }

            return QueryCondition.parseFeature(i);
        }

        pub fn tryParseFn(i: *css.Parser, this: *@This()) Result(QueryCondition) {
            return parseQueryCondition(QueryCondition, i, this.flags);
        }
    };

    var closure = Closure{
        .flags = flags,
    };
    return input.parseNestedBlock(QueryCondition, &closure, Closure.parseNestedBlockFn);
}

/// A [media feature](https://drafts.csswg.org/mediaqueries/#typedef-media-feature)
pub const MediaFeature = QueryFeature(MediaFeatureId);

pub const MediaFeatureId = enum {
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

    pub const valueType = css.DeriveValueType(@This(), ValueTypeMap).valueType;

    pub const ValueTypeMap = .{
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

    pub fn toCssWithPrefix(
        this: *const MediaFeatureId,
        prefix: []const u8,
        dest: *Printer,
    ) PrintErr!void {
        switch (this.*) {
            .@"-webkit-device-pixel-ratio" => {
                return dest.writeFmt("-webkit-{s}device-pixel-ratio", .{prefix});
            },
            else => {
                try dest.writeStr(prefix);
                return this.toCss(dest);
            },
        }
    }

    pub inline fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn parse(input: *css.Parser) Result(@This()) {
        return css.enum_property_util.parse(@This(), input);
    }

    pub fn toCss(this: *const @This(), dest: *Printer) PrintErr!void {
        return css.enum_property_util.toCss(@This(), this, dest);
    }

    pub fn hash(this: *const @This(), hasher: anytype) void {
        return css.implementHash(@This(), this, hasher);
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

            pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
                return css.implementEql(@This(), lhs, rhs);
            }

            pub fn __generateHash() void {}
        },

        /// A boolean feature, e.g. `(hover)`.
        boolean: struct {
            /// The name of the feature.
            name: MediaFeatureName(FeatureId),

            pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
                return css.implementEql(@This(), lhs, rhs);
            }

            pub fn __generateHash() void {}
        },

        /// A range, e.g. `(width > 240px)`.
        range: struct {
            /// The name of the feature.
            name: MediaFeatureName(FeatureId),
            /// A comparator.
            operator: MediaFeatureComparison,
            /// The feature value.
            value: MediaFeatureValue,

            pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
                return css.implementEql(@This(), lhs, rhs);
            }

            pub fn __generateHash() void {}
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

            pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
                return css.implementEql(@This(), lhs, rhs);
            }

            pub fn __generateHash() void {}
        },

        const This = @This();

        pub fn deepClone(this: *const This, allocator: std.mem.Allocator) This {
            return switch (this.*) {
                .plain => .{
                    .plain = .{
                        .name = this.plain.name,
                        .value = this.plain.value.deepClone(allocator),
                    },
                },
                .boolean => .{
                    .boolean = .{
                        .name = this.boolean.name,
                    },
                },
                .range => .{
                    .range = .{
                        .name = this.range.name,
                        .operator = this.range.operator,
                        .value = this.range.value.deepClone(allocator),
                    },
                },
                .interval => .{
                    .interval = .{
                        .name = this.interval.name,
                        .start = this.interval.start.deepClone(allocator),
                        .start_operator = this.interval.start_operator,
                        .end = this.interval.end.deepClone(allocator),
                        .end_operator = this.interval.end_operator,
                    },
                },
            };
        }

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }

        pub fn hash(this: *const @This(), hasher: anytype) void {
            return css.implementHash(@This(), this, hasher);
        }

        pub fn needsParens(this: *const This, parent_operator: ?Operator, targets: *const css.Targets) bool {
            return parent_operator != .@"and" and
                this.* == .interval and
                targets.shouldCompileSame(.media_interval_syntax);
        }

        pub fn toCss(this: *const This, dest: *Printer) PrintErr!void {
            try dest.writeChar('(');

            switch (this.*) {
                .boolean => {
                    try this.boolean.name.toCss(dest);
                },
                .plain => {
                    try this.plain.name.toCss(dest);
                    try dest.delim(':', false);
                    try this.plain.value.toCss(dest);
                },
                .range => {
                    // If range syntax is unsupported, use min/max prefix if possible.
                    if (dest.targets.shouldCompileSame(.media_range_syntax)) {
                        return writeMinMax(
                            &this.range.operator,
                            FeatureId,
                            &this.range.name,
                            &this.range.value,
                            dest,
                        );
                    }
                    try this.range.name.toCss(dest);
                    try this.range.operator.toCss(dest);
                    try this.range.value.toCss(dest);
                },
                .interval => |interval| {
                    if (dest.targets.shouldCompileSame(.media_interval_syntax)) {
                        try writeMinMax(
                            &interval.start_operator.opposite(),
                            FeatureId,
                            &interval.name,
                            &interval.start,
                            dest,
                        );
                        try dest.writeStr(" and (");
                        return writeMinMax(
                            &interval.end_operator,
                            FeatureId,
                            &interval.name,
                            &interval.end,
                            dest,
                        );
                    }

                    try interval.start.toCss(dest);
                    try interval.start_operator.toCss(dest);
                    try interval.name.toCss(dest);
                    try interval.end_operator.toCss(dest);
                    try interval.end.toCss(dest);
                },
            }

            return dest.writeChar(')');
        }

        pub fn parse(input: *css.Parser) Result(This) {
            switch (input.tryParse(parseNameFirst, .{})) {
                .result => |res| {
                    return .{ .result = res };
                },
                .err => |e| {
                    if (e.kind == .custom and e.kind.custom == .invalid_media_query) {
                        return .{ .err = e };
                    }
                    return parseValueFirst(input);
                },
            }
            return .success;
        }

        pub fn parseNameFirst(input: *css.Parser) Result(This) {
            const name, const legacy_op = switch (MediaFeatureName(FeatureId).parse(input)) {
                .err => |e| return .{ .err = e },
                .result => |v| v,
            };

            const operator = if (input.tryParse(consumeOperationOrColon, .{true}).asValue()) |operator| operator else return .{
                .result = .{
                    .boolean = .{ .name = name },
                },
            };

            if (operator != null and legacy_op != null) {
                return .{ .err = input.newCustomError(css.ParserError.invalid_media_query) };
            }

            const value = switch (MediaFeatureValue.parse(input, name.valueType())) {
                .err => |e| return .{ .err = e },
                .result => |v| v,
            };
            if (!value.checkType(name.valueType())) {
                return .{ .err = input.newCustomError(css.ParserError.invalid_media_query) };
            }

            if (operator orelse legacy_op) |op| {
                if (!name.valueType().allowsRanges()) {
                    return .{ .err = input.newCustomError(css.ParserError.invalid_media_query) };
                }

                return .{ .result = .{
                    .range = .{
                        .name = name,
                        .operator = op,
                        .value = value,
                    },
                } };
            } else {
                return .{ .result = .{
                    .plain = .{
                        .name = name,
                        .value = value,
                    },
                } };
            }
        }

        pub fn parseValueFirst(input: *css.Parser) Result(This) {
            // We need to find the feature name first so we know the type.
            const start = input.state();
            const name = name: {
                while (true) {
                    if (MediaFeatureName(FeatureId).parse(input).asValue()) |result| {
                        const name: MediaFeatureName(FeatureId) = result[0];
                        const legacy_op: ?MediaFeatureComparison = result[1];
                        if (legacy_op != null) {
                            return .{ .err = input.newCustomError(css.ParserError.invalid_media_query) };
                        }
                        break :name name;
                    }
                    if (input.isExhausted()) {
                        return .{ .err = input.newCustomError(css.ParserError.invalid_media_query) };
                    }
                }
            };

            input.reset(&start);

            // Now we can parse the first value.
            const value = switch (MediaFeatureValue.parse(input, name.valueType())) {
                .err => |e| return .{ .err = e },
                .result => |v| v,
            };
            const operator = switch (consumeOperationOrColon(input, false)) {
                .err => |e| return .{ .err = e },
                .result => |v| v,
            };

            // Skip over the feature name again.
            {
                const feature_name, const blah = switch (MediaFeatureName(FeatureId).parse(input)) {
                    .err => |e| return .{ .err = e },
                    .result => |v| v,
                };
                _ = blah;
                bun.debugAssert(feature_name.eql(&name));
            }

            if (!name.valueType().allowsRanges() or !value.checkType(name.valueType())) {
                return .{ .err = input.newCustomError(css.ParserError.invalid_media_query) };
            }

            if (input.tryParse(consumeOperationOrColon, .{false}).asValue()) |end_operator_| {
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
                    else => return .{ .err = input.newCustomError(css.ParserError.invalid_media_query) },
                }

                const end_value = switch (MediaFeatureValue.parse(input, name.valueType())) {
                    .err => |e| return .{ .err = e },
                    .result => |v| v,
                };
                if (!end_value.checkType(name.valueType())) {
                    return .{ .err = input.newCustomError(css.ParserError.invalid_media_query) };
                }

                return .{ .result = .{
                    .interval = .{
                        .name = name,
                        .start = value,
                        .start_operator = start_operator,
                        .end = end_value,
                        .end_operator = end_operator,
                    },
                } };
            } else {
                const final_operator = operator.?.opposite();
                return .{ .result = .{
                    .range = .{
                        .name = name,
                        .operator = final_operator,
                        .value = value,
                    },
                } };
            }
        }
    };
}

/// Consumes an operation or a colon, or returns an error.
fn consumeOperationOrColon(input: *css.Parser, allow_colon: bool) Result(?MediaFeatureComparison) {
    const location = input.currentSourceLocation();
    const first_delim = first_delim: {
        const loc = input.currentSourceLocation();
        const next_token = switch (input.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        switch (next_token.*) {
            .colon => if (allow_colon) return .{ .result = null },
            .delim => |oper| break :first_delim oper,
            else => {},
        }
        return .{ .err = loc.newUnexpectedTokenError(next_token.*) };
    };

    switch (first_delim) {
        '=' => return .{ .result = .equal },
        '>' => {
            if (input.tryParse(css.Parser.expectDelim, .{'='}).isOk()) {
                return .{ .result = .@"greater-than-equal" };
            }
            return .{ .result = .@"greater-than" };
        },
        '<' => {
            if (input.tryParse(css.Parser.expectDelim, .{'='}).isOk()) {
                return .{ .result = .@"less-than-equal" };
            }
            return .{ .result = .@"less-than" };
        },
        else => return .{ .err = location.newUnexpectedTokenError(.{ .delim = first_delim }) },
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

    pub fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn toCss(this: *const @This(), dest: *Printer) PrintErr!void {
        switch (this.*) {
            .equal => {
                try dest.delim('-', true);
            },
            .@"greater-than" => {
                try dest.delim('>', true);
            },
            .@"greater-than-equal" => {
                try dest.whitespace();
                try dest.writeStr(">=");
                try dest.whitespace();
            },
            .@"less-than" => {
                try dest.delim('<', true);
            },
            .@"less-than-equal" => {
                try dest.whitespace();
                try dest.writeStr("<=");
                try dest.whitespace();
            },
        }
    }

    pub fn opposite(self: @This()) @This() {
        return switch (self) {
            .@"greater-than" => .@"less-than",
            .@"greater-than-equal" => .@"less-than-equal",
            .@"less-than" => .@"greater-than",
            .@"less-than-equal" => .@"greater-than-equal",
            .equal => .equal,
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

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const MediaFeatureValue, allocator: std.mem.Allocator) MediaFeatureValue {
        return switch (this.*) {
            .length => |*l| .{ .length = l.deepClone(allocator) },
            .number => |n| .{ .number = n },
            .integer => |i| .{ .integer = i },
            .boolean => |b| .{ .boolean = b },
            .resolution => |r| .{ .resolution = r },
            .ratio => |r| .{ .ratio = r },
            .ident => |i| .{ .ident = i },
            .env => |*e| .{ .env = e.deepClone(allocator) },
        };
    }

    pub fn deinit(this: *MediaFeatureValue, allocator: std.mem.Allocator) void {
        return switch (this.*) {
            .length => |l| l.deinit(allocator),
            .number => {},
            .integer => {},
            .boolean => {},
            .resolution => {},
            .ratio => {},
            .ident => {},
            .env => |*env| env.deinit(allocator),
        };
    }

    pub fn toCss(
        this: *const MediaFeatureValue,
        dest: *Printer,
    ) PrintErr!void {
        switch (this.*) {
            .length => |len| return len.toCss(dest),
            .number => |num| return CSSNumberFns.toCss(&num, dest),
            .integer => |int| return CSSIntegerFns.toCss(&int, dest),
            .boolean => |b| {
                if (b) {
                    return dest.writeChar('1');
                } else {
                    return dest.writeChar('0');
                }
            },
            .resolution => |res| return res.toCss(dest),
            .ratio => |ratio| return ratio.toCss(dest),
            .ident => |id| return IdentFns.toCss(&id, dest),
            .env => |*env| return EnvironmentVariable.toCss(env, dest, false),
        }
    }

    pub fn checkType(this: *const @This(), expected_type: MediaFeatureType) bool {
        const vt = this.valueType();
        if (expected_type == .unknown or vt == .unknown) return true;
        return expected_type == vt;
    }

    /// Parses a single media query feature value, with an expected type.
    /// If the type is unknown, pass MediaFeatureType::Unknown instead.
    pub fn parse(input: *css.Parser, expected_type: MediaFeatureType) Result(MediaFeatureValue) {
        if (input.tryParse(parseKnown, .{expected_type}).asValue()) |value| {
            return .{ .result = value };
        }

        return parseUnknown(input);
    }

    pub fn parseKnown(input: *css.Parser, expected_type: MediaFeatureType) Result(MediaFeatureValue) {
        return .{
            .result = switch (expected_type) {
                .boolean => {
                    const value = switch (CSSIntegerFns.parse(input)) {
                        .err => |e| return .{ .err = e },
                        .result => |v| v,
                    };
                    if (value != 0 and value != 1) return .{ .err = input.newCustomError(css.ParserError.invalid_value) };
                    return .{ .result = .{ .boolean = value == 1 } };
                },
                .number => .{ .number = switch (CSSNumberFns.parse(input)) {
                    .result => |v| v,
                    .err => |e| return .{ .err = e },
                } },
                .integer => .{ .integer = switch (CSSIntegerFns.parse(input)) {
                    .result => |v| v,
                    .err => |e| return .{ .err = e },
                } },
                .length => .{ .length = switch (Length.parse(input)) {
                    .result => |v| v,
                    .err => |e| return .{ .err = e },
                } },
                .resolution => .{ .resolution = switch (Resolution.parse(input)) {
                    .result => |v| v,
                    .err => |e| return .{ .err = e },
                } },
                .ratio => .{ .ratio = switch (Ratio.parse(input)) {
                    .result => |v| v,
                    .err => |e| return .{ .err = e },
                } },
                .ident => .{ .ident = switch (IdentFns.parse(input)) {
                    .result => |v| v,
                    .err => |e| return .{ .err = e },
                } },
                .unknown => return .{ .err = input.newCustomError(.invalid_value) },
            },
        };
    }

    pub fn parseUnknown(input: *css.Parser) Result(MediaFeatureValue) {
        // Ratios are ambiguous with numbers because the second param is optional (e.g. 2/1 == 2).
        // We require the / delimiter when parsing ratios so that 2/1 ends up as a ratio and 2 is
        // parsed as a number.
        if (input.tryParse(Ratio.parseRequired, .{}).asValue()) |ratio| return .{ .result = .{ .ratio = ratio } };

        // Parse number next so that unitless values are not parsed as lengths.
        if (input.tryParse(CSSNumberFns.parse, .{}).asValue()) |num| return .{ .result = .{ .number = num } };

        if (input.tryParse(Length.parse, .{}).asValue()) |res| return .{ .result = .{ .length = res } };

        if (input.tryParse(Resolution.parse, .{}).asValue()) |res| return .{ .result = .{ .resolution = res } };

        if (input.tryParse(EnvironmentVariable.parse, .{}).asValue()) |env| return .{ .result = .{ .env = env } };

        const ident = switch (IdentFns.parse(input)) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        return .{ .result = .{ .ident = ident } };
    }

    pub fn addF32(this: MediaFeatureValue, allocator: Allocator, other: f32) MediaFeatureValue {
        return switch (this) {
            .length => |len| .{ .length = len.add(allocator, Length.px(other)) },
            // .length => |len| .{
            //     .length = .{
            //         .value = .{ .px = other },
            //     },
            // },
            .number => |num| .{ .number = num + other },
            .integer => |num| .{ .integer = num + if (css.signfns.isSignPositive(other)) @as(i32, 1) else @as(i32, -1) },
            .boolean => |v| .{ .boolean = v },
            .resolution => |res| .{ .resolution = res.addF32(allocator, other) },
            .ratio => |ratio| .{ .ratio = ratio.addF32(allocator, other) },
            .ident => |id| .{ .ident = id },
            .env => |env| .{ .env = env }, // TODO: calc support
        };
    }

    pub fn valueType(this: *const MediaFeatureValue) MediaFeatureType {
        return switch (this.*) {
            .length => .length,
            .number => .number,
            .integer => .integer,
            .boolean => .boolean,
            .resolution => .resolution,
            .ratio => .ratio,
            .ident => .ident,
            .env => .unknown,
        };
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

        pub fn eql(lhs: *const This, rhs: *const This) bool {
            if (@intFromEnum(lhs.*) != @intFromEnum(rhs.*)) return false;
            return switch (lhs.*) {
                .standard => |fid| fid == rhs.standard,
                .custom => |ident| bun.strings.eql(ident.v, rhs.custom.v),
                .unknown => |ident| bun.strings.eql(ident.v, rhs.unknown.v),
            };
        }

        pub fn valueType(this: *const This) MediaFeatureType {
            return switch (this.*) {
                .standard => |standard| standard.valueType(),
                else => .unknown,
            };
        }

        pub fn toCss(this: *const This, dest: *Printer) PrintErr!void {
            return switch (this.*) {
                .standard => |v| v.toCss(dest),
                .custom => |d| DashedIdentFns.toCss(&d, dest),
                .unknown => |v| IdentFns.toCss(&v, dest),
            };
        }

        pub fn toCssWithPrefix(this: *const This, prefix: []const u8, dest: *Printer) PrintErr!void {
            return switch (this.*) {
                .standard => |v| v.toCssWithPrefix(prefix, dest),
                .custom => |d| {
                    try dest.writeStr(prefix);
                    return DashedIdentFns.toCss(&d, dest);
                },
                .unknown => |v| {
                    try dest.writeStr(prefix);
                    return IdentFns.toCss(&v, dest);
                },
            };
        }

        /// Parses a media feature name.
        pub fn parse(input: *css.Parser) Result(struct { This, ?MediaFeatureComparison }) {
            const ident = switch (input.expectIdent()) {
                .err => |e| return .{ .err = e },
                .result => |v| v,
            };

            if (bun.strings.startsWith(ident, "--")) {
                return .{ .result = .{
                    .{
                        .custom = .{ .v = ident },
                    },
                    null,
                } };
            }

            var name = ident;

            // Webkit places its prefixes before "min" and "max". Remove it first, and
            // re-add after removing min/max.
            const is_webkit = bun.strings.startsWithCaseInsensitiveAscii(name, "-webkit-");
            if (is_webkit) {
                name = name[8..];
            }

            const comparator: ?MediaFeatureComparison = comparator: {
                if (bun.strings.startsWithCaseInsensitiveAscii(name, "min-")) {
                    name = name[4..];
                    break :comparator .@"greater-than-equal";
                } else if (bun.strings.startsWithCaseInsensitiveAscii(name, "max-")) {
                    name = name[4..];
                    break :comparator .@"less-than-equal";
                } else break :comparator null;
            };

            var free_str = false;
            const final_name = if (is_webkit) name: {
                // PERF: stack buffer here?
                free_str = true;
                break :name bun.handleOom(std.fmt.allocPrint(input.allocator(), "-webkit-{s}", .{name}));
            } else name;

            defer if (is_webkit) {
                // If we made an allocation let's try to free it,
                // this only works if FeatureId doesn't hold any references to the input string.
                // i.e. it is an enum
                comptime {
                    std.debug.assert(@typeInfo(FeatureId) == .@"enum");
                }
                input.allocator().free(final_name);
            };

            if (css.parse_utility.parseString(
                input.allocator(),
                FeatureId,
                final_name,
                FeatureId.parse,
            ).asValue()) |standard| {
                return .{ .result = .{
                    .{ .standard = standard },
                    comparator,
                } };
            }

            return .{ .result = .{
                .{
                    .unknown = .{ .v = ident },
                },
                null,
            } };
        }

        pub fn hash(this: *const @This(), hasher: anytype) void {
            return css.implementHash(@This(), this, hasher);
        }
    };
}

fn writeMinMax(
    operator: *const MediaFeatureComparison,
    comptime FeatureId: type,
    name: *const MediaFeatureName(FeatureId),
    value: *const MediaFeatureValue,
    dest: *Printer,
) PrintErr!void {
    const prefix = switch (operator.*) {
        .@"greater-than", .@"greater-than-equal" => "min-",
        .@"less-than", .@"less-than-equal" => "max-",
        .equal => null,
    };

    if (prefix) |p| {
        try name.toCssWithPrefix(p, dest);
    } else {
        try name.toCss(dest);
    }

    try dest.delim(':', false);

    var adjusted: ?MediaFeatureValue = switch (operator.*) {
        .@"greater-than" => value.deepClone(dest.allocator).addF32(dest.allocator, 0.001),
        .@"less-than" => value.deepClone(dest.allocator).addF32(dest.allocator, -0.001),
        else => null,
    };

    if (adjusted) |*val| {
        defer val.deinit(dest.allocator);
        try val.toCss(dest);
    } else {
        try value.toCss(dest);
    }

    return dest.writeChar(')');
}

const bun = @import("bun");

const std = @import("std");
const ArrayList = std.ArrayListUnmanaged;
const Allocator = std.mem.Allocator;
