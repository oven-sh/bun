#include "v8/Object.h"
#include "JavaScriptCore/ConstructData.h"
#include "v8/InternalFieldObject.h"

#include "JavaScriptCore/ObjectConstructor.h"

using JSC::Identifier;
using JSC::JSFinalObject;
using JSC::JSGlobalObject;
using JSC::JSObject;
using JSC::JSValue;
using JSC::PutPropertySlot;

namespace v8 {

using FieldContainer = InternalFieldObject::FieldContainer;

static FieldContainer* getInternalFieldsContainer(Object* object)
{
    JSObject* js_object = object->localToObjectPointer<JSObject>();

    // TODO(@190n): do we need to unwrap proxies like node-jsc did?

    if (auto ifo = JSC::jsDynamicCast<InternalFieldObject*>(js_object)) {
        return ifo->internalFields();
    }

    return nullptr;
}

Local<Object> Object::New(Isolate* isolate)
{
    JSFinalObject* object = JSC::constructEmptyObject(isolate->globalObject());
    return isolate->currentHandleScope()->createLocal<Object>(object);
}

Maybe<bool> Object::Set(Local<Context> context, Local<Value> key, Local<Value> value)
{
    JSGlobalObject* globalObject = context->globalObject();
    JSObject* object = localToObjectPointer<JSObject>();
    JSValue k = key->localToTagged().getJSValue();
    JSValue v = value->localToTagged().getJSValue();
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
    auto fields = getInternalFieldsContainer(this);
    if (fields && index >= 0 && index < fields->size()) {
        fields->at(index) = InternalFieldObject::InternalField(data->localToTagged().getJSValue());
    }
}

Local<Data> Object::SlowGetInternalField(int index)
{
    // TODO: this might need to allocate a heap number
    // internal fields should be v8 pointers not jsvalues (or not? figure this out along with the
    // type() cases in handle from jscell)

    auto* fields = getInternalFieldsContainer(this);
    JSObject* js_object = localToObjectPointer<JSObject>();
    HandleScope* handleScope = Isolate::fromGlobalObject(JSC::jsDynamicCast<Zig::GlobalObject*>(js_object->globalObject()))->currentHandleScope();
    if (fields && index >= 0 && index < fields->size()) {
        auto& field = fields->at(index);
        if (field.is_js_value) {
            // TODO better conversion from jsvalue to v8 value
            if (field.data.js_value.isCell()) {
                return handleScope->createLocal<Data>(field.data.js_value.asCell());
            } else {
                auto localNumber = handleScope->createLocalSmi(field.data.js_value.asInt32());
                return localNumber.reinterpret<Data>();
            }
        }
    }
    // TODO handle undefined/null the way v8 does
    return Local<Data>();
}

}
