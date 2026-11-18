//! What an `@name` means in the source of a built-in, besides the intrinsics of the bytecode generator and the slots
//! of the realm.

use bun_engine_bytecode::BuiltinValue::{self, Double, Int32, ShapeFlagsTest};
use bun_engine_bytecode::ResumeMode;
use bun_engine_text::{MAX_ARRAY_INDEX, MAX_LENGTH, PropertyName, private_names};

use crate::{
    CellType, IterationKind, JsArrayIterator, JsIteratorHelper, JsWrapForValidIterator,
    MAX_SAFE_INTEGER, ProxyObject, ShapeFlags,
};

const fn is(cell_type: CellType) -> BuiltinValue {
    BuiltinValue::CellTest(bun_engine_bytecode::CellType(cell_type.0))
}

macro_rules! builtin_values {
    ($($name:ident = $value:expr,)*) => {
        pub(super) const BUILTIN_VALUES: &[(PropertyName<'static>, BuiltinValue)] =
            &[$((private_names::$name, $value),)*];
    };
}

builtin_values! {
    isArrayIterator = is(CellType::ArrayIterator),
    isAsyncDisposableStack = is(CellType::AsyncDisposableStack),
    isDerivedArray = is(CellType::DerivedArray),
    isDisposableStack = is(CellType::DisposableStack),
    isGenerator = is(CellType::Generator),
    isIteratorHelper = is(CellType::IteratorHelper),
    isJSArray = is(CellType::Array),
    isMap = is(CellType::Map),
    isPromise = is(CellType::Promise),
    isProxyObject = is(CellType::Proxy),
    isRegExpObject = is(CellType::RegExpObject),
    isSet = is(CellType::Set),
    isShadowRealm = is(CellType::ShadowRealm),
    isWrapForValidIterator = is(CellType::WrapForValidIterator),

    MAX_ARRAY_INDEX = Double(MAX_ARRAY_INDEX as f64),
    MAX_SAFE_INTEGER = Double(MAX_SAFE_INTEGER),
    MAX_STRING_LENGTH = Int32(MAX_LENGTH as i32),

    GeneratorResumeModeNormal = Int32(ResumeMode::Normal as i32),
    GeneratorResumeModeReturn = Int32(ResumeMode::Return as i32),
    GeneratorResumeModeThrow = Int32(ResumeMode::Throw as i32),
    GeneratorStateInit = Int32(crate::CoroutineState::SuspendedStart as i32),
    GeneratorStateDelegate = Int32(crate::CoroutineState::SuspendedDelegate as i32),
    GeneratorStateExecuting = Int32(crate::CoroutineState::Executing as i32),
    GeneratorStateCompleted = Int32(crate::CoroutineState::Completed as i32),
    generatorFieldState = Int32(crate::Coroutine::STATE_FIELD as i32),

    iterationKindKey = Int32(IterationKind::Keys as i32),
    iterationKindValue = Int32(IterationKind::Values as i32),
    iterationKindEntries = Int32(IterationKind::Entries as i32),
    arrayIteratorFieldIndex = Int32(JsArrayIterator::INDEX as i32),
    arrayIteratorFieldIteratedObject = Int32(JsArrayIterator::ITERATED_OBJECT as i32),
    arrayIteratorFieldKind = Int32(JsArrayIterator::KIND as i32),
    iteratorHelperFieldGenerator = Int32(JsIteratorHelper::GENERATOR as i32),
    iteratorHelperFieldUnderlyingIterator = Int32(JsIteratorHelper::UNDERLYING_ITERATOR as i32),
    wrapForValidIteratorFieldIteratedIterator = Int32(JsWrapForValidIterator::ITERATOR as i32),
    wrapForValidIteratorFieldIteratedNextMethod = Int32(JsWrapForValidIterator::NEXT_METHOD as i32),

    proxyFieldTarget = Int32(ProxyObject::TARGET_FIELD as i32),
    proxyFieldHandler = Int32(ProxyObject::HANDLER_FIELD as i32),
    mustValidateResultOfProxyGetAndSetTraps =
        ShapeFlagsTest(ShapeFlags::BINDS_GET_AND_SET_TRAPS.bits()),
    mustValidateResultOfProxyTrapsExceptGetAndSet =
        ShapeFlagsTest(ShapeFlags::BINDS_OTHER_TRAPS.bits()),
}
