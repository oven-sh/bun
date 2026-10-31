#include "V8Object.h"
#include "shim/InternalFieldObject.h"
#include "V8HandleScope.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/ConstructData.h"
#include "JavaScriptCore/IdentifierInlines.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/PropertyNameArray.h"
#include "JavaScriptCore/StringObject.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Object)

ASSERT_V8_ENUM_MATCHES(PropertyAttribute, None)
ASSERT_V8_ENUM_MATCHES(PropertyAttribute, ReadOnly)
ASSERT_V8_ENUM_MATCHES(PropertyAttribute, DontEnum)
ASSERT_V8_ENUM_MATCHES(PropertyAttribute, DontDelete)

ASSERT_V8_ENUM_MATCHES(PropertyFilter, ALL_PROPERTIES)
ASSERT_V8_ENUM_MATCHES(PropertyFilter, ONLY_WRITABLE)
ASSERT_V8_ENUM_MATCHES(PropertyFilter, ONLY_ENUMERABLE)
ASSERT_V8_ENUM_MATCHES(PropertyFilter, ONLY_CONFIGURABLE)
ASSERT_V8_ENUM_MATCHES(PropertyFilter, SKIP_STRINGS)
ASSERT_V8_ENUM_MATCHES(PropertyFilter, SKIP_SYMBOLS)

ASSERT_V8_ENUM_MATCHES(KeyConversionMode, kConvertToString)
ASSERT_V8_ENUM_MATCHES(KeyConversionMode, kKeepNumbers)
ASSERT_V8_ENUM_MATCHES(KeyConversionMode, kNoNumbers)

using JSC::Identifier;
using JSC::JSFinalObject;
using JSC::JSGlobalObject;
using JSC::JSObject;
using JSC::JSValue;
using JSC::PutPropertySlot;

namespace v8 {

using FieldContainer = shim::InternalFieldObject::FieldContainer;

static shim::InternalFieldObject* getInternalFieldObject(Object* object)
{
    JSObject* js_object = object->localToObjectPointer<JSObject>();

    // TODO(@190n): do we need to unwrap proxies like node-jsc did?

    return dynamicDowncast<shim::InternalFieldObject>(js_object);
}

static FieldContainer* getInternalFieldsContainer(Object* object)
{
    if (auto ifo = getInternalFieldObject(object)) {
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
    auto& vm = JSC::getVM(globalObject);

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    PutPropertySlot slot(object, false);

    Identifier identifier = k.toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, Nothing<bool>());

    // TODO: investigate if we should use the return value (seems like not)
    bool success = object->methodTable()->put(object, globalObject, identifier, v, slot);
    (void)success;
    RETURN_IF_EXCEPTION(scope, Nothing<bool>());
    return Just(true);
}

Maybe<bool> Object::Set(Local<Context> context, uint32_t index, Local<Value> value)
{
    Zig::GlobalObject* globalObject = context->globalObject();
    JSObject* object = localToObjectPointer<JSObject>();
    JSValue v = value->localToJSValue();
    auto& vm = JSC::getVM(globalObject);

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    // TODO: investigate if we should use the return value (seems like not)
    bool success = object->methodTable()->putByIndex(object, globalObject, index, v, false);
    (void)success;
    RETURN_IF_EXCEPTION(scope, Nothing<bool>());

    return Just(true);
}

MaybeLocal<Value> Object::Get(Local<Context> context, Local<Value> key)
{
    Zig::GlobalObject* globalObject = context->globalObject();
    JSObject* object = localToObjectPointer<JSObject>();
    JSValue k = key->localToJSValue();
    auto& vm = JSC::getVM(globalObject);

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    Identifier identifier = k.toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Value>());

    JSValue result = object->get(globalObject, identifier);
    if (scope.exception()) [[unlikely]] {
        return MaybeLocal<Value>();
    }

    auto* handleScope = globalObject->V8GlobalInternals()->currentHandleScope();
    return handleScope->createLocal<Value>(vm, result);
}

MaybeLocal<Value> Object::Get(Local<Context> context, uint32_t index)
{
    Zig::GlobalObject* globalObject = context->globalObject();
    JSObject* object = localToObjectPointer<JSObject>();
    auto& vm = JSC::getVM(globalObject);

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSValue result = object->get(globalObject, index);
    if (scope.exception()) [[unlikely]] {
        return MaybeLocal<Value>();
    }

    auto* handleScope = globalObject->V8GlobalInternals()->currentHandleScope();
    return handleScope->createLocal<Value>(vm, result);
}

void Object::SetInternalField(int index, Local<Data> data)
{
    auto* fields = getInternalFieldsContainer(this);
    RELEASE_ASSERT(fields, "object has no internal fields");
    RELEASE_ASSERT(index >= 0 && index < fields->size(), "internal field index is out of bounds");
    JSObject* js_object = localToObjectPointer<JSObject>();
    auto* globalObject = dynamicDowncast<Zig::GlobalObject>(js_object->globalObject());
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
    auto* globalObject = dynamicDowncast<Zig::GlobalObject>(js_object->globalObject());
    auto* handleScope = globalObject->V8GlobalInternals()->currentHandleScope();
    if (fields && index >= 0 && index < fields->size()) {
        auto& field = fields->at(index);
        return handleScope->createLocal<Data>(globalObject->vm(), field.get());
    }
    return handleScope->createLocal<Data>(globalObject->vm(), JSC::jsUndefined());
}

void Object::SetAlignedPointerInInternalField(int index, void* value, uint16_t tag)
{
    (void)tag;
    auto* ifo = getInternalFieldObject(this);
    RELEASE_ASSERT(ifo, "object has no internal fields");
    RELEASE_ASSERT(index >= 0 && static_cast<size_t>(index) < ifo->alignedPointerCount(), "internal field index is out of bounds");
    ifo->alignedPointerAt(index) = value;
}

