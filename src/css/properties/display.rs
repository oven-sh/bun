use bun_css::{self as css, Parser, Printer, PrintErr, VendorPrefix};

/// A value for the [display](https://drafts.csswg.org/css-display-3/#the-display-properties) property.
#[derive(Clone, PartialEq, Eq, Hash, css::Parse, css::ToCss)]
pub enum Display {
    /// A display keyword.
    Keyword(DisplayKeyword),
    /// The inside and outside display values.
    Pair(DisplayPair),
}
// PORT NOTE: Zig `DeriveParse`/`DeriveToCss`/`implementDeepClone`/`implementHash`/`implementEql`
// are comptime-reflection helpers — replaced by `#[derive(Clone, PartialEq, Eq, Hash, Parse, ToCss)]`.

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
                .try_parse(|i| i.expect_ident_matching("list-item"))
                .is_ok()
            {
                list_item = true;
                continue;
            }

            if outside.is_none() {
                if let Some(o) = input.try_parse(DisplayOutside::parse).ok() {
                    outside = Some(o);
                    continue;
                }
            }

            if inside.is_none() {
                if let Some(i) = input.try_parse(DisplayInside::parse).ok() {
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

            if list_item
                && !matches!(final_inside, DisplayInside::Flow | DisplayInside::FlowRoot)
            {
                return Err(input.new_custom_error(css::ParserError::InvalidDeclaration));
            }

            return Ok(DisplayPair {
                outside: final_outside,
                inside: final_inside,
                is_list_item: list_item,
            });
        }

        let location = input.current_source_location();
        let ident = match input.expect_ident() {
            Ok(v) => v,
            Err(e) => return Err(e),
        };

        // TODO(port): phf custom hasher — Zig used getASCIIICaseInsensitive; phf keys are
        // case-sensitive. Phase B: either lowercase `ident` before lookup or use a
        // case-insensitive perfect hash.
        static DISPLAY_IDENT_MAP: phf::Map<&'static [u8], DisplayPair> = phf::phf_map! {
            b"inline-block"        => DisplayPair { outside: DisplayOutside::Inline, inside: DisplayInside::FlowRoot,                  is_list_item: false },
            b"inline-table"        => DisplayPair { outside: DisplayOutside::Inline, inside: DisplayInside::Table,                     is_list_item: false },
            b"inline-flex"         => DisplayPair { outside: DisplayOutside::Inline, inside: DisplayInside::Flex(VendorPrefix::NONE),  is_list_item: false },
            b"-webkit-inline-flex" => DisplayPair { outside: DisplayOutside::Inline, inside: DisplayInside::Flex(VendorPrefix::WEBKIT),is_list_item: false },
            b"-ms-inline-flexbox"  => DisplayPair { outside: DisplayOutside::Inline, inside: DisplayInside::Flex(VendorPrefix::MS),    is_list_item: false },
            b"-webkit-inline-box"  => DisplayPair { outside: DisplayOutside::Inline, inside: DisplayInside::Box(VendorPrefix::WEBKIT), is_list_item: false },
            b"-moz-inline-box"     => DisplayPair { outside: DisplayOutside::Inline, inside: DisplayInside::Box(VendorPrefix::MOZ),    is_list_item: false },
            b"inline-grid"         => DisplayPair { outside: DisplayOutside::Inline, inside: DisplayInside::Grid,                      is_list_item: false },
        };
        if let Some(pair) = DISPLAY_IDENT_MAP.get(ident) {
            return Ok(*pair);
        }

        Err(location.new_unexpected_token_error(css::Token::Ident(ident)))
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
                        dest.write_char(' ')?;
                    }
                    self.inside.to_css(dest)?;
                    needs_space = true;
                }

                if self.is_list_item {
                    if needs_space {
                        dest.write_char(' ')?;
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
        // TODO(port): phf custom hasher — Zig used getASCIIICaseInsensitive; see note above.
        static DISPLAY_INSIDE_MAP: phf::Map<&'static [u8], DisplayInside> = phf::phf_map! {
            b"flow"         => DisplayInside::Flow,
            b"flow-root"    => DisplayInside::FlowRoot,
            b"table"        => DisplayInside::Table,
            b"flex"         => DisplayInside::Flex(VendorPrefix::NONE),
            b"-webkit-flex" => DisplayInside::Flex(VendorPrefix::WEBKIT),
            b"-ms-flexbox"  => DisplayInside::Flex(VendorPrefix::MS),
            b"-webkit-box"  => DisplayInside::Box(VendorPrefix::WEBKIT),
            b"-moz-box"     => DisplayInside::Box(VendorPrefix::MOZ),
            b"grid"         => DisplayInside::Grid,
            b"ruby"         => DisplayInside::Ruby,
        };

        let location = input.current_source_location();
        let ident = match input.expect_ident() {
            Ok(v) => v,
            Err(e) => return Err(e),
        };

        if let Some(value) = DISPLAY_INSIDE_MAP.get(ident) {
            return Ok(*value);
        }

        Err(location.new_unexpected_token_error(css::Token::Ident(ident)))
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/display.zig (287 lines)
//   confidence: medium
//   todos:      2
//   notes:      DefineEnumProperty/Parse/ToCss are placeholder derives; phf maps need ASCII-case-insensitive lookup in Phase B.
// ──────────────────────────────────────────────────────────────────────────
