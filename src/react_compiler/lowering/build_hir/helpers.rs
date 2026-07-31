//! Port of build_hir.rs lines 1–662 and 4362–5509 — see mod.rs.

use crate::diagnostics::{CompilerError, CompilerErrorDetail, ErrorCategory, cold_todo};
use crate::hir::*;
use bun_ast::expr::Data;
use bun_ast::{self as ast, Expr, G, OpCode, OptionalChain, Ref};

use crate::lowering::hir_builder::{HirBuilder, convert_loc};

use super::expr::lower_reorderable_expression;
use super::lower_expression;

#[inline]
pub(super) fn arena_str(bytes: &[u8]) -> StoreStr {
    StoreStr::new(ast::data_store_dupe_str(bytes))
}

struct WriteBytes<'a>(&'a mut HirVec<u8>);
impl core::fmt::Write for WriteBytes<'_> {
    #[inline]
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        self.0.extend_from_slice(s.as_bytes());
        Ok(())
    }
}

// =============================================================================
// Node serialization (debug-only round-trip in upstream)
// =============================================================================

// TODO(port): upstream serializes the Babel AST node for UnsupportedNode codegen
// round-trip. Bun has no Babel-shaped AST; the macros expand to `None` so the
// HIR `original_node` slot stays empty until codegen learns to read bun_ast.
macro_rules! serialize_expression {
    ($e:expr) => {
        None
    };
}
macro_rules! serialize_pattern {
    ($e:expr) => {
        None
    };
}

pub(super) fn expression_type_name(expr: &Expr) -> &'static str {
    match &expr.data {
        Data::EIdentifier(_) | Data::EImportIdentifier(_) => "Identifier",
        Data::EPrivateIdentifier(_) => "PrivateName",
        Data::EBoolean(_) => "BooleanLiteral",
        Data::ENumber(_) => "NumericLiteral",
        Data::EString(_) => "StringLiteral",
        Data::EBigInt(_) => "BigIntLiteral",
        Data::ERegExp(_) => "RegExpLiteral",
        Data::ENull(_) => "NullLiteral",
        Data::EUndefined(_) => "Identifier",
        Data::EThis(_) => "ThisExpression",
        Data::ESuper(_) => "Super",
        Data::ENewTarget(_) | Data::EImportMeta(_) => "MetaProperty",
        Data::EArray(_) => "ArrayExpression",
        Data::EObject(_) => "ObjectExpression",
        Data::ESpread(_) => "SpreadElement",
        Data::EUnary(_) => "UnaryExpression",
        Data::EBinary(_) => "BinaryExpression",
        Data::EIf(_) => "ConditionalExpression",
        Data::EDot(d) => {
            if d.optional_chain.is_some() {
                "OptionalMemberExpression"
            } else {
                "MemberExpression"
            }
        }
        Data::EIndex(i) => {
            if i.optional_chain.is_some() {
                "OptionalMemberExpression"
            } else {
                "MemberExpression"
            }
        }
        Data::ECall(c) => {
            if c.optional_chain.is_some() {
                "OptionalCallExpression"
            } else {
                "CallExpression"
            }
        }
        Data::ENew(_) => "NewExpression",
        Data::EImport(_) => "CallExpression",
        Data::EAwait(_) => "AwaitExpression",
        Data::EYield(_) => "YieldExpression",
        Data::ETemplate(_) => "TemplateLiteral",
        Data::EArrow(_) => "ArrowFunctionExpression",
        Data::EFunction(_) => "FunctionExpression",
        Data::EJsxElement(_) => "JSXElement",
        Data::EClass(_) => "ClassExpression",
        Data::EMissing(_) => "Hole",
        _ => "UnsupportedNode",
    }
}

// =============================================================================
// Operator conversion
// =============================================================================

pub(super) fn convert_binary_operator(op: OpCode) -> Option<BinaryOperator> {
    use OpCode::*;
    Some(match op {
        BinAdd => BinaryOperator::Add,
        BinSub => BinaryOperator::Subtract,
        BinMul => BinaryOperator::Multiply,
        BinDiv => BinaryOperator::Divide,
        BinRem => BinaryOperator::Modulo,
        BinPow => BinaryOperator::Exponent,
        BinLt => BinaryOperator::LessThan,
        BinLe => BinaryOperator::LessEqual,
        BinGt => BinaryOperator::GreaterThan,
        BinGe => BinaryOperator::GreaterEqual,
        BinIn => BinaryOperator::In,
        BinInstanceof => BinaryOperator::InstanceOf,
        BinShl => BinaryOperator::ShiftLeft,
        BinShr => BinaryOperator::ShiftRight,
        BinUShr => BinaryOperator::UnsignedShiftRight,
        BinLooseEq => BinaryOperator::Equal,
        BinLooseNe => BinaryOperator::NotEqual,
        BinStrictEq => BinaryOperator::StrictEqual,
        BinStrictNe => BinaryOperator::StrictNotEqual,
        BinBitwiseOr => BinaryOperator::BitwiseOr,
        BinBitwiseAnd => BinaryOperator::BitwiseAnd,
        BinBitwiseXor => BinaryOperator::BitwiseXor,
        _ => return None,
    })
}

