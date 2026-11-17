#pragma once

#include "root.h"
#include <JavaScriptCore/ArrayBuffer.h>

namespace Bun {

// Script can't detach the buffer while this lives: a transfer copies, so no other thread gets these bytes.
// For bytes that only have to stay allocated, use beginBorrow(), as PinnedArrayBuffer in array_buffer.rs does.
class PinnedArrayBuffer {
    WTF_MAKE_NONCOPYABLE(PinnedArrayBuffer);

public:
    explicit PinnedArrayBuffer(RefPtr<JSC::ArrayBuffer>&& buffer)
        : m_buffer(WTF::move(buffer))
    {
        if (m_buffer)
            m_buffer->pin();
    }
    ~PinnedArrayBuffer()
    {
        if (m_buffer)
            m_buffer->unpin();
    }

    explicit operator bool() const { return !!m_buffer; }

private:
    RefPtr<JSC::ArrayBuffer> m_buffer;
};

} // namespace Bun
