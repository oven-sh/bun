// clang-format off
// This file used to be generated but now in hard coded.
#pragma once

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

#define AUTO_EXTERN_C extern "C"
#ifdef WIN32
  #define AUTO_EXTERN_C_ZIG extern "C"
#else
  #define AUTO_EXTERN_C_ZIG extern "C" __attribute__((weak))
#endif

#define ZIG_DECL AUTO_EXTERN_C_ZIG
#define CPP_DECL AUTO_EXTERN_C
#define CPP_SIZE AUTO_EXTERN_C

#include "root.h"
#include <JavaScriptCore/JSClassRef.h>
#include "headers-handwritten.h"
#include "webcore/WebSocketDeflate.h"

namespace JSC {
class JSGlobalObject;
class Exception;
class JSObject;
class JSInternalPromise;
class JSString;
class JSCell;
class JSMap;
class JSPromise;
class TopExceptionScope;
class VM;
class ThrowScope;
class CallFrame;
}
namespace WebCore {
class FetchHeaders;
class DOMFormData;
class AbortSignal;
class DOMURL;
}

#pragma mark - JSC::JSObject

CPP_DECL JSC::EncodedJSValue JSC__JSObject__create(JSC::JSGlobalObject* arg0, size_t arg1, void* arg2, void(* ArgFn3)(void* arg0, JSC::JSObject* arg1, JSC::JSGlobalObject* arg2));
CPP_DECL size_t JSC__JSObject__getArrayLength(JSC::JSObject* arg0);
CPP_DECL JSC::EncodedJSValue JSC__JSObject__getDirect(JSC::JSObject* arg0, JSC::JSGlobalObject* arg1, const ZigString* arg2);
CPP_DECL JSC::EncodedJSValue JSC__JSObject__getIndex(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, uint32_t arg2);
CPP_DECL void JSC__JSObject__putRecord(JSC::JSObject* arg0, JSC::JSGlobalObject* arg1, ZigString* arg2, ZigString* arg3, size_t arg4);
CPP_DECL JSC::EncodedJSValue ZigString__external(const ZigString* arg0, JSC::JSGlobalObject* arg1, void* arg2, void(* ArgFn3)(void* arg0, void* arg1, size_t arg2));
CPP_DECL JSC::EncodedJSValue ZigString__to16BitValue(const ZigString* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL JSC::EncodedJSValue ZigString__toAtomicValue(const ZigString* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL JSC::EncodedJSValue ZigString__toErrorInstance(const ZigString* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL JSC::EncodedJSValue ZigString__toExternalU16(const uint16_t* arg0, size_t arg1, JSC::JSGlobalObject* arg2);
CPP_DECL JSC::EncodedJSValue ZigString__toExternalValue(const ZigString* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL JSC::EncodedJSValue ZigString__toExternalValueWithCallback(const ZigString* arg0, JSC::JSGlobalObject* arg1, void(* ArgFn2)(void* arg0, void* arg1, size_t arg2));
CPP_DECL JSC::EncodedJSValue ZigString__toRangeErrorInstance(const ZigString* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL JSC::EncodedJSValue ZigString__toSyntaxErrorInstance(const ZigString* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL JSC::EncodedJSValue ZigString__toTypeErrorInstance(const ZigString* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL JSC::EncodedJSValue ZigString__toValueGC(const ZigString* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL WebCore::DOMURL* WebCore__DOMURL__cast_(JSC::EncodedJSValue JSValue0, JSC::VM* arg1);
CPP_DECL BunString WebCore__DOMURL__fileSystemPath(WebCore::DOMURL* arg0, int* errorCode);
CPP_DECL void WebCore__DOMURL__href_(WebCore::DOMURL* arg0, ZigString* arg1);
CPP_DECL void WebCore__DOMURL__pathname_(WebCore::DOMURL* arg0, ZigString* arg1);

#pragma mark - WebCore::DOMFormData

CPP_DECL void WebCore__DOMFormData__append(WebCore::DOMFormData* arg0, ZigString* arg1, ZigString* arg2);
CPP_DECL void WebCore__DOMFormData__appendBlob(WebCore::DOMFormData* arg0, JSC::JSGlobalObject* arg1, ZigString* arg2, void* arg3, ZigString* arg4);
CPP_DECL size_t WebCore__DOMFormData__count(WebCore::DOMFormData* arg0);
CPP_DECL JSC::EncodedJSValue WebCore__DOMFormData__create(JSC::JSGlobalObject* arg0);
CPP_DECL JSC::EncodedJSValue WebCore__DOMFormData__createFromURLQuery(JSC::JSGlobalObject* arg0, ZigString* arg1);
CPP_DECL WebCore::DOMFormData* _fromJS(JSC::EncodedJSValue JSValue0);

#pragma mark - WebCore::FetchHeaders

CPP_DECL void WebCore__FetchHeaders__append(WebCore::FetchHeaders* arg0, const ZigString* arg1, const ZigString* arg2, JSC::JSGlobalObject* arg3);
CPP_DECL WebCore::FetchHeaders* WebCore__FetchHeaders__cast_(JSC::EncodedJSValue JSValue0, JSC::VM* arg1);
CPP_DECL JSC::EncodedJSValue WebCore__FetchHeaders__clone(WebCore::FetchHeaders* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL WebCore::FetchHeaders* WebCore__FetchHeaders__cloneThis(WebCore::FetchHeaders* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL void WebCore__FetchHeaders__copyTo(WebCore::FetchHeaders* arg0, StringPointer* arg1, StringPointer* arg2, unsigned char* arg3);
CPP_DECL void WebCore__FetchHeaders__count(WebCore::FetchHeaders* arg0, uint32_t* arg1, uint32_t* arg2);
CPP_DECL WebCore::FetchHeaders* WebCore__FetchHeaders__createEmpty();
CPP_DECL WebCore::FetchHeaders* WebCore__FetchHeaders__createFromJS(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);
CPP_DECL WebCore::FetchHeaders* WebCore__FetchHeaders__createFromPicoHeaders_(const void* arg0);
CPP_DECL WebCore::FetchHeaders* WebCore__FetchHeaders__createFromUWS(void* arg1);
CPP_DECL JSC::EncodedJSValue WebCore__FetchHeaders__createValue(JSC::JSGlobalObject* arg0, StringPointer* arg1, StringPointer* arg2, const ZigString* arg3, uint32_t arg4);
CPP_DECL void WebCore__FetchHeaders__deref(WebCore::FetchHeaders* arg0);
CPP_DECL void WebCore__FetchHeaders__fastGet_(WebCore::FetchHeaders* arg0, unsigned char arg1, ZigString* arg2);
CPP_DECL bool WebCore__FetchHeaders__fastHas_(WebCore::FetchHeaders* arg0, unsigned char arg1);
CPP_DECL void WebCore__FetchHeaders__fastRemove_(WebCore::FetchHeaders* arg0, unsigned char arg1);
CPP_DECL void WebCore__FetchHeaders__get_(WebCore::FetchHeaders* arg0, const ZigString* arg1, ZigString* arg2, JSC::JSGlobalObject* arg3);
CPP_DECL bool WebCore__FetchHeaders__has(WebCore::FetchHeaders* arg0, const ZigString* arg1, JSC::JSGlobalObject* arg2);
CPP_DECL bool WebCore__FetchHeaders__isEmpty(WebCore::FetchHeaders* arg0);
CPP_DECL void WebCore__FetchHeaders__remove(WebCore::FetchHeaders* arg0, const ZigString* arg1, JSC::JSGlobalObject* arg2);
CPP_DECL JSC::EncodedJSValue WebCore__FetchHeaders__toJS(WebCore::FetchHeaders* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL void WebCore__FetchHeaders__toUWSResponse(WebCore::FetchHeaders* arg0, bool arg1, void* arg2);
CPP_DECL JSC::EncodedJSValue SystemError__toErrorInstance(const SystemError* arg0, JSC::JSGlobalObject* arg1);

#pragma mark - JSC::JSCell

CPP_DECL JSC::JSObject* JSC__JSCell__getObject(JSC::JSCell* arg0);
CPP_DECL unsigned char JSC__JSCell__getType(JSC::JSCell* arg0);
CPP_DECL JSC::JSObject* JSC__JSCell__toObject(JSC::JSCell* cell, JSC::JSGlobalObject* globalObject);

#pragma mark - JSC::JSString

CPP_DECL bool JSC__JSString__eql(const JSC::JSString* arg0, JSC::JSGlobalObject* arg1, JSC::JSString* arg2);
CPP_DECL bool JSC__JSString__is8Bit(const JSC::JSString* arg0);
CPP_DECL void JSC__JSString__iterator(JSC::JSString* arg0, JSC::JSGlobalObject* arg1, void* arg2);
CPP_DECL size_t JSC__JSString__length(const JSC::JSString* arg0);
CPP_DECL JSC::JSObject* JSC__JSString__toObject(JSC::JSString* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL void JSC__JSString__toZigString(JSC::JSString* arg0, JSC::JSGlobalObject* arg1, ZigString* arg2);

#pragma mark - JSC::JSModuleLoader

CPP_DECL JSC::EncodedJSValue JSC__JSModuleLoader__evaluate(JSC::JSGlobalObject* arg0, const unsigned char* arg1, size_t arg2, const unsigned char* arg3, size_t arg4, const unsigned char* arg5, size_t arg6, JSC::EncodedJSValue JSValue7, JSC::EncodedJSValue* arg8);
CPP_DECL JSC::JSInternalPromise* JSC__JSModuleLoader__loadAndEvaluateModule(JSC::JSGlobalObject* arg0, const BunString* arg1);

#pragma mark - WebCore::AbortSignal

CPP_DECL bool WebCore__AbortSignal__aborted(WebCore::AbortSignal* arg0);
CPP_DECL JSC::EncodedJSValue WebCore__AbortSignal__abortReason(WebCore::AbortSignal* arg0);
CPP_DECL WebCore::AbortSignal* WebCore__AbortSignal__addListener(WebCore::AbortSignal* arg0, void* arg1, void(* ArgFn2)(void* arg0, JSC::EncodedJSValue JSValue1));
CPP_DECL void WebCore__AbortSignal__cleanNativeBindings(WebCore::AbortSignal* arg0, void* arg1);
CPP_DECL JSC::EncodedJSValue WebCore__AbortSignal__create(JSC::JSGlobalObject* arg0);
CPP_DECL WebCore::AbortSignal* WebCore__AbortSignal__fromJS(JSC::EncodedJSValue JSValue0);
CPP_DECL WebCore::AbortSignal* WebCore__AbortSignal__ref(WebCore::AbortSignal* arg0);
CPP_DECL WebCore::AbortSignal* WebCore__AbortSignal__signal(WebCore::AbortSignal* arg0, JSC::JSGlobalObject*,  uint8_t abortReason);
CPP_DECL JSC::EncodedJSValue WebCore__AbortSignal__toJS(WebCore::AbortSignal* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL void WebCore__AbortSignal__unref(WebCore::AbortSignal* arg0);

#pragma mark - JSC::JSPromise

CPP_DECL JSC::EncodedJSValue JSC__JSPromise__asValue(JSC::JSPromise* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL JSC::JSPromise* JSC__JSPromise__create(JSC::JSGlobalObject* arg0);
CPP_DECL bool JSC__JSPromise__isHandled(const JSC::JSPromise* arg0);
CPP_DECL void JSC__JSPromise__reject(JSC::JSPromise* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2);
CPP_DECL void JSC__JSPromise__rejectAsHandled(JSC::JSPromise* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2);
CPP_DECL JSC::JSPromise* JSC__JSPromise__rejectedPromise(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);
CPP_DECL JSC::EncodedJSValue JSC__JSPromise__rejectedPromiseValue(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);
CPP_DECL void JSC__JSPromise__rejectOnNextTickWithHandled(JSC::JSPromise* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2, bool arg3);
CPP_DECL void JSC__JSPromise__resolve(JSC::JSPromise* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2);
CPP_DECL JSC::JSPromise* JSC__JSPromise__resolvedPromise(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);
CPP_DECL JSC::EncodedJSValue JSC__JSPromise__resolvedPromiseValue(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);
CPP_DECL JSC::EncodedJSValue JSC__JSPromise__result(JSC::JSPromise* arg0, JSC::VM* arg1);
CPP_DECL void JSC__JSPromise__setHandled(JSC::JSPromise* arg0);
CPP_DECL uint32_t JSC__JSPromise__status(const JSC::JSPromise* arg0);

#pragma mark - JSC::JSInternalPromise

CPP_DECL JSC::JSInternalPromise* JSC__JSInternalPromise__create(JSC::JSGlobalObject* arg0);
CPP_DECL bool JSC__JSInternalPromise__isHandled(const JSC::JSInternalPromise* arg0);
CPP_DECL void JSC__JSInternalPromise__reject(JSC::JSInternalPromise* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2);
CPP_DECL void JSC__JSInternalPromise__rejectAsHandled(JSC::JSInternalPromise* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2);
CPP_DECL void JSC__JSInternalPromise__rejectAsHandledException(JSC::JSInternalPromise* arg0, JSC::JSGlobalObject* arg1, JSC::Exception* arg2);
CPP_DECL JSC::JSInternalPromise* JSC__JSInternalPromise__rejectedPromise(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);
CPP_DECL void JSC__JSInternalPromise__resolve(JSC::JSInternalPromise* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2);
CPP_DECL JSC::JSInternalPromise* JSC__JSInternalPromise__resolvedPromise(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);
CPP_DECL JSC::EncodedJSValue JSC__JSInternalPromise__result(const JSC::JSInternalPromise* arg0);
CPP_DECL void JSC__JSInternalPromise__setHandled(JSC::JSInternalPromise* arg0, JSC::VM* arg1);
CPP_DECL uint32_t JSC__JSInternalPromise__status(const JSC::JSInternalPromise* arg0);

#pragma mark - JSC::JSFunction

CPP_DECL void JSC__JSFunction__optimizeSoon(JSC::EncodedJSValue JSValue0);

#pragma mark - JSC::JSGlobalObject

CPP_DECL VirtualMachine* JSC__JSGlobalObject__bunVM(JSC::JSGlobalObject* arg0);
CPP_DECL JSC::EncodedJSValue JSC__JSGlobalObject__createAggregateError(JSC::JSGlobalObject* arg0, const JSC::JSValue* arg1, size_t arg2, const ZigString* arg3);
CPP_DECL void JSC__JSGlobalObject__createSyntheticModule_(JSC::JSGlobalObject* arg0, ZigString* arg1, size_t arg2, JSC::EncodedJSValue* arg3, size_t arg4);
CPP_DECL void JSC__JSGlobalObject__deleteModuleRegistryEntry(JSC::JSGlobalObject* arg0, ZigString* arg1);
CPP_DECL JSC::EncodedJSValue JSC__JSGlobalObject__generateHeapSnapshot(JSC::JSGlobalObject* arg0);
CPP_DECL JSC::EncodedJSValue JSC__JSGlobalObject__getCachedObject(JSC::JSGlobalObject* arg0, const ZigString* arg1);
CPP_DECL void JSC__JSGlobalObject__handleRejectedPromises(JSC::JSGlobalObject* arg0);
CPP_DECL JSC::EncodedJSValue JSC__JSGlobalObject__putCachedObject(JSC::JSGlobalObject* arg0, const ZigString* arg1, JSC::EncodedJSValue JSValue2);
CPP_DECL void JSC__JSGlobalObject__addGc(JSC::JSGlobalObject* globalObject);
CPP_DECL void JSC__JSGlobalObject__queueMicrotaskJob(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue JSValue2, JSC::EncodedJSValue JSValue3);
CPP_DECL void JSC__JSGlobalObject__reload(JSC::JSGlobalObject* arg0);
CPP_DECL JSC::VM* JSC__JSGlobalObject__vm(JSC::JSGlobalObject* arg0);

#pragma mark - JSC::JSMap

CPP_DECL JSC::EncodedJSValue JSC__JSMap__create(JSC::JSGlobalObject* arg0);
CPP_DECL JSC::EncodedJSValue JSC__JSMap__get(JSC::JSMap* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2);
CPP_DECL bool JSC__JSMap__has(JSC::JSMap* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2);
CPP_DECL bool JSC__JSMap__remove(JSC::JSMap* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2);
CPP_DECL void JSC__JSMap__set(JSC::JSMap* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2, JSC::EncodedJSValue JSValue3);
CPP_DECL uint32_t JSC__JSMap__size(JSC::JSMap* arg0, JSC::JSGlobalObject* arg1);

#pragma mark - JSC::JSValue

CPP_DECL void JSC__JSValue__then(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2, SYSV_ABI JSC::EncodedJSValue(* ArgFn3)(JSC::JSGlobalObject* arg0, JSC::CallFrame* arg1), SYSV_ABI JSC::EncodedJSValue(* ArgFn4)(JSC::JSGlobalObject* arg0, JSC::CallFrame* arg1));
CPP_DECL bool JSC__JSValue__asArrayBuffer(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, Bun__ArrayBuffer* arg2);
CPP_DECL unsigned char JSC__JSValue__asBigIntCompare(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2);
CPP_DECL JSC::JSInternalPromise* JSC__JSValue__asInternalPromise(JSC::EncodedJSValue JSValue0);
CPP_DECL JSC::JSPromise* JSC__JSValue__asPromise(JSC::EncodedJSValue JSValue0);
CPP_DECL JSC::JSString* JSC__JSValue__asString(JSC::EncodedJSValue JSValue0);
CPP_DECL int32_t JSC__JSValue__coerceToInt32(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1);
CPP_DECL int64_t JSC__JSValue__coerceToInt64(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__createEmptyArray(JSC::JSGlobalObject* arg0, size_t arg1);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__createEmptyObject(JSC::JSGlobalObject* arg0, size_t arg1);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__createInternalPromise(JSC::JSGlobalObject* arg0);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__createObject2(JSC::JSGlobalObject* arg0, const ZigString* arg1, const ZigString* arg2, JSC::EncodedJSValue JSValue3, JSC::EncodedJSValue JSValue4);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__createRangeError(const ZigString* arg0, const ZigString* arg1, JSC::JSGlobalObject* arg2);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__createRopeString(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* arg2);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__createStringArray(JSC::JSGlobalObject* arg0, const ZigString* arg1, size_t arg2, bool arg3);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__createTypeError(const ZigString* arg0, const ZigString* arg1, JSC::JSGlobalObject* arg2);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__createUninitializedUint8Array(JSC::JSGlobalObject* arg0, size_t arg1);
CPP_DECL bool JSC__JSValue__deepEquals(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* arg2);
CPP_DECL bool JSC__JSValue__eqlCell(JSC::EncodedJSValue JSValue0, JSC::JSCell* arg1);
CPP_DECL bool JSC__JSValue__eqlValue(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__fastGet(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, unsigned char arg2);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__fastGetDirect_(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, unsigned char arg2);
CPP_DECL void JSC__JSValue__forEach(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, void* arg2, void(* ArgFn3)(JSC::VM* arg0, JSC::JSGlobalObject* arg1, void* arg2, JSC::EncodedJSValue JSValue3));
CPP_DECL void JSC__JSValue__forEachProperty(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, void* arg2, void(* ArgFn3)(JSC::JSGlobalObject* arg0, void* arg1, ZigString* arg2, JSC::EncodedJSValue JSValue3, bool arg4, bool arg5));
CPP_DECL void JSC__JSValue__forEachPropertyOrdered(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, void* arg2, void(* ArgFn3)(JSC::JSGlobalObject* arg0, void* arg1, ZigString* arg2, JSC::EncodedJSValue JSValue3, bool arg4, bool arg5));
CPP_DECL JSC::EncodedJSValue JSC__JSValue__fromEntries(JSC::JSGlobalObject* arg0, ZigString* arg1, ZigString* arg2, size_t arg3, bool arg4);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__fromInt64NoTruncate(JSC::JSGlobalObject* arg0, int64_t arg1);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__fromUInt64NoTruncate(JSC::JSGlobalObject* arg0, uint64_t arg1);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__fromTimevalNoTruncate(JSC::JSGlobalObject* arg0, int64_t nsec, int64_t sec);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__bigIntSum(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1);
CPP_DECL void JSC__JSValue__getClassName(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, ZigString* arg2);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__getErrorsProperty(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__getIfPropertyExistsFromPath(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2);
CPP_DECL double JSC__JSValue__getLengthIfPropertyExistsInternal(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1);
CPP_DECL void JSC__JSValue__getNameProperty(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, ZigString* arg2);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__getPrototype(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1);
CPP_DECL void JSC__JSValue__getSymbolDescription(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, ZigString* arg2);
CPP_DECL double JSC__JSValue__getUnixTimestamp(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__hasOwnProperty(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, ZigString arg2);
CPP_DECL bool JSC__JSValue__isAggregateError(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1);
CPP_DECL bool JSC__JSValue__isAnyError(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__isAnyInt(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__isBigInt(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__isBigInt32(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__isCallable(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__isClass(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1);
CPP_DECL bool JSC__JSValue__isConstructor(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__isCustomGetterSetter(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__isError(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__isException(JSC::EncodedJSValue JSValue0, JSC::VM* arg1);
CPP_DECL bool JSC__JSValue__isGetterSetter(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__isHeapBigInt(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__isInstanceOf(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2);
CPP_DECL bool JSC__JSValue__isInt32(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__isInt32AsAnyInt(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__isIterable(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1);
CPP_DECL bool JSC__JSValue__isNumber(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__isObject(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__isPrimitive(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__isSameValue(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* arg2);
CPP_DECL bool JSC__JSValue__isSymbol(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__isTerminationException(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__isUInt32AsAnyInt(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__jestDeepEquals(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* arg2);
CPP_DECL bool JSC__JSValue__jestDeepMatch(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* arg2, bool arg3);
CPP_DECL bool JSC__JSValue__jestStrictDeepEquals(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* arg2);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__jsNumberFromChar(unsigned char arg0);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__jsNumberFromDouble(double arg0);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__jsNumberFromInt64(int64_t arg0);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__jsNumberFromU16(uint16_t arg0);
CPP_DECL void JSC__JSValue__jsonStringify(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, uint32_t arg2, BunString* arg3);
CPP_DECL void JSC__JSValue__jsonStringifyFast(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, BunString* arg3);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__jsTDZValue();
CPP_DECL unsigned char JSC__JSValue__jsType(JSC::EncodedJSValue JSValue0);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__keys(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue arg1);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__values(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue arg1);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__parseJSON(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1);
CPP_DECL void JSC__JSValue__push(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2);
CPP_DECL void JSC__JSValue__put(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, const ZigString* arg2, JSC::EncodedJSValue JSValue3);
CPP_DECL void JSC__JSValue__putIndex(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, uint32_t arg2, JSC::EncodedJSValue JSValue3);
CPP_DECL void JSC__JSValue__putRecord(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, ZigString* arg2, ZigString* arg3, size_t arg4);
CPP_DECL bool JSC__JSValue__strictDeepEquals(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* arg2);
CPP_DECL bool JSC__JSValue__stringIncludes(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__symbolFor(JSC::JSGlobalObject* arg0, ZigString* arg1);
CPP_DECL bool JSC__JSValue__symbolKeyFor(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, ZigString* arg2);
CPP_DECL bool JSC__JSValue__toBoolean(JSC::EncodedJSValue JSValue0);
CPP_DECL JSC::EncodedJSValue JSC__JSValue__toError_(JSC::EncodedJSValue JSValue0);
CPP_DECL int32_t JSC__JSValue__toInt32(JSC::EncodedJSValue JSValue0);
CPP_DECL int64_t JSC__JSValue__toInt64(JSC::EncodedJSValue JSValue0);
CPP_DECL bool JSC__JSValue__toMatch(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2);
CPP_DECL JSC::JSObject* JSC__JSValue__toObject(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1);
CPP_DECL JSC::JSString* JSC__JSValue__toString(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1);
CPP_DECL JSC::JSString* JSC__JSValue__toStringOrNull(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1);
CPP_DECL uint64_t JSC__JSValue__toUInt64NoTruncate(JSC::EncodedJSValue JSValue0);
CPP_DECL void JSC__JSValue__toZigException(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, ZigException* arg2);
CPP_DECL void JSC__JSValue__toZigString(JSC::EncodedJSValue JSValue0, ZigString* arg1, JSC::JSGlobalObject* arg2);

#pragma mark - JSC::VM

CPP_DECL size_t JSC__VM__blockBytesAllocated(JSC::VM* arg0);
CPP_DECL void JSC__VM__clearExecutionTimeLimit(JSC::VM* arg0);
CPP_DECL void JSC__VM__collectAsync(JSC::VM* arg0);
CPP_DECL JSC::VM* JSC__VM__create(unsigned char HeapType0);
CPP_DECL void JSC__VM__deinit(JSC::VM* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL void JSC__VM__deleteAllCode(JSC::VM* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL void JSC__VM__drainMicrotasks(JSC::VM* arg0);
CPP_DECL bool JSC__VM__executionForbidden(JSC::VM* arg0);
CPP_DECL size_t JSC__VM__externalMemorySize(JSC::VM* arg0);
CPP_DECL size_t JSC__VM__heapSize(JSC::VM* arg0);
CPP_DECL void JSC__VM__holdAPILock(JSC::VM* arg0, void* arg1, void(* ArgFn2)(void* arg0));
CPP_DECL bool JSC__VM__isEntered(JSC::VM* arg0);
CPP_DECL bool JSC__VM__isJITEnabled();
CPP_DECL void JSC__VM__notifyNeedDebuggerBreak(JSC::VM* arg0);
CPP_DECL void JSC__VM__notifyNeedShellTimeoutCheck(JSC::VM* arg0);
CPP_DECL void JSC__VM__notifyNeedTermination(JSC::VM* arg0);
CPP_DECL void JSC__VM__notifyNeedWatchdogCheck(JSC::VM* arg0);
CPP_DECL void JSC__VM__releaseWeakRefs(JSC::VM* arg0);
CPP_DECL size_t JSC__VM__runGC(JSC::VM* arg0, bool arg1);
CPP_DECL void JSC__VM__setControlFlowProfiler(JSC::VM* arg0, bool arg1);
CPP_DECL void JSC__VM__setExecutionForbidden(JSC::VM* arg0, bool arg1);
CPP_DECL void JSC__VM__setExecutionTimeLimit(JSC::VM* arg0, double arg1);
CPP_DECL void JSC__VM__shrinkFootprint(JSC::VM* arg0);
CPP_DECL void JSC__VM__throwError(JSC::VM* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2);
CPP_DECL void JSC__VM__throwError(JSC::VM* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2);

CPP_DECL void FFI__ptr__put(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC::EncodedJSValue SYSV_ABI FFI__ptr__fastpath(JSC::JSGlobalObject* arg0, void* arg1, JSC::JSUint8Array* arg2);
extern "C" JSC::EncodedJSValue SYSV_ABI FFI__ptr__slowpath(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__u8__put(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC::EncodedJSValue SYSV_ABI Reader__u8__fastpath(JSC::JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Reader__u8__slowpath(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__u16__put(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC::EncodedJSValue SYSV_ABI Reader__u16__fastpath(JSC::JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Reader__u16__slowpath(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__u32__put(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC::EncodedJSValue SYSV_ABI Reader__u32__fastpath(JSC::JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Reader__u32__slowpath(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__ptr__put(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC::EncodedJSValue SYSV_ABI Reader__ptr__fastpath(JSC::JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Reader__ptr__slowpath(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__i8__put(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC::EncodedJSValue SYSV_ABI Reader__i8__fastpath(JSC::JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Reader__i8__slowpath(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__i16__put(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC::EncodedJSValue SYSV_ABI Reader__i16__fastpath(JSC::JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Reader__i16__slowpath(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__i32__put(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC::EncodedJSValue SYSV_ABI Reader__i32__fastpath(JSC::JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Reader__i32__slowpath(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__f32__put(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC::EncodedJSValue SYSV_ABI Reader__f32__fastpath(JSC::JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Reader__f32__slowpath(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__f64__put(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC::EncodedJSValue SYSV_ABI Reader__f64__fastpath(JSC::JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Reader__f64__slowpath(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__i64__put(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC::EncodedJSValue SYSV_ABI Reader__i64__fastpath(JSC::JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Reader__i64__slowpath(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__u64__put(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC::EncodedJSValue SYSV_ABI Reader__u64__fastpath(JSC::JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Reader__u64__slowpath(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__intptr__put(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC::EncodedJSValue SYSV_ABI Reader__intptr__fastpath(JSC::JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Reader__intptr__slowpath(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue* arg2, size_t arg3);

#endif

#pragma mark - Zig::GlobalObject

CPP_DECL JSC::JSGlobalObject* Zig__GlobalObject__create(void* arg0, int32_t arg1, bool arg2, bool arg3, void* arg4);
CPP_DECL void* Zig__GlobalObject__getModuleRegistryMap(JSC::JSGlobalObject* arg0);
CPP_DECL bool Zig__GlobalObject__resetModuleRegistryMap(JSC::JSGlobalObject* arg0, void* arg1);

#ifdef __cplusplus

ZIG_DECL void Zig__GlobalObject__fetch(ErrorableResolvedSource* arg0, JSC::JSGlobalObject* arg1, BunString* arg2, BunString* arg3);
ZIG_DECL void Zig__GlobalObject__onCrash();
ZIG_DECL JSC::EncodedJSValue Zig__GlobalObject__promiseRejectionTracker(JSC::JSGlobalObject* arg0, JSC::JSPromise* arg1, uint32_t JSPromiseRejectionOperation2);
ZIG_DECL JSC::EncodedJSValue Zig__GlobalObject__reportUncaughtException(JSC::JSGlobalObject* arg0, JSC::Exception* arg1);
ZIG_DECL void Zig__GlobalObject__resolve(ErrorableString* arg0, JSC::JSGlobalObject* arg1, BunString* arg2, BunString* arg3, ZigString* arg4);

#endif

#ifdef __cplusplus

extern "C" JSC::EncodedJSValue SYSV_ABI Bun__Path__basename(JSC::JSGlobalObject* arg0, bool arg1, JSC::EncodedJSValue* arg2, uint16_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Bun__Path__dirname(JSC::JSGlobalObject* arg0, bool arg1, JSC::EncodedJSValue* arg2, uint16_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Bun__Path__extname(JSC::JSGlobalObject* arg0, bool arg1, JSC::EncodedJSValue* arg2, uint16_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Bun__Path__format(JSC::JSGlobalObject* arg0, bool arg1, JSC::EncodedJSValue* arg2, uint16_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Bun__Path__isAbsolute(JSC::JSGlobalObject* arg0, bool arg1, JSC::EncodedJSValue* arg2, uint16_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Bun__Path__join(JSC::JSGlobalObject* arg0, bool arg1, JSC::EncodedJSValue* arg2, uint16_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Bun__Path__normalize(JSC::JSGlobalObject* arg0, bool arg1, JSC::EncodedJSValue* arg2, uint16_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Bun__Path__parse(JSC::JSGlobalObject* arg0, bool arg1, JSC::EncodedJSValue* arg2, uint16_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Bun__Path__relative(JSC::JSGlobalObject* arg0, bool arg1, JSC::EncodedJSValue* arg2, uint16_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Bun__Path__resolve(JSC::JSGlobalObject* arg0, bool arg1, JSC::EncodedJSValue* arg2, uint16_t arg3);
extern "C" JSC::EncodedJSValue SYSV_ABI Bun__Path__toNamespacedPath(JSC::JSGlobalObject* arg0, bool arg1, JSC::EncodedJSValue* arg2, uint16_t arg3);

#endif

CPP_DECL JSC::EncodedJSValue ArrayBufferSink__assignToStream(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, void* arg2, void** arg3);
CPP_DECL JSC::EncodedJSValue ArrayBufferSink__createObject(JSC::JSGlobalObject* arg0, void* arg1, uintptr_t destructor);
CPP_DECL void ArrayBufferSink__detachPtr(JSC::EncodedJSValue JSValue0);
CPP_DECL void ArrayBufferSink__onClose(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1);
CPP_DECL void ArrayBufferSink__onReady(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue JSValue2);

#ifdef __cplusplus

ZIG_DECL JSC::EncodedJSValue ArrayBufferSink__close(JSC::JSGlobalObject* arg0, void* arg1);
BUN_DECLARE_HOST_FUNCTION(ArrayBufferSink__construct);
BUN_DECLARE_HOST_FUNCTION(ArrayBufferSink__end);
ZIG_DECL JSC::EncodedJSValue SYSV_ABI ArrayBufferSink__endWithSink(void* arg0, JSC::JSGlobalObject* arg1);
ZIG_DECL void ArrayBufferSink__finalize(void* arg0);
BUN_DECLARE_HOST_FUNCTION(ArrayBufferSink__flush);
BUN_DECLARE_HOST_FUNCTION(ArrayBufferSink__start);
ZIG_DECL void ArrayBufferSink__updateRef(void* arg0, bool arg1);
BUN_DECLARE_HOST_FUNCTION(ArrayBufferSink__write);

#endif
CPP_DECL JSC::EncodedJSValue HTTPSResponseSink__assignToStream(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, void* arg2, void** arg3);
CPP_DECL JSC::EncodedJSValue HTTPSResponseSink__createObject(JSC::JSGlobalObject* arg0, void* arg1, uintptr_t destructor);
CPP_DECL void HTTPSResponseSink__detachPtr(JSC::EncodedJSValue JSValue0);
CPP_DECL void HTTPSResponseSink__onClose(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1);
CPP_DECL void HTTPSResponseSink__onReady(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue JSValue2);

#ifdef __cplusplus

ZIG_DECL JSC::EncodedJSValue HTTPSResponseSink__close(JSC::JSGlobalObject* arg0, void* arg1);
BUN_DECLARE_HOST_FUNCTION(HTTPSResponseSink__construct);
BUN_DECLARE_HOST_FUNCTION(HTTPSResponseSink__end);
ZIG_DECL JSC::EncodedJSValue SYSV_ABI HTTPSResponseSink__endWithSink(void* arg0, JSC::JSGlobalObject* arg1);
ZIG_DECL void HTTPSResponseSink__finalize(void* arg0);
BUN_DECLARE_HOST_FUNCTION(HTTPSResponseSink__flush);
BUN_DECLARE_HOST_FUNCTION(HTTPSResponseSink__start);
ZIG_DECL void HTTPSResponseSink__updateRef(void* arg0, bool arg1);
BUN_DECLARE_HOST_FUNCTION(HTTPSResponseSink__write);

#endif
CPP_DECL JSC::EncodedJSValue HTTPResponseSink__assignToStream(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, void* arg2, void** arg3);
CPP_DECL JSC::EncodedJSValue HTTPResponseSink__createObject(JSC::JSGlobalObject* arg0, void* arg1, uintptr_t destructor);
CPP_DECL void HTTPResponseSink__detachPtr(JSC::EncodedJSValue JSValue0);
CPP_DECL void HTTPResponseSink__onClose(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1);
CPP_DECL void HTTPResponseSink__onReady(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue JSValue2);

#ifdef __cplusplus

ZIG_DECL JSC::EncodedJSValue HTTPResponseSink__close(JSC::JSGlobalObject* arg0, void* arg1);
BUN_DECLARE_HOST_FUNCTION(HTTPResponseSink__construct);
BUN_DECLARE_HOST_FUNCTION(HTTPResponseSink__end);
ZIG_DECL JSC::EncodedJSValue SYSV_ABI SYSV_ABI HTTPResponseSink__endWithSink(void* arg0, JSC::JSGlobalObject* arg1);
ZIG_DECL void HTTPResponseSink__finalize(void* arg0);
BUN_DECLARE_HOST_FUNCTION(HTTPResponseSink__flush);
BUN_DECLARE_HOST_FUNCTION(HTTPResponseSink__start);
ZIG_DECL void HTTPResponseSink__updateRef(void* arg0, bool arg1);
BUN_DECLARE_HOST_FUNCTION(HTTPResponseSink__write);

#endif
CPP_DECL JSC::EncodedJSValue FileSink__assignToStream(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, void* arg2, void** arg3);
CPP_DECL JSC::EncodedJSValue FileSink__createObject(JSC::JSGlobalObject* arg0, void* arg1, uintptr_t destructor);
CPP_DECL void FileSink__detachPtr(JSC::EncodedJSValue JSValue0);
CPP_DECL void FileSink__onClose(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1);
CPP_DECL void FileSink__onReady(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue JSValue2);

#ifdef __cplusplus

ZIG_DECL JSC::EncodedJSValue FileSink__close(JSC::JSGlobalObject* arg0, void* arg1);
BUN_DECLARE_HOST_FUNCTION(FileSink__construct);
BUN_DECLARE_HOST_FUNCTION(FileSink__end);
ZIG_DECL JSC::EncodedJSValue SYSV_ABI FileSink__endWithSink(void* arg0, JSC::JSGlobalObject* arg1);
ZIG_DECL void FileSink__finalize(void* arg0);
BUN_DECLARE_HOST_FUNCTION(FileSink__flush);
BUN_DECLARE_HOST_FUNCTION(FileSink__start);
ZIG_DECL void FileSink__updateRef(void* arg0, bool arg1);
BUN_DECLARE_HOST_FUNCTION(FileSink__write);

#endif

CPP_DECL JSC::EncodedJSValue FileSink__assignToStream(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, void* arg2, void** arg3);
CPP_DECL JSC::EncodedJSValue FileSink__createObject(JSC::JSGlobalObject* arg0, void* arg1, uintptr_t destructor);
CPP_DECL void FileSink__detachPtr(JSC::EncodedJSValue JSValue0);
CPP_DECL void FileSink__onClose(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1);
CPP_DECL void FileSink__onReady(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue JSValue2);

#ifdef __cplusplus

ZIG_DECL JSC::EncodedJSValue FileSink__close(JSC::JSGlobalObject* arg0, void* arg1);
BUN_DECLARE_HOST_FUNCTION(FileSink__construct);
BUN_DECLARE_HOST_FUNCTION(FileSink__end);
ZIG_DECL JSC::EncodedJSValue SYSV_ABI FileSink__endWithSink(void* arg0, JSC::JSGlobalObject* arg1);
ZIG_DECL void FileSink__finalize(void* arg0);
BUN_DECLARE_HOST_FUNCTION(FileSink__flush);
BUN_DECLARE_HOST_FUNCTION(FileSink__start);
ZIG_DECL void FileSink__updateRef(void* arg0, bool arg1);
BUN_DECLARE_HOST_FUNCTION(FileSink__write);

#endif
CPP_DECL JSC::EncodedJSValue NetworkSink__assignToStream(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, void* arg2, void** arg3);
CPP_DECL JSC::EncodedJSValue NetworkSink__createObject(JSC::JSGlobalObject* arg0, void* arg1, uintptr_t destructor);
CPP_DECL void NetworkSink__detachPtr(JSC::EncodedJSValue JSValue0);
CPP_DECL void* NetworkSink__fromJS(JSC::EncodedJSValue JSValue1);
CPP_DECL void NetworkSink__onClose(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1);
CPP_DECL void NetworkSink__onReady(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue JSValue2);

#ifdef __cplusplus

ZIG_DECL JSC::EncodedJSValue NetworkSink__close(JSC::JSGlobalObject* arg0, void* arg1);
BUN_DECLARE_HOST_FUNCTION(NetworkSink__construct);
BUN_DECLARE_HOST_FUNCTION(NetworkSink__end);
ZIG_DECL JSC::EncodedJSValue SYSV_ABI SYSV_ABI NetworkSink__endWithSink(void* arg0, JSC::JSGlobalObject* arg1);
ZIG_DECL void NetworkSink__finalize(void* arg0);
BUN_DECLARE_HOST_FUNCTION(NetworkSink__flush);
BUN_DECLARE_HOST_FUNCTION(NetworkSink__start);
ZIG_DECL void NetworkSink__updateRef(void* arg0, bool arg1);
BUN_DECLARE_HOST_FUNCTION(NetworkSink__write);
#endif

#ifdef __cplusplus

ZIG_DECL void Bun__WebSocketHTTPClient__cancel(WebSocketHTTPClient* arg0);
ZIG_DECL WebSocketHTTPClient* Bun__WebSocketHTTPClient__connect(
    JSC::JSGlobalObject* globalObject, void* socketContext, CppWebSocket* websocket,
    const ZigString* host, uint16_t port, const ZigString* path, const ZigString* protocols,
    ZigString* headerNames, ZigString* headerValues, size_t headerCount,
    const ZigString* proxyHost, uint16_t proxyPort,
    const ZigString* proxyAuthorization,
    ZigString* proxyHeaderNames, ZigString* proxyHeaderValues, size_t proxyHeaderCount,
    void* sslConfig, bool targetIsSecure,
    const ZigString* targetAuthorization);
ZIG_DECL void Bun__WebSocketHTTPClient__register(JSC::JSGlobalObject* arg0, void* arg1, void* arg2);
ZIG_DECL size_t Bun__WebSocketHTTPClient__memoryCost(WebSocketHTTPClient* arg0);
#endif

#ifdef __cplusplus

ZIG_DECL void Bun__WebSocketHTTPSClient__cancel(WebSocketHTTPSClient* arg0);
ZIG_DECL WebSocketHTTPSClient* Bun__WebSocketHTTPSClient__connect(
    JSC::JSGlobalObject* globalObject, void* socketContext, CppWebSocket* websocket,
    const ZigString* host, uint16_t port, const ZigString* path, const ZigString* protocols,
    ZigString* headerNames, ZigString* headerValues, size_t headerCount,
    const ZigString* proxyHost, uint16_t proxyPort,
    const ZigString* proxyAuthorization,
    ZigString* proxyHeaderNames, ZigString* proxyHeaderValues, size_t proxyHeaderCount,
    void* sslConfig, bool targetIsSecure,
    const ZigString* targetAuthorization);
ZIG_DECL void Bun__WebSocketHTTPSClient__register(JSC::JSGlobalObject* arg0, void* arg1, void* arg2);
ZIG_DECL size_t Bun__WebSocketHTTPSClient__memoryCost(WebSocketHTTPSClient* arg0);

// Parse TLS options from JavaScript object using SSLConfig.fromJS
ZIG_DECL void* Bun__WebSocket__parseSSLConfig(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue tlsValue);
#endif

#ifdef __cplusplus

ZIG_DECL void Bun__WebSocketClient__cancel(WebSocketClient* arg0);
ZIG_DECL void Bun__WebSocketClient__close(WebSocketClient* arg0, uint16_t arg1, const ZigString* arg2);
ZIG_DECL void Bun__WebSocketClient__finalize(WebSocketClient* arg0);
ZIG_DECL void* Bun__WebSocketClient__init(CppWebSocket* arg0, void* arg1, void* arg2, JSC::JSGlobalObject* arg3, unsigned char* arg4, size_t arg5, const PerMessageDeflateParams* arg6, void* customSSLCtx);
ZIG_DECL void Bun__WebSocketClient__register(JSC::JSGlobalObject* arg0, void* arg1, void* arg2);
ZIG_DECL void Bun__WebSocketClient__writeBinaryData(WebSocketClient* arg0, const unsigned char* arg1, size_t arg2, unsigned char arg3);
ZIG_DECL void Bun__WebSocketClient__writeString(WebSocketClient* arg0, const ZigString* arg1, unsigned char arg2);
ZIG_DECL size_t Bun__WebSocketClient__memoryCost(WebSocketClient* arg0);

#endif

#ifdef __cplusplus

ZIG_DECL void Bun__WebSocketClientTLS__cancel(WebSocketClientTLS* arg0);
ZIG_DECL void Bun__WebSocketClientTLS__close(WebSocketClientTLS* arg0, uint16_t arg1, const ZigString* arg2);
ZIG_DECL void Bun__WebSocketClientTLS__finalize(WebSocketClientTLS* arg0);
ZIG_DECL void* Bun__WebSocketClientTLS__init(CppWebSocket* arg0, void* arg1, void* arg2, JSC::JSGlobalObject* arg3, unsigned char* arg4, size_t arg5, const PerMessageDeflateParams* arg6, void* customSSLCtx);
ZIG_DECL void Bun__WebSocketClientTLS__register(JSC::JSGlobalObject* arg0, void* arg1, void* arg2);
ZIG_DECL void Bun__WebSocketClientTLS__writeBinaryData(WebSocketClientTLS* arg0, const unsigned char* arg1, size_t arg2, unsigned char arg3);
ZIG_DECL void Bun__WebSocketClientTLS__writeString(WebSocketClientTLS* arg0, const ZigString* arg1, unsigned char arg2);
ZIG_DECL size_t Bun__WebSocketClientTLS__memoryCost(WebSocketClientTLS* arg0);
#endif

#ifdef __cplusplus

ZIG_DECL /*[[noreturn]]*/ void Bun__Process__exit(JSC::JSGlobalObject* arg0, uint8_t arg1); // TODO(@190n) figure out why with a real [[noreturn]] annotation this trips ASan before calling the function
ZIG_DECL JSC::EncodedJSValue Bun__Process__createArgv(JSC::JSGlobalObject* arg0);
ZIG_DECL JSC::EncodedJSValue Bun__Process__createArgv0(JSC::JSGlobalObject* arg0);
ZIG_DECL JSC::EncodedJSValue Bun__Process__getCwd(JSC::JSGlobalObject* arg0);
ZIG_DECL JSC::EncodedJSValue Bun__Process__createExecArgv(JSC::JSGlobalObject* arg0);
ZIG_DECL JSC::EncodedJSValue Bun__Process__getExecPath(JSC::JSGlobalObject* arg0);
ZIG_DECL void Bun__Process__getTitle(JSC::JSGlobalObject* arg0, BunString* arg1);
ZIG_DECL void Bun__Process__setTitle(JSC::JSGlobalObject* arg0, BunString* arg1);
ZIG_DECL JSC::EncodedJSValue Bun__Process__setCwd(JSC::JSGlobalObject* arg0, ZigString* arg1);
ZIG_DECL JSC::EncodedJSValue Bun__Process__getEval(JSC::JSGlobalObject* arg0);

#endif
CPP_DECL ZigException ZigException__fromException(JSC::Exception* arg0);

#pragma mark - Bun::ConsoleObject


#ifdef __cplusplus

extern "C" SYSV_ABI void Bun__ConsoleObject__count(void* arg0, JSC::JSGlobalObject* arg1, const unsigned char* arg2, size_t arg3);
extern "C" SYSV_ABI void Bun__ConsoleObject__countReset(void* arg0, JSC::JSGlobalObject* arg1, const unsigned char* arg2, size_t arg3);
extern "C" SYSV_ABI void Bun__ConsoleObject__messageWithTypeAndLevel(void* arg0, uint32_t MessageType1, uint32_t MessageLevel2, JSC::JSGlobalObject* arg3, JSC::EncodedJSValue* arg4, size_t arg5);
extern "C" SYSV_ABI void Bun__ConsoleObject__profile(void* arg0, JSC::JSGlobalObject* arg1, const unsigned char* arg2, size_t arg3);
extern "C" SYSV_ABI void Bun__ConsoleObject__profileEnd(void* arg0, JSC::JSGlobalObject* arg1, const unsigned char* arg2, size_t arg3);
extern "C" SYSV_ABI void Bun__ConsoleObject__record(void* arg0, JSC::JSGlobalObject* arg1, ScriptArguments* arg2);
extern "C" SYSV_ABI void Bun__ConsoleObject__recordEnd(void* arg0, JSC::JSGlobalObject* arg1, ScriptArguments* arg2);
extern "C" SYSV_ABI void Bun__ConsoleObject__screenshot(void* arg0, JSC::JSGlobalObject* arg1, ScriptArguments* arg2);
extern "C" SYSV_ABI void Bun__ConsoleObject__takeHeapSnapshot(void* arg0, JSC::JSGlobalObject* arg1, const unsigned char* arg2, size_t arg3);
extern "C" SYSV_ABI void Bun__ConsoleObject__time(void* arg0, JSC::JSGlobalObject* arg1, const unsigned char* arg2, size_t arg3);
extern "C" SYSV_ABI void Bun__ConsoleObject__timeEnd(void* arg0, JSC::JSGlobalObject* arg1, const unsigned char* arg2, size_t arg3);
extern "C" SYSV_ABI void Bun__ConsoleObject__timeLog(void* arg0, JSC::JSGlobalObject* arg1, const unsigned char* arg2, size_t arg3, JSC::EncodedJSValue* arg4, size_t arg5);
extern "C" SYSV_ABI void Bun__ConsoleObject__timeStamp(void* arg0, JSC::JSGlobalObject* arg1, ScriptArguments* arg2);

#endif

#pragma mark - Bun__Timer


#ifdef __cplusplus

ZIG_DECL JSC::EncodedJSValue Bun__Timer__clearImmediate(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);
ZIG_DECL JSC::EncodedJSValue Bun__Timer__clearInterval(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);
ZIG_DECL JSC::EncodedJSValue Bun__Timer__clearTimeout(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1);
ZIG_DECL int32_t Bun__Timer__getNextID();
ZIG_DECL JSC::EncodedJSValue Bun__Timer__setInterval(JSC::JSGlobalObject* globalThis, JSC::EncodedJSValue callback, JSC::EncodedJSValue arguments, JSC::EncodedJSValue countdown);
ZIG_DECL JSC::EncodedJSValue Bun__Timer__setTimeout(JSC::JSGlobalObject* globalThis, JSC::EncodedJSValue callback, JSC::EncodedJSValue arguments, JSC::EncodedJSValue countdown);
ZIG_DECL JSC::EncodedJSValue Bun__Timer__sleep(JSC::JSGlobalObject* globalThis, JSC::EncodedJSValue promise, JSC::EncodedJSValue countdown);
ZIG_DECL JSC::EncodedJSValue Bun__Timer__setImmediate(JSC::JSGlobalObject* globalThis, JSC::EncodedJSValue callback, JSC::EncodedJSValue arguments);

#endif

#ifdef __cplusplus

BUN_DECLARE_HOST_FUNCTION(BunServe__onResolvePlugins);
BUN_DECLARE_HOST_FUNCTION(BunServe__onRejectPlugins);

#endif

#ifdef __cplusplus

BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContext__onReject);
BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContext__onRejectStream);
BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContext__onResolve);
BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContext__onResolveStream);

BUN_DECLARE_HOST_FUNCTION(Bun__NodeHTTPRequest__onResolve);
BUN_DECLARE_HOST_FUNCTION(Bun__NodeHTTPRequest__onReject);

BUN_DECLARE_HOST_FUNCTION(Bun__FileSink__onResolveStream);
BUN_DECLARE_HOST_FUNCTION(Bun__FileSink__onRejectStream);

#endif

#ifdef __cplusplus

BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContextTLS__onReject);
BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContextTLS__onRejectStream);
BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContextTLS__onResolve);
BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContextTLS__onResolveStream);

#endif

#ifdef __cplusplus

BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContextDebug__onReject);
BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContextDebug__onRejectStream);
BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContextDebug__onResolve);
BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContextDebug__onResolveStream);

#endif

#ifdef __cplusplus

BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContextDebugTLS__onReject);
BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContextDebugTLS__onRejectStream);
BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContextDebugTLS__onResolve);
BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContextDebugTLS__onResolveStream);

#endif

#pragma mark - Bun__BodyValueBufferer


#ifdef __cplusplus

BUN_DECLARE_HOST_FUNCTION(Bun__BodyValueBufferer__onRejectStream);
BUN_DECLARE_HOST_FUNCTION(Bun__BodyValueBufferer__onResolveStream);

#endif

#ifdef __cplusplus

BUN_DECLARE_HOST_FUNCTION(Bun__TestScope__Describe2__bunTestThen);
BUN_DECLARE_HOST_FUNCTION(Bun__TestScope__Describe2__bunTestCatch);

#endif

#ifdef __cplusplus

CPP_DECL bool JSC__GetterSetter__isGetterNull(JSC::GetterSetter *arg);
CPP_DECL bool JSC__GetterSetter__isSetterNull(JSC::GetterSetter *arg);

CPP_DECL bool JSC__CustomGetterSetter__isGetterNull(JSC::CustomGetterSetter *arg);
CPP_DECL bool JSC__CustomGetterSetter__isSetterNull(JSC::CustomGetterSetter *arg);

#endif

// handwritten

#ifdef __cplusplus

BUN_DECLARE_HOST_FUNCTION(Bun__onResolveEntryPointResult);
BUN_DECLARE_HOST_FUNCTION(Bun__onRejectEntryPointResult);


BUN_DECLARE_HOST_FUNCTION(Bun__FileStreamWrapper__onResolveRequestStream);
BUN_DECLARE_HOST_FUNCTION(Bun__FileStreamWrapper__onRejectRequestStream);


#endif
