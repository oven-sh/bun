use crate::css_rules::Location;
use crate::values::ident::Ident;
use crate::values::string::{CssString, CssStringFns};
use crate::{PrintErr, Printer};

/// A [@namespace](https://drafts.csswg.org/css-namespaces/#declaration) rule.
pub struct NamespaceRule {
    /// An optional namespace prefix to declare, or `None` to declare the default namespace.
    pub prefix: Option<Ident>,
    /// The url of the namespace.
    pub url: CssString,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl NamespaceRule {
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

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` field-walk. `CssString` is
        // `*const [u8]` (arena-owned slice → identity copy per generics.zig
        // "const strings" rule); `Ident::deep_clone` is the same identity copy.
        Self {
            prefix: self.prefix.as_ref().map(|p| p.deep_clone(bump)),
            url: self.url,
            loc: self.loc,
        }
    }
}

// ported from: src/css/rules/namespace.zig
