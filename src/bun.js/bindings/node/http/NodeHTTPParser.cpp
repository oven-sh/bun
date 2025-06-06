#include "NodeHTTPParser.h"
#include "BunBuiltinNames.h"
#include "helpers.h"
#include "JSConnectionsList.h"
#include "JSHTTPParser.h"
#include "ZigGlobalObject.h"
#include "uv.h"

namespace Bun {

using namespace JSC;
using namespace WebCore;

#define DEFINE_LLHTTP_CALLBACK(name)                                                                            \
    static int name(llhttp_t* data)                                                                             \
    {                                                                                                           \
        HTTPParser* parser = (HTTPParser*)(reinterpret_cast<char*>(data) - offsetof(HTTPParser, m_parserData)); \
        return parser->name();                                                                                  \
    }

#define DEFINE_LLHTTP_DATA_CALLBACK(name)                                                                       \
    static int name(llhttp_t* data, const char* at, size_t length)                                              \
    {                                                                                                           \
        HTTPParser* parser = (HTTPParser*)(reinterpret_cast<char*>(data) - offsetof(HTTPParser, m_parserData)); \
        return parser->name(at, length);                                                                        \
    }

DEFINE_LLHTTP_CALLBACK(onMessageBegin);
DEFINE_LLHTTP_DATA_CALLBACK(onUrl);
DEFINE_LLHTTP_DATA_CALLBACK(onStatus);
DEFINE_LLHTTP_DATA_CALLBACK(onHeaderField);
DEFINE_LLHTTP_DATA_CALLBACK(onHeaderValue);
DEFINE_LLHTTP_DATA_CALLBACK(onChunkExtensionName);
DEFINE_LLHTTP_DATA_CALLBACK(onChunkExtensionValue);
DEFINE_LLHTTP_CALLBACK(onHeadersComplete);
DEFINE_LLHTTP_DATA_CALLBACK(onBody);
DEFINE_LLHTTP_CALLBACK(onMessageComplete);
DEFINE_LLHTTP_CALLBACK(onChunkHeader);
DEFINE_LLHTTP_CALLBACK(onChunkComplete);

static const llhttp_settings_t llhttp_settings = {
    .on_message_begin = &onMessageBegin,
    .on_protocol = nullptr,
    .on_url = &onUrl,
    .on_status = &onStatus,
    .on_method = nullptr,
    .on_version = nullptr,
    .on_header_field = &onHeaderField,
    .on_header_value = &onHeaderValue,
    .on_chunk_extension_name = &onChunkExtensionName,
    .on_chunk_extension_value = &onChunkExtensionValue,
    .on_headers_complete = &onHeadersComplete,
    .on_body = &onBody,
    .on_message_complete = &onMessageComplete,
    .on_protocol_complete = nullptr,
    .on_url_complete = nullptr,
    .on_status_complete = nullptr,
    .on_method_complete = nullptr,
    .on_version_complete = nullptr,
    .on_header_field_complete = nullptr,
    .on_header_value_complete = nullptr,
    .on_chunk_extension_name_complete = nullptr,
    .on_chunk_extension_value_complete = nullptr,
    .on_chunk_header = &onChunkHeader,
    .on_chunk_complete = &onChunkComplete,
    .on_reset = nullptr,
};

void HTTPParser::init(llhttp_type_t type, uint64_t maxHttpHeaderSize, uint32_t lenientFlags)
{
    llhttp_init(&m_parserData, type, &llhttp_settings);

    if (lenientFlags & kLenientHeaders) {
        llhttp_set_lenient_headers(&m_parserData, 1);
    }
    if (lenientFlags & kLenientChunkedLength) {
        llhttp_set_lenient_chunked_length(&m_parserData, 1);
    }
    if (lenientFlags & kLenientKeepAlive) {
        llhttp_set_lenient_keep_alive(&m_parserData, 1);
    }
    if (lenientFlags & kLenientTransferEncoding) {
        llhttp_set_lenient_transfer_encoding(&m_parserData, 1);
    }
    if (lenientFlags & kLenientVersion) {
        llhttp_set_lenient_version(&m_parserData, 1);
    }
    if (lenientFlags & kLenientDataAfterClose) {
        llhttp_set_lenient_data_after_close(&m_parserData, 1);
    }
    if (lenientFlags & kLenientOptionalLFAfterCR) {
        llhttp_set_lenient_optional_lf_after_cr(&m_parserData, 1);
    }
    if (lenientFlags & kLenientOptionalCRLFAfterChunk) {
        llhttp_set_lenient_optional_crlf_after_chunk(&m_parserData, 1);
    }
    if (lenientFlags & kLenientOptionalCRBeforeLF) {
        llhttp_set_lenient_optional_cr_before_lf(&m_parserData, 1);
    }
    if (lenientFlags & kLenientSpacesAfterChunkSize) {
        llhttp_set_lenient_spaces_after_chunk_size(&m_parserData, 1);
    }

    m_headerNread = 0;
    m_url.reset();
    m_statusMessage.reset();
    m_numFields = 0;
    m_numValues = 0;
    m_haveFlushed = false;
    m_headersCompleted = false;
    m_maxHttpHeaderSize = maxHttpHeaderSize;
}

JSValue HTTPParser::execute(JSGlobalObject* globalObject, const char* data, size_t len)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    BunBuiltinNames builtinNames(vm);

