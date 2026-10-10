#![allow(dead_code)] // until every rule of the plugin is written
//! What `ExportMapBuilder.parse` of eslint-plugin-import 2.32.0 reads out of one file, without what it asks the context: the
//! resolver, `esModuleInterop` and `import/docstyle` are applied by who asks. And `unambiguous` of eslint-module-utils.

use bun_core::strings;
use bun_lint::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::{SmallVec, smallvec};
use std::sync::Arc;

/// An `ExportMap`.
#[derive(Default)]
pub(crate) struct ExportRecord {
    pub(crate) path: Box<[u8]>,
    /// With one, all that follows is empty.
    pub(crate) errors: Vec<ParseError>,
    /// `parse` returns `null`: it is neither unambiguously a module nor has it an `import()`.
    pub(crate) is_null: bool,
    /// `parseGoal === 'Module'`
    pub(crate) is_module: bool,
    /// Of the first block comment with `@module`.
    pub(crate) doc: Option<Doc>,
    /// Every `namespace.set`, in order: a later one of the same name replaces the value, not the place.
    pub(crate) namespace: Vec<Entry>,
    /// Every `reexports.set`, in order.
    pub(crate) reexports: Vec<Reexport>,
    /// The specifier of each `dependencies.add`.
    pub(crate) star_exports: Vec<Box<[u8]>>,
    /// Every `captureDependency`, after every `processDynamicImport`.
    pub(crate) imports: Vec<Dependency>,
}

/// What the parser throws: `message`, `lineNumber`, `column`.
pub(crate) struct ParseError {
    pub(crate) message: Box<[u8]>,
    /// 0: it has no place.
    pub(crate) line: u32,
    pub(crate) column: u32,
}

pub(crate) struct Entry {
    /// `None`: `undefined`, the `name` of a node that has none.
    pub(crate) name: Option<Box<[u8]>>,
    pub(crate) doc: Docs,
    /// The specifier of the `import * as` that `namespace` resolves.
    pub(crate) namespace_of: Option<Box<[u8]>>,
    pub(crate) when: When,
}

/// What `isEsModuleInteropTrue` has to do with a `namespace.set`.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub(crate) enum When {
    Always,
    WithInterop,
    /// And `!namespace.has(name)`.
    WithInteropIfAbsent,
}

/// `doc`, for each of `import/docstyle`.
#[derive(Clone, Default)]
pub(crate) struct Docs {
    pub(crate) jsdoc: Option<Doc>,
    pub(crate) tomdoc: Option<Doc>,
}

#[derive(Clone)]
pub(crate) struct Doc {
    /// The first tag whose title is `deprecated`: its description.
    pub(crate) deprecated: Option<Option<Arc<[u8]>>>,
}

pub(crate) struct Reexport {
    /// `None`, here and in `local`: `undefined`, the `name` of a string.
    pub(crate) name: Option<Box<[u8]>>,
    pub(crate) local: Option<Box<[u8]>>,
    pub(crate) source: Box<[u8]>,
}

/// A `declarationMetadata`.
pub(crate) struct Dependency {
    /// `source.value`
    pub(crate) specifier: Box<[u8]>,
    /// `source.loc.start`
    pub(crate) line: u32,
    pub(crate) column: u32,
    pub(crate) is_only_importing_types: bool,
    /// It replaces what `imports` has for the path.
    pub(crate) is_dynamic: bool,
    /// Each once.
    pub(crate) imported_specifiers: Vec<ImportedSpecifier>,
}

pub(crate) enum ImportedSpecifier {
    /// `'ImportDefaultSpecifier'`
    Default,
    /// `'ImportNamespaceSpecifier'`
    Namespace,
    Named(Box<[u8]>),
}

const DEFAULT: &[u8] = b"default";

/// How much `typeScriptExport` does again for names that it has exported before. Without a limit: the square of the file.
const SAID_AGAIN: usize = 1024;

