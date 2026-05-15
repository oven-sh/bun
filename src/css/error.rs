use bstr::BStr;
use core::fmt;

use crate::{Location, SourceLocation, Token};

// Arena-owned byte slice. CSS is an AST crate (see PORTING.md §Allocators); these
// slices point into the parser arena / source text and are never individually freed.
// TODO(port): arena slice lifetime — Phase B may thread <'bump> or switch to StoreRef.
use crate::Str;

#[inline(always)]
fn bs(p: Str) -> &'static BStr {
    // SAFETY: arena/source slice outlives the error value; only used transiently for Display.
    BStr::new(unsafe { crate::arena_str(p) })
}

/// A printer error.
pub type PrinterError = Err<PrinterErrorKind>;

pub fn fmt_printer_error() -> PrinterError {
    Err {
        kind: PrinterErrorKind::fmt_error,
        loc: None,
    }
}

/// An error with a source location.
pub struct Err<T> {
    /// The type of error that occurred.
    pub kind: T,
    /// The location where the error occurred.
    pub loc: Option<ErrorLocation>,
}

impl<T: fmt::Display> fmt::Display for Err<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Zig: `if (@hasDecl(T, "format"))` → trait bound `T: Display` IS that check.
        self.kind.fmt(f)
    }
}

// Zig: `pub const toErrorInstance = @import("../css_jsc/error_jsc.zig").toErrorInstance;`
// Deleted per PORTING.md — `to_error_instance` lives as an extension-trait method in `bun_css_jsc`.

impl Err<ParserError> {
    pub fn from_parse_error(err: ParseError<ParserError>, filename: &[u8]) -> Err<ParserError> {
        let kind = match err.kind {
            ParserErrorKind::basic(b) => match b {
                BasicParseErrorKind::unexpected_token(t) => ParserError::unexpected_token(t),
                BasicParseErrorKind::end_of_input => ParserError::end_of_input,
                BasicParseErrorKind::at_rule_invalid(a) => ParserError::at_rule_invalid(a),
                BasicParseErrorKind::at_rule_body_invalid => ParserError::at_rule_body_invalid,
                BasicParseErrorKind::qualified_rule_invalid => ParserError::qualified_rule_invalid,
            },
            ParserErrorKind::custom(c) => c,
        };

        Err {
            kind,
            loc: Some(ErrorLocation {
                filename,
                line: err.location.line,
                column: err.location.column,
            }),
        }
    }
}

impl<T: fmt::Display> Err<T> {
    pub fn add_to_logger(
        &self,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
    ) -> Result<(), bun_core::Error> {
        use bun_core::OrWriteFailed as _;
        use std::io::Write as _;
        let mut text: Vec<u8> = Vec::new();
        write!(&mut text, "{}", self.kind).or_write_failed()?;

        log.add_msg(bun_ast::Msg {
            kind: bun_ast::Kind::Err,
            data: bun_ast::Data {
                location: match &self.loc {
                    Some(loc) => Some(loc.to_location(source)?),
                    None => None,
                },
                text: text.into(),
            },
            ..Default::default()
        });

        log.errors += 1;
        Ok(())
    }
}

/// Extensible parse errors that can be encountered by client parsing implementations.
pub struct ParseError<T> {
    /// Details of this error
    pub kind: ParserErrorKind<T>,
    /// Location where this error occurred
    pub location: SourceLocation,
}

impl<T> ParseError<T> {
    pub fn basic(self) -> BasicParseError {
        match self.kind {
            ParserErrorKind::basic(kind) => BasicParseError {
                kind,
                location: self.location,
            },
            ParserErrorKind::custom(_) => {
                panic!("Not a basic parse error. This is a bug in Bun's css parser.")
            }
        }
    }
}

#[allow(non_camel_case_types)]
pub enum ParserErrorKind<T> {
    /// A fundamental parse error from a built-in parsing routine.
    basic(BasicParseErrorKind),
    /// A parse error reported by downstream consumer code.
    custom(T),
}

impl<T: fmt::Display> fmt::Display for ParserErrorKind<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::basic(kind) => kind.fmt(f),
            Self::custom(kind) => kind.fmt(f),
        }
    }
}

