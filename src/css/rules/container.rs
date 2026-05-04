use bun_css as css;
use bun_css::css_rules::Location;
use bun_css::css_values::ident::{CustomIdent, CustomIdentFns};
use bun_css::media_query::{self, Operator, QueryConditionFlags, QueryFeature};
use bun_css::targets::Features;
use bun_css::{MediaFeatureType, Parser, ParserOptions, PrintErr, Printer, Property, PropertyId, Result, Targets};
use bun_str::strings;

#[derive(Clone)]
pub struct ContainerName {
    pub v: CustomIdent,
}

impl ContainerName {
    pub fn parse(input: &mut Parser) -> Result<ContainerName> {
        let ident = match CustomIdentFns::parse(input) {
            Result::Ok(vv) => vv,
            Result::Err(e) => return Result::Err(e),
        };

        // todo_stuff.match_ignore_ascii_case;
        // TODO(port): verify exact snake_case name of eqlCaseInsensitiveASCIIICheckLength in bun_str
        if strings::eql_case_insensitive_ascii_icheck_length(b"none", ident.v)
            || strings::eql_case_insensitive_ascii_icheck_length(b"and", ident.v)
            || strings::eql_case_insensitive_ascii_icheck_length(b"not", ident.v)
            || strings::eql_case_insensitive_ascii_icheck_length(b"or", ident.v)
        {
            return Result::Err(input.new_unexpected_token_error(css::Token::Ident(ident.v)));
        }

        Result::Ok(ContainerName { v: ident })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        CustomIdentFns::to_css(&self.v, dest)
    }

    pub fn deep_clone(&self) -> Self {
        // PERF(port): was css.implementDeepClone (comptime field-walk) — derive Clone covers it
        self.clone()
    }
}

pub use ContainerName as ContainerNameFns;
pub type ContainerSizeFeature = QueryFeature<ContainerSizeFeatureId>;

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum ContainerSizeFeatureId {
    /// The [width](https://w3c.github.io/csswg-drafts/css-contain-3/#width) size container feature.
    #[strum(serialize = "width")]
    Width,
    /// The [height](https://w3c.github.io/csswg-drafts/css-contain-3/#height) size container feature.
    #[strum(serialize = "height")]
    Height,
    /// The [inline-size](https://w3c.github.io/csswg-drafts/css-contain-3/#inline-size) size container feature.
    #[strum(serialize = "inline-size")]
    InlineSize,
    /// The [block-size](https://w3c.github.io/csswg-drafts/css-contain-3/#block-size) size container feature.
    #[strum(serialize = "block-size")]
    BlockSize,
    /// The [aspect-ratio](https://w3c.github.io/csswg-drafts/css-contain-3/#aspect-ratio) size container feature.
    #[strum(serialize = "aspect-ratio")]
    AspectRatio,
    /// The [orientation](https://w3c.github.io/csswg-drafts/css-contain-3/#orientation) size container feature.
    #[strum(serialize = "orientation")]
    Orientation,
}

impl ContainerSizeFeatureId {
    // Zig: pub const valueType = css.DeriveValueType(@This(), ValueTypeMap).valueType;
    // TODO(port): DeriveValueType is comptime reflection over ValueTypeMap; expanded inline here.
    pub fn value_type(&self) -> MediaFeatureType {
        match self {
            Self::Width => MediaFeatureType::Length,
            Self::Height => MediaFeatureType::Length,
            Self::InlineSize => MediaFeatureType::Length,
            Self::BlockSize => MediaFeatureType::Length,
            Self::AspectRatio => MediaFeatureType::Ratio,
            Self::Orientation => MediaFeatureType::Ident,
        }
    }

    pub fn as_str(&self) -> &'static [u8] {
        css::enum_property_util::as_str(self)
    }

    pub fn parse(input: &mut Parser) -> Result<Self> {
        css::enum_property_util::parse::<Self>(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }

    pub fn to_css_with_prefix(&self, prefix: &[u8], dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        dest.write_str(prefix)?;
        self.to_css(dest)
    }
}

