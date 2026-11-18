//! Functions on their way from the parser to the validator.

use std::sync::Arc;

use crate::driver::FunctionBody;
use crate::error::{Error, ErrorKind};
use crate::index::CodeIndex;
use crate::module::{Chunk, Function, ModuleHeader, Span};
use crate::reader::Reader;
use crate::validate::{Scratch, Validator};

/// Consecutive entries of the code section, each a size and a body.
#[derive(Clone, Copy, Default)]
pub(super) struct Batch {
    first: u32,
    count: u32,
    pub(super) start: usize,
    pub(super) end: usize,
}

impl Batch {
    pub(super) fn starting(first: u32, start: usize) -> Self {
        Self {
            first,
            count: 0,
            start,
            end: start,
        }
    }

    pub(super) fn extend_to(&mut self, end: usize) {
        self.count += 1;
        self.end = end;
    }

    pub(super) fn size(&self) -> usize {
        self.end - self.start
    }
}

/// Some consecutive functions. They can be validated on any thread.
pub struct Bodies {
    header: Arc<ModuleHeader>,
    chunk: Chunk,
    batch: Batch,
}

impl Bodies {
    pub(super) fn new(header: &Arc<ModuleHeader>, chunk: &Chunk, batch: Batch) -> Self {
        Self {
            header: Arc::clone(header),
            chunk: chunk.clone(),
            batch,
        }
    }

    pub fn first(&self) -> CodeIndex {
        CodeIndex(self.batch.first)
    }

    pub fn size_in_bytes(&self) -> usize {
        self.batch.size()
    }

    pub fn validate(self, scratch: &mut Scratch) -> ValidatedBodies {
        let functions = Validator::with(&self.header, scratch, |validator| self.check(validator));
        ValidatedBodies {
            bodies: self,
            functions,
        }
    }

    fn check(&self, validator: &mut Validator<'_>) -> Result<Vec<Function>, Error> {
        let Batch { first, count, .. } = self.batch;
        let mut functions = Vec::new();
        if functions.try_reserve_exact(count as usize).is_err() {
            let reason = format_args!("can't allocate enough memory for {count} functions");
            return Err(Error::new(ErrorKind::Module, reason));
        }
        let mut reader = Reader::new(self.chunk.from(self.batch.start as u32), 0);
        for code in first..first + count {
            let len = reader.u32().expect("a size that was read before");
            let start = (self.batch.start + reader.position()) as u32;
            let bytes = reader.slice(len as usize).expect("a body that has arrived");
            functions.push(Function {
                body: Span { start, len },
                facts: validator.function(CodeIndex(code), bytes)?,
            });
        }
        Ok(functions)
    }
}

pub struct ValidatedBodies {
    bodies: Bodies,
    functions: Result<Vec<Function>, Error>,
}

impl ValidatedBodies {
    pub fn first(&self) -> CodeIndex {
        self.bodies.first()
    }

    /// That of the first invalid function among these. The module may have an error that comes before it.
    pub fn error(&self) -> Option<&Error> {
        self.functions.as_ref().err()
    }

    /// None if one is invalid.
    pub fn bodies(&self) -> impl Iterator<Item = FunctionBody<'_>> {
        let Bodies { header, chunk, .. } = &self.bodies;
        let functions = self.functions.iter().flatten();
        functions.zip(self.first().0..).map(|(function, code)| {
            FunctionBody::new(
                header,
                CodeIndex(code),
                chunk.get(function.body),
                function.facts,
            )
        })
    }

    pub(super) fn follows(&self, header: &Arc<ModuleHeader>, count: usize) -> bool {
        Arc::ptr_eq(&self.bodies.header, header) && self.first().usize() == count
    }

    pub(super) fn into_functions(self) -> Result<Vec<Function>, Error> {
        self.functions
    }
}
