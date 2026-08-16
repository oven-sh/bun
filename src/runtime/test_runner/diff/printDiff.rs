//! Tested in test/js/bun/test/printing/diffexample.test.ts. If modified, the snapshots will need to be updated.

use std::fmt::Write;

use bstr::BStr;

use super::text_diff::{self as diff, Hunk};
use bun_core::output::ansi as colors;
use bun_core::strings;

pub(crate) struct DiffConfig {
    pub(crate) min_bytes_before_chunking: usize,
    pub(crate) chunk_context_lines: usize,
    pub(crate) enable_ansi_colors: bool,
    pub(crate) truncate_threshold: usize,
    pub(crate) truncate_context: usize,
}

impl DiffConfig {
    pub(crate) fn default(is_agent: bool, enable_ansi_colors: bool) -> DiffConfig {
        DiffConfig {
            min_bytes_before_chunking: if is_agent { 0 } else { 2 * 1024 }, // 2kb
            chunk_context_lines: if is_agent { 1 } else { 5 },
            enable_ansi_colors,
            truncate_threshold: if is_agent { 1024 } else { 2 * 1024 }, // 2kb
            truncate_context: if is_agent { 50 } else { 100 },
        }
    }
}

pub(crate) fn print_diff_main(
    not: bool,
    received_slice: &[u8],
    expected_slice: &[u8],
    writer: &mut impl Write,
    config: &DiffConfig,
) -> std::fmt::Result {
    if not {
        match config.enable_ansi_colors {
            true => write!(
                writer,
                "Expected: not {RED}{}{RESET}",
                BStr::new(expected_slice),
                RED = colors::RED,
                RESET = colors::RESET,
            )?,
            false => write!(writer, "Expected: not {}", BStr::new(expected_slice))?,
        }
        return Ok(());
    }

    let mut p = Printer {
        out: Vec::with_capacity((received_slice.len() + expected_slice.len()).min(1 << 20)),
        colors: config.enable_ansi_colors,
        config,
        chars: diff::CharDiff::default(),
    };

    if strings::index_of_char(received_slice, b'\n').is_none()
        && strings::index_of_char(expected_slice, b'\n').is_none()
    {
        p.modified(expected_slice, received_slice, true);
    } else {
        let hunks = diff::diff_lines(expected_slice, received_slice);
        p.diff(expected_slice, received_slice, &hunks);
    }
    write!(writer, "{}", BStr::new(&p.out))
}

#[derive(Clone, Copy)]
struct Style {
    prefix: &'static str,
    prefix_color: &'static str,
    text_color: &'static str,
}

mod styles {
    use super::{Style, colors};
    const RED_INVERT: &str = const_format::concatcp!(colors::RED, colors::INVERT);
    const GREEN_INVERT: &str = const_format::concatcp!(colors::GREEN, colors::INVERT);

    pub(super) const INSERTED: Style = Style {
        prefix: "+ ",
        prefix_color: colors::RED,
        text_color: colors::RED,
    };
    pub(super) const REMOVED: Style = Style {
        prefix: "- ",
        prefix_color: colors::GREEN,
        text_color: colors::GREEN,
    };
    pub(super) const INSERTED_WHITESPACE: Style = Style {
        text_color: RED_INVERT,
        ..INSERTED
    };
    pub(super) const REMOVED_WHITESPACE: Style = Style {
        text_color: GREEN_INVERT,
        ..REMOVED
    };
    pub(super) const EQUAL: Style = Style {
        prefix: "  ",
        prefix_color: "",
        text_color: colors::DIM,
    };
    pub(super) const SINGLE_LINE_INSERTED: Style = Style {
        prefix: "Received: ",
        prefix_color: "",
        ..INSERTED
    };
    pub(super) const SINGLE_LINE_REMOVED: Style = Style {
        prefix: "Expected: ",
        prefix_color: "",
        ..REMOVED
    };
}

struct Printer<'c> {
    out: Vec<u8>,
    colors: bool,
    config: &'c DiffConfig,
    chars: diff::CharDiff,
}

/// One row-group of the rendered diff. `Equal` covers a whole run of
/// unchanged lines; context trimming happens at print time.
#[derive(Clone, Copy)]
enum Segment<'a> {
    Equal {
        text: &'a [u8],
        lines: usize,
    },
    Removed {
        text: &'a [u8],
        lines: usize,
    },
    Inserted {
        text: &'a [u8],
        lines: usize,
    },
    Modified {
        removed: &'a [u8],
        inserted: &'a [u8],
        removed_lines: usize,
        inserted_lines: usize,
    },
    /// Unchanged lines elided from the output.
    Skipped {
        lines: usize,
    },
}

fn remove_trailing_newline(text: &[u8]) -> &[u8] {
    text.strip_suffix(b"\n").unwrap_or(text)
}

fn line_count(text: &[u8]) -> usize {
    strings::count_char(text, b'\n') + 1
}

/// Byte offset just past the `n`th newline, or `None` if there are fewer.
fn after_nth_newline(text: &[u8], n: usize) -> Option<usize> {
    let mut at = 0;
    for _ in 0..n {
        at += strings::index_of_char_usize(&text[at..], b'\n')? + 1;
    }
    Some(at)
}

/// Byte offset of the start of the `n`th-from-last line, or `None` if there
/// are no more than `n` lines.
fn start_of_last_n_lines(text: &[u8], n: usize) -> Option<usize> {
    let mut at = text.len();
    for _ in 0..n {
        at = strings::last_index_of_char(&text[..at], b'\n')?;
    }
    Some(at + 1)
}

impl<'c> Printer<'c> {
    #[inline]
    fn s(&mut self, s: &str) {
        self.out.extend_from_slice(s.as_bytes());
    }
    #[inline]
    fn b(&mut self, b: &[u8]) {
        self.out.extend_from_slice(b);
    }
    #[inline]
    fn color(&mut self, c: &str) {
        if self.colors {
            self.s(c);
        }
    }
    fn num(&mut self, n: usize) {
        let mut buf = [0u8; 20];
        let mut i = buf.len();
        let mut n = n;
        loop {
            i -= 1;
            buf[i] = b'0' + (n % 10) as u8;
            n /= 10;
            if n == 0 {
                break;
            }
        }
        self.b(&buf[i..]);
    }

    fn diff(&mut self, expected: &[u8], received: &[u8], hunks: &[Hunk]) {
        let mut segments: Vec<Segment> = Vec::with_capacity(hunks.len() * 3 + 2);
        let mut prev_a = 0;
        for h in hunks {
            if h.a_lo > prev_a {
                segments.push(Segment::Equal {
                    text: &expected[prev_a..h.a_lo],
                    lines: 0,
                });
            }
            let (removed, inserted) = (&expected[h.a_lo..h.a_hi], &received[h.b_lo..h.b_hi]);
            segments.push(match (removed.is_empty(), inserted.is_empty()) {
                (false, false) => Segment::Modified {
                    removed,
                    inserted,
                    removed_lines: 0,
                    inserted_lines: 0,
                },
                (false, true) => Segment::Removed {
                    text: removed,
                    lines: 0,
                },
                (true, _) => Segment::Inserted {
                    text: inserted,
                    lines: 0,
                },
            });
            prev_a = h.a_hi;
        }
        if prev_a < expected.len() {
            segments.push(Segment::Equal {
                text: &expected[prev_a..],
                lines: 0,
            });
        }

        // Every segment but the last ends in a newline that belongs to the row
        // structure rather than the content.
        let last = segments.len().saturating_sub(1);
        for (i, seg) in segments.iter_mut().enumerate() {
            fn id(t: &[u8]) -> &[u8] {
                t
            }
            let trim = if i < last {
                remove_trailing_newline
            } else {
                id
            };
            match seg {
                Segment::Equal { text, lines }
                | Segment::Removed { text, lines }
                | Segment::Inserted { text, lines } => {
                    *text = trim(text);
                    *lines = line_count(text);
                }
                Segment::Modified {
                    removed,
                    inserted,
                    removed_lines,
                    inserted_lines,
                } => {
                    *removed = trim(removed);
                    *inserted = trim(inserted);
                    *removed_lines = line_count(removed);
                    *inserted_lines = line_count(inserted);
                }
                Segment::Skipped { .. } => {}
            }
        }

        let chunked = expected.len() > self.config.min_bytes_before_chunking
            || received.len() > self.config.min_bytes_before_chunking;
        if chunked {
            // Keep `ctx` lines of each equal run next to a change; elide the rest.
            let ctx = self.config.chunk_context_lines;
            let mut out: Vec<Segment> = Vec::with_capacity(segments.len() + hunks.len() + 2);
            let n = segments.len();
            for (i, seg) in segments.into_iter().enumerate() {
                let Segment::Equal { text, lines } = seg else {
                    out.push(seg);
                    continue;
                };
                let keep_head = if i > 0 { ctx } else { 0 };
                let keep_tail = if i + 1 < n { ctx } else { 0 };
                if lines <= keep_head + keep_tail {
                    out.push(seg);
                    continue;
                }
                if keep_head > 0 {
                    let head_end = after_nth_newline(text, keep_head).unwrap();
                    out.push(Segment::Equal {
                        text: &text[..head_end - 1],
                        lines: keep_head,
                    });
                }
                out.push(Segment::Skipped {
                    lines: lines - keep_head - keep_tail,
                });
                if keep_tail > 0 {
                    let tail_start = start_of_last_n_lines(text, keep_tail).unwrap();
                    out.push(Segment::Equal {
                        text: &text[tail_start..],
                        lines: keep_tail,
                    });
                }
            }
            segments = out;
        }

        self.segments(&segments);
    }

