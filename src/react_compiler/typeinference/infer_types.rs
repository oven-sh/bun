// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Type inference pass.
//!
//! Generates type equations from the HIR, unifies them, and applies the
//! resolved types back to identifiers. Analogous to TS `InferTypes.ts`.

use crate::collections::FxHashMap as HashMap;

use crate::collections::{IdBitSet, IdMap};
use crate::diagnostics::{CompilerDiagnostic, ErrorCategory};
use crate::hir::environment::{Environment, is_hook_name};
use crate::hir::object_shape::{
    BUILT_IN_ARRAY_ID, BUILT_IN_FUNCTION_ID, BUILT_IN_JSX_ID, BUILT_IN_MIXED_READONLY_ID,
    BUILT_IN_OBJECT_ID, BUILT_IN_PROPS_ID, BUILT_IN_REF_VALUE_ID, BUILT_IN_SET_STATE_ID,
    BUILT_IN_USE_REF_ID, ShapeRegistry,
};
use crate::hir::visitors::{lvalues, operands};
use crate::hir::{
    ArrayPatternElement, AstAlloc, BinaryOperator, FunctionId, HirFunction, HirVec, Identifier,
    IdentifierId, IdentifierName, InstructionId, InstructionKind, InstructionValue, JsxAttribute,
    LoweredFunction, NonLocalBinding, ObjectPropertyKey, ObjectPropertyOrSpread, ParamPattern,
    Pattern, PhiOperand, PropertyLiteral, PropertyNameKind, ReactFunctionType, SourceLocation,
    StoreStr, Terminal, Type, TypeId,
};
use crate::ssa::enter_ssa::placeholder_function;

// =============================================================================
// Public API
// =============================================================================

pub(crate) fn infer_types(
    func: &mut HirFunction,
    env: &mut Environment,
) -> Result<(), CompilerDiagnostic> {
    let enable_treat_ref_like_identifiers_as_refs =
        env.config.enable_treat_ref_like_identifiers_as_refs;
    let enable_treat_set_identifiers_as_state_setters =
        env.config.enable_treat_set_identifiers_as_state_setters;
    // Pre-compute custom hook type for property resolution fallback
    let custom_hook_type = env.get_custom_hook_type_opt();
    let mut unifier = Unifier::new(
        enable_treat_ref_like_identifiers_as_refs,
        custom_hook_type,
        enable_treat_set_identifiers_as_state_setters,
        env.stack(),
    );
    let generated = generate(func, env, &mut unifier);
    if let Some(why) = unifier.gave_up() {
        return Err(why);
    }
    generated?;

    let mut apply = Apply {
        resolved: IdBitSet::with_ids(env.types.len()),
        identifiers: &env.identifiers,
        types: &mut env.types,
        unifier: &unifier,
    };
    apply.function(func, &env.functions);
    match unifier.gave_up() {
        Some(why) => Err(why),
        None => Ok(()),
    }
}

// =============================================================================
// Helpers
// =============================================================================

/// Get the type for an identifier as a TypeVar referencing its type slot.
fn get_type(id: IdentifierId, identifiers: &[Identifier]) -> Type {
    let type_id = identifiers[id.0 as usize].type_;
    Type::TypeVar { id: type_id }
}

/// `get_type`, as an operand of a phi.
fn get_phi_operand(id: IdentifierId, identifiers: &[Identifier]) -> PhiOperand {
    let type_id = identifiers[id.0 as usize].type_;
    PhiOperand::TypeVar { id: type_id }
}

/// Allocate a new TypeVar in the types arena (standalone, no &mut Environment needed).
fn make_type(types: &mut Vec<Type>) -> Type {
    let id = TypeId(types.len() as u32);
    types.push(Type::TypeVar { id });
    Type::TypeVar { id }
}

/// Pre-resolve LoadGlobal types for a single function's instructions.
fn pre_resolve_globals(
    func: &HirFunction,
    function_key: u32,
    env: &mut Environment,
    global_types: &mut HashMap<(u32, InstructionId), Type>,
) {
    for &instr_id in func.body.blocks.values().flat_map(|b| &b.instructions) {
        let instr = &func.instructions[instr_id.0 as usize];
        if let InstructionValue::LoadGlobal { binding, loc, .. } = &instr.value {
            if let Some(global_type) = resolve_load_global_type(env, binding, *loc) {
                global_types.insert((function_key, instr_id), global_type);
            }
        }
    }
}

/// Resolve the type for a LoadGlobal binding.
///
/// `hir_builder::resolve_identifier` classifies `Sk::Import` symbols whose
/// `namespace_alias` is not yet populated as `Global { name }`, and true
/// module-scope declarations as `ModuleLocal { name }`. This lets
/// `Environment::get_global_declaration` consult the React-API table only for
/// the former; a module-local `function useState() {…}` that shadows the
/// React import must resolve to the generic custom-hook type, not
/// `BuiltInUseState`.
fn resolve_load_global_type(
    env: &mut Environment,
    binding: &NonLocalBinding,
    loc: Option<SourceLocation>,
) -> Option<Type> {
    env.get_global_declaration(binding, loc).ok().flatten()
}

/// Recursively pre-resolve LoadGlobal types for an inner function and its children.
fn pre_resolve_globals_recursive(
    func_id: FunctionId,
    env: &mut Environment,
    global_types: &mut HashMap<(u32, InstructionId), Type>,
) {
    if !env.has_stack() {
        return;
    }

    // Collect LoadGlobal bindings and child function IDs in one pass to avoid
    // borrow conflicts (we need &env.functions to read, then &mut env for
    // get_global_declaration).
    let inner = &env.functions[func_id.0 as usize];
    let mut load_globals: Vec<(InstructionId, NonLocalBinding, Option<SourceLocation>)> =
        Vec::new();
    let mut child_func_ids: Vec<FunctionId> = Vec::new();

    for block in inner.body.blocks.values() {
        for &instr_id in &block.instructions {
            let instr = &inner.instructions[instr_id.0 as usize];
            match &instr.value {
                InstructionValue::LoadGlobal { binding, loc, .. } => {
                    load_globals.push((instr_id, binding.clone(), *loc));
                }
                InstructionValue::FunctionExpression {
                    lowered_func: LoweredFunction { func: fid },
                    ..
                }
                | InstructionValue::ObjectMethod {
                    lowered_func: LoweredFunction { func: fid },
                    ..
                } => {
                    child_func_ids.push(*fid);
                }
                _ => {}
            }
        }
    }

    // Now resolve globals (no longer borrowing env.functions)
    for (instr_id, binding, loc) in load_globals {
        if let Some(global_type) = resolve_load_global_type(env, &binding, loc) {
            global_types.insert((func_id.0, instr_id), global_type);
        }
    }

    // Recurse into child functions
    for child_id in child_func_ids {
        pre_resolve_globals_recursive(child_id, env, global_types);
    }
}

