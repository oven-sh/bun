//! Declarations: from `name: value` to longhands with their CSSOM text.

use core::ptr::NonNull;

use bun_alloc::Arena;
use bun_ast::ImportRecord;
use bun_core::strings;

use super::properties::{self, PropertyInfo, Syntax, flag, id, kind};
use super::{Declaration, FLAG_QUIRKS_MODE, FLAG_RESOLVE_COLORS, StringRange};
use crate::css_parser::{
    AtRuleParser, BasicParseErrorKind, CssResult, DeclarationParser, Delimiters, Maybe, Parser,
    ParserError, ParserInput, ParserOptions, ParserOpts, ParserState, QualifiedRuleParser,
    RuleBodyItemParser, RuleBodyParser, Token, Tokenizer, color, parse_important,
};
use crate::generics::ToCss as _;
use crate::printer::{ImportInfo, Printer, PrinterOptions};
use crate::properties::custom::TokenList;
use crate::properties::{Property, PropertyId};
use crate::values::color::{CssColor, RGBA};
use crate::values::length::{Length, LengthPercentage};
use crate::values::number::{CSSIntegerFns, CSSNumberFns};
use crate::values::percentage::Percentage;
use crate::{PrintErr, VendorPrefix};

type PrintResult = Result<(), PrintErr>;
/// Writes one value.
type Print<'p> = &'p dyn Fn(&mut Printer) -> PrintResult;

const CSS_WIDE_KEYWORDS: [&[u8]; 5] =
    [b"initial", b"inherit", b"unset", b"revert", b"revert-layer"];

/// What one pass over the tokens of a value finds.
struct Scan {
    /// No bad string, no bad URL, no stray `)`, `]`, `}`, `;` or `!`.
    is_valid: bool,
    /// It has `var()` or `env()` in it, so it cannot be checked before it is used.
    has_references: bool,
    /// The value, if it is one identifier.
    single_identifier: Option<&'static [u8]>,
    /// The value is one `calc()`.
    is_single_calc: bool,
    /// It has `color-mix()` in it, which Bun's parser computes and the CSSOM keeps.
    has_color_mix: bool,
    /// It has `url()` in it, which the CSSOM writes with quotes.
    has_url: bool,
    /// The color keywords in it, in lower case.
    color_names: Vec<(RGBA, &'static [u8])>,
    /// What closes the blocks that the end of the input left open.
    missing_closers: Vec<u8>,
}

fn scan(value: &[u8], arena: &Arena, is_custom_property: bool) -> Scan {
    let mut result = Scan {
        is_valid: true,
        has_references: false,
        single_identifier: None,
        is_single_calc: false,
        has_color_mix: false,
        has_url: false,
        color_names: Vec::new(),
        missing_closers: Vec::new(),
    };
    let mut top_level_components = 0u32;
    let mut first_identifier: Option<&'static [u8]> = None;
    let mut starts_with_calc = false;

    let mut tokenizer = Tokenizer::init_with_arena(value, arena);
    while let Ok(token) = tokenizer.next() {
        if matches!(token, Token::Whitespace(_) | Token::Comment(_)) {
            continue;
        }
        let is_top_level = result.missing_closers.is_empty();
        let closer = match token {
            Token::CloseParen => Some(b')'),
            Token::CloseSquare => Some(b']'),
            Token::CloseCurly => Some(b'}'),
            _ => None,
        };
        if let Some(closer) = closer {
            if result.missing_closers.pop() != Some(closer) {
                result.is_valid = false;
                return result;
            }
            continue;
        }
        if is_top_level {
            top_level_components += 1;
        }
        match token {
            Token::BadString(_) | Token::BadUrl(_) => result.is_valid = false,
            Token::Semicolon if is_top_level => result.is_valid = false,
            Token::Delim(delim) if is_top_level && delim == u32::from(b'!') => {
                result.is_valid = false;
            }
            Token::Function(name) => {
                if name.eq_ignore_ascii_case(b"var") || name.eq_ignore_ascii_case(b"env") {
                    result.has_references = true;
                }
                result.has_color_mix |= name.eq_ignore_ascii_case(b"color-mix");
                result.has_url |= name.eq_ignore_ascii_case(b"url");
                if top_level_components == 1 && is_top_level {
                    starts_with_calc = name.eq_ignore_ascii_case(b"calc");
                }
                result.missing_closers.push(b')');
            }
            Token::UnquotedUrl(_) => result.has_url = true,
            Token::OpenParen => result.missing_closers.push(b')'),
            Token::OpenSquare => result.missing_closers.push(b']'),
            Token::OpenCurly => {
                if is_top_level && !is_custom_property {
                    result.is_valid = false;
                }
                result.missing_closers.push(b'}');
            }
            Token::Ident(name) => {
                if top_level_components == 1 && is_top_level {
                    first_identifier = Some(name);
                }
                if let Some(entry) = color_name(name, arena) {
                    if !result.color_names.contains(&entry) {
                        result.color_names.push(entry);
                    }
                }
            }
            _ => {}
        }
        if !result.is_valid {
            return result;
        }
    }

    if top_level_components == 1 {
        result.single_identifier = first_identifier;
        result.is_single_calc = starts_with_calc;
    }
    result.missing_closers.reverse();
    result
}

fn color_name(name: &[u8], arena: &Arena) -> Option<(RGBA, &'static [u8])> {
    // The longest is `lightgoldenrodyellow`.
    let mut buffer = [0u8; 20];
    let lowercase = buffer.get_mut(..name.len())?;
    lowercase.copy_from_slice(name);
    lowercase.make_ascii_lowercase();
    let lowercase: &[u8] = lowercase;

    let rgba = if lowercase == b"transparent" {
        RGBA::transparent()
    } else {
        let (red, green, blue) = color::parse_named_color(lowercase)?;
        RGBA {
            red,
            green,
            blue,
            alpha: 255,
        }
    };
    // SAFETY: the arena outlives the `Scan`, like the payload of every `Token`.
    let stored = unsafe { crate::css_parser::src_str(arena.alloc_slice_copy(lowercase)) };
    Some((rgba, stored))
}

/// The parts of a value between white space, or between a delimiter, outside of blocks and functions. Without the white space around them.
fn split_at_top_level<'v>(value: &'v [u8], arena: &Arena, delimiter: Option<u8>) -> Vec<&'v [u8]> {
    let mut parts = Vec::new();
    let mut depth = 0u32;
    let mut start = 0;
    let mut tokenizer = Tokenizer::init_with_arena(value, arena);
    loop {
        let position = tokenizer.get_position();
        let Ok(token) = tokenizer.next() else {
            break;
        };
        match token {
            Token::Function(_) | Token::OpenParen | Token::OpenSquare | Token::OpenCurly => {
                depth += 1
            }
            Token::CloseParen | Token::CloseSquare | Token::CloseCurly => {
                depth = depth.saturating_sub(1);
            }
            _ => {}
        }
        let is_separator = depth == 0
            && match (delimiter, token) {
                (None, Token::Whitespace(_) | Token::Comment(_)) => true,
                (Some(delimiter), Token::Delim(delim)) => delim == u32::from(delimiter),
                _ => false,
            };
        if is_separator {
            parts.push(value[start..position].trim_ascii());
            start = tokenizer.get_position();
        }
    }
    parts.push(value[start..].trim_ascii());
    if delimiter.is_none() {
        parts.retain(|part| !part.is_empty());
    }
    parts
}

