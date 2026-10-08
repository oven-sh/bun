use bun_lint::prelude::*;

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

impl NoDuplicateImports {
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
    fn should_report(&self, entry: &Entry, previous: &[Entry], exports: bool) -> bool {
        previous.iter().any(|it| {
            it.is_export == exports
                && (!self.allow_separate_type_imports || it.is_type_only == entry.is_type_only)
                && can_be_merged(entry, it)
        })
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut entries = std::mem::take(&mut cx.state);
        entries.sort_unstable_by(|a, b| {
            (a.module.cmp(b.module)).then_with(|| a.statement.span().start.cmp(&b.statement.span().start))
        });
        for of_module in entries.chunk_by(|a, b| a.module == b.module) {
            for (i, entry) in of_module.iter().enumerate().skip(1) {
                let previous = &of_module[..i];
                let messages = match entry.is_export {
                    true => [(EXPORT, true), (EXPORT_AS, false)],
                    false => [(IMPORT, false), (IMPORT_AS, true)],
                };
                for (message, exports) in messages {
                    if self.should_report(entry, previous, exports) {
                        cx.report(entry.statement, message).data("module", entry.module);
                    }
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
