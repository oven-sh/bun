/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
use crate::diagnostics::{CompilerDiagnosticDetail, CompilerError, CompilerErrorOrDiagnostic};
use core::fmt::Write as _;

const CODEFRAME_LINES_ABOVE: u32 = 2;
const CODEFRAME_LINES_BELOW: u32 = 3;
const CODEFRAME_MAX_LINES: u32 = 10;
const CODEFRAME_ABBREVIATED_SOURCE_LINES: usize = 5;

/// Split source text on newlines, matching Babel's NEWLINE regex: /\r\n|[\n\r  ]/
fn split_lines(source: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut start = 0;
    let bytes = source.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    while i < len {
        let ch = bytes[i];
        if ch == b'\r' {
            lines.push(&source[start..i]);
            if i + 1 < len && bytes[i + 1] == b'\n' {
                i += 2;
            } else {
                i += 1;
            }
            start = i;
        } else if ch == b'\n' {
            lines.push(&source[start..i]);
            i += 1;
            start = i;
        } else {
            // Check for Unicode line separators U+2028 and U+2029
            // These are encoded as E2 80 A8 and E2 80 A9 in UTF-8
            if ch == 0xE2
                && i + 2 < len
                && bytes[i + 1] == 0x80
                && (bytes[i + 2] == 0xA8 || bytes[i + 2] == 0xA9)
            {
                lines.push(&source[start..i]);
                i += 3;
                start = i;
            } else {
                i += 1;
            }
        }
    }
    lines.push(&source[start..]);
    lines
}

fn digit_count(mut n: usize) -> usize {
    if n == 0 {
        return 1;
    }
    let mut c = 0;
    while n > 0 {
        c += 1;
        n /= 10;
    }
    c
}

fn push_repeated(out: &mut String, ch: char, n: usize) {
    out.reserve(n);
    for _ in 0..n {
        out.push(ch);
    }
}

/// Represents a marker line entry: either mark the whole line (true) or a [column, length] range.
#[derive(Clone, Debug)]
enum MarkerEntry {
    WholeLine,
    Range(usize, usize), // (start_column_1based, length)
}

/// Compute marker lines matching Babel's getMarkerLines().
/// All column values here are 1-based (Babel convention).
fn get_marker_lines(
    start_line: u32,
    start_column: u32, // 1-based
    end_line: u32,
    end_column: u32, // 1-based
    source_line_count: usize,
    lines_above: u32,
    lines_below: u32,
) -> (usize, usize, Vec<(usize, MarkerEntry)>) {
    let start_line = start_line as usize;
    let end_line = end_line as usize;
    let start_column = start_column as usize;
    let end_column = end_column as usize;

    // Compute display range
    let start = if start_line > (lines_above as usize + 1) {
        start_line - (lines_above as usize + 1)
    } else {
        0
    };
    let end = std::cmp::min(source_line_count, end_line + lines_below as usize);

    let line_diff = end_line - start_line;
    let mut marker_lines: Vec<(usize, MarkerEntry)> = Vec::new();

    if line_diff > 0 {
        // Multi-line error
        for i in 0..=line_diff {
            let line_number = i + start_line;
            if start_column == 0 {
                marker_lines.push((line_number, MarkerEntry::WholeLine));
            } else if i == 0 {
                // First line: from start_column to end of source line
                // source[lineNumber - 1] gives us the source line (0-indexed array, 1-indexed line numbers)
                // But we don't have access to source lines here, so we pass the length through.
                // Actually, Babel accesses source[lineNumber - 1].length. We need to thread source lines.
                // For now, this is handled in code_frame_columns where we have access to source lines.
                // We use a placeholder that will be filled in later.
                marker_lines.push((line_number, MarkerEntry::Range(start_column, 0))); // 0 = placeholder
            } else if i == line_diff {
                marker_lines.push((line_number, MarkerEntry::Range(0, end_column)));
            } else {
                marker_lines.push((line_number, MarkerEntry::Range(0, 0))); // 0 = placeholder for full line
            }
        }
    } else {
        // Single-line error
        if start_column == end_column {
            if start_column != 0 {
                marker_lines.push((start_line, MarkerEntry::Range(start_column, 0)));
            } else {
                marker_lines.push((start_line, MarkerEntry::WholeLine));
            }
        } else {
            marker_lines.push((
                start_line,
                MarkerEntry::Range(start_column, end_column - start_column),
            ));
        }
    }

    (start, end, marker_lines)
}