/// `unambiguous.test`: `/(^|[;})])\s*(export|import)((\s+\w)|(\s*[{*=]))|import\(/m`
pub(crate) fn may_be_module(text: &[u8]) -> bool {
    let mut from = 0;
    while let Some(found) = strings::index_of(&text[from..], b"port") {
        let port = from + found;
        from = port + 4;
        let (before, is_import) = match &text[..port] {
            [before @ .., b'i', b'm'] => (before, true),
            [before @ .., b'e', b'x'] => (before, false),
            _ => continue,
        };
        let after = &text[from..];
        if is_import && after.first() == Some(&b'(') {
            return true;
        }
        let next = strings::trim_js_whitespace_start(after);
        let is_followed = match next.first() {
            Some(b'{' | b'*' | b'=') => true,
            Some(b'_') => next.len() < after.len(),
            Some(c) => next.len() < after.len() && c.is_ascii_alphanumeric(),
            None => false,
        };
        if is_followed && starts_statement(before) {
            return true;
        }
    }
    false
}

/// `/(^|[;})])\s*$/m` matches `before`.
fn starts_statement(mut before: &[u8]) -> bool {
    loop {
        if before.is_empty() || strings::js_line_break_len_back(before) > 0 {
            return true;
        }
        match strings::js_whitespace_len_back(before) {
            0 => return matches!(before.last(), Some(b';' | b'}' | b')')),
            len => before = &before[..before.len() - len],
        }
    }
}

/// `unambiguous.isModule`
pub(crate) fn is_module<'a>(file: &'a File<'a>) -> bool {
    file.body().iter().any(|it| {
        matches!(
            it.tag(),
            StmtTag::Import
                | StmtTag::ExportNamed
                | StmtTag::ExportStar
                | StmtTag::ExportDefault
                | StmtTag::ExportAssign
        ) || it.is_exported()
    })
}

/// What has a default, and what follows `...`, goes to the callback as it is, which can be a pattern.
pub(crate) fn recursive_pattern_capture<'a>(pattern: Pat<'a>, callback: &mut dyn FnMut(Pat<'a>)) {
    // The next is the last, with whether it is looked into. Not by recursion, which a pattern can be too deep for.
    let mut pending: SmallVec<[(Pat<'a>, bool); 8]> = smallvec![(pattern, true)];
    while let Some((pat, is_entered)) = pending.pop() {
        match pat.kind() {
            PatKind::Object(properties) if is_entered => {
                let values = properties.iter().rev();
                pending
                    .extend(values.map(|it| (it.value(), !it.is_rest() && it.default().is_none())));
            }
            PatKind::Array(elements) if is_entered => {
                let is_plain = |it: PatElem<'a>| !it.is_rest() && it.default().is_none();
                let elements = elements.iter().rev();
                pending.extend(elements.filter_map(|it| Some((it.pat()?, is_plain(it)))));
            }
            PatKind::Missing => {}
            _ => callback(pat),
        }
    }
}

/// What `captureDoc` makes of the node that starts at `node`. `None`: no comments are before it, and it goes on to the next.
fn capture_doc<'a>(file: &'a File<'a>, node: u32) -> Option<Docs> {
    let comments: SmallVec<[Token<'a>; 4]> = file.comments_before(Span::empty(node)).collect();
    (!comments.is_empty()).then(|| Docs {
        jsdoc: capture_js_doc(file, &comments),
        tomdoc: capture_tom_doc(&comments),
    })
}

/// What is read of the tags of a comment.
struct Tags {
    /// The first whose title is `deprecated`: its description.
    deprecated: Option<Option<Arc<[u8]>>>,
    /// The title of one is `module`.
    has_module: bool,
}

/// `doctrine.parse(comment.value, { unwrap: true })`, as far as it is asked. doctrine ends at the first tag that it
/// cannot parse, and reads a comment that starts with one `*` too. Not so here.
fn tags_of<'a>(file: &'a File<'a>, comment: Token<'a>) -> Tags {
    let mut tags = Tags {
        deprecated: None,
        has_module: false,
    };
    let doc = file.jsdoc().at(comment.start());
    for tag in doc.into_iter().flat_map(|it| it.tags()) {
        match tag.kind.parsed() {
            b"deprecated" if tags.deprecated.is_none() => {
                let description = tag.comment().parsed_preserving_whitespace();
                let description = strings::trim_js_whitespace(&description);
                tags.deprecated = Some((!description.is_empty()).then(|| description.into()));
            }
            b"module" => tags.has_module = true,
            _ => {}
        }
    }
    tags
}

/// The last counts.
fn capture_js_doc<'a>(file: &'a File<'a>, comments: &[Token<'a>]) -> Option<Doc> {
    let mut blocks = comments.iter().rev();
    let last = blocks.find(|it| it.kind() == TokenKind::Block)?;
    Some(Doc {
        deprecated: tags_of(file, *last).deprecated,
    })
}

