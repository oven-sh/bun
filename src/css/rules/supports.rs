use crate as css;
use crate::css_rules::{CssRuleList, Location, MinifyContext};
use crate::error::MinifyErr;
use crate::properties::PropertyId;
use crate::{PrintErr, Printer};
use bun_alloc::ArenaPtr;

/// A [`<supports-condition>`](https://drafts.csswg.org/css-conditional-3/#typedef-supports-condition),
/// as used in the `@supports` and `@import` rules.
// String payloads borrow the parser input/arena; currently `&'static [u8]`
// per the rules/mod.rs lifetime-erasure note.
// TODO(refactor): re-thread `'i` once `PropertyId<'i>` and the parser arena are real.
pub enum SupportsCondition {
    /// A `not` expression.
    Not(Box<SupportsCondition, ArenaPtr>),

    /// An `and` expression.
    And(Vec<SupportsCondition, ArenaPtr>),

    /// An `or` expression.
    Or(Vec<SupportsCondition, ArenaPtr>),

    /// A declaration to evaluate.
    Declaration(Declaration),

    /// A selector to evaluate.
    Selector(&'static [u8]),

    /// An unknown condition.
    Unknown(&'static [u8]),
}

// Named payload type for `SupportsCondition::Declaration` (enum variants
// cannot carry inherent methods).
pub struct Declaration {
    /// The property id for the declaration.
    pub property_id: PropertyId,
    /// The raw value of the declaration.
    ///
    /// What happens if the value is a URL? A URL in this context does nothing
    /// e.g. `@supports (background-image: url('example.png'))`
    pub value: &'static [u8],
}

impl Declaration {
    pub(crate) fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // `PropertyId` is `Copy`; `value` is an arena-owned slice → identity copy.
        Self {
            property_id: self.property_id,
            value: self.value,
        }
    }
}

impl Declaration {
    pub(crate) fn eql(&self, other: &Self) -> bool {
        // `PropertyId` carries its own tag+prefix `PartialEq` (see
        // properties_generated.rs `impl PartialEq for PropertyId`); `value` is
        // byte-slice equality.
        self.property_id == other.property_id && self.value == other.value
    }
}

impl SupportsCondition {
    pub fn clone_with_import_records(
        &self,
        bump: &bun_alloc::Arena,
        _: &mut Vec<bun_ast::ImportRecord>,
    ) -> Self {
        self.deep_clone(bump)
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> SupportsCondition {
        // Hand-rolled variant-walk —
        // `#[derive(DeepClone)]` can't be used while `Selector`/`Unknown`
        // carry `&'static [u8]`; the blanket `&'bump [u8]` impl doesn't unify
        // with a fresh `'__bump`).
        let alloc = ArenaPtr::new(bump);
        match self {
            Self::Not(c) => Self::Not(Box::new_in(c.deep_clone(bump), alloc)),
            Self::And(v) => Self::And(Self::clone_vec_in(v, bump, alloc)),
            Self::Or(v) => Self::Or(Self::clone_vec_in(v, bump, alloc)),
            Self::Declaration(d) => Self::Declaration(d.deep_clone(bump)),
            Self::Selector(s) => Self::Selector(s),
            Self::Unknown(s) => Self::Unknown(s),
        }
    }

    fn clone_vec_in(
        v: &[SupportsCondition],
        bump: &bun_alloc::Arena,
        alloc: ArenaPtr,
    ) -> Vec<SupportsCondition, ArenaPtr> {
        let mut out = Vec::with_capacity_in(v.len(), alloc);
        out.extend(v.iter().map(|c| c.deep_clone(bump)));
        out
    }
}

impl SupportsCondition {
    pub fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        // Hand-expanded because `#[derive(CssHash)]` would require
        // `PropertyId: CssHash` (it only provides `core::hash::Hash`).
        // Hash the discriminant, then field-wise structural hash.
        use core::hash::{Hash, Hasher};
        core::mem::discriminant(self).hash(hasher);
        match self {
            Self::Not(c) => c.hash(hasher),
            Self::And(v) | Self::Or(v) => {
                hasher.write_usize(v.len());
                for c in v.iter() {
                    c.hash(hasher);
                }
            }
            Self::Declaration(d) => {
                d.property_id.hash(hasher);
                hasher.write(d.value);
            }
            Self::Selector(s) | Self::Unknown(s) => hasher.write(s),
        }
    }

