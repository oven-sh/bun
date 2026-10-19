//! Parses one ignore file (or one ignore array from a config). The last matching line wins.
//!
//! Each line is converted to a pattern for [`bun_glob::match`]. The npm package `ignore` has its own interpretation of
//! a few things (a `\`, `[!a]`, a path with an empty segment). Those fall back to the package's algorithm, which turns
//! the line into a regex.

use crate::regex::Regex;
use bun_collections::StringHashMap;
use bun_core::strings;
use bun_glob::{Candidate, Pattern};
use smallvec::SmallVec;
use std::borrow::Cow;
use std::sync::{LazyLock, OnceLock};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct IgnoreOptions {
    /// `{a,b}` means `a` or `b`, as in the `ignore` crate that oxlint and oxfmt use. Braces are literal for git and for the
    /// npm package `ignore` that ESLint and Prettier use.
    pub has_braces: bool,
    /// The package's `ignoreCase` (on by default), the crate's `case_insensitive`, git's `core.ignorecase`.
    /// Only ASCII is folded.
    pub ignores_case: bool,
}

/// Result of the last matching line.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Verdict {
    /// No line matched.
    Unmentioned,
    Ignored,
    /// A `!` line matched.
    Unignored,
}

struct Rule {
    /// `None` if an index lookup alone proves a match, or if only `package_rule` can decide.
    pattern: Option<Pattern>,
    /// For the npm flavor, the line without its `!` and the package's regex for it, compiled on first use.
    package_rule: Option<(Box<[u8]>, OnceLock<Option<Regex>>)>,
    /// The line also matches the ignore file's own directory, whose relative path is empty. `*/` does.
    matches_empty_path: bool,
    /// `pattern` can't reproduce the package's behavior, so always use the regex.
    needs_package_regex: bool,
    is_negated: bool,
    is_for_directories: bool,
}

/// A parsed line.
struct Line {
    /// Matches paths relative to the ignore file's directory.
    pattern: Vec<u8>,
    /// Index in `pattern` where the line's own text starts. It's 3 if a `**/` was added because the line matches in any directory.
    text_start: usize,
    /// The line only matches relative to the ignore file's directory.
    is_anchored: bool,
    is_negated: bool,
    is_for_directories: bool,
}

/// Parses a line for git and the npm package. Only called for lines that [`parses_like_package`] accepts.
/// Returns `None` for a comment or a blank line.
fn parse_plain(line: &[u8], ignores_case: bool) -> Option<Line> {
    let mut stripped = line.trim_ascii_end();
    if stripped.starts_with(b"#") {
        return None;
    }
    let is_negated = stripped.starts_with(b"!");
    stripped = &stripped[usize::from(is_negated)..];
    let is_for_directories = stripped.len() > 1 && stripped.ends_with(b"/");
    stripped = &stripped[..stripped.len() - usize::from(is_for_directories)];
    // A `/` anchors the line to the ignore file's directory. A leading `**/` undoes that.
    let mut is_anchored = strings::contains_char(stripped, b'/');
    stripped = stripped.strip_prefix(b"/").unwrap_or(stripped);
    while let Some(rest) = stripped.strip_prefix(b"**/") {
        (stripped, is_anchored) = (rest, false);
    }
    if stripped.is_empty() {
        return None;
    }
    let mut pattern = Vec::with_capacity(stripped.len() + 4);
    if !is_anchored {
        pattern.extend_from_slice(b"**/");
    }
    let text_start = pattern.len();
    for (at, &byte) in stripped.iter().enumerate() {
        match byte {
            b'{' | b'}' | b'(' => pattern.extend_from_slice(&[b'\\', byte]),
            b'!' if at == 0 && is_anchored => pattern.extend_from_slice(b"\\!"),
            _ => pattern.push(byte),
        }
    }
    if ignores_case {
        pattern.make_ascii_lowercase();
    }
    Some(Line {
        pattern,
        text_start,
        is_anchored,
        is_negated,
        is_for_directories,
    })
}

