#include "FunctionTemplate.h"
#include "Function.h"
#include "ObjectTemplate.h"
#include "../V8HandleScope.h"
#include "../V8Data.h"

#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ThrowScope.h"

using JSC::JSValue;
using JSC::Structure;

namespace v8 {

class Object;

namespace shim {

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo FunctionTemplate::s_info = {
    "FunctionTemplate"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(FunctionTemplate)
};

FunctionTemplate* FunctionTemplate::create(JSC::VM& vm, JSC::Structure* structure, FunctionCallback callback, JSC::JSValue data)
{
    auto* functionTemplate = new (NotNull, JSC::allocateCell<FunctionTemplate>(vm)) FunctionTemplate(
        vm, structure, callback, data);
    functionTemplate->finishCreation(vm);
    return functionTemplate;
}

Structure* FunctionTemplate::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return Structure::create(
        vm,
        globalObject,
        globalObject->functionPrototype(),
        JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags),
        info());
}

template<typename Visitor>
void FunctionTemplate::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    FunctionTemplate* fn = uncheckedDowncast<FunctionTemplate>(cell);
    ASSERT_GC_OBJECT_INHERITS(fn, info());
    Base::visitChildren(fn, visitor);

    visitor.append(fn->m_data);
    visitor.append(fn->m_className);
    visitor.append(fn->m_instanceTemplate);
    visitor.append(fn->m_prototypeTemplate);
    for (auto& prop : fn->m_properties) {
        visitor.append(prop.name);
        visitor.append(prop.value);
    }
    for (auto& acc : fn->m_accessors) {
        visitor.append(acc.name);
        visitor.append(acc.data);
    }
}

DEFINE_VISIT_CHILDREN(FunctionTemplate);

ObjectTemplate* FunctionTemplate::instanceTemplate() const
{
    return m_instanceTemplate.get();
}

void FunctionTemplate::setInstanceTemplate(JSC::VM& vm, ObjectTemplate* objectTemplate)
{
    m_instanceTemplate.set(vm, this, objectTemplate);
}

ObjectTemplate* FunctionTemplate::prototypeTemplate() const
{
    return m_prototypeTemplate.get();
}

ObjectTemplate* FunctionTemplate::ensureInstanceTemplate(JSC::JSGlobalObject* globalObject)
{
    if (auto* existing = m_instanceTemplate.get())
        return existing;
    auto* zigGlobal = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    auto& vm = JSC::getVM(globalObject);
    auto* structure = zigGlobal->V8GlobalInternals()->objectTemplateStructure(globalObject);
    auto* objectTemplate = ObjectTemplate::create(vm, structure);
    m_instanceTemplate.set(vm, this, objectTemplate);
    return objectTemplate;
}

ObjectTemplate* FunctionTemplate::ensurePrototypeTemplate(JSC::JSGlobalObject* globalObject)
{
    if (auto* existing = m_prototypeTemplate.get())
        return existing;
    auto* zigGlobal = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    auto& vm = JSC::getVM(globalObject);
    auto* structure = zigGlobal->V8GlobalInternals()->objectTemplateStructure(globalObject);
    auto* objectTemplate = ObjectTemplate::create(vm, structure);
    m_prototypeTemplate.set(vm, this, objectTemplate);
    return objectTemplate;
}

void FunctionTemplate::addProperty(JSC::VM& vm, JSC::JSValue name, JSC::JSValue value, unsigned attributes)
{
    TemplateProperty prop;
    prop.name.set(vm, this, name);
    prop.value.set(vm, this, value);
    prop.attributes = attributes;
    m_properties.append(WTF::move(prop));
}

void FunctionTemplate::addAccessor(JSC::VM& vm, JSC::JSValue name, AccessorNameGetterCallback getter, AccessorNameSetterCallback setter, JSC::JSValue data, unsigned attributes)
{
    TemplateAccessor acc;
    acc.name.set(vm, this, name);
    acc.data.set(vm, this, data);
    acc.getter = getter;
    acc.setter = setter;
    acc.attributes = attributes;
    m_accessors.append(WTF::move(acc));
}

Function* FunctionTemplate::makeFunction(JSC::VM& vm, Zig::GlobalObject* globalObject, GlobalInternals* internals)
{
    auto* f = Function::create(vm, internals->v8FunctionStructure(globalObject), this);

    // Properties recorded directly on the FunctionTemplate become own properties
    // of the created function (static members in V8's class model).
    applyTemplateProperties(globalObject, f, m_properties, m_accessors);

    JSC::JSObject* protoObj = JSC::constructEmptyObject(globalObject);
    if (auto* protoTemplate = m_prototypeTemplate.get())
        applyTemplateProperties(globalObject, protoObj, protoTemplate->properties(), protoTemplate->accessors());
    f->putDirect(vm, vm.propertyNames->prototype, protoObj,
        JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    protoObj->putDirect(vm, vm.propertyNames->constructor, f, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum));

    return f;
}

JSC::EncodedJSValue FunctionTemplate::functionCall(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    auto* callee = dynamicDowncast<Function>(callFrame->jsCallee());

    // V8 function calls always run in "sloppy mode," even if the JS side is in strict mode. So if
    // `this` is null or undefined, we use globalThis instead; otherwise, we convert `this` to an
    // object.
    JSC::JSObject* jscThis = globalObject->globalThis();
    if (!callFrame->thisValue().isUndefinedOrNull()) {
        // TODO(@190n) throwscope, assert no exception
        jscThis = callFrame->thisValue().toObject(globalObject);
    }

    JSC::ArgList args(callFrame);
    return JSValue::encode(invokeCallback(globalObject, callee, jscThis, args, false));
}

