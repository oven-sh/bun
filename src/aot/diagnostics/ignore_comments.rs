use std::mem::take;

use bun_ast::{Kind, Msg};
use bun_core::strings;
use bun_sema::check::aot::FileOrigin;
use bun_sema::hir::{IGNORE_COMMENT_MARKER, NodeData};
use bun_sema::import_sites::ImportSpecifier;
use bun_sema::program::FileId;

use super::{Diagnostic, Diagnostics, Entry, ProgramView, Span};
use crate::diagnostic_codes::Code;

pub(super) struct IgnoreComment {
    file: Vec<u8>,
    line: i64,
    silenced_code: Span,
    codes: Vec<IgnoredCode>,
}

struct IgnoredCode {
    number: u32,
    has_silenced: bool,
    has_met_error: bool,
    complaint: Option<Msg>,
    error_complaint: Option<Msg>,
}

#[derive(Copy, Clone)]
pub(crate) struct IgnoreCommentOptions {
    pub(crate) should_report_stale: bool,
    pub(crate) should_list_silenced: bool,
}

const COMPUTED_IMPORT_PATH: u32 = 100_064;

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

fn start_of_line(text: &[u8], at: usize) -> usize {
    let mut before = at;
    while let Some(found) = strings::last_index_of_any(&text[..before], b"\n\r\xE2") {
        match text[found..] {
            [0xE2, 0x80, 0xA8 | 0xA9, ..] => return found + 3,
            [0xE2, ..] => before = found,
            _ => return found + 1,
        }
    }
    0
}

fn end_of_line(text: &[u8], at: usize) -> usize {
    let mut end = at;
    while let Some(found) = strings::index_of_any(&text[end..], b"\n\r\xE2") {
        end += found;
        if !matches!(text[end..], [0xE2, ..]) || matches!(text[end..], [_, 0x80, 0xA8 | 0xA9, ..]) {
            return end;
        }
        end += 1;
    }
    text.len()
}

fn skip_line_terminator(text: &[u8], at: usize) -> usize {
    match text[at..] {
        [b'\r', b'\n', ..] => at + 2,
        [0xE2, ..] => at + 3,
        [_, ..] => at + 1,
        [] => at,
    }
}

fn find_silenced_code(text: &[u8], (marker, end): (u32, u32)) -> usize {
    let (marker, end) = (marker as usize, end as usize);
    let (line_start, line_end) = (start_of_line(text, marker), end_of_line(text, end));
    let skip_blanks = |from: usize, to: usize| to - text[from..to].trim_ascii_start().len();
    let opening = text[line_start..marker].trim_ascii();
    if !opening
        .iter()
        .all(|byte| matches!(byte, b'/' | b'*' | b'{'))
    {
        return skip_blanks(line_start, marker);
    }
    if !matches!(text[end..line_end].trim_ascii(), b"" | b"}") {
        return skip_blanks(end, line_end);
    }
    let mut line_end = line_end;
    while line_end < text.len() {
        let line_start = skip_line_terminator(text, line_end);
        line_end = end_of_line(text, line_start);
        let code = skip_blanks(line_start, line_end);
        if code < line_end && !text[code..].starts_with(b"//") {
            return code;
        }
    }
    text.len()
}

fn parse_codes(written: &[u8]) -> Vec<u32> {
    let mut codes = Vec::new();
    let words = written
        .split(|&byte| byte.is_ascii_whitespace() || matches!(byte, b',' | b';'))
        .filter(|word| !word.is_empty());
    for word in words {
        let Some(rest) = word.strip_prefix(b"TS") else {
            break;
        };
        let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
        let (number, tail) = rest.split_at(digits);
        let number = std::str::from_utf8(number)
            .ok()
            .and_then(|it| it.parse().ok());
        let Some(number) = number.filter(|_| !tail.first().is_some_and(u8::is_ascii_alphanumeric))
        else {
            break;
        };
        codes.push(number);
        if !tail.is_empty() {
            break;
        }
    }
    codes
}

fn is_edited_by_user(origin: FileOrigin) -> bool {
    matches!(
        origin,
        FileOrigin::ProgramSource | FileOrigin::TestedSource | FileOrigin::ProgramJavaScript
    )
}

