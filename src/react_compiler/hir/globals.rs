// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Global type registry and built-in shape definitions, ported from Globals.ts.
//!
//! Provides `DEFAULT_SHAPES` (built-in object shapes) and `DEFAULT_GLOBALS`
//! (global variable types including React hooks and JS built-ins).

use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::LazyLock;

use crate::hir::Effect;
use crate::hir::Type;
use crate::hir::object_shape::*;
use crate::hir::type_config::AliasingEffectConfig;
use crate::hir::type_config::AliasingSignatureConfig;
use crate::hir::type_config::ApplyArgConfig;
use crate::hir::type_config::BuiltInTypeRef;
use crate::hir::type_config::TypeConfig;
use crate::hir::type_config::TypeReferenceConfig;
use crate::hir::type_config::ValueKind;
use crate::hir::type_config::ValueReason;

/// Type alias matching TS `Global = BuiltInType | PolyType`.
/// In the Rust port, both map to our `Type` enum.
pub type Global = Type;

// Length-dispatched name → index into `BASE.globals`. Values live in a
// `LazyLock<Box<[Global]>>` because `Type` is not const-constructible.
bun_core::comptime_string_map! {
    static BASE_GLOBAL_INDEX: usize = {
        // React APIs
        b"useContext" => 0,
        b"useState" => 1,
        b"useActionState" => 2,
        b"useReducer" => 3,
        b"useRef" => 4,
        b"useImperativeHandle" => 5,
        b"useMemo" => 6,
        b"useCallback" => 7,
        b"useEffect" => 8,
        b"useLayoutEffect" => 9,
        b"useInsertionEffect" => 10,
        b"useTransition" => 11,
        b"useOptimistic" => 12,
        b"use" => 13,
        b"useEffectEvent" => 14,
        // UNTYPED_GLOBALS not later overwritten by typed globals
        b"Function" => 15,
        b"RegExp" => 16,
        b"Error" => 17,
        b"TypeError" => 18,
        b"RangeError" => 19,
        b"ReferenceError" => 20,
        b"SyntaxError" => 21,
        b"URIError" => 22,
        b"EvalError" => 23,
        b"DataView" => 24,
        b"Float32Array" => 25,
        b"Float64Array" => 26,
        b"Int8Array" => 27,
        b"Int16Array" => 28,
        b"Int32Array" => 29,
        b"Uint8Array" => 30,
        b"Uint8ClampedArray" => 31,
        b"Uint16Array" => 32,
        b"Uint32Array" => 33,
        b"ArrayBuffer" => 34,
        b"JSON" => 35,
        b"eval" => 36,
        // Typed globals
        b"Object" => 37,
        b"Array" => 38,
        b"Math" => 39,
        b"performance" => 40,
        b"Date" => 41,
        b"console" => 42,
        b"Boolean" => 43,
        b"Number" => 44,
        b"String" => 45,
        b"parseInt" => 46,
        b"parseFloat" => 47,
        b"isNaN" => 48,
        b"isFinite" => 49,
        b"encodeURI" => 50,
        b"encodeURIComponent" => 51,
        b"decodeURI" => 52,
        b"decodeURIComponent" => 53,
        b"Infinity" => 54,
        b"NaN" => 55,
        b"Map" => 56,
        b"Set" => 57,
        b"WeakMap" => 58,
        b"WeakSet" => 59,
        b"React" => 60,
        b"_jsx" => 61,
        b"globalThis" => 62,
        b"global" => 63,
    };
}

/// Registry mapping global names to their types.
///
/// Supports two modes:
/// - **Builder mode** (`base=false`): wraps a single HashMap, used during
///   `build_default_globals` to construct the static base.
/// - **Overlay mode** (`base=true`): lookups check the extras HashMap first,
///   then fall back to the static `BASE_GLOBAL_INDEX` / `BASE.globals` table.
///   Inserts go into extras. Cloning only copies the extras map.
pub struct GlobalRegistry {
    base: bool,
    entries: HashMap<Cow<'static, str>, Global>,
}

impl GlobalRegistry {
    /// Create an empty builder-mode registry.
    pub fn new() -> Self {
        Self {
            base: false,
            entries: HashMap::new(),
        }
    }

    /// Create an overlay-mode registry backed by the static base.
    pub fn with_base() -> Self {
        Self {
            base: true,
            entries: HashMap::new(),
        }
    }

    pub fn get(&self, key: &str) -> Option<&Global> {
        if let Some(v) = self.entries.get(key) {
            return Some(v);
        }
        if self.base {
            return lookup_base_global(key);
        }
        None
    }

    pub fn insert(&mut self, key: impl Into<Cow<'static, str>>, value: Global) {
        self.entries.insert(key.into(), value);
    }

    pub fn contains_key(&self, key: &str) -> bool {
        self.entries.contains_key(key)
            || (self.base && BASE_GLOBAL_INDEX.contains_key(key.as_bytes()))
    }

    /// Iterate over all keys in the registry (base + extras).
    /// Keys in extras that shadow base keys appear only once.
    pub fn keys(&self) -> impl Iterator<Item = &str> {
        let entries = &self.entries;
        let base_keys = self
            .base
            .then(|| BASE_GLOBAL_INDEX.keys())
            .into_iter()
            .flatten()
            // SAFETY: comptime_string_map! keys are ASCII byte-string literals.
            .map(|k| unsafe { core::str::from_utf8_unchecked(k) })
            .filter(move |k| !entries.contains_key(*k));
        entries.keys().map(|k| &**k).chain(base_keys)
    }

    /// Consume the registry and return the inner HashMap.
    /// Only valid in builder mode (no base).
    pub fn into_inner(self) -> HashMap<Cow<'static, str>, Global> {
        debug_assert!(
            !self.base,
            "into_inner() called on overlay-mode GlobalRegistry"
        );
        self.entries
    }
}

impl Clone for GlobalRegistry {
    fn clone(&self) -> Self {
        Self {
            base: self.base,
            entries: self.entries.clone(),
        }
    }
}

// =============================================================================
// Static base registries (initialized once, shared across all Environments)
// =============================================================================

struct BaseRegistries {
    shapes: HashMap<&'static str, ObjectShape>,
    globals: Box<[Global]>,
}

static BASE: LazyLock<BaseRegistries> = LazyLock::new(|| {
    let mut shapes = build_builtin_shapes();
    let mut globals_map = build_default_globals(&mut shapes).into_inner();
    debug_assert_eq!(
        globals_map.len(),
        BASE_GLOBAL_INDEX.len(),
        "BASE_GLOBAL_INDEX is out of sync with build_default_globals()",
    );
    let mut globals: Vec<Global> = Vec::with_capacity(BASE_GLOBAL_INDEX.len());
    for (key, &idx) in BASE_GLOBAL_INDEX.entries() {
        debug_assert_eq!(idx, globals.len());
        // SAFETY: comptime_string_map! keys are ASCII byte-string literals.
        let key = unsafe { core::str::from_utf8_unchecked(key) };
        let value = globals_map
            .remove(key)
            .unwrap_or_else(|| panic!("BASE_GLOBAL_INDEX key '{key}' missing from built globals"));
        globals.push(value);
    }
    BaseRegistries {
        shapes: shapes.into_inner(),
        globals: globals.into_boxed_slice(),
    }
});

