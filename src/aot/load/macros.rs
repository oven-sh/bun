
use crate::diagnostic_codes::Code;
use crate::diagnostics::{FileDiagnostic, LoadMessages, range_of_node};
use crate::load::is_in_node_modules;
use crate::load::source_provider::{MacroCall, SourceProvider};
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{Bound, Decl, SymbolId};
use bun_sema::fold::{FoldedData, data_value_of};
use bun_sema::hir::{Call, ExprId, ExprKind, File, ImportId};
use bun_sema::hir_from_data::{DataValue, HostValue};
use bun_sema::import_sites::macro_callee;
use bun_sema::node::NodeData;
use bun_sema::resolve::MacroRequest;
use bun_sema::session::Arena;
use bun_sema::util::SharedSort;
use bun_sema_driver::host::to_native;

type MacroResult<'s> = (ExprId, HostValue<'s>);

pub(crate) struct MacroInput<'a> {
    pub provider: &'a dyn SourceProvider,
    pub messages: &'a LoadMessages,
    pub runs_macros: bool,
}

#[derive(Copy, Clone)]
enum ImportedName {
    Export(Atom),
    Namespace,
}

struct MacroBinding {
    symbol: SymbolId,
    import: ImportId,
    name: ImportedName,
}

struct MacroCallee {
    import: ImportId,
    export_name: Atom,
}

enum Arguments<'s> {
    Known(Vec<&'s DataValue<'s>>),
    Unknown(ExprId),
}

struct Round<'s> {
    results: Vec<MacroResult<'s>>,
    diagnostics: Vec<(Code, ExprId)>,
}

pub(crate) fn run_macros<'s>(
    input: &MacroInput<'_>,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    request: &MacroRequest<'_, 's>,
    diagnostics: &mut Vec<FileDiagnostic>,
) -> &'s [(ExprId, HostValue<'s>)] {
    if request.analysis.pending_macro_calls.is_empty() {
        return &[];
    }
    let round = run_round(input, arena, atoms, request);
    for (code, node) in round.diagnostics {
        let range = range_of_node(request.hir, NodeData::Expr(node));
        diagnostics.push(FileDiagnostic::new(code, range, &[]));
    }
    arena.alloc_slice_copy(&round.results)
}

fn run_round<'s>(
    input: &MacroInput<'_>,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    request: &MacroRequest<'_, 's>,
) -> Round<'s> {
    let hir = request.hir;
    let mut calls = request.analysis.pending_macro_calls.to_vec();
    calls.shared_sort_unstable();
    let bindings = collect_macro_bindings(hir, request.bound);
    let macro_symbols: Vec<SymbolId> = bindings.iter().map(|binding| binding.symbol).collect();
    let blocking_code = match (input.runs_macros, is_in_node_modules(request.importer)) {
        (false, _) => Some(Code::MacrosDisabled),
        (true, true) => Some(Code::MacroInNodeModules),
        (true, false) => None,
    };
    let undefined = HostValue::Data(arena.alloc(DataValue::Undefined));
    let mut round = Round {
        results: Vec::with_capacity(calls.len()),
        diagnostics: Vec::new(),
    };
    let mut waiting: Vec<(ExprId, ExprId)> = Vec::new();

    for expr in calls {
        let ExprKind::Call(id) = hir[expr].kind else {
            report_unnamed_callee(input, request);
            round.results.push((expr, undefined));
            continue;
        };
        if let Some(code) = blocking_code {
            round.diagnostics.push((code, expr));
            round.results.push((expr, undefined));
            continue;
        }
        let Some(callee) = find_callee(request, &bindings, &macro_symbols, expr) else {
            report_unnamed_callee(input, request);
            round.results.push((expr, undefined));
            continue;
        };
        match collect_arguments(request, arena, atoms, &hir[id]) {
            // A result of this round can make the argument known. Later calls run after this one.
            Arguments::Unknown(_) if !round.results.is_empty() => break,
            Arguments::Unknown(argument) => waiting.push((expr, argument)),
            Arguments::Known(arguments) => {
                let value = run_call(input, arena, atoms, request, &callee, &arguments);
                round
                    .results
                    .push((expr, value.map_or(undefined, HostValue::Data)));
            }
        }
    }

    if round.results.is_empty() {
        for &(expr, argument) in &waiting {
            let value = hir.skip_type_assertions(argument);
            let is_waiting_call = waiting.binary_search_by_key(&value, |call| call.0).is_ok();
            if !is_waiting_call {
                let code = Code::MacroArgumentNotConstant;
                round.diagnostics.push((code, argument));
            }
            round.results.push((expr, undefined));
        }
    }
    round
}

