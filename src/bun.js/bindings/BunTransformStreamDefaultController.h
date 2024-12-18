#include "root.h"

namespace Bun {

using namespace JSC;

// JSTransformStreamDefaultController.h
class JSTransformStream;

class JSTransformStreamDefaultController final : public JSC::JSDestructibleObject {
    using Base = JSC::JSDestructibleObject;

public:
    static constexpr bool needsDestruction = true;

    template<typename CellType, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;

        return subspaceForImpl<JSTransformStreamDefaultController, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForTransformStreamController.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForTransformStreamController = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForTransformStreamController.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForTransformStreamController = std::forward<decltype(space)>(space); });
    }

    static JSTransformStreamDefaultController* create(
        JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        JSC::Structure* structure,
        JSTransformStream* transformStream);

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    // C++ methods for direct manipulation
    bool enqueue(JSC::JSGlobalObject*, JSC::JSValue chunk);
    void error(JSC::JSGlobalObject*, JSC::JSValue error);
    void terminate(JSC::JSGlobalObject*);
    JSC::JSValue desiredSize(JSC::JSGlobalObject*);

    // For garbage collection
    DECLARE_VISIT_CHILDREN;

private:
    JSTransformStreamDefaultController(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSTransformStream* transformStream);

    // Member variables
    JSC::WriteBarrier<JSTransformStream> m_stream;
    JSC::WriteBarrier<JSC::JSPromise> m_flushPromise;
    JSC::WriteBarrier<JSC::Unknown> m_transformAlgorithm;
    JSC::WriteBarrier<JSC::Unknown> m_flushAlgorithm;
};

// Function declarations for JavaScript bindings
JSC_DECLARE_CUSTOM_GETTER(jsTransformStreamDefaultControllerDesiredSize);
JSC_DECLARE_HOST_FUNCTION(jsTransformStreamDefaultControllerEnqueue);
JSC_DECLARE_HOST_FUNCTION(jsTransformStreamDefaultControllerError);
JSC_DECLARE_HOST_FUNCTION(jsTransformStreamDefaultControllerTerminate);

} // namespace Bun