/// Get a reference to the static base shapes registry.
pub fn base_shapes() -> &'static HashMap<&'static str, ObjectShape> {
    &BASE.shapes
}

/// Look up a global by name in the static base table.
pub fn lookup_base_global(name: &str) -> Option<&'static Global> {
    BASE_GLOBAL_INDEX
        .get(name.as_bytes())
        .map(|&i| &BASE.globals[i])
}

// =============================================================================
// installTypeConfig — converts TypeConfig to internal Type
// =============================================================================

/// Convert a user-provided TypeConfig into an internal Type, registering shapes
/// as needed. Ported from TS `installTypeConfig` in Globals.ts.
/// If `errors` is provided, hook-name vs hook-type consistency validation
/// errors are collected there.
pub fn install_type_config(
    _globals: &mut GlobalRegistry,
    shapes: &mut ShapeRegistry,
    type_config: &TypeConfig,
    module_name: &str,
    _loc: (),
) -> Global {
    install_type_config_inner(_globals, shapes, type_config, module_name, _loc, &mut None)
}

/// Like `install_type_config` but collects validation errors.
pub fn install_type_config_with_errors(
    _globals: &mut GlobalRegistry,
    shapes: &mut ShapeRegistry,
    type_config: &TypeConfig,
    module_name: &str,
    _loc: (),
    errors: &mut Vec<String>,
) -> Global {
    install_type_config_inner(
        _globals,
        shapes,
        type_config,
        module_name,
        _loc,
        &mut Some(errors),
    )
}

fn install_type_config_inner(
    _globals: &mut GlobalRegistry,
    shapes: &mut ShapeRegistry,
    type_config: &TypeConfig,
    module_name: &str,
    _loc: (),
    errors: &mut Option<&mut Vec<String>>,
) -> Global {
    match type_config {
        TypeConfig::TypeReference(TypeReferenceConfig { name }) => match name {
            BuiltInTypeRef::Array => Type::Object {
                shape_id: Some(BUILT_IN_ARRAY_ID),
            },
            BuiltInTypeRef::MixedReadonly => Type::Object {
                shape_id: Some(BUILT_IN_MIXED_READONLY_ID),
            },
            BuiltInTypeRef::Primitive => Type::Primitive,
            BuiltInTypeRef::Ref => Type::Object {
                shape_id: Some(BUILT_IN_USE_REF_ID),
            },
            BuiltInTypeRef::Any => Type::Poly,
        },
        TypeConfig::Function(func_config) => {
            // Compute return type first to avoid double-borrow of shapes
            let return_type = install_type_config_inner(
                _globals,
                shapes,
                &func_config.return_type,
                module_name,
                (),
                errors,
            );
            add_function(
                shapes,
                Vec::new(),
                FunctionSignatureBuilder {
                    positional_params: func_config.positional_params.clone(),
                    rest_param: func_config.rest_param,
                    callee_effect: func_config.callee_effect,
                    return_type,
                    return_value_kind: func_config.return_value_kind,
                    no_alias: func_config.no_alias.unwrap_or(false),
                    mutable_only_if_operands_are_mutable: func_config
                        .mutable_only_if_operands_are_mutable
                        .unwrap_or(false),
                    impure: func_config.impure.unwrap_or(false),
                    canonical_name: func_config.canonical_name.clone(),
                    aliasing: func_config.aliasing.clone(),
                    known_incompatible: func_config.known_incompatible.clone(),
                    ..Default::default()
                },
                None,
                false,
            )
        }
        TypeConfig::Hook(hook_config) => {
            // Compute return type first to avoid double-borrow of shapes
            let return_type = install_type_config_inner(
                _globals,
                shapes,
                &hook_config.return_type,
                module_name,
                (),
                errors,
            );
            add_hook(
                shapes,
                HookSignatureBuilder {
                    hook_kind: HookKind::Custom,
                    positional_params: hook_config.positional_params.clone().unwrap_or_default(),
                    rest_param: hook_config.rest_param.or(Some(Effect::Freeze)),
                    callee_effect: Effect::Read,
                    return_type,
                    return_value_kind: hook_config.return_value_kind.unwrap_or(ValueKind::Frozen),
                    no_alias: hook_config.no_alias.unwrap_or(false),
                    aliasing: hook_config.aliasing.clone(),
                    known_incompatible: hook_config.known_incompatible.clone(),
                    ..Default::default()
                },
                None,
            )
        }
        TypeConfig::Object(obj_config) => {
            let properties: Vec<(&'static str, Type)> = obj_config
                .properties
                .as_ref()
                .map(|props| {
                    props
                        .iter()
                        .map(|(key, value)| {
                            let ty = install_type_config_inner(
                                _globals,
                                shapes,
                                value,
                                module_name,
                                (),
                                errors,
                            );
                            // Validate hook-name vs hook-type consistency (matching TS installTypeConfig)
                            if let Some(errs) = errors {
                                let expect_hook = crate::hir::environment::is_hook_name(key.as_bytes());
                                let is_hook = match &ty {
                                    Type::Function { shape_id: Some(id), .. } => {
                                        shapes.get(id)
                                            .and_then(|shape| shape.function_type.as_ref())
                                            .and_then(|ft| ft.hook_kind.as_ref())
                                            .is_some()
                                    }
                                    _ => false,
                                };
                                if expect_hook != is_hook {
                                    errs.push(format!(
                                        "Expected type for object property '{}' from module '{}' {} based on the property name",
                                        key,
                                        module_name,
                                        if expect_hook { "to be a hook" } else { "not to be a hook" }
                                    ));
                                }
                            }
                            (*key, ty)
                        })
                        .collect()
                })
                .unwrap_or_default();
            add_object(shapes, None, properties)
        }
    }
}

// =============================================================================
// Build built-in shapes (BUILTIN_SHAPES from ObjectShape.ts)
// =============================================================================

/// Build the built-in shapes registry. This corresponds to TS `BUILTIN_SHAPES`
/// defined at module level in ObjectShape.ts.
#[cold]
#[inline(never)]
pub fn build_builtin_shapes() -> ShapeRegistry {
    let mut shapes = ShapeRegistry::new();

    // BuiltInProps: { ref: UseRefType }
    add_object(
        &mut shapes,
        Some(BUILT_IN_PROPS_ID),
        vec![(
            "ref",
            Type::Object {
                shape_id: Some(BUILT_IN_USE_REF_ID),
            },
        )],
    );

    build_array_shape(&mut shapes);
    build_set_shape(&mut shapes);
    build_map_shape(&mut shapes);
    build_weak_set_shape(&mut shapes);
    build_weak_map_shape(&mut shapes);
    build_object_shape(&mut shapes);
    build_ref_shapes(&mut shapes);
    build_state_shapes(&mut shapes);
    build_hook_shapes(&mut shapes);
    build_misc_shapes(&mut shapes);

    shapes
}

#[cold]
#[inline(never)]
fn simple_function(
    shapes: &mut ShapeRegistry,
    positional_params: Vec<Effect>,
    rest_param: Option<Effect>,
    return_type: Type,
    return_value_kind: ValueKind,
) -> Type {
    add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params,
            rest_param,
            return_type,
            return_value_kind,
            ..Default::default()
        },
        None,
        false,
    )
}

