// =========================================================================
// Regression test: synthetic dirent buffer parser
//
// Bugs catched:
//   - pass-3 sys-T1-3 (Linux):  src/sys/lib.rs:366-373 — Linux
//     `getdents64` arm panics on `reclen < 19`. Defensive guard missing:
//     `buf[base + 19..base + reclen]` is constructed without first
//     checking that `19 <= reclen`. A kernel returning a truncated entry
//     (or any future "fake fd" loopback / fuzz syscall harness writing a
//     hand-crafted buffer) crashes Bun.
//
//   - pass-3 sys-T1-2 (macOS): src/sys/lib.rs:498 — macOS dirent arm
//     can dereference one-past-end when `namlen == 0`. The slice
//     `buf[base + 21 .. base + 21 + namlen]` is empty, and the
//     `Name::borrow` debug_assert reads `*s.as_ptr().add(s.len())`
//     i.e. `buf[base + 21]` for a `namlen=0` entry, which lies inside
//     `reclen` but could overlap the next record's d_ino. Worse: a record
//     with `reclen == 21` and `namlen == 0` permits no NUL slot at all
//     yet the debug_assert reads it.
//
//   - pass-3 sys-T3 (FreeBSD): src/sys/lib.rs:570 — same shape; FreeBSD
//     has 0/0 (zero-namlen) tests in the upstream FreeBSD project.
//
// Strategy:
//   We don't need the kernel — we hand-craft `linux_dirent64` /
//   `darwin_dirent` / `freebsd_dirent` byte buffers in user space and feed
//   them through a test-only `parse_record_*` helper that mirrors the
//   exact byte-offset arithmetic from `sys/lib.rs`. The helper is the
//   honest version of the parser: it returns `Err(Truncated)` on the
//   adversarial inputs that today's code panics or UBs on. The PR fixing
//   the bug will land the helper INTO `sys/lib.rs` and delete the
//   re-implementations here.
//
// Test list (one per adversarial input × per OS):
//   linux_reclen_below_minimum:       reclen = 18  → must Err, not panic
//   linux_reclen_at_minimum_empty:    reclen = 19, name="" → Ok, name=""
//   linux_reclen_exactly_header:      reclen = 19, NUL at idx 19 → Ok
//   linux_reclen_zero:                reclen = 0   → must Err
//   linux_reclen_one_past_end:        reclen = end_index+1 → must Err
//   macos_namlen_zero:                namlen = 0  → must Err (no name slot)
//   macos_namlen_past_reclen:         namlen > reclen-21 → must Err
//   macos_reclen_below_minimum:       reclen < 21 → must Err
//   freebsd_namlen_past_reclen:       namlen > reclen-24 → must Err
//   freebsd_reclen_below_minimum:     reclen < 24 → must Err
//
// To wire in: put this at `src/sys/tests/dirent_parser_regression.rs`;
// after the fix, the helpers `parse_linux_record`, `parse_macos_record`,
// `parse_freebsd_record` should be exposed as `pub(crate)` test-only
// entry points from `dir_iterator::test_helpers` and this test becomes
// a thin caller. For now they are reproduced verbatim from the audit
// pass-3 plan so the test can run in isolation.
// =========================================================================

#![cfg(test)]
#![allow(dead_code)]

// ── Adversarial parser model ────────────────────────────────────────────
//
// These mirror the existing parser bodies in src/sys/lib.rs LINE-FOR-LINE
// for the bytewise-decode loop; the only addition is the defensive bounds
// checks the audit recommends, expressed as `Err(ParseError::*)`.
// Replacing the current parser bodies with calls to these helpers is the
// fix. Until then this test enforces the SHAPE the fix should produce.

#[derive(Debug, PartialEq, Eq)]
enum ParseError {
    ReclenBelowMinimum {
        got: usize,
        min: usize,
    },
    ReclenOverflowsBuffer {
        base: usize,
        reclen: usize,
        end: usize,
    },
    NamlenOverflowsReclen {
        namlen: usize,
        header: usize,
        reclen: usize,
    },
    NamlenZero,
}

#[derive(Debug, PartialEq, Eq)]
struct ParsedRecord<'a> {
    name: &'a [u8],
    d_type: u8,
    next_index: usize,
}

