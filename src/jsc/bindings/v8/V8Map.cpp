#include "V8Map.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSMapInlines.h>

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Map)

namespace v8 {

MaybeLocal<Map> Map::Set(Local<Context> context, Local<Value> key, Local<Value> value)
{
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSMap* jsMap = localToObjectPointer<JSC::JSMap>();
    RELEASE_ASSERT(jsMap, "v8::Map::Set called on non-Map value");

    jsMap->set(globalObject, key->localToJSValue(), value->localToJSValue());
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Map>());

    return context->currentHandleScope()->createLocal<Map>(vm, jsMap);
}

Maybe<bool> Map::Delete(Local<Context> context, Local<Value> key)
{
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSMap* jsMap = localToObjectPointer<JSC::JSMap>();
    RELEASE_ASSERT(jsMap, "v8::Map::Delete called on non-Map value");

    bool result = jsMap->remove(globalObject, key->localToJSValue());
    RETURN_IF_EXCEPTION(scope, Nothing<bool>());

    return Just(result);
}

} // namespace v8
