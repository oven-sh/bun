//! Port of build_hir.rs lines 5510–5984 and 6469–6552 — see mod.rs.

use crate::collections::IndexMap;
use crate::diagnostics::{
    CompilerDiagnostic, CompilerError, CompilerErrorDetail, ErrorCategory, SourceLocation,
};
use crate::hir::{
    Effect, FunctionExpressionType, InstructionKind, InstructionValue, LValue, LoweredFunction,
    ObjectProperty, ObjectPropertyKey, ObjectPropertyType, Place, StoreStr, VariableBinding,
};
use bun_ast::expr::Data;
use bun_ast::{self as ast, E, Expr, G, Loc, Ref};

use super::super::hir_builder::{HirBuilder, convert_loc};
use super::FunctionNode;
use super::helpers::{lower_expression_to_temporary, lower_value_to_temporary};
use super::{gather_captured_context, lower_inner};

pub(super) fn lower_function_to_value(
    builder: &mut HirBuilder<'_>,
    func: FunctionNode<'_>,
    func_loc: Loc,
    expr_type: FunctionExpressionType,
) -> Result<InstructionValue, CompilerDiagnostic> {
    let loc = convert_loc(func_loc);
    let name = func
        .name_ref()
        .map(|r| StoreStr::new(builder.host().ref_name(r)));
    let lowered_func = lower_function(builder, func, func_loc)?;
    Ok(InstructionValue::FunctionExpression {
        name,
        name_hint: None,
        lowered_func,
        expr_type,
        loc,
    })
}

fn lower_function(
    builder: &mut HirBuilder<'_>,
    func: FunctionNode<'_>,
    func_loc: Loc,
) -> Result<LoweredFunction, CompilerDiagnostic> {
    let loc = convert_loc(func_loc);
    let id = func
        .name_ref()
        .map(|r| StoreStr::new(builder.host().ref_name(r)));

    // Bun's parser already linked every function to its scope tree; the
    // synthetic zero-width scope search upstream performs is a Hermes-desugar
    // workaround that does not apply here. Scope resolution for the inner
    // function is delegated to `lower_inner` / `gather_captured_context`,
    // which walk from `parent_function_scope`.
    let parent_function_scope = builder.function_scope();
    let component_scope = builder.component_scope();

    let parent_bindings = builder.bindings().clone();
    let parent_used_refs = builder.used_refs().clone();
    let context_ids = builder.context_identifiers().clone();
    let import_bindings = builder.import_bindings().clone();

    // Gather captured context
    let captured_context = gather_captured_context(
        builder.host(),
        &func,
        builder.current_scope(),
        component_scope,
    );
    let merged_context: IndexMap<Ref, Option<SourceLocation>> = {
        let mut merged = builder.context().clone();
        for (k, v) in captured_context {
            merged.insert(k, v);
        }
        merged
    };

    // Use host_and_env_mut to avoid conflicting borrows
    let (host, env) = builder.host_and_env_mut();
    let (hir_func, child_used_refs, child_bindings) = lower_inner(
        &func,
        id,
        loc,
        host,
        env,
        Some(parent_bindings),
        Some(parent_used_refs),
        &merged_context,
        parent_function_scope,
        component_scope,
        &context_ids,
        &import_bindings,
        false, // nested function
    )?;

    builder.merge_used_refs(&child_used_refs);
    builder.merge_bindings(child_bindings);

    let func_id = builder.environment_mut().add_function(hir_func);
    Ok(LoweredFunction { func: func_id })
}

