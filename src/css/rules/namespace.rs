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
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/namespace.zig (38 lines)
//   confidence: high
//   todos:      0
//   notes:      inherent deep_clone provided by deep_clone_shim! in mod.rs until DeepClone derive lands
// ──────────────────────────────────────────────────────────────────────────