/// Represents a style query within a container condition.
#[derive(Clone)]
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
        // PERF(port): was ArrayListUnmanaged fed input.allocator() (parser arena); css is an AST crate —
        // Phase B decides bumpalo::collections::Vec<'bump, _> vs global Vec for the whole css crate.
        conditions: Vec<StyleQuery>,
    },
}

impl StyleQuery {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            StyleQuery::Feature(f) => f.to_css(dest, false),
            StyleQuery::Not(c) => {
                dest.write_str(b"not ")?;
                media_query::to_css_with_parens_if_needed(
                    &**c,
                    dest,
                    c.needs_parens(None, &dest.targets),
                )
            }
            StyleQuery::Operation { operator, conditions } => {
                media_query::operation_to_css::<StyleQuery>(*operator, conditions, dest)
            }
        }
    }

    pub fn parse_feature(input: &mut Parser) -> Result<StyleQuery> {
        let property_id = match PropertyId::parse(input) {
            Result::Ok(vv) => vv,
            Result::Err(e) => return Result::Err(e),
        };
        if let Some(e) = input.expect_colon().as_err() {
            return Result::Err(e);
        }
        input.skip_whitespace();
        // TODO(port): css is an AST crate — thread &Bump from input.allocator() into ParserOptions::default (Zig passed (input.allocator(), null))
        let opts = ParserOptions::default();
        let feature = StyleQuery::Feature(match Property::parse(property_id, input, &opts) {
            Result::Ok(vv) => vv,
            Result::Err(e) => return Result::Err(e),
        });
        let _ = input.try_parse(css::parse_important);
        Result::Ok(feature)
    }

    pub fn create_negation(condition: Box<StyleQuery>) -> StyleQuery {
        StyleQuery::Not(condition)
    }

    pub fn create_operation(operator: Operator, conditions: Vec<StyleQuery>) -> StyleQuery {
        StyleQuery::Operation { operator, conditions }
    }

    pub fn needs_parens(&self, parent_operator: Option<Operator>, _targets: &Targets) -> bool {
        match self {
            StyleQuery::Not(_) => true,
            StyleQuery::Operation { operator, .. } => Some(*operator) == parent_operator,
            StyleQuery::Feature(_) => true,
        }
    }

    pub fn parse_style_query(input: &mut Parser) -> Result<Self> {
        Result::Err(input.new_error_for_next_token())
    }

    pub fn deep_clone(&self) -> Self {
        // PERF(port): was css.implementDeepClone (comptime field-walk) — derive Clone covers it
        self.clone()
    }
}

#[derive(Clone)]
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
        // PERF(port): was ArrayListUnmanaged fed input.allocator() (parser arena); css is an AST crate —
        // Phase B decides bumpalo::collections::Vec<'bump, _> vs global Vec for the whole css crate.
        conditions: Vec<ContainerCondition>,
    },
    /// A style query.
    Style(StyleQuery),
}

