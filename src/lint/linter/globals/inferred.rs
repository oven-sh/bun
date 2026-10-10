//! The globals of a file by the types of the program that it belongs to: its libraries, the packages of types that it takes in,
//! `declare global`, its scripts.

use crate::ast::File;
use crate::language::InferGlobals;

/// The globals of the programs that the files of a run belong to.
pub trait InferredGlobals: Sync {
    /// Sorted by name. `None`: the file belongs to no program: nothing is known. `path`: [`File::path`].
    fn of(&self, path: &[u8]) -> Option<&[InferredGlobal]>;
}

pub struct InferredGlobal {
    pub name: Box<[u8]>,
    pub is_value: bool,
    pub is_type: bool,
    pub is_writable: bool,
}

impl<'a> File<'a> {
    pub fn set_inferred_globals(&self, all: &'a dyn InferredGlobals) {
        self.inferred_from.set(Some(all));
    }

    /// What the program of the file declares as global, sorted by name. `None`: nothing is inferred for the file, or it is in no
    /// program. The first call asks.
    pub(crate) fn inferred_globals(&self) -> Option<&'a [InferredGlobal]> {
        if self.language().infers_globals == InferGlobals::No {
            return None;
        }
        let ask = || self.inferred_from.get()?.of(self.path());
        *self.inferred_globals.get_or_init(ask)
    }
}