/// globset matches bytes, so `?` is one byte of a multi-byte character, while Bun matches code points.
/// Giving every non-ASCII byte its own code point, in the pattern and in the path, makes the two agree.
fn one_code_point_per_byte(text: &[u8]) -> Cow<'_, [u8]> {
    if text.is_ascii() {
        return Cow::Borrowed(text);
    }
    let mut spread = Vec::with_capacity(text.len() * 2);
    for &byte in text {
        match byte.is_ascii() {
            true => spread.push(byte),
            false => spread.extend_from_slice(&[0xC0 | byte >> 6, 0x80 | byte & 0x3F]),
        }
    }
    Cow::Owned(spread)
}

/// Parses a line like `GitignoreBuilder::add_line` of the `ignore` crate 0.4 and converts its globset pattern.
/// Returns `Ok(None)` for a comment or a blank line and `Err` for a line the crate rejects: an unbalanced group, a trailing `\`
/// or a reversed range like `z-a`.
fn parse_for_crate(line: &[u8], ignores_case: bool) -> Result<Option<Line>, ()> {
    if line.starts_with(b"#") {
        return Ok(None);
    }
    let mut stripped = match line.ends_with(b"\\ ") {
        true => line,
        false => strings::trim_unicode_whitespace_end(line),
    };
    if stripped.is_empty() {
        return Ok(None);
    }
    let (mut is_negated, mut is_anchored) = (false, false);
    if stripped.starts_with(b"\\!") || stripped.starts_with(b"\\#") {
        stripped = &stripped[1..];
    } else {
        if let Some(rest) = stripped.strip_prefix(b"!") {
            (stripped, is_negated) = (rest, true);
        }
        if let Some(rest) = stripped.strip_prefix(b"/") {
            (stripped, is_anchored) = (rest, true);
        }
    }
    let mut is_for_directories = false;
    if let Some(rest) = stripped.strip_suffix(b"/") {
        is_for_directories = true;
        // A `\` that escapes the trailing `/` is removed with it.
        stripped = rest.strip_suffix(b"\\").unwrap_or(rest);
    }
    is_anchored |= strings::contains_char(stripped, b'/');
    while let Some(rest) = stripped.strip_prefix(b"**/") {
        (stripped, is_anchored) = (rest, false);
    }
    // Nothing is left of a line like `!` or `**/`. It matches everything.
    if stripped.is_empty() && !is_anchored {
        stripped = b"**";
    }
    let mut pattern = Vec::with_capacity(stripped.len() + 8);
    if !is_anchored && stripped != b"**" {
        pattern.extend_from_slice(b"**/");
    }
    let text_start = pattern.len();
    let (mut at, mut depth, mut has_unclosed_class) = (0, 0_usize, false);
    while let Some(&byte) = stripped.get(at) {
        at += 1;
        match byte {
            b'\\' => {
                let escaped = *stripped.get(at).ok_or(())?;
                at += 1;
                // Bun reads `\n` and friends as control characters. Here an escaped letter is just the letter.
                if !escaped.is_ascii_alphanumeric() {
                    pattern.push(b'\\');
                }
                pattern.push(escaped);
            }
            b'[' if !has_unclosed_class => {
                match crate::glob::from_globset_class(stripped, at - 1, true, &mut pattern)? {
                    Some(end) => at = end,
                    None => {
                        has_unclosed_class = true;
                        pattern.extend_from_slice(b"\\[");
                    }
                }
            }
            b'[' | b'(' => pattern.extend_from_slice(&[b'\\', byte]),
            b'{' => {
                depth += 1;
                pattern.push(byte);
            }
            b'}' => {
                depth = depth.checked_sub(1).ok_or(())?;
                pattern.push(byte);
            }
            // `{1..3}` isn't a sequence.
            b'.' if stripped.get(at) == Some(&b'.') => pattern.extend_from_slice(b"\\."),
            b'!' if at == 1 => pattern.extend_from_slice(b"\\!"),
            _ => pattern.push(byte),
        }
    }
    if depth > 0 {
        return Err(());
    }
    let pattern = crate::glob::without_empty_alternatives(&pattern);
    let mut pattern = one_code_point_per_byte(&pattern).into_owned();
    // `a/**` matches everything inside `a` but not `a` itself.
    if pattern.ends_with(b"/**") {
        pattern.extend_from_slice(b"/*");
    }
    if ignores_case {
        pattern.make_ascii_lowercase();
    }
    Ok(Some(Line {
        pattern,
        text_start,
        is_anchored,
        is_negated,
        is_for_directories,
    }))
}

