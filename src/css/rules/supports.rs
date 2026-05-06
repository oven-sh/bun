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

// blocked_on: generics::{CssEql,CssHash,DeepClone} impls for SupportsCondition/
// Declaration. Zig's `css.implement*` helpers were @typeInfo reflection; the
// Rust port requires per-type trait impls (or a derive macro). Phase B: derive.
#[cfg(any())]
impl Declaration {
    pub fn eql(&self, other: &Self) -> bool {
        // TODO(port): css.implementEql is comptime-reflection equality — replace with #[derive(PartialEq)] in Phase B
        css::implement_eql(self, other)
    }

    pub fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone is comptime-reflection clone — replace with derive/trait in Phase B
        css::implement_deep_clone(self, bump)
    }
}

#[cfg(any())]
impl SupportsCondition {
    pub fn clone_with_import_records(
        &self,
        bump: &bun_alloc::Arena,
        _: &mut bun_collections::BabyList<bun_options_types::ImportRecord>,
    ) -> Self {
        self.deep_clone(bump)
    }

    pub fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        // TODO(port): css.implementHash is comptime-reflection — replace with #[derive(Hash)] in Phase B
        css::implement_hash(self, hasher)
    }

    pub fn eql(&self, other: &SupportsCondition) -> bool {
        // TODO(port): css.implementEql is comptime-reflection — replace with #[derive(PartialEq)] in Phase B
        css::implement_eql(self, other)
    }

    pub fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> SupportsCondition {
        // TODO(port): css.implementDeepClone is comptime-reflection — replace with derive/trait in Phase B
        css::implement_deep_clone(self, bump)
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

    // blocked_on: properties::PropertyId::{prefix,name,with_prefix,add_prefix} —
    // PropertyId is the data-only `()` stub until properties_generated.rs un-gates.
    #[cfg(any())]
    fn declaration_to_css(decl: &Declaration, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
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
        Ok(())
    }
    #[cfg(not(any()))]
    fn declaration_to_css(_decl: &Declaration, _dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // unreachable until properties_generated un-gates and the parse() body
        // below starts producing Declaration variants.
        todo!("bun_css::SupportsCondition::Declaration::to_css — gated on properties::PropertyId un-gate")
    }
}

// ─── parse bodies ─────────────────────────────────────────────────────────
// blocked_on: css_parser::Parser::{try_parse,expect_ident,expect_ident_matching,
// expect_colon,expect_no_error_token,skip_whitespace,position,slice_from,next,
// parse_nested_block,allocator,current_source_location} signatures and
// PropertyId::{parse,with_prefix,prefix,add_prefix}. The grammar body below is
// the full port of supports.zig:73-244 and re-lands when those siblings un-gate.
#[cfg(any())]
impl SupportsCondition {
    pub fn parse<'i>(input: &mut css::Parser<'i, '_>) -> css::Result<SupportsCondition> {
        use bun_collections::ArrayHashMap;
        use bun_string::strings;

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
        let mut conditions: Vec<SupportsCondition> = Vec::new();
        // PORT NOTE: Zig used std.ArrayHashMap with an inline custom hash/eql context;
        // SeenDeclKey below carries equivalent Hash/Eq impls.
        let mut seen_declarations: ArrayHashMap<SeenDeclKey, usize> = ArrayHashMap::new();

        loop {
            // PORT NOTE: reshaped for borrowck — Zig threaded `*?i32` through a
            // local `Closure` struct (LIFETIMES.tsv: BORROW_PARAM); a Rust closure
            // capturing `&mut expected_type` is the direct equivalent.
            let _condition = input.try_parse(|i: &mut css::Parser<'i, '_>| -> css::Result<SupportsCondition> {
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

    pub fn parse_declaration<'i>(input: &mut css::Parser<'i, '_>) -> css::Result<SupportsCondition> {
        let property_id = match PropertyId::parse(input) {
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

    fn parse_in_parens<'i>(input: &mut css::Parser<'i, '_>) -> css::Result<SupportsCondition> {
        use bun_string::strings;
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
                    ) -> css::Result<SupportsCondition> {
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
}

// PORT NOTE: Zig `SeenDeclKey` was a tuple struct with an inline hash-map context
// providing custom hash/eql. Ported as a tuple struct with manual Hash/PartialEq
// matching the Zig context exactly (wrapping_add of string hash and enum int).
#[cfg(any())]
struct SeenDeclKey(PropertyId, &'static [u8]);

#[cfg(any())]
impl core::hash::Hash for SeenDeclKey {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        // TODO(port): Zig used std.array_hash_map.hashString (wyhash, 32-bit) +% @intFromEnum.
        // bun_collections::ArrayHashMap is wyhash-backed; confirm hasher parity in Phase B.
        // PORT NOTE: hash_string returns u32 directly (mirrors Zig hashString) — no narrowing cast.
        let h: u32 = bun_collections::array_hash_map::hash_string(self.1);
        state.write_u32(h.wrapping_add(self.0 as u32));
    }
}

#[cfg(any())]
impl PartialEq for SeenDeclKey {
    fn eq(&self, other: &Self) -> bool {
        (self.0 as u32) == (other.0 as u32) && self.1 == other.1
    }
}
#[cfg(any())]
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
}

// blocked_on: generics::DeepClone derive for SupportsRule<R> (Phase B).
#[cfg(any())]
impl<R> SupportsRule<R> {
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone is comptime-reflection — replace with derive/trait in Phase B
        css::implement_deep_clone(self, bump)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/supports.zig (419 lines)
//   confidence: medium
//   todos:      9
//   notes:      data types un-gated; SupportsCondition::to_css real (Declaration arm gated on PropertyId methods); parse/parse_declaration/parse_in_parens + SeenDeclKey gated on Parser API surface + PropertyId; SupportsRule::to_css/deep_clone gated on CssRuleList::to_css; 'i lifetime dropped until PropertyId<'i> threads
// ──────────────────────────────────────────────────────────────────────────
