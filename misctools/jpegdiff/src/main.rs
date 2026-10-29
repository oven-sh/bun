use std::collections::BTreeMap;
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut files = Vec::new();
    for a in &args {
        let p = std::path::Path::new(a);
        if p.is_dir() {
            let mut v: Vec<_> = std::fs::read_dir(p).unwrap().map(|e| e.unwrap().path()).filter(|p| p.is_file()).collect();
            v.sort();
            files.extend(v);
        } else {
            files.push(p.to_path_buf());
        }
    }
    if files.is_empty() {
        eprintln!("no files");
        std::process::exit(2);
    }
    let mut tally: BTreeMap<&'static str, usize> = BTreeMap::new();
    let mut bad = 0;
    for f in &files {
        let bytes = std::fs::read(f).unwrap();
        for eighths in (1..=8).rev() {
            match jpegdiff::compare(&bytes, eighths, 1 << 28) {
                Ok(kind) => *tally.entry(kind).or_default() += 1,
                Err(e) => {
                    bad += 1;
                    if bad <= 60 {
                        println!("MISMATCH {} scale {eighths}/8: {e}", f.display());
                    }
                }
            }
        }
    }
    println!("{} files, {tally:?}, {bad} mismatches", files.len());
    std::process::exit((bad != 0) as i32);
}
