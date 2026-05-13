use core::mem::{align_of, size_of};

use bun_alloc::AllocError;

use crate::helpers;
use crate::parser::{BlockHeader, Parser};
use crate::types::{self, VerbatimLine};
use crate::unicode;

pub struct RefDef {
    pub label: Box<[u8]>, // normalized label
    pub dest: Box<[u8]>,  // raw destination (slice of source)
    pub title: Box<[u8]>, // raw title (slice of source)
}

// PORT NOTE: Zig anonymous return structs `?struct { ... }` are mapped to small
// named structs borrowing from the `text` parameter (BORROW_PARAM class).
pub struct ParsedRefDef<'a> {
    pub end_pos: usize,
    pub label: &'a [u8],
    pub dest: &'a [u8],
    pub title: &'a [u8],
}

pub struct ParsedDest<'a> {
    pub dest: &'a [u8],
    pub end_pos: usize,
}

pub struct ParsedTitle<'a> {
    pub title: &'a [u8],
    pub end_pos: usize,
}

impl Parser<'_> {
    /// Normalize a link label for comparison: collapse whitespace runs to single space,
    /// strip leading/trailing whitespace, case-fold.
    pub fn normalize_label(&mut self, raw: &[u8]) -> Vec<u8> {
        // Collapse whitespace and apply Unicode case folding (per CommonMark §6.7)
        // PORT NOTE: Zig returned `raw` on alloc failure; Rust Vec aborts on OOM, so
        // the `catch return raw` paths are dropped.
        let mut result: Vec<u8> = Vec::new();
        let mut in_ws = true; // skip leading whitespace
        let mut i: usize = 0;
        while i < raw.len() {
            let c = raw[i];
            match c {
                b' ' | b'\t' | b'\n' | b'\r' => {
                    if !in_ws && !result.is_empty() {
                        result.push(b' ');
                        in_ws = true;
                    }
                    i += 1;
                }
                0x80..=0xFF => {
                    // Multi-byte UTF-8: decode, case fold, re-encode
                    let decoded = helpers::decode_utf8(raw, i);
                    let fold = unicode::case_fold(decoded.codepoint);
                    let mut j: u8 = 0;
                    while j < fold.n_codepoints {
                        let mut buf = [0u8; 4];
                        let len = helpers::encode_utf8(fold.codepoints[j as usize], &mut buf);
                        if len > 0 {
                            result.extend_from_slice(&buf[0..len as usize]);
                        }
                        j += 1;
                    }
                    in_ws = false;
                    i += decoded.len as usize;
                }
                _ => {
                    // ASCII: simple toLower
                    result.push(c.to_ascii_lowercase());
                    in_ws = false;
                    i += 1;
                }
            }
        }
        // Strip trailing space
        if !result.is_empty() && result[result.len() - 1] == b' ' {
            result.truncate(result.len() - 1);
        }
        result
    }

    /// Look up a reference definition by label (case-insensitive, whitespace-normalized).
    // PORT NOTE: returns `Option<&RefDef>` instead of by-value copy; Zig RefDef was
    // three borrowed slices (Copy), Rust RefDef owns its buffers.
    pub fn lookup_ref_def(&mut self, raw_label: &[u8]) -> Option<&RefDef> {
        if raw_label.is_empty() {
            return None;
        }
        let normalized = self.normalize_label(raw_label);
        if normalized.is_empty() {
            return None; // whitespace-only labels are invalid
        }
        for rd in self.ref_defs.iter() {
            if rd.label[..] == normalized[..] {
                return Some(rd);
            }
        }
        None
    }

    /// Try to parse a link reference definition from merged paragraph text at position `pos`.
    /// Returns the end position and the parsed ref def, or None if not a valid ref def.
    pub fn parse_ref_def<'a>(&self, text: &'a [u8], pos: usize) -> Option<ParsedRefDef<'a>> {
        let mut p = pos;

        // Must start with [
        if p >= text.len() || text[p] != b'[' {
            return None;
        }
        p += 1;

        // Parse label: content up to ], no unescaped [ or ]
        let label_start = p;
        let mut label_len: usize = 0;
        while p < text.len() && text[p] != b']' {
            if text[p] == b'[' {
                return None; // no nested [
            }
            if text[p] == b'\\' && p + 1 < text.len() {
                p += 2;
                label_len += 2;
            } else {
                p += 1;
                label_len += 1;
            }
            if label_len > 999 {
                return None; // label too long
            }
        }
        if p >= text.len() {
            return None; // no closing ]
        }
        let label = &text[label_start..p];
        if label.is_empty() {
            return None; // empty label
        }
        p += 1; // skip ]

        // Must be followed by :
        if p >= text.len() || text[p] != b':' {
            return None;
        }
        p += 1;

        // Skip optional whitespace including up to one newline
        p = self.skip_ref_def_whitespace(text, p);

        // Parse destination
        let dest_result = self.parse_ref_def_dest(text, p)?;
        p = dest_result.end_pos;
        let dest = dest_result.dest;

        // Save position before trying title (may need to backtrack)
        let pos_after_dest = p;

        // Skip optional whitespace including up to one newline
        let p_before_title_ws = p;
        p = self.skip_ref_def_whitespace(text, p);
        let had_newline_before_title = 'blk: {
            let mut i = p_before_title_ws;
            while i < p {
                if text[i] == b'\n' {
                    break 'blk true;
                }
                i += 1;
            }
            break 'blk false;
        };

        // Parse optional title
        let mut title: &[u8] = b"";
        #[allow(unused_assignments)]
        let mut had_whitespace_before_title = false;
        if p < text.len() && (text[p] == b'"' || text[p] == b'\'' || text[p] == b'(') {
            // Check that there was actual whitespace between dest and title
            had_whitespace_before_title = p > pos_after_dest;
            if had_whitespace_before_title {
                if let Some(title_result) = self.parse_ref_def_title(text, p) {
                    // Title must be followed by optional whitespace then end of line or end of text
                    let mut after_title = title_result.end_pos;
                    while after_title < text.len()
                        && (text[after_title] == b' ' || text[after_title] == b'\t')
                    {
                        after_title += 1;
                    }
                    if after_title >= text.len() || text[after_title] == b'\n' {
                        title = title_result.title;
                        p = after_title;
                        if p < text.len() && text[p] == b'\n' {
                            p += 1;
                        }
                        return Some(ParsedRefDef {
                            end_pos: p,
                            label,
                            dest,
                            title,
                        });
                    }
                    // Title present but not followed by end of line — if title was on same line as dest, invalid
                    // If title was on new line, treat as no title (title line is separate paragraph content)
                    if !had_newline_before_title {
                        return None; // title on same line as dest but not at end of line
                    }
                } else {
                    // Invalid title syntax
                    if !had_newline_before_title {
                        return None;
                    }
                }
            }
        }

        // No title: backtrack to right after destination and check for end-of-line
        p = pos_after_dest;
        while p < text.len() && (text[p] == b' ' || text[p] == b'\t') {
            p += 1;
        }
        if p < text.len() && text[p] != b'\n' {
            return None;
        }
        if p < text.len() && text[p] == b'\n' {
            p += 1;
        }

        Some(ParsedRefDef {
            end_pos: p,
            label,
            dest,
            title,
        })
    }

    pub fn skip_ref_def_whitespace(&self, text: &[u8], start: usize) -> usize {
        let mut p = start;
        while p < text.len() && (text[p] == b' ' || text[p] == b'\t') {
            p += 1;
        }
        if p < text.len() && text[p] == b'\n' {
            p += 1;
            while p < text.len() && (text[p] == b' ' || text[p] == b'\t') {
                p += 1;
            }
        }
        p
    }

    pub fn parse_ref_def_dest<'a>(&self, text: &'a [u8], start: usize) -> Option<ParsedDest<'a>> {
        let mut p = start;
        if p >= text.len() {
            return None;
        }

        if text[p] == b'<' {
            // Angle-bracket destination
            p += 1;
            let dest_start = p;
            while p < text.len() && text[p] != b'>' && text[p] != b'\n' {
                if text[p] == b'\\' && p + 1 < text.len() {
                    p += 2;
                } else {
                    p += 1;
                }
            }
            if p >= text.len() || text[p] != b'>' {
                return None;
            }
            let dest = &text[dest_start..p];
            p += 1; // skip >
            Some(ParsedDest { dest, end_pos: p })
        } else {
            // Bare destination — balance parentheses
            let dest_start = p;
            let mut paren_depth: u32 = 0;
            while p < text.len() && !helpers::is_whitespace(text[p]) {
                if text[p] == b'(' {
                    paren_depth += 1;
                } else if text[p] == b')' {
                    if paren_depth == 0 {
                        break;
                    }
                    paren_depth -= 1;
                }
                if text[p] == b'\\' && p + 1 < text.len() {
                    p += 2;
                } else {
                    p += 1;
                }
            }
            if p == dest_start {
                return None; // empty dest not allowed for bare
            }
            Some(ParsedDest {
                dest: &text[dest_start..p],
                end_pos: p,
            })
        }
    }

    pub fn parse_ref_def_title<'a>(&self, text: &'a [u8], start: usize) -> Option<ParsedTitle<'a>> {
        let mut p = start;
        if p >= text.len() {
            return None;
        }

        let open_char = text[p];
        let close_char: u8 = match open_char {
            b'"' | b'\'' => open_char,
            b'(' => b')',
            _ => return None,
        };
        p += 1;
        let title_start = p;

        while p < text.len() && text[p] != close_char {
            if text[p] == b'\\' && p + 1 < text.len() {
                p += 2;
            } else {
                // For () titles, nested ( is not allowed
                if open_char == b'(' && text[p] == b'(' {
                    return None;
                }
                p += 1;
            }
        }
        if p >= text.len() {
            return None; // no closing quote/paren
        }
        let title = &text[title_start..p];
        p += 1; // skip close
        Some(ParsedTitle { title, end_pos: p })
    }

    pub fn build_ref_def_hashtable(&mut self) -> Result<(), AllocError> {
        let mut off: usize = 0;
        // PORT NOTE: reshaped for borrowck — take a raw pointer to block_bytes so we
        // can call &mut self methods (normalize_label, parse_ref_def via self.buffer)
        // while iterating the byte buffer. The Zig code mutates headers in-place via
        // pointer casts; we preserve that with raw pointer arithmetic.
        let bytes_ptr = self.block_bytes.as_mut_ptr();
        let bytes_len = self.block_bytes.len();

        while off < bytes_len {
            // Align to BlockHeader
            let align_mask: usize = align_of::<BlockHeader>() - 1;
            off = (off + align_mask) & !align_mask;
            if off + size_of::<BlockHeader>() > bytes_len {
                break;
            }

            // SAFETY: off is aligned to BlockHeader and within bounds; block_bytes
            // stores BlockHeader-prefixed records written by the block parser.
            let hdr: &mut BlockHeader = unsafe { &mut *bytes_ptr.add(off).cast::<BlockHeader>() };
            let hdr_off = off;
            off += size_of::<BlockHeader>();

            let n_lines = hdr.n_lines as usize;
            let lines_size = n_lines * size_of::<VerbatimLine>();
            if off + lines_size > bytes_len {
                break;
            }

            // SAFETY: VerbatimLine array immediately follows the header in block_bytes.
            let line_ptr: *mut VerbatimLine = unsafe { bytes_ptr.add(off).cast::<VerbatimLine>() };
            let block_lines: &[VerbatimLine] =
                unsafe { core::slice::from_raw_parts(line_ptr, n_lines) };
            off += lines_size;

            // Only process paragraph blocks (not container openers/closers)
            if hdr.block_type != types::BlockType::P
                || hdr.flags & types::BLOCK_CONTAINER_OPENER != 0
                || hdr.flags & types::BLOCK_CONTAINER_CLOSER != 0
            {
                continue;
            }

            if n_lines == 0 {
                continue;
            }

            // Merge lines into buffer to parse ref defs
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

            // PORT NOTE: reshaped for borrowck — move merged buffer out of self so
            // parse_ref_def/normalize_label can borrow &self/&mut self.
            let merged = core::mem::take(&mut self.buffer);
            let mut pos: usize = 0;
            let mut lines_consumed: u32 = 0;

            // Try to parse consecutive ref defs from the start
            while pos < merged.len() {
                let Some(result) = self.parse_ref_def(&merged, pos) else {
                    break;
                };

                // Normalize and store the ref def (first definition wins)
                let norm_label = self.normalize_label(result.label);
                if norm_label.is_empty() {
                    break; // whitespace-only labels are invalid
                }
                let label = norm_label.into_boxed_slice();
                if self.ref_def_labels.insert(label.clone()) {
                    // Dupe dest and title since they point into self.buffer which gets reused
                    let dest_dupe: Box<[u8]> = Box::from(result.dest);
                    let title_dupe: Box<[u8]> = Box::from(result.title);
                    self.ref_defs.push(RefDef {
                        label,
                        dest: dest_dupe,
                        title: title_dupe,
                    });
                    // PERF(port): was assume_capacity / arena alloc — profile in Phase B
                }

                // Count how many newlines were consumed to track lines
                let mut newlines: u32 = 0;
                for &mc in &merged[pos..result.end_pos] {
                    if mc == b'\n' {
                        newlines += 1;
                    }
                }
                // If end_pos is at the end and last char wasn't \n, that's still a consumed line
                if result.end_pos >= merged.len()
                    && (result.end_pos == pos || merged[result.end_pos - 1] != b'\n')
                {
                    newlines += 1;
                }
                lines_consumed += newlines;
                pos = result.end_pos;
            }

            // Restore buffer for reuse on next iteration.
            self.buffer = merged;

            // Update the block: mark consumed lines
            if lines_consumed > 0 {
                if lines_consumed as usize >= n_lines {
                    // Entire paragraph is ref defs — flag to skip during rendering
                    hdr.flags |= types::BLOCK_REF_DEF_ONLY;
                } else {
                    // Mark consumed lines as invalid (beg > end triggers skip in processLeafBlock)
                    // SAFETY: same VerbatimLine array as above; hdr_off + sizeof(header) is its start.
                    let line_base: *mut VerbatimLine = unsafe {
                        bytes_ptr
                            .add(hdr_off + size_of::<BlockHeader>())
                            .cast::<VerbatimLine>()
                    };
                    let mut i: u32 = 0;
                    while i < lines_consumed {
                        // SAFETY: i < lines_consumed < n_lines, in-bounds of the line array.
                        unsafe {
                            (*line_base.add(i as usize)).beg = 1;
                            (*line_base.add(i as usize)).end = 0;
                        }
                        i += 1;
                    }
                }
            }
        }

        Ok(())
    }
}

// ported from: src/md/ref_defs.zig