fn run_call<'s>(
    input: &MacroInput<'_>,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    request: &MacroRequest<'_, 's>,
    callee: &MacroCallee,
    arguments: &[&'s DataValue<'s>],
) -> Option<&'s DataValue<'s>> {
    let specifier = atoms.bytes(request.hir[callee.import].spec);
    let macro_path = resolve_macro_path(request, specifier);
    let call = MacroCall {
        importer: to_native(request.importer),
        macro_path: &macro_path,
        export_name: atoms.bytes(callee.export_name),
        arguments,
    };
    let result = input
        .messages
        .with_log(|log| input.provider.run_macro(&call, arena, atoms, log));
    result.ok()
}

fn report_unnamed_callee(input: &MacroInput<'_>, request: &MacroRequest<'_, '_>) {
    let prefix = b"a pending macro call does not call a binding of a macro import: ";
    let message = [&prefix[..], request.importer].concat();
    input.messages.report_internal_error(message);
}

fn collect_macro_bindings(hir: &File<'_>, bound: &Bound<'_>) -> Vec<MacroBinding> {
    let mut bindings = Vec::new();
    for (index, import) in hir.imports.iter().enumerate() {
        let type_attribute = hir.import_attribute(import.attributes, known::r#type);
        if import.type_only || type_attribute != Some(known::r#macro) {
            continue;
        }
        let id = ImportId(index as u32);
        let mut add_binding = |decl: Decl, name: ImportedName| {
            if let Some(symbol) = bound.declared_symbol(decl).some() {
                bindings.push(MacroBinding {
                    symbol,
                    import: id,
                    name,
                });
            }
        };
        add_binding(
            Decl::ImportDefault(id),
            ImportedName::Export(known::default),
        );
        add_binding(Decl::ImportNamespace(id), ImportedName::Namespace);
        for spec in import.named.iter() {
            if !hir[spec].type_only {
                let name = ImportedName::Export(hir[spec].imported);
                add_binding(Decl::ImportSpec(spec), name);
            }
        }
    }
    bindings.shared_sort_unstable_by_key(|binding| binding.symbol);
    bindings
}

fn find_callee(
    request: &MacroRequest<'_, '_>,
    bindings: &[MacroBinding],
    macro_symbols: &[SymbolId],
    call: ExprId,
) -> Option<MacroCallee> {
    let (symbol, member) = macro_callee(request.hir, request.bound, macro_symbols, call)?;
    let index = macro_symbols.binary_search(&symbol).ok()?;
    let binding = &bindings[index];
    let export_name = match (binding.name, member) {
        (ImportedName::Export(export_name), None) => export_name,
        (ImportedName::Namespace, Some(member)) => member,
        (ImportedName::Export(_), Some(_)) | (ImportedName::Namespace, None) => return None,
    };
    Some(MacroCallee {
        import: binding.import,
        export_name,
    })
}

fn collect_arguments<'s>(
    request: &MacroRequest<'_, 's>,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    call: &Call,
) -> Arguments<'s> {
    let decisions = &request.analysis.decisions;
    let mut values = Vec::with_capacity(call.args.len());
    for argument in request.hir.ids(call.args) {
        match data_value_of(request.hir, decisions, argument, atoms, arena) {
            FoldedData::Known(value) => values.push(&*arena.alloc(value)),
            FoldedData::Unknown => return Arguments::Unknown(argument),
        }
    }
    Arguments::Known(values)
}

fn resolve_macro_path(request: &MacroRequest<'_, '_>, specifier: &[u8]) -> Vec<u8> {
    match (request.resolve)(specifier) {
        Some(path) => to_native(&path).to_vec(),
        None => specifier.to_vec(),
    }
}