/// `REPLACERS` from the npm package `ignore` 5.3.2.
static REPLACERS: LazyLock<[Regex; 16]> = LazyLock::new(|| {
    [
        r"/^\uFEFF/",
        r"/((?:\\\\)*?)(\\?\s+)$/",
        r"/(\\+?)\s/g",
        r"/[\\$.|*+(){^]/g",
        r"/(?!\\)\?/g",
        r"/^\//",
        r"/\//g",
        r"/^\^*\\\*\\\*\\\//",
        r"/^(?=[^^])/",
        r"/\\\/\\\*\\\*(?=\\\/|$)/g",
        r"/(^|[^\\]+)(\\\*)+(?=.+)/g",
        r"/\\\\\\(?=[$.|*+(){^])/g",
        r"/\\\\/g",
        r"/(\\)?\[([^\]/]*?)(\\*)($|\])/g",
        r"/(?:[^*])$/",
        r"/(\^|\\\/)?\\\*$/",
    ]
    .map(Regex::literal)
});

/// `REGEX_REGEXP_RANGE`
static RANGE: LazyLock<Regex> = LazyLock::new(|| Regex::literal("/([0-z])-([0-z])/g"));

/// The package's `makeRegex(pattern, ignoreCase)`. Each replacement runs on the output of the previous one.
/// Returns `None` where the package throws.
fn package_regex(pattern: &[u8], ignores_case: bool) -> Option<Regex> {
    let even = |backslashes: &[u8]| backslashes.len() - backslashes.len() % 2;
    let mut source = pattern.to_vec();
    for (step, regex) in REPLACERS.iter().enumerate() {
        let len = source.len();
        let replaced = regex.replace_with(&source, |found, out| match step {
            0 => {}
            1 => {
                out.extend_from_slice(found.bytes(1));
                if found.bytes(2).starts_with(b"\\") {
                    out.push(b' ');
                }
            }
            2 => {
                out.extend_from_slice(&found.bytes(1)[..even(found.bytes(1))]);
                out.push(b' ');
            }
            3 => out.extend_from_slice(&[b"\\", found.as_bytes()].concat()),
            4 => out.extend_from_slice(b"[^/]"),
            5 => out.push(b'^'),
            6 => out.extend_from_slice(b"\\/"),
            7 => out.extend_from_slice(b"^(?:.*\\/)?"),
            // A `/` anywhere but at the end anchors the line to the directory.
            8 => out.extend_from_slice(
                match strings::contains_char(&pattern[..pattern.len().saturating_sub(1)], b'/') {
                    true => b"^",
                    false => b"(?:^|\\/)",
                },
            ),
            9 => out.extend_from_slice(match found.end() < len {
                true => b"(?:\\/[^\\/]+)*",
                false => b"\\/.+",
            }),
            10 => out.extend_from_slice(&[found.bytes(1), b"[^\\/]*"].concat()),
            11 | 12 => out.push(b'\\'),
            13 => {
                let (range, end_escape, close) = (found.bytes(2), found.bytes(3), found.bytes(4));
                if found.get(1).is_some() {
                    let paired_escapes = &end_escape[..even(end_escape)];
                    out.extend_from_slice(&[b"\\[", range, paired_escapes, close].concat());
                } else if close == b"]" && end_escape.len() % 2 == 0 {
                    // `sanitizeRange` drops reversed ranges like `b-a`.
                    let sanitized = RANGE.replace_with(range, |it, out| {
                        if it.bytes(1) <= it.bytes(2) {
                            out.extend_from_slice(it.as_bytes());
                        }
                    });
                    out.extend_from_slice(&[b"[", &sanitized[..], end_escape, b"]"].concat());
                } else {
                    out.extend_from_slice(b"[]");
                }
            }
            14 => {
                out.extend_from_slice(found.as_bytes());
                out.extend_from_slice(match found.as_bytes() {
                    b"/" => b"$",
                    _ => b"(?=$|\\/$)",
                });
            }
            _ => {
                match found.get(1) {
                    Some(before) => out.extend_from_slice(&[before.as_bytes(), b"[^/]+"].concat()),
                    None => out.extend_from_slice(b"[^/]*"),
                }
                out.extend_from_slice(b"(?=$|\\/$)");
            }
        });
        source = replaced.into_owned();
    }
    Regex::from_bytes(&source, if ignores_case { b"i" } else { b"" }).ok()
}

