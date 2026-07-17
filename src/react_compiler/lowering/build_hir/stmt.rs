//! Port of build_hir.rs lines 2304–4256 — see mod.rs.

use crate::diagnostics::{CompilerDiagnostic, CompilerError, CompilerErrorDetail, ErrorCategory};
use crate::hir::{
    ArrayPattern, ArrayPatternElement, AstAlloc, BinaryOperator, BlockKind, Case, Effect,
    EvaluationOrder, GotoVariant, HirVec, InstructionKind, InstructionValue, LValue, LValuePattern,
    ObjectPattern, ObjectProperty, ObjectPropertyOrSpread, ObjectPropertyType, Pattern, Place,
    PrimitiveValue, ReturnVariant, SourceLocation, SpreadPattern, Terminal, VariableBinding,
};
use bun_ast::expr::Data as ExprData;
use bun_ast::stmt::Data;
use bun_ast::{self as ast, Binding, Expr, G, Ref, Stmt, b, s};
use smallvec::SmallVec;

use crate::lowering::hir_builder::{HirBuilder, convert_loc};

use super::expr::lower_reorderable_expression;
use super::function::lower_function_declaration;
use super::helpers::{
    AssignmentStyle, IdentifierForAssignment, build_temporary_place, lower_assignment,
    lower_expression_to_temporary, lower_identifier_for_assignment, lower_object_property_key,
    lower_value_to_temporary, promote_temporary,
};

/// Extract the HIR SourceLocation from a Statement AST node.
fn statement_loc(stmt: &Stmt) -> Option<SourceLocation> {
    convert_loc(stmt.loc)
}

// =============================================================================
// lower_block_statement (with hoisting)
// =============================================================================

/// Lower a BlockStatement with hoisting support.
///
/// Implements the TS BlockStatement hoisting pass: identifies forward references to
/// block-scoped bindings and emits DeclareContext instructions to hoist them.
pub(super) fn lower_block_statement(
    builder: &mut HirBuilder,
    body: &[Stmt],
) -> Result<(), CompilerDiagnostic> {
    lower_block_statement_inner(builder, body)
}

pub(super) fn lower_block_statement_with_scope(
    builder: &mut HirBuilder,
    body: &[Stmt],
) -> Result<(), CompilerDiagnostic> {
    lower_block_statement_inner(builder, body)
}

// Upstream's BlockStatement hoisting only emits a `DeclareContext` for a
// let/const binding referenced from inside a nested function (`fnDepth > 0`)
// or for a function declaration referenced anywhere (`binding.kind ===
// 'hoisted'`); a plain forward reference to a let/const is left for EnterSSA
// to reject. The `DeclareContext` goes immediately before the first
// referencing statement so EnterSSA sees a definition before the use. Bun
// mirrors upstream's in-order statement walk by index: a binding declared at
// body[j] is checked against body[i] for i < j, and against only this
// statement's own initializer expressions when i == j (the binding pattern
// itself is the definition, not a reference). The scan is bounded to this
// block's direct statements; blocks with no let/const or function
// declarations fall straight through to lowering.
fn lower_block_statement_inner(
    builder: &mut HirBuilder,
    body: &[Stmt],
) -> Result<(), CompilerDiagnostic> {
    // Phase 1: collect this block's let/const/function bindings by statement index.
    let mut decls: SmallVec<[(usize, Ref, ast::Loc, InstructionKind); 8]> = SmallVec::new();
    for (i, stmt) in body.iter().enumerate() {
        match &stmt.data {
            Data::SLocal(local) => {
                let kind = match local.kind {
                    s::Kind::KLet => InstructionKind::HoistedLet,
                    s::Kind::KConst => InstructionKind::HoistedConst,
                    _ => continue,
                };
                for d in local.decls.iter() {
                    collect_binding_refs(&d.binding, &mut |r, loc| {
                        decls.push((i, builder.resolve_ref(r), loc, kind));
                    });
                }
            }
            Data::SFunction(f) => {
                if let Some(name) = f.func.name {
                    decls.push((
                        i,
                        builder.resolve_ref(name.ref_),
                        name.loc,
                        InstructionKind::HoistedFunction,
                    ));
                }
            }
            _ => {}
        }
    }

    if decls.is_empty() {
        for body_stmt in body {
            lower_statement(builder, body_stmt, None)?;
        }
        return Ok(());
    }

    // Phase 2: for each statement preceding (or equal to) a decl's index,
    // scan its subtree for a reference to that decl. Upstream only hoists a
    // reference when it sits inside a nested function (`fnDepth > 0`) or the
    // target is a function declaration (`binding.kind === 'hoisted'`), so a
    // plain forward reference to a let/const is left for EnterSSA to reject.
    // The `ref_in_nested_fn_*` walkers match at `depth > 0` and increment on
    // function entry, so the nested-function filter is a start depth of 0;
    // HoistedFunction targets start at 1 to match at any nesting level.
    // Record the statement index of the first reference so DeclareContext is
    // emitted immediately before that statement (matching upstream); emitting
    // it any earlier would extend the variable's mutable range across
    // unrelated instructions (e.g. a preceding hook call), which causes the
    // resulting scope to be flattened.
    let mut hoist: SmallVec<[(usize, Ref, ast::Loc, InstructionKind); 4]> = SmallVec::new();
    'outer: for (i, stmt) in body.iter().enumerate() {
        let mut k = 0;
        while k < decls.len() {
            let (decl_i, target, loc, kind) = decls[k];
            let depth = u32::from(kind == InstructionKind::HoistedFunction);
            let found = if decl_i > i {
                ref_in_nested_fn_stmt(builder, target, stmt, depth)
            } else if decl_i == i {
                // Self-reference: only the initializer expressions of this
                // statement count (the binding pattern itself is the def).
                match &stmt.data {
                    Data::SLocal(local) => local.decls.iter().any(|d| {
                        d.value
                            .as_ref()
                            .is_some_and(|v| ref_in_nested_fn_expr(builder, target, v, depth))
                    }),
                    Data::SFunction(f) => ref_in_nested_fn_func(builder, target, &f.func, depth),
                    _ => false,
                }
            } else {
                false
            };
            if found {
                hoist.push((i, target, loc, kind));
                decls.swap_remove(k);
                if decls.is_empty() {
                    break 'outer;
                }
            } else {
                k += 1;
            }
        }
    }

    let mut h = 0;
    for (i, body_stmt) in body.iter().enumerate() {
        while h < hoist.len() && hoist[h].0 == i {
            let (_, target, loc, kind) = hoist[h];
            h += 1;
            if builder.is_context_identifier(target) {
                continue;
            }
            let id_loc = convert_loc(loc);
            if let VariableBinding::Identifier { identifier, .. } =
                builder.resolve_identifier(target, id_loc)?
            {
                let place = Place {
                    identifier,
                    effect: Effect::Unknown,
                    reactive: false,
                    loc: id_loc,
                };
                lower_value_to_temporary(
                    builder,
                    InstructionValue::DeclareContext {
                        lvalue: LValue { kind, place },
                        loc: id_loc,
                    },
                )?;
                builder.add_context_identifier(target);
                builder
                    .environment_mut()
                    .add_hoisted_identifier(target.inner_index());
            }
        }
        lower_statement(builder, body_stmt, None)?;
    }
    Ok(())
}

fn collect_binding_refs(binding: &Binding, f: &mut impl FnMut(Ref, ast::Loc)) {
    match &binding.data {
        b::B::BIdentifier(id) => f(id.r#ref, binding.loc),
        b::B::BArray(arr) => {
            for item in arr.items().iter() {
                collect_binding_refs(&item.binding, f);
            }
        }
        b::B::BObject(obj) => {
            for p in obj.properties().iter() {
                collect_binding_refs(&p.value, f);
            }
        }
        b::B::BMissing(_) => {}
    }
}

// Upstream's BlockStatement hoisting (dropped in the Bun port — see above) puts
// the catch param in `hoistableIdentifiers` because Babel attaches it to the
// catch body's block scope with `kind: 'let'`. When the param is referenced
// from inside a nested function in the catch body the hoist pass emits
// `DeclareContext` + `addHoistedIdentifier`, after `lowerAssignment` already
// emitted a `StoreLocal` for it. Replicate just enough of that scan here so
// `validateContextVariableLValues` observes the same Local→Context conflict.
fn catch_param_referenced_in_nested_fn(builder: &HirBuilder, target: Ref, body: &[Stmt]) -> bool {
    body.iter()
        .any(|s| ref_in_nested_fn_stmt(builder, target, s, 0))
}

fn ref_in_nested_fn_stmt(builder: &HirBuilder, target: Ref, stmt: &Stmt, depth: u32) -> bool {
    match &stmt.data {
        Data::SBlock(b) => b
            .stmts
            .slice()
            .iter()
            .any(|s| ref_in_nested_fn_stmt(builder, target, s, depth)),
        Data::SExpr(e) => ref_in_nested_fn_expr(builder, target, &e.value, depth),
        Data::SLocal(l) => l.decls.iter().any(|d| {
            d.value
                .as_ref()
                .is_some_and(|v| ref_in_nested_fn_expr(builder, target, v, depth))
                || ref_in_nested_fn_binding(builder, target, &d.binding, depth)
        }),
        Data::SReturn(r) => r
            .value
            .as_ref()
            .is_some_and(|v| ref_in_nested_fn_expr(builder, target, v, depth)),
        Data::SThrow(t) => ref_in_nested_fn_expr(builder, target, &t.value, depth),
        Data::SIf(i) => {
            ref_in_nested_fn_expr(builder, target, &i.test_, depth)
                || ref_in_nested_fn_stmt(builder, target, &i.yes, depth)
                || i.no
                    .as_ref()
                    .is_some_and(|n| ref_in_nested_fn_stmt(builder, target, n, depth))
        }
        Data::SFor(f) => {
            f.init
                .as_ref()
                .is_some_and(|s| ref_in_nested_fn_stmt(builder, target, s, depth))
                || f.test_
                    .as_ref()
                    .is_some_and(|e| ref_in_nested_fn_expr(builder, target, e, depth))
                || f.update
                    .as_ref()
                    .is_some_and(|e| ref_in_nested_fn_expr(builder, target, e, depth))
                || ref_in_nested_fn_stmt(builder, target, &f.body, depth)
        }
        Data::SForIn(f) => {
            ref_in_nested_fn_stmt(builder, target, &f.init, depth)
                || ref_in_nested_fn_expr(builder, target, &f.value, depth)
                || ref_in_nested_fn_stmt(builder, target, &f.body, depth)
        }
        Data::SForOf(f) => {
            ref_in_nested_fn_stmt(builder, target, &f.init, depth)
                || ref_in_nested_fn_expr(builder, target, &f.value, depth)
                || ref_in_nested_fn_stmt(builder, target, &f.body, depth)
        }
        Data::SWhile(w) => {
            ref_in_nested_fn_expr(builder, target, &w.test_, depth)
                || ref_in_nested_fn_stmt(builder, target, &w.body, depth)
        }
        Data::SDoWhile(d) => {
            ref_in_nested_fn_stmt(builder, target, &d.body, depth)
                || ref_in_nested_fn_expr(builder, target, &d.test_, depth)
        }
        Data::SSwitch(sw) => {
            ref_in_nested_fn_expr(builder, target, &sw.test_, depth)
                || sw.cases.slice().iter().any(|c| {
                    c.value
                        .as_ref()
                        .is_some_and(|v| ref_in_nested_fn_expr(builder, target, v, depth))
                        || c.body
                            .slice()
                            .iter()
                            .any(|s| ref_in_nested_fn_stmt(builder, target, s, depth))
                })
        }
        Data::STry(t) => {
            t.body
                .slice()
                .iter()
                .any(|s| ref_in_nested_fn_stmt(builder, target, s, depth))
                || t.catch_.as_ref().is_some_and(|c| {
                    c.body
                        .slice()
                        .iter()
                        .any(|s| ref_in_nested_fn_stmt(builder, target, s, depth))
                })
                || t.finally.as_ref().is_some_and(|f| {
                    f.stmts
                        .slice()
                        .iter()
                        .any(|s| ref_in_nested_fn_stmt(builder, target, s, depth))
                })
        }
        Data::SLabel(l) => ref_in_nested_fn_stmt(builder, target, &l.stmt, depth),
        Data::SWith(w) => {
            ref_in_nested_fn_expr(builder, target, &w.value, depth)
                || ref_in_nested_fn_stmt(builder, target, &w.body, depth)
        }
        Data::SFunction(f) => ref_in_nested_fn_func(builder, target, &f.func, depth),
        Data::SClass(c) => ref_in_nested_fn_class(builder, target, &c.class, depth),
        Data::SExportDefault(e) => match &e.value {
            ast::StmtOrExpr::Stmt(s) => ref_in_nested_fn_stmt(builder, target, s, depth),
            ast::StmtOrExpr::Expr(e) => ref_in_nested_fn_expr(builder, target, e, depth),
        },
        Data::SExportEquals(e) => ref_in_nested_fn_expr(builder, target, &e.value, depth),
        _ => false,
    }
}

fn ref_in_nested_fn_binding(
    builder: &HirBuilder,
    target: Ref,
    binding: &Binding,
    depth: u32,
) -> bool {
    match &binding.data {
        b::B::BArray(arr) => arr.items().iter().any(|item| {
            ref_in_nested_fn_binding(builder, target, &item.binding, depth)
                || item
                    .default_value
                    .as_ref()
                    .is_some_and(|d| ref_in_nested_fn_expr(builder, target, d, depth))
        }),
        b::B::BObject(obj) => obj.properties().iter().any(|p| {
            (p.flags.contains(ast::flags::Property::IsComputed)
                && ref_in_nested_fn_expr(builder, target, &p.key, depth))
                || ref_in_nested_fn_binding(builder, target, &p.value, depth)
                || p.default_value
                    .as_ref()
                    .is_some_and(|d| ref_in_nested_fn_expr(builder, target, d, depth))
        }),
        b::B::BIdentifier(_) | b::B::BMissing(_) => false,
    }
}

fn ref_in_nested_fn_func(builder: &HirBuilder, target: Ref, func: &G::Fn, depth: u32) -> bool {
    let depth = depth + 1;
    func.args.slice().iter().any(|a| {
        a.default
            .as_ref()
            .is_some_and(|d| ref_in_nested_fn_expr(builder, target, d, depth))
            || ref_in_nested_fn_binding(builder, target, &a.binding, depth)
    }) || func
        .body
        .stmts
        .slice()
        .iter()
        .any(|s| ref_in_nested_fn_stmt(builder, target, s, depth))
}

fn ref_in_nested_fn_class(builder: &HirBuilder, target: Ref, class: &G::Class, depth: u32) -> bool {
    class
        .extends
        .as_ref()
        .is_some_and(|e| ref_in_nested_fn_expr(builder, target, e, depth))
        || class.properties.slice().iter().any(|p| {
            if let Some(block) = p.class_static_block_ref() {
                return block
                    .stmts
                    .iter()
                    .any(|s| ref_in_nested_fn_stmt(builder, target, s, depth + 1));
            }
            (p.flags.contains(ast::flags::Property::IsComputed)
                && p.key
                    .as_ref()
                    .is_some_and(|k| ref_in_nested_fn_expr(builder, target, k, depth)))
                || p.value
                    .as_ref()
                    .is_some_and(|v| ref_in_nested_fn_expr(builder, target, v, depth))
                || p.initializer
                    .as_ref()
                    .is_some_and(|i| ref_in_nested_fn_expr(builder, target, i, depth))
        })
}

#[allow(clippy::too_many_lines)]
fn ref_in_nested_fn_expr(builder: &HirBuilder, target: Ref, e: &Expr, depth: u32) -> bool {
    match &e.data {
        ExprData::EIdentifier(id) => depth > 0 && builder.resolve_ref(id.ref_) == target,
        ExprData::EImportIdentifier(id) => depth > 0 && builder.resolve_ref(id.ref_) == target,
        ExprData::EBinary(b) => {
            ref_in_nested_fn_expr(builder, target, &b.left, depth)
                || ref_in_nested_fn_expr(builder, target, &b.right, depth)
        }
        ExprData::EUnary(u) => ref_in_nested_fn_expr(builder, target, &u.value, depth),
        ExprData::EArrow(a) => {
            let depth = depth + 1;
            a.args.slice().iter().any(|arg| {
                arg.default
                    .as_ref()
                    .is_some_and(|d| ref_in_nested_fn_expr(builder, target, d, depth))
                    || ref_in_nested_fn_binding(builder, target, &arg.binding, depth)
            }) || a
                .body
                .stmts
                .slice()
                .iter()
                .any(|s| ref_in_nested_fn_stmt(builder, target, s, depth))
        }
        ExprData::EFunction(f) => ref_in_nested_fn_func(builder, target, &f.func, depth),
        ExprData::EClass(c) => ref_in_nested_fn_class(builder, target, c, depth),
        ExprData::EArray(a) => a
            .items
            .iter()
            .any(|i| ref_in_nested_fn_expr(builder, target, i, depth)),
        ExprData::EObject(o) => o.properties.iter().any(|p| {
            (p.flags.contains(ast::flags::Property::IsComputed)
                && p.key
                    .as_ref()
                    .is_some_and(|k| ref_in_nested_fn_expr(builder, target, k, depth)))
                || p.value
                    .as_ref()
                    .is_some_and(|v| ref_in_nested_fn_expr(builder, target, v, depth))
                || p.initializer
                    .as_ref()
                    .is_some_and(|i| ref_in_nested_fn_expr(builder, target, i, depth))
        }),
        ExprData::ESpread(s) => ref_in_nested_fn_expr(builder, target, &s.value, depth),
        ExprData::EIf(c) => {
            ref_in_nested_fn_expr(builder, target, &c.test_, depth)
                || ref_in_nested_fn_expr(builder, target, &c.yes, depth)
                || ref_in_nested_fn_expr(builder, target, &c.no, depth)
        }
        ExprData::EDot(d) => ref_in_nested_fn_expr(builder, target, &d.target, depth),
        ExprData::EIndex(i) => {
            ref_in_nested_fn_expr(builder, target, &i.target, depth)
                || ref_in_nested_fn_expr(builder, target, &i.index, depth)
        }
        ExprData::ECall(c) => {
            ref_in_nested_fn_expr(builder, target, &c.target, depth)
                || c.args
                    .iter()
                    .any(|a| ref_in_nested_fn_expr(builder, target, a, depth))
        }
        ExprData::ENew(n) => {
            ref_in_nested_fn_expr(builder, target, &n.target, depth)
                || n.args
                    .iter()
                    .any(|a| ref_in_nested_fn_expr(builder, target, a, depth))
        }
        ExprData::EImport(i) => {
            ref_in_nested_fn_expr(builder, target, &i.expr, depth)
                || ref_in_nested_fn_expr(builder, target, &i.options, depth)
        }
        ExprData::EAwait(a) => ref_in_nested_fn_expr(builder, target, &a.value, depth),
        ExprData::EYield(y) => y
            .value
            .as_ref()
            .is_some_and(|v| ref_in_nested_fn_expr(builder, target, v, depth)),
        ExprData::ETemplate(t) => {
            t.tag
                .as_ref()
                .is_some_and(|tag| ref_in_nested_fn_expr(builder, target, tag, depth))
                || t.parts()
                    .iter()
                    .any(|p| ref_in_nested_fn_expr(builder, target, &p.value, depth))
        }
        ExprData::EJsxElement(j) => {
            j.tag
                .as_ref()
                .is_some_and(|tag| ref_in_nested_fn_expr(builder, target, tag, depth))
                || j.properties.iter().any(|p| {
                    p.value
                        .as_ref()
                        .is_some_and(|v| ref_in_nested_fn_expr(builder, target, v, depth))
                        || p.initializer
                            .as_ref()
                            .is_some_and(|i| ref_in_nested_fn_expr(builder, target, i, depth))
                })
                || j.children
                    .iter()
                    .any(|c| ref_in_nested_fn_expr(builder, target, c, depth))
        }
        ExprData::EInlinedEnum(ie) => ref_in_nested_fn_expr(builder, target, &ie.value, depth),
        _ => false,
    }
}

// =============================================================================
// lower_statement
// =============================================================================

#[allow(clippy::too_many_lines)]
pub(crate) fn lower_statement(
    builder: &mut HirBuilder,
    stmt: &Stmt,
    label: Option<String>,
) -> Result<(), CompilerDiagnostic> {
    let stmt_loc = stmt.loc;
    match stmt.data {
        Data::SEmpty(_) => {
            // no-op
        }
        Data::SDebugger(_) => {
            let loc = convert_loc(stmt_loc);
            let value = InstructionValue::Debugger { loc };
            lower_value_to_temporary(builder, value)?;
        }
        Data::SExpr(expr_stmt) => {
            lower_expression_to_temporary(builder, &expr_stmt.value)?;
        }
        Data::SReturn(ret) => {
            let loc = convert_loc(stmt_loc);
            let value = if let Some(arg) = &ret.value {
                lower_expression_to_temporary(builder, arg)?
            } else {
                let undefined_value = InstructionValue::Primitive {
                    value: PrimitiveValue::Undefined,
                    loc: None,
                };
                lower_value_to_temporary(builder, undefined_value)?
            };
            let fallthrough = builder.reserve(BlockKind::Block);
            builder.terminate_with_continuation(
                Terminal::Return {
                    value,
                    return_variant: ReturnVariant::Explicit,
                    id: EvaluationOrder(0),
                    loc,
                    effects: None,
                },
                fallthrough,
            );
        }
        Data::SThrow(throw) => {
            let loc = convert_loc(stmt_loc);
            let value = lower_expression_to_temporary(builder, &throw.value)?;

            // Check for throw handler (try/catch)
            if let Some(_handler) = builder.resolve_throw_handler() {
                builder.record_error(CompilerErrorDetail {
                    category: ErrorCategory::Todo,
                    reason: "(BuildHIR::lowerStatement) Support ThrowStatement inside of try/catch"
                        .to_string(),
                    description: None,
                    loc,
                    suggestions: None,
                })?;
            }

            let fallthrough = builder.reserve(BlockKind::Block);
            builder.terminate_with_continuation(
                Terminal::Throw {
                    value,
                    id: EvaluationOrder(0),
                    loc,
                },
                fallthrough,
            );
        }
        Data::SBlock(block) => {
            builder.push_scope(stmt_loc);
            let result = lower_block_statement(builder, &block.stmts);
            builder.pop_scope();
            result?;
        }
        Data::SLocal(var_decl) => {
            if matches!(var_decl.kind, s::Kind::KVar) {
                builder.record_error(CompilerErrorDetail {
                    reason: "(BuildHIR::lowerStatement) Handle var kinds in VariableDeclaration"
                        .to_string(),
                    category: ErrorCategory::Todo,
                    loc: convert_loc(stmt_loc),
                    description: None,
                    suggestions: None,
                })?;
                // Treat `var` as `let` so references to the variable don't break
            }
            let kind = match var_decl.kind {
                s::Kind::KLet | s::Kind::KVar => InstructionKind::Let,
                s::Kind::KConst | s::Kind::KUsing => InstructionKind::Const,
                s::Kind::KAwaitUsing => {
                    builder.record_error(CompilerErrorDetail {
                        reason: "(BuildHIR::lowerStatement) Handle `await using` declarations"
                            .to_string(),
                        category: ErrorCategory::Todo,
                        loc: convert_loc(stmt_loc),
                        description: None,
                        suggestions: None,
                    })?;
                    InstructionKind::Const
                }
            };
            for declarator in var_decl.decls.iter() {
                let stmt_loc = convert_loc(stmt.loc);
                if let Some(init) = &declarator.value {
                    let value = lower_expression_to_temporary(builder, init)?;
                    let assign_style = match declarator.binding.data {
                        b::B::BObject(_) | b::B::BArray(_) => AssignmentStyle::Destructure,
                        _ => AssignmentStyle::Assignment,
                    };
                    lower_assignment_binding(
                        builder,
                        stmt_loc,
                        kind,
                        &declarator.binding,
                        value,
                        assign_style,
                    )?;
                } else if let b::B::BIdentifier(id) = declarator.binding.data {
                    // No init: emit DeclareLocal or DeclareContext
                    let id_loc = convert_loc(declarator.binding.loc);
                    let binding = builder.resolve_identifier(id.r#ref, id_loc)?;
                    match binding {
                        VariableBinding::Identifier { identifier, .. } => {
                            // Update the identifier's loc to the declaration site
                            // (it may have been first created at a reference site during hoisting)
                            builder.set_identifier_declaration_loc(identifier, &id_loc);
                            let place = Place {
                                identifier,
                                effect: Effect::Unknown,
                                reactive: false,
                                loc: id_loc,
                            };
                            if builder.is_context_identifier(id.r#ref) {
                                if kind == InstructionKind::Const {
                                    builder.record_error(CompilerErrorDetail {
                                        reason: "Expect `const` declaration not to be reassigned"
                                            .to_string(),
                                        category: ErrorCategory::Syntax,
                                        loc: id_loc,
                                        description: None,
                                        suggestions: None,
                                    })?;
                                }
                                lower_value_to_temporary(
                                    builder,
                                    InstructionValue::DeclareContext {
                                        lvalue: LValue {
                                            kind: InstructionKind::Let,
                                            place,
                                        },
                                        loc: id_loc,
                                    },
                                )?;
                            } else {
                                lower_value_to_temporary(
                                    builder,
                                    InstructionValue::DeclareLocal {
                                        lvalue: LValue { kind, place },
                                        type_annotation: None,
                                        loc: id_loc,
                                    },
                                )?;
                            }
                        }
                        _ => {
                            builder.record_error(CompilerErrorDetail {
                                reason: "Could not find binding for declaration".to_string(),
                                category: ErrorCategory::Invariant,
                                loc: id_loc,
                                description: None,
                                suggestions: None,
                            })?;
                        }
                    }
                } else {
                    builder.record_error(CompilerErrorDetail {
                        reason: "Expected variable declaration to be an identifier if no initializer was provided".to_string(),
                        category: ErrorCategory::Syntax,
                        loc: convert_loc(declarator.binding.loc),
                        description: None,
                        suggestions: None,
                    })?;
                }
            }
        }
        Data::SBreak(brk) => {
            let loc = convert_loc(stmt_loc);
            let label_name = label_string(builder, brk.label)?;
            let target = builder.lookup_break(label_name.as_deref())?;
            let fallthrough = builder.reserve(BlockKind::Block);
            builder.terminate_with_continuation(
                Terminal::Goto {
                    block: target,
                    variant: GotoVariant::Break,
                    id: EvaluationOrder(0),
                    loc,
                },
                fallthrough,
            );
        }
        Data::SContinue(cont) => {
            let loc = convert_loc(stmt_loc);
            let label_name = label_string(builder, cont.label)?;
            let target = builder.lookup_continue(label_name.as_deref())?;
            let fallthrough = builder.reserve(BlockKind::Block);
            builder.terminate_with_continuation(
                Terminal::Goto {
                    block: target,
                    variant: GotoVariant::Continue,
                    id: EvaluationOrder(0),
                    loc,
                },
                fallthrough,
            );
        }
        Data::SIf(if_stmt) => {
            let loc = convert_loc(stmt_loc);
            // Block for code following the if
            let continuation_block = builder.reserve(BlockKind::Block);
            let continuation_id = continuation_block.id;

            // Block for the consequent (if the test is truthy)
            let consequent_loc = statement_loc(&if_stmt.yes);
            let consequent_block = builder.try_enter(BlockKind::Block, |builder, _block_id| {
                lower_statement(builder, &if_stmt.yes, None)?;
                Ok(Terminal::Goto {
                    block: continuation_id,
                    variant: GotoVariant::Break,
                    id: EvaluationOrder(0),
                    loc: consequent_loc,
                })
            })?;

            // Block for the alternate (if the test is not truthy)
            let alternate_block = if let Some(alternate) = &if_stmt.no {
                let alternate_loc = statement_loc(alternate);
                builder.try_enter(BlockKind::Block, |builder, _block_id| {
                    lower_statement(builder, alternate, None)?;
                    Ok(Terminal::Goto {
                        block: continuation_id,
                        variant: GotoVariant::Break,
                        id: EvaluationOrder(0),
                        loc: alternate_loc,
                    })
                })?
            } else {
                // If there is no else clause, use the continuation directly
                continuation_id
            };

            let test = lower_expression_to_temporary(builder, &if_stmt.test_)?;
            builder.terminate_with_continuation(
                Terminal::If {
                    test,
                    consequent: consequent_block,
                    alternate: alternate_block,
                    fallthrough: continuation_id,
                    id: EvaluationOrder(0),
                    loc,
                },
                continuation_block,
            );
        }
        Data::SFor(for_stmt) => {
            let loc = convert_loc(stmt_loc);
            builder.push_scope(stmt_loc);

            let test_block = builder.reserve(BlockKind::Loop);
            let test_block_id = test_block.id;
            // Block for code following the loop
            let continuation_block = builder.reserve(BlockKind::Block);
            let continuation_id = continuation_block.id;

            // Init block: lower init expression/declaration, then goto test
            let init_block = builder.try_enter(BlockKind::Loop, |builder, _block_id| {
                let init_loc = match &for_stmt.init {
                    None => {
                        // No init expression (e.g., `for (; ...)`), add a placeholder
                        let placeholder = InstructionValue::Primitive {
                            value: PrimitiveValue::Undefined,
                            loc,
                        };
                        lower_value_to_temporary(builder, placeholder)?;
                        loc
                    }
                    Some(init) => {
                        match init.data {
                            Data::SLocal(_) => {
                                let init_loc = convert_loc(init.loc);
                                lower_statement(builder, init, None)?;
                                init_loc
                            }
                            Data::SExpr(expr) => {
                                let init_loc = convert_loc(expr.value.loc);
                                builder.record_error(CompilerErrorDetail {
                                    category: ErrorCategory::Todo,
                                    reason: "(BuildHIR::lowerStatement) Handle non-variable initialization in ForStatement".to_string(),
                                    description: None,
                                    loc,
                                    suggestions: None,
                                })?;
                                lower_expression_to_temporary(builder, &expr.value)?;
                                init_loc
                            }
                            _ => {
                                lower_statement(builder, init, None)?;
                                convert_loc(init.loc)
                            }
                        }
                    }
                };
                Ok(Terminal::Goto {
                    block: test_block_id,
                    variant: GotoVariant::Break,
                    id: EvaluationOrder(0),
                    loc: init_loc,
                })
            })?;

            // Update block (optional)
            let update_block_id = if let Some(update) = &for_stmt.update {
                let update_loc = convert_loc(update.loc);
                Some(builder.try_enter(BlockKind::Loop, |builder, _block_id| {
                    lower_expression_to_temporary(builder, update)?;
                    Ok(Terminal::Goto {
                        block: test_block_id,
                        variant: GotoVariant::Break,
                        id: EvaluationOrder(0),
                        loc: update_loc,
                    })
                })?)
            } else {
                None
            };

            // Loop body block
            let continue_target = update_block_id.unwrap_or(test_block_id);
            let body_loc = statement_loc(&for_stmt.body);
            let body_block = builder.try_enter(BlockKind::Block, |builder, _block_id| {
                builder.loop_scope(label, continue_target, continuation_id, |builder| {
                    lower_statement(builder, &for_stmt.body, None)?;
                    Ok(Terminal::Goto {
                        block: continue_target,
                        variant: GotoVariant::Continue,
                        id: EvaluationOrder(0),
                        loc: body_loc,
                    })
                })
            })?;

            // Emit For terminal, then fill in the test block
            builder.terminate_with_continuation(
                Terminal::For {
                    init: init_block,
                    test: test_block_id,
                    update: update_block_id,
                    loop_block: body_block,
                    fallthrough: continuation_id,
                    id: EvaluationOrder(0),
                    loc,
                },
                test_block,
            );

            // Fill in the test block
            if let Some(test_expr) = &for_stmt.test_ {
                let test = lower_expression_to_temporary(builder, test_expr)?;
                builder.terminate_with_continuation(
                    Terminal::Branch {
                        test,
                        consequent: body_block,
                        alternate: continuation_id,
                        fallthrough: continuation_id,
                        id: EvaluationOrder(0),
                        loc,
                    },
                    continuation_block,
                );
            } else {
                builder.record_error(CompilerErrorDetail {
                    category: ErrorCategory::Todo,
                    reason: "(BuildHIR::lowerStatement) Handle empty test in ForStatement"
                        .to_string(),
                    description: None,
                    loc,
                    suggestions: None,
                })?;
                // Treat `for(;;)` as `while(true)` to keep the builder state consistent
                let true_val = InstructionValue::Primitive {
                    value: PrimitiveValue::Boolean(true),
                    loc,
                };
                let test = lower_value_to_temporary(builder, true_val)?;
                builder.terminate_with_continuation(
                    Terminal::Branch {
                        test,
                        consequent: body_block,
                        alternate: continuation_id,
                        fallthrough: continuation_id,
                        id: EvaluationOrder(0),
                        loc,
                    },
                    continuation_block,
                );
            }
            builder.pop_scope();
        }
        Data::SWhile(while_stmt) => {
            let loc = convert_loc(stmt_loc);
            // Block used to evaluate whether to (re)enter or exit the loop
            let conditional_block = builder.reserve(BlockKind::Loop);
            let conditional_id = conditional_block.id;
            // Block for code following the loop
            let continuation_block = builder.reserve(BlockKind::Block);
            let continuation_id = continuation_block.id;

            // Loop body
            let body_loc = statement_loc(&while_stmt.body);
            let loop_block = builder.try_enter(BlockKind::Block, |builder, _block_id| {
                builder.loop_scope(label, conditional_id, continuation_id, |builder| {
                    lower_statement(builder, &while_stmt.body, None)?;
                    Ok(Terminal::Goto {
                        block: conditional_id,
                        variant: GotoVariant::Continue,
                        id: EvaluationOrder(0),
                        loc: body_loc,
                    })
                })
            })?;

            // Emit While terminal, jumping to the conditional block
            builder.terminate_with_continuation(
                Terminal::While {
                    test: conditional_id,
                    loop_block,
                    fallthrough: continuation_id,
                    id: EvaluationOrder(0),
                    loc,
                },
                conditional_block,
            );

            // Fill in the conditional block: lower test, branch
            let test = lower_expression_to_temporary(builder, &while_stmt.test_)?;
            builder.terminate_with_continuation(
                Terminal::Branch {
                    test,
                    consequent: loop_block,
                    alternate: continuation_id,
                    fallthrough: conditional_id,
                    id: EvaluationOrder(0),
                    loc,
                },
                continuation_block,
            );
        }
        Data::SDoWhile(do_while_stmt) => {
            let loc = convert_loc(stmt_loc);
            // Block used to evaluate whether to (re)enter or exit the loop
            let conditional_block = builder.reserve(BlockKind::Loop);
            let conditional_id = conditional_block.id;
            // Block for code following the loop
            let continuation_block = builder.reserve(BlockKind::Block);
            let continuation_id = continuation_block.id;

            // Loop body, executed at least once unconditionally prior to exit
            let body_loc = statement_loc(&do_while_stmt.body);
            let loop_block = builder.try_enter(BlockKind::Block, |builder, _block_id| {
                builder.loop_scope(label, conditional_id, continuation_id, |builder| {
                    lower_statement(builder, &do_while_stmt.body, None)?;
                    Ok(Terminal::Goto {
                        block: conditional_id,
                        variant: GotoVariant::Continue,
                        id: EvaluationOrder(0),
                        loc: body_loc,
                    })
                })
            })?;

            // Jump to the conditional block
            builder.terminate_with_continuation(
                Terminal::DoWhile {
                    loop_block,
                    test: conditional_id,
                    fallthrough: continuation_id,
                    id: EvaluationOrder(0),
                    loc,
                },
                conditional_block,
            );

            // Fill in the conditional block: lower test, branch
            let test = lower_expression_to_temporary(builder, &do_while_stmt.test_)?;
            builder.terminate_with_continuation(
                Terminal::Branch {
                    test,
                    consequent: loop_block,
                    alternate: continuation_id,
                    fallthrough: conditional_id,
                    id: EvaluationOrder(0),
                    loc,
                },
                continuation_block,
            );
        }
        Data::SForIn(for_in) => {
            let loc = convert_loc(stmt_loc);
            builder.push_scope(stmt_loc);
            let continuation_block = builder.reserve(BlockKind::Block);
            let continuation_id = continuation_block.id;
            let init_block = builder.reserve(BlockKind::Loop);
            let init_block_id = init_block.id;

            let body_loc = statement_loc(&for_in.body);
            let loop_block = builder.try_enter(BlockKind::Block, |builder, _block_id| {
                builder.loop_scope(label, init_block_id, continuation_id, |builder| {
                    lower_statement(builder, &for_in.body, None)?;
                    Ok(Terminal::Goto {
                        block: init_block_id,
                        variant: GotoVariant::Continue,
                        id: EvaluationOrder(0),
                        loc: body_loc,
                    })
                })
            })?;

            let value = lower_expression_to_temporary(builder, &for_in.value)?;
            builder.terminate_with_continuation(
                Terminal::ForIn {
                    init: init_block_id,
                    loop_block,
                    fallthrough: continuation_id,
                    id: EvaluationOrder(0),
                    loc,
                },
                init_block,
            );

            // Lower the init: NextPropertyOf + assignment
            let left_loc = convert_loc(for_in.init.loc).or(loc);
            let next_property = lower_value_to_temporary(
                builder,
                InstructionValue::NextPropertyOf {
                    value,
                    loc: left_loc,
                },
            )?;

            let assign_result = lower_for_in_of_left(
                builder,
                &for_in.init,
                left_loc,
                next_property.clone(),
                "ForInStatement",
            )?;
            // Use the assign result (StoreLocal temp) as the test, matching TS behavior
            let test_value = assign_result.unwrap_or(next_property);
            let test = lower_value_to_temporary(
                builder,
                InstructionValue::LoadLocal {
                    place: test_value,
                    loc: left_loc,
                },
            )?;
            builder.terminate_with_continuation(
                Terminal::Branch {
                    test,
                    consequent: loop_block,
                    alternate: continuation_id,
                    fallthrough: continuation_id,
                    id: EvaluationOrder(0),
                    loc,
                },
                continuation_block,
            );
            builder.pop_scope();
        }
        Data::SForOf(for_of) => {
            let loc = convert_loc(stmt_loc);
            builder.push_scope(stmt_loc);
            let continuation_block = builder.reserve(BlockKind::Block);
            let continuation_id = continuation_block.id;
            let init_block = builder.reserve(BlockKind::Loop);
            let init_block_id = init_block.id;
            let test_block = builder.reserve(BlockKind::Loop);
            let test_block_id = test_block.id;

            if for_of.is_await {
                builder.record_error(CompilerErrorDetail {
                    category: ErrorCategory::Todo,
                    reason: "(BuildHIR::lowerStatement) Handle for-await loops".to_string(),
                    description: None,
                    loc,
                    suggestions: None,
                })?;
                builder.pop_scope();
                return Ok(());
            }

            let body_loc = statement_loc(&for_of.body);
            let loop_block = builder.try_enter(BlockKind::Block, |builder, _block_id| {
                builder.loop_scope(label, init_block_id, continuation_id, |builder| {
                    lower_statement(builder, &for_of.body, None)?;
                    Ok(Terminal::Goto {
                        block: init_block_id,
                        variant: GotoVariant::Continue,
                        id: EvaluationOrder(0),
                        loc: body_loc,
                    })
                })
            })?;

            let value = lower_expression_to_temporary(builder, &for_of.value)?;
            builder.terminate_with_continuation(
                Terminal::ForOf {
                    init: init_block_id,
                    test: test_block_id,
                    loop_block,
                    fallthrough: continuation_id,
                    id: EvaluationOrder(0),
                    loc,
                },
                init_block,
            );

            // Init block: GetIterator, goto test
            let iterator = lower_value_to_temporary(
                builder,
                InstructionValue::GetIterator {
                    collection: value.clone(),
                    loc: value.loc,
                },
            )?;
            builder.terminate_with_continuation(
                Terminal::Goto {
                    block: test_block_id,
                    variant: GotoVariant::Break,
                    id: EvaluationOrder(0),
                    loc,
                },
                test_block,
            );

            // Test block: IteratorNext, assign, branch
            let left_loc = convert_loc(for_of.init.loc).or(loc);
            let advance_iterator = lower_value_to_temporary(
                builder,
                InstructionValue::IteratorNext {
                    iterator,
                    collection: value,
                    loc: left_loc,
                },
            )?;

            let assign_result = lower_for_in_of_left(
                builder,
                &for_of.init,
                left_loc,
                advance_iterator.clone(),
                "ForOfStatement",
            )?;
            // Use the assign result (StoreLocal temp) as the test, matching TS behavior
            let test_value = assign_result.unwrap_or(advance_iterator);
            let test = lower_value_to_temporary(
                builder,
                InstructionValue::LoadLocal {
                    place: test_value,
                    loc: left_loc,
                },
            )?;
            builder.terminate_with_continuation(
                Terminal::Branch {
                    test,
                    consequent: loop_block,
                    alternate: continuation_id,
                    fallthrough: continuation_id,
                    id: EvaluationOrder(0),
                    loc,
                },
                continuation_block,
            );
            builder.pop_scope();
        }
        Data::SSwitch(switch_stmt) => {
            let loc = convert_loc(stmt_loc);
            builder.push_scope(switch_stmt.body_loc);
            let continuation_block = builder.reserve(BlockKind::Block);
            let continuation_id = continuation_block.id;

            // Iterate through cases in reverse order so that previous blocks can
            // fallthrough to successors
            let mut fallthrough = continuation_id;
            let mut cases: HirVec<Case> = AstAlloc::vec();
            let mut has_default = false;

            for ii in (0..switch_stmt.cases.len()).rev() {
                let case = &switch_stmt.cases[ii];
                let case_loc = convert_loc(case.loc);

                if case.value.is_none() {
                    if has_default {
                        builder.record_error(CompilerErrorDetail {
                            category: ErrorCategory::Syntax,
                            reason: "Expected at most one `default` branch in a switch statement"
                                .to_string(),
                            description: None,
                            loc: case_loc,
                            suggestions: None,
                        })?;
                        break;
                    }
                    has_default = true;
                }

                let fallthrough_target = fallthrough;
                let block = builder.try_enter(BlockKind::Block, |builder, _block_id| {
                    builder.switch_scope(label.clone(), continuation_id, |builder| {
                        for consequent in case.body.iter() {
                            lower_statement(builder, consequent, None)?;
                        }
                        Ok(Terminal::Goto {
                            block: fallthrough_target,
                            variant: GotoVariant::Break,
                            id: EvaluationOrder(0),
                            loc: case_loc,
                        })
                    })
                })?;

                let test = if let Some(test_expr) = &case.value {
                    Some(lower_reorderable_expression(builder, test_expr)?)
                } else {
                    None
                };

                cases.push(Case { test, block });
                fallthrough = block;
            }

            // Reverse back to original order
            cases.reverse();

            // If no default case, add one that jumps to continuation
            if !has_default {
                cases.push(Case {
                    test: None,
                    block: continuation_id,
                });
            }

            builder.pop_scope();
            let test = lower_expression_to_temporary(builder, &switch_stmt.test_)?;
            builder.terminate_with_continuation(
                Terminal::Switch {
                    test,
                    cases,
                    fallthrough: continuation_id,
                    id: EvaluationOrder(0),
                    loc,
                },
                continuation_block,
            );
        }
        Data::STry(try_stmt) => {
            let loc = convert_loc(stmt_loc);
            let continuation_block = builder.reserve(BlockKind::Block);
            let continuation_id = continuation_block.id;

            let handler_clause = match &try_stmt.catch_ {
                Some(h) => h,
                None => {
                    builder.record_error(CompilerErrorDetail {
                        category: ErrorCategory::Todo,
                        reason:
                            "(BuildHIR::lowerStatement) Handle TryStatement without a catch clause"
                                .to_string(),
                        description: None,
                        loc,
                        suggestions: None,
                    })?;
                    return Ok(());
                }
            };

            if try_stmt.finally.is_some() {
                builder.record_error(CompilerErrorDetail {
                    category: ErrorCategory::Todo,
                    reason: "(BuildHIR::lowerStatement) Handle TryStatement with a finalizer ('finally') clause".to_string(),
                    description: None,
                    loc,
                    suggestions: None,
                })?;
            }

            // Set up handler binding if catch has a param
            let handler_binding_info: Option<(Place, Binding)> = if let Some(param) =
                &handler_clause.binding
            {
                // Check for destructuring in catch clause params.
                // Match TS behavior: Babel doesn't register destructured catch bindings
                // in its scope, so resolveIdentifier fails and records an invariant error.
                let is_destructuring = matches!(param.data, b::B::BObject(_) | b::B::BArray(_));
                if is_destructuring {
                    // Iterate the pattern to find all identifier locs for error reporting
                    fn collect_identifier_locs(
                        pat: &Binding,
                        locs: &mut Vec<Option<SourceLocation>>,
                    ) {
                        match pat.data {
                            b::B::BIdentifier(_) => {
                                locs.push(convert_loc(pat.loc));
                            }
                            b::B::BObject(obj) => {
                                for prop in obj.properties() {
                                    collect_identifier_locs(&prop.value, locs);
                                }
                            }
                            b::B::BArray(arr) => {
                                for elem in arr.items() {
                                    collect_identifier_locs(&elem.binding, locs);
                                }
                            }
                            b::B::BMissing(_) => {}
                        }
                    }
                    let mut id_locs = Vec::new();
                    collect_identifier_locs(param, &mut id_locs);
                    for id_loc in id_locs {
                        builder.record_error(CompilerErrorDetail {
                                reason: "(BuildHIR::lowerAssignment) Could not find binding for declaration.".to_string(),
                                category: ErrorCategory::Invariant,
                                loc: id_loc,
                                description: None,
                                suggestions: None,
                            })?;
                    }
                    None
                } else {
                    let param_loc = convert_loc(param.loc);
                    let id = builder.make_temporary(param_loc);
                    promote_temporary(builder, id);
                    let place = Place {
                        identifier: id,
                        effect: Effect::Unknown,
                        reactive: false,
                        loc: param_loc,
                    };
                    // Emit DeclareLocal for the catch binding
                    lower_value_to_temporary(
                        builder,
                        InstructionValue::DeclareLocal {
                            lvalue: LValue {
                                kind: InstructionKind::Catch,
                                place: place.clone(),
                            },
                            type_annotation: None,
                            loc: param_loc,
                        },
                    )?;
                    Some((place, *param))
                }
            } else {
                None
            };

            // Create the handler (catch) block
            let handler_binding_for_block = handler_binding_info.clone();
            let handler_loc = convert_loc(handler_clause.loc);
            // Use the catch param's loc for the assignment, matching TS: handlerBinding.path.node.loc
            let handler_param_loc = handler_clause
                .binding
                .as_ref()
                .and_then(|p| convert_loc(p.loc));
            let handler_block = builder.try_enter(BlockKind::Catch, |builder, _block_id| {
                builder.push_scope(handler_clause.loc);
                if let Some((ref place, ref pattern)) = handler_binding_for_block {
                    lower_assignment_binding(
                        builder,
                        handler_param_loc.or(handler_loc),
                        InstructionKind::Catch,
                        pattern,
                        place.clone(),
                        AssignmentStyle::Assignment,
                    )?;
                }
                // Lower the catch body using lower_block_statement to get hoisting support.
                // Match TS behavior where `lowerStatement(builder, handlerPath.get('body'))`
                // processes the catch body as a BlockStatement (with hoisting).
                builder.push_scope(handler_clause.body_loc);
                if let Some((_, ref pattern)) = handler_binding_for_block {
                    if let b::B::BIdentifier(id) = pattern.data {
                        let target = builder.resolve_ref(id.r#ref);
                        if !builder.is_context_identifier(id.r#ref)
                            && catch_param_referenced_in_nested_fn(
                                builder,
                                target,
                                &handler_clause.body,
                            )
                        {
                            let id_loc = convert_loc(pattern.loc);
                            if let VariableBinding::Identifier { identifier, .. } =
                                builder.resolve_identifier(id.r#ref, id_loc)?
                            {
                                let hoist_place = Place {
                                    identifier,
                                    effect: Effect::Unknown,
                                    reactive: false,
                                    loc: id_loc,
                                };
                                lower_value_to_temporary(
                                    builder,
                                    InstructionValue::DeclareContext {
                                        lvalue: LValue {
                                            kind: InstructionKind::HoistedLet,
                                            place: hoist_place,
                                        },
                                        loc: id_loc,
                                    },
                                )?;
                                builder.add_context_identifier(id.r#ref);
                                builder
                                    .environment_mut()
                                    .add_hoisted_identifier(id.r#ref.inner_index());
                            }
                        }
                    }
                }
                lower_block_statement_with_scope(builder, &handler_clause.body)?;
                builder.pop_scope();
                builder.pop_scope();
                Ok(Terminal::Goto {
                    block: continuation_id,
                    variant: GotoVariant::Break,
                    id: EvaluationOrder(0),
                    loc: handler_loc,
                })
            })?;

            // Create the try block
            // Use lower_block_statement to get hoisting support for bindings
            // declared inside the try body.
            let try_body_loc = convert_loc(try_stmt.body_loc);
            let try_block = builder.try_enter(BlockKind::Block, |builder, _block_id| {
                builder.push_scope(stmt_loc);
                builder.try_enter_try_catch(handler_block, |builder| {
                    lower_block_statement(builder, &try_stmt.body)?;
                    Ok(())
                })?;
                builder.pop_scope();
                Ok(Terminal::Goto {
                    block: continuation_id,
                    variant: GotoVariant::Try,
                    id: EvaluationOrder(0),
                    loc: try_body_loc,
                })
            })?;

            builder.terminate_with_continuation(
                Terminal::Try {
                    block: try_block,
                    handler_binding: handler_binding_info.map(|(place, _)| place),
                    handler: handler_block,
                    fallthrough: continuation_id,
                    id: EvaluationOrder(0),
                    loc,
                },
                continuation_block,
            );
        }
        Data::SLabel(labeled_stmt) => {
            let label_name = label_string(builder, Some(labeled_stmt.name))?
                .ok_or_else(|| crate::diagnostics::cold_todo("Unresolved label reference", None))?;
            let loc = convert_loc(stmt_loc);

            // Check if the body is a loop statement - if so, delegate with label
            match labeled_stmt.stmt.data {
                Data::SFor(_)
                | Data::SWhile(_)
                | Data::SDoWhile(_)
                | Data::SForIn(_)
                | Data::SForOf(_) => {
                    // Labeled loops are special because of continue, push the label down
                    lower_statement(builder, &labeled_stmt.stmt, Some(label_name))?;
                }
                _ => {
                    // All other statements create a continuation block to allow `break`
                    let continuation_block = builder.reserve(BlockKind::Block);
                    let continuation_id = continuation_block.id;
                    let body_loc = statement_loc(&labeled_stmt.stmt);

                    let block = builder.try_enter(BlockKind::Block, |builder, _block_id| {
                        builder.label_scope(label_name, continuation_id, |builder| {
                            lower_statement(builder, &labeled_stmt.stmt, None)?;
                            Ok(())
                        })?;
                        Ok(Terminal::Goto {
                            block: continuation_id,
                            variant: GotoVariant::Break,
                            id: EvaluationOrder(0),
                            loc: body_loc,
                        })
                    })?;

                    builder.terminate_with_continuation(
                        Terminal::Label {
                            block,
                            fallthrough: continuation_id,
                            id: EvaluationOrder(0),
                            loc,
                        },
                        continuation_block,
                    );
                }
            }
        }
        Data::SWith(_) => {
            let loc = convert_loc(stmt_loc);
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::UnsupportedSyntax,
                reason: "JavaScript 'with' syntax is not supported".to_string(),
                description: Some("'with' syntax is considered deprecated and removed from JavaScript standards, consider alternatives".to_string()),
                loc,
                suggestions: None,
            })?;
            lower_value_to_temporary(
                builder,
                InstructionValue::UnsupportedNode {
                    node_type: Some("WithStatement"),
                    original_node: None,
                    loc,
                },
            )?;
        }
        Data::SFunction(func_decl) => {
            lower_function_declaration(builder, &func_decl.func, stmt_loc)?;
        }
        Data::SClass(_) => {
            let loc = convert_loc(stmt_loc);
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::UnsupportedSyntax,
                reason: "Inline `class` declarations are not supported".to_string(),
                description: Some(
                    "Move class declarations outside of components/hooks".to_string(),
                ),
                loc,
                suggestions: None,
            })?;
            lower_value_to_temporary(
                builder,
                InstructionValue::UnsupportedNode {
                    node_type: Some("ClassDeclaration"),
                    original_node: None,
                    loc,
                },
            )?;
        }
        Data::SImport(_)
        | Data::SExportClause(_)
        | Data::SExportDefault(_)
        | Data::SExportFrom(_)
        | Data::SExportStar(_)
        | Data::SExportEquals(_) => {
            let loc = convert_loc(stmt_loc);
            let node_type_name = match stmt.data {
                Data::SImport(_) => "ImportDeclaration",
                Data::SExportDefault(_) => "ExportDefaultDeclaration",
                Data::SExportStar(_) => "ExportAllDeclaration",
                _ => "ExportNamedDeclaration",
            };
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Syntax,
                reason: "JavaScript `import` and `export` statements may only appear at the top level of a module".to_string(),
                description: None,
                loc,
                suggestions: None,
            })?;
            lower_value_to_temporary(
                builder,
                InstructionValue::UnsupportedNode {
                    node_type: Some(node_type_name),
                    original_node: None,
                    loc,
                },
            )?;
        }
        Data::SEnum(_) => {
            let loc = convert_loc(stmt_loc);
            lower_value_to_temporary(
                builder,
                InstructionValue::UnsupportedNode {
                    node_type: Some("TSEnumDeclaration"),
                    original_node: None,
                    loc,
                },
            )?;
        }
        // TypeScript/Flow type declarations are type-only, skip them
        Data::STypeScript(_) | Data::SComment(_) | Data::SDirective(_) => {}
        Data::SNamespace(_) => {
            let loc = convert_loc(stmt_loc);
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: "Unsupported statement kind 'SNamespace'".to_string(),
                description: None,
                loc,
                suggestions: None,
            })?;
            lower_value_to_temporary(
                builder,
                InstructionValue::UnsupportedNode {
                    node_type: Some("TSModuleDeclaration"),
                    original_node: None,
                    loc,
                },
            )?;
        }
        Data::SLazyExport(_) => {
            let loc = convert_loc(stmt_loc);
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: "Unsupported statement kind 'SLazyExport'".to_string(),
                description: None,
                loc,
                suggestions: None,
            })?;
        }
    }
    Ok(())
}

