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

/// True if `at` lies in a delimiter run of `resolved` (sorted by position) that was paired.
fn is_paired_delimiter(resolved: &[EmphDelim], at: usize) -> bool {
    let idx = resolved.partition_point(|d| d.pos + d.count <= at);
    resolved
        .get(idx)
        .is_some_and(|d| d.pos <= at && d.open_count + d.close_count > 0)
}

#[derive(Copy, Clone)]
pub(crate) struct ScanResult {
    /// Where the accept loop began and ended.
    pub accept_start: usize,
    pub accept_end: usize,
    /// End of the component, behind the optional end character.
    pub end: usize,
    pub ok: bool,
}

/// One row of md4c's URL_MAP.
struct Component {
    start_char: u8,
    delim_char: u8,
    allowed_nonalnum: &'static [u8],
    optional_end_char: u8,
}

const HOST: usize = 0;
const PATH: usize = 1;
const QUERY: usize = 2;
const FRAGMENT: usize = 3;

const COMPONENTS: [Component; 4] = [
    Component {
        start_char: 0,
        delim_char: b'.',
        allowed_nonalnum: b".-_",
        optional_end_char: 0,
    },
    Component {
        start_char: b'/',
        delim_char: b'/',
        allowed_nonalnum: b"/.-_~*+%",
        optional_end_char: b'/',
    },
    Component {
        start_char: b'?',
        delim_char: b'&',
        allowed_nonalnum: b"&.-+_=()~*%",
        optional_end_char: 0,
    },
    Component {
        start_char: b'#',
        delim_char: 0,
        allowed_nonalnum: b".-+_~*%",
        optional_end_char: 0,
    },
];

const NONE: usize = usize::MAX;

/// What the scans of the url and www candidates that failed have read, in positions of the top inline slice.
#[derive(Copy, Clone)]
pub struct AutolinkScanMemo {
    /// False until a candidate fails after a scan.
    armed: bool,
    /// Per component kind: an accept loop that starts in `accept_start..=accept_end` ends at `accept_end`.
    accept_start: [usize; 4],
    accept_end: [usize; 4],
    host_marks: HostMarks,
    /// `content[paren_from..paren_to]` has `paren_open` '(' and `paren_close` ')'.
    paren_from: usize,
    paren_to: usize,
    paren_open: i32,
    paren_close: i32,
}

impl AutolinkScanMemo {
    pub(crate) const EMPTY: AutolinkScanMemo = AutolinkScanMemo {
        armed: false,
        accept_start: [NONE; 4],
        accept_end: [0; 4],
        host_marks: HostMarks::EMPTY,
        paren_from: NONE,
        paren_to: 0,
        paren_open: 0,
        paren_close: 0,
    };

    #[inline]
    pub(crate) fn reset(&mut self) {
        if self.armed {
            *self = AutolinkScanMemo::EMPTY;
        }
    }

    /// Records the accept loops of a candidate that failed.
    #[cold]
    #[inline(never)]
    fn note(&mut self, content: &[u8], base: usize, scans: &[ScanResult]) {
        self.armed = true;
        for (kind, scan) in scans.iter().enumerate() {
            let (start, end) = (base + scan.accept_start, base + scan.accept_end);
            if scan.accept_start == scan.accept_end || self.covers(kind, start) {
                continue;
            }
            self.accept_start[kind] = start;
            self.accept_end[kind] = end;
            if kind == HOST {
                self.host_marks = HostMarks::of(content, base, scan.accept_start, scan.accept_end);
            }
        }
    }

    #[inline]
    fn covers(&self, kind: usize, start: usize) -> bool {
        self.accept_start[kind] <= start && start <= self.accept_end[kind]
    }

    /// Counts of '(' and ')' in `content[from..to]`.
    fn parens(&mut self, content: &[u8], base: usize, from: usize, to: usize) -> (i32, i32) {
        if self.armed && self.paren_from == base + from && self.paren_to == base + to {
            return (self.paren_open, self.paren_close);
        }
        let mut open: i32 = 0;
        let mut close: i32 = 0;
        for &ch in &content[from..to] {
            if ch == b'(' {
                open += 1;
            }
            if ch == b')' {
                close += 1;
            }
        }
        if self.armed {
            self.paren_from = base + from;
            self.paren_to = base + to;
            self.paren_open = open;
            self.paren_close = close;
        }
        (open, close)
    }
}

