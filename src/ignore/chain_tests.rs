//! Tests for [`IgnoreChain`] structure and precedence (file-stack semantics).

use crate::{IgnoreChain, IgnoreFile, Match};

fn file(base: &[u8], contents: &[u8]) -> IgnoreFile {
    IgnoreFile::parse(base, contents)
}

#[test]
fn empty_chain_matches_nothing() {
    let chain = IgnoreChain::empty();
    assert!(chain.is_empty());
    assert_eq!(chain.len(), 0);
    assert_eq!(chain.memory_cost(), 0);
    assert_eq!(chain.matches(b"anything", false), Match::None);
    assert_eq!(chain.matches(b"a/b/c", true), Match::None);
    assert!(!chain.is_ignored(b"a/b/c", false));
    // The index root itself is never matched.
    assert_eq!(chain.matches(b"", true), Match::None);
    assert!(!chain.is_ignored(b"", true));
}

#[test]
fn append_is_persistent_and_does_not_affect_clones() {
    let root = IgnoreChain::empty().append(file(b"", b"*.log\n"));
    let before = root.clone();
    let deeper = root.append(file(b"sub", b"!keep.log\n"));

    assert_eq!(root.len(), 1);
    assert_eq!(before.len(), 1);
    assert_eq!(deeper.len(), 2);

    // The negation only exists in the deeper chain.
    assert_eq!(root.matches(b"sub/keep.log", false), Match::Ignore);
    assert_eq!(before.matches(b"sub/keep.log", false), Match::Ignore);
    assert_eq!(deeper.matches(b"sub/keep.log", false), Match::Whitelist);

    // Appending two different children to the same parent is fine
    // (persistent linked list, not a mutable stack).
    let other = root.append(file(b"other", b"!keep.log\n"));
    assert_eq!(other.matches(b"other/keep.log", false), Match::Whitelist);
    assert_eq!(other.matches(b"sub/keep.log", false), Match::Ignore);
    assert_eq!(deeper.matches(b"sub/keep.log", false), Match::Whitelist);
}

#[test]
fn deeper_file_wins_over_shallower() {
    let chain = IgnoreChain::empty()
        .append(file(b"", b"*.log\n"))
        .append(file(b"a", b"!debug.log\n"))
        .append(file(b"a/b", b"debug.log\n"));
    // Decided by a/b/.gitignore.
    assert_eq!(chain.matches(b"a/b/debug.log", false), Match::Ignore);
    // a/b/.gitignore does not apply outside a/b; a/.gitignore wins.
    assert_eq!(chain.matches(b"a/debug.log", false), Match::Whitelist);
    // Only the root file applies at the root.
    assert_eq!(chain.matches(b"debug.log", false), Match::Ignore);
    // The deeper files say nothing about other.log, so the root decides.
    assert_eq!(chain.matches(b"a/other.log", false), Match::Ignore);
    assert_eq!(chain.matches(b"a/b/other.log", false), Match::Ignore);
    assert_eq!(chain.matches(b"README.md", false), Match::None);
}

#[test]
fn shallower_file_decides_when_deeper_files_say_nothing() {
    let chain = IgnoreChain::empty()
        .append(file(b"", b"node_modules/\n"))
        .append(file(b"pkg", b"dist/\n"));
    assert_eq!(chain.matches(b"pkg/node_modules", true), Match::Ignore);
    assert_eq!(chain.matches(b"pkg/dist", true), Match::Ignore);
    assert_eq!(chain.matches(b"node_modules", true), Match::Ignore);
    // pkg/.gitignore's anchored `dist/` does not apply at the root.
    assert_eq!(chain.matches(b"dist", true), Match::None);
}

