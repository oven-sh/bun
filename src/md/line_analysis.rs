use super::helpers;
use super::parser::Parser;
use super::types;
use super::types::{Align, Container, OFF};

// ──────────────────────────────────────────────────────────────────────────
// Result types for the anonymous-struct returns in the Zig source.
// Kept as named structs (not tuples) so field names line up with the .zig
// for side-by-side diffing.
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone)]
pub struct SetextResult {
    pub is_setext: bool,
    pub level: u32,
}

#[derive(Copy, Clone)]
pub struct AtxResult {
    pub is_atx: bool,
    pub level: u32,
    pub content_beg: OFF,
}

#[derive(Copy, Clone)]
pub struct FenceResult {
    pub is_fence: bool,
    pub fence_data: u32,
}

#[derive(Copy, Clone)]
pub struct TableUnderlineResult {
    pub is_underline: bool,
    pub col_count: u32,
}

#[derive(Clone)]
pub struct ContainerMarkResult {
    pub is_container: bool,
    pub container: Container,
    pub off: OFF,
}

// Small helper: index `self.text` (a `&[u8]`) by an `OFF`.
#[inline(always)]
fn ch(text: &[u8], pos: OFF) -> u8 {
    text[pos as usize]
}

impl Parser {
    pub fn is_setext_underline(&self, off: OFF) -> SetextResult {
        let c = ch(&self.text, off);
        if c != b'=' && c != b'-' {
            return SetextResult { is_setext: false, level: 0 };
        }

        let mut pos = off;
        while pos < self.size && ch(&self.text, pos) == c {
            pos += 1;
        }

        // Skip trailing spaces
        while pos < self.size && helpers::is_blank(ch(&self.text, pos)) {
            pos += 1;
        }

        if pos >= self.size || helpers::is_newline(ch(&self.text, pos)) {
            let level: u32 = if c == b'=' { 1 } else { 2 };
            return SetextResult { is_setext: true, level };
        }

        SetextResult { is_setext: false, level: 0 }
    }

    pub fn is_hr_line(&self, off: OFF) -> bool {
        let c = ch(&self.text, off);
        if c != b'-' && c != b'_' && c != b'*' {
            return false;
        }

        let mut pos = off;
        let mut count: u32 = 0;
        while pos < self.size && !helpers::is_newline(ch(&self.text, pos)) {
            if ch(&self.text, pos) == c {
                count += 1;
            } else if !helpers::is_blank(ch(&self.text, pos)) {
                return false;
            }
            pos += 1;
        }

        count >= 3
    }

    pub fn is_atx_header_line(&self, off: OFF) -> AtxResult {
        let mut pos = off;
        let mut level: u32 = 0;

        while pos < self.size && ch(&self.text, pos) == b'#' {
            level += 1;
            pos += 1;
        }

        if level == 0 || level > 6 {
            return AtxResult { is_atx: false, level: 0, content_beg: 0 };
        }

        // Must be followed by space or end of line
        if pos < self.size
            && !helpers::is_blank(ch(&self.text, pos))
            && !helpers::is_newline(ch(&self.text, pos))
        {
            if !self.flags.permissive_atx_headers {
                return AtxResult { is_atx: false, level: 0, content_beg: 0 };
            }
        }

        // Skip spaces after #
        while pos < self.size && helpers::is_blank(ch(&self.text, pos)) {
            pos += 1;
        }

        AtxResult { is_atx: true, level, content_beg: pos }
    }

    pub fn is_opening_code_fence(&self, off: OFF) -> FenceResult {
        if off >= self.size {
            return FenceResult { is_fence: false, fence_data: 0 };
        }
        let fence_char = ch(&self.text, off);
        let mut pos = off;
        let mut count: u32 = 0;

        while pos < self.size && ch(&self.text, pos) == fence_char {
            count += 1;
            pos += 1;
        }

        if count < 3 {
            return FenceResult { is_fence: false, fence_data: 0 };
        }

        // Backtick fences can't have backticks in info string
        if fence_char == b'`' {
            let mut check = pos;
            while check < self.size && !helpers::is_newline(ch(&self.text, check)) {
                if ch(&self.text, check) == b'`' {
                    return FenceResult { is_fence: false, fence_data: 0 };
                }
                check += 1;
            }
        }

        // Encode: fence_char in low byte, count in next bytes
        let data: u32 = (fence_char as u32) | (count << 8);
        FenceResult { is_fence: true, fence_data: data }
    }

