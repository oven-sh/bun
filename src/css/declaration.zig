const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("./css_parser.zig");
pub const Error = css.Error;
const Printer = css.Printer;
const PrintErr = css.PrintErr;

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

    pub fn parse(input: *css.Parser, options: *css.ParserOptions) Error!DeclarationBlock {
        var important_declarations = DeclarationList{};
        var declarations = DeclarationList{};
        var decl_parser = PropertyDeclarationParser{
            .important_declarations = &important_declarations,
            .declarations = &declarations,
        };
        errdefer decl_parser.deinit();

        var parser = css.RuleBodyParser(PropertyDeclarationParser).new(input, &decl_parser);

        while (parser.next()) |res| {
            _ = res catch |e| {
                if (options.error_recovery) {
                    options.warn(e);
                    continue;
                }
                return e;
            };
        }

        return DeclarationBlock{
            .important_declarations = important_declarations,
            .declarations = declarations,
        };
    }

    pub fn len(this: *const DeclarationBlock) usize {
        return this.declarations.len + this.important_declarations.len;
    }

    /// Writes the declarations to a CSS block, including starting and ending braces.
    pub fn toCssBlock(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @compileError(css.todo_stuff.depth);
    }
};

pub const PropertyDeclarationParser = struct {
    important_declarations: *ArrayList(css.Property),
    declarations: *ArrayList(css.Property),
    options: *css.ParserOptions,

    const This = @This();

    pub const AtRuleParser = struct {
        pub const Prelude = void;
        pub const AtRule = void;

        pub fn parsePrelude(this: *This, name: []const u8, input: *css.Parser) Error!Prelude {
            _ = input; // autofix
            _ = this; // autofix
            _ = name; // autofix
            @compileError(css.todo_stuff.errors);
        }

        pub fn parseBlock(this: *This, prelude: Prelude, start: *const css.ParserState, input: *css.Parser) Error!AtRule {
            _ = this; // autofix
            _ = prelude; // autofix
            _ = start; // autofix
            return input.newError(css.BasicParseErrorKind.at_rule_invalid);
        }
    };

    pub const QualifiedRuleParser = struct {
        pub const Prelude = void;
        pub const QualifiedRule = void;

        pub fn parsePrelude(this: *This, input: *css.Parser) Error!Prelude {
            _ = this; // autofix
            return input.newError(css.BasicParseErrorKind.qualified_rule_invalid);
        }

        pub fn parseBlock(this: *This, prelude: Prelude, start: *const css.ParserState, input: *css.Parser) Error!QualifiedRule {
            _ = this; // autofix
            _ = prelude; // autofix
            _ = start; // autofix
            return input.newError(css.BasicParseErrorKind.qualified_rule_invalid);
        }
    };

    pub const DeclarationParser = struct {
        pub const Declaration = void;

        fn parseValue(this: *This, name: []const u8, input: *css.Parser) Error!Declaration {
            parse_declaration(
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
    options: *css.ParserOptions,
) Error!void {
    const property_id = css.PropertyId.fromStr(name);
    var delimiters = css.Delimiters{ .bang = true };
    if (property_id != .custom and property_id.custom != .custom) {
        delimiters.curly_bracket = true;
    }
    const Closure = struct {
        property_id: css.PropertyId,
        options: *css.ParserOptions,

        pub fn parsefn(this: *@This(), input2: *css.Parser) Error!css.Property {
            return css.Property.parse(this.property_id, input2, this.options);
        }
    };
    var closure = Closure{
        .property_id = property_id,
        .options = options,
    };
    const property = try input.parseUntilBefore(delimiters, css.Property, &closure, closure.parsefn);
    const Fn = struct {
        pub fn parsefn(input2: *css.Parser) Error!void {
            try input2.expectDelim('?');
            try input2.expectIdentMatching("important");
        }
    };
    const important = if (input.tryParse(Fn.parsefn, .{})) true else false;
    try input.expectExhausted();
    if (important) {
        important_declarations.append(comptime {
            @compileError(css.todo_stuff.think_about_allocator);
        }, property) catch bun.outOfMemory();
    } else {
        declarations.append(comptime {
            @compileError(css.todo_stuff.think_about_allocator);
        }, property);
    }
    return;
}
