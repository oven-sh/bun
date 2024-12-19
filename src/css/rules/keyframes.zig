const std = @import("std");
pub const css = @import("../css_parser.zig");
const bun = @import("root").bun;
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
const SupportsCondition = css.css_rules.supports.SupportsCondition;
const Location = css.css_rules.Location;
const Result = css.Result;

pub const KeyframesListParser = struct {
    const This = @This();

    pub const DeclarationParser = struct {
        pub const Declaration = Keyframe;

        pub fn parseValue(_: *This, name: []const u8, input: *css.Parser) Result(Declaration) {
            return .{ .err = input.newError(css.BasicParseErrorKind{ .unexpected_token = .{ .ident = name } }) };
        }
    };

    pub const RuleBodyItemParser = struct {
        pub fn parseQualified(_: *This) bool {
            return true;
        }

        pub fn parseDeclarations(_: *This) bool {
            return false;
        }
    };

    pub const AtRuleParser = struct {
        pub const Prelude = void;
        pub const AtRule = Keyframe;

        pub fn parsePrelude(_: *This, name: []const u8, input: *css.Parser) Result(Prelude) {
            return .{ .err = input.newError(css.BasicParseErrorKind{ .at_rule_invalid = name }) };
        }

        pub fn parseBlock(_: *This, _: AtRuleParser.Prelude, _: *const css.ParserState, input: *css.Parser) Result(AtRuleParser.AtRule) {
            return .{ .err = input.newError(css.BasicParseErrorKind.at_rule_body_invalid) };
        }

        pub fn ruleWithoutBlock(_: *This, _: AtRuleParser.Prelude, _: *const css.ParserState) css.Maybe(AtRuleParser.AtRule, void) {
            return .{ .err = {} };
        }
    };

    pub const QualifiedRuleParser = struct {
        pub const Prelude = ArrayList(KeyframeSelector);
        pub const QualifiedRule = Keyframe;

        pub fn parsePrelude(_: *This, input: *css.Parser) Result(Prelude) {
            return input.parseCommaSeparated(KeyframeSelector, KeyframeSelector.parse);
        }

        pub fn parseBlock(_: *This, prelude: Prelude, _: *const css.ParserState, input: *css.Parser) Result(QualifiedRule) {
            // For now there are no options that apply within @keyframes
            const options = css.ParserOptions.default(input.allocator(), null);
            return .{
                .result = Keyframe{
                    .selectors = prelude,
                    .declarations = switch (css.DeclarationBlock.parse(input, &options)) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    },
                },
            };
        }
    };
};

/// KeyframesName
pub const KeyframesName = union(enum) {
    /// `<custom-ident>` of a `@keyframes` name.
    ident: css.css_values.ident.CustomIdent,
    /// `<string>` of a `@keyframes` name.
    custom: []const u8,

    const This = @This();

    pub fn HashMap(comptime V: type) type {
        return std.ArrayHashMapUnmanaged(KeyframesName, V, struct {
            pub fn hash(_: @This(), key: KeyframesName) u32 {
                return switch (key) {
                    .ident => std.array_hash_map.hashString(key.ident.v),
                    .custom => std.array_hash_map.hashString(key.custom),
                };
            }

            pub fn eql(_: @This(), a: KeyframesName, b: KeyframesName, _: usize) bool {
                return switch (a) {
                    .ident => switch (b) {
                        .ident => bun.strings.eql(a.ident.v, b.ident.v),
                        .custom => false,
                    },
                    .custom => switch (b) {
                        .ident => false,
                        .custom => bun.strings.eql(a.custom, b.custom),
                    },
                };
            }
        }, false);
    }

    pub fn parse(input: *css.Parser) Result(KeyframesName) {
        switch (switch (input.next()) {
            .result => |v| v.*,
            .err => |e| return .{ .err = e },
        }) {
            .ident => |s| {
                // todo_stuff.match_ignore_ascii_case
                // CSS-wide keywords without quotes throws an error.
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "none") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "initial") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "inherit") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "unset") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "default") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "revert") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "revert-layer"))
                {
                    return .{ .err = input.newUnexpectedTokenError(.{ .ident = s }) };
                } else {
                    return .{ .result = .{ .ident = .{ .v = s } } };
                }
            },
            .quoted_string => |s| return .{ .result = .{ .custom = s } },
            else => |t| {
                return .{ .err = input.newUnexpectedTokenError(t) };
            },
        }
    }

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        const css_module_aimation_enabled = if (dest.css_module) |css_module| css_module.config.animation else false;

        switch (this.*) {
            .ident => |ident| {
                try dest.writeIdent(ident.v, css_module_aimation_enabled);
            },
            .custom => |s| {
                // todo_stuff.match_ignore_ascii_case
                // CSS-wide keywords and `none` cannot remove quotes.
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "none") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "initial") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "inherit") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "unset") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "default") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "revert") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "revert-layer"))
                {
                    css.serializer.serializeString(s, dest) catch return dest.addFmtError();
                } else {
                    try dest.writeIdent(s, css_module_aimation_enabled);
                }
            },
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

