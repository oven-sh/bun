use super::{
    BindInput, ExportBinding, ImportPhase, ModuleExport, ModuleGraph, ModuleRef, ModuleRequest,
    bind_modules,
};
use crate::compile::testing::{default_settings, with_bind_input, with_runtime_bind_input};
use crate::ir::generated::ModuleRequestKind;
use bstr::BStr;
use bun_sema::atom::Atom;
use bun_sema::program::FileId;

const PROJECT_ROOT: &[u8] = b"/project/";

pub(crate) fn with_graph<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(&ModuleGraph, &BindInput<'_, '_>) -> R,
) -> R {
    with_bind_input(files, &default_settings(), |input| {
        then(&bind_modules(input).graph, input)
    })
}

pub(crate) fn with_runtime_graph<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(&ModuleGraph, &BindInput<'_, '_>) -> R,
) -> R {
    with_runtime_bind_input(files, |input| then(&bind_modules(input).graph, input))
}

pub(crate) fn file_named(input: &BindInput<'_, '_>, name: &str) -> FileId {
    let by_path = &input.files.by_path;
    let project_file = by_path.get(&[PROJECT_ROOT, name.as_bytes()].concat());
    let file = project_file.or_else(|| by_path.get(name.as_bytes()));
    file.expect("the program has no file with this name")
}

pub(crate) fn describe_module(
    graph: &ModuleGraph,
    input: &BindInput<'_, '_>,
    name: &str,
) -> String {
    let file = file_named(input, name);
    let interop = graph.interop(ModuleRef::File(file));
    let (kind, rule, result) = (interop.kind, interop.export_rule, interop.require_result);
    let mut lines = vec![format!("kind {kind:?} {rule:?} {result:?}")];
    if graph.has_top_level_await(file) {
        lines.push(String::from("await"));
    }
    if graph.has_dynamic_names(file) {
        lines.push(String::from("dynamic"));
    }
    for &request in graph.requests(file) {
        lines.push(describe_request(input, request));
    }
    for export in graph.exports(file) {
        lines.push(describe_export(graph, input, export));
    }
    for required in graph.required_names(file) {
        let module = describe_module_ref(input, required.module);
        let name = atom_text(input, required.name);
        let suffix = if required.may_be_absent {
            " may-be-absent"
        } else {
            ""
        };
        lines.push(format!("required {module} {name}{suffix}"));
    }
    let mut text = lines.join("\n");
    text.push('\n');
    text
}

fn describe_request(input: &BindInput<'_, '_>, request: ModuleRequest) -> String {
    let target = describe_module_ref(input, request.target);
    let mut line = format!("request {target}");
    match request.kind {
        ModuleRequestKind::Import => {}
        ModuleRequestKind::Require => line.push_str(" require"),
    }
    if !request.completes {
        line.push_str(" may-be-half-done");
    }
    match request.phase {
        ImportPhase::Evaluation => {}
        ImportPhase::Defer => line.push_str(" defer"),
    }
    if request.is_dynamic_star_export {
        line.push_str(" dynamic-star");
    }
    line
}

fn describe_export(
    graph: &ModuleGraph,
    input: &BindInput<'_, '_>,
    export: &ModuleExport,
) -> String {
    let name = atom_text(input, export.name);
    let binding = describe_binding(graph, input, export.binding);
    let mut line = format!("export {name} = {binding}");
    if export.is_from_star_export {
        line.push_str(" star");
    }
    if export.can_be_ambiguous {
        line.push_str(" can-be-ambiguous");
    }
    line
}

fn describe_binding(
    graph: &ModuleGraph,
    input: &BindInput<'_, '_>,
    binding: ExportBinding,
) -> String {
    match binding {
        ExportBinding::Variable(symbol) => {
            let path = project_path(input, symbol.file);
            let name = atom_text(input, input.files.symbol(symbol).name);
            format!("{path}#{name}")
        }
        ExportBinding::Synthetic(id) => {
            let export = graph.synthetic_export(id);
            let module = describe_module_ref(input, export.module);
            let name = atom_text(input, export.name);
            format!("synthetic {module} {name}")
        }
        ExportBinding::Namespace { module, phase } => {
            let module = describe_module_ref(input, module);
            match phase {
                ImportPhase::Evaluation => format!("namespace {module}"),
                ImportPhase::Defer => format!("namespace {module} defer"),
            }
        }
        ExportBinding::Indirect { module, name } => {
            let module = describe_module_ref(input, module);
            let name = atom_text(input, name);
            format!("indirect {module} {name}")
        }
    }
}

pub(crate) fn describe_module_ref(input: &BindInput<'_, '_>, module: ModuleRef) -> String {
    match module {
        ModuleRef::File(file) => project_path(input, file).to_string(),
        ModuleRef::Inner { file, callback } => {
            format!("{}#{}", project_path(input, file), callback.0)
        }
        ModuleRef::Face(file) => format!("face:{}", project_path(input, file)),
        ModuleRef::Check(file) => format!("check:{}", project_path(input, file)),
        ModuleRef::Runtime(module) => format!("runtime:{module:?}"),
        ModuleRef::External { specifier, .. } => {
            let specifier = atom_text(input, specifier);
            format!("external:{specifier}")
        }
    }
}

fn project_path<'s>(input: &BindInput<'_, 's>, file: FileId) -> &'s BStr {
    let path = input.files.module(file).file_name();
    BStr::new(path.strip_prefix(PROJECT_ROOT).unwrap_or(path))
}