    m_currentBufferLen = len;
    m_currentBufferData = data;

    llhttp_errno_t err;

    if (data == nullptr) {
        err = llhttp_finish(&m_parserData);
    } else {
        err = llhttp_execute(&m_parserData, data, len);
        save();
    }

    size_t nread = len;
    if (err != HPE_OK) {
        nread = llhttp_get_error_pos(&m_parserData) - data;

        if (err == HPE_PAUSED_UPGRADE) {
            err = HPE_OK;
            llhttp_resume_after_upgrade(&m_parserData);
        }
    }

    if (m_pendingPause) {
        m_pendingPause = false;
        llhttp_pause(&m_parserData);
    }

    m_currentBufferLen = 0;
    m_currentBufferData = nullptr;

    RETURN_IF_EXCEPTION(scope, {});

    JSValue nreadValue = jsNumber(nread);

    if (!m_parserData.upgrade && err != HPE_OK) {
        JSObject* error = createError(globalObject, "Parse Error"_s);
        error->putDirect(vm, Identifier::fromString(vm, "bytesParsed"_s), nreadValue);
        RETURN_IF_EXCEPTION(scope, {});

        const char* errorReason = llhttp_get_error_reason(&m_parserData);

        String codeString;
        String reasonString;
        if (err == HPE_USER) {
            const char* colon = strchr(errorReason, ':');
            ASSERT(colon);

            codeString = String::fromUTF8({ errorReason, static_cast<size_t>(colon - errorReason) });
            reasonString = String::fromUTF8(colon + 1);
        } else {
            codeString = String::fromUTF8(llhttp_errno_name(err));
            reasonString = String::fromUTF8(errorReason);
        }

        error->putDirect(vm, builtinNames.codePublicName(), jsString(vm, codeString));
        RETURN_IF_EXCEPTION(scope, {});
        error->putDirect(vm, Identifier::fromString(vm, "reason"_s), jsString(vm, reasonString));
        RETURN_IF_EXCEPTION(scope, {});

        return error;
    }

    if (data == nullptr) {
        return {};
    }

    return nreadValue;
}

