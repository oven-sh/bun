#include "root.h"
#include "Bindgen/JSStringOrBufferView.h"
#include "ErrorCode.h"
#include "ZigGeneratedClasses.h"
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayBufferView.h>

// False for a Blob whose bytes are not in memory.
extern "C" bool Blob__getInMemoryBytes(void* blob, const uint8_t** data, size_t* length);

namespace Bun::Bindgen {
using namespace JSC;

bool isInMemoryBlob(JSGlobalObject& globalObject, JSValue value)
{
    auto* blob = dynamicDowncast<WebCore::JSBlob>(value);
    if (!blob)
        return false;
    const uint8_t* data = nullptr;
    size_t length = 0;
    if (!Blob__getInMemoryBytes(blob->wrapped(), &data, &length)) {
        auto scope = DECLARE_THROW_SCOPE(getVM(&globalObject));
        Bun::throwError(&globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "File blob cannot be used here"_s);
        return false;
    }
    return true;
}

void JSStringOrBufferView::readBuffer(JSGlobalObject& globalObject, JSValue argument)
{
    bool isShared = false;
    if (auto* view = dynamicDowncast<JSArrayBufferView>(argument)) {
        m_buffer = view->span();
        isShared = view->isShared();
    } else if (auto* buffer = dynamicDowncast<JSArrayBuffer>(argument)) {
        m_buffer = buffer->impl()->span();
        isShared = buffer->isShared();
    } else {
        const uint8_t* data = nullptr;
        size_t length = 0;
        Blob__getInMemoryBytes(uncheckedDowncast<WebCore::JSBlob>(argument)->wrapped(), &data, &length);
        m_buffer = { data, length };
    }
    if (isShared) {
        if (!m_copy.tryAppend(m_buffer)) [[unlikely]] {
            auto scope = DECLARE_THROW_SCOPE(getVM(&globalObject));
            throwOutOfMemoryError(&globalObject, scope);
            return;
        }
        m_buffer = m_copy.span();
    }
    // A Rust slice has no null data.
    if (!m_buffer.data())
        m_buffer = byteCast<uint8_t>(WTF::nonNullEmptyUTF8Span());
}

}