pub(super) fn convert_unary_operator(op: OpCode) -> Option<UnaryOperator> {
    use OpCode::*;
    Some(match op {
        UnPos => UnaryOperator::Plus,
        UnNeg => UnaryOperator::Minus,
        UnCpl => UnaryOperator::BitwiseNot,
        UnNot => UnaryOperator::Not,
        UnVoid => UnaryOperator::Void,
        UnTypeof => UnaryOperator::TypeOf,
        _ => return None,
    })
}

// =============================================================================
// Helper functions
// =============================================================================

pub(super) fn build_temporary_place(
    builder: &mut HirBuilder,
    loc: Option<SourceLocation>,
) -> Place {
    let id = builder.make_temporary(loc);
    Place {
        identifier: id,
        reactive: false,
        effect: Effect::Unknown,
        loc,
    }
}

pub(super) fn promote_temporary(builder: &mut HirBuilder, identifier_id: IdentifierId) {
    let env = builder.environment_mut();
    let decl_id = env.identifiers[identifier_id.0 as usize].declaration_id;
    let mut buf = [0u8; 12];
    buf[0] = b'#';
    buf[1] = b't';
    let mut n = decl_id.0;
    let mut len = 2usize;
    if n == 0 {
        buf[len] = b'0';
        len += 1;
    } else {
        let start = len;
        while n > 0 {
            buf[len] = b'0' + (n % 10) as u8;
            len += 1;
            n /= 10;
        }
        buf[start..len].reverse();
    }
    env.identifiers[identifier_id.0 as usize].name =
        Some(IdentifierName::Promoted(arena_str(&buf[..len])));
}

pub(super) fn lower_value_to_temporary(
    builder: &mut HirBuilder,
    value: InstructionValue,
) -> Result<Place, CompilerError> {
    if let InstructionValue::LoadLocal { ref place, .. } = value {
        let ident = &builder.environment().identifiers[place.identifier.0 as usize];
        if ident.name.is_none() {
            return Ok(place.clone());
        }
    }
    let loc = value.loc().copied();
    let place = build_temporary_place(builder, loc);
    builder.push(Instruction {
        id: EvaluationOrder(0),
        lvalue: place.clone(),
        value,
        loc,
        effects: None,
    });
    Ok(place)
}

pub(super) fn lower_expression_to_temporary(
    builder: &mut HirBuilder,
    expr: &Expr,
) -> Result<Place, CompilerError> {
    let value = lower_expression(builder, expr)?;
    lower_value_to_temporary(builder, value)
}

// =============================================================================
// lower_identifier
// =============================================================================

pub(super) fn lower_identifier(
    builder: &mut HirBuilder,
    ref_: Ref,
    loc: Option<SourceLocation>,
) -> Result<Place, CompilerError> {
    let binding = builder.resolve_identifier(ref_, loc)?;
    match binding {
        VariableBinding::Identifier { identifier, .. } => Ok(Place {
            identifier,
            effect: Effect::Unknown,
            reactive: false,
            loc,
        }),
        _ => {
            if let VariableBinding::Global { name } = &binding {
                if name.slice() == b"eval" {
                    builder.record_error(CompilerErrorDetail {
                        category: ErrorCategory::UnsupportedSyntax,
                        reason: "The 'eval' function is not supported".to_string(),
                        description: Some(
                            "Eval is an anti-pattern in JavaScript, and the code executed cannot be evaluated by React Compiler".to_string(),
                        ),
                        loc,
                        suggestions: None,
                    })?;
                }
            }
            let kind = match binding {
                VariableBinding::Global { name } => NonLocalKind::Global { name },
                VariableBinding::ImportDefault { name, module } => {
                    NonLocalKind::ImportDefault { name, module }
                }
                VariableBinding::ImportSpecifier {
                    name,
                    module,
                    imported,
                } => NonLocalKind::ImportSpecifier {
                    name,
                    module,
                    imported,
                },
                VariableBinding::ImportNamespace { name, module } => {
                    NonLocalKind::ImportNamespace { name, module }
                }
                VariableBinding::ModuleLocal { name } => NonLocalKind::ModuleLocal { name },
                VariableBinding::Identifier { .. } => unreachable!(),
            };
            let non_local_binding = NonLocalBinding { ref_, kind };
            let instr_value = InstructionValue::LoadGlobal {
                binding: non_local_binding,
                loc,
            };
            lower_value_to_temporary(builder, instr_value)
        }
    }
}

// =============================================================================
// lower_arguments
// =============================================================================

pub(super) fn lower_arguments(
    builder: &mut HirBuilder,
    args: &[Expr],
) -> Result<HirVec<PlaceOrSpread>, CompilerError> {
    let mut result = AstAlloc::vec();
    for arg in args {
        match &arg.data {
            Data::ESpread(spread) => {
                let place = lower_expression_to_temporary(builder, &spread.value)?;
                result.push(PlaceOrSpread::Spread(SpreadPattern { place }));
            }
            _ => {
                let place = lower_expression_to_temporary(builder, arg)?;
                result.push(PlaceOrSpread::Place(place));
            }
        }
    }
    Ok(result)
}

// =============================================================================
// lower_member_expression
// =============================================================================

pub(super) enum MemberProperty {
    Literal(PropertyLiteral),
    Computed(Place),
}

pub(super) struct LoweredMemberExpression {
    pub(super) object: Place,
    pub(super) property: MemberProperty,
    pub(super) value: InstructionValue,
}

/// `expr` must be `EDot` or `EIndex`. The optional-chain bit is ignored here;
/// the caller decides whether to wrap this in optional-chain CFG.
pub(super) fn lower_member_expression(
    builder: &mut HirBuilder,
    expr: &Expr,
    lowered_object: Option<Place>,
) -> Result<LoweredMemberExpression, CompilerError> {
    let loc = convert_loc(expr.loc);
    match &expr.data {
        Data::EDot(d) => {
            let object = match lowered_object {
                Some(obj) => obj,
                None => lower_expression_to_temporary(builder, &d.target)?,
            };
            let prop_literal = PropertyLiteral::String(StoreStr::new(d.name.slice()));
            let value = InstructionValue::PropertyLoad {
                object: object.clone(),
                property: prop_literal.clone(),
                loc,
            };
            Ok(LoweredMemberExpression {
                object,
                property: MemberProperty::Literal(prop_literal),
                value,
            })
        }
        Data::EIndex(i) => {
            let object = match lowered_object {
                Some(obj) => obj,
                None => lower_expression_to_temporary(builder, &i.target)?,
            };
            if let Data::EPrivateIdentifier(_) = &i.index.data {
                builder.record_error(CompilerErrorDetail {
                    category: ErrorCategory::Todo,
                    reason: "(BuildHIR::lowerMemberExpression) Handle PrivateName property"
                        .to_string(),
                    description: None,
                    loc,
                    suggestions: None,
                })?;
                return Ok(LoweredMemberExpression {
                    object,
                    property: MemberProperty::Literal(PropertyLiteral::String(StoreStr::EMPTY)),
                    value: InstructionValue::UnsupportedNode {
                        node_type: Some("MemberExpression"),
                        original_node: serialize_expression!(expr),
                        loc,
                    },
                });
            }
            if let Data::ENumber(lit) = &i.index.data {
                let prop_literal = PropertyLiteral::Number(FloatValue::new(lit.value()));
                let value = InstructionValue::PropertyLoad {
                    object: object.clone(),
                    property: prop_literal.clone(),
                    loc,
                };
                return Ok(LoweredMemberExpression {
                    object,
                    property: MemberProperty::Literal(prop_literal),
                    value,
                });
            }
            let property = lower_expression_to_temporary(builder, &i.index)?;
            let value = InstructionValue::ComputedLoad {
                object: object.clone(),
                property: property.clone(),
                loc,
            };
            Ok(LoweredMemberExpression {
                object,
                property: MemberProperty::Computed(property),
                value,
            })
        }
        _ => Err(cold_todo(
            "lower_member_expression: expected EDot/EIndex",
            loc,
        )),
    }
}

// =============================================================================
// lower_identifier_for_assignment
// =============================================================================

pub(super) enum IdentifierForAssignment {
    Place(Place),
    Global { name: StoreStr, ref_: Ref },
}

#[derive(Clone, Copy)]
pub(super) enum AssignmentStyle {
    Assignment,
    Destructure,
}

pub(super) fn lower_identifier_for_assignment(
    builder: &mut HirBuilder,
    loc: Option<SourceLocation>,
    ident_loc: Option<SourceLocation>,
    kind: InstructionKind,
    ref_: Ref,
) -> Result<Option<IdentifierForAssignment>, CompilerError> {
    let binding = builder.resolve_identifier(ref_, ident_loc)?;
    match binding {
        VariableBinding::Identifier {
            identifier,
            binding_kind,
            ..
        } => {
            if kind != InstructionKind::Reassign {
                builder.set_identifier_declaration_loc(identifier, &ident_loc);
            }
            if binding_kind == BindingKind::Const && kind == InstructionKind::Reassign {
                let name = builder.host().ref_name(ref_);
                builder.record_error(CompilerErrorDetail {
                    reason: "Cannot reassign a `const` variable".to_string(),
                    category: ErrorCategory::Syntax,
                    loc,
                    description: Some(format!(
                        "`{}` is declared as const",
                        bun_core::BStr::new(name)
                    )),
                    suggestions: None,
                })?;
                return Ok(None);
            }
            Ok(Some(IdentifierForAssignment::Place(Place {
                identifier,
                effect: Effect::Unknown,
                reactive: false,
                loc,
            })))
        }
        VariableBinding::Global { name: gname } => {
            if kind == InstructionKind::Reassign {
                Ok(Some(IdentifierForAssignment::Global { name: gname, ref_ }))
            } else {
                builder.record_error(CompilerErrorDetail {
                    reason: "Could not find binding for declaration".to_string(),
                    category: ErrorCategory::Invariant,
                    loc,
                    description: None,
                    suggestions: None,
                })?;
                Ok(None)
            }
        }
        _ => {
            if kind == InstructionKind::Reassign {
                let name = StoreStr::new(builder.host().ref_name(ref_));
                Ok(Some(IdentifierForAssignment::Global { name, ref_ }))
            } else {
                builder.record_error(CompilerErrorDetail {
                    reason: "Could not find binding for declaration".to_string(),
                    category: ErrorCategory::Invariant,
                    loc,
                    description: None,
                    suggestions: None,
                })?;
                Ok(None)
            }
        }
    }
}

