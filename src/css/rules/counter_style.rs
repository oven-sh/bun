use crate::css_parser as css;
use crate::css_parser::css_rules::Location;
use crate::css_parser::css_values::ident::{CustomIdent, CustomIdentFns};
use crate::css_parser::{DeclarationBlock, PrintErr, Printer};

/// A [@counter-style](https://drafts.csswg.org/css-counter-styles/#the-counter-style-rule) rule.
pub struct CounterStyleRule {
    /// The name of the counter style to declare.
    pub name: CustomIdent,
    /// Declarations in the `@counter-style` rule.
    pub declarations: DeclarationBlock,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl CounterStyleRule {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@counter-style")?;
        CustomIdentFns::to_css(&self.name, dest)?;
        self.declarations.to_css_block(dest)
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone uses @typeInfo field reflection — replace with
        // #[derive(DeepClone)] or hand-written per-field clone in Phase B.
        css::implement_deep_clone(self, bump)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/counter_style.zig (31 lines)
//   confidence: high
//   todos:      1
//   notes:      implementDeepClone is comptime reflection; needs derive/trait in Phase B
// ──────────────────────────────────────────────────────────────────────────
