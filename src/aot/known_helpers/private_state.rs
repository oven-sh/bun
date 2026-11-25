use super::find_by_key;
use super::quiet::{has_fixed_binding, is_global_name, plain_member};
use super::resolve::{
    PrivateFieldAccess, PrivateStateKind, PrivateStateRole, PrivateStateSite, ResolveInput,
    resolve_private_field_call,
};
use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, Mutability};
use crate::modules::ExportBinding;
use bun_sema::bind::{
    Binding, BindingInitializer, BindingKind, BindingStability, Bound, CodeUnit, FnOwner, Parent,
    StoreKind, SymbolId,
};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::fold::{Decision, Decisions};
use bun_sema::hir::{
    self, BinOp, Call, Chain, ClassId, ExprId, ExprKind, Flags, FnId, FnKind, NodeData, PatKind,
    StmtKind, UnOp,
};
use bun_sema::program::FileId;
use bun_sema::util::SharedSort;
use smallvec::SmallVec;

const METHODS_OF_COLLECTIONS: [BuiltinId; 6] = [
    BuiltinId::WeakSet,
    BuiltinId::WeakMapPrototypeGet,
    BuiltinId::WeakMapPrototypeHas,
    BuiltinId::WeakMapPrototypeSet,
    BuiltinId::WeakSetPrototypeAdd,
    BuiltinId::WeakSetPrototypeHas,
];

