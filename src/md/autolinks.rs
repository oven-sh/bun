use crate::helpers;
use crate::parser::EmphDelim; // TODO(port): Zig path is `Parser.EmphDelim`; verify Rust module layout in Phase B

pub fn is_list_bullet(c: u8) -> bool {
    c == b'-' || c == b'+' || c == b'*'
}

pub fn is_list_item_mark(c: u8) -> bool {
    c == b'-' || c == b'+' || c == b'*' || c == b'.' || c == b')'
}

#[derive(Copy, Clone)]
pub struct Autolink {
    pub beg: usize,
    pub end: usize,
}

pub type AutolinkResult = Option<Autolink>;

/// Check that emphasis chars at autolink boundaries are actually resolved delimiters.
/// Called when the relaxed (allow_emph) pass found an autolink but the strict pass didn't.
pub fn is_emph_boundary_resolved(content: &[u8], al: Autolink, resolved: &[EmphDelim]) -> bool {
    // Check left boundary: if it's an emphasis char, it must be a resolved delimiter
    if al.beg > 0 {
        let prev = content[al.beg - 1];
        if prev == b'*' || prev == b'_' || prev == b'~' {
            if !check_left_boundary(content, al.beg, false) {
                // Left boundary failed strict check, emphasis char caused the relaxed match.
                // Verify it's actually resolved.
                let mut found_resolved = false;
                for d in resolved {
                    if d.pos <= al.beg - 1
                        && al.beg - 1 < d.pos + d.count
                        && (d.open_count + d.close_count > 0)
                    {
                        found_resolved = true;
                        break;
                    }
                }
                if !found_resolved {
                    return false;
                }
            }
        }
    }
    // Check right boundary: if it's an emphasis char, it must be a resolved delimiter
    if al.end < content.len() {
        let next = content[al.end];
        if next == b'*' || next == b'_' || next == b'~' {
            if !check_right_boundary(content, al.end, false) {
                let mut found_resolved = false;
                for d in resolved {
                    if d.pos <= al.end
                        && al.end < d.pos + d.count
                        && (d.open_count + d.close_count > 0)
                    {
                        found_resolved = true;
                        break;
                    }
                }
                if !found_resolved {
                    return false;
                }
            }
        }
    }
    true
}

#[derive(Copy, Clone)]
pub struct ScanResult {
    pub end: usize,
    pub ok: bool,
}

/// Scan a URL component (host, path, query, or fragment) following md4c's URL_MAP.
pub fn scan_url_component(
    content: &[u8],
    start: usize,
    start_char: u8,
    delim_char: u8,
    allowed_nonalnum: &[u8],
    min_components: u32,
    optional_end_char: u8,
) -> ScanResult {
    let mut pos = start;
    let mut n_components: u32 = 0;
    // Check start character
    if start_char != 0 {
        if pos >= content.len() || content[pos] != start_char {
            return ScanResult { end: pos, ok: min_components == 0 };
        }
        if min_components > 0 && (pos + 1 >= content.len() || !helpers::is_alpha_num(content[pos + 1])) {
            return ScanResult { end: pos, ok: min_components == 0 };
        }
        pos += 1;
    }

    while pos < content.len() {
        if helpers::is_alpha_num(content[pos]) {
            if n_components == 0 {
                n_components = 1;
            }
            pos += 1;
        } else if is_in_set(content[pos], allowed_nonalnum)
            && ((pos > 0
                && (helpers::is_alpha_num(content[pos - 1])
                    || content[pos - 1] == b')'
                    || is_in_set(content[pos - 1], allowed_nonalnum)))
                || content[pos] == b'(')
            && ((pos + 1 < content.len()
                && (helpers::is_alpha_num(content[pos + 1])
                    || content[pos + 1] == b'('
                    || is_in_set(content[pos + 1], allowed_nonalnum)))
                || content[pos] == b')')
        {
            if content[pos] == delim_char {
                n_components += 1;
            }
            pos += 1;
        } else {
            break;
        }
    }

    if pos < content.len() && optional_end_char != 0 && content[pos] == optional_end_char {
        pos += 1;
    }

    if n_components < min_components {
        return ScanResult { end: pos, ok: false };
    }

    ScanResult { end: pos, ok: true }
}

