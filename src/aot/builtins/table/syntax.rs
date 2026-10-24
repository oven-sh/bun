use super::ids::{BuiltinId, BuiltinName, CheckedJSType, LinkTimeConstant, RuntimeFunction};
use crate::ir::{Opcode, WellKnownSymbol};

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum IntrinsicPosition {
    Call,
    Value,
    Member,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PromiseStatus {
    Pending,
    Fulfilled,
    Rejected,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum DirectiveKind {
    Visibility,
    OverriddenName,
    LinkTimeConstant,
    AlwaysInline,
    Getter,
    Constructor,
    NakedConstructor,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Conversion {
    ToBoolean,
    ToNumber,
    ToNumeric,
    ToString,
    ToPropertyKey,
    ToObject,
    ToPrimitive,
    ToIntegerOrInfinity,
    ToLength,
    ToIndex,
    ToInt32,
    ToUint32,
    ToBigInt,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ErrorKind {
    TypeError,
    RangeError,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum NativeCallKind {
    Cpp,
    Rust,
    NewCppFunction,
    NewRustFunction,
    Bindgen,
}

#[derive(Copy, Clone, Debug)]
pub enum Intrinsic {
    Operation(Opcode),
    Conversion(Conversion),
    Throw(ErrorKind),
    IfAbruptCloseIterator,
    SymbolKey(WellKnownSymbol),
    HasJSType {
        first: CheckedJSType,
        last: CheckedJSType,
    },
    Builtin(BuiltinId),
    Construct(BuiltinId),
    NativeBinding(BuiltinId),
    LinkTimeConstant(LinkTimeConstant),
    NativeCall(NativeCallKind),
    IsNullish,
    IsObject,
    IsCallable,
    Undefined,
    Int(i64),
    Bool(bool),
    Double(f64),
    Call {
        is_never_inlined: bool,
    },
    Apply,
    ArrayPush,
    PutByValDirect {
        private_key: bool,
    },
    GetOwnProperty {
        private_key: bool,
    },
    ArgumentCount,
    Argument,
    PrivateGlobal,
    ReplaceablePrivateGlobal,
    PrivateName,
    LinkedFunction(RuntimeFunction),
    Directive(DirectiveKind),
    PrependArgument {
        callee: BuiltinName,
        argument: u32,
    },
    HasPromiseStatus(PromiseStatus),
    Erased,
    BundleError,
}

include!(concat!(env!("BUN_CODEGEN_DIR"), "/aot_builtin_syntax.rs"));

pub fn intrinsic_of(name: BuiltinName, position: IntrinsicPosition) -> Option<Intrinsic> {
    let key = (name, position);
    let index = INTRINSICS
        .binary_search_by_key(&key, |&(name, position, _)| (name, position))
        .ok()?;
    Some(INTRINSICS[index].2)
}

pub fn prefixed_global(name: BuiltinName) -> Option<Intrinsic> {
    let index = PREFIXED_GLOBALS
        .binary_search_by_key(&name, |&(global, _)| global)
        .ok()?;
    Some(PREFIXED_GLOBALS[index].1)
}

pub fn native_binding(
    kind: NativeCallKind,
    file: BuiltinName,
    symbol: BuiltinName,
) -> Option<Intrinsic> {
    let key = (kind, file, symbol);
    let index = NATIVE_BINDINGS
        .binary_search_by_key(&key, |&(kind, file, symbol, _)| (kind, file, symbol))
        .ok()?;
    Some(NATIVE_BINDINGS[index].3)
}

pub fn intrinsic_names() -> impl Iterator<Item = BuiltinName> {
    INTRINSICS
        .chunk_by(|left, right| left.0 == right.0)
        .map(|entries| entries[0].0)
}
