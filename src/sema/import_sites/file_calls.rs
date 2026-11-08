use super::call_sites::{expr_kind, is_free_name};
use super::made_requires::follow_settled_bindings;
use crate::atom::{Atom, KNOWN_TEXTS};
use crate::bind::Bound;
use crate::hir::{ExprId, ExprKind, File, MemberKey};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FileCall {
    PathOfUrl,
    UrlOfPath,
    Url,
    SamePath,
    /// On Windows `toNamespacedPath()` answers with `\\?\` in front of the path.
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
    const ALL: [HolderOfFileCalls; 4] = [
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

    pub(super) fn of_specifier(specifier: Atom) -> Option<HolderOfFileCalls> {
        let specifier = *KNOWN_TEXTS.get(specifier.0 as usize)?;
        let mut holders = HolderOfFileCalls::ALL.into_iter();
        holders.find(|holder| holder.specifiers().contains(&specifier))
    }

    fn of_global(name: Atom) -> Option<HolderOfFileCalls> {
        let name = *KNOWN_TEXTS.get(name.0 as usize)?;
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

pub(super) fn find_listed_call(holder: HolderOfFileCalls, name: Atom) -> Option<FileCall> {
    let name = *KNOWN_TEXTS.get(name.0 as usize)?;
    let mut rows = FILE_CALLS.iter();
    let row = rows.find(|row| row.0 == holder && row.1 == name)?;
    Some(row.2)
}

pub(super) fn find_member_of_global(
    hir: &File<'_>,
    bound: &Bound<'_>,
    e: ExprId,
) -> Option<(HolderOfFileCalls, Atom)> {
    let member = follow_settled_bindings(hir, bound, e);
    let (object, MemberKey::Name(name)) = hir.member_key(member)? else {
        return None;
    };
    let object = follow_settled_bindings(hir, bound, object);
    let Some(ExprKind::Ident(global)) = expr_kind(hir, object) else {
        return None;
    };
    let holder = HolderOfFileCalls::of_global(global)?;
    is_free_name(hir, bound, object, &[global]).then_some((holder, name))
}

#[cfg(test)]
mod tests {
    use super::{FILE_CALLS, FileCall, HolderOfFileCalls, find_listed_call};
    use crate::atom::{Atom, KNOWN_TEXTS, known};

    fn atom_of(text: &[u8]) -> Atom {
        let number = KNOWN_TEXTS.iter().position(|known| *known == text);
        Atom(number.unwrap_or_else(|| panic!("{text:?} is no known atom")) as u32)
    }

    #[test]
    fn every_name_of_the_table_is_a_known_atom() {
        for holder in HolderOfFileCalls::ALL {
            for &specifier in holder.specifiers() {
                let found = HolderOfFileCalls::of_specifier(atom_of(specifier));
                assert_eq!(found, Some(holder));
            }
            if let Some(global) = holder.global() {
                assert_eq!(HolderOfFileCalls::of_global(atom_of(global)), Some(holder));
            }
        }
        for (index, row) in FILE_CALLS.iter().enumerate() {
            let is_same = |other: &&(HolderOfFileCalls, &[u8], FileCall)| {
                other.0 == row.0 && other.1 == row.1
            };
            assert_eq!(FILE_CALLS[..index].iter().find(is_same), None, "{row:?}");
            assert_eq!(find_listed_call(row.0, atom_of(row.1)), Some(row.2));
        }
    }

    #[test]
    fn a_name_that_the_table_does_not_hold_is_no_file_call() {
        use HolderOfFileCalls::{Bun, PathModule, UrlClass, UrlModule};
        assert_eq!(HolderOfFileCalls::of_specifier(known::Bun), None);
        assert_eq!(HolderOfFileCalls::of_specifier(known::node_module), None);
        assert_eq!(HolderOfFileCalls::of_global(known::bun), None);
        assert_eq!(HolderOfFileCalls::of_global(known::url), None);
        assert_eq!(HolderOfFileCalls::of_global(Atom(u32::MAX - 1)), None);
        assert_eq!(find_listed_call(UrlClass, known::resolve), None);
        assert_eq!(find_listed_call(PathModule, known::fileURLToPath), None);
        assert_eq!(find_listed_call(UrlModule, known::resolveSync), None);
        assert_eq!(find_listed_call(Bun, known::parse), None);
    }
}
