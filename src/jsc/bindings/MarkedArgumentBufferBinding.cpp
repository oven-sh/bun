#include <root.h>
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSGlobalObjectInlines.h>

// SUPPRESS_ASAN: MarkedArgumentBuffer's inline buffer (first 8 entries) relies on
// JSC's conservative stack scan to keep its values alive. ASAN's
// detect_stack_use_after_return relocates locals to a heap-backed fake stack that
// the conservative scan does not visit, so values stored only in the inline buffer
// get collected mid-callback. Suppressing ASAN here keeps `args` on the real stack.
extern "C" SUPPRESS_ASAN void MarkedArgumentBuffer__run(
    void* ctx,
    void (*callback)(void* ctx, void* buffer))
{
    JSC::MarkedArgumentBuffer args;
    callback(ctx, &args);
}

extern "C" void MarkedArgumentBuffer__append(void* args, JSC::EncodedJSValue value)
{
    static_cast<JSC::MarkedArgumentBuffer*>(args)->append(JSC::JSValue::decode(value));
}

extern "C" size_t MarkedArgumentBuffer__size(void* args)
{
    return static_cast<JSC::MarkedArgumentBuffer*>(args)->size();
}

extern "C" JSC::EncodedJSValue MarkedArgumentBuffer__constructArray(void* args, JSC::JSGlobalObject* globalObject)
{
    return JSC::JSValue::encode(JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), *static_cast<JSC::MarkedArgumentBuffer*>(args)));
}
