use bun_ast::Target;
use bun_resolve_builtins::{Alias, Cfg};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, BindingInitializer, Bound, CommonJsVariable, Decl};
use bun_sema::fold::{Constant, Decisions, FoldedValue};
use bun_sema::hir::{
    self, BinOp, Branches, CallId, Chain, ExprId, ExprKind, IdList, ImportEqualsId, OtherValues,
};
use bun_sema::import_sites::{
    ImportSite, ImportSiteKind, ImportSpecifier, JsxImport, OwnRequire, RequireCallForm,
    ResolvedForm, ResolvedFrom, does_import_meta_resolve_ask_resolver,
    find_base_that_a_call_made_of_own_file, find_holder_of_require_made_for_choice,
    find_module_printed_as_require, find_names_folded_by_transpiler,
    find_other_values_of_own_require, find_own_require, find_require_call,
    holds_import_meta_require, is_call_of_create_require,
    is_create_require_behind_get_builtin_module, is_create_require_called_through_call,
    is_load_found_late, is_made_require, is_require_made_for_own_file,
    may_call_have_made_base_of_require, may_call_have_made_path, may_require_get_members,
    may_still_be_undefined,
};
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::ExternalKind;
use bun_sema::util::FxHashMap;
use smallvec::{SmallVec, smallvec};

use crate::builtins::id::{BuiltinId, RuntimeModule};
use crate::builtins::table::{self, Platforms, Scope};
use crate::builtins::{Mutability, Resolved};
use crate::ir::generated::{BlockRole, ModuleRequestKind};
use crate::ir::{
    BlockId, Edge, LocalVariable, ModuleId, StringId, TypeTable, ValueId, VariableKey,
};
use crate::load::contents::load_names::{
    PathAlone, modules_named_in, resolve_loads_through_imported_loaders,
};
use crate::load::loader_aliases::{LoaderAlias, resolve_loader_alias};
use crate::load::sources::parsed_source;
use crate::lower::call::{self, Arguments, Callee};
use crate::lower::expression::Tail;
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, commonjs};
use crate::modules::{
    Candidates, ImportBinding, ModuleFailureId, ModuleKind, ModuleRef, Site, SiteAnswer,
    SpelledModule,
};

#[derive(Copy, Clone)]
enum ModuleOperation {
    Require,
    RequireResolve,
    ImportMetaResolve,
}

#[derive(Copy, Clone)]
enum ComputedLoad {
    Require {
        looks_in_cache: bool,
        is_read_by_transpiler: bool,
    },
    Import,
    Resolve,
}

#[derive(Copy, Clone)]
struct KnownOfName {
    all_names_are_known: bool,
    names_no_library_module: bool,
}

#[derive(Copy, Clone)]
struct AnswersOfResolver<'a> {
    form: ResolvedForm,
    spelled_modules: &'a [SpelledModule],
    known_of_name: KnownOfName,
}

#[derive(Copy, Clone)]
enum CalleeKnowledge {
    Unresolved,
    Bound,
    Expected(BuiltinId),
}

#[derive(Copy, Clone)]
struct NameLookedUpInCache {
    text: ValueId,
    is_node_builtin: bool,
    name_for_host: Option<&'static [u8]>,
}

#[derive(Copy, Clone)]
struct PlannedSite {
    target: ModuleRef,
    is_bare: bool,
    records: bool,
    is_by_made_require: bool,
    yields_value: bool,
}

#[derive(Copy, Clone)]
struct AnsweredSite<'g> {
    specifier: ImportSpecifier,
    specifier_node: ExprId,
    answer: SiteAnswer<'g>,
    plan: Option<PlannedSite>,
    resolved_from: Option<FileId>,
    looks_in_cache: bool,
    is_read_by_transpiler: bool,
    has_arm_for_transpiler_alone: bool,
    maker_of_asked_require: Option<FileId>,
}

impl AnsweredSite<'_> {
    fn in_one_arm(self, is_other_arm_read: bool) -> Self {
        let plan = self.plan.map(|plan| PlannedSite {
            is_bare: false,
            yields_value: plan.yields_value || is_other_arm_read,
            ..plan
        });
        AnsweredSite { plan, ..self }
    }
}

fn create_plan(
    site: Option<Site>,
    is_by_made_require: bool,
    yields_value: impl FnOnce() -> bool,
) -> Option<PlannedSite> {
    match site? {
        Site::Evaluate {
            target,
            is_bare,
            records,
        } => Some(PlannedSite {
            target,
            is_bare,
            records,
            is_by_made_require,
            yields_value: yields_value(),
        }),
        Site::AsToday => None,
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn classify_callee(&self, callee: ExprId) -> CalleeKnowledge {
        let callee = self.skip_type_syntax(callee);
        let Some(Resolved::Builtin(callee_path)) = self.builtins.of_expr(callee) else {
            return CalleeKnowledge::Unresolved;
        };
        let is_require = find_module_printed_as_require(self.hir, self.bound, callee).is_some();
        let root = match self.hir.member_key(callee) {
            Some((object, _)) if !is_require => self.skip_type_syntax(object),
            _ => callee,
        };
        let Some(Resolved::Builtin(root_path)) = self.builtins.of_expr(root) else {
            return CalleeKnowledge::Unresolved;
        };
        let may_member_be_replaced = match self.hir[root].kind {
            ExprKind::ImportMeta => self.bound.import_meta_may_be_modified(),
            _ => {
                root != callee
                    && root_path.id == BuiltinId::ModuleRequire
                    && may_require_get_members(self.hir, self.bound)
            }
        };
        let may_holder_be_replaced = matches!(self.hir[root].kind, ExprKind::Ident(_))
            && matches!(self.bound.binding(root), Binding::Symbol(_))
            && self.inputs.modules.holds_replaceable_variable(self.file);
        match table::entry(root_path.id).scope {
            Scope::Realm => CalleeKnowledge::Expected(callee_path.id),
            Scope::Module if may_member_be_replaced || may_holder_be_replaced => {
                CalleeKnowledge::Expected(callee_path.id)
            }
            Scope::Module => match self.inputs.modules.kind(self.file) {
                ModuleKind::CommonJs => match root_path.mutability {
                    Mutability::AlwaysLocked => CalleeKnowledge::Bound,
                    Mutability::ConstantUnlessWritten | Mutability::ChangesOnItsOwn => {
                        CalleeKnowledge::Expected(callee_path.id)
                    }
                },
                ModuleKind::SourceText | ModuleKind::Data | ModuleKind::RuntimeSource => {
                    CalleeKnowledge::Bound
                }
                ModuleKind::Runtime | ModuleKind::External => {
                    unreachable!("a module of this kind has no self")
                }
            },
        }
    }

    fn find_modules_of_every_value(
        &self,
        specifier: ExprId,
        spelled_modules: &[SpelledModule],
    ) -> Option<Vec<SpelledModule>> {
        let hir = self.hir;
        if specifier.is_none() {
            return None;
        }
        let root = self.skip_type_syntax(specifier);
        let ExprKind::Cond { .. } = hir[root].kind else {
            return None;
        };
        let mut modules: Vec<SpelledModule> = Vec::new();
        let mut stack = vec![root];
        while let Some(alternative) = stack.pop() {
            let alternative = self.skip_type_syntax(alternative);
            if let ExprKind::Cond { branches, .. } = hir[alternative].kind {
                let Branches { yes, no } = hir.branches(branches);
                stack.extend([no, yes]);
                continue;
            }
            let text = self.find_constant_text(alternative)?;
            let spelled = *spelled_modules.iter().find(|it| it.spelling == text)?;
            if !modules.contains(&spelled) {
                modules.push(spelled);
            }
        }
        Some(modules)
    }

    fn find_constant_text(&self, expression: ExprId) -> Option<Atom> {
        match self.decisions().constant(self.hir, expression) {
            FoldedValue::Constant(Constant::String(text))
            | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) => Some(text),
            _ => None,
        }
    }

    fn is_whole_path_for_loader(&self, answer: SiteAnswer<'_>, argument: ExprId) -> bool {
        let SiteAnswer::Module(module) = answer else {
            return false;
        };
        argument.is_some()
            && self.inputs.modules.external_kind(module) == Some(ExternalKind::UncompiledCode)
            && self.is_path_from_own_directory(argument)
    }

    fn is_name_for_transpiler_alone(&self, name: Atom) -> bool {
        Alias::bun_prefixed_builtin(self.queries.atom_bytes(name)).is_some()
    }

    fn builtin_name_as_asked(&self, name: Atom, module: ModuleRef) -> Option<&[u8]> {
        let (name, alias) = self.builtin_named(name, module)?;
        alias.node_builtin.then_some(name)
    }

    fn is_read_by_transpiler(&self, callee: ExprId, name: ExprId) -> bool {
        self.is_callee_read_by_transpiler(callee) && self.is_name_read_by_transpiler(name)
    }

    fn has_arm_for_transpiler_alone(&self, name: ExprId) -> bool {
        let is_choice = |name: ExprId| matches!(self.hir[name].kind, ExprKind::Cond { .. });
        name.is_some()
            && is_choice(self.hir.skip_type_assertions(name))
            && !self.is_name_read_by_transpiler(name)
            && find_names_folded_by_transpiler(self.hir, self.decisions(), name)
                .iter()
                .any(|&arm| self.is_name_for_transpiler_alone(arm))
    }

    fn find_name_printed_by_transpiler(&self, arm: ExprId, joins_texts: bool) -> Option<&[u8]> {
        let is_one_text = match self.hir[arm].kind {
            ExprKind::String(_) => true,
            ExprKind::Template { exprs } => exprs.len() == 0,
            _ => false,
        };
        if !(joins_texts || is_one_text)
            || !(self.decisions()).is_constant_under_minify_syntax(self.hir, arm)
        {
            return None;
        }
        Alias::bun_prefixed_builtin(self.queries.atom_bytes(self.find_constant_text(arm)?))
    }

    fn is_callee_read_by_transpiler(&self, callee: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut callee = hir.skip_type_assertions(callee);
        while let ExprKind::Binary {
            op: BinOp::Comma,
            right,
            ..
        } = hir[callee].kind
        {
            callee = hir.skip_type_assertions(right);
        }
        let is_require_of_file = matches!(hir[callee].kind, ExprKind::Ident(_))
            && bound.binding(callee) == Binding::CommonJs(CommonJsVariable::Require);
        is_require_of_file || find_module_printed_as_require(hir, bound, callee).is_some()
    }

    fn is_name_read_by_transpiler(&self, name: ExprId) -> bool {
        let name = self.hir.skip_type_assertions(name);
        if (self.decisions()).is_constant_under_minify_syntax(self.hir, name) {
            return true;
        }
        let ExprKind::Cond { branches, .. } = self.hir[name].kind else {
            return false;
        };
        let Branches { yes, no } = self.hir.branches(branches);
        self.is_name_read_by_transpiler(yes) && self.is_name_read_by_transpiler(no)
    }

    fn builtin_named(&self, name: Atom, module: ModuleRef) -> Option<(&[u8], Alias)> {
        if !matches!(module, ModuleRef::Runtime(_) | ModuleRef::External { .. }) {
            return None;
        }
        let written = self.queries.atom_bytes(name);
        let name = Alias::bun_prefixed_builtin(written).unwrap_or(written);
        Some((name, Alias::get(name, Target::Bun, Cfg::default())?))
    }
}

