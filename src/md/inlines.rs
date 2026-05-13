use crate::autolinks::{find_permissive_autolink, is_emph_boundary_resolved};
use crate::helpers;
use crate::parser::{self, Parser};
use crate::types::{OFF, SpanType, TextType, VerbatimLine};

/// Emphasis delimiter entry for CommonMark emphasis algorithm.
pub const MAX_EMPH_MATCHES: usize = 6;

#[derive(Clone, Copy)]
pub struct EmphDelim {
    pub pos: usize,    // start position in content
    pub count: usize,  // original run length
    pub emph_char: u8, // * or _
    pub can_open: bool,
    pub can_close: bool,
    pub remaining: usize,   // chars not yet consumed
    pub open_count: usize,  // total chars consumed as opener
    pub close_count: usize, // total chars consumed as closer
    // Individual match sizes in order (each is 1 for em, 2 for strong)
    // TODO(port): Zig used u2 element type; Rust uses u8 — values are always 0..=2.
    pub open_sizes: [u8; MAX_EMPH_MATCHES],
    pub open_num: u8, // number of open matches (Zig: u4)
    pub close_sizes: [u8; MAX_EMPH_MATCHES],
    pub close_num: u8, // number of close matches (Zig: u4)
    pub active: bool,  // false if deactivated between matched pairs
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

impl Parser<'_> {
    /// Merge all lines into buffer with \n between them (unmodified),
    /// then process inlines on the merged text. Hard/soft breaks are detected
    /// during inline processing when \n is encountered.
    pub fn process_leaf_block(
        &mut self,
        block_lines: &[VerbatimLine],
        trim_trailing: bool,
    ) -> Result<(), parser::Error> {
        if block_lines.is_empty() {
            return Ok(());
        }

        self.buffer.clear();

        for vline in block_lines {
            if vline.beg > vline.end || vline.end > self.size {
                continue;
            }

            if !self.buffer.is_empty() {
                self.buffer.push(b'\n');
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
        // PORT NOTE: reshaped for borrowck — Zig passes self.buffer.items directly into a
        // &self method; Rust take()s the Vec out so process_inline_content (and any recursive
        // call via process_link) gets a fresh self.buffer to scribble on without aliasing.
        // TODO(port): verify recursive calls (via process_link) do not need the parent buffer.
        let merged = core::mem::take(&mut self.buffer);
        let ret = self.process_inline_content(&merged[..merged_len], block_lines[0].beg);
        self.buffer = merged;
        ret
    }

    pub fn process_inline_content(
        &mut self,
        content: &[u8],
        base_off: OFF,
    ) -> Result<(), parser::Error> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(parser::Error::StackOverflow);
        }

        // Phase 1: Collect and resolve emphasis delimiters
        self.collect_emphasis_delimiters(content);
        self.resolve_emphasis_delimiters();

        // Copy resolved delimiters locally (recursive calls may modify emph_delims)
        // PORT NOTE: Zig dupe() catch OOM → emit plain text fallback; Rust Vec::clone aborts on OOM.
        let resolved: Vec<EmphDelim> = self.emph_delims.clone();

        // Phase 2: Emit content using resolved emphasis info
        let mut i: usize = 0;
        let mut text_start: usize = 0;
        let mut delim_cursor: usize = 0;

        while i < content.len() {
            let c = content[i];

            // Fast path: character has no special meaning, skip it
            if !self.mark_char_map.is_set(c as usize) {
                i += 1;
                continue;
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
                        while sp > text_start
                            && (content[sp - 1] == b' ' || content[sp - 1] == b'\t')
                        {
                            sp -= 1;
                        }
                        emit_end = sp;
                        is_hard = true;
                    }
                }
                if emit_end > text_start {
                    self.emit_text(TextType::Normal, &content[text_start..emit_end])?;
                }
                if is_hard {
                    self.emit_text(TextType::Br, b"")?;
                } else {
                    self.emit_text(TextType::Softbr, b"")?;
                }
                i += 1;
                text_start = i;
                continue;
            }

