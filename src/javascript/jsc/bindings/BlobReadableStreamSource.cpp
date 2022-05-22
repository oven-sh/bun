#include "BlobReadableStreamSource.h"
#include "ReadableStream.h"
#include "JavaScriptCore/JSCInlines.h"

extern "C" void BlobStore__ref(void*);
extern "C" void BlobStore__deref(void*);

extern "C" bool BlobStore__requestRead(void* store, void* streamer, WeakPtr<WebCore::BlobReadableStreamSource> ctx, size_t offset, size_t size);
extern "C" bool BlobStore__requestStart(void* store, void** streamer, WeakPtr<WebCore::BlobReadableStreamSource> ctx, size_t offset, size_t size);
extern "C" bool BlobReadableStreamSource_isCancelled(WeakPtr<WebCore::BlobReadableStreamSource> source)
{
    if (source)
        return source->isCancelled();

    return true;
}
extern "C" void BlobStore__onClose(RefPtr<WebCore::BlobReadableStreamSource> source)
{
    if (!source)
        return;
    source->close();
}
extern "C" void BlobStore__onError(RefPtr<WebCore::BlobReadableStreamSource> source, const SystemError* error, Zig::GlobalObject* globalObject)
{
    if (!source || source->isCancelled())
        return;

    source->error(JSC::JSValue::decode(SystemError__toErrorInstance(error, globalObject)));
}
extern "C" bool BlobStore__onRead(RefPtr<WebCore::BlobReadableStreamSource> source, const uint8_t* ptr, size_t read)
{
    if (!source)
        return false;

    auto result = source->enqueue(ptr, read);
    source->deref();
    return result;
}

extern "C" bool BlobStore__onReadExternal(RefPtr<WebCore::BlobReadableStreamSource> source, uint8_t* ptr, size_t read, void* ctx, JSTypedArrayBytesDeallocator bytesDeallocator)
{
    if (!source) {
        bytesDeallocator(ctx, ptr);
        return false;
    }

    auto result = source->enqueue(ptr, read, ctx, bytesDeallocator);
    source->deref();
    return result;
}

extern "C" JSC__JSValue ReadableStream__empty(Zig::GlobalObject* globalObject)
{
    auto source = WebCore::SimpleReadableStreamSource::create();
    auto result = WebCore::ReadableStream::create(*globalObject, WTFMove(source));
    if (UNLIKELY(result.hasException())) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        result.releaseException();
        return JSC::JSValue::encode(JSC::jsUndefined());
    }
    source->close();
    return JSC::JSValue::encode(WebCore::toJSNewlyCreated(globalObject, globalObject, result.releaseReturnValue()));
}

extern "C" JSC__JSValue ReadableStream__fromBlob(Zig::GlobalObject* globalObject, void* store, size_t offset, size_t size)
{
    auto source = WebCore::BlobReadableStreamSource::create(store, offset, size);

    auto result = WebCore::ReadableStream::create(*globalObject, WTFMove(source));
    if (UNLIKELY(result.hasException())) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        result.releaseException();
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    return JSC::JSValue::encode(WebCore::toJSNewlyCreated(globalObject, globalObject, result.releaseReturnValue()));
}

namespace WebCore {

Ref<BlobReadableStreamSource> BlobReadableStreamSource::create(void* store, size_t offset, size_t size)
{
    return adoptRef(*new BlobReadableStreamSource(store, offset, size));
}

void BlobReadableStreamSource::doStart()
{
    RefPtr<BlobReadableStreamSource> weakThis = this;
    weakThis->ref();

    if (!BlobStore__requestStart(m_store, &m_streamer, weakThis, m_offset, m_size > m_offset ? m_size - m_offset : 0)) {
        if (m_promise) {
            close();
        }
        return;
    }

    JSC::gcProtect(&this->controller().jsController());
}
void BlobReadableStreamSource::doPull()
{
    RefPtr<BlobReadableStreamSource> weakThis = this;
    weakThis->ref();
    if (!BlobStore__requestRead(m_store, m_streamer, weakThis, m_offset, m_size > m_offset ? m_size - m_offset : 0)) {
        close();

        return;
    }

    JSC::gcProtect(&this->controller().jsController());
}

void BlobReadableStreamSource::doCancel()
{
    m_isCancelled = true;
}

void BlobReadableStreamSource::close()
{
    if (!m_isCancelled)
        controller().close();

    JSC::gcUnprotect(&this->controller().jsController());
}

void BlobReadableStreamSource::enqueue(JSC::JSValue value)
{
    if (!m_isCancelled)
        controller().enqueue(value);

    JSC::gcUnprotect(&this->controller().jsController());
}

bool BlobReadableStreamSource::enqueue(const uint8_t* ptr, size_t size)
{

    if (m_isCancelled)
        return false;

    JSC::gcUnprotect(&this->controller().jsController());
    auto arrayBuffer = JSC::ArrayBuffer::tryCreate(ptr, size);
    if (!arrayBuffer)
        return false;
    controller().enqueue(WTFMove(arrayBuffer));
    this->m_offset += size;
    return true;
}

bool BlobReadableStreamSource::enqueue(uint8_t* ptr, size_t read, void* ctx, JSTypedArrayBytesDeallocator bytesDeallocator)
{

    if (m_isCancelled) {
        bytesDeallocator(ctx, ptr);
        return false;
    }

    JSC::gcUnprotect(&this->controller().jsController());

    auto buffer = ArrayBuffer::createFromBytes(ptr, read, createSharedTask<void(void*)>([bytesDeallocator, ctx](void* p) {
        if (bytesDeallocator) {
            bytesDeallocator(p, ctx);
        }
    }));

    controller().enqueue(WTFMove(buffer));
    this->m_offset += read;
    return true;
}

BlobReadableStreamSource::~BlobReadableStreamSource()
{
    if (m_store)
        BlobStore__deref(m_store);
}
}
