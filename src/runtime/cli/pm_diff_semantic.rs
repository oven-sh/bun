//! Projects a diff of the *normalized* re-prints of two files back onto their *original* lines: what changed is
//! decided on the canonical form (so `1 + 1` vs `2`, quote style or a reformat is not a change, and a branch that
//! became dead is), what is shown is the author's text (comments, types, JSX and names intact).

use crate::cli::pm_diff_normalize::Normalized;
use crate::test_runner::diff::diff_match_patch::{self, DiffMatchPatch, Operation};

/// One displayed line. Numbers are 1-based and real (they index the original files).
#[derive(Clone, Copy)]
pub(crate) struct Op<'a> {
    pub kind: Operation,
    pub old_no: usize,
    pub new_no: usize,
    pub text: &'a [u8],
    /// An unchanged line whose canonical form nevertheless changed (it moved into or out of dead code).
    pub affected: bool,
}

pub(crate) struct Projection<'a> {
    pub ops: Vec<Op<'a>>,
    /// Textually different lines that were folded away as equivalent.
    pub hidden: usize,
}

/// A plain line diff as `Op`s — the skeleton every view starts from.
pub(crate) fn line_ops<'a>(old: &'a [u8], new: &'a [u8]) -> Vec<Op<'a>> {
    let mut dmp = DiffMatchPatch::<usize>::default();
    dmp.config.diff_timeout = 1000;
    let l2c = bun_core::handle_oom(diff_match_patch::diff_lines_to_chars(old, new));
    let chars = bun_core::handle_oom(dmp.diff(&l2c.chars_1, &l2c.chars_2, false));
    // `diff_chars_to_lines` would allocate joined texts; walk the char runs and slice the inputs instead.
    let old_lines: Vec<&[u8]> = super::pm_diff_command::Lines(old).collect();
    let new_lines: Vec<&[u8]> = super::pm_diff_command::Lines(new).collect();
    let mut ops = Vec::with_capacity(old_lines.len().max(new_lines.len()) + 8);
    let (mut o, mut n) = (0usize, 0usize);
    for d in &chars {
        for _ in 0..d.text.len() {
            let (text, kind) = match d.operation {
                Operation::Equal => {
                    let t = new_lines.get(n).copied().unwrap_or(b"");
                    o += 1;
                    n += 1;
                    (t, Operation::Equal)
                }
                Operation::Delete => {
                    let t = old_lines.get(o).copied().unwrap_or(b"");
                    o += 1;
                    (t, Operation::Delete)
                }
                Operation::Insert => {
                    let t = new_lines.get(n).copied().unwrap_or(b"");
                    n += 1;
                    (t, Operation::Insert)
                }
            };
            // The number of the line just consumed on each side (a side that did not advance keeps its last).
            ops.push(Op {
                kind,
                old_no: o,
                new_no: n,
                text,
                affected: false,
            });
        }
    }
    ops
}

struct Side<'a> {
    /// Per original line (0-based): the printed lines it produced.
    images: Vec<Vec<u32>>,
    /// Per original line: the original columns that carry a mapping (token starts that survived).
    cols: Vec<Vec<u32>>,
    /// Per printed line: did the key diff mark it changed.
    key_changed: Vec<bool>,
    _text: &'a [u8],
}

