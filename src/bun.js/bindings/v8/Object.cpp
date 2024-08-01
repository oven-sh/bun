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
    JSObject* js_object = object->toObjectPointer<JSObject>();

    // TODO(@190n): do we need to unwrap proxies like node-jsc did?

    if (js_object->inherits<InternalFieldObject>()) {
        return static_cast<InternalFieldObject*>(js_object)->internalFields();
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
    JSObject* object = toObjectPointer<JSObject>();
    JSValue k = key->toTagged().getJSValue();
    JSValue v = value->toTagged().getJSValue();
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
        fields->at(index) = InternalFieldObject::InternalField(data->toTagged().getJSValue());
    }
}

Local<Data> Object::SlowGetInternalField(int index)
{
    V8_UNIMPLEMENTED();
    // auto fields = getInternalFieldsContainer(this);
    // if (fields && index >= 0 && index < fields->size()) {
    //     auto& field = fields->at(index);
    //     if (field.is_js_value) {
    //         return Local<Data>(field.data.js_value);
    //     }
    // }
    // return Local<Data>(JSC::jsUndefined());

    // TODO: this might need to allocate a heap number
    // internal fields should be v8 pointers not jsvalues
    return Local<Data>();
}

}
