//! Where micromark, which Prettier parses Markdown with, does not do what
//! CommonMark says, and what `bun format` prints for real documents depends on
//! it. Each is behind `Options::micromark`, which only the formatter sets. And
//! what Prettier makes of MDX, with remark-parse 8: `Options::mdx`.

use crate::types::Flags;

/// A complete tag on a line of its own does not end a paragraph. To micromark
/// it does if the line lacks the markers of the containers that the paragraph
/// is in, and the HTML is in those containers all the same.
///
/// ```markdown
/// - a
/// </b>
/// ```
pub(crate) fn complete_tag_ends_lazy_paragraph(flags: &Flags) -> bool {
    flags.micromark
}

/// Whether `*` and `_` can open or close emphasis depends on what is next to
/// them. To micromark, a run with another marker (`*`, `_`, `~`) behind it is
/// left-flanking, one with another marker before it right-flanking, whatever is
/// on the other side.
///
/// ```markdown
/// *https://www.example.com:80/*a**_
/// ```
pub(crate) fn marker_next_to_marker_flanks(flags: &Flags) -> bool {
    flags.micromark
}

/// micromark looks at UTF-16 code units: half of a surrogate pair is no
/// punctuation and no white space, whatever the character is.
///
/// ```markdown
/// 😀_a_
/// ```
pub(crate) fn astral_is_a_letter(flags: &Flags) -> bool {
    flags.micromark
}

/// Two blanks at the end of a line are a hard break. To micromark they are not
/// if there is a tab in the white space before them.
///
/// ```markdown
/// a→␠␠
/// b
/// ```
pub(crate) fn tab_before_the_blanks_is_no_hard_break(flags: &Flags) -> bool {
    flags.micromark
}

/// An empty list item and an ordered list that does not start with 1 cannot
/// interrupt a paragraph. To micromark they cannot follow indented code
/// either, with or without empty lines between, and on a line that interrupts
/// one of the two no container in the first one can be such a list.
///
/// ```markdown
///     a
///
/// 2. b
///
/// c
/// - +
/// ```
pub(crate) fn what_interrupts_does_so_for_the_whole_line(flags: &Flags) -> bool {
    flags.micromark
}

/// The last line of a paragraph is the header of a table if a delimiter row
/// follows it. To micromark it is not if it is indented by four columns.
///
/// ```markdown
/// a
///     b | c
/// - | -
/// ```
pub(crate) fn indented_line_is_no_table_header(flags: &Flags) -> bool {
    flags.micromark
}

/// remark-parse 8 with the option `blocks` as Prettier sets it: a line that
/// starts with any tag, whatever its name, with dots in it or without one,
/// starts HTML, also in a paragraph.
///
/// ```markdown
/// a
/// <B.c d="e"
/// ```
pub(crate) fn every_tag_starts_html(flags: &Flags) -> bool {
    flags.mdx
}

/// remark-parse 8: a line with nothing but blanks on it does not end HTML.
pub(crate) fn only_a_line_without_blanks_ends_html(flags: &Flags) -> bool {
    flags.mdx
}
