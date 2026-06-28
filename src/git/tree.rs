//! Tree and commit object parsing, and HEAD-tree flattening.
//!
//! Format reference: `Documentation/gitformat-pack.txt` /
//! `Documentation/user-manual.txt` — a tree object body is a sequence of
//! `<octal mode> SP <name> NUL <20-byte oid>` records; a commit object body
//! begins with `tree <40-hex>\n`.

use crate::error::GitError;
use crate::oid::{OID_HEX_LEN, OID_RAW_LEN, Oid};

/// `S_IFMT`-style type mask used in git tree/index modes.
pub const MODE_TYPE_MASK: u32 = 0o170000;
/// Regular file (`S_IFREG`).
pub const MODE_FILE: u32 = 0o100000;
/// Directory / subtree (`S_IFDIR`).
pub const MODE_TREE: u32 = 0o040000;
/// Symbolic link (`S_IFLNK`).
pub const MODE_SYMLINK: u32 = 0o120000;
/// Submodule (gitlink). `Documentation/gitformat-index.txt`: `1110...`.
pub const MODE_GITLINK: u32 = 0o160000;

/// Hard ceiling on the number of paths a flattened tree may produce.
pub const MAX_TREE_ENTRIES: usize = 1 << 22;
/// Hard ceiling on tree nesting depth (a hostile self-referencing tree would
/// otherwise expand forever; git's own limit on tree depth is similar).
pub const MAX_TREE_DEPTH: usize = 256;
/// Hard ceiling on a single flattened path length.
const MAX_TREE_PATH_LEN: usize = 4096;

#[inline]
pub fn is_tree_mode(mode: u32) -> bool {
    mode & MODE_TYPE_MASK == MODE_TREE
}

#[inline]
pub fn is_gitlink_mode(mode: u32) -> bool {
    mode & MODE_TYPE_MASK == MODE_GITLINK
}

#[inline]
pub fn is_symlink_mode(mode: u32) -> bool {
    mode & MODE_TYPE_MASK == MODE_SYMLINK
}

/// One blob/symlink/gitlink in a recursively flattened tree, with its full
/// '/'-separated path relative to the tree root.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TreeEntry {
    pub path: Vec<u8>,
    pub oid: Oid,
    pub mode: u32,
}

/// One record of a single (non-recursive) tree object.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RawTreeEntry {
    pub(crate) mode: u32,
    pub(crate) name: Vec<u8>,
    pub(crate) oid: Oid,
}

/// Parse one tree object body. Names are validated to be non-empty and to
/// contain neither `/` nor NUL (they are single path components).
pub(crate) fn parse_tree(data: &[u8]) -> Result<Vec<RawTreeEntry>, GitError> {
    let mut out = Vec::new();
    let mut rest = data;
    while !rest.is_empty() {
        let sp = memchr::memchr(b' ', rest).ok_or(GitError::Corrupt("tree: missing space"))?;
        let mode = parse_octal_mode(&rest[..sp])?;
        rest = &rest[sp + 1..];
        let nul = memchr::memchr(0, rest).ok_or(GitError::Corrupt("tree: missing NUL"))?;
        let name = &rest[..nul];
        if name.is_empty() {
            return Err(GitError::Corrupt("tree: empty entry name"));
        }
        if memchr::memchr(b'/', name).is_some() {
            return Err(GitError::Corrupt("tree: '/' in entry name"));
        }
        rest = &rest[nul + 1..];
        if rest.len() < OID_RAW_LEN {
            return Err(GitError::Corrupt("tree: truncated object id"));
        }
        let mut raw = [0u8; OID_RAW_LEN];
        raw.copy_from_slice(&rest[..OID_RAW_LEN]);
        rest = &rest[OID_RAW_LEN..];
        out.push(RawTreeEntry {
            mode,
            name: name.to_vec(),
            oid: Oid(raw),
        });
    }
    Ok(out)
}

