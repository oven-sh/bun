#pragma once
#include "root.h"
#include "Bindgen/JSStringUTF8View.h"
#include <wtf/MallocSpan.h>
#include <wtf/text/WTFString.h>

namespace Bun::Bindgen {

// The bytes of a BufferSource or of a Blob whose bytes are in memory, where they are now. The data is not null.
std::span<const uint8_t> bytesOfBuffer(JSC::JSValue);

// False for anything else. Throws for a Blob whose bytes are not in memory: a file.
bool isInMemoryBlob(JSC::JSGlobalObject&, JSC::JSValue);

// An argument of a host call that is `b.bytes`, borrowed: the UTF-8 of a string, or the bytes of a BufferSource or a
// Blob, where they are. Nothing changes them while no JavaScript runs, but another thread that writes a shared buffer.
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

    // The argument is a BufferSource or a Blob.
    void initializeAsBuffer()
    {
        ASSERT(!m_isBuffer);
        m_isBuffer = true;
    }

    // Converting a later argument can run JavaScript, so these two come after all of them.
    ALWAYS_INLINE void read(JSC::JSValue argument)
    {
        if (m_isBuffer)
            m_buffer = bytesOfBuffer(argument);
    }

    // The bytes of a shared buffer become those of `copy`. Allocating it can throw.
    void copyIfShared(JSC::JSGlobalObject&, JSC::JSValue argument, WTF::MallocSpan<uint8_t>& copy);

    // Null data for a buffer that was neither read nor copied: Rust reads it, each time it borrows the bytes.
    std::span<const uint8_t> bytes() const LIFETIME_BOUND
    {
        return m_isBuffer ? m_buffer : m_string.bytes();
    }

private:
    JSStringUTF8View m_string;
    std::span<const uint8_t> m_buffer;
    bool m_isBuffer { false };
};

// An argument that is `b.bytes`, for Rust to copy, to pin, or to read a string of as it is: the string, or null for a
// BufferSource or a Blob, which is the argument itself.
class JSStringOrBuffer {
    WTF_FORBID_HEAP_ALLOCATION;

public:
    // Resolving a rope can throw.
    void initialize(JSC::JSGlobalObject& globalObject, JSC::JSString* string)
    {
        m_string = string->value(&globalObject);
        if (m_string.isNull())
            m_string = emptyString();
    }

    void initializeAsBuffer() {}

    WTF::String takeString() { return std::exchange(m_string, {}); }

private:
    WTF::String m_string;
};

}
