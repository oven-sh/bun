use crate as css;
use crate::css_rules::{CssRuleList, Location, MinifyContext};
use crate::error::MinifyErr;
use crate::properties::PropertyId;
use crate::{PrintErr, Printer};

/// A [`<supports-condition>`](https://drafts.csswg.org/css-conditional-3/#typedef-supports-condition),
/// as used in the `@supports` and `@import` rules.
// PORT NOTE: Zig threaded the parser-input lifetime (`[]const u8` slices borrow
// the source). Phase A keeps `&'static [u8]` per PORTING.md §AST crates; Phase
// B re-threads `'i` once `PropertyId<'i>` and the parser arena are real.
pub enum SupportsCondition {
    /// A `not` expression.
    Not(Box<SupportsCondition>),

    /// An `and` expression.
    And(Vec<SupportsCondition>),

    /// An `or` expression.
    Or(Vec<SupportsCondition>),

    /// A declaration to evaluate.
    Declaration(Declaration),

    /// A selector to evaluate.
    Selector(&'static [u8]),

    /// An unknown condition.
    Unknown(&'static [u8]),
}

// PORT NOTE: Zig used an anonymous inline struct for the `.declaration` payload;
// hoisted to a named type because Rust enum variants cannot carry inherent methods.
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
    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` field-walk. `PropertyId` is `Copy`;
        // `value: &'static [u8]` is an arena-owned slice → identity copy
        // (generics.zig "const strings" rule).
        Self {
            property_id: self.property_id,
            value: self.value,
        }
    }
}

impl Declaration {
    pub fn eql(&self, other: &Self) -> bool {
        // PORT NOTE: Zig `css.implementEql` field-walk, hand-expanded.
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
        // PORT NOTE: `css.implementDeepClone` variant-walk (hand-rolled —
        // `#[derive(DeepClone)]` can't be used while `Selector`/`Unknown`
        // carry `&'static [u8]`; the blanket `&'bump [u8]` impl doesn't unify
        // with a fresh `'__bump`).
        match self {
            Self::Not(c) => Self::Not(Box::new(c.deep_clone(bump))),
            Self::And(v) => Self::And(v.iter().map(|c| c.deep_clone(bump)).collect()),
            Self::Or(v) => Self::Or(v.iter().map(|c| c.deep_clone(bump)).collect()),
            Self::Declaration(d) => Self::Declaration(d.deep_clone(bump)),
            Self::Selector(s) => Self::Selector(s),
            Self::Unknown(s) => Self::Unknown(s),
        }
    }
}

impl SupportsCondition {
    // blocked_on: generics::CssHash for PropertyId — `#[derive(CssHash)]` /
    // `implement_hash` need every field type to provide `.hash(&mut Wyhash)`.
    // `PropertyId` only impls `core::hash::Hash` today. Phase B: add
    // `impl CssHash for PropertyId` then swap to `#[derive(CssHash)]`.

    pub fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        // PORT NOTE: Zig `css.implementHash` variant-walk, hand-expanded because
        // `#[derive(CssHash)]` would require `PropertyId: CssHash` (it only
        // provides `core::hash::Hash`). Semantics match the Zig reflection:
        // hash the discriminant, then field-wise structural hash.
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
        // PORT NOTE: Zig `css.implementEql` variant-walk, hand-expanded because
        // `#[derive(CssEql)]` would require `PropertyId: CssEql` (it only
        // provides the custom tag+prefix `PartialEq`). Semantics match the Zig
        // reflection: tag mismatch → false, then field-wise structural eq.
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
    // PORT NOTE: `pub fn deinit` dropped — body only freed Box/Vec payloads which Rust
    // drops automatically. Input-slice variants (`Declaration`/`Selector`/`Unknown`)
    // were no-ops in Zig as well (arena/input-owned).

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
                dest.write_str(sel)?;
                dest.write_char(b')')?;
            }
            SupportsCondition::Unknown(unk) => {
                dest.write_str(unk)?;
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
        // PORT NOTE: `inline for (css.VendorPrefix.FIELDS) |field| { if @field(prefix, field) ... }`
        // iterates the packed-struct bool fields at comptime. VendorPrefix ports to
        // bitflags!; iterate the ordered single-bit table directly (same pattern as
        // rules/style.rs). The Zig also builds `var p = VendorPrefix{}; @field(p, field) = true;`
        // but never reads it — dead store dropped.
        dest.write_separated(
            css::VendorPrefix::FIELDS
                .iter()
                .copied()
                .filter(|f| prefix.contains(*f)),
            |d| d.write_str(b") or ("),
            |d, _flag| {
                d.serialize_name(name)?;
                d.delim(b':', false)?;
                d.write_str(value)
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
            return Ok(SupportsCondition::Not(Box::new(in_parens)));
        }

        let in_parens: SupportsCondition = SupportsCondition::parse_in_parens(input)?;
        let mut expected_type: Option<i32> = None;
        // PERF(port): was arena-backed ArrayListUnmanaged — profile in Phase B
        let mut conditions: Vec<SupportsCondition> = Vec::new();
        // PORT NOTE: Zig used std.ArrayHashMap with an inline custom hash/eql context;
        // SeenDeclKey below carries equivalent Hash/Eq impls.
        let mut seen_declarations: ArrayHashMap<SeenDeclKey, usize> = ArrayHashMap::new();

        loop {
            // PORT NOTE: reshaped for borrowck — Zig threaded `*?i32` through a
            // local `Closure` struct (LIFETIMES.tsv: BORROW_PARAM); a Rust closure
            // capturing `&mut expected_type` is the direct equivalent.
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
                        // PERF(port): was arena alloc via input.arena() — profile in Phase B
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
                let res =
                    input.try_parse(|i| i.parse_nested_block(|i2| SupportsCondition::parse(i2)));
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

// PORT NOTE: Zig `SeenDeclKey` was a tuple struct with an inline hash-map context
// providing custom hash/eql. Ported as a tuple struct with manual Hash/PartialEq
// matching the Zig context exactly (wrapping_add of string hash and enum int).
struct SeenDeclKey(PropertyId, &'static [u8]);

impl core::hash::Hash for SeenDeclKey {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        // TODO(port): Zig used std.array_hash_map.hashString (wyhash, 32-bit) +% @intFromEnum.
        // bun_collections::ArrayHashMap is wyhash-backed; confirm hasher parity in Phase B.
        // PORT NOTE: hash_string returns u32 directly (mirrors Zig hashString) — no narrowing cast.
        let h: u32 = bun_collections::array_hash_map::hash_string(self.1);
        state.write_u32(h.wrapping_add(self.0.tag() as u32));
    }
}

impl PartialEq for SeenDeclKey {
    fn eq(&self, other: &Self) -> bool {
        // Zig: tag-only equality + slice byte equality.
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
    ) -> core::result::Result<(), MinifyErr> {
        let _ = self;
        let _ = context;
        let _ = parent_is_unused;
        // TODO: Implement this
        Ok(())
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
        // PORT NOTE: `css.implementDeepClone` field-walk.
        Self {
            condition: self.condition.deep_clone(bump),
            rules: self.rules.deep_clone(bump),
            loc: self.loc,
        }
    }
}

// ported from: src/css/rules/supports.zig