    pub fn is_closing_code_fence(&self, off: OFF, fence_data: u32) -> bool {
        let fence_char: u8 = fence_data as u8; // @truncate
        let fence_count = fence_data >> 8;

        let mut pos = off;
        let mut count: u32 = 0;
        while pos < self.size && ch(&self.text, pos) == fence_char {
            count += 1;
            pos += 1;
        }

        if count < fence_count {
            return false;
        }

        // Rest of line must be blank
        while pos < self.size && helpers::is_blank(ch(&self.text, pos)) {
            pos += 1;
        }

        pos >= self.size || helpers::is_newline(ch(&self.text, pos))
    }

    pub fn is_html_block_start_condition(&self, off: OFF) -> u8 {
        if off + 1 >= self.size {
            return 0;
        }

        // Type 1: <script, <pre, <style, <textarea (case insensitive)
        // Only opening tags start type 1 blocks. Closing tags like </pre> are
        // only END conditions for type 1, not start conditions.
        if ch(&self.text, off + 1) != b'/'
            && (self.match_html_tag(off, b"script")
                || self.match_html_tag(off, b"pre")
                || self.match_html_tag(off, b"style")
                || self.match_html_tag(off, b"textarea"))
        {
            return 1;
        }

        // Type 2: <!-- (comment)
        if off + 3 < self.size
            && ch(&self.text, off + 1) == b'!'
            && ch(&self.text, off + 2) == b'-'
            && ch(&self.text, off + 3) == b'-'
        {
            return 2;
        }

        // Type 3: <? (processing instruction)
        if ch(&self.text, off + 1) == b'?' {
            return 3;
        }

        // Type 4: <! followed by uppercase letter (declaration)
        if ch(&self.text, off + 1) == b'!'
            && off + 2 < self.size
            && ch(&self.text, off + 2) >= b'A'
            && ch(&self.text, off + 2) <= b'Z'
        {
            return 4;
        }

        // Type 5: <![CDATA[
        if off + 9 <= self.size
            && &self.text[(off + 1) as usize..(off + 9) as usize] == b"![CDATA["
        {
            return 5;
        }

        // Type 6: block-level tags
        if self.is_block_level_html_tag(off) {
            return 6;
        }

        // Type 7: any complete open or closing tag (not interrupting paragraph)
        if self.is_complete_html_tag(off) {
            return 7;
        }

        0
    }

    pub fn is_html_block_end_condition(&self, off: OFF, block_type: u8) -> bool {
        // Types 6 and 7: end condition is a blank line
        if block_type >= 6 {
            return off >= self.size || helpers::is_newline(ch(&self.text, off));
        }

        // Types 1-5: search from off to end of line for specific end patterns
        let mut pos = off;
        while pos < self.size && !helpers::is_newline(ch(&self.text, pos)) {
            match block_type {
                1 => {
                    // Type 1: </script>, </pre>, </style>, </textarea> (case insensitive)
                    if ch(&self.text, pos) == b'<'
                        && pos + 1 < self.size
                        && ch(&self.text, pos + 1) == b'/'
                    {
                        if self.match_html_tag(pos, b"script")
                            || self.match_html_tag(pos, b"pre")
                            || self.match_html_tag(pos, b"style")
                            || self.match_html_tag(pos, b"textarea")
                        {
                            return true;
                        }
                    }
                }
                2 => {
                    // Type 2: -->
                    if ch(&self.text, pos) == b'-'
                        && pos + 2 < self.size
                        && ch(&self.text, pos + 1) == b'-'
                        && ch(&self.text, pos + 2) == b'>'
                    {
                        return true;
                    }
                }
                3 => {
                    // Type 3: ?>
                    if ch(&self.text, pos) == b'?'
                        && pos + 1 < self.size
                        && ch(&self.text, pos + 1) == b'>'
                    {
                        return true;
                    }
                }
                4 => {
                    // Type 4: >
                    if ch(&self.text, pos) == b'>' {
                        return true;
                    }
                }
                5 => {
                    // Type 5: ]]>
                    if ch(&self.text, pos) == b']'
                        && pos + 2 < self.size
                        && ch(&self.text, pos + 1) == b']'
                        && ch(&self.text, pos + 2) == b'>'
                    {
                        return true;
                    }
                }
                _ => return false,
            }
            pos += 1;
        }
        false
    }