// =============================================================================
// lower_assignment
// =============================================================================

fn assignment_target_ref(target: &Expr) -> Option<Ref> {
    match &target.data {
        Data::EIdentifier(id) => Some(id.ref_),
        Data::EImportIdentifier(id) => Some(id.ref_),
        _ => None,
    }
}

pub(super) fn lower_assignment(
    builder: &mut HirBuilder,
    loc: Option<SourceLocation>,
    kind: InstructionKind,
    target: &Expr,
    value: Place,
    assignment_style: AssignmentStyle,
) -> Result<Option<Place>, CompilerError> {
    match &target.data {
        Data::EIdentifier(_) | Data::EImportIdentifier(_) => {
            let ref_ = assignment_target_ref(target).unwrap();
            let id_loc = convert_loc(target.loc);
            let result = lower_identifier_for_assignment(builder, loc, id_loc, kind, ref_)?;
            match result {
                None => Ok(None),
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
                    if builder.is_context_identifier(ref_) {
                        let is_hoisted = builder
                            .environment()
                            .is_hoisted_identifier(ref_.inner_index());
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
                                    original_node: serialize_pattern!(target),
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

        Data::EDot(_) | Data::EIndex(_) => {
            if kind != InstructionKind::Reassign {
                builder.record_error(CompilerErrorDetail {
                    category: ErrorCategory::Invariant,
                    reason: "MemberExpression may only appear in an assignment expression"
                        .to_string(),
                    description: None,
                    loc,
                    suggestions: None,
                })?;
                return Ok(None);
            }
            let temp = lower_member_store(builder, target, value, loc)?;
            Ok(Some(temp))
        }

        Data::EArray(pattern) => {
            let mut items: HirVec<ArrayPatternElement> = AstAlloc::vec();
            let mut followups: Vec<(Place, &Expr)> = Vec::new();

            let force_temporaries = if kind == InstructionKind::Reassign {
                let mut found = false;
                for elem in pattern.items.iter() {
                    match assignment_target_ref(elem) {
                        Some(ref_) => {
                            if builder.is_context_identifier(ref_) {
                                found = true;
                                break;
                            }
                            match builder.resolve_identifier(ref_, convert_loc(elem.loc))? {
                                VariableBinding::Identifier { .. } => {}
                                _ => {
                                    found = true;
                                    break;
                                }
                            }
                        }
                        None => {
                            found = true;
                            break;
                        }
                    }
                }
                found
            } else {
                false
            };

            for element in pattern.items.iter() {
                match &element.data {
                    Data::EMissing(_) => {
                        items.push(ArrayPatternElement::Hole);
                    }
                    Data::ESpread(rest) => {
                        let rest_loc = convert_loc(element.loc);
                        if let Some(ref_) = assignment_target_ref(&rest.value) {
                            let is_context = builder.is_context_identifier(ref_);
                            let can_use_direct = !force_temporaries
                                && (matches!(assignment_style, AssignmentStyle::Assignment)
                                    || !is_context);
                            if can_use_direct {
                                match lower_identifier_for_assignment(
                                    builder,
                                    rest_loc,
                                    convert_loc(rest.value.loc),
                                    kind,
                                    ref_,
                                )? {
                                    Some(IdentifierForAssignment::Place(place)) => {
                                        items.push(ArrayPatternElement::Spread(SpreadPattern {
                                            place,
                                        }));
                                    }
                                    Some(IdentifierForAssignment::Global { .. }) => {
                                        let temp = build_temporary_place(builder, rest_loc);
                                        promote_temporary(builder, temp.identifier);
                                        items.push(ArrayPatternElement::Spread(SpreadPattern {
                                            place: temp.clone(),
                                        }));
                                        followups.push((temp, &rest.value));
                                    }
                                    None => {}
                                }
                            } else {
                                let temp = build_temporary_place(builder, rest_loc);
                                promote_temporary(builder, temp.identifier);
                                items.push(ArrayPatternElement::Spread(SpreadPattern {
                                    place: temp.clone(),
                                }));
                                followups.push((temp, &rest.value));
                            }
                        } else {
                            let temp = build_temporary_place(builder, rest_loc);
                            promote_temporary(builder, temp.identifier);
                            items.push(ArrayPatternElement::Spread(SpreadPattern {
                                place: temp.clone(),
                            }));
                            followups.push((temp, &rest.value));
                        }
                    }
                    _ => {
                        if let Some(ref_) = assignment_target_ref(element) {
                            let id_loc = convert_loc(element.loc);
                            let is_context = builder.is_context_identifier(ref_);
                            let can_use_direct = !force_temporaries
                                && (matches!(assignment_style, AssignmentStyle::Assignment)
                                    || !is_context);
                            if can_use_direct {
                                match lower_identifier_for_assignment(
                                    builder, id_loc, id_loc, kind, ref_,
                                )? {
                                    Some(IdentifierForAssignment::Place(place)) => {
                                        items.push(ArrayPatternElement::Place(place));
                                    }
                                    Some(IdentifierForAssignment::Global { .. }) => {
                                        let temp = build_temporary_place(builder, id_loc);
                                        promote_temporary(builder, temp.identifier);
                                        items.push(ArrayPatternElement::Place(temp.clone()));
                                        followups.push((temp, element));
                                    }
                                    None => {
                                        items.push(ArrayPatternElement::Hole);
                                    }
                                }
                            } else {
                                let temp = build_temporary_place(builder, id_loc);
                                promote_temporary(builder, temp.identifier);
                                items.push(ArrayPatternElement::Place(temp.clone()));
                                followups.push((temp, element));
                            }
                        } else {
                            let elem_loc = convert_loc(element.loc);
                            let temp = build_temporary_place(builder, elem_loc);
                            promote_temporary(builder, temp.identifier);
                            items.push(ArrayPatternElement::Place(temp.clone()));
                            followups.push((temp, element));
                        }
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

            for (place, path) in followups {
                let followup_loc = convert_loc(path.loc).or(loc);
                lower_assignment(builder, followup_loc, kind, path, place, assignment_style)?;
            }
            Ok(Some(temporary))
        }

        Data::EObject(pattern) => {
            let mut properties: HirVec<ObjectPropertyOrSpread> = AstAlloc::vec();
            let mut followups: Vec<(Place, &Expr, Option<&Expr>)> = Vec::new();

            let force_temporaries = if kind == InstructionKind::Reassign {
                let mut found = false;
                for prop in pattern.properties.iter() {
                    if matches!(prop.kind, G::PropertyKind::Spread) {
                        found = true;
                        break;
                    }
                    let Some(val) = prop.value.as_ref() else {
                        found = true;
                        break;
                    };
                    match assignment_target_ref(val) {
                        Some(ref_) => {
                            match builder.resolve_identifier(ref_, convert_loc(val.loc))? {
                                VariableBinding::Identifier { .. } => {}
                                _ => {
                                    found = true;
                                    break;
                                }
                            }
                        }
                        None => {
                            found = true;
                            break;
                        }
                    }
                }
                found
            } else {
                false
            };

            for prop in pattern.properties.iter() {
                if matches!(prop.kind, G::PropertyKind::Spread) {
                    let Some(arg) = prop.value.as_ref() else {
                        continue;
                    };
                    let rest_loc = convert_loc(arg.loc);
                    if let Some(ref_) = assignment_target_ref(arg) {
                        let is_context = builder.is_context_identifier(ref_);
                        let can_use_direct = !force_temporaries
                            && (matches!(assignment_style, AssignmentStyle::Assignment)
                                || !is_context);
                        if can_use_direct {
                            match lower_identifier_for_assignment(
                                builder, rest_loc, rest_loc, kind, ref_,
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
                                        loc: rest_loc,
                                        description: None,
                                        suggestions: None,
                                    })?;
                                }
                                None => {}
                            }
                        } else {
                            let temp = build_temporary_place(builder, rest_loc);
                            promote_temporary(builder, temp.identifier);
                            properties.push(ObjectPropertyOrSpread::Spread(SpreadPattern {
                                place: temp.clone(),
                            }));
                            followups.push((temp, arg, None));
                        }
                    } else {
                        builder.record_error(CompilerErrorDetail {
                            reason: format!(
                                "(BuildHIR::lowerAssignment) Handle {} rest element in ObjectPattern",
                                expression_type_name(arg)
                            ),
                            category: ErrorCategory::Todo,
                            loc: rest_loc,
                            description: None,
                            suggestions: None,
                        })?;
                    }
                    continue;
                }

                let computed = prop.flags.contains(ast::flags::Property::IsComputed);
                if computed {
                    builder.record_error(CompilerErrorDetail {
                        reason: "(BuildHIR::lowerAssignment) Handle computed properties in ObjectPattern".to_string(),
                        category: ErrorCategory::Todo,
                        loc: prop.key.as_ref().and_then(|k| convert_loc(k.loc)),
                        description: None,
                        suggestions: None,
                    })?;
                    continue;
                }

                let Some(key_expr) = prop.key.as_ref() else {
                    continue;
                };
                let key = match lower_object_property_key(builder, key_expr, false)? {
                    Some(k) => k,
                    None => continue,
                };

                let Some(val) = prop.value.as_ref() else {
                    continue;
                };
                // `{a = 1} = x` parses as a Property with `initializer`; treat it
                // as `{a: a = 1}` by deferring to a followup AssignmentPattern.
                let target_expr = val;
                let has_default = prop.initializer.is_some();

                if let (Some(ref_), false) = (assignment_target_ref(target_expr), has_default) {
                    let id_loc = convert_loc(target_expr.loc);
                    let is_context = builder.is_context_identifier(ref_);
                    let can_use_direct = !force_temporaries
                        && (matches!(assignment_style, AssignmentStyle::Assignment) || !is_context);
                    if can_use_direct {
                        match lower_identifier_for_assignment(builder, id_loc, id_loc, kind, ref_)?
                        {
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
                                    loc: id_loc,
                                    description: None,
                                    suggestions: None,
                                })?;
                            }
                            None => continue,
                        }
                    } else {
                        let temp = build_temporary_place(builder, id_loc);
                        promote_temporary(builder, temp.identifier);
                        properties.push(ObjectPropertyOrSpread::Property(ObjectProperty {
                            key,
                            property_type: ObjectPropertyType::Property,
                            place: temp.clone(),
                        }));
                        followups.push((temp, target_expr, None));
                    }
                } else {
                    let elem_loc = convert_loc(target_expr.loc);
                    let temp = build_temporary_place(builder, elem_loc);
                    promote_temporary(builder, temp.identifier);
                    properties.push(ObjectPropertyOrSpread::Property(ObjectProperty {
                        key,
                        property_type: ObjectPropertyType::Property,
                        place: temp.clone(),
                    }));
                    followups.push((temp, target_expr, prop.initializer.as_ref()));
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

            for (place, path, init) in followups {
                let followup_loc = convert_loc(path.loc).or(loc);
                let place = match init {
                    Some(default) => {
                        lower_assignment_pattern_default(builder, followup_loc, place, default)?
                    }
                    None => place,
                };
                lower_assignment(builder, followup_loc, kind, path, place, assignment_style)?;
            }
            Ok(Some(temporary))
        }

        Data::EBinary(b) if b.op == OpCode::BinAssign => {
            let pat_loc = convert_loc(target.loc);
            let temp = lower_assignment_pattern_default(builder, pat_loc, value, &b.right)?;
            lower_assignment(builder, pat_loc, kind, &b.left, temp, assignment_style)
        }

        Data::ESpread(s) => lower_assignment(builder, loc, kind, &s.value, value, assignment_style),

        _ => {
            builder.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: format!(
                    "(BuildHIR::lowerAssignment) Handle {} assignment target",
                    expression_type_name(target)
                ),
                description: None,
                loc,
                suggestions: None,
            })?;
            Ok(None)
        }
    }
}

