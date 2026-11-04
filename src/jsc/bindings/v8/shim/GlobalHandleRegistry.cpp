#include "GlobalHandleRegistry.h"
#include "EventLoopTask.h"
#include "GlobalInternals.h"
#include "HandleScopeBuffer.h"
#include "InternalFieldObject.h"
#include "Oddball.h"
#include "StrongRef.h"
#include "ZigGlobalObject.h"
#include "napi_handle_scope.h"
#include "real_v8.h"
#include <JavaScriptCore/CollectingScope.h>
#include <JavaScriptCore/GCCompletionCallback.h>
#include <JavaScriptCore/HeapInlines.h>
#include <wtf/SetForScope.h>
#include <wtf/TZoneMallocInlines.h>

extern "C" void Bun__VM__queueTask(void* bunVM, WebCore::EventLoopTask*);
// Counts the collections after which a first-pass callback ran, for crash reports (src/analytics/lib.rs).
extern "C" size_t Bun__Feature__v8_weak_callback;

namespace v8 {
namespace shim {

using State = GlobalHandle::State;
using Internals = real_v8::internal::Internals;

static_assert(offsetof(GlobalHandle, toV8Object) == 0);
static_assert(offsetof(GlobalHandle, classId) == Internals::kNodeClassIdOffset);
static_assert(offsetof(GlobalHandle, flags) == Internals::kNodeFlagsOffset);
static_assert(GlobalHandle::stateMask == Internals::kNodeStateMask);
static_assert(static_cast<int>(State::Weak) == Internals::kNodeStateIsWeakValue);
static_assert(sizeof(std::atomic<uint8_t>) == 1 && std::atomic<uint8_t>::is_always_lock_free);

WTF_MAKE_TZONE_ALLOCATED_IMPL(GlobalHandleRegistry);

// What a handle reads as once its value is dead. V8 leaves an address that nothing can read (https://github.com/nodejs/node/blob/v26.12.1/deps/v8/src/handles/global-handles.cc#L551-L552).
static TaggedPointer wordOfDeadValue()
{
    static Oddball undefined(Oddball::Kind::kUndefined);
    return TaggedPointer(&undefined);
}

GlobalHandleBlock::GlobalHandleBlock(GlobalHandleRegistry& registry)
    : ownerThread(std::this_thread::get_id())
    , registry(&registry)
    , roots(static_cast<Bun::StrongRefImpl**>(WTF::fastZeroedMalloc(sizeof(Bun::StrongRefImpl*) * handleCount)))
{
}

GlobalHandleRegistry::GlobalHandleRegistry(JSC::VM& vm)
    : m_vm(vm)
    , m_bunVM(bunVM(vm))
{
    // In the epilogue of each collection, on the JS thread. The registry outlives the heap.
    vm.heap.addGCCompletionCallback(JSC::GCCompletionCallback(
        [](JSContextGroupRef, void* registry) {
            auto* self = static_cast<GlobalHandleRegistry*>(registry);
            if (!self->m_dying.isEmpty()) [[unlikely]] {
                self->runFirstPasses();
            }
        },
        this));
}

// A v8::Global must not be read once its VM has ended, as in V8. Only Reset(), SetWeak() and ClearWeak() of it are safe.
GlobalHandleRegistry::~GlobalHandleRegistry()
{
    for (GlobalHandleBlock* block : m_blocks) {
        WTF::fastFree(block->roots);
        if (!block->hasHandleInUse()) {
            WTF::fastFree(block);
            continue;
        }
        // A v8::Global that outlives this VM points into the block, so a later Reset() of it reads valid memory and no later handle gets its address.
        block->registry = nullptr;
        block->roots = nullptr;
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

bool GlobalHandleRegistry::isShuttingDown() const
{
    return Bun__VirtualMachine__isShuttingDown(m_bunVM);
}

GlobalHandle* GlobalHandleRegistry::takeHandle()
{
    GlobalHandle* handle;
    if (!m_free.isEmpty()) {
        handle = m_free.takeLast();
    } else {
        if (m_takenFromLastBlock == GlobalHandleBlock::handleCount) {
            auto* block = new (NotNull, WTF::fastAlignedMalloc(GlobalHandleBlock::size, GlobalHandleBlock::size)) GlobalHandleBlock(*this);
            m_blocks.append(block);
            if (m_hasBlockSet) {
                m_blockSet.add(block);
            }
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
        // Before takeHandle(): this can allocate a cell, and a collection can run a weak callback that disposes a v8::Global.
        auto* root = Bun__StrongRef__new(isolate->globalObject(), JSC::JSValue::encode(cell));
        GlobalHandle* handle = takeHandle();
        handle->setLayout(ObjectLayout(map, cell));
        auto* block = GlobalHandleBlock::of(handle);
        block->roots[block->indexOf(handle)] = root;
        return handle->slot();
    }
    }
}

// The block of a handle of a VM of this thread that is not destroyed, and the place of the handle in it. Else null.
static GlobalHandleBlock* blockOfThisThread(GlobalHandle* handle, size_t& index)
{
    auto* block = GlobalHandleBlock::of(handle);
    // The id is enough to tell the thread of the VM: an id is used again only after its thread has ended, and the VM of that thread has set `registry` to null before.
    if (block->ownerThread != std::this_thread::get_id() || !block->registry) {
        return nullptr;
    }
    index = block->indexOf(handle);
    return block;
}

WeakGlobalHandle& GlobalHandleRegistry::weakEntryOf(GlobalHandle* handle)
{
    ASSERT(handle->state() == State::Weak);
    auto& list = handle->flags & GlobalHandle::youngFlag ? m_youngWeak : m_oldWeak;
    ASSERT(list[handle->index].handle == handle);
    return list[handle->index];
}

void GlobalHandleRegistry::removeWeak(GlobalHandle* handle)
{
    auto& list = handle->flags & GlobalHandle::youngFlag ? m_youngWeak : m_oldWeak;
    size_t index = handle->index;
    ASSERT(list[index].handle == handle);
    if (index != list.size() - 1) {
        list[index] = list.last();
        list[index].handle->index = index;
    }
    list.removeLast();
}

void GlobalHandleRegistry::makeStrong(GlobalHandle* handle, Bun::StrongRefImpl* root, bool rootCell)
{
    removeWeak(handle);
    if (rootCell) {
        if (JSC::JSCell* cell = handle->cell()) {
            Bun__StrongRef__write(root, JSC::JSValue::encode(cell));
        }
    }
    handle->flags &= ~(GlobalHandle::internalFieldsFlag | GlobalHandle::youngFlag);
    handle->setState(State::Normal);
}

// IsWeak() is false from here, as in V8 (https://github.com/nodejs/node/blob/v26.12.1/deps/v8/src/handles/global-handles.cc#L557-L558).
void GlobalHandleRegistry::makeDead(GlobalHandle* handle)
{
    handle->flags &= ~(GlobalHandle::internalFieldsFlag | GlobalHandle::youngFlag);
    handle->setState(State::NearDeath);
    handle->setOddballWord(wordOfDeadValue());
}

void GlobalHandleRegistry::release(GlobalHandle* handle)
{
    auto* block = GlobalHandleBlock::of(handle);
    if (auto* root = std::exchange(block->roots[block->indexOf(handle)], nullptr)) {
        Bun__StrongRef__delete(root);
    }
    // The next v8::Global that takes the handle starts with the class id 0, as in V8.
    handle->clear();
    m_free.append(handle);
}

void GlobalHandleRegistry::dispose(GlobalHandle* handle)
{
    size_t index;
    auto* block = blockOfThisThread(handle, index);
    if (!block) {
        // V8's inline Reset() has emptied the v8::Global, so its weak callback must not run. V8 frees the handle on any thread (https://github.com/nodejs/node/blob/v26.12.1/deps/v8/src/handles/global-handles.cc#L662-L666).
        if (GlobalHandleBlock::of(handle)->ownerThread != std::this_thread::get_id()) {
            handle->offThread.fetch_or(GlobalHandle::resetOffThread, std::memory_order_relaxed);
        }
        return;
    }
    auto& registry = *block->registry;
    // Once the Bun VM is shutting down, no root is written or deleted: the block of a root can be dead in the last collection. Nothing takes the handle again.
    bool isShuttingDown = registry.isShuttingDown();
    switch (handle->state()) {
    case State::Free:
        return;
    case State::Normal:
        break;
    case State::Weak:
        // No callback runs for a handle that is reset. A Local of an open scope can point into it, so the root holds the value again.
        registry.makeStrong(handle, block->roots[index], !isShuttingDown);
        break;
    case State::NearDeath:
        // The callback still runs, as in V8. No Local points into the handle, because such a Local keeps the value alive. So the handle does not wait for the open scopes.
        if (auto* dying = registry.dyingEntryOf(handle)) {
            dying->handle = nullptr;
        }
        handle->setState(State::Free);
        if (!isShuttingDown) {
            registry.release(handle);
        }
        return;
    }
    handle->setState(State::Free);
    if (isShuttingDown) {
        return;
    }
    registry.m_disposed.append(handle);
    // Else earlier handles wait too, and the scope that releases them releases this one.
    if (!registry.m_realmsHaveDisposedHandles) {
        registry.releaseDisposedHandles();
    }
}

void GlobalHandleRegistry::makeWeak(GlobalHandle* handle, void* parameter, WeakCallbackInfo<void>::Callback callback, WeakCallbackType type)
{
    size_t index;
    auto* block = blockOfThisThread(handle, index);
    if (!block) {
        return;
    }
    auto& registry = *block->registry;
    switch (handle->state()) {
    case State::Free:
    // What the first-pass callback gets was copied when the value died.
    case State::NearDeath:
        return;
    case State::Weak: {
        // A second SetWeak() replaces the parameter and the callback of the first.
        auto& weak = registry.weakEntryOf(handle);
        weak.callback = callback;
        weak.parameter = parameter;
        break;
    }
    case State::Normal:
        if (!registry.m_hasBlockSet) [[unlikely]] {
            registry.m_hasBlockSet = true;
            registry.m_blockSet.addAll(registry.m_blocks);
        }
        handle->setState(State::Weak);
        handle->flags |= GlobalHandle::youngFlag;
        // What another thread left here was for an earlier v8::Global of the handle.
        handle->offThread.store(0, std::memory_order_relaxed);
        handle->index = registry.m_youngWeak.size();
        registry.m_youngWeak.append({ handle, callback, parameter });
        // A handle without a cell has no root, and never dies.
        if (handle->cell() && !registry.isShuttingDown()) {
            Bun__StrongRef__write(block->roots[index], JSC::JSValue::encode(JSC::JSValue()));
        }
        break;
    }
    if (type == WeakCallbackType::kInternalFields) {
        handle->flags |= GlobalHandle::internalFieldsFlag;
    } else {
        handle->flags &= ~GlobalHandle::internalFieldsFlag;
    }
    // SetWeak() without a callback has given the address of the v8::Global again.
    if (!callback) {
        handle->offThread.fetch_and(static_cast<uint8_t>(~GlobalHandle::movedOffThread), std::memory_order_relaxed);
    }
}

void* GlobalHandleRegistry::clearWeak(GlobalHandle* handle)
{
    size_t index;
    auto* block = blockOfThisThread(handle, index);
    if (!block) {
        return nullptr;
    }
    auto& registry = *block->registry;
    switch (handle->state()) {
    case State::Free:
    case State::Normal:
        return nullptr;
    case State::NearDeath: {
        // node::ObjectWrap's destructor calls this and then Reset(), also in a weak callback that did not reset the handle first.
        auto* dying = registry.dyingEntryOf(handle);
        return dying ? dying->parameter : nullptr;
    }
    case State::Weak:
        break;
    }
    void* parameter = registry.weakEntryOf(handle).parameter;
    registry.makeStrong(handle, block->roots[index], !registry.isShuttingDown());
    return parameter;
}

// Null once the callback of the handle was dropped (didRetireDefaultRealm(), or the VM is shutting down), or has run.
GlobalHandleRegistry::DyingHandle* GlobalHandleRegistry::dyingEntryOf(GlobalHandle* handle)
{
    ASSERT(handle->state() == State::NearDeath);
    if (handle->index < m_dying.size() && m_dying[handle->index].handle == handle) {
        return &m_dying[handle->index];
    }
    return nullptr;
}

// A weak handle without a callback has the address of its v8::Global, which is emptied when the value dies.
void GlobalHandleRegistry::didMove(uintptr_t** from, uintptr_t** to)
{
    auto* handle = reinterpret_cast<GlobalHandle*>(*to);
    size_t index;
    auto* block = blockOfThisThread(handle, index);
    if (!block) {
        // The address in the weak entry is stale, and only the thread of the VM can write the entry.
        if (GlobalHandleBlock::of(handle)->ownerThread != std::this_thread::get_id()) {
            handle->offThread.fetch_or(GlobalHandle::movedOffThread, std::memory_order_relaxed);
        }
        return;
    }
    switch (handle->state()) {
    case State::Free:
    case State::Normal:
        return;
    case State::Weak: {
        auto& weak = block->registry->weakEntryOf(handle);
        if (!weak.callback && weak.parameter == from) {
            weak.parameter = to;
        }
        return;
    }
    case State::NearDeath: {
        auto* dying = block->registry->dyingEntryOf(handle);
        if (dying && !dying->callback && dying->parameter == from) {
            dying->parameter = to;
        }
        return;
    }
    }
}

NEVER_INLINE void GlobalHandleRegistry::didCloseScope(JSC::VM& vm)
{
    ifExists(vm)->releaseDisposedHandles();
}

void GlobalHandleRegistry::releaseDisposedHandles()
{
    if (!m_disposed.isEmpty() && !hasOpenScopeWithV8Handles()) {
        // release() appends to m_free only.
        for (GlobalHandle* handle : m_disposed) {
            release(handle);
        }
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

// V8's inline Local<T>::New(isolate, global) and ReturnValue<T>::Set(global) copy the word of the handle, so they point into the handle and no scope visits them. In V8 they keep the value of a weak handle alive.
template<typename Visitor>
void GlobalHandleRegistry::visitWeakHandlesOfOpenScopes(Visitor& visitor)
{
    // Nothing that a handle holds dies in a shutdown: no weak callback runs then, and no root is written. V8 can run weak callbacks then (https://github.com/nodejs/node/blob/v26.12.1/deps/v8/src/heap/heap.cc#L6372-L6377).
    if (isShuttingDown()) [[unlikely]] {
        for (GlobalHandleBlock* block : m_blocks) {
            for (auto& handle : block->handles) {
                if (JSC::JSCell* cell = handle.cell()) {
                    visitor.appendUnbarriered(cell);
                }
            }
        }
        return;
    }
    if (m_youngWeak.isEmpty() && m_oldWeak.isEmpty()) {
        return;
    }
    auto visitWord = [&](TaggedPointer word) {
        auto* layout = word.getPtr<ObjectLayout>();
        // Else a Smi, or the layout of a handle of a scope, or a root of an isolate.
        if (!layout || !m_blockSet.contains(GlobalHandleBlock::of(layout))) {
            return;
        }
        auto* handle = reinterpret_cast<GlobalHandle*>(reinterpret_cast<uintptr_t>(layout) - OBJECT_OFFSETOF(GlobalHandle, object));
        if (handle->state() == State::Weak) {
            if (JSC::JSCell* cell = handle->cell()) {
                visitor.appendUnbarriered(cell);
            }
        }
    };
    for (auto& realm : m_realms) {
        auto* internals = realm.get();
        if (!internals) {
            continue;
        }
        for (TaggedPointer* slot : internals->activeReturnValueSlots()) {
            visitWord(*slot);
        }
        for (auto* scope = internals->isolate()->globalObject()->m_currentHandleScopeImpl.get(); scope; scope = scope->parent()) {
            if (auto* handles = scope->v8Handles()) {
                handles->forEachRawSlot(visitWord);
            }
        }
    }
}

template void GlobalHandleRegistry::visitWeakHandlesOfOpenScopes(JSC::AbstractSlotVisitor&);
template void GlobalHandleRegistry::visitWeakHandlesOfOpenScopes(JSC::SlotVisitor&);

void GlobalHandleRegistry::didFinishMarking(JSC::CollectionScope scope)
{
    // A handle that holds no cell never dies.
    auto isDead = [&](const GlobalHandle* handle) {
        JSC::JSCell* cell = handle->cell();
        return cell && !m_vm.heap.isMarked(cell);
    };
    auto die = [&](const WeakGlobalHandle& weak) {
        GlobalHandle* handle = weak.handle;
        DyingHandle dying { handle, weak.callback, weak.parameter, { nullptr, nullptr } };
        // The cell is dead and not swept yet, so its fields are still there.
        if (handle->flags & GlobalHandle::internalFieldsFlag) {
            if (auto* object = dynamicDowncast<InternalFieldObject>(handle->cell())) {
                size_t count = std::min<size_t>(object->alignedPointerCount(), kEmbedderFieldsInWeakCallback);
                for (size_t field = 0; field < count; field++) {
                    dying.embedderFields[field] = object->alignedPointerAt(field);
                }
            }
        }
        makeDead(handle);
        handle->index = m_dying.size();
        m_dying.append(dying);
    };
    // Gives the memory back once most of the handles are gone.
    auto shrink = [](WTF::Vector<WeakGlobalHandle>& list, size_t size) {
        list.shrink(size);
        if (list.capacity() > 4 * size + 64) {
            list.shrinkCapacity(2 * size);
        }
    };
    if (scope == JSC::CollectionScope::Full) {
        size_t kept = 0;
        for (auto& weak : m_oldWeak) {
            if (isDead(weak.handle)) {
                die(weak);
                continue;
            }
            weak.handle->index = kept;
            m_oldWeak[kept++] = weak;
        }
        shrink(m_oldWeak, kept);
    }
    for (auto& weak : m_youngWeak) {
        if (isDead(weak.handle)) {
            die(weak);
            continue;
        }
        weak.handle->flags &= ~GlobalHandle::youngFlag;
        weak.handle->index = m_oldWeak.size();
        m_oldWeak.append(weak);
    }
    shrink(m_youngWeak, 0);
}

void GlobalHandleRegistry::didRetireDefaultRealm()
{
    for (auto* list : { &m_youngWeak, &m_oldWeak }) {
        for (auto& weak : *list) {
            makeDead(weak.handle);
        }
        list->clear();
    }
    m_secondPasses.clear();
}

void GlobalHandleRegistry::crashWithoutHandleScope(JSC::VM& vm)
{
    auto* registry = ifExists(vm);
    if (registry && registry->m_isRunningFirstPasses) {
        BUN_PANIC("A first-pass weak callback used the V8 API. It can only call Reset() and SetSecondPassCallback(). See comments on |v8::WeakCallbackInfo|.");
    }
    BUN_PANIC("Cannot create a V8 handle without an open handle scope");
}

void GlobalHandleRegistry::runFirstPasses()
{
    // A first pass that asks for a collection gets here again.
    if (m_isRunningFirstPasses) [[unlikely]] {
        BUN_PANIC("A first-pass weak callback started a garbage collection. It can only call Reset() and SetSecondPassCallback(). See comments on |v8::WeakCallbackInfo|.");
    }
    if (isShuttingDown()) {
        m_dying.clear();
        return;
    }
    WTF::SetForScope running(m_isRunningFirstPasses, true);
    for (auto& dying : m_dying) {
        GlobalHandle* handle = dying.handle;
        // Null if a finalizer of this collection has reset the v8::Global.
        if (!handle) {
            continue;
        }
        uint8_t offThread = handle->offThread.load(std::memory_order_relaxed);
        if (offThread & GlobalHandle::resetOffThread) {
            // No callback, as in V8.
            dying.callback = nullptr;
            dispose(handle);
        } else if (dying.callback) {
            continue;
        } else if (offThread & GlobalHandle::movedOffThread) {
            // Nobody knows where the v8::Global is. It keeps its handle, which reads as undefined.
            dying.handle = nullptr;
        } else {
            // V8 empties such a v8::Global while it collects (https://github.com/nodejs/node/blob/v26.12.1/deps/v8/src/handles/global-handles.cc#L561-L567), so a first pass finds it empty.
            *static_cast<uintptr_t**>(dying.parameter) = nullptr;
            dispose(handle);
        }
    }
    // A callback gets the isolate of the default realm. Nothing can allocate one here.
    auto* internals = defaultGlobalObject(m_vm)->V8GlobalInternalsIfExists();
    if (!internals) [[unlikely]] {
        m_dying.clear();
        return;
    }
    Isolate* isolate = internals->isolate();
    Bun__Feature__v8_weak_callback++;
    {
        // V8 runs the first passes inside the collection (https://github.com/nodejs/node/blob/v26.12.1/deps/v8/src/heap/heap.cc#L2430-L2432). The mutator is Collecting here also when the thread of the collector ended the collection, so a first pass that allocates a cell ends the process.
        JSC::CollectingScope collectingScope(m_vm.heap);
        for (size_t i = 0; i < m_dying.size(); i++) {
            // A callback can reset the v8::Global of another entry, which writes that entry.
            DyingHandle dying = m_dying[i];
            if (!dying.callback) {
                continue;
            }
            // Reset on another thread since the loop above.
            if (dying.handle && (dying.handle->offThread.load(std::memory_order_relaxed) & GlobalHandle::resetOffThread)) {
                dispose(dying.handle);
                continue;
            }
            WeakCallbackInfo<void>::Callback secondPass = nullptr;
            WeakCallbackInfo<void> info(isolate, dying.parameter, dying.embedderFields, &secondPass);
            dying.callback(info);
            // V8 ends the process here too, with this text (https://github.com/nodejs/node/blob/v26.12.1/deps/v8/src/handles/global-handles.cc#L843-L848).
            if (m_dying[i].handle) [[unlikely]] {
                BUN_PANIC("Handle not reset in first callback. See comments on |v8::WeakCallbackInfo|.");
            }
            if (secondPass) {
                m_secondPasses.append({ secondPass, dying.parameter, { dying.embedderFields[0], dying.embedderFields[1] } });
            }
        }
    }
    m_dying.clear();
    if (!m_secondPasses.isEmpty()) {
        scheduleSecondPasses();
    }
}

void GlobalHandleRegistry::scheduleSecondPasses()
{
    if (m_hasScheduledSecondPasses) {
        return;
    }
    m_hasScheduledSecondPasses = true;
    // The event loop deletes the task without running it once the VM is shutting down.
    Bun__VM__queueTask(m_bunVM, new WebCore::EventLoopTask([](WebCore::ScriptExecutionContext& context) {
        if (auto* registry = ifExists(context.vm())) {
            registry->m_hasScheduledSecondPasses = false;
            registry->runSecondPasses();
        }
    }));
}

// As V8: last first, and a collection that a second pass asks for does not start them again (https://github.com/nodejs/node/blob/v26.12.1/deps/v8/src/handles/global-handles.cc#L746-L775).
void GlobalHandleRegistry::runSecondPasses(SecondPassTime time)
{
    if (m_secondPasses.isEmpty() || m_isRunningSecondPasses || (time == SecondPassTime::Running && isShuttingDown())) {
        return;
    }
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(m_vm);
    // The exception of the caller is not one of a callback. The task runs the callbacks later.
    if (scope.exception()) [[unlikely]] {
        scheduleSecondPasses();
        return;
    }
    WTF::SetForScope running(m_isRunningSecondPasses, true);
    auto* globalObject = defaultGlobalObject(m_vm);
    Isolate* isolate = globalObject->V8GlobalInternals()->isolate();
    // A second pass may use the V8 API.
    Bun::NapiHandleScope handleScope(globalObject);
    while (!m_secondPasses.isEmpty()) {
        SecondPass pass = m_secondPasses.takeLast();
        WeakCallbackInfo<void>::Callback ignored = nullptr;
        WeakCallbackInfo<void> info(isolate, pass.parameter, pass.embedderFields, &ignored);
        pass.callback(info);
        // V8 prohibits JavaScript in a second pass (https://github.com/nodejs/node/blob/v26.12.1/deps/v8/include/v8-weak-callback-info.h#L50-L51). Here it runs, and what it throws is reported as uncaught.
        if (JSC::Exception* exception = scope.exception()) [[unlikely]] {
            scope.clearException();
            if (m_vm.isTerminationException(exception)) {
                // Bun.gc() and v8::Isolate::LowMemoryNotification() do not throw, so the stop is raised again at the next check of the traps. The callbacks that are left run before the cleanup hooks of the exit.
                m_vm.notifyNeedTermination();
                return;
            }
            Bun__reportUnhandledError(globalObject, JSC::JSValue::encode(exception));
        }
    }
}

} // namespace shim
} // namespace v8
