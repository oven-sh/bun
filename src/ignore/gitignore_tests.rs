//! Whole-engine gitignore evaluation over a virtual tree, modeled on
//! git.git `t/t0008-ignores.sh` (`git check-ignore`), plus one test per
//! rule in gitignore(5) "PATTERN FORMAT".

use bstr::BStr;

use crate::{IgnoreChain, IgnoreFile, Match};

/// A virtual worktree: a list of `(directory, .gitignore contents)` pairs.
/// `chain_for` mirrors what a real directory walker maintains: the stack of
/// ignore files from the root down to one directory.
struct Tree<'a> {
    files: Vec<(&'a [u8], &'a [u8])>,
}

impl<'a> Tree<'a> {
    fn new(mut files: Vec<(&'a [u8], &'a [u8])>) -> Tree<'a> {
        // Shallowest first; the chain is built root -> deep.
        files.sort_by_key(|(base, _)| base.len());
        Tree { files }
    }

    fn chain_for(&self, dir: &[u8]) -> IgnoreChain {
        let mut chain = IgnoreChain::empty();
        for (base, contents) in &self.files {
            let applies = base.is_empty()
                || *base == dir
                || (dir.len() > base.len() && dir.starts_with(base) && dir[base.len()] == b'/');
            if applies {
                chain = chain.append(IgnoreFile::parse(base, contents));
            }
        }
        chain
    }

    fn chain_for_parent_of(&self, path: &[u8]) -> IgnoreChain {
        let dir = match memchr::memrchr(b'/', path) {
            Some(i) => &path[..i],
            None => b"",
        };
        self.chain_for(dir)
    }

    fn matches(&self, path: &[u8], is_dir: bool) -> Match {
        self.chain_for_parent_of(path).matches(path, is_dir)
    }

    fn is_ignored(&self, path: &[u8], is_dir: bool) -> bool {
        self.chain_for_parent_of(path).is_ignored(path, is_dir)
    }

    #[track_caller]
    fn assert_ignored(&self, expect: bool, path: &[u8], is_dir: bool) {
        assert_eq!(
            self.is_ignored(path, is_dir),
            expect,
            "path {:?} (is_dir: {is_dir})",
            BStr::new(path),
        );
    }
}

/// The t0008-ignores.sh fixture tree (its `.gitignore` files verbatim).
fn t0008_tree() -> Tree<'static> {
    Tree::new(vec![
        (b"".as_slice(), b"one\nignored-*\ntop-level-dir/\n".as_slice()),
        (b"a", b"two*\n*three\n"),
        (
            b"a/b",
            b"four\nfive\n# this comment should affect the line numbers\nsix\nignored-dir/\n# and so should this blank line:\n\n!on*\n!two\n",
        ),
        (b"a/b/ignored-dir", b"seven\n"),
    ])
}

#[test]
fn t0008_basic_and_subdir_results() {
    let t = t0008_tree();
    // Section "test standard ignores" of t0008-ignores.sh: `git check-ignore`
    // exit codes for paths at the top level and under a/.
    for prefix in ["", "a/"] {
        let p = |name: &str| format!("{prefix}{name}").into_bytes();
        t.assert_ignored(false, &p("non-existent"), false);
        t.assert_ignored(true, &p("one"), false);
        t.assert_ignored(false, &p("not-ignored"), false);
        t.assert_ignored(true, &p("ignored-and-untracked"), false);
        t.assert_ignored(true, &p("ignored-but-in-index"), false);
    }
    // "sub-directory local ignore": a/.gitignore `*three`.
    t.assert_ignored(true, b"a/3-three", false);
    t.assert_ignored(false, b"a/three-not-this-one", false);
    // a/.gitignore `two*` applies below a/ as a basename pattern.
    t.assert_ignored(true, b"a/two", false);
    t.assert_ignored(true, b"a/b/twooo", false);
    // Patterns from a/ never apply at the root or in siblings.
    t.assert_ignored(false, b"twooo", false);
    t.assert_ignored(false, b"3-three", false);
    t.assert_ignored(false, b"b/twooo", false);
}

