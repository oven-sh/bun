//! One record of a `getdents64`, `getdirentries64` or `getdents` buffer. A sandbox can answer the syscall for the kernel, so no length in it is trusted.

use crate::{E, Error, Tag};

/// Byte offsets of the fields of a record. `d_ino` is at 0 and `d_reclen` is at 16 in every layout.
pub trait Layout {
    const D_TYPE: usize;
    /// Linux has none: the name ends at its NUL.
    const D_NAMLEN: Option<usize>;
    /// `d_name[0]`, which is also the size of the header.
    const D_NAME: usize;
    /// Darwin and FreeBSD keep a removed entry in place with inode 0.
    const INODE_ZERO_IS_REMOVED: bool;
    /// `false` where the FAT driver reports an entry whose 8.3 name is blank.
    const EMPTY_NAME_IS_MALFORMED: bool;
}

const D_INO: usize = 0;
const D_RECLEN: usize = 16;

#[cfg(any(test, target_os = "linux", target_os = "android"))]
pub struct Linux;
#[cfg(any(test, target_os = "linux", target_os = "android"))]
impl Layout for Linux {
    const D_TYPE: usize = 18;
    const D_NAMLEN: Option<usize> = None;
    const D_NAME: usize = 19;
    const INODE_ZERO_IS_REMOVED: bool = false;
    const EMPTY_NAME_IS_MALFORMED: bool = true;
}
#[cfg(any(target_os = "linux", target_os = "android"))]
const _: () = {
    use core::mem::offset_of;
    assert!(offset_of!(libc::dirent64, d_ino) == D_INO);
    assert!(offset_of!(libc::dirent64, d_reclen) == D_RECLEN);
    assert!(offset_of!(libc::dirent64, d_type) == Linux::D_TYPE);
    assert!(offset_of!(libc::dirent64, d_name) == Linux::D_NAME);
};

#[cfg(any(test, target_os = "macos"))]
pub struct Darwin;
#[cfg(any(test, target_os = "macos"))]
impl Layout for Darwin {
    const D_TYPE: usize = 20;
    const D_NAMLEN: Option<usize> = Some(18);
    const D_NAME: usize = 21;
    const INODE_ZERO_IS_REMOVED: bool = true;
    const EMPTY_NAME_IS_MALFORMED: bool = false;
}
#[cfg(target_os = "macos")]
const _: () = {
    use core::mem::offset_of;
    assert!(offset_of!(libc::dirent, d_ino) == D_INO);
    assert!(offset_of!(libc::dirent, d_reclen) == D_RECLEN);
    assert!(offset_of!(libc::dirent, d_namlen) == 18);
    assert!(offset_of!(libc::dirent, d_type) == Darwin::D_TYPE);
    assert!(offset_of!(libc::dirent, d_name) == Darwin::D_NAME);
};

#[cfg(any(test, target_os = "freebsd"))]
pub struct FreeBsd;
#[cfg(any(test, target_os = "freebsd"))]
impl Layout for FreeBsd {
    const D_TYPE: usize = 18;
    const D_NAMLEN: Option<usize> = Some(20);
    const D_NAME: usize = 24;
    const INODE_ZERO_IS_REMOVED: bool = true;
    const EMPTY_NAME_IS_MALFORMED: bool = false;
}
#[cfg(target_os = "freebsd")]
const _: () = {
    use core::mem::offset_of;
    assert!(offset_of!(libc::dirent, d_fileno) == D_INO);
    assert!(offset_of!(libc::dirent, d_reclen) == D_RECLEN);
    assert!(offset_of!(libc::dirent, d_namlen) == 20);
    assert!(offset_of!(libc::dirent, d_type) == FreeBsd::D_TYPE);
    assert!(offset_of!(libc::dirent, d_name) == FreeBsd::D_NAME);
};

#[cfg(any(target_os = "linux", target_os = "android"))]
pub type Native = Linux;
#[cfg(target_os = "macos")]
pub type Native = Darwin;
#[cfg(target_os = "freebsd")]
pub type Native = FreeBsd;

pub struct Record<'a> {
    /// Offset of the next record: `at < next <= filled.len()`.
    pub next: usize,
    /// `None` for a record that the walkers do not report.
    pub entry: Option<Entry<'a>>,
}

pub struct Entry<'a> {
    /// `d_name` without its NUL, which is the byte after it, inside the record.
    pub name: &'a [u8],
    pub d_type: u8,
}

