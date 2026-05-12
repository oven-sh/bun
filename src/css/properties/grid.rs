use crate as css;
use crate::css_values::ident::{CustomIdent, CustomIdentList};
use crate::css_values::length::LengthPercentage;
use crate::css_values::number::{CSSInteger, CSSIntegerFns, CSSNumber, CSSNumberFns};
use crate::{Parser, PrintErr, Printer, SmallList};

use bun_collections::VecExt;
use bun_core::strings;

/// A [track sizing](https://drafts.csswg.org/css-grid-2/#track-sizing) value
/// for the `grid-template-rows` and `grid-template-columns` properties.
// TODO(port): css.DeriveParse / css.DeriveToCss → #[derive(Parse, ToCss)] proc-macro
pub enum TrackSizing {
    /// No explicit grid tracks.
    None,
    /// A list of grid tracks.
    Tracklist(TrackList),
}

/// A [`<track-list>`](https://drafts.csswg.org/css-grid-2/#typedef-track-list) value,
/// as used in the `grid-template-rows` and `grid-template-columns` properties.
///
/// See [TrackSizing](TrackSizing).
pub struct TrackList {
    /// A list of line names.
    pub line_names: Vec<CustomIdentList>,
    /// A list of grid track items.
    pub items: Vec<TrackListItem>,
}

impl TrackList {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        let mut line_names = Vec::<CustomIdentList>::default();
        let mut items = Vec::<TrackListItem>::default();

        loop {
            let line_name = input
                .try_parse(parse_line_names)
                .ok()
                .unwrap_or_else(CustomIdentList::default);
            line_names.push(line_name);

            if let Some(track_size) = input.try_parse(TrackSize::parse).ok() {
                // TODO: error handling
                // TODO(port): Zig original omits arena arg here (`items.append(.{...})`); mirroring with input.arena()
                items.push(TrackListItem::TrackSize(track_size));
            } else if let Some(repeat) = input.try_parse(TrackRepeat::parse).ok() {
                // TODO: error handling
                items.push(TrackListItem::TrackRepeat(repeat));
            } else {
                break;
            }
        }

        if items.is_empty() {
            return Err(input.new_custom_error(css::ParserError::invalid_declaration));
        }

        Ok(TrackList { line_names, items })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let mut items_index = 0;
        let mut first = true;

        for names in self.line_names.slice_const() {
            if !names.is_empty() {
                serialize_line_names(names.slice(), dest)?;
            }

            if items_index < self.items.len() {
                let item = self.items.at(items_index as usize);
                items_index += 1;

                // Whitespace is required if there are no line names.
                if !names.is_empty() {
                    dest.whitespace()?;
                } else if !first {
                    dest.write_char(b' ')?;
                }

                match item {
                    TrackListItem::TrackRepeat(repeat) => repeat.to_css(dest)?,
                    TrackListItem::TrackSize(size) => size.to_css(dest)?,
                }
            }

            first = false;
        }
        Ok(())
    }
}

/// Either a track size or `repeat()` function.
///
/// See [TrackList](TrackList).
pub enum TrackListItem {
    /// A track size.
    TrackSize(TrackSize),
    /// A `repeat()` function.
    TrackRepeat(TrackRepeat),
}

/// A [track size](https://drafts.csswg.org/css-grid-2/#typedef-track-size) value.
///
/// See [TrackList](TrackList).
#[derive(PartialEq)]
pub enum TrackSize {
    /// An explicit track breadth.
    TrackBreadth(TrackBreadth),
    /// The `minmax()` function.
    MinMax {
        /// The minimum value.
        min: TrackBreadth,
        /// The maximum value.
        max: TrackBreadth,
    },
    /// The `fit-content()` function.
    FitContent(LengthPercentage),
}

impl Default for TrackSize {
    fn default() -> Self {
        TrackSize::TrackBreadth(TrackBreadth::Auto)
    }
}

impl TrackSize {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        if let Some(breadth) = input.try_parse(TrackBreadth::parse).ok() {
            return Ok(TrackSize::TrackBreadth(breadth));
        }

        if input
            .try_parse(|i| i.expect_function_matching(b"minmax"))
            .is_ok()
        {
            return input.parse_nested_block(|i: &mut Parser| -> css::Result<TrackSize> {
                let min = TrackBreadth::parse_internal(i, false)?;
                i.expect_comma()?;
                let max = TrackBreadth::parse(i)?;
                Ok(TrackSize::MinMax { min, max })
            });
        }

        input.expect_function_matching(b"fit-content")?;

