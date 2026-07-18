use crate::css_parser as css;
use crate::css_parser::{CssResult, ParserError, ParserOptions, PrintErr, Printer, Token};
use crate::properties::custom::TokenList;
use crate::properties::transform::{Transform, TransformList};
use crate::values::angle::Angle;
use crate::values::color::CssColor;
use crate::values::ident::{CustomIdent, CustomIdentFns, Ident};
use crate::values::image::Image;
use crate::values::length::{Length, LengthPercentage};
use crate::values::number::{CSSInteger, CSSIntegerFns, CSSNumber, CSSNumberFns};
use crate::values::percentage::Percentage;
use crate::values::resolution::Resolution;
use crate::values::time::Time;
use crate::values::url::Url;

use bun_core::strings;

// https://drafts.csswg.org/css-syntax-3/#whitespace
const SPACE_CHARACTERS: &[u8] = &[0x20, 0x09];

/// A CSS [syntax string](https://drafts.css-houdini.org/css-properties-values-api/#syntax-strings)
/// used to define the grammar for a registered custom property.
// Upstream lightningcss Rust threaded `'i`, but the port uses `&'static [u8]` /
// `*const [u8]` placeholders for arena-borrowed slices (matching `Token` /
// `ident.rs`); `'bump` threading would restore the lifetime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyntaxString {
    /// A list of syntax components.
    // PERF: `Vec` until `'bump` is threaded into BumpVec.
    Components(Vec<SyntaxComponent>),
    /// The universal syntax definition.
    Universal,
}

impl SyntaxString {
    pub(crate) fn deep_clone(&self, _bump: &bun_core::alloc_impl::Arena) -> Self {
        // `Clone` covers this — every payload owns its data.
        self.clone()
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_char(b'"')?;
        match self {
            SyntaxString::Universal => dest.write_char(b'*')?,
            SyntaxString::Components(components) => {
                dest.write_separated(
                    components.iter(),
                    |d| d.delim(b'|', true),
                    |d, c| c.to_css(d),
                )?;
            }
        }

        dest.write_char(b'"')
    }

    pub(crate) fn parse(input: &mut css::Parser) -> CssResult<SyntaxString> {
        let string = input.expect_string()?;
        match SyntaxString::parse_string(string) {
            Ok(result) => Ok(result),
            Err(()) => Err(input.new_custom_error(ParserError::invalid_value)),
        }
    }

    /// Parses a syntax string.
    pub(crate) fn parse_string(input: &[u8]) -> Result<SyntaxString, ()> {
        // https://drafts.css-houdini.org/css-properties-values-api/#parsing-syntax
        let mut trimmed_input = strings::trim_left(input, SPACE_CHARACTERS);
        if trimmed_input.is_empty() {
            return Err(());
        }

        if trimmed_input == b"*" {
            return Ok(SyntaxString::Universal);
        }

        let mut components: Vec<SyntaxComponent> = Vec::new();

        // PERF(alloc): count first?
        loop {
            let component = SyntaxComponent::parse_string(&mut trimmed_input)?;
            components.push(component);

            trimmed_input = strings::trim_left(trimmed_input, SPACE_CHARACTERS);
            if trimmed_input.is_empty() {
                break;
            }

            if strings::starts_with_char(trimmed_input, b'|') {
                trimmed_input = &trimmed_input[1..];
                continue;
            }

            return Err(());
        }

        Ok(SyntaxString::Components(components))
    }

