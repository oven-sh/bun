//! Indexed properties, by what the profiles have seen.

mod atomics;
mod bytes;
mod get;
mod length;
mod methods;
mod names;
mod put;
mod steps;
mod typed_arrays;

use bun_engine_codegen::ir::{Heap, Type, Value as Ssa};
use bun_engine_vm::{
    ArrayModes, ElementKind, ElementType, IndexingMode, JsObject, SpeculatedType as T, Storage,
};
use smallvec::SmallVec;

use super::Builder;
use super::fork::{Fork, Odds};
use super::frame::Junction;
use crate::graph::probes::Claim;
use crate::graph::{ExitKind, Kind, ModeCheck, ModeSet, NOT_NAN, ShapeIndex, ShapeSet, heaps};

const MAX_WAYS: usize = 4;
const MAX_REMEMBERED_INDEX: i64 = 16;
const STORES_ELEMENTS: T = T::OBJECT
    .difference(T::TYPED_ARRAY)
    .difference(T::DIRECT_ARGUMENTS)
    .difference(T::SCOPED_ARGUMENTS);

/// Where an object has its elements.
#[derive(Clone, Copy, PartialEq)]
enum Way {
    /// Never sparse.
    Stored(ModeSet),
    /// With any, for what does not look at them.
    Array,
    Typed(ElementType),
    String,
    DirectArguments,
    ScopedArguments,
}

type WayList = SmallVec<[Way; MAX_WAYS]>;

impl Way {
    fn type_of_base(self) -> T {
        match self {
            Self::Stored(modes) if ModeSet::ARRAY.contains(modes) => T::ARRAY | T::DERIVED_ARRAY,
            Self::Stored(_) => STORES_ELEMENTS,
            Self::Array => T::ARRAY,
            Self::Typed(of) => T::of_cell_type(of.cell_type()),
            Self::String => T::STRING,
            Self::DirectArguments => T::DIRECT_ARGUMENTS,
            Self::ScopedArguments => T::SCOPED_ARGUMENTS,
        }
    }

    /// With the bit of each in a profile.
    fn told_by_type() -> impl Iterator<Item = (Self, ArrayModes)> {
        let bit = |of| ArrayModes::from_bits_retain(ArrayModes::INT8_ARRAY.bits() << of as u32);
        let typed = ElementType::ALL.map(|of| (Self::Typed(of), bit(of)));
        typed.into_iter().chain([
            (Self::String, ArrayModes::STRING),
            (Self::DirectArguments, ArrayModes::DIRECT_ARGUMENTS),
            (Self::ScopedArguments, ArrayModes::SCOPED_ARGUMENTS),
        ])
    }
}

/// An access that is being translated.
struct Access {
    base: Ssa,
    /// An I32.
    index: Ssa,
    /// The index is known to be below the length.
    is_inside: bool,
    seen: ArrayModes,
    fork: Fork,
    /// For what the ways cannot do.
    slow: Junction,
}

const KINDS: [ElementKind; 5] = [
    ElementKind::None,
    ElementKind::Undecided,
    ElementKind::Int32,
    ElementKind::Double,
    ElementKind::Contiguous,
];

fn bit_for(kind: ElementKind) -> ArrayModes {
    ArrayModes::from_bits_retain(1 << (kind as u32 / 2))
}

fn profile_of(modes: ModeSet) -> ArrayModes {
    let kinds = KINDS.into_iter().chain([ElementKind::Sparse]);
    let kinds = kinds.map(|kind| (ModeSet::of_kind(kind), bit_for(kind)));
    let flags = [
        (ModeSet::ARRAY, ArrayModes::ARRAY),
        (ModeSet::ARRAY, ArrayModes::NON_ORIGINAL_ARRAY_SHAPE),
        (ModeSet::NON_ARRAY, ArrayModes::NON_ARRAY),
        (ModeSet::SHARED, ArrayModes::COPY_ON_WRITE),
        (ModeSet::RESTRICTED, ArrayModes::SLOW_PUT),
    ];
    let possible = kinds.chain(flags).filter(|it| modes.intersects(it.0));
    possible.map(|it| it.1).collect()
}

