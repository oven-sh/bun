use crate::helpers;
use crate::inlines;
use crate::parser::{self, Parser};
use crate::types::{OFF, SpanDetail, SpanType, TextType};

// PORT NOTE: aliases for the real `SpanType` / `SpanDetail` types (the Zig
// original named them `Span` / `SpanAttrs`).
type Span = SpanType;
type SpanAttrs<'a> = SpanDetail<'a>;
type Off = OFF;

/// Maximum parenthesis nesting depth inside a bare inline-link destination.
/// CommonMark allows implementations to impose such a limit ("at least three
/// levels of nesting should be supported"); cmark and commonmark.js both use
/// 32. Without a cap, an unclosed destination is rescanned for every candidate
/// link, which is quadratic on inputs like `"[a](b"` repeated.
const MAX_LINK_DEST_PAREN_DEPTH: u32 = 32;

/// Maximum `[`/`]` nesting depth inside a wiki link. Bounds the forward scan
/// for the closing `]]`, which is otherwise rescanned to the end of the line
/// for every `[[` candidate (quadratic on inputs like `"[".repeat(n)` when
/// wiki links are enabled, e.g. via `Bun.markdown.ansi`).
const MAX_WIKI_BRACKET_DEPTH: u32 = 32;

/// Result of `try_match_bracket_link` — Zig anonymous return struct.
pub struct BracketLinkMatch {
    pub is_link: bool,
    pub label_end: usize,
    pub link_end: usize,
}

/// Result of `find_autolink` — Zig anonymous return struct.
pub struct Autolink {
    pub end_pos: usize,
    pub is_email: bool,
}

/// Characters that can affect bracket matching: the brackets themselves,
/// backslash escapes, code spans, and (unless HTML spans are disabled) HTML
/// tags/autolinks. Used to SIMD-skip runs of ordinary text while building the
/// bracket-pair map.
const BRACKET_SCAN_CHARS: &[u8] = b"[]\\`<";
const BRACKET_SCAN_CHARS_NO_HTML: &[u8] = b"[]\\`";

/// Result of matching a `[` against its closing `]`.
struct BracketScan {
    /// Position of the matching `]`.
    close: usize,
    /// Whether another `[` opener was seen between the two.
    has_inner_bracket: bool,
}

enum BracketLookup {
    /// Opener was seen by the single-pass builder and has a matching `]`.
    Matched(usize),
    /// Opener was seen by the single-pass builder and has no matching `]`.
    Unmatched,
    /// Opener is unknown to the map (tokenization divergence, e.g. the caller
    /// skipped a permissive autolink the builder tokenized through).
    Unknown,
}

/// Bracket-pair map for one inline content slice, built in a single pass so
/// link processing can find the `]` matching a given `[` without rescanning
/// the rest of the slice for every opener — that rescan is quadratic on
/// inputs like `"[".repeat(n)`. The backing vec is recycled through
/// `Parser.bracket_pairs`, so steady-state rendering does not allocate here.
pub struct BracketMatches {
    /// `(open, close)` position of every `[` seen outside code spans, HTML
    /// tags/autolinks and backslash escapes, ordered by `open`.
    /// `close == UNMATCHED` marks an opener with no matching `]`.
    pairs: Vec<(OFF, OFF)>,
    /// The slice contains no `]` at all, so every opener is unmatched and
    /// `pairs` was left empty.
    no_closers: bool,
}

impl BracketMatches {
    const UNMATCHED: OFF = OFF::MAX;

    /// Hand the backing storage back for reuse by the next inline slice.
    pub(crate) fn into_storage(self) -> Vec<(OFF, OFF)> {
        self.pairs
    }

    fn get(&self, open: usize) -> BracketLookup {
        if self.no_closers {
            return BracketLookup::Unmatched;
        }
        match self.pairs.binary_search_by_key(&(open as OFF), |&(o, _)| o) {
            Ok(idx) => {
                let close = self.pairs[idx].1;
                if close == Self::UNMATCHED {
                    BracketLookup::Unmatched
                } else {
                    BracketLookup::Matched(close as usize)
                }
            }
            Err(_) => BracketLookup::Unknown,
        }
    }

