use super::namespace_members::find_outermost_type_assertion;
use crate::builtins::{Platforms, ResolvedBuiltins};
use crate::ir::{InParallel, for_each_mut};
use crate::known_helpers::{Helper, KnownFunction, KnownHelpers, Quiet, Shape};
use crate::load::sources::parsed_source;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{
    Binding, BindingInitializer, Bound, CodeUnit, Decl, FunctionFlags, Parent, PatParent, SymbolId,
};
use bun_sema::fold::{Constant, Decisions};
use bun_sema::hir::{
    self, BinOp, CallId, Chain, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, MemberKey, NodeData,
    PatId, PatKind, PropKey, PropKind, StmtId, StmtKind, UnOp, VarDeclId,
};
use bun_sema::module_format::ThisPositions;
use bun_sema::program::{FileId, Files};
use bun_sema::util::SharedSort;
use bun_sema::util::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::cell::OnceCell;
use std::cmp::Reverse;
use std::collections::BinaryHeap;

mod bootstrap;
mod browserify;
use self::bootstrap::Bootstrap;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum InnerModuleKind {
    CommonJs,
    Esm,
}

#[derive(Copy, Clone, Debug)]
pub struct InnerModule {
    pub callback: FnId,
    pub kind: InnerModuleKind,
    pub holder: SymbolId,
    pub statement: StmtId,
    pub caches_evaluation_error: bool,
    pub exports_parameter: Option<SymbolId>,
    pub module_parameter: Option<SymbolId>,
    pub require_parameter: Option<SymbolId>,
    /// The body reads `this`: the exports that it begins with.
    pub reads_this: bool,
    /// The parameter for the exports where the body stores into it: a variable that begins with them.
    pub exports_variable: Option<SymbolId>,
    /// The parameter for the module's object where it escapes: a variable that begins with the object.
    pub module_variable: Option<SymbolId>,
    /// What the calls that require the module pass.
    pub id: Option<Constant>,
}

/// The object that webpack's runtime creates for a module.
#[derive(Copy, Clone)]
pub struct ModuleObject {
    pub literal: ExprId,
    /// The variable in the literal that holds the module's name.
    pub id: SymbolId,
    /// The name that is set to true behind the body.
    pub mark: Option<Atom>,
    pub is_mark_strict: bool,
}

