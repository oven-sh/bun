use crate::css_parser as css;
use crate::css_parser::css_rules::style::StyleRule;
use crate::css_parser::css_rules::Location;
use crate::css_parser::{PrintErr, Printer};

/// A [@nest](https://www.w3.org/TR/css-nesting-1/#at-nest) rule.
pub struct NestingRule<R> {
    /// The style rule that defines the selector and declarations for the `@nest` rule.
    pub style: StyleRule<R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<R> NestingRule<R> {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        if dest.context().is_none() {
            dest.write_str("@nest ")?;
        }
        self.style.to_css(dest)
    }

    pub fn deep_clone(&self, allocator: &bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone uses @typeInfo field reflection; Phase B should
        // replace with a #[derive(DeepClone)] or hand-written per-field clone into the arena.
        css::implement_deep_clone(self, allocator)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/nesting.zig (32 lines)
//   confidence: medium
//   todos:      1
//   notes:      generic type-returning fn → struct<R>; deep_clone allocator kept as arena (css is AST crate)
// ──────────────────────────────────────────────────────────────────────────
