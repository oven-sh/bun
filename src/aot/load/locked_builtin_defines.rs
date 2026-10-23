use bun_sema::atom::{Atom, Interner};
use bun_sema::fold::{Define, DefinePath, DefineRoot, DefineValue, RuntimeValueKind};
use bun_sema::session::Arena;

use crate::builtins::{BuiltinId, BuiltinKind, Mutability, Platforms, table};

struct LockedPathWalk<'a, 's> {
    platform: Platforms,
    arena: &'s Arena,
    atoms: &'a Interner<'s>,
    names: Vec<Atom>,
    holders: Vec<BuiltinId>,
    defines: Vec<Define<'s>>,
}

fn runtime_value_kind(object: BuiltinId) -> Option<RuntimeValueKind> {
    match table::entry(object).kind {
        BuiltinKind::Constructor | BuiltinKind::Function | BuiltinKind::Method => {
            Some(RuntimeValueKind::Function)
        }
        BuiltinKind::Prototype if object == BuiltinId::FunctionPrototype => {
            Some(RuntimeValueKind::Function)
        }
        BuiltinKind::Namespace | BuiltinKind::Prototype => Some(RuntimeValueKind::Object),
        BuiltinKind::Constant => table::well_known_symbol(object).map(|_| RuntimeValueKind::Symbol),
        BuiltinKind::Accessor | BuiltinKind::DataProperty | BuiltinKind::NativeBinding => None,
    }
}

impl<'s> LockedPathWalk<'_, 's> {
    fn is_locked_location(&self, location: BuiltinId) -> bool {
        let entry = table::entry(location);
        entry.mutability == Mutability::AlwaysLocked
            && !table::is_symbol_name(entry.name)
            && table::exists_on(location, self.platform)
    }

    fn add_location(&mut self, location: BuiltinId) {
        let object = table::canonical_id(location);
        let Some(kind) = runtime_value_kind(object) else {
            return;
        };
        if !self.is_locked_location(location) {
            return;
        }
        let name = table::text_of_name(table::entry(location).name);
        self.names.push(self.atoms.intern(name));
        self.defines.push(Define {
            path: DefinePath {
                root: DefineRoot::Global(self.names[0]),
                members: self.arena.alloc_slice_copy(&self.names[1..]),
            },
            value: DefineValue::RuntimeValue(kind),
        });
        if !self.holders.contains(&object) {
            self.add_members(object);
        }
        self.names.pop();
    }

    fn add_members(&mut self, holder: BuiltinId) {
        self.holders.push(holder);
        for &member in table::members(holder) {
            self.add_location(member);
        }
        self.holders.pop();
    }
}

/// Every path of names from the global scope on which each step is always locked and which ends at a function, an object or a well-known symbol.
pub(crate) fn locked_builtin_defines<'s>(
    platform: Platforms,
    arena: &'s Arena,
    atoms: &Interner<'s>,
) -> Vec<Define<'s>> {
    let mut walk = LockedPathWalk {
        platform,
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
        let defines = locked_builtin_defines(Platforms::LINUX, session.arena(), &atoms);
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
            &["process"],
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