/// Git writes tree modes as up to 6 octal digits with no leading zeros
/// (`tree-walk.c:get_mode`). Bounded so it cannot overflow `u32`.
fn parse_octal_mode(s: &[u8]) -> Result<u32, GitError> {
    if s.is_empty() || s.len() > 7 {
        return Err(GitError::Corrupt("tree: bad mode"));
    }
    let mut mode: u32 = 0;
    for &c in s {
        if !(b'0'..=b'7').contains(&c) {
            return Err(GitError::Corrupt("tree: bad mode"));
        }
        mode = (mode << 3) | u32::from(c - b'0');
    }
    Ok(mode)
}

/// Extract the root tree oid from a commit object body: the first line must
/// be `tree <40-hex>` (`Documentation/gitformat-commit-header`).
pub(crate) fn parse_commit_tree(body: &[u8]) -> Result<Oid, GitError> {
    parse_object_header_line(body, b"tree ", "commit: tree header")
}

/// Extract the target oid from an annotated tag object body, whose first
/// line is `object <40-hex>`.
pub(crate) fn parse_tag_target(body: &[u8]) -> Result<Oid, GitError> {
    parse_object_header_line(body, b"object ", "tag: object header")
}

fn parse_object_header_line(
    body: &[u8],
    prefix: &'static [u8],
    what: &'static str,
) -> Result<Oid, GitError> {
    let rest = body.strip_prefix(prefix).ok_or(GitError::Corrupt(what))?;
    if rest.len() < OID_HEX_LEN + 1 || rest[OID_HEX_LEN] != b'\n' {
        return Err(GitError::Corrupt(what));
    }
    Oid::from_hex(&rest[..OID_HEX_LEN]).ok_or(GitError::Corrupt(what))
}

struct Frame {
    entries: Vec<RawTreeEntry>,
    next: usize,
    /// Length to truncate the shared path buffer back to when popping.
    parent_path_len: usize,
}

/// Recursively flatten a tree into a path-sorted, deduplicated list of
/// non-tree entries. `read_tree` is injected so the traversal is testable
/// without an object store; it must return the BODY of the tree object named
/// by the oid. Uses an explicit stack with hard depth/size limits — never
/// recursion on attacker-controlled depth.
pub fn flatten_tree(
    root: Oid,
    read_tree: &mut dyn FnMut(Oid, &mut Vec<u8>) -> Result<(), GitError>,
) -> Result<Vec<TreeEntry>, GitError> {
    let mut out: Vec<TreeEntry> = Vec::new();
    let mut body: Vec<u8> = Vec::new();
    read_tree(root, &mut body)?;
    let mut stack: Vec<Frame> = vec![Frame {
        entries: parse_tree(&body)?,
        next: 0,
        parent_path_len: 0,
    }];
    let mut path: Vec<u8> = Vec::new();

    loop {
        let depth = stack.len();
        let Some(frame) = stack.last_mut() else { break };
        if frame.next >= frame.entries.len() {
            path.truncate(frame.parent_path_len);
            stack.pop();
            continue;
        }
        let idx = frame.next;
        frame.next += 1;
        let base_len = path.len();
        let entry = &frame.entries[idx];
        if base_len + entry.name.len() > MAX_TREE_PATH_LEN {
            return Err(GitError::TooLarge("tree path"));
        }
        if is_tree_mode(entry.mode) {
            if depth >= MAX_TREE_DEPTH {
                return Err(GitError::TooLarge("tree depth"));
            }
            let oid = entry.oid;
            path.extend_from_slice(&entry.name);
            path.push(b'/');
            body.clear();
            read_tree(oid, &mut body)?;
            stack.push(Frame {
                entries: parse_tree(&body)?,
                next: 0,
                parent_path_len: base_len,
            });
        } else {
            if out.len() >= MAX_TREE_ENTRIES {
                return Err(GitError::TooLarge("tree entry count"));
            }
            let mut full = Vec::with_capacity(base_len + entry.name.len());
            full.extend_from_slice(&path);
            full.extend_from_slice(&entry.name);
            out.push(TreeEntry {
                path: full,
                oid: entry.oid,
                mode: entry.mode,
            });
        }
    }

    // Tree iteration order ("name/" for subtrees) already yields paths in
    // byte order for well-formed trees; a hostile tree may not, and `status`
    // requires a strictly sorted list, so sort + dedup unconditionally.
    out.sort_unstable_by(|a, b| a.path.cmp(&b.path));
    out.dedup_by(|a, b| a.path == b.path);
    Ok(out)
}

