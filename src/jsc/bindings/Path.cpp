#include "Path.h"
#include "Bindgen/IDLConvert.h"

// src/runtime/node/node_path.bind.ts
extern "C" SYSV_ABI JSC::EncodedJSValue Bun__Bindgen__NodePath__dirnamePosix(JSC::JSGlobalObject*, JSC::JSString*);
extern "C" SYSV_ABI JSC::EncodedJSValue Bun__Bindgen__NodePath__dirnameWin32(JSC::JSGlobalObject*, JSC::JSString*);
extern "C" SYSV_ABI JSC::EncodedJSValue Bun__Bindgen__NodePath__resolvePosix(JSC::JSGlobalObject*, const JSC::EncodedJSValue*, size_t);
extern "C" SYSV_ABI JSC::EncodedJSValue Bun__Bindgen__NodePath__resolveWin32(JSC::JSGlobalObject*, const JSC::EncodedJSValue*, size_t);

namespace Bun {

JSC::JSValue pathDirname(JSC::JSGlobalObject* globalObject, JSC::JSValue path)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::EnsureStillAliveScope argument = Bindgen::stringOfStringObject(*globalObject, path);
    RETURN_IF_EXCEPTION(scope, {});
    auto ctx = Bindgen::ValidatorArgumentContext { "path"_s, "string"_s, argument.value() };
    JSC::JSString* string = convertIDL<Bindgen::IDLRawString>(*globalObject, argument.value(), ctx);
    RETURN_IF_EXCEPTION(scope, {});
#if OS(WINDOWS)
    RELEASE_AND_RETURN(scope, JSC::JSValue::decode(Bun__Bindgen__NodePath__dirnameWin32(globalObject, string)));
#else
    RELEASE_AND_RETURN(scope, JSC::JSValue::decode(Bun__Bindgen__NodePath__dirnamePosix(globalObject, string)));
#endif
}

JSC::JSValue pathResolve(JSC::JSGlobalObject* globalObject, JSC::JSString* path)
{
    JSC::EncodedJSValue paths[] = { JSC::JSValue::encode(path) };
#if OS(WINDOWS)
    return JSC::JSValue::decode(Bun__Bindgen__NodePath__resolveWin32(globalObject, paths, 1));
#else
    return JSC::JSValue::decode(Bun__Bindgen__NodePath__resolvePosix(globalObject, paths, 1));
#endif
}

} // namespace Bun
