use crate as css;
use crate::css_values::length::Length;
use crate::css_values::number::{CSSNumber, CSSNumberFns, CSSInteger, CSSIntegerFns};
use crate::css_values::resolution::Resolution;
use crate::css_values::ratio::Ratio;
use crate::css_values::ident::{Ident, IdentFns, DashedIdent, DashedIdentFns};
use crate::css_properties::custom::EnvironmentVariable;
use crate::{Printer, PrintErr, Result, Parser, ParserError, Token, Delimiters};

use bun_str::strings;
use bun_collections::BabyList;
use bun_options_types::ImportRecord;

pub use crate::Error;

// TODO(port): the CSS crate borrows strings from parser input with lifetime `'i`
// (matching lightningcss). Phase A avoids struct lifetime params; Phase B should
// thread `'i` through `MediaType::Custom`, `Ident`, `DashedIdent`, etc.

/// Trait modeling Zig's `ValidQueryCondition` comptime interface check.
/// Any type that can appear as a node in a query-condition tree.
pub trait QueryCondition: Sized {
    /// `fn parse_feature<'t>(input: &mut Parser<'i, 't>) -> Result<Self, ParseError<'i, ParserError<'i>>>;`
    fn parse_feature(input: &mut Parser) -> Result<Self>;
    /// `fn create_negation(condition: Box<Self>) -> Self;`
    fn create_negation(condition: Box<Self>) -> Self;
    /// `fn create_operation(operator: Operator, conditions: Vec<Self>) -> Self;`
    fn create_operation(operator: Operator, conditions: Vec<Self>) -> Self;
    /// `fn parse_style_query<'t>(input: &mut Parser<'i, 't>) -> Result<Self, ParseError<'i, ParserError<'i>>>;`
    fn parse_style_query(input: &mut Parser) -> Result<Self>;
    /// `fn needs_parens(&self, parent_operator: Option<Operator>, targets: &Targets) -> bool;`
    fn needs_parens(&self, parent_operator: Option<Operator>, targets: &css::targets::Targets) -> bool;
}

/// A [media query list](https://drafts.csswg.org/mediaqueries/#mq-list).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct MediaList {
    /// The list of media queries.
    pub media_queries: Vec<MediaQuery>,
    // PERF(port): was ArrayListUnmanaged backed by parser arena — profile in Phase B
}

impl MediaList {
    /// Parse a media query list from CSS.
    pub fn parse(input: &mut Parser) -> Result<MediaList> {
        let mut media_queries: Vec<MediaQuery> = Vec::new();
        loop {
            let mq = match input.parse_until_before(
                Delimiters { comma: true, ..Default::default() },
                css::void_wrap(MediaQuery::parse),
            ) {
                Ok(v) => v,
                Err(e) => {
                    if matches!(e.kind, css::ErrorKind::Basic(css::BasicParseErrorKind::EndOfInput)) {
                        break;
                    }
                    return Err(e);
                }
            };
            media_queries.push(mq);

            match input.next() {
                Ok(tok) => {
                    if !matches!(tok, Token::Comma) {
                        bun_core::Output::panic(
                            "Unreachable code: expected a comma after parsing a MediaQuery.\n\nThis is a bug in Bun's CSS parser. Please file a bug report at https://github.com/oven-sh/bun/issues/new/choose",
                        );
                    }
                }
                Err(_) => break,
            }
        }

        Ok(MediaList { media_queries })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        if self.media_queries.is_empty() {
            return dest.write_str("not all");
        }

        let mut first = true;
        for query in &self.media_queries {
            if !first {
                dest.delim(',', false)?;
            }
            first = false;
            query.to_css(dest)?;
        }
        Ok(())
    }

    // PORT NOTE: `hash`/`eql` were reflection-driven (`css.implementHash`/`implementEql`)
    // → replaced by `#[derive(PartialEq)]` and a manual `Hash` impl in Phase B if needed.
    // TODO(port): derive Hash once all field types implement it.

    pub fn deep_clone(&self) -> MediaList {
        MediaList {
            media_queries: css::deep_clone(&self.media_queries),
        }
    }

    pub fn clone_with_import_records(&self, _: &mut BabyList<ImportRecord>) -> Self {
        self.deep_clone()
    }

    /// Returns whether the media query list always matches.
    pub fn always_matches(&self) -> bool {
        // If the media list is empty, it always matches.
        self.media_queries.is_empty()
            || self.media_queries.iter().all(|query| query.always_matches())
    }

    /// Returns whether the media query list never matches.
    pub fn never_matches(&self) -> bool {
        !self.media_queries.is_empty()
            && self.media_queries.iter().all(|query| query.never_matches())
    }
}

/// A binary `and` or `or` operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
pub enum Operator {
    /// The `and` operator.
    #[strum(serialize = "and")]
    And,
    /// The `or` operator.
    #[strum(serialize = "or")]
    Or,
}

impl Operator {
    pub fn as_str(&self) -> &'static [u8] {
        css::enum_property_util::as_str(self)
    }

    pub fn parse(input: &mut Parser) -> Result<Self> {
        css::enum_property_util::parse(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }
}

/// A [media query](https://drafts.csswg.org/mediaqueries/#media).
#[derive(Debug, Clone, PartialEq)]
pub struct MediaQuery {
    /// The qualifier for this query.
    pub qualifier: Option<Qualifier>,
    /// The media type for this query, that can be known, unknown, or "all".
    pub media_type: MediaType,
    /// The condition that this media query contains. This cannot have `or`
    /// in the first level.
    pub condition: Option<MediaCondition>,
}

impl MediaQuery {
    pub fn deep_clone(&self) -> MediaQuery {
        MediaQuery {
            qualifier: self.qualifier,
            media_type: self.media_type.clone(),
            condition: self.condition.as_ref().map(|c| c.deep_clone()),
        }
    }

    // PORT NOTE: `hash`/`eql` → derives (see MediaList note).

    /// Returns whether the media query is guaranteed to always match.
    pub fn always_matches(&self) -> bool {
        self.qualifier.is_none()
            && matches!(self.media_type, MediaType::All)
            && self.condition.is_none()
    }

    pub fn parse(input: &mut Parser) -> Result<MediaQuery> {
        fn try_parse_fn(i: &mut Parser) -> Result<(Option<Qualifier>, Option<MediaType>)> {
            let qualifier = i.try_parse(Qualifier::parse).ok();
            let media_type = MediaType::parse(i)?;
            Ok((qualifier, Some(media_type)))
        }

        let (qualifier, explicit_media_type) = match input.try_parse(try_parse_fn) {
            Ok(v) => v,
            Err(_) => (None, None),
        };

        let condition = if explicit_media_type.is_none() {
            Some(MediaCondition::parse_with_flags(
                input,
                QueryConditionFlags { allow_or: true, ..Default::default() },
            )?)
        } else if input.try_parse(|i| i.expect_ident_matching("and")).is_ok() {
            Some(MediaCondition::parse_with_flags(input, QueryConditionFlags::default())?)
        } else {
            None
        };

        let media_type = explicit_media_type.unwrap_or(MediaType::All);

        Ok(MediaQuery {
            qualifier,
            media_type,
            condition,
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        if let Some(qual) = &self.qualifier {
            qual.to_css(dest)?;
            dest.write_char(' ')?;
        }

        match &self.media_type {
            MediaType::All => {
                // We need to print "all" if there's a qualifier, or there's
                // just an empty list of expressions.
                //
                // Otherwise, we'd serialize media queries like "(min-width:
                // 40px)" in "all (min-width: 40px)", which is unexpected.
                if self.qualifier.is_some() || self.condition.is_none() {
                    dest.write_str("all")?;
                }
            }
            MediaType::Print => {
                dest.write_str("print")?;
            }
            MediaType::Screen => {
                dest.write_str("screen")?;
            }
            MediaType::Custom(desc) => {
                dest.write_str(desc)?;
            }
        }

        let Some(condition) = &self.condition else { return Ok(()); };

        let needs_parens = if !matches!(self.media_type, MediaType::All) || self.qualifier.is_some() {
            dest.write_str(" and ")?;
            matches!(condition, MediaCondition::Operation { operator, .. } if *operator != Operator::And)
        } else {
            false
        };

        to_css_with_parens_if_needed(condition, dest, needs_parens)
    }

    pub fn never_matches(&self) -> bool {
        self.qualifier == Some(Qualifier::Not)
            && matches!(self.media_type, MediaType::All)
            && self.condition.is_none()
    }
}

/// Flags for `parse_query_condition`.
// PORT NOTE: Zig `packed struct(u8)` with two bool fields → bitflags!
bitflags::bitflags! {
    #[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
    pub struct QueryConditionFlags: u8 {
        /// Whether to allow top-level "or" boolean logic.
        const ALLOW_OR = 1 << 0;
        /// Whether to allow style container queries.
        const ALLOW_STYLE = 1 << 1;
    }
}

impl QueryConditionFlags {
    #[inline]
    pub fn allow_or(self) -> bool {
        self.contains(Self::ALLOW_OR)
    }
    #[inline]
    pub fn allow_style(self) -> bool {
        self.contains(Self::ALLOW_STYLE)
    }
}

// PORT NOTE: Zig packed-struct field-init `.{ .allow_or = true }` callsites are
// kept readable via this builder; Phase B may collapse to `QueryConditionFlags::ALLOW_OR`.
// TODO(port): unify callsites on bitflags constants directly.

pub fn to_css_with_parens_if_needed<V: ToCss + ?Sized>(
    v: &V,
    dest: &mut Printer,
    needs_parens: bool,
) -> core::result::Result<(), PrintErr> {
    if needs_parens {
        dest.write_char('(')?;
    }
    v.to_css(dest)?;
    if needs_parens {
        dest.write_char(')')?;
    }
    Ok(())
}

/// Helper trait for `to_css_with_parens_if_needed` (replaces Zig `anytype`).
pub trait ToCss {
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr>;
}

/// A [media query qualifier](https://drafts.csswg.org/mediaqueries/#mq-prefix).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
pub enum Qualifier {
    /// Prevents older browsers from matching the media query.
    #[strum(serialize = "only")]
    Only,
    /// Negates a media query.
    #[strum(serialize = "not")]
    Not,
}

impl Qualifier {
    pub fn as_str(&self) -> &'static [u8] {
        css::enum_property_util::as_str(self)
    }

    pub fn parse(input: &mut Parser) -> Result<Self> {
        css::enum_property_util::parse(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }
}

/// A [media type](https://drafts.csswg.org/mediaqueries/#media-types) within a media query.
#[derive(Debug, Clone, PartialEq)]
pub enum MediaType {
    /// Matches all devices.
    All,
    /// Matches printers, and devices intended to reproduce a printed
    /// display, such as a web browser showing a document in "Print Preview".
    Print,
    /// Matches all devices that aren't matched by print.
    Screen,
    /// An unknown media type.
    // TODO(port): arena/input-borrowed slice; Phase B threads `'i` lifetime
    Custom(*const [u8]),
}

impl MediaType {
    pub fn parse(input: &mut Parser) -> Result<MediaType> {
        let name = input.expect_ident()?;
        Ok(MediaType::from_str(name))
    }

    pub fn from_str(name: &[u8]) -> MediaType {
        // Zig: ComptimeEnumMap with ASCII-case-insensitive lookup.
        if strings::eql_case_insensitive_ascii_check_length(name, b"all") {
            MediaType::All
        } else if strings::eql_case_insensitive_ascii_check_length(name, b"print") {
            MediaType::Print
        } else if strings::eql_case_insensitive_ascii_check_length(name, b"screen") {
            MediaType::Screen
        } else {
            MediaType::Custom(name as *const [u8])
        }
    }

    // PORT NOTE: `eql`/`hash` → derives; Custom compares by pointee bytes in Zig.
    // TODO(port): manual PartialEq/Hash for Custom variant comparing pointee bytes.
}

pub fn operation_to_css<QC: QueryCondition + ToCss>(
    operator: Operator,
    conditions: &Vec<QC>,
    dest: &mut Printer,
) -> core::result::Result<(), PrintErr> {
    let first = &conditions[0];
    to_css_with_parens_if_needed(first, dest, first.needs_parens(Some(operator), &dest.targets))?;
    if conditions.len() == 1 {
        return Ok(());
    }
    for item in &conditions[1..] {
        dest.write_char(' ')?;
        operator.to_css(dest)?;
        dest.write_char(' ')?;
        to_css_with_parens_if_needed(item, dest, item.needs_parens(Some(operator), &dest.targets))?;
    }
    Ok(())
}

/// Represents a media condition.
///
/// Implements QueryCondition interface.
#[derive(Debug, Clone, PartialEq)]
pub enum MediaCondition {
    Feature(MediaFeature),
    Not(Box<MediaCondition>),
    Operation {
        operator: Operator,
        conditions: Vec<MediaCondition>,
        // PERF(port): was ArrayListUnmanaged backed by parser arena — profile in Phase B
    },
}

impl ToCss for MediaCondition {
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        MediaCondition::to_css(self, dest)
    }
}

impl MediaCondition {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            MediaCondition::Feature(f) => {
                f.to_css(dest)?;
            }
            MediaCondition::Not(c) => {
                dest.write_str("not ")?;
                to_css_with_parens_if_needed(&**c, dest, c.needs_parens(None, &dest.targets))?;
            }
            MediaCondition::Operation { operator, conditions } => {
                operation_to_css(*operator, conditions, dest)?;
            }
        }
        Ok(())
    }

    pub fn parse_with_flags(input: &mut Parser, flags: QueryConditionFlags) -> Result<MediaCondition> {
        parse_query_condition::<MediaCondition>(input, flags)
    }

    pub fn deep_clone(&self) -> MediaCondition {
        match self {
            MediaCondition::Feature(f) => MediaCondition::Feature(f.deep_clone()),
            MediaCondition::Not(c) => MediaCondition::Not(Box::new(c.deep_clone())),
            MediaCondition::Operation { operator, conditions } => MediaCondition::Operation {
                operator: *operator,
                conditions: css::deep_clone(conditions),
            },
        }
    }

    // PORT NOTE: `eql`/`hash` → derives.
}

impl QueryCondition for MediaCondition {
    /// QueryCondition.parseFeature
    fn parse_feature(input: &mut Parser) -> Result<MediaCondition> {
        let feature = MediaFeature::parse(input)?;
        Ok(MediaCondition::Feature(feature))
    }

    /// QueryCondition.createNegation
    fn create_negation(condition: Box<MediaCondition>) -> MediaCondition {
        MediaCondition::Not(condition)
    }

    /// QueryCondition.createOperation
    fn create_operation(operator: Operator, conditions: Vec<MediaCondition>) -> MediaCondition {
        MediaCondition::Operation { operator, conditions }
    }

    /// QueryCondition.parseStyleQuery
    fn parse_style_query(input: &mut Parser) -> Result<MediaCondition> {
        Err(input.new_error_for_next_token())
    }

    /// QueryCondition.needsParens
    fn needs_parens(&self, parent_operator: Option<Operator>, targets: &css::targets::Targets) -> bool {
        match self {
            MediaCondition::Not(_) => true,
            MediaCondition::Operation { operator, .. } => Some(*operator) != parent_operator,
            MediaCondition::Feature(f) => f.needs_parens(parent_operator, targets),
        }
    }
}

/// Parse a single query condition.
pub fn parse_query_condition<QC: QueryCondition>(
    input: &mut Parser,
    flags: QueryConditionFlags,
) -> Result<QC> {
    let location = input.current_source_location();
    let (is_negation, is_style) = 'brk: {
        let tok = input.next()?;
        match tok {
            Token::OpenParen => break 'brk (false, false),
            Token::Ident(ident) => {
                if strings::eql_case_insensitive_ascii_check_length(ident, b"not") {
                    break 'brk (true, false);
                }
            }
            Token::Function(f) => {
                if flags.allow_style()
                    && strings::eql_case_insensitive_ascii_check_length(f, b"style")
                {
                    break 'brk (false, true);
                }
            }
            _ => {}
        }
        return Err(location.new_unexpected_token_error(tok.clone()));
    };

    let first_condition: QC = 'first_condition: {
        let val: u8 = ((is_negation as u8) << 1) | (is_style as u8);
        // (is_negation, is_style)
        match val {
            // (true, false)
            0b10 => {
                let inner_condition = parse_parens_or_function::<QC>(input, flags)?;
                return Ok(QC::create_negation(Box::new(inner_condition)));
            }
            // (true, true)
            0b11 => {
                let inner_condition = QC::parse_style_query(input)?;
                return Ok(QC::create_negation(Box::new(inner_condition)));
            }
            0b00 => break 'first_condition parse_paren_block::<QC>(input, flags)?,
            0b01 => break 'first_condition QC::parse_style_query(input)?,
            _ => unreachable!(),
        }
    };

    let operator: Operator = match input.try_parse(Operator::parse) {
        Ok(op) => op,
        Err(_) => return Ok(first_condition),
    };

    if !flags.allow_or() && operator == Operator::Or {
        return Err(location.new_unexpected_token_error(Token::Ident(b"or")));
        // TODO(port): Token::Ident payload type may differ; adjust in Phase B.
    }

    let mut conditions: Vec<QC> = Vec::new();
    // PERF(port): was arena-backed ArrayList — profile in Phase B
    conditions.push(first_condition);
    conditions.push(parse_parens_or_function::<QC>(input, flags)?);

    let delim: &'static str = match operator {
        Operator::And => "and",
        Operator::Or => "or",
    };

    loop {
        if input.try_parse(|i| i.expect_ident_matching(delim)).is_err() {
            return Ok(QC::create_operation(operator, conditions));
        }

        conditions.push(parse_parens_or_function::<QC>(input, flags)?);
    }
}

/// Parse a media condition in parentheses, or a style() function.
pub fn parse_parens_or_function<QC: QueryCondition>(
    input: &mut Parser,
    flags: QueryConditionFlags,
) -> Result<QC> {
    let location = input.current_source_location();
    let t = input.next()?;
    match t {
        Token::OpenParen => return parse_paren_block::<QC>(input, flags),
        Token::Function(f) => {
            if flags.allow_style()
                && strings::eql_case_insensitive_ascii_check_length(f, b"style")
            {
                return QC::parse_style_query(input);
            }
        }
        _ => {}
    }
    Err(location.new_unexpected_token_error(t.clone()))
}

fn parse_paren_block<QC: QueryCondition>(
    input: &mut Parser,
    flags: QueryConditionFlags,
) -> Result<QC> {
    input.parse_nested_block(move |i: &mut Parser| -> Result<QC> {
        if let Ok(inner) = i.try_parse(|i2| parse_query_condition::<QC>(i2, flags)) {
            return Ok(inner);
        }
        QC::parse_feature(i)
    })
}

/// A [media feature](https://drafts.csswg.org/mediaqueries/#typedef-media-feature)
pub type MediaFeature = QueryFeature<MediaFeatureId>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
pub enum MediaFeatureId {
    /// The [width](https://w3c.github.io/csswg-drafts/mediaqueries-5/#width) media feature.
    #[strum(serialize = "width")]
    Width,
    /// The [height](https://w3c.github.io/csswg-drafts/mediaqueries-5/#height) media feature.
    #[strum(serialize = "height")]
    Height,
    /// The [aspect-ratio](https://w3c.github.io/csswg-drafts/mediaqueries-5/#aspect-ratio) media feature.
    #[strum(serialize = "aspect-ratio")]
    AspectRatio,
    /// The [orientation](https://w3c.github.io/csswg-drafts/mediaqueries-5/#orientation) media feature.
    #[strum(serialize = "orientation")]
    Orientation,
    /// The [overflow-block](https://w3c.github.io/csswg-drafts/mediaqueries-5/#overflow-block) media feature.
    #[strum(serialize = "overflow-block")]
    OverflowBlock,
    /// The [overflow-inline](https://w3c.github.io/csswg-drafts/mediaqueries-5/#overflow-inline) media feature.
    #[strum(serialize = "overflow-inline")]
    OverflowInline,
    /// The [horizontal-viewport-segments](https://w3c.github.io/csswg-drafts/mediaqueries-5/#horizontal-viewport-segments) media feature.
    #[strum(serialize = "horizontal-viewport-segments")]
    HorizontalViewportSegments,
    /// The [vertical-viewport-segments](https://w3c.github.io/csswg-drafts/mediaqueries-5/#vertical-viewport-segments) media feature.
    #[strum(serialize = "vertical-viewport-segments")]
    VerticalViewportSegments,
    /// The [display-mode](https://w3c.github.io/csswg-drafts/mediaqueries-5/#display-mode) media feature.
    #[strum(serialize = "display-mode")]
    DisplayMode,
    /// The [resolution](https://w3c.github.io/csswg-drafts/mediaqueries-5/#resolution) media feature.
    #[strum(serialize = "resolution")]
    Resolution,
    /// The [scan](https://w3c.github.io/csswg-drafts/mediaqueries-5/#scan) media feature.
    #[strum(serialize = "scan")]
    Scan,
    /// The [grid](https://w3c.github.io/csswg-drafts/mediaqueries-5/#grid) media feature.
    #[strum(serialize = "grid")]
    Grid,
    /// The [update](https://w3c.github.io/csswg-drafts/mediaqueries-5/#update) media feature.
    #[strum(serialize = "update")]
    Update,
    /// The [environment-blending](https://w3c.github.io/csswg-drafts/mediaqueries-5/#environment-blending) media feature.
    #[strum(serialize = "environment-blending")]
    EnvironmentBlending,
    /// The [color](https://w3c.github.io/csswg-drafts/mediaqueries-5/#color) media feature.
    #[strum(serialize = "color")]
    Color,
    /// The [color-index](https://w3c.github.io/csswg-drafts/mediaqueries-5/#color-index) media feature.
    #[strum(serialize = "color-index")]
    ColorIndex,
    /// The [monochrome](https://w3c.github.io/csswg-drafts/mediaqueries-5/#monochrome) media feature.
    #[strum(serialize = "monochrome")]
    Monochrome,
    /// The [color-gamut](https://w3c.github.io/csswg-drafts/mediaqueries-5/#color-gamut) media feature.
    #[strum(serialize = "color-gamut")]
    ColorGamut,
    /// The [dynamic-range](https://w3c.github.io/csswg-drafts/mediaqueries-5/#dynamic-range) media feature.
    #[strum(serialize = "dynamic-range")]
    DynamicRange,
    /// The [inverted-colors](https://w3c.github.io/csswg-drafts/mediaqueries-5/#inverted-colors) media feature.
    #[strum(serialize = "inverted-colors")]
    InvertedColors,
    /// The [pointer](https://w3c.github.io/csswg-drafts/mediaqueries-5/#pointer) media feature.
    #[strum(serialize = "pointer")]
    Pointer,
    /// The [hover](https://w3c.github.io/csswg-drafts/mediaqueries-5/#hover) media feature.
    #[strum(serialize = "hover")]
    Hover,
    /// The [any-pointer](https://w3c.github.io/csswg-drafts/mediaqueries-5/#any-pointer) media feature.
    #[strum(serialize = "any-pointer")]
    AnyPointer,
    /// The [any-hover](https://w3c.github.io/csswg-drafts/mediaqueries-5/#any-hover) media feature.
    #[strum(serialize = "any-hover")]
    AnyHover,
    /// The [nav-controls](https://w3c.github.io/csswg-drafts/mediaqueries-5/#nav-controls) media feature.
    #[strum(serialize = "nav-controls")]
    NavControls,
    /// The [video-color-gamut](https://w3c.github.io/csswg-drafts/mediaqueries-5/#video-color-gamut) media feature.
    #[strum(serialize = "video-color-gamut")]
    VideoColorGamut,
    /// The [video-dynamic-range](https://w3c.github.io/csswg-drafts/mediaqueries-5/#video-dynamic-range) media feature.
    #[strum(serialize = "video-dynamic-range")]
    VideoDynamicRange,
    /// The [scripting](https://w3c.github.io/csswg-drafts/mediaqueries-5/#scripting) media feature.
    #[strum(serialize = "scripting")]
    Scripting,
    /// The [prefers-reduced-motion](https://w3c.github.io/csswg-drafts/mediaqueries-5/#prefers-reduced-motion) media feature.
    #[strum(serialize = "prefers-reduced-motion")]
    PrefersReducedMotion,
    /// The [prefers-reduced-transparency](https://w3c.github.io/csswg-drafts/mediaqueries-5/#prefers-reduced-transparency) media feature.
    #[strum(serialize = "prefers-reduced-transparency")]
    PrefersReducedTransparency,
    /// The [prefers-contrast](https://w3c.github.io/csswg-drafts/mediaqueries-5/#prefers-contrast) media feature.
    #[strum(serialize = "prefers-contrast")]
    PrefersContrast,
    /// The [forced-colors](https://w3c.github.io/csswg-drafts/mediaqueries-5/#forced-colors) media feature.
    #[strum(serialize = "forced-colors")]
    ForcedColors,
    /// The [prefers-color-scheme](https://w3c.github.io/csswg-drafts/mediaqueries-5/#prefers-color-scheme) media feature.
    #[strum(serialize = "prefers-color-scheme")]
    PrefersColorScheme,
    /// The [prefers-reduced-data](https://w3c.github.io/csswg-drafts/mediaqueries-5/#prefers-reduced-data) media feature.
    #[strum(serialize = "prefers-reduced-data")]
    PrefersReducedData,
    /// The [device-width](https://w3c.github.io/csswg-drafts/mediaqueries-5/#device-width) media feature.
    #[strum(serialize = "device-width")]
    DeviceWidth,
    /// The [device-height](https://w3c.github.io/csswg-drafts/mediaqueries-5/#device-height) media feature.
    #[strum(serialize = "device-height")]
    DeviceHeight,
    /// The [device-aspect-ratio](https://w3c.github.io/csswg-drafts/mediaqueries-5/#device-aspect-ratio) media feature.
    #[strum(serialize = "device-aspect-ratio")]
    DeviceAspectRatio,

    /// The non-standard -webkit-device-pixel-ratio media feature.
    #[strum(serialize = "-webkit-device-pixel-ratio")]
    WebkitDevicePixelRatio,
    /// The non-standard -moz-device-pixel-ratio media feature.
    #[strum(serialize = "-moz-device-pixel-ratio")]
    MozDevicePixelRatio,
}

impl MediaFeatureId {
    // Zig: `pub const valueType = css.DeriveValueType(@This(), ValueTypeMap).valueType;`
    pub fn value_type(&self) -> MediaFeatureType {
        use MediaFeatureId::*;
        use MediaFeatureType as T;
        match self {
            Width => T::Length,
            Height => T::Length,
            AspectRatio => T::Ratio,
            Orientation => T::Ident,
            OverflowBlock => T::Ident,
            OverflowInline => T::Ident,
            HorizontalViewportSegments => T::Integer,
            VerticalViewportSegments => T::Integer,
            DisplayMode => T::Ident,
            Resolution => T::Resolution,
            Scan => T::Ident,
            Grid => T::Boolean,
            Update => T::Ident,
            EnvironmentBlending => T::Ident,
            Color => T::Integer,
            ColorIndex => T::Integer,
            Monochrome => T::Integer,
            ColorGamut => T::Ident,
            DynamicRange => T::Ident,
            InvertedColors => T::Ident,
            Pointer => T::Ident,
            Hover => T::Ident,
            AnyPointer => T::Ident,
            AnyHover => T::Ident,
            NavControls => T::Ident,
            VideoColorGamut => T::Ident,
            VideoDynamicRange => T::Ident,
            Scripting => T::Ident,
            PrefersReducedMotion => T::Ident,
            PrefersReducedTransparency => T::Ident,
            PrefersContrast => T::Ident,
            ForcedColors => T::Ident,
            PrefersColorScheme => T::Ident,
            PrefersReducedData => T::Ident,
            DeviceWidth => T::Length,
            DeviceHeight => T::Length,
            DeviceAspectRatio => T::Ratio,
            WebkitDevicePixelRatio => T::Number,
            MozDevicePixelRatio => T::Number,
        }
    }

    pub fn to_css_with_prefix(
        &self,
        prefix: &[u8],
        dest: &mut Printer,
    ) -> core::result::Result<(), PrintErr> {
        match self {
            MediaFeatureId::WebkitDevicePixelRatio => {
                dest.write_fmt(format_args!(
                    "-webkit-{}device-pixel-ratio",
                    bstr::BStr::new(prefix)
                ))
            }
            _ => {
                dest.write_str(prefix)?;
                self.to_css(dest)
            }
        }
    }

    #[inline]
    pub fn as_str(&self) -> &'static [u8] {
        css::enum_property_util::as_str(self)
    }

    pub fn parse(input: &mut Parser) -> Result<Self> {
        css::enum_property_util::parse(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }
}

/// Trait bound for `FeatureId` type parameter (replaces Zig comptime duck-typing).
pub trait FeatureIdTrait: Copy + PartialEq + Eq {
    fn value_type(&self) -> MediaFeatureType;
    fn parse(input: &mut Parser) -> Result<Self>;
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr>;
    fn to_css_with_prefix(&self, prefix: &[u8], dest: &mut Printer) -> core::result::Result<(), PrintErr>;
}

impl FeatureIdTrait for MediaFeatureId {
    fn value_type(&self) -> MediaFeatureType {
        MediaFeatureId::value_type(self)
    }
    fn parse(input: &mut Parser) -> Result<Self> {
        MediaFeatureId::parse(input)
    }
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        MediaFeatureId::to_css(self, dest)
    }
    fn to_css_with_prefix(&self, prefix: &[u8], dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        MediaFeatureId::to_css_with_prefix(self, prefix, dest)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum QueryFeature<FeatureId: FeatureIdTrait> {
    /// A plain media feature, e.g. `(min-width: 240px)`.
    Plain {
        /// The name of the feature.
        name: MediaFeatureName<FeatureId>,
        /// The feature value.
        value: MediaFeatureValue,
    },

    /// A boolean feature, e.g. `(hover)`.
    Boolean {
        /// The name of the feature.
        name: MediaFeatureName<FeatureId>,
    },

    /// A range, e.g. `(width > 240px)`.
    Range {
        /// The name of the feature.
        name: MediaFeatureName<FeatureId>,
        /// A comparator.
        operator: MediaFeatureComparison,
        /// The feature value.
        value: MediaFeatureValue,
    },

    /// An interval, e.g. `(120px < width < 240px)`.
    Interval {
        /// The name of the feature.
        name: MediaFeatureName<FeatureId>,
        /// A start value.
        start: MediaFeatureValue,
        /// A comparator for the start value.
        start_operator: MediaFeatureComparison,
        /// The end value.
        end: MediaFeatureValue,
        /// A comparator for the end value.
        end_operator: MediaFeatureComparison,
    },
}

impl<FeatureId: FeatureIdTrait> QueryFeature<FeatureId> {
    pub fn deep_clone(&self) -> Self {
        match self {
            QueryFeature::Plain { name, value } => QueryFeature::Plain {
                name: name.clone(),
                value: value.deep_clone(),
            },
            QueryFeature::Boolean { name } => QueryFeature::Boolean { name: name.clone() },
            QueryFeature::Range { name, operator, value } => QueryFeature::Range {
                name: name.clone(),
                operator: *operator,
                value: value.deep_clone(),
            },
            QueryFeature::Interval {
                name,
                start,
                start_operator,
                end,
                end_operator,
            } => QueryFeature::Interval {
                name: name.clone(),
                start: start.deep_clone(),
                start_operator: *start_operator,
                end: end.deep_clone(),
                end_operator: *end_operator,
            },
        }
    }

    // PORT NOTE: `eql`/`hash` → derives.

    pub fn needs_parens(&self, parent_operator: Option<Operator>, targets: &css::Targets) -> bool {
        parent_operator != Some(Operator::And)
            && matches!(self, QueryFeature::Interval { .. })
            && targets.should_compile_same(css::Feature::MediaIntervalSyntax)
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        dest.write_char('(')?;

        match self {
            QueryFeature::Boolean { name } => {
                name.to_css(dest)?;
            }
            QueryFeature::Plain { name, value } => {
                name.to_css(dest)?;
                dest.delim(':', false)?;
                value.to_css(dest)?;
            }
            QueryFeature::Range { name, operator, value } => {
                // If range syntax is unsupported, use min/max prefix if possible.
                if dest.targets.should_compile_same(css::Feature::MediaRangeSyntax) {
                    return write_min_max(operator, name, value, dest);
                }
                name.to_css(dest)?;
                operator.to_css(dest)?;
                value.to_css(dest)?;
            }
            QueryFeature::Interval {
                name,
                start,
                start_operator,
                end,
                end_operator,
            } => {
                if dest.targets.should_compile_same(css::Feature::MediaIntervalSyntax) {
                    write_min_max(&start_operator.opposite(), name, start, dest)?;
                    dest.write_str(" and (")?;
                    return write_min_max(end_operator, name, end, dest);
                }

                start.to_css(dest)?;
                start_operator.to_css(dest)?;
                name.to_css(dest)?;
                end_operator.to_css(dest)?;
                end.to_css(dest)?;
            }
        }

        dest.write_char(')')
    }

    pub fn parse(input: &mut Parser) -> Result<Self> {
        match input.try_parse(Self::parse_name_first) {
            Ok(res) => Ok(res),
            Err(e) => {
                if matches!(e.kind, css::ErrorKind::Custom(ParserError::InvalidMediaQuery)) {
                    return Err(e);
                }
                Self::parse_value_first(input)
            }
        }
    }

    pub fn parse_name_first(input: &mut Parser) -> Result<Self> {
        let (name, legacy_op) = MediaFeatureName::<FeatureId>::parse(input)?;

        let operator = match input.try_parse(|i| consume_operation_or_colon(i, true)) {
            Ok(op) => op,
            Err(_) => return Ok(QueryFeature::Boolean { name }),
        };

        if operator.is_some() && legacy_op.is_some() {
            return Err(input.new_custom_error(ParserError::InvalidMediaQuery));
        }

        let value = MediaFeatureValue::parse(input, name.value_type())?;
        if !value.check_type(name.value_type()) {
            return Err(input.new_custom_error(ParserError::InvalidMediaQuery));
        }

        if let Some(op) = operator.or(legacy_op) {
            if !name.value_type().allows_ranges() {
                return Err(input.new_custom_error(ParserError::InvalidMediaQuery));
            }

            Ok(QueryFeature::Range {
                name,
                operator: op,
                value,
            })
        } else {
            Ok(QueryFeature::Plain { name, value })
        }
    }

    pub fn parse_value_first(input: &mut Parser) -> Result<Self> {
        // We need to find the feature name first so we know the type.
        let start = input.state();
        let name = 'name: {
            loop {
                if let Ok(result) = MediaFeatureName::<FeatureId>::parse(input) {
                    let name: MediaFeatureName<FeatureId> = result.0;
                    let legacy_op: Option<MediaFeatureComparison> = result.1;
                    if legacy_op.is_some() {
                        return Err(input.new_custom_error(ParserError::InvalidMediaQuery));
                    }
                    break 'name name;
                }
                if input.is_exhausted() {
                    return Err(input.new_custom_error(ParserError::InvalidMediaQuery));
                }
            }
        };

        input.reset(&start);

        // Now we can parse the first value.
        let value = MediaFeatureValue::parse(input, name.value_type())?;
        let operator = consume_operation_or_colon(input, false)?;

        // Skip over the feature name again.
        {
            let (feature_name, _blah) = MediaFeatureName::<FeatureId>::parse(input)?;
            debug_assert!(feature_name.eql(&name));
        }

        if !name.value_type().allows_ranges() || !value.check_type(name.value_type()) {
            return Err(input.new_custom_error(ParserError::InvalidMediaQuery));
        }

        if let Ok(end_operator_) = input.try_parse(|i| consume_operation_or_colon(i, false)) {
            let start_operator = operator.unwrap();
            let end_operator = end_operator_.unwrap();
            // Start and end operators must be matching.
            const GT: u8 = MediaFeatureComparison::GreaterThan as u8;
            const GTE: u8 = MediaFeatureComparison::GreaterThanEqual as u8;
            const LT: u8 = MediaFeatureComparison::LessThan as u8;
            const LTE: u8 = MediaFeatureComparison::LessThanEqual as u8;
            let check_val: u8 = (start_operator as u8) | (end_operator as u8);
            #[allow(unreachable_patterns)] // GT|GT == GT, etc.
            match check_val {
                v if v == (GT | GT)
                    || v == (GT | GTE)
                    || v == (GTE | GTE)
                    || v == (LT | LT)
                    || v == (LT | LTE)
                    || v == (LTE | LTE) => {}
                _ => return Err(input.new_custom_error(ParserError::InvalidMediaQuery)),
            }

            let end_value = MediaFeatureValue::parse(input, name.value_type())?;
            if !end_value.check_type(name.value_type()) {
                return Err(input.new_custom_error(ParserError::InvalidMediaQuery));
            }

            Ok(QueryFeature::Interval {
                name,
                start: value,
                start_operator,
                end: end_value,
                end_operator,
            })
        } else {
            let final_operator = operator.unwrap().opposite();
            Ok(QueryFeature::Range {
                name,
                operator: final_operator,
                value,
            })
        }
    }
}

