use crate as css;
use crate::css_rules::{CssRuleList, Location};
use crate::css_values::ident::CustomIdent;
use crate::media_query::{
    self, MediaFeatureType, Operator, QueryCondition, QueryFeature, ToCss,
};
use crate::properties::Property;
use crate::{PrintErr, Printer};

/// A [`<container-name>`](https://drafts.csswg.org/css-contain-3/#typedef-container-name).
pub struct ContainerName {
    pub v: CustomIdent,
}

impl ContainerName {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        super::custom_ident_to_css(&self.v, dest)
    }
}

impl ContainerName {
    #[inline]
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` field-walk — `CustomIdent`
        // identity-copy (arena-owned slice pointer).
        Self { v: self.v.deep_clone(bump) }
    }
}

// ─── ContainerName parse ──────────────────────────────────────────────────
// blocked_on: Parser::new_unexpected_token_error.
#[cfg(any())]
impl ContainerName {
    pub fn parse(input: &mut css::Parser) -> css::Result<ContainerName> {
        use crate::css_values::ident::CustomIdentFns;
        use bun_str::strings;
        let ident = match CustomIdentFns::parse(input) {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        };

        // todo_stuff.match_ignore_ascii_case;
        if strings::eql_case_insensitive_ascii_check_length(b"none", ident.v)
            || strings::eql_case_insensitive_ascii_check_length(b"and", ident.v)
            || strings::eql_case_insensitive_ascii_check_length(b"not", ident.v)
            || strings::eql_case_insensitive_ascii_check_length(b"or", ident.v)
        {
            return Err(input.new_unexpected_token_error(css::Token::Ident(ident.v)));
        }

        Ok(ContainerName { v: ident })
    }
}

pub use ContainerName as ContainerNameFns;
pub type ContainerSizeFeature = QueryFeature<ContainerSizeFeatureId>;

#[derive(Clone, Copy, PartialEq, Eq)]
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
// `value_type` is real (Zig DeriveValueType inlined); `to_css`/`from_str`
// delegate to enum_property_util which needs an EnumProperty derive (Phase B)
// — until then they `unimplemented!()`. All callers of those two methods are
// in the `#[cfg(any())]`-gated behavior bodies below.
impl crate::media_query::FeatureIdTrait for ContainerSizeFeatureId {
    // Zig: pub const valueType = css.DeriveValueType(@This(), ValueTypeMap).valueType;
    // PORT NOTE: DeriveValueType is comptime reflection over ValueTypeMap; expanded inline.
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

    fn from_str(_s: &[u8]) -> Option<Self> {
        // TODO(port): css::enum_property_util::from_str — needs EnumProperty derive (Phase B)
        unimplemented!("ContainerSizeFeatureId::from_str — enum_property_util EnumProperty derive")
    }
}

// PORT NOTE: Zig `css.enum_property_util.{asStr,toCss}` used `@tagName` to get
// the kebab-case variant name. Phase B should provide `#[derive(EnumProperty)]`.
impl From<ContainerSizeFeatureId> for &'static str {
    fn from(v: ContainerSizeFeatureId) -> &'static str {
        match v {
            ContainerSizeFeatureId::Width => "width",
            ContainerSizeFeatureId::Height => "height",
            ContainerSizeFeatureId::InlineSize => "inline-size",
            ContainerSizeFeatureId::BlockSize => "block-size",
            ContainerSizeFeatureId::AspectRatio => "aspect-ratio",
            ContainerSizeFeatureId::Orientation => "orientation",
        }
    }
}

impl ContainerSizeFeatureId {
    pub fn as_str(&self) -> &'static str {
        css::enum_property_util::as_str(self)
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }

    pub fn to_css_with_prefix(&self, prefix: &[u8], dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        dest.write_str(prefix)?;
        self.to_css(dest)
    }
}

// blocked_on: css::enum_property_util EnumProperty parse bound.
#[cfg(any())]
impl ContainerSizeFeatureId {
    pub fn parse(input: &mut css::Parser) -> css::Result<Self> {
        css::enum_property_util::parse::<Self>(input)
    }
}

/// Represents a style query within a container condition.
pub enum StyleQuery {
    /// A style feature, implicitly parenthesized.
    Feature(Property),

    /// A negation of a condition.
    Not(Box<StyleQuery>),

    /// A set of joint operations.
    Operation {
        /// The operator for the conditions.
        operator: Operator,
        /// The conditions for the operator.
        // PERF(port): was ArrayListUnmanaged fed input.allocator() (parser arena);
        // Phase B decides bumpalo::collections::Vec<'bump, _> vs global Vec crate-wide.
        conditions: Vec<StyleQuery>,
    },
}

impl ToCss for StyleQuery {
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            StyleQuery::Feature(f) => f.to_css(dest, false),
            StyleQuery::Not(c) => {
                dest.write_str("not ")?;
                let needs = c.needs_parens(None, &dest.targets);
                media_query::to_css_with_parens_if_needed(&**c, dest, needs)
            }
            StyleQuery::Operation { operator, conditions } => {
                media_query::operation_to_css::<StyleQuery>(*operator, conditions, dest)
            }
        }
    }
}