#[test]
fn t0008_nested_negation_deepest_file_wins() {
    let t = t0008_tree();
    // "nested include of negated pattern": a/b/.gitignore `!on*` overrides
    // the root's `one` for paths under a/b.
    t.assert_ignored(false, b"a/b/on", false);
    t.assert_ignored(false, b"a/b/one", false);
    t.assert_ignored(false, b"a/b/one one", false);
    t.assert_ignored(false, b"a/b/one\"three", false);
    t.assert_ignored(false, b"a/b/c/one", false);
    // ... but not elsewhere.
    t.assert_ignored(true, b"one", false);
    t.assert_ignored(true, b"a/one", false);
    // `!two` only re-includes the exact basename `two`; `two*` still wins
    // for `twooo` because a/b/.gitignore has no line matching it.
    t.assert_ignored(false, b"a/b/two", false);
    t.assert_ignored(true, b"a/b/twooo", false);
    // a/b/.gitignore's own plain patterns.
    t.assert_ignored(true, b"a/b/four", false);
    t.assert_ignored(true, b"a/b/six", false);
    t.assert_ignored(false, b"a/b/seven", false);
}

#[test]
fn t0008_ignored_directory_and_everything_under_it() {
    let t = t0008_tree();
    t.assert_ignored(true, b"a/b/ignored-dir", true);
    // As a plain file it is still ignored, but only because the root's
    // `ignored-*` matches; the dir-only `ignored-dir/` line does not.
    t.assert_ignored(true, b"a/b/ignored-dir", false);
    assert_eq!(
        t.chain_for(b"a/b").matches(b"a/b/ignored-dir", false),
        Match::Ignore
    );
    // Everything inside is ignored via the excluded-parent rule, including
    // paths whitelisted by deeper files and paths matching nothing.
    for name in [b"foo".as_slice(), b"twoooo", b"seven", b"on", b"one"] {
        let path = [b"a/b/ignored-dir/".as_slice(), name].concat();
        t.assert_ignored(true, &path, false);
    }
    t.assert_ignored(true, b"a/b/ignored-dir/deeper/nesting/x", false);
    // The walker-style query (`matches`) assumes ancestors are clean and so
    // does NOT see the directory exclusion; only `is_ignored` does. Inside
    // the ignored dir, `!on*` from a/b/.gitignore still "wins" textually.
    assert_eq!(t.matches(b"a/b/ignored-dir/foo", false), Match::None);
    assert_eq!(t.matches(b"a/b/ignored-dir/one", false), Match::Whitelist);
    assert_eq!(t.matches(b"a/b/ignored-dir/seven", false), Match::Ignore);
}

#[test]
fn t0008_top_level_dir_only_pattern() {
    let t = t0008_tree();
    t.assert_ignored(true, b"top-level-dir", true);
    t.assert_ignored(false, b"top-level-dir", false);
    // A basename dir-only pattern in the root file applies at any depth.
    t.assert_ignored(true, b"a/top-level-dir", true);
    t.assert_ignored(true, b"a/top-level-dir/x", false);
}

// gitignore(5): "A blank line matches no files [...] A line starting with #
// serves as a comment. Put a backslash in front of the first hash for
// patterns that begin with a hash."
#[test]
fn comments_blanks_and_escaped_hash() {
    let t = Tree::new(vec![(
        b"".as_slice(),
        b"\n#comment\n   \n\\#literal\n\\!bang\nfoo\n".as_slice(),
    )]);
    t.assert_ignored(true, b"#literal", false);
    t.assert_ignored(false, b"comment", false);
    t.assert_ignored(true, b"!bang", false);
    t.assert_ignored(true, b"foo", false);
    t.assert_ignored(true, b"dir/#literal", false);
}

// gitignore(5): "Trailing spaces are ignored unless they are quoted with
// backslash."
#[test]
fn trailing_spaces_and_escaped_spaces() {
    let t = Tree::new(vec![(
        b"".as_slice(),
        b"spaced   \nkeep\\ \\ \n".as_slice(),
    )]);
    t.assert_ignored(true, b"spaced", false);
    t.assert_ignored(false, b"spaced   ", false);
    t.assert_ignored(true, b"keep  ", false);
    t.assert_ignored(false, b"keep", false);
}

