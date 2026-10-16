use crate::import_export_map::{ExportMap, ExportMaps};
use crate::module_visitor::static_require;
use bun_lint_oxlint::import::ImportImportName;
use bun_lint_oxlint::module_record::{
    ExportImportName, Loaded, ModuleRecord, StarExports, debug, get_loaded_module, is_waiting_for_modules,
};
use bun_lint::paths;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;

/// Ensure named imports correspond to a named export in the remote file.
pub struct Named {
    commonjs: bool,
}

const NOT_FOUND: Message = Message::new("", "{{name}} not found in '{{source}}'");
const NOT_FOUND_VIA: Message = Message::new("", "{{name}} not found via {{deepPath}}");
const OXLINT: Message = Message::new("", "named import {{imported_name}} not found");

#[derive(Default)]
pub struct State<'a> {
    /// `None`: oxlint, which asks its records.
    maps: Option<ExportMaps<'a>>,
    /// The specifier that was asked for last, and `ExportMapBuilder.get` of it unless that is ambiguous.
    last: Option<(Name<'a>, Option<ExportMap<'a>>)>,
    star_exports: StarExports<'a>,
}

/// How a name of another module is named.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Taken {
    Imported,
    ExportedAgain,
}

impl Rule for Named {
    const META: Meta = Meta::plugin(Plugin::Import, "named", Kind::Problem).needs_modules();
    const ON: On = On::new().var_decls().import_specs().export_specs().finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        Named { commonjs: options.object(0).bool_or("commonjs", false) }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().import_specs().export_specs();
        match file.language().is_oxlint {
            // oxlint has no option, and takes an `export { a }` of what is imported for an `export { a } from "m"`.
            true => on.finish(),
            false if self.commonjs && file.mentions("require") => on.var_decls(),
            false => on,
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        if !file.language().is_oxlint {
            return Some(State { maps: Some(ExportMaps::of(file)?), ..State::default() });
        }
        // Before anything else: others ask what this file exports.
        if is_waiting_for_modules(file) || file.modules().is_none() || !file.is_javascript() {
            return None;
        }
        Some(State::default())
    }

    /// upstream's `checkRequire`
    fn var_decl<'a>(&self, node: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let (PatKind::Object(variable_imports), Some(call)) = (node.pat().kind(), node.init()) else {
            return;
        };
        // `require?.("a")` is a `ChainExpression`.
        let Some(source) = call.as_call().filter(|_| !call.is_chain_root()).and_then(static_require) else {
            return;
        };
        let Some(source) = source.as_string() else {
            return;
        };
        for key in variable_imports.iter().filter_map(PatProp::key) {
            match key.kind() {
                KeyKind::Ident(name) => check(name, key.inner_span(cx.file()), source, Taken::Imported, cx),
                // It does not ask whether the key is computed.
                KeyKind::Computed(e) => {
                    if let Some(name) = e.as_ident() {
                        check(name, e.span(), source, Taken::Imported, cx);
                    }
                }
                _ => {}
            }
        }
    }

    fn import_spec<'a>(&self, im: ImportSpec<'a>, cx: &mut Cx<'a, Self>) {
        // oxlint looks at JavaScript only.
        if !im.is_type_only() && !im.import().is_type_only() {
            check(im.imported().name(), im.imported().span(), im.import().spec(), Taken::Imported, cx);
        }
    }

    fn export_spec<'a>(&self, im: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        let node = im.export();
        // Upstream asks an `ExportSpecifier` for its `importKind`: `export { type a } from "m"` is looked at.
        if let Some(source) = node.spec().filter(|_| node.has_from() && !node.is_type_only()) {
            check(im.local().name(), im.local().span(), source, Taken::ExportedAgain, cx);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        if !file.has_stmts([StmtTag::Import]) || !file.has_stmts([StmtTag::ExportNamed]) {
            return;
        }
        let module_record = ModuleRecord::new(file);
        let default_imports = module_record.import_entries.iter();
        let default_imports = default_imports.filter(|it| matches!(it.import_name, ImportImportName::Default(_)));
        let default_imports = default_imports.map(|it| (it.declaration.spec(), it.local_name().name()));
        let default_imports: FxHashSet<_> = default_imports.collect();
        // Those that are made of an `import` and an `export { a }`.
        let synthesized = module_record.indirect_export_entries.iter();
        let synthesized = synthesized.filter(|it| !it.statement_span.contains(it.span));
        for (module_request, import_name) in synthesized.map(|it| (it.module_request, it.import_name)) {
            let (Some(module_request), ExportImportName::Name(import_name)) = (module_request, import_name) else {
                continue;
            };
            let is_reexport_of_default_import = default_imports.contains(&(module_request.name, import_name.name))
                && loaded_module(file, module_request.name).is_some_and(has_default_export);
            if !is_reexport_of_default_import {
                check(import_name.name, import_name.span, module_request.name, Taken::ExportedAgain, cx);
            }
        }
    }
}

fn loaded_module<'a>(file: &'a File<'a>, specifier: Name<'a>) -> Option<Loaded<'a>> {
    get_loaded_module(file, specifier.bytes()).filter(|it| it.record.has_module_syntax)
}

fn has_default_export(remote: Loaded) -> bool {
    remote.record.has_export_default || remote.exports(b"default")
}

/// `name`, which is written at `at`, is taken from the module `source`.
fn check<'a>(name: Name<'a>, at: Span, source: Name<'a>, taken: Taken, cx: &mut Cx<'a, Named>) {
    let file = cx.file();
    let Some(maps) = &cx.state.maps else {
        let Some(remote) = loaded_module(file, source) else {
            return;
        };
        let is_found = remote.exports(name.bytes())
            || match taken {
                Taken::Imported => {
                    name.is("default") && remote.record.has_export_default
                        || cx.state.star_exports.contains(remote, name.bytes())
                }
                Taken::ExportedAgain => name.is("default") && has_default_export(remote),
            };
        if !is_found {
            cx.report(at, OXLINT).data("imported_name", debug(name.bytes())).data("module_name", debug(source.bytes()));
        }
        return;
    };
    let imports = match cx.state.last {
        Some((known, imports)) if known == source => imports,
        _ => {
            // With errors it is ambiguous: they are never reported.
            let imports = maps.get(source.bytes()).filter(|it| !it.is_ambiguous());
            cx.state.last = Some((source, imports));
            imports
        }
    };
    let Some(imports) = imports else {
        return;
    };
    let (found, path) = maps.has_deep(imports, name.bytes());
    if found {
        return;
    }
    let Some(modules) = file.modules().filter(|_| path.len() > 1) else {
        cx.report(at, NOT_FOUND).data("name", name).data("source", source);
        return;
    };
    let directory = paths::resolve(modules.cwd(), paths::dirname(&paths::portable(file.path(), file.path())));
    let relative = |i: &ExportMap| paths::to_native(paths::relative(&directory, i.path()));
    let deep_path: Vec<Vec<u8>> = path.iter().map(relative).collect();
    cx.report(at, NOT_FOUND_VIA).data("name", name).data("deepPath", deep_path.join(&b" -> "[..]));
}
