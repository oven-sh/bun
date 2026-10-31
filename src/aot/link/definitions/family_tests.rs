use super::*;
use crate::ir::Type;
use crate::link::testing::{
    Prepared, Projects, finish_unit, in_application, prepare, test_object_type_key, with_test_files,
};
use crate::lower::FragmentBuilder;

fn layout(fragment: &mut FragmentBuilder, identity: u64) -> LayoutId {
    fragment.declare_layout(test_object_type_key(identity))
}

fn add_supertype(fragment: &mut FragmentBuilder, below: u64, above: u64) {
    let (below, above) = (layout(fragment, below), layout(fragment, above));
    fragment.add_supertype(below, above);
}

fn close<const COUNT: usize>(
    projects: &Projects<'_, '_>,
    fragments: [FragmentBuilder; COUNT],
) -> Prepared {
    let units = fragments.map(|fragment| finish_unit(projects, fragment));
    let prepared = prepare(units.into(), projects);
    assert!(prepared.errors.is_empty(), "{:?}", prepared.errors);
    prepared
}

fn merged(prepared: &Prepared, identity: u64) -> u32 {
    let key = in_application(test_object_type_key(identity));
    prepared
        .layouts
        .find(&key)
        .expect("a unit declares the layout")
}

fn identity_of(prepared: &Prepared, layout: u32) -> u64 {
    match prepared.layouts.keys[layout as usize].key {
        LayoutKey::ObjectType { instantiation, .. } => instantiation.0[0],
        other => panic!("{other:?}"),
    }
}

fn supertypes_of(prepared: &Prepared, identity: u64) -> Vec<u64> {
    let supertypes = prepared
        .definitions
        .supertypes
        .of(merged(prepared, identity))
        .iter();
    let mut identities: Vec<u64> = supertypes
        .map(|&supertype| identity_of(prepared, supertype))
        .collect();
    identities.sort_unstable();
    identities
}

#[test]
fn members_without_layout_are_members_of_the_types_above() {
    with_test_files(|projects, [main, ..]| {
        let mut fragment = FragmentBuilder::new(main);
        add_supertype(&mut fragment, 1, 2);
        add_supertype(&mut fragment, 2, 3);
        add_supertype(&mut fragment, 4, 1);
        let open = layout(&mut fragment, 1);
        fragment.family_facts.add_member_without_layout(open);

        let prepared = close(projects, [fragment]);

        let flags = &prepared.definitions.has_members_without_layout;
        let is_open = |identity| flags[merged(&prepared, identity) as usize];
        assert_eq!([1, 2, 3, 4].map(is_open), [true, true, true, false]);
    });
}

#[test]
fn conversion_outside_the_family_widens_it_and_is_counted() {
    with_test_files(|projects, [main, ..]| {
        let mut fragment = FragmentBuilder::new(main);
        add_supertype(&mut fragment, 1, 3);
        add_supertype(&mut fragment, 3, 2);
        let [inside, outside, target] = [1, 5, 2].map(|identity| {
            let layout = layout(&mut fragment, identity);
            fragment.types.intern(Type::layout(layout))
        });
        fragment.family_facts.record_conversion(inside, target);
        fragment.family_facts.record_conversion(outside, target);

        let prepared = close(projects, [fragment]);

        let widened = [(merged(&prepared, 5), merged(&prepared, 2))];
        assert_eq!(prepared.definitions.conversions_outside_family, widened);
        assert_eq!(supertypes_of(&prepared, 5), [2]);
        assert_eq!(supertypes_of(&prepared, 1), [3]);
    });
}
