//! Tiny object-layer over [`PackIndex`](crate::pack::PackIndex): typed reads
//! for the three kinds checkout needs.

use crate::pack::{Inflate, ObjKind, PackIndex};
use crate::{Error, Oid, Result};

/// `<mode> SP <name> NUL <sha1[20]>` repeated.
pub(crate) struct TreeIter<'a> {
    rest: &'a [u8],
}

pub(crate) struct TreeEntry<'a> {
    pub(crate) mode: u32,
    pub(crate) name: &'a [u8],
    pub(crate) oid: Oid,
}

impl<'a> TreeIter<'a> {
    pub(crate) fn new(data: &'a [u8]) -> Self {
        Self { rest: data }
    }
}

impl<'a> Iterator for TreeIter<'a> {
    type Item = Result<TreeEntry<'a>>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.rest.is_empty() {
            return None;
        }
        let sp = match self.rest.iter().position(|&b| b == b' ') {
            Some(i) => i,
            None => return Some(Err(Error::Pack("tree entry: missing SP".into()))),
        };
        let mode = match parse_octal(&self.rest[..sp]) {
            Some(m) => m,
            None => return Some(Err(Error::Pack("tree entry: bad mode".into()))),
        };
        let after = &self.rest[sp + 1..];
        let nul = match after.iter().position(|&b| b == 0) {
            Some(i) => i,
            None => return Some(Err(Error::Pack("tree entry: missing NUL".into()))),
        };
        let name = &after[..nul];
        let oid_bytes = match after.get(nul + 1..nul + 21) {
            Some(b) => b,
            None => return Some(Err(Error::Pack("tree entry: truncated oid".into()))),
        };
        let mut oid = [0u8; 20];
        oid.copy_from_slice(oid_bytes);
        self.rest = &after[nul + 21..];
        Some(Ok(TreeEntry {
            mode,
            name,
            oid: Oid(oid),
        }))
    }
}

fn parse_octal(s: &[u8]) -> Option<u32> {
    let mut n = 0u32;
    for &b in s {
        if !(b'0'..=b'7').contains(&b) {
            return None;
        }
        n = n.checked_mul(8)?.checked_add(u32::from(b - b'0'))?;
    }
    Some(n)
}

/// Extract the `tree <oid>` line from a commit object.
pub(crate) fn commit_tree(commit: &[u8]) -> Result<Oid> {
    // First line is always `tree <40hex>\n`.
    let line = commit
        .strip_prefix(b"tree ")
        .ok_or_else(|| Error::Pack("commit object missing 'tree ' header".into()))?;
    Oid::from_hex(&line[..40.min(line.len())])
        .ok_or_else(|| Error::Pack("commit tree id is not 40-hex".into()))
}

/// Read a commit's root tree oid from the pack.
pub(crate) fn read_commit_tree(odb: &Odb, commit: &Oid, inf: &mut Inflate) -> Result<Oid> {
    let mut buf = Vec::new();
    let kind = odb.read(commit, inf, &mut buf)?;
    if kind != ObjKind::Commit {
        return Err(Error::Pack(format!("{commit} is {kind:?}, not a commit")));
    }
    commit_tree(&buf)
}

/// Object database backed by one or more indexed packs. Lookups try each pack
/// in turn (the skeleton pack first, then blob packs).
pub(crate) struct Odb {
    packs: Vec<PackIndex>,
}

impl Odb {
    pub(crate) fn new() -> Self {
        Self { packs: Vec::new() }
    }
    pub(crate) fn push(&mut self, p: PackIndex) {
        self.packs.push(p);
    }
    pub(crate) fn packs(&self) -> &[PackIndex] {
        &self.packs
    }
    pub(crate) fn read(&self, oid: &Oid, inf: &mut Inflate, out: &mut Vec<u8>) -> Result<ObjKind> {
        for p in &self.packs {
            if p.contains(oid) {
                return p.read(oid, inf, out);
            }
        }
        Err(Error::Pack(format!("object {oid} not in any pack")))
    }
}
