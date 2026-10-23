use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Decl, Parent, SymbolId};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{Branches, ExprId, ExprKind};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier};
use bun_sema::program::{CodeAnswer, FileId, Files};
use bun_sema::resolve::FinishedFile;
use bun_sema::util::SharedSort;
use smallvec::{SmallVec, smallvec};

use crate::builtins::{BuiltinId, ResolvedBuiltins, RuntimeModule};
use crate::load::loader_aliases::{
    LoaderAlias, resolve_exported_loader_alias, resolve_loader_alias,
};
use crate::load::runtime_modules::{RuntimeModules, RuntimeResolution};
use crate::load::sources::parsed_source;

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

#[derive(Default)]
pub(crate) struct NamedLoads {
    pub modules: Vec<NamedModule>,
    pub passed_to_imports: Vec<(SymbolId, NamedModule)>,
}

struct Scan<'a, 's> {
    request: &'a FinishedFile<'a, 's>,
    runtime_modules: &'a RuntimeModules,
    named: Vec<NamedModule>,
    passed_to_imports: Vec<(SymbolId, NamedModule)>,
}

// The library modules that the arms of `require(flag ? "node:vm" : "node:v8")` name.
pub(crate) fn find_library_modules_named_in_choices(
    request: &FinishedFile<'_, '_>,
    builtins: &ResolvedBuiltins,
    runtime_modules: &RuntimeModules,
) -> NamedLoads {
    let mut scan = Scan {
        request,
        runtime_modules,
        named: Vec::new(),
        passed_to_imports: Vec::new(),
    };
    scan.visit_import_sites();
    scan.visit_calls_of_other_loaders(builtins);
    sort_named_modules(&mut scan.named);
    NamedLoads {
        modules: scan.named,
        passed_to_imports: scan.passed_to_imports,
    }
}

fn sort_named_modules(named: &mut Vec<NamedModule>) {
    named.shared_sort_unstable_by_key(|it| (it.argument, it.name.0));
    named.dedup();
}

const MAX_REEXPORTS: usize = 8;

fn imports_loader(files: &Files<'_>, mut file: FileId, mut symbol: SymbolId) -> bool {
    for _ in 0..MAX_REEXPORTS {
        let (hir, bound) = (files.hir(file), files.bound(file));
        let import = bound
            .symbol(symbol)
            .decls
            .iter()
            .find_map(|&declaration| match declaration {
                Decl::ImportSpec(specifier) => {
                    let specifier = hir[specifier];
                    (!specifier.type_only).then_some((specifier.import, specifier.imported))
                }
                Decl::ImportDefault(import) => Some((import, known::default)),
                _ => None,
            });
        let Some((import, export_name)) = import else {
            return false;
        };
        let site = files
            .analysis(file)
            .import_site_index(ImportSiteKind::Import(import));
        let answer = site.and_then(|site| files.compiled(file)?.code_answers.get(site));
        let Some(&CodeAnswer::File(exporter)) = answer else {
            return false;
        };
        if files.compiled(exporter).is_none() {
            return false;
        }
        let decisions = &files.analysis(exporter).decisions;
        let (hir, bound) = (files.hir(exporter), files.bound(exporter));
        match resolve_exported_loader_alias(hir, bound, decisions, export_name) {
            Some(LoaderAlias::Local) => return true,
            Some(LoaderAlias::Import(next)) => (file, symbol) = (exporter, next),
            None => return false,
        }
    }
    false
}

// esbuild exports `__require` from a shared chunk, so whether `__require("node:fs")` loads a module is only known once the exporting file is loaded.
pub(crate) fn resolve_loads_through_imported_loaders(application: &Files<'_>) {
    for &file in application.compiled_files() {
        let Some(source) = parsed_source(application, file) else {
            continue;
        };
        let mut loaders: Vec<(SymbolId, bool)> = Vec::new();
        let mut named = Vec::new();
        for &(callee, module) in &source.library_names_passed_to_imports {
            let is_loader = match loaders.iter().find(|known| known.0 == callee) {
                Some(known) => known.1,
                None => {
                    let is_loader = imports_loader(application, file, callee);
                    loaders.push((callee, is_loader));
                    is_loader
                }
            };
            if is_loader {
                named.push(module);
            }
        }
        if !named.is_empty() {
            named.extend_from_slice(&source.modules_named_in_choices);
            sort_named_modules(&mut named);
            source.set_named_modules(named);
        }
    }
}

