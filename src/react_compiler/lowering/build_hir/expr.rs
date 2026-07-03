//! Port of build_hir.rs lines 663–2303 and 6553–6713 — see mod.rs.

use crate::diagnostics::{
    CompilerDiagnostic, CompilerError, CompilerErrorDetail, ErrorCategory, JsString, cold_todo,
};
use crate::hir::*;
use bun_ast::expr::Data;
use bun_ast::{self as ast, E, Expr, G, Loc, OpCode, Ref, StoreRef, symbol};

use super::function::{lower_function_to_value, lower_object_method};
use super::helpers::{
    AssignmentStyle, MemberProperty, build_temporary_place, expression_type_name, lower_arguments,
    lower_assignment, lower_expression_to_temporary, lower_identifier, lower_member_expression,
    lower_object_property_key, lower_optional_call_expression, lower_optional_member_expression,
    lower_value_to_temporary,
};
use super::jsx::lower_jsx_call;
use crate::lowering::FunctionNode;
use crate::lowering::hir_builder::{HirBuilder, convert_loc};

pub(crate) fn lower_expression(
    builder: &mut HirBuilder,
    expr: &Expr,
) -> Result<InstructionValue, CompilerError> {
    let loc = convert_loc(expr.loc);
    match &expr.data {
        Data::EObjectJSON(_) | Data::EArrayJSON(_) => Ok(unsupported_node("JSONValue", loc)),
        Data::EIdentifier(ident) => lower_identifier_reference(builder, ident.ref_, loc),
        Data::EImportIdentifier(ident) => lower_identifier_reference(builder, ident.ref_, loc),
        Data::ENull(_) => Ok(InstructionValue::Primitive {
            value: PrimitiveValue::Null,
            loc,
        }),
        Data::EBoolean(lit) => Ok(InstructionValue::Primitive {
            value: PrimitiveValue::Boolean(lit.value),
            loc,
        }),
        Data::ENumber(lit) => Ok(InstructionValue::Primitive {
            value: PrimitiveValue::Number(FloatValue::new(lit.value())),
            loc,
        }),
        Data::EString(lit) => Ok(InstructionValue::Primitive {
            value: PrimitiveValue::String(convert_js_string(*lit)),
            loc,
        }),
        Data::EUndefined(_) => {
            let place = lower_value_to_temporary(
                builder,
                InstructionValue::LoadGlobal {
                    binding: NonLocalBinding {
                        ref_: Ref::NONE,
                        kind: NonLocalKind::Global {
                            name: StoreStr::new(b"undefined"),
                        },
                    },
                    loc,
                },
            )?;
            Ok(InstructionValue::LoadLocal { place, loc })
        }
        Data::EBinary(bin) => lower_binary(builder, bin, expr.loc),
        Data::EUnary(unary) => lower_unary(builder, unary, expr.loc),
        Data::ECall(call) => {
            if call.was_jsx_element {
                return lower_jsx_call(builder, call, expr.loc);
            }
            if call.optional_chain.is_some() {
                return lower_optional_call_expression(builder, expr);
            }
            // Check if callee is a MemberExpression => MethodCall
            let is_member = matches!(
                &call.target.data,
                Data::EDot(d) if d.optional_chain.is_none()
            ) || matches!(
                &call.target.data,
                Data::EIndex(i) if i.optional_chain.is_none()
            );
            if is_member {
                let lowered = lower_member_expression(builder, &call.target, None)?;
                let property = lower_value_to_temporary(builder, lowered.value)?;
                let args = AstAlloc::vec_from_iter(lower_arguments(builder, &call.args)?);
                Ok(InstructionValue::MethodCall {
                    receiver: lowered.object,
                    property,
                    args,
                    loc,
                })
            } else {
                let callee = lower_expression_to_temporary(builder, &call.target)?;
                let args = AstAlloc::vec_from_iter(lower_arguments(builder, &call.args)?);
                Ok(InstructionValue::CallExpression { callee, args, loc })
            }
        }
        Data::EDot(d) => {
            if d.optional_chain.is_some() {
                return lower_optional_member_expression(builder, expr);
            }
            let lowered = lower_member_expression(builder, expr, None)?;
            Ok(lowered.value)
        }
        Data::EIndex(i) => {
            if i.optional_chain.is_some() {
                return lower_optional_member_expression(builder, expr);
            }
            let lowered = lower_member_expression(builder, expr, None)?;
            Ok(lowered.value)
        }
        Data::EIf(cond) => lower_conditional(builder, cond, loc),
        Data::EArrow(a) => lower_function_to_value(
            builder,
            FunctionNode::Arrow(a),
            expr.loc,
            FunctionExpressionType::ArrowFunctionExpression,
        )
        .map_err(CompilerError::from),
        Data::EFunction(f) => lower_function_to_value(
            builder,
            FunctionNode::Function(&f.func),
            expr.loc,
            FunctionExpressionType::FunctionExpression,
        )
        .map_err(CompilerError::from),
        Data::EObject(obj) => {
            let mut properties: HirVec<ObjectPropertyOrSpread> = AstAlloc::vec();
            for prop in obj.properties.iter() {
                use ast::flags::Property as PF;
                if matches!(prop.kind, G::PropertyKind::Spread) {
                    let value = prop
                        .value
                        .as_ref()
                        .ok_or_else(|| cold_todo("spread without value", loc))?;
                    let place = lower_expression_to_temporary(builder, value)?;
                    properties.push(ObjectPropertyOrSpread::Spread(SpreadPattern { place }));
                    continue;
                }
                let is_method = prop.flags.contains(PF::IsMethod)
                    || matches!(prop.kind, G::PropertyKind::Get | G::PropertyKind::Set);
                if is_method {
                    if let Some(prop) = lower_object_method(builder, prop)? {
                        properties.push(ObjectPropertyOrSpread::Property(prop));
                    }
                    continue;
                }
                let key_expr = prop
                    .key
                    .as_ref()
                    .ok_or_else(|| cold_todo("object property without key", loc))?;
                let computed = prop.flags.contains(PF::IsComputed);
                let key = match lower_object_property_key(builder, key_expr, computed)? {
                    Some(k) => k,
                    None => continue,
                };
                let value_expr = prop
                    .value
                    .as_ref()
                    .ok_or_else(|| cold_todo("object property without value", loc))?;
                let value = lower_expression_to_temporary(builder, value_expr)?;
                properties.push(ObjectPropertyOrSpread::Property(ObjectProperty {
                    key,
                    property_type: ObjectPropertyType::Property,
                    place: value,
                }));
            }
            Ok(InstructionValue::ObjectExpression { properties, loc })
        }
        Data::EArray(arr) => {
            let mut elements: HirVec<ArrayElement> = AstAlloc::vec();
            for element in arr.items.iter() {
                match &element.data {
                    Data::EMissing(_) => {
                        elements.push(ArrayElement::Hole);
                    }
                    Data::ESpread(spread) => {
                        let place = lower_expression_to_temporary(builder, &spread.value)?;
                        elements.push(ArrayElement::Spread(SpreadPattern { place }));
                    }
                    _ => {
                        let place = lower_expression_to_temporary(builder, element)?;
                        elements.push(ArrayElement::Place(place));
                    }
                }
            }
            Ok(InstructionValue::ArrayExpression { elements, loc })
        }
        Data::ENew(new_expr) => {
            let callee = lower_expression_to_temporary(builder, &new_expr.target)?;
            let args = AstAlloc::vec_from_iter(lower_arguments(builder, &new_expr.args)?);
            Ok(InstructionValue::NewExpression { callee, args, loc })
        }
        Data::ETemplate(tmpl) => lower_template(builder, tmpl, loc),
        Data::EAwait(await_expr) => {
            let value = lower_expression_to_temporary(builder, &await_expr.value)?;
            Ok(InstructionValue::Await { value, loc })
        }
        Data::EYield(_) => {
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: "(BuildHIR::lowerExpression) Handle YieldExpression expressions"
                    .to_string(),
                description: None,
                loc,
                suggestions: None,
            })?;
            Ok(unsupported_node("YieldExpression", loc))
        }
        Data::ESpread(spread) => lower_expression(builder, &spread.value),
        Data::EImportMeta(_) => Ok(InstructionValue::MetaProperty {
            meta: "import",
            property: "meta",
            loc,
        }),
        Data::ENewTarget(_) => {
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: "(BuildHIR::lowerExpression) Handle MetaProperty expressions other than import.meta".to_string(),
                description: None,
                loc,
                suggestions: None,
            })?;
            Ok(unsupported_node("MetaProperty", loc))
        }
        Data::EClass(_) => {
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: "(BuildHIR::lowerExpression) Handle ClassExpression expressions"
                    .to_string(),
                description: None,
                loc,
                suggestions: None,
            })?;
            Ok(unsupported_node("ClassExpression", loc))
        }
        Data::EPrivateIdentifier(_) => {
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: "(BuildHIR::lowerExpression) Handle PrivateName expressions".to_string(),
                description: None,
                loc,
                suggestions: None,
            })?;
            Ok(unsupported_node("PrivateName", loc))
        }
        Data::ESuper(_) => {
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: "(BuildHIR::lowerExpression) Handle Super expressions".to_string(),
                description: None,
                loc,
                suggestions: None,
            })?;
            Ok(unsupported_node("Super", loc))
        }
        Data::EImport(i) => {
            let callee = lower_value_to_temporary(
                builder,
                InstructionValue::LoadGlobal {
                    binding: NonLocalBinding {
                        ref_: Ref::NONE,
                        kind: NonLocalKind::BunOpaque(*expr),
                    },
                    loc,
                },
            )?;
            let mut args: HirVec<PlaceOrSpread> = AstAlloc::vec();
            args.push(PlaceOrSpread::Place(lower_expression_to_temporary(
                builder, &i.expr,
            )?));
            if !matches!(i.options.data, Data::EMissing(_)) {
                args.push(PlaceOrSpread::Place(lower_expression_to_temporary(
                    builder, &i.options,
                )?));
            }
            Ok(InstructionValue::CallExpression { callee, args, loc })
        }
        Data::EThis(_) => {
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: "(BuildHIR::lowerExpression) Handle ThisExpression expressions".to_string(),
                description: None,
                loc,
                suggestions: None,
            })?;
            Ok(unsupported_node("ThisExpression", loc))
        }
        Data::EJsxElement(_) => {
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason:
                    "(BuildHIR::lowerExpression) EJsxElement should be lowered before React Compiler"
                        .to_string(),
                description: None,
                loc,
                suggestions: None,
            })?;
            Ok(unsupported_node("JSXElement", loc))
        }
        Data::EBigInt(_) => {
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: "(BuildHIR::lowerExpression) Handle BigIntLiteral expressions".to_string(),
                description: None,
                loc,
                suggestions: None,
            })?;
            Ok(unsupported_node("BigIntLiteral", loc))
        }
        Data::ERegExp(re) => Ok(InstructionValue::RegExpLiteral {
            pattern: StoreStr::new(re.pattern()),
            flags: StoreStr::new(re.flags()),
            loc,
        }),
        Data::EInlinedEnum(e) => lower_expression(builder, &e.value),

        Data::EBranchBoolean(lit) => Ok(InstructionValue::Primitive {
            value: PrimitiveValue::Boolean(lit.value),
            loc,
        }),
        Data::ERequireCallTarget
        | Data::ERequireResolveCallTarget
        | Data::ERequireString(_)
        | Data::ERequireResolveString(_)
        | Data::EImportMetaMain(_)
        | Data::ERequireMain => Ok(InstructionValue::LoadGlobal {
            binding: NonLocalBinding {
                ref_: Ref::NONE,
                kind: NonLocalKind::BunOpaque(*expr),
            },
            loc,
        }),
        Data::ESpecial(special) => match special {
            E::Special::ModuleExports | E::Special::ResolvedSpecifierString(_) => {
                Ok(InstructionValue::LoadGlobal {
                    binding: NonLocalBinding {
                        ref_: Ref::NONE,
                        kind: NonLocalKind::BunOpaque(*expr),
                    },
                    loc,
                })
            }
            E::Special::HotEnabled
            | E::Special::HotDisabled
            | E::Special::HotData
            | E::Special::HotAccept
            | E::Special::HotAcceptVisited => Err(todo_err("ESpecial", loc)),
        },

        Data::EMissing(_) => Err(todo_err("EMissing", loc)),
        Data::ECommonjsExportIdentifier(_) => Err(todo_err("ECommonjsExportIdentifier", loc)),
        Data::ENameOfSymbol(_) => Err(todo_err("ENameOfSymbol", loc)),
    }
}