    pub fn eql(&self, other: &SupportsCondition) -> bool {
        // Hand-expanded because `#[derive(CssEql)]` would require
        // `PropertyId: CssEql` (it only provides the custom tag+prefix
        // `PartialEq`). Tag mismatch → false, then field-wise structural eq.
        match (self, other) {
            (Self::Not(a), Self::Not(b)) => a.eql(b),
            (Self::And(a), Self::And(b)) | (Self::Or(a), Self::Or(b)) => {
                a.len() == b.len() && a.iter().zip(b.iter()).all(|(l, r)| l.eql(r))
            }
            (Self::Declaration(a), Self::Declaration(b)) => a.eql(b),
            (Self::Selector(a), Self::Selector(b)) => *a == *b,
            (Self::Unknown(a), Self::Unknown(b)) => *a == *b,
            _ => false,
        }
    }
}

impl crate::generics::CssEql for SupportsCondition {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        SupportsCondition::eql(self, other)
    }
}

impl SupportsCondition {
    fn needs_parens(&self, parent: &SupportsCondition) -> bool {
        match self {
            SupportsCondition::Not(_) => true,
            SupportsCondition::And(_) => !matches!(parent, SupportsCondition::And(_)),
            SupportsCondition::Or(_) => !matches!(parent, SupportsCondition::Or(_)),
            _ => false,
        }
    }

    pub fn to_css_with_parens_if_needed(
        &self,
        dest: &mut Printer,
        needs_parens: bool,
    ) -> core::result::Result<(), PrintErr> {
        if needs_parens {
            dest.write_str(b"(")?;
        }
        self.to_css(dest)?;
        if needs_parens {
            dest.write_str(b")")?;
        }
        Ok(())
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            SupportsCondition::Not(condition) => {
                dest.write_str(b" not ")?;
                condition.to_css_with_parens_if_needed(dest, condition.needs_parens(self))?;
            }
            SupportsCondition::And(conditions) => {
                dest.write_separated(
                    conditions.iter(),
                    |d| d.write_str(b" and "),
                    |d, cond| cond.to_css_with_parens_if_needed(d, cond.needs_parens(self)),
                )?;
            }
            SupportsCondition::Or(conditions) => {
                dest.write_separated(
                    conditions.iter(),
                    |d| d.write_str(b" or "),
                    |d, cond| cond.to_css_with_parens_if_needed(d, cond.needs_parens(self)),
                )?;
            }
            SupportsCondition::Declaration(decl) => {
                Self::declaration_to_css(decl, dest)?;
            }
            SupportsCondition::Selector(sel) => {
                dest.write_str(b"selector(")?;
                // Raw parser-input slice: may span newlines. `write_bytes`
                // tracks line/col across them; `write_str` would assert.
                dest.write_bytes(sel)?;
                dest.write_char(b')')?;
            }
            SupportsCondition::Unknown(unk) => {
                // Raw parser-input slice (see above).
                dest.write_bytes(unk)?;
            }
        }
        Ok(())
    }

    fn declaration_to_css(
        decl: &Declaration,
        dest: &mut Printer,
    ) -> core::result::Result<(), PrintErr> {
        let property_id = &decl.property_id;
        let value = decl.value;

        dest.write_char(b'(')?;

        let prefix: css::VendorPrefix = property_id.prefix().or_none();
        if prefix != css::VendorPrefix::NONE {
            dest.write_char(b'(')?;
        }

        let name = property_id.name();
        // Iterate the ordered single-bit VendorPrefix table directly (same
        // pattern as rules/style.rs).
        dest.write_separated(
            css::VendorPrefix::FIELDS
                .iter()
                .copied()
                .filter(|f| prefix.contains(*f)),
            |d| d.write_str(b") or ("),
            |d, _flag| {
                d.serialize_name(name)?;
                d.delim(b':', false)?;
                // Raw parser-input slice: may span newlines.
                d.write_bytes(value)
            },
        )?;

        if prefix != css::VendorPrefix::NONE {
            dest.write_char(b')')?;
        }
        dest.write_char(b')')?;
        Ok(())
    }
}

