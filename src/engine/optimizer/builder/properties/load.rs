//! Loads.

use bun_engine_bytecode::{MetadataKind, Operand, Register, op};
use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_text::{PropertyName, names};
use bun_engine_vm::code::metadata::GetById;
use bun_engine_vm::ic::{
    AccessCase, AccessCases, AccessKind, BOOLEAN_SHAPE, LoadCache, NUMBER_SHAPE, PrototypeLookup,
};
use bun_engine_vm::{
    ElementType, Gc, GetterSetter, GlobalLexicals, JsFunction, JsObject, Shape,
    SpeculatedType as T, Value, WatchpointState,
};

use super::custom::Custom;
use super::{Otherwise, Plan, Seen, inherited_accessor};
use crate::builder::targets::{Choice, HAS_CHOSEN};
use crate::builder::{Builder, Built};
use crate::graph::probes::Claim;
use crate::graph::{Cache, ExitKind, Kind, LOOKED_UP, ShapeSet, SlotSearch, heaps};

#[derive(Clone, Copy, PartialEq)]
pub(in crate::builder) enum Load {
    Own(i32),
    Inherited(Gc<PrototypeLookup>),
    Constant(Value),
    /// With the logarithm of the size of an element, if that matters.
    OfView(AccessKind, u32),
    /// `ArrayLength`, `StringLength`, `ArgumentsLength` or `CollectionSize`.
    Count(AccessKind),
    /// The accessor does not change. If it is inherited, the lookup has found it.
    Getter(Option<Gc<PrototypeLookup>>, Gc<JsFunction>),
    Custom(Custom),
    /// The address of a `GlobalBinding`.
    Binding(usize),
}

