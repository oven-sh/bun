#pragma once

// Allocation and collection.

#include "engine/api/ClassInfo.h"

namespace Engine {

struct SizeClasses {
    constexpr SizeClasses()
    {
        using namespace Layout;
        size_t count = 0;
        for (size_t size = atomSize; size <= largeCutoff;) {
            if (size > exactSizeCutoff)
                size = blockPayloadSize / (blockPayloadSize / size) / atomSize * atomSize;
            sizes[count++] = size;
            checksum += count * size;
            if (size < exactSizeCutoff)
                size += atomSize;
            else if (size < largeCutoff && size * 5 / 4 > largeCutoff)
                size = largeCutoff;
            else
                size = (size * 5 / 4 + atomSize - 1) / atomSize * atomSize;
        }
    }

    constexpr size_t indexFor(size_t size) const
    {
        size_t index = 0;
        while (sizes[index] < size)
            index++;
        return index;
    }

    size_t sizes[Layout::sizeClassCount] {};
    size_t checksum { 0 };
};
inline constexpr SizeClasses sizeClasses;
static_assert(sizeClasses.checksum == Layout::sizeClassChecksum);

struct HeapSizes {
    size_t beforeLastEden, afterLastEden, beforeLastFull, afterLastFull, afterLast;
};
ENGINE_CHECK_SIZE(HeapSizes, sizeOfHeapSizes);
ENGINE_CHECK_OFFSET(HeapSizes, afterLastEden, HeapSizes_after_last_eden);
ENGINE_CHECK_OFFSET(HeapSizes, beforeLastFull, HeapSizes_before_last_full);
ENGINE_CHECK_OFFSET(HeapSizes, afterLastFull, HeapSizes_after_last_full);

struct HeapObserver {
    void (*willCollect)(const HeapObserver&);
    void (*didCollect)(const HeapObserver&, JSC::CollectionScope);
};
ENGINE_CHECK_SIZE(HeapObserver, sizeOfHeapObserver);
ENGINE_CHECK_OFFSET(HeapObserver, didCollect, HeapObserver_did_collect);

} // namespace Engine

namespace JSC {

enum Synchronousness { Async,
    Sync };
enum DeleteAllCodeEffort { PreventCollectionAndDeleteAllCode,
    DeleteAllCodeIfNotCollecting };
enum class ConstraintVolatility { GreyedByExecution,
    GreyedByMarking };
enum class MutatorState : uint8_t {
    Running = Engine::MutatorState::Running,
    Sweeping = Engine::MutatorState::Sweeping,
    Collecting = Engine::MutatorState::Collecting,
};

struct MarkedSpace {
    static constexpr size_t largeCutoff = Engine::Layout::largeCutoff;
};

// Hands out cells of one size and kind.
class IsoSubspace {
    WTF_MAKE_NONCOPYABLE(IsoSubspace);

public:
    ALWAYS_INLINE void* allocate(Heap& heap, size_t size)
    {
        ASSERT_UNUSED(size, size <= m_cellSize);
#if !ASSERT_ENABLED
        uintptr_t cell = m_start;
        if (cell < m_end) [[likely]] {
            m_start = cell + m_cellSize;
            return reinterpret_cast<void*>(cell);
        }
#endif
        return Engine::allocator_allocate(*this, heap);
    }

private:
    friend class Heap;

    uintptr_t m_start;
    uintptr_t m_end;
    uint32_t m_cellSize;
    Engine::Opaque<44> m_rest;
};

// Cells of one kind and any size.
class CompleteSubspace {
    WTF_MAKE_NONCOPYABLE(CompleteSubspace);

public:
    template<size_t size> IsoSubspace& allocatorFor()
    {
        static_assert(size <= MarkedSpace::largeCutoff);
        constexpr size_t index = Engine::sizeClasses.indexFor(size);
        return m_allocators[index];
    }
    IsoSubspace& allocatorFor(size_t size) { return m_allocators[Engine::sizeClasses.indexFor(size)]; }

    ALWAYS_INLINE void* allocate(Heap& heap, size_t size)
    {
        if (__builtin_constant_p(size) && size <= Engine::Layout::exactSizeCutoff)
            return m_allocators[(size - 1) / Engine::Layout::atomSize].allocate(heap, size);
        void* cell = Engine::space_try_allocate(*this, heap, size);
        RELEASE_ASSERT(cell);
        return cell;
    }

private:
    IsoSubspace m_allocators[Engine::Layout::sizeClassCount];
};

class HeapObserver {
public:
    virtual ~HeapObserver() = default;
    virtual void willGarbageCollect() = 0;
    virtual void didGarbageCollect(CollectionScope) = 0;

private:
    friend class Heap;

    static HeapObserver& from(const Engine::HeapObserver& callbacks) { return Engine::fieldAt<HeapObserver>(&callbacks, -OBJECT_OFFSETOF(HeapObserver, m_callbacks)); }

