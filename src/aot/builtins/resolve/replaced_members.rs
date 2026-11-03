//! Where a file of a test run replaces a member of a built-in object under a name that it spells:
//! `String.prototype.at = f`, `delete Array.from`, `spyOn(Map.prototype, "get")`, `Object.defineProperty(Buffer, "from", d)`, `Object.assign(Date, { now })`.
//! And where it may: a built-in object beside the name of one of its members, as operands of a call or in a literal,
//! `stub(Array.prototype, "join")`, `[Map.prototype, "get"]`, `{ holder: Object, key: "assign" }`. A helper or a loop over a table does the rest.
//! A member too many costs a test where it is used. One that is missed here stays locked, and the test that writes it gets a TypeError.

use super::imports::has_source;
use super::resolver::{ExprState, Resolver};
use super::{ObjectSpelled, ReplacedMembersSought, WriteOnImport};
use crate::builtins::table::{
    self, BuiltinFlags, BuiltinId, BuiltinName, MemberLookup, Mutability, RuntimeModule, Scope,
};
use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, BindingInitializer};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{BinOp, ExprId, ExprKind, MemberKey, NodeData, PropKey, UnOp};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::util::{FxHashSet, SharedSort};

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

#[derive(Default)]
struct Found {
    members: Vec<BuiltinId>,
    names: Vec<(BuiltinId, Atom)>,
    /// Objects that take no new names and go where the file does not follow them.
    handed_on: Vec<BuiltinId>,
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
        (table::entry(global).mutability == Mutability::AlwaysLocked).then_some(global)
    }

    pub(super) fn find_builtin(&self, value: ExprId) -> Option<BuiltinId> {
        let holder = self.value_of(value).or_else(|| self.held_value_of(value))?;
        Some(
            match table::has_flag(holder.path.id, BuiltinFlags::IS_GLOBAL_OBJECT) {
                true => BuiltinId::GlobalThis,
                false => table::canonical_id(holder.path.id),
            },
        )
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
            key: match key {
                MemberKey::Name(name) => KeyOfWrite::Name(name),
                MemberKey::Computed(key) => KeyOfWrite::Computed(key),
                MemberKey::PrivateName(_) => return None,
            },
        })
    }

    /// The key itself, what a constant holds, an element of the list that a loop walks, what the calls of a function of the file pass for it:
    /// `function plant(name) { Object.defineProperty(Object.prototype, name, d); }`, `plant("polluted")`.
    pub(super) fn find_keys_spelled_for(&self, key: ExprId) -> Vec<Atom> {
        let values = self.find_values_spelled_for(key).into_iter();
        values
            .filter_map(|value| self.constant_key(value))
            .collect()
    }

    /// `Symbol.iterator`, spelled in the same ways.
    fn find_symbols_spelled_for(&self, key: ExprId) -> Vec<BuiltinName> {
        let values = self.find_values_spelled_for(key).into_iter();
        let symbols =
            values.filter_map(|value| table::well_known_symbol(self.find_builtin(value)?));
        symbols.map(table::name_of_symbol).collect()
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

    /// What a write of `key` on `holder` replaces or adds.
    fn note_write(&self, holder: BuiltinId, key: Atom, found: &mut Found) {
        let name = self.input.names.get(key);
        match name.map(|name| (name, table::member(holder, name))) {
            Some((name, MemberLookup::Found(_))) => {
                found.members.extend(self.find_locked_member(holder, name));
            }
            _ if Self::takes_no_names(holder) => found.names.push((holder, key)),
            _ => {}
        }
    }

    fn find_members_named_beside_holders(&self, values: &[ExprId], found: &mut Found) {
        let holders = values.iter();
        let holders: Vec<BuiltinId> = holders
            .flat_map(|&value| self.find_builtins_spelled_for(value))
            .collect();
        if holders.is_empty() {
            return;
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
        match hir[expr].kind {
            // What a function of the table does with its operands is known: `Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")` writes nothing.
            ExprKind::Call(call) | ExprKind::New(call) => {
                if self.value_of(hir[call].callee).is_none() {
                    // `wrap(Map.prototype, ["set", "get"])`
                    for operand in hir.ids(hir[call].args) {
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
        self.find_members_named_beside_holders(&values, found);
        if !matches!(hir[expr].kind, ExprKind::Call(_)) {
            found.names.truncate(names_before);
        }
        let closed = (values.iter()).filter_map(|&value| self.find_builtin(value));
        (found.handed_on).extend(closed.filter(|&holder| Self::takes_no_names(holder)));
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
            return;
        }
        for source in operands {
            let ExprKind::Object(properties) = hir[hir.skip_type_assertions(source)].kind else {
                continue;
            };
            for property in properties.iter() {
                let keys = match hir[property].key {
                    PropKey::Name(name) => vec![name],
                    PropKey::Computed(key) => self.find_keys_spelled_for(key),
                    PropKey::None | PropKey::Private(_) => continue,
                };
                for key in keys {
                    for &holder in &holders {
                        self.note_write(holder, key, found);
                    }
                }
            }
        }
    }

    pub(super) fn collect_replaced_members(&mut self) {
        let sought = self.input.replaced_members_sought;
        if sought == ReplacedMembersSought::None {
            return;
        }
        let evaluated = self.evaluated_ids().map(ExprId);
        let evaluated =
            evaluated.filter(|&expr| !matches!(self.state(expr), ExprState::NotEvaluated));
        let mut found = Found::default();
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
        for expr in evaluated {
            if sought == ReplacedMembersSought::WrittenOrNamed {
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
            let Some(write) = self.find_write(expr) else {
                if let ExprKind::Assign { target, .. } = self.input.hir[expr].kind {
                    let target = self.input.hir.skip_type_assertions(target);
                    found.members.extend(self.find_locked_global(target));
                }
                continue;
            };
            let holders = self.find_builtins_spelled_for(write.object);
            let written = match write.key {
                KeyOfWrite::Name(name) => vec![name],
                KeyOfWrite::Computed(key) => self.find_keys_spelled_for(key),
            };
            let symbols = match write.key {
                KeyOfWrite::Name(_) => Vec::new(),
                KeyOfWrite::Computed(key) => self.find_symbols_spelled_for(key),
            };
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
            // What another file hands out: who reads all the files puts the two together.
            if holders.is_empty() && sought == ReplacedMembersSought::WrittenOrNamed {
                let keys = written.iter();
                let keys: Vec<Atom> = keys
                    .copied()
                    .filter(|&name| self.input.names.get(name).is_some())
                    .collect();
                let imports = match keys.is_empty() {
                    true => Vec::new(),
                    false => self.find_imports_behind(write.object),
                };
                for (import, path) in imports {
                    writes_on_imports.extend(keys.iter().map(|&key| WriteOnImport {
                        import,
                        path: path.clone(),
                        key,
                    }));
                }
            }
            for &holder in holders.iter().chain(&unnamed) {
                // Nobody can read the name: `for (const name of Object.keys(Math)) spyOn(Math, name)`, `function setGlobal(name, value) { globalThis[name] = value; }`.
                // Of the global object only what is tested where it is used anyway, fetch and the timers: Map and Array are too much to give up for it.
                if written.is_empty() && symbols.is_empty() {
                    if Self::takes_no_names(holder) {
                        named_from_outside.push(holder);
                    }
                    let members = table::members(holder).iter();
                    found.members.extend(members.filter(|&&member| {
                        let entry = table::entry(member);
                        let is_cheap = entry.mutability == Mutability::ConstantUnlessWritten;
                        entry.mutability != Mutability::ChangesOnItsOwn
                            && entry.scope == Scope::Realm
                            && (is_cheap || holder != BuiltinId::GlobalThis)
                    }));
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
        self.output.keys_spelled_on_other_objects = keys_spelled;
        objects_spelled.shared_sort_by_key(|entry: &ObjectSpelled| entry.key);
        self.output.objects_spelled_for_calls = objects_spelled;
        keys_partly_read.shared_sort_unstable();
        self.output.keys_partly_read = keys_partly_read;
        // A list of objects here, a loop that writes one key on each of them there: every object that the file hands on meets every such key.
        found.handed_on.shared_sort_unstable();
        found.handed_on.dedup();
        for holder in core::mem::take(&mut found.handed_on) {
            for &key in &keys {
                if !matches!(
                    (self.input.names.get(key)).map(|name| table::member(holder, name)),
                    Some(MemberLookup::Found(_))
                ) {
                    found.names.push((holder, key));
                }
            }
        }
        let mut seen = FxHashSet::default();
        found.names.retain(|&name| seen.insert(name));
        self.output.replaced_members = found.members;
        self.output.names_added = found.names;
        self.output.holders_named_from_outside = named_from_outside;
        self.output.writes_on_imports = writes_on_imports;
        self.output.builtins_handed_out = self.find_builtins_handed_out();
    }
}