    /// Parses a value according to the syntax grammar.
    pub(crate) fn parse_value(&self, input: &mut css::Parser) -> CssResult<ParsedComponent> {
        match self {
            SyntaxString::Universal => Ok(ParsedComponent::TokenList(TokenList::parse(
                input,
                &ParserOptions::default(None),
                0,
            )?)),
            SyntaxString::Components(components) => {
                // Loop through each component, and return the first one that parses successfully.
                for component in components.iter() {
                    let state = input.state();
                    // PERF: deinit this on error
                    let mut parsed: Vec<ParsedComponent> = Vec::new();

                    loop {
                        let value_result = input.try_parse(|i| -> CssResult<ParsedComponent> {
                            let value = match &component.kind {
                                SyntaxComponentKind::Length => {
                                    ParsedComponent::Length(Length::parse(i)?)
                                }
                                SyntaxComponentKind::Number => {
                                    ParsedComponent::Number(CSSNumberFns::parse(i)?)
                                }
                                SyntaxComponentKind::Percentage => {
                                    ParsedComponent::Percentage(Percentage::parse(i)?)
                                }
                                SyntaxComponentKind::LengthPercentage => {
                                    ParsedComponent::LengthPercentage(LengthPercentage::parse(i)?)
                                }
                                SyntaxComponentKind::Color => {
                                    ParsedComponent::Color(CssColor::parse(i)?)
                                }
                                SyntaxComponentKind::Image => {
                                    ParsedComponent::Image(Image::parse(i)?)
                                }
                                SyntaxComponentKind::Url => ParsedComponent::Url(Url::parse(i)?),
                                SyntaxComponentKind::Integer => {
                                    ParsedComponent::Integer(CSSIntegerFns::parse(i)?)
                                }
                                SyntaxComponentKind::Angle => {
                                    ParsedComponent::Angle(Angle::parse(i)?)
                                }
                                SyntaxComponentKind::Time => ParsedComponent::Time(Time::parse(i)?),
                                SyntaxComponentKind::Resolution => {
                                    ParsedComponent::Resolution(Resolution::parse(i)?)
                                }
                                SyntaxComponentKind::TransformFunction => {
                                    ParsedComponent::TransformFunction(Transform::parse(i)?)
                                }
                                SyntaxComponentKind::TransformList => {
                                    ParsedComponent::TransformList(TransformList::parse(i)?)
                                }
                                SyntaxComponentKind::CustomIdent => {
                                    ParsedComponent::CustomIdent(CustomIdentFns::parse(i)?)
                                }
                                SyntaxComponentKind::Literal(value) => {
                                    let location = i.current_source_location();
                                    let ident = i.expect_ident_cloned()?;
                                    if !strings::eql(ident, value) {
                                        return Err(location
                                            .new_unexpected_token_error(Token::Ident(ident)));
                                    }
                                    ParsedComponent::Literal(Ident {
                                        v: std::ptr::from_ref::<[u8]>(ident),
                                    })
                                }
                            };
                            Ok(value)
                        });

                        if let Ok(value) = value_result {
                            match component.multiplier {
                                Multiplier::None => return Ok(value),
                                Multiplier::Space => {
                                    parsed.push(value);
                                    if input.is_exhausted() {
                                        return Ok(ParsedComponent::Repeated(Repeated {
                                            components: parsed,
                                            multiplier: component.multiplier,
                                        }));
                                    }
                                }
                                Multiplier::Comma => {
                                    parsed.push(value);
                                    match input.next() {
                                        Ok(token) => {
                                            if matches!(token, Token::Comma) {
                                                continue;
                                            }
                                            break;
                                        }
                                        Err(_) => {
                                            return Ok(ParsedComponent::Repeated(Repeated {
                                                components: parsed,
                                                multiplier: component.multiplier,
                                            }));
                                        }
                                    }
                                }
                            }
                        } else {
                            break;
                        }
                    }

                    input.reset(&state);
                }

                Err(input.new_error_for_next_token())
            }
        }
    }
}

/// A [syntax component](https://drafts.css-houdini.org/css-properties-values-api/#syntax-component)
/// within a [SyntaxString](SyntaxString).
///
/// A syntax component consists of a component kind an a multiplier, which indicates how the component
/// may repeat during parsing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyntaxComponent {
    pub kind: SyntaxComponentKind,
    pub multiplier: Multiplier,
}

