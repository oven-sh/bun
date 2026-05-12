use crate as css;
use crate::css_rules::Location;
use crate::css_values::angle::Angle;
use crate::css_values::size::Size2D;
use crate::css_values::url::Url;
use crate::generics::DeepClone as _;
use crate::{PrintErr, Printer};

use super::ArrayList;

// ──────────────────────────────────────────────────────────────────────────
// FontFaceProperty
// ──────────────────────────────────────────────────────────────────────────

/// A property within an `@font-face` rule.
///
/// See [FontFaceRule](FontFaceRule).
//
// blocked_on: properties::font::{FontFamily,FontWeight,FontStretch} +
// properties::custom::CustomProperty (both `gated_prop!`-stubbed in
// properties/mod.rs). The enum body un-gates with the variant payloads
// once those leaves un-gate.

pub enum FontFaceProperty {
    /// The `src` property.
    Source(ArrayList<Source>),
    /// The `font-family` property.
    FontFamily(crate::css_properties::font::FontFamily),
    /// The `font-style` property.
    FontStyle(FontStyle),
    /// The `font-weight` property.
    FontWeight(Size2D<crate::css_properties::font::FontWeight>),
    /// The `font-stretch` property.
    FontStretch(Size2D<crate::css_properties::font::FontStretch>),
    /// The `unicode-range` property.
    UnicodeRange(ArrayList<UnicodeRange>),
    /// An unknown or unsupported property.
    Custom(crate::css_properties::custom::CustomProperty),
}

impl FontFaceProperty {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // Local helpers mirroring the Zig `Helpers.writeProperty` with `comptime multi: bool`.
        macro_rules! write_property_single {
            ($d:expr, $prop:expr, $value:expr) => {{
                $d.write_str($prop)?;
                $d.delim(b':', false)?;
                $value.to_css($d)
            }};
        }

        macro_rules! write_property_multi {
            ($d:expr, $prop:expr, $value:expr) => {{
                $d.write_str($prop)?;
                $d.delim(b':', false)?;
                let slice = $value;
                let len = slice.len();
                for (idx, val) in slice.iter().enumerate() {
                    val.to_css($d)?;
                    if idx < len - 1 {
                        $d.delim(b',', false)?;
                    }
                }
                Ok(())
            }};
        }

        match self {
            FontFaceProperty::Source(value) => write_property_multi!(dest, "src", value.as_slice()),
            FontFaceProperty::FontFamily(value) => {
                write_property_single!(dest, "font-family", value)
            }
            FontFaceProperty::FontStyle(value) => write_property_single!(dest, "font-style", value),
            FontFaceProperty::FontWeight(value) => {
                write_property_single!(dest, "font-weight", value)
            }
            FontFaceProperty::FontStretch(value) => {
                write_property_single!(dest, "font-stretch", value)
            }
            FontFaceProperty::UnicodeRange(value) => {
                write_property_multi!(dest, "unicode-range", value.as_slice())
            }
            FontFaceProperty::Custom(custom) => {
                dest.write_str(custom.name.as_str())?;
                dest.delim(b':', false)?;
                custom.value.to_css(dest, true)
            }
        }
    }

    pub fn deep_clone(&self, arena: &bun_alloc::Arena) -> Self {
        // PORT NOTE: Zig `css.implementDeepClone` field-walk, hand-expanded.
        match self {
            FontFaceProperty::Source(v) => {
                FontFaceProperty::Source(v.iter().map(|s| s.deep_clone(arena)).collect())
            }
            FontFaceProperty::FontFamily(v) => FontFaceProperty::FontFamily(v.deep_clone(arena)),
            FontFaceProperty::FontStyle(v) => FontFaceProperty::FontStyle(v.deep_clone(arena)),
            FontFaceProperty::FontWeight(v) => FontFaceProperty::FontWeight(v.deep_clone(arena)),
            FontFaceProperty::FontStretch(v) => FontFaceProperty::FontStretch(v.deep_clone(arena)),
            FontFaceProperty::UnicodeRange(v) => FontFaceProperty::UnicodeRange(
                v.iter()
                    .map(|r| UnicodeRange {
                        start: r.start,
                        end: r.end,
                    })
                    .collect(),
            ),
            FontFaceProperty::Custom(v) => FontFaceProperty::Custom(v.deep_clone(arena)),
        }
    }
}

