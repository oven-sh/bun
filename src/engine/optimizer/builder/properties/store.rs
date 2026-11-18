//! Stores.

use bun_engine_bytecode::{MetadataKind, PutFlags, op};
use bun_engine_codegen::ir::{Heap, State, Value as Ssa};
use bun_engine_text::PropertyName;
use bun_engine_vm::ic::{
    AccessCase, AccessCases, AccessKind, PrototypeLookup, StoreCache, StoreMode,
};
use bun_engine_vm::{
    ElementKind, Gc, GetterSetter, GlobalLexicals, GlobalObject, JsFunction, JsObject, Shape,
};

use super::custom::Custom;
use super::{Plan, Seen, inherited_accessor};
use crate::builder::{Builder, Built};
use crate::graph::{Cache, ExitKind, Kind, ShapeIndex, Transition, heaps};

#[derive(Clone, Copy, PartialEq)]
pub(in crate::builder) enum Store {
    Replace(i32),
    Add {
        byte_offset: i32,
        to: ShapeIndex,
        lookup: Gc<PrototypeLookup>,
    },
    Setter(Gc<PrototypeLookup>, Gc<JsFunction>),
    InHolder(Gc<PrototypeLookup>),
    /// The address of a `GlobalBinding`, and what has it.
    Binding(Gc<GlobalObject>, usize),
    Custom(Custom),
    /// With a kind that has the same word for a hole.
    ArrayLength(ElementKind),
}