/// Port of upstream's `PatternLike::AssignmentPattern` arm: emit the
/// `value === undefined ? default : value` ternary CFG and return the
/// resolved temporary.
pub(super) fn lower_assignment_pattern_default(
    builder: &mut HirBuilder,
    pat_loc: Option<SourceLocation>,
    value: Place,
    default: &Expr,
) -> Result<Place, CompilerError> {
    let temp = build_temporary_place(builder, pat_loc);

    let test_block = builder.reserve(BlockKind::Value);
    let continuation_block = builder.reserve(builder.current_block_kind());

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
            block: continuation_block.id,
            variant: GotoVariant::Break,
            id: EvaluationOrder(0),
            loc: pat_loc,
        })
    })?;

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
            block: continuation_block.id,
            variant: GotoVariant::Break,
            id: EvaluationOrder(0),
            loc: pat_loc,
        })
    })?;

    builder.terminate_with_continuation(
        Terminal::Ternary {
            test: test_block.id,
            fallthrough: continuation_block.id,
            id: EvaluationOrder(0),
            loc: pat_loc,
        },
        test_block,
    );

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
            consequent,
            alternate,
            fallthrough: continuation_block.id,
            id: EvaluationOrder(0),
            loc: pat_loc,
        },
        continuation_block,
    );

    Ok(temp)
}

