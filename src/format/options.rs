//! Prettier's options.
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
    /// For HTML and similar languages.
    pub html_whitespace_sensitivity: HtmlWhitespaceSensitivity,
    pub vue_indent_script_and_style: bool,
    /// For Svelte.
    pub svelte: SvelteOptions,
    /// The file name, if it isn't the one the file was parsed under: text from stdin.
    pub filepath: Option<Box<[u8]>>,
    /// Prettier's `parser`, if it isn't inferred from the file name: `json5`, `babel`, ..
    pub parser: Option<Box<[u8]>>,
    /// Only the text between the two is formatted. As in Prettier, they count UTF-16 code units.
    pub range_start: Option<u32>,
    pub range_end: Option<u32>,
    /// The cursor's position, in UTF-16 code units. Its new position is part of the result.
    pub cursor_offset: Option<u32>,
    /// Puts `@format` in a comment at the top of the file.
    pub insert_pragma: bool,
    /// Only format a file with `@format` or `@prettier` in a comment at its top.
    pub require_pragma: bool,
    /// Don't format a file with `@noformat` or `@noprettier` in a comment at its top.
    pub check_ignore_pragma: bool,
    /// The text is code in Markdown: Prettier's `parentParser`. A statement that's only JSX gets no semicolon. A line
    /// break that's part of a text (in a template, in a comment) is written as `\r\n` to tell it apart from the others,
    /// because Markdown indents what follows it differently.
    pub is_in_markdown: bool,
    /// The text is `<$>`, JSX from MDX, and `</$>`: Prettier's `rootMarker: "mdx"`. Only the part between the two is
    /// printed.
    pub is_mdx_jsx: bool,
    /// The text is `import` and `export` declarations in MDX. Anything else in it is an error: Prettier's
    /// `validateImportExport`.
    pub is_mdx_es_syntax: bool,
    /// Format HTML in JavaScript templates and in Markdown code blocks.
    pub embedded_html: bool,
    /// How many JavaScript templates that are printed as HTML the text is nested in.
    pub html_template_depth: u32,
    /// The text is in a file whose name ends with `.html` or `.htm`, where the HTML5 doctype is printed in lowercase.
    pub is_in_html_file: bool,
    /// Formats the JavaScript and TypeScript in Markdown code blocks. Without it they're left as is.
    pub format_javascript: Option<FormatJavaScript>,
    /// Parses the JavaScript and TypeScript in HTML. Without it they're left as is.
    pub parse_javascript: Option<ParseJavaScript>,
    /// Parses the expressions in a Svelte component. Without it there's no way to find where they end.
    pub parse_parts: Option<ParseParts>,
    /// The code's context, if it's in HTML.
    pub in_html: InHtml,
    /// Which tool's output to match where the two differ.
    pub flavor: Flavor,
    /// How to sort a `package.json`'s keys, if at all: oxfmt's `sortPackageJson`, or `prettier-plugin-packagejson`.
    pub sort_package_json: Option<crate::json::SortPackageJson>,
    /// How to sort imports, if at all.
    pub sort_imports: Option<std::sync::Arc<crate::sort_imports::SortImports>>,
    /// oxfmt's `jsdoc`: how to format JSDoc comments, if at all.
    pub jsdoc: Option<JsdocOptions>,
    /// oxfmt's `sortTailwindcss`: how to sort Tailwind CSS classes, if at all.
    pub tailwind: Option<std::sync::Arc<crate::tailwind::Tailwind>>,
    /// Format TOML even in Prettier's flavor. Only the caller that detects file types reads this.
    pub toml: bool,
    /// For tests: what to output instead of the formatted text.
    pub debug_comments: DebugComments,
}

#[derive(Debug, Default, Copy, Clone, PartialEq, Eq)]
pub enum DebugComments {
    #[default]
    Off,
    /// Every comment and the node that owns it.
    Owners,
    /// The comments that no printer printed, which is a bug.
    Unprinted,
}