fn is_primitive_binary_op(op: &BinaryOperator) -> bool {
    matches!(
        op,
        BinaryOperator::Add
            | BinaryOperator::Subtract
            | BinaryOperator::Divide
            | BinaryOperator::Modulo
            | BinaryOperator::Multiply
            | BinaryOperator::Exponent
            | BinaryOperator::BitwiseAnd
            | BinaryOperator::BitwiseOr
            | BinaryOperator::ShiftRight
            | BinaryOperator::ShiftLeft
            | BinaryOperator::BitwiseXor
            | BinaryOperator::GreaterThan
            | BinaryOperator::LessThan
            | BinaryOperator::GreaterEqual
            | BinaryOperator::LessEqual
    )
}

/// `PropertyNameKind`, borrowed, without the type of a computed name.
#[derive(Clone, Copy)]
enum PropertyName<'a> {
    Literal(&'a PropertyLiteral),
    Computed,
}

impl<'a> From<&'a PropertyNameKind> for PropertyName<'a> {
    fn from(name: &'a PropertyNameKind) -> Self {
        match name {
            PropertyNameKind::Literal { value } => PropertyName::Literal(value),
            PropertyNameKind::Computed { .. } => PropertyName::Computed,
        }
    }
}

/// Resolve a property type from the shapes registry.
/// If `custom_hook_type` is provided and the property name looks like a hook,
/// it will be used as a fallback when no matching property is found (matching
/// TS `getPropertyType` behavior).
fn resolve_property_type(
    shapes: &ShapeRegistry,
    resolved_object: &Type,
    property_name: PropertyName,
    custom_hook_type: Option<&Type>,
) -> Option<Type> {
    let shape_id = match resolved_object {
        Type::Object { shape_id } | Type::Function { shape_id, .. } => *shape_id,
        _ => {
            // No shape, but if property name is hook-like, return hook type
            if let Some(hook_type) = custom_hook_type {
                if let PropertyName::Literal(PropertyLiteral::String(s)) = property_name {
                    if is_hook_name(s.slice()) {
                        return Some(hook_type.clone());
                    }
                }
            }
            return None;
        }
    };
    let shape_id = match shape_id {
        Some(id) => id,
        None => {
            // Object/Function with no shapeId: TS getPropertyType falls through
            // to hook-name check, TS getFallthroughPropertyType returns null
            if let PropertyName::Literal(PropertyLiteral::String(s)) = property_name {
                if is_hook_name(s.slice()) {
                    return custom_hook_type.cloned();
                }
            }
            return None;
        }
    };
    let shape = shapes.get(shape_id)?;

    match property_name {
        PropertyName::Literal(value) => match value {
            // Shape registry keys are `&'static str` (all ASCII); a property
            // name that is not valid UTF-8 cannot match any registry key, so
            // fall through to the `"*"` / hook-name fallback in that case.
            PropertyLiteral::String(s) => core::str::from_utf8(s.slice())
                .ok()
                .and_then(|k| shape.properties.get(k))
                .or_else(|| shape.properties.get("*"))
                .cloned()
                // Hook-name fallback: if property is not found in shape but looks
                // like a hook name, return the custom hook type
                .or_else(|| {
                    if is_hook_name(s.slice()) {
                        custom_hook_type.cloned()
                    } else {
                        None
                    }
                }),
            PropertyLiteral::Number(_) => shape.properties.get("*").cloned(),
        },
        PropertyName::Computed => shape.properties.get("*").cloned(),
    }
}

/// Check if a property access looks like a ref pattern (e.g. `ref.current`, `fooRef.current`).
/// Matches TS `isRefLikeName` in InferTypes.ts.
fn is_ref_like_name(object_name: &[u8], property_name: PropertyName) -> bool {
    let is_current = match property_name {
        PropertyName::Literal(PropertyLiteral::String(s)) => s.slice() == b"current",
        _ => false,
    };
    is_current && is_ref_like_object_name(object_name)
}

fn is_ref_like_object_name(object_name: &[u8]) -> bool {
    // Match TS regex: /^(?:[a-zA-Z$_][a-zA-Z$_0-9]*)Ref$|^ref$/
    // "Ref" alone does NOT match — requires at least one character before "Ref"
    // (e.g., "fooRef", "aRef" match, but bare "Ref" does not).
    object_name == b"ref"
        || (object_name.len() > 3
            && object_name.ends_with(b"Ref")
            && object_name
                .first()
                .is_some_and(|c| c.is_ascii_alphabetic() || *c == b'$' || *c == b'_'))
}

/// Type equality matching TS `typeEquals`.
///
/// Note: Function equality only compares return types (matching TS `funcTypeEquals`
/// which ignores `shapeId` and `isConstructor`). Phi equality always returns false
/// because the TS `phiTypeEquals` has a bug where `return false` is outside the
/// `if` block, so it unconditionally returns false.
fn type_equals(mut a: &Type, mut b: &Type) -> bool {
    loop {
        return match (a, b) {
            (Type::TypeVar { id: id_a }, Type::TypeVar { id: id_b }) => id_a == id_b,
            (Type::Primitive, Type::Primitive) => true,
            (Type::Poly, Type::Poly) => true,
            (Type::ObjectMethod, Type::ObjectMethod) => true,
            (Type::Object { shape_id: sa }, Type::Object { shape_id: sb }) => sa == sb,
            (
                Type::Function {
                    return_type: ra, ..
                },
                Type::Function {
                    return_type: rb, ..
                },
            ) => {
                (a, b) = (ra, rb);
                continue;
            }
            _ => false,
        };
    }
}

/// Only a name that is told from others: `get_name` is asked for nothing else.
fn set_name(
    names: &mut IdMap<IdentifierId, StoreStr>,
    id: IdentifierId,
    source: &Identifier,
    unifier: &Unifier,
) {
    if let Some(IdentifierName::Named(name)) = source.name
        && ((unifier.enable_treat_ref_like_identifiers_as_refs
            && is_ref_like_object_name(name.slice()))
            || (unifier.enable_treat_set_identifiers_as_state_setters
                && name.slice().starts_with(b"set")))
    {
        names.insert(id, name);
    }
}