impl Builder<'_> {
    fn load_for(
        &mut self,
        object: Ssa,
        name: PropertyName<'_>,
        shape: Gc<Shape>,
        case: &AccessCase,
    ) -> Option<Load> {
        Some(match case.kind() {
            AccessKind::LoadOwn => Load::Own(case.byte_offset()),
            AccessKind::LoadConstant | AccessKind::LoadInherited => {
                let lookup = case.lookup()?;
                let how = match lookup.constant() {
                    Some(constant) => Load::Constant(constant),
                    None => lookup.has_slot().then_some(Load::Inherited(lookup))?,
                };
                self.rely_on(lookup);
                how
            }
            AccessKind::LoadPrototype => {
                self.rely_on(case.lookup()?);
                Load::Constant(case.answer()?)
            }
            AccessKind::CallInheritedGetter => {
                let (lookup, getter) = inherited_accessor(case, &shape, GetterSetter::getter)?;
                Load::Getter(Some(lookup), getter)
            }
            AccessKind::CallOwnGetter => {
                let shapes = ShapeSet::single(self.shape(shape));
                let accessor = self.settled_property(object, shapes, name)?;
                let getter = accessor.downcast::<GetterSetter>()?.getter()?;
                Load::Getter(None, getter.downcast()?)
            }
            AccessKind::CallCustomAccessorGetter | AccessKind::CallCustomValueGetter => {
                Load::Custom(self.custom_for(&shape, case)?)
            }
            AccessKind::ThroughGlobalProxy => {
                self.find_global(shape.global()?, name, GlobalLexicals::Hidden)?
            }
            kind @ (AccessKind::TypedArrayLength | AccessKind::TypedArrayByteOffset) => {
                self.rely_on(case.lookup()?);
                Load::OfView(kind, 0)
            }
            kind @ (AccessKind::DataViewByteLength | AccessKind::ResizableTypedArrayByteOffset) => {
                self.rely_on(case.lookup()?);
                Load::OfView(kind, shape.instance_type().0.into())
            }
            kind @ (AccessKind::ArrayLength
            | AccessKind::StringLength
            | AccessKind::ArgumentsLength
            | AccessKind::CollectionSize)
                if !self.has_exited(ExitKind::ExoticObject) =>
            {
                case.lookup().inspect(|&lookup| self.rely_on(lookup));
                Load::Count(kind)
            }
            kind @ (AccessKind::TypedArrayByteLength
            | AccessKind::ResizableTypedArrayByteLength
            | AccessKind::ResizableTypedArrayLength) => {
                self.rely_on(case.lookup()?);
                let of = ElementType::of_cell_type(shape.instance_type())?;
                Load::OfView(kind, of.size_shift())
            }
            _ => return None,
        })
    }

    fn settled_property(
        &mut self,
        object: Ssa,
        shapes: ShapeSet,
        name: PropertyName<'_>,
    ) -> Option<Value> {
        let (constant, shape) = (
            self.constant_cell::<JsObject>(object)?,
            self.shape_at(shapes.only()?),
        );
        let (offset, _) = shape.get(name).filter(|_| constant.shape() == shape)?;
        let replacement = shape
            .ensure_replacement_watchpoints(offset)
            .filter(|set| set.state() != WatchpointState::Invalidated)?;
        // Another shape could have another value in the slot by the time the object is back at this one.
        if !self.watch(shape.transition_watchpoints()) {
            return None;
        }
        self.watch_shared(replacement);
        Some(constant.get_direct_at(offset))
    }

    pub(in crate::builder) fn load_own(
        &mut self,
        object: Ssa,
        shapes: ShapeSet,
        name: PropertyName<'_>,
        byte_offset: i32,
        metadata: u32,
    ) -> Option<Ssa> {
        if let Some(value) = self.settled_property(object, shapes, name) {
            return Some(self.value(value));
        }
        let (base, heap) = (self.slot_base(object, byte_offset), self.named_heap(name));
        if let Some(known) = self
            .knowledge
            .field(self.graph.root(base), byte_offset, heap)
        {
            self.verify(Claim::Field(byte_offset, 8, heap), &[base, known]);
            return Some(known);
        }
        let prediction = self.prediction_or_exit(metadata)?;
        let value = self.load_value_of_type((base, byte_offset, heap), prediction, T::HEAP_TOP);
        self.note_profile(value, metadata);
        Some(value)
    }

    pub(in crate::builder) fn load_inherited(
        &mut self,
        lookup: Gc<PrototypeLookup>,
        name: PropertyName<'_>,
        metadata: u32,
    ) -> Option<Ssa> {
        let holder = self.cell(lookup.holder().expect("valid").cell());
        self.load_own(holder, ShapeSet::ANY, name, lookup.byte_offset(), metadata)
    }

    fn search_and_load(
        &mut self,
        object: Ssa,
        name: PropertyName<'_>,
        usual_byte_offset: Option<i32>,
        metadata: u32,
    ) -> Option<Ssa> {
        let (root, heap) = (self.graph.root(object), self.named_heap(name));
        let prediction = self.prediction_or_exit(metadata)?;
        let data = self.slot_search(name, usual_byte_offset);
        let value = self.profiled_node(Kind::SearchAndLoad, &[object], data, prediction);
        self.note_profile(value, metadata);
        self.knowledge.learn_field(root, LOOKED_UP, heap, value);
        Some(value)
    }

    /// The data of a node.
    pub(super) fn slot_search(
        &mut self,
        name: PropertyName<'_>,
        usual_byte_offset: Option<i32>,
    ) -> u32 {
        let is_for_name = |it: &SlotSearch| it.name.is_some_and(|it| it.0 == name.address());
        if let Some(position) = self.graph.searches.iter().position(is_for_name) {
            return position as u32;
        }
        self.graph.searches.push(SlotSearch {
            name: Some((name.address(), bun_engine_vm::caches::name_hash(name))),
            usual_byte_offset,
        });
        self.graph.searches.len() as u32 - 1
    }

    pub(in crate::builder) fn get_by_id(
        &mut self,
        dst: Register,
        base: Operand,
        name: PropertyName<'_>,
        (cache, kind): (&LoadCache, Cache<LoadCache>),
        metadata: u32,
    ) -> Built {
        let object = self.get(base);
        if let Some(value) = self.method_of_primitive(object, cache) {
            self.set(dst, value);
            return Ok(());
        }
        let use_cache = |this: &mut Self| {
            let operands = [object, this.name(name)];
            this.cached_load(kind, cache, &operands, metadata)
        };
        let (only, list) = (cache.only_case(), cache.all_cases());
        let inherits = kind != Cache::GetByIdDirect;
        let result = match self.plan_load(object, name, inherits, only, list) {
            Some(plan) => self.load_as_planned(dst, object, name, &plan, metadata, use_cache)?,
            None => use_cache(self),
        };
        result.inspect(|&result| self.set(dst, result));
        Ok(())
    }

    pub(in crate::builder) fn plan_load(
        &mut self,
        object: Ssa,
        name: PropertyName<'_>,
        inherits: bool,
        only: Option<AccessCase>,
        list: &AccessCases,
    ) -> Option<Plan<Load>> {
        let vm = self.vm;
        self.plan(
            object,
            &Seen { name, only, list },
            inherits && !name.is_private(),
            |shape| {
                let case = AccessCase::for_load(vm, shape, name);
                case.filter(|it| inherits || it.kind() == AccessKind::LoadOwn)
            },
            |this, cases, shape, case| {
                let how = this.load_for(object, name, shape, case);
                how.map(|how| this.add_case(cases, shape, how, true))
                    .is_some()
            },
        )
    }

    pub(in crate::builder) fn load_as_planned(
        &mut self,
        dst: Register,
        object: Ssa,
        name: PropertyName<'_>,
        plan: &Plan<Load>,
        metadata: u32,
        use_cache: impl FnOnce(&mut Self) -> Option<Ssa>,
    ) -> Built<Option<Ssa>> {
        let (root, heap) = (self.graph.root(object), self.named_heap(name));
        if let Some(known) =
            (self.knowledge.field(root, LOOKED_UP, heap)).filter(|_| plan.may_search)
        {
            return Ok(Some(known));
        }
        let translate = |this: &mut Self, object, shapes, how| match how {
            Load::Own(offset) => Ok(this.load_own(object, shapes, name, offset, metadata)),
            Load::Inherited(lookup) => Ok(this.load_inherited(lookup, name, metadata)),
            Load::Constant(value) => Ok(Some(this.value(value))),
            Load::Count(what) => Ok(Some(this.count(object, what))),
            Load::OfView(what, _) => Ok(this.measure_view(object, shapes, what, metadata)),
            Load::Getter(lookup, getter) => {
                lookup.inspect(|&lookup| this.rely_on(lookup));
                this.call_accessor(getter, &[object], (Some(dst), metadata))
            }
            Load::Custom(custom) => Ok(this.get_custom(custom, object, name, metadata)),
            Load::Binding(address) => Ok(this.load_binding(address, metadata)),
        };
        let search = |this: &mut Self, object| {
            this.search_and_load(object, name, plan.usual_byte_offset, metadata)
        };
        let result = self.follow(object, plan, translate, search, use_cache)?;
        result.inspect(|&result| self.note_choice(result, root, plan));
        Ok(result)
    }

    fn note_choice(&mut self, value: Ssa, object: Ssa, plan: &Plan<Load>) {
        const KEPT: usize = 4;
        if plan.otherwise != Otherwise::Exit || plan.cases.len() < 2 {
            return;
        }
        let ways = plan.cases.iter().map(|case| match case.how {
            Load::Constant(constant) => Some((self.value(constant), case.shapes)),
            _ => None,
        });
        if let Some(ways) = ways.collect() {
            (self.knowledge).learn_field(object, HAS_CHOSEN, heaps::SHAPE, value);
            self.choices.truncate(KEPT - 1);
            self.choices.push_front(Choice {
                value,
                object,
                ways,
                own_ways: 0,
            });
        }
    }

    /// For what is neither an array, a string nor an arguments object. Calls nothing.
    pub(in crate::builder) fn try_to_load_length(
        &mut self,
        op: op::GetLength,
        object: Ssa,
        cache: &LoadCache,
    ) -> Option<Option<Ssa>> {
        let (name, only, list) = (names::length, cache.only_case(), cache.all_cases());
        let mut plan = self.plan_load(object, name, true, only, list)?;
        (plan.cases).retain(|case| !matches!(case.how, Load::Count(_)));
        if plan.otherwise != Otherwise::Exit
            || plan.cases.is_empty()
            || (plan.cases.iter()).any(|it| matches!(it.how, Load::Getter(..) | Load::Custom(_)))
        {
            return None;
        }
        (self.load_as_planned(op.dst, object, name, &plan, op.metadata, |_| unreachable!())).ok()
    }

    /// Of a number or a boolean.
    fn method_of_primitive(&mut self, base: Ssa, cache: &LoadCache) -> Option<Ssa> {
        let ty = match cache.shape() {
            NUMBER_SHAPE => T::BOXED_NUMBER,
            BOOLEAN_SHAPE => T::BOOLEAN,
            _ => return None,
        };
        let lookup = cache.inline_lookup().filter(|it| it.is_valid())?;
        let constant = lookup.constant()?;
        if self.has_exited(ExitKind::BadType) && !self.is(base, ty) {
            return None;
        }
        self.check_type(base, ty);
        self.rely_on(lookup);
        Some(self.value(constant))
    }

    pub(in crate::builder) fn get_cached(
        &mut self,
        dst: Register,
        base: Operand,
        name: PropertyName<'_>,
        kind: MetadataKind,
        metadata: u32,
    ) -> Built {
        let code_block = self.frame().code_block;
        let code_block = code_block.anchor();
        let cache = &code_block.checked_metadata::<GetById>(kind, metadata).cache;
        let generic = if kind == MetadataKind::GetByIdDirect {
            Cache::GetByIdDirect
        } else {
            Cache::GetById
        };
        self.get_by_id(dst, base, name, (cache, generic), metadata)
    }
}
