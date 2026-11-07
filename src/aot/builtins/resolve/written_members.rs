use super::imports::has_source;
use super::mention_use::MentionUse;
use super::mentions::mentioned_id;
use super::module_cache::is_function_that_loader_calls;
use super::resolver::{AliasSource, ExprState, ResolvedValue, Resolver};
use super::{SourceDialect, SpyCall};
use crate::builtins::table::{
    self, BuiltinFlags, BuiltinId, BuiltinKind, BuiltinName, MemberLookup, Mutability, Platforms,
    RuntimeModule, Scope,
};
use bun_sema::atom::{Atom, known};
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

#[derive(Copy, Clone, PartialEq, Eq)]
enum Writer {
    Spy,
    MemberOfOperand,
    MemberOfReceiverOperand,
    MemberOfReceiver,
    KeysOfOperands,
    Global,
    Matchers,
    Timers,
    SystemTime,
    LoadedModules,
    MockedModules,
    TestRunner,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum WriteRuns {
    Always,
    WhereNothingIsThere,
}

#[derive(Copy, Clone)]
enum WrittenKey {
    Text(Atom),
    Symbol(BuiltinName),
}

type WrittenKeys = SmallVec<[WrittenKey; 2]>;

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

fn mocks_modules(object: BuiltinId) -> bool {
    let mut members = table::members(object).iter();
    object == table::canonical_id(BuiltinId::BunTestMock)
        || members.any(|&member| table::resets_modules(member))
}

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

fn answers_first_operand(function: BuiltinId) -> bool {
    matches!(
        function,
        BuiltinId::ObjectDefineProperty
            | BuiltinId::ObjectDefineProperties
            | BuiltinId::ObjectAssign
            | BuiltinId::ObjectSetPrototypeOf
    )
}

fn hands_first_operand_on(function: BuiltinId) -> bool {
    matches!(
        function,
        BuiltinId::ObjectFreeze | BuiltinId::ObjectSeal | BuiltinId::ObjectPreventExtensions
    )
}

fn may_be_replaced(member: BuiltinId) -> bool {
    let entry = table::entry(member);
    entry.mutability != Mutability::ChangesOnItsOwn && entry.scope == Scope::Realm
}

fn comes_with_holder(holder: BuiltinId, member: BuiltinId) -> bool {
    let is_cheap = table::entry(member).mutability == Mutability::ConstantUnlessWritten;
    may_be_replaced(member) && (is_cheap || holder != BuiltinId::GlobalThis)
}

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

fn leads_to_function_that_loader_calls(object: BuiltinId) -> bool {
    let mut is_seen = vec![false; BuiltinId::COUNT as usize];
    let mut pending = vec![table::canonical_id(object)];
    while let Some(reached) = pending.pop() {
        if std::mem::replace(&mut is_seen[reached.to_wire() as usize], true) {
            continue;
        }
        if is_function_that_loader_calls(reached) {
            return true;
        }
        pending.extend(
            table::members(reached)
                .iter()
                .map(|&it| table::canonical_id(it)),
        );
    }
    false
}

fn takes_no_names(holder: BuiltinId) -> bool {
    table::has_flag(holder, BuiltinFlags::IS_LOCKED_OBJECT)
        || table::has_flag(holder, BuiltinFlags::IS_CLOSED_TO_OTHER_NAMES)
}

pub(super) fn follows_unlisted_names_of(object: BuiltinId) -> bool {
    is_of_test_runner(object)
        || table::HOLDERS_OF_MATCHERS.contains(&object)
        || takes_no_names(object)
}

fn takes_names_that_a_file_spells(holder: BuiltinId) -> bool {
    holder != BuiltinId::ObjectPrototype && takes_no_names(holder)
}

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
    is_object && entry.mutability == Mutability::AlwaysLocked && entry.platforms == Platforms::all()
}

#[derive(Default)]
struct WritesFound {
    members: Vec<BuiltinId>,
    opened: Vec<BuiltinId>,
    names: Vec<(BuiltinId, Atom)>,
    spy_calls: Vec<SpyCall>,
    hands_spy_on: bool,
    hands_mock_on: bool,
    resets_modules: bool,
    stores_loader_functions: bool,
    followed: Vec<ExprId>,
    runner_objects_out_of_sight: Vec<BuiltinId>,
}

impl WritesFound {
    fn replace(&mut self, member: BuiltinId) {
        self.members.push(member);
        let object = table::canonical_id(member);
        if object != member {
            self.members.push(object);
        }
    }

    fn open(&mut self, holder: BuiltinId) {
        self.stores_loader_functions |= table::members(holder)
            .iter()
            .any(|&member| is_function_that_loader_calls(member));
        let mut members = table::members(holder).iter();
        if members.any(|&member| comes_with_holder(holder, member)) {
            self.opened.push(holder);
        }
    }

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
            Writer::MemberOfOperand
            | Writer::MemberOfReceiverOperand
            | Writer::MemberOfReceiver
            | Writer::KeysOfOperands => {}
        }
    }

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
        self.stores_loader_functions |= leads_to_function_that_loader_calls(object);
        if opens_where_handed_on(object) {
            self.opened.push(object);
        }
    }
}

