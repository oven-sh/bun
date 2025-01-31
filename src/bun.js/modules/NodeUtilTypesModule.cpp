#include "BunClientData.h"
#include "JSDOMWrapper.h"
#include "JSEventTarget.h"
#include "JavaScriptCore/CatchScope.h"
#include "_NativeModule.h"

#include "napi_external.h"
#include "webcrypto/JSCryptoKey.h"
#include "webcrypto/JSJsonWebKey.h"
#include <JavaScriptCore/AggregateError.h>
#include <JavaScriptCore/AsyncFunctionPrototype.h>
#include <JavaScriptCore/CallFrame.h>
#include <JavaScriptCore/CallFrameInlines.h>
#include <JavaScriptCore/ErrorPrototype.h>
#include <JavaScriptCore/GeneratorFunctionPrototype.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "ZigGeneratedClasses.h"

#include "NodeUtilTypesModule.h"

using namespace JSC;

#define GET_FIRST_VALUE                           \
    if (callframe->argumentCount() < 1)           \
        return JSValue::encode(jsBoolean(false)); \
    JSValue value = callframe->uncheckedArgument(0);

#define GET_FIRST_CELL                               \
    if (callframe->argumentCount() < 1)              \
        return JSValue::encode(jsBoolean(false));    \
    JSValue value = callframe->uncheckedArgument(0); \
    if (!value.isCell())                             \
        return JSValue::encode(jsBoolean(false));    \
    JSCell* cell = value.asCell();

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsExternal,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    return JSValue::encode(jsBoolean(value.inherits<Bun::NapiExternal>()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsDate, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSDateType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsArgumentsObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    if (!value.isCell())
        return JSValue::encode(jsBoolean(false));

    auto type = value.asCell()->type();
    switch (type) {
    case DirectArgumentsType:
    case ScopedArgumentsType:
    case ClonedArgumentsType:
        return JSValue::encode(jsBoolean(true));
    default:
        return JSValue::encode(jsBoolean(false));
    }

    __builtin_unreachable();
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsBigIntObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(
        jsBoolean(globalObject->bigIntObjectStructure() == cell->structure()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsBooleanObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    return JSValue::encode(
        jsBoolean(value.isCell() && value.asCell()->type() == BooleanObjectType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsNumberObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    return JSValue::encode(
        jsBoolean(value.isCell() && value.asCell()->type() == NumberObjectType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsStringObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    return JSValue::encode(jsBoolean(
        value.isCell() && (value.asCell()->type() == StringObjectType || value.asCell()->type() == DerivedStringObjectType)));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsSymbolObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL

    return JSValue::encode(
        jsBoolean(globalObject->symbolObjectStructure() == cell->structure()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsError,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    if (value.isCell()) {
        if (value.inherits<JSC::ErrorInstance>() || value.asCell()->type() == ErrorInstanceType)
            return JSValue::encode(jsBoolean(true));

        VM& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSObject* object = value.toObject(globalObject);

        // node util.isError relies on toString
        // https://github.com/nodejs/node/blob/cf8c6994e0f764af02da4fa70bc5962142181bf3/doc/api/util.md#L2923
        // util.isError is deprecated and removed in node 23
        PropertySlot slot(object, PropertySlot::InternalMethodType::VMInquiry, &vm);
        if (object->getPropertySlot(globalObject,
                vm.propertyNames->toStringTagSymbol, slot)) {
            EXCEPTION_ASSERT(!scope.exception());
            if (slot.isValue()) {
                JSValue value = slot.getValue(globalObject, vm.propertyNames->toStringTagSymbol);
                if (value.isString()) {
                    String tag = asString(value)->value(globalObject);
                    if (UNLIKELY(scope.exception()))
                        scope.clearException();
                    if (tag == "Error"_s)
                        return JSValue::encode(jsBoolean(true));
                }
            }
        }

        JSValue proto = object->getPrototype(vm, globalObject);
        if (proto.isCell() && (proto.inherits<JSC::ErrorInstance>() || proto.asCell()->type() == ErrorInstanceType || proto.inherits<JSC::ErrorPrototype>()))
            return JSValue::encode(jsBoolean(true));
    }

    return JSValue::encode(jsBoolean(false));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsNativeError,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    if (value.isCell()) {
        JSCell* cell = value.asCell();
        if (cell->type() == ErrorInstanceType)
            return JSValue::encode(jsBoolean(true));

        // Workaround for https://github.com/oven-sh/bun/issues/11780
        // They have code that does
        //      assert(util.types.isNativeError(resolveMessage))
        // FIXME: delete this once ResolveMessage and BuildMessage extend Error
        if (cell->inherits<WebCore::JSResolveMessage>() || cell->inherits<WebCore::JSBuildMessage>())
            return JSValue::encode(jsBoolean(true));
    }

    return JSValue::encode(jsBoolean(false));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsRegExp,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    return JSValue::encode(
        jsBoolean(value.isCell() && value.asCell()->type() == RegExpObjectType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsAsyncFunction,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE

    auto* function = jsDynamicCast<JSFunction*>(value);
    if (!function)
        return JSValue::encode(jsBoolean(false));

    auto* executable = function->jsExecutable();
    if (!executable)
        return JSValue::encode(jsBoolean(false));

    if (executable->isAsyncGenerator()) {
        return JSValue::encode(jsBoolean(true));
    }

    auto& vm = JSC::getVM(globalObject);
    auto proto = function->getPrototype(vm, globalObject);
    if (!proto.isCell()) {
        return JSValue::encode(jsBoolean(false));
    }

    auto* protoCell = proto.asCell();
    return JSValue::encode(
        jsBoolean(protoCell->inherits<AsyncFunctionPrototype>()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsGeneratorFunction,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    auto* function = jsDynamicCast<JSFunction*>(value);
    if (!function)
        return JSValue::encode(jsBoolean(false));

    auto* executable = function->jsExecutable();
    if (!executable)
        return JSValue::encode(jsBoolean(false));

    return JSValue::encode(
        jsBoolean(executable->isGenerator() || executable->isAsyncGenerator()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsGeneratorObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL

    return JSValue::encode(jsBoolean(cell->type() == JSGeneratorType || cell->type() == JSAsyncGeneratorType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsPromise,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSPromiseType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsMap, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSMapType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsSet, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSSetType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsMapIterator,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSMapIteratorType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsSetIterator,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSSetIteratorType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsWeakMap,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSWeakMapType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsWeakSet,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSWeakSetType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsArrayBuffer,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    auto* arrayBuffer = jsDynamicCast<JSArrayBuffer*>(cell);
    if (!arrayBuffer)
        return JSValue::encode(jsBoolean(false));
    return JSValue::encode(jsBoolean(!arrayBuffer->isShared()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsDataView,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == DataViewType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsSharedArrayBuffer,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    auto* arrayBuffer = jsDynamicCast<JSArrayBuffer*>(cell);
    if (!arrayBuffer)
        return JSValue::encode(jsBoolean(false));
    return JSValue::encode(jsBoolean(arrayBuffer->isShared()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsProxy, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == GlobalProxyType || cell->type() == ProxyObjectType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsModuleNamespaceObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == ModuleNamespaceObjectType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsAnyArrayBuffer,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    auto* arrayBuffer = jsDynamicCast<JSArrayBuffer*>(cell);
    return JSValue::encode(jsBoolean(arrayBuffer != nullptr));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsBoxedPrimitive,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    switch (cell->type()) {
    case JSC::BooleanObjectType:
    case JSC::NumberObjectType:
    case JSC::StringObjectType:
    case JSC::DerivedStringObjectType:
        return JSValue::encode(jsBoolean(true));

    default: {
        if (cell->structure() == globalObject->symbolObjectStructure())
            return JSValue::encode(jsBoolean(true));

        if (cell->structure() == globalObject->bigIntObjectStructure())
            return JSValue::encode(jsBoolean(true));
    }
    }

    return JSValue::encode(jsBoolean(false));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsArrayBufferView,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(
        jsBoolean(cell->type() >= Int8ArrayType && cell->type() <= DataViewType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsTypedArray,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() >= Int8ArrayType && cell->type() <= BigUint64ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsUint8Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Uint8ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsUint8ClampedArray,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Uint8ClampedArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsUint16Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Uint16ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsUint32Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Uint32ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsInt8Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Int8ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsInt16Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Int16ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsInt32Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Int32ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsFloat16Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Float16ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsFloat32Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Float32ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsFloat64Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Float64ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsBigInt64Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == BigInt64ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsBigUint64Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == BigUint64ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsKeyObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL

    if (!cell->isObject()) {
        return JSValue::encode(jsBoolean(false));
    }

    auto* object = cell->getObject();

    auto& vm = JSC::getVM(globalObject);
    const auto& names = WebCore::builtinNames(vm);

    auto scope = DECLARE_CATCH_SCOPE(vm);

    if (auto val = object->getIfPropertyExists(globalObject,
            names.bunNativePtrPrivateName())) {
        if (val.isCell() && val.inherits<WebCore::JSCryptoKey>())
            return JSValue::encode(jsBoolean(true));
    }

    if (scope.exception()) {
        scope.clearException();
    }

    return JSValue::encode(jsBoolean(false));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsCryptoKey,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->inherits<WebCore::JSCryptoKey>()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsEventTarget,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->inherits<WebCore::JSEventTarget>()));
}

namespace Zig {

// Hardcoded module "node:util/types"
DEFINE_NATIVE_MODULE_NOINLINE(NodeUtilTypes)
{
    INIT_NATIVE_MODULE(44);

    putNativeFn(Identifier::fromString(vm, "isExternal"_s), jsFunctionIsExternal);
    putNativeFn(Identifier::fromString(vm, "isDate"_s), jsFunctionIsDate);
    putNativeFn(Identifier::fromString(vm, "isArgumentsObject"_s), jsFunctionIsArgumentsObject);
    putNativeFn(Identifier::fromString(vm, "isBigIntObject"_s), jsFunctionIsBigIntObject);
    putNativeFn(Identifier::fromString(vm, "isBooleanObject"_s), jsFunctionIsBooleanObject);
    putNativeFn(Identifier::fromString(vm, "isNumberObject"_s), jsFunctionIsNumberObject);
    putNativeFn(Identifier::fromString(vm, "isStringObject"_s), jsFunctionIsStringObject);
    putNativeFn(Identifier::fromString(vm, "isSymbolObject"_s), jsFunctionIsSymbolObject);
    putNativeFn(Identifier::fromString(vm, "isNativeError"_s), jsFunctionIsNativeError);
    putNativeFn(Identifier::fromString(vm, "isRegExp"_s), jsFunctionIsRegExp);
    putNativeFn(Identifier::fromString(vm, "isAsyncFunction"_s), jsFunctionIsAsyncFunction);
    putNativeFn(Identifier::fromString(vm, "isGeneratorFunction"_s), jsFunctionIsGeneratorFunction);
    putNativeFn(Identifier::fromString(vm, "isGeneratorObject"_s), jsFunctionIsGeneratorObject);
    putNativeFn(Identifier::fromString(vm, "isPromise"_s), jsFunctionIsPromise);
    putNativeFn(Identifier::fromString(vm, "isMap"_s), jsFunctionIsMap);
    putNativeFn(Identifier::fromString(vm, "isSet"_s), jsFunctionIsSet);
    putNativeFn(Identifier::fromString(vm, "isMapIterator"_s), jsFunctionIsMapIterator);
    putNativeFn(Identifier::fromString(vm, "isSetIterator"_s), jsFunctionIsSetIterator);
    putNativeFn(Identifier::fromString(vm, "isWeakMap"_s), jsFunctionIsWeakMap);
    putNativeFn(Identifier::fromString(vm, "isWeakSet"_s), jsFunctionIsWeakSet);
    putNativeFn(Identifier::fromString(vm, "isArrayBuffer"_s), jsFunctionIsArrayBuffer);
    putNativeFn(Identifier::fromString(vm, "isDataView"_s), jsFunctionIsDataView);
    putNativeFn(Identifier::fromString(vm, "isSharedArrayBuffer"_s), jsFunctionIsSharedArrayBuffer);
    putNativeFn(Identifier::fromString(vm, "isProxy"_s), jsFunctionIsProxy);
    putNativeFn(Identifier::fromString(vm, "isModuleNamespaceObject"_s), jsFunctionIsModuleNamespaceObject);
    putNativeFn(Identifier::fromString(vm, "isAnyArrayBuffer"_s), jsFunctionIsAnyArrayBuffer);
    putNativeFn(Identifier::fromString(vm, "isBoxedPrimitive"_s), jsFunctionIsBoxedPrimitive);
    putNativeFn(Identifier::fromString(vm, "isArrayBufferView"_s), jsFunctionIsArrayBufferView);
    putNativeFn(Identifier::fromString(vm, "isTypedArray"_s), jsFunctionIsTypedArray);
    putNativeFn(Identifier::fromString(vm, "isUint8Array"_s), jsFunctionIsUint8Array);
    putNativeFn(Identifier::fromString(vm, "isUint8ClampedArray"_s), jsFunctionIsUint8ClampedArray);
    putNativeFn(Identifier::fromString(vm, "isUint16Array"_s), jsFunctionIsUint16Array);
    putNativeFn(Identifier::fromString(vm, "isUint32Array"_s), jsFunctionIsUint32Array);
    putNativeFn(Identifier::fromString(vm, "isInt8Array"_s), jsFunctionIsInt8Array);
    putNativeFn(Identifier::fromString(vm, "isInt16Array"_s), jsFunctionIsInt16Array);
    putNativeFn(Identifier::fromString(vm, "isInt32Array"_s), jsFunctionIsInt32Array);
    putNativeFn(Identifier::fromString(vm, "isFloat16Array"_s), jsFunctionIsFloat16Array);
    putNativeFn(Identifier::fromString(vm, "isFloat32Array"_s), jsFunctionIsFloat32Array);
    putNativeFn(Identifier::fromString(vm, "isFloat64Array"_s), jsFunctionIsFloat64Array);
    putNativeFn(Identifier::fromString(vm, "isBigInt64Array"_s), jsFunctionIsBigInt64Array);
    putNativeFn(Identifier::fromString(vm, "isBigUint64Array"_s), jsFunctionIsBigUint64Array);
    putNativeFn(Identifier::fromString(vm, "isKeyObject"_s), jsFunctionIsKeyObject);
    putNativeFn(Identifier::fromString(vm, "isCryptoKey"_s), jsFunctionIsCryptoKey);
    putNativeFn(Identifier::fromString(vm, "isEventTarget"_s), jsFunctionIsEventTarget);

    RETURN_NATIVE_MODULE();
}

} // namespace Zig