/// Of a host run: the last '.', the '.' before it, the last alphanumeric before the last '.', the last alphanumeric.
#[derive(Copy, Clone)]
struct HostMarks([usize; 4]);

impl HostMarks {
    const EMPTY: HostMarks = HostMarks([NONE; 4]);

    fn of(content: &[u8], base: usize, from: usize, to: usize) -> HostMarks {
        let mut marks = [NONE; 4];
        for pos in from..to {
            let c = content[pos];
            if c == b'.' {
                marks[1] = marks[0];
                marks[0] = base + pos;
                marks[2] = marks[3];
            } else if helpers::is_alpha_num(c) {
                marks[3] = base + pos;
            }
        }
        HostMarks(marks)
    }

    /// True if the part of the run from `start` on has `min` components.
    fn has(&self, start: usize, min: u32) -> bool {
        let from = |mark: usize| mark != NONE && mark >= start;
        let [last_dot, dot_before, alnum_before_dot, last_alnum] = self.0;
        match min {
            0 => true,
            1 => from(last_dot) || from(last_alnum),
            _ => from(dot_before) || (from(last_dot) && from(alnum_before_dot)),
        }
    }
}

/// The memo of the slice that `content` lies in, and the offset of `content` in that slice.
pub(crate) struct ScanContext<'a> {
    pub memo: &'a mut AutolinkScanMemo,
    pub base: usize,
}

/// True if the byte at `pos` is a non-alphanumeric byte that a component with `allowed_nonalnum` accepts.
#[inline(always)]
fn accepts(content: &[u8], pos: usize, allowed_nonalnum: &[u8]) -> bool {
    is_in_set(content[pos], allowed_nonalnum)
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
}

/// Scan a URL component (host, path, query, or fragment) following md4c's URL_MAP.
fn scan_url_component(
    content: &[u8],
    ctx: Option<&ScanContext>,
    kind: usize,
    start: usize,
    min_components: u32,
) -> ScanResult {
    let component = &COMPONENTS[kind];
    let mut pos = start;
    let mut n_components: u32 = 0;
    // Check start character
    if component.start_char != 0 {
        if pos >= content.len()
            || content[pos] != component.start_char
            || (min_components > 0
                && (pos + 1 >= content.len() || !helpers::is_alpha_num(content[pos + 1])))
        {
            return ScanResult {
                accept_start: pos,
                accept_end: pos,
                end: pos,
                ok: min_components == 0,
            };
        }
        pos += 1;
    }
    let accept_start = pos;

    let known = ctx.filter(|ctx| ctx.memo.armed && ctx.memo.covers(kind, ctx.base + pos));
    if let Some(ctx) = known {
        pos = ctx.memo.accept_end[kind] - ctx.base;
        debug_assert!(pos <= content.len());
        // Behind the start character of a query or a fragment is an alphanumeric.
        let counted = kind != HOST
            || ctx
                .memo
                .host_marks
                .has(ctx.base + accept_start, min_components);
        n_components = if counted { min_components } else { 0 };
    } else {
        while pos < content.len() {
            if helpers::is_alpha_num(content[pos]) {
                if n_components == 0 {
                    n_components = 1;
                }
                pos += 1;
            } else if accepts(content, pos, component.allowed_nonalnum) {
                if content[pos] == component.delim_char {
                    n_components += 1;
                }
                pos += 1;
            } else {
                break;
            }
        }
    }
    let accept_end = pos;

    if pos < content.len()
        && component.optional_end_char != 0
        && content[pos] == component.optional_end_char
    {
        pos += 1;
    }

    ScanResult {
        accept_start,
        accept_end,
        end: pos,
        ok: n_components >= min_components,
    }
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
/// An emphasis delimiter (*_~) is a boundary if its run in `resolved` was paired.
fn check_left_boundary(content: &[u8], pos: usize, resolved: &[EmphDelim]) -> bool {
    if pos == 0 {
        return true;
    }
    let c = content[pos - 1];
    LEFT_BOUNDARY.contains(c) || (EMPH_DELIMS.contains(c) && is_paired_delimiter(resolved, pos - 1))
}

/// Check right boundary for permissive autolinks.
/// An emphasis delimiter (*_~) is a boundary if its run in `resolved` was paired.
fn check_right_boundary(content: &[u8], pos: usize, resolved: &[EmphDelim]) -> bool {
    if pos >= content.len() {
        return true;
    }
    let c = content[pos];
    RIGHT_BOUNDARY.contains(c) || (EMPH_DELIMS.contains(c) && is_paired_delimiter(resolved, pos))
}

struct Scheme {
    name: &'static [u8],
    suffix: &'static [u8],
}

/// Detect a permissive URL autolink. `pos` is the position of the ':' after the scheme.
pub(crate) fn find_url_autolink(
    content: &[u8],
    pos: usize,
    resolved: &[EmphDelim],
    ctx: &mut ScanContext,
) -> AutolinkResult {
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
                if !check_left_boundary(content, beg, resolved) {
                    continue;
                }
                let host_start = pos + 1 + suflen;
                if let Some(al) = scan_url_tail(content, beg, host_start, 2, resolved, ctx) {
                    return Some(al);
                }
            }
        }
    }
    None
}

