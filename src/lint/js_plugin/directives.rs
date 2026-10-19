//! The comments that configure ESLint, for its `getInlineConfigNodes` and `getDisableDirectives`.
//!
//! Six words for each: its index among the comments of the file, a number for its label, and where its value and its
//! justification start and end.

use super::wire;
use crate::ast::File;
use crate::linter::Label;
use bun_core::strings::Utf16OffsetTable;

/// src/jsc/bindings/LintSourceCode.cpp has the same numbers.
fn number_of(label: Label) -> u32 {
    match label {
        Label::Enable => 1,
        Label::Disable => 2,
        Label::DisableLine => 3,
        Label::DisableNextLine => 4,
        Label::Rules | Label::Env | Label::Exported | Label::Global => 0,
    }
}

pub(super) fn write<'a>(file: &'a File<'a>, offsets: &Utf16OffsetTable, out: &mut Vec<u8>) {
    let mut comments = file.comments().zip(0u32..).peekable();
    for it in file.config_comments() {
        // `// eslint-disable` and `oxlint-disable` mean nothing to ESLint.
        if it.is_only_of_oxlint || file.slice(it.label_span).starts_with(b"oxlint") {
            continue;
        }
        // Both are in the order of the file.
        while comments
            .next_if(|(comment, _)| comment.start() < it.span.start)
            .is_some()
        {}
        let Some(&(_, index)) = comments.peek() else {
            break;
        };
        let [value, justification] = [it.value, it.justification]
            .map(|span| [offsets.to_utf16(span.start), offsets.to_utf16(span.end)]);
        wire::words(
            out,
            &[
                index,
                number_of(it.label),
                value[0],
                value[1],
                justification[0],
                justification[1],
            ],
        );
    }
}