fn capture_tom_doc(comments: &[Token]) -> Option<Doc> {
    let values = comments
        .iter()
        .map(|it| strings::trim_js_whitespace(it.comment_value()));
    // "collect lines up to first paragraph break"
    let mut lines = values.take_while(|it| !it.is_empty());
    let first = lines.next()?;
    let statuses: [&[u8]; 3] = [b"Public:", b"Internal:", b"Deprecated:"];
    let status = statuses.into_iter().find(|it| first.starts_with(it))?;
    let mut joined = first[status.len()..].to_vec();
    for line in lines {
        joined.push(b' ');
        joined.extend_from_slice(line);
    }
    // `\s*(.+)`
    let rest = strings::trim_js_whitespace_start(&joined);
    let description = &rest[..strings::find_js_line_break(rest).map_or(rest.len(), |it| it.0)];
    (!description.is_empty()).then(|| Doc {
        deprecated: (status == b"Deprecated:").then(|| Some(description.into())),
    })
}

/// `range[0]` of the node of `body` that `stmt` is: of the `ExportNamedDeclaration` around a declaration.
fn start_of(stmt: Stmt) -> u32 {
    stmt.export_span().unwrap_or_else(|| stmt.span()).start
}

/// `id.name` of a declaration. `None`: it is a kind that has no `id`. `Some(None)`: the `id` is no `Identifier`.
fn id_name<'a>(declaration: Stmt<'a>) -> Option<Option<Name<'a>>> {
    let id = match declaration.kind() {
        StmtKind::Fn(it) => it.name(),
        StmtKind::Class(it) => it.name(),
        StmtKind::Interface(it) => Some(it.name()),
        StmtKind::TypeAlias(it) => Some(it.name()),
        StmtKind::Enum(it) => Some(it.name()),
        StmtKind::Module(it) => match it.name() {
            ModuleName::Ident(name) if it.nested().is_none() => Some(name),
            ModuleName::Global => return Some(Some(declaration.file().name_of("global"))),
            _ => None,
        },
        _ => return None,
    };
    Some(id.map(Ident::name))
}

/// `ImportExportVisitorBuilder`
struct Visitor<'a> {
    file: &'a File<'a>,
    export_map: ExportRecord,
    /// `Namespace.namespaces`
    namespaces: FxHashMap<Name<'a>, &'a [u8]>,
    /// The entries whose `namespace` looks a name up in `namespaces`, when it is asked.
    getters: Vec<(usize, Name<'a>)>,
    /// The statements of the file that `typeScriptExport` takes for declarations of a name.
    declarations: Option<FxHashMap<Name<'a>, SmallVec<[Stmt<'a>; 1]>>>,
    /// What `typeScriptExport` has exported the declarations of, and how much that was.
    exported: FxHashMap<(Name<'a>, When), usize>,
    said_again: usize,
    /// The names of one `importedSpecifiers`.
    imported: FxHashSet<Name<'a>>,
}

impl<'a> Visitor<'a> {
    /// `exportMap.namespace.set`. Where the entry is.
    fn set(&mut self, name: Option<&[u8]>, doc: Docs, when: When) -> usize {
        self.export_map.namespace.push(Entry {
            name: name.map(Box::from),
            doc,
            namespace_of: None,
            when,
        });
        self.export_map.namespace.len() - 1
    }

    /// `namespace.add`, to the entry at `object`.
    fn add(&mut self, object: usize, identifier: Name<'a>) {
        if self.namespaces.contains_key(&identifier) {
            self.getters.push((object, identifier));
        }
    }