JSValue HTTPParser::createHeaders(JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSArray* headers = constructEmptyArray(globalObject, nullptr, m_numValues * 2);
    RETURN_IF_EXCEPTION(scope, {});

    for (size_t i = 0; i < m_numValues; ++i) {
        headers->putDirectIndex(globalObject, i * 2, m_fields[i].toString(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        headers->putDirectIndex(globalObject, i * 2 + 1, m_values[i].toTrimmedString(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    return headers;
}

void HTTPParser::save()
{
    m_url.save();
    m_statusMessage.save();

    for (size_t i = 0; i < m_numFields; ++i) {
        m_fields[i].save();
    }

    for (size_t i = 0; i < m_numValues; ++i) {
        m_values[i].save();
    }
}

JSValue HTTPParser::remove(JSGlobalObject* globalObject, JSCell* thisParser)
{

    if (JSConnectionsList* connections = m_connectionsList.get()) {
        connections->pop(globalObject, thisParser);
        connections->popActive(globalObject, thisParser);
    }

    return jsUndefined();
}

JSValue HTTPParser::initialize(JSGlobalObject* globalObject, JSCell* thisParser, llhttp_type_t type, uint64_t maxHttpHeaderSize, uint32_t lenientFlags, JSConnectionsList* connections)
{
    auto& vm = globalObject->vm();

    init(type, maxHttpHeaderSize, lenientFlags);

    if (connections) {
        m_connectionsList.set(vm, thisParser, connections);

        // This protects from a DoS attack where an attacker establishes
        // the connection without sending any data on applications where
        // server.timeout is left to the default value of zero.
        m_lastMessageStart = uv_hrtime();

        // Important: Push into the lists AFTER setting the last_message_start_
        // otherwise std::set.erase will fail later.
        connections->push(globalObject, thisParser);
        connections->pushActive(globalObject, thisParser);
    } else {
        m_connectionsList.clear();
    }

    return jsUndefined();
}

JSValue HTTPParser::pause()
{
    llhttp_pause(&m_parserData);
    return jsUndefined();
}

JSValue HTTPParser::resume()
{
    llhttp_resume(&m_parserData);
    return jsUndefined();
}

JSValue HTTPParser::getCurrentBuffer(JSGlobalObject* lexicalGlobalObject) const
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    JSUint8Array* buffer = JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), m_currentBufferLen);
    RETURN_IF_EXCEPTION(scope, {});

    memcpy(buffer->vector(), m_currentBufferData, m_currentBufferLen);

    return buffer;
}

JSValue HTTPParser::duration() const
{
    if (m_lastMessageStart == 0) {
        return jsNumber(0);
    }

    double duration = (uv_hrtime() - m_lastMessageStart) / 1e6;

    return jsNumber(duration);
}

bool HTTPParser::lessThan(HTTPParser& other) const
{
    if (m_lastMessageStart == 0 && other.m_lastMessageStart == 0) {
        return this < &other;
    } else if (m_lastMessageStart == 0) {
        return true;
    } else if (other.m_lastMessageStart == 0) {
        return false;
    }

    return m_lastMessageStart < other.m_lastMessageStart;
}

int HTTPParser::onMessageBegin()
{
    JSGlobalObject* globalObject = m_globalObject;
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* thisParser = m_thisParser;

    if (JSConnectionsList* connections = m_connectionsList.get()) {
        connections->pop(globalObject, thisParser);
        connections->popActive(globalObject, thisParser);
    }

    m_numFields = 0;
    m_numValues = 0;
    m_headersCompleted = false;
    m_chunkExtensionsNread = 0;
    m_lastMessageStart = uv_hrtime();
    m_url.reset();
    m_statusMessage.reset();

    if (JSConnectionsList* connections = m_connectionsList.get()) {
        connections->push(globalObject, thisParser);
        connections->pushActive(globalObject, thisParser);
    }

    JSValue onMessageBeginCallback = thisParser->get(globalObject, Identifier::from(vm, kOnMessageBegin));
    RETURN_IF_EXCEPTION(scope, 0);
    if (onMessageBeginCallback.isCallable()) {
        CallData callData = getCallData(onMessageBeginCallback);
        MarkedArgumentBuffer args;
        JSC::profiledCall(globalObject, ProfilingReason::API, onMessageBeginCallback, callData, thisParser, args);
        RETURN_IF_EXCEPTION(scope, 0);
    }

    return 0;
}

int HTTPParser::onUrl(const char* at, size_t length)
{
    int rv = trackHeader(length);
    if (rv != 0) {
        return rv;
    }

    m_url.update(at, length);
    return 0;
}

int HTTPParser::onStatus(const char* at, size_t length)
{
    int rv = trackHeader(length);
    if (rv != 0) {
        return rv;
    }

    m_statusMessage.update(at, length);
    return 0;
}

int HTTPParser::onHeaderField(const char* at, size_t length)
{
    int rv = trackHeader(length);
    if (rv != 0) {
        return rv;
    }

    if (m_numFields == m_numValues) {
        // start of new field name
        m_numFields++;
        if (m_numFields == kMaxHeaderFieldsCount) {
            // ran out of space - flush to javascript land
            flush();
            m_numFields = 1;
            m_numValues = 0;
        }
        m_fields[m_numFields - 1].reset();
    }

    ASSERT(m_numFields < kMaxHeaderFieldsCount);
    ASSERT(m_numFields == m_numValues + 1);

    m_fields[m_numFields - 1].update(at, length);

    return 0;
}

int HTTPParser::onHeaderValue(const char* at, size_t length)
{
    int rv = trackHeader(length);
    if (rv != 0) {
        return rv;
    }

    if (m_numValues != m_numFields) {
        // start of a new header value
        m_numValues++;
        m_values[m_numValues - 1].reset();
    }

    ASSERT(m_numValues < sizeof(m_values) / sizeof(m_values[0]));
    ASSERT(m_numValues == m_numFields);

    m_values[m_numValues - 1].update(at, length);

    return 0;
}

int HTTPParser::onChunkExtensionName(const char* at, size_t length)
{
    m_chunkExtensionsNread += length;
    if (m_chunkExtensionsNread > kMaxChunkExtensionsSize) {
        llhttp_set_error_reason(&m_parserData, "HPE_CHUNK_EXTENSIONS_OVERFLOW:Chunk extensions overflow");
        return HPE_USER;
    }
    return 0;
}

int HTTPParser::onChunkExtensionValue(const char* at, size_t length)
{
    m_chunkExtensionsNread += length;
    if (m_chunkExtensionsNread > kMaxChunkExtensionsSize) {
        llhttp_set_error_reason(&m_parserData, "HPE_CHUNK_EXTENSIONS_OVERFLOW:Chunk extensions overflow");
        return HPE_USER;
    }
    return 0;
}

int HTTPParser::onHeadersComplete()
{
    JSGlobalObject* globalObject = m_globalObject;
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSHTTPParser* thisParser = m_thisParser;

    m_headersCompleted = true;
    m_headerNread = 0;

    // Arguments for the on-headers-complete javascript callback. This
    // list needs to be kept in sync with the actual argument list for
    // `parserOnHeadersComplete` in lib/_http_common.js.
    enum on_headers_complete_arg_index {
        A_VERSION_MAJOR = 0,
        A_VERSION_MINOR,
        A_HEADERS,
        A_METHOD,
        A_URL,
        A_STATUS_CODE,
        A_STATUS_MESSAGE,
        A_UPGRADE,
        A_SHOULD_KEEP_ALIVE,
        A_MAX
    };

    MarkedArgumentBuffer args;
    args.fill(vm, A_MAX, [&](JSValue* buf) {
        for (size_t i = 0; i < A_MAX; i++) {
            buf[i] = jsUndefined();
        }
    });

    JSValue onHeadersCompleteCallback = thisParser->get(globalObject, Identifier::from(vm, kOnHeadersComplete));
    RETURN_IF_EXCEPTION(scope, -1);

    if (!onHeadersCompleteCallback.isCallable()) {
        return 0;
    }

    if (m_haveFlushed) {
        flush();
        RETURN_IF_EXCEPTION(scope, -1);
    } else {
        args.set(A_HEADERS, createHeaders(globalObject));
        if (m_parserData.type == HTTP_REQUEST) {
            args.set(A_URL, m_url.toString(globalObject));
        }
    }

    m_numFields = 0;
    m_numValues = 0;

    if (m_parserData.type == HTTP_REQUEST) {
        args.set(A_METHOD, jsNumber(m_parserData.method));
    }

    if (m_parserData.type == HTTP_RESPONSE) {
        args.set(A_STATUS_CODE, jsNumber(m_parserData.status_code));
        args.set(A_STATUS_MESSAGE, m_statusMessage.toString(globalObject));
    }

    args.set(A_VERSION_MAJOR, jsNumber(m_parserData.http_major));
    args.set(A_VERSION_MINOR, jsNumber(m_parserData.http_minor));

    bool shouldKeepAlive = llhttp_should_keep_alive(&m_parserData);

    args.set(A_SHOULD_KEEP_ALIVE, jsBoolean(shouldKeepAlive));
    args.set(A_UPGRADE, jsBoolean(m_parserData.upgrade));

    CallData callData = getCallData(onHeadersCompleteCallback);

    JSValue result = JSC::profiledCall(globalObject, ProfilingReason::API, onHeadersCompleteCallback, callData, thisParser, args);
    RETURN_IF_EXCEPTION(scope, -1);

    int32_t ret = result.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, -1);

    return ret;
}

int HTTPParser::onBody(const char* at, size_t length)
{
    if (length == 0) {
        return 0;
    }

    JSGlobalObject* lexicalGlobalObject = m_globalObject;
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue onBodyCallback = m_thisParser->get(lexicalGlobalObject, Identifier::from(vm, kOnBody));
    RETURN_IF_EXCEPTION(scope, 0);
    if (!onBodyCallback.isCallable()) {
        return 0;
    }

    JSUint8Array* buffer = JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), length);
    RETURN_IF_EXCEPTION(scope, 0);

    memcpy(buffer->vector(), at, length);

    CallData callData = getCallData(onBodyCallback);
    MarkedArgumentBuffer args;
    args.append(buffer);

    JSC::profiledCall(lexicalGlobalObject, ProfilingReason::API, onBodyCallback, callData, m_thisParser, args);

    if (scope.exception()) {
        llhttp_set_error_reason(&m_parserData, "HPE_USER:JS Exception");
        return HPE_USER;
    }

    return 0;
}