/// Reads the record at `filled[at..]`, where `filled` is what the syscall wrote. `None` for a record that cannot be walked.
#[inline]
pub fn parse<L: Layout>(filled: &[u8], at: usize) -> Option<Record<'_>> {
    let rest = filled.get(at..)?;
    let header = rest.get(..L::D_NAME)?;
    let u16_at = |offset: usize| {
        Some(usize::from(u16::from_ne_bytes(
            *header.get(offset..)?.first_chunk()?,
        )))
    };

    let reclen = u16_at(D_RECLEN)?;
    let name_field = rest.get(L::D_NAME..reclen)?;
    let skipped = Some(Record {
        next: at + reclen,
        entry: None,
    });

    if L::INODE_ZERO_IS_REMOVED && header.get(D_INO..)?.first_chunk::<8>()? == &[0; 8] {
        return skipped;
    }

    let (name, unreported) = match L::D_NAMLEN {
        Some(offset) => {
            let namlen = u16_at(offset)?;
            if *name_field.get(namlen)? != 0 {
                return None;
            }
            // A C API reads a name up to its first NUL, which `d_namlen` need not match.
            let read_by_c = matches!(*name_field, [0, ..] | [b'.', 0, ..] | [b'.', b'.', 0, ..]);
            (name_field.get(..namlen)?, read_by_c)
        }
        None => {
            // A scalar loop here showed up in startup profiles on large directories.
            let nul = bun_core::strings::index_of_char_usize(name_field, 0);
            let nul = nul.unwrap_or(name_field.len());
            name_field.get(nul)?;
            let name = name_field.get(..nul)?;
            (name, nul <= 2 && matches!(name, b"" | b"." | b".."))
        }
    };
    if unreported {
        // An empty name is the directory itself, so a recursive walk of it does not end.
        if L::EMPTY_NAME_IS_MALFORMED && name.is_empty() {
            return None;
        }
        return skipped;
    }

    Some(Record {
        next: at + reclen,
        entry: Some(Entry {
            name,
            d_type: *header.get(L::D_TYPE)?,
        }),
    })
}

/// The `end_index` of a walk that a malformed record ended. It is above every cursor, so no refill follows, and above every buffer, so no record is read.
const ENDED: usize = usize::MAX;

