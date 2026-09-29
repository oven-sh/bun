use crate::helpers;
use crate::inlines::{EmphDelim, MAX_EMPH_MATCHES};
use bun_core::strings;

pub(crate) fn is_list_bullet(c: u8) -> bool {
    c == b'-' || c == b'+' || c == b'*'
}

pub(crate) fn is_list_item_mark(c: u8) -> bool {
    c == b'-' || c == b'+' || c == b'*' || c == b'.' || c == b')'
}

#[derive(Copy, Clone)]
pub struct Autolink {
    /// Position of the trigger character ('@', ':', or '.').
    pub(crate) trigger: usize,
    pub(crate) beg: usize,
    pub(crate) end: usize,
    /// The first and the last delimiter of a tail, one of which has to be paired for this to be a link, or `NONE`.
    first_run: usize,
    scan_end: usize,
}

impl Autolink {
    fn certain(trigger: usize, beg: usize, end: usize) -> Autolink {
        Autolink {
            trigger,
            beg,
            end,
            first_run: NONE,
            scan_end: NONE,
        }
    }

    /// True if emphasis resolution cannot take this link back.
    pub(crate) fn is_certain(&self) -> bool {
        self.first_run == NONE
    }

    /// This link with the runs that emphasis paired, if no pair has only one of its runs in the link.
    pub(crate) fn resolved_with(&self, resolved: &[EmphDelim]) -> Option<Autolink> {
        if self.is_certain() {
            return Some(*self);
        }
        let mut open_pairs: usize = 0;
        let mut from = resolved.partition_point(|d| d.pos < self.beg);
        for _ in 0..MAX_PAIRED_RUNS_IN_LINK {
            let at = resolved.get(from)?.next_paired as usize;
            let run = resolved.get(at)?;
            if run.pos >= self.first_run {
                // The link ends in front of the first paired run of its tail.
                let mut link = *self;
                if run.pos > self.first_run {
                    link.end = run.pos;
                }
                return (run.pos <= self.scan_end && open_pairs == 0).then_some(link);
            }
            let (opens, closes) = (usize::from(run.open_num), usize::from(run.close_num));
            if opens.max(closes) >= MAX_EMPH_MATCHES {
                return None;
            }
            open_pairs = open_pairs.checked_sub(closes)? + opens;
            from = at + 1;
        }
        None
    }
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

/// A link that emphasis resolution decides about is no link if it has more paired runs than this in it.
const MAX_PAIRED_RUNS_IN_LINK: usize = 32;

/// What the scans of the url and www candidates that failed have read, in positions of the top inline slice.
#[derive(Copy, Clone)]
pub struct AutolinkScanMemo {
    /// False until a candidate fails after a scan.
    armed: bool,
    /// Per component kind: an accept loop that starts in `accept_start..=accept_end` ends at `accept_end`.
    accept_start: [usize; 4],
    accept_end: [usize; 4],
    host_marks: HostMarks,
    /// Marks of the host run up to `host_cut`.
    host_cut_marks: HostMarks,
    host_cut: usize,
    /// Per kind of the component that a scan ends in. Two scans that end in the same kind end at the same byte or do not overlap.
    tails: [TailMemo; 4],
    /// What `stripped_end` found for the run at `strip_run` and a query that starts at `strip_query`.
    strip_run: usize,
    strip_query: usize,
    strip_end: usize,
    /// `parens` is the count for `content[paren_from..paren_to]`.
    paren_from: usize,
    paren_to: usize,
    parens: ParenCount,
}

impl AutolinkScanMemo {
    pub(crate) const EMPTY: AutolinkScanMemo = AutolinkScanMemo {
        armed: false,
        accept_start: [NONE; 4],
        accept_end: [0; 4],
        host_marks: HostMarks::EMPTY,
        host_cut_marks: HostMarks::EMPTY,
        host_cut: NONE,
        tails: [TailMemo::EMPTY; 4],
        strip_run: NONE,
        strip_query: NONE,
        strip_end: 0,
        paren_from: NONE,
        paren_to: 0,
        parens: ParenCount { open: 0, close: 0 },
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
                self.host_cut = NONE;
            }
        }
    }

    #[inline]
    fn covers(&self, kind: usize, start: usize) -> bool {
        self.accept_start[kind] <= start && start <= self.accept_end[kind]
    }

    /// Counts of '(' and ')' in `content[from..to]`.
    fn parens(&mut self, content: &[u8], base: usize, from: usize, to: usize) -> ParenCount {
        if self.armed && self.paren_from == base + from && self.paren_to == base + to {
            return self.parens;
        }
        let parens = ParenCount {
            open: strings::count_char(&content[from..to], b'('),
            close: strings::count_char(&content[from..to], b')'),
        };
        if self.armed {
            self.paren_from = base + from;
            self.paren_to = base + to;
            self.parens = parens;
        }
        parens
    }

    /// True if the recorded host run has `min` components from `start` to `cut`.
    fn host_has_to(
        &mut self,
        content: &[u8],
        base: usize,
        start: usize,
        cut: usize,
        min: u32,
    ) -> bool {
        if self.host_cut != cut {
            debug_assert!(base <= self.accept_start[HOST] && self.accept_start[HOST] <= cut);
            let from = self.accept_start[HOST] - base;
            self.host_cut_marks = HostMarks::of(content, base, from, cut - base);
            self.host_cut = cut;
        }
        self.host_cut_marks.has(start, min)
    }

    /// The first delimiter of the delimiters and periods in front of `end`, or the delimiter at `end`.
    fn delimiter_in_tail(
        &mut self,
        content: &[u8],
        base: usize,
        scan: TailScan,
    ) -> Option<TailRun> {
        let TailScan { kind, from, end } = scan;
        let limit = base + content.len();
        let memo = self.tails[kind];
        let known = self.armed
            && memo.end == base + end
            && memo.limit == limit
            && memo.start >= base + from;
        if known {
            return memo.tail.map(|tail| tail.relative_to(base));
        }
        let mut run = NONE;
        if end < content.len() && EMPH_DELIMS.contains(content[end]) {
            run = end;
        }
        let mut pos = end;
        while pos > from && (EMPH_DELIMS.contains(content[pos - 1]) || content[pos - 1] == b'.') {
            pos -= 1;
            if content[pos] != b'.' {
                run = pos;
            }
        }
        let tail = (run != NONE).then(|| TailRun {
            start: pos,
            run,
            token_ends: token_ends_with_punctuation(content, end),
        });
        if self.armed && pos != from {
            self.tails[kind] = TailMemo {
                limit,
                end: base + end,
                start: base + pos,
                tail: tail.map(|tail| TailRun {
                    start: base + tail.start,
                    run: base + tail.run,
                    token_ends: tail.token_ends,
                }),
            };
        }
        tail
    }

    /// The end of a link in front of `tail.run`, as in GFM without the periods and the unbalanced ')' there.
    fn stripped_end(
        &mut self,
        content: &[u8],
        base: usize,
        host_start: usize,
        query_start: usize,
        tail: TailRun,
    ) -> usize {
        // The tail has only periods in front of its first delimiter.
        let mut end = tail.start;
        if end <= query_start || content[end - 1] != b')' {
            return end;
        }
        let (run, query) = (base + tail.run, base + query_start);
        if self.armed && self.strip_run == run && self.strip_query == query {
            return self.strip_end - base;
        }
        let mut parens = self.parens(content, base, query_start, tail.run);
        while end > host_start {
            match content[end - 1] {
                b'.' => {}
                b')' if parens.close > parens.open => parens.close -= 1,
                _ => break,
            }
            end -= 1;
        }
        if self.armed {
            self.strip_run = run;
            self.strip_query = query;
            self.strip_end = base + end;
        }
        end
    }
}