int HTTPParser::onMessageComplete()
{
    JSGlobalObject* globalObject = m_globalObject;
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSHTTPParser* thisParser = m_thisParser;

    if (JSConnectionsList* connections = m_connectionsList.get()) {
        connections->pop(globalObject, thisParser);
        connections->popActive(globalObject, thisParser);
    }

    m_lastMessageStart = 0;

    if (JSConnectionsList* connections = m_connectionsList.get()) {
        connections->push(globalObject, thisParser);
    }

    if (m_numFields) {
        flush();
        RETURN_IF_EXCEPTION(scope, 0);
    }

    JSValue onMessageCompleteCallback = thisParser->get(globalObject, Identifier::from(vm, kOnMessageComplete));
    RETURN_IF_EXCEPTION(scope, 0);

    if (!onMessageCompleteCallback.isCallable()) {
        return 0;
    }

    CallData callData = getCallData(onMessageCompleteCallback);
    MarkedArgumentBuffer args;
    JSC::profiledCall(globalObject, ProfilingReason::API, onMessageCompleteCallback, callData, thisParser, args);

    if (scope.exception()) {
        return -1;
    }

    return 0;
}

int HTTPParser::onChunkHeader()
{
    m_headerNread = 0;
    m_chunkExtensionsNread = 0;
    return 0;
}

