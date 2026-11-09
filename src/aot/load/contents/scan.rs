use std::ops::Range;

use bun_sema::bind::SymbolId;
use bun_sema::fold::{Constant, Decision, FoldedValue};
use bun_sema::hir::{BinOp, ExprId, ExprKind, File, PropKey};
use bun_sema::hir_from_data::DataValue;
use bun_sema::resolve::FinishedFile;
use bun_sema::util::SharedSort;

use super::FileContents;
use super::load_names::{find_modules_spelled_as_keys_in_data, find_modules_spelled_in_data};
use crate::builtins::table::{self, ExportLookup};
use crate::builtins::{BuiltinId, ResolvedBuiltins};
use crate::load::runtime_modules::RuntimeModules;

pub(crate) struct ScanInput<'a> {
    pub runtime_modules: &'a RuntimeModules,
    pub runs_tests: bool,
    pub loads_code_from_disk: bool,
    pub is_file: &'a dyn Fn(&[u8]) -> bool,
    pub is_data: &'a dyn Fn(&[u8]) -> bool,
    pub find_path_at_run_time: &'a dyn Fn(Option<usize>) -> Result<Vec<u8>, Range<usize>>,
    pub sees_backslashes: Option<bool>,
    pub write_url: &'a dyn Fn(&[u8], Option<&[u8]>) -> Option<Vec<u8>>,
}

pub(super) struct ContentsScan<'a, 's> {
    pub(super) request: &'a FinishedFile<'a, 's>,
    pub(super) builtins: &'a ResolvedBuiltins,
    pub(super) input: &'a ScanInput<'a>,
    pub(super) found: FileContents,
    pub(super) holders_of_own_file: Vec<SymbolId>,
    pub(super) levels_above_root: Option<usize>,
}

#[derive(Copy, Clone)]
struct WorkerConstructors {
    global: Option<BuiltinId>,
    of_node: Option<BuiltinId>,
}

impl WorkerConstructors {
    fn find() -> WorkerConstructors {
        let name = table::find_name(b"Worker");
        let threads = table::module_by_specifier(b"node:worker_threads");
        let of_node = match name.zip(threads) {
            Some((name, threads)) => table::find_export(table::namespace_of(threads), name),
            None => ExportLookup::Unlisted,
        };
        WorkerConstructors {
            global: name.and_then(table::global).map(table::canonical_id),
            of_node: match of_node {
                ExportLookup::Found(constructor) => Some(table::canonical_id(constructor)),
                ExportLookup::Unlisted | ExportLookup::HeldByNamespace => None,
            },
        }
    }

    fn has(self, builtin: BuiltinId) -> bool {
        let object = Some(table::canonical_id(builtin));
        object == self.global || object == self.of_node
    }
}

fn is_made_from_data(hir: &File<'_>) -> bool {
    hir.source_len == 0
}

