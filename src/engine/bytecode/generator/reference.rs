//! What can be assigned to.

use bun_engine_syntax::Name;
use bun_engine_syntax::ast::{
    AssignOperator, BinaryOperator, DeclarationKind, Expr, ExprId, ExprKind, LogicalOperator,
    UpdateOperator,
};

use super::scope::{Mutability, Place, Private, Variable};
use super::{Dest, Generator};
use crate::assembler::Label;
use crate::instruction::Opcode;
use crate::operand::{Operand, PutFlags, Register, StaticError, Unresolved};
use crate::scope::{SlotFlags, SlotKind};

/// A member whose base and key have been evaluated.
#[derive(Clone, Copy)]
pub(super) struct Member {
    pub(super) base: Operand,
    /// Of a property of `super`.
    pub(super) this: Option<Operand>,
    key: Key,
}

#[derive(Clone, Copy)]
enum Key {
    Name(Name),
    Value(Operand),
    Private(Place, Private),
    /// Only code from a damaged cache names what no class declares.
    Undeclared,
}

#[derive(Clone, Copy)]
pub(super) enum Reference {
    Variable(Variable, Option<Register>),
    Member(Member),
}

/// The parts of an [`ExprKind::Assign`].
#[derive(Clone, Copy)]
struct Assignment {
    target: ExprId,
    value: ExprId,
    value_assigns: bool,
    start: u32,
    divot: u32,
    end: u32,
}

impl Assignment {
    #[inline(always)]
    fn of(node: &Expr) -> Assignment {
        let ExprKind::Assign {
            value_assigns,
            target,
            value,
            divot,
            end,
            ..
        } = node.kind
        else {
            unreachable!()
        };
        Assignment {
            target,
            value,
            value_assigns,
            start: node.start,
            divot,
            end,
        }
    }
}

