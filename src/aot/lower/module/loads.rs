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

use super::imports;
use crate::builtins::id::{BuiltinId, RuntimeModule};
use crate::builtins::table::{self, Platforms, Scope};
use crate::builtins::{Mutability, Resolved};
use crate::ir::generated::{BlockRole, ModuleRequestKind};
use crate::ir::{BlockId, Edge, StringId, Type, ValueId};
use crate::load::loader_aliases::resolve_loader_alias;
use crate::load::named_loads::modules_named_in;
use crate::load::sources::parsed_source;
use crate::lower::call::{self, Arguments, CallSite, Callee};
use crate::lower::expression::{self, Tail};
use crate::lower::member::{self, PropertyName};
use crate::lower::{FileLowering, FunctionLowering, commonjs, condition, control, layouts};
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

fn find_plan(file: &FileLowering<'_, '_, '_, '_>, call: ExprId) -> Option<PlannedSite> {
    let modules = file.inputs.modules;
    let site = modules.site(file.file, call)?;
    let yields_value = match site {
        Site::Evaluate { .. } => modules.is_site_read_as_value(file.file, call),
        Site::AsToday => return None,
    };
    create_plan(Some(site), yields_value)
}

#[derive(Copy, Clone)]
struct ComputedSpecifier<'g> {
    node: ExprId,
    value: ValueId,
    candidates: Candidates<'g>,
}

pub(super) fn lower_import_call(
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
            let specifier = lower_computed_specifier(lowering, SiteAnswer::Module(module), first);
            lower_arguments_for_effect(lowering, args, 1);
            lowering.set_position(position);
            let test = specifier.zip(first).and_then(|(text, node)| {
                let written = lowering.file.decisions().specifier(node);
                branch_on_path_made_by_call(lowering, written, node, text)
            });
            let Some(test) = test else {
                return emit_import_of_module(lowering, args, module);
            };
            let result = lowering.builder.create_variable(None);
            let done = lowering.create_block();
            lowering.continue_in(test.as_written);
            let loaded = emit_import_of_module(lowering, args, module);
            lowering.builder.write_variable(result, loaded);
            lowering.jump(done);

            lowering.continue_in(test.other);
            let error = emit_refusal_of_other_path(lowering, test.written, b"ERR_MODULE_NOT_FOUND");
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
                expression::lower_expression(lowering, node)
            } else {
                lowering.builder.undefined()
            };
            let options = arguments
                .next()
                .map(|second| expression::lower_expression(lowering, second));
            lower_arguments_for_effect(lowering, args, 2);
            lowering.set_position(position);
            if options.is_none() {
                let specifier = ComputedSpecifier {
                    node,
                    value: specifier,
                    candidates,
                };
                return emit_computed_load(lowering, ComputedLoad::Import, specifier);
            }
            let referrer = lowering.file.module_id();
            lowering
                .builder
                .import_dynamic(specifier, options, referrer)
        }
        SiteAnswer::Erased => {
            lower_arguments_for_effect(lowering, args, 0);
            lowering.set_position(position);
            lowering.builder.undefined()
        }
        SiteAnswer::Failed(failure) => {
            lower_arguments_for_effect(lowering, args, 0);
            lowering.set_position(position);
            emit_rejected_import(lowering, failure)
        }
    }
}

fn emit_import_of_module(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    arguments: IdList<ExprId>,
    module: ModuleRef,
) -> ValueId {
    if let Some(object) = find_object_replacing_namespace(lowering.file.hir, arguments, module) {
        return emit_resolved_import(lowering, object);
    }
    let module = lowering.file.inputs.modules.face(module).unwrap_or(module);
    let module = lowering.file.fragment.declare_module(module);
    let referrer = lowering.file.module_id();
    lowering.builder.import_module(module, referrer)
}

