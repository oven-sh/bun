#pragma once
#include "root.h"
#include "Bindgen/JSStringUTF8View.h"
#include <wtf/MallocSpan.h>
#include <wtf/text/WTFString.h>

namespace Bun::Bindgen {

// The bytes of a BufferSource or of a Blob whose bytes are in memory, where they are now. The data is not null.
std::span<const uint8_t> bytesOfBlobOrBuffer(JSC::JSValue);

// Whether it is a Blob. Throws for one whose bytes are not in memory: a file.
bool checkInMemoryBlob(JSC::JSGlobalObject&, JSC::JSValue);

// The UTF-8 of a string, or the bytes of a Blob or a buffer where they are, which only JavaScript and a thread that writes a shared buffer change.
class JSBytesView {
    WTF_FORBID_HEAP_ALLOCATION;
    WTF_MAKE_NONCOPYABLE(JSBytesView);
    WTF_MAKE_NONMOVABLE(JSBytesView);

public:
    // Not `= default`: see JSStringUTF8View.
    JSBytesView() {}

    void initialize(JSC::JSGlobalObject& globalObject, JSC::JSString* string)
    {
        m_string.initialize(globalObject, string);
    }

    void initializeAsBlobOrBuffer()
    {
        ASSERT(!m_isBlobOrBuffer);
        m_isBlobOrBuffer = true;
    }

    // Converting a later argument can run JavaScript, so these two come after all of them.
    ALWAYS_INLINE void read(JSC::JSValue argument)
    {
        if (m_isBlobOrBuffer)
            m_bytes = bytesOfBlobOrBuffer(argument);
    }

    // The bytes of a shared buffer become those of `copy`. Allocating it can throw.
    void copyIfShared(JSC::JSGlobalObject&, JSC::JSValue argument, WTF::MallocSpan<uint8_t>& copy);

    // Null data for a Blob or a buffer that was neither read nor copied: Rust reads it, each time it borrows the bytes.
    std::span<const uint8_t> bytes() const LIFETIME_BOUND
    {
        return m_isBlobOrBuffer ? m_bytes : m_string.bytes();
    }

private:
    JSStringUTF8View m_string;
    std::span<const uint8_t> m_bytes;
    bool m_isBlobOrBuffer { false };
};

// The string, or null for a Blob or a buffer, which Rust reads, copies or pins from the argument itself.
class JSBlobOrStringOrBuffer {
    WTF_FORBID_HEAP_ALLOCATION;

public:
    // Resolving a rope can throw.
    void initialize(JSC::JSGlobalObject& globalObject, JSC::JSString* string)
    {
        m_string = string->value(&globalObject);
    }

    void initializeAsBlobOrBuffer() {}

    WTF::String takeString() { return std::exchange(m_string, {}); }

private:
    WTF::String m_string;
};

}
