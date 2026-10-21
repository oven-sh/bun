use bun_core::strings;
use bun_lint::prelude::*;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Disallow duplicate module imports.
pub struct NoDuplicateImports {
    include_exports: bool,
    allow_separate_type_imports: bool,
}

const IMPORT: Message = Message::new("import", "'{{module}}' import is duplicated.");
const IMPORT_AS: Message = Message::new("importAs", "'{{module}}' import is duplicated as export.");
const EXPORT: Message = Message::new("export", "'{{module}}' export is duplicated.");
const EXPORT_AS: Message = Message::new("exportAs", "'{{module}}' export is duplicated as import.");

/// ESLint's `getImportExportType`.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Type {
    /// `ImportSpecifier`, `ExportSpecifier`
    Named,
    /// `ImportNamespaceSpecifier`, `ExportNamespaceSpecifier`
    Namespace,
    ImportDefault,
    ExportAll,
    SideEffectImport,
}

/// An import or export from a module.
pub struct Entry<'a> {
    statement: Stmt<'a>,
    module: &'a [u8],
    /// The atom number of the module's name, if that name equals `module`, meaning nothing was trimmed off it.
    name: Option<u32>,
    ty: Type,
    is_type_only: bool,
    is_export: bool,
}

/// ESLint's `isImportExportCanBeMerged`.
fn can_be_merged(a: &Entry, b: &Entry) -> bool {
    let is_pair = |x: Type, y: Type| a.ty == x && b.ty == y || b.ty == x && a.ty == y;
    let has_bindings = |ty: Type| ty != Type::ExportAll && ty != Type::SideEffectImport;
    !(a.is_type_only && b.is_type_only && is_pair(Type::ImportDefault, Type::Named)
        || a.ty == Type::ExportAll && has_bindings(b.ty)
        || b.ty == Type::ExportAll && has_bindings(a.ty)
        || is_pair(Type::Namespace, Type::Named))
}

const MERGED_WITH_IMPORT: &str = "Can be merged with this import";

/// Where oxlint reports: at an import's specifier, or at an export's first name.
fn oxlint_report_span(statement: Stmt) -> Span {
    let specific_span = match statement.kind() {
        StmtKind::Import(_) => statement.module_specifier_span(),
        StmtKind::ExportNamed(export) => export.items().first().map(|it| it.span()),
        _ => None,
    };
    specific_span.unwrap_or_else(|| statement.span())
}

/// oxlint's state for the names imported from a module so far.
#[derive(Default)]
struct Imported<'a> {
    by_import_type: bool,
    by_other_imports: bool,
    /// The first statement that counts.
    first: Option<Stmt<'a>>,
    /// The first statements that import a namespace, names, and the default.
    namespace: Option<Stmt<'a>>,
    named: Option<Stmt<'a>>,
    default: Option<Stmt<'a>>,
}

impl Imported<'_> {
    /// oxlint's `can_merge_imports`. `first` is the kind of a statement's first name. `is_type` means the statement is
    /// an `import type`.
    fn can_merge(&self, first: Type, is_type: bool, allow_separate_type_imports: bool) -> bool {
        if is_type
            && !self.by_other_imports
            && (first == Type::ImportDefault && self.named.is_some() || first == Type::Named && self.default.is_some())
        {
            return false;
        }
        let is_separate = match is_type {
            true => self.by_other_imports && !self.by_import_type,
            false => self.by_import_type,
        };
        if allow_separate_type_imports && is_separate {
            return false;
        }
        match first {
            Type::Named => self.named.is_some() || self.default.is_some() && self.default != self.namespace,
            Type::Namespace => {
                (self.namespace.is_some() || self.default.is_some())
                    && !(self.named.is_some() && self.named == self.default)
            }
            _ => true,
        }
    }
}