pub(crate) fn lower_import_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::ImportCall { args } = hir[call].kind else {
        unreachable!("lower_import_call takes an ImportCall");
    };
    let position = hir[call].pos;
    let modules = lowering.file.inputs.modules;
    match modules.site_answer(lowering.file.file, ImportSiteKind::ImportCall(call)) {
        SiteAnswer::Module(module) => {
            let first = hir.ids(args).next();
            let specifier = lowering.lower_computed_specifier(SiteAnswer::Module(module), first);
            let options = hir.ids(args).nth(1);
            let options = options.map(|options| lowering.lower_expression(options));
            lowering.lower_arguments_for_effect(args, 1 + usize::from(options.is_some()));
            lowering.set_position(position);
            if let (Some(text), Some(node)) = (specifier, first)
                && (lowering.file).is_whole_path_for_loader(SiteAnswer::Module(module), node)
            {
                let referrer = lowering.file.module_id();
                return lowering
                    .builder
                    .import_dynamic(text, options, referrer, false, false);
            }
            let test = specifier.zip(first).and_then(|(text, node)| {
                let written = lowering.file.decisions().specifier(node);
                lowering.branch_on_path_made_by_call(written, node, text)
            });
            let Some(test) = test else {
                return lowering.emit_import_of_module(args, module, options);
            };
            let result = lowering.builder.create_variable(None);
            let done = lowering.create_block();
            lowering.continue_in(test.as_written);
            let loaded = lowering.emit_import_of_module(args, module, options);
            lowering.builder.write_variable(result, loaded);
            lowering.jump(done);

            lowering.continue_in(test.other);
            let error = lowering.emit_refusal_of_other_path(test.written, b"ERR_MODULE_NOT_FOUND");
            let rejected = lowering.emit_import_rejected_by_loader(error);
            lowering.builder.write_variable(result, rejected);
            lowering.jump(done);

            lowering.continue_in(done);
            lowering.builder.read_variable(result)
        }
        SiteAnswer::Computed(candidates) => {
            let mut arguments = hir.ids(args);
            let node = arguments.next().unwrap_or(ExprId::NONE);
            let specifier = if lowering.file.has_arm_for_transpiler_alone(node) {
                lowering.lower_name_as_transpiler_prints_it(node, true)
            } else if node.is_some() {
                lowering.lower_expression(node)
            } else {
                lowering.builder.undefined()
            };
            let second = arguments.next();
            let options = second.map(|second| lowering.lower_expression(second));
            lowering.lower_arguments_for_effect(args, 2);
            lowering.set_position(position);
            let referrer = lowering.file.module_id();
            let load = ComputedLoad::Import;
            let analysis = &lowering.file.compiled.analysis;
            let site = analysis.import_site_index(ImportSiteKind::ImportCall(call));
            let written = site.map_or(ImportSpecifier::Unknown, |site| {
                analysis.import_sites[site].specifier
            });
            let name = (node, written);
            if options.is_none() {
                return lowering.emit_computed_load(load, referrer, name, specifier, candidates);
            }
            lowering.emit_behind_test_of_name(load, name, specifier, &mut |this, is_path_alone| {
                (this.builder).import_dynamic(specifier, options, referrer, false, is_path_alone)
            })
        }
        SiteAnswer::Erased => {
            lowering.lower_arguments_for_effect(args, 0);
            lowering.set_position(position);
            lowering.builder.undefined()
        }
        SiteAnswer::Failed(failure) => {
            let mut arguments = hir.ids(args);
            if let (Some(first), Some(second)) = (arguments.next(), arguments.next()) {
                let specifier = lowering.lower_expression(first);
                let options = lowering.lower_expression(second);
                lowering.lower_arguments_for_effect(args, 2);
                lowering.set_position(position);
                let referrer = lowering.file.module_id();
                return lowering.builder.import_dynamic(
                    specifier,
                    Some(options),
                    referrer,
                    false,
                    false,
                );
            }
            let analysis = &lowering.file.compiled.analysis;
            let site = analysis.import_site_index(ImportSiteKind::ImportCall(call));
            let written = site.map(|site| analysis.import_sites[site].specifier);
            if let (Some(first), Some(ImportSpecifier::Constant(name))) =
                (hir.ids(args).next(), written)
                && modules.is_name_without_code_that_mocks_give(name)
            {
                let specifier = lowering.lower_expression(first);
                lowering.lower_arguments_for_effect(args, 1);
                lowering.set_position(position);
                let referrer = lowering.file.module_id();
                return (lowering.builder).import_dynamic(specifier, None, referrer, false, false);
            }
            lowering.lower_arguments_for_effect(args, 0);
            lowering.set_position(position);
            lowering.emit_rejected_import(failure)
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn emit_import_of_module(
        &mut self,
        arguments: IdList<ExprId>,
        module: ModuleRef,
        options: Option<ValueId>,
    ) -> ValueId {
        let decisions = self.file.decisions();
        if let Some(object) =
            find_object_replacing_namespace(self.file.hir, decisions, arguments, module)
        {
            let value = self.emit_builtin_import(object, None);
            return self.emit_settled_promise(BuiltinId::PromiseResolve, value);
        }
        if let ModuleRef::External { specifier, .. } = module
            && self.file.inputs.modules.external_kind(module) == Some(ExternalKind::HostValue)
        {
            let specifier = self.file.intern_atom(specifier);
            let specifier = self.builder.string(specifier);
            let referrer = self.file.module_id();
            return self
                .builder
                .import_dynamic(specifier, options, referrer, false, false);
        }
        self.emit_import_through_face(module, options)
    }

    fn emit_import_through_face(&mut self, module: ModuleRef, options: Option<ValueId>) -> ValueId {
        let module = self.file.inputs.modules.face(module).unwrap_or(module);
        let module = self.file.fragment.declare_module(module);
        let referrer = self.file.module_id();
        self.builder.import_module(module, options, referrer)
    }

    #[inline]
    fn find_whether_file_names_library_modules(&mut self) -> bool {
        if let Some(known) = self.does_file_name_library_modules {
            return known;
        }
        let (files, file) = (self.file.queries.files(), self.file.file);
        resolve_loads_through_imported_loaders(files, file);
        let source = parsed_source(files, file);
        let names_some = source.is_some_and(|source| !source.named_modules().is_empty());
        self.does_file_name_library_modules = Some(names_some);
        names_some
    }

    pub(crate) fn try_lower_module_call(
        &mut self,
        call: ExprId,
        chain_exit: Option<BlockId>,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        let ExprKind::Call(id) = hir[call].kind else {
            return None;
        };
        let (callee, arguments) = (hir[id].callee, hir[id].args);
        let analysis = &self.file.compiled.analysis;
        let Some(site) = analysis.import_site_of_call(call) else {
            if let Some(evaluated) = self.try_lower_inner_module_call(call) {
                return Some(evaluated);
            }
            let is_module_named = hir.ids(arguments).next().is_some_and(|argument| {
                self.find_whether_file_names_library_modules()
                    && names_library_module(self.file.queries.files(), self.file.file, argument)
            });
            let has_spread = has_spread_argument(hir, arguments);
            if is_module_named
                && !has_spread
                && let Some(loaded) = self.try_lower_library_module_named_to_made_require(call, id)
            {
                return Some(loaded);
            }
            if !has_spread
                && is_call_of_create_require(hir, self.file.bound, call)
                && let Some(made) = self.try_lower_create_require(call, id, chain_exit)
            {
                return Some(made);
            }
            if !is_module_named {
                return None;
            }
            return self.try_lower_choice_of_builtin_modules(call, id, chain_exit);
        };
        if is_load_found_late(hir, self.file.bound, self.file.decisions(), call) {
            return None;
        }
        let path_to_resolve_from = analysis.path_to_resolve_from(site);
        let resolved_from = path_to_resolve_from.and_then(|from| match from {
            ResolvedFrom::File(path) => {
                let queries = &self.file.queries;
                queries.files().by_path.get(queries.atom_bytes(path))
            }
            ResolvedFrom::PathFromOwnFolder(_) => None,
        });
        let site = analysis.import_sites[site];
        if has_spread_argument(hir, arguments) {
            return None;
        }
        let (bound, decisions) = (self.file.bound, Some(self.file.decisions()));
        let require_call = matches!(site.kind, ImportSiteKind::Require(_))
            .then(|| find_require_call(hir, bound, decisions, callee, arguments))
            .flatten();
        let replaced = self.file.inputs.replaced_builtins;
        let made = require_call.map_or(callee, |found| found.require);
        let is_replaced = |builtin: BuiltinId| replaced.binary_search(&(builtin as u32)).is_ok();
        let modules = self.file.inputs.modules;
        let is_maker_replaced = self.may_tests_replace_what_was_made()
            || is_replaced(BuiltinId::FunctionPrototypeCall)
            || is_replaced(BuiltinId::NodeModuleCreateRequire)
                && !is_made_by_imported_name(hir, bound, made);
        if is_maker_replaced
            && matches!(site.kind, ImportSiteKind::Require(_))
            && matches!(
                find_own_require(hir, bound, decisions, made),
                Some(OwnRequire::Made | OwnRequire::MadeForPath(_) | OwnRequire::MadeForChoice(_))
            )
        {
            return None;
        }
        let own_require = find_own_require(hir, bound, decisions, made);
        let is_of_other_file = matches!(
            own_require,
            Some(OwnRequire::OfOtherFile(_) | OwnRequire::MadeInOtherFile(_))
        );
        let exporter = match own_require {
            Some(OwnRequire::OfOtherFile(path) | OwnRequire::MadeInOtherFile(path)) => {
                let queries = &self.file.queries;
                queries.files().by_path.get(queries.atom_bytes(path))
            }
            _ => None,
        };
        let is_way_proof = exporter.is_some() && !self.may_way_from_file_be_replaced(exporter);
        let other_values = match is_of_other_file && !is_way_proof {
            true => OtherValues::Any,
            false => find_other_values_of_own_require(hir, bound, decisions, made),
        };
        if is_of_other_file && other_values == OtherValues::Any && exporter.is_none() {
            return None;
        }
        let test_of_value = match (other_values, exporter, own_require) {
            (OtherValues::None, ..) => CalleeTest::IsFilled,
            (OtherValues::Any, Some(exporter), Some(OwnRequire::OfOtherFile(_))) => {
                CalleeTest::IsRequireOf(exporter)
            }
            (OtherValues::Any, Some(exporter), Some(OwnRequire::MadeInOtherFile(_))) => {
                if !modules.is_code_of_program(ModuleRef::File(exporter)) {
                    return None;
                }
                CalleeTest::IsMadeIn(exporter)
            }
            (OtherValues::Falsy | OtherValues::Any, ..) => CalleeTest::IsTruthy,
        };
        let written = self.file.skip_type_syntax(callee);
        let given = require_call.map_or(arguments, |found| found.args);
        let answer = modules.site_answer(self.file.file, site.kind);
        let maker_of_asked_require = match (own_require, answer) {
            (_, SiteAnswer::Module(module))
                if matches!(
                    modules.interop(module).kind,
                    ModuleKind::Runtime | ModuleKind::RuntimeSource
                ) || modules.external_kind(module) == Some(ExternalKind::HostValue) =>
            {
                None
            }
            (Some(OwnRequire::Made), _) if may_call_have_made_base_of_require(hir, bound, made) => {
                Some(self.file.file)
            }
            (Some(OwnRequire::MadeForPath(path)), _)
                if may_call_have_made_path(hir, bound, path) =>
            {
                Some(self.file.file)
            }
            (Some(OwnRequire::MadeInOtherFile(_)), _) => exporter,
            _ => None,
        };
        let test_of_value = match (maker_of_asked_require, test_of_value) {
            (Some(_), CalleeTest::IsFilled) => CalleeTest::IsTruthy,
            _ => test_of_value,
        };
        let is_by_made_require = matches!(
            own_require,
            Some(
                OwnRequire::Made
                    | OwnRequire::MadeForPath(_)
                    | OwnRequire::MadeForChoice(_)
                    | OwnRequire::MadeInOtherFile(_)
            )
        );
        let operation = find_operation(&site, answer, given.len())?;
        let is_left_to_loader = matches!(answer, SiteAnswer::Module(ModuleRef::External { .. }));
        if matches!(
            path_to_resolve_from,
            Some(ResolvedFrom::PathFromOwnFolder(_))
        ) && (!matches!(answer, SiteAnswer::Module(_)) || is_left_to_loader)
        {
            return None;
        }
        if matches!(site.kind, ImportSiteKind::Require(_))
            && matches!(
                answer,
                SiteAnswer::Module(ModuleRef::Runtime(RuntimeModule::BunTest))
            )
        {
            self.emit_locked_builtin(BuiltinId::BunJest);
        }
        let site = AnsweredSite {
            specifier: site.specifier,
            specifier_node: site.specifier_node,
            answer,
            plan: create_plan(
                modules.stored_site(self.file.file, call),
                is_by_made_require,
                || modules.is_site_read_as_value(self.file.file, call),
            ),
            resolved_from,
            looks_in_cache: !matches!(site.kind, ImportSiteKind::GetBuiltinModule(_)),
            is_read_by_transpiler: matches!(site.kind, ImportSiteKind::Require(_))
                && require_call.is_none_or(|found| matches!(found.form, RequireCallForm::Direct))
                && self.file.is_read_by_transpiler(callee, site.specifier_node),
            has_arm_for_transpiler_alone: matches!(answer, SiteAnswer::Computed(_))
                && require_call.is_none_or(|found| matches!(found.form, RequireCallForm::Direct))
                && match (site.kind, hir.member_key(callee)) {
                    (ImportSiteKind::Require(_), _) => {
                        self.file.is_callee_read_by_transpiler(callee)
                    }
                    (ImportSiteKind::RequireResolve(_), Some((require, _))) => {
                        self.file.is_callee_read_by_transpiler(require)
                    }
                    _ => false,
                }
                && (self.file).has_arm_for_transpiler_alone(site.specifier_node),
            maker_of_asked_require,
        };
        if matches!(operation, ModuleOperation::RequireResolve) && given.len() > 1 {
            return None;
        }
        let method = require_call.and_then(|found| match found.form {
            RequireCallForm::Direct => None,
            RequireCallForm::Call => Some((found, BuiltinId::FunctionPrototypeCall)),
            RequireCallForm::Apply => Some((found, BuiltinId::FunctionPrototypeApply)),
        });
        let test = if let Some((found, expected)) = method {
            if matches!(test_of_value, CalleeTest::IsMadeIn(_)) {
                return None;
            }
            CalleeTest::Method {
                expected,
                form: found.form,
                require: own_require?,
                is_truthy: matches!(test_of_value, CalleeTest::IsTruthy),
                exporter: match test_of_value {
                    CalleeTest::IsRequireOf(exporter) => Some(exporter),
                    _ => None,
                },
            }
        } else if holds_import_meta_require(hir, bound, callee) {
            let may_be_another = bound.import_meta_may_be_modified()
                || modules.holds_replaceable_variable(self.file.file);
            match may_be_another {
                true => CalleeTest::Expected(BuiltinId::ModuleRequire),
                false => CalleeTest::IsFilled,
            }
        } else {
            match self.file.classify_callee(callee) {
                CalleeKnowledge::Unresolved if is_require_made_for_own_file(hir, bound, callee) => {
                    if other_values != OtherValues::None || maker_of_asked_require.is_some() {
                        return Some(lower_tested_call(
                            self,
                            call,
                            chain_exit,
                            test_of_value,
                            operation,
                            &site,
                        ));
                    }
                    if !may_still_be_undefined(hir, bound, callee) {
                        self.lower_expression(callee);
                        return Some(self.lower_untested_call(call, arguments, operation, &site));
                    }
                    CalleeTest::IsFilled
                }
                CalleeKnowledge::Unresolved => {
                    match find_own_require(hir, bound, decisions, callee)? {
                        OwnRequire::OfFile => CalleeTest::Expected(BuiltinId::ModuleRequire),
                        OwnRequire::OfOtherFile(_)
                        | OwnRequire::MadeInOtherFile(_)
                        | OwnRequire::Made
                        | OwnRequire::MadeForPath(_) => test_of_value,
                        OwnRequire::MadeForChoice(_) => CalleeTest::IsMadeIn(self.file.file),
                    }
                }
                CalleeKnowledge::Bound => {
                    if self.file.builtins.of_pure_expr(written).is_none() {
                        self.lower_expression_for_effect(callee);
                    }
                    return Some(self.lower_untested_call(call, arguments, operation, &site));
                }
                CalleeKnowledge::Expected(expected) => CalleeTest::Expected(expected),
            }
        };
        let loaded = lower_tested_call(self, call, chain_exit, test, operation, &site);
        Some(loaded)
    }

    fn try_lower_create_require(
        &mut self,
        call: ExprId,
        id: CallId,
        chain_exit: Option<BlockId>,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        let (bound, decisions) = (self.file.bound, self.file.decisions());
        let (written, arguments) = (hir[id].callee, hir[id].args);
        let own_require = find_own_require(hir, bound, Some(decisions), call);
        let is_behind_test = is_create_require_behind_get_builtin_module(hir, bound, written);
        let modules = self.file.inputs.modules;
        let is_imported = own_require == Some(OwnRequire::Made)
            && modules.is_require_made_by_file_imported(self.file.file);
        let choice = find_holder_of_require_made_for_choice(hir, bound, call);
        let question = self.find_question_on_base(call, arguments, own_require);
        if !is_behind_test && !is_imported && choice.is_none() && question.is_none() {
            return None;
        }
        let mut callee = self.lower_callee(written, chain_exit, None);
        if hir[id].chain == Chain::Start {
            let exit = chain_exit.expect("an optional call has the exit of its chain");
            callee.function = self.branch_if_expression_nullish(written, callee.function, exit);
        }
        let Arguments::Values(values) = self.lower_arguments(arguments) else {
            unreachable!("no argument is a spread");
        };
        let maker = match callee.this {
            Some(receiver) if is_create_require_called_through_call(hir, bound, call) => {
                self.emit_receiver_of_real_call(callee.function, receiver)
            }
            _ => callee.function,
        };
        if is_behind_test {
            self.refuse_other_create_require(maker);
        }
        let given = Arguments::Values(values.clone());
        let made = self.emit_call_expression(call, callee, given, Tail::No);
        if is_imported {
            self.keep_require_made_for_own_file(maker, made);
        }
        if let Some((_, place)) = choice {
            self.keep_require_if_base_is_own_file(maker, values[place], made);
        }
        match question {
            Some(QuestionOnBase::IsInOwnFolder { place }) => {
                self.note_require_made_for_other_folder(values[place], made);
            }
            Some(QuestionOnBase::IsPath { place, path }) => {
                let test = self.branch_on_written_path(path, true, values[place]);
                self.continue_in(test.other);
                self.branch_if_url_of_path_is_as_written(path, values[place], test.as_written);
                self.note_require(made);
                self.jump(test.as_written);
                self.continue_in(test.as_written);
            }
            None => {}
        }
        Some(made)
    }

    fn emit_receiver_of_real_call(&mut self, function: ValueId, receiver: ValueId) -> ValueId {
        let called = self.builder.create_variable(None);
        self.builder.write_variable(called, function);
        let real = self.emit_builtin_itself(BuiltinId::FunctionPrototypeCall);
        let is_real = self.builder.strict_eq(function, real);
        let by_real = self.create_block();
        let done = self.create_block();
        self.builder
            .branch(is_real, Edge::to(by_real), Edge::to(done));

        self.continue_in(by_real);
        self.builder.write_variable(called, receiver);
        self.jump(done);

        self.continue_in(done);
        self.builder.read_variable(called)
    }

    fn branch_if_url_of_path_is_as_written(
        &mut self,
        written: Atom,
        path: ValueId,
        as_written: BlockId,
    ) {
        let bytes = self.file.queries.atom_bytes(written).to_vec();
        let below = self.emit_text(bytes.strip_prefix(b".").unwrap_or(&bytes));
        let given_base = path;
        let is_text = self.builder.type_test(path, TypeTable::STRING);
        let of_text = self.create_block();
        let other = self.create_block();
        self.builder
            .branch(is_text, Edge::to(of_text), Edge::to(other));

        self.continue_in(of_text);
        let replace_all = self.emit_builtin_itself(BuiltinId::StringPrototypeReplaceAll);
        let separators = [self.emit_text(b"//"), self.emit_text(b"/")];
        let path = call::emit_call(self, replace_all, Some(path), &separators);
        let ends_with = self.emit_builtin_itself(BuiltinId::StringPrototypeEndsWith);
        let ends_as_folder = call::emit_call(self, ends_with, Some(path), &separators[1..]);
        let ends_as_folder = self.builder.to_boolean(ends_as_folder);
        let ends_alike = self.create_block();
        let (of_folder, of_file) = match bytes.ends_with(b"/") {
            true => (ends_alike, other),
            false => (other, ends_alike),
        };
        self.builder
            .branch(ends_as_folder, Edge::to(of_folder), Edge::to(of_file));

        self.continue_in(ends_alike);
        let given = self.emit_url_of_path(path);
        for directory in self.emit_own_directories() {
            let expected = self.builder.strcat(&[directory, below]);
            let expected = self.emit_url_of_path(expected);
            let is_as_written = self.builder.strict_eq(given, expected);
            let otherwise = self.create_block();
            self.builder
                .branch(is_as_written, Edge::to(as_written), Edge::to(otherwise));
            self.continue_in(otherwise);
        }
        self.jump(other);

        self.continue_in(other);
        let is_object = self.builder.type_test(given_base, TypeTable::OBJECT);
        let of_object = self.create_block();
        let neither = self.create_block();
        self.builder
            .branch(is_object, Edge::to(of_object), Edge::to(neither));

        self.continue_in(of_object);
        let href = self.file.intern_bytes(b"href");
        let href = PropertyName::Constant(self.file.text_key(href));
        let given = self.emit_get(given_base, href);
        for directory in self.emit_own_directories() {
            let expected = self.builder.strcat(&[directory, below]);
            let expected = self.emit_url_of_path(expected);
            let is_as_written = self.builder.strict_eq(given, expected);
            let otherwise = self.create_block();
            self.builder
                .branch(is_as_written, Edge::to(as_written), Edge::to(otherwise));
            self.continue_in(otherwise);
        }
        self.jump(neither);

        self.continue_in(neither);
    }

    fn emit_url_of_path(&mut self, path: ValueId) -> ValueId {
        let convert = self.emit_builtin_itself(BuiltinId::BunPathToFileURL);
        let url = call::emit_call(self, convert, None, &[path]);
        let href = self.file.intern_bytes(b"href");
        let href = PropertyName::Constant(self.file.text_key(href));
        self.emit_get(url, href)
    }

    fn find_question_on_base(
        &self,
        call: ExprId,
        arguments: IdList<ExprId>,
        own_require: Option<OwnRequire>,
    ) -> Option<QuestionOnBase> {
        let (hir, bound) = (self.file.hir, self.file.bound);
        match own_require? {
            OwnRequire::Made => {
                let place = find_base_that_a_call_made_of_own_file(hir, bound, call)?;
                Some(QuestionOnBase::IsInOwnFolder { place })
            }
            OwnRequire::MadeForPath(given) if may_call_have_made_path(hir, bound, given) => {
                let analysis = &self.file.compiled.analysis;
                let path = analysis.find_path_given_to_create_require(given)?;
                let place = hir.ids(arguments).position(|argument| argument == given)?;
                Some(QuestionOnBase::IsPath { place, path })
            }
            _ => None,
        }
    }

    fn refuse_other_create_require(&mut self, function: ValueId) {
        let expected = self.emit_builtin_itself(BuiltinId::NodeModuleCreateRequire);
        let is_expected = self.builder.strict_eq(function, expected);
        let matched = self.create_block();
        let other = self.create_block();
        self.builder
            .branch(is_expected, Edge::to(matched), Edge::to(other));

        self.continue_in(other);
        let message = self.emit_text(
            b"Cannot call createRequire: process.getBuiltinModule was replaced and returned a different createRequire. This executable can't load a module from a dynamic path.",
        );
        let constructor = self.emit_builtin_itself(BuiltinId::Error);
        let error = self.emit_construct(constructor, Arguments::Values(smallvec![message]), None);
        self.builder.throw(error);

        self.continue_in(matched);
    }

    fn keep_require_made_for_own_file(&mut self, maker: ValueId, made: ValueId) {
        let real = self.emit_builtin_itself(BuiltinId::NodeModuleCreateRequire);
        let is_real = self.builder.strict_eq(maker, real);
        let by_real = self.create_block();
        let done = self.create_block();
        self.builder
            .branch(is_real, Edge::to(by_real), Edge::to(done));

        self.continue_in(by_real);
        let kept = VariableKey::RequiresMadeForOwnFile(self.file.file);
        self.add_to_set_of_requires(kept, made);
        self.jump(done);

        self.continue_in(done);
    }

    fn keep_require_if_base_is_own_file(&mut self, maker: ValueId, base: ValueId, made: ValueId) {
        let for_own_file = self.create_block();
        let not_by_path = self.create_block();
        let done = self.create_block();
        let path = self.get_commonjs_variable(CommonJsVariable::Filename);
        let is_path = self.builder.strict_eq(base, path);
        self.builder
            .branch(is_path, Edge::to(for_own_file), Edge::to(not_by_path));

        self.continue_in(not_by_path);
        let convert = self.emit_builtin_itself(BuiltinId::BunPathToFileURL);
        let url = call::emit_call(self, convert, None, &[path]);
        let href = self.file.intern_bytes(b"href");
        let href = PropertyName::Constant(self.file.text_key(href));
        let url = self.emit_get(url, href);
        let is_url = self.builder.strict_eq(base, url);
        self.builder
            .branch(is_url, Edge::to(for_own_file), Edge::to(done));

        self.continue_in(for_own_file);
        self.keep_require_made_for_own_file(maker, made);
        self.jump(done);

        self.continue_in(done);
    }

    fn note_require_made_for_other_folder(&mut self, base: ValueId, made: ValueId) {
        let starts_with = self.emit_builtin_itself(BuiltinId::StringPrototypeStartsWith);
        let scheme = self.emit_text(b"file:");
        let is_url = call::emit_call(self, starts_with, Some(base), &[scheme]);
        let is_url = self.builder.to_boolean(is_url);
        let path = self.builder.create_variable(None);
        self.builder.write_variable(path, base);
        let of_url = self.create_block();
        let held = self.create_block();
        let in_other_folder = self.create_block();
        self.builder
            .branch(is_url, Edge::to(of_url), Edge::to(held));

        self.continue_in(of_url);
        let to_lower_case = self.emit_builtin_itself(BuiltinId::StringPrototypeToLowerCase);
        let letters = call::emit_call(self, to_lower_case, Some(base), &[]);
        let without_host = self.emit_text(b"file:///");
        let has_no_host = call::emit_call(self, starts_with, Some(letters), &[without_host]);
        let has_no_host = self.builder.to_boolean(has_no_host);
        let mut is_converted = self.create_block();
        self.builder.branch(
            has_no_host,
            Edge::to(is_converted),
            Edge::to(in_other_folder),
        );
        for encoded_separator in [&b"%2f"[..], b"%5c"] {
            self.continue_in(is_converted);
            let includes = self.emit_builtin_itself(BuiltinId::StringPrototypeIncludes);
            let encoded_separator = self.emit_text(encoded_separator);
            let has_one = call::emit_call(self, includes, Some(letters), &[encoded_separator]);
            let has_one = self.builder.to_boolean(has_one);
            is_converted = self.create_block();
            self.builder
                .branch(has_one, Edge::to(in_other_folder), Edge::to(is_converted));
        }

        self.continue_in(is_converted);
        let convert = self.emit_builtin_itself(BuiltinId::BunFileURLToPath);
        let converted = call::emit_call(self, convert, None, &[base]);
        self.builder.write_variable(path, converted);
        self.jump(held);

        self.continue_in(held);
        let path = self.builder.read_variable(path);
        let from_own_folder = self.emit_path_from_own_directory(path);
        let below_own_folder = self.create_block();
        let done = self.create_block();
        let own_folder = self.emit_text(b"./");
        let is_below = call::emit_call(self, starts_with, Some(from_own_folder), &[own_folder]);
        let is_below = self.builder.to_boolean(is_below);
        self.builder.branch(
            is_below,
            Edge::to(below_own_folder),
            Edge::to(in_other_folder),
        );

        self.continue_in(below_own_folder);
        let last_index_of = self.emit_builtin_itself(BuiltinId::StringPrototypeLastIndexOf);
        let separator = self.emit_text(b"/");
        let last = call::emit_call(self, last_index_of, Some(from_own_folder), &[separator]);
        let end_of_own_folder = self.builder.integer(1);
        let is_in_own_folder = self.builder.strict_eq(last, end_of_own_folder);
        self.builder
            .branch(is_in_own_folder, Edge::to(done), Edge::to(in_other_folder));

        self.continue_in(in_other_folder);
        self.note_require(made);
        self.jump(done);

        self.continue_in(done);
    }

    fn note_require(&mut self, made: ValueId) {
        let is_no_function = self.create_block();
        let can_be_noted = self.create_block();
        let done = self.create_block();
        let is_function = self.builder.type_test(made, TypeTable::FUNCTION);
        self.builder.branch(
            is_function,
            Edge::to(can_be_noted),
            Edge::to(is_no_function),
        );

        self.continue_in(is_no_function);
        let is_object = self.builder.type_test(made, TypeTable::OBJECT);
        self.builder
            .branch(is_object, Edge::to(can_be_noted), Edge::to(done));

        self.continue_in(can_be_noted);
        let noted = VariableKey::RequiresMadeForOtherFolders(self.file.file);
        self.add_to_set_of_requires(noted, made);
        self.jump(done);

        self.continue_in(done);
    }

    fn add_to_set_of_requires(&mut self, set: VariableKey, made: ValueId) {
        let variable = self.file.ensure_variable(set);
        let held = self.builder.get_module_variable(variable);
        let requires = self.builder.create_variable(None);
        self.builder.write_variable(requires, held);
        let adding = self.create_block();
        let split = self.split_on_type(held, TypeTable::ABSENT);
        self.builder.switch_to(split.not_taken);
        self.jump(adding);

        self.builder.switch_to(split.taken);
        let constructor = self.emit_builtin_itself(BuiltinId::WeakSet);
        let first = self.emit_construct(constructor, Arguments::Values(smallvec![]), None);
        self.builder.put_module_variable(variable, first);
        self.builder.write_variable(requires, first);
        self.jump(adding);

        self.continue_in(adding);
        let requires = self.builder.read_variable(requires);
        let add = self.emit_builtin_itself(BuiltinId::WeakSetPrototypeAdd);
        call::emit_call(self, add, Some(requires), &[made]);
    }

    fn emit_test_of_set_of_requires(&mut self, set: VariableKey, made: ValueId) -> ValueId {
        let variable = self.file.ensure_variable(set);
        let is_held = self.builder.create_variable(None);
        let decided = self.create_block();
        let held = self.builder.get_module_variable(variable);
        let split = self.split_on_type(held, TypeTable::ABSENT);
        self.builder.switch_to(split.taken);
        let no = self.builder.boolean(false);
        self.builder.write_variable(is_held, no);
        self.jump(decided);

        self.builder.switch_to(split.not_taken);
        let has = self.emit_builtin_itself(BuiltinId::WeakSetPrototypeHas);
        let has_require = call::emit_call(self, has, Some(held), &[made]);
        let has_require = self.builder.to_boolean(has_require);
        self.builder.write_variable(is_held, has_require);
        self.jump(decided);

        self.continue_in(decided);
        self.builder.read_variable(is_held)
    }

    fn may_tests_replace_what_was_made(&self) -> bool {
        let modules = self.file.inputs.modules;
        modules.runs_tests()
            && (modules.may_be_mocked(ModuleRef::Runtime(RuntimeModule::NodeModule))
                || modules.holds_replaceable_variable(self.file.file))
    }

    fn may_loader_be_replaced(&self, alias: Option<LoaderAlias>) -> bool {
        match alias {
            Some(LoaderAlias::Import(_)) => self.may_way_from_file_be_replaced(None),
            Some(LoaderAlias::Local) | None => self.may_tests_replace_what_was_made(),
        }
    }

    fn may_way_from_file_be_replaced(&self, exporter: Option<FileId>) -> bool {
        let modules = self.file.inputs.modules;
        let imports_replaceable_variable = &self.file.modules.imports_replaceable_variable;
        modules.runs_tests()
            || modules.reaches_mock(self.file.file)
            || exporter.is_some_and(|from| {
                modules.may_be_mocked(ModuleRef::File(from))
                    || modules.holds_replaceable_variable(from)
            })
            || *imports_replaceable_variable.get_or_init(|| {
                let mut imported = modules.import_bindings(self.file.file).iter();
                imported.any(|&(_, binding)| {
                    matches!(binding, ImportBinding::Variable(it) if modules.is_replaceable(it))
                })
            })
    }

    fn emit_test_of_value(&mut self, value: ValueId, test: CalleeTest) -> Option<ValueId> {
        match test {
            CalleeTest::IsTruthy => Some(self.builder.to_boolean(value)),
            CalleeTest::IsRequireOf(file) => {
                let module = self.file.fragment.declare_module(ModuleRef::File(file));
                let expected = self
                    .builder
                    .module_builtin(BuiltinId::ModuleRequire, module);
                Some(self.builder.strict_eq(value, expected))
            }
            _ => None,
        }
    }
    fn try_lower_library_module_named_to_made_require(
        &mut self,
        call: ExprId,
        id: CallId,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        let arguments = hir[id].args;
        let is_plain_call = matches!(hir[id].chain, Chain::No) && arguments.len() == 1;
        if !is_plain_call {
            return None;
        }
        let argument = hir.id_at(arguments, 0);
        let files = self.file.queries.files();
        resolve_loads_through_imported_loaders(files, self.file.file);
        let source = parsed_source(files, self.file.file)?;
        let named = modules_named_in(source.named_modules(), argument);
        if named.is_empty() {
            return None;
        }
        let is_made_require = is_made_require(hir, self.file.bound, hir[id].callee);
        let decisions = self.file.decisions();
        let alias = resolve_loader_alias(hir, self.file.bound, decisions, hir[id].callee);
        if !is_made_require && alias.is_none() || self.may_loader_be_replaced(alias) {
            return None;
        }
        let written = self.file.skip_type_syntax(argument);
        let name = self.file.find_constant_text(written)?;
        if self.file.is_name_for_transpiler_alone(name) {
            return None;
        }
        let module = ModuleRef::Runtime(named.iter().find(|it| it.name == name)?.module);
        let site = AnsweredSite {
            specifier: ImportSpecifier::Constant(name),
            specifier_node: argument,
            answer: SiteAnswer::Module(module),
            plan: None,
            resolved_from: None,
            looks_in_cache: true,
            is_read_by_transpiler: false,
            has_arm_for_transpiler_alone: false,
            maker_of_asked_require: None,
        };
        let operation = ModuleOperation::Require;
        if !is_made_require || may_still_be_undefined(hir, self.file.bound, hir[id].callee) {
            let test = CalleeTest::IsFilled;
            return Some(lower_tested_call(self, call, None, test, operation, &site));
        }
        self.lower_expression(hir[id].callee);
        Some(self.lower_untested_call(call, arguments, operation, &site))
    }

    fn try_lower_choice_of_builtin_modules(
        &mut self,
        call: ExprId,
        id: CallId,
        chain_exit: Option<BlockId>,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        let argument = hir.ids(hir[id].args).next()?;
        let files = self.file.queries.files();
        resolve_loads_through_imported_loaders(files, self.file.file);
        let source = parsed_source(files, self.file.file)?;
        let named = modules_named_in(source.named_modules(), argument).iter();
        let spelled_modules: Vec<SpelledModule> = named
            .filter(|it| !self.file.is_name_for_transpiler_alone(it.name))
            .map(|it| SpelledModule {
                spelling: it.name,
                module: ModuleRef::Runtime(it.module),
                is_left_to_loader: false,
            })
            .collect();
        if has_spread_argument(hir, hir[id].args)
            || self.file.find_resolved_form(argument).is_some()
        {
            return None;
        }
        self.file
            .find_modules_of_every_value(argument, &spelled_modules)?;
        let site = AnsweredSite {
            specifier: ImportSpecifier::Unknown,
            specifier_node: argument,
            answer: SiteAnswer::Computed(Candidates::Modules(&spelled_modules)),
            plan: None,
            resolved_from: None,
            looks_in_cache: false,
            is_read_by_transpiler: false,
            has_arm_for_transpiler_alone: false,
            maker_of_asked_require: None,
        };
        let test = match self.file.classify_callee(hir[id].callee) {
            CalleeKnowledge::Expected(expected) => CalleeTest::Expected(expected),
            CalleeKnowledge::Unresolved => {
                let (bound, decisions) = (self.file.bound, self.file.decisions());
                let alias = resolve_loader_alias(hir, bound, decisions, hir[id].callee)?;
                if self.may_loader_be_replaced(Some(alias)) {
                    return None;
                }
                CalleeTest::IsFilled
            }
            CalleeKnowledge::Bound => return None,
        };
        let operation = ModuleOperation::Require;
        let loaded = lower_tested_call(self, call, chain_exit, test, operation, &site);
        Some(loaded)
    }

    pub(crate) fn lower_import_equals_require(
        &mut self,
        declaration: ImportEqualsId,
    ) -> Option<ValueId> {
        let kind = ImportSiteKind::ImportEquals(declaration);
        let analysis = &self.file.compiled.analysis;
        let site = analysis.import_sites[analysis.import_site_index(kind)?];
        let modules = self.file.inputs.modules;
        let own_file = self.file.file;
        let bound = self.file.bound;
        let name = bound.declared_symbol(Decl::ImportEquals(declaration));
        let site = AnsweredSite {
            specifier: site.specifier,
            specifier_node: site.specifier_node,
            answer: modules.site_answer(own_file, kind),
            plan: create_plan(modules.site_at(own_file, kind), false, || {
                modules.holder(own_file, name).is_none()
            }),
            resolved_from: None,
            looks_in_cache: true,
            is_read_by_transpiler: true,
            has_arm_for_transpiler_alone: false,
            maker_of_asked_require: None,
        };
        let written = match (site.answer, site.specifier) {
            (SiteAnswer::Computed(_), ImportSpecifier::Constant(written)) => {
                Some(self.emit_name_as_given(written, None))
            }
            _ => None,
        };
        Some(self.emit_require(&site, written))
    }

    fn emit_expected_callee(&mut self, expected: BuiltinId) -> ValueId {
        match table::entry(expected).scope {
            Scope::Module => {
                let module = self.file.module_id();
                self.builder.module_builtin(expected, module)
            }
            Scope::Realm => self.builder.builtin(expected, true),
        }
    }

    fn emit_test_of_method(
        &mut self,
        callee: Callee,
        expected: BuiltinId,
        require: OwnRequire,
        of_receiver: CalleeTest,
    ) -> ValueId {
        let receiver = callee.this.expect("the call of a member has a receiver");
        let is_followed = self.builder.create_variable(None);
        let method_is_expected = self.create_block();
        let method_is_other = self.create_block();
        let decided = self.create_block();
        let expected_method = self.emit_expected_callee(expected);
        let is_method = self.builder.strict_eq(callee.function, expected_method);
        self.builder.branch(
            is_method,
            Edge::to(method_is_expected),
            Edge::to(method_is_other),
        );

        self.continue_in(method_is_expected);
        let is_require = match require {
            OwnRequire::OfFile => {
                let expected_receiver = self.emit_expected_callee(BuiltinId::ModuleRequire);
                self.builder.strict_eq(receiver, expected_receiver)
            }
            OwnRequire::Made
            | OwnRequire::MadeForPath(_)
            | OwnRequire::OfOtherFile(_)
            | OwnRequire::MadeInOtherFile(_) => {
                match self.emit_test_of_value(receiver, of_receiver) {
                    Some(is_require) => is_require,
                    None => self.builder.boolean(true),
                }
            }
            OwnRequire::MadeForChoice(_) => {
                let kept = VariableKey::RequiresMadeForOwnFile(self.file.file);
                self.emit_test_of_set_of_requires(kept, receiver)
            }
        };
        self.builder.write_variable(is_followed, is_require);
        self.jump(decided);

        self.continue_in(method_is_other);
        let no = self.builder.boolean(false);
        self.builder.write_variable(is_followed, no);
        self.jump(decided);

        self.continue_in(decided);
        self.builder.read_variable(is_followed)
    }

    fn emit_operation(
        &mut self,
        operation: ModuleOperation,
        site: &AnsweredSite<'_>,
        specifier: Option<ValueId>,
    ) -> ValueId {
        let test = specifier.and_then(|text| {
            self.branch_on_path_made_by_call(site.specifier, site.specifier_node, text)
        });
        if let Some(test) = test {
            self.continue_in(test.other);
            let error = self.emit_refusal_of_other_path(test.written, b"MODULE_NOT_FOUND");
            self.builder.throw(error);
            self.continue_in(test.as_written);
        }
        match operation {
            ModuleOperation::Require => self.emit_require(site, specifier),
            ModuleOperation::RequireResolve => self.emit_require_resolve(site, specifier),
            ModuleOperation::ImportMetaResolve => match site.answer {
                SiteAnswer::Module(module) => {
                    self.emit_resolve_module(site.specifier, None, module, true)
                }
                SiteAnswer::Computed(candidates) => {
                    self.emit_import_meta_resolve_of_computed_name(site, specifier, candidates)
                }
                SiteAnswer::Failed(_) | SiteAnswer::Erased => {
                    unreachable!("find_operation binds import.meta.resolve to modules")
                }
            },
        }
    }

    fn emit_import_meta_resolve_of_computed_name(
        &mut self,
        site: &AnsweredSite<'_>,
        specifier: Option<ValueId>,
        candidates: Candidates<'_>,
    ) -> ValueId {
        let specifier = specifier.unwrap_or_else(|| self.builder.undefined());
        let referrer = self.referrer_of(site);
        let spelled_modules = candidates.spelled_modules();
        let is_answered_by_program = |spelled: &&SpelledModule| {
            !matches!(spelled.module, ModuleRef::External { .. })
                && does_import_meta_resolve_ask_resolver(
                    self.file.queries.atom_bytes(spelled.spelling),
                )
        };
        let answered: Vec<&SpelledModule> = spelled_modules
            .iter()
            .filter(is_answered_by_program)
            .collect();

        if answered.is_empty() {
            return self
                .builder
                .resolve_dynamic(specifier, referrer, true, false);
        }
        let result = self.builder.create_variable(None);
        let strings: Vec<StringId> = answered
            .iter()
            .map(|spelled| self.file.intern_atom(spelled.spelling))
            .collect();
        let arms: Vec<BlockId> = answered.iter().map(|_| self.create_block()).collect();
        let (otherwise, done) = (self.create_block(), self.create_block());
        let edges: Vec<Edge<'static>> = arms.iter().map(|&arm| Edge::to(arm)).collect();
        self.builder
            .switch_string(specifier, &strings, &edges, Edge::to(otherwise));
        for (spelled, &arm) in answered.iter().zip(&arms) {
            self.continue_in(arm);
            let found = self.emit_resolve_of_name(spelled.spelling, None, spelled.module, true);
            self.builder.write_variable(result, found);
            self.jump(done);
        }
        self.continue_in(otherwise);
        let found = self
            .builder
            .resolve_dynamic(specifier, referrer, true, false);
        self.builder.write_variable(result, found);
        self.jump(done);

        self.continue_in(done);
        self.builder.read_variable(result)
    }

    fn expect_exports_layout(&mut self, module: ModuleRef, required: ValueId) -> ValueId {
        let expected = match module {
            ModuleRef::File(file) => self.find_exports_type(file),
            _ => None,
        };
        match expected {
            Some(expected) => self.expect_type(required, expected),
            None => required,
        }
    }

    fn try_lower_inner_module_call(&mut self, call: ExprId) -> Option<ValueId> {
        let (modules, file) = (self.file.inputs.modules, self.file.file);
        let plan = create_plan(modules.stored_site(file, call), false, || {
            modules.is_site_read_as_value(file, call)
        })?;
        self.set_position(self.file.hir[call].pos);
        Some(self.emit_planned_require(plan))
    }

    fn emit_planned_require(&mut self, plan: PlannedSite) -> ValueId {
        let module = self.file.fragment.declare_module(plan.target);
        let referrer = self.current_module_id();
        if plan.records {
            self.builder
                .record_require(module, referrer, plan.is_by_made_require);
        }
        let is_bare = plan.is_bare && self.is_module_body() && self.handler().is_none();
        let is_call_of_require = matches!(plan.target, ModuleRef::File(_) | ModuleRef::Runtime(_));
        self.builder
            .evaluate_module(module, referrer, is_bare, is_call_of_require);
        if plan.records {
            self.builder
                .record_require(module, referrer, plan.is_by_made_require);
        }
        if !plan.yields_value {
            return self.builder.boolean(true);
        }
        match commonjs::emit_module_value(self, plan.target) {
            Some(required) => self.expect_exports_layout(plan.target, required),
            None => {
                debug_assert!(false, "a module that is looked at as a value has one");
                self.builder.boolean(true)
            }
        }
    }

    fn find_required_jsx_module(&self, import: JsxImport) -> Option<ModuleRef> {
        let (modules, file) = (self.file.inputs.modules, self.file.file);
        if modules.kind(file) != ModuleKind::CommonJs {
            return None;
        }
        match modules.find_site_answer(file, import.site_kind())? {
            SiteAnswer::Module(module) => Some(module),
            _ => None,
        }
    }

    fn emit_require_of_jsx_module(&mut self, import: JsxImport) -> Option<ValueId> {
        let module = self.find_required_jsx_module(import)?;
        let analysis = &self.file.compiled.analysis;
        let site = analysis.import_sites[analysis.import_site_index(import.site_kind())?];
        let ImportSpecifier::Constant(specifier) = site.specifier else {
            return None;
        };
        let specifier = self.file.intern_atom(specifier);
        Some(self.emit_require_of_candidate(module, specifier))
    }

    pub(in crate::lower) fn emit_required_jsx_import(
        &mut self,
        import: JsxImport,
        name: StringId,
    ) -> Option<ValueId> {
        let module = self.find_required_jsx_module(import)?;
        if self.file.inputs.modules.interop(module).kind != ModuleKind::CommonJs {
            return None;
        }
        let exports = self.emit_require_of_jsx_module(import)?;
        let key = self.file.text_key(name);
        Some(self.emit_get(exports, PropertyName::Constant(key)))
    }

    pub(in crate::lower) fn emit_loads_of_jsx_modules(&mut self) {
        let imports = self.file.inputs.modules.jsx_bindings(self.file.file);
        let mut sites: SmallVec<[ImportSiteKind; 2]> = SmallVec::new();
        for &(import, _) in imports {
            if !sites.contains(&import.site_kind()) {
                sites.push(import.site_kind());
                let modules = self.file.inputs.modules;
                match modules.find_site_answer(self.file.file, import.site_kind()) {
                    Some(SiteAnswer::Failed(failure)) => {
                        self.emit_module_failure(failure, true);
                    }
                    _ => {
                        self.emit_require_of_jsx_module(import);
                    }
                }
            }
        }
    }

    fn emit_require_module(&mut self, module: ModuleRef, specifier: StringId) -> ValueId {
        let id = self.file.fragment.declare_module(module);
        let referrer = self.file.module_id();
        let forms = (self.file.inputs.modules).forms_require_checks_first(module);
        if forms.is_empty() {
            let required = self.builder.require_module(id, referrer, specifier, false);
            return self.expect_exports_layout(module, required);
        }
        let answer = self.builder.create_variable(None);
        let done = self.create_block();
        for &(_, form) in forms {
            let form = (self.file.fragment).declare_module(ModuleRef::File(form));
            let namespace = self.builder.require_module(form, referrer, specifier, true);
            let is_held = self.builder.type_test(namespace, TypeTable::OBJECT);
            self.builder.write_variable(answer, namespace);
            let not_held = self.create_block();
            self.builder
                .branch(is_held, Edge::to(done), Edge::to(not_held));

            self.continue_in(not_held);
        }
        let required = self.builder.require_module(id, referrer, specifier, false);
        self.builder.write_variable(answer, required);
        self.jump(done);

        self.continue_in(done);
        self.builder.read_variable(answer)
    }

    fn may_load_again(&self, module: ModuleRef) -> bool {
        let modules = self.file.inputs.modules;
        if let ModuleRef::Runtime(of_library) = module {
            return modules.is_code_of_program(self.current_module())
                && table::name_without_node_prefix(of_library).is_none()
                && of_library != RuntimeModule::Bun
                && of_library != RuntimeModule::BunTest;
        }
        let ModuleRef::File(file) = module else {
            return false;
        };
        if !modules.is_code_of_program(module) {
            return false;
        }
        match modules.kind(file) {
            ModuleKind::SourceText => {
                modules.may_be_evicted(module)
                    || modules.may_be_mocked(module)
                    || modules.reaches_entries_of_cache()
            }
            ModuleKind::CommonJs => {
                modules.may_be_evicted(module)
                    || (modules.may_be_mocked(module) && self.file.lies_in_package())
            }
            _ => false,
        }
    }

    fn emit_require_of_candidate(&mut self, module: ModuleRef, specifier: StringId) -> ValueId {
        let referrer = self.current_module();
        let mut requests = self.file.inputs.modules.requests_of(referrer).iter();
        let is_evaluated = requests
            .any(|request| request.kind == ModuleRequestKind::Require && request.target == module);
        if !is_evaluated || self.may_load_again(module) {
            return self.emit_require_module(module, specifier);
        }
        self.emit_planned_require(PlannedSite {
            target: module,
            is_bare: false,
            records: true,
            is_by_made_require: false,
            yields_value: true,
        })
    }

    fn emit_require(&mut self, site: &AnsweredSite<'_>, specifier: Option<ValueId>) -> ValueId {
        let (SiteAnswer::Module(module), ImportSpecifier::Constant(written)) =
            (site.answer, site.specifier)
        else {
            return self.emit_require_that_build_answers(site, specifier);
        };
        let is_call_of_require = site.looks_in_cache
            && !matches!(
                module,
                ModuleRef::Runtime(RuntimeModule::Bun | RuntimeModule::BunTest)
            );
        if !is_call_of_require || !self.asks_loader_functions() {
            return self.emit_require_that_build_answers(site, specifier);
        }
        let referrer = self.referrer_of(site);
        let are_stored = self.builder.are_loader_functions_stored();
        self.emit_one_of(
            are_stored,
            &mut |this| {
                let name = this.emit_name_for_loader_functions(module, written, specifier);
                this.emit_require_by_name(name, referrer)
            },
            &mut |this| this.emit_require_that_build_answers(&site.in_one_arm(true), specifier),
        )
    }

    fn emit_require_by_name(&mut self, name: ValueId, referrer: ModuleId) -> ValueId {
        self.builder.require_dynamic(name, referrer, false, false)
    }

    fn asks_loader_functions(&self) -> bool {
        let modules = self.file.inputs.modules;
        modules.asks_loader_functions() && modules.is_code_of_program(self.current_module())
    }

    fn emit_name_for_loader_functions(
        &mut self,
        module: ModuleRef,
        written: Atom,
        given: Option<ValueId>,
    ) -> ValueId {
        let read = match module {
            ModuleRef::Runtime(_) => self.file.builtin_named(written, module),
            _ => None,
        };
        let Some((name, alias)) = read else {
            return self.emit_name_as_given(written, given);
        };
        let is_as_written = name == self.file.queries.atom_bytes(written);
        let name = name.to_vec();
        let gets_prefix = is_as_written
            && alias.node_builtin
            && !name.starts_with(b"node:")
            && self.file.inputs.modules.tracks_first_load(self.file.file);
        if !gets_prefix {
            return self.emit_text(&name);
        }
        let file = self.file.module_id();
        let reads_as_written = self.builder.was_loaded_synchronously(file);
        self.emit_one_of(
            reads_as_written,
            &mut |this| this.emit_text(&name),
            &mut |this| this.emit_text(alias.path.as_bytes()),
        )
    }

    fn emit_one_of(
        &mut self,
        takes_first: ValueId,
        emit_first: &mut dyn FnMut(&mut Self) -> ValueId,
        emit_second: &mut dyn FnMut(&mut Self) -> ValueId,
    ) -> ValueId {
        let answer = self.builder.create_variable(None);
        let first = self.create_block();
        let second = self.create_block();
        let done = self.create_block();
        self.builder
            .branch(takes_first, Edge::to(first), Edge::to(second));
        let was_call_in_tail_position =
            std::mem::replace(&mut self.is_call_in_tail_position, false);

        self.continue_in(first);
        let found = emit_first(self);
        self.builder.write_variable(answer, found);
        self.jump(done);

        self.continue_in(second);
        let found = emit_second(self);
        self.builder.write_variable(answer, found);
        self.jump(done);

        self.is_call_in_tail_position = was_call_in_tail_position;
        self.continue_in(done);
        self.builder.read_variable(answer)
    }

    fn emit_require_that_build_answers(
        &mut self,
        site: &AnsweredSite<'_>,
        specifier: Option<ValueId>,
    ) -> ValueId {
        let whole_path = specifier
            .filter(|_| (self.file).is_whole_path_for_loader(site.answer, site.specifier_node));
        if let Some(whole_path) = whole_path {
            let referrer = self.referrer_of(site);
            return self.emit_require_by_name(whole_path, referrer);
        }
        if !site.looks_in_cache
            && let (SiteAnswer::Module(module), ImportSpecifier::Constant(written)) =
                (site.answer, site.specifier)
            && let Some(found) = self.try_emit_call_of_get_builtin_module(module, written)
        {
            return found;
        }
        if site.looks_in_cache
            && let (SiteAnswer::Module(module), ImportSpecifier::Constant(written)) =
                (site.answer, site.specifier)
            && let Some(name) = self.try_emit_name_that_entry_in_cache_may_answer(module, written)
        {
            let referrer = self.referrer_of(site);
            if !site.is_read_by_transpiler {
                return self.emit_require_by_name(name.text, referrer);
            }
            return self.emit_require_beside_entry_in_cache(name, referrer, |this| {
                this.emit_require_of_answer(&site.in_one_arm(true), specifier)
            });
        }
        self.emit_require_of_answer(site, specifier)
    }

    fn try_emit_name_that_entry_in_cache_may_answer(
        &mut self,
        module: ModuleRef,
        written: Atom,
    ) -> Option<NameLookedUpInCache> {
        let modules = self.file.inputs.modules;
        if !modules.is_code_of_program(self.current_module()) {
            return None;
        }
        let (name, alias) = self.file.builtin_named(written, module)?;
        if !modules.may_entry_in_cache_stand_under(name) {
            return None;
        }
        let name = name.to_vec();
        let is_left_to_host = alias.node_builtin && matches!(module, ModuleRef::External { .. });
        Some(NameLookedUpInCache {
            text: self.emit_text(&name),
            is_node_builtin: alias.node_builtin,
            name_for_host: is_left_to_host.then(|| alias.path.as_bytes()),
        })
    }

    fn emit_require_beside_entry_in_cache(
        &mut self,
        name: NameLookedUpInCache,
        referrer: ModuleId,
        mut emit_past_cache: impl FnMut(&mut Self) -> ValueId,
    ) -> ValueId {
        if !name.is_node_builtin || !self.file.inputs.modules.tracks_first_load(self.file.file) {
            return self.emit_require_by_name(name.text, referrer);
        }
        let file = self.file.module_id();
        let reads_as_written = self.builder.was_loaded_synchronously(file);
        self.emit_one_of(
            reads_as_written,
            &mut |this| this.emit_require_by_name(name.text, referrer),
            &mut |this| match name.name_for_host {
                Some(with_prefix) => {
                    let with_prefix = this.emit_text(with_prefix);
                    this.emit_require_by_name(with_prefix, referrer)
                }
                None => emit_past_cache(this),
            },
        )
    }

    pub(in crate::lower) fn note_first_load(&mut self) {
        if self.file.inputs.modules.tracks_first_load(self.file.file) {
            let file = self.file.module_id();
            self.builder.was_loaded_synchronously(file);
        }
    }

    fn try_emit_call_of_get_builtin_module(
        &mut self,
        module: ModuleRef,
        written: Atom,
    ) -> Option<ValueId> {
        let modules = self.file.inputs.modules;
        if !modules.is_code_of_program(self.current_module()) {
            return None;
        }
        let (name, alias) = self.file.builtin_named(written, module)?;
        if alias.node_builtin && !modules.may_be_mocked(module) {
            return None;
        }
        let name = name.to_vec();
        let get_builtin_module = self.emit_builtin_itself(BuiltinId::ProcessGetBuiltinModule);
        let name = self.emit_text(&name);
        Some(call::emit_call(self, get_builtin_module, None, &[name]))
    }

    fn emit_require_of_answer(
        &mut self,
        site: &AnsweredSite<'_>,
        specifier: Option<ValueId>,
    ) -> ValueId {
        match site.answer {
            SiteAnswer::Module(module) => {
                let outer = self
                    .builder
                    .set_tail_position(self.is_call_in_tail_position);
                let may_load_again = self.may_load_again(module);
                let required = match (site.plan, site.specifier) {
                    (Some(plan), _) if !may_load_again => self.emit_planned_require(plan),
                    (_, ImportSpecifier::Constant(text)) => {
                        let text = self.file.intern_atom(text);
                        self.emit_require_module(module, text)
                    }
                    (Some(plan), _) => self.emit_planned_require(plan),
                    (None, _) => unreachable!("only a constant specifier names one module"),
                };
                self.builder.set_tail_position(outer);
                required
            }
            SiteAnswer::Computed(candidates) => {
                let specifier = specifier.unwrap_or_else(|| self.builder.undefined());
                let node = site.specifier_node;
                let referrer = self.referrer_of(site);
                let name = (node, site.specifier);
                let load = ComputedLoad::Require {
                    looks_in_cache: site.looks_in_cache,
                    is_read_by_transpiler: site.is_read_by_transpiler,
                };
                self.emit_computed_load(load, referrer, name, specifier, candidates)
            }
            SiteAnswer::Failed(failure) => match site.specifier {
                ImportSpecifier::Constant(name)
                    if (self.file.inputs.modules).is_name_without_code_that_mocks_give(name) =>
                {
                    let name = self.emit_name_as_given(name, specifier);
                    let referrer = self.referrer_of(site);
                    self.emit_require_by_name(name, referrer)
                }
                _ => self.emit_require_failure(site, specifier, failure, true),
            },
            SiteAnswer::Erased => self.builder.undefined(),
        }
    }

    fn emit_path_from_own_directory(&mut self, text: ValueId) -> ValueId {
        let directories = self.emit_own_directories();
        let spelled = self.builder.create_variable(None);
        let mut done = None;
        let count = directories.len();
        for (index, directory) in directories.into_iter().enumerate() {
            let starts_with = self.emit_builtin_itself(BuiltinId::StringPrototypeStartsWith);
            let is_below = call::emit_call(self, starts_with, Some(text), &[directory]);
            let is_below = self.builder.to_boolean(is_below);
            if index == 0 {
                self.builder.write_variable(spelled, text);
            }
            let below = self.create_block();
            let done = *done.get_or_insert_with(|| self.create_block());
            let otherwise = match index + 1 == count {
                true => done,
                false => self.create_block(),
            };
            self.builder
                .branch(is_below, Edge::to(below), Edge::to(otherwise));

            self.continue_in(below);
            let length = PropertyName::Constant(self.file.atom_key(known::length));
            let length = self.emit_get(directory, length);
            let slice = self.emit_builtin_itself(BuiltinId::StringPrototypeSlice);
            let mut rest = call::emit_call(self, slice, Some(text), &[length]);
            let platform = self.file.inputs.options.platform;
            if platform.contains(Platforms::WINDOWS) {
                let replace_all = self.emit_builtin_itself(BuiltinId::StringPrototypeReplaceAll);
                let separators = [self.emit_text(b"\\"), self.emit_text(b"/")];
                rest = call::emit_call(self, replace_all, Some(rest), &separators);
            }
            let dot = self.emit_text(b".");
            let from_folder = self.builder.strcat(&[dot, rest]);
            self.builder.write_variable(spelled, from_folder);
            self.jump(done);

            self.continue_in(otherwise);
        }
        self.builder.read_variable(spelled)
    }

    fn branch_on_path_made_by_call(
        &mut self,
        specifier: ImportSpecifier,
        node: ExprId,
        text: ValueId,
    ) -> Option<PathTest> {
        let ImportSpecifier::Constant(written) = specifier else {
            return None;
        };
        if !self.file.decisions().is_path_made_by_call(node) {
            return None;
        }
        let is_from_own_directory = self.file.is_path_from_own_directory(node);
        Some(self.branch_on_written_path(written, is_from_own_directory, text))
    }

    fn branch_on_written_path(
        &mut self,
        written: Atom,
        is_from_own_directory: bool,
        text: ValueId,
    ) -> PathTest {
        let platform = self.file.inputs.options.platform;
        let is_windows = platform.contains(Platforms::WINDOWS);
        let separator: &[u8] = if is_windows { b"\\" } else { b"/" };
        let bytes = self.file.queries.atom_bytes(written).to_vec();
        if !is_from_own_directory {
            let expected = self.emit_text(&bytes);
            let is_as_written = self.builder.strict_eq(text, expected);
            let (as_written, other) = (self.create_block(), self.create_block());
            self.builder
                .branch(is_as_written, Edge::to(as_written), Edge::to(other));
            return PathTest {
                as_written,
                other,
                written: self.file.intern_atom(written),
            };
        }
        let directories = self.emit_own_directories();
        let mut targets = None;
        let written_below = bytes.strip_prefix(b".").unwrap_or(&bytes);
        let leaves_own_folder = (written_below.strip_prefix(b"/.."))
            .is_some_and(|rest| rest.is_empty() || rest.starts_with(b"/"));
        let spellings: Vec<(ValueId, bool)> = (directories.into_iter())
            .flat_map(|directory| {
                let as_joined = Some((directory, true));
                as_joined
                    .into_iter()
                    .chain(leaves_own_folder.then_some((directory, false)))
            })
            .collect();
        let count = spellings.len();
        for (index, (mut directory, is_joined)) in spellings.into_iter().enumerate() {
            let mut below = written_below;
            while is_joined
                && let Some(rest) = below.strip_prefix(b"/..")
                && (rest.is_empty() || rest.starts_with(b"/"))
            {
                below = rest;
                let separator = self.emit_text(separator);
                let last_index_of = self.emit_builtin_itself(BuiltinId::StringPrototypeLastIndexOf);
                let end = call::emit_call(self, last_index_of, Some(directory), &[separator]);
                let start = self.builder.integer(0);
                let slice = self.emit_builtin_itself(BuiltinId::StringPrototypeSlice);
                directory = call::emit_call(self, slice, Some(directory), &[start, end]);
            }
            let below: Vec<u8> = bun_core::strings::split(below, b"/")
                .collect::<Vec<_>>()
                .join(separator);
            let below = self.emit_text(&below);
            let expected = self.builder.strcat(&[directory, below]);
            let is_as_written = self.builder.strict_eq(text, expected);
            let (as_written, other) =
                *targets.get_or_insert_with(|| (self.create_block(), self.create_block()));
            let otherwise = match index + 1 == count {
                true => other,
                false => self.create_block(),
            };
            if is_windows {
                let spelled_otherwise = self.create_block();
                let spelled_as_text = self.create_block();
                self.builder.branch(
                    is_as_written,
                    Edge::to(as_written),
                    Edge::to(spelled_otherwise),
                );

                self.continue_in(spelled_otherwise);
                let is_text = self.builder.type_test(text, TypeTable::STRING);
                self.builder
                    .branch(is_text, Edge::to(spelled_as_text), Edge::to(otherwise));

                self.continue_in(spelled_as_text);
                let replace_all = self.emit_builtin_itself(BuiltinId::StringPrototypeReplaceAll);
                let separators = [self.emit_text(b"/"), self.emit_text(b"\\")];
                let with_one_separator =
                    call::emit_call(self, replace_all, Some(text), &separators);
                let is_same_file = self.builder.strict_eq(with_one_separator, expected);
                self.builder
                    .branch(is_same_file, Edge::to(as_written), Edge::to(otherwise));
            } else {
                self.builder
                    .branch(is_as_written, Edge::to(as_written), Edge::to(otherwise));
            }
            if otherwise != other {
                self.continue_in(otherwise);
            }
        }
        let (as_written, other) = targets.expect("a file has a folder");
        let written = self.file.intern_atom(written);
        PathTest {
            as_written,
            other,
            written,
        }
    }

    pub(in crate::lower) fn emit_text(&mut self, text: &[u8]) -> ValueId {
        let text = self.file.intern_bytes(text);
        self.builder.string(text)
    }

    fn emit_refusal_of_other_path(&mut self, written: StringId, code: &[u8]) -> ValueId {
        let head = self.file.intern_bytes(b"Cannot load '");
        let tail = self.file.intern_bytes(
            b"': a function that makes the name (path.join, path.resolve, encodeURIComponent, btoa) was replaced and returned something else. This executable can't load a module from a dynamic path.",
        );
        let parts = [head, written, tail].map(|part| self.builder.string(part));
        let message = self.builder.strcat(&parts);
        let constructor = self.emit_builtin_itself(BuiltinId::Error);
        let arguments = Arguments::Values(smallvec![message]);
        let error = self.emit_construct(constructor, arguments, None);
        let name = self.file.intern_bytes(b"code");
        let name = PropertyName::Constant(self.file.text_key(name));
        let code = self.emit_text(code);
        self.emit_set(error, name, code);
        error
    }

    fn emit_computed_load(
        &mut self,
        load: ComputedLoad,
        referrer: ModuleId,
        (node, written): (ExprId, ImportSpecifier),
        specifier: ValueId,
        candidates: Candidates<'_>,
    ) -> ValueId {
        let name = (node, written);
        self.emit_behind_test_of_name(load, name, specifier, &mut |this, is_path_alone| {
            let analysis = &this.file.compiled.analysis;
            let known_of_name = KnownOfName {
                all_names_are_known: candidates.hold_every_name(analysis, &written),
                names_no_library_module: is_path_alone,
            };
            let name = (node, known_of_name);
            this.emit_load_among_candidates(load, referrer, name, specifier, candidates)
        })
    }

    fn emit_behind_test_of_name(
        &mut self,
        load: ComputedLoad,
        (node, written): (ExprId, ImportSpecifier),
        text: ValueId,
        emit_load: &mut dyn FnMut(&mut Self, bool) -> ValueId,
    ) -> ValueId {
        let why = match load {
            ComputedLoad::Require { .. } | ComputedLoad::Import if node.is_some() => {
                let files = self.file.queries.files();
                (self.file.inputs.modules).find_why_name_is_path_alone(files, self.file.file, node)
            }
            _ => None,
        };
        let Some(PathAlone::ByTestOfWholePath) = why else {
            return emit_load(self, why.is_some());
        };
        let (whole_path, other) = self.branch_on_whole_path(text);
        let written = match written {
            ImportSpecifier::Pattern { prefix, suffix } => {
                let queries = &self.file.queries;
                [queries.atom_bytes(prefix), b"*", queries.atom_bytes(suffix)].concat()
            }
            _ => b"*".to_vec(),
        };
        let written = self.file.intern_bytes(&written);
        self.continue_in(other);
        if !matches!(load, ComputedLoad::Import) {
            let error = self.emit_refusal_of_other_path(written, b"MODULE_NOT_FOUND");
            self.builder.throw(error);
            self.continue_in(whole_path);
            return emit_load(self, true);
        }
        let result = self.builder.create_variable(None);
        let done = self.create_block();
        let error = self.emit_refusal_of_other_path(written, b"ERR_MODULE_NOT_FOUND");
        let rejected = self.emit_import_rejected_by_loader(error);
        self.builder.write_variable(result, rejected);
        self.jump(done);

        self.continue_in(whole_path);
        let loaded = emit_load(self, true);
        self.builder.write_variable(result, loaded);
        self.jump(done);

        self.continue_in(done);
        self.builder.read_variable(result)
    }

    fn branch_on_whole_path(&mut self, text: ValueId) -> (BlockId, BlockId) {
        let is_text_block = self.create_block();
        let (whole_path, other) = (self.create_block(), self.create_block());
        let is_text = self.builder.type_test(text, TypeTable::STRING);
        self.builder
            .branch(is_text, Edge::to(is_text_block), Edge::to(other));

        self.continue_in(is_text_block);
        let platform = self.file.inputs.options.platform;
        let starts: &[(&[u8], i64)] = match platform.contains(Platforms::WINDOWS) {
            true => &[(b":", 1), (b"\\", 0)],
            false => &[(b"/", 0)],
        };
        for (index, &(start, position)) in starts.iter().enumerate() {
            let starts_with = self.emit_builtin_itself(BuiltinId::StringPrototypeStartsWith);
            let mut arguments: SmallVec<[ValueId; 2]> = smallvec![self.emit_text(start)];
            if position != 0 {
                arguments.push(self.builder.integer(position));
            }
            let is_there = call::emit_call(self, starts_with, Some(text), &arguments);
            let is_there = self.builder.to_boolean(is_there);
            let otherwise = match index + 1 == starts.len() {
                true => other,
                false => self.create_block(),
            };
            self.builder
                .branch(is_there, Edge::to(whole_path), Edge::to(otherwise));
            if otherwise != other {
                self.continue_in(otherwise);
            }
        }
        (whole_path, other)
    }

    fn emit_load_among_candidates(
        &mut self,
        load: ComputedLoad,
        referrer: ModuleId,
        name: (ExprId, KnownOfName),
        specifier: ValueId,
        candidates: Candidates<'_>,
    ) -> ValueId {
        let modules = self.file.inputs.modules;
        let asks_nobody = matches!(
            load,
            ComputedLoad::Import
                | ComputedLoad::Require {
                    looks_in_cache: false,
                    ..
                }
        );
        let is_written_out =
            name.0.is_some() && bun_sema::import_sites::is_name_written_out(self.file.hir, name.0);
        let files_ask = self.asks_loader_functions();
        let is_asked_by_name = |it: &&SpelledModule| match it.module {
            ModuleRef::Runtime(RuntimeModule::Bun | RuntimeModule::BunTest) => {
                !matches!(load, ComputedLoad::Require { .. })
            }
            ModuleRef::Runtime(_) => true,
            _ => files_ask,
        };
        let spelled = candidates.spelled_modules().iter();
        let asked_by_name: Vec<SpelledModule> = spelled
            .filter(|it| is_written_out && is_asked_by_name(it))
            .copied()
            .collect();
        if asks_nobody
            || (is_written_out && asked_by_name.is_empty())
            || !modules.computed_names_ask_loader_functions()
            || !modules.is_code_of_program(self.current_module())
        {
            return self.emit_load_of_what_build_found(load, referrer, name, specifier, candidates);
        }
        let are_stored = self.builder.are_loader_functions_stored();
        if is_written_out {
            return self.emit_one_of(
                are_stored,
                &mut |this| {
                    let choice = (load, referrer, name, specifier, candidates);
                    this.emit_choice_of_written_names_for_loader_functions(choice, &asked_by_name)
                },
                &mut |this| {
                    this.emit_load_of_what_build_found(load, referrer, name, specifier, candidates)
                },
            );
        }
        self.emit_one_of(
            are_stored,
            &mut |this| this.emit_load_by_name(load, referrer, specifier, name.1),
            &mut |this| {
                this.emit_load_of_what_build_found(load, referrer, name, specifier, candidates)
            },
        )
    }

    fn emit_choice_of_written_names_for_loader_functions(
        &mut self,
        (load, referrer, name, specifier, candidates): (
            ComputedLoad,
            ModuleId,
            (ExprId, KnownOfName),
            ValueId,
            Candidates<'_>,
        ),
        asked_by_name: &[SpelledModule],
    ) -> ValueId {
        let result = self.builder.create_variable(None);
        let mut strings: Vec<StringId> = Vec::with_capacity(asked_by_name.len());
        let mut arms: Vec<BlockId> = Vec::with_capacity(asked_by_name.len());
        for spelled in asked_by_name {
            strings.push(self.file.intern_atom(spelled.spelling));
            arms.push(self.create_block());
        }
        let otherwise = self.create_block();
        let done = self.create_block();
        let edges: Vec<Edge<'static>> = arms.iter().map(|&arm| Edge::to(arm)).collect();
        self.builder
            .switch_string(specifier, &strings, &edges, Edge::to(otherwise));
        for (spelled, &arm) in asked_by_name.iter().zip(&arms) {
            self.continue_in(arm);
            let asked = self.emit_name_for_loader_functions(spelled.module, spelled.spelling, None);
            let loaded = self.emit_load_by_name(load, referrer, asked, name.1);
            self.builder.write_variable(result, loaded);
            self.jump(done);
        }
        self.continue_in(otherwise);
        let found = self.emit_load_of_what_build_found(load, referrer, name, specifier, candidates);
        self.builder.write_variable(result, found);
        self.jump(done);
        self.continue_in(done);
        self.builder.read_variable(result)
    }

    fn emit_load_of_what_build_found(
        &mut self,
        load: ComputedLoad,
        referrer: ModuleId,
        (node, known_of_name): (ExprId, KnownOfName),
        specifier: ValueId,
        candidates: Candidates<'_>,
    ) -> ValueId {
        let spelled_modules = candidates.spelled_modules();
        let linked: Vec<SpelledModule>;
        let spelled_modules = match spelled_modules.iter().any(|it| it.is_left_to_loader) {
            true => {
                let is_linked = |it: &&SpelledModule| !it.is_left_to_loader;
                linked = spelled_modules.iter().filter(is_linked).copied().collect();
                &linked[..]
            }
            false => spelled_modules,
        };
        if let Some(form) = self.file.find_resolved_form(node) {
            let candidates = AnswersOfResolver {
                form,
                spelled_modules,
                known_of_name,
            };
            return self.emit_load_by_answer_of_resolver(load, referrer, specifier, candidates);
        }
        let modules_of_every_value = self.file.find_modules_of_every_value(node, spelled_modules);
        let spelled_modules = modules_of_every_value.as_deref().unwrap_or(spelled_modules);
        if spelled_modules.is_empty() {
            return self.emit_load_by_name(load, referrer, specifier, known_of_name);
        }
        let result = self.builder.create_variable(None);
        let mut strings: Vec<StringId> = Vec::with_capacity(spelled_modules.len());
        let mut arms: Vec<BlockId> = Vec::with_capacity(spelled_modules.len());
        for spelled in spelled_modules {
            strings.push(self.file.intern_atom(spelled.spelling));
            arms.push(self.create_block());
        }
        let otherwise = self.create_block();
        let done = self.create_block();
        let mut edges: Vec<Edge<'static>> = arms.iter().map(|&arm| Edge::to(arm)).collect();
        let spelled = match self.file.is_path_from_own_directory(node) {
            true => {
                let joined = (self.file).find_paths_joined_out_of_own_directory(spelled_modules);
                for (path, candidate) in joined {
                    strings.push(self.file.intern_bytes(&path));
                    edges.push(Edge::to(arms[candidate]));
                }
                self.emit_path_from_own_directory(specifier)
            }
            false => specifier,
        };
        self.builder
            .switch_string(spelled, &strings, &edges, Edge::to(otherwise));

        for (spelled, &arm) in spelled_modules.iter().zip(&arms) {
            self.continue_in(arm);
            let loaded = self.emit_load_of_candidate(load, spelled);
            self.builder.write_variable(result, loaded);
            self.jump(done);
        }

        self.continue_in(otherwise);
        if modules_of_every_value.is_some() {
            self.builder.unreachable();
        } else {
            let loaded = self.emit_load_by_name(load, referrer, specifier, known_of_name);
            self.builder.write_variable(result, loaded);
            self.jump(done);
        }

        self.continue_in(done);
        self.builder.read_variable(result)
    }

    fn emit_load_of_candidate(&mut self, load: ComputedLoad, spelled: &SpelledModule) -> ValueId {
        match load {
            ComputedLoad::Require {
                looks_in_cache,
                is_read_by_transpiler,
            } => {
                let (module, written) = (spelled.module, spelled.spelling);
                if !looks_in_cache
                    && let Some(found) = self.try_emit_call_of_get_builtin_module(module, written)
                {
                    return found;
                }
                if looks_in_cache
                    && let Some(name) =
                        self.try_emit_name_that_entry_in_cache_may_answer(module, written)
                {
                    let referrer = self.file.module_id();
                    if !is_read_by_transpiler {
                        return self.emit_require_by_name(name.text, referrer);
                    }
                    return self.emit_require_beside_entry_in_cache(name, referrer, |this| {
                        let spelling = this.file.intern_atom(written);
                        this.emit_require_of_candidate(module, spelling)
                    });
                }
                let spelling = self.file.intern_atom(written);
                self.emit_require_of_candidate(module, spelling)
            }
            ComputedLoad::Import => self.emit_import_through_face(spelled.module, None),
            ComputedLoad::Resolve => {
                self.emit_resolve_of_name(spelled.spelling, None, spelled.module, false)
            }
        }
    }

    fn emit_load_by_answer_of_resolver(
        &mut self,
        load: ComputedLoad,
        referrer: ModuleId,
        answer: ValueId,
        candidates: AnswersOfResolver<'_>,
    ) -> ValueId {
        let is_url = candidates.form != ResolvedForm::Path;
        let text = match candidates.form {
            ResolvedForm::UrlObject if !candidates.spelled_modules.is_empty() => {
                let name = self.file.intern_bytes(b"href");
                let name = PropertyName::Constant(self.file.text_key(name));
                self.emit_get(answer, name)
            }
            _ => answer,
        };
        let mut stands_for: FxHashMap<Vec<u8>, Option<ModuleRef>> = FxHashMap::default();
        for spelled in candidates.spelled_modules {
            let texts = (self.file).find_url_and_name_joined_to_own_url(spelled, is_url);
            for text in texts.into_iter().flatten() {
                let candidate = stands_for.entry(text).or_insert(Some(spelled.module));
                if *candidate != Some(spelled.module) {
                    *candidate = None;
                }
            }
        }
        let result = self.builder.create_variable(None);
        let done = self.create_block();
        for spelled in candidates.spelled_modules {
            let answer_for_candidate =
                self.emit_resolve_of_name(spelled.spelling, None, spelled.module, is_url);
            let is_candidate = self.builder.strict_eq(text, answer_for_candidate);
            let candidate = self.create_block();
            let mut other = self.create_block();
            self.builder
                .branch(is_candidate, Edge::to(candidate), Edge::to(other));
            let url_of_source = match is_url {
                true => self.file.find_url_of_source(spelled.module),
                false => None,
            };
            if url_of_source.is_some() || (!is_url && self.file.has_source_path_of(spelled.module))
            {
                self.continue_in(other);
                let other_answer = match url_of_source {
                    Some(url) => self.emit_text(&url),
                    None => {
                        self.emit_path_in_program(spelled.spelling, None, spelled.module, false)
                    }
                };
                let is_candidate = self.builder.strict_eq(text, other_answer);
                other = self.create_block();
                self.builder
                    .branch(is_candidate, Edge::to(candidate), Edge::to(other));
            }

            let [url, joined] = (self.file).find_url_and_name_joined_to_own_url(spelled, is_url);
            let joined = joined.filter(|it| url.as_ref() != Some(it) && stands_for[it].is_some());
            if let Some(joined) = joined {
                self.continue_in(other);
                let joined = self.emit_text(&joined);
                let is_candidate = self.builder.strict_eq(text, joined);
                other = self.create_block();
                self.builder
                    .branch(is_candidate, Edge::to(candidate), Edge::to(other));
            }

            self.continue_in(candidate);
            let loaded = self.emit_load_of_candidate(load, spelled);
            self.builder.write_variable(result, loaded);
            self.jump(done);

            self.continue_in(other);
        }
        let loaded = self.emit_load_by_name(load, referrer, answer, candidates.known_of_name);
        self.builder.write_variable(result, loaded);
        self.jump(done);

        self.continue_in(done);
        self.builder.read_variable(result)
    }

    fn emit_load_by_name(
        &mut self,
        load: ComputedLoad,
        referrer: ModuleId,
        specifier: ValueId,
        known: KnownOfName,
    ) -> ValueId {
        let (all_are_known, no_library_module) =
            (known.all_names_are_known, known.names_no_library_module);
        match load {
            ComputedLoad::Require { .. } => (self.builder).require_dynamic(
                specifier,
                referrer,
                all_are_known,
                no_library_module,
            ),
            ComputedLoad::Import => (self.builder).import_dynamic(
                specifier,
                None,
                referrer,
                all_are_known,
                no_library_module,
            ),
            ComputedLoad::Resolve => self
                .builder
                .resolve_dynamic(specifier, referrer, false, false),
        }
    }

    fn emit_name_that_bundler_leaves(
        &mut self,
        site: &AnsweredSite<'_>,
        given: Option<ValueId>,
    ) -> Option<ValueId> {
        let (module, name) = match (site.answer, site.specifier) {
            (SiteAnswer::Module(module), ImportSpecifier::Constant(name)) => (module, name),
            (SiteAnswer::Computed(_), _) => {
                return Some(given.unwrap_or_else(|| self.builder.undefined()));
            }
            _ => return None,
        };
        if !bun_sema::import_sites::is_name_written_out(self.file.hir, site.specifier_node) {
            return Some(self.emit_name_as_given(name, given));
        }
        let ModuleRef::File(file) = module else {
            return None;
        };
        match self.file.inputs.sources.source_path(file) {
            Some(path) if !bun_paths::is_absolute_loose(self.file.queries.atom_bytes(name)) => {
                Some(self.emit_text(&path))
            }
            _ => Some(self.emit_name_as_given(name, given)),
        }
    }

    fn emit_require_resolve(
        &mut self,
        site: &AnsweredSite<'_>,
        specifier: Option<ValueId>,
    ) -> ValueId {
        if self.file.inputs.may_have_plugins
            && let Some(name) = self.emit_name_that_bundler_leaves(site, specifier)
        {
            let referrer = self.referrer_of(site);
            return self.builder.resolve_dynamic(name, referrer, false, false);
        }
        match site.answer {
            SiteAnswer::Module(module) => {
                let ImportSpecifier::Constant(written) = site.specifier else {
                    unreachable!("only a constant specifier names one module");
                };
                if !self.asks_loader_functions() {
                    return self.emit_resolve_module(site.specifier, specifier, module, false);
                }
                let (referrer, spelled) = (self.referrer_of(site), site.specifier);
                let are_stored = self.builder.are_loader_functions_stored();
                self.emit_one_of(
                    are_stored,
                    &mut |this| {
                        let name = this.emit_name_for_loader_functions(module, written, specifier);
                        this.builder.resolve_dynamic(name, referrer, false, false)
                    },
                    &mut |this| this.emit_resolve_module(spelled, specifier, module, false),
                )
            }
            SiteAnswer::Computed(candidates) => {
                let specifier = specifier.unwrap_or_else(|| self.builder.undefined());
                let node = site.specifier_node;
                let referrer = self.referrer_of(site);
                let name = (node, site.specifier);
                self.emit_computed_load(
                    ComputedLoad::Resolve,
                    referrer,
                    name,
                    specifier,
                    candidates,
                )
            }
            SiteAnswer::Failed(failure) => match site.specifier {
                ImportSpecifier::Constant(text)
                    if !(self.file.inputs.modules.failure(failure))
                        .is_refusal_of_package_json() =>
                {
                    let specifier = self.emit_name_as_given(text, specifier);
                    let referrer = self.referrer_of(site);
                    self.builder
                        .resolve_dynamic(specifier, referrer, false, false)
                }
                ImportSpecifier::Constant(_)
                | ImportSpecifier::Pattern { .. }
                | ImportSpecifier::OneOf(_)
                | ImportSpecifier::Unknown => {
                    self.emit_require_failure(site, specifier, failure, false)
                }
            },
            SiteAnswer::Erased => self.builder.undefined(),
        }
    }

    fn emit_resolve_module(
        &mut self,
        specifier: ImportSpecifier,
        given: Option<ValueId>,
        module: ModuleRef,
        is_url: bool,
    ) -> ValueId {
        let ImportSpecifier::Constant(text) = specifier else {
            unreachable!("only a constant specifier names one module");
        };
        self.emit_resolve_of_name(text, given, module, is_url)
    }

    fn emit_resolve_of_name(
        &mut self,
        name: Atom,
        given: Option<ValueId>,
        module: ModuleRef,
        is_url: bool,
    ) -> ValueId {
        if !is_url && let Some(asked) = self.file.builtin_name_as_asked(name, module) {
            let asked = asked.to_vec();
            let asked = self.file.intern_bytes(&asked);
            return self.builder.string(asked);
        }
        if !is_url
            && let ModuleRef::File(file) = module
            && !bun_paths::is_absolute_loose(self.file.queries.atom_bytes(name))
            && let Some(path) = self.file.inputs.sources.source_path(file)
        {
            return self.emit_text(&path);
        }
        self.emit_path_in_program(name, given, module, is_url)
    }

    fn emit_path_in_program(
        &mut self,
        name: Atom,
        given: Option<ValueId>,
        module: ModuleRef,
        is_url: bool,
    ) -> ValueId {
        let is_path = bun_paths::is_absolute_loose(self.file.queries.atom_bytes(name));
        let name = self.file.intern_atom(name);
        let referrer = self.file.module_id();
        let is_host_value =
            self.file.inputs.modules.external_kind(module) == Some(ExternalKind::HostValue);
        let is_file_outside =
            matches!(module, ModuleRef::External { .. }) && (is_path || !is_host_value);
        if is_file_outside && !is_url {
            let specifier = given.unwrap_or_else(|| self.builder.string(name));
            return self
                .builder
                .resolve_dynamic(specifier, referrer, false, false);
        }
        let module = self.file.fragment.declare_module(module);
        self.builder.resolve_module(module, referrer, name, is_url)
    }

    fn referrer_of(&mut self, site: &AnsweredSite<'_>) -> ModuleId {
        match site.resolved_from {
            Some(file) => self.file.fragment.declare_module(ModuleRef::File(file)),
            None => self.file.module_id(),
        }
    }

    fn emit_require_failure(
        &mut self,
        site: &AnsweredSite<'_>,
        given: Option<ValueId>,
        failure: ModuleFailureId,
        is_for_require: bool,
    ) -> ValueId {
        match site.specifier {
            ImportSpecifier::Constant(text) => {
                let specifier = self.emit_name_as_given(text, given);
                let referrer = self.referrer_of(site);
                self.builder
                    .resolve_dynamic(specifier, referrer, false, is_for_require);
            }
            ImportSpecifier::Pattern { .. }
            | ImportSpecifier::OneOf(_)
            | ImportSpecifier::Unknown => {}
        }
        self.emit_module_failure(failure, true)
    }

    fn emit_name_as_given(&mut self, spelled: Atom, given: Option<ValueId>) -> ValueId {
        given.unwrap_or_else(|| {
            let spelled = self.file.intern_atom(spelled);
            self.builder.string(spelled)
        })
    }

    pub(super) fn emit_module_failure(
        &mut self,
        failure: ModuleFailureId,
        is_for_require: bool,
    ) -> ValueId {
        let failure = self.file.fragment.declare_module_failure(failure);
        self.builder.throw_module_failure(failure, is_for_require);
        self.builder.unreachable();
        self.begin_unreachable_block();
        self.builder.undefined()
    }

    fn emit_settled_promise(&mut self, method: BuiltinId, value: ValueId) -> ValueId {
        let method = self.emit_builtin_itself(method);
        let promise = self.emit_builtin_itself(BuiltinId::Promise);
        call::emit_call(self, method, Some(promise), &[value])
    }

    fn emit_rejected_import(&mut self, failure: ModuleFailureId) -> ValueId {
        let failure = self.file.fragment.declare_module_failure(failure);
        let handler = self.begin_handler(BlockRole::CatchHandler, None);
        self.builder.throw_module_failure(failure, false);
        self.builder.unreachable();
        self.begin_unreachable_block();
        self.end_handler(handler);

        self.continue_in(handler.block());
        let error = self.builder.catch_value();
        self.emit_import_rejected_by_loader(error)
    }

    fn emit_import_rejected_by_loader(&mut self, error: ValueId) -> ValueId {
        self.emit_builtin_call(BuiltinId::CompilerHelpersImportRejectedByLoader, &[error])
    }

    fn lower_untested_call(
        &mut self,
        call: ExprId,
        arguments: IdList<ExprId>,
        operation: ModuleOperation,
        site: &AnsweredSite<'_>,
    ) -> ValueId {
        let hir = self.file.hir;
        let first = (arguments.len() > 0).then(|| hir.id_at(arguments, 0));
        let specifier = match first {
            Some(name) if site.has_arm_for_transpiler_alone => {
                let joins_texts = !matches!(operation, ModuleOperation::RequireResolve);
                Some(self.lower_name_as_transpiler_prints_it(name, joins_texts))
            }
            _ => self.lower_computed_specifier(site.answer, first),
        };
        self.lower_arguments_for_effect(arguments, 1);
        self.set_position(self.file.load_position(call));
        self.emit_operation(operation, site, specifier)
    }

    fn lower_name_as_transpiler_prints_it(&mut self, name: ExprId, joins_texts: bool) -> ValueId {
        let printed = self.builder.create_variable(None);
        let done = self.create_block();
        self.lower_arms_as_transpiler_prints_them(name, joins_texts, printed, done);
        self.continue_in(done);
        self.builder.read_variable(printed)
    }

    fn lower_arms_as_transpiler_prints_them(
        &mut self,
        name: ExprId,
        joins_texts: bool,
        printed: LocalVariable,
        done: BlockId,
    ) {
        let name = self.file.hir.skip_type_assertions(name);
        self.lower_conditional_arms(name, false, &mut |this, arm| {
            let inner = this.file.hir.skip_type_assertions(arm);
            let is_choice = matches!(this.file.hir[inner].kind, ExprKind::Cond { .. });
            if let Some(text) = this
                .file
                .find_name_printed_by_transpiler(inner, joins_texts)
            {
                let text = text.to_vec();
                let text = this.emit_text(&text);
                this.builder.write_variable(printed, text);
            } else if is_choice && inner != name && !this.file.is_statically_resolved(inner) {
                return this.lower_arms_as_transpiler_prints_them(
                    inner,
                    joins_texts,
                    printed,
                    done,
                );
            } else {
                let value = this.lower_expression(arm);
                this.builder.write_variable(printed, value);
            }
            this.jump(done);
        });
    }

    fn lower_computed_specifier(
        &mut self,
        answer: SiteAnswer<'_>,
        specifier: Option<ExprId>,
    ) -> Option<ValueId> {
        match answer {
            SiteAnswer::Computed(_) => specifier.map(|argument| self.lower_expression(argument)),
            SiteAnswer::Module(_) | SiteAnswer::Failed(_) | SiteAnswer::Erased => {
                let argument = specifier?;
                let is_named_in_error = match answer {
                    SiteAnswer::Failed(_) => self.file.is_path_from_own_directory(argument),
                    _ => self.file.is_whole_path_for_loader(answer, argument),
                };
                let is_asked_of_plugins = self.file.inputs.may_have_plugins
                    && self.file.is_path_from_own_directory(argument);
                if is_named_in_error
                    || is_asked_of_plugins
                    || self.file.decisions().is_path_made_by_call(argument)
                {
                    return Some(self.lower_expression(argument));
                }
                self.lower_taken_value_for_effect(argument);
                None
            }
        }
    }

    fn lower_arguments_for_effect(&mut self, arguments: IdList<ExprId>, start: usize) {
        let hir = self.file.hir;
        for index in start..arguments.len() {
            self.lower_taken_value_for_effect(hir.id_at(arguments, index));
        }
    }
}

fn find_operation(
    site: &ImportSite,
    answer: SiteAnswer<'_>,
    argument_count: usize,
) -> Option<ModuleOperation> {
    match site.kind {
        ImportSiteKind::Require(_) | ImportSiteKind::ImportMetaRequire(_) => match answer {
            SiteAnswer::Computed(_) if argument_count > 1 => None,
            _ => Some(ModuleOperation::Require),
        },
        ImportSiteKind::GetBuiltinModule(_) => match answer {
            SiteAnswer::Module(_) | SiteAnswer::Erased => Some(ModuleOperation::Require),
            SiteAnswer::Computed(_) | SiteAnswer::Failed(_) => None,
        },
        ImportSiteKind::RequireResolve(_) => Some(ModuleOperation::RequireResolve),
        ImportSiteKind::ImportMetaResolve(_) => match answer {
            SiteAnswer::Module(ModuleRef::External { .. }) => None,
            SiteAnswer::Module(_) if site.consults_resolver && argument_count == 1 => {
                Some(ModuleOperation::ImportMetaResolve)
            }
            SiteAnswer::Computed(_)
                if argument_count == 1
                    && !matches!(site.specifier, ImportSpecifier::Constant(_)) =>
            {
                Some(ModuleOperation::ImportMetaResolve)
            }
            _ => None,
        },
        _ => None,
    }
}

#[derive(Copy, Clone)]
enum CalleeTest {
    Expected(BuiltinId),
    IsFilled,
    IsTruthy,
    IsRequireOf(FileId),
    Method {
        expected: BuiltinId,
        form: RequireCallForm,
        require: OwnRequire,
        is_truthy: bool,
        exporter: Option<FileId>,
    },
    IsMadeIn(FileId),
}

fn lower_tested_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    chain_exit: Option<BlockId>,
    test: CalleeTest,
    operation: ModuleOperation,
    site: &AnsweredSite<'_>,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Call(id) = hir[call].kind else {
        unreachable!("lower_tested_call takes a Call");
    };
    let mut callee = lowering.lower_callee(hir[id].callee, chain_exit, None);
    match hir[id].chain {
        Chain::Start => {
            let exit = chain_exit.expect("an optional call has the exit of its chain");
            let function = callee.function;
            callee.function = lowering.branch_if_expression_nullish(hir[id].callee, function, exit);
        }
        Chain::No | Chain::Continue => {}
    }
    let values = match site.has_arm_for_transpiler_alone {
        true => {
            let mut arguments = hir.ids(hir[id].args);
            let name = arguments.next().expect("the name has arms");
            let joins_texts = !matches!(operation, ModuleOperation::RequireResolve);
            let name = lowering.lower_name_as_transpiler_prints_it(name, joins_texts);
            let others = arguments.map(|argument| lowering.lower_expression(argument));
            Arguments::Values(std::iter::once(name).chain(others).collect())
        }
        false => lowering.lower_arguments(hir[id].args),
    };
    let Arguments::Values(values) = values else {
        unreachable!("a module call with a spread argument is an ordinary call");
    };
    lowering.set_position(lowering.file.load_position(call));
    let mut other_callee = callee;
    let condition = match test {
        CalleeTest::Expected(expected) => {
            let expected = lowering.emit_expected_callee(expected);
            lowering.builder.strict_eq(callee.function, expected)
        }
        CalleeTest::IsFilled => {
            let empty = lowering.builder.undefined();
            other_callee.function = empty;
            lowering.builder.strict_eq(callee.function, empty)
        }
        CalleeTest::IsTruthy | CalleeTest::IsRequireOf(_) => lowering
            .emit_test_of_value(callee.function, test)
            .expect("both ask something of the value"),
        CalleeTest::Method {
            expected,
            require,
            is_truthy,
            exporter,
            ..
        } => {
            let of_receiver = match (exporter, is_truthy) {
                (Some(exporter), _) => CalleeTest::IsRequireOf(exporter),
                (None, true) => CalleeTest::IsTruthy,
                (None, false) => CalleeTest::IsFilled,
            };
            lowering.emit_test_of_method(callee, expected, require, of_receiver)
        }
        CalleeTest::IsMadeIn(file) => {
            let kept = VariableKey::RequiresMadeForOwnFile(file);
            lowering.emit_test_of_set_of_requires(kept, callee.function)
        }
    };
    let result = lowering.builder.create_variable(None);
    let matched = lowering.create_block();
    let other = lowering.create_block();
    let done = lowering.create_block();
    let (if_true, if_false) = match test {
        CalleeTest::Expected(_) => {
            other_callee.function = lowering.builder.add_edge_result(other);
            other_callee.key = None;
            (Edge::to(matched), Edge::with_proofs(other, &[0]))
        }
        CalleeTest::IsFilled => (Edge::to(other), Edge::to(matched)),
        CalleeTest::IsTruthy
        | CalleeTest::IsRequireOf(_)
        | CalleeTest::Method { .. }
        | CalleeTest::IsMadeIn(_) => (Edge::to(matched), Edge::to(other)),
    };
    lowering.builder.branch(condition, if_true, if_false);

    lowering.continue_in(matched);
    if let Some(maker) = site.maker_of_asked_require {
        let is_method = matches!(test, CalleeTest::Method { .. })
            || matches!(operation, ModuleOperation::RequireResolve);
        let require = callee.this.filter(|_| is_method).unwrap_or(callee.function);
        let noted = VariableKey::RequiresMadeForOtherFolders(maker);
        let is_noted = lowering.emit_test_of_set_of_requires(noted, require);
        let made_for_own_folder = lowering.create_block();
        lowering
            .builder
            .branch(is_noted, Edge::to(other), Edge::to(made_for_own_folder));
        lowering.continue_in(made_for_own_folder);
    }
    let (is_other_arm_read, specifier) = match test {
        CalleeTest::Expected(_) | CalleeTest::IsRequireOf(_) | CalleeTest::IsMadeIn(_) => {
            (true, values.first().copied())
        }
        CalleeTest::IsFilled | CalleeTest::IsTruthy => (false, values.first().copied()),
        CalleeTest::Method { form, .. } => (
            true,
            match (form, site.answer) {
                (RequireCallForm::Direct, _) => {
                    unreachable!("a direct call goes through no method")
                }
                (RequireCallForm::Call, _) => values.get(1).copied(),
                (RequireCallForm::Apply, SiteAnswer::Computed(_)) => {
                    let first = lowering.builder.integer(0);
                    Some(lowering.builder.elem_get(values[1], first))
                }
                (
                    RequireCallForm::Apply,
                    SiteAnswer::Module(_) | SiteAnswer::Failed(_) | SiteAnswer::Erased,
                ) => None,
            },
        ),
    };
    let site = site.in_one_arm(is_other_arm_read);
    let loaded = lowering.emit_operation(operation, &site, specifier);
    lowering.builder.write_variable(result, loaded);
    lowering.jump(done);

    lowering.continue_in(other);
    let arguments = Arguments::Values(values);
    let returned = lowering.emit_call_expression(call, other_callee, arguments, Tail::No);
    lowering.builder.write_variable(result, returned);
    lowering.jump(done);

    lowering.continue_in(done);
    lowering.builder.read_variable(result)
}

