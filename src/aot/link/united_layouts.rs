use super::grouped::Grouped;
use crate::ir::generated::{Field, FieldFlags, Layout, LayoutFlags, LayoutKind, PositionFlags};
use crate::ir::parallel::map_each;
use crate::ir::{
    DeclaredType, Id, InParallel, LayoutId, Mapped, Primitives, PropertyKeyId, StringId, TypeFlags,
    TypeId, TypeTable, drop_each, for_each_mut,
};
use crate::statistics::{Stage, StepClock};
use bun_sema::util::SharedSort;
use rustc_hash::FxHashMap;

fn unite_positions(first: DeclaredType, other: DeclaredType, ty: TypeId) -> DeclaredType {
    let mapped = match first.is_expected() || other.is_expected() {
        true => Mapped::expected(ty),
        false => Mapped::checked(ty),
    };
    let of_first = first.flags & PositionFlags::IS_DECLARED_BY_DEPENDENCY;
    let mut flags = (first.flags & other.flags).without(PositionFlags::IS_EXPECTED) | of_first;
    if !mapped.is_checked {
        flags = flags.without(PositionFlags::IS_INT32_PROMISE);
    }
    DeclaredType::new(mapped, None, flags)
}

fn unite_said_positions(first: DeclaredType, others: &[DeclaredType], ty: TypeId) -> DeclaredType {
    let mut united = first;
    for &other in others {
        united = unite_positions(united, other, ty);
    }
    united
}

#[derive(Copy, Clone)]
enum UnitedLayout {
    OfProgram(LayoutId),
    View(u32),
}

struct OpenPosition {
    members: Vec<TypeId>,
    if_anything: DeclaredType,
    otherwise: DeclaredType,
}

impl OpenPosition {
    fn new(first: DeclaredType, others: &[DeclaredType]) -> OpenPosition {
        let said = core::iter::once(&first).chain(others);
        let mut members: Vec<TypeId> = said.map(|declared| declared.ty).collect();
        members.sort_unstable();
        members.dedup();
        OpenPosition {
            members,
            if_anything: unite_said_positions(first, others, TypeTable::ANYTHING),
            otherwise: unite_said_positions(first, others, TypeTable::NEVER),
        }
    }

    fn close(&self, ty: TypeId) -> DeclaredType {
        match ty == TypeTable::ANYTHING {
            true => self.if_anything,
            false => DeclaredType {
                ty,
                ..self.otherwise
            },
        }
    }
}

struct OpenField {
    layout: UnitedLayout,
    field: u32,
    position: OpenPosition,
}

struct Unions<'a> {
    types: &'a mut TypeTable,
    known: FxHashMap<Vec<TypeId>, TypeId>,
}

impl Unions<'_> {
    fn unite(&mut self, members: &[TypeId]) -> TypeId {
        if let Some(&ty) = self.known.get(members) {
            return ty;
        }
        let ty = self.types.union_all(members.iter().copied());
        self.known.insert(members.to_vec(), ty);
        ty
    }
}

#[inline]
fn unite_fields(united: &mut Field, other: &Field, said: &mut Vec<DeclaredType>) {
    if other.declared.is_said() {
        said.push(other.declared);
    }
    let flags_that_all_give =
        FieldFlags::IS_REQUIRED | FieldFlags::IS_METHOD | FieldFlags::IS_IMMUTABLE;
    let given_by_all = united.flags & other.flags & flags_that_all_give;
    united.flags = united.flags.without(flags_that_all_give) | given_by_all;
}

#[inline]
fn find_twin<'a>(other: &'a Layout, index: usize, field: &Field) -> Option<&'a Field> {
    let is_twin = |twin: &&Field| (twin.key, twin.computed_key) == (field.key, field.computed_key);
    let at_same_place = other.fields.get(index).filter(is_twin);
    at_same_place.or_else(|| other.fields.iter().find(is_twin))
}

fn unite_layouts(
    united: &mut Layout,
    others: &[&Layout],
    types: &TypeTable,
    leave_open: &mut dyn FnMut(u32, OpenPosition),
) {
    let field_count = united.fields.len();
    debug_assert!(
        others.iter().all(|it| it.fields.len() == field_count),
        "one key is one set of names"
    );
    let mut said: Vec<DeclaredType> = Vec::new();
    for (index, field) in united.fields.iter_mut().enumerate() {
        said.clear();
        if field.declared.is_said() {
            said.push(field.declared);
        }
        for &other in others {
            match find_twin(other, index, field) {
                Some(twin) => unite_fields(field, twin, &mut said),
                None => field.flags = field.flags.without(FieldFlags::IS_REQUIRED),
            }
        }
        if said.iter().any(|declared| !declared.is_inferred()) {
            said.retain(|declared| !declared.is_inferred());
        }
        let Some((&first, rest)) = said.split_first() else {
            continue;
        };
        if rest.iter().all(|other| other.ty == first.ty) {
            field.declared = unite_said_positions(first, rest, first.ty);
            continue;
        }
        let position = OpenPosition::new(first, rest);
        match types.find_union(position.members.iter().copied()) {
            Some(ty) => field.declared = position.close(ty),
            None => leave_open(index as u32, position),
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Literal {
    Integer(i64),
    String(StringId),
}

fn find_only_literal(types: &TypeTable, ty: TypeId) -> Option<Literal> {
    let ty = types.get(ty);
    let nullish = Primitives::UNDEFINED | Primitives::NULL;
    let has_objects = !(ty.layouts.is_empty()
        && ty.classes.is_empty()
        && ty.builtins.is_empty()
        && ty.functions.is_empty());
    if has_objects || ty.is_internal() || !ty.primitives.without(nullish).is_empty() {
        return None;
    }
    match (ty.integer_range(), ty.strings) {
        (Some((minimum, maximum)), []) if ty.flags == TypeFlags::HAS_INTEGERS => {
            (minimum == maximum).then_some(Literal::Integer(minimum))
        }
        (None, &[string]) if ty.flags.is_empty() => Some(Literal::String(string)),
        _ => None,
    }
}

type Literals = Vec<(PropertyKeyId, Literal)>;

fn list_literals(definition: &Layout, types: &TypeTable) -> Literals {
    let checked = definition
        .fields
        .iter()
        .filter(|field| !field.declared.is_expected());
    let mut literals: Literals = checked
        .filter_map(|field| Some((field.key?, find_only_literal(types, field.declared.ty)?)))
        .collect();
    literals.shared_sort_unstable();
    literals
}

fn create_view(above: LayoutId, definition: &Layout) -> Layout {
    Layout {
        kind: definition.kind,
        name: definition.name,
        module: definition.module,
        position: definition.position,
        fields: definition.fields.clone(),
        supertypes: vec![above],
        flags: LayoutFlags::IS_NEVER_ALLOCATED,
        ..Layout::default()
    }
}

#[derive(Default)]
struct UnitedDefinitions {
    views: Vec<Layout>,
    open_fields: Vec<OpenField>,
}

fn collect_views_of_literals(
    id: LayoutId,
    first: &Layout,
    others: &[&Layout],
    types: &TypeTable,
    united: &mut UnitedDefinitions,
) {
    let definitions = core::iter::once(first).chain(others.iter().copied());
    let mut listed: Vec<(Literals, &Layout)> = definitions
        .filter(|definition| {
            definition
                .fields
                .iter()
                .all(|field| field.declared.is_said() && !field.declared.is_inferred())
        })
        .map(|definition| (list_literals(definition, types), definition))
        .collect();
    if listed.iter().all(|(literals, _)| *literals == listed[0].0) {
        return;
    }
    listed.retain(|(literals, _)| !literals.is_empty());
    listed.shared_sort_by(|left, right| left.0.cmp(&right.0));
    for definitions in listed.chunk_by(|left, right| left.0 == right.0) {
        let mut view = create_view(id, definitions[0].1);
        let rest = definitions[1..].iter().map(|&(_, definition)| definition);
        let rest: Vec<&Layout> = rest.collect();
        let layout = UnitedLayout::View(united.views.len() as u32);
        let open_fields = &mut united.open_fields;
        unite_layouts(&mut view, &rest, types, &mut |field, position| {
            open_fields.push(OpenField {
                layout,
                field,
                position,
            });
        });
        united.views.push(view);
    }
}

type Place = (u32, u32);

const LAYOUTS_IN_A_TASK: usize = 1024;
const UNITED_LAYOUTS_IN_A_TASK: usize = if cfg!(test) { 2 } else { 64 };

pub(super) fn unite_layout_definitions(
    layouts: &mut [Layout],
    others: Vec<Vec<(LayoutId, Layout)>>,
    types: &mut TypeTable,
    in_parallel: InParallel<'_>,
) -> Vec<Layout> {
    let mut steps = StepClock::new(Stage::LinkAndEmit);
    let count: usize = others.iter().map(Vec::len).sum();
    let mut places: Vec<Place> = Vec::with_capacity(count);
    let mut defined_layouts: Vec<u32> = Vec::with_capacity(count);
    for (list, definitions) in (0..).zip(&others) {
        for (index, &(id, _)) in (0..).zip(definitions) {
            places.push((list, index));
            defined_layouts.push(id.to_word());
        }
    }
    let places_by_layout = Grouped::new(&places, &defined_layouts, layouts.len());
    if steps.logs() {
        steps.end(&format!("unite: order {count} other definitions"));
    }
    let mut united_layouts: Vec<(LayoutId, &mut Layout, &[Place])> = Vec::new();
    for (index, layout) in layouts.iter_mut().enumerate() {
        let places = places_by_layout.in_group(index);
        if !places.is_empty() {
            united_layouts.push((LayoutId::new(index), layout, places));
        }
    }
    let known_types = &*types;
    let tasks = united_layouts.chunks_mut(UNITED_LAYOUTS_IN_A_TASK);
    let mut united_by_tasks = map_each(tasks.collect(), in_parallel, &|task: &mut [_]| {
        let mut united = UnitedDefinitions::default();
        for (id, layout, places) in task.iter_mut() {
            let id = *id;
            let layout: &mut Layout = layout;
            let definitions: Vec<&Layout> = places
                .iter()
                .map(|&(list, index)| &others[list as usize][index as usize].1)
                .collect();
            collect_views_of_literals(id, layout, &definitions, known_types, &mut united);
            let open_fields = &mut united.open_fields;
            unite_layouts(layout, &definitions, known_types, &mut |field, position| {
                open_fields.push(OpenField {
                    layout: UnitedLayout::OfProgram(id),
                    field,
                    position,
                });
            });
        }
        united
    });
    drop(united_layouts);
    steps.end("unite: definitions");

    let (type_count, mut open_field_count) = (types.len(), 0);
    let mut views = Vec::new();
    let mut unions = Unions {
        types,
        known: FxHashMap::default(),
    };
    for united in &mut united_by_tasks {
        open_field_count += united.open_fields.len();
        for open in &united.open_fields {
            let layout = match open.layout {
                UnitedLayout::OfProgram(id) => &mut layouts[id.index()],
                UnitedLayout::View(place) => &mut united.views[place as usize],
            };
            let ty = unions.unite(&open.position.members);
            layout.fields[open.field as usize].declared = open.position.close(ty);
        }
        views.append(&mut united.views);
    }
    if steps.logs() {
        let added = unions.types.len() - type_count;
        steps.end(&format!(
            "unite: {open_field_count} fields of types without a union, which add {added} types; {} views",
            views.len()
        ));
    }
    let mut tasks: Vec<&mut [Layout]> = layouts.chunks_mut(LAYOUTS_IN_A_TASK).collect();
    for_each_mut(&mut tasks, in_parallel, &|task| {
        let records = task
            .iter_mut()
            .filter(|layout| layout.kind == LayoutKind::Record);
        for field in records.flat_map(|layout| &mut layout.fields) {
            let DeclaredType { ty, flags, .. } = field.declared;
            let is_inferred = flags.contains(PositionFlags::IS_FROM_COMPILER);
            if !field.declared.is_said() || (is_inferred && ty == TypeTable::ANYTHING) {
                field.declared = DeclaredType::untyped();
            }
        }
    });
    drop_each(others, in_parallel);
    drop_each(united_by_tasks, in_parallel);
    steps.end("unite: fields that nothing says, drop the other definitions");
    views
}

fn is_maker(layout: &Layout) -> bool {
    layout.kind == LayoutKind::Instance
        && layout.constructor.is_some()
        && !layout.flags.contains(LayoutFlags::HAS_HERITAGE)
}

fn find_types_of_made_objects(layouts: &[Layout]) -> Vec<bool> {
    let mut starts = vec![0u32; layouts.len() + 2];
    for supertype in layouts.iter().flat_map(|layout| &layout.supertypes) {
        starts[supertype.index() + 2] += 1;
    }
    for index in 2..starts.len() {
        starts[index] += starts[index - 1];
    }
    let mut below = vec![LayoutId::new(0); starts[layouts.len() + 1] as usize];
    for (index, layout) in layouts.iter().enumerate() {
        for supertype in &layout.supertypes {
            let place = &mut starts[supertype.index() + 1];
            below[*place as usize] = LayoutId::new(index);
            *place += 1;
        }
    }
    let makers = layouts.iter().filter(|layout| is_maker(layout));
    let mut worklist: Vec<LayoutId> = makers
        .flat_map(|maker| maker.supertypes.iter().copied())
        .collect();
    let mut is_found = vec![false; layouts.len()];
    while let Some(layout) = worklist.pop() {
        if !core::mem::replace(&mut is_found[layout.index()], true) {
            let (start, end) = (starts[layout.index()], starts[layout.index() + 1]);
            worklist.extend_from_slice(&below[start as usize..end as usize]);
        }
    }
    is_found
}

pub(super) fn add_views_of_literals(layouts: &mut Vec<Layout>, views: Vec<Layout>) {
    if views.is_empty() {
        return;
    }
    let is_type_of_made_objects = find_types_of_made_objects(layouts);
    for mut view in views {
        let above = &layouts[view.supertypes[0].index()];
        if !is_type_of_made_objects[view.supertypes[0].index()] {
            continue;
        }
        for (index, field) in view.fields.iter_mut().enumerate() {
            let twin = find_twin(above, index, field);
            if twin.is_some_and(|twin| twin.flags.contains(FieldFlags::IS_NEVER_WRITTEN)) {
                field.flags = field.flags.without(FieldFlags::IS_REQUIRED);
                field.flags |= FieldFlags::IS_NEVER_WRITTEN;
            }
        }
        layouts.push(view);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::{FunctionId, PropertyKeyId, StringId, Type};
    use crate::link::testing::{
        forward, link_sources_without_bun_modules, reverse, test_class_key, test_object_type_key,
    };

    fn field(key: usize, declared: DeclaredType, flags: FieldFlags) -> Field {
        Field {
            key: Some(PropertyKeyId::new(key)),
            declared,
            flags,
            ..Field::default()
        }
    }

    fn checked(ty: TypeId) -> DeclaredType {
        DeclaredType::new(Mapped::checked(ty), None, PositionFlags::default())
    }

    fn layout(name: Option<usize>, fields: Vec<Field>) -> Layout {
        Layout {
            name: name.map(StringId::new),
            fields,
            ..Layout::default()
        }
    }

    fn holder_of(declared: DeclaredType) -> Layout {
        layout(None, vec![field(0, declared, FieldFlags::default())])
    }

    fn unite(first: Layout, others: Vec<Layout>) -> (Layout, TypeTable) {
        let mut types = TypeTable::new();
        let mut layouts = vec![first];
        let others = others.into_iter().map(|other| (LayoutId::new(0), other));
        unite_layout_definitions(&mut layouts, vec![others.collect()], &mut types, &reverse);
        (layouts.remove(0), types)
    }

    fn maker_of(ty: usize) -> Layout {
        Layout {
            kind: LayoutKind::Instance,
            constructor: Some(FunctionId::new(0)),
            supertypes: vec![LayoutId::new(ty)],
            ..Layout::default()
        }
    }

    fn unite_with_views(first: Layout, others: Vec<Layout>, types: &mut TypeTable) -> Vec<Layout> {
        let mut layouts = vec![first, maker_of(0)];
        let others = others.into_iter().map(|other| (LayoutId::new(0), other));
        let views = unite_layout_definitions(&mut layouts, vec![others.collect()], types, &reverse);
        add_views_of_literals(&mut layouts, views);
        layouts.remove(1);
        layouts
    }

    fn tagged(name: usize, tag: TypeId) -> Layout {
        let required = FieldFlags::IS_REQUIRED;
        let fields = vec![
            field(0, checked(tag), required),
            field(1, checked(TypeTable::STRING), required),
        ];
        layout(Some(name), fields)
    }

    #[test]
    fn open_position_closes_as_its_definitions_unite() {
        let say_in_each_way = |ty: TypeId| {
            let of_dependency = PositionFlags::IS_DECLARED_BY_DEPENDENCY;
            [
                checked(ty),
                DeclaredType::new(Mapped::checked(ty), None, PositionFlags::IS_INT32_PROMISE),
                DeclaredType::new(Mapped::checked(ty), None, of_dependency),
                DeclaredType::new(Mapped::expected(ty), None, PositionFlags::default()),
                DeclaredType::new(Mapped::expected(ty), None, of_dependency),
            ]
        };
        for first in say_in_each_way(TypeTable::STRING) {
            for second in say_in_each_way(TypeTable::INT32) {
                for third in say_in_each_way(TypeTable::STRING) {
                    let others = [second, third];
                    let position = OpenPosition::new(first, &others);
                    assert_eq!(position.members, [TypeTable::INT32, TypeTable::STRING]);
                    for ty in [TypeTable::ANYTHING, TypeTable::OBJECT, TypeTable::NEVER] {
                        let united = unite_said_positions(first, &others, ty);
                        assert_eq!(position.close(ty), united);
                    }
                }
            }
        }
    }

    #[test]
    fn definitions_with_different_literals_stay_as_views_below_the_layout() {
        let mut types = TypeTable::new();
        let integer = |types: &mut TypeTable, value| types.intern(Type::integers(value, value));
        let (one, five) = (integer(&mut types, 1), integer(&mut types, 5));
        let definitions = vec![tagged(11, five), tagged(12, one)];
        let layouts = unite_with_views(tagged(10, one), definitions, &mut types);
        assert_eq!(layouts.len(), 3);
        assert_eq!(
            types.get(layouts[0].fields[0].declared.ty),
            Type::integers(1, 5)
        );
        for (view, (name, tag)) in layouts[1..].iter().zip([(10, one), (11, five)]) {
            assert_eq!(view.name, Some(StringId::new(name)));
            assert_eq!(view.fields[0].declared, checked(tag));
            assert_eq!(view.fields[1].declared, checked(TypeTable::STRING));
            assert_eq!(view.supertypes, vec![LayoutId::new(0)]);
            assert_eq!(view.flags, LayoutFlags::IS_NEVER_ALLOCATED);
        }
    }

    #[test]
    fn definitions_with_one_literal_need_no_view() {
        let mut types = TypeTable::new();
        let one = types.intern(Type::integers(1, 1));
        let layouts = unite_with_views(tagged(10, one), vec![tagged(11, one)], &mut types);
        assert_eq!(layouts.len(), 1);
        let plain = || tagged(10, TypeTable::NUMBER);
        assert_eq!(
            unite_with_views(plain(), vec![plain()], &mut types).len(),
            1
        );
    }

    #[test]
    fn literal_beside_wider_type_stays_as_view() {
        let mut types = TypeTable::new();
        let text = types.intern(Type::string_literal(StringId::new(7)));
        let wide = tagged(10, TypeTable::STRING);
        let layouts = unite_with_views(wide, vec![tagged(11, text)], &mut types);
        assert_eq!(layouts.len(), 2);
        assert_eq!(layouts[1].name, Some(StringId::new(11)));
        assert_eq!(layouts[1].fields[0].declared, checked(text));
    }

    #[test]
    fn view_has_union_of_types_of_the_definitions_with_its_literals() {
        let mut types = TypeTable::new();
        let integer = |types: &mut TypeTable, value| types.intern(Type::integers(value, value));
        let (one, five) = (integer(&mut types, 1), integer(&mut types, 5));
        let mut with_number = tagged(11, one);
        with_number.fields[1].declared = checked(TypeTable::NUMBER);
        let definitions = vec![with_number, tagged(12, five)];
        let layouts = unite_with_views(tagged(10, one), definitions, &mut types);
        assert_eq!(layouts.len(), 3);
        let either = types.union(TypeTable::STRING, TypeTable::NUMBER);
        assert_eq!(layouts[1].fields[0].declared, checked(one));
        assert_eq!(layouts[1].fields[1].declared, checked(either));
        assert_eq!(layouts[2].fields[1].declared, checked(TypeTable::STRING));
    }

    #[test]
    fn view_takes_over_that_a_name_is_never_written() {
        let mut types = TypeTable::new();
        let integer = |types: &mut TypeTable, value| types.intern(Type::integers(value, value));
        let (one, five) = (integer(&mut types, 1), integer(&mut types, 5));
        let mut layouts = vec![tagged(10, one), maker_of(0)];
        let others = vec![(LayoutId::new(0), tagged(11, five))];
        let views = unite_layout_definitions(&mut layouts, vec![others], &mut types, &reverse);
        layouts[0].fields[1].flags = FieldFlags::IS_NEVER_WRITTEN;
        add_views_of_literals(&mut layouts, views);
        assert_eq!(layouts[2].fields[0].flags, FieldFlags::IS_REQUIRED);
        assert_eq!(layouts[2].fields[1].flags, FieldFlags::IS_NEVER_WRITTEN);
    }

    #[test]
    fn views_stay_only_below_the_types_of_the_objects_of_a_maker() {
        let mut types = TypeTable::new();
        let integer = |types: &mut TypeTable, value| types.intern(Type::integers(value, value));
        let (one, five) = (integer(&mut types, 1), integer(&mut types, 5));
        let mut count_with = |above: Vec<LayoutId>, last: Layout| {
            let mut shared = tagged(10, one);
            shared.supertypes = above;
            let mut layouts = vec![shared, layout(Some(12), Vec::new()), last];
            let others = vec![(LayoutId::new(0), tagged(11, five))];
            let views = unite_layout_definitions(&mut layouts, vec![others], &mut types, &reverse);
            assert_eq!(views.len(), 2);
            add_views_of_literals(&mut layouts, views);
            layouts.len() - 3
        };
        let base = || vec![LayoutId::new(1)];
        assert_eq!(count_with(base(), maker_of(1)), 2);
        assert_eq!(count_with(Vec::new(), maker_of(1)), 0);
        assert_eq!(count_with(base(), layout(Some(13), Vec::new())), 0);
        let mut heir = maker_of(1);
        heir.flags |= LayoutFlags::HAS_HERITAGE;
        assert_eq!(count_with(base(), heir), 0);
    }

    #[test]
    fn only_plain_object_without_home_has_united_definitions() {
        assert!(test_object_type_key(1).has_united_definitions());
        assert!(!test_class_key(0, 0).has_united_definitions());
    }

    #[test]
    fn union_that_the_table_has_is_found_and_adds_nothing() {
        let mut types = TypeTable::new();
        let either = types.union(TypeTable::STRING, TypeTable::NUMBER);
        let count = types.len();
        let mut layouts = vec![
            holder_of(checked(TypeTable::STRING)),
            holder_of(checked(TypeTable::STRING)),
        ];
        let others = vec![
            (LayoutId::new(0), holder_of(checked(TypeTable::NUMBER))),
            (LayoutId::new(1), holder_of(checked(TypeTable::BOOLEAN))),
        ];
        unite_layout_definitions(&mut layouts, vec![others], &mut types, &reverse);
        assert_eq!(layouts[0].fields[0].declared, checked(either));
        assert_eq!(layouts[1].fields[0].declared.ty.index(), count);
        assert_eq!(types.len(), count + 1);
    }

    #[test]
    fn field_has_union_of_types() {
        let all = FieldFlags::IS_REQUIRED;
        let first = layout(None, vec![field(0, checked(TypeTable::STRING), all)]);
        let second = layout(None, vec![field(0, checked(TypeTable::NUMBER), all)]);
        let (united, mut types) = unite(first, vec![second]);
        let declared = united.fields[0].declared;
        assert_eq!(
            declared.ty,
            types.union(TypeTable::STRING, TypeTable::NUMBER)
        );
        assert!(!declared.is_expected());
        assert_eq!(united.fields[0].flags, all);
    }

    #[test]
    fn many_definitions_of_a_field_add_one_type_to_the_table() {
        let mut types = TypeTable::new();
        let functions: Vec<TypeId> = (0..5)
            .map(|function| types.intern(Type::function(FunctionId::new(function))))
            .collect();
        let mut layouts = vec![holder_of(checked(functions[0]))];
        let others = functions[1..].iter();
        let others = others.map(|&ty| (LayoutId::new(0), holder_of(checked(ty))));
        let count = types.len();
        unite_layout_definitions(&mut layouts, vec![others.collect()], &mut types, &reverse);
        assert_eq!(types.len(), count + 1);
        let declared = layouts[0].fields[0].declared;
        assert_eq!(declared.ty, types.union_all(functions));
    }

    #[test]
    fn table_grows_in_the_order_of_the_layouts() {
        let mut types = TypeTable::new();
        let holder = |ty| holder_of(checked(ty));
        let mut layouts = vec![holder(TypeTable::STRING), holder(TypeTable::STRING)];
        let others = vec![
            vec![(LayoutId::new(1), holder(TypeTable::BOOLEAN))],
            vec![(LayoutId::new(0), holder(TypeTable::NUMBER))],
        ];
        unite_layout_definitions(&mut layouts, others, &mut types, &reverse);
        let [first, second] = [0, 1].map(|index: usize| layouts[index].fields[0].declared.ty);
        assert!(first < second);
    }

    #[test]
    fn table_does_not_depend_on_the_order_of_the_tasks() {
        let count = UNITED_LAYOUTS_IN_A_TASK * 3 + 1;
        let unite_all = |in_parallel: InParallel<'_>| {
            let mut types = TypeTable::new();
            let functions: Vec<TypeId> = (0..count)
                .map(|function| types.intern(Type::function(FunctionId::new(function))))
                .collect();
            let holders = functions.iter().map(|&ty| holder_of(checked(ty)));
            let mut layouts: Vec<Layout> = holders.collect();
            let others = (0..count).rev().map(|index| {
                let ty = functions[index - index % 2];
                (LayoutId::new(index), holder_of(checked(ty)))
            });
            let known = types.len();
            unite_layout_definitions(
                &mut layouts,
                vec![others.collect()],
                &mut types,
                in_parallel,
            );
            let said: Vec<TypeId> = layouts
                .iter()
                .map(|layout| layout.fields[0].declared.ty)
                .collect();
            (said, types.types().skip(known).to_records())
        };
        let (said, added) = unite_all(&forward);
        assert_eq!(added.len(), count / 2);
        let added_ids = said.iter().skip(1).step_by(2);
        assert!(added_ids.is_sorted_by(|left, right| left < right));
        assert_eq!(unite_all(&reverse), (said, added));
    }

    #[test]
    fn flag_stays_only_if_every_definition_gives_it() {
        let method = FieldFlags::IS_REQUIRED | FieldFlags::IS_METHOD | FieldFlags::IS_IMMUTABLE;
        let declared = checked(TypeTable::STRING);
        let first = layout(
            None,
            vec![field(0, declared, method), field(1, declared, method)],
        );
        let plain = FieldFlags::IS_METHOD;
        let second = layout(
            None,
            vec![field(0, declared, method), field(1, declared, plain)],
        );
        let (united, _) = unite(first, vec![second]);
        assert_eq!(united.fields[0].flags, method);
        assert_eq!(united.fields[1].flags, FieldFlags::IS_METHOD);
    }

    #[test]
    fn expected_position_of_one_definition_makes_field_expected() {
        let promise = PositionFlags::IS_INT32_PROMISE;
        let promised = DeclaredType::new(Mapped::checked(TypeTable::INT32), None, promise);
        let expected = DeclaredType::new(
            Mapped::expected(TypeTable::INT32),
            None,
            PositionFlags::default(),
        );
        let (united, _) = unite(holder_of(promised), vec![holder_of(promised)]);
        assert_eq!(united.fields[0].declared, promised);
        let (united, _) = unite(holder_of(promised), vec![holder_of(expected)]);
        assert_eq!(united.fields[0].declared, expected);
    }

    #[test]
    fn first_definition_says_whether_a_dependency_declares_the_field() {
        let promise = PositionFlags::IS_INT32_PROMISE;
        let promised = |flags| DeclaredType::new(Mapped::checked(TypeTable::INT32), None, flags);
        let own = promised(promise);
        let foreign = promised(promise | PositionFlags::IS_DECLARED_BY_DEPENDENCY);
        let (united, _) = unite(holder_of(foreign), vec![holder_of(own)]);
        assert_eq!(united.fields[0].declared, foreign);
        let (united, _) = unite(holder_of(own), vec![holder_of(foreign)]);
        assert_eq!(united.fields[0].declared, own);
    }

    #[test]
    fn untyped_position_of_one_definition_makes_field_untyped() {
        let first = holder_of(checked(TypeTable::STRING));
        let (united, _) = unite(first, vec![holder_of(DeclaredType::untyped())]);
        assert_eq!(united.fields[0].declared, DeclaredType::untyped());
    }

    #[test]
    fn definition_that_says_no_type_leaves_what_the_others_say() {
        let (string, unsaid) = (checked(TypeTable::STRING), DeclaredType::unsaid());
        let others = vec![holder_of(string), holder_of(unsaid)];
        let (united, _) = unite(holder_of(unsaid), others);
        assert_eq!(united.fields[0].declared, string);
        let (united, _) = unite(holder_of(unsaid), vec![holder_of(unsaid)]);
        assert_eq!(united.fields[0].declared, DeclaredType::untyped());
    }

    #[test]
    fn inferred_yields_to_written_type() {
        let inferred = |ty: TypeId| checked(ty).inferred();
        let (string, number) = (TypeTable::STRING, TypeTable::NUMBER);
        let written = vec![holder_of(checked(string))];
        let (united, _) = unite(holder_of(inferred(number)), written);
        assert_eq!(united.fields[0].declared, checked(string));
        let unsaid = holder_of(DeclaredType::unsaid());
        let others = vec![holder_of(inferred(number)), holder_of(inferred(string))];
        let (united, types) = unite(unsaid.clone(), others);
        let either = united.fields[0].declared;
        assert!(either.is_inferred());
        let union = types.find_union([number, string].into_iter());
        assert_eq!(union, Some(either.ty));
        let anything = holder_of(inferred(TypeTable::ANYTHING));
        let (united, _) = unite(unsaid, vec![anything, holder_of(inferred(number))]);
        assert_eq!(united.fields[0].declared, DeclaredType::untyped());
    }

    #[test]
    fn literal_fields_have_inferred_types() {
        const SOURCE: &str = r#"
interface Written { width: number | null }
export function make(k: number) { return { left: k, open: k > 2, title: "t" + k, run() {} }; }
export function makeWritten(): Written { return { width: 1 }; }
export function makeOther(k: number) { return { width: k }; }
"#;
        let linked = link_sources_without_bun_modules(&[("main.ts", SOURCE)]);
        let program = linked.expect("the program links").program;
        let declared = |name: &str| {
            let has_name = |key: PropertyKeyId| {
                let text = program.property_keys.get(key).text;
                text.is_some_and(|id| program.strings.get(id) == name.as_bytes())
            };
            let mut fields = program.layouts.iter().flat_map(|layout| &layout.fields);
            let field = fields.find(|field| field.key.is_some_and(has_name));
            field.expect(name).declared
        };
        assert_eq!(declared("left"), checked(TypeTable::NUMBER).inferred());
        assert!(declared("title").is_inferred());
        assert!(declared("open").is_inferred());
        assert_eq!(declared("run"), DeclaredType::untyped());
        assert!(!declared("width").is_inferred());
    }

    #[test]
    fn fields_are_matched_by_key() {
        let flags = FieldFlags::default();
        let (string, number) = (checked(TypeTable::STRING), checked(TypeTable::NUMBER));
        let first = layout(None, vec![field(0, string, flags), field(1, number, flags)]);
        let second = layout(None, vec![field(1, number, flags), field(0, string, flags)]);
        let (united, _) = unite(first.clone(), vec![second]);
        assert_eq!(united, first);
    }

    #[test]
    fn name_of_first_definition_stays() {
        let named = |name| layout(name, Vec::new());
        let first = Some(StringId::new(1));
        assert_eq!(unite(named(Some(1)), vec![named(Some(1))]).0.name, first);
        assert_eq!(unite(named(Some(1)), vec![named(Some(2))]).0.name, first);
        assert_eq!(
            unite(named(Some(1)), vec![named(None), named(Some(1))])
                .0
                .name,
            first
        );
        assert_eq!(unite(named(None), vec![named(Some(1))]).0.name, None);
    }

    #[test]
    fn definition_that_is_said_again_changes_nothing() {
        let unite_copies = |others: &[usize]| {
            let mut types = TypeTable::new();
            let either = types.union(TypeTable::STRING, TypeTable::NUMBER);
            let all = FieldFlags::IS_REQUIRED | FieldFlags::IS_METHOD;
            let definitions = [
                layout(Some(1), vec![field(0, checked(TypeTable::STRING), all)]),
                layout(
                    Some(2),
                    vec![field(0, checked(either), FieldFlags::IS_METHOD)],
                ),
            ];
            let mut layouts = vec![definitions[0].clone()];
            let others = others
                .iter()
                .map(|&other| (LayoutId::new(0), definitions[other].clone()));
            unite_layout_definitions(&mut layouts, vec![others.collect()], &mut types, &reverse);
            (layouts.remove(0), types.len())
        };
        let once = unite_copies(&[1]);
        assert_eq!(unite_copies(&[1, 1, 1]), once);
        assert_eq!(unite_copies(&[0, 1, 0, 1]), once);
    }
}
