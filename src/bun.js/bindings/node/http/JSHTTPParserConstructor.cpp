#include "JSHTTPParserConstructor.h"
#include "JSHTTPParser.h"
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

const ClassInfo JSHTTPParserConstructor::s_info = { "HTTPParser"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSHTTPParserConstructor) };

JSC_DEFINE_HOST_FUNCTION(callHTTPParser, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(constructHTTPParser, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    Structure* structure = globalObject->m_JSHTTPParserClassStructure.get(globalObject);
    JSHTTPParser* HTTPParser = JSHTTPParser::create(vm, structure, globalObject);

    return JSValue::encode(HTTPParser);
}

} // namespace Bun
