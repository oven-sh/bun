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

/// An import or an export from a module.
pub struct Entry<'a> {
    statement: Stmt<'a>,
    module: &'a [u8],
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

/// Where oxlint points: at the specifier of an import, at the first name of an export.
fn oxlint_place(statement: Stmt) -> Span {
    let place = match statement.kind() {
        StmtKind::Import(_) => statement.module_specifier_span(),
        StmtKind::ExportNamed(export) => export.items().first().map(|it| it.span()),
        _ => None,
    };
    place.unwrap_or_else(|| statement.span())
}

/// What oxlint knows of the names that have been imported from a module.
#[derive(Default)]
struct Imported {
    by_import_type: bool,
    by_other_imports: bool,
    /// Where the first statement is that imports a namespace, one that imports names, one that imports the default.
    namespace: Option<Span>,
    named: Option<Span>,
    default: Option<Span>,
}

impl Imported {
    /// oxlint's `can_merge_imports`. `first`: the sort of the first name of a statement, which is an `import type` if
    /// `is_type`.
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
    /// oxlint's rule without `includeExports`. It goes through the names that the statements of the file itself import,
    /// and compares the first name of a statement with all the names before. That name does not count later if the
    /// statement is reported. It looks at the imports without names only if the file has no others.
    fn check_imports_as_oxlint<'a>(&self, cx: &Cx<'a, Self>) {
        let imports = || {
            cx.file().body().iter().filter_map(|it| match it.kind() {
                StmtKind::Import(import) => Some((oxlint_place(it), import)),
                _ => None,
            })
        };
        let mut all: FxHashMap<Name<'a>, Imported> = FxHashMap::default();
        for (place, import) in imports() {
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
                cx.report(place, IMPORT).data("module", import.spec());
                match first {
                    Type::ImportDefault => default = false,
                    Type::Namespace => namespace = false,
                    _ => named -= 1,
                }
            }
            if default || namespace || named > 0 {
                imported.by_import_type |= is_type;
                imported.by_other_imports |= !is_type;
            }
            for (slot, is_imported) in [
                (&mut imported.default, default),
                (&mut imported.namespace, namespace),
                (&mut imported.named, named > 0),
            ] {
                if is_imported {
                    slot.get_or_insert(place);
                }
            }
        }
        if !all.is_empty() {
            return;
        }
        for (place, import) in imports() {
            if std::mem::replace(&mut all.entry(import.spec()).or_default().by_other_imports, true) {
                cx.report(place, IMPORT).data("module", import.spec());
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
        let module = text::trim(module.map_or(&[][..], Name::bytes));
        if !module.is_empty() {
            cx.state.push(Entry {
                statement,
                module,
                ty,
                is_type_only,
                is_export,
            });
        }
    }

    /// ESLint's `shouldReportImportExport`, with those of `previous` that are exports or that are
    /// imports.
    fn should_report(&self, entry: &Entry, previous: &[&Entry], exports: bool) -> bool {
        previous.iter().any(|it| {
            it.is_export == exports
                && (!self.allow_separate_type_imports || it.is_type_only == entry.is_type_only)
                && can_be_merged(entry, it)
        })
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut entries = std::mem::take(&mut cx.state);
        let is_oxlint = cx.language().is_oxlint;
        if is_oxlint && !self.include_exports {
            if !entries.is_empty() {
                self.check_imports_as_oxlint(cx);
            }
            return;
        }
        // oxlint looks at the imports without names only if the file has no others.
        let is_import_of_names = |it: &Entry| !it.is_export && it.ty != Type::SideEffectImport;
        if is_oxlint && entries.iter().any(is_import_of_names) {
            entries.retain(|it| it.is_export || it.ty != Type::SideEffectImport);
        }
        // oxlint goes through all the imports of a file before its exports.
        let is_later = |it: &Entry| is_oxlint && it.is_export;
        utils::sort::sort_unstable_by(&mut entries, |a, b| {
            (a.module.cmp(b.module))
                .then_with(|| is_later(a).cmp(&is_later(b)))
                .then_with(|| a.statement.span().start.cmp(&b.statement.span().start))
        });
        for of_module in entries.chunk_by(|a, b| a.module == b.module) {
            // Of those before `entry`, one of each sort, of which there are 20.
            let mut previous: SmallVec<[&Entry; 4]> = SmallVec::new();
            for entry in of_module {
                let messages = match entry.is_export {
                    true => [(EXPORT, true), (EXPORT_AS, false)],
                    false => [(IMPORT, false), (IMPORT_AS, true)],
                };
                for (message, exports) in messages {
                    if self.should_report(entry, &previous, exports) {
                        let place = if is_oxlint { oxlint_place(entry.statement) } else { entry.statement.span() };
                        cx.report(place, message).data("module", entry.module);
                        // oxlint says one thing about a statement.
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

impl Rule for NoDuplicateImports {
    const META: Meta = Meta::eslint("no-duplicate-imports", Kind::Problem);
    type State<'a> = Vec<Entry<'a>>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoDuplicateImports {
            include_exports: options.bool_or("includeExports", false),
            allow_separate_type_imports: options.bool_or("allowSeparateTypeImports", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Vec<Entry<'a>> {
        on.stmts([StmtTag::Import], Self::collect);
        if self.include_exports {
            on.stmts([StmtTag::ExportNamed, StmtTag::ExportStar], Self::collect);
        }
        on.finish(Self::finish);
        Vec::new()
    }
}
