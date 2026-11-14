use bstr::BStr;
use core::fmt;

use crate::{Location, SourceLocation, Token};

/// A printer error.
pub type PrinterError = Err<PrinterErrorKind>;

/// An error with a source location.
pub struct Err<T> {
    /// The type of error that occurred.
    pub kind: T,
    /// The location where the error occurred.
    pub(crate) loc: Option<ErrorLocation>,
}

impl<T: fmt::Display> fmt::Display for Err<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.kind.fmt(f)
    }
}

// `to_error_instance` lives as an extension-trait method in `bun_css_jsc`.

impl<'bump> Err<ParserError<'bump>> {
    pub(crate) fn from_parse_error(
        err: ParseError<'bump, ParserError<'bump>>,
    ) -> Err<ParserError<'bump>> {
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
        use std::io::Write as _;
        let mut text: Vec<u8> = Vec::new();
        write!(&mut text, "{}", self.kind).map_err(|_| bun_core::Error::WriteFailed)?;

        log.add_msg(bun_ast::Msg {
            kind: bun_ast::Kind::Err,
            data: bun_ast::Data {
                location: match &self.loc {
                    Some(loc) => Some(loc.to_location(source)?),
                    // An error with no location still reports the file name.
                    None => bun_ast::Location::init_or_null(Some(source), bun_ast::Range::NONE),
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
pub struct ParseError<'bump, T> {
    /// Details of this error
    pub(crate) kind: ParserErrorKind<'bump, T>,
    /// Location where this error occurred
    pub(crate) location: SourceLocation,
}

#[allow(non_camel_case_types)]
pub enum ParserErrorKind<'bump, T> {
    /// A fundamental parse error from a built-in parsing routine.
    basic(BasicParseErrorKind<'bump>),
    /// A parse error reported by downstream consumer code.
    custom(T),
}

impl<T: fmt::Display> fmt::Display for ParserErrorKind<'_, T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::basic(kind) => kind.fmt(f),
            Self::custom(kind) => kind.fmt(f),
        }
    }
}

/// The fundamental parsing errors that can be triggered by built-in parsing routines.
#[allow(non_camel_case_types)]
pub enum BasicParseErrorKind<'bump> {
    /// An unexpected token was encountered.
    unexpected_token(Token<'bump>),
    /// The end of the input was encountered unexpectedly.
    end_of_input,
    /// An `@` rule was encountered that was invalid.
    at_rule_invalid(&'bump [u8]),
    /// The body of an '@' rule was invalid.
    at_rule_body_invalid,
    /// A qualified rule was encountered that was invalid.
    qualified_rule_invalid,
}

impl fmt::Display for BasicParseErrorKind<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::unexpected_token(token) => {
                write!(f, "unexpected token: {}", token)
            }
            Self::end_of_input => {
                write!(f, "unexpected end of input")
            }
            Self::at_rule_invalid(rule) => {
                write!(f, "invalid @ rule encountered: '@{}'", BStr::new(rule))
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
    /// The line number, starting from 0.
    pub(crate) line: u32,
    /// The column number, starting from 1.
    pub(crate) column: u32,
}

impl ErrorLocation {
    pub(crate) fn to_location(
        &self,
        source: &bun_ast::Source,
    ) -> Result<bun_ast::Location, bun_core::Error> {
        let line_text = bun_core::strings::get_lines_in_text::<1>(&source.contents, self.line)
            .map(|lines| Box::from(bun_core::strings::trim(lines.as_slice()[0], b"\r\n")));
        Ok(bun_ast::Location {
            file: Box::from(source.path.text),
            namespace: Box::from(source.path.namespace),
            line: i32::try_from(self.line + 1).expect("int cast"),
            column: i32::try_from(self.column).expect("int cast"),
            line_text,
            ..Default::default()
        })
    }
}

/// A printer error type.
#[allow(non_camel_case_types)]
pub enum PrinterErrorKind {
    /// A [std::fmt::Error](std::fmt::Error) was encountered in the underlying destination.
    fmt_error,
    /// The CSS modules pattern must end with `[local]` for use in CSS grid.
    invalid_css_modules_pattern_in_grid,
    /// Substituting parent selectors for `&` while compiling CSS nesting for
    /// the configured targets exceeded the expansion limit.
    maximum_nesting_expansion,
    /// Serializing a style rule once per vendor prefix re-serializes its whole
    /// body in every pass, so nesting vendor-prefixed multi-selector rules
    /// expands the output multiplicatively with depth. The total bytes emitted
    /// by those duplicate passes exceeded the expansion limit.
    maximum_vendor_prefix_expansion,
    no_import_records,
}

impl fmt::Display for PrinterErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::fmt_error => f.write_str("Formatting error occurred"),
            Self::invalid_css_modules_pattern_in_grid => {
                f.write_str("CSS modules pattern must end with '[local]' when used in CSS grid")
            }
            Self::maximum_nesting_expansion => f.write_str(
                "Maximum nesting expansion exceeded when compiling CSS nesting for the configured targets",
            ),
            Self::maximum_vendor_prefix_expansion => f.write_str(
                "Maximum vendor-prefix expansion exceeded when serializing deeply nested vendor-prefixed selectors",
            ),
            Self::no_import_records => f.write_str("No import records found"),
        }
    }
}

