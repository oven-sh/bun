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

const BackgroundHandler = css.css_properties.background.BackgroundHandler;
const BorderHandler = css.css_properties.border.BorderHandler;
const FallbackHandler = css.css_properties.prefix_handler.FallbackHandler;
const MarginHandler = css.css_properties.margin_padding.MarginHandler;
const PaddingHandler = css.css_properties.margin_padding.PaddingHandler;
const ScrollMarginHandler = css.css_properties.margin_padding.ScrollMarginHandler;
const FontHandler = css.css_properties.font.FontHandler;
const InsetHandler = css.css_properties.margin_padding.InsetHandler;
const SizeHandler = css.css_properties.size.SizeHandler;
const FlexHandler = css.css_properties.flex.FlexHandler;
const AlignHandler = css.css_properties.@"align".AlignHandler;
const TransitionHandler = css.css_properties.transition.TransitionHandler;
const TransformHandler = css.css_properties.transform.TransformHandler;
// const GridHandler = css.css_properties.g

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

    const DebugFmt = struct {
        self: *const DeclarationBlock,

        pub fn format(this: @This(), comptime fmt: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
            _ = fmt; // autofix
            _ = options; // autofix
            var arraylist = ArrayList(u8){};
            const w = arraylist.writer(bun.default_allocator);
            defer arraylist.deinit(bun.default_allocator);
            var printer = css.Printer(@TypeOf(w)).new(bun.default_allocator, std.ArrayList(u8).init(bun.default_allocator), w, css.PrinterOptions.default(), null);
            defer printer.deinit();
            this.self.toCss(@TypeOf(w), &printer) catch |e| return try writer.print("<error writing declaration block: {s}>\n", .{@errorName(e)});
            try writer.writeAll(arraylist.items);
        }
    };

    pub fn debug(this: *const @This()) DebugFmt {
        return DebugFmt{ .self = this };
    }

    pub fn isEmpty(this: *const This) bool {
        return this.declarations.items.len == 0 and this.important_declarations.items.len == 0;
    }

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

    pub fn minify(
        this: *This,
        handler: *DeclarationHandler,
        important_handler: *DeclarationHandler,
        context: *css.PropertyHandlerContext,
    ) void {
        const handle = struct {
            inline fn handle(
                self: *This,
                ctx: *css.PropertyHandlerContext,
                hndlr: *DeclarationHandler,
                comptime decl_field: []const u8,
                comptime important: bool,
            ) void {
                for (@field(self, decl_field).items) |*prop| {
                    ctx.is_important = important;

                    const handled = hndlr.handleProperty(prop, ctx);

                    if (!handled) {
                        hndlr.decls.append(ctx.allocator, prop.*) catch bun.outOfMemory();
                        // replacing with a property which does not require allocation
                        // to "delete"
                        prop.* = css.Property{ .all = .@"revert-layer" };
                    }
                }
            }
        }.handle;

        handle(this, context, important_handler, "important_declarations", true);
        handle(this, context, handler, "declarations", false);

        handler.finalize(context);
        important_handler.finalize(context);
        var old_import = this.important_declarations;
        var old_declarations = this.declarations;
        this.important_declarations = .{};
        this.declarations = .{};
        defer {
            old_import.deinit(context.allocator);
            old_declarations.deinit(context.allocator);
        }
        this.important_declarations = important_handler.decls;
        this.declarations = handler.decls;
        important_handler.decls = .{};
        handler.decls = .{};
    }

    pub fn hashPropertyIds(this: *const @This(), hasher: *std.hash.Wyhash) void {
        for (this.declarations.items) |*decl| {
            decl.propertyId().hash(hasher);
        }

        for (this.important_declarations.items) |*decl| {
            decl.propertyId().hash(hasher);
        }
    }

    pub fn eql(this: *const This, other: *const This) bool {
        return css.implementEql(@This(), this, other);
    }

    pub fn deepClone(this: *const This, allocator: std.mem.Allocator) This {
        return css.implementDeepClone(@This(), this, allocator);
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
    };
    var closure = Closure{
        .property_id = property_id,
        .options = options,
    };
    const property = switch (input.parseUntilBefore(delimiters, css.Property, &closure, struct {
        pub fn parseFn(this: *Closure, input2: *css.Parser) Result(css.Property) {
            return css.Property.parse(this.property_id, input2, this.options);
        }
    }.parseFn)) {
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
    background: BackgroundHandler = .{},
    border: BorderHandler = .{},
    flex: FlexHandler = .{},
    @"align": AlignHandler = .{},
    size: SizeHandler = .{},
    margin: MarginHandler = .{},
    padding: PaddingHandler = .{},
    scroll_margin: ScrollMarginHandler = .{},
    transition: TransitionHandler = .{},
    font: FontHandler = .{},
    inset: InsetHandler = .{},
    transform: TransformHandler = .{},
    fallback: FallbackHandler = .{},
    direction: ?css.css_properties.text.Direction,
    decls: DeclarationList,

    pub fn finalize(this: *DeclarationHandler, context: *css.PropertyHandlerContext) void {
        const allocator = context.allocator;
        _ = allocator; // autofix
        if (this.direction) |direction| {
            this.direction = null;
            this.decls.append(context.allocator, css.Property{ .direction = direction }) catch bun.outOfMemory();
        }
        // if (this.unicode_bidi) |unicode_bidi| {
        //     this.unicode_bidi = null;
        //     this.decls.append(context.allocator, css.Property{ .unicode_bidi = unicode_bidi }) catch bun.outOfMemory();
        // }

        this.background.finalize(&this.decls, context);
        this.border.finalize(&this.decls, context);
        this.flex.finalize(&this.decls, context);
        this.@"align".finalize(&this.decls, context);
        this.size.finalize(&this.decls, context);
        this.margin.finalize(&this.decls, context);
        this.padding.finalize(&this.decls, context);
        this.scroll_margin.finalize(&this.decls, context);
        this.transition.finalize(&this.decls, context);
        this.font.finalize(&this.decls, context);
        this.inset.finalize(&this.decls, context);
        this.transform.finalize(&this.decls, context);
        this.fallback.finalize(&this.decls, context);
    }

    pub fn handleProperty(this: *DeclarationHandler, property: *const css.Property, context: *css.PropertyHandlerContext) bool {
        // return this.background.handleProperty(property, &this.decls, context);
        return this.background.handleProperty(property, &this.decls, context) or
            this.border.handleProperty(property, &this.decls, context) or
            this.flex.handleProperty(property, &this.decls, context) or
            this.@"align".handleProperty(property, &this.decls, context) or
            this.size.handleProperty(property, &this.decls, context) or
            this.margin.handleProperty(property, &this.decls, context) or
            this.padding.handleProperty(property, &this.decls, context) or
            this.scroll_margin.handleProperty(property, &this.decls, context) or
            this.transition.handleProperty(property, &this.decls, context) or
            this.font.handleProperty(property, &this.decls, context) or
            this.inset.handleProperty(property, &this.decls, context) or
            this.transform.handleProperty(property, &this.decls, context) or
            this.fallback.handleProperty(property, &this.decls, context);
    }

    pub fn default() DeclarationHandler {
        return .{
            .decls = .{},
            .direction = null,
        };
    }
};