fn get_name(names: &IdMap<IdentifierId, StoreStr>, id: IdentifierId) -> StoreStr {
    names.get(id).copied().unwrap_or(StoreStr::EMPTY)
}

/// Array-destructure index → property key. Static table covers every index a
/// shape registry can name (only `"0"`/`"1"` exist today); larger indices are
/// arena-allocated so the lookup string is preserved exactly.
fn index_property_literal(i: usize) -> PropertyLiteral {
    static INDEX_STRINGS: [&[u8]; 32] = [
        b"0", b"1", b"2", b"3", b"4", b"5", b"6", b"7", b"8", b"9", b"10", b"11", b"12", b"13",
        b"14", b"15", b"16", b"17", b"18", b"19", b"20", b"21", b"22", b"23", b"24", b"25", b"26",
        b"27", b"28", b"29", b"30", b"31",
    ];
    if let Some(&s) = INDEX_STRINGS.get(i) {
        return PropertyLiteral::String(StoreStr::new(s));
    }
    debug_assert!(i >= 32);
    let mut buf = [0u8; 20];
    let mut n = i;
    let mut pos = buf.len();
    while n > 0 {
        pos -= 1;
        buf[pos] = b'0' + (n % 10) as u8;
        n /= 10;
    }
    PropertyLiteral::String(StoreStr::new(AstAlloc::vec_from_slice(&buf[pos..]).leak()))
}

// =============================================================================
// Generate equations
// =============================================================================

/// Generate type equations from a top-level function.
///
/// Takes `&mut Environment` for convenience. Inner functions use
/// `generate_for_function_id` with split borrows instead, because the
/// take/replace pattern on `env.functions` requires separate `&mut` access
/// to different fields.
fn generate(
    func: &HirFunction,
    env: &mut Environment,
    unifier: &mut Unifier,
) -> Result<(), CompilerDiagnostic> {
    // Component params
    if func.fn_type == ReactFunctionType::Component {
        if let Some(first) = func.params.first() {
            if let ParamPattern::Place(place) = first {
                let ty = get_type(place.identifier, &env.identifiers);
                unifier.unify(
                    ty,
                    Type::Object {
                        shape_id: Some(BUILT_IN_PROPS_ID),
                    },
                    &env.shapes,
                )?;
            }
        }
        if let Some(second) = func.params.get(1) {
            if let ParamPattern::Place(place) = second {
                let ty = get_type(place.identifier, &env.identifiers);
                unifier.unify(
                    ty,
                    Type::Object {
                        shape_id: Some(BUILT_IN_USE_REF_ID),
                    },
                    &env.shapes,
                )?;
            }
        }
    }

    // Pre-resolve LoadGlobal types for all functions (outer + inner). We do
    // this before the instruction loop because get_global_declaration needs
    // &mut env, but generate_instruction_types takes split borrows on env fields.
    // The key is (function_key, InstructionId) where function_key is u32::MAX
    // for the outer function and FunctionId.0 for inner functions.
    let mut global_types: HashMap<(u32, InstructionId), Type> = HashMap::default();
    pre_resolve_globals(func, u32::MAX, env, &mut global_types);
    // Also pre-resolve inner functions recursively
    for &instr_id in func.body.blocks.values().flat_map(|b| &b.instructions) {
        let instr = &func.instructions[instr_id.0 as usize];
        match &instr.value {
            InstructionValue::FunctionExpression {
                lowered_func: LoweredFunction { func: func_id },
                ..
            }
            | InstructionValue::ObjectMethod {
                lowered_func: LoweredFunction { func: func_id },
                ..
            } => {
                pre_resolve_globals_recursive(*func_id, env, &mut global_types);
            }
            _ => {}
        }
    }

    let mut names: IdMap<IdentifierId, StoreStr> = IdMap::new();
    let mut return_types: HirVec<PhiOperand> = AstAlloc::vec();

    for (_block_id, block) in &func.body.blocks {
        // Phis
        for phi in &block.phis {
            let left = get_type(phi.place.identifier, &env.identifiers);
            let operands = phi
                .operands
                .values()
                .map(|p| get_phi_operand(p.identifier, &env.identifiers))
                .collect();
            unifier.unify(left, Type::Phi { operands }, &env.shapes)?;
        }

        // Instructions — use split borrows: &env.identifiers, &env.shapes
        // are immutable, while &mut env.types and &mut env.functions are mutable.
        for &instr_id in &block.instructions {
            let instr = &func.instructions[instr_id.0 as usize];
            generate_instruction_types(
                instr,
                instr_id,
                u32::MAX,
                &env.identifiers,
                &mut env.types,
                &mut env.functions,
                &mut names,
                &global_types,
                &env.shapes,
                unifier,
            )?;
        }

        // Return terminals
        if let Terminal::Return { ref value, .. } = block.terminal {
            return_types.push(get_phi_operand(value.identifier, &env.identifiers));
        }
    }

    // Unify return types
    let returns_type = get_type(func.returns.identifier, &env.identifiers);
    if return_types.len() > 1 {
        unifier.unify(
            returns_type,
            Type::Phi {
                operands: return_types[..].into(),
            },
            &env.shapes,
        )?;
    } else if return_types.len() == 1 {
        unifier.unify(returns_type, return_types[0].into(), &env.shapes)?;
    }
    Ok(())
}