    /// `source`: `None` if `stmt` has no `from`.
    fn capture_dependency(
        &mut self,
        stmt: Stmt<'a>,
        source: Option<&'a [u8]>,
        is_only_importing_types: bool,
        imported_specifiers: Vec<ImportedSpecifier>,
    ) {
        let (Some(specifier), Some(span)) = (source, stmt.module_specifier_span()) else {
            return;
        };
        let start = self.file.position(span.start);
        self.export_map.imports.push(Dependency {
            specifier: specifier.into(),
            line: start.line,
            column: start.column,
            is_only_importing_types,
            is_dynamic: false,
            imported_specifiers,
        });
    }

    /// `captureDependencyWithSpecifiers`, of an `ImportDeclaration`. An `ExportSpecifier` has nothing that it looks at.
    fn capture_dependency_with_specifiers(&mut self, stmt: Stmt<'a>, n: Import<'a>) {
        let named = n.named();
        let whole = [
            n.default().map(|_| ImportedSpecifier::Default),
            n.namespace().map(|_| ImportedSpecifier::Namespace),
        ];
        let mut imported_specifiers: Vec<_> = whole.into_iter().flatten().collect();
        let specifiers_only_importing_types = imported_specifiers.is_empty()
            && !named.is_empty()
            && named.iter().all(ImportSpec::is_type_only);
        self.imported.clear();
        for specifier in named {
            let imported = specifier.imported().name();
            if self.imported.insert(imported) {
                imported_specifiers.push(ImportedSpecifier::Named(imported.bytes().into()));
            }
        }
        self.capture_dependency(
            stmt,
            Some(n.spec().bytes()),
            n.is_type_only() || specifiers_only_importing_types,
            imported_specifiers,
        );
    }

    /// `processSpecifier`, of an `ExportSpecifier`.
    fn process_specifier(&mut self, specifier: ExportSpec<'a>, nsource: Option<&'a [u8]>) {
        let name_of = |it: Ident<'a>| (!it.is_string()).then(|| it.name());
        let (local, exported) = (name_of(specifier.local()), specifier.exported());
        let Some(source) = nsource else {
            let object = self.set(Some(exported.bytes()), Docs::default(), When::Always);
            if let Some(local) = local {
                self.add(object, local);
            }
            return;
        };
        self.export_map.reexports.push(Reexport {
            name: name_of(exported).map(|it| it.bytes().into()),
            local: local.map(|it| it.bytes().into()),
            source: source.into(),
        });
    }

    /// The names of a `VariableDeclaration`, each with the docs of its declarator.
    fn set_variables(
        &mut self,
        declarations: List<'a, VarDecl<'a>>,
        when: When,
        doc_of: &dyn Fn(VarDecl<'a>) -> Option<Docs>,
    ) {
        for d in declarations {
            let doc = doc_of(d).unwrap_or_default();
            recursive_pattern_capture(d.pat(), &mut |id| {
                self.set(id.as_ident().map(Name::bytes), doc.clone(), when);
            });
        }
    }

    /// `build(astNode)[astNode.type]()`
    fn visit(&mut self, ast_node: Stmt<'a>) {
        let (file, start) = (self.file, start_of(ast_node));
        match ast_node.kind() {
            StmtKind::ExportDefault(declaration) => {
                let export_meta = capture_doc(file, start).unwrap_or_default();
                let object = self.set(Some(DEFAULT), export_meta, When::Always);
                if let Some(identifier) = declaration.as_ident() {
                    self.add(object, identifier);
                }
            }
            StmtKind::ExportStar {
                spec,
                alias,
                type_only,
            } => {
                let source = spec.map_or(&b""[..], Name::bytes);
                self.capture_dependency(ast_node, Some(source), type_only, Vec::new());
                self.export_map.star_exports.push(source.into());
                if let Some(exported) = alias {
                    self.set(Some(exported.bytes()), Docs::default(), When::Always);
                }
            }
            StmtKind::Import(import) => {
                self.capture_dependency_with_specifiers(ast_node, import);
                if let Some(ns) = import.namespace() {
                    self.namespaces.insert(ns.name(), import.spec().bytes());
                }
            }
            StmtKind::ExportNamed(export) => {
                let source =
                    (export.has_from()).then(|| export.spec().map_or(&b""[..], Name::bytes));
                self.capture_dependency(ast_node, source, false, Vec::new());
                for specifier in export.items() {
                    self.process_specifier(specifier, source);
                }
            }
            StmtKind::ExportAssign(expression) => {
                let exported_name = match expression.kind() {
                    ExprKind::Ident(name) => Some(name),
                    ExprKind::Fn(it) => it.name().map(Ident::name),
                    ExprKind::Class(it) => it.name().map(Ident::name),
                    _ => None,
                };
                self.type_script_export(ast_node, exported_name, When::Always);
            }
            StmtKind::ExportAsNamespace(name) => {
                self.type_script_export(ast_node, Some(name), When::WithInterop);
            }
            _ if ast_node.is_default_export() => {
                let doc = capture_doc(file, start).unwrap_or_default();
                self.set(Some(DEFAULT), doc, When::Always);
            }
            StmtKind::Var(declarations) if ast_node.is_exported() => {
                let of_ast_node = capture_doc(file, start);
                self.set_variables(declarations, When::Always, &|d| {
                    capture_doc(file, d.span().start).or_else(|| of_ast_node.clone())
                });
            }
            _ if ast_node.is_exported() => {
                if let Some(name) = id_name(ast_node) {
                    let doc = capture_doc(file, start).unwrap_or_default();
                    self.set(name.map(Name::bytes), doc, When::Always);
                }
            }
            _ => {}
        }
    }

    /// `exportedDecls`
    fn exported_decls(&mut self, exported_name: Name<'a>) -> SmallVec<[Stmt<'a>; 1]> {
        let file = self.file;
        let declarations = self.declarations.get_or_insert_with(|| {
            let mut declarations: FxHashMap<Name<'a>, SmallVec<[Stmt<'a>; 1]>> =
                FxHashMap::default();
            for stmt in file.body().iter().filter(|it| !it.is_exported()) {
                let declare = |name: Name<'a>| {
                    let of_name = declarations.entry(name).or_default();
                    if of_name.last() != Some(&stmt) {
                        of_name.push(stmt);
                    }
                };
                match stmt.kind() {
                    StmtKind::Var(all) => all
                        .iter()
                        .filter_map(|d| d.pat().as_ident())
                        .for_each(declare),
                    StmtKind::Fn(it) if it.has_body() => {}
                    _ => id_name(stmt).flatten().into_iter().for_each(declare),
                }
            }
            declarations
        });
        declarations
            .get(&exported_name)
            .cloned()
            .unwrap_or_default()
    }

    /// "This doesn't declare anything, but changes what's being exported."
    fn type_script_export(
        &mut self,
        ast_node: Stmt<'a>,
        exported_name: Option<Name<'a>>,
        when: When,
    ) {
        let file = self.file;
        if let Some(&cost) = exported_name.and_then(|it| self.exported.get(&(it, when))) {
            self.said_again = self.said_again.saturating_add(cost);
            if self.said_again > SAID_AGAIN {
                return;
            }
        }
        let exported_decls = exported_name.map(|it| (it, self.exported_decls(it)));
        let Some((exported_name, exported_decls)) = exported_decls.filter(|it| !it.1.is_empty())
        else {
            // "Export is not referencing any local declaration, must be re-exporting"
            let doc = capture_doc(file, ast_node.span().start).unwrap_or_default();
            self.set(Some(DEFAULT), doc, when);
            return;
        };
        let (before, count) = (self.export_map.namespace.len(), exported_decls.len());
        self.set(Some(DEFAULT), Docs::default(), When::WithInteropIfAbsent);
        for decl in exported_decls {
            let of_decl = capture_doc(file, decl.span().start);
            let StmtKind::Module(module) = decl.kind() else {
                // "Export as default"
                self.set(Some(DEFAULT), of_decl.unwrap_or_default(), when);
                continue;
            };
            for module_block_node in module.body() {
                // "Export-assignment exports all members in the namespace, explicitly exported or not."
                let start = start_of(module_block_node);
                let name = match module_block_node.kind() {
                    StmtKind::Var(declarations) => {
                        let namespace_decl = module_block_node.span_without_export().start;
                        let doc = (of_decl.clone())
                            .or_else(|| capture_doc(file, namespace_decl))
                            .or_else(|| capture_doc(file, start));
                        self.set_variables(declarations, when, &|_| doc.clone());
                        continue;
                    }
                    StmtKind::ImportEquals(it) => Some(it.name().name()),
                    // Where there is no `id` upstream throws.
                    _ => match id_name(module_block_node) {
                        Some(name) => name,
                        None => continue,
                    },
                };
                let doc = capture_doc(file, start).unwrap_or_default();
                self.set(name.map(Name::bytes), doc, when);
            }
        }
        let cost = count + self.export_map.namespace.len() - before;
        self.exported.insert((exported_name, when), cost);
    }
}

