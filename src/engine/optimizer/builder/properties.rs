//! Named properties, by what the caches have seen and by what the shapes say.

mod custom;
mod load;
mod store;

use bun_engine_bytecode::Register;
use bun_engine_codegen::ir::{Heap, State, Successor, Type, Value as Ssa};
use bun_engine_text::PropertyName;
use bun_engine_vm::ic::{
    AccessCase, AccessCases, AccessKind, BOOLEAN_SHAPE, NUMBER_SHAPE, PrototypeLookup, SeenCase,
};
use bun_engine_vm::{
    CellType, Gc, GetterSetter, JsFunction, JsObject, RootVec, Shape, ShapeId, SpeculatedType as T,
    root_vec,
};
use smallvec::SmallVec;

pub(super) use load::Load;
pub(super) use store::Store;

use super::calls::CallSite;
use super::fork::Odds;
use super::frame::Junction;
use super::{Builder, Built};
use crate::graph::{CallKind, ExitKind, Kind, ShapeSet, heaps};

/// Shapes that are accessed in the same way.
pub(super) struct Case<How> {
    shapes: ShapeSet,
    how: How,
}

/// What becomes of a value for which there is no case.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Otherwise {
    Exit,
    /// The slot is searched for. If there is more to do than to access one, the code exits.
    Search,
    UseCache,
}

pub(super) struct Plan<How> {
    cases: RootVec<Case<How>>,
    otherwise: Otherwise,
    may_search: bool,
    /// Where a search is likely to end.
    usual_byte_offset: Option<i32>,
}

/// What the caches of an instruction have for a name.
struct Seen<'a> {
    name: PropertyName<'a>,
    /// If it is not in the list.
    only: Option<AccessCase>,
    list: &'a AccessCases,
}

impl Seen<'_> {
    fn for_each(&self, mut visit: impl FnMut(&AccessCase)) {
        let is_for_name = |it: &SeenCase| it.key().is_none_or(|key| key == self.name);
        self.only.iter().for_each(&mut visit);
        (self.list.iter().filter(is_for_name)).for_each(|it| visit(&it));
    }
}

const MAX_CASES: usize = 8;

fn is_real(shape: ShapeId) -> bool {
    !shape.is_none() && shape != NUMBER_SHAPE && shape != BOOLEAN_SHAPE
}

fn inherited_accessor(
    case: &AccessCase,
    shape: &Shape,
    which: fn(&GetterSetter) -> Option<Gc<JsObject>>,
) -> Option<(Gc<PrototypeLookup>, Gc<JsFunction>)> {
    // Scripts get to see the proxy in its place.
    let lookup = (case.lookup()).filter(|_| shape.instance_type() != CellType::GlobalObject)?;
    let accessor = lookup.constant()?.downcast::<GetterSetter>()?;
    Some((lookup, which(&accessor)?.downcast()?))
}

pub(super) fn gave_up(cases: &AccessCases) -> bool {
    cases
        .last()
        .is_some_and(|last| last.kind() != AccessKind::End || last.did_miss())
}

impl Builder<'_> {
    pub(super) fn named_heap(&mut self, name: PropertyName<'_>) -> Heap {
        self.heap_member(heaps::Family::Named, name.address())
    }

    pub(super) fn storage(&mut self, object: Ssa) -> Ssa {
        self.load(
            Type::I64,
            object,
            JsObject::OFFSET_OF_STORAGE as i32,
            heaps::STORAGE,
        )
    }

    pub(super) fn slot_base(&mut self, object: Ssa, byte_offset: i32) -> Ssa {
        if byte_offset > 0 {
            object
        } else {
            self.storage(object)
        }
    }

    pub(super) fn add_case<How: PartialEq>(
        &mut self,
        cases: &mut RootVec<Case<How>>,
        shape: Gc<Shape>,
        how: How,
        merges: bool,
    ) {
        let shape = self.shape(shape);
        match cases.iter_mut().find(|case| merges && case.how == how) {
            Some(case) => case.shapes = self.graph.shapes.with(case.shapes, shape),
            None => {
                let shapes = ShapeSet::single(shape);
                cases.push(Case { shapes, how });
            }
        }
    }

    /// Leaves out the shapes that the object cannot have. False if none is left.
    pub(super) fn narrow<How>(&mut self, cases: &mut RootVec<Case<How>>, known: ShapeSet) -> bool {
        for case in cases.iter_mut() {
            case.shapes = self.graph.shapes.intersection(case.shapes, known);
        }
        cases.retain(|case| !self.graph.shapes.members(case.shapes).is_empty());
        !cases.is_empty() && cases.len() <= MAX_CASES
    }

    /// `by_shape` stands in for the caches, and `add` tells whether it has made something of the case. `None` if there
    /// is nothing better than the caches.
    fn plan<How>(
        &mut self,
        object: Ssa,
        seen: &Seen<'_>,
        may_search: bool,
        by_shape: impl Fn(Gc<Shape>) -> Option<AccessCase>,
        add: impl Fn(&mut Self, &mut RootVec<Case<How>>, Gc<Shape>, &AccessCase) -> bool,
    ) -> Option<Plan<How>> {
        let known = self.knowledge.shapes_of(&mut self.graph, object);
        let (mut cases, mut is_complete) = (root_vec(), !gave_up(seen.list));
        let mut covered: SmallVec<[ShapeId; MAX_CASES]> = SmallVec::new();
        let members: SmallVec<[_; MAX_CASES]> = match known {
            ShapeSet::ANY => SmallVec::new(),
            _ => self.graph.shapes.members(known).into(),
        };
        seen.for_each(|case| {
            if !is_real(case.shape()) {
                return is_complete = false;
            }
            let shape = self.cached_shape(case.shape());
            if !members.is_empty() && !members.iter().any(|&it| self.shape_at(it) == shape) {
                return;
            }
            let renewed = (!case.is_valid()).then(|| by_shape(shape));
            match renewed.as_ref().map_or(Some(case), Option::as_ref) {
                Some(case) if add(self, &mut cases, shape, case) => covered.push(shape.id()),
                Some(_) => is_complete = false,
                None => {}
            }
        });
        let mut is_proven = known != ShapeSet::ANY;
        for member in members {
            let shape = self.shape_at(member);
            is_proven &= covered.contains(&shape.id())
                || by_shape(shape).is_some_and(|case| add(self, &mut cases, shape, &case));
        }
        let (has_cases, summary) = (self.narrow(&mut cases, known), seen.list.summary());
        let has_bad_type = self.has_exited(ExitKind::BadType);
        let may_exit = is_complete && !has_bad_type && !self.has_exited(ExitKind::BadShape);
        let otherwise = if has_cases && (is_proven || may_exit) {
            Otherwise::Exit
        } else if may_search
            && summary.is_plain()
            // As long as there is another tier to come, the caches are to go on learning.
            && (seen.list.is_megamorphic() || has_cases && self.is_full())
            && (self.is(object, T::OBJECT)
                || !has_bad_type && T::OBJECT.contains(self.expected(object)))
            && !self.has_exited(ExitKind::ExoticObject)
        {
            Otherwise::Search
        } else {
            Otherwise::UseCache
        };
        (has_cases || otherwise == Otherwise::Search).then_some(Plan {
            cases,
            otherwise,
            may_search,
            usual_byte_offset: summary.usual_byte_offset(),
        })
    }

    /// Runs `translate` for each case in a block of its own. It gives the result, if there is one and control goes on.
    pub(super) fn for_each_case<How: Copy>(
        &mut self,
        object: Ssa,
        cases: &[Case<How>],
        mut translate: impl FnMut(&mut Self, Ssa, ShapeSet, How) -> Built<Option<Ssa>>,
    ) -> Built<Option<Ssa>> {
        if let [only] = cases {
            let object = self.check_shapes(object, only.shapes);
            return translate(self, object, only.shapes, only.how);
        }
        self.check_type(object, T::CELL);
        self.for_each_case_or(object, cases, translate, |this| {
            this.force_exit(ExitKind::BadShape);
            None
        })
    }

    /// The same, with something to do for all other values.
    fn for_each_case_or<How: Copy>(
        &mut self,
        object: Ssa,
        cases: &[Case<How>],
        mut translate: impl FnMut(&mut Self, Ssa, ShapeSet, How) -> Built<Option<Ssa>>,
        otherwise: impl FnOnce(&mut Self) -> Option<Ssa>,
    ) -> Built<Option<Ssa>> {
        if cases.is_empty() {
            return Ok(otherwise(self));
        }
        if T::CELL.contains(self.expected(object)) && !self.has_exited(ExitKind::BadType) {
            self.check_type(object, T::CELL);
        }
        let (start, mut other) = (self.fork_later(), Junction::default());
        let is_cell = self.is_type(object, T::CELL);
        self.leave_unless(is_cell, Odds::Low, &mut other);
        let cell = self.alias(object);
        let id = self.node(Kind::LoadShapeId, &[cell], 0);
        let mut fork = self.fork();
        let blocks: SmallVec<[_; 9]> = (0..=cases.len())
            .map(|_| self.graph.function.new_block())
            .collect();
        let mut keys: SmallVec<[(i64, Successor<'_>); 8]> = SmallVec::new();
        for (case, &block) in cases.iter().zip(&blocks) {
            let shapes = &self.graph.shapes;
            let ids = (shapes.members(case.shapes).iter()).map(|&it| shapes[it].id.bits() as i32);
            keys.extend(ids.map(|id| (id.into(), block.into())));
        }
        self.ir().switch(id, &keys, blocks[cases.len()].rare());
        for (case, &block) in cases.iter().zip(&blocks) {
            self.take_way(&fork, block);
            let refined = self.refine_shapes(cell, case.shapes);
            let result = translate(self, refined, case.shapes, case.how)?;
            self.end_way(&mut fork, result);
        }
        self.take_way(&fork, blocks[cases.len()]);
        if !other.edges.is_empty() {
            self.leave_for(&mut other, None);
            self.resume_at(&start, &other);
        }
        let result = otherwise(self);
        self.end_way(&mut fork, result);
        Ok(self.end_fork(&fork))
    }

    /// Below a branch that tells them.
    pub(super) fn refine_shapes(&mut self, cell: Ssa, shapes: ShapeSet) -> Ssa {
        let alias = self.alias(cell);
        let refined = self.insert_node(Kind::RefineShape, &[alias], shapes.0, State::NONE);
        (self.knowledge).learn_shapes(&self.graph, cell, shapes, refined);
        refined
    }

    fn follow<How: Copy>(
        &mut self,
        object: Ssa,
        plan: &Plan<How>,
        translate: impl FnMut(&mut Self, Ssa, ShapeSet, How) -> Built<Option<Ssa>>,
        search: impl FnOnce(&mut Self, Ssa) -> Option<Ssa>,
        use_cache: impl FnOnce(&mut Self) -> Option<Ssa>,
    ) -> Built<Option<Ssa>> {
        match plan.otherwise {
            Otherwise::Exit => self.for_each_case(object, &plan.cases, translate),
            Otherwise::UseCache => self.for_each_case_or(object, &plan.cases, translate, use_cache),
            Otherwise::Search => {
                let object = self.check_type(object, T::OBJECT);
                let search = |this: &mut Self| search(this, object);
                self.for_each_case_or(object, &plan.cases, translate, search)
            }
        }
    }

    pub(super) fn rely_on(&mut self, lookup: Gc<PrototypeLookup>) {
        self.dependencies.keep(lookup.cell());
        let is_valid = self.watch(lookup.dependents());
        debug_assert!(is_valid);
    }

    fn call_accessor(
        &mut self,
        function: Gc<JsFunction>,
        arguments: &[Ssa],
        (dst, metadata): (Option<Register>, u32),
    ) -> Built<Option<Ssa>> {
        let site = CallSite {
            kind: CallKind::Accessor,
            dst,
            callee: self.cell(function.cell()),
            arguments,
            metadata,
        };
        self.call_executable(&site, Some(function.executable()))
    }
}