/// A parser error.
#[allow(non_camel_case_types)]
pub enum ParserError<'bump> {
    /// An at rule body was invalid.
    at_rule_body_invalid,
    /// An at rule prelude was invalid.
    at_rule_prelude_invalid,
    /// An unknown or unsupported at rule was encountered.
    at_rule_invalid(&'bump [u8]),
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
    selector_error(SelectorError<'bump>),
    /// An `@import` rule was encountered after any rule besides `@charset` or `@layer`.
    unexpected_import_rule,
    /// A `@namespace` rule was encountered after any rules besides `@charset`, `@import`, or `@layer`.
    unexpected_namespace_rule,
    /// An unexpected token was encountered.
    unexpected_token(Token<'bump>),
    /// Maximum nesting depth was reached.
    maximum_nesting_depth,
    unexpected_value {
        expected: &'bump [u8],
        received: &'bump [u8],
    },
    input_too_large,
}

impl fmt::Display for ParserError<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::at_rule_body_invalid => f.write_str("Invalid at-rule body"),
            Self::at_rule_prelude_invalid => f.write_str("Invalid at-rule prelude"),
            Self::at_rule_invalid(name) => write!(f, "Unknown at-rule @{}", BStr::new(name)),
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
                write!(f, "Expected {}, received {}", BStr::new(expected), BStr::new(received))
            }
            Self::input_too_large => f.write_str("CSS file is too large to parse (2 GiB maximum)"),
        }
    }
}

/// A selector parsing error.
#[allow(non_camel_case_types)]
pub enum SelectorError<'bump> {
    /// An unexpected token was found in an attribute selector.
    bad_value_in_attr(Token<'bump>),
    /// An unexpected token was found in a class selector.
    class_needs_ident(Token<'bump>),
    /// A dangling combinator was found.
    dangling_combinator,
    /// An empty selector.
    empty_selector,
    /// A `|` was expected in an attribute selector.
    expected_bar_in_attr(Token<'bump>),
    /// A namespace was expected.
    expected_namespace(&'bump [u8]),
    /// An unexpected token was encountered in a namespace.
    explicit_namespace_unexpected_token(Token<'bump>),
    /// An invalid pseudo class was encountered after a pseudo element.
    invalid_pseudo_class_after_pseudo_element,
    /// An invalid pseudo class was encountered after a `-webkit-scrollbar` pseudo element.
    invalid_pseudo_class_after_webkit_scrollbar,
    /// Invalid qualified name in attribute selector.
    invalid_qual_name_in_attr(Token<'bump>),
    /// The current token is not allowed in this state.
    invalid_state,
    /// The selector is required to have the `&` nesting selector at the start.
    missing_nesting_prefix,
    /// The selector is missing a `&` nesting selector.
    missing_nesting_selector,
    /// No qualified name in attribute selector.
    no_qualified_name_in_attribute_selector(Token<'bump>),
    /// An invalid token was encountered in a pseudo element.
    pseudo_element_expected_ident(Token<'bump>),
    /// An unexpected identifier was encountered.
    unexpected_ident(&'bump [u8]),
    /// An unexpected token was encountered inside an attribute selector.
    unexpected_token_in_attribute_selector(Token<'bump>),
    /// An unsupported pseudo class or pseudo element was encountered.
    unsupported_pseudo_class_or_element(&'bump [u8]),
    unexpected_selector_after_pseudo_element(Token<'bump>),
    ambiguous_css_module_class(&'bump [u8]),
}

impl fmt::Display for SelectorError<'_> {
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

            Self::expected_namespace(s) => write!(f, "Expected namespace '{}'", BStr::new(s)),
            Self::unexpected_ident(s) => write!(f, "Unexpected identifier '{}'", BStr::new(s)),
            Self::unsupported_pseudo_class_or_element(s) => {
                write!(
                    f,
                    "Unsupported pseudo-class or pseudo-element '{}'",
                    BStr::new(s)
                )
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
                BStr::new(name)
            ),
        }
    }
}

pub struct ErrorWithLocation<T> {
    pub(crate) kind: T,
    pub(crate) loc: Location,
}

#[derive(strum::IntoStaticStr, Debug)]
#[allow(non_camel_case_types)]
pub enum MinifyErr {
    minify_err,
}
bun_core::impl_tag_error!(MinifyErr);

pub type MinifyError = ErrorWithLocation<MinifyErrorKind>;

/// A transformation error.
#[allow(non_camel_case_types)]
pub enum MinifyErrorKind {
    /// Compiling nested rules for the configured browser targets would expand to
    /// more than [`crate::css_rules::MAX_SELECTOR_EXPANSION`] selectors.
    selector_expansion_limit_exceeded,
    /// Rule minification failed without recording a more specific diagnostic on
    /// `MinifyContext::err`. Defensive fallback — every failing path is expected
    /// to record one before returning an error.
    unknown,
}

impl fmt::Display for MinifyErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::selector_expansion_limit_exceeded => write!(
                f,
                "Nested CSS rules expand to more than {} selectors when compiled for the configured browser targets. Reduce the nesting depth or the number of selectors per rule, or target browsers that support CSS nesting.",
                crate::css_rules::MAX_SELECTOR_EXPANSION,
            ),
            Self::unknown => write!(f, "CSS minification failed"),
        }
    }
}