impl Resolver<'_, '_> {
    fn find_holder_behind(&self, object: ExprId) -> Option<BuiltinId> {
        match self.state(self.input.hir.skip_type_assertions(object)) {
            ExprState::DynamicGlobal(path) => Some(holder_of(path.id)),
            state => mentioned_id(state).map(holder_of),
        }
    }

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

    pub(super) fn is_key_of_what_stands_above(&self, key: ExprId) -> bool {
        self.find_written_keys(key).is_some_and(|keys| {
            let is_that_name = |key: &WrittenKey| matches!(key, WrittenKey::Text(known::__proto__));
            !keys.is_empty() && keys.iter().all(is_that_name)
        })
    }

    fn find_written_keys(&self, key: ExprId) -> Option<WrittenKeys> {
        self.find_written_keys_once(key, &mut SmallVec::new())
    }

    fn find_written_keys_once(
        &self,
        key: ExprId,
        asked: &mut SmallVec<[ExprId; 4]>,
    ) -> Option<WrittenKeys> {
        let input = self.input;
        if let Some((_, symbol)) = self.symbol_that_key_is(key) {
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
            let mut keys = WrittenKeys::new();
            if asked.contains(&key) {
                return Some(keys);
            }
            asked.push(key);
            let passed = find_values_of_parameter(input.hir, input.bound, input.decisions, key);
            if let Some(passed) = passed {
                for value in passed {
                    keys.extend(self.find_written_keys_once(value, asked)?);
                }
                return Some(keys);
            }
            let object = self.find_object_whose_keys_are_walked(key)?;
            return (self.push_keys_of_written_object(object, asked, &mut keys)).then_some(keys);
        }
        let mut keys = WrittenKeys::new();
        for &value in values {
            match value {
                Constant::String(text) => keys.push(WrittenKey::Text(text)),
                Constant::Number(_)
                | Constant::Undefined
                | Constant::Null
                | Constant::Boolean(_)
                | Constant::BigInt(_) => return None,
            }
        }
        Some(keys)
    }

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

    fn push_keys_of_written_object(
        &self,
        object: ExprId,
        asked: &mut SmallVec<[ExprId; 4]>,
        keys: &mut WrittenKeys,
    ) -> bool {
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
                            PropKey::Computed(key) => {
                                match self.find_written_keys_once(key, asked) {
                                    Some(computed) => keys.extend(computed),
                                    None => knows_all = false,
                                }
                            }
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
                        if let (Some(function), _) = self.find_declaration_behind(hir[call].callee)
                        {
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
                found.stores_loader_functions |= is_function_that_loader_calls(member);
                if runs == WriteRuns::WhereNothingIsThere && is_there_and_not_falsy(member) {
                    return;
                }
                if may_be_replaced(member) {
                    found.replace(member);
                }
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
        let knows_all = self.push_keys_of_written_object(source, &mut SmallVec::new(), &mut keys);
        for &holder in holders {
            for &key in &keys {
                self.note_written_key(holder, key, WriteRuns::Always, found);
            }
            if !knows_all {
                found.open(holder);
            }
        }
    }

    fn find_how_member_is_written(&self, member: ExprId) -> Option<WriteRuns> {
        if self.is_deleted(member) {
            return Some(WriteRuns::Always);
        }
        let (hir, bound) = (self.input.hir, self.input.bound);
        match bound.get_assignment_target(hir, self.outermost_assertion_of(member))? {
            AssignmentTarget::Assign(Some(BinOp::Nullish | BinOp::Or)) => {
                Some(WriteRuns::WhereNothingIsThere)
            }
            AssignmentTarget::Assign(_) | AssignmentTarget::Unary | AssignmentTarget::ForInOrOf => {
                Some(WriteRuns::Always)
            }
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
            Writer::MockedModules => {
                let site = ImportSiteKind::MockModule(expr);
                found.hands_mock_on |= !self.input.targets.has_site(site);
            }
            Writer::TestRunner => {}
            Writer::Timers | Writer::SystemTime | Writer::LoadedModules => {
                found.note_writer_out_of_sight(writer);
            }
        }
    }

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

    fn look_at_loads_of_native_modules(&self, found: &mut WritesFound) {
        let input = self.input;
        let is_evaluated = |call: ExprId| !matches!(self.state(call), ExprState::NotEvaluated);
        for (site, module) in input.targets.iter() {
            if has_source(module) {
                continue;
            }
            let namespace = table::canonical_id(table::namespace_of(module));
            match site {
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
        output.stores_loader_functions = found.stores_loader_functions;
    }

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
        let names = self.input.names;
        found.names.retain(|&(holder, name)| {
            let member = names.get(name).map(|name| table::member(holder, name));
            takes_names_that_a_file_spells(holder)
                && !matches!(member, Some(MemberLookup::Found(_)))
        });
        found.names
    }

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
