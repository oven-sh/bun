use crate as css;
use crate::css_rules::{CssRuleList, Location};
use crate::css_values::ident::CustomIdent;
use crate::media_query::{self, MediaFeatureType, Operator, QueryCondition, QueryFeature, ToCss};
use crate::properties::Property;
use crate::{PrintErr, Printer};

/// A [`<container-name>`](https://drafts.csswg.org/css-contain-3/#typedef-container-name).
pub struct ContainerName {
    pub(crate) v: CustomIdent,
}

impl ContainerName {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        super::custom_ident_to_css(&self.v, dest)
    }
}

impl ContainerName {
    #[inline]
    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        Self {
            v: self.v.deep_clone(bump),
        }
    }
}

// ─── ContainerName parse ──────────────────────────────────────────────────
impl ContainerName {
    pub fn parse(input: &mut css::Parser) -> css::Result<ContainerName> {
        use crate::css_values::ident::CustomIdentFns;
        use bun_core::strings;
        let ident = CustomIdentFns::parse(input)?;

        // SAFETY: CustomIdent.v points into the parser source/arena (lifetime
        // erasure — see PORTING.md §AST crates).
        let v: &'static [u8] = unsafe { crate::arena_str(ident.v) };
        // todo_stuff.match_ignore_ascii_case;
        if strings::eql_any_case_insensitive_ascii(v, &[b"none", b"and", b"not", b"or"]) {
            return Err(input.new_unexpected_token_error(css::Token::Ident(v)));
        }

        Ok(ContainerName { v: ident })
    }
}

pub(crate) type ContainerSizeFeature = QueryFeature<ContainerSizeFeatureId>;

#[derive(Clone, Copy, PartialEq, Eq, css::DefineEnumProperty)]
pub enum ContainerSizeFeatureId {
    /// The [width](https://w3c.github.io/csswg-drafts/css-contain-3/#width) size container feature.
    Width,
    /// The [height](https://w3c.github.io/csswg-drafts/css-contain-3/#height) size container feature.
    Height,
    /// The [inline-size](https://w3c.github.io/csswg-drafts/css-contain-3/#inline-size) size container feature.
    InlineSize,
    /// The [block-size](https://w3c.github.io/csswg-drafts/css-contain-3/#block-size) size container feature.
    BlockSize,
    /// The [aspect-ratio](https://w3c.github.io/csswg-drafts/css-contain-3/#aspect-ratio) size container feature.
    AspectRatio,
    /// The [orientation](https://w3c.github.io/csswg-drafts/css-contain-3/#orientation) size container feature.
    Orientation,
}

// `QueryFeature<FeatureId>` requires `FeatureId: FeatureIdTrait` at the type
// level, so this impl must be present for `ContainerSizeFeature` to resolve.
// `to_css`/`from_str` delegate to `enum_property_util` (driven by the
// `EnumProperty` derive).
impl crate::media_query::FeatureIdTrait for ContainerSizeFeatureId {
    fn value_type(&self) -> MediaFeatureType {
        match self {
            Self::Width => MediaFeatureType::Length,
            Self::Height => MediaFeatureType::Length,
            Self::InlineSize => MediaFeatureType::Length,
            Self::BlockSize => MediaFeatureType::Length,
            Self::AspectRatio => MediaFeatureType::Ratio,
            Self::Orientation => MediaFeatureType::Ident,
        }
    }

    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }

    fn from_str(s: &[u8]) -> Option<Self> {
        <Self as css::EnumProperty>::from_ascii_case_insensitive(s)
    }
}

/// Represents a style query within a container condition.
pub enum StyleQuery {
    /// A style feature, implicitly parenthesized.
    Feature(Box<Property>),

    /// A negation of a condition.
    Not(Box<StyleQuery>),

    /// A set of joint operations.
    Operation {
        /// The operator for the conditions.
        operator: Operator,
        /// The conditions for the operator.
        // PERF: could use bun_alloc::ArenaVec<'bump, _> instead of global Vec — profile if hot.
        conditions: Vec<StyleQuery>,
    },
}

impl ToCss for StyleQuery {
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        self.condition_to_css(dest)
    }
}

impl QueryCondition for StyleQuery {
    type Feature = Property;

