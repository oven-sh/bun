// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Type inference pass.
//!
//! Generates type equations from the HIR, unifies them, and applies the
//! resolved types back to identifiers. Analogous to TS `InferTypes.ts`.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

use crate::collections::{FxHashMap, FxHashSet, IdMap};
use crate::diagnostics::{CompilerDiagnostic, ErrorCategory};
use crate::hir::environment::{Environment, is_hook_name};
use crate::hir::object_shape::{
    BUILT_IN_ARRAY_ID, BUILT_IN_FUNCTION_ID, BUILT_IN_JSX_ID, BUILT_IN_MIXED_READONLY_ID,
    BUILT_IN_OBJECT_ID, BUILT_IN_PROPS_ID, BUILT_IN_REF_VALUE_ID, BUILT_IN_SET_STATE_ID,
    BUILT_IN_USE_REF_ID, ShapeRegistry,
};
use crate::hir::visitors::{each_lvalue, each_operand};
use crate::hir::{
    ArrayPatternElement, AstAlloc, BinaryOperator, FunctionId, HirFunction, HirVec, Identifier,
    IdentifierId, IdentifierName, InstructionId, InstructionKind, InstructionValue, JsxAttribute,
    LoweredFunction, NonLocalBinding, ObjectPropertyKey, ObjectPropertyOrSpread, ParamPattern,
    Pattern, PropertyLiteral, PropertyNameKind, ReactFunctionType, SourceLocation, StoreStr,
    Terminal, Type, TypeId,
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
    );
    let generated = generate(func, env, &mut unifier);
    if let Some(why) = unifier.gave_up() {
        bun_core::scoped_log!(crate::lowering::ReactCompilerBudget, "types over");
        return Err(why);
    }
    generated?;

    apply_function(
        func,
        &env.functions,
        &mut env.identifiers,
        &mut env.types,
        &mut unifier,
    );
    let steps = unifier.steps.get();
    bun_core::scoped_log!(crate::lowering::ReactCompilerBudget, "types {}", steps);
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

