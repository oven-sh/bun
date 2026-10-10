use crate::autolinks::{find_permissive_autolink, is_emph_boundary_resolved};
use crate::compat;
use crate::helpers;
use crate::links::{BracketMatches, LabelLeave};
use crate::parser::{self, MARK_DELIMITER, MARK_EXTENSION, MARK_HIDES, Parser};
use crate::types::{OFF, SpanStart, SpanType, TextType, VerbatimLine};

/// Emphasis delimiter entry for CommonMark emphasis algorithm.
pub(crate) const MAX_EMPH_MATCHES: usize = 6;

/// Snapshot of an enclosing slice's walk state while one of its link/image/
/// wikilink labels is rendered. `base..end` locate the enclosing slice
/// within the block's inline content; `i`/`text_start`/`delim_cursor` are
/// local to that slice. See `process_inline_content`.
pub(crate) struct LabelFrame {
    base: usize,
    end: usize,
    i: usize,
    text_start: usize,
    resolved: Vec<EmphDelim>,
    delim_cursor: usize,
    leave: LabelLeave,
    /// Where what closes the label is in the block's inline content: `](href)`.
    close: (usize, usize),
}

/// What hides the markers in it: they stand for themselves.
#[derive(Clone, Copy)]
pub(crate) struct Hidden {
    pub(crate) beg: usize,
    pub(crate) end: usize,
    pub(crate) kind: HiddenKind,
}

#[derive(Clone, Copy)]
pub(crate) enum HiddenKind {
    /// A code span between two runs of so many backticks.
    Code {
        ticks: usize,
    },
    /// Backticks that nothing closes.
    Backticks,
    Html,
    Autolink {
        is_email: bool,
    },
    FootnoteReference,
    /// See `Extensions::span`.
    Extension {
        tag: u32,
    },
}

/// Where a scan of the block's inline content is in `Parser::marks` and in
/// `Parser::hidden`.
#[derive(Clone, Copy, Default)]
pub(crate) struct Walk {
    mark: usize,
    hidden: usize,
}

/// The index of the first of `sorted[from..]` that is not before a place. Most of
/// the time it is near.
#[inline]
fn skip_before<T>(sorted: &[T], from: usize, is_before: impl Fn(&T) -> bool) -> usize {
    let mut index = from;
    for _ in 0..4 {
        match sorted.get(index) {
            Some(it) if is_before(it) => index += 1,
            _ => return index,
        }
    }
    index + sorted[index..].partition_point(is_before)
}

#[derive(Clone, Copy)]
pub struct EmphDelim {
    pub(crate) pos: usize,    // start position in content
    pub(crate) count: usize,  // original run length
    pub(crate) emph_char: u8, // * or _
    pub(crate) can_open: bool,
    pub(crate) can_close: bool,
    pub(crate) remaining: usize,   // chars not yet consumed
    pub(crate) open_count: usize,  // total chars consumed as opener
    pub(crate) close_count: usize, // total chars consumed as closer
    // Individual match sizes in order (each is 1 for em, 2 for strong)
    pub(crate) open_sizes: [u8; MAX_EMPH_MATCHES],
    pub(crate) open_num: u8, // number of open matches
    pub(crate) close_sizes: [u8; MAX_EMPH_MATCHES],
    pub(crate) close_num: u8, // number of close matches
    pub(crate) active: bool,  // false if deactivated between matched pairs
}

impl Default for EmphDelim {
    fn default() -> Self {
        Self {
            pos: 0,
            count: 0,
            emph_char: 0,
            can_open: false,
            can_close: false,
            remaining: 0,
            open_count: 0,
            close_count: 0,
            open_sizes: [0; MAX_EMPH_MATCHES],
            open_num: 0,
            close_sizes: [0; MAX_EMPH_MATCHES],
            close_num: 0,
            active: true,
        }
    }
}

/// Closing-delimiter kinds tracked by `HtmlScanMemo`.
#[derive(Clone, Copy)]
enum HtmlScanKind {
    /// `<!--` … `-->`
    Comment = 0,
    /// `<?` … `?>`
    ProcessingInstruction = 1,
    /// `<!` + uppercase letter … `>`
    Declaration = 2,
    /// `<![CDATA[` … `]]>`
    Cdata = 3,
}

pub(crate) const HTML_SCAN_KIND_COUNT: usize = 4;

/// Memo of failed closing-delimiter searches in `find_html_tag`.
///
/// A `<!--` / `<?` / `<!DECL` / `<![CDATA[` candidate scans forward for a
/// terminator that may not exist, reaching the end of the inline slice. Once
/// one such scan has failed from some position, any later scan of the same
/// kind starting at or beyond that position must fail too, so it can return
/// immediately instead of rescanning to the end — that rescan is quadratic on
/// inputs with many unterminated openers in one paragraph (found by fuzzing).
///
/// The memo describes one slice at a time, keyed by address + length. Because
/// `find_html_tag` is also called on link-label sub-slices of that slice (with
/// their own coordinates), a recorded fact serves any sub-slice query by
/// translating positions with the sub-slice's offset: "no terminator at or
/// after position P of the paragraph" covers every later position of every
/// label inside it. Sub-slice scans never overwrite the enclosing slice's
/// entry (they prove nothing beyond their own extent), and
/// `process_inline_content` starts each block's slice from an empty memo, so
/// recycled merged-line buffers and transient table-cell buffers can never
/// alias a previous slice's entry.
#[derive(Clone, Copy)]
pub struct HtmlScanMemo {
    slice_addr: usize,
    slice_len: usize,
    no_terminator_from: [usize; HTML_SCAN_KIND_COUNT],
}

impl HtmlScanMemo {
    pub(crate) const EMPTY: HtmlScanMemo = HtmlScanMemo {
        slice_addr: 0,
        slice_len: 0,
        no_terminator_from: [usize::MAX; HTML_SCAN_KIND_COUNT],
    };

    fn applies_to(&self, content: &[u8]) -> bool {
        self.slice_addr == content.as_ptr() as usize && self.slice_len == content.len()
    }

    /// If `content` lies within the memoized slice, returns its offset from
    /// that slice's start (0 for the memoized slice itself).
    fn offset_within(&self, content: &[u8]) -> Option<usize> {
        let addr = content.as_ptr() as usize;
        if self.slice_addr <= addr && addr + content.len() <= self.slice_addr + self.slice_len {
            Some(addr - self.slice_addr)
        } else {
            None
        }
    }
}

