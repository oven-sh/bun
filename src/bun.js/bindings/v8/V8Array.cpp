#include "V8Array.h"

#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Array)

using JSC::ArrayAllocationProfile;
using JSC::JSArray;
using JSC::JSValue;

namespace v8 {

Local<Array> Array::New(Isolate* isolate, Local<Value>* elements, size_t length)
{
    V8_UNIMPLEMENTED();
    // TODO fix for v8 layout
    Zig::GlobalObject* globalObject = isolate->globalObject();
    JSArray* array = JSC::constructArray(globalObject,
        static_cast<ArrayAllocationProfile*>(nullptr),
        reinterpret_cast<JSValue*>(elements),
        (unsigned int)length);
    // RETURN_IF_EXCEPTION
    return isolate->currentHandleScope()->createLocal<Array>(isolate->vm(), array);
}

} // namespace v8