impl<FeatureId: FeatureIdTrait> ToCss for QueryFeature<FeatureId> {
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        QueryFeature::to_css(self, dest)
    }
}

/// Consumes an operation or a colon, or returns an error.
fn consume_operation_or_colon(
    input: &mut Parser,
    allow_colon: bool,
) -> Result<Option<MediaFeatureComparison>> {
    let location = input.current_source_location();
    let first_delim = 'first_delim: {
        let loc = input.current_source_location();
        let next_token = input.next()?;
        match next_token {
            Token::Colon if allow_colon => return Ok(None),
            Token::Delim(oper) => break 'first_delim *oper,
            _ => {}
        }
        return Err(loc.new_unexpected_token_error(next_token.clone()));
    };

    match first_delim {
        '=' => Ok(Some(MediaFeatureComparison::Equal)),
        '>' => {
            if input.try_parse(|i| i.expect_delim('=')).is_ok() {
                return Ok(Some(MediaFeatureComparison::GreaterThanEqual));
            }
            Ok(Some(MediaFeatureComparison::GreaterThan))
        }
        '<' => {
            if input.try_parse(|i| i.expect_delim('=')).is_ok() {
                return Ok(Some(MediaFeatureComparison::LessThanEqual));
            }
            Ok(Some(MediaFeatureComparison::LessThan))
        }
        _ => Err(location.new_unexpected_token_error(Token::Delim(first_delim))),
    }
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
pub enum MediaFeatureComparison {
    /// `=`
    #[strum(serialize = "equal")]
    Equal = 1,
    /// `>`
    #[strum(serialize = "greater-than")]
    GreaterThan = 2,
    /// `>=`
    #[strum(serialize = "greater-than-equal")]
    GreaterThanEqual = 4,
    /// `<`
    #[strum(serialize = "less-than")]
    LessThan = 8,
    /// `<=`
    #[strum(serialize = "less-than-equal")]
    LessThanEqual = 16,
}

impl MediaFeatureComparison {
    pub fn as_str(&self) -> &'static [u8] {
        css::enum_property_util::as_str(self)
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            MediaFeatureComparison::Equal => {
                dest.delim('-', true)
            }
            MediaFeatureComparison::GreaterThan => {
                dest.delim('>', true)
            }
            MediaFeatureComparison::GreaterThanEqual => {
                dest.whitespace()?;
                dest.write_str(">=")?;
                dest.whitespace()
            }
            MediaFeatureComparison::LessThan => {
                dest.delim('<', true)
            }
            MediaFeatureComparison::LessThanEqual => {
                dest.whitespace()?;
                dest.write_str("<=")?;
                dest.whitespace()
            }
        }
    }

    pub fn opposite(self) -> Self {
        match self {
            MediaFeatureComparison::GreaterThan => MediaFeatureComparison::LessThan,
            MediaFeatureComparison::GreaterThanEqual => MediaFeatureComparison::LessThanEqual,
            MediaFeatureComparison::LessThan => MediaFeatureComparison::GreaterThan,
            MediaFeatureComparison::LessThanEqual => MediaFeatureComparison::GreaterThanEqual,
            MediaFeatureComparison::Equal => MediaFeatureComparison::Equal,
        }
    }
}

/// [media feature value](https://drafts.csswg.org/mediaqueries/#typedef-mf-value) within a media query.
///
/// See [MediaFeature](MediaFeature).
#[derive(Debug, Clone, PartialEq)]
pub enum MediaFeatureValue {
    /// A length value.
    Length(Length),
    /// A number value.
    Number(CSSNumber),
    /// An integer value.
    Integer(CSSInteger),
    /// A boolean value.
    Boolean(bool),
    /// A resolution.
    Resolution(Resolution),
    /// A ratio.
    Ratio(Ratio),
    /// An identifier.
    Ident(Ident),
    /// An environment variable reference.
    Env(EnvironmentVariable),
}

impl MediaFeatureValue {
    // PORT NOTE: `eql` → derive PartialEq.

    pub fn deep_clone(&self) -> MediaFeatureValue {
        match self {
            MediaFeatureValue::Length(l) => MediaFeatureValue::Length(l.deep_clone()),
            MediaFeatureValue::Number(n) => MediaFeatureValue::Number(*n),
            MediaFeatureValue::Integer(i) => MediaFeatureValue::Integer(*i),
            MediaFeatureValue::Boolean(b) => MediaFeatureValue::Boolean(*b),
            MediaFeatureValue::Resolution(r) => MediaFeatureValue::Resolution(*r),
            MediaFeatureValue::Ratio(r) => MediaFeatureValue::Ratio(*r),
            MediaFeatureValue::Ident(i) => MediaFeatureValue::Ident(i.clone()),
            MediaFeatureValue::Env(e) => MediaFeatureValue::Env(e.deep_clone()),
        }
    }

    // PORT NOTE: `deinit` → `impl Drop` is unnecessary; owned fields drop automatically.

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            MediaFeatureValue::Length(len) => len.to_css(dest),
            MediaFeatureValue::Number(num) => CSSNumberFns::to_css(num, dest),
            MediaFeatureValue::Integer(int) => CSSIntegerFns::to_css(int, dest),
            MediaFeatureValue::Boolean(b) => {
                if *b {
                    dest.write_char('1')
                } else {
                    dest.write_char('0')
                }
            }
            MediaFeatureValue::Resolution(res) => res.to_css(dest),
            MediaFeatureValue::Ratio(ratio) => ratio.to_css(dest),
            MediaFeatureValue::Ident(id) => IdentFns::to_css(id, dest),
            MediaFeatureValue::Env(env) => EnvironmentVariable::to_css(env, dest, false),
        }
    }

    pub fn check_type(&self, expected_type: MediaFeatureType) -> bool {
        let vt = self.value_type();
        if expected_type == MediaFeatureType::Unknown || vt == MediaFeatureType::Unknown {
            return true;
        }
        expected_type == vt
    }

    /// Parses a single media query feature value, with an expected type.
    /// If the type is unknown, pass MediaFeatureType::Unknown instead.
    pub fn parse(input: &mut Parser, expected_type: MediaFeatureType) -> Result<MediaFeatureValue> {
        if let Ok(value) = input.try_parse(|i| Self::parse_known(i, expected_type)) {
            return Ok(value);
        }

        Self::parse_unknown(input)
    }

    pub fn parse_known(input: &mut Parser, expected_type: MediaFeatureType) -> Result<MediaFeatureValue> {
        Ok(match expected_type {
            MediaFeatureType::Boolean => {
                let value = CSSIntegerFns::parse(input)?;
                if value != 0 && value != 1 {
                    return Err(input.new_custom_error(ParserError::InvalidValue));
                }
                return Ok(MediaFeatureValue::Boolean(value == 1));
            }
            MediaFeatureType::Number => MediaFeatureValue::Number(CSSNumberFns::parse(input)?),
            MediaFeatureType::Integer => MediaFeatureValue::Integer(CSSIntegerFns::parse(input)?),
            MediaFeatureType::Length => MediaFeatureValue::Length(Length::parse(input)?),
            MediaFeatureType::Resolution => MediaFeatureValue::Resolution(Resolution::parse(input)?),
            MediaFeatureType::Ratio => MediaFeatureValue::Ratio(Ratio::parse(input)?),
            MediaFeatureType::Ident => MediaFeatureValue::Ident(IdentFns::parse(input)?),
            MediaFeatureType::Unknown => {
                return Err(input.new_custom_error(ParserError::InvalidValue));
            }
        })
    }

    pub fn parse_unknown(input: &mut Parser) -> Result<MediaFeatureValue> {
        // Ratios are ambiguous with numbers because the second param is optional (e.g. 2/1 == 2).
        // We require the / delimiter when parsing ratios so that 2/1 ends up as a ratio and 2 is
        // parsed as a number.
        if let Ok(ratio) = input.try_parse(Ratio::parse_required) {
            return Ok(MediaFeatureValue::Ratio(ratio));
        }

        // Parse number next so that unitless values are not parsed as lengths.
        if let Ok(num) = input.try_parse(CSSNumberFns::parse) {
            return Ok(MediaFeatureValue::Number(num));
        }

        if let Ok(res) = input.try_parse(Length::parse) {
            return Ok(MediaFeatureValue::Length(res));
        }

        if let Ok(res) = input.try_parse(Resolution::parse) {
            return Ok(MediaFeatureValue::Resolution(res));
        }

        if let Ok(env) = input.try_parse(EnvironmentVariable::parse) {
            return Ok(MediaFeatureValue::Env(env));
        }

        let ident = IdentFns::parse(input)?;
        Ok(MediaFeatureValue::Ident(ident))
    }

    pub fn add_f32(self, other: f32) -> MediaFeatureValue {
        match self {
            MediaFeatureValue::Length(len) => MediaFeatureValue::Length(len.add(Length::px(other))),
            // .length => |len| .{
            //     .length = .{
            //         .value = .{ .px = other },
            //     },
            // },
            MediaFeatureValue::Number(num) => MediaFeatureValue::Number(num + other),
            MediaFeatureValue::Integer(num) => MediaFeatureValue::Integer(
                num + if css::signfns::is_sign_positive(other) { 1i32 } else { -1i32 },
            ),
            MediaFeatureValue::Boolean(v) => MediaFeatureValue::Boolean(v),
            MediaFeatureValue::Resolution(res) => MediaFeatureValue::Resolution(res.add_f32(other)),
            MediaFeatureValue::Ratio(ratio) => MediaFeatureValue::Ratio(ratio.add_f32(other)),
            MediaFeatureValue::Ident(id) => MediaFeatureValue::Ident(id),
            MediaFeatureValue::Env(env) => MediaFeatureValue::Env(env), // TODO: calc support
        }
    }

    pub fn value_type(&self) -> MediaFeatureType {
        match self {
            MediaFeatureValue::Length(_) => MediaFeatureType::Length,
            MediaFeatureValue::Number(_) => MediaFeatureType::Number,
            MediaFeatureValue::Integer(_) => MediaFeatureType::Integer,
            MediaFeatureValue::Boolean(_) => MediaFeatureType::Boolean,
            MediaFeatureValue::Resolution(_) => MediaFeatureType::Resolution,
            MediaFeatureValue::Ratio(_) => MediaFeatureType::Ratio,
            MediaFeatureValue::Ident(_) => MediaFeatureType::Ident,
            MediaFeatureValue::Env(_) => MediaFeatureType::Unknown,
        }
    }
}

/// The type of a media feature.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MediaFeatureType {
    /// A length value.
    Length,
    /// A number value.
    Number,
    /// An integer value.
    Integer,
    /// A boolean value, either 0 or 1.
    Boolean,
    /// A resolution.
    Resolution,
    /// A ratio.
    Ratio,
    /// An identifier.
    Ident,
    /// An unknown type.
    Unknown,
}

impl MediaFeatureType {
    pub fn allows_ranges(self) -> bool {
        match self {
            MediaFeatureType::Length
            | MediaFeatureType::Number
            | MediaFeatureType::Integer
            | MediaFeatureType::Resolution
            | MediaFeatureType::Ratio
            | MediaFeatureType::Unknown => true,
            MediaFeatureType::Boolean | MediaFeatureType::Ident => false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum MediaFeatureName<FeatureId: FeatureIdTrait> {
    /// A standard media query feature identifier.
    Standard(FeatureId),

    /// A custom author-defined environment variable.
    Custom(DashedIdent),

    /// An unknown environment variable.
    Unknown(Ident),
}

impl<FeatureId: FeatureIdTrait> MediaFeatureName<FeatureId> {
    pub fn eql(&self, rhs: &Self) -> bool {
        match (self, rhs) {
            (MediaFeatureName::Standard(a), MediaFeatureName::Standard(b)) => a == b,
            (MediaFeatureName::Custom(a), MediaFeatureName::Custom(b)) => {
                strings::eql(a.v, b.v)
            }
            (MediaFeatureName::Unknown(a), MediaFeatureName::Unknown(b)) => {
                strings::eql(a.v, b.v)
            }
            _ => false,
        }
    }

    pub fn value_type(&self) -> MediaFeatureType {
        match self {
            MediaFeatureName::Standard(standard) => standard.value_type(),
            _ => MediaFeatureType::Unknown,
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            MediaFeatureName::Standard(v) => v.to_css(dest),
            MediaFeatureName::Custom(d) => DashedIdentFns::to_css(d, dest),
            MediaFeatureName::Unknown(v) => IdentFns::to_css(v, dest),
        }
    }

    pub fn to_css_with_prefix(
        &self,
        prefix: &[u8],
        dest: &mut Printer,
    ) -> core::result::Result<(), PrintErr> {
        match self {
            MediaFeatureName::Standard(v) => v.to_css_with_prefix(prefix, dest),
            MediaFeatureName::Custom(d) => {
                dest.write_str(prefix)?;
                DashedIdentFns::to_css(d, dest)
            }
            MediaFeatureName::Unknown(v) => {
                dest.write_str(prefix)?;
                IdentFns::to_css(v, dest)
            }
        }
    }

    /// Parses a media feature name.
    pub fn parse(input: &mut Parser) -> Result<(Self, Option<MediaFeatureComparison>)> {
        let ident = input.expect_ident()?;

        if strings::starts_with(ident, b"--") {
            return Ok((
                MediaFeatureName::Custom(DashedIdent { v: ident }),
                None,
            ));
        }

        let mut name: &[u8] = ident;

        // Webkit places its prefixes before "min" and "max". Remove it first, and
        // re-add after removing min/max.
        let is_webkit = strings::starts_with_case_insensitive_ascii(name, b"-webkit-");
        if is_webkit {
            name = &name[8..];
        }

        let comparator: Option<MediaFeatureComparison> = 'comparator: {
            if strings::starts_with_case_insensitive_ascii(name, b"min-") {
                name = &name[4..];
                break 'comparator Some(MediaFeatureComparison::GreaterThanEqual);
            } else if strings::starts_with_case_insensitive_ascii(name, b"max-") {
                name = &name[4..];
                break 'comparator Some(MediaFeatureComparison::LessThanEqual);
            } else {
                break 'comparator None;
            }
        };

        let final_name: Vec<u8>;
        let final_name_slice: &[u8] = if is_webkit {
            // PERF: stack buffer here?
            let mut v = Vec::with_capacity(8 + name.len());
            use std::io::Write;
            write!(&mut v, "-webkit-").unwrap();
            v.extend_from_slice(name);
            final_name = v;
            &final_name
        } else {
            name
        };

        // PORT NOTE: Zig had `defer if (is_webkit) input.allocator().free(final_name)`;
        // in Rust, `final_name: Vec<u8>` drops automatically at scope exit.
        // The Zig comptime assert that FeatureId is an enum is encoded by the
        // `FeatureIdTrait: Copy` bound (no borrowed input survives).

        if let Ok(standard) = css::parse_utility::parse_string(
            final_name_slice,
            FeatureId::parse,
        ) {
            return Ok((MediaFeatureName::Standard(standard), comparator));
        }

        Ok((
            MediaFeatureName::Unknown(Ident { v: ident }),
            None,
        ))
    }

    // PORT NOTE: `hash` → derive.
}

fn write_min_max<FeatureId: FeatureIdTrait>(
    operator: &MediaFeatureComparison,
    name: &MediaFeatureName<FeatureId>,
    value: &MediaFeatureValue,
    dest: &mut Printer,
) -> core::result::Result<(), PrintErr> {
    let prefix: Option<&'static [u8]> = match operator {
        MediaFeatureComparison::GreaterThan | MediaFeatureComparison::GreaterThanEqual => {
            Some(b"min-")
        }
        MediaFeatureComparison::LessThan | MediaFeatureComparison::LessThanEqual => Some(b"max-"),
        MediaFeatureComparison::Equal => None,
    };

    if let Some(p) = prefix {
        name.to_css_with_prefix(p, dest)?;
    } else {
        name.to_css(dest)?;
    }

    dest.delim(':', false)?;

    let adjusted: Option<MediaFeatureValue> = match operator {
        MediaFeatureComparison::GreaterThan => Some(value.deep_clone().add_f32(0.001)),
        MediaFeatureComparison::LessThan => Some(value.deep_clone().add_f32(-0.001)),
        _ => None,
    };

    if let Some(val) = adjusted {
        // PORT NOTE: Zig had `defer val.deinit(dest.allocator)` — Drop handles this.
        val.to_css(dest)?;
    } else {
        value.to_css(dest)?;
    }

    dest.write_char(')')
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/media_query.zig (1568 lines)
//   confidence: medium
//   todos:      5
//   notes:      css crate needs unified `'i` input lifetime; QueryConditionFlags uses bitflags; Result<T> mapped to Ok/Err; arena→Vec/Box per LIFETIMES.tsv
// ──────────────────────────────────────────────────────────────────────────