fn silence(comments: &mut [IgnoreComment], entry: &Entry) -> bool {
    let (_, file, line, _, number, _) = &entry.key;
    if !can_be_silenced(*number) {
        return false;
    }
    let is_error = !matches!(entry.message.kind, Kind::Warn | Kind::Note);
    let here = comments
        .iter_mut()
        .filter(|it| it.line == *line && it.file == *file);
    let mut is_silenced = false;
    for code in here.flat_map(|it| it.codes.iter_mut()) {
        if code.number == *number {
            code.has_met_error |= is_error;
            code.has_silenced |= !is_error;
            is_silenced = !is_error;
        }
    }
    is_silenced
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
            if hir.ignore_comments.is_empty() {
                continue;
            }
            for &comment in hir.ignore_comments.iter() {
                if let Some(written) = text_after_marker(&hir.text[..], comment) {
                    self.read_ignore_comment(view, file, comment, written, options);
                }
            }
            let analysis = files.analysis(file);
            for site in analysis.import_sites {
                let Some(call) = site.kind.call().filter(|_| site.kind.loads_module()) else {
                    continue;
                };
                let mut written = analysis.alternatives_of(&site.specifier).iter();
                if written.any(|it| {
                    matches!(
                        it,
                        ImportSpecifier::Unknown | ImportSpecifier::Pattern { .. }
                    )
                }) {
                    let span = Span::of_node(hir, file, NodeData::Expr(call));
                    self.withhold(view, COMPUTED_IMPORT_PATH, span);
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
        let start = find_silenced_code(&view.files().hir(file).text[..], comment) as u32;
        let silenced_code = Span {
            file,
            start,
            end: start,
        };
        let code = Code::IgnoreCommentSilencesNothing;
        let there = Diagnostics::render(view, Diagnostic::new(code, Some(silenced_code), &[b""]));
        let Some(location) = there.and_then(|it| it.data.location) else {
            return;
        };
        let complain_if_edited =
            |reason: String| can_complain.then(|| complain(reason.as_bytes())).flatten();
        let codes = numbers.into_iter().map(|number| {
            let reason = if number == Code::IgnoreCommentSilencesNothing.number() {
                Some(format!("TS{number} can't be silenced"))
            } else if can_be_silenced(number) {
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
                has_met_error: false,
                complaint: reason.and_then(complain_if_edited),
                error_complaint: complain_if_edited(format!(
                    "TS{number} is an error here, and a comment can't silence an error"
                )),
            }
        });
        self.ignore_comments.push(IgnoreComment {
            file: location.file.to_vec(),
            line: i64::from(location.line),
            silenced_code,
            codes: codes.collect(),
        });
    }

    pub(crate) fn add_withheld(&mut self, view: ProgramView<'_, '_>, warning: &Diagnostic) {
        if let Some(span) = warning.span {
            self.withhold(view, warning.code.number(), span);
        }
    }

    fn withhold(&mut self, view: ProgramView<'_, '_>, number: u32, span: Span) {
        let located = Diagnostic::new(Code::IgnoreCommentSilencesNothing, Some(span), &[b""]);
        if let Some(message) = Diagnostics::render(view, located) {
            self.withheld.push(Entry::new(number, message));
        }
    }

    pub(crate) fn forgive_unasked_comments(&mut self, is_unasked: impl Fn(Span) -> bool) {
        for comment in &mut self.ignore_comments {
            if is_unasked(comment.silenced_code) {
                let codes = comment.codes.iter_mut();
                for code in codes.filter(|it| can_be_silenced(it.number)) {
                    code.complaint = None;
                }
            }
        }
    }

    pub(super) fn apply_ignore_comments(&mut self) {
        let mut comments = take(&mut self.ignore_comments);
        let withheld = take(&mut self.withheld);
        if comments.is_empty() {
            return;
        }
        for entry in &withheld {
            silence(&mut comments, entry);
        }
        let should_list_silenced = self.should_list_silenced;
        for entry in take(&mut self.entries) {
            if !silence(&mut comments, &entry) {
                self.entries.push(entry);
            } else if should_list_silenced {
                let (number, mut message) = (entry.key.4, entry.message);
                message.kind = Kind::Note;
                let mut text = b"Silenced by bun-ignore: ".to_vec();
                text.extend_from_slice(&message.data.text);
                message.data.text = text.into();
                self.entries.push(Entry::new(number, message));
            }
        }
        for code in comments.into_iter().flat_map(|it| it.codes) {
            let is_judged = self.has_run_to_end || !can_be_silenced(code.number);
            let complaint = match code {
                IgnoredCode {
                    has_met_error: true,
                    error_complaint,
                    ..
                } => error_complaint,
                IgnoredCode {
                    has_silenced: false,
                    complaint,
                    ..
                } if is_judged => complaint,
                _ => None,
            };
            if let Some(complaint) = complaint {
                self.add_message(Code::IgnoreCommentSilencesNothing.number(), complaint);
            }
        }
    }
}