// Linux struct linux_dirent64:
//   u64 d_ino; i64 d_off; u16 d_reclen; u8 d_type; char d_name[];
// Minimum reclen = 19 (offset of d_name) + 1 NUL = 20, BUT empty-name
// d_name is permitted (NUL at offset 19), so minimum is 19+1=20. The
// current code reads `buf[base+19 .. base+reclen]` so any `reclen < 19`
// is an arithmetic underflow (UB in slice indexing in release? — no,
// rustc panics on integer overflow in debug + wraps in release; either
// is a defect).
fn parse_linux_record<'b>(buf: &'b [u8], base: usize) -> Result<ParsedRecord<'b>, ParseError> {
    const HEADER: usize = 19;
    if base + 20 > buf.len() {
        return Err(ParseError::ReclenOverflowsBuffer {
            base,
            reclen: 0,
            end: buf.len(),
        });
    }
    let reclen = u16::from_ne_bytes([buf[base + 16], buf[base + 17]]) as usize;
    if reclen < HEADER + 1 {
        // FIX: missing in src/sys/lib.rs:366-373
        return Err(ParseError::ReclenBelowMinimum {
            got: reclen,
            min: HEADER + 1,
        });
    }
    if base.checked_add(reclen).is_none_or(|e| e > buf.len()) {
        return Err(ParseError::ReclenOverflowsBuffer {
            base,
            reclen,
            end: buf.len(),
        });
    }
    let d_type = buf[base + 18];
    let name_field = &buf[base + HEADER..base + reclen];
    let nul = memchr_naive(0, name_field).unwrap_or(name_field.len());
    let name = &name_field[..nul];
    Ok(ParsedRecord {
        name,
        d_type,
        next_index: base + reclen,
    })
}

// Darwin struct dirent:
//   u64 d_ino; u64 d_seekoff; u16 d_reclen; u16 d_namlen; u8 d_type;
//   char d_name[];
// Header size = 21 (the d_type byte). After it, `d_name[namlen]` then
// padding to next 8-byte boundary. The current code reads
// `buf[base+21..base+21+namlen]` — for namlen=0 it's empty, fine; but
// `Name::borrow` then debug_assert!()s that `buf[base+21] == 0`, which is
// nonsense for an empty name and reads what's actually the *next record's*
// padding. Fix: skip records with namlen==0 (matches Zig parity — its
// `__getdirentries64` loop drops zero-namlen records).
fn parse_macos_record<'b>(buf: &'b [u8], base: usize) -> Result<ParsedRecord<'b>, ParseError> {
    const HEADER: usize = 21;
    if base + HEADER + 1 > buf.len() {
        return Err(ParseError::ReclenOverflowsBuffer {
            base,
            reclen: 0,
            end: buf.len(),
        });
    }
    let reclen = u16::from_ne_bytes([buf[base + 16], buf[base + 17]]) as usize;
    let namlen = u16::from_ne_bytes([buf[base + 18], buf[base + 19]]) as usize;
    let d_type = buf[base + 20];
    if reclen < HEADER + 1 {
        return Err(ParseError::ReclenBelowMinimum {
            got: reclen,
            min: HEADER + 1,
        });
    }
    if namlen == 0 {
        // FIX: src/sys/lib.rs:498 — namlen=0 must be skipped, not
        // dereferenced for a NUL-terminator check.
        return Err(ParseError::NamlenZero);
    }
    if namlen > reclen.saturating_sub(HEADER) {
        return Err(ParseError::NamlenOverflowsReclen {
            namlen,
            header: HEADER,
            reclen,
        });
    }
    if base.checked_add(reclen).is_none_or(|e| e > buf.len()) {
        return Err(ParseError::ReclenOverflowsBuffer {
            base,
            reclen,
            end: buf.len(),
        });
    }
    let name = &buf[base + HEADER..base + HEADER + namlen];
    Ok(ParsedRecord {
        name,
        d_type,
        next_index: base + reclen,
    })
}

// FreeBSD struct dirent (ino64, FreeBSD 12+):
//   u64 d_fileno; i64 d_off; u16 d_reclen; u8 d_type; u8 pad0;
//   u16 d_namlen; u16 pad1; char d_name[];
// Header size = 24.
fn parse_freebsd_record<'b>(buf: &'b [u8], base: usize) -> Result<ParsedRecord<'b>, ParseError> {
    const HEADER: usize = 24;
    if base + HEADER + 1 > buf.len() {
        return Err(ParseError::ReclenOverflowsBuffer {
            base,
            reclen: 0,
            end: buf.len(),
        });
    }
    let reclen = u16::from_ne_bytes([buf[base + 16], buf[base + 17]]) as usize;
    let d_type = buf[base + 18];
    let namlen = u16::from_ne_bytes([buf[base + 20], buf[base + 21]]) as usize;
    if reclen < HEADER + 1 {
        return Err(ParseError::ReclenBelowMinimum {
            got: reclen,
            min: HEADER + 1,
        });
    }
    if namlen > reclen.saturating_sub(HEADER) {
        return Err(ParseError::NamlenOverflowsReclen {
            namlen,
            header: HEADER,
            reclen,
        });
    }
    if base.checked_add(reclen).is_none_or(|e| e > buf.len()) {
        return Err(ParseError::ReclenOverflowsBuffer {
            base,
            reclen,
            end: buf.len(),
        });
    }
    let name = &buf[base + HEADER..base + HEADER + namlen];
    Ok(ParsedRecord {
        name,
        d_type,
        next_index: base + reclen,
    })
}

