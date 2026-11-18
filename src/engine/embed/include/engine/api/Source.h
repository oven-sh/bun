#pragma once

// Source text and where it came from.

#include "engine/api/Array.h"

namespace JSC {


using SourceTaintedness = SourceTaintedOrigin;

enum class SourceProvenance : bool { Static,
    GeneratedAtRuntime };

class ScriptFetcher : public RefCounted<ScriptFetcher> {
public:
    enum class Type : uint8_t { Cached,
        NodeVM };

    virtual ~ScriptFetcher() = default;
    virtual Type fetcherType() const { return Type::Cached; }
};

class SourceOrigin {
public:
    SourceOrigin() = default;
    explicit SourceOrigin(const URL& url)
        : m_url(url)
    {
    }
    SourceOrigin(const URL& url, Ref<ScriptFetcher>&& fetcher)
        : m_url(url)
        , m_fetcher(WTF::move(fetcher))
    {
    }

    const URL& url() const { return m_url; }
    const String& string() const { return m_url.string(); }
    bool isNull() const { return m_url.isNull(); }
    ScriptFetcher* fetcher() const { return m_fetcher.get(); }

    friend bool operator==(const SourceOrigin&, const SourceOrigin&) = default;

private:
    URL m_url;
    RefPtr<ScriptFetcher> m_fetcher;
};

// The engine makes some without a vtable and without the members that only C++ has, for text that is made at run time.
class SourceProvider {
    WTF_MAKE_NONCOPYABLE(SourceProvider);
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(SourceProvider);

public:
    virtual ~SourceProvider() { Engine::source_provider_destroy(this); }

    void ref() const { m_refCount.fetch_add(1, std::memory_order_relaxed); }
    void deref() const { Engine::source_provider_release(this); }

    StringView source() const { return m_source; }
    unsigned hash() const { return Engine::source_provider_hash(*this); }
    const String& sourceURL() const { return m_url; }
    String sourceURLDirective() const { return Engine::source_provider_url_directive(*this); }
    String sourceMappingURLDirective() const { return Engine::source_provider_mapping_url_directive(*this); }
    SourceProviderSourceType sourceType() const { return m_sourceType; }
    const SourceOrigin& sourceOrigin() const;
    TextPosition startPosition() const { return { OrdinalNumber::fromZeroBasedInt(m_startLine), OrdinalNumber::fromZeroBasedInt(m_startColumn) }; }
    SourceID asID() const { return Engine::source_provider_id(*this); }
    void setModuleHasLiveExports() { m_hasLiveExports = true; }

    bool lineStartTableIsBuilt() const { return Engine::source_provider_has_line_table(*this); }
    LineColumn documentLineColumnForOffset(unsigned offset) const
    {
        LineColumn position;
        Engine::source_provider_position_in_document(*this, offset, position);
        return position;
    }

    bool isFromEmbedder() const { return *reinterpret_cast<void* const*>(this); }

protected:
    SourceProvider(const String& source, const SourceOrigin& origin, String&& url, const TextPosition& start, SourceProviderSourceType type, SourceProvenance provenance = SourceProvenance::GeneratedAtRuntime)
        : m_origin(origin)
    {
        Engine::source_provider_construct(this, source, WTF::move(url), type, start.m_line.zeroBasedInt(), start.m_column.zeroBasedInt(), origin.fetcher(), provenance == SourceProvenance::Static);
    }

    // Instead of what would be computed from the text.
    void setHash(unsigned hash) { m_hash = hash; }
    // What may spare compiling the text: a part of the executable, or what has the hash that was stored with it.
    void setEmbeddedBytecode(std::span<const uint8_t> bytes, uint32_t entry) { Engine::bytecode_set_embedded(*this, bytes, entry); }
    void setLastingBytecode(std::span<const uint8_t> bytes) { Engine::bytecode_set_lasting(*this, bytes); }
    void adoptBytecode(uint8_t* boxedBytes, size_t size) { Engine::bytecode_adopt(*this, boxedBytes, size); }
    void setModuleMayReexportTypes(bool value) { m_mayReexportTypes = value; }

private:
    static void checkLayout();