// gitignore(5): "If there is a separator at the beginning or middle (or
// both) of the pattern, then the pattern is relative to the directory level
// of the particular .gitignore file itself. Otherwise the pattern may also
// match at any level below the .gitignore level."
#[test]
fn anchoring_rules() {
    let t = Tree::new(vec![
        (b"".as_slice(), b"basename\n/anchored\nmid/dle\n".as_slice()),
        (b"sub", b"/anchored-sub\nalso/mid\n"),
    ]);
    // No separator: matches at every depth below the file.
    for p in [b"basename".as_slice(), b"x/basename", b"x/y/basename"] {
        t.assert_ignored(true, p, false);
        t.assert_ignored(true, p, true);
    }
    // Leading separator: only directly at the file's level.
    t.assert_ignored(true, b"anchored", false);
    t.assert_ignored(false, b"x/anchored", false);
    // Middle separator: anchored, relative to the file's directory.
    t.assert_ignored(true, b"mid/dle", false);
    t.assert_ignored(false, b"x/mid/dle", false);
    // Same rules relative to sub/.gitignore.
    t.assert_ignored(true, b"sub/anchored-sub", false);
    t.assert_ignored(false, b"sub/x/anchored-sub", false);
    t.assert_ignored(true, b"sub/also/mid", false);
    t.assert_ignored(false, b"sub/x/also/mid", false);
    t.assert_ignored(false, b"also/mid", false);
}

// gitignore(5): "If there is a separator at the end of the pattern then the
// pattern will only match directories."
#[test]
fn dir_only_patterns() {
    let t = Tree::new(vec![(b"".as_slice(), b"build/\n/dist/\n".as_slice())]);
    t.assert_ignored(true, b"build", true);
    t.assert_ignored(false, b"build", false);
    t.assert_ignored(true, b"a/b/build", true);
    t.assert_ignored(true, b"a/b/build/output.o", false);
    t.assert_ignored(true, b"dist", true);
    t.assert_ignored(false, b"dist", false);
    t.assert_ignored(false, b"a/dist", true);
}

// gitignore(5) `**` rules.
#[test]
fn double_star_rules() {
    let t = Tree::new(vec![(
        b"".as_slice(),
        b"**/logs\nabc/**\nx/**/y\nlib/**/*.bak\n".as_slice(),
    )]);
    // "A leading ** followed by a slash means match in all directories."
    t.assert_ignored(true, b"logs", true);
    t.assert_ignored(true, b"a/logs", true);
    t.assert_ignored(true, b"a/b/logs", false);
    // "A trailing /** matches everything inside" but not the dir itself.
    t.assert_ignored(false, b"abc", true);
    t.assert_ignored(true, b"abc/x", false);
    t.assert_ignored(true, b"abc/d/e/f", false);
    // "A slash followed by two consecutive asterisks then a slash matches
    // zero or more directories."
    t.assert_ignored(true, b"x/y", false);
    t.assert_ignored(true, b"x/a/y", false);
    t.assert_ignored(true, b"x/a/b/y", false);
    t.assert_ignored(false, b"x/ay", false);
    t.assert_ignored(false, b"zx/y", false);
    t.assert_ignored(true, b"lib/a.bak", false);
    t.assert_ignored(true, b"lib/d/e/a.bak", false);
    t.assert_ignored(false, b"lib2/a.bak", false);
    // "Other consecutive asterisks are considered regular asterisks."
    let t2 = Tree::new(vec![(b"".as_slice(), b"a**b\n".as_slice())]);
    t2.assert_ignored(true, b"ab", false);
    t2.assert_ignored(true, b"aXXb", false);
    t2.assert_ignored(true, b"d/aXXb", false);
    t2.assert_ignored(false, b"a/b", false);
}

