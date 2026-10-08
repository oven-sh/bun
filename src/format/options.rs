//! The options of Prettier.
//!
//! | Prettier | here |
//! | --- | --- |
//! | `printWidth` | `line_width` |
//! | `tabWidth` | `indent_width` |
//! | `useTabs` | `indent_style` |
//! | `endOfLine` | `line_ending` |
//! | `semi` | `semicolons` |
//! | `singleQuote` | `quote_style` |
//! | `jsxSingleQuote` | `jsx_quote_style` |
//! | `quoteProps` | `quote_properties` |
//! | `trailingComma` | `trailing_commas` |
//! | `bracketSpacing` | `bracket_spacing` |
//! | `bracketSameLine` | `bracket_same_line` |
//! | `arrowParens` | `arrow_parentheses` |
//! | `objectWrap` | `expand` |
//! | `singleAttributePerLine` | `attribute_position` |
//! | `experimentalOperatorPosition` | `experimental_operator_position` |
//! | `experimentalTernaries` | `experimental_ternaries` |
//! | `embeddedLanguageFormatting` | `embedded_language_formatting` |

use crate::ir::prelude::*;

#[derive(Debug, Default, Clone)]
pub struct FormatOptions {
    pub indent_style: IndentStyle,
    pub indent_width: IndentWidth,
    pub line_ending: LineEnding,
    pub line_width: LineWidth,
    pub quote_style: QuoteStyle,
    pub jsx_quote_style: QuoteStyle,
    pub quote_properties: QuoteProperties,
    pub trailing_commas: TrailingCommas,
    pub semicolons: Semicolons,
    pub arrow_parentheses: ArrowParentheses,
    pub bracket_spacing: BracketSpacing,
    pub bracket_same_line: BracketSameLine,
    pub attribute_position: AttributePosition,
    pub expand: Expand,
    pub experimental_operator_position: OperatorPosition,
    pub experimental_ternaries: bool,
    pub embedded_language_formatting: EmbeddedLanguageFormatting,
    /// For YAML and Markdown.
    pub prose_wrap: ProseWrap,
    /// For HTML and what is like it.
    pub html_whitespace_sensitivity: HtmlWhitespaceSensitivity,
    pub vue_indent_script_and_style: bool,
    /// The name of the file, if it is not the one that it was parsed under: text from stdin.
    pub filepath: Option<Box<[u8]>>,
    /// Prettier's `parser`, if it is not left to the name of the file: `json5`, `babel`, ..
    pub parser: Option<Box<[u8]>>,
    /// Only what is between the two is formatted. As in Prettier, they count UTF-16 code units.
    pub range_start: Option<u32>,
    pub range_end: Option<u32>,
    /// Where the cursor is, in UTF-16 code units. Where it ends up is part of the result.
    pub cursor_offset: Option<u32>,
    /// Puts `@format` in a comment at the top of the file.
    pub insert_pragma: bool,
    /// Only a file with `@format` or `@prettier` in a comment at its top is formatted.
    pub require_pragma: bool,
    /// A file with `@noformat` or `@noprettier` in a comment at its top is not formatted.
    pub check_ignore_pragma: bool,
    /// The text is code in Markdown: Prettier's `parentParser`. A statement that is nothing but JSX gets no
    /// semicolon. A line break that is part of a text (in a template, in a comment) is written as `\r\n`, to
    /// tell it from the others: Markdown indents what follows it in another way.
    pub is_in_markdown: bool,
    /// The text is `<$>`, JSX that is in MDX, and `</$>`: Prettier's `rootMarker: "mdx"`. Only what is between the
    /// two is written.
    pub is_mdx_jsx: bool,
    /// The text is `import` and `export` declarations in MDX. Anything else in it is an error: Prettier's
    /// `validateImportExport`.
    pub is_mdx_es_syntax: bool,
    /// Whether HTML in the templates of JavaScript and in the blocks of code of Markdown is formatted.
    pub embedded_html: bool,
    /// In how many templates of JavaScript that are written as HTML the text is.
    pub html_template_depth: u32,
    /// Formats the JavaScript and TypeScript in blocks of code in Markdown. Without it they stay as they are.
    pub format_javascript: Option<FormatJavaScript>,
    /// Parses the JavaScript and TypeScript in HTML. Without it they stay as they are.
    pub parse_javascript: Option<ParseJavaScript>,
    /// What the code is in, if it is in HTML.
    pub in_html: InHtml,
    /// Whose output to produce where the two differ.
    pub flavor: Flavor,
    /// oxfmt's `sortPackageJson`: the keys of a `package.json` are put in the usual order.
    pub sort_package_json: Option<crate::json::SortPackageJson>,
    /// How imports are sorted, if they are.
    pub sort_imports: Option<std::sync::Arc<crate::sort_imports::SortImports>>,
    /// oxfmt's `jsdoc`: how JSDoc comments are formatted, if they are.
    pub jsdoc: Option<JsdocOptions>,
}

