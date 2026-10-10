// Not `crate::collections::IndexMap`: its arena keeps every buffer that a growing table outgrows.
use bun_collections::array_hash_map::ArrayHashMap;

use crate::collections::{FxHashMap, FxHashSet as HashSet, IdMap};

use crate::diagnostics::{
    CompilerDiagnostic, CompilerDiagnosticDetail, ErrorCategory, SourceLocation,
};
use crate::hir::environment::Environment;
use crate::hir::object_shape::HookKind;
use crate::hir::visitors::{
    each_instruction_value_operand as canonical_each_instruction_value_operand,
    each_pattern_operand, each_terminal_operand,
};
use crate::hir::{
    AliasingEffect, BlockId, HirFunction, Identifier, IdentifierId, InstructionValue, Place,
    PrimitiveValue, PropertyLiteral, Terminal, Type, UnaryOperator,
};

const ERROR_DESCRIPTION: &str = "React refs are values that are not needed for rendering. \
    Refs should only be accessed outside of render, such as in event handlers or effects. \
    Accessing a ref value (the `current` property) during render can cause your component \
    not to update as expected (https://react.dev/reference/react/useRef)";

// --- RefId ---

type RefId = u32;

static REF_ID_COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

fn next_ref_id() -> RefId {
    REF_ID_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

// --- RefAccessType / RefAccessRefType / RefFnType ---

/// Not in upstream, which nests these types by value and clones them in each join.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct RefAccessTypeId(u32);

/// Corresponds to TS `RefAccessType`. TS `tyEqual` is `RefAccessTypeInterner::ty_equal`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum RefAccessType {
    None,
    Nullable,
    Guard {
        ref_id: RefId,
    },
    Ref {
        ref_id: RefId,
    },
    RefValue {
        loc: Option<SourceLocation>,
        ref_id: Option<RefId>,
    },
    Structure {
        /// A `Ref`, a `RefValue` or a `Structure`: TS `RefAccessRefType`.
        value: Option<RefAccessTypeId>,
        fn_type: Option<RefFnType>,
    },
}

