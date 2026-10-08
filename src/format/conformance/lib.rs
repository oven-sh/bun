//! Runs the tests of Prettier and of oxfmt on `bun format`. The tests are in
//! `test/cli/format/{prettier,oxfmt}/bundle.zst`.
//!
//! It is compiled into debug and canary builds of Bun (`bun format --run-prettier-tests`,
//! `--run-oxfmt-tests`, for `test/cli/format/conformance.test.ts`) and into `bun-lint`.

#![forbid(unsafe_code)]

mod oxfmt;
mod prettier;

use bun_core::strings;
use bun_format::FormatOptions;
use std::collections::BTreeMap;

pub use oxfmt::run as run_oxfmt_tests;
pub use prettier::run as run_prettier_tests;

/// `println!`, which nothing in Bun uses.
#[macro_export]
macro_rules! output_line {
    ($($arguments:tt)*) => {
        $crate::write_line(format_args!($($arguments)*))
    };
}

pub fn write_line(line: std::fmt::Arguments<'_>) {
    let _ =
        bun_sys::File::from_fd(bun_core::Fd::stdout()).write_all(format!("{line}\n").as_bytes());
}

pub fn read_file(path: &[u8]) -> Option<Vec<u8>> {
    bun_sys::File::read_from(bun_core::Fd::cwd(), path).ok()
}

/// Its directory is created if there is none. It is only written to be looked at.
fn write_file(path: &[u8], contents: &[u8]) {
    if let Some(end) = strings::last_index_of_char(path, b'/').filter(|&end| end > 0) {
        let _ = bun_sys::mkdir_recursive(&path[..end]);
    }
    let _ = bun_sys::File::write_file(
        bun_core::Fd::cwd(),
        &bun_core::ZBox::from_bytes(path),
        contents,
    );
}

/// Many small files in one, as `test/cli/format/bundle.ts` writes it, decompressed. One file after
/// the other: `=== /<path> <length in bytes>\n`, the bytes, `\n`.
#[derive(Default)]
pub struct Bundle<'a> {
    files: BTreeMap<&'a [u8], &'a [u8]>,
}

impl<'a> Bundle<'a> {
    /// `None` if `bytes` is malformed.
    pub fn parse(bytes: &'a [u8]) -> Option<Bundle<'a>> {
        let mut bundle = Bundle::default();
        let mut rest = bytes;
        while !rest.is_empty() {
            let (header, after) = strings::split_once_char(rest.strip_prefix(b"=== /")?, b'\n')?;
            let (path, length) = strings::rsplit_once_char(header, b' ')?;
            let length: usize = std::str::from_utf8(length).ok()?.parse().ok()?;
            bundle.insert(path, after.get(..length)?);
            rest = after.get(length..)?.strip_prefix(b"\n")?;
        }
        Some(bundle)
    }

    pub fn insert(&mut self, path: &'a [u8], contents: &'a [u8]) {
        self.files.insert(path, contents);
    }

    pub fn read(&self, path: &[u8]) -> Option<&'a [u8]> {
        self.files.get(path).copied()
    }