// =============================================================================
// Helpers
// =============================================================================

fn label_string(
    builder: &HirBuilder,
    label: Option<ast::LocRef>,
) -> Result<Option<String>, CompilerDiagnostic> {
    match label.map(|l| l.ref_).filter(|r| r.is_valid()) {
        Some(r) => Ok(Some(builder.ref_name(r)?)),
        None => Ok(None),
    }
}

fn lower_for_in_of_left(
    builder: &mut HirBuilder,
    init: &Stmt,
    left_loc: Option<SourceLocation>,
    value: Place,
    stmt_kind: &str,
) -> Result<Option<Place>, CompilerDiagnostic> {
    match init.data {
        Data::SLocal(var_decl) => {
            if var_decl.decls.len() != 1 {
                builder.record_error(CompilerErrorDetail {
                    category: ErrorCategory::Invariant,
                    reason: format!(
                        "Expected only one declaration in {} init, got {}",
                        stmt_kind,
                        var_decl.decls.len()
                    ),
                    description: None,
                    loc: left_loc,
                    suggestions: None,
                })?;
            }
            if let Some(declarator) = var_decl.decls.first() {
                Ok(lower_assignment_binding(
                    builder,
                    left_loc,
                    InstructionKind::Let,
                    &declarator.binding,
                    value,
                    AssignmentStyle::Assignment,
                )?)
            } else {
                Ok(None)
            }
        }
        Data::SExpr(expr) => Ok(lower_assignment(
            builder,
            left_loc,
            InstructionKind::Reassign,
            &expr.value,
            value,
            AssignmentStyle::Assignment,
        )?),
        _ => {
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Invariant,
                reason: format!("Unexpected {} init statement kind", stmt_kind),
                description: None,
                loc: left_loc,
                suggestions: None,
            })?;
            Ok(None)
        }
    }
}

