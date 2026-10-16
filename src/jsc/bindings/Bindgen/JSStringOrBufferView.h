#pragma once
#include "root.h"
#include "Bindgen/JSStringUTF8View.h"
#include <wtf/Vector.h>

namespace Bun::Bindgen {

// A buffer that another thread can write is always copied. So is every buffer where the Rust body can run JavaScript, which can write, detach or resize one.
enum class CopyBuffers : bool {
    IfShared,
    Always,
};

// The bytes of an argument of a host call that is a string, a BufferSource or a Blob. Nothing changes them during the call.
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
    void initializeAsBuffer() { m_isBuffer = true; }

    // Converting a later argument can run JavaScript, so this comes after all of them. Copying can throw.
    template<CopyBuffers copyBuffers>
    ALWAYS_INLINE void read(JSC::JSGlobalObject& globalObject, JSC::JSValue argument)
    {
        if (m_isBuffer)
            readBuffer(globalObject, argument, copyBuffers);
    }

    std::span<const uint8_t> bytes() const LIFETIME_BOUND
    {
        return m_isBuffer ? m_buffer : m_string.bytes();
    }

private:
    void readBuffer(JSC::JSGlobalObject&, JSC::JSValue, CopyBuffers);

    JSStringUTF8View m_string;
    std::span<const uint8_t> m_buffer;
    WTF::Vector<uint8_t> m_copy;
    bool m_isBuffer { false };
};

// False for anything else. Throws for a Blob whose bytes are in a file.
bool isInMemoryBlob(JSC::JSGlobalObject&, JSC::JSValue);

}