fn lower_identifier_reference(
    builder: &mut HirBuilder,
    ref_: Ref,
    loc: Option<SourceLocation>,
) -> Result<InstructionValue, CompilerError> {
    let place = lower_identifier(builder, ref_, loc)?;
    if builder.is_context_identifier(ref_) {
        Ok(InstructionValue::LoadContext { place, loc })
    } else {
        Ok(InstructionValue::LoadLocal { place, loc })
    }
}

fn lower_binary(
    builder: &mut HirBuilder,
    bin: &E::Binary,
    bun_loc: Loc,
) -> Result<InstructionValue, CompilerError> {
    use OpCode::*;
    let loc = convert_loc(bun_loc);

    match bin.op {
        BinComma => lower_sequence(builder, bin, loc),
        BinLogicalOr | BinLogicalAnd | BinNullishCoalescing => lower_logical(builder, bin, loc),
        BinAssign => lower_simple_assignment(builder, bin, loc),
        BinAddAssign | BinSubAssign | BinMulAssign | BinDivAssign | BinRemAssign | BinPowAssign
        | BinShlAssign | BinShrAssign | BinUShrAssign | BinBitwiseOrAssign
        | BinBitwiseAndAssign | BinBitwiseXorAssign => lower_compound_assignment(builder, bin, loc),
        BinNullishCoalescingAssign | BinLogicalOrAssign | BinLogicalAndAssign => {
            builder.record_error(CompilerErrorDetail {
                reason: "Logical assignment operators (||=, &&=, ??=) are not yet supported"
                    .to_string(),
                category: ErrorCategory::Todo,
                loc,
                description: None,
                suggestions: None,
            })?;
            Ok(unsupported_node("AssignmentExpression", loc))
        }
        _ => {
            let Some(operator) = super::helpers::convert_binary_operator(bin.op) else {
                builder.record_error(CompilerErrorDetail {
                    category: ErrorCategory::Todo,
                    reason: "(BuildHIR::lowerExpression) Pipe operator not supported".to_string(),
                    description: None,
                    loc,
                    suggestions: None,
                })?;
                return Ok(unsupported_node("BinaryExpression", loc));
            };
            let left = lower_expression_to_temporary(builder, &bin.left)?;
            let right = lower_expression_to_temporary(builder, &bin.right)?;
            Ok(InstructionValue::BinaryExpression {
                operator,
                left,
                right,
                loc,
            })
        }
    }
}

fn lower_logical(
    builder: &mut HirBuilder,
    bin: &E::Binary,
    loc: Option<SourceLocation>,
) -> Result<InstructionValue, CompilerError> {
    let continuation_block = builder.reserve(builder.current_block_kind());
    let continuation_id = continuation_block.id;
    let test_block = builder.reserve(BlockKind::Value);
    let test_block_id = test_block.id;
    let place = build_temporary_place(builder, loc);
    let left_loc = convert_loc(bin.left.loc);
    let left_place = build_temporary_place(builder, left_loc);

    let consequent_block = builder.try_enter(BlockKind::Value, |builder, _block_id| {
        lower_value_to_temporary(
            builder,
            InstructionValue::StoreLocal {
                lvalue: LValue {
                    kind: InstructionKind::Const,
                    place: place.clone(),
                },
                value: left_place.clone(),
                type_annotation: None,
                loc: left_place.loc,
            },
        )?;
        Ok(Terminal::Goto {
            block: continuation_id,
            variant: GotoVariant::Break,
            id: EvaluationOrder(0),
            loc: left_place.loc,
        })
    });

    let alternate_block = builder.try_enter(BlockKind::Value, |builder, _block_id| {
        let right = lower_expression_to_temporary(builder, &bin.right)?;
        let right_loc = right.loc;
        lower_value_to_temporary(
            builder,
            InstructionValue::StoreLocal {
                lvalue: LValue {
                    kind: InstructionKind::Const,
                    place: place.clone(),
                },
                value: right,
                type_annotation: None,
                loc: right_loc,
            },
        )?;
        Ok(Terminal::Goto {
            block: continuation_id,
            variant: GotoVariant::Break,
            id: EvaluationOrder(0),
            loc: right_loc,
        })
    });

    let hir_op = match bin.op {
        OpCode::BinLogicalAnd => LogicalOperator::And,
        OpCode::BinLogicalOr => LogicalOperator::Or,
        OpCode::BinNullishCoalescing => LogicalOperator::NullishCoalescing,
        _ => unreachable!(),
    };

    builder.terminate_with_continuation(
        Terminal::Logical {
            operator: hir_op,
            test: test_block_id,
            fallthrough: continuation_id,
            id: EvaluationOrder(0),
            loc,
        },
        test_block,
    );

    let left_value = lower_expression_to_temporary(builder, &bin.left)?;
    builder.push(Instruction {
        id: EvaluationOrder(0),
        lvalue: left_place.clone(),
        value: InstructionValue::LoadLocal {
            place: left_value,
            loc,
        },
        effects: None,
        loc,
    });

    builder.terminate_with_continuation(
        Terminal::Branch {
            test: left_place,
            consequent: consequent_block?,
            alternate: alternate_block?,
            fallthrough: continuation_id,
            id: EvaluationOrder(0),
            loc,
        },
        continuation_block,
    );

    Ok(InstructionValue::LoadLocal {
        loc: place.loc,
        place,
    })
}

