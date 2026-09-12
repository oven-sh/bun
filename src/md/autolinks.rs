use crate::helpers;
use crate::inlines::EmphDelim;

pub(crate) fn is_list_bullet(c: u8) -> bool {
    c == b'-' || c == b'+' || c == b'*'
}

pub(crate) fn is_list_item_mark(c: u8) -> bool {
    c == b'-' || c == b'+' || c == b'*' || c == b'.' || c == b')'
}

#[derive(Copy, Clone)]
pub struct Autolink {
    pub(crate) beg: usize,
    pub(crate) end: usize,
}

pub(crate) type AutolinkResult = Option<Autolink>;

/// True if the emphasis char at `at` lies in a delimiter run that was paired as
/// an opener or closer. `resolved` is sorted by position.
fn is_paired_delimiter(resolved: &[EmphDelim], at: usize) -> bool {
    let idx = resolved.partition_point(|d| d.pos + d.count <= at);
    resolved
        .get(idx)
        .is_some_and(|d| d.pos <= at && d.open_count + d.close_count > 0)
}

#[derive(Copy, Clone)]
pub(crate) struct ScanResult {
    pub end: usize,
    pub ok: bool,
}

/// Scan a URL component (host, path, query, or fragment) following md4c's URL_MAP.
/// The component ends at `limit` at the latest. Bytes at and after `limit`
/// still count as the neighbors of the bytes before it.
fn scan_url_component(
    content: &[u8],
    limit: usize,
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
        if pos >= limit || content[pos] != start_char {
            return ScanResult {
                end: pos,
                ok: min_components == 0,
            };
        }
        if min_components > 0
            && (pos + 1 >= content.len() || !helpers::is_alpha_num(content[pos + 1]))
        {
            return ScanResult {
                end: pos,
                ok: min_components == 0,
            };
        }
        pos += 1;
    }

    while pos < limit {
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

    if pos < limit && optional_end_char != 0 && content[pos] == optional_end_char {
        pos += 1;
    }

    if n_components < min_components {
        return ScanResult {
            end: pos,
            ok: false,
        };
    }

    ScanResult { end: pos, ok: true }
}

fn is_in_set(c: u8, set: &[u8]) -> bool {
    for &s in set {
        if c == s {
            return true;
        }
    }
    false
}

/// 256-bit membership set over bytes; keeps the boundary checks below to a
/// couple of loads instead of per-call-site `match` jump tables.
struct ByteSet([u64; 4]);

impl ByteSet {
    const fn of(bytes: &[u8]) -> ByteSet {
        let mut words = [0u64; 4];
        let mut i = 0;
        while i < bytes.len() {
            words[(bytes[i] >> 6) as usize] |= 1 << (bytes[i] & 63);
            i += 1;
        }
        ByteSet(words)
    }

    #[inline]
    fn contains(&self, c: u8) -> bool {
        self.0[(c >> 6) as usize] & (1 << (c & 63)) != 0
    }
}

const EMPH_DELIMS: ByteSet = ByteSet::of(b"*_~");
const LEFT_BOUNDARY: ByteSet = ByteSet::of(b" \t\n\r\x0B\x0C({[");
const RIGHT_BOUNDARY: ByteSet = ByteSet::of(b" \t\n\r\x0B\x0C)}]<.!?,;&");

/// Check left boundary for permissive autolinks.
/// With `emph`, an emphasis delimiter (*_~) is a boundary too if its run in
/// `emph` (the delimiter runs of `content`) was paired.
fn check_left_boundary(content: &[u8], pos: usize, emph: Option<&[EmphDelim]>) -> bool {
    if pos == 0 {
        return true;
    }
    let c = content[pos - 1];
    LEFT_BOUNDARY.contains(c)
        || (EMPH_DELIMS.contains(c) && emph.is_some_and(|runs| is_paired_delimiter(runs, pos - 1)))
}

/// Check right boundary for permissive autolinks.
/// With `emph`, an emphasis delimiter (*_~) is a boundary too if its run in
/// `emph` (the delimiter runs of `content`) was paired.
fn check_right_boundary(content: &[u8], pos: usize, emph: Option<&[EmphDelim]>) -> bool {
    if pos >= content.len() {
        return true;
    }
    let c = content[pos];
    RIGHT_BOUNDARY.contains(c)
        || (EMPH_DELIMS.contains(c) && emph.is_some_and(|runs| is_paired_delimiter(runs, pos)))
}

struct Scheme {
    name: &'static [u8],
    suffix: &'static [u8],
}

/// Detect permissive autolinks at the given position in content.
/// `pos` is the position of the trigger character ('@', ':', or '.').
/// With `allow_emph`, an emphasis char is a boundary too if its run in
/// `resolved` (the delimiter runs of `content`, sorted by position) was paired.
///
/// The inline walk jumps over a link and emits emphasis tags only for the
/// delimiter runs it lands on, so a link that covers one run of a pair and not
/// the other leaves a tag unmatched. Such a candidate is cut: it ends before
/// the first run it may not cover, and `cut_end` receives its uncut end. The
/// walk starts no autolink before `cut_end`, so no byte is scanned twice.
pub(crate) fn find_permissive_autolink(
    content: &[u8],
    pos: usize,
    allow_emph: bool,
    resolved: &[EmphDelim],
    cut_end: &mut usize,
) -> AutolinkResult {
    let emph = allow_emph.then_some(resolved);
    let al = scan_permissive_autolink(content, pos, emph, content.len())?;
    // No paired run lies between the start of a link and its trigger
    // character, so only the runs after `pos` matter.
    let runs = &resolved[resolved.partition_point(|d| d.pos < pos)..];
    let Some(limit) = split_pair_limit(runs, al.end) else {
        return Some(al);
    };
    *cut_end = al.end;
    let al = scan_permissive_autolink(content, pos, emph, limit)?;
    debug_assert!(split_pair_limit(runs, al.end).is_none());
    Some(al)
}

