use crate::atom::{Atom, Interner, KNOWN_TEXTS, known};

/// A module of the library that a reader of the scan or of the fold knows by name.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum LibraryModule {
    Path,
    PathPosix,
    Url,
    Module,
    Process,
    WorkerThreads,
    Os,
    Fs,
    FsPromises,
    Bun,
}

use LibraryModule::{
    Bun, Fs, FsPromises, Module, Os, Path, PathPosix, Process, Url, WorkerThreads,
};

/// Every specifier that a reader takes for a module of the library. No reader writes a list of its own.
///
/// `path/win32` and `path.win32` have no row. They are `path` on Windows alone, and a reader can't tell where the
/// program runs. The functions of `PathPosix` are `path`'s own everywhere but on Windows, where they take a native
/// path for one name: a reader that can't hold what it read against the path of the run takes `Path` alone.
const SPELLINGS: [(&[u8], LibraryModule, Option<Atom>); 19] = [
    (b"path", Path, Some(known::path)),
    (b"node:path", Path, Some(known::node_path)),
    (b"path/posix", PathPosix, Some(known::path_posix)),
    (b"node:path/posix", PathPosix, Some(known::node_path_posix)),
    (b"url", Url, Some(known::url)),
    (b"node:url", Url, Some(known::node_url)),
    (b"module", Module, Some(known::module)),
    (b"node:module", Module, Some(known::node_module)),
    (b"process", Process, Some(known::process)),
    (b"node:process", Process, Some(known::node_process)),
    (
        b"worker_threads",
        WorkerThreads,
        Some(known::worker_threads),
    ),
    (
        b"node:worker_threads",
        WorkerThreads,
        Some(known::node_worker_threads),
    ),
    (b"os", Os, None),
    (b"node:os", Os, None),
    (b"fs", Fs, None),
    (b"node:fs", Fs, None),
    (b"fs/promises", FsPromises, None),
    (b"node:fs/promises", FsPromises, None),
    (b"bun", Bun, None),
];

/// A member of a module that is itself a module of the library: `path.posix`, `fs.promises`, `Module.Module`.
const MEMBERS_THAT_ARE_MODULES: [(LibraryModule, &[u8], Option<Atom>, LibraryModule); 4] = [
    (Path, b"posix", Some(known::posix), PathPosix),
    (PathPosix, b"posix", Some(known::posix), PathPosix),
    (Module, b"Module", Some(known::Module), Module),
    (Fs, b"promises", None, FsPromises),
];

/// A text that has a known atom is interned under that atom alone, and the table test holds each row to it. So one
/// comparison tells a name that no row with an atom can be.
fn has_known_atom(name: Atom) -> bool {
    (name.0 as usize) < KNOWN_TEXTS.len()
}

impl LibraryModule {
    /// Without an interner only the spellings that are known atoms are found: `Os`, `Fs`, `FsPromises` and `Bun` have
    /// none.
    pub(crate) fn of_specifier(
        specifier: Atom,
        atoms: Option<&Interner<'_>>,
    ) -> Option<LibraryModule> {
        let mut spellings = SPELLINGS.iter();
        let found = match has_known_atom(specifier) {
            true => spellings.find(|it| it.2 == Some(specifier))?,
            false => {
                let text = atoms?.bytes(specifier);
                spellings.find(|it| it.2.is_none() && it.0 == text)?
            }
        };
        Some(found.1)
    }

    /// The export that `members` name below this module, and the module that holds it. `members` start at the export:
    /// `path.posix.join` is `[join, posix]` below `Path`, and `join` of `PathPosix`.
    pub(crate) fn export_of(
        self,
        members: &[Atom],
        atoms: Option<&Interner<'_>>,
    ) -> Option<(LibraryModule, Atom)> {
        let (&export, modules) = members.split_first()?;
        let mut holder = self;
        for &member in modules.iter().rev() {
            let is_member = |it: &&(LibraryModule, &[u8], Option<Atom>, LibraryModule)| match it.2 {
                Some(known) => known == member,
                None => {
                    !has_known_atom(member)
                        && atoms.is_some_and(|atoms| atoms.bytes(member) == it.1)
                }
            };
            let mut rows = MEMBERS_THAT_ARE_MODULES.iter();
            holder = rows.find(|it| it.0 == holder && is_member(it))?.3;
        }
        Some((holder, export))
    }
}

