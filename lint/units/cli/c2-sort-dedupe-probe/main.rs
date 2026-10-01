// Probe: the port in src/lint against the oracle that run.sh builds from the reference, on the cases of gen.py.
use std::borrow::Cow;
use std::fmt::Write as _;
use std::io::Write as _;

#[path = "LINT_DIR/diagnostic.rs"]
pub mod diagnostic;
#[path = "LINT_DIR/program.rs"]
pub mod program;
pub mod scanner {
    pub fn compute_ecma_line_starts(_text: &[u8]) -> Vec<u32> {
        vec![0]
    }
}

use diagnostic::{
    Category, Code, Diagnostic, FileId, MessageChain, SourceFile, compare_diagnostics,
    equal_diagnostics, equal_diagnostics_no_related_info,
};

struct Reader<'a> {
    tokens: std::str::SplitAsciiWhitespace<'a>,
}

impl Reader<'_> {
    fn next(&mut self) -> &str {
        self.tokens.next().expect("token")
    }
    fn int(&mut self) -> i64 {
        self.next().parse().expect("int")
    }
    fn bytes(&mut self) -> Vec<u8> {
        let t = &self.next().as_bytes()[1..];
        t.chunks(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect()
    }
    fn chain(&mut self) -> Vec<MessageChain> {
        let n = self.int();
        (0..n)
            .map(|_| {
                let text = self.bytes();
                let next = self.chain();
                MessageChain {
                    text: Cow::Owned(text),
                    next,
                }
            })
            .collect()
    }
    fn diag(&mut self) -> Diagnostic {
        let file = self.int();
        let start = self.int() as u32;
        let length = self.int() as u32;
        let category = match self.int() {
            0 => Category::Warning,
            1 => Category::Error,
            2 => Category::Suggestion,
            _ => Category::Message,
        };
        let code = match self.next() {
            "T" => Code::Ts(self.int() as u32),
            _ => Code::Name(Box::leak(
                String::from_utf8(self.bytes()).unwrap().into_boxed_str(),
            )),
        };
        let text = self.bytes();
        let chain = self.chain();
        let n = self.int();
        let related = (0..n).map(|_| self.diag()).collect();
        Diagnostic {
            file: (file >= 0).then(|| FileId(file as u32)),
            start,
            length,
            category,
            code,
            text: Cow::Owned(text),
            chain,
            related,
        }
    }
}

fn hx(out: &mut String, bytes: &[u8]) {
    out.push('x');
    for b in bytes {
        write!(out, "{b:02x}").unwrap();
    }
}

fn ser_chain(out: &mut String, chain: &[MessageChain]) {
    out.push('[');
    for c in chain {
        hx(out, &c.text);
        ser_chain(out, &c.next);
    }
    out.push(']');
}

fn ser(out: &mut String, files: &[SourceFile], d: &Diagnostic) {
    out.push('(');
    match d.file {
        Some(id) => hx(out, files[id.0 as usize].file_name()),
        None => out.push('-'),
    }
    let (number, source) = match d.code {
        Code::Ts(number) => (number, ""),
        Code::Name(name) => (0, name),
    };
    let category = match d.category {
        Category::Warning => 0,
        Category::Error => 1,
        Category::Suggestion => 2,
        Category::Message => 3,
    };
    write!(out, ",{},{},{},{},", d.start, d.length, category, number).unwrap();
    hx(out, source.as_bytes());
    out.push(',');
    hx(out, &d.text);
    out.push(',');
    ser_chain(out, &d.chain);
    out.push('{');
    for r in &d.related {
        ser(out, files, r);
    }
    out.push_str("})");
}

fn sign(c: core::cmp::Ordering) -> i32 {
    c as i32
}

fn main() {
    let path = std::env::args().nth(1).expect("input");
    let data = String::from_utf8(std::fs::read(path).unwrap()).unwrap();
    let mut r = Reader {
        tokens: data.split_ascii_whitespace(),
    };
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::with_capacity(1 << 20, stdout.lock());
    let cases = r.int();
    for i in 0..cases {
        let nfiles = r.int();
        let files: Vec<SourceFile> = (0..nfiles)
            .map(|_| {
                SourceFile::new(
                    r.bytes().into_boxed_slice(),
                    bun_ast::Source {
                        contents: Vec::new(),
                    },
                )
            })
            .collect();
        let ndiags = r.int();
        let diags: Vec<Diagnostic> = (0..ndiags).map(|_| r.diag()).collect();
        writeln!(out, "CASE {i}").unwrap();
        for x in 0..diags.len() {
            for y in x + 1..diags.len() {
                writeln!(
                    out,
                    "P {} {} {} {}",
                    sign(compare_diagnostics(&files, &diags[x], &diags[y])),
                    sign(compare_diagnostics(&files, &diags[y], &diags[x])),
                    equal_diagnostics(&files, &diags[x], &diags[y]) as i32,
                    equal_diagnostics_no_related_info(&files, &diags[x], &diags[y]) as i32,
                )
                .unwrap();
            }
        }
        for d in program::sort_and_deduplicate_diagnostics(&files, diags) {
            let mut s = String::new();
            ser(&mut s, &files, &d);
            writeln!(out, "S {s}").unwrap();
        }
    }
}
