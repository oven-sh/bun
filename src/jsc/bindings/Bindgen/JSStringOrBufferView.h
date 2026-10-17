#pragma once
#include "root.h"
#include "Bindgen/JSStringUTF8View.h"

namespace Bun::Bindgen {

// The bytes of an argument of a host call that is a string, a BufferSource or a Blob, where they are. Nothing changes
// them while no JavaScript runs, but another thread that writes a shared buffer.
class JSStringOrBufferView {
    WTF_FORBID_HEAP_ALLOCATION;
    WTF_MAKE_NONCOPYABLE(JSStringOrBufferView);
    WTF_MAKE_NONMOVABLE(JSStringOrBufferView);

public:
    // Not `= default`: see JSStringUTF8View.
    JSStringOrBufferView() {}

    void initialize(JSC::JSGlobalObject& globalObject, JSC::JSString* string)
    {
        m_string.initialize(globalObject, string);
    }

    // The argument is a BufferSource or a Blob, for `read`.
    void initializeAsBuffer()
    {
        ASSERT(!m_isBuffer);
        m_isBuffer = true;
    }

    // Converting a later argument can run JavaScript, so this comes after all of them.
    ALWAYS_INLINE void read(JSC::JSValue argument)
    {
        if (m_isBuffer)
            readBuffer(argument);
    }

    std::span<const uint8_t> bytes() const LIFETIME_BOUND
    {
        return m_isBuffer ? m_buffer : m_string.bytes();
    }

private:
    void readBuffer(JSC::JSValue);

    JSStringUTF8View m_string;
    std::span<const uint8_t> m_buffer;
    bool m_isBuffer { false };
};

// False for anything else. Throws for a Blob whose bytes are not in memory: a file.
bool isInMemoryBlob(JSC::JSGlobalObject&, JSC::JSValue);

}