pub(super) fn replaces_method_of_collections(replaced: &[u32]) -> bool {
    let is_listed = |id: BuiltinId| replaced.binary_search(&(id as u32)).is_ok();
    let mut methods = METHODS_OF_COLLECTIONS.iter();
    methods.any(|&method| is_listed(table::canonical_id(method)) || is_listed(method))
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum StateOwner {
    Class(ClassId),
    Function(FnId),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct PrivateState {
    pub symbol: SymbolId,
    pub kind: PrivateStateKind,
    pub owner: StateOwner,
    pub creation: ExprId,
}

#[derive(Default)]
pub struct FilePrivateStates {
    states: Box<[PrivateState]>,
    by_symbol: Box<[(SymbolId, u32)]>,
    by_creation: Box<[(ExprId, u32)]>,
    sites: Box<[(ExprId, PrivateStateSite)]>,
}

impl FilePrivateStates {
    #[inline]
    pub fn site(&self, call: ExprId) -> Option<PrivateStateSite> {
        if self.sites.is_empty() {
            return None;
        }
        find_by_key(&self.sites, call).copied()
    }

    pub fn state(&self, symbol: SymbolId) -> Option<PrivateState> {
        Some(self.states[*find_by_key(&self.by_symbol, symbol)? as usize])
    }

    pub fn created_by(&self, creation: ExprId) -> Option<PrivateState> {
        Some(self.states[*find_by_key(&self.by_creation, creation)? as usize])
    }

    pub fn states_of_owner(&self, owner: StateOwner) -> &[PrivateState] {
        let start = self.states.partition_point(|state| state.owner < owner);
        let count = self.states[start..].partition_point(|state| state.owner == owner);
        &self.states[start..start + count]
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Owner {
    Unknown,
    One(StateOwner),
    Several,
}

struct Candidate {
    symbol: SymbolId,
    kind: PrivateStateKind,
    creation: ExprId,
    stored_name: Option<ExprId>,
    owner: Owner,
    sites: SmallVec<[(ExprId, PrivateStateRole); 8]>,
    has_other_mention: bool,
}

struct Finder<'a, 'i, 's> {
    input: &'a ResolveInput<'i, 's>,
    file: FileId,
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    decisions: &'a Decisions<'s>,
    candidates: Vec<Candidate>,
}

pub(super) fn find_in_file(input: &ResolveInput<'_, '_>, file: FileId) -> FilePrivateStates {
    let Some(compiled) = input.files.compiled(file) else {
        return FilePrivateStates::default();
    };
    let mut methods = METHODS_OF_COLLECTIONS.iter();
    let is_locked = |&method| table::entry(method).mutability == Mutability::AlwaysLocked;
    if !input.modules.has_record(file) || !methods.all(is_locked) {
        return FilePrivateStates::default();
    }
    let mut finder = Finder {
        input,
        file,
        hir: input.files.hir(file),
        bound: input.files.bound(file),
        decisions: &compiled.analysis.decisions,
        candidates: Vec::new(),
    };
    let mut candidates = Vec::new();
    for (index, expression) in finder.hir.exprs.iter().enumerate() {
        if matches!(expression.kind, ExprKind::New(_))
            && let Some(candidate) = finder.find_candidate(ExprId(index as u32))
        {
            candidates.push(candidate);
        }
    }
    finder.candidates = candidates;
    finder
        .candidates
        .shared_sort_unstable_by_key(|candidate| candidate.symbol);
    if finder.candidates.is_empty() {
        return FilePrivateStates::default();
    }
    finder.classify_mentions(&compiled.analysis);
    finder.finish()
}

impl Finder<'_, '_, '_> {
    fn find_candidate(&self, creation: ExprId) -> Option<Candidate> {
        let ExprKind::New(site) = self.hir[creation].kind else {
            return None;
        };
        if self.decisions.is_dead_expr(creation) {
            return None;
        }
        let kind = self.find_created_kind(self.hir[site])?;
        let (symbol, stored_name) = self.find_holder(creation)?;
        let is_only_value = self.is_only_value(symbol, creation, stored_name);
        (is_only_value && !self.is_exported(symbol)).then(|| Candidate {
            symbol,
            kind,
            creation,
            stored_name,
            owner: Owner::Unknown,
            sites: SmallVec::new(),
            has_other_mention: false,
        })
    }

    fn find_created_kind(&self, site: Call) -> Option<PrivateStateKind> {
        let ExprKind::Ident(name) = self.hir[site.callee].kind else {
            return None;
        };
        if !site.args.is_empty()
            || !is_global_name(self.bound, site.callee)
            || self.decisions.decision(site.callee) != Decision::Unknown
        {
            return None;
        }
        let name = table::find_name(self.input.files.atoms.bytes(name))?;
        match table::global(name)? {
            BuiltinId::WeakMap => Some(PrivateStateKind::Field),
            BuiltinId::WeakSet => Some(PrivateStateKind::Brand),
            _ => None,
        }
    }

    fn is_value_unused(&self, expression: ExprId) -> bool {
        let hir = self.hir;
        let mut child = expression;
        loop {
            let parent = match self.bound.parent_of_expr(child) {
                Parent::Expr(parent) => parent,
                Parent::Stmt(statement) => {
                    return matches!(hir[statement].kind, StmtKind::Expr(_));
                }
                _ => return false,
            };
            match hir[parent].kind {
                ExprKind::Binary {
                    op: BinOp::Comma,
                    left,
                    ..
                } if left == child => return true,
                ExprKind::Binary {
                    op: BinOp::Comma, ..
                } => child = parent,
                ExprKind::Unary { op: UnOp::Void, .. } => return true,
                _ => return false,
            }
        }
    }

    /// In a statement of the file, or of a function that is called in place there or handed to one.
    fn runs_once(&self, expression: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut expression = expression;
        loop {
            let Some(statement) = bound.statement_of_expr(expression) else {
                return false;
            };
            let function = match bound.parent_of_stmt(statement) {
                Parent::File => return true,
                Parent::FnBody(function) => function,
                _ => return false,
            };
            if self.is_body_of_module(function) {
                return true;
            }
            let FnOwner::Expr(written) = bound.fns[function.idx()].owner else {
                return false;
            };
            let mut callee = written;
            while let Parent::Expr(parent) = bound.parent_of_expr(callee)
                && hir.type_assertion_operand(parent) == Some(callee)
            {
                callee = parent;
            }
            let Parent::Expr(call) = bound.parent_of_expr(callee) else {
                return false;
            };
            let ExprKind::Call(site) = hir[call].kind else {
                return false;
            };
            let called = hir.skip_type_assertions(hir[site].callee);
            if called != written && !matches!(hir[called].kind, ExprKind::Fn(_)) {
                return false;
            }
            expression = call;
        }
    }

    fn is_body_of_module(&self, function: FnId) -> bool {
        let wrapped = self.input.modules.wrapped();
        wrapped.of_callback(self.file, function).is_some()
    }

    fn find_holder(&self, creation: ExprId) -> Option<(SymbolId, Option<ExprId>)> {
        let (hir, bound) = (self.hir, self.bound);
        if !self.runs_once(creation) {
            return None;
        }
        match bound.parent_of_expr(creation) {
            Parent::VarInit(declaration) => {
                let name = hir[declaration].pat;
                let is_name = matches!(hir[name].kind, PatKind::Ident(_))
                    && bound.dynamic_lookup_scope(NodeData::Pat(name)).is_none();
                match bound.initialized_binding(name) {
                    Binding::Symbol(symbol) if is_name => Some((symbol, None)),
                    _ => None,
                }
            }
            Parent::Expr(assignment) => {
                let ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } = hir[assignment].kind
                else {
                    return None;
                };
                let is_name = matches!(hir[target].kind, ExprKind::Ident(_))
                    && bound.dynamic_lookup_scope(NodeData::Expr(target)).is_none();
                if value != creation || !is_name || !self.is_value_unused(assignment) {
                    return None;
                }
                match bound.binding(target) {
                    Binding::Symbol(symbol) => Some((symbol, Some(target))),
                    Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
                }
            }
            _ => None,
        }
    }

    fn is_only_value(
        &self,
        symbol: SymbolId,
        creation: ExprId,
        stored_name: Option<ExprId>,
    ) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let is_variable = matches!(
            bound.binding_kind(symbol),
            BindingKind::Var | BindingKind::Let | BindingKind::Const
        );
        let recorded = bound.binding_stability_ignoring(symbol, &|_| true);
        if !is_variable || recorded != BindingStability::Stable || bound.is_visible_to_eval(symbol)
        {
            return false;
        }
        let stores = bound.stores_to(symbol).iter();
        let mut live = stores.filter(|store| !self.decisions.is_dead_expr(store.target));
        let initializer = bound.binding_initializer(hir, symbol);
        match stored_name {
            None => {
                live.next().is_none() && initializer == BindingInitializer::Expression(creation)
            }
            Some(name) => {
                let (Some(store), None) = (live.next(), live.next()) else {
                    return false;
                };
                store.target == name
                    && store.kind == StoreKind::Assign
                    && initializer == BindingInitializer::Opaque
            }
        }
    }

    fn is_exported(&self, symbol: SymbolId) -> bool {
        let mut exports = self.input.modules.exports(self.file).iter();
        exports.any(|export| match export.binding {
            ExportBinding::Variable(variable) => {
                variable.file == self.file && variable.id == symbol
            }
            _ => false,
        })
    }

    fn classify_mentions(&mut self, analysis: &FileAnalysis<'_>) {
        for index in 0..self.hir.exprs.len() as u32 {
            let mention = ExprId(index);
            if !matches!(self.hir[mention].kind, ExprKind::Ident(_))
                || !self.bound.is_evaluated_ident(mention)
                || self.decisions.is_dead_expr(mention)
            {
                continue;
            }
            let Binding::Symbol(symbol) = self.bound.binding(mention) else {
                continue;
            };
            let candidates = &self.candidates;
            if let Ok(candidate) = candidates.binary_search_by_key(&symbol, |it| it.symbol) {
                self.classify_mention(candidate, mention);
            }
        }
        for binding in analysis.bindings_read_without_expression(self.hir, self.bound) {
            let candidates = &mut self.candidates;
            if let Binding::Symbol(symbol) = binding
                && let Ok(candidate) = candidates.binary_search_by_key(&symbol, |it| it.symbol)
            {
                candidates[candidate].has_other_mention = true;
            }
        }
    }

    fn classify_mention(&mut self, candidate: usize, mention: ExprId) {
        let kind = self.candidates[candidate].kind;
        if self.candidates[candidate].stored_name == Some(mention) {
            return;
        }
        let is_looked_up = !has_fixed_binding(self.bound, mention);
        let found = self.find_site(mention, kind);
        let site = found.map(|(call, role, _)| (call, role));
        let defined = found.and_then(|(_, _, defined)| defined);
        let constructed = defined.and_then(|object| self.find_constructed_owner(object));
        let candidate = &mut self.candidates[candidate];
        let Some(site) = site.filter(|_| !is_looked_up) else {
            candidate.has_other_mention = true;
            return;
        };
        candidate.sites.push(site);
        if let Some(found) = constructed {
            candidate.owner = match candidate.owner {
                Owner::Unknown => Owner::One(found),
                Owner::One(owner) if owner == found => Owner::One(found),
                Owner::One(_) | Owner::Several => Owner::Several,
            };
        }
    }

    /// The call that names the state, and the object to which it adds the state.
    fn find_site(
        &self,
        mention: ExprId,
        kind: PrivateStateKind,
    ) -> Option<(ExprId, PrivateStateRole, Option<ExprId>)> {
        let hir = self.hir;
        if let Some((call, role)) = self.find_method_call(mention, kind) {
            let ExprKind::Call(site) = hir[call].kind else {
                return None;
            };
            let object = hir.ids(hir[site].args).next();
            let defined = object.filter(|_| role == PrivateStateRole::Definition);
            return Some((call, role, defined));
        }
        self.find_helper_call(mention, kind)
    }

    fn find_method_call(
        &self,
        mention: ExprId,
        kind: PrivateStateKind,
    ) -> Option<(ExprId, PrivateStateRole)> {
        let (hir, bound) = (self.hir, self.bound);
        let Parent::Expr(method) = bound.parent_of_expr(mention) else {
            return None;
        };
        let (object, name) = plain_member(hir, method)?;
        let Parent::Expr(call) = bound.parent_of_expr(method) else {
            return None;
        };
        let ExprKind::Call(site) = hir[call].kind else {
            return None;
        };
        let site = hir[site];
        let (defining_method, argument_count) = match kind {
            PrivateStateKind::Field => (BuiltinId::WeakMapPrototypeSet, 2),
            PrivateStateKind::Brand => (BuiltinId::WeakSetPrototypeAdd, 1),
        };
        let name = table::find_name(self.input.files.atoms.bytes(name))?;
        let mut arguments = hir.ids(site.args);
        let is_plain_call = object == mention
            && site.callee == method
            && matches!(site.chain, Chain::No)
            && !arguments.any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_)));
        if !is_plain_call {
            return None;
        }
        if name == table::entry(BuiltinId::WeakMapPrototypeHas).name {
            return (site.args.len() == 1).then_some((call, PrivateStateRole::Test));
        }
        let is_definition = name == table::entry(defining_method).name
            && site.args.len() == argument_count
            && self.is_value_unused(call);
        is_definition.then_some((call, PrivateStateRole::Definition))
    }

    fn find_helper_call(
        &self,
        mention: ExprId,
        kind: PrivateStateKind,
    ) -> Option<(ExprId, PrivateStateRole, Option<ExprId>)> {
        let hir = self.hir;
        let Parent::Expr(call) = self.bound.parent_of_expr(mention) else {
            return None;
        };
        let ExprKind::Call(site) = hir[call].kind else {
            return None;
        };
        let helper_call = resolve_private_field_call(self.input, self.file, call)?;
        let argument = |index: usize| hir.ids(hir[site].args).nth(index);
        if !helper_call.supports_private_state(kind) || argument(helper_call.state) != Some(mention)
        {
            return None;
        }
        match helper_call.access(kind)? {
            PrivateFieldAccess::Add { .. } => {
                let defined = argument(helper_call.receiver);
                Some((call, PrivateStateRole::HelperArgument, defined))
            }
            PrivateFieldAccess::Update => {
                let is_stepped = self.is_stepped_member(call);
                is_stepped.then_some((call, PrivateStateRole::Update, None))
            }
            _ => Some((call, PrivateStateRole::HelperArgument, None)),
        }
    }

    /// `call._++`
    fn is_stepped_member(&self, call: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let Parent::Expr(member) = bound.parent_of_expr(call) else {
            return false;
        };
        let Some((object, name)) = plain_member(hir, member) else {
            return false;
        };
        let Parent::Expr(update) = bound.parent_of_expr(member) else {
            return false;
        };
        object == call
            && self.input.files.atoms.bytes(name) == b"_"
            && matches!(
                hir[update].kind,
                ExprKind::Unary {
                    op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                    ..
                }
            )
    }

    fn enclosing_function(&self, expression: ExprId) -> Option<FnId> {
        let bound = self.bound;
        let mut parent = bound.parent_of_expr(expression);
        loop {
            parent = match parent {
                Parent::Expr(expression) => bound.parent_of_expr(expression),
                Parent::Stmt(statement) if statement.is_some() => bound.parent_of_stmt(statement),
                Parent::VarInit(declaration) => Parent::Stmt(bound.var_stmt[declaration.idx()]),
                Parent::FnBody(function) => return Some(function),
                _ => return None,
            };
        }
    }

    fn can_own_states(&self, owner: StateOwner) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let StateOwner::Class(class) = owner else {
            return true;
        };
        let mut members = hir[class].members.iter();
        !hir[class].flags.contains(Flags::AMBIENT)
            && bound.private_names_of_class(class).len() == 0
            && !members.any(|member| hir[member].flags.contains(Flags::ACCESSOR))
    }

    /// The class or the function that adds state to `this`, or to the variable that holds its result of `super`.
    fn find_constructed_owner(&self, object: ExprId) -> Option<StateOwner> {
        let (hir, bound) = (self.hir, self.bound);
        let function = self.enclosing_function(object)?;
        let is_this = match hir[object].kind {
            ExprKind::This => true,
            ExprKind::Ident(_) => match bound.binding(object) {
                Binding::Symbol(symbol) => {
                    let scope = bound.symbol_scope(symbol);
                    let is_variable = bound.binding_kind(symbol) == BindingKind::Var;
                    if !is_variable || bound.code_unit(scope) != CodeUnit::Function(function) {
                        return None;
                    }
                    false
                }
                _ => return None,
            },
            _ => return None,
        };
        match hir.runtime_function_kind(function) {
            FnKind::Constructor if is_this => bound.function_class(function).map(StateOwner::Class),
            FnKind::Decl | FnKind::Expr => Some(StateOwner::Function(function)),
            _ => None,
        }
    }

    fn finish(self) -> FilePrivateStates {
        let mut accepted: Vec<(StateOwner, &Candidate)> = Vec::new();
        for candidate in &self.candidates {
            if let Owner::One(owner) = candidate.owner
                && !candidate.has_other_mention
                && self.can_own_states(owner)
            {
                accepted.push((owner, candidate));
            }
        }
        accepted.shared_sort_unstable_by_key(|&(owner, candidate)| (owner, candidate.symbol));
        let mut states: Vec<PrivateState> = Vec::new();
        let mut sites: Vec<(ExprId, PrivateStateSite)> = Vec::new();
        for (owner, candidate) in accepted {
            states.push(PrivateState {
                symbol: candidate.symbol,
                kind: candidate.kind,
                owner,
                creation: candidate.creation,
            });
            sites.extend(candidate.sites.iter().map(|&(call, role)| {
                let site = PrivateStateSite {
                    state: candidate.symbol,
                    kind: candidate.kind,
                    role,
                };
                (call, site)
            }));
        }
        let indexed = || (0..).zip(&states);
        let mut by_symbol: Vec<(SymbolId, u32)> = indexed()
            .map(|(index, state)| (state.symbol, index))
            .collect();
        let mut by_creation: Vec<(ExprId, u32)> = indexed()
            .map(|(index, state)| (state.creation, index))
            .collect();
        by_symbol.shared_sort_unstable();
        by_creation.shared_sort_unstable();
        sites.shared_sort_unstable_by_key(|site| site.0);
        FilePrivateStates {
            by_symbol: by_symbol.into_boxed_slice(),
            by_creation: by_creation.into_boxed_slice(),
            sites: sites.into_boxed_slice(),
            states: states.into_boxed_slice(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::run_serially;
    use crate::known_helpers::KnownHelpers;
    use crate::modules::testing::{file_named, with_graph};

    const HELPERS: &str = r#"export function __classPrivateFieldGet(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
export function __classPrivateFieldSet(receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
}
export function __classPrivateFieldIn(state, receiver) {
    if (receiver === null || (typeof receiver !== "object" && typeof receiver !== "function")) throw new TypeError("Cannot use 'in' operator on non-object");
    return typeof state === "function" ? receiver === state : state.has(receiver);
}
"#;

    const IMPORT: &str = "import { __classPrivateFieldGet, __classPrivateFieldSet, __classPrivateFieldIn } from \"./helpers.mjs\";\n";

    const COUNTER: &str = r#"var _Counter_x, _Counter_instances, _Counter_step;
class Counter {
    constructor() {
        _Counter_instances.add(this);
        _Counter_x.set(this, 1);
    }
    read() { return __classPrivateFieldGet(this, _Counter_x, "f"); }
    write(v) { __classPrivateFieldSet(this, _Counter_x, v, "f"); }
    step() { return __classPrivateFieldGet(this, _Counter_instances, "m", _Counter_step).call(this); }
    static is(o) { return __classPrivateFieldIn(_Counter_x, o); }
}
_Counter_x = new WeakMap(), _Counter_instances = new WeakSet(), _Counter_step = function _Counter_step() { return 1; };
"#;

    fn describe_states(name: &str, main: &str) -> Vec<String> {
        let main = format!("{IMPORT}{main}");
        let files = [(name, main.as_str()), ("helpers.mjs", HELPERS)];
        with_graph(&files, |graph, bind_input| {
            let files = bind_input.files;
            let helpers = KnownHelpers::compute(files, &run_serially);
            let file = file_named(bind_input, name);
            let states = helpers.private_states(files, graph, file);
            let states = states.expect("the program has a helper that reads private state");
            let bound = files.bound(file);
            let described = states.states.iter().map(|state| {
                let text = files.atoms.bytes(bound.symbol(state.symbol).name);
                let sites = states
                    .sites
                    .iter()
                    .filter(|site| site.1.state == state.symbol);
                let text = String::from_utf8_lossy(text);
                format!("{text} {:?} {}", state.kind, sites.count())
            });
            described.collect()
        })
    }

    const BABEL_HELPERS: &str = r#"function _checkPrivateRedeclaration(e, t) { if (t.has(e)) throw new TypeError("Cannot initialize the same private elements twice on an object"); }
function _classPrivateFieldInitSpec(e, t, a) { _checkPrivateRedeclaration(e, t), t.set(e, a); }
function _classPrivateMethodInitSpec(e, a) { _checkPrivateRedeclaration(e, a), a.add(e); }
function _assertClassBrand(e, t, n) { if ("function" == typeof e ? e === t : e.has(t)) return arguments.length < 3 ? t : n; throw new TypeError("Private element is not present on this object"); }
function _classPrivateFieldGet2(s, a) { return s.get(_assertClassBrand(s, a)); }
function _classPrivateFieldSet2(s, a, r) { return s.set(_assertClassBrand(s, a), r), r; }
function _classPrivateGetter(s, r, a) { return a(_assertClassBrand(s, r)); }
function _classPrivateSetter(s, r, a, t) { return r(_assertClassBrand(s, a), t), t; }
"#;

    const ESBUILD_HELPERS: &str = r#"var __typeError = (msg) => { throw TypeError(msg); };
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateIn = (member, obj) => Object(obj) !== obj ? __typeError('Cannot use the "in" operator on this value') : member.has(obj);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var __privateWrapper = (obj, member, setter, getter) => ({ set _(value) { __privateSet(obj, member, value, setter); }, get _() { return __privateGet(obj, member, getter); } });
"#;

    #[test]
    fn the_collections_that_babel_writes_are_private_state() {
        let class = r#"var _x = new WeakMap();
var _brand = new WeakSet();
class C {
    constructor() { _classPrivateMethodInitSpec(this, _brand); _classPrivateFieldInitSpec(this, _x, 0); }
    read() { return _classPrivateFieldGet2(_x, this); }
    write(v) { _classPrivateFieldSet2(_x, this, v); }
    run() { return _assertClassBrand(_brand, this, step).call(this); }
    get y() { return _classPrivateGetter(_brand, this, read); }
    set y(v) { _classPrivateSetter(_brand, write, this, v); }
    static is(o) { return _x.has(o); }
}
function step() {}
function read(o) { return o; }
function write(o, v) { return o === v; }
"#;
        let main = format!("{BABEL_HELPERS}{class}");
        let expected = ["_x Field 4", "_brand Brand 4"];
        assert_eq!(describe_states("main.mjs", &main), expected);
        let replaced = format!("{main}_assertClassBrand = null;");
        assert!(describe_states("main.mjs", &replaced).is_empty());
    }

    #[test]
    fn the_collections_that_esbuild_writes_are_private_state() {
        let class = r#"var _x, _brand, step, read, write;
class C {
    constructor() { __privateAdd(this, _brand); __privateAdd(this, _x, 0); }
    read() { return __privateGet(this, _x); }
    write(v) { __privateSet(this, _x, v); }
    run() { return __privateMethod(this, _brand, step).call(this); }
    get y() { return __privateGet(this, _brand, read); }
    set y(v) { __privateSet(this, _brand, v, write); }
    static is(o) { return __privateIn(_x, o); }
    step() { __privateWrapper(this, _x)._++; return --__privateWrapper(this, _x)._; }
}
_x = new WeakMap();
_brand = new WeakSet();
step = function() {};
read = function() { return this; };
write = function(v) { return v; };
"#;
        let main = format!("{ESBUILD_HELPERS}{class}");
        let expected = ["_x Field 6", "_brand Brand 4"];
        let passed = format!("{main}function pass(o) {{ return __privateWrapper(o, _x); }}");
        assert_eq!(describe_states("main.mjs", &passed), ["_brand Brand 4"]);
        assert_eq!(describe_states("main.mjs", &main), expected);
        let replaced = format!("{main}__accessCheck = null;");
        assert!(describe_states("main.mjs", &replaced).is_empty());
    }

    fn describe_counter_with(more: &str) -> Vec<String> {
        describe_states("main.mjs", &format!("{COUNTER}{more}"))
    }

    #[test]
    fn the_collections_of_a_class_are_its_private_state() {
        let expected = ["_Counter_x Field 4", "_Counter_instances Brand 2"];
        assert_eq!(describe_counter_with(""), expected);
    }

    #[test]
    fn a_variable_with_an_initializer_is_private_state() {
        let main = "var _x = new WeakMap();\nclass C { constructor() { _x.set(this, 1); } read() { return __classPrivateFieldGet(this, _x, \"f\"); } }";
        assert_eq!(describe_states("main.mjs", main), ["_x Field 2"]);
    }

    #[test]
    fn the_class_finds_its_states() {
        let main = format!("{IMPORT}{COUNTER}");
        let files = [("main.mjs", main.as_str()), ("helpers.mjs", HELPERS)];
        with_graph(&files, |graph, bind_input| {
            let files = bind_input.files;
            let helpers = KnownHelpers::compute(files, &run_serially);
            let file = file_named(bind_input, "main.mjs");
            let states = helpers
                .private_states(files, graph, file)
                .expect("analyzed");
            let of_class = states.states_of_owner(StateOwner::Class(ClassId(0)));
            assert_eq!(of_class.len(), 2);
            let other = StateOwner::Class(ClassId(1));
            assert!(states.states_of_owner(other).is_empty());
            for state in of_class {
                assert_eq!(states.state(state.symbol), Some(*state));
                assert_eq!(states.created_by(state.creation), Some(*state));
            }
        });
    }

    #[test]
    fn a_collection_that_something_else_can_reach_stays_a_collection() {
        let brand = ["_Counter_instances Brand 2"];
        for more in [
            "console.log(_Counter_x);",
            "_Counter_x.get({});",
            "_Counter_x.has();",
            "_Counter_x.has({}, 1);",
            "_Counter_x?.has({});",
            "_Counter_x.delete({});",
            "const same = _Counter_x.set({}, 1);",
            "_Counter_x?.set({}, 1);",
            "_Counter_x.set({});",
            "_Counter_x.set({}, 1, 2);",
            "_Counter_x.set(...[{}, 1]);",
            "_Counter_x.set(_Counter_x, 1);",
            "_Counter_x = new WeakMap();",
            "_Counter_x = null;",
            "export { _Counter_x };",
            "const holder = { _Counter_x };",
            "__classPrivateFieldGet(_Counter_x, _Counter_x, \"f\");",
            "__classPrivateFieldGet({}, _Counter_x, \"a\", Math.max);",
            "__classPrivateFieldGet({}, _Counter_x, Math.max());",
            "__classPrivateFieldGet(...[{}], _Counter_x, \"f\");",
            "Math.max(_Counter_x);",
        ] {
            assert_eq!(describe_counter_with(more), brand, "{more}");
        }
    }

    #[test]
    fn a_collection_that_is_read_where_no_expression_spells_it_stays_a_collection() {
        let brand = ["_Counter_instances Brand 2"];
        let classic = "/** @jsxRuntime classic */\n";
        for (name, head, more) in [
            ("main.jsx", "/** @jsx _Counter_x.get */\n", "<a />;"),
            (
                "main.jsx",
                "/** @jsx pick */\n/** @jsxFrag _Counter_x */\n",
                "function pick(tag) { return tag; }\n<></>;",
            ),
            ("main.ts", "", "import entries = _Counter_x;\nentries;"),
        ] {
            let main = format!("{classic}{head}{COUNTER}{more}");
            assert_eq!(describe_states(name, &main), brand, "{head}{more}");
        }
        let expected = ["_Counter_x Field 4", "_Counter_instances Brand 2"];
        let main = format!(
            "{classic}/** @jsx pick */\n{COUNTER}function pick(tag) {{ return tag; }}\n<a />;"
        );
        assert_eq!(describe_states("main.jsx", &main), expected);
    }

    #[test]
    fn a_constant_that_evaluated_text_can_read_stays_a_collection() {
        let class = "class C { constructor() { _x.set(this, 1); } read() { return __classPrivateFieldGet(this, _x, \"f\"); } }";
        for keyword in ["const", "let", "var"] {
            let main = format!("{keyword} _x = new WeakMap();\n{class}");
            assert_eq!(
                describe_states("main.mjs", &main),
                ["_x Field 2"],
                "{keyword}"
            );
            let main = format!("{main}\nfunction peek(text) {{ return eval(text); }}");
            assert!(describe_states("main.mjs", &main).is_empty(), "{keyword}");
        }
    }

    #[test]
    fn more_entries_and_more_uses_keep_the_state() {
        let expected = ["_Counter_x Field 5", "_Counter_instances Brand 2"];
        for more in [
            "_Counter_x.set({}, 1);",
            "_Counter_x[\"set\"]({}, 1);",
            "void _Counter_x.set({}, 1);",
            "_Counter_x.set({}, 1), Math.max();",
            "_Counter_x.has({});",
            "function outside(o) { return __classPrivateFieldGet(o, _Counter_x, \"f\"); }",
        ] {
            assert_eq!(describe_counter_with(more), expected, "{more}");
        }
    }

    #[test]
    fn a_collection_without_a_class_of_its_own_stays_a_collection() {
        for main in [
            "var _x = new WeakMap();\n_x.set({}, 1);",
            "var _x = new WeakMap();\nfunction C() { (() => _x.set({}, 1))(); }",
            "var _x = new WeakMap();\nfunction C() { _x.set(this, 1); }\nfunction D() { _x.set(this, 1); }",
            "var _x = new WeakMap();\nclass C { touch() { _x.set(this, 1); } }",
            "var _x = new WeakMap();\nclass C { constructor() { (() => _x.set({}, 1))(); } }",
            "var _x = new WeakMap();\nclass C { constructor() { _x.set(this, 1); } }\nclass D { constructor() { _x.set(this, 1); } }",
            "var _x = new WeakMap();\nclass C { #y = 1; constructor() { _x.set(this, 1); } }",
            "var _x = new WeakMap([]);\nclass C { constructor() { _x.set(this, 1); } }",
            "var _x = new Map();\nclass C { constructor() { _x.set(this, 1); } }",
            "var WeakMap = Map;\nvar _x = new WeakMap();\nclass C { constructor() { _x.set(this, 1); } }",
        ] {
            assert!(describe_states("main.mjs", main).is_empty(), "{main}");
        }
    }

    #[test]
    fn a_collection_that_is_made_again_and_again_stays_a_collection() {
        for main in [
            "function make() { var _x = new WeakMap(); return class C { constructor() { _x.set(this, 1); } }; }",
            "for (const i of [1, 2]) { var _x = new WeakMap(); class C { constructor() { _x.set(this, 1); } } }",
            "var _x;\nclass C { constructor() { _x.set(this, 1); } }\nfunction start() { _x = new WeakMap(); }",
        ] {
            assert!(describe_states("main.mjs", main).is_empty(), "{main}");
        }
    }

    #[test]
    fn a_replaced_method_keeps_every_entry_in_its_collection() {
        let main = format!("{IMPORT}{COUNTER}");
        let files = [("main.mjs", main.as_str()), ("helpers.mjs", HELPERS)];
        with_graph(&files, |graph, bind_input| {
            let files = bind_input.files;
            let file = file_named(bind_input, "main.mjs");
            let mut helpers = KnownHelpers::compute(files, &run_serially);
            helpers.keep_private_states_in_collections(&[BuiltinId::ObjectDefineProperty as u32]);
            assert!(helpers.private_states(files, graph, file).is_some());
            helpers.keep_private_states_in_collections(&[BuiltinId::WeakSetPrototypeHas as u32]);
            assert!(helpers.private_states(files, graph, file).is_none());
        });
    }
}
