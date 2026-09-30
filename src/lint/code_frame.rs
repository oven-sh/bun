//! The terminal format: Bun's code frame, with the code in front of the message.

use core::fmt::Write;
use std::borrow::Cow;

use bun_ast::{Data, Kind, Loc, Location, Log, Msg, Range, Source};
use bun_core::fmt::VecWriter;

use crate::diagnostic::{Category, Diagnostic, SourceFile};
use crate::diagnosticwriter::{FormattingOptions, write_flattened_diagnostic_message};
use crate::tspath;

/// One frame for each diagnostic, an empty line between two, as `bun_ast::Log::print` separates messages.
pub fn write_code_frames<const ENABLE_ANSI_COLORS: bool>(
    output: &mut Vec<u8>,
    files: &[SourceFile],
    diagnostics: &[Diagnostic],
    format_opts: &FormattingOptions<'_>,
) {
    // The log lends its line tracker: diagnostics in the order of their positions cost one scan of each file.
    let mut log = Log::init();
    for (i, diagnostic) in diagnostics.iter().enumerate() {
        if i > 0 {
            output.extend_from_slice(b"\n\n");
        }
        let msg = to_msg(&mut log, files, diagnostic, format_opts);
        let _ = msg.write_format::<ENABLE_ANSI_COLORS>(&mut VecWriter(output));
    }
    if !diagnostics.is_empty() {
        output.push(b'\n');
    }
}

/// A diagnostic as a message of Bun's log: its code starts the text, its related information becomes the notes.
fn to_msg(
    log: &mut Log,
    files: &[SourceFile],
    diagnostic: &Diagnostic,
    format_opts: &FormattingOptions<'_>,
) -> Msg {
    let mut text: Vec<u8> = Vec::new();
    let _ = write!(VecWriter(&mut text), "{}: ", diagnostic.code);
    Msg {
        kind: match diagnostic.category {
            Category::Error => Kind::Err,
            Category::Warning => Kind::Warn,
            Category::Suggestion | Category::Message => Kind::Note,
        },
        data: to_data(log, files, diagnostic, text, format_opts),
        notes: diagnostic
            .related
            .iter()
            .map(|related| to_data(log, files, related, Vec::new(), format_opts))
            .collect(),
        ..Default::default()
    }
}

/// `text` holds what is printed in front of the message.
fn to_data(
    log: &mut Log,
    files: &[SourceFile],
    diagnostic: &Diagnostic,
    mut text: Vec<u8>,
    format_opts: &FormattingOptions<'_>,
) -> Data {
    write_flattened_diagnostic_message(&mut text, &diagnostic.text, &diagnostic.chain, b"\n");
    Data {
        text: Cow::Owned(text),
        location: to_location(log, files, diagnostic, format_opts),
    }
}

/// Bun's location of where a diagnostic starts, under the file name that the plain format prints.
fn to_location(
    log: &mut Log,
    files: &[SourceFile],
    diagnostic: &Diagnostic,
    format_opts: &FormattingOptions<'_>,
) -> Option<Location> {
    let file = files.get(diagnostic.file?.0 as usize)?;
    let range = Range {
        loc: Loc {
            start: i32::try_from(diagnostic.start).unwrap_or(i32::MAX),
        },
        len: i32::try_from(diagnostic.length).unwrap_or(i32::MAX),
    };
    let mut location = tracked_location(log, file.source(), range)?;
    location.file = Cow::Owned(tspath::convert_to_relative_path(
        file.file_name(),
        format_opts.compare_paths_options,
    ));
    Some(location)
}

/// `Location::init_or_null` by the line tracker of `log`, which scans on from the position it found last.
fn tracked_location(log: &mut Log, source: &Source, range: Range) -> Option<Location> {
    log.add_range_error(Some(source), range, b"");
    log.msgs.pop()?.data.location
}

#[cfg(test)]
mod tests {
    use bun_core::BStr;

    use super::*;
    use crate::diagnostic::{Code, FileId};
    use crate::tspath::ComparePathsOptions;

    fn file(name: &'static str, text: &'static str) -> SourceFile {
        SourceFile::new(
            name.as_bytes().into(),
            Source::init_path_string(name.as_bytes(), text.as_bytes()),
        )
    }

    fn report(file: u32, start: u32) -> Diagnostic {
        Diagnostic {
            file: Some(FileId(file)),
            start,
            length: 1,
            category: Category::Error,
            code: Code::Name("r"),
            text: Cow::Borrowed(b"t"),
            chain: Vec::new(),
            related: Vec::new(),
        }
    }

    #[track_caller]
    fn assert_frames(files: &[SourceFile], diagnostics: &[Diagnostic], expected: &str) {
        let format_opts = FormattingOptions {
            compare_paths_options: ComparePathsOptions {
                use_case_sensitive_file_names: true,
                current_directory: b"/p",
            },
            new_line: b"\n",
        };
        let mut output = Vec::new();
        write_code_frames::<false>(&mut output, files, diagnostics, &format_opts);
        assert_eq!(BStr::new(&output), BStr::new(expected));
    }

    #[test]
    fn no_diagnostic_writes_nothing() {
        assert_frames(&[], &[], "");
    }

    #[test]
    fn a_file_that_the_list_does_not_hold_gives_no_frame() {
        assert_frames(&[], &[report(7, 3)], "error: r: t\n");
    }

    #[test]
    fn a_position_behind_the_text_is_its_last_byte() {
        let files = [file("/p/f.js", "let a;\nlet b;")];
        assert_frames(
            &files,
            &[report(0, 99)],
            "2 | let b;\n         ^\nerror: r: t\n    at f.js:2:6\n",
        );
    }

    #[test]
    fn lines_are_found_in_any_order_of_positions_and_files() {
        let files = [
            file("/p/a.js", "one;\ntwo;\nthree;\n"),
            file("/p/b.js", "x;\ny;\n"),
        ];
        assert_frames(
            &files,
            &[report(0, 10), report(0, 0), report(1, 3), report(0, 5)],
            "3 | three;\n    ^\nerror: r: t\n    at a.js:3:1\n\
             \n\
             1 | one;\n    ^\nerror: r: t\n    at a.js:1:1\n\
             \n\
             2 | y;\n    ^\nerror: r: t\n    at b.js:2:1\n\
             \n\
             2 | two;\n    ^\nerror: r: t\n    at a.js:2:1\n",
        );
    }
}