impl SyntaxComponent {
    pub(crate) fn parse_string(input: &mut &[u8]) -> Result<SyntaxComponent, ()> {
        let kind = SyntaxComponentKind::parse_string(input)?;

        // Pre-multiplied types cannot have multipliers.
        if matches!(kind, SyntaxComponentKind::TransformList) {
            return Ok(SyntaxComponent {
                kind,
                multiplier: Multiplier::None,
            });
        }

        let mut multiplier = Multiplier::None;
        if strings::starts_with_char(*input, b'+') {
            *input = &input[1..];
            multiplier = Multiplier::Space;
        } else if strings::starts_with_char(*input, b'#') {
            *input = &input[1..];
            multiplier = Multiplier::Comma;
        }

        Ok(SyntaxComponent { kind, multiplier })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.kind.to_css(dest)?;
        match self.multiplier {
            Multiplier::None => Ok(()),
            Multiplier::Comma => dest.write_char(b'#'),
            Multiplier::Space => dest.write_char(b'+'),
        }
    }
}

/// A [syntax component component name](https://drafts.css-houdini.org/css-properties-values-api/#supported-names).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyntaxComponentKind {
    /// A `<length>` component.
    Length,
    /// A `<number>` component.
    Number,
    /// A `<percentage>` component.
    Percentage,
    /// A `<length-percentage>` component.
    LengthPercentage,
    /// A `<color>` component.
    Color,
    /// An `<image>` component.
    Image,
    /// A `<url>` component.
    Url,
    /// An `<integer>` component.
    Integer,
    /// An `<angle>` component.
    Angle,
    /// A `<time>` component.
    Time,
    /// A `<resolution>` component.
    Resolution,
    /// A `<transform-function>` component.
    TransformFunction,
    /// A `<transform-list>` component.
    TransformList,
    /// A `<custom-ident>` component.
    CustomIdent,
    /// A literal component.
    // `&'static`; that would need a `'bump` lifetime threaded through
    // `SyntaxString`. We own the bytes instead — `Box<[u8]>` per §Forbidden
    // ("the field should be `Box<[T]>` … not `&'static [T]`"). May swap for
    // `&'bump [u8]` later.
    Literal(Box<[u8]>),
}

impl SyntaxComponentKind {
    pub(crate) fn parse_string(input: &mut &[u8]) -> Result<SyntaxComponentKind, ()> {
        // https://drafts.css-houdini.org/css-properties-values-api/#consume-syntax-component
        *input = strings::trim_left(*input, SPACE_CHARACTERS);
        if strings::starts_with_char(*input, b'<') {
            // https://drafts.css-houdini.org/css-properties-values-api/#consume-data-type-name
            let end_idx = match strings::index_of_char(*input, b'>') {
                Some(i) => i as usize,
                None => return Err(()),
            };
            let name = &input[1..end_idx];
            let component: SyntaxComponentKind = crate::match_ignore_ascii_case! { name, {
                b"length" => SyntaxComponentKind::Length,
                b"number" => SyntaxComponentKind::Number,
                b"percentage" => SyntaxComponentKind::Percentage,
                b"length-percentage" => SyntaxComponentKind::LengthPercentage,
                b"color" => SyntaxComponentKind::Color,
                b"image" => SyntaxComponentKind::Image,
                b"url" => SyntaxComponentKind::Url,
                b"integer" => SyntaxComponentKind::Integer,
                b"angle" => SyntaxComponentKind::Angle,
                b"time" => SyntaxComponentKind::Time,
                b"resolution" => SyntaxComponentKind::Resolution,
                b"transform-function" => SyntaxComponentKind::TransformFunction,
                b"transform-list" => SyntaxComponentKind::TransformList,
                b"custom-ident" => SyntaxComponentKind::CustomIdent,
                _ => return Err(()),
            }};

            *input = &input[end_idx + 1..];
            Ok(component)
        } else if !input.is_empty() && is_ident_start(input[0]) {
            // A literal.
            let mut end_idx: usize = 0;
            while end_idx < input.len() && is_name_code_point(input[end_idx]) {
                // Spec uses utf8ByteSequenceLengthUnsafe (unreachable for invalid lead bytes);
                // clamp to >=1 so a stray 0x80..=0xBF / 0xF8..=0xFF byte advances instead of
                // returning 0 and spinning forever.
                end_idx = (end_idx
                    + strings::utf8_byte_sequence_length(input[end_idx]).max(1) as usize)
                    .min(input.len());
            }
            let literal: Box<[u8]> = Box::from(&input[0..end_idx]);
            *input = &input[end_idx..];
            Ok(SyntaxComponentKind::Literal(literal))
        } else {
            Err(())
        }
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            SyntaxComponentKind::Length => dest.write_str("<length>"),
            SyntaxComponentKind::Number => dest.write_str("<number>"),
            SyntaxComponentKind::Percentage => dest.write_str("<percentage>"),
            SyntaxComponentKind::LengthPercentage => dest.write_str("<length-percentage>"),
            SyntaxComponentKind::Color => dest.write_str("<color>"),
            SyntaxComponentKind::Image => dest.write_str("<image>"),
            SyntaxComponentKind::Url => dest.write_str("<url>"),
            SyntaxComponentKind::Integer => dest.write_str("<integer>"),
            SyntaxComponentKind::Angle => dest.write_str("<angle>"),
            SyntaxComponentKind::Time => dest.write_str("<time>"),
            SyntaxComponentKind::Resolution => dest.write_str("<resolution>"),
            SyntaxComponentKind::TransformFunction => dest.write_str("<transform-function>"),
            SyntaxComponentKind::TransformList => dest.write_str("<transform-list>"),
            SyntaxComponentKind::CustomIdent => dest.write_str("<custom-ident>"),
            SyntaxComponentKind::Literal(l) => dest.write_str(&l[..]),
        }
    }
}

