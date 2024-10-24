#include "V8Object.h"
#include "shim/InternalFieldObject.h"
#include "V8HandleScope.h"
#include "JavaScriptCore/ConstructData.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Object)

using JSC::Identifier;
using JSC::JSFinalObject;
using JSC::JSGlobalObject;
using JSC::JSObject;
using JSC::JSValue;
using JSC::PutPropertySlot;

namespace v8 {

using FieldContainer = shim::InternalFieldObject::FieldContainer;

static FieldContainer* getInternalFieldsContainer(Object* object)
{
    JSObject* js_object = object->localToObjectPointer<JSObject>();

    // TODO(@190n): do we need to unwrap proxies like node-jsc did?

    if (auto ifo = JSC::jsDynamicCast<shim::InternalFieldObject*>(js_object)) {
        return ifo->internalFields();
    }

    return nullptr;
}

Local<Object> Object::New(Isolate* isolate)
{
    JSFinalObject* object = JSC::constructEmptyObject(isolate->globalObject());
    return isolate->currentHandleScope()->createLocal<Object>(isolate->vm(), object);
}

Maybe<bool> Object::Set(Local<Context> context, Local<Value> key, Local<Value> value)
{
    Zig::GlobalObject* globalObject = context->globalObject();
    JSObject* object = localToObjectPointer<JSObject>();
    JSValue k = key->localToJSValue();
    JSValue v = value->localToJSValue();
    auto& vm = globalObject->vm();

    auto scope = DECLARE_THROW_SCOPE(vm);
    PutPropertySlot slot(object, false);

    Identifier identifier = k.toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, Nothing<bool>());

    if (!object->methodTable()->put(object, globalObject, identifier, v, slot)) {
        // ProxyObject::performPut returns false if the JS handler returned a falsy value no matter
        // the mode. V8 native functions run as if they are in sloppy mode, so we only consider a
        // failure if the handler function actually threw, not if it returned false without
        // throwing.
        RETURN_IF_EXCEPTION(scope, Nothing<bool>());
    }
    RELEASE_AND_RETURN(scope, Just(true));
}

void Object::SetInternalField(int index, Local<Data> data)
{
    auto* fields = getInternalFieldsContainer(this);
    RELEASE_ASSERT(fields, "object has no internal fields");
    RELEASE_ASSERT(index >= 0 && index < fields->size(), "internal field index is out of bounds");
    JSObject* js_object = localToObjectPointer<JSObject>();
    auto* globalObject = JSC::jsDynamicCast<Zig::GlobalObject*>(js_object->globalObject());
    fields->at(index).set(globalObject->vm(), localToCell(), data->localToJSValue());
}

Local<Data> Object::GetInternalField(int index)
{
    return SlowGetInternalField(index);
}

Local<Data> Object::SlowGetInternalField(int index)
{
    auto* fields = getInternalFieldsContainer(this);
    JSObject* js_object = localToObjectPointer<JSObject>();
    auto* globalObject = JSC::jsDynamicCast<Zig::GlobalObject*>(js_object->globalObject());
    HandleScope* handleScope = globalObject->V8GlobalInternals()->currentHandleScope();
    if (fields && index >= 0 && index < fields->size()) {
        auto& field = fields->at(index);
        return handleScope->createLocal<Data>(globalObject->vm(), field.get());
    }
    return handleScope->createLocal<Data>(globalObject->vm(), JSC::jsUndefined());
}

MaybeLocal<Value> Object::Get(Local<Context> context, Local<Value> key)
{
    V8_UNIMPLEMENTED();
    return MaybeLocal<Value>();
}

MaybeLocal<Value> Object::Get(Local<Context> context, uint32_t index)
{
    V8_UNIMPLEMENTED();
    return MaybeLocal<Value>();
}

void Object::SetAlignedPointerInInternalField(int index, void* value)
{
    V8_UNIMPLEMENTED();
    (void)index;
    (void)value;
}

void* Object::SlowGetAlignedPointerFromInternalField(int index)
{
    V8_UNIMPLEMENTED();
    return nullptr;
}

} // namespace v8
