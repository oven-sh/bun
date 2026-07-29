#include "config.h"
#include "JSStreamsRuntime.h"

#include "WebStreamsInternals.h"

#include "BunStandaloneTextSink.h"
#include "BunStreamSource.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSCrossRealmTransformState.h"
#include "JSDirectSinkCloseState.h"
#include "JSAsyncIteratorSourceOperation.h"
#include "JSDirectStreamController.h"
#include "JSOneShotDirectSink.h"
#include "JSReadableStreamIntoArrayOperation.h"
#include "JSPullIntoDescriptor.h"
#include "JSReadRequest.h"
#include "JSReadStreamIntoSinkOperation.h"
#include "JSResumableSinkPumpOperation.h"
#include "JSStreamAlgorithmContexts.h"
#include "JSStreamPipeToOperation.h"
#include "JSStreamTeeState.h"
#include "WebCoreJSClientData.h"
#include "WebStreamsHeapAnalyzer.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;

const ClassInfo JSStreamsRuntime::s_info = { "StreamsRuntime"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStreamsRuntime) };

JSStreamsRuntime::JSStreamsRuntime(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

Structure* JSStreamsRuntime::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSStreamsRuntime* JSStreamsRuntime::create(VM& vm, Zig::GlobalObject* globalObject)
{
    auto* structure = createStructure(vm, globalObject, jsNull());
    auto* cell = new (NotNull, allocateCell<JSStreamsRuntime>(vm)) JSStreamsRuntime(vm, structure);
    cell->finishCreation(vm, globalObject);
    return cell;
}

JSStreamsRuntime* JSStreamsRuntime::from(JSGlobalObject* globalObject)
{
    return defaultGlobalObject(globalObject)->streamsRuntime();
}

GCClient::IsoSubspace* JSStreamsRuntime::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSStreamsRuntime, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForStreamsRuntime.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForStreamsRuntime = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForStreamsRuntime.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForStreamsRuntime = std::forward<decltype(space)>(space); });
}

void JSStreamsRuntime::finishCreation(VM& vm, Zig::GlobalObject*)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    using HandlerProperty = JSC::LazyProperty<JSStreamsRuntime, JSC::JSFunction>;

#define WEB_STREAMS_INIT_HANDLER(name)                                                  \
    m_##name.initLater([](const HandlerProperty::Initializer& init) {                   \
        init.set(JSFunction::create(init.vm, init.owner->globalObject(), 2, #name ""_s, \
            jsWebStreamsHandler_##name, ImplementationVisibility::Private));            \
    });
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER(WEB_STREAMS_INIT_HANDLER)
    FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET(WEB_STREAMS_INIT_HANDLER)
#undef WEB_STREAMS_INIT_HANDLER

    // Spec: `%FooQueuingStrategy%.prototype.size` is ONE user-visible function object per realm.
    m_byteLengthQueuingStrategySizeFunction.initLater([](const HandlerProperty::Initializer& init) {
        init.set(JSFunction::create(init.vm, init.owner->globalObject(), 1, "size"_s,
            jsWebStreamsByteLengthQueuingStrategySize, ImplementationVisibility::Public));
    });
    m_countQueuingStrategySizeFunction.initLater([](const HandlerProperty::Initializer& init) {
        init.set(JSFunction::create(init.vm, init.owner->globalObject(), 0, "size"_s,
            jsWebStreamsCountQueuingStrategySize, ImplementationVisibility::Public));
    });

#define WEB_STREAMS_INIT_STRUCTURE(memberName, ClassName)                                                  \
    m_##memberName.initLater([](const JSC::LazyProperty<JSStreamsRuntime, Structure>::Initializer& init) { \
        init.set(ClassName::createStructure(init.vm, init.owner->globalObject(), jsNull()));               \
    });
    FOR_EACH_WEB_STREAMS_INTERNAL_STRUCTURE(WEB_STREAMS_INIT_STRUCTURE)
#undef WEB_STREAMS_INIT_STRUCTURE

    m_readManyResultStructure.initLater([](const JSC::LazyProperty<JSStreamsRuntime, Structure>::Initializer& init) {
        auto* globalObject = init.owner->globalObject();
        auto& vm = init.vm;
        auto* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), 3);
        JSC::PropertyOffset offset;
        structure = Structure::addPropertyTransition(vm, structure, vm.propertyNames->value, 0, offset);
        RELEASE_ASSERT(offset == 0);
        structure = Structure::addPropertyTransition(vm, structure, WebCore::builtinNames(vm).sizePublicName(), 0, offset);
        RELEASE_ASSERT(offset == 1);
        structure = Structure::addPropertyTransition(vm, structure, vm.propertyNames->done, 0, offset);
        RELEASE_ASSERT(offset == 2);
        init.set(structure);
    });
}

DEFINE_VISIT_CHILDREN(JSStreamsRuntime);

template<typename Visitor>
void JSStreamsRuntime::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSStreamsRuntime>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