#[cfg(test)]
pub(crate) mod test_encode {
    use super::*;

    /// Serialize tree records exactly as `git mktree` would.
    pub(crate) fn encode_tree(entries: &[RawTreeEntry]) -> Vec<u8> {
        let mut out = Vec::new();
        for e in entries {
            out.extend_from_slice(format!("{:o}", e.mode).as_bytes());
            out.push(b' ');
            out.extend_from_slice(&e.name);
            out.push(0);
            out.extend_from_slice(&e.oid.0);
        }
        out
    }

    pub(crate) fn raw(mode: u32, name: &[u8], oid_byte: u8) -> RawTreeEntry {
        RawTreeEntry {
            mode,
            name: name.to_vec(),
            oid: Oid([oid_byte; 20]),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_encode::{encode_tree, raw};
    use super::*;

    /// Tiny in-memory tree store (oid -> tree body).
    #[derive(Default)]
    struct TreeMap(Vec<(Oid, Vec<u8>)>);

    impl TreeMap {
        fn insert(&mut self, oid: Oid, body: Vec<u8>) {
            self.0.push((oid, body));
        }
    }

    fn reader(map: &TreeMap) -> impl FnMut(Oid, &mut Vec<u8>) -> Result<(), GitError> + '_ {
        |oid, out: &mut Vec<u8>| {
            let body = map
                .0
                .iter()
                .find(|(k, _)| *k == oid)
                .map(|(_, v)| v)
                .ok_or(GitError::MissingObject(oid))?;
            out.clear();
            out.extend_from_slice(body);
            Ok(())
        }
    }

    #[test]
    fn parse_tree_round_trip() {
        let entries = vec![
            raw(0o100644, b"README.md", 1),
            raw(0o40000, b"dir", 2),
            raw(0o100755, b"run.sh", 3),
            raw(0o120000, b"link", 4),
            raw(0o160000, b"submodule", 5),
        ];
        let encoded = encode_tree(&entries);
        assert_eq!(parse_tree(&encoded).unwrap(), entries);
        assert_eq!(parse_tree(b"").unwrap(), Vec::<RawTreeEntry>::new());
    }

    /// Tree records are self-delimiting, so a truncation IS valid exactly
    /// when it falls on a record boundary (and then yields the prefix).
    #[test]
    fn parse_tree_truncation_at_every_offset() {
        let entries = vec![raw(0o100644, b"a", 1), raw(0o40000, b"bb", 2)];
        let encoded = encode_tree(&entries);
        let boundaries = [0usize, encode_tree(&entries[..1]).len(), encoded.len()];
        for len in 0..=encoded.len() {
            match parse_tree(&encoded[..len]) {
                Ok(parsed) => {
                    let n = boundaries.iter().position(|&b| b == len);
                    assert_eq!(Some(parsed.len()), n, "len {len} parsed unexpectedly");
                }
                Err(_) => assert!(!boundaries.contains(&len), "len {len} should parse"),
            }
        }
    }

    #[test]
    fn parse_tree_rejects_bad_records() {
        let bad: &[&[u8]] = &[
            b"100644",                                // no space
            b"100644 name",                           // no NUL
            b"100644 \x00aaaaaaaaaaaaaaaaaaaa",       // empty name
            b" name\x00aaaaaaaaaaaaaaaaaaaa",         // empty mode
            b"10064x name\x00aaaaaaaaaaaaaaaaaaaa",   // non-octal
            b"10066444 name\x00aaaaaaaaaaaaaaaaaaaa", // 8 digits
            b"100644 a/b\x00aaaaaaaaaaaaaaaaaaaa",    // '/' in name
            b"100644 name\x00short",                  // truncated oid
        ];
        for data in bad {
            assert!(parse_tree(data).is_err(), "{data:?}");
        }
    }

    #[test]
    fn parse_commit_tree_ok_and_bad() {
        let hex = b"00112233445566778899aabbccddeeff00112233";
        let mut body = b"tree ".to_vec();
        body.extend_from_slice(hex);
        body.push(b'\n');
        body.extend_from_slice(b"parent 1111111111111111111111111111111111111111\n");
        assert_eq!(
            parse_commit_tree(&body).unwrap(),
            Oid::from_hex(hex).unwrap()
        );

        let bad: &[&[u8]] = &[
            b"",
            b"tre",
            b"parent 1111111111111111111111111111111111111111\n",
            b"tree 0011\n",
            b"tree 00112233445566778899aabbccddeeff00112233", // no newline
            b"tree zz112233445566778899aabbccddeeff00112233\n",
        ];
        for data in bad {
            assert!(parse_commit_tree(data).is_err(), "{data:?}");
        }
    }

    #[test]
    fn parse_tag_target_ok_and_bad() {
        let hex = b"00112233445566778899aabbccddeeff00112233";
        let mut body = b"object ".to_vec();
        body.extend_from_slice(hex);
        body.extend_from_slice(b"\ntype commit\ntag v1\n");
        assert_eq!(
            parse_tag_target(&body).unwrap(),
            Oid::from_hex(hex).unwrap()
        );
        assert!(parse_tag_target(b"type commit\n").is_err());
        assert!(parse_tag_target(b"object 123\n").is_err());
    }

    #[test]
    fn flatten_nested_tree() {
        // root: { "b.txt", "a/" -> sub, "z" submodule }
        // sub:  { "x.txt", "deep/" -> deep }
        // deep: { "y" symlink }
        let deep_oid = Oid([0xdd; 20]);
        let sub_oid = Oid([0xee; 20]);
        let root_oid = Oid([0xff; 20]);
        let mut map = TreeMap::default();
        map.insert(
            root_oid,
            encode_tree(&[
                raw(0o100644, b"b.txt", 1),
                RawTreeEntry {
                    mode: 0o40000,
                    name: b"a".to_vec(),
                    oid: sub_oid,
                },
                raw(0o160000, b"z", 9),
            ]),
        );
        map.insert(
            sub_oid,
            encode_tree(&[
                raw(0o100644, b"x.txt", 2),
                RawTreeEntry {
                    mode: 0o40000,
                    name: b"deep".to_vec(),
                    oid: deep_oid,
                },
            ]),
        );
        map.insert(deep_oid, encode_tree(&[raw(0o120000, b"y", 3)]));

        let mut read = reader(&map);
        let flat = flatten_tree(root_oid, &mut read).unwrap();
        let got: Vec<(Vec<u8>, u32)> = flat.iter().map(|e| (e.path.clone(), e.mode)).collect();
        assert_eq!(
            got,
            vec![
                (b"a/deep/y".to_vec(), 0o120000),
                (b"a/x.txt".to_vec(), 0o100644),
                (b"b.txt".to_vec(), 0o100644),
                (b"z".to_vec(), 0o160000),
            ]
        );
        // Sorted by full path bytes.
        let mut sorted = got.clone();
        sorted.sort();
        assert_eq!(got, sorted);
    }

    #[test]
    fn flatten_empty_tree() {
        let root = Oid([1; 20]);
        let mut map = TreeMap::default();
        map.insert(root, Vec::new());
        let mut read = reader(&map);
        assert!(flatten_tree(root, &mut read).unwrap().is_empty());
    }

    #[test]
    fn flatten_missing_subtree_is_an_error() {
        let root = Oid([1; 20]);
        let mut map = TreeMap::default();
        map.insert(
            root,
            encode_tree(&[RawTreeEntry {
                mode: 0o40000,
                name: b"gone".to_vec(),
                oid: Oid([2; 20]),
            }]),
        );
        let mut read = reader(&map);
        assert!(matches!(
            flatten_tree(root, &mut read),
            Err(GitError::MissingObject(_))
        ));
    }

    /// A tree that lists ITSELF as a subtree must hit the depth limit, not
    /// loop forever or blow the stack.
    #[test]
    fn flatten_self_referencing_tree_is_bounded() {
        let root = Oid([1; 20]);
        let mut map = TreeMap::default();
        map.insert(
            root,
            encode_tree(&[RawTreeEntry {
                mode: 0o40000,
                name: b"d".to_vec(),
                oid: root,
            }]),
        );
        let mut read = reader(&map);
        assert!(matches!(
            flatten_tree(root, &mut read),
            Err(GitError::TooLarge("tree depth"))
        ));
    }

    /// Two trees referencing each other with multiple fan-out entries would
    /// expand combinatorially; the entry-count ceiling stops it.
    #[test]
    fn flatten_entry_count_bomb_is_bounded() {
        let a = Oid([1; 20]);
        let b = Oid([2; 20]);
        // `a` has 4 blobs and 4 links to `b`; `b` has 4 blobs and 4 links to
        // `a`. Depth 256 * fan-out 4 explodes without the entry ceiling.
        let make = |other: Oid| {
            let mut entries = Vec::new();
            for i in 0..4u8 {
                entries.push(raw(0o100644, &[b'f', b'0' + i], i + 1));
                entries.push(RawTreeEntry {
                    mode: 0o40000,
                    name: vec![b'd', b'0' + i],
                    oid: other,
                });
            }
            encode_tree(&entries)
        };
        let mut map = TreeMap::default();
        map.insert(a, make(b));
        map.insert(b, make(a));
        let mut read = reader(&map);
        match flatten_tree(a, &mut read) {
            Err(GitError::TooLarge(_)) => {}
            other => panic!("expected TooLarge, got {other:?}"),
        }
    }

    #[test]
    fn flatten_hostile_unsorted_tree_is_sorted_and_deduped() {
        let root = Oid([1; 20]);
        let mut map = TreeMap::default();
        map.insert(
            root,
            encode_tree(&[
                raw(0o100644, b"zz", 1),
                raw(0o100644, b"aa", 2),
                raw(0o100644, b"zz", 3),
            ]),
        );
        let mut read = reader(&map);
        let flat = flatten_tree(root, &mut read).unwrap();
        let got: Vec<Vec<u8>> = flat.iter().map(|e| e.path.clone()).collect();
        assert_eq!(got, vec![b"aa".to_vec(), b"zz".to_vec()]);
    }

    /// Git's tree ordering sorts directories as if their name ended in '/',
    /// so `a.b` sorts BEFORE the directory `a`; the flattened full paths
    /// must still come out in plain byte order.
    #[test]
    fn flatten_dot_versus_slash_ordering() {
        let sub = Oid([2; 20]);
        let root = Oid([1; 20]);
        let mut map = TreeMap::default();
        map.insert(
            root,
            encode_tree(&[
                raw(0o100644, b"a.b", 1),
                RawTreeEntry {
                    mode: 0o40000,
                    name: b"a".to_vec(),
                    oid: sub,
                },
            ]),
        );
        map.insert(sub, encode_tree(&[raw(0o100644, b"x", 3)]));
        let mut read = reader(&map);
        let flat = flatten_tree(root, &mut read).unwrap();
        let got: Vec<Vec<u8>> = flat.iter().map(|e| e.path.clone()).collect();
        assert_eq!(got, vec![b"a.b".to_vec(), b"a/x".to_vec()]);
    }

    #[test]
    fn mode_classifiers() {
        assert!(is_tree_mode(0o40000));
        assert!(!is_tree_mode(0o100644));
        assert!(is_gitlink_mode(0o160000));
        assert!(!is_gitlink_mode(0o100755));
        assert!(is_symlink_mode(0o120000));
        assert!(!is_symlink_mode(0o100644));
    }
}
