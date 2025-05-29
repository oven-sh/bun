#include "ProcessBindingHTTPParser.h"
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

// clang-format off
#define HTTP_METHOD_MAP(XX)          \
    XX(0, DELETE, DELETE)            \
    XX(1, GET, GET)                  \
    XX(2, HEAD, HEAD)                \
    XX(3, POST, POST)                \
    XX(4, PUT, PUT)                  \
    XX(5, CONNECT, CONNECT)          \
    XX(6, OPTIONS, OPTIONS)          \
    XX(7, TRACE, TRACE)              \
    XX(8, COPY, COPY)                \
    XX(9, LOCK, LOCK)                \
    XX(10, MKCOL, MKCOL)             \
    XX(11, MOVE, MOVE)               \
    XX(12, PROPFIND, PROPFIND)       \
    XX(13, PROPPATCH, PROPPATCH)     \
    XX(14, SEARCH, SEARCH)           \
    XX(15, UNLOCK, UNLOCK)           \
    XX(16, BIND, BIND)               \
    XX(17, REBIND, REBIND)           \
    XX(18, UNBIND, UNBIND)           \
    XX(19, ACL, ACL)                 \
    XX(20, REPORT, REPORT)           \
    XX(21, MKACTIVITY, MKACTIVITY)   \
    XX(22, CHECKOUT, CHECKOUT)       \
    XX(23, MERGE, MERGE)             \
    XX(24, MSEARCH, M-SEARCH)        \
    XX(25, NOTIFY, NOTIFY)           \
    XX(26, SUBSCRIBE, SUBSCRIBE)     \
    XX(27, UNSUBSCRIBE, UNSUBSCRIBE) \
    XX(28, PATCH, PATCH)             \
    XX(29, PURGE, PURGE)             \
    XX(30, MKCALENDAR, MKCALENDAR)   \
    XX(31, LINK, LINK)               \
    XX(32, UNLINK, UNLINK)           \
    XX(33, SOURCE, SOURCE)           \
    XX(46, QUERY, QUERY)
// clang-format on

