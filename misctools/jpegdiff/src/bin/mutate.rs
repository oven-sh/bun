//! Mutates corpus files at random and compares both decoders. usage: mutate <corpus dir>... [--iters N] [--seed S] [--threads T]
use std::sync::atomic::{AtomicU64, Ordering};
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}
const SPECIAL: &[u8] = &[0, 1, 2, 3, 4, 7, 8, 0x0f, 0x10, 0x11, 0x12, 0x21, 0x22, 0x3f, 0x40, 0x7f, 0x80, 0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xd0, 0xd1, 0xd2, 0xd5, 0xd7, 0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xe0, 0xe2, 0xee, 0xfe, 0xff];
fn mutate(r: &mut Rng, d: &mut Vec<u8>, other: &[u8]) {
    if d.is_empty() {
        d.push(0xff);
    }
    // Headers are a small part of a file and most of its structure.
    let pos = |r: &mut Rng, len: usize| if r.below(3) == 0 { r.below(len.min(700)) } else { r.below(len) };
    match r.below(12) {
        0 => { let i = pos(r, d.len()); d[i] ^= 1 << r.below(8); }
        1 => { let i = pos(r, d.len()); d[i] = r.next() as u8; }
        2 => { let i = pos(r, d.len()); d[i] = SPECIAL[r.below(SPECIAL.len())]; }
        3 => { let i = pos(r, d.len()); d.truncate(i.max(1)); }
        4 => { let i = pos(r, d.len()); let n = 1 + r.below(8).min(d.len() - i - 1); d.drain(i..(i + n).min(d.len())); }
        5 => { let i = pos(r, d.len()); let n = 1 + r.below(64); let e = (i + n).min(d.len()); let c = d[i..e].to_vec(); let j = pos(r, d.len()); d.splice(j..j, c); }
        6 => { let i = pos(r, d.len()); let n = 1 + r.below(6); let c: Vec<u8> = (0..n).map(|_| r.next() as u8).collect(); d.splice(i..i, c); }
        7 => { let i = pos(r, d.len()); d.splice(i..i, [0xff, SPECIAL[r.below(SPECIAL.len())]]); }
        8 => { let i = pos(r, d.len()); let v = d[i].wrapping_add(if r.below(2) == 0 { 1 } else { 255 }); d[i] = v; }
        9 => { // splice in a piece of another file
            if !other.is_empty() { let a = r.below(other.len()); let n = 1 + r.below(300); let e = (a + n).min(other.len()); let j = pos(r, d.len()); d.splice(j..j, other[a..e].iter().copied()); }
        }
        10 => { // overwrite with a piece of another file
            if !other.is_empty() { let a = r.below(other.len()); let n = 1 + r.below(100); let j = pos(r, d.len()); for k in 0..n { if a + k < other.len() && j + k < d.len() { d[j + k] = other[a + k]; } } }
        }
        _ => { // find a marker and change a byte shortly after it
            let start = r.below(d.len());
            if let Some(o) = d[start..].iter().position(|&b| b == 0xff) { let i = (start + o + 1 + r.below(20)).min(d.len() - 1); d[i] = if r.below(2) == 0 { r.next() as u8 } else { SPECIAL[r.below(SPECIAL.len())] }; }
        }
    }
}
fn main() {
    let mut dirs = Vec::new();
    let (mut iters, mut seed, mut threads) = (1_000_000u64, 1u64, 32usize);
    let mut a = std::env::args().skip(1);
    while let Some(x) = a.next() {
        match x.as_str() {
            "--iters" => iters = a.next().unwrap().parse().unwrap(),
            "--seed" => seed = a.next().unwrap().parse().unwrap(),
            "--threads" => threads = a.next().unwrap().parse::<std::num::NonZero<usize>>().unwrap().get(),
            _ => dirs.push(x),
        }
    }
    let mut corpus = Vec::new();
    for d in &dirs {
        let mut v: Vec<_> = std::fs::read_dir(d).unwrap().map(|e| e.unwrap().path()).filter(|p| p.is_file()).collect();
        v.sort();
        for p in v {
            let b = std::fs::read(&p).unwrap();
            if b.len() < 200_000 { corpus.push(b); }
        }
    }
    if corpus.is_empty() {
        eprintln!("no files to start from");
        std::process::exit(2);
    }
    std::fs::create_dir_all("/root/ref/corpus/fail").unwrap();
    let bad = AtomicU64::new(0);
    let kinds: [AtomicU64; 5] = Default::default();
    std::thread::scope(|s| {
        for t in 0..threads {
            let (corpus, bad, kinds) = (&corpus, &bad, &kinds);
            s.spawn(move || {
                let mut r = Rng(seed.wrapping_mul(0x9E3779B97F4A7C15) ^ (t as u64 + 1).wrapping_mul(0xD1B54A32D192ED03) | 1);
                for _ in 0..8 { r.next(); }
                for i in 0..iters / threads as u64 + u64::from((t as u64) < iters % threads as u64) {
                    let mut d = corpus[r.below(corpus.len())].clone();
                    let other = &corpus[r.below(corpus.len())];
                    for _ in 0..1 + r.below(4) { mutate(&mut r, &mut d, other); }
                    let eighths = if r.below(2) == 0 { 8 } else { 1 + r.below(8) as u32 };
                    match jpegdiff::compare(&d, eighths, 1 << 24) {
                        Ok(k) => { let j = match k { "ok" => 0, "ok-warned" => 1, "header-fail" => 2, "decode-fail" => 3, _ => 4 }; kinds[j].fetch_add(1, Ordering::Relaxed); }
                        Err(e) => {
                            let n = bad.fetch_add(1, Ordering::Relaxed);
                            if n < 40 {
                                let p = format!("/root/ref/corpus/fail/s{seed}_t{t}_i{i}_sc{eighths}.jpg");
                                std::fs::write(&p, &d).unwrap();
                                println!("MISMATCH {p}: {e}");
                            }
                        }
                    }
                }
            });
        }
    });
    let k: Vec<u64> = kinds.iter().map(|k| k.load(Ordering::Relaxed)).collect();
    println!("ok {} ok-warned {} header-fail {} decode-fail {} redundant-scan {}; {} mismatches", k[0], k[1], k[2], k[3], k[4], bad.load(Ordering::Relaxed));
}