void* Object::SlowGetAlignedPointerFromInternalField(int index, uint16_t tag)
{
    (void)tag;
    auto* ifo = getInternalFieldObject(this);
    if (ifo && index >= 0 && static_cast<size_t>(index) < ifo->alignedPointerCount()) {
        return ifo->alignedPointerAt(index);
    }
    return nullptr;
}

void* Object::GetAlignedPointerFromInternalField(int index, uint16_t tag)
{
    return SlowGetAlignedPointerFromInternalField(index, tag);
}

int Object::InternalFieldCount() const
{
    auto* fields = getInternalFieldsContainer(const_cast<Object*>(this));
    return fields ? static_cast<int>(fields->size()) : 0;
}

int Object::GetIdentityHash()
{
    // V8 only guarantees a non-zero value that is stable for the object's
    // lifetime; the JSC cell address satisfies that under our non-moving GC.
    return static_cast<int>(reinterpret_cast<uintptr_t>(localToCell()) & INT_MAX) | 1;
}

Maybe<bool> Object::DefineOwnProperty(Local<Context> context, Local<Name> key, Local<Value> value, PropertyAttribute attributes)
{
    Zig::GlobalObject* globalObject = context->globalObject();
    JSObject* object = localToObjectPointer<JSObject>();
    JSValue k = key->localToJSValue();
    JSValue v = value->localToJSValue();
    auto& vm = JSC::getVM(globalObject);

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    Identifier identifier = k.toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, Nothing<bool>());

    unsigned jscAttrs = 0;
    if (attributes & ReadOnly) jscAttrs |= JSC::PropertyAttribute::ReadOnly;
    if (attributes & DontEnum) jscAttrs |= JSC::PropertyAttribute::DontEnum;
    if (attributes & DontDelete) jscAttrs |= JSC::PropertyAttribute::DontDelete;

    JSC::PropertyDescriptor descriptor(v, jscAttrs);
    bool success = object->methodTable()->defineOwnProperty(object, globalObject, identifier, descriptor, false);
    RETURN_IF_EXCEPTION(scope, Nothing<bool>());
    return Just(success);
}

MaybeLocal<Array> Object::GetOwnPropertyNames(Local<Context> context, PropertyFilter filter, KeyConversionMode key_conversion)
{
    Zig::GlobalObject* globalObject = context->globalObject();
    JSObject* object = localToObjectPointer<JSObject>();
    auto& vm = JSC::getVM(globalObject);

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    const bool skipStrings = filter & SKIP_STRINGS;
    const bool skipSymbols = filter & SKIP_SYMBOLS;
    // V8 asks a Proxy for its keys even when the filter skips all of them, but then for no descriptor.
    const bool skipAllKeys = skipStrings && skipSymbols;

    auto nameMode = JSC::PropertyNameMode::StringsAndSymbols;
    if (skipSymbols) {
        nameMode = JSC::PropertyNameMode::Strings;
    } else if (skipStrings) {
        nameMode = JSC::PropertyNameMode::Symbols;
    }
    const auto dontEnumMode = (filter & ONLY_ENUMERABLE) && !skipAllKeys ? JSC::DontEnumPropertiesMode::Exclude : JSC::DontEnumPropertiesMode::Include;

    JSC::PropertyNameArrayBuilder names(vm, nameMode, JSC::PrivateSymbolMode::Exclude);
    object->methodTable()->getOwnPropertyNames(object, globalObject, names, dontEnumMode);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Array>());

    JSC::MarkedArgumentBuffer keys;
    if (!skipAllKeys) {
        // V8 applies ONLY_WRITABLE and ONLY_CONFIGURABLE neither to the keys of a Proxy nor to the characters of a String object.
        const bool filterByAttributes = (filter & (ONLY_WRITABLE | ONLY_CONFIGURABLE)) && object->type() != JSC::ProxyObjectType;
        auto* stringObject = dynamicDowncast<JSC::StringObject>(object);
        const unsigned characterCount = stringObject ? stringObject->internalValue()->length() : 0;

        for (const Identifier& name : names) {
            std::optional<uint32_t> index = JSC::parseIndex(name);
            if (filterByAttributes && !(index && *index < characterCount)) {
                JSC::PropertyDescriptor descriptor;
                object->getOwnPropertyDescriptor(globalObject, name, descriptor);
                RETURN_IF_EXCEPTION(scope, MaybeLocal<Array>());
                // ONLY_WRITABLE rejects V8's READ_ONLY attribute, which an accessor property never has.
                if ((filter & ONLY_WRITABLE) && !descriptor.isAccessorDescriptor() && !descriptor.writable()) {
                    continue;
                }
                if ((filter & ONLY_CONFIGURABLE) && !descriptor.configurable()) {
                    continue;
                }
            }
            // V8 checks kNoNumbers with a debug assertion only, so index keys stay numbers as for kKeepNumbers.
            if (index && key_conversion != KeyConversionMode::kConvertToString) {
                keys.appendWithCrashOnOverflow(JSC::jsNumber(*index));
            } else {
                keys.appendWithCrashOnOverflow(JSC::identifierToJSValue(vm, name));
            }
        }
    }

    JSC::JSArray* array = JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), keys);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Array>());

    return context->currentHandleScope()->createLocal<Array>(vm, array);
}

internal::ExternalPointerTag ToExternalPointerTag(uint16_t api_tag)
{
    // Bun doesn't use V8's pointer-compression sandbox, so the specific tag
    // value is never consulted; return the null tag for every api_tag.
    (void)api_tag;
    return static_cast<internal::ExternalPointerTag>(0);
}

} // namespace v8