impl InnerModule {
    /// The object of the exports has more names than `exports_parameter` and `module.exports`.
    pub fn exposes_first_exports(&self) -> bool {
        self.reads_this || self.exports_variable.is_some() || self.module_variable.is_some()
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum ThisOfBody {
    Unknown,
    Exports,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Role {
    Holder,
    ExportsParameter,
    ModuleParameter,
    Require,
    BootstrapState,
}

#[derive(Copy, Clone)]
struct RuntimeOfBundle {
    literal: ExprId,
    require: SymbolId,
    call: ExprId,
    module_object: Option<ModuleObject>,
}

/// A module, by its body, and a name of its exports, or the exports as a whole.
type ExportKey = (FnId, Option<Atom>);

/// A function that a wrapper in another function than the file's runs at most once, and the variable that holds the wrapper's result.
#[derive(Copy, Clone)]
struct OnceCallback {
    callback: FnId,
    holder: Option<SymbolId>,
}

/// The parameters of the modules' bodies, and the names of the function that evaluates the bodies.
type BodyParameters = FxHashMap<SymbolId, (Role, FnId)>;

#[derive(Copy, Clone)]
struct ExportStores {
    last: ExprId,
    position: u32,
    is_last_in_body: bool,
    is_only: bool,
}

#[derive(Default)]
struct FileModules {
    modules: Box<[InnerModule]>,
    by_callback: Box<[(FnId, u32)]>,
    calls: Box<[(ExprId, u32)]>,
    requests: Box<[(ExprId, u32)]>,
    names_super: bool,
    bootstrap: Option<RuntimeOfBundle>,
    helpers: Box<[(Atom, KnownFunction)]>,
    names_of_require: Box<[SymbolId]>,
    once_callbacks: Box<[FnId]>,
    stored_exports: FxHashMap<ExportKey, ExprId>,
    nested_bodies: Box<[(SymbolId, FnId)]>,
}

#[derive(Default)]
pub struct WrappedModules {
    files: Vec<FileModules>,
}

struct WrapperShape {
    kind: InnerModuleKind,
    caches_evaluation_error: bool,
    takes_literal: bool,
}

fn classify(shape: Shape) -> Option<WrapperShape> {
    let (kind, caches_evaluation_error, takes_literal) = match shape {
        Shape::CommonJsRunsCallbackOnce | Shape::CommonJsRunsCallbackOnceThenDropsIt => {
            (InnerModuleKind::CommonJs, false, false)
        }
        Shape::CommonJsRunsFirstKeyOnce
        | Shape::CommonJsRunsFirstOwnNameOnce
        | Shape::CommonJsRunsFirstOwnNameOnceThenDropsIt => {
            (InnerModuleKind::CommonJs, false, true)
        }
        Shape::EsmRunsFunctionOnce => (InnerModuleKind::Esm, false, false),
        Shape::EsmRunsFunctionOnceRethrows => (InnerModuleKind::Esm, true, false),
        Shape::EsmRunsFirstKeyOnce | Shape::EsmRunsFirstOwnNameOnce => {
            (InnerModuleKind::Esm, false, true)
        }
        Shape::EsmRunsFirstOwnNameOnceRethrows => (InnerModuleKind::Esm, true, true),
        Shape::CommonJsRunsFirstOwnNameAgainAfterThrow => return None,
        _ => return None,
    };
    Some(WrapperShape {
        kind,
        caches_evaluation_error,
        takes_literal,
    })
}

#[derive(Copy, Clone)]
enum SiteTime {
    At(u32),
    WithBodyOf(usize),
}

struct Candidate {
    module: InnerModule,
    defined_at: u32,
    sites: Vec<SiteTime>,
    calls: Vec<ExprId>,
    requests: Vec<ExprId>,
    is_refused: bool,
    exposes_module_object: bool,
}

impl Candidate {
    fn accepted_module(&self) -> InnerModule {
        let mut module = self.module;
        if self.exposes_module_object {
            module.module_variable = module.module_parameter.take();
            let parameter = module.exports_parameter.take();
            module.exports_variable = module.exports_variable.or(parameter);
        }
        module
    }
}

struct Finder<'a, 's> {
    files: &'a Files<'s>,
    helpers: &'a KnownHelpers,
    file: FileId,
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    decisions: &'a Decisions<'s>,
    builtins: &'a ResolvedBuiltins,
    exported_symbols: FxHashSet<SymbolId>,
    candidates: Vec<Candidate>,
    by_callback: Vec<(FnId, u32)>,
    by_symbol: Vec<(SymbolId, Role, u32)>,
    names_super: bool,
    this_positions: OnceCell<ThisPositions>,
    bootstrap: Option<Bootstrap>,
    every_object_has: &'a (dyn Fn(Atom) -> bool + Sync),
    replaced_builtins: &'a [u32],
}

fn find_by_key<K: Ord + Copy, T: Copy>(
    entries: &[T],
    key: K,
    key_of: impl Fn(&T) -> K,
) -> Option<T> {
    let at = entries.binary_search_by_key(&key, key_of).ok()?;
    Some(entries[at])
}

fn parent_of_pattern(bound: &Bound<'_>, mut pattern: PatId) -> Parent {
    loop {
        match bound.pat_parent[pattern.idx()] {
            PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pattern = outer,
            PatParent::Var(declaration) => return Parent::VarInit(declaration),
            PatParent::Param(parameter) => return Parent::ParamDefault(parameter),
            PatParent::None => return Parent::None,
        }
    }
}

fn find_functions_around(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    expression: ExprId,
) -> Option<SmallVec<[FnId; 4]>> {
    let mut parent = bound.parent_of_expr(expression);
    let innermost = loop {
        parent = match parent {
            Parent::Expr(outer) => bound.parent_of_expr(outer),
            Parent::Prop(property) | Parent::PropKey(property) | Parent::MethodKey(property) => {
                Parent::Expr(bound.prop_owner[property.idx()])
            }
            Parent::VarInit(declaration) => Parent::Stmt(bound.var_stmt[declaration.idx()]),
            Parent::PatPropDefault(property) | Parent::PatKey(property) => {
                parent_of_pattern(bound, hir[property].value)
            }
            Parent::PatElemDefault(element) => parent_of_pattern(bound, hir[element].pat),
            Parent::Case(case) => Parent::Stmt(bound.case_stmt[case.idx()]),
            Parent::ClassExtends(class) | Parent::ClassDecorator(class) => {
                bound.class_owner[class.idx()].to_parent()
            }
            Parent::MemberKey(member)
            | Parent::MemberInit(member)
            | Parent::MemberDecorator(member) => {
                bound.class_owner[bound.member_class(member)?.idx()].to_parent()
            }
            Parent::Stmt(statement) => {
                let scope = bound.scope_of_stmt(statement.some()?).some()?;
                match bound.code_unit(scope) {
                    CodeUnit::File => break None,
                    CodeUnit::Function(function) => break Some(function),
                    CodeUnit::FieldInitializer(member) => {
                        bound.class_owner[bound.member_class(member)?.idx()].to_parent()
                    }
                }
            }
            Parent::File => break None,
            Parent::FnBody(function) => break Some(function),
            Parent::ParamDefault(parameter) => break Some(bound.param_fn[parameter.idx()]),
            Parent::None | Parent::EnumInit(_) | Parent::ParamDecorator(_) | Parent::Module(_) => {
                return None;
            }
        };
    };
    let mut functions = SmallVec::new();
    let mut next = innermost;
    while let Some(function) = next {
        functions.push(function);
        next = bound.fns[function.idx()].enclosing.some();
    }
    debug_assert!(functions.len() <= hir.fns.len());
    Some(functions)
}

fn find_plain_call_of(hir: &hir::File<'_>, bound: &Bound<'_>, name: ExprId) -> Option<ExprId> {
    let callee = find_outermost_type_assertion(hir, bound, name);
    let Parent::Expr(call) = bound.parent_of_expr(callee) else {
        return None;
    };
    let ExprKind::Call(site) = hir[call].kind else {
        return None;
    };
    let site = hir[site];
    (site.callee == callee && site.chain == Chain::No && site.args.is_empty()).then_some(call)
}

impl Finder<'_, '_> {
    fn find_plain_parameter(&self, function: FnId, index: usize) -> Option<SymbolId> {
        let (hir, bound) = (self.hir, self.bound);
        let parameter = hir[hir[function].params.iter().nth(index)?];
        let is_plain = matches!(hir[parameter.pat].kind, PatKind::Ident(_))
            && parameter.default.is_none()
            && !parameter.flags.contains(Flags::REST);
        let symbol = bound.declared_symbol(Decl::Param(parameter.pat)).some()?;
        (is_plain && bound.is_stable_binding(symbol)).then_some(symbol)
    }

    fn find_reassigned_parameter(&self, function: FnId, index: usize) -> Option<SymbolId> {
        let (hir, bound) = (self.hir, self.bound);
        let parameter = hir[hir[function].params.iter().nth(index)?];
        let is_plain = matches!(hir[parameter.pat].kind, PatKind::Ident(_))
            && parameter.default.is_none()
            && !parameter.flags.contains(Flags::REST);
        let symbol = bound.declared_symbol(Decl::Param(parameter.pat)).some()?;
        let is_reassigned = !bound.is_stable_binding(symbol) && !bound.is_visible_to_eval(symbol);
        (is_plain && is_reassigned).then_some(symbol)
    }

    fn find_callback(&self, argument: ExprId, takes_literal: bool) -> Option<FnId> {
        let hir = self.hir;
        let argument = hir.skip_type_assertions(argument);
        let written = match (hir[argument].kind, takes_literal) {
            (ExprKind::Fn(_), false) => argument,
            (ExprKind::Object(properties), true) if properties.len() == 1 => {
                let property = hir[properties.at(0)];
                let is_plain = matches!(property.kind, PropKind::Init | PropKind::Method)
                    && matches!(property.key, PropKey::Name(_))
                    && !hir::is_proto_setter(&property);
                if !is_plain {
                    return None;
                }
                hir.skip_type_assertions(property.value)
            }
            _ => return None,
        };
        match hir[written].kind {
            ExprKind::Fn(callback) => Some(callback),
            _ => None,
        }
    }

    fn reads_own_this(&self, function: FnId) -> bool {
        self.bound.fns[function.idx()].contains_this || {
            let jsx_takes_this = self.files.analysis(self.file).jsx_takes_this();
            let positions = self
                .this_positions
                .get_or_init(|| ThisPositions::of(self.hir, jsx_takes_this));
            positions.evaluates_own_this(self.hir, function)
        }
    }

    fn reads_this_of_call(&self, callback: FnId) -> bool {
        self.hir[callback].kind != FnKind::Arrow && self.reads_own_this(callback)
    }

    fn can_be_body(&self, callback: FnId, kind: InnerModuleKind, this: ThisOfBody) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let record = hir[callback];
        let has_own_name = record.kind == FnKind::Expr && record.name != Atom::NONE;
        let flags = bound.function_flags(callback);
        let sees_its_call =
            flags.intersects(FunctionFlags::USES_ARGUMENTS | FunctionFlags::HAS_DIRECT_EVAL);
        let is_plain = matches!(record.kind, FnKind::Expr | FnKind::Arrow | FnKind::Method)
            && !record.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
            && record.this_param.is_none()
            && matches!(record.body, FnBody::Block(_));
        let may_read_this = this == ThisOfBody::Exports && record.kind != FnKind::Arrow;
        if !is_plain
            || has_own_name
            || sees_its_call
            || (!may_read_this && self.reads_own_this(callback))
        {
            return false;
        }
        if record.kind == FnKind::Arrow && bound.file_uses_arguments() {
            return false;
        }
        match kind {
            InnerModuleKind::CommonJs => true,
            InnerModuleKind::Esm => {
                let mut returns = bound.ids(bound.fns[callback.idx()].returns);
                returns.all(|statement: StmtId| match hir[statement].kind {
                    StmtKind::Return(value) => value.is_none(),
                    _ => false,
                })
            }
        }
    }

    fn collect_exported_symbols(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        for statement in hir.ids(hir.body) {
            let StmtKind::ExportNamed(export) = hir[statement].kind else {
                continue;
            };
            if hir[export].has_module_specifier {
                continue;
            }
            for item in hir[export].items.iter() {
                if let Binding::Symbol(symbol) = bound.exported_binding(item) {
                    self.exported_symbols.insert(symbol);
                }
            }
        }
    }

    fn read_declaration(&self, statement: StmtId, declaration: VarDeclId) -> Option<Candidate> {
        let (hir, bound) = (self.hir, self.bound);
        let record = hir[declaration];
        if !matches!(hir[record.pat].kind, PatKind::Ident(_))
            || record.flags.contains(Flags::EXPORT)
        {
            return None;
        }
        let call = hir.skip_type_assertions(record.init.some()?);
        let ExprKind::Call(site) = hir[call].kind else {
            return None;
        };
        let site = hir[site];
        if site.chain != Chain::No || site.args.len() != 1 {
            return None;
        }
        let known = self
            .helpers
            .certain_callee(self.files, self.file, site.callee)?;
        let shape = classify(known.shape)?;
        let callback = self.find_callback(hir.id_at(site.args, 0), shape.takes_literal)?;
        if !self.can_be_body(callback, shape.kind, ThisOfBody::Unknown) {
            return None;
        }
        let parameter_count = hir[callback].params.len();
        let (exports_parameter, module_parameter) = match (shape.kind, parameter_count) {
            (_, 0) => (None, None),
            (InnerModuleKind::CommonJs, 1) => (Some(self.find_plain_parameter(callback, 0)?), None),
            (InnerModuleKind::CommonJs, 2) => (
                Some(self.find_plain_parameter(callback, 0)?),
                Some(self.find_plain_parameter(callback, 1)?),
            ),
            (InnerModuleKind::CommonJs | InnerModuleKind::Esm, _) => return None,
        };
        let holder = bound.declared_symbol(Decl::Var(record.pat)).some()?;
        let is_only_seen_here = bound.is_stable_binding(holder)
            && !bound.is_visible_to_eval(holder)
            && !self.exported_symbols.contains(&holder);
        if !is_only_seen_here {
            return None;
        }
        Some(Candidate {
            module: InnerModule {
                callback,
                kind: shape.kind,
                holder,
                statement,
                caches_evaluation_error: shape.caches_evaluation_error,
                exports_parameter,
                module_parameter,
                require_parameter: None,
                reads_this: false,
                exports_variable: None,
                module_variable: None,
                id: None,
            },
            defined_at: hir[call].end,
            sites: Vec::new(),
            calls: Vec::new(),
            requests: Vec::new(),
            is_refused: false,
            exposes_module_object: false,
        })
    }

    fn collect_candidates(&mut self, has_helpers: bool) {
        let hir = self.hir;
        for statement in hir.ids(hir.body).filter(|_| has_helpers) {
            let StmtKind::Var(declarations) = hir[statement].kind else {
                continue;
            };
            if self.decisions.is_dead_stmt(statement) {
                continue;
            }
            for declaration in declarations.iter() {
                if let Some(candidate) = self.read_declaration(statement, declaration) {
                    self.candidates.push(candidate);
                }
            }
        }
        self.find_bootstrap();
        if self.bootstrap.is_none() {
            self.find_bundle();
        }
        if let Some(bootstrap) = &self.bootstrap
            && !bootstrap.is_browserify()
        {
            self.by_symbol
                .push((bootstrap.require, Role::Require, u32::MAX));
            let state = [bootstrap.modules, bootstrap.cache];
            self.by_symbol
                .extend(state.map(|symbol| (symbol, Role::BootstrapState, u32::MAX)));
        }
        for (candidate, index) in self.candidates.iter().zip(0..) {
            let module = candidate.module;
            self.by_callback.push((module.callback, index));
            if let Some(holder) = module.holder.some() {
                self.by_symbol.push((holder, Role::Holder, index));
            }
            if let Some(parameter) = module.require_parameter {
                self.by_symbol.push((parameter, Role::Require, index));
            }
            if let Some(parameter) = module.exports_parameter {
                self.by_symbol
                    .push((parameter, Role::ExportsParameter, index));
            }
            if let Some(parameter) = module.module_parameter {
                self.by_symbol
                    .push((parameter, Role::ModuleParameter, index));
            }
        }
        self.by_callback
            .shared_sort_unstable_by_key(|entry| entry.0);
        self.by_symbol.shared_sort_unstable_by_key(|entry| entry.0);
    }

    /// The functions that calls of wrappers run at most once, wherever the calls are. A call creates a wrapper of its own.
    fn find_once_callbacks(&self) -> Vec<OnceCallback> {
        let hir = self.hir;
        let mut callbacks = Vec::new();
        let has_wrapper = self.helpers.file(self.file).is_some_and(|helpers| {
            let mut functions = helpers.functions();
            functions.any(|(_, known)| classify(known.shape).is_some())
        });
        if !has_wrapper {
            return callbacks;
        }
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            let ExprKind::Call(call) = hir[expression].kind else {
                continue;
            };
            let site = hir[call];
            if site.chain != Chain::No || site.args.len() != 1 {
                continue;
            }
            let shape = self
                .helpers
                .only_callee(self.files, self.file, site.callee)
                .and_then(|known| classify(known.shape));
            let callback = shape
                .and_then(|shape| self.find_callback(hir.id_at(site.args, 0), shape.takes_literal));
            if let Some(callback) = callback
                && self.can_be_body(callback, InnerModuleKind::CommonJs, ThisOfBody::Unknown)
            {
                let holder = self.find_holder_of_wrapper(expression);
                callbacks.push(OnceCallback { callback, holder });
            }
        }
        callbacks.sort_unstable_by_key(|it| it.callback);
        callbacks
    }

    fn find_holder_of_wrapper(&self, call: ExprId) -> Option<SymbolId> {
        let (hir, bound) = (self.hir, self.bound);
        let Parent::VarInit(declaration) = bound.parent_of_expr(call) else {
            return None;
        };
        let pattern = hir[declaration].pat;
        let holder = bound.declared_symbol(Decl::Var(pattern)).some()?;
        let is_plain = matches!(hir[pattern].kind, PatKind::Ident(_))
            && bound.is_stable_binding(holder)
            && !bound.is_visible_to_eval(holder);
        is_plain.then_some(holder)
    }

    fn collect_body_parameters(&self, nested: &[OnceCallback]) -> BodyParameters {
        let mut parameters = BodyParameters::default();
        for candidate in self.candidates.iter().filter(|it| !it.is_refused) {
            let module = candidate.module;
            let named = [
                (module.exports_parameter, Role::ExportsParameter),
                (module.module_parameter, Role::ModuleParameter),
                (module.require_parameter, Role::Require),
            ];
            for (symbol, role) in named {
                parameters.extend(symbol.map(|it| (it, (role, module.callback))));
            }
        }
        for &OnceCallback { callback, .. } in nested {
            let roles = [Role::ExportsParameter, Role::ModuleParameter];
            for (index, role) in roles.into_iter().enumerate() {
                let symbol = self.find_plain_parameter(callback, index);
                parameters.extend(symbol.map(|it| (it, (role, callback))));
            }
        }
        if let Some(bootstrap) = &self.bootstrap {
            parameters.insert(bootstrap.require, (Role::Require, FnId::NONE));
        }
        parameters
    }

    fn candidate_of_callback(&self, function: FnId) -> Option<usize> {
        find_by_key(&self.by_callback, function, |entry| entry.0).map(|entry| entry.1 as usize)
    }

    fn holds_new_empty_object(&self, expression: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let expression = hir.skip_type_assertions(expression);
        let Binding::Symbol(symbol) = bound.binding(expression) else {
            return false;
        };
        let BindingInitializer::Expression(value) = bound.binding_initializer(hir, symbol) else {
            return false;
        };
        let is_empty_literal = match hir[hir.skip_type_assertions(value)].kind {
            ExprKind::Object(properties) => properties.is_empty(),
            _ => false,
        };
        matches!(hir[expression].kind, ExprKind::Ident(_))
            && is_empty_literal
            && bound.is_stable_binding(symbol)
    }

    fn runs_nothing(&self, call: CallId) -> bool {
        let hir = self.hir;
        let site = hir[call];
        if let ExprKind::Fn(factory) = hir[hir.skip_type_assertions(site.callee)].kind {
            let known = self.helpers.function(self.file, factory);
            return known.is_some_and(|known| known.shape.helper() == Helper::Require);
        }
        let Some(known) = self
            .helpers
            .certain_callee(self.files, self.file, site.callee)
        else {
            return false;
        };
        match known.shape.helper() {
            Helper::CommonJs | Helper::Esm => true,
            Helper::Export => {
                let target = hir.ids(site.args).next();
                target.is_some_and(|target| self.holds_new_empty_object(target))
            }
            _ => false,
        }
    }

    fn find_end_of_head(&self) -> u32 {
        let helpers = self.helpers.file(self.file);
        let quiet = Quiet {
            atoms: &self.files.atoms,
            hir: self.hir,
            bound: self.bound,
            decisions: self.decisions,
            builtins: self.builtins,
            allows_reads_of_open_globals: helpers
                .is_some_and(|helpers| helpers.head_allows_reads_of_open_globals()),
            runs_nothing: &|call| self.runs_nothing(call),
        };
        quiet.find_end_of_head()
    }

    fn find_site_time(&self, call: ExprId, end_of_head: u32) -> Option<SiteTime> {
        let hir = self.hir;
        let functions = find_functions_around(hir, self.bound, call)?;
        let Some(&outermost) = functions.last() else {
            return Some(SiteTime::At(hir[call].pos));
        };
        let mut outermost_first = functions.iter().rev();
        if let Some(around) = outermost_first.find_map(|&it| self.candidate_of_callback(it)) {
            return Some(SiteTime::WithBodyOf(around));
        }
        Some(SiteTime::At(match hir[outermost].kind {
            FnKind::Decl => end_of_head,
            _ => end_of_head.max(hir[outermost].start),
        }))
    }

    fn is_exports_of(&self, module: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let object = find_outermost_type_assertion(hir, bound, module);
        let Parent::Expr(member) = bound.parent_of_expr(object) else {
            return false;
        };
        let names_exports = matches!(
            hir.member_key(member),
            Some((accessed, MemberKey::Name(name))) if accessed == object && name == known::exports
        );
        let is_plain = matches!(
            hir[member].kind,
            ExprKind::Dot {
                chain: Chain::No,
                ..
            } | ExprKind::Index {
                chain: Chain::No,
                ..
            }
        );
        let outermost = find_outermost_type_assertion(hir, bound, member);
        let is_deleted_or_called = match bound.parent_of_expr(outermost) {
            Parent::Expr(user) => match hir[user].kind {
                ExprKind::Unary {
                    op: UnOp::Delete, ..
                } => true,
                // `module` is the receiver of the call.
                ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => {
                    hir[call].callee == outermost
                }
                _ => false,
            },
            _ => false,
        };
        names_exports && is_plain && !is_deleted_or_called
    }

    fn refuse_owner_of(&mut self, expression: ExprId) {
        let Some(functions) = find_functions_around(self.hir, self.bound, expression) else {
            for candidate in &mut self.candidates {
                candidate.is_refused = true;
            }
            return;
        };
        for function in functions {
            if let Some(owner) = self.candidate_of_callback(function) {
                self.candidates[owner].is_refused = true;
                return;
            }
            if self.hir[function].kind != FnKind::Arrow {
                return;
            }
        }
    }

    fn read_mentions(&mut self, end_of_head: u32) {
        let (hir, bound) = (self.hir, self.bound);
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            match hir[expression].kind {
                ExprKind::Ident(_) => {}
                ExprKind::NewTarget(_) | ExprKind::Super => {
                    if !self.decisions.is_dead_expr(expression) {
                        self.names_super |= matches!(hir[expression].kind, ExprKind::Super);
                        self.refuse_owner_of(expression);
                    }
                    continue;
                }
                _ => continue,
            }
            if !bound.is_evaluated_ident(expression) || self.decisions.is_dead_expr(expression) {
                continue;
            }
            let Binding::Symbol(symbol) = bound.binding(expression) else {
                continue;
            };
            let Some((_, role, index)) = find_by_key(&self.by_symbol, symbol, |entry| entry.0)
            else {
                continue;
            };
            let index = index as usize;
            let is_looked_up = bound
                .dynamic_lookup_scope(NodeData::Expr(expression))
                .is_some();
            if is_looked_up {
                match self.candidates.get_mut(index) {
                    Some(candidate) => candidate.is_refused = true,
                    None => self.refuse_bootstrap(),
                }
                continue;
            }
            match role {
                Role::Require => self.read_mention_of_require(expression, end_of_head, index),
                Role::BootstrapState => {
                    if !self.is_in_require_function(expression) {
                        self.refuse_bootstrap();
                    }
                }
                Role::Holder => {
                    let call = find_plain_call_of(hir, bound, expression);
                    let time = call.and_then(|call| self.find_site_time(call, end_of_head));
                    match (call, time) {
                        (Some(call), Some(time)) => {
                            self.candidates[index].sites.push(time);
                            self.candidates[index].calls.push(call);
                        }
                        _ => self.candidates[index].is_refused = true,
                    }
                }
                Role::ExportsParameter => {}
                Role::ModuleParameter => {
                    if !self.is_exports_of(expression) {
                        let can_escape = self.can_expose_module_object(index);
                        self.candidates[index].exposes_module_object |= can_escape;
                        self.candidates[index].is_refused |= !can_escape;
                    }
                }
            }
        }
        let analysis = self.files.analysis(self.file);
        for binding in analysis.bindings_read_without_expression(hir, bound) {
            if let Binding::Symbol(symbol) = binding
                && let Some((_, _, index)) = find_by_key(&self.by_symbol, symbol, |entry| entry.0)
            {
                match self.candidates.get_mut(index as usize) {
                    Some(candidate) => candidate.is_refused = true,
                    None => self.refuse_bootstrap(),
                }
            }
        }
    }

