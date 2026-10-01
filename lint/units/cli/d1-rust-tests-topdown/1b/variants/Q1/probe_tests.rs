use std::borrow::Cow;

use bun_ast::Source;

use crate::code_frame::write_code_frames;
use crate::diagnostic::{Category, Code, Diagnostic, FileId, SourceFile};
use crate::diagnosticwriter::FormattingOptions;
use crate::tspath::ComparePathsOptions;

#[test]
fn probe_a_coloured_frame_of_a_line_longer_than_32_bytes() {
    let text = "let a_name_that_is_long_enough_to_pass_32_bytes = 1;\n";
    let files = [SourceFile::new(
        b"/p/f.js"[..].into(),
        Source::init_path_string(b"/p/f.js", text.as_bytes()),
    )];
    let diagnostics = [Diagnostic {
        file: Some(FileId(0)),
        start: 0,
        length: 3,
        category: Category::Error,
        code: Code::Name("r"),
        text: Cow::Borrowed(b"t"),
        chain: Vec::new(),
        related: Vec::new(),
    }];
    let format_opts = FormattingOptions {
        compare_paths_options: ComparePathsOptions {
            use_case_sensitive_file_names: true,
            current_directory: b"/p",
        },
        new_line: b"\n",
    };
    let mut output = Vec::new();
    write_code_frames::<true>(&mut output, &files, &diagnostics, &format_opts);
    assert!(output.len() > text.len());
}

#[test]
fn probe_a_stack_check_without_a_bound() {
    assert!(bun_core::StackCheck::default().is_safe_to_recurse());
}
