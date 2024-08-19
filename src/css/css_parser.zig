const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

const ArrayList = std.ArrayListUnmanaged;

pub const dependencies = @import("./dependencies.zig");
pub const Dependency = dependencies.Dependency;

pub const css_modules = @import("./css_modules.zig");
pub const CssModuleExports = css_modules.CssModuleExports;
pub const CssModule = css_modules.CssModule;
pub const CssModuleReferences = css_modules.CssModuleReferences;

pub const css_rules = @import("./rules/rules.zig");
pub const CssRule = css_rules.CssRule;
pub const CssRuleList = css_rules.CssRuleList;
pub const LayerName = css_rules.layer.LayerName;
pub const SupportsCondition = css_rules.supports.SupportsCondition;
pub const CustomMedia = css_rules.custom_media.CustomMediaRule;
pub const NamespaceRule = css_rules.namespace.NamespaceRule;
pub const UnknownAtRule = css_rules.unknown.UnknownAtRule;
pub const ImportRule = css_rules.import.ImportRule;
pub const StyleRule = css_rules.style.StyleRule;
pub const StyleContext = css_rules.StyleContext;

const media_query = @import("./media_query.zig");
pub const MediaList = media_query.MediaList;

pub const css_values = @import("./values/values.zig");
pub const DashedIdent = css_values.ident.DashedIdent;
pub const DashedIdentFns = css_values.ident.DashedIdentFns;
pub const CssColor = css_values.color.CssColor;
pub const CSSString = css_values.string.CSSString;
pub const CSSStringFns = css_values.string.CSSStringFns;
pub const CSSInteger = css_values.number.CSSInteger;
pub const CSSIntegerFns = css_values.number.CSSIntegerFns;
pub const Ident = css_values.ident.Ident;
pub const IdentFns = css_values.ident.IdentFns;
pub const CustomIdent = css_values.ident.CustomIdent;
pub const CustomIdentFns = css_values.ident.CustomIdentFns;

pub const declaration = @import("./declaration.zig");

pub const css_properties = @import("./properties/properties.zig");
pub const Property = css_properties.Property;
pub const PropertyId = Property.Id;
pub const TokenList = css_properties.custom.TokenList;
pub const TokenListFns = css_properties.custom.TokenListFns;

const css_decls = @import("./declaration.zig");
pub const DeclarationList = css_decls.DeclarationList;
pub const DeclarationBlock = css_decls.DeclarationBlock;

pub const selector = @import("./selector.zig");
pub const SelectorList = selector.api.SelectorList;

pub const logical = @import("./logical.zig");
pub const PropertyCategory = logical.PropertyCategory;
pub const LogicalGroup = logical.LogicalGroup;

pub const css_printer = @import("./printer.zig");
pub const Printer = css_printer.Printer;
pub const PrinterOptions = css_printer.PrinterOptions;
pub const Targets = css_printer.Targets;
pub const Features = css_printer.Features;

pub const Maybe = bun.JSC.Node.Maybe;
// TODO: Remove existing Error defined here and replace it with these
const errors_ = @import("./error.zig");
pub const Err = errors_.Error;
pub const PrinterErrorKind = errors_.PrinterErrorKind;
pub const PrinterError = errors_.PrinterError;

const compat = @import("./compat.zig");

pub const PrintErr = error{};

pub fn SmallList(comptime T: type, comptime N: comptime_int) type {
    _ = N; // autofix
    {
        @compileError(todo_stuff.smallvec);
    }
    return ArrayList(T);
}

pub fn Bitflags(comptime T: type) type {
    const tyinfo = @typeInfo(T);
    const IntType = tyinfo.Struct.backing_integer.?;

    return struct {
        pub inline fn empty() T {
            return @bitCast(0);
        }

        pub inline fn intersects(lhs: T, rhs: T) bool {
            return asBits(lhs) & asBits(rhs) != 0;
        }

        pub inline fn fromName(comptime name: []const u8) T {
            var this: T = .{};
            @field(this, name) = true;
            return this;
        }

        pub fn bitwiseOr(lhs: T, rhs: T) T {
            return @bitCast(@as(IntType, @bitCast(lhs)) | @as(IntType, @bitCast(rhs)));
        }

        pub fn bitwiseAnd(lhs: T, rhs: T) T {
            return asBits(lhs) & asBits(rhs);
        }

        pub fn insert(this: T, other: T) T {
            return bitwiseOr(this, other);
        }

        pub fn contains(lhs: T, rhs: T) bool {
            return @as(IntType, @bitCast(lhs)) & @as(IntType, @bitCast(rhs)) != 0;
        }

        pub inline fn asBits(this: T) IntType {
            return @as(IntType, @bitCast(this));
        }

        pub fn isEmpty(this: T) bool {
            return asBits(this) == 0;
        }

        pub fn eq(lhs: T, rhs: T) bool {
            return asBits(lhs) == asBits(rhs);
        }

        pub fn neq(lhs: T, rhs: T) bool {
            return asBits(lhs) != asBits(rhs);
        }
    };
}

pub const todo_stuff = struct {
    pub const think_about_allocator = "TODO: think about how to pass allocator";

    pub const think_mem_mgmt = "TODO: think about memory management";

    pub const depth = "TODO: we need to go deeper";

    pub const errors = "TODO: think about errors";

    pub const smallvec = "TODO: implement smallvec";

    pub const match_ignore_ascii_case = "TODO: implement match_ignore_ascii_case";

    pub const enum_property = "TODO: implement enum_property!";

    pub const match_byte = "TODO: implement match_byte!";
};

pub const VendorPrefix = packed struct(u8) {
    /// No vendor prefixes.
    /// 0b00000001
    none: bool = false,
    /// The `-webkit` vendor prefix.
    /// 0b00000010
    webkit: bool = false,
    /// The `-moz` vendor prefix.
    /// 0b00000100
    moz: bool = false,
    /// The `-ms` vendor prefix.
    /// 0b00001000
    ms: bool = false,
    /// The `-o` vendor prefix.
    /// 0b00010000
    o: bool = false,
    __unused: u3 = 0,

    pub usingnamespace Bitflags(@This());

    pub fn toCss(this: *const VendorPrefix, comptime W: type, dest: *Printer(W)) PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @compileError(todo_stuff.depth);
    }

    /// Returns VendorPrefix::None if empty.
    pub fn orNone(this: VendorPrefix) VendorPrefix {
        return this.@"or"(VendorPrefix{ .none = true });
    }

    pub fn @"or"(this: VendorPrefix, other: VendorPrefix) VendorPrefix {
        if (this.isEmpty()) return other;
        return this;
    }

    pub fn bitwiseOr(lhs: VendorPrefix, rhs: VendorPrefix) VendorPrefix {
        return @bitCast(@as(u8, @bitCast(lhs)) | @as(u8, @bitCast(rhs)));
    }
};

pub const SourceLocation = struct {
    line: u32,
    column: u32,
};
pub const Location = css_rules.Location;

/// do not add any more errors
pub const Error = error{
    ParsingError,
};

/// Details about a `BasicParseError`
pub const BasicParseErrorKind = union(enum) {
    /// An unexpected token was encountered.
    unexpected_token: Token,

    /// The end of the input was encountered unexpectedly.
    end_of_input,

    /// An `@` rule was encountered that was invalid.
    at_rule_invalid: []const u8,

    /// The body of an '@' rule was invalid.
    at_rule_body_invalid,

    /// A qualified rule was encountered that was invalid.
    qualified_rule_invalid,
};

pub fn todo(comptime fmt: []const u8, args: anytype) noreturn {
    std.debug.panic("TODO: " ++ fmt, args);
}

pub fn todo2(comptime fmt: []const u8) void {
    std.debug.panic("TODO: " ++ fmt);
}

pub fn voidWrap(comptime T: type, comptime parsefn: *const fn (*Parser) Error!T) *const fn (void, *Parser) Error!T {
    const Wrapper = struct {
        fn wrapped(_: void, p: *Parser) Error!T {
            parsefn(p);
        }
    };
    return Wrapper.wrapped;
}

pub fn DefineShorthand(comptime T: type) type {
    return struct {
        /// Returns a shorthand from the longhand properties defined in the given declaration block.
        pub fn fromLonghands(decls: *const DeclarationBlock, vendor_prefix: VendorPrefix) ?struct { T, bool } {
            _ = decls; // autofix
            _ = vendor_prefix; // autofix
            @compileError(todo_stuff.depth);
        }

        /// Returns a shorthand from the longhand properties defined in the given declaration block.
        pub fn longhands(vendor_prefix: VendorPrefix) ArrayList(PropertyId) {
            _ = vendor_prefix; // autofix
            @compileError(todo_stuff.depth);
        }

        /// Returns a longhand property for this shorthand.
        pub fn longhand(this: *const T, property_id: *const PropertyId) ?Property {
            _ = this; // autofix
            _ = property_id; // autofix
            @compileError(todo_stuff.depth);
        }

        /// Updates this shorthand from a longhand property.
        pub fn setLonghand(this: *T, property: *const Property) Maybe(void, void) {
            _ = this; // autofix
            _ = property; // autofix
            @compileError(todo_stuff.depth);
        }
    };
}

pub fn DefineLengthUnits(comptime T: type) type {
    return struct {
        pub fn parse(input: *Parser) Error!T {
            _ = input; // autofix
            @compileError(todo_stuff.depth);
        }
    };
}

pub fn DeriveParse(comptime T: type) type {
    return struct {
        pub fn parse(input: *Parser) Error!T {
            // to implement this, we need to cargo expand the derive macro
            _ = input; // autofix
            @compileError(todo_stuff.depth);
        }
    };
}

pub fn DeriveToCss(comptime T: type) type {
    return struct {
        pub fn toCss(this: *const T, comptime W: type, dest: *Printer(W)) PrintErr!void {
            // to implement this, we need to cargo expand the derive macro
            _ = this; // autofix
            _ = dest; // autofix
            @compileError(todo_stuff.depth);
        }
    };
}

pub fn DefineEnumProperty(comptime T: type) type {
    const fields: []const std.builtin.Type.EnumField = std.meta.fields(T);

    return struct {
        pub fn asStr(this: *const T) []const u8 {
            const tag = @intFromEnum(this);
            inline for (fields) |field| {
                if (tag == field.tag) return field.name;
            }
            unreachable;
        }

        pub fn parse(input: *Parser) Error!T {
            const location = input.currentSourceLocation();
            const ident = try input.expectIdent();

            // todo_stuff.match_ignore_ascii_case
            inline for (fields) |field| {
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, field.name)) return @enumFromInt(field.value);
            }

            return location.newUnexpectedTokenError(.{ .ident = ident });
        }

        pub fn toCss(this: *const T, comptime W: type, dest: *Printer(W)) PrintErr!void {
            try dest.writeStr(asStr(this));
        }
    };
}

pub fn DefineListShorthand(comptime T: type) type {
    _ = T; // autofix
    @compileError(todo_stuff.depth);
}

fn consume_until_end_of_block(block_type: BlockType, tokenizer: *Tokenizer) void {
    const StackCount = 16;
    var sfb = std.heap.stackFallback(@sizeOf(BlockType) * StackCount, @compileError(todo_stuff.think_about_allocator));
    const alloc = sfb.get();
    var stack = std.ArrayList(BlockType).initCapacity(alloc, StackCount) catch unreachable;
    defer stack.deinit();

    stack.appendAssumeCapacity(block_type);

    while (tokenizer.next()) |tok| {
        if (tok == .eof) break;
        if (BlockType.closing(&tok)) |b| {
            if (stack.getLast() == b) {
                stack.pop();
                if (stack.items.len == 0) return;
            }
        }

        if (BlockType.opening(&tok)) stack.append(tok) catch unreachable;
    }
}

fn parse_at_rule(
    allocator: Allocator,
    start: *const ParserState,
    name: []const u8,
    input: *Parser,
    comptime P: type,
    parser: *P,
) Error!P.AtRuleParser.AtRule {
    ValidAtRuleParser(P);
    const delimiters = Delimiters{ .semicolon = true, .curly_bracket = true };
    const Closure = struct {
        name: []const u8,
        parser: *P,

        pub fn parsefn(this: *@This(), input2: *Parser) Error!P.AtRuleParser.Prelude {
            return this.parser.AtRuleParser.parsePrelude(this.name, input2);
        }
    };
    var closure = Closure{ .name = name, .parser = parser };
    const prelude: P.AtRuleParser.Prelude = input.parseUntilBefore(delimiters, P.AtRuleParser.Prelude, &closure, closure.parsefn) catch |e| {
        const end_position = input.position();
        _ = end_position; // autofix
        out: {
            const tok = input.next() catch break :out;
            if (tok.* != .open_curly and tok != .semicolon) unreachable;
        }
        return e;
    };
    const next = input.next() catch {
        return P.AtRuleParser.ruleWithoutBlock(allocator, parser, prelude, start);
    };
    switch (next.*) {
        .semicolon => return P.AtRuleParser.ruleWithoutBlock(allocator, parser, prelude, start),
        .open_curly => {
            const AnotherClosure = struct {
                prelude: *P.AtRuleParser.Prelude,
                start: *const ParserState,
                parser: *P,
                pub fn parsefn(this: *@This(), input2: *Parser) Error!P.AtRuleParser.AtRule {
                    return P.AtRuleParser.parseBlock(this.parser, this.prelude, this.start, input2);
                }
            };
            var another_closure = AnotherClosure{
                .prelude = &prelude,
                .start = start,
                .parser = parser,
            };
            return parse_nested_block(input, P.AtRuleParser.AtRule, &another_closure, AnotherClosure.parsefn);
        },
    }
}

fn parse_custom_at_rule_prelude(name: []const u8, input: *Parser, options: *ParserOptions, comptime T: type, at_rule_parser: *T) Error!AtRulePrelude(T.AtRuleParser.AtRule) {
    ValidCustomAtRuleParser(T);
    if (at_rule_parser.CustomAtRuleParser.parsePrelude(at_rule_parser, name, input, options)) |prelude| {
        return .{ .custom = prelude };
    } else {
        // } else |e| unknown: {
        // TODO: error does not exist but should exist
        // if (e == Error.at_rule_invalid) break :brk unknown;
        return input.newCustomError(.at_rule_prelude_invalid);
    }

    options.warn(input.newError(.{ .at_rule_invalid = name }));
    input.skipWhitespace();
    const tokens = try TokenListFns.parse(input, options, 0);
    return .{ .unknown = .{
        .name = name,
        .tokens = tokens,
    } };
}

fn parse_custom_at_rule_body(
    comptime T: type,
    prelude: T.CustomAtRuleParser.Prelude,
    input: *Parser,
    start: *const ParserState,
    options: *ParserOptions,
    at_rule_parser: *T,
    is_nested: bool,
) Error!T.CustomAtRuleParser.AtRule {
    const result = T.CustomAtRuleParser.parseBlock(at_rule_parser, prelude, start, input, options, is_nested) catch |e| {
        _ = e; // autofix
        // match &err.kind {
        //   ParseErrorKind::Basic(kind) => ParseError {
        //     kind: ParseErrorKind::Basic(kind.clone()),
        //     location: err.location,
        //   },
        //   _ => input.new_error(BasicParseErrorKind::AtRuleBodyInvalid),
        // }
        todo("This part here", .{});
    };
    return result;
}

fn parse_qualified_rule(
    start: *const ParserState,
    input: *Parser,
    comptime P: type,
    parser: *P,
    delimiters: Delimiters,
) Error!P.QualifiedRuleParser.QualifiedRule {
    ValidQualifiedRuleParser(P);
    const prelude_result = brk: {
        const prelude = input.parseUntilBefore(delimiters, P.QualifiedRuleParser.Prelude, parser, parser.QualifiedRuleParser.parsePrelude);
        break :brk prelude;
    };
    try input.expectCurlyBracketBlock();
    const prelude = try prelude_result;
    const Closure = struct {
        start: *const ParserState,
        prelude: P.QualifiedRuleParser.Prelude,
        parser: *P,

        pub fn parsefn(this: *@This(), input2: *Parser) Error!P.QualifiedRuleParser.QualifiedRule {
            P.QualifiedRuleParser.parseBlock(this.parser, this.prelude, this.start, input2);
        }
    };
    var closure = Closure{
        .start = start,
        .prelude = prelude,
        .parser = parser,
    };
    return parse_nested_block(input, P.QualifiedRuleParser.QualifiedRule, &closure, Closure.parsefn);
}

fn parse_until_before(
    parser: *Parser,
    delimiters_: Delimiters,
    error_behavior: ParseUntilErrorBehavior,
    comptime T: type,
    closure: anytype,
    comptime parse_fn: *const fn (@TypeOf(closure), *Parser) Error!T,
) Error!T {
    const delimiters = parser.stop_before.bitwiseOr(delimiters_);
    const result = result: {
        var delimited_parser = Parser{
            .input = parser.input,
            .at_start_of = if (parser.at_start_of) |block_type| brk: {
                parser.at_start_of = null;
                break :brk block_type;
            } else null,
        };
        const result = delimited_parser.parseEntirely(T, closure, parse_fn);
        const is_result = if (result) |_| false else true;
        if (error_behavior == .stop and is_result) {
            return result;
        }
        if (delimited_parser.at_start_of) |block_type| {
            consume_until_end_of_block(block_type, &delimited_parser.input.tokenizer);
        }
        break :result result;
    };

    // FIXME: have a special-purpose tokenizer method for this that does less work.
    while (true) {
        if (delimiters.contains(Delimiters.fromByte(parser.input.tokenizer.nextByte()))) break;

        if (parser.input.tokenizer.next()) |token| {
            if (BlockType.opening(&token)) |block_type| {
                consume_until_end_of_block(block_type, &parser.input.tokenizer);
            }
        } else {
            break;
        }
    }

    return result;
}

// fn parse_until_before_impl(parser: *Parser, delimiters: Delimiters, error_behavior: Parse

pub fn parse_until_after(
    parser: *Parser,
    delimiters: Delimiters,
    error_behavior: ParseUntilErrorBehavior,
    comptime T: type,
    closure: anytype,
    comptime parsefn: *const fn (@TypeOf(closure), *Parser) Error!T,
) Error!T {
    const result = parse_until_before(parser, delimiters, error_behavior, T, closure, parsefn);
    const is_err = if (result) |_| false else true;
    if (error_behavior == .stop and is_err) {
        return result;
    }
    const next_byte = parser.input.tokenizer.nextByte();
    if (next_byte != null and !parser.stop_before.contains(Delimiters.fromByte(next_byte))) {
        bun.debugAssert(delimiters.contains(Delimiters.from_byte(next_byte)));
        // We know this byte is ASCII.
        parser.input.tokenizer.advance(1);
        if (next_byte == '{') {
            consume_until_end_of_block(BlockType.curly_bracket, &parser.input.tokenizer);
        }
    }
    return result;
}

fn parse_nested_block(parser: *Parser, comptime T: type, closure: anytype, comptime parsefn: *const fn (@TypeOf(closure), *Parser) Error!T) Error!T {
    const block_type: BlockType = if (parser.at_start_of) |block_type| brk: {
        parser.at_start_of = null;
        break :brk block_type;
    } else @panic(
        \\
        \\A nested parser can only be created when a Function,
        \\ParenthisisBlock, SquareBracketBlock, or CurlyBracketBlock
        \\token was just consumed.
    );

    const closing_delimiter = switch (block_type) {
        .curly_bracket => Delimiters{ .close_curly_bracket = true },
        .square_bracket => Delimiters{ .close_square_bracket = true },
        .parenthesis => Delimiters{ .close_parenthesis = true },
    };
    const nested_parser = Parser{
        .input = parser.input,
        .stop_before = closing_delimiter,
    };
    const result = nested_parser.parseEntirely(T, closure, parsefn);
    if (nested_parser.at_start_of) |block_type2| {
        consume_until_end_of_block(block_type2, &nested_parser.input.tokenizer);
    }
    consume_until_end_of_block(block_type, &parser.input.tokenizer);
    return result;
}

