#include "config.h"
#include "JSStreamsRuntime.h"

#include "WebStreamsInternals.h"

#include "BunStandaloneTextSink.h"
#include "BunStreamSource.h"
#include "JSCrossRealmTransformState.h"
#include "JSDirectSinkCloseState.h"
#include "JSAsyncIteratorSourceOperation.h"
#include "JSDirectStreamController.h"
#include "JSOneShotDirectSink.h"
#include "JSReadableStreamIntoArrayOperation.h"
#include "JSPullIntoDescriptor.h"
#include "JSReadRequest.h"
#include "JSReadStreamIntoSinkOperation.h"
#include "JSStreamAlgorithmContexts.h"
#include "JSStreamPipeToOperation.h"
#include "JSStreamTeeState.h"
#include "WebCoreJSClientData.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;

JSStreamsRuntime* JSStreamsRuntime::from(JSGlobalObject* globalObject)
{
    return defaultGlobalObject(globalObject)->streamsRuntime();
}

void JSStreamsRuntime::initialize(Zig::GlobalObject* globalObject)
{
    m_globalObject = globalObject;

    using HandlerProperty = JSC::LazyProperty<JSGlobalObject, JSC::JSFunction>;

#define WEB_STREAMS_INIT_HANDLER(name)                                       \
    m_##name.initLater([](const HandlerProperty::Initializer& init) {        \
        init.set(JSFunction::create(init.vm, init.owner, 2, #name ""_s,      \
            jsWebStreamsHandler_##name, ImplementationVisibility::Private)); \
    });
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER(WEB_STREAMS_INIT_HANDLER)
    FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET(WEB_STREAMS_INIT_HANDLER)
#undef WEB_STREAMS_INIT_HANDLER

    // Spec: `%FooQueuingStrategy%.prototype.size` is ONE user-visible function object per realm.
    m_byteLengthQueuingStrategySizeFunction.initLater([](const HandlerProperty::Initializer& init) {
        init.set(JSFunction::create(init.vm, init.owner, 1, "size"_s,
            jsWebStreamsByteLengthQueuingStrategySize, ImplementationVisibility::Public));
    });
    m_countQueuingStrategySizeFunction.initLater([](const HandlerProperty::Initializer& init) {
        init.set(JSFunction::create(init.vm, init.owner, 0, "size"_s,
            jsWebStreamsCountQueuingStrategySize, ImplementationVisibility::Public));
    });

#define WEB_STREAMS_INIT_STRUCTURE(memberName, ClassName)                                                \
    m_##memberName.initLater([](const JSC::LazyProperty<JSGlobalObject, Structure>::Initializer& init) { \
        init.set(ClassName::createStructure(init.vm, init.owner, jsNull()));                             \
    });
    FOR_EACH_WEB_STREAMS_INTERNAL_STRUCTURE(WEB_STREAMS_INIT_STRUCTURE)
#undef WEB_STREAMS_INIT_STRUCTURE

    m_readManyResultStructure.initLater([](const JSC::LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
        auto* globalObject = init.owner;
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

template<typename Visitor>
void JSStreamsRuntime::visit(Visitor& visitor)
{
#define WEB_STREAMS_VISIT_HANDLER(name) m_##name.visit(visitor);
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER(WEB_STREAMS_VISIT_HANDLER)
    FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET(WEB_STREAMS_VISIT_HANDLER)
#undef WEB_STREAMS_VISIT_HANDLER

    m_byteLengthQueuingStrategySizeFunction.visit(visitor);
    m_countQueuingStrategySizeFunction.visit(visitor);

#define WEB_STREAMS_VISIT_STRUCTURE(memberName, ClassName) m_##memberName.visit(visitor);
    FOR_EACH_WEB_STREAMS_INTERNAL_STRUCTURE(WEB_STREAMS_VISIT_STRUCTURE)
    m_readManyResultStructure.visit(visitor);
#undef WEB_STREAMS_VISIT_STRUCTURE
}

template void JSStreamsRuntime::visit(JSC::AbstractSlotVisitor&);
template void JSStreamsRuntime::visit(JSC::SlotVisitor&);

JSFunction* JSStreamsRuntime::byteLengthQueuingStrategySizeFunction(const Zig::GlobalObject*)
{
    return m_byteLengthQueuingStrategySizeFunction.getInitializedOnMainThread(m_globalObject);
}

JSFunction* JSStreamsRuntime::countQueuingStrategySizeFunction(const Zig::GlobalObject*)
{
    return m_countQueuingStrategySizeFunction.getInitializedOnMainThread(m_globalObject);
}

#define WEB_STREAMS_DEFINE_STRUCTURE_ACCESSOR(memberName, ClassName)      \
    Structure* JSStreamsRuntime::memberName(const Zig::GlobalObject*)     \
    {                                                                     \
        return m_##memberName.getInitializedOnMainThread(m_globalObject); \
    }
FOR_EACH_WEB_STREAMS_INTERNAL_STRUCTURE(WEB_STREAMS_DEFINE_STRUCTURE_ACCESSOR)
#undef WEB_STREAMS_DEFINE_STRUCTURE_ACCESSOR

Structure* JSStreamsRuntime::readManyResultStructure(const Zig::GlobalObject*)
{
    return m_readManyResultStructure.getInitializedOnMainThread(m_globalObject);
}

} // namespace WebCore
