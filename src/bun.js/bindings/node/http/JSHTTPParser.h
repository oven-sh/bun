#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSObject.h>
#include "BunClientData.h"
#include "JSConnectionsList.h"

namespace Bun {

class JSHTTPParser final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSHTTPParser* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject)
    {
        JSHTTPParser* instance = new (NotNull, JSC::allocateCell<JSHTTPParser>(vm)) JSHTTPParser(vm, structure);
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

    JSHTTPParser(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    inline bool headersCompleted() const { return m_headersCompleted; }
    inline uint64_t lastMessageStart() const { return m_lastMessageStart; }

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

    JSC::WriteBarrier<JSConnectionsList> m_connectionsList;
};

void setupHTTPParserClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun
