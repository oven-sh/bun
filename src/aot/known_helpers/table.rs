use super::canonical::{
    CanonicalBody, CanonicalInput, OuterName, canonical_body, canonical_function,
    canonical_statement,
};
use super::find::FindInput;
use super::published::PUBLISHED_FUNCTIONS;
use super::{PublishedFunction, Reference, Shape};
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{BindOptions, RuntimeBindOptions};
use bun_sema::file_analysis::{FileInputs, analyze_file};
use bun_sema::fold::{FoldInputs, FoldOptions};
use bun_sema::hir::{self, ExprId, ExprKind, Flags, FnId, FnKind, StmtId, StmtKind};
use bun_sema::import_sites::JsxMode;
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::session::Session;
use bun_sema::util::{FxHashMap, FxHashSet};
use bun_sema_parser::{CompileParseOptions, parse_for_compile};
use std::borrow::Cow;
use std::sync::OnceLock;

const MAX_PUBLISHED_BYTES: usize = 1 << 16;

pub(super) type Signature = [u8; 4];

pub(super) struct TableEntry {
    pub(super) shape: Shape,
    pub(super) references: Box<[Reference]>,
}

#[derive(Default)]
pub(super) struct Table {
    pub(super) entries: FxHashMap<Box<[u8]>, TableEntry>,
    pub(super) signatures: FxHashSet<Signature>,
    pub(super) max_bytes: usize,
}

impl Table {
    pub(super) fn get() -> &'static Table {
        static TABLE: OnceLock<Table> = OnceLock::new();
        TABLE.get_or_init(|| Table::read(PUBLISHED_FUNCTIONS).0)
    }

    pub(super) fn read(published: &[PublishedFunction]) -> (Table, Vec<usize>) {
        let mut source = String::new();
        for function in published {
            source.push_str("var published = ");
            source.push_str(function.text);
            source.push_str(";\n");
        }
        analyze("/published.cjs", &source, |file| {
            let (hir, atoms) = (file.hir, file.atoms);
            let mut table = Table::default();
            let mut rejected = Vec::new();
            if hir.has_errors || hir.has_parse_diagnostics || hir.body.len() != published.len() {
                return (table, (0..published.len()).collect());
            }
            for (index, (function, statement)) in
                published.iter().zip(hir.ids(hir.body)).enumerate()
            {
                let names: Vec<Atom> = function
                    .references
                    .iter()
                    .map(|reference| atoms.intern(reference.0.as_bytes()))
                    .collect();
                let input = CanonicalInput {
                    file,
                    max_bytes: MAX_PUBLISHED_BYTES,
                    is_outer_name: &|name| names.contains(&name),
                };
                let root = find_published_function(hir, statement);
                let canonical =
                    root.and_then(|root| Some((root, canonical_function(&input, root)?)));
                let Some((root, canonical)) = canonical else {
                    rejected.push(index);
                    continue;
                };
                let references: Option<Box<[Reference]>> = canonical
                    .outer_names
                    .iter()
                    .map(|&outer| match outer {
                        OuterName::Free(name) => {
                            let at = names.iter().position(|&known| known == name)?;
                            Some(function.references[at].1)
                        }
                        OuterName::Symbol(_) => None,
                    })
                    .collect();
                let references =
                    references.filter(|found| found.len() == function.references.len());
                let Some(references) = references else {
                    rejected.push(index);
                    continue;
                };
                table.max_bytes = table.max_bytes.max(canonical.bytes.len());
                table.signatures.insert(signature_of(hir, root));
                let entry = TableEntry {
                    shape: function.shape,
                    references,
                };
                let previous = table.entries.get(canonical.bytes.as_slice());
                let is_contradicted = previous.is_some_and(|previous| {
                    previous.shape != entry.shape || previous.references != entry.references
                });
                if is_contradicted {
                    rejected.push(index);
                    continue;
                }
                table
                    .entries
                    .insert(canonical.bytes.into_boxed_slice(), entry);
            }
            (table, rejected)
        })
    }
}