fn lower_member_store(
    builder: &mut HirBuilder,
    target: &Expr,
    value: Place,
    loc: Option<SourceLocation>,
) -> Result<Place, CompilerError> {
    match &target.data {
        Data::EDot(d) => {
            let object = lower_expression_to_temporary(builder, &d.target)?;
            lower_value_to_temporary(
                builder,
                InstructionValue::PropertyStore {
                    object,
                    property: PropertyLiteral::String(StoreStr::new(d.name.slice())),
                    value,
                    loc,
                },
            )
        }
        Data::EIndex(i) => {
            let object = lower_expression_to_temporary(builder, &i.target)?;
            if let Data::EPrivateIdentifier(_) = &i.index.data {
                builder.record_error(CompilerErrorDetail {
                    reason: "(BuildHIR::lowerAssignment) Expected private name to appear as a non-computed property".to_string(),
                    category: ErrorCategory::Todo,
                    loc: convert_loc(i.index.loc),
                    description: None,
                    suggestions: None,
                })?;
                return lower_value_to_temporary(
                    builder,
                    InstructionValue::UnsupportedNode {
                        node_type: Some("MemberExpression"),
                        original_node: serialize_pattern!(target),
                        loc,
                    },
                );
            }
            if let Data::ENumber(n) = &i.index.data {
                return lower_value_to_temporary(
                    builder,
                    InstructionValue::PropertyStore {
                        object,
                        property: PropertyLiteral::Number(FloatValue::new(n.value())),
                        value,
                        loc,
                    },
                );
            }
            let property_place = lower_expression_to_temporary(builder, &i.index)?;
            lower_value_to_temporary(
                builder,
                InstructionValue::ComputedStore {
                    object,
                    property: property_place,
                    value,
                    loc,
                },
            )
        }
        _ => unreachable!(),
    }
}

