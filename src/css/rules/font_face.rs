use crate::css_values::url::Url;
use crate::css_values::size::Size2D;
use crate::css_values::angle::Angle;
use crate::css_properties::font as fontprops;
use crate::css_properties::font::{FontFamily, FontWeight, FontStretch, FontStyle as FontStyleProperty};
use crate::css_properties::custom::{CustomProperty, CustomPropertyName};
use crate::css_rules::Location;
use crate::{Printer, PrintErr, Parser, ParserState, ParserOptions, BasicParseErrorKind, Token};
use crate::Result as CssResult;
use crate::Maybe;

use bun_str::strings;
use bun_alloc::Arena;

// PERF(port): Zig used `std.ArrayListUnmanaged` fed by the CSS arena allocator.
// Phase B should swap to `bumpalo::collections::Vec<'bump, T>` and thread `'bump`.
type ArrayList<T> = Vec<T>;

/// A property within an `@font-face` rule.
///
/// See [FontFaceRule](FontFaceRule).
pub enum FontFaceProperty {
    /// The `src` property.
    Source(ArrayList<Source>),

    /// The `font-family` property.
    FontFamily(fontprops::FontFamily),

    /// The `font-style` property.
    FontStyle(FontStyle),

    /// The `font-weight` property.
    FontWeight(Size2D<fontprops::FontWeight>),

    /// The `font-stretch` property.
    FontStretch(Size2D<fontprops::FontStretch>),

    /// The `unicode-range` property.
    UnicodeRange(ArrayList<UnicodeRange>),

    /// An unknown or unsupported property.
    Custom(CustomProperty),
}

impl FontFaceProperty {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // Local helpers mirroring the Zig `Helpers.writeProperty` with `comptime multi: bool`.
        fn write_property_single<V>(d: &mut Printer, prop: &'static str, value: &V) -> Result<(), PrintErr>
        where
            V: crate::ToCss,
        {
            d.write_str(prop)?;
            d.delim(':', false)?;
            value.to_css(d)
        }

        fn write_property_multi<V>(d: &mut Printer, prop: &'static str, value: &[V]) -> Result<(), PrintErr>
        where
            V: crate::ToCss,
        {
            d.write_str(prop)?;
            d.delim(':', false)?;
            let len = value.len();
            for (idx, val) in value.iter().enumerate() {
                val.to_css(d)?;
                if idx < len - 1 {
                    d.delim(',', false)?;
                }
            }
            Ok(())
        }

        match self {
            FontFaceProperty::Source(value) => write_property_multi(dest, "src", value.as_slice()),
            FontFaceProperty::FontFamily(value) => write_property_single(dest, "font-family", value),
            FontFaceProperty::FontStyle(value) => write_property_single(dest, "font-style", value),
            FontFaceProperty::FontWeight(value) => write_property_single(dest, "font-weight", value),
            FontFaceProperty::FontStretch(value) => write_property_single(dest, "font-stretch", value),
            FontFaceProperty::UnicodeRange(value) => write_property_multi(dest, "unicode-range", value.as_slice()),
            FontFaceProperty::Custom(custom) => {
                dest.write_str(custom.name.as_str())?;
                dest.delim(':', false)?;
                custom.value.to_css(dest, true)
            }
        }
    }

    pub fn deep_clone(&self, allocator: &Arena) -> Self {
        // TODO(port): `css.implementDeepClone` is comptime-reflection-based; replace with a
        // `#[derive(DeepClone)]` proc-macro or hand-written impl in Phase B.
        crate::implement_deep_clone(self, allocator)
    }
}

/// A contiguous range of Unicode code points.
///
/// Cannot be empty. Can represent a single code point when start == end.
pub struct UnicodeRange {
    /// Inclusive start of the range. In [0, end].
    pub start: u32,

    /// Inclusive end of the range. In [0, 0x10FFFF].
    pub end: u32,
}

impl UnicodeRange {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // Attempt to optimize the range to use question mark syntax.
        if self.start != self.end {
            // Find the first hex digit that differs between the start and end values.
            let mut shift: u32 = 24;
            let mut mask: u32 = 0xfu32 << shift;
            while shift > 0 {
                let c1 = self.start & mask;
                let c2 = self.end & mask;
                if c1 != c2 {
                    break;
                }

                mask >>= 4;
                shift -= 4;
            }

            // Get the remainder of the value. This must be 0x0 to 0xf for the rest
            // of the value to use the question mark syntax.
            shift += 4;
            let remainder_mask: u32 = (1u32 << shift) - 1u32;
            let start_remainder = self.start & remainder_mask;
            let end_remainder = self.end & remainder_mask;

            if start_remainder == 0 && end_remainder == remainder_mask {
                let start = (self.start & !remainder_mask) >> shift;
                if start != 0 {
                    dest.write_fmt(format_args!("U+{:x}", start))?;
                } else {
                    dest.write_str("U+")?;
                }

                while shift > 0 {
                    dest.write_char('?')?;
                    shift -= 4;
                }

                return Ok(());
            }
        }

