#include "ModuleExportWatchpoint.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/ObjectPropertyConditionSet.h>
#include <JavaScriptCore/DeferTermination.h>

namespace Bun {

void ModuleExportWatchpoint::install(JSC::JSGlobalObject* globalObject, JSC::JSObject* exports, const JSC::Identifier& prop)
{
    JSC::VM& vm = globalObject->vm();
    JSC::DeferTerminationForAWhile deferScope(vm);

    JSC::ObjectPropertyCondition condition = JSC::generateConditionForSelfEquivalence(vm, globalObject, exports, prop.impl());
    if (!condition || !condition.isWatchable(JSC::PropertyCondition::EnsureWatchability)) {
        m_set.invalidate(vm, JSC::StringFireDetail("module export is not watchable"));
        return;
    }

    m_adaptor = WTF::makeUnique<JSC::ObjectPropertyChangeAdaptiveWatchpoint<JSC::InlineWatchpointSet>>(globalObject, condition, m_set);
    m_adaptor->install(vm);
}

void installTrackedExportsForModule(Zig::GlobalObject* globalObject, InternalModuleRegistry::Field id, JSC::JSValue exportsValue)
{
    JSC::JSObject* exports = exportsValue.getObject();
    if (!exports) [[unlikely]]
        return;
    JSC::VM& vm = globalObject->vm();
    for (const auto& entry : s_trackedExportTable) {
        if (entry.module != id)
            continue;
        globalObject->trackedExport(entry.slot).install(globalObject, exports, JSC::Identifier::fromString(vm, entry.prop));
    }
}

JSC::JSValue currentValueOfTrackedExport(Zig::GlobalObject* globalObject, TrackedExport slot)
{
    const auto& entry = s_trackedExportTable[static_cast<size_t>(slot)];
    JSC::JSValue exportsValue = globalObject->internalModuleRegistry()->internalField(entry.module).get();
    JSC::JSObject* exports = exportsValue.getObject();
    if (!exports) [[unlikely]]
        return {};
    JSC::VM& vm = globalObject->vm();
    return exports->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, entry.prop));
}

} // namespace Bun