pub fn is_in_set(c: u8, set: &[u8]) -> bool {
    for &s in set {
        if c == s {
            return true;
        }
    }
    false
}

/// Check left boundary for permissive autolinks.
/// When `allow_emph` is true, emphasis delimiters (*_~) are also valid boundaries.
pub fn check_left_boundary(content: &[u8], pos: usize, allow_emph: bool) -> bool {
    if pos == 0 {
        return true;
    }
    match content[pos - 1] {
        b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C => true,
        b'(' | b'{' | b'[' => true,
        b'*' | b'_' | b'~' => allow_emph,
        _ => false,
    }
}

/// Check right boundary for permissive autolinks.
/// When `allow_emph` is true, emphasis delimiters (*_~) are also valid boundaries.
pub fn check_right_boundary(content: &[u8], pos: usize, allow_emph: bool) -> bool {
    if pos >= content.len() {
        return true;
    }
    match content[pos] {
        b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C => true,
        b')' | b'}' | b']' | b'<' => true,
        b'.' | b'!' | b'?' | b',' | b';' | b'&' => true,
        b'*' | b'_' | b'~' => allow_emph,
        _ => false,
    }
}

struct Scheme {
    name: &'static [u8],
    suffix: &'static [u8],
}

/// Detect permissive autolinks at the given position in content.
/// `pos` is the position of the trigger character ('@', ':', or '.').
pub fn find_permissive_autolink(content: &[u8], pos: usize, allow_emph: bool) -> AutolinkResult {
    if pos >= content.len() {
        return None;
    }
    let c = content[pos];

    if c == b':' {
        // URL autolink: check for http://, https://, ftp://
        const SCHEMES: [Scheme; 3] = [
            Scheme { name: b"http", suffix: b"//" },
            Scheme { name: b"https", suffix: b"//" },
            Scheme { name: b"ftp", suffix: b"//" },
        ];

        for scheme in &SCHEMES {
            let slen = scheme.name.len();
            let suflen = scheme.suffix.len();
            if pos >= slen && pos + 1 + suflen < content.len() {
                if helpers::ascii_case_eql(&content[pos - slen..pos], scheme.name)
                    && &content[pos + 1..pos + 1 + suflen] == scheme.suffix
                {
                    let beg = pos - slen;
                    if !check_left_boundary(content, beg, allow_emph) {
                        continue;
                    }

                    let mut end = pos + 1 + suflen;
                    // Scan URL components: host (mandatory), path, query, fragment
                    let host = scan_url_component(content, end, 0, b'.', b".-_", 2, 0);
                    if !host.ok {
                        continue;
                    }
                    end = host.end;

                    let path = scan_url_component(content, end, b'/', b'/', b"/.-_~*+%", 0, b'/');
                    end = path.end;

                    let query = scan_url_component(content, end, b'?', b'&', b"&.-+_=()~*%", 1, 0);
                    end = query.end;

                    let frag = scan_url_component(content, end, b'#', 0, b".-+_~*%", 1, 0);
                    end = frag.end;

                    end = post_process_autolink_end(content, beg, end);

                    if !check_right_boundary(content, end, allow_emph) {
                        continue;
                    }

                    return Some(Autolink { beg, end });
                }
            }
        }
    } else if c == b'@' {
        // Email autolink: scan backward for username, forward for domain
        if pos == 0 || pos + 3 >= content.len() {
            return None;
        }
        if !helpers::is_alpha_num(content[pos - 1]) || !helpers::is_alpha_num(content[pos + 1]) {
            return None;
        }

        // Scan backward for username
        let mut beg = pos;
        while beg > 0 {
            if helpers::is_alpha_num(content[beg - 1]) {
                beg -= 1;
            } else if beg >= 2
                && helpers::is_alpha_num(content[beg - 2])
                && is_in_set(content[beg - 1], b".-_+")
                && helpers::is_alpha_num(content[beg])
            {
                beg -= 1;
            } else {
                break;
            }
        }
        if beg == pos {
            return None; // empty username
        }

        if !check_left_boundary(content, beg, allow_emph) {
            return None;
        }

        // Scan forward for domain (host component only for email)
        let host = scan_url_component(content, pos + 1, 0, b'.', b".-_", 2, 0);
        if !host.ok {
            return None;
        }
        let end = host.end;

        if !check_right_boundary(content, end, allow_emph) {
            return None;
        }

        return Some(Autolink { beg, end });
    } else if c == b'.' {
        // WWW autolink: check for "www." prefix
        if pos < 3 {
            return None;
        }
        if !helpers::ascii_case_eql(&content[pos - 3..pos], b"www") {
            return None;
        }

        let beg = pos - 3;
        if !check_left_boundary(content, beg, allow_emph) {
            return None;
        }

        // Scan URL components starting from after the '.'
        let mut end = pos + 1;
        let host = scan_url_component(content, end, 0, b'.', b".-_", 1, 0);
        if !host.ok {
            return None;
        }
        end = host.end;

        let path = scan_url_component(content, end, b'/', b'/', b"/.-_~*+%", 0, b'/');
        end = path.end;

        let query = scan_url_component(content, end, b'?', b'&', b"&.-+_=()~*%", 1, 0);
        end = query.end;

        let frag = scan_url_component(content, end, b'#', 0, b".-+_~*%", 1, 0);
        end = frag.end;

        end = post_process_autolink_end(content, beg, end);

        if !check_right_boundary(content, end, allow_emph) {
            return None;
        }

        return Some(Autolink { beg, end });
    }

    None
}