#define WEB_STREAMS_VISIT_HANDLER(name) thisObject->m_##name.visit(visitor);
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER(WEB_STREAMS_VISIT_HANDLER)
    FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET(WEB_STREAMS_VISIT_HANDLER)
#undef WEB_STREAMS_VISIT_HANDLER

    thisObject->m_byteLengthQueuingStrategySizeFunction.visit(visitor);
    thisObject->m_countQueuingStrategySizeFunction.visit(visitor);

#define WEB_STREAMS_VISIT_STRUCTURE(memberName, ClassName) thisObject->m_##memberName.visit(visitor);
    FOR_EACH_WEB_STREAMS_INTERNAL_STRUCTURE(WEB_STREAMS_VISIT_STRUCTURE)
    thisObject->m_readManyResultStructure.visit(visitor);
#undef WEB_STREAMS_VISIT_STRUCTURE

    {
        WTF::Locker locker { thisObject->cellLock() };
        for (auto& controller : thisObject->m_endOfTickFlushes)
            visitor.appendHidden(controller);
    }
}

void JSStreamsRuntime::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSStreamsRuntime>(cell);
    Base::analyzeHeap(cell, analyzer);
    WTF::Locker locker { thisObject->cellLock() };
    uint32_t i = 0;
    for (auto& entry : thisObject->m_endOfTickFlushes) {
        if (auto* controller = entry.get())
            analyzer.analyzeIndexEdge(cell, controller, i);
        ++i;
    }
}

// See src/jsc/event_loop.rs. The deferred queue runs right after every microtask drain; the
// runtime cell (global lifetime, non-destructible) is the only pointer it ever holds for streams.
extern "C" bool Bun__EventLoop__postDeferredTask(void* bunVM, void* ctx, bool (*task)(void*));

extern "C" bool Bun__StreamsRuntime__endOfTickFlush(void* ctx)
{
    auto* runtime = static_cast<JSStreamsRuntime*>(ctx);
    auto* globalObject = runtime->globalObject();
    auto& vm = JSC::getVM(globalObject);
    WTF::Vector<JSC::WriteBarrier<JSDirectStreamController>> pending;
    {
        WTF::Locker locker { runtime->cellLock() };
        pending = std::exchange(runtime->m_endOfTickFlushes, {});
    }
    // Keep the queue entry registered while draining: controllers armed by user JS running
    // inside onFlush land in the fresh list and are picked up by the "stay registered" return.
    JSC::MarkedArgumentBuffer live;
    for (auto& barrier : pending)
        live.append(barrier.get());
    for (unsigned i = 0; i < live.size(); i++) {
        auto* controller = uncheckedDowncast<JSDirectStreamController>(live.at(i));
        controller->m_endOfTickFlushArmed = false;
        if (controller->m_closed || !controller->m_stream)
            continue;
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        controller->onFlush(globalObject);
        if (scope.exception()) [[unlikely]] {
            // There is no JS caller: error the stream like a throwing flush() would.
            JSC::JSValue error = Bun::WebStreams::takeAbruptCompletion(globalObject, scope);
            if (error)
                controller->handleError(globalObject, error);
            scope.clearExceptionExceptTermination();
        }
    }
    bool keepRegistered;
    {
        WTF::Locker locker { runtime->cellLock() };
        keepRegistered = !runtime->m_endOfTickFlushes.isEmpty();
        runtime->m_endOfTickFlushTaskRegistered = keepRegistered;
    }
    return keepRegistered;
}

void JSStreamsRuntime::armEndOfTickFlush(JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    auto& vm = JSC::getVM(globalObject);
    {
        WTF::Locker locker { cellLock() };
        m_endOfTickFlushes.append(JSC::WriteBarrier<JSDirectStreamController>(vm, this, controller));
    }
    vm.writeBarrier(this, controller);
    if (m_endOfTickFlushTaskRegistered)
        return;
    m_endOfTickFlushTaskRegistered = true;
    Bun__EventLoop__postDeferredTask(bunVM(globalObject), this, &Bun__StreamsRuntime__endOfTickFlush);
}

JSFunction* JSStreamsRuntime::byteLengthQueuingStrategySizeFunction(const Zig::GlobalObject*)
{
    return m_byteLengthQueuingStrategySizeFunction.get(this);
}

JSFunction* JSStreamsRuntime::countQueuingStrategySizeFunction(const Zig::GlobalObject*)
{
    return m_countQueuingStrategySizeFunction.get(this);
}

#define WEB_STREAMS_DEFINE_STRUCTURE_ACCESSOR(memberName, ClassName)  \
    Structure* JSStreamsRuntime::memberName(const Zig::GlobalObject*) \
    {                                                                 \
        return m_##memberName.get(this);                              \
    }
FOR_EACH_WEB_STREAMS_INTERNAL_STRUCTURE(WEB_STREAMS_DEFINE_STRUCTURE_ACCESSOR)
#undef WEB_STREAMS_DEFINE_STRUCTURE_ACCESSOR

Structure* JSStreamsRuntime::readManyResultStructure(const Zig::GlobalObject*)
{
    return m_readManyResultStructure.get(this);
}

} // namespace WebCore
