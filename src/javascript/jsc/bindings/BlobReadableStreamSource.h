#pragma once

#include "root.h"
#include "ReadableStreamSource.h"
#include <wtf/WeakPtr.h>

namespace WebCore {

class BlobReadableStreamSource
    : public ReadableStreamSource,
      public CanMakeWeakPtr<BlobReadableStreamSource> {
public:
    static Ref<BlobReadableStreamSource> create(void* store, size_t offset, size_t size);

    void close();
    void enqueue(JSC::JSValue);
    bool enqueue(const uint8_t* ptr, size_t length);
    bool enqueue(uint8_t* ptr, size_t read, void* deallocator, JSTypedArrayBytesDeallocator bytesDeallocator);
    bool isCancelled() const { return m_isCancelled; }

    void* streamer() const { return m_streamer; }

private:
    BlobReadableStreamSource(void* store, size_t offset, size_t size)
        : ReadableStreamSource()
        , m_store(store)
        , m_offset(offset)
        , m_size(size)
        , m_isCancelled(false)
    {
    }
    ~BlobReadableStreamSource();

    // ReadableStreamSource
    void setActive() final
    {
    }
    void setInactive() final {}
    void doStart() final;
    void doPull() final;
    void doCancel() final;

    bool m_isCancelled { false };

    uint64_t m_size = 0;
    uint64_t m_offset = 0;
    void* m_store = nullptr;
    void* m_streamer = nullptr;
};

}
