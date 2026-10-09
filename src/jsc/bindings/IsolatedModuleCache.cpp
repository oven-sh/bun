#include "IsolatedModuleCache.h"
#include "BunClientData.h"
#include "ModuleLoader.h"
#include "ZigGlobalObject.h"
#include "ZigSourceProvider.h"
#include "JavaScriptCore/JSCInlines.h"
#include <JavaScriptCore/JSFunction.h>

namespace Bun {

bool IsolatedModuleCache::canUse(JSC::VM&, void* bunVM, const BunString* typeAttribute)
{
    if (!isBunTest)
        return false;
    if (!Bun__VM__useIsolationSourceProviderCache(bunVM))
        return false;
    if (typeAttribute && !typeAttribute->isEmpty())
        return false;
    return true;
}

extern "C" uint64_t Bun__hashPluginContents(const EncodedSlice* contents, BunLoaderType loader);

static uint64_t pluginContentsHash(const CodeString* pluginContents)
{
    return pluginContents ? Bun__hashPluginContents(&pluginContents->string, pluginContents->loader) : 0;
}

Zig::SourceProvider* IsolatedModuleCache::lookup(JSC::VM& vm, const WTF::String& key, const CodeString* pluginContents)
{
    auto& cache = WebCore::clientData(vm)->isolationSourceProviderCache;
    auto it = cache.find(key);
    if (it == cache.end())
        return nullptr;
    ASSERT(it->value);
    auto* provider = static_cast<Zig::SourceProvider*>(it->value.get());
    return provider->m_pluginContentsHash == pluginContentsHash(pluginContents) ? provider : nullptr;
}

void IsolatedModuleCache::insert(JSC::VM& vm, const WTF::String& key, Zig::SourceProvider& provider, const CodeString* pluginContents)
{
    if (!isTagCacheable(static_cast<SyntheticModuleType>(provider.m_tag)))
        return;
    provider.m_pluginContentsHash = pluginContentsHash(pluginContents);
    auto result = WebCore::clientData(vm)->isolationSourceProviderCache.add(key, nullptr);
    ASSERT_WITH_MESSAGE(result.isNewEntry || static_cast<Zig::SourceProvider*>(result.iterator->value.get())->m_pluginContentsHash != provider.m_pluginContentsHash, "IsolatedModuleCache::insert for already-cached key — a lookup was bypassed");
    result.iterator->value = &provider;
}

void IsolatedModuleCache::evict(JSC::VM& vm, const WTF::String& key)
{
    WebCore::clientData(vm)->isolationSourceProviderCache.remove(key);
}

void IsolatedModuleCache::clear(JSC::VM& vm)
{
    WebCore::clientData(vm)->isolationSourceProviderCache.clear();
}

// Test-only (bun:internal-for-testing). Returns the cached provider's
// JSC::SourceProviderSourceType name for a resolved specifier, or null when
// the key isn't cached. Lets tests assert that transpiled ESM enters the
// cache as BunTranspiledModule (module_info attached — record rebuilt without
// re-parsing) rather than a plain Module.
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsolatedModuleCacheSourceType, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto key = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto* provider = IsolatedModuleCache::lookup(vm, key);
    if (!provider)
        return JSC::JSValue::encode(JSC::jsNull());
    switch (provider->sourceType()) {
    case JSC::SourceProviderSourceType::Program:
        return JSC::JSValue::encode(JSC::jsNontrivialString(vm, "Program"_s));
    case JSC::SourceProviderSourceType::Module:
        return JSC::JSValue::encode(JSC::jsNontrivialString(vm, "Module"_s));
    case JSC::SourceProviderSourceType::BunTranspiledModule:
        return JSC::JSValue::encode(JSC::jsNontrivialString(vm, "BunTranspiledModule"_s));
    default:
        // Unreachable today (isTagCacheable only admits JS-ish tags, whose
        // providers are Program/Module/BunTranspiledModule), but keep the
        // `string | null` contract if that ever widens.
        return JSC::JSValue::encode(JSC::jsNontrivialString(vm, "Unknown"_s));
    }
}

JSC::JSValue createIsolatedModuleCacheSourceTypeForTesting(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    return JSC::JSFunction::create(vm, globalObject, 1, "isolatedModuleCacheSourceType"_s, jsFunctionIsolatedModuleCacheSourceType, JSC::ImplementationVisibility::Public);
}

} // namespace Bun
