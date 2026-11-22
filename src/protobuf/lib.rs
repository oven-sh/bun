//! The `proto` loader: compiles a Protocol Buffers schema to the text of a TypeScript module.

mod emit;
mod lexer;
mod parser;
mod program;
mod schema;

use bun_ast::{Loc, Log, Range, Source};

#[derive(Clone, Copy, Default)]
pub(crate) struct Span {
    pub(crate) start: usize,
    pub(crate) len: usize,
}

pub(crate) struct Failure {
    span: Span,
    message: String,
}

impl Failure {
    pub(crate) fn new(span: Span, message: impl Into<String>) -> Failure {
        Failure {
            span,
            message: message.into(),
        }
    }
}

/// A mistake in the schema, or in a schema that it imports.
pub struct Error {
    pub message: String,
    pub start: usize,
    pub len: usize,
    /// The path and the text that `start` is an offset in, unless it is the schema that was compiled.
    pub imported_file: Option<(Vec<u8>, Vec<u8>)>,
}

impl Error {
    fn add_to(&self, log: &mut Log, path: &[u8], text: &[u8]) {
        let source = match &self.imported_file {
            Some((path, text)) => Source::init_path_string(path, text),
            None => Source::init_path_string(path, text),
        };
        let range = match (i32::try_from(self.start), i32::try_from(self.len)) {
            (Ok(start), Ok(len)) => Range {
                loc: Loc { start },
                len,
            },
            _ => Range::default(),
        };
        log.add_range_error_fmt(Some(&source), range, format_args!("{}", self.message));
    }
}

/// Whether the module can import `bun:grpc` for the clients and the routes of its services.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Target {
    Bun,
    Other,
}

impl From<bun_ast::Target> for Target {
    fn from(target: bun_ast::Target) -> Target {
        match target.is_bun() {
            true => Target::Bun,
            false => Target::Other,
        }
    }
}

/// The paths are native paths.
pub struct Options<'a> {
    pub target: Target,
    pub read: &'a dyn Fn(&[u8]) -> Option<Vec<u8>>,
    /// Whether an import of this file without a `type` attribute gets the `proto` loader.
    pub is_schema_by_name: &'a dyn Fn(&[u8]) -> bool,
}

pub fn compile(path: &[u8], text: &[u8], options: &Options<'_>) -> Result<Vec<u8>, Error> {
    let files = program::load(path, text, options.read)?;
    let program = program::Program::new(&files)?;
    emit::emit(&program, options).map(String::into_bytes)
}

pub fn compile_or_log(
    path: &[u8],
    text: &[u8],
    options: &Options<'_>,
    log: &mut Log,
) -> Option<Vec<u8>> {
    let module = compile(path, text, options);
    module.map_err(|error| error.add_to(log, path, text)).ok()
}

pub fn read_from_disk(path: &[u8]) -> Option<Vec<u8>> {
    bun_sys::File::read_from(bun_sys::Fd::cwd(), path).ok()
}