impl Parser<'_> {
    /// Merge all lines into buffer with \n between them (unmodified),
    /// then process inlines on the merged text. Hard/soft breaks are detected
    /// during inline processing when \n is encountered.
    pub(crate) fn process_leaf_block(
        &mut self,
        block_lines: &[VerbatimLine],
        trim_trailing: bool,
    ) -> Result<(), parser::Error> {
        if block_lines.is_empty() {
            return Ok(());
        }

        self.inline_lines.clear();
        self.inline_line = 0;
        // One line is not copied
        if let [vline] = block_lines
            && vline.beg <= vline.end
            && vline.end <= self.size
        {
            if self.track {
                self.inline_lines.push((0, vline.beg));
            }
            let text = self.text;
            let mut line = &text[vline.beg as usize..vline.end as usize];
            if trim_trailing {
                line = helpers::trim_blank_end(line);
            }
            return self.process_inline_content(line);
        }

        self.buffer.clear();
        for vline in block_lines {
            if vline.beg > vline.end || vline.end > self.size {
                continue;
            }

            if !self.buffer.is_empty() {
                self.buffer.push(b'\n');
            }
            if self.track {
                self.inline_lines
                    .push((self.buffer.len() as u32, vline.beg));
            }
            self.buffer
                .extend_from_slice(&self.text[vline.beg as usize..vline.end as usize]);
        }

        // For headings, trim trailing whitespace
        let mut merged_len = self.buffer.len();
        if trim_trailing {
            while merged_len > 0
                && (self.buffer[merged_len - 1] == b' ' || self.buffer[merged_len - 1] == b'\t')
            {
                merged_len -= 1;
            }
        }
        // take() the Vec out so process_inline_content gets a fresh
        // self.buffer to scribble on without aliasing. Verified: nothing
        // reachable from process_inline_content (label frames operate solely
        // on `content` subslices) touches `self.buffer`; its other users
        // (ref-def merging in blocks.rs/ref_defs.rs) run during the block
        // phase, never re-entrantly from here.
        let merged = core::mem::take(&mut self.buffer);
        let ret = self.process_inline_content(&merged[..merged_len]);
        self.buffer = merged;
        ret
    }

    pub(crate) fn process_inline_content(&mut self, content: &[u8]) -> Result<(), parser::Error> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(parser::Error::StackOverflow);
        }

        // Failed HTML terminator searches recorded for another slice must not
        // leak into this one (the merged-line buffer is recycled across blocks,
        // so a stale entry could alias a new slice of the same length).
        // Label frames below are subslices of `content`, so the memo stays
        // valid for them via `offset_within`.
        self.html_scan_memo.set(HtmlScanMemo::EMPTY);

        self.inline_serial = self.inline_serial.wrapping_add(1);

        // Fast path: no character has a special meaning
        self.find_marks(content);
        if self.marks.is_empty() {
            if !content.is_empty() {
                self.at(0, content.len());
                self.emit_text(TextType::Normal, content)?;
            }
            return Ok(());
        }

        // Bracket-pair map for the whole slice: link processing looks up the
        // ']' matching a '[' here instead of rescanning the rest of the slice
        // for every opener. Label frames share this map (with their offset as
        // `base`) instead of rebuilding it per nesting level; a per-level
        // rebuild costs O(label) each and is quadratic on inputs like
        // `"![".repeat(n) + "](u)".repeat(n)`. The backing storage is
        // recycled via self.bracket_pairs.
        let bracket_storage = core::mem::take(&mut self.bracket_pairs);
        let brackets = self.compute_bracket_matches(content, bracket_storage);

        // A link/image/wikilink label is rendered as inline content of its
        // own: emphasis pairs within the label, and nested constructs inside
        // it are rendered recursively. That recursion is driven iteratively
        // with this frame stack so nesting depth is bounded by the heap, not
        // the native stack. Each frame snapshots the enclosing slice's walk
        // state plus the close action for the label being entered. The
        // backing vec is recycled through `Parser.label_frames` so blocks
        // with links do not allocate a stack per block in steady state.
        let mut frames: Vec<LabelFrame> = core::mem::take(&mut self.label_frames);
        debug_assert!(frames.is_empty());

        // Walk state for the current (innermost) slice. `base` is the
        // slice's offset within `content`, which `brackets` was built for
        // (`cur` is always `content[base..base + cur.len()]`).
        let mut cur: &[u8] = content;
        let mut base: usize = 0;

        // Phase 1: Collect and resolve emphasis delimiters
        let mut walk = Walk::default();
        self.collect_emphasis_delimiters(cur, &brackets, base, walk, false);
        self.resolve_emphasis_delimiters();

        // Take the resolved delimiters (label frames reuse emph_delims)
        let mut resolved: Vec<EmphDelim> = core::mem::take(&mut self.emph_delims);

        // Phase 2: Emit content using resolved emphasis info
        let mut i: usize = 0;
        let mut text_start: usize = 0;
        let mut delim_cursor: usize = 0;

        // Enter the label of a just-parsed link/image/wikilink: snapshot the
        // current walk state and restart the walk on the label slice.
        macro_rules! enter_label {
            ($parse:expr) => {{
                let parse = $parse;
                frames.push(LabelFrame {
                    base,
                    end: base + cur.len(),
                    i: parse.link_end,
                    text_start: parse.link_end,
                    resolved: core::mem::take(&mut resolved),
                    delim_cursor,
                    leave: parse.leave,
                    close: (base + parse.label_end, base + parse.link_end),
                });
                base += parse.label_start;
                cur = &cur[parse.label_start..parse.label_end];
                self.collect_emphasis_delimiters(cur, &brackets, base, walk, true);
                self.resolve_emphasis_delimiters();
                resolved = core::mem::take(&mut self.emph_delims);
                i = 0;
                text_start = 0;
                delim_cursor = 0;
            }};
        }

        'frames: loop {
            while i < cur.len() {
                let content = cur;

                // Fast path: characters without a special meaning, skip them
                let mark = self.next_mark(&mut walk, base + i);
                if mark >= base + content.len() {
                    break;
                }
                i = mark - base;
                let c = content[i];

                // The text that has not been emitted yet, up to `$end`.
                macro_rules! flush_text {
                    ($end:expr) => {
                        if $end > text_start {
                            self.at(base + text_start, base + $end);
                            self.emit_text(TextType::Normal, &content[text_start..$end])?;
                        }
                    };
                }

                // Newline from merged lines — check for hard break
                if c == b'\n' {
                    let mut emit_end = i;
                    let mut is_hard = false;
                    if emit_end > text_start && content[emit_end - 1] == b'\\' {
                        emit_end -= 1;
                        is_hard = true;
                    } else {
                        let mut sp = emit_end;
                        while sp > text_start && content[sp - 1] == b' ' {
                            sp -= 1;
                        }
                        if emit_end - sp >= 2 {
                            // Also strip any trailing tabs/spaces before the space run
                            let spaces = sp;
                            while sp > text_start
                                && (content[sp - 1] == b' ' || content[sp - 1] == b'\t')
                            {
                                sp -= 1;
                            }
                            is_hard = sp == spaces
                                || !compat::tab_before_the_blanks_is_no_hard_break(&self.flags);
                            if is_hard {
                                emit_end = sp;
                            }
                        }
                    }
                    flush_text!(emit_end);
                    if is_hard {
                        self.at(base + emit_end, base + i + 1);
                        self.emit_text(TextType::Br, b"")?;
                    } else {
                        self.at(base + i, base + i + 1);
                        self.emit_text(TextType::Softbr, b"")?;
                    }
                    i += 1;
                    text_start = i;
                    continue;
                }

                // Check for backslash escape
                if c == b'\\'
                    && i + 1 < content.len()
                    && helpers::is_ascii_punctuation(content[i + 1])
                {
                    flush_text!(i);
                    self.at(base + i, base + i + 2);
                    i += 1;
                    self.emit_text(TextType::Normal, &content[i..i + 1])?;
                    i += 1;
                    text_start = i;
                    continue;
                }

                // Code spans, HTML tags, autolinks
                if let Some(Hidden { beg, end, kind }) = self.hidden_over(&walk, content, base, i) {
                    flush_text!(beg);
                    match kind {
                        HiddenKind::Code { ticks } => {
                            self.at(base + beg, base + beg + ticks);
                            self.enter_span(SpanType::Code)?;
                            let whole = &content[beg + ticks..end - ticks];
                            let code_content = self.normalize_code_span_content(whole);
                            let code_beg =
                                base + beg + ticks + (whole.len() - code_content.len()) / 2;
                            self.at(code_beg, code_beg + code_content.len());
                            self.emit_text(TextType::Code, code_content)?;
                            self.at(base + end - ticks, base + end);
                            self.leave_span(SpanType::Code)?;
                        }
                        HiddenKind::Backticks => {
                            self.at(base + beg, base + end);
                            self.emit_text(TextType::Normal, &content[beg..end])?;
                        }
                        HiddenKind::Html => {
                            self.at(base + beg, base + end);
                            self.emit_text(TextType::Html, &content[beg..end])?;
                        }
                        HiddenKind::Autolink { is_email } => {
                            self.render_autolink(&content[beg + 1..end - 1], is_email, base + beg)?;
                        }
                        HiddenKind::FootnoteReference => {
                            self.render_footnote_reference(&content[beg + 2..end - 1], base + beg)?;
                        }
                        HiddenKind::Extension { tag } => {
                            self.at(base + beg, base + end);
                            self.renderer.ptr.extension_span(tag, &content[beg..end])?;
                        }
                    }
                    i = end;
                    text_start = i;
                    continue;
                }
                // It could only have hidden something.
                if self.mark_char_map[c as usize] & !(MARK_HIDES | MARK_EXTENSION) == 0 {
                    i += 1;
                    continue;
                }

                // Emphasis/strikethrough with * or _ or ~ — use resolved delimiters
                if c == b'*' || c == b'_' || (c == b'~' && self.flags.strikethrough) {
                    // Find the corresponding resolved delimiter
                    while delim_cursor < resolved.len() && resolved[delim_cursor].pos < i {
                        delim_cursor += 1;
                    }

                    if delim_cursor < resolved.len() && resolved[delim_cursor].pos == i {
                        flush_text!(i);

                        let d = &resolved[delim_cursor];
                        let run_end = d.pos + d.count;
                        // Where the next marker of the run is.
                        let mut marker = base + i;

                        // Emit closing tags first (innermost to outermost)
                        if d.emph_char == b'~' {
                            if d.close_count > 0 {
                                self.at(marker, marker + d.close_count);
                                self.leave_span(SpanType::Del)?;
                                marker += d.close_count;
                            }
                        } else {
                            self.emit_emph_close_tags(
                                &d.close_sizes[0..d.close_num as usize],
                                &mut marker,
                            )?;
                        }

                        // Emit remaining delimiter chars as text
                        let text_chars = d.count.saturating_sub(d.open_count + d.close_count);
                        if text_chars > 0 {
                            self.at(marker, marker + text_chars);
                            self.emit_text(TextType::Normal, &content[i..i + text_chars])?;
                            marker += text_chars;
                        }

                        // Emit opening tags (outermost to innermost)
                        if d.emph_char == b'~' {
                            if d.open_count > 0 {
                                self.at(marker, marker + d.open_count);
                                self.enter_span(SpanType::Del)?;
                            }
                        } else {
                            self.emit_emph_open_tags(
                                &d.open_sizes[0..d.open_num as usize],
                                &mut marker,
                            )?;
                        }

                        delim_cursor += 1;
                        i = run_end;
                        text_start = i;
                        continue;
                    }
                    // No resolved delimiter found, just advance
                    i += 1;
                    continue;
                }

                // HTML entity
                if c == b'&' {
                    if let Some(end_pos) = self.find_entity(content, i) {
                        flush_text!(i);
                        self.at(base + i, base + end_pos);
                        self.emit_text(TextType::Entity, &content[i..end_pos])?;
                        i = end_pos;
                        text_start = i;
                        continue;
                    }
                }

                // Wiki links: [[destination]] or [[destination|label]]
                if c == b'['
                    && self.flags.wiki_links
                    && i + 1 < content.len()
                    && content[i + 1] == b'['
                {
                    flush_text!(i);
                    if let Some(parse) = self.process_wiki_link(content, i, base)? {
                        enter_label!(parse);
                        continue;
                    }
                    // No wikilink matched: restore text_start so preceding text
                    // isn't double-emitted by the next span branch.
                    text_start = i;
                }

                // Links: [text](url) or [text][ref]
                if c == b'[' {
                    flush_text!(i);
                    if let Some(parse) = self.process_link(content, i, false, &brackets, base)? {
                        enter_label!(parse);
                    } else {
                        self.at(base + i, base + i + 1);
                        self.emit_text(TextType::Normal, b"[")?;
                        i += 1;
                        text_start = i;
                    }
                    continue;
                }

                // Images: ![text](url)
                if c == b'!' && i + 1 < content.len() && content[i + 1] == b'[' {
                    flush_text!(i);
                    if let Some(parse) = self.process_link(content, i + 1, true, &brackets, base)? {
                        enter_label!(parse);
                    } else {
                        self.at(base + i, base + i + 1);
                        self.emit_text(TextType::Normal, b"!")?;
                        i += 1;
                        text_start = i;
                    }
                    continue;
                }

                // Note: Strikethrough (~) is handled above via the resolved delimiter system

                // Permissive autolinks: detect URL, email, and WWW autolinks
                // Suppress inside explicit links to avoid double-wrapping (md4c issue #152)
                if self.link_nesting_level == 0
                    && ((c == b':' && self.flags.permissive_url_autolinks)
                        || (c == b'@' && self.flags.permissive_email_autolinks)
                        || (c == b'.' && self.flags.permissive_www_autolinks))
                {
                    // First try with strict boundaries, then with relaxed (emphasis-aware)
                    let mut al = find_permissive_autolink(content, i, false);
                    if al.is_none() {
                        al = find_permissive_autolink(content, i, true);
                        if let Some(a) = al {
                            if !is_emph_boundary_resolved(content, a, &resolved) {
                                al = None;
                            }
                        }
                    }
                    if let Some(a) = al {
                        flush_text!(a.beg);

                        // Determine URL prefix and render through the renderer
                        let link_text = &content[a.beg..a.end];
                        self.at(base + a.beg, base + a.beg);
                        self.renderer.enter_span(
                            SpanType::A,
                            crate::types::SpanDetail {
                                href: link_text,
                                permissive_autolink: true,
                                autolink_email: c == b'@',
                                autolink_www: c == b'.',
                                ..Default::default()
                            },
                        )?;
                        self.at(base + a.beg, base + a.end);
                        self.emit_text(TextType::Normal, link_text)?;
                        self.at(base + a.end, base + a.end);
                        self.renderer.leave_span(SpanType::A)?;
                        i = a.end;
                        text_start = i;
                        continue;
                    }
                }

                // Null character
                if c == 0 {
                    flush_text!(i);
                    self.at(base + i, base + i + 1);
                    self.emit_text(TextType::NullChar, b"")?;
                    i += 1;
                    text_start = i;
                    continue;
                }

                i += 1;
            }

            // Current slice fully walked: flush its trailing text, then
            // either close the finished label and resume its enclosing
            // slice, or, for the outermost slice, finish.
            if text_start < cur.len() {
                self.at(base + text_start, base + cur.len());
                self.emit_text(TextType::Normal, &cur[text_start..])?;
            }
            match frames.pop() {
                Some(frame) => {
                    self.at(frame.close.0, frame.close.1);
                    match frame.leave {
                        LabelLeave::AltText => {}
                        LabelLeave::Image => {
                            self.image_nesting_level -= 1;
                            self.renderer.leave_span(SpanType::Img)?;
                        }
                        LabelLeave::Link => {
                            self.link_nesting_level -= 1;
                            self.renderer.leave_span(SpanType::A)?;
                        }
                        LabelLeave::Wikilink => {
                            self.renderer.leave_span(SpanType::Wikilink)?;
                        }
                    }
                    cur = &content[frame.base..frame.end];
                    base = frame.base;
                    i = frame.i;
                    text_start = frame.text_start;
                    // The storage of the label's delimiters is for the next label.
                    self.emph_delims = core::mem::replace(&mut resolved, frame.resolved);
                    delim_cursor = frame.delim_cursor;
                }
                None => break 'frames,
            }
        }

        // Hand the frame storage back for reuse by the next block.
        self.label_frames = frames;
        self.emph_delims = resolved;

        // Hand the bracket-map storage back for reuse by the next block.
        self.bracket_pairs = brackets.into_storage();
        Ok(())
    }

    pub(crate) fn enter_span(&mut self, span_type: SpanType) -> crate::types::JsResult<()> {
        if self.image_nesting_level > 0 {
            return Ok(());
        }
        self.renderer.enter_span(span_type, Default::default())
    }

    pub(crate) fn leave_span(&mut self, span_type: SpanType) -> crate::types::JsResult<()> {
        if self.image_nesting_level > 0 {
            return Ok(());
        }
        self.renderer.leave_span(span_type)
    }

    pub(crate) fn emit_text(
        &mut self,
        text_type: TextType,
        content: &[u8],
    ) -> crate::types::JsResult<()> {
        self.renderer.text(text_type, content)
    }

    /// Fills `marks` for `content`.
    fn find_marks(&mut self, content: &[u8]) {
        self.marks.clear();
        let mut seen = 0;
        for (index, &c) in content.iter().enumerate() {
            let meaning = self.mark_char_map[c as usize];
            if meaning != 0 {
                seen |= meaning;
                self.marks.push(index as OFF);
            }
        }
        self.marks_seen = seen;
    }

    /// Moves `walk` on to `pos` of the block's inline content. Returns where the
    /// first marked byte is from there on, `usize::MAX` if there is none.
    #[inline]
    pub(crate) fn next_mark(&self, walk: &mut Walk, pos: usize) -> usize {
        // Also what `pos` is in the middle of: the scan has taken its start for
        // something else.
        walk.hidden = skip_before(&self.hidden, walk.hidden, |it| it.beg < pos);
        walk.mark = skip_before(&self.marks, walk.mark, |&it| (it as usize) < pos);
        self.marks
            .get(walk.mark)
            .map_or(usize::MAX, |&it| it as usize)
    }

    /// What hides the marked byte at `pos` of `content`, which starts at `base`
    /// of the block's inline content. `walk` is at that byte.
    #[inline]
    fn hidden_over(&self, walk: &Walk, content: &[u8], base: usize, pos: usize) -> Option<Hidden> {
        let hidden = self.hidden.get(walk.hidden)?;
        if hidden.beg > base + pos || hidden.end > base + content.len() {
            return None;
        }
        Some(Hidden {
            beg: hidden.beg.checked_sub(base)?,
            end: hidden.end - base,
            kind: hidden.kind,
        })
    }

    /// Tells a consumer that wants to know where `beg..end` of the block's
    /// inline content is in the document.
    #[inline]
    pub(crate) fn at(&mut self, beg: usize, end: usize) {
        if self.track {
            self.tell_inline_source(beg, end);
        }
    }

    fn tell_inline_source(&mut self, beg: usize, end: usize) {
        let beg = self.in_document(beg);
        let end = match end {
            0 => self.in_document(0),
            _ => self.in_document(end - 1) + 1,
        };
        self.renderer.ptr.inline_source(beg, end);
    }

    /// Where the byte at `index` of the block's inline content is in the document.
    fn in_document(&mut self, index: usize) -> OFF {
        let lines = &self.inline_lines;
        let is_before = |line: &(u32, OFF)| line.0 as usize <= index;
        // Most of the time it is behind what was asked about last.
        let after = match lines.get(self.inline_line) {
            Some(line) if is_before(line) => skip_before(lines, self.inline_line + 1, is_before),
            _ => lines.partition_point(is_before),
        };
        self.inline_line = after.saturating_sub(1);
        match lines.get(self.inline_line) {
            Some(&(line_beg, line_in_document)) => line_in_document + (index as u32 - line_beg),
            None => 0,
        }
    }

    /// What the byte at `pos` of `content` is in that hides the markers in it.
    /// It does not start before `from`. Only the scan that fills `hidden` asks.
    pub(crate) fn hidden_at(
        &self,
        content: &[u8],
        pos: usize,
        from: usize,
        is_after_open_bracket: bool,
    ) -> Option<Hidden> {
        let c = content[pos];
        let meaning = self.mark_char_map[c as usize];
        if meaning & MARK_HIDES == 0 {
            return None;
        }
        if meaning & MARK_EXTENSION != 0
            && let Some(extensions) = self.extensions
            && let Some(span) = (extensions.span)(&SpanStart {
                content,
                pos,
                from,
                is_after_open_bracket,
                serial: self.inline_serial,
            })
            && from <= span.beg
            && span.beg <= pos
            && span.beg < span.end
            && span.end <= content.len()
        {
            return Some(Hidden {
                beg: span.beg,
                end: span.end,
                kind: HiddenKind::Extension { tag: span.tag },
            });
        }
        let (end, kind) = match c {
            b'`' => {
                let ticks = count_backticks(content, pos);
                match self.find_code_span_end(content, pos + ticks, ticks) {
                    Some(close) => (close + ticks, HiddenKind::Code { ticks }),
                    None => (pos + ticks, HiddenKind::Backticks),
                }
            }
            b'<' if !self.flags.no_html_spans => match self.find_html_tag(content, pos) {
                Some(end) => (end, HiddenKind::Html),
                None => {
                    let autolink = self.find_autolink(content, pos)?;
                    let is_email = autolink.is_email;
                    (autolink.end_pos, HiddenKind::Autolink { is_email })
                }
            },
            b'[' if self.flags.footnotes => (
                self.footnote_reference_end(content, pos)?,
                HiddenKind::FootnoteReference,
            ),
            _ => return None,
        };
        Some(Hidden {
            beg: pos,
            end,
            kind,
        })
    }

    /// Emit emphasis opening tags (outermost to innermost). `marker`: where
    /// the first of their markers is. It is moved behind the last.
    pub(crate) fn emit_emph_open_tags(
        &mut self,
        sizes: &[u8],
        marker: &mut usize,
    ) -> crate::types::JsResult<()> {
        // First match = innermost, so emit in reverse (outermost first in HTML)
        for &size in sizes.iter().rev() {
            self.at(*marker, *marker + size as usize);
            *marker += size as usize;
            if size == 2 {
                self.enter_span(SpanType::Strong)?;
            } else {
                self.enter_span(SpanType::Em)?;
            }
        }
        Ok(())
    }

    /// Emit emphasis closing tags (innermost to outermost).
    /// First entry in sizes was matched first (innermost), emit in forward order.
    pub(crate) fn emit_emph_close_tags(
        &mut self,
        sizes: &[u8],
        marker: &mut usize,
    ) -> crate::types::JsResult<()> {
        for &size in sizes {
            self.at(*marker, *marker + size as usize);
            *marker += size as usize;
            if size == 2 {
                self.leave_span(SpanType::Strong)?;
            } else {
                self.leave_span(SpanType::Em)?;
            }
        }
        Ok(())
    }

    /// Find the matching closing backtick run. Returns end position of content (before closing ticks),
    /// or null if no matching closer found.
    pub(crate) fn find_code_span_end(
        &self,
        content: &[u8],
        start: usize,
        count: usize,
    ) -> Option<usize> {
        let mut pos = start;
        while let Some(backtick_pos) = bun_core::strings::index_of_char_pos(content, b'`', pos) {
            pos = backtick_pos + 1;
            while pos < content.len() && content[pos] == b'`' {
                pos += 1;
            }
            if pos - backtick_pos == count {
                return Some(backtick_pos);
            }
        }
        None
    }

    pub(crate) fn normalize_code_span_content<'a>(&self, content: &'a [u8]) -> &'a [u8] {
        // Strip one leading and trailing space if both exist and content isn't all spaces.
        // Newlines (from merged lines) are treated as spaces here.
        if content.len() >= 2 {
            let first_is_space = content[0] == b' ' || content[0] == b'\n';
            let last_is_space =
                content[content.len() - 1] == b' ' || content[content.len() - 1] == b'\n';
            if first_is_space && last_is_space {
                if content.iter().any(|&b| b != b' ' && b != b'\n') {
                    return &content[1..content.len() - 1];
                }
            }
        }
        content
    }

    /// What the delimiter run from `run_start` to `run_end` of `content` has on its
    /// two sides. Around a label there are brackets.
    fn flanking(
        &self,
        content: &[u8],
        run_start: usize,
        run_end: usize,
        is_label: bool,
    ) -> Flanking {
        if content.get(run_start) == Some(&b'*')
            && compat::asterisks_do_not_look_around(&self.flags)
        {
            return Flanking {
                left: true,
                right: true,
                before: Neighbor::Punctuation,
                after: Neighbor::Punctuation,
            };
        }
        let edge = if is_label {
            Neighbor::Punctuation
        } else {
            Neighbor::Whitespace
        };
        let neighbor = |codepoint: u32| {
            if codepoint > 0xFFFF && compat::astral_is_a_letter(&self.flags) {
                Neighbor::Other
            } else if helpers::is_unicode_whitespace(codepoint) {
                Neighbor::Whitespace
            } else if helpers::is_unicode_punctuation(codepoint) {
                Neighbor::Punctuation
            } else {
                Neighbor::Other
            }
        };
        let before = match run_start {
            0 => edge,
            _ => neighbor(helpers::decode_utf8_backward(content, run_start).codepoint),
        };
        let after = match run_end < content.len() {
            true => neighbor(helpers::decode_utf8(content, run_end).codepoint),
            false => edge,
        };
        Flanking::of(before, after)
    }

    /// Collect emphasis delimiter runs from content, skipping code spans and
    /// HTML tags. `base` is the offset of `content` within the slice
    /// `brackets` was built for.
    pub(crate) fn collect_emphasis_delimiters(
        &mut self,
        content: &[u8],
        brackets: &BracketMatches,
        base: usize,
        // Where the scan that asks is: not behind the start of `content`.
        mut walk: Walk,
        // `content` is between brackets.
        is_label: bool,
    ) {
        self.emph_delims.clear();
        if self.marks_seen & MARK_DELIMITER == 0 {
            return;
        }
        let mut i: usize = 0;
        loop {
            let mark = self.next_mark(&mut walk, base + i);
            if mark >= base + content.len() {
                break;
            }
            i = mark - base;
            let c = content[i];
            // Skip backslash escapes
            if c == b'\\' && i + 1 < content.len() && helpers::is_ascii_punctuation(content[i + 1])
            {
                i += 2;
                continue;
            }
            // Skip code spans, HTML tags and autolinks
            if let Some(hidden) = self.hidden_over(&walk, content, base, i) {
                i = hidden.end;
                continue;
            }
            // Skip wiki links — like regular links they resolve before
            // emphasis; the label gets its own collection pass.
            if c == b'[' && self.flags.wiki_links && i + 1 < content.len() && content[i + 1] == b'['
            {
                if let Some(m) = self.match_wiki_link(content, i) {
                    i = m.inner_end + 2;
                    continue;
                }
            }
            // Skip link/image constructs — links take precedence over emphasis (CommonMark §6.3)
            if c == b'[' || (c == b'!' && i + 1 < content.len() && content[i + 1] == b'[') {
                let is_img = c == b'!';
                let bracket_start = if is_img { i + 1 } else { i };
                if let Some(link_end) = brackets
                    .link(base + bracket_start, is_img)
                    .and_then(|it| it.1.checked_sub(base))
                    .filter(|&link_end| link_end <= content.len())
                {
                    i = link_end;
                    continue;
                }
            }
            // Emphasis delimiter
            if c == b'*' || c == b'_' {
                let run_start = i;
                while i < content.len() && content[i] == c {
                    i += 1;
                }
                let count = i - run_start;
                let mut flanking = self.flanking(content, run_start, i, is_label);
                if compat::marker_next_to_marker_flanks(&self.flags) {
                    let is_marker = |at: Option<&u8>| matches!(at, Some(b'*' | b'_' | b'~'));
                    flanking.left |= is_marker(content.get(i));
                    flanking.right |= run_start > 0 && is_marker(content.get(run_start - 1));
                }
                self.emph_delims.push(EmphDelim {
                    pos: run_start,
                    count,
                    emph_char: c,
                    can_open: flanking.can_open(c),
                    can_close: flanking.can_close(c),
                    remaining: count,
                    ..Default::default()
                });
                continue;
            }
            // Strikethrough delimiter (1 or 2 tildes only)
            if c == b'~' && self.flags.strikethrough {
                let run_start = i;
                while i < content.len() && content[i] == b'~' {
                    i += 1;
                }
                let count = i - run_start;
                if (count == 1 && !self.flags.no_single_tilde) || count == 2 {
                    let flanking = self.flanking(content, run_start, i, is_label);
                    self.emph_delims.push(EmphDelim {
                        pos: run_start,
                        count,
                        emph_char: b'~',
                        can_open: flanking.can_open(b'~'),
                        can_close: flanking.can_close(b'~'),
                        remaining: count,
                        ..Default::default()
                    });
                }
                continue;
            }
            i += 1;
        }
    }

    /// Resolve emphasis delimiters using the CommonMark algorithm.
    pub(crate) fn resolve_emphasis_delimiters(&mut self) {
        // reshaped for borrowck — index directly into self.emph_delims
        // instead of binding `delims` + `opener` aliases.
        let len = self.emph_delims.len();
        if len == 0 {
            return;
        }

        let opener_bottom_key = |d: &EmphDelim| -> usize {
            let char_idx = match d.emph_char {
                b'*' => 0,
                b'_' => 1,
                b'~' => 2,
                _ => 0,
            };
            ((char_idx * 3) + (d.count % 3)) * 2 + (d.can_open as usize)
        };
        let mut openers_bottom: [usize; 18] = [0; 18];
        let mut prev_candidate = core::mem::take(&mut self.prev_candidate);
        prev_candidate.clear();
        prev_candidate.extend((0..len).map(|i| i.wrapping_sub(1)));

        // Process potential closers from left to right
        let mut closer_idx: usize = 0;
        while closer_idx < len {
            if !self.emph_delims[closer_idx].can_close
                || self.emph_delims[closer_idx].remaining == 0
            {
                closer_idx = closer_idx.wrapping_add(1);
                continue;
            }

            // Look backward for a matching opener
            let opener_bottom = openers_bottom[opener_bottom_key(&self.emph_delims[closer_idx])];
            let mut found_match = false;
            if closer_idx > opener_bottom {
                let mut from = closer_idx;
                let mut oi = prev_candidate[closer_idx];
                while oi != usize::MAX && oi >= opener_bottom {
                    if !self.emph_delims[oi].can_open
                        || self.emph_delims[oi].remaining == 0
                        || !self.emph_delims[oi].active
                    {
                        let next = prev_candidate[oi];
                        prev_candidate[from] = next;
                        oi = next;
                        continue;
                    }
                    if self.emph_delims[oi].emph_char != self.emph_delims[closer_idx].emph_char {
                        from = oi;
                        oi = prev_candidate[oi];
                        continue;
                    }

                    // Strikethrough: exact count match required
                    if self.emph_delims[oi].emph_char == b'~'
                        && self.emph_delims[oi].count != self.emph_delims[closer_idx].count
                    {
                        from = oi;
                        oi = prev_candidate[oi];
                        continue;
                    }

                    // Rule of three: if closer can also open OR opener can also close,
                    // and the sum is a multiple of 3, and neither is individually a multiple of 3, skip
                    if self.emph_delims[oi].emph_char != b'~'
                        && (self.emph_delims[oi].can_close || self.emph_delims[closer_idx].can_open)
                        && (self.emph_delims[oi].count + self.emph_delims[closer_idx].count)
                            .is_multiple_of(3)
                        && !self.emph_delims[oi].count.is_multiple_of(3)
                        && !self.emph_delims[closer_idx].count.is_multiple_of(3)
                    {
                        from = oi;
                        oi = prev_candidate[oi];
                        continue;
                    }

                    // Match found! Determine how many chars to use
                    // For strikethrough (~): consume entire run at once
                    let use_: usize = if self.emph_delims[oi].emph_char == b'~' {
                        self.emph_delims[oi].remaining
                    } else if self.emph_delims[oi].remaining >= 2
                        && self.emph_delims[closer_idx].remaining >= 2
                    {
                        2
                    } else {
                        1
                    };

                    self.emph_delims[oi].remaining -= use_;
                    self.emph_delims[oi].open_count += use_;
                    if (self.emph_delims[oi].open_num as usize) < MAX_EMPH_MATCHES {
                        let n = self.emph_delims[oi].open_num as usize;
                        self.emph_delims[oi].open_sizes[n] = u8::try_from(use_).expect("int cast");
                        self.emph_delims[oi].open_num += 1;
                    }
                    self.emph_delims[closer_idx].remaining -= use_;
                    self.emph_delims[closer_idx].close_count += use_;
                    if (self.emph_delims[closer_idx].close_num as usize) < MAX_EMPH_MATCHES {
                        let n = self.emph_delims[closer_idx].close_num as usize;
                        self.emph_delims[closer_idx].close_sizes[n] =
                            u8::try_from(use_).expect("int cast");
                        self.emph_delims[closer_idx].close_num += 1;
                    }

                    // Remove all delimiters between opener and closer (CommonMark §6.4)
                    let mut k = prev_candidate[closer_idx];
                    while k != usize::MAX && k > oi {
                        self.emph_delims[k].active = false;
                        k = prev_candidate[k];
                    }
                    prev_candidate[closer_idx] = oi;

                    found_match = true;

                    // If closer still has remaining, re-process it (don't increment closer_idx)
                    if self.emph_delims[closer_idx].remaining > 0
                        && self.emph_delims[closer_idx].can_close
                    {
                        // Decrement so the while loop's `closer_idx += 1` brings us back
                        // to this same index, allowing another matching attempt with the
                        // remaining delimiter characters
                        closer_idx = closer_idx.wrapping_sub(1);
                    }
                    break;
                }
            }

            // If no match, avoid rescanning the same failed prefix for this closer class.
            if !found_match {
                openers_bottom[opener_bottom_key(&self.emph_delims[closer_idx])] = closer_idx;
                if !self.emph_delims[closer_idx].can_open {
                    self.emph_delims[closer_idx].active = false;
                }
            }

            closer_idx = closer_idx.wrapping_add(1);
        }
        self.prev_candidate = prev_candidate;
    }

    pub(crate) fn find_entity(&self, content: &[u8], start: usize) -> Option<usize> {
        helpers::find_entity(content, start)
    }

    /// True if a previous scan already proved there is no `kind` terminator at
    /// or after `scan_start` of `content` — either recorded for `content`
    /// itself or for an enclosing slice that contains it.
    fn html_scan_known_unterminated(
        &self,
        content: &[u8],
        kind: HtmlScanKind,
        scan_start: usize,
    ) -> bool {
        let memo = self.html_scan_memo.get();
        let Some(offset) = memo.offset_within(content) else {
            return false;
        };
        offset + scan_start >= memo.no_terminator_from[kind as usize]
    }

    /// Record that the search for `kind`'s terminator starting at `scan_start`
    /// reached the end of `content` without a match.
    fn note_unterminated_html_scan(&self, content: &[u8], kind: HtmlScanKind, scan_start: usize) {
        let mut memo = self.html_scan_memo.get();
        if !memo.applies_to(content) {
            if memo.offset_within(content).is_some() {
                // A sub-slice scan stops at the sub-slice's end, so it proves
                // nothing about the rest of the enclosing slice; keep the
                // enclosing entry (it already answers the sub-slice's later
                // queries via offset_within).
                return;
            }
            memo = HtmlScanMemo::EMPTY;
            memo.slice_addr = content.as_ptr() as usize;
            memo.slice_len = content.len();
        }
        let slot = &mut memo.no_terminator_from[kind as usize];
        *slot = (*slot).min(scan_start);
        self.html_scan_memo.set(memo);
    }

    pub(crate) fn find_html_tag(&self, content: &[u8], start: usize) -> Option<usize> {
        if start + 1 >= content.len() {
            return None;
        }

        let mut pos = start + 1;
        let c = content[pos];

        // Closing tag: </tagname whitespace? >
        if c == b'/' {
            pos += 1;
            if pos >= content.len() || !helpers::is_alpha(content[pos]) {
                return None;
            }
            while pos < content.len()
                && (helpers::is_alpha_num(content[pos]) || content[pos] == b'-')
            {
                pos += 1;
            }
            // Skip whitespace (including newlines)
            while pos < content.len() && helpers::is_whitespace(content[pos]) {
                pos += 1;
            }
            if pos < content.len() && content[pos] == b'>' {
                return Some(pos + 1);
            }
            return None;
        }

        // Comment: <!-- ... -->
        // Per CommonMark: text after <!-- must not start with > or ->
        if c == b'!'
            && pos + 1 < content.len()
            && content[pos + 1] == b'-'
            && pos + 2 < content.len()
            && content[pos + 2] == b'-'
        {
            pos += 3;
            // Minimal comments: <!--> and <!--->
            if pos < content.len() && content[pos] == b'>' {
                return Some(pos + 1);
            }
            if pos + 1 < content.len() && content[pos] == b'-' && content[pos + 1] == b'>' {
                return Some(pos + 2);
            }
            if self.html_scan_known_unterminated(content, HtmlScanKind::Comment, pos) {
                return None;
            }
            let scan_start = pos;
            while pos + 2 < content.len() {
                if content[pos] == b'-' && content[pos + 1] == b'-' && content[pos + 2] == b'>' {
                    return Some(pos + 3);
                }
                pos += 1;
            }
            self.note_unterminated_html_scan(content, HtmlScanKind::Comment, scan_start);
            return None;
        }

        // HTML declaration: <! followed by a letter, ended by >
        if c == b'!' && pos + 1 < content.len() && helpers::is_alpha(content[pos + 1]) {
            pos += 2;
            if self.html_scan_known_unterminated(content, HtmlScanKind::Declaration, pos) {
                return None;
            }
            let scan_start = pos;
            while pos < content.len() && content[pos] != b'>' {
                pos += 1;
            }
            if pos < content.len() {
                return Some(pos + 1);
            }
            self.note_unterminated_html_scan(content, HtmlScanKind::Declaration, scan_start);
            return None;
        }

        // CDATA section: <![CDATA[ ... ]]>
        if c == b'!'
            && pos + 7 < content.len()
            && content[pos + 1] == b'['
            && content[pos + 2] == b'C'
            && content[pos + 3] == b'D'
            && content[pos + 4] == b'A'
            && content[pos + 5] == b'T'
            && content[pos + 6] == b'A'
            && content[pos + 7] == b'['
        {
            pos += 8;
            if self.html_scan_known_unterminated(content, HtmlScanKind::Cdata, pos) {
                return None;
            }
            let scan_start = pos;
            while pos + 2 < content.len() {
                if content[pos] == b']' && content[pos + 1] == b']' && content[pos + 2] == b'>' {
                    return Some(pos + 3);
                }
                pos += 1;
            }
            self.note_unterminated_html_scan(content, HtmlScanKind::Cdata, scan_start);
            return None;
        }

        // Processing instruction: <? ... ?>
        if c == b'?' {
            pos += 1;
            if self.html_scan_known_unterminated(content, HtmlScanKind::ProcessingInstruction, pos)
            {
                return None;
            }
            let scan_start = pos;
            while pos + 1 < content.len() {
                if content[pos] == b'?' && content[pos + 1] == b'>' {
                    return Some(pos + 2);
                }
                pos += 1;
            }
            self.note_unterminated_html_scan(
                content,
                HtmlScanKind::ProcessingInstruction,
                scan_start,
            );
            return None;
        }

        // Opening tag: <tagname ...>
        if helpers::is_alpha(c) {
            while pos < content.len()
                && (helpers::is_alpha_num(content[pos]) || content[pos] == b'-')
            {
                pos += 1;
            }

            // Attributes (whitespace includes newlines for multi-line tags)
            while pos < content.len() {
                // Skip whitespace (spaces, tabs, newlines)
                let mut had_ws = false;
                while pos < content.len() && helpers::is_whitespace(content[pos]) {
                    had_ws = true;
                    pos += 1;
                }

                if pos >= content.len() {
                    break;
                }
                if content[pos] == b'>' {
                    return Some(pos + 1);
                }
                if content[pos] == b'/' && pos + 1 < content.len() && content[pos + 1] == b'>' {
                    return Some(pos + 2);
                }

                if !had_ws {
                    return None;
                }

                // Attribute name
                if !helpers::is_alpha(content[pos]) && content[pos] != b'_' && content[pos] != b':'
                {
                    return None;
                }
                while pos < content.len()
                    && (helpers::is_alpha_num(content[pos])
                        || content[pos] == b'_'
                        || content[pos] == b':'
                        || content[pos] == b'.'
                        || content[pos] == b'-')
                {
                    pos += 1;
                }

                // Attribute value (optional)
                // Skip whitespace (save position in case = not found)
                let before_eq_ws = pos;
                while pos < content.len() && helpers::is_whitespace(content[pos]) {
                    pos += 1;
                }
                if pos < content.len() && content[pos] == b'=' {
                    pos += 1;
                    while pos < content.len() && helpers::is_whitespace(content[pos]) {
                        pos += 1;
                    }
                    if pos >= content.len() {
                        return None;
                    }

                    if content[pos] == b'"' {
                        pos += 1;
                        while pos < content.len() && content[pos] != b'"' {
                            pos += 1;
                        }
                        if pos >= content.len() {
                            return None;
                        }
                        pos += 1;
                    } else if content[pos] == b'\'' {
                        pos += 1;
                        while pos < content.len() && content[pos] != b'\'' {
                            pos += 1;
                        }
                        if pos >= content.len() {
                            return None;
                        }
                        pos += 1;
                    } else {
                        // Unquoted value: no whitespace, quotes, =, <, >, or backtick
                        while pos < content.len()
                            && !helpers::is_whitespace(content[pos])
                            && content[pos] != b'"'
                            && content[pos] != b'\''
                            && content[pos] != b'='
                            && content[pos] != b'<'
                            && content[pos] != b'>'
                            && content[pos] != b'`'
                        {
                            pos += 1;
                        }
                    }
                } else {
                    // No '=' found, restore position so whitespace is
                    // available for the next attribute's had_ws check
                    pos = before_eq_ws;
                }
            }
        }

        None
    }
}