        // TODO(port): css.voidWrap(LengthPercentage, LengthPercentage.parse) — wraps a parse fn for parseNestedBlock; using a closure directly
        let len = input.parse_nested_block(|i: &mut Parser| LengthPercentage::parse(i))?;

        Ok(TrackSize::FitContent(len))
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            TrackSize::TrackBreadth(breadth) => breadth.to_css(dest),
            TrackSize::MinMax { min, max } => {
                dest.write_str("minmax(")?;
                min.to_css(dest)?;
                dest.delim(b',', false)?;
                max.to_css(dest)?;
                dest.write_char(b')')
            }
            TrackSize::FitContent(len) => {
                dest.write_str("fit-content(")?;
                len.to_css(dest)?;
                dest.write_char(b')')
            }
        }
    }
}

#[derive(Default)]
pub struct TrackSizeList {
    pub v: SmallList<TrackSize, 1>,
}

impl TrackSizeList {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        let mut res = SmallList::<TrackSize, 1>::default();
        while let Some(size) = input.try_parse(TrackSize::parse).ok() {
            res.append(size);
        }

        if res.len() == 1 && *res.at(0) == TrackSize::default() {
            res.clear_retaining_capacity();
        }

        Ok(TrackSizeList { v: res })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        if self.v.len() == 0 {
            dest.write_str("auto")?;
            return Ok(());
        }

        dest.write_separated(
            self.v.slice(),
            |d| d.write_char(b' '),
            |d, item| item.to_css(d),
        )
    }
}

/// A [track breadth](https://drafts.csswg.org/css-grid-2/#typedef-track-breadth) value.
///
/// See [TrackSize](TrackSize).
#[derive(PartialEq)]
pub enum TrackBreadth {
    /// An explicit length.
    Length(LengthPercentage),
    /// A flex factor.
    Flex(CSSNumber),
    /// The `min-content` keyword.
    MinContent,
    /// The `max-content` keyword.
    MaxContent,
    /// The `auto` keyword.
    Auto,
}

impl TrackBreadth {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        TrackBreadth::parse_internal(input, true)
    }

    fn parse_internal(input: &mut Parser, allow_flex: bool) -> css::Result<Self> {
        if let Some(len) = input.try_parse(LengthPercentage::parse).ok() {
            return Ok(TrackBreadth::Length(len));
        }

        if allow_flex {
            if let Some(flex) = input.try_parse(TrackBreadth::parse_flex).ok() {
                return Ok(TrackBreadth::Flex(flex));
            }
        }

        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;

        if strings::eql_case_insensitive_ascii(ident, b"auto", true) {
            return Ok(TrackBreadth::Auto);
        } else if strings::eql_case_insensitive_ascii(ident, b"min-content", true) {
            return Ok(TrackBreadth::MinContent);
        } else if strings::eql_case_insensitive_ascii(ident, b"max-content", true) {
            return Ok(TrackBreadth::MaxContent);
        }

        Err(location.new_unexpected_token_error(css::Token::Ident(ident)))
    }

    fn parse_flex(input: &mut Parser) -> css::Result<CSSNumber> {
        let location = input.current_source_location();
        let token = input.next()?;

        if let css::Token::Dimension(d) = &token {
            if strings::eql_case_insensitive_ascii(d.unit, b"fr", true) && d.num.value >= 0.0 {
                return Ok(d.num.value);
            }
        }

        Err(location.new_unexpected_token_error(token.clone()))
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            TrackBreadth::Auto => dest.write_str("auto"),
            TrackBreadth::MinContent => dest.write_str("min-content"),
            TrackBreadth::MaxContent => dest.write_str("max-content"),
            TrackBreadth::Length(len) => len.to_css(dest),
            // .flex => |flex| try css.CSSNumberFns.serializeDimension(&flex, "fr", dest),
            TrackBreadth::Flex(flex) => css::serializer::serialize_dimension(*flex, b"fr", dest),
        }
    }
}

/// A `repeat()` function.
///
/// See [TrackList](TrackList).
pub struct TrackRepeat {
    /// The repeat count.
    pub count: RepeatCount,
    /// The line names to repeat.
    pub line_names: Vec<CustomIdentList>,
    /// The track sizes to repeat.
    pub track_sizes: Vec<TrackSize>,
}

impl TrackRepeat {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        input.expect_function_matching(b"repeat")?;

