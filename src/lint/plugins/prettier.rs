//! What `prettier/prettier` and `bun/format` share: all but whose text is wanted.
//!
//! The reports are those of eslint-plugin-prettier 5.5.6, which cuts the difference between the
//! file and the formatted text with `generateDifferences()` of prettier-linter-helpers 1.0.1.

use bun_core::strings;
use bun_lint::formats::{Formatted, Like, Reason, Request};
use bun_lint::prelude::*;
use bun_text_diff::{CharDiff, Hunk};

const INSERT: Message = Message::new("insert", "Insert `{{ insertText }}`");
const DELETE: Message = Message::new("delete", "Delete `{{ deleteText }}`");
const REPLACE: Message = Message::new(
    "replace",
    "Replace `{{ deleteText }}` with `{{ insertText }}`",
);

/// `showInvisibles()`
fn show_invisibles(shown: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(shown.len() * 2);
    for &byte in shown {
        match byte {
            b' ' => out.extend_from_slice("\u{B7}".as_bytes()),
            b'\n' => out.extend_from_slice("\u{23CE}".as_bytes()),
            b'\t' => out.extend_from_slice("\u{21B9}".as_bytes()),
            b'\r' => out.extend_from_slice("\u{240D}".as_bytes()),
            _ => out.push(byte),
        }
    }
    out
}

/// The code units of UTF-16 that `bytes` are in JavaScript, and for each where in `bytes` its
/// character starts. Then the end.
fn code_units(bytes: &[u8]) -> (Vec<u16>, Vec<usize>) {
    let mut units = Vec::with_capacity(bytes.len());
    let mut starts = Vec::with_capacity(bytes.len() + 1);
    for (at, c) in strings::wtf8_codepoints(bytes) {
        match c.checked_sub(0x10000) {
            Some(c) => {
                units.extend([0xD800 | (c >> 10) as u16, 0xDC00 | (c & 0x3FF) as u16]);
                starts.extend([at, at]);
            }
            None => {
                units.push(c as u16);
                starts.push(at);
            }
        }
    }
    starts.push(bytes.len());
    (units, starts)
}

/// `generateDifferences()`: what of `source` is to be replaced with what of `formatted`, in bytes.
fn differences(source: &[u8], formatted: &[u8]) -> Vec<Hunk> {
    let mut differ = CharDiff::default();
    let is_ascii = |it: &[u8]| strings::first_non_ascii(it).is_none();
    let mut hunks = if is_ascii(source) && is_ascii(formatted) {
        differ.diff_as_fast_diff(source, formatted).to_vec()
    } else {
        let ((a, a_starts), (b, b_starts)) = (code_units(source), code_units(formatted));
        let byte_of = |starts: &[usize], unit: usize| starts.get(unit).copied().unwrap_or_default();
        let units = differ.diff_as_fast_diff(&a, &b).iter();
        let in_bytes = units.map(|it| Hunk {
            a_lo: byte_of(&a_starts, it.a_lo),
            a_hi: byte_of(&a_starts, it.a_hi),
            b_lo: byte_of(&b_starts, it.b_lo),
            b_hi: byte_of(&b_starts, it.b_hi),
        });
        in_bytes.collect()
    };
    // What two of them have between them is replaced with them, unless a line ends there.
    hunks.dedup_by(|next, last| {
        let between = source.get(last.a_hi..next.a_lo);
        let joins = between.is_some_and(|it| !strings::contains_js_line_break(it));
        if joins {
            (last.a_hi, last.b_hi) = (next.a_hi, next.b_hi);
        }
        joins
    });
    hunks
}

/// The options of either rule.
pub(crate) struct Settings {
    options: Option<Json>,
    uses_configuration: bool,
    file_info_options: Option<Json>,
}

impl Settings {
    pub(crate) fn new(options: &Options) -> Self {
        let second = options.object(1);
        Settings {
            options: options.get(0).cloned(),
            uses_configuration: second.bool_or("usePrettierrc", true),
            file_info_options: second.get("fileInfoOptions").cloned(),
        }
    }

    /// The formatted text of `source`, which is all of `file`, and where the two differ.
    fn compare(&self, like: Like, file: &File, source: &[u8]) -> Option<(Vec<u8>, Vec<Hunk>)> {
        let formatted = match file.formatter() {
            Some(formatter) => formatter.formats.formatted(&Request {
                like,
                path_on_disk: formatter.path_on_disk,
                path: file.path(),
                text: source,
                options: self.options.as_ref(),
                uses_configuration: self.uses_configuration,
                file_info_options: self.file_info_options.as_ref(),
            }),
            None => Formatted::NotNative(Reason::NoFormatter),
        };
        match formatted {
            Formatted::Text(formatted) => {
                let hunks = differences(source, &formatted);
                Some((formatted, hunks))
            }
            Formatted::NotNative(reason) => {
                // `bun/format` stands in for nothing.
                if like == Like::InstalledPrettier {
                    file.hand_back(reason);
                }
                None
            }
            Formatted::Same | Formatted::Skipped => None,
        }
    }

    pub(crate) fn check<R: Rule>(&self, like: Like, cx: &Cx<'_, R>) {
        let file = cx.file();
        // ESLint's text is without the byte order mark.
        let skipped = if file.has_bom() { 3 } else { 0 };
        let source = file.text().get(skipped..).unwrap_or_default();
        let Some((formatted, hunks)) = self.compare(like, file, source) else {
            return;
        };
        for it in hunks {
            let deleted = source.get(it.a_lo..it.a_hi).unwrap_or_default();
            let inserted = formatted.get(it.b_lo..it.b_hi).unwrap_or_default();
            let span = Span::new((skipped + it.a_lo) as u32, (skipped + it.a_hi) as u32);
            let message = match (deleted, inserted) {
                ([], _) => INSERT,
                (_, []) => DELETE,
                _ => REPLACE,
            };
            cx.report(span, message)
                .data("deleteText", show_invisibles(deleted))
                .data("insertText", show_invisibles(inserted))
                .fix(|fixer| fixer.replace(span, inserted));
        }
    }
}
