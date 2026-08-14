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
//   undefined            – no domain has ever been entered on this global
//   Symbol               – the sentinel; no scoped run is active
//   [sentinel, D, ...]   – the active run's base context (so JS can read both the
//                          sentinel and the active run domain with one field load)
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
    asyncContextData(globalObject)->putInternalField(globalObject->vm(), 1, runs.isEmpty() ? JSValue(sentinel) : runs.last().runContext.get());
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
    // Contiguous, so MicrotaskQueue::domainOfContext can read it without side effects.
    JSArray* result = JSArray::tryCreate(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), length);
    RELEASE_ASSERT(result);
    result->putDirectIndex(globalObject, 0, domainSentinel(globalObject));
    result->putDirectIndex(globalObject, 1, jsNumber(domain));
    for (unsigned i = skip; i < sourceLength; ++i)
        result->putDirectIndex(globalObject, 2 + i - skip, source->getIndex(globalObject, i));
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
    return runs.last().runContext.get();
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

void enterScopedRun(JSGlobalObject* globalObject, uint32_t domain)
{
    VM& vm = globalObject->vm();
    auto& domains = eventLoopDomains(vm);
    JSValue saved = enterDomain(globalObject, domain);
    JSValue runContext = asyncContextData(globalObject)->getInternalField(0);
    domains.runs().append(ScopedRunEntry {
        domain,
        vm.microtaskDrainDomain(),
        Strong<Unknown>(vm, saved),
        Strong<Unknown>(vm, runContext),
    });
    vm.setMicrotaskDrainDomain(&domains.sentinelUid(), domain);
    updateDomainSlot(globalObject);
}

void exitScopedRun(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto& domains = eventLoopDomains(vm);
    ScopedRunEntry entry = domains.runs().takeLast();
    vm.setMicrotaskDrainDomain(&domains.sentinelUid(), entry.outerRunDomain);
    updateDomainSlot(globalObject);
    restoreContext(globalObject, entry.savedContext.get());
}

void drainMicrotasksInDomain(JSGlobalObject* globalObject, uint32_t domain)
{
    VM& vm = globalObject->vm();
    vm.drainMicrotasksInDomain(&eventLoopDomains(vm).sentinelUid(), domain);
}

} // namespace Bun

using namespace JSC;

extern "C" uint32_t Bun__Domain__activeRun(JSGlobalObject* globalObject)
{
    return Bun::activeRunDomain(globalObject);
}

extern "C" uint32_t Bun__Domain__current(JSGlobalObject* globalObject)
{
    return Bun::currentDomain(globalObject);
}

extern "C" uint32_t Bun__Domain__ofCallback(JSGlobalObject* globalObject, EncodedJSValue callback)
{
    return Bun::domainOfCallback(globalObject, JSValue::decode(callback));
}

extern "C" uint32_t Bun__Domain__allocate(JSGlobalObject* globalObject)
{
    return Bun::allocateDomain(globalObject);
}

extern "C" void Bun__Domain__enterRun(JSGlobalObject* globalObject, uint32_t domain)
{
    Bun::enterScopedRun(globalObject, domain);
}

extern "C" void Bun__Domain__exitRun(JSGlobalObject* globalObject)
{
    Bun::exitScopedRun(globalObject);
}

extern "C" void Bun__Domain__drainMicrotasks(JSGlobalObject* globalObject, uint32_t domain)
{
    Bun::drainMicrotasksInDomain(globalObject, domain);
}
