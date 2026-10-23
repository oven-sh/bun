use crate::ir::generated::{Field, FieldFlags, Layout, LayoutFlags, LayoutKind, PositionFlags};
use crate::ir::{
    DeclaredType, Id, InParallel, LayoutId, LayoutKey, Mapped, Primitives, PropertyKeyId, StringId,
    Type, TypeFlags, TypeId, TypeTable, drop_each, for_each_mut,
};
use bun_sema::check::aot::ObjectOrigin;
use bun_sema::util::SharedSort;
use rustc_hash::{FxHashMap, FxHashSet};

// The layout of a plain object belongs to no file.
pub(super) fn has_united_definitions(key: &LayoutKey) -> bool {
    matches!(
        key,
        LayoutKey::ObjectType {
            origin: ObjectOrigin::Computed,
            ..
        }
    )
}

const FLAGS_THAT_ALL_GIVE: FieldFlags =
    FieldFlags(FieldFlags::IS_REQUIRED.0 | FieldFlags::IS_METHOD.0 | FieldFlags::IS_IMMUTABLE.0);

// Many files define a layout with the same few types.
struct Unions<'a> {
    types: &'a mut TypeTable,
    known: FxHashMap<(TypeId, TypeId), TypeId>,
}

impl Unions<'_> {
    fn union(&mut self, left: TypeId, right: TypeId) -> TypeId {
        if left == right {
            return left;
        }
        let types = &mut *self.types;
        *self
            .known
            .entry((left, right))
            .or_insert_with(|| types.union(left, right))
    }
}

// `ty` holds what either holds.
fn unite_positions(first: DeclaredType, other: DeclaredType, ty: TypeId) -> DeclaredType {
    // Nothing tests a store into a position that is only expected, so its slot proves nothing.
    let mapped = match first.is_expected() || other.is_expected() {
        true => Mapped::expected(ty),
        false => Mapped::checked(ty),
    };
    // The site is the first's, and so is who can mend it.
    let of_site = first.flags & PositionFlags::IS_DECLARED_BY_DEPENDENCY;
    let mut flags = (first.flags & other.flags).without(PositionFlags::IS_EXPECTED) | of_site;
    if !mapped.is_checked {
        flags = flags.without(PositionFlags::IS_INT32_PROMISE);
    }
    DeclaredType::new(mapped, first.site, flags)
}

// What one more definition says that a field holds, where that is another type than the definitions before it gave.
struct WaitingPosition {
    // 0 is the layout, and `n` its view `n - 1`.
    record: u32,
    field: u32,
    declared: DeclaredType,
}

// The definitions of one record, while they are united without the table of types.
struct Uniting<'a> {
    record: u32,
    // By field. What comes behind a position that waits has to wait too.
    is_waiting: Vec<bool>,
    // What the positions of a field with one that waits have said.
    said: FxHashSet<(u32, TypeId, PositionFlags)>,
    waiting: &'a mut Vec<WaitingPosition>,
}

impl<'a> Uniting<'a> {
    fn new(record: u32, fields: &[Field], waiting: &'a mut Vec<WaitingPosition>) -> Uniting<'a> {
        Uniting {
            record,
            is_waiting: vec![false; fields.len()],
            said: FxHashSet::default(),
            waiting,
        }
    }
}

fn unite_fields(united: &mut Field, other: &Field, index: usize, uniting: &mut Uniting<'_>) {
    let (first, declared) = (united.declared, other.declared);
    match (first.is_said(), declared.is_said()) {
        (true, true) if uniting.is_waiting[index] || first.ty != declared.ty => {
            let field = index as u32;
            if !core::mem::replace(&mut uniting.is_waiting[index], true) {
                uniting.said.insert((field, first.ty, first.flags));
            }
            if uniting.said.insert((field, declared.ty, declared.flags)) {
                uniting.waiting.push(WaitingPosition {
                    record: uniting.record,
                    field,
                    declared,
                });
            }
        }
        (true, true) => united.declared = unite_positions(first, declared, first.ty),
        (true, false) => {}
        (false, _) => united.declared = declared,
    }
    let given_by_all = united.flags & other.flags & FLAGS_THAT_ALL_GIVE;
    united.flags = united.flags.without(FLAGS_THAT_ALL_GIVE) | given_by_all;
}

fn find_twin<'a>(other: &'a Layout, index: usize, field: &Field) -> Option<&'a Field> {
    let is_twin = |twin: &&Field| (twin.key, twin.computed_key) == (field.key, field.computed_key);
    let at_same_place = other.fields.get(index).filter(is_twin);
    at_same_place.or_else(|| other.fields.iter().find(is_twin))
}

// The layout is shown under the name, and at the place, of its first definition.
fn unite_layouts(united: &mut Layout, other: &Layout, uniting: &mut Uniting<'_>) {
    debug_assert_eq!(
        united.fields.len(),
        other.fields.len(),
        "one key is one set of names"
    );
    for (index, field) in united.fields.iter_mut().enumerate() {
        match find_twin(other, index, field) {
            Some(twin) => unite_fields(field, twin, index, uniting),
            None => field.flags = field.flags.without(FieldFlags::IS_REQUIRED),
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Literal {
    Integer(i64),
    String(StringId),
}

// `undefined` and `null` are members of every type that holds a reference, so also of the type of one string.
fn find_only_literal(ty: &Type) -> Option<Literal> {
    let nullish = Primitives::UNDEFINED | Primitives::NULL;
    let has_objects = !(ty.layouts.is_empty()
        && ty.classes.is_empty()
        && ty.builtins.is_empty()
        && ty.functions.is_empty());
    if has_objects || ty.is_internal() || !ty.primitives.without(nullish).is_empty() {
        return None;
    }
    match (ty.integer_range(), ty.strings.as_slice()) {
        (Some((minimum, maximum)), []) if ty.flags == TypeFlags::HAS_INTEGERS => {
            (minimum == maximum).then_some(Literal::Integer(minimum))
        }
        (None, &[string]) if ty.flags.is_empty() => Some(Literal::String(string)),
        _ => None,
    }
}

type Literals = Vec<(PropertyKeyId, Literal)>;

fn says_what_fields_hold(definition: &Layout) -> bool {
    definition
        .fields
        .iter()
        .all(|field| field.declared.is_said())
}

fn list_literals(definition: &Layout, types: &TypeTable) -> Literals {
    let checked = definition
        .fields
        .iter()
        .filter(|field| !field.declared.is_expected());
    let mut literals: Literals = checked
        .filter_map(|field| Some((field.key?, find_only_literal(types.get(field.declared.ty))?)))
        .collect();
    literals.shared_sort_unstable();
    literals
}

fn create_view(above: LayoutId, definition: &Layout) -> Layout {
    let mut view = Layout {
        kind: definition.kind,
        name: definition.name,
        module: definition.module,
        position: definition.position,
        fields: definition.fields.clone(),
        supertypes: vec![above],
        flags: LayoutFlags::IS_NEVER_ALLOCATED,
        ..Layout::default()
    };
    for field in &mut view.fields {
        field.declared.site = None;
    }
    view
}

// What `{ kind: 1; a: A }` and `{ kind: 5; a: A }` declare together is `kind: 1..5`: which literals were written is lost, and with them which names an object with a given literal has.
fn collect_views_of_literals(
    id: LayoutId,
    first: &Layout,
    others: &[&Layout],
    types: &TypeTable,
    views: &mut Vec<Layout>,
    waiting: &mut Vec<WaitingPosition>,
) {
    let definitions = core::iter::once(first).chain(others.iter().copied());
    let mut listed: Vec<(Literals, &Layout)> = definitions
        .filter(|definition| says_what_fields_hold(definition))
        .map(|definition| (list_literals(definition, types), definition))
        .collect();
    if listed.iter().all(|(literals, _)| *literals == listed[0].0) {
        return;
    }
    listed.retain(|(literals, _)| !literals.is_empty());
    listed.sort_by(|left, right| left.0.cmp(&right.0));
    for definitions in listed.chunk_by(|left, right| left.0 == right.0) {
        let mut view = create_view(id, definitions[0].1);
        let mut uniting = Uniting::new(views.len() as u32 + 1, &view.fields, waiting);
        for (_, definition) in &definitions[1..] {
            unite_layouts(&mut view, definition, &mut uniting);
        }
        views.push(view);
    }
}

// The list, and the index in it.
type Place = (u32, u32);

// A layout with several definitions.
struct UnitedLayout<'a> {
    id: LayoutId,
    united: &'a mut Layout,
    places: &'a [(LayoutId, Place)],
    views: Vec<Layout>,
    waiting: Vec<WaitingPosition>,
}

impl UnitedLayout<'_> {
    fn unite_without_table(&mut self, others: &[Vec<(LayoutId, Layout)>], types: &TypeTable) {
        let places = self.places.iter();
        let definitions: Vec<&Layout> = places
            .map(|&(_, (list, index))| &others[list as usize][index as usize].1)
            .collect();
        let (views, waiting) = (&mut self.views, &mut self.waiting);
        collect_views_of_literals(self.id, self.united, &definitions, types, views, waiting);
        let mut uniting = Uniting::new(0, &self.united.fields, waiting);
        for other in definitions {
            unite_layouts(self.united, other, &mut uniting);
        }
    }

    fn unite_waiting_positions(&mut self, unions: &mut Unions<'_>) {
        for position in &self.waiting {
            let record = match position.record {
                0 => &mut *self.united,
                view => &mut self.views[view as usize - 1],
            };
            let first = &mut record.fields[position.field as usize].declared;
            let ty = unions.union(first.ty, position.declared.ty);
            *first = unite_positions(*first, position.declared, ty);
        }
    }
}

// `layouts` is in the order of the ids, and so is `order`.
fn split_united_layouts<'a>(
    mut layouts: &'a mut [Layout],
    order: &'a [(LayoutId, Place)],
) -> Vec<UnitedLayout<'a>> {
    let mut first_index = 0;
    let mut united_layouts = Vec::new();
    for places in order.chunk_by(|left, right| left.0 == right.0) {
        let id = places[0].0;
        let (_, rest) = core::mem::take(&mut layouts).split_at_mut(id.index() - first_index);
        let (united, rest) = rest
            .split_first_mut()
            .expect("a definition is of a layout of the program");
        (layouts, first_index) = (rest, id.index() + 1);
        united_layouts.push(UnitedLayout {
            id,
            united,
            places,
            views: Vec::new(),
            waiting: Vec::new(),
        });
    }
    united_layouts
}

