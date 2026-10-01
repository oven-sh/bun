
#![allow(dead_code)]
mod bun_core {
    pub mod strings {
        pub fn decode_wtf8_rune_t<T: From<u32>>(p: [u8; 4], len: u8, zero: T) -> T {
            let bytes = &p[..len as usize];
            match core::str::from_utf8(bytes) {
                Ok(s) => match s.chars().next() {
                    Some(c) if c.len_utf8() == bytes.len() => T::from(c as u32),
                    _ => zero,
                },
                Err(_) => zero,
            }
        }
        pub const fn is_unicode_space_separator(cp: u32) -> bool {
            matches!(cp, 0x0020 | 0x00A0 | 0x1680 | 0x2000..=0x200A | 0x202F | 0x205F | 0x3000)
        }
        pub fn index_of_any(slice: &[u8], chars: &[u8]) -> Option<usize> {
            slice.iter().position(|b| chars.contains(b))
        }
    }
}
#[derive(Clone, Copy)]
pub struct Loc { pub start: i32 }
impl Loc { pub fn i(self) -> usize { self.start.max(0) as usize } }
#[derive(Clone, Copy)]
pub struct Range { pub loc: Loc, pub len: i32 }
impl Range { pub fn end_i(self) -> usize { (self.loc.start + self.len).max(0) as usize } }

/// What tsc calls `pos` for a node, a token or a list that starts at `start`: the end of the token before it.
pub fn full_start(source: &[u8], comments: &[Range], start: u32) -> u32 {
    let mut pos = (start as usize).min(source.len());
    let mut before = comments.partition_point(|comment| comment.end_i() <= pos);
    loop {
        let floor = if before > 0 {
            comments[before - 1].end_i()
        } else {
            0
        };
        pos = skip_whitespace_before(source, pos, floor);
        if before == 0 || pos != floor {
            break;
        }
        before -= 1;
        pos = comments[before].loc.i().min(pos);
    }
    if is_hashbang(&source[..pos]) {
        return 0;
    }
    pos as u32
}

fn skip_whitespace_before(source: &[u8], mut pos: usize, floor: usize) -> usize {
    while pos > floor {
        let mut at = pos - 1;
        while at > floor && source[at] & 0xC0 == 0x80 && pos - at < 4 {
            at -= 1;
        }
        let len = pos - at;
        let mut bytes = [0u8; 4];
        bytes[..len].copy_from_slice(&source[at..pos]);
        let is_space =
            match bun_core::strings::decode_wtf8_rune_t::<u32>(bytes, len as u8, u32::MAX) {
                0x09 | 0x0A | 0x0B | 0x0C | 0x0D | 0x2028 | 0x2029 | 0xFEFF => true,
                rune => bun_core::strings::is_unicode_space_separator(rune),
            };
        if !is_space {
            break;
        }
        pos = at;
    }
    pos
}

fn is_hashbang(before: &[u8]) -> bool {
    before.starts_with(b"#!") && bun_core::strings::index_of_any(before, b"\r\n").is_none()
}


fn read_line<'a>(data: &'a [u8], at: &mut usize) -> &'a [u8] {
    let start = *at;
    while *at < data.len() && data[*at] != b'\n' { *at += 1; }
    let line = &data[start..*at];
    *at += 1;
    line
}
fn num(s: &[u8]) -> usize { std::str::from_utf8(s).unwrap().trim().parse().unwrap() }

fn main() {
    let data = std::fs::read(std::env::args().nth(1).unwrap()).unwrap();
    let mut at = 0usize;
    let (mut files, mut checks, mut bad) = (0usize, 0usize, 0usize);
    while at < data.len() {
        let file = read_line(&data, &mut at).to_vec();
        assert!(file.starts_with(b"FILE "));
        let n = num(&read_line(&data, &mut at)[4..]);
        let source = &data[at..at + n];
        at += n + 1;
        let k = num(&read_line(&data, &mut at)[9..]);
        let mut comments = Vec::with_capacity(k);
        for _ in 0..k {
            let line = read_line(&data, &mut at);
            let mut it = line.split(|b| *b == b' ');
            let s = num(it.next().unwrap()) as i32;
            let e = num(it.next().unwrap()) as i32;
            comments.push(Range { loc: Loc { start: s }, len: e - s });
        }
        let m = num(&read_line(&data, &mut at)[7..]);
        for _ in 0..m {
            let line = read_line(&data, &mut at);
            let mut it = line.split(|b| *b == b' ');
            let start = num(it.next().unwrap()) as u32;
            let expected = num(it.next().unwrap()) as u32;
            let got = full_start(source, &comments, start);
            checks += 1;
            if got != expected {
                bad += 1;
                if bad <= 10 {
                    println!("MISMATCH {} start={} expected={} got={}", String::from_utf8_lossy(&file), start, expected, got);
                }
            }
        }
        files += 1;
    }
    println!("files={} checks={} bad={}", files, checks, bad);
}