impl css::generic::ToCss for SupportsCondition {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        SupportsCondition::to_css(self, dest)
    }
}

// ─── parse bodies ─────────────────────────────────────────────────────────
impl SupportsCondition {
    pub fn parse(input: &mut css::Parser) -> css::Result<SupportsCondition> {
        use bun_collections::ArrayHashMap;

        if input.try_parse(|i| i.expect_ident_matching(b"not")).is_ok() {
            let in_parens = SupportsCondition::parse_in_parens(input)?;
            return Ok(SupportsCondition::Not(Box::new_in(
                in_parens,
                ArenaPtr::new(input.arena()),
            )));
        }

        let in_parens: SupportsCondition = SupportsCondition::parse_in_parens(input)?;
        let mut expected_type: Option<i32> = None;
        let mut conditions: Vec<SupportsCondition, ArenaPtr> =
            Vec::new_in(ArenaPtr::new(input.arena()));
        // `SeenDeclKey` below carries the custom Hash/Eq impls for this map.
        let mut seen_declarations: ArrayHashMap<SeenDeclKey, usize> = ArrayHashMap::new();

        loop {
            // A closure capturing `&mut expected_type` threads the expected
            // type through the parse attempt.
            let _condition =
                input.try_parse(|i: &mut css::Parser| -> css::Result<SupportsCondition> {
                    let location = i.current_source_location();
                    let s = i.expect_ident_cloned()?;
                    let found_type: i32 = crate::match_ignore_ascii_case! { s, {
                        b"and" => 1,
                        b"or" => 2,
                        _ => return Err(location.new_unexpected_token_error(css::Token::Ident(s))),
                    }};

                    if let Some(expected) = expected_type {
                        if found_type != expected {
                            return Err(location.new_unexpected_token_error(css::Token::Ident(s)));
                        }
                    } else {
                        expected_type = Some(found_type);
                    }

                    SupportsCondition::parse_in_parens(i)
                });

            match _condition {
                Ok(condition) => {
                    if conditions.is_empty() {
                        conditions.push(in_parens.deep_clone(input.arena()));
                        if let SupportsCondition::Declaration(decl) = &in_parens {
                            let property_id = &decl.property_id;
                            let value = decl.value;
                            let _ = seen_declarations.put(
                                SeenDeclKey(
                                    property_id.with_prefix(css::VendorPrefix::NONE),
                                    value,
                                ),
                                0,
                            );
                        }
                    }

                    if let SupportsCondition::Declaration(decl) = &condition {
                        // Merge multiple declarations with the same property id (minus prefix) and value together.
                        let property_id_ = &decl.property_id;
                        let value = decl.value;

                        let property_id = property_id_.with_prefix(css::VendorPrefix::NONE);
                        let key = SeenDeclKey(property_id, value);
                        if let Some(index) = seen_declarations.get(&key) {
                            let cond = &mut conditions[*index];
                            if let SupportsCondition::Declaration(d) = cond {
                                d.property_id.add_prefix(property_id.prefix());
                            }
                        } else {
                            let _ = seen_declarations.put(key, conditions.len());
                            conditions.push(SupportsCondition::Declaration(Declaration {
                                property_id,
                                value,
                            }));
                        }
                    } else {
                        conditions.push(condition);
                    }
                }
                Err(_) => break,
            }
        }

        if conditions.len() == 1 {
            let ret = conditions.pop().unwrap();
            return Ok(ret);
        }

        if expected_type == Some(1) {
            return Ok(SupportsCondition::And(conditions));
        }
        if expected_type == Some(2) {
            return Ok(SupportsCondition::Or(conditions));
        }
        Ok(in_parens)
    }

