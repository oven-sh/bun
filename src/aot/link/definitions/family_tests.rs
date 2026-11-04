use super::tests::choose_in_reverse;
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

fn close<'a, const COUNT: usize>(
    projects: &Projects<'a, '_>,
    fragments: [FragmentBuilder; COUNT],
) -> Prepared<'a> {
    let units = fragments.map(|fragment| finish_unit(projects, fragment));
    prepare(units.into(), projects)
}

fn merged(prepared: &Prepared<'_>, identity: u64) -> u32 {
    let key = in_application(test_object_type_key(identity));
    prepared
        .layouts
        .find(&key)
        .expect("a unit declares the layout")
}

fn identity_of(prepared: &Prepared<'_>, layout: u32) -> u64 {
    match prepared.layouts.keys[layout as usize].key {
        LayoutKey::ObjectType { instantiation, .. } => instantiation.0[0],
        other => panic!("{other:?}"),
    }
}

fn supertypes_in(edges: &SupertypeEdges, prepared: &Prepared<'_>, identity: u64) -> Vec<u64> {
    let supertypes = edges.of(merged(prepared, identity)).iter();
    let mut identities: Vec<u64> = supertypes
        .map(|&supertype| identity_of(prepared, supertype))
        .collect();
    identities.sort_unstable();
    identities
}

fn supertypes_of(prepared: &Prepared<'_>, identity: u64) -> Vec<u64> {
    supertypes_in(&prepared.definitions.supertypes, prepared, identity)
}

fn convert(fragment: &mut FragmentBuilder, source: u64, targets: &[u64]) {
    let source = layout(fragment, source);
    let targets = targets.iter().map(|&target| layout(fragment, target));
    let mut layouts: Vec<LayoutId> = targets.collect();
    layouts.sort_unstable();
    let source = fragment.types.intern(Type::layout(source));
    let target = fragment.types.intern(Type {
        layouts,
        ..Type::default()
    });
    fragment.family_facts.record_conversion(source, target);
}

#[test]
fn members_without_layout_are_members_of_the_types_above() {
    with_test_files(|projects, [main, ..]| {
        let mut fragment = FragmentBuilder::alone(main);
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
fn conversion_outside_the_family_widens_it() {
    with_test_files(|projects, [main, ..]| {
        let mut fragment = FragmentBuilder::alone(main);
        add_supertype(&mut fragment, 1, 3);
        add_supertype(&mut fragment, 3, 2);
        let [inside, outside, target] = [1, 5, 2].map(|identity| {
            let layout = layout(&mut fragment, identity);
            fragment.types.intern(Type::layout(layout))
        });
        fragment.family_facts.record_conversion(inside, target);
        fragment.family_facts.record_conversion(outside, target);

        let prepared = close(projects, [fragment]);

        assert_eq!(supertypes_of(&prepared, 5), [2]);
        assert_eq!(supertypes_of(&prepared, 1), [3]);
    });
}

// Whether a conversion adds an edge hangs on those before it.
#[test]
fn conversions_are_followed_in_the_order_of_the_units_whichever_task_lists_them() {
    with_test_files(|projects, mut files| {
        files.sort_unstable();
        let [mut first, mut second, mut third] = files.map(FragmentBuilder::alone);
        convert(&mut first, 1, &[2]);
        convert(&mut second, 1, &[2]);
        convert(&mut second, 1, &[2, 3]);
        convert(&mut second, 5, &[2]);
        convert(&mut third, 5, &[2, 3]);
        convert(&mut third, 4, &[2, 3]);
        convert(&mut third, 4, &[2]);

        let prepared = close(projects, [first, second, third]);

        assert!(
            prepared.units.len() > UNITS_IN_A_TASK,
            "a task lists them all"
        );
        let reversed = choose_in_reverse(&prepared, projects);
        for edges in [&prepared.definitions.supertypes, &reversed.supertypes] {
            assert_eq!(supertypes_in(edges, &prepared, 1), [2]);
            assert_eq!(supertypes_in(edges, &prepared, 5), [2]);
            assert_eq!(supertypes_in(edges, &prepared, 4), [2, 3]);
        }
    });
}
