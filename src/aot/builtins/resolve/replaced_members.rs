//! Where a file of a test run replaces a member of a built-in object under a name that it spells:
//! `String.prototype.at = f`, `delete Array.from`, `spyOn(Map.prototype, "get")`, `Object.defineProperty(Buffer, "from", d)`, `Object.assign(Date, { now })`.
//! And where it may: a built-in object beside the name of one of its members, as operands of a call or in a literal,
//! `stub(Array.prototype, "join")`, `swap(Date, { now: () => 0 })`, `[Map.prototype, "get"]`, `{ holder: Object, key: "assign" }`. A helper or a loop over a table does the rest.
//! A member too many costs a test where it is used. One that is missed here stays locked, and the test that writes it gets a TypeError.

use super::imports::has_source;
use super::mentions::mentioned_id;
use super::resolver::{ExprState, Resolver};
use super::{ObjectSpelled, ReplacedMembersSought, WriteOnImport};
use crate::builtins::returns_first_argument;
use crate::builtins::table::{
    self, BuiltinFlags, BuiltinId, BuiltinKind, BuiltinName, MemberLookup, Mutability, Platforms,
    Prototype, RuntimeModule, Scope,
};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{AssignmentTarget, Binding, BindingInitializer, Decl, Parent, SymbolId};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{
    BinOp, ExprId, ExprKind, Flags, MemberKey, MemberKind, NodeData, PropKey, PropKind, StmtId,
    StmtKind, UnOp,
};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::util::{FxHashSet, SharedSort};
use std::ops::ControlFlow;

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

// Where a property is written, and under what.
struct Write {
    object: ExprId,
    key: KeyOfWrite,
}

enum KeyOfWrite {
    Name(Atom),
    Computed(ExprId),
}

impl KeyOfWrite {
    fn of(key: MemberKey) -> Option<Self> {
        match key {
            MemberKey::Name(name) => Some(Self::Name(name)),
            MemberKey::Computed(key) => Some(Self::Computed(key)),
            MemberKey::PrivateName(_) => None,
        }
    }
}

#[derive(Default)]
struct Found {
    members: Vec<BuiltinId>,
    names: Vec<(BuiltinId, Atom)>,
    /// Objects that take no new names and go where the file does not follow them.
    handed_on: Vec<BuiltinId>,
    calls_that_may_stub_global: Vec<(ExprId, BuiltinId)>,
    mentions_stub_of_global: bool,
    /// `ResolvedBuiltins::modules_written_on`
    modules_written_on: Vec<Atom>,
}

fn find_locked_member_of(holder: BuiltinId, name: BuiltinName) -> Option<BuiltinId> {
    let MemberLookup::Found(member) = table::member(holder, name) else {
        return None;
    };
    let entry = table::entry(member);
    let is_own = entry.holder.map(table::canonical_id) == Some(holder);
    // A member that is constant unless written counts too: an image that does not hold the file with the write would lock it at its start.
    // `module.exports = f` writes an object of the file's own.
    (is_own && entry.mutability != Mutability::ChangesOnItsOwn && entry.scope == Scope::Realm)
        .then_some(member)
}

/// One file hands out what stands for `holder`, another writes `key` behind `path`, which begins at the write: `WriteOnImport`.
/// A name of the path that the object does not have is the program's own, on the way to the object: `tools.make().proxy`.
pub fn find_member_written_behind<'a>(
    holder: BuiltinId,
    path: impl DoubleEndedIterator<Item = &'a [u8]>,
    key: &[u8],
) -> Option<BuiltinId> {
    let mut holder = holder;
    for name in path.rev().filter_map(table::find_name) {
        if let MemberLookup::Found(member) = table::member(holder, name) {
            holder = table::canonical_id(member);
        }
    }
    find_locked_member_of(holder, table::find_name(key)?)
}

// The objects above `holder`, its `prototype`, and the objects above that.
/// Nobody can read the name: `for (const name of Object.keys(Math)) spyOn(Math, name)`, `function setGlobal(name, value) { globalThis[name] = value; }`.
/// Of the global object only what is tested where it is used anyway, fetch and the timers: Map and Array are too much to give up for it.
pub fn members_written_under_any_name(holder: BuiltinId) -> impl Iterator<Item = BuiltinId> {
    table::members(holder)
        .iter()
        .copied()
        .filter(move |&member| {
            let entry = table::entry(member);
            let is_cheap = entry.mutability == Mutability::ConstantUnlessWritten;
            entry.mutability != Mutability::ChangesOnItsOwn
                && entry.scope == Scope::Realm
                && (is_cheap || holder != BuiltinId::GlobalThis)
        })
}

fn find_builtins_around(holder: BuiltinId) -> Vec<BuiltinId> {
    let prototype =
        table::find_name(b"prototype").and_then(|name| match table::member(holder, name) {
            MemberLookup::Found(member) => Some(table::canonical_id(member)),
            MemberLookup::Unknown | MemberLookup::Absent => None,
        });
    let mut around = Vec::new();
    for start in [Some(holder), prototype].into_iter().flatten() {
        let mut current = start;
        loop {
            if current != holder && !around.contains(&current) {
                around.push(current);
            }
            match table::entry(current).prototype {
                Prototype::Builtin(above) if !around.contains(&table::canonical_id(above)) => {
                    current = table::canonical_id(above);
                }
                Prototype::Builtin(_) | Prototype::Unknown | Prototype::Null => break,
            }
        }
    }
    around
}

impl Resolver<'_, '_> {
    fn find_locked_member(&self, holder: BuiltinId, name: BuiltinName) -> Option<BuiltinId> {
        find_locked_member_of(holder, name)
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
        // As in find_locked_member_of(): an image that does not hold the file with the write would lock it at its start.
        (table::entry(global).mutability != Mutability::ChangesOnItsOwn).then_some(global)
    }

    fn holder_of(id: BuiltinId) -> BuiltinId {
        match table::has_flag(id, BuiltinFlags::IS_GLOBAL_OBJECT) {
            true => BuiltinId::GlobalThis,
            false => table::canonical_id(id),
        }
    }

    pub(super) fn find_builtin(&self, value: ExprId) -> Option<BuiltinId> {
        let holder = self.value_of(value).or_else(|| self.held_value_of(value))?;
        Some(Self::holder_of(holder.path.id))
    }

    /// The built-in objects that the expression may stand for.
    fn find_builtins_spelled_for(&self, object: ExprId) -> Vec<BuiltinId> {
        let values = self.find_values_spelled_for(object).into_iter();
        values
            .filter_map(|value| self.find_builtin(value))
            .collect()
    }

    fn takes_no_names(holder: BuiltinId) -> bool {
        table::has_flag(holder, BuiltinFlags::IS_LOCKED_OBJECT)
            || table::has_flag(holder, BuiltinFlags::IS_CLOSED_TO_OTHER_NAMES)
    }

    // Every object inherits from Object.prototype: one name there, and no miss and no `for in` of the program is known any more.
    pub(super) fn takes_names_that_an_executable_spells(id: BuiltinId) -> bool {
        let holder = Self::holder_of(id);
        holder != BuiltinId::ObjectPrototype && Self::takes_no_names(holder)
    }

    fn seeks_names_added_alone(&self) -> bool {
        matches!(
            self.input.replaced_members_sought,
            ReplacedMembersSought::NamesAdded | ReplacedMembersSought::NamesAddedByProduct
        )
    }

    // `object.name = f`, `delete object[key]`, `object.name++`, `spyOn(object, key)`, `Object.defineProperty(object, key, d)`, `Reflect.set(target, key, f, object)`
    fn find_write(&self, expr: ExprId) -> Option<Write> {
        let hir = self.input.hir;
        let target = match hir[expr].kind {
            // A member of a built-in object is there, and no function or symbol is falsy: `Symbol.dispose ??= Symbol("dispose")` writes only behind another write.
            ExprKind::Assign {
                op: Some(BinOp::Nullish | BinOp::Or),
                ..
            } => return None,
            ExprKind::Assign { target, .. } => target,
            ExprKind::Unary {
                op: UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                operand,
            } => operand,
            ExprKind::Call(call) => {
                let callee = self.value_of(hir[call].callee)?.path.id;
                let mut operands = hir.ids(hir[call].args);
                // `holder.__defineGetter__(key, getter)` writes on its receiver.
                if matches!(
                    callee,
                    BuiltinId::ObjectPrototype__defineGetter__
                        | BuiltinId::ObjectPrototype__defineSetter__
                ) {
                    let callee = hir.skip_type_assertions(hir[call].callee);
                    return Some(Write {
                        object: hir.member_key(callee)?.0,
                        key: KeyOfWrite::Computed(operands.next()?),
                    });
                }
                let (first, key) = (operands.next()?, operands.next()?);
                let receiver = operands.nth(1).filter(|&receiver| {
                    callee == BuiltinId::ReflectSet
                        && !matches!(hir[receiver].kind, ExprKind::Spread(_))
                });
                return writes_member_of_operand(callee).then_some(Write {
                    object: receiver.unwrap_or(first),
                    key: KeyOfWrite::Computed(key),
                });
            }
            _ => return None,
        };
        let (object, key) = hir.member_key(hir.skip_type_assertions(target))?;
        Some(Write {
            object,
            key: KeyOfWrite::of(key)?,
        })
    }

    // `[object.name] = list`, `({ a: object.name } = o)`, `for (object.name of list)`: a member in a pattern or at the head of a loop is stored to.
    fn find_write_by_pattern(&self, expr: ExprId) -> Option<Write> {
        let hir = self.input.hir;
        let (object, key) = hir.member_key(expr)?;
        let bound = self.input.bound;
        let is_written = match bound.get_assignment_target_or_pattern_around(hir, expr) {
            ControlFlow::Continue(pattern) => bound.get_assignment_target(hir, pattern).is_some(),
            ControlFlow::Break(target) => matches!(target, Some(AssignmentTarget::ForInOrOf)),
        };
        is_written.then_some(Write {
            object,
            key: KeyOfWrite::of(key)?,
        })
    }

    // `Promise.prototype.extra ??= f`: the store runs where the name is not there, so it adds a name and replaces no member.
    fn note_names_stored_where_missing(&self, expr: ExprId, found: &mut Found) {
        let hir = self.input.hir;
        let ExprKind::Assign {
            op: Some(BinOp::Nullish | BinOp::Or),
            target,
            ..
        } = hir[expr].kind
        else {
            return;
        };
        let key = match hir.member_key(hir.skip_type_assertions(target)) {
            Some((object, MemberKey::Name(name))) => (object, KeyOfWrite::Name(name)),
            Some((object, MemberKey::Computed(key))) => (object, KeyOfWrite::Computed(key)),
            Some((_, MemberKey::PrivateName(_))) | None => return,
        };
        let mut noted = Found::default();
        for holder in self.find_builtins_spelled_for(key.0) {
            for name in self.find_keys_written(&key.1) {
                self.note_write(holder, name, &mut noted);
            }
        }
        found.names.append(&mut noted.names);
    }

    /// An object, a function or a symbol, on every platform. `RegExp.prototype.flags` is "" and `Array.prototype.length` 0.
    fn is_there_and_not_falsy(member: BuiltinId) -> bool {
        let entry = table::entry(member);
        let is_object = match entry.kind {
            BuiltinKind::Namespace
            | BuiltinKind::Constructor
            | BuiltinKind::Function
            | BuiltinKind::Prototype
            | BuiltinKind::Method => true,
            BuiltinKind::Accessor
            | BuiltinKind::DataProperty
            | BuiltinKind::Constant
            | BuiltinKind::NativeBinding => table::well_known_symbol(member).is_some(),
        };
        is_object && entry.platforms == Platforms::all()
    }

    /// Nothing but the member: read off its holder or off `(_c = Symbol)`, `(_a = Symbol.dispose)`, or `filled`.
    fn reads_member(&self, value: ExprId, member: BuiltinId, filled: SymbolId) -> bool {
        let hir = self.input.hir;
        let value = hir.skip_type_assertions(value);
        let reads_off_stored_holder = || {
            let (object, MemberKey::Name(name)) = hir.member_key(value)? else {
                return None;
            };
            let ExprKind::Assign {
                op: None,
                value: holder,
                ..
            } = hir[hir.skip_type_assertions(object)].kind
            else {
                return None;
            };
            let holder = table::canonical_id(self.value_of(holder)?.path.id);
            let found = self.find_locked_member(holder, self.input.names.get(name)?)?;
            Some(table::canonical_id(found) == member)
        };
        match hir[value].kind {
            ExprKind::Assign {
                op: None, value, ..
            } => self.reads_member(value, member, filled),
            ExprKind::Ident(_) if filled != SymbolId::NONE => {
                self.input.bound.symbol_of_expr(value) == filled
            }
            _ => match self.value_of(value) {
                Some(exact) => table::canonical_id(exact.path.id) == member,
                None => reads_off_stored_holder() == Some(true),
            },
        }
    }

