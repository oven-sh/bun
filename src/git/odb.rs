//! Object database: loose objects (`objects/xx/yyyy...`) and packfiles
//! (`objects/pack/*.{pack,idx}`).
//!
//! Format references: `Documentation/gitformat-pack.txt` and the loose
//! object format (`Documentation/gitformat-loose`,
//! `object-file.c:loose_object_info`): a zlib stream of
//! `"<type> <size>\0" + body`.
//!
//! `objects/info/alternates` is intentionally not followed: an alternate
//! points at an arbitrary other path on disk and the FileIndex use case
//! (status/diff of one work tree) never needs it. Objects only reachable
//! through an alternate report `MissingObject`.
//!
//! Inflation goes through libdeflate (a C symbol only present in the final
//! CMake link), so nothing in this module's inflating paths is reachable
//! from a `#[test]`; the pure parsers above them are.

use crate::delta::{MAX_DELTA_DEPTH, apply_delta};
use crate::error::GitError;
use crate::oid::{OID_HEX_LEN, OID_RAW_LEN, Oid};
use crate::pack::{
    PACK_HEADER_LEN, PACK_TRAILER_LEN, PackIndex, PackObjType, parse_entry_header,
    parse_ofs_delta_distance, parse_pack_header,
};
use crate::util::{checked_usize, join_path, parse_decimal};
use bun_libdeflate_sys::libdeflate::{Encoding, OwnedDecompressor, Status};
use bun_sys::{E, Fd, File, O};

/// Hard ceiling on a single fully-inflated object (and on every
/// intermediate delta-chain result). Objects past this are rejected with
/// `TooLarge` rather than ballooning memory on hostile input.
pub const MAX_OBJECT_SIZE: usize = 1 << 30;
/// A loose object file whose *compressed* size exceeds this cannot inflate
/// to something acceptable either.
const MAX_LOOSE_FILE_SIZE: usize = MAX_OBJECT_SIZE;
/// `"<type> <size>\0"` is at most `"commit" + " " + 20 digits + NUL`.
const MAX_LOOSE_HEADER: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ObjectKind {
    Commit,
    Tree,
    Blob,
    Tag,
}

impl ObjectKind {
    pub(crate) fn from_name(name: &[u8]) -> Option<ObjectKind> {
        Some(match name {
            b"commit" => ObjectKind::Commit,
            b"tree" => ObjectKind::Tree,
            b"blob" => ObjectKind::Blob,
            b"tag" => ObjectKind::Tag,
            _ => return None,
        })
    }

    pub fn name(self) -> &'static [u8] {
        match self {
            ObjectKind::Commit => b"commit",
            ObjectKind::Tree => b"tree",
            ObjectKind::Blob => b"blob",
            ObjectKind::Tag => b"tag",
        }
    }
}

/// `None` for the two delta representations (which have no kind of their
/// own — they take their base's).
fn object_kind_of(t: PackObjType) -> Option<ObjectKind> {
    match t {
        PackObjType::Commit => Some(ObjectKind::Commit),
        PackObjType::Tree => Some(ObjectKind::Tree),
        PackObjType::Blob => Some(ObjectKind::Blob),
        PackObjType::Tag => Some(ObjectKind::Tag),
        PackObjType::OfsDelta | PackObjType::RefDelta => None,
    }
}

/// Split the inflated prefix of a loose object into
/// `(kind, declared size, body offset)`.
pub(crate) fn parse_loose_header(data: &[u8]) -> Result<(ObjectKind, u64, usize), GitError> {
    let window = &data[..data.len().min(MAX_LOOSE_HEADER)];
    let nul = memchr::memchr(0, window).ok_or(GitError::Corrupt("loose object header"))?;
    let header = &window[..nul];
    let space = memchr::memchr(b' ', header).ok_or(GitError::Corrupt("loose object header"))?;
    let kind =
        ObjectKind::from_name(&header[..space]).ok_or(GitError::Corrupt("loose object type"))?;
    let size = parse_decimal(&header[space + 1..]).ok_or(GitError::Corrupt("loose object size"))?;
    Ok((kind, size, nul + 1))
}

/// `objects/xx/yyyy...` for a loose object.
pub(crate) fn loose_object_path(objects_dir: &[u8], oid: Oid) -> Vec<u8> {
    let hex = oid.to_hex();
    let mut out = Vec::with_capacity(objects_dir.len() + OID_HEX_LEN + 3);
    out.extend_from_slice(objects_dir);
    out.push(b'/');
    out.extend_from_slice(&hex[..2]);
    out.push(b'/');
    out.extend_from_slice(&hex[2..]);
    out
}

struct Pack {
    idx: PackIndex,
    file: File,
    size: u64,
}

/// The object store rooted at `<common dir>/objects`.
pub struct Odb {
    objects_dir: Vec<u8>,
    packs: Vec<Pack>,
}

impl Odb {
    /// Open `<common_dir>/objects`, loading every `objects/pack/*.idx`.
    /// `.idx` files without a matching `.pack` are skipped (git does the
    /// same); a structurally invalid `.idx` is an error.
    pub(crate) fn open(common_dir: &[u8]) -> Result<Odb, GitError> {
        let objects_dir = join_path(common_dir, b"objects");
        let pack_dir = join_path(&objects_dir, b"pack");
        let mut packs = Vec::new();
        let dir_fd = match bun_sys::open_dir_for_iteration(Fd::cwd(), &pack_dir) {
            Ok(fd) => Some(bun_sys::Dir::from_fd(fd)),
            Err(err) if err.get_errno() == E::ENOENT || err.get_errno() == E::ENOTDIR => None,
            Err(err) => return Err(err.into()),
        };
        if let Some(dir) = dir_fd {
            let mut names: Vec<Vec<u8>> = Vec::new();
            let mut iter = bun_sys::iterate_dir(dir.fd());
            while let Some(entry) = iter.next().map_err(GitError::Io)? {
                let name = entry.name.slice_u8();
                if name.ends_with(b".idx") {
                    names.push(name.to_vec());
                }
            }
            // Deterministic pack order (directory order is arbitrary).
            names.sort_unstable();
            for name in names {
                let idx_path = join_path(&pack_dir, &name);
                let mut pack_path = idx_path.clone();
                pack_path.truncate(pack_path.len() - b"idx".len());
                pack_path.extend_from_slice(b"pack");
                let pack_file = match File::openat(Fd::cwd(), &pack_path, O::RDONLY, 0) {
                    Ok(f) => f,
                    Err(err) if err.get_errno() == E::ENOENT => continue,
                    Err(err) => return Err(err.into()),
                };
                let idx_bytes = File::read_from(Fd::cwd(), &idx_path)?;
                let idx = PackIndex::parse(idx_bytes)?;
                let size = pack_file.get_end_pos()? as u64;
                let mut header = [0u8; PACK_HEADER_LEN];
                let got = pack_file.pread_all(&mut header, 0)?;
                let parsed = parse_pack_header(&header[..got])?;
                if parsed.object_count as usize != idx.count() {
                    return Err(GitError::Corrupt("pack: object count disagrees with idx"));
                }
                packs.push(Pack {
                    idx,
                    file: pack_file,
                    size,
                });
            }
        }
        Ok(Odb { objects_dir, packs })
    }

    pub fn pack_count(&self) -> usize {
        self.packs.len()
    }

    /// Read and fully materialize an object into `out` (replacing its
    /// contents). Returns the object's kind.
    pub fn read(&self, oid: Oid, out: &mut Vec<u8>) -> Result<ObjectKind, GitError> {
        self.read_with_depth(oid, out, 0)
    }

    /// Object kind and size. For non-delta pack entries this needs only the
    /// entry header. Deltified objects are fully materialized (their final
    /// size requires resolving the chain), as are loose objects (libdeflate
    /// is a one-shot decoder; there is no partial-inflate path).
    pub fn kind_and_size(&self, oid: Oid) -> Result<(ObjectKind, u64), GitError> {
        if let Some(file) = self.open_loose(oid)? {
            let mut body = Vec::new();
            let kind = read_loose(&file, &mut body)?;
            return Ok((kind, body.len() as u64));
        }
        for pack in &self.packs {
            if let Some(offset) = pack.idx.find(oid) {
                let (header, _, _) = read_entry_header(pack, offset)?;
                if let Some(kind) = object_kind_of(header.kind) {
                    return Ok((kind, header.size));
                }
                let mut out = Vec::new();
                let kind = self.read_pack_at(pack, offset, &mut out, 0)?;
                return Ok((kind, out.len() as u64));
            }
        }
        Err(GitError::MissingObject(oid))
    }

    fn read_with_depth(
        &self,
        oid: Oid,
        out: &mut Vec<u8>,
        depth: u32,
    ) -> Result<ObjectKind, GitError> {
        if let Some(file) = self.open_loose(oid)? {
            return read_loose(&file, out);
        }
        for pack in &self.packs {
            if let Some(offset) = pack.idx.find(oid) {
                return self.read_pack_at(pack, offset, out, depth);
            }
        }
        Err(GitError::MissingObject(oid))
    }

    fn open_loose(&self, oid: Oid) -> Result<Option<File>, GitError> {
        let path = loose_object_path(&self.objects_dir, oid);
        match File::openat(Fd::cwd(), &path, O::RDONLY, 0) {
            Ok(f) => Ok(Some(f)),
            Err(err) if err.get_errno() == E::ENOENT || err.get_errno() == E::ENOTDIR => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    /// Materialize the object at `offset` in `pack`, resolving delta chains
    /// up to [`MAX_DELTA_DEPTH`]. Recursion depth is exactly the (checked)
    /// chain depth.
    fn read_pack_at(
        &self,
        pack: &Pack,
        offset: u64,
        out: &mut Vec<u8>,
        depth: u32,
    ) -> Result<ObjectKind, GitError> {
        if depth >= MAX_DELTA_DEPTH {
            return Err(GitError::TooLarge("delta chain depth"));
        }
        let (header, raw, raw_len) = read_entry_header(pack, offset)?;
        let raw = &raw[..raw_len];
        let size = checked_usize(header.size, "pack object size")?;
        if size > MAX_OBJECT_SIZE {
            return Err(GitError::TooLarge("pack object size"));
        }
        let mut data_offset = offset + header.header_len as u64;
        match header.kind {
            PackObjType::Commit | PackObjType::Tree | PackObjType::Blob | PackObjType::Tag => {
                inflate_pack_entry(&pack.file, data_offset, pack.size, size, out)?;
                // `object_kind_of` is total for the four base kinds.
                object_kind_of(header.kind).ok_or(GitError::Corrupt("pack: object type"))
            }
            PackObjType::OfsDelta => {
                let (distance, used) = parse_ofs_delta_distance(&raw[header.header_len..])?;
                data_offset += used as u64;
                if distance == 0 || distance > offset {
                    return Err(GitError::Corrupt("pack: ofs-delta base before pack start"));
                }
                let base_offset = offset - distance;
                let mut delta = Vec::new();
                inflate_pack_entry(&pack.file, data_offset, pack.size, size, &mut delta)?;
                let mut base = Vec::new();
                let kind = self.read_pack_at(pack, base_offset, &mut base, depth + 1)?;
                *out = apply_delta(&base, &delta, MAX_OBJECT_SIZE)?;
                Ok(kind)
            }
            PackObjType::RefDelta => {
                let after = &raw[header.header_len..];
                if after.len() < OID_RAW_LEN {
                    return Err(GitError::Corrupt("pack: truncated ref-delta base id"));
                }
                let mut base_oid = [0u8; OID_RAW_LEN];
                base_oid.copy_from_slice(&after[..OID_RAW_LEN]);
                let base_oid = Oid(base_oid);
                data_offset += OID_RAW_LEN as u64;
                let mut delta = Vec::new();
                inflate_pack_entry(&pack.file, data_offset, pack.size, size, &mut delta)?;
                let mut base = Vec::new();
                // The base is usually in the same pack; fall back to a full
                // object lookup for thin-pack leftovers.
                let kind = match pack.idx.find(base_oid) {
                    Some(base_offset) => {
                        self.read_pack_at(pack, base_offset, &mut base, depth + 1)?
                    }
                    None => self.read_with_depth(base_oid, &mut base, depth + 1)?,
                };
                *out = apply_delta(&base, &delta, MAX_OBJECT_SIZE)?;
                Ok(kind)
            }
        }
    }
}

/// Read and parse the type/size header of the entry at `offset`, returning
/// the parsed header plus the raw bytes (the ofs-delta varint / ref-delta
/// base id follow the header in `raw[..len]`).
fn read_entry_header(
    pack: &Pack,
    offset: u64,
) -> Result<(crate::pack::EntryHeader, [u8; 64], usize), GitError> {
    let data_end = pack.size.saturating_sub(PACK_TRAILER_LEN as u64);
    if offset < PACK_HEADER_LEN as u64 || offset >= data_end {
        return Err(GitError::Corrupt("pack: entry offset out of range"));
    }
    let mut buf = [0u8; 64];
    let got = pack
        .file
        .pread_all(&mut buf, offset)
        .map_err(GitError::Io)?;
    let header = parse_entry_header(&buf[..got])?;
    Ok((header, buf, got))
}

fn read_loose(file: &File, out: &mut Vec<u8>) -> Result<ObjectKind, GitError> {
    let file_size = file.get_end_pos().map_err(GitError::Io)?;
    if file_size > MAX_LOOSE_FILE_SIZE {
        return Err(GitError::TooLarge("loose object file"));
    }
    let raw = file.read_to_end().map_err(GitError::Io)?;
    inflate_all(&raw, MAX_OBJECT_SIZE + MAX_LOOSE_HEADER, out)?;
    let (kind, size, body_start) = parse_loose_header(out)?;
    if size != (out.len() - body_start) as u64 {
        return Err(GitError::Corrupt("loose object size mismatch"));
    }
    out.drain(..body_start);
    Ok(kind)
}

fn new_decompressor() -> Result<OwnedDecompressor, GitError> {
    OwnedDecompressor::new().ok_or(GitError::OutOfMemory)
}

/// Upper bound on the byte length of a zlib stream whose inflated size is
/// `expected`: a deflate stream is at worst a sequence of stored blocks
/// (5-byte header per <= 65535-byte block, RFC 1951 section 3.2.4) inside
/// the 2-byte zlib header + 4-byte Adler-32 trailer (RFC 1950). The slack
/// also covers the degenerate empty stream. A (hostile) stream longer than
/// this bound is rejected rather than read without limit.
fn zlib_stream_bound(expected: usize) -> usize {
    expected
        .saturating_add(5 * (expected / 65535 + 1))
        .saturating_add(64)
}

/// Inflate a complete in-memory zlib stream of unknown decoded size
/// (loose objects). Trailing bytes after the stream end are ignored.
fn inflate_all(input: &[u8], max_output: usize, out: &mut Vec<u8>) -> Result<(), GitError> {
    let mut dec = new_decompressor()?;
    out.clear();
    // Pre-size for the common case so the doubling retry loop (which
    // restarts decompression from scratch each round) rarely iterates.
    out.try_reserve(input.len().saturating_mul(4).clamp(4096, max_output))
        .map_err(|_| GitError::OutOfMemory)?;
    let result = dec.decompress_to_vec_grow(input, out, Encoding::Zlib, max_output);
    match result.status {
        Status::Success => Ok(()),
        Status::InsufficientSpace => Err(GitError::TooLarge("loose object")),
        Status::BadData | Status::ShortOutput => Err(GitError::Corrupt("zlib stream")),
    }
}

/// Inflate the zlib stream of a pack entry starting at `offset`, whose
/// decoded size is declared (`expected`) but whose compressed length is
/// not. At most `zlib_stream_bound(expected)` compressed bytes are read.
fn inflate_pack_entry(
    file: &File,
    offset: u64,
    file_size: u64,
    expected: usize,
    out: &mut Vec<u8>,
) -> Result<(), GitError> {
    if offset >= file_size {
        return Err(GitError::Corrupt("pack: truncated zlib stream"));
    }
    let available = checked_usize(file_size - offset, "pack size")?;
    let take = zlib_stream_bound(expected).min(available);
    let mut compressed = Vec::new();
    compressed
        .try_reserve_exact(take)
        .map_err(|_| GitError::OutOfMemory)?;
    compressed.resize(take, 0);
    let got = file
        .pread_all(&mut compressed, offset)
        .map_err(GitError::Io)?;
    compressed.truncate(got);
    out.clear();
    out.try_reserve_exact(expected)
        .map_err(|_| GitError::OutOfMemory)?;
    out.resize(expected, 0);
    let mut dec = new_decompressor()?;
    let result = dec.zlib(&compressed, &mut out[..]);
    if result.status != Status::Success || result.written != expected {
        return Err(GitError::Corrupt("pack: bad object stream"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn object_kind_names_round_trip() {
        for kind in [
            ObjectKind::Commit,
            ObjectKind::Tree,
            ObjectKind::Blob,
            ObjectKind::Tag,
        ] {
            assert_eq!(ObjectKind::from_name(kind.name()), Some(kind));
        }
        assert_eq!(ObjectKind::from_name(b""), None);
        assert_eq!(ObjectKind::from_name(b"BLOB"), None);
        assert_eq!(ObjectKind::from_name(b"blobs"), None);
    }

    #[test]
    fn loose_header_parses() {
        let cases: &[(&[u8], ObjectKind, u64, usize)] = &[
            (b"blob 0\x00", ObjectKind::Blob, 0, 7),
            (b"blob 12\x00hello world!", ObjectKind::Blob, 12, 8),
            (b"tree 4096\x00...", ObjectKind::Tree, 4096, 10),
            (b"commit 217\x00tree ", ObjectKind::Commit, 217, 11),
            (b"tag 9\x00", ObjectKind::Tag, 9, 6),
        ];
        for (data, kind, size, body) in cases {
            assert_eq!(
                parse_loose_header(data).unwrap(),
                (*kind, *size, *body),
                "{data:?}"
            );
        }
    }

    #[test]
    fn loose_header_rejects_garbage() {
        let bad: &[&[u8]] = &[
            b"",
            b"blob 5",                                      // no NUL
            b"blob\x00",                                    // no space
            b"blob \x00",                                   // empty size
            b"blob -5\x00",                                 // negative
            b"blob 5x\x00",                                 // trailing junk in the size
            b"blob 99999999999999999999999\x00",            // > 20 digits
            b"bolb 5\x00",                                  // unknown type
            b" 5\x00",                                      // empty type
            b"blob 5555555555555555555555555555555555\x00", // NUL past the 32-byte window
        ];
        for data in bad {
            assert!(parse_loose_header(data).is_err(), "{data:?}");
        }
    }

    #[test]
    fn loose_path_layout() {
        let oid = Oid::from_hex(b"0123456789abcdef0123456789abcdef01234567").unwrap();
        assert_eq!(
            loose_object_path(b"/repo/.git/objects", oid),
            b"/repo/.git/objects/01/23456789abcdef0123456789abcdef01234567"
        );
    }

    #[test]
    fn pack_type_to_object_kind() {
        assert_eq!(
            object_kind_of(PackObjType::Commit),
            Some(ObjectKind::Commit)
        );
        assert_eq!(object_kind_of(PackObjType::Tree), Some(ObjectKind::Tree));
        assert_eq!(object_kind_of(PackObjType::Blob), Some(ObjectKind::Blob));
        assert_eq!(object_kind_of(PackObjType::Tag), Some(ObjectKind::Tag));
        assert_eq!(object_kind_of(PackObjType::OfsDelta), None);
        assert_eq!(object_kind_of(PackObjType::RefDelta), None);
    }
}
