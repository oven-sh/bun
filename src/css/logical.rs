pub use crate::css_parser as css;
pub use css::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PropertyCategory {
    Logical,
    Physical,
}

impl Default for PropertyCategory {
    fn default() -> Self {
        PropertyCategory::Physical
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LogicalGroup {
    BorderColor,
    BorderStyle,
    BorderWidth,
    BorderRadius,
    Margin,
    ScrollMargin,
    Padding,
    ScrollPadding,
    Inset,
    Size,
    MinSize,
    MaxSize,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/logical.zig (26 lines)
//   confidence: high
//   todos:      0
//   notes:      pure enums + re-exports; css_parser module path may need adjusting in Phase B
// ──────────────────────────────────────────────────────────────────────────
