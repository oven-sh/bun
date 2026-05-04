use crate as css;
use crate::Printer;
use crate::PrintErr;
use crate::Parser;
use crate::ParserError;
use crate::ParserOptions;
use crate::css_values::number::{CSSNumber, CSSNumberFns, CSSInteger, CSSIntegerFns};
use crate::css_values::length::{LengthPercentage, Length};
use crate::css_values::percentage::Percentage;
use crate::css_values::color::CssColor;
use crate::css_values::image::Image;
use crate::css_values::url::Url;
use crate::css_values::angle::Angle;
use crate::css_values::time::Time;
use crate::css_values::resolution::Resolution;
use crate::css_values::ident::{CustomIdent, CustomIdentFns, Ident};
use crate::css_properties::transform::{Transform, TransformList};
use crate::css_properties::custom::TokenList;

use bumpalo::collections::Vec as BumpVec;
use bun_str::strings;

// https://drafts.csswg.org/css-syntax-3/#whitespace
const SPACE_CHARACTERS: &[u8] = &[0x20, 0x09];

/// A CSS [syntax string](https://drafts.css-houdini.org/css-properties-values-api/#syntax-strings)
/// used to define the grammar for a registered custom property.
// PORT NOTE: the Zig source comments note "Zig doesn't have lifetimes, so 'i is omitted" —
// the upstream lightningcss Rust used `'i` here, so we restore it.
#[derive(Debug, Clone, PartialEq)]
pub enum SyntaxString<'i> {
    /// A list of syntax components.
    Components(BumpVec<'i, SyntaxComponent<'i>>),
    /// The universal syntax definition.
    Universal,
}

impl<'i> SyntaxString<'i> {
    pub fn deep_clone(&self, bump: &'i bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone is comptime field reflection — replace with
        // a `DeepClone` trait/derive in Phase B. For now defer to Clone.
        let _ = bump;
        self.clone()
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_char('"')?;
        match self {
            SyntaxString::Universal => dest.write_char('*')?,
            SyntaxString::Components(components) => {
                let mut first = true;
                for component in components.iter() {
                    if first {
                        first = false;
                    } else {
                        dest.delim('|', true)?;
                    }

                    component.to_css(dest)?;
                }
            }
        }

        dest.write_char('"')
    }

    pub fn parse(input: &mut Parser<'i, '_>) -> css::Result<'i, SyntaxString<'i>> {
        let string = match input.expect_string() {
            Ok(v) => v,
            Err(e) => return Err(e),
        };
        match SyntaxString::parse_string(input.allocator(), string) {
            Ok(result) => Ok(result),
            Err(()) => Err(input.new_custom_error(ParserError::InvalidValue)),
        }
    }

    /// Parses a syntax string.
    pub fn parse_string(bump: &'i bun_alloc::Arena, input: &'i [u8]) -> Result<SyntaxString<'i>, ()> {
        // https://drafts.css-houdini.org/css-properties-values-api/#parsing-syntax
        let mut trimmed_input = strings::trim_left(input, SPACE_CHARACTERS);
        if trimmed_input.is_empty() {
            return Err(());
        }

        if trimmed_input == b"*" {
            return Ok(SyntaxString::Universal);
        }

        let mut components: BumpVec<'i, SyntaxComponent<'i>> = BumpVec::new_in(bump);

