//! `HEAD`, loose-ref and `packed-refs` parsing.
//!
//! Format references: `Documentation/gitrepository-layout.txt` (HEAD, refs/),
//! `refs/packed-backend.c` and `Documentation/git-pack-refs.txt` for the
//! `packed-refs` file (header line, `^` peeled lines).

use crate::error::GitError;
use crate::oid::{OID_HEX_LEN, Oid};
use crate::util::trim_line;

/// The resolved state of `HEAD`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Head {
    /// `HEAD` holds a raw object id (detached HEAD).
    Detached(Oid),
    /// `HEAD` is a symbolic ref to a branch. `oid` is `None` for an unborn
    /// branch (the ref does not exist yet — fresh repository).
    Branch {
        /// Full ref name, e.g. `refs/heads/main`.
        ref_name: Vec<u8>,
        oid: Option<Oid>,
    },
}

impl Head {
    /// The commit `HEAD` points at, if any.
    pub fn oid(&self) -> Option<Oid> {
        match self {
            Head::Detached(oid) => Some(*oid),
            Head::Branch { oid, .. } => *oid,
        }
    }

    /// The short branch name (`main` for `refs/heads/main`), if `HEAD` is a
    /// symbolic ref under `refs/heads/`.
    pub fn branch_name(&self) -> Option<&[u8]> {
        match self {
            Head::Detached(_) => None,
            Head::Branch { ref_name, .. } => match ref_name.strip_prefix(b"refs/heads/".as_slice())
            {
                Some(short) => Some(short),
                None => Some(ref_name.as_slice()),
            },
        }
    }
}

/// The two shapes a ref file can take.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum RefFile {
    /// `ref: <refname>`
    Symbolic(Vec<u8>),
    /// `<40-hex-oid>`
    Direct(Oid),
}

/// Parse the contents of `HEAD` or any loose ref file. Accepts an optional
/// trailing newline (and `\r\n`).
pub(crate) fn parse_ref_file(data: &[u8]) -> Result<RefFile, GitError> {
    let line = trim_line(data);
    // `refs.c:parse_loose_ref_contents` accepts "ref:" followed by any
    // amount of whitespace before the target name.
    if let Some(mut target) = line.strip_prefix(b"ref:".as_slice()) {
        while let Some((&b, rest)) = target.split_first() {
            if b == b' ' || b == b'\t' {
                target = rest;
            } else {
                break;
            }
        }
        let target = trim_line(target);
        if !is_safe_ref_name(target) {
            return Err(GitError::Corrupt("ref: unsafe symbolic ref target"));
        }
        return Ok(RefFile::Symbolic(target.to_vec()));
    }
    if line.len() >= OID_HEX_LEN
        && let Some(oid) = Oid::from_hex(&line[..OID_HEX_LEN])
    {
        return Ok(RefFile::Direct(oid));
    }
    Err(GitError::Corrupt("ref: unrecognized contents"))
}

/// The `$GIT_COMMON_DIR/packed-refs` file: optional `# pack-refs with: ...`
/// header, then `<oid> <refname>` lines; a `^<oid>` line gives the peeled
/// target of the preceding (tag) ref and is ignored here.
pub struct PackedRefs {
    /// `(refname, oid)`, sorted by refname.
    refs: Vec<(Vec<u8>, Oid)>,
}

impl PackedRefs {
    pub fn empty() -> PackedRefs {
        PackedRefs { refs: Vec::new() }
    }

    pub fn parse(data: &[u8]) -> Result<PackedRefs, GitError> {
        let mut refs: Vec<(Vec<u8>, Oid)> = Vec::new();
        for raw in data.split(|&b| b == b'\n') {
            let line = trim_line(raw);
            if line.is_empty() || line[0] == b'#' {
                continue;
            }
            if line[0] == b'^' {
                // Peeled value for the previous (annotated tag) ref. There
                // must be a previous ref line for it to attach to.
                if refs.is_empty() || Oid::from_hex(&line[1..]).is_none() {
                    return Err(GitError::Corrupt("packed-refs: stray peeled line"));
                }
                continue;
            }
            if line.len() < OID_HEX_LEN + 2 || line[OID_HEX_LEN] != b' ' {
                return Err(GitError::Corrupt("packed-refs: malformed line"));
            }
            let oid = Oid::from_hex(&line[..OID_HEX_LEN])
                .ok_or(GitError::Corrupt("packed-refs: bad object id"))?;
            let name = &line[OID_HEX_LEN + 1..];
            if !is_safe_ref_name(name) {
                return Err(GitError::Corrupt("packed-refs: unsafe ref name"));
            }
            refs.push((name.to_vec(), oid));
        }
        // The on-disk file is normally sorted but the `sorted` trait is
        // optional; sort defensively so lookups can binary-search.
        refs.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        Ok(PackedRefs { refs })
    }

