use super::table::{self, BuiltinName, Intrinsic, IntrinsicPosition};
use bun_sema::atom::{Atom, Interner};
use bun_sema::util::FxHashMap;

#[cfg(test)]
mod tests;

const PRIVATE_PREFIX: &[u8] = b"$";
const SYMBOL_KEY_PREFIX: &[u8] = b"$$";

pub struct BuiltinNames {
    by_atom: FxHashMap<Atom, BuiltinName>,
    by_private_atom: FxHashMap<Atom, BuiltinName>,
    by_symbol_key_atom: FxHashMap<Atom, BuiltinName>,
    atoms: Box<[Option<Atom>]>,
}

fn all_names() -> impl Iterator<Item = BuiltinName> {
    (0..BuiltinName::COUNT).map(BuiltinName)
}

fn is_symbol_key(name: BuiltinName) -> bool {
    matches!(
        table::intrinsic_of(name, IntrinsicPosition::Member),
        Some(Intrinsic::SymbolKey(_))
    )
}

fn intern_text_name(atoms: &Interner<'_>, name: BuiltinName) -> Option<Atom> {
    (!table::is_symbol_name(name)).then(|| atoms.intern(table::text_of_name(name)))
}

fn intern_with_prefix(atoms: &Interner<'_>, prefix: &[u8], name: BuiltinName) -> Atom {
    atoms.intern(&[prefix, table::text_of_name(name)].concat())
}

impl BuiltinNames {
    pub fn new(atoms: &Interner<'_>) -> BuiltinNames {
        let name_atoms: Box<[Option<Atom>]> = all_names()
            .map(|name| intern_text_name(atoms, name))
            .collect();
        let by_atom = all_names()
            .zip(name_atoms.iter())
            .filter_map(|(name, &atom)| Some((atom?, name)))
            .collect();
        let by_private_atom = table::intrinsic_names()
            .map(|name| (intern_with_prefix(atoms, PRIVATE_PREFIX, name), name))
            .collect();
        let by_symbol_key_atom = table::intrinsic_names()
            .filter(|&name| is_symbol_key(name))
            .map(|name| (intern_with_prefix(atoms, SYMBOL_KEY_PREFIX, name), name))
            .collect();
        BuiltinNames {
            by_atom,
            by_private_atom,
            by_symbol_key_atom,
            atoms: name_atoms,
        }
    }

    pub fn get(&self, atom: Atom) -> Option<BuiltinName> {
        self.by_atom.get(&atom).copied()
    }

    pub fn get_private(&self, atom: Atom) -> Option<BuiltinName> {
        self.by_private_atom.get(&atom).copied()
    }

    pub fn get_symbol_key(&self, atom: Atom) -> Option<BuiltinName> {
        self.by_symbol_key_atom.get(&atom).copied()
    }

    pub fn atom_of(&self, name: BuiltinName) -> Option<Atom> {
        *self.atoms.get(name.0 as usize)?
    }
}
