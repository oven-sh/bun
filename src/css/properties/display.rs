#![allow(unused_imports, dead_code)]
#![warn(unused_must_use)]
use crate as css;
use crate::{Parser, PrintErr, Printer, VendorPrefix};

/// A value for the [display](https://drafts.csswg.org/css-display-3/#the-display-properties) property.
#[derive(Clone, PartialEq, Eq, Hash)]
pub enum Display {
    /// A display keyword.
    Keyword(DisplayKeyword),
    /// The inside and outside display values.
    Pair(DisplayPair),
}

// PORT NOTE: Zig `DeriveParse`/`DeriveToCss` for a 2-payload union(enum) tries each
// payload's `parse` in declaration order; `toCss` dispatches to the active payload.
impl Display {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        if let Ok(kw) = input.try_parse(DisplayKeyword::parse) {
            return Ok(Display::Keyword(kw));
        }
        DisplayPair::parse(input).map(Display::Pair)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            Display::Keyword(kw) => kw.to_css(dest),
            Display::Pair(p) => p.to_css(dest),
        }
    }

    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // All payloads are Copy.
        self.clone()
    }
}

/// A value for the [visibility](https://drafts.csswg.org/css-display-3/#visibility) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum Visibility {
    /// The element is visible.
    Visible,
    /// The element is hidden.
    Hidden,
    /// The element is collapsed.
    Collapse,
}

/// A `display` keyword.
///
/// See [Display](Display).
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum DisplayKeyword {
    None,
    Contents,
    TableRowGroup,
    TableHeaderGroup,
    TableFooterGroup,
    TableRow,
    TableCell,
    TableColumnGroup,
    TableColumn,
    TableCaption,
    RubyBase,
    RubyText,
    RubyBaseContainer,
    RubyTextContainer,
}

/// A pair of inside and outside display values, as used in the `display` property.
///
/// See [Display](Display).
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct DisplayPair {
    /// The outside display value.
    pub outside: DisplayOutside,
    /// The inside display value.
    pub inside: DisplayInside,
    /// Whether this is a list item.
    pub is_list_item: bool,
}

impl DisplayPair {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        let mut list_item = false;
        let mut outside: Option<DisplayOutside> = None;
        let mut inside: Option<DisplayInside> = None;

        loop {
            if input
                .try_parse(|i| i.expect_ident_matching(b"list-item"))
                .is_ok()
            {
                list_item = true;
                continue;
            }

            if outside.is_none() {
                if let Ok(o) = input.try_parse(DisplayOutside::parse) {
                    outside = Some(o);
                    continue;
                }
            }

            if inside.is_none() {
                if let Ok(i) = input.try_parse(DisplayInside::parse) {
                    inside = Some(i);
                    continue;
                }
            }

            break;
        }

        if list_item || inside.is_some() || outside.is_some() {
            let final_inside: DisplayInside = inside.unwrap_or(DisplayInside::Flow);
            let final_outside: DisplayOutside = outside.unwrap_or(match final_inside {
                // "If <display-outside> is omitted, the element’s outside display type
                // defaults to block — except for ruby, which defaults to inline."
                // https://drafts.csswg.org/css-display/#inside-model
                DisplayInside::Ruby => DisplayOutside::Inline,
                _ => DisplayOutside::Block,
            });

            if list_item && !matches!(final_inside, DisplayInside::Flow | DisplayInside::FlowRoot) {
                return Err(input.new_custom_error(css::ParserError::invalid_declaration));
            }

            return Ok(DisplayPair {
                outside: final_outside,
                inside: final_inside,
                is_list_item: list_item,
            });
        }

        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;

