const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("./css_parser.zig");
pub const css_values = @import("./values/values.zig");
const DashedIdent = css_values.ident.DashedIdent;
const Ident = css_values.ident.Ident;
pub const Error = css.Error;
const Location = css.Location;

const ArrayList = std.ArrayListUnmanaged;

/// A printer error.
pub const PrinterError = Err(PrinterErrorKind);

pub fn fmtPrinterError() PrinterError {
    return .{
        .kind = .fmt_error,
        .loc = null,
    };
}

/// An error with a source location.
pub fn Err(comptime T: type) type {
    return struct {
        /// The type of error that occurred.
        kind: T,
        /// The location where the error occurred.
        loc: ?ErrorLocation,

        pub fn fromParseError(err: ParseError(ParserError), filename: []const u8) Err(ParserError) {
            if (T != ParserError) {
                @compileError("Called .fromParseError() when T is not ParserError");
            }

            const kind = switch (err.kind) {
                .basic => |b| switch (b) {
                    .unexpected_token => |t| ParserError{ .unexpected_token = t },
                    .end_of_input => ParserError.end_of_input,
                    .at_rule_invalid => |a| ParserError{ .at_rule_invalid = a },
                    .at_rule_body_invalid => ParserError.at_rule_body_invalid,
                    .qualified_rule_invalid => ParserError.qualified_rule_invalid,
                },
                .custom => |c| c,
            };

            return .{
                .kind = kind,
                .loc = ErrorLocation{
                    .filename = filename,
                    .line = err.location.line,
                    .column = err.location.column,
                },
            };
        }
    };
}

/// Extensible parse errors that can be encountered by client parsing implementations.
pub fn ParseError(comptime T: type) type {
    return struct {
        /// Details of this error
        kind: ParserErrorKind(T),
        /// Location where this error occurred
        location: css.SourceLocation,

        pub fn basic(this: @This()) BasicParseError {
            return switch (this.kind) {
                .basic => |kind| BasicParseError{
                    .kind = kind,
                    .location = this.location,
                },
                .custom => @panic("Not a basic parse error. This is a bug in Bun's css parser."),
            };
        }
    };
}

pub fn ParserErrorKind(comptime T: type) type {
    return union(enum) {
        /// A fundamental parse error from a built-in parsing routine.
        basic: BasicParseErrorKind,
        /// A parse error reported by downstream consumer code.
        custom: T,

        pub fn format(this: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            return switch (this) {
                .basic => |basic| writer.print("basic: {}", .{basic}),
                .custom => |custom| writer.print("custom: {}", .{custom}),
            };
        }
    };
}

/// Details about a `BasicParseError`
pub const BasicParseErrorKind = union(enum) {
    /// An unexpected token was encountered.
    unexpected_token: css.Token,
    /// The end of the input was encountered unexpectedly.
    end_of_input,
    /// An `@` rule was encountered that was invalid.
    at_rule_invalid: []const u8,
    /// The body of an '@' rule was invalid.
    at_rule_body_invalid,
    /// A qualified rule was encountered that was invalid.
    qualified_rule_invalid,

    pub fn format(this: *const BasicParseErrorKind, comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
        _ = fmt; // autofix
        _ = opts; // autofix
        return switch (this.*) {
            .unexpected_token => |token| {
                try writer.print("unexpected token: {}", .{token});
            },
            .end_of_input => {
                try writer.print("unexpected end of input", .{});
            },
            .at_rule_invalid => |rule| {
                try writer.print("invalid @ rule encountered: '@{s}'", .{rule});
            },
            .at_rule_body_invalid => {
                // try writer.print("invalid @ body rule encountered: '@{s}'", .{});
                try writer.print("invalid @ body rule encountered", .{});
            },
            .qualified_rule_invalid => {
                try writer.print("invalid qualified rule encountered", .{});
            },
        };
    }
};

/// A line and column location within a source file.
pub const ErrorLocation = struct {
    /// The filename in which the error occurred.
    filename: []const u8,
    /// The line number, starting from 0.
    line: u32,
    /// The column number, starting from 1.
    column: u32,

    pub fn withFilename(this: ErrorLocation, filename: []const u8) ErrorLocation {
        return ErrorLocation{
            .filename = filename,
            .line = this.line,
            .column = this.column,
        };
    }

    pub fn format(this: *const @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        try writer.print("{s}:{d}:{d}", .{ this.filename, this.line, this.column });
    }
};

/// A printer error type.
pub const PrinterErrorKind = union(enum) {
    /// An ambiguous relative `url()` was encountered in a custom property declaration.
    ambiguous_url_in_custom_property: struct {
        /// The ambiguous URL.
        url: []const u8,
    },
    /// A [std::fmt::Error](std::fmt::Error) was encountered in the underlying destination.
    fmt_error,
    /// The CSS modules `composes` property cannot be used within nested rules.
    invalid_composes_nesting,
    /// The CSS modules `composes` property cannot be used with a simple class selector.
    invalid_composes_selector,
    /// The CSS modules pattern must end with `[local]` for use in CSS grid.
    invalid_css_modules_pattern_in_grid,
    no_import_records,
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
    unexpected_token: css.Token,
    /// Maximum nesting depth was reached.
    maximum_nesting_depth,

    pub fn format(this: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        return switch (this) {
            .at_rule_invalid => |name| writer.print("at_rule_invalid: {s}", .{name}),
            .unexpected_token => |token| writer.print("unexpected_token: {}", .{token}),
            .selector_error => |err| writer.print("selector_error: {}", .{err}),
            else => writer.print("{s}", .{@tagName(this)}),
        };
    }
};

