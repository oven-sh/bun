use crate::prelude::*;
use crate::write;

/// The elements of an array literal or an array pattern, each on its own line if they do not fit on
/// one. `None` is a hole, which is written as the comma after it.
///
/// `len`: the number of elements, including a rest element that the caller writes afterwards.
pub(crate) fn write_array_node<'a, N: Format<'a> + Spanned>(
    len: usize,
    array: impl IntoIterator<Item = Option<N>>,
    f: &mut Formatter<'a>,
) {
    let last_index = len.saturating_sub(1);
    let source_text = f.source_text();
    let mut join = f.join_nodes_with_soft_line();
    let mut has_seen_elision = false;
    let mut array_iter = array.into_iter().enumerate().peekable();

    while let Some((index, element)) = array_iter.next() {
        // After a hole, no empty line is kept.
        let span = match &element {
            _ if has_seen_elision => Span::empty(0),
            Some(element) => element.span(),
            // The comma.
            None => {
                let next_start = array_iter.peek().and_then(|(_, next)| next.as_ref()).map_or(0, |next| next.span().start);
                bun_core::strings::last_index_of_char(source_text.slice_range(0, next_start), b',')
                    .map_or(Span::empty(0), |comma| Span::new(comma as u32, comma as u32 + 1))
            }
        };
        has_seen_elision = has_seen_elision || element.is_none();
        join.entry(
            span,
            &format_with(|f| match &element {
                Some(element) => {
                    write!(f, group(element));
                    match index != last_index {
                        true => write!(f, ","),
                        false => write!(f, FormatTrailingCommas::ES5),
                    }
                }
                None => write!(f, ","),
            }),
        );
    }
}