/// Shorthand for a pure function returning Primitive.
#[cold]
#[inline(never)]
fn pure_primitive_fn(shapes: &mut ShapeRegistry) -> Type {
    simple_function(
        shapes,
        Vec::new(),
        Some(Effect::Read),
        Type::Primitive,
        ValueKind::Primitive,
    )
}

#[cold]
#[inline(never)]
fn build_array_shape(shapes: &mut ShapeRegistry) {
    let index_of = pure_primitive_fn(shapes);
    let includes = pure_primitive_fn(shapes);
    let pop = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            callee_effect: Effect::Store,
            return_type: Type::Poly,
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let at = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Read],
            callee_effect: Effect::Capture,
            return_type: Type::Poly,
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let concat = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Capture),
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_ARRAY_ID),
            },
            return_value_kind: ValueKind::Mutable,
            callee_effect: Effect::Capture,
            ..Default::default()
        },
        None,
        false,
    );
    let join = pure_primitive_fn(shapes);
    let slice = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Read),
            callee_effect: Effect::Capture,
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_ARRAY_ID),
            },
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let map = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::ConditionallyMutate),
            callee_effect: Effect::ConditionallyMutate,
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_ARRAY_ID),
            },
            return_value_kind: ValueKind::Mutable,
            no_alias: true,
            mutable_only_if_operands_are_mutable: true,
            aliasing: Some(AliasingSignatureConfig {
                receiver: "@receiver",
                params: vec!["@callback"],
                rest: None,
                returns: "@returns",
                temporaries: vec!["@item", "@callbackReturn", "@thisArg"],
                effects: vec![
                    // Map creates a new mutable array
                    AliasingEffectConfig::Create {
                        into: "@returns",
                        value: ValueKind::Mutable,
                        reason: ValueReason::KnownReturnSignature,
                    },
                    // The first arg to the callback is an item extracted from the receiver array
                    AliasingEffectConfig::CreateFrom {
                        from: "@receiver",
                        into: "@item",
                    },
                    // The undefined this for the callback
                    AliasingEffectConfig::Create {
                        into: "@thisArg",
                        value: ValueKind::Primitive,
                        reason: ValueReason::KnownReturnSignature,
                    },
                    // Calls the callback, returning the result into a temporary
                    AliasingEffectConfig::Apply {
                        receiver: "@thisArg",
                        function: "@callback",
                        mutates_function: false,
                        args: vec![
                            ApplyArgConfig::Place("@item"),
                            ApplyArgConfig::Hole {},
                            ApplyArgConfig::Place("@receiver"),
                        ],
                        into: "@callbackReturn",
                    },
                    // Captures the result of the callback into the return array
                    AliasingEffectConfig::Capture {
                        from: "@callbackReturn",
                        into: "@returns",
                    },
                ],
            }),
            ..Default::default()
        },
        None,
        false,
    );
    let filter = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::ConditionallyMutate),
            callee_effect: Effect::ConditionallyMutate,
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_ARRAY_ID),
            },
            return_value_kind: ValueKind::Mutable,
            no_alias: true,
            mutable_only_if_operands_are_mutable: true,
            ..Default::default()
        },
        None,
        false,
    );
    let find = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::ConditionallyMutate),
            callee_effect: Effect::ConditionallyMutate,
            return_type: Type::Poly,
            return_value_kind: ValueKind::Mutable,
            no_alias: true,
            mutable_only_if_operands_are_mutable: true,
            ..Default::default()
        },
        None,
        false,
    );
    let find_index = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::ConditionallyMutate),
            callee_effect: Effect::ConditionallyMutate,
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            no_alias: true,
            mutable_only_if_operands_are_mutable: true,
            ..Default::default()
        },
        None,
        false,
    );
    let every = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::ConditionallyMutate),
            callee_effect: Effect::ConditionallyMutate,
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            no_alias: true,
            mutable_only_if_operands_are_mutable: true,
            ..Default::default()
        },
        None,
        false,
    );
    let some = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::ConditionallyMutate),
            callee_effect: Effect::ConditionallyMutate,
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            no_alias: true,
            mutable_only_if_operands_are_mutable: true,
            ..Default::default()
        },
        None,
        false,
    );
    let flat_map = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::ConditionallyMutate),
            callee_effect: Effect::ConditionallyMutate,
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_ARRAY_ID),
            },
            return_value_kind: ValueKind::Mutable,
            no_alias: true,
            mutable_only_if_operands_are_mutable: true,
            ..Default::default()
        },
        None,
        false,
    );
    let length = Type::Primitive;
    let push = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Capture),
            callee_effect: Effect::Store,
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            aliasing: Some(AliasingSignatureConfig {
                receiver: "@receiver",
                params: Vec::new(),
                rest: Some("@rest"),
                returns: "@returns",
                temporaries: Vec::new(),
                effects: vec![
                    // Push directly mutates the array itself
                    AliasingEffectConfig::Mutate { value: "@receiver" },
                    // The arguments are captured into the array
                    AliasingEffectConfig::Capture {
                        from: "@rest",
                        into: "@receiver",
                    },
                    // Returns the new length, a primitive
                    AliasingEffectConfig::Create {
                        into: "@returns",
                        value: ValueKind::Primitive,
                        reason: ValueReason::KnownReturnSignature,
                    },
                ],
            }),
            ..Default::default()
        },
        None,
        false,
    );

    add_object(
        shapes,
        Some(BUILT_IN_ARRAY_ID),
        vec![
            ("indexOf", index_of),
            ("includes", includes),
            ("pop", pop),
            ("at", at),
            ("concat", concat),
            ("length", length),
            ("push", push),
            ("slice", slice),
            ("map", map),
            ("flatMap", flat_map),
            ("filter", filter),
            ("every", every),
            ("some", some),
            ("find", find),
            ("findIndex", find_index),
            ("join", join),
            // TODO: rest of Array properties
        ],
    );
}

