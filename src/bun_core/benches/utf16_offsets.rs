//! Microbenchmark for `Utf16OffsetTable::from_valid` (new) against `from_lossy` (previous implementation).
//! Run via `bun scripts/bench-utf16-offsets.mjs [case filter]`, or with `--test` for the module's unit tests.
//!
//! Not a criterion bench like `src/parsers/benches`: a bench binary of `bun_core` does not link without
//! JSC and the C libraries. The script compiles a copy of `string/immutable/utf16_offsets.rs` with its
//! private functions made `pub` instead, so the code measured is the code that ships. `first_non_ascii`
//! is a stand-in for the simdutf one, with the same cost on both sides.
//!
//! The inputs are synthetic, to isolate the density and the script of the non-ASCII text, the size, and
//! text that is not UTF-8. `bench/snippets/utf16-offsets-lint.mjs` has real files.
#![feature(portable_simd)]
#![allow(dead_code)]

use std::hint::black_box;
use std::simd::prelude::*;
use std::time::Instant;

mod utf16_offsets;
use utf16_offsets::Utf16OffsetTable;

/// Stand-in for `bun_core::strings::first_non_ascii`, which is simdutf in Bun. Same cost for both paths.
pub fn first_non_ascii(text: &[u8]) -> Option<u32> {
    let mut at = 0;
    while at + 32 <= text.len() {
        let block = u8x32::from_slice(&text[at..at + 32]);
        let mask = block.simd_ge(u8x32::splat(0x80)).to_bitmask();
        if mask != 0 {
            return Some((at + mask.trailing_zeros() as usize) as u32);
        }
        at += 32;
    }
    text[at..].iter().position(|&b| b >= 0x80).map(|i| (at + i) as u32)
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

/// `size` bytes of ASCII with one of `pieces` after about every `every` ASCII bytes.
fn mixed(size: usize, every: u64, pieces: &[&str]) -> Vec<u8> {
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    let mut text = String::new();
    while text.len() < size {
        text.push_str("let value = compute(a, b);");
        if rng.next() % every == 0 {
            text.push_str(pieces[(rng.next() % pieces.len() as u64) as usize]);
        }
    }
    text.truncate(size - size % 4);
    while std::str::from_utf8(text.as_bytes()).is_err() || !text.is_char_boundary(text.len()) {
        text.pop();
    }
    text.into_bytes()
}

fn time(text: &[u8], f: fn(&[u8]) -> usize) -> f64 {
    let budget = std::time::Duration::from_millis(250);
    let mut samples = Vec::new();
    let start = Instant::now();
    while start.elapsed() < budget || samples.len() < 9 {
        let t = Instant::now();
        black_box(f(black_box(text)));
        samples.push(t.elapsed().as_nanos() as f64);
    }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    samples[samples.len() / 2]
}

fn new(text: &[u8]) -> usize {
    Utf16OffsetTable::without_bom(text).len()
}
fn old(text: &[u8]) -> usize {
    Utf16OffsetTable::from_lossy_for_bench(text).len()
}

fn main() {
    let filter = std::env::args().nth(1);
    let accents = ["é", "ñ", "ü"];
    let cjk = ["日本語", "中文"];
    let emoji = ["😀", "🎉"];
    let mixed_all = ["é", "日本", "😀", "ß"];
    let mut cases: Vec<(String, Vec<u8>)> = Vec::new();
    for size in [64usize, 1 << 10, 64 << 10, 1 << 20] {
        let label = |name: &str| format!("{name} {}", if size >= 1 << 10 { format!("{}KiB", size >> 10) } else { format!("{size}B") });
        cases.push((label("ascii"), mixed(size, u64::MAX, &["x"]).into_iter().collect()));
        cases.push((label("sparse latin-1 (1/100 lines)"), mixed(size, 100, &accents)));
        cases.push((label("latin-1 (1/4)"), mixed(size, 4, &accents)));
        cases.push((label("cjk (1/4)"), mixed(size, 4, &cjk)));
        cases.push((label("emoji (1/4)"), mixed(size, 4, &emoji)));
        cases.push((label("mixed scripts (1/2)"), mixed(size, 2, &mixed_all)));
        let mut bad = mixed(size, 4, &accents);
        // One stray continuation byte near the end: `from_valid` fails after scanning everything, then the lossy path runs.
        let at = bad.len() - 3;
        bad[at] = 0xFF;
        cases.push((label("invalid at end (fallback cost)"), bad));
    }
    println!("{:<44} {:>12} {:>12} {:>9} {:>9}", "case", "old ns", "new ns", "old GB/s", "new GB/s");
    for (name, text) in &cases {
        if filter.as_ref().is_some_and(|f| !name.contains(f.as_str())) {
            continue;
        }
        assert_eq!(old(text), new(text), "{name}");
        let (o, n) = (time(text, old), time(text, new));
        let gbs = |ns: f64| text.len() as f64 / ns;
        println!("{name:<44} {o:>12.0} {n:>12.0} {:>9.2} {:>9.2}  ({:.2}x)", gbs(o), gbs(n), o / n);
    }
}
