//! What the whole-program analysis of `bun build --compile-aot` found, as the bundler passes it on.

use std::collections::HashMap;

pub struct ProgramFacts {
    /// For the compiler: shapes, types, signatures, and what each tag stands for.
    pub table: Box<[u8]>,
    /// For the printer, by the path of a source file: position and tag, sorted by position.
    pub tags: HashMap<Box<[u8]>, Box<[(u32, u32)]>>,
    /// The program, compiled from its types as far as the code generator of the engine: it runs in the place of the entry point.
    pub typed: Option<Box<[u8]>>,
}

impl ProgramFacts {
    pub fn tags_for(&self, path: &[u8]) -> Option<&[(u32, u32)]> {
        self.tags.get(path).map(|tags| &**tags)
    }
}
