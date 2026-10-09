//! As long as there are two parsers of JSON. `bun-lint format readers --options=<name> <files>`: whether
//! the parser with the index and the one that reads in one pass say the same about every file: the
//! same rows with the same places, the same error, the same messages at the same places.
//!
//! `--measure=index|one-pass|none [--iterations=n]`: reads every file that often and drops the rows.

use super::Args;
use crate::host::{self, output_line};
use bun_lint::json::comparison::{describe, read_and_drop};

pub(super) fn run(args: &Args) {
    let options = args.flag("options").unwrap_or("jsonc");
    let texts: Vec<Vec<u8>> = (args.positional.iter())
        .map(|path| host::read(path).expect("the file"))
        .collect();
    if let Some(reader) = args.flag("measure") {
        let iterations = args
            .flag("iterations")
            .and_then(|it| it.parse::<usize>().ok());
        let mut taken = 0usize;
        for _ in 0..iterations.unwrap_or(1) {
            for text in &texts {
                taken += usize::from(match reader {
                    "none" => text.is_empty(),
                    _ => read_and_drop(options, reader == "one-pass", text),
                });
            }
        }
        output_line!("{options} {reader}: {} files, {taken} taken", texts.len());
        return;
    }
    let (mut same, mut different) = (0usize, 0usize);
    for (path, text) in args.positional.iter().zip(&texts) {
        let (expected, actual) = (
            describe(options, false, text),
            describe(options, true, text),
        );
        if expected == actual {
            same += 1;
            continue;
        }
        different += 1;
        let at = (expected.iter().zip(&actual))
            .take_while(|(a, b)| a == b)
            .count();
        let from = at.saturating_sub(60);
        let part = |text: &[u8]| host::text(&text[from..text.len().min(at + 100)]);
        output_line!(
            "different: {path}\n  index    ..{}\n  one pass ..{}",
            part(&expected),
            part(&actual)
        );
    }
    output_line!("{options}: same {same}, different {different}");
}
