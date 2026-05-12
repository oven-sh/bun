use core::fmt;

use bun_alloc::Arena;
use bun_ast::ImportRecord;
use bun_collections::{ArrayHashMap, VecExt};

use crate as css;
use crate::css_rules::{CssRuleList, Location};
use crate::{PrintErr, Printer, SmallList};

/// A CSS cascade layer name. Stored as a list of segments because dot
/// notation (`a.b.c`) creates sublayers.
#[derive(Default)]
pub struct LayerName {
    // TODO(port): arena lifetime — Zig `[]const u8` segments borrow the parser
    // arena. Phase B threads `'bump` once `CssRuleList` re-gains its arena
    // lifetime; until then segments are laundered through `&'static [u8]` like
    // every other CSS slice in this crate.
    pub v: SmallList<&'static [u8], 1>,
}

// Zig: `pub fn HashMap(comptime V: type) type { return std.ArrayHashMapUnmanaged(...) }`
// The inline hash/eql context is replaced by `Hash`/`PartialEq` impls on `LayerName` below.
// TODO(port): ArrayHashMap must use wyhash (u32-truncated) to match Zig iteration order.
pub type LayerNameHashMap<V> = ArrayHashMap<LayerName, V>;

impl core::hash::Hash for LayerName {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        // Mirrors the Zig ArrayHashMap context: Wyhash(seed=0) over each part's bytes.
        for part in self.v.slice() {
            state.write(part);
        }
    }
}

impl PartialEq for LayerName {
    fn eq(&self, other: &Self) -> bool {
        self.eql(other)
    }
}
impl Eq for LayerName {}

// PORT NOTE: trait `Clone` (not just inherent `deep_clone`) so the bundler's
// `Chunk::Layers::to_owned` can `deep_clone_with(|l| l.clone())`. Segments are
// arena-borrowed `&'static [u8]` (Copy), so this is the same shallow
// `SmallList` copy as `deep_clone` / `clone_with_import_records`.
impl Clone for LayerName {
    fn clone(&self) -> Self {
        LayerName { v: self.v.clone() }
    }
}

impl LayerName {
    pub fn clone_with_import_records(&self, _bump: &Arena, _: &mut Vec<ImportRecord>) -> Self {
        // `[]const u8` segments are arena-borrowed, not owned, so the Zig
        // `deepClone` here was a shallow `SmallList` copy. No import records to
        // rewrite — layer names contain no URLs.
        LayerName { v: self.v.clone() }
    }

    pub fn eql(&self, rhs: &LayerName) -> bool {
        if self.v.len() != rhs.v.len() {
            return false;
        }
        for (l, r) in self.v.slice().iter().zip(rhs.v.slice()) {
            if **l != **r {
                return false;
            }
        }
        true
    }

    pub fn parse(input: &mut css::css_parser::Parser<'_>) -> css::css_parser::CssResult<LayerName> {
        let mut parts: SmallList<&'static [u8], 1> = SmallList::default();
        let ident = input.expect_ident_cloned()?;
        parts.append(ident);

        loop {
            // Zig: `const Fn = struct { pub fn tryParseFn(...) ... }`
            let try_parse_fn =
                |i: &mut css::css_parser::Parser<'_>| -> css::css_parser::CssResult<&'static [u8]> {
                    let start_location = i.current_source_location();
                    let tok = i.next_including_whitespace()?.clone();
                    if !matches!(tok, css::Token::Delim(c) if c == u32::from(b'.')) {
                        return Err(start_location.new_basic_unexpected_token_error(tok));
                    }

                    let start_location = i.current_source_location();
                    let tok = i.next_including_whitespace()?.clone();
                    if let css::Token::Ident(ident) = tok {
                        return Ok(ident);
                    }
                    Err(start_location.new_basic_unexpected_token_error(tok))
                };

            match input.try_parse(try_parse_fn) {
                Ok(name) => parts.append(name),
                Err(_) => return Ok(LayerName { v: parts }),
            }
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_separated(
            self.v.slice(),
            |d| d.write_char(b'.'),
            |d, name| d.serialize_identifier(name),
        )
    }

    pub fn deep_clone(&self, _bump: &Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` — `[]const u8` segments are
        // arena-owned (identity copy per generics.zig "const strings"). Same
        // body as `clone_with_import_records` above.
        LayerName { v: self.v.clone() }
    }
}

impl css::generics::ToCss for LayerName {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        LayerName::to_css(self, dest)
    }
}

// Zig: `pub fn format(self, writer: *std.Io.Writer) !void` → `impl Display`
impl fmt::Display for LayerName {
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
pub struct LayerBlockRule<R> {
    /// PERF: null pointer optimizaiton, nullable
    /// The name of the layer to declare, or `None` to declare an anonymous layer.
    pub name: Option<LayerName>,
    /// The rules within the `@layer` rule.
    pub rules: CssRuleList<R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<R> LayerBlockRule<R> {
    pub fn deep_clone<'bump>(&self, bump: &'bump Arena) -> Self
    where
        R: css::generics::DeepClone<'bump>,
    {
        // PORT NOTE: `css.implementDeepClone` field-walk.
        Self {
            name: self.name.as_ref().map(|n| n.deep_clone(bump)),
            rules: self.rules.deep_clone(bump),
            loc: self.loc,
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@layer")?;
        if let Some(name) = &self.name {
            dest.write_char(b' ')?;
            name.to_css(dest)?;
        }

        dest.block(|d| {
            d.newline()?;
            self.rules.to_css(d)
        })
    }
}

/// A [@layer statement](https://drafts.csswg.org/css-cascade-5/#layer-empty) rule.
///
/// See also [LayerBlockRule](LayerBlockRule).
pub struct LayerStatementRule {
    /// The layer names to declare.
    pub names: SmallList<LayerName, 1>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl LayerStatementRule {
    pub fn deep_clone(&self, bump: &Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` field-walk.
        let mut names = SmallList::<LayerName, 1>::default();
        for n in self.names.slice() {
            names.append(n.deep_clone(bump));
        }
        Self {
            names,
            loc: self.loc,
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        if self.names.len() > 0 {
            dest.write_str("@layer ")?;
            css::to_css::from_list(self.names.slice(), dest)?;
            dest.write_char(b';')
        } else {
            dest.write_str("@layer;")
        }
    }
}

// ported from: src/css/rules/layer.zig
