#pragma once

#include "root.h"

#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include "BufferEncodingType.h"
#include "JavaScriptCore/JSCJSValue.h"

namespace Bun {

namespace V {

template<typename T> JSC::EncodedJSValue validateInteger(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSC::JSValue value, JSC::JSValue name, JSC::JSValue min, JSC::JSValue max, T* out);
template<typename T> JSC::EncodedJSValue validateInteger(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSC::JSValue value, ASCIILiteral name, JSC::JSValue min, JSC::JSValue max, T* out);

JSC::EncodedJSValue validateNumber(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSC::JSValue value, JSC::JSValue name, JSC::JSValue min, JSC::JSValue max);
JSC::EncodedJSValue validateNumber(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, ASCIILiteral name, JSValue min, JSValue max);
JSC::EncodedJSValue validateFiniteNumber(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSC::JSValue number, JSC::JSValue name);
JSC::EncodedJSValue validateString(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, ASCIILiteral name);
JSC::EncodedJSValue validateArray(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, JSValue name, JSValue minLength);
JSC::EncodedJSValue validateArray(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, ASCIILiteral name, JSValue minLength);
JSC::EncodedJSValue validateUint32(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, JSValue name, JSValue positive, uint32_t* out = nullptr);
JSC::EncodedJSValue validateUint32(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, ASCIILiteral name, JSValue positive, uint32_t* out = nullptr);
JSC::EncodedJSValue validateInt32(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, JSValue name, JSValue min, JSValue max);
JSC::EncodedJSValue validateInt32(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, ASCIILiteral name, JSValue min, JSValue max, int32_t* out = nullptr);
JSC::EncodedJSValue validateFunction(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, ASCIILiteral name);
JSC::EncodedJSValue validateOneOf(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, ASCIILiteral name, JSValue value, std::span<const int32_t> oneOf, int32_t* out = nullptr);
JSC::EncodedJSValue validateObject(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, ASCIILiteral name);
JSC::EncodedJSValue validateBoolean(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, ASCIILiteral name);

}

}
