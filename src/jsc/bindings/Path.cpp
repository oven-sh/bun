#include "Path.h"
#include "ErrorCode.h"

#if OS(WINDOWS)
#define PATH_FUNCTION(name) Bun__Bindgen__NodePath__##name##Win32
#else
#define PATH_FUNCTION(name) Bun__Bindgen__NodePath__##name##Posix
#endif

// src/runtime/node/node_path.bind.ts
extern "C" SYSV_ABI JSC::EncodedJSValue PATH_FUNCTION(dirname)(JSC::JSGlobalObject*, JSC::JSString*);
extern "C" SYSV_ABI JSC::EncodedJSValue PATH_FUNCTION(join)(JSC::JSGlobalObject*, const JSC::EncodedJSValue*, size_t);
extern "C" SYSV_ABI JSC::EncodedJSValue PATH_FUNCTION(concatenate)(JSC::JSGlobalObject*, const JSC::EncodedJSValue*, size_t);

namespace Bun {

JSC::JSValue pathDirname(JSC::JSGlobalObject* globalObject, JSC::JSValue path)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!path.isString()) [[unlikely]] {
        ERR::INVALID_ARG_TYPE(scope, globalObject, "path"_s, "string"_s, path);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSC::JSValue::decode(PATH_FUNCTION(dirname)(globalObject, JSC::asString(path))));
}

JSC::JSValue pathJoin(JSC::JSGlobalObject* globalObject, JSC::JSString* first, JSC::JSString* second)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const JSC::EncodedJSValue paths[] = { JSC::JSValue::encode(first), JSC::JSValue::encode(second) };
    JSC::JSValue joined = JSC::JSValue::decode(PATH_FUNCTION(join)(globalObject, paths, std::size(paths)));
    RETURN_IF_EXCEPTION(scope, {});
    if (joined.isUndefined()) [[unlikely]]
        RELEASE_AND_RETURN(scope, JSC::JSValue::decode(PATH_FUNCTION(concatenate)(globalObject, paths, std::size(paths))));
    return joined;
}

} // namespace Bun