    const Engine::HeapObserver m_callbacks {
        [](const Engine::HeapObserver& callbacks) { from(callbacks).willGarbageCollect(); },
        [](const Engine::HeapObserver& callbacks, CollectionScope scope) { from(callbacks).didGarbageCollect(scope); },
    };
};

// Roots that only the embedder knows.
class MarkingConstraint {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(MarkingConstraint);

public:
    MarkingConstraint(ASCIILiteral, ASCIILiteral, ConstraintVolatility volatility)
        : m_volatility(volatility)
    {
    }
    virtual ~MarkingConstraint() = default;
    virtual void executeImpl(SlotVisitor&) = 0;

    ConstraintVolatility volatility() const { return m_volatility; }

private:
    ConstraintVolatility m_volatility;
};

class SimpleMarkingConstraint final : public MarkingConstraint {
public:
    SimpleMarkingConstraint(ASCIILiteral abbreviatedName, ASCIILiteral name, Function<void(SlotVisitor&)>&& execute, ConstraintVolatility volatility)
        : MarkingConstraint(abbreviatedName, name, volatility)
        , m_execute(WTF::move(execute))
    {
    }

private:
    void executeImpl(SlotVisitor& visitor) final { m_execute(visitor); }

    Function<void(SlotVisitor&)> m_execute;
};

#define MAKE_MARKING_CONSTRAINT_EXECUTOR_PAIR(lambda) WTF::Function<void(JSC::SlotVisitor&)>(lambda)

struct GCRequest {
    GCRequest() = default;
    GCRequest(CollectionScope scope)
        : scope(scope)
    {
    }

    std::optional<CollectionScope> scope;
    bool isIdle { false };
    RefPtr<SharedTask<void()>> didFinishEndPhase;
};

using TypeCountSet = HashCountedSet<ASCIILiteral>;

class Heap {
    WTF_MAKE_NONCOPYABLE(Heap);

public:
    using LambdaFinalizer = Function<void(JSCell*)>;

    VM& vm() const { return Engine::fieldAt<VM>(this, -Engine::Layout::Vm_heap); }

    uint32_t barrierThreshold() const { return m_barrierThreshold; }
    bool mutatorShouldBeFenced() const { return m_mutatorShouldBeFenced; }
    MutatorState mutatorState() const { return m_mutatorState; }
    std::optional<CollectionScope> collectionScope() const
    {
        CollectionScope scope;
        return Engine::heap_collection_scope(*this, scope) ? std::optional(scope) : std::nullopt;
    }

    // Nothing may be allocated meanwhile.
    void setIsConstructingCell([[maybe_unused]] bool value)
    {
#if ASSERT_ENABLED
        m_isConstructingCell = value;
#endif
    }

    CompleteSubspace& cellSpace() { return m_cells; }
    CompleteSubspace& destructibleObjectSpace() { return m_destructibleObjects; }
    // The heap owns it. With output constraints, each collection calls visitOutputConstraints() of the cells that it has not visited.
    IsoSubspace& createIsoSubspace(size_t cellSize, void (*destroy)(JSCell*), bool hasOutputConstraints) { return *Engine::heap_create_iso_space(*this, cellSize, destroy, hasOutputConstraints); }

    void stopIfNecessary() { Engine::heap_collect_if_necessary(*this); }

    void collectSync(GCRequest = {});
    void collectAsync(GCRequest = {});
    void collectNow(Synchronousness, GCRequest = {});
    void deleteAllUnlinkedCodeBlocks(DeleteAllCodeEffort) { Engine::vm_delete_unlinked_code(vm()); }
    void reportAbandonedObjectGraph() { Engine::heap_report_abandoned_object_graph(*this); }
    void setInitialAllocationBudget(size_t bytes) { Engine::heap_set_initial_allocation_budget(*this, bytes); }

    void reportExtraMemoryAllocated(const JSCell* cell, size_t bytes) { Engine::heap_report_extra_memory_allocated(*this, cell, bytes); }
    void deprecatedReportExtraMemory(size_t bytes) { Engine::heap_report_untracked_extra_memory(*this, bytes); }

    void addFinalizer(JSCell*, LambdaFinalizer);
    void addMarkingConstraint(std::unique_ptr<MarkingConstraint>);
    void addObserver(HeapObserver* observer) { Engine::heap_add_observer(*this, observer->m_callbacks); }
    void removeObserver(HeapObserver* observer) { Engine::heap_remove_observer(*this, observer->m_callbacks); }
    void protect(JSValue value) { Engine::heap_protect(*this, value); }
    bool unprotect(JSValue value) { return Engine::heap_unprotect(*this, value); }

