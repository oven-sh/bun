use bun_sema::atom::Atom;
use bun_sema::bind::Parent;
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{Branches, ExprId, ExprKind};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier, is_made_require};
use bun_sema::resolve::FinishedFile;
use bun_sema::util::SharedSort;

use crate::builtins::{BuiltinId, ResolvedBuiltins, RuntimeModule};
use crate::load::runtime_modules::{RuntimeModules, RuntimeResolution};

// `module` is what `name` stands for, and `name` is one of the values of `argument`, the first argument of a load.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct NamedModule {
    pub argument: ExprId,
    pub name: Atom,
    pub module: RuntimeModule,
}

pub(crate) fn modules_named_in(named: &[NamedModule], argument: ExprId) -> &[NamedModule] {
    let first = named.partition_point(|it| it.argument < argument);
    let count = named[first..].partition_point(|it| it.argument == argument);
    &named[first..first + count]
}

struct Scan<'a, 's> {
    request: &'a FinishedFile<'a, 's>,
    runtime_modules: &'a RuntimeModules,
    named: Vec<NamedModule>,
}

// The library modules that the arms of `require(flag ? "node:vm" : "node:v8")` name.
pub(crate) fn find_library_modules_named_in_choices(
    request: &FinishedFile<'_, '_>,
    builtins: &ResolvedBuiltins,
    runtime_modules: &RuntimeModules,
) -> Vec<NamedModule> {
    let mut scan = Scan {
        request,
        runtime_modules,
        named: Vec::new(),
    };
    scan.visit_import_sites();
    scan.visit_calls_of_other_loaders(builtins);
    scan.named.shared_sort_unstable_by_key(|it| (it.argument, it.name.0));
    scan.named.dedup();
    scan.named
}

impl Scan<'_, '_> {
    fn visit_import_sites(&mut self) {
        for site in self.request.analysis.import_sites {
            let loads = match site.kind {
                ImportSiteKind::ImportCall(_)
                | ImportSiteKind::Require(_)
                | ImportSiteKind::ImportMetaRequire(_) => true,
                ImportSiteKind::JsxRuntime
                | ImportSiteKind::JsxPackage
                | ImportSiteKind::Import(_)
                | ImportSiteKind::ExportFrom(_)
                | ImportSiteKind::ExportStar(_)
                | ImportSiteKind::ImportEquals(_)
                | ImportSiteKind::RequireResolve(_)
                | ImportSiteKind::ImportMetaResolve(_)
                | ImportSiteKind::GetBuiltinModule(_) => false,
            };
            let is_one_name = match site.specifier {
                ImportSpecifier::Constant(_) => true,
                ImportSpecifier::Pattern { .. } | ImportSpecifier::Unknown => false,
            };
            if loads && !is_one_name && site.specifier_node.is_some() {
                self.add_names_in(site.specifier_node);
            }
        }
    }

    // A call of process.getBuiltinModule with a name that is no constant is no import site.
    fn visit_calls_of_other_loaders(&mut self, builtins: &ResolvedBuiltins) {
        let &FinishedFile {
            hir,
            bound,
            analysis,
            ..
        } = self.request;
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            let ExprKind::Call(call) = hir[expression].kind else {
                continue;
            };
            let callee = hir.skip_type_assertions(hir[call].callee);
            let is_evaluated = bound.parent_of_expr(expression) != Parent::None
                && !analysis.decisions.is_dead_expr(expression);
            if !is_evaluated || analysis.import_site_of_call(expression).is_some() {
                continue;
            }
            let is_loader = builtins.builtin_of_expression(callee) == Some(BuiltinId::ProcessGetBuiltinModule)
                || is_made_require(hir, bound, callee);
            if !is_loader {
                continue;
            }
            if let Some(argument) = hir.ids(hir[call].args).next() {
                self.add_names_in(argument);
            }
        }
    }

    fn add_names_in(&mut self, argument: ExprId) {
        let (hir, decisions) = (self.request.hir, &self.request.analysis.decisions);
        let mut pending = vec![argument];
        while let Some(expression) = pending.pop() {
            let expression = hir.skip_type_assertions(expression);
            if decisions.is_dead_expr(expression) {
                continue;
            }
            match decisions.constant(hir, expression) {
                FoldedValue::Constant(Constant::String(name))
                | FoldedValue::ConstantOutsideDeadZone(Constant::String(name)) => {
                    self.add_name(argument, name);
                }
                FoldedValue::Constant(_) | FoldedValue::ConstantOutsideDeadZone(_) => {}
                FoldedValue::Unknown => {
                    if let ExprKind::Cond { branches, .. } = hir[expression].kind {
                        let Branches { yes, no } = hir.branches(branches);
                        pending.extend([yes, no]);
                    }
                }
            }
        }
    }

    fn add_name(&mut self, argument: ExprId, name: Atom) {
        let text = self.request.atoms.bytes(name);
        let module = match self.runtime_modules.resolve_module(text, b"") {
            Some(RuntimeResolution::Module(module)) => RuntimeModule::from_registry_id(module.0),
            Some(RuntimeResolution::HostValue) | None => None,
        };
        self.named.extend(module.map(|module| NamedModule {
            argument,
            name,
            module,
        }));
    }
}

