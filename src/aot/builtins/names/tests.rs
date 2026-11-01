use super::*;
use crate::ir::WellKnownSymbol;
use bun_sema::session::Session;

fn with_names<R>(then: impl FnOnce(&Interner<'_>, &BuiltinNames) -> R) -> R {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    then(&atoms, &BuiltinNames::new(&atoms))
}

#[test]
fn spelling_gives_name() {
    with_names(|atoms, names| {
        let push = names.get(atoms.intern(b"push"));
        assert_eq!(push.map(table::text_of_name), Some(&b"push"[..]));
        let is_object = names.get_private(atoms.intern(b"$isObject"));
        assert_eq!(is_object.map(table::text_of_name), Some(&b"isObject"[..]));
    });
}

#[test]
fn other_spelling_gives_no_name() {
    with_names(|atoms, names| {
        assert_eq!(names.get(atoms.intern(b"@@iterator")), None);
        assert_eq!(names.get(atoms.intern(b"$isObject")), None);
        assert_eq!(names.get_private(atoms.intern(b"isObject")), None);
        assert_eq!(names.get_private(atoms.intern(b"$$isObject")), None);
        assert_eq!(names.get(atoms.intern(b"notInTheTable")), None);
        assert_eq!(names.get_private(atoms.intern(b"$notInTheTable")), None);
        assert_eq!(names.get(Atom::NONE), None);
    });
}

#[test]
fn only_symbol_names_have_no_atom() {
    with_names(|atoms, names| {
        for name in all_names() {
            let atom = names.atom_of(name);
            assert_eq!(atom.is_none(), table::is_symbol_name(name), "{name:?}");
            if let Some(atom) = atom {
                assert_eq!(atoms.bytes(atom), table::text_of_name(name));
                assert_eq!(names.get(atom), Some(name));
            }
        }
    });
}

#[test]
fn name_outside_table_has_no_atom() {
    with_names(|_, names| {
        assert_eq!(names.atom_of(BuiltinName(BuiltinName::COUNT)), None);
        assert_eq!(names.atom_of(BuiltinName(u32::MAX)), None);
    });
}

#[test]
fn text_name_and_symbol_name_share_text() {
    let text_name = table::find_name(b"iterator").unwrap();
    let symbol_name = table::name_of_symbol(WellKnownSymbol::Iterator);
    assert_ne!(text_name, symbol_name);
    with_names(|atoms, names| {
        assert_eq!(names.get(atoms.intern(b"iterator")), Some(text_name));
        assert_eq!(names.atom_of(symbol_name), None);
    });
}

#[test]
fn symbol_key_spelling() {
    with_names(|atoms, names| {
        let iterator = names.get_symbol_key(atoms.intern(b"$$iterator"));
        assert_eq!(iterator.map(table::text_of_name), Some(&b"iterator"[..]));
        assert_eq!(names.get_symbol_key(atoms.intern(b"$iterator")), None);
        assert_eq!(names.get_symbol_key(atoms.intern(b"iterator")), None);
        assert_eq!(names.get(atoms.intern(b"$$iterator")), None);
    });
}

#[test]
fn other_member_intrinsic_has_no_symbol_key_spelling() {
    let call = table::find_name(b"call").unwrap();
    assert!(table::intrinsic_of(call, IntrinsicPosition::Member).is_some());
    assert!(!is_symbol_key(call));
    with_names(|atoms, names| {
        assert_eq!(names.get_private(atoms.intern(b"$call")), Some(call));
        assert_eq!(names.get_symbol_key(atoms.intern(b"$$call")), None);
    });
}

#[test]
fn intrinsic_names_have_private_spellings() {
    with_names(|atoms, names| {
        for name in table::intrinsic_names() {
            let spelling = [&b"$"[..], table::text_of_name(name)].concat();
            let found = names.get_private(atoms.intern(&spelling));
            assert_eq!(found, Some(name), "{name:?}");
        }
    });
}

#[test]
fn symbol_key_spellings_are_symbol_key_intrinsics() {
    with_names(|atoms, names| {
        for name in table::intrinsic_names() {
            let spelling = [&b"$$"[..], table::text_of_name(name)].concat();
            let found = names.get_symbol_key(atoms.intern(&spelling));
            assert_eq!(found, is_symbol_key(name).then_some(name), "{name:?}");
        }
    });
}
