use crate::atom::{Atom, KNOWN_TEXTS};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FileCall {
    PathOfUrl,
    UrlOfPath,
    Url,
    SamePath,
    SamePathWithoutBackslashes,
    PathFoundFromFolder,
    PromiseOfPathFoundFromFolder,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum HolderOfFileCalls {
    UrlModule,
    PathModule,
    Bun,
    UrlClass,
}

impl HolderOfFileCalls {
    pub const ALL: [HolderOfFileCalls; 4] = [
        HolderOfFileCalls::UrlModule,
        HolderOfFileCalls::PathModule,
        HolderOfFileCalls::Bun,
        HolderOfFileCalls::UrlClass,
    ];

    pub const fn specifiers(self) -> &'static [&'static [u8]] {
        match self {
            HolderOfFileCalls::UrlModule => &[b"url", b"node:url"],
            HolderOfFileCalls::PathModule => &[b"path", b"node:path"],
            HolderOfFileCalls::Bun => &[b"bun"],
            HolderOfFileCalls::UrlClass => &[],
        }
    }

    pub const fn global(self) -> Option<&'static [u8]> {
        match self {
            HolderOfFileCalls::Bun => Some(b"Bun"),
            HolderOfFileCalls::UrlClass => Some(b"URL"),
            HolderOfFileCalls::UrlModule | HolderOfFileCalls::PathModule => None,
        }
    }

    pub(crate) fn of_specifier_atom(specifier: Atom) -> Option<HolderOfFileCalls> {
        HolderOfFileCalls::of_specifier(KNOWN_TEXTS.get(specifier.0 as usize)?)
    }

    pub(crate) fn of_global_atom(name: Atom) -> Option<HolderOfFileCalls> {
        HolderOfFileCalls::of_global(KNOWN_TEXTS.get(name.0 as usize)?)
    }

    pub fn of_specifier(specifier: &[u8]) -> Option<HolderOfFileCalls> {
        let mut holders = HolderOfFileCalls::ALL.into_iter();
        holders.find(|holder| holder.specifiers().contains(&specifier))
    }

    pub fn of_global(name: &[u8]) -> Option<HolderOfFileCalls> {
        let mut holders = HolderOfFileCalls::ALL.into_iter();
        holders.find(|holder| holder.global() == Some(name))
    }
}

pub const FILE_CALLS: [(HolderOfFileCalls, &[u8], FileCall); 9] = [
    (
        HolderOfFileCalls::UrlModule,
        b"fileURLToPath",
        FileCall::PathOfUrl,
    ),
    (
        HolderOfFileCalls::UrlModule,
        b"pathToFileURL",
        FileCall::UrlOfPath,
    ),
    (
        HolderOfFileCalls::Bun,
        b"fileURLToPath",
        FileCall::PathOfUrl,
    ),
    (
        HolderOfFileCalls::Bun,
        b"pathToFileURL",
        FileCall::UrlOfPath,
    ),
    (
        HolderOfFileCalls::Bun,
        b"resolveSync",
        FileCall::PathFoundFromFolder,
    ),
    (
        HolderOfFileCalls::Bun,
        b"resolve",
        FileCall::PromiseOfPathFoundFromFolder,
    ),
    (HolderOfFileCalls::UrlClass, b"parse", FileCall::Url),
    (
        HolderOfFileCalls::PathModule,
        b"normalize",
        FileCall::SamePath,
    ),
    (
        HolderOfFileCalls::PathModule,
        b"toNamespacedPath",
        FileCall::SamePathWithoutBackslashes,
    ),
];

pub fn find_file_call(holder: HolderOfFileCalls, name: &[u8]) -> Option<FileCall> {
    let mut rows = FILE_CALLS.iter();
    let row = rows.find(|row| row.0 == holder && row.1 == name)?;
    Some(row.2)
}

pub(crate) fn find_file_call_named(holder: HolderOfFileCalls, name: Atom) -> Option<FileCall> {
    find_file_call(holder, KNOWN_TEXTS.get(name.0 as usize)?)
}

#[cfg(test)]
mod tests {
    use super::{FILE_CALLS, FileCall, HolderOfFileCalls, find_file_call};
    use crate::atom::KNOWN_TEXTS;

    #[test]
    fn every_module_and_global_of_a_holder_is_a_known_atom() {
        for holder in HolderOfFileCalls::ALL {
            let names = holder.specifiers().iter().copied().chain(holder.global());
            for name in names {
                assert!(KNOWN_TEXTS.contains(&name), "{holder:?}");
            }
        }
        for row in FILE_CALLS {
            assert!(KNOWN_TEXTS.contains(&row.1), "{row:?}");
        }
    }

    #[test]
    fn a_function_is_listed_once_for_each_holder() {
        for (index, row) in FILE_CALLS.iter().enumerate() {
            let is_same = |other: &&(HolderOfFileCalls, &[u8], FileCall)| {
                other.0 == row.0 && other.1 == row.1
            };
            assert_eq!(FILE_CALLS[..index].iter().find(is_same), None, "{row:?}");
            assert_eq!(find_file_call(row.0, row.1), Some(row.2));
        }
    }

    #[test]
    fn a_holder_is_found_by_its_module_and_by_its_global() {
        use HolderOfFileCalls::{Bun, PathModule, UrlClass, UrlModule};
        let by_specifier: [(&[u8], _); 7] = [
            (b"url", Some(UrlModule)),
            (b"node:url", Some(UrlModule)),
            (b"path", Some(PathModule)),
            (b"node:path", Some(PathModule)),
            (b"bun", Some(Bun)),
            (b"./bun", None),
            (b"URL", None),
        ];
        for (specifier, holder) in by_specifier {
            assert_eq!(HolderOfFileCalls::of_specifier(specifier), holder);
        }
        assert_eq!(HolderOfFileCalls::of_global(b"Bun"), Some(Bun));
        assert_eq!(HolderOfFileCalls::of_global(b"URL"), Some(UrlClass));
        assert_eq!(HolderOfFileCalls::of_global(b"url"), None);
        assert_eq!(find_file_call(UrlClass, b"canParse"), None);
        assert_eq!(find_file_call(PathModule, b"fileURLToPath"), None);
    }
}