int HTTPParser::onChunkComplete()
{
    m_headerNread = 0;
    return 0;
}

int HTTPParser::trackHeader(size_t len)
{
    m_headerNread += len;
    if (m_headerNread >= m_maxHttpHeaderSize) {
        llhttp_set_error_reason(&m_parserData, "HPE_HEADER_OVERFLOW:Header overflow");
        return HPE_USER;
    }
    return 0;
}

void HTTPParser::flush()
{
    JSGlobalObject* globalObject = m_globalObject;
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* thisParser = m_thisParser;

    JSValue onHeadersCallback = thisParser->get(globalObject, Identifier::from(vm, kOnHeaders));
    RETURN_IF_EXCEPTION(scope, );

    if (!onHeadersCallback.isCallable()) {
        return;
    }

    JSValue headers = createHeaders(globalObject);
    RETURN_IF_EXCEPTION(scope, );

    CallData callData = getCallData(onHeadersCallback);
    MarkedArgumentBuffer args;
    args.append(headers);
    args.append(m_url.toString(globalObject));

    JSC::profiledCall(globalObject, ProfilingReason::API, onHeadersCallback, callData, thisParser, args);
    RETURN_IF_EXCEPTION(scope, );

    m_url.reset();
    m_haveFlushed = true;
}

} // namespace Bun
