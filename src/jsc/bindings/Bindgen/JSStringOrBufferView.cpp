#include "root.h"
#include "Bindgen/JSStringOrBufferView.h"
#include "ErrorCode.h"
#include "ZigGeneratedClasses.h"
#include "blob.h"
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayBufferView.h>

namespace Bun::Bindgen {
using namespace JSC;

bool isInMemoryBlob(JSGlobalObject& globalObject, JSValue value)
{
    if (!value.inherits<WebCore::JSBlob>())
        return false;
    const uint8_t* data = nullptr;
    size_t length = 0;
    if (!WebCore::Blob__sharedView(JSValue::encode(value), &data, &length)) {
        auto scope = DECLARE_THROW_SCOPE(getVM(&globalObject));
        Bun::throwError(&globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "File blob cannot be used here"_s);
        return false;
    }
    return true;
}

void JSStringOrBufferView::readBuffer(JSValue argument)
{
    if (auto* view = dynamicDowncast<JSArrayBufferView>(argument)) {
        m_buffer = view->span();
    } else if (auto* buffer = dynamicDowncast<JSArrayBuffer>(argument)) {
        m_buffer = buffer->impl()->span();
    } else {
        const uint8_t* data = nullptr;
        size_t length = 0;
        WebCore::Blob__sharedView(JSValue::encode(argument), &data, &length);
        m_buffer = { data, length };
    }
    // A Rust slice has no null data.
    if (!m_buffer.data())
        m_buffer = byteCast<uint8_t>(WTF::nonNullEmptyUTF8Span());
}

}