impl Scan<'_, '_> {
    fn visit_import_sites(&mut self) {
        for site in self.request.analysis.import_sites {
            let loads = match site.kind {
                ImportSiteKind::ImportCall(_)
                | ImportSiteKind::Require(_)
                | ImportSiteKind::ImportMetaRequire(_) => true,
                _ => false,
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
            let Some(argument) = hir.ids(hir[call].args).next() else {
                continue;
            };
            if builtins.builtin_of_expression(callee) == Some(BuiltinId::ProcessGetBuiltinModule) {
                self.add_names_in(argument);
                continue;
            }
            match resolve_loader_alias(hir, bound, &analysis.decisions, callee) {
                Some(LoaderAlias::Local) => self.add_names_in(argument),
                Some(LoaderAlias::Import(symbol)) => {
                    let first_new = self.named.len();
                    self.add_names_in(argument);
                    let named = self.named.drain(first_new..);
                    self.passed_to_imports
                        .extend(named.map(|module| (symbol, module)));
                }
                None => {}
            }
        }
    }

    fn add_names_in(&mut self, argument: ExprId) {
        let (hir, decisions) = (self.request.hir, &self.request.analysis.decisions);
        let mut pending: SmallVec<[ExprId; 4]> = smallvec![argument];
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

    fn root_modules(files: &[(&str, &str)]) -> Vec<RuntimeModule> {
        let runtime_modules = RuntimeModules::new(Archive::embedded(), false);
        with_bind_input(files, &default_settings(), |input| {
            let roots = collect_runtime_roots(input.files, &runtime_modules, input.platform);
            let is_root = |module: &RuntimeModule| {
                let path = runtime_modules.module_path(*module);
                path.is_some_and(|path| roots.paths.iter().any(|root| root == path))
            };
            RuntimeModule::ALL.into_iter().filter(is_root).collect()
        })
    }

    #[track_caller]
    fn assert_files_keep(
        files: &[(&str, &str)],
        kept: &[RuntimeModule],
        dropped: &[RuntimeModule],
    ) {
        let modules = root_modules(files);
        for module in kept {
            assert!(modules.contains(module), "{module:?} is missing: {files:?}");
        }
        for module in dropped {
            assert!(!modules.contains(module), "{module:?} is kept: {files:?}");
        }
    }

    #[track_caller]
    fn assert_keeps(source: &str, kept: &[RuntimeModule], dropped: &[RuntimeModule]) {
        assert_files_keep(&[("main.ts", source)], kept, dropped);
    }

    const ESBUILD_REQUIRE: &str = r#"((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
})"#;

    #[test]
    fn esbuild_require_shim_keeps_named_modules() {
        use RuntimeModule::{NodeDgram, NodeRepl, NodeZlib};
        let source = format!(
            "var __require = {ESBUILD_REQUIRE};\n__require('zlib'); __require('node:dgram');"
        );
        assert_files_keep(
            &[("main.mjs", &source)],
            &[NodeZlib, NodeDgram],
            &[NodeRepl],
        );
        let minified = "var t=(a=>typeof require<\"u\"?require:typeof Proxy<\"u\"?new Proxy(a,{get:(b,c)=>(typeof require<\"u\"?require:b)[c]}):a)(function(a){if(typeof require<\"u\")return require.apply(this,arguments);throw Error('no '+a)});t('zlib');";
        assert_files_keep(&[("main.mjs", minified)], &[NodeZlib], &[NodeDgram]);
    }

    #[test]
    fn iife_that_returns_a_loader_keeps_named_modules() {
        use RuntimeModule::{NodeDgram, NodeRepl, NodeV8, NodeVm, NodeZlib};
        let source = "import { createRequire } from 'node:module';
const a = (() => require)();
const b = (function () { return import.meta.require; })();
const c = (() => createRequire('/elsewhere/'))();
const d = a;
a('zlib'); b('dgram'); c('vm'); d('v8');";
        assert_files_keep(
            &[("main.mjs", source)],
            &[NodeZlib, NodeDgram, NodeVm, NodeV8],
            &[NodeRepl],
        );
    }

    #[test]
    fn callee_that_may_not_be_a_loader_keeps_nothing() {
        use RuntimeModule::{NodeDgram, NodeRepl, NodeV8, NodeVm, NodeZlib};
        let source = format!(
            "{FLAG}let reassigned = (() => require)(); reassigned = String;
const chosen = flag ? require : String;
const parameter = ((load: unknown) => load)(require) as (name: string) => unknown;
const asynchronous = (async () => require)() as unknown as (name: string) => unknown;
const longer = (() => {{ if (flag) return String; return require; }})();
reassigned('zlib'); chosen('dgram'); parameter('vm'); asynchronous('v8'); longer('repl');"
        );
        assert_keeps(
            &source,
            &[],
            &[NodeZlib, NodeDgram, NodeVm, NodeV8, NodeRepl],
        );
    }