/// Returns true if [`parse_plain`] and the package agree on `line` (without its `!`). That's the case for ASCII lines
/// without `\` or trailing whitespace whose classes only contain letters and digits, and whose `**` are interpreted the
/// same.
fn parses_like_package(line: &[u8]) -> bool {
    // In the package, the `**` in `a/**/` can match nothing, so the line also matches `a` itself and every file in it.
    // The package also has its own interpretation of a `**` that isn't a whole segment, as in `a**/**`.
    if line.ends_with(b"/**/")
        || strings::split(line, b"/").any(|it| it != b"**" && strings::contains(it, b"**"))
    {
        return false;
    }
    let mut rest = line;
    while let Some(open) = strings::index_of_char_usize(rest, b'[') {
        let Some(len) = strings::index_of_char_usize(&rest[open + 1..], b']') else {
            return false;
        };
        let inside = &rest[open + 1..open + 1 + len];
        let is_bound = |at: usize| inside.get(at).is_some_and(u8::is_ascii_alphanumeric);
        let is_range = |at: usize| {
            at > 0 && is_bound(at - 1) && is_bound(at + 1) && inside[at - 1] <= inside[at + 1]
        };
        if inside.is_empty()
            || !(0..len).all(|at| is_bound(at) || inside[at] == b'-' && is_range(at))
        {
            return false;
        }
        rest = &rest[open + len + 2..];
    }
    // The package looks for a `/` before it trims, so `a/ ` is anchored and `a/` isn't.
    line.is_ascii()
        && !strings::contains_char(line, b'\\')
        && line.trim_ascii_end().len() == line.len()
}

/// Indexes into `IgnoreRules::rules`, in ascending order.
type RuleIndex = StringHashMap<Vec<u32>>;

/// The rules of one ignore file or one ignore array. It doesn't know its directory and never touches the file system.
pub struct IgnoreRules {
    options: IgnoreOptions,
    rules: Vec<Rule>,
    /// Lines that were rejected.
    rejected: Vec<Box<[u8]>>,
    /// Indexes that pick the rules to try: `name` by file name, `/a/b` by path, `*.ext` by extension. Keys are lower case when folding.
    by_name: RuleIndex,
    by_path: RuleIndex,
    /// Length of the longest key in `by_path`.
    longest_path: usize,
    by_extension: RuleIndex,
    /// Rules that start with a literal segment and a `/`, by that segment.
    by_first_name: RuleIndex,
    /// Other anchored rules without a `/`. They only apply to entries of the ignore file's own directory.
    at_top: Vec<u32>,
    /// All remaining rules.
    others: Vec<u32>,
    /// At least one line starts with `!`.
    has_exceptions: bool,
    /// At least one rule needs the package's regex.
    has_package_only_rules: bool,
}

fn rules_for_key<'m>(map: &'m RuleIndex, key: &[u8]) -> Option<&'m [u32]> {
    match map.is_empty() {
        true => None,
        false => map.get(key).map(|it| &it[..]),
    }
}