pub(super) fn lower_object_property_key(
    builder: &mut HirBuilder,
    key: &Expr,
    computed: bool,
) -> Result<Option<ObjectPropertyKey>, CompilerError> {
    match &key.data {
        Data::EString(s) => {
            let name = if s.is_utf16 {
                arena_str(&bun_core::strings::to_utf8_alloc(s.slice16()))
            } else if s.next.is_some() {
                return Err(cold_todo("rope property key", convert_loc(key.loc)));
            } else {
                StoreStr::new(s.slice8())
            };
            Ok(Some(ObjectPropertyKey::String { name }))
        }
        Data::ENumber(n) if !computed => {
            let mut buf: HirVec<u8> = AstAlloc::vec_with_capacity(24);
            core::fmt::write(&mut WriteBytes(&mut buf), format_args!("{}", n.value())).ok();
            Ok(Some(ObjectPropertyKey::Identifier {
                name: StoreStr::new(buf.leak()),
            }))
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

// =============================================================================
// Optional chains
// =============================================================================

fn member_object<'a>(expr: &'a Expr) -> &'a Expr {
    match &expr.data {
        Data::EDot(d) => &d.target,
        Data::EIndex(i) => &i.target,
        _ => unreachable!(),
    }
}

fn optional_chain_of(expr: &Expr) -> Option<OptionalChain> {
    match &expr.data {
        Data::EDot(d) => d.optional_chain,
        Data::EIndex(i) => i.optional_chain,
        Data::ECall(c) => c.optional_chain,
        _ => None,
    }
}

pub(super) fn lower_optional_member_expression(
    builder: &mut HirBuilder,
    expr: &Expr,
) -> Result<InstructionValue, CompilerError> {
    let place = lower_optional_member_expression_impl(builder, expr, None)?.1;
    Ok(InstructionValue::LoadLocal {
        loc: place.loc,
        place,
    })
}

/// Returns (object, value_place) pair.
fn lower_optional_member_expression_impl(
    builder: &mut HirBuilder,
    expr: &Expr,
    parent_alternate: Option<BlockId>,
) -> Result<(Place, Place), CompilerError> {
    let optional = matches!(optional_chain_of(expr), Some(OptionalChain::Start));
    let loc = convert_loc(expr.loc);
    let place = build_temporary_place(builder, loc);
    let continuation_block = builder.reserve(builder.current_block_kind());
    let continuation_id = continuation_block.id;
    let consequent = builder.reserve(BlockKind::Value);

    let alternate = if let Some(parent_alt) = parent_alternate {
        parent_alt
    } else {
        builder.try_enter(BlockKind::Value, |builder, _block_id| {
            let temp = lower_value_to_temporary(
                builder,
                InstructionValue::Primitive {
                    value: PrimitiveValue::Undefined,
                    loc,
                },
            )?;
            lower_value_to_temporary(
                builder,
                InstructionValue::StoreLocal {
                    lvalue: LValue {
                        kind: InstructionKind::Const,
                        place: place.clone(),
                    },
                    value: temp,
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
        })?
    };

    let mut object: Option<Place> = None;
    let test_block = builder.try_enter(BlockKind::Value, |builder, _block_id| {
        let obj_expr = member_object(expr);
        match (&obj_expr.data, optional_chain_of(obj_expr)) {
            (Data::EDot(_) | Data::EIndex(_), Some(_)) => {
                let (_obj, value) =
                    lower_optional_member_expression_impl(builder, obj_expr, Some(alternate))?;
                object = Some(value);
            }
            (Data::ECall(_), Some(_)) => {
                let value =
                    lower_optional_call_expression_impl(builder, obj_expr, Some(alternate))?;
                let value_place = lower_value_to_temporary(builder, value)?;
                object = Some(value_place);
            }
            _ => {
                object = Some(lower_expression_to_temporary(builder, obj_expr)?);
            }
        }
        let test_place = object.as_ref().unwrap().clone();
        Ok(Terminal::Branch {
            test: test_place,
            consequent: consequent.id,
            alternate,
            fallthrough: continuation_id,
            id: EvaluationOrder(0),
            loc,
        })
    })?;

    let obj = object.unwrap();

    builder.try_enter_reserved(consequent, |builder| {
        let lowered = lower_member_expression(builder, expr, Some(obj.clone()))?;
        let temp = lower_value_to_temporary(builder, lowered.value)?;
        lower_value_to_temporary(
            builder,
            InstructionValue::StoreLocal {
                lvalue: LValue {
                    kind: InstructionKind::Const,
                    place: place.clone(),
                },
                value: temp,
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
    })?;

    builder.terminate_with_continuation(
        Terminal::Optional {
            optional,
            test: test_block,
            fallthrough: continuation_id,
            id: EvaluationOrder(0),
            loc,
        },
        continuation_block,
    );

    Ok((obj, place))
}

pub(super) fn lower_optional_call_expression(
    builder: &mut HirBuilder,
    expr: &Expr,
) -> Result<InstructionValue, CompilerError> {
    lower_optional_call_expression_impl(builder, expr, None)
}

fn lower_optional_call_expression_impl(
    builder: &mut HirBuilder,
    expr: &Expr,
    parent_alternate: Option<BlockId>,
) -> Result<InstructionValue, CompilerError> {
    let Data::ECall(call) = &expr.data else {
        return Err(cold_todo(
            "lower_optional_call_expression: expected ECall",
            convert_loc(expr.loc),
        ));
    };
    let optional = matches!(call.optional_chain, Some(OptionalChain::Start));
    let loc = convert_loc(expr.loc);
    let place = build_temporary_place(builder, loc);
    let continuation_block = builder.reserve(builder.current_block_kind());
    let continuation_id = continuation_block.id;
    let consequent = builder.reserve(BlockKind::Value);

    let alternate = if let Some(parent_alt) = parent_alternate {
        parent_alt
    } else {
        builder.try_enter(BlockKind::Value, |builder, _block_id| {
            let temp = lower_value_to_temporary(
                builder,
                InstructionValue::Primitive {
                    value: PrimitiveValue::Undefined,
                    loc,
                },
            )?;
            lower_value_to_temporary(
                builder,
                InstructionValue::StoreLocal {
                    lvalue: LValue {
                        kind: InstructionKind::Const,
                        place: place.clone(),
                    },
                    value: temp,
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
        })?
    };

    enum CalleeInfo {
        CallExpression { callee: Place },
        MethodCall { receiver: Place, property: Place },
    }

    let mut callee_info: Option<CalleeInfo> = None;

    let test_block = builder.try_enter(BlockKind::Value, |builder, _block_id| {
        let callee = &call.target;
        match (&callee.data, optional_chain_of(callee)) {
            (Data::ECall(_), Some(_)) => {
                let value = lower_optional_call_expression_impl(builder, callee, Some(alternate))?;
                let value_place = lower_value_to_temporary(builder, value)?;
                callee_info = Some(CalleeInfo::CallExpression {
                    callee: value_place,
                });
            }
            (Data::EDot(_) | Data::EIndex(_), Some(_)) => {
                let (obj, value) =
                    lower_optional_member_expression_impl(builder, callee, Some(alternate))?;
                callee_info = Some(CalleeInfo::MethodCall {
                    receiver: obj,
                    property: value,
                });
            }
            (Data::EDot(_) | Data::EIndex(_), None) => {
                let lowered = lower_member_expression(builder, callee, None)?;
                let property_place = lower_value_to_temporary(builder, lowered.value)?;
                callee_info = Some(CalleeInfo::MethodCall {
                    receiver: lowered.object,
                    property: property_place,
                });
            }
            _ => {
                let callee_place = lower_expression_to_temporary(builder, callee)?;
                callee_info = Some(CalleeInfo::CallExpression {
                    callee: callee_place,
                });
            }
        }

        let test_place = match callee_info.as_ref().unwrap() {
            CalleeInfo::CallExpression { callee } => callee.clone(),
            CalleeInfo::MethodCall { property, .. } => property.clone(),
        };

        Ok(Terminal::Branch {
            test: test_place,
            consequent: consequent.id,
            alternate,
            fallthrough: continuation_id,
            id: EvaluationOrder(0),
            loc,
        })
    })?;

    builder.try_enter_reserved(consequent, |builder| {
        let args = lower_arguments(builder, &call.args)?;
        let temp = build_temporary_place(builder, loc);

        match callee_info.as_ref().unwrap() {
            CalleeInfo::CallExpression { callee } => {
                builder.push(Instruction {
                    id: EvaluationOrder(0),
                    lvalue: temp.clone(),
                    value: InstructionValue::CallExpression {
                        callee: callee.clone(),
                        args,
                        loc,
                    },
                    loc,
                    effects: None,
                });
            }
            CalleeInfo::MethodCall { receiver, property } => {
                builder.push(Instruction {
                    id: EvaluationOrder(0),
                    lvalue: temp.clone(),
                    value: InstructionValue::MethodCall {
                        receiver: receiver.clone(),
                        property: property.clone(),
                        args,
                        loc,
                    },
                    loc,
                    effects: None,
                });
            }
        }

        lower_value_to_temporary(
            builder,
            InstructionValue::StoreLocal {
                lvalue: LValue {
                    kind: InstructionKind::Const,
                    place: place.clone(),
                },
                value: temp,
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
    })?;

    builder.terminate_with_continuation(
        Terminal::Optional {
            optional,
            test: test_block,
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
