#pragma once

#include "ExceptionCode.h"
#include <wtf/RefCounted.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/WTFString.h>

namespace JSC {
class ArrayBuffer;
class JSGlobalObject;
class JSPromise;
}

namespace WebCore {

class Blob;
class FileReaderLoaderClient;
class ScriptExecutionContext;

// Upstream's class of this name loads the blob's URL through the network stack. This one asks Bun's Blob for its bytes.
class FileReaderLoader final : public RefCounted<FileReaderLoader> {
public:
    enum ReadType {
        ReadAsArrayBuffer,
        ReadAsBinaryString,
        ReadAsText,
        ReadAsDataURL,
    };

    static Ref<FileReaderLoader> create(ReadType, FileReaderLoaderClient*);
    ~FileReaderLoader();

    void start(ScriptExecutionContext*, Blob&);
    void cancel();

    String stringResult() const { return m_stringResult; }
    RefPtr<JSC::ArrayBuffer> arrayBufferResult() const;
    size_t bytesLoaded() const { return m_bytesLoaded; }
    size_t totalBytes() const { return m_bytesLoaded; }

    void setEncoding(const String& encoding) { m_encoding = encoding; }

private:
    FileReaderLoader(ReadType, FileReaderLoaderClient*);

    void didSettle(JSC::JSGlobalObject&, JSC::JSPromise&);
    void failed(ExceptionCode);
    String convertToText(JSC::JSGlobalObject&) const;
    String convertToDataURL() const;

    ReadType m_readType;
    WeakPtr<FileReaderLoaderClient> m_client;
    String m_encoding;
    String m_dataType;
    RefPtr<JSC::ArrayBuffer> m_rawData;
    String m_stringResult;
    size_t m_bytesLoaded { 0 };
};

} // namespace WebCore
