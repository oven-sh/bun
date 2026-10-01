use std::borrow::Cow;

use bun_ast::Source;

use crate::diagnostic::{
    Category, Code, Diagnostic, FileId, MessageChain, SourceFile, compare_diagnostics,
};
use crate::diagnosticwriter::{FormattingOptions, write_format_diagnostics};
use crate::tspath::ComparePathsOptions;

fn unhex(s: &str) -> Vec<u8> {
    if s == "-" {
        return Vec::new();
    }
    let b = s.as_bytes();
    let v = |c: u8| match c {
        b'0'..=b'9' => c - b'0',
        _ => c - b'a' + 10,
    };
    b.chunks(2).map(|p| v(p[0]) * 16 + v(p[1])).collect()
}

fn leak(v: Vec<u8>) -> &'static [u8] {
    Box::leak(v.into_boxed_slice())
}

fn attach(chain: &mut Vec<MessageChain>, level: usize, text: Vec<u8>) {
    if level <= 1 {
        chain.push(MessageChain {
            text: Cow::Owned(text),
            next: Vec::new(),
        });
    } else if let Some(last) = chain.last_mut() {
        attach(&mut last.next, level - 1, text);
    }
}

#[test]
fn the_plain_writer_agrees_with_the_reference_on_the_fuzz_vectors() {
    let data = std::fs::read("/tmp/c2probe/vec/vectors.txt").expect("vectors");
    let data = core::str::from_utf8(&data).expect("ascii");
    let mut files: Vec<SourceFile> = Vec::new();
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    let mut name = String::new();
    let mut checked = 0usize;
    let mut failed: Vec<String> = Vec::new();
    for line in data.lines() {
        let mut parts = line.split(' ');
        match parts.next() {
            Some("V") => {
                files.clear();
                diagnostics.clear();
                name = parts.next().unwrap_or("").to_owned();
            }
            Some("F") => {
                let file_name = unhex(parts.next().expect("name"));
                let text = unhex(parts.next().expect("text"));
                files.push(SourceFile::new(
                    file_name.clone().into(),
                    Source::init_path_string(leak(file_name), leak(text)),
                ));
            }
            Some("D") => {
                let mut n = || parts.next().expect("field");
                let file: i64 = n().parse().expect("file");
                let start: u32 = n().parse().expect("pos");
                let length: u32 = n().parse().expect("len");
                let code: u32 = n().parse().expect("code");
                let category = match n() {
                    "0" => Category::Warning,
                    "1" => Category::Error,
                    "2" => Category::Suggestion,
                    _ => Category::Message,
                };
                let text = unhex(n());
                diagnostics.push(Diagnostic {
                    file: u32::try_from(file).ok().map(FileId),
                    start,
                    length,
                    category,
                    code: Code::Ts(code),
                    text: Cow::Owned(text),
                    chain: Vec::new(),
                    related: Vec::new(),
                });
            }
            Some("C") => {
                let level: usize = parts.next().expect("level").parse().expect("level");
                let text = unhex(parts.next().expect("text"));
                let last = diagnostics.last_mut().expect("diagnostic");
                attach(&mut last.chain, level, text);
            }
            Some("X") => {
                let expected = unhex(parts.next().expect("expected"));
                let mut sorted = diagnostics.clone();
                sorted.sort_by(|d1, d2| compare_diagnostics(&files, d1, d2));
                let mut out = Vec::new();
                write_format_diagnostics(
                    &mut out,
                    &files,
                    &sorted,
                    &FormattingOptions {
                        compare_paths_options: ComparePathsOptions {
                            use_case_sensitive_file_names: false,
                            current_directory: b"",
                        },
                        new_line: b"\r\n",
                    },
                );
                checked += 1;
                if out != expected {
                    failed.push(format!(
                        "{name}: got {:?} expected {:?}",
                        bstr::BStr::new(&out),
                        bstr::BStr::new(&expected)
                    ));
                }
            }
            _ => {}
        }
    }
    assert_eq!(failed.len(), 0, "{} of {checked}: {:#?}", failed.len(), &failed[..failed.len().min(5)]);
    assert_eq!(checked, 256);
}
