#include "v8/Object.h"

#include "JavaScriptCore/ObjectConstructor.h"

using JSC::Identifier;
using JSC::JSFinalObject;
using JSC::JSGlobalObject;
using JSC::JSObject;
using JSC::JSValue;
using JSC::PutPropertySlot;

namespace v8 {

Local<Object> Object::New(Isolate* isolate)
{
    JSFinalObject* object = JSC::constructEmptyObject(isolate->globalObject());
    JSValue jsv(object);
    return Local<Object>(jsv);
}

Maybe<bool> Object::Set(Local<Context> context, Local<Value> key, Local<Value> value)
{
    JSGlobalObject* globalObject = *context;
    JSObject* object = toJSValue().getObject();
    assert(object);
    JSValue k = (*key)->toJSValue();
    JSValue v = (*value)->toJSValue();
    auto& vm = globalObject->vm();

    auto scope = DECLARE_CATCH_SCOPE(vm);
    PutPropertySlot slot(object, false);

    Identifier identifier = k.toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, Nothing<bool>());

    if (!object->put(object, globalObject, identifier, v, slot)) {
        scope.clearExceptionExceptTermination();
        return Nothing<bool>();
    }
    if (scope.exception()) {
        scope.clearException();
        return Nothing<bool>();
    }
    return Just(true);
}

void Object::SetInternalField(int index, Local<Data> data)
{
    ASSERT_NOT_REACHED();
}

Local<Data> Object::SlowGetInternalField(int index)
{
    ASSERT_NOT_REACHED();
}

}
