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
