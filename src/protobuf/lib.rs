//! The `proto` loader: compiles a Protocol Buffers schema to the text of a TypeScript module.

mod emit;
mod error;
mod lexer;
mod parser;
mod program;
mod schema;

use bun_ast::Log;

pub use error::{Error, Result};

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

/// `None` if there is no such file, `Err` with the reason if there is one that cannot be read.
pub type Read = Result<Option<Vec<u8>>, &'static [u8]>;

/// The paths are native paths.
pub struct Options<'a> {
    pub target: Target,
    pub read: &'a dyn Fn(&[u8]) -> Read,
    /// Whether an import of this file without a `type` attribute gets the `proto` loader.
    pub is_schema_by_name: &'a dyn Fn(&[u8]) -> bool,
}

pub fn compile(path: &[u8], schema: &[u8], options: &Options<'_>) -> Result<Vec<u8>> {
    let files = program::load(path, schema, options.read)?;
    let program = program::Program::new(&files)?;
    emit::emit(&program, options).map(String::into_bytes)
}

pub fn compile_or_log(
    path: &[u8],
    schema: &[u8],
    options: &Options<'_>,
    log: &mut Log,
) -> Option<Vec<u8>> {
    let module = compile(path, schema, options);
    module.map_err(|error| error.add_to(log, path, schema)).ok()
}

pub fn read_from_disk(path: &[u8]) -> Read {
    match bun_sys::File::read_from(bun_sys::Fd::cwd(), path) {
        Ok(text) => Ok(Some(text)),
        // A directory far above the project may refuse to be searched.
        Err(_) if !bun_sys::exists_z(&bun_paths::Path::from(path)) => Ok(None),
        Err(error) => Err(error.name()),
    }
}