enum QuestionOnBase {
    IsInOwnFolder { place: usize },
    IsPath { place: usize, path: Atom },
}

struct PathTest {
    as_written: BlockId,
    other: BlockId,
    written: StringId,
}

fn find_object_replacing_namespace(
    hir: &hir::File<'_>,
    decisions: &Decisions<'_>,
    arguments: IdList<ExprId>,
    module: ModuleRef,
) -> Option<BuiltinId> {
    let first = (arguments.len() > 0).then(|| hir.skip_type_assertions(hir.id_at(arguments, 0)));
    let is_name_read =
        first.is_some_and(|name| decisions.is_constant_under_minify_syntax(hir, name));
    match (module, is_name_read) {
        (ModuleRef::Runtime(module), true) => table::object_replacing_namespace(module),
        (
            ModuleRef::Runtime(_)
            | ModuleRef::File(_)
            | ModuleRef::Inner { .. }
            | ModuleRef::Face(_)
            | ModuleRef::Check(_)
            | ModuleRef::External { .. },
            _,
        ) => None,
    }
}

fn is_made_by_imported_name(hir: &hir::File<'_>, bound: &Bound<'_>, made: ExprId) -> bool {
    let mut made = hir.skip_type_assertions(made);
    for _ in 0..8 {
        match hir[made].kind {
            ExprKind::Call(call) => {
                let maker = hir.skip_type_assertions(hir[call].callee);
                return matches!(hir[maker].kind, ExprKind::Ident(_))
                    && matches!(bound.binding(maker), Binding::Symbol(symbol)
                        if matches!(bound.symbol(symbol).decls, [Decl::ImportSpec(_)]));
            }
            ExprKind::Ident(_) => {
                let Binding::Symbol(symbol) = bound.binding(made) else {
                    return false;
                };
                let BindingInitializer::Expression(initializer) =
                    bound.binding_initializer(hir, symbol)
                else {
                    return false;
                };
                made = hir.skip_type_assertions(initializer);
            }
            _ => return false,
        }
    }
    false
}

fn names_library_module(files: &Files<'_>, file: FileId, argument: ExprId) -> bool {
    resolve_loads_through_imported_loaders(files, file);
    parsed_source(files, file)
        .is_some_and(|source| !modules_named_in(source.named_modules(), argument).is_empty())
}

fn has_spread_argument(hir: &hir::File<'_>, arguments: IdList<ExprId>) -> bool {
    (0..arguments.len())
        .any(|index| matches!(hir[hir.id_at(arguments, index)].kind, ExprKind::Spread(_)))
}
