//! The plain format of tsc: `internal/diagnosticwriter/diagnosticwriter.go` of typescript-go.

use std::io::Write;

use crate::diagnostic::{Diagnostic, MessageChain, SourceFile};
use crate::scanner;
use crate::tspath::{self, ComparePathsOptions};

#[derive(Clone, Copy)]
pub struct FormattingOptions<'a> {
    pub compare_paths_options: ComparePathsOptions<'a>,
    pub new_line: &'a [u8],
}

/// The text, then each message of the chain on its own line, two more spaces per level.
pub fn write_flattened_diagnostic_message(
    output: &mut Vec<u8>,
    text: &[u8],
    chain: &[MessageChain],
    new_line: &[u8],
) {
    write_text(output, text);

    for chain in chain {
        flatten_diagnostic_message_chain(output, chain, new_line, 1);
    }
}

/// Where the reference calls itself for each child, this keeps the rest of each level on a stack.
fn flatten_diagnostic_message_chain(
    output: &mut Vec<u8>,
    chain: &MessageChain,
    new_line: &[u8],
    level: usize,
) {
    let mut stack = vec![core::slice::from_ref(chain).iter()];
    while let Some(rest_of_level) = stack.last_mut() {
        let Some(chain) = rest_of_level.next() else {
            stack.pop();
            continue;
        };
        output.extend_from_slice(new_line);
        for _ in 0..level + stack.len() - 1 {
            output.extend_from_slice(b"  ");
        }

        write_text(output, &chain.text);
        stack.push(chain.next.iter());
    }
}

/// A line break inside a text is written as one space, which the reference does not do: a diagnostic and each chain message stay one line.
fn write_text(output: &mut Vec<u8>, text: &[u8]) {
    let mut bytes = text.iter().copied().peekable();
    while let Some(b) = bytes.next() {
        match b {
            b'\r' => {
                bytes.next_if_eq(&b'\n');
                output.push(b' ');
            }
            b'\n' => output.push(b' '),
            _ => output.push(b),
        }
    }
}

pub fn write_format_diagnostics(
    output: &mut Vec<u8>,
    files: &[SourceFile],
    diagnostics: &[Diagnostic],
    format_opts: &FormattingOptions<'_>,
) {
    for diagnostic in diagnostics {
        write_format_diagnostic(output, files, diagnostic, format_opts);
    }
}

/// `path(line,column): category code: text`, the line and the column 1-based, the column in UTF-16 code units.
pub fn write_format_diagnostic(
    output: &mut Vec<u8>,
    files: &[SourceFile],
    diagnostic: &Diagnostic,
    format_opts: &FormattingOptions<'_>,
) {
    if let Some(file) = diagnostic.file.and_then(|id| files.get(id.0 as usize)) {
        let (line, character) = scanner::get_ecma_line_and_utf16_character_of_position(
            file.text(),
            file.ecma_line_map(),
            diagnostic.start,
        );
        let file_name = file.file_name();
        let relative_file_name =
            tspath::convert_to_relative_path(file_name, format_opts.compare_paths_options);
        output.extend_from_slice(&relative_file_name);
        let _ = write!(output, "({},{}): ", line + 1, character + 1);
    }

    let _ = write!(
        output,
        "{} {}: ",
        diagnostic.category.name(),
        diagnostic.code
    );
    write_flattened_diagnostic_message(
        output,
        &diagnostic.text,
        &diagnostic.chain,
        format_opts.new_line,
    );
    output.extend_from_slice(format_opts.new_line);
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;

    use bun_core::BStr;

    use super::*;
    use crate::diagnostic::{Category, Code};

    fn link(text: &'static str, next: Vec<MessageChain>) -> MessageChain {
        MessageChain {
            text: Cow::Borrowed(text.as_bytes()),
            next,
        }
    }

    #[test]
    fn the_line_break_of_the_options_ends_a_diagnostic_and_starts_each_chain_message() {
        // The line break that the baselines of the reference are written with.
        let format_opts = FormattingOptions {
            compare_paths_options: ComparePathsOptions {
                use_case_sensitive_file_names: false,
                current_directory: b"",
            },
            new_line: b"\r\n",
        };
        let diagnostics = [
            Diagnostic {
                file: None,
                start: 0,
                length: 0,
                category: Category::Error,
                code: Code::Ts(2322),
                text: Cow::Borrowed(b"Type 'A' is not assignable to type 'B'."),
                chain: vec![
                    link(
                        "Types of property 'x' are incompatible.",
                        vec![link(
                            "Type 'string' is not assignable to type 'number'.",
                            Vec::new(),
                        )],
                    ),
                    link("A second message at the first level.", Vec::new()),
                ],
                related: Vec::new(),
            },
            Diagnostic {
                file: None,
                start: 0,
                length: 0,
                category: Category::Message,
                code: Code::Ts(6053),
                text: Cow::Borrowed(b"File 'a.ts' not found."),
                chain: Vec::new(),
                related: Vec::new(),
            },
        ];
        let mut output = Vec::new();
        write_format_diagnostics(&mut output, &[], &diagnostics, &format_opts);
        assert_eq!(
            BStr::new(&output),
            BStr::new(
                b"error TS2322: Type 'A' is not assignable to type 'B'.\r\n  \
                  Types of property 'x' are incompatible.\r\n    \
                  Type 'string' is not assignable to type 'number'.\r\n  \
                  A second message at the first level.\r\n\
                  message TS6053: File 'a.ts' not found.\r\n"
            )
        );
    }
}
