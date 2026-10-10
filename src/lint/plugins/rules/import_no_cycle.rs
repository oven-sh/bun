use bun_core::strings;
use crate::import_export_record::may_be_module;
use crate::import_resolve::Resolvers;
use crate::import_settings::Settings;
use crate::import_type::ImportTypes;
use crate::module_visitor::{self, Systems};
use crate::oxlint;
use bun_lint::modules::{
    Declaration, Flavor, ModuleId, Modules, Request, RequestKind, ResolveBy, requests_of, set_lines,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;
use std::collections::VecDeque;
use std::sync::Arc;

/// Forbid a module from importing a module with a dependency path back to itself.
pub struct NoCycle {
    max_depth: usize,
    ignore_external: bool,
    allow_unsafe_dynamic_cyclic_dependency: bool,
    disable_scc: bool,
    /// An option of oxlint, where it can be turned off. eslint-plugin-import always ignores the imports of types.
    ignore_types: bool,
    commonjs: bool,
    amd: bool,
    esmodule: bool,
    ignore: Vec<Regex>,
}

const DETECTED: Message = Message::new("", "Dependency cycle detected.");
const VIA: Message = Message::new("", "Dependency cycle via {{route}}");
/// The message of oxlint.
const DETECTED_BY_OXLINT: Message = Message::new("", "Dependency cycle detected");

/// What `moduleVisitor` calls its visitor with.
struct Check<'a> {
    specifier: &'a [u8],
    /// What is reported.
    importer: Span,
    is_require: bool,
    /// `import()`. The only other call that is an importer is one of `require`: of AMD it is the string.
    is_dynamic: bool,
}

impl Rule for NoCycle {
    const META: Meta = Meta::plugin(Plugin::Import, "no-cycle", Kind::Suggestion).needs_modules();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoCycle {
            max_depth: options.usize("maxDepth").unwrap_or(usize::MAX),
            ignore_external: options.bool_or("ignoreExternal", false),
            allow_unsafe_dynamic_cyclic_dependency: options.bool_or("allowUnsafeDynamicCyclicDependency", false),
            disable_scc: options.bool_or("disableScc", false),
            ignore_types: options.bool_or("ignoreTypes", true),
            commonjs: options.bool_or("commonjs", false),
            amd: options.bool_or("amd", false),
            esmodule: options.bool_or("esmodule", true),
            ignore: options.strings("ignore").iter().filter_map(|it| Regex::new(it, "").ok()).collect(),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        let modules = file.modules().filter(|_| file.path() != b"<text>")?;
        let flavor = oxlint::flavor_of_modules(file);
        if modules.is_complete() {
            return Some(());
        }
        let mut requests = requests_of(file, flavor);
        if flavor == Flavor::Oxlint {
            if !self.ignore_types {
                requests.iter_mut().for_each(|it| it.is_only_importing_types = false);
            }
            modules.record(file.path(), &requests, false, flavor);
            return None;
        }
        // What a name means is a matter of the settings, in every file that the graph comes to.
        Resolvers::of(file.settings())?;
        modules.resolve_by(&|| {
            let settings = Arc::new(file.settings().clone());
            let same = Arc::clone(&settings);
            ResolveBy {
                resolve: Box::new(move |modules, from, specifier, is_require| {
                    let found = Resolvers::of(&settings)?.resolve_from(modules, from, specifier, is_require);
                    found.file().map(<[u8]>::to_vec)
                }),
                is_known: Box::new(move |path, text| has_export_map(&Settings::new(&same), path, text)),
            }
        });
        if !has_export_map(&Settings::new(file.settings()), file.path(), file.text()) {
            requests.clear();
        }
        // A way back can lead through a package.
        modules.follow_packages();
        let checks = if self.commonjs || self.amd { self.checks(file) } else { Vec::new() };
        let known = requests.len();
        requests.extend(checks.iter().filter(|it| it.is_require).map(|it| Request {
            specifier: it.specifier,
            span: it.importer,
            line: it.importer.start,
            kind: RequestKind::Other,
            is_only_importing_types: false,
            may_be_itself: false,
        }));
        set_lines(file.text(), &mut requests[known..]);
        // Where the components do not tell: they are made of the imports of values.
        let imports_no_value = known > 0 && requests[..known].iter().all(|it| it.is_only_importing_types);
        let is_always_checked = requests.len() > known || self.disable_scc || !self.ignore_types || imports_no_value;
        modules.record(file.path(), &requests, is_always_checked, flavor);
        None
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        if oxlint::flavor_of_modules(cx.file()) == Flavor::Oxlint { self.check_as_oxlint(cx) } else { self.check(cx) }
    }
}

