use crate as css;
use crate::css_rules::{CssRuleList, Location};
use crate::css_values::ident::CustomIdent;
use crate::media_query::{self, MediaFeatureType, Operator, QueryCondition, QueryFeature, ToCss};
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
        let ident = match CustomIdentFns::parse(input) {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        };

        // SAFETY: CustomIdent.v points into the parser source/arena (Phase A
        // lifetime erasure — see PORTING.md §AST crates).
        let v: &'static [u8] = unsafe { crate::arena_str(ident.v) };
        // todo_stuff.match_ignore_ascii_case;
        if strings::eql_any_case_insensitive_ascii(v, &[b"none", b"and", b"not", b"or"]) {
            return Err(input.new_unexpected_token_error(css::Token::Ident(v)));
        }

        Ok(ContainerName { v: ident })
    }
}

pub use ContainerName as ContainerNameFns;
pub type ContainerSizeFeature = QueryFeature<ContainerSizeFeatureId>;

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
// `value_type` inlines the Zig `DeriveValueType` reflection; `to_css`/`from_str`
// delegate to `enum_property_util` (driven by the `EnumProperty` derive).
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

    fn from_str(s: &[u8]) -> Option<Self> {
        <Self as css::EnumProperty>::from_ascii_case_insensitive(s)
    }
}

impl ContainerSizeFeatureId {
    pub fn to_css_with_prefix(
        &self,
        prefix: &[u8],
        dest: &mut Printer,
    ) -> core::result::Result<(), PrintErr> {
        dest.write_str(prefix)?;
        self.to_css(dest)
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
        // PERF(port): was ArrayListUnmanaged fed input.arena() (parser arena);
        // Phase B decides bun_alloc::ArenaVec<'bump, _> vs global Vec crate-wide.
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
            Some(f)
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
        // PORT NOTE: Zig threaded `(input.arena(), null)` here; Phase B
        // re-threads `&Bump` once `ParserOptions` carries the arena.
        let opts = css::ParserOptions::default(None);
        let feature = StyleQuery::Feature(Property::parse(property_id, input, &opts)?);
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
    fn parse_style_query(input: &mut css::Parser) -> css::Result<Self> {
        // Zig: `return .{ .err = input.newErrorForNextToken() }`
        Err(input.new_error_for_next_token())
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
    Feature(ContainerSizeFeature),
    /// A negation of a condition.
    Not(Box<ContainerCondition>),
    /// A set of joint operations.
    Operation {
        /// The operator for the conditions.
        operator: Operator,
        /// The conditions for the operator.
        // PERF(port): was ArrayListUnmanaged fed input.arena() (parser arena);
        // Phase B decides bun_alloc::ArenaVec<'bump, _> vs global Vec crate-wide.
        conditions: Vec<ContainerCondition>,
    },
    /// A style query.
    Style(StyleQuery),
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
            Some(f)
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
        let Self::Style(query) = self else {
            unreachable!()
        };
        dest.write_str("style(")?;
        query.to_css(dest)?;
        dest.write_char(b')')
    }

    fn parse_feature(input: &mut css::Parser) -> css::Result<Self> {
        let feature = QueryFeature::<ContainerSizeFeatureId>::parse(input)?;
        Ok(ContainerCondition::Feature(feature))
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
    fn parse_style_query(input: &mut css::Parser) -> css::Result<Self> {
        use crate::media_query::QueryConditionFlags;
        // Zig defined a local `Fns` struct with two callbacks; in Rust pass closures.
        input.parse_nested_block(|i| {
            if let Ok(res) = i.try_parse(|i2| {
                media_query::parse_query_condition::<StyleQuery>(i2, QueryConditionFlags::ALLOW_OR)
            }) {
                return Ok(ContainerCondition::Style(res));
            }
            Ok(ContainerCondition::Style(StyleQuery::parse_feature(i)?))
        })
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
            Self::Operation {
                operator,
                conditions,
            } => Self::Operation {
                operator: *operator,
                conditions: conditions.iter().map(|c| c.deep_clone(bump)).collect(),
            },
            Self::Style(q) => Self::Style(q.deep_clone(bump)),
        }
    }
}

// ─── ContainerCondition parse ─────────────────────────────────────────────
impl ContainerCondition {
    pub fn parse(input: &mut css::Parser) -> css::Result<ContainerCondition> {
        use crate::media_query::QueryConditionFlags;
        media_query::parse_query_condition::<ContainerCondition>(
            input,
            QueryConditionFlags::ALLOW_OR | QueryConditionFlags::ALLOW_STYLE,
        )
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

        dest.block(|d| {
            d.newline()?;
            self.rules.to_css(d)
        })
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

// ported from: src/css/rules/container.zig
