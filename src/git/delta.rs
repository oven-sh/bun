//! Git delta encoding — `diff-delta.c` / `patch-delta.c`.
//!
//! A delta stream is:
//!   * base object size   (LE varint, 7 bits per byte, MSB = continue)
//!   * result object size (same encoding)
//!   * a sequence of instructions until the stream is exhausted:
//!       - **copy** (`op & 0x80`): low 7 bits are a presence mask for up to
//!         4 little-endian offset bytes (bits 0‥3) and 3 length bytes
//!         (bits 4‥6). A decoded length of 0 means **0x10000** (special-cased
//!         in git so a 64 KiB copy fits in zero length bytes).
//!       - **insert** (`op < 0x80`, `op != 0`): the next `op` bytes are
//!         literal data to append.
//!       - `op == 0` is reserved; git's `patch-delta.c` rejects it.
//!
//! Every offset/length is bounds-checked against the declared sizes before any
//! copy — the delta stream is attacker-controlled (it came off the wire).

use crate::{Error, Result};

/// Decoded varint header `(base_size, result_size, header_len)`.
pub(crate) fn header(delta: &[u8]) -> Result<(u64, u64, usize)> {
    let (base, n0) = read_varint(delta)?;
    let (res, n1) = read_varint(&delta[n0..])?;
    Ok((base, res, n0 + n1))
}

/// Apply `delta` to `base`, writing into `out` (cleared first). `out.len()` on
/// return equals the header's result size.
pub(crate) fn apply(base: &[u8], delta: &[u8], out: &mut Vec<u8>) -> Result<()> {
    let (base_size, result_size, hdr) = header(delta)?;
    if base_size != base.len() as u64 {
        return Err(Error::Pack(format!(
            "delta base size mismatch: header says {base_size}, base is {}",
            base.len()
        )));
    }
    // Refuse absurd result sizes before reserving — `result_size` is
    // attacker-controlled.
    let result_size = usize::try_from(result_size)
        .map_err(|_| Error::Pack("delta result size overflows usize".into()))?;
    out.clear();
    out.reserve_exact(result_size);

    let mut i = hdr;
    while i < delta.len() {
        let op = delta[i];
        i += 1;
        if op & 0x80 != 0 {
            // copy-from-base
            let mut off: u64 = 0;
            let mut len: u64 = 0;
            for bit in 0..4 {
                if op & (1 << bit) != 0 {
                    let b = *delta.get(i).ok_or_else(trunc)?;
                    i += 1;
                    off |= u64::from(b) << (8 * bit);
                }
            }
            for bit in 0..3 {
                if op & (1 << (4 + bit)) != 0 {
                    let b = *delta.get(i).ok_or_else(trunc)?;
                    i += 1;
                    len |= u64::from(b) << (8 * bit);
                }
            }
            if len == 0 {
                len = 0x10000;
            }
            let end = off
                .checked_add(len)
                .ok_or_else(|| Error::Pack("delta copy range overflow".into()))?;
            if end > base.len() as u64 {
                return Err(Error::Pack(format!(
                    "delta copy [{off}, {end}) out of base bounds {}",
                    base.len()
                )));
            }
            if out.len() as u64 + len > result_size as u64 {
                return Err(Error::Pack("delta copy overruns result size".into()));
            }
            out.extend_from_slice(&base[off as usize..end as usize]);
        } else if op > 0 {
            // insert-literal
            let n = usize::from(op);
            let lit = delta.get(i..i + n).ok_or_else(trunc)?;
            i += n;
            if out.len() + n > result_size {
                return Err(Error::Pack("delta insert overruns result size".into()));
            }
            out.extend_from_slice(lit);
        } else {
            return Err(Error::Pack("delta op 0x00 is reserved".into()));
        }
    }

    if out.len() != result_size {
        return Err(Error::Pack(format!(
            "delta produced {} bytes, header says {result_size}",
            out.len()
        )));
    }
    Ok(())
}

fn read_varint(buf: &[u8]) -> Result<(u64, usize)> {
    let mut val = 0u64;
    let mut shift = 0u32;
    for (i, &b) in buf.iter().enumerate() {
        if shift >= 64 {
            return Err(Error::Pack("delta varint too long".into()));
        }
        val |= u64::from(b & 0x7f) << shift;
        if b & 0x80 == 0 {
            return Ok((val, i + 1));
        }
        shift += 7;
    }
    Err(trunc())
}

#[cold]
fn trunc() -> Error {
    Error::Pack("truncated delta stream".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn varint(mut n: u64, out: &mut Vec<u8>) {
        loop {
            let mut b = (n & 0x7f) as u8;
            n >>= 7;
            if n != 0 {
                b |= 0x80;
            }
            out.push(b);
            if n == 0 {
                break;
            }
        }
    }

    #[test]
    fn insert_only() {
        // base="" result="hello": [base_size=0][result=5][insert 5 "hello"]
        let mut d = Vec::new();
        varint(0, &mut d);
        varint(5, &mut d);
        d.push(5);
        d.extend_from_slice(b"hello");
        let mut out = Vec::new();
        apply(b"", &d, &mut out).unwrap();
        assert_eq!(out, b"hello");
    }

    #[test]
    fn copy_and_insert() {
        // base="hello world" → "world!"
        let base = b"hello world";
        let mut d = Vec::new();
        varint(base.len() as u64, &mut d);
        varint(6, &mut d);
        // copy off=6 len=5: op=0x80|0x01(off0)|0x10(len0), off0=6, len0=5
        d.extend_from_slice(&[0x91, 6, 5]);
        // insert "!"
        d.extend_from_slice(&[1, b'!']);
        let mut out = Vec::new();
        apply(base, &d, &mut out).unwrap();
        assert_eq!(out, b"world!");
    }

    #[test]
    fn zero_len_means_64k() {
        let base = vec![0xab; 0x10000];
        let mut d = Vec::new();
        varint(0x10000, &mut d);
        varint(0x10000, &mut d);
        // copy off=0 len=0 (→ 0x10000): op has no offset/len bytes present
        d.push(0x80);
        let mut out = Vec::new();
        apply(&base, &d, &mut out).unwrap();
        assert_eq!(out, base);
    }

    #[test]
    fn rejects_oob_copy() {
        let mut d = Vec::new();
        varint(4, &mut d);
        varint(4, &mut d);
        d.extend_from_slice(&[0x91, 2, 4]); // copy [2,6) from 4-byte base
        let mut out = Vec::new();
        assert!(apply(b"abcd", &d, &mut out).is_err());
    }

    #[test]
    fn rejects_reserved_op() {
        let mut d = Vec::new();
        varint(0, &mut d);
        varint(0, &mut d);
        d.push(0x00);
        let mut out = Vec::new();
        assert!(apply(b"", &d, &mut out).is_err());
    }

    #[test]
    fn rejects_short_result() {
        let mut d = Vec::new();
        varint(0, &mut d);
        varint(5, &mut d);
        d.extend_from_slice(&[3, b'a', b'b', b'c']);
        let mut out = Vec::new();
        assert!(apply(b"", &d, &mut out).is_err());
    }
}