        input.parse_nested_block(|i: &mut Parser| -> css::Result<TrackRepeat> {
            // TODO(port): Zig uses `@call(.auto, @field(RepeatCount, "parse"), .{i})` — direct call here
            let count = RepeatCount::parse(i)?;

            i.expect_comma()?;

            // TODO: this code will not compile if used
            // TODO(port): Zig calls `bun.Vec(T).init(i.arena)` — using default + push(alloc, ..) here
            let mut line_names = Vec::<CustomIdentList>::default();
            let mut track_sizes = Vec::<TrackSize>::default();

            loop {
                let line_name = i
                    .try_parse(parse_line_names)
                    .unwrap_or_else(|_| CustomIdentList::default());
                line_names.push(line_name);

                // TODO(port): Zig original references outer `input` here (likely a bug); mirroring with `i`
                if let Some(track_size) = i.try_parse(TrackSize::parse).ok() {
                    // TODO: error handling
                    track_sizes.push(track_size);
                } else {
                    break;
                }
            }

            Ok(TrackRepeat {
                count,
                line_names,
                track_sizes,
            })
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_str("repeat(")?;
        self.count.to_css(dest)?;
        dest.delim(b',', false)?;

        let mut track_sizes_index = 0;
        let mut first = true;
        for names in self.line_names.slice_const() {
            if !names.is_empty() {
                serialize_line_names(names.slice(), dest)?;
            }

            if track_sizes_index < self.track_sizes.len() {
                let size = self.track_sizes.at(track_sizes_index as usize);
                track_sizes_index += 1;

                if !names.is_empty() {
                    dest.whitespace()?;
                } else if !first {
                    dest.write_char(b' ')?;
                }
                size.to_css(dest)?;
            }

            first = false;
        }

        dest.write_char(b')')
    }
}

fn serialize_line_names(names: &[CustomIdent], dest: &mut Printer) -> Result<(), PrintErr> {
    dest.write_char(b'[')?;
    dest.write_separated(
        names,
        |d| d.write_char(b' '),
        |d, name| {
            // SAFETY: arena-owned slice valid for 'bump.
            write_ident(unsafe { crate::arena_str(name.v) }, d)
        },
    )?;
    dest.write_char(b']')
}

fn write_ident<'a>(name: &'a [u8], dest: &mut Printer<'a>) -> Result<(), PrintErr> {
    let css_module_grid_enabled = if let Some(css_module) = &dest.css_module {
        css_module.config.grid
    } else {
        false
    };
    if css_module_grid_enabled {
        if let Some(css_module) = &dest.css_module {
            if let Some(last) = css_module.config.pattern.segments.last() {
                if !matches!(last, css::css_modules::Segment::Local) {
                    return Err(dest.add_invalid_css_modules_pattern_in_grid_error());
                }
            }
        }
    }

    dest.write_ident(name, css_module_grid_enabled)
}

fn parse_line_names(input: &mut Parser) -> css::Result<CustomIdentList> {
    input.expect_square_bracket_block()?;

    input.parse_nested_block(|i: &mut Parser| -> css::Result<CustomIdentList> {
        let mut values = CustomIdentList::default();

        // TODO(port): Zig original references outer `input` here (likely a bug); mirroring with `i`
        while let Some(ident) = i.try_parse(CustomIdent::parse).ok() {
            values.append(ident);
        }

        Ok(values)
    })
}

/// A [`<repeat-count>`](https://drafts.csswg.org/css-grid-2/#typedef-track-repeat) value,
/// used in the `repeat()` function.
///
/// See [TrackRepeat](TrackRepeat).
// TODO(port): css.DeriveParse / css.DeriveToCss → #[derive(Parse, ToCss)] proc-macro
#[derive(PartialEq)]
pub enum RepeatCount {
    /// The number of times to repeat.
    Number(CSSInteger),
    /// The `auto-fill` keyword.
    AutoFill,
    /// The `auto-fit` keyword.
    AutoFit,
}

impl RepeatCount {
    // PORT NOTE: `css.DeriveParse(@This()).parse` — hand-expanded in declaration
    // order (Number → keyword `auto-fill` → keyword `auto-fit`).
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        if let Ok(n) = input.try_parse(CSSIntegerFns::parse) {
            return Ok(RepeatCount::Number(n));
        }
        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;
        if strings::eql_case_insensitive_ascii(ident, b"auto-fill", true) {
            return Ok(RepeatCount::AutoFill);
        }
        if strings::eql_case_insensitive_ascii(ident, b"auto-fit", true) {
            return Ok(RepeatCount::AutoFit);
        }
        Err(location.new_unexpected_token_error(css::Token::Ident(ident)))
    }

    // PORT NOTE: `css.DeriveToCss(@This()).toCss` — hand-expanded.
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            RepeatCount::Number(n) => CSSIntegerFns::to_css(n, dest),
            RepeatCount::AutoFill => dest.write_str("auto-fill"),
            RepeatCount::AutoFit => dest.write_str("auto-fit"),
        }
    }
}