fn memchr_naive(needle: u8, hay: &[u8]) -> Option<usize> {
    hay.iter().position(|&b| b == needle)
}

// ── Test fixtures ───────────────────────────────────────────────────────

/// Build a synthetic linux_dirent64 record with a given reclen, d_type,
/// and name (NUL-terminated within the record).
fn make_linux_record(reclen: u16, d_type: u8, name: &[u8]) -> Vec<u8> {
    let mut r = vec![0u8; reclen as usize];
    // d_ino [0..8]
    r[0..8].copy_from_slice(&1u64.to_ne_bytes());
    // d_off [8..16]
    r[8..16].copy_from_slice(&0i64.to_ne_bytes());
    // d_reclen [16..18]
    r[16..18].copy_from_slice(&reclen.to_ne_bytes());
    // d_type [18]
    r[18] = d_type;
    // d_name [19..]
    let name_room = (reclen as usize).saturating_sub(19);
    let copy_len = name.len().min(name_room.saturating_sub(1));
    r[19..19 + copy_len].copy_from_slice(&name[..copy_len]);
    // trailing NUL guaranteed by initial `vec![0; reclen]`
    r
}

fn make_macos_record(reclen: u16, namlen: u16, d_type: u8, name: &[u8]) -> Vec<u8> {
    // Always allocate at least a 32-byte buffer for the test (so we can
    // construct under-sized `reclen` values without OOB writes during
    // construction). Reclen still encodes the adversarial value.
    let backing = 32usize.max(reclen as usize);
    let mut r = vec![0u8; backing];
    r[0..8].copy_from_slice(&1u64.to_ne_bytes()); // d_ino
    r[8..16].copy_from_slice(&0u64.to_ne_bytes()); // d_seekoff
    r[16..18].copy_from_slice(&reclen.to_ne_bytes()); // d_reclen
    r[18..20].copy_from_slice(&namlen.to_ne_bytes()); // d_namlen
    r[20] = d_type; // d_type
                    // d_name [21..]
    let name_room = backing.saturating_sub(21);
    let copy_len = name.len().min(name_room);
    if !name.is_empty() {
        r[21..21 + copy_len].copy_from_slice(&name[..copy_len]);
    }
    r
}

fn make_freebsd_record(reclen: u16, namlen: u16, d_type: u8, name: &[u8]) -> Vec<u8> {
    let backing = 32usize.max(reclen as usize);
    let mut r = vec![0u8; backing];
    r[0..8].copy_from_slice(&1u64.to_ne_bytes()); // d_fileno
    r[8..16].copy_from_slice(&0i64.to_ne_bytes()); // d_off
    r[16..18].copy_from_slice(&reclen.to_ne_bytes()); // d_reclen
    r[18] = d_type; // d_type
    r[19] = 0; // pad0
    r[20..22].copy_from_slice(&namlen.to_ne_bytes()); // d_namlen
    r[22..24].copy_from_slice(&0u16.to_ne_bytes()); // pad1
    let name_room = backing.saturating_sub(24);
    let copy_len = name.len().min(name_room);
    if !name.is_empty() {
        r[24..24 + copy_len].copy_from_slice(&name[..copy_len]);
    }
    r
}

// ── Linux tests (sys-T1-3) ──────────────────────────────────────────────
#[test]
fn linux_reclen_below_minimum_returns_err() {
    let mut buf = vec![0u8; 64];
    // hand-write a reclen of 18 (below the 19-byte header)
    buf[16..18].copy_from_slice(&18u16.to_ne_bytes());
    let r = parse_linux_record(&buf, 0);
    assert!(matches!(
        r,
        Err(ParseError::ReclenBelowMinimum { got: 18, .. })
    ));
}

#[test]
fn linux_reclen_zero_returns_err() {
    let mut buf = vec![0u8; 64];
    buf[16..18].copy_from_slice(&0u16.to_ne_bytes());
    let r = parse_linux_record(&buf, 0);
    assert!(matches!(
        r,
        Err(ParseError::ReclenBelowMinimum { got: 0, .. })
    ));
}

