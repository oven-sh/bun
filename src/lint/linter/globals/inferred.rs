//! The globals of a file by the types of the program that it belongs to: its libraries, the packages of types that it takes in,
//! `declare global`, its scripts.

use crate::ast::File;
use crate::language::{Global, InferGlobals};

/// The globals of the programs that the files of a run belong to.
pub trait InferredGlobals: Sync {
    /// `None`: the file belongs to no program: nothing is known. `path`: [`File::path`].
    fn of(&self, path: &[u8]) -> Option<ProgramGlobals<'_>>;

    /// [`InferGlobals::ByOptions`]: what the tables have that stand for the libraries and the packages of types in the
    /// options of its project. `None`: as above.
    fn chosen(&self, path: &[u8]) -> Option<ProgramGlobals<'_>> {
        self.of(path)
    }
}

#[derive(Copy, Clone)]
pub struct ProgramGlobals<'a> {
    /// Sorted by name.
    pub names: &'a [InferredGlobal],
    /// `checkJs`. Without it TypeScript reports nothing in JavaScript, so nobody has seen to it that what the JavaScript
    /// of the project uses is declared: the names are there besides those of the configuration, not in their place.
    pub checks_javascript: bool,
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

    /// What the program of the file declares as global. `None`: nothing is inferred for the file, or it is in no program.
    /// The first call asks.
    pub(crate) fn inferred_globals(&self) -> Option<ProgramGlobals<'a>> {
        if !(self.language().infers_globals).is_for(self.is_javascript()) {
            return None;
        }
        let ask = || match self.language().infers_globals {
            InferGlobals::ByOptions => self.inferred_from.get()?.chosen(self.path()),
            _ => self.inferred_from.get()?.of(self.path()),
        };
        *self.inferred_globals.get_or_init(ask)
    }

    /// Under [`InferGlobals::ByOptions`]: whether the types of the program of the file declare the value `name`, which
    /// [`File::global`] does not know. The program is loaded for the answer, once: for who is about to report the name.
    pub fn is_declared_by_types(&self, name: &[u8]) -> bool {
        if self.language().infers_globals != InferGlobals::ByOptions
            || self.inferred_globals().is_none()
        {
            return false;
        }
        match self.inferred_from.get().and_then(|it| it.of(self.path())) {
            Some(ProgramGlobals { names, .. }) => names
                .binary_search_by(|it| (*it.name).cmp(name))
                .is_ok_and(|at| names[at].is_value),
            // It cannot be loaded after all. Then nothing is known, and the configuration is asked.
            None => {
                let setting = self.language().config_globals().setting(name);
                setting.is_some_and(|it| it != Global::Off)
            }
        }
    }
}
