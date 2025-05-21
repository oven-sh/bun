#include "root.h"
#include "headers.h"

#include <JavaScriptCore/DOMJITAbstractHeap.h>
#include "DOMJITIDLConvert.h"
#include "DOMJITIDLType.h"
#include "DOMJITIDLTypeFilter.h"
#include "DOMJITHelpers.h"
#include <JavaScriptCore/DFGAbstractHeap.h>

#include "JSDOMConvertBufferSource.h"

using namespace JSC;
using namespace WebCore;

/* -- BEGIN DOMCall DEFINITIONS -- */

// BUN_DECLARE_HOST_FUNCTION(FFI__ptr__slowpathWrapper);
// extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(FFI__ptr__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, JSC::JSUint8Array*));

// JSC_DEFINE_JIT_OPERATION(FFI__ptr__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, JSC::JSUint8Array* arg1))
// {
//     auto& vm = JSC::getVM(lexicalGlobalObject);
//     IGNORE_WARNINGS_BEGIN("frame-address")
//     CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
//     IGNORE_WARNINGS_END
//     JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
//     return { FFI__ptr__fastpath(lexicalGlobalObject, thisValue, arg1) };
// }
JSC_DEFINE_HOST_FUNCTION(FFI__ptr__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return FFI__ptr__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void FFI__ptr__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    // static const JSC::DOMJIT::Signature DOMJIT_ptr_signature(
    //     FFI__ptr__fastpathWrapper,
    //     thisObject->classInfo(),
    //     JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    //     JSC::SpecDoubleReal,
    //     JSC::SpecUint8Array);
    // JSFunction* function = JSFunction::create(
    //     globalObject->vm(),
    //     globalObject,
    //     1,
    //     String("ptr"_s),
    //     FFI__ptr__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic, FFI__ptr__slowpathWrapper,
    //     &DOMJIT_ptr_signature);
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        1,
        String("ptr"_s),
        FFI__ptr__slowpathWrapper,
        ImplementationVisibility::Public,
        NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "ptr"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__u8__slowpathWrapper);
extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(Reader__u8__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t, int32_t));

// JSC_DEFINE_JIT_OPERATION(Reader__u8__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t arg1, int32_t arg2))
// {
//     auto& vm = JSC::getVM(lexicalGlobalObject);
//     IGNORE_WARNINGS_BEGIN("frame-address")
//     CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
//     IGNORE_WARNINGS_END
//     JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
//     return { Reader__u8__fastpath(lexicalGlobalObject, thisValue, arg1, arg2) };
// }
JSC_DEFINE_HOST_FUNCTION(Reader__u8__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__u8__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__u8__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    // static const JSC::DOMJIT::Signature DOMJIT_u8_signature(
    //     Reader__u8__fastpathWrapper,
    //     thisObject->classInfo(),
    //     JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    //     JSC::SpecInt32Only,
    //     JSC::SpecInt52Any,
    //     JSC::SpecInt32Only);
    // JSFunction* function = JSFunction::create(
    //     globalObject->vm(),
    //     globalObject,
    //     2,
    //     String("u8"_s),
    //     Reader__u8__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic, Reader__u8__slowpathWrapper,
    //     &DOMJIT_u8_signature);

    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("u8"_s),
        Reader__u8__slowpathWrapper,
        ImplementationVisibility::Public,
        NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "u8"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__u16__slowpathWrapper);
extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(Reader__u16__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t, int32_t));

// JSC_DEFINE_JIT_OPERATION(Reader__u16__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t arg1, int32_t arg2))
// {
//     auto& vm = JSC::getVM(lexicalGlobalObject);
//     IGNORE_WARNINGS_BEGIN("frame-address")
//     CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
//     IGNORE_WARNINGS_END
//     JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
//     return { Reader__u16__fastpath(lexicalGlobalObject, thisValue, arg1, arg2) };
// }
JSC_DEFINE_HOST_FUNCTION(Reader__u16__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__u16__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__u16__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    // static const JSC::DOMJIT::Signature DOMJIT_u16_signature(
    //     Reader__u16__fastpathWrapper,
    //     thisObject->classInfo(),
    //     JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    //     JSC::SpecInt32Only,
    //     JSC::SpecInt52Any,
    //     JSC::SpecInt32Only);
    // JSFunction* function = JSFunction::create(
    //     globalObject->vm(),
    //     globalObject,
    //     2,
    //     String("u16"_s),
    //     Reader__u16__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic, Reader__u16__slowpathWrapper,
    //     &DOMJIT_u16_signature);
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("u16"_s),
        Reader__u16__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "u16"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__u32__slowpathWrapper);
extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(Reader__u32__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t, int32_t));

// JSC_DEFINE_JIT_OPERATION(Reader__u32__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t arg1, int32_t arg2))
// {
//     auto& vm = JSC::getVM(lexicalGlobalObject);
//     IGNORE_WARNINGS_BEGIN("frame-address")
//     CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
//     IGNORE_WARNINGS_END
//     JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
//     return { Reader__u32__fastpath(lexicalGlobalObject, thisValue, arg1, arg2) };
// }
JSC_DEFINE_HOST_FUNCTION(Reader__u32__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__u32__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__u32__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    // static const JSC::DOMJIT::Signature DOMJIT_u32_signature(
    //     Reader__u32__fastpathWrapper,
    //     thisObject->classInfo(),
    //     JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    //     JSC::SpecInt32Only,
    //     JSC::SpecInt52Any,
    //     JSC::SpecInt32Only);
    // JSFunction* function = JSFunction::create(
    //     globalObject->vm(),
    //     globalObject,
    //     2,
    //     String("u32"_s),
    //     Reader__u32__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic, Reader__u32__slowpathWrapper,
    //     &DOMJIT_u32_signature);
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("u32"_s),
        Reader__u32__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "u32"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__ptr__slowpathWrapper);
extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(Reader__ptr__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t, int32_t));

// JSC_DEFINE_JIT_OPERATION(Reader__ptr__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t arg1, int32_t arg2))
// {
//     auto& vm = JSC::getVM(lexicalGlobalObject);
//     IGNORE_WARNINGS_BEGIN("frame-address")
//     CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
//     IGNORE_WARNINGS_END
//     JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
//     return { Reader__ptr__fastpath(lexicalGlobalObject, thisValue, arg1, arg2) };
// }
JSC_DEFINE_HOST_FUNCTION(Reader__ptr__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__ptr__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__ptr__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    // static const JSC::DOMJIT::Signature DOMJIT_ptr_signature(
    //     Reader__ptr__fastpathWrapper,
    //     thisObject->classInfo(),
    //     JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    //     JSC::SpecInt52Any,
    //     JSC::SpecInt52Any,
    //     JSC::SpecInt32Only);
    // JSFunction* function = JSFunction::create(
    //     globalObject->vm(),
    //     globalObject,
    //     2,
    //     String("ptr"_s),
    //     Reader__ptr__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic, Reader__ptr__slowpathWrapper,
    //     &DOMJIT_ptr_signature);
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("ptr"_s),
        Reader__ptr__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "ptr"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__i8__slowpathWrapper);
extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(Reader__i8__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t, int32_t));

// JSC_DEFINE_JIT_OPERATION(Reader__i8__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t arg1, int32_t arg2))
// {
//     auto& vm = JSC::getVM(lexicalGlobalObject);
//     IGNORE_WARNINGS_BEGIN("frame-address")
//     CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
//     IGNORE_WARNINGS_END
//     JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
//     return { Reader__i8__fastpath(lexicalGlobalObject, thisValue, arg1, arg2) };
// }
JSC_DEFINE_HOST_FUNCTION(Reader__i8__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__i8__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__i8__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    // static const JSC::DOMJIT::Signature DOMJIT_i8_signature(
    //     Reader__i8__fastpathWrapper,
    //     thisObject->classInfo(),
    //     JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    //     JSC::SpecInt32Only,
    //     JSC::SpecInt52Any,
    //     JSC::SpecInt32Only);
    // JSFunction* function = JSFunction::create(
    //     globalObject->vm(),
    //     globalObject,
    //     2,
    //     String("i8"_s),
    //     Reader__i8__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic, Reader__i8__slowpathWrapper,
    //     &DOMJIT_i8_signature);
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("i8"_s),
        Reader__i8__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "i8"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__i16__slowpathWrapper);
extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(Reader__i16__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t, int32_t));