#[cold]
#[inline(never)]
fn build_set_shape(shapes: &mut ShapeRegistry) {
    let has = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Read],
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        None,
        false,
    );
    let add = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Capture],
            callee_effect: Effect::Store,
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_SET_ID),
            },
            return_value_kind: ValueKind::Mutable,
            aliasing: Some(AliasingSignatureConfig {
                receiver: "@receiver",
                params: Vec::new(),
                rest: Some("@rest"),
                returns: "@returns",
                temporaries: Vec::new(),
                effects: vec![
                    // Set.add returns the receiver Set
                    AliasingEffectConfig::Assign {
                        from: "@receiver",
                        into: "@returns",
                    },
                    // Set.add mutates the set itself
                    AliasingEffectConfig::Mutate { value: "@receiver" },
                    // Captures the rest params into the set
                    AliasingEffectConfig::Capture {
                        from: "@rest",
                        into: "@receiver",
                    },
                ],
            }),
            ..Default::default()
        },
        None,
        false,
    );
    let clear = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            callee_effect: Effect::Store,
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        None,
        false,
    );
    let delete = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Read],
            callee_effect: Effect::Store,
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        None,
        false,
    );
    let size = Type::Primitive;
    let difference = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Capture],
            callee_effect: Effect::Capture,
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_SET_ID),
            },
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let union = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Capture],
            callee_effect: Effect::Capture,
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_SET_ID),
            },
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let symmetrical_difference = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Capture],
            callee_effect: Effect::Capture,
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_SET_ID),
            },
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let is_subset_of = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Read],
            callee_effect: Effect::Read,
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        None,
        false,
    );
    let is_superset_of = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Read],
            callee_effect: Effect::Read,
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        None,
        false,
    );
    let for_each = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::ConditionallyMutate),
            callee_effect: Effect::ConditionallyMutate,
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            no_alias: true,
            mutable_only_if_operands_are_mutable: true,
            ..Default::default()
        },
        None,
        false,
    );
    let values = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            callee_effect: Effect::Capture,
            return_type: Type::Poly,
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let keys = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            callee_effect: Effect::Capture,
            return_type: Type::Poly,
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let entries = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            callee_effect: Effect::Capture,
            return_type: Type::Poly,
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );

    add_object(
        shapes,
        Some(BUILT_IN_SET_ID),
        vec![
            ("add", add),
            ("clear", clear),
            ("delete", delete),
            ("has", has),
            ("size", size),
            ("difference", difference),
            ("union", union),
            ("symmetricalDifference", symmetrical_difference),
            ("isSubsetOf", is_subset_of),
            ("isSupersetOf", is_superset_of),
            ("forEach", for_each),
            ("values", values),
            ("keys", keys),
            ("entries", entries),
        ],
    );
}

#[cold]
#[inline(never)]
fn build_map_shape(shapes: &mut ShapeRegistry) {
    let has = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Read],
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        None,
        false,
    );
    let get = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Read],
            callee_effect: Effect::Capture,
            return_type: Type::Poly,
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let clear = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            callee_effect: Effect::Store,
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        None,
        false,
    );
    let set = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Capture, Effect::Capture],
            callee_effect: Effect::Store,
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_MAP_ID),
            },
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let delete = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Read],
            callee_effect: Effect::Store,
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        None,
        false,
    );
    let size = Type::Primitive;
    let for_each = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::ConditionallyMutate),
            callee_effect: Effect::ConditionallyMutate,
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            no_alias: true,
            mutable_only_if_operands_are_mutable: true,
            ..Default::default()
        },
        None,
        false,
    );
    let values = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            callee_effect: Effect::Capture,
            return_type: Type::Poly,
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let keys = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            callee_effect: Effect::Capture,
            return_type: Type::Poly,
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let entries = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            callee_effect: Effect::Capture,
            return_type: Type::Poly,
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );

    add_object(
        shapes,
        Some(BUILT_IN_MAP_ID),
        vec![
            ("has", has),
            ("get", get),
            ("set", set),
            ("clear", clear),
            ("delete", delete),
            ("size", size),
            ("forEach", for_each),
            ("values", values),
            ("keys", keys),
            ("entries", entries),
        ],
    );
}

#[cold]
#[inline(never)]
fn build_weak_set_shape(shapes: &mut ShapeRegistry) {
    let has = pure_primitive_fn(shapes);
    let add = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Capture],
            callee_effect: Effect::Store,
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_WEAK_SET_ID),
            },
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let delete = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Read],
            callee_effect: Effect::Store,
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        None,
        false,
    );

    add_object(
        shapes,
        Some(BUILT_IN_WEAK_SET_ID),
        vec![("has", has), ("add", add), ("delete", delete)],
    );
}

#[cold]
#[inline(never)]
fn build_weak_map_shape(shapes: &mut ShapeRegistry) {
    let has = pure_primitive_fn(shapes);
    let get = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Read],
            callee_effect: Effect::Capture,
            return_type: Type::Poly,
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let set = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Capture, Effect::Capture],
            callee_effect: Effect::Store,
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_WEAK_MAP_ID),
            },
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let delete = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Read],
            callee_effect: Effect::Store,
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        None,
        false,
    );

    add_object(
        shapes,
        Some(BUILT_IN_WEAK_MAP_ID),
        vec![("has", has), ("get", get), ("set", set), ("delete", delete)],
    );
}

