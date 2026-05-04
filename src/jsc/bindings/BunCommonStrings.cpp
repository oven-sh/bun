#include "root.h"
#include "BunBuiltinNames.h"
#include "BunCommonStrings.h"
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include "ZigGlobalObject.h"
#include <JavaScriptCore/SlotVisitorInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>

namespace Bun {
using namespace JSC;

#define BUN_COMMON_STRINGS_LAZY_PROPERTY_DEFINITION(jsName)                        \
    this->m_commonString_##jsName.initLater(                                       \
        [](const JSC::LazyProperty<JSGlobalObject, JSString>::Initializer& init) { \
            auto& names = WebCore::builtinNames(init.vm);                          \
            auto name = names.jsName##PublicName();                                \
            init.set(jsOwnedString(init.vm, name.string()));                       \
        });

#define BUN_COMMON_STRINGS_LAZY_PROPERTY_DEFINITION_NOT_BUILTIN_NAMES(methodName, stringLiteral) \
    this->m_commonString_##methodName.initLater(                                                 \
        [](const JSC::LazyProperty<JSGlobalObject, JSString>::Initializer& init) {               \
            init.set(jsString(init.vm, AtomString(stringLiteral##_s)));                          \
        });

#define BUN_COMMON_STRINGS_LAZY_PROPERTY_VISITOR(name) this->m_commonString_##name.visit(visitor);
#define BUN_COMMON_STRINGS_LAZY_PROPERTY_VISITOR_NOT_BUILTIN_NAMES(name, literal) this->m_commonString_##name.visit(visitor);

void CommonStrings::initialize()
{
    BUN_COMMON_STRINGS_EACH_NAME(BUN_COMMON_STRINGS_LAZY_PROPERTY_DEFINITION)
    BUN_COMMON_STRINGS_EACH_NAME_NOT_BUILTIN_NAMES(BUN_COMMON_STRINGS_LAZY_PROPERTY_DEFINITION_NOT_BUILTIN_NAMES)
}

template<typename Visitor>
void CommonStrings::visit(Visitor& visitor)
{
    BUN_COMMON_STRINGS_EACH_NAME(BUN_COMMON_STRINGS_LAZY_PROPERTY_VISITOR)
    BUN_COMMON_STRINGS_EACH_NAME_NOT_BUILTIN_NAMES(BUN_COMMON_STRINGS_LAZY_PROPERTY_VISITOR_NOT_BUILTIN_NAMES)
}

template void CommonStrings::visit(JSC::AbstractSlotVisitor&);
template void CommonStrings::visit(JSC::SlotVisitor&);

// Must be kept in sync with method.zig
enum class HTTPMethod : uint8_t {
    httpACL = 0,
    httpBIND = 1,
    httpCHECKOUT = 2,
    httpCONNECT = 3,
    httpCOPY = 4,
    // "DELETE" is defined in one of the windows headers
    httpDELETE = 5,
    httpGET = 6,
    httpHEAD = 7,
    httpLINK = 8,
    httpLOCK = 9,
    httpMSEARCH = 10,
    httpMERGE = 11,
    httpMKACTIVITY = 12,
    httpMKADDRESSBOOK = 13,
    httpMKCALENDAR = 14,
    httpMKCOL = 15,
    httpMOVE = 16,
    httpNOTIFY = 17,
    httpOPTIONS = 18,
    httpPATCH = 19,
    httpPOST = 20,
    httpPROPFIND = 21,
    httpPROPPATCH = 22,
    httpPURGE = 23,
    httpPUT = 24,
    httpQUERY = 25,
    httpREBIND = 26,
    httpREPORT = 27,
    httpSEARCH = 28,
    httpSOURCE = 29,
    httpSUBSCRIBE = 30,
    httpTRACE = 31,
    httpUNBIND = 32,
    httpUNLINK = 33,
    httpUNLOCK = 34,
    httpUNSUBSCRIBE = 35,
};

static JSC::JSValue toJS(Zig::GlobalObject* globalObject, HTTPMethod method)
{
#define FOR_EACH_METHOD(method)    \
    case HTTPMethod::http##method: \
        return globalObject->commonStrings().http##method##String(globalObject);

    switch (method) {
        FOR_EACH_METHOD(ACL)
        FOR_EACH_METHOD(BIND)
        FOR_EACH_METHOD(CHECKOUT)
        FOR_EACH_METHOD(CONNECT)
        FOR_EACH_METHOD(COPY)
        FOR_EACH_METHOD(DELETE)
        FOR_EACH_METHOD(GET)
        FOR_EACH_METHOD(HEAD)
        FOR_EACH_METHOD(LINK)
        FOR_EACH_METHOD(LOCK)
        FOR_EACH_METHOD(MSEARCH)
        FOR_EACH_METHOD(MERGE)
        FOR_EACH_METHOD(MKACTIVITY)
        FOR_EACH_METHOD(MKADDRESSBOOK)
        FOR_EACH_METHOD(MKCALENDAR)
        FOR_EACH_METHOD(MKCOL)
        FOR_EACH_METHOD(MOVE)
        FOR_EACH_METHOD(NOTIFY)
        FOR_EACH_METHOD(OPTIONS)
        FOR_EACH_METHOD(PATCH)
        FOR_EACH_METHOD(POST)
        FOR_EACH_METHOD(PROPFIND)
        FOR_EACH_METHOD(PROPPATCH)
        FOR_EACH_METHOD(PURGE)
        FOR_EACH_METHOD(PUT)
        FOR_EACH_METHOD(QUERY)
        FOR_EACH_METHOD(REBIND)
        FOR_EACH_METHOD(REPORT)
        FOR_EACH_METHOD(SEARCH)
        FOR_EACH_METHOD(SOURCE)
        FOR_EACH_METHOD(SUBSCRIBE)
        FOR_EACH_METHOD(TRACE)
        FOR_EACH_METHOD(UNBIND)
        FOR_EACH_METHOD(UNLINK)
        FOR_EACH_METHOD(UNLOCK)
        FOR_EACH_METHOD(UNSUBSCRIBE)

    default: {
        ASSERT_NOT_REACHED();
        return jsUndefined();
    }
    }
#undef FOR_EACH_METHOD
}

extern "C" JSC::EncodedJSValue Bun__HTTPMethod__toJS(HTTPMethod method, Zig::GlobalObject* globalObject)
{
    return JSValue::encode(toJS(globalObject, method));
}

enum class CommonStringsForZig : uint8_t {
    IPv4 = 0,
    IPv6 = 1,
    IN4Loopback = 2,
    IN6Any = 3,
    ipv4Lower = 4,
    ipv6Lower = 5,
    fetchDefault = 6,
    fetchError = 7,
    fetchInclude = 8,
    buffer = 9,
    binaryTypeArrayBuffer = 10,
    binaryTypeNodeBuffer = 11,
    binaryTypeUint8Array = 12,
};

static JSC::JSValue toJS(Zig::GlobalObject* globalObject, CommonStringsForZig commonString)
{
    auto& commonStrings = globalObject->commonStrings();
    switch (commonString) {
    case CommonStringsForZig::IPv4:
        return commonStrings.IPv4String(globalObject);
    case CommonStringsForZig::IPv6:
        return commonStrings.IPv6String(globalObject);
    case CommonStringsForZig::IN4Loopback:
        return commonStrings.IN4LoopbackString(globalObject);
    case CommonStringsForZig::IN6Any:
        return commonStrings.IN6AnyString(globalObject);
    case CommonStringsForZig::ipv4Lower:
        return commonStrings.ipv4LowerString(globalObject);
    case CommonStringsForZig::ipv6Lower:
        return commonStrings.ipv6LowerString(globalObject);
    case CommonStringsForZig::fetchDefault:
        return globalObject->vm().smallStrings.defaultString();
    case CommonStringsForZig::fetchError:
        return commonStrings.fetchErrorString(globalObject);
    case CommonStringsForZig::fetchInclude:
        return commonStrings.fetchIncludeString(globalObject);
    case CommonStringsForZig::buffer:
        return commonStrings.bufferString(globalObject);
    case CommonStringsForZig::binaryTypeArrayBuffer:
        return commonStrings.binaryTypeArrayBufferString(globalObject);
    case CommonStringsForZig::binaryTypeNodeBuffer:
        return commonStrings.binaryTypeNodeBufferString(globalObject);
    case CommonStringsForZig::binaryTypeUint8Array:
        return commonStrings.binaryTypeUint8ArrayString(globalObject);
    default: {
        ASSERT_NOT_REACHED();
        return jsUndefined();
    }
    }
}

extern "C" JSC::EncodedJSValue Bun__CommonStringsForZig__toJS(CommonStringsForZig commonString, Zig::GlobalObject* globalObject)
{
    return JSValue::encode(toJS(globalObject, commonString));
}

// Must be kept in sync with src/http/FetchCacheMode.zig
enum class FetchCacheMode : uint8_t {
    Default = 0,
    NoStore = 1,
    Reload = 2,
    NoCache = 3,
    ForceCache = 4,
    OnlyIfCached = 5,
};

extern "C" JSC::EncodedJSValue Bun__FetchCacheMode__toJS(FetchCacheMode mode, Zig::GlobalObject* globalObject)
{
    auto& commonStrings = globalObject->commonStrings();
    switch (mode) {
    case FetchCacheMode::Default:
        return JSValue::encode(globalObject->vm().smallStrings.defaultString());
    case FetchCacheMode::NoStore:
        return JSValue::encode(commonStrings.fetchNoStoreString(globalObject));
    case FetchCacheMode::Reload:
        return JSValue::encode(commonStrings.fetchReloadString(globalObject));
    case FetchCacheMode::NoCache:
        return JSValue::encode(commonStrings.fetchNoCacheString(globalObject));
    case FetchCacheMode::ForceCache:
        return JSValue::encode(commonStrings.fetchForceCacheString(globalObject));
    case FetchCacheMode::OnlyIfCached:
        return JSValue::encode(commonStrings.fetchOnlyIfCachedString(globalObject));
    default: {
        ASSERT_NOT_REACHED();
        return JSValue::encode(jsUndefined());
    }
    }
}

// Must be kept in sync with src/http/FetchRedirect.zig
enum class FetchRedirect : uint8_t {
    Follow = 0,
    Manual = 1,
    Error = 2,
};

extern "C" JSC::EncodedJSValue Bun__FetchRedirect__toJS(FetchRedirect redirect, Zig::GlobalObject* globalObject)
{
    auto& commonStrings = globalObject->commonStrings();
    switch (redirect) {
    case FetchRedirect::Follow:
        return JSValue::encode(commonStrings.fetchFollowString(globalObject));
    case FetchRedirect::Manual:
        return JSValue::encode(commonStrings.fetchManualString(globalObject));
    case FetchRedirect::Error:
        return JSValue::encode(commonStrings.fetchErrorString(globalObject));
    default: {
        ASSERT_NOT_REACHED();
        return JSValue::encode(jsUndefined());
    }
    }
}

// Must be kept in sync with src/http/FetchRequestMode.zig
enum class FetchRequestMode : uint8_t {
    SameOrigin = 0,
    NoCors = 1,
    Cors = 2,
    Navigate = 3,
};

extern "C" JSC::EncodedJSValue Bun__FetchRequestMode__toJS(FetchRequestMode mode, Zig::GlobalObject* globalObject)
{
    auto& commonStrings = globalObject->commonStrings();
    switch (mode) {
    case FetchRequestMode::SameOrigin:
        return JSValue::encode(commonStrings.fetchSameOriginString(globalObject));
    case FetchRequestMode::NoCors:
        return JSValue::encode(commonStrings.fetchNoCorsString(globalObject));
    case FetchRequestMode::Cors:
        return JSValue::encode(commonStrings.fetchCorsString(globalObject));
    case FetchRequestMode::Navigate:
        return JSValue::encode(commonStrings.fetchNavigateString(globalObject));
    default: {
        ASSERT_NOT_REACHED();
        return JSValue::encode(jsUndefined());
    }
    }
}

} // namespace Bun