    /// Whether any `[` opener was seen strictly between `lo` and `hi`.
    fn has_opener_between(&self, lo: usize, hi: usize) -> bool {
        let idx = self.pairs.partition_point(|&(o, _)| (o as usize) <= lo);
        idx < self.pairs.len() && (self.pairs[idx].0 as usize) < hi
    }
}

impl Parser<'_> {
    /// Build the bracket-pair map for `content` in a single pass, using the
    /// same tokenization as the matching scan (code spans, HTML tags,
    /// autolinks and backslash escapes hide brackets). `storage` is the
    /// recycled backing vec from `Parser.bracket_pairs`.
    pub fn compute_bracket_matches(
        &self,
        content: &[u8],
        mut storage: Vec<(OFF, OFF)>,
    ) -> BracketMatches {
        storage.clear();
        debug_assert!(content.len() <= OFF::MAX as usize);

        // No '[' means nothing will ever be looked up; no ']' means every
        // opener is trivially unmatched (e.g. "[".repeat(n)) — skip the walk.
        if bun_core::immutable::index_of_char(content, b'[').is_none() {
            return BracketMatches {
                pairs: storage,
                no_closers: false,
            };
        }
        if bun_core::immutable::index_of_char(content, b']').is_none() {
            return BracketMatches {
                pairs: storage,
                no_closers: true,
            };
        }

        let scan_chars: &'static [u8] = if self.flags.no_html_spans {
            BRACKET_SCAN_CHARS_NO_HTML
        } else {
            BRACKET_SCAN_CHARS
        };

        // While an opener is still unmatched, its `close` slot holds the index
        // of the previous unmatched opener — a stack threaded through the vec
        // itself, so no separate stack allocation is needed. Whatever is left
        // on that stack at the end is rewritten to UNMATCHED.
        let mut top: OFF = BracketMatches::UNMATCHED;
        let mut pos: usize = 0;
        while pos < content.len() {
            match content[pos] {
                b'\\' => pos += 2,
                // Code spans take precedence over brackets (CommonMark §6.3)
                b'`' => {
                    let count = inlines::count_backticks(content, pos);
                    if let Some(end_pos) = self.find_code_span_end(content, pos + count, count) {
                        pos = end_pos + count;
                    } else {
                        pos += count;
                    }
                }
                // HTML tags and autolinks take precedence over brackets
                b'<' if !self.flags.no_html_spans => {
                    if let Some(tag_end) = self.find_html_tag(content, pos) {
                        pos = tag_end;
                    } else if let Some(autolink) = self.find_autolink(content, pos) {
                        pos = autolink.end_pos;
                    } else {
                        pos += 1;
                    }
                }
                b'[' => {
                    let idx = storage.len() as OFF;
                    storage.push((pos as OFF, top));
                    top = idx;
                    pos += 1;
                }
                b']' => {
                    if top != BracketMatches::UNMATCHED {
                        let idx = top as usize;
                        top = storage[idx].1;
                        storage[idx].1 = pos as OFF;
                    }
                    pos += 1;
                }
                // Ordinary text: SIMD-jump to the next character that can
                // affect bracket matching.
                _ => match bun_core::immutable::index_of_any(&content[pos..], scan_chars) {
                    Some(rel) => pos += rel as usize,
                    None => break,
                },
            }
        }

        // Openers still on the threaded stack have no matching ']'.
        while top != BracketMatches::UNMATCHED {
            let idx = top as usize;
            top = storage[idx].1;
            storage[idx].1 = BracketMatches::UNMATCHED;
        }

        BracketMatches {
            pairs: storage,
            no_closers: false,
        }
    }

    /// Find the `]` matching the `[` at `start` in `content`. `base` is the
    /// offset of `content` within the slice `brackets` was built for (non-zero
    /// when `content` is a link-label sub-slice). Falls back to a forward scan
    /// when the opener is unknown to the map.
    fn match_bracket(
        &self,
        content: &[u8],
        start: usize,
        brackets: &BracketMatches,
        base: usize,
    ) -> Option<BracketScan> {
        match brackets.get(base + start) {
            BracketLookup::Matched(close) if close > base && close - base < content.len() => {
                Some(BracketScan {
                    close: close - base,
                    has_inner_bracket: brackets.has_opener_between(base + start, close),
                })
            }
            BracketLookup::Unmatched => None,
            _ => self.scan_bracket_close(content, start),
        }
    }

    /// Forward scan for the `]` matching the `[` at `start`, skipping code
    /// spans, HTML tags/autolinks and backslash escapes. Only used when the
    /// opener is missing from the precomputed bracket map.
    fn scan_bracket_close(&self, content: &[u8], start: usize) -> Option<BracketScan> {
        let mut pos = start + 1;
        let mut bracket_depth: u32 = 1;
        let mut has_inner_bracket = false;
        while pos < content.len() && bracket_depth > 0 {
            if content[pos] == b'\\' && pos + 1 < content.len() {
                pos += 2;
                continue;
            }
            // Skip code spans — they take precedence over brackets (CommonMark §6.3)
            if content[pos] == b'`' {
                let count = inlines::count_backticks(content, pos);
                if let Some(end_pos) = self.find_code_span_end(content, pos + count, count) {
                    pos = end_pos + count;
                } else {
                    pos += count;
                }
                continue;
            }
            // Skip HTML tags and autolinks — they take precedence over brackets
            if content[pos] == b'<' && !self.flags.no_html_spans {
                if let Some(tag_end) = self.find_html_tag(content, pos) {
                    pos = tag_end;
                    continue;
                }
                if let Some(autolink) = self.find_autolink(content, pos) {
                    pos = autolink.end_pos;
                    continue;
                }
            }
            if content[pos] == b'[' {
                bracket_depth += 1;
                has_inner_bracket = true;
            }
            if content[pos] == b']' {
                bracket_depth -= 1;
            }
            if bracket_depth > 0 {
                pos += 1;
            }
        }
        if bracket_depth != 0 {
            return None;
        }
        Some(BracketScan {
            close: pos,
            has_inner_bracket,
        })
    }

    pub fn process_link(
        &mut self,
        content: &[u8],
        start: usize,
        _base_off: Off,
        is_image: bool,
        brackets: &BracketMatches,
    ) -> Result<Option<usize>, parser::Error> {
        // start points at '['
        // Find matching ']', skipping code spans and HTML tags (which take precedence)
        let Some(bracket) = self.match_bracket(content, start, brackets, 0) else {
            return Ok(None);
        };
        let has_inner_bracket = bracket.has_inner_bracket;
        let label_end = bracket.close;
        let label = &content[start + 1..label_end];
        let mut pos = label_end + 1; // skip ']'

        // Inline link: [text](url "title")
        if pos < content.len() && content[pos] == b'(' {
            pos += 1;
            // Skip whitespace (including newlines from merged paragraph lines)
            while pos < content.len()
                && (helpers::is_blank(content[pos])
                    || content[pos] == b'\n'
                    || content[pos] == b'\r')
            {
                pos += 1;
            }

            // Parse destination
            let mut dest_start = pos;
            let dest_end;
            let mut dest_valid = true;

            if pos < content.len() && content[pos] == b'<' {
                // Angle-bracket destination (no newlines or unescaped '<' allowed)
                dest_start = pos + 1;
                pos += 1;
                let mut angle_valid = true;
                while pos < content.len() && content[pos] != b'>' {
                    if content[pos] == b'\n' || content[pos] == b'\r' || content[pos] == b'<' {
                        angle_valid = false;
                        break;
                    }
                    if content[pos] == b'\\' && pos + 1 < content.len() {
                        pos += 2;
                    } else {
                        pos += 1;
                    }
                }
                if !angle_valid {
                    return Ok(None);
                }
                dest_end = pos;
                if pos < content.len() {
                    pos += 1; // skip >
                }
            } else {
                // Bare destination — balance parentheses (nesting depth is capped)
                let mut paren_depth: u32 = 0;
                while pos < content.len() && !helpers::is_whitespace(content[pos]) {
                    if content[pos] == b'(' {
                        paren_depth += 1;
                        if paren_depth > MAX_LINK_DEST_PAREN_DEPTH {
                            dest_valid = false;
                            break;
                        }
                    } else if content[pos] == b')' {
                        if paren_depth == 0 {
                            break;
                        }
                        paren_depth -= 1;
                    }
                    if content[pos] == b'\\' && pos + 1 < content.len() {
                        pos += 2;
                    } else {
                        pos += 1;
                    }
                }
                dest_end = pos;
            }

            if !dest_valid {
                // Destination exceeded the paren-nesting cap: not an inline
                // link (cmark rejects it too). Skip the title and ')' checks —
                // the offending '(' must not be reparsed as a title opener —
                // but keep the reference/shortcut fallback below reachable.
                pos = content.len();
            }

            // Skip whitespace (including newlines)
            while pos < content.len()
                && (helpers::is_blank(content[pos])
                    || content[pos] == b'\n'
                    || content[pos] == b'\r')
            {
                pos += 1;
            }

            // Optional title
            let mut title: &[u8] = b"";
            if pos < content.len()
                && (content[pos] == b'"' || content[pos] == b'\'' || content[pos] == b'(')
            {
                let close_char: u8 = if content[pos] == b'(' {
                    b')'
                } else {
                    content[pos]
                };
                let title_open = pos;
                pos += 1;
                let title_start = pos;
                let mut title_valid = true;
                while pos < content.len() && content[pos] != close_char {
                    if content[pos] == b'\\' && pos + 1 < content.len() {
                        pos += 2;
                        continue;
                    }
                    // A ()-delimited title may not contain an unescaped '('
                    if close_char == b')' && content[pos] == b'(' {
                        title_valid = false;
                        break;
                    }
                    pos += 1;
                }
                if title_valid {
                    title = &content[title_start..pos];
                    if pos < content.len() {
                        pos += 1; // skip closing quote
                    }
                } else {
                    pos = title_open;
                }
            }

            // Skip whitespace (including newlines)
            while pos < content.len()
                && (helpers::is_blank(content[pos])
                    || content[pos] == b'\n'
                    || content[pos] == b'\r')
            {
                pos += 1;
            }

            // Must end with ')'
            if pos < content.len() && content[pos] == b')' {
                pos += 1;
                let dest = &content[dest_start..dest_end];

                // Link nesting prohibition: links cannot contain other links (CommonMark §6.7)
                if !is_image
                    && has_inner_bracket
                    && self.label_contains_link(label, brackets, start + 1)
                {
                    return Ok(None);
                }

                if self.image_nesting_level > 0 {
                    // Inside image alt text — emit only text, no HTML tags
                    self.process_inline_content(label, 0)?;
                } else if is_image {
                    self.renderer.enter_span(
                        Span::Img,
                        SpanAttrs {
                            href: dest,
                            title,
                            ..Default::default()
                        },
                    )?;
                    self.image_nesting_level += 1;
                    self.process_inline_content(label, 0)?;
                    self.image_nesting_level -= 1;
                    self.renderer.leave_span(Span::Img)?;
                } else {
                    self.renderer.enter_span(
                        Span::A,
                        SpanAttrs {
                            href: dest,
                            title,
                            ..Default::default()
                        },
                    )?;
                    self.link_nesting_level += 1;
                    self.process_inline_content(label, 0)?;
                    self.link_nesting_level -= 1;
                    self.renderer.leave_span(Span::A)?;
                }

                return Ok(Some(pos));
            }
        }

        // Reference link: [text][ref] or [text][] or shortcut [text]
        if pos < content.len() && content[pos] == b'[' {
            pos += 1;
            let ref_start = pos;
            while pos < content.len() && content[pos] != b']' {
                if content[pos] == b'[' {
                    break; // nested [ not allowed in ref
                }
                if content[pos] == b'\\' && pos + 1 < content.len() {
                    pos += 2;
                } else {
                    pos += 1;
                }
            }
            if pos < content.len() && content[pos] == b']' {
                let ref_label = if pos > ref_start {
                    &content[ref_start..pos]
                } else {
                    label
                };
                pos += 1;
                if let Some(ref_def) = self.lookup_ref_def(ref_label) {
                    // PORT NOTE: reshaped for borrowck — clone owned dest/title so the
                    // &self borrow from lookup_ref_def is dropped before &mut self calls.
                    let dest: Box<[u8]> = Box::from(&ref_def.dest[..]);
                    let title: Box<[u8]> = Box::from(&ref_def.title[..]);
                    // Link nesting prohibition
                    if !is_image
                        && has_inner_bracket
                        && self.label_contains_link(label, brackets, start + 1)
                    {
                        return Ok(None);
                    }
                    self.render_ref_link(label, &dest, &title, is_image)?;
                    return Ok(Some(pos));
                }
            }
        }

        // Shortcut reference link: [text] (no following [)
        // Per CommonMark spec, shortcut refs must NOT be followed by [
        // Note: if followed by ( and inline link parsing failed above, still try shortcut
        let char_after_label: u8 = if label_end + 1 < content.len() {
            content[label_end + 1]
        } else {
            0
        };
        if char_after_label != b'[' {
            if let Some(ref_def) = self.lookup_ref_def(label) {
                // PORT NOTE: reshaped for borrowck — clone owned dest/title.
                let dest: Box<[u8]> = Box::from(&ref_def.dest[..]);
                let title: Box<[u8]> = Box::from(&ref_def.title[..]);
                // Link nesting prohibition
                if !is_image
                    && has_inner_bracket
                    && self.label_contains_link(label, brackets, start + 1)
                {
                    return Ok(None);
                }
                self.render_ref_link(label, &dest, &title, is_image)?;
                return Ok(Some(label_end + 1));
            }
        }

        Ok(None)
    }

    /// Try to match a bracket pair starting at `start` and check if it forms a link.
    /// Returns whether it's a link, where the label ends, and the full link end position.
    /// `base` is the offset of `content` within the slice `brackets` was built for.
    pub fn try_match_bracket_link(
        &mut self,
        content: &[u8],
        start: usize,
        brackets: &BracketMatches,
        base: usize,
    ) -> BracketLinkMatch {
        let Some(bracket) = self.match_bracket(content, start, brackets, base) else {
            return BracketLinkMatch {
                is_link: false,
                label_end: 0,
                link_end: 0,
            };
        };

        let label_end = bracket.close;
        let pos = label_end + 1; // skip ]

        if pos >= content.len() {
            // Shortcut reference check
            let inner_label = &content[start + 1..label_end];
            let is_ref = self.lookup_ref_def(inner_label).is_some();
            return BracketLinkMatch {
                is_link: is_ref,
                label_end,
                link_end: label_end + 1,
            };
        }

        // Inline link: ](...)
        if content[pos] == b'(' {
            let mut p = pos + 1;
            // Skip whitespace
            while p < content.len()
                && (helpers::is_blank(content[p]) || content[p] == b'\n' || content[p] == b'\r')
            {
                p += 1;
            }
            // Parse dest
            if p < content.len() && content[p] == b'<' {
                p += 1;
                while p < content.len()
                    && content[p] != b'>'
                    && content[p] != b'\n'
                    && content[p] != b'<'
                {
                    if content[p] == b'\\' && p + 1 < content.len() {
                        p += 2;
                    } else {
                        p += 1;
                    }
                }
                if p < content.len() && content[p] == b'>' {
                    p += 1;
                } else {
                    return BracketLinkMatch {
                        is_link: false,
                        label_end,
                        link_end: label_end + 1,
                    };
                }
            } else {
                let mut paren_depth: u32 = 0;
                while p < content.len() && !helpers::is_whitespace(content[p]) {
                    if content[p] == b'(' {
                        paren_depth += 1;
                        if paren_depth > MAX_LINK_DEST_PAREN_DEPTH {
                            // Not an inline link; skip the title/')' checks but
                            // keep the reference/shortcut fallback reachable
                            // (mirrors process_link).
                            p = content.len();
                            break;
                        }
                    } else if content[p] == b')' {
                        if paren_depth == 0 {
                            break;
                        }
                        paren_depth -= 1;
                    }
                    if content[p] == b'\\' && p + 1 < content.len() {
                        p += 2;
                    } else {
                        p += 1;
                    }
                }
            }
            // Skip whitespace
            while p < content.len()
                && (helpers::is_blank(content[p]) || content[p] == b'\n' || content[p] == b'\r')
            {
                p += 1;
            }
            // Optional title
            if p < content.len()
                && (content[p] == b'"' || content[p] == b'\'' || content[p] == b'(')
            {
                let close_ch: u8 = if content[p] == b'(' { b')' } else { content[p] };
                let title_open = p;
                p += 1;
                let mut title_valid = true;
                while p < content.len() && content[p] != close_ch {
                    if content[p] == b'\\' && p + 1 < content.len() {
                        p += 2;
                        continue;
                    }
                    // A ()-delimited title may not contain an unescaped '('
                    if close_ch == b')' && content[p] == b'(' {
                        title_valid = false;
                        break;
                    }
                    p += 1;
                }
                if title_valid {
                    if p < content.len() {
                        p += 1;
                    }
                } else {
                    p = title_open;
                }
            }
            // Skip whitespace
            while p < content.len()
                && (helpers::is_blank(content[p]) || content[p] == b'\n' || content[p] == b'\r')
            {
                p += 1;
            }
            if p < content.len() && content[p] == b')' {
                return BracketLinkMatch {
                    is_link: true,
                    label_end,
                    link_end: p + 1,
                };
            }
        }

        // Reference link: ][...]
        if content[pos] == b'[' {
            let mut p = pos + 1;
            while p < content.len() && content[p] != b']' {
                if content[p] == b'[' {
                    break;
                }
                if content[p] == b'\\' && p + 1 < content.len() {
                    p += 2;
                } else {
                    p += 1;
                }
            }
            if p < content.len() && content[p] == b']' {
                let ref_label = if p > pos + 1 {
                    &content[pos + 1..p]
                } else {
                    &content[start + 1..label_end]
                };
                if self.lookup_ref_def(ref_label).is_some() {
                    return BracketLinkMatch {
                        is_link: true,
                        label_end,
                        link_end: p + 1,
                    };
                }
            }
        }

        // Shortcut reference
        let inner_label = &content[start + 1..label_end];
        if self.lookup_ref_def(inner_label).is_some() {
            return BracketLinkMatch {
                is_link: true,
                label_end,
                link_end: label_end + 1,
            };
        }

        BracketLinkMatch {
            is_link: false,
            label_end,
            link_end: label_end + 1,
        }
    }

    /// Check if a link label contains an inner link construct.
    /// Used to enforce the "links cannot contain other links" rule (CommonMark §6.7).
    /// `base` is the offset of `label` within the slice `brackets` was built for.
    pub fn label_contains_link(
        &mut self,
        label: &[u8],
        brackets: &BracketMatches,
        base: usize,
    ) -> bool {
        let mut pos: usize = 0;
        while pos < label.len() {
            if label[pos] == b'\\' && pos + 1 < label.len() {
                pos += 2;
                continue;
            }
            // Skip code spans
            if label[pos] == b'`' {
                let count = inlines::count_backticks(label, pos);
                if let Some(end_pos) = self.find_code_span_end(label, pos + count, count) {
                    pos = end_pos + count;
                } else {
                    // No closer: skip the whole run so it isn't re-counted per
                    // backtick (quadratic on long unclosed runs in a label).
                    pos += count;
                }
                continue;
            }
            // Skip HTML tags and autolinks
            if label[pos] == b'<' && !self.flags.no_html_spans {
                if let Some(tag_end) = self.find_html_tag(label, pos) {
                    pos = tag_end;
                    continue;
                }
                if let Some(al) = self.find_autolink(label, pos) {
                    pos = al.end_pos;
                    continue;
                }
            }
            if label[pos] == b'[' {
                // Skip images (![...]) — images are allowed inside links
                let is_inner_image = pos > 0 && label[pos - 1] == b'!';
                // Try to find matching ] and check for link syntax
                let inner = self.try_match_bracket_link(label, pos, brackets, base);
                if inner.is_link && !is_inner_image {
                    return true;
                }
                if inner.link_end > pos {
                    // Skip past entire construct (including (url) or [ref] for images)
                    pos = inner.link_end;
                    continue;
                }
            }
            pos += 1;
        }
        false
    }

    /// Process wiki link: [[destination]] or [[destination|label]]
    pub fn process_wiki_link(
        &mut self,
        content: &[u8],
        start: usize,
    ) -> Result<Option<usize>, parser::Error> {
        // start points at first '[', next char is also '['
        let mut pos = start + 2;

        // Find closing ']]', checking for constraints
        let inner_start = pos;
        let mut pipe_pos: Option<usize> = None;
        let mut bracket_depth: u32 = 0;

        while pos < content.len() {
            if content[pos] == b'\n' || content[pos] == b'\r' {
                return Ok(None);
            }
            if content[pos] == b'[' {
                bracket_depth += 1;
                if bracket_depth > MAX_WIKI_BRACKET_DEPTH {
                    return Ok(None);
                }
            } else if content[pos] == b']' {
                if bracket_depth > 0 {
                    bracket_depth -= 1;
                } else if pos + 1 < content.len() && content[pos + 1] == b']' {
                    break;
                } else {
                    // Single ] without matching [, not a valid close
                    return Ok(None);
                }
            } else if content[pos] == b'|' && pipe_pos.is_none() && bracket_depth == 0 {
                pipe_pos = Some(pos);
            }
            pos += 1;
        }

        // Must end with ]]
        if pos >= content.len() || content[pos] != b']' {
            return Ok(None);
        }

        let inner_end = pos;

        // Determine target and label
        let target = if let Some(pp) = pipe_pos {
            &content[inner_start..pp]
        } else {
            &content[inner_start..inner_end]
        };
        let label = if let Some(pp) = pipe_pos {
            &content[pp + 1..inner_end]
        } else {
            &content[inner_start..inner_end]
        };

        // Target must not exceed 100 characters
        if target.len() > 100 {
            return Ok(None);
        }

        // Render the wikilink
        self.renderer.enter_span(
            Span::Wikilink,
            SpanAttrs {
                href: target,
                ..Default::default()
            },
        )?;
        self.process_inline_content(label, 0)?;
        self.renderer.leave_span(Span::Wikilink)?;

        Ok(Some(pos + 2)) // skip both ']'
    }

    /// Render a reference link/image given the resolved ref def.
    pub fn render_ref_link(
        &mut self,
        label_content: &[u8],
        dest: &[u8],
        title: &[u8],
        is_image: bool,
    ) -> Result<(), parser::Error> {
        if self.image_nesting_level > 0 {
            // Inside image alt text — emit only text, no HTML tags
            self.process_inline_content(label_content, 0)?;
        } else if is_image {
            self.renderer.enter_span(
                Span::Img,
                SpanAttrs {
                    href: dest,
                    title,
                    ..Default::default()
                },
            )?;
            self.image_nesting_level += 1;
            self.process_inline_content(label_content, 0)?;
            self.image_nesting_level -= 1;
            self.renderer.leave_span(Span::Img)?;
        } else {
            self.renderer.enter_span(
                Span::A,
                SpanAttrs {
                    href: dest,
                    title,
                    ..Default::default()
                },
            )?;
            self.link_nesting_level += 1;
            self.process_inline_content(label_content, 0)?;
            self.link_nesting_level -= 1;
            self.renderer.leave_span(Span::A)?;
        }
        Ok(())
    }

    pub fn find_autolink(&self, content: &[u8], start: usize) -> Option<Autolink> {
        if start + 1 >= content.len() {
            return None;
        }

        let pos = start + 1;

        // Check for URI autolink: scheme://...
        if helpers::is_alpha(content[pos]) {
            let mut scheme_end = pos;
            while scheme_end < content.len()
                && (helpers::is_alpha_num(content[scheme_end])
                    || content[scheme_end] == b'+'
                    || content[scheme_end] == b'-'
                    || content[scheme_end] == b'.')
            {
                scheme_end += 1;
            }
            let scheme_len = scheme_end - pos;
            if scheme_len >= 2
                && scheme_len <= 32
                && scheme_end < content.len()
                && content[scheme_end] == b':'
            {
                // URI autolink
                let mut uri_end = scheme_end + 1;
                while uri_end < content.len()
                    && content[uri_end] != b'>'
                    && !helpers::is_whitespace(content[uri_end])
                {
                    uri_end += 1;
                }
                if uri_end < content.len() && content[uri_end] == b'>' {
                    return Some(Autolink {
                        end_pos: uri_end + 1,
                        is_email: false,
                    });
                }
            }

            // Check for email autolink
            let mut email_pos = pos;
            // username part
            while email_pos < content.len()
                && (helpers::is_alpha_num(content[email_pos])
                    || content[email_pos] == b'.'
                    || content[email_pos] == b'-'
                    || content[email_pos] == b'_'
                    || content[email_pos] == b'+')
            {
                email_pos += 1;
            }
            if email_pos < content.len() && content[email_pos] == b'@' && email_pos > pos {
                email_pos += 1;
                // domain part: labels separated by '.', each 1-63 chars, alphanumeric or hyphen
                let domain_start = email_pos;
                let mut label_len: u32 = 0;
                let mut dot_count: u32 = 0;
                let mut valid_domain = true;
                while email_pos < content.len()
                    && (helpers::is_alpha_num(content[email_pos])
                        || content[email_pos] == b'.'
                        || content[email_pos] == b'-')
                {
                    if content[email_pos] == b'.' {
                        if label_len == 0 {
                            valid_domain = false;
                            break;
                        }
                        label_len = 0;
                        dot_count += 1;
                    } else {
                        label_len += 1;
                        if label_len > 63 {
                            valid_domain = false;
                            break;
                        }
                    }
                    email_pos += 1;
                }
                if valid_domain
                    && email_pos < content.len()
                    && content[email_pos] == b'>'
                    && email_pos > domain_start
                    && label_len > 0
                    && dot_count > 0
                    && helpers::is_alpha_num(content[email_pos - 1])
                {
                    return Some(Autolink {
                        end_pos: email_pos + 1,
                        is_email: true,
                    });
                }
            }
        }

        None
    }

    pub fn render_autolink(&mut self, url: &[u8], is_email: bool) -> crate::types::JsResult<()> {
        self.renderer.enter_span(
            Span::A,
            SpanAttrs {
                href: url,
                autolink: true,
                autolink_email: is_email,
                ..Default::default()
            },
        )?;
        self.emit_text(TextType::Normal, url)?;
        self.renderer.leave_span(Span::A)?;
        Ok(())
    }
}

// ported from: src/md/links.zig