#[cold]
#[inline(never)]
fn build_object_shape(shapes: &mut ShapeRegistry) {
    // BuiltInObject: has toString() returning Primitive (matches TS BuiltInObjectId shape)
    let to_string = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        None,
        false,
    );
    add_object(
        shapes,
        Some(BUILT_IN_OBJECT_ID),
        vec![("toString", to_string)],
    );
    // BuiltInFunction: empty shape
    add_object(shapes, Some(BUILT_IN_FUNCTION_ID), Vec::new());
    // BuiltInJsx: empty shape
    add_object(shapes, Some(BUILT_IN_JSX_ID), Vec::new());
    // BuiltInMixedReadonly: has explicit method types + wildcard returning MixedReadonly
    // (matches TS BuiltInMixedReadonlyId shape)
    let mixed_to_string = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Read),
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        None,
        false,
    );
    let mixed_index_of = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Read),
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        None,
        false,
    );
    let mixed_includes = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Read),
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        None,
        false,
    );
    let mixed_at = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Read],
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_MIXED_READONLY_ID),
            },
            callee_effect: Effect::Capture,
            return_value_kind: ValueKind::Frozen,
            ..Default::default()
        },
        None,
        false,
    );
    let mixed_map = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::ConditionallyMutate),
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_ARRAY_ID),
            },
            callee_effect: Effect::ConditionallyMutate,
            return_value_kind: ValueKind::Mutable,
            no_alias: true,
            ..Default::default()
        },
        None,
        false,
    );
    let mixed_flat_map = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::ConditionallyMutate),
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_ARRAY_ID),
            },
            callee_effect: Effect::ConditionallyMutate,
            return_value_kind: ValueKind::Mutable,
            no_alias: true,
            ..Default::default()
        },
        None,
        false,
    );
    let mixed_filter = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::ConditionallyMutate),
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_ARRAY_ID),
            },
            callee_effect: Effect::ConditionallyMutate,
            return_value_kind: ValueKind::Mutable,
            no_alias: true,
            ..Default::default()
        },
        None,
        false,
    );
    let mixed_concat = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Capture),
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_ARRAY_ID),
            },
            callee_effect: Effect::Capture,
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let mixed_slice = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Read),
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_ARRAY_ID),
            },
            callee_effect: Effect::Capture,
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let mixed_every = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::ConditionallyMutate),
            return_type: Type::Primitive,
            callee_effect: Effect::ConditionallyMutate,
            return_value_kind: ValueKind::Primitive,
            no_alias: true,
            mutable_only_if_operands_are_mutable: true,
            ..Default::default()
        },
        None,
        false,
    );
    let mixed_some = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::ConditionallyMutate),
            return_type: Type::Primitive,
            callee_effect: Effect::ConditionallyMutate,
            return_value_kind: ValueKind::Primitive,
            no_alias: true,
            mutable_only_if_operands_are_mutable: true,
            ..Default::default()
        },
        None,
        false,
    );
    let mixed_find = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::ConditionallyMutate),
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_MIXED_READONLY_ID),
            },
            callee_effect: Effect::ConditionallyMutate,
            return_value_kind: ValueKind::Frozen,
            no_alias: true,
            mutable_only_if_operands_are_mutable: true,
            ..Default::default()
        },
        None,
        false,
    );
    let mixed_find_index = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::ConditionallyMutate),
            return_type: Type::Primitive,
            callee_effect: Effect::ConditionallyMutate,
            return_value_kind: ValueKind::Primitive,
            no_alias: true,
            mutable_only_if_operands_are_mutable: true,
            ..Default::default()
        },
        None,
        false,
    );
    let mixed_join = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Read),
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        None,
        false,
    );
    let mut mixed_props: HashMap<&'static str, Type> = HashMap::new();
    mixed_props.insert("toString", mixed_to_string);
    mixed_props.insert("indexOf", mixed_index_of);
    mixed_props.insert("includes", mixed_includes);
    mixed_props.insert("at", mixed_at);
    mixed_props.insert("map", mixed_map);
    mixed_props.insert("flatMap", mixed_flat_map);
    mixed_props.insert("filter", mixed_filter);
    mixed_props.insert("concat", mixed_concat);
    mixed_props.insert("slice", mixed_slice);
    mixed_props.insert("every", mixed_every);
    mixed_props.insert("some", mixed_some);
    mixed_props.insert("find", mixed_find);
    mixed_props.insert("findIndex", mixed_find_index);
    mixed_props.insert("join", mixed_join);
    mixed_props.insert(
        "*",
        Type::Object {
            shape_id: Some(BUILT_IN_MIXED_READONLY_ID),
        },
    );
    shapes.insert(
        BUILT_IN_MIXED_READONLY_ID,
        ObjectShape {
            properties: mixed_props,
            function_type: None,
        },
    );
}

#[cold]
#[inline(never)]
fn build_ref_shapes(shapes: &mut ShapeRegistry) {
    // BuiltInUseRefId: { current: Object { shapeId: BuiltInRefValue } }
    add_object(
        shapes,
        Some(BUILT_IN_USE_REF_ID),
        vec![(
            "current",
            Type::Object {
                shape_id: Some(BUILT_IN_REF_VALUE_ID),
            },
        )],
    );
    // BuiltInRefValue: { *: Object { shapeId: BuiltInRefValue } } (self-referencing)
    add_object(
        shapes,
        Some(BUILT_IN_REF_VALUE_ID),
        vec![(
            "*",
            Type::Object {
                shape_id: Some(BUILT_IN_REF_VALUE_ID),
            },
        )],
    );
}

#[cold]
#[inline(never)]
fn build_state_shapes(shapes: &mut ShapeRegistry) {
    // BuiltInSetState: function that freezes its argument
    let set_state = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        Some(BUILT_IN_SET_STATE_ID),
        false,
    );

    // BuiltInUseState: object with [0] = Poly (state), [1] = setState function
    add_object(
        shapes,
        Some(BUILT_IN_USE_STATE_ID),
        vec![("0", Type::Poly), ("1", set_state)],
    );

    // BuiltInSetActionState
    let set_action_state = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        Some(BUILT_IN_SET_ACTION_STATE_ID),
        false,
    );

    // BuiltInUseActionState: [0] = Poly, [1] = setActionState function
    add_object(
        shapes,
        Some(BUILT_IN_USE_ACTION_STATE_ID),
        vec![("0", Type::Poly), ("1", set_action_state)],
    );

    // BuiltInDispatch
    let dispatch = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        Some(BUILT_IN_DISPATCH_ID),
        false,
    );

    // BuiltInUseReducer: [0] = Poly, [1] = dispatch function
    add_object(
        shapes,
        Some(BUILT_IN_USE_REDUCER_ID),
        vec![("0", Type::Poly), ("1", dispatch)],
    );

    // BuiltInStartTransition
    let start_transition = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            // Note: TS uses restParam: null for startTransition
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        Some(BUILT_IN_START_TRANSITION_ID),
        false,
    );

    // BuiltInUseTransition: [0] = Primitive (isPending), [1] = startTransition function
    add_object(
        shapes,
        Some(BUILT_IN_USE_TRANSITION_ID),
        vec![("0", Type::Primitive), ("1", start_transition)],
    );

    // BuiltInSetOptimistic
    let set_optimistic = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        Some(BUILT_IN_SET_OPTIMISTIC_ID),
        false,
    );

    // BuiltInUseOptimistic: [0] = Poly, [1] = setOptimistic function
    add_object(
        shapes,
        Some(BUILT_IN_USE_OPTIMISTIC_ID),
        vec![("0", Type::Poly), ("1", set_optimistic)],
    );
}

#[cold]
#[inline(never)]
fn build_hook_shapes(shapes: &mut ShapeRegistry) {
    // BuiltInEffectEvent function shape (the return value of useEffectEvent)
    add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::ConditionallyMutate),
            callee_effect: Effect::ConditionallyMutate,
            return_type: Type::Poly,
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        Some(BUILT_IN_EFFECT_EVENT_ID),
        false,
    );
}

#[cold]
#[inline(never)]
fn build_misc_shapes(shapes: &mut ShapeRegistry) {
    // ReanimatedSharedValue: empty properties (matching TS)
    add_object(shapes, Some(REANIMATED_SHARED_VALUE_ID), Vec::new());
}

