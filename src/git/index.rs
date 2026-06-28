//! `.git/index` reader (versions 2, 3 and 4).
//!
//! Format reference: `Documentation/gitformat-index.txt` in git.git. All
//! field offsets, flag bits, the v2/v3 8-byte entry padding rule and the v4
//! prefix-compressed pathnames implemented here are taken from that document
//! and from `read-cache.c:create_from_disk`.

use crate::error::GitError;
use crate::oid::{OID_RAW_LEN, Oid};
use crate::util::Reader;

/// `gitformat-index.txt`: the header starts with the 4-byte signature "DIRC".
const INDEX_SIGNATURE: &[u8; 4] = b"DIRC";
/// Header = signature + 4-byte version + 4-byte entry count.
const INDEX_HEADER_LEN: usize = 12;
/// `gitformat-index.txt`: 10 32-bit stat fields + 20-byte oid + 16-bit flags.
const ENTRY_FIXED_LEN: usize = 62;
/// Size of the trailing SHA-1 over the rest of the file.
const INDEX_TRAILER_LEN: usize = OID_RAW_LEN;

// 16-bit `flags` field (`gitformat-index.txt`, "A 16-bit 'flags' field").
const FLAG_ASSUME_VALID: u16 = 0x8000;
const FLAG_EXTENDED: u16 = 0x4000;
const FLAG_STAGE_SHIFT: u32 = 12;
const FLAG_STAGE_MASK: u16 = 0x3000;
/// Name lengths >= 0xFFF are stored as 0xFFF and recovered from the
/// NUL-terminated name itself.
const FLAG_NAME_MASK: u16 = 0x0fff;

// 16-bit extended `flags` field, present when `FLAG_EXTENDED` is set (v3+).
// `read-cache.c`: any bit outside `CE_EXTENDED_FLAGS` is a hard error.
const EXT_FLAG_SKIP_WORKTREE: u16 = 0x4000;
const EXT_FLAG_INTENT_TO_ADD: u16 = 0x2000;
const EXT_KNOWN_MASK: u16 = EXT_FLAG_SKIP_WORKTREE | EXT_FLAG_INTENT_TO_ADD;

/// Hard ceiling on the number of index entries this crate will materialize.
/// The on-disk count is attacker-controlled; each entry occupies at least
/// [`ENTRY_FIXED_LEN`] bytes so this also bounds memory by the file size.
const MAX_INDEX_ENTRIES: u32 = 1 << 24;
/// Hard ceiling on the path arena. Index v4 prefix compression can expand
/// quadratically relative to the file size, so the decoded total is capped
/// independently of the input length.
const MAX_PATH_ARENA_BYTES: usize = 256 * 1024 * 1024;

bitflags::bitflags! {
    /// Per-entry flags, normalized across index versions.
    #[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
    pub struct EntryFlags: u8 {
        /// `assume unchanged` / `CE_VALID` (`git update-index --assume-unchanged`).
        const ASSUME_VALID  = 1 << 0;
        /// The on-disk entry carried the v3 extended flags word.
        const EXTENDED      = 1 << 1;
        /// `CE_SKIP_WORKTREE` (sparse checkout).
        const SKIP_WORKTREE = 1 << 2;
        /// `CE_INTENT_TO_ADD` (`git add -N`).
        const INTENT_TO_ADD = 1 << 3;
    }
}

/// The cached `lstat(2)` data git stores per entry, exactly as on disk
/// (every field is truncated to 32 bits by git when writing the index).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StatCache {
    pub ctime_s: u32,
    pub ctime_ns: u32,
    pub mtime_s: u32,
    pub mtime_ns: u32,
    pub dev: u32,
    pub ino: u32,
    pub uid: u32,
    pub gid: u32,
    pub size: u32,
}

/// One index entry. The path lives in the parent [`Index`]'s arena; use
/// [`Index::path`] to resolve it.
#[derive(Clone, Copy, Debug)]
pub struct IndexEntry {
    /// `(start, end)` byte range into the [`Index`] path arena.
    pub path_range: (u32, u32),
    pub oid: Oid,
    /// Git's canonical mode word (e.g. `0o100644`, `0o120000`, `0o160000`).
    pub mode: u32,
    pub stat: StatCache,
    /// Merge stage (0 = normal, 1-3 = conflict stages).
    pub stage: u8,
    pub flags: EntryFlags,
}

/// One entry of the cache-tree (`TREE`) extension.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TreeCacheEntry {
    /// Path component relative to the parent tree-cache entry (root = `""`).
    pub component: Vec<u8>,
    /// Number of index entries covered, or `-1` if the node is invalidated.
    pub entry_count: i32,
    /// Number of subtree nodes that follow this one.
    pub subtree_count: u32,
    /// Present only when `entry_count >= 0`.
    pub oid: Option<Oid>,
}

/// A parsed `.git/index` file. Entries are sorted by `(path, stage)` and the
/// sort order is enforced at parse time.
pub struct Index {
    version: u32,
    entries: Vec<IndexEntry>,
    paths: Vec<u8>,
    tree_cache: Vec<TreeCacheEntry>,
    checksum: Oid,
    /// mtime of the index file itself, used for the racily-clean check
    /// (`read-cache.c:is_racy_timestamp`). Not part of the file format;
    /// supplied by the caller that `stat`ed the file.
    timestamp: Option<(i64, u32)>,
}