        dest.write_fmt(format_args!("U+{:x}", self.start))?;
        if self.end != self.start {
            dest.write_fmt(format_args!("-{:x}", self.end))?;
        }
        Ok(())
    }

    /// https://drafts.csswg.org/css-syntax/#urange-syntax
    pub fn parse(input: &mut Parser) -> CssResult<UnicodeRange> {
        // <urange> =
        //   u '+' <ident-token> '?'* |
        //   u <dimension-token> '?'* |
        //   u <number-token> '?'* |
        //   u <number-token> <dimension-token> |
        //   u <number-token> <number-token> |
        //   u '+' '?'+

        if let Some(e) = input.expect_ident_matching("u").as_err() {
            return CssResult::Err(e);
        }
        let after_u = input.position();
        if let Some(e) = Self::parse_tokens(input).as_err() {
            return CssResult::Err(e);
        }

        // This deviates from the spec in case there are CSS comments
        // between tokens in the middle of one <unicode-range>,
        // but oh well…
        let concatenated_tokens = input.slice_from(after_u);

        let range = if let Some(range) = Self::parse_concatenated(concatenated_tokens) {
            range
        } else {
            return CssResult::Err(input.new_basic_unexpected_token_error(Token::Ident(concatenated_tokens)));
        };

        if range.end > 0x10FFFF || range.start > range.end {
            return CssResult::Err(input.new_basic_unexpected_token_error(Token::Ident(concatenated_tokens)));
        }

        CssResult::Ok(range)
    }

    fn parse_tokens(input: &mut Parser) -> CssResult<()> {
        let tok = match input.next_including_whitespace() {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        // TODO(port): exact `Token` variant shapes (Dimension/Number payloads) may differ in Phase B.
        match *tok {
            Token::Dimension { .. } => return Self::parse_question_marks(input),
            Token::Number { .. } => {
                let after_number = input.state();
                let token = match input.next_including_whitespace() {
                    CssResult::Ok(vv) => vv,
                    CssResult::Err(_) => {
                        input.reset(&after_number);
                        return CssResult::Ok(());
                    }
                };

                if matches!(*token, Token::Delim('?')) {
                    return Self::parse_question_marks(input);
                }
                if matches!(*token, Token::Delim(_) | Token::Number { .. }) {
                    return CssResult::Ok(());
                }
                return CssResult::Ok(());
            }
            Token::Delim(c) => {
                if c == '+' {
                    let next = match input.next_including_whitespace() {
                        CssResult::Ok(vv) => vv,
                        CssResult::Err(e) => return CssResult::Err(e),
                    };
                    if !(matches!(*next, Token::Ident(_)) || matches!(*next, Token::Delim('?'))) {
                        return CssResult::Err(input.new_basic_unexpected_token_error(next.clone()));
                    }
                    return Self::parse_question_marks(input);
                }
            }
            _ => {}
        }
        CssResult::Err(input.new_basic_unexpected_token_error(tok.clone()))
    }

    /// Consume as many '?' as possible
    fn parse_question_marks(input: &mut Parser) -> CssResult<()> {
        loop {
            let start = input.state();
            if let Some(tok) = input.next_including_whitespace().as_value() {
                if matches!(*tok, Token::Delim('?')) {
                    continue;
                }
            }
            input.reset(&start);
            return CssResult::Ok(());
        }
    }

    // PORT NOTE: Zig `css.Maybe(UnicodeRange, void)` carries no error payload → `Option<UnicodeRange>`.
    fn parse_concatenated(text_: &[u8]) -> Option<UnicodeRange> {
        let mut text = if !text_.is_empty() && text_[0] == b'+' {
            &text_[1..]
        } else {
            return None;
        };
        let (first_hex_value, hex_digit_count) = Self::consume_hex(&mut text);
        let question_marks = Self::consume_question_marks(&mut text);
        let consumed = hex_digit_count + question_marks;

        if consumed == 0 || consumed > 6 {
            return None;
        }

        if question_marks > 0 {
            if text.is_empty() {
                return Some(UnicodeRange {
                    start: first_hex_value << u32::try_from(question_marks * 4).unwrap(),
                    end: ((first_hex_value + 1) << u32::try_from(question_marks * 4).unwrap()) - 1,
                });
            }
        } else if text.is_empty() {
            return Some(UnicodeRange {
                start: first_hex_value,
                end: first_hex_value,
            });
        } else {
            if !text.is_empty() && text[0] == b'-' {
                text = &text[1..];
                let (second_hex_value, hex_digit_count2) = Self::consume_hex(&mut text);
                if hex_digit_count2 > 0 && hex_digit_count2 <= 6 && text.is_empty() {
                    return Some(UnicodeRange {
                        start: first_hex_value,
                        end: second_hex_value,
                    });
                }
            }
        }
        None
    }

    fn consume_question_marks(text: &mut &[u8]) -> usize {
        let mut question_marks: usize = 0;
        while let Some(rest) = strings::split_first_with_expected(*text, b'?') {
            question_marks += 1;
            *text = rest;
        }
        question_marks
    }

    fn consume_hex(text: &mut &[u8]) -> (u32, usize) {
        let mut value: u32 = 0;
        let mut digits: usize = 0;
        while let Some(result) = strings::split_first(*text) {
            if let Some(digit_value) = Self::to_hex_digit(result.first) {
                value = value * 0x10 + digit_value;
                digits += 1;
                *text = result.rest;
            } else {
                break;
            }
        }
        (value, digits)
    }

    fn to_hex_digit(b: u8) -> Option<u32> {
        let mut digit = (b as u32).wrapping_sub('0' as u32);
        if digit < 10 {
            return Some(digit);
        }
        // Force the 6th bit to be set to ensure ascii is lower case.
        digit = ((b as u32) | 0b10_0000).wrapping_sub('a' as u32).saturating_add(10);
        if digit < 16 { Some(digit) } else { None }
    }
}

pub enum FontStyle {
    /// Normal font style.
    Normal,

