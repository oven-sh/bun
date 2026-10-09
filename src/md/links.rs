use crate::helpers;
use crate::inlines;
use crate::parser::{self, Parser};
use crate::types::{OFF, SpanDetail, SpanType, TextType};

// Aliases for the real `SpanType` / `SpanDetail` types (named `Span` /
// `SpanAttrs` in the original implementation).
type Span = SpanType;
type SpanAttrs<'a> = SpanDetail<'a>;

/// Maximum parenthesis nesting depth inside a bare link destination.
/// CommonMark allows implementations to impose such a limit ("at least three
/// levels of nesting should be supported"); cmark and md4c both use
/// 32. Without a cap, an unclosed destination is rescanned for every candidate
/// link, which is quadratic on inputs like `"[a](b"` repeated.
const MAX_LINK_DEST_PAREN_DEPTH: u32 = 32;

/// Maximum `[`/`]` nesting depth inside a wiki link. Bounds the forward scan
/// for the closing `]]`, which is otherwise rescanned to the end of the line
/// for every `[[` candidate (quadratic on inputs like `"[".repeat(n)` when
/// wiki links are enabled, e.g. via `Bun.markdown.ansi`).
const MAX_WIKI_BRACKET_DEPTH: u32 = 32;

/// A successfully parsed link/image/wikilink whose opening span has been
/// emitted. The caller renders `content[label_start..label_end]` as inline
/// content, performs `leave`, and resumes at `link_end`. Returning this
/// instead of recursing keeps label nesting iterative (arbitrary depth, no
/// native stack growth).
pub(crate) struct LabelParse {
    pub(crate) label_start: usize,
    pub(crate) label_end: usize,
    pub(crate) link_end: usize,
    pub(crate) leave: LabelLeave,
}

/// Close action matching the span opened by `enter_label_span` /
/// `process_wiki_link`.
pub(crate) enum LabelLeave {
    /// Inside image alt text: no span was opened.
    AltText,
    Image,
    Link,
    Wikilink,
}

/// Result of `match_wiki_link`; the construct ends at `inner_end + 2`.
pub(crate) struct WikiLinkMatch {
    pub(crate) inner_start: usize,
    pub(crate) pipe_pos: Option<usize>,
    /// Position of the first closing `]`.
    pub(crate) inner_end: usize,
}

/// Result of `find_autolink`.
pub(crate) struct Autolink {
    pub(crate) end_pos: usize,
    pub(crate) is_email: bool,
}

/// Result of `scan_link_destination`.
pub(crate) struct ParsedDest<'a> {
    /// Raw destination, without the `<` `>` of the angle-bracket form.
    pub(crate) dest: &'a [u8],
    /// Position just past the destination (past the `>` of the angle-bracket form).
    pub(crate) end_pos: usize,
}

/// CommonMark §6.3 link destination, shared by inline links, the link lookahead and reference definitions.
pub(crate) fn scan_link_destination(text: &[u8], start: usize) -> Option<ParsedDest<'_>> {
    let escapes_next = |p: usize| p + 1 < text.len() && helpers::is_ascii_punctuation(text[p + 1]);
    let mut p = start;

    if p < text.len() && text[p] == b'<' {
        p += 1;
        let dest_start = p;
        while p < text.len() {
            match text[p] {
                b'>' => {
                    return Some(ParsedDest {
                        dest: &text[dest_start..p],
                        end_pos: p + 1,
                    });
                }
                b'<' | b'\n' | b'\r' => return None,
                b'\\' if escapes_next(p) => p += 2,
                _ => p += 1,
            }
        }
        return None;
    }

    let mut paren_depth: u32 = 0;
    while p < text.len() && !helpers::is_whitespace(text[p]) {
        match text[p] {
            b'\\' if escapes_next(p) => {
                p += 2;
                continue;
            }
            b'(' => {
                paren_depth += 1;
                if paren_depth > MAX_LINK_DEST_PAREN_DEPTH {
                    return None;
                }
            }
            b')' => {
                if paren_depth == 0 {
                    break;
                }
                paren_depth -= 1;
            }
            c if c.is_ascii_control() => return None,
            _ => {}
        }
        p += 1;
    }
    if paren_depth != 0 {
        return None;
    }
    Some(ParsedDest {
        dest: &text[start..p],
        end_pos: p,
    })
}

/// Characters that can affect bracket matching: the brackets themselves,
/// backslash escapes, code spans, and (unless HTML spans are disabled) HTML
/// tags/autolinks. Used to SIMD-skip runs of ordinary text while building the
/// bracket-pair map.
const BRACKET_SCAN_CHARS: &[u8] = b"[]\\`<";
const BRACKET_SCAN_CHARS_NO_HTML: &[u8] = b"[]\\`";