    fn find_first_calls(&self) -> Vec<u32> {
        let count = self.candidates.len();
        let mut called_in_body: Vec<Vec<u32>> = vec![Vec::new(); count];
        let mut pending = BinaryHeap::new();
        for (candidate, index) in self.candidates.iter().zip(0u32..) {
            for &site in &candidate.sites {
                match site {
                    SiteTime::At(position) => pending.push(Reverse((position, index))),
                    SiteTime::WithBodyOf(around) => called_in_body[around].push(index),
                }
            }
        }
        for (candidate, called) in self.candidates.iter().zip(&called_in_body) {
            if candidate.is_refused {
                let times = called.iter().map(|&it| Reverse((candidate.defined_at, it)));
                pending.extend(times);
            }
        }
        let mut first_calls = vec![u32::MAX; count];
        let mut is_known = vec![false; count];
        while let Some(Reverse((time, index))) = pending.pop() {
            let index = index as usize;
            if core::mem::replace(&mut is_known[index], true) {
                continue;
            }
            first_calls[index] = time;
            let candidate = &self.candidates[index];
            if candidate.is_refused {
                continue;
            }
            let start = time.max(candidate.defined_at);
            let times = called_in_body[index].iter().map(|&it| Reverse((start, it)));
            pending.extend(times);
        }
        first_calls
    }

    fn find_body_of_parameter(
        &self,
        parameters: &BodyParameters,
        expression: ExprId,
        sought: Role,
    ) -> Option<FnId> {
        let expression = self.hir.skip_type_assertions(expression);
        let (ExprKind::Ident(_), Binding::Symbol(symbol)) =
            (self.hir[expression].kind, self.bound.binding(expression))
        else {
            return None;
        };
        let &(role, body) = parameters.get(&symbol)?;
        (role == sought).then_some(body)
    }

    /// The body whose exports `expression` reads: `exports`, `module.exports`.
    fn find_owner_of_exports(
        &self,
        parameters: &BodyParameters,
        expression: ExprId,
    ) -> Option<FnId> {
        let expression = self.hir.skip_type_assertions(expression);
        match self.hir.member_key(expression) {
            Some((module, MemberKey::Name(known::exports))) => {
                self.find_body_of_parameter(parameters, module, Role::ModuleParameter)
            }
            Some(_) => None,
            None => self.find_body_of_parameter(parameters, expression, Role::ExportsParameter),
        }
    }

    /// A statement of the body evaluates the expression.
    fn is_evaluated_by_body(&self, body: FnId, mut expression: ExprId) -> bool {
        loop {
            let statement = match self.bound.parent_of_expr(expression) {
                Parent::Expr(outer) => match self.hir[outer].kind {
                    ExprKind::Assign {
                        op: None, value, ..
                    } if value == expression => {
                        expression = outer;
                        continue;
                    }
                    ExprKind::Binary {
                        op: BinOp::Comma, ..
                    } => {
                        expression = outer;
                        continue;
                    }
                    _ => return false,
                },
                Parent::Stmt(statement) => statement,
                Parent::VarInit(declaration) => self.bound.var_stmt[declaration.idx()],
                _ => return false,
            };
            return statement
                .some()
                .is_some_and(|it| self.bound.parent_of_stmt(it) == Parent::FnBody(body));
        }
    }