/// Returns true if every byte of `text` is literal in a pattern.
fn is_literal(text: &[u8]) -> bool {
    strings::index_of_any(text, b"*?[{}\\!").is_none()
}

impl IgnoreRules {
    fn new(options: IgnoreOptions) -> IgnoreRules {
        IgnoreRules {
            options,
            rules: Vec::new(),
            rejected: Vec::new(),
            by_name: RuleIndex::new(),
            by_path: RuleIndex::new(),
            longest_path: 0,
            by_extension: RuleIndex::new(),
            by_first_name: RuleIndex::new(),
            at_top: Vec::new(),
            others: Vec::new(),
            has_exceptions: false,
            has_package_only_rules: false,
        }
    }

    fn add_line(&mut self, line: &[u8]) {
        // `checkPattern`, `createRule`
        let package_rule = (!self.options.has_braces).then(|| {
            let body = line.strip_prefix(b"!").unwrap_or(line);
            match body {
                [b'\\', rest @ ..] if matches!(rest, [b'!' | b'#', ..]) => rest,
                _ => body,
            }
        });
        // A line made only of `/` matches an empty segment, which only the package's regex handles.
        let parses_like_package = |it: &&[u8]| {
            parses_like_package(it) && !it.trim_ascii_end().iter().all(|byte| *byte == b'/')
        };
        if let Some(body) = package_rule.filter(|it| !parses_like_package(it)) {
            let is_skipped = strings::trim_js_whitespace(line).is_empty()
                || line.starts_with(b"#")
                || line.ends_with(b"\\") && !line.ends_with(b"\\\\");
            if !is_skipped {
                self.others.push(self.rules.len() as u32);
                self.has_package_only_rules = true;
                self.has_exceptions |= line.starts_with(b"!");
                self.rules.push(Rule {
                    pattern: None,
                    package_rule: Some((body.into(), OnceLock::new())),
                    matches_empty_path: false,
                    needs_package_regex: true,
                    is_negated: line.starts_with(b"!"),
                    is_for_directories: false,
                });
            }
            return;
        }
        let read = match self.options.has_braces {
            true => parse_for_crate(line, self.options.ignores_case),
            false => Ok(parse_plain(line, self.options.ignores_case)),
        };
        let read = match read {
            Ok(Some(read)) => read,
            Ok(None) => return,
            Err(()) => return self.rejected.push(line.into()),
        };
        let at = self.rules.len() as u32;
        let (own_text, is_anchored) = (&read.pattern[read.text_start..], read.is_anchored);
        let first_len = strings::index_of_char_usize(own_text, b'/');
        // For these three shapes an index hit is already a match.
        let found_by_key = match own_text {
            name if !is_anchored && first_len.is_none() && is_literal(name) => {
                Some((&mut self.by_name, name))
            }
            [b'*', b'.', extension @ ..]
                if !is_anchored
                    && is_literal(extension)
                    && !extension.is_empty()
                    && strings::index_of_any(extension, b"./").is_none() =>
            {
                Some((&mut self.by_extension, extension))
            }
            path if is_anchored && is_literal(path) => {
                self.longest_path = self.longest_path.max(path.len());
                Some((&mut self.by_path, path))
            }
            _ => None,
        };
        let is_found_by_key = found_by_key.is_some();
        let index_entry = found_by_key.or_else(|| {
            let first = &own_text[..first_len.filter(|_| is_anchored)?];
            is_literal(first).then_some((&mut self.by_first_name, first))
        });
        match index_entry {
            Some((rule_index, key)) => {
                bun_core::handle_oom(rule_index.get_or_put_value(key, Vec::new())).push(at);
            }
            // `**` can still reach into directories.
            None if is_anchored && first_len.is_none() && !strings::contains(own_text, b"**") => {
                self.at_top.push(at)
            }
            None => self.others.push(at),
        }
        self.has_exceptions |= read.is_negated;
        self.rules.push(Rule {
            // `may_keep_inside` needs the pattern of every `!` line.
            pattern: (!is_found_by_key || read.is_negated).then(|| Pattern::new(&read.pattern)),
            matches_empty_path: bun_glob::matcher::match_on::<false>(own_text, b"").matches(),
            package_rule: package_rule.map(|it| (it.into(), OnceLock::new())),
            needs_package_regex: false,
            is_negated: read.is_negated,
            is_for_directories: read.is_for_directories,
        });
    }

