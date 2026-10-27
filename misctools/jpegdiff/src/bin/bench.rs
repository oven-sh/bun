//! Times both codecs. usage: bench [file.jpg ...]
use std::time::Instant;
fn best<T>(n: usize, mut f: impl FnMut() -> T) -> f64 {
    let mut best = f64::MAX;
    for _ in 0..n {
        let t = Instant::now();
        std::hint::black_box(f());
        best = best.min(t.elapsed().as_secs_f64());
    }
    best * 1e3
}
fn photo(w: usize, h: usize) -> Vec<u8> {
    // Smooth areas, edges and sensor noise, roughly what a photograph looks like to a codec.
    let mut x = 88172645463325252u64;
    let mut px = vec![255u8; w * h * 4];
    for yy in 0..h {
        for xx in 0..w {
            x ^= x << 13; x ^= x >> 7; x ^= x << 17;
            let (fx, fy) = (xx as f64, yy as f64);
            let base = 128.0 + 70.0 * (fx * 0.004).sin() * (fy * 0.003).cos() + 30.0 * (fx * 0.05 + fy * 0.02).sin();
            let edge = if ((xx / 97) + (yy / 61)) % 3 == 0 { 35.0 } else { 0.0 };
            let tex = 12.0 * ((fx * 0.9).sin() * (fy * 0.7).cos());
            let n = ((x % 13) as f64) - 6.0;
            let p = &mut px[(yy * w + xx) * 4..][..4];
            p[0] = (base + edge + tex + n).clamp(0.0, 255.0) as u8;
            p[1] = (base * 0.9 + edge * 0.5 + tex + n + 10.0).clamp(0.0, 255.0) as u8;
            p[2] = (base * 0.7 + 40.0 + tex * 0.5 + n).clamp(0.0, 255.0) as u8;
        }
    }
    px
}
fn main() {
    let files: Vec<String> = std::env::args().skip(1).collect();
    let (w, h) = (3000usize, 2000usize);
    let px = photo(w, h);
    let mp = (w * h) as f64 / 1e6;
    let mut inputs: Vec<(String, Vec<u8>)> = Vec::new();
    // For a profiler: PROFILE=decode|encode|decode-progressive|encode-progressive runs only that, with bun_jpeg, for a while.
    if let Ok(what) = std::env::var("PROFILE") {
        let progressive = what.ends_with("-progressive");
        let jpeg = jpegdiff::reference::encode(&px, w as u32, h as u32, 80, progressive, None).unwrap();
        for _ in 0..40 {
            if what.starts_with("decode") {
                std::hint::black_box(jpegdiff::ours(&jpeg, 8, u64::MAX).ok().unwrap().pixels.len());
            } else {
                std::hint::black_box(bun_jpeg::encode(&px, w as u32, h as u32, &bun_jpeg::EncodeOptions { quality: 80, progressive, icc_profile: None }).unwrap());
            }
        }
        return;
    }
    for (q, p) in [(80u8, false), (95, false), (80, true)] {
        let r = best(5, || jpegdiff::reference::encode(&px, w as u32, h as u32, q, p, None).unwrap());
        let o = best(5, || bun_jpeg::encode(&px, w as u32, h as u32, &bun_jpeg::EncodeOptions { quality: q, progressive: p, icc_profile: None }).unwrap());
        println!("encode q{q} progressive={p}: ref {r:.1} ms ({:.0} MP/s), ours {o:.1} ms ({:.0} MP/s), {:.2}x", mp / r * 1e3, mp / o * 1e3, o / r);
        inputs.push((format!("photo q{q} progressive={p}"), jpegdiff::reference::encode(&px, w as u32, h as u32, q, p, None).unwrap()));
    }
    for f in files { inputs.push((f.clone(), std::fs::read(&f).unwrap())); }
    for (name, bytes) in &inputs {
        for eighths in [8u32, 4, 1] {
            let r = best(5, || jpegdiff::reference::decode(bytes, eighths, u64::MAX).ok().unwrap().pixels.len());
            let o = best(5, || jpegdiff::ours(bytes, eighths, u64::MAX).ok().unwrap().pixels.len());
            println!("decode {name} ({} KB) at {eighths}/8: ref {r:.1} ms, ours {o:.1} ms, {:.2}x", bytes.len() / 1024, o / r);
        }
    }
}