pub(super) fn try_lower_module_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    chain_exit: Option<BlockId>,
) -> Option<ValueId> {
    let hir = lowering.file.hir;
    let ExprKind::Call(id) = hir[call].kind else {
        return None;
    };
    let arguments = hir[id].args;
    let analysis = &lowering.file.compiled.analysis;
    let Some(site) = analysis.import_site_of_call(call) else {
        if let Some(evaluated) = try_lower_inner_module_call(lowering, call) {
            return Some(evaluated);
        }
        if let Some(loaded) = try_lower_library_module_named_to_made_require(lowering, call) {
            return Some(loaded);
        }
        return try_lower_choice_of_builtin_modules(lowering, call, chain_exit);
    };
    let site = analysis.import_sites[site];
    if has_spread_argument(hir, arguments) {
        return None;
    }
    let bound = lowering.file.bound;
    let require_call = matches!(site.kind, ImportSiteKind::Require(_))
        .then(|| find_require_call(hir, bound, hir[id].callee, arguments))
        .flatten();
    let is_module_require =
        matches!(site.kind, ImportSiteKind::Require(_)) && require_call.is_none();
    let given = require_call.map_or(arguments, |found| found.args);
    let modules = lowering.file.inputs.modules;
    let answer = modules.site_answer(lowering.file.file, site.kind);
    let operation = find_operation(&site, answer, given.len())?;
    let site = AnsweredSite {
        specifier: site.specifier,
        specifier_node: site.specifier_node,
        answer,
        plan: find_plan(lowering.file, call),
    };
    // The transpiler writes `require(..)` in place of `module.require(..)` without reading `module`, and `Bun` in place of `require("bun")` without reading `require`.
    if is_module_require
        && matches!(
            answer,
            SiteAnswer::Module(ModuleRef::Runtime(RuntimeModule::Bun))
        )
    {
        let specifier = lower_site_arguments(lowering, call, answer, arguments);
        return Some(emit_operation(lowering, operation, site, specifier));
    }
    if let Some(found) = require_call {
        let method = match found.form {
            RequireCallForm::Direct => None,
            RequireCallForm::Call => Some(BuiltinId::FunctionPrototypeCall),
            RequireCallForm::Apply => Some(BuiltinId::FunctionPrototypeApply),
        };
        if let Some(method) = method {
            let require = find_own_require(hir, bound, found.require)?;
            let guarded = GuardedCall {
                call,
                expected: method,
                chain_exit,
            };
            return Some(lower_call_through_method(
                lowering, guarded, found.form, require, operation, site,
            ));
        }
    }
    if holds_import_meta_require(hir, bound, hir[id].callee) {
        return Some(lower_call_of_filled_binding(
            lowering, call, chain_exit, operation, site,
        ));
    }
    match classify_callee(lowering.file, hir[id].callee) {
        CalleeKnowledge::Unresolved if is_require_made_for_own_file(hir, bound, hir[id].callee) => {
            if may_still_be_undefined(hir, bound, hir[id].callee) {
                return Some(lower_call_of_filled_binding(
                    lowering, call, chain_exit, operation, site,
                ));
            }
            expression::lower_expression(lowering, hir[id].callee);
            let specifier = lower_site_arguments(lowering, call, answer, arguments);
            Some(emit_operation(lowering, operation, site, specifier))
        }
        CalleeKnowledge::Unresolved
            if find_own_require(hir, bound, hir[id].callee) == Some(OwnRequire::OfFile) =>
        {
            let guarded = GuardedCall {
                call,
                expected: BuiltinId::ModuleRequire,
                chain_exit,
            };
            Some(lower_guarded_call(lowering, guarded, operation, site))
        }
        CalleeKnowledge::Unresolved => None,
        CalleeKnowledge::Bound => {
            let specifier = lower_site_arguments(lowering, call, answer, arguments);
            Some(emit_operation(lowering, operation, site, specifier))
        }
        CalleeKnowledge::Expected(expected) => {
            let guarded = GuardedCall {
                call,
                expected,
                chain_exit,
            };
            Some(lower_guarded_call(lowering, guarded, operation, site))
        }
    }
}

// `require_x()` and `init_x()` of a bundle, where `var require_x = __commonJS(..)` is a module of its own.
fn try_lower_inner_module_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
) -> Option<ValueId> {
    let plan = find_plan(lowering.file, call)?;
    let hir = lowering.file.hir;
    let ExprKind::Call(id) = hir[call].kind else {
        return None;
    };
    lower_arguments_for_effect(lowering, hir[id].args, 0);
    lowering.set_position(hir[call].pos);
    Some(emit_planned_require(lowering, plan))
}

