use crate::css_parser as css;
use crate::css_parser::{CssResult, ParserError, PrintErr, Printer, Token};
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
use crate::properties::custom::TokenList;
use crate::properties::transform::TransformList;

// blocked_on: properties::transform un-gate — `Transform` is not in the
// `prop_value_stub!(transform, …)` list (only `TransformList` is), so the real
// `crate::properties::transform::Transform` type does not exist while the leaf
// `.rs` is `gated_prop!`-ed. Mirror property.rs's local-stub pattern: alias to
// the ZST `TransformList` stub so the enum variant compiles, swap to the real
// type when transform.rs un-gates.
#[cfg(any())]
use crate::properties::transform::Transform;
#[cfg(not(any()))]
type Transform = crate::properties::transform::TransformList;

use bun_string::strings;

// https://drafts.csswg.org/css-syntax-3/#whitespace
const SPACE_CHARACTERS: &[u8] = &[0x20, 0x09];

/// A CSS [syntax string](https://drafts.css-houdini.org/css-properties-values-api/#syntax-strings)
/// used to define the grammar for a registered custom property.
// PORT NOTE: the Zig source comments note "Zig doesn't have lifetimes, so 'i is omitted" —
// upstream lightningcss Rust threaded `'i`, but Phase-A uses `&'static [u8]` /
// `*const [u8]` placeholders for arena-borrowed slices (matching `Token` /
// `ident.rs`). Phase B threads `'bump` and restores the lifetime.
#[derive(Debug, Clone, PartialEq)]
pub enum SyntaxString {
    /// A list of syntax components.
    // PERF(port): was arena ArrayList — `Vec` until Phase B threads `'bump` into BumpVec.
    Components(Vec<SyntaxComponent>),
    /// The universal syntax definition.
    Universal,
}

impl SyntaxString {
    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone is comptime field reflection — replace with
        // a `DeepClone` trait/derive in Phase B. For now defer to Clone.
        self.clone()
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_char(b'"')?;
        match self {
            SyntaxString::Universal => dest.write_char(b'*')?,
            SyntaxString::Components(components) => {
                let mut first = true;
                for component in components.iter() {
                    if first {
                        first = false;
                    } else {
                        dest.delim(b'|', true)?;
                    }

                    component.to_css(dest)?;
                }
            }
        }

        dest.write_char(b'"')
    }

    pub fn parse(input: &mut css::Parser) -> CssResult<SyntaxString> {
        let string = input.expect_string()?;
        match SyntaxString::parse_string(string) {
            Ok(result) => Ok(result),
            Err(()) => Err(input.new_custom_error(ParserError::invalid_value)),
        }
    }

    /// Parses a syntax string.
    pub fn parse_string(input: &[u8]) -> Result<SyntaxString, ()> {
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
    ///
    /// blocked_on: `properties::transform::{Transform,TransformList}`,
    /// `properties::custom::TokenList`, `values::{image,color}` un-gates —
    /// `ParsedComponent` carries those types directly. Body re-enables once
    /// those hubs flip.
    #[cfg(any())]
    pub fn parse_value(&self, input: &mut css::Parser) -> CssResult<ParsedComponent> {
        // (full body preserved in git history; see syntax.zig::parse_value)
    }
}

/// A [syntax component](https://drafts.css-houdini.org/css-properties-values-api/#syntax-component)
/// within a [SyntaxString](SyntaxString).
///
/// A syntax component consists of a component kind an a multiplier, which indicates how the component
/// may repeat during parsing.
#[derive(Debug, Clone, PartialEq)]
pub struct SyntaxComponent {
    pub kind: SyntaxComponentKind,
    pub multiplier: Multiplier,
}

impl SyntaxComponent {
    pub fn parse_string(input: &mut &[u8]) -> Result<SyntaxComponent, ()> {
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

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.kind.to_css(dest)?;
        match self.multiplier {
            Multiplier::None => Ok(()),
            Multiplier::Comma => dest.write_char(b'#'),
            Multiplier::Space => dest.write_char(b'+'),
        }
    }

    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone — replace with DeepClone trait/derive
        self.clone()
    }
}

/// A [syntax component component name](https://drafts.css-houdini.org/css-properties-values-api/#supported-names).
#[derive(Debug, Clone, PartialEq)]
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
    // PORT NOTE: PORTING.md §Forbidden bans laundering a parser-borrowed slice to
    // `&'static`. Zig's arena keeps the source alive for the AST's lifetime; Rust
    // would need a `'bump` lifetime threaded through `SyntaxString`. Phase-A owns
    // the bytes instead — `Box<[u8]>` per §Forbidden ("the field should be
    // `Box<[T]>` … not `&'static [T]`"). Phase B may swap for `&'bump [u8]`.
    Literal(Box<[u8]>),
}

impl SyntaxComponentKind {
    pub fn parse_string(input: &mut &[u8]) -> Result<SyntaxComponentKind, ()> {
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
            let component: SyntaxComponentKind = if strings::eql_case_insensitive_ascii_check_length(name, b"length") {
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
                end_idx += strings::utf8_byte_sequence_length(input[end_idx]) as usize;
            }
            let literal: Box<[u8]> = Box::from(&input[0..end_idx]);
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
            SyntaxComponentKind::Literal(l) => dest.write_str(&l[..]),
        }
    }

    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone — replace with DeepClone trait/derive
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

// ─── ParsedComponent gated on cross-module value-type un-gates ────────────
// `ParsedComponent` is the materialized form of a `SyntaxComponentKind` and
// carries `Image` / `CssColor` / `Transform{,List}` / `TokenList` payloads —
// all of which are still data-only stubs (gated_prop!/gated_value!). The enum
// + serializer + `SyntaxString::parse_value` re-enable when those flip.
#[cfg(any())] // blocked_on: properties::{transform,custom} + values::{image,color} un-gate
mod parsed_component_gated {
    use super::*;
    use crate::values::angle::Angle;
    use crate::values::color::CssColor;
    use crate::values::ident::{CustomIdent, CustomIdentFns, Ident};
    use crate::values::image::Image;
    use crate::values::length::{Length, LengthPercentage};
    use crate::values::number::{CSSIntegerFns, CSSNumberFns};
    use crate::values::percentage::Percentage;
    use crate::values::resolution::Resolution;
    use crate::values::time::Time;
    use crate::values::url::Url;
    use crate::properties::custom::TokenList;
    use crate::properties::transform::{Transform, TransformList};

    #[derive(Debug, Clone, PartialEq)]
    pub enum ParsedComponent {
        Length(Length),
        Number(CSSNumber),
        Percentage(Percentage),
        LengthPercentage(LengthPercentage),
        Color(CssColor),
        Image(Image),
        Url(Url),
        Integer(CSSInteger),
        Angle(Angle),
        Time(Time),
        Resolution(Resolution),
        TransformFunction(Transform),
        TransformList(TransformList),
        CustomIdent(CustomIdent),
        Literal(Ident),
        Repeated(Repeated),
        TokenList(TokenList),
    }

    #[derive(Debug, Clone, PartialEq)]
    pub struct Repeated {
        pub components: Vec<ParsedComponent>,
        pub multiplier: Multiplier,
    }
}
#[cfg(any())]
pub use parsed_component_gated::{ParsedComponent, Repeated};

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
//   notes:      SyntaxString/Component/Kind/Multiplier real (parse_string + to_css). ParsedComponent + parse_value internally gated on properties::{transform,custom} + values::{image,color}. Phase-A uses 'static slice placeholders pending 'bump threading.
// ──────────────────────────────────────────────────────────────────────────
