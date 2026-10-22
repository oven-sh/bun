#pragma once
#include "root.h"
#include "Bindgen/JSStringUTF8View.h"
#include <wtf/MallocSpan.h>
#include <wtf/text/WTFString.h>

namespace Bun::Bindgen {

// Which buffers `shared: "copied"` copies: those that something else can write while the body reads them.
enum class CopiedBuffers : bool {
    // A SharedArrayBuffer, which another thread writes.
    Shared,
    // That, and a buffer over a file mapping (`Bun.mmap`), which another process writes. To JavaScript it is an ordinary
    // ArrayBuffer. `mapped: "borrowed"` leaves it out.
    SharedAndMapped,
};

// The bytes of a BufferSource or of a Blob whose bytes are in memory, where they are now. The data is not null.
std::span<const uint8_t> bytesOfBlobOrBuffer(JSC::JSValue);
// As above, and whether it is one of the buffers to copy.
template<CopiedBuffers> std::span<const uint8_t> bytesOfBlobOrBuffer(JSC::JSValue, bool& copied);

template<CopiedBuffers> bool isCopiedBuffer(JSC::JSValue);

// A copy of the bytes, which `copy` holds, or the bytes themselves if there are none. Allocating it can throw.
std::span<const uint8_t> copyBytes(JSC::JSGlobalObject&, std::span<const uint8_t>, WTF::MallocSpan<uint8_t>& copy);

// Whether it holds a Blob: a Blob, or a `Bun.build()` output. Throws for one whose bytes are not in memory: a file.
bool checkInMemoryBlob(JSC::JSGlobalObject&, JSC::JSValue);

// The bytes of a Blob or a buffer where they are, which only JavaScript and what writes a shared or a mapped buffer change.
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

    // The bytes of a buffer that `Copied` names become those of `copy`. Whether it is one: copying can throw.
    // A buffer longer than `longest` stays where it is: the body refuses it by its length, and reads none of it.
    template<CopiedBuffers Copied>
    ALWAYS_INLINE bool copyIf(JSC::JSGlobalObject& globalObject, JSC::JSValue argument, WTF::MallocSpan<uint8_t>& copy, size_t longest = std::numeric_limits<size_t>::max())
    {
        if (!m_isBlobOrBuffer || !isCopiedBuffer<Copied>(argument)) [[likely]]
            return false;
        auto bytes = bytesOfBlobOrBuffer(argument);
        if (bytes.size() > longest) [[unlikely]]
            return false;
        m_bytes = copyBytes(globalObject, bytes, copy);
        return true;
    }

    // `read` and `copyIf` in one look at the buffer.
    template<CopiedBuffers Copied>
    ALWAYS_INLINE bool readCopying(JSC::JSGlobalObject& globalObject, JSC::JSValue argument, WTF::MallocSpan<uint8_t>& copy, size_t longest = std::numeric_limits<size_t>::max())
    {
        if (!m_isBlobOrBuffer)
            return false;
        bool copied = false;
        m_bytes = bytesOfBlobOrBuffer<Copied>(argument, copied);
        if (!copied || m_bytes.size() > longest) [[likely]]
            return false;
        m_bytes = copyBytes(globalObject, m_bytes, copy);
        return true;
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

    void initialize(JSC::JSGlobalObject& globalObject, JSC::JSString* string)
    {
        m_string.initialize(globalObject, string);
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