/// Produce a code frame matching @babel/code-frame's codeFrameColumns() in non-highlighted mode.
///
/// Columns are 0-based (matching the Rust/AST convention). They are converted to 1-based
/// internally to match Babel's convention (the JS caller already does column + 1).
pub fn code_frame_columns(
    source: &str,
    start_line: u32,
    start_col: u32,
    end_line: u32,
    end_col: u32,
    message: &str,
) -> String {
    // Convert 0-based columns to 1-based (Babel convention)
    let start_column_1 = start_col + 1;
    let end_column_1 = end_col + 1;

    let lines = split_lines(source);
    let source_line_count = lines.len();

    let (start, end, marker_lines_raw) = get_marker_lines(
        start_line,
        start_column_1,
        end_line,
        end_column_1,
        source_line_count,
        CODEFRAME_LINES_ABOVE,
        CODEFRAME_LINES_BELOW,
    );

    let has_columns = start_column_1 > 0;
    let number_max_width = digit_count(end);

    // Build a lookup map for marker lines
    let mut marker_map: std::collections::HashMap<usize, MarkerEntry> =
        std::collections::HashMap::new();
    let line_diff = end_line as usize - start_line as usize;
    for (line_number, entry) in marker_lines_raw {
        // Resolve placeholder lengths using actual source lines
        let resolved = match &entry {
            MarkerEntry::Range(col, len) => {
                if line_diff > 0 {
                    let i = line_number - start_line as usize;
                    if i == 0 && *len == 0 {
                        // First line of multi-line: from start_column to end of line
                        let source_length = if line_number >= 1 && line_number <= lines.len() {
                            lines[line_number - 1].len()
                        } else {
                            0
                        };
                        MarkerEntry::Range(*col, source_length.saturating_sub(*col) + 1)
                    } else if i > 0 && i < line_diff && *col == 0 && *len == 0 {
                        // Middle line of multi-line: Babel uses source[lineNumber - i].length
                        // which evaluates to source[startLine] (0-indexed array, 1-indexed line number).
                        // This means all middle lines use the length of source[startLine],
                        // which is the line at 0-indexed position startLine in the source array.
                        let source_length = if (start_line as usize) < lines.len() {
                            lines[start_line as usize].len()
                        } else {
                            0
                        };
                        MarkerEntry::Range(0, source_length)
                    } else {
                        entry
                    }
                } else {
                    entry
                }
            }
            _ => entry,
        };
        marker_map.insert(line_number, resolved);
    }

    let mut frame = String::new();

    // If message is set but no columns, prepend the message
    if !message.is_empty() && !has_columns {
        push_repeated(&mut frame, ' ', number_max_width + 1);
        frame.push_str(message);
        frame.push('\n');
    }

    let display_lines = &lines[start..end];

    for (index, line) in display_lines.iter().enumerate() {
        if index > 0 {
            frame.push('\n');
        }
        let number = start + 1 + index;

        let has_marker = marker_map.get(&number);
        let has_next_marker = marker_map.contains_key(&(number + 1));
        let last_marker_line = has_marker.is_some() && !has_next_marker;

        frame.push(if has_marker.is_some() { '>' } else { ' ' });
        // gutter: " {padded_number} |"
        let _ = write!(frame, " {:>width$} |", number, width = number_max_width);
        if !line.is_empty() {
            frame.push(' ');
            frame.push_str(line);
        }

        if let Some(MarkerEntry::Range(col, len)) = has_marker {
            // Build marker spacing: replace non-tab chars with spaces
            let max_col = if *col > 0 { col - 1 } else { 0 };
            let byte_end = std::cmp::min(max_col, line.len());
            // Ensure we don't slice in the middle of a multi-byte UTF-8 character
            let safe_end = if byte_end < line.len() && !line.is_char_boundary(byte_end) {
                line.floor_char_boundary(byte_end)
            } else {
                byte_end
            };
            let prefix = &line[..safe_end];
            // marker line: "\n {gutter_spaces} {marker_spacing}{carets}"
            // gutter_spaces is the gutter with digits replaced by spaces:
            // " " + number_max_width spaces + " |"
            frame.push('\n');
            frame.push(' ');
            push_repeated(&mut frame, ' ', number_max_width + 2);
            frame.push('|');
            frame.push(' ');
            for c in prefix.chars() {
                frame.push(if c == '\t' { '\t' } else { ' ' });
            }
            let number_of_markers = if *len == 0 { 1 } else { *len };
            push_repeated(&mut frame, '^', number_of_markers);
            if last_marker_line && !message.is_empty() {
                frame.push(' ');
                frame.push_str(message);
            }
        }
    }

    frame
}

