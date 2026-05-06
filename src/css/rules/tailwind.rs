pub use crate::css_parser as css;
pub use crate::values as css_values;

use crate::css_parser::{enum_property_util, Location, Parser, PrintErr, Printer};

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

#[derive(Clone, Copy, PartialEq, Eq)]
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

impl From<TailwindStyleName> for &'static str {
    fn from(v: TailwindStyleName) -> &'static str {
        match v {
            TailwindStyleName::Base => "base",
            TailwindStyleName::Components => "components",
            TailwindStyleName::Utilities => "utilities",
            TailwindStyleName::Variants => "variants",
        }
    }
}

// PORT NOTE: Zig `css.DefineEnumProperty(@This())` — hand-rolled until
// `#[derive(DefineEnumProperty)]` covers `&[u8]` lookup.
impl css::EnumProperty for TailwindStyleName {
    fn from_ascii_case_insensitive(ident: &[u8]) -> Option<Self> {
        use bun_string::strings::eql_case_insensitive_ascii_check_length as eq;
        if eq(ident, b"base") { return Some(Self::Base); }
        if eq(ident, b"components") { return Some(Self::Components); }
        if eq(ident, b"utilities") { return Some(Self::Utilities); }
        if eq(ident, b"variants") { return Some(Self::Variants); }
        None
    }
}

impl TailwindStyleName {
    pub fn as_str(&self) -> &'static str {
        enum_property_util::as_str::<Self>(self)
    }

    pub fn parse(input: &mut Parser) -> css::CssResult<Self> {
        enum_property_util::parse::<Self>(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        enum_property_util::to_css::<Self>(self, dest)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/tailwind.zig (57 lines)
//   confidence: high
//   todos:      0
//   notes:      enum_property_util must map PascalCase variants to lowercase CSS keywords (base/components/utilities/variants)
// ──────────────────────────────────────────────────────────────────────────
