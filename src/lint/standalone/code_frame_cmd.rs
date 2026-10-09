//! `bun-lint code-frame <file>`: for each line of `<file>` a line with the frame of `bun_lint::utils::code_frame` in hexadecimal,
//! or `throws`. The fields of a line, separated by tabs, `-` for none: the version, the line and the column of the start, those
//! of the end, the lines above, the lines below, the first line whose rows are wanted and the one after the last, the message
//! and the text in hexadecimal. `test/cli/lint/oracle/code-frame/compare.ts` writes the file and compares.

use crate::host::{self, error_line, output};
use bun_core::fmt::{hex_digit_value, hex_lower};
use bun_lint::utils::code_frame::{self, Frame, Place, Version};
use bun_lint::utils::text;
use std::fmt::Write as _;

fn unhex(text: &str) -> Vec<u8> {
    let digit = |c: u8| hex_digit_value(c).unwrap_or(0);
    let pairs = text.as_bytes().as_chunks::<2>().0;
    pairs
        .iter()
        .map(|pair| digit(pair[0]) << 4 | digit(pair[1]))
        .collect()
}

pub(crate) fn run(args: &[String]) {
    let Some(input) = args.first().and_then(|path| host::read(path).ok()) else {
        error_line!("usage: bun-lint code-frame <file>");
        std::process::exit(2);
    };
    let mut out = String::new();
    for line in host::lines(&host::text(&input)) {
        let fields: Vec<&str> = host::split(line, "\t").collect();
        let field = |at: usize| fields.get(at).copied().unwrap_or_default();
        let number = |at: usize| field(at).parse::<u32>().ok();
        let (message, source) = (unhex(field(9)), unhex(field(10)));
        let frame = Frame {
            version: match field(0) {
                "7" => Version::Seven,
                _ => Version::Eight,
            },
            start: Place {
                line: number(1).unwrap_or(0),
                column: number(2),
            },
            end: number(3).map(|line| Place {
                line,
                column: number(4),
            }),
            message: &message,
            lines_above: number(5).unwrap_or(0),
            lines_below: number(6).unwrap_or(0),
        };
        let lines: Vec<&[u8]> = text::lines(&source).collect();
        let mut printed = Vec::new();
        let is_printed = match (number(7), number(8)) {
            (Some(from), Some(to)) => {
                code_frame::write_rows_of(&mut printed, &lines[..], &frame, &(from..to))
            }
            _ => code_frame::write(&mut printed, &lines[..], &frame),
        };
        match is_printed {
            true => _ = writeln!(out, "{}", hex_lower(&printed)),
            false => out.push_str("throws\n"),
        }
    }
    output!("{out}");
}