// `createRequire("/")("node:path")`: the require is made for another file, and the name of a library module means the same from every file.
fn try_lower_library_module_named_to_made_require(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
) -> Option<ValueId> {
    let hir = lowering.file.hir;
    let ExprKind::Call(id) = hir[call].kind else {
        return None;
    };
    let arguments = hir[id].args;
    let is_plain_call = matches!(hir[id].chain, Chain::No) && arguments.len() == 1;
    if !is_plain_call || has_spread_argument(hir, arguments) {
        return None;
    }
    let is_made_require = is_made_require(hir, lowering.file.bound, hir[id].callee);
    let decisions = lowering.file.decisions();
    if !is_made_require
        && resolve_loader_alias(hir, lowering.file.bound, decisions, hir[id].callee).is_none()
    {
        return None;
    }
    let argument = hir.id_at(arguments, 0);
    let name = match lowering
        .file
        .decisions()
        .constant(hir, expression::skip_type_syntax(lowering.file, argument))
    {
        FoldedValue::Constant(Constant::String(name))
        | FoldedValue::ConstantOutsideDeadZone(Constant::String(name)) => name,
        FoldedValue::Constant(_)
        | FoldedValue::ConstantOutsideDeadZone(_)
        | FoldedValue::Unknown => {
            return None;
        }
    };
    let source = parsed_source(lowering.file.queries.files(), lowering.file.file)?;
    let named = modules_named_in(source.named_modules(), argument);
    let module = ModuleRef::Runtime(named.iter().find(|it| it.name == name)?.module);
    let site = AnsweredSite {
        specifier: ImportSpecifier::Constant(name),
        specifier_node: argument,
        answer: SiteAnswer::Module(module),
        plan: None,
    };
    if !is_made_require || may_still_be_undefined(hir, lowering.file.bound, hir[id].callee) {
        return Some(lower_call_of_filled_binding(
            lowering,
            call,
            None,
            ModuleOperation::Require,
            site,
        ));
    }
    expression::lower_expression(lowering, hir[id].callee);
    let specifier = lower_site_arguments(lowering, call, site.answer, arguments);
    Some(emit_operation(
        lowering,
        ModuleOperation::Require,
        site,
        specifier,
    ))
}

// `process.getBuiltinModule(flag ? "node:vm" : "node:v8")`
fn try_lower_choice_of_builtin_modules(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    chain_exit: Option<BlockId>,
) -> Option<ValueId> {
    let hir = lowering.file.hir;
    let ExprKind::Call(id) = hir[call].kind else {
        return None;
    };
    let argument = hir.ids(hir[id].args).next()?;
    let source = parsed_source(lowering.file.queries.files(), lowering.file.file)?;
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
    find_modules_of_every_value(lowering.file, argument, &spelled_modules)?;
    let site = AnsweredSite {
        specifier: ImportSpecifier::Unknown,
        specifier_node: argument,
        answer: SiteAnswer::Computed(Candidates::Modules(&spelled_modules)),
        plan: None,
    };
    let expected = match classify_callee(lowering.file, hir[id].callee) {
        CalleeKnowledge::Expected(expected) => expected,
        CalleeKnowledge::Unresolved => {
            let (bound, decisions) = (lowering.file.bound, lowering.file.decisions());
            resolve_loader_alias(hir, bound, decisions, hir[id].callee)?;
            return Some(lower_call_of_filled_binding(
                lowering,
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
        lowering,
        guarded,
        ModuleOperation::Require,
        site,
    ))
}

pub(super) fn lower_import_equals_require(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    declaration: ImportEqualsId,
) -> Option<ValueId> {
    let kind = ImportSiteKind::ImportEquals(declaration);
    let analysis = &lowering.file.compiled.analysis;
    let site = analysis.import_sites[analysis.import_site_index(kind)?];
    let modules = lowering.file.inputs.modules;
    let own_file = lowering.file.file;
    let name = lowering
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
    Some(emit_require(lowering, site, None))
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
            SiteAnswer::Module(_)
            | SiteAnswer::Computed(_)
            | SiteAnswer::Failed(_)
            | SiteAnswer::Erased => Some(ModuleOperation::Require),
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
            SiteAnswer::Module(_)
            | SiteAnswer::Computed(_)
            | SiteAnswer::Failed(_)
            | SiteAnswer::Erased => None,
        },
        ImportSiteKind::JsxRuntime
        | ImportSiteKind::JsxPackage
        | ImportSiteKind::Import(_)
        | ImportSiteKind::ExportFrom(_)
        | ImportSiteKind::ExportStar(_)
        | ImportSiteKind::ImportEquals(_)
        | ImportSiteKind::ImportCall(_) => None,
    }
}