fn lower_conditional(
    builder: &mut HirBuilder,
    cond: &E::If,
    loc: Option<SourceLocation>,
) -> Result<InstructionValue, CompilerError> {
    let continuation_block = builder.reserve(builder.current_block_kind());
    let continuation_id = continuation_block.id;
    let test_block = builder.reserve(BlockKind::Value);
    let test_block_id = test_block.id;
    let place = build_temporary_place(builder, loc);

    let consequent_ast_loc = convert_loc(cond.yes.loc);
    let consequent_block = builder.try_enter(BlockKind::Value, |builder, _block_id| {
        let consequent = lower_expression_to_temporary(builder, &cond.yes)?;
        lower_value_to_temporary(
            builder,
            InstructionValue::StoreLocal {
                lvalue: LValue {
                    kind: InstructionKind::Const,
                    place: place.clone(),
                },
                value: consequent,
                type_annotation: None,
                loc,
            },
        )?;
        Ok(Terminal::Goto {
            block: continuation_id,
            variant: GotoVariant::Break,
            id: EvaluationOrder(0),
            loc: consequent_ast_loc,
        })
    });

    let alternate_ast_loc = convert_loc(cond.no.loc);
    let alternate_block = builder.try_enter(BlockKind::Value, |builder, _block_id| {
        let alternate = lower_expression_to_temporary(builder, &cond.no)?;
        lower_value_to_temporary(
            builder,
            InstructionValue::StoreLocal {
                lvalue: LValue {
                    kind: InstructionKind::Const,
                    place: place.clone(),
                },
                value: alternate,
                type_annotation: None,
                loc,
            },
        )?;
        Ok(Terminal::Goto {
            block: continuation_id,
            variant: GotoVariant::Break,
            id: EvaluationOrder(0),
            loc: alternate_ast_loc,
        })
    });

    builder.terminate_with_continuation(
        Terminal::Ternary {
            test: test_block_id,
            fallthrough: continuation_id,
            id: EvaluationOrder(0),
            loc,
        },
        test_block,
    );

    let test_place = lower_expression_to_temporary(builder, &cond.test_)?;
    builder.terminate_with_continuation(
        Terminal::Branch {
            test: test_place,
            consequent: consequent_block?,
            alternate: alternate_block?,
            fallthrough: continuation_id,
            id: EvaluationOrder(0),
            loc,
        },
        continuation_block,
    );

    Ok(InstructionValue::LoadLocal {
        loc: place.loc,
        place,
    })
}

fn lower_sequence(
    builder: &mut HirBuilder,
    bin: &E::Binary,
    loc: Option<SourceLocation>,
) -> Result<InstructionValue, CompilerError> {
    let continuation_block = builder.reserve(builder.current_block_kind());
    let continuation_id = continuation_block.id;
    let place = build_temporary_place(builder, loc);

    let sequence_block = builder.try_enter(BlockKind::Sequence, |builder, _block_id| {
        fn flatten_comma(builder: &mut HirBuilder, e: &Expr) -> Result<Place, CompilerError> {
            if let Data::EBinary(b) = &e.data {
                if b.op == OpCode::BinComma {
                    flatten_comma(builder, &b.left)?;
                    return flatten_comma(builder, &b.right);
                }
            }
            lower_expression_to_temporary(builder, e)
        }
        flatten_comma(builder, &bin.left)?;
        let last = lower_expression_to_temporary(builder, &bin.right)?;
        lower_value_to_temporary(
            builder,
            InstructionValue::StoreLocal {
                lvalue: LValue {
                    kind: InstructionKind::Const,
                    place: place.clone(),
                },
                value: last,
                type_annotation: None,
                loc,
            },
        )?;
        Ok(Terminal::Goto {
            block: continuation_id,
            variant: GotoVariant::Break,
            id: EvaluationOrder(0),
            loc,
        })
    });

    builder.terminate_with_continuation(
        Terminal::Sequence {
            block: sequence_block?,
            fallthrough: continuation_id,
            id: EvaluationOrder(0),
            loc,
        },
        continuation_block,
    );
    Ok(InstructionValue::LoadLocal { place, loc })
}

fn lower_simple_assignment(
    builder: &mut HirBuilder,
    bin: &E::Binary,
    loc: Option<SourceLocation>,
) -> Result<InstructionValue, CompilerError> {
    match &bin.left.data {
        Data::EIdentifier(ident) => {
            lower_simple_assignment_identifier(builder, ident.ref_, &bin.right, bin.left.loc)
        }
        Data::EImportIdentifier(ident) => {
            lower_simple_assignment_identifier(builder, ident.ref_, &bin.right, bin.left.loc)
        }
        Data::EDot(d) => {
            let right = lower_expression_to_temporary(builder, &bin.right)?;
            let left_loc = convert_loc(bin.left.loc);
            let object = lower_expression_to_temporary(builder, &d.target)?;
            let temp = lower_value_to_temporary(
                builder,
                InstructionValue::PropertyStore {
                    object,
                    property: PropertyLiteral::String(d.name),
                    value: right,
                    loc: left_loc,
                },
            )?;
            Ok(InstructionValue::LoadLocal {
                loc: temp.loc,
                place: temp,
            })
        }
        Data::EIndex(i) => {
            let right = lower_expression_to_temporary(builder, &bin.right)?;
            let left_loc = convert_loc(bin.left.loc);
            let object = lower_expression_to_temporary(builder, &i.target)?;
            let temp = if let Data::ENumber(num) = &i.index.data {
                lower_value_to_temporary(
                    builder,
                    InstructionValue::PropertyStore {
                        object,
                        property: PropertyLiteral::Number(FloatValue::new(num.value())),
                        value: right,
                        loc: left_loc,
                    },
                )?
            } else {
                let prop = lower_expression_to_temporary(builder, &i.index)?;
                lower_value_to_temporary(
                    builder,
                    InstructionValue::ComputedStore {
                        object,
                        property: prop,
                        value: right,
                        loc: left_loc,
                    },
                )?
            };
            Ok(InstructionValue::LoadLocal {
                loc: temp.loc,
                place: temp,
            })
        }
        _ => {
            let right = lower_expression_to_temporary(builder, &bin.right)?;
            let left_loc = convert_loc(bin.left.loc);
            let result = lower_assignment(
                builder,
                left_loc,
                InstructionKind::Reassign,
                &bin.left,
                right.clone(),
                AssignmentStyle::Destructure,
            )?;
            match result {
                Some(place) => Ok(InstructionValue::LoadLocal {
                    loc: place.loc,
                    place,
                }),
                None => Ok(InstructionValue::LoadLocal { place: right, loc }),
            }
        }
    }
}

