#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/SourceProvider.h"
#include "JavaScriptCore/SourceOrigin.h"
#include "JavaScriptCore/CachedBytecode.h"
#include "wtf/RefPtr.h"

namespace Bun {

class SourceProvider;

/// Registers a source map with the Bun VM for debugging/stack traces
extern "C" void Bun__addSourceProviderSourceMap(
    void* bun_vm,
    SourceProvider* opaque_source_provider,
    BunString* specifier);

/**
 * BunSourceProvider - JSC SourceProvider implementation for Bun modules
 *
 * This is a lightweight SourceProvider that holds transpiled JavaScript source code
 * without needing the full ResolvedSource struct. It owns:
 * - The source code string
 * - Optional bytecode cache
 * - A reference to the global object for sourcemap registration
 * - The computed hash
 *
 * Notably, it does NOT store the full ResolvedSource, which is the key difference
 * from the old implementation. This reduces memory usage and simplifies ownership.
 */
class SourceProvider final : public JSC::StringSourceProvider {
public:
    /**
     * Create a new BunSourceProvider from transpiled source
     *
     * @param globalObject The JSGlobalObject for sourcemap registration
     * @param source The transpiled JavaScript source code
     * @param sourceOrigin The origin of the source (URL, etc.)
     * @param sourceURL The source URL for debugging
     * @param cachedBytecode Optional cached bytecode
     * @param startPosition Starting position in source
     * @param sourceType Type of source (module, script, etc.)
     * @return A new ref-counted SourceProvider
     */
    static Ref<SourceProvider> create(
        JSC::JSGlobalObject* globalObject,
        const String& source,
        const JSC::SourceOrigin& sourceOrigin,
        String&& sourceURL,
        RefPtr<JSC::CachedBytecode>&& cachedBytecode,
        const TextPosition& startPosition = TextPosition(),
        JSC::SourceProviderSourceType sourceType = JSC::SourceProviderSourceType::Module);

    /// Get the cached bytecode if available
    RefPtr<JSC::CachedBytecode> cachedBytecode() const { return m_cachedBytecode; }

    /// Destructor
    virtual ~SourceProvider();

private:
    /// Private constructor - use create() instead
    SourceProvider(
        JSC::JSGlobalObject* globalObject,
        const String& source,
        const JSC::SourceOrigin& sourceOrigin,
        String&& sourceURL,
        RefPtr<JSC::CachedBytecode>&& cachedBytecode,
        const TextPosition& startPosition,
        JSC::SourceProviderSourceType sourceType);

    /// The source code string (owned by base class)
    // Inherited: String m_source;

    /// Optional cached bytecode
    RefPtr<JSC::CachedBytecode> m_cachedBytecode;

    /// Reference to global object (for sourcemap registration)
    JSC::JSGlobalObject* m_globalObject;

    /// Precomputed hash for the source
    unsigned m_hash;
};

} // namespace Bun

/**
 * C bridge function to create a SourceProvider from Zig
 *
 * Takes a TranspiledSource struct from Zig and creates a C++ SourceProvider.
 * The ownership of strings and bytecode transfers from Zig to C++.
 *
 * @param globalObject The global object
 * @param transpiled The transpiled source from Zig
 * @return A leaked ref to the SourceProvider (caller takes ownership)
 */
extern "C" Bun::SourceProvider* Bun__createSourceProvider(
    JSC::JSGlobalObject* globalObject,
    TranspiledSource* transpiled);
