#include "root.h"
#include "node_util_types.h"

#include "webcrypto/JSCryptoKey.h"
#include "napi_external.h"
#include "JavaScriptCore/CallFrame.h"
#include "JavaScriptCore/CallFrameInlines.h"
#include "JavaScriptCore/AggregateError.h"
#include "JavaScriptCore/JSArrayBuffer.h"
#include "webcrypto/JSJsonWebKey.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/GeneratorFunctionPrototype.h"
#include "JavaScriptCore/AsyncFunctionPrototype.h"
#include "JavaScriptCore/ErrorPrototype.h"

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

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsExternal, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    return JSValue::encode(jsBoolean(value.isCell() && jsDynamicCast<Bun::NapiExternal*>(value) != nullptr));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsDate, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSDateType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsArgumentsObject, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
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
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsBigIntObject, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(globalObject->bigIntObjectStructure() == cell->structure()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsBooleanObject, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    return JSValue::encode(jsBoolean(value.isCell() && value.asCell()->type() == BooleanObjectType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsNumberObject, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    return JSValue::encode(jsBoolean(value.isCell() && value.asCell()->type() == NumberObjectType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsStringObject, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    return JSValue::encode(jsBoolean(value.isCell() && (value.asCell()->type() == StringObjectType || value.asCell()->type() == DerivedStringObjectType)));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsSymbolObject, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL

    return JSValue::encode(jsBoolean(globalObject->symbolObjectStructure() == cell->structure()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsNativeError, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
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
        PropertySlot slot(object, PropertySlot::InternalMethodType::VMInquiry, &vm);
        if (object->getPropertySlot(globalObject, vm.propertyNames->toStringTagSymbol, slot)) {
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
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsRegExp, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    return JSValue::encode(jsBoolean(value.isCell() && value.asCell()->type() == RegExpObjectType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsAsyncFunction, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(JSValue::strictEqual(globalObject, JSValue(globalObject->asyncFunctionPrototype()), cell->getObject()->getPrototype(cell->getObject(), globalObject))));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsGeneratorFunction, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    auto* function = jsDynamicCast<JSFunction*>(value);
    if (!function)
        return JSValue::encode(jsBoolean(false));

    auto* executable = function->jsExecutable();
    if (!executable)
        return JSValue::encode(jsBoolean(false));

    return JSValue::encode(jsBoolean(executable->isGenerator()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsGeneratorObject, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL

    return JSValue::encode(jsBoolean(cell->type() == JSGeneratorType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsPromise, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
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
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsMapIterator, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSMapIteratorType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsSetIterator, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSSetIteratorType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsWeakMap, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSWeakMapType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsWeakSet, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSWeakSetType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsArrayBuffer, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(jsDynamicCast<JSArrayBuffer*>(cell) != nullptr));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsDataView, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == DataViewType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsSharedArrayBuffer, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
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
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsModuleNamespaceObject, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == ModuleNamespaceObjectType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsAnyArrayBuffer, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    auto* arrayBuffer = jsDynamicCast<JSArrayBuffer*>(cell);
    return JSValue::encode(jsBoolean(arrayBuffer != nullptr));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsBoxedPrimitive, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
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
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsArrayBufferView, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() >= Int8ArrayType && cell->type() <= DataViewType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsTypedArray, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() >= Int8ArrayType && cell->type() <= BigUint64ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsUint8Array, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Uint8ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsUint8ClampedArray, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Uint8ClampedArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsUint16Array, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Uint16ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsUint32Array, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Uint32ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsInt8Array, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Int8ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsInt16Array, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Int16ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsInt32Array, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Int32ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsFloat32Array, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Float32ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsFloat64Array, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Float64ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsBigInt64Array, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == BigInt64ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsBigUint64Array, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == BigUint64ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsKeyObject, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    // Not implemented
    return JSValue::encode(jsBoolean(false));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsCryptoKey, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->inherits<WebCore::JSCryptoKey>()));
}

namespace Bun {
JSC::JSValue generateNodeUtilTypesSourceCode(JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::Identifier moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);

    JSC::VM& vm = globalObject->vm();

    JSC::JSObject* defaultObject = constructEmptyObject(globalObject, globalObject->objectPrototype(), 43);
    exportNames.reserveCapacity(43);
    exportValues.ensureCapacity(43);

    auto putBoth = [&](JSC::Identifier identifier, NativeFunction functionPtr) {
        JSC::JSFunction* function = JSC::JSFunction::create(vm, globalObject, 1, identifier.string(), functionPtr, ImplementationVisibility::Public, NoIntrinsic, functionPtr);
        defaultObject->putDirect(vm, identifier, function, 0);
        exportNames.append(identifier);
        exportValues.append(function);
    };

    putBoth(Identifier::fromString(vm, "isExternal"_s), jsFunctionIsExternal);
    putBoth(Identifier::fromString(vm, "isDate"_s), jsFunctionIsDate);
    putBoth(Identifier::fromString(vm, "isArgumentsObject"_s), jsFunctionIsArgumentsObject);
    putBoth(Identifier::fromString(vm, "isBigIntObject"_s), jsFunctionIsBigIntObject);
    putBoth(Identifier::fromString(vm, "isBooleanObject"_s), jsFunctionIsBooleanObject);
    putBoth(Identifier::fromString(vm, "isNumberObject"_s), jsFunctionIsNumberObject);
    putBoth(Identifier::fromString(vm, "isStringObject"_s), jsFunctionIsStringObject);
    putBoth(Identifier::fromString(vm, "isSymbolObject"_s), jsFunctionIsSymbolObject);
    putBoth(Identifier::fromString(vm, "isNativeError"_s), jsFunctionIsNativeError);
    putBoth(Identifier::fromString(vm, "isRegExp"_s), jsFunctionIsRegExp);
    putBoth(Identifier::fromString(vm, "isAsyncFunction"_s), jsFunctionIsAsyncFunction);
    putBoth(Identifier::fromString(vm, "isGeneratorFunction"_s), jsFunctionIsGeneratorFunction);
    putBoth(Identifier::fromString(vm, "isGeneratorObject"_s), jsFunctionIsGeneratorObject);
    putBoth(Identifier::fromString(vm, "isPromise"_s), jsFunctionIsPromise);
    putBoth(Identifier::fromString(vm, "isMap"_s), jsFunctionIsMap);
    putBoth(Identifier::fromString(vm, "isSet"_s), jsFunctionIsSet);
    putBoth(Identifier::fromString(vm, "isMapIterator"_s), jsFunctionIsMapIterator);
    putBoth(Identifier::fromString(vm, "isSetIterator"_s), jsFunctionIsSetIterator);
    putBoth(Identifier::fromString(vm, "isWeakMap"_s), jsFunctionIsWeakMap);
    putBoth(Identifier::fromString(vm, "isWeakSet"_s), jsFunctionIsWeakSet);
    putBoth(Identifier::fromString(vm, "isArrayBuffer"_s), jsFunctionIsArrayBuffer);
    putBoth(Identifier::fromString(vm, "isDataView"_s), jsFunctionIsDataView);
    putBoth(Identifier::fromString(vm, "isSharedArrayBuffer"_s), jsFunctionIsSharedArrayBuffer);
    putBoth(Identifier::fromString(vm, "isProxy"_s), jsFunctionIsProxy);
    putBoth(Identifier::fromString(vm, "isModuleNamespaceObject"_s), jsFunctionIsModuleNamespaceObject);
    putBoth(Identifier::fromString(vm, "isAnyArrayBuffer"_s), jsFunctionIsAnyArrayBuffer);
    putBoth(Identifier::fromString(vm, "isBoxedPrimitive"_s), jsFunctionIsBoxedPrimitive);
    putBoth(Identifier::fromString(vm, "isArrayBufferView"_s), jsFunctionIsArrayBufferView);
    putBoth(Identifier::fromString(vm, "isTypedArray"_s), jsFunctionIsTypedArray);
    putBoth(Identifier::fromString(vm, "isUint8Array"_s), jsFunctionIsUint8Array);
    putBoth(Identifier::fromString(vm, "isUint8ClampedArray"_s), jsFunctionIsUint8ClampedArray);
    putBoth(Identifier::fromString(vm, "isUint16Array"_s), jsFunctionIsUint16Array);
    putBoth(Identifier::fromString(vm, "isUint32Array"_s), jsFunctionIsUint32Array);
    putBoth(Identifier::fromString(vm, "isInt8Array"_s), jsFunctionIsInt8Array);
    putBoth(Identifier::fromString(vm, "isInt16Array"_s), jsFunctionIsInt16Array);
    putBoth(Identifier::fromString(vm, "isInt32Array"_s), jsFunctionIsInt32Array);
    putBoth(Identifier::fromString(vm, "isFloat32Array"_s), jsFunctionIsFloat32Array);
    putBoth(Identifier::fromString(vm, "isFloat64Array"_s), jsFunctionIsFloat64Array);
    putBoth(Identifier::fromString(vm, "isBigInt64Array"_s), jsFunctionIsBigInt64Array);
    putBoth(Identifier::fromString(vm, "isBigUint64Array"_s), jsFunctionIsBigUint64Array);
    putBoth(Identifier::fromString(vm, "isKeyObject"_s), jsFunctionIsKeyObject);
    putBoth(Identifier::fromString(vm, "isCryptoKey"_s), jsFunctionIsCryptoKey);
    defaultObject->putDirect(vm, JSC::PropertyName(Identifier::fromUid(vm.symbolRegistry().symbolForKey("CommonJS"_s))), jsNumber(0), 0);

    exportNames.append(JSC::Identifier::fromString(vm, "default"_s));
    exportValues.append(defaultObject);
    return {};
}

}
