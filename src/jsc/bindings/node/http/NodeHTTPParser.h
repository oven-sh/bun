#pragma once

#include "root.h"
#include "llhttp/llhttp.h"
#include "ProcessBindingHTTPParser.h"
#include "JSConnectionsList.h"

namespace Bun {

class JSHTTPParser;

// helper class for the Parser
struct StringPtr {
    StringPtr()
    {
        m_onHeap = false;
        reset();
    }

    ~StringPtr()
    {
        reset();
    }

    // If str_ does not point to a heap string yet, this function makes it do
    // so. This is called at the end of each http_parser_execute() so as not
    // to leak references. See issue #2438 and test-http-parser-bad-ref.js.
    void save()
    {
        if (!m_onHeap && m_size > 0) {
            char* s = new char[m_size];
            memcpy(s, m_str, m_size);
            m_str = s;
            m_onHeap = true;
        }
    }

    void reset()
    {
        if (m_onHeap) {
            delete[] m_str;
            m_onHeap = false;
        }

        m_str = nullptr;
        m_size = 0;
    }

    void update(const char* str, size_t size)
    {
        if (m_str == nullptr) {
            m_str = str;
        } else if (m_onHeap || m_str + m_size != str) {
            // Non-consecutive input, make a copy on the heap.
            // TODO(bnoordhuis) Use slab allocation, O(n) allocs is bad.
            char* s = new char[m_size + size];
            memcpy(s, m_str, m_size);
            memcpy(s + m_size, str, size);

            if (m_onHeap)
                delete[] m_str;
            else
                m_onHeap = true;

            m_str = s;
        }
        m_size += size;
    }

    JSC::JSValue toString(JSC::JSGlobalObject* globalObject) const
    {
        auto& vm = globalObject->vm();
        if (m_size != 0) {
            return JSC::jsString(vm, WTF::String::fromUTF8({ m_str, m_size }));
        }
        return jsEmptyString(vm);
    }

    inline bool isOWS(char c)
    {
        return c == ' ' || c == '\t';
    }

    // Strip trailing OWS (SPC or HTAB) from string.
    JSC::JSValue toTrimmedString(JSC::JSGlobalObject* globalObject)
    {
        while (m_size > 0 && isOWS(m_str[m_size - 1])) {
            m_size--;
        }
        return toString(globalObject);
    }

    const char* m_str;
    bool m_onHeap;
    size_t m_size;
};

#define HTTP_BOTH 0
#define HTTP_REQUEST 1
#define HTTP_RESPONSE 2

const uint32_t kOnMessageBegin = 0;
const uint32_t kOnHeaders = 1;
const uint32_t kOnHeadersComplete = 2;
const uint32_t kOnBody = 3;
const uint32_t kOnMessageComplete = 4;
const uint32_t kOnExecute = 5;
const uint32_t kOnTimeout = 6;
// Any more fields than this will be flushed into JS
const size_t kMaxHeaderFieldsCount = 32;
// Maximum size of chunk extensions
const size_t kMaxChunkExtensionsSize = 16384;

const uint32_t kLenientNone = 0;
const uint32_t kLenientHeaders = 1 << 0;
const uint32_t kLenientChunkedLength = 1 << 1;
const uint32_t kLenientKeepAlive = 1 << 2;
const uint32_t kLenientTransferEncoding = 1 << 3;
const uint32_t kLenientVersion = 1 << 4;
const uint32_t kLenientDataAfterClose = 1 << 5;
const uint32_t kLenientOptionalLFAfterCR = 1 << 6;
const uint32_t kLenientOptionalCRLFAfterChunk = 1 << 7;
const uint32_t kLenientOptionalCRBeforeLF = 1 << 8;
const uint32_t kLenientSpacesAfterChunkSize = 1 << 9;
const uint32_t kLenientAll = kLenientHeaders | kLenientChunkedLength | kLenientKeepAlive | kLenientTransferEncoding | kLenientVersion | kLenientDataAfterClose | kLenientOptionalLFAfterCR | kLenientOptionalCRLFAfterChunk | kLenientOptionalCRBeforeLF | kLenientSpacesAfterChunkSize;

struct HTTPParser {

public:
    HTTPParser(JSC::JSGlobalObject* globalObject)
        : m_currentBufferData(nullptr)
        , m_currentBufferLen(0)
        , m_globalObject(globalObject)
    {
    }

    void init(llhttp_type_t type, uint64_t maxHttpHeaderSize, uint32_t lenientFlags);
    JSC::JSValue createHeaders(JSC::JSGlobalObject*);
    void save();

    JSC::JSValue remove(JSC::JSGlobalObject*, JSC::JSCell* thisParser);
    JSC::JSValue execute(JSC::JSGlobalObject*, const char* data, size_t len);
    JSC::JSValue initialize(JSC::JSGlobalObject*, JSC::JSCell* thisParser, llhttp_type_t type, uint64_t maxHttpHeaderSize, uint32_t lenientFlags, JSConnectionsList* connections);
    JSC::JSValue pause();
    JSC::JSValue resume();
    JSC::JSValue getCurrentBuffer(JSC::JSGlobalObject*) const;
    JSC::JSValue duration() const;

    bool lessThan(HTTPParser& other) const;

    // llhttp callbacks
    int onMessageBegin();
    int onUrl(const char* at, size_t length);
    int onStatus(const char* at, size_t length);
    int onHeaderField(const char* at, size_t length);
    int onHeaderValue(const char* at, size_t length);
    int onChunkExtensionName(const char* at, size_t length);
    int onChunkExtensionValue(const char* at, size_t length);
    int onHeadersComplete();
    int onBody(const char* at, size_t length);
    int onMessageComplete();
    int onChunkHeader();
    int onChunkComplete();

    int trackHeader(size_t len);
    void flush();

    inline bool headersCompleted() const { return m_headersCompleted; }
    inline uint64_t lastMessageStart() const { return m_lastMessageStart; }

    JSC::WriteBarrier<JSConnectionsList> m_connectionsList;

    // need these for llhttp callbacks unfortunately
    JSC::JSGlobalObject* m_globalObject;
    JSHTTPParser* m_thisParser = nullptr;

    llhttp_t m_parserData;
    StringPtr m_fields[kMaxHeaderFieldsCount];
    StringPtr m_values[kMaxHeaderFieldsCount];
    StringPtr m_url;
    StringPtr m_statusMessage;
    size_t m_numFields;
    size_t m_numValues;
    bool m_haveFlushed;

    // We don't use m_gotException. Instead, we use RETURN_IF_EXCEPTION
    // bool m_gotException;

    size_t m_currentBufferLen;
    const char* m_currentBufferData;
    bool m_headersCompleted = false;
    bool m_pendingPause = false;
    uint64_t m_headerNread = 0;
    uint64_t m_chunkExtensionsNread = 0;
    uint64_t m_maxHttpHeaderSize = 0;
    uint64_t m_lastMessageStart = 0;

private:
};

}; // namespace Bun