    size_t size() { return Engine::heap_size(*this); }
    size_t capacity() { return Engine::heap_capacity(*this); }
    size_t objectCount() { return Engine::heap_object_count(*this); }
    size_t blockBytesAllocated() const { return Engine::heap_block_bytes(*this); }
    size_t extraMemorySize() { return Engine::heap_extra_memory_size(*this); }
    size_t externalMemorySize() { return 0; }
    size_t arrayBufferSize() const { return Engine::heap_array_buffer_size(*this); }
    size_t sizeBeforeLastEdenCollection() const { return sizes().beforeLastEden; }
    size_t sizeAfterLastEdenCollection() const { return sizes().afterLastEden; }
    size_t sizeBeforeLastFullCollection() const { return sizes().beforeLastFull; }
    size_t sizeAfterLastFullCollection() const { return sizes().afterLastFull; }
    size_t globalObjectCount();
    size_t protectedObjectCount();
    size_t protectedGlobalObjectCount();
    TypeCountSet objectTypeCounts();
    TypeCountSet protectedObjectTypeCounts();
    // What these two count it as.
    static ASCIILiteral typeName(JSCell* cell) { return ASCIILiteral::fromLiteralUnsafe(Engine::heap_counted_name(cell)); }

    template<typename Functor> void forEachProtectedCell(const Functor& functor)
    {
        Engine::heap_for_each_protected_cell(*this, &functor, [](const void* context, JSCell* cell) { (*static_cast<const Functor*>(context))(cell); });
    }

    // The functor does not allocate.
    template<typename Functor> void forEachLiveCell(const Functor& functor)
    {
        Engine::heap_for_each_live_cell(*this, &functor, [](const void* context, JSCell* cell) { (*static_cast<const Functor*>(context))(cell); });
    }

private:
    friend class DeferGC;

    Engine::HeapSizes sizes() const
    {
        Engine::HeapSizes sizes;
        Engine::heap_sizes(*this, sizes);
        return sizes;
    }

    static void checkLayout();

    uint32_t m_barrierThreshold;
    bool m_mutatorShouldBeFenced;
    MutatorState m_mutatorState;
    bool m_didDeferCollection;
    bool m_isConstructingCell;
    uint32_t m_deferralDepth;
    IsoSubspace m_strings;
    IsoSubspace m_ropeStrings;
    IsoSubspace m_structures;
    CompleteSubspace m_cells;
    CompleteSubspace m_auxiliary;
    CompleteSubspace m_destructibleObjects;
    Engine::Opaque<Engine::Layout::heapSize - Engine::Layout::Heap_destructible_objects - Engine::Layout::sizeOfSpace> m_rest;
};

inline void Heap::checkLayout()
{
    ENGINE_CHECK_SIZE(IsoSubspace, sizeOfAllocator);
    ENGINE_CHECK_OFFSET(IsoSubspace, m_start, Allocator_start);
    ENGINE_CHECK_OFFSET(IsoSubspace, m_end, Allocator_end);
    ENGINE_CHECK_OFFSET(IsoSubspace, m_cellSize, Allocator_cell_size);
    ENGINE_CHECK_SIZE(Heap, heapSize);
    ENGINE_CHECK_OFFSET(Heap, m_barrierThreshold, Heap_barrier_threshold);
    ENGINE_CHECK_OFFSET(Heap, m_mutatorShouldBeFenced, Heap_mutator_should_be_fenced);
    ENGINE_CHECK_OFFSET(Heap, m_mutatorState, Heap_state);
    ENGINE_CHECK_OFFSET(Heap, m_didDeferCollection, Heap_did_defer_collection);
    ENGINE_CHECK_OFFSET(Heap, m_isConstructingCell, Heap_is_constructing_cell);
    ENGINE_CHECK_OFFSET(Heap, m_deferralDepth, Heap_deferral_depth);
    ENGINE_CHECK_OFFSET(Heap, m_strings, Heap_strings);
    ENGINE_CHECK_OFFSET(Heap, m_ropeStrings, Heap_rope_strings);
    ENGINE_CHECK_OFFSET(Heap, m_cells, Heap_cells);
    ENGINE_CHECK_OFFSET(Heap, m_auxiliary, Heap_auxiliary);
    ENGINE_CHECK_OFFSET(Heap, m_destructibleObjects, Heap_destructible_objects);
}

inline void gcProtect(JSCell* cell) { cell->heap()->protect(cell); }
inline void gcUnprotect(JSCell* cell) { cell->heap()->unprotect(cell); }

class HeapAnalyzer {
public:
    void analyzePropertyNameEdge(JSCell* from, JSCell* to, UniquedStringImpl* name) { Engine::analyzer_property_edge(*this, from, to, name); }
    void analyzeIndexEdge(JSCell* from, JSCell* to, uint32_t index) { Engine::analyzer_index_edge(*this, from, to, index); }
    void setLabelForCell(JSCell* cell, const String& label) { Engine::analyzer_label(*this, cell, label); }
    void setWrappedObjectForCell(JSCell* cell, void* wrapped) { Engine::analyzer_wrapped_object(*this, cell, wrapped); }
};

} // namespace JSC
