//! What a file of a test run writes into built-in objects, by binding: `Date.now = f`, `delete Array.from`, `spyOn(Map.prototype, "get")`,
//! `Object.defineProperty(Buffer, "from", d)`, `Object.assign(Date, { now })`, `vi.stubGlobal("fetch", f)`, `jest.useFakeTimers()`, `expect.extend({ toBeOdd })`.
//! A key that nobody can read opens the whole object, and so does an object that goes where the file does not follow it.
//! A member too many costs a test where it is used. One that is missed stays locked, and the test that writes it gets a TypeError.
//! An executable refuses such a write. Of its files only the names count that they add to an object which takes no other: `Function.prototype.once = f`.

use super::imports::has_source;
use super::mention_use::MentionUse;
use super::mentions::mentioned_id;
use super::resolver::{AliasSource, ExprState, ResolvedValue, Resolver};
use super::{SourceDialect, SpyCall};
use crate::builtins::table::{
    self, BuiltinFlags, BuiltinId, BuiltinKind, BuiltinName, MemberLookup, Mutability, Platforms,
    RuntimeModule, Scope,
};
use bun_sema::atom::Atom;
use bun_sema::bind::{
    AssignmentTarget, Binding, BindingInitializer, Decl, Parent, PatParent, StoreKind,
};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{
    BinOp, ClassId, ExprId, ExprKind, Flags, FnBody, FnId, MemberKey, MemberKind, NodeData, PatId,
    PatKind, PropKey, PropKind, StmtKind,
};
use bun_sema::import_sites::{ImportSiteKind, find_values_of_parameter};
use bun_sema::util::{FxHashSet, SharedSort};
use smallvec::{SmallVec, smallvec};
use std::sync::OnceLock;

/// A function of the table through which a file writes on built-in objects.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Writer {
    /// `spyOn(object, key)`
    Spy,
    /// `Object.defineProperty(object, key, d)`, `Reflect.deleteProperty(object, key)`.
    /// `Object.getOwnPropertyDescriptor(object, key)` hands out the setter of the member.
    MemberOfOperand,
    /// `Reflect.set(target, key, value, receiver)`
    MemberOfReceiverOperand,
    /// `object.__defineGetter__(key, getter)`
    MemberOfReceiver,
    /// `Object.assign(object, { key })`, `Object.defineProperties(object, { key: d })`
    KeysOfOperands,
    /// `vi.stubGlobal(key, value)`
    Global,
    /// `expect.extend({ key })`
    Matchers,
    /// `jest.useFakeTimers()`
    Timers,
    /// `setSystemTime(date)`
    SystemTime,
    /// `jest.resetModules()`, `jest.isolateModules(f)`
    LoadedModules,
    /// `mock.module(name, factory)`, `jest.mock(name, factory)`, `vi.doMock(name, factory)`
    MockedModules,
    /// `Bun.jest(path)` answers the object of the test runner.
    TestRunner,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum WriteRuns {
    Always,
    /// `object.key ??= value`, `object.key ||= value`
    WhereNothingIsThere,
}

#[derive(Copy, Clone)]
enum WrittenKey {
    Text(Atom),
    /// `Symbol.iterator`
    Symbol(BuiltinName),
}

type WrittenKeys = SmallVec<[WrittenKey; 2]>;

/// The names in the table under which the test runner holds the writers that have no question of their own there.
struct NamesOfWriters {
    spy_on: BuiltinName,
    extend: Option<BuiltinName>,
    set_system_time: Option<BuiltinName>,
    isolate_modules: [Option<BuiltinName>; 2],
    mock_module: [Option<BuiltinName>; 3],
}

fn names_of_writers() -> &'static NamesOfWriters {
    static NAMES: OnceLock<NamesOfWriters> = OnceLock::new();
    NAMES.get_or_init(|| NamesOfWriters {
        spy_on: table::entry(BuiltinId::BunTestSpyOn).name,
        extend: table::find_name(b"extend"),
        set_system_time: table::find_name(b"setSystemTime"),
        isolate_modules: [
            table::find_name(b"isolateModules"),
            table::find_name(b"isolateModulesAsync"),
        ],
        mock_module: [
            table::find_name(b"module"),
            table::find_name(b"mock"),
            table::find_name(b"doMock"),
        ],
    })
}

pub(super) fn holder_of(id: BuiltinId) -> BuiltinId {
    match table::has_flag(id, BuiltinFlags::IS_GLOBAL_OBJECT) {
        true => BuiltinId::GlobalThis,
        false => table::canonical_id(id),
    }
}

fn is_of_test_runner(id: BuiltinId) -> bool {
    table::entry(table::root_of(id)).module == Some(RuntimeModule::BunTest)
}

/// `mock`, and `jest` and `vi` of either flavor of the runner: those two are what holds `resetModules`. `object`: a canonical id.
fn mocks_modules(object: BuiltinId) -> bool {
    let mut members = table::members(object).iter();
    object == table::canonical_id(BuiltinId::BunTestMock)
        || members.any(|&member| table::resets_modules(member))
}

/// `function`: a canonical id.
pub(super) fn writes_on_first_operand(function: BuiltinId) -> bool {
    matches!(
        find_writer(function),
        Some(
            Writer::Spy
                | Writer::MemberOfOperand
                | Writer::MemberOfReceiverOperand
                | Writer::KeysOfOperands
        )
    )
}