/// A `[` of inline content, outside of code spans, HTML tags/autolinks and
/// backslash escapes.
#[derive(Clone, Copy)]
pub(crate) struct Bracket {
    open: OFF,
    /// Where the `]` is that closes it. `UNMATCHED`: there is none.
    close: OFF,
    /// Where the link or the image ends that it starts. 0: it starts none.
    link_end: OFF,
    /// It is the `[` of `![`.
    is_image: bool,
}

/// The brackets of one inline content slice, and which of them are links,
/// found in a single pass: as in cmark, what a `[` starts is decided when its
/// `]` is reached. The backing vec is recycled through `Parser.bracket_pairs`,
/// so steady-state rendering does not allocate here.
pub(crate) struct BracketMatches {
    /// Ordered by `open`.
    pairs: Vec<Bracket>,
}

impl BracketMatches {
    const UNMATCHED: OFF = OFF::MAX;

    /// Hand the backing storage back for reuse by the next inline slice.
    pub(crate) fn into_storage(self) -> Vec<Bracket> {
        self.pairs
    }

    /// Of the link, or the image, that the `[` at `open` starts: where its
    /// label ends, and where it ends.
    pub(crate) fn link(&self, open: usize, is_image: bool) -> Option<(usize, usize)> {
        let index = self
            .pairs
            .binary_search_by_key(&(open as OFF), |it| it.open)
            .ok()?;
        let it = self.pairs[index];
        (it.link_end != 0 && it.is_image == is_image)
            .then_some((it.close as usize, it.link_end as usize))
    }

    /// Nothing closes the brackets that are open, of which `top` is the last.
    fn leave_open(pairs: &mut [Bracket], mut top: OFF) {
        while top != Self::UNMATCHED {
            let index = top as usize;
            top = pairs[index].close;
            pairs[index].close = Self::UNMATCHED;
        }
    }
}

