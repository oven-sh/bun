#include "root.h"
#include "BunBuiltinNames.h"
#include "BunCommonStrings.h"
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include "ZigGlobalObject.h"
#include <JavaScriptCore/SlotVisitorInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>

namespace Bun {
using namespace JSC;

// Every entry's text, by Index. Identifier-backed entries share the identifier's atom (see identifierAt).
#define BUN_COMMON_STRINGS_LITERAL_ENTRY(name, builtinName) #builtinName##_s,
#define BUN_COMMON_STRINGS_LITERAL_ENTRY_VM_PROPERTY_NAME(name, propertyName, literal) literal##_s,
#define BUN_COMMON_STRINGS_LITERAL_ENTRY_NOT_BUILTIN_NAMES(name, literal) literal##_s,
// clang-format off
static constexpr ASCIILiteral commonStringLiterals[] = {
    BUN_COMMON_STRINGS_EACH_NAME(BUN_COMMON_STRINGS_LITERAL_ENTRY)
    BUN_COMMON_STRINGS_EACH_VM_PROPERTY_NAME(BUN_COMMON_STRINGS_LITERAL_ENTRY_VM_PROPERTY_NAME)
    BUN_COMMON_STRINGS_EACH_NAME_NOT_BUILTIN_NAMES(BUN_COMMON_STRINGS_LITERAL_ENTRY_NOT_BUILTIN_NAMES)
};
// clang-format on
#undef BUN_COMMON_STRINGS_LITERAL_ENTRY
#undef BUN_COMMON_STRINGS_LITERAL_ENTRY_VM_PROPERTY_NAME
#undef BUN_COMMON_STRINGS_LITERAL_ENTRY_NOT_BUILTIN_NAMES
static_assert(std::size(commonStringLiterals) == static_cast<size_t>(CommonStrings::Index::Count));

// The identifier an entry shares its atom with, or null for a literal-only entry.
static const JSC::Identifier* identifierAt(VM& vm, CommonStrings::Index index)
{
    switch (index) {
#define BUN_COMMON_STRINGS_BUILTIN_NAME_CASE(name, builtinName) \
    case CommonStrings::Index::name:                            \
        return &WebCore::builtinNames(vm).builtinName##PublicName();
        BUN_COMMON_STRINGS_EACH_NAME(BUN_COMMON_STRINGS_BUILTIN_NAME_CASE)
#undef BUN_COMMON_STRINGS_BUILTIN_NAME_CASE
#define BUN_COMMON_STRINGS_VM_PROPERTY_NAME_CASE(name, propertyName, literal) \
    case CommonStrings::Index::name:                                          \
        return &vm.propertyNames->propertyName;
        BUN_COMMON_STRINGS_EACH_VM_PROPERTY_NAME(BUN_COMMON_STRINGS_VM_PROPERTY_NAME_CASE)
#undef BUN_COMMON_STRINGS_VM_PROPERTY_NAME_CASE
    default:
        return nullptr;
    }
}

void CommonStrings::initialize(JSString*& slot, Index index)
{
    ASSERT(m_vm.currentThreadIsHoldingAPILock());
    auto literal = commonStringLiterals[static_cast<size_t>(index)];
    if (const auto* identifier = identifierAt(m_vm, index)) {
        ASSERT(identifier->string() == literal);
        slot = jsOwnedString(m_vm, identifier->string());
        return;
    }
    slot = jsString(m_vm, AtomString(literal));
}

template<typename Visitor>
void CommonStrings::visit(Visitor& visitor)
{
#define BUN_COMMON_STRINGS_VISIT(name, ...) \
    if (m_##name)                           \
        visitor.appendUnbarriered(m_##name);
    BUN_COMMON_STRINGS_EACH_NAME(BUN_COMMON_STRINGS_VISIT)
    BUN_COMMON_STRINGS_EACH_VM_PROPERTY_NAME(BUN_COMMON_STRINGS_VISIT)
    BUN_COMMON_STRINGS_EACH_NAME_NOT_BUILTIN_NAMES(BUN_COMMON_STRINGS_VISIT)
#undef BUN_COMMON_STRINGS_VISIT
}

template void CommonStrings::visit(JSC::AbstractSlotVisitor&);
template void CommonStrings::visit(JSC::SlotVisitor&);

#if ASSERT_ENABLED
bool CommonStrings::isCommonStringLiteral(std::span<const Latin1Character> literal)
{
    for (const auto& entry : commonStringLiterals) {
        if (equalSpans(entry.span8(), literal))
            return true;
    }
    return false;
}
#endif

// Must be kept in sync with src/http_types/Method.rs
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
    auto& commonStrings = Bun::commonStrings(globalObject->vm());
#define FOR_EACH_METHOD(method)    \
    case HTTPMethod::http##method: \
        return commonStrings.http##method##String();

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

// Must be kept in sync with src/jsc/CommonStrings.rs
enum class CommonStringsForRust : uint8_t {
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
    binaryTypeBlob = 13,
    unknown = 14,
    protocolHttp = 15,
    protocolHttps = 16,
    alpnH2 = 17,
    alpnHttp11 = 18,
    utf8WithDash = 19,
    quicDatagramAbandoned = 20,
    quicDatagramAcknowledged = 21,
    quicDatagramLost = 22,
    base64 = 23,
};

static JSC::JSValue toJS(Zig::GlobalObject* globalObject, CommonStringsForRust commonString)
{
    auto& commonStrings = Bun::commonStrings(globalObject->vm());
    switch (commonString) {
    case CommonStringsForRust::IPv4:
        return commonStrings.IPv4String();
    case CommonStringsForRust::IPv6:
        return commonStrings.IPv6String();
    case CommonStringsForRust::IN4Loopback:
        return commonStrings.IN4LoopbackString();
    case CommonStringsForRust::IN6Any:
        return commonStrings.IN6AnyString();
    case CommonStringsForRust::ipv4Lower:
        return commonStrings.ipv4LowerString();
    case CommonStringsForRust::ipv6Lower:
        return commonStrings.ipv6LowerString();
    case CommonStringsForRust::fetchDefault:
        return globalObject->vm().smallStrings.defaultString();
    case CommonStringsForRust::fetchError:
        return commonStrings.fetchErrorString();
    case CommonStringsForRust::fetchInclude:
        return commonStrings.fetchIncludeString();
    case CommonStringsForRust::buffer:
        return commonStrings.bufferString();
    case CommonStringsForRust::binaryTypeArrayBuffer:
        return commonStrings.binaryTypeArrayBufferString();
    case CommonStringsForRust::binaryTypeNodeBuffer:
        return commonStrings.binaryTypeNodeBufferString();
    case CommonStringsForRust::binaryTypeUint8Array:
        return commonStrings.binaryTypeUint8ArrayString();
    case CommonStringsForRust::binaryTypeBlob:
        return commonStrings.binaryTypeBlobString();
    case CommonStringsForRust::unknown:
        return commonStrings.unknownString();
    case CommonStringsForRust::protocolHttp:
        return commonStrings.protocolHttpString();
    case CommonStringsForRust::protocolHttps:
        return commonStrings.protocolHttpsString();
    case CommonStringsForRust::alpnH2:
        return commonStrings.alpnH2String();
    case CommonStringsForRust::alpnHttp11:
        return commonStrings.alpnHttp11String();
    case CommonStringsForRust::utf8WithDash:
        return commonStrings.utf8WithDashString();
    case CommonStringsForRust::quicDatagramAbandoned:
        return commonStrings.quicDatagramAbandonedString();
    case CommonStringsForRust::quicDatagramAcknowledged:
        return commonStrings.quicDatagramAcknowledgedString();
    case CommonStringsForRust::quicDatagramLost:
        return commonStrings.quicDatagramLostString();
    case CommonStringsForRust::base64:
        return commonStrings.base64String();
    default: {
        ASSERT_NOT_REACHED();
        return jsUndefined();
    }
    }
}

extern "C" JSC::EncodedJSValue Bun__CommonStringsForRust__toJS(CommonStringsForRust commonString, Zig::GlobalObject* globalObject)
{
    return JSValue::encode(toJS(globalObject, commonString));
}

// Must be kept in sync with src/http_types/FetchCacheMode.rs
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
    auto& commonStrings = Bun::commonStrings(globalObject->vm());
    switch (mode) {
    case FetchCacheMode::Default:
        return JSValue::encode(globalObject->vm().smallStrings.defaultString());
    case FetchCacheMode::NoStore:
        return JSValue::encode(commonStrings.fetchNoStoreString());
    case FetchCacheMode::Reload:
        return JSValue::encode(commonStrings.fetchReloadString());
    case FetchCacheMode::NoCache:
        return JSValue::encode(commonStrings.fetchNoCacheString());
    case FetchCacheMode::ForceCache:
        return JSValue::encode(commonStrings.fetchForceCacheString());
    case FetchCacheMode::OnlyIfCached:
        return JSValue::encode(commonStrings.fetchOnlyIfCachedString());
    default: {
        ASSERT_NOT_REACHED();
        return JSValue::encode(jsUndefined());
    }
    }
}

// Must be kept in sync with src/http_types/FetchRedirect.rs
enum class FetchRedirect : uint8_t {
    Follow = 0,
    Manual = 1,
    Error = 2,
};

extern "C" JSC::EncodedJSValue Bun__FetchRedirect__toJS(FetchRedirect redirect, Zig::GlobalObject* globalObject)
{
    auto& commonStrings = Bun::commonStrings(globalObject->vm());
    switch (redirect) {
    case FetchRedirect::Follow:
        return JSValue::encode(commonStrings.fetchFollowString());
    case FetchRedirect::Manual:
        return JSValue::encode(commonStrings.fetchManualString());
    case FetchRedirect::Error:
        return JSValue::encode(commonStrings.fetchErrorString());
    default: {
        ASSERT_NOT_REACHED();
        return JSValue::encode(jsUndefined());
    }
    }
}

// Must be kept in sync with src/http_types/FetchRequestMode.rs
enum class FetchRequestMode : uint8_t {
    SameOrigin = 0,
    NoCors = 1,
    Cors = 2,
    Navigate = 3,
};

extern "C" JSC::EncodedJSValue Bun__FetchRequestMode__toJS(FetchRequestMode mode, Zig::GlobalObject* globalObject)
{
    auto& commonStrings = Bun::commonStrings(globalObject->vm());
    switch (mode) {
    case FetchRequestMode::SameOrigin:
        return JSValue::encode(commonStrings.fetchSameOriginString());
    case FetchRequestMode::NoCors:
        return JSValue::encode(commonStrings.fetchNoCorsString());
    case FetchRequestMode::Cors:
        return JSValue::encode(commonStrings.fetchCorsString());
    case FetchRequestMode::Navigate:
        return JSValue::encode(commonStrings.fetchNavigateString());
    default: {
        ASSERT_NOT_REACHED();
        return JSValue::encode(jsUndefined());
    }
    }
}

} // namespace Bun