/// A permissive autolink whose boundaries do not depend on how the emphasis
/// delimiters around it resolve.
pub(crate) fn find_strict_permissive_autolink(content: &[u8], pos: usize) -> AutolinkResult {
    scan_permissive_autolink(content, pos, None, content.len())
}

/// Returns where a link that covers the `runs` before `end` has to stop so
/// that it covers whole emphasis pairs only, or `None` if it already does.
fn split_pair_limit(runs: &[EmphDelim], end: usize) -> Option<usize> {
    // Delimiter chars opened inside the link and not closed yet.
    let mut depth: usize = 0;
    // The last run that `depth` was zero in front of.
    let mut zero_at: usize = 0;
    for d in runs {
        if d.pos >= end {
            break;
        }
        if depth == 0 {
            zero_at = d.pos;
        }
        if d.close_count > depth {
            // Closes a span opened before the link.
            return Some(zero_at);
        }
        depth = depth - d.close_count + d.open_count;
    }
    (depth > 0).then_some(zero_at)
}

fn scan_permissive_autolink(
    content: &[u8],
    pos: usize,
    emph: Option<&[EmphDelim]>,
    limit: usize,
) -> AutolinkResult {
    if pos >= content.len() {
        return None;
    }
    let c = content[pos];

    if c == b':' {
        // URL autolink: check for http://, https://, ftp://
        const SCHEMES: [Scheme; 3] = [
            Scheme {
                name: b"http",
                suffix: b"//",
            },
            Scheme {
                name: b"https",
                suffix: b"//",
            },
            Scheme {
                name: b"ftp",
                suffix: b"//",
            },
        ];

        for scheme in &SCHEMES {
            let slen = scheme.name.len();
            let suflen = scheme.suffix.len();
            if pos >= slen && pos + 1 + suflen < content.len() {
                if helpers::ascii_case_eql(&content[pos - slen..pos], scheme.name)
                    && &content[pos + 1..pos + 1 + suflen] == scheme.suffix
                {
                    let beg = pos - slen;
                    if !check_left_boundary(content, beg, emph) {
                        continue;
                    }

                    let mut end = pos + 1 + suflen;
                    // Scan URL components: host (mandatory), path, query, fragment
                    let host = scan_url_component(content, limit, end, 0, b'.', b".-_", 2, 0);
                    if !host.ok {
                        continue;
                    }
                    end = host.end;

                    let path =
                        scan_url_component(content, limit, end, b'/', b'/', b"/.-_~*+%", 0, b'/');
                    end = path.end;

                    let query =
                        scan_url_component(content, limit, end, b'?', b'&', b"&.-+_=()~*%", 1, 0);
                    end = query.end;

                    let frag = scan_url_component(content, limit, end, b'#', 0, b".-+_~*%", 1, 0);
                    end = frag.end;

                    end = post_process_autolink_end(content, beg, end);

                    if !check_right_boundary(content, end, emph) {
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
            if helpers::is_alpha_num(content[beg - 1])
                || (beg >= 2
                    && helpers::is_alpha_num(content[beg - 2])
                    && is_in_set(content[beg - 1], b".-_+")
                    && helpers::is_alpha_num(content[beg]))
            {
                beg -= 1;
            } else {
                break;
            }
        }
        if beg == pos {
            return None; // empty username
        }

        if !check_left_boundary(content, beg, emph) {
            return None;
        }

        // Scan forward for domain (host component only for email)
        let host = scan_url_component(content, limit, pos + 1, 0, b'.', b".-_", 2, 0);
        if !host.ok {
            return None;
        }
        let end = host.end;

        if !check_right_boundary(content, end, emph) {
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
        if !check_left_boundary(content, beg, emph) {
            return None;
        }

        // Scan URL components starting from after the '.'
        let mut end = pos + 1;
        let host = scan_url_component(content, limit, end, 0, b'.', b".-_", 1, 0);
        if !host.ok {
            return None;
        }
        end = host.end;

        let path = scan_url_component(content, limit, end, b'/', b'/', b"/.-_~*+%", 0, b'/');
        end = path.end;

        let query = scan_url_component(content, limit, end, b'?', b'&', b"&.-+_=()~*%", 1, 0);
        end = query.end;

        let frag = scan_url_component(content, limit, end, b'#', 0, b".-+_~*%", 1, 0);
        end = frag.end;

        end = post_process_autolink_end(content, beg, end);

        if !check_right_boundary(content, end, emph) {
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
    while end > beg && content[end - 1] == b')' && close > open {
        end -= 1;
        close -= 1;
    }

    end
}
