//! Encoder cases that random images do not reach.
fn check(name: &str, px: &[u8], w: u32, h: u32, quality: u8, progressive: bool, icc: Option<&[u8]>) {
    let want = jpegdiff::reference::encode(px, w, h, quality, progressive, icc);
    let got = bun_jpeg::encode(px, w, h, &bun_jpeg::EncodeOptions { quality, progressive, icc_profile: icc });
    let same = match (&want, &got) { (Ok(a), Ok(b)) => a == b, (Err(_), Err(_)) => true, _ => false };
    println!("{} {name} {w}x{h} q{quality} p={progressive}: {:?} / {:?}", if same { "ok      " } else { "MISMATCH" }, want.as_ref().map(|v| v.len()), got.as_ref().map(|v| v.len()).map_err(|e| e.to_string()));
}
fn main() {
    for progressive in [false, true] {
        for (w, h) in [(1600u32, 1600u32), (2896, 2896), (65500, 1), (1, 65500), (65501, 1), (1, 65501), (65500, 17), (4096, 16)] {
            let flat = vec![200u8; w as usize * h as usize * 4];
            check("flat", &flat, w, h, 80, progressive, None);
            // Nothing but correction bits after the first block of each run.
            let mut x = 88172645463325252u64;
            let noisy: Vec<u8> = (0..w as usize * h as usize * 4).map(|_| { x ^= x << 13; x ^= x >> 7; x ^= x << 17; 120 + (x % 9) as u8 }).collect();
            check("faint noise", &noisy, w, h, 100, progressive, None);
            check("faint noise", &noisy, w, h, 60, progressive, None);
        }
        let px = vec![7u8; 8 * 8 * 4];
        let icc: Vec<u8> = (0..65519usize * 257 + 5).map(|i| (i * 7) as u8).collect();
        check("huge icc", &px, 8, 8, 90, progressive, Some(&icc));
        check("icc 255 chunks", &px, 8, 8, 90, progressive, Some(&icc[..65519 * 255]));
        check("icc 256 chunks", &px, 8, 8, 90, progressive, Some(&icc[..65519 * 255 + 1]));
    }
}
