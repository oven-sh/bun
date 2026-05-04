use crate as css;
use crate::css_rules::Location;
use crate::{PrintErr, Printer, Result};

use bun_collections::{ArrayHashMap, BabyList};
use bun_options_types::ImportRecord;
use bun_str::strings;

/// A [`<supports-condition>`](https://drafts.csswg.org/css-conditional-3/#typedef-supports-condition),
/// as used in the `@supports` and `@import` rules.
pub enum SupportsCondition<'i> {
    /// A `not` expression.
    Not(Box<SupportsCondition<'i>>),

    /// An `and` expression.
    And(Vec<SupportsCondition<'i>>),

    /// An `or` expression.
    Or(Vec<SupportsCondition<'i>>),

    /// A declaration to evaluate.
    Declaration(Declaration<'i>),

    /// A selector to evaluate.
    Selector(&'i [u8]),

    /// An unknown condition.
    Unknown(&'i [u8]),
}

// PORT NOTE: Zig used an anonymous inline struct for the `.declaration` payload;
// hoisted to a named type because Rust enum variants cannot carry inherent methods.
pub struct Declaration<'i> {
    /// The property id for the declaration.
    pub property_id: css::PropertyId<'i>,
    /// The raw value of the declaration.
    ///
    /// What happens if the value is a URL? A URL in this context does nothing
    /// e.g. `@supports (background-image: url('example.png'))`
    pub value: &'i [u8],
}

impl<'i> Declaration<'i> {
    pub fn eql(&self, other: &Self) -> bool {
        // TODO(port): css.implementEql is comptime-reflection equality — replace with #[derive(PartialEq)] in Phase B
        css::implement_eql(self, other)
    }

    pub fn deep_clone(&self, bump: &'i bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone is comptime-reflection clone — replace with derive/trait in Phase B
        css::implement_deep_clone(self, bump)
    }
}

impl<'i> SupportsCondition<'i> {
    // PORT NOTE: `pub fn deinit` dropped — body only freed Box/Vec payloads which Rust
    // drops automatically. Input-slice variants (`Declaration`/`Selector`/`Unknown`)
    // were no-ops in Zig as well (arena/input-owned).

    pub fn clone_with_import_records(
        &self,
        bump: &'i bun_alloc::Arena,
        _: &mut BabyList<ImportRecord>,
    ) -> Self {
        self.deep_clone(bump)
    }

    pub fn hash(&self, hasher: &mut impl core::hash::Hasher) {
        // TODO(port): css.implementHash is comptime-reflection — replace with #[derive(Hash)] in Phase B
        css::implement_hash(self, hasher)
    }

    pub fn eql(&self, other: &SupportsCondition<'i>) -> bool {
        // TODO(port): css.implementEql is comptime-reflection — replace with #[derive(PartialEq)] in Phase B
        css::implement_eql(self, other)
    }

    pub fn deep_clone(&self, bump: &'i bun_alloc::Arena) -> SupportsCondition<'i> {
        // TODO(port): css.implementDeepClone is comptime-reflection — replace with derive/trait in Phase B
        css::implement_deep_clone(self, bump)
    }

    fn needs_parens(&self, parent: &SupportsCondition<'i>) -> bool {
        match self {
            SupportsCondition::Not(_) => true,
            SupportsCondition::And(_) => !matches!(parent, SupportsCondition::And(_)),
            SupportsCondition::Or(_) => !matches!(parent, SupportsCondition::Or(_)),
            _ => false,
        }
    }

    pub fn parse(input: &mut css::Parser<'i, '_>) -> Result<SupportsCondition<'i>> {
        if input
            .try_parse(|i| i.expect_ident_matching(b"not"))
            .is_ok()
        {
            let in_parens = match SupportsCondition::parse_in_parens(input) {
                Ok(vv) => vv,
                Err(e) => return Err(e),
            };
            return Ok(SupportsCondition::Not(Box::new(in_parens)));
        }

        let in_parens: SupportsCondition = match SupportsCondition::parse_in_parens(input) {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        };
        let mut expected_type: Option<i32> = None;
        // PERF(port): was arena-backed ArrayListUnmanaged — profile in Phase B
        let mut conditions: Vec<SupportsCondition<'i>> = Vec::new();
        // PORT NOTE: Zig used std.ArrayHashMap with an inline custom hash/eql context;
        // SeenDeclKey below carries equivalent Hash/Eq impls.
        let mut seen_declarations: ArrayHashMap<SeenDeclKey<'i>, usize> = ArrayHashMap::new();

        loop {
            // PORT NOTE: reshaped for borrowck — Zig threaded `*?i32` through a
            // local `Closure` struct (LIFETIMES.tsv: BORROW_PARAM); a Rust closure
            // capturing `&mut expected_type` is the direct equivalent.
            let _condition = input.try_parse(|i: &mut css::Parser<'i, '_>| -> Result<SupportsCondition<'i>> {
                let location = i.current_source_location();
                let s = match i.expect_ident() {
                    Ok(vv) => vv,
                    Err(e) => return Err(e),
                };
                let found_type: i32 = 'found_type: {
                    // todo_stuff.match_ignore_ascii_case
                    if strings::eql_case_insensitive_ascii_check_length(b"and", s) {
                        break 'found_type 1;
                    }
                    if strings::eql_case_insensitive_ascii_check_length(b"or", s) {
                        break 'found_type 2;
                    }
                    return Err(location.new_unexpected_token_error(css::Token::Ident(s)));
                };

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
                        // PERF(port): was arena alloc via input.allocator() — profile in Phase B
                        conditions.push(in_parens.deep_clone(input.allocator()));
                        if let SupportsCondition::Declaration(decl) = &in_parens {
                            let property_id = &decl.property_id;
                            let value = decl.value;
                            seen_declarations.put(
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
                            seen_declarations.put(key, conditions.len());
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

    pub fn parse_declaration(input: &mut css::Parser<'i, '_>) -> Result<SupportsCondition<'i>> {
        let property_id = match css::PropertyId::parse(input) {
            Ok(v) => v,
            Err(e) => return Err(e),
        };
        if let Some(e) = input.expect_colon().err() {
            return Err(e);
        }
        input.skip_whitespace();
        let pos = input.position();
        if let Some(e) = input.expect_no_error_token().err() {
            return Err(e);
        }
        Ok(SupportsCondition::Declaration(Declaration {
            property_id,
            value: input.slice_from(pos),
        }))
    }

    fn parse_in_parens(input: &mut css::Parser<'i, '_>) -> Result<SupportsCondition<'i>> {
        input.skip_whitespace();
        let location = input.current_source_location();
        let pos = input.position();
        let tok = match input.next() {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        };
        match *tok {
            css::Token::Function(f) => {
                if strings::eql_case_insensitive_ascii_check_length(b"selector", f) {
                    fn parse_nested_block_fn<'i>(
                        _: (),
                        i: &mut css::Parser<'i, '_>,
                    ) -> Result<SupportsCondition<'i>> {
                        let p = i.position();
                        if let Some(e) = i.expect_no_error_token().err() {
                            return Err(e);
                        }
                        Ok(SupportsCondition::Selector(i.slice_from(p)))
                    }
                    let res = input.try_parse(|i| {
                        i.parse_nested_block((), parse_nested_block_fn)
                    });
                    if res.is_ok() {
                        return res;
                    }
                }
            }
            css::Token::OpenParen => {
                let res = input.try_parse(|i: &mut css::Parser<'i, '_>| {
                    i.parse_nested_block((), |_: (), i| SupportsCondition::parse(i))
                });
                if res.is_ok() {
                    return res;
                }
            }
            _ => return Err(location.new_unexpected_token_error(*tok)),
        }

        if let Some(err) = input
            .parse_nested_block((), |_: (), i: &mut css::Parser<'i, '_>| {
                i.expect_no_error_token()
            })
            .err()
        {
            return Err(err);
        }

        Ok(SupportsCondition::Unknown(input.slice_from(pos)))
    }

    pub fn to_css(&self, dest: &mut css::Printer) -> core::result::Result<(), PrintErr> {
        match self {
            SupportsCondition::Not(condition) => {
                dest.write_str(b" not ")?;
                condition.to_css_with_parens_if_needed(dest, condition.needs_parens(self))?;
            }
            SupportsCondition::And(conditions) => {
                let mut first = true;
                for cond in conditions.iter() {
                    if first {
                        first = false;
                    } else {
                        dest.write_str(b" and ")?;
                    }
                    cond.to_css_with_parens_if_needed(dest, cond.needs_parens(self))?;
                }
            }
            SupportsCondition::Or(conditions) => {
                let mut first = true;
                for cond in conditions.iter() {
                    if first {
                        first = false;
                    } else {
                        dest.write_str(b" or ")?;
                    }
                    cond.to_css_with_parens_if_needed(dest, cond.needs_parens(self))?;
                }
            }
            SupportsCondition::Declaration(decl) => {
                let property_id = &decl.property_id;
                let value = decl.value;

                dest.write_char(b'(')?;

                let prefix: css::VendorPrefix = property_id.prefix().or_none();
                if prefix != css::VendorPrefix::NONE {
                    dest.write_char(b'(')?;
                }

                let name = property_id.name();
                let mut first = true;
                // TODO(port): `inline for (css.VendorPrefix.FIELDS) |field| { if @field(prefix, field) ... }`
                // iterates the packed-struct bool fields at comptime. VendorPrefix ports to
                // bitflags!; iterate the per-flag constants here. Phase B: confirm
                // css::VendorPrefix exposes a FIELDS/iter() that matches Zig field order.
                for &flag in css::VendorPrefix::FIELDS {
                    if prefix.contains(flag) {
                        if first {
                            first = false;
                        } else {
                            dest.write_str(b") or (")?;
                        }

                        let mut p = css::VendorPrefix::empty();
                        p |= flag;
                        // TODO(port): `p` is constructed but unused in the Zig source as well —
                        // likely intended to feed a prefixed-name serializer. Ported faithfully.
                        let _ = p;
                        css::serializer::serialize_name(name, dest)
                            .map_err(|_| dest.add_fmt_error())?;
                        dest.delim(b':', false)?;
                        dest.write_str(value)?;
                    }
                }

                if prefix != css::VendorPrefix::NONE {
                    dest.write_char(b')')?;
                }
                dest.write_char(b')')?;
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

    pub fn to_css_with_parens_if_needed(
        &self,
        dest: &mut css::Printer,
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
}

// PORT NOTE: Zig `SeenDeclKey` was a tuple struct with an inline hash-map context
// providing custom hash/eql. Ported as a tuple struct with manual Hash/PartialEq
// matching the Zig context exactly (wrapping_add of string hash and enum int).
struct SeenDeclKey<'i>(css::PropertyId<'i>, &'i [u8]);

impl<'i> core::hash::Hash for SeenDeclKey<'i> {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        // TODO(port): Zig used std.array_hash_map.hashString (wyhash, 32-bit) +% @intFromEnum.
        // bun_collections::ArrayHashMap is wyhash-backed; confirm hasher parity in Phase B.
        // PORT NOTE: hash_string returns u32 directly (mirrors Zig hashString) — no narrowing cast.
        let h: u32 = bun_collections::array_hash_map::hash_string(self.1);
        state.write_u32(h.wrapping_add(self.0 as u32));
    }
}

impl<'i> PartialEq for SeenDeclKey<'i> {
    fn eq(&self, other: &Self) -> bool {
        (self.0 as u32) == (other.0 as u32) && self.1 == other.1
    }
}
impl<'i> Eq for SeenDeclKey<'i> {}

/// A [@supports](https://drafts.csswg.org/css-conditional-3/#at-supports) rule.
pub struct SupportsRule<'i, R> {
    /// The supports condition.
    pub condition: SupportsCondition<'i>,
    /// The rules within the `@supports` rule.
    pub rules: css::CssRuleList<'i, R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<'i, R> SupportsRule<'i, R> {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str(b"@supports ")?;
        self.condition.to_css(dest)?;
        dest.whitespace()?;
        dest.write_char(b'{')?;
        dest.indent();
        dest.newline()?;
        self.rules.to_css(dest)?;
        dest.dedent();
        dest.newline()?;
        dest.write_char(b'}')?;
        Ok(())
    }

    pub fn minify(
        &mut self,
        context: &mut css::MinifyContext,
        parent_is_unused: bool,
    ) -> core::result::Result<(), css::MinifyErr> {
        let _ = self;
        let _ = context;
        let _ = parent_is_unused;
        // TODO: Implement this
        Ok(())
    }

    pub fn deep_clone(&self, bump: &'i bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone is comptime-reflection — replace with derive/trait in Phase B
        css::implement_deep_clone(self, bump)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/supports.zig (419 lines)
//   confidence: medium
//   todos:      9
//   notes:      'i lifetime threads input-slice borrows; css::implement_{eql,hash,deep_clone} are reflection helpers needing derive/trait in Phase B; VendorPrefix::FIELDS iteration needs bitflags iter; `p` in to_css is dead in Zig source too
// ──────────────────────────────────────────────────────────────────────────