impl Builder<'_> {
    fn store_for(
        &mut self,
        name: PropertyName<'_>,
        shape: Gc<Shape>,
        case: &AccessCase,
    ) -> Option<Store> {
        Some(match case.kind() {
            AccessKind::Replace => Store::Replace(case.byte_offset()),
            AccessKind::Transition | AccessKind::TransitionAndGrow => {
                let new_shape = self.cached_shape(case.new_shape());
                Store::Add {
                    byte_offset: case.byte_offset(),
                    to: self.shape(new_shape),
                    lookup: case.lookup()?,
                }
            }
            AccessKind::SetArrayLength if self.may_set_length() => {
                Store::ArrayLength(match shape.instance_indexing_mode().kind() {
                    ElementKind::Double => ElementKind::Double,
                    _ => ElementKind::Contiguous,
                })
            }
            AccessKind::CallInheritedSetter => {
                let (lookup, setter) = inherited_accessor(case, &shape, GetterSetter::setter)?;
                Store::Setter(lookup, setter)
            }
            AccessKind::CallCustomAccessorSetter | AccessKind::CallCustomValueSetter => {
                Store::Custom(self.custom_for(&shape, case)?)
            }
            AccessKind::ThroughGlobalProxy => {
                self.find_global_to_assign(shape.global()?, name, GlobalLexicals::Hidden)?
            }
            _ => return None,
        })
    }

    pub(in crate::builder) fn store_in_holder(
        &mut self,
        lookup: Gc<PrototypeLookup>,
        name: PropertyName<'_>,
        value: Ssa,
    ) {
        let holder = self.cell(lookup.holder().expect("valid").cell());
        let (base, heap) = (
            self.slot_base(holder, lookup.byte_offset()),
            self.named_heap(name),
        );
        self.store_value(holder, base, lookup.byte_offset(), heap, value);
    }

    pub(in crate::builder) fn put_by_id(&mut self, op: op::PutById) -> Built {
        let code_block = self.frame().code_block;
        let code_block = code_block.anchor();
        let cache = code_block.checked_metadata::<StoreCache>(MetadataKind::PutById, op.metadata);
        if !cache.has_run() && !self.has_exited(ExitKind::NeverExecuted) {
            self.force_exit(ExitKind::NeverExecuted);
            return Ok(());
        }
        let (object, value, name) = (
            self.get(op.base),
            self.get(op.value),
            code_block.identifier(op.name),
        );
        let kind = if op.flags.contains(PutFlags::DIRECT) {
            Cache::PutByIdDirect
        } else if op.flags.contains(PutFlags::STRICT) {
            Cache::PutByIdStrict
        } else {
            Cache::PutById
        };
        let use_cache = |this: &mut Self| {
            let operands = [object, this.name(name), value];
            this.cached(kind, cache, &operands);
        };
        let (only, list) = (cache.only_case(), cache.all_cases());
        let defines = kind == Cache::PutByIdDirect;
        let Some(plan) = self.plan_store(object, name, defines, only, list) else {
            use_cache(self);
            return Ok(());
        };
        self.store_as_planned([object, value], name, &plan, op.metadata, use_cache)
    }

    pub(in crate::builder) fn plan_store(
        &mut self,
        object: Ssa,
        name: PropertyName<'_>,
        defines: bool,
        only: Option<AccessCase>,
        list: &AccessCases,
    ) -> Option<Plan<Store>> {
        let (vm, is_strict) = (self.vm, true);
        let mode = if defines {
            StoreMode::Define { is_strict }
        } else {
            StoreMode::Set { is_strict }
        };
        self.plan(
            object,
            &Seen { name, only, list },
            !defines && !name.is_private(),
            |shape| AccessCase::for_store(vm, shape, name, mode),
            |this, cases, shape, case| {
                let how = this.store_for(name, shape, case);
                let merges = !matches!(how, Some(Store::Add { .. }));
                how.map(|how| this.add_case(cases, shape, how, merges))
                    .is_some()
            },
        )
    }

    pub(in crate::builder) fn store_as_planned(
        &mut self,
        [object, value]: [Ssa; 2],
        name: PropertyName<'_>,
        plan: &Plan<Store>,
        metadata: u32,
        use_cache: impl FnOnce(&mut Self),
    ) -> Built {
        let heap = self.named_heap(name);
        let translate = |this: &mut Self, object, shapes: crate::graph::ShapeSet, how| {
            match how {
                Store::Replace(byte_offset) => {
                    let base = this.slot_base(object, byte_offset);
                    this.store_value(object, base, byte_offset, heap, value);
                }
                Store::Add {
                    byte_offset,
                    to,
                    lookup,
                } => {
                    this.rely_on(lookup);
                    let from = shapes.only().expect("not merged");
                    this.add_property(object, Transition { from, to }, byte_offset, heap, value);
                }
                Store::Custom(custom) => this.set_custom(custom, [object, value], name),
                Store::InHolder(lookup) => this.store_in_holder(lookup, name, value),
                Store::Binding(global, address) => this.store_binding(global, address, value),
                Store::ArrayLength(kind) => this.set_length(object, kind, value),
                Store::Setter(lookup, setter) => {
                    this.rely_on(lookup);
                    this.call_accessor(setter, &[object, value], (None, metadata))?;
                }
            }
            Ok(None)
        };
        let search = |this: &mut Self, object| {
            this.search_and_store(object, name, heap, value);
            None
        };
        let use_cache = |this: &mut Self| {
            use_cache(this);
            None
        };
        self.follow(object, plan, translate, search, use_cache)?;
        Ok(())
    }

    fn search_and_store(&mut self, object: Ssa, name: PropertyName<'_>, heap: Heap, value: Ssa) {
        let (value, data) = (self.graph.root(value), self.slot_search(name, None));
        let slot = self.node(Kind::SearchForStore, &[object, value], data);
        self.store_into(object, slot, 0, heap, value);
        self.insert_node(Kind::StoreBarrier, &[object], 0, State::NONE);
        self.node(Kind::MayHaveFired, &[], 0);
    }

    pub(in crate::builder) fn add_property(
        &mut self,
        object: Ssa,
        transition: Transition,
        byte_offset: i32,
        heap: Heap,
        value: Ssa,
    ) {
        self.graph.transitions.push(transition);
        let data = self.graph.transitions.len() as u32 - 1;
        let capacity = |shape| self.graph.shapes[shape].out_of_line_capacity;
        let base = if capacity(transition.from) == capacity(transition.to) {
            self.slot_base(object, byte_offset)
        } else {
            let (kind, state) = (Kind::GrowSlots, State::NONE);
            let storage = self.insert_node(kind, &[object], data, state);
            (self.knowledge).note_effects(&self.graph, kind.effects(), kind.can_collect());
            self.knowledge.learn_field(
                self.graph.root(object),
                JsObject::OFFSET_OF_STORAGE as i32,
                heaps::STORAGE,
                storage,
            );
            storage
        };
        let value = self.graph.root(value);
        self.store_into(object, base, byte_offset, heap, value);
        self.insert_node(Kind::SetShape, &[object], data, State::NONE);
        self.knowledge
            .note_transition(&mut self.graph, object, transition);
        self.insert_node(Kind::StoreBarrier, &[object], 0, State::NONE);
    }
}
