// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Default module type provider, ported from DefaultModuleTypeProvider.ts.
//!
//! Provides hardcoded type overrides for known-incompatible third-party libraries.

use crate::collections::IndexMap;

use crate::hir::Effect;
use crate::hir::type_config::{
    AliasingEffectConfig, AliasingSignatureConfig, BuiltInTypeRef, FunctionTypeConfig,
    HookTypeConfig, ObjectTypeConfig, TypeConfig, TypeReferenceConfig, ValueKind, ValueReason,
};

fn primitive_fn(positional_params: Vec<Effect>, rest_param: Effect) -> TypeConfig {
    TypeConfig::Function(FunctionTypeConfig {
        positional_params,
        rest_param: Some(rest_param),
        callee_effect: Effect::Read,
        return_type: Box::new(TypeConfig::TypeReference(TypeReferenceConfig {
            name: BuiltInTypeRef::Primitive,
        })),
        return_value_kind: ValueKind::Primitive,
        no_alias: None,
        mutable_only_if_operands_are_mutable: None,
        impure: None,
        canonical_name: None,
        aliasing: None,
        known_incompatible: None,
    })
}

/// Returns type configuration for known third-party modules that are
/// incompatible with memoization. Ported from TS `defaultModuleTypeProvider`.
///
/// Also includes the test-fixture modules `shared-runtime`, `ReactCompilerTest`,
/// and `useDefaultExportNotTypedAsHook`, ported from upstream's
/// `compiler/packages/snap/src/sprout/shared-runtime-type-provider.ts`.
pub fn default_module_type_provider(module_name: &str) -> Option<TypeConfig> {
    match module_name {
        "shared-runtime" => Some(TypeConfig::Object(ObjectTypeConfig {
            properties: Some(IndexMap::from([
                ("default".to_string(), primitive_fn(Vec::new(), Effect::Read)),
                ("graphql".to_string(), primitive_fn(Vec::new(), Effect::Read)),
                (
                    "typedArrayPush".to_string(),
                    primitive_fn(vec![Effect::Store, Effect::Capture], Effect::Capture),
                ),
                ("typedLog".to_string(), primitive_fn(Vec::new(), Effect::Read)),
                (
                    "typedCapture".to_string(),
                    TypeConfig::Function(FunctionTypeConfig {
                        positional_params: vec![Effect::Read],
                        rest_param: None,
                        callee_effect: Effect::Read,
                        return_type: Box::new(TypeConfig::TypeReference(TypeReferenceConfig {
                            name: BuiltInTypeRef::Array,
                        })),
                        return_value_kind: ValueKind::Mutable,
                        no_alias: None,
                        mutable_only_if_operands_are_mutable: None,
                        impure: None,
                        canonical_name: None,
                        aliasing: Some(AliasingSignatureConfig {
                            receiver: "@receiver".to_string(),
                            params: vec!["@value".to_string()],
                            rest: None,
                            returns: "@return".to_string(),
                            temporaries: Vec::new(),
                            effects: vec![
                                AliasingEffectConfig::Create {
                                    into: "@return".to_string(),
                                    value: ValueKind::Mutable,
                                    reason: ValueReason::KnownReturnSignature,
                                },
                                AliasingEffectConfig::Capture {
                                    from: "@value".to_string(),
                                    into: "@return".to_string(),
                                },
                            ],
                        }),
                        known_incompatible: None,
                    }),
                ),
                (
                    "typedCreateFrom".to_string(),
                    TypeConfig::Function(FunctionTypeConfig {
                        positional_params: vec![Effect::Read],
                        rest_param: None,
                        callee_effect: Effect::Read,
                        return_type: Box::new(TypeConfig::TypeReference(TypeReferenceConfig {
                            name: BuiltInTypeRef::Any,
                        })),
                        return_value_kind: ValueKind::Mutable,
                        no_alias: None,
                        mutable_only_if_operands_are_mutable: None,
                        impure: None,
                        canonical_name: None,
                        aliasing: Some(AliasingSignatureConfig {
                            receiver: "@receiver".to_string(),
                            params: vec!["@value".to_string()],
                            rest: None,
                            returns: "@return".to_string(),
                            temporaries: Vec::new(),
                            effects: vec![AliasingEffectConfig::CreateFrom {
                                from: "@value".to_string(),
                                into: "@return".to_string(),
                            }],
                        }),
                        known_incompatible: None,
                    }),
                ),
                (
                    "typedMutate".to_string(),
                    TypeConfig::Function(FunctionTypeConfig {
                        positional_params: vec![Effect::Read, Effect::Capture],
                        rest_param: None,
                        callee_effect: Effect::Store,
                        return_type: Box::new(TypeConfig::TypeReference(TypeReferenceConfig {
                            name: BuiltInTypeRef::Primitive,
                        })),
                        return_value_kind: ValueKind::Primitive,
                        no_alias: None,
                        mutable_only_if_operands_are_mutable: None,
                        impure: None,
                        canonical_name: None,
                        aliasing: Some(AliasingSignatureConfig {
                            receiver: "@receiver".to_string(),
                            params: vec!["@object".to_string(), "@value".to_string()],
                            rest: None,
                            returns: "@return".to_string(),
                            temporaries: Vec::new(),
                            effects: vec![
                                AliasingEffectConfig::Create {
                                    into: "@return".to_string(),
                                    value: ValueKind::Primitive,
                                    reason: ValueReason::KnownReturnSignature,
                                },
                                AliasingEffectConfig::Mutate {
                                    value: "@object".to_string(),
                                },
                                AliasingEffectConfig::Capture {
                                    from: "@value".to_string(),
                                    into: "@object".to_string(),
                                },
                            ],
                        }),
                        known_incompatible: None,
                    }),
                ),
                (
                    "useFreeze".to_string(),
                    TypeConfig::Hook(HookTypeConfig {
                        positional_params: None,
                        rest_param: None,
                        return_type: Box::new(TypeConfig::TypeReference(TypeReferenceConfig {
                            name: BuiltInTypeRef::Any,
                        })),
                        return_value_kind: None,
                        no_alias: None,
                        aliasing: None,
                        known_incompatible: None,
                    }),
                ),
                (
                    "useFragment".to_string(),
                    TypeConfig::Hook(HookTypeConfig {
                        positional_params: None,
                        rest_param: None,
                        return_type: Box::new(TypeConfig::TypeReference(TypeReferenceConfig {
                            name: BuiltInTypeRef::MixedReadonly,
                        })),
                        return_value_kind: None,
                        no_alias: Some(true),
                        aliasing: None,
                        known_incompatible: None,
                    }),
                ),
                (
                    "useNoAlias".to_string(),
                    TypeConfig::Hook(HookTypeConfig {
                        positional_params: None,
                        rest_param: None,
                        return_type: Box::new(TypeConfig::TypeReference(TypeReferenceConfig {
                            name: BuiltInTypeRef::Any,
                        })),
                        return_value_kind: Some(ValueKind::Mutable),
                        no_alias: Some(true),
                        aliasing: None,
                        known_incompatible: None,
                    }),
                ),
            ])),
        })),

        "ReactCompilerTest" => Some(TypeConfig::Object(ObjectTypeConfig {
            properties: Some(IndexMap::from([
                (
                    "useHookNotTypedAsHook".to_string(),
                    TypeConfig::TypeReference(TypeReferenceConfig {
                        name: BuiltInTypeRef::Any,
                    }),
                ),
                (
                    "notAhookTypedAsHook".to_string(),
                    TypeConfig::Hook(HookTypeConfig {
                        positional_params: None,
                        rest_param: None,
                        return_type: Box::new(TypeConfig::TypeReference(TypeReferenceConfig {
                            name: BuiltInTypeRef::Any,
                        })),
                        return_value_kind: None,
                        no_alias: None,
                        aliasing: None,
                        known_incompatible: None,
                    }),
                ),
            ])),
        })),

        "ReactCompilerKnownIncompatibleTest" => Some(TypeConfig::Object(ObjectTypeConfig {
            properties: Some(IndexMap::from([
                (
                    "useKnownIncompatible".to_string(),
                    TypeConfig::Hook(HookTypeConfig {
                        positional_params: Some(Vec::new()),
                        rest_param: Some(Effect::Read),
                        return_type: Box::new(TypeConfig::TypeReference(TypeReferenceConfig {
                            name: BuiltInTypeRef::Any,
                        })),
                        return_value_kind: None,
                        no_alias: None,
                        aliasing: None,
                        known_incompatible: Some(
                            "useKnownIncompatible is known to be incompatible".to_string(),
                        ),
                    }),
                ),
                (
                    "useKnownIncompatibleIndirect".to_string(),
                    TypeConfig::Hook(HookTypeConfig {
                        positional_params: Some(Vec::new()),
                        rest_param: Some(Effect::Read),
                        return_type: Box::new(TypeConfig::Object(ObjectTypeConfig {
                            properties: Some(IndexMap::from([(
                                "incompatible".to_string(),
                                TypeConfig::Function(FunctionTypeConfig {
                                    positional_params: Vec::new(),
                                    rest_param: Some(Effect::Read),
                                    callee_effect: Effect::Read,
                                    return_type: Box::new(TypeConfig::TypeReference(
                                        TypeReferenceConfig {
                                            name: BuiltInTypeRef::Any,
                                        },
                                    )),
                                    return_value_kind: ValueKind::Mutable,
                                    no_alias: None,
                                    mutable_only_if_operands_are_mutable: None,
                                    impure: None,
                                    canonical_name: None,
                                    aliasing: None,
                                    known_incompatible: Some(
                                        "useKnownIncompatibleIndirect returns an incompatible() function that is known incompatible".to_string(),
                                    ),
                                }),
                            )])),
                        })),
                        return_value_kind: None,
                        no_alias: None,
                        aliasing: None,
                        known_incompatible: None,
                    }),
                ),
                (
                    "knownIncompatible".to_string(),
                    TypeConfig::Function(FunctionTypeConfig {
                        positional_params: Vec::new(),
                        rest_param: Some(Effect::Read),
                        callee_effect: Effect::Read,
                        return_type: Box::new(TypeConfig::TypeReference(TypeReferenceConfig {
                            name: BuiltInTypeRef::Any,
                        })),
                        return_value_kind: ValueKind::Mutable,
                        no_alias: None,
                        mutable_only_if_operands_are_mutable: None,
                        impure: None,
                        canonical_name: None,
                        aliasing: None,
                        known_incompatible: Some(
                            "useKnownIncompatible is known to be incompatible".to_string(),
                        ),
                    }),
                ),
            ])),
        })),

        "useDefaultExportNotTypedAsHook" => Some(TypeConfig::Object(ObjectTypeConfig {
            properties: Some(IndexMap::from([(
                "default".to_string(),
                TypeConfig::TypeReference(TypeReferenceConfig {
                    name: BuiltInTypeRef::Any,
                }),
            )])),
        })),

        "react-hook-form" => Some(TypeConfig::Object(ObjectTypeConfig {
            properties: Some(IndexMap::from([(
                "useForm".to_string(),
                TypeConfig::Hook(HookTypeConfig {
                    return_type: Box::new(TypeConfig::Object(ObjectTypeConfig {
                        properties: Some(IndexMap::from([(
                            "watch".to_string(),
                            TypeConfig::Function(FunctionTypeConfig {
                                positional_params: Vec::new(),
                                rest_param: Some(Effect::Read),
                                callee_effect: Effect::Read,
                                return_type: Box::new(TypeConfig::TypeReference(
                                    TypeReferenceConfig {
                                        name: BuiltInTypeRef::Any,
                                    },
                                )),
                                return_value_kind: ValueKind::Mutable,
                                no_alias: None,
                                mutable_only_if_operands_are_mutable: None,
                                impure: None,
                                canonical_name: None,
                                aliasing: None,
                                known_incompatible: Some(
                                    "React Hook Form's `useForm()` API returns a `watch()` function which cannot be memoized safely.".to_string(),
                                ),
                            }),
                        )])),
                    })),
                    positional_params: None,
                    rest_param: None,
                    return_value_kind: None,
                    no_alias: None,
                    aliasing: None,
                    known_incompatible: None,
                }),
            )])),
        })),

        "@tanstack/react-table" => Some(TypeConfig::Object(ObjectTypeConfig {
            properties: Some(IndexMap::from([(
                "useReactTable".to_string(),
                TypeConfig::Hook(HookTypeConfig {
                    positional_params: Some(Vec::new()),
                    rest_param: Some(Effect::Read),
                    return_type: Box::new(TypeConfig::TypeReference(TypeReferenceConfig {
                        name: BuiltInTypeRef::Any,
                    })),
                    return_value_kind: None,
                    no_alias: None,
                    aliasing: None,
                    known_incompatible: Some(
                        "TanStack Table's `useReactTable()` API returns functions that cannot be memoized safely".to_string(),
                    ),
                }),
            )])),
        })),

        "@tanstack/react-virtual" => Some(TypeConfig::Object(ObjectTypeConfig {
            properties: Some(IndexMap::from([(
                "useVirtualizer".to_string(),
                TypeConfig::Hook(HookTypeConfig {
                    positional_params: Some(Vec::new()),
                    rest_param: Some(Effect::Read),
                    return_type: Box::new(TypeConfig::TypeReference(TypeReferenceConfig {
                        name: BuiltInTypeRef::Any,
                    })),
                    return_value_kind: None,
                    no_alias: None,
                    aliasing: None,
                    known_incompatible: Some(
                        "TanStack Virtual's `useVirtualizer()` API returns functions that cannot be memoized safely".to_string(),
                    ),
                }),
            )])),
        })),

        _ => None,
    }
}