/// A module may export its own names again, under a name: `export { a as b } from "./me"`, `export * as me from "./me"`, and
/// `import { a } from "./me"; export { a }`.
fn oxlint_allows_self_reference<'a>(file: &'a File<'a>, specifier: &[u8]) -> bool {
    let is_it = |spec: Option<Name<'a>>| spec.is_some_and(|it| it.bytes() == specifier);
    let mut exported: Option<FxHashSet<Name<'a>>> = None;
    let mut is_exported = |local: Name<'a>| {
        let exported = exported.get_or_insert_with(|| {
            let exports = file.body().iter().filter_map(|stmt| match stmt.kind() {
                StmtKind::ExportNamed(export) if export.spec().is_none() => Some(export.items()),
                _ => None,
            });
            exports.flatten().map(|it| it.local().name()).collect()
        });
        exported.contains(&local)
    };
    file.body().iter().any(|stmt| match stmt.kind() {
        StmtKind::ExportNamed(export) => is_it(export.spec()) && !export.items().is_empty(),
        StmtKind::ExportStar { spec, alias, .. } => is_it(spec) && alias.is_some(),
        StmtKind::Import(import) => {
            is_it(Some(import.spec()))
                && (import.default().is_some_and(|it| is_exported(it.name())) || import.named().iter().any(|it| is_exported(it.local().name())))
        }
        _ => false,
    })
}

/// Whether `ExportMapBuilder.for` has something for the file at `path`, which has this text.
fn has_export_map(settings: &Settings, path: &[u8], text: &[u8]) -> bool {
    !settings.is_ignored(path) && may_be_module(text)
}

/// What is the same for all the imports of a file.
struct Search<'s, 'a> {
    rule: &'s NoCycle,
    modules: &'a dyn Modules,
    settings: Settings<'a>,
    types: ImportTypes<'a>,
    file: &'a File<'a>,
    me: ModuleId,
}

impl Search<'_, '_> {
    /// `ignoreModule`. As upstream, the name is resolved in the file that is linted, also where another file has it.
    fn ignores(&self, name: &[u8], is_require: bool) -> bool {
        self.rule.ignore_external
            && (self.types).is_external_module(name, &self.types.resolvers().resolve(self.file, name, is_require))
    }

    fn is_in_my_component(&self, module: ModuleId, uses_components: bool) -> bool {
        !uses_components || self.modules.component(module) == self.modules.component(self.me)
    }

    /// The way back from `imported` to the file, breadth first: the declarations that lead there. `None` if there is none.
    /// `traversed`: the modules that have been looked at, for this import of the file or for an earlier one.
    fn find_cycle<'m>(&'m self, imported: ModuleId, uses_components: bool, traversed: &mut FxHashSet<ModuleId>) -> Option<Vec<&'m Declaration>> {
        // A module, and the index of what led to it.
        let mut untraversed: VecDeque<(ModuleId, Option<usize>, usize)> = VecDeque::from([(imported, None, 0)]);
        // A declaration, and the index of what led to the module that has it.
        let mut routes: Vec<(&Declaration, Option<usize>)> = Vec::new();
        while let Some((module, route, depth)) = untraversed.pop_front() {
            if self.settings.is_ignored(self.modules.path(module)) || !traversed.insert(module) {
                continue;
            }
            for import in self.modules.imports(module) {
                if !self.is_in_my_component(import.module, uses_components) || traversed.contains(&import.module) {
                    continue;
                }
                let is_traversed = |it: &&Declaration| {
                    !self.ignores(&it.specifier, false) && !(self.rule.ignore_types && it.is_only_importing_types)
                };
                let mut to_traverse = import.declarations.iter().filter(is_traversed).peekable();
                if self.rule.allow_unsafe_dynamic_cyclic_dependency && to_traverse.clone().any(|it| it.is_dynamic) {
                    break;
                }
                if import.module == self.me && to_traverse.peek().is_some() {
                    let mut found = Vec::new();
                    let mut at = route;
                    while let Some((declaration, before)) = at.and_then(|at| routes.get(at)) {
                        found.push(*declaration);
                        at = *before;
                    }
                    found.reverse();
                    return Some(found);
                }
                if depth + 1 < self.rule.max_depth {
                    for declaration in to_traverse {
                        routes.push((declaration, route));
                        untraversed.push_back((import.module, Some(routes.len() - 1), depth + 1));
                    }
                }
            }
        }
        None
    }
}

fn is_in_node_modules(path: &[u8]) -> bool {
    strings::contains(path, b"/node_modules/")
}

/// oxlint's `ModuleGraphVisitor` with a `max_depth`: whether it gets from `start` to `needle`. It goes depth first, by the order of
/// the specifiers, to no module twice, and gives up altogether the first time that it is too deep.
fn oxlint_finds_within(modules: &dyn Modules, start: ModuleId, needle: ModuleId, max_depth: usize) -> bool {
    // The specifier, the module, and whether it is followed.
    let entries_of = |module: ModuleId| {
        let mut entries: Vec<(&[u8], ModuleId, bool)> = Vec::new();
        for import in modules.imports(module) {
            let is_followed = !is_in_node_modules(modules.path(import.module));
            entries.extend(import.declarations.iter().map(|it| (&it.specifier[..], import.module, is_followed && !it.is_only_importing_types)));
        }
        utils::sort::sort_unstable(&mut entries);
        entries.dedup();
        entries.into_iter()
    };
    let mut traversed = FxHashSet::default();
    let mut stack = vec![entries_of(start)];
    while let Some(entries) = stack.last_mut() {
        let Some((_, module, is_followed)) = entries.next() else {
            stack.pop();
            continue;
        };
        if stack.len() - 1 > max_depth {
            return false;
        }
        if !is_followed || !traversed.insert(module) {
            continue;
        }
        if module == needle {
            return true;
        }
        stack.push(entries_of(module));
    }
    false
}

