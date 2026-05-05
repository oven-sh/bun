//! Tested in test/js/bun/test/printing/diffexample.test.ts. If modified, the snapshots will need to be updated.

use std::io::Write;

use bstr::BStr;

use crate::diff::diff_match_patch;
use bun_str::strings;

// TODO(port): verify diff_match_patch::Dmp<T> API surface (default(), config.diff_timeout,
// diff(), diff_lines_to_chars(), diff_chars_to_lines(), diff_cleanup_semantic(), Diff{operation,text}, Operation::{Delete,Insert,Equal})
type Dmp = diff_match_patch::Dmp<u8>;
type DmpUsize = diff_match_patch::Dmp<usize>;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    BgAlways,
    BgDiffOnly,
    Fg,
    FgDiff,
}
const MODE: Mode = Mode::BgDiffOnly;

pub struct DiffConfig {
    pub min_bytes_before_chunking: usize,
    pub chunk_context_lines: usize,
    pub enable_ansi_colors: bool,
    pub truncate_threshold: usize,
    pub truncate_context: usize,
}

impl DiffConfig {
    pub fn default(is_agent: bool, enable_ansi_colors: bool) -> DiffConfig {
        DiffConfig {
            min_bytes_before_chunking: if is_agent { 0 } else { 2 * 1024 }, // 2kb
            chunk_context_lines: if is_agent { 1 } else { 5 },
            enable_ansi_colors,
            truncate_threshold: if is_agent { 1 * 1024 } else { 2 * 1024 }, // 2kb
            truncate_context: if is_agent { 50 } else { 100 },
        }
    }
}

fn remove_trailing_newline(text: &[u8]) -> &[u8] {
    if !text.ends_with(b"\n") {
        return text;
    }
    &text[0..text.len() - 1]
}

pub fn print_diff_main(
    not: bool,
    received_slice: &[u8],
    expected_slice: &[u8],
    writer: &mut impl Write,
    config: &DiffConfig,
) -> std::io::Result<()> {
    // PERF(port): was arena bulk-free — profile in Phase B (all intermediate Vecs below were arena-allocated in Zig)
    if not {
        match config.enable_ansi_colors {
            true => write!(
                writer,
                const_format::concatcp!("Expected: not ", colors::RED, "{}", colors::RESET),
                BStr::new(expected_slice)
            )?,
            false => write!(writer, "Expected: not {}", BStr::new(expected_slice))?,
        }
        return Ok(());
    }

    // check if the diffs are single-line
    if strings::index_of_char(received_slice, b'\n').is_none()
        && strings::index_of_char(expected_slice, b'\n').is_none()
    {
        print_modified_segment(
            &DiffSegment {
                removed: expected_slice,
                inserted: received_slice,
                mode: DiffSegmentMode::Modified,
                removed_line_count: 0,
                inserted_line_count: 0,
                skip: false,
            },
            writer,
            config,
            ModifiedStyle { single_line: true },
        )?;
        return Ok(());
    }

    let mut dmp = DmpUsize::default();
    dmp.config.diff_timeout = 200;
    let lines_to_chars = Dmp::diff_lines_to_chars(expected_slice, received_slice);
    let char_diffs = dmp.diff(&lines_to_chars.chars_1, &lines_to_chars.chars_2, false);
    let diffs = Dmp::diff_chars_to_lines(&char_diffs, lines_to_chars.line_array.as_slice());

    let mut diff_segments: Vec<DiffSegment> = Vec::new();
    for diff in diffs.iter() {
        if diff.operation == diff_match_patch::Operation::Delete {
            diff_segments.push(DiffSegment {
                removed: &diff.text,
                inserted: b"",
                mode: DiffSegmentMode::Removed,
                removed_line_count: 0,
                inserted_line_count: 0,
                skip: false,
            });
        } else if diff.operation == diff_match_patch::Operation::Insert {
            if !diff_segments.is_empty()
                && diff_segments[diff_segments.len() - 1].mode == DiffSegmentMode::Removed
            {
                let last = diff_segments.len() - 1;
                diff_segments[last].inserted = &diff.text;
                diff_segments[last].mode = DiffSegmentMode::Modified;
            } else {
                diff_segments.push(DiffSegment {
                    removed: b"",
                    inserted: &diff.text,
                    mode: DiffSegmentMode::Inserted,
                    removed_line_count: 0,
                    inserted_line_count: 0,
                    skip: false,
                });
            }
        } else if diff.operation == diff_match_patch::Operation::Equal {
            diff_segments.push(DiffSegment {
                removed: &diff.text,
                inserted: &diff.text,
                mode: DiffSegmentMode::Equal,
                removed_line_count: 0,
                inserted_line_count: 0,
                skip: false,
            });
        }
    }

    // trim all segments except the last one
    if !diff_segments.is_empty() {
        let last = diff_segments.len() - 1;
        for diff_segment in &mut diff_segments[0..last] {
            diff_segment.removed = remove_trailing_newline(diff_segment.removed);
            diff_segment.inserted = remove_trailing_newline(diff_segment.inserted);
        }
    }

    // Determine if the diff needs to be chunked
    if expected_slice.len() > config.min_bytes_before_chunking
        || received_slice.len() > config.min_bytes_before_chunking
    {
        // Split 'equal' segments into lines
        let mut new_diff_segments: Vec<DiffSegment> = Vec::new();

        for diff_segment in &diff_segments {
            if diff_segment.mode == DiffSegmentMode::Equal {
                for line in diff_segment.removed.split(|&b| b == b'\n') {
                    new_diff_segments.push(DiffSegment {
                        removed: line,
                        inserted: line,
                        mode: DiffSegmentMode::Equal,
                        removed_line_count: 0,
                        inserted_line_count: 0,
                        skip: true,
                    });
                }
            } else {
                new_diff_segments.push(diff_segment.clone());
            }
        }

        diff_segments = new_diff_segments;

        // Forward pass: unskip segments after non-equal segments
        // PORT NOTE: reshaped for borrowck (capture len before mutable slice borrow)
        let len = diff_segments.len();
        for i in 0..len {
            if diff_segments[i].mode != DiffSegmentMode::Equal {
                let end = i
                    .saturating_add(config.chunk_context_lines)
                    .saturating_add(1)
                    .min(len);
                for seg in &mut diff_segments[i..end] {
                    seg.skip = false;
                }
            }
        }

        {
            // Reverse pass: unskip segments before non-equal segments
            let mut i = diff_segments.len();
            while i > 0 {
                i -= 1;
                if diff_segments[i].mode != DiffSegmentMode::Equal {
                    let start = i.saturating_sub(config.chunk_context_lines);
                    for seg in &mut diff_segments[start..i + 1] {
                        seg.skip = false;
                    }
                }
            }
        }
    }

    // fill removed_line_count and inserted_line_count
    for segment in &mut diff_segments {
        for &char in segment.removed {
            if char == b'\n' {
                segment.removed_line_count += 1;
            }
        }
        segment.removed_line_count += 1;

        for &char in segment.inserted {
            if char == b'\n' {
                segment.inserted_line_count += 1;
            }
        }
        segment.inserted_line_count += 1;
    }
    print_diff(writer, &diff_segments, config)
}

pub struct Diff<'a> {
    pub operation: DiffOperation,
    pub text: &'a [u8],
}

pub enum DiffOperation {
    Insert,
    Delete,
    Equal,
}

mod colors {
    pub const RED: &str = "\x1b[31m";
    pub const GREEN: &str = "\x1b[32m";
    pub const YELLOW: &str = "\x1b[33m";
    pub const INVERT: &str = "\x1b[7m";
    pub const UNDERLINE: &str = "\x1b[4m";
    pub const DIM: &str = "\x1b[2m";
    pub const WHITE: &str = "\x1b[97m";
    pub const RESET: &str = "\x1b[0m";
}

