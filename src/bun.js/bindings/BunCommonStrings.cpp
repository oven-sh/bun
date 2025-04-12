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
            init.set(jsOwnedString(init.vm, stringLiteral##_s));                                 \
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
    ACL = 0,
    BIND = 1,
    CHECKOUT = 2,
    CONNECT = 3,
    COPY = 4,
    DELETE = 5,
    GET = 6,
    HEAD = 7,
    LINK = 8,
    LOCK = 9,
    MSEARCH = 10,
    MERGE = 11,
    MKACTIVITY = 12,
    MKCALENDAR = 13,
    MKCOL = 14,
    MOVE = 15,
    NOTIFY = 16,
    OPTIONS = 17,
    PATCH = 18,
    POST = 19,
    PROPFIND = 20,
    PROPPATCH = 21,
    PURGE = 22,
    PUT = 23,
    QUERY = 24,
    REBIND = 25,
    REPORT = 26,
    SEARCH = 27,
    SOURCE = 28,
    SUBSCRIBE = 29,
    TRACE = 30,
    UNBIND = 31,
    UNLINK = 32,
    UNLOCK = 33,
    UNSUBSCRIBE = 34,
};

static JSC::JSValue toJS(Zig::GlobalObject* globalObject, HTTPMethod method)
{
#define FOR_EACH_METHOD(method) \
    case HTTPMethod::method:    \
        return globalObject->commonStrings().method##String(globalObject);

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
};

static JSC::JSValue toJS(Zig::GlobalObject* globalObject, CommonStringsForZig commonString)
{
    switch (commonString) {
    case CommonStringsForZig::IPv4:
        return globalObject->commonStrings().IPv4String(globalObject);
    case CommonStringsForZig::IPv6:
        return globalObject->commonStrings().IPv6String(globalObject);
    case CommonStringsForZig::IN4Loopback:
        return globalObject->commonStrings().IN4LoopbackString(globalObject);
    case CommonStringsForZig::IN6Any:
        return globalObject->commonStrings().IN6AnyString(globalObject);
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

} // namespace Bun