/// Recursively generate equations for an inner function (accessed via FunctionId).
fn generate_for_function_id(
    func_id: FunctionId,
    identifiers: &[Identifier],
    types: &mut Vec<Type>,
    functions: &mut HirVec<HirFunction>,
    global_types: &HashMap<(u32, InstructionId), Type>,
    shapes: &ShapeRegistry,
    unifier: &mut Unifier,
) -> Result<(), CompilerDiagnostic> {
    if let Some(why) = unifier.gave_up() {
        return Err(why);
    }

    // Take the function out temporarily to avoid borrow conflicts
    let inner = std::mem::replace(&mut functions[func_id.0 as usize], placeholder_function());

    // Process params for component inner functions
    if inner.fn_type == ReactFunctionType::Component {
        if let Some(first) = inner.params.first() {
            if let ParamPattern::Place(place) = first {
                let ty = get_type(place.identifier, identifiers);
                unifier.unify(
                    ty,
                    Type::Object {
                        shape_id: Some(BUILT_IN_PROPS_ID),
                    },
                    shapes,
                )?;
            }
        }
        if let Some(second) = inner.params.get(1) {
            if let ParamPattern::Place(place) = second {
                let ty = get_type(place.identifier, identifiers);
                unifier.unify(
                    ty,
                    Type::Object {
                        shape_id: Some(BUILT_IN_USE_REF_ID),
                    },
                    shapes,
                )?;
            }
        }
    }

    // TS creates a fresh `names` Map per recursive `generate` call, so inner
    // functions don't inherit or pollute the outer function's name mappings.
    let mut inner_names: IdMap<IdentifierId, StoreStr> = IdMap::new();
    let mut inner_return_types: HirVec<PhiOperand> = AstAlloc::vec();

    for (_block_id, block) in &inner.body.blocks {
        for phi in &block.phis {
            let left = get_type(phi.place.identifier, identifiers);
            let operands = phi
                .operands
                .values()
                .map(|p| get_phi_operand(p.identifier, identifiers))
                .collect();
            unifier.unify(left, Type::Phi { operands }, shapes)?;
        }

        for &instr_id in &block.instructions {
            let instr = &inner.instructions[instr_id.0 as usize];
            generate_instruction_types(
                instr,
                instr_id,
                func_id.0,
                identifiers,
                types,
                functions,
                &mut inner_names,
                global_types,
                shapes,
                unifier,
            )?;
        }

        if let Terminal::Return { ref value, .. } = block.terminal {
            inner_return_types.push(get_phi_operand(value.identifier, identifiers));
        }
    }

    let returns_type = get_type(inner.returns.identifier, identifiers);
    if inner_return_types.len() > 1 {
        unifier.unify(
            returns_type,
            Type::Phi {
                operands: inner_return_types[..].into(),
            },
            shapes,
        )?;
    } else if inner_return_types.len() == 1 {
        unifier.unify(returns_type, inner_return_types[0].into(), shapes)?;
    }

    // Put the function back
    functions[func_id.0 as usize] = inner;
    Ok(())
}