fn atom_text<'a>(input: &BindInput<'a, '_>, atom: Atom) -> &'a BStr {
    BStr::new(input.files.atoms.bytes(atom))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtins::RuntimeModule;

    const ES_MODULE: &str = "kind SourceText None Namespace\n";

    #[test]
    fn describes_requests_and_exports() {
        let files = [
            (
                "main.ts",
                "import { a } from './a';\n\
                 export * from './legacy.cjs';\n\
                 export * as all from './a';\n\
                 export { named } from './legacy.cjs';\n\
                 export const own = a;\n",
            ),
            ("a.ts", "export const a = 1;\n"),
            ("legacy.cjs", "exports.named = 1;\n"),
        ];
        with_graph(&files, |graph, input| {
            assert_eq!(
                describe_module(graph, input, "main.ts"),
                "kind SourceText None Namespace\n\
                 dynamic\n\
                 request a.ts\n\
                 request legacy.cjs dynamic-star\n\
                 export all = namespace a.ts\n\
                 export named = synthetic legacy.cjs named\n\
                 export own = main.ts#own\n"
            );
            assert_eq!(
                describe_module(graph, input, "a.ts"),
                format!("{ES_MODULE}export a = a.ts#a\n")
            );
            assert_eq!(
                describe_module(graph, input, "legacy.cjs"),
                "kind CommonJs CommonJs ModuleExports\ndynamic\n"
            );
        });
    }

    #[test]
    fn describes_await_and_required_name() {
        let files = [
            ("main.js", "import { x } from './barrel.js';\nawait x;\n"),
            (
                "barrel.js",
                "export * from './one.cjs';\nexport * from './two.cjs';\n",
            ),
            ("one.cjs", "exports.x = 1;\n"),
            ("two.cjs", "exports.x = 2;\n"),
        ];
        with_graph(&files, |graph, input| {
            assert_eq!(
                describe_module(graph, input, "main.js"),
                "kind SourceText None Namespace\n\
                 await\n\
                 request barrel.js\n\
                 required barrel.js x\n"
            );
            assert_eq!(
                describe_module(graph, input, "barrel.js"),
                "kind SourceText None Namespace\n\
                 dynamic\n\
                 request one.cjs dynamic-star\n\
                 request two.cjs dynamic-star\n"
            );
        });
    }

    #[test]
    fn describes_star_exports() {
        let files = [
            (
                "main.js",
                "export * from './es.js';\nexport * from './one.cjs';\n",
            ),
            (
                "es.js",
                "export * from './inner.js';\nexport const x = 1;\n",
            ),
            ("inner.js", "export const y = 1;\n"),
            ("one.cjs", "exports.x = 1;\n"),
        ];
        with_graph(&files, |graph, input| {
            assert_eq!(
                describe_module(graph, input, "main.js"),
                "kind SourceText None Namespace\n\
                 dynamic\n\
                 request es.js\n\
                 request one.cjs dynamic-star\n\
                 export x = es.js#x star can-be-ambiguous\n\
                 export y = inner.js#y star can-be-ambiguous\n"
            );
            assert_eq!(
                describe_module(graph, input, "es.js"),
                format!(
                    "{ES_MODULE}request inner.js\n\
                     export x = es.js#x\nexport y = inner.js#y star\n"
                )
            );
        });
    }

    #[test]
    fn describes_deferred_namespace_export() {
        let files = [
            (
                "main.js",
                "import defer * as later from './later.js';\nexport { later };\n",
            ),
            ("later.js", "export {};\n"),
        ];
        with_graph(&files, |graph, input| {
            assert_eq!(
                describe_module(graph, input, "main.js"),
                format!(
                    "{ES_MODULE}request later.js defer\n\
                     export later = namespace later.js defer\n"
                )
            );
        });
    }

    #[test]
    fn describes_deferred_request() {
        let files = [
            (
                "main.js",
                "import defer * as later from './later.js';\nconsole.log(later);\n",
            ),
            ("later.js", "export {};\n"),
        ];
        with_graph(&files, |graph, input| {
            assert_eq!(
                describe_module(graph, input, "main.js"),
                format!("{ES_MODULE}request later.js defer\n")
            );
        });
    }

    #[test]
    fn describes_indirect_export() {
        with_graph(&[("main.js", "export {};\n")], |graph, input| {
            let binding = ExportBinding::Indirect {
                module: ModuleRef::External {
                    importer: file_named(input, "main.js"),
                    specifier: input.files.atoms.intern(b"left-pad"),
                },
                name: input.files.atoms.intern(b"pad"),
            };
            assert_eq!(
                describe_binding(graph, input, binding),
                "indirect external:left-pad pad"
            );
        });
    }

    #[test]
    fn describes_each_module_variant() {
        let files = [
            ("main.js", "import './directory/other.js';\n"),
            ("directory/other.js", "export {};\n"),
        ];
        with_graph(&files, |_, input| {
            let other = file_named(input, "directory/other.js");
            let external = ModuleRef::External {
                importer: other,
                specifier: input.files.atoms.intern(b"left-pad"),
            };
            let runtime = ModuleRef::Runtime(RuntimeModule::NodeFs);
            let file = ModuleRef::File(other);
            assert_eq!(describe_module_ref(input, file), "directory/other.js");
            assert_eq!(describe_module_ref(input, runtime), "runtime:NodeFs");
            assert_eq!(describe_module_ref(input, external), "external:left-pad");
        });
    }

    #[test]
    fn describes_runtime_source_by_full_path() {
        with_runtime_graph(&[("main.js", "import 'node:path';\n")], |graph, input| {
            assert_eq!(
                describe_module(graph, input, "/$bun/js/node/path.ts"),
                "kind RuntimeSource RuntimeModule DefaultExport\ndynamic\n"
            );
        });
    }

    #[test]
    #[should_panic(expected = "the program has no file with this name")]
    fn file_named_panics_for_unknown_name() {
        with_graph(&[("main.js", "export {};\n")], |_, input| {
            file_named(input, "other.js");
        });
    }
}
