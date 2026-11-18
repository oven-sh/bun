//! `instanceof`, `in`, `delete` and prototypes.

use bun_engine_bytecode::{MetadataKind, Register, op};
use bun_engine_codegen::ir::{State, Type, Value as Ssa};
use bun_engine_vm::code::metadata::Flags;
use bun_engine_vm::ic::{AccessCases, AccessKind, PrototypeLookup, SeenCase};
use bun_engine_vm::{
    Gc, JsCell, JsObject, RootVec, Shape, ShapeFlags, SpeculatedType as T, TypeFlags, Value,
    root_vec,
};

use super::fork::Odds;
use super::properties::{Case, gave_up};
use super::{Builder, Built};
use crate::graph::{Cache, ExitKind, Kind, ShapeIndex, ShapeSet, Transition, heaps};

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Reply {
    Answer(bool),
    Delete { byte_offset: i32, to: ShapeIndex },
}

fn has_ordinary_prototype(shape: &Shape) -> bool {
    shape.instance_type().is_object()
        && !(shape.type_flags()).contains(TypeFlags::OVERRIDES_GET_PROTOTYPE)
}

impl Builder<'_> {
    fn may_check_shapes(&self) -> bool {
        !self.has_exited(ExitKind::BadShape) && !self.has_exited(ExitKind::BadType)
    }

    pub(super) fn plan_replies(
        &mut self,
        object: Ssa,
        list: &AccessCases,
        applies: impl Fn(&SeenCase) -> bool,
    ) -> Option<RootVec<Case<Reply>>> {
        if !self.may_check_shapes() || gave_up(list) {
            return None;
        }
        let (mut cases, mut lookups) = (root_vec(), root_vec());
        for case in list.iter().filter(|it| it.is_valid() && applies(it)) {
            let shape = self.cached_shape(case.shape());
            let reply = match case.answer() {
                Some(answer) => Reply::Answer(answer.is_true()),
                None if case.kind() == AccessKind::Delete => {
                    let to = self.cached_shape(case.new_shape());
                    let (byte_offset, to) = (case.byte_offset(), self.shape(to));
                    Reply::Delete { byte_offset, to }
                }
                None => return None,
            };
            lookups.extend(case.lookup());
            self.add_case(&mut cases, shape, reply, matches!(reply, Reply::Answer(_)));
        }
        let known = self.knowledge.shapes_of(&mut self.graph, object);
        self.narrow(&mut cases, known).then(|| {
            lookups.iter().for_each(|&lookup| self.rely_on(lookup));
            cases
        })
    }

    /// If it is only there to be jumped on, each case jumps by itself, and takes along what it knows.
    pub(super) fn reply_as_planned(
        &mut self,
        dst: Register,
        object: Ssa,
        cases: &[Case<Reply>],
        next: u32,
    ) -> Built {
        let result = self.for_each_case(object, cases, |this, object, shapes, reply| {
            let answer = match reply {
                Reply::Answer(answer) => answer,
                Reply::Delete { byte_offset, to } => {
                    let from = shapes.only().expect("not merged");
                    this.remove_property(object, Transition { from, to }, byte_offset);
                    true
                }
            };
            let answer = this.value(Value::boolean(answer));
            Ok((!this.try_goto_with(&[(dst, answer)], next)).then_some(answer))
        })?;
        result.inspect(|&result| self.set(dst, result));
        Ok(())
    }

    fn remove_property(&mut self, object: Ssa, transition: Transition, byte_offset: i32) {
        self.graph.transitions.push(transition);
        let data = self.graph.transitions.len() as u32 - 1;
        let (base, empty) = (self.slot_base(object, byte_offset), self.empty());
        self.insert_node(Kind::SetShape, &[object], data, State::NONE);
        (self.knowledge).note_transition(&mut self.graph, object, transition);
        // The slot may be that of another name next.
        self.store_into(object, base, byte_offset, heaps::NAMED, empty);
        self.insert_node(Kind::StoreBarrier, &[object], 0, State::NONE);
    }

    /// False if it has never run, in which case the code exits.
    pub(super) fn has_run_or_exit(&mut self, has_run: bool) -> bool {
        if !has_run && !self.has_exited(ExitKind::NeverExecuted) {
            self.force_exit(ExitKind::NeverExecuted);
        }
        !self.block.is_none()
    }

    fn query_by_id(
        &mut self,
        cache: Cache<AccessCases>,
        (dst, object, name): (Register, Ssa, bun_engine_bytecode::IdentifierIndex),
        metadata: u32,
        next: u32,
    ) -> Built {
        let code_block = self.frame().code_block;
        let list = (code_block.anchor()).checked_metadata(MetadataKind::LazyCache, metadata);
        if !self.has_run_or_exit(AccessCases::has_run(list)) {
            return Ok(());
        }
        if let Some(cases) = self.plan_replies(object, list, |_| true) {
            return self.reply_as_planned(dst, object, &cases, next);
        }
        let operands = [object, self.name(code_block.identifier(name))];
        let answer = self.cached_test(cache, list, &operands);
        self.set(dst, answer);
        Ok(())
    }

    pub(super) fn in_by_id(&mut self, op: op::InById, next: u32) -> Built {
        let base = self.get_value(op.base);
        self.query_by_id(Cache::InById, (op.dst, base, op.name), op.metadata, next)
    }

    pub(super) fn delete_by_id(&mut self, op: op::DeleteById, next: u32) -> Built {
        let cache = if op.strict {
            Cache::DeleteByIdStrict
        } else {
            Cache::DeleteById
        };
        let base = self.get_value(op.base);
        self.query_by_id(cache, (op.dst, base, op.name), op.metadata, next)
    }

    pub(super) fn delete_by_val(&mut self, op: op::DeleteByVal) {
        let cache = if op.strict {
            Cache::DeleteByValStrict
        } else {
            Cache::DeleteByVal
        };
        let (code_block, kind) = (self.frame().code_block, MetadataKind::LazyCache);
        let list = (code_block.anchor()).checked_metadata::<AccessCases>(kind, op.metadata);
        let operands = [self.get_value(op.base), self.get_value(op.key)];
        let answer = self.cached_test(cache, list, &operands);
        self.set(op.dst, answer);
    }

    // Prototypes

    /// The shapes that the object is known to have or, if it is always the same, has just been checked to have.
    fn shapes_of_familiar(&mut self, object: Ssa) -> ShapeSet {
        let known = self.knowledge.shapes_of(&mut self.graph, object);
        match self.constant_cell::<JsObject>(object) {
            Some(constant) if known == ShapeSet::ANY && self.may_check_shapes() => {
                let shapes = ShapeSet::single(self.shape(constant.shape()));
                self.check_shapes(object, shapes);
                shapes
            }
            _ => known,
        }
    }

    fn common_prototype(&mut self, shapes: ShapeSet) -> Option<Value> {
        if shapes == ShapeSet::ANY {
            return None;
        }
        let mut members = (self.graph.shapes.members(shapes).iter()).map(|&it| self.shape_at(it));
        let prototype = members.clone().next()?.prototype();
        (members.all(|it| has_ordinary_prototype(&it) && it.prototype() == prototype))
            .then_some(prototype)
    }

    pub(super) fn prototype_of(&mut self, value: Ssa, prediction: T) -> Ssa {
        let shapes = self.shapes_of_familiar(value);
        if let Some(prototype) = self.common_prototype(shapes) {
            return self.value(prototype);
        }
        let prediction = prediction & (T::OBJECT | T::NULL);
        if T::OBJECT.contains(self.expected(value)) && !self.has_exited(ExitKind::ExoticObject) {
            let object = self.check_type_or(value, T::OBJECT, ExitKind::ExoticObject);
            self.profiled_node(Kind::LoadPrototype, &[object], 0, prediction)
        } else {
            let value = self.alias(value);
            self.profiled_node(Kind::GenericGetPrototypeOf, &[value], 0, prediction)
        }
    }

    pub(super) fn get_prototype_of(&mut self, op: op::GetPrototypeOf) {
        if let Some(prediction) = self.prediction_or_exit(op.metadata) {
            let value = self.get_value(op.value);
            let prototype = self.prototype_of(value, prediction);
            self.set(op.dst, prototype);
        }
    }

    pub(super) fn has_shape_with_flags(&mut self, op: op::HasShapeWithFlags) -> Ssa {
        let object = self.get_value(op.object);
        let object = self.alias(object);
        let (shape, offset) = (
            self.node(Kind::LoadShape, &[object], 0),
            Shape::OFFSET_OF_FLAGS as i32,
        );
        let flags = self.load(Type::I32, shape, offset, heaps::OTHER_FIELDS);
        let common = (self.ir()).and(flags, ShapeFlags::from_bits_retain(op.flags).bits());
        self.ir().is_not_zero(common)
    }

    // `instanceof`

    fn has_type_flag(&mut self, cell: Ssa, flag: TypeFlags) -> Ssa {
        match self.constant_cell::<JsCell>(cell) {
            Some(constant) => self.int32(constant.inline_flags().contains(flag).into()),
            None => {
                let cell = self.alias(cell);
                self.node(Kind::HasTypeFlag, &[cell], flag.bits())
            }
        }
    }

    pub(super) fn instanceof_custom(&mut self, op: op::InstanceofCustom, next: u32) {
        let (code_block, done) = (self.frame().code_block, op.done.from(self.frame().offset));
        let was_custom = (code_block
            .checked_metadata::<Flags>(MetadataKind::Branch, op.metadata)
            .0)
            .get()
            != 0;
        let (value, constructor, method) = (
            self.get_value(op.value),
            self.get_value(op.constructor),
            self.get_value(op.has_instance),
        );
        let default = self.global().function_prototype_has_instance(self.vm);
        let (default, method) = (self.cell(default.cell()), self.graph.root(method));
        let flag = TypeFlags::IMPLEMENTS_DEFAULT_HAS_INSTANCE;
        let is_ordinary = self.has_type_flag(constructor, flag);
        let by_default = |this: &mut Self| {
            let is_object = this.is_type(value, T::OBJECT);
            this.choose(is_object, Odds::Even, |this, is_object| {
                if is_object {
                    this.goto_with(&[], next);
                } else {
                    let no = this.value(Value::FALSE);
                    this.goto_with(&[(op.dst, no)], done);
                }
                None
            })
        };
        if !was_custom && !self.has_exited(ExitKind::BadIdentity) {
            self.check_identical(method, default);
            let is_special = self.not(is_ordinary);
            self.exit_if(is_special, ExitKind::BadIdentity);
            by_default(self);
            return;
        }
        let has_default = self.ir().equal(method, default);
        let is_default = self.ir().and(has_default, is_ordinary);
        self.choose(is_default, Odds::Even, |this, is_default| {
            if is_default {
                return by_default(this);
            }
            let operands = [constructor, value, method].map(|it| this.alias(it));
            let answer = this.node(Kind::CustomHasInstance, &operands, 0);
            let answer = this.box_boolean(answer);
            this.goto_with(&[(op.dst, answer)], done);
            None
        });
    }

    /// For shapes that the cache of this instruction may not have seen.
    fn inheritance_of(
        &mut self,
        shapes: ShapeSet,
        wanted: Gc<JsObject>,
    ) -> Option<RootVec<Case<Reply>>> {
        let (mut cases, mut lookups) = (root_vec(), root_vec());
        for position in 0..self.graph.shapes.members(shapes).len() {
            let shape = self.shape_at(self.graph.shapes.members(shapes)[position]);
            if !has_ordinary_prototype(&shape) {
                return None;
            }
            let mut answer = false;
            if let Some(first) = shape.prototype_object() {
                answer = first.chain_direct().any(|it| it == wanted);
                lookups.push(PrototypeLookup::for_instanceof(
                    self.vm, first, wanted, answer,
                )?);
            }
            self.add_case(&mut cases, shape, Reply::Answer(answer), true);
        }
        lookups.iter().for_each(|&lookup| self.rely_on(lookup));
        Some(cases)
    }

    fn plan_instanceof(
        &mut self,
        object: Ssa,
        prototype: Ssa,
        list: &AccessCases,
    ) -> Option<RootVec<Case<Reply>>> {
        let constant = self.constant_cell::<JsObject>(prototype);
        let known = self.knowledge.shapes_of(&mut self.graph, object);
        if let Some(wanted) = constant.filter(|_| known != ShapeSet::ANY) {
            return self.inheritance_of(known, wanted);
        }
        let wanted = constant.or_else(|| {
            let first = list.iter().next()?.prototype()?;
            let is_only = list.iter().all(|it| it.prototype() == Some(first));
            (is_only && !self.has_exited(ExitKind::BadIdentity)).then_some(first)
        })?;
        let cases = self.plan_replies(object, list, |it| it.prototype() == Some(wanted))?;
        let expected = self.cell(wanted.cell());
        self.check_identical(prototype, expected);
        Some(cases)
    }

    pub(super) fn instanceof(&mut self, op: op::Instanceof, next: u32) -> Built {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::LazyCache);
        let list = (code_block.anchor()).checked_metadata::<AccessCases>(kind, op.metadata);
        let (object, prototype) = (self.get_value(op.value), self.get_value(op.prototype));
        if let Some(cases) = self.plan_instanceof(object, prototype, list) {
            return self.reply_as_planned(op.dst, object, &cases, next);
        }
        let answer = if self.has_exited(ExitKind::ExoticObject) {
            self.cached_test(Cache::Instanceof, list, &[object, prototype])
        } else {
            let operands = [object, prototype]
                .map(|it| self.check_type_or(it, T::OBJECT, ExitKind::ExoticObject));
            let answer = self.node(Kind::InheritsFrom, &operands, 0);
            self.box_boolean(answer)
        };
        self.set(op.dst, answer);
        Ok(())
    }
}
