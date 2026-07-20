//! `.git/index` (dircache) writer — format version 2, no extensions.
//!
//! Reference: gitformat-index(5). We emit the 12-byte `DIRC` header, one
//! fixed-62-byte entry per path (NUL-padded to an 8-byte multiple), and a
//! trailing SHA-1 of everything before it. Stat fields are filled from an
//! `lstat` of the just-written worktree file so `git status` sees a clean
//! tree without re-reading every blob.

use crate::fs::{lstat, write_trusted};
use crate::hash::Sha1;
use crate::{Oid, Result};

const MODE_GITLINK: u32 = 0o160000;

/// One path destined for the index. `path` is relative to the worktree root,
/// `/`-separated, no leading slash.
pub(crate) struct IndexEntry {
    pub(crate) mode: u32,
    pub(crate) oid: Oid,
    pub(crate) path: Vec<u8>,
}

/// Serialise `entries` as a v2 index and write to `<dest>/.git/index`.
pub(crate) fn write(dest: &[u8], mut entries: Vec<IndexEntry>) -> Result<()> {
    // Index sort order is raw-byte memcmp on the full path.
    entries.sort_by(|a, b| a.path.cmp(&b.path));

    let mut buf = Vec::with_capacity(12 + entries.len() * 80 + 20);
    buf.extend_from_slice(b"DIRC");
    buf.extend_from_slice(&2u32.to_be_bytes());
    buf.extend_from_slice(&(entries.len() as u32).to_be_bytes());

    let mut abs = Vec::with_capacity(dest.len() + 256);
    for e in &entries {
        // Gitlinks have no worktree file to stat (the placeholder dir's
        // metadata is meaningless to git's ie_match_stat); zero the cache.
        let st = if e.mode == MODE_GITLINK {
            None
        } else {
            abs.clear();
            abs.extend_from_slice(dest);
            abs.push(b'/');
            abs.extend_from_slice(&e.path);
            lstat(&abs)
        };
        emit_entry(&mut buf, e, st.as_ref());
    }

    let mut sha = Sha1::new();
    sha.update(&buf);
    buf.extend_from_slice(&sha.finish().0);

    let mut out = Vec::with_capacity(dest.len() + 11);
    out.extend_from_slice(dest);
    out.extend_from_slice(b"/.git/index");
    write_trusted(&out, &buf)
}

fn emit_entry(buf: &mut Vec<u8>, e: &IndexEntry, st: Option<&bun_sys::PosixStat>) {
    macro_rules! be32 {
        ($v:expr) => {
            buf.extend_from_slice(&(($v) as u32).to_be_bytes())
        };
    }
    // gitformat-index(5): only 0755 and 0644 are valid for regular files.
    let mode = match e.mode {
        m if m & 0o170000 == 0o100000 => {
            if m & 0o100 != 0 {
                0o100755
            } else {
                0o100644
            }
        }
        m => m,
    };
    // Stat cache. All fields are 32-bit BE, truncated — git compares them as
    // opaque cookies, so wraparound on large dev/ino/size is by design.
    match st {
        Some(s) => {
            be32!(s.ctim.sec);
            be32!(s.ctim.nsec);
            be32!(s.mtim.sec);
            be32!(s.mtim.nsec);
            be32!(s.dev);
            be32!(s.ino);
            be32!(mode);
            be32!(s.uid);
            be32!(s.gid);
            be32!(s.size);
        }
        None => {
            buf.extend_from_slice(&[0u8; 24]);
            be32!(mode);
            buf.extend_from_slice(&[0u8; 12]);
        }
    }
    buf.extend_from_slice(&e.oid.0);
    // Flags: assume-valid=0, extended=0, stage=0, name length capped at 0xFFF.
    let flags = e.path.len().min(0xFFF) as u16;
    buf.extend_from_slice(&flags.to_be_bytes());
    buf.extend_from_slice(&e.path);
    // 1–8 NUL bytes: NUL-terminate the name and pad the (62-byte fixed part +
    // name) to an 8-byte multiple.
    let pad = 8 - ((62 + e.path.len()) & 7);
    buf.extend_from_slice(&[0u8; 8][..pad]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_layout_and_padding() {
        let mut buf = Vec::new();
        let e = IndexEntry {
            mode: 0o100644,
            oid: Oid([0xab; 20]),
            path: b"a".to_vec(),
        };
        emit_entry(&mut buf, &e, None);
        // 62 fixed + "a" + 1 NUL = 64 (next multiple of 8).
        assert_eq!(buf.len(), 64);
        assert_eq!(&buf[24..28], &0o100644u32.to_be_bytes());
        assert_eq!(&buf[40..60], &[0xab; 20]);
        assert_eq!(&buf[60..62], &[0x00, 0x01]);
        assert_eq!(buf[62], b'a');
        assert_eq!(buf[63], 0);

        // 62 + 10 = 72 ⇒ pad 8 (always at least one NUL).
        let mut buf = Vec::new();
        let e = IndexEntry {
            mode: 0o100644,
            oid: Oid::ZERO,
            path: b"0123456789".to_vec(),
        };
        emit_entry(&mut buf, &e, None);
        assert_eq!(buf.len(), 80);
        assert_eq!(&buf[60..62], &[0x00, 0x0a]);
        assert!(buf[72..80].iter().all(|&b| b == 0));
    }
}
