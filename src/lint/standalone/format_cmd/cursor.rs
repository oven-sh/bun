//! `bun-lint format cursor <path> [--step=n] [--only=region]`: for every n-th offset of the file,
//! which has to be ASCII, the part of the text that the cursor is in there, and where the cursor is
//! afterwards.
//!
//! ```text
//! <offset> node <start> <end> -> <new offset>
//! <offset> between <start>-<end> <start>-<end> -> <new offset>
//! ```
//!
//! `-` for the start or the end of the text.

use super::Args;
use bun_format::Scratch;
use bun_format::cursor::{Region, format_with_cursor, locate};
use bun_lint::language::LanguageOptions;
use bun_lint::span::Span;

pub(super) fn run(args: &Args) {
    let Some(path) = args.positional.first() else {
        return eprintln!("usage: bun-lint format cursor <path> [--step=n] [--only=region]");
    };
    let Ok(code) = std::fs::read(path) else {
        return eprintln!("cannot read {path}");
    };
    let step: usize = args
        .flag("step")
        .and_then(|it| it.parse().ok())
        .unwrap_or(1)
        .max(1);
    let only_region = args.flag("only") == Some("region");
    let show =
        |span: Option<Span>| span.map_or("-".to_owned(), |it| format!("{}-{}", it.start, it.end));

    crate::with_file(path, &code, &LanguageOptions::default(), |file| {
        let (mut scratch, mut out, mut options) =
            (Scratch::default(), Vec::new(), args.options.clone());
        for offset in (0..=code.len()).step_by(step) {
            let region = match locate(file, offset as u32) {
                Region::Node(span) => format!("node {} {}", span.start, span.end),
                Region::Between { before, after } => {
                    format!("between {} {}", show(before), show(after))
                }
            };
            if only_region {
                println!("{offset} {region}");
                continue;
            }
            out.clear();
            options.cursor_offset = Some(offset as u32);
            match format_with_cursor(file, &options, &mut scratch, &mut out) {
                Ok(Some(new_offset)) => println!("{offset} {region} -> {new_offset}"),
                Ok(None) => println!("{offset} {region} -> -1"),
                Err(error) => return println!("{error:?}"),
            }
        }
    });
}
