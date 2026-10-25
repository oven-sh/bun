#include "V8Signature.h"
#include "V8FunctionTemplate.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Signature)

namespace v8 {

Local<Signature> Signature::New(Isolate* isolate, Local<FunctionTemplate> receiver)
{
    // In V8 a Signature is just its FunctionTemplate; the receiver check happens
    // at call time. Bun doesn't enforce the receiver check yet, so we simply
    // alias the template handle (or undefined when none was given) so addons
    // can round-trip it through FunctionTemplate::New without asserting.
    if (receiver.IsEmpty()) {
        return isolate->currentHandleScope()->createLocal<Signature>(isolate->vm(), JSC::jsUndefined());
    }
    return receiver.reinterpret<Signature>();
}

} // namespace v8
