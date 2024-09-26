const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("./css_parser.zig");
pub const Error = css.Error;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const PrintResult = css.PrintResult;
const Result = css.Result;

const ArrayList = std.ArrayListUnmanaged;
pub const DeclarationList = ArrayList(css.Property);

/// A CSS declaration block.
///
/// Properties are separated into a list of `!important` declararations,
/// and a list of normal declarations. This reduces memory usage compared
/// with storing a boolean along with each property.
///
/// TODO: multiarraylist will probably be faster here, as it makes one allocation
/// instead of two.
pub const DeclarationBlock = struct {
    /// A list of `!important` declarations in the block.
    important_declarations: ArrayList(css.Property) = .{},
    /// A list of normal declarations in the block.
    declarations: ArrayList(css.Property) = .{},

    const This = @This();

    pub fn parse(input: *css.Parser, options: *const css.ParserOptions) Result(DeclarationBlock) {
        var important_declarations = DeclarationList{};
        var declarations = DeclarationList{};
        var decl_parser = PropertyDeclarationParser{
            .important_declarations = &important_declarations,
            .declarations = &declarations,
            .options = options,
        };
        errdefer decl_parser.deinit();

        var parser = css.RuleBodyParser(PropertyDeclarationParser).new(input, &decl_parser);

        while (parser.next()) |res| {
            if (res.asErr()) |e| {
                if (options.error_recovery) {
                    options.warn(e);
                    continue;
                }
                return .{ .err = e };
            }
        }

        return .{ .result = DeclarationBlock{
            .important_declarations = important_declarations,
            .declarations = declarations,
        } };
    }

    pub fn len(this: *const DeclarationBlock) usize {
        return this.declarations.items.len + this.important_declarations.items.len;
    }

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        const length = this.len();
        var i: usize = 0;

        const DECLS: []const []const u8 = &[_][]const u8{ "declarations", "important_declarations" };

        inline for (DECLS) |decl_field_name| {
            const decls = &@field(this, decl_field_name);
            const is_important = comptime std.mem.eql(u8, decl_field_name, "important_declarations");

            for (decls.items) |*decl| {
                try decl.toCss(W, dest, is_important);
                if (i != length - 1) {
                    try dest.writeChar(';');
                    try dest.whitespace();
                }
                i += 1;
            }
        }

        return;
    }

    /// Writes the declarations to a CSS block, including starting and ending braces.
    pub fn toCssBlock(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        try dest.whitespace();
        try dest.writeChar('{');
        dest.indent();

        var i: usize = 0;
        const length = this.len();

        const DECLS: []const []const u8 = &[_][]const u8{ "declarations", "important_declarations" };

        inline for (DECLS) |decl_field_name| {
            const decls = &@field(this, decl_field_name);
            const is_important = comptime std.mem.eql(u8, decl_field_name, "important_declarations");
            for (decls.items) |*decl| {
                try dest.newline();
                try decl.toCss(W, dest, is_important);
                if (i != length - 1 or !dest.minify) {
                    try dest.writeChar(';');
                }
                i += 1;
            }
        }

        dest.dedent();
        try dest.newline();
        return dest.writeChar('}');
    }
};

pub const PropertyDeclarationParser = struct {
    important_declarations: *ArrayList(css.Property),
    declarations: *ArrayList(css.Property),
    options: *const css.ParserOptions,

    const This = @This();

    pub const AtRuleParser = struct {
        pub const Prelude = void;
        pub const AtRule = void;

        pub fn parsePrelude(_: *This, name: []const u8, input: *css.Parser) Result(Prelude) {
            return .{
                .err = input.newError(css.BasicParseErrorKind{ .at_rule_invalid = name }),
            };
        }

        pub fn parseBlock(_: *This, _: Prelude, _: *const css.ParserState, input: *css.Parser) Result(AtRule) {
            return .{ .err = input.newError(css.BasicParseErrorKind.at_rule_body_invalid) };
        }

        pub fn ruleWithoutBlock(_: *This, _: Prelude, _: *const css.ParserState) css.Maybe(AtRule, void) {
            return .{ .err = {} };
        }
    };

    pub const QualifiedRuleParser = struct {
        pub const Prelude = void;
        pub const QualifiedRule = void;

        pub fn parsePrelude(this: *This, input: *css.Parser) Result(Prelude) {
            _ = this; // autofix
            return .{ .err = input.newError(css.BasicParseErrorKind.qualified_rule_invalid) };
        }

        pub fn parseBlock(this: *This, prelude: Prelude, start: *const css.ParserState, input: *css.Parser) Result(QualifiedRule) {
            _ = this; // autofix
            _ = prelude; // autofix
            _ = start; // autofix
            return .{ .err = input.newError(css.BasicParseErrorKind.qualified_rule_invalid) };
        }
    };

    pub const DeclarationParser = struct {
        pub const Declaration = void;

        pub fn parseValue(this: *This, name: []const u8, input: *css.Parser) Result(Declaration) {
            return parse_declaration(
                name,
                input,
                this.declarations,
                this.important_declarations,
                this.options,
            );
        }
    };

    pub const RuleBodyItemParser = struct {
        pub fn parseQualified(this: *This) bool {
            _ = this; // autofix
            return false;
        }

        pub fn parseDeclarations(this: *This) bool {
            _ = this; // autofix
            return true;
        }
    };
};

pub fn parse_declaration(
    name: []const u8,
    input: *css.Parser,
    declarations: *DeclarationList,
    important_declarations: *DeclarationList,
    options: *const css.ParserOptions,
) Result(void) {
    const property_id = css.PropertyId.fromStr(name);
    var delimiters = css.Delimiters{ .bang = true };
    if (property_id != .custom or property_id.custom != .custom) {
        delimiters.curly_bracket = true;
    }
    const Closure = struct {
        property_id: css.PropertyId,
        options: *const css.ParserOptions,

        pub fn parsefn(this: *@This(), input2: *css.Parser) Result(css.Property) {
            return css.Property.parse(this.property_id, input2, this.options);
        }
    };
    var closure = Closure{
        .property_id = property_id,
        .options = options,
    };
    const property = switch (input.parseUntilBefore(delimiters, css.Property, &closure, Closure.parsefn)) {
        .err => |e| return .{ .err = e },
        .result => |v| v,
    };
    const important = input.tryParse(struct {
        pub fn parsefn(i: *css.Parser) Result(void) {
            if (i.expectDelim('!').asErr()) |e| return .{ .err = e };
            return i.expectIdentMatching("important");
        }
    }.parsefn, .{}).isOk();
    if (input.expectExhausted().asErr()) |e| return .{ .err = e };
    if (important) {
        important_declarations.append(input.allocator(), property) catch bun.outOfMemory();
    } else {
        declarations.append(input.allocator(), property) catch bun.outOfMemory();
    }

    return .{ .result = {} };
}

pub const DeclarationHandler = struct {
    pub fn default() DeclarationHandler {
        return .{};
    }
};
