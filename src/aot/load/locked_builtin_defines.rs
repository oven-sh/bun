use bun_sema::atom::{Atom, Interner};
use bun_sema::fold::{Constant, Define, DefinePath, DefineRoot, DefineValue, RuntimeValueKind};
use bun_sema::session::Arena;

use crate::builtins::{BuiltinId, BuiltinKind, Mutability, Platforms, table};

struct LockedPathWalk<'a, 's> {
    platform: Platforms,
    replaced: &'a [u32],
    arena: &'s Arena,
    atoms: &'a Interner<'s>,
    names: Vec<Atom>,
    holders: Vec<BuiltinId>,
    defines: Vec<Define<'s>>,
}

fn runtime_value_kind(object: BuiltinId) -> Option<RuntimeValueKind> {
    if table::is_callable(object) {
        return Some(RuntimeValueKind::Function);
    }
    match table::entry(object).kind {
        BuiltinKind::Namespace | BuiltinKind::Prototype => Some(RuntimeValueKind::Object),
        BuiltinKind::Constant => table::well_known_symbol(object).map(|_| RuntimeValueKind::Symbol),
        _ => None,
    }
}

impl LockedPathWalk<'_, '_> {
    fn add_location(&mut self, location: BuiltinId) {
        let (object, entry) = (table::canonical_id(location), table::entry(location));
        let Some(kind) = runtime_value_kind(object) else {
            return;
        };
        if entry.mutability != Mutability::AlwaysLocked
            || table::is_symbol_name(entry.name)
            || !table::exists_on(location, self.platform)
            || self.replaced.binary_search(&(location as u32)).is_ok()
        {
            return;
        }
        let name = self.atoms.intern(table::text_of_name(entry.name));
        self.names.push(name);
        self.defines.push(Define {
            path: DefinePath {
                root: DefineRoot::Global(self.names[0]),
                members: self.arena.alloc_slice_copy(&self.names[1..]),
            },
            value: DefineValue::RuntimeValue(kind),
        });
        if !self.holders.contains(&object) {
            self.holders.push(object);
            for &member in table::members(object) {
                self.add_location(member);
            }
            self.holders.pop();
        }
        self.names.pop();
    }
}

/// Every path of names from the global scope on which each step is always locked and which ends at a function, an object or a well-known symbol.
/// `replaced`: `LoadOptions::replaced_builtins`.
pub(crate) fn locked_builtin_defines<'s>(
    platform: Platforms,
    replaced: &[u32],
    arena: &'s Arena,
    atoms: &Interner<'s>,
) -> Vec<Define<'s>> {
    let mut walk = LockedPathWalk {
        platform,
        replaced,
        arena,
        atoms,
        names: Vec::new(),
        holders: Vec::new(),
        defines: Vec::new(),
    };
    for &global in table::members(BuiltinId::GlobalThis) {
        walk.add_location(global);
    }
    walk.add_location(BuiltinId::GlobalThis);
    walk.defines
}

#[derive(Copy, Clone)]
enum KnownValue {
    Object,
    True,
    Text(&'static str),
}

/// The paths that programs test to find out which runtime they are on.
/// `Bun` is read-only and cannot be deleted (ZigGlobalObject.lut.txt), so no program replaces it.
/// The table locks `process` and the name after it, and BunProcess.cpp makes the name after that read-only in an executable.
const RUNTIME_IDENTITY: [(&[&str], KnownValue); 7] = [
    (&["Bun"], KnownValue::Object),
    (&["process", "isBun"], KnownValue::True),
    (&["process", "versions"], KnownValue::Object),
    (
        &["process", "versions", "bun"],
        KnownValue::Text(bun_core::Global::package_json_version),
    ),
    (
        &["process", "versions", "node"],
        KnownValue::Text(bun_core::env::REPORTED_NODEJS_VERSION),
    ),
    (&["process", "release"], KnownValue::Object),
    (&["process", "release", "name"], KnownValue::Text("node")),
];

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum RuntimeIdentity {
    IsLocked,
    /// A program that runs in place, as a test does: a test replaces `process.versions`, `process.release` and `process.isBun`, or a member of the first two, to pose as
    /// another runtime, as under plain `bun test`. Nothing under `process` is folded.
    MayBeReplaced,
}

fn is_folded_under(identity: RuntimeIdentity, names: &[&str]) -> bool {
    identity == RuntimeIdentity::IsLocked || names.len() == 1
}

pub(crate) fn is_folded_in_test_runs(member: BuiltinId) -> bool {
    let folded = RUNTIME_IDENTITY.iter().map(|&(names, _)| names);
    let mut folded = folded.filter(|names| is_folded_under(RuntimeIdentity::MayBeReplaced, names));
    folded.any(|names| {
        let mut found = Some(BuiltinId::GlobalThis);
        for name in names {
            let name = table::find_name(name.as_bytes());
            found = found
                .zip(name)
                .and_then(|(holder, name)| table::own_member(holder, name));
        }
        found == Some(member)
    })
}

pub(crate) fn runtime_identity_defines<'s>(
    identity: RuntimeIdentity,
    arena: &'s Arena,
    atoms: &Interner<'s>,
) -> Vec<Define<'s>> {
    let global_this = atoms.intern(b"globalThis");
    let mut defines = Vec::with_capacity(2 * RUNTIME_IDENTITY.len());
    for (names, known) in RUNTIME_IDENTITY {
        if !is_folded_under(identity, names) {
            continue;
        }
        let names: Vec<Atom> = names
            .iter()
            .map(|name| atoms.intern(name.as_bytes()))
            .collect();
        let value = match known {
            KnownValue::Object => DefineValue::RuntimeValue(RuntimeValueKind::Object),
            KnownValue::True => DefineValue::RuntimeConstant(Constant::Boolean(true)),
            KnownValue::Text(text) => {
                DefineValue::RuntimeConstant(Constant::String(atoms.intern(text.as_bytes())))
            }
        };
        for (root, members) in [(names[0], &names[1..]), (global_this, &names[..])] {
            defines.push(Define {
                path: DefinePath {
                    root: DefineRoot::Global(root),
                    members: arena.alloc_slice_copy(members),
                },
                value,
            });
        }
    }
    defines
}

#[cfg(test)]
mod tests {
    use bun_sema::session::Session;

    use super::*;

    fn kind_at(path: &[&str]) -> Option<RuntimeValueKind> {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let names: Vec<Atom> = path
            .iter()
            .map(|name| atoms.intern(name.as_bytes()))
            .collect();
        let defines = locked_builtin_defines(Platforms::LINUX, &[], session.arena(), &atoms);
        let mut found = defines.iter().filter(|define| {
            define.path.root == DefineRoot::Global(names[0]) && define.path.members == &names[1..]
        });
        let kind = found.next().map(|define| match define.value {
            DefineValue::RuntimeValue(kind) => kind,
            value => panic!("{path:?}: {value:?}"),
        });
        assert!(found.next().is_none(), "{path:?} is listed twice");
        kind
    }

    #[test]
    fn locked_paths_end_at_functions_objects_and_symbols() {
        use RuntimeValueKind::{Function, Object, Symbol};
        let rows: &[(&[&str], RuntimeValueKind)] = &[
            (&["Object"], Function),
            (&["Object", "assign"], Function),
            (&["Object", "prototype"], Object),
            (&["Object", "prototype", "hasOwnProperty"], Function),
            (&["Object", "prototype", "constructor"], Function),
            (&["Array", "prototype", "includes"], Function),
            (&["Math"], Object),
            (&["Math", "imul"], Function),
            (&["Symbol", "iterator"], Symbol),
            (&["globalThis"], Object),
            (&["globalThis", "Map"], Function),
            (&["globalThis", "Reflect", "ownKeys"], Function),
            (&["process"], Object),
            (&["globalThis", "process"], Object),
        ];
        for &(path, kind) in rows {
            assert_eq!(kind_at(path), Some(kind), "{path:?}");
        }
        assert_eq!(
            runtime_value_kind(BuiltinId::FunctionPrototype),
            Some(Function)
        );
    }

    #[test]
    fn runtime_identity_is_listed_from_both_roots() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let locked = RuntimeIdentity::IsLocked;
        let paths: Vec<Vec<&[u8]>> = runtime_identity_defines(locked, session.arena(), &atoms)
            .iter()
            .map(|define| {
                let DefineRoot::Global(root) = define.path.root else {
                    panic!("{:?}", define.path.root);
                };
                let names = std::iter::once(root).chain(define.path.members.iter().copied());
                names.map(|name| atoms.bytes(name)).collect()
            })
            .collect();
        assert_eq!(paths.len(), 2 * RUNTIME_IDENTITY.len());
        assert_eq!(paths[..2], [vec![&b"Bun"[..]], vec![b"globalThis", b"Bun"]]);
        assert_eq!(paths[2], [&b"process"[..], b"isBun"]);
        assert_eq!(paths[3], [&b"globalThis"[..], b"process", b"isBun"]);
        let open = RuntimeIdentity::MayBeReplaced;
        assert_eq!(
            runtime_identity_defines(open, session.arena(), &atoms).len(),
            2
        );
    }

    #[test]
    fn tests_replace_nothing_that_their_run_folds() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let open = RuntimeIdentity::MayBeReplaced;
        let defines = runtime_identity_defines(open, session.arena(), &atoms);
        let global = |define: &Define<'_>| match (define.path.root, define.path.members) {
            (DefineRoot::Global(root), []) => table::find_name(atoms.bytes(root)),
            _ => None,
        };
        let folded: Vec<BuiltinId> = (defines.iter().filter_map(global))
            .filter_map(table::global)
            .collect();
        assert_eq!(folded.len(), 1);
        for &member in table::members(BuiltinId::GlobalThis) {
            assert_eq!(
                is_folded_in_test_runs(member),
                folded.contains(&member),
                "{}",
                table::text_of(member)
            );
        }
        assert!(!is_folded_in_test_runs(BuiltinId::Process));
    }

    #[test]
    fn table_locks_runtime_identity_on_process() {
        for (names, _) in &RUNTIME_IDENTITY[1..] {
            assert_eq!(names[0], "process");
            let name = table::find_name(names[1].as_bytes()).unwrap();
            let location = table::own_member(BuiltinId::Process, name).unwrap();
            assert!(table::is_locked(location), "{names:?}");
        }
    }

    #[test]
    fn other_paths_are_not_listed() {
        let rows: &[&[&str]] = &[
            &["Math", "random"],
            &["Math", "PI"],
            &["JSON", "parse"],
            &["Promise"],
            &["Promise", "resolve"],
            &["Function", "prototype"],
            &["undefined"],
            &["Date", "now"],
            &["console"],
            &["process", "platform"],
            &["process", "isBun"],
            &["Bun"],
            &["Bun", "serve"],
            &["navigator"],
            &["Map", "prototype", "size"],
            &["Object", "mine"],
            &["Object", "prototype", "constructor", "assign"],
            &["globalThis", "globalThis"],
        ];
        for &path in rows {
            assert_eq!(kind_at(path), None, "{path:?}");
        }
    }
}