/// One identifier that is a name and not a keyword of `<grid-line>`.
fn is_custom_identifier(text: &[u8]) -> bool {
    let is_name_start = |byte: u8| byte.is_ascii_alphabetic() || byte == b'_' || byte >= 0x80;
    let starts_like_one = match text {
        [first, ..] if is_name_start(*first) => true,
        [b'-', second, ..] => is_name_start(*second) || *second == b'-',
        _ => false,
    };
    starts_like_one
        && !text
            .iter()
            .any(|byte| byte.is_ascii_whitespace() || *byte == b'(')
        && !text.eq_ignore_ascii_case(b"auto")
        && !text.eq_ignore_ascii_case(b"span")
}

/// Whether a component of the value, outside of functions, is a negative number.
fn has_negative_component(text: &[u8]) -> bool {
    let mut depth = 0u32;
    let mut at_start_of_component = true;
    for (index, &byte) in text.iter().enumerate() {
        match byte {
            b'(' => depth += 1,
            b')' => depth = depth.saturating_sub(1),
            b'-' if depth == 0 && at_start_of_component => {
                if matches!(text.get(index + 1), Some(b'0'..=b'9' | b'.')) {
                    return true;
                }
            }
            _ => {}
        }
        at_start_of_component = matches!(byte, b' ' | b',' | b'/');
    }
    false
}

/// Collects declarations. One for each call across the C ABI.
pub(crate) struct DeclarationSink<'a> {
    arena: &'a Arena,
    options: ParserOptions<'a>,
    symbols: bun_ast::symbol::Map,
    flags: u32,
    pub(crate) declarations: Vec<Declaration>,
    pub(crate) strings: Vec<u8>,
}

/// The declaration that is being expanded.
#[derive(Clone, Copy)]
struct Shorthand {
    property: u16,
    text: StringRange,
    is_important: bool,
}

impl<'a> DeclarationSink<'a> {
    pub(crate) fn new(arena: &'a Arena, flags: u32) -> DeclarationSink<'a> {
        DeclarationSink {
            arena,
            options: ParserOptions::default(None),
            symbols: bun_ast::symbol::Map::init_list(Default::default()),
            flags,
            declarations: Vec::new(),
            strings: Vec::new(),
        }
    }

    pub(crate) fn finish(self) -> (Vec<Declaration>, Vec<u8>) {
        (self.declarations, self.strings)
    }

    pub(crate) fn arena(&self) -> &'a Arena {
        self.arena
    }

    pub(crate) fn parser_opts(&self) -> ParserOpts {
        if self.flags & FLAG_QUIRKS_MODE != 0 {
            ParserOpts::empty()
        } else {
            ParserOpts::NO_UNITLESS_LENGTHS
        }
    }

    // ─── Text ───

    pub(crate) fn push_str(&mut self, text: &[u8]) -> StringRange {
        let offset = self.strings.len();
        self.strings.extend_from_slice(text);
        range(offset, text.len())
    }

    fn text(&self, range: StringRange) -> &[u8] {
        &self.strings[range.offset as usize..][..range.length as usize]
    }

    /// The value as it was written, with the blocks closed that the end of the input left open.
    fn push_verbatim(&mut self, value: &[u8], scan: &Scan) -> StringRange {
        let offset = self.strings.len();
        self.strings.extend_from_slice(value);
        self.strings.extend_from_slice(&scan.missing_closers);
        range(offset, self.strings.len() - offset)
    }

    /// None if the value cannot be printed.
    pub(crate) fn print(
        &mut self,
        color_names: &[(RGBA, &'static [u8])],
        import_records: &[ImportRecord],
        print: Print<'_>,
    ) -> Option<StringRange> {
        let start = self.strings.len();
        let color_names: &[(RGBA, &'static [u8])] = if self.flags & FLAG_RESOLVE_COLORS != 0 {
            &[]
        } else {
            color_names
        };
        let printer_options = PrinterOptions::default();
        let result = {
            let mut printer = Printer::new(
                self.arena,
                bun_alloc::ArenaVec::new_in(self.arena),
                &mut self.strings,
                &printer_options,
                Some(ImportInfo::init_outside_of_bundler(import_records)),
                None,
                &self.symbols,
            );
            printer.cssom = Some(color_names);
            print(&mut printer)
        };
        if result.is_err() {
            self.strings.truncate(start);
            return None;
        }

        // A few printers write a space first.
        let leading = self.strings[start..]
            .iter()
            .take_while(|byte| **byte == b' ')
            .count();
        while self.strings.len() > start + leading && self.strings.last() == Some(&b' ') {
            self.strings.pop();
        }
        Some(range(start + leading, self.strings.len() - start - leading))
    }

    // ─── Parsing ───

    /// None unless `parse` takes the whole value.
    fn parse_entirely<T>(
        &self,
        value: &[u8],
        import_records: Option<&mut Vec<ImportRecord>>,
        parse: impl FnOnce(&mut Parser) -> CssResult<T>,
    ) -> Option<T> {
        let mut input = ParserInput::new(value, self.arena);
        let mut parser = Parser::new(
            &mut input,
            import_records.map(NonNull::from),
            self.parser_opts(),
            None,
        );
        let result = parse(&mut parser).ok()?;
        parser.expect_exhausted().ok()?;
        Some(result)
    }

    /// The content of a style attribute or of a style rule's block, without nested rules.
    pub(crate) fn parse_declaration_list(&mut self, text: &[u8]) {
        let mut input = ParserInput::new(text, self.arena);
        let mut parser = Parser::new(&mut input, None, self.parser_opts(), None);
        let mut list_parser = DeclarationListParser { sink: self };
        let mut body = RuleBodyParser::new(&mut parser, &mut list_parser);
        while let Some(result) = body.next() {
            // An invalid declaration is left out.
            let _ = result;
        }
    }

    /// `input` ends where the declaration ends.
    pub(crate) fn parse_declaration(&mut self, name: &[u8], input: &mut Parser) -> CssResult<()> {
        input.skip_whitespace();
        let start = input.position();
        input.parse_until_before(Delimiters::BANG, |input| {
            while input.next().is_ok() {}
            Ok(())
        })?;
        let value = input.slice_from_cloned(start);
        let is_important = input.try_parse(parse_important).is_ok();
        input.expect_exhausted()?;

        let is_valid = if name.starts_with(b"--") {
            self.parse_custom_property(name, value, is_important)
        } else {
            match properties::find(name) {
                Some(property) => self.parse_property(property, value, is_important),
                None => false,
            }
        };
        if is_valid {
            Ok(())
        } else {
            Err(input.new_custom_error(ParserError::invalid_declaration))
        }
    }

    /// Whether `name: value` would be kept. Adds nothing.
    pub(crate) fn supports_declaration(&mut self, name: &[u8], value: &[u8]) -> bool {
        let declaration_count = self.declarations.len();
        let strings_length = self.strings.len();
        let is_valid = if name.starts_with(b"--") {
            self.parse_custom_property(name, value, false)
        } else {
            match properties::find(name) {
                Some(property) => self.parse_property(property, value, false),
                None => false,
            }
        };
        self.declarations.truncate(declaration_count);
        self.strings.truncate(strings_length);
        is_valid
    }

    pub(crate) fn parse_custom_property(
        &mut self,
        name: &[u8],
        value: &[u8],
        is_important: bool,
    ) -> bool {
        let value = value.trim_ascii();
        let scan = scan(value, self.arena, true);
        if !scan.is_valid {
            return false;
        }
        let name = self.push_str(name);
        let value = match scan.single_identifier.and_then(css_wide_keyword) {
            Some(keyword) => self.push_str(keyword),
            None => self.push_verbatim(value, &scan),
        };
        self.declarations.push(Declaration {
            property: properties::CUSTOM,
            shorthand: 0,
            is_important,
            has_variable_references: false,
            name,
            value,
            shorthand_value: StringRange::default(),
        });
        true
    }

    /// Adds the longhands the declaration stands for. Adds nothing and returns false if the value is not valid.
    pub(crate) fn parse_property(
        &mut self,
        property: u16,
        value: &[u8],
        is_important: bool,
    ) -> bool {
        let declaration_count = self.declarations.len();
        let strings_length = self.strings.len();
        let is_valid = self
            .parse_property_impl(property, value, is_important)
            .is_some();
        if !is_valid {
            self.declarations.truncate(declaration_count);
            self.strings.truncate(strings_length);
        }
        is_valid
    }

    fn parse_property_impl(
        &mut self,
        property: u16,
        value: &[u8],
        is_important: bool,
    ) -> Option<()> {
        let info = properties::info(property)?;
        let value = value.trim_ascii();
        if value.is_empty() {
            return None;
        }
        let scan = scan(value, self.arena, false);
        if !scan.is_valid {
            return None;
        }

        if let Some(keyword) = scan.single_identifier.and_then(css_wide_keyword) {
            let text = self.push_str(keyword);
            if info.longhands.is_empty() {
                self.declare(property, text, is_important);
            } else {
                let shorthand = Shorthand {
                    property,
                    text,
                    is_important,
                };
                for &longhand in info.longhands {
                    self.declare_longhand(shorthand, longhand, text, false);
                }
            }
            return Some(());
        }

        if matches!(info.syntax, Syntax::All) {
            return None;
        }

        if scan.has_references {
            let text = self.push_verbatim(value, &scan);
            if info.longhands.is_empty() {
                self.declare(property, text, is_important);
            } else {
                let shorthand = Shorthand {
                    property,
                    text,
                    is_important,
                };
                for &longhand in info.longhands {
                    self.declare_longhand(shorthand, longhand, StringRange::default(), true);
                }
            }
            return Some(());
        }

        let text = match info.syntax {
            Syntax::Typed | Syntax::TypedVerbatim => {
                return self.parse_typed(property, info, value, &scan, is_important);
            }
            Syntax::Simple { .. } if property == id::CLIP && scan.single_identifier.is_none() => {
                self.parse_clip_rect(value)?
            }
            Syntax::Simple { keywords, kinds } => {
                self.parse_simple(value, &scan, keywords, kinds)?
            }
            Syntax::Tokens { keywords } => match scan.single_identifier {
                Some(identifier) if !keywords.is_empty() => {
                    let keyword = strings::split(keywords, b" ")
                        .find(|keyword| keyword.eq_ignore_ascii_case(identifier))?;
                    self.push_str(keyword)
                }
                _ => self.parse_tokens(value, &scan)?,
            },
            Syntax::Verbatim => self.push_verbatim(value, &scan),
            Syntax::Expanded => {
                return self.parse_expanded(property, info, value, &scan, is_important);
            }
            Syntax::All => return None,
        };
        self.declare(property, text, is_important);
        Some(())
    }

    fn declare(&mut self, property: u16, value: StringRange, is_important: bool) {
        self.declarations.push(Declaration {
            property,
            shorthand: 0,
            is_important,
            has_variable_references: false,
            name: StringRange::default(),
            value,
            shorthand_value: StringRange::default(),
        });
    }

    fn declare_longhand(
        &mut self,
        shorthand: Shorthand,
        longhand: u16,
        value: StringRange,
        has_variable_references: bool,
    ) {
        self.declarations.push(Declaration {
            property: longhand,
            shorthand: shorthand.property,
            is_important: shorthand.is_important,
            has_variable_references,
            name: StringRange::default(),
            value,
            shorthand_value: shorthand.text,
        });
    }

    /// What the types of Bun's parser let through and the property does not take.
    fn is_allowed(&self, property: u16, value: StringRange) -> bool {
        let Some(info) = properties::info(property) else {
            return false;
        };
        let text = self.text(value);
        if info.flags & flag::NON_NEGATIVE != 0 && has_negative_component(text) {
            return false;
        }
        if info.flags & flag::NO_AUTO != 0 && text == b"auto" {
            return false;
        }
        // A number from 1 to 1000.
        if property == id::FONT_WEIGHT && text.first().is_some_and(u8::is_ascii_digit) {
            let integer_digits = text.iter().take_while(|byte| byte.is_ascii_digit()).count();
            if integer_digits > 4
                || text.starts_with(b"0")
                || (integer_digits == 4 && text != b"1000")
            {
                return false;
            }
        }
        true
    }

    /// The text that a part of a shorthand's value has as a value of the longhand. Declares nothing.
    fn longhand_text(&mut self, longhand: u16, value: &[u8]) -> Option<StringRange> {
        // `inherit` and the like are only valid as the whole value.
        if css_wide_keyword(value).is_some() || !self.parse_property(longhand, value, false) {
            return None;
        }
        self.declarations.pop().map(|declaration| declaration.value)
    }

    fn parse_expanded(
        &mut self,
        property: u16,
        info: &'static PropertyInfo,
        value: &[u8],
        scan: &Scan,
        is_important: bool,
    ) -> Option<()> {
        let values = match property {
            id::TEXT_DECORATION => self.expand_text_decoration(value)?,
            id::LIST_STYLE => self.expand_list_style(value)?,
            id::GRID_ROW | id::GRID_COLUMN | id::GRID_AREA => {
                self.expand_grid_lines(value, info.longhands.len())?
            }
            _ => return None,
        };
        debug_assert!(values.len() == info.longhands.len());
        let shorthand = Shorthand {
            property,
            text: self.push_verbatim(value, scan),
            is_important,
        };
        for (&longhand, &text) in info.longhands.iter().zip(&values) {
            self.declare_longhand(shorthand, longhand, text, false);
        }
        Some(())
    }

    /// `<line> || <style> || <color> || <thickness>`
    fn expand_text_decoration(&mut self, value: &[u8]) -> Option<Vec<StringRange>> {
        const LINES: [&[u8]; 4] = [b"underline", b"overline", b"line-through", b"blink"];
        let mut has_line = [false; 4];
        let mut is_none = false;
        let (mut style, mut color, mut thickness) = (None, None, None);
        for component in split_at_top_level(value, self.arena, None) {
            if component.eq_ignore_ascii_case(b"none") && !is_none {
                is_none = true;
            } else if let Some(index) = LINES
                .iter()
                .position(|line| line.eq_ignore_ascii_case(component))
            {
                if core::mem::replace(&mut has_line[index], true) {
                    return None;
                }
            } else if style.is_none()
                && let Some(text) = self.longhand_text(id::TEXT_DECORATION_STYLE, component)
            {
                style = Some(text);
            } else if thickness.is_none()
                && let Some(text) = self.longhand_text(id::TEXT_DECORATION_THICKNESS, component)
            {
                thickness = Some(text);
            } else if color.is_none()
                && let Some(text) = self.longhand_text(id::TEXT_DECORATION_COLOR, component)
            {
                color = Some(text);
            } else {
                return None;
            }
        }
        if is_none && has_line.contains(&true) {
            return None;
        }

        let offset = self.strings.len();
        for (line, _) in LINES.iter().zip(has_line).filter(|(_, has_line)| *has_line) {
            if self.strings.len() > offset {
                self.strings.push(b' ');
            }
            self.strings.extend_from_slice(line);
        }
        if self.strings.len() == offset {
            self.strings.extend_from_slice(b"none");
        }
        let line = range(offset, self.strings.len() - offset);
        Some(vec![
            line,
            style.unwrap_or_else(|| self.push_str(b"solid")),
            color.unwrap_or_else(|| self.push_str(b"currentcolor")),
            thickness.unwrap_or_else(|| self.push_str(b"auto")),
        ])
    }

    /// `<position> || <image> || <type>`. A `none` is for the image or the type, whichever has no value of its own.
    fn expand_list_style(&mut self, value: &[u8]) -> Option<Vec<StringRange>> {
        let mut none_count = 0;
        let (mut position, mut image, mut list_type) = (None, None, None);
        for component in split_at_top_level(value, self.arena, None) {
            if component.eq_ignore_ascii_case(b"none") {
                none_count += 1;
            } else if position.is_none()
                && let Some(text) = self.longhand_text(id::LIST_STYLE_POSITION, component)
            {
                position = Some(text);
            } else if strings::contains_char(component, b'(') {
                if image.is_some() {
                    return None;
                }
                image = Some(self.longhand_text(id::LIST_STYLE_IMAGE, component)?);
            } else {
                if list_type.is_some() {
                    return None;
                }
                list_type = Some(self.longhand_text(id::LIST_STYLE_TYPE, component)?);
            }
        }
        let free = usize::from(image.is_none()) + usize::from(list_type.is_none());
        if none_count > free {
            return None;
        }
        let is_none = none_count > 0;
        Some(vec![
            position.unwrap_or_else(|| self.push_str(b"outside")),
            image.unwrap_or_else(|| self.push_str(b"none")),
            list_type.unwrap_or_else(|| self.push_str(if is_none { b"none" } else { b"disc" })),
        ])
    }

    /// `a / b`, or `a / b / c / d` for grid-area. A line that is left out is `auto`, or the name its opposite line has.
    fn expand_grid_lines(&mut self, value: &[u8], count: usize) -> Option<Vec<StringRange>> {
        let lines = split_at_top_level(value, self.arena, Some(b'/'));
        if lines.is_empty() || lines.len() > count || lines.iter().any(|line| line.is_empty()) {
            return None;
        }
        let mut values: Vec<StringRange> = Vec::with_capacity(count);
        for index in 0..count {
            let text = match lines.get(index) {
                Some(line) => self.push_str(line),
                None => {
                    // grid-area: row-start / column-start / row-end / column-end.
                    let opposite = values[if index == 3 { 1 } else { 0 }];
                    if is_custom_identifier(self.text(opposite)) {
                        opposite
                    } else {
                        self.push_str(b"auto")
                    }
                }
            };
            values.push(text);
        }
        Some(values)
    }

    fn parse_tokens(&mut self, value: &[u8], scan: &Scan) -> Option<StringRange> {
        let mut import_records: Vec<ImportRecord> = Vec::new();
        let tokens = self.parse_entirely(value, Some(&mut import_records), |input| {
            TokenList::parse(input, &self.options, 0)
        })?;
        self.print(&scan.color_names, &import_records, &|dest| {
            tokens.to_css(dest, false)
        })
    }

    fn parse_simple(
        &mut self,
        value: &[u8],
        scan: &Scan,
        keywords: &'static [u8],
        kinds: u8,
    ) -> Option<StringRange> {
        if let Some(identifier) = scan.single_identifier {
            for keyword in strings::split(keywords, b" ") {
                if keyword.eq_ignore_ascii_case(identifier) {
                    return Some(self.push_str(keyword));
                }
            }
        }

        let is_non_negative = kinds & kind::NON_NEGATIVE != 0;
        let names = &scan.color_names;

        if kinds & kind::COLOR != 0 {
            if let Some(color) = self.parse_entirely(value, None, CssColor::parse) {
                if self.keeps_color_mix(scan) {
                    return Some(self.push_verbatim(value, scan));
                }
                return self.print(names, &[], &|dest| color.to_css(dest));
            }
        }
        if kinds & kind::INTEGER != 0 {
            if let Some(integer) = self.parse_entirely(value, None, CSSIntegerFns::parse) {
                if is_non_negative && integer < 0 {
                    return None;
                }
                return self.print(names, &[], &|dest| CSSIntegerFns::to_css(integer, dest));
            }
        }
        if kinds & kind::NUMBER != 0 {
            if let Some(number) = self.parse_entirely(value, None, CSSNumberFns::parse) {
                if is_non_negative && number < 0.0 {
                    return None;
                }
                return self.print(names, &[], &|dest| CSSNumberFns::to_css(number, dest));
            }
        }

        let has_length = kinds & kind::LENGTH != 0;
        let has_percentage = kinds & kind::PERCENTAGE != 0;
        let printed = if has_length && has_percentage {
            self.parse_entirely(value, None, LengthPercentage::parse)
                .and_then(|v| self.print(names, &[], &|dest| v.to_css(dest)))
        } else if has_length {
            self.parse_entirely(value, None, Length::parse)
                .and_then(|v| self.print(names, &[], &|dest| v.to_css(dest)))
        } else if has_percentage {
            self.parse_entirely(value, None, Percentage::parse)
                .and_then(|v| self.print(names, &[], &|dest| v.to_css(dest)))
        } else {
            None
        };
        if let Some(printed) = printed {
            if is_non_negative && has_negative_component(self.text(printed)) {
                return None;
            }
            return Some(self.keep_calc(printed, scan));
        }

        if kinds & kind::LENIENT != 0 {
            if scan.has_url {
                return self.parse_tokens(value, scan);
            }
            return Some(self.push_verbatim(value, scan));
        }
        None
    }

    /// Computed style wants the color that comes out.
    fn keeps_color_mix(&self, scan: &Scan) -> bool {
        scan.has_color_mix && self.flags & FLAG_RESOLVE_COLORS == 0
    }

    /// `rect(0 0 0 0)` and `rect(0, 0, 0, 0)` are `rect(0px, 0px, 0px, 0px)`.
    fn parse_clip_rect(&mut self, value: &[u8]) -> Option<StringRange> {
        let sides = self.parse_entirely(value, None, |input| {
            input.expect_function_matching(b"rect")?;
            input.parse_nested_block(|input| {
                let mut sides: [Option<Length>; 4] = [None, None, None, None];
                for (index, side) in sides.iter_mut().enumerate() {
                    if index > 0 {
                        let _ = input.try_parse(|input| input.expect_comma());
                    }
                    if input
                        .try_parse(|input| input.expect_ident_matching(b"auto"))
                        .is_err()
                    {
                        *side = Some(Length::parse(input)?);
                    }
                }
                Ok(sides)
            })
        })?;
        self.print(&[], &[], &|dest| {
            dest.write_str("rect(")?;
            dest.write_comma_separated(sides.iter(), |dest, side| match side {
                Some(length) => length.to_css(dest),
                None => dest.write_str("auto"),
            })?;
            dest.write_char(b')')
        })
    }

    /// `calc(1px + 2px)` is `calc(3px)` in the CSSOM. Bun's printer writes `3px`. `printed` is the end of `strings`.
    fn keep_calc(&mut self, printed: StringRange, scan: &Scan) -> StringRange {
        if !scan.is_single_calc || strings::contains_char(self.text(printed), b'(') {
            return printed;
        }
        let start = printed.offset as usize;
        debug_assert!(start + printed.length as usize == self.strings.len());
        let value = self.strings.split_off(start);
        self.strings.extend_from_slice(b"calc(");
        self.strings.extend_from_slice(&value);
        self.strings.push(b')');
        range(start, self.strings.len() - start)
    }

    fn parse_typed(
        &mut self,
        property: u16,
        info: &'static PropertyInfo,
        value: &[u8],
        scan: &Scan,
        is_important: bool,
    ) -> Option<()> {
        if let Some(identifier) = scan.single_identifier {
            for keyword in strings::split(info.extra_keywords, b" ") {
                if keyword.eq_ignore_ascii_case(identifier) {
                    let text = self.push_str(keyword);
                    self.declare(property, text, is_important);
                    return Some(());
                }
            }
        }

        let property_id = PropertyId::from_string(info.name);
        let mut import_records: Vec<ImportRecord> = Vec::new();
        let parsed = self.parse_entirely(value, Some(&mut import_records), |input| {
            Property::parse(property_id, input, &self.options)
        })?;
        // What has no valid typed value comes back as tokens.
        if matches!(parsed, Property::Unparsed(_) | Property::Custom(_)) {
            return None;
        }

        let is_verbatim = matches!(info.syntax, Syntax::TypedVerbatim);
        let names = &scan.color_names;

        if info.longhands.is_empty() {
            let text = if is_verbatim || self.keeps_color_mix(scan) {
                self.push_verbatim(value, scan)
            } else {
                let printed =
                    self.print(names, &import_records, &|dest| parsed.value_to_css(dest))?;
                self.keep_calc(printed, scan)
            };
            if !self.is_allowed(property, text) {
                return None;
            }
            self.declare(property, text, is_important);
            return Some(());
        }

        let values = self.expand(&parsed, names, &import_records)?;
        debug_assert!(values.len() == info.longhands.len());
        if values.len() != info.longhands.len() {
            return None;
        }
        for (&longhand, &text) in info.longhands.iter().zip(&values) {
            if !self.is_allowed(longhand, text) {
                return None;
            }
        }

        let text = if is_verbatim {
            self.push_verbatim(value, scan)
        } else if property == id::FLEX {
            // Bun's printer shortens `1 1 0%` to `1`. The CSSOM writes all three.
            let offset = self.strings.len();
            for (index, &part) in values.iter().enumerate() {
                if index > 0 {
                    self.strings.push(b' ');
                }
                self.strings
                    .extend_from_within(part.offset as usize..(part.offset + part.length) as usize);
            }
            range(offset, self.strings.len() - offset)
        } else {
            self.print(names, &import_records, &|dest| parsed.value_to_css(dest))?
        };

        let shorthand = Shorthand {
            property,
            text,
            is_important,
        };
        for (&longhand, &text) in info.longhands.iter().zip(&values) {
            self.declare_longhand(shorthand, longhand, text, false);
        }
        Some(())
    }

    fn print_all(
        &mut self,
        names: &[(RGBA, &'static [u8])],
        import_records: &[ImportRecord],
        prints: &[Print<'_>],
    ) -> Option<Vec<StringRange>> {
        let mut values = Vec::with_capacity(prints.len());
        for print in prints {
            values.push(self.print(names, import_records, *print)?);
        }
        Some(values)
    }

    /// The values of the longhands, in the order of `PropertyInfo::longhands`.
    fn expand(
        &mut self,
        parsed: &Property,
        names: &[(RGBA, &'static [u8])],
        records: &[ImportRecord],
    ) -> Option<Vec<StringRange>> {
        /// top, right, bottom, left
        macro_rules! rect {
            ($v:expr) => {
                self.print_all(
                    names,
                    records,
                    &[
                        &|d| $v.top.to_css(d),
                        &|d| $v.right.to_css(d),
                        &|d| $v.bottom.to_css(d),
                        &|d| $v.left.to_css(d),
                    ],
                )
            };
        }
        macro_rules! pair {
            ($v:expr, $first:ident, $second:ident) => {
                self.print_all(
                    names,
                    records,
                    &[&|d| $v.$first.to_css(d), &|d| $v.$second.to_css(d)],
                )
            };
        }
        /// width, style, color
        macro_rules! border_side {
            ($v:expr) => {
                self.print_all(
                    names,
                    records,
                    &[&|d| $v.width.to_css(d), &|d| $v.style.to_css(d), &|d| {
                        $v.color.to_css(d)
                    }],
                )
            };
        }
        /// One value for each item of a list, separated by commas.
        macro_rules! each {
            ($list:expr, $item:ident => $value:expr) => {
                &|d: &mut Printer| {
                    d.write_comma_separated($list.slice(), |d, $item| $value.to_css(d))
                }
            };
        }

        match parsed {
            Property::Margin(v) => rect!(v),
            Property::Padding(v) => rect!(v),
            Property::ScrollMargin(v) => rect!(v),
            Property::ScrollPadding(v) => rect!(v),
            Property::Inset(v) => rect!(v),
            Property::BorderColor(v) => rect!(v),
            Property::BorderStyle(v) => rect!(v),
            Property::BorderWidth(v) => rect!(v),

            Property::MarginBlock(v) => pair!(v, block_start, block_end),
            Property::PaddingBlock(v) => pair!(v, block_start, block_end),
            Property::ScrollMarginBlock(v) => pair!(v, block_start, block_end),
            Property::ScrollPaddingBlock(v) => pair!(v, block_start, block_end),
            Property::InsetBlock(v) => pair!(v, block_start, block_end),
            Property::MarginInline(v) => pair!(v, inline_start, inline_end),
            Property::PaddingInline(v) => pair!(v, inline_start, inline_end),
            Property::ScrollMarginInline(v) => pair!(v, inline_start, inline_end),
            Property::ScrollPaddingInline(v) => pair!(v, inline_start, inline_end),
            Property::InsetInline(v) => pair!(v, inline_start, inline_end),

            Property::BorderBlockColor(v) => pair!(v, start, end),
            Property::BorderBlockStyle(v) => pair!(v, start, end),
            Property::BorderBlockWidth(v) => pair!(v, start, end),
            Property::BorderInlineColor(v) => pair!(v, start, end),
            Property::BorderInlineStyle(v) => pair!(v, start, end),
            Property::BorderInlineWidth(v) => pair!(v, start, end),

            Property::BorderTop(v) => border_side!(v),
            Property::BorderRight(v) => border_side!(v),
            Property::BorderBottom(v) => border_side!(v),
            Property::BorderLeft(v) => border_side!(v),
            Property::BorderBlockStart(v) => border_side!(v),
            Property::BorderBlockEnd(v) => border_side!(v),
            Property::BorderInlineStart(v) => border_side!(v),
            Property::BorderInlineEnd(v) => border_side!(v),
            Property::Outline(v) => border_side!(v),

            Property::Border(v) => {
                let side = border_side!(v)?;
                let (width, style, color) = (side[0], side[1], side[2]);
                // `border` also resets the image.
                let image = self.push_str(b"none");
                Some(vec![
                    width, width, width, width, style, style, style, style, color, color, color,
                    color, image,
                ])
            }
            Property::BorderBlock(v) => {
                let side = border_side!(v)?;
                Some(vec![side[0], side[0], side[1], side[1], side[2], side[2]])
            }
            Property::BorderInline(v) => {
                let side = border_side!(v)?;
                Some(vec![side[0], side[0], side[1], side[1], side[2], side[2]])
            }

            Property::BorderRadius((v, _)) => self.print_all(
                names,
                records,
                &[
                    &|d| v.top_left.to_css(d),
                    &|d| v.top_right.to_css(d),
                    &|d| v.bottom_right.to_css(d),
                    &|d| v.bottom_left.to_css(d),
                ],
            ),

            Property::Gap(v) => pair!(v, row, column),
            Property::Overflow(v) => pair!(v, x, y),
            Property::PlaceContent(v) => pair!(v, align, justify),
            Property::PlaceItems(v) => pair!(v, align, justify),
            Property::PlaceSelf(v) => pair!(v, align, justify),
            Property::FlexFlow((v, _)) => pair!(v, direction, wrap),
            Property::Flex((v, _)) => self.print_all(
                names,
                records,
                &[&|d| v.grow.to_css(d), &|d| v.shrink.to_css(d), &|d| {
                    v.basis.to_css(d)
                }],
            ),

            Property::Font(v) => self.print_all(
                names,
                records,
                &[
                    &|d| v.style.to_css(d),
                    &|d| v.variant_caps.to_css(d),
                    &|d| v.weight.to_css(d),
                    &|d| v.stretch.to_css(d),
                    &|d| v.size.to_css(d),
                    &|d| v.line_height.to_css(d),
                    &|d| d.write_comma_separated(v.family.iter(), |d, family| family.to_css(d)),
                ],
            ),

            Property::BackgroundPosition(v) => self.print_all(
                names,
                records,
                &[
                    each!(v, position => position.x),
                    each!(v, position => position.y),
                ],
            ),

            Property::Background(v) => {
                // Only the last layer has a color.
                let last = v.slice().last()?;
                self.print_all(
                    names,
                    records,
                    &[
                        each!(v, layer => layer.image),
                        each!(v, layer => layer.position.x),
                        each!(v, layer => layer.position.y),
                        each!(v, layer => layer.size),
                        each!(v, layer => layer.repeat),
                        each!(v, layer => layer.attachment),
                        each!(v, layer => layer.origin),
                        each!(v, layer => layer.clip),
                        &|d| last.color.to_css(d),
                    ],
                )
            }

            Property::Transition((v, _)) => self.print_all(
                names,
                records,
                &[
                    each!(v, transition => transition.property),
                    each!(v, transition => transition.duration),
                    each!(v, transition => transition.timing_function),
                    each!(v, transition => transition.delay),
                ],
            ),

            Property::Animation((v, _)) => self.print_all(
                names,
                records,
                &[
                    each!(v, animation => animation.duration),
                    each!(v, animation => animation.timing_function),
                    each!(v, animation => animation.delay),
                    each!(v, animation => animation.iteration_count),
                    each!(v, animation => animation.direction),
                    each!(v, animation => animation.fill_mode),
                    each!(v, animation => animation.play_state),
                    each!(v, animation => animation.name),
                ],
            ),

            _ => None,
        }
    }
}

fn range(offset: usize, length: usize) -> StringRange {
    StringRange {
        offset: u32::try_from(offset).expect("int cast"),
        length: u32::try_from(length).expect("int cast"),
    }
}

/// The keyword in lower case.
fn css_wide_keyword(identifier: &[u8]) -> Option<&'static [u8]> {
    CSS_WIDE_KEYWORDS
        .into_iter()
        .find(|keyword| keyword.eq_ignore_ascii_case(identifier))
}

/// The name a `@supports` declaration was written with.
pub(crate) fn property_name(property_id: &PropertyId, arena: &Arena) -> Option<&'static [u8]> {
    let name = property_id.name();
    let prefix = property_id.prefix();
    let prefix_text: &[u8] = if prefix.is_empty() || prefix == VendorPrefix::NONE {
        b""
    } else if prefix == VendorPrefix::WEBKIT {
        b"-webkit-"
    } else {
        return None;
    };
    let full: &mut [u8] = arena.alloc_slice_fill_copy(prefix_text.len() + name.len(), 0u8);
    full[..prefix_text.len()].copy_from_slice(prefix_text);
    full[prefix_text.len()..].copy_from_slice(name);
    // SAFETY: the arena outlives the call across the C ABI, which is all the name is used for.
    Some(unsafe { crate::css_parser::src_str(full) })
}

/// Drives `RuleBodyParser` over a list that has nothing but declarations.
struct DeclarationListParser<'s, 'a> {
    sink: &'s mut DeclarationSink<'a>,
}

impl DeclarationParser for DeclarationListParser<'_, '_> {
    type Declaration = ();

    fn parse_value(this: &mut Self, name: &[u8], input: &mut Parser) -> CssResult<()> {
        this.sink.parse_declaration(name, input)
    }
}

impl AtRuleParser for DeclarationListParser<'_, '_> {
    type Prelude = ();
    type AtRule = ();

    fn parse_prelude(_: &mut Self, _: &[u8], input: &mut Parser) -> CssResult<()> {
        Err(input.new_error(BasicParseErrorKind::at_rule_body_invalid))
    }

    fn rule_without_block(_: &mut Self, _: (), _: &ParserState) -> Maybe<(), ()> {
        Err(())
    }

    fn parse_block(_: &mut Self, _: (), _: &ParserState, input: &mut Parser) -> CssResult<()> {
        Err(input.new_error(BasicParseErrorKind::at_rule_body_invalid))
    }
}

impl QualifiedRuleParser for DeclarationListParser<'_, '_> {
    type Prelude = ();
    type QualifiedRule = ();

    fn parse_prelude(_: &mut Self, input: &mut Parser) -> CssResult<()> {
        Err(input.new_error(BasicParseErrorKind::qualified_rule_invalid))
    }

    fn parse_block(_: &mut Self, _: (), _: &ParserState, input: &mut Parser) -> CssResult<()> {
        Err(input.new_error(BasicParseErrorKind::qualified_rule_invalid))
    }
}

impl RuleBodyItemParser for DeclarationListParser<'_, '_> {
    fn parse_qualified(_: &Self) -> bool {
        false
    }

    fn parse_declarations(_: &Self) -> bool {
        true
    }
}