fn is_ident_start(c: u8) -> bool {
    // https://drafts.csswg.org/css-syntax-3/#ident-start-code-point
    (c >= b'A' && c <= b'Z') || (c >= b'a' && c <= b'z') || c >= 0x80 || c == b'_'
}

fn is_name_code_point(c: u8) -> bool {
    // https://drafts.csswg.org/css-syntax-3/#ident-code-point
    is_ident_start(c) || (c >= b'0' && c <= b'9') || c == b'-'
}

// ─── ParsedComponent ──────────────────────────────────────────────────────
// `ParsedComponent` is the materialized form of a `SyntaxComponentKind` and
// carries `Image` / `CssColor` / `Transform{,List}` / `TokenList` payloads.
// No `#[derive]` — payload types lack a common Debug/Clone/PartialEq
// surface (Image: none; TokenList: Default-only; Ident/CustomIdent: no Eq;
// Transform: no Debug). Only `deep_clone` + `to_css` are provided below.
pub enum ParsedComponent {
    /// A `<length>` value.
    Length(Length),
    /// A `<number>` value.
    Number(CSSNumber),
    /// A `<percentage>` value.
    Percentage(Percentage),
    /// A `<length-percentage>` value.
    LengthPercentage(LengthPercentage),
    /// A `<color>` value.
    Color(CssColor),
    /// An `<image>` value.
    Image(Image),
    /// A `<url>` value.
    Url(Url),
    /// An `<integer>` value.
    Integer(CSSInteger),
    /// An `<angle>` value.
    Angle(Angle),
    /// A `<time>` value.
    Time(Time),
    /// A `<resolution>` value.
    Resolution(Resolution),
    /// A `<transform-function>` value.
    TransformFunction(Transform),
    /// A `<transform-list>` value.
    // `TransformList<'bump>` borrows the parser arena. The port uses
    // `'static` placeholders (matching `Token`/`Ident`); `'bump` threading
    // through `ParsedComponent<'a>` would restore the lifetime.
    TransformList(TransformList),
    /// A `<custom-ident>` value.
    CustomIdent(CustomIdent),
    /// A literal value.
    Literal(Ident),
    /// A repeated component value.
    Repeated(Repeated),
    /// A raw token stream.
    TokenList(TokenList),
}

/// A repeated component value.
pub struct Repeated {
    /// The components to repeat.
    // PERF: `Vec` until `'bump` is threaded into BumpVec.
    pub components: Vec<ParsedComponent>,
    /// A multiplier describing how the components repeat.
    pub multiplier: Multiplier,
}

impl Repeated {
    pub(crate) fn deep_clone(&self, bump: &bun_core::alloc_impl::Arena) -> Self {
        // Hand-expanded `css.implementDeepClone` (field-wise reflection):
        // ArrayList → Vec deep-cloned per element; `Multiplier` is `Copy`.
        Repeated {
            components: self.components.iter().map(|c| c.deep_clone(bump)).collect(),
            multiplier: self.multiplier,
        }
    }
}

