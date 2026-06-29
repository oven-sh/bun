//! Pack delta application.
//!
//! Format reference: `Documentation/gitformat-pack.txt`, "Deltified
//! representation": a delta begins with two size-encoded varints (source and
//! target size) followed by copy/insert instructions; the decoder mirrors
//! git's `patch-delta.c:patch_delta`.

use crate::error::GitError;
use crate::util::Reader;

/// Maximum length of a delta chain before resolution is abandoned. git's
/// own writer caps chains at `pack.depth` (default 50,
/// `Documentation/config/pack.txt`); 64 leaves headroom for repacked repos
/// while keeping recursion strictly bounded.
pub(crate) const MAX_DELTA_DEPTH: u32 = 64;

/// `cmd` bit selecting a copy instruction (`patch-delta.c`).
const COPY_INSTRUCTION: u8 = 0x80;
/// `gitformat-pack.txt`: "size zero is automatically converted to 0x10000".
const COPY_SIZE_ZERO: usize = 0x10000;

/// The two sizes at the head of a delta stream plus the header length.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct DeltaHeader {
    pub(crate) base_size: u64,
    pub(crate) result_size: u64,
    pub(crate) ops_offset: usize,
}

pub(crate) fn parse_delta_header(delta: &[u8]) -> Result<DeltaHeader, GitError> {
    let mut r = Reader::new(delta, "delta header");
    let base_size = r.read_size_varint()?;
    let result_size = r.read_size_varint()?;
    Ok(DeltaHeader {
        base_size,
        result_size,
        ops_offset: r.pos(),
    })
}

/// Apply `delta` to `base`, appending the result to a fresh vector. The
/// declared result size is capped by `max_result`; every copy/insert is
/// bounds-checked against the base, the instruction stream and the declared
/// result size.
pub(crate) fn apply_delta(
    base: &[u8],
    delta: &[u8],
    max_result: usize,
) -> Result<Vec<u8>, GitError> {
    let header = parse_delta_header(delta)?;
    if header.base_size != base.len() as u64 {
        return Err(GitError::Corrupt("delta: base size mismatch"));
    }
    if header.result_size > max_result as u64 {
        return Err(GitError::TooLarge("delta result"));
    }
    // `result_size <= max_result <= usize::MAX`.
    let result_size = header.result_size as usize;
    let mut out: Vec<u8> = Vec::new();
    out.try_reserve(result_size)
        .map_err(|_| GitError::TooLarge("delta result"))?;

    let mut r = Reader::new(delta, "delta instructions");
    r.skip(header.ops_offset)?;
    while !r.is_empty() {
        let cmd = r.read_u8()?;
        if cmd & COPY_INSTRUCTION != 0 {
            // Copy from base: bits 0-3 select which offset bytes follow,
            // bits 4-6 which size bytes (little-endian, absent bytes are 0).
            let mut offset: usize = 0;
            for bit in 0..4 {
                if cmd & (1 << bit) != 0 {
                    offset |= usize::from(r.read_u8()?) << (8 * bit);
                }
            }
            let mut size: usize = 0;
            for bit in 0..3 {
                if cmd & (1 << (4 + bit)) != 0 {
                    size |= usize::from(r.read_u8()?) << (8 * bit);
                }
            }
            if size == 0 {
                size = COPY_SIZE_ZERO;
            }
            let end = offset
                .checked_add(size)
                .ok_or(GitError::Corrupt("delta: copy overflow"))?;
            if end > base.len() {
                return Err(GitError::Corrupt("delta: copy out of bounds"));
            }
            if out.len() + size > result_size {
                return Err(GitError::Corrupt("delta: result overrun"));
            }
            out.extend_from_slice(&base[offset..end]);
        } else if cmd != 0 {
            let len = usize::from(cmd);
            let data = r.read_bytes(len)?;
            if out.len() + len > result_size {
                return Err(GitError::Corrupt("delta: result overrun"));
            }
            out.extend_from_slice(data);
        } else {
            // `patch-delta.c`: "unexpected delta opcode 0" is reserved.
            return Err(GitError::Corrupt("delta: reserved opcode 0"));
        }
    }
    if out.len() != result_size {
        return Err(GitError::Corrupt("delta: result size mismatch"));
    }
    Ok(out)
}

#[cfg(test)]
pub(crate) mod test_encode {
    use crate::util::test_encode::size_varint;

    pub(crate) enum DeltaOp<'a> {
        Copy { offset: usize, size: usize },
        Insert(&'a [u8]),
    }

