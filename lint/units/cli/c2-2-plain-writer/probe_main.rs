// Probe driver: the real sources of src/lint (scanner, tspath, diagnosticwriter) against a stand-in of crate::diagnostic.
#![allow(dead_code)]
use std::io::{BufRead, Write};

#[path = "gen/scanner.rs"]
pub mod scanner;
#[path = "gen/tspath.rs"]
pub mod tspath;
#[path = "gen/diagnosticwriter.rs"]
pub mod diagnosticwriter;

#[path = "standin_diagnostic.rs"]
pub mod diagnostic;

use diagnostic::{Category, Code, Diagnostic, FileId, MessageChain, SourceFile};
use diagnosticwriter::{FormattingOptions, write_format_diagnostics};
use tspath::ComparePathsOptions;

fn unhex(s: &str) -> Vec<u8> {
    if s == "-" {
        return Vec::new();
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn enhex(b: &[u8]) -> String {
    if b.is_empty() {
        return "-".to_string();
    }
    b.iter().map(|b| format!("{b:02x}")).collect()
}

// The chain from its preorder list of (level, text).
fn build_chain(items: &[(usize, Vec<u8>)]) -> Vec<MessageChain> {
    fn rec(items: &[(usize, Vec<u8>)], i: &mut usize, level: usize) -> Vec<MessageChain> {
        let mut out = Vec::new();
        while *i < items.len() && items[*i].0 == level {
            let text = items[*i].1.clone();
            *i += 1;
            let next = rec(items, i, level + 1);
            out.push(MessageChain { text: text.into(), next });
        }
        out
    }
    let mut i = 0;
    let out = rec(items, &mut i, 1);
    assert_eq!(i, items.len());
    out
}

fn main() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::with_capacity(1 << 20, stdout.lock());
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let f: Vec<&str> = line.split_ascii_whitespace().collect();
        if f.is_empty() {
            continue;
        }
        match f[0] {
            "R" => {
                let p = unhex(f[1]);
                let root = tspath::get_root_length(&p);
                let rooted = tspath::is_rooted_disk_path(&p);
                writeln!(out, "R {} {} {}", root, tspath::probe_encoded_root_length(&p), rooted).unwrap();
            }
            "N" => {
                let r = tspath::get_normalized_absolute_path(&unhex(f[1]), &unhex(f[2]));
                writeln!(out, "N {}", enhex(&r)).unwrap();
            }
            "C" => {
                let cwd = unhex(f[2]);
                let opts = ComparePathsOptions { use_case_sensitive_file_names: f[3] == "1", current_directory: &cwd };
                let r = tspath::convert_to_relative_path(&unhex(f[1]), opts);
                writeln!(out, "C {}", enhex(&r)).unwrap();
            }
            "F" => {
                writeln!(out, "F {}", tspath::probe_equate_string_case_insensitive(&unhex(f[1]), &unhex(f[2]))).unwrap();
            }
            "U" => {
                writeln!(out, "U {}", scanner::utf16_len(&unhex(f[1]))).unwrap();
            }
            "L" => {
                let text = unhex(f[1]);
                let starts = scanner::compute_ecma_line_starts(&text);
                write!(out, "L").unwrap();
                for s in &starts {
                    write!(out, " {s}").unwrap();
                }
                write!(out, " |").unwrap();
                for pos in 0..=text.len() {
                    let (l, c) = scanner::get_ecma_line_and_utf16_character_of_position(&text, &starts, pos as u32);
                    write!(out, " {l}:{c}").unwrap();
                }
                writeln!(out).unwrap();
            }
            "W" => {
                let mut i = 1;
                let mut next = || {
                    let s = f[i];
                    i += 1;
                    s
                };
                let new_line = unhex(next());
                let cwd = unhex(next());
                let cs = next() == "1";
                let nfiles: usize = next().parse().unwrap();
                let mut files = Vec::new();
                for _ in 0..nfiles {
                    let name = unhex(next());
                    let text = unhex(next());
                    files.push(SourceFile::new(name.into(), text));
                }
                let ndiags: usize = next().parse().unwrap();
                let mut diags = Vec::new();
                for _ in 0..ndiags {
                    let fi: i64 = next().parse().unwrap();
                    let pos: u32 = next().parse().unwrap();
                    let category = match next() {
                        "0" => Category::Warning,
                        "1" => Category::Error,
                        "2" => Category::Suggestion,
                        _ => Category::Message,
                    };
                    let code: u32 = next().parse().unwrap();
                    let text = unhex(next());
                    let nchain: usize = next().parse().unwrap();
                    let mut items = Vec::new();
                    for _ in 0..nchain {
                        let level: usize = next().parse().unwrap();
                        items.push((level, unhex(next())));
                    }
                    diags.push(Diagnostic {
                        file: if fi >= 0 { Some(FileId(fi as u32)) } else { None },
                        start: pos,
                        length: 0,
                        category,
                        code: Code::Ts(code),
                        text: text.into(),
                        chain: build_chain(&items),
                        related: Vec::new(),
                    });
                }
                let opts = FormattingOptions {
                    compare_paths_options: ComparePathsOptions { use_case_sensitive_file_names: cs, current_directory: &cwd },
                    new_line: &new_line,
                };
                let mut o = Vec::new();
                write_format_diagnostics(&mut o, &files, &diags, &opts);
                writeln!(out, "W {}", enhex(&o)).unwrap();
            }
            "K" => {
                // Every code point with its fold key.
                for r in 0..=0x10FFFFu32 {
                    if let Some(ch) = char::from_u32(r) {
                        writeln!(out, "{:X} {:X}", r, tspath::probe_simple_fold_key(ch)).unwrap();
                    }
                }
            }
            other => panic!("unknown vector {other}"),
        }
    }
}