    pub fn match_html_tag(&self, off: OFF, tag: &[u8]) -> bool {
        if (off as usize) + 1 + tag.len() >= self.size as usize {
            return false;
        }
        let start = off + 1;
        // Allow optional / for closing tags
        let mut pos = start;
        if pos < self.size && ch(&self.text, pos) == b'/' {
            pos += 1;
        }
        if (pos as usize) + tag.len() > self.size as usize {
            return false;
        }
        if !helpers::ascii_case_eql(
            &self.text[pos as usize..pos as usize + tag.len()],
            tag,
        ) {
            return false;
        }
        pos += u32::try_from(tag.len()).unwrap();
        // TODO(port): if OFF != u32, adjust the cast above.
        if pos >= self.size {
            return true;
        }
        let after = ch(&self.text, pos);
        after == b'>' || after == b'/' || helpers::is_blank(after) || helpers::is_newline(after)
    }

    pub fn is_block_level_html_tag(&self, off: OFF) -> bool {
        const BLOCK_TAGS: &[&[u8]] = &[
            b"address", b"article",  b"aside",   b"base",     b"basefont", b"blockquote", b"body",
            b"caption", b"center",   b"col",     b"colgroup", b"dd",       b"details",    b"dialog",
            b"dir",     b"div",      b"dl",      b"dt",       b"fieldset", b"figcaption", b"figure",
            b"footer",  b"form",     b"frame",   b"frameset", b"h1",       b"h2",         b"h3",
            b"h4",      b"h5",       b"h6",      b"head",     b"header",   b"hr",         b"html",
            b"iframe",  b"legend",   b"li",      b"link",     b"main",     b"menu",       b"menuitem",
            b"nav",     b"noframes", b"ol",      b"optgroup", b"option",   b"p",          b"param",
            b"search",  b"section",  b"summary", b"table",    b"tbody",    b"td",         b"tfoot",
            b"th",      b"thead",    b"title",   b"tr",       b"track",    b"ul",
        ];

        for tag in BLOCK_TAGS {
            if self.match_html_tag(off, tag) {
                return true;
            }
        }
        false
    }

    pub fn is_complete_html_tag(&self, off: OFF) -> bool {
        if off + 1 >= self.size {
            return false;
        }
        let mut pos = off + 1;

        // Closing tag
        if pos < self.size && ch(&self.text, pos) == b'/' {
            pos += 1;
            if pos >= self.size || !helpers::is_alpha(ch(&self.text, pos)) {
                return false;
            }
            while pos < self.size
                && (helpers::is_alpha_num(ch(&self.text, pos)) || ch(&self.text, pos) == b'-')
            {
                pos += 1;
            }
            while pos < self.size && helpers::is_blank(ch(&self.text, pos)) {
                pos += 1;
            }
            if pos >= self.size || ch(&self.text, pos) != b'>' {
                return false;
            }
            pos += 1;
            // Rest of line must be whitespace only
            while pos < self.size && helpers::is_blank(ch(&self.text, pos)) {
                pos += 1;
            }
            return pos >= self.size || helpers::is_newline(ch(&self.text, pos));
        }

        // Opening tag: <tagname (attributes)* optional-/ >
        if !helpers::is_alpha(ch(&self.text, pos)) {
            return false;
        }
        while pos < self.size
            && (helpers::is_alpha_num(ch(&self.text, pos)) || ch(&self.text, pos) == b'-')
        {
            pos += 1;
        }

        // Parse attributes
        loop {
            let ws_start = pos;
            while pos < self.size && helpers::is_blank(ch(&self.text, pos)) {
                pos += 1;
            }
            if pos >= self.size || helpers::is_newline(ch(&self.text, pos)) {
                return false;
            }

            // Check for end of tag
            if ch(&self.text, pos) == b'>' {
                pos += 1;
                break;
            }
            if ch(&self.text, pos) == b'/'
                && pos + 1 < self.size
                && ch(&self.text, pos + 1) == b'>'
            {
                pos += 2;
                break;
            }

            // Attributes must be preceded by whitespace
            if pos == ws_start {
                return false;
            }

            // Attribute name: [a-zA-Z_:][a-zA-Z0-9_.:-]*
            if !helpers::is_alpha(ch(&self.text, pos))
                && ch(&self.text, pos) != b'_'
                && ch(&self.text, pos) != b':'
            {
                return false;
            }
            pos += 1;
            while pos < self.size
                && (helpers::is_alpha_num(ch(&self.text, pos))
                    || ch(&self.text, pos) == b'_'
                    || ch(&self.text, pos) == b'.'
                    || ch(&self.text, pos) == b':'
                    || ch(&self.text, pos) == b'-')
            {
                pos += 1;
            }

            // Optional attribute value
            let mut ws_pos = pos;
            while ws_pos < self.size && helpers::is_blank(ch(&self.text, ws_pos)) {
                ws_pos += 1;
            }
            if ws_pos < self.size && ch(&self.text, ws_pos) == b'=' {
                pos = ws_pos + 1;
                while pos < self.size && helpers::is_blank(ch(&self.text, pos)) {
                    pos += 1;
                }
                if pos >= self.size || helpers::is_newline(ch(&self.text, pos)) {
                    return false;
                }

                if ch(&self.text, pos) == b'"' {
                    pos += 1;
                    while pos < self.size
                        && ch(&self.text, pos) != b'"'
                        && !helpers::is_newline(ch(&self.text, pos))
                    {
                        pos += 1;
                    }
                    if pos >= self.size || ch(&self.text, pos) != b'"' {
                        return false;
                    }
                    pos += 1;
                } else if ch(&self.text, pos) == b'\'' {
                    pos += 1;
                    while pos < self.size
                        && ch(&self.text, pos) != b'\''
                        && !helpers::is_newline(ch(&self.text, pos))
                    {
                        pos += 1;
                    }
                    if pos >= self.size || ch(&self.text, pos) != b'\'' {
                        return false;
                    }
                    pos += 1;
                } else {
                    // Unquoted value
                    while pos < self.size
                        && !helpers::is_blank(ch(&self.text, pos))
                        && !helpers::is_newline(ch(&self.text, pos))
                        && ch(&self.text, pos) != b'"'
                        && ch(&self.text, pos) != b'\''
                        && ch(&self.text, pos) != b'='
                        && ch(&self.text, pos) != b'<'
                        && ch(&self.text, pos) != b'>'
                        && ch(&self.text, pos) != b'`'
                    {
                        pos += 1;
                    }
                }
            }
        }

        // Rest of line must be whitespace only
        while pos < self.size && helpers::is_blank(ch(&self.text, pos)) {
            pos += 1;
        }
        pos >= self.size || helpers::is_newline(ch(&self.text, pos))
    }