    /// In the order of the bytes of the paths.
    pub fn paths(&self) -> impl Iterator<Item = &'a [u8]> + '_ {
        self.files.keys().copied()
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Failure {
    SyntaxError,
    /// A bug.
    Other,
}

/// Formats the text as the file at the path. With the text comes where the cursor ends up, in
/// UTF-16 code units.
pub type Format<'f> =
    &'f dyn Fn(&[u8], &[u8], &FormatOptions) -> Result<(Vec<u8>, Option<u32>), Failure>;

/// What is on the command line after the path of the bundle.
#[derive(Default)]
pub struct Flags<'a> {
    /// `--filter=text`: only the cases whose path contains the text.
    pub filter: Option<&'a [u8]>,
    /// `--languages=js,jsx`: only these directories of Prettier's tests.
    pub languages: Option<&'a [u8]>,
    /// `--report=directory`: the expected and the actual output of each failure are written there.
    pub report: Option<&'a [u8]>,
    /// `--table`: the numbers of each directory.
    pub table: bool,
    /// `--every=n --first=i`: every n-th case, from the i-th.
    pub every: usize,
    pub first: usize,
}

impl<'a> Flags<'a> {
    pub fn parse(args: &[&'a [u8]]) -> Flags<'a> {
        let flag = |name: &[u8]| {
            args.iter().find_map(|it| {
                it.strip_prefix(b"--")?
                    .strip_prefix(name)?
                    .strip_prefix(b"=")
            })
        };
        let number =
            |name: &[u8]| flag(name).and_then(|it| std::str::from_utf8(it).ok()?.parse().ok());
        Flags {
            filter: flag(b"filter"),
            languages: flag(b"languages"),
            report: flag(b"report"),
            table: args.contains(&&b"--table"[..]),
            every: number(b"every").unwrap_or(1).max(1),
            first: number(b"first").unwrap_or(0),
        }
    }

    fn wants(&self, id: &[u8]) -> bool {
        self.filter.is_none_or(|it| strings::contains(id, it))
    }

    /// `name`: of the case, with its options.
    fn write_report(&self, name: &[u8], expected: &[u8], actual: &[u8], input: &[u8]) {
        let Some(directory) = self.report else {
            return;
        };
        let name: Vec<u8> = name
            .iter()
            .map(|&byte| {
                if b"/ :#=\"{},".contains(&byte) {
                    b'_'
                } else {
                    byte
                }
            })
            .collect();
        for (kind, contents) in [
            (&b"expected"[..], expected),
            (b"actual", actual),
            (b"input", input),
        ] {
            write_file(&[directory, b"/", &name, b".", kind].concat(), contents);
        }
    }
}

/// `--run-prettier-tests <bundle> ..` or `--run-oxfmt-tests <bundle> ..`: `args` is what follows.
/// Returns whether the tests could be run. The caller of the command compares what is printed.
pub fn run_from_command_line(
    args: &[&[u8]],
    run: fn(&Bundle<'_>, &Flags<'_>, Format<'_>),
    format: Format<'_>,
) -> bool {
    let Some(bytes) = args.first().and_then(|path| read_file(path)) else {
        output_line!("cannot read the bundle");
        return false;
    };
    let Some(bundle) = Bundle::parse(&bytes) else {
        output_line!("the bundle is malformed");
        return false;
    };
    run(&bundle, &Flags::parse(args), format);
    true
}

#[derive(Default, Clone, Copy)]
struct Count {
    passed: usize,
    total: usize,
}

impl Count {
    fn add(&mut self, passed: bool) {
        self.passed += usize::from(passed);
        self.total += 1;
    }

    fn merge(&mut self, other: Count) {
        self.passed += other.passed;
        self.total += other.total;
    }
}

impl std::fmt::Display for Count {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}/{}", self.passed, self.total)
    }
}

/// The number of UTF-16 code units of `text`, which is UTF-8.
fn utf16_len(text: &[u8]) -> usize {
    text.iter()
        .map(|&byte| usize::from(byte & 0xC0 != 0x80) + usize::from(byte >= 0xF0))
        .sum()
}

/// Puts `<|>` where the cursor is, the way Prettier's snapshots show it.
fn show_cursor(text: &mut Vec<u8>, cursor: Option<u32>) {
    let Some(cursor) = cursor else {
        return;
    };
    let mut units = 0;
    let at = (0..text.len()).find(|&at| {
        let is_start = text[at] & 0xC0 != 0x80;
        let is_there = is_start && units >= cursor as usize;
        units += usize::from(is_start) + usize::from(text[at] >= 0xF0);
        is_there
    });
    let at = at.unwrap_or(text.len());
    text.splice(at..at, *b"<|>");
}

fn trim_bytes<'a>(mut text: &'a [u8], what: &[u8]) -> &'a [u8] {
    while let [first, rest @ ..] = text
        && what.contains(first)
    {
        text = rest;
    }
    while let [rest @ .., last] = text
        && what.contains(last)
    {
        text = rest;
    }
    text
}