#[cfg(test)]
mod tests {
    use bun_builtin_sources::Archive;

    use crate::builtins::RuntimeModule;
    use crate::compile::testing::{default_settings, with_bind_input};
    use crate::load::runtime_modules::RuntimeModules;
    use crate::load::runtime_roots::collect_runtime_roots;

    fn host_loaded_modules(source: &str) -> Vec<RuntimeModule> {
        let runtime_modules = RuntimeModules::new(Archive::embedded(), false);
        with_bind_input(&[("main.ts", source)], &default_settings(), |input| {
            collect_runtime_roots(input.files, &runtime_modules, input.platform).host_loaded_modules
        })
    }

    #[track_caller]
    fn assert_keeps(source: &str, kept: &[RuntimeModule], dropped: &[RuntimeModule]) {
        let modules = host_loaded_modules(source);
        for module in kept {
            assert!(modules.contains(module), "{module:?} is missing: {source}");
        }
        for module in dropped {
            assert!(!modules.contains(module), "{module:?} is kept: {source}");
        }
    }

    const FLAG: &str = "declare const flag: boolean; declare const name: string;\n";

    #[test]
    fn each_arm_of_a_choice_is_kept() {
        use RuntimeModule::{NodeDgram, NodeHttp2, NodeRepl, NodeV8, NodeVm, NodeZlib};
        for load in ["require", "import", "import.meta.require", "process.getBuiltinModule"] {
            let source = format!("{FLAG}export const loaded = {load}(flag ? 'node:vm' : 'node:v8');");
            assert_keeps(&source, &[NodeVm, NodeV8], &[NodeDgram]);
        }
        let nested = format!("{FLAG}require(flag ? 'node:dgram' : name ? 'zlib' : ('node:http2' as string));");
        assert_keeps(&nested, &[NodeDgram, NodeZlib, NodeHttp2], &[NodeRepl]);
    }

    #[test]
    fn choice_given_to_made_require_is_kept() {
        let source = format!(
            "{FLAG}import {{ createRequire }} from 'node:module';
const load = createRequire(import.meta.url);
load(flag ? 'node:vm' : 'node:v8');"
        );
        assert_keeps(&source, &[RuntimeModule::NodeVm, RuntimeModule::NodeV8], &[RuntimeModule::NodeDgram]);
    }

    #[test]
    fn library_module_named_to_require_made_for_another_file_is_kept() {
        let source = "import { createRequire } from 'module';
var require = createRequire('/');
export const tty = require('tty');
export const os = createRequire('/elsewhere/')('node:os');";
        assert_keeps(source, &[RuntimeModule::NodeTty, RuntimeModule::NodeOs], &[RuntimeModule::NodeDgram]);
    }

    #[test]
    fn constant_arm_beside_unknown_arm_is_kept() {
        let source = format!("{FLAG}require(flag ? 'node:vm' : name);");
        assert_keeps(&source, &[RuntimeModule::NodeVm], &[RuntimeModule::NodeV8]);
    }

    #[test]
    fn name_with_constant_start_keeps_nothing() {
        let source = format!("{FLAG}require('node:v' + name); require(`node:${{name}}`); require(name);");
        assert_keeps(&source, &[], &[RuntimeModule::NodeVm, RuntimeModule::NodeV8]);
    }

    #[test]
    fn choice_that_only_names_a_module_keeps_nothing() {
        let source = format!("{FLAG}require.resolve(flag ? 'node:vm' : 'node:v8');");
        assert_keeps(&source, &[], &[RuntimeModule::NodeVm, RuntimeModule::NodeV8]);
    }

    #[test]
    fn choice_in_dead_code_keeps_nothing() {
        let source = format!("{FLAG}if (false) require(flag ? 'node:vm' : 'node:v8');");
        assert_keeps(&source, &[], &[RuntimeModule::NodeVm, RuntimeModule::NodeV8]);
    }
}
