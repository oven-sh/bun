#include "engine/Engine.h"

namespace JSC {

static const CollectionScope* scopeOf(const GCRequest& request)
{
    return request.scope ? &*request.scope : nullptr;
}

void Heap::collectSync(GCRequest request)
{
    ASSERT(!request.isIdle && !request.didFinishEndPhase);
    Engine::heap_collect(*this, scopeOf(request));
}

void Heap::collectAsync(GCRequest request)
{
    void (*didFinish)(void*) = [](void* task) { adoptRef(*static_cast<SharedTask<void()>*>(task))->run(); };
    auto* task = request.didFinishEndPhase.leakRef();
    Engine::heap_request_collection(*this, scopeOf(request), request.isIdle, task ? didFinish : nullptr, task);
}

void Heap::collectNow(Synchronousness synchronousness, GCRequest request)
{
    if (synchronousness == Async)
        return collectAsync(WTF::move(request));
    Engine::heap_collect_and_sweep(*this, scopeOf(request));
}

void Heap::addFinalizer(JSCell* cell, LambdaFinalizer finalizer)
{
    auto call = [](JSCell* cell, void* context) { (*std::unique_ptr<LambdaFinalizer>(static_cast<LambdaFinalizer*>(context)))(cell); };
    Engine::heap_add_finalizer(*this, cell, call, new LambdaFinalizer(WTF::move(finalizer)));
}

void Heap::addMarkingConstraint(std::unique_ptr<MarkingConstraint> constraint)
{
    auto execute = [](void* context, AbstractSlotVisitor* visitor) { static_cast<MarkingConstraint*>(context)->executeImpl(static_cast<SlotVisitor&>(*visitor)); };
    auto destroy = [](void* context) { delete static_cast<MarkingConstraint*>(context); };
    bool dependsOnMarking = constraint->volatility() == ConstraintVolatility::GreyedByMarking;
    Engine::heap_add_marking_constraint(*this, execute, destroy, constraint.release(), dependsOnMarking);
}

size_t Heap::globalObjectCount()
{
    size_t count = 0;
    forEachLiveCell([&](JSCell* cell) { count += cell->type() == GlobalObjectType; });
    return count;
}

size_t Heap::protectedObjectCount()
{
    size_t count = 0;
    forEachProtectedCell([&](JSCell*) { count++; });
    return count;
}

size_t Heap::protectedGlobalObjectCount()
{
    size_t count = 0;
    forEachProtectedCell([&](JSCell* cell) { count += cell->type() == GlobalObjectType; });
    return count;
}

} // namespace JSC