impl FontStyle {
    pub fn deep_clone(&self, arena: &bun_alloc::Arena) -> Self {
        match self {
            FontStyle::Normal => FontStyle::Normal,
            FontStyle::Italic => FontStyle::Italic,
            FontStyle::Oblique(a) => FontStyle::Oblique(a.deep_clone(arena)),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// UnicodeRange
// ──────────────────────────────────────────────────────────────────────────

/// A contiguous range of Unicode code points.
///
/// Cannot be empty. Can represent a single code point when start == end.
pub struct UnicodeRange {
    /// Inclusive start of the range. In [0, end].
    pub start: u32,

    /// Inclusive end of the range. In [0, 0x10FFFF].
    pub end: u32,
}

// blocked_on: Printer::write_fmt, Parser::{expect_ident_matching,position,
// slice_from,next_including_whitespace,state,reset,
// new_basic_unexpected_token_error}, Token shape (Dimension/Number/Delim
// payloads), bun_core::{split_first,split_first_with_expected}.

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
                    dest.write_char(b'?')?;
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
    pub fn parse(input: &mut css::Parser) -> css::Result<UnicodeRange> {
        // <urange> =
        //   u '+' <ident-token> '?'* |
        //   u <dimension-token> '?'* |
        //   u <number-token> '?'* |
        //   u <number-token> <dimension-token> |
        //   u <number-token> <number-token> |
        //   u '+' '?'+

        if let Err(e) = input.expect_ident_matching(b"u") {
            return Err(e);
        }
        let after_u = input.position();
        if let Err(e) = Self::parse_tokens(input) {
            return Err(e);
        }

        // This deviates from the spec in case there are CSS comments
        // between tokens in the middle of one <unicode-range>,
        // but oh well…
        let concatenated_tokens = input.slice_from_cloned(after_u);

        let range = if let Some(range) = Self::parse_concatenated(concatenated_tokens) {
            range
        } else {
            return Err(
                input.new_basic_unexpected_token_error(css::Token::Ident(concatenated_tokens))
            );
        };

        if range.end > 0x10FFFF || range.start > range.end {
            return Err(
                input.new_basic_unexpected_token_error(css::Token::Ident(concatenated_tokens))
            );
        }

        Ok(range)
    }

    fn parse_tokens(input: &mut css::Parser) -> css::Result<()> {
        let tok = match input.next_including_whitespace() {
            Ok(vv) => vv.clone(),
            Err(e) => return Err(e),
        };
        // TODO(port): exact `Token` variant shapes (Dimension/Number payloads) may differ in Phase B.
        match tok {
            css::Token::Dimension { .. } => return Self::parse_question_marks(input),
            css::Token::Number { .. } => {
                let after_number = input.state();
                let token = match input.next_including_whitespace() {
                    Ok(vv) => vv,
                    Err(_) => {
                        input.reset(&after_number);
                        return Ok(());
                    }
                };

                if matches!(*token, css::Token::Delim(c) if c == '?' as u32) {
                    return Self::parse_question_marks(input);
                }
                if matches!(*token, css::Token::Delim(_) | css::Token::Number { .. }) {
                    return Ok(());
                }
                return Ok(());
            }
            css::Token::Delim(c) => {
                if c == '+' as u32 {
                    let next = match input.next_including_whitespace() {
                        Ok(vv) => vv.clone(),
                        Err(e) => return Err(e),
                    };
                    if !(matches!(next, css::Token::Ident(_))
                        || matches!(next, css::Token::Delim(d) if d == '?' as u32))
                    {
                        return Err(input.new_basic_unexpected_token_error(next));
                    }
                    return Self::parse_question_marks(input);
                }
            }
            _ => {}
        }
        Err(input.new_basic_unexpected_token_error(tok))
    }

    /// Consume as many '?' as possible
    fn parse_question_marks(input: &mut css::Parser) -> css::Result<()> {
        loop {
            let start = input.state();
            if let Ok(tok) = input.next_including_whitespace() {
                if matches!(*tok, css::Token::Delim(c) if c == '?' as u32) {
                    continue;
                }
            }
            input.reset(&start);
            return Ok(());
        }
    }

    // PORT NOTE: Zig `css.Maybe(UnicodeRange, void)` carries no error payload → `Option<UnicodeRange>`.
    fn parse_concatenated(text_: &[u8]) -> Option<UnicodeRange> {
        use bun_core::strings;
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
                    start: first_hex_value << u32::try_from(question_marks * 4).expect("int cast"),
                    end: ((first_hex_value + 1)
                        << u32::try_from(question_marks * 4).expect("int cast"))
                        - 1,
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
        use bun_core::strings;
        let mut question_marks: usize = 0;
        while let Some(rest) = strings::split_first_with_expected(*text, b'?') {
            question_marks += 1;
            *text = rest;
        }
        question_marks
    }

    fn consume_hex(text: &mut &[u8]) -> (u32, usize) {
        // Cap at 8: caller validates `<= 6` post-hoc; the unbounded Zig original
        // panic-overflows u32 in debug on >8 hex chars (malformed input).
        let (value, n) = bun_core::fmt::parse_hex_prefix(text, 8);
        *text = &text[n..];
        (value, n)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// FontStyle
// ──────────────────────────────────────────────────────────────────────────

pub enum FontStyle {
    /// Normal font style.
    Normal,
    /// Italic font style.
    Italic,
    /// Oblique font style, with a custom angle.
    Oblique(Size2D<Angle>),
}

// blocked_on: properties::font::FontStyle (gated_prop!), Angle::parse,
// Size2D::{eql,to_css}.

impl FontStyle {
    pub fn parse(input: &mut css::Parser) -> css::Result<FontStyle> {
        use crate::css_properties::font::FontStyle as FontStyleProperty;
        let property = match FontStyleProperty::parse(input) {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        };
        Ok(match property {
            FontStyleProperty::Normal => FontStyle::Normal,
            FontStyleProperty::Italic => FontStyle::Italic,
            FontStyleProperty::Oblique(angle) => {
                let second_angle = if let Ok(a) = input.try_parse(Angle::parse) {
                    a
                } else {
                    angle
                };
                return Ok(FontStyle::Oblique(Size2D {
                    a: angle,
                    b: second_angle,
                }));
            }
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            FontStyle::Normal => dest.write_str("normal"),
            FontStyle::Italic => dest.write_str("italic"),
            FontStyle::Oblique(angle) => {
                dest.write_str("oblique")?;
                if !Size2D::<Angle>::eql(angle, &FontStyle::default_oblique_angle()) {
                    dest.write_char(b' ')?;
                    angle.to_css(dest)?;
                }
                Ok(())
            }
        }
    }

    fn default_oblique_angle() -> Size2D<Angle> {
        use crate::css_properties::font::FontStyle as FontStyleProperty;
        Size2D {
            a: FontStyleProperty::default_oblique_angle(),
            b: FontStyleProperty::default_oblique_angle(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// FontFormat
// ──────────────────────────────────────────────────────────────────────────

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
    // PORT NOTE: arena-owned slice from parser input; Phase B threads `'i`.
    String(&'static [u8]),
}

// blocked_on: Parser::expect_ident_or_string, bun_core ASCII-eq fn name,
// DeepClone.

impl FontFormat {
    pub fn parse(input: &mut css::Parser) -> css::Result<FontFormat> {
        let s = input.expect_ident_or_string_cloned()?;
        Ok(crate::match_ignore_ascii_case! { s, {
            b"woff" => FontFormat::Woff,
            b"woff2" => FontFormat::Woff2,
            b"truetype" => FontFormat::Truetype,
            b"opentype" => FontFormat::Opentype,
            b"embedded-opentype" => FontFormat::EmbeddedOpentype,
            b"collection" => FontFormat::Collection,
            b"svg" => FontFormat::Svg,
            _ => FontFormat::String(s),
        }})
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
            FontFormat::String(s) => dest.write_str(*s),
        }
    }

    pub fn deep_clone(&self, _arena: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` variant-walk. All payloads are
        // `Copy` / arena-slice idents → identity copy.
        match self {
            FontFormat::Woff => FontFormat::Woff,
            FontFormat::Woff2 => FontFormat::Woff2,
            FontFormat::Truetype => FontFormat::Truetype,
            FontFormat::Opentype => FontFormat::Opentype,
            FontFormat::EmbeddedOpentype => FontFormat::EmbeddedOpentype,
            FontFormat::Collection => FontFormat::Collection,
            FontFormat::Svg => FontFormat::Svg,
            FontFormat::String(s) => FontFormat::String(s),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Source / FontTechnology / UrlSource
// ──────────────────────────────────────────────────────────────────────────

/// A value for the [src](https://drafts.csswg.org/css-fonts/#src-desc)
/// property in an `@font-face` rule.
//
// blocked_on: properties::font::FontFamily (gated_prop!).

pub enum Source {
    /// A `url()` with optional format metadata.
    Url(UrlSource),
    /// The `local()` function.
    Local(crate::css_properties::font::FontFamily),
}

impl Source {
    pub fn parse(input: &mut css::Parser) -> css::Result<Source> {
        use crate::css_properties::font as fontprops;
        match input.try_parse(UrlSource::parse) {
            Ok(url) => return Ok(Source::Url(url)),
            Err(e) => {
                // Zig: `e.kind == .basic and e.kind.basic == .at_rule_body_invalid`
                if matches!(
                    e.kind,
                    css::ParseErrorKind::basic(css::BasicParseErrorKind::at_rule_body_invalid)
                ) {
                    return Err(e);
                }
            }
        }

        if let Err(e) = input.expect_function_matching(b"local") {
            return Err(e);
        }

        let local = match input.parse_nested_block(|i| fontprops::FontFamily::parse(i)) {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        };
        Ok(Source::Local(local))
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            Source::Url(url) => url.to_css(dest),
            Source::Local(local) => {
                dest.write_str("local(")?;
                local.to_css(dest)?;
                dest.write_char(b')')
            }
        }
    }

    pub fn deep_clone(&self, arena: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` variant-walk, hand-expanded.
        match self {
            Source::Url(u) => Source::Url(u.deep_clone(arena)),
            Source::Local(l) => Source::Local(l.deep_clone(arena)),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, css::DefineEnumProperty)]
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

// blocked_on: Url::{parse,to_css}, FontFormat::{parse,to_css},
// FontTechnology::{parse,to_css}, Parser::{try_parse_with,
// expect_function_matching,parse_nested_block,parse_list},
// css::{void_wrap,to_css::from_list}, DeepClone.

impl UrlSource {
    pub fn parse(input: &mut css::Parser) -> css::Result<UrlSource> {
        let url = match Url::parse(input) {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        };

        let format = if input
            .try_parse(|i| i.expect_function_matching(b"format"))
            .is_ok()
        {
            match input.parse_nested_block(FontFormat::parse) {
                Ok(vv) => Some(vv),
                Err(e) => return Err(e),
            }
        } else {
            None
        };

        let tech = if input
            .try_parse(|i| i.expect_function_matching(b"tech"))
            .is_ok()
        {
            match input.parse_nested_block(|i| i.parse_list(FontTechnology::parse)) {
                Ok(vv) => vv,
                Err(e) => return Err(e),
            }
        } else {
            ArrayList::<FontTechnology>::default()
        };

        Ok(UrlSource { url, format, tech })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.url.to_css(dest)?;
        if let Some(format) = &self.format {
            dest.whitespace()?;
            dest.write_str("format(")?;
            format.to_css(dest)?;
            dest.write_char(b')')?;
        }

        if !self.tech.is_empty() {
            dest.whitespace()?;
            dest.write_str("tech(")?;
            css::to_css::from_list(self.tech.as_slice(), dest)?;
            dest.write_char(b')')?;
        }
        Ok(())
    }

    pub fn deep_clone(&self, arena: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` field-walk, hand-expanded.
        Self {
            url: self.url.deep_clone(arena),
            format: self.format.as_ref().map(|f| f.deep_clone(arena)),
            tech: self.tech.clone(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// FontFaceRule
// ──────────────────────────────────────────────────────────────────────────

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
        dest.write_char(b'{')?;
        dest.indent();
        let len = self.properties.len();
        for (i, prop) in self.properties.iter().enumerate() {
            dest.newline()?;
            prop.to_css(dest)?;
            if i != len - 1 || !dest.minify {
                dest.write_char(b';')?;
            }
        }
        dest.dedent();
        dest.newline()?;
        dest.write_char(b'}')
    }
}

impl FontFaceRule {
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` field-walk. `FontFaceProperty`'s
        // variant-walk lands when its enum body un-gates (properties::{font,
        // custom}); the gated stub above panics with the blocker named.
        Self {
            properties: self.properties.iter().map(|p| p.deep_clone(bump)).collect(),
            loc: self.loc,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// FontFaceDeclarationParser
// ──────────────────────────────────────────────────────────────────────────

pub struct FontFaceDeclarationParser;

// PORT NOTE: Zig modeled `AtRuleParser` / `QualifiedRuleParser` /
// `DeclarationParser` / `RuleBodyItemParser` as nested namespaces with
// associated consts + fns. In Rust these are trait impls on
// `FontFaceDeclarationParser`.
//
// blocked_on: css::{AtRuleParser,QualifiedRuleParser,DeclarationParser,
// RuleBodyItemParser} trait signatures, properties::font::* +
// properties::custom::CustomProperty, Size2D::parse, Parser surface,
// FontFaceProperty enum body.

const _: () = {
    use crate::css_properties::custom::{CustomProperty, CustomPropertyName};
    use crate::css_properties::font::{FontFamily, FontStretch, FontWeight};
    use css::css_parser::{
        AtRuleParser, DeclarationParser, QualifiedRuleParser, RuleBodyItemParser,
    };
    use css::{BasicParseErrorKind, Maybe, Parser, ParserOptions, ParserState, Result};

    impl AtRuleParser for FontFaceDeclarationParser {
        type Prelude = ();
        type AtRule = FontFaceProperty;

        fn parse_prelude(
            _this: &mut Self,
            name: &[u8],
            input: &mut Parser,
        ) -> Result<Self::Prelude> {
            Err(
                input.new_error(BasicParseErrorKind::at_rule_invalid(std::ptr::from_ref::<
                    [u8],
                >(name))),
            )
        }

        fn parse_block(
            _this: &mut Self,
            _: Self::Prelude,
            _: &ParserState,
            input: &mut Parser,
        ) -> Result<Self::AtRule> {
            Err(input.new_error(BasicParseErrorKind::at_rule_body_invalid))
        }

        fn rule_without_block(
            _this: &mut Self,
            _: Self::Prelude,
            _: &ParserState,
        ) -> Maybe<Self::AtRule, ()> {
            Err(())
        }
    }

    impl QualifiedRuleParser for FontFaceDeclarationParser {
        type Prelude = ();
        type QualifiedRule = FontFaceProperty;

        fn parse_prelude(_this: &mut Self, input: &mut Parser) -> Result<Self::Prelude> {
            Err(input.new_error(BasicParseErrorKind::qualified_rule_invalid))
        }

        fn parse_block(
            _this: &mut Self,
            _: Self::Prelude,
            _: &ParserState,
            input: &mut Parser,
        ) -> Result<Self::QualifiedRule> {
            Err(input.new_error(BasicParseErrorKind::qualified_rule_invalid))
        }
    }

    impl DeclarationParser for FontFaceDeclarationParser {
        type Declaration = FontFaceProperty;

        fn parse_value(
            _this: &mut Self,
            name: &[u8],
            input: &mut Parser,
        ) -> Result<Self::Declaration> {
            let state = input.state();
            crate::match_ignore_ascii_case! { name, {
                b"src" => if let Ok(sources) = input.parse_comma_separated(Source::parse) {
                    return Ok(FontFaceProperty::Source(sources));
                },
                b"font-family" => if let Ok(c) = FontFamily::parse(input) {
                    if input.expect_exhausted().is_ok() {
                        return Ok(FontFaceProperty::FontFamily(c));
                    }
                },
                b"font-weight" => if let Ok(c) = Size2D::<FontWeight>::parse(input) {
                    if input.expect_exhausted().is_ok() {
                        return Ok(FontFaceProperty::FontWeight(c));
                    }
                },
                b"font-style" => if let Ok(c) = FontStyle::parse(input) {
                    if input.expect_exhausted().is_ok() {
                        return Ok(FontFaceProperty::FontStyle(c));
                    }
                },
                b"font-stretch" => if let Ok(c) = Size2D::<FontStretch>::parse(input) {
                    if input.expect_exhausted().is_ok() {
                        return Ok(FontFaceProperty::FontStretch(c));
                    }
                },
                b"unicode-range" => if let Ok(c) = input.parse_list(UnicodeRange::parse) {
                    if input.expect_exhausted().is_ok() {
                        return Ok(FontFaceProperty::UnicodeRange(c));
                    }
                },
                _ => {},
            }}

            input.reset(&state);
            let opts = ParserOptions::default(None);
            Ok(FontFaceProperty::Custom(
                match CustomProperty::parse(CustomPropertyName::from_str(name), input, &opts) {
                    Ok(v) => v,
                    Err(e) => return Err(e),
                },
            ))
        }
    }

    impl RuleBodyItemParser for FontFaceDeclarationParser {
        fn parse_qualified(_this: &Self) -> bool {
            false
        }

        fn parse_declarations(_this: &Self) -> bool {
            true
        }
    }
};

// ported from: src/css/rules/font_face.zig
