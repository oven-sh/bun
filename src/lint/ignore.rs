//! The lines of one ignore file, or of one array in a configuration: the last line that matches decides.
//!
//! A line becomes a pattern for [`bun_glob::match`]. What the package `ignore` reads in a way of its own (a `\`, `[!a]`, a path with
//! an empty name) goes the way of the package: its table of replacements makes a regular expression of the line.

use crate::regex::Regex;
use bun_collections::StringHashMap;
use bun_core::strings;
use bun_glob::{Candidate, Pattern};
use smallvec::SmallVec;
use std::sync::{LazyLock, OnceLock};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct IgnoreOptions {
    /// `{a,b}` is `a` or `b`, as for the crate `ignore`, which oxlint and oxfmt have. To git and to the package `ignore`, which
    /// ESLint and Prettier have, braces are characters.
    pub has_braces: bool,
    /// `ignoreCase` of the package, which is on unless told otherwise. `case_insensitive` of the crate, `core.ignorecase`.
    /// Only ASCII is folded.
    pub ignores_case: bool,
}

/// What the last line that matches says.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Verdict {
    /// No line matches.
    Unmentioned,
    Ignored,
    /// A line with `!`.
    Kept,
}

struct Rule {
    /// `None`: whatever is found by its key matches, or `of_package` says what does.
    pattern: Option<Pattern>,
    /// Without braces: the line, without the `!`, and what the package makes of it, once that is asked for.
    of_package: Option<(Box<[u8]>, OnceLock<Option<Regex>>)>,
    /// `pattern` does not say the same as the package.
    is_only_of_package: bool,
    is_negated: bool,
    is_for_directories: bool,
}

/// What a line says.
struct Line {
    /// For the path from the directory of the lines.
    pattern: Vec<u8>,
    /// Where in `pattern` what is written starts: behind the `**/` of a line that is for a name in any directory.
    written_at: usize,
    is_negated: bool,
    is_for_directories: bool,
}

/// Without the blanks at the end, but for one that a `\` is before.
fn before_blanks(line: &[u8]) -> &[u8] {
    let end = line.trim_ascii_end().len();
    let backslashes = line[..end].iter().rev().take_while(|it| **it == b'\\');
    &line[..end + usize::from(end < line.len() && backslashes.count() % 2 == 1)]
}

/// `Ok(None)`: it says nothing: a comment, blank. `Err`: with braces, it is refused: a group is not closed or not opened, a `\` is
/// the last character, a range is `z-a`.
fn read(line: &[u8], options: IgnoreOptions) -> Result<Option<Line>, ()> {
    let mut written = before_blanks(line);
    if written.starts_with(b"#") {
        return Ok(None);
    }
    let is_negated = written.starts_with(b"!");
    written = &written[usize::from(is_negated)..];
    let is_for_directories = written.len() > 1 && written.ends_with(b"/");
    written = &written[..written.len() - usize::from(is_for_directories)];
    // A `/` ties it to the directory of the lines, a `**/` at the start unties it.
    let mut is_anchored = strings::contains_char(written, b'/');
    written = written.strip_prefix(b"/").unwrap_or(written);
    while let Some(rest) = written.strip_prefix(b"**/") {
        (written, is_anchored) = (rest, false);
    }
    if written.is_empty() {
        return Ok(None);
    }
    let mut pattern = Vec::with_capacity(written.len() + 4);
    if !is_anchored {
        pattern.extend_from_slice(b"**/");
    }
    let written_at = pattern.len();
    let (mut at, mut depth) = (0, 0_usize);
    while let Some(&byte) = written.get(at) {
        let mut end = at + 1;
        match byte {
            b'\\' => {
                end += 1;
                match written.get(at + 1) {
                    // What `\` makes of a letter in a pattern of Bun, it does not make here.
                    Some(escaped) if escaped.is_ascii_alphanumeric() => pattern.push(*escaped),
                    Some(_) => pattern.extend_from_slice(&written[at..end]),
                    None if options.has_braces => return Err(()),
                    None => return Ok(None),
                }
            }
            b'[' => match bun_glob::matcher::class_end(written, at) {
                Some(close) if options.has_braces && has_reversed_range(&written[at..close]) => {
                    return Err(());
                }
                Some(close) => {
                    // No class takes a `/`.
                    let inside = at + 1 + usize::from(matches!(written[at + 1], b'!' | b'^'));
                    pattern.extend_from_slice(&written[at..inside]);
                    if inside > at + 1 {
                        pattern.push(b'/');
                    }
                    pattern.extend_from_slice(&written[inside..close]);
                    end = close;
                }
                // The crate takes the `[` of a class that is not closed as it is. To the package nothing matches it.
                None if options.has_braces => pattern.extend_from_slice(b"\\["),
                None => return Ok(None),
            },
            b'{' | b'}' if !options.has_braces => pattern.extend_from_slice(&[b'\\', byte]),
            b'{' => {
                depth += 1;
                pattern.push(byte);
            }
            b'}' => {
                depth = depth.checked_sub(1).ok_or(())?;
                pattern.push(byte);
            }
            b'!' if at == 0 && is_anchored => pattern.extend_from_slice(b"\\!"),
            _ => pattern.push(byte),
        }
        at = end;
    }
    if depth > 0 {
        return Err(());
    }
    if options.ignores_case {
        pattern.make_ascii_lowercase();
    }
    Ok(Some(Line {
        pattern,
        written_at,
        is_negated,
        is_for_directories,
    }))
}