    /// Mirror of `diff-delta.c`'s instruction encoding, headers included.
    pub(crate) fn encode_delta(base_size: u64, result_size: u64, ops: &[DeltaOp<'_>]) -> Vec<u8> {
        let mut out = size_varint(base_size);
        out.extend_from_slice(&size_varint(result_size));
        for op in ops {
            match op {
                DeltaOp::Copy { offset, size } => {
                    let mut cmd: u8 = 0x80;
                    let mut tail: Vec<u8> = Vec::new();
                    for bit in 0..4 {
                        let byte = ((offset >> (8 * bit)) & 0xff) as u8;
                        if byte != 0 {
                            cmd |= 1 << bit;
                            tail.push(byte);
                        }
                    }
                    // A size of 0x10000 is encoded as "no size bytes".
                    if *size != 0x10000 {
                        for bit in 0..3 {
                            let byte = ((size >> (8 * bit)) & 0xff) as u8;
                            if byte != 0 {
                                cmd |= 1 << (4 + bit);
                                tail.push(byte);
                            }
                        }
                    }
                    out.push(cmd);
                    out.extend_from_slice(&tail);
                }
                DeltaOp::Insert(data) => {
                    assert!(!data.is_empty() && data.len() <= 127);
                    out.push(data.len() as u8);
                    out.extend_from_slice(data);
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::test_encode::{DeltaOp, encode_delta};
    use super::*;

    const MAX: usize = 1 << 20;

    #[test]
    fn header_round_trip() {
        let delta = encode_delta(300, 0x12345, &[]);
        let h = parse_delta_header(&delta).unwrap();
        assert_eq!(h.base_size, 300);
        assert_eq!(h.result_size, 0x12345);
        assert_eq!(h.ops_offset, 2 + 3);
        assert!(parse_delta_header(&[]).is_err());
        assert!(parse_delta_header(&[0x80]).is_err());
    }

    #[test]
    fn insert_only() {
        let delta = encode_delta(0, 5, &[DeltaOp::Insert(b"hello")]);
        assert_eq!(apply_delta(b"", &delta, MAX).unwrap(), b"hello");
    }

    #[test]
    fn copy_only_whole_base() {
        let base = b"the quick brown fox";
        let delta = encode_delta(
            base.len() as u64,
            base.len() as u64,
            &[DeltaOp::Copy {
                offset: 0,
                size: base.len(),
            }],
        );
        assert_eq!(apply_delta(base, &delta, MAX).unwrap(), base);
    }

    #[test]
    fn mixed_copy_and_insert() {
        let base = b"0123456789abcdef";
        // "456" + "XYZ" + "abcdef"
        let delta = encode_delta(
            16,
            12,
            &[
                DeltaOp::Copy { offset: 4, size: 3 },
                DeltaOp::Insert(b"XYZ"),
                DeltaOp::Copy {
                    offset: 10,
                    size: 6,
                },
            ],
        );
        assert_eq!(apply_delta(base, &delta, MAX).unwrap(), b"456XYZabcdef");
    }

    /// Copy offsets/sizes that need 2 and 3 encoded bytes, including a low
    /// byte of zero (which the encoding omits).
    #[test]
    fn copy_with_multi_byte_offset_and_size() {
        let base: Vec<u8> = (0..0x2_0000u32).map(|i| (i % 251) as u8).collect();
        let cases: &[(usize, usize)] = &[
            (0x100, 5),
            (0x1234, 0x101),
            (0x1_0000, 0x300),
            (1, 0x10000),
            (0, 0x10000),
        ];
        for &(offset, size) in cases {
            let delta = encode_delta(
                base.len() as u64,
                size as u64,
                &[DeltaOp::Copy { offset, size }],
            );
            assert_eq!(
                apply_delta(&base, &delta, MAX).unwrap(),
                &base[offset..offset + size],
                "offset {offset:#x} size {size:#x}"
            );
        }
    }

    #[test]
    fn base_size_mismatch_is_corrupt() {
        let delta = encode_delta(4, 1, &[DeltaOp::Insert(b"x")]);
        assert!(matches!(
            apply_delta(b"abc", &delta, MAX),
            Err(GitError::Corrupt("delta: base size mismatch"))
        ));
    }

    #[test]
    fn result_size_limit_enforced() {
        let delta = encode_delta(0, 1 << 30, &[]);
        assert!(matches!(
            apply_delta(b"", &delta, 1 << 20),
            Err(GitError::TooLarge("delta result"))
        ));
    }

    #[test]
    fn declared_size_must_match_produced_size() {
        // Declares 10 bytes but only produces 5.
        let delta = encode_delta(0, 10, &[DeltaOp::Insert(b"hello")]);
        assert!(matches!(
            apply_delta(b"", &delta, MAX),
            Err(GitError::Corrupt("delta: result size mismatch"))
        ));
        // Declares 3 bytes but produces 5.
        let delta = encode_delta(0, 3, &[DeltaOp::Insert(b"hello")]);
        assert!(matches!(
            apply_delta(b"", &delta, MAX),
            Err(GitError::Corrupt("delta: result overrun"))
        ));
    }

    #[test]
    fn copy_past_end_of_base_is_corrupt() {
        let base = b"0123";
        for (offset, size) in [(0usize, 5usize), (4, 1), (3, 2), (usize::MAX, 1)] {
            let delta = encode_delta(4, size as u64, &[DeltaOp::Copy { offset, size }]);
            let err = apply_delta(base, &delta, MAX).unwrap_err();
            assert!(
                matches!(err, GitError::Corrupt(_)),
                "offset {offset} size {size}: {err:?}"
            );
        }
    }

    #[test]
    fn opcode_zero_is_corrupt() {
        let mut delta = encode_delta(0, 0, &[]);
        delta.push(0);
        assert!(matches!(
            apply_delta(b"", &delta, MAX),
            Err(GitError::Corrupt("delta: reserved opcode 0"))
        ));
    }

    #[test]
    fn truncated_instruction_streams() {
        let base = b"0123456789";
        let full = encode_delta(
            10,
            7,
            &[
                DeltaOp::Copy { offset: 2, size: 4 },
                DeltaOp::Insert(b"abc"),
            ],
        );
        assert_eq!(apply_delta(base, &full, MAX).unwrap(), b"2345abc");
        for len in 0..full.len() {
            assert!(
                apply_delta(base, &full[..len], MAX).is_err(),
                "truncated to {len}"
            );
        }
    }

    /// An empty base with an empty result is the degenerate but legal case.
    #[test]
    fn empty_delta() {
        let delta = encode_delta(0, 0, &[]);
        assert_eq!(apply_delta(b"", &delta, MAX).unwrap(), Vec::<u8>::new());
        // max_result of 0 is also fine for an empty result.
        assert_eq!(apply_delta(b"", &delta, 0).unwrap(), Vec::<u8>::new());
    }
}