/// The delimiters and periods at the end of a scan.
#[derive(Copy, Clone)]
struct TailRun {
    start: usize,
    /// The first delimiter.
    run: usize,
    /// True if the token has only punctuation from the end of the scan on.
    token_ends: bool,
}

impl TailRun {
    fn relative_to(self, base: usize) -> TailRun {
        TailRun {
            start: self.start - base,
            run: self.run - base,
            token_ends: self.token_ends,
        }
    }
}

/// A scan that ends at `end` in a component of `kind`, with its host at `from`.
#[derive(Copy, Clone)]
struct TailScan {
    kind: usize,
    from: usize,
    end: usize,
}

/// What `delimiter_in_tail` found for the scan end `end` in the slice that ends at `limit`.
#[derive(Copy, Clone)]
struct TailMemo {
    limit: usize,
    end: usize,
    start: usize,
    tail: Option<TailRun>,
}

impl TailMemo {
    const EMPTY: TailMemo = TailMemo {
        limit: NONE,
        end: NONE,
        start: NONE,
        tail: None,
    };
}

#[derive(Copy, Clone)]
struct ParenCount {
    open: usize,
    close: usize,
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

    /// True if the part of the run from `start` on has `min` components. A host needs one or two.
    fn has(&self, start: usize, min: u32) -> bool {
        let from = |mark: usize| mark != NONE && mark >= start;
        let [last_dot, dot_before, alnum_before_dot, last_alnum] = self.0;
        if min == 1 {
            from(last_dot) || from(last_alnum)
        } else {
            from(dot_before) || (from(last_dot) && from(alnum_before_dot))
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

/// When an emphasis delimiter (*_~) next to a link is a boundary.
#[derive(Copy, Clone)]
enum DelimiterBoundary<'a> {
    /// In front of a URL or WWW link, which is found before emphasis is paired.
    Always,
    /// Behind a URL or WWW link: `delimiter_in_tail` finds the run that ends the link.
    Never,
    /// Next to an email address, if its run was paired.
    IfPaired(&'a [EmphDelim]),
}

impl DelimiterBoundary<'_> {
    fn is_boundary(self, at: usize) -> bool {
        match self {
            DelimiterBoundary::Always => true,
            DelimiterBoundary::Never => false,
            DelimiterBoundary::IfPaired(resolved) => is_paired_delimiter(resolved, at),
        }
    }
}

/// What can follow a link in its token: the trailing punctuation of GFM, quotes and closing brackets.
const TRAILING_PUNCTUATION: ByteSet = ByteSet::of(b"*_~.,:;!?'\")]}");
/// A token ends at whitespace, at '<' and at a backslash.
const TOKEN_END: ByteSet = ByteSet::of(b" \t\n\r\x0B\x0C<\\");

/// True if the token has only punctuation and entities from `pos` on.
fn token_ends_with_punctuation(content: &[u8], pos: usize) -> bool {
    let mut pos = pos;
    while pos < content.len() {
        let entity = if content[pos] == b'&' {
            helpers::find_entity(content, pos)
        } else {
            None
        };
        match entity {
            Some(end) => pos = end,
            None if TRAILING_PUNCTUATION.contains(content[pos]) => pos += 1,
            None => break,
        }
    }
    let Some(&c) = content.get(pos) else {
        return true;
    };
    if c.is_ascii() {
        return TOKEN_END.contains(c);
    }
    // A '_' in front of a letter is a part of the word, as it is between ASCII letters.
    let in_word = pos > 0 && content[pos - 1] == b'_';
    let next = helpers::decode_utf8(content, pos).codepoint;
    !in_word || helpers::is_unicode_whitespace(next) || helpers::is_unicode_punctuation(next)
}

/// Check left boundary for permissive autolinks.
fn check_left_boundary(content: &[u8], pos: usize, delims: DelimiterBoundary) -> bool {
    if pos == 0 {
        return true;
    }
    let c = content[pos - 1];
    LEFT_BOUNDARY.contains(c) || (EMPH_DELIMS.contains(c) && delims.is_boundary(pos - 1))
}

/// Check right boundary for permissive autolinks.
fn check_right_boundary(content: &[u8], pos: usize, delims: DelimiterBoundary) -> bool {
    if pos >= content.len() {
        return true;
    }
    let c = content[pos];
    RIGHT_BOUNDARY.contains(c) || (EMPH_DELIMS.contains(c) && delims.is_boundary(pos))
}

struct Scheme {
    name: &'static [u8],
    suffix: &'static [u8],
}

/// Detect a permissive URL autolink. `pos` is the position of the ':' after the scheme.
pub(crate) fn find_url_autolink(
    content: &[u8],
    pos: usize,
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
                if !check_left_boundary(content, beg, DelimiterBoundary::Always) {
                    continue;
                }
                let link = LinkStart {
                    trigger: pos,
                    beg,
                    host_start: pos + 1 + suflen,
                    min_host_components: 2,
                };
                if let Some(link) = scan_url_tail(content, link, ctx) {
                    return Some(link);
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

    let delims = DelimiterBoundary::IfPaired(resolved);
    if !check_left_boundary(content, beg, delims) {
        return None;
    }

    // Scan forward for domain (host component only for email)
    let mut content = content;
    let mut host = scan_url_component(content, None, HOST, pos + 1, 2);
    // The input of the host ends at the first paired run in it.
    let runs = &resolved[resolved.partition_point(|d| d.pos < pos)..];
    let paired = runs
        .iter()
        .take_while(|d| d.pos < host.accept_end)
        .find(|d| d.open_count + d.close_count > 0);
    if let Some(run) = paired {
        content = &content[..run.pos];
        host = scan_url_component(content, None, HOST, pos + 1, 2);
    }
    if !host.ok {
        return None;
    }
    let end = host.end;

    if !check_right_boundary(content, end, delims) {
        return None;
    }

    Some(Autolink::certain(pos, beg, end))
}

/// Detect a permissive WWW autolink. `pos` is the position of the '.' after "www".
pub(crate) fn find_www_autolink(
    content: &[u8],
    pos: usize,
    ctx: &mut ScanContext,
) -> AutolinkResult {
    if pos < 3 {
        return None;
    }
    if !helpers::ascii_case_eql(&content[pos - 3..pos], b"www") {
        return None;
    }

    let beg = pos - 3;
    if !check_left_boundary(content, beg, DelimiterBoundary::Always) {
        return None;
    }
    let link = LinkStart {
        trigger: pos,
        beg,
        host_start: pos + 1,
        min_host_components: 1,
    };
    scan_url_tail(content, link, ctx)
}

/// What a finder knows of a candidate in front of the scan.
#[derive(Copy, Clone)]
struct LinkStart {
    trigger: usize,
    beg: usize,
    host_start: usize,
    min_host_components: u32,
}

/// Scan the host (mandatory), path, query and fragment of the candidate `link`, and find its end.
fn scan_url_tail(content: &[u8], link: LinkStart, ctx: &mut ScanContext) -> AutolinkResult {
    let LinkStart {
        trigger,
        beg,
        host_start,
        min_host_components,
    } = link;
    let host = scan_url_component(content, Some(ctx), HOST, host_start, min_host_components);
    if !host.ok {
        ctx.memo.note(content, ctx.base, &[host]);
        return None;
    }
    let path = scan_url_component(content, Some(ctx), PATH, host.end, 0);
    let query = scan_url_component(content, Some(ctx), QUERY, path.end, 1);
    let frag = scan_url_component(content, Some(ctx), FRAGMENT, query.end, 1);

    let scan_end = frag.end;
    let scan = TailScan {
        kind: if frag.end > query.end {
            FRAGMENT
        } else if query.end > path.end {
            QUERY
        } else if path.end > host.end {
            PATH
        } else {
            HOST
        },
        from: host_start,
        end: scan_end,
    };
    let tail = ctx.memo.delimiter_in_tail(content, ctx.base, scan);
    let host_scan = HostScan {
        start: host_start,
        accept_end: host.accept_end,
        min_components: min_host_components,
    };
    let certain = |end| Autolink::certain(trigger, beg, end);
    let link = match tail {
        Some(tail) if tail.token_ends => {
            end_at_delimiter_run(content, host_scan, path.end, tail, ctx).map(certain)
        }
        _ => {
            let end = post_process_autolink_end(content, beg, path.end, scan_end, ctx);
            if check_right_boundary(content, end, DelimiterBoundary::Never) {
                Some(certain(end))
            } else {
                // Text follows the delimiter at the scan end: `Autolink::resolved_with` decides.
                tail.filter(|_| EMPH_DELIMS.contains(content[end]))
                    .and_then(|tail| {
                        let end = end_at_delimiter_run(content, host_scan, path.end, tail, ctx)?;
                        Some(Autolink {
                            trigger,
                            beg,
                            end,
                            first_run: tail.run,
                            scan_end,
                        })
                    })
            }
        }
    };
    // The bytes of a link that is not certain are read again.
    if link.is_none_or(|link| !link.is_certain()) {
        ctx.memo.note(content, ctx.base, &[host, path, query, frag]);
    }
    link
}

#[derive(Copy, Clone)]
struct HostScan {
    start: usize,
    accept_end: usize,
    min_components: u32,
}

/// The end of a link in front of the first delimiter of `tail`, if the host in front of that end is whole.
fn end_at_delimiter_run(
    content: &[u8],
    host: HostScan,
    query_start: usize,
    tail: TailRun,
    ctx: &mut ScanContext,
) -> Option<usize> {
    let end = ctx
        .memo
        .stripped_end(content, ctx.base, host.start, query_start, tail);
    if end < host.accept_end {
        let (base, memo, min) = (ctx.base, &mut *ctx.memo, host.min_components);
        let ok = if memo.armed && memo.covers(HOST, base + host.start) {
            memo.host_has_to(content, base, base + host.start, base + end, min)
        } else {
            HostMarks::of(content, 0, host.start, end).has(host.start, min)
        };
        if !ok {
            return None;
        }
    }
    Some(end)
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
    let ParenCount { open, mut close } = ctx.memo.parens(content, ctx.base, query_start, end);
    while end > beg && content[end - 1] == b')' && close > open {
        end -= 1;
        close -= 1;
    }

    end
}
