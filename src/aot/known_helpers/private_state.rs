use super::find_by_key;
use super::quiet::{has_fixed_binding, is_global_name, is_in_statement_of_file, plain_member};
use super::resolve::{
    PrivateStateKind, PrivateStateRole, PrivateStateSite, ResolveInput, resolve_private_field_call,
};
use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, Mutability};
use crate::modules::ExportBinding;
use bun_sema::atom::known;
use bun_sema::bind::{
    Binding, BindingInitializer, BindingKind, BindingStability, Bound, Parent, StoreKind, SymbolId,
};
use bun_sema::fold::{Decision, Decisions};
use bun_sema::hir::{
    self, BinOp, Call, Chain, ClassId, ExprId, ExprKind, Flags, FnId, FnKind, NodeData, PatKind,
    StmtKind, UnOp,
};
use bun_sema::program::FileId;
use bun_sema::util::SharedSort;
use smallvec::SmallVec;

const MAX_STATES_OF_CLASS: usize = 256;

const METHODS_OF_COLLECTIONS: [BuiltinId; 5] = [
    BuiltinId::WeakMapPrototypeGet,
    BuiltinId::WeakMapPrototypeHas,
    BuiltinId::WeakMapPrototypeSet,
    BuiltinId::WeakSetPrototypeAdd,
    BuiltinId::WeakSetPrototypeHas,
];

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct PrivateState {
    pub symbol: SymbolId,
    pub kind: PrivateStateKind,
    pub owner: ClassId,
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
    pub fn site(&self, call: ExprId) -> Option<PrivateStateSite> {
        find_by_key(&self.sites, call).copied()
    }

    pub fn state(&self, symbol: SymbolId) -> Option<PrivateState> {
        Some(self.states[*find_by_key(&self.by_symbol, symbol)? as usize])
    }

    pub fn created_by(&self, creation: ExprId) -> Option<PrivateState> {
        Some(self.states[*find_by_key(&self.by_creation, creation)? as usize])
    }

    pub fn states_of_class(&self, class: ClassId) -> &[PrivateState] {
        let start = self.states.partition_point(|state| state.owner < class);
        let count = self.states[start..].partition_point(|state| state.owner == class);
        &self.states[start..start + count]
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Owner {
    Unknown,
    Class(ClassId),
    SeveralClasses,
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
    // An entry that is in a field is missing in the collection.
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
    let creations = (0..finder.hir.exprs.len() as u32).map(ExprId);
    finder.candidates = creations
        .filter_map(|creation| finder.find_candidate(creation))
        .collect();
    finder
        .candidates
        .shared_sort_unstable_by_key(|candidate| candidate.symbol);
    if finder.candidates.is_empty() {
        return FilePrivateStates::default();
    }
    finder.classify_mentions();
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
        if name == known::WeakMap {
            return Some(PrivateStateKind::Field);
        }
        (name == known::WeakSet).then_some(PrivateStateKind::Brand)
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

    fn find_holder(&self, creation: ExprId) -> Option<(SymbolId, Option<ExprId>)> {
        let (hir, bound) = (self.hir, self.bound);
        // Only the first collection that a variable holds has its entries in fields.
        if !is_in_statement_of_file(bound, creation) {
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
        if !is_variable || recorded != BindingStability::Stable {
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

    fn classify_mentions(&mut self) {
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
    }

    fn classify_mention(&mut self, candidate: usize, mention: ExprId) {
        let kind = self.candidates[candidate].kind;
        if self.candidates[candidate].stored_name == Some(mention) {
            return;
        }
        let is_looked_up = !has_fixed_binding(self.bound, mention);
        let definition = self.find_definition(mention, kind);
        let site = match definition {
            Some(call) => Some((call, PrivateStateRole::Definition)),
            None => {
                let call = self.find_helper_call(mention, kind);
                call.map(|call| (call, PrivateStateRole::HelperArgument))
            }
        };
        let constructed = definition.and_then(|call| self.find_constructed_class(call));
        let candidate = &mut self.candidates[candidate];
        let Some(site) = site.filter(|_| !is_looked_up) else {
            candidate.has_other_mention = true;
            return;
        };
        candidate.sites.push(site);
        if let Some(class) = constructed {
            candidate.owner = match candidate.owner {
                Owner::Unknown => Owner::Class(class),
                Owner::Class(owner) if owner == class => Owner::Class(class),
                Owner::Class(_) | Owner::SeveralClasses => Owner::SeveralClasses,
            };
        }
    }

    // `W.set(x, v)` and `W.add(x)` answer the collection.
    fn find_definition(&self, mention: ExprId, kind: PrivateStateKind) -> Option<ExprId> {
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
        let (method_name, argument_count) = match kind {
            PrivateStateKind::Field => (&b"set"[..], 2),
            PrivateStateKind::Brand => (&b"add"[..], 1),
        };
        let mut arguments = hir.ids(site.args);
        let is_definition = object == mention
            && self.input.files.atoms.bytes(name) == method_name
            && site.callee == method
            && matches!(site.chain, Chain::No)
            && site.args.len() == argument_count
            && !arguments.any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_)))
            && self.is_value_unused(call);
        is_definition.then_some(call)
    }

    fn find_helper_call(&self, mention: ExprId, kind: PrivateStateKind) -> Option<ExprId> {
        let hir = self.hir;
        let Parent::Expr(call) = self.bound.parent_of_expr(mention) else {
            return None;
        };
        let ExprKind::Call(site) = hir[call].kind else {
            return None;
        };
        let helper_call = resolve_private_field_call(self.input, self.file, call)?;
        let state = hir.ids(hir[site].args).nth(helper_call.state);
        (helper_call.supports_private_state(kind) && state == Some(mention)).then_some(call)
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

    fn can_own_states(&self, class: ClassId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut members = hir[class].members.iter();
        !hir[class].flags.contains(Flags::AMBIENT)
            && bound.private_names_of_class(class).len() == 0
            && !members.any(|member| hir[member].flags.contains(Flags::ACCESSOR))
    }

    // `W.set(this, v)` in a constructor: the objects of that class have room for the entry.
    fn find_constructed_class(&self, definition: ExprId) -> Option<ClassId> {
        let hir = self.hir;
        let ExprKind::Call(site) = hir[definition].kind else {
            return None;
        };
        let object = hir.ids(hir[site].args).next()?;
        if !matches!(hir[object].kind, ExprKind::This) {
            return None;
        }
        let function = self.enclosing_function(definition)?;
        if hir.runtime_function_kind(function) != FnKind::Constructor {
            return None;
        }
        self.bound.function_class(function)
    }

    fn finish(self) -> FilePrivateStates {
        let mut accepted: Vec<(ClassId, &Candidate)> = Vec::new();
        for candidate in &self.candidates {
            if let Owner::Class(owner) = candidate.owner
                && !candidate.has_other_mention
                && self.can_own_states(owner)
            {
                accepted.push((owner, candidate));
            }
        }
        accepted.shared_sort_unstable_by_key(|&(owner, candidate)| (owner, candidate.symbol));
        let mut states: Vec<PrivateState> = Vec::new();
        let mut sites: Vec<(ExprId, PrivateStateSite)> = Vec::new();
        for of_class in accepted.chunk_by(|first, second| first.0 == second.0) {
            for &(owner, candidate) in of_class.iter().take(MAX_STATES_OF_CLASS) {
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
            let of_class = states.states_of_class(ClassId(0));
            assert_eq!(of_class.len(), 2);
            assert!(states.states_of_class(ClassId(1)).is_empty());
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
            "_Counter_x.has({});",
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
    fn more_entries_and_more_uses_keep_the_state() {
        let expected = ["_Counter_x Field 5", "_Counter_instances Brand 2"];
        for more in [
            "_Counter_x.set({}, 1);",
            "_Counter_x[\"set\"]({}, 1);",
            "void _Counter_x.set({}, 1);",
            "_Counter_x.set({}, 1), Math.max();",
            "function outside(o) { return __classPrivateFieldGet(o, _Counter_x, \"f\"); }",
        ] {
            assert_eq!(describe_counter_with(more), expected, "{more}");
        }
    }

    #[test]
    fn a_collection_without_a_class_of_its_own_stays_a_collection() {
        for main in [
            "var _x = new WeakMap();\n_x.set({}, 1);",
            "var _x = new WeakMap();\nfunction C() { _x.set(this, 1); }",
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
}
