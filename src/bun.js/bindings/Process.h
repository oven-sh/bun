#pragma once

#include "root.h"

#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include "JSEventEmitter.h"

namespace Zig {

using namespace JSC;

class Process : public WebCore::JSEventEmitter {
    using Base = WebCore::JSEventEmitter;

public:
    Process(JSC::Structure* structure, WebCore::JSDOMGlobalObject& globalObject, Ref<WebCore::EventEmitter>&& impl)
        : Base(structure, globalObject, WTFMove(impl))
    {
    }

    void emitSignalEvent(int signalNumber);

    DECLARE_EXPORT_INFO;

    static void destroy(JSC::JSCell* cell)
    {
        static_cast<Process*>(cell)->Process::~Process();
    }

    ~Process();

    static constexpr unsigned StructureFlags = Base::StructureFlags | HasStaticPropertyTable;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject,
        JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype,
            JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static Process* create(WebCore::JSDOMGlobalObject& globalObject, JSC::Structure* structure)
    {
        auto emitter = WebCore::EventEmitter::create(*globalObject.scriptExecutionContext());
        Process* accessor = new (NotNull, JSC::allocateCell<Process>(globalObject.vm())) Process(structure, globalObject, WTFMove(emitter));
        accessor->finishCreation(globalObject.vm());
        return accessor;
    }

    LazyProperty<JSObject, Structure> cpuUsageStructure;
    LazyProperty<JSObject, Structure> memoryUsageStructure;

    DECLARE_VISIT_CHILDREN;

    template<typename, SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<Process, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForProcessObject.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForProcessObject = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForProcessObject.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForProcessObject = std::forward<decltype(space)>(space); });
    }

    void finishCreation(JSC::VM& vm);
};

} // namespace Zig