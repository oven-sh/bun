// Scratch (not part of the repository): runs parse_isolated_entity_name of jsx.rs over hex-encoded inputs and prints what the Go oracle prints.
use k3iter::ast::stable::Arena;
use k3iter::ast::{Ast, Frozen, IdAllocator, Kind, NodeFlags, NodeId, Open};
use std::io::{BufRead, Write};

fn hex(bytes: &[u8]) -> String {
    let mut s = String::new();
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    let b = s.as_bytes();
    if b.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(b.len() / 2);
    for pair in b.chunks(2) {
        let hi = (pair[0] as char).to_digit(16)?;
        let lo = (pair[1] as char).to_digit(16)?;
        out.push((hi * 16 + lo) as u8);
    }
    Some(out)
}

fn dump(a: Ast<'_>, n: NodeId, out: &mut String) {
    let js = a.flags(n).intersects(NodeFlags::JAVA_SCRIPT_FILE);
    match a.kind(n) {
        Kind::Identifier => {
            out.push_str(&format!("Id({},{},{},js={})", hex(a.text(n)), a.pos(n), a.end(n), js))
        }
        Kind::QualifiedName => {
            let q = a.as_qualified_name(n);
            out.push_str(&format!("Q({},{},js={},", a.pos(n), a.end(n), js));
            dump(a, q.left, out);
            out.push(',');
            dump(a, q.right, out);
            out.push_str(&format!(",lp={},rp={})", a.parent(q.left) == n, a.parent(q.right) == n));
        }
        k => out.push_str(&format!("?{}", k as u32)),
    }
}

fn main() {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let Some(raw) = unhex(&line) else {
            writeln!(out, "bad input").unwrap();
            continue;
        };
        let ids = IdAllocator::new();
        let arena = Arena::new();
        let open = Open::new(&arena, &ids);
        let frozen = Frozen::none();
        let a = Ast::new(&frozen, &open);
        let r = k3iter::checker::jsx::parse_isolated_entity_name(a, &raw);
        if r.is_nil() {
            writeln!(out, "nil").unwrap();
            continue;
        }
        let mut s = String::new();
        dump(a, r, &mut s);
        writeln!(out, "{}", s).unwrap();
    }
}