            // Check for backslash escape
            if c == b'\\' && i + 1 < content.len() && helpers::is_ascii_punctuation(content[i + 1])
            {
                if i > text_start {
                    self.emit_text(TextType::Normal, &content[text_start..i])?;
                }
                i += 1;
                self.emit_text(TextType::Normal, &content[i..i + 1])?;
                i += 1;
                text_start = i;
                continue;
            }

            // Code span
            if c == b'`' {
                if i > text_start {
                    self.emit_text(TextType::Normal, &content[text_start..i])?;
                }
                let count = count_backticks(content, i);
                if let Some(end_pos) = self.find_code_span_end(content, i + count, count) {
                    self.enter_span(SpanType::Code)?;
                    let code_content =
                        self.normalize_code_span_content(&content[i + count..end_pos]);
                    self.emit_text(TextType::Code, code_content)?;
                    self.leave_span(SpanType::Code)?;
                    i = end_pos + count;
                } else {
                    // No matching closer found — emit the entire backtick run as literal text
                    self.emit_text(TextType::Normal, &content[i..i + count])?;
                    i += count;
                }
                text_start = i;
                continue;
            }

            // Emphasis/strikethrough with * or _ or ~ — use resolved delimiters
            if c == b'*' || c == b'_' || (c == b'~' && self.flags.strikethrough) {
                // Find the corresponding resolved delimiter
                while delim_cursor < resolved.len() && resolved[delim_cursor].pos < i {
                    delim_cursor += 1;
                }

                if delim_cursor < resolved.len() && resolved[delim_cursor].pos == i {
                    if i > text_start {
                        self.emit_text(TextType::Normal, &content[text_start..i])?;
                    }

                    let d = &resolved[delim_cursor];
                    let run_end = d.pos + d.count;

                    // Emit closing tags first (innermost to outermost)
                    if d.emph_char == b'~' {
                        if d.close_count > 0 {
                            self.leave_span(SpanType::Del)?;
                        }
                    } else {
                        self.emit_emph_close_tags(&d.close_sizes[0..d.close_num as usize])?;
                    }

                    // Emit remaining delimiter chars as text
                    let text_chars = d.count.saturating_sub(d.open_count + d.close_count);
                    if text_chars > 0 {
                        self.emit_text(TextType::Normal, &content[i..i + text_chars])?;
                    }

                    // Emit opening tags (outermost to innermost)
                    if d.emph_char == b'~' {
                        if d.open_count > 0 {
                            self.enter_span(SpanType::Del)?;
                        }
                    } else {
                        self.emit_emph_open_tags(&d.open_sizes[0..d.open_num as usize])?;
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
                    if i > text_start {
                        self.emit_text(TextType::Normal, &content[text_start..i])?;
                    }
                    self.emit_text(TextType::Entity, &content[i..end_pos])?;
                    i = end_pos;
                    text_start = i;
                    continue;
                }
            }

            // HTML tag
            if c == b'<' && !self.flags.no_html_spans {
                if let Some(tag_end) = self.find_html_tag(content, i) {
                    if i > text_start {
                        self.emit_text(TextType::Normal, &content[text_start..i])?;
                    }
                    self.emit_text(TextType::Html, &content[i..tag_end])?;
                    i = tag_end;
                    text_start = i;
                    continue;
                }
                if let Some(autolink) = self.find_autolink(content, i) {
                    if i > text_start {
                        self.emit_text(TextType::Normal, &content[text_start..i])?;
                    }
                    self.render_autolink(&content[i + 1..autolink.end_pos - 1], autolink.is_email)?;
                    i = autolink.end_pos;
                    text_start = i;
                    continue;
                }
            }

            // Wiki links: [[destination]] or [[destination|label]]
            if c == b'[' && self.flags.wiki_links && i + 1 < content.len() && content[i + 1] == b'['
            {
                if i > text_start {
                    self.emit_text(TextType::Normal, &content[text_start..i])?;
                }
                if let Some(end_pos) = self.process_wiki_link(content, i)? {
                    i = end_pos;
                    text_start = i;
                    continue;
                }
                // No wikilink matched: restore text_start so preceding text
                // isn't double-emitted by the next span branch.
                text_start = i;
            }

            // Links: [text](url) or [text][ref]
            if c == b'[' {
                if i > text_start {
                    self.emit_text(TextType::Normal, &content[text_start..i])?;
                }
                if let Some(end_pos) = self.process_link(content, i, base_off, false)? {
                    i = end_pos;
                } else {
                    self.emit_text(TextType::Normal, b"[")?;
                    i += 1;
                }
                text_start = i;
                continue;
            }

            // Images: ![text](url)
            if c == b'!' && i + 1 < content.len() && content[i + 1] == b'[' {
                if i > text_start {
                    self.emit_text(TextType::Normal, &content[text_start..i])?;
                }
                if let Some(end_pos) = self.process_link(content, i + 1, base_off, true)? {
                    i = end_pos;
                } else {
                    self.emit_text(TextType::Normal, b"!")?;
                    i += 1;
                }
                text_start = i;
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
                    if a.beg > text_start {
                        self.emit_text(TextType::Normal, &content[text_start..a.beg])?;
                    }

                    // Determine URL prefix and render through the renderer
                    let link_text = &content[a.beg..a.end];
                    if c == b'@' {
                        self.renderer.enter_span(
                            SpanType::A,
                            crate::types::SpanDetail {
                                href: link_text,
                                permissive_autolink: true,
                                autolink_email: true,
                                ..Default::default()
                            },
                        )?;
                        self.emit_text(TextType::Normal, link_text)?;
                        self.renderer.leave_span(SpanType::A)?;
                    } else if c == b'.' {
                        self.renderer.enter_span(
                            SpanType::A,
                            crate::types::SpanDetail {
                                href: link_text,
                                permissive_autolink: true,
                                autolink_www: true,
                                ..Default::default()
                            },
                        )?;
                        self.emit_text(TextType::Normal, link_text)?;
                        self.renderer.leave_span(SpanType::A)?;
                    } else {
                        self.renderer.enter_span(
                            SpanType::A,
                            crate::types::SpanDetail {
                                href: link_text,
                                permissive_autolink: true,
                                ..Default::default()
                            },
                        )?;
                        self.emit_text(TextType::Normal, link_text)?;
                        self.renderer.leave_span(SpanType::A)?;
                    }
                    i = a.end;
                    text_start = i;
                    continue;
                }
            }

