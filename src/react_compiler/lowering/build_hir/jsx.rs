//! Port of build_hir.rs lines 6242–6468 — see mod.rs.
//!
//! Bun's parser visit pass lowers `EJsxElement` to `E::Call{was_jsx_element: true}`
//! before the React Compiler runs (see `src/js_parser/visit/visit_expr.rs::e_jsx_element`).
//! This module decodes that call shape back into the HIR `JsxExpression` instruction.

use crate::diagnostics::{CompilerError, CompilerErrorDetail, ErrorCategory};
use crate::hir::{
    BuiltinTag, InstructionValue, JsxAttribute, JsxTag, Place, PrimitiveValue, PropertyLiteral,
    SourceLocation,
};
use bun_ast::expr::Data as ExprData;
use bun_ast::{E, Expr, G, Loc};

use super::expr::lower_expression;
use super::{lower_expression_to_temporary, lower_identifier, lower_value_to_temporary};
use crate::lowering::hir_builder::{HirBuilder, convert_loc};

fn estring_to_string(
    s: &E::EString,
    loc: &Option<SourceLocation>,
) -> Result<String, CompilerError> {
    if s.is_utf16 {
        Ok(String::from_utf16_lossy(s.slice16()))
    } else {
        core::str::from_utf8(s.slice8())
            .map(str::to_owned)
            .map_err(|_| {
                let mut err = CompilerError::new();
                err.push_error_detail(CompilerErrorDetail {
                    category: ErrorCategory::Todo,
                    reason: "(BuildHIR::lowerJsx) non-utf8 string".to_string(),
                    description: None,
                    loc: *loc,
                    suggestions: None,
                });
                err
            })
    }
}

pub(super) fn lower_jsx_element_name(
    builder: &mut HirBuilder,
    tag: &Expr,
) -> Result<JsxTag, CompilerError> {
    let loc = convert_loc(tag.loc);
    match tag.data {
        ExprData::EIdentifier(id) => {
            // Upstream (build_hir.rs:6252) gates on `is_ascii_uppercase` of the first char,
            // but Bun's parser only emits EString for `a..=z` — so `_foo` / `$Bar` arrive here
            // as identifiers. Replicate upstream's Builtin classification for non-uppercase.
            let name = builder.ref_name(id.ref_)?;
            if name.starts_with(|c: char| c.is_ascii_uppercase()) {
                let place = lower_identifier(builder, id.ref_, loc)?;
                let load_value = if builder.is_context_identifier(id.ref_) {
                    InstructionValue::LoadContext { place, loc }
                } else {
                    InstructionValue::LoadLocal { place, loc }
                };
                let temp = lower_value_to_temporary(builder, load_value)?;
                Ok(JsxTag::Place(temp))
            } else {
                Ok(JsxTag::Builtin(BuiltinTag { name, loc }))
            }
        }
        ExprData::EImportIdentifier(id) => {
            let name = builder.ref_name(id.ref_)?;
            if name.starts_with(|c: char| c.is_ascii_uppercase()) {
                let place = lower_identifier(builder, id.ref_, loc)?;
                let load_value = if builder.is_context_identifier(id.ref_) {
                    InstructionValue::LoadContext { place, loc }
                } else {
                    InstructionValue::LoadLocal { place, loc }
                };
                let temp = lower_value_to_temporary(builder, load_value)?;
                Ok(JsxTag::Place(temp))
            } else {
                Ok(JsxTag::Builtin(BuiltinTag { name, loc }))
            }
        }
        ExprData::EString(s) => {
            let name = estring_to_string(&s, &loc)?;
            if let Some(idx) = name.find(':') {
                let namespace = &name[..idx];
                let local = &name[idx + 1..];
                if local.contains(':') {
                    builder.record_error(CompilerErrorDetail {
                        category: ErrorCategory::Syntax,
                        reason:
                            "Expected JSXNamespacedName to have no colons in the namespace or name"
                                .to_string(),
                        description: Some(format!("Got `{}` : `{}`", namespace, local)),
                        loc,
                        suggestions: None,
                    })?;
                }
                let place = lower_value_to_temporary(
                    builder,
                    InstructionValue::Primitive {
                        value: PrimitiveValue::String(name.into()),
                        loc,
                    },
                )?;
                Ok(JsxTag::Place(place))
            } else {
                // Builtin HTML tag
                Ok(JsxTag::Builtin(BuiltinTag { name, loc }))
            }
        }
        ExprData::EDot(dot) => {
            let place = lower_jsx_member_expression(builder, &dot, tag.loc)?;
            Ok(JsxTag::Place(place))
        }
        _ => {
            // Anything else (e.g. the auto-imported Fragment / jsx runtime tag that
            // doesn't fit the above shapes) is lowered as an ordinary expression.
            let value = lower_expression(builder, tag)?;
            let place = lower_value_to_temporary(builder, value)?;
            Ok(JsxTag::Place(place))
        }
    }
}