impl Index {
    /// An index with no entries (an unborn repository has no index file).
    pub fn empty() -> Index {
        Index {
            version: 2,
            entries: Vec::new(),
            paths: Vec::new(),
            tree_cache: Vec::new(),
            checksum: Oid::ZERO,
            timestamp: None,
        }
    }

    /// Parse the raw bytes of a `.git/index` file. Purely structural: the
    /// trailing SHA-1 is *recorded* but not recomputed here (see
    /// [`crate::odb::verify_index_checksum`]).
    pub fn parse(data: &[u8]) -> Result<Index, GitError> {
        if data.len() < INDEX_HEADER_LEN + INDEX_TRAILER_LEN {
            return Err(GitError::Corrupt("index: file too short"));
        }
        let body = &data[..data.len() - INDEX_TRAILER_LEN];
        let mut checksum = [0u8; OID_RAW_LEN];
        checksum.copy_from_slice(&data[data.len() - INDEX_TRAILER_LEN..]);

        let mut r = Reader::new(body, "index header");
        if r.read_bytes(4)? != INDEX_SIGNATURE {
            return Err(GitError::Corrupt("index: bad signature"));
        }
        let version = r.read_be32()?;
        if !(2..=4).contains(&version) {
            return Err(GitError::Unsupported("index version"));
        }
        let entry_count = r.read_be32()?;
        if entry_count > MAX_INDEX_ENTRIES {
            return Err(GitError::TooLarge("index entry count"));
        }
        // Every entry occupies at least ENTRY_FIXED_LEN bytes on disk, so the
        // declared count is validated against the real remaining length
        // before it is used as a loop bound.
        if (entry_count as u64) * (ENTRY_FIXED_LEN as u64) > r.remaining() as u64 {
            return Err(GitError::Corrupt("index: entry count exceeds file size"));
        }

        let mut entries: Vec<IndexEntry> = Vec::new();
        entries
            .try_reserve(entry_count as usize)
            .map_err(|_| GitError::TooLarge("index entry count"))?;
        let mut paths: Vec<u8> = Vec::new();
        let mut prev_range: (u32, u32) = (0, 0);

        for i in 0..entry_count {
            let entry = parse_entry(&mut r, version, &mut paths, prev_range)?;
            if i > 0 {
                let prev = &paths[prev_range.0 as usize..prev_range.1 as usize];
                let cur = &paths[entry.path_range.0 as usize..entry.path_range.1 as usize];
                let prev_stage = entries[entries.len() - 1].stage;
                // `read-cache.c:verify_hdr` ordering: name bytes, then stage.
                if prev.cmp(cur).then(prev_stage.cmp(&entry.stage)) != core::cmp::Ordering::Less {
                    return Err(GitError::Corrupt("index: entries not sorted"));
                }
            }
            prev_range = entry.path_range;
            entries.push(entry);
        }

        let tree_cache = parse_extensions(&mut r)?;

        Ok(Index {
            version,
            entries,
            paths,
            tree_cache,
            checksum: Oid(checksum),
            timestamp: None,
        })
    }

    pub fn version(&self) -> u32 {
        self.version
    }

    pub fn entries(&self) -> &[IndexEntry] {
        &self.entries
    }

    /// The trailing SHA-1 recorded in the file.
    pub fn checksum(&self) -> Oid {
        self.checksum
    }

    pub fn tree_cache(&self) -> &[TreeCacheEntry] {
        &self.tree_cache
    }

    /// Resolve an entry's path bytes ('/'-separated, relative to the work
    /// tree root). The entry must belong to this index.
    pub fn path(&self, e: &IndexEntry) -> &[u8] {
        // Ranges are produced by `parse` from arena lengths, so they are
        // always in bounds for entries of this index; a foreign entry yields
        // an empty slice rather than a panic.
        self.paths
            .get(e.path_range.0 as usize..e.path_range.1 as usize)
            .unwrap_or(b"")
    }

    /// Binary-search for the first entry (lowest stage) with exactly `path`.
    pub fn lookup(&self, path: &[u8]) -> Option<&IndexEntry> {
        let mut idx = self
            .entries
            .binary_search_by(|e| self.path(e).cmp(path))
            .ok()?;
        while idx > 0 && self.path(&self.entries[idx - 1]) == path {
            idx -= 1;
        }
        Some(&self.entries[idx])
    }

    /// The index file's own mtime, if the caller recorded it. `None` disables
    /// the racily-clean check.
    pub fn timestamp(&self) -> Option<(i64, u32)> {
        self.timestamp
    }

    pub fn set_timestamp(&mut self, secs: i64, nanos: u32) {
        self.timestamp = Some((secs, nanos));
    }
}

fn push_path(
    paths: &mut Vec<u8>,
    prefix_of_prev: &[u8],
    suffix: &[u8],
) -> Result<(u32, u32), GitError> {
    let total = prefix_of_prev.len() + suffix.len();
    if paths.len() + total > MAX_PATH_ARENA_BYTES {
        return Err(GitError::TooLarge("index path arena"));
    }
    let start = paths.len();
    paths
        .try_reserve(total)
        .map_err(|_| GitError::TooLarge("index path arena"))?;
    paths.extend_from_slice(prefix_of_prev);
    paths.extend_from_slice(suffix);
    // `start + total <= MAX_PATH_ARENA_BYTES` < u32::MAX, so these casts are exact.
    Ok((start as u32, (start + total) as u32))
}

fn parse_entry(
    r: &mut Reader<'_>,
    version: u32,
    paths: &mut Vec<u8>,
    prev_range: (u32, u32),
) -> Result<IndexEntry, GitError> {
    let entry_start = r.pos();
    if r.remaining() < ENTRY_FIXED_LEN {
        return Err(GitError::Corrupt("index: truncated entry"));
    }
    // On-disk field order (`gitformat-index.txt`, "Index entry"): ctime,
    // mtime, dev, ino, mode, uid, gid, file size, object id, flags.
    let ctime_s = r.read_be32()?;
    let ctime_ns = r.read_be32()?;
    let mtime_s = r.read_be32()?;
    let mtime_ns = r.read_be32()?;
    let dev = r.read_be32()?;
    let ino = r.read_be32()?;
    let mode = r.read_be32()?;
    let uid = r.read_be32()?;
    let gid = r.read_be32()?;
    let size = r.read_be32()?;
    let stat = StatCache {
        ctime_s,
        ctime_ns,
        mtime_s,
        mtime_ns,
        dev,
        ino,
        uid,
        gid,
        size,
    };
    let oid = r.read_oid()?;
    let flags16 = r.read_be16()?;

    let mut flags = EntryFlags::empty();
    if flags16 & FLAG_ASSUME_VALID != 0 {
        flags |= EntryFlags::ASSUME_VALID;
    }
    let stage = ((flags16 & FLAG_STAGE_MASK) >> FLAG_STAGE_SHIFT) as u8;
    let name_len_field = flags16 & FLAG_NAME_MASK;

    let mut fixed_len = ENTRY_FIXED_LEN;
    if flags16 & FLAG_EXTENDED != 0 {
        // `gitformat-index.txt`: the extended flag "must be zero in version 2".
        if version < 3 {
            return Err(GitError::Corrupt("index: extended flag in v2 entry"));
        }
        flags |= EntryFlags::EXTENDED;
        let ext = r.read_be16()?;
        if ext & !EXT_KNOWN_MASK != 0 {
            return Err(GitError::Corrupt("index: unknown extended entry flags"));
        }
        if ext & EXT_FLAG_SKIP_WORKTREE != 0 {
            flags |= EntryFlags::SKIP_WORKTREE;
        }
        if ext & EXT_FLAG_INTENT_TO_ADD != 0 {
            flags |= EntryFlags::INTENT_TO_ADD;
        }
        fixed_len += 2;
    }

    let path_range = if version == 4 {
        // `gitformat-index.txt` (version 4): the path is stored as an
        // offset-encoded varint N (bytes to strip from the END of the
        // previous path) followed by the NUL-terminated remainder. There is
        // no per-entry padding in version 4.
        let prev = &paths[prev_range.0 as usize..prev_range.1 as usize];
        let strip = r.read_offset_varint()?;
        if strip > prev.len() as u64 {
            return Err(GitError::Corrupt("index: v4 prefix strip too long"));
        }
        let keep = prev.len() - strip as usize;
        let suffix = if name_len_field == FLAG_NAME_MASK {
            r.read_cstr()?
        } else {
            let full = name_len_field as usize;
            let suffix_len = full
                .checked_sub(keep)
                .ok_or(GitError::Corrupt("index: v4 name length below prefix"))?;
            let suffix = r.read_bytes(suffix_len)?;
            if r.read_u8()? != 0 {
                return Err(GitError::Corrupt("index: v4 name not NUL-terminated"));
            }
            suffix
        };
        if memchr::memchr(0, suffix).is_some() {
            return Err(GitError::Corrupt("index: NUL in path"));
        }
        // `prev` borrows the arena; copy the prefix out before it grows.
        let prefix = prev[..keep].to_vec();
        push_path(paths, &prefix, suffix)?
    } else {
        let name = if name_len_field == FLAG_NAME_MASK {
            // Name length >= 0xFFF: recover the real length from the NUL
            // terminator without consuming it (it doubles as padding byte 1).
            let rest = r.rest();
            let n = memchr::memchr(0, rest)
                .ok_or(GitError::Corrupt("index: name not NUL-terminated"))?;
            r.skip(n)?;
            &rest[..n]
        } else {
            let name = r.read_bytes(name_len_field as usize)?;
            if memchr::memchr(0, name).is_some() {
                return Err(GitError::Corrupt("index: NUL in path"));
            }
            name
        };
        // `read-cache.c:ondisk_ce_size`: `(fixed + namelen + 8) & ~7` — the
        // entry is padded with 1-8 NULs to a multiple of 8 bytes, keeping
        // the name NUL-terminated. Version 4 has no padding.
        let unpadded = fixed_len + name.len();
        let padded = (unpadded + 8) & !7;
        let pad = r.read_bytes(padded - unpadded)?;
        if pad.first() != Some(&0) {
            return Err(GitError::Corrupt("index: name not NUL-terminated"));
        }
        debug_assert_eq!(r.pos() - entry_start, padded);
        push_path(paths, b"", name)?
    };

    if path_range.0 == path_range.1 {
        return Err(GitError::Corrupt("index: empty path"));
    }

    Ok(IndexEntry {
        path_range,
        oid,
        mode,
        stat,
        stage,
        flags,
    })
}

fn parse_extensions(r: &mut Reader<'_>) -> Result<Vec<TreeCacheEntry>, GitError> {
    let mut tree_cache = Vec::new();
    while !r.is_empty() {
        if r.remaining() < 8 {
            return Err(GitError::Corrupt("index: truncated extension header"));
        }
        let mut sig = [0u8; 4];
        sig.copy_from_slice(r.read_bytes(4)?);
        let size = r.read_be32()? as usize;
        if size > r.remaining() {
            return Err(GitError::Corrupt("index: extension size exceeds file"));
        }
        let payload = r.read_bytes(size)?;
        match &sig {
            b"TREE" => tree_cache = parse_tree_cache(payload)?,
            // `gitformat-index.txt`: extensions whose first signature byte is
            // 'A'..'Z' are optional and may be ignored. A lowercase first
            // byte means the index cannot be understood without it.
            _ if sig[0].is_ascii_uppercase() => {}
            b"link" => return Err(GitError::Unsupported("split index (link extension)")),
            b"sdir" => return Err(GitError::Unsupported("sparse index (sdir extension)")),
            _ => return Err(GitError::Unsupported("mandatory index extension")),
        }
    }
    Ok(tree_cache)
}

/// `gitformat-index.txt`, "Cache tree" extension: a series of
/// `<component>NUL<entry_count>SP<subtree_count>LF[<oid>]` records in
/// depth-first order. Parsed flat; the hierarchy is not reconstructed.
fn parse_tree_cache(data: &[u8]) -> Result<Vec<TreeCacheEntry>, GitError> {
    let mut r = Reader::new(data, "index TREE extension");
    let mut out = Vec::new();
    while !r.is_empty() {
        let component = r.read_cstr()?.to_vec();
        let count_tok = read_token(&mut r, b' ')?;
        let entry_count = parse_ascii_i32(count_tok)
            .ok_or(GitError::Corrupt("index: TREE entry count not numeric"))?;
        let sub_tok = read_token(&mut r, b'\n')?;
        let subtree_count = parse_ascii_i32(sub_tok)
            .and_then(|v| u32::try_from(v).ok())
            .ok_or(GitError::Corrupt("index: TREE subtree count not numeric"))?;
        let oid = if entry_count >= 0 {
            Some(r.read_oid()?)
        } else {
            None
        };
        out.push(TreeCacheEntry {
            component,
            entry_count,
            subtree_count,
            oid,
        });
    }
    Ok(out)
}

fn read_token<'a>(r: &mut Reader<'a>, delim: u8) -> Result<&'a [u8], GitError> {
    let rest = r.rest();
    let end =
        memchr::memchr(delim, rest).ok_or(GitError::Corrupt("index: TREE missing delimiter"))?;
    let tok = &rest[..end];
    r.skip(end + 1)?;
    Ok(tok)
}

/// Bounded ASCII decimal parser accepting an optional leading `-`.
fn parse_ascii_i32(s: &[u8]) -> Option<i32> {
    let (neg, digits) = match s.split_first() {
        Some((b'-', rest)) => (true, rest),
        _ => (false, s),
    };
    if digits.is_empty() || digits.len() > 10 {
        return None;
    }
    let mut value: i64 = 0;
    for &c in digits {
        if !c.is_ascii_digit() {
            return None;
        }
        value = value * 10 + i64::from(c - b'0');
    }
    if neg {
        value = -value;
    }
    i32::try_from(value).ok()
}

#[cfg(test)]
pub(crate) mod test_encode {
    //! Test-only encoder for index v2/v3/v4 files. Mirrors
    //! `read-cache.c:ce_write_entry`. The trailing 20 bytes are caller-chosen
    //! (the parser does not recompute the checksum), so no SHA-1 is linked.
    use super::*;
    use crate::util::test_encode::offset_varint;

    #[derive(Clone)]
    pub(crate) struct SpecEntry {
        pub(crate) path: Vec<u8>,
        pub(crate) oid: Oid,
        pub(crate) mode: u32,
        pub(crate) stat: StatCache,
        pub(crate) stage: u8,
        pub(crate) assume_valid: bool,
        pub(crate) skip_worktree: bool,
        pub(crate) intent_to_add: bool,
    }

    impl SpecEntry {
        pub(crate) fn new(path: &[u8], oid_byte: u8) -> SpecEntry {
            SpecEntry {
                path: path.to_vec(),
                oid: Oid([oid_byte; 20]),
                mode: 0o100644,
                stat: StatCache {
                    ctime_s: 1,
                    ctime_ns: 2,
                    mtime_s: 3,
                    mtime_ns: 4,
                    dev: 5,
                    ino: 6,
                    uid: 7,
                    gid: 8,
                    size: 9,
                },
                stage: 0,
                assume_valid: false,
                skip_worktree: false,
                intent_to_add: false,
            }
        }
    }

    pub(crate) fn encode(version: u32, entries: &[SpecEntry]) -> Vec<u8> {
        encode_with_extensions(version, entries, &[])
    }

    pub(crate) fn encode_with_extensions(
        version: u32,
        entries: &[SpecEntry],
        extensions: &[(&[u8; 4], &[u8])],
    ) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(INDEX_SIGNATURE);
        out.extend_from_slice(&version.to_be_bytes());
        out.extend_from_slice(&(entries.len() as u32).to_be_bytes());
        let mut prev: Vec<u8> = Vec::new();
        for e in entries {
            let start = out.len();
            out.extend_from_slice(&e.stat.ctime_s.to_be_bytes());
            out.extend_from_slice(&e.stat.ctime_ns.to_be_bytes());
            out.extend_from_slice(&e.stat.mtime_s.to_be_bytes());
            out.extend_from_slice(&e.stat.mtime_ns.to_be_bytes());
            out.extend_from_slice(&e.stat.dev.to_be_bytes());
            out.extend_from_slice(&e.stat.ino.to_be_bytes());
            out.extend_from_slice(&e.mode.to_be_bytes());
            out.extend_from_slice(&e.stat.uid.to_be_bytes());
            out.extend_from_slice(&e.stat.gid.to_be_bytes());
            out.extend_from_slice(&e.stat.size.to_be_bytes());
            out.extend_from_slice(&e.oid.0);
            let extended = e.skip_worktree || e.intent_to_add;
            let name_len_field = if e.path.len() >= FLAG_NAME_MASK as usize {
                FLAG_NAME_MASK
            } else {
                e.path.len() as u16
            };
            let mut flags: u16 = name_len_field;
            flags |= (u16::from(e.stage) & 0x3) << FLAG_STAGE_SHIFT;
            if e.assume_valid {
                flags |= FLAG_ASSUME_VALID;
            }
            if extended {
                flags |= FLAG_EXTENDED;
            }
            out.extend_from_slice(&flags.to_be_bytes());
            if extended {
                let mut ext: u16 = 0;
                if e.skip_worktree {
                    ext |= EXT_FLAG_SKIP_WORKTREE;
                }
                if e.intent_to_add {
                    ext |= EXT_FLAG_INTENT_TO_ADD;
                }
                out.extend_from_slice(&ext.to_be_bytes());
            }
            if version == 4 {
                let common = common_prefix_len(&prev, &e.path);
                let strip = prev.len() - common;
                out.extend_from_slice(&offset_varint(strip as u64));
                out.extend_from_slice(&e.path[common..]);
                out.push(0);
            } else {
                out.extend_from_slice(&e.path);
                let unpadded = out.len() - start;
                let padded = (unpadded + 8) & !7;
                out.resize(start + padded, 0);
            }
            prev = e.path.clone();
        }
        for (sig, payload) in extensions {
            out.extend_from_slice(&sig[..]);
            out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
            out.extend_from_slice(payload);
        }
        // Arbitrary checksum trailer; `Index::parse` records it verbatim.
        out.extend_from_slice(&[0xcc; 20]);
        out
    }

    fn common_prefix_len(a: &[u8], b: &[u8]) -> usize {
        a.iter().zip(b.iter()).take_while(|(x, y)| x == y).count()
    }

    pub(crate) fn encode_tree_cache(entries: &[TreeCacheEntry]) -> Vec<u8> {
        let mut out = Vec::new();
        for e in entries {
            out.extend_from_slice(&e.component);
            out.push(0);
            out.extend_from_slice(e.entry_count.to_string().as_bytes());
            out.push(b' ');
            out.extend_from_slice(e.subtree_count.to_string().as_bytes());
            out.push(b'\n');
            if let Some(oid) = e.oid {
                out.extend_from_slice(&oid.0);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::test_encode::{SpecEntry, encode, encode_tree_cache, encode_with_extensions};
    use super::*;

    fn entry_paths(index: &Index) -> Vec<Vec<u8>> {
        index
            .entries()
            .iter()
            .map(|e| index.path(e).to_vec())
            .collect()
    }

    #[test]
    fn empty_index_every_version() {
        for v in 2..=4 {
            let data = encode(v, &[]);
            let index = Index::parse(&data).unwrap();
            assert_eq!(index.version(), v);
            assert!(index.entries().is_empty());
            assert_eq!(index.checksum(), Oid([0xcc; 20]));
        }
    }

    #[test]
    fn v2_round_trip_fields() {
        let mut a = SpecEntry::new(b"a.txt", 0x11);
        a.mode = 0o100755;
        a.stat = StatCache {
            ctime_s: 0xaaaa_0001,
            ctime_ns: 2,
            mtime_s: 0xbbbb_0003,
            mtime_ns: 4,
            dev: 0xdddd_0005,
            ino: 6,
            uid: 0xffff_0007,
            gid: 8,
            size: 0x1234_5678,
        };
        let mut b = SpecEntry::new(b"dir/nested/file", 0x22);
        b.assume_valid = true;
        let data = encode(2, &[a.clone(), b.clone()]);
        let index = Index::parse(&data).unwrap();
        assert_eq!(index.version(), 2);
        assert_eq!(
            entry_paths(&index),
            vec![b"a.txt".to_vec(), b"dir/nested/file".to_vec()]
        );
        let pa = &index.entries()[0];
        assert_eq!(pa.mode, 0o100755);
        assert_eq!(pa.oid, Oid([0x11; 20]));
        assert_eq!(pa.stat, a.stat);
        assert_eq!(pa.stage, 0);
        assert_eq!(pa.flags, EntryFlags::empty());
        let pb = &index.entries()[1];
        assert_eq!(pb.flags, EntryFlags::ASSUME_VALID);
        assert_eq!(pb.stat, b.stat);
    }

    /// Every name length from 1..40 exercises each of the 8 padding residues
    /// for both the 62-byte (plain) and 64-byte (extended) fixed parts.
    #[test]
    fn padding_every_residue_v2_v3() {
        for extended in [false, true] {
            let version = if extended { 3 } else { 2 };
            let mut entries = Vec::new();
            // "a" < "aa" < "aaa" < ... keeps the required sort order while
            // hitting every (name length mod 8) padding residue.
            for len in 1..40 {
                let mut e = SpecEntry::new(&vec![b'a'; len], len as u8);
                e.skip_worktree = extended;
                entries.push(e);
            }
            let data = encode(version, &entries);
            let index = Index::parse(&data).unwrap();
            assert_eq!(index.entries().len(), entries.len());
            for (parsed, spec) in index.entries().iter().zip(entries.iter()) {
                assert_eq!(index.path(parsed), &spec.path[..]);
                assert_eq!(parsed.flags.contains(EntryFlags::SKIP_WORKTREE), extended);
            }
        }
    }

    #[test]
    fn v3_extended_flags() {
        let mut skip = SpecEntry::new(b"a", 1);
        skip.skip_worktree = true;
        let mut ita = SpecEntry::new(b"b", 2);
        ita.intent_to_add = true;
        let data = encode(3, &[skip, ita]);
        let index = Index::parse(&data).unwrap();
        assert_eq!(
            index.entries()[0].flags,
            EntryFlags::EXTENDED | EntryFlags::SKIP_WORKTREE
        );
        assert_eq!(
            index.entries()[1].flags,
            EntryFlags::EXTENDED | EntryFlags::INTENT_TO_ADD
        );
    }

    #[test]
    fn extended_flag_rejected_in_v2() {
        let mut e = SpecEntry::new(b"a", 1);
        e.skip_worktree = true;
        let data = encode(2, &[e]);
        assert!(matches!(
            Index::parse(&data),
            Err(GitError::Corrupt("index: extended flag in v2 entry"))
        ));
    }

    #[test]
    fn unknown_extended_bit_rejected() {
        let mut e = SpecEntry::new(b"a", 1);
        e.skip_worktree = true;
        let mut data = encode(3, &[e]);
        // The extended flags word sits right after the 62-byte fixed part.
        let off = INDEX_HEADER_LEN + ENTRY_FIXED_LEN;
        data[off] |= 0x10; // an undefined extended bit
        assert!(matches!(
            Index::parse(&data),
            Err(GitError::Corrupt("index: unknown extended entry flags"))
        ));
    }

    /// Version 4 prefix compression: paths sharing long prefixes round-trip.
    #[test]
    fn v4_prefix_compression_round_trip() {
        let paths: [&[u8]; 7] = [
            b"a",
            b"src/deep/nested/alpha.rs",
            b"src/deep/nested/alphabet.rs",
            b"src/deep/nested/beta.rs",
            b"src/deep/other.rs",
            b"src/main.rs",
            b"zz",
        ];
        let entries: Vec<SpecEntry> = paths
            .iter()
            .enumerate()
            .map(|(i, p)| SpecEntry::new(p, i as u8 + 1))
            .collect();
        let data = encode(4, &entries);
        let index = Index::parse(&data).unwrap();
        let got = entry_paths(&index);
        let want: Vec<Vec<u8>> = paths.iter().map(|p| p.to_vec()).collect();
        assert_eq!(got, want);
        // v4 really is smaller than v2 for these shared prefixes.
        assert!(data.len() < encode(2, &entries).len());
    }

    #[test]
    fn v4_with_extended_flags_and_long_names() {
        let mut long = SpecEntry::new(&[], 1);
        long.path = vec![b'a'; FLAG_NAME_MASK as usize + 17];
        long.intent_to_add = true;
        let mut sib = SpecEntry::new(&[], 2);
        sib.path = vec![b'a'; FLAG_NAME_MASK as usize + 17];
        sib.path.push(b'b');
        let data = encode(4, &[long.clone(), sib.clone()]);
        let index = Index::parse(&data).unwrap();
        assert_eq!(index.path(&index.entries()[0]), &long.path[..]);
        assert_eq!(index.path(&index.entries()[1]), &sib.path[..]);
        assert!(index.entries()[0].flags.contains(EntryFlags::INTENT_TO_ADD));
    }

    #[test]
    fn v2_long_name_uses_nul_scan() {
        let mut long = SpecEntry::new(&[], 1);
        long.path = vec![b'q'; FLAG_NAME_MASK as usize + 9];
        let data = encode(2, &[long.clone()]);
        let index = Index::parse(&data).unwrap();
        assert_eq!(index.path(&index.entries()[0]), &long.path[..]);
    }

    #[test]
    fn v4_strip_longer_than_previous_is_corrupt() {
        // Hand-build: one entry "ab", then an entry whose varint claims to
        // strip 3 bytes from a 2-byte previous path.
        let entries = [SpecEntry::new(b"ab", 1), SpecEntry::new(b"ac", 2)];
        let mut data = encode(4, &entries);
        // Entry 2's varint byte sits right after entry 1 (62 fixed + "ab\0")
        // and entry 2's 62-byte fixed part.
        let off = INDEX_HEADER_LEN + ENTRY_FIXED_LEN + 1 + 2 + 1 + ENTRY_FIXED_LEN;
        assert_eq!(data[off], 1, "fixture drifted: expected strip varint of 1");
        data[off] = 3;
        assert!(matches!(
            Index::parse(&data),
            Err(GitError::Corrupt("index: v4 prefix strip too long"))
        ));
    }

    #[test]
    fn unsorted_entries_rejected() {
        for version in [2u32, 3, 4] {
            let data = encode(version, &[SpecEntry::new(b"b", 1), SpecEntry::new(b"a", 2)]);
            assert!(matches!(
                Index::parse(&data),
                Err(GitError::Corrupt("index: entries not sorted"))
            ));
            // Exact duplicates (same path, same stage) are also rejected.
            let data = encode(version, &[SpecEntry::new(b"a", 1), SpecEntry::new(b"a", 2)]);
            assert!(Index::parse(&data).is_err());
        }
    }

    #[test]
    fn same_path_distinct_stages_allowed_in_order() {
        let mut s1 = SpecEntry::new(b"conflict.txt", 1);
        s1.stage = 1;
        let mut s2 = SpecEntry::new(b"conflict.txt", 2);
        s2.stage = 2;
        let mut s3 = SpecEntry::new(b"conflict.txt", 3);
        s3.stage = 3;
        let data = encode(2, &[s1, s2, s3]);
        let index = Index::parse(&data).unwrap();
        let stages: Vec<u8> = index.entries().iter().map(|e| e.stage).collect();
        assert_eq!(stages, vec![1, 2, 3]);
        assert_eq!(index.lookup(b"conflict.txt").unwrap().stage, 1);
    }

    #[test]
    fn lookup_finds_and_misses() {
        let entries = [
            SpecEntry::new(b"a", 1),
            SpecEntry::new(b"a/b", 2),
            SpecEntry::new(b"b", 3),
            SpecEntry::new(b"z/deep/file", 4),
        ];
        let data = encode(2, &entries);
        let index = Index::parse(&data).unwrap();
        for e in &entries {
            assert_eq!(index.lookup(&e.path).unwrap().oid, e.oid, "{:?}", e.path);
        }
        assert!(index.lookup(b"").is_none());
        assert!(index.lookup(b"a/").is_none());
        assert!(index.lookup(b"zz").is_none());
        assert!(index.lookup(b"z/deep").is_none());
    }

    #[test]
    fn bad_signature_and_version() {
        let mut data = encode(2, &[SpecEntry::new(b"a", 1)]);
        data[0] = b'X';
        assert!(matches!(
            Index::parse(&data),
            Err(GitError::Corrupt("index: bad signature"))
        ));
        for v in [0u32, 1, 5, u32::MAX] {
            let mut data = encode(2, &[SpecEntry::new(b"a", 1)]);
            data[4..8].copy_from_slice(&v.to_be_bytes());
            assert!(matches!(
                Index::parse(&data),
                Err(GitError::Unsupported("index version"))
            ));
        }
    }

    #[test]
    fn entry_count_lies_are_rejected() {
        let mut data = encode(2, &[SpecEntry::new(b"a", 1)]);
        data[8..12].copy_from_slice(&2u32.to_be_bytes());
        assert!(Index::parse(&data).is_err());
        data[8..12].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(matches!(
            Index::parse(&data),
            Err(GitError::TooLarge("index entry count"))
        ));
        data[8..12].copy_from_slice(&1000u32.to_be_bytes());
        assert!(matches!(
            Index::parse(&data),
            Err(GitError::Corrupt("index: entry count exceeds file size"))
        ));
    }

    /// Truncating a valid extension-free index at EVERY byte offset must
    /// produce an error, never a panic and never a silent success. (With a
    /// trailing extension, certain truncation points are indistinguishable
    /// from a shorter valid file without recomputing the SHA-1 trailer —
    /// covered by `truncation_with_extensions_never_panics`.)
    #[test]
    fn truncation_at_every_offset_errors() {
        for version in [2u32, 3, 4] {
            let mut e2 = SpecEntry::new(b"src/lib.rs", 2);
            e2.skip_worktree = version >= 3;
            let full = encode(version, &[SpecEntry::new(b"README.md", 1), e2]);
            for len in 0..full.len() {
                assert!(
                    Index::parse(&full[..len]).is_err(),
                    "v{version} truncated to {len} bytes parsed successfully"
                );
            }
            assert!(Index::parse(&full).is_ok());
        }
    }

    #[test]
    fn truncation_with_extensions_never_panics() {
        let full = encode_with_extensions(
            3,
            &[SpecEntry::new(b"README.md", 1), SpecEntry::new(b"b", 2)],
            &[(b"ZZZZ", b"opaque payload"), (b"TREE", b"\x00-1 0\n")],
        );
        assert!(Index::parse(&full).is_ok());
        for len in 0..full.len() {
            let _ = Index::parse(&full[..len]);
        }
    }

    /// Flipping single bytes must never panic. (Outcomes vary; the property
    /// under test is "no OOB / no panic".)
    #[test]
    fn single_byte_corruption_never_panics() {
        let full = encode(3, &[SpecEntry::new(b"a", 1), SpecEntry::new(b"dir/b", 2)]);
        for i in 0..full.len() {
            for delta in [1u8, 0x80, 0xff] {
                let mut data = full.clone();
                data[i] = data[i].wrapping_add(delta);
                let _ = Index::parse(&data);
            }
        }
    }

    #[test]
    fn unknown_optional_extension_skipped() {
        let data = encode_with_extensions(
            2,
            &[SpecEntry::new(b"a", 1)],
            &[(b"ABCD", b"whatever"), (b"EOIE", &[0u8; 24])],
        );
        let index = Index::parse(&data).unwrap();
        assert_eq!(index.entries().len(), 1);
    }

    #[test]
    fn mandatory_unknown_extension_rejected() {
        for (sig, expected) in [
            (b"link", "split index (link extension)"),
            (b"sdir", "sparse index (sdir extension)"),
            (b"zzzz", "mandatory index extension"),
        ] {
            let data = encode_with_extensions(2, &[SpecEntry::new(b"a", 1)], &[(sig, b"x")]);
            match Index::parse(&data) {
                Err(GitError::Unsupported(msg)) => assert_eq!(msg, expected),
                Err(other) => panic!("expected Unsupported, got {other:?}"),
                Ok(_) => panic!("expected Unsupported, parse succeeded"),
            }
        }
    }

    #[test]
    fn extension_size_overflow_rejected() {
        let mut data = encode_with_extensions(2, &[SpecEntry::new(b"a", 1)], &[(b"ABCD", b"xy")]);
        // Inflate the declared extension size beyond the file.
        let ext_size_off = data.len() - 20 - 2 - 4;
        data[ext_size_off..ext_size_off + 4].copy_from_slice(&0xffff_0000u32.to_be_bytes());
        assert!(matches!(
            Index::parse(&data),
            Err(GitError::Corrupt("index: extension size exceeds file"))
        ));
    }

    #[test]
    fn tree_extension_parsed() {
        let cache = vec![
            TreeCacheEntry {
                component: b"".to_vec(),
                entry_count: 3,
                subtree_count: 1,
                oid: Some(Oid([0xaa; 20])),
            },
            TreeCacheEntry {
                component: b"sub".to_vec(),
                entry_count: -1,
                subtree_count: 0,
                oid: None,
            },
        ];
        let payload = encode_tree_cache(&cache);
        let data = encode_with_extensions(2, &[SpecEntry::new(b"a", 1)], &[(b"TREE", &payload)]);
        let index = Index::parse(&data).unwrap();
        assert_eq!(index.tree_cache(), &cache[..]);
    }

    #[test]
    fn tree_extension_malformed() {
        let bad: &[&[u8]] = &[
            b"name-without-nul",
            b"a\x00",
            b"a\x00notanumber 0\n",
            b"a\x001 x\n",
            // entry_count >= 0 but missing oid
            b"a\x002 0\n",
            b"a\x00999999999999999999 0\n",
        ];
        for payload in bad {
            let data = encode_with_extensions(2, &[SpecEntry::new(b"a", 1)], &[(b"TREE", payload)]);
            assert!(Index::parse(&data).is_err(), "{payload:?}");
        }
    }

    #[test]
    fn empty_path_rejected() {
        let data = encode(2, &[SpecEntry::new(b"", 1)]);
        assert!(matches!(
            Index::parse(&data),
            Err(GitError::Corrupt("index: empty path"))
        ));
    }

    #[test]
    fn empty_index_struct() {
        let index = Index::empty();
        assert!(index.entries().is_empty());
        assert!(index.lookup(b"a").is_none());
        assert_eq!(index.timestamp(), None);
    }

    #[test]
    fn timestamp_set_get() {
        let mut index = Index::empty();
        index.set_timestamp(42, 7);
        assert_eq!(index.timestamp(), Some((42, 7)));
    }
}
