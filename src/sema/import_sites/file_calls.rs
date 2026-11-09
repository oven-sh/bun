use super::call_sites::{expr_kind, is_free_name};
use crate::atom::{Atom, known};
use crate::bind::Bound;
use crate::hir::{ExprId, ExprKind, File, MemberKey};

/// What a function of the library answers with for the file that it is given.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FileCall {
    PathOfUrl,
    UrlOfPath,
    Url,
    SamePath,
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

    pub const fn specifiers(self) -> &'static [Atom] {
        match self {
            HolderOfFileCalls::UrlModule => &[known::url, known::node_url],
            HolderOfFileCalls::PathModule => &[known::path, known::node_path],
            HolderOfFileCalls::Bun => &[known::bun],
            HolderOfFileCalls::UrlClass => &[],
        }
    }

    pub const fn global(self) -> Option<Atom> {
        match self {
            HolderOfFileCalls::Bun => Some(known::Bun),
            HolderOfFileCalls::UrlClass => Some(known::URL),
            HolderOfFileCalls::UrlModule | HolderOfFileCalls::PathModule => None,
        }
    }

    pub(super) fn of_specifier(specifier: Atom) -> Option<HolderOfFileCalls> {
        let mut holders = HolderOfFileCalls::ALL.into_iter();
        holders.find(|holder| holder.specifiers().contains(&specifier))
    }

    fn of_global(name: Atom) -> Option<HolderOfFileCalls> {
        let mut holders = HolderOfFileCalls::ALL.into_iter();
        holders.find(|holder| holder.global() == Some(name))
    }
}

/// The functions of the library that answer with the file they are given. Each takes that file as its first argument.
pub const FILE_CALLS: [(HolderOfFileCalls, Atom, FileCall); 7] = [
    (
        HolderOfFileCalls::UrlModule,
        known::fileURLToPath,
        FileCall::PathOfUrl,
    ),
    (
        HolderOfFileCalls::UrlModule,
        known::pathToFileURL,
        FileCall::UrlOfPath,
    ),
    (
        HolderOfFileCalls::Bun,
        known::fileURLToPath,
        FileCall::PathOfUrl,
    ),
    (
        HolderOfFileCalls::Bun,
        known::pathToFileURL,
        FileCall::UrlOfPath,
    ),
    (HolderOfFileCalls::UrlClass, known::parse, FileCall::Url),
    (
        HolderOfFileCalls::PathModule,
        known::normalize,
        FileCall::SamePath,
    ),
    (
        HolderOfFileCalls::PathModule,
        known::resolve,
        FileCall::SamePath,
    ),
];

pub(super) fn find_listed_call(holder: HolderOfFileCalls, name: Atom) -> Option<FileCall> {
    let mut rows = FILE_CALLS.iter();
    let row = rows.find(|row| row.0 == holder && row.1 == name)?;
    Some(row.2)
}

pub(super) fn find_member_of_global(
    hir: &File<'_>,
    bound: &Bound<'_>,
    e: ExprId,
) -> Option<(HolderOfFileCalls, Atom)> {
    let (object, MemberKey::Name(name)) = hir.member_key(hir.skip_type_assertions(e))? else {
        return None;
    };
    let object = hir.skip_type_assertions(object);
    let Some(ExprKind::Ident(global)) = expr_kind(hir, object) else {
        return None;
    };
    let holder = HolderOfFileCalls::of_global(global)?;
    is_free_name(hir, bound, object, &[global]).then_some((holder, name))
}

#[cfg(test)]
mod tests {
    use super::{FILE_CALLS, FileCall, HolderOfFileCalls, find_listed_call};
    use crate::atom::{Atom, known};

    #[test]
    fn every_row_is_found_under_its_holder_and_its_name() {
        for holder in HolderOfFileCalls::ALL {
            for &specifier in holder.specifiers() {
                assert_eq!(HolderOfFileCalls::of_specifier(specifier), Some(holder));
            }
            if let Some(global) = holder.global() {
                assert_eq!(HolderOfFileCalls::of_global(global), Some(holder));
            }
        }
        for (index, row) in FILE_CALLS.iter().enumerate() {
            let is_same =
                |other: &&(HolderOfFileCalls, Atom, FileCall)| other.0 == row.0 && other.1 == row.1;
            assert_eq!(FILE_CALLS[..index].iter().find(is_same), None, "{row:?}");
            assert_eq!(find_listed_call(row.0, row.1), Some(row.2));
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
        assert_eq!(find_listed_call(UrlModule, known::normalize), None);
        assert_eq!(find_listed_call(Bun, known::resolve), None);
        assert_eq!(find_listed_call(Bun, known::parse), None);
    }
}