pub(super) fn lower_jsx_member_expression(
    builder: &mut HirBuilder,
    expr: &E::Dot,
    expr_loc: Loc,
) -> Result<Place, CompilerError> {
    // Use the full member expression's loc for instruction locs (matching TS: exprPath.node.loc)
    let expr_loc = convert_loc(expr_loc);
    let object = match expr.target.data {
        ExprData::EIdentifier(id) => {
            let id_loc = convert_loc(expr.target.loc);
            // Use identifier's own loc for the place, but member expression's loc for the instruction
            let place = lower_identifier(builder, id.ref_, id_loc)?;
            let load_value = if builder.is_context_identifier(id.ref_) {
                InstructionValue::LoadContext {
                    place,
                    loc: expr_loc,
                }
            } else {
                InstructionValue::LoadLocal {
                    place,
                    loc: expr_loc,
                }
            };
            lower_value_to_temporary(builder, load_value)?
        }
        ExprData::EImportIdentifier(id) => {
            let id_loc = convert_loc(expr.target.loc);
            let place = lower_identifier(builder, id.ref_, id_loc)?;
            let load_value = if builder.is_context_identifier(id.ref_) {
                InstructionValue::LoadContext {
                    place,
                    loc: expr_loc,
                }
            } else {
                InstructionValue::LoadLocal {
                    place,
                    loc: expr_loc,
                }
            };
            lower_value_to_temporary(builder, load_value)?
        }
        ExprData::EDot(inner) => lower_jsx_member_expression(builder, &inner, expr.target.loc)?,
        _ => {
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: format!(
                    "(BuildHIR::lowerJsxMemberExpression) Handle {:?} object",
                    expr.target.data.tag()
                ),
                description: None,
                loc: expr_loc,
                suggestions: None,
            })?;
            lower_value_to_temporary(
                builder,
                InstructionValue::Primitive {
                    value: PrimitiveValue::Undefined,
                    loc: expr_loc,
                },
            )?
        }
    };
    let prop_name = core::str::from_utf8(expr.name.slice())
        .map(str::to_owned)
        .map_err(|_| {
            let mut err = CompilerError::new();
            err.push_error_detail(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: "(BuildHIR::lowerJsxMemberExpression) non-utf8 property".to_string(),
                description: None,
                loc: expr_loc,
                suggestions: None,
            });
            err
        })?;
    let value = InstructionValue::PropertyLoad {
        object,
        property: PropertyLiteral::String(prop_name),
        loc: expr_loc,
    };
    lower_value_to_temporary(builder, value)
}

