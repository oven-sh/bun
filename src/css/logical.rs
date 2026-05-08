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

// ported from: src/css/logical.zig