mod prefix_styles {
    use super::{colors, PrefixStyle};
    pub const INSERTED: PrefixStyle = PrefixStyle {
        msg: "+ ",
        color: colors::RED,
    };
    pub const REMOVED: PrefixStyle = PrefixStyle {
        msg: "- ",
        color: colors::GREEN,
    };
    pub const EQUAL: PrefixStyle = PrefixStyle {
        msg: "  ",
        color: "",
    };
    pub const SINGLE_LINE_INSERTED: PrefixStyle = PrefixStyle {
        msg: "Received: ",
        color: "",
    };
    pub const SINGLE_LINE_REMOVED: PrefixStyle = PrefixStyle {
        msg: "Expected: ",
        color: "",
    };
}

mod base_styles {
    use super::{colors, prefix_styles, Style};
    pub const RED_BG_INSERTED: Style = Style {
        prefix: prefix_styles::INSERTED,
        text_color: const_format::concatcp!(colors::RED, colors::INVERT),
    };
    pub const GREEN_BG_REMOVED: Style = Style {
        prefix: prefix_styles::REMOVED,
        text_color: const_format::concatcp!(colors::GREEN, colors::INVERT),
    };
    pub const DIM_EQUAL: Style = Style {
        prefix: prefix_styles::EQUAL,
        text_color: colors::DIM,
    };
    pub const RED_FG_INSERTED: Style = Style {
        prefix: prefix_styles::INSERTED,
        text_color: colors::RED,
    };
    pub const GREEN_FG_REMOVED: Style = Style {
        prefix: prefix_styles::REMOVED,
        text_color: colors::GREEN,
    };
    pub const DIM_INSERTED: Style = Style {
        prefix: prefix_styles::INSERTED,
        text_color: colors::DIM,
    };
    pub const DIM_REMOVED: Style = Style {
        prefix: prefix_styles::REMOVED,
        text_color: colors::DIM,
    };
}

// TODO(port): Zig selects this namespace via `switch (mode)` at comptime. Since MODE is const
// Mode::BgDiffOnly, only that arm is materialized here. The .bg_always and .fg_diff arms differ
// only in inserted_equal/removed_equal; .fg omits inserted_diff/removed_diff entirely.
mod styles {
    use super::{base_styles, Style};
    pub const INSERTED_LINE: Style = base_styles::RED_FG_INSERTED;
    pub const REMOVED_LINE: Style = base_styles::GREEN_FG_REMOVED;
    pub const INSERTED_DIFF: Style = base_styles::RED_FG_INSERTED;
    pub const REMOVED_DIFF: Style = base_styles::GREEN_FG_REMOVED;
    pub const EQUAL: Style = base_styles::DIM_EQUAL;
    pub const INSERTED_EQUAL: Style = base_styles::RED_FG_INSERTED;
    pub const REMOVED_EQUAL: Style = base_styles::GREEN_FG_REMOVED;
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DiffSegmentMode {
    Equal,
    Removed,
    Inserted,
    Modified,
}

// TODO(port): lifetime — `removed`/`inserted` borrow from caller input and diff_match_patch output;
// in Zig these were arena-backed slices. Revisit ownership in Phase B.
#[derive(Clone)]
pub struct DiffSegment<'a> {
    pub removed: &'a [u8],
    pub inserted: &'a [u8],
    pub mode: DiffSegmentMode,
    pub removed_line_count: usize,
    pub inserted_line_count: usize,
    pub skip: bool,
}

fn print_diff_footer(
    writer: &mut impl Write,
    config: &DiffConfig,
    removed_diff_lines: usize,
    inserted_diff_lines: usize,
) -> std::io::Result<()> {
    if config.enable_ansi_colors {
        writer.write_all(styles::REMOVED_LINE.prefix.color.as_bytes())?;
    }
    writer.write_all(styles::REMOVED_LINE.prefix.msg.as_bytes())?;
    writer.write_all(b"Expected")?;
    write!(
        writer,
        "  {}{}",
        styles::REMOVED_LINE.prefix.msg, removed_diff_lines
    )?;
    if config.enable_ansi_colors {
        writer.write_all(colors::RESET.as_bytes())?;
    }
    writer.write_all(b"\n")?;
    if config.enable_ansi_colors {
        writer.write_all(styles::INSERTED_LINE.prefix.color.as_bytes())?;
    }
    writer.write_all(styles::INSERTED_LINE.prefix.msg.as_bytes())?;
    writer.write_all(b"Received")?;
    write!(
        writer,
        "  {}{}",
        styles::INSERTED_LINE.prefix.msg, inserted_diff_lines
    )?;
    if config.enable_ansi_colors {
        writer.write_all(colors::RESET.as_bytes())?;
    }
    Ok(())
}

#[derive(Clone, Copy)]
pub struct PrefixStyle {
    pub msg: &'static str,
    pub color: &'static str,
}

#[derive(Clone, Copy)]
pub struct Style {
    pub prefix: PrefixStyle,
    pub text_color: &'static str,
}

fn print_line_prefix(
    writer: &mut impl Write,
    config: &DiffConfig,
    prefix: PrefixStyle,
) -> std::io::Result<()> {
    if config.enable_ansi_colors {
        writer.write_all(prefix.color.as_bytes())?;
    }
    writer.write_all(prefix.msg.as_bytes())?;
    if config.enable_ansi_colors {
        writer.write_all(colors::RESET.as_bytes())?;
    }
    Ok(())
}

fn print_truncated_line(
    line: &[u8],
    writer: &mut impl Write,
    config: &DiffConfig,
    style: Style,
) -> std::io::Result<()> {
    if line.len() <= config.truncate_threshold || line.len() <= config.truncate_context * 2 {
        if config.enable_ansi_colors {
            writer.write_all(style.text_color.as_bytes())?;
        }
        writer.write_all(line)?;
        if config.enable_ansi_colors {
            writer.write_all(colors::RESET.as_bytes())?;
        }
        return Ok(());
    }

    // Line is too long, truncate it.
    if config.enable_ansi_colors {
        writer.write_all(style.text_color.as_bytes())?;
    }
    writer.write_all(&line[0..config.truncate_context])?;
    if config.enable_ansi_colors {
        writer.write_all(colors::RESET.as_bytes())?;
    }

    if config.enable_ansi_colors {
        writer.write_all(colors::WHITE.as_bytes())?;
    }
    // The context is shown on both sides, so we truncate line.len - 2 * context
    write!(
        writer,
        "... ({} bytes truncated) ...",
        line.len() - 2 * config.truncate_context
    )?;
    if config.enable_ansi_colors {
        writer.write_all(colors::RESET.as_bytes())?;
    }

    if config.enable_ansi_colors {
        writer.write_all(style.text_color.as_bytes())?;
    }
    writer.write_all(&line[line.len() - config.truncate_context..])?;
    if config.enable_ansi_colors {
        writer.write_all(colors::RESET.as_bytes())?;
    }
    Ok(())
}

fn print_segment(
    text: &[u8],
    writer: &mut impl Write,
    config: &DiffConfig,
    style: Style,
) -> std::io::Result<()> {
    let mut lines = text.split(|&b| b == b'\n');

    print_truncated_line(lines.next().unwrap(), writer, config, style)?;

    for line in lines {
        writer.write_all(b"\n")?;
        print_line_prefix(writer, config, style.prefix)?;
        print_truncated_line(line, writer, config, style)?;
    }
    Ok(())
}

fn print_modified_segment_without_diffdiff(
    writer: &mut impl Write,
    config: &DiffConfig,
    segment: &DiffSegment<'_>,
    modified_style: ModifiedStyle,
) -> std::io::Result<()> {
    let removed_prefix = match modified_style.single_line {
        true => prefix_styles::SINGLE_LINE_REMOVED,
        false => prefix_styles::REMOVED,
    };
    let inserted_prefix = match modified_style.single_line {
        true => prefix_styles::SINGLE_LINE_INSERTED,
        false => prefix_styles::INSERTED,
    };

    print_line_prefix(writer, config, removed_prefix)?;
    print_segment(segment.removed, writer, config, styles::REMOVED_LINE)?;
    writer.write_all(b"\n")?;
    print_line_prefix(writer, config, inserted_prefix)?;
    print_segment(segment.inserted, writer, config, styles::INSERTED_LINE)?;
    if !modified_style.single_line {
        writer.write_all(b"\n")?;
    }
    Ok(())
}