pub fn ValidQualifiedRuleParser(comptime T: type) void {
    // The intermediate representation of a qualified rule prelude.
    _ = T.QualifiedRuleParser.Prelude;

    // The finished representation of a qualified rule.
    _ = T.QualifiedRuleParser.QualifiedRule;

    // Parse the prelude of a qualified rule. For style rules, this is as Selector list.
    //
    // Return the representation of the prelude,
    // or `Err(())` to ignore the entire at-rule as invalid.
    //
    // The prelude is the part before the `{ /* ... */ }` block.
    //
    // The given `input` is a "delimited" parser
    // that ends where the prelude should end (before the next `{`).
    //
    // fn parsePrelude(this: *T, input: *Parser) Error!T.QualifiedRuleParser.Prelude;
    _ = T.QualifiedRuleParser.parsePrelude;

    // Parse the content of a `{ /* ... */ }` block for the body of the qualified rule.
    //
    // The location passed in is source location of the start of the prelude.
    //
    // Return the finished representation of the qualified rule
    // as returned by `RuleListParser::next`,
    // or `Err(())` to ignore the entire at-rule as invalid.
    //
    // fn parseBlock(this: *T, prelude: P.QualifiedRuleParser.Prelude, start: *const ParserState, input: *Parser) Error!P.QualifiedRuleParser.QualifiedRule;
    _ = T.QualifiedRuleParser.parseBlock;
}

pub const DefaultAtRule = struct {};

/// Same as `ValidAtRuleParser` but modified to provide parser options
pub fn ValidCustomAtRuleParser(comptime T: type) void {
    // The intermediate representation of prelude of an at-rule.
    _ = T.CustomAtRuleParser.Prelude;

    // The finished representation of an at-rule.
    _ = T.CustomAtRuleParser.AtRule;

    // Parse the prelude of an at-rule with the given `name`.
    //
    // Return the representation of the prelude and the type of at-rule,
    // or `Err(())` to ignore the entire at-rule as invalid.
    //
    // The prelude is the part after the at-keyword
    // and before the `;` semicolon or `{ /* ... */ }` block.
    //
    // At-rule name matching should be case-insensitive in the ASCII range.
    // This can be done with `std::ascii::Ascii::eq_ignore_ascii_case`,
    // or with the `match_ignore_ascii_case!` macro.
    //
    // The given `input` is a "delimited" parser
    // that ends wherever the prelude should end.
    // (Before the next semicolon, the next `{`, or the end of the current block.)
    //
    // pub fn parsePrelude(this: *T, allocator: Allocator, name: []const u8, *Parser, options: *ParserOptions) Error!T.CustomAtRuleParser.Prelude {}
    _ = T.CustomAtRuleParser.parsePrelude;

    // End an at-rule which doesn't have block. Return the finished
    // representation of the at-rule.
    //
    // The location passed in is source location of the start of the prelude.
    // `is_nested` indicates whether the rule is nested inside a style rule.
    //
    // This is only called when either the `;` semicolon indeed follows the prelude,
    // or parser is at the end of the input.
    _ = T.CustomAtRuleParser.ruleWithoutBlock;

    // Parse the content of a `{ /* ... */ }` block for the body of the at-rule.
    //
    // The location passed in is source location of the start of the prelude.
    // `is_nested` indicates whether the rule is nested inside a style rule.
    //
    // Return the finished representation of the at-rule
    // as returned by `RuleListParser::next` or `DeclarationListParser::next`,
    // or `Err(())` to ignore the entire at-rule as invalid.
    //
    // This is only called when a block was found following the prelude.
    _ = T.CustomAtRuleParser.parseBlock;
}

pub fn ValidAtRuleParser(comptime T: type) void {
    _ = T.AtRuleParser.AtRule;
    _ = T.AtRuleParser.Prelude;

    // Parse the prelude of an at-rule with the given `name`.
    //
    // Return the representation of the prelude and the type of at-rule,
    // or `Err(())` to ignore the entire at-rule as invalid.
    //
    // The prelude is the part after the at-keyword
    // and before the `;` semicolon or `{ /* ... */ }` block.
    //
    // At-rule name matching should be case-insensitive in the ASCII range.
    // This can be done with `std::ascii::Ascii::eq_ignore_ascii_case`,
    // or with the `match_ignore_ascii_case!` macro.
    //
    // The given `input` is a "delimited" parser
    // that ends wherever the prelude should end.
    // (Before the next semicolon, the next `{`, or the end of the current block.)
    //
    // pub fn parsePrelude(this: *T, allocator: Allocator, name: []const u8, *Parser) Error!T.AtRuleParser.Prelude {}
    _ = T.AtRuleParser.parsePrelude;

    // End an at-rule which doesn't have block. Return the finished
    // representation of the at-rule.
    //
    // The location passed in is source location of the start of the prelude.
    //
    // This is only called when `parse_prelude` returned `WithoutBlock`, and
    // either the `;` semicolon indeed follows the prelude, or parser is at
    // the end of the input.
    // fn ruleWithoutBlock(this: *T, allocator: Allocator, prelude: T.AtRuleParser.Prelude, state: *const ParserState) Error!T.AtRuleParser.AtRule
    _ = T.AtRuleParser.ruleWithoutBlock;

    // Parse the content of a `{ /* ... */ }` block for the body of the at-rule.
    //
    // The location passed in is source location of the start of the prelude.
    //
    // Return the finished representation of the at-rule
    // as returned by `RuleListParser::next` or `DeclarationListParser::next`,
    // or `Err(())` to ignore the entire at-rule as invalid.
    //
    // This is only called when `parse_prelude` returned `WithBlock`, and a block
    // was indeed found following the prelude.
    //
    // fn parseBlock(this: *T, prelude: T.AtRuleParser.Prelude, start: *const ParserState, input: *Parser) Error!T.AtRuleParser.AtRule
    _ = T.AtRuleParser.parseBlock;
}

pub fn AtRulePrelude(comptime T: type) type {
    return union(enum) {
        // TODO put the comments here
        font_face,
        font_feature_values,
        font_palette_values: DashedIdent,
        import: struct {
            []const u8,
            MediaList,
            ?SupportsCondition,
            ?struct { value: ?LayerName },
        },
        namespace: struct {
            ?[]const u8,
            []const u8,
        },
        charset,
        custom_media: struct {
            DashedIdent,
            MediaList,
        },
        property: struct {
            DashedIdent,
        },
        media: MediaList,
        supports: SupportsCondition,
        viewport: VendorPrefix,
        keyframes: struct {
            name: css_rules.keyframes.KeyframesName,
            prefix: VendorPrefix,
        },
        page: ArrayList(css_rules.page.PageSelector),
        moz_document,
        layer: ArrayList(LayerName),
        container: struct {
            name: ?css_rules.container.ContainerName,
            condition: css_rules.container.ContainerCondition,
        },
        starting_style,
        nest: selector.api.SelectorList,
        scope: struct {
            scope_start: ?selector.api.SelectorList,
            scope_end: ?selector.api.SelectorList,
        },
        unknown: struct {
            name: []const u8,
            /// The tokens of the prelude
            tokens: TokenList,
        },
        custom: T,
        // ZACK YOU ARE IN AT RULE PRELUDE I REPEAT AT RULE PRELUDE
        // TODO

        pub fn allowedInStyleRule(this: *const @This()) bool {
            return switch (this.*) {
                .media, .supports, .container, .moz_document, .layer, .starting_style, .scope, .nest, .unknown, .custom => true,
                .namespace, .font_face, .font_feature_values, .font_palette_values, .counter_style, .keyframes, .page, .property, .import, .custom_media, .viewport, .charset => false,
            };
        }
    };
}

pub fn TopLevelRuleParser(comptime AtRuleParserT: type) type {
    ValidAtRuleParser(AtRuleParserT);
    const AtRuleT = AtRuleParserT.AtRuleParser.AtRule;
    const AtRulePreludeT = AtRulePrelude(AtRuleParserT.AtRuleParser.Prelude);

    return struct {
        allocator: Allocator,
        options: *ParserOptions,
        state: State,
        at_rule_parser: *AtRuleParserT,
        // TODO: think about memory management
        rules: *CssRuleList(AtRuleT),

        const State = enum(u8) {
            start = 1,
            layers = 2,
            imports = 3,
            namespaces = 4,
            body = 5,
        };

        const This = @This();

        pub const AtRuleParser = struct {
            pub const Prelude = AtRulePreludeT;
            pub const AtRule = void;

            pub fn parsePrelude(this: *This, name: []const u8, input: *Parser) Error!Prelude {
                // TODO: optimize string switch
                // So rust does the strategy of:
                // 1. switch (or if branches) on the length of the input string
                // 2. then do string comparison by word size (or smaller sometimes)
                // rust sometimes makes jump table https://godbolt.org/z/63d5vYnsP
                // sometimes it doesn't make a jump table and just does branching on lengths: https://godbolt.org/z/d8jGPEd56
                // it looks like it will only make a jump table when it knows it won't be too sparse? If I add a "h" case (to make it go 1, 2, 4, 5) or a  "hzz" case (so it goes 2, 3, 4, 5) it works:
                // - https://godbolt.org/z/WGTMPxafs (change "hzz" to "h" and it works too, remove it and jump table is gone)
                //
                // I tried recreating the jump table (first link) by hand: https://godbolt.org/z/WPM5c5K4b
                // it worked fairly well. Well I actually just made it match on the length, compiler made the jump table,
                // so we should let the compiler make the jump table.
                // Another recreation with some more nuances: https://godbolt.org/z/9Y1eKdY3r
                // Another recreation where hand written is faster than the Rust compiler: https://godbolt.org/z/sTarKe4Yx
                // specifically we can make the compiler generate a jump table instead of brancing
                //
                // Our ExactSizeMatcher is decent
                // or comptime string map that calls eqlcomptime function thingy, or std.StaticStringMap
                // rust-cssparser does a thing where it allocates stack buffer with maximum possible size and
                // then uses that to do ASCII to lowercase conversion:
                // https://github.com/servo/rust-cssparser/blob/b75ce6a8df2dbd712fac9d49ba38ee09b96d0d52/src/macros.rs#L168
                // we could probably do something similar, looks like the max length never goes above 20 bytes
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "import")) {
                    if (@intFromEnum(this.state) > @intFromEnum(State.imports)) {
                        input.newCustomError(.unexpected_import_rule);
                        return Error.ParsingError;
                    }

                    const url_str = try input.expectUrlOrString();

                    const layer: ?struct { value: ?LayerName } =
                        if (input.tryParse(Parser.expectIdentMatching, .{"layer"}) != Error.ParsingError)
                        .{ .value = null }
                    else if (input.tryParse(Parser.expectFunctionMatching, .{"layer"}) != Error.ParsingError) brk: {
                        break :brk .{ .value = try input.parseNestedBlock(LayerName, void, voidWrap(LayerName, LayerName.parse)) };
                    } else null;

                    const supports = if (input.tryParse(Parser.expectFunctionMatching, .{"supports"}) != Error.ParsingError) brk: {
                        const Func = struct {
                            pub fn do(p: *Parser) Error!SupportsCondition {
                                return p.tryParse(SupportsCondition.parse, .{}) catch {
                                    return SupportsCondition.parseDeclaration(p);
                                };
                            }
                        };
                        break :brk try input.parseNestedBlock(SupportsCondition, void, voidWrap(SupportsCondition, Func.do));
                    } else null;

                    const media = try MediaList.parse(input);

                    return .{
                        .import = .{
                            url_str,
                            media,
                            supports,
                            layer,
                        },
                    };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "namespace")) {
                    if (@intFromEnum(this.state) > @intFromEnum(State.namespaces)) {
                        input.newCustomError(.unexpected_namespace_rule);
                        return Error.ParsingError;
                    }

                    const prefix = input.tryParse(Parser.expectIdent, .{}) catch null;
                    const namespace = try input.expectUrlOrString();
                    return .{ .namespace = .{ prefix, namespace } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "charset")) {
                    // @charset is removed by rust-cssparser if it’s the first rule in the stylesheet.
                    // Anything left is technically invalid, however, users often concatenate CSS files
                    // together, so we are more lenient and simply ignore @charset rules in the middle of a file.
                    try input.expectString();
                    return .charset;
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "custom-media")) {
                    const custom_media_name = try DashedIdent.parse(input);
                    const media = try MediaList.parse(input);
                    return .{
                        .custom_media = .{
                            .name = custom_media_name,
                            .media = media,
                        },
                    };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "property")) {
                    const property_name = try DashedIdent.parse(input);
                    return .{ .property = property_name };
                } else {
                    const Nested = NestedRuleParser(AtRuleParserT);
                    const nested_rule_parser: Nested = this.nested();
                    return Nested.AtRuleParser.parsePrelude(&nested_rule_parser, name, input);
                }
            }

            pub fn parseBlock(this: *This, prelude: AtRuleParser.Prelude, start: *const ParserState, input: *Parser) Error!AtRuleParser.AtRule {
                this.state = .body;
                const nested_parser = this.nested();
                return NestedRuleParser(AtRuleParserT).AtRuleParser.parseBlock(nested_parser, prelude, start, input);
            }

            pub fn ruleWithoutBlock(this: *This, prelude: AtRuleParser.Prelude, start: *const ParserState) Error!AtRuleParser.AtRule {
                const loc_ = start.sourceLocation();
                const loc = css_rules.Location{
                    .source_index = this.options.source_index,
                    .line = loc_.line,
                    .column = loc_.column,
                };

                switch (prelude) {
                    .import => {
                        this.state = State.imports;
                        this.rules.v.append(this.allocator, .{
                            .import = ImportRule{
                                .url = prelude.import[0],
                                .media = prelude.import[1],
                                .supports = prelude.import[2],
                                .layer = prelude.import[3],
                            },
                        });
                        return;
                    },
                    .namespace => {
                        this.state = State.namespaces;

                        const prefix = prelude.namespace[0];
                        const url = prelude.namespace[1];

                        this.rules.v.append(this.allocator, .{
                            .namespace = NamespaceRule{
                                .prefix = prefix,
                                .url = url,
                                .loc = loc,
                            },
                        });

                        return;
                    },
                    .custom_media => {
                        this.state = State.body;
                        this.rules.v.append(
                            this.allocator,
                            .{
                                .custom_media = css_rules.custom_media.CustomMediaRule{
                                    .name = prelude.custom_media.name,
                                    .query = prelude.custom_media.query,
                                    .loc = prelude.custom_media.loc,
                                },
                            },
                        );
                    },
                    .layer => {
                        if (@intFromEnum(this.state) <= @intFromEnum(State.layers)) {
                            this.state = .layers;
                        } else {
                            this.state = .body;
                        }
                        const nested_parser = this.nested();
                        return NestedRuleParser(AtRuleParserT).AtRuleParser.parseBlock(nested_parser, prelude, start);
                    },
                    .charset => {},
                    .unknown => {
                        const name = prelude.unknown[0];
                        const prelude2 = prelude.unknown[1];
                        this.rules.v.append(this.allocator, .{ .unknown = UnknownAtRule{
                            .name = name,
                            .prelude = prelude2,
                            .block = null,
                            .loc = loc,
                        } });
                    },
                    .custom => {
                        this.state = .body;
                        const nested_parser = this.nested();
                        return NestedRuleParser(AtRuleParserT).AtRuleParser.parseBlock(nested_parser, prelude, start);
                    },
                    else => error.ParsingError,
                }
            }
        };

        pub const QualifiedRuleParser = struct {
            pub const Prelude = selector.api.SelectorList;
            pub const QualifiedRule = void;

            pub fn parsePrelude(this: *This, input: *Parser) Error!Prelude {
                this.state = .body;
                var nested_parser = this.nested();
                return nested_parser.QualifiedRuleParser.parsePrelude(&nested_parser, input);
            }

            pub fn parseBlock(this: *This, prelude: Prelude, start: *const ParserState, input: *Parser) Error!QualifiedRule {
                var nested_parser = this.nested();
                return nested_parser.QualifiedRuleParser.parseBlock(&nested_parser, prelude, start, input);
            }
        };

        pub fn new(options: *ParserOptions, at_rule_parser: *AtRuleParser, rules: *CssRuleList(AtRuleT)) @This() {
            return .{
                .options = options,
                .state = .start,
                .at_rule_parser = at_rule_parser,
                .rules = rules,
            };
        }

        pub fn nested(this: *This) NestedRuleParser(AtRuleParserT) {
            return NestedRuleParser(AtRuleParserT){
                .options = this.options,
                .at_rule_parser = this.at_rule_parser,
                .declarations = DeclarationList{},
                .important_declarations = DeclarationList{},
                .rules = &this.rules,
                .is_in_style_rule = false,
                .allow_declarations = false,
            };
        }
    };
}