    fn as_feature(&self) -> Option<&Property> {
        if let Self::Feature(f) = self {
            Some(f.as_ref())
        } else {
            None
        }
    }
    fn as_not(&self) -> Option<&Self> {
        if let Self::Not(c) = self {
            Some(c)
        } else {
            None
        }
    }
    fn as_operation(&self) -> Option<(Operator, &[Self])> {
        if let Self::Operation {
            operator,
            conditions,
        } = self
        {
            Some((*operator, conditions))
        } else {
            None
        }
    }
    fn feature_to_css(f: &Property, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        f.to_css(dest, false)
    }

    fn parse_feature(input: &mut css::Parser) -> css::Result<Self> {
        let property_id = crate::properties::PropertyId::parse(input)?;
        input.expect_colon()?;
        input.skip_whitespace();
        // The arena gets re-threaded as part of the crate-wide `'bump`
        // lifetime work (see css_parser.rs).
        let opts = css::ParserOptions::default(None);
        let feature = StyleQuery::Feature(Box::new(Property::parse(property_id, input, &opts)?));
        let _ = input.try_parse(css::css_parser::parse_important);
        Ok(feature)
    }
    fn create_negation(condition: Box<Self>) -> Self {
        StyleQuery::Not(condition)
    }
    fn create_operation(operator: Operator, conditions: Vec<Self>) -> Self {
        StyleQuery::Operation {
            operator,
            conditions,
        }
    }
    fn needs_parens(&self, parent_operator: Option<Operator>, _targets: &css::Targets) -> bool {
        match self {
            StyleQuery::Not(_) => true,
            StyleQuery::Operation { operator, .. } => Some(*operator) != parent_operator,
            StyleQuery::Feature(_) => true,
        }
    }
}

impl StyleQuery {
    fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // `Operator` is `Copy`; `Property` routes through `dc::property` until
        // the per-variant `DeepClone` derives land in `properties_generated.rs`.
        match self {
            Self::Feature(p) => Self::Feature(Box::new(super::dc::property(p, bump))),
            Self::Not(c) => Self::Not(Box::new(c.deep_clone(bump))),
            Self::Operation {
                operator,
                conditions,
            } => Self::Operation {
                operator: *operator,
                conditions: conditions.iter().map(|c| c.deep_clone(bump)).collect(),
            },
        }
    }
}

pub(crate) type ScrollStateFeature = QueryFeature<ScrollStateFeatureId>;

#[derive(Clone, Copy, PartialEq, Eq, css::DefineEnumProperty)]
pub enum ScrollStateFeatureId {
    /// The [stuck](https://drafts.csswg.org/css-conditional-5/#stuck) scroll state feature.
    Stuck,
    /// The [snapped](https://drafts.csswg.org/css-conditional-5/#snapped) scroll state feature.
    Snapped,
    /// The [scrollable](https://drafts.csswg.org/css-conditional-5/#scrollable) scroll state feature.
    Scrollable,
    /// The [scrolled](https://drafts.csswg.org/css-conditional-5/#scrolled) scroll state feature.
    Scrolled,
}

impl crate::media_query::FeatureIdTrait for ScrollStateFeatureId {
    fn value_type(&self) -> MediaFeatureType {
        MediaFeatureType::Ident
    }

    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }

    fn from_str(s: &[u8]) -> Option<Self> {
        <Self as css::EnumProperty>::from_ascii_case_insensitive(s)
    }
}

/// Represents a scroll state query within a container condition.
pub enum ScrollStateQuery {
    /// A scroll state feature, implicitly parenthesized.
    Feature(Box<ScrollStateFeature>),

    /// A negation of a condition.
    Not(Box<ScrollStateQuery>),

    /// A set of joint operations.
    Operation {
        /// The operator for the conditions.
        operator: Operator,
        /// The conditions for the operator.
        conditions: Vec<ScrollStateQuery>,
    },
}

impl ToCss for ScrollStateQuery {
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        self.condition_to_css(dest)
    }
}

impl QueryCondition for ScrollStateQuery {
    type Feature = ScrollStateFeature;

