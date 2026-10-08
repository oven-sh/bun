use bun_core::strings;
use crate::oxlint;
use bun_lint::modules::{Declaration, Flavor, ModuleId, Modules, Request, RequestKind, requests_of, set_lines};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;
use std::collections::VecDeque;

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
    /// `import()`
    is_dynamic: bool,
}

impl Rule for NoCycle {
    const META: Meta = Meta::plugin(Plugin::Import, "no-cycle", Kind::Suggestion).needs_modules();
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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        let Some(modules) = file.modules().filter(|_| file.path() != b"<text>") else {
            return;
        };
        let flavor = oxlint::flavor_of_modules(file);
        if modules.is_complete() {
            return on.finish(if flavor == Flavor::Oxlint { Self::check_as_oxlint } else { Self::check });
        }
        let mut requests = requests_of(file, flavor);
        if flavor == Flavor::Oxlint {
            if !self.ignore_types {
                requests.iter_mut().for_each(|it| it.is_only_importing_types = false);
            }
            return modules.record(file.path(), &requests, false, flavor);
        }
        let checks = if self.commonjs || self.amd { self.checks(file) } else { Vec::new() };
        let known = requests.len();
        requests.extend(checks.iter().filter(|it| it.is_require).map(|it| Request {
            specifier: it.specifier,
            span: it.importer,
            line: it.importer.start,
            kind: RequestKind::Other,
            is_only_importing_types: false,
        }));
        set_lines(file.text(), &mut requests[known..]);
        // Where the components do not tell.
        let is_always_checked = requests.len() > known || self.disable_scc || !self.ignore_types;
        modules.record(file.path(), &requests, is_always_checked, flavor);
    }
}

/// `settings["import/.."]`
struct Settings {
    /// `import/extensions` and those of `import/parsers`. `None`: all of JavaScript and TypeScript.
    extensions: Option<Vec<Box<[u8]>>>,
    ignore: Vec<Regex>,
    internal_regex: Option<Regex>,
    external_module_folders: Vec<Box<[u8]>>,
}

fn strings_of(json: Option<&Json>) -> Vec<&[u8]> {
    json.and_then(Json::as_array).unwrap_or_default().iter().filter_map(Json::as_str).collect()
}

impl Settings {
    fn new(settings: &Json) -> Settings {
        let (extensions, parsers) = (settings.get(b"import/extensions"), settings.get(b"import/parsers"));
        let of_parsers = parsers.and_then(Json::as_object).unwrap_or_default().iter().flat_map(|it| strings_of(Some(&it.1)));
        let folders = settings.get(b"import/external-module-folders");
        Settings {
            extensions: (extensions.is_some() || parsers.is_some()).then(|| {
                let own = match extensions {
                    Some(_) => strings_of(extensions),
                    None => vec![&b".js"[..], b".mjs", b".cjs"],
                };
                own.into_iter().chain(of_parsers).map(Box::from).collect()
            }),
            ignore: strings_of(settings.get(b"import/ignore")).iter().filter_map(|it| Regex::from_bytes(it, b"").ok()).collect(),
            internal_regex: (settings.get(b"import/internal-regex").and_then(Json::as_str))
                .and_then(|it| Regex::from_bytes(it, b"").ok()),
            external_module_folders: strings_of(folders).into_iter().map(Box::from).collect(),
        }
    }

    /// eslint-plugin-import has no `ExportMap` for the file at `path`.
    fn is_ignored(&self, path: &[u8]) -> bool {
        let name = &path[strings::last_index_of_char(path, b'/').map_or(0, |it| it + 1)..];
        let extension = strings::last_index_of_char(name, b'.').filter(|&at| at > 0).map_or(&b""[..], |at| &name[at..]);
        let is_valid = match &self.extensions {
            Some(extensions) => extensions.iter().any(|it| **it == *extension),
            None => matches!(extension, b".js" | b".mjs" | b".cjs" | b".jsx" | b".ts" | b".mts" | b".cts" | b".tsx"),
        };
        !is_valid || self.ignore.iter().any(|it| it.test(path))
    }
}

/// A module may export its own names again, under a name: `export { a as b } from "./me"`, `export * as me from "./me"`, and
/// `import { a } from "./me"; export { a }`.
fn oxlint_allows_self_reference<'a>(file: &'a File<'a>, specifier: &[u8]) -> bool {
    let is_it = |spec: Option<Name<'a>>| spec.is_some_and(|it| it.bytes() == specifier);
    let is_exported = |local: Name<'a>| {
        file.body().iter().any(|stmt| {
            matches!(stmt.kind(), StmtKind::ExportNamed(export) if export.spec().is_none() && export.items().iter().any(|it| it.local().name() == local))
        })
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

/// `/^\w/.test(name) || /^@[^/]+\/?[^/]+/.test(name)`
fn is_external_looking_name(name: &[u8]) -> bool {
    match name {
        [b'@', rest @ ..] => {
            let scope = strings::index_of_char_usize(rest, b'/').unwrap_or(rest.len());
            scope >= 2 || scope == 1 && rest.get(2).is_some_and(|it| *it != b'/')
        }
        [first, ..] => first.is_ascii_alphanumeric() || *first == b'_',
        [] => false,
    }
}

