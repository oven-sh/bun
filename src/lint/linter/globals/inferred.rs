//! A file's globals according to the types of the program it belongs to: its libraries, the type packages it includes,
//! `declare global`, its scripts.

use crate::ast::File;
use crate::language::{Global, InferGlobals};

/// The globals of the programs that a run's files belong to.
pub trait InferredGlobals: Sync {
    /// `path` is [`File::path`]. Returns `None` if the file doesn't belong to any program, so nothing is known.
    fn of(&self, path: &[u8]) -> Option<ProgramGlobals<'_>>;

    /// For [`InferGlobals::ByOptions`]: the contents of the tables that correspond to the libraries and type packages
    /// in the project's options. Returns `None` in the same case as [`InferredGlobals::of`].
    fn chosen(&self, path: &[u8]) -> Option<ProgramGlobals<'_>> {
        self.of(path)
    }
}

#[derive(Copy, Clone)]
pub struct ProgramGlobals<'a> {
    /// Sorted by name.
    pub names: &'a [InferredGlobal],
    /// `checkJs`. Without it TypeScript reports nothing in JavaScript, so there's no guarantee that everything the
    /// project's JavaScript uses is declared. The names are then added to the config's globals instead of replacing
    /// them.
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

    /// The globals that the file's program declares. `None` if nothing is inferred for the file, or it isn't in a
    /// program. Computed on the first call.
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

    /// Under [`InferGlobals::ByOptions`]: true if the types of the file's program declare the value `name`, which
    /// [`File::global`] doesn't know. This loads the program, once, so only call it when `name` is about to be
    /// reported.
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
            // The program couldn't be loaded after all. Then nothing is known, so fall back to the config.
            None => {
                let setting = self.language().config_globals().setting(name);
                setting.is_some_and(|it| it != Global::Off)
            }
        }
    }
}
