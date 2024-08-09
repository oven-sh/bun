#include "Array.h"

#include "v8/HandleScope.h"

using JSC::ArrayAllocationProfile;
using JSC::JSArray;
using JSC::JSValue;

namespace v8 {

Local<Array> Array::New(Isolate* isolate, Local<Value>* elements, size_t length)
{
    Zig::GlobalObject* globalObject = isolate->globalObject();
    JSArray* array = JSC::constructArray(globalObject,
        static_cast<ArrayAllocationProfile*>(nullptr),
        // TODO fix for v8 layout
        reinterpret_cast<JSValue*>(elements),
        (unsigned int)length);
    return isolate->currentHandleScope()->createLocal<Array>(array);
}

}