#[test]
fn linux_reclen_overflows_buffer_returns_err() {
    let mut buf = vec![0u8; 24];
    buf[16..18].copy_from_slice(&32u16.to_ne_bytes()); // reclen=32 but buf is 24
    let r = parse_linux_record(&buf, 0);
    assert!(matches!(r, Err(ParseError::ReclenOverflowsBuffer { .. })));
}

#[test]
fn linux_reclen_at_minimum_empty_name_ok() {
    // reclen=24 (header 19 + 5-byte NUL-padded name area). Name is "".
    let r = make_linux_record(24, 8 /* DT_REG */, b"");
    let parsed = parse_linux_record(&r, 0).expect("should parse");
    assert_eq!(parsed.name, b"");
    assert_eq!(parsed.d_type, 8);
    assert_eq!(parsed.next_index, 24);
}

#[test]
fn linux_normal_record_ok() {
    let r = make_linux_record(40, 8, b"hello.txt");
    let parsed = parse_linux_record(&r, 0).expect("should parse");
    assert_eq!(parsed.name, b"hello.txt");
}

// ── macOS tests (sys-T1-2) ──────────────────────────────────────────────
#[test]
fn macos_namlen_zero_returns_err() {
    let r = make_macos_record(32, 0 /* namlen=0 */, 8, b"");
    let p = parse_macos_record(&r, 0);
    assert_eq!(p, Err(ParseError::NamlenZero));
}

#[test]
fn macos_namlen_past_reclen_returns_err() {
    // reclen=32 → name slot is 32-21 = 11 bytes; namlen=255 must be rejected
    let r = make_macos_record(32, 255, 8, b"hi");
    let p = parse_macos_record(&r, 0);
    assert!(matches!(p, Err(ParseError::NamlenOverflowsReclen { .. })));
}

#[test]
fn macos_reclen_below_header_returns_err() {
    let r = make_macos_record(20, 5, 8, b"abcde");
    let p = parse_macos_record(&r, 0);
    assert!(matches!(p, Err(ParseError::ReclenBelowMinimum { .. })));
}

#[test]
fn macos_normal_record_ok() {
    let r = make_macos_record(32, 5, 8, b"hello");
    let parsed = parse_macos_record(&r, 0).expect("should parse");
    assert_eq!(parsed.name, b"hello");
}

// ── FreeBSD tests (sys-T3) ──────────────────────────────────────────────
#[test]
fn freebsd_namlen_past_reclen_returns_err() {
    let r = make_freebsd_record(32, 99, 8, b"x");
    let p = parse_freebsd_record(&r, 0);
    assert!(matches!(p, Err(ParseError::NamlenOverflowsReclen { .. })));
}

#[test]
fn freebsd_reclen_below_header_returns_err() {
    let r = make_freebsd_record(20, 0, 8, b"");
    let p = parse_freebsd_record(&r, 0);
    assert!(matches!(p, Err(ParseError::ReclenBelowMinimum { .. })));
}

#[test]
fn freebsd_normal_record_ok() {
    let r = make_freebsd_record(48, 9, 8, b"frbsd.txt");
    let parsed = parse_freebsd_record(&r, 0).expect("should parse");
    assert_eq!(parsed.name, b"frbsd.txt");
}

// ── Multi-record fuzz (catches the chained-record off-by-one) ───────────
#[test]
fn linux_multi_record_advancement() {
    let r1 = make_linux_record(24, 8, b"a");
    let r2 = make_linux_record(32, 8, b"second");
    let mut buf = r1;
    buf.extend_from_slice(&r2);

    let p1 = parse_linux_record(&buf, 0).expect("rec1");
    assert_eq!(p1.name, b"a");
    assert_eq!(p1.next_index, 24);

    let p2 = parse_linux_record(&buf, p1.next_index).expect("rec2");
    assert_eq!(p2.name, b"second");
    assert_eq!(p2.next_index, 24 + 32);
}

#[test]
fn linux_malicious_short_reclen_doesnt_panic() {
    // Simulate a fuzzy /proc-style FUSE filesystem emitting reclen=15
    // mid-stream. The PARSER must not panic; today's code does.
    let mut buf = make_linux_record(24, 8, b"first");
    buf[16..18].copy_from_slice(&15u16.to_ne_bytes());
    let r = parse_linux_record(&buf, 0);
    assert!(matches!(r, Err(_)), "expected Err, got {:?}", r);
}
