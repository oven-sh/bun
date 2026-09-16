#include "ProcessBindingHTTPParser.h"
#include "ZigGlobalObject.h"
#include "llhttp/llhttp.h"

namespace Bun {

using namespace JSC;

#define METHOD_NAME_LITERAL(num, name, string) #string ""_s,
static constexpr ASCIILiteral httpMethodNames[] = { HTTP_METHOD_MAP(METHOD_NAME_LITERAL) };
static constexpr ASCIILiteral httpAllMethodNames[] = { HTTP_ALL_METHOD_MAP(METHOD_NAME_LITERAL) };
#undef METHOD_NAME_LITERAL

static JSValue methodNamesArray(VM& vm, JSObject* binding, std::span<const ASCIILiteral> names)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSGlobalObject* globalObject = binding->globalObject();
    JSArray* methods = constructEmptyArray(globalObject, nullptr, names.size());
    RETURN_IF_EXCEPTION(scope, {});
    for (unsigned i = 0; i < names.size(); ++i) {
        methods->putDirectIndex(globalObject, i, jsString(vm, String(names[i])));
        RETURN_IF_EXCEPTION(scope, {});
    }
    return methods;
}

static JSValue ProcessBindingHTTPParser_methods(VM& vm, JSObject* binding)
{
    static_assert(std::size(httpMethodNames) == 35);
    return methodNamesArray(vm, binding, httpMethodNames);
}

static JSValue ProcessBindingHTTPParser_allMethods(VM& vm, JSObject* binding)
{
    static_assert(std::size(httpAllMethodNames) == 47);
    return methodNamesArray(vm, binding, httpAllMethodNames);
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

} // namespace Bun
