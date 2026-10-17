// The kernels of main.ts in Rust.   rustc -C opt-level=3 main.rs
use std::hint::black_box;

#[inline(never)]
fn copy(text: &str, bytes: &mut [u8]) -> usize {
    let mut at = 0;
    for &c in text.as_bytes() {
        if c < 0x80 {
            bytes[at] = c;
            at += 1;
        }
    }
    at
}

#[inline(never)]
fn escape(text: &str, bytes: &mut [u8]) -> usize {
    let mut at = 0;
    for &c in text.as_bytes() {
        if c == b'&' {
            bytes[at..at + 5].copy_from_slice(b"&amp;");
            at += 5;
        } else if c != b'<' && c != b'>' && c != b'"' && c != b'\'' {
            bytes[at] = c;
            at += 1;
        }
    }
    at
}

#[inline(never)]
fn scan(text: &str) -> usize {
    let (mut found, mut at) = (0, 0);
    let bytes = text.as_bytes();
    while at < bytes.len() {
        if matches!(bytes[at], b'`' | b'*' | b'[' | b'@' | b'#') {
            found += 1;
        }
        at += 1;
    }
    found + at
}

#[inline(never)]
fn sum(bytes: &[u8]) -> usize {
    bytes[..4096].iter().map(|&b| b as usize).sum()
}

fn main() {
    let arguments: Vec<String> = std::env::args().collect();
    let phrase = b"the quick brown fox jumps over the lazy dog, again & again. ";
    let text: String = (0..4096).map(|i| phrase[i % 60] as char).collect();
    let mut bytes = vec![0u8; 8192];
    let mut result = 0;
    for _ in 0..arguments[2].parse::<usize>().unwrap() {
        result = match arguments[1].as_str() {
            "copy" => copy(black_box(&text), &mut bytes),
            "escape" => escape(black_box(&text), &mut bytes),
            "scan" | "scan32" => scan(black_box(&text)),
            _ => sum(black_box(&bytes)),
        };
    }
    println!("{} {}", arguments[1], result);
}