    pub fn parse_declaration(input: &mut css::Parser) -> css::Result<SupportsCondition> {
        let property_id = PropertyId::parse(input)?;
        input.expect_colon()?;
        input.skip_whitespace();
        let pos = input.position();
        input.expect_no_error_token()?;
        let value = input.slice_from_cloned(pos);
        Ok(SupportsCondition::Declaration(Declaration {
            property_id,
            value,
        }))
    }

    fn parse_in_parens(input: &mut css::Parser) -> css::Result<SupportsCondition> {
        use bun_core::strings;
        input.skip_whitespace();
        let location = input.current_source_location();
        let pos = input.position();
        let tok = input.next()?.clone();
        match tok {
            css::Token::Function(f) => {
                if strings::eql_case_insensitive_ascii_check_length(b"selector", f) {
                    let res = input.try_parse(|i| {
                        i.parse_nested_block(|i2| {
                            let p = i2.position();
                            i2.expect_no_error_token()?;
                            let s = i2.slice_from_cloned(p);
                            Ok(SupportsCondition::Selector(s))
                        })
                    });
                    if res.is_ok() {
                        return res;
                    }
                }
            }
            css::Token::OpenParen => {
                let res = input.try_parse(|i| i.parse_nested_block(SupportsCondition::parse));
                if res.is_ok() {
                    return res;
                }
            }
            _ => return Err(location.new_unexpected_token_error(tok)),
        }

        input.parse_nested_block(|i| i.expect_no_error_token())?;

        let s = input.slice_from_cloned(pos);
        Ok(SupportsCondition::Unknown(s))
    }
}

// Dedup key for `@supports` declaration conditions; manual Hash/PartialEq
// (wrapping_add of string hash and enum int).
struct SeenDeclKey(PropertyId, &'static [u8]);

impl core::hash::Hash for SeenDeclKey {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        // wyhash of the value bytes +% the property-id tag.
        // `hash_string` returns u32 directly — no narrowing cast.
        let h: u32 = bun_collections::array_hash_map::hash_string(self.1);
        state.write_u32(h.wrapping_add(self.0.tag() as u32));
    }
}

impl PartialEq for SeenDeclKey {
    fn eq(&self, other: &Self) -> bool {
        // Tag-only equality + slice byte equality.
        self.0.tag() as u16 == other.0.tag() as u16 && self.1 == other.1
    }
}
impl Eq for SeenDeclKey {}

/// A [@supports](https://drafts.csswg.org/css-conditional-3/#at-supports) rule.
pub struct SupportsRule<R> {
    /// The supports condition.
    pub condition: SupportsCondition,
    /// The rules within the `@supports` rule.
    pub rules: CssRuleList<R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<R> SupportsRule<R> {
    pub fn minify(
        &mut self,
        context: &mut MinifyContext,
        parent_is_unused: bool,
    ) -> core::result::Result<(), MinifyErr>
    where
        R: for<'b> crate::generics::DeepClone<'b>,
    {
        // The condition-merge/dedup port is still pending, but the nested rules
        // must be minified so compiling nesting away for the targets stays
        // bounded by `MAX_SELECTOR_EXPANSION`. `@supports` preserves the `&`
        // resolution context at print time (`to_css` below recurses into
        // `self.rules` without clearing `dest.ctx`), so style rules nested
        // behind it multiply against the enclosing nesting levels exactly like
        // plain nested rules — leaving them unvisited here lets the printer
        // expand them exponentially.
        self.rules.minify(context, parent_is_unused)
    }
}

impl<R> SupportsRule<R> {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str(b"@supports ")?;
        self.condition.to_css(dest)?;
        dest.block(|d| {
            d.newline()?;
            self.rules.to_css(d)
        })
    }
}

impl<R> SupportsRule<R> {
    pub fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        R: css::generics::DeepClone<'bump>,
    {
        Self {
            condition: self.condition.deep_clone(bump),
            rules: self.rules.deep_clone(bump),
            loc: self.loc,
        }
    }
}
