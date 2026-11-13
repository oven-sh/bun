use core::fmt;

use bun_alloc::Arena;

use crate as css;
use crate::css_rules::{CssRuleList, Location, StyleContext};
use crate::{PrintErr, Printer, SmallList};

/// A CSS cascade layer name. Stored as a list of segments because dot
/// notation (`a.b.c`) creates sublayers.
#[derive(Default)]
pub struct LayerName<'bump> {
    pub v: SmallList<&'bump [u8], 1>,
}

// Trait `Clone` (not just inherent `deep_clone`) so the bundler's
// `Chunk::Layers::to_owned` can `deep_clone_with(|l| l.clone())`. Segments are
// arena-borrowed `&[u8]` (Copy), so this is the same shallow
// `SmallList` copy as `deep_clone`.
impl Clone for LayerName<'_> {
    fn clone(&self) -> Self {
        LayerName { v: self.v.clone() }
    }
}

impl<'bump> LayerName<'bump> {
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

    pub fn parse(
        input: &mut css::css_parser::Parser<'_, 'bump>,
    ) -> css::css_parser::CssResult<'bump, LayerName<'bump>> {
        let mut parts: SmallList<&'bump [u8], 1> = SmallList::default();
        let ident = input.expect_ident()?;
        parts.append(ident);

        loop {
            let try_parse_fn =
                |i: &mut css::css_parser::Parser<'_, 'bump>| -> css::Result<'bump, &'bump [u8]> {
                    let start_location = i.current_source_location();
                    let tok = *i.next_including_whitespace()?;
                    if !matches!(tok, css::Token::Delim(c) if c == u32::from(b'.')) {
                        return Err(start_location.new_unexpected_token_error(tok));
                    }

                    let start_location = i.current_source_location();
                    let tok = *i.next_including_whitespace()?;
                    if let css::Token::Ident(ident) = tok {
                        return Ok(ident);
                    }
                    Err(start_location.new_unexpected_token_error(tok))
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

    pub(crate) fn deep_clone(&self, _bump: &Arena) -> Self {
        // Segments are arena-owned (identity copy).
        LayerName { v: self.v.clone() }
    }
}

impl css::generics::ToCss for LayerName<'_> {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        LayerName::to_css(self, dest)
    }
}

impl fmt::Display for LayerName<'_> {
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
    pub(crate) fn deep_clone(&self, bump: &'bump Arena) -> Self
    where
        R: css::generics::DeepClone<'bump>,
    {
        // `css.implementDeepClone` field-walk.
        Self {
            name: self.name.as_ref().map(|n| n.deep_clone(bump)),
            rules: self.rules.deep_clone(bump),
            loc: self.loc,
        }
    }

    pub fn to_css(
        &self,
        dest: &mut Printer,
        ctx: Option<&StyleContext<'_, 'bump>>,
    ) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@layer")?;
        if let Some(name) = &self.name {
            dest.write_char(b' ')?;
            name.to_css(dest)?;
        }

        dest.block(|d| {
            d.newline()?;
            self.rules.to_css(d, ctx)
        })
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

impl LayerStatementRule<'_> {
    pub(crate) fn deep_clone(&self, bump: &Arena) -> Self {
        // `css.implementDeepClone` field-walk.
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
