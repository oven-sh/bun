#include "config.h"
#include "FileReaderLoader.h"

#include "FileReaderLoaderClient.h"
#include "HTTPParsers.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMPromise.h"
#include "ScriptExecutionContext.h"
#include "blob.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <wtf/text/Base64.h>
#include <wtf/text/MakeString.h>

// `Blob.prototype.arrayBuffer` and `type` themselves, which script cannot replace. The frame only shows that script is calling.
extern "C" SYSV_ABI JSC::EncodedJSValue BlobPrototype__getArrayBuffer(void* blob, JSC::JSGlobalObject*, JSC::CallFrame*);
extern "C" SYSV_ABI JSC::EncodedJSValue BlobPrototype__getType(void* blob, JSC::JSGlobalObject*);

// Bun's TextDecoder without its wrapper. For UTF-8 that is not fatal there is no decoder: the caller decodes.
extern "C" void* TextDecoder__createForStream(JSC::JSGlobalObject*, JSC::EncodedJSValue label, bool fatal, bool ignoreBOM, bool* isUTF8, uint8_t* encoding);
extern "C" JSC::EncodedJSValue TextDecoder__decodeForStream(void* decoder, JSC::JSGlobalObject*, const uint8_t* input, size_t length, bool stream);
extern "C" void TextDecoder__destroyForStream(void* decoder);

namespace WebCore {

using namespace JSC;

Ref<FileReaderLoader> FileReaderLoader::create(ReadType readType, FileReaderLoaderClient* client)
{
    return adoptRef(*new FileReaderLoader(readType, client));
}

FileReaderLoader::FileReaderLoader(ReadType readType, FileReaderLoaderClient* client)
    : m_readType(readType)
    , m_client(client)
{
}

FileReaderLoader::~FileReaderLoader() = default;

void FileReaderLoader::start(ScriptExecutionContext* context, Blob& blob)
{
    auto* globalObject = uncheckedDowncast<JSDOMGlobalObject>(context->globalObject());
    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    RefPtr client = m_client.get();
    client->didStartLoading();

    auto type = JSValue::decode(BlobPrototype__getType(blob.impl(), globalObject));
    if (!scope.exception())
        m_dataType = type.getString(globalObject);
    auto* promise = scope.exception() ? nullptr : dynamicDowncast<JSPromise>(JSValue::decode(BlobPrototype__getArrayBuffer(blob.impl(), globalObject, vm.topCallFrame)));
    if (scope.exception() || !promise) {
        (void)scope.tryClearException();
        failed(ExceptionCode::NotReadableError);
        return;
    }

    // The bytes of a blob in memory are there in the next microtask. They arrive in a task, after the one that fires `loadstart`.
    DOMPromise::whenPromiseIsSettled(globalObject, promise, [protectedThis = Ref { *this }, context = Ref { *context }, promise = DOMPromise::create(*globalObject, *promise)]() mutable {
        context->postTask([protectedThis = WTF::move(protectedThis), promise = WTF::move(promise)](ScriptExecutionContext&) {
            if (auto* globalObject = promise->globalObject())
                protectedThis->didSettle(*globalObject, *promise->promise());
        });
    });
    (void)scope.tryClearException();
}

void FileReaderLoader::cancel()
{
    m_client = nullptr;
    m_rawData = nullptr;
    m_stringResult = String();
    m_bytesLoaded = 0;
}

void FileReaderLoader::didSettle(JSGlobalObject& globalObject, JSPromise& promise)
{
    RefPtr client = m_client.get();
    if (!client)
        return;

    auto& vm = globalObject.vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    auto* buffer = promise.status() == JSPromise::Status::Fulfilled ? dynamicDowncast<JSArrayBuffer>(promise.result()) : nullptr;
    if (!buffer) {
        auto* error = promise.result().getObject();
        auto code = error ? error->get(&globalObject, Identifier::fromString(vm, "code"_s)) : jsUndefined();
        bool isMissingFile = !scope.exception() && code.isString() && code.getString(&globalObject) == "ENOENT"_s;
        (void)scope.tryClearException();
        failed(isMissingFile ? ExceptionCode::NotFoundError : ExceptionCode::NotReadableError);
        return;
    }

    m_rawData = buffer->impl();
    m_bytesLoaded = m_rawData->byteLength();
    switch (m_readType) {
    case ReadAsArrayBuffer:
        break;
    case ReadAsBinaryString:
        m_stringResult = byteCast<Latin1Character>(m_rawData->span());
        break;
    case ReadAsText:
        m_stringResult = convertToText(globalObject);
        break;
    case ReadAsDataURL:
        m_stringResult = convertToDataURL();
        break;
    }
    if (m_readType != ReadAsArrayBuffer) {
        m_rawData = nullptr;
        if (m_stringResult.isNull())
            m_stringResult = emptyString();
    }

    client->didReceiveData();
    client->didFinishLoading();
}

void FileReaderLoader::failed(ExceptionCode errorCode)
{
    if (RefPtr client = m_client.get())
        client->didFail(errorCode);
}

RefPtr<ArrayBuffer> FileReaderLoader::arrayBufferResult() const
{
    return m_rawData;
}

// https://encoding.spec.whatwg.org/#bom-sniff
static ASCIILiteral encodingOfByteOrderMark(std::span<const uint8_t> bytes)
{
    if (bytes.size() >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
        return "utf-8"_s;
    if (bytes.size() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF)
        return "utf-16be"_s;
    if (bytes.size() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE)
        return "utf-16le"_s;
    return { };
}

// https://w3c.github.io/FileAPI/#blob-package-data: the encoding is the argument if that is a label, else the charset of the
// blob's type if that is one, else UTF-8. Then "decode", where a byte order mark wins over all three.
String FileReaderLoader::convertToText(JSGlobalObject& globalObject) const
{
    auto& vm = globalObject.vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto bytes = m_rawData->span();

    auto byteOrderMarkEncoding = encodingOfByteOrderMark(bytes);
    std::array<String, 3> labels { String { byteOrderMarkEncoding }, m_encoding, extractCharsetFromMediaType(m_dataType).toString() };
    for (auto& label : labels) {
        if (label.isEmpty())
            continue;
        bool isUTF8 = false;
        uint8_t encoding = 0;
        void* decoder = TextDecoder__createForStream(&globalObject, JSValue::encode(jsString(vm, label)), false, false, &isUTF8, &encoding);
        if (isUTF8)
            break;
        if (!decoder) {
            (void)scope.tryClearException();
            continue;
        }
        auto decoded = JSValue::decode(TextDecoder__decodeForStream(decoder, &globalObject, bytes.data(), bytes.size(), false));
        TextDecoder__destroyForStream(decoder);
        auto text = scope.exception() ? emptyString() : decoded.getString(&globalObject);
        (void)scope.tryClearException();
        return text;
    }

    if (byteOrderMarkEncoding == "utf-8"_s)
        bytes = bytes.subspan(3);
    return String::fromUTF8ReplacingInvalidSequences(byteCast<char8_t>(bytes));
}

String FileReaderLoader::convertToDataURL() const
{
    return makeString("data:"_s, m_dataType.isEmpty() ? "application/octet-stream"_s : m_dataType, ";base64,"_s, base64Encoded(m_rawData->span()));
}

} // namespace WebCore