fn should_highlight_char(char: u8) -> bool {
    // Highlight whitespace and control characters:
    // - Control characters (< 0x20)
    // - Space (0x20)
    // - Tab is included in control chars (0x09)
    // - Delete character (0x7F)
    if char <= 0x20 {
        return true;
    } // includes space and all control chars
    if char == 0x7F {
        return true;
    } // DEL character
    false
}

#[derive(Clone, Copy)]
struct ModifiedStyle {
    single_line: bool,
}

fn print_modified_segment(
    segment: &DiffSegment<'_>,
    writer: &mut impl Write,
    config: &DiffConfig,
    modified_style: ModifiedStyle,
) -> std::io::Result<()> {
    let removed_prefix = match modified_style.single_line {
        true => prefix_styles::SINGLE_LINE_REMOVED,
        false => prefix_styles::REMOVED,
    };
    let inserted_prefix = match modified_style.single_line {
        true => prefix_styles::SINGLE_LINE_INSERTED,
        false => prefix_styles::INSERTED,
    };

    if MODE == Mode::Fg {
        return print_modified_segment_without_diffdiff(writer, config, segment, modified_style);
    }

    let mut char_diff = Dmp::default().diff(segment.removed, segment.inserted, true);
    Dmp::diff_cleanup_semantic(&mut char_diff);

    let mut deleted_highlighted_length: usize = 0;
    let mut inserted_highlighted_length: usize = 0;
    let mut unhighlighted_length: usize = 0;
    for item in char_diff.iter() {
        match item.operation {
            diff_match_patch::Operation::Delete => deleted_highlighted_length += item.text.len(),
            diff_match_patch::Operation::Insert => inserted_highlighted_length += item.text.len(),
            diff_match_patch::Operation::Equal => unhighlighted_length += item.text.len(),
        }
    }
    let _ = unhighlighted_length;

    if (deleted_highlighted_length > 10
        && deleted_highlighted_length > segment.removed.len() / 3 * 2)
        || (inserted_highlighted_length > 10
            && inserted_highlighted_length > segment.inserted.len() / 3 * 2)
    {
        // the diff is too significant (more than 2/3 of the original text on one side is modified), so skip printing the second layer of diffs.
        return print_modified_segment_without_diffdiff(writer, config, segment, modified_style);
    }

    let is_valid_utf_8 = char_diff
        .iter()
        .all(|item| strings::is_valid_utf8(&item.text));

    if !is_valid_utf_8 {
        // utf-8 was cut up, so skip printing the second layer of diffs. ideally we would update the diff cleanup to handle this case instead.
        return print_modified_segment_without_diffdiff(writer, config, segment, modified_style);
    }

    print_line_prefix(writer, config, removed_prefix)?;

    for item in char_diff.iter() {
        match item.operation {
            diff_match_patch::Operation::Delete => {
                let only_highlightable = item.text.iter().all(|&c| should_highlight_char(c));

                if only_highlightable {
                    // Use background color for whitespace/control character differences
                    print_segment(&item.text, writer, config, base_styles::GREEN_BG_REMOVED)?;
                } else {
                    print_segment(&item.text, writer, config, styles::REMOVED_DIFF)?;
                }
            }
            diff_match_patch::Operation::Insert => {}
            diff_match_patch::Operation::Equal => {
                print_segment(&item.text, writer, config, styles::REMOVED_EQUAL)?;
            }
        }
    }
    writer.write_all(b"\n")?;

    print_line_prefix(writer, config, inserted_prefix)?;
    for item in char_diff.iter() {
        match item.operation {
            diff_match_patch::Operation::Delete => {}
            diff_match_patch::Operation::Insert => {
                let only_highlightable = item.text.iter().all(|&c| should_highlight_char(c));

                if only_highlightable {
                    // Use background color for whitespace/control character differences
                    print_segment(&item.text, writer, config, base_styles::RED_BG_INSERTED)?;
                } else {
                    print_segment(&item.text, writer, config, styles::INSERTED_DIFF)?;
                }
            }
            diff_match_patch::Operation::Equal => {
                print_segment(&item.text, writer, config, styles::INSERTED_EQUAL)?;
            }
        }
    }
    if !modified_style.single_line {
        writer.write_all(b"\n")?;
    }
    Ok(())
}

