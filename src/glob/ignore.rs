//! The lines of one ignore file, or of one array in a configuration: the last line that matches decides.

use crate::linear::Shape;
use crate::node::{Assertion, Node, Program, lower, simplify};
use crate::read_ignore::{self, Line};
use crate::unit::{Subject, Text, Unit};
use bun_collections::StringHashMap;
use bun_collections::smallvec::SmallVec;
use bun_core::strings;

/// Who reads the lines.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum IgnoreSyntax {
    /// The crate `ignore` 0.4.33 on `globset` 0.4.18: oxlint, oxfmt.
    Globset,
    /// npm `ignore` 5.3.2: the rules of ESLint.
    Npm5,
    /// npm `ignore` 7.0.5: Prettier.
    Npm705,
    /// npm `ignore` 7.0.12: the rules of typescript-eslint.
    Npm7012,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct IgnoreOptions {
    pub syntax: IgnoreSyntax,
    /// `ignoreCase` of the package, which is on unless told otherwise. `case_insensitive` of the crate, `core.ignorecase`.
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

/// A line that `Globset` does not take.
pub struct Refused {
    pub line: Box<[u8]>,
    /// `ErrorKind` of globset as it prints it: `unclosed character class; missing ']'`, `invalid range; 'z' > 'a'`, ..
    pub why: Box<[u8]>,
}

/// `under/**/names`: what is behind the `**`, which takes anything, goes to the end of the path and takes a known number of `/`. So
/// it is known where it starts.
struct Tail {
    /// What is before the `**`. Empty, or it ends with a `/`.
    under: Box<[u8]>,
    slashes: u32,
    program: Program,
}

impl Tail {
    /// Of `node`, which is simplified, if it is such a rule. Bytes are compared as they are.
    fn of(node: &Node, text: Text) -> Option<Tail> {
        let Node::Seq(nodes) = node else {
            return None;
        };
        let is_deep = |it: &Node| {
            matches!(
                it,
                Node::Deep {
                    empty_names: true,
                    newlines: true
                }
            )
        };
        let (before, after) = nodes.split_at_checked(nodes.iter().position(is_deep)?)?;
        let [_, names @ .., Node::Assert(Assertion::End)] = after else {
            return None;
        };
        let mut under = Vec::new();
        for node in before {
            let Node::Lit(bytes) = node else {
                return None;
            };
            under.extend_from_slice(bytes);
        }
        if text.unit != Unit::Byte || text.folds || !matches!(under.last(), None | Some(b'/')) {
            return None;
        }
        let mut slashes = 0;
        let mut copy = Vec::with_capacity(names.len() + 1);
        for node in names {
            copy.push(match node {
                Node::Lit(bytes) => {
                    slashes += strings::count_char(bytes, b'/') as u32;
                    Node::Lit(bytes.clone())
                }
                Node::Any => Node::Any,
                Node::Star => Node::Star,
                Node::Plus => Node::Plus,
                Node::Class(class) if !class.takes_slash() => Node::Class(class.clone()),
                _ => return None,
            });
        }
        copy.push(Node::Assert(Assertion::End));
        Some(Tail {
            under: under.into(),
            slashes,
            program: lower(Node::Seq(copy), text),
        })
    }

    /// `name_at`: where the last name of `path` starts.
    #[inline]
    fn matches(&self, path: &[u8], name_at: usize) -> bool {
        if !(self.under.is_empty() || path.starts_with(&self.under)) {
            return false;
        }
        let mut at = name_at;
        for _ in 0..self.slashes {
            let before = &path[..at.saturating_sub(1)];
            at = strings::last_index_of_char(before, b'/').map_or(0, |slash| slash + 1);
        }
        at >= self.under.len() && self.program.matches(Subject::of(&path[at..]))
    }
}

struct Rule {
    program: Program,
    /// What gives the same answers with less of the path.
    tail: Option<Tail>,
    is_negated: bool,
    is_for_directories: bool,
}

/// Where in `IgnoreRules::rules`, the first first.
type Places = StringHashMap<Vec<u32>>;

/// The lines of one ignore file, or of one array in a configuration. It knows no directory and reads no file.
pub struct IgnoreRules {
    options: IgnoreOptions,
    text: Text,
    rules: Vec<Rule>,
    refused: Vec<Refused>,
    /// Which rules to try: by name, by path, and `*.ext` by `ext`. With folding: keys in upper case, ASCII rules only.
    by_name: Places,
    by_path: Places,
    /// How long the longest key of `by_path` is.
    longest_path: usize,
    by_extension: Places,
    /// Those that start with a name and a `/`, by that name.
    by_first_name: Places,
    /// Where the others are.
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

/// `.. x/ $`: that `/` is the one that tells a directory, so the rule is for directories only, and for the path as it is.
fn split_final_slash(line: Line) -> Line {
    let mut nodes = match simplify(line.node) {
        Node::Seq(nodes) if !line.is_for_directories => nodes,
        node => return Line { node, ..line },
    };
    let mut is_for_directories = false;
    if let [.., Node::Lit(before), Node::Assert(Assertion::End)] = &mut nodes[..]
        && before.ends_with(b"/")
    {
        before.pop();
        is_for_directories = true;
    }
    Line {
        node: Node::Seq(nodes),
        is_for_directories,
        ..line
    }
}

impl IgnoreRules {
    fn new(options: IgnoreOptions) -> IgnoreRules {
        IgnoreRules {
            options,
            text: read_ignore::text_for(options),
            rules: Vec::new(),
            refused: Vec::new(),
            by_name: Places::new(),
            by_path: Places::new(),
            longest_path: 0,
            by_extension: Places::new(),
            by_first_name: Places::new(),
            others: Vec::new(),
            has_exceptions: false,
        }
    }

    /// The npm flavours tell a directory by a `/` behind the path, and a class or a `.+` of theirs can take that `/`.
    fn tells_directories_by_slash(&self) -> bool {
        use IgnoreSyntax::{Npm5, Npm705, Npm7012};
        matches!(self.options.syntax, Npm5 | Npm705 | Npm7012)
    }

    fn add_line(&mut self, line: &[u8]) {
        let read = match read_ignore::line(line, self.options) {
            Ok(Some(read)) if self.tells_directories_by_slash() => split_final_slash(read),
            Ok(Some(read)) => read,
            Ok(None) => return,
            Err(why) => {
                return self.refused.push(Refused {
                    line: line.into(),
                    why: why.into(),
                });
            }
        };
        let node = simplify(read.node);
        let tail = Tail::of(&node, self.text);
        let program = lower(node, self.text);
        // What can match nothing says nothing.
        if program.is_never() {
            return;
        }
        let at = self.rules.len() as u32;
        let place = match program.shape() {
            Shape::Name(name) => Some((&mut self.by_name, name)),
            Shape::Extension(extension) => Some((&mut self.by_extension, extension)),
            Shape::Path(path) => Some((&mut self.by_path, path)),
            Shape::Under(first) => Some((&mut self.by_first_name, first)),
            Shape::Other => None,
        };
        if let Shape::Path(path) = program.shape() {
            self.longest_path = self.longest_path.max(path.len());
        }
        match place {
            Some((places, key)) => {
                bun_core::handle_oom(places.get_or_put_value(key, Vec::new())).push(at);
            }
            None => self.others.push(at),
        }
        self.has_exceptions |= read.is_negated;
        self.rules.push(Rule {
            program,
            tail,
            is_negated: read.is_negated,
            is_for_directories: read.is_for_directories,
        });
    }

    /// The text of a file: lines, `\r`, a byte order mark, comments.
    pub fn from_text(text: &[u8], options: IgnoreOptions) -> IgnoreRules {
        let mut rules = IgnoreRules::new(options);
        // git and the crate drop it at the start of the file. The package drops it at the start of any line, which `read_ignore` does.
        let mut rest = match rules.tells_directories_by_slash() {
            true => text,
            false => text.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(text),
        };
        while !rest.is_empty() {
            let (line, has_line_feed) = match strings::index_of_char_usize(rest, b'\n') {
                Some(end) => {
                    let line = &rest[..end];
                    rest = &rest[end + 1..];
                    (line, true)
                }
                None => (std::mem::take(&mut rest), false),
            };
            // `\r\n`
            rules.add_line(match line.strip_suffix(b"\r") {
                Some(line) if has_line_feed => line,
                _ => line,
            });
        }
        rules
    }

    /// The elements of an array. A byte order mark is what the flavour makes of it there.
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

    pub fn refused(&self) -> &[Refused] {
        &self.refused
    }

    /// The last of `found` that matches and is behind `best`, or else `best`. `name_at`: where the last name of `path` starts.
    fn look(
        &self,
        found: Option<&[u32]>,
        best: Option<u32>,
        (path, name_at): (&[u8], usize),
        is_directory: bool,
    ) -> Option<u32> {
        let by_slash = self.tells_directories_by_slash();
        // Those before the best so far say nothing.
        let later = found.unwrap_or_default().iter().rev();
        let mut later = later.take_while(|at| Some(**at) > best);
        let matches = |at: &&u32| {
            let rule = self.rules.get(**at as usize);
            rule.filter(|it| is_directory || !it.is_for_directories)
                .is_some_and(|rule| {
                    let whole = || {
                        rule.program.matches(Subject {
                            bytes: path,
                            slash: is_directory && !rule.is_for_directories && by_slash,
                        })
                    };
                    let by_tail = rule.tail.as_ref().map(|it| it.matches(path, name_at));
                    debug_assert!(by_tail.is_none_or(|it| it == whole()));
                    by_tail.unwrap_or_else(whole)
                })
        };
        later.find(matches).copied().or(best)
    }

    /// The last rule that matches.
    fn last_match(&self, path: &[u8], is_directory: bool) -> Option<&Rule> {
        let mut folded: SmallVec<[u8; 256]> = SmallVec::new();
        let key = match self.text.folds {
            true => {
                folded.extend_from_slice(path);
                folded.make_ascii_uppercase();
                &folded[..]
            }
            false => path,
        };
        let name_at = strings::last_index_of_char(key, b'/').map_or(0, |it| it + 1);
        let name = &key[name_at..];
        let extension = strings::last_index_of_char(name, b'.').map(|dot| &name[dot + 1..]);
        let first_len = || strings::index_of_char_usize(key, b'/').unwrap_or(key.len());
        let first = (!self.by_first_name.is_empty()).then(|| &key[..first_len()]);
        let mut best = None;
        for found in [
            places(&self.by_name, name),
            match key.len() <= self.longest_path {
                true => places(&self.by_path, key),
                false => None,
            },
            extension.and_then(|it| places(&self.by_extension, it)),
            first.and_then(|it| places(&self.by_first_name, it)),
            Some(&self.others[..]),
        ] {
            best = self.look(found, best, (path, name_at), is_directory);
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
        let has_empty_name = path.starts_with(b"/") || strings::contains(path, b"//");
        if self.options.syntax == IgnoreSyntax::Npm5 || !has_empty_name {
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
        } else {
            // Empty names are left out of the directories.
            let mut names = strings::split(path, b"/")
                .filter(|it| !it.is_empty())
                .peekable();
            let mut parent = Vec::with_capacity(path.len());
            while let Some(name) = names.next().filter(|_| names.peek().is_some()) {
                if !parent.is_empty() {
                    parent.push(b'/');
                }
                parent.extend_from_slice(name);
                if is_ignored(&parent, true) {
                    return true;
                }
            }
        }
        match path.strip_suffix(b"/") {
            Some(directory) => is_ignored(directory, true),
            None => is_ignored(path, false),
        }
    }

    /// Whether a line with `!` can match something in `directory`. Never `false` if one can.
    pub fn may_keep_inside(&self, directory: &[u8]) -> bool {
        let subject = Subject {
            bytes: directory,
            slash: true,
        };
        self.has_exceptions
            && self
                .rules
                .iter()
                .any(|rule| rule.is_negated && rule.program.may_match_inside(subject))
    }
}
