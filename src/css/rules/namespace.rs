use crate::css_rules::Location;
use crate::values::ident::Ident;
use crate::values::string::{CssString, CssStringFns};
use crate::{PrintErr, Printer};

/// A [@namespace](https://drafts.csswg.org/css-namespaces/#declaration) rule.
pub struct NamespaceRule<'bump> {
    /// An optional namespace prefix to declare, or `None` to declare the default namespace.
    pub(crate) prefix: Option<Ident<'bump>>,
    /// The url of the namespace.
    pub(crate) url: CssString<'bump>,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl NamespaceRule<'_> {
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
        Self {
            prefix: self.prefix.as_ref().map(|p| p.deep_clone(bump)),
            url: self.url,
            loc: self.loc,
        }
    }
}
