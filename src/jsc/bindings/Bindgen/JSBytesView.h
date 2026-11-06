#pragma once
#include "root.h"
#include "Bindgen/JSStringUTF8View.h"
#include <wtf/MallocSpan.h>
#include <wtf/text/WTFString.h>

namespace Bun::Bindgen {

// The bytes of a BufferSource or of a Blob whose bytes are in memory, where they are now. The data is not null.
std::span<const uint8_t> bytesOfBlobOrBuffer(JSC::JSValue);
std::span<const uint8_t> bytesOfBlobOrBuffer(JSC::JSValue, bool& isShared);

bool isSharedBuffer(JSC::JSValue);

// Optional: ~MallocSpan calls free, of null too.
using BytesCopy = std::optional<WTF::MallocSpan<uint8_t>>;

// `bytes` become a copy of themselves, which `copy` holds, unless there are none. False if it threw: allocating can.
bool copyBytes(JSC::JSGlobalObject&, std::span<const uint8_t>& bytes, BytesCopy& copy);

// Whether it holds a Blob: a Blob, or a `Bun.build()` output. Throws for one whose bytes are not in memory: a file.
bool checkInMemoryBlob(JSC::JSGlobalObject&, JSC::JSValue);

// The bytes of a Blob or a buffer where they are, which only JavaScript and a thread that writes a shared buffer change.
class JSBlobOrBufferView {
    WTF_FORBID_HEAP_ALLOCATION;
    WTF_MAKE_NONCOPYABLE(JSBlobOrBufferView);
    WTF_MAKE_NONMOVABLE(JSBlobOrBufferView);

public:
    JSBlobOrBufferView() = default;

    void initializeAsBlobOrBuffer()
    {
        ASSERT(!m_isBlobOrBuffer);
        m_isBlobOrBuffer = true;
    }

    // Converting a later argument can run JavaScript, so these three come after all of them.
    ALWAYS_INLINE void read(JSC::JSValue argument)
    {
        if (m_isBlobOrBuffer)
            m_bytes = bytesOfBlobOrBuffer(argument);
    }

    // The bytes of a shared buffer become those of `copy`. False if it threw.
    ALWAYS_INLINE bool copyIfShared(JSC::JSGlobalObject& globalObject, JSC::JSValue argument, BytesCopy& copy)
    {
        if (!m_isBlobOrBuffer || !isSharedBuffer(argument)) [[likely]]
            return true;
        m_bytes = bytesOfBlobOrBuffer(argument);
        return copyBytes(globalObject, m_bytes, copy);
    }

    // `read` and `copyIfShared` in one look at the buffer.
    ALWAYS_INLINE bool readCopyingShared(JSC::JSGlobalObject& globalObject, JSC::JSValue argument, BytesCopy& copy)
    {
        if (!m_isBlobOrBuffer)
            return true;
        bool isShared = false;
        m_bytes = bytesOfBlobOrBuffer(argument, isShared);
        if (!isShared) [[likely]]
            return true;
        return copyBytes(globalObject, m_bytes, copy);
    }

    // Null data for a Blob or a buffer that was neither read nor copied: Rust reads it, each time it borrows the bytes.
    std::span<const uint8_t> bytes() const LIFETIME_BOUND { return m_bytes; }

protected:
    bool isBlobOrBuffer() const { return m_isBlobOrBuffer; }

private:
    std::span<const uint8_t> m_bytes;
    bool m_isBlobOrBuffer { false };
};

// The bytes of a Blob or a buffer, or the UTF-8 of a string.
class JSBytesView : public JSBlobOrBufferView {
public:
    // Not `= default`: see JSStringUTF8View.
    JSBytesView() {}

    bool initialize(JSC::JSGlobalObject& globalObject, JSC::JSString* string)
    {
        return m_string.initialize(globalObject, string);
    }

    std::span<const uint8_t> bytes() const LIFETIME_BOUND
    {
        return isBlobOrBuffer() ? JSBlobOrBufferView::bytes() : m_string.bytes();
    }

private:
    JSStringUTF8View m_string;
};

// The string, or null for a Blob or a buffer, which Rust reads, copies or pins from the argument itself.
class JSBlobOrStringOrBuffer {
    WTF_FORBID_HEAP_ALLOCATION;

public:
    // False if it threw, which resolving a rope can.
    bool initialize(JSC::JSGlobalObject& globalObject, JSC::JSString* string)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        m_string = string->value(&globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        return true;
    }

    void initializeAsBlobOrBuffer() {}

    WTF::String takeString() { return std::exchange(m_string, {}); }

private:
    WTF::String m_string;
};

}