fn lower_simple_assignment_identifier(
    builder: &mut HirBuilder,
    ref_: Ref,
    right_expr: &Expr,
    left_bun_loc: Loc,
) -> Result<InstructionValue, CompilerError> {
    let right = lower_expression_to_temporary(builder, right_expr)?;
    let ident_loc = convert_loc(left_bun_loc);
    let binding = builder.resolve_identifier(ref_, ident_loc)?;
    match binding {
        VariableBinding::Identifier {
            identifier,
            binding_kind,
        } => {
            if binding_kind == BindingKind::Const {
                let name = builder.host().ref_name(ref_);
                builder.record_error(CompilerErrorDetail {
                    reason: "Cannot reassign a `const` variable".to_string(),
                    category: ErrorCategory::Syntax,
                    loc: ident_loc,
                    description: Some(format!(
                        "`{}` is declared as const",
                        bun_core::BStr::new(name)
                    )),
                    suggestions: None,
                })?;
                return Ok(unsupported_node("Identifier", ident_loc));
            }
            let place = Place {
                identifier,
                reactive: false,
                effect: Effect::Unknown,
                loc: ident_loc,
            };
            if builder.is_context_identifier(ref_) {
                let temp = lower_value_to_temporary(
                    builder,
                    InstructionValue::StoreContext {
                        lvalue: LValue {
                            kind: InstructionKind::Reassign,
                            place: place.clone(),
                        },
                        value: right,
                        loc: place.loc,
                    },
                )?;
                Ok(InstructionValue::LoadLocal {
                    loc: temp.loc,
                    place: temp,
                })
            } else {
                let temp = lower_value_to_temporary(
                    builder,
                    InstructionValue::StoreLocal {
                        lvalue: LValue {
                            kind: InstructionKind::Reassign,
                            place: place.clone(),
                        },
                        value: right,
                        type_annotation: None,
                        loc: place.loc,
                    },
                )?;
                Ok(InstructionValue::LoadLocal {
                    loc: temp.loc,
                    place: temp,
                })
            }
        }
        _ => {
            let name = StoreStr::new(builder.host().ref_name(ref_));
            let temp = lower_value_to_temporary(
                builder,
                InstructionValue::StoreGlobal {
                    name,
                    ref_,
                    value: right,
                    loc: ident_loc,
                },
            )?;
            Ok(InstructionValue::LoadLocal {
                loc: temp.loc,
                place: temp,
            })
        }
    }
}

fn lower_compound_assignment(
    builder: &mut HirBuilder,
    bin: &E::Binary,
    loc: Option<SourceLocation>,
) -> Result<InstructionValue, CompilerError> {
    let binary_op = match bin.op {
        OpCode::BinAddAssign => BinaryOperator::Add,
        OpCode::BinSubAssign => BinaryOperator::Subtract,
        OpCode::BinMulAssign => BinaryOperator::Multiply,
        OpCode::BinDivAssign => BinaryOperator::Divide,
        OpCode::BinRemAssign => BinaryOperator::Modulo,
        OpCode::BinPowAssign => BinaryOperator::Exponent,
        OpCode::BinShlAssign => BinaryOperator::ShiftLeft,
        OpCode::BinShrAssign => BinaryOperator::ShiftRight,
        OpCode::BinUShrAssign => BinaryOperator::UnsignedShiftRight,
        OpCode::BinBitwiseOrAssign => BinaryOperator::BitwiseOr,
        OpCode::BinBitwiseXorAssign => BinaryOperator::BitwiseXor,
        OpCode::BinBitwiseAndAssign => BinaryOperator::BitwiseAnd,
        _ => unreachable!(),
    };

    match &bin.left.data {
        Data::EIdentifier(ident) => {
            lower_compound_assignment_identifier(builder, ident.ref_, bin, binary_op, loc)
        }
        Data::EImportIdentifier(ident) => {
            lower_compound_assignment_identifier(builder, ident.ref_, bin, binary_op, loc)
        }
        Data::EDot(_) | Data::EIndex(_) => {
            let member_loc = convert_loc(bin.left.loc);
            let lowered = lower_member_expression(builder, &bin.left, None)?;
            let object = lowered.object;
            let lowered_property = lowered.property;
            let current_value = lower_value_to_temporary(builder, lowered.value)?;
            let right = lower_expression_to_temporary(builder, &bin.right)?;
            let result = lower_value_to_temporary(
                builder,
                InstructionValue::BinaryExpression {
                    operator: binary_op,
                    left: current_value,
                    right,
                    loc: member_loc,
                },
            )?;
            match lowered_property {
                MemberProperty::Literal(prop_literal) => Ok(InstructionValue::PropertyStore {
                    object,
                    property: prop_literal,
                    value: result,
                    loc: member_loc,
                }),
                MemberProperty::Computed(prop_place) => Ok(InstructionValue::ComputedStore {
                    object,
                    property: prop_place,
                    value: result,
                    loc: member_loc,
                }),
            }
        }
        _ => {
            builder.record_error(CompilerErrorDetail {
                reason: "Compound assignment to complex pattern is not yet supported".to_string(),
                category: ErrorCategory::Todo,
                loc,
                description: None,
                suggestions: None,
            })?;
            Ok(unsupported_node("AssignmentExpression", loc))
        }
    }
}