const LAYOUTS_IN_A_TASK: usize = 256;

// `others` has a list for each unit, in the order of the units.
pub(super) fn unite_layout_definitions(
    layouts: &mut [Layout],
    others: Vec<Vec<(LayoutId, Layout)>>,
    types: &mut TypeTable,
    in_parallel: InParallel<'_>,
) -> Vec<Layout> {
    // A layout is a large record to move, so what is sorted is its place.
    let mut order: Vec<(LayoutId, Place)> = Vec::with_capacity(others.iter().map(Vec::len).sum());
    for (list, definitions) in (0..).zip(&others) {
        order.extend(
            (0..)
                .zip(definitions)
                .map(|(index, &(id, _))| (id, (list, index))),
        );
    }
    order.sort_unstable();
    let mut united_layouts = split_united_layouts(layouts, &order);
    let mut tasks: Vec<&mut [UnitedLayout<'_>]> =
        united_layouts.chunks_mut(LAYOUTS_IN_A_TASK).collect();
    let known_types: &TypeTable = types;
    for_each_mut(&mut tasks, in_parallel, &|task| {
        for layout in task.iter_mut() {
            layout.unite_without_table(&others, known_types);
        }
    });
    let mut unions = Unions {
        types,
        known: FxHashMap::default(),
    };
    let mut views = Vec::new();
    for mut layout in united_layouts {
        layout.unite_waiting_positions(&mut unions);
        views.append(&mut layout.views);
    }
    let mut tasks: Vec<&mut [Layout]> = layouts.chunks_mut(LAYOUTS_IN_A_TASK * 4).collect();
    for_each_mut(&mut tasks, in_parallel, &|task| {
        let records = task
            .iter_mut()
            .filter(|layout| layout.kind == LayoutKind::Record);
        for field in records.flat_map(|layout| &mut layout.fields) {
            if !field.declared.is_said() {
                field.declared = DeclaredType::untyped();
            }
        }
    });
    drop_each(others, in_parallel);
    views
}

// A constructor function, or a class without heritage: its constructor allocates the objects, with names that are stored later.
fn is_maker(layout: &Layout) -> bool {
    layout.kind == LayoutKind::Instance
        && layout.constructor.is_some()
        && !layout.flags.contains(LayoutFlags::HAS_HERITAGE)
}

// The layouts that the program converts, in any number of steps, to a type that it converts the objects of a maker to.
fn find_types_of_made_objects(layouts: &[Layout]) -> Vec<bool> {
    // The layouts below layout `i` lie in `below` from `starts[i]` to `starts[i + 1]`.
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

// The units name no view, so the views come behind every layout that has a number, and behind the steps that go by those numbers.
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