/// Decode an `E::Call{was_jsx_element: true}` produced by Bun's JSX visit pass
/// back into a HIR `JsxExpression`.
///
/// Shapes emitted by `visit_expr.rs::e_jsx_element`:
///   Automatic runtime:
///     jsx(tag, props)                                    — 2 args
///     jsx(tag, props, key)                               — 3 args
///     jsxDEV(tag, props, key|undefined, isStatic, undefined, this) — 6 args
///     where `props` is always an `E::Object` and `children` (if any) is one of
///     its properties (single expr or `E::Array`).
///   Classic runtime:
///     createElement(tag, propsOrNull, ...children)
pub(super) fn lower_jsx_call(
    builder: &mut HirBuilder,
    call: &E::Call,
    expr_loc: Loc,
) -> Result<InstructionValue, CompilerError> {
    let loc = convert_loc(expr_loc);
    let args: &[Expr] = &call.args;

    let Some(tag_expr) = args.first() else {
        builder.record_error(CompilerErrorDetail {
            category: ErrorCategory::Invariant,
            reason: "(BuildHIR::lowerJsxCall) JSX call with no arguments".to_string(),
            description: None,
            loc,
            suggestions: None,
        })?;
        return Ok(InstructionValue::Primitive {
            value: PrimitiveValue::Undefined,
            loc,
        });
    };

    let opening_loc = convert_loc(tag_expr.loc);
    let closing_loc = convert_loc(call.close_paren_loc);

    let tag = lower_jsx_element_name(builder, tag_expr)?;

    // Detect automatic vs classic runtime by the shape of args[1] and arity.
    // Automatic always passes an E::Object as args[1] with children packed inside;
    // classic passes E::Object|E::Null as args[1] and children as args[2..].
    let props_arg = args.get(1);
    let is_automatic = match props_arg {
        Some(p) if matches!(p.data, ExprData::EObject(_)) => {
            matches!(args.len(), 2 | 3 | 6)
        }
        _ => false,
    };

    let mut props: Vec<JsxAttribute> = Vec::new();
    let mut children: Vec<Place> = Vec::new();

    if is_automatic {
        let ExprData::EObject(obj) = &props_arg.unwrap().data else {
            unreachable!()
        };

        // visit_expr.rs only wraps `children` in a synthetic E::Array when
        // `is_static_jsx` is true; for a single non-spread child the child
        // expression (which may itself be a user-authored array) is passed
        // through verbatim. Recover that bit so lower_jsx_children knows
        // whether an EArray is the transform's container or a real child.
        let is_static_children = if args.len() == 6 {
            matches!(args[3].data, ExprData::EBoolean(b) if b.value)
        } else {
            match &call.target.data {
                ExprData::EIdentifier(id) => builder
                    .ref_name(id.ref_)
                    .map(|n| n.starts_with("jsxs"))
                    .unwrap_or(false),
                ExprData::EImportIdentifier(id) => builder
                    .ref_name(id.ref_)
                    .map(|n| n.starts_with("jsxs"))
                    .unwrap_or(false),
                _ => false,
            }
        };

        // `key` was hoisted out of the props object into args[2] by the visit
        // pass. Lower it BEFORE children so instruction order matches JSX
        // source order (attributes precede children) — upstream build_hir.rs
        // lowers opening_element.attributes before children.
        if let Some(key_arg) = args.get(2) {
            if !matches!(key_arg.data, ExprData::EUndefined(_)) {
                let place = lower_expression_to_temporary(builder, key_arg)?;
                props.push(JsxAttribute::Attribute {
                    name: "key".to_string(),
                    place,
                });
            }
        }

        for prop in obj.properties.iter() {
            if matches!(prop.kind, G::PropertyKind::Spread) {
                let value = prop.value.as_ref().ok_or_else(|| {
                    todo_err("(BuildHIR::lowerJsxCall) spread without value", loc)
                })?;
                let argument = lower_expression_to_temporary(builder, value)?;
                props.push(JsxAttribute::SpreadAttribute { argument });
                continue;
            }
            let Some(key_expr) = prop.key.as_ref() else {
                continue;
            };
            let ExprData::EString(key_str) = &key_expr.data else {
                builder.record_error(CompilerErrorDetail {
                    category: ErrorCategory::Todo,
                    reason: "(BuildHIR::lowerJsxCall) non-string JSX attribute key".to_string(),
                    description: None,
                    loc: convert_loc(key_expr.loc),
                    suggestions: None,
                })?;
                continue;
            };
            let key_loc = convert_loc(key_expr.loc);
            let name = estring_to_string(key_str, &key_loc)?;
            let Some(value_expr) = prop.value.as_ref() else {
                continue;
            };

            if name == "children" {
                lower_jsx_children(builder, value_expr, is_static_children, &mut children)?;
                continue;
            }

            let place = lower_expression_to_temporary(builder, value_expr)?;
            props.push(JsxAttribute::Attribute { name, place });
        }
        // args[3..6] (isStatic, source, self) are dev-only metadata; ignore.
    } else {
        // Classic: createElement(tag, propsOrNull, ...children)
        if let Some(p) = props_arg {
            if let ExprData::EObject(obj) = &p.data {
                for prop in obj.properties.iter() {
                    if matches!(prop.kind, G::PropertyKind::Spread) {
                        let value = prop.value.as_ref().ok_or_else(|| {
                            todo_err("(BuildHIR::lowerJsxCall) spread without value", loc)
                        })?;
                        let argument = lower_expression_to_temporary(builder, value)?;
                        props.push(JsxAttribute::SpreadAttribute { argument });
                        continue;
                    }
                    let Some(key_expr) = prop.key.as_ref() else {
                        continue;
                    };
                    let ExprData::EString(key_str) = &key_expr.data else {
                        builder.record_error(CompilerErrorDetail {
                            category: ErrorCategory::Todo,
                            reason: "(BuildHIR::lowerJsxCall) non-string JSX attribute key"
                                .to_string(),
                            description: None,
                            loc: convert_loc(key_expr.loc),
                            suggestions: None,
                        })?;
                        continue;
                    };
                    let key_loc = convert_loc(key_expr.loc);
                    let name = estring_to_string(key_str, &key_loc)?;
                    let Some(value_expr) = prop.value.as_ref() else {
                        continue;
                    };
                    let place = lower_expression_to_temporary(builder, value_expr)?;
                    props.push(JsxAttribute::Attribute { name, place });
                }
            }
            // E::Null → no props.
        }
        for child in args.iter().skip(2) {
            let place = lower_expression_to_temporary(builder, child)?;
            children.push(place);
        }
    }

    Ok(InstructionValue::JsxExpression {
        tag,
        props,
        children: if children.is_empty() {
            None
        } else {
            Some(children)
        },
        loc,
        opening_loc,
        closing_loc,
    })
}

/// The visit pass packs children into the props object as either a single
/// expression or an `E::Array` (when there were ≥2 children or a spread child).
fn lower_jsx_children(
    builder: &mut HirBuilder,
    value: &Expr,
    is_static_children: bool,
    out: &mut Vec<Place>,
) -> Result<(), CompilerError> {
    if is_static_children {
        if let ExprData::EArray(arr) = &value.data {
            for item in arr.items.iter() {
                match &item.data {
                    ExprData::EMissing(_) => {}
                    ExprData::ESpread(spread) => {
                        out.push(lower_expression_to_temporary(builder, &spread.value)?);
                    }
                    _ => {
                        out.push(lower_expression_to_temporary(builder, item)?);
                    }
                }
            }
            return Ok(());
        }
    }
    out.push(lower_expression_to_temporary(builder, value)?);
    Ok(())
}

fn todo_err(reason: &str, loc: Option<SourceLocation>) -> CompilerError {
    let mut err = CompilerError::new();
    err.push_error_detail(CompilerErrorDetail {
        category: ErrorCategory::Todo,
        reason: reason.to_string(),
        description: None,
        loc,
        suggestions: None,
    });
    err
}
