#include "FunctionTemplate.h"
#include "Function.h"
#include "../V8HandleScope.h"
#include "../V8Data.h"

#include "JavaScriptCore/FunctionPrototype.h"

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
}

DEFINE_VISIT_CHILDREN(FunctionTemplate);

JSC::EncodedJSValue FunctionTemplate::functionCall(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    auto* callee = dynamicDowncast<Function>(callFrame->jsCallee());
    auto* functionTemplate = callee->functionTemplate();
    auto* isolate = uncheckedDowncast<Zig::GlobalObject>(globalObject)->V8GlobalInternals()->isolate();
    auto& vm = JSC::getVM(globalObject);

    HandleScope hs(isolate);

    // V8 function calls always run in "sloppy mode," even if the JS side is in strict mode. So if
    // `this` is null or undefined, we use globalThis instead; otherwise, we convert `this` to an
    // object.
    JSC::JSObject* jscThis = globalObject->globalThis();
    if (!callFrame->thisValue().isUndefinedOrNull()) {
        // TODO(@190n) throwscope, assert no exception
        jscThis = callFrame->thisValue().toObject(globalObject);
    }
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
    const size_t argc = callFrame->argumentCount();
    WTF::Vector<TaggedPointer, 27> frame(viewOffset + Info::kFirstJSArgumentIndex + argc);
    auto slot = [&](ptrdiff_t index) -> TaggedPointer& {
        return frame[viewOffset + index];
    };

    // Bun never reports a construct call here, so V8's NewTarget() always
    // returns undefined without reading this slot
    slot(Info::kNewTargetIndex) = TaggedPointer();
    // Length() reads this as a raw integer, not a Smi
    slot(Info::kArgcIndex) = TaggedPointer::fromRaw(argc);
    // SP/FP/PC are only used by V8's stack walker, which never sees this frame
    slot(Info::kFrameSPIndex) = TaggedPointer::fromRaw(0);
    // IsConstructCall() compares this Smi against kFrameTypeApiConstructExit
    slot(Info::kFrameTypeIndex) = TaggedPointer(Info::kFrameTypeApiCallExit);
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
        Local<Value> argValue = hs.createLocal<Value>(vm, callFrame->argument(i));
        slot(Info::kFirstJSArgumentIndex + i) = argValue.tagged();
    }

    // The FunctionCallbackInfo object is a view located at the argc slot
    const auto& info = *reinterpret_cast<const Info*>(&slot(Info::kArgcIndex));

    functionTemplate->m_callback(info);

    TaggedPointer& return_value = slot(Info::kReturnValueIndex);
    if (return_value.isEmpty()) {
        // callback forgot to set a return value, so return undefined
        return JSValue::encode(JSC::jsUndefined());
    } else {
        Local<Data> local_ret(&return_value);
        return JSValue::encode(local_ret->localToJSValue());
    }
}

} // namespace shim
} // namespace v8