/// Build the reanimated module type. Ported from TS `getReanimatedModuleType`.
pub fn get_reanimated_module_type(shapes: &mut ShapeRegistry) -> Type {
    let mut reanimated_type: Vec<(&'static str, Type)> = Vec::new();

    // hooks that freeze args and return frozen value
    let frozen_hooks = [
        "useFrameCallback",
        "useAnimatedStyle",
        "useAnimatedProps",
        "useAnimatedScrollHandler",
        "useAnimatedReaction",
        "useWorkletCallback",
    ];
    for hook in &frozen_hooks {
        let hook_type = add_hook(
            shapes,
            HookSignatureBuilder {
                rest_param: Some(Effect::Freeze),
                return_type: Type::Poly,
                return_value_kind: ValueKind::Frozen,
                no_alias: true,
                hook_kind: HookKind::Custom,
                ..Default::default()
            },
            None,
        );
        reanimated_type.push((*hook, hook_type));
    }

    // hooks that return a mutable value (modelled as shared value)
    let mutable_hooks = ["useSharedValue", "useDerivedValue"];
    for hook in &mutable_hooks {
        let hook_type = add_hook(
            shapes,
            HookSignatureBuilder {
                rest_param: Some(Effect::Freeze),
                return_type: Type::Object {
                    shape_id: Some(REANIMATED_SHARED_VALUE_ID),
                },
                return_value_kind: ValueKind::Mutable,
                no_alias: true,
                hook_kind: HookKind::Custom,
                ..Default::default()
            },
            None,
        );
        reanimated_type.push((*hook, hook_type));
    }

    // functions that return mutable value
    let funcs = [
        "withTiming",
        "withSpring",
        "createAnimatedPropAdapter",
        "withDecay",
        "withRepeat",
        "runOnUI",
        "executeOnUIRuntimeSync",
    ];
    for func_name in &funcs {
        let func_type = add_function(
            shapes,
            Vec::new(),
            FunctionSignatureBuilder {
                rest_param: Some(Effect::Read),
                return_type: Type::Poly,
                return_value_kind: ValueKind::Mutable,
                no_alias: true,
                ..Default::default()
            },
            None,
            false,
        );
        reanimated_type.push((*func_name, func_type));
    }

    add_object(shapes, None, reanimated_type)
}

// =============================================================================
// Build default globals (DEFAULT_GLOBALS from Globals.ts)
// =============================================================================

/// Build the default globals registry. This corresponds to TS `DEFAULT_GLOBALS`.
///
/// Requires a mutable reference to the shapes registry because some globals
/// (like Object.keys, Array.isArray) register new shapes.
#[cold]
#[inline(never)]
pub fn build_default_globals(shapes: &mut ShapeRegistry) -> GlobalRegistry {
    let mut globals = GlobalRegistry::new();

    // React APIs — returns the list so we can reuse them for the React namespace
    let react_apis = build_react_apis(shapes, &mut globals);

    // Untyped globals (treated as Poly) — must come before typed globals
    // so typed definitions take priority (matching TS ordering)
    for name in UNTYPED_GLOBALS {
        globals.insert(*name, Type::Poly);
    }

    // Typed JS globals (overwrites Poly entries from UNTYPED_GLOBALS).
    // Returns the list of typed globals for use as globalThis/global properties.
    let typed_globals = build_typed_globals(shapes, &mut globals, react_apis);

    // globalThis and global — populated with all typed globals as properties
    // (matching TS: `addObject(DEFAULT_SHAPES, 'globalThis', TYPED_GLOBALS)`)
    globals.insert(
        "globalThis",
        add_object(shapes, Some("globalThis"), typed_globals.clone()),
    );
    globals.insert("global", add_object(shapes, Some("global"), typed_globals));

    globals
}

const UNTYPED_GLOBALS: &[&str] = &[
    "Object",
    "Function",
    "RegExp",
    "Date",
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "URIError",
    "EvalError",
    "DataView",
    "Float32Array",
    "Float64Array",
    "Int8Array",
    "Int16Array",
    "Int32Array",
    "WeakMap",
    "Uint8Array",
    "Uint8ClampedArray",
    "Uint16Array",
    "Uint32Array",
    "ArrayBuffer",
    "JSON",
    "console",
    "eval",
];

/// Build the React API types (REACT_APIS from TS). Returns the list of (name, type) pairs
/// so they can be reused as properties of the React namespace object (matching TS behavior
/// where the SAME type objects are used in both DEFAULT_GLOBALS and the React namespace).
#[cold]
#[inline(never)]
fn build_react_apis(
    shapes: &mut ShapeRegistry,
    globals: &mut GlobalRegistry,
) -> Vec<(&'static str, Type)> {
    let mut react_apis: Vec<(&'static str, Type)> = Vec::new();

    // useContext
    let use_context = add_hook(
        shapes,
        HookSignatureBuilder {
            rest_param: Some(Effect::Read),
            return_type: Type::Poly,
            return_value_kind: ValueKind::Frozen,
            return_value_reason: Some(ValueReason::Context),
            hook_kind: HookKind::UseContext,
            ..Default::default()
        },
        Some(BUILT_IN_USE_CONTEXT_HOOK_ID),
    );
    react_apis.push(("useContext", use_context));

    // useState
    let use_state = add_hook(
        shapes,
        HookSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_USE_STATE_ID),
            },
            return_value_kind: ValueKind::Frozen,
            return_value_reason: Some(ValueReason::State),
            hook_kind: HookKind::UseState,
            ..Default::default()
        },
        None,
    );
    react_apis.push(("useState", use_state));

    // useActionState
    let use_action_state = add_hook(
        shapes,
        HookSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_USE_ACTION_STATE_ID),
            },
            return_value_kind: ValueKind::Frozen,
            return_value_reason: Some(ValueReason::State),
            hook_kind: HookKind::UseActionState,
            ..Default::default()
        },
        None,
    );
    react_apis.push(("useActionState", use_action_state));

    // useReducer
    let use_reducer = add_hook(
        shapes,
        HookSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_USE_REDUCER_ID),
            },
            return_value_kind: ValueKind::Frozen,
            return_value_reason: Some(ValueReason::ReducerState),
            hook_kind: HookKind::UseReducer,
            ..Default::default()
        },
        None,
    );
    react_apis.push(("useReducer", use_reducer));

    // useRef
    let use_ref = add_hook(
        shapes,
        HookSignatureBuilder {
            rest_param: Some(Effect::Capture),
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_USE_REF_ID),
            },
            return_value_kind: ValueKind::Mutable,
            hook_kind: HookKind::UseRef,
            ..Default::default()
        },
        None,
    );
    react_apis.push(("useRef", use_ref));

    // useImperativeHandle
    let use_imperative_handle = add_hook(
        shapes,
        HookSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Frozen,
            hook_kind: HookKind::UseImperativeHandle,
            ..Default::default()
        },
        None,
    );
    react_apis.push(("useImperativeHandle", use_imperative_handle));

    // useMemo
    let use_memo = add_hook(
        shapes,
        HookSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Poly,
            return_value_kind: ValueKind::Frozen,
            hook_kind: HookKind::UseMemo,
            ..Default::default()
        },
        None,
    );
    react_apis.push(("useMemo", use_memo));

    // useCallback
    let use_callback = add_hook(
        shapes,
        HookSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Poly,
            return_value_kind: ValueKind::Frozen,
            hook_kind: HookKind::UseCallback,
            ..Default::default()
        },
        None,
    );
    react_apis.push(("useCallback", use_callback));

    // useEffect (with aliasing signature)
    let use_effect = add_hook(
        shapes,
        HookSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Frozen,
            hook_kind: HookKind::UseEffect,
            aliasing: Some(AliasingSignatureConfig {
                receiver: "@receiver",
                params: Vec::new(),
                rest: Some("@rest"),
                returns: "@returns",
                temporaries: vec!["@effect"],
                effects: vec![
                    AliasingEffectConfig::Freeze {
                        value: "@rest",
                        reason: ValueReason::Effect,
                    },
                    AliasingEffectConfig::Create {
                        into: "@effect",
                        value: ValueKind::Frozen,
                        reason: ValueReason::KnownReturnSignature,
                    },
                    AliasingEffectConfig::Capture {
                        from: "@rest",
                        into: "@effect",
                    },
                    AliasingEffectConfig::Create {
                        into: "@returns",
                        value: ValueKind::Primitive,
                        reason: ValueReason::KnownReturnSignature,
                    },
                ],
            }),
            ..Default::default()
        },
        Some(BUILT_IN_USE_EFFECT_HOOK_ID),
    );
    react_apis.push(("useEffect", use_effect));

    // useLayoutEffect
    let use_layout_effect = add_hook(
        shapes,
        HookSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Poly,
            return_value_kind: ValueKind::Frozen,
            hook_kind: HookKind::UseLayoutEffect,
            ..Default::default()
        },
        Some(BUILT_IN_USE_LAYOUT_EFFECT_HOOK_ID),
    );
    react_apis.push(("useLayoutEffect", use_layout_effect));

    // useInsertionEffect
    let use_insertion_effect = add_hook(
        shapes,
        HookSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Poly,
            return_value_kind: ValueKind::Frozen,
            hook_kind: HookKind::UseInsertionEffect,
            ..Default::default()
        },
        Some(BUILT_IN_USE_INSERTION_EFFECT_HOOK_ID),
    );
    react_apis.push(("useInsertionEffect", use_insertion_effect));

    // useTransition
    let use_transition = add_hook(
        shapes,
        HookSignatureBuilder {
            rest_param: None,
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_USE_TRANSITION_ID),
            },
            return_value_kind: ValueKind::Frozen,
            hook_kind: HookKind::UseTransition,
            ..Default::default()
        },
        None,
    );
    react_apis.push(("useTransition", use_transition));

    // useOptimistic
    let use_optimistic = add_hook(
        shapes,
        HookSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_USE_OPTIMISTIC_ID),
            },
            return_value_kind: ValueKind::Frozen,
            return_value_reason: Some(ValueReason::State),
            hook_kind: HookKind::UseOptimistic,
            ..Default::default()
        },
        None,
    );
    react_apis.push(("useOptimistic", use_optimistic));

    // use (not a hook, it's a function)
    let use_fn = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Poly,
            return_value_kind: ValueKind::Frozen,
            ..Default::default()
        },
        Some(BUILT_IN_USE_OPERATOR_ID),
        false,
    );
    react_apis.push(("use", use_fn));

    // useEffectEvent
    let use_effect_event = add_hook(
        shapes,
        HookSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Function {
                shape_id: Some(BUILT_IN_EFFECT_EVENT_ID),
                return_type: Box::new(Type::Poly),
                is_constructor: false,
            },
            return_value_kind: ValueKind::Frozen,
            hook_kind: HookKind::UseEffectEvent,
            ..Default::default()
        },
        Some(BUILT_IN_USE_EFFECT_EVENT_ID),
    );
    react_apis.push(("useEffectEvent", use_effect_event));

    // Insert all React APIs as standalone globals
    for (name, ty) in &react_apis {
        globals.insert(*name, ty.clone());
    }

    react_apis
}