/// Formats JavaScript or TypeScript, which this crate can't parse by itself. It gets a file name that tells which of
/// the two it is, the code, the options, and a buffer to append the result to. Returns true if the code could be
/// formatted.
pub type FormatJavaScript = fn(&[u8], &[u8], &FormatOptions, &mut Vec<u8>) -> bool;

/// Code to parse.
#[derive(Copy, Clone)]
pub struct Code<'c> {
    /// A file name that tells if it's JavaScript or TypeScript.
    pub path: &'c [u8],
    pub text: &'c [u8],
    pub is_script: bool,
}

/// The callback that gets the file parsed from [`Code`], with or without errors.
pub type Then<'t> = &'t mut dyn for<'b> FnMut(&'b bun_lint::ast::File<'b>);

/// Parses JavaScript or TypeScript, which this crate can't do by itself, and passes the result to the callback.
pub type ParseJavaScript = fn(Code<'_>, Then<'_>);

/// The same for a caller that reuses its parser state: a text can contain many pieces of code.
pub type JavaScriptParser<'p> = &'p dyn Fn(Code<'_>, Then<'_>);

/// The kind of a [`Part`].
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum Goal {
    /// An expression, including commas.
    Expression,
    /// A `let`, `const` or `var`.
    Declaration,
    Type,
}

/// Code in a text, whose end only a parser can find. More text can follow it, in any language.
#[derive(Debug, Copy, Clone)]
pub struct Part {
    pub goal: Goal,
    /// Its start in the text.
    pub from: u32,
    /// The end of the text that the parser sees.
    pub until: u32,
    pub is_typescript: bool,
}

/// The callback that gets the file parsed from a [`Part`], and the part's end in that file, including the parentheses
/// around it. The file's text starts where the part starts, and the part is its only statement. A type is parsed as the
/// type of an alias.
pub type ThenWithEnd<'t> = &'t mut dyn for<'b> FnMut(&'b bun_lint::ast::File<'b>, u32);

/// Why a [`Part`] can't be parsed.
#[derive(Debug, Copy, Clone)]
pub struct PartError {
    /// The position of the first error in the text.
    pub at: u32,
    pub is_nested_too_deeply: bool,
}

