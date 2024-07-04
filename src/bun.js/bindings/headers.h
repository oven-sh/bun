// clang-format off
//-- GENERATED FILE. Do not edit --
//
//   To regenerate this file, run:
//   
//      make headers
// 
//-- GENERATED FILE. Do not edit --
#pragma once

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
  #define AUTO_EXTERN_C extern "C"
  #ifdef WIN32
    #define AUTO_EXTERN_C_ZIG extern "C" 
  #else
    #define AUTO_EXTERN_C_ZIG extern "C" __attribute__((weak))
  #endif
#else
  #define AUTO_EXTERN_C
  #define AUTO_EXTERN_C_ZIG __attribute__((weak))
#endif
#define ZIG_DECL AUTO_EXTERN_C_ZIG
#define CPP_DECL AUTO_EXTERN_C
#define CPP_SIZE AUTO_EXTERN_C

#ifndef __cplusplus
typedef void* JSClassRef;
#endif

#ifdef __cplusplus
#include "root.h"
#include <JavaScriptCore/JSClassRef.h>
#endif
#include "headers-handwritten.h"
 typedef struct bJSC__JSPromise { unsigned char bytes[32]; } bJSC__JSPromise;
 typedef char* bJSC__JSPromise_buf;
 typedef struct bJSC__JSCell { unsigned char bytes[8]; } bJSC__JSCell;
 typedef char* bJSC__JSCell_buf;
 typedef struct bJSC__Exception { unsigned char bytes[40]; } bJSC__Exception;
 typedef char* bJSC__Exception_buf;
 typedef struct bJSC__JSObject { unsigned char bytes[16]; } bJSC__JSObject;
 typedef char* bJSC__JSObject_buf;
 typedef struct bJSC__ThrowScope { unsigned char bytes[8]; } bJSC__ThrowScope;
 typedef char* bJSC__ThrowScope_buf;
 typedef struct bJSC__CatchScope { unsigned char bytes[8]; } bJSC__CatchScope;
 typedef char* bJSC__CatchScope_buf;
 typedef struct bJSC__JSString { unsigned char bytes[16]; } bJSC__JSString;
 typedef char* bJSC__JSString_buf;
 typedef struct bJSC__JSInternalPromise { unsigned char bytes[32]; } bJSC__JSInternalPromise;
 typedef char* bJSC__JSInternalPromise_buf;
 typedef struct bJSC__JSGlobalObject { unsigned char bytes[3128]; } bJSC__JSGlobalObject;
 typedef char* bJSC__JSGlobalObject_buf;
 typedef struct bJSC__VM { unsigned char bytes[52176]; } bJSC__VM;
 typedef char* bJSC__VM_buf;

#ifndef __cplusplus
  typedef Bun__ArrayBuffer Bun__ArrayBuffer;
 typedef bJSC__JSString JSC__JSString; // JSC::JSString
  typedef BunString BunString;
  typedef int64_t JSC__JSValue;
  typedef ZigString ZigString;
 typedef struct WebCore__DOMFormData WebCore__DOMFormData; // WebCore::DOMFormData
 typedef struct WebCore__DOMURL WebCore__DOMURL; // WebCore::DOMURL
 typedef struct WebCore__FetchHeaders WebCore__FetchHeaders; // WebCore::FetchHeaders
  typedef ErrorableResolvedSource ErrorableResolvedSource;
 typedef bJSC__JSPromise JSC__JSPromise; // JSC::JSPromise
 typedef bJSC__VM JSC__VM; // JSC::VM
 typedef bJSC__CatchScope JSC__CatchScope; // JSC::CatchScope
  typedef ZigException ZigException;
 typedef struct JSC__CallFrame JSC__CallFrame; // JSC::CallFrame
 typedef bJSC__ThrowScope JSC__ThrowScope; // JSC::ThrowScope
 typedef bJSC__Exception JSC__Exception; // JSC::Exception
  typedef WebSocketHTTPClient WebSocketHTTPClient;
  typedef WebSocketClient WebSocketClient;
  typedef WebSocketClientTLS WebSocketClientTLS;
  typedef ErrorableString ErrorableString;
 typedef bJSC__JSObject JSC__JSObject; // JSC::JSObject
 typedef struct JSC__JSMap JSC__JSMap; // JSC::JSMap
  typedef SystemError SystemError;
  typedef Uint8Array_alias Uint8Array_alias;
 typedef bJSC__JSCell JSC__JSCell; // JSC::JSCell
 typedef bJSC__JSGlobalObject JSC__JSGlobalObject; // JSC::JSGlobalObject
 typedef struct WebCore__AbortSignal WebCore__AbortSignal; // WebCore::AbortSignal
 typedef bJSC__JSInternalPromise JSC__JSInternalPromise; // JSC::JSInternalPromise
  typedef WebSocketHTTPSClient WebSocketHTTPSClient;

#endif