// JSC_DEFINE_JIT_OPERATION(Reader__i16__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t arg1, int32_t arg2))
// {
//     auto& vm = JSC::getVM(lexicalGlobalObject);
//     IGNORE_WARNINGS_BEGIN("frame-address")
//     CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
//     IGNORE_WARNINGS_END
//     JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
//     return { Reader__i16__fastpath(lexicalGlobalObject, thisValue, arg1, arg2) };
// }
JSC_DEFINE_HOST_FUNCTION(Reader__i16__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__i16__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__i16__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    // static const JSC::DOMJIT::Signature DOMJIT_i16_signature(
    //     Reader__i16__fastpathWrapper,
    //     thisObject->classInfo(),
    //     JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    //     JSC::SpecInt32Only,
    //     JSC::SpecInt52Any,
    //     JSC::SpecInt32Only);
    // JSFunction* function = JSFunction::create(
    //     globalObject->vm(),
    //     globalObject,
    //     2,
    //     String("i16"_s),
    //     Reader__i16__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic, Reader__i16__slowpathWrapper,
    //     &DOMJIT_i16_signature);
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("i16"_s),
        Reader__i16__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "i16"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__i32__slowpathWrapper);
extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(Reader__i32__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t, int32_t));

// JSC_DEFINE_JIT_OPERATION(Reader__i32__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t arg1, int32_t arg2))
// {
//     auto& vm = JSC::getVM(lexicalGlobalObject);
//     IGNORE_WARNINGS_BEGIN("frame-address")
//     CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
//     IGNORE_WARNINGS_END
//     JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
//     return { Reader__i32__fastpath(lexicalGlobalObject, thisValue, arg1, arg2) };
// }
JSC_DEFINE_HOST_FUNCTION(Reader__i32__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__i32__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__i32__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    // static const JSC::DOMJIT::Signature DOMJIT_i32_signature(
    //     Reader__i32__fastpathWrapper,
    //     thisObject->classInfo(),
    //     JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    //     JSC::SpecInt32Only,
    //     JSC::SpecInt52Any,
    //     JSC::SpecInt32Only);
    // JSFunction* function = JSFunction::create(
    //     globalObject->vm(),
    //     globalObject,
    //     2,
    //     String("i32"_s),
    //     Reader__i32__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic, Reader__i32__slowpathWrapper,
    //     &DOMJIT_i32_signature);
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("i32"_s),
        Reader__i32__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "i32"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__i64__slowpathWrapper);
extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(Reader__i64__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t, int32_t));

// JSC_DEFINE_JIT_OPERATION(Reader__i64__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t arg1, int32_t arg2))
// {
//     auto& vm = JSC::getVM(lexicalGlobalObject);
//     IGNORE_WARNINGS_BEGIN("frame-address")
//     CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
//     IGNORE_WARNINGS_END
//     JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
//     return { Reader__i64__fastpath(lexicalGlobalObject, thisValue, arg1, arg2) };
// }
JSC_DEFINE_HOST_FUNCTION(Reader__i64__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__i64__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__i64__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    // static const JSC::DOMJIT::Signature DOMJIT_i64_signature(
    //     Reader__i64__fastpathWrapper,
    //     thisObject->classInfo(),
    //     JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    //     JSC::SpecHeapTop,
    //     JSC::SpecInt52Any,
    //     JSC::SpecInt32Only);
    // JSFunction* function = JSFunction::create(
    //     globalObject->vm(),
    //     globalObject,
    //     2,
    //     String("i64"_s),
    //     Reader__i64__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic, Reader__i64__slowpathWrapper,
    //     &DOMJIT_i64_signature);
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("i64"_s),
        Reader__i64__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "i64"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__u64__slowpathWrapper);
// extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(Reader__u64__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t, int32_t));

// JSC_DEFINE_JIT_OPERATION(Reader__u64__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t arg1, int32_t arg2))
// {
//     auto& vm = JSC::getVM(lexicalGlobalObject);
//     IGNORE_WARNINGS_BEGIN("frame-address")
//     CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
//     IGNORE_WARNINGS_END
//     JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
//     return { Reader__u64__fastpath(lexicalGlobalObject, thisValue, arg1, arg2) };
// }
JSC_DEFINE_HOST_FUNCTION(Reader__u64__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__u64__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__u64__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    // static const JSC::DOMJIT::Signature DOMJIT_u64_signature(
    //     Reader__u64__fastpathWrapper,
    //     thisObject->classInfo(),
    //     JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    //     JSC::SpecHeapTop,
    //     JSC::SpecInt52Any,
    //     JSC::SpecInt32Only);
    // JSFunction* function = JSFunction::create(
    //     globalObject->vm(),
    //     globalObject,
    //     2,
    //     String("u64"_s),
    //     Reader__u64__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic, Reader__u64__slowpathWrapper,
    //     &DOMJIT_u64_signature);
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("u64"_s),
        Reader__u64__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "u64"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__intptr__slowpathWrapper);
// extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(Reader__intptr__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t, int32_t));

// JSC_DEFINE_JIT_OPERATION(Reader__intptr__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t arg1, int32_t arg2))
// {
//     auto& vm = JSC::getVM(lexicalGlobalObject);
//     IGNORE_WARNINGS_BEGIN("frame-address")
//     CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
//     IGNORE_WARNINGS_END
//     JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
//     return { Reader__intptr__fastpath(lexicalGlobalObject, thisValue, arg1, arg2) };
// }
JSC_DEFINE_HOST_FUNCTION(Reader__intptr__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__intptr__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__intptr__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    // static const JSC::DOMJIT::Signature DOMJIT_intptr_signature(
    //     Reader__intptr__fastpathWrapper,
    //     thisObject->classInfo(),
    //     JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    //     JSC::SpecInt52Any,
    //     JSC::SpecInt52Any,
    //     JSC::SpecInt32Only);
    // JSFunction* function = JSFunction::create(
    //     globalObject->vm(),
    //     globalObject,
    //     2,
    //     String("intptr"_s),
    //     Reader__intptr__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic, Reader__intptr__slowpathWrapper,
    //     &DOMJIT_intptr_signature);
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("intptr"_s),
        Reader__intptr__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "intptr"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__f32__slowpathWrapper);
// extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(Reader__f32__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t, int32_t));

// JSC_DEFINE_JIT_OPERATION(Reader__f32__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t arg1, int32_t arg2))
// {
//     auto& vm = JSC::getVM(lexicalGlobalObject);
//     IGNORE_WARNINGS_BEGIN("frame-address")
//     CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
//     IGNORE_WARNINGS_END
//     JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
//     return { Reader__f32__fastpath(lexicalGlobalObject, thisValue, arg1, arg2) };
// }
JSC_DEFINE_HOST_FUNCTION(Reader__f32__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__f32__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__f32__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    // static const JSC::DOMJIT::Signature DOMJIT_f32_signature(
    //     Reader__f32__fastpathWrapper,
    //     thisObject->classInfo(),
    //     JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    //     JSC::SpecDoubleReal,
    //     JSC::SpecInt52Any,
    //     JSC::SpecInt32Only);
    // JSFunction* function = JSFunction::create(
    //     globalObject->vm(),
    //     globalObject,
    //     2,
    //     String("f32"_s),
    //     Reader__f32__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic, Reader__f32__slowpathWrapper,
    //     &DOMJIT_f32_signature);
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("f32"_s),
        Reader__f32__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "f32"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__f64__slowpathWrapper);
// extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(Reader__f64__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t, int32_t));

// JSC_DEFINE_JIT_OPERATION(Reader__f64__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int64_t arg1, int32_t arg2))
// {
//     auto& vm = JSC::getVM(lexicalGlobalObject);
//     IGNORE_WARNINGS_BEGIN("frame-address")
//     CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
//     IGNORE_WARNINGS_END
//     JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
//     return { Reader__f64__fastpath(lexicalGlobalObject, thisValue, arg1, arg2) };
// }
JSC_DEFINE_HOST_FUNCTION(Reader__f64__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__f64__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__f64__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    // static const JSC::DOMJIT::Signature DOMJIT_f64_signature(
    //     Reader__f64__fastpathWrapper,
    //     thisObject->classInfo(),
    //     JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    //     JSC::SpecDoubleReal,
    //     JSC::SpecInt52Any,
    //     JSC::SpecInt32Only);
    // JSFunction* function = JSFunction::create(
    //     globalObject->vm(),
    //     globalObject,
    //     2,
    //     String("f64"_s),
    //     Reader__f64__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic, Reader__f64__slowpathWrapper,
    //     &DOMJIT_f64_signature);
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("f64"_s),
        Reader__f64__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "f64"_s),
        function);
}

/* -- END DOMCall DEFINITIONS-- */