    mutable std::atomic<uint32_t> m_refCount;
    SourceProviderSourceType m_sourceType;
    bool m_hasLiveExports;
    bool m_mayReexportTypes;
    unsigned m_hash;
    int m_startLine;
    int m_startColumn;
    // Rust constructs and destroys them.
    union {
        String m_source;
    };
    union {
        String m_url;
    };
    Engine::Opaque<Engine::Layout::sourceProviderSize - Engine::Layout::SourceProvider_url - sizeof(String)> m_rest;
    SourceOrigin m_origin;
};

inline void SourceProvider::checkLayout()
{
    ENGINE_CHECK_OFFSET(SourceProvider, m_refCount, SourceProvider_ref_count);
    ENGINE_CHECK_OFFSET(SourceProvider, m_sourceType, SourceProvider_source_type);
    ENGINE_CHECK_OFFSET(SourceProvider, m_hasLiveExports, SourceProvider_has_live_exports);
    ENGINE_CHECK_OFFSET(SourceProvider, m_mayReexportTypes, SourceProvider_may_reexport_types);
    ENGINE_CHECK_OFFSET(SourceProvider, m_hash, SourceProvider_hash);
    ENGINE_CHECK_OFFSET(SourceProvider, m_startLine, SourceProvider_start_line);
    ENGINE_CHECK_OFFSET(SourceProvider, m_startColumn, SourceProvider_start_column);
    ENGINE_CHECK_OFFSET(SourceProvider, m_source, SourceProvider_source);
    ENGINE_CHECK_OFFSET(SourceProvider, m_url, SourceProvider_url);
}

class StringSourceProvider : public SourceProvider {
public:
    static Ref<StringSourceProvider> create(const String& source, const SourceOrigin& origin, String url, SourceTaintedness taintedness, const TextPosition& start = {}, SourceProviderSourceType type = SourceProviderSourceType::Program, SourceProvenance provenance = SourceProvenance::GeneratedAtRuntime)
    {
        return adoptRef(*new StringSourceProvider(source, origin, taintedness, WTF::move(url), start, type, provenance));
    }

protected:
    StringSourceProvider(const String& source, const SourceOrigin& origin, SourceTaintedness, String&& url, const TextPosition& start, SourceProviderSourceType type, SourceProvenance provenance = SourceProvenance::GeneratedAtRuntime)
        : SourceProvider(source, origin, WTF::move(url), start, type, provenance)
    {
    }
};

// A part of a text.
class SourceCode {
public:
    SourceCode() = default;
    SourceCode(Ref<SourceProvider>&& provider)
        : m_provider(WTF::move(provider))
        , m_end(m_provider->source().length())
    {
    }
    SourceCode(RefPtr<SourceProvider>&& provider, int start, int end)
        : m_provider(WTF::move(provider))
        , m_start(start)
        , m_end(end)
    {
    }

    SourceProvider* provider() const { return m_provider.get(); }
    bool isNull() const { return !m_provider; }
    int length() const { return m_end - m_start; }
    StringView view() const { return m_provider ? m_provider->source().substring(m_start, length()) : StringView(); }
    auto toUTF8() const { return view().utf8(); }
    OrdinalNumber firstLine() const { return OrdinalNumber::fromOneBasedInt(start().line); }
    OrdinalNumber startColumn() const { return OrdinalNumber::fromOneBasedInt(start().column); }

private:
    static void checkLayout();

    LineColumn start() const { return m_provider->documentLineColumnForOffset(m_start); }

    RefPtr<SourceProvider> m_provider;
    int m_start { 0 };
    int m_end { 0 };
};

inline void SourceCode::checkLayout()
{
    ENGINE_CHECK_SIZE(SourceCode, sizeOfSourceCode);
    ENGINE_CHECK_OFFSET(SourceCode, m_start, SourceCode_start);
    ENGINE_CHECK_OFFSET(SourceCode, m_end, SourceCode_end);
}

inline SourceCode makeSource(const String& source, const SourceOrigin& origin, SourceTaintedness taintedness, String url = {}, const TextPosition& start = {}, SourceProviderSourceType type = SourceProviderSourceType::Program, SourceProvenance provenance = SourceProvenance::GeneratedAtRuntime)
{
    return SourceCode(StringSourceProvider::create(source, origin, WTF::move(url), taintedness, start, type, provenance));
}

} // namespace JSC