    /// `_a` in `(_a = Symbol.dispose) !== null`: what stands to the right of that in the same test reads the member out of it.
    fn find_variable_filled_with_member(&self, test: ExprId, member: BuiltinId) -> SymbolId {
        let hir = self.input.hir;
        let ExprKind::Binary { left, right, .. } = hir[hir.skip_type_assertions(test)].kind else {
            return SymbolId::NONE;
        };
        let filled = [left, right].into_iter().find_map(|operand| {
            let ExprKind::Assign {
                op: None,
                target,
                value,
            } = hir[hir.skip_type_assertions(operand)].kind
            else {
                return None;
            };
            let is_variable = matches!(hir[target].kind, ExprKind::Ident(_));
            (is_variable && self.reads_member(value, member, SymbolId::NONE))
                .then(|| self.input.bound.symbol_of_expr(target))
        });
        filled.unwrap_or(SymbolId::NONE)
    }

    /// What a test answers where `member` is there and is not falsy. `filled`: a variable that holds it.
    fn find_answer_where_member_is_there(
        &self,
        test: ExprId,
        member: BuiltinId,
        filled: SymbolId,
    ) -> Option<bool> {
        let (hir, decisions) = (self.input.hir, self.input.decisions);
        let test = hir.skip_type_assertions(test);
        if self.reads_member(test, member, filled) {
            return Some(true);
        }
        let answer = |test: ExprId| self.find_answer_where_member_is_there(test, member, filled);
        let answer_behind = |left: ExprId, right: ExprId| {
            let filled = match self.find_variable_filled_with_member(left, member) {
                SymbolId::NONE => filled,
                filled => filled,
            };
            self.find_answer_where_member_is_there(right, member, filled)
        };
        let says_missing = |value: ExprId, with: ExprId| {
            let (value, with) = (
                hir.skip_type_assertions(value),
                hir.skip_type_assertions(with),
            );
            match (hir[value].kind, decisions.constant(hir, with)) {
                (
                    ExprKind::Unary {
                        op: UnOp::Typeof,
                        operand,
                    },
                    FoldedValue::Constant(Constant::String(text)),
                ) => text == known::undefined && self.reads_member(operand, member, filled),
                (_, FoldedValue::Constant(Constant::Undefined | Constant::Null)) => {
                    self.reads_member(value, member, filled)
                }
                _ => false,
            }
        };
        match hir[test].kind {
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => answer(operand).map(|it| !it),
            ExprKind::Binary {
                op: BinOp::And,
                left,
                right,
            } => match (answer(left), answer_behind(left, right)) {
                (Some(false), _) | (_, Some(false)) => Some(false),
                (Some(true), Some(true)) => Some(true),
                _ => None,
            },
            ExprKind::Binary {
                op: BinOp::Or,
                left,
                right,
            } => match (answer(left), answer_behind(left, right)) {
                (Some(true), _) | (_, Some(true)) => Some(true),
                (Some(false), Some(false)) => Some(false),
                _ => None,
            },
            ExprKind::Binary {
                op: op @ (BinOp::EqEq | BinOp::EqEqEq | BinOp::NotEq | BinOp::NotEqEq),
                left,
                right,
            } => (says_missing(left, right) || says_missing(right, left))
                .then_some(matches!(op, BinOp::NotEq | BinOp::NotEqEq)),
            ExprKind::Binary {
                op: BinOp::In,
                left,
                right,
            } => {
                let name = self.input.names.get(self.constant_key(left)?)?;
                let found = self.find_locked_member(self.find_builtin(right)?, name)?;
                (table::canonical_id(found) == member).then_some(true)
            }
            _ => None,
        }
    }

    /// `Symbol.dispose || (Symbol.dispose = f)`, `if (typeof Symbol.dispose === "undefined") Symbol.dispose = f`, and `Symbol.dispose ??= f` as a compiler
    /// writes it for an older engine, `(_a = (_c = Symbol).dispose) !== null && _a !== void 0 ? _a : (_c.dispose = f)`: as `??=` in find_write().
    fn is_behind_test_that_finds_member_missing(&self, write: ExprId, member: BuiltinId) -> bool {
        #[derive(Copy, Clone)]
        enum Node {
            Expr(ExprId),
            Stmt(StmtId),
        }
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut node = Node::Expr(write);
        loop {
            let parent = match node {
                Node::Expr(expr) => bound.parent_of_expr(expr),
                Node::Stmt(stmt) => bound.parent_of_stmt(stmt),
            };
            // The test around the node, and the answer with which the node is passed over.
            let passed_over_by = match (parent, node) {
                (Parent::Expr(parent), Node::Expr(child)) => match hir[parent].kind {
                    ExprKind::Cond { test, branches } if child == hir.branches(branches).yes => {
                        Some((test, false))
                    }
                    ExprKind::Cond { test, branches } if child == hir.branches(branches).no => {
                        Some((test, true))
                    }
                    ExprKind::Binary {
                        op: BinOp::Or | BinOp::Nullish,
                        left,
                        right,
                    } if child == right => Some((left, true)),
                    ExprKind::Binary {
                        op: BinOp::And,
                        left,
                        right,
                    } if child == right => Some((left, false)),
                    _ => None,
                },
                (Parent::Stmt(parent), Node::Stmt(child)) => match hir[parent].kind {
                    StmtKind::If { test, yes, .. } if child == yes => Some((test, false)),
                    StmtKind::If { test, no, .. } if child == no => Some((test, true)),
                    _ => None,
                },
                _ => None,
            };
            if let Some((test, answer)) = passed_over_by
                && self.find_answer_where_member_is_there(test, member, SymbolId::NONE)
                    == Some(answer)
            {
                return true;
            }
            node = match parent {
                Parent::Expr(parent) => Node::Expr(parent),
                Parent::Stmt(parent) => Node::Stmt(parent),
                _ => return false,
            };
        }
    }

    fn find_keys_written(&self, key: &KeyOfWrite) -> Vec<Atom> {
        match *key {
            KeyOfWrite::Name(name) => vec![name],
            KeyOfWrite::Computed(key) => self.find_keys_spelled_for(key),
        }
    }

    /// The key itself, what a constant holds, an element of the list that a loop walks, what the calls of a function of the file pass for it:
    /// `function plant(name) { Object.defineProperty(Object.prototype, name, d); }`, `plant("polluted")`.
    pub(super) fn find_keys_spelled_for(&self, key: ExprId) -> Vec<Atom> {
        let values = self.find_values_spelled_for(key).into_iter();
        let mut keys: Vec<Atom> = values
            .filter_map(|value| self.constant_key(value))
            .collect();
        // `for (const [name, value] of Object.entries(stubs)) Object.defineProperty(globalThis, name, { value })`, `withGlobals({ process: undefined })`
        if let Some(listed) = self.find_object_whose_keys_are_listed_for(key) {
            self.push_keys_of_literal(listed, &mut keys);
        }
        keys
    }