/// Count consecutive backticks starting at `start`.
pub(crate) fn count_backticks(content: &[u8], start: usize) -> usize {
    let mut pos = start;
    while pos < content.len() && content[pos] == b'`' {
        pos += 1;
    }
    pos - start
}

/// What is next to a delimiter run.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Neighbor {
    Whitespace,
    Punctuation,
    Other,
}

/// Whether a delimiter run is left-flanking, right-flanking.
#[derive(Clone, Copy)]
struct Flanking {
    left: bool,
    right: bool,
    before: Neighbor,
    after: Neighbor,
}

impl Flanking {
    fn of(before: Neighbor, after: Neighbor) -> Flanking {
        Flanking {
            // Not followed by whitespace, and not followed by punctuation OR preceded by whitespace/punctuation
            left: after != Neighbor::Whitespace
                && (after != Neighbor::Punctuation || before != Neighbor::Other),
            // Not preceded by whitespace, and not preceded by punctuation OR followed by whitespace/punctuation
            right: before != Neighbor::Whitespace
                && (before != Neighbor::Punctuation || after != Neighbor::Other),
            before,
            after,
        }
    }

    fn can_open(self, emph_char: u8) -> bool {
        // _ requires: left-flanking AND (not right-flanking OR preceded by punctuation)
        self.left && (emph_char != b'_' || !self.right || self.before == Neighbor::Punctuation)
    }

    fn can_close(self, emph_char: u8) -> bool {
        // _ requires: right-flanking AND (not left-flanking OR followed by punctuation)
        self.right && (emph_char != b'_' || !self.left || self.after == Neighbor::Punctuation)
    }
}