pub const KeyframeSelector = union(enum) {
    /// An explicit percentage.
    percentage: css.css_values.percentage.Percentage,
    /// The `from` keyword. Equivalent to 0%.
    from,
    /// The `to` keyword. Equivalent to 100%.
    to,

    // TODO: implement this
    pub usingnamespace css.DeriveParse(@This());

    // pub fn parse(input: *css.Parser) Result(KeyframeSelector) {
    //     _ = input; // autofix
    //     @panic(css.todo_stuff.depth);
    // }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        switch (this.*) {
            .percentage => |p| {
                if (dest.minify and p.v == 1.0) {
                    try dest.writeStr("to");
                } else {
                    try p.toCss(W, dest);
                }
            },
            .from => {
                if (dest.minify) {
                    try dest.writeStr("0%");
                } else {
                    try dest.writeStr("from");
                }
            },
            .to => {
                try dest.writeStr("to");
            },
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// An individual keyframe within an `@keyframes` rule.
///
/// See [KeyframesRule](KeyframesRule).
pub const Keyframe = struct {
    /// A list of keyframe selectors to associate with the declarations in this keyframe.
    selectors: ArrayList(KeyframeSelector),
    /// The declarations for this keyframe.
    declarations: css.DeclarationBlock,

    const This = @This();

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        var first = true;
        for (this.selectors.items) |sel| {
            if (!first) {
                try dest.delim(',', false);
            }
            first = false;
            try sel.toCss(W, dest);
        }

        try this.declarations.toCssBlock(W, dest);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

pub const KeyframesRule = struct {
    /// The animation name.
    /// <keyframes-name> = <custom-ident> | <string>
    name: KeyframesName,
    /// A list of keyframes in the animation.
    keyframes: ArrayList(Keyframe),
    /// A vendor prefix for the rule, e.g. `@-webkit-keyframes`.
    vendor_prefix: css.VendorPrefix,
    /// The location of the rule in the source file.
    loc: Location,

    const This = @This();

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        var first_rule = true;

        const PREFIXES = .{ "webkit", "moz", "ms", "o", "none" };

        inline for (PREFIXES) |prefix_name| {
            const prefix = css.VendorPrefix.fromName(prefix_name);

            if (this.vendor_prefix.contains(prefix)) {
                if (first_rule) {
                    first_rule = false;
                } else {
                    if (!dest.minify) {
                        try dest.writeChar('\n'); // no indent
                    }
                    try dest.newline();
                }

                try dest.writeChar('@');
                try prefix.toCss(W, dest);
                try dest.writeStr("keyframes ");
                try this.name.toCss(W, dest);
                try dest.whitespace();
                try dest.writeChar('{');
                dest.indent();

                var first = true;
                for (this.keyframes.items) |*keyframe| {
                    if (first) {
                        first = false;
                    } else if (!dest.minify) {
                        try dest.writeChar('\n'); // no indent
                    }
                    try dest.newline();
                    try keyframe.toCss(W, dest);
                }
                dest.dedent();
                try dest.newline();
                try dest.writeChar('}');
            }
        }
    }

    pub fn getFallbacks(this: *This, comptime T: type, targets: *const css.targets.Targets) []css.CssRule(T) {
        _ = this; // autofix
        _ = targets; // autofix
        @compileError(css.todo_stuff.depth);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
        return css.implementDeepClone(@This(), this, allocator);
    }
};
