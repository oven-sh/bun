#include "ProcessBindingHTTPParser.h"
#include "ZigGlobalObject.h"

extern "C" SYSV_ABI JSC::EncodedJSValue Bun__HTTPParser__createMethods(JSC::JSGlobalObject*);
extern "C" SYSV_ABI JSC::EncodedJSValue Bun__HTTPParser__createAllMethods(JSC::JSGlobalObject*);
extern "C" SYSV_ABI JSC::EncodedJSValue Bun__HTTPParser__createConstructor(JSC::JSGlobalObject*);

namespace Bun {

using namespace JSC;

template<auto create>
static JSValue createInRust(VM& vm, JSObject* binding)
{
    // reifyAllStaticProperties calls PropertyCallback builders without checking for exceptions, so check here.
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue value = JSValue::decode(create(defaultGlobalObject(binding->globalObject())));
    RETURN_IF_EXCEPTION(scope, {});
    return value;
}

static constexpr auto ProcessBindingHTTPParser_methods = createInRust<Bun__HTTPParser__createMethods>;
static constexpr auto ProcessBindingHTTPParser_allMethods = createInRust<Bun__HTTPParser__createAllMethods>;
static constexpr auto ProcessBindingHTTPParser_HTTPParser = createInRust<Bun__HTTPParser__createConstructor>;

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
