// The files of one program. A file can be in any number of programs, in any order.
use crate::ast::file::File;
use crate::ast::reader::{Frozen, FrozenError};
use std::sync::Arc;

#[derive(Default)]
pub struct Program {
    files: Vec<Arc<File>>,
}

impl Program {
    pub fn new(files: Vec<Arc<File>>) -> Self {
        Self { files }
    }
    pub fn files(&self) -> &[Arc<File>] {
        &self.files
    }
    // The page table of the program: what a checker resolves the ids of the files with.
    pub fn frozen(&self) -> Result<Frozen<'_>, FrozenError> {
        let files: Vec<&File> = self.files.iter().map(|file| &**file).collect();
        Frozen::of_files(&files)
    }
}

// The files of a program are shared between threads.
const _: () = {
    const fn assert_sync<T: Sync + Send>() {}
    assert_sync::<Program>();
};