impl NoCycle {
    /// oxlint's rule: one report for each specifier that leads back to the file, at the first place that has it.
    fn check_as_oxlint<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let Some(modules) = file.modules() else {
            return;
        };
        let Some(me) = modules.find(file.path()) else {
            return;
        };
        // The modules are known by their real paths. Nothing leads back to the name of a link.
        if modules.path(me) != bun_lint::paths::from_native(file.path()) {
            return;
        }
        let requests = requests_of(file, Flavor::Oxlint);
        let mut seen = FxHashSet::default();
        for request in &requests {
            if !seen.insert(request.specifier) || self.ignore_types && request.is_only_importing_types {
                continue;
            }
            let Some(imported) = modules.resolve(file.path(), request.specifier, false).map(|it| it.module) else {
                continue;
            };
            let leads_back = if is_in_node_modules(modules.path(imported)) {
                false
            } else if imported == me {
                !oxlint_allows_self_reference(file, request.specifier)
            } else if self.max_depth == usize::MAX {
                modules.component(imported) == modules.component(me)
            } else {
                oxlint_finds_within(modules, imported, me, self.max_depth.saturating_sub(1))
            };
            if leads_back {
                let report = cx.report(request.span, DETECTED_BY_OXLINT);
                if imported == me {
                    let mut imports = file.stmts_of_kind(StmtTag::Import);
                    report.first_label("this module references itself").help(
                        match imports.any(|it| it.span().contains(request.span)) {
                            true => "Remove the self-referencing import.",
                            false => "Remove the self-referencing export and consider using a named export instead.",
                        },
                    );
                }
            }
        }
    }

    /// What `moduleVisitor` visits, in the order of the source, without what the rule passes over.
    fn checks<'a>(&self, file: &'a File<'a>) -> Vec<Check<'a>> {
        let systems = Systems { esmodule: self.esmodule, commonjs: self.commonjs, amd: self.amd };
        // Also an `import` that imports nothing: upstream asks whether every specifier is a type.
        let has_values = |importer: Node<'a>| match importer {
            Node::Stmt(stmt) => match stmt.kind() {
                StmtKind::Import(import) if self.ignore_types => {
                    !import.is_type_only()
                        && (import.default().is_some()
                            || import.namespace().is_some()
                            || import.named().iter().any(|it| !it.is_type_only()))
                }
                _ => true,
            },
            _ => true,
        };
        let visited = module_visitor::visit(file, systems).into_iter().filter(|it| has_values(it.importer));
        let checks = visited.filter(|it| !self.ignore.iter().any(|ignored| ignored.test(it.specifier))).map(|it| Check {
            specifier: it.specifier,
            importer: it.importer.span(),
            is_require: it.is_require,
            is_dynamic: matches!(it.importer, Node::Expr(e) if e.tag() == ExprTag::ImportCall),
        });
        checks.collect()
    }

    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let Some(modules) = file.modules() else {
            return;
        };
        let Some(me) = modules.find(file.path()) else {
            return;
        };
        let Some(types) = ImportTypes::of(file) else {
            return;
        };
        let search = Search { rule: self, modules, settings: Settings::new(file.settings()), types, file, me };
        // `scc` has the modules that imports of values lead to from here. Without any it is empty: all are alike in it.
        let imports_value = |it: &Request| {
            !it.is_only_importing_types && modules.resolve(file.path(), it.specifier, false).is_some()
        };
        let has_components = has_export_map(&search.settings, file.path(), file.text())
            && requests_of(file, Flavor::EslintPluginImport).iter().any(imports_value);
        let uses_components = !self.disable_scc && self.ignore_types && has_components;
        let mut traversed = FxHashSet::default();
        for check in self.checks(file) {
            if search.ignores(check.specifier, check.is_require)
                || self.allow_unsafe_dynamic_cyclic_dependency && check.is_dynamic
            {
                continue;
            }
            let Some(imported) = modules.resolve(file.path(), check.specifier, check.is_require) else {
                continue;
            };
            let imported = imported.module;
            if imported == me || search.settings.is_ignored(modules.path(imported)) || !search.is_in_my_component(imported, uses_components) {
                continue;
            }
            let Some(route) = search.find_cycle(imported, uses_components, &mut traversed) else {
                continue;
            };
            if route.is_empty() {
                cx.report(check.importer, DETECTED);
                continue;
            }
            let mut text = Vec::new();
            for (i, declaration) in route.iter().enumerate() {
                if i > 0 {
                    text.extend_from_slice(b"=>");
                }
                text.extend_from_slice(&declaration.specifier);
                text.push(b':');
                text.extend_from_slice(declaration.line.to_string().as_bytes());
            }
            cx.report(check.importer, VIA).data("route", text);
        }
    }
}