    #[test]
    fn loader_imported_from_another_file_keeps_named_modules() {
        use RuntimeModule::{NodeDgram, NodeRepl, NodeV8, NodeVm, NodeZlib};
        let chunk = format!(
            "import {{ createRequire }} from 'node:module';
var __require = {ESBUILD_REQUIRE};
export var made = createRequire(import.meta.url);
export {{ __require as a }};"
        );
        let files = [
            (
                "main.mjs",
                "import { a as load, made } from './chunk.mjs';
import { again } from './barrel.mjs';
load('zlib'); made('node:dgram'); again(globalThis.flag ? 'vm' : 'v8');",
            ),
            ("chunk.mjs", &chunk),
            (
                "barrel.mjs",
                "import { a } from './chunk.mjs';\nexport { a as again };",
            ),
        ];
        assert_files_keep(&files, &[NodeZlib, NodeDgram, NodeVm, NodeV8], &[NodeRepl]);
    }

    #[test]
    fn imported_function_that_is_no_loader_keeps_nothing() {
        use RuntimeModule::{NodeDgram, NodeRepl, NodeZlib};
        let files = [
            (
                "main.mjs",
                "import { log, swapped } from './log.mjs';
import other from './log.mjs';
log('zlib'); swapped('dgram'); other('repl');",
            ),
            (
                "log.mjs",
                "export function log(text) { console.log(text); }
export let swapped = require;
export function swap() { swapped = log; }
export default log;",
            ),
        ];
        assert_files_keep(&files, &[], &[NodeZlib, NodeDgram, NodeRepl]);
    }

    const FLAG: &str = "declare const flag: boolean; declare const name: string;\n";

    #[test]
    fn each_arm_of_a_choice_is_kept() {
        use RuntimeModule::{NodeDgram, NodeHttp2, NodeRepl, NodeV8, NodeVm, NodeZlib};
        for load in [
            "require",
            "import",
            "import.meta.require",
            "process.getBuiltinModule",
        ] {
            let source =
                format!("{FLAG}export const loaded = {load}(flag ? 'node:vm' : 'node:v8');");
            assert_keeps(&source, &[NodeVm, NodeV8], &[NodeDgram]);
        }
        let nested = format!(
            "{FLAG}require(flag ? 'node:dgram' : name ? 'zlib' : ('node:http2' as string));"
        );
        assert_keeps(&nested, &[NodeDgram, NodeZlib, NodeHttp2], &[NodeRepl]);
    }

    #[test]
    fn choice_given_to_made_require_is_kept() {
        let source = format!(
            "{FLAG}import {{ createRequire }} from 'node:module';
const load = createRequire(import.meta.url);
load(flag ? 'node:vm' : 'node:v8');"
        );
        assert_keeps(
            &source,
            &[RuntimeModule::NodeVm, RuntimeModule::NodeV8],
            &[RuntimeModule::NodeDgram],
        );
    }

    #[test]
    fn library_module_named_to_require_made_for_another_file_is_kept() {
        let source = "import { createRequire } from 'module';
var require = createRequire('/');
export const tty = require('tty');
export const os = createRequire('/elsewhere/')('node:os');";
        assert_keeps(
            source,
            &[RuntimeModule::NodeTty, RuntimeModule::NodeOs],
            &[RuntimeModule::NodeDgram],
        );
    }

    #[test]
    fn constant_arm_beside_unknown_arm_is_kept() {
        let source = format!("{FLAG}require(flag ? 'node:vm' : name);");
        assert_keeps(&source, &[RuntimeModule::NodeVm], &[RuntimeModule::NodeV8]);
    }

    #[test]
    fn name_with_constant_start_keeps_nothing() {
        let source =
            format!("{FLAG}require('node:v' + name); require(`node:${{name}}`); require(name);");
        assert_keeps(
            &source,
            &[],
            &[RuntimeModule::NodeVm, RuntimeModule::NodeV8],
        );
    }

    #[test]
    fn choice_that_only_names_a_module_keeps_nothing() {
        let source = format!("{FLAG}require.resolve(flag ? 'node:vm' : 'node:v8');");
        assert_keeps(
            &source,
            &[],
            &[RuntimeModule::NodeVm, RuntimeModule::NodeV8],
        );
    }

    #[test]
    fn choice_in_dead_code_keeps_nothing() {
        let source = format!("{FLAG}if (false) require(flag ? 'node:vm' : 'node:v8');");
        assert_keeps(
            &source,
            &[],
            &[RuntimeModule::NodeVm, RuntimeModule::NodeV8],
        );
    }
}