pub fn print_hunk_header(
    writer: &mut impl Write,
    config: &DiffConfig,
    original_line_number: usize,
    original_line_count: usize,
    changed_line_number: usize,
    changed_line_count: usize,
) -> std::io::Result<()> {
    if config.enable_ansi_colors {
        write!(
            writer,
            "{}@@ -{},{} +{},{} @@{}\n",
            colors::YELLOW,
            original_line_number,
            original_line_count,
            changed_line_number,
            changed_line_count,
            colors::RESET
        )
    } else {
        write!(
            writer,
            "@@ -{},{} +{},{} @@\n",
            original_line_number, original_line_count, changed_line_number, changed_line_count
        )
    }
}

pub fn print_diff(
    writer: &mut impl Write,
    diff_segments: &[DiffSegment<'_>],
    config: &DiffConfig,
) -> std::io::Result<()> {
    // PERF(port): was arena bulk-free — profile in Phase B
    let mut removed_line_number: usize = 1;
    let mut inserted_line_number: usize = 1;
    let mut removed_diff_lines: usize = 0;
    let mut inserted_diff_lines: usize = 0;

    let has_skipped_segments = diff_segments.iter().any(|seg| seg.skip);

    let mut was_skipped = false;
    for (i, segment) in diff_segments.iter().enumerate() {
        // PORT NOTE: Zig `defer { removed_line_number += ...; inserted_line_number += ...; }` —
        // applied at the end of the loop body and before `continue` below.

        if (was_skipped && !segment.skip) || (has_skipped_segments && i == 0 && !segment.skip) {
            // have to calculate the length of the non-skipped segment
            let mut original_line_count: usize = 0;
            let mut changed_line_count: usize = 0;
            for seg in &diff_segments[i..] {
                if seg.skip {
                    break;
                }
                original_line_count += seg.removed_line_count;
                changed_line_count += seg.inserted_line_count;
            }
            print_hunk_header(
                writer,
                config,
                removed_line_number,
                original_line_count,
                inserted_line_number,
                changed_line_count,
            )?;
            was_skipped = false;
        }

        match segment.mode {
            DiffSegmentMode::Equal => {
                if segment.skip {
                    was_skipped = true;
                    // defer:
                    removed_line_number += segment.removed_line_count;
                    inserted_line_number += segment.inserted_line_count;
                    continue;
                }
                print_line_prefix(writer, config, prefix_styles::EQUAL)?;
                print_segment(segment.removed, writer, config, styles::EQUAL)?;
                writer.write_all(b"\n")?;
            }
            DiffSegmentMode::Removed => {
                print_line_prefix(writer, config, prefix_styles::REMOVED)?;
                print_segment(segment.removed, writer, config, styles::REMOVED_LINE)?;
                writer.write_all(b"\n")?;
                removed_diff_lines += segment.removed_line_count;
            }
            DiffSegmentMode::Inserted => {
                print_line_prefix(writer, config, prefix_styles::INSERTED)?;
                print_segment(segment.inserted, writer, config, styles::INSERTED_LINE)?;
                writer.write_all(b"\n")?;
                inserted_diff_lines += segment.inserted_line_count;
            }
            DiffSegmentMode::Modified => {
                print_modified_segment(
                    segment,
                    writer,
                    config,
                    ModifiedStyle { single_line: false },
                )?;
                removed_diff_lines += segment.removed_line_count;
                inserted_diff_lines += segment.inserted_line_count;
            }
        }

        // defer:
        removed_line_number += segment.removed_line_count;
        inserted_line_number += segment.inserted_line_count;
    }

    writer.write_all(b"\n")?;

    print_diff_footer(writer, config, removed_diff_lines, inserted_diff_lines)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/diff/printDiff.zig (585 lines)
//   confidence: medium
//   todos:      3
//   notes:      arena allocator dropped (non-AST crate); diff_match_patch::Dmp API assumed; DiffSegment carries <'a> for borrowed slices
// ──────────────────────────────────────────────────────────────────────────