impl<'a> Side<'a> {
    fn new(original: &'a [u8], norm: &Normalized, mut key_changed: Vec<bool>) -> Side<'a> {
        // Comments the printer kept (`/*!`, `@license`) are judged by the text skeleton, not the key: a changed
        // banner must not mark the statement mapped next to it.
        for (g, line) in super::pm_diff_command::Lines(&norm.text).enumerate() {
            let t = line.trim_ascii_start();
            // (`* ` continues a block comment; `*name(` is a generator method and stays.)
            let continues_block = t.starts_with(b"*")
                && !t.get(1).is_some_and(|b| {
                    b.is_ascii_alphanumeric() || *b == b'_' || *b == b'$' || *b == b'['
                });
            if t.starts_with(b"/*") || t.starts_with(b"//") || continues_block {
                if let Some(c) = key_changed.get_mut(g) {
                    *c = false;
                }
            }
        }
        let lines = bun_core::strings::count_char(original, b'\n') + 1;
        let mut images = vec![Vec::new(); lines];
        let mut cols = vec![Vec::new(); lines];
        for m in &norm.map {
            let l = m.orig_line as usize;
            if l < lines {
                if images[l].last() != Some(&m.gen_line) {
                    images[l].push(m.gen_line);
                }
                cols[l].push(m.orig_col);
            }
        }
        for c in &mut cols {
            c.sort_unstable();
            c.dedup();
        }
        for i in &mut images {
            i.sort_unstable();
            i.dedup();
        }
        Side {
            images,
            cols,
            key_changed,
            _text: original,
        }
    }
    /// The line produced canonical output and none of it changed.
    fn keyed_equal(&self, line0: usize) -> bool {
        self.images.get(line0).is_some_and(|im| {
            !im.is_empty()
                && im
                    .iter()
                    .all(|&g| !self.key_changed.get(g as usize).copied().unwrap_or(true))
        })
    }
    fn no_image(&self, line0: usize) -> bool {
        self.images.get(line0).is_none_or(Vec::is_empty)
    }
    /// Some surviving token starts inside `[lo, hi)` on that line: the differing text is code the key vouched for.
    fn mapped_within(&self, line0: usize, lo: usize, hi: usize) -> bool {
        self.cols
            .get(line0)
            .is_some_and(|c| c.iter().any(|&col| (lo..hi).contains(&(col as usize))))
    }
}

/// Only whitespace and grouping punctuation: a line the printer may add or drop without meaning anything.
fn trivial(text: &[u8]) -> bool {
    text.iter().all(|b| {
        b.is_ascii_whitespace()
            || matches!(b, b'(' | b')' | b'{' | b'}' | b'[' | b']' | b';' | b',')
    })
}

/// For lines the key has no opinion on (directives, lone comments): equal once whitespace, semicolons and quote
/// style are ignored.
fn loose(text: &[u8]) -> Vec<u8> {
    text.iter()
        .filter(|b| !b.is_ascii_whitespace() && **b != b';')
        .map(|&b| if b == b'\'' { b'"' } else { b })
        .collect()
}

fn changed_lines(a: &[u8], b: &[u8]) -> (Vec<bool>, Vec<bool>) {
    let mut dmp = DiffMatchPatch::<usize>::default();
    dmp.config.diff_timeout = 1000;
    let l2c = bun_core::handle_oom(diff_match_patch::diff_lines_to_chars(a, b));
    let chars = bun_core::handle_oom(dmp.diff(&l2c.chars_1, &l2c.chars_2, false));
    let (mut ca, mut cb) = (Vec::new(), Vec::new());
    for d in &chars {
        for _ in 0..d.text.len() {
            match d.operation {
                Operation::Equal => {
                    ca.push(false);
                    cb.push(false);
                }
                Operation::Delete => ca.push(true),
                Operation::Insert => cb.push(true),
            }
        }
    }
    (ca, cb)
}

fn widen(text: &[u8], (mut lo, mut hi): (usize, usize)) -> (usize, usize) {
    let ident = |b: u8| b.is_ascii_alphanumeric() || b == b'_' || b == b'$' || b & 0x80 != 0;
    while lo > 0 && ident(text[lo - 1]) && text.get(lo).is_some_and(|&b| ident(b)) {
        lo -= 1;
    }
    while hi < text.len() && ident(text[hi]) && hi > 0 && ident(text[hi - 1]) {
        hi += 1;
    }
    (lo, hi)
}

/// The differing byte span of `a` against `b` (common prefix/suffix removed).
fn span(a: &[u8], b: &[u8]) -> (usize, usize) {
    let lo = a.iter().zip(b).take_while(|(x, y)| x == y).count();
    let max_suffix = a.len().min(b.len()) - lo;
    let suffix = a
        .iter()
        .rev()
        .zip(b.iter().rev())
        .take(max_suffix)
        .take_while(|(x, y)| x == y)
        .count();
    (lo, a.len() - suffix)
}

pub(crate) fn project<'a>(
    old: &'a [u8],
    new: &'a [u8],
    key_old: &Normalized,
    key_new: &Normalized,
) -> Projection<'a> {
    let (kco, kcn) = changed_lines(&key_old.text, &key_new.text);
    let so = Side::new(old, key_old, kco);
    let sn = Side::new(new, key_new, kcn);
    let raw = line_ops(old, new);
    let mut ops: Vec<Op<'a>> = Vec::with_capacity(raw.len());
    let mut hidden = 0usize;
    let mut i = 0;
    while i < raw.len() {
        if raw[i].kind == Operation::Equal {
            let op = raw[i];
            // Same text on both sides but only one side produced code from it: it went dead, or came alive.
            let affected =
                !trivial(op.text) && (so.no_image(op.old_no - 1) != sn.no_image(op.new_no - 1));
            ops.push(Op { affected, ..op });
            i += 1;
            continue;
        }
        let start = i;
        while i < raw.len() && raw[i].kind != Operation::Equal {
            i += 1;
        }
        let run = &raw[start..i];
        let dels: Vec<Op<'a>> = run
            .iter()
            .filter(|o| o.kind == Operation::Delete)
            .copied()
            .collect();
        let ins: Vec<Op<'a>> = run
            .iter()
            .filter(|o| o.kind == Operation::Insert)
            .copied()
            .collect();
        // A line may fold away when the key vouches for it, it is only punctuation, or (having no image at all —
        // a directive, a lone comment) it loosely equals an image-less line on the other side.
        let unseen_old: Vec<Vec<u8>> = dels
            .iter()
            .filter(|d| so.no_image(d.old_no - 1) && !trivial(d.text))
            .map(|d| loose(d.text))
            .collect();
        let unseen_new: Vec<Vec<u8>> = ins
            .iter()
            .filter(|n| sn.no_image(n.new_no - 1) && !trivial(n.text))
            .map(|n| loose(n.text))
            .collect();
        let ok = |side: &Side, line0: usize, text: &[u8], others: &[Vec<u8>]| {
            if side.no_image(line0) {
                trivial(text) || others.contains(&loose(text))
            } else {
                side.keyed_equal(line0)
            }
        };
        if dels.len() == ins.len() {
            // Line against line: beyond both being vouched for, the differing span itself must be code the key saw
            // (or whitespace) — otherwise it is a type annotation or inline comment riding on an unchanged statement.
            // Kept pairs stay adjacent (`-` then `+`); hidden ones become the new side's line as context, in place.
            let mut keep_d: Vec<Op<'a>> = Vec::new();
            let mut keep_n: Vec<Op<'a>> = Vec::new();
            let flush =
                |ops: &mut Vec<Op<'a>>, keep_d: &mut Vec<Op<'a>>, keep_n: &mut Vec<Op<'a>>| {
                    ops.append(keep_d);
                    ops.append(keep_n);
                };
            for (d, n) in dels.iter().zip(&ins) {
                let (dl, nl) = (d.old_no - 1, n.new_no - 1);
                let mut hide = ok(&so, dl, d.text, &unseen_new) && ok(&sn, nl, n.text, &unseen_old);
                if hide && !so.no_image(dl) && !sn.no_image(nl) {
                    // Out to token edges, so a renamed identifier is judged by its own mapping (`utils` → `utils$1`).
                    let (dlo, dhi) = widen(d.text, span(d.text, n.text));
                    let (nlo, nhi) = widen(n.text, span(n.text, d.text));
                    let ws = |t: &[u8], lo: usize, hi: usize| {
                        t[lo..hi].iter().all(u8::is_ascii_whitespace)
                    };
                    hide = (ws(d.text, dlo, dhi) || so.mapped_within(dl, dlo, dhi))
                        && (ws(n.text, nlo, nhi) || sn.mapped_within(nl, nlo, nhi));
                }
                if hide {
                    hidden += usize::from(!trivial(d.text));
                    flush(&mut ops, &mut keep_d, &mut keep_n);
                    ops.push(Op {
                        kind: Operation::Equal,
                        ..*n
                    });
                } else {
                    keep_d.push(*d);
                    keep_n.push(*n);
                }
            }
            flush(&mut ops, &mut keep_d, &mut keep_n);
        } else {
            for d in &dels {
                if ok(&so, d.old_no - 1, d.text, &unseen_new) {
                    hidden += usize::from(!trivial(d.text));
                } else {
                    ops.push(*d);
                }
            }
            for n in &ins {
                if ok(&sn, n.new_no - 1, n.text, &unseen_old) {
                    ops.push(Op {
                        kind: Operation::Equal,
                        ..*n
                    });
                } else {
                    ops.push(*n);
                }
            }
        }
    }
    Projection { ops, hidden }
}
