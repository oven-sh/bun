//! Writes CMYK and YCCK files into a directory. usage: mkcmyk <dir>
fn main() {
    let dir = std::env::args().nth(1).unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    let mut x = 88172645463325252u64;
    for (w, h) in [(33u32, 31u32), (17, 15), (5, 7)] {
        let px: Vec<u8> = (0..w * h * 4).map(|i| {
            x ^= x << 13; x ^= x >> 7; x ^= x << 17;
            let (p, c) = (i / 4, i % 4);
            ((p % w) * (3 + c) + (p / w) * (7 - c) + (x % 9) as u32) as u8
        }).collect();
        for (cs, cs_name) in [(3, "cmyk"), (4, "ycck")] {
            for (ss, ss_name) in [(0, "444"), (1, "422"), (2, "420"), (4, "440"), (5, "411")] {
                for (progressive, arithmetic, mode) in [(false, false, "seq"), (true, false, "prog"), (false, true, "ari")] {
                    match jpegdiff::reference::encode_cmyk(&px, w, h, cs, ss, progressive, arithmetic) {
                        Ok(v) => std::fs::write(format!("{dir}/c{w}x{h}_{cs_name}{ss_name}{mode}.jpg"), v).unwrap(),
                        Err(e) => eprintln!("{cs_name} {ss_name} {mode}: {e}"),
                    }
                }
            }
        }
    }
}