// gitignore(5) EXAMPLES: the `/*` + `!/foo` + `/foo/*` + `!/foo/bar` idiom.
#[test]
fn doc_example_exclude_everything_except_foo_bar() {
    let t = Tree::new(vec![(
        b"".as_slice(),
        b"# exclude everything except directory foo/bar\n/*\n!/foo\n/foo/*\n!/foo/bar\n".as_slice(),
    )]);
    t.assert_ignored(true, b"zap", false);
    t.assert_ignored(true, b"other", true);
    t.assert_ignored(false, b"foo", true);
    t.assert_ignored(true, b"foo/baz", false);
    t.assert_ignored(false, b"foo/bar", true);
    t.assert_ignored(false, b"foo/bar/x", false);
    t.assert_ignored(false, b"foo/bar/deep/er", false);
}

// gitignore(5) EXAMPLES: "doc/frotz" vs "frotz" anchoring, and
// "foo/*" not matching "foo/bar/baz" directly (but its parent is).
#[test]
fn doc_example_doc_frotz_and_star_depth() {
    // "The pattern doc/frotz/ matches doc/frotz directory, but not
    // a/doc/frotz directory; however frotz/ matches frotz and a/frotz that
    // is a directory" (relative to the .gitignore's own directory, here a/).
    let anchored = Tree::new(vec![(b"a", b"doc/frotz/\n".as_slice())]);
    anchored.assert_ignored(true, b"a/doc/frotz", true);
    anchored.assert_ignored(false, b"a/x/doc/frotz", true);
    anchored.assert_ignored(false, b"a/doc/frotz", false);
    let basename = Tree::new(vec![(b"a", b"frotz/\n".as_slice())]);
    basename.assert_ignored(true, b"a/frotz", true);
    basename.assert_ignored(true, b"a/x/frotz", true);
    basename.assert_ignored(false, b"frotz", true);

    let t = Tree::new(vec![(b"".as_slice(), b"foo/*\n".as_slice())]);
    assert_eq!(t.matches(b"foo/bar/baz", false), Match::None);
    t.assert_ignored(true, b"foo/bar", true);
    t.assert_ignored(true, b"foo/bar/baz", false);
    t.assert_ignored(false, b"foo", true);
}

// Character classes are wildmatch classes, not regexes; brace expansion is
// NOT gitignore syntax (`{a,b}` is literal).
#[test]
fn character_classes_and_no_brace_expansion() {
    let t = Tree::new(vec![(
        b"".as_slice(),
        b"*.[oa]\n[[:digit:]][[:digit:]].txt\nlib[!0-9].so\n{a,b}.txt\n".as_slice(),
    )]);
    t.assert_ignored(true, b"x.o", false);
    t.assert_ignored(true, b"x.a", false);
    t.assert_ignored(false, b"x.c", false);
    t.assert_ignored(true, b"42.txt", false);
    t.assert_ignored(false, b"4x.txt", false);
    t.assert_ignored(true, b"libX.so", false);
    t.assert_ignored(false, b"lib7.so", false);
    t.assert_ignored(true, b"{a,b}.txt", false);
    t.assert_ignored(false, b"a.txt", false);
    t.assert_ignored(false, b"b.txt", false);
}

// gitignore patterns and paths are bytes, not UTF-8.
#[test]
fn non_utf8_bytes_are_preserved() {
    let t = Tree::new(vec![(
        b"".as_slice(),
        b"caf\xc3\xa9\nlatin1-\xe9*\n".as_slice(),
    )]);
    t.assert_ignored(true, b"caf\xc3\xa9", false);
    t.assert_ignored(true, b"sub/caf\xc3\xa9", false);
    t.assert_ignored(false, b"cafe", false);
    t.assert_ignored(true, b"latin1-\xe9.txt", false);
    t.assert_ignored(false, b"latin1-X.txt", false);

    // Non-UTF-8 directory names participate in anchoring too.
    let t = Tree::new(vec![(b"\xff\xfe", b"/x\n".as_slice())]);
    t.assert_ignored(true, b"\xff\xfe/x", false);
    t.assert_ignored(false, b"\xff\xfe/d/x", false);
}

