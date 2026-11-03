use crate::css_rules::Location;
use crate::css_rules::layer::LayerStatementRule;
use crate::values::ident::Ident;
use crate::values::string::{CssString, CssStringFns};
use crate::{PrintErr, Printer};

/// A [@namespace](https://drafts.csswg.org/css-namespaces/#declaration) rule.
#[derive(Clone, Copy)]
pub struct NamespaceRule {
    /// An optional namespace prefix to declare, or `None` to declare the default namespace.
    pub(crate) prefix: Option<Ident>,
    /// The url of the namespace.
    pub(crate) url: CssString,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl NamespaceRule {
    pub fn prefix(&self) -> Option<&[u8]> {
        self.prefix.as_ref().map(Ident::v)
    }

    pub fn url(&self) -> &[u8] {
        // SAFETY: a slice of the parser's arena, which outlives the rule (see `crate::arena_str`).
        unsafe { crate::arena_str(self.url) }
    }

    /// Whether the rule comes after `layer` in the source of their sheet.
    pub fn follows(&self, layer: &LayerStatementRule) -> bool {
        (self.loc.line, self.loc.column) > (layer.loc.line, layer.loc.column)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@namespace ")?;
        if let Some(prefix) = &self.prefix {
            prefix.to_css(dest)?;
            dest.write_char(b' ')?;
        }

        CssStringFns::to_css(&self.url, dest)?;
        dest.write_char(b';')
    }

    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // `CssString` is `*const [u8]` (arena-owned slice → identity copy);
        // `Ident::deep_clone` is the same identity copy.
        Self {
            prefix: self.prefix.as_ref().map(|p| p.deep_clone(bump)),
            url: self.url,
            loc: self.loc,
        }
    }
}
