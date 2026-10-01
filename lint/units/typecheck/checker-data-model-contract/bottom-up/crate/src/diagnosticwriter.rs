// Port of the plain part of internal/diagnosticwriter/diagnosticwriter.go.
use crate::ast_diagnostic::{Diagnostics, SourceFiles};
use crate::diagnostics::{Locale, write_decimal};
use crate::tscore::core_text::utf16_len;
use crate::tscore::ids::{DiagnosticId, NodeId};

pub struct FormattingOptions<'a> {
    pub locale: Locale,
    pub new_line: &'a [u8],
    // tspath.ConvertToRelativePath(file name, ComparePathsOptions).
    pub convert_to_relative_path: &'a dyn Fn(&[u8]) -> Vec<u8>,
}

const MAX_NESTING: u32 = 200;

// scanner.ComputeLineOfPosition
pub fn compute_line_of_position(line_starts: &[i32], pos: i32) -> isize {
    let mut low: isize = 0;
    let mut high: isize = line_starts.len() as isize - 1;
    while low <= high {
        let middle = low + ((high - low) >> 1);
        let value = usize::try_from(middle)
            .ok()
            .and_then(|i| line_starts.get(i))
            .copied()
            .unwrap_or(0);
        if value < pos {
            low = middle + 1;
        } else if value > pos {
            high = middle - 1;
        } else {
            return middle;
        }
    }
    low - 1
}

// scanner.GetECMALineAndUTF16CharacterOfPosition, with a position outside the text clamped.
pub fn get_ecma_line_and_utf16_character_of_position<F: SourceFiles + ?Sized>(
    files: &F,
    file: NodeId,
    pos: i32,
) -> (usize, usize) {
    let line_map = files.ecma_line_map(file);
    let text = files.text(file);
    let line = usize::try_from(compute_line_of_position(line_map, pos)).unwrap_or(0);
    let start = usize::try_from(line_map.get(line).copied().unwrap_or(0)).unwrap_or(0);
    let end = usize::try_from(pos)
        .unwrap_or(0)
        .min(text.len())
        .max(start.min(text.len()));
    (
        line,
        utf16_len(text.get(start.min(end)..end).unwrap_or(b"")),
    )
}

pub fn write_format_diagnostics<F: SourceFiles + ?Sized>(
    output: &mut Vec<u8>,
    d: Diagnostics<'_, F>,
    diagnostics: &[DiagnosticId],
    format_opts: &FormattingOptions<'_>,
) {
    for &diagnostic in diagnostics {
        write_format_diagnostic(output, d, diagnostic, format_opts);
    }
}

pub fn write_format_diagnostic<F: SourceFiles + ?Sized>(
    output: &mut Vec<u8>,
    d: Diagnostics<'_, F>,
    diagnostic: DiagnosticId,
    format_opts: &FormattingOptions<'_>,
) {
    let item = &d.store[diagnostic];
    if !item.file().is_nil() {
        let (line, character) =
            get_ecma_line_and_utf16_character_of_position(d.files, item.file(), item.pos());
        let file_name = d.files.file_name(item.file());
        let relative_file_name = (format_opts.convert_to_relative_path)(file_name);
        output.extend_from_slice(&relative_file_name);
        output.push(b'(');
        write_decimal(output, i64::try_from(line + 1).unwrap_or(i64::MAX));
        output.push(b',');
        write_decimal(output, i64::try_from(character + 1).unwrap_or(i64::MAX));
        output.extend_from_slice(b"): ");
    }
    output.extend_from_slice(item.category().name());
    output.push(b' ');
    output.extend_from_slice(diagnostic_prefix(d, diagnostic));
    write_decimal(output, i64::from(item.code()));
    output.extend_from_slice(b": ");
    write_flattened_diagnostic_message(
        output,
        d,
        diagnostic,
        format_opts.new_line,
        format_opts.locale,
    );
    output.extend_from_slice(format_opts.new_line);
}

pub fn flatten_diagnostic_message<F: SourceFiles + ?Sized>(
    d: Diagnostics<'_, F>,
    diagnostic: DiagnosticId,
    new_line: &[u8],
    locale: Locale,
) -> Vec<u8> {
    let mut output = Vec::new();
    write_flattened_diagnostic_message(&mut output, d, diagnostic, new_line, locale);
    output
}

pub fn write_flattened_diagnostic_message<F: SourceFiles + ?Sized>(
    writer: &mut Vec<u8>,
    d: Diagnostics<'_, F>,
    diagnostic: DiagnosticId,
    newline: &[u8],
    locale: Locale,
) {
    writer.extend_from_slice(&d.store[diagnostic].localize(locale));
    for &chain in d.store[diagnostic].message_chain() {
        flatten_diagnostic_message_chain(writer, d, chain, newline, locale, 1);
    }
}

fn flatten_diagnostic_message_chain<F: SourceFiles + ?Sized>(
    writer: &mut Vec<u8>,
    d: Diagnostics<'_, F>,
    chain: DiagnosticId,
    new_line: &[u8],
    locale: Locale,
    level: u32,
) {
    if level > MAX_NESTING {
        return;
    }
    writer.extend_from_slice(new_line);
    for _ in 0..level {
        writer.extend_from_slice(b"  ");
    }
    writer.extend_from_slice(&d.store[chain].localize(locale));
    for &child in d.store[chain].message_chain() {
        flatten_diagnostic_message_chain(writer, d, child, new_line, locale, level + 1);
    }
}

fn diagnostic_prefix<'a, F: SourceFiles + ?Sized>(
    d: Diagnostics<'a, F>,
    diagnostic: DiagnosticId,
) -> &'a [u8] {
    let source = d.store[diagnostic].source();
    if !source.is_empty() {
        return source;
    }
    b"TS"
}
