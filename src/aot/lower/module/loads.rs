use bun_ast::Target;
use bun_resolve_builtins::{Alias, Cfg};
use bun_sema::atom::known;
use bun_sema::bind::{CommonJsVariable, Decl};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{self, Branches, Chain, ExprId, ExprKind, IdList, ImportEqualsId};
use bun_sema::import_sites::{
    ImportSite, ImportSiteKind, ImportSpecifier, OwnRequire, RequireCallForm, find_own_require,
    find_require_call, holds_import_meta_require, is_made_require, is_require_made_for_own_file,
    may_still_be_undefined,
};
use smallvec::smallvec;

use crate::builtins::id::{BuiltinId, RuntimeModule};
use crate::builtins::table::{self, Platforms, Scope};
use crate::builtins::{Mutability, Resolved};
use crate::ir::generated::{BlockRole, ModuleRequestKind};
use crate::ir::{BlockId, Edge, StringId, Type, TypeTable, ValueId};
use crate::load::loader_aliases::resolve_loader_alias;
use crate::load::named_loads::modules_named_in;
use crate::load::sources::parsed_source;
use crate::lower::call::{self, Arguments, CallSite, Callee};
use crate::lower::expression::Tail;
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, commonjs};
use crate::modules::{
    Candidates, ModuleFailureId, ModuleKind, ModuleRef, Site, SiteAnswer, SpelledModule,
};

#[derive(Copy, Clone)]
enum ModuleOperation {
    Require,
    RequireResolve,
    ImportMetaResolve,
}

#[derive(Copy, Clone)]
enum ComputedLoad {
    Require,
    Import,
}

#[derive(Copy, Clone)]
enum CalleeKnowledge {
    Unresolved,
    Bound,
    Expected(BuiltinId),
}

// The module is evaluated where the call stands, without the loader.
#[derive(Copy, Clone)]
struct PlannedSite {
    target: ModuleRef,
    is_bare: bool,
    records: bool,
    yields_value: bool,
}

#[derive(Copy, Clone)]
struct AnsweredSite<'g> {
    specifier: ImportSpecifier,
    specifier_node: ExprId,
    answer: SiteAnswer<'g>,
    plan: Option<PlannedSite>,
}

impl AnsweredSite<'_> {
    // One arm of a test of the callee. Not every run passes it, and what the other arm yields is looked at.
    fn under_test(self) -> Self {
        let plan = self.plan.map(|plan| PlannedSite {
            is_bare: false,
            yields_value: true,
            ..plan
        });
        AnsweredSite { plan, ..self }
    }

    // The arm in which the binding is filled. Not every run passes it. The other arm calls `undefined` and throws, so whoever gets an answer gets the module, and looks at it no more than the plan says.
    fn where_binding_is_filled(self) -> Self {
        let plan = self.plan.map(|plan| PlannedSite {
            is_bare: false,
            ..plan
        });
        AnsweredSite { plan, ..self }
    }
}

fn create_plan(site: Option<Site>, yields_value: bool) -> Option<PlannedSite> {
    match site? {
        Site::Evaluate {
            target,
            is_bare,
            records,
        } => Some(PlannedSite {
            target,
            is_bare,
            records,
            yields_value,
        }),
        Site::AsToday => None,
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn find_plan(&self, call: ExprId) -> Option<PlannedSite> {
        let modules = self.inputs.modules;
        let site = modules.site(self.file, call)?;
        let yields_value = match site {
            Site::Evaluate { .. } => modules.is_site_read_as_value(self.file, call),
            Site::AsToday => return None,
        };
        create_plan(Some(site), yields_value)
    }

    fn classify_callee(&self, callee: ExprId) -> CalleeKnowledge {
        let callee = self.skip_type_syntax(callee);
        let Some(Resolved::Builtin(callee_path)) = self.builtins.of_expr(callee) else {
            return CalleeKnowledge::Unresolved;
        };
        let root = match self.hir.member_key(callee) {
            Some((object, _)) => self.skip_type_syntax(object),
            None => callee,
        };
        let Some(Resolved::Builtin(root_path)) = self.builtins.of_expr(root) else {
            return CalleeKnowledge::Unresolved;
        };
        match table::entry(root_path.id).scope {
            Scope::Realm => CalleeKnowledge::Expected(callee_path.id),
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
            let text = match self.decisions().constant(hir, alternative) {
                FoldedValue::Constant(Constant::String(text))
                | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) => text,
                _ => return None,
            };
            let spelled = *spelled_modules.iter().find(|it| it.spelling == text)?;
            if !modules.contains(&spelled) {
                modules.push(spelled);
            }
        }
        Some(modules)
    }

    fn find_name_answered_as_asked(&mut self, site: AnsweredSite<'_>) -> Option<StringId> {
        let (ImportSpecifier::Constant(name), SiteAnswer::Module(ModuleRef::Runtime(_))) =
            (site.specifier, site.answer)
        else {
            return None;
        };
        let alias = Alias::get(self.queries.atom_bytes(name), Target::Bun, Cfg::default())?;
        alias.node_builtin.then(|| self.intern_atom(name))
    }
}

#[derive(Copy, Clone)]
struct ComputedSpecifier<'g> {
    node: ExprId,
    value: ValueId,
    candidates: Candidates<'g>,
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
            lowering.lower_arguments_for_effect(args, 1);
            lowering.set_position(position);
            let test = specifier.zip(first).and_then(|(text, node)| {
                let written = lowering.file.decisions().specifier(node);
                lowering.branch_on_path_made_by_call(written, node, text)
            });
            let Some(test) = test else {
                return lowering.emit_import_of_module(args, module);
            };
            let result = lowering.builder.create_variable(None);
            let done = lowering.create_block();
            lowering.continue_in(test.as_written);
            let loaded = lowering.emit_import_of_module(args, module);
            lowering.builder.write_variable(result, loaded);
            lowering.jump(done);

            lowering.continue_in(test.other);
            let error = lowering.emit_refusal_of_other_path(test.written, b"ERR_MODULE_NOT_FOUND");
            let reject = lowering.builder.builtin(BuiltinId::PromiseReject);
            let promise = lowering.builder.builtin(BuiltinId::Promise);
            let arguments = Arguments::Values(smallvec![error]);
            let rejected = call::emit_call(
                lowering,
                reject,
                Some(promise),
                arguments,
                CallSite::default(),
            );
            lowering.builder.write_variable(result, rejected);
            lowering.jump(done);

            lowering.continue_in(done);
            lowering.builder.read_variable(result)
        }
        SiteAnswer::Computed(candidates) => {
            let mut arguments = hir.ids(args);
            let node = arguments.next().unwrap_or(ExprId::NONE);
            let specifier = if node.is_some() {
                lowering.lower_expression(node)
            } else {
                lowering.builder.undefined()
            };
            let options = arguments
                .next()
                .map(|second| lowering.lower_expression(second));
            lowering.lower_arguments_for_effect(args, 2);
            lowering.set_position(position);
            if options.is_none() {
                let specifier = ComputedSpecifier {
                    node,
                    value: specifier,
                    candidates,
                };
                return lowering.emit_computed_load(ComputedLoad::Import, specifier);
            }
            let referrer = lowering.file.module_id();
            lowering
                .builder
                .import_dynamic(specifier, options, referrer)
        }
        SiteAnswer::Erased => {
            lowering.lower_arguments_for_effect(args, 0);
            lowering.set_position(position);
            lowering.builder.undefined()
        }
        SiteAnswer::Failed(failure) => {
            lowering.lower_arguments_for_effect(args, 0);
            lowering.set_position(position);
            lowering.emit_rejected_import(failure)
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn emit_import_of_module(&mut self, arguments: IdList<ExprId>, module: ModuleRef) -> ValueId {
        if let Some(object) = find_object_replacing_namespace(self.file.hir, arguments, module) {
            return self.emit_resolved_import(object);
        }
        let module = self.file.inputs.modules.face(module).unwrap_or(module);
        let module = self.file.fragment.declare_module(module);
        let referrer = self.file.module_id();
        self.builder.import_module(module, referrer)
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
        let arguments = hir[id].args;
        let analysis = &self.file.compiled.analysis;
        let Some(site) = analysis.import_site_of_call(call) else {
            if let Some(evaluated) = self.try_lower_inner_module_call(call) {
                return Some(evaluated);
            }
            if let Some(loaded) = self.try_lower_library_module_named_to_made_require(call) {
                return Some(loaded);
            }
            return self.try_lower_choice_of_builtin_modules(call, chain_exit);
        };
        let site = analysis.import_sites[site];
        if has_spread_argument(hir, arguments) {
            return None;
        }
        let (bound, decisions) = (self.file.bound, Some(self.file.decisions()));
        let require_call = matches!(site.kind, ImportSiteKind::Require(_))
            .then(|| find_require_call(hir, bound, decisions, hir[id].callee, arguments))
            .flatten();
        let is_module_require =
            matches!(site.kind, ImportSiteKind::Require(_)) && require_call.is_none();
        let given = require_call.map_or(arguments, |found| found.args);
        let modules = self.file.inputs.modules;
        let answer = modules.site_answer(self.file.file, site.kind);
        let operation = find_operation(&site, answer, given.len())?;
        let site = AnsweredSite {
            specifier: site.specifier,
            specifier_node: site.specifier_node,
            answer,
            plan: self.file.find_plan(call),
        };
        // The transpiler writes `require(..)` in place of `module.require(..)` without reading `module`, and `Bun` in place of `require("bun")` without reading `require`.
        if is_module_require
            && matches!(
                answer,
                SiteAnswer::Module(ModuleRef::Runtime(RuntimeModule::Bun))
            )
        {
            let specifier = self.lower_site_arguments(call, answer, arguments);
            return Some(self.emit_operation(operation, site, specifier));
        }
        if let Some(found) = require_call {
            let method = match found.form {
                RequireCallForm::Direct => None,
                RequireCallForm::Call => Some(BuiltinId::FunctionPrototypeCall),
                RequireCallForm::Apply => Some(BuiltinId::FunctionPrototypeApply),
            };
            if let Some(method) = method {
                let require = find_own_require(hir, bound, decisions, found.require)?;
                let guarded = GuardedCall {
                    call,
                    expected: method,
                    chain_exit,
                };
                return Some(lower_call_through_method(
                    self, guarded, found.form, require, operation, site,
                ));
            }
        }
        if holds_import_meta_require(hir, bound, hir[id].callee) {
            return Some(lower_call_of_filled_binding(
                self, call, chain_exit, operation, site,
            ));
        }
        match self.file.classify_callee(hir[id].callee) {
            CalleeKnowledge::Unresolved
                if is_require_made_for_own_file(hir, bound, hir[id].callee) =>
            {
                if may_still_be_undefined(hir, bound, hir[id].callee) {
                    return Some(lower_call_of_filled_binding(
                        self, call, chain_exit, operation, site,
                    ));
                }
                self.lower_expression(hir[id].callee);
                let specifier = self.lower_site_arguments(call, answer, arguments);
                Some(self.emit_operation(operation, site, specifier))
            }
            CalleeKnowledge::Unresolved
                if find_own_require(hir, bound, decisions, hir[id].callee)
                    == Some(OwnRequire::OfFile) =>
            {
                let guarded = GuardedCall {
                    call,
                    expected: BuiltinId::ModuleRequire,
                    chain_exit,
                };
                Some(lower_guarded_call(self, guarded, operation, site))
            }
            CalleeKnowledge::Unresolved => None,
            CalleeKnowledge::Bound => {
                let specifier = self.lower_site_arguments(call, answer, arguments);
                Some(self.emit_operation(operation, site, specifier))
            }
            CalleeKnowledge::Expected(expected) => {
                let guarded = GuardedCall {
                    call,
                    expected,
                    chain_exit,
                };
                Some(lower_guarded_call(self, guarded, operation, site))
            }
        }
    }

    // `require_x()` and `init_x()` of a bundle, where `var require_x = __commonJS(..)` is a module of its own.
    fn try_lower_inner_module_call(&mut self, call: ExprId) -> Option<ValueId> {
        let plan = self.file.find_plan(call)?;
        let hir = self.file.hir;
        let ExprKind::Call(id) = hir[call].kind else {
            return None;
        };
        self.lower_arguments_for_effect(hir[id].args, 0);
        self.set_position(hir[call].pos);
        Some(self.emit_planned_require(plan))
    }

    // `createRequire("/")("node:path")`: the require is made for another file, and the name of a library module means the same from every file.
    fn try_lower_library_module_named_to_made_require(&mut self, call: ExprId) -> Option<ValueId> {
        let hir = self.file.hir;
        let ExprKind::Call(id) = hir[call].kind else {
            return None;
        };
        let arguments = hir[id].args;
        let is_plain_call = matches!(hir[id].chain, Chain::No) && arguments.len() == 1;
        if !is_plain_call || has_spread_argument(hir, arguments) {
            return None;
        }
        let argument = hir.id_at(arguments, 0);
        let source = parsed_source(self.file.queries.files(), self.file.file)?;
        let named = modules_named_in(source.named_modules(), argument);
        if named.is_empty() {
            return None;
        }
        let is_made_require = is_made_require(hir, self.file.bound, hir[id].callee);
        let decisions = self.file.decisions();
        if !is_made_require
            && resolve_loader_alias(hir, self.file.bound, decisions, hir[id].callee).is_none()
        {
            return None;
        }
        let name = match self
            .file
            .decisions()
            .constant(hir, self.file.skip_type_syntax(argument))
        {
            FoldedValue::Constant(Constant::String(name))
            | FoldedValue::ConstantOutsideDeadZone(Constant::String(name)) => name,
            _ => {
                return None;
            }
        };
        let module = ModuleRef::Runtime(named.iter().find(|it| it.name == name)?.module);
        let site = AnsweredSite {
            specifier: ImportSpecifier::Constant(name),
            specifier_node: argument,
            answer: SiteAnswer::Module(module),
            plan: None,
        };
        if !is_made_require || may_still_be_undefined(hir, self.file.bound, hir[id].callee) {
            return Some(lower_call_of_filled_binding(
                self,
                call,
                None,
                ModuleOperation::Require,
                site,
            ));
        }
        self.lower_expression(hir[id].callee);
        let specifier = self.lower_site_arguments(call, site.answer, arguments);
        Some(self.emit_operation(ModuleOperation::Require, site, specifier))
    }

    // `process.getBuiltinModule(flag ? "node:vm" : "node:v8")`
    fn try_lower_choice_of_builtin_modules(
        &mut self,
        call: ExprId,
        chain_exit: Option<BlockId>,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        let ExprKind::Call(id) = hir[call].kind else {
            return None;
        };
        let argument = hir.ids(hir[id].args).next()?;
        let source = parsed_source(self.file.queries.files(), self.file.file)?;
        let named = modules_named_in(source.named_modules(), argument).iter();
        let spelled_modules: Vec<SpelledModule> = named
            .map(|it| SpelledModule {
                spelling: it.name,
                module: ModuleRef::Runtime(it.module),
            })
            .collect();
        if has_spread_argument(hir, hir[id].args) {
            return None;
        }
        self.file
            .find_modules_of_every_value(argument, &spelled_modules)?;
        let site = AnsweredSite {
            specifier: ImportSpecifier::Unknown,
            specifier_node: argument,
            answer: SiteAnswer::Computed(Candidates::Modules(&spelled_modules)),
            plan: None,
        };
        let expected = match self.file.classify_callee(hir[id].callee) {
            CalleeKnowledge::Expected(expected) => expected,
            CalleeKnowledge::Unresolved => {
                let (bound, decisions) = (self.file.bound, self.file.decisions());
                resolve_loader_alias(hir, bound, decisions, hir[id].callee)?;
                return Some(lower_call_of_filled_binding(
                    self,
                    call,
                    chain_exit,
                    ModuleOperation::Require,
                    site,
                ));
            }
            CalleeKnowledge::Bound => return None,
        };
        let guarded = GuardedCall {
            call,
            expected,
            chain_exit,
        };
        Some(lower_guarded_call(
            self,
            guarded,
            ModuleOperation::Require,
            site,
        ))
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
        let name = self
            .file
            .bound
            .declared_symbol(Decl::ImportEquals(declaration));
        let yields_value = modules.holder(own_file, name).is_none();
        let site = AnsweredSite {
            specifier: site.specifier,
            specifier_node: site.specifier_node,
            answer: modules.site_answer(own_file, kind),
            plan: create_plan(modules.site_at(own_file, kind), yields_value),
        };
        Some(self.emit_require(site, None))
    }

    fn emit_expected_callee(&mut self, expected: BuiltinId) -> ValueId {
        match table::entry(expected).scope {
            Scope::Module => {
                let module = self.file.module_id();
                self.builder.module_builtin(expected, module)
            }
            Scope::Realm => self.builder.builtin(expected),
        }
    }

    fn emit_operation(
        &mut self,
        operation: ModuleOperation,
        site: AnsweredSite<'_>,
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
            ModuleOperation::ImportMetaResolve => {
                let SiteAnswer::Module(module) = site.answer else {
                    unreachable!("find_operation binds import.meta.resolve to one module");
                };
                self.emit_resolve_module(site.specifier, module, true)
            }
        }
    }

    // Whoever holds the module object can put another object in place of its exports, so the layout is only expected.
    fn expect_exports_layout(&mut self, module: ModuleRef, required: ValueId) -> ValueId {
        let layout = match module {
            ModuleRef::File(file) => self.file.module_exports_layout(file),
            _ => None,
        };
        let Some(layout) = layout else {
            return required;
        };
        let expected = self.file.fragment.types.intern(Type::layout(layout));
        self.expect_type(required, expected)
    }

    // The module has run, is running, or throws its error.
    fn emit_evaluation(&mut self, plan: PlannedSite) {
        let module = self.file.fragment.declare_module(plan.target);
        let referrer = self.current_module_id();
        if plan.records {
            self.builder.record_require(module, referrer);
        }
        // The function that holds the text of a file with a wrapper is not the body of the module, and what stands behind a `using` declaration stands under the handler that disposes of the resource.
        let is_bare = plan.is_bare && self.is_module_body() && self.handler().is_none();
        self.builder.evaluate_module(module, referrer, is_bare);
        if plan.records {
            self.builder.record_require(module, referrer);
        }
    }

    fn emit_planned_require(&mut self, plan: PlannedSite) -> ValueId {
        self.emit_evaluation(plan);
        // Nothing looks at what the call yields, so no object of the module is asked for.
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

    fn emit_require_module(&mut self, module: ModuleRef, specifier: StringId) -> ValueId {
        let id = self.file.fragment.declare_module(module);
        let referrer = self.file.module_id();
        let required = self.builder.require_module(id, referrer, specifier);
        self.expect_exports_layout(module, required)
    }

    // One of the modules that a computed specifier can name.
    fn emit_require_of_candidate(&mut self, module: ModuleRef, specifier: StringId) -> ValueId {
        // The plan has a request for each candidate that the site evaluates itself. The loader has the others.
        let referrer = self.current_module();
        let mut requests = self.file.inputs.modules.requests_of(referrer).iter();
        let is_evaluated = requests
            .any(|request| request.kind == ModuleRequestKind::Require && request.target == module);
        match is_evaluated {
            false => self.emit_require_module(module, specifier),
            true => {
                let plan = PlannedSite {
                    target: module,
                    is_bare: false,
                    records: true,
                    yields_value: true,
                };
                self.emit_planned_require(plan)
            }
        }
    }

    fn emit_require(&mut self, site: AnsweredSite<'_>, specifier: Option<ValueId>) -> ValueId {
        match site.answer {
            SiteAnswer::Module(module) => {
                if let Some(plan) = site.plan {
                    return self.emit_planned_require(plan);
                }
                let ImportSpecifier::Constant(text) = site.specifier else {
                    unreachable!("only a constant specifier names one module");
                };
                let text = self.file.intern_atom(text);
                self.emit_require_module(module, text)
            }
            SiteAnswer::Computed(candidates) => {
                let specifier = ComputedSpecifier {
                    node: site.specifier_node,
                    value: specifier.unwrap_or_else(|| self.builder.undefined()),
                    candidates,
                };
                self.emit_computed_load(ComputedLoad::Require, specifier)
            }
            SiteAnswer::Failed(failure) => self.emit_require_failure(site.specifier, failure, true),
            SiteAnswer::Erased => self.builder.undefined(),
        }
    }

    // The build spells a candidate from the folder of the file: "./plugins/a.js".
    fn emit_path_from_own_directory(&mut self, text: ValueId) -> ValueId {
        let directory = self.get_commonjs_variable(CommonJsVariable::Dirname);
        let starts_with = self.builder.builtin(BuiltinId::StringPrototypeStartsWith);
        let arguments = Arguments::Values(smallvec![directory]);
        let is_below = call::emit_call(
            self,
            starts_with,
            Some(text),
            arguments,
            CallSite::default(),
        );
        let is_below = self.builder.to_boolean(is_below);
        let spelled = self.builder.create_variable(None);
        self.builder.write_variable(spelled, text);
        let below = self.create_block();
        let done = self.create_block();
        self.builder
            .branch(is_below, Edge::to(below), Edge::to(done));

        self.continue_in(below);
        let length = PropertyName::Constant(self.file.atom_key(known::length));
        let length = self.emit_get(directory, length);
        let slice = self.builder.builtin(BuiltinId::StringPrototypeSlice);
        let arguments = Arguments::Values(smallvec![length]);
        let mut rest = call::emit_call(self, slice, Some(text), arguments, CallSite::default());
        // `path.join` answers `B:\~BUN\root\plugins\a.js` there.
        let platform = self.file.inputs.options.platform;
        if platform.contains(Platforms::WINDOWS) {
            let replace_all = self.builder.builtin(BuiltinId::StringPrototypeReplaceAll);
            let separators = [&b"\\"[..], b"/"].map(|separator| {
                let separator = self.file.intern_bytes(separator);
                self.builder.string(separator)
            });
            let arguments = Arguments::Values(smallvec![separators[0], separators[1]]);
            rest = call::emit_call(
                self,
                replace_all,
                Some(rest),
                arguments,
                CallSite::default(),
            );
        }
        let dot = self.file.intern_bytes(b".");
        let dot = self.builder.string(dot);
        let from_folder = self.builder.strcat(&[dot, rest]);
        self.builder.write_variable(spelled, from_folder);
        self.jump(done);

        self.continue_in(done);
        self.builder.read_variable(spelled)
    }

    // The build has followed `path.join(__dirname, "..", "a.js")` to a file, and has bound names to what that file declares.
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
        let is_windows = self
            .file
            .inputs
            .options
            .platform
            .contains(Platforms::WINDOWS);
        let separator: &[u8] = if is_windows { b"\\" } else { b"/" };
        let bytes = self.file.queries.atom_bytes(written).to_vec();
        let mut below = bytes.strip_prefix(b".").unwrap_or(&bytes);
        let mut directory = self.get_commonjs_variable(CommonJsVariable::Dirname);
        while let Some(rest) = below.strip_prefix(b"/..")
            && (rest.is_empty() || rest.starts_with(b"/"))
        {
            below = rest;
            let separator = self.file.intern_bytes(separator);
            let separator = self.builder.string(separator);
            let last_index_of = self.builder.builtin(BuiltinId::StringPrototypeLastIndexOf);
            let arguments = Arguments::Values(smallvec![separator]);
            let end = call::emit_call(
                self,
                last_index_of,
                Some(directory),
                arguments,
                CallSite::default(),
            );
            let start = self.builder.integer(0);
            let slice = self.builder.builtin(BuiltinId::StringPrototypeSlice);
            let arguments = Arguments::Values(smallvec![start, end]);
            directory =
                call::emit_call(self, slice, Some(directory), arguments, CallSite::default());
        }
        let below: Vec<u8> = bun_core::strings::split(below, b"/")
            .collect::<Vec<_>>()
            .join(separator);
        let below = self.file.intern_bytes(&below);
        let below = self.builder.string(below);
        let expected = self.builder.strcat(&[directory, below]);
        let is_as_written = self.builder.strict_eq(text, expected);
        let as_written = self.create_block();
        let other = self.create_unlikely_block();
        if is_windows {
            // `path.join(__dirname) + "/a.js"` is `B:\~BUN\root/a.js` there, which names the same file.
            let spelled_otherwise = self.create_unlikely_block();
            let spelled_as_text = self.create_unlikely_block();
            self.builder.branch(
                is_as_written,
                Edge::to(as_written),
                Edge::to(spelled_otherwise),
            );

            self.continue_in(spelled_otherwise);
            let is_text = self.builder.type_test(text, TypeTable::STRING);
            self.builder
                .branch(is_text, Edge::to(spelled_as_text), Edge::to(other));

            self.continue_in(spelled_as_text);
            let replace_all = self.builder.builtin(BuiltinId::StringPrototypeReplaceAll);
            let separators = [&b"/"[..], b"\\"].map(|separator| {
                let separator = self.file.intern_bytes(separator);
                self.builder.string(separator)
            });
            let arguments = Arguments::Values(smallvec![separators[0], separators[1]]);
            let with_one_separator = call::emit_call(
                self,
                replace_all,
                Some(text),
                arguments,
                CallSite::default(),
            );
            let is_same_file = self.builder.strict_eq(with_one_separator, expected);
            self.builder
                .branch(is_same_file, Edge::to(as_written), Edge::to(other));
        } else {
            self.builder
                .branch(is_as_written, Edge::to(as_written), Edge::to(other));
        }
        let written = self.file.intern_atom(written);
        Some(PathTest {
            as_written,
            other,
            written,
        })
    }

    fn emit_refusal_of_other_path(&mut self, written: StringId, code: &[u8]) -> ValueId {
        let head = self.file.intern_bytes(b"Cannot load '");
        let tail = self.file.intern_bytes(
            b"': path.join or path.resolve was replaced and returned a different path. This executable can't load a module from a dynamic path.",
        );
        let parts = [head, written, tail].map(|part| self.builder.string(part));
        let message = self.builder.strcat(&parts);
        let constructor = self.builder.builtin(BuiltinId::Error);
        let arguments = Arguments::Values(smallvec![message]);
        let error = self.emit_construct(constructor, None, arguments, CallSite::default());
        let name = self.file.intern_bytes(b"code");
        let name = PropertyName::Constant(self.file.text_key(name));
        let code = self.file.intern_bytes(code);
        let code = self.builder.string(code);
        self.emit_set(error, name, code);
        error
    }

    fn emit_computed_load(
        &mut self,
        load: ComputedLoad,
        computed: ComputedSpecifier<'_>,
    ) -> ValueId {
        let specifier = computed.value;
        let spelled_modules = match computed.candidates {
            Candidates::All => &[][..],
            Candidates::Modules(spelled_modules) => spelled_modules,
        };
        let modules_of_every_value = self
            .file
            .find_modules_of_every_value(computed.node, spelled_modules);
        let spelled_modules = modules_of_every_value.as_deref().unwrap_or(spelled_modules);
        if spelled_modules.is_empty() {
            return self.emit_load_by_name(load, specifier);
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
        let edges: Vec<Edge<'static>> = arms.iter().map(|&arm| Edge::to(arm)).collect();
        let spelled = match self
            .file
            .decisions()
            .is_path_from_own_directory(computed.node)
        {
            true => self.emit_path_from_own_directory(specifier),
            false => specifier,
        };
        self.builder
            .switch_string(spelled, &strings, &edges, Edge::to(otherwise));

        for ((spelled, &spelling), &arm) in spelled_modules.iter().zip(&strings).zip(&arms) {
            self.continue_in(arm);
            let loaded = match load {
                ComputedLoad::Require => self.emit_require_of_candidate(spelled.module, spelling),
                ComputedLoad::Import => {
                    let modules = self.file.inputs.modules;
                    let module = modules.face(spelled.module).unwrap_or(spelled.module);
                    let module = self.file.fragment.declare_module(module);
                    let referrer = self.file.module_id();
                    self.builder.import_module(module, referrer)
                }
            };
            self.builder.write_variable(result, loaded);
            self.jump(done);
        }

        self.continue_in(otherwise);
        if modules_of_every_value.is_some() {
            self.builder.unreachable();
        } else {
            let loaded = self.emit_load_by_name(load, specifier);
            self.builder.write_variable(result, loaded);
            self.jump(done);
        }

        self.continue_in(done);
        self.builder.read_variable(result)
    }

    fn emit_load_by_name(&mut self, load: ComputedLoad, specifier: ValueId) -> ValueId {
        let referrer = self.file.module_id();
        match load {
            ComputedLoad::Require => self.builder.require_dynamic(specifier, referrer),
            ComputedLoad::Import => self.builder.import_dynamic(specifier, None, referrer),
        }
    }

    fn emit_require_resolve(
        &mut self,
        site: AnsweredSite<'_>,
        specifier: Option<ValueId>,
    ) -> ValueId {
        match site.answer {
            SiteAnswer::Module(module) => match self.file.find_name_answered_as_asked(site) {
                Some(name) => self.builder.string(name),
                None => self.emit_resolve_module(site.specifier, module, false),
            },
            SiteAnswer::Computed(_) => {
                let specifier = specifier.unwrap_or_else(|| self.builder.undefined());
                let referrer = self.file.module_id();
                self.builder
                    .resolve_dynamic(specifier, referrer, false, false)
            }
            SiteAnswer::Failed(failure) => {
                self.emit_require_failure(site.specifier, failure, false)
            }
            SiteAnswer::Erased => self.builder.undefined(),
        }
    }

    fn emit_resolve_module(
        &mut self,
        specifier: ImportSpecifier,
        module: ModuleRef,
        is_url: bool,
    ) -> ValueId {
        let ImportSpecifier::Constant(text) = specifier else {
            unreachable!("only a constant specifier names one module");
        };
        let module = self.file.fragment.declare_module(module);
        let referrer = self.file.module_id();
        let text = self.file.intern_atom(text);
        self.builder.resolve_module(module, referrer, text, is_url)
    }

    // The error of `require` and of `require.resolve` is worded by the host's resolver, which is told which of the two asks. It is another than that of `import`.
    fn emit_require_failure(
        &mut self,
        specifier: ImportSpecifier,
        failure: ModuleFailureId,
        is_for_require: bool,
    ) -> ValueId {
        match specifier {
            ImportSpecifier::Constant(text) => {
                let text = self.file.intern_atom(text);
                let specifier = self.builder.string(text);
                let referrer = self.file.module_id();
                self.builder
                    .resolve_dynamic(specifier, referrer, false, is_for_require);
            }
            ImportSpecifier::Pattern { .. } | ImportSpecifier::Unknown => {}
        }
        self.emit_module_failure(failure, true)
    }

    // Where the host's resolver finds at run time what the build did not, the error bears the code of `require` or that of `import`.
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

    fn emit_resolved_import(&mut self, object: BuiltinId) -> ValueId {
        let value = self.emit_builtin_import(object, None);
        let resolve = self.builder.builtin(BuiltinId::PromiseResolve);
        let promise = self.builder.builtin(BuiltinId::Promise);
        let arguments = Arguments::Values(smallvec![value]);
        call::emit_call(self, resolve, Some(promise), arguments, CallSite::default())
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
        let reject = self.builder.builtin(BuiltinId::PromiseReject);
        let promise = self.builder.builtin(BuiltinId::Promise);
        let arguments = Arguments::Values(smallvec![error]);
        call::emit_call(self, reject, Some(promise), arguments, CallSite::default())
    }

    fn lower_site_arguments(
        &mut self,
        call: ExprId,
        answer: SiteAnswer<'_>,
        arguments: IdList<ExprId>,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        let first = (arguments.len() > 0).then(|| hir.id_at(arguments, 0));
        let specifier = self.lower_computed_specifier(answer, first);
        self.lower_arguments_for_effect(arguments, 1);
        self.set_position(hir[call].pos);
        specifier
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
                if self.file.decisions().is_path_made_by_call(argument) {
                    return Some(self.lower_expression(argument));
                }
                self.lower_expression_for_effect(argument);
                None
            }
        }
    }

    fn lower_arguments_for_effect(&mut self, arguments: IdList<ExprId>, start: usize) {
        let hir = self.file.hir;
        for index in start..arguments.len() {
            self.lower_expression_for_effect(hir.id_at(arguments, index));
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
            // The second argument can ask for the file at that path in place of the module.
            SiteAnswer::Computed(_) if argument_count > 1 => None,
            _ => Some(ModuleOperation::Require),
        },
        ImportSiteKind::GetBuiltinModule(_) => match answer {
            SiteAnswer::Module(_) | SiteAnswer::Erased => Some(ModuleOperation::Require),
            SiteAnswer::Computed(_) | SiteAnswer::Failed(_) => None,
        },
        ImportSiteKind::RequireResolve(_) => {
            (argument_count <= 1).then_some(ModuleOperation::RequireResolve)
        }
        ImportSiteKind::ImportMetaResolve(_) => match answer {
            SiteAnswer::Module(_) if site.consults_resolver && argument_count == 1 => {
                Some(ModuleOperation::ImportMetaResolve)
            }
            _ => None,
        },
        _ => None,
    }
}