    /// `() => value`, `function () { return value; }`
    fn find_value_of_getter(&self, getter: ExprId) -> Option<ExprId> {
        let hir = self.hir;
        let ExprKind::Fn(function) = hir[hir.skip_type_assertions(getter)].kind else {
            return None;
        };
        match hir[function].body {
            FnBody::Expr(value) => Some(value),
            FnBody::Block(statements) if statements.len() == 1 => {
                match hir[hir.id_at(statements, 0)].kind {
                    StmtKind::Return(value) => value.some(),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// `__webpack_require__.d(exports, { Name: () => Name })`, `__webpack_require__.d(exports, "Name", function () { return Name; })`
    fn collect_defined_exports(
        &self,
        parameters: &BodyParameters,
        call: CallId,
        found: &mut FxHashMap<ExportKey, ExprId>,
    ) {
        let hir = self.hir;
        let site = hir[call];
        if site.chain != Chain::No || !(2..=3).contains(&site.args.len()) {
            return;
        }
        let Some((holder, MemberKey::Name(_))) =
            hir.member_key(hir.skip_type_assertions(site.callee))
        else {
            return;
        };
        let exports = hir.id_at(site.args, 0);
        let Some(body) = self.find_owner_of_exports(parameters, exports) else {
            return;
        };
        let holder = self.find_body_of_parameter(parameters, holder, Role::Require);
        if holder.is_none() {
            return;
        }
        let second = hir.skip_type_assertions(hir.id_at(site.args, 1));
        match hir[second].kind {
            ExprKind::Object(properties) if site.args.len() == 2 => {
                for property in properties.iter() {
                    if let PropKey::Name(name) = hir.runtime_property_key(property)
                        && matches!(hir[property].kind, PropKind::Init | PropKind::Method)
                        && let Some(value) = self.find_value_of_getter(hir[property].value)
                    {
                        found.insert((body, Some(name)), value);
                    }
                }
            }
            ExprKind::String(name) if site.args.len() == 3 => {
                if let Some(value) = self.find_value_of_getter(hir.id_at(site.args, 2)) {
                    found.insert((body, Some(name)), value);
                }
            }
            _ => {}
        }
    }

    /// The last store of a name decides where a statement of the body makes it; another store decides where it is the only one.
    fn collect_stored_exports(&self, nested: &[OnceCallback]) -> FxHashMap<ExportKey, ExprId> {
        let hir = self.hir;
        let mut found = FxHashMap::default();
        let parameters = self.collect_body_parameters(nested);
        if parameters.is_empty() {
            return found;
        }
        let mut stores: FxHashMap<ExportKey, ExportStores> = FxHashMap::default();
        for node in (0..hir.exprs.len() as u32).map(ExprId) {
            match hir[node].kind {
                ExprKind::Call(call) => self.collect_defined_exports(&parameters, call, &mut found),
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } => {
                    let Some((object, MemberKey::Name(name))) = hir.member_key(target) else {
                        continue;
                    };
                    let whole = match name {
                        known::exports => {
                            self.find_body_of_parameter(&parameters, object, Role::ModuleParameter)
                        }
                        _ => None,
                    };
                    let (body, name) = match whole {
                        Some(body) => (body, None),
                        None => match self.find_owner_of_exports(&parameters, object) {
                            Some(body) => (body, Some(name)),
                            None => continue,
                        },
                    };
                    if self.decisions.is_dead_expr(target) {
                        continue;
                    }
                    let mut store = ExportStores {
                        last: value,
                        position: hir[node].pos,
                        is_last_in_body: self.is_evaluated_by_body(body, node),
                        is_only: true,
                    };
                    stores
                        .entry((body, name))
                        .and_modify(|known| {
                            store.is_only = false;
                            known.is_only = false;
                            if known.position < store.position {
                                *known = store;
                            }
                        })
                        .or_insert(store);
                }
                _ => {}
            }
        }
        for (key, store) in stores {
            if store.is_last_in_body || store.is_only {
                found.insert(key, store.last);
            }
        }
        found
    }

    fn count_holders_by_statement(&self) -> FxHashMap<StmtId, usize> {
        let mut counts = FxHashMap::default();
        for candidate in self
            .candidates
            .iter()
            .filter(|candidate| !candidate.is_refused)
        {
            *counts.entry(candidate.module.statement).or_insert(0) += 1;
        }
        counts
    }

    fn count_declarations(&self, statement: StmtId) -> usize {
        match self.hir[statement].kind {
            StmtKind::Var(declarations) => declarations.len(),
            _ => 0,
        }
    }

    fn refuse_misfits(&mut self) {
        let first_calls = self.find_first_calls();
        for (candidate, first_call) in self.candidates.iter_mut().zip(first_calls) {
            candidate.is_refused |= first_call < candidate.defined_at;
        }
        self.refuse_bodies_naming_outer_scope();
        self.find_ids_of_modules();
        let holders = self.count_holders_by_statement();
        for index in 0..self.candidates.len() {
            let statement = self.candidates[index].module.statement;
            if statement.is_none() {
                continue;
            }
            let declares_holders_alone =
                holders.get(&statement) == Some(&self.count_declarations(statement));
            self.candidates[index].is_refused |= !declares_holders_alone;
        }
        self.settle_bootstrap();
    }

    fn finish(self, once_callbacks: &[OnceCallback]) -> FileModules {
        let accepted = self
            .candidates
            .iter()
            .filter(|candidate| !candidate.is_refused);
        let modules: Box<[InnerModule]> =
            accepted.clone().map(Candidate::accepted_module).collect();
        let mut by_callback = Vec::with_capacity(modules.len());
        let mut calls = Vec::new();
        let mut requests = Vec::new();
        for (candidate, index) in accepted.zip(0..) {
            requests.extend(candidate.requests.iter().map(|&call| (call, index)));
            by_callback.push((candidate.module.callback, index));
            calls.extend(candidate.calls.iter().map(|&call| (call, index)));
        }
        by_callback.sort_unstable_by_key(|entry: &(FnId, u32)| entry.0);
        calls.sort_unstable_by_key(|entry: &(ExprId, u32)| entry.0);
        requests.sort_unstable_by_key(|entry: &(ExprId, u32)| entry.0);
        let mut nested = once_callbacks.to_vec();
        nested.retain(|it| find_by_key(&by_callback, it.callback, |entry| entry.0).is_none());
        FileModules {
            modules,
            stored_exports: self.collect_stored_exports(&nested),
            nested_bodies: list_nested_bodies(&nested),
            once_callbacks: nested.iter().map(|it| it.callback).collect(),
            by_callback: by_callback.into_boxed_slice(),
            calls: calls.into_boxed_slice(),
            requests: requests.into_boxed_slice(),
            names_super: self.names_super,
            names_of_require: self.names_of_require(),
            helpers: self.helpers_of_bootstrap(),
            bootstrap: self.bootstrap.map(|it| RuntimeOfBundle {
                literal: it.literal,
                require: it.require,
                call: it.call,
                module_object: it.module_object,
            }),
        }
    }
}

fn list_nested_bodies(nested: &[OnceCallback]) -> Box<[(SymbolId, FnId)]> {
    let bodies = nested
        .iter()
        .filter_map(|it| Some((it.holder?, it.callback)));
    let mut bodies: Vec<(SymbolId, FnId)> = bodies.collect();
    bodies.sort_unstable();
    bodies.into_boxed_slice()
}

impl<'a, 's> Finder<'a, 's> {
    fn new(
        files: &'a Files<'s>,
        helpers: &'a KnownHelpers,
        every_object_has: &'a (dyn Fn(Atom) -> bool + Sync),
        replaced_builtins: &'a [u32],
        file: FileId,
    ) -> Option<Finder<'a, 's>> {
        let (compiled, source) = (files.compiled(file)?, parsed_source(files, file)?);
        Some(Finder {
            files,
            helpers,
            file,
            hir: files.hir(file),
            bound: files.bound(file),
            decisions: &compiled.analysis.decisions,
            builtins: &source.builtins,
            exported_symbols: FxHashSet::default(),
            candidates: Vec::new(),
            by_callback: Vec::new(),
            by_symbol: Vec::new(),
            names_super: false,
            this_positions: OnceCell::new(),
            bootstrap: None,
            every_object_has,
            replaced_builtins,
        })
    }
}

/// A bundle of browserify's that loads nothing from outside: its runtime calls the file's `require` for names that no body has, and has a body for each name.
pub(super) fn is_closed_bundle(
    files: &Files<'_>,
    helpers: &KnownHelpers,
    every_object_has: &(dyn Fn(Atom) -> bool + Sync),
    replaced_builtins: &[u32],
    file: FileId,
    platform: Platforms,
) -> bool {
    let finder = Finder::new(files, helpers, every_object_has, replaced_builtins, file);
    let Some(mut finder) = finder else {
        return false;
    };
    let Some(mentions) = finder.find_mentions_of_require(platform) else {
        return false;
    };
    finder.collect_exported_symbols();
    finder.collect_candidates(helpers.has_functions(file));
    let end_of_head = finder.find_end_of_head();
    finder.read_mentions(end_of_head);
    finder.refuse_misfits();
    let Some(bootstrap) = &finder.bootstrap else {
        return false;
    };
    let is_browserify = bootstrap.require.is_none() && bootstrap.call.is_some();
    is_browserify
        && mentions.iter().all(|&mention| {
            let around = find_functions_around(finder.hir, finder.bound, mention);
            around.is_some_and(|functions| functions.contains(&bootstrap.function))
        })
}

fn find_in_file(
    files: &Files<'_>,
    helpers: &KnownHelpers,
    every_object_has: &(dyn Fn(Atom) -> bool + Sync),
    replaced_builtins: &[u32],
    file: FileId,
) -> FileModules {
    let finder = Finder::new(files, helpers, every_object_has, replaced_builtins, file);
    let Some(mut finder) = finder else {
        return FileModules::default();
    };
    finder.collect_exported_symbols();
    finder.collect_candidates(helpers.has_functions(file));
    let once_callbacks = finder.find_once_callbacks();
    if finder.candidates.is_empty() {
        return FileModules {
            stored_exports: finder.collect_stored_exports(&once_callbacks),
            nested_bodies: list_nested_bodies(&once_callbacks),
            once_callbacks: once_callbacks.iter().map(|it| it.callback).collect(),
            ..FileModules::default()
        };
    }
    let end_of_head = finder.find_end_of_head();
    finder.read_mentions(end_of_head);
    finder.refuse_misfits();
    finder.finish(&once_callbacks)
}

impl WrappedModules {
    pub fn compute(
        files: &Files<'_>,
        helpers: &KnownHelpers,
        every_object_has: &(dyn Fn(Atom) -> bool + Sync),
        replaced_builtins: &[u32],
        may_be_reevaluated: &(dyn Fn(FileId) -> bool + Sync),
        in_parallel: InParallel<'_>,
    ) -> WrappedModules {
        let mut wrapped = WrappedModules::default();
        let mut found: Vec<(FileId, FileModules)> = files
            .compiled_files()
            .iter()
            .map(|&file| (file, FileModules::default()))
            .collect();
        for_each_mut(&mut found, in_parallel, &|(file, modules)| {
            if !may_be_reevaluated(*file) {
                let (has, replaced) = (every_object_has, replaced_builtins);
                *modules = find_in_file(files, helpers, has, replaced, *file);
            }
        });
        wrapped
            .files
            .resize_with(files.modules.len(), FileModules::default);
        for (file, modules) in found {
            wrapped.files[file.idx()] = modules;
        }
        wrapped
    }

    pub fn of_file(&self, file: FileId) -> &[InnerModule] {
        match self.files.get(file.idx()) {
            Some(found) => &found.modules,
            None => &[],
        }
    }

    pub fn of_callback(&self, file: FileId, callback: FnId) -> Option<&InnerModule> {
        let found = self.files.get(file.idx())?;
        let (_, index) = find_by_key(&found.by_callback, callback, |entry| entry.0)?;
        Some(&found.modules[index as usize])
    }

    /// The value that the module with that body exports whole, or under `name`.
    pub fn exported_value(&self, file: FileId, body: FnId, name: Option<Atom>) -> Option<ExprId> {
        let found = self.files.get(file.idx())?;
        found.stored_exports.get(&(body, name)).copied()
    }

    /// A wrapper that is no module of its own runs the function at most once for each closure of it.
    pub fn runs_once_per_closure(&self, file: FileId, function: FnId) -> bool {
        let found = self.files.get(file.idx());
        found.is_some_and(|found| found.once_callbacks.binary_search(&function).is_ok())
    }

    pub fn names_super(&self, file: FileId) -> bool {
        self.files
            .get(file.idx())
            .is_some_and(|found| found.names_super)
    }

    pub fn calls_in(&self, file: FileId) -> impl Iterator<Item = (ExprId, &InnerModule)> {
        let found = self.files.get(file.idx());
        let calls = found.map_or(&[][..], |found| &found.calls[..]);
        calls
            .iter()
            .filter_map(move |&(call, index)| Some((call, &found?.modules[index as usize])))
    }

    /// The calls that make a function which evaluates a module.
    pub fn requests_in(&self, file: FileId) -> impl Iterator<Item = (ExprId, &InnerModule)> {
        let found = self.files.get(file.idx());
        let requests = found.map_or(&[][..], |found| &found.requests[..]);
        let requests = requests.iter();
        requests.filter_map(move |&(call, index)| Some((call, &found?.modules[index as usize])))
    }

    pub fn of_call(&self, files: &Files<'_>, file: FileId, call: ExprId) -> Option<&InnerModule> {
        let found = self.files.get(file.idx())?;
        if found.calls.is_empty() {
            return None;
        }
        let call = files.hir(file).skip_type_assertions(call);
        let (_, index) = find_by_key(&found.calls, call, |entry| entry.0)?;
        Some(&found.modules[index as usize])
    }

    /// The body of the CommonJS module whose exports the call returns.
    pub fn body_of_call(&self, files: &Files<'_>, file: FileId, call: ExprId) -> Option<FnId> {
        if let Some(inner) = self.of_call(files, file, call) {
            return (inner.kind == InnerModuleKind::CommonJs).then_some(inner.callback);
        }
        let found = self.files.get(file.idx())?;
        if found.nested_bodies.is_empty() {
            return None;
        }
        let (hir, bound) = (files.hir(file), files.bound(file));
        let ExprKind::Call(site) = hir[hir.skip_type_assertions(call)].kind else {
            return None;
        };
        let callee = hir.skip_type_assertions(hir[site].callee);
        let (ExprKind::Ident(_), Binding::Symbol(symbol)) =
            (hir[callee].kind, bound.binding(callee))
        else {
            return None;
        };
        find_by_key(&found.nested_bodies, symbol, |entry| entry.0).map(|entry| entry.1)
    }

    pub fn enclosing(
        &self,
        files: &Files<'_>,
        file: FileId,
        expression: ExprId,
    ) -> Option<&InnerModule> {
        if self.of_file(file).is_empty() {
            return None;
        }
        let functions = find_functions_around(files.hir(file), files.bound(file), expression)?;
        let mut outermost_first = functions.iter().rev();
        outermost_first.find_map(|&function| self.of_callback(file, function))
    }

    /// The object literal that holds the bodies of the modules in a bundler's runtime.
    pub fn literal_of_bodies(&self, file: FileId) -> Option<ExprId> {
        let bootstrap = self.files.get(file.idx()).and_then(|found| found.bootstrap);
        bootstrap.map(|it| it.literal)
    }

    pub fn is_literal_of_bodies(&self, file: FileId, expression: ExprId) -> bool {
        self.literal_of_bodies(file) == Some(expression)
    }

    /// The call that starts browserify's runtime: all that it does is evaluate its entry.
    pub fn is_start_of_bundle(&self, file: FileId, expression: ExprId) -> bool {
        let bootstrap = self.files.get(file.idx()).and_then(|found| found.bootstrap);
        bootstrap.is_some_and(|it| it.call == expression)
    }

    /// The helper that `callee` names as a member of the function that evaluates the bodies in webpack's runtime.
    pub fn helper_of_member(
        &self,
        files: &Files<'_>,
        file: FileId,
        callee: ExprId,
    ) -> Option<&KnownFunction> {
        let found = self.files.get(file.idx())?;
        if found.helpers.is_empty() {
            return None;
        }
        let (hir, bound) = (files.hir(file), files.bound(file));
        let (object, MemberKey::Name(name)) = hir.member_key(hir.skip_type_assertions(callee))?
        else {
            return None;
        };
        let object = hir.skip_type_assertions(object);
        let (ExprKind::Ident(_), Binding::Symbol(symbol)) =
            (hir[object].kind, bound.binding(object))
        else {
            return None;
        };
        found.names_of_require.binary_search(&symbol).ok()?;
        let helper = found.helpers.iter().find(|helper| helper.0 == name)?;
        Some(&helper.1)
    }

    /// The object that webpack's runtime creates for a module whose body lets it escape.
    pub fn module_object(&self, file: FileId) -> Option<ModuleObject> {
        self.files.get(file.idx())?.bootstrap?.module_object
    }

    /// The function that evaluates the bodies in webpack's runtime.
    pub fn require_function(&self, file: FileId) -> Option<SymbolId> {
        self.files.get(file.idx())?.bootstrap?.require.some()
    }

    #[cfg(test)]
    pub fn is_exports_object(
        &self,
        files: &Files<'_>,
        file: FileId,
        expression: ExprId,
    ) -> Option<FnId> {
        let (hir, bound) = (files.hir(file), files.bound(file));
        let symbol_of = |name: ExprId| {
            let name = hir.skip_type_assertions(name);
            match (hir[name].kind, bound.binding(name)) {
                (ExprKind::Ident(_), Binding::Symbol(symbol)) => Some(symbol),
                _ => None,
            }
        };
        let mut modules = self.of_file(file).iter();
        if let Some(symbol) = symbol_of(expression) {
            let module = modules.find(|module| module.exports_parameter == Some(symbol))?;
            return Some(module.callback);
        }
        let (object, MemberKey::Name(name)) =
            hir.member_key(hir.skip_type_assertions(expression))?
        else {
            return None;
        };
        let symbol = symbol_of(object)?;
        let module = modules.find(|module| module.module_parameter == Some(symbol))?;
        (name == known::exports).then_some(module.callback)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtins::id::BuiltinId;
    use crate::ir::run_serially;
    use crate::modules::testing::{file_named, with_graph};

    const BUN: &str = r#"var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __esm = (fn, res) => () => (fn && (res = fn((fn = 0))), res);
var __esmRethrows = (fn, res, err) => () => {
  if (fn)
    try {
      res = fn((fn = 0));
    } catch (e) {
      err = [e];
    }
  if (err) throw err[0];
  return res;
};
"#;

    fn compute(files: &Files<'_>, helpers: &KnownHelpers) -> WrappedModules {
        let nothing_has = |_: Atom| false;
        WrappedModules::compute(files, helpers, &nothing_has, &[], &|_| false, &run_serially)
    }

    fn holders_in(body: &str) -> Vec<String> {
        let main = format!("{BUN}{body}");
        holders_of(&[("main.mjs", main.as_str())], "main.mjs")
    }

    fn holders_of(files: &[(&str, &str)], name: &str) -> Vec<String> {
        with_graph(files, |_, bind_input| {
            let files = bind_input.files;
            let helpers = KnownHelpers::compute(files, &run_serially);
            let wrapped = compute(files, &helpers);
            let file = file_named(bind_input, name);
            let modules = wrapped.of_file(file).iter();
            modules
                .map(|module| {
                    let name = files.bound(file).symbol(module.holder).name;
                    let name = String::from_utf8_lossy(files.atoms.bytes(name)).into_owned();
                    match module.caches_evaluation_error {
                        true => name + "!",
                        false => name,
                    }
                })
                .collect()
        })
    }

    #[test]
    fn a_chain_of_wrapped_modules_is_found() {
        let body = r#"var require_a = __commonJS((exports) => { exports.a = 1; });
var require_b = __commonJS((exports, module) => { var a = require_a(); module.exports = a; });
var value;
var init_c = __esm(() => { value = require_b(); });
var init_d = __esmRethrows(() => { init_c(); });
init_d();
export default require_b();
"#;
        assert_eq!(
            holders_in(body),
            ["require_a", "require_b", "init_c", "init_d!"]
        );
    }

    #[test]
    fn a_function_that_is_the_first_member_of_a_literal_is_found() {
        let body = r#"var require_a = __commonJS({ "src/a.js"(exports) { exports.a = 1; } });
var require_b = __commonJS({ "src/b.js"(exports, module) { module.exports = require_a(); } });
var value;
var init_c = __esm({ "src/c.js"() { value = require_b(); } });
init_c();
"#;
        let by_keys = r#"var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[Object.keys(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[Object.keys(fn)[0]])(fn = 0)), res;
};
"#;
        let by_own_names = r#"var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
"#;
        for helpers in [by_keys, by_own_names] {
            let main = format!("{helpers}{body}");
            let found = with_graph(&[("main.mjs", main.as_str())], |_, bind_input| {
                let files = bind_input.files;
                let helpers = KnownHelpers::compute(files, &run_serially);
                let wrapped = compute(files, &helpers);
                wrapped.of_file(file_named(bind_input, "main.mjs")).len()
            });
            assert_eq!(found, 3, "{helpers}");
        }
    }

    #[test]
    fn the_helpers_behind_the_alias_of_require_are_certain() {
        let main = r#"var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
function lazy() { return require_a(); }
var require_a = __commonJS({ "src/a.js"(exports) { exports.a = 1; } });
lazy();
"#;
        assert_eq!(holders_of(&[("main.mjs", main)], "main.mjs"), ["require_a"]);
    }

    #[test]
    fn a_file_whose_body_may_run_again_keeps_its_variables() {
        let main = format!(
            "{BUN}var require_a = __commonJS((exports) => {{ exports.a = 1; }});\nrequire_a();"
        );
        with_graph(&[("main.mjs", main.as_str())], |_, bind_input| {
            let files = bind_input.files;
            let helpers = KnownHelpers::compute(files, &run_serially);
            let wrapped =
                WrappedModules::compute(files, &helpers, &|_| false, &[], &|_| true, &run_serially);
            assert!(
                wrapped
                    .of_file(file_named(bind_input, "main.mjs"))
                    .is_empty()
            );
        });
    }

    #[test]
    fn a_holder_that_is_more_than_called_is_a_plain_variable() {
        let uses = [
            "console.log(require_a);",
            "require_a(1);",
            "require_a?.();",
            "new require_a();",
            "export { require_a };",
            "require_a = null;",
            "eval(\"\");",
        ];
        for other_use in uses {
            let body = format!(
                "var require_a = __commonJS((exports) => {{ exports.a = 1; }});\nrequire_a();\n{other_use}"
            );
            assert_eq!(holders_in(&body), [""; 0], "{other_use}");
        }
    }

    #[test]
    fn a_function_that_sees_how_it_is_called_is_a_plain_function() {
        let callbacks = [
            "function (exports) { exports.a = arguments.length; }",
            "function (exports) { exports.a = this; }",
            "function (exports) { exports.a = new.target; }",
            "function named(exports) { exports.a = 1; }",
            "(exports) => { exports = {}; }",
            "(exports, module) => { module.id; }",
            "(exports, module) => { delete module.exports; }",
            "(exports, module, more) => {}",
            "(exports = {}) => {}",
            "async (exports) => {}",
            "(exports) => exports",
        ];
        for callback in callbacks {
            let body = format!("var require_a = __commonJS({callback});\nrequire_a();");
            assert_eq!(holders_in(&body), [""; 0], "{callback}");
        }
        let own =
            "(exports) => { exports.f = function () { return [this, arguments, new.target]; }; }";
        let body = format!("var require_a = __commonJS({own});\nrequire_a();");
        assert_eq!(holders_in(&body), ["require_a"]);
        let returns = "var init_a = __esm(() => { return 1; });\ninit_a();";
        assert_eq!(holders_in(returns), [""; 0]);
    }

    #[test]
    fn a_call_that_may_come_ahead_of_the_definition_keeps_the_variable() {
        let ahead = "require_a();\nvar require_a = __commonJS((exports) => {});";
        assert_eq!(holders_in(ahead), [""; 0]);
        let through_a_declaration = r#"function lazy() { return require_a(); }
globalThis.hook(lazy);
var require_a = __commonJS((exports) => {});
"#;
        assert_eq!(holders_in(through_a_declaration), [""; 0]);
        let declaration_in_the_head = r#"function lazy() { return require_a(); }
var require_a = __commonJS((exports) => {});
globalThis.hook(lazy);
"#;
        assert_eq!(holders_in(declaration_in_the_head), ["require_a"]);
        let through_another_body = r#"var require_b = __commonJS((exports) => { require_a(); });
require_b();
var require_a = __commonJS((exports) => {});
"#;
        assert_eq!(holders_in(through_another_body), ["require_b"]);
        let behind_code = r#"var require_b = __commonJS((exports) => { require_a(); });
globalThis.effect();
var require_a = __commonJS((exports) => {});
require_b();
"#;
        assert_eq!(holders_in(behind_code), ["require_b", "require_a"]);
        let through_a_function_that_goes_somewhere = r#"var require_b = __commonJS((exports) => { require_a(); });
globalThis.hook(require_b);
var require_a = __commonJS((exports) => {});
"#;
        assert_eq!(holders_in(through_a_function_that_goes_somewhere), [""; 0]);
        let through_two_bodies = r#"var require_c = __commonJS((exports) => { require_b(); });
var require_b = __commonJS((exports) => { require_a(); });
require_c();
var require_a = __commonJS((exports) => {});
"#;
        assert_eq!(holders_in(through_two_bodies), ["require_c", "require_b"]);
        let bodies_that_only_call_each_other = r#"var require_b = __commonJS((exports) => { require_a(); });
var require_a = __commonJS((exports) => { require_b(); });
"#;
        assert_eq!(
            holders_in(bodies_that_only_call_each_other),
            ["require_b", "require_a"]
        );
    }

    #[test]
    fn a_function_declaration_that_others_can_call_early_keeps_the_variables() {
        let bundle = format!(
            "import {{ one }} from \"./leaf.mjs\";\n{BUN}var require_a = __commonJS((exports) => {{ exports.a = one; }});\nexport function run() {{ return require_a().a; }}\n"
        );
        let holders = |main: &str, leaf: &str, other: &str| {
            let files = [
                ("main.mjs", main),
                ("bundle.mjs", bundle.as_str()),
                ("leaf.mjs", leaf),
                ("other.cjs", other),
            ];
            holders_of(&files, "bundle.mjs")
        };
        let main = "import \"./other.cjs\";\nimport { run } from \"./bundle.mjs\";\nrun();";
        let leaf = "export const one = 1;";
        assert_eq!(holders(main, leaf, ""), ["require_a"]);
        let on_a_cycle = "import { run } from \"./bundle.mjs\";\nexport const one = run;";
        assert_eq!(holders(main, on_a_cycle, ""), [""; 0]);
        let required = "globalThis.hook = () => require(\"./bundle.mjs\").run();";
        assert_eq!(holders(main, leaf, required), [""; 0]);
        let importer_on_a_cycle = "import \"./other.cjs\";\nimport \"./main.mjs\";\nimport { run } from \"./bundle.mjs\";\nexport function early() { return run(); }";
        assert_eq!(holders(importer_on_a_cycle, leaf, ""), [""; 0]);
        let imported_later =
            "import \"./other.cjs\";\nimport(\"./bundle.mjs\").then(bundle => bundle.run());";
        assert_eq!(holders(imported_later, leaf, ""), ["require_a"]);
    }

    #[test]
    fn a_call_in_a_default_or_a_case_is_a_call_like_any_other() {
        for call in [
            "const { a = require_a() } = {};",
            "const [a = require_a()] = [];",
            "switch (1) { case require_a(): }",
            "function late({ a = require_a() }) {} late({});",
            "class C { m(k) { switch (k) { case super.k: return new.target; } } }\nrequire_a();",
        ] {
            let body =
                format!("var require_a = __commonJS((exports) => {{ exports.a = 1; }});\n{call}");
            assert_eq!(holders_in(&body), ["require_a"], "{call}");
        }
    }

    #[test]
    fn a_statement_that_declares_something_else_too_keeps_its_code() {
        let two_holders =
            "var require_a = __commonJS((exports) => {}), require_b = __commonJS((exports) => {});";
        assert_eq!(holders_in(two_holders), ["require_a", "require_b"]);
        let another_variable = "var require_a = __commonJS((exports) => {}), other = 1;";
        assert_eq!(holders_in(another_variable), [""; 0]);
    }

    fn bodies_in(main: &str) -> usize {
        bodies_replacing(main, &[])
    }

    fn bodies_replacing(main: &str, replaced: &[BuiltinId]) -> usize {
        with_graph(&[("main.cjs", main)], |_, bind_input| {
            let replaced: Vec<u32> = replaced.iter().map(|it| it.to_wire()).collect();
            let files = bind_input.files;
            let helpers = KnownHelpers::compute(files, &run_serially);
            let every_object_has = |name| bind_input.every_object_has(name);
            let wrapped = WrappedModules::compute(
                files,
                &helpers,
                &every_object_has,
                &replaced,
                &|_| false,
                &run_serially,
            );
            wrapped.of_file(file_named(bind_input, "main.cjs")).len()
        })
    }

    fn webpack_bundle(first_body: &str, use_of_modules: &str) -> String {
        format!(
            "(() => {{ var e = {{ 1: {first_body}, \"./b.js\": (e, t) => {{ t.b = 1; }} }}, t = {{}};
function i(n) {{ var r = t[n]; if (void 0 !== r) return r.exports; var s = t[n] = {{ exports: {{}} }}; return e[n](s, s.exports, i), s.exports }}
i.d = () => {{}};
{use_of_modules}
}})();"
        )
    }

