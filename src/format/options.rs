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
    /// Whose output to produce where the two differ.
    pub flavor: Flavor,
    /// oxfmt's `sortPackageJson`: the keys of a `package.json` are put in the usual order.
    pub sort_package_json: Option<crate::json::SortPackageJson>,
    /// How imports are sorted, if they are.
    pub sort_imports: Option<std::sync::Arc<crate::sort_imports::SortImports>>,
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
            if value.is_empty() || n > max { Err(InvalidOption) } else { Ok(n) }
        };
        let quotes = |single: bool| if single { QuoteStyle::Single } else { QuoteStyle::Double };
        match name {
            b"printWidth" => self.line_width = LineWidth(number(u32::from(u16::MAX))? as u16),
            b"tabWidth" => self.indent_width = IndentWidth(number(u32::from(u8::MAX))? as u8),
            b"useTabs" => {
                self.indent_style = if boolean()? { IndentStyle::Tab } else { IndentStyle::Space };
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
                self.semicolons = if boolean()? { Semicolons::Always } else { Semicolons::AsNeeded };
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
                self.bracket_same_line = BracketSameLine(boolean()? || self.bracket_same_line.value());
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
            // For languages that are not formatted.
            b"htmlWhitespaceSensitivity" if matches!(value, b"css" | b"strict" | b"ignore") => {}
            b"vueIndentScriptAndStyle" => _ = boolean()?,
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

    /// Whether the formatter does what the options ask for. `experimentalTernaries` and
    /// `experimentalOperatorPosition: "start"` are understood and not implemented.
    pub fn is_supported(&self) -> bool {
        !self.experimental_ternaries && self.experimental_operator_position == OperatorPosition::End
    }
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
            FormatTrailingCommas::All if !options.trailing_commas.is_all() => {
                TrailingSeparator::Omit
            }
            FormatTrailingCommas::All | FormatTrailingCommas::ES5 => TrailingSeparator::Allowed,
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