impl ContentsScan<'_, '_> {
    fn look_at_folded_text(&mut self, expression: ExprId) {
        let &FinishedFile { hir, analysis, .. } = self.request;
        match analysis.decisions.constant(hir, expression) {
            FoldedValue::Constant(Constant::String(text))
            | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) => {
                self.look_at_text(expression, text);
            }
            FoldedValue::Constant(_)
            | FoldedValue::ConstantOutsideDeadZone(_)
            | FoldedValue::Unknown => {}
        }
    }

    fn look_at_folded_data(&mut self, expression: ExprId) {
        let Decision::Data(data) = self.request.analysis.decisions.decision(expression) else {
            return;
        };
        let mut pending = vec![*data];
        while let Some(value) = pending.pop() {
            match value {
                DataValue::String(text) => self.look_at_text_in_data(text),
                DataValue::Array(items) => pending.extend_from_slice(items),
                DataValue::Object(properties) => {
                    for &(key, value) in properties {
                        self.look_at_key(PropKey::Name(key));
                        pending.push(value);
                    }
                }
                DataValue::Undefined
                | DataValue::Null
                | DataValue::Boolean(_)
                | DataValue::Number(_)
                | DataValue::BigInt(_)
                | DataValue::Temporal { .. } => {}
            }
        }
    }

    fn look_at_expression(
        &mut self,
        expression: ExprId,
        kind: ExprKind,
        constructors: WorkerConstructors,
    ) {
        let hir = self.request.hir;
        match kind {
            ExprKind::String(text) => self.look_at_text(expression, text),
            ExprKind::Template { exprs } if exprs.is_empty() => {
                self.look_at_text(expression, hir.id_at(hir.template_texts(exprs), 0));
            }
            ExprKind::Template { .. } | ExprKind::Binary { op: BinOp::Add, .. } => {
                self.look_at_folded_text(expression);
            }
            ExprKind::New(_) => self.look_at_construction(expression),
            ExprKind::Object(properties) => self.look_at_keys(properties),
            ExprKind::Call(call) => {
                self.look_at_folded_text(expression);
                self.look_at_folded_data(expression);
                self.look_at_call(expression, call);
            }
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                self.look_at_folded_text(expression);
                let builtin = self.find_builtin_that_may_be_named(expression);
                if builtin.is_some_and(|builtin| constructors.has(builtin)) {
                    self.look_at_name_of_worker_constructor(expression);
                }
                if let Some(builtin) = builtin {
                    self.look_at_name_of_url_maker(expression, builtin);
                }
            }
            ExprKind::Missing
            | ExprKind::PrivateIdentifier(_)
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex { .. }
            | ExprKind::TaggedTemplate(_)
            | ExprKind::Array(_)
            | ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::Unary { .. }
            | ExprKind::Binary { .. }
            | ExprKind::Assign { .. }
            | ExprKind::Cond { .. }
            | ExprKind::Spread(_)
            | ExprKind::Await(_)
            | ExprKind::Yield { .. }
            | ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. }
            | ExprKind::Jsx(_)
            | ExprKind::ImportCall { .. }
            | ExprKind::ImportMeta
            | ExprKind::NewTarget(_)
            | ExprKind::JsxText(_) => {}
        }
    }
}

pub(crate) fn scan_file(
    request: &FinishedFile<'_, '_>,
    builtins: &ResolvedBuiltins,
    input: &ScanInput<'_>,
) -> FileContents {
    let &FinishedFile {
        hir,
        analysis,
        resolutions,
        ..
    } = request;
    if is_made_from_data(hir) {
        let mut found = FileContents::default();
        found.names.written_as_values = find_modules_spelled_in_data(request, input);
        found.names.written_as_keys = find_modules_spelled_as_keys_in_data(request, input);
        return found;
    }
    debug_assert_eq!(analysis.import_sites.len(), resolutions.len());
    let mut scan = ContentsScan {
        request,
        builtins,
        input,
        found: FileContents::default(),
        holders_of_own_file: Vec::new(),
        levels_above_root: None,
    };
    for index in 0..analysis.import_sites.len() {
        scan.look_at_site(index);
        scan.look_at_name_asked_of_resolver(index);
    }
    let constructors = WorkerConstructors::find();
    for (expression, node) in (0..).map(ExprId).zip(hir.exprs.iter()) {
        if !analysis.decisions.is_dead_expr(expression) {
            scan.look_at_expression(expression, node.kind, constructors);
        }
    }
    scan.look_at_names_of_own_file();
    scan.look_at_paths_written_from_own_folder();
    scan.look_at_loads_of_worker_threads();
    scan.look_at_constructions_behind_module_handed_on();
    scan.look_at_keys_of_classes();
    scan.finish_names();
    let starts = &mut scan.found.worker_starts;
    starts.shared_sort_unstable_by_key(|start| (hir[start.at].pos, start.at, start.name_node));
    starts.dedup();
    scan.found
}
