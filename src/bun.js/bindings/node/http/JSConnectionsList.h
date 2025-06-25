#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSObject.h>
#include "BunClientData.h"

namespace Bun {

class JSConnectionsList final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSC::Structure*
    createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSConnectionsList* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSSet* allConnectionsSet, JSC::JSSet* activeConnectionsSet)
    {
        JSConnectionsList* instance = new (NotNull, JSC::allocateCell<JSConnectionsList>(vm)) JSConnectionsList(vm, structure);
        instance->finishCreation(vm, globalObject, allConnectionsSet, activeConnectionsSet);
        return instance;
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSConnectionsList, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSConnectionsList.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSConnectionsList = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSConnectionsList.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSConnectionsList = std::forward<decltype(space)>(space); });
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSC::JSSet* allConnectionsSet, JSC::JSSet* activeConnectionsSet);

    JSConnectionsList(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    inline JSC::JSSet* allConnections() { return m_allConnections.get(); };
    inline JSC::JSSet* activeConnections() { return m_activeConnections.get(); }

    JSC::WriteBarrier<JSC::JSSet> m_allConnections;
    JSC::WriteBarrier<JSC::JSSet> m_activeConnections;

    JSC::JSArray* all(JSC::JSGlobalObject*);
    JSC::JSArray* idle(JSC::JSGlobalObject*);
    JSC::JSArray* active(JSC::JSGlobalObject*);
    JSC::JSArray* expired(JSC::JSGlobalObject*, uint64_t headersDeadline, uint64_t requestDeadline);

    void push(JSC::JSGlobalObject*, JSC::JSCell* parser);
    void pop(JSC::JSGlobalObject*, JSC::JSCell* parser);
    void pushActive(JSC::JSGlobalObject*, JSC::JSCell* parser);
    void popActive(JSC::JSGlobalObject*, JSC::JSCell* parser);
};

void setupConnectionsListClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun
