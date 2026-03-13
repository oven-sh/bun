#include <root.h>
#include <JavaScriptCore/ArgList.h>

extern "C" void MarkedArgumentBuffer__run(
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
