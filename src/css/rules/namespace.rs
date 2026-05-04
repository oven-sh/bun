use crate::css_parser as css;
use crate::values as css_values;
use css::Printer;
use css::PrintErr;

pub use css::Error;

/// A [@namespace](https://drafts.csswg.org/css-namespaces/#declaration) rule.
pub struct NamespaceRule {
    /// An optional namespace prefix to declare, or `None` to declare the default namespace.
    pub prefix: Option<css::Ident>,
    /// The url of the namespace.
    pub url: css::CSSString,
    /// The location of the rule in the source file.
    pub loc: css::Location,
}

impl NamespaceRule {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@namespace ")?;
        if let Some(prefix) = &self.prefix {
            css_values::ident::IdentFns::to_css(prefix, dest)?;
            dest.write_char(' ')?;
        }

        css_values::string::CSSStringFns::to_css(&self.url, dest)?;
        dest.write_char(';')
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // TODO(port): implement_deep_clone uses @typeInfo field iteration; replace with #[derive] or per-type trait in Phase B
        css::implement_deep_clone(self, bump)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/namespace.zig (38 lines)
//   confidence: medium
//   todos:      1
//   notes:      deep_clone relies on comptime-reflection helper; arena (&Bump) threaded per AST-crate rule
// ──────────────────────────────────────────────────────────────────────────
