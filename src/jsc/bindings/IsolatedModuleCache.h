#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/SourceCode.h>
#include <JavaScriptCore/Strong.h>

namespace Zig {
class GlobalObject;
class SourceProvider;
}

namespace Bun {

struct CodeString;

// An internal JS module (InternalModuleRegistry) as compiled for the first global that loaded it.
struct IsolatedInternalModule {
    JSC::SourceCode source;
    JSC::Strong<JSC::UnlinkedFunctionExecutable> executable;
};

// Per-VM cache mapping resolved specifier (absolute path) → Zig::SourceProvider,
// populated only under `bun test --isolate`. Survives global swaps so a fresh
// global's module fetch reuses an already-transpiled provider (and hits JSC's
// CodeCache + Bun__analyzeTranspiledModule for module_info) instead of
// re-running Bun__transpileFile.
//
// Storage lives on JSVMClientData; this class is a stateless facade so the
// gating, key, and tag-cacheability decisions live in exactly one place. The
// map stores Zig::SourceProvider directly (not a wrapper struct) — everything
// callers need to branch on (sourceType(), m_tag, m_moduleInfo)
// already lives on the provider.
class IsolatedModuleCache {
public:
    // The single gate. False if the feature flag is off, --isolate isn't
    // active, or a non-empty type attribute is present (different output for
    // the same path → not cacheable by path alone).
    static bool canUse(JSC::VM&, void* bunVM, const BunString* typeAttribute = nullptr);

    // Only tags whose provider holds transpiled JS, from the on-disk file at the
    // cache key or from a plugin's contents. Loader-specific outputs (File, JSON,
    // Object*, custom CJS extensions, Wasm, builtins) are excluded — they can be
    // produced for the same path via `with {type: ...}` or require.extensions, and
    // lookup() doesn't compare the tag, so caching them would let a later
    // default-loader import of that path hit the wrong provider.
    static bool isTagCacheable(SyntheticModuleType tag)
    {
        switch (tag) {
        case SyntheticModuleType::JavaScript:
        case SyntheticModuleType::PackageJSONTypeModule:
        case SyntheticModuleType::PackageJSONTypeCommonJS:
        // ESM tag is used by builtins that ship real JS source (e.g. bun:wrap).
        // Their providers are constant across globals, so caching is safe.
        case SyntheticModuleType::ESM:
            return true;
        default:
            return false;
        }
    }

    // A key holds only the last provider inserted for it. It's a hit only if that provider was made from the same input:
    // the file or the same `pluginContents` and loader, with the same test globals ("bun:test" or "vitest").
    static Zig::SourceProvider* lookup(JSC::VM&, const WTF::String& key, const CodeString* pluginContents = nullptr);

    // No-op unless isTagCacheable(provider.m_tag) and !provider.m_dependsOnMoreThanSource.
    // Replaces any existing entry, since two in-flight fetches of a key both miss and both insert.
    static void insert(JSC::VM&, const WTF::String& key, Zig::SourceProvider&, const CodeString* pluginContents = nullptr);

    // By the module's id in InternalModuleRegistry. The functions a global has compiled hang off the executable,
    // so the next global compiles only the ones that none before it has called.
    static const IsolatedInternalModule* lookupInternalModule(JSC::VM&, uint32_t id);
    static void insertInternalModule(JSC::VM&, uint32_t id, const JSC::SourceCode&, JSC::UnlinkedFunctionExecutable*);

    static void evict(JSC::VM&, const WTF::String& key);
    static void clear(JSC::VM&);
};

// bun:internal-for-testing — returns the cached provider's sourceType name
// for a resolved specifier, or null when not cached.
JSC::JSValue createIsolatedModuleCacheSourceTypeForTesting(Zig::GlobalObject* globalObject);

} // namespace Bun
