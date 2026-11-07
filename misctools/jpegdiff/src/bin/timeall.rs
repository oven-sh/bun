//! Times both decoders on every file, whether it decodes or not. usage: timeall dir... Prints the slowest and the worst ratios.
use std::time::Instant;
fn main() {
    jpegdiff::reference::POISON_OUTPUT.store(false, std::sync::atomic::Ordering::Relaxed);
    let mut rows = Vec::new();
    for dir in std::env::args().skip(1) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if !path.is_file() {
                continue;
            }
            let bytes = std::fs::read(&path).unwrap();
            for eighths in [8u32, 3] {
                let (mut r, mut o) = (f64::MAX, f64::MAX);
                for _ in 0..3 {
                    let t = Instant::now();
                    std::hint::black_box(jpegdiff::reference::decode(&bytes, eighths, u64::MAX).is_ok());
                    r = r.min(t.elapsed().as_secs_f64() * 1e3);
                    let t = Instant::now();
                    std::hint::black_box(jpegdiff::ours(&bytes, eighths, u64::MAX).is_ok());
                    o = o.min(t.elapsed().as_secs_f64() * 1e3);
                }
                rows.push((o, r, eighths, bytes.len(), path.display().to_string()));
            }
        }
    }
    rows.sort_by(|a, b| b.0.total_cmp(&a.0));
    println!("slowest:");
    for (o, r, e, n, p) in rows.iter().take(12) {
        println!("  ours {o:9.2} ms  ref {r:9.2} ms  {:5.2}x  {e}/8 {n:8} B  {p}", o / r);
    }
    rows.retain(|row| row.0 > 0.2);
    rows.sort_by(|a, b| (b.0 / b.1).total_cmp(&(a.0 / a.1)));
    println!("worst ratios among those over 0.2 ms:");
    for (o, r, e, n, p) in rows.iter().take(12) {
        println!("  ours {o:9.2} ms  ref {r:9.2} ms  {:5.2}x  {e}/8 {n:8} B  {p}", o / r);
    }
}