        // PERF(alloc): count first?
        loop {
            let component = match SyntaxComponent::parse_string(&mut trimmed_input) {
                Ok(v) => v,
                Err(e) => return Err(e),
            };
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
    pub fn parse_value(&self, input: &mut Parser<'i, '_>) -> css::Result<'i, ParsedComponent<'i>> {
        match self {
            SyntaxString::Universal => {
                let token_list = TokenList::parse(
                    input,
                    &ParserOptions::default(input.allocator(), None),
                    0,
                )?;
                Ok(ParsedComponent::TokenList(token_list))
            }
            SyntaxString::Components(components) => {
                // Loop through each component, and return the first one that parses successfully.
                for component in components.iter() {
                    let state = input.state();
                    // PERF: deinit this on error
                    let mut parsed: BumpVec<'i, ParsedComponent<'i>> = BumpVec::new_in(input.allocator());

                    loop {
                        let value_result = input.try_parse(|i: &mut Parser<'i, '_>| -> css::Result<'i, ParsedComponent<'i>> {
                            let value = match &component.kind {
                                SyntaxComponentKind::Length => ParsedComponent::Length(Length::parse(i)?),
                                SyntaxComponentKind::Number => ParsedComponent::Number(CSSNumberFns::parse(i)?),
                                SyntaxComponentKind::Percentage => ParsedComponent::Percentage(Percentage::parse(i)?),
                                SyntaxComponentKind::LengthPercentage => ParsedComponent::LengthPercentage(LengthPercentage::parse(i)?),
                                SyntaxComponentKind::Color => ParsedComponent::Color(CssColor::parse(i)?),
                                SyntaxComponentKind::Image => ParsedComponent::Image(Image::parse(i)?),
                                SyntaxComponentKind::Url => ParsedComponent::Url(Url::parse(i)?),
                                SyntaxComponentKind::Integer => ParsedComponent::Integer(CSSIntegerFns::parse(i)?),
                                SyntaxComponentKind::Angle => ParsedComponent::Angle(Angle::parse(i)?),
                                SyntaxComponentKind::Time => ParsedComponent::Time(Time::parse(i)?),
                                SyntaxComponentKind::Resolution => ParsedComponent::Resolution(Resolution::parse(i)?),
                                SyntaxComponentKind::TransformFunction => ParsedComponent::TransformFunction(Transform::parse(i)?),
                                SyntaxComponentKind::TransformList => ParsedComponent::TransformList(TransformList::parse(i)?),
                                SyntaxComponentKind::CustomIdent => ParsedComponent::CustomIdent(CustomIdentFns::parse(i)?),
                                SyntaxComponentKind::Literal(value) => 'blk: {
                                    let location = i.current_source_location();
                                    let ident = i.expect_ident()?;
                                    if ident != *value {
                                        return Err(location.new_unexpected_token_error(css::Token::Ident(ident)));
                                    }
                                    break 'blk ParsedComponent::Literal(Ident { v: ident });
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
                                    if let Ok(token) = input.next() {
                                        if matches!(token, css::Token::Comma) {
                                            continue;
                                        }
                                        break;
                                    } else {
                                        return Ok(ParsedComponent::Repeated(Repeated {
                                            components: parsed,
                                            multiplier: component.multiplier,
                                        }));
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
#[derive(Debug, Clone, PartialEq)]
pub struct SyntaxComponent<'i> {
    pub kind: SyntaxComponentKind<'i>,
    pub multiplier: Multiplier,
}

impl<'i> SyntaxComponent<'i> {
    pub fn parse_string(input: &mut &'i [u8]) -> Result<SyntaxComponent<'i>, ()> {
        let kind = match SyntaxComponentKind::parse_string(input) {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        };

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

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.kind.to_css(dest)?;
        match self.multiplier {
            Multiplier::None => Ok(()),
            Multiplier::Comma => dest.write_char('#'),
            Multiplier::Space => dest.write_char('+'),
        }
    }

    pub fn deep_clone(&self, bump: &'i bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone — replace with DeepClone trait/derive
        let _ = bump;
        self.clone()
    }
}

/// A [syntax component component name](https://drafts.css-houdini.org/css-properties-values-api/#supported-names).
#[derive(Debug, Clone, PartialEq)]
pub enum SyntaxComponentKind<'i> {
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
    Literal(&'i [u8]),
}

impl<'i> SyntaxComponentKind<'i> {
    pub fn parse_string(input: &mut &'i [u8]) -> Result<SyntaxComponentKind<'i>, ()> {
        // https://drafts.css-houdini.org/css-properties-values-api/#consume-syntax-component
        *input = strings::trim_left(*input, SPACE_CHARACTERS);
        if strings::starts_with_char(*input, b'<') {
            // https://drafts.css-houdini.org/css-properties-values-api/#consume-data-type-name
            let end_idx = match strings::index_of_char(*input, b'>') {
                Some(i) => i as usize,
                None => return Err(()),
            };
            let name = &input[1..end_idx];
            // todo_stuff.match_ignore_ascii_case
            let component: SyntaxComponentKind<'i> = if strings::eql_case_insensitive_ascii_check_length(name, b"length") {
                SyntaxComponentKind::Length
            } else if strings::eql_case_insensitive_ascii_check_length(name, b"number") {
                SyntaxComponentKind::Number
            } else if strings::eql_case_insensitive_ascii_check_length(name, b"percentage") {
                SyntaxComponentKind::Percentage
            } else if strings::eql_case_insensitive_ascii_check_length(name, b"length-percentage") {
                SyntaxComponentKind::LengthPercentage
            } else if strings::eql_case_insensitive_ascii_check_length(name, b"color") {
                SyntaxComponentKind::Color
            } else if strings::eql_case_insensitive_ascii_check_length(name, b"image") {
                SyntaxComponentKind::Image
            } else if strings::eql_case_insensitive_ascii_check_length(name, b"url") {
                SyntaxComponentKind::Url
            } else if strings::eql_case_insensitive_ascii_check_length(name, b"integer") {
                SyntaxComponentKind::Integer
            } else if strings::eql_case_insensitive_ascii_check_length(name, b"angle") {
                SyntaxComponentKind::Angle
            } else if strings::eql_case_insensitive_ascii_check_length(name, b"time") {
                SyntaxComponentKind::Time
            } else if strings::eql_case_insensitive_ascii_check_length(name, b"resolution") {
                SyntaxComponentKind::Resolution
            } else if strings::eql_case_insensitive_ascii_check_length(name, b"transform-function") {
                SyntaxComponentKind::TransformFunction
            } else if strings::eql_case_insensitive_ascii_check_length(name, b"transform-list") {
                SyntaxComponentKind::TransformList
            } else if strings::eql_case_insensitive_ascii_check_length(name, b"custom-ident") {
                SyntaxComponentKind::CustomIdent
            } else {
                return Err(());
            };

            *input = &input[end_idx + 1..];
            Ok(component)
        } else if !input.is_empty() && is_ident_start(input[0]) {
            // A literal.
            let mut end_idx: usize = 0;
            while end_idx < input.len() && is_name_code_point(input[end_idx]) {
                end_idx += strings::utf8_byte_sequence_length_unsafe(input[end_idx]) as usize;
            }
            let literal = &input[0..end_idx];
            *input = &input[end_idx..];
            Ok(SyntaxComponentKind::Literal(literal))
        } else {
            Err(())
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
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
            SyntaxComponentKind::Literal(l) => dest.write_str_bytes(l),
        }
    }

    pub fn deep_clone(&self, bump: &'i bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone — replace with DeepClone trait/derive
        let _ = bump;
        self.clone()
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

#[derive(Debug, Clone, PartialEq)]
pub enum ParsedComponent<'i> {
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
    Image(Image<'i>),
    /// A `<url>` value.
    Url(Url<'i>),
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
    TransformList(TransformList),
    /// A `<custom-ident>` value.
    CustomIdent(CustomIdent<'i>),
    /// A literal value.
    Literal(Ident<'i>),
    /// A repeated component value.
    Repeated(Repeated<'i>),
    /// A raw token stream.
    TokenList(TokenList<'i>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Repeated<'i> {
    /// The components to repeat.
    pub components: BumpVec<'i, ParsedComponent<'i>>,
    /// A multiplier describing how the components repeat.
    pub multiplier: Multiplier,
}

impl<'i> Repeated<'i> {
    pub fn deep_clone(&self, bump: &'i bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone — replace with DeepClone trait/derive
        let _ = bump;
        self.clone()
    }
}

impl<'i> ParsedComponent<'i> {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            ParsedComponent::Length(v) => v.to_css(dest),
            ParsedComponent::Number(v) => CSSNumberFns::to_css(v, dest),
            ParsedComponent::Percentage(v) => v.to_css(dest),
            ParsedComponent::LengthPercentage(v) => v.to_css(dest),
            ParsedComponent::Color(v) => v.to_css(dest),
            ParsedComponent::Image(v) => v.to_css(dest),
            ParsedComponent::Url(v) => v.to_css(dest),
            ParsedComponent::Integer(v) => CSSIntegerFns::to_css(v, dest),
            ParsedComponent::Angle(v) => v.to_css(dest),
            ParsedComponent::Time(v) => v.to_css(dest),
            ParsedComponent::Resolution(v) => v.to_css(dest),
            ParsedComponent::TransformFunction(v) => v.to_css(dest),
            ParsedComponent::TransformList(v) => v.to_css(dest),
            ParsedComponent::CustomIdent(v) => CustomIdentFns::to_css(v, dest),
            ParsedComponent::Literal(v) => {
                let Ok(()) = css::serializer::serialize_identifier(v.v, dest) else {
                    return dest.add_fmt_error();
                };
                Ok(())
            }
            ParsedComponent::Repeated(r) => {
                let mut first = true;
                for component in r.components.iter() {
                    if !first {
                        match r.multiplier {
                            Multiplier::Comma => dest.delim(',', false)?,
                            Multiplier::Space => dest.write_char(' ')?,
                            Multiplier::None => unreachable!(),
                        }
                    } else {
                        first = false;
                    }
                    component.to_css(dest)?;
                }
                Ok(())
            }
            ParsedComponent::TokenList(t) => t.to_css(dest, false),
        }
    }

    pub fn deep_clone(&self, bump: &'i bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone — replace with DeepClone trait/derive
        let _ = bump;
        self.clone()
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/syntax.zig (524 lines)
//   confidence: medium
//   todos:      4
//   notes:      Restored 'i lifetime (Zig comment says it was elided); deep_clone stubs need DeepClone trait; arena ArrayList→bumpalo::collections::Vec<'i, _>; css::Result/Parser/Token signatures guessed.
// ──────────────────────────────────────────────────────────────────────────
