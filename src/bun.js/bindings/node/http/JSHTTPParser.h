#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSObject.h>
#include "BunClientData.h"
#include "NodeHTTPParser.h"

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
        JSHTTPParser* instance = new (NotNull, JSC::allocateCell<JSHTTPParser>(vm)) JSHTTPParser(vm, globalObject, structure);
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

    JSHTTPParser(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
        , m_impl(globalObject)
    {
    }

    ~JSHTTPParser()
    {
    }

    inline HTTPParser* impl() { return m_freed ? nullptr : &m_impl; }

    inline void freeImpl()
    {
        m_freed = true;
    }

private:
    bool m_freed = false;
    HTTPParser m_impl;
};

void setupHTTPParserClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun
