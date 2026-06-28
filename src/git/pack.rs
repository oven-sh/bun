//! Packfile (`.pack`) headers and pack index (`.idx` version 2) parsing.
//!
//! Format reference: `Documentation/gitformat-pack.txt`. Only idx version 2
//! is supported (git has written v2 by default since 1.6.0); the v1 format
//! (no magic header) is rejected as `Unsupported`.

use crate::error::GitError;
use crate::oid::{OID_RAW_LEN, Oid};
use crate::util::Reader;

/// `gitformat-pack.txt`: a v2+ idx starts with `\377tOc`.
const IDX_V2_MAGIC: [u8; 4] = [0xff, b't', b'O', b'c'];
const IDX_VERSION_2: u32 = 2;
/// Header (magic + version) + the 256-entry fan-out table.
const IDX_FANOUT_END: usize = 8 + 256 * 4;
/// Two trailing SHA-1s: the pack checksum and the idx checksum.
const IDX_TRAILER_LEN: usize = 2 * OID_RAW_LEN;
/// In the 32-bit offset table the MSB selects the large (64-bit) table.
const IDX_LARGE_OFFSET_FLAG: u32 = 0x8000_0000;

/// `gitformat-pack.txt`: pack signature, version (2 or 3), object count.
const PACK_SIGNATURE: [u8; 4] = *b"PACK";
pub(crate) const PACK_HEADER_LEN: usize = 12;
/// Size of the SHA-1 trailer at the end of a `.pack`.
pub(crate) const PACK_TRAILER_LEN: usize = OID_RAW_LEN;

/// In-pack object types (`gitformat-pack.txt`, "Object types").
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PackObjType {
    Commit,
    Tree,
    Blob,
    Tag,
    OfsDelta,
    RefDelta,
}

impl PackObjType {
    fn from_bits(bits: u8) -> Result<PackObjType, GitError> {
        Ok(match bits {
            1 => PackObjType::Commit,
            2 => PackObjType::Tree,
            3 => PackObjType::Blob,
            4 => PackObjType::Tag,
            6 => PackObjType::OfsDelta,
            7 => PackObjType::RefDelta,
            // 0 is invalid and 5 is reserved.
            _ => return Err(GitError::Corrupt("pack: invalid object type")),
        })
    }
}

/// A pack entry header: object type plus the *inflated* size (for deltas,
/// the inflated size of the delta data, not of the resolved object).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct EntryHeader {
    pub(crate) kind: PackObjType,
    pub(crate) size: u64,
    /// Length of the type/size varint itself.
    pub(crate) header_len: usize,
}

/// `packfile.c:unpack_object_header_buffer`: the first byte holds a
/// continuation bit, 3 type bits and the low 4 size bits; continuation
/// bytes add 7 size bits each.
pub(crate) fn parse_entry_header(data: &[u8]) -> Result<EntryHeader, GitError> {
    let mut r = Reader::new(data, "pack entry header");
    let mut c = r.read_u8()?;
    let kind = PackObjType::from_bits((c >> 4) & 0x7)?;
    let mut size = u64::from(c & 0x0f);
    let mut shift: u32 = 4;
    while c & 0x80 != 0 {
        if shift >= 64 {
            return Err(GitError::Corrupt("pack entry header"));
        }
        c = r.read_u8()?;
        let chunk = u64::from(c & 0x7f);
        if chunk != 0 && shift > chunk.leading_zeros() {
            return Err(GitError::Corrupt("pack entry header"));
        }
        size += chunk << shift;
        shift += 7;
    }
    Ok(EntryHeader {
        kind,
        size,
        header_len: r.pos(),
    })
}

/// The negative distance stored after an `OFS_DELTA` header
/// (`gitformat-pack.txt`: "n bytes with MSB set in all but the last one" —
/// the offset encoding). Returns `(distance, bytes_consumed)`.
pub(crate) fn parse_ofs_delta_distance(data: &[u8]) -> Result<(u64, usize), GitError> {
    let mut r = Reader::new(data, "ofs-delta distance");
    let distance = r.read_offset_varint()?;
    Ok((distance, r.pos()))
}

/// The `PACK` file header.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PackHeader {
    pub(crate) object_count: u32,
}

pub(crate) fn parse_pack_header(data: &[u8]) -> Result<PackHeader, GitError> {
    let mut r = Reader::new(data, "pack header");
    if r.read_bytes(4)? != PACK_SIGNATURE {
        return Err(GitError::Corrupt("pack: bad signature"));
    }
    let version = r.read_be32()?;
    if version != 2 && version != 3 {
        return Err(GitError::Unsupported("pack version"));
    }
    Ok(PackHeader {
        object_count: r.read_be32()?,
    })
}

/// A parsed `.idx` v2. Owns the raw bytes; lookups index into them with
/// offsets validated once at parse time.
pub(crate) struct PackIndex {
    data: Vec<u8>,
    count: usize,
    large_count: usize,
}

impl PackIndex {
    /// Validate and adopt an idx file. Every table boundary is derived from
    /// the object count and checked against the real length before any
    /// lookup trusts it.
    pub(crate) fn parse(data: Vec<u8>) -> Result<PackIndex, GitError> {
        if data.len() < IDX_FANOUT_END {
            // Too short even for a v2 header; a v1 file (no magic) is also
            // smaller than this only when empty.
            return Err(GitError::Corrupt("idx: file too short"));
        }
        if data[..4] != IDX_V2_MAGIC {
            return Err(GitError::Unsupported("idx version 1"));
        }
        let mut r = Reader::new(&data, "idx header");
        r.skip(4)?;
        if r.read_be32()? != IDX_VERSION_2 {
            return Err(GitError::Unsupported("idx version"));
        }
        let mut prev = 0u32;
        for _ in 0..256 {
            let v = r.read_be32()?;
            if v < prev {
                return Err(GitError::Corrupt("idx: fan-out not monotonic"));
            }
            prev = v;
        }
        let count = prev as usize;

        // Fixed-size tables: oids (20), crc32s (4), offsets (4).
        let fixed = IDX_FANOUT_END
            .checked_add(count.checked_mul(28).ok_or(GitError::TooLarge("idx"))?)
            .ok_or(GitError::TooLarge("idx"))?;
        let min_len = fixed
            .checked_add(IDX_TRAILER_LEN)
            .ok_or(GitError::TooLarge("idx"))?;
        if data.len() < min_len {
            return Err(GitError::Corrupt("idx: object count exceeds file size"));
        }
        let large_bytes = data.len() - min_len;
        if !large_bytes.is_multiple_of(8) {
            return Err(GitError::Corrupt("idx: misaligned large-offset table"));
        }
        let this = PackIndex {
            data,
            count,
            large_count: large_bytes / 8,
        };
        // Validate every 31-bit offset slot that points into the 64-bit
        // table now, so `offset_at` cannot read out of bounds later.
        for i in 0..count {
            let raw = this.raw_offset_at(i);
            if raw & IDX_LARGE_OFFSET_FLAG != 0
                && (raw & !IDX_LARGE_OFFSET_FLAG) as usize >= this.large_count
            {
                return Err(GitError::Corrupt("idx: large offset index out of range"));
            }
        }
        Ok(this)
    }

    pub(crate) fn count(&self) -> usize {
        self.count
    }

    fn oid_table_start(&self) -> usize {
        IDX_FANOUT_END
    }

    fn offset_table_start(&self) -> usize {
        IDX_FANOUT_END + self.count * 24
    }

    fn large_table_start(&self) -> usize {
        IDX_FANOUT_END + self.count * 28
    }

    fn fanout(&self, byte: usize) -> usize {
        let off = 8 + byte * 4;
        u32::from_be_bytes([
            self.data[off],
            self.data[off + 1],
            self.data[off + 2],
            self.data[off + 3],
        ]) as usize
    }

    /// The i-th object id (sorted ascending). `i < count`.
    pub(crate) fn oid_at(&self, i: usize) -> Oid {
        let off = self.oid_table_start() + i * OID_RAW_LEN;
        let mut raw = [0u8; OID_RAW_LEN];
        raw.copy_from_slice(&self.data[off..off + OID_RAW_LEN]);
        Oid(raw)
    }

    fn raw_offset_at(&self, i: usize) -> u32 {
        let off = self.offset_table_start() + i * 4;
        u32::from_be_bytes([
            self.data[off],
            self.data[off + 1],
            self.data[off + 2],
            self.data[off + 3],
        ])
    }

    /// The i-th object's byte offset into the `.pack`, resolving the
    /// 64-bit large-offset table. `i < count`.
    pub(crate) fn offset_at(&self, i: usize) -> u64 {
        let raw = self.raw_offset_at(i);
        if raw & IDX_LARGE_OFFSET_FLAG == 0 {
            return u64::from(raw);
        }
        // Validated in `parse`.
        let j = (raw & !IDX_LARGE_OFFSET_FLAG) as usize;
        let off = self.large_table_start() + j * 8;
        u64::from_be_bytes([
            self.data[off],
            self.data[off + 1],
            self.data[off + 2],
            self.data[off + 3],
            self.data[off + 4],
            self.data[off + 5],
            self.data[off + 6],
            self.data[off + 7],
        ])
    }

    /// Binary search within the fan-out bucket of `oid.0[0]`.
    pub(crate) fn find(&self, oid: Oid) -> Option<u64> {
        let first = oid.0[0] as usize;
        let lo = if first == 0 {
            0
        } else {
            self.fanout(first - 1)
        };
        let hi = self.fanout(first);
        if lo > hi || hi > self.count {
            // The fan-out was validated monotonic with `fanout(255)==count`,
            // so this is unreachable; guard anyway rather than slice OOB.
            return None;
        }
        let mut lo = lo;
        let mut hi = hi;
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            match self.oid_at(mid).0.cmp(&oid.0) {
                core::cmp::Ordering::Less => lo = mid + 1,
                core::cmp::Ordering::Greater => hi = mid,
                core::cmp::Ordering::Equal => return Some(self.offset_at(mid)),
            }
        }
        None
    }
}

#[cfg(test)]
pub(crate) mod test_encode {
    use super::*;

    /// Build a v2 `.idx` from `(oid, offset)` pairs. Offsets >= 2^31 are
    /// routed through the large-offset table exactly as
    /// `pack-write.c:write_idx_file` does. Trailing checksums are zeros
    /// (`PackIndex::parse` does not recompute them).
    pub(crate) fn encode_idx(entries: &[(Oid, u64)]) -> Vec<u8> {
        let mut sorted = entries.to_vec();
        sorted.sort_by_key(|e| e.0.0);
        let mut out = Vec::new();
        out.extend_from_slice(&IDX_V2_MAGIC);
        out.extend_from_slice(&IDX_VERSION_2.to_be_bytes());
        let mut cumulative = 0u32;
        for byte in 0..256usize {
            cumulative += sorted
                .iter()
                .filter(|(o, _)| o.0[0] as usize == byte)
                .count() as u32;
            out.extend_from_slice(&cumulative.to_be_bytes());
        }
        for (oid, _) in &sorted {
            out.extend_from_slice(&oid.0);
        }
        for _ in &sorted {
            out.extend_from_slice(&0u32.to_be_bytes()); // CRC32 (unchecked)
        }
        let mut large: Vec<u64> = Vec::new();
        for (_, offset) in &sorted {
            if *offset < u64::from(IDX_LARGE_OFFSET_FLAG) {
                out.extend_from_slice(&(*offset as u32).to_be_bytes());
            } else {
                let idx = large.len() as u32;
                out.extend_from_slice(&(idx | IDX_LARGE_OFFSET_FLAG).to_be_bytes());
                large.push(*offset);
            }
        }
        for v in &large {
            out.extend_from_slice(&v.to_be_bytes());
        }
        out.extend_from_slice(&[0u8; IDX_TRAILER_LEN]);
        out
    }

    /// `unpack_object_header_buffer`'s inverse: the entry type/size varint.
    pub(crate) fn encode_entry_header(kind: PackObjType, mut size: u64) -> Vec<u8> {
        let type_bits: u8 = match kind {
            PackObjType::Commit => 1,
            PackObjType::Tree => 2,
            PackObjType::Blob => 3,
            PackObjType::Tag => 4,
            PackObjType::OfsDelta => 6,
            PackObjType::RefDelta => 7,
        };
        let mut out = Vec::new();
        let mut byte = (type_bits << 4) | (size & 0x0f) as u8;
        size >>= 4;
        while size != 0 {
            out.push(byte | 0x80);
            byte = (size & 0x7f) as u8;
            size >>= 7;
        }
        out.push(byte);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::test_encode::{encode_entry_header, encode_idx};
    use super::*;

    fn oid_n(n: u8) -> Oid {
        let mut raw = [n; 20];
        raw[19] = n.wrapping_add(1);
        Oid(raw)
    }

    #[test]
    fn entry_header_round_trip() {
        let kinds = [
            PackObjType::Commit,
            PackObjType::Tree,
            PackObjType::Blob,
            PackObjType::Tag,
            PackObjType::OfsDelta,
            PackObjType::RefDelta,
        ];
        let sizes = [
            0u64,
            1,
            15,
            16,
            127,
            128,
            2047,
            2048,
            0xff_ffff,
            u64::from(u32::MAX),
            1 << 40,
            u64::MAX,
        ];
        for &kind in &kinds {
            for &size in &sizes {
                let enc = encode_entry_header(kind, size);
                let parsed = parse_entry_header(&enc).unwrap();
                assert_eq!(parsed.kind, kind, "{kind:?} {size}");
                assert_eq!(parsed.size, size, "{kind:?} {size}");
                assert_eq!(parsed.header_len, enc.len());
                // Trailing bytes after the header must not be consumed.
                let mut padded = enc.clone();
                padded.extend_from_slice(b"zzzz");
                assert_eq!(parse_entry_header(&padded).unwrap().header_len, enc.len());
            }
        }
    }

    #[test]
    fn entry_header_known_bytes() {
        // Blob (type 3), size 5: 0b0_011_0101.
        let parsed = parse_entry_header(&[0x35]).unwrap();
        assert_eq!(parsed.kind, PackObjType::Blob);
        assert_eq!(parsed.size, 5);
        // Commit (type 1), size 16: 0b1_001_0000, 0b0000_0001.
        let parsed = parse_entry_header(&[0x90, 0x01]).unwrap();
        assert_eq!(parsed.kind, PackObjType::Commit);
        assert_eq!(parsed.size, 16);
        assert_eq!(parsed.header_len, 2);
    }

    #[test]
    fn entry_header_rejects_bad_input() {
        assert!(parse_entry_header(&[]).is_err());
        // Continuation byte missing.
        assert!(parse_entry_header(&[0xb0]).is_err());
        // Types 0 and 5.
        assert!(parse_entry_header(&[0x05]).is_err());
        assert!(parse_entry_header(&[0x55]).is_err());
        // Size overflow (11 continuation bytes).
        let bomb = [0xffu8; 16];
        assert!(parse_entry_header(&bomb).is_err());
    }

    #[test]
    fn ofs_delta_distance_parses() {
        let enc = crate::util::test_encode::offset_varint(0x1234);
        let (dist, used) = parse_ofs_delta_distance(&enc).unwrap();
        assert_eq!(dist, 0x1234);
        assert_eq!(used, enc.len());
        assert!(parse_ofs_delta_distance(&[]).is_err());
        assert!(parse_ofs_delta_distance(&[0x80]).is_err());
    }

    #[test]
    fn pack_header_parses() {
        let mut data = b"PACK".to_vec();
        data.extend_from_slice(&2u32.to_be_bytes());
        data.extend_from_slice(&7u32.to_be_bytes());
        assert_eq!(parse_pack_header(&data).unwrap().object_count, 7);
        data[7] = 3;
        assert_eq!(parse_pack_header(&data).unwrap().object_count, 7);
        data[7] = 1;
        assert!(matches!(
            parse_pack_header(&data),
            Err(GitError::Unsupported("pack version"))
        ));
        assert!(parse_pack_header(b"JUNK").is_err());
        assert!(parse_pack_header(b"").is_err());
        let bad_sig = b"PaCK\x00\x00\x00\x02\x00\x00\x00\x01";
        assert!(matches!(
            parse_pack_header(bad_sig),
            Err(GitError::Corrupt("pack: bad signature"))
        ));
    }

    #[test]
    fn idx_round_trip_and_lookup() {
        // Cover the first bucket (0x00), a middle bucket with several
        // entries, and the last bucket (0xff).
        let mut entries: Vec<(Oid, u64)> = vec![
            (Oid([0x00; 20]), 12),
            (oid_n(0x42), 100),
            (Oid([0x42; 20]), 200),
            (oid_n(0x43), 300),
            (Oid([0xff; 20]), 400),
        ];
        entries.sort_by_key(|e| e.0.0);
        let idx = PackIndex::parse(encode_idx(&entries)).unwrap();
        assert_eq!(idx.count(), entries.len());
        for (i, (oid, offset)) in entries.iter().enumerate() {
            assert_eq!(idx.oid_at(i), *oid);
            assert_eq!(idx.offset_at(i), *offset);
            assert_eq!(idx.find(*oid), Some(*offset), "{oid}");
        }
        // Present bucket, absent oid.
        let mut probe = oid_n(0x42);
        probe.0[19] ^= 0xff;
        assert_eq!(idx.find(probe), None);
        // Empty bucket.
        assert_eq!(idx.find(Oid([0x07; 20])), None);
        assert_eq!(idx.find(Oid([0xfe; 20])), None);
    }

    #[test]
    fn idx_empty() {
        let idx = PackIndex::parse(encode_idx(&[])).unwrap();
        assert_eq!(idx.count(), 0);
        assert_eq!(idx.find(Oid([0; 20])), None);
        assert_eq!(idx.find(Oid([0xff; 20])), None);
    }

    #[test]
    fn idx_large_offsets() {
        let big_a = (1u64 << 31) + 17;
        let big_b = 1u64 << 40;
        let entries = vec![
            (oid_n(0x01), 12),
            (oid_n(0x80), big_a),
            (oid_n(0x90), 0x7fff_ffff),
            (oid_n(0xa0), big_b),
        ];
        let idx = PackIndex::parse(encode_idx(&entries)).unwrap();
        assert_eq!(idx.large_count, 2);
        assert_eq!(idx.find(oid_n(0x80)), Some(big_a));
        assert_eq!(idx.find(oid_n(0x90)), Some(0x7fff_ffff));
        assert_eq!(idx.find(oid_n(0xa0)), Some(big_b));
        assert_eq!(idx.find(oid_n(0x01)), Some(12));
    }

    #[test]
    fn idx_truncation_at_every_offset_errors() {
        let entries = vec![(oid_n(0x01), 12), (oid_n(0x80), (1u64 << 31) + 17)];
        let full = encode_idx(&entries);
        for len in 0..full.len() {
            assert!(PackIndex::parse(full[..len].to_vec()).is_err(), "len {len}");
        }
        assert!(PackIndex::parse(full).is_ok());
    }

    #[test]
    fn idx_rejects_v1_and_bad_version() {
        // v1 files have no magic; they start straight with the fan-out.
        let v1 = vec![0u8; IDX_FANOUT_END + IDX_TRAILER_LEN];
        assert!(matches!(
            PackIndex::parse(v1),
            Err(GitError::Unsupported("idx version 1"))
        ));
        let mut bad = encode_idx(&[]);
        bad[7] = 3;
        assert!(matches!(
            PackIndex::parse(bad),
            Err(GitError::Unsupported("idx version"))
        ));
    }

    #[test]
    fn idx_rejects_non_monotonic_fanout() {
        let mut data = encode_idx(&[(oid_n(0x01), 1)]);
        // Bucket 0x01 holds the single entry; zero a later bucket.
        let off = 8 + 0x80 * 4;
        data[off..off + 4].copy_from_slice(&0u32.to_be_bytes());
        assert!(matches!(
            PackIndex::parse(data),
            Err(GitError::Corrupt("idx: fan-out not monotonic"))
        ));
    }

    #[test]
    fn idx_rejects_lying_object_count() {
        let mut data = encode_idx(&[(oid_n(0x01), 1)]);
        // Inflate every fan-out bucket from 0x01 onward to claim 1000 objects.
        for byte in 0x01..256usize {
            let off = 8 + byte * 4;
            data[off..off + 4].copy_from_slice(&1000u32.to_be_bytes());
        }
        assert!(matches!(
            PackIndex::parse(data),
            Err(GitError::Corrupt("idx: object count exceeds file size"))
        ));
    }

    #[test]
    fn idx_rejects_out_of_range_large_offset_index() {
        let entries = vec![(oid_n(0x01), (1u64 << 31) + 5)];
        let mut data = encode_idx(&entries);
        // The single 31-bit offset slot points at large index 0; there is
        // exactly one large entry. Point it at index 1 instead.
        let off = IDX_FANOUT_END + 24;
        data[off..off + 4].copy_from_slice(&(IDX_LARGE_OFFSET_FLAG | 1).to_be_bytes());
        assert!(matches!(
            PackIndex::parse(data),
            Err(GitError::Corrupt("idx: large offset index out of range"))
        ));
    }

    #[test]
    fn idx_rejects_misaligned_large_table() {
        let mut data = encode_idx(&[(oid_n(0x01), 1)]);
        let trailer_start = data.len() - IDX_TRAILER_LEN;
        data.splice(trailer_start..trailer_start, [0u8; 3]);
        assert!(matches!(
            PackIndex::parse(data),
            Err(GitError::Corrupt("idx: misaligned large-offset table"))
        ));
    }
}
