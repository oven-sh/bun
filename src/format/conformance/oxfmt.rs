//! The fixtures of oxc's formatter. Next to each input are `<input>.snap`, what oxfmt prints, and
//! `<input>.prettier.snap`, what Prettier prints, each for the same sets of options:
//!
//! ```text
//! ------------------
//! { printWidth: 80 }
//! ------------------
//! <the output>
//! ```

use crate::{Bundle, Count, Failure, Flags, Format, output_line, trim_bytes};
use bstr::BStr;
use bun_core::strings;
use bun_format::FormatOptions;

const OUTPUT: &[u8] = b"==================== Output ====================\n";
const SECOND_PASS: &[u8] = b"---------- Not idempotent (second pass) ----------";
const END: &[u8] = b"===================== End =====================\n";

/// The outputs in a snapshot, each with the line that says the options.
fn parse(text: &[u8]) -> Vec<(&[u8], Vec<u8>)> {
    let body = strings::last_index_of(text, OUTPUT).map_or(text, |at| &text[at + OUTPUT.len()..]);
    let body = body.strip_suffix(END).unwrap_or(body);
    let lines: Vec<&[u8]> = strings::split(body, b"\n").collect();
    let is_rule = |line: &[u8], len: usize| line.len() == len && !line.is_empty() && trim_bytes(line, b"-").is_empty();
    let is_header = |at: usize| {
        matches!(lines.get(at..at + 3), Some([above, options, below])
            if options.starts_with(b"{") && options.ends_with(b"}") && is_rule(above, options.len()) && is_rule(below, options.len()))
    };
    let headers: Vec<usize> = (0..lines.len()).filter(|&at| is_header(at)).collect();
    let outputs = headers.iter().enumerate().map(|(i, &at)| {
        // The line break at the end of the output is followed by one more.
        let end = headers.get(i + 1).map_or(lines.len() - 1, |&next| next);
        // What oxfmt makes of its own output, where that is something else, is not compared.
        let end = (at + 3..end).find(|&line| lines[line] == SECOND_PASS).unwrap_or(end);
        (lines[at + 1], lines[at + 3..end].join(&b"\n"[..]))
    });
    outputs.collect()
}

/// `{ printWidth: 80, semi: false }`. `None` if there is an option that is not one of Prettier's.
fn options_of(line: &[u8], flavor: &[u8]) -> Option<FormatOptions> {
    let mut options = FormatOptions::default();
    options.set(b"flavor", flavor).ok()?;
    for option in strings::split(trim_bytes(line, b"{} "), b", ") {
        let (name, value) = strings::split_once(option, b": ")?;
        // Prettier passes over an option that it does not know.
        if name.starts_with(b"jsdoc") && flavor == b"prettier" {
            continue;
        }
        // Which JSON it is.
        let name = if name == b"variant" { b"parser" } else { name };
        options.set(name, trim_bytes(value, b"\"")).ok()?;
    }
    Some(options)
}

/// Prints `FAIL <judge> <input> <options>` for each output that is not the expected one, and how
/// many are, as Prettier prints them and, in the flavor of oxfmt, as oxfmt prints them.
pub fn run(bundle: &Bundle<'_>, flags: &Flags<'_>, format: Format<'_>) {
    let (mut as_prettier, mut as_oxfmt, mut other_options) = (Count::default(), Count::default(), 0);
    for snapshot in bundle.paths().filter(|it| it.ends_with(b".prettier.snap")) {
        let name = &snapshot[..snapshot.len() - b".prettier.snap".len()];
        let (Some(input), true) = (bundle.read(name), flags.wants(name)) else {
            continue;
        };
        let judges = [
            (&b"prettier"[..], snapshot.to_vec(), &mut as_prettier),
            (b"oxfmt", [name, b".snap"].concat(), &mut as_oxfmt),
        ];
        for (flavor, snapshot, count) in judges {
            for (line, expected) in parse(bundle.read(&snapshot).unwrap_or_default()) {
                let Some(options) = options_of(line, flavor) else {
                    other_options += 1;
                    continue;
                };
                let actual = match format(name, input, &options) {
                    Ok((actual, _)) => actual,
                    Err(Failure::SyntaxError) => b"<SyntaxError>".to_vec(),
                    Err(Failure::Other) => b"<the formatter failed>".to_vec(),
                };
                // The library that writes oxfmt's snapshots makes `\n` of every `\r\n`.
                let actual = if flavor == b"oxfmt" { strings::replace_owned(&actual, b"\r\n", b"\n") } else { actual };
                count.add(actual == expected);
                if actual != expected {
                    output_line!("FAIL {} {} {}", BStr::new(flavor), BStr::new(name), BStr::new(line));
                    flags.write_report(&[flavor, b" ", name, b" ", line].concat(), &expected, &actual, input);
                }
            }
        }
    }
    output_line!("as Prettier prints them: {as_prettier}");
    output_line!("as oxfmt prints them, in its flavor: {as_oxfmt}");
    if other_options > 0 {
        output_line!("not run: {other_options}: an option that is not there");
    }
}
