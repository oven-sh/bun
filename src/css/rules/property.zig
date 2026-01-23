pub const css = @import("../css_parser.zig");
const Result = css.Result;
const Printer = css.Printer;
const Maybe = css.Maybe;
const PrintErr = css.PrintErr;
const Location = css.css_rules.Location;
const SyntaxString = css.css_values.syntax.SyntaxString;
const ParsedComponent = css.css_values.syntax.ParsedComponent;

pub const PropertyRule = struct {
    name: css.css_values.ident.DashedIdent,
    syntax: SyntaxString,
    inherits: bool,
    initial_value: ?css.css_values.syntax.ParsedComponent,
    loc: Location,

    pub fn parse(name: css.css_values.ident.DashedIdent, input: *css.Parser, loc: Location) Result(PropertyRule) {
        var p = PropertyRuleDeclarationParser{
            .syntax = null,
            .inherits = null,
            .initial_value = null,
        };

        var decl_parser = css.RuleBodyParser(PropertyRuleDeclarationParser).new(input, &p);
        while (decl_parser.next()) |decl| {
            if (decl.asErr()) |e| {
                return .{ .err = e };
            }
        }

        // `syntax` and `inherits` are always required.
        const parser = decl_parser.parser;
        // TODO(zack): source clones these two, but I omitted here becaues it seems 100% unnecessary
        const syntax: SyntaxString = parser.syntax orelse return .{ .err = decl_parser.input.newCustomError(css.ParserError.at_rule_body_invalid) };
        const inherits: bool = parser.inherits orelse return .{ .err = decl_parser.input.newCustomError(css.ParserError.at_rule_body_invalid) };

        // `initial-value` is required unless the syntax is a universal definition.
        const initial_value = switch (syntax) {
            .universal => if (parser.initial_value) |val| brk: {
                var i = css.ParserInput.new(input.allocator(), val);
                var p2 = css.Parser.new(&i, null, .{}, null);

                if (p2.isExhausted()) {
                    break :brk ParsedComponent{
                        .token_list = css.TokenList{
                            .v = .{},
                        },
                    };
                }
                break :brk switch (syntax.parseValue(&p2)) {
                    .result => |vv| vv,
                    .err => |e| return .{ .err = e },
                };
            } else null,
            else => brk: {
                const val = parser.initial_value orelse return .{ .err = input.newCustomError(css.ParserError.at_rule_body_invalid) };
                var i = css.ParserInput.new(input.allocator(), val);
                var p2 = css.Parser.new(&i, null, .{}, null);
                break :brk switch (syntax.parseValue(&p2)) {
                    .result => |vv| vv,
                    .err => |e| return .{ .err = e },
                };
            },
        };

        return .{
            .result = PropertyRule{
                .name = name,
                .syntax = syntax,
                .inherits = inherits,
                .initial_value = initial_value,
                .loc = loc,
            },
        };
    }

    const This = @This();

    pub fn toCss(this: *const This, dest: *Printer) PrintErr!void {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        try dest.writeStr("@property ");
        try css.css_values.ident.DashedIdentFns.toCss(&this.name, dest);
        try dest.whitespace();
        try dest.writeChar('{');
        dest.indent();
        try dest.newline();

        try dest.writeStr("syntax:");
        try dest.whitespace();
        try this.syntax.toCss(dest);
        try dest.writeChar(';');
        try dest.newline();

        try dest.writeStr("inherits:");
        try dest.whitespace();
        if (this.inherits) {
            try dest.writeStr("true");
        } else {
            try dest.writeStr("false");
        }

        if (this.initial_value) |*initial_value| {
            try dest.writeChar(';');
            try dest.newline();

            try dest.writeStr("initial-value:");
            try dest.whitespace();
            try initial_value.toCss(dest);

            if (!dest.minify) {
                try dest.writeChar(';');
            }
        }

        dest.dedent();
        try dest.newline();
        try dest.writeChar('}');
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

pub const PropertyRuleDeclarationParser = struct {
    syntax: ?SyntaxString,
    inherits: ?bool,
    initial_value: ?[]const u8,

    const This = @This();

    pub const DeclarationParser = struct {
        pub const Declaration = void;
        const Map = bun.ComptimeStringMap(std.meta.FieldEnum(PropertyRuleDeclarationParser), .{
            .{ "syntax", .syntax },
            .{ "inherits", .inherits },
            .{ "initial-value", .initial_value },
        });

        pub fn parseValue(this: *This, name: []const u8, input: *css.Parser) Result(Declaration) {
            // todo_stuff.match_ignore_ascii_case

            //   if (Map.getASCIIICaseInsensitive(
            //   name)) |field| {
            //     return switch (field) {
            //         .syntax => |syntax| {

            if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("syntax", name)) {
                const syntax = switch (SyntaxString.parse(input)) {
                    .result => |vv| vv,
                    .err => |e| return .{ .err = e },
                };
                this.syntax = syntax;
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("inherits", name)) {
                const location = input.currentSourceLocation();
                const ident = switch (input.expectIdent()) {
                    .result => |vv| vv,
                    .err => |e| return .{ .err = e },
                };
                const inherits = if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("true", ident))
                    true
                else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("false", ident))
                    false
                else
                    return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
                this.inherits = inherits;
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("initial-value", name)) {
                // Buffer the value into a string. We will parse it later.
                const start = input.position();
                while (input.next().isOk()) {}
                const initial_value = input.sliceFrom(start);
                this.initial_value = initial_value;
            } else {
                return .{ .err = input.newCustomError(css.ParserError.invalid_declaration) };
            }

            return .success;
        }
    };

    pub const RuleBodyItemParser = struct {
        pub fn parseQualified(_: *This) bool {
            return false;
        }

        pub fn parseDeclarations(_: *This) bool {
            return true;
        }
    };

    pub const AtRuleParser = struct {
        pub const Prelude = void;
        pub const AtRule = void;

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
        pub const Prelude = void;
        pub const QualifiedRule = void;

        pub fn parsePrelude(_: *This, input: *css.Parser) Result(Prelude) {
            return .{ .err = input.newError(css.BasicParseErrorKind.qualified_rule_invalid) };
        }

        pub fn parseBlock(_: *This, _: Prelude, _: *const css.ParserState, input: *css.Parser) Result(QualifiedRule) {
            return .{ .err = input.newError(css.BasicParseErrorKind.qualified_rule_invalid) };
        }
    };
};

const bun = @import("bun");
const std = @import("std");
