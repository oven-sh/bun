pub use crate::css_parser as css;
pub use crate::values as css_values;

use crate::css_parser::{Location, PrintErr, Printer};

pub use crate::css_parser::Error;

/// @tailwind
/// https://github.com/tailwindlabs/tailwindcss.com/blob/4d6ac11425d96bc963f936e0157df460a364c43b/src/pages/docs/functions-and-directives.mdx?plain=1#L13
#[derive(Clone, Copy)]
pub struct TailwindAtRule {
    pub style_name: TailwindStyleName,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl TailwindAtRule {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_str("@tailwind")?;
        dest.whitespace()?;
        self.style_name.to_css(dest)?;
        dest.write_char(b';')?;
        Ok(())
    }

    pub fn deep_clone(&self, _: &bun_alloc::Arena) -> Self {
        *self
    }
}

#[derive(Clone, Copy, PartialEq, Eq, css::DefineEnumProperty)]
pub enum TailwindStyleName {
    /// This injects Tailwind's base styles and any base styles registered by
    ///  plugins.
    Base,
    /// This injects Tailwind's component classes and any component classes
    /// registered by plugins.
    Components,
    /// This injects Tailwind's utility classes and any utility classes registered
    /// by plugins.
    Utilities,
    /// Use this directive to control where Tailwind injects the hover, focus,
    /// responsive, dark mode, and other variants of each class.
    ///
    /// If omitted, Tailwind will append these classes to the very end of
    /// your stylesheet by default.
    Variants,
}

// ported from: src/css/rules/tailwind.zig
