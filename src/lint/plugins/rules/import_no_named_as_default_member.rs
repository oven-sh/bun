use crate::import_export_map::{ExportMap, ExportMaps, PARSE_ERRORS};
use bun_lint_oxlint::ast_util::static_property_name;
use bun_lint_oxlint::import::{ImportImportName, import_entries};
use bun_lint_oxlint::module_record::{Loaded, debug, get_loaded_module, is_waiting_for_modules};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::cell::OnceCell;

/// Forbid use of exported name as property of default export.
pub struct NoNamedAsDefaultMember;

const CAUTION: Message = Message::new(
    "",
    "Caution: `{{objectName}}` also has a named export `{{propName}}`. Check if you meant to write `import {{{propName}}} from '{{sourcePath}}'` instead.",
);
const OXLINT: Message = Message::new("", "{{module_name}} also has a named export {{export_name}}");

pub struct State<'a> {
    /// `None`: oxlint asks its own records.
    maps: Option<ExportMaps<'a>>,
}

/// The module that a default import is from.
#[derive(Copy, Clone)]
enum Remote<'a> {
    Oxlint(Loaded<'a>),
    ExportMap(ExportMap<'a>),
}

/// A value of upstream's `fileImports`.
struct FileImport<'a> {
    remote: Remote<'a>,
    source_path: Name<'a>,
    /// `exportMap.namespace.has(undefined)`
    has_undefined: OnceCell<bool>,
}

impl Rule for NoNamedAsDefaultMember {
    const META: Meta = Meta::plugin(Plugin::Import, "no-named-as-default-member", Kind::Suggestion)
        .needs_modules()
        .reports_at_the_end();
    const ON: On = On::new().finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoNamedAsDefaultMember
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        if file.language().is_oxlint {
            return (!is_waiting_for_modules(file) && file.modules().is_some()).then_some(State { maps: None });
        }
        if !file.has_stmts([StmtTag::Import]) {
            return None;
        }
        Some(State { maps: Some(ExportMaps::of(file)?) })
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let Some(maps) = &cx.state.maps else {
            // Once, if a name is declared several times.
            let mut seen = FxHashSet::default();
            for entry in import_entries(file).filter(|it| seen.insert(it.local_name().name())) {
                let ImportImportName::Default(local) = entry.import_name else {
                    continue;
                };
                let Some(remote) = get_loaded_module(file, entry.declaration.spec().bytes()) else {
                    continue;
                };
                if remote.record.exported_bindings.is_empty() {
                    continue;
                }
                let Some(symbol) = file.top_level_scope().get_name(local.name()) else {
                    return;
                };
                let file_import = FileImport::new(Remote::Oxlint(remote), entry.declaration.spec());
                // oxlint looks at what means the import, and is not in parentheses.
                for ident in symbol.references().filter_map(Reference::expr).filter(|it| !it.is_parenthesized()) {
                    file_import.check(ident, cx);
                }
            }
            return;
        };
        let file_imports = file_imports(maps, cx);
        if file_imports.is_empty() {
            return;
        }
        // Upstream looks at whatever has the name of the import.
        for ident in file.exprs_of_kind(ExprTag::Ident) {
            if let Some(file_import) = ident.as_ident().and_then(|it| file_imports.get(&it)) {
                file_import.check(ident, cx);
            }
        }
        // What an interface extends and a class implements is a `MemberExpression` for typescript-eslint.
        let interfaces = file.stmts_of_kind(StmtTag::Interface).filter_map(|it| match it.kind() {
            StmtKind::Interface(interface) => Some(interface.extends()),
            _ => None,
        });
        for heritage in interfaces.chain(file.classes().map(Class::implements)).flatten() {
            if let TypeKind::Ref { name, .. } = heritage.kind()
                && let (Some(object), Some(property)) = (name.get(0), name.get(1))
                && let Some(file_import) = file_imports.get(&object.name())
            {
                file_import.report(object.span().to(property.span()), object.bytes(), Some(property.bytes()), cx);
            }
        }
    }
}

/// Upstream's `fileImports`: of two imports of a name the last counts. It reports the modules that cannot be parsed.
fn file_imports<'a>(maps: &ExportMaps<'a>, cx: &Cx<'a, NoNamedAsDefaultMember>) -> FxHashMap<Name<'a>, FileImport<'a>> {
    let declarations = cx.file().stmts_of_kind(StmtTag::Import).filter_map(|it| match it.kind() {
        StmtKind::Import(declaration) => Some((declaration, declaration.default()?)),
        _ => None,
    });
    let mut declarations: SmallVec<[(Import<'a>, Ident<'a>); 8]> = declarations.collect();
    utils::sort::sort_unstable_by_key(&mut declarations, |it| it.1.start());
    let mut file_imports = FxHashMap::default();
    for (declaration, local) in declarations {
        let source_path = declaration.spec();
        let Some(export_map) = maps.get(source_path.bytes()) else {
            continue;
        };
        if !export_map.has_errors() {
            file_imports.insert(local.name(), FileImport::new(Remote::ExportMap(export_map), source_path));
        } else if let Some(at) = declaration.spec_span() {
            cx.report(at, PARSE_ERRORS)
                .data("source", source_path)
                .data("errors", export_map.errors_text())
                .on_exit(false);
        }
    }
    file_imports
}