/// Format a code frame with abbreviation for long spans,
/// matching the JS printCodeFrame() function.
pub fn print_code_frame(
    source: &str,
    start_line: u32,
    start_col: u32,
    end_line: u32,
    end_col: u32,
    message: &str,
) -> String {
    let printed = code_frame_columns(source, start_line, start_col, end_line, end_col, message);

    if end_line - start_line < CODEFRAME_MAX_LINES {
        return printed;
    }

    // Abbreviate: truncate middle
    let lines: Vec<&str> = printed.split('\n').collect();
    let head_count = CODEFRAME_LINES_ABOVE as usize + CODEFRAME_ABBREVIATED_SOURCE_LINES;
    let tail_count = CODEFRAME_LINES_BELOW as usize + CODEFRAME_ABBREVIATED_SOURCE_LINES;

    if lines.len() <= head_count + tail_count {
        return printed;
    }

    // Find the pipe index from the first line
    let pipe_index = lines[0].find('|').unwrap_or(0);
    let tail_start = lines.len() - tail_count;

    let mut out = String::with_capacity(printed.len());
    for (i, line) in lines[..head_count].iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str(line);
    }
    out.push('\n');
    push_repeated(&mut out, ' ', pipe_index);
    out.push('\u{2026}');
    for line in &lines[tail_start..] {
        out.push('\n');
        out.push_str(line);
    }
    out
}

use crate::diagnostics::format_category_heading;

/// Format a CompilerError into a message string matching the TS compiler's
/// CompilerError.printErrorMessage() / formatCompilerError() format.
///
/// The source parameter is the full source code of the file being compiled.
/// The filename parameter is the source filename (e.g., "foo.ts") used in
/// location displays.
pub fn format_compiler_error(err: &CompilerError, source: &str, filename: Option<&str>) -> String {
    let count = err.details.len();
    let plural = if count == 1 { "" } else { "s" };
    let mut out = String::new();
    let _ = write!(out, "Found {} error{}:\n\n", count, plural);

    for (i, d) in err.details.iter().enumerate() {
        if i > 0 {
            out.push_str("\n\n");
        }
        let detail = format_error_detail(d, source, filename);
        out.push_str(detail.trim());
    }
    out
}

/// Format a single error detail (either Diagnostic or ErrorDetail).
fn format_error_detail(
    detail: &CompilerErrorOrDiagnostic,
    source: &str,
    filename: Option<&str>,
) -> String {
    let mut out = String::new();
    match detail {
        CompilerErrorOrDiagnostic::Diagnostic(d) => {
            let heading = format_category_heading(d.category);
            let _ = write!(out, "{}: {}", heading, d.reason);

            if let Some(ref description) = d.description {
                let _ = write!(out, "\n\n{}.", description);
            }
            for item in &d.details {
                match item {
                    CompilerDiagnosticDetail::Error { loc, message, .. } => {
                        if let Some(loc) = loc {
                            let frame = print_code_frame(
                                source,
                                loc.start.line,
                                loc.start.column,
                                loc.end.line,
                                loc.end.column,
                                message.as_deref().unwrap_or(""),
                            );
                            out.push_str("\n\n");
                            if let Some(fname) = filename {
                                let _ = writeln!(
                                    out,
                                    "{}:{}:{}",
                                    fname, loc.start.line, loc.start.column
                                );
                            }
                            out.push_str(&frame);
                        }
                    }
                    CompilerDiagnosticDetail::Hint { message } => {
                        out.push_str("\n\n");
                        out.push_str(message);
                    }
                }
            }
        }
        CompilerErrorOrDiagnostic::ErrorDetail(d) => {
            let heading = format_category_heading(d.category);
            let _ = write!(out, "{}: {}", heading, d.reason);

            if let Some(ref description) = d.description {
                let _ = write!(out, "\n\n{}.", description);
                if let Some(ref loc) = d.loc {
                    let frame = print_code_frame(
                        source,
                        loc.start.line,
                        loc.start.column,
                        loc.end.line,
                        loc.end.column,
                        &d.reason,
                    );
                    out.push_str("\n\n");
                    if let Some(fname) = filename {
                        let _ = writeln!(out, "{}:{}:{}", fname, loc.start.line, loc.start.column);
                    }
                    out.push_str(&frame);
                    out.push_str("\n\n");
                }
            } else if let Some(ref loc) = d.loc {
                let frame = print_code_frame(
                    source,
                    loc.start.line,
                    loc.start.column,
                    loc.end.line,
                    loc.end.column,
                    &d.reason,
                );
                out.push_str("\n\n");
                if let Some(fname) = filename {
                    let _ = writeln!(out, "{}:{}:{}", fname, loc.start.line, loc.start.column);
                }
                out.push_str(&frame);
                out.push_str("\n\n");
            }
        }
    }
    out
}
