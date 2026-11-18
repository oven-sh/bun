#pragma once
#include "root.h"
#include "GeneratedBindings+Counts.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/WriteBarrier.h>

namespace Bun::Bindgen {

void destroyInterfaceWithInlineStorage(JSC::JSCell*);
struct InterfaceWithInlineStorageCellType {
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;
    static void destroy(JSC::JSCell* cell) { destroyInterfaceWithInlineStorage(cell); }
};

namespace Exposure {
enum : uint8_t {
    Window = 1 << 0,
    DedicatedWorker = 1 << 1,
    SharedWorker = 1 << 2,
    ServiceWorker = 1 << 3,
    SecureContext = 1 << 7,
};
}

// The per-global-object state of generated bindings.
struct AdditionsToGlobalObject {
    ~AdditionsToGlobalObject();
    void initialize();

    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        for (auto& lazyClass : m_classes)
            lazyClass.visit(visitor);
        for (auto& structure : m_returnedDictionaryStructures)
            visitor.append(structure);
        visitor.append(m_boundFunctionReplacementStructure);
        visitor.append(m_globalReceiver);
        if (m_interfaces)
            visitInterfaces(visitor);
    }
    template<typename Visitor> void visitInterfaces(Visitor&);

    // By `classIndex`.
    JSC::LazyClassStructure m_classes[Counts::numberOfClasses];
    // What an object with every member of a returned dictionary has, made when the first is returned.
    JSC::WriteBarrier<JSC::Structure> m_returnedDictionaryStructures[Counts::numberOfReturnedDictionaries];
    JSC::WriteBarrier<JSC::Structure> m_boundFunctionReplacementStructure;
    // By `interfaceNumber`. Null until one is used.
    JSC::LazyClassStructure* m_interfaces { nullptr };
    JSC::JSValue (*m_inlineUnforgeables)[2] { nullptr };
    // The instance of a `global` interface that stands behind this global object.
    JSC::WriteBarrier<JSC::JSObject> m_globalReceiver;
    // Which members of interfaces are there. Set before any is used.
    uint8_t m_exposure { 0xFF };
};

}
