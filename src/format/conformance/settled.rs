//! Compares `bun_format::settled` with the formatter, for `test/cli/format/settled`. A directory of the bundle has files
//! to format and `options`, with a name, a tab and a value on each line.

use crate::{Bundle, Flags, output_line, write_file};
use bstr::BStr;
use bun_core::strings;
use bun_format::FormatOptions;
use bun_format::settled::Verdict;
use bun_format::tailwind::{Names, Orders, Oxc, Rank, Tailwind};
use std::sync::Arc;

pub struct Comparison {
    pub verdict: Verdict,
    /// What `bun fmt` prints. `None`: it rejects the text.
    pub printed: Option<Vec<u8>>,
    /// The same without `bun_format::settled`
    pub formatted: Option<Vec<u8>>,
}

pub type Compare<'f> = &'f mut dyn FnMut(&[u8], &[u8], &FormatOptions) -> Comparison;

/// Shorter classes come first. One without a `-` is unknown.
#[derive(Debug)]
struct ByLength;

impl Orders for ByLength {
    fn ranks_of(&self, classes: &[u8]) -> Option<Vec<Rank>> {
        let rank = |it: &[u8]| strings::contains_char(it, b'-').then_some(it.len() as u32);
        Some(strings::split(classes, b" ").map(rank).collect())
    }

    fn has_tailwind(&self) -> bool {
        true
    }
}

fn options_of(text: &[u8]) -> Option<FormatOptions> {
    let mut options = FormatOptions::default();
    let mut sort = bun_format::sort_imports::Settings::default();
    for line in strings::tokenize(text, b"\n") {
        match strings::split_once_char(line, b'\t')? {
            (b"tailwind", kind) => {
                options.tailwind = Some(Arc::new(Tailwind {
                    functions: Names::new(vec![b"cn".to_vec(), b"clsx".to_vec()]),
                    attributes: Names::default(),
                    preserves_whitespace: false,
                    preserves_duplicates: false,
                    follows_plugin: kind == b"plugin",
                    oxc: Oxc::Absent,
                    orders: Box::new(ByLength),
                    has_missed: Default::default(),
                }));
            }
            (name, value) if sort.set(name, value) => {}
            (name, value) => options.set(name, value).ok()?,
        }
    }
    options.sort_imports = sort.compile().ok()?;
    Some(options)
}

/// Prints a line for each file: the verdict, what the formatter does with the file, whether both come to the same
/// result, and the path. With `--report=file`, what the formatter prints is written there as a bundle.
pub fn run(bundle: &Bundle<'_>, flags: &Flags<'_>, compare: Compare<'_>) -> bool {
    let (mut directory, mut options, mut report) = (None, FormatOptions::default(), Vec::new());
    for path in bundle.paths() {
        let (Some((parent, name)), Some(text)) =
            (strings::rsplit_once_char(path, b'/'), bundle.read(path))
        else {
            return false;
        };
        if directory.replace(parent) != Some(parent) {
            let text = bundle.read(&[parent, b"/options"].concat());
            let Some(parsed) = text.and_then(options_of) else {
                output_line!("invalid options in {}", BStr::new(parent));
                return false;
            };
            options = parsed;
        }
        if name == b"options" {
            continue;
        }
        let it = compare(path, text, &options);
        let formatter = match &it.formatted {
            Some(formatted) if formatted == text => "keeps",
            Some(_) => "changes",
            None => "rejects",
        };
        let agreement = match it.printed == it.formatted {
            true => "agree",
            false => "DIFFER",
        };
        output_line!(
            "{:?} {formatter} {agreement} {}",
            it.verdict,
            BStr::new(path)
        );
        if let (Some(_), Some(formatted)) = (flags.report, &it.formatted) {
            let header = format!("=== /{} {}\n", BStr::new(path), formatted.len());
            report.extend_from_slice(&[header.as_bytes(), formatted, b"\n"].concat());
        }
    }
    if let Some(file) = flags.report {
        write_file(file, &report);
    }
    true
}