/// What is the same for all the imports of a file.
struct Search<'s> {
    rule: &'s NoCycle,
    modules: &'s dyn Modules,
    settings: Settings,
    path: &'s [u8],
    me: ModuleId,
}

impl Search<'_> {
    /// `ignoreModule`. As upstream, the name is resolved in the file that is linted, also where another file has it.
    fn ignores(&self, name: &[u8], is_require: bool) -> bool {
        if !self.rule.ignore_external
            || !is_external_looking_name(name)
            || self.settings.internal_regex.as_ref().is_some_and(|it| it.test(name))
        {
            return false;
        }
        let Some(resolved) = self.modules.resolve(self.path, name, is_require) else {
            return true;
        };
        let path = self.modules.path(resolved.module);
        match &self.settings.external_module_folders[..] {
            [] => resolved.is_external || strings::contains(path, b"/node_modules/"),
            folders => folders.iter().any(|folder| {
                let folder = folder.strip_suffix(b"/").unwrap_or(folder);
                strings::contains(path, &[b"/", folder, b"/"].concat())
            }),
        }
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
        entries.sort_unstable();
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
        let requests = requests_of(file, Flavor::Oxlint);
        for (at, request) in requests.iter().enumerate() {
            if requests[..at].iter().any(|it| it.specifier == request.specifier) || self.ignore_types && request.is_only_importing_types {
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
                cx.report(request.span, DETECTED_BY_OXLINT);
            }
        }
    }

    /// What `moduleVisitor` visits, in the order of the source.
    fn checks<'a>(&self, file: &'a File<'a>) -> Vec<Check<'a>> {
        let mut checks = Vec::new();
        let string_of = |e: Expr<'a>| e.as_string().map(Name::bytes);
        if self.esmodule {
            for tag in [StmtTag::Import, StmtTag::ExportNamed, StmtTag::ExportStar] {
                for stmt in file.stmts_of_kind(tag) {
                    let specifier = match stmt.kind() {
                        // Also one that imports nothing: upstream asks whether every specifier is a type.
                        StmtKind::Import(import) if self.ignore_types => {
                            let has_values = import.default().is_some()
                                || import.namespace().is_some()
                                || import.named().iter().any(|it| !it.is_type_only());
                            (has_values && !import.is_type_only()).then(|| import.spec())
                        }
                        StmtKind::Import(import) => Some(import.spec()),
                        StmtKind::ExportNamed(export) => export.spec(),
                        StmtKind::ExportStar { spec, .. } => spec,
                        _ => None,
                    };
                    if let Some(specifier) = specifier {
                        checks.push(Check {
                            specifier: specifier.bytes(),
                            importer: stmt.span(),
                            is_require: false,
                            is_dynamic: false,
                        });
                    }
                }
            }
            for e in file.exprs_of_kind(ExprTag::ImportCall) {
                if let ExprKind::ImportCall { args } = e.kind()
                    && let Some(specifier) = args.first().and_then(string_of)
                {
                    checks.push(Check {
                        specifier,
                        importer: e.span(),
                        is_require: false,
                        is_dynamic: true,
                    });
                }
            }
        }
        if self.commonjs || self.amd {
            for e in file.exprs_of_kind(ExprTag::Call) {
                let ExprKind::Call(call) = e.kind() else {
                    continue;
                };
                let (Some(callee), args) = (call.callee().as_ident(), call.args()) else {
                    continue;
                };
                let mut require = |specifier: &'a [u8], importer: Span| {
                    checks.push(Check {
                        specifier,
                        importer,
                        is_require: true,
                        is_dynamic: false,
                    });
                };
                if self.commonjs
                    && callee.is("require")
                    && args.len() == 1
                    && let Some(module_path) = args.first()
                {
                    let specifier = match module_path.kind() {
                        ExprKind::Template(template) => template.as_static().map(Name::bytes),
                        _ => string_of(module_path),
                    };
                    if let Some(specifier) = specifier {
                        require(specifier, e.span());
                    }
                }
                if self.amd
                    && callee.is_any(&["require", "define"])
                    && args.len() == 2
                    && let Some(ExprKind::Array(elements)) = args.first().map(Expr::kind)
                {
                    for element in elements {
                        if let Some(specifier) = string_of(element).filter(|it| !matches!(*it, b"require" | b"exports")) {
                            require(specifier, element.span());
                        }
                    }
                }
            }
        }
        checks.retain(|check| !self.ignore.iter().any(|it| it.test(check.specifier)));
        checks.sort_by_key(|it| (it.importer.start, std::cmp::Reverse(it.importer.end)));
        checks
    }

    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let Some(modules) = file.modules() else {
            return;
        };
        let Some(me) = modules.find(file.path()) else {
            return;
        };
        let search = Search {
            rule: self,
            modules,
            settings: Settings::new(file.settings()),
            path: file.path(),
            me,
        };
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
            // What `require` leads to is not among the imports that the components are made of.
            let uses_components = !self.disable_scc && self.ignore_types && !check.is_require;
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
