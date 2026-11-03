#include "headers.h"
#include "root.h"

#pragma once

namespace JSC {
class Structure;
class Identifier;
class SourceCode;
class SourceCodeKey;
class SourceProvider;
} // namespace JSC

#include <JavaScriptCore/CachedBytecode.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSTypeInfo.h>
#include <JavaScriptCore/SourceProvider.h>
#include <JavaScriptCore/Structure.h>

struct bun_ModuleInfoDeserialized;

namespace Zig {

class GlobalObject;

// A provider that wraps another one has a SourceID of its own, which `bun test --coverage` has to learn of.
void addCodeCoverageSourceID(JSC::VM&, JSC::SourceProvider& provider);
JSC::SourceOrigin toSourceOrigin(const String& sourceURL, bool isBuiltin);
class SourceProvider final : public JSC::SourceProvider {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(SourceProvider);
    using Base = JSC::SourceProvider;
    using SourceOrigin = JSC::SourceOrigin;

public:
    static Ref<SourceProvider> create(
        Zig::GlobalObject*,
        ResolvedSource& resolvedSource,
        JSC::SourceProviderSourceType sourceType = JSC::SourceProviderSourceType::Module,
        bool isBuiltIn = false);
    ~SourceProvider();
    unsigned hash() const override;
    StringView source() const override;

    RefPtr<JSC::CachedBytecode> cachedBytecode() const final
    {
        return m_cachedBytecode.copyRef();
    };

    // Taken from the ResolvedSource at create(); freed in the destructor (or
    // earlier by BunAnalyzeTranspiledModule once consumed).
    bun_ModuleInfoDeserialized* m_moduleInfo { nullptr };
    uint32_t m_tag { 0 };
    bool m_alreadyBundled { false };
    bool m_dependsOnMoreThanSource { false };
    // Set by IsolatedModuleCache::insert() and compared by lookup().
    uint64_t m_madeFromHash { 0 };

private:
    SourceProvider(ResolvedSource& resolvedSource, Ref<WTF::StringImpl>&& sourceImpl,
        JSC::SourceTaintedOrigin taintedness,
        const SourceOrigin& sourceOrigin, WTF::String&& sourceURL,
        const TextPosition& startPosition, JSC::SourceProviderSourceType sourceType)
        : Base(sourceOrigin, WTF::move(sourceURL), String(), taintedness, startPosition, sourceType, resolvedSource.is_static ? JSC::SourceProvenance::Static : JSC::SourceProvenance::GeneratedAtRuntime)
        , m_moduleInfo(std::exchange(resolvedSource.module_info, nullptr))
        , m_tag(resolvedSource.tag)
        , m_alreadyBundled(resolvedSource.already_bundled)
        , m_dependsOnMoreThanSource(resolvedSource.depends_on_more_than_source)
        , m_source(WTF::move(sourceImpl))
    {
    }

    RefPtr<JSC::CachedBytecode> m_cachedBytecode;
    Ref<WTF::StringImpl> m_source;
    unsigned m_hash = 0;
    // The source map of this text, when it has one. Last: it leaves the table before m_source goes. It holds the Bun
    // VM itself (not the creating global), so that this stays valid when the provider outlives its global under
    // --isolate caching.
    Bun::SourceMapRegistration m_sourceMap;
};

} // namespace Zig

namespace Bun {

// While Bun's loader hands a file that it transpiled to an overridden module._compile (JSCommonJSModule::
// evaluateWithPotentiallyOverriddenCompile). Node hands such a hook the text of the file. Bun hands it what the
// transpiler printed, and no Zig::SourceProvider holds that text, so its map goes to the provider of what the override
// compiles for the module under the name of the file (providerOfCompiledText). A hook that keeps every line where it
// is gets the positions of the file that way.
class SourceMapHandoff {
    WTF_MAKE_NONCOPYABLE(SourceMapHandoff);

public:
    // `module` is the JSCommonJSModule that is being loaded, and `filename` what the override is called with. Takes
    // `sourceMap` (ResolvedSource::source_map).
    SourceMapHandoff(JSC::VM&, JSC::JSCell* module, const String& filename, void* sourceMap);
    ~SourceMapHandoff();

private:
    friend Ref<JSC::SourceProvider> providerOfCompiledText(JSC::VM&, JSC::JSCell*, const String&, const JSC::SourceOrigin&, String, JSC::SourceTaintedness);

    SourceMapHandoff*& m_slot;
    SourceMapHandoff* m_previous;
    JSC::JSCell* m_module;
    String m_filename;
    // Until a provider takes it.
    void* m_sourceMap;
    // The provider that took it. What the module compiles after it under the name of the file has that map too: a hook
    // that compiles again after a SyntaxError.
    RefPtr<JSC::SourceProvider> m_first;
};

// The provider of the text that module._compile(text, filename) is called with on `module`. The name says nothing of
// the text: a file of that name may be loaded, and its source map maps another text. So the provider has no source map,
// unless Bun's loader is handing `module` to the module._compile that makes this call.
Ref<JSC::SourceProvider> providerOfCompiledText(JSC::VM&, JSC::JSCell* module, const String& text, const JSC::SourceOrigin&, String filename, JSC::SourceTaintedness);

// JSC's bytecode encoder aborts on a string of 2^27 or more characters unless it encodes against a string table.
// Call this after `source`'s unlinked code is generated.
bool hasStringTooLongForBytecodeCache(JSC::VM&, const JSC::SourceCode& source);

// Bytecode that is a section of the executable: not owned, and there for the life of the process. `entryOffset` is where
// the module's cache entry starts in `bytes` when they are the one payload of a link.
inline Ref<JSC::CachedBytecode> embeddedBytecode(std::span<uint8_t> bytes, uint32_t entryOffset)
{
    Ref<JSC::CachedBytecode> bytecode = JSC::CachedBytecode::create(bytes, nullptr, {});
    bytecode->setPayloadIsPersistent();
    bytecode->setEntryOffset(entryOffset);
    return bytecode;
}

// bun_bundler::bytecode_order::CodeNamesRef. `functions` is sorted by (start, kind), each once; none for a text without names.
struct BytecodeOrderNamesRef {
    uint64_t module;
    const JSC::BytecodeOrderNames::Function* functions;
    size_t functionCount;

    JSC::BytecodeOrderNames view() const
    {
        static_assert(sizeof(JSC::BytecodeOrderNames::Function) == 16 && offsetof(JSC::BytecodeOrderNames::Function, key) == 0 && offsetof(JSC::OrderFunctionKey, kind) == 4 && offsetof(JSC::BytecodeOrderNames::Function, name) == 8, "FunctionIdentity");
        static_assert(!static_cast<uint8_t>(JSC::OrderFunctionKind::Function) && static_cast<uint8_t>(JSC::OrderFunctionKind::InnerBody) == 1 && static_cast<uint8_t>(JSC::OrderFunctionKind::ClassFields) == 2 && static_cast<uint8_t>(JSC::OrderFunctionKind::DefaultConstructor) == 3, "FunctionKind");
        std::span span { functions, functionCount };
        ASSERT(std::ranges::is_sorted(span, {}, &JSC::BytecodeOrderNames::Function::key));
        ASSERT(std::ranges::adjacent_find(span, {}, &JSC::BytecodeOrderNames::Function::key) == span.end());
        return { module, span };
    }
};

JSC_DECLARE_HOST_FUNCTION(jsSourceHasLineStarts);

} // namespace Bun