/// Corresponds to TS `RefAccessRefType` — the subset of `RefAccessType` that can appear
/// inside `Structure.value` and be joined via `join_ref_access_ref_types`.
#[derive(Debug, Clone)]
enum RefAccessRefType {
    Ref {
        ref_id: RefId,
    },
    RefValue {
        loc: Option<SourceLocation>,
        ref_id: Option<RefId>,
    },
    Structure {
        value: Option<RefAccessTypeId>,
        fn_type: Option<RefFnType>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct RefFnType {
    read_ref_effect: bool,
    return_type: RefAccessTypeId,
}

impl RefAccessType {
    /// Try to convert a `RefAccessType` to a `RefAccessRefType` (the Ref/RefValue/Structure subset).
    fn to_ref_type(&self) -> Option<RefAccessRefType> {
        match self {
            RefAccessType::Ref { ref_id } => Some(RefAccessRefType::Ref { ref_id: *ref_id }),
            RefAccessType::RefValue { loc, ref_id } => Some(RefAccessRefType::RefValue {
                loc: *loc,
                ref_id: *ref_id,
            }),
            RefAccessType::Structure { value, fn_type } => Some(RefAccessRefType::Structure {
                value: value.clone(),
                fn_type: fn_type.clone(),
            }),
            _ => None,
        }
    }

    /// Convert a `RefAccessRefType` back to a `RefAccessType`.
    fn from_ref_type(ref_type: &RefAccessRefType) -> Self {
        match ref_type {
            RefAccessRefType::Ref { ref_id } => RefAccessType::Ref { ref_id: *ref_id },
            RefAccessRefType::RefValue { loc, ref_id } => RefAccessType::RefValue {
                loc: *loc,
                ref_id: *ref_id,
            },
            RefAccessRefType::Structure { value, fn_type } => RefAccessType::Structure {
                value: value.clone(),
                fn_type: fn_type.clone(),
            },
        }
    }
}

/// Not in upstream: the nested types, one entry per distinct type.
#[derive(Default)]
struct RefAccessTypeInterner {
    /// The index of a type is its id. Its value is the first entry that is `ty_equal` to it.
    types: ArrayHashMap<RefAccessType, RefAccessTypeId>,
    /// The first entry for each `ty_equal_key`.
    ty_equal_first: FxHashMap<RefAccessType, RefAccessTypeId>,
    /// The joins that made no ref id. Such a join gives the same type each time.
    joins: FxHashMap<(RefAccessTypeId, RefAccessTypeId), RefAccessTypeId>,
    /// How many ref ids the joins made.
    ref_ids_made: u32,
}

impl RefAccessTypeInterner {
    fn get(&self, id: RefAccessTypeId) -> RefAccessType {
        self.types.keys()[id.0 as usize]
    }

    fn intern(&mut self, ty: RefAccessType) -> RefAccessTypeId {
        if let Some(index) = self.types.get_index(&ty) {
            return RefAccessTypeId(index as u32);
        }
        let id = RefAccessTypeId(self.types.len() as u32);
        let key = self.ty_equal_key(&ty);
        let ty_equal_id = *self.ty_equal_first.entry(key).or_insert(id);
        self.types.insert(ty, ty_equal_id);
        id
    }

    /// `ty` without what TS `tyEqual` ignores, nested types as their first `ty_equal` entry.
    fn ty_equal_key(&self, ty: &RefAccessType) -> RefAccessType {
        let ty_equal_ids = self.types.values();
        match *ty {
            RefAccessType::Ref { .. } => RefAccessType::Ref { ref_id: 0 },
            RefAccessType::RefValue { loc, .. } => RefAccessType::RefValue { loc, ref_id: None },
            RefAccessType::Structure { value, fn_type } => RefAccessType::Structure {
                value: value.map(|value| ty_equal_ids[value.0 as usize]),
                fn_type: fn_type.map(|fn_type| RefFnType {
                    read_ref_effect: fn_type.read_ref_effect,
                    return_type: ty_equal_ids[fn_type.return_type.0 as usize],
                }),
            },
            other => other,
        }
    }

    /// TS `tyEqual`: a join makes new ref ids, so the id of a Ref or a RefValue does not count.
    fn ty_equal(&self, a: &RefAccessType, b: &RefAccessType) -> bool {
        self.ty_equal_key(a) == self.ty_equal_key(b)
    }

    /// Not in upstream: a join makes its ref ids here, so that `join` does not reuse it.
    fn next_ref_id(&mut self) -> RefId {
        self.ref_ids_made += 1;
        next_ref_id()
    }

    /// Joins two nested types. On two `Structure.value`s this is `join_ref_access_ref_types`.
    fn join(&mut self, a: RefAccessTypeId, b: RefAccessTypeId) -> RefAccessTypeId {
        // A type joined with itself is itself, ref ids included.
        if a == b {
            return a;
        }
        if let Some(&joined) = self.joins.get(&(a, b)) {
            return joined;
        }
        let ref_ids_made = self.ref_ids_made;
        let (a_type, b_type) = (self.get(a), self.get(b));
        let joined = join_ref_access_types(self, &a_type, &b_type);
        let joined = self.intern(joined);
        if self.ref_ids_made == ref_ids_made {
            self.joins.insert((a, b), joined);
        }
        joined
    }
}

// --- Join operations ---

fn join_ref_access_ref_types(
    interner: &mut RefAccessTypeInterner,
    a: &RefAccessRefType,
    b: &RefAccessRefType,
) -> RefAccessRefType {
    match (a, b) {
        (
            RefAccessRefType::RefValue { ref_id: a_id, .. },
            RefAccessRefType::RefValue { ref_id: b_id, .. },
        ) => {
            if a_id == b_id {
                a.clone()
            } else {
                RefAccessRefType::RefValue {
                    loc: None,
                    ref_id: None,
                }
            }
        }
        (RefAccessRefType::RefValue { .. }, _) => RefAccessRefType::RefValue {
            loc: None,
            ref_id: None,
        },
        (_, RefAccessRefType::RefValue { .. }) => RefAccessRefType::RefValue {
            loc: None,
            ref_id: None,
        },
        (RefAccessRefType::Ref { ref_id: a_id }, RefAccessRefType::Ref { ref_id: b_id }) => {
            if a_id == b_id {
                a.clone()
            } else {
                RefAccessRefType::Ref {
                    ref_id: interner.next_ref_id(),
                }
            }
        }
        (RefAccessRefType::Ref { .. }, _) | (_, RefAccessRefType::Ref { .. }) => {
            RefAccessRefType::Ref {
                ref_id: interner.next_ref_id(),
            }
        }
        (
            RefAccessRefType::Structure {
                value: a_value,
                fn_type: a_fn,
            },
            RefAccessRefType::Structure {
                value: b_value,
                fn_type: b_fn,
            },
        ) => {
            let fn_type = match (a_fn, b_fn) {
                (None, other) | (other, None) => other.clone(),
                (Some(a_fn), Some(b_fn)) => Some(RefFnType {
                    read_ref_effect: a_fn.read_ref_effect || b_fn.read_ref_effect,
                    return_type: interner.join(a_fn.return_type, b_fn.return_type),
                }),
            };
            let value = match (a_value, b_value) {
                (None, other) | (other, None) => other.clone(),
                (Some(a_val), Some(b_val)) => Some(interner.join(*a_val, *b_val)),
            };
            RefAccessRefType::Structure { value, fn_type }
        }
    }
}

fn join_ref_access_types(
    interner: &mut RefAccessTypeInterner,
    a: &RefAccessType,
    b: &RefAccessType,
) -> RefAccessType {
    match (a, b) {
        (RefAccessType::None, other) | (other, RefAccessType::None) => other.clone(),
        (RefAccessType::Guard { ref_id: a_id }, RefAccessType::Guard { ref_id: b_id }) => {
            if a_id == b_id {
                a.clone()
            } else {
                RefAccessType::None
            }
        }
        (RefAccessType::Guard { .. }, RefAccessType::Nullable)
        | (RefAccessType::Nullable, RefAccessType::Guard { .. }) => RefAccessType::None,
        (RefAccessType::Guard { .. }, other) | (other, RefAccessType::Guard { .. }) => {
            other.clone()
        }
        (RefAccessType::Nullable, other) | (other, RefAccessType::Nullable) => other.clone(),
        _ => match (a.to_ref_type(), b.to_ref_type()) {
            (Some(a_ref), Some(b_ref)) => {
                RefAccessType::from_ref_type(&join_ref_access_ref_types(interner, &a_ref, &b_ref))
            }
            (Some(r), None) | (None, Some(r)) => RefAccessType::from_ref_type(&r),
            _ => RefAccessType::None,
        },
    }
}

fn join_ref_access_types_many(
    interner: &mut RefAccessTypeInterner,
    types: &[RefAccessType],
) -> RefAccessType {
    types.iter().fold(RefAccessType::None, |acc, t| {
        join_ref_access_types(interner, &acc, t)
    })
}

// --- Env ---

struct Env {
    changed: bool,
    data: IdMap<IdentifierId, RefAccessType>,
    temporaries: IdMap<IdentifierId, Place>,
    interner: RefAccessTypeInterner,
}

impl Env {
    fn new() -> Self {
        Self {
            changed: false,
            data: IdMap::default(),
            temporaries: IdMap::default(),
            interner: RefAccessTypeInterner::default(),
        }
    }

    fn define(&mut self, key: IdentifierId, value: Place) {
        self.temporaries.insert(key, value);
    }

    fn reset_changed(&mut self) {
        self.changed = false;
    }

    fn has_changed(&self) -> bool {
        self.changed
    }

    fn get(&self, key: IdentifierId) -> Option<&RefAccessType> {
        let operand_id = self
            .temporaries
            .get(key)
            .map(|p| p.identifier)
            .unwrap_or(key);
        self.data.get(operand_id)
    }

    fn set(&mut self, key: IdentifierId, value: RefAccessType) {
        let operand_id = self
            .temporaries
            .get(key)
            .map(|p| p.identifier)
            .unwrap_or(key);
        let current = self.data.get(operand_id);
        let widened_value = join_ref_access_types(
            &mut self.interner,
            &value,
            current.unwrap_or(&RefAccessType::None),
        );
        if current.is_none() && widened_value == RefAccessType::None {
            // No change needed
        } else if current.map_or(true, |c| !self.interner.ty_equal(c, &widened_value)) {
            self.changed = true;
        }
        self.data.insert(operand_id, widened_value);
    }
}

// --- Helper functions ---

fn ref_type_of_type(id: IdentifierId, identifiers: &[Identifier], types: &[Type]) -> RefAccessType {
    let identifier = &identifiers[id.0 as usize];
    let ty = &types[identifier.type_.0 as usize];
    if crate::hir::is_ref_value_type(ty) {
        RefAccessType::RefValue {
            loc: None,
            ref_id: None,
        }
    } else if crate::hir::is_use_ref_type(ty) {
        RefAccessType::Ref {
            ref_id: next_ref_id(),
        }
    } else {
        RefAccessType::None
    }
}

fn is_ref_type(id: IdentifierId, identifiers: &[Identifier], types: &[Type]) -> bool {
    let identifier = &identifiers[id.0 as usize];
    crate::hir::is_use_ref_type(&types[identifier.type_.0 as usize])
}

fn is_ref_value_type(id: IdentifierId, identifiers: &[Identifier], types: &[Type]) -> bool {
    let identifier = &identifiers[id.0 as usize];
    crate::hir::is_ref_value_type(&types[identifier.type_.0 as usize])
}

fn destructure(interner: &RefAccessTypeInterner, ty: &RefAccessType) -> RefAccessType {
    match ty {
        RefAccessType::Structure {
            value: Some(inner), ..
        } => destructure(interner, &interner.get(*inner)),
        other => other.clone(),
    }
}

// --- Validation helpers ---

#[cold]
#[inline(never)]
fn ref_access_error(loc: Option<SourceLocation>, message: &'static str) -> CompilerDiagnostic {
    CompilerDiagnostic::new(
        ErrorCategory::Refs,
        "Cannot access refs during render",
        Some(ERROR_DESCRIPTION.to_string()),
    )
    .with_detail(CompilerDiagnosticDetail::Error {
        loc,
        message: Some(message.to_string()),
        identifier_name: None,
    })
}

#[cold]
#[inline(never)]
fn ref_access_error_with_init_hint(loc: Option<SourceLocation>) -> CompilerDiagnostic {
    ref_access_error(loc, "Cannot access ref value during render").with_detail(
        CompilerDiagnosticDetail::Hint {
            message: "To initialize a ref only once, check that the ref is null with the pattern `if (ref.current == null) { ref.current = ... }`".to_string(),
        },
    )
}

fn validate_no_direct_ref_value_access(
    errors: &mut Vec<CompilerDiagnostic>,
    operand: &Place,
    env: &Env,
) {
    if let Some(ty) = env.get(operand.identifier) {
        let ty = destructure(&env.interner, ty);
        if let RefAccessType::RefValue { loc, .. } = &ty {
            errors.push(ref_access_error(
                loc.or(operand.loc),
                "Cannot access ref value during render",
            ));
        }
    }
}

fn validate_no_ref_value_access(errors: &mut Vec<CompilerDiagnostic>, env: &Env, operand: &Place) {
    if let Some(ty) = env.get(operand.identifier) {
        let ty = destructure(&env.interner, ty);
        match &ty {
            RefAccessType::RefValue { loc, .. } => {
                errors.push(ref_access_error(
                    loc.or(operand.loc),
                    "Cannot access ref value during render",
                ));
            }
            RefAccessType::Structure {
                fn_type: Some(fn_type),
                ..
            } if fn_type.read_ref_effect => {
                errors.push(ref_access_error(
                    operand.loc,
                    "Cannot access ref value during render",
                ));
            }
            _ => {}
        }
    }
}

fn validate_no_ref_passed_to_function(
    errors: &mut Vec<CompilerDiagnostic>,
    env: &Env,
    operand: &Place,
    loc: Option<SourceLocation>,
) {
    if let Some(ty) = env.get(operand.identifier) {
        let ty = destructure(&env.interner, ty);
        match &ty {
            RefAccessType::Ref { .. } | RefAccessType::RefValue { .. } => {
                let error_loc = if let RefAccessType::RefValue { loc: ref_loc, .. } = &ty {
                    ref_loc.or(loc)
                } else {
                    loc
                };
                errors.push(ref_access_error(
                    error_loc,
                    "Passing a ref to a function may read its value during render",
                ));
            }
            RefAccessType::Structure {
                fn_type: Some(fn_type),
                ..
            } if fn_type.read_ref_effect => {
                errors.push(ref_access_error(
                    loc,
                    "Passing a ref to a function may read its value during render",
                ));
            }
            _ => {}
        }
    }
}

fn validate_no_ref_update(
    errors: &mut Vec<CompilerDiagnostic>,
    env: &Env,
    operand: &Place,
    loc: Option<SourceLocation>,
) {
    if let Some(ty) = env.get(operand.identifier) {
        let ty = destructure(&env.interner, ty);
        match &ty {
            RefAccessType::Ref { .. } | RefAccessType::RefValue { .. } => {
                let error_loc = if let RefAccessType::RefValue { loc: ref_loc, .. } = &ty {
                    ref_loc.or(loc)
                } else {
                    loc
                };
                errors.push(ref_access_error(
                    error_loc,
                    "Cannot update ref during render",
                ));
            }
            _ => {}
        }
    }
}

fn guard_check(errors: &mut Vec<CompilerDiagnostic>, operand: &Place, env: &Env) {
    if matches!(
        env.get(operand.identifier),
        Some(RefAccessType::Guard { .. })
    ) {
        errors.push(ref_access_error(
            operand.loc,
            "Cannot access ref value during render",
        ));
    }
}

// --- Main entry point ---

pub(crate) fn validate_no_ref_access_in_render(func: &HirFunction, env: &mut Environment) {
    let mut ref_env = Env::new();
    collect_temporaries_sidemap(
        func,
        &mut ref_env,
        &env.identifiers,
        &env.types,
        &env.functions,
    );
    let mut errors: Vec<CompilerDiagnostic> = Vec::new();
    validate_no_ref_access_in_render_impl(
        func,
        &env.identifiers,
        &env.types,
        &env.functions,
        &*env,
        &mut ref_env,
        &mut errors,
    );
    for diagnostic in errors {
        env.record_diagnostic(diagnostic);
    }
}

fn collect_temporaries_sidemap(
    func: &HirFunction,
    env: &mut Env,
    identifiers: &[Identifier],
    types: &[Type],
    functions: &[HirFunction],
) {
    for (_, block) in &func.body.blocks {
        for &instr_id in &block.instructions {
            let instr = &func.instructions[instr_id.0 as usize];
            match &instr.value {
                InstructionValue::ObjectMethod { lowered_func, .. }
                | InstructionValue::FunctionExpression { lowered_func, .. } => {
                    let inner = &functions[lowered_func.func.0 as usize];
                    collect_temporaries_sidemap(inner, env, identifiers, types, functions);
                }
                InstructionValue::LoadLocal { place, .. } => {
                    let temp = env
                        .temporaries
                        .get(place.identifier)
                        .cloned()
                        .unwrap_or_else(|| place.clone());
                    env.define(instr.lvalue.identifier, temp);
                }
                InstructionValue::StoreLocal { lvalue, value, .. } => {
                    let temp = env
                        .temporaries
                        .get(value.identifier)
                        .cloned()
                        .unwrap_or_else(|| value.clone());
                    env.define(instr.lvalue.identifier, temp.clone());
                    env.define(lvalue.place.identifier, temp);
                }
                InstructionValue::PropertyLoad {
                    object, property, ..
                } => {
                    if is_ref_type(object.identifier, identifiers, types)
                        && matches!(property, PropertyLiteral::String(s) if s == b"current")
                    {
                        continue;
                    }
                    let temp = env
                        .temporaries
                        .get(object.identifier)
                        .cloned()
                        .unwrap_or_else(|| object.clone());
                    env.define(instr.lvalue.identifier, temp);
                }
                _ => {}
            }
        }
    }
}

fn validate_no_ref_access_in_render_impl(
    func: &HirFunction,
    identifiers: &[Identifier],
    types: &[Type],
    functions: &[HirFunction],
    env: &Environment,
    ref_env: &mut Env,
    errors: &mut Vec<CompilerDiagnostic>,
) -> RefAccessType {
    let mut return_values: Vec<RefAccessType> = Vec::new();

    // Process params
    for param in &func.params {
        let place = param.place();
        ref_env.set(
            place.identifier,
            ref_type_of_type(place.identifier, identifiers, types),
        );
    }
    // Seed captured context places so refs captured from an enclosing scope are
    // recognized as Ref/RefValue inside the lambda body. Callbacks passed to
    // useState/useReducer (and IIFEs) execute during render, so a captured ref
    // read must be detected here for `read_ref_effect` to propagate.
    for place in &func.context {
        ref_env.set(
            place.identifier,
            ref_type_of_type(place.identifier, identifiers, types),
        );
    }

    // Collect identifiers that are interpolated as JSX children
    let mut interpolated_as_jsx: HashSet<IdentifierId> = HashSet::default();
    for (_, block) in &func.body.blocks {
        for &instr_id in &block.instructions {
            let instr = &func.instructions[instr_id.0 as usize];
            match &instr.value {
                InstructionValue::JsxExpression {
                    children: Some(children),
                    ..
                } => {
                    for child in children {
                        interpolated_as_jsx.insert(child.identifier);
                    }
                }
                InstructionValue::JsxFragment { children, .. } => {
                    for child in children {
                        interpolated_as_jsx.insert(child.identifier);
                    }
                }
                _ => {}
            }
        }
    }

    // Fixed-point iteration (up to 10 iterations)
    for iteration in 0..10 {
        if iteration > 0 && !ref_env.has_changed() {
            break;
        }
        ref_env.reset_changed();
        return_values.clear();
        let mut safe_blocks: Vec<(BlockId, RefId)> = Vec::new();

        for (_, block) in &func.body.blocks {
            safe_blocks.retain(|(block_id, _)| *block_id != block.id);

            // Process phis
            for phi in &block.phis {
                let phi_types: Vec<RefAccessType> = phi
                    .operands
                    .values()
                    .map(|operand| {
                        ref_env
                            .get(operand.identifier)
                            .cloned()
                            .unwrap_or(RefAccessType::None)
                    })
                    .collect();
                let phi_type = join_ref_access_types_many(&mut ref_env.interner, &phi_types);
                ref_env.set(phi.place.identifier, phi_type);
            }

            // Process instructions
            for &instr_id in &block.instructions {
                let instr = &func.instructions[instr_id.0 as usize];
                match &instr.value {
                    InstructionValue::JsxExpression { .. }
                    | InstructionValue::JsxFragment { .. } => {
                        for operand in &canonical_each_instruction_value_operand(&instr.value, env)
                        {
                            validate_no_direct_ref_value_access(errors, operand, ref_env);
                        }
                    }
                    InstructionValue::ComputedLoad {
                        object, property, ..
                    } => {
                        validate_no_direct_ref_value_access(errors, property, ref_env);
                        let obj_type = ref_env.get(object.identifier).cloned();
                        let lookup_type = match &obj_type {
                            Some(RefAccessType::Structure {
                                value: Some(value), ..
                            }) => Some(ref_env.interner.get(*value)),
                            Some(RefAccessType::Ref { ref_id }) => Some(RefAccessType::RefValue {
                                loc: instr.loc,
                                ref_id: Some(*ref_id),
                            }),
                            _ => None,
                        };
                        ref_env.set(
                            instr.lvalue.identifier,
                            lookup_type.unwrap_or_else(|| {
                                ref_type_of_type(instr.lvalue.identifier, identifiers, types)
                            }),
                        );
                    }
                    InstructionValue::PropertyLoad { object, .. } => {
                        let obj_type = ref_env.get(object.identifier).cloned();
                        let lookup_type = match &obj_type {
                            Some(RefAccessType::Structure {
                                value: Some(value), ..
                            }) => Some(ref_env.interner.get(*value)),
                            Some(RefAccessType::Ref { ref_id }) => Some(RefAccessType::RefValue {
                                loc: instr.loc,
                                ref_id: Some(*ref_id),
                            }),
                            _ => None,
                        };
                        ref_env.set(
                            instr.lvalue.identifier,
                            lookup_type.unwrap_or_else(|| {
                                ref_type_of_type(instr.lvalue.identifier, identifiers, types)
                            }),
                        );
                    }
                    InstructionValue::TypeCastExpression { value, .. } => {
                        ref_env.set(
                            instr.lvalue.identifier,
                            ref_env.get(value.identifier).cloned().unwrap_or_else(|| {
                                ref_type_of_type(instr.lvalue.identifier, identifiers, types)
                            }),
                        );
                    }
                    InstructionValue::LoadContext { place, .. }
                    | InstructionValue::LoadLocal { place, .. } => {
                        ref_env.set(
                            instr.lvalue.identifier,
                            ref_env.get(place.identifier).cloned().unwrap_or_else(|| {
                                ref_type_of_type(instr.lvalue.identifier, identifiers, types)
                            }),
                        );
                    }
                    InstructionValue::StoreContext { lvalue, value, .. }
                    | InstructionValue::StoreLocal { lvalue, value, .. } => {
                        ref_env.set(
                            lvalue.place.identifier,
                            ref_env.get(value.identifier).cloned().unwrap_or_else(|| {
                                ref_type_of_type(lvalue.place.identifier, identifiers, types)
                            }),
                        );
                        ref_env.set(
                            instr.lvalue.identifier,
                            ref_env.get(value.identifier).cloned().unwrap_or_else(|| {
                                ref_type_of_type(instr.lvalue.identifier, identifiers, types)
                            }),
                        );
                    }
                    InstructionValue::Destructure { value, lvalue, .. } => {
                        let obj_type = ref_env.get(value.identifier).cloned();
                        let lookup_type = match &obj_type {
                            Some(RefAccessType::Structure {
                                value: Some(value), ..
                            }) => Some(ref_env.interner.get(*value)),
                            _ => None,
                        };
                        ref_env.set(
                            instr.lvalue.identifier,
                            lookup_type.clone().unwrap_or_else(|| {
                                ref_type_of_type(instr.lvalue.identifier, identifiers, types)
                            }),
                        );
                        for pattern_place in each_pattern_operand(&lvalue.pattern) {
                            ref_env.set(
                                pattern_place.identifier,
                                lookup_type.clone().unwrap_or_else(|| {
                                    ref_type_of_type(pattern_place.identifier, identifiers, types)
                                }),
                            );
                        }
                    }
                    InstructionValue::ObjectMethod { lowered_func, .. }
                    | InstructionValue::FunctionExpression { lowered_func, .. } => {
                        let inner = &functions[lowered_func.func.0 as usize];
                        let mut inner_errors: Vec<CompilerDiagnostic> = Vec::new();
                        let result = validate_no_ref_access_in_render_impl(
                            inner,
                            identifiers,
                            types,
                            functions,
                            env,
                            ref_env,
                            &mut inner_errors,
                        );
                        let (return_type, read_ref_effect) = if inner_errors.is_empty() {
                            (result, false)
                        } else {
                            (RefAccessType::None, true)
                        };
                        let return_type = ref_env.interner.intern(return_type);
                        ref_env.set(
                            instr.lvalue.identifier,
                            RefAccessType::Structure {
                                value: None,
                                fn_type: Some(RefFnType {
                                    read_ref_effect,
                                    return_type,
                                }),
                            },
                        );
                    }
                    InstructionValue::MethodCall { property, .. }
                    | InstructionValue::CallExpression {
                        callee: property, ..
                    } => {
                        let callee = property;
                        let mut return_type = RefAccessType::None;
                        let fn_type = ref_env.get(callee.identifier).cloned();
                        let mut did_error = false;

                        if let Some(RefAccessType::Structure {
                            fn_type: Some(fn_ty),
                            ..
                        }) = &fn_type
                        {
                            return_type = ref_env.interner.get(fn_ty.return_type);
                            if fn_ty.read_ref_effect {
                                did_error = true;
                                errors.push(ref_access_error(
                                    callee.loc,
                                    "This function accesses a ref value",
                                ));
                            }
                        }

                        /*
                         * If we already reported an error on this instruction, don't report
                         * duplicate errors
                         */
                        if !did_error {
                            let is_ref_lvalue =
                                is_ref_type(instr.lvalue.identifier, identifiers, types);
                            let callee_identifier = &identifiers[callee.identifier.0 as usize];
                            let callee_type = &types[callee_identifier.type_.0 as usize];
                            let hook_kind = env.get_hook_kind_for_type(callee_type).ok().flatten();

                            if is_ref_lvalue
                                || (hook_kind.is_some()
                                    && !matches!(hook_kind, Some(&HookKind::UseState))
                                    && !matches!(hook_kind, Some(&HookKind::UseReducer)))
                            {
                                /*
                                 * Allow passing refs or ref-accessing functions when:
                                 * 1. lvalue is a ref (mergeRefs pattern)
                                 * 2. calling hooks (independently validated)
                                 */
                                for operand in
                                    &canonical_each_instruction_value_operand(&instr.value, env)
                                {
                                    validate_no_direct_ref_value_access(errors, operand, ref_env);
                                }
                            } else if interpolated_as_jsx.contains(&instr.lvalue.identifier) {
                                for operand in
                                    &canonical_each_instruction_value_operand(&instr.value, env)
                                {
                                    validate_no_ref_value_access(errors, ref_env, operand);
                                }
                            } else if hook_kind.is_none() && instr.effects.is_some() {
                                let mut visited_effects: HashSet<(IdentifierId, bool)> =
                                    HashSet::default();
                                for effect in instr.effects.as_ref().unwrap() {
                                    let (place, ref_passed): (&Place, bool) = match effect {
                                        AliasingEffect::Freeze { value, .. } => (value, false),
                                        AliasingEffect::Mutate { value, .. }
                                        | AliasingEffect::MutateTransitive { value }
                                        | AliasingEffect::MutateConditionally { value }
                                        | AliasingEffect::MutateTransitiveConditionally { value } => {
                                            (value, true)
                                        }
                                        AliasingEffect::Render { place } => (place, true),
                                        AliasingEffect::Capture { from, .. }
                                        | AliasingEffect::Alias { from, .. }
                                        | AliasingEffect::MaybeAlias { from, .. }
                                        | AliasingEffect::Assign { from, .. }
                                        | AliasingEffect::CreateFrom { from, .. } => (from, true),
                                        AliasingEffect::ImmutableCapture { from, .. } => {
                                            let is_frozen =
                                                instr.effects.as_ref().unwrap().iter().any(|e| {
                                                    matches!(
                                                        e,
                                                        AliasingEffect::Freeze { value, .. }
                                                            if value.identifier == from.identifier
                                                    )
                                                });
                                            (from, !is_frozen)
                                        }
                                        AliasingEffect::Create { .. }
                                        | AliasingEffect::CreateFunction { .. }
                                        | AliasingEffect::Apply { .. }
                                        | AliasingEffect::Impure { .. }
                                        | AliasingEffect::MutateFrozen { .. }
                                        | AliasingEffect::MutateGlobal { .. } => continue,
                                    };
                                    if visited_effects.insert((place.identifier, ref_passed)) {
                                        if ref_passed {
                                            validate_no_ref_passed_to_function(
                                                errors, ref_env, place, place.loc,
                                            );
                                        } else {
                                            validate_no_direct_ref_value_access(
                                                errors, place, ref_env,
                                            );
                                        }
                                    }
                                }
                            } else {
                                for operand in
                                    &canonical_each_instruction_value_operand(&instr.value, env)
                                {
                                    validate_no_ref_passed_to_function(
                                        errors,
                                        ref_env,
                                        operand,
                                        operand.loc,
                                    );
                                }
                            }
                        }
                        ref_env.set(instr.lvalue.identifier, return_type);
                    }
                    InstructionValue::ObjectExpression { .. }
                    | InstructionValue::ArrayExpression { .. } => {
                        let operands = canonical_each_instruction_value_operand(&instr.value, env);
                        let mut types_vec: Vec<RefAccessType> = Vec::new();
                        for operand in &operands {
                            validate_no_direct_ref_value_access(errors, operand, ref_env);
                            types_vec.push(
                                ref_env
                                    .get(operand.identifier)
                                    .cloned()
                                    .unwrap_or(RefAccessType::None),
                            );
                        }
                        let value = join_ref_access_types_many(&mut ref_env.interner, &types_vec);
                        match &value {
                            RefAccessType::None
                            | RefAccessType::Guard { .. }
                            | RefAccessType::Nullable => {
                                ref_env.set(instr.lvalue.identifier, RefAccessType::None);
                            }
                            _ => {
                                let value = ref_env.interner.intern(value);
                                ref_env.set(
                                    instr.lvalue.identifier,
                                    RefAccessType::Structure {
                                        value: Some(value),
                                        fn_type: None,
                                    },
                                );
                            }
                        }
                    }
                    InstructionValue::PropertyDelete { object, .. }
                    | InstructionValue::PropertyStore { object, .. }
                    | InstructionValue::ComputedDelete { object, .. }
                    | InstructionValue::ComputedStore { object, .. } => {
                        let target = ref_env.get(object.identifier).cloned();
                        let mut found_safe = false;
                        if matches!(&instr.value, InstructionValue::PropertyStore { .. }) {
                            if let Some(RefAccessType::Ref { ref_id }) = &target {
                                if let Some(pos) = safe_blocks.iter().position(|(_, r)| r == ref_id)
                                {
                                    safe_blocks.remove(pos);
                                    found_safe = true;
                                }
                            }
                        }
                        if !found_safe {
                            validate_no_ref_update(errors, ref_env, object, instr.loc);
                        }
                        match &instr.value {
                            InstructionValue::ComputedDelete { property, .. }
                            | InstructionValue::ComputedStore { property, .. } => {
                                validate_no_ref_value_access(errors, ref_env, property);
                            }
                            _ => {}
                        }
                        match &instr.value {
                            InstructionValue::ComputedStore { value, .. }
                            | InstructionValue::PropertyStore { value, .. } => {
                                validate_no_direct_ref_value_access(errors, value, ref_env);
                                let value_type = ref_env.get(value.identifier).cloned();
                                if let Some(RefAccessType::Structure { .. }) = &value_type {
                                    let mut object_type = value_type.unwrap();
                                    if let Some(t) = &target {
                                        object_type = join_ref_access_types(
                                            &mut ref_env.interner,
                                            &object_type,
                                            t,
                                        );
                                    }
                                    ref_env.set(object.identifier, object_type);
                                }
                            }
                            _ => {}
                        }
                    }
                    InstructionValue::StartMemoize { .. }
                    | InstructionValue::FinishMemoize { .. } => {}
                    InstructionValue::LoadGlobal { binding, .. } => {
                        if binding.name() == b"undefined" {
                            ref_env.set(instr.lvalue.identifier, RefAccessType::Nullable);
                        }
                    }
                    InstructionValue::Primitive { value, .. } => {
                        if matches!(value, PrimitiveValue::Null | PrimitiveValue::Undefined) {
                            ref_env.set(instr.lvalue.identifier, RefAccessType::Nullable);
                        }
                    }
                    InstructionValue::UnaryExpression {
                        operator, value, ..
                    } => {
                        if *operator == UnaryOperator::Not {
                            if let Some(RefAccessType::RefValue {
                                ref_id: Some(ref_id),
                                ..
                            }) = ref_env.get(value.identifier).cloned().as_ref()
                            {
                                /*
                                 * Record an error suggesting the `if (ref.current == null)` pattern,
                                 * but also record the lvalue as a guard so that we don't emit a
                                 * second error for the write to the ref
                                 */
                                ref_env.set(
                                    instr.lvalue.identifier,
                                    RefAccessType::Guard { ref_id: *ref_id },
                                );
                                errors.push(ref_access_error_with_init_hint(value.loc));
                            } else {
                                validate_no_ref_value_access(errors, ref_env, value);
                            }
                        } else {
                            validate_no_ref_value_access(errors, ref_env, value);
                        }
                    }
                    InstructionValue::BinaryExpression { left, right, .. } => {
                        let left_type = ref_env.get(left.identifier).cloned();
                        let right_type = ref_env.get(right.identifier).cloned();
                        let mut nullish = false;
                        let mut found_ref_id: Option<RefId> = None;

                        if let Some(RefAccessType::RefValue {
                            ref_id: Some(id), ..
                        }) = &left_type
                        {
                            found_ref_id = Some(*id);
                        } else if let Some(RefAccessType::RefValue {
                            ref_id: Some(id), ..
                        }) = &right_type
                        {
                            found_ref_id = Some(*id);
                        }

                        if matches!(&left_type, Some(RefAccessType::Nullable)) {
                            nullish = true;
                        } else if matches!(&right_type, Some(RefAccessType::Nullable)) {
                            nullish = true;
                        }

                        if let Some(ref_id) = found_ref_id {
                            if nullish {
                                ref_env
                                    .set(instr.lvalue.identifier, RefAccessType::Guard { ref_id });
                            } else {
                                validate_no_ref_value_access(errors, ref_env, left);
                                validate_no_ref_value_access(errors, ref_env, right);
                            }
                        } else {
                            validate_no_ref_value_access(errors, ref_env, left);
                            validate_no_ref_value_access(errors, ref_env, right);
                        }
                    }
                    _ => {
                        for operand in &canonical_each_instruction_value_operand(&instr.value, env)
                        {
                            validate_no_ref_value_access(errors, ref_env, operand);
                        }
                    }
                }

                // Guard values are derived from ref.current, so they can only be used
                // in if statement targets
                for operand in &canonical_each_instruction_value_operand(&instr.value, env) {
                    guard_check(errors, operand, ref_env);
                }

                if is_ref_type(instr.lvalue.identifier, identifiers, types)
                    && !matches!(
                        ref_env.get(instr.lvalue.identifier),
                        Some(RefAccessType::Ref { .. })
                    )
                {
                    let existing = ref_env
                        .get(instr.lvalue.identifier)
                        .cloned()
                        .unwrap_or(RefAccessType::None);
                    let joined = join_ref_access_types(
                        &mut ref_env.interner,
                        &existing,
                        &RefAccessType::Ref {
                            ref_id: next_ref_id(),
                        },
                    );
                    ref_env.set(instr.lvalue.identifier, joined);
                }
                if is_ref_value_type(instr.lvalue.identifier, identifiers, types)
                    && !matches!(
                        ref_env.get(instr.lvalue.identifier),
                        Some(RefAccessType::RefValue { .. })
                    )
                {
                    let existing = ref_env
                        .get(instr.lvalue.identifier)
                        .cloned()
                        .unwrap_or(RefAccessType::None);
                    let joined = join_ref_access_types(
                        &mut ref_env.interner,
                        &existing,
                        &RefAccessType::RefValue {
                            loc: instr.loc,
                            ref_id: None,
                        },
                    );
                    ref_env.set(instr.lvalue.identifier, joined);
                }
            }

            // Check if terminal is an `if` — push safe block for guard
            if let Terminal::If {
                test, fallthrough, ..
            } = &block.terminal
            {
                if let Some(RefAccessType::Guard { ref_id }) = ref_env.get(test.identifier) {
                    if !safe_blocks.iter().any(|(_, r)| r == ref_id) {
                        safe_blocks.push((*fallthrough, *ref_id));
                    }
                }
            }

            // Process terminal operands
            for operand in &each_terminal_operand(&block.terminal) {
                if !matches!(&block.terminal, Terminal::Return { .. }) {
                    validate_no_ref_value_access(errors, ref_env, operand);
                    if !matches!(&block.terminal, Terminal::If { .. }) {
                        guard_check(errors, operand, ref_env);
                    }
                } else {
                    // Allow functions containing refs to be returned, but not direct ref values
                    validate_no_direct_ref_value_access(errors, operand, ref_env);
                    guard_check(errors, operand, ref_env);
                    if let Some(ty) = ref_env.get(operand.identifier) {
                        return_values.push(ty.clone());
                    }
                }
            }
        }

        if !errors.is_empty() {
            return RefAccessType::None;
        }
    }

    if ref_env.has_changed() {
        errors.push(CompilerDiagnostic::new(
            crate::diagnostics::ErrorCategory::Invariant,
            "Ref type environment did not converge",
            None,
        ));
        return RefAccessType::None;
    }

    join_ref_access_types_many(&mut ref_env.interner, &return_values)
}
