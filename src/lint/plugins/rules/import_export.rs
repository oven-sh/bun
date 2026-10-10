use crate::import_export_map::{ExportMaps, PARSE_ERRORS};
use crate::import_export_record::recursive_pattern_capture;
use bun_core::strings;
use bun_lint::modules::ModuleId;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::import::export_declaration_span;
use bun_lint_oxlint::module_record::{
    ExportEntry, ExportExportName, Loaded, ModuleRecord, get_loaded_module, is_waiting_for_modules,
};
use bun_lint_oxlint::text::find_next_token_within;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

/// Forbid any invalid exports, i.e. re-export of the same name.
pub struct Export;

const NO_NAMED_EXPORTS: Message = Message::new("", "No named exports found in module '{{module_name}}'.");
const OXLINT_NO_NAMED_EXPORT: Message = Message::new("", "No named exports found in module '{{module_name}}'");
const MULTIPLE_DEFAULT_EXPORTS: Message = Message::new("", "Multiple default exports.");
const MULTIPLE_EXPORTS: Message = Message::new("", "Multiple exports of name '{{name}}'.");

const DEFAULT: &[u8] = b"default";

/// `rootProgram`, where a `TSModuleDeclaration` is known by its start.
const ROOT_PROGRAM: u32 = u32::MAX;

const EXPORTS: [StmtTag; 3] = [StmtTag::ExportDefault, StmtTag::ExportNamed, StmtTag::ExportStar];

/// What `export` can be before.
const DECLARATIONS: [StmtTag; 8] = [
    StmtTag::Var,
    StmtTag::Fn,
    StmtTag::Class,
    StmtTag::Interface,
    StmtTag::TypeAlias,
    StmtTag::Enum,
    StmtTag::Module,
    StmtTag::ImportEquals,
];

fn get_parent(node: Stmt) -> u32 {
    match node.parent() {
        Node::Stmt(parent) if parent.tag() == StmtTag::Module => parent.span().start,
        _ => ROOT_PROGRAM,
    }
}

/// `parent.type` of a node that exports a name, as far as it is asked for. An `ExportDefaultDeclaration` is asked for
/// `declaration.type`, where only the overload counts.
#[derive(Copy, Clone, PartialEq, Eq)]
enum ParentType {
    FunctionDeclaration,
    TsDeclareFunction,
    ClassDeclaration,
    TsEnumDeclaration,
    TsModuleDeclaration,
    ExportSpecifier,
    Other,
}

impl ParentType {
    /// As a member of [`types_of`].
    const fn bit(self) -> u8 {
        1 << self as u8
    }
}

/// A member of `nodes`.
#[derive(Copy, Clone)]
struct Place {
    at: Span,
    parent: ParentType,
}

/// A name, and its `nodes`.
struct Named<'a> {
    name: &'a [u8],
    nodes: SmallVec<[Place; 2]>,
}

/// `new Set(Array.from(nodes, (node) => node.parent.type))`
fn types_of(nodes: &[Place]) -> u8 {
    nodes.iter().fold(0, |types, node| types | node.parent.bit())
}

/// After `removeTypescriptFunctionOverloads`: there is no `TSDeclareFunction`.
fn is_typescript_namespace_merging(nodes: &[Place]) -> bool {
    let (types, namespace) = (types_of(nodes), ParentType::TsModuleDeclaration.bit());
    let no_namespace_nodes = nodes.iter().filter(|node| node.parent != ParentType::TsModuleDeclaration);
    let is_with_class_or_enum = types == (namespace | ParentType::ClassDeclaration.bit())
        || types == (namespace | ParentType::TsEnumDeclaration.bit());
    types == namespace
        || types == (namespace | ParentType::FunctionDeclaration.bit())
        || (is_with_class_or_enum && no_namespace_nodes.count() == 1)
}

impl Place {
    /// Where nothing merges.
    fn should_skip_typescript_namespace(self, nodes: &[Place]) -> bool {
        let merged_with = ParentType::TsEnumDeclaration.bit()
            | ParentType::ClassDeclaration.bit()
            | ParentType::FunctionDeclaration.bit();
        self.parent == ParentType::TsModuleDeclaration && (types_of(nodes) & merged_with) != 0
    }
}

/// What `create` keeps.
struct Exports<'a, 'c> {
    cx: &'c Cx<'a, Export>,
    is_oxlint: bool,
    /// `namespace`: where in `named` a name is, by its parent and whether it is a type.
    places: FxHashMap<(u32, bool, &'a [u8]), usize>,
    named: Vec<Named<'a>>,
    maps: Option<&'c ExportMaps<'a>>,
    /// For oxlint: the modules that an `export *` has led to, and the first `export *` that brings each name.
    visited: FxHashSet<ModuleId>,
    all_export_names: FxHashMap<&'a [u8], Span>,
}

impl<'a> Exports<'a, '_> {
    fn add_named(&mut self, name: &'a [u8], at: Span, parent_type: ParentType, parent: u32, is_type: bool) {
        let next = self.named.len();
        let place = *self.places.entry((parent, is_type, name)).or_insert(next);
        if place == next {
            self.named.push(Named { name, nodes: SmallVec::new() });
        }
        // A `Set`: an `export *` can bring a name twice.
        if let Some(Named { nodes, .. }) = self.named.get_mut(place)
            && nodes.last().is_none_or(|last| last.at != at)
        {
            nodes.push(Place { at, parent: parent_type });
        }
    }

    /// What the listeners do with a statement.
    fn add_exports_of(&mut self, node: Stmt<'a>, parent: u32) {
        let (id, parent_type, is_type) = match node.kind() {
            StmtKind::ExportDefault(_) => {
                return self.add_named(DEFAULT, node.span(), ParentType::Other, parent, false);
            }
            StmtKind::ExportNamed(export) => {
                for specifier in export.items() {
                    let exported = specifier.exported();
                    self.add_named(exported.bytes(), exported.span(), ParentType::ExportSpecifier, parent, false);
                }
                return;
            }
            // The `Literal` of `export * as "a" from "m"` has no `name`: it is taken for `export * from "m"`.
            StmtKind::ExportStar { spec: Some(source), alias, .. } if alias.is_none_or(Ident::is_string) => {
                if let Some(at) = node.module_specifier_span() {
                    self.export_all(node.span(), (source.bytes(), at), parent);
                }
                return;
            }
            kind if node.is_default_export() => {
                let is_overload = matches!(kind, StmtKind::Fn(it) if !it.has_body());
                let parent_type = if is_overload { ParentType::TsDeclareFunction } else { ParentType::Other };
                return self.add_named(DEFAULT, export_declaration_span(node), parent_type, parent, false);
            }
            StmtKind::Var(declarations) => {
                for declaration in declarations {
                    let id = declaration.pat().span();
                    recursive_pattern_capture(declaration.pat(), &mut |v| {
                        // typescript-eslint has the annotation as a part of the `Identifier`.
                        let at = if v.span() == id { declaration.binding_span() } else { v.span() };
                        if let Some(name) = v.as_ident() {
                            self.add_named(name.bytes(), at, ParentType::Other, parent, false);
                        }
                    });
                }
                return;
            }
            StmtKind::Fn(it) if it.has_body() => (it.name(), ParentType::FunctionDeclaration, false),
            StmtKind::Fn(it) => (it.name(), ParentType::TsDeclareFunction, false),
            StmtKind::Class(it) => (it.name(), ParentType::ClassDeclaration, false),
            StmtKind::Enum(it) => (Some(it.name()), ParentType::TsEnumDeclaration, false),
            StmtKind::Module(it) => match it.name() {
                ModuleName::Ident(id) if it.nested().is_none() => (Some(id), ParentType::TsModuleDeclaration, false),
                // A `TSQualifiedName` and a `Literal` have no `name`.
                _ => return,
            },
            StmtKind::TypeAlias(it) => (Some(it.name()), ParentType::Other, true),
            StmtKind::Interface(it) => (Some(it.name()), ParentType::Other, true),
            StmtKind::ImportEquals(it) => (Some(it.name()), ParentType::Other, false),
            _ => return,
        };
        if let Some(id) = id {
            self.add_named(id.bytes(), id.span(), parent_type, parent, is_type);
        }
    }

    /// oxlint goes by its record of the file, which is about the top level.
    fn add_module_record(&mut self, module_record: &ModuleRecord<'a>) {
        let file = self.cx.file();
        for export_entry in module_record.local_export_entries.iter().chain(&module_record.indirect_export_entries) {
            let (name, at) = match export_entry.export_name {
                ExportExportName::Name(name) => (name.name.bytes(), name.span),
                ExportExportName::Default(span) => (DEFAULT, span),
                ExportExportName::Null => continue,
            };
            let is_specifier = is_named_export_specifier(export_entry, file);
            let parent_type = if is_specifier { ParentType::ExportSpecifier } else { ParentType::Other };
            self.add_named(name, at, parent_type, ROOT_PROGRAM, export_entry.is_type);
        }
        for star_export_entry in module_record.star_export_entries.iter().filter(|it| !it.is_type) {
            if let Some(module_request) = star_export_entry.module_request {
                let source = (module_request.name.bytes(), module_request.span);
                self.export_all(star_export_entry.span, source, ROOT_PROGRAM);
            }
        }
        for (name, span) in &module_record.exported_bindings {
            if let Some(first) = self.all_export_names.get(name.bytes()) {
                self.cx.report(*first, MULTIPLE_EXPORTS).data("name", *name).label(*span, "");
            }
        }
    }

