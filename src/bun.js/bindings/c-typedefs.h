#pragma once

#ifdef __cplusplus
#include "root.h"
#define DECLARE_TYPE_FOR_C_AND_CPP(ns, T) \
    namespace ns {                        \
    class T;                              \
    }                                     \
    using ns##__##T = ns::T

using JSC__EncodedJSValue = JSC::EncodedJSValue;
// We can't handle JSUint8Array with DECLARE_TYPE_FOR_C_AND_CPP because the C++ definition is a
// template instantiation, not a regular class
using JSC__JSUint8Array = JSC::JSUint8Array;
using WTF__OrdinalNumber = WTF::OrdinalNumber;
#define AUTO_EXTERN_C extern "C"
#else
#ifdef _WIN32
#define SYSV_ABI __attribute__((sysv_abi))
#else
#define SYSV_ABI
#endif

#define DECLARE_TYPE_FOR_C_AND_CPP(ns, T) typedef struct ns##__##T ns##__##T
typedef int64_t JSC__EncodedJSValue;
typedef struct JSC__JSUint8Array JSC__JSUint8Array;
typedef int WTF__OrdinalNumber;
#define AUTO_EXTERN_C
#endif

DECLARE_TYPE_FOR_C_AND_CPP(JSC, JSGlobalObject);
DECLARE_TYPE_FOR_C_AND_CPP(JSC, Exception);
DECLARE_TYPE_FOR_C_AND_CPP(JSC, JSObject);
DECLARE_TYPE_FOR_C_AND_CPP(JSC, JSInternalPromise);
DECLARE_TYPE_FOR_C_AND_CPP(JSC, JSString);
DECLARE_TYPE_FOR_C_AND_CPP(JSC, JSCell);
DECLARE_TYPE_FOR_C_AND_CPP(JSC, JSMap);
DECLARE_TYPE_FOR_C_AND_CPP(JSC, JSPromise);
DECLARE_TYPE_FOR_C_AND_CPP(JSC, CatchScope);
DECLARE_TYPE_FOR_C_AND_CPP(JSC, VM);
DECLARE_TYPE_FOR_C_AND_CPP(JSC, ThrowScope);
DECLARE_TYPE_FOR_C_AND_CPP(JSC, CallFrame);
DECLARE_TYPE_FOR_C_AND_CPP(JSC, GetterSetter);
DECLARE_TYPE_FOR_C_AND_CPP(JSC, CustomGetterSetter);
DECLARE_TYPE_FOR_C_AND_CPP(JSC, SourceProvider);
DECLARE_TYPE_FOR_C_AND_CPP(JSC, Structure);

DECLARE_TYPE_FOR_C_AND_CPP(WebCore, FetchHeaders);
DECLARE_TYPE_FOR_C_AND_CPP(WebCore, DOMFormData);
DECLARE_TYPE_FOR_C_AND_CPP(WebCore, AbortSignal);
DECLARE_TYPE_FOR_C_AND_CPP(WebCore, DOMURL);

DECLARE_TYPE_FOR_C_AND_CPP(WTF, StringImpl);
DECLARE_TYPE_FOR_C_AND_CPP(WTF, String);
