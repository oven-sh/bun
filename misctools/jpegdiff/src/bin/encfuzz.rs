//! Encodes generated images with both encoders and compares the bytes. usage: encfuzz [--iters N] [--seed S] [--threads T] [--max-dim D]
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
fn image(r: &mut Rng, w: usize, h: usize) -> Vec<u8> {
    let mut px = vec![0u8; w * h * 4];
    let kind = r.below(12);
    let (a, b, c) = (r.next(), r.next(), r.next());
    let amp = 1 + r.below(255);
    let period = 1 + r.below(24);
    for y in 0..h {
        for x in 0..w {
            let p = &mut px[(y * w + x) * 4..][..4];
            match kind {
                0 => { let v = r.next(); p.copy_from_slice(&(v as u32).to_le_bytes()); }
                1 => { p.copy_from_slice(&(a as u32).to_le_bytes()); }
                2 => { p[0] = (x * 255 / w.max(1)) as u8; p[1] = (y * 255 / h.max(1)) as u8; p[2] = ((x + y) * 255 / (w + h)) as u8; }
                3 => { let v = if (x / period + y / period) % 2 == 0 { 0 } else { 255 }; p[0] = v; p[1] = v; p[2] = v; }
                4 => { let v = if r.below(2) == 0 { 0 } else { 255 }; p[0] = v; p[1] = if r.below(2) == 0 { 0 } else { 255 }; p[2] = if r.below(2) == 0 { 0 } else { 255 }; }
                5 => { // smooth + noise
                    let base = ((x as f64 * 0.07 + (a % 7) as f64).sin() * 60.0 + (y as f64 * 0.05 + (b % 5) as f64).cos() * 60.0 + 128.0) as i32;
                    for k in 0..3 { p[k] = (base + (r.below(amp) as i32 - amp as i32 / 2) / 4).clamp(0, 255) as u8; }
                }
                6 => { let v = if x % 2 == 0 { 0 } else { 255 }; p[0] = v; p[1] = 255 - v; p[2] = if y % 2 == 0 { 0 } else { 255 }; }
                7 => { // sparse dots
                    let v = if r.below(period * 20) == 0 { 255 } else { (c % 256) as u8 }; p[0] = v; p[1] = v; p[2] = (b % 256) as u8;
                }
                8 => { // extremes of one DCT basis function
                    let (u, v) = ((a % 8) as f64, (b % 8) as f64);
                    let s = (((2 * (x % 8) + 1) as f64 * u * std::f64::consts::PI / 16.0).cos() * ((2 * (y % 8) + 1) as f64 * v * std::f64::consts::PI / 16.0).cos()) >= 0.0;
                    let s = if s { 255 } else { 0 }; p[0] = s; p[1] = s; p[2] = s;
                }
                9 => { p[0] = (a as u8).wrapping_add((x * period) as u8); p[1] = (b as u8).wrapping_add((y * period) as u8); p[2] = (c as u8).wrapping_add((x * y) as u8); }
                10 => { // low amplitude noise: long EOB runs and correction bits
                    for k in 0..3 { p[k] = (128 + r.below(amp.min(12)) as i32 - 3).clamp(0, 255) as u8; }
                }
                _ => { // blocks of random flat color
                    let hsh = ((x / period) as u64).wrapping_mul(0x9e3779b97f4a7c15) ^ ((y / period) as u64).wrapping_mul(0xc2b2ae3d27d4eb4f) ^ a;
                    let hsh = hsh.wrapping_mul(0xff51afd7ed558ccd); p[0] = hsh as u8; p[1] = (hsh >> 8) as u8; p[2] = (hsh >> 16) as u8;
                }
            }
            p[3] = r.next() as u8;
        }
    }
    px
}
fn main() {
    let (mut iters, mut seed, mut threads, mut max_dim) = (100_000u64, 1u64, 32usize, 100usize);
    let mut a = std::env::args().skip(1);
    while let Some(x) = a.next() {
        match x.as_str() {
            "--iters" => iters = a.next().unwrap().parse().unwrap(),
            "--seed" => seed = a.next().unwrap().parse().unwrap(),
            "--threads" => threads = a.next().unwrap().parse().unwrap(),
            "--max-dim" => max_dim = a.next().unwrap().parse().unwrap(),
            _ => panic!("unknown argument {x}"),
        }
    }
    let bad = AtomicU64::new(0);
    let done = AtomicU64::new(0);
    let oks = AtomicU64::new(0);
    let total = AtomicU64::new(0);
    std::thread::scope(|s| {
        for t in 0..threads {
            let (bad, done, oks, total) = (&bad, &done, &oks, &total);
            s.spawn(move || {
                let mut r = Rng(seed.wrapping_mul(0x9e3779b97f4a7c15) ^ (t as u64 + 1).wrapping_mul(0xd1342543de82ef95) | 1);
                for _ in 0..8 { r.next(); }
                for i in 0..iters / threads as u64 + u64::from((t as u64) < iters % threads as u64) {
                    let state = r.0;
                    let (w, h) = (1 + r.below(max_dim), 1 + r.below(max_dim));
                    let px = image(&mut r, w, h);
                    let quality = match r.below(4) { 0 => [1, 2, 49, 50, 51, 99, 100][r.below(7)], _ => 1 + r.below(100) as u8 };
                    let progressive = r.below(2) == 0;
                    let icc: Option<Vec<u8>> = match r.below(40) {
                        0 => Some((0..1 + r.below(300)).map(|_| r.next() as u8).collect()),
                        1 => Some((0..65519 - 2 + r.below(5)).map(|_| r.next() as u8).collect()),
                        2 => Some((0..65519 * 2 - 2 + r.below(5)).map(|_| r.next() as u8).collect()),
                        _ => None,
                    };
                    let want = jpegdiff::reference::encode(&px, w as u32, h as u32, quality, progressive, icc.as_deref());
                    let got = bun_jpeg::encode(&px, w as u32, h as u32, &bun_jpeg::EncodeOptions { quality, progressive, icc_profile: icc.as_deref() });
                    let same = match (&want, &got) { (Ok(a), Ok(b)) => a == b, (Err(_), Err(_)) => true, _ => false };
                    if let (Ok(a), Ok(_)) = (&want, &got) { oks.fetch_add(1, Ordering::Relaxed); total.fetch_add(a.len() as u64, Ordering::Relaxed); }
                    if !same {
                        let n = bad.fetch_add(1, Ordering::Relaxed);
                        if n < 20 {
                            let at = match (&want, &got) { (Ok(a), Ok(b)) => format!("lengths {} {} first difference at {:?}", a.len(), b.len(), a.iter().zip(b).position(|(a, b)| a != b)), _ => format!("{:?} vs {:?}", want.as_ref().map(|v| v.len()), got.as_ref().map(|v| v.len())) };
                            eprintln!("MISMATCH thread {t} iter {i} state {state:#x} {w}x{h} q{quality} progressive={progressive} icc={:?}: {at}", icc.as_ref().map(|v| v.len()));
                        }
                    }
                    done.fetch_add(1, Ordering::Relaxed);
                }
            });
        }
    });
    println!("{} images, {} encoded by both ({} bytes), {} mismatches", done.load(Ordering::Relaxed), oks.load(Ordering::Relaxed), total.load(Ordering::Relaxed), bad.load(Ordering::Relaxed));
    if bad.load(Ordering::Relaxed) != 0 { std::process::exit(1); }
}
