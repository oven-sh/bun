#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum PropertyCategory {
    Logical,
    #[default]
    Physical,
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
