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
        kind: ParserErrorKind(T),
        /// The location where the error occurred.
        loc: ?ErrorLocation,
    };
}

pub fn ParserErrorKind(comptime T: type) type {
    return union(enum) {
        /// A fundamental parse error from a built-in parsing routine.
        basic: BasicParseErrorKind,
        /// A parse error reported by downstream consumer code.
        custom: T,
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
};

/// A line and column location within a source file.
pub const ErrorLocation = struct {
    /// The filename in which the error occurred.
    filename: []const u8,
    /// The line number, starting from 0.
    line: u32,
    /// The column number, starting from 1.
    column: u32,
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
};