// CRLF .gitignore files: a trailing `\r` is stripped from each line.
#[test]
fn crlf_files() {
    let t = Tree::new(vec![(
        b"".as_slice(),
        b"alpha\r\nbeta\r\n!alpha\r\n".as_slice(),
    )]);
    t.assert_ignored(false, b"alpha", false);
    t.assert_ignored(true, b"beta", false);
    t.assert_ignored(false, b"alpha\r", false);
    let t = Tree::new(vec![(b"".as_slice(), b"\r\n".as_slice())]);
    t.assert_ignored(false, b"x", false);
}

// Negation interacting with the excluded-parent rule across files.
#[test]
fn negation_cannot_escape_an_excluded_parent() {
    let t = Tree::new(vec![
        (b"".as_slice(), b"node_modules/\n".as_slice()),
        (b"pkg", b"!node_modules/\n!important.js\n"),
    ]);
    // pkg/.gitignore re-includes its own node_modules directory: the
    // deepest matching file decides for the directory itself.
    t.assert_ignored(false, b"pkg/node_modules", true);
    assert_eq!(t.matches(b"pkg/node_modules", true), Match::Whitelist);
    // The root one stays excluded, and nothing under it can come back.
    t.assert_ignored(true, b"node_modules", true);
    t.assert_ignored(true, b"node_modules/pkg/important.js", false);
    t.assert_ignored(true, b"node_modules/important.js", false);
}

// A `.gitignore` never applies to its own directory: only files in ancestor
// directories can ignore it (dir.c prep_exclude checks a directory before
// reading the `.gitignore` inside it).
#[test]
fn ignore_file_does_not_apply_to_its_own_directory() {
    let t = Tree::new(vec![
        (b"".as_slice(), b"".as_slice()),
        (b"sub", b"sub\n/x\n"),
    ]);
    assert_eq!(t.chain_for(b"sub").matches(b"sub", true), Match::None);
    t.assert_ignored(false, b"sub", true);
    // ... but it does apply to a same-named child.
    t.assert_ignored(true, b"sub/sub", true);
    t.assert_ignored(true, b"sub/x", false);
    t.assert_ignored(false, b"x", false);
}

#[test]
fn pathological_inputs_terminate_and_never_panic() {
    // A hostile star-heavy pattern against a long component.
    let mut starry = Vec::new();
    for _ in 0..32 {
        starry.extend_from_slice(b"*a");
    }
    starry.push(b'\n');
    let mut contents = starry.clone();
    contents.extend_from_slice(b"deep/**/x\n");
    let t = Tree::new(vec![(b"".as_slice(), contents.as_slice())]);
    let mut long = vec![b'a'; 8 * 1024];
    long.push(b'b');
    t.assert_ignored(false, &long, false);
    long.pop();
    t.assert_ignored(true, &long, false);

    // Deeply nested path against `deep/**/x`.
    let mut deep = b"deep".to_vec();
    for _ in 0..512 {
        deep.extend_from_slice(b"/d");
    }
    deep.extend_from_slice(b"/x");
    t.assert_ignored(true, &deep, false);
    deep.extend_from_slice(b"y");
    t.assert_ignored(false, &deep, false);

    // 64 KiB single-line pattern.
    let mut big_line = vec![b'z'; 64 * 1024];
    big_line.push(b'\n');
    let t = Tree::new(vec![(b"".as_slice(), big_line.as_slice())]);
    t.assert_ignored(true, &big_line[..big_line.len() - 1], false);
    t.assert_ignored(false, b"zz", false);
}

#[test]
fn empty_inputs() {
    let t = Tree::new(vec![(b"".as_slice(), b"".as_slice())]);
    t.assert_ignored(false, b"anything", false);
    let empty = IgnoreFile::parse(b"", b"");
    assert!(empty.is_empty());
    assert_eq!(empty.len(), 0);
    let chain = IgnoreChain::empty().append(empty);
    assert_eq!(chain.matches(b"x", false), Match::None);
}
