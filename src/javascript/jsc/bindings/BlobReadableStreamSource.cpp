#include "BlobReadableStreamSource.h"
#include "ReadableStream.h"
#include "JavaScriptCore/JSCInlines.h"

extern "C" void BlobStore__ref(void*);
extern "C" void BlobStore__deref(void*);
extern "C" bool BlobStore__requestRead(void* store, WeakPtr<WebCore::BlobReadableStreamSource> ctx, size_t offset, size_t size);
extern "C" bool BlobStore__requestStart(void* store, WeakPtr<WebCore::BlobReadableStreamSource> ctx, size_t offset, size_t size);
extern "C" void BlobStore__onClose(WeakPtr<WebCore::BlobReadableStreamSource> source)
{
    if (!source)
        return;
    source->close();
}
extern "C" void BlobStore__onError(WeakPtr<WebCore::BlobReadableStreamSource> source, const SystemError* error, Zig::GlobalObject* globalObject)
{
    if (!source)
        return;
    source->cancel(JSC::JSValue::decode(SystemError__toErrorInstance(error, globalObject)));
}
extern "C" bool BlobStore__onRead(WeakPtr<WebCore::BlobReadableStreamSource> source, const uint8_t* ptr, size_t read)
{
    if (!source)
        return false;

    bool couldHaveMore = source->enqueue(ptr, read);
    return couldHaveMore;
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
    if (!BlobStore__requestStart(m_store, WeakPtr { *this }, m_offset, m_size > m_offset ? m_size - m_offset : 0)) {
        close();
        return;
    }
}
void BlobReadableStreamSource::doPull()
{

    if (!BlobStore__requestRead(m_store, WeakPtr { *this }, m_offset, m_size > m_offset ? m_size - m_offset : 0)) {
        close();

        return;
    }
}

void BlobReadableStreamSource::doCancel()
{
    m_isCancelled = true;
}

void BlobReadableStreamSource::close()
{
    if (!m_isCancelled)
        controller().close();
}

void BlobReadableStreamSource::enqueue(JSC::JSValue value)
{
    if (!m_isCancelled)
        controller().enqueue(value);
}

bool BlobReadableStreamSource::enqueue(const uint8_t* ptr, size_t size)
{
    if (m_isCancelled)
        return false;

    auto arrayBuffer = JSC::ArrayBuffer::tryCreate(ptr, size);
    if (!arrayBuffer)
        return false;
    controller().enqueue(WTFMove(arrayBuffer));
    this->m_offset += size;
    return true;
}

BlobReadableStreamSource::~BlobReadableStreamSource()
{
    BlobStore__deref(m_store);
    ReadableStreamSource::~ReadableStreamSource();
}
}