impl NoDuplicateImports {
    /// oxlint's rule without `includeExports`. It walks the names imported by the file's top-level statements, and
    /// compares each statement's first name with all the names before it. If the statement is reported, that name
    /// doesn't count later. It only looks at imports without names if the file has no other imports.
    fn check_imports_as_oxlint<'a>(&self, cx: &Cx<'a, Self>) {
        let imports = || {
            cx.file().body().iter().filter_map(|it| Some((it, it.as_import()?)))
        };
        // A module that's imported only once can't be reported.
        let mut modules: SmallVec<[u32; 32]> = imports().map(|it| it.1.spec().atom().0).collect();
        modules.sort_unstable();
        if modules.iter().zip(modules.iter().skip(1)).all(|(a, b)| a != b) {
            return;
        }
        let mut all: FxHashMap<Name<'a>, Imported<'a>> = FxHashMap::default();
        for (statement, import) in imports() {
            let (mut default, mut namespace) = (import.default().is_some(), import.namespace().is_some());
            let mut named = import.named().len();
            let first = match (default, namespace, named) {
                (true, ..) => Type::ImportDefault,
                (_, true, _) => Type::Namespace,
                (_, _, 1..) => Type::Named,
                _ => continue,
            };
            let (imported, is_type) = (all.entry(import.spec()).or_default(), import.is_type_only());
            let has_names = imported.by_import_type || imported.by_other_imports;
            if has_names && imported.can_merge(first, is_type, self.allow_separate_type_imports) {
                cx.report(oxlint_report_span(statement), IMPORT).data("module", import.spec()).labels_with(|labels| {
                    labels.push(imported.first.map(oxlint_report_span).unwrap_or_default(), MERGED_WITH_IMPORT)
                });
                match first {
                    Type::ImportDefault => default = false,
                    Type::Namespace => namespace = false,
                    _ => named -= 1,
                }
            }
            if default || namespace || named > 0 {
                imported.by_import_type |= is_type;
                imported.by_other_imports |= !is_type;
                imported.first.get_or_insert(statement);
            }
            for (slot, is_imported) in [
                (&mut imported.default, default),
                (&mut imported.namespace, namespace),
                (&mut imported.named, named > 0),
            ] {
                if is_imported {
                    slot.get_or_insert(statement);
                }
            }
        }
        if !all.is_empty() {
            return;
        }
        for (statement, import) in imports() {
            let first = *all.entry(import.spec()).or_default().first.get_or_insert(statement);
            if first != statement {
                cx.report(oxlint_report_span(statement), IMPORT)
                    .data("module", import.spec())
                    .labels_with(|labels| labels.push(oxlint_report_span(first), MERGED_WITH_IMPORT));
            }
        }
    }

    fn collect<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let (module, ty, is_type_only, is_export) = match statement.kind() {
            StmtKind::Import(import) => {
                let ty = if import.namespace().is_some() {
                    Type::Namespace
                } else if !import.named().is_empty() {
                    Type::Named
                } else if import.default().is_some() {
                    Type::ImportDefault
                } else {
                    Type::SideEffectImport
                };
                (Some(import.spec()), ty, import.is_type_only(), false)
            }
            StmtKind::ExportNamed(export) => {
                let ty = match export.items().is_empty() {
                    true => Type::SideEffectImport,
                    false => Type::Named,
                };
                (export.spec(), ty, export.is_type_only(), true)
            }
            StmtKind::ExportStar { spec, alias, type_only } => {
                let ty = match alias {
                    Some(_) => Type::Namespace,
                    None => Type::ExportAll,
                };
                (spec, ty, type_only, true)
            }
            _ => return,
        };
        let raw_module = module.map_or(&[][..], Name::bytes);
        let (name, module) = (module.map(|it| it.atom().0), strings::trim_js_whitespace(raw_module));
        if !module.is_empty() {
            cx.state.push(Entry {
                statement,
                module,
                name: name.filter(|_| module.len() == raw_module.len()),
                ty,
                is_type_only,
                is_export,
            });
        }
    }

    /// ESLint's `shouldReportImportExport`, against either the exports or the imports in `previous`.
    fn should_report(&self, entry: &Entry, previous: &[&Entry], exports: bool) -> bool {
        previous.iter().any(|it| {
            it.is_export == exports
                && (!self.allow_separate_type_imports || it.is_type_only == entry.is_type_only)
                && can_be_merged(entry, it)
        })
    }
}