    fn segments(&mut self, segments: &[Segment<'_>]) {
        let mut removed_line_number: usize = 1;
        let mut inserted_line_number: usize = 1;
        let mut removed_diff_lines: usize = 0;
        let mut inserted_diff_lines: usize = 0;

        let has_skipped = segments
            .iter()
            .any(|s| matches!(s, Segment::Skipped { .. }));
        let mut was_skipped = has_skipped;
        for (i, seg) in segments.iter().enumerate() {
            if let Segment::Skipped { lines } = *seg {
                was_skipped = true;
                removed_line_number += lines;
                inserted_line_number += lines;
                continue;
            }
            if was_skipped {
                was_skipped = false;
                let (mut original, mut changed) = (0, 0);
                for seg in &segments[i..] {
                    match *seg {
                        Segment::Skipped { .. } => break,
                        Segment::Equal { lines, .. } => {
                            original += lines;
                            changed += lines;
                        }
                        Segment::Removed { lines, .. } => original += lines,
                        Segment::Inserted { lines, .. } => changed += lines,
                        Segment::Modified {
                            removed_lines,
                            inserted_lines,
                            ..
                        } => {
                            original += removed_lines;
                            changed += inserted_lines;
                        }
                    }
                }
                self.hunk_header(removed_line_number, original, inserted_line_number, changed);
            }
            match *seg {
                Segment::Equal { text, lines } => {
                    self.rows(text, styles::EQUAL);
                    removed_line_number += lines;
                    inserted_line_number += lines;
                }
                Segment::Removed { text, lines } => {
                    self.rows(text, styles::REMOVED);
                    removed_line_number += lines;
                    removed_diff_lines += lines;
                }
                Segment::Inserted { text, lines } => {
                    self.rows(text, styles::INSERTED);
                    inserted_line_number += lines;
                    inserted_diff_lines += lines;
                }
                Segment::Modified {
                    removed,
                    inserted,
                    removed_lines,
                    inserted_lines,
                } => {
                    self.modified(removed, inserted, false);
                    removed_line_number += removed_lines;
                    inserted_line_number += inserted_lines;
                    removed_diff_lines += removed_lines;
                    inserted_diff_lines += inserted_lines;
                }
                Segment::Skipped { .. } => unreachable!(),
            }
        }
        self.s("\n");

        // Footer.
        self.color(styles::REMOVED.prefix_color);
        self.s("- Expected  - ");
        self.num(removed_diff_lines);
        self.color(colors::RESET);
        self.s("\n");
        self.color(styles::INSERTED.prefix_color);
        self.s("+ Received  + ");
        self.num(inserted_diff_lines);
        self.color(colors::RESET);
    }

    fn hunk_header(
        &mut self,
        original_line: usize,
        original_count: usize,
        changed_line: usize,
        changed_count: usize,
    ) {
        self.color(colors::YELLOW);
        self.s("@@ -");
        self.num(original_line);
        self.s(",");
        self.num(original_count);
        self.s(" +");
        self.num(changed_line);
        self.s(",");
        self.num(changed_count);
        self.s(" @@");
        self.color(colors::RESET);
        self.s("\n");
    }

    fn prefix(&mut self, style: Style) {
        self.color(style.prefix_color);
        self.s(style.prefix);
        self.color(colors::RESET);
    }

    /// `text` as whole rows: prefix, content, newline for each line.
    fn rows(&mut self, text: &[u8], style: Style) {
        self.prefix(style);
        self.segment(text, style);
        self.s("\n");
    }

    /// `text` continuing the current row; embedded newlines start new rows
    /// with `style`'s prefix.
    fn segment(&mut self, text: &[u8], style: Style) {
        let mut rest = text;
        loop {
            let (line, next) = match strings::index_of_char_usize(rest, b'\n') {
                Some(i) => (&rest[..i], Some(&rest[i + 1..])),
                None => (rest, None),
            };
            self.truncated_line(line, style);
            let Some(next) = next else { break };
            self.s("\n");
            self.prefix(style);
            rest = next;
        }
    }

    fn truncated_line(&mut self, line: &[u8], style: Style) {
        let ctx = self.config.truncate_context;
        if line.len() <= self.config.truncate_threshold || line.len() <= ctx * 2 {
            self.color(style.text_color);
            self.b(line);
            self.color(colors::RESET);
            return;
        }
        self.color(style.text_color);
        self.b(&line[..ctx]);
        self.color(colors::RESET);

        self.color(colors::BRIGHT_WHITE);
        self.s("... (");
        self.num(line.len() - 2 * ctx);
        self.s(" bytes truncated) ...");
        self.color(colors::RESET);

        self.color(style.text_color);
        self.b(&line[line.len() - ctx..]);
        self.color(colors::RESET);
    }

    fn modified_without_highlight(
        &mut self,
        removed: &[u8],
        inserted: &[u8],
        rs: Style,
        is: Style,
        single_line: bool,
    ) {
        self.prefix(rs);
        self.segment(removed, styles::REMOVED);
        self.s("\n");
        self.prefix(is);
        self.segment(inserted, styles::INSERTED);
        if !single_line {
            self.s("\n");
        }
    }

    fn modified(&mut self, removed: &[u8], inserted: &[u8], single_line: bool) {
        let (rs, is) = match single_line {
            true => (styles::SINGLE_LINE_REMOVED, styles::SINGLE_LINE_INSERTED),
            false => (styles::REMOVED, styles::INSERTED),
        };

        // When `smaller * 3 < larger`, the larger side's highlighted length is
        // at least `larger - smaller > larger * 2/3`, which trips the bailout
        // below regardless, so skip the character diff.
        let larger = removed.len().max(inserted.len());
        let smaller = removed.len().min(inserted.len());
        if larger > 30 && smaller.saturating_mul(3) < larger {
            return self.modified_without_highlight(removed, inserted, rs, is, single_line);
        }

        let mut chars = core::mem::take(&mut self.chars);
        let hunks = chars.diff(removed, inserted);
        'highlight: {
            let deleted_highlighted: usize = hunks.iter().map(Hunk::deleted).sum();
            let inserted_highlighted: usize = hunks.iter().map(Hunk::inserted).sum();
            if (deleted_highlighted > 10 && deleted_highlighted > removed.len() / 3 * 2)
                || (inserted_highlighted > 10 && inserted_highlighted > inserted.len() / 3 * 2)
            {
                // The diff is too significant (more than 2/3 of one side is
                // modified), so highlighting would just be noise.
                self.modified_without_highlight(removed, inserted, rs, is, single_line);
                break 'highlight;
            }

            let splits_utf8 = |h: &Hunk| {
                let cont = |s: &[u8], i: usize| s.get(i).is_some_and(|&c| (c & 0xC0) == 0x80);
                cont(removed, h.a_lo)
                    || cont(removed, h.a_hi)
                    || cont(inserted, h.b_lo)
                    || cont(inserted, h.b_hi)
            };
            if hunks.iter().any(splits_utf8) {
                self.modified_without_highlight(removed, inserted, rs, is, single_line);
                break 'highlight;
            }

            self.prefix(rs);
            let mut prev = 0;
            for h in hunks {
                self.nonempty_segment(&removed[prev..h.a_lo], styles::REMOVED);
                self.highlighted(
                    &removed[h.a_lo..h.a_hi],
                    styles::REMOVED,
                    styles::REMOVED_WHITESPACE,
                );
                prev = h.a_hi;
            }
            self.nonempty_segment(&removed[prev..], styles::REMOVED);
            self.s("\n");

            self.prefix(is);
            let mut prev = 0;
            for h in hunks {
                self.nonempty_segment(&inserted[prev..h.b_lo], styles::INSERTED);
                self.highlighted(
                    &inserted[h.b_lo..h.b_hi],
                    styles::INSERTED,
                    styles::INSERTED_WHITESPACE,
                );
                prev = h.b_hi;
            }
            self.nonempty_segment(&inserted[prev..], styles::INSERTED);
            if !single_line {
                self.s("\n");
            }
        }
        self.chars = chars;
    }

    fn nonempty_segment(&mut self, text: &[u8], style: Style) {
        if !text.is_empty() {
            self.segment(text, style);
        }
    }

    fn highlighted(&mut self, text: &[u8], style: Style, whitespace_style: Style) {
        if text.is_empty() {
            return;
        }
        // Whitespace/control-only changes are invisible in a foreground
        // colour, so those get a background instead.
        if text.iter().all(|&c| c <= 0x20 || c == 0x7F) {
            self.segment(text, whitespace_style);
        } else {
            self.segment(text, style);
        }
    }
}