/// `function`: a canonical id.
fn find_writer(function: BuiltinId) -> Option<Writer> {
    let writer = match function {
        BuiltinId::BunTestSpyOn | BuiltinId::BunTestJestSpyOn | BuiltinId::BunTestViSpyOn => {
            Writer::Spy
        }
        BuiltinId::ObjectDefineProperty
        | BuiltinId::ReflectDefineProperty
        | BuiltinId::ReflectDeleteProperty
        | BuiltinId::ObjectGetOwnPropertyDescriptor
        | BuiltinId::ReflectGetOwnPropertyDescriptor => Writer::MemberOfOperand,
        BuiltinId::ReflectSet => Writer::MemberOfReceiverOperand,
        BuiltinId::ObjectPrototype__defineGetter__
        | BuiltinId::ObjectPrototype__defineSetter__
        | BuiltinId::ObjectPrototype__lookupSetter__ => Writer::MemberOfReceiver,
        BuiltinId::ObjectAssign | BuiltinId::ObjectDefineProperties => Writer::KeysOfOperands,
        BuiltinId::BunJest => Writer::TestRunner,
        _ if table::fakes_timers(function) => Writer::Timers,
        _ if table::stubs_global(function) => Writer::Global,
        _ if table::resets_modules(function) => Writer::LoadedModules,
        _ => {
            let (entry, names) = (table::entry(function), names_of_writers());
            let name = Some(entry.name);
            let holder = entry.holder.map(table::canonical_id);
            if holder == Some(BuiltinId::Expect) && name == names.extend {
                Writer::Matchers
            } else if !is_of_test_runner(function) {
                return None;
            } else if entry.name == names.spy_on {
                // Under whichever object of the runner it stands.
                Writer::Spy
            } else if name == names.set_system_time {
                Writer::SystemTime
            } else if names.isolate_modules.contains(&name) {
                Writer::LoadedModules
            } else if names.mock_module.contains(&name) && holder.is_some_and(mocks_modules) {
                Writer::MockedModules
            } else {
                return None;
            }
        }
    };
    Some(writer)
}

// It puts what it is handed above another object, or answers what stands above it, and hands it to no code of the program.
fn leaves_operands_as_they_are(function: BuiltinId) -> bool {
    matches!(
        function,
        BuiltinId::ObjectCreate
            | BuiltinId::ObjectSetPrototypeOf
            | BuiltinId::ReflectSetPrototypeOf
            | BuiltinId::ObjectGetPrototypeOf
            | BuiltinId::ReflectGetPrototypeOf
    )
}

// `const D = Object.assign(Date, { zone: 1 })`: whoever gets what the call answers has the object.
fn answers_first_operand(function: BuiltinId) -> bool {
    matches!(
        function,
        BuiltinId::ObjectDefineProperty
            | BuiltinId::ObjectDefineProperties
            | BuiltinId::ObjectAssign
            | BuiltinId::ObjectSetPrototypeOf
    )
}

// `const helpers = Object.freeze({ upper })`: what the call answers has the keys of its operand.
fn hands_first_operand_on(function: BuiltinId) -> bool {
    matches!(
        function,
        BuiltinId::ObjectFreeze | BuiltinId::ObjectSeal | BuiltinId::ObjectPreventExtensions
    )
}

// `module.exports = f` writes an object of the file's own.
fn may_be_replaced(member: BuiltinId) -> bool {
    let entry = table::entry(member);
    entry.mutability != Mutability::ChangesOnItsOwn && entry.scope == Scope::Realm
}

/// Of the global object only what is tested where it is used anyway, fetch and the timers: Map and Array are too much to give up for one computed store.
fn comes_with_holder(holder: BuiltinId, member: BuiltinId) -> bool {
    let is_cheap = table::entry(member).mutability == Mutability::ConstantUnlessWritten;
    may_be_replaced(member) && (is_cheap || holder != BuiltinId::GlobalThis)
}

// `list.map(Math.floor)`: a function that holds nothing but its `name` and `length` is handed on to be called.
fn opens_where_handed_on(object: BuiltinId) -> bool {
    let is_function = matches!(
        table::entry(object).kind,
        BuiltinKind::Function | BuiltinKind::Method
    );
    table::members(object).iter().any(|&member| {
        let is_plain_data = table::entry(member).kind == BuiltinKind::DataProperty
            && table::members(member).is_empty();
        comes_with_holder(object, member) && !(is_function && is_plain_data)
    })
}

fn takes_no_names(holder: BuiltinId) -> bool {
    table::has_flag(holder, BuiltinFlags::IS_LOCKED_OBJECT)
        || table::has_flag(holder, BuiltinFlags::IS_CLOSED_TO_OTHER_NAMES)
}

/// Whether a name that the table does not list on `object`, a canonical id, still says something where it is written behind the object itself:
/// it may be any writer of the runner, and an object that takes no names takes those that a file spells.
pub(super) fn follows_unlisted_names_of(object: BuiltinId) -> bool {
    is_of_test_runner(object)
        || table::HOLDERS_OF_MATCHERS.contains(&object)
        || takes_no_names(object)
}

/// In an executable, where nothing can be added to Object.prototype.
fn takes_names_that_a_file_spells(holder: BuiltinId) -> bool {
    holder != BuiltinId::ObjectPrototype && takes_no_names(holder)
}

/// A locked object, function or symbol, on every platform: `Symbol.dispose ??= Symbol("dispose")` writes only behind another write.
/// `RegExp.prototype.flags` is "" and `Array.prototype.length` 0.
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
    is_object
        && entry.mutability == Mutability::AlwaysLocked
        && entry.platforms == Platforms::all()
}

#[derive(Default)]
struct WritesFound {
    /// Places that get another value, and the modules of native code that are mocked.
    members: Vec<BuiltinId>,
    /// Objects of which any member may be written. Each stays the object that it is.
    opened: Vec<BuiltinId>,
    names: Vec<(BuiltinId, Atom)>,
    spy_calls: Vec<SpyCall>,
    hands_spy_on: bool,
    hands_mock_on: bool,
    resets_modules: bool,
    /// Operands, without their type assertions, whose part in their call is known. They ascend once every call has been looked at.
    followed: Vec<ExprId>,
    runner_objects_out_of_sight: Vec<BuiltinId>,
}

impl WritesFound {
    fn replace(&mut self, member: BuiltinId) {
        self.members.push(member);
        // A path names the object that a place holds, and two places may hold one object: `String.prototype.trimLeft`.
        let object = table::canonical_id(member);
        if object != member {
            self.members.push(object);
        }
    }

    /// Any member of `holder` may be written. Whoever unites the files lists them.
    fn open(&mut self, holder: BuiltinId) {
        let mut members = table::members(holder).iter();
        if members.any(|&member| comes_with_holder(holder, member)) {
            self.opened.push(holder);
        }
    }

    /// The runner stores functions of its own on the global object and on `process`. The clocks answer for themselves. `toFake` is not read.
    fn replace_timers(&mut self) {
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
        let member_of = |holder: BuiltinId, name: &[u8]| {
            let member = table::own_member(holder, table::find_name(name)?);
            member.filter(|&member| may_be_replaced(member))
        };
        let timers = TIMERS.into_iter();
        let timers = timers.filter_map(|name| member_of(BuiltinId::GlobalThis, name));
        for member in timers.chain(member_of(BuiltinId::Process, b"nextTick")) {
            self.replace(member);
        }
    }

    /// Nobody sees what it is called with.
    fn note_writer_out_of_sight(&mut self, writer: Writer) {
        match writer {
            Writer::Spy => self.hands_spy_on = true,
            Writer::LoadedModules => self.resets_modules = true,
            Writer::MockedModules => self.hands_mock_on = true,
            Writer::Timers => self.replace_timers(),
            Writer::SystemTime => {
                self.replace(BuiltinId::Date);
                self.replace(BuiltinId::DateNow);
            }
            Writer::Global => self.open(BuiltinId::GlobalThis),
            Writer::Matchers => {
                for holder in table::HOLDERS_OF_MATCHERS {
                    self.open(holder);
                }
            }
            Writer::TestRunner => {
                self.note_runner_out_of_sight(table::namespace_of(RuntimeModule::BunTest));
            }
            // It writes on what it is handed, and a built-in object that is handed on is open.
            Writer::MemberOfOperand
            | Writer::MemberOfReceiverOperand
            | Writer::MemberOfReceiver
            | Writer::KeysOfOperands => {}
        }
    }

    /// Whoever holds an object of the test runner calls what lies below it.
    fn note_runner_out_of_sight(&mut self, object: BuiltinId) {
        let mut pending: SmallVec<[BuiltinId; 16]> = smallvec![object];
        while let Some(reached) = pending.pop() {
            let reached = table::canonical_id(reached);
            let holds_matchers = table::HOLDERS_OF_MATCHERS.contains(&reached);
            if !(holds_matchers || is_of_test_runner(reached))
                || self.runner_objects_out_of_sight.contains(&reached)
            {
                continue;
            }
            self.runner_objects_out_of_sight.push(reached);
            self.hands_mock_on |= mocks_modules(reached);
            if holds_matchers {
                self.note_writer_out_of_sight(Writer::Matchers);
                continue;
            }
            if let Some(writer) = find_writer(reached) {
                self.note_writer_out_of_sight(writer);
            }
            pending.extend_from_slice(table::members(reached));
        }
    }

    fn note_object_out_of_sight(&mut self, object: BuiltinId) {
        if is_of_test_runner(object) || table::HOLDERS_OF_MATCHERS.contains(&object) {
            self.note_runner_out_of_sight(object);
        } else if let Some(writer) = find_writer(object) {
            self.note_writer_out_of_sight(writer);
        }
        if opens_where_handed_on(object) {
            self.opened.push(object);
        }
    }
}

impl Resolver<'_, '_> {
    /// The built-in object that the expression stands for. Under a `with` it may be that object.
    fn find_holder_behind(&self, object: ExprId) -> Option<BuiltinId> {
        match self.state(self.input.hir.skip_type_assertions(object)) {
            ExprState::DynamicGlobal(path) => Some(holder_of(path.id)),
            state => mentioned_id(state).map(holder_of),
        }
    }

    // The global object does not list all that it holds, so the table does not say what it inherits. What may be a function of Object.prototype is taken for it.
    fn find_function_run_by(&self, callee: ExprId) -> Option<BuiltinId> {
        let hir = self.input.hir;
        let callee = hir.skip_type_assertions(callee);
        if let Some(function) = mentioned_id(self.state(callee)) {
            return Some(table::canonical_id(function));
        }
        let (object, MemberKey::Name(name)) = hir.member_key(callee)? else {
            return None;
        };
        let (holder, name) = (
            self.find_holder_behind(object)?,
            self.input.names.get(name)?,
        );
        match (
            table::member(holder, name),
            table::member(BuiltinId::ObjectPrototype, name),
        ) {
            (MemberLookup::Unknown, MemberLookup::Found(inherited)) => {
                Some(table::canonical_id(inherited))
            }
            _ => None,
        }
    }

    fn is_run_by_plain_call(&self, call: ExprId, function: BuiltinId) -> bool {
        let hir = self.input.hir;
        matches!(hir[call].kind, ExprKind::Call(call)
            if self.find_function_run_by(hir[call].callee) == Some(function))
    }

    pub(super) fn outermost_assertion_of(&self, value: ExprId) -> ExprId {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut outermost = value;
        while let Parent::Expr(parent) = bound.parent_of_expr(outermost)
            && hir.type_assertion_operand(parent) == Some(outermost)
        {
            outermost = parent;
        }
        outermost
    }

    fn find_plain_call_of(&self, function: ExprId) -> Option<ExprId> {
        let hir = self.input.hir;
        let callee = self.outermost_assertion_of(function);
        let Parent::Expr(user) = self.input.bound.parent_of_expr(callee) else {
            return None;
        };
        matches!(hir[user].kind, ExprKind::Call(call) if hir[call].callee == callee).then_some(user)
    }

    // `mock.module(name, factory)`, `vi.importActual(name)`: whoever unites the files reads the site.
    fn is_callee_of_site_of_runner(&self, callee: ExprId) -> bool {
        self.find_plain_call_of(callee).is_some_and(|call| {
            let sites = [
                ImportSiteKind::MockModule(call),
                ImportSiteKind::ImportByTestRunner(call),
                ImportSiteKind::RequireByTestRunner(call),
            ];
            sites
                .into_iter()
                .any(|site| self.input.targets.has_site(site))
        })
    }

    /// `stubs` for `name` in `for (const name of Object.keys(stubs))` and `for (const [name, stub] of Object.entries(stubs))`.
    /// `key`: without its type assertions. A name that is read inside the walked expression is in its dead zone, and it would be asked for its own keys without end.
    fn find_object_whose_keys_are_walked(&self, key: ExprId) -> Option<ExprId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let (ExprKind::Ident(_), Binding::Symbol(symbol)) = (hir[key].kind, bound.binding(key))
        else {
            return None;
        };
        let Some(Decl::Var(name)) = bound.initializing_declaration(symbol) else {
            return None;
        };
        let (whole, function) = match bound.pat_parent[name.idx()] {
            PatParent::Elem(whole, element) => {
                let PatKind::Array(elements) = hir[whole].kind else {
                    return None;
                };
                let is_first = elements.iter().next() == Some(element)
                    && !hir[element].is_rest
                    && hir[element].default.is_none();
                (whole, is_first.then_some(BuiltinId::ObjectEntries)?)
            }
            _ => (name, BuiltinId::ObjectKeys),
        };
        let PatParent::Var(declaration) = bound.pat_parent[whole.idx()] else {
            return None;
        };
        let statement = bound.var_stmt[declaration.idx()];
        let Parent::Stmt(above) = bound.parent_of_stmt(statement) else {
            return None;
        };
        let StmtKind::ForOf {
            left,
            expr,
            is_await: false,
            ..
        } = hir[above].kind
        else {
            return None;
        };
        let ExprKind::Call(call) = hir[hir.skip_type_assertions(expr)].kind else {
            return None;
        };
        let reads_loop_variable = left == statement
            && expr < key
            && self.is_stable(symbol)
            && bound.dynamic_lookup_scope(NodeData::Expr(key)).is_none();
        let lists_keys = self.find_function_run_by(hir[call].callee) == Some(function);
        (reads_loop_variable && lists_keys)
            .then(|| hir.ids(hir[call].args).next())
            .flatten()
    }

    /// Every key that `key` may be: a constant, one of a known set, a well-known symbol, a key of the object literal that a loop walks, what the calls of a function of the file pass.
    /// `None`: nobody can read them all.
    fn find_written_keys(&self, key: ExprId) -> Option<WrittenKeys> {
        self.find_written_keys_through(key, 0)
    }

    fn find_written_keys_through(&self, key: ExprId, functions_passed: u32) -> Option<WrittenKeys> {
        let input = self.input;
        let symbol = self.value_of(key);
        if let Some(symbol) = symbol.and_then(|it| table::well_known_symbol(it.path.id)) {
            return Some(smallvec![WrittenKey::Symbol(table::name_of_symbol(symbol))]);
        }
        let key = input.hir.skip_type_assertions(key);
        let constant;
        let known;
        let values: &[Constant] = match input.decisions.constant(input.hir, key) {
            FoldedValue::Constant(value) | FoldedValue::ConstantOutsideDeadZone(value) => {
                constant = [value];
                &constant
            }
            FoldedValue::Unknown => {
                known = self.known_set(key);
                &known[..]
            }
        };
        if values.is_empty() {
            // `function put(name) { Object.defineProperty(Object.prototype, name, d); }`, where every mention of `put` calls it.
            let passed = find_values_of_parameter(input.hir, input.bound, input.decisions, key);
            if let Some(passed) = passed.filter(|_| functions_passed < 4) {
                let mut keys = WrittenKeys::new();
                for value in passed {
                    keys.extend(self.find_written_keys_through(value, functions_passed + 1)?);
                }
                return Some(keys);
            }
            let object = self.find_object_whose_keys_are_walked(key)?;
            let mut keys = WrittenKeys::new();
            return (self.push_keys_of_written_object(object, &mut keys)).then_some(keys);
        }
        let mut keys = WrittenKeys::new();
        for &value in values {
            match value {
                Constant::String(text) => keys.push(WrittenKey::Text(text)),
                // The table lists no member under a number, and no such name is ever opened.
                Constant::Number(_) => {}
                Constant::Undefined
                | Constant::Null
                | Constant::Boolean(_)
                | Constant::BigInt(_) => return None,
            }
        }
        Some(keys)
    }

    /// What stands behind a name that is stored once: `function make() { .. }`, `const make = () => ..`, `class Mixin { .. }`, `const Mixin = class { .. }`.
    fn find_declaration_behind(&self, name: ExprId) -> (Option<FnId>, Option<ClassId>) {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let name = hir.skip_type_assertions(name);
        let (ExprKind::Ident(_), Binding::Symbol(symbol)) = (hir[name].kind, bound.binding(name))
        else {
            return (None, None);
        };
        match *bound.symbol(symbol).decls {
            [Decl::Fn(function)] => return (Some(function), None),
            [Decl::Class(class)] => return (None, Some(class)),
            _ => {}
        }
        if !self.is_stable(symbol) {
            return (None, None);
        }
        let BindingInitializer::Expression(initializer) = bound.binding_initializer(hir, symbol)
        else {
            return (None, None);
        };
        match hir[hir.skip_type_assertions(initializer)].kind {
            ExprKind::Fn(function) => (Some(function), None),
            ExprKind::Class(class) => (None, Some(class)),
            _ => (None, None),
        }
    }

    /// The value of an arrow function, and what the statements of a body return that stand in no other statement.
    fn push_values_returned_by(&self, function: FnId, values: &mut SmallVec<[ExprId; 4]>) {
        let hir = self.input.hir;
        match hir[function].body {
            FnBody::Expr(value) => values.push(value),
            FnBody::Block(statements) => {
                for statement in hir.ids(statements) {
                    if let StmtKind::Return(value) = hir[statement].kind
                        && value.is_some()
                    {
                        values.push(value);
                    }
                }
            }
            FnBody::None => {}
        }
    }

    /// The keys of an object literal, which may spread another. `Object.getOwnPropertyDescriptors(mixin)` has the keys of `mixin`.
    /// A function of the file may return it, `make()`, `Object.freeze()` hands it on, and `new Mixin()` has the fields of its class.
    /// Whether these are all of them: what a name holds may have got more since it was made.
    fn push_keys_of_written_object(&self, object: ExprId, keys: &mut WrittenKeys) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut knows_all = true;
        let mut seen: SmallVec<[ExprId; 4]> = SmallVec::new();
        let mut pending: SmallVec<[ExprId; 4]> = smallvec![object];
        while let Some(object) = pending.pop() {
            let object = hir.skip_type_assertions(object);
            if seen.contains(&object) {
                continue;
            }
            seen.push(object);
            match hir[object].kind {
                ExprKind::Object(properties) => {
                    for property in properties.iter() {
                        let property = &hir[property];
                        match property.key {
                            PropKey::Name(name) => keys.push(WrittenKey::Text(name)),
                            PropKey::Computed(key) => match self.find_written_keys(key) {
                                Some(computed) => keys.extend(computed),
                                None => knows_all = false,
                            },
                            PropKey::None if property.kind == PropKind::Spread => {
                                pending.push(property.value);
                            }
                            PropKey::None | PropKey::Private(_) => {}
                        }
                    }
                }
                ExprKind::Ident(_) => {
                    knows_all = false;
                    if let Binding::Symbol(symbol) = bound.binding(object)
                        && self.is_stable(symbol)
                        && let BindingInitializer::Expression(initializer) =
                            bound.binding_initializer(hir, symbol)
                    {
                        pending.push(initializer);
                    }
                }
                ExprKind::Call(call) => match self.find_function_run_by(hir[call].callee) {
                    Some(BuiltinId::ObjectGetOwnPropertyDescriptors) => {
                        pending.extend(hir.ids(hir[call].args).next());
                    }
                    Some(function) if hands_first_operand_on(function) => {
                        pending.extend(hir.ids(hir[call].args).next());
                    }
                    Some(_) => knows_all = false,
                    None => {
                        knows_all = false;
                        if let (Some(function), _) = self.find_declaration_behind(hir[call].callee) {
                            self.push_values_returned_by(function, &mut pending);
                        }
                    }
                },
                ExprKind::New(call) => {
                    knows_all = false;
                    if let (_, Some(class)) = self.find_declaration_behind(hir[call].callee) {
                        let members = hir[class].members.iter().map(|it| hir[it]);
                        keys.extend(members.filter_map(|it| match it.key {
                            PropKey::Name(name)
                                if it.kind == MemberKind::Property
                                    && !it.flags.contains(Flags::STATIC) =>
                            {
                                Some(WrittenKey::Text(name))
                            }
                            _ => None,
                        }));
                    }
                }
                _ => knows_all = false,
            }
        }
        knows_all
    }

    /// What a write of `key` on `holder` replaces or adds.
    fn note_written_key(
        &self,
        holder: BuiltinId,
        key: WrittenKey,
        runs: WriteRuns,
        found: &mut WritesFound,
    ) {
        let (text, name) = match key {
            WrittenKey::Text(text) => (Some(text), self.input.names.get(text)),
            WrittenKey::Symbol(name) => (None, Some(name)),
        };
        let is_added = match name.map(|name| table::member(holder, name)) {
            Some(MemberLookup::Found(member)) => {
                if runs == WriteRuns::WhereNothingIsThere && is_there_and_not_falsy(member) {
                    return;
                }
                if may_be_replaced(member) {
                    found.replace(member);
                }
                // `spyOn(Uint8Array.prototype, "set")`: an object above has the member, and what is written stands in front of it.
                table::entry(member).holder.map(table::canonical_id) != Some(holder)
            }
            Some(MemberLookup::Unknown | MemberLookup::Absent) | None => takes_no_names(holder),
        };
        if is_added {
            found.names.extend(text.map(|text| (holder, text)));
        }
    }

    fn note_write_under(
        &self,
        holder: BuiltinId,
        keys: Option<WrittenKeys>,
        runs: WriteRuns,
        found: &mut WritesFound,
    ) {
        let Some(keys) = keys else {
            return found.open(holder);
        };
        for key in keys {
            self.note_written_key(holder, key, runs, found);
        }
    }

    fn note_keys_of_operand(&self, holders: &[BuiltinId], source: ExprId, found: &mut WritesFound) {
        let mut keys = WrittenKeys::new();
        let knows_all = self.push_keys_of_written_object(source, &mut keys);
        for &holder in holders {
            for &key in &keys {
                self.note_written_key(holder, key, WriteRuns::Always, found);
            }
            if !knows_all {
                found.open(holder);
            }
        }
    }

    // `object.key = f`, `delete object.key`, `object.key++`, `[object.key] = list`, `({ a: object.key } = o)`, `for (object.key of list)`
    fn find_how_member_is_written(&self, member: ExprId) -> Option<WriteRuns> {
        if self.is_deleted(member) {
            return Some(WriteRuns::Always);
        }
        let (hir, bound) = (self.input.hir, self.input.bound);
        match bound.get_assignment_target(hir, self.outermost_assertion_of(member))? {
            AssignmentTarget::Assign(Some(BinOp::Nullish | BinOp::Or)) => {
                Some(WriteRuns::WhereNothingIsThere)
            }
            AssignmentTarget::Assign(_)
            | AssignmentTarget::Unary
            | AssignmentTarget::ForInOrOf => Some(WriteRuns::Always),
        }
    }

    fn look_at_call_of_writer(&self, expr: ExprId, found: &mut WritesFound) {
        let hir = self.input.hir;
        let ExprKind::Call(call) = hir[expr].kind else {
            return;
        };
        let Some(function) = self.find_function_run_by(hir[call].callee) else {
            return;
        };
        self.look_at_call_of_function(expr, function, found);
        if is_of_test_runner(function) {
            self.look_at_calls_chained_behind(expr, found);
        }
    }

    /// `vi.stubEnv("A", "b").stubGlobal("fetch", f)`: the functions of `jest` and `vi` answer the object that they are called on, so what is called on such an
    /// answer is taken for a member of that object. A link that answers something else counts as one writer too many.
    /// It ends at a link whose callee stands for a function by itself: whoever looks at that call goes on from there, so each link is looked at once.
    fn look_at_calls_chained_behind(&self, first: ExprId, found: &mut WritesFound) {
        let hir = self.input.hir;
        let ExprKind::Call(call) = hir[first].kind else {
            return;
        };
        let Some((receiver, _)) = hir.member_key(hir.skip_type_assertions(hir[call].callee)) else {
            return;
        };
        let runner = self.find_holder_behind(receiver);
        let Some(runner) = runner.filter(|&runner| is_of_test_runner(runner)) else {
            return;
        };
        let mut link = first;
        while let Some(callee) = self.find_member_of(link)
            && mentioned_id(self.state(callee)).is_none()
            && let Some(call) = self.find_plain_call_of(callee)
        {
            if let Some((_, MemberKey::Name(name))) = hir.member_key(callee)
                && let Some(name) = self.input.names.get(name)
                && let MemberLookup::Found(function) = table::member(runner, name)
            {
                self.look_at_call_of_function(call, table::canonical_id(function), found);
            }
            link = call;
        }
    }

    /// `expr`: a call that runs `function`, a canonical id.
    fn look_at_call_of_function(&self, expr: ExprId, function: BuiltinId, found: &mut WritesFound) {
        let hir = self.input.hir;
        let ExprKind::Call(call) = hir[expr].kind else {
            return;
        };
        let writer = find_writer(function);
        if writer.is_none() && !leaves_operands_as_they_are(function) {
            return;
        }
        let operands = hir.ids(hir[call].args);
        let operands: SmallVec<[ExprId; 4]> = operands
            .map(|operand: ExprId| hir.skip_type_assertions(operand))
            .collect();
        if answers_first_operand(function)
            && !matches!(self.classify_use(expr), MentionUse::Inspected)
            && let Some(&first) = operands.first()
            && let Some(holder) = self.find_holder_behind(first)
        {
            found.note_object_out_of_sight(holder);
        }
        let Some(writer) = writer else {
            return found.followed.extend_from_slice(&operands);
        };
        let mut spreads = operands.iter();
        if spreads.any(|&operand| matches!(hir[operand].kind, ExprKind::Spread(_))) {
            return found.note_writer_out_of_sight(writer);
        }
        match writer {
            Writer::Spy | Writer::MemberOfOperand | Writer::MemberOfReceiverOperand => {
                let &[first, key, ..] = &operands[..] else {
                    return;
                };
                let object = match (writer, operands.get(3)) {
                    (Writer::MemberOfReceiverOperand, Some(&receiver)) => receiver,
                    _ => first,
                };
                found.followed.extend([first, object]);
                let keys = self.find_written_keys(key);
                match self.find_holder_behind(object) {
                    Some(holder) => {
                        let runs = self.find_when_write_runs(expr, holder, keys.as_deref());
                        self.note_write_under(holder, keys, runs, found);
                    }
                    None if writer == Writer::Spy => found.spy_calls.push(SpyCall {
                        call: expr,
                        object,
                        name: match keys.as_deref() {
                            Some(&[WrittenKey::Text(name)]) => Some(name),
                            _ => None,
                        },
                    }),
                    None => {}
                }
            }
            Writer::MemberOfReceiver => {
                let callee = hir.skip_type_assertions(hir[call].callee);
                let (Some((receiver, _)), Some(&key)) = (hir.member_key(callee), operands.first())
                else {
                    return;
                };
                let Some(holder) = self.find_holder_behind(receiver) else {
                    return;
                };
                found.followed.push(hir.skip_type_assertions(receiver));
                let keys = self.find_written_keys(key);
                self.note_write_under(holder, keys, WriteRuns::Always, found);
            }
            Writer::KeysOfOperands => {
                let Some((&object, sources)) = operands.split_first() else {
                    return;
                };
                let Some(holder) = self.find_holder_behind(object) else {
                    return;
                };
                found.followed.push(object);
                for &source in sources {
                    self.note_keys_of_operand(&[holder], source, found);
                }
            }
            Writer::Global => {
                if let Some(&key) = operands.first() {
                    let keys = self.find_written_keys(key);
                    self.note_write_under(BuiltinId::GlobalThis, keys, WriteRuns::Always, found);
                }
            }
            Writer::Matchers => {
                if let Some(&matchers) = operands.first() {
                    self.note_keys_of_operand(&table::HOLDERS_OF_MATCHERS, matchers, found);
                }
            }
            // Where the call is a site of the file, whoever unites the files reads its name there.
            Writer::MockedModules => {
                let site = ImportSiteKind::MockModule(expr);
                found.hands_mock_on |= !self.input.targets.has_site(site);
            }
            // `typeof Bun.jest(path, true).suite === "function"` asks what the runner has, and what the call answers goes nowhere. The build writes that question itself
            // into each file that is no test file and names `jest`, as react-dom's development build does: load/test_runner_names.rs.
            Writer::TestRunner => {
                let member = self.find_member_of(expr);
                if !member.is_some_and(|member| self.is_only_tested(member)) {
                    found.note_writer_out_of_sight(writer);
                }
            }
            Writer::Timers | Writer::SystemTime | Writer::LoadedModules => {
                found.note_writer_out_of_sight(writer);
            }
        }
    }

    /// `if (!Array.prototype.at) Array.prototype.at = f`: as `Array.prototype.at ||= f`. `write`: the member that is stored to, or the call that writes it.
    fn find_when_write_runs(
        &self,
        write: ExprId,
        holder: BuiltinId,
        keys: Option<&[WrittenKey]>,
    ) -> WriteRuns {
        let Some(&[WrittenKey::Text(text)]) = keys else {
            return WriteRuns::Always;
        };
        let name = self.input.names.get(text);
        let Some(MemberLookup::Found(member)) = name.map(|name| table::member(holder, name)) else {
            return WriteRuns::Always;
        };
        match self.is_behind_test_that_finds_member_missing(write, table::canonical_id(member)) {
            true => WriteRuns::WhereNothingIsThere,
            false => WriteRuns::Always,
        }
    }

    fn look_at_member_written(&self, member: ExprId, found: &mut WritesFound) {
        let Some((object, key)) = self.input.hir.member_key(member) else {
            return;
        };
        let Some(holder) = self.find_holder_behind(object) else {
            return;
        };
        let Some(runs) = self.find_how_member_is_written(member) else {
            return;
        };
        let keys = match key {
            MemberKey::Name(name) => Some(smallvec![WrittenKey::Text(name)]),
            MemberKey::Computed(key) => self.find_written_keys(key),
            MemberKey::PrivateName(_) => Some(WrittenKeys::new()),
        };
        let runs = match runs {
            WriteRuns::Always => self.find_when_write_runs(member, holder, keys.as_deref()),
            WriteRuns::WhereNothingIsThere => runs,
        };
        self.note_write_under(holder, keys, runs, found);
    }

    // `Set = Fake`, `[Set] = [Fake]`, `({ Set } = fakes)`, `for (Set of fakes)`, `Set++`
    fn look_at_stores_to_globals(&self, found: &mut WritesFound) {
        let input = self.input;
        for &(target, kind) in input.bound.runtime.unbound_name_stores() {
            let ExprKind::Ident(name) = input.hir[target].kind else {
                continue;
            };
            if matches!(self.state(target), ExprState::NotEvaluated)
                || input.bound.binding(target) != Binding::Free
            {
                continue;
            }
            let runs = match kind {
                StoreKind::CompoundAssign(BinOp::Nullish | BinOp::Or) => {
                    WriteRuns::WhereNothingIsThere
                }
                StoreKind::Assign
                | StoreKind::CompoundAssign(_)
                | StoreKind::Update(_)
                | StoreKind::Destructure
                | StoreKind::ForIn
                | StoreKind::ForOf => WriteRuns::Always,
            };
            self.note_written_key(BuiltinId::GlobalThis, WrittenKey::Text(name), runs, found);
        }
    }

    // `export const { spyOn } = jest`: a member goes where its name goes. A rest element or a computed key takes any member.
    fn look_at_pattern_over_builtin(
        &self,
        holder: ResolvedValue,
        pattern: PatId,
        found: &mut WritesFound,
    ) {
        let hir = self.input.hir;
        let mut pending: SmallVec<[(ResolvedValue, PatId); 4]> = smallvec![(holder, pattern)];
        while let Some((holder, pattern)) = pending.pop() {
            let PatKind::Object(properties) = hir[pattern].kind else {
                continue;
            };
            for property in properties.iter() {
                let property = &hir[property];
                let name = match property.key {
                    PropKey::Name(name) if !property.is_rest => name,
                    _ => {
                        found.note_runner_out_of_sight(holder_of(holder.path.id));
                        continue;
                    }
                };
                if self.is_inherited_object_prototype_member(Some(holder.path.id), name) {
                    found.note_object_out_of_sight(holder_of(holder.path.id));
                }
                let Some(member) = self.find_named_member(holder, name) else {
                    // What the table does not list may be any writer of the runner.
                    found.note_runner_out_of_sight(holder_of(holder.path.id));
                    continue;
                };
                match hir[property.value].kind {
                    PatKind::Ident(_) if self.is_local_alias(property.value) => {}
                    PatKind::Ident(_) | PatKind::Array(_) => {
                        found.note_object_out_of_sight(holder_of(member.id));
                    }
                    PatKind::Object(_) => {
                        pending.push((ResolvedValue::object(member), property.value));
                    }
                    PatKind::Missing => {}
                }
            }
        }
    }

    /// Nobody who gets the object here writes on it: an operand whose part in its call is known, `delete object.key`, `class A extends object {}`,
    /// and `mock` in `mock.module(name, factory)`, listed or not.
    fn is_followed_where_exposed(&self, object: ExprId, found: &WritesFound) -> bool {
        let member = self.find_member_of(object);
        if found.followed.binary_search(&object).is_ok()
            || member.is_some_and(|member| {
                self.is_deleted(member) || self.is_callee_of_site_of_runner(member)
            })
        {
            return true;
        }
        let value = self.outermost_assertion_of(object);
        matches!(
            self.input.bound.parent_of_expr(value),
            Parent::ClassExtends(_)
        )
    }

    fn look_at_mention_of_builtin(&self, expr: ExprId, found: &mut WritesFound) {
        let id = match self.state(expr) {
            ExprState::DynamicGlobal(path) => Some(path.id),
            state => mentioned_id(state),
        };
        let Some(object) = id.map(holder_of) else {
            return;
        };
        let writer = find_writer(object);
        if writer.is_none()
            && !is_of_test_runner(object)
            && !table::HOLDERS_OF_MATCHERS.contains(&object)
            && !opens_where_handed_on(object)
        {
            return;
        }
        match self.classify_use(expr) {
            MentionUse::Inspected | MentionUse::Aliased => {}
            // What the table does not list may be any writer of the runner.
            MentionUse::Holder => {
                let member = self.find_member_of(expr);
                if is_of_test_runner(object)
                    && member.is_some_and(|it| !self.is_resolved(it) && !self.is_only_tested(it))
                {
                    found.note_runner_out_of_sight(object);
                }
            }
            MentionUse::Called(call) => {
                if writer.is_some() && !self.is_run_by_plain_call(call, object) {
                    found.note_object_out_of_sight(object);
                }
            }
            MentionUse::ReadByComputedKey => found.note_runner_out_of_sight(object),
            MentionUse::Destructured(pattern) => {
                match self.value_of(expr).or_else(|| self.held_value_of(expr)) {
                    Some(holder) => self.look_at_pattern_over_builtin(holder, pattern, found),
                    None => found.note_object_out_of_sight(object),
                }
            }
            MentionUse::Exposed => {
                if !self.is_followed_where_exposed(expr, found) {
                    found.note_object_out_of_sight(object);
                }
            }
        }
    }

    /// The modules of native code that the file mocks, and those whose objects it gets or hands on where no expression stands for them.
    fn look_at_loads_of_native_modules(&self, found: &mut WritesFound) {
        let input = self.input;
        let is_evaluated = |call: ExprId| !matches!(self.state(call), ExprState::NotEvaluated);
        for (site, module) in input.targets.iter() {
            if has_source(module) {
                continue;
            }
            let namespace = table::canonical_id(table::namespace_of(module));
            match site {
                // A mock stands under every name of the module, and under `default`, which is the object itself.
                // `import { file } from "bun"` reads the object Bun, which no mock replaces. The members of bun:test stay known: the build has to see which calls are spies.
                ImportSiteKind::MockModule(call) => {
                    if is_evaluated(call)
                        && table::object_replacing_namespace(module).is_none()
                        && module != RuntimeModule::BunTest
                    {
                        found.members.push(namespace);
                    }
                }
                ImportSiteKind::ImportCall(call) if self.is_import_awaited_at_once(call) => {}
                ImportSiteKind::ImportCall(call)
                | ImportSiteKind::ImportByTestRunner(call)
                | ImportSiteKind::RequireByTestRunner(call) => {
                    if is_evaluated(call) {
                        found.note_object_out_of_sight(namespace);
                    }
                }
                ImportSiteKind::ExportStar(_) => found.note_object_out_of_sight(namespace),
                ImportSiteKind::ImportEquals(import) => {
                    if input.hir[import].flags.contains(Flags::EXPORT) {
                        found.note_object_out_of_sight(namespace);
                    }
                }
                ImportSiteKind::ExportFrom(export) => {
                    for item in input.hir[export].items.iter() {
                        let item = &input.hir[item];
                        let name = input.names.get(item.local).filter(|_| !item.type_only);
                        if let Some(exported) = name.and_then(|it| self.find_export(namespace, it))
                        {
                            found.note_object_out_of_sight(holder_of(exported.id));
                        }
                    }
                }
                ImportSiteKind::JsxRuntime
                | ImportSiteKind::JsxPackage
                | ImportSiteKind::Import(_)
                | ImportSiteKind::Require(_)
                | ImportSiteKind::RequireResolve(_)
                | ImportSiteKind::ImportMetaRequire(_)
                | ImportSiteKind::ImportMetaResolve(_)
                | ImportSiteKind::GetBuiltinModule(_) => {}
            }
        }
    }

    // `import { vi } from "bun:test"; export { vi };`: no expression hands it on. What a declaration holds is looked at where its initializer stands.
    fn look_at_imported_names_handed_on(&self, found: &mut WritesFound) {
        let bound = self.input.bound;
        for (&symbol, source) in &self.aliases {
            let AliasSource::Known(value) = source else {
                continue;
            };
            if self.is_exported(symbol)
                || bound.is_visible_to_eval(symbol)
                || self.is_named_outside(symbol)
            {
                found.note_object_out_of_sight(holder_of(value.path.id));
            }
        }
    }

    pub(super) fn collect_replaced_members(&mut self) {
        if !self.input.runs_tests {
            return;
        }
        let mut found = WritesFound::default();
        self.look_at_loads_of_native_modules(&mut found);
        self.look_at_imported_names_handed_on(&mut found);
        self.look_at_stores_to_globals(&mut found);
        for &call in self.evaluated_calls() {
            self.look_at_call_of_writer(call, &mut found);
        }
        found.followed.shared_sort_unstable();
        for expr in self.evaluated_exprs() {
            if matches!(self.state(expr), ExprState::NotEvaluated) {
                continue;
            }
            self.look_at_member_written(expr, &mut found);
            self.look_at_mention_of_builtin(expr, &mut found);
        }
        let output = &mut self.output;
        output.replaced_members = found.members;
        output.opened_holders = found.opened;
        output.names_added = found.names;
        output.spy_calls = found.spy_calls;
        output.hands_spy_on = found.hands_spy_on;
        output.hands_mock_on = found.hands_mock_on;
        output.resets_modules = found.resets_modules;
    }

    /// `Function.prototype.once = f` in an executable. What such a file replaces stays locked, and so does Object.prototype.
    /// A holder is an expression of the file that stands for the object, so a file that mentions none adds nothing. It comes behind `classify_mentions`.
    fn find_names_added_in_executable(&self) -> Vec<(BuiltinId, Atom)> {
        let mut mentioned = self.output.mentioned.iter();
        if self.input.dialect != SourceDialect::Program
            || !mentioned.any(|&id| takes_names_that_a_file_spells(holder_of(id)))
        {
            return Vec::new();
        }
        let mut found = WritesFound::default();
        for &call in self.evaluated_calls() {
            self.look_at_call_of_writer(call, &mut found);
        }
        for expr in self.evaluated_exprs() {
            if !matches!(self.state(expr), ExprState::NotEvaluated) {
                self.look_at_member_written(expr, &mut found);
            }
        }
        // A name that an object above has hides a built-in member: that write throws, like the one that replaces the member.
        let names = self.input.names;
        found.names.retain(|&(holder, name)| {
            let member = names.get(name).map(|name| table::member(holder, name));
            takes_names_that_a_file_spells(holder)
                && !matches!(member, Some(MemberLookup::Found(_)))
        });
        found.names
    }

    /// Each name once: by holder, and under one holder in the order in which the writes were found. No order of atoms is the same in two builds.
    pub(super) fn collect_names_added(&mut self) {
        if !self.input.runs_tests {
            self.output.names_added = self.find_names_added_in_executable();
        }
        let names = &mut self.output.names_added;
        let mut seen = FxHashSet::default();
        names.retain(|&name| seen.insert(name));
        names.shared_sort_by_key(|name| name.0);
    }
}