fn lower_compound_assignment_identifier(
    builder: &mut HirBuilder,
    ref_: Ref,
    bin: &E::Binary,
    binary_op: BinaryOperator,
    loc: Option<SourceLocation>,
) -> Result<InstructionValue, CompilerError> {
    let left_place = lower_expression_to_temporary(builder, &bin.left)?;
    let right = lower_expression_to_temporary(builder, &bin.right)?;
    let binary_place = lower_value_to_temporary(
        builder,
        InstructionValue::BinaryExpression {
            operator: binary_op,
            left: left_place,
            right,
            loc,
        },
    )?;
    let ident_loc = convert_loc(bin.left.loc);
    let binding = builder.resolve_identifier(ref_, ident_loc)?;
    match binding {
        VariableBinding::Identifier { identifier, .. } => {
            let place = Place {
                identifier,
                reactive: false,
                effect: Effect::Unknown,
                loc: ident_loc,
            };
            if builder.is_context_identifier(ref_) {
                lower_value_to_temporary(
                    builder,
                    InstructionValue::StoreContext {
                        lvalue: LValue {
                            kind: InstructionKind::Reassign,
                            place: place.clone(),
                        },
                        value: binary_place,
                        loc,
                    },
                )?;
                Ok(InstructionValue::LoadContext { place, loc })
            } else {
                lower_value_to_temporary(
                    builder,
                    InstructionValue::StoreLocal {
                        lvalue: LValue {
                            kind: InstructionKind::Reassign,
                            place: place.clone(),
                        },
                        value: binary_place,
                        type_annotation: None,
                        loc,
                    },
                )?;
                Ok(InstructionValue::LoadLocal { place, loc })
            }
        }
        _ => {
            let name = StoreStr::new(builder.host().ref_name(ref_));
            let temp = lower_value_to_temporary(
                builder,
                InstructionValue::StoreGlobal {
                    name,
                    ref_,
                    value: binary_place,
                    loc,
                },
            )?;
            Ok(InstructionValue::LoadLocal {
                loc: temp.loc,
                place: temp,
            })
        }
    }
}

fn lower_unary(
    builder: &mut HirBuilder,
    unary: &E::Unary,
    bun_loc: Loc,
) -> Result<InstructionValue, CompilerError> {
    use OpCode::*;
    let loc = convert_loc(bun_loc);
    match unary.op {
        UnDelete => match &unary.value.data {
            Data::EDot(d) if d.optional_chain.is_none() => {
                let object = lower_expression_to_temporary(builder, &d.target)?;
                Ok(InstructionValue::PropertyDelete {
                    object,
                    property: PropertyLiteral::String(d.name),
                    loc,
                })
            }
            Data::EIndex(i) if i.optional_chain.is_none() => {
                let object = lower_expression_to_temporary(builder, &i.target)?;
                let property = lower_expression_to_temporary(builder, &i.index)?;
                Ok(InstructionValue::ComputedDelete {
                    object,
                    property,
                    loc,
                })
            }
            _ => {
                builder.record_error(CompilerErrorDetail {
                    reason: "Only object properties can be deleted".to_string(),
                    category: ErrorCategory::Syntax,
                    loc,
                    description: None,
                    suggestions: None,
                })?;
                Ok(unsupported_node("UnaryExpression", loc))
            }
        },
        UnPreInc | UnPreDec | UnPostInc | UnPostDec => lower_update(builder, unary, loc),
        _ => {
            let Some(operator) = super::helpers::convert_unary_operator(unary.op) else {
                return Err(todo_err("EUnary op", loc));
            };
            let value = lower_expression_to_temporary(builder, &unary.value)?;
            Ok(InstructionValue::UnaryExpression {
                operator,
                value,
                loc,
            })
        }
    }
}

fn lower_update(
    builder: &mut HirBuilder,
    unary: &E::Unary,
    loc: Option<SourceLocation>,
) -> Result<InstructionValue, CompilerError> {
    let prefix = matches!(unary.op, OpCode::UnPreInc | OpCode::UnPreDec);
    let operation = match unary.op {
        OpCode::UnPreInc | OpCode::UnPostInc => UpdateOperator::Increment,
        OpCode::UnPreDec | OpCode::UnPostDec => UpdateOperator::Decrement,
        _ => unreachable!(),
    };
    match &unary.value.data {
        Data::EDot(_) | Data::EIndex(_) => {
            let binary_op = match operation {
                UpdateOperator::Increment => BinaryOperator::Add,
                UpdateOperator::Decrement => BinaryOperator::Subtract,
            };
            let member_loc = convert_loc(unary.value.loc);
            let lowered = lower_member_expression(builder, &unary.value, None)?;
            let object = lowered.object;
            let lowered_property = lowered.property;
            let prev_value = lower_value_to_temporary(builder, lowered.value)?;

            let one = lower_value_to_temporary(
                builder,
                InstructionValue::Primitive {
                    value: PrimitiveValue::Number(FloatValue::new(1.0)),
                    loc: None,
                },
            )?;
            let updated = lower_value_to_temporary(
                builder,
                InstructionValue::BinaryExpression {
                    operator: binary_op,
                    left: prev_value.clone(),
                    right: one,
                    loc: member_loc,
                },
            )?;

            let new_value_place = match lowered_property {
                MemberProperty::Literal(prop_literal) => lower_value_to_temporary(
                    builder,
                    InstructionValue::PropertyStore {
                        object,
                        property: prop_literal,
                        value: updated,
                        loc: member_loc,
                    },
                )?,
                MemberProperty::Computed(prop_place) => lower_value_to_temporary(
                    builder,
                    InstructionValue::ComputedStore {
                        object,
                        property: prop_place,
                        value: updated,
                        loc: member_loc,
                    },
                )?,
            };

            let result_place = if prefix { new_value_place } else { prev_value };
            Ok(InstructionValue::LoadLocal {
                loc: result_place.loc,
                place: result_place,
            })
        }
        Data::EIdentifier(ident) => {
            lower_update_identifier(builder, ident.ref_, unary.value.loc, prefix, operation, loc)
        }
        Data::EImportIdentifier(ident) => {
            lower_update_identifier(builder, ident.ref_, unary.value.loc, prefix, operation, loc)
        }
        _ => {
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: "UpdateExpression with unsupported argument type".to_string(),
                description: None,
                loc,
                suggestions: None,
            })?;
            Ok(unsupported_node("UpdateExpression", loc))
        }
    }
}