impl QueryCondition for StyleQuery {
    fn parse_feature(_input: &mut css::Parser) -> css::Result<Self> {
        // blocked_on: PropertyId::parse + Property::parse + css::parse_important.
        todo!("blocked_on: StyleQuery::parse_feature — PropertyId/Property::parse")
    }
    fn create_negation(condition: Box<Self>) -> Self {
        StyleQuery::Not(condition)
    }
    fn create_operation(operator: Operator, conditions: Vec<Self>) -> Self {
        StyleQuery::Operation { operator, conditions }
    }
    fn parse_style_query(_input: &mut css::Parser) -> css::Result<Self> {
        // Zig: `return .{ .err = input.newErrorForNextToken() }` — parse path
        // gated on Parser::new_error_for_next_token.
        todo!("blocked_on: StyleQuery::parse_style_query — Parser::new_error_for_next_token")
    }
    fn needs_parens(&self, parent_operator: Option<Operator>, _targets: &css::Targets) -> bool {
        match self {
            StyleQuery::Not(_) => true,
            StyleQuery::Operation { operator, .. } => Some(*operator) == parent_operator,
            StyleQuery::Feature(_) => true,
        }
    }
}

impl StyleQuery {
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` variant-walk. `Operator` is `Copy`;
        // `Property` routes through `dc::property` until the per-variant
        // `DeepClone` derives land in `properties_generated.rs`.
        match self {
            Self::Feature(p) => Self::Feature(super::dc::property(p, bump)),
            Self::Not(c) => Self::Not(Box::new(c.deep_clone(bump))),
            Self::Operation { operator, conditions } => Self::Operation {
                operator: *operator,
                conditions: conditions.iter().map(|c| c.deep_clone(bump)).collect(),
            },
        }
    }
}

// ─── StyleQuery parse ─────────────────────────────────────────────────────
// blocked_on: Property::parse, PropertyId::parse, css::parse_important,
// ParserOptions::default allocator.
#[cfg(any())]
impl StyleQuery {
    pub fn parse_feature(input: &mut css::Parser) -> css::Result<StyleQuery> {
        let property_id = match css::PropertyId::parse(input) {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        };
        if let Some(e) = input.expect_colon().as_err() {
            return Err(e);
        }
        input.skip_whitespace();
        // TODO(port): css is an AST crate — thread &Bump from input.allocator() into ParserOptions::default (Zig passed (input.allocator(), null))
        let opts = css::ParserOptions::default();
        let feature = StyleQuery::Feature(match Property::parse(property_id, input, &opts) {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        });
        let _ = input.try_parse(css::parse_important);
        Ok(feature)
    }
}

pub enum ContainerCondition {
    /// A size container feature, implicitly parenthesized.
    Feature(ContainerSizeFeature),
    /// A negation of a condition.
    Not(Box<ContainerCondition>),
    /// A set of joint operations.
    Operation {
        /// The operator for the conditions.
        operator: Operator,
        /// The conditions for the operator.
        // PERF(port): was ArrayListUnmanaged fed input.allocator() (parser arena);
        // Phase B decides bumpalo::collections::Vec<'bump, _> vs global Vec crate-wide.
        conditions: Vec<ContainerCondition>,
    },
    /// A style query.
    Style(StyleQuery),
}

impl ToCss for ContainerCondition {
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            ContainerCondition::Feature(f) => f.to_css(dest),
            ContainerCondition::Not(c) => {
                dest.write_str("not ")?;
                let needs = c.needs_parens(None, &dest.targets);
                media_query::to_css_with_parens_if_needed(&**c, dest, needs)
            }
            ContainerCondition::Operation { operator, conditions } => {
                media_query::operation_to_css::<ContainerCondition>(*operator, conditions, dest)
            }
            ContainerCondition::Style(query) => {
                dest.write_str("style(")?;
                query.to_css(dest)?;
                dest.write_char(b')')
            }
        }
    }
}

impl QueryCondition for ContainerCondition {
    fn parse_feature(_input: &mut css::Parser) -> css::Result<Self> {
        // blocked_on: QueryFeature::<ContainerSizeFeatureId>::parse.
        todo!("blocked_on: ContainerCondition::parse_feature — QueryFeature::parse")
    }
    fn create_negation(condition: Box<Self>) -> Self {
        ContainerCondition::Not(condition)
    }
    fn create_operation(operator: Operator, conditions: Vec<Self>) -> Self {
        ContainerCondition::Operation { operator, conditions }
    }
    fn parse_style_query(_input: &mut css::Parser) -> css::Result<Self> {
        // blocked_on: Parser::{try_parse,parse_nested_block} +
        // media_query::parse_query_condition::<StyleQuery>.
        todo!("blocked_on: ContainerCondition::parse_style_query — parse_nested_block")
    }
    fn needs_parens(&self, parent_operator: Option<Operator>, targets: &css::Targets) -> bool {
        match self {
            ContainerCondition::Not(_) => true,
            ContainerCondition::Operation { operator, .. } => Some(*operator) == parent_operator,
            ContainerCondition::Feature(f) => f.needs_parens(parent_operator, targets),
            ContainerCondition::Style(_) => false,
        }
    }
}

impl ContainerCondition {
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` variant-walk. `QueryFeature<F>`
        // routes through `dc::query_feature` (Clone is faithful — see note
        // there); `Operator` is `Copy`.
        match self {
            Self::Feature(f) => Self::Feature(super::dc::query_feature(f, bump)),
            Self::Not(c) => Self::Not(Box::new(c.deep_clone(bump))),
            Self::Operation { operator, conditions } => Self::Operation {
                operator: *operator,
                conditions: conditions.iter().map(|c| c.deep_clone(bump)).collect(),
            },
            Self::Style(q) => Self::Style(q.deep_clone(bump)),
        }
    }
}

