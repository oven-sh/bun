//! `bun-lint jsdoc outline <files or directories..>`: where the JSDoc comments of the files are and what is in them, for
//! test/cli/lint/oracle/jsdoc/outline.py. With tabs between the columns and offsets in bytes:
//!
//! ```text
//! F  path
//! C  start  end
//! T  at  name_end  type.start  type.end  name.start  name.end  default.start  default.end  text  end  depth
//! O  the same columns
//! ```
//!
//! `T`: a tag of the comment by the rules of TypeScript. `O`: by those of oxc_jsdoc.

use crate::host::{self, output_line};
use bun_lint::language::LanguageOptions;
use bun_lint::tokens::TokenKind;
use bun_sema::check::jsdoc::{Flavor, Outline, Tag};
use std::io::Write as _;

fn write_tags(out: &mut dyn std::io::Write, letter: char, tags: &[Tag]) {
    for tag in tags {
        let (ty, name, default) = (tag.ty, tag.name, tag.default);
        let _ = writeln!(
            out,
            "{letter}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
            tag.at,
            tag.name_end,
            ty.start,
            ty.end,
            name.start,
            name.end,
            default.start,
            default.end,
            tag.text,
            tag.end,
            tag.depth
        );
    }
}

fn outline(args: &[String]) {
    let mut paths = Vec::new();
    for arg in args {
        crate::collect(std::path::Path::new(arg), &mut paths);
    }
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::new(stdout.lock());
    let language = LanguageOptions::default();
    let stack = bun_core::StackCheck::init();
    let is_stack_low = || !stack.is_safe_to_recurse();
    for path in &paths {
        let Ok(code) = host::read(path) else {
            continue;
        };
        let comments = crate::with_file(&path.to_string_lossy(), &code, &language, |file| {
            let blocks = file.comments().filter(|it| it.kind() == TokenKind::Block);
            blocks.map(|it| (it.start(), it.end())).collect::<Vec<_>>()
        });
        let typescript = Outline::read(&code, &comments, Flavor::TypeScript, &is_stack_low);
        let oxc = Outline::read(&code, &comments, Flavor::Oxc, &is_stack_low);
        let _ = out.write_all(b"F\t");
        let _ = out.write_all(path.as_os_str().as_encoded_bytes());
        let _ = out.write_all(b"\n");
        for (index, comment) in typescript.comments.iter().enumerate() {
            let _ = writeln!(out, "C\t{}\t{}", comment.start, comment.end);
            write_tags(&mut out, 'T', typescript.tags_of(index));
            write_tags(&mut out, 'O', oxc.tags_of(index));
        }
    }
}

pub(crate) fn run(args: &[String]) {
    match args.first().map(String::as_str) {
        Some("outline") => outline(&args[1..]),
        _ => output_line!("usage: bun-lint jsdoc outline <files or directories..>"),
    }
}
