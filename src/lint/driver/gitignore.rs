//! `.gitignore` and the files in its format. ESLint does not read them. oxlint does, so they count
//! where an `.oxlintrc.json` is the configuration.

use crate::{fs, paths};
use bun_core::strings;
use bun_lint::linter::Glob;
use std::sync::Arc;

enum Matcher {
    /// `name`, `name/`: whatever is called so, in any directory.
    Name(Vec<u8>),
    /// `*.ext`: whatever ends so, in any directory.
    Suffix(Vec<u8>),
    Pattern(Glob),
}

struct Pattern {
    matcher: Matcher,
    /// It starts with `!`: what it matches is not ignored after all.
    is_negated: bool,
    /// It ends with `/`.
    is_for_directories: bool,
}

/// `convertIgnorePatternToMinimatch` of `@eslint/compat`, without the `!`.
fn to_minimatch(pattern: &[u8]) -> Vec<u8> {
    if matches!(pattern, b"" | b"**" | b"/**" | b"**/") {
        return pattern.to_vec();
    }
    let first_slash = strings::index_of_char_usize(pattern, b'/');
    let everywhere: &[u8] = match first_slash {
        Some(at) if at + 1 < pattern.len() => b"",
        _ => b"**/",
    };
    let without_slash = pattern.strip_prefix(b"/").unwrap_or(pattern);
    // Braces and parentheses mean nothing here.
    let mut escaped = Vec::with_capacity(without_slash.len());
    let mut at = 0;
    while let Some(&byte) = without_slash.get(at) {
        if byte == b'\\' && at + 1 < without_slash.len() {
            escaped.extend_from_slice(&without_slash[at..at + 2]);
            at += 2;
            continue;
        }
        if matches!(byte, b'{' | b'(') {
            escaped.push(b'\\');
        }
        escaped.push(byte);
        at += 1;
    }
    let inside: &[u8] = if pattern.ends_with(b"/**") { b"/*" } else { b"" };
    [everywhere, &escaped, inside].concat()
}

impl Pattern {
    fn new(line: &[u8]) -> Pattern {
        let (is_negated, pattern) = match line.strip_prefix(b"!") {
            Some(rest) => (true, rest),
            None => (false, line),
        };
        let pattern = pattern.trim_ascii_end();
        let name = pattern.strip_suffix(b"/").unwrap_or(pattern);
        let is_plain = |text: &[u8]| !text.is_empty() && strings::index_of_any(text, b"/*?[]\\{}()!").is_none();
        let matcher = match name {
            name if is_plain(name) => Matcher::Name(name.to_vec()),
            [b'*', suffix @ ..] if is_plain(suffix) => Matcher::Suffix(suffix.to_vec()),
            _ => Matcher::Pattern(Glob::new(&to_minimatch(pattern))),
        };
        Pattern {
            matcher,
            is_negated,
            is_for_directories: name.len() < pattern.len(),
        }
    }

    /// `relative`: from the directory of the file that has the pattern, with a `/` at the end if
    /// it is a directory.
    fn matches(&self, relative: &[u8], is_directory: bool) -> bool {
        let name = || paths::basename(relative.strip_suffix(b"/").unwrap_or(relative));
        match &self.matcher {
            _ if self.is_for_directories && !is_directory => false,
            Matcher::Name(wanted) => name() == &wanted[..],
            Matcher::Suffix(suffix) => name().ends_with(suffix),
            Matcher::Pattern(glob) => glob.matches(relative),
        }
    }
}

/// The ignore files that count in a directory: those in it, and those above it.
pub(crate) struct Ignores {
    /// What the patterns are relative to.
    directory: Vec<u8>,
    patterns: Vec<Pattern>,
    above: Option<Arc<Ignores>>,
}

pub(crate) type Chain = Option<Arc<Ignores>>;

fn with_text(chain: Chain, directory: &[u8], text: &[u8]) -> Chain {
    let lines = strings::split(text, b"\n").map(|line| line.strip_suffix(b"\r").unwrap_or(line));
    let patterns: Vec<Pattern> = lines
        .filter(|line| !line.trim_ascii().is_empty() && !line.starts_with(b"#"))
        .map(Pattern::new)
        .collect();
    if patterns.is_empty() {
        return chain;
    }
    Some(Arc::new(Ignores {
        directory: directory.to_vec(),
        patterns,
        above: chain,
    }))
}

/// `chain` and the file at `path`, whose patterns are relative to `directory`.
pub(crate) fn with_file(chain: Chain, directory: &[u8], path: &[u8]) -> Chain {
    match fs::read(path) {
        Ok(text) => with_text(chain, directory, &text),
        Err(_) => chain,
    }
}

/// The names of the ignore files of a directory, the one that overrides the other last.
pub(crate) const NAMES: [&[u8]; 2] = [b".gitignore", b".eslintignore"];

/// What counts in `directory`, which is where a search starts: the files in it and above it, up to
/// the root of the repository.
pub(crate) fn above_and_in(directory: &[u8]) -> Chain {
    let is_root = |directory: &&[u8]| [&b".git"[..], b".jj"].iter().any(|name| bun_sys::exists(&paths::join(directory, name)));
    let mut directories: Vec<&[u8]> = paths::ancestors(directory).collect();
    // Outside of a repository, all the way up.
    if let Some(root) = directories.iter().position(|it| is_root(it)) {
        directories.truncate(root + 1);
    }
    let mut chain = None;
    if let Some(root) = directories.last() {
        chain = with_file(chain, root, &paths::join(root, b".git/info/exclude"));
    }
    for directory in directories.iter().rev() {
        for name in NAMES {
            chain = with_file(chain, directory, &paths::join(directory, name));
        }
    }
    chain
}

/// Whether `path` is ignored, if the directory that it is in is not. The nearest file that says
/// anything about it decides, and in that file the last pattern.
pub(crate) fn is_ignored(chain: &Chain, path: &[u8], is_directory: bool) -> bool {
    let mut next = chain.as_ref();
    let mut relative = Vec::new();
    while let Some(ignores) = next {
        if let Some(inside) = paths::inside(&ignores.directory, path) {
            relative.clear();
            relative.extend_from_slice(inside);
            if is_directory {
                relative.push(b'/');
            }
            if let Some(pattern) = ignores.patterns.iter().rev().find(|it| it.matches(&relative, is_directory)) {
                return !pattern.is_negated;
            }
        }
        next = ignores.above.as_ref();
    }
    false
}
