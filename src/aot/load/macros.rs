#[cfg(test)]
mod tests;

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

pub(crate) fn run_macros<'s>(
    provider: &dyn SourceProvider,
    messages: &LoadMessages,
    runs_macros: bool,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    request: &MacroRequest<'_, 's>,
    diagnostics: &mut Vec<FileDiagnostic>,
) -> &'s [(ExprId, HostValue<'s>)] {
    if request.analysis.pending_macro_calls.is_empty() {
        return &[];
    }
    let hir = request.hir;
    let mut calls = request.analysis.pending_macro_calls.to_vec();
    calls.shared_sort_unstable();
    let bindings = collect_macro_bindings(hir, request.bound);
    let macro_symbols: Vec<SymbolId> = bindings.iter().map(|binding| binding.symbol).collect();
    let blocking_code = match (runs_macros, is_in_node_modules(request.importer)) {
        (false, _) => Some(Code::MacrosDisabled),
        (true, true) => Some(Code::MacroInNodeModules),
        (true, false) => None,
    };
    let undefined = HostValue::Data(arena.alloc(DataValue::Undefined));
    let mut report = |code: Code, node: ExprId| {
        let range = range_of_node(hir, NodeData::Expr(node));
        diagnostics.push(FileDiagnostic::new(code, range, &[]));
    };
    let report_unnamed_callee = || {
        let prefix = b"a pending macro call does not call a binding of a macro import: ";
        messages.report_internal_error([&prefix[..], request.importer].concat());
    };
    let mut results: Vec<MacroResult<'s>> = Vec::with_capacity(calls.len());
    let mut waiting: Vec<(ExprId, ExprId)> = Vec::new();

    for expr in calls {
        let ExprKind::Call(id) = hir[expr].kind else {
            report_unnamed_callee();
            results.push((expr, undefined));
            continue;
        };
        if let Some(code) = blocking_code {
            report(code, expr);
            results.push((expr, undefined));
            continue;
        }
        let Some((import, export_name)) = find_callee(request, &bindings, &macro_symbols, expr)
        else {
            report_unnamed_callee();
            results.push((expr, undefined));
            continue;
        };
        match collect_arguments(request, arena, atoms, &hir[id]) {
            // A result of this round can make the argument known. Later calls run after this one.
            Err(_) if !results.is_empty() => break,
            Err(argument) => waiting.push((expr, argument)),
            Ok(arguments) => {
                let specifier = atoms.bytes(hir[import].spec);
                let macro_path = match (request.resolve)(specifier) {
                    Some(path) => to_native(&path).to_vec(),
                    None => specifier.to_vec(),
                };
                let call = MacroCall {
                    importer: to_native(request.importer),
                    macro_path: &macro_path,
                    export_name: atoms.bytes(export_name),
                    arguments: &arguments,
                };
                let value = messages.with_log(|log| provider.run_macro(&call, arena, atoms, log));
                results.push((expr, value.map_or(undefined, HostValue::Data)));
            }
        }
    }

    if results.is_empty() {
        for &(expr, argument) in &waiting {
            let value = hir.skip_type_assertions(argument);
            let is_waiting_call = waiting.binary_search_by_key(&value, |call| call.0).is_ok();
            if !is_waiting_call {
                report(Code::MacroArgumentNotConstant, argument);
            }
            results.push((expr, undefined));
        }
    }
    arena.alloc_slice_copy(&results)
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
) -> Option<(ImportId, Atom)> {
    let (symbol, member) = macro_callee(request.hir, request.bound, macro_symbols, call)?;
    let index = macro_symbols.binary_search(&symbol).ok()?;
    let binding = &bindings[index];
    let export_name = match (binding.name, member) {
        (ImportedName::Export(export_name), None) => export_name,
        (ImportedName::Namespace, Some(member)) => member,
        (ImportedName::Export(_), Some(_)) | (ImportedName::Namespace, None) => return None,
    };
    Some((binding.import, export_name))
}

/// The values of the arguments, or the first argument whose value is not known.
fn collect_arguments<'s>(
    request: &MacroRequest<'_, 's>,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    call: &Call,
) -> Result<Vec<&'s DataValue<'s>>, ExprId> {
    let decisions = &request.analysis.decisions;
    let mut values = Vec::with_capacity(call.args.len());
    for argument in request.hir.ids(call.args) {
        match data_value_of(request.hir, decisions, argument, atoms, arena) {
            FoldedData::Known(value) => values.push(&*arena.alloc(value)),
            FoldedData::Unknown => return Err(argument),
        }
    }
    Ok(values)
}
