#include "IsolatedModuleCache.h"
#include "BunClientData.h"
#include "ModuleLoader.h"
#include "ZigGlobalObject.h"
#include "ZigSourceProvider.h"
#include "JavaScriptCore/JSCInlines.h"
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/StrongInlines.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>
#include <algorithm>
#include <wtf/HashSet.h>

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
extern "C" bool Bun__VM__hasGlobalsOfVitest(void* bunVM);

static uint64_t madeFromHash(JSC::VM& vm, const WTF::String& key, const CodeString* pluginContents)
{
    void* bunVM = WebCore::clientData(vm)->bunVM;
    uint64_t hash = pluginContents ? Bun__hashPluginContents(&pluginContents->string, pluginContents->loader) : 0;
    // An entry point is transpiled differently from an import of the same file.
    BunString borrowedKey = Bun::toString(key);
    if (Bun__VM__isTestEntryPoint(bunVM, &borrowedKey))
        hash ^= 0x9e3779b97f4a7c15ULL;
    return Bun__VM__hasGlobalsOfVitest(bunVM) ? ~hash : hash;
}

static Zig::SourceProvider* findProvider(JSC::VM& vm, const WTF::String& key, const CodeString* pluginContents)
{
    auto& cache = WebCore::clientData(vm)->isolationSourceProviderCache;
    auto it = cache.find(key);
    if (it == cache.end())
        return nullptr;
    ASSERT(it->value);
    auto* provider = static_cast<Zig::SourceProvider*>(it->value.get());
    return provider->m_madeFromHash == madeFromHash(vm, key, pluginContents) ? provider : nullptr;
}

static void didUseProvider(JSC::VM& vm, Zig::SourceProvider& provider)
{
    const uint32_t file = WebCore::clientData(vm)->isolationFileNumber;
    if (provider.m_filesThatUsedIt && provider.m_lastUsedByFile == file)
        return;
    provider.m_lastUsedByFile = file;
    provider.m_filesThatUsedIt++;
}

Zig::SourceProvider* IsolatedModuleCache::lookup(JSC::VM& vm, const WTF::String& key, const CodeString* pluginContents)
{
    auto* provider = findProvider(vm, key, pluginContents);
    if (provider)
        didUseProvider(vm, *provider);
    return provider;
}

void IsolatedModuleCache::insert(JSC::VM& vm, const WTF::String& key, Zig::SourceProvider& provider, const CodeString* pluginContents)
{
    if (!isTagCacheable(static_cast<SyntheticModuleType>(provider.m_tag)) || provider.m_dependsOnMoreThanSource)
        return;
    auto* clientData = WebCore::clientData(vm);
    provider.m_madeFromHash = madeFromHash(vm, key, pluginContents);
    BunString borrowedKey = Bun::toString(key);
    provider.m_isMainModule = Bun__VM__isMainModule(clientData->bunVM, &borrowedKey);
    auto& cached = clientData->isolationSourceProviderCache.add(key, nullptr).iterator->value;
    if (auto* replaced = static_cast<Zig::SourceProvider*>(cached.get())) {
        provider.m_lastUsedByFile = replaced->m_lastUsedByFile;
        provider.m_filesThatUsedIt = replaced->m_filesThatUsedIt;
    }
    didUseProvider(vm, provider);
    cached = &provider;
}

const IsolatedInternalModule* IsolatedModuleCache::lookupInternalModule(JSC::VM& vm, uint32_t id)
{
    auto& modules = WebCore::clientData(vm)->isolationInternalModules;
    return id < modules.size() && modules[id].executable ? &modules[id] : nullptr;
}

void IsolatedModuleCache::insertInternalModule(JSC::VM& vm, uint32_t id, const JSC::SourceCode& source, JSC::UnlinkedFunctionExecutable* executable)
{
    auto& modules = WebCore::clientData(vm)->isolationInternalModules;
    if (id >= modules.size())
        modules.grow(id + 1);
    modules[id] = { source, JSC::Strong<JSC::UnlinkedFunctionExecutable>(vm, executable) };
}

void IsolatedModuleCache::insertIfAbsent(JSC::VM& vm, const WTF::String& key, Zig::SourceProvider& provider, const CodeString* pluginContents)
{
    if (!findProvider(vm, key, pluginContents))
        insert(vm, key, provider, pluginContents);
}

void IsolatedModuleCache::evict(JSC::VM& vm, const WTF::String& key)
{
    WebCore::clientData(vm)->isolationSourceProviderCache.remove(key);
}

void IsolatedModuleCache::clear(JSC::VM& vm)
{
    WebCore::clientData(vm)->isolationSourceProviderCache.clear();
}

void IsolatedModuleCache::didFinishFile(JSC::VM& vm, size_t maxBytes)
{
    auto* clientData = WebCore::clientData(vm);
    auto& cache = clientData->isolationSourceProviderCache;
    const uint32_t finishedFile = clientData->isolationFileNumber++;
    // A source that is loaded again has another SourceID, which `bun test --coverage` counts as another source.
    if (vm.controlFlowProfiler())
        return;

    struct Candidate {
        double score;
        size_t bytes;
        JSC::SourceProvider* provider;
    };
    Vector<Candidate> candidates;
    size_t bytes = 0;
    cache.removeIf([&](auto& entry) {
        auto& provider = static_cast<Zig::SourceProvider&>(*entry.value);
        if (provider.m_isMainModule)
            return true;
        // Removing one that has another owner would free nothing.
        if (provider.m_lastUsedByFile != finishedFile && provider.hasOneRef()) {
            // Capped, so that no module stays for long after the files that use it.
            constexpr uint32_t maxFiles = 8;
            const double score = static_cast<double>(finishedFile - provider.m_lastUsedByFile) / std::min(provider.m_filesThatUsedIt, maxFiles);
            candidates.append({ score, provider.source().sizeInBytes(), &provider });
            bytes += candidates.last().bytes;
        }
        return false;
    });
    if (bytes <= maxBytes)
        return;

    std::ranges::sort(candidates, std::ranges::greater {}, &Candidate::score);
    WTF::HashSet<JSC::SourceProvider*> dropped;
    for (auto& candidate : candidates) {
        if (bytes <= maxBytes)
            break;
        bytes -= candidate.bytes;
        dropped.add(candidate.provider);
    }
    cache.removeIf([&](auto& entry) { return dropped.contains(entry.value.get()); });
}

extern "C" void Bun__IsolatedModuleCache__didFinishFile(JSC::JSGlobalObject* globalObject, size_t maxBytes)
{
    IsolatedModuleCache::didFinishFile(JSC::getVM(globalObject), maxBytes);
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
    auto* provider = findProvider(vm, key, nullptr);
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
