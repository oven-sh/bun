#include "engine/Engine.h"

namespace JSC {

extern "C" void engine_host_compile_wasm_streaming(JSGlobalObject* globalObject, JSPromise* promise, EncodedJSValue source, EncodedJSValue options)
{
    globalObject->globalObjectMethodTable()->compileStreaming(globalObject, promise, JSValue::decode(source), WebAssemblyCompileOptions(JSValue::decode(options)));
}

extern "C" void engine_host_instantiate_wasm_streaming(JSGlobalObject* globalObject, JSPromise* promise, EncodedJSValue source, JSObject* imports, EncodedJSValue options)
{
    globalObject->globalObjectMethodTable()->instantiateStreaming(globalObject, promise, JSValue::decode(source), imports, WebAssemblyCompileOptions(JSValue::decode(options)));
}

} // namespace JSC