/// Parses a part of the text that it was created for.
pub type ParsePart<'p> = &'p mut dyn FnMut(Part, ThenWithEnd<'_>) -> Result<(), PartError>;

/// Passes the callback a parser for a text's parts.
pub type ParseParts = fn(&[u8], &mut dyn FnMut(ParsePart<'_>));

/// The context Prettier passes to the formatter for code in HTML: the options whose names start with `__`, and the
/// parsers for less than a whole program.
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
    /// `singleQuote`, which `quote_style` doesn't reflect in an attribute.
    pub quote_style: QuoteStyle,
    /// `singleQuote: true`, regardless of the options: what `prettier-plugin-svelte` asks for between double quotes.
    pub has_single_quotes: bool,
    /// The parser is `babel-ts`: TypeScript in Babel's tree.
    pub has_babel_tree: bool,
}

/// The kind of code.
#[derive(Debug, Default, Copy, Clone, PartialEq, Eq)]
pub enum HtmlRoot {
    /// It isn't in HTML.
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
    /// `svelteExpressionParser`, `svelteTSExpressionParser`: the root is a `File` whose `program` is an expression, or a function.
    SvelteExpression,
    /// `svelteStatementParser`, `svelteTSStatementParser`: the same with a statement, which loses its `;`.
    SvelteStatement,
}

impl HtmlRoot {
    /// Prettier's `NGRoot`: the code is an Angular expression, where `a | b(c)` represents the pipe `a | b: c`.
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

/// The parts of a Svelte component.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum SveltePart {
    Options,
    Scripts,
    Markup,
    Styles,
}

impl SveltePart {
    /// `options-scripts-markup-styles` and similar: each of the four once.
    fn order(value: &[u8]) -> Option<[SveltePart; 4]> {
        let mut order = Vec::with_capacity(4);
        for name in bun_core::strings::split(value, b"-") {
            let part = match name {
                b"options" => SveltePart::Options,
                b"scripts" => SveltePart::Scripts,
                b"markup" => SveltePart::Markup,
                b"styles" => SveltePart::Styles,
                _ => return None,
            };
            if order.contains(&part) {
                return None;
            }
            order.push(part);
        }
        <[SveltePart; 4]>::try_from(order).ok()
    }
}

/// `prettier-plugin-svelte`'s options. They have shorter names in oxfmt's and `[fmt]`'s `svelte`.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub struct SvelteOptions {
    /// `svelteSortOrder`, `svelte.sortOrder`. `None` is `"none"`.
    pub sort_order: Option<[SveltePart; 4]>,
    /// `svelteAllowShorthand`, `svelte.allowShorthand`
    pub allows_shorthand: bool,
    /// `svelteIndentScriptAndStyle`, `svelte.indentScriptAndStyle`
    pub indents_script_and_style: bool,
    /// Format components, and Svelte code blocks in Markdown. For components only the caller that detects file types
    /// reads this.
    pub is_on: bool,
}

impl Default for SvelteOptions {
    fn default() -> Self {
        SvelteOptions {
            sort_order: Some([
                SveltePart::Options,
                SveltePart::Scripts,
                SveltePart::Markup,
                SveltePart::Styles,
            ]),
            allows_shorthand: true,
            indents_script_and_style: true,
            is_on: false,
        }
    }
}

/// An option has a value that Prettier doesn't accept, or there's no such option.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub struct InvalidOption;

impl FormatOptions {
    /// Sets the option that Prettier calls `name`. `value` is raw JSON, except that a string has no quotes.
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
        // What Prettier accepts as an integer: `Number(value)` of the command line argument, including `Infinity`.
        let integer = || match bun_core::fmt::js_string_to_number(value) {
            it if it.is_nan() || (it.is_finite() && it.fract() != 0.0) => Err(InvalidOption),
            it => Ok(it),
        };
        let quotes = |single: bool| {
            if single {
                QuoteStyle::Single
            } else {
                QuoteStyle::Double
            }
        };
        match name {
            // The cast clamps a negative width to 0 and a huge one to the maximum.
            b"printWidth" => self.line_width = LineWidth(integer()? as u32),
            // Prettier fails when it repeats a space a negative number of times.
            b"tabWidth" => match integer()? {
                it if it < 0.0 => return Err(InvalidOption),
                it => self.indent_width = IndentWidth(it as u32),
            },
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
            // Its name before 2.4. Setting either of the two is enough.
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
            b"svelteSortOrder" | b"svelte.sortOrder" => {
                self.svelte.sort_order = match value {
                    b"none" => None,
                    _ => Some(SveltePart::order(value).ok_or(InvalidOption)?),
                };
            }
            b"svelteAllowShorthand" | b"svelte.allowShorthand" => {
                self.svelte.allows_shorthand = boolean()?
            }
            b"svelteIndentScriptAndStyle" | b"svelte.indentScriptAndStyle" => {
                self.svelte.indents_script_and_style = boolean()?
            }
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
            // oxfmt's option: `true`, `false` or `{ "sortScripts": true }`.
            b"sortPackageJson" => self.sort_package_json = boolean()?.then(Default::default),
            b"sortPackageJson.sortScripts" => {
                self.sort_package_json.get_or_insert_default().sort_scripts = boolean()?;
            }
            // oxfmt's option: `true`, `false` or an object, whose properties arrive as `jsdoc.<name>`.
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
            // Not a Prettier option. The kind of configuration file decides.
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

/// oxfmt's `jsdoc`, which has prettier-plugin-jsdoc's options.
#[derive(Debug, Clone, Copy, Eq, Hash, PartialEq)]
pub struct JsdocOptions {
    /// Capitalize the first letter of a description.
    pub capitalize_descriptions: bool,
    pub comment_line_strategy: CommentLineStrategy,
    /// An empty line between tags of different kinds.
    pub separate_tag_groups: bool,
    /// An empty line between the last `@param` and `@returns`.
    pub separate_returns_from_param: bool,
    /// `{ string }` instead of `{string}`.
    pub bracket_spacing: bool,
    /// End a description with a dot.
    pub description_with_dot: bool,
    /// "Default is `value`" at the end of the description of `@param [name=value]`.
    pub add_default_to_description: bool,
    /// Put code without a language between fences instead of indenting it.
    pub prefer_code_fences: bool,
    pub line_wrapping_style: LineWrappingStyle,
    /// Put the description after `@description`.
    pub description_tag: bool,
    /// Keep the indentation of an `@example` that can't be parsed.
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

/// When a JSDoc comment goes on one line.
#[derive(Debug, Default, Clone, Copy, Eq, Hash, PartialEq)]
pub enum CommentLineStrategy {
    /// Whenever it can.
    #[default]
    SingleLine,
    /// Never.
    Multiline,
    /// If it already is.
    Keep,
}

/// How descriptions in JSDoc comments are wrapped.
#[derive(Debug, Default, Clone, Copy, Eq, Hash, PartialEq)]
pub enum LineWrappingStyle {
    /// As much on each line as fits.
    #[default]
    Greedy,
    /// The lines stay as they are if they all fit.
    Balance,
}

/// Which whitespace in HTML is significant.
#[derive(Debug, Default, Clone, Copy, Eq, Hash, PartialEq)]
pub enum HtmlWhitespaceSensitivity {
    /// Decided by the default value of the CSS property `display`.
    #[default]
    Css,
    /// All of it.
    Strict,
    /// None of it.
    Ignore,
}

/// How a paragraph is wrapped.
#[derive(Debug, Default, Clone, Copy, Eq, Hash, PartialEq)]
pub enum ProseWrap {
    /// At the print width.
    Always,
    /// Not at all.
    Never,
    /// As in the source.
    #[default]
    Preserve,
}

/// oxfmt follows an older Prettier (3.8) in a few places, and has a few rules of its own. A project with an
/// `.oxfmtrc.json` gets no diff from switching.
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

    /// True if a comment that contains only `text` means that the code after it is left as is. oxfmt also recognizes
    /// Prettier's comment. Prettier only recognizes its own.
    pub fn is_ignore_comment(self, text: &[u8]) -> bool {
        text == b"prettier-ignore" || (text == b"oxfmt-ignore" && self.is_oxfmt())
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
    /// The line ending of the file's first line.
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

    /// Prettier's `guessEndOfLine`: the first `\r` decides, even if lines before it end in `\n`.
    pub(crate) fn resolve(self, text: &[u8]) -> LineEnding {
        if self != LineEnding::Auto {
            return self;
        }
        match bun_core::strings::index_of_char_usize(text, b'\r') {
            Some(at) if text.get(at + 1) == Some(&b'\n') => LineEnding::Crlf,
            Some(_) => LineEnding::Cr,
            None => LineEnding::Lf,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct IndentWidth(pub u32);

impl IndentWidth {
    #[inline]
    pub const fn value(self) -> u32 {
        self.0
    }
}

impl Default for IndentWidth {
    fn default() -> Self {
        Self(2)
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct LineWidth(pub u32);

impl LineWidth {
    #[inline]
    pub const fn value(self) -> u32 {
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
}

/// Where a trailing comma is printed if `trailing_commas` allows it: anywhere, or only where ES5 allows one.
#[derive(Debug, Copy, Clone)]
pub enum FormatTrailingCommas {
    All,
    /// After a call's last argument and a function's last parameter: like `All`, but Angular doesn't accept one there.
    Arguments,
    ES5,
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Default)]
pub enum TrailingSeparator {
    /// Printed if the enclosing group breaks.
    #[default]
    Allowed,
    /// A syntax error, after a rest element for example.
    Disallowed,
    Mandatory,
    /// Omitted because of the options.
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