/// Detect a permissive email autolink. `pos` is the position of the '@'.
pub(crate) fn find_email_autolink(
    content: &[u8],
    pos: usize,
    resolved: &[EmphDelim],
) -> AutolinkResult {
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

    if !check_left_boundary(content, beg, resolved) {
        return None;
    }

    // Scan forward for domain (host component only for email)
    let host = scan_url_component(content, None, HOST, pos + 1, 2);
    if !host.ok {
        return None;
    }
    let end = host.end;

    if !check_right_boundary(content, end, resolved) {
        return None;
    }

    Some(Autolink { beg, end })
}

/// Detect a permissive WWW autolink. `pos` is the position of the '.' after "www".
pub(crate) fn find_www_autolink(
    content: &[u8],
    pos: usize,
    resolved: &[EmphDelim],
    ctx: &mut ScanContext,
) -> AutolinkResult {
    if pos < 3 {
        return None;
    }
    if !helpers::ascii_case_eql(&content[pos - 3..pos], b"www") {
        return None;
    }

    let beg = pos - 3;
    if !check_left_boundary(content, beg, resolved) {
        return None;
    }
    scan_url_tail(content, beg, pos + 1, 1, resolved, ctx)
}

/// Scan the host (mandatory), path, query and fragment of a link that starts at `beg`.
fn scan_url_tail(
    content: &[u8],
    beg: usize,
    host_start: usize,
    min_host_components: u32,
    resolved: &[EmphDelim],
    ctx: &mut ScanContext,
) -> AutolinkResult {
    let host = scan_url_component(content, Some(ctx), HOST, host_start, min_host_components);
    if !host.ok {
        ctx.memo.note(content, ctx.base, &[host]);
        return None;
    }
    let path = scan_url_component(content, Some(ctx), PATH, host.end, 0);
    let query = scan_url_component(content, Some(ctx), QUERY, path.end, 1);
    let frag = scan_url_component(content, Some(ctx), FRAGMENT, query.end, 1);

    let end = post_process_autolink_end(content, beg, path.end, frag.end, ctx);
    if !check_right_boundary(content, end, resolved) {
        ctx.memo.note(content, ctx.base, &[host, path, query, frag]);
        return None;
    }
    Some(Autolink { beg, end })
}

/// GFM post-processing: trim trailing unbalanced `)` and entity-like suffixes from autolink URLs.
/// A '(' or a ')' of the link lies at or behind `query_start`.
fn post_process_autolink_end(
    content: &[u8],
    beg: usize,
    query_start: usize,
    end_in: usize,
    ctx: &mut ScanContext,
) -> usize {
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
    if query_start >= end {
        return end;
    }
    let (open, mut close) = ctx.memo.parens(content, ctx.base, query_start, end);
    while end > beg && content[end - 1] == b')' && close > open {
        end -= 1;
        close -= 1;
    }

    end
}
