// The line map functions of the final src/lint/scanner.rs, over raw text, against the reference.
use std::io::{BufRead, Write};

fn compute_ecma_line_starts(text: &[u8]) -> Vec<u32> {
    let mut result: Vec<u32> = Vec::new();
    let mut pos: usize = 0;
    let mut line_start: usize = 0;
    while let Some(&b) = text.get(pos) {
        pos += 1;
        match b {
            b'\r' => {
                if text.get(pos) == Some(&b'\n') {
                    pos += 1;
                }
            }
            b'\n' => {}
            0xE2 => match text.get(pos..pos + 2) {
                Some([0x80, 0xA8 | 0xA9]) => pos += 2,
                _ => continue,
            },
            _ => continue,
        }
        result.push(to_u32(line_start));
        line_start = pos;
    }
    result.push(to_u32(line_start));
    result
}

fn to_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

fn utf16_len(s: &[u8]) -> u32 {
    let mut n: usize = 0;
    for chunk in s.utf8_chunks() {
        n += chunk.valid().chars().map(char::len_utf16).sum::<usize>();
        n += chunk.invalid().len();
    }
    to_u32(n)
}

fn compute_line_of_position(line_starts: &[u32], pos: u32) -> usize {
    line_starts
        .partition_point(|&start| start <= pos)
        .saturating_sub(1)
}

fn position(text: &[u8], line_map: &[u32], pos: u32) -> (usize, u32) {
    let line = compute_line_of_position(line_map, pos);
    let line_start = line_map.get(line).copied().unwrap_or(0) as usize;
    let end = (pos as usize).min(text.len());
    (line, utf16_len(text.get(line_start..end).unwrap_or(b"")))
}

fn unhex(s: &str) -> Vec<u8> {
    if s == "-" {
        return Vec::new();
    }
    let b = s.as_bytes();
    let v = |c: u8| if c.is_ascii_digit() { c - b'0' } else { c - b'a' + 10 };
    b.chunks(2).map(|p| v(p[0]) * 16 + v(p[1])).collect()
}

fn main() {
    let stdin = std::io::stdin();
    let mut out = std::io::BufWriter::new(std::io::stdout());
    for line in stdin.lock().lines() {
        let text = unhex(line.unwrap().trim());
        let map = compute_ecma_line_starts(&text);
        write!(out, "{:?}", map).unwrap();
        for pos in 0..=text.len() {
            let (l, c) = position(&text, &map, pos as u32);
            write!(out, " {}:{}", l, c).unwrap();
        }
        writeln!(out).unwrap();
    }
}