/// Formats JavaScript or TypeScript, which this crate cannot parse by itself. It is given the name of a file that
/// says which of them it is, the code, the options, and where to append the result. It returns whether the
/// code could be formatted.
pub type FormatJavaScript = fn(&[u8], &[u8], &FormatOptions, &mut Vec<u8>) -> bool;

/// Parses JavaScript or TypeScript, which this crate cannot do by itself. It is given the name of a file that says which
/// of them it is, the code, whether that is a script, and what to call with the file, errors or not.
pub type ParseJavaScript =
    fn(&[u8], &[u8], bool, &mut dyn for<'b> FnMut(&'b bun_lint::ast::File<'b>));

/// What Prettier tells the formatter of code that is in HTML: the options whose names start with `__`, and the parsers for
/// what is less than a program.
#[derive(Debug, Default, Copy, Clone, PartialEq, Eq)]
pub struct InHtml {
    pub root: HtmlRoot,
    /// `__isInHtmlAttribute`: the code is between double quotes.
    pub is_in_attribute: bool,
    /// `__isInHtmlInterpolation`: `}}` follows the code.
    pub is_in_interpolation: bool,
    /// `__isHtmlInlineEventHandler`
    pub is_inline_event_handler: bool,
    /// `__isHTMLStyleAttribute`
    pub is_style_attribute: bool,
    /// `singleQuote`, which `quote_style` does not say in an attribute.
    pub quote_style: QuoteStyle,
}

/// What the code is.
#[derive(Debug, Default, Copy, Clone, PartialEq, Eq)]
pub enum HtmlRoot {
    /// It is not in HTML.
    #[default]
    None,
    /// `babel`, `typescript`, `css`, ..
    Program,
    /// `__js_expression`, `__ts_expression`
    JsExpression,
    /// `__vue_expression`, `__vue_ts_expression`: `a | b` is a filter.
    VueExpression,
    /// `__vue_event_binding`, `__vue_ts_event_binding`
    VueEventBinding,
    /// `__ng_action`
    NgAction,
    /// `__ng_binding`
    NgBinding,
    /// `__ng_directive`
    NgDirective,
    /// `__ng_interpolation`
    NgInterpolation,
}

impl HtmlRoot {
    /// Prettier's `NGRoot`: the code is an expression of Angular, in which `a | b(c)` stands for the pipe `a | b: c`.
    #[inline]
    pub fn is_angular(self) -> bool {
        matches!(
            self,
            HtmlRoot::NgAction
                | HtmlRoot::NgBinding
                | HtmlRoot::NgDirective
                | HtmlRoot::NgInterpolation
        )
    }
}

/// An option has a value that Prettier does not accept, or there is no such option.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub struct InvalidOption;

impl FormatOptions {
    /// Sets the option that Prettier calls `name`. `value` is as it is written in JSON, a string
    /// without its quotes.
    pub fn set(&mut self, name: &[u8], value: &[u8]) -> Result<(), InvalidOption> {
        let boolean = || match value {
            b"true" => Ok(true),
            b"false" => Ok(false),
            _ => Err(InvalidOption),
        };
        let number = |max: u32| {
            let mut n = 0u32;
            for &digit in value {
                if !digit.is_ascii_digit() {
                    return Err(InvalidOption);
                }
                n = n.saturating_mul(10).saturating_add(u32::from(digit - b'0'));
            }
            if value.is_empty() || n > max {
                Err(InvalidOption)
            } else {
                Ok(n)
            }
        };
        let quotes = |single: bool| {
            if single {
                QuoteStyle::Single
            } else {
                QuoteStyle::Double
            }
        };
        match name {
            b"printWidth" if value == b"Infinity" => self.line_width = LineWidth(u16::MAX),
            b"printWidth" => self.line_width = LineWidth(number(u32::from(u16::MAX))? as u16),
            // Markdown asks whether something is a multiple of it. Nothing is as wide as 255 columns.
            b"tabWidth" => {
                self.indent_width = IndentWidth(number(u32::MAX)?.min(u32::from(u8::MAX)) as u8)
            }
            b"useTabs" => {
                self.indent_style = if boolean()? {
                    IndentStyle::Tab
                } else {
                    IndentStyle::Space
                };
            }
            b"endOfLine" => {
                self.line_ending = match value {
                    b"lf" => LineEnding::Lf,
                    b"crlf" => LineEnding::Crlf,
                    b"cr" => LineEnding::Cr,
                    b"auto" => LineEnding::Auto,
                    _ => return Err(InvalidOption),
                };
            }
            b"semi" => {
                self.semicolons = if boolean()? {
                    Semicolons::Always
                } else {
                    Semicolons::AsNeeded
                };
            }
            b"singleQuote" => self.quote_style = quotes(boolean()?),
            b"jsxSingleQuote" => self.jsx_quote_style = quotes(boolean()?),
            b"quoteProps" => {
                self.quote_properties = match value {
                    b"as-needed" => QuoteProperties::AsNeeded,
                    b"preserve" => QuoteProperties::Preserve,
                    b"consistent" => QuoteProperties::Consistent,
                    _ => return Err(InvalidOption),
                };
            }
            b"trailingComma" => {
                self.trailing_commas = match value {
                    b"all" => TrailingCommas::All,
                    b"es5" => TrailingCommas::Es5,
                    b"none" => TrailingCommas::None,
                    _ => return Err(InvalidOption),
                };
            }
            b"bracketSpacing" => self.bracket_spacing = BracketSpacing(boolean()?),
            b"bracketSameLine" => self.bracket_same_line = BracketSameLine(boolean()?),
            // The name it had before 2.4. One of the two is enough.
            b"jsxBracketSameLine" => {
                self.bracket_same_line =
                    BracketSameLine(boolean()? || self.bracket_same_line.value());
            }
            b"arrowParens" => {
                self.arrow_parentheses = match value {
                    b"always" => ArrowParentheses::Always,
                    b"avoid" => ArrowParentheses::AsNeeded,
                    _ => return Err(InvalidOption),
                };
            }
            b"objectWrap" => {
                self.expand = match value {
                    b"preserve" => Expand::Auto,
                    b"collapse" => Expand::Never,
                    _ => return Err(InvalidOption),
                };
            }
            b"singleAttributePerLine" => {
                self.attribute_position = match boolean()? {
                    true => AttributePosition::Multiline,
                    false => AttributePosition::Auto,
                };
            }
            b"experimentalOperatorPosition" => {
                self.experimental_operator_position = match value {
                    b"start" => OperatorPosition::Start,
                    b"end" => OperatorPosition::End,
                    _ => return Err(InvalidOption),
                };
            }
            b"experimentalTernaries" => self.experimental_ternaries = boolean()?,
            b"embeddedLanguageFormatting" => {
                self.embedded_language_formatting = match value {
                    b"auto" => EmbeddedLanguageFormatting::Auto,
                    b"off" => EmbeddedLanguageFormatting::Off,
                    _ => return Err(InvalidOption),
                };
            }
            b"proseWrap" => {
                self.prose_wrap = match value {
                    b"always" => ProseWrap::Always,
                    b"never" => ProseWrap::Never,
                    b"preserve" => ProseWrap::Preserve,
                    _ => return Err(InvalidOption),
                };
            }
            b"htmlWhitespaceSensitivity" => {
                self.html_whitespace_sensitivity = match value {
                    b"css" => HtmlWhitespaceSensitivity::Css,
                    b"strict" => HtmlWhitespaceSensitivity::Strict,
                    b"ignore" => HtmlWhitespaceSensitivity::Ignore,
                    _ => return Err(InvalidOption),
                };
            }
            b"vueIndentScriptAndStyle" => self.vue_indent_script_and_style = boolean()?,
            b"filepath" => self.filepath = Some(value.into()),
            b"parser" => self.parser = Some(value.into()),
            b"rangeStart" => self.range_start = Some(number(u32::MAX)?),
            // `Infinity` is the default.
            b"rangeEnd" => self.range_end = number(u32::MAX).ok(),
            // -1 is the default.
            b"cursorOffset" => self.cursor_offset = number(u32::MAX).ok(),
            b"insertPragma" => self.insert_pragma = boolean()?,
            b"requirePragma" => self.require_pragma = boolean()?,
            b"checkIgnorePragma" => self.check_ignore_pragma = boolean()?,
            // oxfmt's: `true`, `false` or `{ "sortScripts": true }`.
            b"sortPackageJson" => self.sort_package_json = boolean()?.then(Default::default),
            b"sortPackageJson.sortScripts" => {
                self.sort_package_json.get_or_insert_default().sort_scripts = boolean()?;
            }
            // oxfmt's: `true`, `false` or an object, whose properties come as `jsdoc.<name>`.
            b"jsdoc" => self.jsdoc = (value == b"{}" || boolean()?).then(Default::default),
            _ if name.starts_with(b"jsdoc.") => {
                let jsdoc = self.jsdoc.get_or_insert_default();
                match &name[b"jsdoc.".len()..] {
                    b"capitalizeDescriptions" => jsdoc.capitalize_descriptions = boolean()?,
                    b"commentLineStrategy" => {
                        jsdoc.comment_line_strategy = match value {
                            b"singleLine" => CommentLineStrategy::SingleLine,
                            b"multiline" => CommentLineStrategy::Multiline,
                            b"keep" => CommentLineStrategy::Keep,
                            _ => return Err(InvalidOption),
                        };
                    }
                    b"separateTagGroups" => jsdoc.separate_tag_groups = boolean()?,
                    b"separateReturnsFromParam" => jsdoc.separate_returns_from_param = boolean()?,
                    b"bracketSpacing" => jsdoc.bracket_spacing = boolean()?,
                    b"descriptionWithDot" => jsdoc.description_with_dot = boolean()?,
                    b"addDefaultToDescription" => jsdoc.add_default_to_description = boolean()?,
                    b"preferCodeFences" => jsdoc.prefer_code_fences = boolean()?,
                    b"lineWrappingStyle" => {
                        jsdoc.line_wrapping_style = match value {
                            b"greedy" => LineWrappingStyle::Greedy,
                            b"balance" => LineWrappingStyle::Balance,
                            _ => return Err(InvalidOption),
                        };
                    }
                    b"descriptionTag" => jsdoc.description_tag = boolean()?,
                    b"keepUnparsableExampleIndent" => {
                        jsdoc.keep_unparsable_example_indent = boolean()?
                    }
                    _ => return Err(InvalidOption),
                }
            }
            // Not an option of Prettier. The kind of the configuration file decides.
            b"flavor" => {
                self.flavor = match value {
                    b"prettier" => Flavor::Prettier,
                    b"oxfmt" => Flavor::Oxfmt,
                    _ => return Err(InvalidOption),
                };
            }
            _ => return Err(InvalidOption),
        }
        Ok(())
    }
}

/// oxfmt's `jsdoc`, which has the options of prettier-plugin-jsdoc.
#[derive(Debug, Clone, Copy, Eq, Hash, PartialEq)]
pub struct JsdocOptions {
    /// The first letter of a description is made a capital one.
    pub capitalize_descriptions: bool,
    pub comment_line_strategy: CommentLineStrategy,
    /// An empty line between tags of different kinds.
    pub separate_tag_groups: bool,
    /// An empty line between the last `@param` and `@returns`.
    pub separate_returns_from_param: bool,
    /// `{ string }` instead of `{string}`.
    pub bracket_spacing: bool,
    /// A description ends with a dot.
    pub description_with_dot: bool,
    /// "Default is `value`" at the end of the description of `@param [name=value]`.
    pub add_default_to_description: bool,
    /// Code without a language is between fences instead of being indented.
    pub prefer_code_fences: bool,
    pub line_wrapping_style: LineWrappingStyle,
    /// The description comes after `@description`.
    pub description_tag: bool,
    /// An `@example` that cannot be parsed keeps its indentation.
    pub keep_unparsable_example_indent: bool,
}

impl Default for JsdocOptions {
    fn default() -> Self {
        JsdocOptions {
            capitalize_descriptions: true,
            comment_line_strategy: CommentLineStrategy::SingleLine,
            separate_tag_groups: false,
            separate_returns_from_param: false,
            bracket_spacing: false,
            description_with_dot: false,
            add_default_to_description: true,
            prefer_code_fences: false,
            line_wrapping_style: LineWrappingStyle::Greedy,
            description_tag: false,
            keep_unparsable_example_indent: false,
        }
    }
}

/// Whether a JSDoc comment is on one line.
#[derive(Debug, Default, Clone, Copy, Eq, Hash, PartialEq)]
pub enum CommentLineStrategy {
    /// If it can be.
    #[default]
    SingleLine,
    /// Never.
    Multiline,
    /// If it is.
    Keep,
}

/// How descriptions in JSDoc comments are broken into lines.
#[derive(Debug, Default, Clone, Copy, Eq, Hash, PartialEq)]
pub enum LineWrappingStyle {
    /// As much on each line as fits.
    #[default]
    Greedy,
    /// The lines stay as they are if all of them fit.
    Balance,
}

/// Which white space in HTML counts.
#[derive(Debug, Default, Clone, Copy, Eq, Hash, PartialEq)]
pub enum HtmlWhitespaceSensitivity {
    /// What the default value of the CSS property `display` says.
    #[default]
    Css,
    /// All of it.
    Strict,
    /// None of it.
    Ignore,
}

/// How a paragraph is divided into lines.
#[derive(Debug, Default, Clone, Copy, Eq, Hash, PartialEq)]
pub enum ProseWrap {
    /// At the print width.
    Always,
    /// Not at all.
    Never,
    /// As it is.
    #[default]
    Preserve,
}

/// oxfmt follows an older Prettier (3.8) in a few places, and has a few rules of its own. Whoever
/// has an `.oxfmtrc.json` gets no diff from switching.
#[derive(Debug, Default, Clone, Copy, Eq, Hash, PartialEq)]
pub enum Flavor {
    #[default]
    Prettier,
    Oxfmt,
}

impl Flavor {
    pub const fn is_oxfmt(self) -> bool {
        matches!(self, Flavor::Oxfmt)
    }
}

#[derive(Debug, Default, Clone, Copy, Eq, Hash, PartialEq)]
pub enum IndentStyle {
    Tab,
    #[default]
    Space,
}

impl IndentStyle {
    pub const fn is_tab(self) -> bool {
        matches!(self, IndentStyle::Tab)
    }

    pub const fn is_space(self) -> bool {
        matches!(self, IndentStyle::Space)
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Default)]
pub enum LineEnding {
    #[default]
    Lf,
    Crlf,
    Cr,
    /// That of the first line of the file.
    Auto,
}

impl LineEnding {
    #[inline]
    pub const fn as_bytes(self) -> &'static [u8] {
        match self {
            LineEnding::Lf | LineEnding::Auto => b"\n",
            LineEnding::Crlf => b"\r\n",
            LineEnding::Cr => b"\r",
        }
    }

    /// Prettier's `guessEndOfLine`.
    pub(crate) fn resolve(self, text: &[u8]) -> LineEnding {
        if self != LineEnding::Auto {
            return self;
        }
        match bun_core::strings::index_of_any(text, b"\r\n") {
            Some(at) if text[at] == b'\r' && text.get(at + 1) == Some(&b'\n') => LineEnding::Crlf,
            Some(at) if text[at] == b'\r' => LineEnding::Cr,
            _ => LineEnding::Lf,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct IndentWidth(pub u8);

impl IndentWidth {
    #[inline]
    pub const fn value(self) -> u8 {
        self.0
    }
}

impl Default for IndentWidth {
    fn default() -> Self {
        Self(2)
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct LineWidth(pub u16);

impl LineWidth {
    #[inline]
    pub const fn value(self) -> u16 {
        self.0
    }
}

impl Default for LineWidth {
    fn default() -> Self {
        Self(80)
    }
}

#[derive(Debug, Default, Clone, Copy, Eq, Hash, PartialEq)]
pub enum QuoteStyle {
    #[default]
    Double,
    Single,
}

impl QuoteStyle {
    pub fn from_byte(byte: u8) -> Option<Self> {
        match byte {
            b'"' => Some(Self::Double),
            b'\'' => Some(Self::Single),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Double => "\"",
            Self::Single => "'",
        }
    }

    pub const fn as_byte(self) -> u8 {
        match self {
            Self::Double => b'"',
            Self::Single => b'\'',
        }
    }

    #[must_use]
    pub const fn other(self) -> Self {
        match self {
            Self::Double => Self::Single,
            Self::Single => Self::Double,
        }
    }

    pub const fn is_double(self) -> bool {
        matches!(self, Self::Double)
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
pub enum QuoteProperties {
    #[default]
    AsNeeded,
    Preserve,
    Consistent,
}

impl QuoteProperties {
    pub const fn is_consistent(self) -> bool {
        matches!(self, Self::Consistent)
    }
}

#[derive(Clone, Copy, Default, Debug, Eq, Hash, PartialEq)]
pub enum TrailingCommas {
    #[default]
    All,
    Es5,
    None,
}

impl TrailingCommas {
    pub const fn is_es5(self) -> bool {
        matches!(self, TrailingCommas::Es5)
    }

    pub const fn is_all(self) -> bool {
        matches!(self, TrailingCommas::All)
    }

    pub const fn is_none(self) -> bool {
        matches!(self, TrailingCommas::None)
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
pub enum Semicolons {
    #[default]
    Always,
    AsNeeded,
}

impl Semicolons {
    pub const fn is_as_needed(self) -> bool {
        matches!(self, Self::AsNeeded)
    }

    pub const fn is_always(self) -> bool {
        matches!(self, Self::Always)
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
pub enum ArrowParentheses {
    #[default]
    Always,
    AsNeeded,
}

impl ArrowParentheses {
    pub const fn is_as_needed(self) -> bool {
        matches!(self, Self::AsNeeded)
    }

    pub const fn is_always(self) -> bool {
        matches!(self, Self::Always)
    }
}

/// Where a trailing comma is written if `trailing_commas` allows it: anywhere, or only where
/// ES5 allows one.
#[derive(Debug, Copy, Clone)]
pub enum FormatTrailingCommas {
    All,
    /// After the last argument of a call and the last parameter of a function: like `All`, but Angular takes none there.
    Arguments,
    ES5,
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Default)]
pub enum TrailingSeparator {
    /// Written if the enclosing group breaks.
    #[default]
    Allowed,
    /// A syntax error, after a rest element for example.
    Disallowed,
    Mandatory,
    /// Left out because of the options.
    Omit,
}

impl FormatTrailingCommas {
    pub fn trailing_separator(self, options: &FormatOptions) -> TrailingSeparator {
        match self {
            _ if options.trailing_commas.is_none() => TrailingSeparator::Omit,
            FormatTrailingCommas::All | FormatTrailingCommas::Arguments
                if !options.trailing_commas.is_all() =>
            {
                TrailingSeparator::Omit
            }
            FormatTrailingCommas::Arguments if options.in_html.root.is_angular() => {
                TrailingSeparator::Omit
            }
            FormatTrailingCommas::All
            | FormatTrailingCommas::Arguments
            | FormatTrailingCommas::ES5 => TrailingSeparator::Allowed,
        }
    }
}

impl<'a> Format<'a> for FormatTrailingCommas {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if self.trailing_separator(f.options()) == TrailingSeparator::Allowed {
            if_group_breaks(&token(",")).fmt(f);
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
pub enum AttributePosition {
    #[default]
    Auto,
    Multiline,
}

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
pub enum Expand {
    #[default]
    Auto,
    Never,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct BracketSpacing(pub bool);

impl BracketSpacing {
    #[inline]
    pub const fn value(self) -> bool {
        self.0
    }
}

impl Default for BracketSpacing {
    fn default() -> Self {
        Self(true)
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
pub struct BracketSameLine(pub bool);

impl BracketSameLine {
    #[inline]
    pub const fn value(self) -> bool {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
pub enum OperatorPosition {
    Start,
    #[default]
    End,
}

impl OperatorPosition {
    pub const fn is_start(self) -> bool {
        matches!(self, Self::Start)
    }

    pub const fn is_end(self) -> bool {
        matches!(self, Self::End)
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
pub enum EmbeddedLanguageFormatting {
    #[default]
    Auto,
    Off,
}

impl EmbeddedLanguageFormatting {
    pub const fn is_auto(self) -> bool {
        matches!(self, Self::Auto)
    }

    pub const fn is_off(self) -> bool {
        matches!(self, Self::Off)
    }
}