impl ContainerCondition {
    pub fn parse(input: &mut Parser) -> Result<ContainerCondition> {
        media_query::parse_query_condition::<ContainerCondition>(
            input,
            QueryConditionFlags {
                allow_or: true,
                allow_style: true,
                ..QueryConditionFlags::default()
            },
        )
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            ContainerCondition::Feature(f) => f.to_css(dest),
            ContainerCondition::Not(c) => {
                dest.write_str(b"not ")?;
                media_query::to_css_with_parens_if_needed(
                    &**c,
                    dest,
                    c.needs_parens(None, &dest.targets),
                )
            }
            ContainerCondition::Operation { operator, conditions } => {
                media_query::operation_to_css::<ContainerCondition>(*operator, conditions, dest)
            }
            ContainerCondition::Style(query) => {
                dest.write_str(b"style(")?;
                query.to_css(dest)?;
                dest.write_char(b')')
            }
        }
    }

    pub fn parse_feature(input: &mut Parser) -> Result<ContainerCondition> {
        let feature = match QueryFeature::<ContainerSizeFeatureId>::parse(input) {
            Result::Ok(vv) => vv,
            Result::Err(e) => return Result::Err(e),
        };
        Result::Ok(ContainerCondition::Feature(feature))
    }

    pub fn create_negation(condition: Box<ContainerCondition>) -> ContainerCondition {
        ContainerCondition::Not(condition)
    }

    pub fn create_operation(operator: Operator, conditions: Vec<ContainerCondition>) -> ContainerCondition {
        ContainerCondition::Operation { operator, conditions }
    }

    pub fn parse_style_query(input: &mut Parser) -> Result<ContainerCondition> {
        // Zig defined a local `Fns` struct with two callbacks; in Rust we pass closures.
        fn adapted_parse_query_condition(i: &mut Parser, flags: QueryConditionFlags) -> Result<StyleQuery> {
            media_query::parse_query_condition::<StyleQuery>(i, flags)
        }

        fn parse_nested_block_fn(_: (), i: &mut Parser) -> Result<ContainerCondition> {
            if let Some(res) = i
                .try_parse(|i| {
                    adapted_parse_query_condition(
                        i,
                        QueryConditionFlags {
                            allow_or: true,
                            ..QueryConditionFlags::default()
                        },
                    )
                })
                .as_value()
            {
                return Result::Ok(ContainerCondition::Style(res));
            }

            Result::Ok(ContainerCondition::Style(match StyleQuery::parse_feature(i) {
                Result::Ok(vv) => vv,
                Result::Err(e) => return Result::Err(e),
            }))
        }

        input.parse_nested_block::<ContainerCondition, ()>((), parse_nested_block_fn)
    }

    pub fn needs_parens(&self, parent_operator: Option<Operator>, targets: &Targets) -> bool {
        match self {
            ContainerCondition::Not(_) => true,
            ContainerCondition::Operation { operator, .. } => Some(*operator) == parent_operator,
            ContainerCondition::Feature(f) => f.needs_parens(parent_operator, targets),
            ContainerCondition::Style(_) => false,
        }
    }

    pub fn deep_clone(&self) -> Self {
        // PERF(port): was css.implementDeepClone (comptime field-walk) — derive Clone covers it
        self.clone()
    }
}

/// A [@container](https://drafts.csswg.org/css-contain-3/#container-rule) rule.
#[derive(Clone)]
pub struct ContainerRule<R> {
    /// The name of the container.
    pub name: Option<ContainerName>,
    /// The container condition.
    pub condition: ContainerCondition,
    /// The rules within the `@container` rule.
    pub rules: css::CssRuleList<R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<R> ContainerRule<R> {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str(b"@container ")?;
        if let Some(name) = &self.name {
            name.to_css(dest)?;
            dest.write_char(b' ')?;
        }

        // Don't downlevel range syntax in container queries.
        let exclude = dest.targets.exclude;
        // Zig: bun.bits.insert(css.targets.Features, &dest.targets.exclude, .media_queries);
        dest.targets.exclude.insert(Features::MEDIA_QUERIES);
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

    pub fn deep_clone(&self) -> Self
    where
        R: Clone,
    {
        // PERF(port): was css.implementDeepClone (comptime field-walk) — derive Clone covers it
        self.clone()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/container.zig (350 lines)
//   confidence: medium
//   todos:      3
//   notes:      css::Result treated as enum w/ Ok/Err arms; Vec<T> kept over bumpalo Vec (PERF-tagged) — Phase B picks arena vs global for whole css crate (TSV uses Box<T> for `not`); enum_property_util/DeriveValueType comptime reflection inlined or proxied — Phase B must wire trait bounds.
// ──────────────────────────────────────────────────────────────────────────