    pub fn get(&self, name: &[u8]) -> Option<Oid> {
        let idx = self
            .refs
            .binary_search_by(|r| r.0.as_slice().cmp(name))
            .ok()?;
        Some(self.refs[idx].1)
    }

    pub fn len(&self) -> usize {
        self.refs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.refs.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&[u8], Oid)> {
        self.refs.iter().map(|(n, o)| (n.as_slice(), *o))
    }
}

/// A conservative subset of git's `check_refname_format`. A symbolic-ref
/// target read out of `.git/` is later joined onto the common dir and
/// OPENED, so it must not be able to escape it: no absolute paths, no `..`
/// or `.` components, no NUL, no backslash, no empty components, and it must
/// live under `refs/`. (`HEAD` may only point into `refs/`; see
/// `refs.c:validate_headref`.)
pub(crate) fn is_safe_ref_name(name: &[u8]) -> bool {
    if name.is_empty() || name.len() > 4096 {
        return false;
    }
    if !name.starts_with(b"refs/") {
        return false;
    }
    if name.first() == Some(&b'/') || name.last() == Some(&b'/') {
        return false;
    }
    for component in name.split(|&b| b == b'/') {
        if component.is_empty() || component == b"." || component == b".." {
            return false;
        }
    }
    !name
        .iter()
        .any(|&b| b == 0 || b == b'\\' || b == b':' || b < 0x20 || b == 0x7f)
}

#[cfg(test)]
mod tests {
    use super::*;

    const H1: &[u8] = b"1111111111111111111111111111111111111111";
    const H2: &[u8] = b"2222222222222222222222222222222222222222";

    #[test]
    fn parse_head_symref() {
        for contents in [
            b"ref: refs/heads/main\n".as_slice(),
            b"ref: refs/heads/main",
            b"ref: refs/heads/main\r\n",
            b"ref: refs/heads/main \n",
            b"ref:refs/heads/main",
            b"ref:\trefs/heads/main\n",
        ] {
            assert_eq!(
                parse_ref_file(contents).unwrap(),
                RefFile::Symbolic(b"refs/heads/main".to_vec()),
                "{contents:?}"
            );
        }
    }

    #[test]
    fn parse_head_detached() {
        let mut contents = H1.to_vec();
        contents.push(b'\n');
        assert_eq!(
            parse_ref_file(&contents).unwrap(),
            RefFile::Direct(Oid::from_hex(H1).unwrap())
        );
        assert_eq!(
            parse_ref_file(H1).unwrap(),
            RefFile::Direct(Oid::from_hex(H1).unwrap())
        );
    }

    #[test]
    fn parse_ref_file_rejects_garbage() {
        for bad in [
            b"".as_slice(),
            b"\n",
            b"123",
            b"not a ref at all",
            b"ref: ",
            b"ref:",
            b"ref: ../../etc/passwd",
            b"ref: refs/../../../etc/passwd",
            b"ref: /etc/passwd",
            b"ref: refs/heads/a\\b",
            b"ref: HEAD",
            b"ref: refs//x",
            b"ref: refs/heads/.",
            b"ref: refs/heads/x\x00y",
        ] {
            assert!(parse_ref_file(bad).is_err(), "{bad:?}");
        }
    }

    /// A symbolic ref target longer than 40 bytes that begins with 40 hex
    /// characters must not be mistaken for a detached oid.
    #[test]
    fn hex_prefix_only_when_direct() {
        let mut contents = b"ref: refs/heads/".to_vec();
        contents.extend_from_slice(H1);
        let parsed = parse_ref_file(&contents).unwrap();
        let mut want = b"refs/heads/".to_vec();
        want.extend_from_slice(H1);
        assert_eq!(parsed, RefFile::Symbolic(want));
    }

    #[test]
    fn packed_refs_basic() {
        let mut data = Vec::new();
        data.extend_from_slice(b"# pack-refs with: peeled fully-peeled sorted \n");
        data.extend_from_slice(H2);
        data.extend_from_slice(b" refs/heads/main\n");
        data.extend_from_slice(H1);
        data.extend_from_slice(b" refs/tags/v1.0.0\n");
        data.extend_from_slice(b"^");
        data.extend_from_slice(H2);
        data.extend_from_slice(b"\n");
        let refs = PackedRefs::parse(&data).unwrap();
        assert_eq!(refs.len(), 2);
        assert_eq!(
            refs.get(b"refs/heads/main"),
            Some(Oid::from_hex(H2).unwrap())
        );
        assert_eq!(
            refs.get(b"refs/tags/v1.0.0"),
            Some(Oid::from_hex(H1).unwrap())
        );
        assert_eq!(refs.get(b"refs/heads/other"), None);
        assert_eq!(refs.get(b""), None);
        let collected: Vec<_> = refs.iter().map(|(n, _)| n.to_vec()).collect();
        assert_eq!(
            collected,
            vec![b"refs/heads/main".to_vec(), b"refs/tags/v1.0.0".to_vec()]
        );
    }

    #[test]
    fn packed_refs_unsorted_input_is_sorted() {
        let mut data = Vec::new();
        data.extend_from_slice(H1);
        data.extend_from_slice(b" refs/heads/zzz\n");
        data.extend_from_slice(H2);
        data.extend_from_slice(b" refs/heads/aaa\n");
        let refs = PackedRefs::parse(&data).unwrap();
        assert_eq!(
            refs.get(b"refs/heads/aaa"),
            Some(Oid::from_hex(H2).unwrap())
        );
        assert_eq!(
            refs.get(b"refs/heads/zzz"),
            Some(Oid::from_hex(H1).unwrap())
        );
    }

    #[test]
    fn packed_refs_empty_and_header_only() {
        assert!(PackedRefs::empty().is_empty());
        assert!(PackedRefs::parse(b"").unwrap().is_empty());
        assert!(
            PackedRefs::parse(b"# pack-refs with: peeled \n\n")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn packed_refs_malformed() {
        let bad: &[&[u8]] = &[
            b"^1111111111111111111111111111111111111111\n", // stray peel
            b"zzzz refs/heads/x\n",
            b"1111111111111111111111111111111111111111\n", // no name
            b"1111111111111111111111111111111111111111 \n", // empty name
            b"1111111111111111111111111111111111111111 ../escape\n",
            b"1111111111111111111111111111111111111111 refs/heads/..\n",
            b"1111111111111111111111111111111111111111refs/heads/x\n",
        ];
        for data in bad {
            assert!(PackedRefs::parse(data).is_err(), "{data:?}");
        }
    }

    #[test]
    fn head_accessors() {
        let oid = Oid::from_hex(H1).unwrap();
        let detached = Head::Detached(oid);
        assert_eq!(detached.oid(), Some(oid));
        assert_eq!(detached.branch_name(), None);
        let branch = Head::Branch {
            ref_name: b"refs/heads/feature/x".to_vec(),
            oid: Some(oid),
        };
        assert_eq!(branch.oid(), Some(oid));
        assert_eq!(branch.branch_name(), Some(b"feature/x".as_slice()));
        let unborn = Head::Branch {
            ref_name: b"refs/heads/main".to_vec(),
            oid: None,
        };
        assert_eq!(unborn.oid(), None);
        assert_eq!(unborn.branch_name(), Some(b"main".as_slice()));
    }

    #[test]
    fn safe_ref_names() {
        for good in [
            b"refs/heads/main".as_slice(),
            b"refs/heads/feature/a-b_c.d",
            b"refs/tags/v1.2.3",
            b"refs/remotes/origin/HEAD",
        ] {
            assert!(is_safe_ref_name(good), "{good:?}");
        }
        for bad in [
            b"".as_slice(),
            b"HEAD",
            b"main",
            b"/refs/heads/main",
            b"refs/heads/main/",
            b"refs//heads",
            b"refs/./x",
            b"refs/../x",
            b"refs/heads/a\\b",
            b"refs/heads/a:b",
            b"refs/heads/a\nb",
        ] {
            assert!(!is_safe_ref_name(bad), "{bad:?}");
        }
        let long = [b'a'; 5000];
        let mut name = b"refs/heads/".to_vec();
        name.extend_from_slice(&long);
        assert!(!is_safe_ref_name(&name));
    }
}