fn lower_update_identifier(
    builder: &mut HirBuilder,
    ref_: Ref,
    arg_bun_loc: Loc,
    prefix: bool,
    operation: UpdateOperator,
    loc: Option<SourceLocation>,
) -> Result<InstructionValue, CompilerError> {
    if builder.is_context_identifier(ref_) {
        builder.record_error(CompilerErrorDetail {
            category: ErrorCategory::Todo,
            reason: "(BuildHIR::lowerExpression) Handle UpdateExpression to variables captured within lambdas.".to_string(),
            description: None,
            loc,
            suggestions: None,
        })?;
        return Ok(unsupported_node("UpdateExpression", loc));
    }

    let ident_loc = convert_loc(arg_bun_loc);
    let binding = builder.resolve_identifier(ref_, ident_loc)?;
    if matches!(binding, VariableBinding::Global { .. }) {
        builder.record_error(CompilerErrorDetail {
            category: ErrorCategory::Todo,
            reason: "UpdateExpression where argument is a global is not yet supported".to_string(),
            description: None,
            loc,
            suggestions: None,
        })?;
        return Ok(unsupported_node("UpdateExpression", loc));
    }
    let identifier = match binding {
        VariableBinding::Identifier { identifier, .. } => identifier,
        _ => {
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: "(BuildHIR::lowerExpression) Support UpdateExpression where argument is a global".to_string(),
                description: None,
                loc,
                suggestions: None,
            })?;
            return Ok(unsupported_node("UpdateExpression", loc));
        }
    };
    let lvalue_place = Place {
        identifier,
        effect: Effect::Unknown,
        reactive: false,
        loc: ident_loc,
    };

    let value = lower_identifier(builder, ref_, ident_loc)?;

    if prefix {
        Ok(InstructionValue::PrefixUpdate {
            lvalue: lvalue_place,
            operation,
            value,
            loc,
        })
    } else {
        Ok(InstructionValue::PostfixUpdate {
            lvalue: lvalue_place,
            operation,
            value,
            loc,
        })
    }
}

fn lower_template(
    builder: &mut HirBuilder,
    tmpl: &E::Template,
    loc: Option<SourceLocation>,
) -> Result<InstructionValue, CompilerError> {
    let parts = tmpl.parts();
    if let Some(tag) = &tmpl.tag {
        if !parts.is_empty() {
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: "(BuildHIR::lowerExpression) Handle tagged template with interpolations"
                    .to_string(),
                description: None,
                loc,
                suggestions: None,
            })?;
            return Ok(unsupported_node("TaggedTemplateExpression", loc));
        }
        // Bun's parser stores tagged-template heads as `Raw` only (the cooked
        // string is not retained). raw == cooked iff the raw text contains no
        // escape sequences, so gate on `\` to match upstream's raw != cooked
        // bailout without re-decoding.
        let value = match &tmpl.head {
            E::TemplateContents::Raw(r) => {
                let raw_bytes = r.slice();
                if raw_bytes.contains(&b'\\') {
                    builder.record_error(CompilerErrorDetail {
                        category: ErrorCategory::Todo,
                        reason: "(BuildHIR::lowerExpression) Handle tagged template where cooked value is different from raw value".to_string(),
                        description: None,
                        loc,
                        suggestions: None,
                    })?;
                    return Ok(unsupported_node("TaggedTemplateExpression", loc));
                }
                let raw = StoreStr::new(raw_bytes);
                TemplateQuasi {
                    cooked: Some(raw),
                    raw,
                }
            }
            E::TemplateContents::Cooked(_) => {
                builder.record_error(CompilerErrorDetail {
                    category: ErrorCategory::Todo,
                    reason: "(BuildHIR::lowerExpression) Handle tagged template where cooked value is different from raw value".to_string(),
                    description: None,
                    loc,
                    suggestions: None,
                })?;
                return Ok(unsupported_node("TaggedTemplateExpression", loc));
            }
        };
        let tag = lower_expression_to_temporary(builder, tag)?;
        return Ok(InstructionValue::TaggedTemplateExpression { tag, value, loc });
    }

    let mut subexprs: HirVec<Place> = AstAlloc::vec_with_capacity(parts.len());
    let mut quasis: HirVec<TemplateQuasi> = AstAlloc::vec_with_capacity(parts.len() + 1);
    quasis.push(convert_template_contents(&tmpl.head, loc)?);
    for part in parts {
        subexprs.push(lower_expression_to_temporary(builder, &part.value)?);
        quasis.push(convert_template_contents(&part.tail, loc)?);
    }
    Ok(InstructionValue::TemplateLiteral {
        subexprs,
        quasis,
        loc,
    })
}

fn convert_template_contents(
    c: &E::TemplateContents,
    loc: Option<SourceLocation>,
) -> Result<TemplateQuasi, CompilerError> {
    match c {
        E::TemplateContents::Cooked(s) => {
            let cooked = if s.is_utf16 {
                arena_utf8_from_utf16(s.slice16(), loc)?
            } else {
                StoreStr::new(s.slice8())
            };
            Ok(TemplateQuasi {
                raw: cooked,
                cooked: Some(cooked),
            })
        }
        E::TemplateContents::Raw(r) => Ok(TemplateQuasi {
            raw: StoreStr::new(r.slice()),
            cooked: None,
        }),
    }
}

fn arena_utf8_from_utf16(
    units: &[u16],
    loc: Option<SourceLocation>,
) -> Result<StoreStr, CompilerError> {
    let mut buf: HirVec<u8> = AstAlloc::vec_with_capacity(units.len() * 3);
    for r in char::decode_utf16(units.iter().copied()) {
        let c = r.map_err(|_| cold_todo("non-utf16 template", loc))?;
        let mut tmp = [0u8; 4];
        buf.extend_from_slice(c.encode_utf8(&mut tmp).as_bytes());
    }
    Ok(StoreStr::new(buf.leak()))
}

// =============================================================================
// lower_reorderable_expression (build_hir.rs:6553-6713)
// =============================================================================

pub(crate) fn lower_reorderable_expression(
    builder: &mut HirBuilder,
    expr: &Expr,
) -> Result<Place, CompilerError> {
    if !is_reorderable_expression(builder, expr, true) {
        builder.record_error(CompilerErrorDetail {
            category: ErrorCategory::Todo,
            reason: format!(
                "(BuildHIR::node.lowerReorderableExpression) Expression type `{}` cannot be safely reordered",
                expression_type_name(expr)
            ),
            description: None,
            loc: convert_loc(expr.loc),
            suggestions: None,
        })?;
    }
    lower_expression_to_temporary(builder, expr)
}