JSC::EncodedJSValue FunctionTemplate::functionConstruct(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* callee = dynamicDowncast<Function>(callFrame->jsCallee());
    auto* functionTemplate = callee->functionTemplate();

    auto* instanceTemplate = functionTemplate->ensureInstanceTemplate(globalObject);
    JSC::JSObject* receiver = instanceTemplate->newInstance();

    JSC::JSValue prototype = callee->get(globalObject, vm.propertyNames->prototype);
    RETURN_IF_EXCEPTION(scope, {});
    if (prototype.isObject()) {
        receiver->setPrototypeDirect(vm, prototype);
    }

    JSC::ArgList args(callFrame);
    JSC::JSValue result = invokeCallback(globalObject, callee, receiver, args, true);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(result.isObject() ? result : JSValue(receiver));
}

JSC::JSValue FunctionTemplate::invokeCallback(JSC::JSGlobalObject* globalObject, Function* callee, JSC::JSObject* jscThis, const JSC::ArgList& args, bool isConstruct)
{
    auto* functionTemplate = callee->functionTemplate();
    // FunctionTemplate::New(isolate) with no callback is valid in V8; invoking such a
    // template is a no-op that yields undefined (and NewInstance falls through to the
    // receiver). Guard before building the frame so we never call a null m_callback.
    if (!functionTemplate->m_callback) {
        return JSC::jsUndefined();
    }

    auto* isolate = uncheckedDowncast<Zig::GlobalObject>(globalObject)->V8GlobalInternals()->isolate();
    auto& vm = JSC::getVM(globalObject);

    HandleScope hs(isolate);

    Local<Object> thisObject = hs.createLocal<Object>(vm, jscThis);

    // In V8, the target is the function being called
    Local<Value> target = hs.createLocal<Value>(vm, callee);

    // Build a synthetic ApiCallbackExitFrame: one contiguous array of
    // pointer-sized slots that V8's inline FunctionCallbackInfo accessors index
    // relative to the argc slot. The view starts one slot into the array so
    // that kNewTargetIndex (-1) stays in bounds.
    using Info = FunctionCallbackInfo<Value>;
    // One slot below the view base: kNewTargetIndex is the only negative
    // index, so the buffer needs exactly that much headroom before it.
    constexpr size_t viewOffset = 1;
    static_assert(viewOffset + Info::kNewTargetIndex == 0,
        "viewOffset must cover the most negative FunctionCallbackInfo index");
    const size_t argc = args.size();
    WTF::Vector<TaggedPointer, 27> frame(viewOffset + Info::kFirstJSArgumentIndex + argc);
    auto slot = [&](ptrdiff_t index) -> TaggedPointer& {
        return frame[viewOffset + index];
    };

    // v8::internal::Internals::kFrameTypeApiConstructExit (v8-internal.h).
    constexpr int kFrameTypeApiConstructExit = 19;

    // For construct calls V8 reads this slot via NewTarget(); for plain calls
    // IsConstructCall() short-circuits on kFrameTypeIndex and never reads it.
    slot(Info::kNewTargetIndex) = isConstruct ? target.tagged() : TaggedPointer();
    // Length() reads this as a raw integer, not a Smi
    slot(Info::kArgcIndex) = TaggedPointer::fromRaw(argc);
    // SP/FP/PC are only used by V8's stack walker, which never sees this frame
    slot(Info::kFrameSPIndex) = TaggedPointer::fromRaw(0);
    // IsConstructCall() compares this Smi against kFrameTypeApiConstructExit
    slot(Info::kFrameTypeIndex) = TaggedPointer(isConstruct ? kFrameTypeApiConstructExit : Info::kFrameTypeApiCallExit);
    slot(Info::kFrameFPIndex) = TaggedPointer::fromRaw(0);
    slot(Info::kFramePCIndex) = TaggedPointer::fromRaw(0);
    // GetIsolate() reads this slot as a raw, untagged pointer
    slot(Info::kIsolateIndex) = TaggedPointer::fromRaw(reinterpret_cast<uintptr_t>(isolate));
    slot(Info::kReturnValueIndex) = TaggedPointer();
    // Context is always a reinterpret pointer to Zig::GlobalObject
    slot(Info::kContextIndex) = TaggedPointer::fromRaw(reinterpret_cast<uintptr_t>(globalObject));
    // target holds the Function being called, which contains the FunctionTemplate
    slot(Info::kTargetIndex) = target.tagged();
    slot(Info::kReceiverIndex) = thisObject.tagged();

    for (size_t i = 0; i < argc; i++) {
        Local<Value> argValue = hs.createLocal<Value>(vm, args.at(i));
        slot(Info::kFirstJSArgumentIndex + i) = argValue.tagged();
    }

    // The FunctionCallbackInfo object is a view located at the argc slot
    const auto& info = *reinterpret_cast<const Info*>(&slot(Info::kArgcIndex));

    functionTemplate->m_callback(info);

    TaggedPointer& return_value = slot(Info::kReturnValueIndex);
    if (return_value.isEmpty()) {
        // callback forgot to set a return value, so return undefined
        return JSC::jsUndefined();
    }
    Local<Data> local_ret(&return_value);
    return local_ret->localToJSValue();
}

} // namespace shim
} // namespace v8