fn generate_instruction_types(
    instr: &crate::hir::Instruction,
    instr_id: InstructionId,
    function_key: u32,
    identifiers: &[Identifier],
    types: &mut Vec<Type>,
    functions: &mut HirVec<HirFunction>,
    names: &mut IdMap<IdentifierId, StoreStr>,
    global_types: &HashMap<(u32, InstructionId), Type>,
    shapes: &ShapeRegistry,
    unifier: &mut Unifier,
) -> Result<(), CompilerDiagnostic> {
    let left = get_type(instr.lvalue.identifier, identifiers);

    match &instr.value {
        InstructionValue::TemplateLiteral { .. }
        | InstructionValue::JSXText { .. }
        | InstructionValue::Primitive { .. } => {
            unifier.unify(left, Type::Primitive, shapes)?;
        }

        InstructionValue::UnaryExpression { .. } => {
            unifier.unify(left, Type::Primitive, shapes)?;
        }

        InstructionValue::LoadLocal { place, .. } => {
            set_name(
                names,
                instr.lvalue.identifier,
                &identifiers[place.identifier.0 as usize],
                unifier,
            );
            let place_type = get_type(place.identifier, identifiers);
            unifier.unify(left, place_type, shapes)?;
        }

        InstructionValue::DeclareContext { .. } | InstructionValue::LoadContext { .. } => {
            // Intentionally skip type inference for most context variables
        }

        InstructionValue::StoreContext { lvalue, value, .. } => {
            if lvalue.kind == InstructionKind::Const {
                let lvalue_type = get_type(lvalue.place.identifier, identifiers);
                let value_type = get_type(value.identifier, identifiers);
                unifier.unify(lvalue_type, value_type, shapes)?;
            }
        }

        InstructionValue::StoreLocal { lvalue, value, .. } => {
            let value_type = get_type(value.identifier, identifiers);
            unifier.unify(left, value_type.clone(), shapes)?;
            let lvalue_type = get_type(lvalue.place.identifier, identifiers);
            unifier.unify(lvalue_type, value_type, shapes)?;
        }

        InstructionValue::StoreGlobal { value, .. } => {
            let value_type = get_type(value.identifier, identifiers);
            unifier.unify(left, value_type, shapes)?;
        }

        InstructionValue::BinaryExpression {
            operator,
            left: bin_left,
            right: bin_right,
            ..
        } => {
            if is_primitive_binary_op(operator) {
                let left_operand_type = get_type(bin_left.identifier, identifiers);
                unifier.unify(left_operand_type, Type::Primitive, shapes)?;
                let right_operand_type = get_type(bin_right.identifier, identifiers);
                unifier.unify(right_operand_type, Type::Primitive, shapes)?;
            }
            unifier.unify(left, Type::Primitive, shapes)?;
        }

        InstructionValue::PostfixUpdate { value, lvalue, .. }
        | InstructionValue::PrefixUpdate { value, lvalue, .. } => {
            let value_type = get_type(value.identifier, identifiers);
            unifier.unify(value_type, Type::Primitive, shapes)?;
            let lvalue_type = get_type(lvalue.identifier, identifiers);
            unifier.unify(lvalue_type, Type::Primitive, shapes)?;
            unifier.unify(left, Type::Primitive, shapes)?;
        }

        InstructionValue::LoadGlobal { .. } => {
            // Type was pre-resolved in generate() via env.get_global_declaration()
            if let Some(global_type) = global_types.get(&(function_key, instr_id)) {
                unifier.unify(left, global_type.clone(), shapes)?;
            }
        }

        InstructionValue::CallExpression { callee, .. } => {
            let return_type = make_type(types);
            let mut shape_id = None;
            if unifier.enable_treat_set_identifiers_as_state_setters {
                let name = get_name(names, callee.identifier);
                if name.slice().starts_with(b"set") {
                    shape_id = Some(BUILT_IN_SET_STATE_ID);
                }
            }
            let callee_type = get_type(callee.identifier, identifiers);
            unifier.unify(
                callee_type,
                Type::Function {
                    shape_id,
                    return_type: Box::new(return_type.clone()),
                    is_constructor: false,
                },
                shapes,
            )?;
            unifier.unify(left, return_type, shapes)?;
        }

        InstructionValue::TaggedTemplateExpression { tag, .. } => {
            let return_type = make_type(types);
            let tag_type = get_type(tag.identifier, identifiers);
            unifier.unify(
                tag_type,
                Type::Function {
                    shape_id: None,
                    return_type: Box::new(return_type.clone()),
                    is_constructor: false,
                },
                shapes,
            )?;
            unifier.unify(left, return_type, shapes)?;
        }

        InstructionValue::ObjectExpression { properties, .. } => {
            for prop in properties {
                if let ObjectPropertyOrSpread::Property(obj_prop) = prop {
                    if let ObjectPropertyKey::Computed { name } = &obj_prop.key {
                        let name_type = get_type(name.identifier, identifiers);
                        unifier.unify(name_type, Type::Primitive, shapes)?;
                    }
                }
            }
            unifier.unify(
                left,
                Type::Object {
                    shape_id: Some(BUILT_IN_OBJECT_ID),
                },
                shapes,
            )?;
        }

        InstructionValue::ArrayExpression { .. } => {
            unifier.unify(
                left,
                Type::Object {
                    shape_id: Some(BUILT_IN_ARRAY_ID),
                },
                shapes,
            )?;
        }

        InstructionValue::PropertyLoad {
            object, property, ..
        } => {
            let object_type = get_type(object.identifier, identifiers);
            let object_name = get_name(names, object.identifier);
            unifier.unify_property(
                left,
                &object_type,
                object_name,
                PropertyName::Literal(property),
                shapes,
            )?;
        }

        InstructionValue::ComputedLoad { object, .. } => {
            let object_type = get_type(object.identifier, identifiers);
            let object_name = get_name(names, object.identifier);
            unifier.unify_property(
                left,
                &object_type,
                object_name,
                PropertyName::Computed,
                shapes,
            )?;
        }

        InstructionValue::MethodCall { property, .. } => {
            let return_type = make_type(types);
            let prop_type = get_type(property.identifier, identifiers);
            unifier.unify(
                prop_type,
                Type::Function {
                    return_type: Box::new(return_type.clone()),
                    shape_id: None,
                    is_constructor: false,
                },
                shapes,
            )?;
            unifier.unify(left, return_type, shapes)?;
        }

        InstructionValue::Destructure { lvalue, value, .. } => match &lvalue.pattern {
            Pattern::Array(array_pattern) => {
                for (i, item) in array_pattern.items.iter().enumerate() {
                    match item {
                        ArrayPatternElement::Place(place) => {
                            let item_type = get_type(place.identifier, identifiers);
                            let value_type = get_type(value.identifier, identifiers);
                            let object_name = get_name(names, value.identifier);
                            unifier.unify_property(
                                item_type,
                                &value_type,
                                object_name,
                                PropertyName::Literal(&index_property_literal(i)),
                                shapes,
                            )?;
                        }
                        ArrayPatternElement::Spread(spread) => {
                            let spread_type = get_type(spread.place.identifier, identifiers);
                            unifier.unify(
                                spread_type,
                                Type::Object {
                                    shape_id: Some(BUILT_IN_ARRAY_ID),
                                },
                                shapes,
                            )?;
                        }
                        ArrayPatternElement::Hole => {
                            continue;
                        }
                    }
                }
            }
            Pattern::Object(object_pattern) => {
                for prop in &object_pattern.properties {
                    if let ObjectPropertyOrSpread::Property(obj_prop) = prop {
                        match &obj_prop.key {
                            ObjectPropertyKey::Identifier { name }
                            | ObjectPropertyKey::String { name } => {
                                let prop_place_type =
                                    get_type(obj_prop.place.identifier, identifiers);
                                let value_type = get_type(value.identifier, identifiers);
                                let object_name = get_name(names, value.identifier);
                                unifier.unify_property(
                                    prop_place_type,
                                    &value_type,
                                    object_name,
                                    PropertyName::Literal(&PropertyLiteral::String(*name)),
                                    shapes,
                                )?;
                            }
                            _ => {}
                        }
                    }
                }
            }
        },

        InstructionValue::TypeCastExpression { value, .. } => {
            let value_type = get_type(value.identifier, identifiers);
            unifier.unify(left, value_type, shapes)?;
        }

        InstructionValue::PropertyDelete { .. } | InstructionValue::ComputedDelete { .. } => {
            unifier.unify(left, Type::Primitive, shapes)?;
        }

        InstructionValue::FunctionExpression {
            lowered_func: LoweredFunction { func: func_id },
            ..
        } => {
            // Recurse into inner function first
            generate_for_function_id(
                *func_id,
                identifiers,
                types,
                functions,
                global_types,
                shapes,
                unifier,
            )?;
            // Get the inner function's return type
            let inner_func = &functions[func_id.0 as usize];
            let inner_return_type = get_type(inner_func.returns.identifier, identifiers);
            unifier.unify(
                left,
                Type::Function {
                    shape_id: Some(BUILT_IN_FUNCTION_ID),
                    return_type: Box::new(inner_return_type),
                    is_constructor: false,
                },
                shapes,
            )?;
        }

        InstructionValue::NextPropertyOf { .. } => {
            unifier.unify(left, Type::Primitive, shapes)?;
        }

        InstructionValue::ObjectMethod {
            lowered_func: LoweredFunction { func: func_id },
            ..
        } => {
            generate_for_function_id(
                *func_id,
                identifiers,
                types,
                functions,
                global_types,
                shapes,
                unifier,
            )?;
            unifier.unify(left, Type::ObjectMethod, shapes)?;
        }

        InstructionValue::JsxExpression { props, .. } => {
            if unifier.enable_treat_ref_like_identifiers_as_refs {
                for prop in props {
                    if let JsxAttribute::Attribute { name, place } = prop {
                        if name.slice() == b"ref" {
                            let ref_type = get_type(place.identifier, identifiers);
                            unifier.unify(
                                ref_type,
                                Type::Object {
                                    shape_id: Some(BUILT_IN_USE_REF_ID),
                                },
                                shapes,
                            )?;
                        }
                    }
                }
            }
            unifier.unify(
                left,
                Type::Object {
                    shape_id: Some(BUILT_IN_JSX_ID),
                },
                shapes,
            )?;
        }

        InstructionValue::JsxFragment { .. } => {
            unifier.unify(
                left,
                Type::Object {
                    shape_id: Some(BUILT_IN_JSX_ID),
                },
                shapes,
            )?;
        }

        InstructionValue::NewExpression { callee, .. } => {
            let return_type = make_type(types);
            let callee_type = get_type(callee.identifier, identifiers);
            unifier.unify(
                callee_type,
                Type::Function {
                    return_type: Box::new(return_type.clone()),
                    shape_id: None,
                    is_constructor: true,
                },
                shapes,
            )?;
            unifier.unify(left, return_type, shapes)?;
        }

        InstructionValue::PropertyStore {
            object, property, ..
        } => {
            let dummy = make_type(types);
            let object_type = get_type(object.identifier, identifiers);
            let object_name = get_name(names, object.identifier);
            unifier.unify_property(
                dummy,
                &object_type,
                object_name,
                PropertyName::Literal(property),
                shapes,
            )?;
        }

        InstructionValue::DeclareLocal { .. }
        | InstructionValue::RegExpLiteral { .. }
        | InstructionValue::MetaProperty { .. }
        | InstructionValue::ComputedStore { .. }
        | InstructionValue::Await { .. }
        | InstructionValue::GetIterator { .. }
        | InstructionValue::IteratorNext { .. }
        | InstructionValue::UnsupportedNode { .. }
        | InstructionValue::Debugger { .. }
        | InstructionValue::FinishMemoize { .. } => {
            // No type equations for these
        }

        InstructionValue::StartMemoize { .. } => {
            // No type equations for StartMemoize itself
        }
    }
    Ok(())
}