pub fn NestedRuleParser(comptime T: type) type {
    ValidCustomAtRuleParser(T);

    return struct {
        options: *const ParserOptions,
        at_rule_parser: *T,
        // todo_stuff.think_mem_mgmt
        declarations: DeclarationList,
        // todo_stuff.think_mem_mgmt
        important_declarations: DeclarationList,
        // todo_stuff.think_mem_mgmt
        rules: *CssRuleList(T.CustomAtRuleParser.AtRule),
        is_in_style_rule: bool,
        allow_declarations: bool,

        const This = @This();

        pub fn getLoc(this: *This, start: *ParserState) Location {
            const loc = start.sourceLocation();
            return Location{
                .source_index = this.options.source_index,
                .line = loc.line,
                .column = loc.column,
            };
        }

        pub const AtRuleParser = struct {
            pub const Prelude = AtRulePrelude(T.CustomAtRuleParser.Prelude);
            pub const AtRule = void;

            pub fn parsePrelude(this: *This, name: []const u8, input: *Parser) Error!Prelude {
                const result: Prelude = brk: {
                    if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "media")) {
                        const media = try MediaList.parse(input);
                        break :brk .{ .media = media };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "supports")) {
                        const cond = try SupportsCondition.parse(input);
                        break :brk .{ .supports = cond };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "font-face")) {
                        break :brk .font_face;
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "font-palette-values")) {
                        const dashed_ident_name = try DashedIdentFns.parse(input);
                        break :brk .{ .font_palette_values = dashed_ident_name };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "counter-style")) {
                        const custom_name = try CustomIdentFns.parse(input);
                        break :brk .{ .counter_style = custom_name };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "viewport") or bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "-ms-viewport")) {
                        const prefix: VendorPrefix = if (bun.strings.startsWithCaseInsensitiveAscii(name, "-ms")) .ms else .none;
                        break :brk .{ .viewport = prefix };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "keyframes") or
                        bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "-ms-viewport") or
                        bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "-moz-keyframes") or
                        bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "-o-keyframes") or
                        bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "-ms-keyframes"))
                    {
                        const prefix: VendorPrefix = if (bun.strings.startsWithCaseInsensitiveAscii(name, "-webkit"))
                            .webkit
                        else if (bun.strings.startsWithCaseInsensitiveAscii(name, "-moz-"))
                            .moz
                        else if (bun.strings.startsWithCaseInsensitiveAscii(name, "-o-"))
                            .o
                        else if (bun.strings.startsWithCaseInsensitiveAscii(name, "-ms-")) .ms else .none;

                        const keyframes_name = try input.tryParse(css_rules.keyframes.KeyframesName.parse, .{});
                        break :brk .{ .keyframes = .{ .name = keyframes_name, .prefix = prefix } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "page")) {
                        const Fn = struct {
                            pub fn parsefn(input2: *Parser) Error!css_rules.page.PageSelector {
                                return input2.parseCommaSeparated(css_rules.page.PageSelector.parse);
                            }
                        };
                        const selectors = input.tryParse(Fn.parsefn, .{});
                        break :brk .{ .page = selectors };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "-moz-document")) {
                        // Firefox only supports the url-prefix() function with no arguments as a legacy CSS hack.
                        // See https://css-tricks.com/snippets/css/css-hacks-targeting-firefox/
                        try input.expectFunctionMatching("url-prefix");
                        const Fn = struct {
                            pub fn parsefn(_: void, input2: *Parser) Error!void {
                                // Firefox also allows an empty string as an argument...
                                // https://github.com/mozilla/gecko-dev/blob/0077f2248712a1b45bf02f0f866449f663538164/servo/components/style/stylesheets/document_rule.rs#L303
                                _ = input2.tryParse(parseInner, .{});
                                try input2.expectExhausted();
                            }
                            fn parseInner(input2: *Parser) Error!void {
                                const s = try input2.expectString();
                                if (s.len > 0) {
                                    input2.newCustomError(.invalid_value);
                                    return error.ParsingError;
                                }
                                return;
                            }
                        };
                        try input.parseNestedBlock(void, void, Fn.parsefn);
                        break :brk .moz_document;
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "layer")) {
                        const names = input.parseList(LayerName) catch |e| {
                            // TODO: error does not exist
                            // but it should exist
                            // if (e == Error.EndOfInput) {}
                            return e;
                        };
                        break :brk .{ .layer = names };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "container")) {
                        const container_name = input.tryParse(css_rules.container.ContainerName.parse, .{}) catch null;
                        const condition = try css_rules.container.ContainerCondition.parse(input);
                        break :brk .{ .container = .{ .name = container_name, .condition = condition } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "starting-style")) {
                        break :brk .starting_style;
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "scope")) {
                        var selector_parser = selector.api.SelectorParser{
                            .is_nesting_allowed = true,
                            .options = this.options,
                        };
                        const Closure = struct {
                            selector_parser: *selector.api.SelectorParser,
                            pub fn parsefn(_: void, input2: *Parser) Error!selector.api.SelectorList {
                                return selector.api.SelectorList.parseRelative(&this.selector_parser, input2, .ignore_invalid_selector, .none);
                            }
                        };
                        var closure = Closure{
                            .selector_parser = &selector_parser,
                        };

                        const scope_start = if (input.tryParse(Parser.expectParenthesisBlock, .{})) scope_start: {
                            break :scope_start try input.parseNestedBlock(selector.api.SelectorList, &closure, Closure.parsefn);
                        } else null;

                        const scope_end = if (input.tryParse(Parser.expectIdentMatching, .{"to"})) scope_end: {
                            try input.expectParenthesisBlock();
                            break :scope_end try input.parseNestedBlock(selector.api.SelectorList, &closure, Closure.parsefn);
                        } else null;

                        break :brk .{
                            .scope = .{
                                .scope_start = scope_start,
                                .scope_end = scope_end,
                            },
                        };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "nest") and this.is_in_style_rule) {
                        this.options.warn(input.newCustomError(.deprecated_nest_rule));
                        var selector_parser = selector.api.SelectorParser{
                            .is_nesting_allowed = true,
                            .options = this.options,
                        };
                        const selectors = try selector.api.SelectorList.parse(&selector_parser, input, .discard_list, .contained);
                        break :brk .{ .nest = selectors };
                    } else {
                        break :brk try parse_custom_at_rule_prelude(name, input, this.options, this.at_rule_parser);
                    }
                };

                if (this.is_in_style_rule and !result.allowedInStyleRule()) {
                    input.newError(.{ .at_rule_invalid = name });
                    return error.ParsingError;
                }

                return result;
            }

            pub fn parseBlock(this: *This, prelude: AtRuleParser.Prelude, start: *const ParserState, input: *Parser) Error!AtRuleParser.AtRule {
                defer {
                    // how should we think about deinitializing this?
                    // do it like this defer thing going on here?
                    prelude.deinit();
                    @compileError(todo_stuff.think_mem_mgmt);
                }
                // TODO: finish
                const loc = this.getLoc(start);
                switch (prelude) {
                    .font_face => {
                        var decl_parser = css_rules.font_face.FontFaceDeclarationParser{};
                        var parser = RuleBodyParser(css_rules.font_face.FontFaceDeclarationParser).new(input, &decl_parser);
                        // todo_stuff.think_mem_mgmt
                        var properties: ArrayList(css_rules.font_face.FontFaceProperty) = .{};

                        while (parser.next()) |result| {
                            if (result) |decl| {
                                properties.append(
                                    @compileError(todo_stuff.think_about_allocator),
                                    decl,
                                ) catch bun.outOfMemory();
                            }
                        }

                        this.rules.v.append(
                            @compileError(todo_stuff.think_about_allocator),
                            .{ .font_face = css_rules.font_face.FontFaceRule{
                                .properties = properties,
                                .loc = loc,
                            } },
                        ) catch bun.outOfMemory();
                    },
                    .font_palette_values => {
                        const name = prelude.font_palette_values;
                        const rule = try css_rules.font_palette_values.FontPaletteValuesRule.parse(name, input, loc);
                        this.rules.v.append(
                            @compileError(todo_stuff.think_about_allocator),
                            .{ .font_palette_values = rule },
                        ) catch bun.outOfMemory();
                    },
                    .counter_style => {
                        const name = prelude.counter_style;
                        this.rules.v.append(
                            @compileError(todo_stuff.think_about_allocator),
                            .{
                                .counter_style = css_rules.counter_style.CounterStyleRule{
                                    .name = name,
                                    .declarations = try DeclarationBlock.parse(input, this.options),
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                    },
                    .media => {
                        const query = prelude.media;
                        const rules = try this.parseStyleBlock(input);
                        this.rules.v.append(
                            @compileError(todo_stuff.think_about_allocator),
                            .{
                                .media = css_rules.media.MediaRule(T.CustomAtRuleParser.AtRule){
                                    .query = query,
                                    .rules = rules,
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                    },
                    .supports => {
                        const condition = prelude.supports;
                        const rules = try this.parseStyleBlock(input);
                        this.rules.v.append(@compileError(todo_stuff.think_about_allocator), .{
                            .supports = css_rules.supports.SupportsRule{
                                .condition = condition,
                                .rules = rules,
                                .loc = loc,
                            },
                        }) catch bun.outOfMemory();
                    },
                    .container => {
                        const rules = try this.parseStyleBlock(input);
                        this.rules.v.append(
                            @compileError(todo_stuff.think_about_allocator),
                            .{
                                .container = css_rules.container.ContainerRule(T.CustomAtRuleParser.AtRule){
                                    .name = prelude.container.name,
                                    .condition = prelude.container.condition,
                                    .rules = rules,
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                    },
                    .scope => {
                        const rules = try this.parseStyleBlock(input);
                        this.rules.v.append(
                            @compileError(todo_stuff.think_about_allocator),
                            .{
                                .scope = css_rules.scope.ScopeRule(T.CustomAtRuleParser.AtRule){
                                    .scope_start = prelude.scope.scope_start,
                                    .scope_end = prelude.scope.scope_end,
                                    .rules = rules,
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                    },
                    .viewport => {
                        this.rules.v.append(@compileError(todo_stuff.think_about_allocator), .{
                            .viewport = css_rules.viewport.ViewportRule{
                                .vendor_prefix = prelude.viewport,
                                .declarations = try DeclarationBlock.parse(input, this.options),
                                .loc = loc,
                            },
                        }) catch bun.outOfMemory();
                    },
                    .keyframes => {
                        var parser = css_rules.keyframes.KeyframeListParser;
                        var iter = RuleBodyParser(css_rules.keyframes.KeyframeListParser).new(input, &parser);
                        // todo_stuff.think_mem_mgmt
                        var keyframes = ArrayList(css_rules.keyframes.Keyframe){};

                        while (iter.next()) |result| {
                            if (result) |keyframe| {
                                keyframes.append(
                                    @compileError(todo_stuff.think_about_allocator),
                                    keyframe,
                                ) catch bun.outOfMemory();
                            }
                        }

                        this.rules.v.append(@compileError(todo_stuff.think_about_allocator), .{
                            .keyframes = css_rules.keyframes.KeyframesRule{
                                .name = prelude.keyframes.name,
                                .keyframes = keyframes,
                                .vendor_prefix = prelude.keyframes.prefix,
                                .loc = loc,
                            },
                        }) catch bun.outOfMemory();
                    },
                    .page => {
                        const selectors = prelude.page;
                        const rule = try css_rules.page.PageRule.parse(selectors, input, loc, this.options);
                        this.rules.v.append(
                            @compileError(todo_stuff.think_about_allocator),
                            .{ .page = rule },
                        ) catch bun.outOfMemory();
                    },
                    .moz_document => {
                        const rules = try this.parseStyleBlock(input);
                        this.rules.v.append(@compileError(todo_stuff.think_about_allocator), .{
                            .moz_document = css_rules.document.MozDocumentRule(T.CustomAtRuleParser.AtRule){
                                .rules = rules,
                                .loc = loc,
                            },
                        }) catch bun.outOfMemory();
                    },
                    .layer => {
                        const name = if (prelude.layer.items.len == 0) null else if (prelude.layer.items.len == 1) names: {
                            var out: LayerName = .{};
                            std.mem.swap(LayerName, &out, &prelude.layer.items[0]);
                            break :names out;
                        } else return input.newError(.at_rule_body_invalid);

                        const rules = try this.parseStyleBlock(input);

                        this.rules.v.append(@compileError(todo_stuff.think_about_allocator), .{
                            .layer_block = css_rules.layer.LayerBlockRule{ .name = name, .rules = rules, .loc = loc },
                        });
                    },
                    .property => {
                        const name = prelude.property[0];
                        this.rules.v.append(@compileError(todo_stuff.think_about_allocator), .{
                            .property = try css_rules.property.PropertyRule.parse(name, input, loc),
                        });
                    },
                    .import, .namespace, .custom_media, .charset => {
                        // These rules don't have blocks
                        return input.newUnexpectedTokenError(.curly_bracket_block);
                    },
                    .starting_style => {
                        const rules = try this.parseStyleBlock(input);
                        this.rules.v.append(
                            @compileError(todo_stuff.think_about_allocator),
                            .{
                                .starting_style = css_rules.starting_style.StartingStyleRule{
                                    .rules = rules,
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                    },
                    .nest => {
                        const selectors = prelude.nest;
                        const result = try this.parseNested(input, true);
                        const declarations = result[0];
                        const rules = result[1];
                        this.rules.v.append(
                            @compileError(todo_stuff.think_about_allocator),
                            .{
                                .nesting = css_rules.nesting.NestingRule{
                                    .style = css_rules.style.StyleRule(T.CustomAtRuleParser.AtRule){
                                        .selectors = selectors,
                                        .declarations = declarations,
                                        .vendor_prefix = VendorPrefix.empty(),
                                        .rules = rules,
                                        .loc = loc,
                                    },
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                    },
                    .font_feature_values => bun.unreachablePanic("", .{}),
                    .unknown => {
                        this.rules.v.append(
                            @compileError(todo_stuff.think_about_allocator),
                            .{
                                .unknown = css_rules.unknown.UnknownAtRule{
                                    .name = prelude.unknown.name,
                                    .prelude = prelude.unknown.tokens,
                                    .block = try TokenListFns.parse(input, this.options, 0),
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                    },
                    .custom => {
                        this.rules.v.append(
                            @compileError(todo_stuff.think_about_allocator),
                            .{
                                .custom = try parse_custom_at_rule_body(
                                    T,
                                    prelude,
                                    input,
                                    start,
                                    this.options,
                                    this.at_rule_parser,
                                    this.is_in_style_rule,
                                ),
                            },
                        ) catch bun.outOfMemory();
                    },
                }
            }

            pub fn ruleWithoutBlock(this: *This, prelude: AtRuleParser.Prelude, start: *const ParserState) Error!AtRuleParser.AtRule {
                // TODO: finish
                const loc = this.getLoc(start);
                switch (prelude) {
                    .layer => {
                        if (this.is_in_style_rule or prelude.layer.names.len == 0) {
                            // TODO: the source actually has the return like: Result<Self::AtRule, ()> for AtRuleParser
                            // maybe we should make an empty error type? (EmptyError) or make it return nullable type
                            // return Err(());
                            todo("this", .{});
                        }

                        this.rules.v.append(
                            @compileError(todo_stuff.think_about_allocator),
                            .{
                                .layer_statement = css_rules.layer.LayerStatementRule{
                                    .names = prelude.layer.names,
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                    },
                    .unknown => {
                        this.rules.v.append(
                            @compileError(todo_stuff.think_about_allocator),
                            .{
                                .unknown = css_rules.unknown.UnknownAtRule{
                                    .name = prelude.unknown.name,
                                    .prelude = prelude.unknown.tokens,
                                    .block = null,
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                    },
                    .custom => {
                        this.rules.v.append(
                            @compileError(todo_stuff.think_about_allocator),
                            .{
                                .custom = try parse_custom_at_rule_body(
                                    T,
                                    prelude,
                                    null,
                                    start,
                                    this.options,
                                    this.at_rule_parser,
                                    this.is_in_style_rule,
                                ),
                            },
                        ) catch bun.outOfMemory();
                    },
                    else => {
                        // TODO: the source actually has the return like: Result<Self::AtRule, ()> for AtRuleParser
                        // maybe we should make an empty error type? (EmptyError) or make it return nullable type
                        // return Err(());
                        todo("this", .{});
                    },
                }
            }
        };

        pub const QualifiedRuleParser = struct {
            pub const Prelude = selector.api.SelectorList;
            pub const QualifiedRule = void;

            pub fn parsePrelude(this: *This, input: *Parser) Error!Prelude {
                var selector_parser = selector.SelectorParser{
                    .is_nesting_allowed = true,
                    .options = this.options,
                };

                if (this.is_in_style_rule) {
                    return selector.api.SelectorList.parseRelative(&selector_parser, input, .discard_list, .implicit);
                } else {
                    return selector.api.SelectorList.parse(&selector_parser, input, .discard_list, .none);
                }
            }

            pub fn parseBlock(this: *This, selectors: Prelude, start: *const ParserState, input: *Parser) Error!QualifiedRule {
                const loc = this.getLoc(start);
                const result = try this.parseNested(input, true);
                const declarations = result[0];
                const rules = result[1];

                this.rules.v.append(this.allocator(), .{
                    .style = StyleRule{
                        .selectors = selectors,
                        .vendor_prefix = VendorPrefix{},
                        .declarations = declarations,
                        .rules = rules,
                        .loc = loc,
                    },
                }) catch bun.outOfMemory();
            }
        };

        pub const RuleBodyItemParser = struct {
            pub fn parseQualified(this: *This) bool {
                _ = this; // autofix
                return true;
            }

            pub fn parseDeclarations(this: *This) bool {
                return this.allow_declarations;
            }
        };

        pub const DeclarationParser = struct {
            pub const Declaration = void;

            fn parseValue(this: *This, name: []const u8, input: *Parser) Error!Declaration {
                return css_decls.parse_declaration(
                    name,
                    input,
                    &this.declarations,
                    &this.important_declarations,
                    this.options,
                );
            }
        };

        pub fn parseNested(this: *This, input: *Parser, is_style_rule: bool) Error!struct { DeclarationBlock, CssRuleList(T.CustomAtRuleParser.AtRule) } {
            // TODO: think about memory management in error cases
            var rules = CssRuleList(T.CustomAtRuleParser.AtRule){};
            var nested_parser = This{
                .options = this.options,
                .at_rule_parser = this.at_rule_parser,
                .declarations = DeclarationList{},
                .important_declarations = DeclarationList{},
                .rules = &rules,
                .is_in_style_rule = this.is_in_style_rule or is_style_rule,
                .allow_declarations = this.allow_declarations or this.is_in_style_rule or is_style_rule,
            };

            const parse_declarations = This.RuleBodyItemParser.parseDeclarations(nested_parser);
            // TODO: think about memory management
            var errors = ArrayList(Error){};
            var iter = RuleBodyParser(This).new(input, &nested_parser);

            while (iter.next()) |result| {
                if (result) {} else |e| {
                    if (parse_declarations) {
                        iter.parser.declarations.clearRetainingCapacity();
                        iter.parser.important_declarations.clearRetainingCapacity();
                        errors.append(
                            @compileError(todo_stuff.think_about_allocator),
                            e,
                        ) catch bun.outOfMemory();
                    } else {
                        if (iter.parser.options.error_recovery) {
                            iter.parser.options.warn(e);
                            continue;
                        }
                        return e;
                    }
                }
            }

            if (parse_declarations) {
                if (errors.items.len > 0) {
                    if (this.options.error_recovery) {
                        for (errors.items) |e| {
                            this.options.warn(e);
                        }
                    } else {
                        return errors.orderedRemove(0);
                    }
                }
            }

            return .{
                DeclarationBlock{
                    .declarations = nested_parser.declarations,
                    .important_declarations = nested_parser.important_declarations,
                },
                rules,
            };
        }

        pub fn parseStyleBlock(this: *This, input: *Parser) Error!CssRuleList(T.CustomAtRuleParser.AtRule) {
            const srcloc = input.currentSourceLocation();
            const loc = Location{
                .source_index = this.options.source_index,
                .line = srcloc.line,
                .column = srcloc.column,
            };

            // Declarations can be immediately within @media and @supports blocks that are nested within a parent style rule.
            // These act the same way as if they were nested within a `& { ... }` block.
            const declarations, var rules = try this.parseNested(input, false);

            if (declarations.len() > 0) {
                rules.v.insert(
                    @compileError(todo_stuff.think_about_allocator),
                    0,
                    .{
                        .style = StyleRule(T.CustomAtRuleParser.AtRule){
                            .selectors = selector.api.SelectorList.fromSelector(
                                @compileError(todo_stuff.think_about_allocator),
                                selector.api.Selector.fromComponent(.nesting),
                            ),
                            .declarations = declarations,
                            .vendor_prefix = VendorPrefix.empty(),
                            .rules = .{},
                            .loc = loc,
                        },
                    },
                ) catch unreachable;
            }

            return rules;
        }
    };
}

pub fn StyleSheetParser(comptime P: type) type {
    ValidAtRuleParser(P);
    ValidQualifiedRuleParser(P);

    if (P.QualifiedRuleParser.QualifiedRule != P.AtRuleParser.AtRule) {
        @compileError("StyleSheetParser: P.QualifiedRuleParser.QualifiedRule != P.AtRuleParser.AtRule");
    }

    const Item = P.AtRuleParser.AtRule;

    return struct {
        input: *Parser,
        parser: *P,
        any_rule_so_far: bool = false,

        pub fn new(input: *Parser, parser: *P) @This() {
            return .{
                .input = input,
                .parser = parser,
            };
        }

        pub fn next(this: *@This(), allocator: Allocator) ?(Error!Item) {
            _ = allocator; // autofix
            while (true) {
                this.input.@"skip cdc and cdo"();

                const start = this.input.state();
                const at_keyword: ?[]const u8 = switch (this.input.nextByte()) {
                    '@' => brk: {
                        const at_keyword: *Token = this.input.nextIncludingWhitespaceAndComments() catch {
                            this.input.reset(&start);
                            break :brk null;
                        };
                        if (at_keyword.* == .at_keyword) break :brk at_keyword.*;
                        this.input.reset(&start);
                        break :brk null;
                    },
                    else => null,
                };

                if (at_keyword) |name| {
                    const first_stylesheet_rule = !this.any_rule_so_far;
                    this.any_rule_so_far = true;

                    if (first_stylesheet_rule and bun.strings.eqlCaseInsensitiveASCII(name, "charset", true)) {
                        const delimiters = Delimiters{
                            .semicolon = true,
                            .close_curly_bracket = true,
                        };
                        _ = this.input.parseUntilAfter(delimiters, Parser.parseEmpty);
                    } else {
                        return parse_at_rule(&start, name, this.input, this.parser);
                    }
                } else {
                    this.any_rule_so_far = true;
                    const result = parse_qualified_rule(&start, this.input, *this.parser, Delimiters{ .curly_bracket = true });
                    return result;
                }
            }
        }
    };
}

/// A result returned from `to_css`, including the serialized CSS
/// and other metadata depending on the input options.
pub const ToCssResult = struct {
    /// Serialized CSS code.
    code: []const u8,
    /// A map of CSS module exports, if the `css_modules` option was
    /// enabled during parsing.
    exports: ?CssModuleExports,
    /// A map of CSS module references, if the `css_modules` config
    /// had `dashed_idents` enabled.
    references: ?CssModuleReferences,
    /// A list of dependencies (e.g. `@import` or `url()`) found in
    /// the style sheet, if the `analyze_dependencies` option is enabled.
    dependencies: ?ArrayList(Dependency),
};

pub fn StyleSheet(comptime AtRule: type) type {
    return struct {
        /// A list of top-level rules within the style sheet.
        rules: CssRuleList(AtRule) = .{},
        sources: ArrayList([]const u8) = .{},
        source_map_urls: ArrayList(?[]const u8) = .{},
        license_comments: ArrayList([]const u8) = .{},
        options: ParserOptions,

        const This = @This();

        pub fn toCss(this: *const @This(), allocator: Allocator, options: css_printer.PrinterOptions) Maybe(ToCssResult, Error(PrinterErrorKind)) {
            // TODO: this is not necessary
            // Make sure we always have capacity > 0: https://github.com/napi-rs/napi-rs/issues/1124.
            var dest = ArrayList(u8).initCapacity(allocator, 1) catch unreachable;
            const writer = dest.writer(allocator);
            const project_root = options.project_root;
            var printer = Printer(@TypeOf(writer)).new(writer, options);

            // #[cfg(feature = "sourcemap")]
            // {
            //   printer.sources = Some(&self.sources);
            // }

            // #[cfg(feature = "sourcemap")]
            // if printer.source_map.is_some() {
            //   printer.source_maps = self.sources.iter().enumerate().map(|(i, _)| self.source_map(i)).collect();
            // }

            for (this.license_comments.items) |comment| {
                printer.writeStr("/*");
                printer.writeStr(comment);
                printer.writeStr("*/\n");
            }

            if (this.options.css_modules) |*config| {
                var references = std.StringArrayHashMap(CssModuleReferences).init(allocator);
                printer.css_module = CssModule.new(config, &this.sources, project_root, &references);

                try this.rules.toCss(&printer);
                try printer.newline();

                return ToCssResult{
                    .dependencies = printer.dependencies,
                    .exports = exports: {
                        const val = printer.css_module.?.exports_by_source_index.items[0];
                        printer.css_module.?.exports_by_source_index.items[0] = .{};
                        break :exports val;
                    },
                    .code = dest,
                    .references = references,
                };
            } else {
                try this.rules.toCss(&printer);
                return ToCssResult{
                    .dependencies = printer.dependencies,
                    .code = dest,
                    .exports = null,
                    .references = null,
                };
            }
        }

        pub fn parseWith(
            allocator: Allocator,
            code: []const u8,
            options: ParserOptions,
            comptime P: type,
            at_rule_parser: *P,
        ) Error!This {
            var input = ParserInput.new(allocator, code);
            var parser = Parser.new(allocator, &input);

            var license_comments = ArrayList([]const u8){};
            var state = parser.state();
            while (parser.nextIncludingWhitespaceAndComments() catch null) |token| {
                switch (token.*) {
                    .whitespace => {},
                    .comment => |comment| {
                        if (bun.strings.startsWithChar(comment, '!')) {
                            license_comments.append(allocator, comment) catch bun.outOfMemory();
                        }
                    },
                    else => break,
                }
                state = parser.state();
            }
            parser.reset(&state);

            var rules = CssRuleList(AtRule){};
            var rule_parser = TopLevelRuleParser(AtRule).new(&options, at_rule_parser, &rules);
            var rule_list_parser = StyleSheetParser(TopLevelRuleParser(AtRule)).new(&parser, &rule_parser);

            while (rule_list_parser.next()) |result| {
                _ = result catch |e| {
                    const result_options = rule_list_parser.parser.options;
                    if (result_options.error_recovery) {
                        // TODO this
                        // options.logger.addWarningFmt(source: ?*const Source, l: Loc, allocator: std.mem.Allocator, comptime text: string, args: anytype)
                        continue;
                    }

                    return e;
                };
            }

            // TODO finish these
            const sources = ArrayList([]const u8){};
            // sources.append(allocator, options.filename) catch bun.outOfMemory();
            const source_map_urls = ArrayList([]const u8){};

            return This{
                .sources = sources,
                .source_map_urls = source_map_urls,
                .license_comments = license_comments,
                .options = options,
            };
        }
    };
}

pub fn ValidDeclarationParser(comptime P: type) void {
    // The finished representation of a declaration.
    _ = P.DeclarationParser.Declaration;

    // Parse the value of a declaration with the given `name`.
    //
    // Return the finished representation for the declaration
    // as returned by `DeclarationListParser::next`,
    // or `Err(())` to ignore the entire declaration as invalid.
    //
    // Declaration name matching should be case-insensitive in the ASCII range.
    // This can be done with `std::ascii::Ascii::eq_ignore_ascii_case`,
    // or with the `match_ignore_ascii_case!` macro.
    //
    // The given `input` is a "delimited" parser
    // that ends wherever the declaration value should end.
    // (In declaration lists, before the next semicolon or end of the current block.)
    //
    // If `!important` can be used in a given context,
    // `input.try_parse(parse_important).is_ok()` should be used at the end
    // of the implementation of this method and the result should be part of the return value.
    //
    // fn parseValue(this: *T, name: []const u8, input: *Parser) Error!T.DeclarationParser.Declaration
    _ = P.DeclarationParser.parseValue;
}

/// Also checks that P is:
/// - ValidDeclarationParser(P)
/// - ValidQualifiedRuleParser(P)
/// - ValidAtRuleParser(P)
pub fn ValidRuleBodyItemParser(comptime P: type) void {
    ValidDeclarationParser(P);
    ValidQualifiedRuleParser(P);
    ValidAtRuleParser(P);

    // Whether we should attempt to parse declarations. If you know you won't, returning false
    // here is slightly faster.
    _ = P.RuleBodyItemParser.parseDeclarations;

    // Whether we should attempt to parse qualified rules. If you know you won't, returning false
    // would be slightly faster.
    _ = P.RuleBodyItemParser.parseQualified;

    // We should have:
    // P.DeclarationParser.Declaration == P.QualifiedRuleParser.QualifiedRule == P.AtRuleParser.AtRule
    if (P.DeclarationParser.Declaration != P.QualifiedRuleParser.QualifiedRule or
        P.DeclarationParser.Declaration != P.AtRuleParser.AtRule)
    {
        @compileError("ValidRuleBodyItemParser: P.DeclarationParser.Declaration != P.QualifiedRuleParser.QualifiedRule or\n  P.DeclarationParser.Declaration != P.AtRuleParser.AtRule");
    }
}

pub fn RuleBodyParser(comptime P: type) type {
    ValidRuleBodyItemParser(P);
    // Same as P.AtRuleParser.AtRule and P.DeclarationParser.Declaration
    const I = P.QualifiedRuleParser.QualifiedRule;

    return struct {
        input: *Parser,
        parser: *P,

        const This = @This();

        pub fn new(input: *Parser, parser: *P) This {
            return .{
                .input = input,
                .parser = parser,
            };
        }

        /// TODO: result is actually:
        ///     type Item = Result<I, (ParseError<'i, E>, &'i str)>;
        ///
        /// but nowhere in the source do i actually see it using the string part of the tuple
        pub fn next(this: *This) ?(Error!I) {
            while (true) {
                this.input.skipWhitespace();
                const start = this.input.state();

                const tok: *Token = this.input.nextIncludingWhitespaceAndComments() catch return null;

                switch (tok.*) {
                    .close_curly_bracket, .whitespace, .semicolon, .comment => continue,
                    .at_keyword => {
                        const name = tok.at_keyword;
                        return parse_at_rule(
                            @compileError(todo_stuff.think_about_allocator),
                            &start,
                            name,
                            this.input,
                            P,
                            this.parser,
                        );
                    },
                    .ident => {
                        if (P.RuleBodyItemParser.parseDeclarations(this.parser)) {
                            const name = tok.ident;
                            const parse_qualified = P.RuleBodyItemParser.parseQualified(this.parser);
                            const result: Error!I = result: {
                                const error_behavior: ParseUntilErrorBehavior = if (parse_qualified) .stop else .consume;
                                const Closure = struct {
                                    parser: *P,
                                    pub fn parsefn(self: *@This(), input: *Parser) Error!I {
                                        try input.expectColon();
                                        return P.DeclarationParser.parseValue(self.parser, name, input);
                                    }
                                };
                                var closure = Closure{
                                    .parser = this.parser,
                                };
                                break :result parse_until_after(this.input, Delimiters{ .semicolon = true }, error_behavior, I, &closure, Closure.parsefn);
                            };
                            const is_err = if (result) true else false;
                            if (is_err and parse_qualified) {
                                this.input.reset(&start);
                                if (parse_qualified_rule(
                                    &start,
                                    this.input,
                                    P,
                                    this.parser,
                                    Delimiters{ .semicolon = true, .curly_bracket_block = true },
                                )) |qual| {
                                    return qual;
                                }
                            }

                            return result;
                        }
                    },
                    else => {},
                }

                const result: Error!I = if (P.RuleBodyItemParser.parseQualified(this.parser)) result: {
                    this.input.reset(&start);
                    const delimiters = if (P.RuleBodyItemParser.parseDeclarations(this.parser)) Delimiters{
                        .semicolon = true,
                        .curly_bracket_block = true,
                    } else Delimiters{ .curly_bracket = true };
                    break :result parse_qualified_rule(&start, this.input, P, this.parser, delimiters);
                } else result: {
                    const token = tok.*;
                    _ = token; // autofix
                    const Fn = struct {
                        token: Token,
                        fn parsefn(input: *Parser) Error!I {
                            _ = input; // autofix
                            // TODO: implement this
                            // Err(start.source_location().new_unexpected_token_error(token))
                            // return input.newCustomError(.unexpected_token);
                            @panic("TODO");
                        }
                    };
                    break :result this.input.parseUntilAfter(Delimiters{ .semicolon = true }, I, Fn.parsefn);
                };

                return result;
            }
        }
    };
}

pub const ParserOptions = struct {
    /// Filename to use in error messages.
    filename: []const u8,
    /// Whether the enable [CSS modules](https://github.com/css-modules/css-modules).
    css_modules: ?css_modules.Config,
    /// The source index to assign to all parsed rules. Impacts the source map when
    /// the style sheet is serialized.
    source_index: u32,
    /// Whether to ignore invalid rules and declarations rather than erroring.
    error_recovery: bool,
    /// A list that will be appended to when a warning occurs.
    logger: Log,
    /// Feature flags to enable.
    flags: ParserFlags,

    pub fn default(allocator: std.mem.Allocator) ParserOptions {
        return ParserOptions{
            .filename = "",
            .css_modules = null,
            .source_index = 0,
            .error_recovery = false,
            .logger = Log.init(allocator),
            .flags = ParserFlags{},
        };
    }
};

/// Parser feature flags to enable.
pub const ParserFlags = packed struct(u8) {
    /// Whether the enable the [CSS nesting](https://www.w3.org/TR/css-nesting-1/) draft syntax.
    nesting: bool = false,
    /// Whether to enable the [custom media](https://drafts.csswg.org/mediaqueries-5/#custom-mq) draft syntax.
    custom_media: bool = false,
    /// Whether to enable the non-standard >>> and /deep/ selector combinators used by Vue and Angular.
    deep_selector_combinator: bool = false,
};

const ParseUntilErrorBehavior = enum {
    consume,
    stop,
};

pub const Parser = struct {
    input: *ParserInput,
    at_start_of: ?BlockType = null,
    stop_before: Delimiters = Delimiters.NONE,

    pub fn new(input: *ParserInput) Parser {
        return Parser{
            .input = input,
        };
    }

    /// Return a slice of the CSS input, from the given position to the current one.
    pub fn sliceFrom(this: *const Parser, start_position: usize) []const u8 {
        return this.input.tokenizer.sliceFrom(start_position);
    }

    pub fn currentSourceLocation(this: *const Parser) SourceLocation {
        return this.input.tokenizer.currentSourceLocation();
    }

    pub fn allocator(this: *Parser) Allocator {
        return this.input.tokenizer.allocator;
    }

    /// Implementation of Vec::<T>::parse
    pub fn parseList(this: *Parser, comptime T: type, comptime parse_one: *const fn (*Parser) Error!T) Error!ArrayList(T) {
        return this.parseCommaSeparated(T, parse_one);
    }

    /// Parse a list of comma-separated values, all with the same syntax.
    ///
    /// The given closure is called repeatedly with a "delimited" parser
    /// (see the `Parser::parse_until_before` method) so that it can over
    /// consume the input past a comma at this block/function nesting level.
    ///
    /// Successful results are accumulated in a vector.
    ///
    /// This method returns `Err(())` the first time that a closure call does,
    /// or if a closure call leaves some input before the next comma or the end
    /// of the input.
    pub fn parseCommaSeparated(
        this: *Parser,
        comptime T: type,
        comptime parse_one: *const fn (*Parser) Error!T,
    ) Error!ArrayList(T) {
        return this.parseCommaSeparatedInternal(T, parse_one, false);
    }

    fn parseCommaSeparatedInternal(
        this: *Parser,
        comptime T: type,
        comptime parse_one: *const fn (*Parser) Error!T,
        ignore_errors: bool,
    ) Error!ArrayList(T) {
        // Vec grows from 0 to 4 by default on first push().  So allocate with
        // capacity 1, so in the somewhat common case of only one item we don't
        // way overallocate.  Note that we always push at least one item if
        // parsing succeeds.
        //
        // TODO(zack): might be faster to use stack fallback here
        // in the common case we may have just 1, but I feel like it is also very common to have >1
        // which means every time we have >1 items we will always incur 1 more additional allocation
        var values = ArrayList(T){};
        values.initCapacity(@compileError(todo_stuff.think_about_allocator), 1) catch unreachable;

        while (true) {
            this.skipWhitespace(); // Unnecessary for correctness, but may help try() in parse_one rewind less.
            if (this.parseUntilBefore(Delimiters{ .comma = true }, {}, voidWrap(T, parse_one))) |v| {
                values.append(@compileError(todo_stuff.think_about_allocator), v) catch unreachable;
            } else |e| {
                if (!ignore_errors) return e;
            }
            const tok = this.next() catch return values;
            if (tok != .comma) bun.unreachablePanic("", .{});
        }
    }

    /// Execute the given closure, passing it the parser.
    /// If the result (returned unchanged) is `Err`,
    /// the internal state of the parser  (including position within the input)
    /// is restored to what it was before the call.
    ///
    /// func needs to be a funtion like this: `fn func(*ParserInput, ...@TypeOf(args_)) T`
    pub inline fn tryParse(this: *Parser, comptime func: anytype, args_: anytype) Error!bun.meta.ReturnOf(func) {
        const start = this.state();
        const result = result: {
            const args = brk: {
                var args: std.meta.ArgsTuple(@TypeOf(func)) = undefined;
                args[0] = this.input;

                inline for (args_, 1..) |a, i| {
                    args[i] = a;
                }

                break :brk args;
            };

            break :result @call(.auto, func, args);
        };
        result catch {
            this.reset(start);
        };
        return result;
    }

    pub fn parseNestedBlock(this: *Parser, comptime T: type, closure: anytype, comptime parsefn: *const fn (@TypeOf(closure), *Parser) Error!T) Error!T {
        return parse_nested_block(this, T, closure, parsefn);
    }

    pub fn isExhausted(this: *Parser) bool {
        return if (this.expectExhausted()) |_| true else false;
    }

    /// Parse the input until exhaustion and check that it contains no “error” token.
    ///
    /// See `Token::is_parse_error`. This also checks nested blocks and functions recursively.
    pub fn expectNoErrorToken(this: *Parser) Error!void {
        _ = this; // autofix
        @compileError(todo_stuff.depth);
    }

    pub fn expectPercentage(this: *Parser) Error!f32 {
        const start_location = this.currentSourceLocation();
        const tok = try this.next();
        if (tok.* == .percentage) return tok.percentage.unit_value;
        return start_location.newBasicUnexpectedTokenError(tok.*);
    }

    pub fn expectComma(this: *Parser) Error!void {
        const start_location = this.currentSourceLocation();
        const tok = try this.next();
        switch (tok.*) {
            .semicolon => return,
            else => {},
        }
        return start_location.newBasicUnexpectedTokenError(tok.*);
    }

    /// Parse a <number-token> that does not have a fractional part, and return the integer value.
    pub fn expectInteger(this: *Parser) Error!i32 {
        const start_location = this.currentSourceLocation();
        const tok = try this.next();
        if (tok.* == .number and tok.number.int_value != null) return tok.number.int_value.?;
        return start_location.newBasicUnexpectedTokenError(tok.*);
    }

    /// Parse a <number-token> and return the integer value.
    pub fn expectNumber(this: *Parser) Error!f32 {
        const start_location = this.currentSourceLocation();
        const tok = try this.next();
        if (tok.* == .number) return tok.number.value;
        return start_location.newBasicUnexpectedTokenError(tok.*);
    }

    pub fn expectDelim(this: *Parser, delim: u8) Error!void {
        const start_location = this.currentSourceLocation();
        const tok = try this.next();
        if (tok.* == .delim and tok.delim == delim) return;
        return start_location.newBasicUnexpectedTokenError(tok.*);
    }

    pub fn expectParenthesisBlock(this: *Parser) Error!void {
        const start_location = this.currentSourceLocation();
        const tok = try this.next();
        if (tok.* == .open_paren) return;
        return start_location.newBasicUnexpectedTokenError(tok.*);
    }

    pub fn expectColon(this: *Parser) Error!void {
        const start_location = this.currentSourceLocation();
        const tok = try this.next();
        if (tok.* == .colon) return;
        return start_location.newBasicUnexpectedTokenError(tok.*);
    }

    pub fn expectString(this: *Parser) Error![]const u8 {
        const start_location = this.currentSourceLocation();
        const tok = try this.next();
        if (tok.* == .string) return tok.string;
        return start_location.newBasicUnexpectedTokenError(tok.*);
    }

    pub fn expectIdent(this: *Parser) Error![]const u8 {
        const start_location = this.currentSourceLocation();
        const tok = try this.next();
        if (tok.* == .ident) return tok.ident;
        return start_location.newBasicUnexpectedTokenError(tok.*);
    }

    /// Parse either a <ident-token> or a <string-token>, and return the unescaped value.
    pub fn expectIdentOrString(this: *Parser) Error![]const u8 {
        const start_location = this.currentSourceLocation();
        const tok = try this.next();
        switch (tok.*) {
            .ident => |i| return i,
            .string => |s| return s,
            else => {},
        }
        return start_location.newBasicUnexpectedTokenError(tok.*);
    }

    pub fn expectIdentMatching(this: *Parser, name: []const u8) Error!void {
        const start_location = this.currentSourceLocation();
        const tok = try this.next();
        switch (tok.*) {
            .ident => |i| if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, i)) return,
            else => {},
        }
        return start_location.newBasicUnexpectedTokenError(tok.*);
    }

    pub fn expectFunctionMatching(this: *Parser, name: []const u8) Error!void {
        const start_location = this.currentSourceLocation();
        const tok = try this.next();
        switch (tok.*) {
            .function => |fn_name| if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, fn_name)) return,
            else => {},
        }
        return start_location.newBasicUnexpectedTokenError(tok.*);
    }

    pub fn expectCurlyBracketBlock(this: *Parser) Error!void {
        const start_location = this.currentSourceLocation();
        const tok = try this.next();
        switch (tok.*) {
            .open_curly => return,
            else => return start_location.newBasicUnexpectedTokenError(tok.*),
        }
    }

    pub fn position(this: *Parser) usize {
        bun.debugAssert(bun.strings.isOnCharBoundary(this.input.tokenizer.src, this.input.tokenizer.position));
        return this.input.tokenizer.position;
    }

    fn parseEmpty(_: *Parser) Error!void {}

    /// Like `parse_until_before`, but also consume the delimiter token.
    ///
    /// This can be useful when you don’t need to know which delimiter it was
    /// (e.g. if these is only one in the given set)
    /// or if it was there at all (as opposed to reaching the end of the input).
    pub fn parseUntilAfter(
        this: *Parser,
        delimiters: Delimiters,
        comptime T: type,
        comptime parse_fn: *const fn (*Parser) Error!T,
    ) Error!T {
        const Fn = struct {
            pub fn parsefn(_: void, p: *Parser) Error!T {
                return parse_fn(p);
            }
        };
        return parse_until_after(
            this,
            delimiters,
            ParserState.none,
            T,
            {},
            Fn.parsefn,
        );
    }

    pub fn parseUntilBefore(this: *Parser, delimiters: Delimiters, comptime T: type, closure: anytype, comptime parse_fn: *const fn (@TypeOf(closure), *Parser) Error!T) Error!T {
        return parse_until_before(this, delimiters, .consume, T, closure, parse_fn);
    }

    pub fn parseEntirely(this: *Parser, comptime T: type, closure: anytype, comptime parsefn: *const fn (@TypeOf(closure), *Parser) Error!T) Error!T {
        const result = try parsefn(closure, this);
        try this.expectExhausted();
        return result;
    }

    /// Check whether the input is exhausted. That is, if `.next()` would return a token.
    /// Return a `Result` so that the `?` operator can be used: `input.expect_exhausted()?`
    ///
    /// This ignores whitespace and comments.
    pub fn expectExhausted(this: *Parser) Error!void {
        const start = this.state();
        const result = result: {
            if (this.next()) |t| {
                break :result start.sourceLocation().newBasicUnexpectedTokenError(t.*);
            } else |e| {
                if (e == .end_of_input) break :result;
                bun.unreachablePanic("Unexpected error encountered: {s}", .{@errorName(e)});
            }
        };
        this.reset(&start);
        return result;
    }

    pub fn @"skip cdc and cdo"(this: *@This()) void {
        if (this.at_start_of) |block_type| {
            this.at_start_of = null;
            consume_until_end_of_block(block_type, &this.input.tokenizer);
        }

        this.input.tokenizer.@"skip cdc and cdo"();
    }

    pub fn skipWhitespace(this: *@This()) void {
        if (this.at_start_of) |block_type| {
            this.at_start_of = null;
            consume_until_end_of_block(block_type, &this.input.tokenizer);
        }

        this.input.tokenizer.skipWhitespace();
    }

    pub fn next(this: *@This()) Error!*Token {
        this.skipWhitespace();
        this.nextIncludingWhitespaceAndComments();
    }

    /// Same as `Parser::next`, but does not skip whitespace tokens.
    pub fn nextIncludingWhitespace(this: *@This()) Error!*Token {
        while (true) {
            if (this.nextIncludingWhitespaceAndComments()) |tok| {
                if (tok.* == .comment) {} else break;
            } else |e| return e;
        }
        return this.input.cached_token.?;
    }

    pub fn nextByte(this: *@This()) ?u8 {
        const byte = this.input.tokenizer.nextByte();
        if (this.stop_before.contains(Delimiters.fromByte(byte))) {
            return null;
        }
        return byte;
    }

    pub fn reset(this: *Parser, state_: *const ParserState) void {
        this.input.tokenizer.reset(state_);
        this.at_start_of = state_.at_start_of;
    }

    pub fn state(this: *Parser) ParserState {
        return ParserState{
            .position = this.input.tokenizer.getPosition(),
            .current_line_start_position = this.input.tokenizer.current_line_start_position,
            .current_line_number = this.input.tokenizer.current_line_number,
            .at_start_of = this.at_start_of,
        };
    }

    /// Same as `Parser::next`, but does not skip whitespace or comment tokens.
    ///
    /// **Note**: This should only be used in contexts like a CSS pre-processor
    /// where comments are preserved.
    /// When parsing higher-level values, per the CSS Syntax specification,
    /// comments should always be ignored between tokens.
    pub fn nextIncludingWhitespaceAndComments(this: *Parser) error.ParseError!*Token {
        if (this.at_start_of) |block_type| {
            this.at_start_of = null;
            consume_until_end_of_block(block_type, *this.input.tokenizer);
        }

        const byte = this.input.tokenizer.nextByte();
        if (this.stop_before.contains(Delimiters.fromByte(byte))) {
            return this.newBasicError(BasicParseErrorKind{ .end_of_input = true });
        }

        const token_start_position = this.input.tokenizer.getPosition();
        const using_cached_token = this.input.cached_token != null and this.input.cached_token.?.start_position == token_start_position;

        const token = if (using_cached_token) token: {
            const cached_token = &this.input.cached_token.?;
            this.input.tokenizer.reset(&cached_token.end_state);
            if (cached_token.token == .function) {
                this.input.tokenizer.seeFunction(cached_token.token.function);
            }
            break :token cached_token.token;
        } else token: {
            const new_token = try (this.input.tokenizer.next() catch this.newBasicError(BasicParseErrorKind{ .end_of_input = true }));
            this.input.cached_token = CachedToken{
                .token = new_token,
                .start_position = token_start_position,
                .end_state = this.input.tokenizer.state(),
            };
            break :token &this.input.cached_token;
        };

        if (BlockType.opening(token)) |block_type| {
            this.at_start_of = block_type;
        }

        return token;
    }

    const ParseError = struct {
        comptime {
            @compileError(todo_stuff.errors);
        }
    };

    /// Create a new unexpected token or EOF ParseError at the current location
    pub fn newErrorForNextToken(this: *Parser) ParseError {
        _ = this; // autofix
        @compileError(todo_stuff.errors);
        // let token = match self.next() {
        //     Ok(token) => token.clone(),
        //     Err(e) => return e.into(),
        // };
        // self.new_error(BasicParseErrorKind::UnexpectedToken(token))
    }
};

/// A set of characters, to be used with the `Parser::parse_until*` methods.
///
/// The union of two sets can be obtained with the `|` operator. Example:
///
/// ```{rust,ignore}
/// input.parse_until_before(Delimiter::CurlyBracketBlock | Delimiter::Semicolon)
/// ```
pub const Delimiters = packed struct(u8) {
    /// The delimiter set with only the `{` opening curly bracket
    curly_bracket: bool = false,
    /// The delimiter set with only the `;` semicolon
    semicolon: bool = false,
    /// The delimiter set with only the `!` exclamation point
    bang: bool = false,
    /// The delimiter set with only the `,` comma
    comma: bool = false,
    close_curly_bracket: bool = false,
    close_square_bracket: bool = false,
    close_parenthesis: bool = false,
    __unused: u1 = 0,

    pub usingnamespace Bitflags(Delimiters);

    const NONE: Delimiters = .{};

    pub fn getDelimiter(comptime tag: @TypeOf(.EnumLiteral)) Delimiters {
        var empty = Delimiters{};
        @field(empty, @tagName(tag)) = true;
        return empty;
    }

    const TABLE: [256]Delimiters = brk: {
        var table: [256]Delimiters = [_]Delimiters{.{}} ** 256;
        table[';'] = getDelimiter(.semicolon);
        table['!'] = getDelimiter(.bang);
        table[','] = getDelimiter(.comma);
        table['{'] = getDelimiter(.curly_bracket_block);
        table['}'] = getDelimiter(.close_curly_bracket);
        table[']'] = getDelimiter(.close_square_bracket);
        table[')'] = getDelimiter(.close_parenthesis);
        break :brk table;
    };

    // pub fn bitwiseOr(lhs: Delimiters, rhs: Delimiters) Delimiters {
    //     return @bitCast(@as(u8, @bitCast(lhs)) | @as(u8, @bitCast(rhs)));
    // }

    // pub fn contains(lhs: Delimiters, rhs: Delimiters) bool {
    //     return @as(u8, @bitCast(lhs)) & @as(u8, @bitCast(rhs)) != 0;
    // }

    pub fn fromByte(byte: ?u8) Delimiters {
        if (byte) |b| return TABLE[b];
        return .{};
    }
};

const ParserInput = struct {
    tokenizer: Tokenizer,
    cached_token: ?CachedToken = null,

    pub fn new(allocator: Allocator, code: []const u8) ParserInput {
        return ParserInput{
            .tokenizer = Tokenizer.init(allocator, code),
        };
    }
};

/// A capture of the internal state of a `Parser` (including the position within the input),
/// obtained from the `Parser::position` method.
///
/// Can be used with the `Parser::reset` method to restore that state.
/// Should only be used with the `Parser` instance it came from.
pub const ParserState = struct {
    position: usize,
    current_line_start_position: usize,
    current_line_number: u32,
    at_start_of: BlockType,

    pub fn sourceLocation(this: *const ParserState) SourceLocation {
        return .{
            .line = this.current_line_number,
            .column = @intCast(this.position - this.current_line_start_position + 1),
        };
    }
};

const BlockType = enum {
    parenthesis,
    square_bracket,
    curly_bracket,

    fn opening(token: *const Token) ?BlockType {
        return switch (token.*) {
            .function, .open_paren => .parenthesis,
            .open_square => .square_bracket,
            .open_curly => .curly_bracket,
            else => null,
        };
    }

    fn closing(token: *const Token) ?BlockType {
        return switch (token.*) {
            .close_paren => .parenthesis,
            .close_square => .square_bracket,
            .close_curly => .curly_bracket,
            else => null,
        };
    }
};

pub const nth = struct {
    /// Parse the *An+B* notation, as found in the `:nth-child()` selector.
    /// The input is typically the arguments of a function,
    /// in which case the caller needs to check if the arguments’ parser is exhausted.
    /// Return `Ok((A, B))`, or `Err(())` for a syntax error.
    pub fn parse_nth(input: *Parser) Error!struct { i32, i32 } {
        const tok = try input.next();
        switch (tok.*) {
            .number => {
                if (tok.number.int_value) |b| return .{ 0, b };
            },
            .dimension => {
                if (tok.dimension.num.int_value) |a| {
                    // @compileError(todo_stuff.match_ignore_ascii_case);
                    const unit = tok.dimension.unit;
                    if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "n")) {
                        return try parse_b(input, a);
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "n-")) {
                        return try parse_signless_b(input, a);
                    } else {
                        if (parse_n_dash_digits(unit)) |b| {
                            return .{ a, b };
                        } else {
                            return input.newBasicUnexpectedTokenError(.{ .ident = unit });
                        }
                    }
                }
            },
            .ident => {
                const value = tok.ident;
                // @compileError(todo_stuff.match_ignore_ascii_case);
                if (bun.strings.eqlCaseInsensitiveASCIIIgnoreLength(value, "even")) {
                    return .{ 2, 0 };
                } else if (bun.strings.eqlCaseInsensitiveASCIIIgnoreLength(value, "odd")) {
                    return .{ 2, 1 };
                } else if (bun.strings.eqlCaseInsensitiveASCIIIgnoreLength(value, "n")) {
                    return try parse_b(input, 1);
                } else if (bun.strings.eqlCaseInsensitiveASCIIIgnoreLength(value, "-n")) {
                    return try parse_b(input, -1);
                } else if (bun.strings.eqlCaseInsensitiveASCIIIgnoreLength(value, "n-")) {
                    return try parse_signless_b(input, 1, -1);
                } else if (bun.strings.eqlCaseInsensitiveASCIIIgnoreLength(value, "-n-")) {
                    return try parse_signless_b(input, -1, -1);
                } else {
                    const slice, const a = if (bun.strings.startsWithChar(value, '-')) .{ value[1..], -1 } else .{ value, 1 };
                    if (parse_n_dash_digits(slice)) |b| return .{ a, b };
                    return input.newBasicUnexpectedTokenError(.{ .ident = value });
                }
            },
            .delim => {
                const next_tok = try input.nextIncludingWhitespace();
                if (next_tok.* == .ident) {
                    const value = next_tok.ident;
                    if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(value, "n")) {
                        return try parse_b(input, 1);
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(value, "-n")) {
                        return try parse_signless_b(input, 1, -1);
                    } else {
                        if (parse_n_dash_digits(value)) |b| {
                            return .{ 1, b };
                        } else {
                            return input.newBasicUnexpectedTokenError(.{ .ident = value });
                        }
                    }
                } else {
                    return input.newBasicUnexpectedTokenError(next_tok.*);
                }
            },
            else => {},
        }
        return input.newBasicUnexpectedTokenError(tok.*);
    }

    fn parse_b(input: *Parser, a: i23) Error!struct { i32, i32 } {
        const start = input.state();
        const tok = input.next() catch {
            input.reset(&start);
            return .{ a, 0 };
        };

        if (tok.* == .delim and tok.delim == '+') return parse_signless_b(input, a, 1);
        if (tok.* == .delim and tok.delim == '-') return parse_signless_b(input, a, -1);
        if (tok.* == .number and tok.number.has_sign and tok.number.int_value != null) return parse_signless_b(input, a, tok.number.int_value.?);
        input.reset(&start);
        return .{ a, 0 };
    }

    fn parse_signless_b(input: *Parser, a: i32, b_sign: i32) Error!struct { i32, i32 } {
        const tok = try input.next();
        if (tok.* == .number and !tok.number.has_sign and tok.number.int_value != null) {
            const b = tok.number.int_value.?;
            return .{ a, b_sign * b };
        }
        return input.newBasicUnexpectedTokenError(tok.*);
    }

    fn parse_n_dash_digits(str: []const u8) Error!i32 {
        const bytes = str;
        if (bytes.len >= 3 and
            bun.strings.eqlCaseInsensitiveASCIIICheckLength(bytes[0..2], "n-") and
            brk: {
            for (bytes[2..]) |b| {
                if (b < '0' or b > '9') break :brk false;
            }
            break :brk true;
        }) {
            return parse_number_saturate(str[1..]); // Include the minus sign
        } else {
            //         return Err(());
            @compileError(todo_stuff.errors);
        }
    }

    fn parse_number_saturate(string: []const u8) Error!i32 {
        var input = ParserInput.new(@compileError(todo_stuff.think_about_allocator), string);
        var parser = Parser.new(&input);
        const tok = parser.nextIncludingWhitespaceAndComments() catch {
            //         return Err(());
            @compileError(todo_stuff.errors);
        };
        const int = if (tok.* == .number and tok.number.int_value != null) tok.number.int_value.? else {
            //         return Err(());
            @compileError(todo_stuff.errors);
        };
        if (!parser.isExhausted()) {
            //         return Err(());
            @compileError(todo_stuff.errors);
        }
        return int;
    }
};

const CachedToken = struct {
    token: Token,
    start_position: usize,
    end_state: ParserState,
};

const Tokenizer = struct {
    src: []const u8,
    position: usize = 0,
    source_map_url: ?[]const u8 = null,
    current_line_start_position: usize = 0,
    current_line_number: usize = 0,
    allocator: Allocator,
    var_or_env_functions: SeenStatus = .dont_care,
    current: Token = undefined,
    previous: Token = undefined,

    const SeenStatus = enum {
        dont_care,
        looking_for_them,
        seen_at_least_one,
    };

    const FORM_FEED_BYTE = 0x0C;
    const REPLACEMENT_CHAR = 0xFFFD;
    const REPLACEMENT_CHAR_UNICODE: [3]u8 = [3]u8{ 0xEF, 0xBF, 0xBD };
    const MAX_ONE_B: u32 = 0x80;
    const MAX_TWO_B: u32 = 0x800;
    const MAX_THREE_B: u32 = 0x10000;

    pub fn init(allocator: Allocator, src: []const u8) Tokenizer {
        var lexer = Tokenizer{
            .src = src,
            .allocator = allocator,
            .position = 0,
        };

        // make current point to the first token
        _ = lexer.next();
        lexer.position = 0;

        return lexer;
    }

    pub fn getPosition(this: *const Tokenizer) usize {
        bun.debugAssert!(bun.strings.isOnCharBoundary(this.src, this.position));
        return this.position;
    }

    pub fn state(this: *const Tokenizer) ParserState {
        return ParserState{
            .position = this.position,
            .current_line_start_position = this.current_line_start_position,
            .current_line_number = this.current_line_number,
            .at_start_of = null,
        };
    }

    pub fn skipWhitespace(this: *Tokenizer) void {
        while (!this.isEof()) {
            // todo_stuff.match_byte
            switch (this.nextByteUnchecked()) {
                ' ' | '\t' => this.advance(1),
                '\n', 0x0C, '\r' => this.consumeNewline(),
                '/' => {
                    if (this.startsWith("/*")) {
                        _ = this.consumeComment();
                    } else return;
                },
                else => return,
            }
        }
    }

    pub fn currentSourceLocation(this: *const Tokenizer) SourceLocation {
        return SourceLocation{
            .line = this.current_line_number,
            .column = @intCast(this.position - this.current_line_start_position + 1),
        };
    }

    pub fn prev(this: *Tokenizer) Token {
        bun.assert(this.position > 0);
        return this.previous;
    }

    pub inline fn isEof(this: *Tokenizer) bool {
        return this.position >= this.src.len;
    }

    pub fn seeFunction(this: *Tokenizer, name: []const u8) void {
        if (this.var_or_env_functions == .looking_for_them) {
            if (std.ascii.eqlIgnoreCase(name, "var") and std.ascii.eqlIgnoreCase(name, "env")) {
                this.var_or_env_functions = .seen_at_least_one;
            }
        }
    }

    /// TODO: fix this, remove the additional shit I added
    /// return error if it is eof
    pub fn next(this: *Tokenizer) Token {
        this.previous = this.current;
        const ret = this.nextImpl();
        this.current = ret;
        return ret;
    }

    pub fn nextImpl(this: *Tokenizer) Token {
        if (this.isEof()) return .eof;

        // todo_stuff.match_byte;
        const b = this.byteAt(0);
        switch (b) {
            ' ', '\t' => return this.consumeWhitespace(false),
            '\n', FORM_FEED_BYTE, '\r' => return this.consumeWhitespace(true),
            '"' => return this.consumeString(false),
            '#' => {
                this.advance(1);
                if (this.isIdentStart()) return .{ .idhash = this.consumeName() };
                if (!this.isEof() and switch (this.nextByteUnchecked()) {
                    // Any other valid case here already resulted in IDHash.
                    '0'...'9', '-' => true,
                    else => false,
                }) return .{ .hash = this.consumeName() };
                return .{ .delim = '#' };
            },
            '$' => {
                if (this.startsWith("$=")) {
                    this.advance(2);
                    return .suffix_match;
                }
                this.advance(1);
                return .{ .delim = '$' };
            },
            '\'' => return this.consumeString(true),
            '(' => {
                this.advance(1);
                return .open_paren;
            },
            ')' => {
                this.advance(1);
                return .close_paren;
            },
            '*' => {
                if (this.startsWith("*=")) {
                    this.advance(2);
                    return .substring_match;
                }
                this.advance(1);
                return .{ .delim = '*' };
            },
            '+' => {
                if ((this.hasAtLeast(1) and switch (this.byteAt(1)) {
                    '0'...'9' => true,
                    else => false,
                }) or (this.hasAtLeast(2) and
                    this.byteAt(1) == '.' and switch (this.byteAt(2)) {
                    '0'...'9' => true,
                    else => false,
                })) {
                    return this.consumeNumeric();
                }

                this.advance(1);
                return .{ .delim = '+' };
            },
            ',' => {
                this.advance(1);
                return .comma;
            },
            '-' => {
                if ((this.hasAtLeast(1) and switch (this.byteAt(1)) {
                    '0'...'9' => true,
                    else => false,
                }) or (this.hasAtLeast(2) and this.byteAt(1) == '.' and switch (this.byteAt(2)) {
                    '0'...'9' => true,
                    else => false,
                })) return this.consumeNumeric();

                if (this.startsWith("-->")) {
                    this.advance(3);
                    return .cdc;
                }

                if (this.isIdentStart()) return this.consumeIdentLike();

                this.advance(1);
                return .{ .delim = '-' };
            },
            '.' => {
                if (this.hasAtLeast(1) and switch (this.byteAt(1)) {
                    '0'...'9' => true,
                    else => false,
                }) {
                    return this.consumeNumeric();
                }
                this.advance(1);
                return .{ .delim = '.' };
            },
            '/' => {
                if (this.startsWith("/*")) return .{ .comment = this.consumeComment() };
                this.advance(1);
                return .{ .delim = '/' };
            },
            '0'...'9' => return this.consumeNumeric(),
            ':' => {
                this.advance(1);
                return .colon;
            },
            ';' => {
                this.advance(1);
                return .semicolon;
            },
            '<' => {
                if (this.startsWith("<!--")) {
                    this.advance(4);
                    return .cdo;
                }
                this.advance(1);
                return .{ .delim = '<' };
            },
            '@' => {
                this.advance(1);
                if (this.isIdentStart()) return .{ .at_keyword = this.consumeName() };
                return .{ .delim = '@' };
            },
            'a'...'z', 'A'...'Z', '_', 0 => return this.consumeIdentLike(),
            '[' => {
                this.advance(1);
                return .open_square;
            },
            '\\' => {
                if (!this.hasNewlineAt(1)) return this.consumeIdentLike();
                this.advance(1);
                return .{ .delim = '\\' };
            },
            ']' => {
                this.advance(1);
                return .close_square;
            },
            '^' => {
                if (this.startsWith("^=")) {
                    this.advance(2);
                    return .prefix_match;
                }
                this.advance(1);
                return .{ .delim = '^' };
            },
            '{' => {
                this.advance(1);
                return .open_curly;
            },
            '|' => {
                if (this.startsWith("|=")) {
                    this.advance(2);
                    return .dash_match;
                }
                this.advance(1);
                return .{ .delim = '|' };
            },
            '}' => {
                this.advance(1);
                return .close_curly;
            },
            '~' => {
                if (this.startsWith("~=")) {
                    this.advance(2);
                    return .include_match;
                }
                this.advance(1);
                return .{ .delim = '~' };
            },
            else => {
                if (!std.ascii.isASCII(b)) {
                    return this.consumeIdentLike();
                }
                this.advance(1);
                return .{ .delim = b };
            },
        }
    }

    pub fn reset(this: *Tokenizer, state2: *const ParserState) void {
        this.position = state2.position;
        this.current_line_start_position = state2.current_line_start_position;
        this.current_line_number = state2.current_line_number;
    }

    pub fn @"skip cdc and cdo"(this: *@This()) void {
        while (!this.isEof()) {
            // todo_stuff.match_byte
            switch (this.nextByteUnchecked()) {
                ' ', '\t' => this.advance(1),
                '\n', 0x0C, '\r' => this.consumeNewline(),
                '/' => if (this.startsWith("/*")) this.consumeComment() else return,
                '<' => if (this.startsWith("<!--")) this.advance(4) else return,
                '-' => if (this.startsWith("-->")) this.advance(3) else return,
                else => return,
            }
        }
    }

    pub fn consumeNumeric(this: *Tokenizer) Token {
        // Parse [+-]?\d*(\.\d+)?([eE][+-]?\d+)?
        // But this is always called so that there is at least one digit in \d*(\.\d+)?

        // Do all the math in f64 so that large numbers overflow to +/-inf
        // and i32::{MIN, MAX} are within range.
        const has_sign: bool, const sign: f64 = brk: {
            switch (this.nextByteUnchecked()) {
                '-' => break :brk .{ true, -1.0 },
                '+' => break :brk .{ true, 1.0 },
                else => break :brk .{ false, 1.0 },
            }
        };

        if (has_sign) this.advance(1);

        var integral_part: f64 = 0.0;
        while (byteToDecimalDigit(this.nextByteUnchecked())) |digit| {
            integral_part = integral_part * 10.0 + @as(f64, @floatFromInt(digit));
            this.advance(1);
            if (this.isEof()) break;
        }

        var is_integer = true;

        var fractional_part: f64 = 0.0;
        if (this.hasAtLeast(1) and this.nextByteUnchecked() == '.' and switch (this.byteAt(1)) {
            '0'...'9' => true,
            else => false,
        }) {
            is_integer = false;
            this.advance(1);
            var factor: f64 = 0.1;
            while (byteToDecimalDigit(this.nextByteUnchecked())) |digit| {
                fractional_part += @as(f64, @floatFromInt(digit)) * factor;
                factor *= 0.1;
                this.advance(1);
                if (this.isEof()) break;
            }
        }

        var value: f64 = sign * (integral_part + fractional_part);

        if (this.hasAtLeast(1) and switch (this.nextByteUnchecked()) {
            'e', 'E' => true,
            else => false,
        }) {
            if (switch (this.byteAt(1)) {
                '0'...'9' => true,
                else => false,
            } or (this.hasAtLeast(2) and switch (this.byteAt(1)) {
                '+', '-' => true,
                else => false,
            } and switch (this.byteAt(2)) {
                '0'...'9' => true,
                else => false,
            })) {
                is_integer = false;
                this.advance(1);
                const has_sign2: bool, const sign2: f64 = brk: {
                    switch (this.nextByteUnchecked()) {
                        '-' => break :brk .{ true, -1.0 },
                        '+' => break :brk .{ true, 1.0 },
                        else => break :brk .{ false, 1.0 },
                    }
                };

                if (has_sign2) this.advance(1);

                var exponent: f64 = 0.0;
                while (byteToDecimalDigit(this.nextByteUnchecked())) |digit| {
                    exponent = exponent * 10.0 + @as(f64, @floatFromInt(digit));
                    this.advance(1);
                    if (this.isEof()) break;
                }
                value *= std.math.pow(f64, 10, sign2 * exponent);
            }
        }

        const int_value: ?i32 = brk: {
            const i32_max = comptime std.math.maxInt(i32);
            const i32_min = comptime std.math.minInt(i32);
            if (is_integer) {
                if (value >= @as(f64, @floatFromInt(i32_max))) {
                    break :brk i32_max;
                } else if (value <= @as(f64, @floatFromInt(i32_min))) {
                    break :brk i32_min;
                } else {
                    break :brk @intFromFloat(value);
                }
            }

            break :brk null;
        };

        if (!this.isEof() and this.nextByteUnchecked() == '%') {
            this.advance(1);
            return .{ .percentage = .{ .unit_value = @floatCast(value / 100), .int_value = int_value, .has_sign = has_sign } };
        }

        if (this.isIdentStart()) {
            const unit = this.consumeName();
            return .{
                .dimension = .{
                    .num = .{ .value = @floatCast(value), .int_value = int_value, .has_sign = has_sign },
                    .unit = unit,
                },
            };
        }

        return .{
            .number = .{ .value = @floatCast(value), .int_value = int_value, .has_sign = has_sign },
        };
    }

    pub fn consumeWhitespace(this: *Tokenizer, comptime newline: bool) Token {
        const start_position = this.position;
        if (newline) {
            this.consumeNewline();
        } else {
            this.advance(1);
        }

        while (!this.isEof()) {
            // todo_stuff.match_byte
            const b = this.nextByteUnchecked();
            switch (b) {
                ' ', '\t' => this.advance(1),
                '\n', FORM_FEED_BYTE, '\r' => this.consumeNewline(),
                else => break,
            }
        }

        return .{ .whitespace = this.sliceFrom(start_position) };
    }

    pub fn consumeString(this: *Tokenizer, comptime single_quote: bool) Token {
        const quoted_string = this.consumeQuotedString(single_quote);
        if (quoted_string.bad) return .{ .bad_string = quoted_string.str };
        return .{ .string = quoted_string.str };
    }

    pub fn consumeIdentLike(this: *Tokenizer) Token {
        const value = this.consumeName();
        if (!this.isEof() and this.nextByteUnchecked() == '(') {
            this.advance(1);
            if (std.ascii.eqlIgnoreCase(value, "url")) return if (this.consumeUnquotedUrl()) |tok| return tok else .{ .function = value };
            this.seeFunction(value);
            return .{ .function = value };
        }
        return .{ .ident = value };
    }

    pub fn consumeName(this: *Tokenizer) []const u8 {
        const start_pos = this.position;
        var value_bytes: CopyOnWriteStr = undefined;

        while (true) {
            if (this.isEof()) return this.sliceFrom(start_pos);

            // todo_stuff.match_byte
            switch (this.nextByteUnchecked()) {
                'a'...'z', 'A'...'Z', '0'...'9', '_', '-' => this.advance(1),
                '\\', 0 => {
                    // * The tokenizer’s input is UTF-8 since it’s `&str`.
                    // * start_pos is at a code point boundary
                    // * so is the current position (which is before '\\' or '\0'
                    //
                    // So `value_bytes` is well-formed UTF-8.
                    value_bytes = .{ .borrowed = this.sliceFrom(start_pos) };
                    break;
                },
                0x80...0xBF => this.consumeContinuationByte(),
                // This is the range of the leading byte of a 2-3 byte character
                // encoding
                0xC0...0xEF => this.advance(1),
                0xF0...0xFF => this.consume4byteIntro(),
                else => return this.sliceFrom(start_pos),
            }
        }

        while (!this.isEof()) {
            const b = this.nextByteUnchecked();
            // todo_stuff.match_byte
            switch (b) {
                'a'...'z', 'A'...'Z', '0'...'9', '_', '-' => {
                    this.advance(1);
                    value_bytes.append(this.allocator, &[_]u8{b});
                },
                '\\' => {
                    if (this.hasNewlineAt(1)) break;
                    this.advance(1);
                    this.consumeEscapeAndWrite(&value_bytes);
                },
                0 => {
                    this.advance(1);
                    value_bytes.append(this.allocator, REPLACEMENT_CHAR_UNICODE[0..]);
                },
                0x80...0xBF => {
                    // This byte *is* part of a multi-byte code point,
                    // we’ll end up copying the whole code point before this loop does something else.
                    this.consumeContinuationByte();
                    value_bytes.append(this.allocator, &[_]u8{b});
                },
                0xC0...0xEF => {
                    // This byte *is* part of a multi-byte code point,
                    // we’ll end up copying the whole code point before this loop does something else.
                    this.advance(1);
                    value_bytes.append(this.allocator, &[_]u8{b});
                },
                0xF0...0xFF => {
                    this.consume4byteIntro();
                    value_bytes.append(this.allocator, &[_]u8{b});
                },
                else => {
                    // ASCII
                    break;
                },
            }
        }

        return value_bytes.toSlice();
    }

    pub fn consumeQuotedString(this: *Tokenizer, comptime single_quote: bool) struct { str: []const u8, bad: bool = false } {
        const start_pos = this.position;
        var string_bytes: CopyOnWriteStr = undefined;

        while (true) {
            if (this.isEof()) return .{ .str = this.sliceFrom(start_pos) };

            // todo_stuff.match_byte
            switch (this.nextByteUnchecked()) {
                '"' => {
                    if (!single_quote) {
                        const value = this.sliceFrom(start_pos);
                        this.advance(1);
                        return .{ .str = value };
                    }
                    this.advance(1);
                },
                '\'' => {
                    if (single_quote) {
                        const value = this.sliceFrom(start_pos);
                        this.advance(1);
                        return .{ .str = value };
                    }
                    this.advance(1);
                },
                // The CSS spec says NULL bytes ('\0') should be turned into replacement characters: 0xFFFD
                '\\', 0 => {
                    // * The tokenizer’s input is UTF-8 since it’s `&str`.
                    // * start_pos is at a code point boundary
                    // * so is the current position (which is before '\\' or '\0'
                    //
                    // So `string_bytes` is well-formed UTF-8.
                    string_bytes = .{ .borrowed = this.sliceFrom(start_pos) };
                    break;
                },
                '\n', '\r', FORM_FEED_BYTE => return .{ .str = this.sliceFrom(start_pos), .bad = true },
                0x80...0xBF => this.consumeContinuationByte(),
                0xF0...0xFF => this.consume4byteIntro(),
                else => {
                    this.advance(1);
                },
            }
        }

        while (!this.isEof()) {
            const b = this.nextByteUnchecked();
            // todo_stuff.match_byte
            switch (b) {
                // string_bytes is well-formed UTF-8, see other comments
                '\n', '\r', FORM_FEED_BYTE => return .{ .str = string_bytes.toSlice(), .bad = true },
                '"' => {
                    this.advance(1);
                    if (!single_quote) break;
                },
                '\'' => {
                    this.advance(1);
                    if (single_quote) break;
                },
                '\\' => {
                    this.advance(1);
                    if (!this.isEof()) {
                        switch (this.nextByteUnchecked()) {
                            // Escaped newline
                            '\n', FORM_FEED_BYTE, '\r' => this.consumeNewline(),
                            else => this.consumeEscapeAndWrite(&string_bytes),
                        }
                    }
                    // else: escaped EOF, do nothing.
                    // continue;
                },
                0 => {
                    this.advance(1);
                    string_bytes.append(this.allocator, REPLACEMENT_CHAR_UNICODE[0..]);
                    continue;
                },
                0x80...0xBF => this.consumeContinuationByte(),
                0xF0...0xFF => this.consume4byteIntro(),
                else => {
                    this.advance(1);
                },
            }

            string_bytes.append(this.allocator, &[_]u8{b});
        }

        return .{ .str = string_bytes.toSlice() };
    }

    pub fn consumeUnquotedUrl(this: *Tokenizer) ?Token {
        // This is only called after "url(", so the current position is a code point boundary.
        const start_position = this.position;
        const from_start = this.src[this.position..];
        var newlines: u32 = 0;
        var last_newline: usize = 0;
        var found_printable_char = false;

        var offset: usize = 0;
        var b: u8 = undefined;
        while (true) {
            defer offset += 1;

            if (offset < from_start.len) {
                b = from_start[offset];
            } else {
                this.position = this.src.len;
                break;
            }

            // todo_stuff.match_byte
            switch (b) {
                ' ', '\t' => {},
                '\n', FORM_FEED_BYTE => {
                    newlines += 1;
                    last_newline = offset;
                },
                '\r' => {
                    if (offset + 1 < from_start.len and from_start[offset + 1] != '\n') {
                        newlines += 1;
                        last_newline = offset;
                    }
                },
                '"', '\'' => return null, // Do not advance
                ')' => {
                    // Don't use advance, because we may be skipping
                    // newlines here, and we want to avoid the assert.
                    this.position += offset + 1;
                    break;
                },
                else => {
                    // Don't use advance, because we may be skipping
                    // newlines here, and we want to avoid the assert.
                    this.position += offset;
                    found_printable_char = true;
                    break;
                },
            }
        }

        if (newlines > 0) {
            this.current_line_number += newlines;
            // No need for wrapping_add here, because there's no possible
            // way to wrap.
            this.current_line_start_position = start_position + last_newline + 1;
        }

        if (found_printable_char) {
            // This function only consumed ASCII (whitespace) bytes,
            // so the current position is a code point boundary.
            return this.consumeUnquotedUrlInternal();
        }
        return .{ .unquoted_url = "" };
    }

    pub fn consumeUnquotedUrlInternal(this: *Tokenizer) Token {
        // This function is only called with start_pos at a code point boundary.;
        const start_pos = this.position;
        var string_bytes: CopyOnWriteStr = undefined;

        while (true) {
            if (this.isEof()) return .{ .unquoted_url = this.sliceFrom(start_pos) };

            // todo_stuff.match_byte
            switch (this.nextByteUnchecked()) {
                ' ', '\t', '\n', '\r', FORM_FEED_BYTE => {
                    var value = .{ .borrowed = this.sliceFrom(start_pos) };
                    return this.consumeUrlEnd(start_pos, &value);
                },
                ')' => {
                    const value = this.sliceFrom(start_pos);
                    this.advance(1);
                    return .{ .unquoted_url = value };
                },
                // non-printable
                0x01...0x08,
                0x0B,
                0x0E...0x1F,
                0x7F,

                // not valid in this context
                '"',
                '\'',
                '(',
                => {
                    this.advance(1);
                    return this.consumeBadUrl(start_pos);
                },
                '\\', 0 => {
                    // * The tokenizer’s input is UTF-8 since it’s `&str`.
                    // * start_pos is at a code point boundary
                    // * so is the current position (which is before '\\' or '\0'
                    //
                    // So `string_bytes` is well-formed UTF-8.
                    string_bytes = .{ .borrowed = this.sliceFrom(start_pos) };
                    break;
                },
                0x80...0xBF => this.consumeContinuationByte(),
                0xF0...0xFF => this.consume4byteIntro(),
                else => {
                    // ASCII or other leading byte.
                    this.advance(1);
                },
            }
        }

        while (!this.isEof()) {
            const b = this.nextByteUnchecked();
            // todo_stuff.match_byte
            switch (b) {
                ' ', '\t', '\n', '\r', FORM_FEED_BYTE => {
                    // string_bytes is well-formed UTF-8, see other comments.
                    // const string = string_bytes.toSlice();
                    // return this.consumeUrlEnd(start_pos, &string);
                    return this.consumeUrlEnd(start_pos, &string_bytes);
                },
                ')' => {
                    this.advance(1);
                    break;
                },
                // non-printable
                0x01...0x08,
                0x0B,
                0x0E...0x1F,
                0x7F,

                // invalid in this context
                '"',
                '\'',
                '(',
                => {
                    this.advance(1);
                    return this.consumeBadUrl(start_pos);
                },
                '\\' => {
                    this.advance(1);
                    if (this.hasNewlineAt(0)) return this.consumeBadUrl(start_pos);

                    // This pushes one well-formed code point to string_bytes
                    this.consumeEscapeAndWrite(&string_bytes);
                },
                0 => {
                    this.advance(1);
                    string_bytes.append(this.allocator, REPLACEMENT_CHAR_UNICODE[0..]);
                },
                0x80...0xBF => {
                    // We’ll end up copying the whole code point
                    // before this loop does something else.
                    this.consumeContinuationByte();
                    string_bytes.append(this.allocator, &[_]u8{b});
                },
                0xF0...0xFF => {
                    // We’ll end up copying the whole code point
                    // before this loop does something else.
                    this.consume4byteIntro();
                    string_bytes.append(this.allocator, &[_]u8{b});
                },
                // If this byte is part of a multi-byte code point,
                // we’ll end up copying the whole code point before this loop does something else.
                else => {
                    // ASCII or other leading byte.
                    this.advance(1);
                    string_bytes.append(this.allocator, &[_]u8{b});
                },
            }
        }

        // string_bytes is well-formed UTF-8, see other comments.
        return .{ .unquoted_url = string_bytes.toSlice() };
    }

    pub fn consumeUrlEnd(this: *Tokenizer, start_pos: usize, string: *CopyOnWriteStr) Token {
        while (!this.isEof()) {
            // todo_stuff.match_byte
            switch (this.nextByteUnchecked()) {
                ')' => {
                    this.advance(1);
                    break;
                },
                ' ', '\t' => this.advance(1),
                '\n', FORM_FEED_BYTE, '\r' => this.consumeNewline(),
                else => |b| {
                    this.consumeKnownByte(b);
                    return this.consumeBadUrl(start_pos);
                },
            }
        }

        return .{ .unquoted_url = string.toSlice() };
    }

    pub fn consumeBadUrl(this: *Tokenizer, start_pos: usize) Token {
        // Consume up to the closing )
        while (!this.isEof()) {
            // todo_stuff.match_byte
            switch (this.nextByteUnchecked()) {
                ')' => {
                    const contents = this.sliceFrom(start_pos);
                    this.advance(1);
                    return .{ .bad_url = contents };
                },
                '\\' => {
                    this.advance(1);
                    if (this.nextByte()) |b| {
                        if (b == ')' or b == '\\') this.advance(1); // Skip an escaped ')' or '\'
                    }
                },
                '\n', FORM_FEED_BYTE, '\r' => this.consumeNewline(),
                else => |b| this.consumeKnownByte(b),
            }
        }
        return .{ .bad_url = this.sliceFrom(start_pos) };
    }

    pub fn consumeEscapeAndWrite(this: *Tokenizer, bytes: *CopyOnWriteStr) void {
        const val = this.consumeEscape();
        var utf8bytes: [4]u8 = undefined;
        const len = std.unicode.utf8Encode(@truncate(val), utf8bytes[0..]) catch @panic("Invalid");
        bytes.append(this.allocator, utf8bytes[0..len]);
    }

    pub fn consumeEscape(this: *Tokenizer) u32 {
        if (this.isEof()) return 0xFFFD; // Unicode replacement character

        // todo_stuff.match_byte
        switch (this.nextByteUnchecked()) {
            '0'...'9', 'A'...'F', 'a'...'f' => {
                const c = this.consumeHexDigits().value;
                if (!this.isEof()) {
                    // todo_stuff.match_byte
                    switch (this.nextByteUnchecked()) {
                        ' ', '\t' => this.advance(1),
                        '\n', FORM_FEED_BYTE, '\r' => this.consumeNewline(),
                        else => {},
                    }
                }

                if (c != 0 and std.unicode.utf8ValidCodepoint(@truncate(c))) return c;
                return REPLACEMENT_CHAR;
            },
            0 => {
                this.advance(1);
                return REPLACEMENT_CHAR;
            },
            else => return this.consumeChar(),
        }
    }

    pub fn consumeHexDigits(this: *Tokenizer) struct { value: u32, num_digits: u32 } {
        var value: u32 = 0;
        var digits: u32 = 0;
        while (digits < 6 and !this.isEof()) {
            if (byteToHexDigit(this.nextByteUnchecked())) |digit| {
                value = value * 16 + digit;
                digits += 1;
                this.advance(1);
            } else break;
        }

        return .{ .value = value, .num_digits = digits };
    }

    pub fn consumeChar(this: *Tokenizer) u32 {
        const c = this.nextChar();
        const len_utf8 = lenUtf8(c);
        this.position += len_utf8;
        // Note that due to the special case for the 4-byte sequence
        // intro, we must use wrapping add here.
        this.current_line_start_position +%= len_utf8 - lenUtf16(c);
        return c;
    }

    fn lenUtf8(code: u32) usize {
        if (code < MAX_ONE_B) {
            return 1;
        } else if (code < MAX_TWO_B) {
            return 2;
        } else if (code < MAX_THREE_B) {
            return 3;
        } else {
            return 4;
        }
    }

    fn lenUtf16(ch: u32) usize {
        if ((ch & 0xFFFF) == ch) {
            return 1;
        } else {
            return 2;
        }
    }

    fn byteToHexDigit(b: u8) ?u32 {

        // todo_stuff.match_byte
        return switch (b) {
            '0'...'9' => b - '0',
            'a'...'f' => b - 'a' + 10,
            'A'...'F' => b - 'A' + 10,
            else => null,
        };
    }

    fn byteToDecimalDigit(b: u8) ?u32 {
        if (b >= '0' and b <= '9') {
            return b - '0';
        }
        return null;
    }

    pub fn consumeComment(this: *Tokenizer) []const u8 {
        this.advance(2);
        const start_position = this.position;
        while (!this.isEof()) {
            const b = this.nextByteUnchecked();
            // todo_stuff.match_byte
            switch (b) {
                '*' => {
                    const end_position = this.position;
                    this.advance(1);
                    if (this.nextByte() == '/') {
                        this.advance(1);
                        const contents = this.src[start_position..end_position];
                        this.checkForSourceMap(contents);
                        return contents;
                    }
                },
                '\n', FORM_FEED_BYTE, '\r' => {
                    this.consumeNewline();
                },
                0x80...0xBF => this.consumeContinuationByte(),
                0xF0...0xFF => this.consume4byteIntro(),
                else => {
                    // ASCII or other leading byte
                    this.advance(1);
                },
            }
        }
        const contents = this.sliceFrom(start_position);
        this.checkForSourceMap(contents);
        return contents;
    }

    pub fn checkForSourceMap(this: *Tokenizer, contents: []const u8) void {
        {
            const directive = "# sourceMappingURL=";
            const directive_old = "@ sourceMappingURL=";
            if (std.mem.startsWith(u8, contents, directive) or std.mem.startsWith(u8, contents, directive_old)) {
                this.source_map_url = splitSourceMap(contents[directive.len..]);
            }
        }

        {
            const directive = "# sourceURL=";
            const directive_old = "@ sourceURL=";
            if (std.mem.startsWith(u8, contents, directive) or std.mem.startsWith(u8, contents, directive_old)) {
                this.source_map_url = splitSourceMap(contents[directive.len..]);
            }
        }
    }

    pub fn splitSourceMap(contents: []const u8) ?[]const u8 {
        // FIXME: Use bun CodepointIterator
        var iter = std.unicode.Utf8Iterator{ .bytes = contents, .i = 0 };
        while (iter.nextCodepoint()) |c| {
            switch (c) {
                ' ', '\t', FORM_FEED_BYTE, '\r', '\n' => {
                    const start = 0;
                    const end = iter.i;
                    return contents[start..end];
                },
                else => {},
            }
        }
        return null;
    }

    pub fn consumeNewline(this: *Tokenizer) void {
        const byte = this.nextByteUnchecked();
        if (bun.Environment.allow_assert) {
            std.debug.assert(byte == '\r' or byte == '\n' or byte == FORM_FEED_BYTE);
        }
        this.position += 1;
        if (byte == '\r' and this.nextByte() == '\n') {
            this.position += 1;
        }
        this.current_line_start_position = this.position;
        this.current_line_number += 1;
    }

    /// Advance over a single byte; the byte must be a UTF-8
    /// continuation byte.
    ///
    /// Binary    Hex          Comments
    /// 0xxxxxxx  0x00..0x7F   Only byte of a 1-byte character encoding
    /// 110xxxxx  0xC0..0xDF   First byte of a 2-byte character encoding
    /// 1110xxxx  0xE0..0xEF   First byte of a 3-byte character encoding
    /// 11110xxx  0xF0..0xF7   First byte of a 4-byte character encoding
    /// 10xxxxxx  0x80..0xBF   Continuation byte: one of 1-3 bytes following the first <--
    pub fn consumeContinuationByte(this: *Tokenizer) void {
        if (bun.Environment.allow_assert) std.debug.assert(this.nextByteUnchecked() & 0xC0 == 0x80);
        // Continuation bytes contribute to column overcount. Note
        // that due to the special case for the 4-byte sequence intro,
        // we must use wrapping add here.
        this.current_line_start_position +%= 1;
        this.position += 1;
    }

    /// Advance over a single byte; the byte must be a UTF-8 sequence
    /// leader for a 4-byte sequence.
    ///
    /// Binary    Hex          Comments
    /// 0xxxxxxx  0x00..0x7F   Only byte of a 1-byte character encoding
    /// 110xxxxx  0xC0..0xDF   First byte of a 2-byte character encoding
    /// 1110xxxx  0xE0..0xEF   First byte of a 3-byte character encoding
    /// 11110xxx  0xF0..0xF7   First byte of a 4-byte character encoding <--
    /// 10xxxxxx  0x80..0xBF   Continuation byte: one of 1-3 bytes following the first
    pub fn consume4byteIntro(this: *Tokenizer) void {
        if (bun.Environment.allow_assert) std.debug.assert(this.nextByteUnchecked() & 0xF0 == 0xF0);
        // This takes two UTF-16 characters to represent, so we
        // actually have an undercount.
        // this.current_line_start_position = self.current_line_start_position.wrapping_sub(1);
        this.current_line_start_position -%= 1;
        this.position += 1;
    }

    pub fn isIdentStart(this: *Tokenizer) bool {

        // todo_stuff.match_byte
        return !this.isEof() and switch (this.nextByteUnchecked()) {
            'a'...'z', 'A'...'Z', '_', 0 => true,

            // todo_stuff.match_byte
            '-' => this.hasAtLeast(1) and switch (this.byteAt(1)) {
                'a'...'z', 'A'...'Z', '-', '_', 0 => true,
                '\\' => !this.hasNewlineAt(1),
                else => |b| !std.ascii.isASCII(b),
            },
            '\\' => !this.hasNewlineAt(1),
            else => |b| !std.ascii.isASCII(b),
        };
    }

    /// If true, the input has at least `n` bytes left *after* the current one.
    /// That is, `tokenizer.char_at(n)` will not panic.
    fn hasAtLeast(this: *Tokenizer, n: usize) bool {
        return this.position + n < this.src.len;
    }

    fn hasNewlineAt(this: *Tokenizer, offset: usize) bool {
        return this.position + offset < this.src.len and switch (this.byteAt(offset)) {
            '\n', '\r', FORM_FEED_BYTE => true,
            else => false,
        };
    }

    pub fn startsWith(this: *Tokenizer, comptime needle: []const u8) bool {
        return std.mem.eql(u8, this.src[this.position .. this.position + needle.len], needle);
    }

    /// Advance over N bytes in the input.  This function can advance
    /// over ASCII bytes (excluding newlines), or UTF-8 sequence
    /// leaders (excluding leaders for 4-byte sequences).
    pub fn advance(this: *Tokenizer, n: usize) void {
        if (bun.Environment.allow_assert) {
            // Each byte must either be an ASCII byte or a sequence
            // leader, but not a 4-byte leader; also newlines are
            // rejected.
            for (0..n) |i| {
                const b = this.byteAt(i);
                std.debug.assert(std.ascii.isASCII(b) or (b & 0xF0 != 0xF0 and b & 0xC0 != 0x80));
                std.debug.assert(b != '\r' and b != '\n' and b != '\x0C');
            }
        }
        this.position += n;
    }

    /// Advance over any kind of byte, excluding newlines.
    pub fn consumeKnownByte(this: *Tokenizer, byte: u8) void {
        if (bun.Environment.allow_assert) std.debug.assert(byte != '\r' and byte != '\n' and byte != FORM_FEED_BYTE);
        this.position += 1;
        // Continuation bytes contribute to column overcount.
        if (byte & 0xF0 == 0xF0) {
            // This takes two UTF-16 characters to represent, so we
            // actually have an undercount.
            this.current_line_start_position -%= 1;
        } else if (byte & 0xC0 == 0x80) {
            // Note that due to the special case for the 4-byte
            // sequence intro, we must use wrapping add here.
            this.current_line_start_position +%= 1;
        }
    }

    pub inline fn byteAt(this: *Tokenizer, n: usize) u8 {
        return this.src[this.position + n];
    }

    pub inline fn nextByte(this: *Tokenizer) ?u8 {
        if (this.isEof()) return null;
        return this.src[this.position];
    }

    pub inline fn nextChar(this: *Tokenizer) u32 {
        const len = bun.strings.utf8ByteSequenceLength(this.src[this.position]);
        return bun.strings.decodeWTF8RuneT(this.src[this.position].ptr[0..4], len, u32, bun.strings.unicode_replacement);
    }

    pub inline fn nextByteUnchecked(this: *Tokenizer) u8 {
        return this.src[this.position];
    }

    pub inline fn sliceFrom(this: *Tokenizer, start: usize) []const u8 {
        return this.src[start..this.position];
    }
};

const TokenKind = enum {
    /// An [<ident-token>](https://drafts.csswg.org/css-syntax/#typedef-ident-token)
    ident,

    /// Value is the ident
    function,

    /// Value is the ident
    at_keyword,

    /// A [`<hash-token>`](https://drafts.csswg.org/css-syntax/#hash-token-diagram) with the type flag set to "unrestricted"
    ///
    /// The value does not include the `#` marker.
    hash,

    /// A [`<hash-token>`](https://drafts.csswg.org/css-syntax/#hash-token-diagram) with the type flag set to "id"
    ///
    /// The value does not include the `#` marker.
    idhash,

    string,

    bad_string,

    /// `url(<string-token>)` is represented by a `.function` token
    unquoted_url,

    bad_url,

    /// Value of a single codepoint
    delim,

    /// A <number-token> can be fractional or an integer, and can contain an optional + or - sign
    number,

    percentage,

    dimension,

    /// [<unicode-range-token>](https://drafts.csswg.org/css-syntax/#typedef-unicode-range-token)
    /// FIXME: this is not complete
    unicode_range,

    whitespace,

    /// `<!---`
    cdo,

    /// `-->`
    cdc,

    /// `~=` (https://www.w3.org/TR/selectors-4/#attribute-representation)
    include_match,

    /// `|=` (https://www.w3.org/TR/selectors-4/#attribute-representation)
    dash_match,

    /// `^=` (https://www.w3.org/TR/selectors-4/#attribute-substrings)
    prefix_match,

    /// `$=`(https://www.w3.org/TR/selectors-4/#attribute-substrings)
    suffix_match,

    /// `*=` (https://www.w3.org/TR/selectors-4/#attribute-substrings)
    substring_match,

    colon,
    semicolon,
    comma,
    open_square,
    close_square,
    open_paren,
    close_paren,
    open_curly,
    close_curly,

    /// Not an actual token in the spec, but we keep it anyway
    comment,

    eof,

    pub fn toString(this: TokenKind) []const u8 {
        return switch (this) {
            .eof => "end of file",
            .at_keyword => "@-keyword",
            .bad_string => "bad string token",
            .bad_url => "bad URL token",
            .cdc => "\"-->\"",
            .cdo => "\"<!--\"",
            .close_curly => "\"}\"",
            .close_bracket => "\"]\"",
            .close_paren => "\")\"",
            .colon => "\":\"",
            .comma => "\",\"",
            // TODO esbuild has additional delimiter tokens (e.g. TDelimAmpersand), should we?
            .delim => |c| switch (c) {
                '&' => "\"&\"",
                '*' => "\"*\"",
                '|' => "\"|\"",
                '^' => "\"^\"",
                '$' => "\"$\"",
                '.' => "\".\"",
                '=' => "\"=\"",
                '!' => "\"!\"",
                '>' => "\">\"",
                '-' => "\"-\"",
                '+' => "\"+\"",
                '/' => "\"/\"",
                '~' => "\"~\"",
                else => "delimiter",
            },
            .dimension => "dimension",
            .function => "function token",
            .hash => "hash token",
            .ident => "identifier",
            .number => "number",
            .open_curly => "\"{\"",
            .open_square => "\"[\"",
            .open_paren => "\"(\"",
            .percentage => "percentage",
            .semicolon => "\";\"",
            .string => "string token",
            .unquoted_url => "URL token",
            .whitespace => "whitespace",
            // TODO: esbuild does this, should we?
            // .TSymbol => "identifier",
        };
    }
};

// TODO: make strings be allocated in string pool
pub const Token = union(TokenKind) {
    /// An [<ident-token>](https://drafts.csswg.org/css-syntax/#typedef-ident-token)
    ident: []const u8,

    /// Value is the ident
    function: []const u8,

    /// Value is the ident
    at_keyword: []const u8,

    /// A [`<hash-token>`](https://drafts.csswg.org/css-syntax/#hash-token-diagram) with the type flag set to "unrestricted"
    ///
    /// The value does not include the `#` marker.
    hash: []const u8,

    /// A [`<hash-token>`](https://drafts.csswg.org/css-syntax/#hash-token-diagram) with the type flag set to "id"
    ///
    /// The value does not include the `#` marker.
    idhash: []const u8,

    /// A [`<string-token>`](https://drafts.csswg.org/css-syntax/#string-token-diagram)
    ///
    /// The value does not include the quotes.
    string: []const u8,

    bad_string: []const u8,

    /// `url(<string-token>)` is represented by a `.function` token
    unquoted_url: []const u8,

    bad_url: []const u8,

    /// Value of a single codepoint
    delim: u32,

    /// A <number-token> can be fractional or an integer, and can contain an optional + or - sign
    number: Num,

    percentage: struct {
        has_sign: bool,
        unit_value: f32,
        int_value: ?i32,
    },

    dimension: Dimension,

    /// [<unicode-range-token>](https://drafts.csswg.org/css-syntax/#typedef-unicode-range-token)
    /// FIXME: this is not complete
    unicode_range: struct {
        start: u32,
        end: ?u32,
    },

    whitespace: []const u8,

    /// `<!---`
    cdo,

    /// `-->`
    cdc,

    /// `~=` (https://www.w3.org/TR/selectors-4/#attribute-representation)
    include_match,

    /// `|=` (https://www.w3.org/TR/selectors-4/#attribute-representation)
    dash_match,

    /// `^=` (https://www.w3.org/TR/selectors-4/#attribute-substrings)
    prefix_match,

    /// `$=`(https://www.w3.org/TR/selectors-4/#attribute-substrings)
    suffix_match,

    /// `*=` (https://www.w3.org/TR/selectors-4/#attribute-substrings)
    substring_match,

    colon,
    semicolon,
    comma,
    open_square,
    close_square,
    open_paren,
    close_paren,
    open_curly,
    close_curly,

    /// Not an actual token in the spec, but we keep it anyway
    comment: []const u8,

    eof,

    /// Return whether this token represents a parse error.
    ///
    /// `BadUrl` and `BadString` are tokenizer-level parse errors.
    ///
    /// `CloseParenthesis`, `CloseSquareBracket`, and `CloseCurlyBracket` are *unmatched*
    /// and therefore parse errors when returned by one of the `Parser::next*` methods.
    pub fn isParseError(this: *const Token) bool {
        return switch (this.*) {
            .bad_url, .bad_string, .close_paren, .close_square, .close_curly => true,
            else => false,
        };
    }

    pub fn raw(this: Token) []const u8 {
        return switch (this) {
            .ident => this.ident,
            // .function =>
        };
    }

    pub inline fn kind(this: Token) TokenKind {
        return @as(TokenKind, this);
    }

    pub inline fn kindString(this: Token) []const u8 {
        return this.kind.toString();
    }

    // ~toCssImpl
    const This = @This();

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @compileError(todo_stuff.depth);
    }
};

const Num = struct {
    has_sign: bool,
    value: f32,
    int_value: ?i32,
};

const Dimension = struct {
    num: Num,
    /// e.g. "px"
    unit: []const u8,
};

const CopyOnWriteStr = union(enum) {
    borrowed: []const u8,
    owned: std.ArrayList(u8),

    pub fn append(this: *@This(), allocator: Allocator, slice: []const u8) void {
        switch (this.*) {
            .borrowed => {
                var list = std.ArrayList(u8).initCapacity(allocator, this.borrowed.len + slice.len) catch bun.outOfMemory();
                list.appendSliceAssumeCapacity(this.borrowed);
                list.appendSliceAssumeCapacity(slice);
                this.* = .{ .owned = list };
            },
            .owned => {
                this.owned.appendSlice(slice) catch bun.outOfMemory();
            },
        }
    }

    pub fn toSlice(this: *@This()) []const u8 {
        return switch (this.*) {
            .borrowed => this.borrowed,
            .owned => this.owned.items[0..],
        };
    }
};

pub const color = struct {
    /// The opaque alpha value of 1.0.
    pub const OPAQUE: f32 = 1.0;

    const ColorError = error{
        parse,
    };

    /// Either an angle or a number.
    pub const AngleOrNumber = union(enum) {
        /// `<number>`.
        number: struct {
            /// The numeric value parsed, as a float.
            value: f32,
        },
        /// `<angle>`
        angle: struct {
            /// The value as a number of degrees.
            degrees: f32,
        },
    };

    pub const named_colors = named_colors: {
        {
            break :named_colors;
        }
        const defined_colors = .{
            "black",                .{ 0, 0, 0 },
            "silver",               .{ 192, 192, 192 },
            "gray",                 .{ 128, 128, 128 },
            "white",                .{ 255, 255, 255 },
            "maroon",               .{ 128, 0, 0 },
            "red",                  .{ 255, 0, 0 },
            "purple",               .{ 128, 0, 128 },
            "fuchsia",              .{ 255, 0, 255 },
            "green",                .{ 0, 128, 0 },
            "lime",                 .{ 0, 255, 0 },
            "olive",                .{ 128, 128, 0 },
            "yellow",               .{ 255, 255, 0 },
            "navy",                 .{ 0, 0, 128 },
            "blue",                 .{ 0, 0, 255 },
            "teal",                 .{ 0, 128, 128 },
            "aqua",                 .{ 0, 255, 255 },

            "aliceblue",            .{ 240, 248, 255 },
            "antiquewhite",         .{ 250, 235, 215 },
            "aquamarine",           .{ 127, 255, 212 },
            "azure",                .{ 240, 255, 255 },
            "beige",                .{ 245, 245, 220 },
            "bisque",               .{ 255, 228, 196 },
            "blanchedalmond",       .{ 255, 235, 205 },
            "blueviolet",           .{ 138, 43, 226 },
            "brown",                .{ 165, 42, 42 },
            "burlywood",            .{ 222, 184, 135 },
            "cadetblue",            .{ 95, 158, 160 },
            "chartreuse",           .{ 127, 255, 0 },
            "chocolate",            .{ 210, 105, 30 },
            "coral",                .{ 255, 127, 80 },
            "cornflowerblue",       .{ 100, 149, 237 },
            "cornsilk",             .{ 255, 248, 220 },
            "crimson",              .{ 220, 20, 60 },
            "cyan",                 .{ 0, 255, 255 },
            "darkblue",             .{ 0, 0, 139 },
            "darkcyan",             .{ 0, 139, 139 },
            "darkgoldenrod",        .{ 184, 134, 11 },
            "darkgray",             .{ 169, 169, 169 },
            "darkgreen",            .{ 0, 100, 0 },
            "darkgrey",             .{ 169, 169, 169 },
            "darkkhaki",            .{ 189, 183, 107 },
            "darkmagenta",          .{ 139, 0, 139 },
            "darkolivegreen",       .{ 85, 107, 47 },
            "darkorange",           .{ 255, 140, 0 },
            "darkorchid",           .{ 153, 50, 204 },
            "darkred",              .{ 139, 0, 0 },
            "darksalmon",           .{ 233, 150, 122 },
            "darkseagreen",         .{ 143, 188, 143 },
            "darkslateblue",        .{ 72, 61, 139 },
            "darkslategray",        .{ 47, 79, 79 },
            "darkslategrey",        .{ 47, 79, 79 },
            "darkturquoise",        .{ 0, 206, 209 },
            "darkviolet",           .{ 148, 0, 211 },
            "deeppink",             .{ 255, 20, 147 },
            "deepskyblue",          .{ 0, 191, 255 },
            "dimgray",              .{ 105, 105, 105 },
            "dimgrey",              .{ 105, 105, 105 },
            "dodgerblue",           .{ 30, 144, 255 },
            "firebrick",            .{ 178, 34, 34 },
            "floralwhite",          .{ 255, 250, 240 },
            "forestgreen",          .{ 34, 139, 34 },
            "gainsboro",            .{ 220, 220, 220 },
            "ghostwhite",           .{ 248, 248, 255 },
            "gold",                 .{ 255, 215, 0 },
            "goldenrod",            .{ 218, 165, 32 },
            "greenyellow",          .{ 173, 255, 47 },
            "grey",                 .{ 128, 128, 128 },
            "honeydew",             .{ 240, 255, 240 },
            "hotpink",              .{ 255, 105, 180 },
            "indianred",            .{ 205, 92, 92 },
            "indigo",               .{ 75, 0, 130 },
            "ivory",                .{ 255, 255, 240 },
            "khaki",                .{ 240, 230, 140 },
            "lavender",             .{ 230, 230, 250 },
            "lavenderblush",        .{ 255, 240, 245 },
            "lawngreen",            .{ 124, 252, 0 },
            "lemonchiffon",         .{ 255, 250, 205 },
            "lightblue",            .{ 173, 216, 230 },
            "lightcoral",           .{ 240, 128, 128 },
            "lightcyan",            .{ 224, 255, 255 },
            "lightgoldenrodyellow", .{ 250, 250, 210 },
            "lightgray",            .{ 211, 211, 211 },
            "lightgreen",           .{ 144, 238, 144 },
            "lightgrey",            .{ 211, 211, 211 },
            "lightpink",            .{ 255, 182, 193 },
            "lightsalmon",          .{ 255, 160, 122 },
            "lightseagreen",        .{ 32, 178, 170 },
            "lightskyblue",         .{ 135, 206, 250 },
            "lightslategray",       .{ 119, 136, 153 },
            "lightslategrey",       .{ 119, 136, 153 },
            "lightsteelblue",       .{ 176, 196, 222 },
            "lightyellow",          .{ 255, 255, 224 },
            "limegreen",            .{ 50, 205, 50 },
            "linen",                .{ 250, 240, 230 },
            "magenta",              .{ 255, 0, 255 },
            "mediumaquamarine",     .{ 102, 205, 170 },
            "mediumblue",           .{ 0, 0, 205 },
            "mediumorchid",         .{ 186, 85, 211 },
            "mediumpurple",         .{ 147, 112, 219 },
            "mediumseagreen",       .{ 60, 179, 113 },
            "mediumslateblue",      .{ 123, 104, 238 },
            "mediumspringgreen",    .{ 0, 250, 154 },
            "mediumturquoise",      .{ 72, 209, 204 },
            "mediumvioletred",      .{ 199, 21, 133 },
            "midnightblue",         .{ 25, 25, 112 },
            "mintcream",            .{ 245, 255, 250 },
            "mistyrose",            .{ 255, 228, 225 },
            "moccasin",             .{ 255, 228, 181 },
            "navajowhite",          .{ 255, 222, 173 },
            "oldlace",              .{ 253, 245, 230 },
            "olivedrab",            .{ 107, 142, 35 },
            "orange",               .{ 255, 165, 0 },
            "orangered",            .{ 255, 69, 0 },
            "orchid",               .{ 218, 112, 214 },
            "palegoldenrod",        .{ 238, 232, 170 },
            "palegreen",            .{ 152, 251, 152 },
            "paleturquoise",        .{ 175, 238, 238 },
            "palevioletred",        .{ 219, 112, 147 },
            "papayawhip",           .{ 255, 239, 213 },
            "peachpuff",            .{ 255, 218, 185 },
            "peru",                 .{ 205, 133, 63 },
            "pink",                 .{ 255, 192, 203 },
            "plum",                 .{ 221, 160, 221 },
            "powderblue",           .{ 176, 224, 230 },
            "rebeccapurple",        .{ 102, 51, 153 },
            "rosybrown",            .{ 188, 143, 143 },
            "royalblue",            .{ 65, 105, 225 },
            "saddlebrown",          .{ 139, 69, 19 },
            "salmon",               .{ 250, 128, 114 },
            "sandybrown",           .{ 244, 164, 96 },
            "seagreen",             .{ 46, 139, 87 },
            "seashell",             .{ 255, 245, 238 },
            "sienna",               .{ 160, 82, 45 },
            "skyblue",              .{ 135, 206, 235 },
            "slateblue",            .{ 106, 90, 205 },
            "slategray",            .{ 112, 128, 144 },
            "slategrey",            .{ 112, 128, 144 },
            "snow",                 .{ 255, 250, 250 },
            "springgreen",          .{ 0, 255, 127 },
            "steelblue",            .{ 70, 130, 180 },
            "tan",                  .{ 210, 180, 140 },
            "thistle",              .{ 216, 191, 216 },
            "tomato",               .{ 255, 99, 71 },
            "turquoise",            .{ 64, 224, 208 },
            "violet",               .{ 238, 130, 238 },
            "wheat",                .{ 245, 222, 179 },
            "whitesmoke",           .{ 245, 245, 245 },
            "yellowgreen",          .{ 154, 205, 50 },
        };
        @compileLog(defined_colors);
        @compileError(todo_stuff.depth);
    };

    /// Returns the named color with the given name.
    /// <https://drafts.csswg.org/css-color-4/#typedef-named-color>
    pub fn parseNamedColor(ident: []const u8) ?struct { u8, u8, u8 } {
        _ = ident; // autofix
        @compileError(todo_stuff.depth);
    }

    /// Parse a color hash, without the leading '#' character.
    pub fn parseHashColor(value: []const u8) ?struct { u8, u8, u8, f32 } {
        return parseHashColorImpl(value) catch return null;
    }

    pub fn parseHashColorImpl(value: []const u8) ColorError!struct { u8, u8, u8, f32 } {
        return switch (value.len) {
            8 => .{
                (try fromHex(value[0])) * 16 + (try fromHex(value[1])),
                (try fromHex(value[2])) * 16 + (try fromHex(value[3])),
                (try fromHex(value[4])) * 16 + (try fromHex(value[5])),
                @as(f32, (try fromHex(value[6])) * 16 + (try fromHex(value[7]))) / 255.0,
            },
            6 => .{
                (try fromHex(value[0])) * 16 + (try fromHex(value[1])),
                (try fromHex(value[2])) * 16 + (try fromHex(value[3])),
                (try fromHex(value[4])) * 16 + (try fromHex(value[5])),
                OPAQUE,
            },
            4 => .{
                (try fromHex(value[0])) * 17,
                (try fromHex(value[1])) * 17,
                (try fromHex(value[2])) * 17,
                @as(f32, @intCast((try fromHex(value[3])) * 17)) / 255.0,
            },
            3 => .{
                (try fromHex(value[0])) * 17,
                (try fromHex(value[1])) * 17,
                (try fromHex(value[2])) * 17,
                OPAQUE,
            },
            else => ColorError.parse,
        };
    }

    pub fn fromHex(c: u8) ColorError!u8 {
        return switch (c) {
            '0'...'9' => c - '0',
            'a'...'f' => c - 'a' + 10,
            'A'...'F' => c - 'A' + 10,
            else => ColorError.parse,
        };
    }
};

pub const enum_property = struct {
    pub fn as_str(comptime T: type, val: T) []const u8 {
        _ = val; // autofix
        @compileError(todo_stuff.depth);
    }
};

pub const comptime_parse = struct {
    pub fn parse(comptime T: type, input: *Parser) Error!T {
        _ = input; // autofix
        @compileError(todo_stuff.depth);
    }
};

/// A parser error.
pub const ParserError = union(enum) {
    /// An at rule body was invalid.
    at_rule_body_invalid,
    /// An at rule prelude was invalid.
    at_rule_prelude_invalid,
    /// An unknown or unsupported at rule was encountered.
    at_rule_invalid: []const u8,
    /// Unexpectedly encountered the end of input data.
    end_of_input,
    /// A declaration was invalid.
    invalid_declaration,
    /// A media query was invalid.
    invalid_media_query,
    /// Invalid CSS nesting.
    invalid_nesting,
    /// The @nest rule is deprecated.
    deprecated_nest_rule,
    /// An invalid selector in an `@page` rule.
    invalid_page_selector,
    /// An invalid value was encountered.
    invalid_value,
    /// Invalid qualified rule.
    qualified_rule_invalid,
    /// A selector was invalid.
    selector_error: SelectorError,
    /// An `@import` rule was encountered after any rule besides `@charset` or `@layer`.
    unexpected_import_rule,
    /// A `@namespace` rule was encountered after any rules besides `@charset`, `@import`, or `@layer`.
    unexpected_namespace_rule,
    /// An unexpected token was encountered.
    unexpected_token: Token,
    /// Maximum nesting depth was reached.
    maximum_nesting_depth,
};

/// A selector parsing error.
pub const SelectorError = union(enum) {
    /// An unexpected token was found in an attribute selector.
    bad_value_in_attr: Token,
    /// An unexpected token was found in a class selector.
    class_needs_ident: Token,
    /// A dangling combinator was found.
    dangling_combinator,
    /// An empty selector.
    empty_selector,
    /// A `|` was expected in an attribute selector.
    expected_bar_in_attr: Token,
    /// A namespace was expected.
    expected_namespace: []const u8,
    /// An unexpected token was encountered in a namespace.
    explicit_namespace_unexpected_token: Token,
    /// An invalid pseudo class was encountered after a pseudo element.
    invalid_pseudo_class_after_pseudo_element,
    /// An invalid pseudo class was encountered after a `-webkit-scrollbar` pseudo element.
    invalid_pseudo_class_after_webkit_scrollbar,
    /// A `-webkit-scrollbar` state was encountered before a `-webkit-scrollbar` pseudo element.
    invalid_pseudo_class_before_webkit_scrollbar,
    /// Invalid qualified name in attribute selector.
    invalid_qual_name_in_attr: Token,
    /// The current token is not allowed in this state.
    invalid_state,
    /// The selector is required to have the `&` nesting selector at the start.
    missing_nesting_prefix,
    /// The selector is missing a `&` nesting selector.
    missing_nesting_selector,
    /// No qualified name in attribute selector.
    no_qualified_name_in_attribute_selector: Token,
    /// An invalid token was encountered in a pseudo element.
    pseudo_element_expected_ident: Token,
    /// An unexpected identifier was encountered.
    unexpected_ident: []const u8,
    /// An unexpected token was encountered inside an attribute selector.
    unexpected_token_in_attribute_selector: Token,
    /// An unsupported pseudo class or pseudo element was encountered.
    unsupported_pseudo_class_or_element: []const u8,
};

// pub const Bitflags

pub const serializer = struct {
    /// Write a CSS name, like a custom property name.
    ///
    /// You should only use this when you know what you're doing, when in doubt,
    /// consider using `serialize_identifier`.
    pub fn serializeName(value: []const u8, comptime W: type, dest: *W) !void {
        _ = value; // autofix
        _ = dest; // autofix
        @compileError(todo_stuff.depth);
    }

    /// Write a double-quoted CSS string token, escaping content as necessary.
    pub fn serializeString(value: []const u8, comptime W: type, dest: *W) !void {
        _ = value; // autofix
        _ = dest; // autofix
        @compileError(todo_stuff.depth);
    }

    pub fn serializeDimension(value: f32, unit: []const u8, comptime W: type, dest: *W) PrintErr!void {
        _ = value; // autofix
        _ = unit; // autofix
        _ = dest; // autofix
        @compileError(todo_stuff.depth);
    }

    /// Write a CSS identifier, escaping characters as necessary.
    pub fn serializeIdentifier(value: []const u8, comptime W: type, dest: *W) PrintErr!void {
        _ = value; // autofix
        _ = dest; // autofix
        @compileError(todo_stuff.depth);
    }
};

pub const parse_utility = struct {
    /// Parse a value from a string.
    ///
    /// (This is a convenience wrapper for `parse` and probably should not be overridden.)
    ///
    /// NOTE: `input` should live as long as the returned value. Otherwise, strings in the
    /// returned parsed value will point to undefined memory.
    pub fn parseString(
        allocator: Allocator,
        comptime T: type,
        input: []const u8,
        comptime parse_one: *const fn (*Parser) Error!T,
    ) Error!T {
        var i = ParserInput.new(allocator, input);
        var parser = Parser.new(&i);
        const result = try parse_one(&parser);
        try parser.expectExhausted();
        return result;
    }
};

pub const to_css = struct {
    /// Serialize `self` in CSS syntax and return a string.
    ///
    /// (This is a convenience wrapper for `to_css` and probably should not be overridden.)
    pub fn string(allocator: Allocator, comptime T: type, this: *T, options: PrinterOptions) PrintErr![]const u8 {
        var s = ArrayList(u8){};
        const writer = s.writer(allocator);
        const W = @TypeOf(writer);
        var printer = Printer(W).new(allocator, writer, options);
        defer printer.deinit();
        switch (T) {
            CSSString => try CSSStringFns.toCss(W, printer),
            else => try this.toCss(W, printer),
        }
        return s;
    }

    pub fn fromList(comptime T: type, this: *const ArrayList(T), comptime W: type, dest: *Printer(W)) PrintErr!void {
        const len = this.items.len;
        for (this.items, 0..) |*val, idx| {
            try val.toCss(W, dest);
            if (idx < len - 1) {
                try dest.delim(',', false);
            }
        }
    }

    pub fn integer(comptime T: type, this: T, comptime W: type, dest: *Printer(W)) PrintErr!void {
        const MAX_LEN = comptime maxDigits(T);
        var buf: [MAX_LEN]u8 = undefined;
        const str = std.fmt.bufPrint(buf[0..], "{d}", .{this}) catch unreachable;
        try dest.writeStr(str);
    }

    fn maxDigits(comptime T: type) usize {
        const max_val = std.math.maxInt(T);
        return std.fmt.count("{d}", .{max_val});
    }
};