/// Details about a `BasicParseError`
#[allow(non_camel_case_types)]
pub enum BasicParseErrorKind {
    /// An unexpected token was encountered.
    unexpected_token(Token),
    /// The end of the input was encountered unexpectedly.
    end_of_input,
    /// An `@` rule was encountered that was invalid.
    at_rule_invalid(Str),
    /// The body of an '@' rule was invalid.
    at_rule_body_invalid,
    /// A qualified rule was encountered that was invalid.
    qualified_rule_invalid,
}

impl fmt::Display for BasicParseErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::unexpected_token(token) => {
                write!(f, "unexpected token: {}", token)
            }
            Self::end_of_input => {
                write!(f, "unexpected end of input")
            }
            Self::at_rule_invalid(rule) => {
                write!(f, "invalid @ rule encountered: '@{}'", bs(*rule))
            }
            Self::at_rule_body_invalid => {
                // try writer.print("invalid @ body rule encountered: '@{s}'", .{});
                write!(f, "invalid @ body rule encountered")
            }
            Self::qualified_rule_invalid => {
                write!(f, "invalid qualified rule encountered")
            }
        }
    }
}

/// A line and column location within a source file.
pub struct ErrorLocation {
    /// The filename in which the error occurred.
    pub filename: Str,
    /// The line number, starting from 0.
    pub line: u32,
    /// The column number, starting from 1.
    pub column: u32,
}

impl ErrorLocation {
    pub fn with_filename(&self, filename: &[u8]) -> ErrorLocation {
        ErrorLocation {
            filename,
            line: self.line,
            column: self.column,
        }
    }

    pub fn to_location(
        &self,
        source: &bun_ast::Source,
    ) -> Result<bun_ast::Location, bun_core::Error> {
        // TODO(port): narrow error set (Zig narrowed to alloc-only).
        // SAFETY: `'bump`-erasure — `bun_ast::Location.line_text` is `Option<&'static [u8]>`
        // (`Str` placeholder per src/logger/lib.rs); the slice borrows
        // `source.contents` which outlives the diagnostic. Re-thread once
        // `bun_ast::Location` grows a real lifetime.
        let line_text = bun_core::strings::get_lines_in_text::<1>(&source.contents, self.line)
            .map(|lines| unsafe { &*std::ptr::from_ref::<[u8]>(lines.as_slice()[0]) });
        Ok(bun_ast::Location {
            file: std::borrow::Cow::Borrowed(source.path.text),
            namespace: source.path.namespace,
            line: i32::try_from(self.line + 1).expect("int cast"),
            column: i32::try_from(self.column).expect("int cast"),
            line_text: line_text.map(std::borrow::Cow::Borrowed),
            ..Default::default()
        })
    }
}

impl fmt::Display for ErrorLocation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}:{}", bs(self.filename), self.line, self.column)
    }
}

/// A printer error type.
#[allow(non_camel_case_types)]
pub enum PrinterErrorKind {
    /// An ambiguous relative `url()` was encountered in a custom property declaration.
    ambiguous_url_in_custom_property {
        /// The ambiguous URL.
        url: Str,
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
}

impl fmt::Display for PrinterErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ambiguous_url_in_custom_property { url } => write!(
                f,
                "Ambiguous relative URL '{}' in custom property declaration",
                bs(*url)
            ),
            Self::fmt_error => f.write_str("Formatting error occurred"),
            Self::invalid_composes_nesting => {
                f.write_str("The 'composes' property cannot be used within nested rules")
            }
            Self::invalid_composes_selector => {
                f.write_str("The 'composes' property can only be used with a simple class selector")
            }
            Self::invalid_css_modules_pattern_in_grid => {
                f.write_str("CSS modules pattern must end with '[local]' when used in CSS grid")
            }
            Self::no_import_records => f.write_str("No import records found"),
        }
    }
}

/// A parser error.
#[allow(non_camel_case_types)]
pub enum ParserError {
    /// An at rule body was invalid.
    at_rule_body_invalid,
    /// An at rule prelude was invalid.
    at_rule_prelude_invalid,
    /// An unknown or unsupported at rule was encountered.
    at_rule_invalid(Str),
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
    selector_error(SelectorError),
    /// An `@import` rule was encountered after any rule besides `@charset` or `@layer`.
    unexpected_import_rule,
    /// A `@namespace` rule was encountered after any rules besides `@charset`, `@import`, or `@layer`.
    unexpected_namespace_rule,
    /// An unexpected token was encountered.
    unexpected_token(Token),
    /// Maximum nesting depth was reached.
    maximum_nesting_depth,
    unexpected_value {
        expected: Str,
        received: Str,
    },
}

