//! Where a file of a test run replaces a member of a built-in object under a name that it spells:
//! `String.prototype.at = f`, `delete Array.from`, `spyOn(Map.prototype, "get")`, `Object.defineProperty(Buffer, "from", d)`.
//! And where it may: a built-in object beside the name of one of its members, as operands of a call or in a literal,
//! `stub(Array.prototype, "join")`, `[Map.prototype, "get"]`, `{ holder: Object, key: "assign" }`. A helper or a loop over a table does the rest.
//! A member too many costs a test where it is used. One that is missed here costs a build that starts over: the engine follows values and finds it.

use super::resolver::{ExprState, Resolver};
use crate::builtins::table::{
    self, BuiltinFlags, BuiltinId, BuiltinName, MemberLookup, Mutability,
};
use bun_sema::atom::Atom;
use bun_sema::bind::Binding;
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{ExprId, ExprKind, MemberKey, NodeData, UnOp};

// Takes an object and a key, and writes the property.
fn writes_member_of_operand(callee: BuiltinId) -> bool {
    matches!(
        callee,
        BuiltinId::BunTestSpyOn
            | BuiltinId::BunTestJestSpyOn
            | BuiltinId::BunTestViSpyOn
            | BuiltinId::ObjectDefineProperty
            | BuiltinId::ReflectDefineProperty
            | BuiltinId::ReflectSet
            | BuiltinId::ReflectDeleteProperty
    )
}

impl Resolver<'_, '_> {
    fn find_locked_member(&self, object: ExprId, name: BuiltinName) -> Option<BuiltinId> {
        let holder = self
            .value_of(object)
            .or_else(|| self.held_value_of(object))?;
        let holder = match table::has_flag(holder.path.id, BuiltinFlags::IS_GLOBAL_OBJECT) {
            true => BuiltinId::GlobalThis,
            false => table::canonical_id(holder.path.id),
        };
        let MemberLookup::Found(member) = table::member(holder, name) else {
            return None;
        };
        let entry = table::entry(member);
        let is_own = entry.holder.map(table::canonical_id) == Some(holder);
        (is_own && entry.mutability == Mutability::AlwaysLocked).then_some(member)
    }

    // `Set = Fake`
    fn find_locked_global(&self, target: ExprId) -> Option<BuiltinId> {
        let input = self.input;
        let ExprKind::Ident(name) = input.hir[target].kind else {
            return None;
        };
        let is_free = input.bound.binding(target) == Binding::Free
            && (input.bound)
                .dynamic_lookup_scope(NodeData::Expr(target))
                .is_none();
        let global = table::global(input.names.get(name)?).filter(|_| is_free)?;
        (table::entry(global).mutability == Mutability::AlwaysLocked).then_some(global)
    }

    fn find_member_written_at(&self, target: ExprId) -> Option<BuiltinId> {
        let hir = self.input.hir;
        let target = hir.skip_type_assertions(target);
        let Some((object, key)) = hir.member_key(target) else {
            return self.find_locked_global(target);
        };
        let name = match key {
            MemberKey::Name(name) => name,
            MemberKey::Computed(key) => self.constant_key(key)?,
            MemberKey::PrivateName(_) => return None,
        };
        self.find_locked_member(object, self.input.names.get(name)?)
    }

    fn find_name_added_to(&self, object: ExprId, name: Atom) -> Option<(BuiltinId, Atom)> {
        let holder = self
            .value_of(object)
            .or_else(|| self.held_value_of(object))?;
        let holder = table::canonical_id(holder.path.id);
        let takes_no_names = table::has_flag(holder, BuiltinFlags::IS_LOCKED_OBJECT)
            || table::has_flag(holder, BuiltinFlags::IS_CLOSED_TO_OTHER_NAMES);
        let names_member = (self.input.names.get(name))
            .is_some_and(|name| matches!(table::member(holder, name), MemberLookup::Found(_)));
        (takes_no_names && !names_member).then_some((holder, name))
    }

    fn find_name_added_at(&self, target: ExprId) -> Option<(BuiltinId, Atom)> {
        let hir = self.input.hir;
        let (object, key) = hir.member_key(hir.skip_type_assertions(target))?;
        match key {
            MemberKey::Name(name) => self.find_name_added_to(object, name),
            MemberKey::Computed(key) => self.find_name_added_to(object, self.constant_key(key)?),
            MemberKey::PrivateName(_) => None,
        }
    }