/// Lower a function declaration statement to a FunctionExpression + StoreLocal.
pub(super) fn lower_function_declaration(
    builder: &mut HirBuilder<'_>,
    func_decl: &G::Fn,
    stmt_loc: Loc,
) -> Result<(), CompilerError> {
    let loc = convert_loc(stmt_loc);
    let func = FunctionNode::Function(func_decl);

    let func_name_ref = func.name_ref();
    let func_name = func_name_ref.map(|r| StoreStr::new(builder.host().ref_name(r)));

    let parent_function_scope = builder.function_scope();
    let component_scope = builder.component_scope();

    let parent_bindings = builder.bindings().clone();
    let parent_used_refs = builder.used_refs().clone();
    let context_ids = builder.context_identifiers().clone();
    let import_bindings = builder.import_bindings().clone();

    // Gather captured context
    let captured_context = gather_captured_context(
        builder.host(),
        &func,
        builder.current_scope(),
        component_scope,
    );
    let merged_context: IndexMap<Ref, Option<SourceLocation>> = {
        let mut merged = builder.context().clone();
        for (k, v) in captured_context {
            merged.insert(k, v);
        }
        merged
    };

    let (host, env) = builder.host_and_env_mut();
    let (hir_func, child_used_refs, child_bindings) = lower_inner(
        &func,
        func_name,
        loc,
        host,
        env,
        Some(parent_bindings),
        Some(parent_used_refs),
        &merged_context,
        parent_function_scope,
        component_scope,
        &context_ids,
        &import_bindings,
        false, // nested function
    )?;

    builder.merge_used_refs(&child_used_refs);
    builder.merge_bindings(child_bindings);

    let func_id = builder.environment_mut().add_function(hir_func);
    let lowered_func = LoweredFunction { func: func_id };

    // Emit FunctionExpression instruction
    let fn_value = InstructionValue::FunctionExpression {
        name: func_name,
        name_hint: None,
        lowered_func,
        expr_type: FunctionExpressionType::FunctionDeclaration,
        loc,
    };
    let fn_place = lower_value_to_temporary(builder, fn_value)?;

    // Resolve the binding for the function name and store. Bun's parser
    // already resolved `func_decl.name.ref_` to the hoisted binding, so the
    // upstream scope-walk + node-based fallback chain collapses to a direct
    // `Ref` lookup.
    if let Some(name_ref) = func_name_ref {
        let ident_loc = func_decl.name.as_ref().map(|n| n.loc).and_then(convert_loc);
        let is_context = builder.is_context_binding(name_ref);
        let binding = builder.resolve_identifier(name_ref, ident_loc)?;
        match binding {
            VariableBinding::Identifier { identifier, .. } => {
                // Don't override the identifier's declaration loc here.
                // Use the full function declaration loc for the Place,
                // matching the TS behavior where lowerAssignment uses stmt.node.loc
                let place = Place {
                    identifier,
                    reactive: false,
                    effect: Effect::Unknown,
                    loc,
                };
                if is_context {
                    lower_value_to_temporary(
                        builder,
                        InstructionValue::StoreContext {
                            lvalue: LValue {
                                kind: InstructionKind::Function,
                                place,
                            },
                            value: fn_place,
                            loc,
                        },
                    )?;
                } else {
                    lower_value_to_temporary(
                        builder,
                        InstructionValue::StoreLocal {
                            lvalue: LValue {
                                kind: InstructionKind::Function,
                                place,
                            },
                            value: fn_place,
                            type_annotation: None,
                            loc,
                        },
                    )?;
                }
            }
            _ => {
                builder.record_error(CompilerErrorDetail {
                    category: ErrorCategory::Invariant,
                    reason: format!(
                        "Could not find binding for function declaration `{}`",
                        bun_core::BStr::new(func_name.map(|s| s.slice()).unwrap_or(b""))
                    ),
                    description: None,
                    loc,
                    suggestions: None,
                })?;
            }
        }
    }
    Ok(())
}

/// Lower a function expression used as an object method.
fn lower_function_for_object_method(
    builder: &mut HirBuilder<'_>,
    method: &G::Fn,
    method_loc: Loc,
) -> Result<LoweredFunction, CompilerError> {
    let func_loc = convert_loc(method_loc);
    let func = FunctionNode::Function(method);

    let parent_function_scope = builder.function_scope();
    let component_scope = builder.component_scope();

    let parent_bindings = builder.bindings().clone();
    let parent_used_refs = builder.used_refs().clone();
    let context_ids = builder.context_identifiers().clone();
    let import_bindings = builder.import_bindings().clone();

    let captured_context = gather_captured_context(
        builder.host(),
        &func,
        builder.current_scope(),
        component_scope,
    );
    let merged_context: IndexMap<Ref, Option<SourceLocation>> = {
        let mut merged = builder.context().clone();
        for (k, v) in captured_context {
            merged.insert(k, v);
        }
        merged
    };

    let (host, env) = builder.host_and_env_mut();
    let (hir_func, child_used_refs, child_bindings) = lower_inner(
        &func,
        None,
        func_loc,
        host,
        env,
        Some(parent_bindings),
        Some(parent_used_refs),
        &merged_context,
        parent_function_scope,
        component_scope,
        &context_ids,
        &import_bindings,
        false, // nested function
    )?;

    builder.merge_used_refs(&child_used_refs);
    builder.merge_bindings(child_bindings);

    let func_id = builder.environment_mut().add_function(hir_func);
    Ok(LoweredFunction { func: func_id })
}

