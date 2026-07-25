#include "ModuleExportWatchpoint.h"
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

} // namespace Bun
