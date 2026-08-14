#include "root.h"
#include "EventLoopDomain.h"

#include "AsyncContextFrame.h"
#include "BunClientData.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/MicrotaskQueue.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/StrongInlines.h>
#include <JavaScriptCore/Symbol.h>
#include <JavaScriptCore/VM.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/SymbolImpl.h>

namespace Bun {

using namespace JSC;

WTF_MAKE_TZONE_ALLOCATED_IMPL(EventLoopDomains);

EventLoopDomains::EventLoopDomains()
    : m_sentinelUid(PrivateSymbolImpl::create(StringImpl::create("BunEventLoopDomain"_s).get()))
{
}

EventLoopDomains::~EventLoopDomains() = default;

EventLoopDomains& eventLoopDomains(VM& vm)
{
    return WebCore::clientData(vm)->eventLoopDomains();
}

static inline InternalFieldTuple* asyncContextData(JSGlobalObject* globalObject)
{
    return globalObject->m_asyncContextData.get();
}

// Field 1 of the async-context tuple is the "domain slot" builtins read:
//   undefined       – no domain has ever been entered on this global
//   Symbol          – the sentinel; no domain run is active
//   [sentinel, D]   – the active run's bare context (so JS can read both the sentinel
//                     and the active run domain with one field load)
Symbol* domainSentinel(JSGlobalObject* globalObject)
{
    auto* tuple = asyncContextData(globalObject);
    JSValue slot = tuple->getInternalField(1);
    if (slot.isSymbol())
        return asSymbol(slot);
    if (auto* runContext = dynamicDowncast<JSArray>(slot))
        return asSymbol(runContext->getIndexQuickly(0));
    VM& vm = globalObject->vm();
    Symbol* sentinel = Symbol::create(vm, eventLoopDomains(vm).sentinelUid());
    tuple->putInternalField(vm, 1, sentinel);
    return sentinel;
}

static void updateDomainSlot(JSGlobalObject* globalObject)
{
    Symbol* sentinel = domainSentinel(globalObject);
    auto& runs = eventLoopDomains(globalObject->vm()).runs();
    asyncContextData(globalObject)->putInternalField(globalObject->vm(), 1, runs.isEmpty() ? JSValue(sentinel) : runs.last().bareContext.get());
}

extern "C" uint32_t Bun__Domain__allocateGlobal();

uint32_t allocateDomain(JSGlobalObject*)
{
    // One process-wide counter (kept in Rust, which also allocates each JS
    // thread's root domain from it) so ids never alias across Workers.
    return Bun__Domain__allocateGlobal();
}

uint32_t domainOfContext(JSGlobalObject* globalObject, JSValue context)
{
    return MicrotaskQueue::domainOfContext(eventLoopDomains(globalObject->vm()).sentinelUid(), context);
}

uint32_t currentDomain(JSGlobalObject* globalObject)
{
    return domainOfContext(globalObject, asyncContextData(globalObject)->getInternalField(0));
}

uint32_t activeRunDomain(JSGlobalObject* globalObject)
{
    return globalObject->vm().microtaskDrainDomain();
}

uint32_t domainOfCallback(JSGlobalObject* globalObject, JSValue callback)
{
    if (auto* frame = dynamicDowncast<AsyncContextFrame>(callback))
        return domainOfContext(globalObject, frame->context.get());
    return 0;
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

JSValue enterDomain(JSGlobalObject* globalObject, uint32_t domain)
{
    VM& vm = globalObject->vm();
    // From here on native APIs must wrap the callbacks they store in an
    // AsyncContextFrame so the callbacks carry their scheduling domain.
    globalObject->setAsyncContextTrackingEnabled(true);
    auto* tuple = asyncContextData(globalObject);
    JSValue previous = tuple->getInternalField(0);
    tuple->putInternalField(vm, 0, contextWithDomain(globalObject, previous, domain));
    return previous;
}

void restoreContext(JSGlobalObject* globalObject, JSValue previous)
{
    asyncContextData(globalObject)->putInternalField(globalObject->vm(), 0, previous);
}

JSValue baseContext(JSGlobalObject* globalObject)
{
    auto& runs = eventLoopDomains(globalObject->vm()).runs();
    if (runs.isEmpty()) [[likely]]
        return jsUndefined();
    return runs.last().bareContext.get();
}

JSValue contextForInvocation(JSGlobalObject* globalObject, JSValue captured)
{
    uint32_t active = activeRunDomain(globalObject);
    if (!active) [[likely]]
        return captured;
    if (captured.isUndefinedOrNull() || captured.isEmpty())
        return baseContext(globalObject);
    if (domainOfContext(globalObject, captured))
        return captured;
    return contextWithDomain(globalObject, captured, active);
}

void enterDomainRun(JSGlobalObject* globalObject, uint32_t domain, bool admitsLoaderJobs)
{
    VM& vm = globalObject->vm();
    auto& domains = eventLoopDomains(vm);
    globalObject->setAsyncContextTrackingEnabled(true);
    auto* tuple = asyncContextData(globalObject);
    JSValue saved = tuple->getInternalField(0);
    JSValue bare = contextWithDomain(globalObject, jsUndefined(), domain);
    domains.runs().append(DomainRunEntry {
        domain,
        vm.microtaskDrainDomain(),
        vm.microtaskDrainAdmitsLoaderJobs(),
        Strong<Unknown>(vm, saved),
        Strong<Unknown>(vm, bare),
    });
    // While the loop turns, ambient context is the bare domain: callbacks the run
    // dispatches on others' behalf (a request accepted meanwhile) must not inherit
    // the entering frame's AsyncLocalStorage values. The frame's own continuation
    // runs under callInEntryContext.
    tuple->putInternalField(vm, 0, bare);
    vm.setMicrotaskDrainDomain(&domains.sentinelUid(), domain, admitsLoaderJobs);
    updateDomainSlot(globalObject);
}

JSValue callInEntryContext(JSGlobalObject* globalObject, JSValue function)
{
    VM& vm = globalObject->vm();
    auto& runs = eventLoopDomains(vm).runs();
    ASSERT(!runs.isEmpty());
    auto* tuple = asyncContextData(globalObject);
    JSValue ambient = tuple->getInternalField(0);
    // The entering frame's values plus the run's domain.
    tuple->putInternalField(vm, 0, contextWithDomain(globalObject, runs.last().savedContext.get(), runs.last().domain));
    JSValue result = JSC::profiledCall(globalObject, ProfilingReason::API, function, JSC::getCallData(function), jsUndefined(), ArgList());
    tuple->putInternalField(vm, 0, ambient);
    return result;
}

void exitDomainRun(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto& domains = eventLoopDomains(vm);
    DomainRunEntry entry = domains.runs().takeLast();
    vm.setMicrotaskDrainDomain(&domains.sentinelUid(), entry.outerRunDomain, entry.outerAdmitsLoaderJobs);
    updateDomainSlot(globalObject);
    restoreContext(globalObject, entry.savedContext.get());
}

void drainMicrotasksInDomain(JSGlobalObject* globalObject, uint32_t domain)
{
    VM& vm = globalObject->vm();
    vm.drainMicrotasksInDomain(&eventLoopDomains(vm).sentinelUid(), domain, true);
}

} // namespace Bun

using namespace JSC;

extern "C" void Bun__Domain__enterRun(JSGlobalObject* globalObject, uint32_t domain, bool admitsLoaderJobs)
{
    Bun::enterDomainRun(globalObject, domain, admitsLoaderJobs);
}

extern "C" void Bun__Domain__exitRun(JSGlobalObject* globalObject)
{
    Bun::exitDomainRun(globalObject);
}

extern "C" EncodedJSValue Bun__Domain__callInEntryContext(JSGlobalObject* globalObject, EncodedJSValue function)
{
    return JSValue::encode(Bun::callInEntryContext(globalObject, JSValue::decode(function)));
}