pub(super) fn lower_object_method(
    builder: &mut HirBuilder<'_>,
    method: &G::Property,
) -> Result<Option<ObjectProperty>, CompilerError> {
    use ast::flags::Property as PF;
    let key_expr = method.key.as_ref();
    let method_loc = key_expr.map(|k| k.loc).unwrap_or(Loc::EMPTY);

    let is_method =
        matches!(method.kind, G::PropertyKind::Normal) && method.flags.contains(PF::IsMethod);
    if !is_method {
        let kind_str = match method.kind {
            G::PropertyKind::Get => "get",
            G::PropertyKind::Set => "set",
            _ => "method",
        };
        builder.record_error(CompilerErrorDetail {
            reason: format!(
                "(BuildHIR::lowerExpression) Handle {} functions in ObjectExpression",
                kind_str
            ),
            category: ErrorCategory::Todo,
            loc: convert_loc(method_loc),
            description: None,
            suggestions: None,
        })?;
        return Ok(None);
    }

    let computed = method.flags.contains(PF::IsComputed);
    let key = match key_expr {
        Some(k) => {
            lower_object_property_key(builder, k, computed)?.unwrap_or(ObjectPropertyKey::String {
                name: StoreStr::EMPTY,
            })
        }
        None => ObjectPropertyKey::String {
            name: StoreStr::EMPTY,
        },
    };

    let Some(value) = method.value.as_ref() else {
        builder.record_error(CompilerErrorDetail {
            reason: "(BuildHIR::lowerExpression) Object method missing value".to_string(),
            category: ErrorCategory::Invariant,
            loc: convert_loc(method_loc),
            description: None,
            suggestions: None,
        })?;
        return Ok(None);
    };
    let Data::EFunction(f) = &value.data else {
        builder.record_error(CompilerErrorDetail {
            reason: "(BuildHIR::lowerExpression) Object method value is not a function".to_string(),
            category: ErrorCategory::Invariant,
            loc: convert_loc(value.loc),
            description: None,
            suggestions: None,
        })?;
        return Ok(None);
    };

    let lowered_func = lower_function_for_object_method(builder, &f.func, value.loc)?;

    let loc = convert_loc(method_loc);
    let method_value = InstructionValue::ObjectMethod { loc, lowered_func };
    let method_place = lower_value_to_temporary(builder, method_value)?;

    Ok(Some(ObjectProperty {
        key,
        property_type: ObjectPropertyType::Method,
        place: method_place,
    }))
}

fn lower_object_property_key(
    builder: &mut HirBuilder<'_>,
    key: &Expr,
    computed: bool,
) -> Result<Option<ObjectPropertyKey>, CompilerError> {
    match &key.data {
        // Upstream matches `StringLiteral` regardless of `computed`, so a
        // constant string in a computed key (`{["foo"]: x}`) still lowers to
        // the static-key path. Roped strings fall through to the
        // computed/unsupported arms below.
        Data::EString(s) if s.next.is_none() => {
            let name = estring_to_store_str(s);
            // Bun stores non-computed identifier keys as `EString`; classify as
            // Identifier when the bytes form a valid identifier so the HIR
            // matches upstream's `Expression::Identifier` arm.
            if !computed && !s.is_utf16 && is_identifier(s.slice8()) {
                Ok(Some(ObjectPropertyKey::Identifier { name }))
            } else {
                Ok(Some(ObjectPropertyKey::String { name }))
            }
        }
        Data::ENumber(n) if !computed => {
            let scratch = n.value().to_string();
            Ok(Some(ObjectPropertyKey::Identifier {
                name: super::helpers::arena_str(scratch.as_bytes()),
            }))
        }
        Data::EIdentifier(id) if !computed => Ok(Some(ObjectPropertyKey::Identifier {
            name: StoreStr::new(builder.host().ref_name(id.ref_)),
        })),
        Data::EPrivateIdentifier(_) => {
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: "Unsupported key type in ObjectExpression".to_string(),
                description: None,
                loc: convert_loc(key.loc),
                suggestions: None,
            })?;
            Ok(None)
        }
        _ if computed => {
            let place = lower_expression_to_temporary(builder, key)?;
            Ok(Some(ObjectPropertyKey::Computed { name: place }))
        }
        _ => {
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: "Unsupported key type in ObjectExpression".to_string(),
                description: None,
                loc: convert_loc(key.loc),
                suggestions: None,
            })?;
            Ok(None)
        }
    }
}

fn estring_to_store_str(s: &E::EString) -> StoreStr {
    debug_assert!(s.next.is_none());
    if s.is_utf16 {
        super::helpers::arena_str(bun_core::strings::to_utf8_alloc(s.slice16()).as_slice())
    } else {
        StoreStr::new(s.slice8())
    }
}

fn is_identifier(s: &[u8]) -> bool {
    if s.is_empty() {
        return false;
    }
    let first = s[0];
    if !(first.is_ascii_alphabetic() || first == b'_' || first == b'$') {
        return false;
    }
    s[1..]
        .iter()
        .all(|&c| c.is_ascii_alphanumeric() || c == b'_' || c == b'$')
}