    fn as_feature(&self) -> Option<&ScrollStateFeature> {
        if let Self::Feature(f) = self {
            Some(f.as_ref())
        } else {
            None
        }
    }
    fn as_not(&self) -> Option<&Self> {
        if let Self::Not(c) = self {
            Some(c)
        } else {
            None
        }
    }
    fn as_operation(&self) -> Option<(Operator, &[Self])> {
        if let Self::Operation {
            operator,
            conditions,
        } = self
        {
            Some((*operator, conditions))
        } else {
            None
        }
    }
    fn feature_to_css(
        f: &ScrollStateFeature,
        dest: &mut Printer,
    ) -> core::result::Result<(), PrintErr> {
        f.to_css(dest)
    }

    fn parse_feature(input: &mut css::Parser) -> css::Result<Self> {
        let feature = QueryFeature::<ScrollStateFeatureId>::parse(input)?;
        Ok(ScrollStateQuery::Feature(Box::new(feature)))
    }
    fn create_negation(condition: Box<Self>) -> Self {
        ScrollStateQuery::Not(condition)
    }
    fn create_operation(operator: Operator, conditions: Vec<Self>) -> Self {
        ScrollStateQuery::Operation {
            operator,
            conditions,
        }
    }
    fn needs_parens(&self, parent_operator: Option<Operator>, targets: &css::Targets) -> bool {
        match self {
            ScrollStateQuery::Not(_) => true,
            ScrollStateQuery::Operation { operator, .. } => Some(*operator) != parent_operator,
            ScrollStateQuery::Feature(f) => f.needs_parens(parent_operator, targets),
        }
    }
}

impl ScrollStateQuery {
    fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        match self {
            Self::Feature(f) => Self::Feature(Box::new(super::dc::query_feature(f, bump))),
            Self::Not(c) => Self::Not(Box::new(c.deep_clone(bump))),
            Self::Operation {
                operator,
                conditions,
            } => Self::Operation {
                operator: *operator,
                conditions: conditions.iter().map(|c| c.deep_clone(bump)).collect(),
            },
        }
    }
}

pub enum ContainerCondition {
    /// A size container feature, implicitly parenthesized.
    Feature(Box<ContainerSizeFeature>),
    /// A negation of a condition.
    Not(Box<ContainerCondition>),
    /// A set of joint operations.
    Operation {
        /// The operator for the conditions.
        operator: Operator,
        /// The conditions for the operator.
        // PERF: could use bun_alloc::ArenaVec<'bump, _> instead of global Vec — profile if hot.
        conditions: Vec<ContainerCondition>,
    },
    /// A style query.
    Style(StyleQuery),
    /// A scroll state query.
    ScrollState(ScrollStateQuery),
}

impl ToCss for ContainerCondition {
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        self.condition_to_css(dest)
    }
}

impl QueryCondition for ContainerCondition {
    type Feature = ContainerSizeFeature;

    fn as_feature(&self) -> Option<&ContainerSizeFeature> {
        if let Self::Feature(f) = self {
            Some(f.as_ref())
        } else {
            None
        }
    }
    fn as_not(&self) -> Option<&Self> {
        if let Self::Not(c) = self {
            Some(c)
        } else {
            None
        }
    }
    fn as_operation(&self) -> Option<(Operator, &[Self])> {
        if let Self::Operation {
            operator,
            conditions,
        } = self
        {
            Some((*operator, conditions))
        } else {
            None
        }
    }
    fn feature_to_css(
        f: &ContainerSizeFeature,
        dest: &mut Printer,
    ) -> core::result::Result<(), PrintErr> {
        f.to_css(dest)
    }
    fn extra_to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            Self::Style(query) => {
                dest.write_str("style(")?;
                query.to_css(dest)?;
                dest.write_char(b')')
            }
            Self::ScrollState(query) => {
                // A plain feature prints its own parentheses.
                let needs_parens = query.needs_parens(None, &dest.targets);
                dest.write_str("scroll-state")?;
                if needs_parens {
                    dest.write_char(b'(')?;
                }
                query.to_css(dest)?;
                if needs_parens {
                    dest.write_char(b')')?;
                }
                Ok(())
            }
            Self::Feature(_) | Self::Not(_) | Self::Operation { .. } => {
                unreachable!("handled by condition_to_css")
            }
        }
    }

    fn parse_feature(input: &mut css::Parser) -> css::Result<Self> {
        let feature = QueryFeature::<ContainerSizeFeatureId>::parse(input)?;
        Ok(ContainerCondition::Feature(Box::new(feature)))
    }
    fn create_negation(condition: Box<Self>) -> Self {
        ContainerCondition::Not(condition)
    }
    fn create_operation(operator: Operator, conditions: Vec<Self>) -> Self {
        ContainerCondition::Operation {
            operator,
            conditions,
        }
    }
    fn parse_query_function(
        name: &[u8],
        input: &mut css::Parser,
        _options: &css::ParserOptions,
    ) -> Option<css::Result<Self>> {
        use bun_core::strings;
        if strings::eql_case_insensitive_ascii_check_length(name, b"style") {
            return Some(Self::parse_query_function_block(
                input,
                ContainerCondition::Style,
            ));
        }
        if strings::eql_case_insensitive_ascii_check_length(name, b"scroll-state") {
            return Some(Self::parse_query_function_block(
                input,
                ContainerCondition::ScrollState,
            ));
        }
        None
    }
    fn needs_parens(&self, parent_operator: Option<Operator>, targets: &css::Targets) -> bool {
        match self {
            ContainerCondition::Not(_) => true,
            ContainerCondition::Operation { operator, .. } => Some(*operator) != parent_operator,
            ContainerCondition::Feature(f) => f.needs_parens(parent_operator, targets),
            ContainerCondition::Style(_) | ContainerCondition::ScrollState(_) => false,
        }
    }
}

