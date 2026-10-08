use crate::prelude::*;
use crate::text::{is_next_line_empty, skip_inline_comment, skip_trailing_comment};
use crate::write;

/// Prettier's `printArrayElements`: the elements of an array literal or an array pattern, each on
/// its own line if they do not fit on one. `None` is a hole, which is written as the comma after it.
///
/// `len`: the number of elements, including a rest element that the caller writes afterwards. The
/// line break before that is written here.
pub(crate) fn write_array_node<'a, N: Format<'a> + Spanned>(
    len: usize,
    array: impl IntoIterator<Item = Option<N>>,
    f: &mut Formatter<'a>,
) {
    let last_index = len.saturating_sub(1);
    for (index, element) in array.into_iter().enumerate() {
        match &element {
            Some(element) => {
                write!(f, group(element));
                match index != last_index {
                    true => write!(f, ","),
                    false => write!(f, FormatTrailingCommas::ES5),
                }
            }
            None => write!(f, ","),
        }
        if index != last_index {
            // An empty line after an element is kept if the array breaks.
            let text = f.source_text().as_bytes();
            match element
                .is_some_and(|it| is_line_after_element_empty(text, it.span().end as usize))
            {
                true => write!(f, soft_empty_line_or_space()),
                false => write!(f, soft_line_break_or_space()),
            }
        }
    }
}

/// Prettier's `isLineAfterElementEmpty`: the line after the comma that follows the element that ends
/// at `end` is empty.
pub(crate) fn is_line_after_element_empty(text: &[u8], end: usize) -> bool {
    let mut at = end;
    while text.get(at).is_some_and(|b| *b != b',') {
        at = skip_inline_comment(text, skip_trailing_comment(text, at + 1));
    }
    is_next_line_empty(text, at)
}