// ─── ContainerCondition parse ─────────────────────────────────────────────
// blocked_on: media_query::{parse_query_condition,QueryConditionFlags
// constructors}, QueryFeature::parse, Parser::{try_parse,parse_nested_block}.
#[cfg(any())]
impl ContainerCondition {
    pub fn parse(input: &mut css::Parser) -> css::Result<ContainerCondition> {
        use crate::media_query::{self, QueryConditionFlags};
        media_query::parse_query_condition::<ContainerCondition>(
            input,
            QueryConditionFlags::ALLOW_OR | QueryConditionFlags::ALLOW_STYLE,
        )
    }

    pub fn parse_feature(input: &mut css::Parser) -> css::Result<ContainerCondition> {
        let feature = match QueryFeature::<ContainerSizeFeatureId>::parse(input) {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        };
        Ok(ContainerCondition::Feature(feature))
    }

    pub fn parse_style_query(input: &mut css::Parser) -> css::Result<ContainerCondition> {
        use crate::media_query::{self, QueryConditionFlags};
        // Zig defined a local `Fns` struct with two callbacks; in Rust we pass closures.
        fn adapted_parse_query_condition(
            i: &mut css::Parser,
            flags: QueryConditionFlags,
        ) -> css::Result<StyleQuery> {
            media_query::parse_query_condition::<StyleQuery>(i, flags)
        }

        fn parse_nested_block_fn(_: (), i: &mut css::Parser) -> css::Result<ContainerCondition> {
            if let Some(res) = i
                .try_parse(|i| adapted_parse_query_condition(i, QueryConditionFlags::ALLOW_OR))
                .as_value()
            {
                return Ok(ContainerCondition::Style(res));
            }

            Ok(ContainerCondition::Style(match StyleQuery::parse_feature(i) {
                Ok(vv) => vv,
                Err(e) => return Err(e),
            }))
        }

        input.parse_nested_block::<ContainerCondition, ()>((), parse_nested_block_fn)
    }
}

/// A [@container](https://drafts.csswg.org/css-contain-3/#container-rule) rule.
pub struct ContainerRule<R> {
    /// The name of the container.
    pub name: Option<ContainerName>,
    /// The container condition.
    pub condition: ContainerCondition,
    /// The rules within the `@container` rule.
    pub rules: CssRuleList<R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<R> ContainerRule<R> {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@container ")?;
        if let Some(name) = &self.name {
            name.to_css(dest)?;
            dest.write_char(b' ')?;
        }

        // Don't downlevel range syntax in container queries.
        let exclude = dest.targets.exclude;
        // Zig: bun.bits.insert(css.targets.Features, &dest.targets.exclude, .media_queries);
        dest.targets.exclude.insert(css::Features::MEDIA_QUERIES);
        self.condition.to_css(dest)?;
        dest.targets.exclude = exclude;

        dest.whitespace()?;
        dest.write_char(b'{')?;
        dest.indent();
        dest.newline()?;
        self.rules.to_css(dest)?;
        dest.dedent();
        dest.newline()?;
        dest.write_char(b'}')
    }
}

impl<R> ContainerRule<R> {
    pub fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        R: css::generics::DeepClone<'bump>,
    {
        // PORT NOTE: `css.implementDeepClone` field-walk.
        Self {
            name: self.name.as_ref().map(|n| n.deep_clone(bump)),
            condition: self.condition.deep_clone(bump),
            rules: self.rules.deep_clone(bump),
            loc: self.loc,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/container.zig (350 lines)
//   confidence: medium
//   todos:      3
//   notes:      structs/enums un-gated (data-only); Vec<T> kept over bumpalo Vec (PERF-tagged) — Phase B picks arena vs global crate-wide; parse/to_css/deep_clone gated on media_query parse_query_condition/operation_to_css + Property/PropertyId behavior + enum_property_util/FeatureIdTrait derive + CssRuleList::to_css + DeepClone
// ──────────────────────────────────────────────────────────────────────────