    /// `ExportAllDeclaration`: `node`, and the value and the place of its `source`.
    fn export_all(&mut self, node: Span, source: (&'a [u8], Span), parent: u32) {
        let (cx, mut any) = (self.cx, false);
        if self.is_oxlint {
            let Some(remote) = get_loaded_module(cx.file(), source.0) else {
                return;
            };
            // oxlint compares them with what the file exports when it has them all.
            for name in walk_exported_recursive(remote, &mut self.visited) {
                any = true;
                self.all_export_names.entry(name).or_insert(node);
            }
        } else {
            let Some((maps, remote_exports)) = self.maps.and_then(|maps| Some((maps, maps.get(source.0)?))) else {
                return;
            };
            if remote_exports.has_errors() {
                let errors = remote_exports.errors_text();
                cx.report(source.1, PARSE_ERRORS).data("source", source.0).data("errors", errors).on_exit(false);
                return;
            }
            maps.for_each(remote_exports, &mut |_, name| {
                if name != DEFAULT {
                    any = true;
                    self.add_named(name, node, ParentType::Other, parent, false);
                }
            });
        }
        if !any {
            // oxlint ends it without a full stop.
            let message = if self.is_oxlint { OXLINT_NO_NAMED_EXPORT } else { NO_NAMED_EXPORTS };
            cx.report(source.1, message).data("module_name", source.0).on_exit(false);
        }
    }

    /// `Program:exit`
    fn report(&mut self) {
        let (cx, is_oxlint) = (self.cx, self.is_oxlint);
        for Named { name, nodes } in &mut self.named {
            // `removeTypescriptFunctionOverloads`
            nodes.retain(|node| node.parent != ParentType::TsDeclareFunction);
            let (name, nodes) = (*name, nodes.as_slice());
            let Some((first, rest)) = nodes.split_first().filter(|it| !it.1.is_empty()) else {
                continue;
            };
            if is_oxlint {
                // oxlint says it once, and only if one of them is in braces.
                if nodes.iter().any(|node| node.parent == ParentType::ExportSpecifier) {
                    cx.report(first.at, MULTIPLE_EXPORTS).data("name", name).labels_with(|labels| {
                        for node in rest {
                            labels.push(node.at, "");
                        }
                    });
                }
                continue;
            }
            if is_typescript_namespace_merging(nodes) {
                continue;
            }
            for node in nodes.iter().filter(|node| !node.should_skip_typescript_namespace(nodes)) {
                if name == DEFAULT {
                    cx.report(node.at, MULTIPLE_DEFAULT_EXPORTS);
                } else {
                    cx.report(node.at, MULTIPLE_EXPORTS).data("name", name);
                }
            }
        }
    }
}

impl Rule for Export {
    const META: Meta = Meta::plugin(Plugin::Import, "export", Kind::Problem).needs_modules().reports_at_the_end();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Export
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // oxlint asks the records of the other files, which are made of all files first.
        (!file.language().is_oxlint || !is_waiting_for_modules(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let (cx, file) = (&*cx, cx.file());
        let is_oxlint = file.language().is_oxlint;
        let maps = if !is_oxlint && file.has_stmts([StmtTag::ExportStar]) { ExportMaps::of(file) } else { None };
        let mut exports = Exports {
            cx,
            is_oxlint,
            places: FxHashMap::default(),
            named: Vec::new(),
            maps: maps.as_ref(),
            visited: FxHashSet::default(),
            all_export_names: FxHashMap::default(),
        };
        if is_oxlint {
            exports.add_module_record(&ModuleRecord::new(file));
        } else {
            // typescript-eslint lets them be in any block.
            let declarations = DECLARATIONS.into_iter().flat_map(|tag| file.stmts_of_kind(tag));
            let exports_of_kind = EXPORTS.into_iter().flat_map(|tag| file.stmts_of_kind(tag));
            let mut nodes: Vec<Stmt> = exports_of_kind.chain(declarations.filter(|it| it.is_exported())).collect();
            utils::sort::sort_unstable_by_key(&mut nodes, |it| it.span().start);
            for node in nodes {
                exports.add_exports_of(node, get_parent(node));
            }
        }
        exports.report();
    }
}

/// It is in braces.
fn is_named_export_specifier<'a>(export_entry: &ExportEntry<'a>, file: &'a File<'a>) -> bool {
    // What is made of an `import` and an `export { a }` has the place of the import, which can come later.
    export_entry.statement_span.start > export_entry.span.start
        || find_next_token_within(file, Span::before(export_entry.statement_span.start, export_entry.span), b"{").is_some()
}

/// The names that `module` exports, with those that it gets by `export *`. Nothing of what is in `visited`, or in a `node_modules`.
fn walk_exported_recursive<'m>(module: Loaded<'m>, visited: &mut FxHashSet<ModuleId>) -> FxHashSet<&'m [u8]> {
    let mut result = FxHashSet::default();
    let mut pending = vec![module];
    while let Some(at) = pending.pop() {
        let is_in_node_modules = strings::split(at.path(), b"/").any(|it| it == b"node_modules");
        if is_in_node_modules || !visited.insert(at.module) {
            continue;
        }
        result.extend(at.record.exported_bindings.iter().map(|it| &**it));
        pending.extend(at.record.star_export_entries.iter().filter_map(|it| at.get_loaded_module(it)));
    }
    result
}
