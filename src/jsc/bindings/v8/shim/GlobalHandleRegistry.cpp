#include "GlobalHandleRegistry.h"
#include "GlobalInternals.h"
#include "HandleScopeBuffer.h"
#include "StrongRef.h"
#include "ZigGlobalObject.h"
#include "napi_handle_scope.h"
#include "real_v8.h"
#include <wtf/TZoneMallocInlines.h>

namespace v8 {
namespace shim {

using State = GlobalHandle::State;
using Internals = real_v8::internal::Internals;

static_assert(offsetof(GlobalHandle, toV8Object) == 0);
static_assert(offsetof(GlobalHandle, classId) == Internals::kNodeClassIdOffset);
static_assert(offsetof(GlobalHandle, flags) == Internals::kNodeFlagsOffset);
static_assert(GlobalHandle::stateMask == Internals::kNodeStateMask);
static_assert(static_cast<int>(State::Weak) == Internals::kNodeStateIsWeakValue);

WTF_MAKE_TZONE_ALLOCATED_IMPL(GlobalHandleRegistry);

GlobalHandleBlock::GlobalHandleBlock(GlobalHandleRegistry& registry)
    : ownerThread(std::this_thread::get_id())
    , registry(&registry)
    , extras(static_cast<Extra*>(WTF::fastZeroedMalloc(sizeof(Extra) * handleCount)))
{
}

GlobalHandleRegistry::GlobalHandleRegistry(JSC::VM& vm)
    : m_bunVM(bunVM(vm))
{
}

// A v8::Global must not be read once its VM has ended, as in V8. Only Reset(), SetWeak() and ClearWeak() of it are safe.
GlobalHandleRegistry::~GlobalHandleRegistry()
{
    for (GlobalHandleBlock* block : m_blocks) {
        WTF::fastFree(block->extras);
        if (!block->hasHandleInUse()) {
            WTF::fastFree(block);
            continue;
        }
        // A v8::Global that outlives this VM points into the block, so a later Reset() of it reads valid memory and no later handle gets its address.
        block->registry = nullptr;
        block->extras = nullptr;
    }
}

GlobalHandleRegistry& GlobalHandleRegistry::ensure(JSC::VM& vm)
{
    auto& registry = WebCore::clientData(vm)->v8GlobalHandleRegistry;
    if (!registry) {
        registry = makeUnique<GlobalHandleRegistry>(vm);
    }
    return *registry;
}

void GlobalHandleRegistry::addRealm(GlobalInternals* internals)
{
    m_realms.removeAllMatching([](auto& realm) {
        return !realm;
    });
    m_realms.append(JSC::Weak<GlobalInternals>(internals));
    internals->setHasDisposedGlobalHandles(m_realmsHaveDisposedHandles);
}

GlobalHandle* GlobalHandleRegistry::takeHandle()
{
    GlobalHandle* handle;
    if (!m_free.isEmpty()) {
        handle = m_free.takeLast();
    } else {
        if (m_takenFromLastBlock == GlobalHandleBlock::handleCount) {
            m_blocks.append(new (NotNull, WTF::fastAlignedMalloc(GlobalHandleBlock::size, GlobalHandleBlock::size)) GlobalHandleBlock(*this));
            m_takenFromLastBlock = 0;
        }
        handle = &m_blocks.last()->handles[m_takenFromLastBlock++];
    }
    handle->setState(State::Normal);
    return handle;
}

TaggedPointer* GlobalHandleRegistry::create(Isolate* isolate, TaggedPointer address)
{
    int32_t smi;
    if (address.getSmi(smi)) {
        GlobalHandle* handle = takeHandle();
        handle->setSmi(smi);
        return handle->slot();
    }
    auto* layout = address.getPtr<ObjectLayout>();
    const Map* map = layout->map();
    switch (map->m_instanceType) {
    case InstanceType::Oddball: {
        GlobalHandle* handle = takeHandle();
        // undefined, null, true or false: the handle holds the word that points at the root of the isolate.
        handle->setOddballWord(address);
        return handle->slot();
    }
    case InstanceType::HeapNumber: {
        GlobalHandle* handle = takeHandle();
        handle->setLayout(ObjectLayout(layout->asDouble()));
        return handle->slot();
    }
    default: {
        JSC::JSCell* cell = layout->asCell();
        // Before a handle is taken: this can allocate a cell, and then a collection can run a finalizer that disposes a v8::Global.
        auto* root = Bun__StrongRef__new(isolate->globalObject(), JSC::JSValue::encode(cell));
        GlobalHandle* handle = takeHandle();
        handle->setLayout(ObjectLayout(map, cell));
        auto* block = GlobalHandleBlock::of(handle);
        block->extras[block->indexOf(handle)].root = root;
        return handle->slot();
    }
    }
}

// The block of a handle in use of a VM of this thread that is not destroyed, and the place of the handle in it. Else null.
static GlobalHandleBlock* blockOfHandleInUse(GlobalHandle* handle, size_t& index)
{
    auto* block = GlobalHandleBlock::of(handle);
    // The id is enough to tell the thread of the VM: an id is used again only after its thread has ended, and the VM of that thread has set `registry` to null before.
    if (block->ownerThread != std::this_thread::get_id() || !block->registry) {
        return nullptr;
    }
    index = block->indexOf(handle);
    return handle->state() != State::Free ? block : nullptr;
}

void GlobalHandleRegistry::dispose(GlobalHandle* handle)
{
    size_t index;
    auto* block = blockOfHandleInUse(handle, index);
    if (!block) {
        return;
    }
    handle->setState(State::Free);
    auto& registry = *block->registry;
    // Nothing takes the handle again, and its strong root must stay: the block of that root can be dead in the last collection.
    if (Bun__VirtualMachine__isShuttingDown(registry.m_bunVM)) {
        return;
    }
    registry.m_disposed.append(handle);
    // Else earlier handles wait too, and the scope that releases them releases this one.
    if (!registry.m_realmsHaveDisposedHandles) {
        registry.releaseDisposedHandles();
    }
}

void GlobalHandleRegistry::makeWeak(GlobalHandle* handle, void* parameter)
{
    size_t index;
    if (auto* block = blockOfHandleInUse(handle, index)) {
        block->extras[index].weakParameter = parameter;
        handle->setState(State::Weak);
    }
}

void* GlobalHandleRegistry::clearWeak(GlobalHandle* handle)
{
    size_t index;
    auto* block = blockOfHandleInUse(handle, index);
    if (!block) {
        return nullptr;
    }
    handle->setState(State::Normal);
    return std::exchange(block->extras[index].weakParameter, nullptr);
}

NEVER_INLINE void GlobalHandleRegistry::didCloseScope(JSC::VM& vm)
{
    ifExists(vm)->releaseDisposedHandles();
}

void GlobalHandleRegistry::releaseDisposedHandles()
{
    if (!m_disposed.isEmpty() && !hasOpenScopeWithV8Handles()) {
        for (GlobalHandle* handle : m_disposed) {
            auto* block = GlobalHandleBlock::of(handle);
            auto& extra = block->extras[block->indexOf(handle)];
            if (auto* root = std::exchange(extra.root, nullptr)) {
                Bun__StrongRef__delete(root);
            }
            extra.weakParameter = nullptr;
            // The next v8::Global that takes the handle starts with the class id 0, as in V8.
            handle->clear();
        }
        m_free.appendVector(m_disposed);
        m_disposed.shrink(0);
    }
    // Each realm has a copy, so that HandleScopeBuffer::close() reads one byte of its own realm.
    bool hasDisposedHandles = !m_disposed.isEmpty();
    if (hasDisposedHandles == m_realmsHaveDisposedHandles) {
        return;
    }
    m_realmsHaveDisposedHandles = hasDisposedHandles;
    for (auto& realm : m_realms) {
        if (auto* internals = realm.get()) {
            internals->setHasDisposedGlobalHandles(hasDisposedHandles);
        }
    }
}

// Whether a realm of the VM has an open scope with V8 handles. A Local of it can point into a disposed handle.
bool GlobalHandleRegistry::hasOpenScopeWithV8Handles() const
{
    for (auto& realm : m_realms) {
        auto* internals = realm.get();
        if (!internals) {
            continue;
        }
        for (auto* scope = internals->isolate()->globalObject()->m_currentHandleScopeImpl.get(); scope; scope = scope->parent()) {
            if (scope->v8Handles()) {
                return true;
            }
        }
    }
    return false;
}

} // namespace shim
} // namespace v8
