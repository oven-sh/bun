// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Type configuration types, ported from TypeSchema.ts.
//!
//! These are compile-time config descriptors used by `moduleTypeProvider`
//! and `installTypeConfig` to describe module/function/hook types. All string
//! fields are `&'static str` because every config is built from literals in
//! `globals.rs` / `default_module_type_provider.rs`; a future runtime-supplied
//! provider would need a separate owned variant.

use crate::collections::IndexMap;

use crate::hir::Effect;

/// Mirrors TS `ValueKind` enum for use in config.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValueKind {
    Mutable,
    Frozen,
    Primitive,
    MaybeFrozen,
    Global,
    Context,
}

/// Mirrors TS `ValueReason` enum for use in config.
#[derive(enumset::EnumSetType, Debug)]
pub enum ValueReason {
    KnownReturnSignature,
    State,
    ReducerState,
    Context,
    Effect,
    HookCaptured,
    HookReturn,
    Global,
    JsxCaptured,
    StoreLocal,
    ReactiveFunctionArgument,
    Other,
}

pub type ValueReasonSet = enumset::EnumSet<ValueReason>;

// =============================================================================
// Aliasing effect config types (from TypeSchema.ts)
// =============================================================================

#[derive(Debug, Clone)]
pub enum AliasingEffectConfig {
    Freeze {
        value: &'static str,
        reason: ValueReason,
    },
    Create {
        into: &'static str,
        value: ValueKind,
        reason: ValueReason,
    },
    CreateFrom {
        from: &'static str,
        into: &'static str,
    },
    Assign {
        from: &'static str,
        into: &'static str,
    },
    Alias {
        from: &'static str,
        into: &'static str,
    },
    Capture {
        from: &'static str,
        into: &'static str,
    },
    ImmutableCapture {
        from: &'static str,
        into: &'static str,
    },
    Impure {
        place: &'static str,
    },
    Mutate {
        value: &'static str,
    },
    MutateTransitiveConditionally {
        value: &'static str,
    },
    Apply {
        receiver: &'static str,
        function: &'static str,
        mutates_function: bool,
        args: Vec<ApplyArgConfig>,
        into: &'static str,
    },
}

#[derive(Debug, Clone, Copy)]
pub enum ApplyArgConfig {
    Place(&'static str),
    Spread { place: &'static str },
    Hole {},
}

/// Aliasing signature config (compile-time descriptor; not deserialized at runtime).
#[derive(Debug, Clone)]
pub struct AliasingSignatureConfig {
    pub receiver: &'static str,
    pub params: Vec<&'static str>,
    pub rest: Option<&'static str>,
    pub returns: &'static str,
    pub temporaries: Vec<&'static str>,
    pub effects: Vec<AliasingEffectConfig>,
}

// =============================================================================
// Type config (from TypeSchema.ts)
// =============================================================================

#[derive(Debug, Clone)]
pub enum TypeConfig {
    Object(ObjectTypeConfig),
    Function(FunctionTypeConfig),
    Hook(HookTypeConfig),
    TypeReference(TypeReferenceConfig),
}

#[derive(Debug, Clone)]
pub struct ObjectTypeConfig {
    pub properties: Option<IndexMap<&'static str, TypeConfig>>,
}

#[derive(Debug, Clone)]
pub struct FunctionTypeConfig {
    pub positional_params: Vec<Effect>,
    pub rest_param: Option<Effect>,
    pub callee_effect: Effect,
    pub return_type: Box<TypeConfig>,
    pub return_value_kind: ValueKind,
    pub no_alias: Option<bool>,
    pub mutable_only_if_operands_are_mutable: Option<bool>,
    pub impure: Option<bool>,
    pub canonical_name: Option<&'static str>,
    pub aliasing: Option<AliasingSignatureConfig>,
    pub known_incompatible: Option<&'static str>,
}

#[derive(Debug, Clone)]
pub struct HookTypeConfig {
    pub positional_params: Option<Vec<Effect>>,
    pub rest_param: Option<Effect>,
    pub return_type: Box<TypeConfig>,
    pub return_value_kind: Option<ValueKind>,
    pub no_alias: Option<bool>,
    pub aliasing: Option<AliasingSignatureConfig>,
    pub known_incompatible: Option<&'static str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuiltInTypeRef {
    Any,
    Ref,
    Array,
    Primitive,
    MixedReadonly,
}

#[derive(Debug, Clone)]
pub struct TypeReferenceConfig {
    pub name: BuiltInTypeRef,
}