/// `namespace.has(undefined)`: upstream has read the `name` of a node that has none, as in `export namespace A.B {}`.
/// Among the names that key is the text `undefined`.
fn has_undefined_key<'a>(maps: &ExportMaps<'a>, export_map: ExportMap<'a>) -> bool {
    let written = usize::from(maps.namespace_has(export_map, b"undefined"));
    maps.namespace_names(export_map).iter().filter(|it| ***it == *b"undefined").count() > written
}

impl<'a> FileImport<'a> {
    fn new(remote: Remote<'a>, source_path: Name<'a>) -> Self {
        FileImport { remote, source_path, has_undefined: OnceCell::new() }
    }

    /// `ident`: the import, where a property of it is looked up.
    fn check(&self, ident: Expr<'a>, cx: &Cx<'a, NoNamedAsDefaultMember>) {
        let is_oxlint = matches!(self.remote, Remote::Oxlint(_));
        // oxlint quotes the name as it is written.
        let object_name = match ident.as_ident() {
            Some(name) if !is_oxlint => name.bytes(),
            _ => ident.text(),
        };
        match ident.parent() {
            Node::Expr(member)
                if member.object() == Some(ident) && !member.is_jsx_tag_name() && !member.is_in_type_query() =>
            {
                // oxlint takes `a["b"]` for `a.b`. Upstream reads the `name` of the property: `a[b]`, `a.#b`.
                let prop_name = if is_oxlint {
                    static_property_name(member).map(Name::bytes)
                } else if let Some(property) = member.member_name() {
                    Some(property.bytes().strip_prefix(b"#").unwrap_or_else(|| property.bytes()))
                } else {
                    member.index().and_then(Expr::as_ident).map(Name::bytes)
                };
                self.report(member.span(), object_name, prop_name, cx);
            }
            Node::VarDecl(declarator) if declarator.init() == Some(ident) => {
                let PatKind::Object(properties) = declarator.pat().kind() else {
                    return;
                };
                for key in properties.iter().filter_map(PatProp::key) {
                    // oxlint points at the declarator, and takes `{ "b": c }` for `{ b: c }`. Upstream: `{ [b]: c }`.
                    let (at, prop_name) = if is_oxlint {
                        (declarator.span(), key.name())
                    } else {
                        let name = match key.kind() {
                            KeyKind::Ident(name) => Some(name),
                            KeyKind::Computed(e) => e.as_ident(),
                            _ => None,
                        };
                        (key.inner_span(cx.file()), name)
                    };
                    self.report(at, object_name, prop_name.map(Name::bytes), cx);
                }
            }
            _ => {}
        }
    }

    /// `prop_name`: `None` where the property has no `name`: `a["b"]`, `a[0]`, `{ "b": c }`.
    fn report(
        &self,
        at: Span,
        object_name: &'a [u8],
        prop_name: Option<&'a [u8]>,
        cx: &Cx<'a, NoNamedAsDefaultMember>,
    ) {
        match (self.remote, &cx.state.maps) {
            (Remote::Oxlint(remote), _) => {
                if let Some(prop_name) = prop_name.filter(|it| remote.exports(it)) {
                    cx.report(at, OXLINT)
                        .data("module_name", debug(object_name))
                        .data("export_name", debug(prop_name))
                        .data("export", prop_name)
                        .data("suggested_module_name", debug(self.source_path.bytes()))
                        .on_exit(false);
                }
            }
            (Remote::ExportMap(export_map), Some(maps)) => {
                let is_exported = match prop_name {
                    // "the default import can have a "default" property"
                    Some(b"default") => false,
                    Some(prop_name) => maps.namespace_has(export_map, prop_name),
                    None => *self.has_undefined.get_or_init(|| has_undefined_key(maps, export_map)),
                };
                if is_exported {
                    cx.report(at, CAUTION)
                        .data("objectName", object_name)
                        .data("propName", prop_name.unwrap_or(&b"undefined"[..]))
                        .data("sourcePath", self.source_path);
                }
            }
            _ => {}
        }
    }
}
