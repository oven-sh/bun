#include "JSBuildMessageConstructor.h"
#include "JSBuildMessage.h"
#include <JavaScriptCore/JSCJSValueInlines.h>

using namespace JSC;

namespace Bun {

const JSC::ClassInfo JSBuildMessageConstructor::s_info = { "BuildMessage"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBuildMessageConstructor) };

JSC_DEFINE_HOST_FUNCTION(callBuildMessage, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    throwConstructorCannotBeCalledAsFunctionTypeError(lexicalGlobalObject, scope, "BuildMessage"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(constructBuildMessage, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    throwTypeError(lexicalGlobalObject, scope, "BuildMessage cannot be constructed directly"_s);
    return {};
}

} // namespace Bun