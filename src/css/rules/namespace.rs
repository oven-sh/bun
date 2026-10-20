use crate::css_rules::Location;
use crate::values::ident::Ident;
use crate::values::string::{CssString, CssStringFns};
use crate::{PrintErr, Printer};

/// A [@namespace](https://drafts.csswg.org/css-namespaces/#declaration) rule.
pub struct NamespaceRule {
    /// An optional namespace prefix to declare, or `None` to declare the default namespace.
    pub(crate) prefix: Option<Ident>,
    /// The url of the namespace.
    pub(crate) url: CssString,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl NamespaceRule {
    /// A rule that no file holds. The bundler prints the `@namespace` rules of a chunk once.
    pub fn new(prefix: Option<&'static [u8]>, url: &'static [u8]) -> Self {
        Self {
            prefix: prefix.map(|prefix| Ident {
                v: std::ptr::from_ref::<[u8]>(prefix),
            }),
            url: std::ptr::from_ref::<[u8]>(url),
            loc: Location::dummy(),
        }
    }

    pub fn prefix(&self) -> Option<&[u8]> {
        self.prefix.as_ref().map(Ident::v)
    }

    pub fn url(&self) -> &[u8] {
        // SAFETY: a slice of the parser's arena or of the bundler's, which
        // outlives the rule (see `crate::arena_str`).
        unsafe { crate::arena_str(self.url) }
    }

    /// The line, from 1, and the column of the rule in its file.
    pub fn line_and_column(&self) -> (u32, u32) {
        (self.loc.line + 1, self.loc.column)
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