#[derive(Copy, Clone)]
struct GuardedCall {
    call: ExprId,
    expected: BuiltinId,
    chain_exit: Option<BlockId>,
}

fn lower_guarded_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    guarded: GuardedCall,
    operation: ModuleOperation,
    site: AnsweredSite<'_>,
) -> ValueId {
    let hir = lowering.file.hir;
    let GuardedCall {
        call,
        expected,
        chain_exit,
    } = guarded;
    let ExprKind::Call(id) = hir[call].kind else {
        unreachable!("lower_guarded_call takes a Call");
    };
    let mut callee = lowering.lower_callee(hir[id].callee, chain_exit);
    match hir[id].chain {
        Chain::Start => {
            let exit = chain_exit.expect("an optional call has the exit of its chain");
            let function = callee.function;
            callee.function = lowering.branch_if_expression_nullish(hir[id].callee, function, exit);
        }
        Chain::No | Chain::Continue => {}
    }
    let Arguments::Values(values) = lowering.lower_arguments(hir[id].args) else {
        unreachable!("a module call with a spread argument is an ordinary call");
    };
    lowering.set_position(hir[call].pos);
    let expected_callee = lowering.emit_expected_callee(expected);
    let is_expected = lowering.builder.strict_eq(callee.function, expected_callee);
    let result = lowering.builder.create_variable(None);
    let matched = lowering.create_block();
    let other = lowering.create_block();
    let done = lowering.create_block();
    let other_callee = Callee {
        function: lowering.builder.add_edge_result(other),
        key: None,
        ..callee
    };
    let other_edge = Edge::with_proofs(other, &[0]);
    lowering
        .builder
        .branch(is_expected, Edge::to(matched), other_edge);

    lowering.continue_in(matched);
    let loaded = lowering.emit_operation(operation, site.under_test(), values.first().copied());
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

// The callee is a binding that one statement fills with `import.meta.require` or with what `createRequire` makes, and nothing else stores to.
fn lower_call_of_filled_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    chain_exit: Option<BlockId>,
    operation: ModuleOperation,
    site: AnsweredSite<'_>,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Call(id) = hir[call].kind else {
        unreachable!("lower_call_of_filled_binding takes a Call");
    };
    let mut callee = lowering.lower_callee(hir[id].callee, chain_exit);
    match hir[id].chain {
        Chain::Start => {
            let exit = chain_exit.expect("an optional call has the exit of its chain");
            let function = callee.function;
            callee.function = lowering.branch_if_expression_nullish(hir[id].callee, function, exit);
        }
        Chain::No | Chain::Continue => {}
    }
    let Arguments::Values(values) = lowering.lower_arguments(hir[id].args) else {
        unreachable!("a module call with a spread argument is an ordinary call");
    };
    lowering.set_position(hir[call].pos);
    let empty = lowering.builder.undefined();
    let is_empty = lowering.builder.strict_eq(callee.function, empty);
    let result = lowering.builder.create_variable(None);
    let filled = lowering.create_block();
    let not_filled = lowering.create_block();
    let done = lowering.create_block();
    lowering
        .builder
        .branch(is_empty, Edge::to(not_filled), Edge::to(filled));

    lowering.continue_in(filled);
    let loaded = lowering.emit_operation(
        operation,
        site.where_binding_is_filled(),
        values.first().copied(),
    );
    lowering.builder.write_variable(result, loaded);
    lowering.jump(done);

    lowering.continue_in(not_filled);
    let arguments = Arguments::Values(values);
    let returned = lowering.emit_call_expression(call, callee, arguments, Tail::No);
    lowering.builder.write_variable(result, returned);
    lowering.jump(done);

    lowering.continue_in(done);
    lowering.builder.read_variable(result)
}