impl Generator<'_> {
    pub(super) fn member_reference(&mut self, node: &Expr, later_assigns: bool) -> Member {
        self.member_reference_with_base(node, later_assigns, Dest::Any)
    }

    pub(super) fn member_reference_with_base(
        &mut self,
        node: &Expr,
        later_assigns: bool,
        base_dst: Dest,
    ) -> Member {
        let (base, key, key_assigns) = match node.kind {
            ExprKind::Dot { base, name, .. } => (base, Ok(Key::Name(name)), false),
            ExprKind::PrivateDot { base, name, .. } => {
                let key = self.resolve_private(name);
                let key = key.map_or(Key::Undeclared, |(at, private)| Key::Private(at, private));
                (base, Ok(key), false)
            }
            ExprKind::Index {
                base,
                key,
                key_assigns,
                ..
            } => match self.literal_key(key) {
                Some(name) => (base, Ok(Key::Name(name)), false),
                None => (base, Err(key), key_assigns),
            },
            _ => {
                return Member {
                    base: self.undefined(),
                    this: None,
                    key: Key::Undeclared,
                };
            }
        };
        if self.is_super(base) {
            let this = Some(self.this_value());
            let key = key.unwrap_or_else(|key| Key::Value(self.key_expr(key, later_assigns)));
            let base = self.super_base().into();
            return Member { base, this, key };
        }
        let value = match base_dst {
            Dest::Prefer(register) if later_assigns || key_assigns => {
                self.expr(base, Dest::Temp(register))
            }
            Dest::Any => self.stable_expr(base, later_assigns || key_assigns),
            _ => self.expr(base, base_dst),
        };
        self.check_optional_base(base, value);
        let key = key.unwrap_or_else(|key| Key::Value(self.key_expr(key, later_assigns)));
        Member {
            base: value,
            this: None,
            key,
        }
    }

    /// For a member that is read and then written: the key is converted once.
    fn convert_key(&mut self, member: &mut Member) {
        if let Key::Value(key) = member.key
            && key.as_constant().is_none_or(|_| self.has_identity(key))
        {
            self.throw_if_nullish(member.base, StaticError::PropertyOfNullish, Name::EMPTY);
            let converted = self.temp();
            self.asm().to_property_key_or_number(converted, key);
            member.key = Key::Value(converted.into());
        }
    }

    pub(super) fn position_of_member(&mut self, node: &Expr) {
        if let ExprKind::Dot { divot, end, .. }
        | ExprKind::PrivateDot { divot, end, .. }
        | ExprKind::Index { divot, end, .. } = node.kind
        {
            self.position(divot, node.start, end);
        }
    }

    /// The registers from `mark` on are free once the member is read.
    #[inline(never)]
    pub(super) fn load_member(
        &mut self,
        node: &Expr,
        member: &Member,
        mark: u32,
        dst: Dest,
    ) -> Operand {
        self.position_of_member(node);
        let top = self.top;
        self.top = mark;
        let dst = self.final_dst(dst);
        self.top = self.top.max(top);
        self.get_member(node.start, member, dst);
        dst.into()
    }

    fn get_member(&mut self, start: u32, member: &Member, dst: Register) {
        let Member { base, this, key } = *member;
        match (key, this) {
            (Key::Name(name), None) => self.get_by_id(dst, base, name),
            (Key::Name(name), Some(this)) => {
                let (base, name) = (self.in_register(base), self.identifier(name));
                self.asm().get_by_id_with_this(dst, base, this, name);
            }
            (Key::Value(key), None) => self.get_by_val(dst, base, key),
            (Key::Value(key), Some(this)) => self.asm().get_by_val_with_this(dst, base, this, key),
            (Key::Private(place, private), _) => self.get_private(start, base, place, private, dst),
            (Key::Undeclared, _) => self.throw_static(StaticError::NoPrivateGetter),
        }
    }

    pub(super) fn put_by_id(&mut self, base: Operand, name: Name, value: Operand, is_direct: bool) {
        let name = self.identifier(name);
        self.note_property(base, name);
        let mut flags = PutFlags::empty();
        flags.set(PutFlags::STRICT, self.is_strict);
        flags.set(PutFlags::DIRECT, is_direct);
        self.asm().put_by_id(base, name, value, flags);
    }

    pub(super) fn put_member(&mut self, start: u32, member: &Member, value: Operand) {
        let Member { base, this, key } = *member;
        let strict = self.is_strict;
        match (key, this) {
            (Key::Name(name), None) => self.put_by_id(base, name, value, false),
            (Key::Name(name), Some(this)) => {
                let (base, name) = (self.in_register(base), self.identifier(name));
                (self.asm()).put_by_id_with_this(base, this, name, value, strict);
            }
            (Key::Value(key), None) => self.put_by_val(base, key, value),
            (Key::Value(key), Some(this)) => {
                (self.asm()).put_by_val_with_this(base, this, key, value, strict);
            }
            (Key::Private(place, private), _) => {
                self.put_private(start, base, place, private, value);
            }
            (Key::Undeclared, _) => self.throw_static(StaticError::NoPrivateSetter),
        }
    }

    #[inline(never)]
    fn get_private(
        &mut self,
        start: u32,
        base: Operand,
        place: Place,
        private: Private,
        dst: Register,
    ) {
        let mark = self.top;
        if private.kind == SlotKind::PrivateField {
            let symbol = self.temp();
            self.load_internal(place, symbol);
            self.asm().get_private_name(dst, base, symbol);
        } else {
            self.check_brand(base, place, private.flags, private.brand_slot);
            if private.kind == SlotKind::PrivateMethod {
                self.load_internal(place, dst);
            } else if private.flags.contains(SlotFlags::HAS_GETTER) {
                let getter = self.temp();
                self.load_internal(place, getter);
                self.call_accessor(start, dst, getter, base, None);
            } else {
                self.throw_static(StaticError::NoPrivateGetter);
            }
        }
        self.top = mark;
    }

    #[inline(never)]
    fn put_private(
        &mut self,
        start: u32,
        base: Operand,
        place: Place,
        private: Private,
        value: Operand,
    ) {
        let mark = self.top;
        if private.kind == SlotKind::PrivateField {
            let symbol = self.temp();
            self.load_internal(place, symbol);
            self.asm().put_private_name(base, symbol, value);
        } else {
            self.check_brand(base, place, private.flags, private.brand_slot);
            match place {
                Place::Slot { slot, .. } if private.flags.contains(SlotFlags::HAS_SETTER) => {
                    let setter = self.load_internal_beside(place, slot + 1);
                    self.call_accessor(start, setter, setter, base, Some(value));
                }
                _ => self.throw_static(StaticError::NoPrivateSetter),
            }
        }
        self.top = mark;
    }

    // Targets of patterns and loops

    pub(super) fn reference(&mut self, target: ExprId, name_range: (u32, u32, u32)) -> Reference {
        let node = &self.ast[target];
        match node.kind {
            ExprKind::Identifier(name) => self.variable_reference(name, node.start, name_range),
            _ => Reference::Member(self.member_reference(node, true)),
        }
    }

    pub(super) fn variable_reference(
        &mut self,
        name: Name,
        position: u32,
        (divot, start, end): (u32, u32, u32),
    ) -> Reference {
        let variable = self.resolve(name, position);
        if variable.place == Place::Dynamic {
            self.position(divot, start, end);
        }
        Reference::Variable(variable, self.holder(&variable))
    }

    pub(super) fn store_reference(
        &mut self,
        reference: &Reference,
        value: Operand,
        (divot, start, end): (u32, u32, u32),
    ) {
        match reference {
            Reference::Variable(variable, holder) => {
                if variable.writable_register().is_none() {
                    self.position(divot, start, end);
                }
                self.store(variable, *holder, value, false);
            }
            Reference::Member(member) => {
                self.position(divot, start, end);
                self.put_member(start, member, value);
            }
        }
    }

    // Declarations

    /// Follows an object that the last instruction has put in a variable.
    fn note_assigned(&mut self, register: Register) {
        match self.asm().last() {
            Some((site, Opcode::NewObject)) => self.track_allocation(register, site, 1, 0),
            Some((site, Opcode::NewObjectLiteral)) => {
                let count = self.asm().operand(site, 3);
                self.track_allocation(register, site, 4, count);
            }
            _ => self.untrack_allocation(register),
        }
    }

    /// One that goes takes its callbacks with it, and programs count on the variable to keep it.
    fn is_new_finalization_registry(&self, value: ExprId) -> bool {
        matches!(self.ast[value].kind, ExprKind::New { callee, .. }
            if matches!(self.ast[callee].kind, ExprKind::Identifier(name)
                if self.text_of(name).eq_ascii("FinalizationRegistry")))
    }

    #[inline(never)]
    pub(super) fn initialize_declarator(&mut self, node: &Expr) -> Operand {
        let ExprKind::Initialize {
            kind,
            name,
            name_start,
            value,
        } = node.kind
        else {
            return self.undefined();
        };
        if kind == DeclarationKind::Var {
            return self.assign_to_name(name, name_start, value, Dest::Ignore);
        }
        let result = match self.resolve_declared(name) {
            Place::Register(register) => {
                self.expr(value, Dest::Local(register));
                self.note_assigned(register);
                if self.suspends() && self.is_new_finalization_registry(value) {
                    self.keep_binding(name, register);
                }
                register.into()
            }
            _ => {
                if self.is_strict {
                    self.position_of_name(name, name_start);
                }
                let result = self.expr(value, Dest::Any);
                self.position_of_name(name, name_start);
                self.initialize(name, result);
                result
            }
        };
        if let DeclarationKind::Using | DeclarationKind::AwaitUsing = kind {
            self.add_disposable(result, name_start, kind == DeclarationKind::AwaitUsing);
        }
        result
    }

    #[inline(never)]
    pub(super) fn declare(&mut self, kind: DeclarationKind, name: Name) -> Operand {
        let undefined = self.undefined();
        if kind != DeclarationKind::Var {
            self.initialize(name, undefined);
        }
        undefined
    }

    // Assignments

    #[inline(never)]
    fn assign_to_name(&mut self, name: Name, start: u32, value: ExprId, dst: Dest) -> Operand {
        let variable = self.resolve(name, start);
        if let Some(register) = variable.writable_register() {
            self.expr(value, Dest::Local(register));
            self.note_assigned(register);
            return self.deliver(dst, register);
        }
        let result = match dst {
            Dest::Temp(_) | Dest::Prefer(_) => dst,
            _ => Dest::Any,
        };
        if variable.register().is_none() {
            self.position_of_name(name, start);
        }
        let holder = self.holder(&variable);
        let result = self.expr(value, result);
        self.position_of_name(name, start);
        self.store(&variable, holder, result, false);
        self.deliver(dst, result)
    }

    #[inline(always)]
    pub(super) fn assign(&mut self, node: &Expr, operator: AssignOperator, dst: Dest) -> Operand {
        let it = Assignment::of(node);
        match (self.ast[it.target].kind, operator) {
            (ExprKind::Identifier(name), AssignOperator::Plain) => {
                self.assign_to_name(name, it.start, it.value, dst)
            }
            (ExprKind::Identifier(name), AssignOperator::Binary(operator)) => {
                self.modify_name(node, name, operator, dst)
            }
            (ExprKind::Identifier(name), AssignOperator::Logical(operator)) => {
                self.short_circuit_name(node, name, operator, dst)
            }
            (ExprKind::Call { .. }, _) => {
                let range = (it.divot, it.start, it.end);
                self.assign_to_call(it.target, range, StaticError::AssignToCall)
            }
            (_, AssignOperator::Plain) => self.assign_to_member(node, dst),
            _ => self.modify_member(node, operator, dst),
        }
    }

    #[inline(never)]
    fn assign_to_member(&mut self, node: &Expr, dst: Dest) -> Operand {
        let it = Assignment::of(node);
        let target = &self.ast[it.target];
        let result = match dst {
            Dest::Temp(_) | Dest::Prefer(_) => dst,
            _ => Dest::Any,
        };
        let member = self.member_reference(target, it.value_assigns);
        let result = self.expr(it.value, result);
        if let ExprKind::Dot { divot, .. }
        | ExprKind::PrivateDot { divot, .. }
        | ExprKind::Index { divot, .. } = target.kind
        {
            self.position(divot, it.start, it.end);
        }
        self.put_member(it.start, &member, result);
        self.deliver(dst, result)
    }

    #[inline(never)]
    fn modify_member(&mut self, node: &Expr, operator: AssignOperator, dst: Dest) -> Operand {
        let Assignment {
            target,
            value,
            value_assigns,
            start,
            divot,
            end,
        } = Assignment::of(node);
        let target = &self.ast[target];
        let result = self.temp_dst(dst);
        let mut member = self.member_reference(target, value_assigns);
        self.convert_key(&mut member);
        self.position_of_member(&Expr { start, ..*target });
        self.get_member(start, &member, result);
        let done = self.asm().label();
        match operator {
            AssignOperator::Logical(operator) => {
                self.short_circuit(operator, result.into(), done, value, end);
                self.expr(value, Dest::Temp(result));
            }
            AssignOperator::Binary(operator) => {
                self.modify(result, result.into(), operator, value, None);
            }
            AssignOperator::Plain => {}
        }
        self.position(divot, start, end);
        self.put_member(start, &member, result.into());
        self.asm().bind(done);
        self.deliver(dst, result)
    }

    #[inline(never)]
    pub(super) fn assign_to_call(
        &mut self,
        call: ExprId,
        (divot, start, end): (u32, u32, u32),
        error: StaticError,
    ) -> Operand {
        self.effect(call);
        self.position(divot, start, end);
        self.throw_static(error);
        self.undefined()
    }

    #[inline(never)]
    fn modify_name(
        &mut self,
        node: &Expr,
        name: Name,
        operator: BinaryOperator,
        dst: Dest,
    ) -> Operand {
        let it = Assignment::of(node);
        let (value, range) = (it.value, (it.divot, it.start, it.end));
        let variable = self.resolve_for_use(name, range.1);
        if let Some(register) = variable.register() {
            if variable.is_checked {
                self.position_of_name(name, range.1);
                self.check_initialized(&variable);
            }
            let old = if it.value_assigns {
                self.copy_if_variable(register.into())
            } else {
                register.into()
            };
            if variable.mutability == Mutability::Mutable {
                self.modify(register, old, operator, value, None);
                return self.deliver(dst, register);
            }
            let result = self.temp_dst(dst);
            self.modify(result, old, operator, value, None);
            self.store(&variable, None, result.into(), true);
            return self.deliver(dst, result);
        }
        let result = self.temp_dst(dst);
        self.position_of_name(name, range.1);
        let holder = self.holder(&variable);
        self.load(&variable, holder, Dest::Temp(result), Unresolved::Throw);
        self.modify(result, result.into(), operator, value, Some(range));
        self.store(&variable, holder, result.into(), true);
        self.deliver(dst, result)
    }

    /// Jumps if the assignment does not take place.
    fn short_circuit(
        &mut self,
        operator: LogicalOperator,
        old: Operand,
        done: Label,
        value: ExprId,
        end: u32,
    ) {
        match operator {
            LogicalOperator::And => self.asm().jump_if_false(old, done),
            LogicalOperator::Or => self.asm().jump_if_true(old, done),
            LogicalOperator::Coalesce => self.asm().jump_if_not_nullish(old, done),
        }
        self.cover_skippable(value, end);
    }

    #[inline(never)]
    fn short_circuit_name(
        &mut self,
        node: &Expr,
        name: Name,
        operator: LogicalOperator,
        dst: Dest,
    ) -> Operand {
        let Assignment {
            value,
            start,
            divot,
            end,
            ..
        } = Assignment::of(node);
        let variable = self.resolve_for_use(name, start);
        let done = self.asm().label();
        if let Some(register) = variable.writable_register() {
            self.short_circuit(operator, register.into(), done, value, end);
            self.expr(value, Dest::Local(register));
            self.asm().bind(done);
            return self.deliver(dst, register);
        }
        let result = self.temp_dst(dst);
        self.position_of_name(name, start);
        let holder = self.holder(&variable);
        self.load(&variable, holder, Dest::Temp(result), Unresolved::Throw);
        self.short_circuit(operator, result.into(), done, value, end);
        self.expr(value, Dest::Temp(result));
        if variable.mutability == Mutability::Mutable {
            self.position(divot, start, end);
        }
        self.store(&variable, holder, result.into(), true);
        self.asm().bind(done);
        self.deliver(dst, result)
    }

    // `++` and `--`

    /// Leaves the new value in `value` and the old one in `old`.
    fn step(&mut self, operator: UpdateOperator, value: Register, old: Option<Register>) {
        match (operator, old) {
            (UpdateOperator::Increment, None) => self.asm().increment(value, value),
            (UpdateOperator::Decrement, None) => self.asm().decrement(value, value),
            (UpdateOperator::Increment, Some(old)) => self.asm().post_increment(old, value),
            (UpdateOperator::Decrement, Some(old)) => self.asm().post_decrement(old, value),
        }
    }

    #[inline(never)]
    pub(super) fn update(&mut self, node: &Expr, dst: Dest) -> Operand {
        let (operator, operand, range, is_postfix) = match node.kind {
            ExprKind::Prefix {
                operator,
                operand,
                operator_start,
                end,
            } => (
                operator,
                operand,
                (operator_start + 2, operator_start, end),
                false,
            ),
            ExprKind::Postfix {
                operator,
                operand,
                operand_start,
                divot,
                end,
            } => (operator, operand, (divot, operand_start, end), true),
            _ => return self.undefined(),
        };
        let yields_old = is_postfix && dst != Dest::Ignore;
        let target = &self.ast[operand];
        match target.kind {
            ExprKind::Identifier(name) => {
                self.update_name(name, target.start, operator, range, yields_old, dst)
            }
            ExprKind::Dot { .. } | ExprKind::PrivateDot { .. } | ExprKind::Index { .. } => {
                let result = self.temp_dst(dst);
                let value = if yields_old { self.temp() } else { result };
                let mut member = self.member_reference(target, false);
                self.convert_key(&mut member);
                self.position_of_member(target);
                self.get_member(node.start, &member, value);
                self.step(operator, value, yields_old.then_some(result));
                self.position(range.0, range.1, range.2);
                self.put_member(node.start, &member, value.into());
                self.deliver(dst, result)
            }
            _ => {
                let error = match (is_postfix, operator) {
                    (false, UpdateOperator::Increment) => StaticError::PrefixIncrementOfCall,
                    (false, UpdateOperator::Decrement) => StaticError::PrefixDecrementOfCall,
                    (true, UpdateOperator::Increment) => StaticError::PostfixIncrementOfCall,
                    (true, UpdateOperator::Decrement) => StaticError::PostfixDecrementOfCall,
                };
                self.assign_to_call(operand, range, error)
            }
        }
    }

    #[inline(never)]
    fn update_name(
        &mut self,
        name: Name,
        name_start: u32,
        operator: UpdateOperator,
        range: (u32, u32, u32),
        yields_old: bool,
        dst: Dest,
    ) -> Operand {
        let variable = self.resolve_for_use(name, name_start);
        let local = variable.register();
        if yields_old {
            self.position_of_name(name, range.1);
        } else if local.is_none() {
            self.position(range.0, range.1, range.2);
        } else if variable.is_checked {
            self.position_of_name(name, name_start);
        }
        if let Some(register) = local
            && variable.mutability == Mutability::Mutable
        {
            self.check_initialized(&variable);
            if !yields_old {
                self.step(operator, register, None);
                return self.deliver(dst, register);
            }
            if dst == Dest::Local(register) {
                self.asm().to_numeric(register, register);
                return register.into();
            }
            let old = self.final_dst(dst);
            self.step(operator, register, Some(old));
            return old.into();
        }
        let result = self.temp_dst(dst);
        let value = if yields_old { self.temp() } else { result };
        let holder = self.holder(&variable);
        self.load(&variable, holder, Dest::Temp(value), Unresolved::Throw);
        self.step(operator, value, yields_old.then_some(result));
        self.store(&variable, holder, value.into(), true);
        self.deliver(dst, result)
    }

    #[inline(never)]
    pub(super) fn delete(&mut self, node: &Expr, dst: Dest) -> Operand {
        let ExprKind::Delete {
            operand,
            operator_start,
            end,
        } = node.kind
        else {
            return self.undefined();
        };
        let (mark, strict) = (self.top, self.is_strict);
        let target = &self.ast[operand];
        match target.kind {
            ExprKind::Identifier(name) => {
                let variable = self.resolve(name, target.start);
                if !matches!(variable.place, Place::Global | Place::Dynamic) {
                    let result = self.boolean(false);
                    return self.deliver(dst, result);
                }
                self.position(end, operator_start, end);
                let holder = self.holder(&variable);
                self.top = mark;
                let (dst, name) = (self.final_dst(dst), self.identifier(name));
                match holder {
                    Some(holder) => self.asm().delete_dynamic(dst, holder, name),
                    None => self.asm().delete_global(dst, name),
                }
                dst.into()
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                let member = self.member_reference(target, false);
                self.position(end, operator_start, end);
                self.top = mark;
                if member.this.is_some() {
                    self.throw_static(StaticError::DeleteSuperProperty);
                    return self.undefined();
                }
                let dst = self.final_dst(dst);
                match member.key {
                    Key::Name(name) => {
                        let name = self.identifier(name);
                        self.asm().delete_by_id(dst, member.base, name, strict);
                    }
                    Key::Value(key) => self.asm().delete_by_val(dst, member.base, key, strict),
                    Key::Private(..) | Key::Undeclared => {}
                }
                dst.into()
            }
            _ => {
                self.effect(operand);
                let result = self.boolean(true);
                self.deliver(dst, result)
            }
        }
    }
}
