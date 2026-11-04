#include "GlobalHandleRegistry.h"
#include "../V8Isolate.h"
#include "Oddball.h"
#include "StrongRef.h"
#include "ZigGlobalObject.h"
#include <wtf/TZoneMallocInlines.h>

extern "C" bool Bun__thisThreadHasVM();
extern "C" void* Bun__getVM();

namespace v8 {
namespace shim {

using State = GlobalHandleBlock::State;

WTF_MAKE_TZONE_ALLOCATED_IMPL(GlobalHandleRegistry);

GlobalHandleBlock::GlobalHandleBlock(GlobalHandleRegistry& registry, void* bunVM)
    : ownerBunVM(bunVM)
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
        if (!block->hasLiveHandle()) {
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

Handle* GlobalHandleRegistry::takeHandle()
{
    Handle* handle;
    if (!m_free.isEmpty()) {
        handle = m_free.takeLast();
    } else {
        if (m_takenFromLastBlock == GlobalHandleBlock::handleCount) {
            m_blocks.append(new (NotNull, WTF::fastAlignedMalloc(GlobalHandleBlock::size, GlobalHandleBlock::size)) GlobalHandleBlock(*this, m_bunVM));
            m_takenFromLastBlock = 0;
        }
        handle = &m_blocks.last()->handles[m_takenFromLastBlock++];
    }
    auto* block = GlobalHandleBlock::of(handle);
    block->states[block->indexOf(handle)] = State::Live;
    return handle;
}

TaggedPointer* GlobalHandleRegistry::create(Isolate* isolate, TaggedPointer address)
{
    int32_t smi;
    if (address.getSmi(smi)) {
        Handle* handle = takeHandle();
        *handle = Handle(smi);
        return handle->slot();
    }
    auto* layout = address.getPtr<ObjectLayout>();
    const Map* map = layout->map();
    switch (map->m_instanceType) {
    case InstanceType::Oddball: {
        Handle* handle = takeHandle();
        // undefined, null, true or false: the handle holds the word that points at the Oddball of the process, because an Oddball does not fit in a handle.
        *handle->slot() = address;
        return handle->slot();
    }
    case InstanceType::HeapNumber: {
        Handle* handle = takeHandle();
        *handle = Handle(layout->asDouble());
        return handle->slot();
    }
    default: {
        JSC::JSCell* cell = layout->asCell();
        // Before a handle is taken: this can allocate a cell, and then a collection can run a finalizer that disposes a v8::Global.
        auto* root = Bun__StrongRef__new(isolate->globalObject(), JSC::JSValue::encode(cell));
        Handle* handle = takeHandle();
        *handle = Handle(map, cell);
        auto* block = GlobalHandleBlock::of(handle);
        block->extras[block->indexOf(handle)].root = root;
        return handle->slot();
    }
    }
}

// The block of a live handle, and the place of the handle in it, if the Bun VM of this thread owns the block and is not destroyed. Else null.
static GlobalHandleBlock* liveBlockOf(Handle* handle, size_t& index)
{
    auto* block = GlobalHandleBlock::of(handle);
    // A thread has one Bun VM, and the address of a VM is used again only after its registry has set `registry` to null.
    if (block->ownerBunVM != (Bun__thisThreadHasVM() ? Bun__getVM() : nullptr) || !block->registry) {
        return nullptr;
    }
    index = block->indexOf(handle);
    return block->states[index] == State::Live ? block : nullptr;
}

void GlobalHandleRegistry::dispose(Handle* handle)
{
    size_t index;
    auto* block = liveBlockOf(handle, index);
    if (!block) {
        return;
    }
    block->states[index] = State::Disposed;
    auto& registry = *block->registry;
    // Nothing takes the handle again, and its strong root must stay: the block of that root can be dead in the last collection.
    if (Bun__VirtualMachine__isShuttingDown(registry.m_bunVM)) {
        return;
    }
    registry.m_disposed.append(handle);
    registry.m_openScopes &= ~noDisposedHandleWaits;
    // Else a Local of an open scope can point into the handle, and the last scope to close releases it.
    if (!registry.m_openScopes) {
        registry.releaseDisposedHandles();
    }
}

void GlobalHandleRegistry::setWeakParameter(Handle* handle, void* parameter)
{
    size_t index;
    if (auto* block = liveBlockOf(handle, index)) {
        block->extras[index].weakParameter = parameter;
    }
}

void* GlobalHandleRegistry::takeWeakParameter(Handle* handle)
{
    size_t index;
    auto* block = liveBlockOf(handle, index);
    return block ? std::exchange(block->extras[index].weakParameter, nullptr) : nullptr;
}

NEVER_INLINE void GlobalHandleRegistry::releaseDisposedHandles()
{
    ASSERT(!m_openScopes);
    for (Handle* handle : m_disposed) {
        auto* block = GlobalHandleBlock::of(handle);
        size_t index = block->indexOf(handle);
        auto& extra = block->extras[index];
        if (auto* root = std::exchange(extra.root, nullptr)) {
            Bun__StrongRef__delete(root);
        }
        extra.weakParameter = nullptr;
        *handle = Handle();
        block->states[index] = State::Free;
    }
    m_free.appendVector(m_disposed);
    m_disposed.shrink(0);
    m_openScopes = noDisposedHandleWaits;
}

void GlobalHandleRegistry::retireHandlesOfObjects()
{
    // Else a Local can point into a handle. The test runner replaces the global object under no native call.
    ASSERT(m_openScopes == noDisposedHandleWaits);
    if (m_openScopes != noDisposedHandleWaits) {
        return;
    }
    const TaggedPointer undefined(const_cast<Oddball*>(&Oddball::undefined_value()));
    for (GlobalHandleBlock* block : m_blocks) {
        for (size_t index = 0; index < GlobalHandleBlock::handleCount; index++) {
            auto& root = block->extras[index].root;
            Handle& handle = block->handles[index];
            // A string, a symbol and a BigInt belong to no realm, so the handle of one keeps it.
            if (block->states[index] != State::Live || !root || !handle.m_object.asCell()->isObject()) {
                continue;
            }
            Bun__StrongRef__delete(std::exchange(root, nullptr));
            handle = Handle();
            *handle.slot() = undefined;
        }
    }
}

} // namespace shim
} // namespace v8

// VirtualMachine::swap_global_for_test_isolation calls this once it has replaced the global object of a finished file.
extern "C" void V8GlobalHandleRegistry__retireHandlesOfObjects(JSC::JSGlobalObject* globalObject)
{
    if (auto* registry = v8::shim::GlobalHandleRegistry::ifExists(JSC::getVM(globalObject))) {
        registry->retireHandlesOfObjects();
    }
}