    /// Parses the text of an ignore file. Handles `\r\n`, a byte order mark and comments.
    pub fn from_text(text: &[u8], options: IgnoreOptions) -> IgnoreRules {
        let mut rules = IgnoreRules::new(options);
        let text = text.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(text);
        for line in strings::split(text, b"\n") {
            rules.add_line(line.strip_suffix(b"\r").unwrap_or(line));
        }
        rules
    }

    /// Parses the elements of an array.
    pub fn from_lines<'l>(
        lines: impl IntoIterator<Item = &'l [u8]>,
        options: IgnoreOptions,
    ) -> IgnoreRules {
        let mut rules = IgnoreRules::new(options);
        for line in lines {
            rules.add_line(line);
        }
        rules
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    /// Returns true if any line starts with `!`.
    pub fn has_exceptions(&self) -> bool {
        self.has_exceptions
    }

    /// Lines that were rejected. Only the brace flavor rejects lines.
    pub fn rejected(&self) -> &[Box<[u8]>] {
        &self.rejected
    }

    /// Tests the package's regex. `text` is the path, with a trailing `/` for a directory.
    fn package_matches(&self, rule: &Rule, text: &[u8]) -> bool {
        let Some((line, regex)) = &rule.package_rule else {
            return false;
        };
        let regex = regex.get_or_init(|| package_regex(line, self.options.ignores_case));
        regex.as_ref().is_some_and(|it| it.test(text))
    }

    /// Returns the last rule in `found` that matches and comes after `best`, otherwise `best`.
    /// With `is_known`, every rule in `found` is already known to match.
    fn last_match_in(
        &self,
        (found, is_known): (Option<&[u32]>, bool),
        best: Option<u32>,
        (path, text): (&Candidate<'_>, &[u8]),
        is_directory: bool,
    ) -> Option<u32> {
        // Rules before the best match so far can't win.
        let later = found.unwrap_or_default().iter().rev();
        let mut later = later.take_while(|at| Some(**at) > best);
        let matches = |at: &&u32| {
            let rule = self.rules.get(**at as usize);
            rule.filter(|it| is_directory || !it.is_for_directories)
                .is_some_and(|rule| {
                    let is_match = || match rule.needs_package_regex {
                        true => self.package_matches(rule, text),
                        false => {
                            (rule.pattern.as_ref()).is_none_or(|it| it.matches_candidate(path))
                        }
                    };
                    debug_assert!(!is_known || is_match());
                    is_known || is_match()
                })
        };
        later.find(matches).copied().or(best)
    }

    /// Returns the last matching rule.
    fn last_match(&self, path: &[u8], is_directory: bool) -> Option<&Rule> {
        // The text the package's regex is tested against.
        let has_empty_segment = !self.options.has_braces
            && (matches!(path, [] | [b'/', ..] | [.., b'/']) || strings::contains(path, b"//"));
        let mut text: SmallVec<[u8; 256]> = SmallVec::new();
        if has_empty_segment || self.has_package_only_rules {
            text.extend_from_slice(path);
            if is_directory {
                text.push(b'/');
            }
        }
        if has_empty_segment {
            return (self.rules.iter().rev()).find(|it| self.package_matches(it, &text));
        }
        if path.is_empty() {
            let applies =
                |it: &&Rule| it.matches_empty_path && (is_directory || !it.is_for_directories);
            return self.rules.iter().rev().find(applies);
        }
        let path = &match self.options.has_braces {
            true => one_code_point_per_byte(path),
            false => Cow::Borrowed(path),
        };
        let mut folded: SmallVec<[u8; 256]> = SmallVec::new();
        let path: &[u8] = match self.options.ignores_case {
            true => {
                folded.extend_from_slice(path);
                folded.make_ascii_lowercase();
                &folded[..]
            }
            false => path,
        };
        let candidate = Candidate::new(path);
        let name = candidate.name();
        let extension = strings::last_index_of_char(name, b'.').map(|dot| &name[dot + 1..]);
        let first_len = || strings::index_of_char_usize(path, b'/').unwrap_or(path.len());
        let first = (!self.by_first_name.is_empty()).then(|| &path[..first_len()]);
        let mut best = None;
        for found in [
            (rules_for_key(&self.by_name, name), true),
            (
                match path.len() <= self.longest_path {
                    true => rules_for_key(&self.by_path, path),
                    false => None,
                },
                true,
            ),
            (
                extension.and_then(|it| rules_for_key(&self.by_extension, it)),
                true,
            ),
            (
                first.and_then(|it| rules_for_key(&self.by_first_name, it)),
                false,
            ),
            (
                (name.len() == path.len()).then_some(&self.at_top[..]),
                false,
            ),
            (Some(&self.others[..]), false),
        ] {
            best = self.last_match_in(found, best, (&candidate, &text), is_directory);
        }
        self.rules.get(best? as usize)
    }

    /// `path` is relative to the ignore file's directory, without a leading or trailing `/`. Parent directories aren't checked.
    pub fn verdict(&self, path: &[u8], is_directory: bool) -> Verdict {
        match self.last_match(path, is_directory) {
            None => Verdict::Unmentioned,
            Some(rule) if rule.is_negated => Verdict::Unignored,
            Some(_) => Verdict::Ignored,
        }
    }

    /// `Gitignore::matched_path_or_any_parents`. Checks `path`, then each parent directory until a line matches.
    pub fn verdict_with_parents(&self, mut path: &[u8], is_directory: bool) -> Verdict {
        if self.rules.is_empty() {
            return Verdict::Unmentioned;
        }
        let mut found = self.verdict(path, is_directory);
        // Like `Path::parent`, this ends with the empty path.
        while found == Verdict::Unmentioned && !path.is_empty() {
            path = &path[..strings::last_index_of_char(path, b'/').unwrap_or(0)];
            while let [rest @ .., b'/'] = path {
                path = rest;
            }
            found = self.verdict(path, true);
        }
        found
    }

    /// `ignore().add(lines).ignores(path)`. Checks every parent directory, then `path`. A trailing `/` marks a directory.
    pub fn ignores(&self, path: &[u8]) -> bool {
        let is_ignored =
            |text: &[u8], is_directory: bool| self.verdict(text, is_directory) == Verdict::Ignored;
        // Every `/` except a trailing one ends a parent directory.
        let mut from = 0;
        while let Some(slash) = path
            .get(from..)
            .and_then(|rest| strings::index_of_char_usize(rest, b'/'))
            .map(|it| from + it)
            .filter(|it| it + 1 < path.len())
        {
            if is_ignored(&path[..slash], true) {
                return true;
            }
            from = slash + 1;
        }
        match path.strip_suffix(b"/") {
            Some(directory) => is_ignored(directory, true),
            None => is_ignored(path, false),
        }
    }

    /// Returns false only if no `!` line can match anything inside `directory`.
    pub fn may_keep_inside(&self, directory: &[u8]) -> bool {
        let mut folded: SmallVec<[u8; 256]> = SmallVec::new();
        match self.options.has_braces {
            true => folded.extend_from_slice(&one_code_point_per_byte(directory)),
            false => folded.extend_from_slice(directory),
        }
        if self.options.ignores_case {
            folded.make_ascii_lowercase();
        }
        let may_match = |it: &Pattern| it.may_match_inside(&folded);
        let mut exceptions = self.rules.iter().filter(|it| it.is_negated);
        self.has_exceptions && exceptions.any(|it| it.pattern.as_ref().is_none_or(may_match))
    }
}