impl Rule for NoDuplicateImports {
    const META: Meta = Meta::eslint("no-duplicate-imports", Kind::Problem);
    const ON: On = On::new().stmts(&[StmtTag::Import, StmtTag::ExportNamed, StmtTag::ExportStar]).finish();
    type State<'a> = Vec<Entry<'a>>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoDuplicateImports {
            include_exports: options.bool_or("includeExports", false),
            allow_separate_type_imports: options.bool_or("allowSeparateTypeImports", false),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        match self.include_exports {
            true => On::new().stmts(&[StmtTag::Import, StmtTag::ExportNamed, StmtTag::ExportStar]).finish(),
            false if file.language().is_oxlint => On::new().finish(),
            false => On::new().stmts(&[StmtTag::Import]).finish(),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Vec<Entry<'a>>> {
        let has_any = file.has_stmts([StmtTag::Import])
            || self.include_exports && file.has_stmts([StmtTag::ExportNamed, StmtTag::ExportStar]);
        has_any.then(Vec::new)
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        self.collect(statement, cx);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut entries = std::mem::take(&mut cx.state);
        let is_oxlint = cx.language().is_oxlint;
        if is_oxlint && !self.include_exports {
            let has_module_name = |it: Stmt| {
                it.as_import().is_some_and(|import| !strings::trim_js_whitespace(import.spec().bytes()).is_empty())
            };
            if cx.file().stmts_of_kind(StmtTag::Import).any(has_module_name) {
                self.check_imports_as_oxlint(cx);
            }
            return;
        }
        // A module that's mentioned only once can't be reported.
        let mut names: SmallVec<[u32; 32]> = entries.iter().filter_map(|it| it.name).collect();
        names.sort_unstable();
        if names.len() == entries.len() && names.iter().zip(names.iter().skip(1)).all(|(a, b)| a != b) {
            return;
        }
        // oxlint only looks at imports without names if the file has no other imports.
        let imports_names = |it: &Entry| !it.is_export && it.ty != Type::SideEffectImport;
        if is_oxlint && entries.iter().any(imports_names) {
            entries.retain(|it| it.is_export || it.ty != Type::SideEffectImport);
        }
        // oxlint visits all of a file's imports before its exports.
        let is_later = |it: &Entry| is_oxlint && it.is_export;
        utils::sort::sort_by(&mut entries, |a, b| {
            (a.module.cmp(b.module))
                .then_with(|| is_later(a).cmp(&is_later(b)))
                .then_with(|| a.statement.span().start.cmp(&b.statement.span().start))
        });
        for module_entries in entries.chunk_by(|a, b| a.module == b.module) {
            // One entry of each kind among those before `entry`. There are 20 kinds.
            let mut previous: SmallVec<[&Entry; 4]> = SmallVec::new();
            for entry in module_entries {
                let messages = match entry.is_export {
                    true => [(EXPORT, true), (EXPORT_AS, false)],
                    false => [(IMPORT, false), (IMPORT_AS, true)],
                };
                for (message, exports) in messages {
                    if self.should_report(entry, &previous, exports) {
                        let report_span = if is_oxlint { oxlint_report_span(entry.statement) } else { entry.statement.span() };
                        cx.report(report_span, message).data("module", entry.module).labels_with(|labels| {
                            let first = module_entries.first().map(|it| oxlint_report_span(it.statement)).unwrap_or_default();
                            let is_import = message.id == IMPORT.id;
                            labels.push(first, if is_import { MERGED_WITH_IMPORT } else { "Can be merged with this" });
                        });
                        // oxlint reports a statement only once.
                        if is_oxlint {
                            break;
                        }
                    }
                }
                let is_same_sort = |it: &&Entry| {
                    it.ty == entry.ty && it.is_type_only == entry.is_type_only && it.is_export == entry.is_export
                };
                if !previous.iter().any(is_same_sort) {
                    previous.push(entry);
                }
            }
        }
    }
}
