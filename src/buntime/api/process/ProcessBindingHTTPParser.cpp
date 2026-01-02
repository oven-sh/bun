#include "ProcessBindingHTTPParser.h"
#include "ZigGlobalObject.h"
#include "llhttp/llhttp.h"

namespace Bun {

using namespace JSC;

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

} // namespace Bun