fn classify_callee(file: &FileLowering<'_, '_, '_, '_>, callee: ExprId) -> CalleeKnowledge {
    let callee = expression::skip_type_syntax(file, callee);
    let Some(Resolved::Builtin(callee_path)) = file.builtins.of_expr(callee) else {
        return CalleeKnowledge::Unresolved;
    };
    let root = match file.hir.member_key(callee) {
        Some((object, _)) => expression::skip_type_syntax(file, object),
        None => callee,
    };
    let Some(Resolved::Builtin(root_path)) = file.builtins.of_expr(root) else {
        return CalleeKnowledge::Unresolved;
    };
    match table::entry(root_path.id).scope {
        Scope::Realm => CalleeKnowledge::Expected(callee_path.id),
        Scope::Module => match file.inputs.modules.kind(file.file) {
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
                unreachable!("a module of this kind has no file")
            }
        },
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
    let mut callee = call::lower_callee(lowering, hir[id].callee, chain_exit);
    match hir[id].chain {
        Chain::Start => {
            let exit = chain_exit.expect("an optional call has the exit of its chain");
            let function = callee.function;
            callee.function =
                condition::branch_if_expression_nullish(lowering, hir[id].callee, function, exit);
        }
        Chain::No | Chain::Continue => {}
    }
    let Arguments::Values(values) = call::lower_arguments(lowering, hir[id].args) else {
        unreachable!("a module call with a spread argument is an ordinary call");
    };
    lowering.set_position(hir[call].pos);
    let expected_callee = emit_expected_callee(lowering, expected);
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
    let loaded = emit_operation(
        lowering,
        operation,
        site.under_test(),
        values.first().copied(),
    );
    lowering.builder.write_variable(result, loaded);
    lowering.jump(done);

    lowering.continue_in(other);
    let arguments = Arguments::Values(values);
    let returned = call::emit_call_expression(lowering, call, other_callee, arguments, Tail::No);
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
    let mut callee = call::lower_callee(lowering, hir[id].callee, chain_exit);
    match hir[id].chain {
        Chain::Start => {
            let exit = chain_exit.expect("an optional call has the exit of its chain");
            let function = callee.function;
            callee.function =
                condition::branch_if_expression_nullish(lowering, hir[id].callee, function, exit);
        }
        Chain::No | Chain::Continue => {}
    }
    let Arguments::Values(values) = call::lower_arguments(lowering, hir[id].args) else {
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
    let loaded = emit_operation(
        lowering,
        operation,
        site.under_test(),
        values.first().copied(),
    );
    lowering.builder.write_variable(result, loaded);
    lowering.jump(done);

    lowering.continue_in(not_filled);
    let arguments = Arguments::Values(values);
    let returned = call::emit_call_expression(lowering, call, callee, arguments, Tail::No);
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
    let mut callee = call::lower_callee(lowering, hir[id].callee, chain_exit);
    match hir[id].chain {
        Chain::Start => {
            let exit = chain_exit.expect("an optional call has the exit of its chain");
            let function = callee.function;
            callee.function =
                condition::branch_if_expression_nullish(lowering, hir[id].callee, function, exit);
        }
        Chain::No | Chain::Continue => {}
    }
    let Arguments::Values(values) = call::lower_arguments(lowering, hir[id].args) else {
        unreachable!("a module call with a spread argument is an ordinary call");
    };
    lowering.set_position(hir[call].pos);
    let receiver = callee.this.expect("the call of a member has a receiver");

    let is_followed = lowering.builder.create_variable(None);
    let method_is_expected = lowering.create_block();
    let method_is_other = lowering.create_block();
    let decided = lowering.create_block();
    let expected_method = emit_expected_callee(lowering, expected);
    let is_method = lowering.builder.strict_eq(callee.function, expected_method);
    lowering.builder.branch(
        is_method,
        Edge::to(method_is_expected),
        Edge::to(method_is_other),
    );

    lowering.continue_in(method_is_expected);
    let is_require = match require {
        OwnRequire::OfFile => {
            let expected_receiver = emit_expected_callee(lowering, BuiltinId::ModuleRequire);
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
    let loaded = emit_operation(lowering, operation, site.under_test(), specifier);
    lowering.builder.write_variable(result, loaded);
    lowering.jump(done);

    lowering.continue_in(other);
    let arguments = Arguments::Values(values);
    let returned = call::emit_call_expression(lowering, call, callee, arguments, Tail::No);
    lowering.builder.write_variable(result, returned);
    lowering.jump(done);

    lowering.continue_in(done);
    lowering.builder.read_variable(result)
}

fn emit_expected_callee(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expected: BuiltinId,
) -> ValueId {
    match table::entry(expected).scope {
        Scope::Module => {
            let module = lowering.file.module_id();
            lowering.builder.module_builtin(expected, module)
        }
        Scope::Realm => lowering.builder.builtin(expected),
    }
}

fn emit_operation(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    operation: ModuleOperation,
    site: AnsweredSite<'_>,
    specifier: Option<ValueId>,
) -> ValueId {
    let test = specifier.and_then(|text| {
        branch_on_path_made_by_call(lowering, site.specifier, site.specifier_node, text)
    });
    if let Some(test) = test {
        lowering.continue_in(test.other);
        let error = emit_refusal_of_other_path(lowering, test.written, b"MODULE_NOT_FOUND");
        lowering.builder.throw(error);
        lowering.continue_in(test.as_written);
    }
    match operation {
        ModuleOperation::Require => emit_require(lowering, site, specifier),
        ModuleOperation::RequireResolve => emit_require_resolve(lowering, site, specifier),
        ModuleOperation::ImportMetaResolve => {
            let SiteAnswer::Module(module) = site.answer else {
                unreachable!("find_operation binds import.meta.resolve to one module");
            };
            emit_resolve_module(lowering, site.specifier, module, true)
        }
    }
}

// Whoever holds the module object can put another object in place of its exports, so the layout is only expected.
fn expect_exports_layout(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    module: ModuleRef,
    required: ValueId,
) -> ValueId {
    let layout = match module {
        ModuleRef::File(file) => layouts::module_exports_layout(lowering.file, file),
        ModuleRef::Inner { .. }
        | ModuleRef::Face(_)
        | ModuleRef::Check(_)
        | ModuleRef::Runtime(_)
        | ModuleRef::External { .. } => None,
    };
    let Some(layout) = layout else {
        return required;
    };
    let expected = lowering.file.fragment.types.intern(Type::layout(layout));
    lowering.expect_type(required, expected)
}

// The module has run, is running, or throws its error.
fn emit_evaluation(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, plan: PlannedSite) {
    let module = lowering.file.fragment.declare_module(plan.target);
    let referrer = commonjs::current_module_id(lowering);
    if plan.records {
        lowering.builder.record_require(module, referrer);
    }
    // The function that holds the text of a file with a wrapper is not the body of the module, and what stands behind a `using` declaration stands under the handler that disposes of the resource.
    let is_bare =
        plan.is_bare && commonjs::is_module_body(lowering) && lowering.handler().is_none();
    lowering.builder.evaluate_module(module, referrer, is_bare);
    if plan.records {
        lowering.builder.record_require(module, referrer);
    }
}

fn emit_planned_require(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    plan: PlannedSite,
) -> ValueId {
    emit_evaluation(lowering, plan);
    // Nothing looks at what the call yields, so no object of the module is asked for.
    if !plan.yields_value {
        return lowering.builder.boolean(true);
    }
    match commonjs::emit_module_value(lowering, plan.target) {
        Some(required) => expect_exports_layout(lowering, plan.target, required),
        None => {
            debug_assert!(false, "a module that is looked at as a value has one");
            lowering.builder.boolean(true)
        }
    }
}

fn emit_require_module(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    module: ModuleRef,
    specifier: StringId,
) -> ValueId {
    let id = lowering.file.fragment.declare_module(module);
    let referrer = lowering.file.module_id();
    let required = lowering.builder.require_module(id, referrer, specifier);
    expect_exports_layout(lowering, module, required)
}

// One of the modules that a computed specifier can name.
fn emit_require_of_candidate(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    module: ModuleRef,
    specifier: StringId,
) -> ValueId {
    // The plan has a request for each candidate that the site evaluates itself. The loader has the others.
    let referrer = commonjs::current_module(lowering);
    let mut requests = lowering.file.inputs.modules.requests_of(referrer).iter();
    let is_evaluated = requests
        .any(|request| request.kind == ModuleRequestKind::Require && request.target == module);
    match is_evaluated {
        false => emit_require_module(lowering, module, specifier),
        true => {
            let plan = PlannedSite {
                target: module,
                is_bare: false,
                records: true,
                yields_value: true,
            };
            emit_planned_require(lowering, plan)
        }
    }
}

fn emit_require(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: AnsweredSite<'_>,
    specifier: Option<ValueId>,
) -> ValueId {
    match site.answer {
        SiteAnswer::Module(module) => {
            if let Some(plan) = site.plan {
                return emit_planned_require(lowering, plan);
            }
            let ImportSpecifier::Constant(text) = site.specifier else {
                unreachable!("only a constant specifier names one module");
            };
            let text = lowering.file.intern_atom(text);
            emit_require_module(lowering, module, text)
        }
        SiteAnswer::Computed(candidates) => {
            let specifier = ComputedSpecifier {
                node: site.specifier_node,
                value: specifier.unwrap_or_else(|| lowering.builder.undefined()),
                candidates,
            };
            emit_computed_load(lowering, ComputedLoad::Require, specifier)
        }
        SiteAnswer::Failed(failure) => {
            emit_require_failure(lowering, site.specifier, failure, true)
        }
        SiteAnswer::Erased => lowering.builder.undefined(),
    }
}

fn find_modules_of_every_value(
    file: &FileLowering<'_, '_, '_, '_>,
    specifier: ExprId,
    spelled_modules: &[SpelledModule],
) -> Option<Vec<SpelledModule>> {
    let hir = file.hir;
    if specifier.is_none() {
        return None;
    }
    let root = expression::skip_type_syntax(file, specifier);
    let ExprKind::Cond { .. } = hir[root].kind else {
        return None;
    };
    let mut modules: Vec<SpelledModule> = Vec::new();
    let mut stack = vec![root];
    while let Some(alternative) = stack.pop() {
        let alternative = expression::skip_type_syntax(file, alternative);
        if let ExprKind::Cond { branches, .. } = hir[alternative].kind {
            let Branches { yes, no } = hir.branches(branches);
            stack.extend([no, yes]);
            continue;
        }
        let text = match file.decisions().constant(hir, alternative) {
            FoldedValue::Constant(Constant::String(text))
            | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) => text,
            FoldedValue::Constant(_)
            | FoldedValue::ConstantOutsideDeadZone(_)
            | FoldedValue::Unknown => return None,
        };
        let spelled = *spelled_modules.iter().find(|it| it.spelling == text)?;
        if !modules.contains(&spelled) {
            modules.push(spelled);
        }
    }
    Some(modules)
}

// The build spells a candidate from the folder of the file: "./plugins/a.js".
fn emit_path_from_own_directory(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    text: ValueId,
) -> ValueId {
    let directory = commonjs::get_commonjs_variable(lowering, CommonJsVariable::Dirname);
    let starts_with = lowering
        .builder
        .builtin(BuiltinId::StringPrototypeStartsWith);
    let arguments = Arguments::Values(smallvec![directory]);
    let is_below = call::emit_call(
        lowering,
        starts_with,
        Some(text),
        arguments,
        CallSite::default(),
    );
    let is_below = lowering.builder.to_boolean(is_below);
    let spelled = lowering.builder.create_variable(None);
    lowering.builder.write_variable(spelled, text);
    let below = lowering.create_block();
    let done = lowering.create_block();
    lowering
        .builder
        .branch(is_below, Edge::to(below), Edge::to(done));

    lowering.continue_in(below);
    let length = PropertyName::Constant(lowering.file.atom_key(known::length));
    let length = member::emit_get(lowering, directory, length);
    let slice = lowering.builder.builtin(BuiltinId::StringPrototypeSlice);
    let arguments = Arguments::Values(smallvec![length]);
    let rest = call::emit_call(lowering, slice, Some(text), arguments, CallSite::default());
    let dot = lowering.file.intern_bytes(b".");
    let dot = lowering.builder.string(dot);
    let from_folder = lowering.builder.strcat(&[dot, rest]);
    lowering.builder.write_variable(spelled, from_folder);
    lowering.jump(done);

    lowering.continue_in(done);
    lowering.builder.read_variable(spelled)
}

struct PathTest {
    as_written: BlockId,
    other: BlockId,
    written: StringId,
}

// The build has followed `path.join(__dirname, "..", "a.js")` to a file, and has bound names to what that file declares.
fn branch_on_path_made_by_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    specifier: ImportSpecifier,
    node: ExprId,
    text: ValueId,
) -> Option<PathTest> {
    let ImportSpecifier::Constant(written) = specifier else {
        return None;
    };
    if !lowering.file.decisions().is_path_made_by_call(node) {
        return None;
    }
    let is_windows = lowering
        .file
        .inputs
        .options
        .platform
        .contains(Platforms::WINDOWS);
    let separator: &[u8] = if is_windows { b"\\" } else { b"/" };
    let bytes = lowering.file.queries.atom_bytes(written).to_vec();
    let mut below = bytes.strip_prefix(b".").unwrap_or(&bytes);
    let mut directory = commonjs::get_commonjs_variable(lowering, CommonJsVariable::Dirname);
    while let Some(rest) = below.strip_prefix(b"/..")
        && (rest.is_empty() || rest.starts_with(b"/"))
    {
        below = rest;
        let separator = lowering.file.intern_bytes(separator);
        let separator = lowering.builder.string(separator);
        let last_index_of = lowering
            .builder
            .builtin(BuiltinId::StringPrototypeLastIndexOf);
        let arguments = Arguments::Values(smallvec![separator]);
        let end = call::emit_call(
            lowering,
            last_index_of,
            Some(directory),
            arguments,
            CallSite::default(),
        );
        let start = lowering.builder.integer(0);
        let slice = lowering.builder.builtin(BuiltinId::StringPrototypeSlice);
        let arguments = Arguments::Values(smallvec![start, end]);
        directory = call::emit_call(
            lowering,
            slice,
            Some(directory),
            arguments,
            CallSite::default(),
        );
    }
    let below: Vec<u8> = bun_core::strings::split(below, b"/")
        .collect::<Vec<_>>()
        .join(separator);
    let below = lowering.file.intern_bytes(&below);
    let below = lowering.builder.string(below);
    let expected = lowering.builder.strcat(&[directory, below]);
    let is_as_written = lowering.builder.strict_eq(text, expected);
    let as_written = lowering.create_block();
    let other = lowering.create_unlikely_block();
    lowering
        .builder
        .branch(is_as_written, Edge::to(as_written), Edge::to(other));
    let written = lowering.file.intern_atom(written);
    Some(PathTest {
        as_written,
        other,
        written,
    })
}

fn emit_refusal_of_other_path(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    written: StringId,
    code: &[u8],
) -> ValueId {
    let head = lowering.file.intern_bytes(b"Cannot load '");
    let tail = lowering.file.intern_bytes(
        b"': path.join or path.resolve was replaced and returned a different path. This executable can't load a module from a dynamic path.",
    );
    let parts = [head, written, tail].map(|part| lowering.builder.string(part));
    let message = lowering.builder.strcat(&parts);
    let constructor = lowering.builder.builtin(BuiltinId::Error);
    let arguments = Arguments::Values(smallvec![message]);
    let error = call::emit_construct(lowering, constructor, None, arguments, CallSite::default());
    let name = lowering.file.intern_bytes(b"code");
    let name = PropertyName::Constant(lowering.file.text_key(name));
    let code = lowering.file.intern_bytes(code);
    let code = lowering.builder.string(code);
    member::emit_set(lowering, error, name, code);
    error
}

fn emit_computed_load(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    load: ComputedLoad,
    computed: ComputedSpecifier<'_>,
) -> ValueId {
    let specifier = computed.value;
    let spelled_modules = match computed.candidates {
        Candidates::All => &[][..],
        Candidates::Modules(spelled_modules) => spelled_modules,
    };
    let modules_of_every_value =
        find_modules_of_every_value(lowering.file, computed.node, spelled_modules);
    let spelled_modules = modules_of_every_value.as_deref().unwrap_or(spelled_modules);
    if spelled_modules.is_empty() {
        return emit_load_by_name(lowering, load, specifier);
    }
    let result = lowering.builder.create_variable(None);
    let mut strings: Vec<StringId> = Vec::with_capacity(spelled_modules.len());
    let mut arms: Vec<BlockId> = Vec::with_capacity(spelled_modules.len());
    for spelled in spelled_modules {
        strings.push(lowering.file.intern_atom(spelled.spelling));
        arms.push(lowering.create_block());
    }
    let otherwise = lowering.create_block();
    let done = lowering.create_block();
    let edges: Vec<Edge<'static>> = arms.iter().map(|&arm| Edge::to(arm)).collect();
    let spelled = match lowering
        .file
        .decisions()
        .is_path_from_own_directory(computed.node)
    {
        true => emit_path_from_own_directory(lowering, specifier),
        false => specifier,
    };
    lowering
        .builder
        .switch_string(spelled, &strings, &edges, Edge::to(otherwise));

    for ((spelled, &spelling), &arm) in spelled_modules.iter().zip(&strings).zip(&arms) {
        lowering.continue_in(arm);
        let loaded = match load {
            ComputedLoad::Require => emit_require_of_candidate(lowering, spelled.module, spelling),
            ComputedLoad::Import => {
                let modules = lowering.file.inputs.modules;
                let module = modules.face(spelled.module).unwrap_or(spelled.module);
                let module = lowering.file.fragment.declare_module(module);
                let referrer = lowering.file.module_id();
                lowering.builder.import_module(module, referrer)
            }
        };
        lowering.builder.write_variable(result, loaded);
        lowering.jump(done);
    }

    lowering.continue_in(otherwise);
    if modules_of_every_value.is_some() {
        lowering.builder.unreachable();
    } else {
        let loaded = emit_load_by_name(lowering, load, specifier);
        lowering.builder.write_variable(result, loaded);
        lowering.jump(done);
    }

    lowering.continue_in(done);
    lowering.builder.read_variable(result)
}

fn emit_load_by_name(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    load: ComputedLoad,
    specifier: ValueId,
) -> ValueId {
    let referrer = lowering.file.module_id();
    match load {
        ComputedLoad::Require => lowering.builder.require_dynamic(specifier, referrer),
        ComputedLoad::Import => lowering.builder.import_dynamic(specifier, None, referrer),
    }
}

fn emit_require_resolve(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: AnsweredSite<'_>,
    specifier: Option<ValueId>,
) -> ValueId {
    match site.answer {
        SiteAnswer::Module(module) => match find_name_answered_as_asked(lowering.file, site) {
            Some(name) => lowering.builder.string(name),
            None => emit_resolve_module(lowering, site.specifier, module, false),
        },
        SiteAnswer::Computed(_) => {
            let specifier = specifier.unwrap_or_else(|| lowering.builder.undefined());
            let referrer = lowering.file.module_id();
            lowering
                .builder
                .resolve_dynamic(specifier, referrer, false, false)
        }
        SiteAnswer::Failed(failure) => {
            emit_require_failure(lowering, site.specifier, failure, false)
        }
        SiteAnswer::Erased => lowering.builder.undefined(),
    }
}

fn find_name_answered_as_asked(
    file: &mut FileLowering<'_, '_, '_, '_>,
    site: AnsweredSite<'_>,
) -> Option<StringId> {
    let (ImportSpecifier::Constant(name), SiteAnswer::Module(ModuleRef::Runtime(_))) =
        (site.specifier, site.answer)
    else {
        return None;
    };
    let alias = Alias::get(file.queries.atom_bytes(name), Target::Bun, Cfg::default())?;
    alias.node_builtin.then(|| file.intern_atom(name))
}

fn emit_resolve_module(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    specifier: ImportSpecifier,
    module: ModuleRef,
    is_url: bool,
) -> ValueId {
    let ImportSpecifier::Constant(text) = specifier else {
        unreachable!("only a constant specifier names one module");
    };
    let module = lowering.file.fragment.declare_module(module);
    let referrer = lowering.file.module_id();
    let text = lowering.file.intern_atom(text);
    lowering
        .builder
        .resolve_module(module, referrer, text, is_url)
}

// The error of `require` and of `require.resolve` is worded by the host's resolver, which is told which of the two asks. It is another than that of `import`.
fn emit_require_failure(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    specifier: ImportSpecifier,
    failure: ModuleFailureId,
    is_for_require: bool,
) -> ValueId {
    match specifier {
        ImportSpecifier::Constant(text) => {
            let text = lowering.file.intern_atom(text);
            let specifier = lowering.builder.string(text);
            let referrer = lowering.file.module_id();
            lowering
                .builder
                .resolve_dynamic(specifier, referrer, false, is_for_require);
        }
        ImportSpecifier::Pattern { .. } | ImportSpecifier::Unknown => {}
    }
    emit_module_failure(lowering, failure)
}

pub(super) fn emit_module_failure(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    failure: ModuleFailureId,
) -> ValueId {
    let failure = lowering.file.fragment.declare_module_failure(failure);
    lowering.builder.throw_module_failure(failure);
    lowering.builder.unreachable();
    lowering.begin_unreachable_block();
    lowering.builder.undefined()
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

fn emit_resolved_import(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: BuiltinId,
) -> ValueId {
    let value = imports::emit_builtin_import(lowering, object, None);
    let resolve = lowering.builder.builtin(BuiltinId::PromiseResolve);
    let promise = lowering.builder.builtin(BuiltinId::Promise);
    let arguments = Arguments::Values(smallvec![value]);
    call::emit_call(
        lowering,
        resolve,
        Some(promise),
        arguments,
        CallSite::default(),
    )
}

fn emit_rejected_import(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    failure: ModuleFailureId,
) -> ValueId {
    let failure = lowering.file.fragment.declare_module_failure(failure);
    let handler = control::begin_handler(lowering, BlockRole::CatchHandler, None);
    lowering.builder.throw_module_failure(failure);
    lowering.builder.unreachable();
    lowering.begin_unreachable_block();
    control::end_handler(lowering, handler);

    lowering.continue_in(handler.block());
    let error = lowering.builder.catch_value();
    let reject = lowering.builder.builtin(BuiltinId::PromiseReject);
    let promise = lowering.builder.builtin(BuiltinId::Promise);
    let arguments = Arguments::Values(smallvec![error]);
    call::emit_call(
        lowering,
        reject,
        Some(promise),
        arguments,
        CallSite::default(),
    )
}

fn lower_site_arguments(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    answer: SiteAnswer<'_>,
    arguments: IdList<ExprId>,
) -> Option<ValueId> {
    let hir = lowering.file.hir;
    let first = (arguments.len() > 0).then(|| hir.id_at(arguments, 0));
    let specifier = lower_computed_specifier(lowering, answer, first);
    lower_arguments_for_effect(lowering, arguments, 1);
    lowering.set_position(hir[call].pos);
    specifier
}

fn lower_computed_specifier(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    answer: SiteAnswer<'_>,
    specifier: Option<ExprId>,
) -> Option<ValueId> {
    match answer {
        SiteAnswer::Computed(_) => {
            specifier.map(|argument| expression::lower_expression(lowering, argument))
        }
        SiteAnswer::Module(_) | SiteAnswer::Failed(_) | SiteAnswer::Erased => {
            let argument = specifier?;
            if lowering.file.decisions().is_path_made_by_call(argument) {
                return Some(expression::lower_expression(lowering, argument));
            }
            expression::lower_expression_for_effect(lowering, argument);
            None
        }
    }
}

fn lower_arguments_for_effect(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    arguments: IdList<ExprId>,
    start: usize,
) {
    let hir = lowering.file.hir;
    for index in start..arguments.len() {
        expression::lower_expression_for_effect(lowering, hir.id_at(arguments, index));
    }
}

fn has_spread_argument(hir: &hir::File<'_>, arguments: IdList<ExprId>) -> bool {
    (0..arguments.len())
        .any(|index| matches!(hir[hir.id_at(arguments, index)].kind, ExprKind::Spread(_)))
}
