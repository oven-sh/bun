//! `bun-hir fuzz`: damages real files and parses what is left.
//!
//! The parser has to refuse or to parse, never to crash or to hang. What it parses is compared with
//! the result of the parser that recovers from errors: a damaged text that it accepts has to be
//! valid for that one too, with the same HIR.

use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

/// What became of a damaged text.
pub(crate) enum Verdict {
    Refused,
    Identical,
    /// A defect, with what it is.
    Wrong(String),
}

/// xorshift64*
struct Random(u64);

impl Random {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

/// The ranges of what are roughly the tokens of `text`: words, and single other characters that
/// are no blanks.
fn pieces(text: &[u8]) -> Vec<(usize, usize)> {
    let is_word = |c: u8| c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c >= 0x80;
    let (mut pieces, mut at) = (Vec::new(), 0);
    while at < text.len() {
        let start = at;
        if is_word(text[at]) {
            while at < text.len() && is_word(text[at]) {
                at += 1;
            }
        } else {
            at += 1;
            if text[start].is_ascii_whitespace() {
                continue;
            }
        }
        pieces.push((start, at));
    }
    pieces
}

const INSERTED: [&[u8]; 40] = [
    b"(",
    b")",
    b"{",
    b"}",
    b"[",
    b"]",
    b"<",
    b">",
    b",",
    b";",
    b":",
    b"?",
    b".",
    b"...",
    b"=>",
    b"=",
    b"!",
    b"&",
    b"|",
    b"*",
    b"/",
    b"`",
    b"${",
    b"'",
    b"\"",
    b"\\",
    b"#",
    b"@",
    b"\n",
    b"/*",
    b"*/",
    b"//",
    b" as ",
    b" in ",
    b" of ",
    b" await ",
    b" yield ",
    b" async ",
    b" typeof ",
    b"\xE2\x80\xA8",
];

/// One damaged version of `text`.
fn damage(text: &[u8], pieces: &[(usize, usize)], random: &mut Random) -> Vec<u8> {
    let piece = |random: &mut Random| pieces[random.below(pieces.len())];
    let mut out = Vec::with_capacity(text.len() + 8);
    match random.below(8) {
        // The text ends after a token.
        0 => out.extend_from_slice(&text[..piece(random).1]),
        // A token is gone.
        1 => {
            let (start, end) = piece(random);
            out.extend_from_slice(&text[..start]);
            out.extend_from_slice(&text[end..]);
        }
        // A token is there twice.
        2 => {
            let (start, end) = piece(random);
            out.extend_from_slice(&text[..end]);
            out.push(b' ');
            out.extend_from_slice(&text[start..]);
        }
        // A token is replaced by another token of the text.
        3 => {
            let ((start, end), (from, to)) = (piece(random), piece(random));
            out.extend_from_slice(&text[..start]);
            out.extend_from_slice(&text[from..to]);
            out.extend_from_slice(&text[end..]);
        }
        // Something is inserted before a token.
        4 | 5 => {
            let (start, _) = piece(random);
            out.extend_from_slice(&text[..start]);
            out.extend_from_slice(INSERTED[random.below(INSERTED.len())]);
            out.extend_from_slice(&text[start..]);
        }
        // A byte is another byte.
        6 => {
            out.extend_from_slice(text);
            let at = random.below(out.len());
            out[at] = random.next() as u8;
        }
        // The text starts at a token.
        _ => out.extend_from_slice(&text[piece(random).0..]),
    }
    out
}

/// Parses `rounds` damaged versions of each of `files`. `judge` parses one. Defects are written to
/// `keep`, a directory.
pub(crate) fn run(
    files: &[String],
    (rounds, seed, jobs): (usize, u64, usize),
    keep: &str,
    judge: &(dyn Fn(&[u8], &[u8]) -> Verdict + Sync),
) {
    let (refused, identical) = (AtomicUsize::new(0), AtomicUsize::new(0));
    let wrong: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let _ = std::fs::create_dir_all(keep);
    bun_sema_standalone::for_each_parallel(jobs, files.len(), |i| {
        let Ok(text) = std::fs::read(&files[i]) else {
            return;
        };
        let pieces = pieces(&text);
        if pieces.is_empty() {
            return;
        }
        let mut random = Random(seed ^ (i as u64 + 1).wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
        let extension = files[i].rsplit('.').next().unwrap_or("ts");
        // What is being parsed, for the case that the process dies.
        let current = format!(
            "{keep}/current-{:?}.{extension}",
            std::thread::current().id()
        );
        for round in 0..rounds {
            let damaged = damage(&text, &pieces, &mut random);
            let _ = std::fs::write(&current, &damaged);
            match judge(files[i].as_bytes(), &damaged) {
                Verdict::Refused => _ = refused.fetch_add(1, Ordering::Relaxed),
                Verdict::Identical => _ = identical.fetch_add(1, Ordering::Relaxed),
                Verdict::Wrong(what) => {
                    let name = format!("{keep}/wrong-{i}-{round}.{extension}");
                    let _ = std::fs::write(&name, &damaged);
                    wrong
                        .lock()
                        .unwrap()
                        .push(format!("{name} (from {}): {what}", files[i]));
                }
            }
        }
        let _ = std::fs::remove_file(&current);
    });
    let wrong = wrong.into_inner().unwrap();
    for line in wrong.iter().take(40) {
        println!("WRONG {line}");
    }
    println!(
        "{} damaged texts: {} refused, {} parsed and identical, {} wrong",
        refused.load(Ordering::Relaxed) + identical.load(Ordering::Relaxed) + wrong.len(),
        refused.load(Ordering::Relaxed),
        identical.load(Ordering::Relaxed),
        wrong.len()
    );
}
