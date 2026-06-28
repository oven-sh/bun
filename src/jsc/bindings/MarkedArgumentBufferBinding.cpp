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

// appendWithCrashOnOverflow, not append: under MarkedArgumentBuffer's
// RecordOverflow policy a failed spill-to-heap allocation makes append() a
// silent no-op, leaving the value unrooted while Rust callers keep using it.
// No Rust caller can recover from that, so turn allocation failure into a
// loud OOM crash instead of a GC use-after-free.
extern "C" void MarkedArgumentBuffer__append(void* args, JSC::EncodedJSValue value)
{
    static_cast<JSC::MarkedArgumentBuffer*>(args)->appendWithCrashOnOverflow(JSC::JSValue::decode(value));
}