fn is_reorderable_expression(
    builder: &HirBuilder,
    expr: &Expr,
    allow_local_identifiers: bool,
) -> bool {
    match &expr.data {
        Data::EIdentifier(ident) => {
            if is_module_level_or_global(builder, ident.ref_) {
                true
            } else {
                allow_local_identifiers
            }
        }
        Data::EImportIdentifier(_) => true,
        Data::EUndefined(_)
        | Data::ERegExp(_)
        | Data::EString(_)
        | Data::ENumber(_)
        | Data::ENull(_)
        | Data::EBoolean(_)
        | Data::EBranchBoolean(_)
        | Data::EBigInt(_) => true,
        Data::EUnary(unary) => {
            matches!(unary.op, OpCode::UnNot | OpCode::UnPos | OpCode::UnNeg)
                && is_reorderable_expression(builder, &unary.value, allow_local_identifiers)
        }
        Data::EBinary(bin) => match bin.op {
            OpCode::BinLogicalOr | OpCode::BinLogicalAnd | OpCode::BinNullishCoalescing => {
                is_reorderable_expression(builder, &bin.left, allow_local_identifiers)
                    && is_reorderable_expression(builder, &bin.right, allow_local_identifiers)
            }
            _ => false,
        },
        Data::EIf(cond) => {
            is_reorderable_expression(builder, &cond.test_, allow_local_identifiers)
                && is_reorderable_expression(builder, &cond.yes, allow_local_identifiers)
                && is_reorderable_expression(builder, &cond.no, allow_local_identifiers)
        }
        Data::EArray(arr) => arr.items.iter().all(|element| {
            if matches!(element.data, Data::EMissing(_)) {
                false
            } else {
                is_reorderable_expression(builder, element, allow_local_identifiers)
            }
        }),
        Data::EObject(obj) => obj.properties.iter().all(|prop| {
            use ast::flags::Property as PF;
            if !matches!(prop.kind, G::PropertyKind::Normal)
                || prop.flags.contains(PF::IsMethod)
                || prop.flags.contains(PF::IsComputed)
            {
                return false;
            }
            match &prop.value {
                Some(v) => is_reorderable_expression(builder, v, allow_local_identifiers),
                None => false,
            }
        }),
        Data::EDot(d) if d.optional_chain.is_none() => {
            let mut inner = &d.target;
            loop {
                match &inner.data {
                    Data::EDot(d2) if d2.optional_chain.is_none() => inner = &d2.target,
                    Data::EIndex(i2) if i2.optional_chain.is_none() => inner = &i2.target,
                    _ => break,
                }
            }
            match &inner.data {
                Data::EIdentifier(ident) => is_module_level_or_global(builder, ident.ref_),
                Data::EImportIdentifier(_) => true,
                _ => false,
            }
        }
        Data::EIndex(i) if i.optional_chain.is_none() => {
            let mut inner = &i.target;
            loop {
                match &inner.data {
                    Data::EDot(d2) if d2.optional_chain.is_none() => inner = &d2.target,
                    Data::EIndex(i2) if i2.optional_chain.is_none() => inner = &i2.target,
                    _ => break,
                }
            }
            match &inner.data {
                Data::EIdentifier(ident) => is_module_level_or_global(builder, ident.ref_),
                Data::EImportIdentifier(_) => true,
                _ => false,
            }
        }
        Data::EArrow(arrow) => {
            let stmts = arrow.body.stmts.slice();
            if arrow.prefer_expr && stmts.len() == 1 {
                if let ast::stmt::Data::SReturn(r) = &stmts[0].data {
                    if let Some(v) = &r.value {
                        return is_reorderable_expression(builder, v, false);
                    }
                }
            }
            stmts.is_empty()
        }
        Data::ECall(call) if call.optional_chain.is_none() => {
            is_reorderable_expression(builder, &call.target, allow_local_identifiers)
                && call
                    .args
                    .iter()
                    .all(|arg| is_reorderable_expression(builder, arg, allow_local_identifiers))
        }
        Data::ENew(new_expr) => {
            is_reorderable_expression(builder, &new_expr.target, allow_local_identifiers)
                && new_expr
                    .args
                    .iter()
                    .all(|arg| is_reorderable_expression(builder, arg, allow_local_identifiers))
        }
        Data::EInlinedEnum(e) => {
            is_reorderable_expression(builder, &e.value, allow_local_identifiers)
        }
        _ => false,
    }
}

fn is_module_level_or_global(builder: &HirBuilder, ref_: Ref) -> bool {
    use symbol::Kind as Sk;
    let symbols = builder.host().symbols();
    let mut ref_ = ref_;
    let Some(mut sym) = symbols.get(ref_.inner_index() as usize) else {
        return true;
    };
    while sym.has_link() {
        let next = sym.link.get();
        match symbols.get(next.inner_index() as usize) {
            Some(s) => {
                ref_ = next;
                sym = s;
            }
            None => break,
        }
    }
    if matches!(
        sym.kind,
        Sk::Unbound | Sk::Arguments | Sk::Import | Sk::TsEnum | Sk::TsNamespace
    ) {
        return true;
    }
    if let Some(member) = builder
        .host()
        .module_scope()
        .members
        .get(sym.original_name.slice())
    {
        if member.ref_ == ref_ {
            return true;
        }
    }
    false
}

// =============================================================================
// Conversion helpers
// =============================================================================

fn convert_js_string(s: StoreRef<E::EString>) -> JsString {
    if s.get().next.is_none() {
        return JsString::new(s);
    }
    // Roped literal (rare; only from parser-level constant folding): flatten so
    // every HIR consumer can ignore ropes.
    let mut joined: Vec<u8> = Vec::with_capacity(s.get().len());
    let mut cur = Some(s.get());
    while let Some(seg) = cur {
        debug_assert!(!seg.is_utf16);
        joined.extend_from_slice(seg.slice8());
        cur = seg.next.as_ref().map(|r| r.get());
    }
    JsString::from_wtf8_bytes(&joined)
}

fn unsupported_node(node_type: &'static str, loc: Option<SourceLocation>) -> InstructionValue {
    InstructionValue::UnsupportedNode {
        node_type: Some(node_type),
        original_node: None,
        loc,
    }
}

#[cold]
#[inline(never)]
fn todo_err(variant: &str, loc: Option<SourceLocation>) -> CompilerError {
    CompilerDiagnostic::todo(
        format!("(BuildHIR::lowerExpression) Handle {} expressions", variant),
        loc,
    )
    .into()
}
