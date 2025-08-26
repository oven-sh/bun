#pragma once
#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/SourceOrigin.h"
#include "ZigGlobalObject.h"
#include <mimalloc.h>

namespace Bake {

class DevServerSourceProvider;

class SourceMapJSONString {
public:
    SourceMapJSONString(const char* ptr, size_t length)
        : m_ptr(ptr)
        , m_length(length)
    {
    }

    ~SourceMapJSONString()
    {
        if (m_ptr) {
            mi_free(const_cast<char*>(m_ptr));
        }
    }

    // Delete copy constructor and assignment operator to prevent double free
    SourceMapJSONString(const SourceMapJSONString&) = delete;
    SourceMapJSONString& operator=(const SourceMapJSONString&) = delete;

    // Move constructor and assignment
    SourceMapJSONString(SourceMapJSONString&& other) noexcept
        : m_ptr(other.m_ptr)
        , m_length(other.m_length)
    {
        other.m_ptr = nullptr;
        other.m_length = 0;
    }

    SourceMapJSONString& operator=(SourceMapJSONString&& other) noexcept
    {
        if (this != &other) {
            if (m_ptr) {
                mi_free(const_cast<char*>(m_ptr));
            }
            m_ptr = other.m_ptr;
            m_length = other.m_length;
            other.m_ptr = nullptr;
            other.m_length = 0;
        }
        return *this;
    }

    const char* ptr() const { return m_ptr; }
    size_t length() const { return m_length; }

private:
    const char* m_ptr;
    size_t m_length;
};

// Struct to return source map data to Zig
struct SourceMapData {
    const char* ptr;
    size_t length;
};

// Function to be implemented in Zig to register the source provider
extern "C" void Bun__addDevServerSourceProvider(void* bun_vm, DevServerSourceProvider* opaque_source_provider, BunString* specifier);

class DevServerSourceProvider final : public JSC::StringSourceProvider {
public:
    static Ref<DevServerSourceProvider> create(
        JSC::JSGlobalObject* globalObject,
        const String& source,
        const char* sourceMapJSONPtr,
        size_t sourceMapJSONLength,
        const JSC::SourceOrigin& sourceOrigin,
        String&& sourceURL,
        const TextPosition& startPosition,
        JSC::SourceProviderSourceType sourceType)
    {
        auto provider = adoptRef(*new DevServerSourceProvider(source, sourceMapJSONPtr, sourceMapJSONLength, sourceOrigin, WTFMove(sourceURL), startPosition, sourceType));
        auto* zigGlobalObject = jsCast<::Zig::GlobalObject*>(globalObject);
        auto specifier = Bun::toString(provider->sourceURL());
        Bun__addDevServerSourceProvider(zigGlobalObject->bunVM(), provider.ptr(), &specifier);
        return provider;
    }

    SourceMapData sourceMapJSON() const
    {
        return SourceMapData { m_sourceMapJSON.ptr(), m_sourceMapJSON.length() };
    }

private:
    DevServerSourceProvider(
        const String& source,
        const char* sourceMapJSONPtr,
        size_t sourceMapJSONLength,
        const JSC::SourceOrigin& sourceOrigin,
        String&& sourceURL,
        const TextPosition& startPosition,
        JSC::SourceProviderSourceType sourceType)
        : StringSourceProvider(
              source,
              sourceOrigin,
              JSC::SourceTaintedOrigin::Untainted,
              WTFMove(sourceURL),
              startPosition,
              sourceType)
        , m_sourceMapJSON(sourceMapJSONPtr, sourceMapJSONLength)
    {
    }

    SourceMapJSONString m_sourceMapJSON;
};

} // namespace Bake