    pub fn is_table_underline(&mut self, off: OFF) -> TableUnderlineResult {
        let mut pos = off;
        let mut col_count: u32 = 0;
        let mut had_pipe = false;

        // Skip leading pipe
        if pos < self.size && ch(&self.text, pos) == b'|' {
            had_pipe = true;
            pos += 1;
            while pos < self.size && helpers::is_blank(ch(&self.text, pos)) {
                pos += 1;
            }
        }

        while pos < self.size && !helpers::is_newline(ch(&self.text, pos)) {
            // Expect optional ':' then dashes then optional ':'
            let has_left_colon = pos < self.size && ch(&self.text, pos) == b':';
            if has_left_colon {
                pos += 1;
            }

            let mut dash_count: u32 = 0;
            while pos < self.size && ch(&self.text, pos) == b'-' {
                dash_count += 1;
                pos += 1;
            }

            if dash_count == 0 {
                return TableUnderlineResult { is_underline: false, col_count: 0 };
            }

            let has_right_colon = pos < self.size && ch(&self.text, pos) == b':';
            if has_right_colon {
                pos += 1;
            }

            // Determine alignment
            if col_count < types::TABLE_MAXCOLCOUNT {
                self.table_alignments[col_count as usize] = if has_left_colon && has_right_colon {
                    Align::Center
                } else if has_left_colon {
                    Align::Left
                } else if has_right_colon {
                    Align::Right
                } else {
                    Align::Default
                };
            }

            col_count += 1;

            // Skip whitespace
            while pos < self.size && helpers::is_blank(ch(&self.text, pos)) {
                pos += 1;
            }

            // Pipe separator or end
            if pos < self.size && ch(&self.text, pos) == b'|' {
                had_pipe = true;
                pos += 1;
                while pos < self.size && helpers::is_blank(ch(&self.text, pos)) {
                    pos += 1;
                }
                if pos >= self.size || helpers::is_newline(ch(&self.text, pos)) {
                    break;
                }
            } else if pos >= self.size || helpers::is_newline(ch(&self.text, pos)) {
                break;
            } else {
                return TableUnderlineResult { is_underline: false, col_count: 0 };
            }
        }

        if col_count == 0 || (!had_pipe && col_count < 2) {
            return TableUnderlineResult { is_underline: false, col_count: 0 };
        }

        self.table_col_count = col_count;
        TableUnderlineResult { is_underline: true, col_count }
    }