/// `REPLACERS` of the package `ignore` 5.3.2.
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

/// `makeRegex(pattern, ignoreCase)` of the package. Later replacements see what earlier ones wrote. `None`: it throws.
fn regex_of_package(pattern: &[u8], ignores_case: bool) -> Option<Regex> {
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
            // A `/` that is not the last character ties the line to the directory.
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
                    let kept = &end_escape[..even(end_escape)];
                    out.extend_from_slice(&[b"\\[", range, kept, close].concat());
                } else if close == b"]" && end_escape.len() % 2 == 0 {
                    // `sanitizeRange`: `b-a` is left out.
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

/// Whether the package reads `line`, which has no `!` in front, as [`read`] does: no `\`, no class but of letters and digits, ASCII.
fn is_read_the_same(line: &[u8]) -> bool {
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
    line.is_ascii() && !strings::contains_char(line, b'\\')
}

/// `[z-a]`
fn has_reversed_range(class: &[u8]) -> bool {
    let inside = &class[1..class.len() - 1];
    (1..inside.len().saturating_sub(1))
        .any(|at| inside[at] == b'-' && inside[at - 1] > inside[at + 1])
}

/// Where in `IgnoreRules::rules`, the first first.
type Places = StringHashMap<Vec<u32>>;

/// The lines of one ignore file, or of one array in a configuration. It knows no directory and reads no file.
pub struct IgnoreRules {
    options: IgnoreOptions,
    rules: Vec<Rule>,
    /// The lines that are refused.
    refused: Vec<Box<[u8]>>,
    /// Which rules to try: `name` by the name, `/a/b` by the path, `*.ext` by `ext`. With folding: keys in lower case.
    by_name: Places,
    by_path: Places,
    /// How long the longest key of `by_path` is.
    longest_path: usize,
    by_extension: Places,
    /// Those that start with a name and a `/`, by that name.
    by_first_name: Places,
    /// Those of the others that take no `/`: they are about what is in the directory of the lines itself.
    at_top: Vec<u32>,
    /// Where the rest are.
    others: Vec<u32>,
    /// It has a line with `!`.
    has_exceptions: bool,
    /// Of one of the rules only the package says what it matches.
    has_rules_of_package: bool,
}

fn places<'m>(map: &'m Places, key: &[u8]) -> Option<&'m [u32]> {
    match map.is_empty() {
        true => None,
        false => map.get(key).map(|it| &it[..]),
    }
}

/// Whether every byte of `text` stands for itself in a pattern.
fn is_literal(text: &[u8]) -> bool {
    strings::index_of_any(text, b"*?[{}\\!").is_none()
}

impl IgnoreRules {
    fn new(options: IgnoreOptions) -> IgnoreRules {
        IgnoreRules {
            options,
            rules: Vec::new(),
            refused: Vec::new(),
            by_name: Places::new(),
            by_path: Places::new(),
            longest_path: 0,
            by_extension: Places::new(),
            by_first_name: Places::new(),
            at_top: Vec::new(),
            others: Vec::new(),
            has_exceptions: false,
            has_rules_of_package: false,
        }
    }

