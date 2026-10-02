//! The diagnostic of a lint run and its order: `internal/ast/diagnostic.go` of typescript-go.

use core::cmp::Ordering;
use core::fmt;
use std::borrow::Cow;
use std::sync::OnceLock;

use crate::scanner;

/// The index of a file in the list that the run keeps.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FileId(pub u32);

/// A file that diagnostics point into.
pub struct SourceFile {
    file_name: Box<[u8]>,
    source: bun_ast::Source,
    ecma_line_map: OnceLock<Vec<u32>>,
}

impl SourceFile {
    /// `file_name` is the absolute path with forward slashes, as `FileName()` of the reference.
    pub fn new(file_name: Box<[u8]>, source: bun_ast::Source) -> SourceFile {
        SourceFile {
            file_name,
            source,
            ecma_line_map: OnceLock::new(),
        }
    }

    pub fn file_name(&self) -> &[u8] {
        &self.file_name
    }

    pub fn source(&self) -> &bun_ast::Source {
        &self.source
    }

    pub fn text(&self) -> &[u8] {
        self.source.contents()
    }

    pub fn ecma_line_map(&self) -> &[u32] {
        self.ecma_line_map
            .get_or_init(|| scanner::compute_ecma_line_starts(self.text()))
    }
}

/// The variants are in the order of the reference, which the sort uses.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Category {
    Warning,
    Error,
    Suggestion,
    Message,
}

impl Category {
    pub fn name(self) -> &'static str {
        match self {
            Category::Warning => "warning",
            Category::Error => "error",
            Category::Suggestion => "suggestion",
            Category::Message => "message",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Code {
    /// The number of a TypeScript diagnostic, printed as `TS2322`.
    Ts(u32),
    /// The name of a rule, or a word of the command for what has no TypeScript number.
    Name(&'static str),
}

impl Code {
    /// An error or a warning of Bun's parser that has no TypeScript number.
    pub const SYNTAX: Code = Code::Name("syntax");
    pub const CANNOT_READ_FILE: Code = Code::Name("cannot-read-file");
    pub const UNSUPPORTED_EXTENSION: Code = Code::Name("unsupported-extension");
    /// Where the reference panics or asserts, and where a walk gives up.
    pub const INTERNAL_ERROR: Code = Code::Name("internal-error");
    /// A part of the checker that is not ported was reached.
    pub const INTERNAL_STAND_IN: Code = Code::Name("internal-stand-in");

    /// `Code()` of the reference: a name sorts as the number 0.
    fn number(self) -> u32 {
        match self {
            Code::Ts(number) => number,
            Code::Name(_) => 0,
        }
    }

    /// `Source()` of the reference: empty for a TypeScript number.
    fn source(self) -> &'static str {
        match self {
            Code::Ts(_) => "",
            Code::Name(name) => name,
        }
    }
}

impl fmt::Display for Code {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match *self {
            Code::Ts(number) => write!(f, "TS{number}"),
            Code::Name(name) => f.write_str(name),
        }
    }
}

/// A message below the text of a diagnostic; each level is printed two spaces deeper.
#[derive(Clone, Debug)]
pub struct MessageChain {
    pub text: Cow<'static, [u8]>,
    pub next: Vec<MessageChain>,
}

#[derive(Clone, Debug)]
pub struct Diagnostic {
    /// `None` for a diagnostic that belongs to no file.
    pub file: Option<FileId>,
    /// `start` and `length` count bytes of `SourceFile::text`.
    pub start: u32,
    pub length: u32,
    pub category: Category,
    pub code: Code,
    /// The message alone: the code and the chain are not part of it.
    pub text: Cow<'static, [u8]>,
    pub chain: Vec<MessageChain>,
    pub related: Vec<Diagnostic>,
}

impl Diagnostic {
    pub fn end(&self) -> u64 {
        u64::from(self.start) + u64::from(self.length)
    }

    /// A message of Bun's log in a file of the run; `None` for a kind that is no diagnostic.
    pub fn from_msg(file: FileId, msg: bun_ast::Msg) -> Option<Diagnostic> {
        let category = match msg.kind {
            bun_ast::Kind::Err => Category::Error,
            bun_ast::Kind::Warn => Category::Warning,
            bun_ast::Kind::Note => Category::Message,
            bun_ast::Kind::Debug | bun_ast::Kind::Verbose => return None,
        };
        let code = match msg.code() {
            Some(number) => Code::Ts(number),
            None => Code::SYNTAX,
        };
        let related = Vec::from(msg.notes)
            .into_iter()
            .map(|note| from_data(file, note, Category::Message, Code::SYNTAX))
            .collect();
        let mut diagnostic = from_data(file, msg.data, category, code);
        diagnostic.related = related;
        Some(diagnostic)
    }
}

fn from_data(file: FileId, data: bun_ast::Data, category: Category, code: Code) -> Diagnostic {
    let (file, start, length) = match &data.location {
        // A location without a line has no position: the diagnostic is at the start of the file.
        Some(location) if location.line > 0 => (
            Some(file),
            u32::try_from(location.offset).unwrap_or(u32::MAX),
            u32::try_from(location.length).unwrap_or(u32::MAX),
        ),
        Some(_) => (Some(file), 0, 0),
        None => (None, 0, 0),
    };
    Diagnostic {
        file,
        start,
        length,
        category,
        code,
        // A borrowed text of a `Msg` can point into its `Log` or its `Source`.
        text: Cow::Owned(data.text.into_owned()),
        chain: Vec::new(),
        related: Vec::new(),
    }
}

fn get_diagnostic_path<'a>(files: &'a [SourceFile], d: &Diagnostic) -> &'a [u8] {
    d.file
        .and_then(|id| files.get(id.0 as usize))
        .map_or(b"", SourceFile::file_name)
}

pub fn equal_diagnostics(files: &[SourceFile], d1: &Diagnostic, d2: &Diagnostic) -> bool {
    if !equal_diagnostics_no_related_info(files, d1, d2) {
        return false;
    }
    // A stack where the reference recurses: the nesting of related information has no bound.
    let mut stack = vec![(d1.related.as_slice(), d2.related.as_slice())];
    while let Some((r1, r2)) = stack.pop() {
        if r1.len() != r2.len() {
            return false;
        }
        for (e1, e2) in r1.iter().zip(r2) {
            if !equal_diagnostics_no_related_info(files, e1, e2) {
                return false;
            }
            stack.push((&e1.related, &e2.related));
        }
    }
    true
}

pub fn equal_diagnostics_no_related_info(
    files: &[SourceFile],
    d1: &Diagnostic,
    d2: &Diagnostic,
) -> bool {
    get_diagnostic_path(files, d1) == get_diagnostic_path(files, d2)
        && d1.start == d2.start
        && d1.length == d2.length
        && d1.code.number() == d2.code.number()
        && d1.category == d2.category
        && d1.code.source() == d2.code.source()
        && get_diagnostic_message_identity(d1) == get_diagnostic_message_identity(d2)
        && equal_message_chain(&d1.chain, &d2.chain)
}

/// The text stands for the message and its arguments, which the reference compares apart.
fn get_diagnostic_message_identity(d: &Diagnostic) -> &[u8] {
    &d.text
}

fn equal_message_chain(c1: &[MessageChain], c2: &[MessageChain]) -> bool {
    let mut stack = vec![(c1, c2)];
    while let Some((c1, c2)) = stack.pop() {
        if c1.len() != c2.len() {
            return false;
        }
        for (n1, n2) in c1.iter().zip(c2) {
            if n1.text != n2.text {
                return false;
            }
            stack.push((&n1.next, &n2.next));
        }
    }
    true
}

/// More chains sort first, as in the reference.
fn compare_message_chain_size(c1: &[MessageChain], c2: &[MessageChain]) -> Ordering {
    let mut stack = vec![(c1, c2)];
    while let Some((c1, c2)) = stack.pop() {
        let c = c2.len().cmp(&c1.len());
        if c != Ordering::Equal {
            return c;
        }
        for (n1, n2) in c1.iter().zip(c2).rev() {
            stack.push((&n1.next, &n2.next));
        }
    }
    Ordering::Equal
}

/// For chains of one shape; the reference compares the arguments where this compares the text.
fn compare_message_chain_content(c1: &[MessageChain], c2: &[MessageChain]) -> Ordering {
    let mut stack = vec![c1.iter().zip(c2)];
    while let Some(level) = stack.last_mut() {
        let Some((n1, n2)) = level.next() else {
            stack.pop();
            continue;
        };
        let c = n1.text.as_ref().cmp(n2.text.as_ref());
        if c != Ordering::Equal {
            return c;
        }
        stack.push(n1.next.iter().zip(&n2.next));
    }
    Ordering::Equal
}

/// More related information sorts first, as in the reference.
fn compare_related_info(files: &[SourceFile], r1: &[Diagnostic], r2: &[Diagnostic]) -> Ordering {
    let c = r2.len().cmp(&r1.len());
    if c != Ordering::Equal {
        return c;
    }
    let mut stack = vec![r1.iter().zip(r2)];
    while let Some(level) = stack.last_mut() {
        let Some((d1, d2)) = level.next() else {
            stack.pop();
            continue;
        };
        let c = compare_diagnostics_no_related_info(files, d1, d2)
            .then_with(|| d2.related.len().cmp(&d1.related.len()));
        if c != Ordering::Equal {
            return c;
        }
        stack.push(d1.related.iter().zip(&d2.related));
    }
    Ordering::Equal
}

/// `CompareDiagnostics` of the reference up to the related information.
fn compare_diagnostics_no_related_info(
    files: &[SourceFile],
    d1: &Diagnostic,
    d2: &Diagnostic,
) -> Ordering {
    get_diagnostic_path(files, d1)
        .cmp(get_diagnostic_path(files, d2))
        .then_with(|| d1.start.cmp(&d2.start))
        .then_with(|| d1.end().cmp(&d2.end()))
        .then_with(|| d1.code.number().cmp(&d2.code.number()))
        .then_with(|| d1.category.cmp(&d2.category))
        .then_with(|| d1.code.source().cmp(d2.code.source()))
        .then_with(|| get_diagnostic_message_identity(d1).cmp(get_diagnostic_message_identity(d2)))
        .then_with(|| compare_message_chain_size(&d1.chain, &d2.chain))
        .then_with(|| compare_message_chain_content(&d1.chain, &d2.chain))
}

pub fn compare_diagnostics(files: &[SourceFile], d1: &Diagnostic, d2: &Diagnostic) -> Ordering {
    compare_diagnostics_no_related_info(files, d1, d2)
        .then_with(|| compare_related_info(files, &d1.related, &d2.related))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn diagnostic(text: &'static str, related: Vec<Diagnostic>) -> Diagnostic {
        Diagnostic {
            file: None,
            start: 0,
            length: 0,
            category: Category::Message,
            code: Code::Ts(2728),
            text: Cow::Borrowed(text.as_bytes()),
            chain: Vec::new(),
            related,
        }
    }

    #[test]
    fn related_information_is_compared_at_every_depth() {
        let leaf = |text| diagnostic(text, Vec::new());
        let a = diagnostic("d", vec![diagnostic("r", vec![leaf("x")])]);
        let b = diagnostic("d", vec![diagnostic("r", vec![leaf("y")])]);
        let more = diagnostic("d", vec![diagnostic("r", vec![leaf("x"), leaf("y")])]);
        assert!(equal_diagnostics(&[], &a, &a.clone()));
        assert!(!equal_diagnostics(&[], &a, &b));
        assert!(equal_diagnostics_no_related_info(&[], &a, &b));
        assert_eq!(compare_diagnostics(&[], &a, &a.clone()), Ordering::Equal);
        assert_eq!(compare_diagnostics(&[], &a, &b), Ordering::Less);
        assert_eq!(compare_diagnostics(&[], &b, &a), Ordering::Greater);
        assert_eq!(compare_diagnostics(&[], &more, &a), Ordering::Less);
    }
}
