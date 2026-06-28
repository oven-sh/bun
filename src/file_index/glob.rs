//! Glob matching over the indexed paths (no filesystem I/O).

use bun_glob::matcher;

use crate::store::{FileId, Store};

/// Live entries under `cwd_prefix` whose path *relative to it* matches
/// `pattern`, in path order (`Bun.Glob`'s `cwd` semantics).
///
/// `cwd_prefix` is `b""` (the whole store) or a `/`-terminated directory
/// prefix; the pattern is matched against `path[cwd_prefix.len()..]`. The
/// pattern's literal prefix (everything before the first glob metacharacter)
/// further narrows the candidate set via the store's sorted order before the
/// real matcher runs.
pub fn glob(store: &Store, pattern: &[u8], cwd_prefix: &[u8]) -> Vec<FileId> {
    let mut range_prefix = cwd_prefix.to_vec();
    range_prefix.extend_from_slice(literal_prefix(pattern));
    store
        .range_with_prefix(&range_prefix)
        .filter(|&id| matcher::r#match(pattern, &store.path(id)[cwd_prefix.len()..]).matches())
        .collect()
}

/// The leading bytes of `pattern` that every match must share verbatim.
///
/// Glob matching is left-anchored, so bytes before the first metacharacter
/// (`*` `?` `[` `{` `\` and a leading `!`, which negates the whole pattern)
/// are a plain string prefix of every matching path. Stopping at `!` and `\`
/// anywhere is conservative: it only costs narrowing, never correctness.
fn literal_prefix(pattern: &[u8]) -> &[u8] {
    if pattern.first() == Some(&b'!') {
        return b"";
    }
    let end = pattern
        .iter()
        .position(|&b| matches!(b, b'*' | b'?' | b'[' | b'{' | b'\\' | b'!'))
        .unwrap_or(pattern.len());
    &pattern[..end]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{EntryKind, Meta};

    const PATHS: &[&[u8]] = &[
        b"README.md",
        b"src/index.ts",
        b"src/server/index.ts",
        b"src/server/util.ts",
        b"srclike/index.ts",
        b"test/index.test.ts",
        b"a.tsx",
    ];

    fn store() -> Store {
        let mut s = Store::new(1 << 22);
        for p in PATHS {
            let kind = if p.ends_with(b"/") {
                EntryKind::Dir
            } else {
                EntryKind::File
            };
            s.upsert(
                p,
                Meta {
                    kind,
                    ..Meta::default()
                },
            )
            .unwrap();
        }
        s
    }

    fn glob_paths(store: &Store, pattern: &[u8]) -> Vec<Vec<u8>> {
        glob(store, pattern, b"")
            .into_iter()
            .map(|id| store.path(id).to_vec())
            .collect()
    }

    /// Matching paths *relative to `cwd`*, like the JS API returns them.
    fn glob_under(store: &Store, pattern: &[u8], cwd: &[u8]) -> Vec<Vec<u8>> {
        glob(store, pattern, cwd)
            .into_iter()
            .map(|id| store.path(id)[cwd.len()..].to_vec())
            .collect()
    }

    #[test]
    fn literal_prefix_extraction() {
        assert_eq!(literal_prefix(b"src/**/*.ts"), b"src/");
        assert_eq!(literal_prefix(b"src/index.ts"), b"src/index.ts");
        assert_eq!(literal_prefix(b"*.ts"), b"");
        assert_eq!(literal_prefix(b"a/{b,c}/d"), b"a/");
        assert_eq!(literal_prefix(b"a/b[0-9]"), b"a/b");
        assert_eq!(literal_prefix(b"!src/**"), b"");
        assert_eq!(literal_prefix(b"a/\\*lit"), b"a/");
        assert_eq!(literal_prefix(b""), b"");
    }

    #[test]
    fn matches_recursive_star_star() {
        let s = store();
        assert_eq!(
            glob_paths(&s, b"src/**/*.ts"),
            vec![
                b"src/index.ts".to_vec(),
                b"src/server/index.ts".to_vec(),
                b"src/server/util.ts".to_vec()
            ]
        );
        // The "srclike/" entries do not sneak in via the "src" prefix.
        assert_eq!(glob_paths(&s, b"src*/index.ts").len(), 2);
    }

    #[test]
    fn single_star_does_not_cross_separators() {
        let s = store();
        assert_eq!(glob_paths(&s, b"*/index.ts").len(), 2); // src/, srclike/
        assert_eq!(glob_paths(&s, b"*.md"), vec![b"README.md".to_vec()]);
    }

    #[test]
    fn exact_literal_pattern_matches_only_itself() {
        let s = store();
        assert_eq!(
            glob_paths(&s, b"src/index.ts"),
            vec![b"src/index.ts".to_vec()]
        );
        assert!(glob_paths(&s, b"src/index").is_empty());
    }

    #[test]
    fn braces_and_classes() {
        let s = store();
        assert_eq!(
            glob_paths(&s, b"**/*.{tsx,md}"),
            vec![b"README.md".to_vec(), b"a.tsx".to_vec()]
        );
        assert_eq!(glob_paths(&s, b"?.tsx"), vec![b"a.tsx".to_vec()]);
        assert_eq!(glob_paths(&s, b"[ab].tsx"), vec![b"a.tsx".to_vec()]);
    }

    #[test]
    fn negated_pattern_matches_the_complement() {
        let s = store();
        let got = glob_paths(&s, b"!src/**");
        assert!(got.contains(&b"README.md".to_vec()));
        assert!(got.contains(&b"srclike/index.ts".to_vec()));
        assert!(!got.iter().any(|p| p.starts_with(b"src/")));
    }

    #[test]
    fn cwd_prefix_rebases_the_pattern_and_narrows_the_candidates() {
        let s = store();
        // The pattern is interpreted relative to `cwd`: `*.ts` means
        // "directly inside src/", `**/*.ts` means "anywhere under it".
        assert_eq!(glob_under(&s, b"*.ts", b"src/"), vec![b"index.ts".to_vec()]);
        assert_eq!(
            glob_under(&s, b"**/*.ts", b"src/"),
            vec![
                b"index.ts".to_vec(),
                b"server/index.ts".to_vec(),
                b"server/util.ts".to_vec()
            ]
        );
        assert_eq!(
            glob_under(&s, b"index.ts", b"src/server/"),
            vec![b"index.ts".to_vec()]
        );
        // "src/" does not leak into "srclike/".
        assert!(!glob_under(&s, b"**/*", b"src/").contains(&b"index.ts/".to_vec()));
        assert_eq!(glob_under(&s, b"**/*", b"src/").len(), 3);
        // A prefix nothing starts with matches nothing.
        assert!(glob_under(&s, b"**/*", b"nope/").is_empty());
    }

    #[test]
    fn no_matches_and_removed_entries() {
        let mut s = store();
        assert!(glob_paths(&s, b"nope/**").is_empty());
        assert!(s.remove(b"README.md"));
        assert!(glob_paths(&s, b"*.md").is_empty());
    }
}
