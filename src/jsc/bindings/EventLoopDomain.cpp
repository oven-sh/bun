#include "root.h"
#include "EventLoopDomain.h"

#include "ZigGlobalObject.h"
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/MicrotaskQueue.h>
#include <JavaScriptCore/StrongInlines.h>
#include <JavaScriptCore/VM.h>
#include <wtf/TZoneMallocInlines.h>

namespace Bun {

using namespace JSC;

WTF_MAKE_TZONE_ALLOCATED_IMPL(EventLoopDomains);

static inline InternalFieldTuple* asyncContextData(JSGlobalObject* globalObject)
{
    return globalObject->m_asyncContextData.get();
}

void EventLoopDomains::enter(JSGlobalObject* globalObject, uint32_t start)
{
    VM& vm = globalObject->vm();
    // The run may await an import(), so it keeps module-loader jobs.
    vm.defaultMicrotaskQueue().beginDrainScope(/* admitLoaderJobs */ true);
    auto* tuple = asyncContextData(globalObject);
    m_runs.append(Run { start, Strong<Unknown>(vm, tuple->getInternalField(1)), std::nullopt });
    // Field 1 tells nextTick which run is active: ticks it queues from now on are
    // born in this run; older ones wait for it.
    tuple->putInternalField(vm, 1, jsNumber(start));
}

void EventLoopDomains::beginLoopPhase(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto* tuple = asyncContextData(globalObject);
    m_runs.last().savedContext.emplace(vm, tuple->getInternalField(0));
    tuple->putInternalField(vm, 0, jsUndefined());
}

void EventLoopDomains::exit(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    Run run = m_runs.takeLast();
    ++m_exits;
    vm.defaultMicrotaskQueue().endDrainScope();
    auto* tuple = asyncContextData(globalObject);
    tuple->putInternalField(vm, 1, run.savedActiveSlot.get());
    if (run.savedContext)
        tuple->putInternalField(vm, 0, run.savedContext->get());
}

} // namespace Bun

extern "C" void Bun__Domain__enterRun(JSC::JSGlobalObject* globalObject, uint32_t start)
{
    Bun::eventLoopDomains(globalObject->vm()).enter(globalObject, start);
}

extern "C" void Bun__Domain__beginLoopPhase(JSC::JSGlobalObject* globalObject)
{
    Bun::eventLoopDomains(globalObject->vm()).beginLoopPhase(globalObject);
}

extern "C" void Bun__Domain__exitRun(JSC::JSGlobalObject* globalObject)
{
    Bun::eventLoopDomains(globalObject->vm()).exit(globalObject);
}