// =============================================================================
// Apply resolved types
// =============================================================================

struct Apply<'a> {
    identifiers: &'a [Identifier],
    types: &'a mut [Type],
    unifier: &'a Unifier,
    /// `Unifier::get` of what it has returned is the same again.
    resolved: IdBitSet<TypeId>,
}

impl Apply<'_> {
    fn function(&mut self, func: &HirFunction, functions: &[HirFunction]) {
        if !self.unifier.has_stack() {
            return;
        }

        for (_block_id, block) in &func.body.blocks {
            // Phi places
            for phi in &block.phis {
                self.resolve_identifier(phi.place.identifier);
            }

            for &instr_id in &block.instructions {
                let instr = &func.instructions[instr_id.0 as usize];

                // Instruction lvalue, and LValues from instruction values
                // (StoreLocal, StoreContext, DeclareLocal, DeclareContext, Destructure)
                for place in lvalues(instr) {
                    self.resolve_identifier(place.identifier);
                }

                // Operands, with the captured context variable places
                for place in operands(&instr.value, functions) {
                    self.resolve_identifier(place.identifier);
                }

                // Recurse into inner functions
                match &instr.value {
                    InstructionValue::FunctionExpression {
                        lowered_func: LoweredFunction { func: func_id },
                        ..
                    }
                    | InstructionValue::ObjectMethod {
                        lowered_func: LoweredFunction { func: func_id },
                        ..
                    } => {
                        self.function(&functions[func_id.0 as usize], functions);
                    }
                    _ => {}
                }
            }
        }

        // Resolve return type
        self.resolve_identifier(func.returns.identifier);
    }

    #[inline]
    fn resolve_identifier(&mut self, id: IdentifierId) {
        let type_id = self.identifiers[id.0 as usize].type_;
        if self.resolved.insert(type_id) {
            let ty = &mut self.types[type_id.0 as usize];
            if let Some(resolved) = self.unifier.get_if_changed(ty) {
                *ty = resolved;
            }
        }
    }
}

// =============================================================================
// Unifier
// =============================================================================

struct Unifier {
    substitutions: IdMap<TypeId, Type>,
    /// `occurs_check`: the type variables that it has been through. Empty outside of it.
    visited: IdBitSet<TypeId>,
    /// `occurs_check`: the type variables that it has yet to go through. Empty outside of it.
    pending: Vec<TypeId>,
    enable_treat_ref_like_identifiers_as_refs: bool,
    enable_treat_set_identifiers_as_state_setters: bool,
    custom_hook_type: Option<Type>,
    stack: bun_core::StackCheck,
    is_out_of_stack: std::cell::Cell<bool>,
}

impl Unifier {
    fn new(
        enable_treat_ref_like_identifiers_as_refs: bool,
        custom_hook_type: Option<Type>,
        enable_treat_set_identifiers_as_state_setters: bool,
        stack: bun_core::StackCheck,
    ) -> Self {
        Unifier {
            substitutions: IdMap::new(),
            visited: IdBitSet::new(),
            pending: Vec::new(),
            enable_treat_ref_like_identifiers_as_refs,
            enable_treat_set_identifiers_as_state_setters,
            custom_hook_type,
            stack,
            is_out_of_stack: std::cell::Cell::new(false),
        }
    }

    /// As `Environment::has_stack`, whose fields `infer_types` lends out one by one.
    fn has_stack(&self) -> bool {
        if !self.stack.is_safe_to_recurse() {
            self.is_out_of_stack.set(true);
        }
        !self.is_out_of_stack.get()
    }

    /// Something was left out, and `infer_types` fails.
    #[inline]
    fn gave_up(&self) -> Option<CompilerDiagnostic> {
        (!self.has_stack()).then(crate::lowering::nested_too_deeply)
    }

    fn unify(
        &mut self,
        t_a: Type,
        t_b: Type,
        shapes: &ShapeRegistry,
    ) -> Result<(), CompilerDiagnostic> {
        self.unify_impl(t_a, t_b, shapes)
    }

    /// `unify` with a `Type::Property`.
    fn unify_property(
        &mut self,
        t_a: Type,
        object_type: &Type,
        object_name: StoreStr,
        property_name: PropertyName,
        shapes: &ShapeRegistry,
    ) -> Result<(), CompilerDiagnostic> {
        // Check enableTreatRefLikeIdentifiersAsRefs
        if self.enable_treat_ref_like_identifiers_as_refs
            && is_ref_like_name(object_name.slice(), property_name)
        {
            self.unify_impl(
                object_type.clone(),
                Type::Object {
                    shape_id: Some(BUILT_IN_USE_REF_ID),
                },
                shapes,
            )?;
            self.unify_impl(
                t_a,
                Type::Object {
                    shape_id: Some(BUILT_IN_REF_VALUE_ID),
                },
                shapes,
            )?;
            return Ok(());
        }

        // Resolve property type via the shapes registry
        let property_type = resolve_property_type(
            shapes,
            self.get_outermost(object_type),
            property_name,
            self.custom_hook_type.as_ref(),
        );
        if let Some(property_type) = property_type {
            self.unify_impl(t_a, property_type, shapes)?;
        }
        Ok(())
    }

