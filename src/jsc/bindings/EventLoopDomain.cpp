#include "root.h"
#include "EventLoopDomain.h"

#include "BunClientData.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/MicrotaskQueue.h>
#include <JavaScriptCore/StrongInlines.h>
#include <JavaScriptCore/Symbol.h>
#include <JavaScriptCore/VM.h>
#include <wtf/TZoneMallocInlines.h>

namespace Bun {

using namespace JSC;

WTF_MAKE_TZONE_ALLOCATED_IMPL(EventLoopDomains);

EventLoopDomains::EventLoopDomains()
    : m_sentinelUid(PrivateSymbolImpl::create(StringImpl::create("BunEventLoopDomain"_s).get()))
{
}

void EventLoopDomains::push(DomainRunEntry&& entry)
{
    m_activeStart = entry.start;
    m_runs.append(WTF::move(entry));
}

DomainRunEntry EventLoopDomains::pop()
{
    DomainRunEntry entry = m_runs.takeLast();
    m_activeStart = m_runs.isEmpty() ? 0 : m_runs.last().start;
    return entry;
}

const DomainRunEntry* EventLoopDomains::innermostWithContext() const
{
    for (size_t i = m_runs.size(); i-- > 0;) {
        if (m_runs[i].permissive)
            return &m_runs[i];
    }
    return nullptr;
}

static inline InternalFieldTuple* asyncContextData(JSGlobalObject* globalObject)
{
    return globalObject->m_asyncContextData.get();
}

// Field 1 of the async-context tuple is the "domain slot" builtins read: during a
// permissive run, that run's bare `[sentinel, start]` (so JS reads the sentinel
// and the active domain with one field load); otherwise the Symbol once one has
// been needed on this global, else undefined.
Symbol* domainSentinel(JSGlobalObject* globalObject)
{
    auto* tuple = asyncContextData(globalObject);
    JSValue slot = tuple->getInternalField(1);
    if (slot.isSymbol())
        return asSymbol(slot);
    if (auto* bare = dynamicDowncast<JSArray>(slot))
        return asSymbol(bare->getIndexQuickly(0));
    VM& vm = globalObject->vm();
    Symbol* sentinel = Symbol::create(vm, eventLoopDomains(vm).sentinelUid());
    tuple->putInternalField(vm, 1, sentinel);
    return sentinel;
}

uint32_t domainOfContext(JSGlobalObject* globalObject, JSValue context)
{
    return MicrotaskQueue::domainOfContext(eventLoopDomains(globalObject->vm()).sentinelUid(), context);
}

uint32_t currentDomain(JSGlobalObject* globalObject)
{
    return domainOfContext(globalObject, asyncContextData(globalObject)->getInternalField(0));
}

JSValue contextWithDomain(JSGlobalObject* globalObject, JSValue context, uint32_t domain)
{
    ASSERT(domain);
    VM& vm = globalObject->vm();
    uint32_t existing = domainOfContext(globalObject, context);
    if (existing == domain)
        return context;
    JSArray* source = context.isCell() ? dynamicDowncast<JSArray>(context.asCell()) : nullptr;
    unsigned sourceLength = source ? source->length() : 0;
    // A context array that already carries a domain has the pair at [0], [1].
    unsigned skip = existing ? 2 : 0;

    unsigned length = 2 + sourceLength - skip;
    JSArray* result = JSArray::tryCreate(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), length);
    RELEASE_ASSERT(result, "out of memory allocating an async context");
    result->putDirectIndex(globalObject, 0, domainSentinel(globalObject));
    result->putDirectIndex(globalObject, 1, jsNumber(domain));
    for (unsigned i = skip; i < sourceLength; ++i) {
        // Context arrays are runtime-made and dense: no getters to run.
        JSValue element = source->tryGetIndexQuickly(i, nullptr);
        result->putDirectIndex(globalObject, 2 + i - skip, element ? element : jsUndefined());
    }
    ASSERT(domainOfContext(globalObject, result) == domain);
    return result;
}

JSValue baseContextSlow(JSGlobalObject* globalObject)
{
    if (const auto* run = eventLoopDomains(globalObject->vm()).innermostWithContext())
        return run->bareContext.get();
    return jsUndefined();
}

JSValue contextForInvocationSlow(JSGlobalObject* globalObject, JSValue captured)
{
    const auto* run = eventLoopDomains(globalObject->vm()).innermost();
    ASSERT(run);
    if (!run->permissive) {
        // A strict run dispatches nothing on others' behalf that reaches JS.
        return captured;
    }
    if (captured.isUndefinedOrNull() || captured.isEmpty())
        return run->bareContext.get();
    return contextWithDomain(globalObject, captured, run->start);
}

void enterDomainRun(JSGlobalObject* globalObject, uint32_t start, bool permissive)
{
    VM& vm = globalObject->vm();
    auto& domains = eventLoopDomains(vm);
    auto& queue = vm.defaultMicrotaskQueue();
    queue.setDomainSentinel(domains.sentinelUid());
    // A permissive run may await an import() and so admits module-loader jobs.
    queue.beginDomainDrain(start, permissive);

    DomainRunEntry entry { start, permissive, {}, {}, {} };
    if (permissive) {
        // Its own code runs under the bare context, so what that code registers and
        // queues carries the run; native APIs must wrap stored callbacks from now on.
        globalObject->setAsyncContextTrackingEnabled(true);
        auto* tuple = asyncContextData(globalObject);
        JSValue bare = contextWithDomain(globalObject, jsUndefined(), start);
        entry.savedContext.set(vm, tuple->getInternalField(0));
        entry.savedDomainSlot.set(vm, tuple->getInternalField(1));
        entry.bareContext.set(vm, bare);
        tuple->putInternalField(vm, 0, bare);
        tuple->putInternalField(vm, 1, bare);
    }
    domains.push(WTF::move(entry));
}

void exitDomainRun(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    DomainRunEntry entry = eventLoopDomains(vm).pop();
    vm.defaultMicrotaskQueue().endDomainDrain();
    if (entry.permissive) {
        auto* tuple = asyncContextData(globalObject);
        tuple->putInternalField(vm, 0, entry.savedContext.get());
        tuple->putInternalField(vm, 1, entry.savedDomainSlot.get());
    }
}

JSValue callInEntryContext(JSGlobalObject* globalObject, JSValue function)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* run = eventLoopDomains(vm).innermost();
    ASSERT(run && run->permissive);
    auto* tuple = asyncContextData(globalObject);
    JSValue ambient = tuple->getInternalField(0);
    tuple->putInternalField(vm, 0, contextWithDomain(globalObject, run->savedContext.get(), run->start));
    JSValue result = JSC::profiledCall(globalObject, ProfilingReason::API, function, JSC::getCallData(function), jsUndefined(), ArgList());
    tuple->putInternalField(vm, 0, ambient);
    RETURN_IF_EXCEPTION(scope, {});
    return result;
}

} // namespace Bun

extern "C" void Bun__Domain__enterRun(JSC::JSGlobalObject* globalObject, uint32_t start, bool permissive)
{
    Bun::enterDomainRun(globalObject, start, permissive);
}

extern "C" void Bun__Domain__exitRun(JSC::JSGlobalObject* globalObject)
{
    Bun::exitDomainRun(globalObject);
}

// Empty iff an exception was thrown.
extern "C" JSC::EncodedJSValue Bun__Domain__callInEntryContext(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue function)
{
    return JSC::JSValue::encode(Bun::callInEntryContext(globalObject, JSC::JSValue::decode(function)));
}
