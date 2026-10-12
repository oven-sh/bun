//! The lines of one ignore file, or of one array in a configuration: the last line that matches decides.
//! A line becomes a pattern for [`crate::match`].

use crate::matcher;
use crate::pattern::{Candidate, Pattern};
use bun_collections::StringHashMap;
use bun_collections::smallvec::SmallVec;
use bun_core::strings;

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
    /// `None`: whatever is found by its key matches.
    pattern: Option<Pattern>,
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
            b'[' => match matcher::class_end(written, at) {
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
        }
    }

    fn add_line(&mut self, line: &[u8]) {
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
            pattern: (!is_found_by_key || read.is_negated).then(|| Pattern::new(&read.pattern)),
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

    /// The last of `found` that matches and is behind `best`, or else `best`. `is_known`: what is found matches.
    fn look(
        &self,
        (found, is_known): (Option<&[u32]>, bool),
        best: Option<u32>,
        path: &Candidate<'_>,
        is_directory: bool,
    ) -> Option<u32> {
        // Those before the best so far say nothing.
        let later = found.unwrap_or_default().iter().rev();
        let mut later = later.take_while(|at| Some(**at) > best);
        let matches = |at: &&u32| {
            let rule = self.rules.get(**at as usize);
            rule.filter(|it| is_directory || !it.is_for_directories)
                .is_some_and(|rule| {
                    let asked = || {
                        rule.pattern
                            .as_ref()
                            .is_none_or(|it| it.matches_candidate(path))
                    };
                    debug_assert!(!is_known || asked());
                    is_known || asked()
                })
        };
        later.find(matches).copied().or(best)
    }

    /// The last rule that matches.
    fn last_match(&self, path: &[u8], is_directory: bool) -> Option<&Rule> {
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
            best = self.look(found, best, &candidate, is_directory);
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
            if slash > 0 && is_ignored(&path[..slash], true) {
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