/// A grid template areas value.
/// See https://drafts.csswg.org/css-grid-2/#propdef-grid-template-areas
pub enum GridTemplateAreas {
    /// No named grid areas.
    None,
    /// Defines the list of named grid areas.
    Areas {
        /// The number of columns in the grid.
        columns: u32,
        /// A flattened list of grid area names.
        /// Unnamed areas specified by the `.` token are represented as null.
        // TODO(port): arena-owned slice lifetime — Zig `?[]const u8` in CSS arena
        areas: SmallList<Option<*const [u8]>, 1>,
    },
}

impl GridTemplateAreas {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        if input
            .try_parse(|i: &mut Parser| i.expect_ident_matching(b"none"))
            .is_ok()
        {
            return Ok(GridTemplateAreas::None);
        }

        let mut tokens = SmallList::<Option<*const [u8]>, 1>::default();
        let mut row: u32 = 0;
        let mut columns: u32 = 0;

        // PORT NOTE: `expect_string` returns a slice borrowing `&mut self`, which
        // `try_parse`'s `R` type param can't carry. Erase the lifetime through a
        // raw pointer inside the closure; the slice lives in the input arena and
        // outlives this parse.
        if let Some(s) = input
            .try_parse(|i| i.expect_string().map(|s| std::ptr::from_ref::<[u8]>(s)))
            .ok()
        {
            let s = unsafe { crate::arena_str(s) };
            let parsed_columns = match Self::parse_string(input.arena(), s, &mut tokens) {
                Ok(v) => v,
                Err(()) => {
                    // TODO(port): Zig uses `.{input.newError(.qualified_rule_invalid)}` — anonymous struct shorthand; mapping to Err(..)
                    return Err(input.new_error(css::BasicParseErrorKind::qualified_rule_invalid));
                }
            };

            if row == 0 {
                columns = parsed_columns;
            } else if parsed_columns != columns {
                return Err(input.new_custom_error(css::ParserError::invalid_declaration));
            }

            row += 1;
        }

        Ok(GridTemplateAreas::Areas {
            columns,
            areas: tokens,
        })
    }

    const HTML_SPACE_CHARACTERS: &[u8] = &[0x0020, 0x0009, 0x000a, 0x000c, 0x000d];

    fn parse_string<'bump>(
        bump: &'bump bun_alloc::Arena,
        s: &[u8],
        tokens: &mut SmallList<Option<*const [u8]>, 1>,
    ) -> Result<u32, ()> {
        let mut string = s;
        let mut column: u32 = 0;

        loop {
            let rest = strings::trim(string, Self::HTML_SPACE_CHARACTERS);
            if rest.is_empty() {
                // Each string must produce a valid token.
                if column == 0 {
                    return Err(());
                }
                break;
            }

            column += 1;

            if strings::starts_with_char(rest, b'.') {
                let idx = 'idx: {
                    for (i, c) in rest.iter().enumerate() {
                        if *c != b'.' {
                            break 'idx i;
                        }
                    }
                    rest.len()
                };
                string = &rest[idx..];
                // TODO(port): Zig original falls through here without `continue` — likely a bug (the `.` token
                // is supposed to push None and continue). Mirroring Zig control flow exactly.
            }

            let starts_with_name_codepoint = 'brk: {
                if rest.is_empty() {
                    break 'brk false;
                }
                is_name_codepoint(rest[0])
            };

            if !starts_with_name_codepoint {
                return Err(());
            }

            let token_len = 'token_len: {
                for (i, c) in rest.iter().enumerate() {
                    if !is_name_codepoint(*c) {
                        break 'token_len i;
                    }
                }
                rest.len()
            };
            let token = &rest[..token_len];
            // TODO(port): arena-owned slice — Zig stores borrowed slice into SmallList; using raw ptr here
            let _ = bump;
            tokens.append(Some(std::ptr::from_ref::<[u8]>(token)));
            string = &rest[token_len..];
        }

        Ok(column)
    }
}

fn is_name_codepoint(c: u8) -> bool {
    // alpha numeric, -, _, o
    (c >= b'a' && c <= b'z')
        || (c >= b'A' && c <= b'Z')
        || c == b'_'
        || (c >= b'0' && c <= b'9')
        || c == b'-'
        || c >= 0x80 // codepoints larger than ascii
}

crate::css_eql_partialeq!(TrackSize, RepeatCount);

// ported from: src/css/properties/grid.zig
