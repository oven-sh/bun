use core::fmt;
use core::hash::Hasher;

use bun_alloc::Arena as Bump;
use bun_collections::{ArrayHashMap, BabyList};
use bun_options_types::ImportRecord;
use bun_wyhash;

use crate as css;
use crate::css_rules::Location;
use crate::{CssRuleList, Parser, PrintErr, Printer, Result, SmallList};

/// Stored as a list of strings as dot notation can be used
/// to create sublayers
#[derive(Default)]
pub struct LayerName<'bump> {
    pub v: SmallList<&'bump [u8], 1>,
}

// Zig: `pub fn HashMap(comptime V: type) type { return std.ArrayHashMapUnmanaged(...) }`
// The inline hash/eql context is replaced by `Hash`/`PartialEq` impls on `LayerName` below.
// TODO(port): ArrayHashMap must use wyhash (u32-truncated) to match Zig iteration order.
pub type LayerNameHashMap<'bump, V> = ArrayHashMap<LayerName<'bump>, V>;

impl<'bump> core::hash::Hash for LayerName<'bump> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        // Mirrors the Zig ArrayHashMap context: Wyhash(seed=0) over each part's bytes.
        for part in self.v.slice() {
            state.write(part);
        }
    }
}

impl<'bump> PartialEq for LayerName<'bump> {
    fn eq(&self, other: &Self) -> bool {
        self.eql(other)
    }
}
impl<'bump> Eq for LayerName<'bump> {}

impl<'bump> LayerName<'bump> {
    // TODO(port): renamed from `hash` → `css_hash` to avoid shadowing `core::hash::Hash::hash`.
    // In Zig these were two distinct contexts (ArrayHashMap inline ctx vs `css.implementHash`);
    // Phase B should decide whether ArrayHashMap uses this or a custom hasher context.
    pub fn css_hash(&self, hasher: &mut impl Hasher) {
        // TODO(port): css::implement_hash is comptime field reflection — replace with #[derive(Hash)] in Phase B
        css::implement_hash(self, hasher);
    }

    pub fn clone_with_import_records(
        &self,
        bump: &'bump Bump,
        _: &mut BabyList<ImportRecord>,
    ) -> Self {
        LayerName { v: self.v.deep_clone(bump) }
    }

    pub fn deep_clone(&self, bump: &'bump Bump) -> LayerName<'bump> {
        LayerName { v: self.v.clone(bump) }
    }

    pub fn eql(&self, rhs: &LayerName<'bump>) -> bool {
        if self.v.len() != rhs.v.len() {
            return false;
        }
        debug_assert_eq!(self.v.slice().len(), rhs.v.slice().len());
        for (l, r) in self.v.slice().iter().zip(rhs.v.slice()) {
            if *l != *r {
                return false;
            }
        }
        true
    }

    pub fn parse(input: &mut Parser<'bump>) -> Result<LayerName<'bump>> {
        let mut parts: SmallList<&'bump [u8], 1> = SmallList::default();
        let ident = match input.expect_ident() {
            Result::Ok(v) => v,
            Result::Err(e) => return Result::Err(e),
        };
        parts.append(input.allocator(), ident);

        loop {
            // Zig: `const Fn = struct { pub fn tryParseFn(...) ... }`
            fn try_parse_fn<'b>(i: &mut Parser<'b>) -> Result<&'b [u8]> {
                let name = 'name: {
                    'out: {
                        let start_location = i.current_source_location();
                        let tok = match i.next_including_whitespace() {
                            Result::Err(e) => return Result::Err(e),
                            Result::Ok(vvv) => vvv,
                        };
                        if let css::Token::Delim(c) = *tok {
                            if c == '.' {
                                break 'out;
                            }
                        }
                        return Result::Err(start_location.new_basic_unexpected_token_error(*tok));
                    }

                    let start_location = i.current_source_location();
                    let tok = match i.next_including_whitespace() {
                        Result::Err(e) => return Result::Err(e),
                        Result::Ok(vvv) => vvv,
                    };
                    if let css::Token::Ident(ident) = tok {
                        break 'name *ident;
                    }
                    return Result::Err(start_location.new_basic_unexpected_token_error(*tok));
                };
                Result::Ok(name)
            }

            loop {
                let name = match input.try_parse(try_parse_fn) {
                    Result::Err(_) => break,
                    Result::Ok(vvv) => vvv,
                };
                parts.append(input.allocator(), name);
            }

            return Result::Ok(LayerName { v: parts });
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        let mut first = true;
        for name in self.v.slice() {
            if first {
                first = false;
            } else {
                dest.write_char('.')?;
            }

            if let Err(_) = css::serializer::serialize_identifier(name, dest) {
                return dest.add_fmt_error();
            }
        }
        Ok(())
    }
}

// Zig: `pub fn format(self, writer: *std.Io.Writer) !void` → `impl Display`
impl<'bump> fmt::Display for LayerName<'bump> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut first = true;
        for name in self.v.slice() {
            if first {
                first = false;
            } else {
                f.write_str(".")?;
            }
            // bytes may not be valid UTF-8; use bstr Display
            fmt::Display::fmt(bstr::BStr::new(name), f)?;
        }
        Ok(())
    }
}

/// A [@layer block](https://drafts.csswg.org/css-cascade-5/#layer-block) rule.
pub struct LayerBlockRule<'bump, R> {
    /// PERF: null pointer optimizaiton, nullable
    /// The name of the layer to declare, or `None` to declare an anonymous layer.
    pub name: Option<LayerName<'bump>>,
    /// The rules within the `@layer` rule.
    pub rules: CssRuleList<'bump, R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<'bump, R> LayerBlockRule<'bump, R> {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@layer")?;
        if let Some(name) = &self.name {
            dest.write_char(' ')?;
            name.to_css(dest)?;
        }

        dest.whitespace()?;
        dest.write_char('{')?;
        dest.indent();
        dest.newline()?;
        self.rules.to_css(dest)?;
        dest.dedent();
        dest.newline()?;
        dest.write_char('}')?;
        Ok(())
    }

    pub fn deep_clone(&self, bump: &'bump Bump) -> Self {
        // TODO(port): css::implement_deep_clone is comptime field reflection — replace with derive in Phase B
        css::implement_deep_clone(self, bump)
    }
}

/// A [@layer statement](https://drafts.csswg.org/css-cascade-5/#layer-empty) rule.
///
/// See also [LayerBlockRule](LayerBlockRule).
pub struct LayerStatementRule<'bump> {
    /// The layer names to declare.
    pub names: SmallList<LayerName<'bump>, 1>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<'bump> LayerStatementRule<'bump> {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        if self.names.len() > 0 {
            dest.write_str("@layer ")?;
            css::to_css::from_list::<LayerName>(self.names.slice(), dest)?;
            dest.write_char(';')?;
        } else {
            dest.write_str("@layer;")?;
        }
        Ok(())
    }

    pub fn deep_clone(&self, bump: &'bump Bump) -> Self {
        // TODO(port): css::implement_deep_clone is comptime field reflection — replace with derive in Phase B
        css::implement_deep_clone(self, bump)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/layer.zig (210 lines)
//   confidence: medium
//   todos:      5
//   notes:      'bump lifetime threaded through arena-backed CSS types; Token variant matching and css::Result shape will need fixup in Phase B; inherent `hash` renamed to `css_hash` to avoid shadowing trait impl
// ──────────────────────────────────────────────────────────────────────────