pub(super) fn analyze<R>(
    path: &str,
    source: &str,
    then: impl FnOnce(&FindInput<'_, '_>) -> R,
) -> R {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let arena = session.arena();
    let parse_options = CompileParseOptions {
        path: path.as_bytes(),
        script_kind: None,
        experimental_decorators: false,
        every_file_is_a_module: false,
        reads_jsdoc: false,
        keeps_function_directives: false,
    };
    let mut hir = parse_for_compile(arena, &parse_options, source.as_bytes(), &atoms);
    hir.text = Cow::Borrowed(source.as_bytes());
    let fold = FoldInputs::new(FoldOptions::default(), arena);
    let bind_options = BindOptions {
        runtime: Some(RuntimeBindOptions {
            jsx_factory_root: None,
            jsx_fragment_root: None,
            emits_decorator_metadata: false,
            hoists_top_level_variables: false,
        }),
        ..BindOptions::default()
    };
    let file = FileInputs {
        declared_module_type: match path.ends_with(".cjs") {
            true => DeclaredModuleType::CommonJs,
            false => DeclaredModuleType::Unknown,
        },
        import_meta_main: None,
        is_library: false,
        host_values: &[],
        jsx: JsxMode::Classic,
    };
    let (bound, analysis) = analyze_file(&mut hir, bind_options, &fold, file, &atoms, arena);
    then(&FindInput {
        atoms: &atoms,
        hir: &hir,
        bound: &bound,
        decisions: &analysis.decisions,
        module_format: analysis.module_format,
        is_held_early: &|| true,
    })
}

pub(super) fn find_published_function(hir: &hir::File<'_>, statement: StmtId) -> Option<FnId> {
    let StmtKind::Var(declarations) = hir[statement].kind else {
        return None;
    };
    let declaration = declarations.iter().next()?;
    match hir[hir[declaration].init].kind {
        ExprKind::Fn(function) => Some(function),
        _ => None,
    }
}

fn start_of_expression(hir: &hir::File<'_>, expression: ExprId) -> u8 {
    match hir[hir.skip_type_assertions(expression)].kind {
        ExprKind::Call(_) => 1,
        ExprKind::New(_) => 2,
        ExprKind::Cond { .. } => 3,
        ExprKind::Binary { .. } => 4,
        ExprKind::Assign { .. } => 5,
        ExprKind::Object(_) => 6,
        ExprKind::Array(_) => 7,
        ExprKind::Fn(_) => 8,
        ExprKind::Dot { .. } | ExprKind::Index { .. } => 9,
        _ => 0,
    }
}

fn start_of_statement(hir: &hir::File<'_>, statement: StmtId) -> u8 {
    match hir[canonical_statement(hir, statement)].kind {
        StmtKind::Expr(_) => 1,
        StmtKind::Var(_) => 2,
        StmtKind::Return(_) => 3,
        StmtKind::If { .. } => 4,
        StmtKind::For { .. } => 5,
        StmtKind::ForIn { .. } => 6,
        StmtKind::ForOf { .. } => 7,
        StmtKind::While { .. } => 8,
        StmtKind::DoWhile { .. } => 9,
        StmtKind::Switch { .. } => 10,
        StmtKind::Try { .. } => 11,
        StmtKind::Throw(_) => 12,
        StmtKind::Fn(_) => 13,
        StmtKind::Block(statements) if !statements.is_empty() => 14,
        _ => 0,
    }
}

pub(super) fn signature_of(hir: &hir::File<'_>, function: FnId) -> Signature {
    let record = hir[function];
    let (statement_count, start) = match canonical_body(hir, function) {
        CanonicalBody::Missing => (0, 0),
        CanonicalBody::Expression(body) => (u8::MAX, start_of_expression(hir, body)),
        CanonicalBody::Statements(statements) => {
            let first = hir.ids(statements).next();
            let start = first.map_or(0, |first| start_of_statement(hir, first));
            (statements.len().min(usize::from(u8::MAX) - 1) as u8, start)
        }
    };
    let is_arrow = record.kind == FnKind::Arrow;
    let is_async = record.flags.contains(Flags::ASYNC);
    let is_generator = record.flags.contains(Flags::GENERATOR);
    let parameter_count = record.params.len().min(usize::from(u8::MAX)) as u8;
    let kind = u8::from(is_arrow) | u8::from(is_async) << 1 | u8::from(is_generator) << 2;
    [parameter_count, statement_count, kind, start]
}