        // PORT NOTE: Zig used `bun.ComptimeStringMap(..).getASCIIICaseInsensitive`.
        // 8 keys → if-chain over `eql_case_insensitive_ascii::<true>` (phf values
        // would have to be const-eval, and `VendorPrefix` bitflags are not).
        use bun_core::eql_case_insensitive_ascii as eq;
        let inside = if eq(ident, b"inline-block", true) {
            DisplayInside::FlowRoot
        } else if eq(ident, b"inline-table", true) {
            DisplayInside::Table
        } else if eq(ident, b"inline-flex", true) {
            DisplayInside::Flex(VendorPrefix::NONE)
        } else if eq(ident, b"-webkit-inline-flex", true) {
            DisplayInside::Flex(VendorPrefix::WEBKIT)
        } else if eq(ident, b"-ms-inline-flexbox", true) {
            DisplayInside::Flex(VendorPrefix::MS)
        } else if eq(ident, b"-webkit-inline-box", true) {
            DisplayInside::Box(VendorPrefix::WEBKIT)
        } else if eq(ident, b"-moz-inline-box", true) {
            DisplayInside::Box(VendorPrefix::MOZ)
        } else if eq(ident, b"inline-grid", true) {
            DisplayInside::Grid
        } else {
            return Err(location.new_unexpected_token_error(css::Token::Ident(ident)));
        };
        Ok(DisplayPair {
            outside: DisplayOutside::Inline,
            inside,
            is_list_item: false,
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // PORT NOTE: reshaped Zig if-else chain into match for tagged-union payload extraction.
        match (self.outside, &self.inside, self.is_list_item) {
            (DisplayOutside::Inline, DisplayInside::FlowRoot, false) => {
                return dest.write_str("inline-block");
            }
            (DisplayOutside::Inline, DisplayInside::Table, false) => {
                return dest.write_str("inline-table");
            }
            (DisplayOutside::Inline, DisplayInside::Flex(prefix), false) => {
                prefix.to_css(dest)?;
                if *prefix == VendorPrefix::MS {
                    return dest.write_str("inline-flexbox");
                } else {
                    return dest.write_str("inline-flex");
                }
            }
            (DisplayOutside::Inline, DisplayInside::Box(prefix), false) => {
                prefix.to_css(dest)?;
                return dest.write_str("inline-box");
            }
            (DisplayOutside::Inline, DisplayInside::Grid, false) => {
                return dest.write_str("inline-grid");
            }
            _ => {
                let default_outside: DisplayOutside = match self.inside {
                    DisplayInside::Ruby => DisplayOutside::Inline,
                    _ => DisplayOutside::Block,
                };

                let mut needs_space = false;
                if self.outside != default_outside
                    || (self.inside == DisplayInside::Flow && !self.is_list_item)
                {
                    self.outside.to_css(dest)?;
                    needs_space = true;
                }

                if self.inside != DisplayInside::Flow {
                    if needs_space {
                        dest.write_char(b' ')?;
                    }
                    self.inside.to_css(dest)?;
                    needs_space = true;
                }

                if self.is_list_item {
                    if needs_space {
                        dest.write_char(b' ')?;
                    }
                    dest.write_str("list-item")?;
                }
                Ok(())
            }
        }
    }
}

/// A [`<display-outside>`](https://drafts.csswg.org/css-display-3/#typedef-display-outside) value.
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum DisplayOutside {
    Block,
    Inline,
    RunIn,
}

/// A [`<display-inside>`](https://drafts.csswg.org/css-display-3/#typedef-display-inside) value.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum DisplayInside {
    Flow,
    FlowRoot,
    Table,
    Flex(VendorPrefix),
    Box(VendorPrefix),
    Grid,
    Ruby,
}

impl DisplayInside {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;

        // PORT NOTE: Zig used `bun.ComptimeStringMap(..).getASCIIICaseInsensitive`.
        // 10 keys → if-chain over `eql_case_insensitive_ascii::<true>`.
        use bun_core::eql_case_insensitive_ascii as eq;
        Ok(if eq(ident, b"flow", true) {
            DisplayInside::Flow
        } else if eq(ident, b"flow-root", true) {
            DisplayInside::FlowRoot
        } else if eq(ident, b"table", true) {
            DisplayInside::Table
        } else if eq(ident, b"flex", true) {
            DisplayInside::Flex(VendorPrefix::NONE)
        } else if eq(ident, b"-webkit-flex", true) {
            DisplayInside::Flex(VendorPrefix::WEBKIT)
        } else if eq(ident, b"-ms-flexbox", true) {
            DisplayInside::Flex(VendorPrefix::MS)
        } else if eq(ident, b"-webkit-box", true) {
            DisplayInside::Box(VendorPrefix::WEBKIT)
        } else if eq(ident, b"-moz-box", true) {
            DisplayInside::Box(VendorPrefix::MOZ)
        } else if eq(ident, b"grid", true) {
            DisplayInside::Grid
        } else if eq(ident, b"ruby", true) {
            DisplayInside::Ruby
        } else {
            return Err(location.new_unexpected_token_error(css::Token::Ident(ident)));
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            DisplayInside::Flow => dest.write_str("flow"),
            DisplayInside::FlowRoot => dest.write_str("flow-root"),
            DisplayInside::Table => dest.write_str("table"),
            DisplayInside::Flex(prefix) => {
                prefix.to_css(dest)?;
                if *prefix == VendorPrefix::MS {
                    dest.write_str("flexbox")
                } else {
                    dest.write_str("flex")
                }
            }
            DisplayInside::Box(prefix) => {
                prefix.to_css(dest)?;
                dest.write_str("box")
            }
            DisplayInside::Grid => dest.write_str("grid"),
            DisplayInside::Ruby => dest.write_str("ruby"),
        }
    }
}

// ported from: src/css/properties/display.zig