impl Parser<'_> {
    /// Pair the brackets of `content` and tell which of them are links, in a
    /// single pass (code spans, HTML tags, autolinks and backslash escapes hide
    /// brackets). `storage` is the recycled backing vec from
    /// `Parser.bracket_pairs`.
    pub(crate) fn compute_bracket_matches(
        &mut self,
        content: &[u8],
        mut storage: Vec<Bracket>,
    ) -> BracketMatches {
        storage.clear();
        debug_assert!(content.len() <= OFF::MAX as usize);

        // Without a '[' and a ']' there is no link — skip the walk.
        if bun_core::strings::index_of_char(content, b'[').is_none()
            || bun_core::strings::index_of_char(content, b']').is_none()
        {
            return BracketMatches { pairs: storage };
        }

        let scan_chars: &'static [u8] = if self.flags.no_html_spans {
            BRACKET_SCAN_CHARS_NO_HTML
        } else {
            BRACKET_SCAN_CHARS
        };

        // While an opener is still unmatched, its `close` slot holds the index
        // of the previous unmatched opener — a stack threaded through the vec
        // itself, so no separate stack allocation is needed.
        let mut top: OFF = BracketMatches::UNMATCHED;
        // The openers before this index that are still unmatched have a link in
        // them: links cannot contain other links (CommonMark §6.7)
        let mut inactive_below: usize = 0;
        // Where the last backslash escape ends.
        let mut escape_end: usize = 0;
        // Of the wiki links whose label `pos` is in: where what is around the
        // label ends, and the opener that was the last before it.
        let mut around_wiki_labels: Vec<(usize, OFF)> = Vec::new();
        // A label is content of its own.
        let mut end = content.len();
        let mut pos: usize = 0;
        loop {
            if pos >= end {
                let Some((outer_end, outer_top)) = around_wiki_labels.pop() else {
                    break;
                };
                BracketMatches::leave_open(&mut storage, top);
                pos = end + 2;
                (end, top) = (outer_end, outer_top);
                continue;
            }
            let content = &content[..end];
            match content[pos] {
                b'\\' => {
                    pos += 2;
                    escape_end = pos;
                }
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
                    let is_image = pos > 0 && content[pos - 1] == b'!' && escape_end != pos;
                    if self.flags.wiki_links
                        && !is_image
                        && content.get(pos + 1) == Some(&b'[')
                        && let Some(wiki_link) = self.match_wiki_link(content, pos)
                    {
                        around_wiki_labels.push((end, top));
                        (end, top) = (wiki_link.inner_end, BracketMatches::UNMATCHED);
                        pos = match wiki_link.pipe_pos {
                            Some(pipe) => pipe + 1,
                            None => wiki_link.inner_start,
                        };
                        continue;
                    }
                    let index = storage.len() as OFF;
                    storage.push(Bracket {
                        open: pos as OFF,
                        close: top,
                        link_end: 0,
                        is_image,
                    });
                    top = index;
                    pos += 1;
                }
                b']' if top != BracketMatches::UNMATCHED => {
                    let index = top as usize;
                    let Bracket { open, is_image, .. } = storage[index];
                    top = storage[index].close;
                    storage[index].close = pos as OFF;
                    pos += 1;
                    if (is_image || index >= inactive_below)
                        && let Some(link_end) =
                            self.link_end_behind(content, open as usize, pos - 1)
                    {
                        storage[index].link_end = link_end as OFF;
                        if !is_image {
                            inactive_below = index;
                        }
                        pos = link_end;
                    }
                }
                b']' => pos += 1,
                // Ordinary text: SIMD-jump to the next character that can
                // affect bracket matching.
                _ => match bun_core::strings::index_of_any(&content[pos..], scan_chars) {
                    Some(rel) => pos += rel,
                    None => pos = end,
                },
            }
        }
        BracketMatches::leave_open(&mut storage, top);

        BracketMatches { pairs: storage }
    }

    /// Emit the opening span for a link/image whose label is about to be
    /// rendered, and return the matching close action for the caller to run
    /// once the label content has been emitted.
    fn enter_label_span(
        &mut self,
        dest: &[u8],
        title: &[u8],
        is_image: bool,
    ) -> Result<LabelLeave, parser::Error> {
        if self.image_nesting_level > 0 {
            // Inside image alt text: emit only text, no HTML tags
            Ok(LabelLeave::AltText)
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
            Ok(LabelLeave::Image)
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
            Ok(LabelLeave::Link)
        }
    }

    pub(crate) fn process_link(
        &mut self,
        content: &[u8],
        start: usize,
        is_image: bool,
        brackets: &BracketMatches,
        base: usize,
    ) -> Result<Option<LabelParse>, parser::Error> {
        // start points at '['
        let Some(label_end) = brackets
            .link(base + start, is_image)
            .and_then(|it| it.0.checked_sub(base))
            .filter(|&label_end| start < label_end && label_end < content.len())
        else {
            return Ok(None);
        };
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

            let dest: &[u8] = match scan_link_destination(content, pos) {
                Some(parsed) => {
                    pos = parsed.end_pos;
                    parsed.dest
                }
                None => {
                    // Not an inline link: skip the title and ')' checks, keep the reference/shortcut fallback.
                    pos = content.len();
                    b""
                }
            };

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

                let leave = self.enter_label_span(dest, title, is_image)?;
                return Ok(Some(LabelParse {
                    label_start: start + 1,
                    label_end,
                    link_end: pos,
                    leave,
                }));
            }
        }

        // Reference link: [text][ref] or [text][] or shortcut [text].
        // A reference label must start immediately after the closing ']'; a
        // failed inline-link parse above may have advanced `pos` onto a later
        // '[' (e.g. "[foo](bar [ref])"), which must not be read as the
        // reference (link_end_behind checks the byte after ']' too).
        pos = label_end + 1;
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
                    // Clone the owned dest/title so the &self borrow from
                    // lookup_ref_def is dropped before &mut self calls.
                    let dest: Box<[u8]> = Box::from(&ref_def.dest[..]);
                    let title: Box<[u8]> = Box::from(&ref_def.title[..]);
                    if !self.charge_ref_def_output(dest.len(), title.len()) {
                        return Ok(None);
                    }
                    let leave = self.enter_label_span(&dest, &title, is_image)?;
                    return Ok(Some(LabelParse {
                        label_start: start + 1,
                        label_end,
                        link_end: pos,
                        leave,
                    }));
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
                // Clone the owned dest/title so the &self borrow from
                // lookup_ref_def is dropped before &mut self calls.
                let dest: Box<[u8]> = Box::from(&ref_def.dest[..]);
                let title: Box<[u8]> = Box::from(&ref_def.title[..]);
                if !self.charge_ref_def_output(dest.len(), title.len()) {
                    return Ok(None);
                }
                let leave = self.enter_label_span(&dest, &title, is_image)?;
                return Ok(Some(LabelParse {
                    label_start: start + 1,
                    label_end,
                    link_end: label_end + 1,
                    leave,
                }));
            }
        }

        Ok(None)
    }

    /// Where the link or the image ends whose label is between the `[` at
    /// `start` and the `]` at `label_end`, if what is behind the label makes it
    /// one.
    fn link_end_behind(&mut self, content: &[u8], start: usize, label_end: usize) -> Option<usize> {
        let pos = label_end + 1; // skip ]

        if pos >= content.len() {
            // Shortcut reference check
            let inner_label = &content[start + 1..label_end];
            return self
                .lookup_ref_def(inner_label)
                .is_some()
                .then_some(label_end + 1);
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
            // Must agree with process_link, or emphasis collection desyncs from rendering.
            p = match scan_link_destination(content, p) {
                Some(parsed) => parsed.end_pos,
                None => content.len(),
            };
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
                return Some(p + 1);
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
                    return Some(p + 1);
                }
            }
        }

        // Shortcut reference: like process_link, a shortcut must not be
        // followed by '[' (the lookahead and the parser must agree on what
        // is a link)
        if content.get(label_end + 1) != Some(&b'[') {
            let inner_label = &content[start + 1..label_end];
            if self.lookup_ref_def(inner_label).is_some() {
                return Some(label_end + 1);
            }
        }

        None
    }

    /// Lookahead-only match of `[[destination]]` / `[[destination|label]]`,
    /// shared by rendering and emphasis collection so they agree.
    pub(crate) fn match_wiki_link(&self, content: &[u8], start: usize) -> Option<WikiLinkMatch> {
        // start points at first '[', next char is also '['
        let mut pos = start + 2;

        // Find closing ']]', checking for constraints
        let inner_start = pos;
        let mut pipe_pos: Option<usize> = None;
        let mut bracket_depth: u32 = 0;

        while pos < content.len() {
            if content[pos] == b'\n' || content[pos] == b'\r' {
                return None;
            }
            if content[pos] == b'[' {
                bracket_depth += 1;
                if bracket_depth > MAX_WIKI_BRACKET_DEPTH {
                    return None;
                }
            } else if content[pos] == b']' {
                if bracket_depth > 0 {
                    bracket_depth -= 1;
                } else if pos + 1 < content.len() && content[pos + 1] == b']' {
                    break;
                } else {
                    // Single ] without matching [, not a valid close
                    return None;
                }
            } else if content[pos] == b'|' && pipe_pos.is_none() && bracket_depth == 0 {
                pipe_pos = Some(pos);
            }
            pos += 1;
        }

        // Must end with ]]
        if pos >= content.len() || content[pos] != b']' {
            return None;
        }

        let inner_end = pos;

        // Target must not exceed 100 characters
        let target_end = pipe_pos.unwrap_or(inner_end);
        if target_end - inner_start > 100 {
            return None;
        }

        Some(WikiLinkMatch {
            inner_start,
            pipe_pos,
            inner_end,
        })
    }

    /// Process wiki link: [[destination]] or [[destination|label]]
    pub(crate) fn process_wiki_link(
        &mut self,
        content: &[u8],
        start: usize,
    ) -> Result<Option<LabelParse>, parser::Error> {
        let Some(m) = self.match_wiki_link(content, start) else {
            return Ok(None);
        };

        let target = &content[m.inner_start..m.pipe_pos.unwrap_or(m.inner_end)];

        // Render the wikilink
        self.renderer.enter_span(
            Span::Wikilink,
            SpanAttrs {
                href: target,
                ..Default::default()
            },
        )?;
        let label_start = match m.pipe_pos {
            Some(pp) => pp + 1,
            None => m.inner_start,
        };
        Ok(Some(LabelParse {
            label_start,
            label_end: m.inner_end,
            link_end: m.inner_end + 2, // skip both ']'
            leave: LabelLeave::Wikilink,
        }))
    }

    pub(crate) fn find_autolink(&self, content: &[u8], start: usize) -> Option<Autolink> {
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
                    && content[uri_end] != b'<'
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
        }

        // Check for email autolink
        let mut email_pos = pos;
        // username part
        while email_pos < content.len()
            && (helpers::is_alpha_num(content[email_pos])
                || bun_core::strings::contains_char(b".!#$%&'*+/=?^_`{|}~-", content[email_pos]))
        {
            email_pos += 1;
        }
        if email_pos < content.len() && content[email_pos] == b'@' && email_pos > pos {
            email_pos += 1;
            // domain part: labels separated by '.', each 1-63 chars, alphanumeric or
            // hyphen, which is neither the first nor the last of them
            let mut label_len: u32 = 0;
            let mut valid_domain = true;
            while email_pos < content.len()
                && (helpers::is_alpha_num(content[email_pos])
                    || content[email_pos] == b'.'
                    || content[email_pos] == b'-')
            {
                if content[email_pos] == b'.' {
                    if label_len == 0 || content[email_pos - 1] == b'-' {
                        valid_domain = false;
                        break;
                    }
                    label_len = 0;
                } else {
                    if label_len == 0 && content[email_pos] == b'-' {
                        valid_domain = false;
                        break;
                    }
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
                && label_len > 0
                && helpers::is_alpha_num(content[email_pos - 1])
            {
                return Some(Autolink {
                    end_pos: email_pos + 1,
                    is_email: true,
                });
            }
        }

        None
    }

    pub(crate) fn render_autolink(
        &mut self,
        url: &[u8],
        is_email: bool,
    ) -> crate::types::JsResult<()> {
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