/// GFM post-processing: trim trailing unbalanced `)` and entity-like suffixes from autolink URLs.
fn post_process_autolink_end(content: &[u8], beg: usize, end_in: usize) -> usize {
    let mut end = end_in;

    // Trim trailing entity-like suffixes.
    // GFM spec: "If an autolink ends in a semicolon (;), we check to see if it
    // appears to resemble an entity reference; if the preceding text is &
    // followed by one or more alphanumeric characters."
    // Case 1: URL itself ends with `;` (e.g., `&hl;` was fully scanned)
    if end > beg && content[end - 1] == b';' {
        let mut j = end - 2;
        while j > beg && helpers::is_alpha_num(content[j]) {
            j -= 1;
        }
        if j >= beg && content[j] == b'&' {
            end = j;
        }
    }
    // Case 2: `;` is the next char after URL end (scanner stopped before `;`)
    // e.g., URL = `commonmark&hl`, next char is `;` → trim `&hl`
    if end < content.len() && content[end] == b';' && end > beg {
        let mut j = end - 1;
        while j > beg && helpers::is_alpha_num(content[j]) {
            j -= 1;
        }
        if j >= beg && content[j] == b'&' {
            end = j;
        }
    }

    // Trim trailing unbalanced `)`: count all ( and ) in the URL.
    // If closing > opening, remove trailing ) until balanced.
    while end > beg && content[end - 1] == b')' {
        let mut open: i32 = 0;
        let mut close: i32 = 0;
        for &ch in &content[beg..end] {
            if ch == b'(' {
                open += 1;
            }
            if ch == b')' {
                close += 1;
            }
        }
        if close > open {
            end -= 1;
        } else {
            break;
        }
    }

    end
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/md/autolinks.zig (300 lines)
//   confidence: high
//   todos:      1
//   notes:      EmphDelim import path assumes crate::parser::EmphDelim; verify field types (pos/count/open_count/close_count) are usize-compatible in Phase B.
// ──────────────────────────────────────────────────────────────────────────