    /// `Symbol.iterator`, spelled in the same ways.
    fn find_symbols_spelled_for(&self, key: ExprId) -> Vec<BuiltinName> {
        let values = self.find_values_spelled_for(key).into_iter();
        let symbols =
            values.filter_map(|value| table::well_known_symbol(self.find_builtin(value)?));
        symbols.map(table::name_of_symbol).collect()
    }

    pub(super) fn constant_key(&self, key: ExprId) -> Option<Atom> {
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
            // `const names = ["set", "add"]`
            ExprKind::Ident(_) if depth < ROWS_AND_THEIR_CELLS => {
                let bound = self.input.bound;
                let literal = match bound.binding(value) {
                    Binding::Symbol(symbol) if bound.is_stable_binding(symbol) => {
                        match bound.binding_initializer(hir, symbol) {
                            BindingInitializer::Expression(initializer) => {
                                Some(hir.skip_type_assertions(initializer))
                            }
                            _ => None,
                        }
                    }
                    _ => None,
                };
                match literal.map(|literal| (literal, hir[literal].kind)) {
                    Some((literal, ExprKind::Array(_) | ExprKind::Object(_))) => {
                        self.push_values_of_literal(literal, depth + 1, values);
                    }
                    _ => values.push(value),
                }
            }
            _ => values.push(value),
        }
    }

    fn is_parameter(&self, value: ExprId) -> bool {
        let bound = self.input.bound;
        match bound.binding(self.input.hir.skip_type_assertions(value)) {
            Binding::Symbol(symbol) => matches!(*bound.symbol(symbol).decls, [Decl::Param(_)]),
            _ => false,
        }
    }

    /// The keys of an object literal, which may stand in a constant, `const members = { now: () => 0 }`, and may spread another.
    /// A function of the file may return it, `makeMixin()`, `Object.freeze()` hands it on, and `new Mixin()` has the fields of its class.
    fn push_keys_of_literal(&self, value: ExprId, keys: &mut Vec<Atom>) {
        let hir = self.input.hir;
        let mut seen = FxHashSet::default();
        let mut values = vec![value];
        while let Some(value) = values.pop() {
            for value in self.find_values_spelled_for(value) {
                let value = hir.skip_type_assertions(value);
                if !seen.insert(value) {
                    continue;
                }
                let properties = match hir[value].kind {
                    ExprKind::Object(properties) => properties,
                    ExprKind::Call(call) => {
                        let callee = self.value_of(hir[call].callee).map(|it| it.path.id);
                        match callee {
                            Some(callee) if returns_first_argument(callee) => {
                                values.extend(hir.ids(hir[call].args).next());
                            }
                            Some(_) => {}
                            None => {
                                for function in self.find_functions_behind(hir[call].callee) {
                                    values.extend_from_slice(&self.values_returned_by(function));
                                }
                            }
                        }
                        continue;
                    }
                    ExprKind::New(call) => {
                        for class in self.find_classes_behind(hir[call].callee) {
                            let members = hir[class].members.iter().map(|it| hir[it]);
                            keys.extend(members.filter_map(|it| match it.key {
                                PropKey::Name(name)
                                    if it.kind == MemberKind::Property
                                        && !it.flags.contains(Flags::STATIC) =>
                                {
                                    Some(name)
                                }
                                _ => None,
                            }));
                        }
                        continue;
                    }
                    _ => continue,
                };
                for property in properties.iter() {
                    match hir[property].key {
                        PropKey::Name(name) => keys.push(name),
                        PropKey::Computed(key) => keys.extend(self.find_keys_spelled_for(key)),
                        PropKey::None if hir[property].kind == PropKind::Spread => {
                            values.push(hir[property].value);
                        }
                        PropKey::None | PropKey::Private(_) => {}
                    }
                }
            }
        }
    }

    // On the object, or on one above it.
    fn finds_member(&self, holder: BuiltinId, key: Atom) -> bool {
        let found = (self.input.names.get(key)).map(|name| table::member(holder, name));
        matches!(found, Some(MemberLookup::Found(_)))
    }

    /// What a write of `key` on `holder` replaces or adds.
    fn note_write(&self, holder: BuiltinId, key: Atom, found: &mut Found) {
        let name = self.input.names.get(key);
        match name.map(|name| (name, table::member(holder, name))) {
            Some((name, MemberLookup::Found(member))) => {
                found.members.extend(self.find_locked_member(holder, name));
                // `spyOn(Uint8Array.prototype, "set")`: an object above has the member, and what is written stands in front of it.
                if table::entry(member).holder.map(table::canonical_id) != Some(holder) {
                    found.names.push((holder, key));
                }
            }
            _ if Self::takes_no_names(holder) => found.names.push((holder, key)),
            _ => {}
        }
    }

    /// `globalThis[holder]`: a member of the global object under a key that nobody can read.
    fn is_some_member_of_global_object(&self, value: ExprId) -> bool {
        let hir = self.input.hir;
        let Some((object, MemberKey::Computed(key))) =
            hir.member_key(hir.skip_type_assertions(value))
        else {
            return false;
        };
        self.find_builtin(object) == Some(BuiltinId::GlobalThis)
            && self.find_keys_spelled_for(key).is_empty()
    }

    /// A table may name the objects too, `[["Error", "toString"], ["console", "debug"]]`, for a loop that reads `globalThis[holder]` or `globalThis[holder].prototype`.
    /// And a helper may be handed such an object beside a name: `stub(globalThis[holder], "debug")`. Only a member that is there counts.
    fn find_members_named_beside_names_of_holders(&self, values: &[ExprId], found: &mut Found) {
        // Nearly every call and literal of a file ends here.
        let names_object = |value: ExprId| {
            let name = (self.constant_key(value)).and_then(|key| self.input.names.get(key));
            name.and_then(table::global).is_some()
        };
        let holds_some_member =
            (values.iter()).any(|&value| self.is_some_member_of_global_object(value));
        if !holds_some_member && !values.iter().any(|&value| names_object(value)) {
            return;
        }
        let names: Vec<BuiltinName> = (values.iter())
            .flat_map(|&value| self.find_keys_spelled_for(value))
            .filter_map(|key| self.input.names.get(key))
            .collect();
        let objects_of_global_object = || {
            let members = table::members(BuiltinId::GlobalThis).iter();
            members.map(|&member| table::canonical_id(member))
        };
        let holders: Vec<BuiltinId> = match holds_some_member {
            true => objects_of_global_object().collect(),
            false => (names.iter())
                .filter_map(|&name| table::global(name).map(table::canonical_id))
                .collect(),
        };
        let prototype = table::find_name(b"prototype");
        for holder in holders {
            let below = prototype.and_then(|name| match table::member(holder, name) {
                MemberLookup::Found(member) => Some(table::canonical_id(member)),
                MemberLookup::Unknown | MemberLookup::Absent => None,
            });
            for holder in [Some(holder), below].into_iter().flatten() {
                let members = names.iter();
                (found.members)
                    .extend(members.filter_map(|&name| self.find_locked_member(holder, name)));
            }
        }
    }

    fn find_members_named_beside_holders(
        &self,
        values: &[ExprId],
        found: &mut Found,
    ) -> Vec<BuiltinId> {
        self.find_members_named_beside_names_of_holders(values, found);
        let holders = values.iter();
        let holders: Vec<BuiltinId> = holders
            .flat_map(|&value| self.find_builtins_spelled_for(value))
            .collect();
        if holders.is_empty() {
            return holders;
        }
        let keys = values
            .iter()
            .flat_map(|&value| self.find_keys_spelled_for(value));
        for key in keys {
            for &holder in &holders {
                self.note_write(holder, key, found);
            }
        }
        let symbols = values
            .iter()
            .flat_map(|&value| self.find_symbols_spelled_for(value));
        for name in symbols {
            let members = holders.iter();
            (found.members)
                .extend(members.filter_map(|&holder| self.find_locked_member(holder, name)));
        }
        holders
    }

    /// `value.__proto__`, `value["__proto__"]`, `Reflect.get(value, "__proto__")`, `Object.getPrototypeOf(value)`: a prototype that the file does not name.
    fn is_prototype_of_some_value(&self, expr: ExprId) -> bool {
        let hir = self.input.hir;
        let names_the_way = |name: Atom| {
            (self.input.names.get(name)).is_some_and(|name| {
                let found = table::member(BuiltinId::ObjectPrototype, name);
                found == MemberLookup::Found(BuiltinId::ObjectPrototype__proto__)
            })
        };
        let spells_the_way = |key: ExprId| {
            self.find_keys_spelled_for(key)
                .into_iter()
                .any(names_the_way)
        };
        if let ExprKind::Call(call) = hir[expr].kind {
            return match self.value_of(hir[call].callee).map(|callee| callee.path.id) {
                Some(BuiltinId::ObjectGetPrototypeOf | BuiltinId::ReflectGetPrototypeOf) => true,
                Some(BuiltinId::ReflectGet) => {
                    hir.ids(hir[call].args).nth(1).is_some_and(spells_the_way)
                }
                _ => false,
            };
        }
        match hir.member_key(expr) {
            Some((_, MemberKey::Name(name))) => names_the_way(name),
            Some((_, MemberKey::Computed(key))) => spells_the_way(key),
            _ => false,
        }
    }

    // A built-in object beside the name of one of its members, as operands of a call or in a literal.
    fn find_members_named_by(&self, expr: ExprId, found: &mut Found) {
        let hir = self.input.hir;
        let mut values = Vec::new();
        let mut operands = Vec::new();
        match hir[expr].kind {
            // What a function of the table does with its operands is known: `Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")` writes nothing.
            ExprKind::Call(call) | ExprKind::New(call) => {
                if self.value_of(hir[call].callee).is_none() {
                    // `wrap(Map.prototype, ["set", "get"])`
                    operands.extend(hir.ids(hir[call].args));
                    for &operand in &operands {
                        self.push_values_of_literal(operand, 1, &mut values);
                    }
                }
            }
            ExprKind::Array(_) | ExprKind::Object(_) => {
                self.push_values_of_literal(expr, 0, &mut values);
            }
            _ => return,
        }
        // A text in a table may be a label. An operand of a helper beside the object is taken for a name: `plant(Object.prototype, "polluted")`.
        let names_before = found.names.len();
        let holders = self.find_members_named_beside_holders(&values, found);
        // `swap(Date, { now: () => 0 })`: the helper stores what it is handed under the names that it is handed it under.
        if !holders.is_empty() {
            let mut keys = Vec::new();
            for &operand in &operands {
                self.push_keys_of_literal(operand, &mut keys);
            }
            for holder in holders {
                for &key in &keys {
                    self.note_write(holder, key, found);
                }
            }
        }
        if !matches!(hir[expr].kind, ExprKind::Call(_)) {
            found.names.truncate(names_before);
        }
        let closed = (values.iter()).filter_map(|&value| self.find_builtin(value));
        (found.handed_on).extend(closed.filter(|&holder| Self::takes_no_names(holder)));
    }

    /// `jest.useFakeTimers()` stores the runner's functions on the global object and on `process`, so the files of the run read them there, a function
    /// that was kept before the call is the real one. Bun's own code has the real ones anyway: `find_native`.
    /// `Api::NAMES` in src/runtime/test_runner/timers/FakeTimers.rs has more: the clocks answer for themselves. `toFake` is not read.
    /// `vi.stubGlobal("fetch", f)` defines the name on the global object.
    fn find_members_replaced_by_runner(&self, expr: ExprId, found: &mut Found) {
        let hir = self.input.hir;
        let ExprKind::Call(call) = hir[expr].kind else {
            return;
        };
        let callees = match self.value_of(hir[call].callee) {
            Some(callee) => vec![callee.path.id],
            None => {
                let follows_names = found.mentions_stub_of_global;
                let callees =
                    self.find_members_of_runner_spelled_for(hir[call].callee, follows_names);
                let stubs = (callees.iter().copied()).filter(|&callee| table::stubs_global(callee));
                let stubs = stubs.map(|stub| (expr, table::canonical_id(stub)));
                found.calls_that_may_stub_global.extend(stubs);
                callees
            }
        };
        if callees.iter().any(|&callee| table::fakes_timers(callee)) {
            const TIMERS: [&[u8]; 8] = [
                b"setTimeout",
                b"clearTimeout",
                b"setInterval",
                b"clearInterval",
                b"setImmediate",
                b"clearImmediate",
                b"queueMicrotask",
                b"performance",
            ];
            let member_of = |holder, name| find_locked_member_of(holder, table::find_name(name)?);
            let timers = TIMERS.into_iter();
            let timers = timers.filter_map(|name| member_of(BuiltinId::GlobalThis, name));
            found.members.extend(timers);
            let process = table::find_name(b"process").and_then(table::global);
            let process = process.map(table::canonical_id);
            let tick = process.and_then(|process| member_of(process, b"nextTick"));
            found.members.extend(tick);
        }
        if callees.iter().any(|&callee| table::stubs_global(callee))
            && let Some(name) = hir.ids(hir[call].args).next()
        {
            let names = self.find_keys_spelled_for(name);
            if names.is_empty() {
                (found.members).extend(members_written_under_any_name(BuiltinId::GlobalThis));
            }
            for name in names {
                self.note_write(BuiltinId::GlobalThis, name, found);
            }
        }
    }

    fn find_members_of_runner_spelled_for(
        &self,
        callee: ExprId,
        follows_names: bool,
    ) -> Vec<BuiltinId> {
        let hir = self.input.hir;
        let callee = hir.skip_type_assertions(callee);
        let is_sought =
            |member: BuiltinId| table::fakes_timers(member) || table::stubs_global(member);
        if follows_names && matches!(hir[callee].kind, ExprKind::Ident(_)) {
            let values = self.find_values_spelled_for(callee).into_iter();
            let members = values.filter_map(|value| mentioned_id(self.state(value)));
            return members.filter(|&member| is_sought(member)).collect();
        }
        let Some((mut object, MemberKey::Name(name))) = hir.member_key(callee) else {
            return Vec::new();
        };
        let Some(name) = self.input.names.get(name) else {
            return Vec::new();
        };
        let member_of = |holder: BuiltinId| match table::member(holder, name) {
            MemberLookup::Found(member) if is_sought(member) => Some(member),
            _ => None,
        };
        if [BuiltinId::BunTestVi, BuiltinId::BunTestJest]
            .into_iter()
            .all(|runner| member_of(runner).is_none())
        {
            return Vec::new();
        }
        while let ExprKind::Call(link) = hir[hir.skip_type_assertions(object)].kind
            && let link = hir.skip_type_assertions(hir[link].callee)
            && let Some((receiver, MemberKey::Name(_))) = hir.member_key(link)
        {
            object = receiver;
        }
        let mut holders = Vec::new();
        for value in self.find_values_spelled_for(object) {
            holders.extend(self.find_builtin(value));
            if let ExprKind::Object(properties) = hir[value].kind {
                let spreads = properties.iter().map(|it| hir[it]);
                let spreads = spreads.filter(|it| it.kind == PropKind::Spread);
                holders.extend(spreads.flat_map(|it| self.find_builtins_spelled_for(it.value)));
            }
        }
        holders.into_iter().filter_map(member_of).collect()
    }

    fn find_object_described_by(&self, descriptors: ExprId) -> Option<ExprId> {
        let hir = self.input.hir;
        let ExprKind::Call(call) = hir[hir.skip_type_assertions(descriptors)].kind else {
            return None;
        };
        let callee = self.value_of(hir[call].callee)?.path.id;
        let described = hir.ids(hir[call].args).next()?;
        (callee == BuiltinId::ObjectGetOwnPropertyDescriptors).then_some(described)
    }

    // `Object.assign(Date, { now: () => 0 })`, `Object.defineProperties(Math, { random: d })`: the keys of the literals are written on the first operand.
    fn find_members_written_from_literals(&self, expr: ExprId, found: &mut Found) {
        let hir = self.input.hir;
        let ExprKind::Call(call) = hir[expr].kind else {
            return;
        };
        let callee = self.value_of(hir[call].callee).map(|callee| callee.path.id);
        let Some(BuiltinId::ObjectAssign | BuiltinId::ObjectDefineProperties) = callee else {
            return;
        };
        let mut operands = hir.ids(hir[call].args);
        let Some(object) = operands.next() else {
            return;
        };
        let holders = self.find_builtins_spelled_for(object);
        if holders.is_empty() {
            if self.input.replaced_members_sought == ReplacedMembersSought::WrittenOrNamed {
                let modules = self.find_imports_behind(object).into_iter();
                (found.modules_written_on).extend(modules.map(|behind| behind.0));
            }
            return;
        }
        for source in operands {
            // `Object.getOwnPropertyDescriptors(mixin)` has the keys of `mixin`.
            let source = self.find_object_described_by(source).unwrap_or(source);
            let mut keys = Vec::new();
            self.push_keys_of_literal(source, &mut keys);
            for key in keys {
                for &holder in &holders {
                    self.note_write(holder, key, found);
                }
            }
        }
    }

    /// `globalThis.__lookupSetter__("self").call({}, f)`, `Object.getOwnPropertyDescriptor(globalThis, "self").set`, `Object.getOwnPropertyDescriptors(globalThis)`:
    /// a name under which the global object holds itself is replaced by its own setter, so whoever is handed that writes the member.
    fn find_members_whose_setter_is_handed_out(&self, expr: ExprId, found: &mut Found) {
        let hir = self.input.hir;
        let ExprKind::Call(call) = hir[expr].kind else {
            return;
        };
        let callee = hir.skip_type_assertions(hir[call].callee);
        let builtin_behind = |value: ExprId| {
            mentioned_id(self.state(hir.skip_type_assertions(value))).map(table::canonical_id)
        };
        let looks_up_setter = |value: ExprId| {
            builtin_behind(value) == Some(BuiltinId::ObjectPrototype__lookupSetter__)
        };
        let name_of_lookup = table::entry(BuiltinId::ObjectPrototype__lookupSetter__).name;
        let mut operands = hir.ids(hir[call].args);
        let (object, key) = match (builtin_behind(callee), hir.member_key(callee)) {
            (
                Some(
                    BuiltinId::ObjectGetOwnPropertyDescriptor
                    | BuiltinId::ReflectGetOwnPropertyDescriptor,
                ),
                _,
            ) => (operands.next(), operands.next()),
            (Some(BuiltinId::ObjectGetOwnPropertyDescriptors), _) => (operands.next(), None),
            (Some(BuiltinId::ObjectPrototype__lookupSetter__), Some((receiver, _))) => {
                (Some(receiver), operands.next())
            }
            // `Object.prototype.__lookupSetter__.call(globalThis, "self")`
            (_, Some((borrowed, MemberKey::Name(name))))
                if name == known::call && looks_up_setter(borrowed) =>
            {
                (operands.next(), operands.next())
            }
            // The table does not say what stands above the global object. It has no such member of its own.
            (None, Some((receiver, MemberKey::Name(name))))
                if self.input.names.get(name) == Some(name_of_lookup)
                    && self.find_builtin(receiver).is_some() =>
            {
                (Some(receiver), operands.next())
            }
            _ => return,
        };
        let Some(object) = object else {
            return;
        };
        // No key, or one that nobody can read: any of them.
        let keys = key.map_or(Vec::new(), |key| self.find_keys_spelled_for(key));
        let names: Vec<BuiltinName> = (keys.iter())
            .filter_map(|&key| self.input.names.get(key))
            .collect();
        for holder in self.find_builtins_spelled_for(object) {
            let members = table::members(holder).iter().copied();
            found.members.extend(members.filter(|&member| {
                let name = table::entry(member).name;
                table::has_flag(member, BuiltinFlags::IS_GLOBAL_OBJECT)
                    && (keys.is_empty() || names.contains(&name))
                    && self.find_locked_member(holder, name).is_some()
            }));
        }
    }

    pub(super) fn collect_replaced_members(&mut self) {
        let sought = self.input.replaced_members_sought;
        if matches!(
            sought,
            ReplacedMembersSought::None | ReplacedMembersSought::NamesAdded
        ) {
            return;
        }
        let evaluated = self.evaluated_ids().map(ExprId);
        let evaluated =
            evaluated.filter(|&expr| !matches!(self.state(expr), ExprState::NotEvaluated));
        let mut found = Found {
            mentions_stub_of_global: (self.evaluated_ids().map(ExprId))
                .any(|expr| mentioned_id(self.state(expr)).is_some_and(table::stubs_global)),
            ..Found::default()
        };
        // A mock stands under every name of the module, whatever the table says of the member: `mock.module("node:module", () => ({ createRequire }))`.
        // Only the names of a module of native code are taken for members of the table, collect_import_aliases(), and only a locked one is bound without a look at the import.
        // `import { file } from "bun"` reads the object Bun, which no mock replaces. The build has to see which calls are spies, so the members of bun:test stay known.
        for (site, module) in self.input.targets.iter() {
            if let ImportSiteKind::MockModule(_) = site
                && !has_source(module)
                && table::object_replacing_namespace(module).is_none()
                && module != RuntimeModule::BunTest
            {
                let namespace = table::canonical_id(table::namespace_of(module));
                // Under `default` too, which is no member of the table but the object itself: find_export().
                found.members.push(namespace);
                let members = table::members(namespace);
                found.members.extend(members.iter().filter(|&&member| {
                    let entry = table::entry(member);
                    entry.mutability == Mutability::AlwaysLocked && entry.scope == Scope::Realm
                }));
            }
        }
        let mut keys = Vec::new();
        let mut keys_spelled = Vec::new();
        let mut objects_spelled = Vec::new();
        let mut keys_partly_read = Vec::new();
        let mut named_from_outside = Vec::new();
        let mut writes_on_imports = Vec::new();
        let mut writes_on_parameters_under_any_name = false;
        for expr in evaluated {
            if matches!(
                sought,
                ReplacedMembersSought::WrittenOrNamed
                    | ReplacedMembersSought::WrittenOrNamedUnlessOfProduct
            ) {
                self.find_members_named_by(expr, &mut found);
            } else if let ExprKind::Call(_) = self.input.hir[expr].kind {
                // `registry.applyPatch(globalThis, "fetch", wrap)`
                let mut named = Found::default();
                self.find_members_named_by(expr, &mut named);
                let is_cheap = |member: &BuiltinId| {
                    table::entry(*member).mutability == Mutability::ConstantUnlessWritten
                };
                (found.members).extend(named.members.into_iter().filter(is_cheap));
            }
            self.find_members_written_from_literals(expr, &mut found);
            self.find_members_replaced_by_runner(expr, &mut found);
            self.find_members_whose_setter_is_handed_out(expr, &mut found);
            self.note_names_stored_where_missing(expr, &mut found);
            let write = self.find_write(expr);
            let Some(write) = write.or_else(|| self.find_write_by_pattern(expr)) else {
                // `[Set] = [Fake]`, `({ Set } = fakes)`, `for (Set of fakes)`, `Set++`
                if let Some(global) = self.find_locked_global(expr)
                    && (self.input.bound)
                        .get_assignment_target(self.input.hir, expr)
                        .is_some()
                {
                    found.members.push(global);
                }
                if let ExprKind::Assign { target, .. } = self.input.hir[expr].kind {
                    let target = self.input.hir.skip_type_assertions(target);
                    found.members.extend(self.find_locked_global(target));
                }
                continue;
            };
            let holders = self.find_builtins_spelled_for(write.object);
            let is_computed = matches!(write.key, KeyOfWrite::Computed(_));
            let written = self.find_keys_written(&write.key);
            let symbols = match write.key {
                KeyOfWrite::Name(_) => Vec::new(),
                KeyOfWrite::Computed(key) => self.find_symbols_spelled_for(key),
            };
            if let ([holder], [key], []) = (&holders[..], &written[..], &symbols[..])
                && let Some(name) = self.input.names.get(*key)
                && let Some(member) = self.find_locked_member(*holder, name)
                && Self::is_there_and_not_falsy(member)
                && self.is_behind_test_that_finds_member_missing(expr, table::canonical_id(member))
            {
                continue;
            }
            // A name behind a dot on an object of the program's own says nothing.
            if holders.is_empty() && matches!(write.key, KeyOfWrite::Computed(_)) {
                keys.extend_from_slice(&written);
            }
            if let (KeyOfWrite::Computed(key), ExprKind::Call(_)) =
                (write.key, self.input.hir[expr].kind)
            {
                let key = self.input.hir.skip_type_assertions(key);
                keys_spelled.extend(written.iter().map(|&name| (key, name)));
                let is_read = |value: ExprId| {
                    let symbol = || table::well_known_symbol(self.find_builtin(value)?);
                    self.constant_key(value).is_some() || symbol().is_some()
                };
                if !self.find_values_spelled_for(key).into_iter().all(is_read) {
                    keys_partly_read.push(key);
                }
                let objects = self.find_values_spelled_for(write.object).into_iter();
                objects_spelled.extend(objects.map(|object| ObjectSpelled {
                    key,
                    object,
                    is_builtin: self.find_builtin(object).is_some(),
                }));
            }
            // Which prototype it is nobody says: the two that take no new names. A guess at what a test means: a package that gives the prototype
            // of its own class a `toString` means neither, and does in a test run what it does in an executable.
            let objects = self.find_values_spelled_for(write.object).into_iter();
            if holders.is_empty()
                && sought == ReplacedMembersSought::WrittenOrNamed
                && objects
                    .into_iter()
                    .any(|it| self.is_prototype_of_some_value(it))
            {
                for holder in [BuiltinId::ObjectPrototype, BuiltinId::FunctionPrototype] {
                    for &key in &written {
                        self.note_write(holder, key, &mut found);
                    }
                }
            }
            // Objects that the file reaches without their names, under a key that it spells. They come ON TOP of what stands above:
            // no older rule asks whether one was found. A package does in a test run what it does in an executable.
            let unnamed = match holders.is_empty()
                && sought == ReplacedMembersSought::WrittenOrNamed
                && (!symbols.is_empty() || !written.is_empty())
            {
                true => self.find_builtins_reached_without_names(write.object),
                false => Vec::new(),
            };
            // Only a member that is there counts, and only where a function is put in its place.
            if holders.is_empty()
                && sought == ReplacedMembersSought::WrittenOrNamed
                && self.puts_a_function_there(expr)
            {
                let names = written.iter().filter_map(|&key| self.input.names.get(key));
                let names: Vec<_> = names.chain(symbols.iter().copied()).collect();
                let guessed = match names.is_empty() {
                    true => Vec::new(),
                    false => self.find_builtins_guessed_widely(write.object),
                };
                for holder in guessed {
                    let members = names.iter();
                    (found.members)
                        .extend(members.filter_map(|&name| self.find_locked_member(holder, name)));
                }
            }
            // What another file hands out: who reads all the files puts the two together.
            if holders.is_empty() && sought == ReplacedMembersSought::WrittenOrNamed {
                let keys = written.iter();
                let keys: Vec<Atom> = keys
                    .copied()
                    .filter(|&name| self.input.names.get(name).is_some())
                    .collect();
                let imports = match written.is_empty() {
                    true => Vec::new(),
                    false => self.find_imports_behind(write.object),
                };
                // A helper of another file may answer what stands above its operand, or the operand's `prototype`:
                // `above(Uint8Array).prototype.fill = f`, `protoOf(Array).join = f`. Only a member that is there counts: a new name on an
                // object that stands above others would be opened for all of them.
                let reached = (unnamed.iter()).filter(|_| !imports.is_empty() && !keys.is_empty());
                for around in reached.flat_map(|&it| find_builtins_around(it)) {
                    let names = keys.iter().filter_map(|&key| self.input.names.get(key));
                    let names = names.chain(symbols.iter().copied());
                    (found.members)
                        .extend(names.filter_map(|name| self.find_locked_member(around, name)));
                }
                for (module, path) in imports {
                    found.modules_written_on.push(module);
                    writes_on_imports.extend(keys.iter().map(|&key| WriteOnImport {
                        module,
                        path: path.clone(),
                        key,
                    }));
                }
            }
            // What another file passes for the parameter: who reads all the files puts the two together.
            if holders.is_empty()
                && written.is_empty()
                && symbols.is_empty()
                && is_computed
                && self.is_parameter(write.object)
            {
                writes_on_parameters_under_any_name = true;
            }
            for &holder in holders.iter().chain(&unnamed) {
                if written.is_empty() && symbols.is_empty() {
                    if Self::takes_no_names(holder) {
                        named_from_outside.push(holder);
                    }
                    (found.members).extend(members_written_under_any_name(holder));
                }
                for &key in &written {
                    self.note_write(holder, key, &mut found);
                }
                let members = symbols.iter();
                (found.members)
                    .extend(members.filter_map(|&name| self.find_locked_member(holder, name)));
            }
        }
        keys_spelled.shared_sort_by_key(|entry: &(ExprId, Atom)| entry.0);
        // An executable takes a store on `fetch` or a timer: its build sees the store. A layer doesn't see the files above it, so it has to be told.
        if sought == ReplacedMembersSought::NamesAddedByProduct {
            (found.members).retain(|&member| {
                table::entry(member).mutability == Mutability::ConstantUnlessWritten
            });
            self.output.replaced_members = found.members;
            return;
        }
        self.output.keys_spelled_on_other_objects = keys_spelled;
        objects_spelled.shared_sort_by_key(|entry: &ObjectSpelled| entry.key);
        self.output.objects_spelled_for_calls = objects_spelled;
        keys_partly_read.shared_sort_unstable();
        self.output.keys_partly_read = keys_partly_read;
        found.calls_that_may_stub_global.shared_sort_unstable();
        found.calls_that_may_stub_global.dedup();
        self.output.calls_that_may_stub_global =
            core::mem::take(&mut found.calls_that_may_stub_global);
        // A list of objects here, a loop that writes one key on each of them there: every object that the file hands on meets every such key.
        found.handed_on.shared_sort_unstable();
        found.handed_on.dedup();
        for holder in core::mem::take(&mut found.handed_on) {
            for &key in &keys {
                if !self.finds_member(holder, key) {
                    found.names.push((holder, key));
                }
            }
        }
        let mut seen = FxHashSet::default();
        found.names.retain(|&name| seen.insert(name));
        self.output.replaced_members = found.members;
        self.output.names_added = found.names;
        self.output.holders_named_from_outside = named_from_outside;
        self.output.writes_on_parameters_under_any_name = writes_on_parameters_under_any_name;
        self.output.writes_on_imports = writes_on_imports;
        let mut seen = FxHashSet::default();
        (found.modules_written_on).retain(|&module| seen.insert(module));
        self.output.modules_written_on = found.modules_written_on;
        self.output.builtins_handed_out = self.find_builtins_handed_out();
        self.output.builtins_exported = self.find_builtins_exported();
    }

    /// `Function.prototype.call$0 = f` in an executable. A holder is an expression of the file that stands for the object, so a file without one adds nothing.
    pub(super) fn collect_names_added(&mut self) {
        // Whether a package of a test run is the product's shows behind the load, so what an executable's build would find in it is kept beside what the tests' reading finds.
        // So it is with a file of the project that lies outside the folders of the tests.
        let is_read_both_ways = matches!(
            self.input.replaced_members_sought,
            ReplacedMembersSought::Written | ReplacedMembersSought::WrittenOrNamedUnlessOfProduct
        );
        if !(self.seeks_names_added_alone() || is_read_both_ways)
            || !self.output.names_holder_that_takes_spelled_names
        {
            return;
        }
        let evaluated = self.evaluated_ids().map(ExprId);
        let evaluated =
            evaluated.filter(|&expr| !matches!(self.state(expr), ExprState::NotEvaluated));
        let mut found = Found::default();
        for expr in evaluated {
            self.find_members_written_from_literals(expr, &mut found);
            self.note_names_stored_where_missing(expr, &mut found);
            let write = self.find_write(expr);
            let Some(write) = write.or_else(|| self.find_write_by_pattern(expr)) else {
                continue;
            };
            let holders = self.find_builtins_spelled_for(write.object);
            if holders.is_empty() {
                continue;
            }
            let written = self.find_keys_written(&write.key);
            for &holder in &holders {
                for &key in &written {
                    self.note_write(holder, key, &mut found);
                }
            }
        }
        // A name that an object above has hides a built-in member: in an executable that write throws, like the one that replaces the member.
        (found.names).retain(|&(holder, key)| !self.finds_member(holder, key));
        let mut seen = FxHashSet::default();
        (found.names).retain(|&name| name.0 != BuiltinId::ObjectPrototype && seen.insert(name));
        match is_read_both_ways {
            true => self.output.names_added_in_executable = found.names,
            false => self.output.names_added = found.names,
        }
    }
}