/// Ends a walk at a malformed record: `EIO` for this call, as the kernel answers a FUSE server, then the end of the directory.
#[cold]
// Not `#[inline(never)]`: as a call it puts `next` above the inline threshold of the recursive `readdirSync` loops, which costs them 45 instructions per entry.
pub fn end_walk<T>(end_index: &mut usize, syscall: Tag) -> Result<Option<T>, Error> {
    if *end_index == ENDED {
        return Ok(None);
    }
    *end_index = ENDED;
    Err(Error::from_code(E::EIO, syscall))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One well-formed record of `reclen` bytes. Every byte that is not a field is `fill`.
    fn record<L: Layout>(ino: u64, d_type: u8, name: &[u8], reclen: usize, fill: u8) -> Vec<u8> {
        assert!(L::D_NAME + name.len() < reclen);
        let mut bytes = vec![fill; reclen];
        bytes[..L::D_NAME].fill(0);
        bytes[D_INO..][..8].copy_from_slice(&ino.to_ne_bytes());
        bytes[D_RECLEN..][..2].copy_from_slice(&(reclen as u16).to_ne_bytes());
        bytes[L::D_TYPE] = d_type;
        if let Some(offset) = L::D_NAMLEN {
            bytes[offset..][..2].copy_from_slice(&(name.len() as u16).to_ne_bytes());
        }
        bytes[L::D_NAME..][..name.len()].copy_from_slice(name);
        bytes[L::D_NAME + name.len()] = 0;
        bytes
    }

    fn set_reclen(bytes: &mut [u8], reclen: usize) {
        bytes[D_RECLEN..][..2].copy_from_slice(&(reclen as u16).to_ne_bytes());
    }

    fn set_namlen<L: Layout>(bytes: &mut [u8], namlen: usize) {
        let offset = L::D_NAMLEN.unwrap();
        bytes[offset..][..2].copy_from_slice(&(namlen as u16).to_ne_bytes());
    }

    #[derive(Debug, PartialEq)]
    enum Walked {
        Names(Vec<Vec<u8>>),
        MalformedAt(usize),
    }

    fn walk<L: Layout>(filled: &[u8]) -> Walked {
        let mut names = Vec::new();
        let mut at = 0;
        while at < filled.len() {
            let Some(record) = parse::<L>(filled, at) else {
                return Walked::MalformedAt(at);
            };
            assert!(at < record.next && record.next <= filled.len());
            if let Some(entry) = record.entry {
                let nul = at + L::D_NAME + entry.name.len();
                assert!(nul < record.next);
                assert_eq!(filled[nul], 0);
                names.push(entry.name.to_vec());
            }
            at = record.next;
        }
        Walked::Names(names)
    }

    fn names(list: &[&[u8]]) -> Walked {
        Walked::Names(list.iter().map(|name| name.to_vec()).collect())
    }

    macro_rules! each_layout {
        ($test:ident) => {
            $test::<Linux>();
            $test::<Darwin>();
            $test::<FreeBsd>();
        };
    }

    // The next three records follow the C declaration of each struct field by field, so that they do not depend on the offsets under test.
    #[test]
    fn reads_a_linux_dirent64() {
        let mut buf = Vec::new();
        buf.extend(0x1122334455667788u64.to_ne_bytes()); // d_ino
        buf.extend(24i64.to_ne_bytes()); // d_off
        buf.extend(24u16.to_ne_bytes()); // d_reclen
        buf.push(8); // d_type
        buf.extend(b"a.c\0\0"); // d_name
        assert_eq!(buf.len(), 24);
        let record = parse::<Linux>(&buf, 0).unwrap();
        let entry = record.entry.unwrap();
        assert_eq!(
            (record.next, entry.name, entry.d_type),
            (24, &b"a.c"[..], 8)
        );
    }

    #[test]
    fn reads_a_darwin_dirent() {
        let mut buf = Vec::new();
        buf.extend(0x1122334455667788u64.to_ne_bytes()); // d_ino
        buf.extend(0u64.to_ne_bytes()); // d_seekoff
        buf.extend(28u16.to_ne_bytes()); // d_reclen
        buf.extend(3u16.to_ne_bytes()); // d_namlen
        buf.push(4); // d_type
        buf.extend(b"a.c\0\0\0\0"); // d_name
        assert_eq!(buf.len(), 28);
        let record = parse::<Darwin>(&buf, 0).unwrap();
        let entry = record.entry.unwrap();
        assert_eq!(
            (record.next, entry.name, entry.d_type),
            (28, &b"a.c"[..], 4)
        );
    }

    #[test]
    fn reads_a_freebsd_dirent() {
        let mut buf = Vec::new();
        buf.extend(0x1122334455667788u64.to_ne_bytes()); // d_fileno
        buf.extend(32i64.to_ne_bytes()); // d_off
        buf.extend(32u16.to_ne_bytes()); // d_reclen
        buf.push(10); // d_type
        buf.push(0xAA); // d_pad0
        buf.extend(3u16.to_ne_bytes()); // d_namlen
        buf.extend(0xBBBBu16.to_ne_bytes()); // d_pad1
        buf.extend(b"a.c\0\0\0\0\0"); // d_name
        assert_eq!(buf.len(), 32);
        let record = parse::<FreeBsd>(&buf, 0).unwrap();
        let entry = record.entry.unwrap();
        assert_eq!(
            (record.next, entry.name, entry.d_type),
            (32, &b"a.c"[..], 10)
        );
    }

    #[test]
    fn walks_well_formed_records() {
        fn check<L: Layout>() {
            let mut buf = record::<L>(7, 8, b"a.txt", 32, 0);
            buf.extend(record::<L>(8, 4, b"dir", 32, 0xEE));
            buf.extend(record::<L>(9, 8, &[b'n'; 255], L::D_NAME + 256, 0));
            assert_eq!(walk::<L>(&buf), names(&[b"a.txt", b"dir", &[b'n'; 255]]));

            let first = parse::<L>(&buf, 0).unwrap();
            assert_eq!(first.next, 32);
            assert_eq!(first.entry.unwrap().d_type, 8);
            let second = parse::<L>(&buf, 32).unwrap();
            assert_eq!(second.next, 64);
            assert_eq!(second.entry.unwrap().d_type, 4);
        }
        each_layout!(check);
    }

    #[test]
    fn rejects_a_record_too_short_for_a_name() {
        fn check<L: Layout>() {
            for reclen in [0, 1, 8, L::D_NAME - 1, L::D_NAME] {
                let mut buf = record::<L>(7, 8, b"a.txt", 32, 0);
                buf.extend(record::<L>(8, 8, b"b.txt", 32, 0));
                set_reclen(&mut buf, reclen);
                assert_eq!(walk::<L>(&buf), Walked::MalformedAt(0), "reclen {reclen}");

                let mut buf = record::<L>(7, 8, b"a.txt", 32, 0);
                buf.extend(record::<L>(8, 8, b"b.txt", 32, 0));
                set_reclen(&mut buf[32..], reclen);
                assert_eq!(walk::<L>(&buf), Walked::MalformedAt(32), "reclen {reclen}");
            }
        }
        each_layout!(check);
    }

    #[test]
    fn rejects_a_buffer_of_zeros() {
        fn check<L: Layout>() {
            assert_eq!(walk::<L>(&[0; 144]), Walked::MalformedAt(0));
        }
        each_layout!(check);
    }

    #[test]
    fn rejects_a_record_that_runs_past_the_bytes_returned() {
        fn check<L: Layout>() {
            let mut buf = record::<L>(7, 8, b"a.txt", 32, 0);
            buf.extend(record::<L>(8, 8, b"b.txt", 32, 0));

            assert_eq!(walk::<L>(&buf[..63]), Walked::MalformedAt(32));
            assert_eq!(
                walk::<L>(&buf[..32 + L::D_NAME - 1]),
                Walked::MalformedAt(32)
            );
            assert_eq!(walk::<L>(&buf[..32 + D_RECLEN]), Walked::MalformedAt(32));

            set_reclen(&mut buf, 65);
            assert_eq!(walk::<L>(&buf), Walked::MalformedAt(0));
            set_reclen(&mut buf, usize::from(u16::MAX));
            assert_eq!(walk::<L>(&buf), Walked::MalformedAt(0));

            assert!(parse::<L>(&buf, buf.len()).is_none());
            assert!(parse::<L>(&buf, buf.len() + 1).is_none());
            assert!(parse::<L>(&buf, usize::MAX).is_none());
        }
        each_layout!(check);
    }

    #[test]
    fn rejects_a_name_with_no_nul_inside_the_record() {
        fn check<L: Layout>() {
            let mut buf = record::<L>(7, 8, b"a.txt", 32, 0);
            buf.extend(record::<L>(8, 8, b"b.txt", 32, 0));
            buf[L::D_NAME..32].fill(b'x');
            assert_eq!(walk::<L>(&buf), Walked::MalformedAt(0));
        }
        each_layout!(check);
    }

    #[test]
    fn rejects_a_name_length_that_runs_past_the_record() {
        fn check<L: Layout>() {
            for namlen in [32 - L::D_NAME, 1024] {
                let mut buf = record::<L>(7, 8, b"a.txt", 32, 0);
                buf.extend(record::<L>(8, 8, b"b.txt", 32, 0));
                buf[L::D_NAME..32].fill(b'x');
                set_namlen::<L>(&mut buf, namlen);
                assert_eq!(walk::<L>(&buf), Walked::MalformedAt(0), "namlen {namlen}");
            }
        }
        check::<Darwin>();
        check::<FreeBsd>();
    }

    #[test]
    fn the_bytes_after_the_nul_are_not_the_name() {
        fn check<L: Layout>() {
            let buf = record::<L>(7, 8, b"kept.txt", 80, 0xAB);
            assert_eq!(walk::<L>(&buf), names(&[b"kept.txt"]));
        }
        each_layout!(check);
    }

    #[test]
    fn skips_what_a_c_api_reads_as_dot_dot_dot_or_empty() {
        fn check<L: Layout>() {
            let cases: [(&[u8], Option<&[u8]>); 8] = [
                (b"a\0b", Some(b"a\0b")),
                (b"...\0x", Some(b"...\0x")),
                (b".\0", None),
                (b".\0x", None),
                (b"..\0", None),
                (b"..\0/etc", None),
                (b"\0", None),
                (b"\0abc", None),
            ];
            for (written, read) in cases {
                let mut buf = record::<L>(7, 8, b"a.txt", 32, 0);
                buf.extend(record::<L>(8, 8, written, 32, 0));
                buf.extend(record::<L>(9, 8, b"b.txt", 32, 0));
                let expected: Vec<&[u8]> = [Some(&b"a.txt"[..]), read, Some(b"b.txt")]
                    .into_iter()
                    .flatten()
                    .collect();
                assert_eq!(walk::<L>(&buf), names(&expected), "{written:?}");
            }
        }
        check::<Darwin>();
        check::<FreeBsd>();
    }

    #[test]
    fn an_empty_name_is_malformed_on_linux() {
        let mut buf = record::<Linux>(7, 4, b"", 32, 0);
        buf.extend(record::<Linux>(8, 8, b"b.txt", 32, 0));
        assert_eq!(walk::<Linux>(&buf), Walked::MalformedAt(0));
    }

    #[test]
    fn an_empty_name_is_skipped_on_darwin_and_freebsd() {
        fn check<L: Layout>() {
            // What the FAT driver writes: an inode, `d_namlen` 0, and stale bytes after the NUL.
            let mut buf = record::<L>(7, 8, b"a.txt", 32, 0);
            buf.extend(record::<L>(999999999, 8, b"", 32, 0xEE));
            buf.extend(record::<L>(8, 8, b"b.txt", 32, 0));
            assert_eq!(walk::<L>(&buf), names(&[b"a.txt", b"b.txt"]));
        }
        check::<Darwin>();
        check::<FreeBsd>();
    }

    #[test]
    fn skips_a_removed_entry_without_reading_its_name() {
        fn check<L: Layout>() {
            let mut unterminated = record::<L>(0, 8, b"old", 32, 0);
            unterminated[L::D_NAME..].fill(b'x');
            let mut stale_length = record::<L>(0, 8, b"", 32, 0);
            set_namlen::<L>(&mut stale_length, 40);
            let mut header_only = record::<L>(0, 0, b"", 32, 0);
            header_only.truncate(L::D_NAME);
            set_reclen(&mut header_only, L::D_NAME);

            for removed in [
                record::<L>(0, 8, b"gone.txt", 40, 0xEE),
                record::<L>(0, 0, b"", 512, 0),
                unterminated,
                stale_length,
                header_only,
            ] {
                let mut buf = record::<L>(7, 8, b"a.txt", 32, 0);
                buf.extend(&removed);
                buf.extend(record::<L>(8, 8, b"b.txt", 32, 0));
                assert_eq!(walk::<L>(&buf), names(&[b"a.txt", b"b.txt"]));
            }

            let mut buf = record::<L>(0, 8, b"gone.txt", 40, 0);
            set_reclen(&mut buf, 0);
            assert_eq!(walk::<L>(&buf), Walked::MalformedAt(0));
            set_reclen(&mut buf, L::D_NAME - 1);
            assert_eq!(walk::<L>(&buf), Walked::MalformedAt(0));
            set_reclen(&mut buf, 41);
            assert_eq!(walk::<L>(&buf), Walked::MalformedAt(0));
        }
        check::<Darwin>();
        check::<FreeBsd>();
    }

    #[test]
    fn a_malformed_record_ends_the_walk() {
        // The byte count of a refill: above the buffer size, then inside it.
        for mut end_index in [8192 + 64, 144] {
            let first = end_walk::<()>(&mut end_index, Tag::getdents64);
            assert_eq!(first.unwrap_err().get_errno(), E::EIO);
            for _ in 0..3 {
                assert_eq!(end_index, usize::MAX);
                let later = end_walk::<()>(&mut end_index, Tag::getdents64);
                assert!(matches!(later, Ok(None)));
            }
        }
    }

    #[test]
    fn linux_reports_an_entry_with_inode_zero() {
        let buf = record::<Linux>(0, 8, b"a.txt", 32, 0);
        assert_eq!(walk::<Linux>(&buf), names(&[b"a.txt"]));
    }

    #[test]
    fn skips_dot_and_dot_dot() {
        fn check<L: Layout>() {
            let mut buf = record::<L>(1, 4, b".", 32, 0);
            buf.extend(record::<L>(2, 4, b"..", 32, 0));
            let reported: [&[u8]; 7] = [b"a", b"..a", b".a", b"a.", b"ab", b"...", b".git"];
            for name in reported {
                buf.extend(record::<L>(3, 8, name, 32, 0));
            }
            assert_eq!(walk::<L>(&buf), names(&reported));
        }
        each_layout!(check);
    }
}
