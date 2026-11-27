#include "Path.h"
#include "BunClientData.h"
#include "ErrorCode.h"
#include "ZigGlobalObject.h"

#if OS(WINDOWS)
#define PATH_FUNCTION(name) Bun__Bindgen__NodePath__##name##Win32
#else
#define PATH_FUNCTION(name) Bun__Bindgen__NodePath__##name##Posix
#endif

// src/runtime/node/node_path.bind.ts
extern "C" SYSV_ABI JSC::EncodedJSValue PATH_FUNCTION(dirname)(JSC::JSGlobalObject*, JSC::JSString*);
extern "C" SYSV_ABI JSC::EncodedJSValue PATH_FUNCTION(tryJoin)(JSC::JSGlobalObject*, const JSC::EncodedJSValue*, size_t);

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
    JSC::JSValue joined = JSC::JSValue::decode(PATH_FUNCTION(tryJoin)(globalObject, paths, std::size(paths)));
    RETURN_IF_EXCEPTION(scope, {});
    if (joined.isUndefined()) [[unlikely]]
        return JSC::jsSingleCharacterString(vm, u'.');
    return joined;
}

static ALWAYS_INLINE PathModuleObject& moduleObject(JSC::JSGlobalObject* globalObject, PathPlatform platform)
{
    return uncheckedDowncast<Zig::GlobalObject>(globalObject)->m_pathModule.objects[platform];
}

static const JSC::Identifier& normalizeName(JSC::VM& vm) { return WebCore::builtinNames(vm).normalizePublicName(); }
static const JSC::Identifier& resolveName(JSC::VM& vm) { return vm.propertyNames->resolve; }

static ALWAYS_INLINE OwnPropertyCache::NameGetter nameGetter(PathMethod method)
{
    return method == PathMethod::Normalize ? normalizeName : resolveName;
}

static ALWAYS_INLINE JSC::JSValue currentMethod(JSC::JSGlobalObject* globalObject, PathPlatform platform, PathMethod method)
{
    auto& [object, methods] = moduleObject(globalObject, platform);
    ASSERT(object);
    return methods[method].current.get(globalObject, object.get(), nameGetter(method));
}

static void registerObject(JSC::JSGlobalObject* globalObject, PathPlatform platform, JSC::EncodedJSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    auto& [object, methods] = moduleObject(globalObject, platform);
    object.set(vm, globalObject, JSC::asObject(JSC::JSValue::decode(value)));
    for (auto method : { PathMethod::Normalize, PathMethod::Resolve })
        methods[method].original.set(vm, globalObject, currentMethod(globalObject, platform, method));
}

extern "C" SYSV_ABI JSC::EncodedJSValue Bun__Path__registerModule(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue posix, JSC::EncodedJSValue win32)
{
    registerObject(globalObject, PathPlatform::Posix, posix);
    registerObject(globalObject, PathPlatform::Win32, win32);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

extern "C" JSC::EncodedJSValue Bun__Path__throwNotAString(JSC::JSGlobalObject* globalObject, size_t index, JSC::EncodedJSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    return ERR::INVALID_ARG_TYPE(scope, globalObject, makeString("paths["_s, index, ']'), "string"_s, JSC::JSValue::decode(value));
}

extern "C" __attribute__((__always_inline__)) bool Bun__Path__isOriginal(JSC::JSGlobalObject* globalObject, PathPlatform platform, PathMethod method)
{
    return currentMethod(globalObject, platform, method) == moduleObject(globalObject, platform).methods[method].original.get();
}

extern "C" JSC::EncodedJSValue Bun__Path__callMethod(JSC::JSGlobalObject* globalObject, PathPlatform platform, PathMethod method, JSC::EncodedJSValue argument)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* object = moduleObject(globalObject, platform).object.get();
    auto& name = nameGetter(method)(vm);
    JSC::JSValue function = object->get(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    auto callData = JSC::getCallData(function);
    if (callData.type == JSC::CallData::Type::None) {
        throwTypeError(globalObject, scope, makeString(platform == PathPlatform::Win32 ? "win32."_s : "posix."_s, name.string(), " is not a function"_s));
        return {};
    }
    JSC::JSValue result = JSC::call(globalObject, function, callData, object, JSC::ArgList(&argument, 1));
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(result);
}

} // namespace Bun