/// The fundamental parsing errors that can be triggered by built-in parsing routines.
pub const BasicParseError = struct {
    /// Details of this error
    kind: BasicParseErrorKind,
    /// Location where this error occurred
    location: css.SourceLocation,

    pub fn intoParseError(
        this: @This(),
        comptime T: type,
    ) ParseError(T) {
        return ParseError(T){
            .kind = .{ .basic = this.kind },
            .location = this.location,
        };
    }

    pub inline fn intoDefaultParseError(
        this: @This(),
    ) ParseError(ParserError) {
        return ParseError(ParserError){
            .kind = .{ .basic = this.kind },
            .location = this.location,
        };
    }
};

/// A selector parsing error.
pub const SelectorError = union(enum) {
    /// An unexpected token was found in an attribute selector.
    bad_value_in_attr: css.Token,
    /// An unexpected token was found in a class selector.
    class_needs_ident: css.Token,
    /// A dangling combinator was found.
    dangling_combinator,
    /// An empty selector.
    empty_selector,
    /// A `|` was expected in an attribute selector.
    expected_bar_in_attr: css.Token,
    /// A namespace was expected.
    expected_namespace: []const u8,
    /// An unexpected token was encountered in a namespace.
    explicit_namespace_unexpected_token: css.Token,
    /// An invalid pseudo class was encountered after a pseudo element.
    invalid_pseudo_class_after_pseudo_element,
    /// An invalid pseudo class was encountered after a `-webkit-scrollbar` pseudo element.
    invalid_pseudo_class_after_webkit_scrollbar,
    /// A `-webkit-scrollbar` state was encountered before a `-webkit-scrollbar` pseudo element.
    invalid_pseudo_class_before_webkit_scrollbar,
    /// Invalid qualified name in attribute selector.
    invalid_qual_name_in_attr: css.Token,
    /// The current token is not allowed in this state.
    invalid_state,
    /// The selector is required to have the `&` nesting selector at the start.
    missing_nesting_prefix,
    /// The selector is missing a `&` nesting selector.
    missing_nesting_selector,
    /// No qualified name in attribute selector.
    no_qualified_name_in_attribute_selector: css.Token,
    /// An invalid token was encountered in a pseudo element.
    pseudo_element_expected_ident: css.Token,
    /// An unexpected identifier was encountered.
    unexpected_ident: []const u8,
    /// An unexpected token was encountered inside an attribute selector.
    unexpected_token_in_attribute_selector: css.Token,
    /// An unsupported pseudo class or pseudo element was encountered.
    unsupported_pseudo_class_or_element: []const u8,
    unexpected_selector_after_pseudo_element: css.Token,

    pub fn format(this: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        return switch (this) {
            .dangling_combinator, .empty_selector, .invalid_state, .missing_nesting_prefix, .missing_nesting_selector => {
                try writer.print("{s}", .{@tagName(this)});
            },
            inline .expected_namespace, .unexpected_ident, .unsupported_pseudo_class_or_element => |str| {
                try writer.print("{s}: {s}", .{ @tagName(this), str });
            },
            inline .bad_value_in_attr,
            .class_needs_ident,
            .expected_bar_in_attr,
            .explicit_namespace_unexpected_token,
            .invalid_qual_name_in_attr,
            .no_qualified_name_in_attribute_selector,
            .pseudo_element_expected_ident,
            .unexpected_token_in_attribute_selector,
            => |tok| {
                try writer.print("{s}: {s}", .{ @tagName(this), @tagName(tok) });
            },
            else => try writer.print("{s}", .{@tagName(this)}),
        };
    }
};

pub fn ErrorWithLocation(comptime T: type) type {
    return struct {
        kind: T,
        loc: css.Location,
    };
}

pub const MinifyErr = error{
    minify_err,
};
pub const MinifyError = ErrorWithLocation(MinifyErrorKind);
/// A transformation error.
pub const MinifyErrorKind = union(enum) {
    /// A circular `@custom-media` rule was detected.
    circular_custom_media: struct {
        /// The name of the `@custom-media` rule that was referenced circularly.
        name: []const u8,
    },
    /// Attempted to reference a custom media rule that doesn't exist.
    custom_media_not_defined: struct {
        /// The name of the `@custom-media` rule that was not defined.
        name: []const u8,
    },
    /// Boolean logic with media types in @custom-media rules is not supported.
    unsupported_custom_media_boolean_logic: struct {
        /// The source location of the `@custom-media` rule with unsupported boolean logic.
        custom_media_loc: Location,
    },

    pub fn format(this: *const @This(), comptime _: []const u8, _: anytype, writer: anytype) !void {
        return switch (this.*) {
            .circular_custom_media => |name| try writer.print("Circular @custom-media rule: \"{s}\"", .{name.name}),
            .custom_media_not_defined => |name| try writer.print("Custom media rule \"{s}\" not defined", .{name.name}),
            .unsupported_custom_media_boolean_logic => |custom_media_loc| try writer.print(
                "Unsupported boolean logic in custom media rule at line {d}, column {d}",
                .{
                    custom_media_loc.custom_media_loc.line,
                    custom_media_loc.custom_media_loc.column,
                },
            ),
        };
    }
};