impl fmt::Display for ParserError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::at_rule_body_invalid => f.write_str("Invalid at-rule body"),
            Self::at_rule_prelude_invalid => f.write_str("Invalid at-rule prelude"),
            Self::at_rule_invalid(name) => write!(f, "Unknown at-rule @{}", bs(*name)),
            Self::end_of_input => f.write_str("Unexpected end of input"),
            Self::invalid_declaration => f.write_str("Invalid declaration"),
            Self::invalid_media_query => f.write_str("Invalid media query"),
            Self::invalid_nesting => f.write_str("Invalid CSS nesting"),
            Self::deprecated_nest_rule => {
                f.write_str("The @nest rule is deprecated, use standard CSS nesting instead")
            }
            Self::invalid_page_selector => f.write_str("Invalid @page selector"),
            Self::invalid_value => f.write_str("Invalid value"),
            Self::qualified_rule_invalid => f.write_str("Invalid qualified rule"),
            Self::selector_error(err) => write!(f, "Invalid selector. {}", err),
            Self::unexpected_import_rule => f.write_str(
                "@import rules must come before any other rules except @charset and @layer",
            ),
            Self::unexpected_namespace_rule => f.write_str(
                "@namespace rules must come before any other rules except @charset, @import, and @layer",
            ),
            Self::unexpected_token(token) => write!(f, "Unexpected token: {}", token),
            Self::maximum_nesting_depth => f.write_str("Maximum CSS nesting depth exceeded"),
            Self::unexpected_value { expected, received } => {
                write!(f, "Expected {}, received {}", bs(*expected), bs(*received))
            }
        }
    }
}

/// The fundamental parsing errors that can be triggered by built-in parsing routines.
pub struct BasicParseError {
    /// Details of this error
    pub kind: BasicParseErrorKind,
    /// Location where this error occurred
    pub location: SourceLocation,
}

impl BasicParseError {
    pub fn into_parse_error<T>(self) -> ParseError<T> {
        ParseError {
            kind: ParserErrorKind::basic(self.kind),
            location: self.location,
        }
    }

    #[inline]
    pub fn into_default_parse_error(self) -> ParseError<ParserError> {
        ParseError {
            kind: ParserErrorKind::basic(self.kind),
            location: self.location,
        }
    }
}

/// A selector parsing error.
#[allow(non_camel_case_types)]
pub enum SelectorError {
    /// An unexpected token was found in an attribute selector.
    bad_value_in_attr(Token),
    /// An unexpected token was found in a class selector.
    class_needs_ident(Token),
    /// A dangling combinator was found.
    dangling_combinator,
    /// An empty selector.
    empty_selector,
    /// A `|` was expected in an attribute selector.
    expected_bar_in_attr(Token),
    /// A namespace was expected.
    expected_namespace(Str),
    /// An unexpected token was encountered in a namespace.
    explicit_namespace_unexpected_token(Token),
    /// An invalid pseudo class was encountered after a pseudo element.
    invalid_pseudo_class_after_pseudo_element,
    /// An invalid pseudo class was encountered after a `-webkit-scrollbar` pseudo element.
    invalid_pseudo_class_after_webkit_scrollbar,
    /// A `-webkit-scrollbar` state was encountered before a `-webkit-scrollbar` pseudo element.
    invalid_pseudo_class_before_webkit_scrollbar,
    /// Invalid qualified name in attribute selector.
    invalid_qual_name_in_attr(Token),
    /// The current token is not allowed in this state.
    invalid_state,
    /// The selector is required to have the `&` nesting selector at the start.
    missing_nesting_prefix,
    /// The selector is missing a `&` nesting selector.
    missing_nesting_selector,
    /// No qualified name in attribute selector.
    no_qualified_name_in_attribute_selector(Token),
    /// An invalid token was encountered in a pseudo element.
    pseudo_element_expected_ident(Token),
    /// An unexpected identifier was encountered.
    unexpected_ident(Str),
    /// An unexpected token was encountered inside an attribute selector.
    unexpected_token_in_attribute_selector(Token),
    /// An unsupported pseudo class or pseudo element was encountered.
    unsupported_pseudo_class_or_element(Str),
    unexpected_selector_after_pseudo_element(Token),
    ambiguous_css_module_class(Str),
}