/// Build typed globals and return them as a list for use as globalThis/global properties.
#[cold]
#[inline(never)]
fn build_typed_globals(
    shapes: &mut ShapeRegistry,
    globals: &mut GlobalRegistry,
    react_apis: Vec<(&'static str, Type)>,
) -> Vec<(&'static str, Type)> {
    let mut typed_globals: Vec<(&'static str, Type)> = Vec::new();
    // Object
    let obj_keys = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Read],
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_ARRAY_ID),
            },
            return_value_kind: ValueKind::Mutable,
            aliasing: Some(AliasingSignatureConfig {
                receiver: "@receiver",
                params: vec!["@object"],
                rest: None,
                returns: "@returns",
                temporaries: Vec::new(),
                effects: vec![
                    AliasingEffectConfig::Create {
                        into: "@returns",
                        value: ValueKind::Mutable,
                        reason: ValueReason::KnownReturnSignature,
                    },
                    // Only keys are captured, and keys are immutable
                    AliasingEffectConfig::ImmutableCapture {
                        from: "@object",
                        into: "@returns",
                    },
                ],
            }),
            ..Default::default()
        },
        None,
        false,
    );
    let obj_from_entries = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::ConditionallyMutate],
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_OBJECT_ID),
            },
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let obj_entries = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Capture],
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_ARRAY_ID),
            },
            return_value_kind: ValueKind::Mutable,
            aliasing: Some(AliasingSignatureConfig {
                receiver: "@receiver",
                params: vec!["@object"],
                rest: None,
                returns: "@returns",
                temporaries: Vec::new(),
                effects: vec![
                    AliasingEffectConfig::Create {
                        into: "@returns",
                        value: ValueKind::Mutable,
                        reason: ValueReason::KnownReturnSignature,
                    },
                    // Object values are captured into the return
                    AliasingEffectConfig::Capture {
                        from: "@object",
                        into: "@returns",
                    },
                ],
            }),
            ..Default::default()
        },
        None,
        false,
    );
    let obj_values = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Capture],
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_ARRAY_ID),
            },
            return_value_kind: ValueKind::Mutable,
            aliasing: Some(AliasingSignatureConfig {
                receiver: "@receiver",
                params: vec!["@object"],
                rest: None,
                returns: "@returns",
                temporaries: Vec::new(),
                effects: vec![
                    AliasingEffectConfig::Create {
                        into: "@returns",
                        value: ValueKind::Mutable,
                        reason: ValueReason::KnownReturnSignature,
                    },
                    // Object values are captured into the return
                    AliasingEffectConfig::Capture {
                        from: "@object",
                        into: "@returns",
                    },
                ],
            }),
            ..Default::default()
        },
        None,
        false,
    );
    let object_global = add_object(
        shapes,
        Some("Object"),
        vec![
            ("keys", obj_keys),
            ("fromEntries", obj_from_entries),
            ("entries", obj_entries),
            ("values", obj_values),
        ],
    );
    typed_globals.push(("Object", object_global.clone()));
    globals.insert("Object", object_global);

    // Array
    let array_is_array = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::Read],
            return_type: Type::Primitive,
            return_value_kind: ValueKind::Primitive,
            ..Default::default()
        },
        None,
        false,
    );
    let array_from = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![
                Effect::ConditionallyMutateIterator,
                Effect::ConditionallyMutate,
                Effect::ConditionallyMutate,
            ],
            rest_param: Some(Effect::Read),
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_ARRAY_ID),
            },
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let array_of = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Read),
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_ARRAY_ID),
            },
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );
    let array_global = add_object(
        shapes,
        Some("Array"),
        vec![
            ("isArray", array_is_array),
            ("from", array_from),
            ("of", array_of),
        ],
    );
    typed_globals.push(("Array", array_global.clone()));
    globals.insert("Array", array_global);

    // Math
    let math_fns: Vec<(&'static str, Type)> = ["max", "min", "trunc", "ceil", "floor", "pow"]
        .iter()
        .map(|name| (*name, pure_primitive_fn(shapes)))
        .collect();
    let mut math_props = math_fns;
    math_props.push(("PI", Type::Primitive));
    // Math.random is impure
    let math_random = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            return_type: Type::Poly,
            return_value_kind: ValueKind::Mutable,
            impure: true,
            canonical_name: Some("Math.random"),
            ..Default::default()
        },
        None,
        false,
    );
    math_props.push(("random", math_random));
    let math_global = add_object(shapes, Some("Math"), math_props);
    typed_globals.push(("Math", math_global.clone()));
    globals.insert("Math", math_global);

    // performance
    let perf_now = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Read),
            return_type: Type::Poly,
            return_value_kind: ValueKind::Mutable,
            impure: true,
            canonical_name: Some("performance.now"),
            ..Default::default()
        },
        None,
        false,
    );
    let perf_global = add_object(shapes, Some("performance"), vec![("now", perf_now)]);
    typed_globals.push(("performance", perf_global.clone()));
    globals.insert("performance", perf_global);

    // Date
    let date_now = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Read),
            return_type: Type::Poly,
            return_value_kind: ValueKind::Mutable,
            impure: true,
            canonical_name: Some("Date.now"),
            ..Default::default()
        },
        None,
        false,
    );
    let date_global = add_object(shapes, Some("Date"), vec![("now", date_now)]);
    typed_globals.push(("Date", date_global.clone()));
    globals.insert("Date", date_global);

    // console
    let console_methods: Vec<(&'static str, Type)> =
        ["error", "info", "log", "table", "trace", "warn"]
            .iter()
            .map(|name| (*name, pure_primitive_fn(shapes)))
            .collect();
    let console_global = add_object(shapes, Some("console"), console_methods);
    typed_globals.push(("console", console_global.clone()));
    globals.insert("console", console_global);

    // Simple global functions returning Primitive
    for name in &[
        "Boolean",
        "Number",
        "String",
        "parseInt",
        "parseFloat",
        "isNaN",
        "isFinite",
        "encodeURI",
        "encodeURIComponent",
        "decodeURI",
        "decodeURIComponent",
    ] {
        let f = pure_primitive_fn(shapes);
        typed_globals.push((*name, f.clone()));
        globals.insert(*name, f);
    }

    // Primitive globals
    typed_globals.push(("Infinity", Type::Primitive));
    globals.insert("Infinity", Type::Primitive);
    typed_globals.push(("NaN", Type::Primitive));
    globals.insert("NaN", Type::Primitive);

    // Map, Set, WeakMap, WeakSet constructors
    let map_ctor = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::ConditionallyMutateIterator],
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_MAP_ID),
            },
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        true,
    );
    typed_globals.push(("Map", map_ctor.clone()));
    globals.insert("Map", map_ctor);

    let set_ctor = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::ConditionallyMutateIterator],
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_SET_ID),
            },
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        true,
    );
    typed_globals.push(("Set", set_ctor.clone()));
    globals.insert("Set", set_ctor);

    let weak_map_ctor = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::ConditionallyMutateIterator],
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_WEAK_MAP_ID),
            },
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        true,
    );
    typed_globals.push(("WeakMap", weak_map_ctor.clone()));
    globals.insert("WeakMap", weak_map_ctor);

    let weak_set_ctor = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            positional_params: vec![Effect::ConditionallyMutateIterator],
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_WEAK_SET_ID),
            },
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        true,
    );
    typed_globals.push(("WeakSet", weak_set_ctor.clone()));
    globals.insert("WeakSet", weak_set_ctor);

    // React global object — reuses the same REACT_APIS types (matching TS behavior
    // where the same type objects are used as both standalone globals and React.* properties)
    let react_create_element = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Poly,
            return_value_kind: ValueKind::Frozen,
            ..Default::default()
        },
        None,
        false,
    );
    let react_clone_element = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Poly,
            return_value_kind: ValueKind::Frozen,
            ..Default::default()
        },
        None,
        false,
    );
    let react_create_ref = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Capture),
            return_type: Type::Object {
                shape_id: Some(BUILT_IN_USE_REF_ID),
            },
            return_value_kind: ValueKind::Mutable,
            ..Default::default()
        },
        None,
        false,
    );

    // Build React namespace properties from react_apis + React-specific functions
    let mut react_props: Vec<(&'static str, Type)> = react_apis;
    react_props.push(("createElement", react_create_element));
    react_props.push(("cloneElement", react_clone_element));
    react_props.push(("createRef", react_create_ref));

    let react_global = add_object(shapes, None, react_props);
    typed_globals.push(("React", react_global.clone()));
    globals.insert("React", react_global);

    // _jsx (used by JSX transform)
    let jsx_fn = add_function(
        shapes,
        Vec::new(),
        FunctionSignatureBuilder {
            rest_param: Some(Effect::Freeze),
            return_type: Type::Poly,
            return_value_kind: ValueKind::Frozen,
            ..Default::default()
        },
        None,
        false,
    );
    typed_globals.push(("_jsx", jsx_fn.clone()));
    globals.insert("_jsx", jsx_fn);

    typed_globals
}