#ifdef __cplusplus
  namespace JSC {
    class JSGlobalObject;
    class Exception;
    class JSObject;
    class JSInternalPromise;
    class JSString;
    class JSCell;
    class JSMap;
    class JSPromise;
    class CatchScope;
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

  typedef Bun__ArrayBuffer Bun__ArrayBuffer;
  typedef BunString BunString;
  typedef int64_t JSC__JSValue;
  typedef ZigString ZigString;
  typedef ErrorableResolvedSource ErrorableResolvedSource;
  typedef ZigException ZigException;
  typedef WebSocketHTTPClient WebSocketHTTPClient;
  typedef WebSocketClient WebSocketClient;
  typedef WebSocketClientTLS WebSocketClientTLS;
  typedef ErrorableString ErrorableString;
  typedef SystemError SystemError;
  typedef Uint8Array_alias Uint8Array_alias;
  typedef WebSocketHTTPSClient WebSocketHTTPSClient;
  using JSC__JSGlobalObject = JSC::JSGlobalObject;
  using JSC__Exception = JSC::Exception;
  using JSC__JSObject = JSC::JSObject;
  using JSC__JSInternalPromise = JSC::JSInternalPromise;
  using JSC__JSString = JSC::JSString;
  using JSC__JSCell = JSC::JSCell;
  using JSC__JSMap = JSC::JSMap;
  using JSC__JSPromise = JSC::JSPromise;
  using JSC__CatchScope = JSC::CatchScope;
  using JSC__VM = JSC::VM;
  using JSC__ThrowScope = JSC::ThrowScope;
  using JSC__CallFrame = JSC::CallFrame;
  using WebCore__FetchHeaders = WebCore::FetchHeaders;
  using WebCore__DOMFormData = WebCore::DOMFormData;
  using WebCore__AbortSignal = WebCore::AbortSignal;
  using WebCore__DOMURL = WebCore::DOMURL;

  using JSC__GetterSetter = JSC::GetterSetter;
  using JSC__CustomGetterSetter = JSC::CustomGetterSetter;
#endif


#pragma mark - JSC::JSObject

CPP_DECL JSC__JSValue JSC__JSObject__create(JSC__JSGlobalObject* arg0, size_t arg1, void* arg2, void(* ArgFn3)(void* arg0, JSC__JSObject* arg1, JSC__JSGlobalObject* arg2));
CPP_DECL size_t JSC__JSObject__getArrayLength(JSC__JSObject* arg0);
CPP_DECL JSC__JSValue JSC__JSObject__getDirect(JSC__JSObject* arg0, JSC__JSGlobalObject* arg1, const ZigString* arg2);
CPP_DECL JSC__JSValue JSC__JSObject__getIndex(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, uint32_t arg2);
CPP_DECL void JSC__JSObject__putRecord(JSC__JSObject* arg0, JSC__JSGlobalObject* arg1, ZigString* arg2, ZigString* arg3, size_t arg4);
CPP_DECL JSC__JSValue ZigString__external(const ZigString* arg0, JSC__JSGlobalObject* arg1, void* arg2, void(* ArgFn3)(void* arg0, void* arg1, size_t arg2));
CPP_DECL JSC__JSValue ZigString__to16BitValue(const ZigString* arg0, JSC__JSGlobalObject* arg1);
CPP_DECL JSC__JSValue ZigString__toAtomicValue(const ZigString* arg0, JSC__JSGlobalObject* arg1);
CPP_DECL JSC__JSValue ZigString__toErrorInstance(const ZigString* arg0, JSC__JSGlobalObject* arg1);
CPP_DECL JSC__JSValue ZigString__toExternalU16(const uint16_t* arg0, size_t arg1, JSC__JSGlobalObject* arg2);
CPP_DECL JSC__JSValue ZigString__toExternalValue(const ZigString* arg0, JSC__JSGlobalObject* arg1);
CPP_DECL JSC__JSValue ZigString__toExternalValueWithCallback(const ZigString* arg0, JSC__JSGlobalObject* arg1, void(* ArgFn2)(void* arg0, void* arg1, size_t arg2));
CPP_DECL JSC__JSValue ZigString__toRangeErrorInstance(const ZigString* arg0, JSC__JSGlobalObject* arg1);
CPP_DECL JSC__JSValue ZigString__toSyntaxErrorInstance(const ZigString* arg0, JSC__JSGlobalObject* arg1);
CPP_DECL JSC__JSValue ZigString__toTypeErrorInstance(const ZigString* arg0, JSC__JSGlobalObject* arg1);
CPP_DECL JSC__JSValue ZigString__toValueGC(const ZigString* arg0, JSC__JSGlobalObject* arg1);
CPP_DECL WebCore__DOMURL* WebCore__DOMURL__cast_(JSC__JSValue JSValue0, JSC__VM* arg1);
CPP_DECL BunString WebCore__DOMURL__fileSystemPath(WebCore__DOMURL* arg0);
CPP_DECL void WebCore__DOMURL__href_(WebCore__DOMURL* arg0, ZigString* arg1);
CPP_DECL void WebCore__DOMURL__pathname_(WebCore__DOMURL* arg0, ZigString* arg1);

#pragma mark - WebCore::DOMFormData

CPP_DECL void WebCore__DOMFormData__append(WebCore__DOMFormData* arg0, ZigString* arg1, ZigString* arg2);
CPP_DECL void WebCore__DOMFormData__appendBlob(WebCore__DOMFormData* arg0, JSC__JSGlobalObject* arg1, ZigString* arg2, void* arg3, ZigString* arg4);
CPP_DECL size_t WebCore__DOMFormData__count(WebCore__DOMFormData* arg0);
CPP_DECL JSC__JSValue WebCore__DOMFormData__create(JSC__JSGlobalObject* arg0);
CPP_DECL JSC__JSValue WebCore__DOMFormData__createFromURLQuery(JSC__JSGlobalObject* arg0, ZigString* arg1);
CPP_DECL WebCore__DOMFormData* WebCore__DOMFormData__fromJS(JSC__JSValue JSValue0);

#pragma mark - WebCore::FetchHeaders

CPP_DECL void WebCore__FetchHeaders__append(WebCore__FetchHeaders* arg0, const ZigString* arg1, const ZigString* arg2, JSC__JSGlobalObject* arg3);
CPP_DECL WebCore__FetchHeaders* WebCore__FetchHeaders__cast_(JSC__JSValue JSValue0, JSC__VM* arg1);
CPP_DECL JSC__JSValue WebCore__FetchHeaders__clone(WebCore__FetchHeaders* arg0, JSC__JSGlobalObject* arg1);
CPP_DECL WebCore__FetchHeaders* WebCore__FetchHeaders__cloneThis(WebCore__FetchHeaders* arg0, JSC__JSGlobalObject* arg1);
CPP_DECL void WebCore__FetchHeaders__copyTo(WebCore__FetchHeaders* arg0, StringPointer* arg1, StringPointer* arg2, unsigned char* arg3);
CPP_DECL void WebCore__FetchHeaders__count(WebCore__FetchHeaders* arg0, uint32_t* arg1, uint32_t* arg2);
CPP_DECL WebCore__FetchHeaders* WebCore__FetchHeaders__createEmpty();
CPP_DECL WebCore__FetchHeaders* WebCore__FetchHeaders__createFromJS(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);
CPP_DECL WebCore__FetchHeaders* WebCore__FetchHeaders__createFromPicoHeaders_(const void* arg0);
CPP_DECL WebCore__FetchHeaders* WebCore__FetchHeaders__createFromUWS(JSC__JSGlobalObject* arg0, void* arg1);
CPP_DECL JSC__JSValue WebCore__FetchHeaders__createValue(JSC__JSGlobalObject* arg0, StringPointer* arg1, StringPointer* arg2, const ZigString* arg3, uint32_t arg4);
CPP_DECL void WebCore__FetchHeaders__deref(WebCore__FetchHeaders* arg0);
CPP_DECL void WebCore__FetchHeaders__fastGet_(WebCore__FetchHeaders* arg0, unsigned char arg1, ZigString* arg2);
CPP_DECL bool WebCore__FetchHeaders__fastHas_(WebCore__FetchHeaders* arg0, unsigned char arg1);
CPP_DECL void WebCore__FetchHeaders__fastRemove_(WebCore__FetchHeaders* arg0, unsigned char arg1);
CPP_DECL void WebCore__FetchHeaders__get_(WebCore__FetchHeaders* arg0, const ZigString* arg1, ZigString* arg2, JSC__JSGlobalObject* arg3);
CPP_DECL bool WebCore__FetchHeaders__has(WebCore__FetchHeaders* arg0, const ZigString* arg1, JSC__JSGlobalObject* arg2);
CPP_DECL bool WebCore__FetchHeaders__isEmpty(WebCore__FetchHeaders* arg0);
CPP_DECL void WebCore__FetchHeaders__put_(WebCore__FetchHeaders* arg0, const ZigString* arg1, const ZigString* arg2, JSC__JSGlobalObject* arg3);
CPP_DECL void WebCore__FetchHeaders__remove(WebCore__FetchHeaders* arg0, const ZigString* arg1, JSC__JSGlobalObject* arg2);
CPP_DECL JSC__JSValue WebCore__FetchHeaders__toJS(WebCore__FetchHeaders* arg0, JSC__JSGlobalObject* arg1);
CPP_DECL void WebCore__FetchHeaders__toUWSResponse(WebCore__FetchHeaders* arg0, bool arg1, void* arg2);
CPP_DECL JSC__JSValue SystemError__toErrorInstance(const SystemError* arg0, JSC__JSGlobalObject* arg1);

#pragma mark - JSC::JSCell

CPP_DECL JSC__JSObject* JSC__JSCell__getObject(JSC__JSCell* arg0);
CPP_DECL unsigned char JSC__JSCell__getType(JSC__JSCell* arg0);

#pragma mark - JSC::JSString

CPP_DECL bool JSC__JSString__eql(const JSC__JSString* arg0, JSC__JSGlobalObject* arg1, JSC__JSString* arg2);
CPP_DECL bool JSC__JSString__is8Bit(const JSC__JSString* arg0);
CPP_DECL void JSC__JSString__iterator(JSC__JSString* arg0, JSC__JSGlobalObject* arg1, void* arg2);
CPP_DECL size_t JSC__JSString__length(const JSC__JSString* arg0);
CPP_DECL JSC__JSObject* JSC__JSString__toObject(JSC__JSString* arg0, JSC__JSGlobalObject* arg1);
CPP_DECL void JSC__JSString__toZigString(JSC__JSString* arg0, JSC__JSGlobalObject* arg1, ZigString* arg2);

#pragma mark - JSC::JSModuleLoader

CPP_DECL JSC__JSValue JSC__JSModuleLoader__evaluate(JSC__JSGlobalObject* arg0, const unsigned char* arg1, size_t arg2, const unsigned char* arg3, size_t arg4, const unsigned char* arg5, size_t arg6, JSC__JSValue JSValue7, JSC__JSValue* arg8);
CPP_DECL JSC__JSInternalPromise* JSC__JSModuleLoader__loadAndEvaluateModule(JSC__JSGlobalObject* arg0, const BunString* arg1);

#pragma mark - WebCore::AbortSignal

CPP_DECL bool WebCore__AbortSignal__aborted(WebCore__AbortSignal* arg0);
CPP_DECL JSC__JSValue WebCore__AbortSignal__abortReason(WebCore__AbortSignal* arg0);
CPP_DECL WebCore__AbortSignal* WebCore__AbortSignal__addListener(WebCore__AbortSignal* arg0, void* arg1, void(* ArgFn2)(void* arg0, JSC__JSValue JSValue1));
CPP_DECL void WebCore__AbortSignal__cleanNativeBindings(WebCore__AbortSignal* arg0, void* arg1);
CPP_DECL JSC__JSValue WebCore__AbortSignal__create(JSC__JSGlobalObject* arg0);
CPP_DECL JSC__JSValue WebCore__AbortSignal__createAbortError(const ZigString* arg0, const ZigString* arg1, JSC__JSGlobalObject* arg2);
CPP_DECL JSC__JSValue WebCore__AbortSignal__createTimeoutError(const ZigString* arg0, const ZigString* arg1, JSC__JSGlobalObject* arg2);
CPP_DECL WebCore__AbortSignal* WebCore__AbortSignal__fromJS(JSC__JSValue JSValue0);
CPP_DECL WebCore__AbortSignal* WebCore__AbortSignal__ref(WebCore__AbortSignal* arg0);
CPP_DECL WebCore__AbortSignal* WebCore__AbortSignal__signal(WebCore__AbortSignal* arg0, JSC__JSValue JSValue1);
CPP_DECL JSC__JSValue WebCore__AbortSignal__toJS(WebCore__AbortSignal* arg0, JSC__JSGlobalObject* arg1);
CPP_DECL WebCore__AbortSignal* WebCore__AbortSignal__unref(WebCore__AbortSignal* arg0);

#pragma mark - JSC::JSPromise

CPP_DECL JSC__JSValue JSC__JSPromise__asValue(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1);
CPP_DECL JSC__JSPromise* JSC__JSPromise__create(JSC__JSGlobalObject* arg0);
CPP_DECL bool JSC__JSPromise__isHandled(const JSC__JSPromise* arg0, JSC__VM* arg1);
CPP_DECL void JSC__JSPromise__reject(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL void JSC__JSPromise__rejectAsHandled(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL void JSC__JSPromise__rejectAsHandledException(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1, JSC__Exception* arg2);
CPP_DECL JSC__JSPromise* JSC__JSPromise__rejectedPromise(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);
CPP_DECL JSC__JSValue JSC__JSPromise__rejectedPromiseValue(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);
CPP_DECL void JSC__JSPromise__rejectOnNextTickWithHandled(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2, bool arg3);
CPP_DECL void JSC__JSPromise__resolve(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL JSC__JSPromise* JSC__JSPromise__resolvedPromise(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);
CPP_DECL JSC__JSValue JSC__JSPromise__resolvedPromiseValue(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);
CPP_DECL void JSC__JSPromise__resolveOnNextTick(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL JSC__JSValue JSC__JSPromise__result(JSC__JSPromise* arg0, JSC__VM* arg1);
CPP_DECL void JSC__JSPromise__setHandled(JSC__JSPromise* arg0, JSC__VM* arg1);
CPP_DECL uint32_t JSC__JSPromise__status(const JSC__JSPromise* arg0, JSC__VM* arg1);

#pragma mark - JSC::JSInternalPromise

CPP_DECL JSC__JSInternalPromise* JSC__JSInternalPromise__create(JSC__JSGlobalObject* arg0);
CPP_DECL bool JSC__JSInternalPromise__isHandled(const JSC__JSInternalPromise* arg0, JSC__VM* arg1);
CPP_DECL void JSC__JSInternalPromise__reject(JSC__JSInternalPromise* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL void JSC__JSInternalPromise__rejectAsHandled(JSC__JSInternalPromise* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL void JSC__JSInternalPromise__rejectAsHandledException(JSC__JSInternalPromise* arg0, JSC__JSGlobalObject* arg1, JSC__Exception* arg2);
CPP_DECL JSC__JSInternalPromise* JSC__JSInternalPromise__rejectedPromise(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);
CPP_DECL void JSC__JSInternalPromise__resolve(JSC__JSInternalPromise* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL JSC__JSInternalPromise* JSC__JSInternalPromise__resolvedPromise(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);
CPP_DECL JSC__JSValue JSC__JSInternalPromise__result(const JSC__JSInternalPromise* arg0, JSC__VM* arg1);
CPP_DECL void JSC__JSInternalPromise__setHandled(JSC__JSInternalPromise* arg0, JSC__VM* arg1);
CPP_DECL uint32_t JSC__JSInternalPromise__status(const JSC__JSInternalPromise* arg0, JSC__VM* arg1);

#pragma mark - JSC::JSFunction

CPP_DECL void JSC__JSFunction__optimizeSoon(JSC__JSValue JSValue0);

#pragma mark - JSC::JSGlobalObject

CPP_DECL VirtualMachine* JSC__JSGlobalObject__bunVM(JSC__JSGlobalObject* arg0);
CPP_DECL JSC__JSValue JSC__JSGlobalObject__createAggregateError(JSC__JSGlobalObject* arg0, void** arg1, uint16_t arg2, const ZigString* arg3);
CPP_DECL void JSC__JSGlobalObject__createSyntheticModule_(JSC__JSGlobalObject* arg0, ZigString* arg1, size_t arg2, JSC__JSValue* arg3, size_t arg4);
CPP_DECL void JSC__JSGlobalObject__deleteModuleRegistryEntry(JSC__JSGlobalObject* arg0, ZigString* arg1);
CPP_DECL JSC__JSValue JSC__JSGlobalObject__generateHeapSnapshot(JSC__JSGlobalObject* arg0);
CPP_DECL JSC__JSValue JSC__JSGlobalObject__getCachedObject(JSC__JSGlobalObject* arg0, const ZigString* arg1);
CPP_DECL void JSC__JSGlobalObject__handleRejectedPromises(JSC__JSGlobalObject* arg0);
CPP_DECL JSC__JSValue JSC__JSGlobalObject__putCachedObject(JSC__JSGlobalObject* arg0, const ZigString* arg1, JSC__JSValue JSValue2);
CPP_DECL void JSC__JSGlobalObject__queueMicrotaskJob(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue JSValue2, JSC__JSValue JSValue3);
CPP_DECL void JSC__JSGlobalObject__reload(JSC__JSGlobalObject* arg0);
CPP_DECL bool JSC__JSGlobalObject__startRemoteInspector(JSC__JSGlobalObject* arg0, unsigned char* arg1, uint16_t arg2);
CPP_DECL JSC__VM* JSC__JSGlobalObject__vm(JSC__JSGlobalObject* arg0);

#pragma mark - JSC::JSMap

CPP_DECL JSC__JSValue JSC__JSMap__create(JSC__JSGlobalObject* arg0);
CPP_DECL JSC__JSValue JSC__JSMap__get_(JSC__JSMap* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL bool JSC__JSMap__has(JSC__JSMap* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL bool JSC__JSMap__remove(JSC__JSMap* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL void JSC__JSMap__set(JSC__JSMap* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2, JSC__JSValue JSValue3);

#pragma mark - JSC::JSValue

CPP_DECL void JSC__JSValue___then(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2, SYSV_ABI JSC__JSValue(* ArgFn3)(JSC__JSGlobalObject* arg0, JSC__CallFrame* arg1), SYSV_ABI JSC__JSValue(* ArgFn4)(JSC__JSGlobalObject* arg0, JSC__CallFrame* arg1));
CPP_DECL bool JSC__JSValue__asArrayBuffer_(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, Bun__ArrayBuffer* arg2);
CPP_DECL unsigned char JSC__JSValue__asBigIntCompare(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL JSC__JSCell* JSC__JSValue__asCell(JSC__JSValue JSValue0);
CPP_DECL JSC__JSInternalPromise* JSC__JSValue__asInternalPromise(JSC__JSValue JSValue0);
CPP_DECL double JSC__JSValue__asNumber(JSC__JSValue JSValue0);
CPP_DECL bJSC__JSObject JSC__JSValue__asObject(JSC__JSValue JSValue0);
CPP_DECL JSC__JSPromise* JSC__JSValue__asPromise(JSC__JSValue JSValue0);
CPP_DECL JSC__JSString* JSC__JSValue__asString(JSC__JSValue JSValue0);
CPP_DECL double JSC__JSValue__coerceToDouble(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1);
CPP_DECL int32_t JSC__JSValue__coerceToInt32(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1);
CPP_DECL int64_t JSC__JSValue__coerceToInt64(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1);
CPP_DECL JSC__JSValue JSC__JSValue__createEmptyArray(JSC__JSGlobalObject* arg0, size_t arg1);
CPP_DECL JSC__JSValue JSC__JSValue__createEmptyObject(JSC__JSGlobalObject* arg0, size_t arg1);
CPP_DECL JSC__JSValue JSC__JSValue__createInternalPromise(JSC__JSGlobalObject* arg0);
CPP_DECL JSC__JSValue JSC__JSValue__createObject2(JSC__JSGlobalObject* arg0, const ZigString* arg1, const ZigString* arg2, JSC__JSValue JSValue3, JSC__JSValue JSValue4);
CPP_DECL JSC__JSValue JSC__JSValue__createRangeError(const ZigString* arg0, const ZigString* arg1, JSC__JSGlobalObject* arg2);
CPP_DECL JSC__JSValue JSC__JSValue__createRopeString(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSGlobalObject* arg2);
CPP_DECL JSC__JSValue JSC__JSValue__createStringArray(JSC__JSGlobalObject* arg0, const ZigString* arg1, size_t arg2, bool arg3);
CPP_DECL JSC__JSValue JSC__JSValue__createTypeError(const ZigString* arg0, const ZigString* arg1, JSC__JSGlobalObject* arg2);
CPP_DECL JSC__JSValue JSC__JSValue__createUninitializedUint8Array(JSC__JSGlobalObject* arg0, size_t arg1);
CPP_DECL bool JSC__JSValue__deepEquals(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSGlobalObject* arg2);
CPP_DECL bool JSC__JSValue__deepMatch(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSGlobalObject* arg2, bool arg3);
CPP_DECL bool JSC__JSValue__eqlCell(JSC__JSValue JSValue0, JSC__JSCell* arg1);
CPP_DECL bool JSC__JSValue__eqlValue(JSC__JSValue JSValue0, JSC__JSValue JSValue1);
CPP_DECL JSC__JSValue JSC__JSValue__fastGet_(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, unsigned char arg2);
CPP_DECL JSC__JSValue JSC__JSValue__fastGetDirect_(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, unsigned char arg2);
CPP_DECL void JSC__JSValue__forEach(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, void* arg2, void(* ArgFn3)(JSC__VM* arg0, JSC__JSGlobalObject* arg1, void* arg2, JSC__JSValue JSValue3));
CPP_DECL void JSC__JSValue__forEachProperty(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, void* arg2, void(* ArgFn3)(JSC__JSGlobalObject* arg0, void* arg1, ZigString* arg2, JSC__JSValue JSValue3, bool arg4, bool arg5));
CPP_DECL void JSC__JSValue__forEachPropertyOrdered(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, void* arg2, void(* ArgFn3)(JSC__JSGlobalObject* arg0, void* arg1, ZigString* arg2, JSC__JSValue JSValue3, bool arg4, bool arg5));
CPP_DECL JSC__JSValue JSC__JSValue__fromEntries(JSC__JSGlobalObject* arg0, ZigString* arg1, ZigString* arg2, size_t arg3, bool arg4);
CPP_DECL JSC__JSValue JSC__JSValue__fromInt64NoTruncate(JSC__JSGlobalObject* arg0, int64_t arg1);
CPP_DECL JSC__JSValue JSC__JSValue__fromUInt64NoTruncate(JSC__JSGlobalObject* arg0, uint64_t arg1);
CPP_DECL JSC__JSValue JSC__JSValue__fromTimevalNoTruncate(JSC__JSGlobalObject* arg0, int64_t nsec, int64_t sec);
CPP_DECL JSC__JSValue JSC__JSValue__bigIntSum(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue0, JSC__JSValue JSValue1);
CPP_DECL void JSC__JSValue__getClassName(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, ZigString* arg2);
CPP_DECL JSC__JSValue JSC__JSValue__getErrorsProperty(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1);
CPP_DECL JSC__JSValue JSC__JSValue__getIfPropertyExistsFromPath(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL JSC__JSValue JSC__JSValue__getIfPropertyExistsImpl(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, const unsigned char* arg2, uint32_t arg3);
CPP_DECL double JSC__JSValue__getLengthIfPropertyExistsInternal(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1);
CPP_DECL void JSC__JSValue__getNameProperty(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, ZigString* arg2);
CPP_DECL JSC__JSValue JSC__JSValue__getPrototype(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1);
CPP_DECL void JSC__JSValue__getSymbolDescription(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, ZigString* arg2);
CPP_DECL double JSC__JSValue__getUnixTimestamp(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__hasOwnProperty(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, ZigString arg2);
CPP_DECL bool JSC__JSValue__isAggregateError(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1);
CPP_DECL bool JSC__JSValue__isAnyError(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__isAnyInt(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__isBigInt(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__isBigInt32(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__isBoolean(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__isCallable(JSC__JSValue JSValue0, JSC__VM* arg1);
CPP_DECL bool JSC__JSValue__isClass(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1);
CPP_DECL bool JSC__JSValue__isConstructor(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__isCustomGetterSetter(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__isError(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__isException(JSC__JSValue JSValue0, JSC__VM* arg1);
CPP_DECL bool JSC__JSValue__isGetterSetter(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__isHeapBigInt(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__isInstanceOf(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL bool JSC__JSValue__isInt32(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__isInt32AsAnyInt(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__isIterable(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1);
CPP_DECL bool JSC__JSValue__isNumber(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__isObject(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__isPrimitive(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__isSameValue(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSGlobalObject* arg2);
CPP_DECL bool JSC__JSValue__isSymbol(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__isTerminationException(JSC__JSValue JSValue0, JSC__VM* arg1);
CPP_DECL bool JSC__JSValue__isUInt32AsAnyInt(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__jestDeepEquals(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSGlobalObject* arg2);
CPP_DECL bool JSC__JSValue__jestDeepMatch(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSGlobalObject* arg2, bool arg3);
CPP_DECL bool JSC__JSValue__jestStrictDeepEquals(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSGlobalObject* arg2);
CPP_DECL JSC__JSValue JSC__JSValue__jsBoolean(bool arg0);
CPP_DECL JSC__JSValue JSC__JSValue__jsDoubleNumber(double arg0);
CPP_DECL JSC__JSValue JSC__JSValue__jsNull();
CPP_DECL JSC__JSValue JSC__JSValue__jsNumberFromChar(unsigned char arg0);
CPP_DECL JSC__JSValue JSC__JSValue__jsNumberFromDouble(double arg0);
CPP_DECL JSC__JSValue JSC__JSValue__jsNumberFromInt64(int64_t arg0);
CPP_DECL JSC__JSValue JSC__JSValue__jsNumberFromU16(uint16_t arg0);
CPP_DECL void JSC__JSValue__jsonStringify(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, uint32_t arg2, BunString* arg3);
CPP_DECL JSC__JSValue JSC__JSValue__jsTDZValue();
CPP_DECL unsigned char JSC__JSValue__jsType(JSC__JSValue JSValue0);
CPP_DECL JSC__JSValue JSC__JSValue__jsUndefined();
CPP_DECL JSC__JSValue JSC__JSValue__keys(JSC__JSGlobalObject* arg0, JSC__JSValue arg1);
CPP_DECL JSC__JSValue JSC__JSValue__values(JSC__JSGlobalObject* arg0, JSC__JSValue arg1);
CPP_DECL JSC__JSValue JSC__JSValue__parseJSON(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1);
CPP_DECL void JSC__JSValue__push(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL void JSC__JSValue__put(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, const ZigString* arg2, JSC__JSValue JSValue3);
CPP_DECL void JSC__JSValue__putIndex(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, uint32_t arg2, JSC__JSValue JSValue3);
CPP_DECL void JSC__JSValue__putRecord(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, ZigString* arg2, ZigString* arg3, size_t arg4);
CPP_DECL bool JSC__JSValue__strictDeepEquals(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSGlobalObject* arg2);
CPP_DECL bool JSC__JSValue__stringIncludes(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL JSC__JSValue JSC__JSValue__symbolFor(JSC__JSGlobalObject* arg0, ZigString* arg1);
CPP_DECL bool JSC__JSValue__symbolKeyFor(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, ZigString* arg2);
CPP_DECL bool JSC__JSValue__toBoolean(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__toBooleanSlow(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1);
CPP_DECL JSC__JSValue JSC__JSValue__toError_(JSC__JSValue JSValue0);
CPP_DECL int32_t JSC__JSValue__toInt32(JSC__JSValue JSValue0);
CPP_DECL int64_t JSC__JSValue__toInt64(JSC__JSValue JSValue0);
CPP_DECL bool JSC__JSValue__toMatch(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL JSC__JSObject* JSC__JSValue__toObject(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1);
CPP_DECL JSC__JSString* JSC__JSValue__toString(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1);
CPP_DECL JSC__JSString* JSC__JSValue__toStringOrNull(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1);
CPP_DECL uint64_t JSC__JSValue__toUInt64NoTruncate(JSC__JSValue JSValue0);
CPP_DECL void JSC__JSValue__toZigException(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, ZigException* arg2);
CPP_DECL void JSC__JSValue__toZigString(JSC__JSValue JSValue0, ZigString* arg1, JSC__JSGlobalObject* arg2);

#pragma mark - JSC::Exception

CPP_DECL JSC__Exception* JSC__Exception__create(JSC__JSGlobalObject* arg0, JSC__JSObject* arg1, unsigned char StackCaptureAction2);
CPP_DECL void JSC__Exception__getStackTrace(JSC__Exception* arg0, ZigStackTrace* arg1);
CPP_DECL JSC__JSValue JSC__Exception__value(JSC__Exception* arg0);

#pragma mark - JSC::VM

CPP_DECL size_t JSC__VM__blockBytesAllocated(JSC__VM* arg0);
CPP_DECL void JSC__VM__clearExecutionTimeLimit(JSC__VM* arg0);
CPP_DECL void JSC__VM__collectAsync(JSC__VM* arg0);
CPP_DECL JSC__VM* JSC__VM__create(unsigned char HeapType0);
CPP_DECL void JSC__VM__deferGC(JSC__VM* arg0, void* arg1, void(* ArgFn2)(void* arg0));
CPP_DECL void JSC__VM__deinit(JSC__VM* arg0, JSC__JSGlobalObject* arg1);
CPP_DECL void JSC__VM__deleteAllCode(JSC__VM* arg0, JSC__JSGlobalObject* arg1);
CPP_DECL void JSC__VM__drainMicrotasks(JSC__VM* arg0);
CPP_DECL bool JSC__VM__executionForbidden(JSC__VM* arg0);
CPP_DECL size_t JSC__VM__externalMemorySize(JSC__VM* arg0);
CPP_DECL size_t JSC__VM__heapSize(JSC__VM* arg0);
CPP_DECL void JSC__VM__holdAPILock(JSC__VM* arg0, void* arg1, void(* ArgFn2)(void* arg0));
CPP_DECL bool JSC__VM__isEntered(JSC__VM* arg0);
CPP_DECL bool JSC__VM__isJITEnabled();
CPP_DECL void JSC__VM__notifyNeedDebuggerBreak(JSC__VM* arg0);
CPP_DECL void JSC__VM__notifyNeedShellTimeoutCheck(JSC__VM* arg0);
CPP_DECL void JSC__VM__notifyNeedTermination(JSC__VM* arg0);
CPP_DECL void JSC__VM__notifyNeedWatchdogCheck(JSC__VM* arg0);
CPP_DECL void JSC__VM__releaseWeakRefs(JSC__VM* arg0);
CPP_DECL JSC__JSValue JSC__VM__runGC(JSC__VM* arg0, bool arg1);
CPP_DECL void JSC__VM__setControlFlowProfiler(JSC__VM* arg0, bool arg1);
CPP_DECL void JSC__VM__setExecutionForbidden(JSC__VM* arg0, bool arg1);
CPP_DECL void JSC__VM__setExecutionTimeLimit(JSC__VM* arg0, double arg1);
CPP_DECL void JSC__VM__shrinkFootprint(JSC__VM* arg0);
CPP_DECL void JSC__VM__throwError(JSC__VM* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL void JSC__VM__throwError(JSC__VM* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2);
CPP_DECL void JSC__VM__whenIdle(JSC__VM* arg0, void(* ArgFn1)());

#pragma mark - JSC::ThrowScope

CPP_DECL void JSC__ThrowScope__clearException(JSC__ThrowScope* arg0);
CPP_DECL bJSC__ThrowScope JSC__ThrowScope__declare(JSC__VM* arg0, unsigned char* arg1, unsigned char* arg2, size_t arg3);
CPP_DECL JSC__Exception* JSC__ThrowScope__exception(JSC__ThrowScope* arg0);
CPP_DECL void JSC__ThrowScope__release(JSC__ThrowScope* arg0);

#pragma mark - JSC::CatchScope

CPP_DECL void JSC__CatchScope__clearException(JSC__CatchScope* arg0);
CPP_DECL bJSC__CatchScope JSC__CatchScope__declare(JSC__VM* arg0, unsigned char* arg1, unsigned char* arg2, size_t arg3);
CPP_DECL JSC__Exception* JSC__CatchScope__exception(JSC__CatchScope* arg0);
CPP_DECL void FFI__ptr__put(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC__JSValue SYSV_ABI FFI__ptr__fastpath(JSC__JSGlobalObject* arg0, void* arg1, Uint8Array_alias* arg2);
extern "C" JSC__JSValue SYSV_ABI FFI__ptr__slowpath(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__u8__put(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC__JSValue SYSV_ABI Reader__u8__fastpath(JSC__JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC__JSValue SYSV_ABI Reader__u8__slowpath(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__u16__put(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC__JSValue SYSV_ABI Reader__u16__fastpath(JSC__JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC__JSValue SYSV_ABI Reader__u16__slowpath(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__u32__put(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC__JSValue SYSV_ABI Reader__u32__fastpath(JSC__JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC__JSValue SYSV_ABI Reader__u32__slowpath(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__ptr__put(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC__JSValue SYSV_ABI Reader__ptr__fastpath(JSC__JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC__JSValue SYSV_ABI Reader__ptr__slowpath(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__i8__put(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC__JSValue SYSV_ABI Reader__i8__fastpath(JSC__JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC__JSValue SYSV_ABI Reader__i8__slowpath(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__i16__put(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC__JSValue SYSV_ABI Reader__i16__fastpath(JSC__JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC__JSValue SYSV_ABI Reader__i16__slowpath(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__i32__put(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC__JSValue SYSV_ABI Reader__i32__fastpath(JSC__JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC__JSValue SYSV_ABI Reader__i32__slowpath(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__f32__put(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC__JSValue SYSV_ABI Reader__f32__fastpath(JSC__JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC__JSValue SYSV_ABI Reader__f32__slowpath(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__f64__put(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC__JSValue SYSV_ABI Reader__f64__fastpath(JSC__JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC__JSValue SYSV_ABI Reader__f64__slowpath(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__i64__put(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC__JSValue SYSV_ABI Reader__i64__fastpath(JSC__JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC__JSValue SYSV_ABI Reader__i64__slowpath(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__u64__put(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC__JSValue SYSV_ABI Reader__u64__fastpath(JSC__JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC__JSValue SYSV_ABI Reader__u64__slowpath(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue* arg2, size_t arg3);

#endif
CPP_DECL void Reader__intptr__put(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);

#ifdef __cplusplus

extern "C" JSC__JSValue SYSV_ABI Reader__intptr__fastpath(JSC__JSGlobalObject* arg0, void* arg1, int64_t arg2, int32_t arg3);
extern "C" JSC__JSValue SYSV_ABI Reader__intptr__slowpath(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue* arg2, size_t arg3);

#endif

#pragma mark - Zig::GlobalObject

CPP_DECL JSC__JSGlobalObject* Zig__GlobalObject__create(void* arg0, int32_t arg1, bool arg2, bool arg3, void* arg4);
CPP_DECL void* Zig__GlobalObject__getModuleRegistryMap(JSC__JSGlobalObject* arg0);
CPP_DECL bool Zig__GlobalObject__resetModuleRegistryMap(JSC__JSGlobalObject* arg0, void* arg1);

#ifdef __cplusplus

ZIG_DECL void Zig__GlobalObject__fetch(ErrorableResolvedSource* arg0, JSC__JSGlobalObject* arg1, BunString* arg2, BunString* arg3);
ZIG_DECL ErrorableString Zig__GlobalObject__import(JSC__JSGlobalObject* arg0, BunString* arg1, BunString* arg2);
ZIG_DECL void Zig__GlobalObject__onCrash();
ZIG_DECL JSC__JSValue Zig__GlobalObject__promiseRejectionTracker(JSC__JSGlobalObject* arg0, JSC__JSPromise* arg1, uint32_t JSPromiseRejectionOperation2);
ZIG_DECL JSC__JSValue Zig__GlobalObject__reportUncaughtException(JSC__JSGlobalObject* arg0, JSC__Exception* arg1);
ZIG_DECL void Zig__GlobalObject__resolve(ErrorableString* arg0, JSC__JSGlobalObject* arg1, BunString* arg2, BunString* arg3, ZigString* arg4);

#endif

#ifdef __cplusplus

extern "C" JSC__JSValue SYSV_ABI Bun__Path__basename(JSC__JSGlobalObject* arg0, bool arg1, JSC__JSValue* arg2, uint16_t arg3);
extern "C" JSC__JSValue SYSV_ABI Bun__Path__dirname(JSC__JSGlobalObject* arg0, bool arg1, JSC__JSValue* arg2, uint16_t arg3);
extern "C" JSC__JSValue SYSV_ABI Bun__Path__extname(JSC__JSGlobalObject* arg0, bool arg1, JSC__JSValue* arg2, uint16_t arg3);
extern "C" JSC__JSValue SYSV_ABI Bun__Path__format(JSC__JSGlobalObject* arg0, bool arg1, JSC__JSValue* arg2, uint16_t arg3);
extern "C" JSC__JSValue SYSV_ABI Bun__Path__isAbsolute(JSC__JSGlobalObject* arg0, bool arg1, JSC__JSValue* arg2, uint16_t arg3);
extern "C" JSC__JSValue SYSV_ABI Bun__Path__join(JSC__JSGlobalObject* arg0, bool arg1, JSC__JSValue* arg2, uint16_t arg3);
extern "C" JSC__JSValue SYSV_ABI Bun__Path__normalize(JSC__JSGlobalObject* arg0, bool arg1, JSC__JSValue* arg2, uint16_t arg3);
extern "C" JSC__JSValue SYSV_ABI Bun__Path__parse(JSC__JSGlobalObject* arg0, bool arg1, JSC__JSValue* arg2, uint16_t arg3);
extern "C" JSC__JSValue SYSV_ABI Bun__Path__relative(JSC__JSGlobalObject* arg0, bool arg1, JSC__JSValue* arg2, uint16_t arg3);
extern "C" JSC__JSValue SYSV_ABI Bun__Path__resolve(JSC__JSGlobalObject* arg0, bool arg1, JSC__JSValue* arg2, uint16_t arg3);
extern "C" JSC__JSValue SYSV_ABI Bun__Path__toNamespacedPath(JSC__JSGlobalObject* arg0, bool arg1, JSC__JSValue* arg2, uint16_t arg3);

#endif

CPP_DECL JSC__JSValue ArrayBufferSink__assignToStream(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, void* arg2, void** arg3);
CPP_DECL JSC__JSValue ArrayBufferSink__createObject(JSC__JSGlobalObject* arg0, void* arg1, uintptr_t destructor);
CPP_DECL void ArrayBufferSink__detachPtr(JSC__JSValue JSValue0);
CPP_DECL void* ArrayBufferSink__fromJS(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);
CPP_DECL void ArrayBufferSink__onClose(JSC__JSValue JSValue0, JSC__JSValue JSValue1);
CPP_DECL void ArrayBufferSink__onReady(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSValue JSValue2);

#ifdef __cplusplus

ZIG_DECL JSC__JSValue ArrayBufferSink__close(JSC__JSGlobalObject* arg0, void* arg1);
BUN_DECLARE_HOST_FUNCTION(ArrayBufferSink__construct);
BUN_DECLARE_HOST_FUNCTION(ArrayBufferSink__end);
ZIG_DECL JSC__JSValue SYSV_ABI ArrayBufferSink__endWithSink(void* arg0, JSC__JSGlobalObject* arg1);
ZIG_DECL void ArrayBufferSink__finalize(void* arg0);
BUN_DECLARE_HOST_FUNCTION(ArrayBufferSink__flush);
BUN_DECLARE_HOST_FUNCTION(ArrayBufferSink__start);
ZIG_DECL void ArrayBufferSink__updateRef(void* arg0, bool arg1);
BUN_DECLARE_HOST_FUNCTION(ArrayBufferSink__write);

#endif
CPP_DECL JSC__JSValue HTTPSResponseSink__assignToStream(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, void* arg2, void** arg3);
CPP_DECL JSC__JSValue HTTPSResponseSink__createObject(JSC__JSGlobalObject* arg0, void* arg1, uintptr_t destructor);
CPP_DECL void HTTPSResponseSink__detachPtr(JSC__JSValue JSValue0);
CPP_DECL void* HTTPSResponseSink__fromJS(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);
CPP_DECL void HTTPSResponseSink__onClose(JSC__JSValue JSValue0, JSC__JSValue JSValue1);
CPP_DECL void HTTPSResponseSink__onReady(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSValue JSValue2);

#ifdef __cplusplus

ZIG_DECL JSC__JSValue HTTPSResponseSink__close(JSC__JSGlobalObject* arg0, void* arg1);
BUN_DECLARE_HOST_FUNCTION(HTTPSResponseSink__construct);
BUN_DECLARE_HOST_FUNCTION(HTTPSResponseSink__end);
ZIG_DECL JSC__JSValue SYSV_ABI HTTPSResponseSink__endWithSink(void* arg0, JSC__JSGlobalObject* arg1);
ZIG_DECL void HTTPSResponseSink__finalize(void* arg0);
BUN_DECLARE_HOST_FUNCTION(HTTPSResponseSink__flush);
BUN_DECLARE_HOST_FUNCTION(HTTPSResponseSink__start);
ZIG_DECL void HTTPSResponseSink__updateRef(void* arg0, bool arg1);
BUN_DECLARE_HOST_FUNCTION(HTTPSResponseSink__write);

#endif
CPP_DECL JSC__JSValue HTTPResponseSink__assignToStream(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, void* arg2, void** arg3);
CPP_DECL JSC__JSValue HTTPResponseSink__createObject(JSC__JSGlobalObject* arg0, void* arg1, uintptr_t destructor);
CPP_DECL void HTTPResponseSink__detachPtr(JSC__JSValue JSValue0);
CPP_DECL void* HTTPResponseSink__fromJS(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);
CPP_DECL void HTTPResponseSink__onClose(JSC__JSValue JSValue0, JSC__JSValue JSValue1);
CPP_DECL void HTTPResponseSink__onReady(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSValue JSValue2);

#ifdef __cplusplus

ZIG_DECL JSC__JSValue HTTPResponseSink__close(JSC__JSGlobalObject* arg0, void* arg1);
BUN_DECLARE_HOST_FUNCTION(HTTPResponseSink__construct);
BUN_DECLARE_HOST_FUNCTION(HTTPResponseSink__end);
ZIG_DECL JSC__JSValue SYSV_ABI SYSV_ABI HTTPResponseSink__endWithSink(void* arg0, JSC__JSGlobalObject* arg1);
ZIG_DECL void HTTPResponseSink__finalize(void* arg0);
BUN_DECLARE_HOST_FUNCTION(HTTPResponseSink__flush);
BUN_DECLARE_HOST_FUNCTION(HTTPResponseSink__start);
ZIG_DECL void HTTPResponseSink__updateRef(void* arg0, bool arg1);
BUN_DECLARE_HOST_FUNCTION(HTTPResponseSink__write);

#endif
CPP_DECL JSC__JSValue FileSink__assignToStream(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, void* arg2, void** arg3);
CPP_DECL JSC__JSValue FileSink__createObject(JSC__JSGlobalObject* arg0, void* arg1, uintptr_t destructor);
CPP_DECL void FileSink__detachPtr(JSC__JSValue JSValue0);
CPP_DECL void* FileSink__fromJS(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);
CPP_DECL void FileSink__onClose(JSC__JSValue JSValue0, JSC__JSValue JSValue1);
CPP_DECL void FileSink__onReady(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSValue JSValue2);

#ifdef __cplusplus

ZIG_DECL JSC__JSValue FileSink__close(JSC__JSGlobalObject* arg0, void* arg1);
BUN_DECLARE_HOST_FUNCTION(FileSink__construct);
BUN_DECLARE_HOST_FUNCTION(FileSink__end);
ZIG_DECL JSC__JSValue SYSV_ABI FileSink__endWithSink(void* arg0, JSC__JSGlobalObject* arg1);
ZIG_DECL void FileSink__finalize(void* arg0);
BUN_DECLARE_HOST_FUNCTION(FileSink__flush);
BUN_DECLARE_HOST_FUNCTION(FileSink__start);
ZIG_DECL void FileSink__updateRef(void* arg0, bool arg1);
BUN_DECLARE_HOST_FUNCTION(FileSink__write);

#endif

CPP_DECL JSC__JSValue FileSink__assignToStream(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, void* arg2, void** arg3);
CPP_DECL JSC__JSValue FileSink__createObject(JSC__JSGlobalObject* arg0, void* arg1, uintptr_t destructor);
CPP_DECL void FileSink__detachPtr(JSC__JSValue JSValue0);
CPP_DECL void* FileSink__fromJS(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);
CPP_DECL void FileSink__onClose(JSC__JSValue JSValue0, JSC__JSValue JSValue1);
CPP_DECL void FileSink__onReady(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSValue JSValue2);

#ifdef __cplusplus

ZIG_DECL JSC__JSValue FileSink__close(JSC__JSGlobalObject* arg0, void* arg1);
BUN_DECLARE_HOST_FUNCTION(FileSink__construct);
BUN_DECLARE_HOST_FUNCTION(FileSink__end);
ZIG_DECL JSC__JSValue SYSV_ABI FileSink__endWithSink(void* arg0, JSC__JSGlobalObject* arg1);
ZIG_DECL void FileSink__finalize(void* arg0);
BUN_DECLARE_HOST_FUNCTION(FileSink__flush);
BUN_DECLARE_HOST_FUNCTION(FileSink__start);
ZIG_DECL void FileSink__updateRef(void* arg0, bool arg1);
BUN_DECLARE_HOST_FUNCTION(FileSink__write);

#endif

#ifdef __cplusplus

ZIG_DECL void Bun__WebSocketHTTPClient__cancel(WebSocketHTTPClient* arg0);
ZIG_DECL WebSocketHTTPClient* Bun__WebSocketHTTPClient__connect(JSC__JSGlobalObject* arg0, void* arg1, CppWebSocket* arg2, const ZigString* arg3, uint16_t arg4, const ZigString* arg5, const ZigString* arg6, ZigString* arg7, ZigString* arg8, size_t arg9);
ZIG_DECL void Bun__WebSocketHTTPClient__register(JSC__JSGlobalObject* arg0, void* arg1, void* arg2);

#endif

#ifdef __cplusplus

ZIG_DECL void Bun__WebSocketHTTPSClient__cancel(WebSocketHTTPSClient* arg0);
ZIG_DECL WebSocketHTTPSClient* Bun__WebSocketHTTPSClient__connect(JSC__JSGlobalObject* arg0, void* arg1, CppWebSocket* arg2, const ZigString* arg3, uint16_t arg4, const ZigString* arg5, const ZigString* arg6, ZigString* arg7, ZigString* arg8, size_t arg9);
ZIG_DECL void Bun__WebSocketHTTPSClient__register(JSC__JSGlobalObject* arg0, void* arg1, void* arg2);

#endif

#ifdef __cplusplus

ZIG_DECL void Bun__WebSocketClient__cancel(WebSocketClient* arg0);
ZIG_DECL void Bun__WebSocketClient__close(WebSocketClient* arg0, uint16_t arg1, const ZigString* arg2);
ZIG_DECL void Bun__WebSocketClient__finalize(WebSocketClient* arg0);
ZIG_DECL void* Bun__WebSocketClient__init(CppWebSocket* arg0, void* arg1, void* arg2, JSC__JSGlobalObject* arg3, unsigned char* arg4, size_t arg5);
ZIG_DECL void Bun__WebSocketClient__register(JSC__JSGlobalObject* arg0, void* arg1, void* arg2);
ZIG_DECL void Bun__WebSocketClient__writeBinaryData(WebSocketClient* arg0, const unsigned char* arg1, size_t arg2, unsigned char arg3);
ZIG_DECL void Bun__WebSocketClient__writeString(WebSocketClient* arg0, const ZigString* arg1, unsigned char arg2);

#endif

#ifdef __cplusplus

ZIG_DECL void Bun__WebSocketClientTLS__cancel(WebSocketClientTLS* arg0);
ZIG_DECL void Bun__WebSocketClientTLS__close(WebSocketClientTLS* arg0, uint16_t arg1, const ZigString* arg2);
ZIG_DECL void Bun__WebSocketClientTLS__finalize(WebSocketClientTLS* arg0);
ZIG_DECL void* Bun__WebSocketClientTLS__init(CppWebSocket* arg0, void* arg1, void* arg2, JSC__JSGlobalObject* arg3, unsigned char* arg4, size_t arg5);
ZIG_DECL void Bun__WebSocketClientTLS__register(JSC__JSGlobalObject* arg0, void* arg1, void* arg2);
ZIG_DECL void Bun__WebSocketClientTLS__writeBinaryData(WebSocketClientTLS* arg0, const unsigned char* arg1, size_t arg2, unsigned char arg3);
ZIG_DECL void Bun__WebSocketClientTLS__writeString(WebSocketClientTLS* arg0, const ZigString* arg1, unsigned char arg2);

#endif

#ifdef __cplusplus

ZIG_DECL void Bun__Process__exit(JSC__JSGlobalObject* arg0, unsigned char arg1);
ZIG_DECL JSC__JSValue Bun__Process__getArgv(JSC__JSGlobalObject* arg0);
ZIG_DECL JSC__JSValue Bun__Process__getArgv0(JSC__JSGlobalObject* arg0);
ZIG_DECL JSC__JSValue Bun__Process__getCwd(JSC__JSGlobalObject* arg0);
ZIG_DECL JSC__JSValue Bun__Process__getExecArgv(JSC__JSGlobalObject* arg0);
ZIG_DECL JSC__JSValue Bun__Process__getExecPath(JSC__JSGlobalObject* arg0);
ZIG_DECL void Bun__Process__getTitle(JSC__JSGlobalObject* arg0, ZigString* arg1);
ZIG_DECL JSC__JSValue Bun__Process__setCwd(JSC__JSGlobalObject* arg0, ZigString* arg1);
ZIG_DECL JSC__JSValue Bun__Process__setTitle(JSC__JSGlobalObject* arg0, ZigString* arg1);

#endif
CPP_DECL ZigException ZigException__fromException(JSC__Exception* arg0);

#pragma mark - Bun::ConsoleObject


#ifdef __cplusplus

extern "C" SYSV_ABI void Bun__ConsoleObject__count(void* arg0, JSC__JSGlobalObject* arg1, const unsigned char* arg2, size_t arg3);
extern "C" SYSV_ABI void Bun__ConsoleObject__countReset(void* arg0, JSC__JSGlobalObject* arg1, const unsigned char* arg2, size_t arg3);
extern "C" SYSV_ABI void Bun__ConsoleObject__messageWithTypeAndLevel(void* arg0, uint32_t MessageType1, uint32_t MessageLevel2, JSC__JSGlobalObject* arg3, JSC__JSValue* arg4, size_t arg5);
extern "C" SYSV_ABI void Bun__ConsoleObject__profile(void* arg0, JSC__JSGlobalObject* arg1, const unsigned char* arg2, size_t arg3);
extern "C" SYSV_ABI void Bun__ConsoleObject__profileEnd(void* arg0, JSC__JSGlobalObject* arg1, const unsigned char* arg2, size_t arg3);
extern "C" SYSV_ABI void Bun__ConsoleObject__record(void* arg0, JSC__JSGlobalObject* arg1, ScriptArguments* arg2);
extern "C" SYSV_ABI void Bun__ConsoleObject__recordEnd(void* arg0, JSC__JSGlobalObject* arg1, ScriptArguments* arg2);
extern "C" SYSV_ABI void Bun__ConsoleObject__screenshot(void* arg0, JSC__JSGlobalObject* arg1, ScriptArguments* arg2);
extern "C" SYSV_ABI void Bun__ConsoleObject__takeHeapSnapshot(void* arg0, JSC__JSGlobalObject* arg1, const unsigned char* arg2, size_t arg3);
extern "C" SYSV_ABI void Bun__ConsoleObject__time(void* arg0, JSC__JSGlobalObject* arg1, const unsigned char* arg2, size_t arg3);
extern "C" SYSV_ABI void Bun__ConsoleObject__timeEnd(void* arg0, JSC__JSGlobalObject* arg1, const unsigned char* arg2, size_t arg3);
extern "C" SYSV_ABI void Bun__ConsoleObject__timeLog(void* arg0, JSC__JSGlobalObject* arg1, const unsigned char* arg2, size_t arg3, JSC__JSValue* arg4, size_t arg5);
extern "C" SYSV_ABI void Bun__ConsoleObject__timeStamp(void* arg0, JSC__JSGlobalObject* arg1, ScriptArguments* arg2);

#endif

#pragma mark - Bun__Timer


#ifdef __cplusplus

ZIG_DECL JSC__JSValue Bun__Timer__clearInterval(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);
ZIG_DECL JSC__JSValue Bun__Timer__clearTimeout(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1);
ZIG_DECL int32_t Bun__Timer__getNextID();
ZIG_DECL JSC__JSValue Bun__Timer__setInterval(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue JSValue2, JSC__JSValue JSValue3);
ZIG_DECL JSC__JSValue Bun__Timer__setTimeout(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue JSValue2, JSC__JSValue JSValue3);

#endif

#ifdef __cplusplus

BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContext__onReject);
BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContext__onRejectStream);
BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContext__onResolve);
BUN_DECLARE_HOST_FUNCTION(Bun__HTTPRequestContext__onResolveStream);

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

BUN_DECLARE_HOST_FUNCTION(Bun__TestScope__onReject);
BUN_DECLARE_HOST_FUNCTION(Bun__TestScope__onResolve);

#endif

#ifdef __cplusplus

CPP_DECL bool JSC__GetterSetter__isGetterNull(JSC__GetterSetter *arg);
CPP_DECL bool JSC__GetterSetter__isSetterNull(JSC__GetterSetter *arg);

CPP_DECL bool JSC__CustomGetterSetter__isGetterNull(JSC__CustomGetterSetter *arg);
CPP_DECL bool JSC__CustomGetterSetter__isSetterNull(JSC__CustomGetterSetter *arg);

#endif

// handwritten

#ifdef __cplusplus

BUN_DECLARE_HOST_FUNCTION(Bun__onResolveEntryPointResult);
BUN_DECLARE_HOST_FUNCTION(Bun__onRejectEntryPointResult);

#endif