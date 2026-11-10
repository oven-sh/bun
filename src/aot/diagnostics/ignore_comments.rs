use std::mem::take;

use bun_ast::{Kind, Msg};
use bun_core::strings;
use bun_sema::check::aot::FileOrigin;
use bun_sema::hir::IGNORE_COMMENT_MARKER;
use bun_sema::program::FileId;

use super::{Diagnostic, Diagnostics, Entry, ProgramView, Span};
use crate::diagnostic_codes::Code;

pub(super) struct IgnoreComment {
    file: Vec<u8>,
    line: i64,
    codes: Vec<IgnoredCode>,
}

struct IgnoredCode {
    number: u32,
    has_silenced: bool,
    complaint: Option<Msg>,
}

#[derive(Copy, Clone)]
pub(crate) struct IgnoreCommentOptions {
    pub(crate) should_report_stale: bool,
    pub(crate) should_list_silenced: bool,
}

fn can_be_silenced(number: u32) -> bool {
    (100_000..=100_999).contains(&number) && number != Code::IgnoreCommentSilencesNothing.number()
}

fn text_after_marker(text: &[u8], (marker, end): (u32, u32)) -> Option<&[u8]> {
    let comment = text.get(marker as usize..end as usize)?;
    let rest = comment.strip_prefix(IGNORE_COMMENT_MARKER)?;
    let rest = rest.strip_suffix(b"*/").unwrap_or(rest);
    rest.first()
        .is_none_or(u8::is_ascii_whitespace)
        .then_some(rest)
}

fn is_blank(text: &[u8]) -> bool {
    text.iter().all(u8::is_ascii_whitespace)
}

fn count_lines_to_silenced(text: &[u8], (marker, end): (u32, u32)) -> i64 {
    let (before, after) = (&text[..marker as usize], &text[end as usize..]);
    let line_start = strings::last_index_of_char(before, b'\n').map_or(0, |at| at + 1);
    let opening = before[line_start..].trim_ascii();
    let mut lines = strings::split(after, b"\n");
    let rest_of_line = lines.next().unwrap_or_default();
    if !opening.iter().all(|byte| matches!(byte, b'/' | b'*')) || !is_blank(rest_of_line) {
        return 0;
    }
    let skipped =
        lines.take_while(|line| is_blank(line) || line.trim_ascii_start().starts_with(b"//"));
    1 + skipped.count() as i64
}

fn parse_codes(written: &[u8]) -> Vec<u32> {
    let words = written
        .split(|&byte| byte.is_ascii_whitespace() || byte == b',')
        .filter(|word| !word.is_empty());
    words
        .map_while(|word| {
            std::str::from_utf8(word.strip_prefix(b"TS")?)
                .ok()?
                .parse()
                .ok()
        })
        .collect()
}

fn is_edited_by_user(origin: FileOrigin) -> bool {
    matches!(
        origin,
        FileOrigin::ProgramSource | FileOrigin::TestedSource | FileOrigin::ProgramJavaScript
    )
}

impl Diagnostics {
    pub(crate) fn read_ignore_comments(
        &mut self,
        view: ProgramView<'_, '_>,
        options: IgnoreCommentOptions,
    ) {
        self.should_list_silenced = options.should_list_silenced;
        let files = view.files();
        for &file in files.compiled_files() {
            let hir = files.hir(file);
            for &comment in hir.ignore_comments.iter() {
                if let Some(written) = text_after_marker(&hir.text[..], comment) {
                    self.read_ignore_comment(view, file, comment, written, options);
                }
            }
        }
    }

    fn read_ignore_comment(
        &mut self,
        view: ProgramView<'_, '_>,
        file: FileId,
        comment: (u32, u32),
        written: &[u8],
        options: IgnoreCommentOptions,
    ) {
        let complain = |reason: &[u8]| {
            let (start, end) = comment;
            let span = Some(Span { file, start, end });
            let code = Code::IgnoreCommentSilencesNothing;
            Diagnostics::render(view, Diagnostic::new(code, span, &[reason]))
        };
        let can_complain = is_edited_by_user(view.origin(file));
        let numbers = parse_codes(written);
        if numbers.is_empty() {
            const REASON: &[u8] =
                b"it names no warning. Write the codes after it, as in // bun-ignore TS100064";
            if let Some(message) = complain(REASON).filter(|_| can_complain) {
                self.add_message(Code::IgnoreCommentSilencesNothing.number(), message);
            }
            return;
        }
        let Some(location) = complain(b"").and_then(|it| it.data.location) else {
            return;
        };
        let lines_between = count_lines_to_silenced(&view.files().hir(file).text[..], comment);
        let codes = numbers.into_iter().map(|number| {
            let reason = if can_be_silenced(number) {
                options.should_report_stale.then(|| {
                    format!("the build reports no TS{number} on the line that it applies to")
                })
            } else {
                Some(format!(
                    "TS{number} isn't one of the compiler's own warnings, which are TS100000 to TS100999"
                ))
            };
            IgnoredCode {
                number,
                has_silenced: false,
                complaint: reason
                    .filter(|_| can_complain)
                    .and_then(|reason| complain(reason.as_bytes())),
            }
        });
        self.ignore_comments.push(IgnoreComment {
            file: location.file.to_vec(),
            line: i64::from(location.line) + lines_between,
            codes: codes.collect(),
        });
    }

    pub(super) fn apply_ignore_comments(&mut self) {
        let mut comments = take(&mut self.ignore_comments);
        if comments.is_empty() {
            return;
        }
        let should_list_silenced = self.should_list_silenced;
        for entry in take(&mut self.entries) {
            let (_, file, line, _, number, _) = &entry.key;
            let is_quiet_kind = matches!(entry.message.kind, Kind::Warn | Kind::Note);
            let mut is_silenced = false;
            if is_quiet_kind && can_be_silenced(*number) {
                let here = comments
                    .iter_mut()
                    .filter(|it| it.line == *line && it.file == *file);
                for code in here.flat_map(|it| it.codes.iter_mut()) {
                    if code.number == *number {
                        (code.has_silenced, is_silenced) = (true, true);
                    }
                }
            }
            if !is_silenced {
                self.entries.push(entry);
            } else if should_list_silenced {
                let (number, mut message) = (*number, entry.message);
                message.kind = Kind::Note;
                let mut text = b"Silenced by bun-ignore: ".to_vec();
                text.extend_from_slice(&message.data.text);
                message.data.text = text.into();
                self.entries.push(Entry::new(number, message));
            }
        }
        let codes = comments.into_iter().flat_map(|it| it.codes);
        for complaint in codes.filter_map(|it| it.complaint.filter(|_| !it.has_silenced)) {
            self.add_message(Code::IgnoreCommentSilencesNothing.number(), complaint);
        }
    }
}
