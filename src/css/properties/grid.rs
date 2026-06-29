use crate as css;
use crate::css_values::ident::{CustomIdent, CustomIdentList};
use crate::css_values::length::LengthPercentage;
use crate::css_values::number::{CSSInteger, CSSIntegerFns, CSSNumber};
use crate::{Parser, PrintErr, Printer, SmallList};

use bun_collections::VecExt;
use bun_core::strings;

/// A [track sizing](https://drafts.csswg.org/css-grid-2/#track-sizing) value
/// for the `grid-template-rows` and `grid-template-columns` properties.
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
            let line_name = input.try_parse(parse_line_names).ok().unwrap_or_default();
            line_names.push(line_name);

            if let Ok(track_size) = input.try_parse(TrackSize::parse) {
                // TODO: error handling
                items.push(TrackListItem::TrackSize(track_size));
            } else if let Ok(repeat) = input.try_parse(TrackRepeat::parse) {
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
                let item = self.items.at(items_index);
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
        if let Ok(breadth) = input.try_parse(TrackBreadth::parse) {
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
        while let Ok(size) = input.try_parse(TrackSize::parse) {
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
        if let Ok(len) = input.try_parse(LengthPercentage::parse) {
            return Ok(TrackBreadth::Length(len));
        }

        if allow_flex {
            if let Ok(flex) = input.try_parse(TrackBreadth::parse_flex) {
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
            let count = RepeatCount::parse(i)?;

            i.expect_comma()?;

            let mut line_names = Vec::<CustomIdentList>::default();
            let mut track_sizes = Vec::<TrackSize>::default();

            loop {
                let line_name = i
                    .try_parse(parse_line_names)
                    .unwrap_or_else(|_| CustomIdentList::default());
                line_names.push(line_name);

                // Use the nested parser `i`, not the outer `input`.
                if let Ok(track_size) = i.try_parse(TrackSize::parse) {
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
                let size = self.track_sizes.at(track_sizes_index);
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

        // Use the nested parser `i`, not the outer `input`.
        while let Ok(ident) = i.try_parse(CustomIdent::parse) {
            values.append(ident);
        }

        Ok(values)
    })
}

/// A [`<repeat-count>`](https://drafts.csswg.org/css-grid-2/#typedef-track-repeat) value,
/// used in the `repeat()` function.
///
/// See [TrackRepeat](TrackRepeat).
#[derive(PartialEq, Eq)]
pub enum RepeatCount {
    /// The number of times to repeat.
    Number(CSSInteger),
    /// The `auto-fill` keyword.
    AutoFill,
    /// The `auto-fit` keyword.
    AutoFit,
}

impl RepeatCount {
    // Variants tried in declaration order (Number → keyword `auto-fill` →
    // keyword `auto-fit`).
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

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            RepeatCount::Number(n) => CSSIntegerFns::to_css(*n, dest),
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
        // TODO: arena-owned slice lifetime — should be `Option<&'bump [u8]>`
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

        // `expect_string` returns a slice borrowing `&mut self`, which
        // `try_parse`'s `R` type param can't carry. Erase the lifetime through a
        // raw pointer inside the closure; the slice lives in the input arena and
        // outlives this parse.
        //
        // NOTE: only one row string is consumed (`if let`, not `while let` as
        // upstream); must become a loop when this is wired into the typed
        // property table.
        if let Ok(s) = input.try_parse(|i| i.expect_string().map(std::ptr::from_ref::<[u8]>)) {
            // SAFETY: `s` points to a slice returned by `expect_string`, which is backed by the
            // parser's input arena and remains valid for the duration of this parse.
            let s = unsafe { crate::arena_str(s) };
            let parsed_columns = match Self::parse_string(input.arena(), s, &mut tokens) {
                Ok(v) => v,
                Err(()) => {
                    return Err(input.new_error(css::BasicParseErrorKind::qualified_rule_invalid));
                }
            };

            if row == 0 {
                columns = parsed_columns;
            } else if parsed_columns != columns {
                return Err(input.new_custom_error(css::ParserError::invalid_declaration));
            }

            row += 1;
            // The final `row += 1` is dead on the last iteration but read on
            // the next; `unused_assignments` can't see that. Touch it.
            let _ = row;
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
                // A run of `.` characters is a single null-cell token (CSS Grid 2 §7.3).
                let idx = rest.iter().position(|&c| c != b'.').unwrap_or(rest.len());
                tokens.append(None);
                string = &rest[idx..];
                continue;
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
            // TODO: arena-owned slice — should store a borrowed slice into SmallList; using raw ptr here
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Parse one row string; cells are `None` for `.` null-cell tokens.
    fn parse_areas(s: &'static [u8]) -> Result<(u32, Vec<Option<&'static [u8]>>), ()> {
        let bump = bun_alloc::Arena::new();
        let mut tokens = SmallList::<Option<*const [u8]>, 1>::default();
        let columns = GridTemplateAreas::parse_string(&bump, s, &mut tokens)?;
        let cells = tokens
            .slice()
            .iter()
            .map(|t| {
                t.map(|p| {
                    // SAFETY: `p` is a subslice of the `'static` input `s`.
                    unsafe { &*p }
                })
            })
            .collect();
        Ok((columns, cells))
    }

    #[test]
    fn named_areas_only() {
        let (columns, cells) = parse_areas(b"a b c").unwrap();
        assert_eq!(columns, 3);
        assert_eq!(
            cells,
            vec![
                Some(b"a".as_slice()),
                Some(b"b".as_slice()),
                Some(b"c".as_slice())
            ]
        );
    }

    #[test]
    fn single_dot_null_cell() {
        let (columns, cells) = parse_areas(b"a . b").unwrap();
        assert_eq!(columns, 3);
        assert_eq!(
            cells,
            vec![Some(b"a".as_slice()), None, Some(b"b".as_slice())]
        );
    }

    #[test]
    fn multi_dot_run_is_one_null_cell() {
        let (columns, cells) = parse_areas(b"a ... b").unwrap();
        assert_eq!(columns, 3);
        assert_eq!(
            cells,
            vec![Some(b"a".as_slice()), None, Some(b"b".as_slice())]
        );
    }

    #[test]
    fn leading_and_trailing_null_cells() {
        let (columns, cells) = parse_areas(b". c .").unwrap();
        assert_eq!(columns, 3);
        assert_eq!(cells, vec![None, Some(b"c".as_slice()), None]);
    }

    #[test]
    fn all_null_cells() {
        let (columns, cells) = parse_areas(b".. ..").unwrap();
        assert_eq!(columns, 2);
        assert_eq!(cells, vec![None, None]);
    }

    #[test]
    fn dot_run_directly_followed_by_name() {
        // `..a` is a null cell followed by the named area `a`.
        let (columns, cells) = parse_areas(b"..a b").unwrap();
        assert_eq!(columns, 3);
        assert_eq!(
            cells,
            vec![None, Some(b"a".as_slice()), Some(b"b".as_slice())]
        );
    }

    #[test]
    fn empty_string_is_error() {
        assert_eq!(parse_areas(b""), Err(()));
        assert_eq!(parse_areas(b" \t\n"), Err(()));
    }

    #[test]
    fn invalid_codepoint_is_error() {
        assert_eq!(parse_areas(b"a !b"), Err(()));
    }
}
