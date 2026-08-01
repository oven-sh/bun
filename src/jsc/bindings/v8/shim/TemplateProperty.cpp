#include "TemplateProperty.h"
#include "FunctionTemplate.h"
#include "ObjectTemplate.h"
#include "Function.h"
#include "GlobalInternals.h"
#include "../V8HandleScope.h"
#include "../V8Data.h"
#include "../V8Name.h"

#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/GetterSetter.h>

namespace v8 {
namespace shim {

static unsigned toJSCAttributes(unsigned v8Attributes)
{
    unsigned jscAttrs = 0;
    if (v8Attributes & 1) // ReadOnly
        jscAttrs |= JSC::PropertyAttribute::ReadOnly;
    if (v8Attributes & 2) // DontEnum
        jscAttrs |= JSC::PropertyAttribute::DontEnum;
    if (v8Attributes & 4) // DontDelete
        jscAttrs |= JSC::PropertyAttribute::DontDelete;
    return jscAttrs;
}

// Materialize a Template::Set value: FunctionTemplates become Functions,
// ObjectTemplates become instances, everything else is returned as-is.
static JSC::JSValue materializePropertyValue(JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    if (!value.isCell())
        return value;
    auto* zigGlobal = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    auto* globalInternals = zigGlobal->V8GlobalInternals();
    auto& vm = JSC::getVM(globalObject);
    if (auto* ft = dynamicDowncast<FunctionTemplate>(value.asCell())) {
        return ft->makeFunction(vm, zigGlobal, globalInternals);
    }
    if (auto* ot = dynamicDowncast<ObjectTemplate>(value.asCell())) {
        return ot->newInstance();
    }
    return value;
}

// Build a synthetic ApiAccessorExitFrame and invoke a native-data accessor
// getter or setter, mirroring FunctionTemplate::functionCall's frame building
// for the FunctionCallbackInfo case.
static JSC::JSValue invokeAccessor(
    JSC::JSGlobalObject* globalObject,
    JSC::JSValue thisObject,
    JSC::JSValue name,
    JSC::JSValue data,
    AccessorNameGetterCallback getter,
    AccessorNameSetterCallback setter,
    JSC::JSValue newValue)
{
    auto* zigGlobal = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    auto* isolate = zigGlobal->V8GlobalInternals()->isolate();
    auto& vm = JSC::getVM(globalObject);

    HandleScope hs(isolate);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSObject* jscThis = globalObject->globalThis();
    if (!thisObject.isUndefinedOrNull()) {
        jscThis = thisObject.toObject(globalObject);
        RETURN_IF_EXCEPTION(scope, JSC::jsUndefined());
    }
    Local<v8::Object> holder = hs.createLocal<v8::Object>(vm, jscThis);
    Local<v8::Name> property = hs.createLocal<v8::Name>(vm, name);
    Local<v8::Value> dataLocal = hs.createLocal<v8::Value>(vm, data);

    using Info = PropertyCallbackInfo<Value>;

    // V8's inline Data() reads `args_[kCallbackInfoIndex]` as a tagged pointer
    // to an AccessorInfo-shaped heap object and loads the word at
    // kCallbackInfoDataOffset (8) past it. Two stack words suffice: a
    // placeholder map followed by the data tagged pointer.
    TaggedPointer callbackInfo[2] = {
        TaggedPointer(const_cast<Map*>(&Map::object_map())),
        dataLocal.tagged(),
    };
    static_assert(Info::kCallbackInfoDataOffset == sizeof(TaggedPointer),
        "callbackInfo layout must place data at kCallbackInfoDataOffset");

    TaggedPointer frame[Info::kFullArgsLength];
    frame[Info::kPropertyKeyIndex] = property.tagged();
    frame[Info::kFrameSPIndex] = TaggedPointer::fromRaw(0);
    frame[Info::kFrameTypeIndex] = TaggedPointer(Info::kFrameTypeApiNamedAccessorExit);
    frame[Info::kFrameFPIndex] = TaggedPointer::fromRaw(0);
    frame[Info::kFramePCIndex] = TaggedPointer::fromRaw(0);
    frame[Info::kIsolateIndex] = TaggedPointer::fromRaw(reinterpret_cast<uintptr_t>(isolate));
    frame[Info::kReturnValueIndex] = TaggedPointer();
    frame[Info::kCallbackInfoIndex] = TaggedPointer(callbackInfo);
    frame[Info::kHolderIndex] = holder.tagged();
    frame[Info::kShouldThrowOnErrorIndex] = TaggedPointer(Info::kDontThrow);
    frame[Info::kValueIndex] = TaggedPointer();

    if (setter) {
        Local<v8::Value> valueLocal = hs.createLocal<v8::Value>(vm, newValue);
        frame[Info::kValueIndex] = valueLocal.tagged();
        const auto& info = *reinterpret_cast<const PropertyCallbackInfo<void>*>(&frame[Info::kPropertyKeyIndex]);
        setter(property, valueLocal, info);
        return JSC::jsUndefined();
    }

    const auto& info = *reinterpret_cast<const Info*>(&frame[Info::kPropertyKeyIndex]);
    getter(property, info);

    TaggedPointer& returnValue = frame[Info::kReturnValueIndex];
    if (returnValue.isEmpty()) {
        return JSC::jsUndefined();
    }
    Local<v8::Data> localRet(&returnValue);
    return localRet->localToJSValue();
}

void applyTemplateProperties(
    JSC::JSGlobalObject* globalObject,
    JSC::JSObject* target,
    const WTF::Vector<TemplateProperty>& properties,
    const WTF::Vector<TemplateAccessor>& accessors)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    for (const auto& prop : properties) {
        JSC::Identifier identifier = prop.name.get().toPropertyKey(globalObject);
        RETURN_IF_EXCEPTION(scope, void());
        JSC::JSValue value = materializePropertyValue(globalObject, prop.value.get());
        RETURN_IF_EXCEPTION(scope, void());
        target->putDirect(vm, identifier, value, toJSCAttributes(prop.attributes));
    }

