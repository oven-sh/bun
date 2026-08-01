#include "JSConnectionsListConstructor.h"
#include "JSConnectionsList.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSSet.h>

namespace Bun {

using namespace JSC;

const ClassInfo JSConnectionsListConstructor::s_info = { "ConnectionsList"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSConnectionsListConstructor) };

JSC_DEFINE_HOST_FUNCTION(callConnectionsList, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(constructConnectionsList, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    Structure* structure = globalObject->m_JSConnectionsListClassStructure.get(globalObject);

    JSSet* allConnections = JSSet::create(vm, lexicalGlobalObject->setStructure());
    RETURN_IF_EXCEPTION(scope, {});

    JSSet* activeConnections = JSSet::create(vm, lexicalGlobalObject->setStructure());
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(JSConnectionsList::create(vm, globalObject, structure, allConnections, activeConnections));
}

} // namespace Bun