    fn add_line(&mut self, line: &[u8]) {
        // `checkPattern`, `createRule`
        let of_package = (!self.options.has_braces).then(|| {
            let body = line.strip_prefix(b"!").unwrap_or(line);
            match body {
                [b'\\', rest @ ..] if matches!(rest, [b'!' | b'#', ..]) => rest,
                _ => body,
            }
        });
        // Nor is a line of nothing but `/`, which to the package is about a name that is empty.
        let is_read_the_same = |it: &&[u8]| {
            is_read_the_same(it) && !it.trim_ascii_end().iter().all(|byte| *byte == b'/')
        };
        if let Some(body) = of_package.filter(|it| !is_read_the_same(it)) {
            let says_nothing = strings::trim_js_whitespace(line).is_empty()
                || line.starts_with(b"#")
                || line.ends_with(b"\\") && !line.ends_with(b"\\\\");
            if !says_nothing {
                self.others.push(self.rules.len() as u32);
                self.has_rules_of_package = true;
                self.has_exceptions |= line.starts_with(b"!");
                self.rules.push(Rule {
                    pattern: None,
                    of_package: Some((body.into(), OnceLock::new())),
                    is_only_of_package: true,
                    is_negated: line.starts_with(b"!"),
                    is_for_directories: false,
                });
            }
            return;
        }
        let read = match read(line, self.options) {
            Ok(Some(read)) => read,
            Ok(None) => return,
            Err(()) => return self.refused.push(line.into()),
        };
        let at = self.rules.len() as u32;
        let (written, is_anchored) = (&read.pattern[read.written_at..], read.written_at == 0);
        let first_len = strings::index_of_char_usize(written, b'/');
        // By the key alone it is known that these three match.
        let found_by_key = match written {
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
        let place = found_by_key.or_else(|| {
            let first = &written[..first_len.filter(|_| is_anchored)?];
            is_literal(first).then_some((&mut self.by_first_name, first))
        });
        match place {
            Some((places, key)) => {
                bun_core::handle_oom(places.get_or_put_value(key, Vec::new())).push(at);
            }
            None if is_anchored && first_len.is_none() => self.at_top.push(at),
            None => self.others.push(at),
        }
        self.has_exceptions |= read.is_negated;
        self.rules.push(Rule {
            // `may_keep_inside` asks those with `!`.
            pattern: (!is_found_by_key || read.is_negated)
                .then(|| Pattern::new(&bun_glob::pattern::of_fast_glob(&read.pattern))),
            of_package: of_package.map(|it| (it.into(), OnceLock::new())),
            is_only_of_package: false,
            is_negated: read.is_negated,
            is_for_directories: read.is_for_directories,
        });
    }

    /// The text of a file: lines, `\r`, a byte order mark, comments.
    pub fn from_text(text: &[u8], options: IgnoreOptions) -> IgnoreRules {
        let mut rules = IgnoreRules::new(options);
        let text = text.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(text);
        for line in strings::split(text, b"\n") {
            rules.add_line(line.strip_suffix(b"\r").unwrap_or(line));
        }
        rules
    }

    /// The elements of an array.
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

    /// It has a line with `!`.
    pub fn has_exceptions(&self) -> bool {
        self.has_exceptions
    }

    /// The lines that are refused. Only with braces are there any.
    pub fn refused(&self) -> &[Box<[u8]>] {
        &self.refused
    }

    /// What the package says about `text`, a path with a `/` behind it if it is a directory.
    fn package_says(&self, rule: &Rule, text: &[u8]) -> bool {
        let Some((line, regex)) = &rule.of_package else {
            return false;
        };
        let regex = regex.get_or_init(|| regex_of_package(line, self.options.ignores_case));
        regex.as_ref().is_some_and(|it| it.test(text))
    }

    /// The last of `found` that matches and is behind `best`, or else `best`. `is_known`: what is found matches.
    fn look(
        &self,
        (found, is_known): (Option<&[u32]>, bool),
        best: Option<u32>,
        (path, text): (&Candidate<'_>, &[u8]),
        is_directory: bool,
    ) -> Option<u32> {
        // Those before the best so far say nothing.
        let later = found.unwrap_or_default().iter().rev();
        let mut later = later.take_while(|at| Some(**at) > best);
        let matches = |at: &&u32| {
            let rule = self.rules.get(**at as usize);
            rule.filter(|it| is_directory || !it.is_for_directories)
                .is_some_and(|rule| {
                    let asked = || match rule.is_only_of_package {
                        true => self.package_says(rule, text),
                        false => {
                            (rule.pattern.as_ref()).is_none_or(|it| it.matches_candidate(path))
                        }
                    };
                    debug_assert!(!is_known || asked());
                    is_known || asked()
                })
        };
        later.find(matches).copied().or(best)
    }

    /// The last rule that matches.
    fn last_match(&self, path: &[u8], is_directory: bool) -> Option<&Rule> {
        // As the package is asked.
        let has_empty_name = !self.options.has_braces
            && (matches!(path, [] | [b'/', ..] | [.., b'/']) || strings::contains(path, b"//"));
        let mut text: SmallVec<[u8; 256]> = SmallVec::new();
        if has_empty_name || self.has_rules_of_package {
            text.extend_from_slice(path);
            if is_directory {
                text.push(b'/');
            }
        }
        if has_empty_name {
            return (self.rules.iter().rev()).find(|it| self.package_says(it, &text));
        }
        let mut folded: SmallVec<[u8; 256]> = SmallVec::new();
        let path = match self.options.ignores_case {
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
            (places(&self.by_name, name), true),
            (
                match path.len() <= self.longest_path {
                    true => places(&self.by_path, path),
                    false => None,
                },
                true,
            ),
            (
                extension.and_then(|it| places(&self.by_extension, it)),
                true,
            ),
            (first.and_then(|it| places(&self.by_first_name, it)), false),
            (
                (name.len() == path.len()).then_some(&self.at_top[..]),
                false,
            ),
            (Some(&self.others[..]), false),
        ] {
            best = self.look(found, best, (&candidate, &text), is_directory);
        }
        self.rules.get(best? as usize)
    }

    /// `path` is from the directory of the lines, without a `/` at either end. Says nothing about the directories that it is in.
    pub fn verdict(&self, path: &[u8], is_directory: bool) -> Verdict {
        match self.last_match(path, is_directory) {
            None => Verdict::Unmentioned,
            Some(rule) if rule.is_negated => Verdict::Kept,
            Some(_) => Verdict::Ignored,
        }
    }

    /// `Gitignore::matched_path_or_any_parents`: about `path`, or else about the nearest directory above it that is mentioned.
    pub fn verdict_or_of_parents(&self, mut path: &[u8], is_directory: bool) -> Verdict {
        if self.rules.is_empty() {
            return Verdict::Unmentioned;
        }
        let mut found = self.verdict(path, is_directory);
        // `Path::parent`: the last of them is the empty path.
        while found == Verdict::Unmentioned && !path.is_empty() {
            path = &path[..strings::last_index_of_char(path, b'/').unwrap_or(0)];
            while let [rest @ .., b'/'] = path {
                path = rest;
            }
            found = self.verdict(path, true);
        }
        found
    }

    /// `ignore().add(lines).ignores(path)`: `path`, or a directory that it is in. A `/` at the end tells a directory.
    pub fn ignores(&self, path: &[u8]) -> bool {
        let is_ignored =
            |text: &[u8], is_directory: bool| self.verdict(text, is_directory) == Verdict::Ignored;
        // At each `/` but the last byte.
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

    /// Whether a line with `!` can match something in `directory`. Never `false` if one can.
    pub fn may_keep_inside(&self, directory: &[u8]) -> bool {
        let mut folded: SmallVec<[u8; 256]> = SmallVec::new();
        folded.extend_from_slice(directory);
        if self.options.ignores_case {
            folded.make_ascii_lowercase();
        }
        let may_match = |it: &Pattern| it.may_match_inside(&folded);
        let mut exceptions = self.rules.iter().filter(|it| it.is_negated);
        self.has_exceptions && exceptions.any(|it| it.pattern.as_ref().is_none_or(may_match))
    }
}
