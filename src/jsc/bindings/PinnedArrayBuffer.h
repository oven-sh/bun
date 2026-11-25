#pragma once

#include "root.h"
#include <JavaScriptCore/ArrayBuffer.h>

namespace Bun {

// Script can't detach the buffer while this lives.
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
