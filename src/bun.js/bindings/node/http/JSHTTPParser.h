#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSObject.h>
#include "BunClientData.h"
// #include "JSConnectionsList.h"
#include "ProcessBindingHTTPParser.h"

namespace Bun {

// TODO: probably move all of this into HTTPParser.h/cpp
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

class JSHTTPParser final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSHTTPParser* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject, HTTPParserBindingData* bindingData)
    {
        JSHTTPParser* instance = new (NotNull, JSC::allocateCell<JSHTTPParser>(vm)) JSHTTPParser(vm, structure, bindingData);
        instance->finishCreation(vm);
        return instance;
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSHTTPParser, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSHTTPParser.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSHTTPParser = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSHTTPParser.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSHTTPParser = std::forward<decltype(space)>(space); });
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    void finishCreation(JSC::VM&);

    JSHTTPParser(JSC::VM& vm, JSC::Structure* structure, HTTPParserBindingData* bindingData)
        : Base(vm, structure)
        , m_bindingData(bindingData)
    {
    }

    inline bool headersCompleted() const { return m_headersCompleted; }
    inline uint64_t lastMessageStart() const { return m_lastMessageStart; }
    inline const char* currentBufferData() const { return m_currentBufferData; }
    inline uint64_t currentBufferLen() const { return m_currentBufferLen; }

    inline bool freed() const { return m_freed; }

    // llhttp_t m_parser;

    // TODO: StringPtr equivalent
    // StringPtr m_fields[kMaxHeaderFieldsCount];
    // StringPtr m_values[kMaxHeaderFieldsCount];
    // StringPtr m_url;
    // StringPtr m_statusMessage;

    size_t m_numFields;
    size_t m_numValues;
    bool m_haveFlushed;
    bool m_gotException;
    size_t m_currentBufferLen;
    const char* m_currentBufferData;
    bool m_headersCompleted = false;
    bool m_pendingPause = false;
    uint64_t m_headerNread = 0;
    uint64_t m_chunkExtensionsNread = 0;
    uint64_t m_maxHttpHeaderSize = 0;
    uint64_t m_lastMessageStart = 0;

    bool m_freed = false;

    JSC::WriteBarrier<JSC::JSCell> m_connectionsList;

    HTTPParserBindingData* m_bindingData;

    void close();
    void free();
    void remove(JSC::JSGlobalObject*, JSC::JSValue parser);
    void save();
    void execute();
    void finish();
    void initialize();
};

void setupHTTPParserClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun
