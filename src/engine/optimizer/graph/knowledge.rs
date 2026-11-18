//! What is known of values at a point of a walk over the blocks.

use bun_engine_codegen::ir::{Binary, Block, Effects, Entity, Heap, Op, Table, Value as Ssa};
use bun_engine_vm::{CellType, ElementKind, SpeculatedType};
use smallvec::{SmallVec, smallvec};

use super::probes::Claim;
use super::{Graph, Kind, ModeSet, ShapeSet, Transition, TypeName, heaps};

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct Known {
    pub(crate) root: Ssa,
    /// Stands for the value from where all of this is known. `NONE` if there is no such thing yet.
    pub(crate) alias: Ssa,
    pub(crate) ty: SpeculatedType,
    pub(crate) shapes: ShapeSet,
    /// The shapes are known from before something that can change a shape, so they hold only if they are stable.
    pub(crate) shapes_are_stale: bool,
    /// Of a cell.
    pub(crate) modes: ModeSet,
    /// What the two were before they were forgotten, and are likely to be still.
    pub(crate) former: (ShapeSet, ModeSet),
    pub(crate) int32: Ssa,
    pub(crate) double: Ssa,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Field {
    base: Ssa,
    offset: i32,
    heap: Heap,
    value: Ssa,
}

/// In place of an offset: what is found under a name, be it in the object or in a prototype.
pub(crate) const LOOKED_UP: i32 = i32::MIN;

const MAX_SAVED: usize = 48;
const MAX_FIELDS: usize = 24;

#[derive(Default)]
pub(crate) struct Knowledge {
    entries: Vec<Known>,
    /// The position in `entries`, if the entry there has this root.
    positions: Table<Ssa, u32>,
    fields: Vec<Field>,
    /// Objects that need no barrier until something can collect.
    young: Vec<Ssa>,
    shelves: Vec<Shelf>,
    /// From here on they have not been used yet.
    first_unused_shelf: usize,
    free_shelves: Vec<u32>,
    /// `positions` still goes with what is there.
    handed_over: Option<u32>,
}

#[derive(Default)]
struct Shelf {
    entries: Vec<Known>,
    fields: Vec<Field>,
    young: Vec<Ssa>,
}

/// The shelf of the `Knowledge` that it has been saved from.
#[derive(Default)]
pub(crate) struct SavedKnowledge(Option<u32>);

impl Knowledge {
    /// For another graph.
    pub(crate) fn reset(&mut self) {
        const SHELVES_KEPT: usize = 32;
        self.clear();
        self.positions.clear();
        self.shelves.truncate(SHELVES_KEPT);
        self.free_shelves.clear();
        (self.first_unused_shelf, self.handed_over) = (0, None);
    }

    pub(crate) fn clear(&mut self) {
        self.entries.clear();
        self.fields.clear();
        self.young.clear();
    }

    #[inline]
    fn position(&self, root: Ssa) -> Option<usize> {
        let position = *self.positions.get(root)? as usize;
        self.entries
            .get(position)
            .is_some_and(|entry| entry.root == root)
            .then_some(position)
    }

    #[inline]
    pub(crate) fn get(&self, root: Ssa) -> Option<&Known> {
        self.position(root).map(|position| &self.entries[position])
    }

    fn push(&mut self, known: Known, value_count: usize) -> &mut Known {
        self.handed_over = None;
        self.positions.grow_to(value_count, u32::MAX);
        self.positions[known.root] = self.entries.len() as u32;
        self.entries.push_mut(known)
    }

    pub(crate) fn entry(&mut self, graph: &Graph, root: Ssa) -> &mut Known {
        match self.position(root) {
            Some(position) => &mut self.entries[position],
            None => self.push(Known::inherent(graph, root), graph.function.value_count()),
        }
    }

    pub(crate) fn type_of(&self, graph: &Graph, value: Ssa) -> SpeculatedType {
        let root = graph.root(value);
        self.get(root)
            .map_or_else(|| graph.inherent_type(root), |known| known.ty)
    }

    pub(crate) fn is(&self, graph: &Graph, value: Ssa, ty: SpeculatedType) -> bool {
        ty.contains(self.type_of(graph, value))
    }

    /// Also tells whether that holds only if they are stable.
    fn shapes_unless_changed(&self, graph: &Graph, value: Ssa) -> (ShapeSet, bool) {
        let root = graph.root(value);
        self.get(root).map_or_else(
            || (graph.inherent_shapes(root), true),
            |known| (known.shapes, known.shapes_are_stale),
        )
    }

    /// The code counts on the answer.
    pub(crate) fn shapes_of(&self, graph: &mut Graph, value: Ssa) -> ShapeSet {
        let (shapes, is_stale) = self.shapes_unless_changed(graph, value);
        if is_stale && shapes != ShapeSet::ANY {
            graph.assume_stable(shapes);
        }
        shapes
    }

    pub(crate) fn modes_of(&self, graph: &Graph, value: Ssa) -> ModeSet {
        (self.get(graph.root(value))).map_or(ModeSet::ANY, |known| known.modes)
    }

    /// The code counts on the answer.
    pub(crate) fn has_modes(&self, graph: &mut Graph, value: Ssa, wanted: ModeSet) -> bool {
        if wanted.contains(self.modes_of(graph, value)) {
            return true;
        }
        let (shapes, _) = self.shapes_unless_changed(graph, value);
        let holds = wanted.contains(graph.shapes.modes_of(shapes));
        if holds {
            self.shapes_of(graph, value);
        }
        holds
    }

    pub(crate) fn learn_type(&mut self, graph: &Graph, value: Ssa, ty: SpeculatedType, alias: Ssa) {
        let known = self.entry(graph, graph.root(value));
        known.ty &= ty;
        known.alias = alias;
    }

    pub(crate) fn learn_shapes(&mut self, graph: &Graph, value: Ssa, shapes: ShapeSet, alias: Ssa) {
        let known = self.entry(graph, graph.root(value));
        known.ty &= graph.shapes.type_of(shapes);
        known.modes = known.modes.and(graph.shapes.modes_of(shapes));
        (known.shapes, known.shapes_are_stale, known.alias) = (shapes, false, alias);
    }

    /// Of a cell.
    pub(crate) fn learn_modes(&mut self, graph: &Graph, value: Ssa, modes: ModeSet, alias: Ssa) {
        let known = self.entry(graph, graph.root(value));
        if !modes.intersects(ModeSet::of_kind(ElementKind::None)) {
            known.ty &= SpeculatedType::OBJECT;
        }
        (known.modes, known.alias) = (known.modes.and(modes), alias);
    }

    /// Learns from the condition of a branch, if that is a test of modes. Gives what was known before.
    pub(crate) fn assume_modes(
        &mut self,
        graph: &Graph,
        condition: Ssa,
        holds: bool,
    ) -> Option<Known> {
        let Some((Kind::HasModes, data)) = graph.node(condition) else {
            return None;
        };
        let (subject, wanted) = (
            graph.operand(condition, 0),
            graph.mode_check_at(data).wanted,
        );
        let before = *self.entry(graph, graph.root(subject));
        let modes = if holds {
            wanted
        } else {
            ModeSet::ANY.without(wanted)
        };
        self.learn_modes(graph, subject, modes, Ssa::NONE);
        Some(before)
    }

    /// Others that had the old shape may be the same object.
    pub(crate) fn note_transition(
        &mut self,
        graph: &mut Graph,
        object: Ssa,
        transition: Transition,
    ) {
        let (from, to) = (
            ShapeSet::single(transition.from),
            ShapeSet::single(transition.to),
        );
        for known in &mut self.entries {
            if known.shapes != ShapeSet::ANY && graph.shapes.is_subset(from, known.shapes) {
                known.shapes = graph.shapes.widen(known.shapes, to);
            }
        }
        (self.fields).retain(|field| field.offset != LOOKED_UP && field.heap != heaps::SHAPE);
        let known = self.entry(graph, graph.root(object));
        (known.shapes, known.shapes_are_stale) = (to, false);
    }

    pub(crate) fn forget_shapes(&mut self, graph: &Graph) {
        self.fields.retain(|field| field.offset != LOOKED_UP);
        for known in &mut self.entries {
            known.shapes_are_stale = true;
            if !graph.shapes.is_stable(known.shapes) {
                known.forget_shapes();
            }
        }
    }

    fn forget_modes(&mut self) {
        for known in &mut self.entries {
            if known.modes != ModeSet::ANY {
                known.former.1 = core::mem::replace(&mut known.modes, ModeSet::ANY);
            }
        }
    }

    pub(crate) fn note_write(&mut self, graph: &Graph, heap: Heap) {
        if graph.function.may_alias(heap, heaps::SHAPE) {
            self.forget_shapes(graph);
        }
        if graph.function.may_alias(heap, heaps::INDEXING_MODE) {
            self.forget_modes();
        }
        self.fields
            .retain(|field| !graph.function.may_alias(heap, field.heap));
    }

    /// To a heap other than that of shapes. What was at hand before an object was made is no part of it.
    pub(crate) fn note_write_to(&mut self, graph: &Graph, owner: Ssa, heap: Heap) {
        let owner = graph.root(owner);
        if !graph.kind(owner).is_some_and(Kind::allocates) {
            return self.note_write(graph, heap);
        }
        debug_assert!(!graph.function.may_alias(heap, heaps::SHAPE));
        let is_older = |field: &Field| field.base < owner && field.offset != LOOKED_UP;
        (self.fields).retain(|it| is_older(it) || !graph.function.may_alias(heap, it.heap));
    }

    pub(crate) fn note_effects(&mut self, graph: &Graph, effects: Effects, can_collect: bool) {
        if effects.writes_memory() {
            self.note_write(graph, effects.writes);
        }
        if can_collect {
            self.young.clear();
        }
    }

    /// At the header of a loop of which nothing is known yet.
    pub(crate) fn enter_loop(&mut self, graph: &Graph, params: &[Ssa]) {
        self.note_effects(graph, Effects::CALL, true);
        for &param in params {
            *self.entry(graph, param) = Known::inherent(graph, param);
        }
    }

    /// At the header of a loop that does no more than the functions tell.
    pub(crate) fn enter_known_loop(
        &mut self,
        graph: &Graph,
        may_write: impl Fn(Heap) -> bool,
        has_transition: impl Fn(ShapeSet) -> bool,
    ) {
        if may_write(heaps::SHAPE) {
            self.forget_shapes(graph);
        }
        if may_write(heaps::INDEXING_MODE) {
            self.forget_modes();
        }
        for known in &mut self.entries {
            if known.shapes != ShapeSet::ANY && has_transition(known.shapes) {
                known.shapes = ShapeSet::ANY;
            }
        }
        self.fields.retain(|field| !may_write(field.heap));
        self.young.clear();
    }

    /// With their operands.
    pub(crate) fn claims(&self) -> Vec<(Claim, SmallVec<[Ssa; 2]>)> {
        let mut claims = Vec::new();
        for known in &self.entries {
            let of_root = [
                (!known.ty.contains(SpeculatedType::BYTECODE_TOP)).then_some(Claim::Type(known.ty)),
                (known.shapes != ShapeSet::ANY && !known.shapes_are_stale)
                    .then_some(Claim::Shapes(known.shapes)),
                (known.modes != ModeSet::ANY).then_some(Claim::Modes(known.modes)),
            ];
            claims.extend((of_root.into_iter().flatten()).map(|it| (it, smallvec![known.root])));
            let forms = [(Claim::Int32, known.int32), (Claim::Double, known.double)];
            let forms = forms.into_iter().filter(|it| !it.1.is_none());
            claims.extend(forms.map(|(claim, form)| (claim, smallvec![known.root, form])));
        }
        claims
    }

    // Memory

    pub(crate) fn field(&self, base: Ssa, offset: i32, heap: Heap) -> Option<Ssa> {
        let found = self
            .fields
            .iter()
            .find(|field| (field.base, field.offset, field.heap) == (base, offset, heap));
        found.map(|field| field.value)
    }

    /// For what is not a field, and can be several values at once.
    pub(crate) fn has_field(&self, base: Ssa, offset: i32, heap: Heap, value: Ssa) -> bool {
        self.fields.contains(&Field {
            base,
            offset,
            heap,
            value,
        })
    }

    pub(crate) fn learn_field(&mut self, base: Ssa, offset: i32, heap: Heap, value: Ssa) {
        if self.fields.len() == MAX_FIELDS {
            self.fields.remove(0);
        }
        self.fields.push(Field {
            base,
            offset,
            heap,
            value,
        });
    }

    pub(crate) fn is_young(&self, root: Ssa) -> bool {
        self.young.contains(&root)
    }

    pub(crate) fn learn_young(&mut self, root: Ssa) {
        self.young.push(root);
    }

    // Edges

    fn take_shelf(&mut self) -> u32 {
        self.free_shelves.pop().unwrap_or_else(|| {
            if self.first_unused_shelf == self.shelves.len() {
                self.shelves.push(Shelf::default());
            }
            self.first_unused_shelf += 1;
            self.first_unused_shelf as u32 - 1
        })
    }

    pub(crate) fn save(&mut self) -> SavedKnowledge {
        let number = self.take_shelf();
        let shelf = &mut self.shelves[number as usize];
        shelf.entries.clear();
        let dropped = self.entries.len().saturating_sub(MAX_SAVED);
        shelf.entries.extend_from_slice(&self.entries[dropped..]);
        shelf.fields.clone_from(&self.fields);
        shelf.young.clone_from(&self.young);
        SavedKnowledge(Some(number))
    }

    /// The same where the walk ends, so that it is not needed here any more.
    pub(crate) fn hand_over(&mut self) -> SavedKnowledge {
        let number = self.take_shelf();
        self.trade_with_shelf(number);
        self.clear();
        let entries = &mut self.shelves[number as usize].entries;
        let dropped = entries.len().saturating_sub(MAX_SAVED);
        entries.drain(..dropped);
        self.handed_over = (dropped == 0).then_some(number);
        SavedKnowledge(Some(number))
    }

    fn trade_with_shelf(&mut self, number: u32) {
        let shelf = &mut self.shelves[number as usize];
        core::mem::swap(&mut self.entries, &mut shelf.entries);
        core::mem::swap(&mut self.fields, &mut shelf.fields);
        core::mem::swap(&mut self.young, &mut shelf.young);
    }

    fn find_positions(&mut self) {
        for (position, known) in (0..).zip(&self.entries) {
            self.positions.grow_to(known.root.index() + 1, u32::MAX);
            self.positions[known.root] = position;
        }
    }

    pub(crate) fn restore(&mut self, saved: &SavedKnowledge) {
        self.handed_over = None;
        let Some(number) = saved.0 else {
            return self.clear();
        };
        let shelf = &self.shelves[number as usize];
        self.entries.clone_from(&shelf.entries);
        self.fields.clone_from(&shelf.fields);
        self.young.clone_from(&shelf.young);
        self.find_positions();
    }

    /// The same for the last time.
    pub(crate) fn take_back(&mut self, saved: &mut SavedKnowledge) {
        let Some(number) = saved.0.take() else {
            return self.restore(saved);
        };
        self.trade_with_shelf(number);
        self.free_shelves.push(number);
        if self.handed_over.take() != Some(number) {
            self.find_positions();
        }
    }

    /// Leaves in `saved` what is known both there and here.
    pub(crate) fn merge_into(&mut self, graph: &mut Graph, saved: &SavedKnowledge) {
        let number = saved.0.expect("from an earlier way") as usize;
        let mut shelf = core::mem::take(&mut self.shelves[number]);
        shelf.entries.retain_mut(|there| {
            let Some(here) = self.get(there.root) else {
                return false;
            };
            if here != there {
                there.widen(graph, here);
            }
            true
        });
        if shelf.fields != self.fields {
            shelf.fields.retain(|field| self.fields.contains(field));
        }
        shelf.young.retain(|root| self.young.contains(root));
        self.shelves[number] = shelf;
    }

    pub(crate) fn find_saved(&self, saved: &SavedKnowledge, root: Ssa) -> Option<&Known> {
        let entries = &self.shelves[saved.0? as usize].entries;
        entries.iter().find(|known| known.root == root)
    }

    pub(crate) fn add_to_saved(&mut self, saved: &SavedKnowledge, more: &[Known]) {
        if !more.is_empty() {
            let number = saved.0.expect("from an earlier way") as usize;
            self.shelves[number].entries.extend_from_slice(more);
            self.handed_over = None;
        }
    }

    /// What can be said of a parameter for which `arg` is passed.
    pub(crate) fn passed_on(&self, graph: &Graph, arg: Ssa, param: Ssa) -> Known {
        let root = graph.root(arg);
        let known = self
            .get(root)
            .copied()
            .unwrap_or_else(|| Known::inherent(graph, root));
        Known {
            root: param,
            alias: param,
            int32: Ssa::NONE,
            double: Ssa::NONE,
            ..known
        }
    }
}

impl Known {
    pub(crate) fn inherent(graph: &Graph, root: Ssa) -> Self {
        Self {
            root,
            alias: root,
            ty: graph.inherent_type(root),
            shapes: graph.inherent_shapes(root),
            shapes_are_stale: true,
            modes: ModeSet::ANY,
            former: (ShapeSet::ANY, ModeSet::ANY),
            int32: Ssa::NONE,
            double: Ssa::NONE,
        }
    }

    fn forget_shapes(&mut self) {
        if self.shapes != ShapeSet::ANY {
            self.former.0 = core::mem::replace(&mut self.shapes, ShapeSet::ANY);
        }
    }

    pub(crate) fn likely_layout(&self) -> (ShapeSet, ModeSet) {
        let (shapes, modes) = self.former;
        (
            Some(self.shapes)
                .filter(|&it| it != ShapeSet::ANY)
                .unwrap_or(shapes),
            Some(self.modes)
                .filter(|&it| it != ModeSet::ANY)
                .unwrap_or(modes),
        )
    }

    pub(crate) fn widen(&mut self, graph: &mut Graph, other: &Known) {
        let common = |a: Ssa, b: Ssa| if a == b { a } else { Ssa::NONE };
        let (here, there) = (self.likely_layout(), other.likely_layout());
        self.former = (graph.shapes.widen(here.0, there.0), here.1.or(there.1));
        self.ty |= other.ty;
        self.shapes = graph.shapes.widen(self.shapes, other.shapes);
        self.shapes_are_stale |= other.shapes_are_stale;
        if self.shapes_are_stale && !graph.shapes.is_stable(self.shapes) {
            self.shapes = ShapeSet::ANY;
        }
        self.modes = self.modes.or(other.modes);
        self.alias = common(self.alias, other.alias);
        self.int32 = common(self.int32, other.int32);
        self.double = common(self.double, other.double);
    }
}

/// Of a parameter whose arguments are of that type. It may yet be turned into a double.
pub(crate) fn type_of_param(of_args: SpeculatedType) -> SpeculatedType {
    if of_args.intersects(SpeculatedType::INT32) {
        of_args | SpeculatedType::INT_AS_DOUBLE
    } else {
        of_args
    }
}

pub(crate) fn without_negation(graph: &Graph, mut condition: Ssa, mut holds: bool) -> (Ssa, bool) {
    while let Op::Binary(Binary::Xor, [inner, one]) = *graph.function.op(condition)
        && graph.function.is_int_constant(one, 1)
    {
        (condition, holds) = (graph.function.resolve(inner), !holds);
    }
    (condition, holds)
}

/// What it says of the type of a value that `condition` holds, or does not.
pub(crate) fn implied_type(
    graph: &Graph,
    condition: Ssa,
    holds: bool,
) -> Option<(Ssa, SpeculatedType)> {
    use SpeculatedType as T;
    let (condition, holds) = without_negation(graph, condition, holds);
    let (kind, data) = graph.node(condition)?;
    let ty = match (kind, holds) {
        (Kind::IsType, true) => graph.interned_type(data),
        (Kind::IsType, false) => !graph.interned_type(data),
        (Kind::ToBoolean | Kind::PlainToBoolean | Kind::GenericToBoolean, true)
        | (Kind::EqualNull, false) => !T::NULLISH,
        (Kind::PlainToBoolean, false) => !(T::SYMBOL | T::OBJECT),
        (Kind::ToBoolean | Kind::GenericToBoolean, false) => !T::SYMBOL,
        (Kind::EqualNull, true) => T::NULLISH | T::OBJECT,
        (Kind::IsCellOfType, true) => T::of_cell_type(CellType(data as u8)),
        (Kind::IsCallable | Kind::IsConstructor, true) => TypeName::MAY_BE_CALLABLE,
        (Kind::IsCallable, false) => !T::FUNCTION,
        (Kind::HasObjectTypeName, true) => TypeName::Object.types(),
        (Kind::HasObjectTypeName, false) => !TypeName::Object.types() | TypeName::MAY_BE_CALLABLE,
        (Kind::EqualsAtom, true) => T::STRING,
        _ => return None,
    };
    Some((graph.root(graph.operand(condition, 0)), ty))
}

/// The same, of taking the edge at this position among those that leave the block.
pub(crate) fn implied_by_end(
    graph: &Graph,
    block: Block,
    position: usize,
) -> Option<(Ssa, SpeculatedType)> {
    match *graph.function.op(graph.function.last(block)) {
        Op::Branch(condition) => implied_type(graph, condition, position == 0),
        Op::Switch(found, cases) => {
            let value = graph.inside(graph.function.resolve(found), Kind::PlainTypeof)?;
            let keys = graph.function.cases(cases);
            let names = (0..).zip(graph.type_names.map(|it| it as i64));
            let taken = names.filter(|(_, name)| match keys.get(position) {
                Some(key) => key == name,
                None => !keys.contains(name),
            });
            let types = taken.map(|(name, _)| TypeName::from_data(name).types());
            Some((graph.root(value), types.collect()))
        }
        _ => None,
    }
}
