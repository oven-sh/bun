#include "JSResolveMessageConstructor.h"
#include "JSResolveMessage.h"
#include <JavaScriptCore/JSCJSValueInlines.h>

using namespace JSC;

namespace Bun {

const JSC::ClassInfo JSResolveMessageConstructor::s_info = { "ResolveMessage"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSResolveMessageConstructor) };

JSC_DEFINE_HOST_FUNCTION(callResolveMessage, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    throwConstructorCannotBeCalledAsFunctionTypeError(lexicalGlobalObject, scope, "ResolveMessage"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(constructResolveMessage, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    throwTypeError(lexicalGlobalObject, scope, "ResolveMessage cannot be constructed directly"_s);
    return {};
}

} // namespace Bun