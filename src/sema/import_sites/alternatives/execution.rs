use super::{Distinct, Follower, Held, MemberName, Text, Values, find_class_named_by};
use crate::atom::{Atom, known};
use crate::bind::{
    Binding, BindingInitializer, BindingKind, ClassOwner, CodeUnit, Decl, FnOwner, MemberOwner,
    Parent, PatParent, ScopeId, SymbolId,
};
use crate::fold::{Constant, FoldedValue, PathBelowFolder, PathEnd};
use crate::hir::{
    BinOp, Branches, Call, CaseId, Chain, ClassId, ExprId, ExprKind, Flags, FnBody, FnId, IdList,
    MemberKey, MemberKind, PatId, PatKind, PropKey, PropKind, Span, StmtId, StmtKind, UnOp,
    VarDeclId, VarKind,
};
use crate::import_sites::ScanInputs;
use crate::import_sites::call_sites::is_free_name;
use crate::import_sites::is_process;
use crate::util::{FxBuild, FxHashMap, FxHashSet};
use std::hash::{BuildHasher, Hash, Hasher};
use std::ops::Range;
use std::rc::Rc;

const MOST_STEPS: u32 = 1 << 15;
const MOST_STEPS_WITH_THROWS: u32 = 1 << 17;
const SIZE_OF_STEP: usize = 16;
const MOST_STATES: usize = 256;
const MOST_ROUNDS: usize = 8;
const DEEPEST_CALL: usize = 16;
const DEEPEST_CONSTRUCTION: usize = 64;

#[derive(Clone, PartialEq, Hash)]
enum Value {
    Held(Held),
    Object(usize),
    Function(FnId),
    Class(ClassId),
    Environment,
    EnvironmentVariable(Atom),
    OfEnvironment(ExprId),
    Unknown,
}

#[derive(Clone, PartialEq, Hash)]
struct Object {
    class: Option<ClassId>,
    is_list: bool,
    is_shared: bool,
    is_read: bool,
    fields: Vec<(Vec<u8>, Value)>,
}

#[derive(Clone, PartialEq, Default, Hash)]
struct EnvironmentVariable {
    is_set: Option<bool>,
    equals: Option<Vec<u8>>,
    differs: Vec<Vec<u8>>,
}

#[derive(Clone, Default)]
struct State {
    variables: Rc<FxHashMap<SymbolId, Rc<Value>>>,
    objects: Rc<Vec<Rc<Object>>>,
    environment: Vec<(Atom, EnvironmentVariable)>,
    constants: Vec<(SymbolId, bool)>,
}

#[derive(Clone, PartialEq, Hash)]
enum Flow {
    Next,
    Break,
    Continue,
    Return(Value),
}

#[derive(Copy, Clone)]
struct Loop {
    left: StmtId,
    test: ExprId,
    update: ExprId,
    body: StmtId,
}

impl Loop {
    fn over(left: StmtId, body: StmtId) -> Loop {
        Loop {
            left,
            test: ExprId::NONE,
            update: ExprId::NONE,
            body,
        }
    }
}

enum Use {
    Over,
    MayRun,
    Within(FnId),
}

enum Around {
    File,
    Function(FnId),
    Unknown,
}

type Ways<T> = Option<Vec<(State, T)>>;

pub(super) struct Execution<'f, 'i, 'a, 's> {
    follower: &'f Follower<'i, 'a, 's>,
    operands: FxHashSet<ExprId>,
    seen: FxHashMap<ExprId, Option<Values>>,
    functions_run: FxHashSet<FnId>,
    escaped: FxHashSet<FnId>,
    escaped_classes: FxHashSet<ClassId>,
    keys_read: FxHashSet<Vec<u8>>,
    symbols_read: FxHashSet<SymbolId>,
    ends: Vec<State>,
    unreachable: FxHashSet<FnId>,
    calls: Vec<FnId>,
    loops: Vec<Range<u32>>,
    functions_running: Vec<FnId>,
    constructions_running: usize,
    receivers: Vec<Value>,
    attempts: Vec<Attempt>,
    follows_throws: bool,
    may_throw: bool,
    functions_around_code: FxHashSet<FnId>,
    steps_left: u32,
}

struct Attempt {
    before: State,
    thrown: Vec<State>,
    has_calls: bool,
    variables: FxHashSet<SymbolId>,
    objects: FxHashSet<usize>,
}

pub(super) struct ExecutedValues {
    pub(super) values: Values,
    pub(super) are_all: bool,
}

pub(super) fn find_executed_values(
    follower: &Follower<'_, '_, '_>,
    operands: FxHashMap<ExprId, bool>,
) -> FxHashMap<ExprId, ExecutedValues> {
    let mut operands = operands;
    operands.retain(|it, has_path| may_depend_on_stores(follower, *it, *has_path));
    let operands: FxHashSet<ExprId> = operands.into_keys().collect();
    if operands.is_empty() {
        return FxHashMap::default();
    }
    let mut execution = Execution::new(follower, operands.clone(), false);
    let known = execution.find_known_values();
    let may_throw = execution.may_throw && !known.is_empty();
    let mut thrown = match may_throw {
        true => Execution::new(follower, operands, true).find_known_values(),
        false => FxHashMap::default(),
    };
    let executed = known.into_iter().map(|(operand, mut values)| {
        let found = thrown.remove(&operand);
        let are_all = !may_throw || found.is_some();
        for value in found.into_iter().flatten() {
            if !values.contains(&value) {
                values.push(value);
            }
        }
        (operand, ExecutedValues { values, are_all })
    });
    executed.collect()
}

