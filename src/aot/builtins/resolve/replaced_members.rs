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
use bun_sema::import_sites::find_values_of_parameter;
use bun_sema::util::SharedSort;

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
        // A member that is constant unless written counts too: an image that does not hold the file with the write would lock it at its start.
        (is_own && entry.mutability != Mutability::ChangesOnItsOwn).then_some(member)
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

    fn is_builtin(&self, value: ExprId) -> bool {
        self.value_of(value).is_some() || self.held_value_of(value).is_some()
    }

    fn find_members_written_at(&self, target: ExprId, found: &mut Vec<BuiltinId>) {
        let hir = self.input.hir;
        let target = hir.skip_type_assertions(target);
        let Some((object, key)) = hir.member_key(target) else {
            return found.extend(self.find_locked_global(target));
        };
        let names = match key {
            MemberKey::Name(name) => vec![name],
            MemberKey::Computed(key) if self.is_builtin(object) => self.find_keys_spelled_for(key),
            MemberKey::Computed(_) | MemberKey::PrivateName(_) => return,
        };
        let names = names
            .into_iter()
            .filter_map(|name| self.input.names.get(name));
        found.extend(names.filter_map(|name| self.find_locked_member(object, name)));
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

    // `Object.prototype.polluted = 1`, `Reflect.set(Object.prototype, "polluted", 1)`, and a helper that is called like it.
    fn find_names_added_by(&self, expr: ExprId) -> Option<Vec<(BuiltinId, Atom)>> {
        let hir = self.input.hir;
        let (object, key) = match hir[expr].kind {
            ExprKind::Assign { target, .. } => {
                match hir.member_key(hir.skip_type_assertions(target))? {
                    (object, MemberKey::Name(name)) => {
                        return Some(Vec::from_iter(self.find_name_added_to(object, name)));
                    }
                    (object, MemberKey::Computed(key)) => (object, key),
                    (_, MemberKey::PrivateName(_)) => return None,
                }
            }
            ExprKind::Call(call) => {
                let callee = self.value_of(hir[call].callee);
                if callee.is_some_and(|callee| !writes_member_of_operand(callee.path.id)) {
                    return None;
                }
                let mut operands = hir.ids(hir[call].args);
                (operands.next()?, operands.next()?)
            }
            _ => return None,
        };
        self.find_object_that_takes_no_names(object)?;
        let keys = self.find_keys_spelled_for(key).into_iter();
        Some(
            keys.filter_map(|key| self.find_name_added_to(object, key))
                .collect(),
        )
    }

    // The key itself, or what the calls of a function of the file pass for it:
    // `function plant(name) { Object.defineProperty(Object.prototype, name, d); }`, `plant("polluted")`.
    fn find_keys_spelled_for(&self, key: ExprId) -> Vec<Atom> {
        if let Some(key) = self.constant_key(key) {
            return vec![key];
        }
        let input = self.input;
        let key = input.hir.skip_type_assertions(key);
        let passed = find_values_of_parameter(input.hir, input.bound, input.decisions, key);
        let passed = passed.unwrap_or_default().into_iter();
        passed
            .filter_map(|value| self.constant_key(value))
            .collect()
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
        let holders = values.iter().copied();
        let holders: Vec<ExprId> = holders.filter(|&value| self.is_builtin(value)).collect();
        if holders.is_empty() {
            return;
        }
        let names = values
            .iter()
            .flat_map(|&value| self.find_keys_spelled_for(value));
        for name in names.filter_map(|name| self.input.names.get(name)) {
            found.extend(
                (holders.iter()).filter_map(|&holder| self.find_locked_member(holder, name)),
            );
        }
    }

    fn find_object_that_takes_no_names(&self, value: ExprId) -> Option<BuiltinId> {
        let holder = self.value_of(value).or_else(|| self.held_value_of(value))?;
        let holder = table::canonical_id(holder.path.id);
        let takes_no_names = table::has_flag(holder, BuiltinFlags::IS_LOCKED_OBJECT)
            || table::has_flag(holder, BuiltinFlags::IS_CLOSED_TO_OTHER_NAMES);
        takes_no_names.then_some(holder)
    }

    // `Reflect.set(place, MARK, 1)`, `place[MARK] = 1`: the file spells the key and does not tell the object.
    fn find_key_written_on_some_object(&self, expr: ExprId) -> Option<Atom> {
        let hir = self.input.hir;
        let (object, key) = match hir[expr].kind {
            ExprKind::Assign { target, .. } => {
                match hir.member_key(hir.skip_type_assertions(target))? {
                    (object, MemberKey::Computed(key)) => (object, key),
                    _ => return None,
                }
            }
            ExprKind::Call(call) => {
                let callee = self.value_of(hir[call].callee)?;
                let mut operands = hir.ids(hir[call].args);
                let operands = (operands.next()?, operands.next()?);
                writes_member_of_operand(callee.path.id).then_some(operands)?
            }
            _ => return None,
        };
        let is_told = self.value_of(object).is_some() || self.held_value_of(object).is_some();
        self.constant_key(key).filter(|_| !is_told)
    }

    fn find_members_written_by(
        &self,
        expr: ExprId,
        found: &mut Vec<BuiltinId>,
        handed_on: &mut Vec<BuiltinId>,
    ) {
        let hir = self.input.hir;
        let mut values = Vec::new();
        match hir[expr].kind {
            ExprKind::Assign { target, .. } => self.find_members_written_at(target, found),
            ExprKind::Unary {
                op: UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                operand,
            } => self.find_members_written_at(operand, found),
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
        let closed =
            (values.iter()).filter_map(|&value| self.find_object_that_takes_no_names(value));
        handed_on.extend(closed);
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
        let (mut handed_on, mut keys) = (Vec::new(), Vec::new());
        for expr in evaluated {
            self.find_members_written_by(expr, &mut found, &mut handed_on);
            names.extend(self.find_names_added_by(expr).unwrap_or_default());
            keys.extend(self.find_key_written_on_some_object(expr));
        }
        // A list of objects here, a loop that writes one key on each of them there: every object that the file hands on meets every such key.
        handed_on.shared_sort_unstable();
        handed_on.dedup();
        for &holder in &handed_on {
            let names_member = |key: &Atom| {
                (self.input.names.get(*key)).is_some_and(|name| {
                    matches!(table::member(holder, name), MemberLookup::Found(_))
                })
            };
            names.extend(
                (keys.iter())
                    .filter(|key| !names_member(key))
                    .map(|&key| (holder, key)),
            );
        }
        self.output.replaced_members = found;
        self.output.names_added = names;
    }
}