/// Resolve a property type from the shapes registry.
/// If `custom_hook_type` is provided and the property name looks like a hook,
/// it will be used as a fallback when no matching property is found (matching
/// TS `getPropertyType` behavior).
fn resolve_property_type(
    shapes: &ShapeRegistry,
    resolved_object: &Type,
    property_name: &PropertyNameKind,
    custom_hook_type: Option<&Type>,
) -> Option<Type> {
    let shape_id = match resolved_object {
        Type::Object { shape_id } | Type::Function { shape_id, .. } => *shape_id,
        _ => {
            // No shape, but if property name is hook-like, return hook type
            if let Some(hook_type) = custom_hook_type {
                if let PropertyNameKind::Literal {
                    value: PropertyLiteral::String(s),
                } = property_name
                {
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
            if let PropertyNameKind::Literal {
                value: PropertyLiteral::String(s),
            } = property_name
            {
                if is_hook_name(s.slice()) {
                    return custom_hook_type.cloned();
                }
            }
            return None;
        }
    };
    let shape = shapes.get(shape_id)?;

    match property_name {
        PropertyNameKind::Literal { value } => match value {
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
        PropertyNameKind::Computed { .. } => shape.properties.get("*").cloned(),
    }
}

/// Check if a property access looks like a ref pattern (e.g. `ref.current`, `fooRef.current`).
/// Matches TS `isRefLikeName` in InferTypes.ts.
fn is_ref_like_name(object_name: &[u8], property_name: &PropertyNameKind) -> bool {
    let is_current = match property_name {
        PropertyNameKind::Literal {
            value: PropertyLiteral::String(s),
        } => s.slice() == b"current",
        _ => false,
    };
    if !is_current {
        return false;
    }
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
fn type_equals(a: &Type, b: &Type) -> bool {
    match (a, b) {
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
        ) => type_equals(ra, rb),
        _ => false,
    }
}

fn set_name(names: &mut IdMap<IdentifierId, StoreStr>, id: IdentifierId, source: &Identifier) {
    if let Some(IdentifierName::Named(name)) = source.name {
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
    let mut global_types: HashMap<(u32, InstructionId), Type> = HashMap::new();
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
    let mut return_types: HirVec<Type> = AstAlloc::vec();

    for (_block_id, block) in &func.body.blocks {
        // Phis
        for phi in &block.phis {
            let left = get_type(phi.place.identifier, &env.identifiers);
            let operands = phi
                .operands
                .values()
                .map(|p| get_type(p.identifier, &env.identifiers))
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
            return_types.push(get_type(value.identifier, &env.identifiers));
        }
    }

    // Unify return types
    let returns_type = get_type(func.returns.identifier, &env.identifiers);
    if return_types.len() > 1 {
        unifier.unify(
            returns_type,
            Type::Phi {
                operands: Arc::from(&return_types[..]),
            },
            &env.shapes,
        )?;
    } else if return_types.len() == 1 {
        unifier.unify(
            returns_type,
            return_types.into_iter().next().unwrap(),
            &env.shapes,
        )?;
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
    let mut inner_return_types: HirVec<Type> = AstAlloc::vec();

    for (_block_id, block) in &inner.body.blocks {
        for phi in &block.phis {
            let left = get_type(phi.place.identifier, identifiers);
            let operands = phi
                .operands
                .values()
                .map(|p| get_type(p.identifier, identifiers))
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
            inner_return_types.push(get_type(value.identifier, identifiers));
        }
    }

    let returns_type = get_type(inner.returns.identifier, identifiers);
    if inner_return_types.len() > 1 {
        unifier.unify(
            returns_type,
            Type::Phi {
                operands: Arc::from(&inner_return_types[..]),
            },
            shapes,
        )?;
    } else if inner_return_types.len() == 1 {
        unifier.unify(
            returns_type,
            inner_return_types.into_iter().next().unwrap(),
            shapes,
        )?;
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
            unifier.unify(
                left,
                Type::Property {
                    object_type: Box::new(object_type),
                    object_name,
                    property_name: PropertyNameKind::Literal {
                        value: property.clone(),
                    },
                },
                shapes,
            )?;
        }

        InstructionValue::ComputedLoad {
            object, property, ..
        } => {
            let object_type = get_type(object.identifier, identifiers);
            let object_name = get_name(names, object.identifier);
            let prop_type = get_type(property.identifier, identifiers);
            unifier.unify(
                left,
                Type::Property {
                    object_type: Box::new(object_type),
                    object_name,
                    property_name: PropertyNameKind::Computed {
                        value: Box::new(prop_type),
                    },
                },
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
                            unifier.unify(
                                item_type,
                                Type::Property {
                                    object_type: Box::new(value_type),
                                    object_name,
                                    property_name: PropertyNameKind::Literal {
                                        value: index_property_literal(i),
                                    },
                                },
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
                                unifier.unify(
                                    prop_place_type,
                                    Type::Property {
                                        object_type: Box::new(value_type),
                                        object_name,
                                        property_name: PropertyNameKind::Literal {
                                            value: PropertyLiteral::String(*name),
                                        },
                                    },
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
            unifier.unify(
                dummy,
                Type::Property {
                    object_type: Box::new(object_type),
                    object_name,
                    property_name: PropertyNameKind::Literal {
                        value: property.clone(),
                    },
                },
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

fn apply_function(
    func: &HirFunction,
    functions: &[HirFunction],
    identifiers: &mut [Identifier],
    types: &mut Vec<Type>,
    unifier: &Unifier,
) {
    for (_block_id, block) in &func.body.blocks {
        // Phi places
        for phi in &block.phis {
            resolve_identifier(phi.place.identifier, identifiers, types, unifier);
        }

        for &instr_id in &block.instructions {
            let instr = &func.instructions[instr_id.0 as usize];

            // Instruction lvalue
            resolve_identifier(instr.lvalue.identifier, identifiers, types, unifier);

            // LValues from instruction values (StoreLocal, StoreContext, DeclareLocal, DeclareContext, Destructure)
            each_lvalue(&instr.value, |p| {
                resolve_identifier(p.identifier, identifiers, types, unifier)
            });

            // Operands
            each_operand(&instr.value, |p| {
                resolve_identifier(p.identifier, identifiers, types, unifier)
            });

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
                    let inner_func = &functions[func_id.0 as usize];
                    // Resolve types for captured context variable places (matching TS
                    // where eachInstructionValueOperand yields func.context places)
                    for ctx in &inner_func.context {
                        resolve_identifier(ctx.identifier, identifiers, types, unifier);
                    }
                    apply_function(inner_func, functions, identifiers, types, unifier);
                }
                _ => {}
            }
        }
    }

    // Resolve return type
    resolve_identifier(func.returns.identifier, identifiers, types, unifier);
}

fn resolve_identifier(
    id: IdentifierId,
    identifiers: &mut [Identifier],
    types: &mut Vec<Type>,
    unifier: &Unifier,
) {
    let type_id = identifiers[id.0 as usize].type_;
    let current_type = types[type_id.0 as usize].clone();
    let resolved = unifier.get(&current_type);
    types[type_id.0 as usize] = resolved;
}

// =============================================================================
// Unifier
// =============================================================================

/// A fence. The largest of 157,000 real functions takes 57,000, and no source is known that comes near this.
const MAX_STEPS: u32 = 1 << 22;

/// What was made of a phi, by the address of its operands, which are held so that the address stays theirs.
type OfPhis<T> = FxHashMap<*const Type, (Arc<[Type]>, T)>;

struct Unifier {
    substitutions: HashMap<TypeId, Type>,
    /// What `get` made of a phi since `substitutions` was last written. `None`: nothing in it had changed.
    resolved: RefCell<OfPhis<Option<Arc<[Type]>>>>,
    enable_treat_ref_like_identifiers_as_refs: bool,
    enable_treat_set_identifiers_as_state_setters: bool,
    custom_hook_type: Option<Type>,
    stack: bun_core::StackCheck,
    is_out_of_stack: std::cell::Cell<bool>,
    /// How many parts of types were gone into.
    steps: std::cell::Cell<u32>,
}

impl Unifier {
    fn new(
        enable_treat_ref_like_identifiers_as_refs: bool,
        custom_hook_type: Option<Type>,
        enable_treat_set_identifiers_as_state_setters: bool,
    ) -> Self {
        Unifier {
            substitutions: HashMap::new(),
            resolved: RefCell::default(),
            enable_treat_ref_like_identifiers_as_refs,
            enable_treat_set_identifiers_as_state_setters,
            custom_hook_type,
            stack: bun_core::StackCheck::init(),
            is_out_of_stack: std::cell::Cell::new(false),
            steps: std::cell::Cell::new(0),
        }
    }

    /// As `Environment::has_stack`, whose fields `infer_types` lends out one by one.
    fn has_stack(&self) -> bool {
        if !self.stack.is_safe_to_recurse() {
            self.is_out_of_stack.set(true);
        }
        !self.is_out_of_stack.get()
    }

    #[inline]
    fn substitute(&mut self, id: TypeId, ty: Type) {
        self.substitutions.insert(id, ty);
        self.resolved.get_mut().clear();
    }

    /// `has_stack`, and within [`MAX_STEPS`], which is the same on every platform.
    fn may_go_into(&self, parts: usize) -> bool {
        let steps = self.steps.get().saturating_add(parts as u32);
        self.steps.set(steps);
        steps <= MAX_STEPS && self.has_stack()
    }

    /// Something was left out, and `infer_types` fails.
    #[inline]
    fn gave_up(&self) -> Option<CompilerDiagnostic> {
        (!self.may_go_into(0)).then(|| self.why_it_gave_up())
    }

    #[cold]
    fn why_it_gave_up(&self) -> CompilerDiagnostic {
        if self.steps.get() > MAX_STEPS {
            crate::lowering::too_complex("Its types are too complex to infer")
        } else {
            crate::lowering::nested_too_deeply()
        }
    }

    fn unify(
        &mut self,
        t_a: Type,
        t_b: Type,
        shapes: &ShapeRegistry,
    ) -> Result<(), CompilerDiagnostic> {
        self.unify_impl(t_a, t_b, shapes)
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
            ref object_name,
            ref property_name,
        } = t_b
        {
            // Check enableTreatRefLikeIdentifiersAsRefs
            if self.enable_treat_ref_like_identifiers_as_refs
                && is_ref_like_name(object_name.slice(), property_name)
            {
                self.unify_impl(
                    *object_type.clone(),
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
            let resolved_object = self.get(object_type);
            let property_type = resolve_property_type(
                shapes,
                &resolved_object,
                property_name,
                self.custom_hook_type.as_ref(),
            );
            if let Some(property_type) = property_type {
                self.unify_impl(t_a, property_type, shapes)?;
            }
            return Ok(());
        }

        if type_equals(&t_a, &t_b) {
            return Ok(());
        }
        if let Some(why) = self.gave_up() {
            return Err(why);
        }

        if let Type::TypeVar { .. } = &t_a {
            self.bind_variable_to(t_a, t_b, shapes)?;
            return Ok(());
        }

        if let Type::TypeVar { .. } = &t_b {
            self.bind_variable_to(t_b, t_a, shapes)?;
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
        ) = (&t_a, &t_b)
        {
            if con_a == con_b {
                self.unify_impl(*ret_a.clone(), *ret_b.clone(), shapes)?;
            }
        }
        Ok(())
    }

    fn bind_variable_to(
        &mut self,
        v: Type,
        ty: Type,
        shapes: &ShapeRegistry,
    ) -> Result<(), CompilerDiagnostic> {
        let v_id = match &v {
            Type::TypeVar { id } => *id,
            _ => return Ok(()),
        };

        if let Type::Poly = &ty {
            // Ignore PolyType
            return Ok(());
        }

        if let Some(existing) = self.substitutions.get(&v_id).cloned() {
            self.unify_impl(existing, ty, shapes)?;
            return Ok(());
        }

        if let Type::TypeVar { id: ty_id } = &ty {
            if let Some(existing) = self.substitutions.get(ty_id).cloned() {
                self.unify_impl(v, existing, shapes)?;
                return Ok(());
            }
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
            for operand in operands.iter() {
                let resolved = self.get(operand);
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

        if self.occurs_check(&v, &ty) {
            let resolved_type = self.try_resolve_type(&v, &ty, &mut OfPhis::default());
            if let Some(resolved) = resolved_type {
                self.substitute(v_id, resolved);
                return Ok(());
            }
            return Err(CompilerDiagnostic {
                category: ErrorCategory::Invariant,
                reason: "cycle detected".to_string(),
                description: None,
                details: vec![],
                suggestions: None,
            });
        }

        self.substitute(v_id, ty);
        Ok(())
    }

    /// `done`: what this made of each phi. What phis share comes from `get`, so that no type variable in it is bound.
    fn try_resolve_type(
        &mut self,
        v: &Type,
        ty: &Type,
        done: &mut OfPhis<Arc<[Type]>>,
    ) -> Option<Type> {
        if !self.may_go_into(1) {
            return None;
        }
        match ty {
            Type::Phi { operands } => {
                if let Some((_, known)) = done.get(&operands.as_ptr()) {
                    let operands = Arc::clone(known);
                    return Some(Type::Phi { operands });
                }
                let mut new_operands = Vec::with_capacity(operands.len());
                for operand in operands.iter() {
                    if let Type::TypeVar { id } = operand {
                        if let Type::TypeVar { id: v_id } = v {
                            if id == v_id {
                                continue; // skip self-reference
                            }
                        }
                    }
                    let resolved = self.try_resolve_type(v, operand, done)?;
                    new_operands.push(resolved);
                }
                let is_as_it_was = new_operands.len() == operands.len()
                    && std::iter::zip(&new_operands, operands.iter())
                        .all(|(a, b)| is_the_same(a, b));
                let new_operands = if is_as_it_was {
                    Arc::clone(operands)
                } else {
                    new_operands.into()
                };
                done.insert(
                    operands.as_ptr(),
                    (Arc::clone(operands), Arc::clone(&new_operands)),
                );
                Some(Type::Phi {
                    operands: new_operands,
                })
            }
            Type::TypeVar { id } => {
                let substitution = self.get(ty);
                if !type_equals(&substitution, ty) {
                    let resolved = self.try_resolve_type(v, &substitution, done)?;
                    self.substitute(*id, resolved.clone());
                    Some(resolved)
                } else {
                    Some(ty.clone())
                }
            }
            Type::Property {
                object_type,
                object_name,
                property_name,
            } => {
                let resolved_obj = self.get(object_type);
                let object_type = self.try_resolve_type(v, &resolved_obj, done)?;
                Some(Type::Property {
                    object_type: Box::new(object_type),
                    object_name: *object_name,
                    property_name: property_name.clone(),
                })
            }
            Type::Function {
                shape_id,
                return_type,
                is_constructor,
            } => {
                let resolved_ret = self.get(return_type);
                let return_type = self.try_resolve_type(v, &resolved_ret, done)?;
                Some(Type::Function {
                    shape_id: *shape_id,
                    return_type: Box::new(return_type),
                    is_constructor: *is_constructor,
                })
            }
            Type::ObjectMethod | Type::Object { .. } | Type::Primitive | Type::Poly => {
                Some(ty.clone())
            }
        }
    }

    /// Whether the type variable `v` occurs in another type.
    fn occurs_check(&self, v: &Type, ty: &Type) -> bool {
        match ty {
            Type::Phi { operands } => {
                let seen = &mut FxHashSet::default();
                let may_go_on = self.may_go_into(operands.len());
                may_go_on && operands.iter().any(|o| self.occurs_in(v, o, seen))
            }
            Type::Function { .. } | Type::TypeVar { .. } => {
                self.occurs_in(v, ty, &mut FxHashSet::default())
            }
            _ => false,
        }
    }

    /// `seen`: the phis in which it does not occur, by the address of their operands.
    fn occurs_in(&self, v: &Type, ty: &Type, seen: &mut FxHashSet<*const Type>) -> bool {
        if type_equals(v, ty) {
            return true;
        }

        if let Type::TypeVar { id } = ty {
            if let Some(sub) = self.substitutions.get(id) {
                return self.may_go_into(1) && self.occurs_in(v, sub, seen);
            }
        }

        if let Type::Phi { operands } = ty {
            let may_go_on = seen.insert(operands.as_ptr()) && self.may_go_into(operands.len());
            return may_go_on && operands.iter().any(|o| self.occurs_in(v, o, seen));
        }

        if let Type::Function { return_type, .. } = ty {
            return self.may_go_into(1) && self.occurs_in(v, return_type, seen);
        }

        false
    }

    fn get<'a>(&'a self, mut ty: &'a Type) -> Type {
        while let Type::TypeVar { id } = ty
            && let Some(sub) = self.substitutions.get(id)
        {
            ty = sub;
        }
        match ty {
            Type::Phi { operands } => Type::Phi {
                operands: self
                    .get_operands_if_changed(operands)
                    .unwrap_or_else(|| Arc::clone(operands)),
            },
            Type::Function {
                is_constructor,
                shape_id,
                return_type,
            } if self.may_go_into(1) => Type::Function {
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
            Type::TypeVar { id } => self.substitutions.get(id).map(|sub| self.get(sub)),
            Type::Phi { operands } => self
                .get_operands_if_changed(operands)
                .map(|operands| Type::Phi { operands }),
            Type::Function {
                is_constructor,
                shape_id,
                return_type,
            } if self.may_go_into(1) => {
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

    fn get_operands_if_changed(&self, operands: &Arc<[Type]>) -> Option<Arc<[Type]>> {
        if let Some((_, known)) = self.resolved.borrow().get(&operands.as_ptr()) {
            return known.clone();
        }
        if !self.may_go_into(operands.len()) {
            return None;
        }
        let mut changed: Option<Vec<Type>> = None;
        let mut has_leaves_only = true;
        for (index, operand) in operands.iter().enumerate() {
            let ty = self.get_if_changed(operand);
            let is_leaf = !matches!(
                ty.as_ref().unwrap_or(operand),
                Type::Phi { .. } | Type::Function { .. }
            );
            has_leaves_only &= is_leaf;
            if ty.is_some() && changed.is_none() {
                let mut as_they_were = Vec::with_capacity(operands.len());
                as_they_were.extend_from_slice(&operands[..index]);
                changed = Some(as_they_were);
            }
            if let Some(changed) = &mut changed {
                changed.push(ty.unwrap_or_else(|| operand.clone()));
            }
        }
        let changed: Option<Arc<[Type]>> = changed.map(Arc::from);
        if has_leaves_only {
            // To go through it again costs no more than to look it up.
            return changed;
        }
        let mut resolved = self.resolved.borrow_mut();
        if let Some(changed) = &changed {
            resolved.insert(changed.as_ptr(), (Arc::clone(changed), None));
        }
        resolved.insert(operands.as_ptr(), (Arc::clone(operands), changed.clone()));
        changed
    }
}

/// The one is a copy of the other that shares what can be shared.
fn is_the_same(a: &Type, b: &Type) -> bool {
    match (a, b) {
        (Type::Phi { operands: a }, Type::Phi { operands: b }) => Arc::ptr_eq(a, b),
        (Type::Function { .. }, _) | (Type::Property { .. }, _) => false,
        _ => type_equals(a, b),
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
