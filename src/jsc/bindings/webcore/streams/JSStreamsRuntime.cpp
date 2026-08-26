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

struct HandlerTableEntry {
    ASCIILiteral name;
    JSC::NativeFunction function;
};

#define WEB_STREAMS_HANDLER_TABLE_ENTRY(name) { #name ""_s, jsWebStreamsHandler_##name },
// clang-format off
static constexpr HandlerTableEntry handlerTable[] = {
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER(WEB_STREAMS_HANDLER_TABLE_ENTRY)
    FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET(WEB_STREAMS_HANDLER_TABLE_ENTRY)
};
// clang-format on
#undef WEB_STREAMS_HANDLER_TABLE_ENTRY
static_assert(std::size(handlerTable) == static_cast<size_t>(JSStreamsRuntime::Handler::Count));

#define WEB_STREAMS_STRUCTURE_TABLE_ENTRY(memberName, ClassName) ClassName::createStructure,
static constexpr JSC::Structure* (*internalStructureTable[])(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue) = {
    FOR_EACH_WEB_STREAMS_INTERNAL_STRUCTURE(WEB_STREAMS_STRUCTURE_TABLE_ENTRY)
};
#undef WEB_STREAMS_STRUCTURE_TABLE_ENTRY
static_assert(std::size(internalStructureTable) == static_cast<size_t>(JSStreamsRuntime::InternalStructure::Count));

void JSStreamsRuntime::initialize(Zig::GlobalObject* globalObject)
{
    m_globalObject = globalObject;

    using HandlerProperty = JSC::LazyProperty<JSGlobalObject, JSC::JSFunction>;

    for (auto& handler : m_handlers) {
        handler.initLater([](const HandlerProperty::Initializer& init) {
            auto* self = JSStreamsRuntime::from(init.owner);
            size_t i = &init.property - self->m_handlers;
            ASSERT(i < std::size(self->m_handlers));
            auto& entry = handlerTable[i];
            init.set(JSFunction::create(init.vm, init.owner, 2, String(entry.name),
                entry.function, ImplementationVisibility::Private));
        });
    }

    // Spec: `%FooQueuingStrategy%.prototype.size` is ONE user-visible function object per realm.
    m_byteLengthQueuingStrategySizeFunction.initLater([](const HandlerProperty::Initializer& init) {
        init.set(JSFunction::create(init.vm, init.owner, 1, "size"_s,
            jsWebStreamsByteLengthQueuingStrategySize, ImplementationVisibility::Public));
    });
    m_countQueuingStrategySizeFunction.initLater([](const HandlerProperty::Initializer& init) {
        init.set(JSFunction::create(init.vm, init.owner, 0, "size"_s,
            jsWebStreamsCountQueuingStrategySize, ImplementationVisibility::Public));
    });

    for (auto& structure : m_internalStructures) {
        structure.initLater([](const JSC::LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
            auto* self = JSStreamsRuntime::from(init.owner);
            size_t i = &init.property - self->m_internalStructures;
            ASSERT(i < std::size(self->m_internalStructures));
            init.set(internalStructureTable[i](init.vm, init.owner, jsNull()));
        });
    }

    m_readManyResultStructure.initLater([](const JSC::LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
        auto* globalObject = init.owner;
        auto& vm = init.vm;
        auto* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), 3);
        JSC::PropertyOffset offset;
        structure = Structure::addPropertyTransition(vm, structure, vm.propertyNames->value, 0, offset);
        RELEASE_ASSERT(offset == readManyResultValueOffset);
        structure = Structure::addPropertyTransition(vm, structure, WebCore::builtinNames(vm).sizePublicName(), 0, offset);
        RELEASE_ASSERT(offset == readManyResultSizeOffset);
        structure = Structure::addPropertyTransition(vm, structure, vm.propertyNames->done, 0, offset);
        RELEASE_ASSERT(offset == readManyResultDoneOffset);
        init.set(structure);
    });
}

template<typename Visitor>
void JSStreamsRuntime::visit(Visitor& visitor)
{
    for (auto& handler : m_handlers)
        handler.visit(visitor);

    m_byteLengthQueuingStrategySizeFunction.visit(visitor);
    m_countQueuingStrategySizeFunction.visit(visitor);

    for (auto& structure : m_internalStructures)
        structure.visit(visitor);
    m_readManyResultStructure.visit(visitor);
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

#define WEB_STREAMS_DEFINE_STRUCTURE_ACCESSOR(memberName, ClassName)                                                                \
    Structure* JSStreamsRuntime::memberName(const Zig::GlobalObject*)                                                               \
    {                                                                                                                               \
        return m_internalStructures[static_cast<size_t>(InternalStructure::memberName)].getInitializedOnMainThread(m_globalObject); \
    }
FOR_EACH_WEB_STREAMS_INTERNAL_STRUCTURE(WEB_STREAMS_DEFINE_STRUCTURE_ACCESSOR)
#undef WEB_STREAMS_DEFINE_STRUCTURE_ACCESSOR

Structure* JSStreamsRuntime::readManyResultStructure(const Zig::GlobalObject*)
{
    return m_readManyResultStructure.getInitializedOnMainThread(m_globalObject);
}

} // namespace WebCore