fn may_depend_on_stores(follower: &Follower<'_, '_, '_>, operand: ExprId, has_path: bool) -> bool {
    let &ScanInputs {
        hir,
        bound,
        decisions,
        ..
    } = follower.inputs;
    let mut met: FxHashSet<SymbolId> = FxHashSet::default();
    let mut pending = vec![operand];
    while let Some(e) = pending.pop() {
        let e = hir.skip_type_assertions(e);
        if !matches!(decisions.constant(hir, e), FoldedValue::Unknown)
            || follower.names_own_directory(e)
            || follower.find_own_file(e).is_some()
        {
            continue;
        }
        match hir[e].kind {
            ExprKind::Ident(_) => {
                let Binding::Symbol(symbol) = bound.binding(e) else {
                    continue;
                };
                if !bound.stores_to(symbol).is_empty() {
                    return true;
                }
                match bound.binding_initializer(hir, symbol) {
                    BindingInitializer::Expression(source) if met.insert(symbol) => {
                        pending.push(source);
                    }
                    BindingInitializer::PatternProperty { .. } => return true,
                    BindingInitializer::Expression(_)
                    | BindingInitializer::Function(_)
                    | BindingInitializer::Class(_) => {}
                    _ if has_path => return true,
                    _ => {}
                }
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::This => return true,
            ExprKind::Call(call) | ExprKind::New(call) => {
                let callee = hir.skip_type_assertions(hir[call].callee);
                let is_of_path = follower.find_export_of_path(callee).is_some()
                    || follower.find_path_joining_function(callee).is_some();
                let is_own = matches!(bound.binding(callee), Binding::Symbol(symbol)
                    if matches!(bound.binding_initializer(hir, symbol),
                        BindingInitializer::Function(_) | BindingInitializer::Expression(_)));
                if !is_of_path && is_own {
                    return true;
                }
                if let Some((object, _)) = hir.member_key(callee).filter(|_| !is_of_path) {
                    pending.push(object);
                }
                pending.extend(hir.ids(hir[call].args));
            }
            ExprKind::Template { exprs } => pending.extend(hir.ids(exprs)),
            ExprKind::Array(items) => pending.extend(hir.ids(items)),
            ExprKind::Spread(list) => pending.push(list),
            ExprKind::Await(awaited) => pending.push(awaited),
            ExprKind::Binary { left, right, .. } => pending.extend([left, right]),
            ExprKind::Cond { branches, .. } => {
                let Branches { yes, no } = hir.branches(branches);
                pending.extend([yes, no]);
            }
            ExprKind::Assign { .. } => return true,
            _ => {}
        }
    }
    false
}

fn undefined() -> Value {
    Value::Held(Held::Primitive(Constant::Undefined))
}

impl PartialEq for State {
    fn eq(&self, other: &State) -> bool {
        self.environment == other.environment
            && self.constants == other.constants
            && (Rc::ptr_eq(&self.variables, &other.variables) || self.variables == other.variables)
            && (Rc::ptr_eq(&self.objects, &other.objects) || self.objects == other.objects)
    }
}

impl Hash for State {
    fn hash<H: Hasher>(&self, hasher: &mut H) {
        let variables = self.variables.iter().map(|it| FxBuild.hash_one(it));
        hasher.write_u64(variables.fold(0, u64::wrapping_add));
        (&self.objects, &self.environment, &self.constants).hash(hasher);
    }
}

impl State {
    fn size(&self) -> usize {
        let objects = self.objects.iter().map(|it| 1 + it.fields.len());
        self.variables.len() + objects.sum::<usize>()
    }

    fn add_object(&mut self, object: Object) -> Value {
        Rc::make_mut(&mut self.objects).push(Rc::new(object));
        Value::Object(self.objects.len() - 1)
    }

    fn object_mut(&mut self, object: usize) -> &mut Object {
        Rc::make_mut(&mut Rc::make_mut(&mut self.objects)[object])
    }

    fn mark_read(&mut self, object: usize) {
        if !self.objects[object].is_read {
            self.object_mut(object).is_read = true;
        }
    }

    fn set_variable(&mut self, symbol: SymbolId, value: Value) {
        Rc::make_mut(&mut self.variables).insert(symbol, Rc::new(value));
    }

    fn set_field(&mut self, object: usize, key: &[u8], value: Value) {
        let fields = &mut self.object_mut(object).fields;
        match fields.iter_mut().find(|it| it.0 == key) {
            Some(field) => field.1 = value,
            None => fields.push((key.to_vec(), value)),
        }
    }

    fn share(&mut self, value: &Value) {
        let mut pending = vec![value.clone()];
        while let Some(value) = pending.pop() {
            if let Value::Object(object) = value {
                if !self.objects[object].is_shared {
                    self.object_mut(object).is_shared = true;
                    let fields = self.objects[object].fields.iter();
                    pending.extend(fields.map(|it| it.1.clone()));
                }
            }
        }
    }

    fn environment_variable(&mut self, name: Atom) -> &mut EnvironmentVariable {
        let place = match self.environment.iter().position(|it| it.0 == name) {
            Some(place) => place,
            None => {
                self.environment
                    .push((name, EnvironmentVariable::default()));
                self.environment.len() - 1
            }
        };
        &mut self.environment[place].1
    }
}

impl<'f, 'i, 'a, 's> Execution<'f, 'i, 'a, 's> {
    fn new(
        follower: &'f Follower<'i, 'a, 's>,
        operands: FxHashSet<ExprId>,
        follows_throws: bool,
    ) -> Self {
        let bound = follower.inputs.bound;
        let scopes = (0..bound.scopes.len() as u32).map(ScopeId);
        let functions_around_code = scopes.filter_map(|scope| {
            let around = bound.code_unit(bound.scopes[scope.idx()].parent.some()?);
            match around {
                CodeUnit::Function(function) if around != bound.code_unit(scope) => Some(function),
                _ => None,
            }
        });
        let functions_around_code = match follows_throws {
            true => functions_around_code.collect(),
            false => FxHashSet::default(),
        };
        Execution {
            follower,
            operands,
            seen: FxHashMap::default(),
            functions_run: FxHashSet::default(),
            escaped: FxHashSet::default(),
            escaped_classes: FxHashSet::default(),
            keys_read: FxHashSet::default(),
            symbols_read: FxHashSet::default(),
            ends: Vec::new(),
            unreachable: FxHashSet::default(),
            calls: Vec::new(),
            loops: Vec::new(),
            functions_running: Vec::new(),
            constructions_running: 0,
            receivers: Vec::new(),
            attempts: Vec::new(),
            follows_throws,
            may_throw: false,
            functions_around_code,
            steps_left: match follows_throws {
                true => MOST_STEPS_WITH_THROWS,
                false => MOST_STEPS,
            },
        }
    }

    fn find_known_values(&mut self) -> FxHashMap<ExprId, Values> {
        if self.run_file().is_none() {
            return FxHashMap::default();
        }
        let seen = std::mem::take(&mut self.seen).into_iter();
        let mut known: FxHashMap<ExprId, Values> = seen
            .filter_map(|(operand, values)| Some((operand, values?)))
            .filter(|it| !it.1.is_empty())
            .collect();
        if known.is_empty() {
            return known;
        }
        self.find_unreachable_functions();
        if !self.has_seen_every_store() {
            return FxHashMap::default();
        }
        known.retain(|operand, _| !self.may_run_again(*operand));
        known
    }

    fn run_file(&mut self) -> Option<()> {
        let hir = self.follower.inputs.hir;
        let ends = self.run_list(State::default(), hir.body)?;
        for (state, _) in &ends {
            let exported: Vec<Value> = (state.variables.iter())
                .filter(|it| self.follower.is_exported(*it.0))
                .map(|it| Value::clone(it.1))
                .collect();
            for value in exported {
                self.escape(state, &value);
            }
        }
        let bound = self.follower.inputs.bound;
        for &(_, symbol) in bound.table(bound.symbol(bound.file_symbol).exports) {
            for &declaration in bound.symbol(symbol).decls {
                match declaration {
                    Decl::Fn(function) => {
                        self.escaped.insert(function);
                    }
                    Decl::Class(class) => self.escape_class(class),
                    Decl::ExportSpec(specifier) => {
                        if let Binding::Symbol(local) = bound.exported_binding(specifier) {
                            match bound.binding_initializer(hir, local) {
                                BindingInitializer::Function(function) => {
                                    self.escaped.insert(function);
                                }
                                BindingInitializer::Class(class) => self.escape_class(class),
                                _ => {}
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        self.ends = ends.into_iter().map(|it| it.0).collect();
        Some(())
    }

    fn find_unreachable_functions(&mut self) {
        let &ScanInputs { hir, bound, .. } = self.follower.inputs;
        let mut names: FxHashMap<SymbolId, FnId> = FxHashMap::default();
        let mut methods: Vec<(FnId, Box<[u8]>)> = Vec::new();
        for function in (0..hir.fns.len() as u32).map(FnId) {
            if self.functions_run.contains(&function) || self.escaped.contains(&function) {
                continue;
            }
            if let Some(symbol) = self.find_only_name(function) {
                names.insert(symbol, function);
                self.unreachable.insert(function);
            } else if let Some(name) = self.find_name_of_method(function) {
                methods.push((function, name.into()));
            }
        }
        if !methods.is_empty() && !self.calls_by_computed_key() {
            let mut words: FxHashMap<&[u8], u32> = FxHashMap::default();
            let mut lengths = [0u64; 256];
            for (_, name) in methods.iter().filter(|it| !it.1.is_empty()) {
                words.insert(name, 0);
                lengths[usize::from(name[0])] |= 1 << (name.len() % 64);
            }
            let is_part = |byte: &u8| {
                byte.is_ascii_alphanumeric() || b"_$".contains(byte) || !byte.is_ascii()
            };
            for word in hir.text.split(|it| !is_part(it)) {
                if let Some(&first) = word.first()
                    && lengths[usize::from(first)] & (1 << (word.len() % 64)) != 0
                    && let Some(count) = words.get_mut(word)
                {
                    *count += 1;
                }
            }
            for (function, name) in &methods {
                if words.get(&**name) == Some(&1) {
                    self.unreachable.insert(*function);
                }
            }
        }
        let mut uses: Vec<(FnId, ExprId)> = Vec::new();
        for e in (0..hir.exprs.len() as u32).map(ExprId) {
            if !matches!(hir[e].kind, ExprKind::Ident(_)) || self.follower.is_dead(e) {
                continue;
            }
            if let Binding::Symbol(symbol) = bound.binding(e)
                && let Some(&function) = names.get(&symbol)
            {
                match self.is_callee(e) {
                    true => uses.push((function, e)),
                    false => _ = self.unreachable.remove(&function),
                }
            }
        }
        let mut waiting: FxHashMap<FnId, Vec<(FnId, ExprId)>> = FxHashMap::default();
        while let Some((function, e)) = uses.pop() {
            if !self.unreachable.contains(&function) {
                continue;
            }
            match self.find_use(e) {
                Use::MayRun => {
                    self.unreachable.remove(&function);
                    uses.extend(waiting.remove(&function).into_iter().flatten());
                }
                Use::Within(around) => waiting.entry(around).or_default().push((function, e)),
                Use::Over => {}
            }
        }
    }

    fn find_only_name(&self, function: FnId) -> Option<SymbolId> {
        let &ScanInputs { hir, bound, .. } = self.follower.inputs;
        let symbol = match bound.fns[function.idx()].owner {
            FnOwner::Stmt(_) => bound.declared_symbol(Decl::Fn(function)).some()?,
            FnOwner::Expr(written) => {
                let whole = self.follower.outermost_cast(written);
                let Parent::VarInit(declaration) = bound.parent_of_expr(whole) else {
                    return None;
                };
                self.declared_symbol(hir[declaration].pat)
                    .filter(|_| matches!(hir[hir[declaration].pat].kind, PatKind::Ident(_)))?
            }
            _ => return None,
        };
        let is_only = bound.stores_to(symbol).is_empty() && bound.symbol(symbol).decls.len() == 1;
        is_only.then_some(symbol)
    }

    fn find_name_of_method(&self, function: FnId) -> Option<&[u8]> {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.follower.inputs;
        let key = match bound.fns[function.idx()].owner {
            FnOwner::Member(member) if hir[member].kind != MemberKind::Constructor => {
                hir[member].key
            }
            FnOwner::Expr(written) => match bound.parent_of_expr(written) {
                Parent::Prop(property) => hir.runtime_property_key(property),
                _ => return None,
            },
            _ => return None,
        };
        let PropKey::Name(name) = key else {
            return None;
        };
        let name = atoms.bytes(name);
        let called_by_engine = [b"then".as_slice(), b"toJSON", b"toString", b"valueOf"];
        (!called_by_engine.contains(&name)).then_some(name)
    }

    fn calls_by_computed_key(&self) -> bool {
        let hir = self.follower.inputs.hir;
        (0..hir.exprs.len() as u32).map(ExprId).any(|e| {
            let ExprKind::Call(call) = hir[e].kind else {
                return false;
            };
            let callee = hir.skip_type_assertions(hir[call].callee);
            matches!(hir.member_key(callee), Some((_, MemberKey::Computed(_))))
        })
    }

    fn is_callee(&self, e: ExprId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.follower.inputs;
        let whole = self.follower.outermost_cast(e);
        matches!(bound.parent_of_expr(whole), Parent::Expr(above)
            if matches!(hir[above].kind, ExprKind::Call(call) if hir[call].callee == whole))
    }

    fn changes_unread_list(&self, call: ExprId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.follower.inputs;
        let ExprKind::Call(call) = hir[call].kind else {
            return false;
        };
        let Some((list, _)) = hir.member_key(hir.skip_type_assertions(hir[call].callee)) else {
            return false;
        };
        let Binding::Symbol(symbol) = bound.binding(hir.skip_type_assertions(list)) else {
            return false;
        };
        bound.stores_to(symbol).is_empty()
            && self.ends.iter().all(|it| {
                matches!(it.variables.get(&symbol).map(|it| &**it), Some(&Value::Object(list))
                    if it.objects[list].is_list && !it.objects[list].is_read)
            })
    }

    fn has_seen_every_store(&self) -> bool {
        let &ScanInputs { hir, bound, .. } = self.follower.inputs;
        let members = self.follower.written_names.members(hir, bound);
        let is_unseen = |e: ExprId| !self.follower.is_dead(e) && self.may_run_again(e);
        for key in &self.keys_read {
            let name = MemberName::Public(self.follower.inputs.atoms.intern(key));
            let families = members.families.get(&name).into_iter().flatten();
            for &family in families {
                let Some(written) = members.by_name.get(&(name, family)) else {
                    continue;
                };
                if written.stores.iter().any(|&it| is_unseen(it)) {
                    return false;
                }
            }
        }
        let changes_objects: &[&[u8]] =
            &[b"assign", b"push", b"unshift", b"splice", b"pop", b"shift"];
        for method in changes_objects {
            let calls = members
                .calls
                .get(&self.follower.inputs.atoms.intern(method));
            let mut calls = calls.into_iter().flatten();
            if calls.any(|&it| is_unseen(it) && !self.changes_unread_list(it)) {
                return false;
            }
        }
        let is_stored_unseen = |&symbol: &SymbolId| {
            let mut stores = bound.stores_to(symbol).iter();
            stores.any(|it| is_unseen(it.target))
        };
        !self.symbols_read.iter().any(is_stored_unseen)
    }

    fn may_run_again(&self, e: ExprId) -> bool {
        matches!(self.find_use(e), Use::MayRun)
    }

    fn find_use(&self, e: ExprId) -> Use {
        let &ScanInputs { hir, bound, .. } = self.follower.inputs;
        let place = hir[e].pos;
        if self.loops.iter().any(|it| it.contains(&place)) {
            return Use::MayRun;
        }
        let mut around = self.find_around(bound.parent_of_expr(e));
        loop {
            let function = match around {
                Around::File => return Use::Over,
                Around::Unknown => return Use::MayRun,
                Around::Function(function) if self.unreachable.contains(&function) => {
                    return Use::Within(function);
                }
                Around::Function(function) => function,
            };
            if self.escaped.contains(&function) || !self.functions_run.contains(&function) {
                return Use::MayRun;
            }
            around = match bound.fns[function.idx()].owner {
                FnOwner::Expr(written) => self.find_around(bound.parent_of_expr(written)),
                FnOwner::Stmt(declared) => self.find_around(bound.parent_of_stmt(declared)),
                FnOwner::Member(member) => match bound.member_owner[member.idx()] {
                    MemberOwner::Class(class) => match bound.class_owner[class.idx()] {
                        ClassOwner::Expr(written) => {
                            self.find_around(bound.parent_of_expr(written))
                        }
                        ClassOwner::Stmt(declared) => {
                            self.find_around(bound.parent_of_stmt(declared))
                        }
                    },
                    _ => Around::Unknown,
                },
                _ => Around::Unknown,
            };
        }
    }

    fn find_around(&self, parent: Parent) -> Around {
        let bound = self.follower.inputs.bound;
        let mut parent = parent;
        loop {
            parent = match parent {
                Parent::Expr(above) => bound.parent_of_expr(above),
                Parent::Stmt(statement) => bound.parent_of_stmt(statement),
                Parent::VarInit(declaration) => Parent::Stmt(bound.var_stmt[declaration.idx()]),
                Parent::Prop(property) => Parent::Expr(bound.prop_owner[property.idx()]),
                Parent::Case(case) => Parent::Stmt(bound.case_stmt[case.idx()]),
                Parent::FnBody(function) => return Around::Function(function),
                Parent::File => return Around::File,
                _ => return Around::Unknown,
            };
        }
    }

    fn escape(&mut self, state: &State, value: &Value) {
        let mut pending = vec![value.clone()];
        let mut met: FxHashSet<usize> = FxHashSet::default();
        while let Some(value) = pending.pop() {
            match value {
                Value::Function(function) => {
                    self.escaped.insert(function);
                }
                Value::Class(class) => self.escape_class(class),
                Value::Object(object) if met.insert(object) => {
                    if let Some(class) = state.objects[object].class {
                        self.escape_class(class);
                    }
                    let fields = state.objects[object].fields.iter();
                    pending.extend(fields.map(|it| it.1.clone()));
                }
                _ => {}
            }
        }
    }

    fn escape_class(&mut self, class: ClassId) {
        let hir = self.follower.inputs.hir;
        let mut next = Some(class);
        while let Some(class) = next.filter(|it| self.escaped_classes.insert(*it)) {
            for member in hir[class].members.iter().map(|id| hir[id]) {
                if !matches!(member.kind, MemberKind::Property) {
                    self.escaped.insert(member.func);
                }
            }
            next = self.find_class_extended(class);
        }
    }

    fn lineage(&self, class: ClassId) -> impl Iterator<Item = ClassId> {
        let mut met: FxHashSet<ClassId> = FxHashSet::default();
        std::iter::successors(Some(class), |it| self.find_class_extended(*it))
            .take_while(move |it| met.insert(*it))
    }

    fn find_class_extended(&self, class: ClassId) -> Option<ClassId> {
        let &ScanInputs { hir, bound, .. } = self.follower.inputs;
        let heritage = hir.skip_type_assertions(hir[class].extends.some()?);
        find_class_named_by(hir, bound, heritage).filter(|it| *it != class)
    }

    fn merge<T: PartialEq + Hash>(&mut self, ways: Vec<(State, T)>) -> Ways<T> {
        if ways.len() < 2 {
            return Some(ways);
        }
        let size: usize = ways.iter().map(|it| it.0.size()).sum();
        let steps = u32::try_from(size / SIZE_OF_STEP).ok()?;
        self.steps_left = self.steps_left.checked_sub(steps)?;
        let mut merged = Distinct::new();
        for way in ways {
            merged.add(way);
        }
        Some(merged.all)
    }

    fn run_list(&mut self, state: State, statements: IdList<StmtId>) -> Ways<Flow> {
        let hir = self.follower.inputs.hir;
        let mut running = vec![state];
        let mut ended: Vec<(State, Flow)> = Vec::new();
        for statement in hir.ids(statements) {
            let mut next: Vec<(State, Flow)> = Vec::new();
            for state in running {
                next.extend(self.run(state, statement)?);
            }
            let next = self.merge(next)?;
            if next.len() > MOST_STATES {
                return None;
            }
            running = Vec::new();
            for (state, flow) in next {
                match flow {
                    Flow::Next => running.push(state),
                    flow => ended.push((state, flow)),
                }
            }
        }
        ended.extend(running.into_iter().map(|it| (it, Flow::Next)));
        Some(ended)
    }

    fn limit<T: PartialEq + Hash>(&mut self, ways: Vec<(State, T)>) -> Ways<T> {
        if ways.len() <= MOST_STATES {
            return Some(ways);
        }
        self.merge(ways).filter(|it| it.len() <= MOST_STATES)
    }

    fn set_variable(&mut self, state: &mut State, symbol: SymbolId, value: Value) {
        if let Some(around) = self.attempts.last_mut() {
            around.variables.insert(symbol);
        }
        state.set_variable(symbol, value);
    }

    fn set_field(&mut self, state: &mut State, object: usize, key: &[u8], value: Value) {
        self.note_change(object);
        state.set_field(object, key, value);
    }

    fn note_change(&mut self, object: usize) {
        if let Some(around) = self.attempts.last_mut() {
            around.objects.insert(object);
        }
    }

    fn share(&mut self, state: &mut State, value: &Value) {
        if let Value::Object(object) = value {
            self.note_change(*object);
        }
        state.share(value);
    }

    fn run(&mut self, state: State, statement: StmtId) -> Ways<Flow> {
        self.steps_left = self.steps_left.checked_sub(1)?;
        let hir = self.follower.inputs.hir;
        let next = |ways: Vec<(State, Value)>| ways.into_iter().map(|it| (it.0, Flow::Next));
        match hir[statement].kind {
            StmtKind::Expr(e) | StmtKind::Directive { expr: e, .. } => {
                Some(next(self.evaluate(state, e)?).collect())
            }
            StmtKind::Var(declarations) => {
                let mut states = vec![state];
                for declaration in declarations.iter() {
                    let declared = hir[declaration];
                    if declared.init.is_none() {
                        if matches!(hir[declared.pat].kind, PatKind::Ident(_))
                            && let Some(symbol) = self.declared_symbol(declared.pat)
                        {
                            for state in &mut states {
                                if !state.variables.contains_key(&symbol) {
                                    self.set_variable(state, symbol, undefined());
                                }
                            }
                        }
                        continue;
                    }
                    let mut bound = Vec::new();
                    let is_name = matches!(hir[declared.pat].kind, PatKind::Ident(_));
                    for state in states {
                        let ways = match is_name {
                            true => self.evaluate_member(state, declared.init)?,
                            false => self.evaluate(state, declared.init)?,
                        };
                        for (state, value) in ways {
                            if matches!(declared.kind, VarKind::Using | VarKind::AwaitUsing) {
                                self.note_possible_throw(&state);
                            }
                            bound.extend(self.bind(state, declared.pat, value)?);
                        }
                    }
                    states = bound;
                }
                Some(states.into_iter().map(|it| (it, Flow::Next)).collect())
            }
            StmtKind::If { test, yes, no } => {
                let mut ways = Vec::new();
                for (state, truth) in self.decide(state, test)? {
                    let branch = if truth { yes } else { no };
                    match branch.some() {
                        Some(branch) => ways.extend(self.run(state, branch)?),
                        None => ways.push((state, Flow::Next)),
                    }
                }
                self.merge(ways)
            }
            StmtKind::Block(statements) => self.run_list(state, statements),
            StmtKind::ForOf {
                left,
                expr,
                body,
                is_await,
            } => self.run_for_of(state, statement, (left, expr, body), is_await),
            StmtKind::ForIn { left, expr, body } => {
                let mut ways = Vec::new();
                for (state, value) in self.evaluate(state, expr)? {
                    if matches!(value, Value::Unknown) {
                        self.note_possible_throw(&state);
                    }
                    let around = Loop::over(left, body);
                    ways.extend(self.run_loop(state, statement, around)?);
                }
                self.merge(ways)
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                let states = match init.some() {
                    Some(init) => self.run(state, init)?,
                    None => vec![(state, Flow::Next)],
                };
                let mut ways = Vec::new();
                for (state, _) in states {
                    let around = Loop {
                        left: StmtId::NONE,
                        test,
                        update,
                        body,
                    };
                    ways.extend(self.run_loop(state, statement, around)?);
                }
                self.merge(ways)
            }
            StmtKind::While { test, body } => {
                let around = Loop {
                    left: StmtId::NONE,
                    test,
                    update: ExprId::NONE,
                    body,
                };
                self.run_loop(state, statement, around)
            }
            StmtKind::DoWhile { body, test } => {
                let around = Loop {
                    left: StmtId::NONE,
                    test,
                    update: ExprId::NONE,
                    body,
                };
                let mut ways = Vec::new();
                for (state, flow) in self.run(state, body)? {
                    match flow {
                        Flow::Next | Flow::Continue => {
                            ways.extend(self.run_loop(state, statement, around)?);
                        }
                        Flow::Break => ways.push((state, Flow::Next)),
                        flow => ways.push((state, flow)),
                    }
                }
                self.merge(ways)
            }
            StmtKind::Switch { expr, cases } => self.run_switch(state, expr, cases),
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                let Some(finalizer) = finalizer.some() else {
                    return self.run_caught(state, block, param, handler);
                };
                self.may_throw = true;
                let follows_throws = self.follows_throws;
                if follows_throws {
                    self.begin_attempt(&state);
                }
                let ways = self.run_caught(state, block, param, handler);
                let thrown = match follows_throws {
                    true => self.end_attempt(true),
                    false => Vec::new(),
                };
                let mut ends = Vec::new();
                for (state, flow) in ways? {
                    for (state, last) in self.run(state, finalizer)? {
                        let flow = match last {
                            Flow::Next => flow.clone(),
                            last => last,
                        };
                        ends.push((state, flow));
                    }
                }
                let thrown = thrown.into_iter().map(|it| (it, ())).collect();
                for (state, ()) in self.merge(thrown)? {
                    for (state, last) in self.run(state, finalizer)? {
                        match last {
                            Flow::Next => self.note_throw(state)?,
                            last => ends.push((state, last)),
                        }
                    }
                }
                self.merge(ends)
            }
            StmtKind::Throw(thrown) => {
                for (state, value) in self.evaluate(state, thrown)? {
                    self.escape(&state, &value);
                    self.note_throw(state)?;
                }
                Some(Vec::new())
            }
            StmtKind::Return(value) => match value.some() {
                Some(value) => {
                    let ways = self.evaluate(state, value)?.into_iter();
                    Some(ways.map(|it| (it.0, Flow::Return(it.1))).collect())
                }
                None => Some(vec![(state, Flow::Return(undefined()))]),
            },
            StmtKind::Class(class) => {
                let states = self.run_class(state, class)?.into_iter();
                Some(states.map(|it| (it, Flow::Next)).collect())
            }
            StmtKind::Break(Atom::NONE) => Some(vec![(state, Flow::Break)]),
            StmtKind::Continue(Atom::NONE) => Some(vec![(state, Flow::Continue)]),
            StmtKind::ExportDefault(value) | StmtKind::ExportAssign(value) => {
                let ways = self.evaluate(state, value)?;
                for (state, value) in &ways {
                    self.escape(state, value);
                }
                Some(next(ways).collect())
            }
            StmtKind::Break(_)
            | StmtKind::Continue(_)
            | StmtKind::Labeled { .. }
            | StmtKind::With { .. }
            | StmtKind::Module(_) => None,
            _ => Some(vec![(state, Flow::Next)]),
        }
    }

    fn run_caught(
        &mut self,
        state: State,
        block: StmtId,
        param: VarDeclId,
        handler: StmtId,
    ) -> Ways<Flow> {
        let hir = self.follower.inputs.hir;
        if self.follows_throws && handler.is_none() {
            return self.run(state, block);
        }
        self.begin_attempt(&state);
        let ways = self.run(state, block);
        let thrown = self.end_attempt(handler.is_some());
        let mut ways = ways?;
        if let Some(handler) = handler.some() {
            let thrown = thrown.into_iter().map(|it| (it, ())).collect();
            for (state, ()) in self.merge(thrown)? {
                let states = match param.some() {
                    Some(param) => self.bind(state, hir[param].pat, Value::Unknown)?,
                    None => vec![state],
                };
                for state in states {
                    ways.extend(self.run(state, handler)?);
                }
            }
        }
        self.merge(ways)
    }

    fn begin_attempt(&mut self, state: &State) {
        self.attempts.push(Attempt {
            before: state.clone(),
            thrown: Vec::new(),
            has_calls: false,
            variables: FxHashSet::default(),
            objects: FxHashSet::default(),
        });
    }

    fn note_possible_throw(&mut self, state: &State) {
        let Some(around) = self.attempts.last_mut() else {
            return;
        };
        self.may_throw = true;
        if !self.follows_throws || around.has_calls {
            return;
        }
        around.thrown.push(state.clone());
        if around.thrown.len() > 2 * MOST_STATES {
            let thrown = std::mem::take(&mut around.thrown).into_iter();
            let thrown = self.limit(thrown.map(|it| (it, ())).collect());
            if let Some(around) = self.attempts.last_mut() {
                match thrown {
                    Some(thrown) => around.thrown = thrown.into_iter().map(|it| it.0).collect(),
                    None => around.has_calls = true,
                }
            }
        }
    }

    fn note_conversion(&mut self, state: &State, values: &[&Value]) {
        let is_plain = |value: &&Value| match value {
            Value::Held(Held::Primitive(constant)) => !matches!(constant, Constant::BigInt(_)),
            Value::Held(Held::Text(_) | Held::Url(_) | Held::Resolved(..))
            | Value::EnvironmentVariable(_)
            | Value::OfEnvironment(_) => true,
            _ => false,
        };
        if !values.iter().all(is_plain) {
            self.note_possible_throw(state);
        }
    }

    fn note_member_read(&mut self, state: &State, object: &Value, is_optional: bool) {
        let is_safe = match object {
            Value::Object(_) | Value::Function(_) | Value::Environment => true,
            Value::Held(Held::Primitive(Constant::Undefined | Constant::Null))
            | Value::EnvironmentVariable(_) => is_optional,
            Value::Held(_) => true,
            _ => false,
        };
        if !is_safe {
            self.note_possible_throw(state);
        }
    }

    fn note_throw(&mut self, state: State) -> Option<()> {
        let Some(around) = self.attempts.last_mut() else {
            return Some(());
        };
        around.thrown.push(state);
        if around.thrown.len() > 2 * MOST_STATES {
            let thrown = std::mem::take(&mut around.thrown).into_iter();
            let thrown = self.limit(thrown.map(|it| (it, ())).collect())?.into_iter();
            if let Some(around) = self.attempts.last_mut() {
                around.thrown = thrown.map(|it| it.0).collect();
            }
        }
        Some(())
    }

    fn end_attempt(&mut self, is_caught: bool) -> Vec<State> {
        let Some(attempt) = self.attempts.pop() else {
            return Vec::new();
        };
        let mut thrown = attempt.thrown;
        if attempt.has_calls && is_caught {
            let mut state = attempt.before;
            for &symbol in &attempt.variables {
                state.set_variable(symbol, Value::Unknown);
            }
            let count = state.objects.len();
            for &object in attempt.objects.iter().filter(|it| **it < count) {
                state.share(&Value::Object(object));
            }
            (state.constants).retain(|it| !attempt.variables.contains(&it.0));
            thrown.push(state);
        }
        if let Some(around) = self.attempts.last_mut() {
            around.variables.extend(attempt.variables);
            around.objects.extend(attempt.objects);
            around.has_calls |= attempt.has_calls && !is_caught;
        }
        thrown
    }

    fn run_for_of(
        &mut self,
        state: State,
        statement: StmtId,
        (left, expr, body): (StmtId, ExprId, StmtId),
        is_await: bool,
    ) -> Ways<Flow> {
        let mut ends = Vec::new();
        for (mut state, list) in self.evaluate(state, expr)? {
            let items = match list {
                Value::Object(object) if state.objects[object].is_list && !is_await => {
                    state.mark_read(object);
                    state.objects[object].fields.clone()
                }
                _ => {
                    self.note_possible_throw(&state);
                    let around = Loop::over(left, body);
                    ends.extend(self.run_loop(state, statement, around)?);
                    continue;
                }
            };
            let mut running = vec![state];
            for (_, item) in items {
                let mut after = Vec::new();
                for state in running {
                    for state in self.bind_left(state, left, item.clone())? {
                        for (state, flow) in self.run(state, body)? {
                            match flow {
                                Flow::Next | Flow::Continue => after.push((state, ())),
                                Flow::Break => ends.push((state, Flow::Next)),
                                flow => ends.push((state, flow)),
                            }
                        }
                    }
                }
                let after = self.merge(after)?;
                if after.len() > MOST_STATES {
                    return None;
                }
                running = after.into_iter().map(|it| it.0).collect();
            }
            ends.extend(running.into_iter().map(|it| (it, Flow::Next)));
        }
        self.merge(ends)
    }

    fn bind_left(&mut self, state: State, left: StmtId, value: Value) -> Option<Vec<State>> {
        let hir = self.follower.inputs.hir;
        match hir[left].kind {
            StmtKind::Var(declarations) => {
                let pattern = hir[declarations.iter().next()?].pat;
                self.bind(state, pattern, value)
            }
            StmtKind::Expr(target) => self.store(state, target, value),
            _ => None,
        }
    }

    fn run_loop(&mut self, state: State, statement: StmtId, around: Loop) -> Ways<Flow> {
        let hir = self.follower.inputs.hir;
        let first_call = self.calls.len();
        let mut met = Distinct::new();
        let mut pending = vec![state];
        let mut ends = Vec::new();
        for round in 0.. {
            if round == MOST_ROUNDS {
                self.loops
                    .push(hir[statement].start..hir[statement].loc.end);
                self.escaped.extend(&self.calls[first_call..]);
                ends.extend(pending.into_iter().map(|it| (it, Flow::Next)));
                break;
            }
            let mut entered = Vec::new();
            for state in pending {
                let count = met.len();
                met.add(state.clone());
                if met.len() == count {
                    continue;
                }
                if around.left.is_some() {
                    ends.push((state.clone(), Flow::Next));
                    entered.extend(self.bind_left(state, around.left, Value::Unknown)?);
                } else if around.test.is_some() {
                    for (state, truth) in self.decide(state, around.test)? {
                        match truth {
                            true => entered.push(state),
                            false => ends.push((state, Flow::Next)),
                        }
                    }
                } else {
                    entered.push(state);
                }
            }
            let mut after = Vec::new();
            for state in entered {
                for (state, flow) in self.run(state, around.body)? {
                    match flow {
                        Flow::Next | Flow::Continue if around.update.is_some() => {
                            let ways = self.evaluate(state, around.update)?;
                            after.extend(ways.into_iter().map(|it| (it.0, ())));
                        }
                        Flow::Next | Flow::Continue => after.push((state, ())),
                        Flow::Break => ends.push((state, Flow::Next)),
                        flow => ends.push((state, flow)),
                    }
                }
            }
            pending = self.merge(after)?.into_iter().map(|it| it.0).collect();
            ends = self.merge(ends)?;
            if pending.is_empty() {
                break;
            }
            if pending.len() + ends.len() > MOST_STATES {
                return None;
            }
        }
        Some(ends)
    }

    fn run_switch(&mut self, state: State, expr: ExprId, cases: Span<CaseId>) -> Ways<Flow> {
        let hir = self.follower.inputs.hir;
        let mut ends = Vec::new();
        for (state, value) in self.evaluate(state, expr)? {
            let mut testing = vec![state];
            let mut entered: Vec<(State, usize)> = Vec::new();
            for (place, case) in cases.iter().enumerate() {
                let Some(test) = hir[case].test.some() else {
                    continue;
                };
                let mut after = Vec::new();
                for state in testing {
                    for (state, tested) in self.evaluate(state, test)? {
                        for (state, is_equal) in self.compare(state, &value, &tested) {
                            match is_equal {
                                true => entered.push((state, place)),
                                false => after.push(state),
                            }
                        }
                    }
                }
                testing = after;
            }
            let default = cases.iter().position(|it| hir[it].test.is_none());
            match default {
                Some(place) => entered.extend(testing.into_iter().map(|it| (it, place))),
                None => ends.extend(testing.into_iter().map(|it| (it, Flow::Next))),
            }
            for (state, place) in entered {
                let mut running = vec![state];
                for case in cases.iter().skip(place) {
                    let mut after = Vec::new();
                    for state in running {
                        for (state, flow) in self.run_list(state, hir[case].body)? {
                            match flow {
                                Flow::Next => after.push(state),
                                Flow::Break => ends.push((state, Flow::Next)),
                                flow => ends.push((state, flow)),
                            }
                        }
                    }
                    running = after;
                }
                ends.extend(running.into_iter().map(|it| (it, Flow::Next)));
            }
        }
        self.merge(ends)
    }

    fn compare(&mut self, mut state: State, left: &Value, right: &Value) -> Vec<(State, bool)> {
        let atoms = self.follower.inputs.atoms;
        let text = |value: &Value| match value {
            Value::Held(Held::Text(text))
                if text.end.is_none() && !text.starts_at_own_directory && !text.is_file_url =>
            {
                Some(text.start.clone())
            }
            Value::Held(Held::Primitive(Constant::String(text))) => {
                Some(atoms.bytes(*text).to_vec())
            }
            _ => None,
        };
        match (left, right) {
            (Value::EnvironmentVariable(name), other)
            | (other, Value::EnvironmentVariable(name)) => {
                let variable = state.environment_variable(*name);
                let Some(text) = text(other) else {
                    if matches!(other, Value::Held(Held::Primitive(_))) {
                        if *other != undefined() {
                            return vec![(state, false)];
                        }
                        return match (&variable.equals, variable.is_set) {
                            (Some(_), _) | (_, Some(true)) => vec![(state, false)],
                            _ => vec![(state.clone(), true), (state, false)],
                        };
                    }
                    return vec![(state.clone(), true), (state, false)];
                };
                if let Some(known) = &variable.equals {
                    let is_equal = *known == text;
                    return vec![(state, is_equal)];
                }
                let is_empty = text.is_empty();
                if variable.differs.contains(&text) || variable.is_set == Some(is_empty) {
                    return vec![(state, false)];
                }
                let mut equal = state.clone();
                let variable = equal.environment_variable(*name);
                variable.equals = Some(text.clone());
                variable.is_set = Some(!is_empty);
                state.environment_variable(*name).differs.push(text);
                vec![(equal, true), (state, false)]
            }
            (Value::Held(Held::Primitive(left)), Value::Held(Held::Primitive(right))) => {
                let is_equal = left == right;
                vec![(state, is_equal)]
            }
            (left, right) => match (text(left), text(right)) {
                (Some(left), Some(right)) => vec![(state, left == right)],
                _ => vec![(state.clone(), true), (state, false)],
            },
        }
    }

    fn compare_loosely(&mut self, state: State, left: &Value, right: &Value) -> Vec<(State, bool)> {
        let is_missing = |value: &Value| {
            matches!(
                value,
                Value::Held(Held::Primitive(Constant::Undefined | Constant::Null))
            )
        };
        let kind = |value: &Value| match value {
            Value::Held(Held::Primitive(Constant::String(_))) => None,
            Value::Held(Held::Primitive(constant)) => Some(std::mem::discriminant(constant)),
            _ => None,
        };
        match (left, right) {
            (left, right) if is_missing(left) && is_missing(right) => vec![(state, true)],
            (variable @ Value::EnvironmentVariable(_), other)
            | (other, variable @ Value::EnvironmentVariable(_))
                if is_missing(other) =>
            {
                self.compare(state, variable, &undefined())
            }
            (left, right) if is_missing(left) || is_missing(right) => {
                self.compare(state, left, right)
            }
            (
                Value::EnvironmentVariable(_) | Value::Held(Held::Primitive(_)),
                Value::EnvironmentVariable(_) | Value::Held(Held::Primitive(_)),
            ) if kind(left) != kind(right) => vec![(state.clone(), true), (state, false)],
            _ => self.compare(state, left, right),
        }
    }

    fn decide(&mut self, state: State, test: ExprId) -> Ways<bool> {
        let &ScanInputs { hir, bound, .. } = self.follower.inputs;
        let test = hir.skip_type_assertions(test);
        match hir[test].kind {
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => {
                let ways = self.decide(state, operand)?.into_iter();
                Some(ways.map(|it| (it.0, !it.1)).collect())
            }
            ExprKind::Binary {
                op: op @ (BinOp::And | BinOp::Or),
                left,
                right,
            } => {
                let mut ways = Vec::new();
                for (state, truth) in self.decide(state, left)? {
                    match truth == (op == BinOp::And) {
                        true => ways.extend(self.decide(state, right)?),
                        false => ways.push((state, truth)),
                    }
                }
                self.limit(ways)
            }
            ExprKind::Binary {
                op: op @ (BinOp::EqEqEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::NotEq),
                left,
                right,
            } => {
                let is_negated = matches!(op, BinOp::NotEqEq | BinOp::NotEq);
                let is_loose = matches!(op, BinOp::EqEq | BinOp::NotEq);
                let mut ways = Vec::new();
                for (state, first) in self.evaluate(state, left)? {
                    for (state, second) in self.evaluate(state, right)? {
                        self.note_operation(&state, op, &first, &second);
                        let compared = match is_loose {
                            true => self.compare_loosely(state, &first, &second),
                            false => self.compare(state, &first, &second),
                        };
                        ways.extend(compared.into_iter().map(|it| (it.0, it.1 != is_negated)));
                    }
                }
                Some(ways)
            }
            _ => {
                let mut ways = Vec::new();
                for (state, value) in self.evaluate(state, test)? {
                    let constant = match (hir[test].kind, bound.binding(test)) {
                        (ExprKind::Ident(_), Binding::Symbol(symbol))
                            if bound.binding_kind(symbol) == BindingKind::Const =>
                        {
                            Some(symbol)
                        }
                        _ => None,
                    };
                    ways.extend(self.find_truth(state, &value, constant));
                }
                Some(ways)
            }
        }
    }

    fn find_truth(
        &mut self,
        mut state: State,
        value: &Value,
        constant: Option<SymbolId>,
    ) -> Vec<(State, bool)> {
        let truth = match value {
            Value::Held(Held::Text(text)) => match &text.end {
                None => Some(!text.start.is_empty()),
                Some(_) => (!text.start.is_empty()).then_some(true),
            },
            Value::Held(Held::Primitive(constant)) => match constant {
                Constant::Undefined | Constant::Null => Some(false),
                Constant::Boolean(truth) => Some(*truth),
                Constant::Number(number) => Some(*number != 0.0 && !number.is_nan()),
                Constant::String(text) => Some(!self.follower.inputs.atoms.bytes(*text).is_empty()),
                Constant::BigInt(_) => None,
            },
            Value::Held(Held::Url(_) | Held::Resolved(..)) => Some(true),
            Value::Object(_) | Value::Function(_) | Value::Class(_) | Value::Environment => {
                Some(true)
            }
            Value::EnvironmentVariable(name) => {
                let variable = state.environment_variable(*name);
                if variable.is_set.is_none() {
                    let mut set = state.clone();
                    set.environment_variable(*name).is_set = Some(true);
                    state.environment_variable(*name).is_set = Some(false);
                    return vec![(set, true), (state, false)];
                }
                variable.is_set
            }
            Value::Held(_) | Value::OfEnvironment(_) | Value::Unknown => None,
        };
        if let Some(truth) = truth {
            return vec![(state, truth)];
        }
        let Some(constant) = constant else {
            return vec![(state.clone(), true), (state, false)];
        };
        if let Some(&(_, truth)) = state.constants.iter().find(|it| it.0 == constant) {
            return vec![(state, truth)];
        }
        let with = |truth: bool| {
            let mut state = state.clone();
            state.constants.push((constant, truth));
            (state, truth)
        };
        vec![with(true), with(false)]
    }

    fn evaluate(&mut self, state: State, e: ExprId) -> Ways<Value> {
        self.steps_left = self.steps_left.checked_sub(1)?;
        let hir = self.follower.inputs.hir;
        let mut ways = Vec::new();
        for (state, value) in self.evaluate_written(state, hir.skip_type_assertions(e))? {
            match value {
                Value::OfEnvironment(written) => ways.extend(self.evaluate(state, written)?),
                value => ways.push((state, value)),
            }
        }
        for (state, value) in &mut ways {
            if matches!(value, Value::Object(object) if state.objects[*object].is_shared) {
                *value = Value::Unknown;
            }
        }
        let ways = self.merge(ways)?;
        if ways.len() > MOST_STATES {
            return None;
        }
        if self.operands.contains(&e) {
            for (_, value) in &ways {
                let seen = self.seen.entry(e).or_insert_with(|| Some(Values::new()));
                match with_text(self.follower, value) {
                    Value::Held(held @ (Held::Text(_) | Held::Url(_) | Held::Resolved(..))) => {
                        if let Some(values) = seen
                            && !values.contains(&held)
                        {
                            values.push(held);
                        }
                    }
                    _ => *seen = None,
                }
            }
        }
        Some(ways)
    }

    fn evaluate_member(&mut self, state: State, e: ExprId) -> Ways<Value> {
        let hir = self.follower.inputs.hir;
        let e = hir.skip_type_assertions(e);
        let chooses = matches!(
            hir[e].kind,
            ExprKind::Binary { .. } | ExprKind::Cond { .. } | ExprKind::Template { .. }
        );
        match chooses && self.is_of_environment(e) {
            true => Some(vec![(state, Value::OfEnvironment(e))]),
            false => self.evaluate(state, e),
        }
    }

    fn is_of_environment(&self, e: ExprId) -> bool {
        let &ScanInputs {
            hir,
            atoms,
            decisions,
            ..
        } = self.follower.inputs;
        let mut pending = vec![e];
        while let Some(e) = pending.pop() {
            let e = hir.skip_type_assertions(e);
            if !matches!(decisions.constant(hir, e), FoldedValue::Unknown) {
                continue;
            }
            match hir[e].kind {
                ExprKind::Binary {
                    op:
                        BinOp::Or
                        | BinOp::And
                        | BinOp::Nullish
                        | BinOp::Add
                        | BinOp::EqEq
                        | BinOp::NotEq
                        | BinOp::EqEqEq
                        | BinOp::NotEqEq,
                    left,
                    right,
                } => pending.extend([left, right]),
                ExprKind::Cond { test, branches } => {
                    let Branches { yes, no } = hir.branches(branches);
                    pending.extend([test, yes, no]);
                }
                ExprKind::Template { exprs } => pending.extend(hir.ids(exprs)),
                ExprKind::Unary {
                    op: UnOp::Not,
                    operand,
                } => pending.push(operand),
                ExprKind::Dot { .. } | ExprKind::Index { .. } => match hir.member_key(e) {
                    Some((environment, MemberKey::Name(name)))
                        if self.names_environment(hir.skip_type_assertions(environment))
                            && !self.sets_member(atoms.bytes(name)) => {}
                    _ => return false,
                },
                _ => return false,
            }
        }
        true
    }

    fn evaluate_members(
        &mut self,
        state: State,
        all: impl Iterator<Item = ExprId>,
    ) -> Ways<Vec<Value>> {
        self.evaluate_each(state, all, true)
    }

    fn evaluate_all(
        &mut self,
        state: State,
        all: impl Iterator<Item = ExprId>,
    ) -> Ways<Vec<Value>> {
        self.evaluate_each(state, all, false)
    }

    fn evaluate_each(
        &mut self,
        state: State,
        all: impl Iterator<Item = ExprId>,
        are_members: bool,
    ) -> Ways<Vec<Value>> {
        let hir = self.follower.inputs.hir;
        let mut ways = vec![(state, Vec::new())];
        for e in all {
            let mut longer = Vec::new();
            for (state, values) in ways {
                let (written, is_spread) = match hir[e].kind {
                    ExprKind::Spread(list) => (list, true),
                    _ => (e, false),
                };
                let written = match are_members && !is_spread {
                    true => self.evaluate_member(state, written)?,
                    false => self.evaluate(state, written)?,
                };
                for (mut state, value) in written {
                    let mut values = values.clone();
                    match (is_spread, &value) {
                        (true, Value::Object(object)) if state.objects[*object].is_list => {
                            state.mark_read(*object);
                            let items = state.objects[*object].fields.iter();
                            values.extend(items.map(|it| it.1.clone()));
                        }
                        (true, _) => return None,
                        (false, _) => values.push(value),
                    }
                    longer.push((state, values));
                }
            }
            ways = self.limit(longer)?;
        }
        Some(ways)
    }

    fn evaluate_written(&mut self, state: State, e: ExprId) -> Ways<Value> {
        let &ScanInputs {
            hir,
            bound,
            decisions,
            atoms,
            ..
        } = self.follower.inputs;
        let one = |state: State, value: Value| Some(vec![(state, value)]);
        match decisions.constant(hir, e) {
            FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
                return one(state, Value::Held(Held::Primitive(constant)));
            }
            FoldedValue::Unknown => {}
        }
        if self.follower.names_own_directory(e) {
            let own_directory = Text {
                starts_at_own_directory: true,
                ..Text::whole(b".")
            };
            return one(state, Value::Held(Held::Text(own_directory)));
        }
        if let Some(own_file) = self.follower.find_own_file(e) {
            return one(state, Value::Held(Held::Text(own_file)));
        }
        match hir[e].kind {
            ExprKind::Ident(_) => {
                let value = self.value_of_name(&state, e);
                one(state, value)
            }
            ExprKind::This => {
                let receiver = self.receivers.last().cloned();
                one(state, receiver.unwrap_or(Value::Unknown))
            }
            ExprKind::Template { exprs } => {
                let texts: Vec<Atom> = hir.ids(hir.template_texts(exprs)).collect();
                let ways = self.evaluate_all(state, hir.ids(exprs))?;
                let joined = ways.into_iter().map(|(state, values)| {
                    let whole =
                        |text: Atom| Value::Held(Held::Text(Text::whole(atoms.bytes(text))));
                    let mut parts = vec![whole(texts[0])];
                    for (value, &text) in values.into_iter().zip(&texts[1..]) {
                        parts.push(value);
                        parts.push(whole(text));
                    }
                    self.note_conversion(&state, &parts.iter().collect::<Vec<_>>());
                    (state, self.join_texts(&parts))
                });
                Some(joined.collect())
            }
            ExprKind::Binary { op, left, right } => self.evaluate_binary(state, op, left, right),
            ExprKind::Cond { test, branches } => {
                let Branches { yes, no } = hir.branches(branches);
                let mut ways = Vec::new();
                for (state, truth) in self.decide(state, test)? {
                    ways.extend(self.evaluate(state, if truth { yes } else { no })?);
                }
                Some(ways)
            }
            ExprKind::Unary { op, operand } => {
                let mut ways = Vec::new();
                for (mut state, value) in self.evaluate(state, operand)? {
                    if !matches!(op, UnOp::Not | UnOp::Typeof | UnOp::Void) {
                        self.note_conversion(&state, &[&value]);
                    }
                    if !matches!(
                        op,
                        UnOp::Plus
                            | UnOp::Minus
                            | UnOp::BitNot
                            | UnOp::Not
                            | UnOp::Typeof
                            | UnOp::Void
                    ) {
                        let written = hir.skip_type_assertions(operand);
                        let Binding::Symbol(symbol) = bound.binding(written) else {
                            return None;
                        };
                        self.set_variable(&mut state, symbol, Value::Unknown);
                    }
                    ways.push((state, Value::Unknown));
                }
                Some(ways)
            }
            ExprKind::Assign { op, target, value } => {
                self.evaluate_assignment(state, op, target, value)
            }
            ExprKind::Object(properties) => {
                let mut ways = vec![(state, Vec::<(Vec<u8>, Value)>::new())];
                for id in properties.iter() {
                    let property = hir[id];
                    let mut longer = Vec::new();
                    for (state, fields) in ways {
                        match (property.kind, hir.runtime_property_key(id)) {
                            (PropKind::Spread, _) => {
                                for (state, value) in self.evaluate(state, property.value)? {
                                    let mut fields = fields.clone();
                                    if let Value::Object(object) = value {
                                        for (key, value) in &state.objects[object].fields {
                                            fields.retain(|it| it.0 != *key);
                                            fields.push((key.clone(), value.clone()));
                                        }
                                    } else {
                                        return None;
                                    }
                                    longer.push((state, fields));
                                }
                            }
                            (
                                PropKind::Init | PropKind::Shorthand | PropKind::Method,
                                PropKey::Name(name),
                            ) => {
                                for (state, value) in self.evaluate_member(state, property.value)? {
                                    let mut fields = fields.clone();
                                    let key = atoms.bytes(name).to_vec();
                                    fields.retain(|it| it.0 != key);
                                    fields.push((key, value));
                                    longer.push((state, fields));
                                }
                            }
                            _ => return None,
                        }
                    }
                    ways = self.limit(longer)?;
                }
                let made = ways.into_iter().map(|(mut state, fields)| {
                    let object = state.add_object(Object {
                        class: None,
                        is_list: false,
                        is_shared: false,
                        is_read: false,
                        fields,
                    });
                    (state, object)
                });
                Some(made.collect())
            }
            ExprKind::Array(items) => {
                if hir
                    .ids(items)
                    .any(|it| matches!(hir[it].kind, ExprKind::Missing))
                {
                    return None;
                }
                let ways = self.evaluate_members(state, hir.ids(items))?;
                let made = ways.into_iter().map(|(mut state, values)| {
                    let list = state.add_object(list_of(values));
                    (state, list)
                });
                Some(made.collect())
            }
            ExprKind::Fn(function) => one(state, Value::Function(function)),
            ExprKind::Class(class) => {
                let states = self.run_class(state, class)?.into_iter();
                Some(states.map(|it| (it, Value::Class(class))).collect())
            }
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => {
                if self.names_environment(e) {
                    return one(state, Value::Environment);
                }
                let is_optional = chain != Chain::No;
                let (object, key) = hir.member_key(e)?;
                let mut ways = Vec::new();
                for (state, object) in self.evaluate(state, object)? {
                    for (state, key) in self.evaluate_key(state, key)? {
                        self.note_member_read(&state, &object, is_optional);
                        ways.extend(self.read_field(state, &object, key)?);
                    }
                }
                Some(ways)
            }
            ExprKind::Call(call) => self.evaluate_call(state, e, hir[call]),
            ExprKind::New(call) => self.evaluate_new(state, hir[call]),
            ExprKind::Await(awaited) => {
                let mut ways = self.evaluate(state, awaited)?;
                for (state, value) in &mut ways {
                    self.note_possible_throw(state);
                    *value = Value::Unknown;
                }
                Some(ways)
            }
            ExprKind::TaggedTemplate(call) => {
                let mut ways = Vec::new();
                for (state, passed) in self.evaluate_all(state, hir.ids(hir[call].args))? {
                    ways.extend(self.call_unknown(state, &undefined(), &passed));
                }
                Some(ways)
            }
            ExprKind::ImportCall { args } => {
                let ways = self.evaluate_all(state, hir.ids(args))?.into_iter();
                Some(ways.map(|it| (it.0, Value::Unknown)).collect())
            }
            ExprKind::Regex { .. }
            | ExprKind::ImportMeta
            | ExprKind::BigInt(_)
            | ExprKind::Super
            | ExprKind::NewTarget(_) => one(state, Value::Unknown),
            _ => None,
        }
    }

    fn value_of_name(&mut self, state: &State, name: ExprId) -> Value {
        let &ScanInputs { hir, bound, .. } = self.follower.inputs;
        let Binding::Symbol(symbol) = bound.binding(name) else {
            return match is_free_name(hir, bound, name, &[known::undefined]) {
                true => undefined(),
                false => Value::Unknown,
            };
        };
        self.symbols_read.insert(symbol);
        if let Some(value) = state.variables.get(&symbol) {
            return Value::clone(value);
        }
        let is_lexical = matches!(
            bound.binding_kind(symbol),
            BindingKind::Let | BindingKind::Const
        );
        if is_lexical {
            self.note_possible_throw(state);
        }
        if !bound.stores_to(symbol).is_empty() {
            return Value::Unknown;
        }
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Function(function) => Value::Function(function),
            BindingInitializer::Class(class) => Value::Class(class),
            _ => Value::Unknown,
        }
    }

    fn names_environment(&self, e: ExprId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.follower.inputs;
        matches!(hir.member_key(e), Some((host, MemberKey::Name(known::env)))
            if is_process(hir, bound, host, &[known::globalThis, known::global]))
    }

    fn evaluate_key(&mut self, state: State, key: MemberKey) -> Ways<Option<Vec<u8>>> {
        let atoms = self.follower.inputs.atoms;
        match key {
            MemberKey::Name(name) => Some(vec![(state, Some(atoms.bytes(name).to_vec()))]),
            MemberKey::PrivateName(name) => {
                Some(vec![(state, Some([b"#", atoms.bytes(name)].concat()))])
            }
            MemberKey::Computed(computed) => {
                let ways = self.evaluate(state, computed)?.into_iter();
                let keys = ways.map(|(state, value)| {
                    let key = match value {
                        Value::Held(held) => self.follower.as_text(&held),
                        _ => None,
                    };
                    let key = key.filter(|it| it.end.is_none() && !it.starts_at_own_directory);
                    (state, key.map(|it| it.start))
                });
                Some(keys.collect())
            }
        }
    }

    fn read_field(
        &mut self,
        mut state: State,
        object: &Value,
        key: Option<Vec<u8>>,
    ) -> Ways<Value> {
        let atoms = self.follower.inputs.atoms;
        let Some(key) = key else {
            return Some(vec![(state, Value::Unknown)]);
        };
        let value = match object {
            Value::Object(id) => {
                state.mark_read(*id);
                let held = &state.objects[*id];
                let field = held.fields.iter().find(|it| it.0 == key);
                match (field, held.class) {
                    (Some(field), _) => field.1.clone(),
                    (None, Some(class)) => {
                        let Some((kind, function)) = self.find_method(class, &key) else {
                            self.keys_read.insert(key);
                            return Some(vec![(state, undefined())]);
                        };
                        if kind == MemberKind::Getter {
                            return self.call_function(state, function, object.clone(), &[]);
                        }
                        Value::Function(function)
                    }
                    (None, None) if held.is_list => Value::Unknown,
                    (None, None) => undefined(),
                }
            }
            Value::Environment => {
                let name = atoms.intern(&key);
                match self.sets_member(&key) {
                    true => Value::Unknown,
                    false => Value::EnvironmentVariable(name),
                }
            }
            _ => Value::Unknown,
        };
        self.keys_read.insert(key);
        Some(vec![(state, value)])
    }

    fn sets_member(&self, key: &[u8]) -> bool {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.follower.inputs;
        let members = self.follower.written_names.members(hir, bound);
        let name = MemberName::Public(atoms.intern(key));
        let families = members.families.get(&name);
        families.into_iter().flatten().any(|&family| {
            (members.by_name.get(&(name, family))).is_some_and(|it| !it.stores.is_empty())
        })
    }

    fn find_method(&self, class: ClassId, key: &[u8]) -> Option<(MemberKind, FnId)> {
        let &ScanInputs { hir, atoms, .. } = self.follower.inputs;
        self.lineage(class).find_map(|class| {
            let mut members = hir[class].members.iter().map(|id| hir[id]);
            let named = members.find(|it| {
                !it.flags.contains(Flags::STATIC)
                    && matches!(it.key, PropKey::Name(name) if atoms.bytes(name) == key)
                    && matches!(it.kind, MemberKind::Method | MemberKind::Getter)
            });
            named.map(|it| (it.kind, it.func))
        })
    }

    fn join_texts(&self, parts: &[Value]) -> Value {
        let mut held: Vec<Values> = Vec::with_capacity(parts.len());
        for part in parts {
            match part {
                Value::Held(value @ (Held::Text(_) | Held::Primitive(_))) => {
                    held.push(vec![value.clone()]);
                }
                _ => return Value::Unknown,
            }
        }
        match self.follower.join_parts(&held).as_deref() {
            Some([joined]) => Value::Held(joined.clone()),
            _ => Value::Unknown,
        }
    }

    fn add(&self, left: &Value, right: &Value) -> Value {
        let (Value::Held(left), Value::Held(right)) = (left, right) else {
            return Value::Unknown;
        };
        let held = |it: &Held| match with_text(self.follower, &Value::Held(it.clone())) {
            Value::Held(held @ (Held::Text(_) | Held::Primitive(_))) => Some(vec![held]),
            _ => None,
        };
        let (Some(left), Some(right)) = (held(left), held(right)) else {
            return Value::Unknown;
        };
        match self.follower.add_values(&left, &right).as_deref() {
            Some([sum]) => Value::Held(sum.clone()),
            _ => Value::Unknown,
        }
    }

    fn evaluate_binary(
        &mut self,
        state: State,
        op: BinOp,
        left: ExprId,
        right: ExprId,
    ) -> Ways<Value> {
        let mut ways = Vec::new();
        match op {
            BinOp::And | BinOp::Or => {
                for (state, value) in self.evaluate(state, left)? {
                    for (state, truth) in self.find_truth(state, &value, None) {
                        match truth == (op == BinOp::And) {
                            true => ways.extend(self.evaluate(state, right)?),
                            false => ways.push((state, value.clone())),
                        }
                    }
                }
            }
            BinOp::Nullish => {
                for (state, value) in self.evaluate(state, left)? {
                    for (state, is_missing) in self.find_missing(state, &value) {
                        match is_missing {
                            true => ways.extend(self.evaluate(state, right)?),
                            false => ways.push((state, value.clone())),
                        }
                    }
                }
            }
            BinOp::Comma => {
                for (state, _) in self.evaluate(state, left)? {
                    ways.extend(self.evaluate(state, right)?);
                }
            }
            _ => {
                for (state, first) in self.evaluate(state, left)? {
                    for (state, second) in self.evaluate(state, right)? {
                        self.note_operation(&state, op, &first, &second);
                        let value = match op {
                            BinOp::Add => self.add(&first, &second),
                            _ => Value::Unknown,
                        };
                        ways.push((state, value));
                    }
                }
            }
        }
        Some(ways)
    }

    fn note_operation(&mut self, state: &State, op: BinOp, left: &Value, right: &Value) {
        let is_missing = |value: &Value| {
            matches!(
                value,
                Value::Held(Held::Primitive(Constant::Undefined | Constant::Null))
            )
        };
        match op {
            BinOp::EqEqEq | BinOp::NotEqEq => {}
            BinOp::EqEq | BinOp::NotEq if is_missing(left) || is_missing(right) => {}
            BinOp::In if matches!(right, Value::Object(_)) => self.note_conversion(state, &[left]),
            BinOp::In => self.note_possible_throw(state),
            BinOp::Instanceof if matches!(right, Value::Function(_) | Value::Class(_)) => {}
            BinOp::Instanceof => self.note_possible_throw(state),
            _ => self.note_conversion(state, &[left, right]),
        }
    }

    fn find_missing(&mut self, mut state: State, value: &Value) -> Vec<(State, bool)> {
        match value {
            Value::Held(Held::Primitive(constant)) => {
                let is_missing = matches!(constant, Constant::Undefined | Constant::Null);
                vec![(state, is_missing)]
            }
            Value::EnvironmentVariable(name) => {
                let variable = state.environment_variable(*name);
                match variable.is_set {
                    Some(true) => vec![(state, false)],
                    _ if variable.equals.is_some() => vec![(state, false)],
                    Some(false) => vec![(state.clone(), true), (state, false)],
                    None => {
                        let mut missing = state.clone();
                        missing.environment_variable(*name).is_set = Some(false);
                        vec![(missing, true), (state, false)]
                    }
                }
            }
            Value::Unknown => vec![(state.clone(), true), (state, false)],
            _ => vec![(state, false)],
        }
    }

    fn evaluate_assignment(
        &mut self,
        state: State,
        op: Option<BinOp>,
        target: ExprId,
        value: ExprId,
    ) -> Ways<Value> {
        let hir = self.follower.inputs.hir;
        let target = hir.skip_type_assertions(target);
        if let ExprKind::Array(targets) = hir[target].kind {
            if op.is_some() {
                return None;
            }
            let mut ways = Vec::new();
            for (mut state, value) in self.evaluate(state, value)? {
                let Value::Object(list) = value else {
                    return None;
                };
                state.mark_read(list);
                let items = state.objects[list].fields.clone();
                let mut states = vec![state];
                for (place, target) in hir.ids(targets).enumerate() {
                    let item = items.get(place).map_or_else(undefined, |it| it.1.clone());
                    let mut after = Vec::new();
                    for state in states {
                        after.extend(self.store(state, target, item.clone())?);
                    }
                    states = after;
                }
                ways.extend(states.into_iter().map(|it| (it, value.clone())));
            }
            return Some(ways);
        }
        let mut ways = Vec::new();
        match op {
            None => {
                for (state, value) in self.evaluate(state, value)? {
                    let states = self.store(state, target, value.clone())?.into_iter();
                    ways.extend(states.map(|it| (it, value.clone())));
                }
            }
            Some(op @ (BinOp::Or | BinOp::And | BinOp::Nullish)) => {
                for (state, held) in self.evaluate(state, target)? {
                    let decided = match op {
                        BinOp::Nullish => self.find_missing(state, &held),
                        _ => self.find_truth(state, &held, None),
                    };
                    for (state, truth) in decided {
                        if truth != (op != BinOp::Or) {
                            ways.push((state, held.clone()));
                            continue;
                        }
                        for (state, value) in self.evaluate(state, value)? {
                            let states = self.store(state, target, value.clone())?.into_iter();
                            ways.extend(states.map(|it| (it, value.clone())));
                        }
                    }
                }
            }
            Some(op) => {
                for (state, held) in self.evaluate(state, target)? {
                    for (state, value) in self.evaluate(state, value)? {
                        self.note_operation(&state, op, &held, &value);
                        let value = match op {
                            BinOp::Add => self.add(&held, &value),
                            _ => Value::Unknown,
                        };
                        let states = self.store(state, target, value.clone())?.into_iter();
                        ways.extend(states.map(|it| (it, value.clone())));
                    }
                }
            }
        }
        Some(ways)
    }

    fn store(&mut self, mut state: State, target: ExprId, value: Value) -> Option<Vec<State>> {
        let &ScanInputs { hir, bound, .. } = self.follower.inputs;
        let target = hir.skip_type_assertions(target);
        match hir[target].kind {
            ExprKind::Ident(_) => {
                self.note_store(&state, target);
                match bound.binding(target) {
                    Binding::Symbol(symbol) => self.set_variable(&mut state, symbol, value),
                    _ => self.escape(&state, &value),
                }
                Some(vec![state])
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                let (object, key) = hir.member_key(target)?;
                let mut states = Vec::new();
                for (state, object) in self.evaluate(state, object)? {
                    for (mut state, key) in self.evaluate_key(state, key)? {
                        match (&object, key) {
                            (Value::Object(object), Some(key)) => {
                                if state.objects[*object].is_list {
                                    return None;
                                }
                                let setter = (state.objects[*object].class)
                                    .filter(|it| self.has_setter(*it, &key));
                                if setter.is_some() {
                                    return None;
                                }
                                self.set_field(&mut state, *object, &key, value.clone());
                            }
                            (Value::Object(_), None) => return None,
                            _ => {
                                self.note_possible_throw(&state);
                                self.escape(&state, &value);
                            }
                        }
                        states.push(state);
                    }
                }
                Some(states)
            }
            _ => None,
        }
    }

    fn note_store(&mut self, state: &State, name: ExprId) {
        let bound = self.follower.inputs.bound;
        let may_throw = match bound.binding(name) {
            Binding::Symbol(symbol) => match bound.binding_kind(symbol) {
                BindingKind::Let => !state.variables.contains_key(&symbol),
                kind => kind.is_immutable(),
            },
            _ => true,
        };
        if may_throw {
            self.note_possible_throw(state);
        }
    }

    fn has_setter(&self, class: ClassId, key: &[u8]) -> bool {
        let &ScanInputs { hir, atoms, .. } = self.follower.inputs;
        self.lineage(class).any(|class| {
            let mut members = hir[class].members.iter().map(|id| hir[id]);
            members.any(|it| {
                it.kind == MemberKind::Setter
                    && matches!(it.key, PropKey::Name(name) if atoms.bytes(name) == key)
            })
        })
    }

    fn bind(&mut self, mut state: State, pattern: PatId, value: Value) -> Option<Vec<State>> {
        let &ScanInputs { hir, atoms, .. } = self.follower.inputs;
        match hir[pattern].kind {
            PatKind::Ident(_) => {
                if let Some(symbol) = self.declared_symbol(pattern) {
                    self.set_variable(&mut state, symbol, value);
                }
                Some(vec![state])
            }
            PatKind::Object(properties) => {
                self.note_member_read(&state, &value, false);
                let mut states = vec![state];
                for property in properties.iter() {
                    let PropKey::Name(name) = hir.runtime_binding_key(property) else {
                        return None;
                    };
                    let property = hir[property];
                    if property.is_rest {
                        return None;
                    }
                    let mut after = Vec::new();
                    for state in states {
                        let key = Some(atoms.bytes(name).to_vec());
                        for (state, read) in self.read_field(state, &value, key)? {
                            let held = self.or_default(state, read, property.default)?;
                            for (state, held) in held {
                                after.extend(self.bind(state, property.value, held)?);
                            }
                        }
                    }
                    states = after;
                }
                Some(states)
            }
            PatKind::Array(elements) => {
                self.note_iteration(&state, &value);
                let mut states = vec![state];
                for (place, element) in elements.iter().enumerate() {
                    let element = hir[element];
                    if element.is_rest {
                        return None;
                    }
                    if matches!(hir[element.pat].kind, PatKind::Missing) {
                        continue;
                    }
                    let mut after = Vec::new();
                    for state in states {
                        let key = Some(place.to_string().into_bytes());
                        for (state, read) in self.read_field(state, &value, key)? {
                            let held = self.or_default(state, read, element.default)?;
                            for (state, held) in held {
                                after.extend(self.bind(state, element.pat, held)?);
                            }
                        }
                    }
                    states = after;
                }
                Some(states)
            }
            PatKind::Missing => Some(vec![state]),
        }
    }

    fn note_iteration(&mut self, state: &State, value: &Value) {
        let is_list = matches!(value, Value::Object(object) if state.objects[*object].is_list);
        if !is_list {
            self.note_possible_throw(state);
        }
    }

    fn declared_symbol(&self, pattern: PatId) -> Option<SymbolId> {
        let bound = self.follower.inputs.bound;
        let mut whole = pattern;
        let declaration = loop {
            match bound.pat_parent[whole.idx()] {
                PatParent::Param(_) => break Decl::Param(pattern),
                PatParent::Var(_) => break Decl::Var(pattern),
                PatParent::Prop(around, _) | PatParent::Elem(around, _) => whole = around,
                PatParent::None => return None,
            }
        };
        bound.declared_symbol(declaration).some()
    }

    fn or_default(&mut self, state: State, value: Value, default: ExprId) -> Ways<Value> {
        if let Value::OfEnvironment(written) = value {
            let mut ways = Vec::new();
            for (state, value) in self.evaluate(state, written)? {
                ways.extend(self.or_default(state, value, default)?);
            }
            return Some(ways);
        }
        match default.some() {
            Some(default) if value == undefined() => self.evaluate(state, default),
            Some(default) if value == Value::Unknown => {
                let mut ways = self.evaluate(state.clone(), default)?;
                ways.push((state, value));
                Some(ways)
            }
            _ => Some(vec![(state, value)]),
        }
    }

    fn evaluate_call(&mut self, state: State, e: ExprId, call: Call) -> Ways<Value> {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.follower.inputs;
        let callee = hir.skip_type_assertions(call.callee);
        if matches!(hir[callee].kind, ExprKind::Super) {
            return self.call_super(state, e, call);
        }
        if let Some(function) = self.follower.find_path_joining_function(callee) {
            let is_join = function != known::resolve;
            let ways = self.evaluate_all(state, hir.ids(call.args))?.into_iter();
            let joined = ways.map(|(state, parts)| {
                self.note_path_parts(&state, &parts);
                let value = self.join_path(&parts, is_join);
                (state, value)
            });
            return Some(joined.collect());
        }
        if let Some(function) = self.follower.find_export_of_path(callee)
            && atoms.bytes(function) == b"dirname"
            && call.args.len() == 1
        {
            let ways = self.evaluate_all(state, hir.ids(call.args))?.into_iter();
            let folders = ways.map(|(state, mut values)| {
                self.note_path_parts(&state, &values);
                values.push(Value::Held(Held::Text(Text::whole(b".."))));
                let value = self.join_path(&values, true);
                (state, value)
            });
            return Some(folders.collect());
        }
        if is_free_name(hir, bound, callee, &[known::eval]) {
            return None;
        }
        let member = hir.member_key(callee);
        if let Some((object, MemberKey::Name(name))) = member
            && atoms.bytes(name) == b"assign"
            && is_free_name(
                hir,
                bound,
                hir.skip_type_assertions(object),
                &[known::Object],
            )
        {
            return self.assign_objects(state, call);
        }
        let mut ways = Vec::new();
        let called: Vec<(State, Value, Value)> = match member {
            Some((object, key)) => {
                let mut called = Vec::new();
                for (state, receiver) in self.evaluate(state, object)? {
                    for (state, key) in self.evaluate_key(state, key)? {
                        if let (Value::Object(list), Some(key)) = (&receiver, &key)
                            && state.objects[*list].is_list
                        {
                            ways.extend(self.call_list_method(state, *list, key, call)?);
                            continue;
                        }
                        for (state, function) in self.read_field(state, &receiver, key)? {
                            called.push((state, function, receiver.clone()));
                        }
                    }
                }
                called
            }
            None => {
                let functions = self.evaluate(state, callee)?.into_iter();
                functions
                    .map(|(state, function)| (state, function, undefined()))
                    .collect()
            }
        };
        for (state, function, receiver) in called {
            let is_known = matches!(function, Value::Function(_));
            for (state, passed) in self.evaluate_each(state, hir.ids(call.args), !is_known)? {
                ways.extend(match function {
                    Value::Function(function) => {
                        self.call_function(state, function, receiver.clone(), &passed)?
                    }
                    _ => self.call_unknown(state, &receiver, &passed),
                });
            }
        }
        Some(ways)
    }

    fn call_unknown(
        &mut self,
        mut state: State,
        receiver: &Value,
        passed: &[Value],
    ) -> Vec<(State, Value)> {
        for value in passed.iter().chain([receiver]) {
            self.escape(&state, value);
            self.share(&mut state, value);
        }
        if let Some(around) = self.attempts.last_mut() {
            around.has_calls = true;
        }
        vec![(state, Value::Unknown)]
    }

    fn note_path_parts(&mut self, state: &State, parts: &[Value]) {
        let is_text = |part: &Value| {
            matches!(
                part,
                Value::Held(
                    Held::Text(_) | Held::Resolved(..) | Held::Primitive(Constant::String(_))
                )
            )
        };
        if !parts.iter().all(is_text) {
            self.note_possible_throw(state);
        }
    }

    fn join_path(&self, parts: &[Value], is_join: bool) -> Value {
        let parts: Vec<Value> = (parts.iter())
            .map(|it| with_text(self.follower, it))
            .collect();
        match join_whole_texts(&parts, is_join) {
            Some(path) => Value::Held(Held::Text(path)),
            None => Value::Unknown,
        }
    }

    fn assign_objects(&mut self, state: State, call: Call) -> Ways<Value> {
        let hir = self.follower.inputs.hir;
        let mut ways = Vec::new();
        for (mut state, passed) in self.evaluate_all(state, hir.ids(call.args))? {
            let Some(&Value::Object(target)) = passed.first() else {
                return None;
            };
            for source in &passed[1..] {
                match source {
                    Value::Object(source) => {
                        for (key, value) in state.objects[*source].fields.clone() {
                            self.set_field(&mut state, target, &key, value);
                        }
                    }
                    Value::Held(Held::Primitive(Constant::String(_))) => return None,
                    Value::Held(Held::Primitive(_)) => {}
                    _ => return None,
                }
            }
            ways.push((state, Value::Object(target)));
        }
        Some(ways)
    }

    fn call_list_method(
        &mut self,
        state: State,
        list: usize,
        method: &[u8],
        call: Call,
    ) -> Ways<Value> {
        let hir = self.follower.inputs.hir;
        let mut ways = Vec::new();
        for (mut state, passed) in self.evaluate_all(state, hir.ids(call.args))? {
            match (method, passed.first()) {
                (b"push", _) => {
                    self.note_change(list);
                    for value in passed {
                        let place = state.objects[list].fields.len();
                        let field = (place.to_string().into_bytes(), value);
                        state.object_mut(list).fields.push(field);
                    }
                    ways.push((state, Value::Unknown));
                }
                (b"forEach" | b"map", Some(&Value::Function(function))) => {
                    state.mark_read(list);
                    let items = state.objects[list].fields.clone();
                    let mut running = vec![(state, Vec::new())];
                    for (_, item) in items {
                        let mut after = Vec::new();
                        for (state, made) in running {
                            let passed = [item.clone(), Value::Unknown, Value::Object(list)];
                            let called =
                                self.call_function(state, function, undefined(), &passed)?;
                            for (state, value) in called {
                                let mut made = made.clone();
                                made.push(value);
                                after.push((state, made));
                            }
                        }
                        running = self.merge(after)?;
                        if running.len() > MOST_STATES {
                            return None;
                        }
                    }
                    for (mut state, made) in running {
                        let value = match method {
                            b"map" => state.add_object(list_of(made)),
                            _ => undefined(),
                        };
                        ways.push((state, value));
                    }
                }
                (
                    b"pop" | b"shift" | b"unshift" | b"splice" | b"sort" | b"reverse" | b"fill",
                    _,
                ) => {
                    return None;
                }
                _ => ways.extend(self.call_unknown(state, &Value::Object(list), &passed)),
            }
        }
        Some(ways)
    }

    fn call_function(
        &mut self,
        mut state: State,
        function: FnId,
        receiver: Value,
        passed: &[Value],
    ) -> Ways<Value> {
        let hir = self.follower.inputs.hir;
        let is_refused = hir[function]
            .flags
            .intersects(Flags::ASYNC | Flags::GENERATOR)
            || self.functions_running.contains(&function)
            || self.functions_running.len() >= DEEPEST_CALL;
        if is_refused {
            self.note_possible_throw(&state);
            self.escape(&state, &Value::Function(function));
            for value in passed.iter().chain([&receiver]) {
                self.escape(&state, value);
                self.share(&mut state, value);
            }
            return Some(vec![(state, Value::Unknown)]);
        }
        self.functions_run.insert(function);
        self.calls.push(function);
        self.functions_running.push(function);
        let is_arrow = hir[function].kind == crate::hir::FnKind::Arrow;
        if !is_arrow {
            self.receivers.push(receiver);
        }
        let mut states = vec![state];
        let mut is_followed = true;
        for (place, parameter) in hir[function].params.iter().enumerate() {
            let parameter = hir[parameter];
            let mut after = Vec::new();
            for mut state in std::mem::take(&mut states) {
                let value = match parameter.flags.contains(Flags::REST) {
                    true => {
                        let rest = passed.get(place..).unwrap_or_default().to_vec();
                        state.add_object(list_of(rest))
                    }
                    false => passed.get(place).cloned().unwrap_or_else(undefined),
                };
                let bound = self
                    .or_default(state, value, parameter.default)
                    .and_then(|ways| {
                        let mut states = Vec::new();
                        for (state, value) in ways {
                            states.extend(self.bind(state, parameter.pat, value)?);
                        }
                        Some(states)
                    });
                match bound {
                    Some(bound) => after.extend(bound),
                    None => is_followed = false,
                }
            }
            states = after;
        }
        let mut ways = Vec::new();
        for state in states {
            let ran = match hir[function].body {
                FnBody::Expr(value) => self.evaluate(state, value),
                FnBody::Block(statements) => self.run_list(state, statements).map(|ends| {
                    let returned = ends.into_iter().map(|(state, flow)| match flow {
                        Flow::Return(value) => (state, value),
                        _ => (state, undefined()),
                    });
                    returned.collect()
                }),
                FnBody::None => None,
            };
            match ran {
                Some(ran) => ways.extend(ran),
                None => is_followed = false,
            }
        }
        if !is_arrow {
            self.receivers.pop();
        }
        self.functions_running.pop();
        if self.follows_throws && !self.functions_around_code.contains(&function) {
            for (state, _) in &mut ways {
                self.forget_variables(state, function);
            }
        }
        match is_followed {
            true => self.merge(ways),
            false => None,
        }
    }

    fn forget_variables(&self, state: &mut State, function: FnId) {
        let bound = self.follower.inputs.bound;
        let is_own = |symbol: SymbolId| {
            bound.code_unit(bound.symbol_scope(symbol)) == CodeUnit::Function(function)
        };
        if state.variables.keys().any(|&it| is_own(it)) {
            Rc::make_mut(&mut state.variables).retain(|&it, _| !is_own(it));
        }
        state.constants.retain(|it| !is_own(it.0));
    }

    fn evaluate_new(&mut self, state: State, call: Call) -> Ways<Value> {
        let hir = self.follower.inputs.hir;
        let mut ways = Vec::new();
        for (state, callee) in self.evaluate(state, call.callee)? {
            let is_known = matches!(callee, Value::Class(_));
            for (mut state, passed) in self.evaluate_each(state, hir.ids(call.args), !is_known)? {
                let Value::Class(class) = callee else {
                    ways.extend(self.call_unknown(state, &undefined(), &passed));
                    continue;
                };
                let object = state.add_object(Object {
                    class: Some(class),
                    is_list: false,
                    is_shared: false,
                    is_read: false,
                    fields: Vec::new(),
                });
                ways.extend(self.construct(state, class, &object, &passed)?);
            }
        }
        Some(ways)
    }

    fn run_class(&mut self, state: State, class: ClassId) -> Option<Vec<State>> {
        let hir = self.follower.inputs.hir;
        let mut states = vec![state];
        if let Some(heritage) = hir[class].extends.some() {
            let ways = self.evaluate(states.pop()?, heritage)?;
            for (state, value) in &ways {
                if !matches!(value, Value::Class(_)) {
                    self.note_possible_throw(state);
                }
            }
            states = ways.into_iter().map(|it| it.0).collect();
        }
        for member in hir[class].members.iter().map(|id| hir[id]) {
            if member.kind == MemberKind::StaticBlock || matches!(member.key, PropKey::Computed(_))
            {
                return None;
            }
            let is_static = member.flags.contains(Flags::STATIC);
            if member.kind != MemberKind::Property || !is_static || member.init.is_none() {
                continue;
            }
            let mut after = Vec::new();
            for state in states {
                self.receivers.push(Value::Class(class));
                let ways = self.evaluate(state, member.init);
                self.receivers.pop();
                after.extend(ways?.into_iter().map(|it| it.0));
            }
            states = after;
        }
        Some(states)
    }

    fn construct(
        &mut self,
        state: State,
        class: ClassId,
        object: &Value,
        passed: &[Value],
    ) -> Ways<Value> {
        if self.functions_running.len() >= DEEPEST_CALL
            || self.constructions_running >= DEEPEST_CONSTRUCTION
        {
            return None;
        }
        self.constructions_running += 1;
        let made = self.run_construction(state, class, object, passed);
        self.constructions_running -= 1;
        made
    }

    fn run_construction(
        &mut self,
        state: State,
        class: ClassId,
        object: &Value,
        passed: &[Value],
    ) -> Ways<Value> {
        let hir = self.follower.inputs.hir;
        let mut members = hir[class].members.iter().map(|id| hir[id]);
        let constructor = members.find(|it| it.kind == MemberKind::Constructor);
        let extended = self.find_class_extended(class);
        if hir[class].extends.is_some() && extended.is_none() {
            return None;
        }
        let states = match (extended, constructor) {
            (Some(_), Some(_)) => vec![state],
            (Some(extended), None) => {
                let states = self.construct_parent(state, extended, object, passed)?;
                self.initialize_fields(states, class, object)?
            }
            (None, _) => self.initialize_fields(vec![state], class, object)?,
        };
        let Some(constructor) = constructor else {
            let made = states.into_iter().map(|it| (it, object.clone()));
            return Some(made.collect());
        };
        let mut made = Vec::new();
        for state in states {
            let ways = self.call_function(state, constructor.func, object.clone(), passed)?;
            made.extend(ways.into_iter().map(|(state, returned)| match returned {
                Value::Held(_) => (state, object.clone()),
                returned => (state, returned),
            }));
        }
        Some(made)
    }

    fn construct_parent(
        &mut self,
        state: State,
        class: ClassId,
        object: &Value,
        passed: &[Value],
    ) -> Option<Vec<State>> {
        let made = self.construct(state, class, object, passed)?;
        let kept = made
            .into_iter()
            .map(|(state, made)| (made == *object).then_some(state));
        kept.collect()
    }

    fn initialize_fields(
        &mut self,
        states: Vec<State>,
        class: ClassId,
        object: &Value,
    ) -> Option<Vec<State>> {
        let &ScanInputs { hir, atoms, .. } = self.follower.inputs;
        let Value::Object(id) = *object else {
            return None;
        };
        let mut states = states;
        for member in hir[class].members.iter().map(|id| hir[id]) {
            if member.kind != MemberKind::Property || member.flags.contains(Flags::STATIC) {
                continue;
            }
            let PropKey::Name(name) = member.key else {
                return None;
            };
            let key = atoms.bytes(name).to_vec();
            let mut after = Vec::new();
            for mut state in states {
                let Some(initial) = member.init.some() else {
                    self.set_field(&mut state, id, &key, undefined());
                    after.push(state);
                    continue;
                };
                self.receivers.push(object.clone());
                let ways = self.evaluate(state, initial);
                self.receivers.pop();
                for (mut state, value) in ways? {
                    self.set_field(&mut state, id, &key, value);
                    after.push(state);
                }
            }
            states = after;
        }
        Some(states)
    }

    fn call_super(&mut self, state: State, e: ExprId, call: Call) -> Ways<Value> {
        let &ScanInputs { hir, bound, .. } = self.follower.inputs;
        let bound_parent = self.follower.inputs.bound.parent_of_expr(e);
        let Around::Function(constructor) = self.find_around(bound_parent) else {
            return None;
        };
        let FnOwner::Member(member) = bound.fns[constructor.idx()].owner else {
            return None;
        };
        let MemberOwner::Class(class) = bound.member_owner[member.idx()] else {
            return None;
        };
        let object = self.receivers.last().cloned()?;
        let extended = self.find_class_extended(class)?;
        let mut ways = Vec::new();
        for (state, passed) in self.evaluate_all(state, hir.ids(call.args))? {
            let states = self.construct_parent(state, extended, &object, &passed)?;
            for state in self.initialize_fields(states, class, &object)? {
                ways.push((state, undefined()));
            }
        }
        Some(ways)
    }
}

fn with_text(follower: &Follower<'_, '_, '_>, value: &Value) -> Value {
    match value {
        &Value::Held(Held::Primitive(text @ Constant::String(_))) => {
            Value::Held(follower.held_constant(text))
        }
        value => value.clone(),
    }
}

fn join_whole_texts(parts: &[Value], is_join: bool) -> Option<Text> {
    let mut path = PathBelowFolder::default();
    let mut starts_at_own_directory = false;
    for (place, part) in parts.iter().enumerate() {
        let Value::Held(Held::Text(text)) = part else {
            return None;
        };
        if text.end.is_some() || text.is_file_url || place > 0 && text.starts_at_own_directory {
            return None;
        }
        if place == 0 {
            starts_at_own_directory = text.starts_at_own_directory;
            if !starts_at_own_directory && (!is_join || text.start.starts_with(b"/")) {
                return None;
            }
        }
        path.push(&text.start, is_join || place == 0)?;
    }
    let written = path.write(PathEnd {
        is_join,
        is_followed: false,
    });
    let start = match (starts_at_own_directory, written.strip_prefix(b"/")) {
        (true, _) => [b".", &written[..]].concat(),
        (false, Some(below)) => below.to_vec(),
        (false, None) => b".".to_vec(),
    };
    Some(Text {
        starts_at_own_directory,
        ..Text::whole(&start)
    })
}

fn list_of(values: Vec<Value>) -> Object {
    let places = (0..values.len()).map(|it| it.to_string().into_bytes());
    Object {
        class: None,
        is_list: true,
        is_shared: false,
        is_read: false,
        fields: places.zip(values).collect(),
    }
}
