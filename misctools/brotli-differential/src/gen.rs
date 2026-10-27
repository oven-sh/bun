//! Input data generators.
use crate::rng::Rng;

pub struct Corpus {
    pub files: Vec<Vec<u8>>,
}

impl Corpus {
    pub fn load(dirs: &[&str], max_file: usize) -> Self {
        let mut files = Vec::new();
        for d in dirs {
            let mut stack = vec![std::path::PathBuf::from(d)];
            while let Some(p) = stack.pop() {
                let Ok(md) = std::fs::metadata(&p) else { continue };
                if md.is_dir() {
                    if let Ok(rd) = std::fs::read_dir(&p) {
                        let mut v: Vec<_> = rd.flatten().map(|e| e.path()).collect();
                        v.sort();
                        stack.extend(v);
                    }
                } else if md.len() > 0 && (md.len() as usize) <= max_file {
                    if let Ok(b) = std::fs::read(&p) {
                        files.push(b);
                    }
                }
            }
        }
        Self { files }
    }
}

/// Data of `len` bytes with a randomly chosen structure.
pub fn data(rng: &mut Rng, corpus: &Corpus, len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(len);
    while out.len() < len {
        let want = len - out.len();
        let seg = rng.range(1, want.max(1)).min(want);
        match rng.below(10) {
            0 => out.extend((0..seg).map(|_| rng.next() as u8)),
            1 => {
                let b = rng.next() as u8;
                out.extend(std::iter::repeat_n(b, seg));
            }
            2 => {
                let alpha = rng.range(2, 16);
                out.extend((0..seg).map(|_| b'a' + rng.below(alpha) as u8));
            }
            3 if !out.is_empty() => {
                // copy from earlier
                let dist = rng.range(1, out.len());
                for _ in 0..seg {
                    out.push(out[out.len() - dist]);
                }
            }
            4 => {
                // period pattern
                let period = rng.range(1, 64);
                let pat: Vec<u8> = (0..period).map(|_| rng.next() as u8).collect();
                out.extend((0..seg).map(|i| pat[i % period]));
            }
            5 => {
                // words
                const W: &[&str] = &["the ", "of ", "and ", "time", "down", "life", "left", "back", "code", " that ", "http://", "<div>", "</div>", "function", "return ", "\n", ". ", ", ", "The ", "ing ", "Internet", "information", "\u{00e9}", "\u{4e2d}\u{6587}"];
                let start = out.len();
                while out.len() - start < seg {
                    out.extend_from_slice(rng.pick(W).as_bytes());
                }
                out.truncate(start + seg);
            }
            6 => {
                // int32 table (postfix-friendly)
                let mut v = rng.next() as u32;
                let start = out.len();
                while out.len() - start < seg {
                    v = v.wrapping_add(rng.below(7) as u32);
                    out.extend_from_slice(&v.to_le_bytes());
                }
                out.truncate(start + seg);
            }
            _ if !corpus.files.is_empty() => {
                let f = rng.pick(&corpus.files);
                let off = rng.below(f.len());
                let n = seg.min(f.len() - off);
                out.extend_from_slice(&f[off..off + n]);
            }
            _ => out.extend((0..seg).map(|_| (rng.next() as u8) & 0x3f)),
        }
    }
    out.truncate(len);
    out
}

pub fn length(rng: &mut Rng, max: usize) -> usize {
    match rng.below(10) {
        0 => rng.below(4),
        1 => rng.below(64),
        2 | 3 => rng.below(1024),
        4 | 5 | 6 => rng.below(65536.min(max)),
        7 | 8 => rng.below((1 << 20).min(max)),
        _ => rng.below(max),
    }
    .min(max)
}
