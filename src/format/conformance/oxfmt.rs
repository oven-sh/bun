//! Fixtures of oxc's formatter. Each input has two snapshots next to it: `<input>.snap` (oxfmt's output) and
//! `<input>.prettier.snap` (Prettier's output). Both list one output per set of options:
//!
//! ```text
//! ------------------
//! { printWidth: 80 }
//! ------------------
//! <the output>
//! ```

use crate::{Bundle, Count, Failure, Flags, Format, output_line};
use bstr::BStr;
use bun_core::strings;
use bun_format::FormatOptions;

const OUTPUT: &[u8] = b"==================== Output ====================\n";
const SECOND_PASS: &[u8] = b"---------- Not idempotent (second pass) ----------";
const END: &[u8] = b"===================== End =====================\n";

/// Returns each output in a snapshot, paired with its options line.
fn parse(text: &[u8]) -> Vec<(&[u8], Vec<u8>)> {
    let body = strings::last_index_of(text, OUTPUT).map_or(text, |at| &text[at + OUTPUT.len()..]);
    let body = body.strip_suffix(END).unwrap_or(body);
    let lines: Vec<&[u8]> = strings::split(body, b"\n").collect();
    let is_rule = |line: &[u8], len: usize| {
        line.len() == len && !line.is_empty() && strings::trim(line, b"-").is_empty()
    };
    let is_header = |at: usize| {
        matches!(lines.get(at..at + 3), Some([above, options, below])
            if options.starts_with(b"{") && options.ends_with(b"}") && is_rule(above, options.len()) && is_rule(below, options.len()))
    };
    let headers: Vec<usize> = (0..lines.len()).filter(|&at| is_header(at)).collect();
    let outputs = headers.iter().enumerate().map(|(i, &at)| {
        // Each output's final line break is followed by one more.
        let end = headers.get(i + 1).map_or(lines.len() - 1, |&next| next);
        // When oxfmt isn't idempotent, the snapshot also has its second pass. That part isn't compared.
        let end = (at + 3..end)
            .find(|&line| lines[line] == SECOND_PASS)
            .unwrap_or(end);
        (lines[at + 1], lines[at + 3..end].join(&b"\n"[..]))
    });
    outputs.collect()
}

/// Parses `{ printWidth: 80, semi: false }`. Returns `None` if an option isn't one of Prettier's.
fn options_of(line: &[u8], flavor: &[u8]) -> Option<FormatOptions> {
    // `bun fmt` doesn't format HTML in templates and code blocks by default yet, but these tests expect it.
    let mut options = FormatOptions {
        embedded_html: true,
        ..FormatOptions::default()
    };
    options.set(b"flavor", flavor).ok()?;
    for option in strings::split(strings::trim(line, b"{} "), b", ") {
        let (name, value) = strings::split_once(option, b": ")?;
        // Prettier ignores unknown options.
        if name.starts_with(b"jsdoc") && flavor == b"prettier" {
            continue;
        }
        // `variant` selects the JSON dialect.
        let name = if name == b"variant" { b"parser" } else { name };
        options.set(name, strings::trim(value, b"\"")).ok()?;
    }
    Some(options)
}

/// Prints `FAIL <judge> <input> <options>` for each unexpected output, then the pass counts against Prettier's
/// snapshots and, with the oxfmt flavor, against oxfmt's.
pub fn run(bundle: &Bundle<'_>, flags: &Flags<'_>, format: Format<'_>) {
    let (mut as_prettier, mut as_oxfmt, mut other_options) =
        (Count::default(), Count::default(), 0);
    let snapshots = bundle.paths().filter(|it| it.ends_with(b".prettier.snap"));
    for snapshot in snapshots
        .skip(flags.first % flags.every)
        .step_by(flags.every)
    {
        let name = &snapshot[..snapshot.len() - b".prettier.snap".len()];
        let (Some(input), true) = (bundle.read(name), flags.matches_filter(name)) else {
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
                // The library that writes oxfmt's snapshots turns every `\r\n` into `\n`.
                let actual = if flavor == b"oxfmt" {
                    strings::replace_owned(&actual, b"\r\n", b"\n")
                } else {
                    actual
                };
                count.add(actual == expected);
                if actual != expected {
                    output_line!(
                        "FAIL {} {} {}",
                        BStr::new(flavor),
                        BStr::new(name),
                        BStr::new(line)
                    );
                    flags.write_report(
                        &[flavor, b" ", name, b" ", line].concat(),
                        &expected,
                        &actual,
                        input,
                    );
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