pub(super) fn heap_for(modes: ModeSet) -> Heap {
    if holds_doubles(modes) {
        heaps::DOUBLE_ELEMENTS
    } else {
        heaps::VALUE_ELEMENTS
    }
}

fn holds_doubles(modes: ModeSet) -> bool {
    ModeSet::of_kind(ElementKind::Double).contains(modes)
}

fn holds_int32s(modes: ModeSet) -> bool {
    (ModeSet::of_kind(ElementKind::Int32).or(ModeSet::UNDECIDED)).contains(modes)
}

impl Builder<'_> {
    pub(super) fn may_be_index(&self, key: Ssa) -> bool {
        T::BOXED_NUMBER.contains(self.expected(key)) && !self.has_exited(ExitKind::NotAnInteger)
    }

    fn may_be_outside(&self, seen: ArrayModes) -> bool {
        seen.contains(ArrayModes::OUT_OF_BOUNDS) || self.has_exited(ExitKind::OutOfBounds)
    }

    /// Then what other callers have made it see is of little interest.
    fn is_in_inlined_builtin(&self) -> bool {
        !self.frame().is_root() && self.graph.frame_at(self.origin).is_builtin
    }

    /// The profile may be of many callers, and the base of one.
    fn seen_of(&self, base: Ssa, seen: ArrayModes) -> ArrayModes {
        const OF_ACCESS: ArrayModes = ArrayModes::HOLE
            .union(ArrayModes::OUT_OF_BOUNDS)
            .union(ArrayModes::UNUSUAL_INDEX);
        let known = self.knowledge.get(self.graph.root(base));
        let (shapes, modes) = match known {
            Some(known) if self.has_exited(ExitKind::BadElements) => (known.shapes, known.modes),
            Some(known) => known.likely_layout(),
            None => (ShapeSet::ANY, ModeSet::ANY),
        };
        let constant = self.constant_cell::<JsObject>(base);
        let of_base = match constant.filter(|_| !self.has_exited(ExitKind::BadElements)) {
            Some(object) => ArrayModes::of_shape(&object.shape()),
            None if shapes != ShapeSet::ANY => {
                let members = self.graph.shapes.members(shapes).iter();
                let possible = members.filter(|&&it| {
                    modes.intersects(ModeSet::single(self.graph.shapes[it].indexing_mode))
                });
                possible
                    .map(|&it| ArrayModes::of_shape(&self.shape_at(it)))
                    .collect()
            }
            None if modes.intersects(ModeSet::of_kind(ElementKind::None)) => return seen,
            None => profile_of(modes),
        };
        let kinds = (of_base & ArrayModes::STORED).bits().count_ones();
        let has_varied = if kinds > 1 {
            seen & ArrayModes::MIXED
        } else {
            ArrayModes::empty()
        };
        seen & OF_ACCESS | of_base | has_varied
    }

    /// The modes, of those that are not sparse, to provide for.
    fn likely_modes(&mut self, base: Ssa, seen: ArrayModes) -> ModeSet {
        let mut kinds = KINDS.into_iter().filter(|&it| seen.contains(bit_for(it)));
        let keeps_changing =
            seen.contains(ArrayModes::MIXED) || self.has_exited(ExitKind::BadElements);
        let mut likely = if keeps_changing {
            kinds.map(ModeSet::of_kind).fold(ModeSet::NONE, ModeSet::or)
        } else {
            kinds.next_back().map_or(ModeSet::NONE, ModeSet::of_kind)
        };
        match seen & (ArrayModes::ARRAY | ArrayModes::NON_ARRAY) {
            ArrayModes::ARRAY => likely = likely.and(ModeSet::ARRAY),
            ArrayModes::NON_ARRAY => likely = likely.and(ModeSet::NON_ARRAY),
            _ => {}
        }
        let known = self.knowledge.modes_of(&self.graph, base);
        if likely.intersects(known) || !ModeSet::DENSE.contains(known) {
            likely
        } else {
            known
        }
    }

    /// Tagged elements, doubles and none at all. It takes no more to read from several kinds than from one, and where
    /// nothing has been stored yet, the holes are those of tagged elements.
    fn groups_to_read(&mut self, base: Ssa, seen: ArrayModes) -> [ModeSet; 3] {
        let likely = self.likely_modes(base, seen);
        let mut tagged = likely.and(ModeSet::VALUES);
        if let Some(kind) =
            (KINDS.into_iter().rev()).find(|&it| tagged.intersects(ModeSet::of_kind(it)))
        {
            let up_to_it = KINDS[1..]
                .iter()
                .filter(|&&it| it <= kind && it != ElementKind::Double);
            tagged = up_to_it.fold(ModeSet::NONE, |all, &it| all.or(ModeSet::of_kind(it)));
            if ModeSet::ARRAY.contains(likely) {
                tagged = tagged.and(ModeSet::ARRAY);
            }
        }
        let known = self.knowledge.modes_of(&self.graph, base);
        let doubles = likely.and(ModeSet::of_kind(ElementKind::Double));
        [
            tagged.and(known),
            doubles,
            likely.and(ModeSet::EMPTY).without(tagged),
        ]
    }

    /// `stored` has the groups of modes that are accessed alike. The list is empty if none is worth trying.
    fn likely_ways(&mut self, base: Ssa, seen: ArrayModes, stored: &[ModeSet]) -> WayList {
        let proven = Way::told_by_type().find(|(way, _)| self.is(base, way.type_of_base()));
        if let Some((way, _)) = proven {
            return [way].into_iter().collect();
        }
        let known = self.knowledge.modes_of(&self.graph, base);
        let possible = stored.iter().filter(|modes| modes.intersects(known));
        let mut ways: WayList = possible.map(|&modes| Way::Stored(modes)).collect();
        if !ModeSet::DENSE.contains(known) {
            let others = Way::told_by_type().filter(|&(_, bit)| seen.contains(bit));
            ways.extend(others.map(|(way, _)| way));
        }
        // What is told by its type looks as if it had no elements.
        ways.sort_by_key(|way| matches!(*way, Way::Stored(it) if ModeSet::EMPTY.contains(it)));
        let known = self.knowledge.type_of(&self.graph, base);
        ways.retain(|way| known.intersects(way.type_of_base()));
        let expected = self.expected(base);
        let is_expected = |way: &Way| expected.intersects(way.type_of_base());
        if ways.iter().any(is_expected) && !self.has_exited(ExitKind::BadElements) {
            ways.retain(|way| is_expected(way));
        }
        if ways.len() > MAX_WAYS {
            ways.clear();
        }
        ways
    }

    fn likely_ways_for_array(&mut self, base: Ssa, seen: ArrayModes, modes: &[ModeSet]) -> WayList {
        let mut ways = self.likely_ways(base, seen, modes);
        ways.retain(|way| matches!(way, Way::Stored(_)));
        ways
    }

    /// `None` if the code has to cope with an object that is for none of the ways.
    fn exit_for_other_base(&self, seen: ArrayModes) -> Option<ExitKind> {
        let failures = [ExitKind::BadElements, ExitKind::BadElementsAgain];
        (failures.into_iter().find(|&it| !self.has_exited(it)))
            .filter(|_| !seen.intersects(ArrayModes::SPARSE | ArrayModes::EXOTIC))
    }

    /// `translate` does the access for an object that the way is right for. What none is right for exits, or else goes
    /// the slow way. So does what `translate` sends there. Both give a tagged value, or neither.
    fn access_elements(
        &mut self,
        (base, index, seen): (Ssa, Ssa, ArrayModes),
        ways: &[Way],
        exit: Option<ExitKind>,
        mut translate: impl FnMut(&mut Self, &mut Access, Way, Ssa) -> Option<Ssa>,
        slowly: impl FnOnce(&mut Self) -> Option<Ssa>,
    ) -> Option<Ssa> {
        if ways.is_empty() {
            return slowly(self);
        }
        let mut access = Access {
            base,
            index,
            is_inside: false,
            seen,
            fork: self.fork_later(),
            slow: Junction::default(),
        };
        match exit {
            Some(exit) => _ = self.check_type_or(base, T::CELL, exit),
            None => {
                let is_cell = self.is_type(base, T::CELL);
                self.leave_unless(is_cell, Odds::Low, &mut access.slow);
            }
        }
        let mut result = None;
        for (position, &way) in ways.iter().enumerate() {
            let (is_last, mut next) = (position + 1 == ways.len(), Junction::default());
            let object = match exit.filter(|_| is_last) {
                Some(exit) => self.check_way(way, &access, position == 0, exit),
                None => {
                    let is_right = self.test_way(way, base);
                    if is_last {
                        self.leave_unless(is_right, Odds::Low, &mut access.slow);
                    } else {
                        self.leave_unless(is_right, Odds::Even, &mut next);
                    }
                    self.alias(base)
                }
            };
            result = translate(self, &mut access, way, object);
            if next.edges.is_empty() {
                break;
            }
            self.end_way(&mut access.fork, result);
            self.resume_at(&access.fork, &next);
        }
        if !access.slow.edges.is_empty() {
            self.end_way(&mut access.fork, result);
            self.resume_at(&access.fork, &access.slow);
            result = slowly(self);
        }
        self.end_last_way(access.fork, result)
    }

    /// Of a cell.
    fn test_way(&mut self, way: Way, base: Ssa) -> Ssa {
        let Way::Stored(modes) = way else {
            return self.is_type(base, way.type_of_base());
        };
        for (wanted, answer) in [(modes, 1), (ModeSet::ANY.without(modes), 0)] {
            if self.knowledge.has_modes(&mut self.graph, base, wanted) {
                self.verify(Claim::Modes(wanted), &[base]);
                return self.int32(answer);
            }
        }
        let (cell, data) = (
            self.alias(base),
            self.mode_check(modes, ExitKind::BadElements),
        );
        self.node(Kind::HasModes, &[cell], data)
    }

    fn check_way(&mut self, way: Way, access: &Access, is_only: bool, exit: ExitKind) -> Ssa {
        match way {
            Way::Stored(modes) => self.check_stored(access.base, modes, access.seen, is_only, exit),
            _ => self.check_type_or(access.base, way.type_of_base(), exit),
        }
    }

    /// Of a cell. The shape takes less to check than the mode, and tells more.
    fn check_stored(
        &mut self,
        base: Ssa,
        modes: ModeSet,
        seen: ArrayModes,
        may_use_shape: bool,
        exit: ExitKind,
    ) -> Ssa {
        if self.knowledge.has_modes(&mut self.graph, base, modes) {
            self.verify(Claim::Modes(modes), &[base]);
            return self.alias(base);
        }
        if may_use_shape
            && !self.has_exited(ExitKind::BadShape)
            && let Some(shapes) = self.likely_shapes(base, modes, seen)
        {
            return self.check_shapes(base, shapes);
        }
        let (cell, data) = (self.alias(base), self.mode_check(modes, exit));
        let checked = self.node(Kind::CheckModes, &[cell], data);
        (self.knowledge).learn_modes(&self.graph, base, modes, checked);
        checked
    }

    /// Of a cell.
    pub(super) fn check_is_dense(&mut self, base: Ssa) -> Ssa {
        let (seen, exit) = (ArrayModes::empty(), ExitKind::BadElements);
        self.check_stored(base, ModeSet::DENSE, seen, false, exit)
    }

    fn likely_shapes(&mut self, base: Ssa, modes: ModeSet, seen: ArrayModes) -> Option<ShapeSet> {
        let known = self.knowledge.get(self.graph.root(base));
        let (former, shapes) = (
            known.map_or(ShapeSet::ANY, |it| it.likely_layout().0),
            &mut self.graph.shapes,
        );
        if former != ShapeSet::ANY {
            let fits = |it: &ShapeIndex| modes.contains(ModeSet::single(shapes[*it].indexing_mode));
            let fitting: SmallVec<[_; 8]> = shapes
                .members(former)
                .iter()
                .copied()
                .filter(fits)
                .collect();
            if let 1 | 2 = fitting.len() {
                return Some(shapes.set_of(fitting));
            }
        }
        // Profiles miss much, so this has to save more than an instruction.
        let varies = ArrayModes::NON_ARRAY
            | ArrayModes::NON_ORIGINAL_ARRAY_SHAPE
            | ArrayModes::COPY_ON_WRITE
            | ArrayModes::SLOW_PUT;
        let mut kinds = KINDS[1..].iter().filter(|&&it| seen.contains(bit_for(it)));
        let mode = IndexingMode::array(*kinds.next().filter(|_| kinds.next().is_none())?);
        if seen.intersects(varies)
            || !seen.contains(ArrayModes::OUT_OF_BOUNDS)
            || !modes.intersects(ModeSet::single(mode))
        {
            return None;
        }
        let shape = self.global().original_array_shape(mode);
        Some(ShapeSet::single(self.shape(shape)))
    }

    fn mode_check(&mut self, wanted: ModeSet, failure: ExitKind) -> u32 {
        self.graph.mode_check(ModeCheck {
            wanted,
            known: ModeSet::ANY,
            failure,
        })
    }

    /// Exits if the integer is not zero, unless that is to be expected.
    fn bail_if(&mut self, access: &mut Access, condition: Ssa, kind: ExitKind, is_expected: bool) {
        if is_expected || self.has_exited(kind) {
            self.leave_if(condition, Odds::Low, &mut access.slow);
        } else {
            self.exit_if(condition, kind);
        }
    }

    /// Whether the slow way has to be able to do anything.
    fn may_run_scripts(&self, seen: ArrayModes) -> bool {
        seen.contains(ArrayModes::EXOTIC) || self.has_exited(ExitKind::ExoticObject)
    }

    pub(super) fn public_length(&mut self, storage: Ssa) -> Ssa {
        let offset = Storage::OFFSET_OF_PUBLIC_LENGTH as i32;
        self.load(Type::I32, storage, offset, heaps::PUBLIC_LENGTH)
    }

    /// Of an object that has all its elements in a vector.
    pub(super) fn dense_length(&mut self, storage: Ssa) -> Ssa {
        let length = self.public_length(storage);
        if self.graph.function.op(length).is_constant() {
            return length;
        }
        self.at_most(length, Storage::MAX_VECTOR_LENGTH)
    }

    pub(super) fn element_address(&mut self, storage: Ssa, index: Ssa) -> Ssa {
        let mut ir = self.ir();
        let index = ir.zero_extend(index);
        let offset = ir.shl(index, 3);
        ir.add(storage, offset)
    }

    /// Of an object that is certain to have it. It is as the modes have it stored.
    pub(super) fn learn_element(&mut self, object: Ssa, modes: ModeSet, index: i64, element: Ssa) {
        if (0..MAX_REMEMBERED_INDEX).contains(&index) {
            let (root, heap) = (self.graph.root(object), heap_for(modes));
            (self.knowledge).learn_field(root, index as i32, heap, element);
        }
    }

    fn known_element(&self, object: Ssa, modes: ModeSet, index: i64) -> Option<Ssa> {
        let (root, index) = (self.graph.root(object), i32::try_from(index).ok()?);
        self.knowledge.field(root, index, heap_for(modes))
    }

    /// From a vector of doubles, and no hole.
    pub(super) fn box_element(&mut self, number: Ssa) -> Ssa {
        self.profiled_node(Kind::BoxDouble, &[number], NOT_NAN, T::REAL_DOUBLE)
    }

    pub(super) fn check_bounds(&mut self, index: Ssa, length: Ssa) -> Ssa {
        let constants = [index, length].map(|it| self.graph.function.int_constant(it));
        if let [Some(at), Some(end)] = constants
            && (0..end).contains(&at)
        {
            return index;
        }
        self.node(Kind::CheckBounds, &[index, length], 0)
    }
}