    #[test]
    fn webpack_bodies_are_inner_modules() {
        let body = "(e, t, i) => { t.a = i(\"./b.js\").b; }";
        for use_of_modules in [
            "console.log(i(1).a);",
            "(() => { var a = i(\"1\"); console.log(a.a); })();",
            "var later = () => i(1); later();",
            "Promise.resolve().then(i.bind(i, 1)).then((it) => console.log(it.a));",
            "",
        ] {
            let main = webpack_bundle(body, use_of_modules);
            assert_eq!(bodies_in(&main), 2, "{use_of_modules}");
        }
        for body in [
            "function (e, t, i) { e.exports = class {}; }",
            "(e) => { e.exports = require(\"node:fs\"); }",
            "(e, t, i) => { i.d(t, {}); }",
            "() => {}",
        ] {
            let main = webpack_bundle(body, "i(1);");
            assert_eq!(bodies_in(&main), 2, "{body}");
        }
        let unminified =
            "var modules = ({ \"./a.js\": ((module, exports, require) => { exports.a = 1; }) });
var cache = {};
function require_(id) {
  var cached = cache[id];
  if (cached !== undefined) { return cached.exports; }
  var module = cache[id] = { id: id, loaded: false, exports: {} };
  modules[id].call(module.exports, module, module.exports, require_);
  module.loaded = true;
  return module.exports;
}
require_(\"./a.js\");";
        assert_eq!(bodies_in(unminified), 1);
    }

    fn bundle_of_one(body: &str, call: &str) -> String {
        format!(
            "var modules = ({{ \"./a.js\": ({body}) }});
var cache = {{}};
function require_(id) {{
  var cached = cache[id];
  if (cached !== undefined) {{ return cached.exports; }}
  var module = cache[id] = {{ id: id, loaded: false, exports: {{}} }};
  modules[id]{call};
  module.loaded = true;
  return module.exports;
}}
require_(\"./a.js\");"
        )
    }

    #[test]
    fn this_of_a_body_may_be_its_exports() {
        let by_this = ".call(module.exports, module, module.exports, require_)";
        let by_another = ".call(module, module, module.exports, require_)";
        let plain = "(module, module.exports, require_)";
        for (body, expected) in [
            ("function (m, e, r) { this.a = 1; e.b = this; }", [1, 0, 0]),
            ("function () { (() => { this.a = 1; })(); }", [1, 0, 0]),
            (
                "function (m, e) { e.f = function () { return this; }; }",
                [1, 0, 1],
            ),
            ("(m, e) => { e.a = this; }", [0, 0, 0]),
            (
                "function (m, e) { e = m.exports = { a: 1 }; e.b = 2; }",
                [1, 0, 1],
            ),
            ("(m, e) => { e = {}; }", [1, 0, 1]),
            ("function (m, e) { this.a = arguments.length; }", [0, 0, 0]),
            ("function (m, e) { this.a = new.target; }", [0, 0, 0]),
        ] {
            for (call, expected) in [by_this, by_another, plain].into_iter().zip(expected) {
                assert_eq!(
                    bodies_in(&bundle_of_one(body, call)),
                    expected,
                    "{body} {call}"
                );
            }
        }
    }

    #[test]
    fn the_object_of_a_module_may_escape() {
        for body in [
            "(e, t, i) => { t.a = e.id; }",
            "(e, t, i) => { e = i.nmd(e); t.a = 1; }",
            "(e, t, i) => { globalThis.kept = e; return; }",
            "function (e, t, i) { for (var k in e) t[k] = 1; }",
            "(e, t, i) => { delete e.exports; }",
        ] {
            let main = webpack_bundle(body, "i.nmd = (e) => e; i(1);");
            assert_eq!(bodies_in(&main), 2, "{body}");
        }
        let call = ".call(module.exports, module, module.exports, require_)";
        for (body, expected) in [
            ("(m) => { globalThis.kept = m; }", 1),
            ("(m) => { m = null; }", 1),
            ("(m) => { globalThis.kept = m; return; }", 0),
            ("(m) => { with (globalThis) { kept = m; } }", 0),
            ("(m) => { globalThis.kept = [m, arguments]; }", 0),
        ] {
            assert_eq!(bodies_in(&bundle_of_one(body, call)), expected, "{body}");
        }
        let body = "(m) => { globalThis.kept = m; }";
        let main = bundle_of_one(body, call);
        for (runtime, expected) in [
            ("{ id: id, exports: {} }", 1),
            ("{ exports: {}, id: id, loaded: !1, parent: null }", 1),
            ("{ id: cache, loaded: false, exports: {} }", 0),
            ("{ 0: 1, exports: {} }", 0),
        ] {
            let main = main.replace("{ id: id, loaded: false, exports: {} }", runtime);
            assert_eq!(bodies_in(&main), expected, "{runtime}");
        }
        let numeric = main.replace("\"./a.js\"", "7");
        assert_eq!(bodies_in(&numeric), 1);
        assert_eq!(bodies_in(&format!("{numeric} require_(\"7\");")), 0);
    }

    #[test]
    fn keeps_bodies_reachable_elsewhere() {
        let body = "(e, t, i) => { t.a = 1; }";
        for use_of_modules in [
            "i(globalThis.id);",
            "i(2);",
            "globalThis.require = i;",
            "i.m = e;",
            "i.c = t;",
            "i.t = function (n) { return this(n); };",
            "delete i.d;",
            "i(1, 2);",
            "new i(1);",
            "i?.(1);",
            "globalThis.later = i.bind(i, 1);",
            "Promise.resolve().then(i.bind(null, 1));",
            "Promise.resolve().then(i.bind(i, 2));",
            "Promise.resolve().then(i.bind(i, globalThis.id));",
            "Promise.resolve().then(i.bind(i, 1), console.log);",
            "eval(\"\");",
            "e = null;",
            "for (var k in e) console.log(k);",
        ] {
            let main = webpack_bundle(body, use_of_modules);
            assert_eq!(bodies_in(&main), 0, "{use_of_modules}");
        }
        for body in [
            "function (e, t, i) { t.a = this; }",
            "(e, t, i) => { t.a = outer; }",
            "(e, t, i) => { i = null; }",
            "(e, t, i) => { t.a = i; }",
            "async (e, t, i) => {}",
            "(e, t, i, more) => {}",
            "globalThis.body",
        ] {
            let main = webpack_bundle(body, "var outer = 1; i(1);");
            assert_eq!(bodies_in(&main), 0, "{body}");
        }
        for name in ["\"constructor\"", "toString", "__defineGetter__"] {
            let main = webpack_bundle(body, "i(1);").replace("\"./b.js\"", name);
            assert_eq!(bodies_in(&main), 0, "{name}");
        }
        let main = webpack_bundle(body, "Promise.resolve().then(i.bind(i, 1));");
        assert_eq!(bodies_replacing(&main, &[]), 2);
        assert_eq!(
            bodies_replacing(&main, &[BuiltinId::FunctionPrototypeBind]),
            0
        );
        let main = webpack_bundle(body, "i(1);");
        let ahead = main.replace("(() => { var e", "(() => { globalThis.hook(i); var e");
        let in_a_function = format!("function again() {{ {main} }} again(); again();");
        let in_a_loop = format!("for (var k = 0; k < 2; k++) {{ {main} }}");
        for main in [ahead, in_a_function, in_a_loop] {
            assert_eq!(bodies_in(&main), 0, "{main}");
        }
    }

    #[test]
    fn the_exports_of_an_inner_module_are_found_by_binding() {
        let main = format!(
            "{BUN}var require_a = __commonJS((e, m) => {{ e.a = 1; m.exports.b = 2; }});\nrequire_a();"
        );
        with_graph(&[("main.mjs", main.as_str())], |_, bind_input| {
            let files = bind_input.files;
            let helpers = KnownHelpers::compute(files, &run_serially);
            let wrapped = compute(files, &helpers);
            let file = file_named(bind_input, "main.mjs");
            let [module] = wrapped.of_file(file) else {
                panic!("the file has one inner module");
            };
            let hir = files.hir(file);
            let expressions = (0..hir.exprs.len() as u32).map(ExprId);
            let found = expressions
                .filter(|&it| wrapped.is_exports_object(files, file, it) == Some(module.callback));
            assert_eq!(found.count(), 2);
            assert_eq!(wrapped.calls_in(file).count(), 1);
            let StmtKind::Var(declarations) = hir[module.statement].kind else {
                panic!("a variable statement declares the holder");
            };
            assert_eq!(declarations.len(), 1);
        });
    }
}
