use crate::collections::{IdBitSet, IdMap};
use crate::diagnostics::{
    CompilerDiagnostic, CompilerDiagnosticDetail, CompilerError, ErrorCategory, SourceLocation,
};
use crate::hir::environment::Environment;
use crate::hir::visitors::{pattern_operands, value_lvalues};
use crate::hir::{FunctionId, HirFunction, Identifier, IdentifierId, InstructionValue, Place};

/// Variable reference kind: local, context, or destructure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VarRefKind {
    Local,
    Context,
    Destructure,
}

impl std::fmt::Display for VarRefKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VarRefKind::Local => write!(f, "local"),
            VarRefKind::Context => write!(f, "context"),
            VarRefKind::Destructure => write!(f, "destructure"),
        }
    }
}

struct IdentifierKinds {
    /// Where each identifier was referenced last, and as what.
    last: IdMap<IdentifierId, (Option<SourceLocation>, VarRefKind)>,
    /// The identifiers that are referenced as context variables anywhere. Only these can be
    /// referenced inconsistently.
    context: IdBitSet<IdentifierId>,
    /// Whether `context` has them all.
    is_context_complete: bool,
}

/// Returns whether all of the function was seen.
fn collect_context_identifiers(
    func: &HirFunction,
    functions: &[HirFunction],
    context: &mut IdBitSet<IdentifierId>,
) -> bool {
    if !crate::lowering::thread_has_stack() {
        return false;
    }
    for block in func.body.blocks.values() {
        for &instr_id in &block.instructions {
            match &func.instructions[instr_id.0 as usize].value {
                InstructionValue::DeclareContext { lvalue, .. }
                | InstructionValue::StoreContext { lvalue, .. } => {
                    context.insert(lvalue.place.identifier);
                }
                InstructionValue::LoadContext { place, .. } => {
                    context.insert(place.identifier);
                }
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    let inner = &functions[lowered_func.func.0 as usize];
                    if !collect_context_identifiers(inner, functions, context) {
                        return false;
                    }
                }
                _ => {}
            }
        }
    }
    true
}

/// Validates that context variable lvalues are used consistently.
///
/// Port of ValidateContextVariableLValues.ts
pub(crate) fn validate_context_variable_lvalues(
    func: &HirFunction,
    env: &mut Environment,
) -> Result<(), CompilerDiagnostic> {
    validate_context_variable_lvalues_with_errors(
        func,
        &env.functions,
        &env.identifiers,
        &mut env.errors,
    )
}

/// Like [`validate_context_variable_lvalues`], but writes diagnostics into the
/// provided `errors` instead of `env.errors`. Useful when the caller wants to
/// discard the diagnostics (e.g. when lowering is incomplete).
pub(crate) fn validate_context_variable_lvalues_with_errors(
    func: &HirFunction,
    functions: &[HirFunction],
    identifiers: &[Identifier],
    errors: &mut CompilerError,
) -> Result<(), CompilerDiagnostic> {
    let mut context = IdBitSet::default();
    let is_context_complete = collect_context_identifiers(func, functions, &mut context);
    if is_context_complete && context.is_empty() && !cfg!(debug_assertions) {
        return Ok(());
    }
    let mut identifier_kinds = IdentifierKinds {
        last: IdMap::new(),
        context,
        is_context_complete,
    };
    validate_context_variable_lvalues_impl(
        func,
        &mut identifier_kinds,
        functions,
        identifiers,
        errors,
    )
}