    // `Reflect.set(Object.prototype, "polluted", 1)`, and a helper that is called like it.
    fn find_name_added_by(&self, expr: ExprId) -> Option<(BuiltinId, Atom)> {
        let hir = self.input.hir;
        match hir[expr].kind {
            ExprKind::Assign { target, .. } => self.find_name_added_at(target),
            ExprKind::Call(call) => {
                let callee = self.value_of(hir[call].callee);
                if callee.is_some_and(|callee| !writes_member_of_operand(callee.path.id)) {
                    return None;
                }
                let mut operands = hir.ids(hir[call].args);
                let (object, key) = (operands.next()?, operands.next()?);
                self.find_name_added_to(object, self.constant_key(key)?)
            }
            _ => None,
        }
    }

    fn constant_key(&self, key: ExprId) -> Option<Atom> {
        let input = self.input;
        match input
            .decisions
            .constant(input.hir, input.hir.skip_type_assertions(key))
        {
            FoldedValue::Constant(Constant::String(text))
            | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) => Some(text),
            _ => None,
        }
    }

    // A table is a literal of literals, and a loop over it lets every object meet every name.
    fn push_values_of_literal(&self, value: ExprId, depth: usize, values: &mut Vec<ExprId>) {
        const ROWS_AND_THEIR_CELLS: usize = 3;
        let hir = self.input.hir;
        let value = hir.skip_type_assertions(value);
        match hir[value].kind {
            ExprKind::Array(elements) if depth < ROWS_AND_THEIR_CELLS => {
                for element in hir.ids(elements) {
                    self.push_values_of_literal(element, depth + 1, values);
                }
            }
            ExprKind::Object(properties) if depth < ROWS_AND_THEIR_CELLS => {
                for property in properties.iter() {
                    self.push_values_of_literal(hir[property].value, depth + 1, values);
                }
            }
            _ => values.push(value),
        }
    }

    fn find_members_named_beside_holders(&self, values: &[ExprId], found: &mut Vec<BuiltinId>) {
        let is_builtin = |value: &&ExprId| {
            self.value_of(**value)
                .or_else(|| self.held_value_of(**value))
                .is_some()
        };
        let holders: Vec<ExprId> = values.iter().filter(is_builtin).copied().collect();
        if holders.is_empty() {
            return;
        }
        let names = values.iter().filter_map(|&value| self.constant_key(value));
        for name in names.filter_map(|name| self.input.names.get(name)) {
            found.extend(
                (holders.iter()).filter_map(|&holder| self.find_locked_member(holder, name)),
            );
        }
    }

    fn find_members_written_by(&self, expr: ExprId, found: &mut Vec<BuiltinId>) {
        let hir = self.input.hir;
        let mut values = Vec::new();
        match hir[expr].kind {
            ExprKind::Assign { target, .. } => found.extend(self.find_member_written_at(target)),
            ExprKind::Unary {
                op: UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                operand,
            } => found.extend(self.find_member_written_at(operand)),
            // What a function of the table does with its operands is known: `Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")` writes nothing.
            ExprKind::Call(call) | ExprKind::New(call) => {
                let callee = self.value_of(hir[call].callee);
                if callee.is_none_or(|callee| writes_member_of_operand(callee.path.id)) {
                    values.extend(hir.ids(hir[call].args));
                }
            }
            ExprKind::Array(_) | ExprKind::Object(_) => {
                self.push_values_of_literal(expr, 0, &mut values);
            }
            _ => {}
        }
        self.find_members_named_beside_holders(&values, found);
    }

    pub(super) fn collect_replaced_members(&mut self) {
        if !self.input.finds_replaced_members {
            return;
        }
        let evaluated = self.evaluated_ids().map(ExprId);
        let evaluated =
            evaluated.filter(|&expr| !matches!(self.state(expr), ExprState::NotEvaluated));
        let mut found = Vec::new();
        let mut names = Vec::new();
        for expr in evaluated {
            self.find_members_written_by(expr, &mut found);
            names.extend(self.find_name_added_by(expr));
        }
        self.output.replaced_members = found;
        self.output.names_added = names;
    }
}