#[cfg(test)]
mod tests {
    use super::{LibraryModule, MEMBERS_THAT_ARE_MODULES, SPELLINGS, has_known_atom};
    use crate::atom::{Atom, Interner, known};
    use crate::session::Session;

    #[test]
    fn every_spelling_is_found_under_its_text_and_under_its_atom() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        for (index, &(text, module, known)) in SPELLINGS.iter().enumerate() {
            let is_same = |other: &&(&[u8], LibraryModule, Option<Atom>)| other.0 == text;
            assert!(SPELLINGS[..index].iter().find(is_same).is_none());
            let written = atoms.intern(text);
            assert_eq!(known.is_none(), !has_known_atom(written), "{module:?}");
            assert!(known.is_none_or(|known| known == written), "{module:?}");
            let with_interner = LibraryModule::of_specifier(written, Some(&atoms));
            assert_eq!(with_interner, Some(module));
            let without = LibraryModule::of_specifier(written, None);
            assert_eq!(without, known.map(|_| module));
        }
        for &(_, text, known, _) in &MEMBERS_THAT_ARE_MODULES {
            let written = atoms.intern(text);
            assert_eq!(known.is_none(), !has_known_atom(written));
            assert!(known.is_none_or(|known| known == written));
        }
    }

    #[test]
    fn a_specifier_that_has_no_row_is_no_module_of_the_library() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        for text in [
            &b"path/win32"[..],
            b"node:path/win32",
            b"./path",
            b"node:paths",
            b"bun:test",
            b"",
        ] {
            let written = atoms.intern(text);
            assert_eq!(LibraryModule::of_specifier(written, Some(&atoms)), None);
        }
        assert_eq!(LibraryModule::of_specifier(known::posix, None), None);
        assert_eq!(LibraryModule::of_specifier(known::require, None), None);
    }

    #[test]
    fn a_member_that_is_a_module_leads_on_to_it() {
        use LibraryModule::{Fs, FsPromises, Module, Path, PathPosix, Url};
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let [promises, win32, write] =
            [&b"promises"[..], b"win32", b"writeFile"].map(|text| atoms.intern(text));
        let (join, posix, default) = (known::join, known::posix, known::default);
        let all = Some(&atoms);
        assert_eq!(Path.export_of(&[], None), None);
        assert_eq!(Path.export_of(&[join], None), Some((Path, join)));
        assert_eq!(
            Path.export_of(&[join, posix], None),
            Some((PathPosix, join))
        );
        let twice = [join, posix, posix];
        assert_eq!(Path.export_of(&twice, None), Some((PathPosix, join)));
        assert_eq!(
            PathPosix.export_of(&[join, posix], None),
            Some((PathPosix, join))
        );
        assert_eq!(Path.export_of(&[posix], None), Some((Path, posix)));
        assert_eq!(Path.export_of(&[join, win32], all), None);
        assert_eq!(Path.export_of(&[join, win32, posix], all), None);
        assert_eq!(Path.export_of(&[join, default], all), None);
        assert_eq!(Url.export_of(&[join, posix], all), None);
        let made = [known::createRequire, known::Module, known::Module];
        assert_eq!(
            Module.export_of(&made, None),
            Some((Module, known::createRequire))
        );
        assert_eq!(Path.export_of(&[join, known::Module], all), None);
        assert_eq!(
            Fs.export_of(&[write, promises], all),
            Some((FsPromises, write))
        );
        assert_eq!(Fs.export_of(&[write, promises], None), None);
        assert_eq!(FsPromises.export_of(&[write, promises], all), None);
    }
}