// `require.call(receiver, p)` and `require.apply(receiver, [p])`.
fn lower_call_through_method(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    guarded: GuardedCall,
    form: RequireCallForm,
    require: OwnRequire,
    operation: ModuleOperation,
    site: AnsweredSite<'_>,
) -> ValueId {
    let hir = lowering.file.hir;
    let GuardedCall {
        call,
        expected,
        chain_exit,
    } = guarded;
    let ExprKind::Call(id) = hir[call].kind else {
        unreachable!("lower_call_through_method takes a Call");
    };
    let mut callee = lowering.lower_callee(hir[id].callee, chain_exit);
    match hir[id].chain {
        Chain::Start => {
            let exit = chain_exit.expect("an optional call has the exit of its chain");
            let function = callee.function;
            callee.function = lowering.branch_if_expression_nullish(hir[id].callee, function, exit);
        }
        Chain::No | Chain::Continue => {}
    }
    let Arguments::Values(values) = lowering.lower_arguments(hir[id].args) else {
        unreachable!("a module call with a spread argument is an ordinary call");
    };
    lowering.set_position(hir[call].pos);
    let receiver = callee.this.expect("the call of a member has a receiver");

    let is_followed = lowering.builder.create_variable(None);
    let method_is_expected = lowering.create_block();
    let method_is_other = lowering.create_block();
    let decided = lowering.create_block();
    let expected_method = lowering.emit_expected_callee(expected);
    let is_method = lowering.builder.strict_eq(callee.function, expected_method);
    lowering.builder.branch(
        is_method,
        Edge::to(method_is_expected),
        Edge::to(method_is_other),
    );

    lowering.continue_in(method_is_expected);
    let is_require = match require {
        OwnRequire::OfFile => {
            let expected_receiver = lowering.emit_expected_callee(BuiltinId::ModuleRequire);
            lowering.builder.strict_eq(receiver, expected_receiver)
        }
        // Nothing else stores to the binding that holds it, and where that is still empty the read of the method has thrown.
        OwnRequire::Made => lowering.builder.boolean(true),
    };
    lowering.builder.write_variable(is_followed, is_require);
    lowering.jump(decided);

    lowering.continue_in(method_is_other);
    let no = lowering.builder.boolean(false);
    lowering.builder.write_variable(is_followed, no);
    lowering.jump(decided);

    lowering.continue_in(decided);
    let is_followed = lowering.builder.read_variable(is_followed);
    let result = lowering.builder.create_variable(None);
    let matched = lowering.create_block();
    let other = lowering.create_block();
    let done = lowering.create_block();
    lowering
        .builder
        .branch(is_followed, Edge::to(matched), Edge::to(other));

    lowering.continue_in(matched);
    let specifier = match (form, site.answer) {
        (RequireCallForm::Direct, _) => unreachable!("a direct call goes through no method"),
        (RequireCallForm::Call, _) => values.get(1).copied(),
        (RequireCallForm::Apply, SiteAnswer::Computed(_)) => {
            let first = lowering.builder.integer(0);
            Some(lowering.builder.elem_get(values[1], first))
        }
        (
            RequireCallForm::Apply,
            SiteAnswer::Module(_) | SiteAnswer::Failed(_) | SiteAnswer::Erased,
        ) => None,
    };
    let loaded = lowering.emit_operation(operation, site.under_test(), specifier);
    lowering.builder.write_variable(result, loaded);
    lowering.jump(done);

    lowering.continue_in(other);
    let arguments = Arguments::Values(values);
    let returned = lowering.emit_call_expression(call, callee, arguments, Tail::No);
    lowering.builder.write_variable(result, returned);
    lowering.jump(done);

    lowering.continue_in(done);
    lowering.builder.read_variable(result)
}

struct PathTest {
    as_written: BlockId,
    other: BlockId,
    written: StringId,
}

// `bun run` loads the module when the specifier is anything but a string literal.
fn find_object_replacing_namespace(
    hir: &hir::File<'_>,
    arguments: IdList<ExprId>,
    module: ModuleRef,
) -> Option<BuiltinId> {
    let first = (arguments.len() > 0).then(|| hir[hir.id_at(arguments, 0)].kind);
    match (module, first) {
        (ModuleRef::Runtime(module), Some(ExprKind::String(_))) => {
            table::object_replacing_namespace(module)
        }
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

fn has_spread_argument(hir: &hir::File<'_>, arguments: IdList<ExprId>) -> bool {
    (0..arguments.len())
        .any(|index| matches!(hir[hir.id_at(arguments, index)].kind, ExprKind::Spread(_)))
}