    for (const auto& acc : accessors) {
        JSC::Identifier identifier = acc.name.get().toPropertyKey(globalObject);
        RETURN_IF_EXCEPTION(scope, void());

        JSC::JSValue nameValue = acc.name.get();
        JSC::JSValue dataValue = acc.data.get();
        AccessorNameGetterCallback getter = acc.getter;
        AccessorNameSetterCallback setter = acc.setter;

        JSC::JSObject* getterFn = nullptr;
        JSC::JSObject* setterFn = nullptr;

        // Pass nameValue/dataValue as trailing captures so JSNativeStdFunction
        // stores them in m_captures (WriteBarrier<Unknown>, visited by GC). The
        // lambda also captures them by value; JSC's GC is non-moving so the
        // closure copies remain valid as long as m_captures keeps the cells alive.
        if (getter) {
            getterFn = JSC::JSNativeStdFunction::create(
                vm, globalObject, 0, WTF::String(),
                [nameValue, dataValue, getter](JSC::JSGlobalObject* global, JSC::CallFrame* callFrame) -> JSC::EncodedJSValue {
                    JSC::JSValue result = invokeAccessor(global, callFrame->thisValue(), nameValue, dataValue, getter, nullptr, JSC::JSValue());
                    return JSC::JSValue::encode(result);
                },
                nameValue, dataValue);
        }
        if (setter) {
            setterFn = JSC::JSNativeStdFunction::create(
                vm, globalObject, 1, WTF::String(),
                [nameValue, dataValue, setter](JSC::JSGlobalObject* global, JSC::CallFrame* callFrame) -> JSC::EncodedJSValue {
                    invokeAccessor(global, callFrame->thisValue(), nameValue, dataValue, nullptr, setter, callFrame->argument(0));
                    return JSC::JSValue::encode(JSC::jsUndefined());
                },
                nameValue, dataValue);
        }

        auto* getterSetter = JSC::GetterSetter::create(vm, globalObject, getterFn, setterFn);
        target->putDirectAccessor(globalObject, identifier, getterSetter,
            toJSCAttributes(acc.attributes) | JSC::PropertyAttribute::Accessor);
    }
}

} // namespace shim
} // namespace v8