    /// Italic font style.
    Italic,

    /// Oblique font style, with a custom angle.
    Oblique(Size2D<Angle>),
}

impl FontStyle {
    pub fn parse(input: &mut Parser) -> CssResult<FontStyle> {
        let property = match FontStyleProperty::parse(input) {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        CssResult::Ok(match property {
            FontStyleProperty::Normal => FontStyle::Normal,
            FontStyleProperty::Italic => FontStyle::Italic,
            FontStyleProperty::Oblique(angle) => {
                let second_angle = if let Some(a) = input.try_parse(Angle::parse).as_value() {
                    a
                } else {
                    angle
                };
                return CssResult::Ok(FontStyle::Oblique(Size2D { a: angle, b: second_angle }));
            }
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            FontStyle::Normal => dest.write_str("normal"),
            FontStyle::Italic => dest.write_str("italic"),
            FontStyle::Oblique(angle) => {
                dest.write_str("oblique")?;
                if !angle.eql(&FontStyle::default_oblique_angle()) {
                    dest.write_char(' ')?;
                    angle.to_css(dest)?;
                }
                Ok(())
            }
        }
    }

    fn default_oblique_angle() -> Size2D<Angle> {
        Size2D {
            a: FontStyleProperty::default_oblique_angle(),
            b: FontStyleProperty::default_oblique_angle(),
        }
    }
}

/// A font format keyword in the `format()` function of the
/// [src](https://drafts.csswg.org/css-fonts/#src-desc)
/// property of an `@font-face` rule.
pub enum FontFormat {
    /// A WOFF 1.0 font.
    Woff,

    /// A WOFF 2.0 font.
    Woff2,

    /// A TrueType font.
    Truetype,

    /// An OpenType font.
    Opentype,

    /// An Embedded OpenType (.eot) font.
    EmbeddedOpentype,

    /// OpenType Collection.
    Collection,

    /// An SVG font.
    Svg,

    /// An unknown format.
    // TODO(port): arena-owned slice from parser input; Phase B should thread `'i` lifetime
    // or use a StoreRef. Using raw `*const [u8]` per PORTING.md §Type map for CSS/parser.
    String(*const [u8]),
}

impl FontFormat {
    pub fn parse(input: &mut Parser) -> CssResult<FontFormat> {
        let s = match input.expect_ident_or_string() {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };

        // TODO(port): Zig fn name has a typo (`ASCIII`); Rust port of bun.strings may rename.
        if strings::eql_case_insensitive_asciii_check_length(b"woff", s) {
            CssResult::Ok(FontFormat::Woff)
        } else if strings::eql_case_insensitive_asciii_check_length(b"woff2", s) {
            CssResult::Ok(FontFormat::Woff2)
        } else if strings::eql_case_insensitive_asciii_check_length(b"truetype", s) {
            CssResult::Ok(FontFormat::Truetype)
        } else if strings::eql_case_insensitive_asciii_check_length(b"opentype", s) {
            CssResult::Ok(FontFormat::Opentype)
        } else if strings::eql_case_insensitive_asciii_check_length(b"embedded-opentype", s) {
            CssResult::Ok(FontFormat::EmbeddedOpentype)
        } else if strings::eql_case_insensitive_asciii_check_length(b"collection", s) {
            CssResult::Ok(FontFormat::Collection)
        } else if strings::eql_case_insensitive_asciii_check_length(b"svg", s) {
            CssResult::Ok(FontFormat::Svg)
        } else {
            CssResult::Ok(FontFormat::String(s as *const [u8]))
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // Browser support for keywords rather than strings is very limited.
        // https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/src
        match self {
            FontFormat::Woff => dest.write_str("woff"),
            FontFormat::Woff2 => dest.write_str("woff2"),
            FontFormat::Truetype => dest.write_str("truetype"),
            FontFormat::Opentype => dest.write_str("opentype"),
            FontFormat::EmbeddedOpentype => dest.write_str("embedded-opentype"),
            FontFormat::Collection => dest.write_str("collection"),
            FontFormat::Svg => dest.write_str("svg"),
            FontFormat::String(s) => {
                // SAFETY: `s` points into the arena-backed parser input which outlives the AST.
                dest.write_str(unsafe { &**s })
            }
        }
    }

    pub fn deep_clone(&self, allocator: &Arena) -> Self {
        // TODO(port): comptime-reflection deep clone — replace with derive in Phase B.
        crate::implement_deep_clone(self, allocator)
    }
}

/// A value for the [src](https://drafts.csswg.org/css-fonts/#src-desc)
/// property in an `@font-face` rule.
pub enum Source {
    /// A `url()` with optional format metadata.
    Url(UrlSource),

    /// The `local()` function.
    Local(fontprops::FontFamily),
}

impl Source {
    pub fn parse(input: &mut Parser) -> CssResult<Source> {
        match input.try_parse(UrlSource::parse) {
            CssResult::Ok(url) => return CssResult::Ok(Source::Url(url)),
            CssResult::Err(e) => {
                // TODO(port): exact ParseError shape (`e.kind == .basic && .basic == .at_rule_body_invalid`).
                if e.is_basic(&BasicParseErrorKind::AtRuleBodyInvalid) {
                    return CssResult::Err(e);
                }
            }
        }

        if let Some(e) = input.expect_function_matching("local").as_err() {
            return CssResult::Err(e);
        }

        fn parse_nested_block(_: (), i: &mut Parser) -> CssResult<fontprops::FontFamily> {
            fontprops::FontFamily::parse(i)
        }
        let local = match input.parse_nested_block((), parse_nested_block) {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        CssResult::Ok(Source::Local(local))
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            Source::Url(url) => url.to_css(dest),
            Source::Local(local) => {
                dest.write_str("local(")?;
                local.to_css(dest)?;
                dest.write_char(')')
            }
        }
    }

    pub fn deep_clone(&self, allocator: &Arena) -> Self {
        // TODO(port): comptime-reflection deep clone — replace with derive in Phase B.
        crate::implement_deep_clone(self, allocator)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "kebab-case")]
pub enum FontTechnology {
    /// A font format keyword in the `format()` function of the
    /// [src](https://drafts.csswg.org/css-fonts/#src-desc)
    /// property of an `@font-face` rule.
    /// A font features tech descriptor in the `tech()`function of the
    /// [src](https://drafts.csswg.org/css-fonts/#font-features-tech-values)
    /// property of an `@font-face` rule.
    /// Supports OpenType Features.
    /// https://docs.microsoft.com/en-us/typography/opentype/spec/featurelist
    FeaturesOpentype,

    /// Supports Apple Advanced Typography Font Features.
    /// https://developer.apple.com/fonts/TrueType-Reference-Manual/RM09/AppendixF.html
    FeaturesAat,

    /// Supports Graphite Table Format.
    /// https://scripts.sil.org/cms/scripts/render_download.php?site_id=nrsi&format=file&media_id=GraphiteBinaryFormat_3_0&filename=GraphiteBinaryFormat_3_0.pdf
    FeaturesGraphite,

    /// A color font tech descriptor in the `tech()`function of the
    /// [src](https://drafts.csswg.org/css-fonts/#src-desc)
    /// property of an `@font-face` rule.
    /// Supports the `COLR` v0 table.
    ColorColrv0,

    /// Supports the `COLR` v1 table.
    ColorColrv1,

    /// Supports the `SVG` table.
    ColorSvg,

    /// Supports the `sbix` table.
    ColorSbix,

    /// Supports the `CBDT` table.
    ColorCbdt,

    /// Supports Variations
    /// The variations tech refers to the support of font variations
    Variations,

    /// Supports Palettes
    /// The palettes tech refers to support for font palettes
    Palettes,

    /// Supports Incremental
    /// The incremental tech refers to client support for incremental font loading, using either the range-request or the patch-subset method
    Incremental,
}

impl FontTechnology {
    pub fn as_str(&self) -> &'static [u8] {
        crate::enum_property_util::as_str(self)
    }

    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        crate::enum_property_util::parse(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        crate::enum_property_util::to_css(self, dest)
    }
}

/// A `url()` value for the [src](https://drafts.csswg.org/css-fonts/#src-desc)
/// property in an `@font-face` rule.
pub struct UrlSource {
    /// The URL.
    pub url: Url,

    /// Optional `format()` function.
    pub format: Option<FontFormat>,

    /// Optional `tech()` function.
    pub tech: ArrayList<FontTechnology>,
}

impl UrlSource {
    pub fn parse(input: &mut Parser) -> CssResult<UrlSource> {
        let url = match Url::parse(input) {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };

        let format = if input.try_parse_with(Parser::expect_function_matching, "format").is_ok() {
            match input.parse_nested_block((), crate::void_wrap(FontFormat::parse)) {
                CssResult::Ok(vv) => Some(vv),
                CssResult::Err(e) => return CssResult::Err(e),
            }
        } else {
            None
        };

        let tech = if input.try_parse_with(Parser::expect_function_matching, "tech").is_ok() {
            fn parse_nested_block_fn(_: (), i: &mut Parser) -> CssResult<ArrayList<FontTechnology>> {
                i.parse_list(FontTechnology::parse)
            }
            match input.parse_nested_block((), parse_nested_block_fn) {
                CssResult::Ok(vv) => vv,
                CssResult::Err(e) => return CssResult::Err(e),
            }
        } else {
            ArrayList::<FontTechnology>::default()
        };

        CssResult::Ok(UrlSource { url, format, tech })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.url.to_css(dest)?;
        if let Some(format) = &self.format {
            dest.whitespace()?;
            dest.write_str("format(")?;
            format.to_css(dest)?;
            dest.write_char(')')?;
        }

        if !self.tech.is_empty() {
            dest.whitespace()?;
            dest.write_str("tech(")?;
            crate::to_css::from_list(self.tech.as_slice(), dest)?;
            dest.write_char(')')?;
        }
        Ok(())
    }

    pub fn deep_clone(&self, allocator: &Arena) -> Self {
        // TODO(port): comptime-reflection deep clone — replace with derive in Phase B.
        crate::implement_deep_clone(self, allocator)
    }
}

/// A [@font-face](https://drafts.csswg.org/css-fonts/#font-face-rule) rule.
pub struct FontFaceRule {
    /// Declarations in the `@font-face` rule.
    pub properties: ArrayList<FontFaceProperty>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl FontFaceRule {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@font-face")?;
        dest.whitespace()?;
        dest.write_char('{')?;
        dest.indent();
        let len = self.properties.len();
        for (i, prop) in self.properties.iter().enumerate() {
            dest.newline()?;
            prop.to_css(dest)?;
            if i != len - 1 || !dest.minify {
                dest.write_char(';')?;
            }
        }
        dest.dedent();
        dest.newline()?;
        dest.write_char('}')
    }

    pub fn deep_clone(&self, allocator: &Arena) -> Self {
        // TODO(port): comptime-reflection deep clone — replace with derive in Phase B.
        crate::implement_deep_clone(self, allocator)
    }
}

pub struct FontFaceDeclarationParser;

// PORT NOTE: Zig modeled `AtRuleParser` / `QualifiedRuleParser` / `DeclarationParser` /
// `RuleBodyItemParser` as nested namespaces with associated consts + fns. In Rust these
// are trait impls on `FontFaceDeclarationParser`.

impl crate::AtRuleParser for FontFaceDeclarationParser {
    type Prelude = ();
    type AtRule = FontFaceProperty;

    fn parse_prelude(&mut self, name: &[u8], input: &mut Parser) -> CssResult<Self::Prelude> {
        CssResult::Err(input.new_error(BasicParseErrorKind::AtRuleInvalid(name)))
    }

    fn parse_block(&mut self, _: Self::Prelude, _: &ParserState, input: &mut Parser) -> CssResult<Self::AtRule> {
        CssResult::Err(input.new_error(BasicParseErrorKind::AtRuleBodyInvalid))
    }

    fn rule_without_block(&mut self, _: Self::Prelude, _: &ParserState) -> Maybe<Self::AtRule, ()> {
        Maybe::Err(())
    }
}

impl crate::QualifiedRuleParser for FontFaceDeclarationParser {
    type Prelude = ();
    type QualifiedRule = FontFaceProperty;

    fn parse_prelude(&mut self, input: &mut Parser) -> CssResult<Self::Prelude> {
        CssResult::Err(input.new_error(BasicParseErrorKind::QualifiedRuleInvalid))
    }

    fn parse_block(&mut self, _: Self::Prelude, _: &ParserState, input: &mut Parser) -> CssResult<Self::QualifiedRule> {
        CssResult::Err(input.new_error(BasicParseErrorKind::QualifiedRuleInvalid))
    }
}

impl crate::DeclarationParser for FontFaceDeclarationParser {
    type Declaration = FontFaceProperty;

    fn parse_value(&mut self, name: &[u8], input: &mut Parser) -> CssResult<Self::Declaration> {
        let state = input.state();
        // todo_stuff.match_ignore_ascii_case
        if strings::eql_case_insensitive_asciii_check_length(name, b"src") {
            if let Some(sources) = input.parse_comma_separated(Source::parse).as_value() {
                return CssResult::Ok(FontFaceProperty::Source(sources));
            }
        } else if strings::eql_case_insensitive_asciii_check_length(name, b"font-family") {
            if let Some(c) = FontFamily::parse(input).as_value() {
                if input.expect_exhausted().is_ok() {
                    return CssResult::Ok(FontFaceProperty::FontFamily(c));
                }
            }
        } else if strings::eql_case_insensitive_asciii_check_length(name, b"font-weight") {
            if let Some(c) = Size2D::<FontWeight>::parse(input).as_value() {
                if input.expect_exhausted().is_ok() {
                    return CssResult::Ok(FontFaceProperty::FontWeight(c));
                }
            }
        } else if strings::eql_case_insensitive_asciii_check_length(name, b"font-style") {
            if let Some(c) = FontStyle::parse(input).as_value() {
                if input.expect_exhausted().is_ok() {
                    return CssResult::Ok(FontFaceProperty::FontStyle(c));
                }
            }
        } else if strings::eql_case_insensitive_asciii_check_length(name, b"font-stretch") {
            if let Some(c) = Size2D::<FontStretch>::parse(input).as_value() {
                if input.expect_exhausted().is_ok() {
                    return CssResult::Ok(FontFaceProperty::FontStretch(c));
                }
            }
        } else if strings::eql_case_insensitive_asciii_check_length(name, b"unicode-range") {
            if let Some(c) = input.parse_list(UnicodeRange::parse).as_value() {
                if input.expect_exhausted().is_ok() {
                    return CssResult::Ok(FontFaceProperty::UnicodeRange(c));
                }
            }
        } else {
            //
        }

        input.reset(&state);
        // TODO(port): `ParserOptions.default(allocator, null)` — arena allocator threading in Phase B.
        let opts = ParserOptions::default();
        CssResult::Ok(FontFaceProperty::Custom(
            match CustomProperty::parse(CustomPropertyName::from_str(name), input, &opts) {
                CssResult::Ok(v) => v,
                CssResult::Err(e) => return CssResult::Err(e),
            },
        ))
    }
}

impl crate::RuleBodyItemParser for FontFaceDeclarationParser {
    fn parse_qualified(&self) -> bool {
        false
    }

    fn parse_declarations(&self) -> bool {
        true
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/font_face.zig (738 lines)
//   confidence: medium
//   todos:      10
//   notes:      ArrayList=Vec placeholder (arena in Phase B); FontFormat::String uses raw *const [u8]; deep_clone/enum_property_util rely on reflection helpers; parser trait shapes assumed.
// ──────────────────────────────────────────────────────────────────────────