// =============================================================================
// lower_assignment (Binding-target variant)
// =============================================================================

// Bun separates declaration patterns (`bun_ast::Binding`) from assignment-expression
// targets (`bun_ast::Expr`); upstream's single `PatternLike` covers both. The
// `Expr`-target path lives in `helpers::lower_assignment`; this is the
// `Binding`-target path reached from `VariableDeclaration`, `for-in/of` heads,
// and catch params. `kind` here is never `Reassign`, so upstream's
// `force_temporaries` reassign analysis is unreachable and elided.
pub(super) fn lower_assignment_binding(
    builder: &mut HirBuilder,
    loc: Option<SourceLocation>,
    kind: InstructionKind,
    target: &Binding,
    value: Place,
    assignment_style: AssignmentStyle,
) -> Result<Option<Place>, CompilerError> {
    match target.data {
        b::B::BIdentifier(id) => {
            let id_loc = convert_loc(target.loc);
            let result = lower_identifier_for_assignment(builder, loc, id_loc, kind, id.r#ref)?;
            match result {
                None => {
                    // Error already recorded
                    Ok(None)
                }
                Some(IdentifierForAssignment::Global { name, ref_ }) => {
                    let temp = lower_value_to_temporary(
                        builder,
                        InstructionValue::StoreGlobal {
                            name,
                            ref_,
                            value,
                            loc,
                        },
                    )?;
                    Ok(Some(temp))
                }
                Some(IdentifierForAssignment::Place(place)) => {
                    if builder.is_context_identifier(id.r#ref) {
                        let is_hoisted = builder
                            .environment()
                            .is_hoisted_identifier(id.r#ref.inner_index());
                        if kind == InstructionKind::Const && !is_hoisted {
                            builder.record_error(CompilerErrorDetail {
                                reason: "Expected `const` declaration not to be reassigned"
                                    .to_string(),
                                category: ErrorCategory::Syntax,
                                loc,
                                suggestions: None,
                                description: None,
                            })?;
                        }
                        if kind != InstructionKind::Const
                            && kind != InstructionKind::Reassign
                            && kind != InstructionKind::Let
                            && kind != InstructionKind::Function
                        {
                            builder.record_error(CompilerErrorDetail {
                                reason: "Unexpected context variable kind".to_string(),
                                category: ErrorCategory::Syntax,
                                loc,
                                suggestions: None,
                                description: None,
                            })?;
                            let temp = lower_value_to_temporary(
                                builder,
                                InstructionValue::UnsupportedNode {
                                    node_type: Some("Identifier"),
                                    original_node: None,
                                    loc,
                                },
                            )?;
                            return Ok(Some(temp));
                        }
                        let temp = lower_value_to_temporary(
                            builder,
                            InstructionValue::StoreContext {
                                lvalue: LValue { place, kind },
                                value,
                                loc,
                            },
                        )?;
                        Ok(Some(temp))
                    } else {
                        let temp = lower_value_to_temporary(
                            builder,
                            InstructionValue::StoreLocal {
                                lvalue: LValue { place, kind },
                                value,
                                type_annotation: None,
                                loc,
                            },
                        )?;
                        Ok(Some(temp))
                    }
                }
            }
        }

        b::B::BArray(pattern) => {
            let mut items: HirVec<ArrayPatternElement> = AstAlloc::vec();
            let mut followups: Vec<(Place, &Binding, Option<&Expr>)> = Vec::new();

            let elements = pattern.items();
            let last_idx = elements.len().wrapping_sub(1);
            for (i, element) in elements.iter().enumerate() {
                let is_spread = pattern.has_spread && i == last_idx;
                match element.binding.data {
                    b::B::BMissing(_) => {
                        items.push(ArrayPatternElement::Hole);
                    }
                    b::B::BIdentifier(id)
                        if element.default_value.is_none()
                            && (matches!(assignment_style, AssignmentStyle::Assignment)
                                || !builder.is_context_identifier(id.r#ref)) =>
                    {
                        let elem_loc = convert_loc(element.binding.loc);
                        match lower_identifier_for_assignment(
                            builder, elem_loc, elem_loc, kind, id.r#ref,
                        )? {
                            Some(IdentifierForAssignment::Place(place)) => {
                                if is_spread {
                                    items
                                        .push(ArrayPatternElement::Spread(SpreadPattern { place }));
                                } else {
                                    items.push(ArrayPatternElement::Place(place));
                                }
                            }
                            Some(IdentifierForAssignment::Global { .. }) => {
                                let temp = build_temporary_place(builder, elem_loc);
                                promote_temporary(builder, temp.identifier);
                                if is_spread {
                                    items.push(ArrayPatternElement::Spread(SpreadPattern {
                                        place: temp.clone(),
                                    }));
                                } else {
                                    items.push(ArrayPatternElement::Place(temp.clone()));
                                }
                                followups.push((temp, &element.binding, None));
                            }
                            None => {
                                if !is_spread {
                                    items.push(ArrayPatternElement::Hole);
                                }
                            }
                        }
                    }
                    _ => {
                        // Nested pattern, default value, or context variable: use temporary + followup
                        let elem_loc = convert_loc(element.binding.loc);
                        let temp = build_temporary_place(builder, elem_loc);
                        promote_temporary(builder, temp.identifier);
                        if is_spread {
                            items.push(ArrayPatternElement::Spread(SpreadPattern {
                                place: temp.clone(),
                            }));
                        } else {
                            items.push(ArrayPatternElement::Place(temp.clone()));
                        }
                        followups.push((temp, &element.binding, element.default_value.as_ref()));
                    }
                }
            }

            let temporary = lower_value_to_temporary(
                builder,
                InstructionValue::Destructure {
                    lvalue: LValuePattern {
                        pattern: Pattern::Array(ArrayPattern {
                            items,
                            loc: convert_loc(target.loc),
                        }),
                        kind,
                    },
                    value,
                    loc,
                },
            )?;

            for (place, path, default) in followups {
                let followup_loc = convert_loc(path.loc).or(loc);
                let resolved = match default {
                    Some(d) => lower_default_value(builder, followup_loc, place, d)?,
                    None => place,
                };
                lower_assignment_binding(
                    builder,
                    followup_loc,
                    kind,
                    path,
                    resolved,
                    assignment_style,
                )?;
            }
            Ok(Some(temporary))
        }

        b::B::BObject(pattern) => {
            let mut properties: HirVec<ObjectPropertyOrSpread> = AstAlloc::vec();
            let mut followups: Vec<(Place, &Binding, Option<&Expr>)> = Vec::new();

            for prop in pattern.properties() {
                let prop_loc = convert_loc(prop.value.loc);
                if prop.flags.contains(ast::flags::Property::IsSpread) {
                    match prop.value.data {
                        b::B::BIdentifier(id)
                            if prop.default_value.is_none()
                                && (matches!(assignment_style, AssignmentStyle::Assignment)
                                    || !builder.is_context_identifier(id.r#ref)) =>
                        {
                            match lower_identifier_for_assignment(
                                builder, prop_loc, prop_loc, kind, id.r#ref,
                            )? {
                                Some(IdentifierForAssignment::Place(place)) => {
                                    properties.push(ObjectPropertyOrSpread::Spread(
                                        SpreadPattern { place },
                                    ));
                                }
                                Some(IdentifierForAssignment::Global { .. }) => {
                                    builder.record_error(CompilerErrorDetail {
                                        reason: "Expected reassignment of globals to enable forceTemporaries".to_string(),
                                        category: ErrorCategory::Todo,
                                        loc: prop_loc,
                                        description: None,
                                        suggestions: None,
                                    })?;
                                }
                                None => {}
                            }
                        }
                        b::B::BIdentifier(_) => {
                            let temp = build_temporary_place(builder, prop_loc);
                            promote_temporary(builder, temp.identifier);
                            properties.push(ObjectPropertyOrSpread::Spread(SpreadPattern {
                                place: temp.clone(),
                            }));
                            followups.push((temp, &prop.value, prop.default_value.as_ref()));
                        }
                        _ => {
                            builder.record_error(CompilerErrorDetail {
                                reason: "(BuildHIR::lowerAssignment) Handle non-identifier rest element in ObjectPattern".to_string(),
                                category: ErrorCategory::Todo,
                                loc: prop_loc,
                                description: None,
                                suggestions: None,
                            })?;
                        }
                    }
                    continue;
                }

                if prop.flags.contains(ast::flags::Property::IsComputed) {
                    builder.record_error(CompilerErrorDetail {
                        reason: "(BuildHIR::lowerAssignment) Handle computed properties in ObjectPattern".to_string(),
                        category: ErrorCategory::Todo,
                        loc: convert_loc(prop.key.loc),
                        description: None,
                        suggestions: None,
                    })?;
                    continue;
                }

                let key = match lower_object_property_key(builder, &prop.key, false)? {
                    Some(k) => k,
                    None => continue,
                };

                match prop.value.data {
                    b::B::BIdentifier(id)
                        if prop.default_value.is_none()
                            && (matches!(assignment_style, AssignmentStyle::Assignment)
                                || !builder.is_context_identifier(id.r#ref)) =>
                    {
                        match lower_identifier_for_assignment(
                            builder, prop_loc, prop_loc, kind, id.r#ref,
                        )? {
                            Some(IdentifierForAssignment::Place(place)) => {
                                properties.push(ObjectPropertyOrSpread::Property(ObjectProperty {
                                    key,
                                    property_type: ObjectPropertyType::Property,
                                    place,
                                }));
                            }
                            Some(IdentifierForAssignment::Global { .. }) => {
                                builder.record_error(CompilerErrorDetail {
                                    reason: "Expected reassignment of globals to enable forceTemporaries".to_string(),
                                    category: ErrorCategory::Todo,
                                    loc: prop_loc,
                                    description: None,
                                    suggestions: None,
                                })?;
                            }
                            None => {
                                continue;
                            }
                        }
                    }
                    _ => {
                        // Nested pattern, default value, or context variable: use temporary + followup
                        let temp = build_temporary_place(builder, prop_loc);
                        promote_temporary(builder, temp.identifier);
                        properties.push(ObjectPropertyOrSpread::Property(ObjectProperty {
                            key,
                            property_type: ObjectPropertyType::Property,
                            place: temp.clone(),
                        }));
                        followups.push((temp, &prop.value, prop.default_value.as_ref()));
                    }
                }
            }

            let temporary = lower_value_to_temporary(
                builder,
                InstructionValue::Destructure {
                    lvalue: LValuePattern {
                        pattern: Pattern::Object(ObjectPattern {
                            properties,
                            loc: convert_loc(target.loc),
                        }),
                        kind,
                    },
                    value,
                    loc,
                },
            )?;

            for (place, path, default) in followups {
                let followup_loc = convert_loc(path.loc).or(loc);
                let resolved = match default {
                    Some(d) => lower_default_value(builder, followup_loc, place, d)?,
                    None => place,
                };
                lower_assignment_binding(
                    builder,
                    followup_loc,
                    kind,
                    path,
                    resolved,
                    assignment_style,
                )?;
            }
            Ok(Some(temporary))
        }

        b::B::BMissing(_) => Ok(None),
    }
}

/// Port of upstream `PatternLike::AssignmentPattern` arm: emit
/// `value === undefined ? default : value` as a Ternary terminal and return
/// the temporary holding the resolved value.
fn lower_default_value(
    builder: &mut HirBuilder,
    pat_loc: Option<SourceLocation>,
    value: Place,
    default: &Expr,
) -> Result<Place, CompilerError> {
    let temp = build_temporary_place(builder, pat_loc);

    let test_block = builder.reserve(BlockKind::Value);
    let continuation_block = builder.reserve(builder.current_block_kind());
    let continuation_id = continuation_block.id;

    // Consequent: use default value
    let consequent = builder.try_enter(BlockKind::Value, |builder, _| {
        let default_value = lower_reorderable_expression(builder, default)?;
        lower_value_to_temporary(
            builder,
            InstructionValue::StoreLocal {
                lvalue: LValue {
                    place: temp.clone(),
                    kind: InstructionKind::Const,
                },
                value: default_value,
                type_annotation: None,
                loc: pat_loc,
            },
        )?;
        Ok(Terminal::Goto {
            block: continuation_id,
            variant: GotoVariant::Break,
            id: EvaluationOrder(0),
            loc: pat_loc,
        })
    });

    // Alternate: use the original value
    let alternate = builder.try_enter(BlockKind::Value, |builder, _| {
        lower_value_to_temporary(
            builder,
            InstructionValue::StoreLocal {
                lvalue: LValue {
                    place: temp.clone(),
                    kind: InstructionKind::Const,
                },
                value: value.clone(),
                type_annotation: None,
                loc: pat_loc,
            },
        )?;
        Ok(Terminal::Goto {
            block: continuation_id,
            variant: GotoVariant::Break,
            id: EvaluationOrder(0),
            loc: pat_loc,
        })
    });

    // Ternary terminal
    builder.terminate_with_continuation(
        Terminal::Ternary {
            test: test_block.id,
            fallthrough: continuation_id,
            id: EvaluationOrder(0),
            loc: pat_loc,
        },
        test_block,
    );

    // In test block: check if value === undefined
    let undef = lower_value_to_temporary(
        builder,
        InstructionValue::Primitive {
            value: PrimitiveValue::Undefined,
            loc: pat_loc,
        },
    )?;
    let test = lower_value_to_temporary(
        builder,
        InstructionValue::BinaryExpression {
            left: value,
            operator: BinaryOperator::StrictEqual,
            right: undef,
            loc: pat_loc,
        },
    )?;
    builder.terminate_with_continuation(
        Terminal::Branch {
            test,
            consequent: consequent?,
            alternate: alternate?,
            fallthrough: continuation_id,
            id: EvaluationOrder(0),
            loc: pat_loc,
        },
        continuation_block,
    );

    Ok(temp)
}