impl ContainerCondition {
    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // `QueryFeature<F>` routes through `dc::query_feature` (Clone is
        // faithful — see note there); `Operator` is `Copy`.
        match self {
            Self::Feature(f) => Self::Feature(Box::new(super::dc::query_feature(f, bump))),
            Self::Not(c) => Self::Not(Box::new(c.deep_clone(bump))),
            Self::Operation {
                operator,
                conditions,
            } => Self::Operation {
                operator: *operator,
                conditions: conditions.iter().map(|c| c.deep_clone(bump)).collect(),
            },
            Self::Style(q) => Self::Style(q.deep_clone(bump)),
            Self::ScrollState(q) => Self::ScrollState(q.deep_clone(bump)),
        }
    }
}

// ─── ContainerCondition parse ─────────────────────────────────────────────
impl ContainerCondition {
    /// Parse a query function block: a condition over `Q`, or one bare feature.
    fn parse_query_function_block<Q: QueryCondition>(
        input: &mut css::Parser,
        wrap: fn(Q) -> Self,
    ) -> css::Result<Self> {
        use crate::media_query::QueryConditionFlags;
        input.parse_nested_block(|i| {
            if let Ok(res) = i.try_parse(|i2| {
                media_query::parse_query_condition::<Q>(i2, QueryConditionFlags::ALLOW_OR)
            }) {
                return Ok(wrap(res));
            }
            Ok(wrap(Q::parse_feature(i)?))
        })
    }

    pub fn parse(input: &mut css::Parser) -> css::Result<ContainerCondition> {
        use crate::media_query::QueryConditionFlags;
        media_query::parse_query_condition::<ContainerCondition>(
            input,
            QueryConditionFlags::ALLOW_OR,
        )
    }
}

/// A [@container](https://drafts.csswg.org/css-contain-3/#container-rule) rule.
pub struct ContainerRule<R> {
    /// The name of the container.
    pub name: Option<ContainerName>,
    /// The container condition.
    pub(crate) condition: ContainerCondition,
    /// The rules within the `@container` rule.
    pub(crate) rules: CssRuleList<R>,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl<R> ContainerRule<R> {
    pub(crate) fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@container ")?;
        if let Some(name) = &self.name {
            name.to_css(dest)?;
            dest.write_char(b' ')?;
        }

        // Don't downlevel range syntax in container queries.
        let exclude = dest.targets.exclude;
        dest.targets.exclude.insert(css::Features::MEDIA_QUERIES);
        self.condition.to_css(dest)?;
        dest.targets.exclude = exclude;

        dest.block(|d| {
            d.newline()?;
            self.rules.to_css(d)
        })
    }
}

impl<R> ContainerRule<R> {
    pub(crate) fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        R: css::generics::DeepClone<'bump>,
    {
        Self {
            name: self.name.as_ref().map(|n| n.deep_clone(bump)),
            condition: self.condition.deep_clone(bump),
            rules: self.rules.deep_clone(bump),
            loc: self.loc,
        }
    }
}