fn validate_context_variable_lvalues_impl(
    func: &HirFunction,
    identifier_kinds: &mut IdentifierKinds,
    functions: &[HirFunction],
    identifiers: &[Identifier],
    errors: &mut CompilerError,
) -> Result<(), CompilerDiagnostic> {
    if !crate::lowering::thread_has_stack() {
        return Err(crate::lowering::nested_too_deeply());
    }

    let mut inner_function_ids: Vec<FunctionId> = Vec::new();

    for (_block_id, block) in &func.body.blocks {
        for &instr_id in &block.instructions {
            let instr = &func.instructions[instr_id.0 as usize];
            let value = &instr.value;

            match value {
                InstructionValue::DeclareContext { lvalue, .. }
                | InstructionValue::StoreContext { lvalue, .. } => {
                    visit(
                        identifier_kinds,
                        &lvalue.place,
                        VarRefKind::Context,
                        identifiers,
                        errors,
                    )?;
                }
                InstructionValue::LoadContext { place, .. } => {
                    visit(
                        identifier_kinds,
                        place,
                        VarRefKind::Context,
                        identifiers,
                        errors,
                    )?;
                }
                InstructionValue::StoreLocal { lvalue, .. }
                | InstructionValue::DeclareLocal { lvalue, .. } => {
                    visit(
                        identifier_kinds,
                        &lvalue.place,
                        VarRefKind::Local,
                        identifiers,
                        errors,
                    )?;
                }
                InstructionValue::LoadLocal { place, .. } => {
                    visit(
                        identifier_kinds,
                        place,
                        VarRefKind::Local,
                        identifiers,
                        errors,
                    )?;
                }
                InstructionValue::PostfixUpdate { lvalue, .. }
                | InstructionValue::PrefixUpdate { lvalue, .. } => {
                    visit(
                        identifier_kinds,
                        lvalue,
                        VarRefKind::Local,
                        identifiers,
                        errors,
                    )?;
                }
                InstructionValue::Destructure { lvalue, .. } => {
                    for place in pattern_operands(&lvalue.pattern) {
                        visit(
                            identifier_kinds,
                            place,
                            VarRefKind::Destructure,
                            identifiers,
                            errors,
                        )?;
                    }
                }
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    inner_function_ids.push(lowered_func.func);
                }
                // Upstream has a Todo for an lvalue in any other value. There is none.
                _ => debug_assert!(value_lvalues(value).next().is_none()),
            }
        }
    }

    // Process inner functions after the block loop to avoid borrow conflicts
    for func_id in inner_function_ids {
        let inner_func = &functions[func_id.0 as usize];
        validate_context_variable_lvalues_impl(
            inner_func,
            identifier_kinds,
            functions,
            identifiers,
            errors,
        )?;
    }

    Ok(())
}

/// Format a place like TS `printPlace()`: `<effect> <name>$<id>`
fn format_place(place: &Place, identifiers: &[Identifier]) -> String {
    let id = place.identifier;
    let ident = &identifiers[id.0 as usize];
    let name: &[u8] = match &ident.name {
        Some(n) => n.value(),
        None => b"",
    };
    format!("{} {}${}", place.effect, bun_core::BStr::new(name), id.0)
}

fn visit(
    identifiers: &mut IdentifierKinds,
    place: &Place,
    kind: VarRefKind,
    env_identifiers: &[Identifier],
    errors: &mut CompilerError,
) -> Result<(), CompilerDiagnostic> {
    let is_ever_context = identifiers.context.contains(place.identifier);
    if identifiers.is_context_complete && !is_ever_context && !cfg!(debug_assertions) {
        return Ok(());
    }
    if let Some((prev_loc, prev_kind)) = identifiers.last.get_mut(place.identifier) {
        let was_context = *prev_kind == VarRefKind::Context;
        let is_context = kind == VarRefKind::Context;
        if was_context != is_context {
            debug_assert!(is_ever_context || !identifiers.is_context_complete);
            if *prev_kind == VarRefKind::Destructure || kind == VarRefKind::Destructure {
                let loc = if kind == VarRefKind::Destructure {
                    place.loc
                } else {
                    *prev_loc
                };
                errors.push_diagnostic(
                    CompilerDiagnostic::new(
                        ErrorCategory::Todo,
                        "Support destructuring of context variables",
                        None,
                    )
                    .with_detail(CompilerDiagnosticDetail::Error {
                        loc,
                        message: None,
                        identifier_name: None,
                    }),
                );
                return Ok(());
            }
            return Err(inconsistent_ref_error(
                place,
                env_identifiers,
                kind,
                *prev_kind,
            ));
        }
        (*prev_loc, *prev_kind) = (place.loc, kind);
        return Ok(());
    }
    identifiers.last.insert(place.identifier, (place.loc, kind));
    Ok(())
}

#[cold]
#[inline(never)]
fn inconsistent_ref_error(
    place: &Place,
    env_identifiers: &[Identifier],
    kind: VarRefKind,
    prev_kind: VarRefKind,
) -> CompilerDiagnostic {
    let place_str = format_place(place, env_identifiers);
    CompilerDiagnostic::new(
        ErrorCategory::Invariant,
        "Expected all references to a variable to be consistently local or context references",
        Some(format!(
            "Identifier {} is referenced as a {} variable, but was previously referenced as a {} variable",
            place_str, kind, prev_kind
        )),
    )
    .with_detail(CompilerDiagnosticDetail::Error {
        loc: place.loc,
        message: Some(format!("this is {}", prev_kind)),
        identifier_name: None,
    })
}