#[test]
fn chain_for_one_directory_is_reusable_for_unrelated_paths() {
    // A node whose base does not contain the queried path is skipped, so a
    // chain built for `a/b` gives the same answers as the chain for `c` on
    // paths under `c` (only the applicable suffix differs).
    let deep = IgnoreChain::empty()
        .append(file(b"", b"*.o\n"))
        .append(file(b"a", b"lib/\n"))
        .append(file(b"a/b", b"!x.o\n"));
    assert_eq!(deep.matches(b"c/x.o", false), Match::Ignore);
    assert_eq!(deep.matches(b"a/lib", true), Match::Ignore);
    assert_eq!(deep.matches(b"c/lib", true), Match::None);
    assert_eq!(deep.matches(b"a/b/x.o", false), Match::Whitelist);
    assert_eq!(deep.matches(b"a/x.o", false), Match::Ignore);
}

#[test]
fn is_ignored_applies_the_excluded_parent_rule() {
    // gitignore(5): "It is not possible to re-include a file if a parent
    // directory of that file is excluded."
    let chain = IgnoreChain::empty().append(file(b"", b"node_modules/\n!b.js\n"));
    assert_eq!(
        chain.matches(b"node_modules/a/b.js", false),
        Match::Whitelist
    );
    assert!(chain.is_ignored(b"node_modules/a/b.js", false));
    assert!(chain.is_ignored(b"node_modules/a", true));
    assert!(chain.is_ignored(b"node_modules", true));
    assert!(!chain.is_ignored(b"b.js", false));
    assert!(!chain.is_ignored(b"src/b.js", false));

    // A deeper ignore file cannot resurrect anything below the excluded dir
    // either (git never even reads .gitignore files inside excluded dirs).
    let deeper = chain.append(file(b"node_modules/a", b"!b.js\n!*\n"));
    assert!(deeper.is_ignored(b"node_modules/a/b.js", false));
}

#[test]
fn is_ignored_with_whitelisted_parent_still_checks_the_leaf() {
    let chain = IgnoreChain::empty().append(file(b"", b"*.log\n!important/\n"));
    // The parent dir is re-included, but the file still matches `*.log`.
    assert!(!chain.is_ignored(b"important", true));
    assert!(chain.is_ignored(b"important/x.log", false));
    assert!(!chain.is_ignored(b"important/x.txt", false));
}

#[test]
fn is_ignored_equals_matches_when_no_ancestor_is_involved() {
    let chain = IgnoreChain::empty().append(file(b"", b"*.o\n!keep.o\n"));
    for (path, is_dir) in [
        (b"x.o".as_slice(), false),
        (b"keep.o", false),
        (b"dir", true),
    ] {
        assert_eq!(
            chain.is_ignored(path, is_dir),
            chain.matches(path, is_dir) == Match::Ignore,
            "{path:?}"
        );
    }
}

#[test]
fn memory_cost_and_len_grow_with_appends() {
    let one = IgnoreChain::empty().append(file(b"", b"a\n"));
    let two = one.append(file(b"d", b"bbbbbbbbbbbbbbbb\n"));
    assert_eq!(one.len(), 1);
    assert_eq!(two.len(), 2);
    assert!(two.memory_cost() > one.memory_cost());
    assert!(!two.is_empty());
}

#[test]
fn long_chain_deep_nesting() {
    // 64 nested directories, each with its own ignore file; the deepest
    // negation must win and ancestor checks must stay correct.
    let mut chain = IgnoreChain::empty().append(file(b"", b"*.tmp\n"));
    let mut dir: Vec<u8> = Vec::new();
    for i in 0..64u32 {
        if !dir.is_empty() {
            dir.push(b'/');
        }
        dir.extend_from_slice(format!("d{i}").as_bytes());
        let contents = if i == 63 {
            b"!keep.tmp\n".as_slice()
        } else {
            b""
        };
        chain = chain.append(IgnoreFile::parse(&dir, contents));
    }
    assert_eq!(chain.len(), 65);
    let mut deep_path = dir.clone();
    deep_path.extend_from_slice(b"/keep.tmp");
    assert_eq!(chain.matches(&deep_path, false), Match::Whitelist);
    let mut other = dir.clone();
    other.extend_from_slice(b"/x.tmp");
    assert_eq!(chain.matches(&other, false), Match::Ignore);
    assert!(!chain.is_ignored(&deep_path, false));
    assert!(chain.is_ignored(&other, false));
}