    /// Count the number of pipe-delimited columns in a table row.
    /// Used to validate that header and delimiter row column counts match (GFM requirement).
    pub fn count_table_row_columns(&self, beg: OFF, end: OFF) -> u32 {
        let row = &self.text[beg as usize..end as usize];
        let mut col_count: u32 = 0;
        let mut pos: usize = 0;

        // Skip leading whitespace
        while pos < row.len() && helpers::is_blank(row[pos]) {
            pos += 1;
        }

        // Skip leading pipe
        if pos < row.len() && row[pos] == b'|' {
            pos += 1;
        }

        // Count cells between pipes
        let mut in_cell = false;
        while pos < row.len() {
            if row[pos] == b'|' {
                col_count += 1;
                in_cell = false;
                pos += 1;
            } else if row[pos] == b'\\' && pos + 1 < row.len() {
                in_cell = true;
                pos += 2;
            } else if helpers::is_newline(row[pos]) {
                break;
            } else {
                in_cell = true;
                pos += 1;
            }
        }
        // If there's content after the last pipe (no trailing pipe), count it as a column
        if in_cell {
            col_count += 1;
        }
        col_count
    }

    pub fn is_container_mark(&self, indent: u32, off: OFF) -> ContainerMarkResult {
        if off >= self.size {
            return ContainerMarkResult {
                is_container: false,
                container: Container::default(),
                off,
            };
        }

        // md4c: indent >= code_indent_offset means this is indented code, not a container
        if indent >= self.code_indent_offset {
            return ContainerMarkResult {
                is_container: false,
                container: Container::default(),
                off,
            };
        }

        let c = ch(&self.text, off);

        // Blockquote
        // Note: off points just past '>' — the optional space and remaining
        // indent are handled by the caller via lineIndentation + the
        // whitespace adjustment logic, matching md4c's behavior.
        if c == b'>' {
            return ContainerMarkResult {
                is_container: true,
                container: Container {
                    ch: b'>',
                    mark_indent: indent,
                    contents_indent: indent + 1,
                    ..Container::default()
                },
                off: off + 1,
            };
        }

        // Unordered list: -, +, *
        // off points just past the marker (before the mandatory space).
        // The space is included in the lineIndentation computation by the caller.
        if (c == b'-' || c == b'+' || c == b'*')
            && off + 1 < self.size
            && helpers::is_blank(ch(&self.text, off + 1))
        {
            return ContainerMarkResult {
                is_container: true,
                container: Container {
                    ch: c,
                    mark_indent: indent,
                    contents_indent: indent + 1,
                    ..Container::default()
                },
                off: off + 1,
            };
        }
        // Empty unordered list item: marker followed by newline or EOF
        if (c == b'-' || c == b'+' || c == b'*')
            && (off + 1 >= self.size || helpers::is_newline(ch(&self.text, off + 1)))
        {
            return ContainerMarkResult {
                is_container: true,
                container: Container {
                    ch: c,
                    mark_indent: indent,
                    contents_indent: indent + 1,
                    ..Container::default()
                },
                off: off + 1,
            };
        }

        // Ordered list: digits followed by . or )
        if helpers::is_digit(c) {
            let mut pos = off;
            let mut num: u32 = 0;
            while pos < self.size && helpers::is_digit(ch(&self.text, pos)) && pos - off < 9 {
                num = num * 10 + (ch(&self.text, pos) - b'0') as u32;
                pos += 1;
            }
            if pos < self.size && (ch(&self.text, pos) == b'.' || ch(&self.text, pos) == b')') {
                let delim = ch(&self.text, pos);
                pos += 1; // Past delimiter
                if pos < self.size && helpers::is_blank(ch(&self.text, pos)) {
                    // contents_indent = indent + marker_width (digits + delimiter)
                    let mark_width = pos - off;
                    return ContainerMarkResult {
                        is_container: true,
                        container: Container {
                            ch: delim,
                            start: num,
                            mark_indent: indent,
                            contents_indent: indent + u32::try_from(mark_width).unwrap(),
                            ..Container::default()
                        },
                        off: pos,
                    };
                }
                // Empty list item
                if pos >= self.size || helpers::is_newline(ch(&self.text, pos)) {
                    let mark_width = pos - off;
                    return ContainerMarkResult {
                        is_container: true,
                        container: Container {
                            ch: delim,
                            start: num,
                            mark_indent: indent,
                            contents_indent: indent + u32::try_from(mark_width).unwrap(),
                            ..Container::default()
                        },
                        off: pos,
                    };
                }
            }
        }

        ContainerMarkResult {
            is_container: false,
            container: Container::default(),
            off,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/md/line_analysis.zig (527 lines)
//   confidence: medium
//   todos:      1
//   notes:      Anonymous-struct returns mapped to named result structs; assumes OFF is an integer offset (cast to usize for indexing); Align enum / Container fields assumed from types.zig.
// ──────────────────────────────────────────────────────────────────────────