    fn unify_impl(
        &mut self,
        t_a: Type,
        t_b: Type,
        shapes: &ShapeRegistry,
    ) -> Result<(), CompilerDiagnostic> {
        // Handle Property in the RHS position
        if let Type::Property {
            ref object_type,
            object_name,
            ref property_name,
        } = t_b
        {
            return self.unify_property(
                t_a,
                object_type,
                object_name,
                property_name.into(),
                shapes,
            );
        }

        if let Type::TypeVar { id } = t_a {
            if matches!(t_b, Type::TypeVar { id: other } if other == id) {
                return Ok(());
            }
            if let Some(why) = self.gave_up() {
                return Err(why);
            }
            return self.bind_variable_to(id, t_b, shapes);
        }

        if type_equals(&t_a, &t_b) {
            return Ok(());
        }
        if let Some(why) = self.gave_up() {
            return Err(why);
        }

        if let Type::TypeVar { id } = t_b {
            self.bind_variable_to(id, t_a, shapes)?;
            return Ok(());
        }

        if let (
            Type::Function {
                return_type: ret_a,
                is_constructor: con_a,
                ..
            },
            Type::Function {
                return_type: ret_b,
                is_constructor: con_b,
                ..
            },
        ) = (t_a, t_b)
        {
            if con_a == con_b {
                self.unify_impl(*ret_a, *ret_b, shapes)?;
            }
        }
        Ok(())
    }

    /// `ty` is not the variable.
    fn bind_variable_to(
        &mut self,
        v_id: TypeId,
        mut ty: Type,
        shapes: &ShapeRegistry,
    ) -> Result<(), CompilerDiagnostic> {
        if let Type::Poly = &ty {
            // Ignore PolyType
            return Ok(());
        }

        if let Some(existing) = self.substitutions.get(v_id) {
            return match (existing, &ty) {
                (Type::TypeVar { .. }, _)
                | (_, Type::TypeVar { .. } | Type::Property { .. })
                | (Type::Function { .. }, Type::Function { .. }) => {
                    let existing = existing.clone();
                    self.unify_impl(existing, ty, shapes)
                }
                // `unify_impl` has nothing to do with the others.
                _ => Ok(()),
            };
        }

        let v = Type::TypeVar { id: v_id };
        // What `unify_impl` of the variable and `existing` comes to.
        while let Type::TypeVar { id: ty_id } = ty
            && let Some(existing) = self.substitutions.get(ty_id)
        {
            match existing {
                Type::TypeVar { id } if *id == v_id => return Ok(()),
                Type::Poly => return Ok(()),
                Type::Property { .. } => {
                    let existing = existing.clone();
                    return self.unify_impl(v, existing, shapes);
                }
                _ => ty = existing.clone(),
            }
        }
        if let Type::TypeVar { .. } = ty {
            // It is not bound and it is another: the variable does not occur in it.
            self.substitutions.insert(v_id, ty);
            return Ok(());
        }

        if let Type::Phi { ref operands } = ty {
            if operands.is_empty() {
                return Err(CompilerDiagnostic {
                    category: ErrorCategory::Invariant,
                    reason: "there should be at least one operand".to_string(),
                    description: None,
                    details: vec![],
                    suggestions: None,
                });
            }

            let mut candidate_type: Option<Type> = None;
            for &operand in operands.iter() {
                let resolved = self.get(&operand.into());
                match &candidate_type {
                    None => {
                        candidate_type = Some(resolved);
                    }
                    Some(candidate) => {
                        if !type_equals(&resolved, candidate) {
                            let union_type = try_union_types(&resolved, candidate);
                            if let Some(union) = union_type {
                                candidate_type = Some(union);
                            } else {
                                candidate_type = None;
                                break;
                            }
                        }
                        // else same type, continue
                    }
                }
            }

            if let Some(candidate) = candidate_type {
                self.unify_impl(v, candidate, shapes)?;
                return Ok(());
            }
        }

        // Not in upstream: its `occursCheck` and `tryResolveType` go through types, and these go through type variables.
        let mut is_changed = false;
        if let Type::Phi { operands } = &ty {
            let occurs = self.occurs_check(v_id, operands);
            for &operand in operands.iter() {
                let PhiOperand::TypeVar { id } = operand else {
                    continue;
                };
                let Some(bound) = self.substitutions.get(id) else {
                    continue;
                };
                let bound = self.get_outermost(bound);
                let mut rebound = match (self.without(v_id, bound), bound) {
                    (Some(without), _) => without,
                    // Upstream binds each operand again to a copy of its binding, also where the variable is not in it.
                    (None, Type::Phi { operands: same }) if occurs => Type::Phi {
                        operands: same.clone(),
                    },
                    (None, _) => continue,
                };
                self.hold(&mut rebound);
                self.substitutions.insert(id, rebound);
                is_changed = true;
            }
        }
        if let Some(without) = self.without(v_id, &ty) {
            ty = without;
            is_changed = true;
        }
        if is_changed {
            self.hold(&mut ty);
        }
        self.substitutions.insert(v_id, ty);
        Ok(())
    }

