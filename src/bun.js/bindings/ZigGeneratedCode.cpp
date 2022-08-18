#include "root.h"

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

extern "C" JSC_DECLARE_HOST_FUNCTION(FFI__ptr__slowpathWrapper);
extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(FFI__ptr__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, JSC::JSUint8Array*));

JSC_DEFINE_JIT_OPERATION(FFI__ptr__fastpathWrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, JSC::JSUint8Array* arg1))
{
    VM& vm = JSC::getVM(lexicalGlobalObject);
    IGNORE_WARNINGS_BEGIN("frame-address")
    CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    IGNORE_WARNINGS_END
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
    return FFI__ptr__fastpath(lexicalGlobalObject, thisValue, arg1);
}
JSC_DEFINE_HOST_FUNCTION(FFI__ptr__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return FFI__ptr__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void FFI__ptr__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    static const JSC::DOMJIT::Signature DOMJIT_ptr_signature(
        FFI__ptr__fastpathWrapper,
        thisObject->classInfo(),
        JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
        JSC::SpecNonIntAsDouble,
        JSC::SpecUint8Array);
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        1,
        String("ptr"_s),
        FFI__ptr__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic, FFI__ptr__slowpathWrapper,
        &DOMJIT_ptr_signature);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "ptr"_s),
        function,
        JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DOMJITFunction | 0);
}

/* -- END DOMCall DEFINITIONS-- */