static JSValue ProcessBindingHTTPParser_methods(VM& vm, JSObject* binding)
{
    JSGlobalObject* globalObject = binding->globalObject();

    JSArray* methods = constructEmptyArray(globalObject, nullptr, 35);

    int index = 0;
#define FOR_EACH_METHOD(num, name, string) \
    methods->putDirectIndex(globalObject, index++, jsString(vm, #string##_str));
    HTTP_METHOD_MAP(FOR_EACH_METHOD)
#undef FOR_EACH_METHOD

    return methods;
}

// clang-format off
#define HTTP_ALL_METHOD_MAP(XX)          \
    XX(0, DELETE, DELETE)                \
    XX(1, GET, GET)                      \
    XX(2, HEAD, HEAD)                    \
    XX(3, POST, POST)                    \
    XX(4, PUT, PUT)                      \
    XX(5, CONNECT, CONNECT)              \
    XX(6, OPTIONS, OPTIONS)              \
    XX(7, TRACE, TRACE)                  \
    XX(8, COPY, COPY)                    \
    XX(9, LOCK, LOCK)                    \
    XX(10, MKCOL, MKCOL)                 \
    XX(11, MOVE, MOVE)                   \
    XX(12, PROPFIND, PROPFIND)           \
    XX(13, PROPPATCH, PROPPATCH)         \
    XX(14, SEARCH, SEARCH)               \
    XX(15, UNLOCK, UNLOCK)               \
    XX(16, BIND, BIND)                   \
    XX(17, REBIND, REBIND)               \
    XX(18, UNBIND, UNBIND)               \
    XX(19, ACL, ACL)                     \
    XX(20, REPORT, REPORT)               \
    XX(21, MKACTIVITY, MKACTIVITY)       \
    XX(22, CHECKOUT, CHECKOUT)           \
    XX(23, MERGE, MERGE)                 \
    XX(24, MSEARCH, M-SEARCH)            \
    XX(25, NOTIFY, NOTIFY)               \
    XX(26, SUBSCRIBE, SUBSCRIBE)         \
    XX(27, UNSUBSCRIBE, UNSUBSCRIBE)     \
    XX(28, PATCH, PATCH)                 \
    XX(29, PURGE, PURGE)                 \
    XX(30, MKCALENDAR, MKCALENDAR)       \
    XX(31, LINK, LINK)                   \
    XX(32, UNLINK, UNLINK)               \
    XX(33, SOURCE, SOURCE)               \
    XX(34, PRI, PRI)                     \
    XX(35, DESCRIBE, DESCRIBE)           \
    XX(36, ANNOUNCE, ANNOUNCE)           \
    XX(37, SETUP, SETUP)                 \
    XX(38, PLAY, PLAY)                   \
    XX(39, PAUSE, PAUSE)                 \
    XX(40, TEARDOWN, TEARDOWN)           \
    XX(41, GET_PARAMETER, GET_PARAMETER) \
    XX(42, SET_PARAMETER, SET_PARAMETER) \
    XX(43, REDIRECT, REDIRECT)           \
    XX(44, RECORD, RECORD)               \
    XX(45, FLUSH, FLUSH)                 \
    XX(46, QUERY, QUERY)
// clang-format on

static JSValue ProcessBindingHTTPParser_allMethods(VM& vm, JSObject* binding)
{
    JSGlobalObject* globalObject = binding->globalObject();

    JSArray* methods = constructEmptyArray(globalObject, nullptr, 47);

    int index = 0;
#define FOR_EACH_METHOD(num, name, string) \
    methods->putDirectIndex(globalObject, index++, jsString(vm, #string##_str));
    HTTP_ALL_METHOD_MAP(FOR_EACH_METHOD)
#undef FOR_EACH_METHOD

    return methods;
}

static JSValue ProcessBindingHTTPParser_HTTPParser(VM& vm, JSObject* binding)
{
    auto* lexicalGlobalObject = binding->globalObject();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    return globalObject->m_JSHTTPParserClassStructure.constructor(lexicalGlobalObject);
}

static JSValue ProcessBindingHTTPParser_ConnectionsList(VM& vm, JSObject* binding)
{
    auto* lexicalGlobalObject = binding->globalObject();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    return globalObject->m_JSConnectionsListClassStructure.constructor(lexicalGlobalObject);
}

/* Source for ProcessBindingHTTPParser.lut.h
@begin processBindingHTTPParserTable
    methods                     ProcessBindingHTTPParser_methods            PropertyCallback
    allMethods                  ProcessBindingHTTPParser_allMethods         PropertyCallback
    HTTPParser                  ProcessBindingHTTPParser_HTTPParser         PropertyCallback
    ConnectionsList             ProcessBindingHTTPParser_ConnectionsList    PropertyCallback
@end
*/

#include "ProcessBindingHTTPParser.lut.h"

const ClassInfo ProcessBindingHTTPParser::s_info = { "ProcessBindingHTTPParser"_s, &Base::s_info, &processBindingHTTPParserTable, nullptr, CREATE_METHOD_TABLE(ProcessBindingHTTPParser) };

ProcessBindingHTTPParser* ProcessBindingHTTPParser::create(VM& vm, Structure* structure)
{
    ProcessBindingHTTPParser* binding = new (NotNull, allocateCell<ProcessBindingHTTPParser>(vm)) ProcessBindingHTTPParser(vm, structure);
    binding->finishCreation(vm);
    return binding;
}

Structure* ProcessBindingHTTPParser::createStructure(VM& vm, JSGlobalObject* globalObject)
{
    return Structure::create(vm, globalObject, jsNull(), TypeInfo(ObjectType, StructureFlags), info());
}

void ProcessBindingHTTPParser::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

template<typename Visitor>
void ProcessBindingHTTPParser::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    ProcessBindingHTTPParser* thisObject = jsCast<ProcessBindingHTTPParser*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(ProcessBindingHTTPParser);

} // namespace Bun