            // Null character
            if c == 0 {
                if i > text_start {
                    self.emit_text(TextType::Normal, &content[text_start..i])?;
                }
                self.emit_text(TextType::NullChar, b"")?;
                i += 1;
                text_start = i;
                continue;
            }

            i += 1;
        }

        if text_start < content.len() {
            self.emit_text(TextType::Normal, &content[text_start..])?;
        }
        Ok(())
    }

    pub fn enter_span(&mut self, span_type: SpanType) -> crate::types::JsResult<()> {
        if self.image_nesting_level > 0 {
            return Ok(());
        }
        self.renderer.enter_span(span_type, Default::default())
    }

    pub fn leave_span(&mut self, span_type: SpanType) -> crate::types::JsResult<()> {
        if self.image_nesting_level > 0 {
            return Ok(());
        }
        self.renderer.leave_span(span_type)
    }

    pub fn emit_text(&mut self, text_type: TextType, content: &[u8]) -> crate::types::JsResult<()> {
        self.renderer.text(text_type, content)
    }

    /// Emit emphasis opening tags (outermost to innermost).
    pub fn emit_emph_open_tags(&mut self, sizes: &[u8]) -> crate::types::JsResult<()> {
        // First match = innermost, so emit in reverse (outermost first in HTML)
        for idx in 0..sizes.len() {
            let j = sizes.len() - 1 - idx;
            if sizes[j] == 2 {
                self.enter_span(SpanType::Strong)?;
            } else {
                self.enter_span(SpanType::Em)?;
            }
        }
        Ok(())
    }

    /// Emit emphasis closing tags (innermost to outermost).
    /// First entry in sizes was matched first (innermost), emit in forward order.
    pub fn emit_emph_close_tags(&mut self, sizes: &[u8]) -> crate::types::JsResult<()> {
        for &size in sizes {
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
    pub fn find_code_span_end(&self, content: &[u8], start: usize, count: usize) -> Option<usize> {
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

    pub fn normalize_code_span_content<'a>(&self, content: &'a [u8]) -> &'a [u8] {
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

    /// Collect emphasis delimiter runs from content, skipping code spans and HTML tags.
    pub fn collect_emphasis_delimiters(&mut self, content: &[u8]) {
        self.emph_delims.clear();
        let mut i: usize = 0;
        while i < content.len() {
            let c = content[i];
            // Skip backslash escapes
            if c == b'\\' && i + 1 < content.len() && helpers::is_ascii_punctuation(content[i + 1])
            {
                i += 2;
                continue;
            }
            // Skip code spans
            if c == b'`' {
                let count = count_backticks(content, i);
                if let Some(end_pos) = self.find_code_span_end(content, i + count, count) {
                    i = end_pos + count;
                } else {
                    i += count;
                }
                continue;
            }
            // Skip HTML tags and autolinks
            if c == b'<' {
                if !self.flags.no_html_spans {
                    if let Some(tag_end) = self.find_html_tag(content, i) {
                        i = tag_end;
                        continue;
                    }
                    if let Some(auto) = self.find_autolink(content, i) {
                        i = auto.end_pos;
                        continue;
                    }
                }
            }
            // Skip link/image constructs — links take precedence over emphasis (CommonMark §6.3)
            if c == b'[' || (c == b'!' && i + 1 < content.len() && content[i + 1] == b'[') {
                let is_img = c == b'!';
                let bracket_start = if is_img { i + 1 } else { i };
                let link_result = self.try_match_bracket_link(content, bracket_start);
                if link_result.is_link {
                    // Link nesting prohibition: links cannot contain other links (CommonMark §6.7)
                    // Images CAN contain links in alt text, so only check for non-images
                    if !is_img {
                        let label = &content[bracket_start + 1..link_result.label_end];
                        if self.label_contains_link(label) {
                            // Label contains inner links — this can't form a link
                            i += 1;
                            continue;
                        }
                    }
                    i = link_result.link_end;
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
                self.emph_delims.push(EmphDelim {
                    pos: run_start,
                    count,
                    emph_char: c,
                    can_open: can_open_emphasis(c, content, run_start, i),
                    can_close: can_close_emphasis(c, content, run_start, i),
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
                if count == 1 || count == 2 {
                    self.emph_delims.push(EmphDelim {
                        pos: run_start,
                        count,
                        emph_char: b'~',
                        can_open: can_open_emphasis(b'~', content, run_start, i),
                        can_close: can_close_emphasis(b'~', content, run_start, i),
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
    pub fn resolve_emphasis_delimiters(&mut self) {
        // PORT NOTE: reshaped for borrowck — index directly into self.emph_delims
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
                let mut oi: usize = closer_idx;
                while oi > opener_bottom {
                    oi -= 1;
                    if self.emph_delims[oi].emph_char != self.emph_delims[closer_idx].emph_char {
                        continue;
                    }
                    if !self.emph_delims[oi].can_open
                        || self.emph_delims[oi].remaining == 0
                        || !self.emph_delims[oi].active
                    {
                        continue;
                    }

                    // Strikethrough: exact count match required
                    if self.emph_delims[oi].emph_char == b'~' {
                        if self.emph_delims[oi].count != self.emph_delims[closer_idx].count {
                            continue;
                        }
                    }

                    // Rule of three: if closer can also open OR opener can also close,
                    // and the sum is a multiple of 3, and neither is individually a multiple of 3, skip
                    if self.emph_delims[oi].emph_char != b'~'
                        && (self.emph_delims[oi].can_close || self.emph_delims[closer_idx].can_open)
                        && (self.emph_delims[oi].count + self.emph_delims[closer_idx].count) % 3
                            == 0
                        && self.emph_delims[oi].count % 3 != 0
                        && self.emph_delims[closer_idx].count % 3 != 0
                    {
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
                    let mut k = oi + 1;
                    while k < closer_idx {
                        self.emph_delims[k].active = false;
                        k += 1;
                    }

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
    }

    pub fn find_entity(&self, content: &[u8], start: usize) -> Option<usize> {
        helpers::find_entity(content, start)
    }

    pub fn find_html_tag(&self, content: &[u8], start: usize) -> Option<usize> {
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
            while pos + 2 < content.len() {
                if content[pos] == b'-' && content[pos + 1] == b'-' && content[pos + 2] == b'>' {
                    return Some(pos + 3);
                }
                pos += 1;
            }
            return None;
        }

        // HTML declaration: <! followed by uppercase letter, ended by >
        if c == b'!'
            && pos + 1 < content.len()
            && content[pos + 1] >= b'A'
            && content[pos + 1] <= b'Z'
        {
            pos += 2;
            while pos < content.len() && content[pos] != b'>' {
                pos += 1;
            }
            if pos < content.len() {
                return Some(pos + 1);
            }
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
            while pos + 2 < content.len() {
                if content[pos] == b']' && content[pos + 1] == b']' && content[pos + 2] == b'>' {
                    return Some(pos + 3);
                }
                pos += 1;
            }
            return None;
        }

        // Processing instruction: <? ... ?>
        if c == b'?' {
            pos += 1;
            while pos + 1 < content.len() {
                if content[pos] == b'?' && content[pos + 1] == b'>' {
                    return Some(pos + 2);
                }
                pos += 1;
            }
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
pub fn count_backticks(content: &[u8], start: usize) -> usize {
    let mut pos = start;
    while pos < content.len() && content[pos] == b'`' {
        pos += 1;
    }
    pos - start
}

/// Check if a delimiter run is left-flanking per CommonMark spec.
pub fn is_left_flanking(content: &[u8], run_start: usize, run_end: usize) -> bool {
    // Not followed by Unicode whitespace
    if run_end >= content.len() {
        return false;
    }
    let after_cp = helpers::decode_utf8(content, run_end).codepoint;
    if helpers::is_unicode_whitespace(after_cp) {
        return false;
    }
    // Not followed by punctuation, OR preceded by whitespace/punctuation
    if helpers::is_unicode_punctuation(after_cp) {
        if run_start == 0 {
            return true; // preceded by start of text
        }
        let before_cp = helpers::decode_utf8_backward(content, run_start).codepoint;
        return helpers::is_unicode_whitespace(before_cp)
            || helpers::is_unicode_punctuation(before_cp);
    }
    true
}

/// Check if a delimiter run is right-flanking per CommonMark spec.
pub fn is_right_flanking(content: &[u8], run_start: usize, run_end: usize) -> bool {
    // Not preceded by Unicode whitespace
    if run_start == 0 {
        return false;
    }
    let before_cp = helpers::decode_utf8_backward(content, run_start).codepoint;
    if helpers::is_unicode_whitespace(before_cp) {
        return false;
    }
    // Not preceded by punctuation, OR followed by whitespace/punctuation
    if helpers::is_unicode_punctuation(before_cp) {
        if run_end >= content.len() {
            return true; // followed by end of text
        }
        let after_cp = helpers::decode_utf8(content, run_end).codepoint;
        return helpers::is_unicode_whitespace(after_cp)
            || helpers::is_unicode_punctuation(after_cp);
    }
    true
}

pub fn can_open_emphasis(emph_char: u8, content: &[u8], run_start: usize, run_end: usize) -> bool {
    let lf = is_left_flanking(content, run_start, run_end);
    if !lf {
        return false;
    }
    if emph_char == b'*' {
        return true;
    }
    // _ requires: left-flanking AND (not right-flanking OR preceded by punctuation)
    let rf = is_right_flanking(content, run_start, run_end);
    !rf || (run_start > 0
        && helpers::is_unicode_punctuation(
            helpers::decode_utf8_backward(content, run_start).codepoint,
        ))
}

pub fn can_close_emphasis(emph_char: u8, content: &[u8], run_start: usize, run_end: usize) -> bool {
    let rf = is_right_flanking(content, run_start, run_end);
    if !rf {
        return false;
    }
    if emph_char == b'*' {
        return true;
    }
    // _ requires: right-flanking AND (not left-flanking OR followed by punctuation)
    let lf = is_left_flanking(content, run_start, run_end);
    !lf || (run_end < content.len()
        && helpers::is_unicode_punctuation(helpers::decode_utf8(content, run_end).codepoint))
}

// ported from: src/md/inlines.zig