impl ParsedComponent {
    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            ParsedComponent::Length(v) => v.to_css(dest),
            ParsedComponent::Number(v) => CSSNumberFns::to_css(*v, dest),
            ParsedComponent::Percentage(v) => v.to_css(dest),
            ParsedComponent::LengthPercentage(v) => v.to_css(dest),
            ParsedComponent::Color(v) => v.to_css(dest),
            ParsedComponent::Image(v) => v.to_css(dest),
            ParsedComponent::Url(v) => v.to_css(dest),
            ParsedComponent::Integer(v) => CSSIntegerFns::to_css(*v, dest),
            ParsedComponent::Angle(v) => v.to_css(dest),
            ParsedComponent::Time(v) => v.to_css(dest),
            ParsedComponent::Resolution(v) => v.to_css(dest),
            ParsedComponent::TransformFunction(v) => v.to_css(dest),
            ParsedComponent::TransformList(v) => v.to_css(dest),
            ParsedComponent::CustomIdent(v) => CustomIdentFns::to_css(v, dest),
            ParsedComponent::Literal(v) => dest.serialize_identifier(v.v()),
            ParsedComponent::Repeated(r) => dest.write_separated(
                r.components.iter(),
                |d| match r.multiplier {
                    Multiplier::Comma => d.delim(b',', false),
                    Multiplier::Space => d.write_char(b' '),
                    Multiplier::None => unreachable!(),
                },
                |d, c| c.to_css(d),
            ),
            ParsedComponent::TokenList(t) => t.to_css(dest, false),
        }
    }

    pub(crate) fn deep_clone(&self, bump: &bun_core::alloc_impl::Arena) -> Self {
        // Payload signatures aren't yet uniform across the crate (some `deep_clone()`
        // take no arena, some take `&Arena`, some are `Copy`), so the `#[derive(DeepClone)]`
        // macro can't cover this enum until the signatures are unified.
        match self {
            ParsedComponent::Length(v) => ParsedComponent::Length(v.deep_clone()),
            ParsedComponent::Number(v) => ParsedComponent::Number(*v),
            ParsedComponent::Percentage(v) => ParsedComponent::Percentage(*v),
            ParsedComponent::LengthPercentage(v) => {
                ParsedComponent::LengthPercentage(v.deep_clone())
            }
            ParsedComponent::Color(v) => ParsedComponent::Color(v.deep_clone(bump)),
            ParsedComponent::Image(v) => ParsedComponent::Image(v.deep_clone(bump)),
            ParsedComponent::Url(v) => ParsedComponent::Url(v.deep_clone(bump)),
            ParsedComponent::Integer(v) => ParsedComponent::Integer(*v),
            ParsedComponent::Angle(v) => ParsedComponent::Angle(*v),
            ParsedComponent::Time(v) => ParsedComponent::Time(*v),
            ParsedComponent::Resolution(v) => ParsedComponent::Resolution(*v),
            ParsedComponent::TransformFunction(v) => {
                ParsedComponent::TransformFunction(v.deep_clone(bump))
            }
            ParsedComponent::TransformList(v) => ParsedComponent::TransformList(v.deep_clone(bump)),
            ParsedComponent::CustomIdent(v) => ParsedComponent::CustomIdent(*v),
            ParsedComponent::Literal(v) => ParsedComponent::Literal(*v),
            ParsedComponent::Repeated(r) => ParsedComponent::Repeated(r.deep_clone(bump)),
            ParsedComponent::TokenList(t) => {
                use crate::generics::DeepClone as _;
                ParsedComponent::TokenList(t.deep_clone(bump))
            }
        }
    }
}

/// A [multiplier](https://drafts.css-houdini.org/css-properties-values-api/#multipliers) for a
/// [SyntaxComponent](SyntaxComponent). Indicates whether and how the component may be repeated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Multiplier {
    /// The component may not be repeated.
    None,
    /// The component may repeat one or more times, separated by spaces.
    Space,
    /// The component may repeat one or more times, separated by commas.
    Comma,
}