    /// Whether the type variable is reached from the operands through the bindings of type variables.
    fn occurs_check(&mut self, v_id: TypeId, operands: &[PhiOperand]) -> bool {
        let mut occurs = false;
        // The operands themselves take no scratch: only a phi or a function behind one has more to go through.
        'operands: for operand in operands {
            let (PhiOperand::TypeVar { mut id } | PhiOperand::Held { mut id }) = *operand else {
                continue;
            };
            loop {
                if id == v_id {
                    occurs = true;
                    break 'operands;
                }
                match self.substitutions.get(id) {
                    Some(Type::TypeVar { id: alias }) => id = *alias,
                    Some(bound @ (Type::Phi { .. } | Type::Function { .. })) => {
                        if self.visited.insert(id) {
                            push_type_variables(bound, &mut self.pending);
                        }
                        break;
                    }
                    _ => break,
                }
            }
        }
        while !occurs && let Some(id) = self.pending.pop() {
            if id == v_id {
                occurs = true;
            } else if self.visited.insert(id)
                && let Some(bound) = self.substitutions.get(id)
            {
                push_type_variables(bound, &mut self.pending);
            }
        }
        self.pending.clear();
        if !self.visited.is_empty() {
            self.visited.clear();
        }
        occurs
    }

    /// The operands that are bound to a phi or to a function become `Held`.
    fn hold(&self, ty: &mut Type) {
        let Type::Phi { operands } = ty else {
            return;
        };
        let is_phi_or_function = |id| {
            matches!(
                self.get_outermost(&Type::TypeVar { id }),
                Type::Phi { .. } | Type::Function { .. }
            )
        };
        let held = |operand: &PhiOperand| match *operand {
            PhiOperand::TypeVar { id } if is_phi_or_function(id) => PhiOperand::Held { id },
            other => other,
        };
        for operand in operands.iter_mut() {
            *operand = held(operand);
        }
    }

    /// The phi without the operands that are the variable, or the function that returns it. `None`: it is as it was.
    fn without(&self, v_id: TypeId, ty: &Type) -> Option<Type> {
        match ty {
            Type::Phi { operands } => {
                let is_other = |operand: &PhiOperand| {
                    !matches!(
                        self.get_operand(*operand),
                        PhiOperand::TypeVar { id } | PhiOperand::Held { id } if id == v_id
                    )
                };
                let mut is_changed = !operands.iter().all(is_other);
                if !is_changed && operands.len() != 1 {
                    return None;
                }
                let mut left: Vec<PhiOperand> = operands.iter().copied().filter(is_other).collect();
                // The chain ends where it is back at `mark`, a type variable that it went through.
                let (mut mark, mut steps) = (None, 0usize);
                // Not in upstream: one operand left that is bound to a phi is that phi there, and a copy of its list here.
                while let [only] = left[..]
                    && let PhiOperand::TypeVar { id } | PhiOperand::Held { id } =
                        self.get_operand(only)
                    && let Some(Type::Phi { operands: behind }) = self.substitutions.get(id)
                    && mark != Some(id)
                {
                    steps += 1;
                    if steps.is_power_of_two() {
                        mark = Some(id);
                    }
                    left = behind.iter().copied().filter(is_other).collect();
                    is_changed = true;
                }
                is_changed.then(|| Type::Phi {
                    operands: left.into(),
                })
            }
            Type::Function {
                shape_id,
                return_type,
                is_constructor,
            } if self.has_stack() => {
                let return_type = self.without(v_id, self.get_outermost(return_type))?;
                Some(Type::Function {
                    shape_id: *shape_id,
                    return_type: Box::new(return_type),
                    is_constructor: *is_constructor,
                })
            }
            _ => None,
        }
    }

    /// `get`, but for what is inside the type.
    #[inline]
    fn get_outermost<'a>(&'a self, mut ty: &'a Type) -> &'a Type {
        while let Type::TypeVar { id } = ty
            && let Some(sub) = self.substitutions.get(*id)
        {
            ty = sub;
        }
        ty
    }

    fn get(&self, ty: &Type) -> Type {
        let ty = self.get_outermost(ty);
        match ty {
            Type::Phi { operands } => Type::Phi {
                operands: self
                    .get_operands_if_changed(operands)
                    .unwrap_or_else(|| operands.clone()),
            },
            Type::Function {
                is_constructor,
                shape_id,
                return_type,
            } if self.has_stack() => Type::Function {
                is_constructor: *is_constructor,
                shape_id: *shape_id,
                return_type: Box::new(self.get(return_type)),
            },
            _ => ty.clone(),
        }
    }

    /// `get`, or `None` where no type variable in it is bound.
    fn get_if_changed(&self, ty: &Type) -> Option<Type> {
        match ty {
            Type::TypeVar { id } => self.substitutions.get(*id).map(|sub| self.get(sub)),
            Type::Phi { operands } => self
                .get_operands_if_changed(operands)
                .map(|operands| Type::Phi { operands }),
            Type::Function {
                is_constructor,
                shape_id,
                return_type,
            } if self.has_stack() => {
                self.get_if_changed(return_type)
                    .map(|return_type| Type::Function {
                        is_constructor: *is_constructor,
                        shape_id: *shape_id,
                        return_type: Box::new(return_type),
                    })
            }
            _ => None,
        }
    }

    fn get_operands_if_changed(&self, operands: &[PhiOperand]) -> Option<Box<[PhiOperand]>> {
        let mut changed: Option<Vec<PhiOperand>> = None;
        for (index, &operand) in operands.iter().enumerate() {
            let resolved = self.get_operand(operand);
            if resolved != operand && changed.is_none() {
                let mut as_they_were = Vec::with_capacity(operands.len());
                as_they_were.extend_from_slice(&operands[..index]);
                changed = Some(as_they_were);
            }
            if let Some(changed) = &mut changed {
                changed.push(resolved);
            }
        }
        changed.map(Vec::into_boxed_slice)
    }

    /// `get` of an operand of a phi: what it is bound to where that holds no other type, else the last type variable.
    fn get_operand(&self, operand: PhiOperand) -> PhiOperand {
        let (mut last, is_held) = match operand {
            PhiOperand::TypeVar { id } => (id, false),
            PhiOperand::Held { id } => (id, true),
            leaf => return leaf,
        };
        loop {
            match self.substitutions.get(last) {
                Some(Type::TypeVar { id }) => last = *id,
                Some(Type::Primitive) => return PhiOperand::Primitive,
                Some(Type::Object { shape_id }) => {
                    return PhiOperand::Object {
                        shape_id: *shape_id,
                    };
                }
                Some(Type::ObjectMethod) => return PhiOperand::ObjectMethod,
                // Nothing binds a type variable to the last two.
                Some(
                    Type::Phi { .. } | Type::Function { .. } | Type::Poly | Type::Property { .. },
                )
                | None => break,
            }
        }
        if is_held {
            PhiOperand::Held { id: last }
        } else {
            PhiOperand::TypeVar { id: last }
        }
    }
}

/// The type variables that the type holds, which for a function are those of what it returns.
fn push_type_variables(mut ty: &Type, into: &mut Vec<TypeId>) {
    while let Type::Function { return_type, .. } = ty {
        ty = return_type;
    }
    match ty {
        Type::TypeVar { id } => into.push(*id),
        Type::Phi { operands } => {
            into.extend(operands.iter().filter_map(|operand| match *operand {
                PhiOperand::TypeVar { id } | PhiOperand::Held { id } => Some(id),
                _ => None,
            }))
        }
        _ => {}
    }
}

// =============================================================================
// Union types helper
// =============================================================================

fn try_union_types(ty1: &Type, ty2: &Type) -> Option<Type> {
    let (readonly_type, other_type) = if matches!(ty1, Type::Object { shape_id } if *shape_id == Some(BUILT_IN_MIXED_READONLY_ID))
    {
        (ty1, ty2)
    } else if matches!(ty2, Type::Object { shape_id } if *shape_id == Some(BUILT_IN_MIXED_READONLY_ID))
    {
        (ty2, ty1)
    } else {
        return None;
    };

    if matches!(other_type, Type::Primitive) {
        // Union(Primitive | MixedReadonly) = MixedReadonly
        return Some(readonly_type.clone());
    } else if matches!(other_type, Type::Object { shape_id } if *shape_id == Some(BUILT_IN_ARRAY_ID))
    {
        // Union(Array | MixedReadonly) = Array
        return Some(other_type.clone());
    }

    None
}