impl fmt::Display for SelectorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::dangling_combinator => {
                f.write_str("Found a dangling combinator with no selector")
            }
            Self::empty_selector => f.write_str("Empty selector is not allowed"),
            Self::invalid_state => f.write_str("Token is not allowed in this state"),
            Self::missing_nesting_prefix => {
                f.write_str("Selector must start with the '&' nesting selector")
            }
            Self::missing_nesting_selector => f.write_str("Missing '&' nesting selector"),
            Self::invalid_pseudo_class_after_pseudo_element => {
                f.write_str("Invalid pseudo-class after pseudo-element")
            }
            Self::invalid_pseudo_class_after_webkit_scrollbar => {
                f.write_str("Invalid pseudo-class after -webkit-scrollbar")
            }
            Self::invalid_pseudo_class_before_webkit_scrollbar => {
                f.write_str("-webkit-scrollbar state found before -webkit-scrollbar pseudo-element")
            }

            Self::expected_namespace(s) => write!(f, "Expected namespace '{}'", bs(*s)),
            Self::unexpected_ident(s) => write!(f, "Unexpected identifier '{}'", bs(*s)),
            Self::unsupported_pseudo_class_or_element(s) => {
                write!(f, "Unsupported pseudo-class or pseudo-element '{}'", bs(*s))
            }

            Self::bad_value_in_attr(tok) => {
                write!(f, "Invalid value in attribute selector: {}", tok)
            }
            Self::class_needs_ident(tok) => write!(
                f,
                "Expected identifier after '.' in class selector, found: {}",
                tok
            ),
            Self::expected_bar_in_attr(tok) => {
                write!(f, "Expected '|' in attribute selector, found: {}", tok)
            }
            Self::explicit_namespace_unexpected_token(tok) => {
                write!(f, "Unexpected token in namespace: {}", tok)
            }
            Self::invalid_qual_name_in_attr(tok) => {
                write!(f, "Invalid qualified name in attribute selector: {}", tok)
            }
            Self::no_qualified_name_in_attribute_selector(tok) => {
                write!(f, "Missing qualified name in attribute selector: {}", tok)
            }
            Self::pseudo_element_expected_ident(tok) => {
                write!(f, "Expected identifier in pseudo-element, found: {}", tok)
            }
            Self::unexpected_token_in_attribute_selector(tok) => {
                write!(f, "Unexpected token in attribute selector: {}", tok)
            }
            Self::unexpected_selector_after_pseudo_element(tok) => {
                write!(f, "Unexpected selector after pseudo-element: {}", tok)
            }
            Self::ambiguous_css_module_class(name) => write!(
                f,
                "CSS module class: '{}' is currently not supported.",
                bs(*name)
            ),
        }
    }
}

pub struct ErrorWithLocation<T> {
    pub kind: T,
    pub loc: Location,
}

#[derive(strum::IntoStaticStr, Debug)]
#[allow(non_camel_case_types)]
pub enum MinifyErr {
    minify_err,
}
bun_core::impl_tag_error!(MinifyErr);
bun_core::named_error_set!(MinifyErr);

pub type MinifyError = ErrorWithLocation<MinifyErrorKind>;

/// A transformation error.
#[allow(non_camel_case_types)]
pub enum MinifyErrorKind {
    /// A circular `@custom-media` rule was detected.
    circular_custom_media {
        /// The name of the `@custom-media` rule that was referenced circularly.
        name: Str,
    },
    /// Attempted to reference a custom media rule that doesn't exist.
    custom_media_not_defined {
        /// The name of the `@custom-media` rule that was not defined.
        name: Str,
    },
    /// Boolean logic with media types in @custom-media rules is not supported.
    unsupported_custom_media_boolean_logic {
        /// The source location of the `@custom-media` rule with unsupported boolean logic.
        custom_media_loc: Location,
    },
}

impl fmt::Display for MinifyErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::circular_custom_media { name } => {
                write!(f, "Circular @custom-media rule: \"{}\"", bs(*name))
            }
            Self::custom_media_not_defined { name } => {
                write!(f, "Custom media rule \"{}\" not defined", bs(*name))
            }
            Self::unsupported_custom_media_boolean_logic { custom_media_loc } => write!(
                f,
                "Unsupported boolean logic in custom media rule at line {}, column {}",
                custom_media_loc.line, custom_media_loc.column,
            ),
        }
    }
}

// ported from: src/css/error.zig
