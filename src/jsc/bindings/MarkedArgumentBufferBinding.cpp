#include <root.h>
#include <JavaScriptCore/ArgList.h>

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

// An empty value is an array hole: it is appended as undefined.
extern "C" void MarkedArgumentBuffer__appendSlice(void* args, const JSC::EncodedJSValue* values, size_t count)
{
    auto* buffer = static_cast<JSC::MarkedArgumentBuffer*>(args);
    buffer->ensureCapacity(buffer->size() + count);
    for (size_t i = 0; i < count; i++) {
        JSC::JSValue value = JSC::JSValue::decode(values[i]);
        buffer->append(value ? value : JSC::jsUndefined());
    }
}

extern "C" const JSC::EncodedJSValue* MarkedArgumentBuffer__data(void* args, size_t* size)
{
    auto* buffer = static_cast<JSC::MarkedArgumentBuffer*>(args);
    *size = buffer->size();
    return buffer->data();
}

extern "C" bool MarkedArgumentBuffer__hasOverflowed(void* args)
{
    return static_cast<JSC::MarkedArgumentBuffer*>(args)->hasOverflowed();
}