/// `processDynamicImport`, of every `ImportExpression`. Whether there is one.
fn process_dynamic_imports<'a>(file: &'a File<'a>, imports: &mut Vec<Dependency>) -> bool {
    let mut has_dynamic_imports = false;
    let mut sources: SmallVec<[(u32, Name<'a>); 4]> = SmallVec::new();
    for e in file.exprs_of_kind(ExprTag::ImportCall) {
        has_dynamic_imports = true;
        if let ExprKind::ImportCall { args } = e.kind()
            && let Some(source) = args.first()
            && let Some(value) = source.as_string()
        {
            sources.push((source.span().start, value));
        }
    }
    utils::sort::sort_unstable_by_key(&mut sources, |it| it.0);
    imports.extend(sources.iter().map(|&(at, value)| {
        let start = file.position(at);
        Dependency {
            specifier: value.bytes().into(),
            line: start.line,
            column: start.column,
            is_only_importing_types: false,
            is_dynamic: true,
            imported_specifiers: vec![ImportedSpecifier::Namespace],
        }
    }));
    has_dynamic_imports
}

/// `ExportMapBuilder.parse`
pub(crate) fn read<'a>(file: &'a File<'a>) -> ExportRecord {
    let mut export_map = ExportRecord {
        path: file.path().into(),
        ..ExportRecord::default()
    };
    if let Some(err) = bun_lint::linter::parse_error(file) {
        let message = err.message.strip_prefix(b"Parsing error: ");
        export_map.errors.push(ParseError {
            message: message.unwrap_or(&err.message).into(),
            line: err.line,
            column: err.column,
        });
        return export_map;
    }
    let has_dynamic_imports = process_dynamic_imports(file, &mut export_map.imports);
    export_map.is_module = is_module(file);
    if !export_map.is_module && !has_dynamic_imports {
        export_map.is_null = true;
        return export_map;
    }
    // "attempt to collect module doc"
    let blocks = file.comments().filter(|it| it.kind() == TokenKind::Block);
    let with_tag = blocks.filter(|it| strings::contains(it.text(), b"@module"));
    let mut docs = with_tag.map(|it| tags_of(file, it));
    export_map.doc = docs.find(|it| it.has_module).map(|it| Doc {
        deprecated: it.deprecated,
    });
    let mut visitor = Visitor {
        file,
        export_map,
        namespaces: FxHashMap::default(),
        getters: Vec::new(),
        declarations: None,
        exported: FxHashMap::default(),
        said_again: 0,
        imported: FxHashSet::default(),
    };
    for ast_node in file.body() {
        visitor.visit(ast_node);
    }
    // With `esModuleInterop` the first entry is always set: `namespace.size > 0`.
    if !visitor.export_map.namespace.is_empty() {
        visitor.set(Some(DEFAULT), Docs::default(), When::WithInteropIfAbsent);
    }
    for (object, identifier) in visitor.getters {
        if let Some(entry) = visitor.export_map.namespace.get_mut(object) {
            entry.namespace_of = visitor.namespaces.get(&identifier).map(|it| (*it).into());
        }
    }
    visitor.export_map
}
