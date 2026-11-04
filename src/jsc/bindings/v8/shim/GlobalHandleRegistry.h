#pragma once

#include "../v8_api_internal.h"
#include "BunClientData.h"
#include "Handle.h"
#include <JavaScriptCore/CollectionScope.h>
#include <JavaScriptCore/Weak.h>
#include <atomic>
#include <thread>
#include <wtf/HashSet.h>
#include <wtf/Noncopyable.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/Vector.h>

namespace Bun {
struct StrongRefImpl;
}

namespace v8 {

class Isolate;

namespace shim {

class GlobalHandleRegistry;
class GlobalInternals;

// The handle of a v8::Global. It has the layout of a node of V8's GlobalHandles, because V8's inline code reads it: PersistentBase::IsWeak() reads the state in the byte at 11, and WrapperClassId() and SetWrapperClassId() read and write the two bytes at 8.
struct GlobalHandle {
    // V8's values. IsWeak() is true for Weak only.
    enum class State : uint8_t {
        // Not in use, or reset and not released yet: a Local of an open scope can still point into it.
        Free = 0,
        Normal = 1,
        Weak = 2,
        // The last collection found the value dead, and the weak callback has not reset the handle yet.
        NearDeath = 3,
    };
    static constexpr uint8_t stateMask = 3;
    // SetWeak(parameter, callback, WeakCallbackType::kInternalFields).
    static constexpr uint8_t internalFieldsFlag = 1 << 2;
    // Weak: the handle is in GlobalHandleRegistry::m_youngWeak, not in m_oldWeak.
    static constexpr uint8_t youngFlag = 1 << 3;

    // The bits of `offThread`, which a thread other than the VM's sets.
    // Reset(): the weak callback must not run.
    static constexpr uint8_t resetOffThread = 1 << 0;
    // A move: the address of a v8::Global without a callback is not known any more.
    static constexpr uint8_t movedOffThread = 1 << 1;

    State state() const { return static_cast<State>(flags & stateMask); }
    void setState(State state) { flags = (flags & ~stateMask) | static_cast<uint8_t>(state); }

    void setSmi(int32_t smi)
    {
        toV8Object = TaggedPointer(smi);
        object = ObjectLayout();
    }
    void setLayout(const ObjectLayout& layout)
    {
        object = layout;
        toV8Object = TaggedPointer(&object);
    }
    // For undefined, null, true and false: `word` points at an Oddball, which does not fit in a handle.
    void setOddballWord(TaggedPointer word)
    {
        toV8Object = word;
        object = ObjectLayout();
    }
    void clear()
    {
        toV8Object = TaggedPointer();
        classId = 0;
        offThread.store(0, std::memory_order_relaxed);
        flags = 0;
        object = ObjectLayout();
    }

    bool pointsAtOwnLayout() const { return toV8Object.tag() != TaggedPointer::Tag::Smi && toV8Object.getPtr<ObjectLayout>() == &object; }
    // Null for a number, undefined, null, true and false. Not validated: a finalizer can reach a handle whose cell is destroyed already.
    JSC::JSCell* cell() const { return pointsAtOwnLayout() && object.map() != &Map::heap_number_map() ? object.m_contents.cell.unvalidatedGet() : nullptr; }
    TaggedPointer* slot() { return &toV8Object; }

    // A Smi, or a pointer to `object` or to an Oddball.
    TaggedPointer toV8Object;
    uint16_t classId { 0 };
    // The only part of a handle that a thread other than the VM's writes.
    std::atomic<uint8_t> offThread { 0 };
    uint8_t flags { 0 };
    // Weak: where it is in m_youngWeak or m_oldWeak of the registry. NearDeath: where its callback is in m_dying.
    uint32_t index { 0 };
    ObjectLayout object;
};
static_assert(sizeof(GlobalHandle) == 32);

// In m_youngWeak or m_oldWeak of the registry, at the index that the handle has.
struct WeakGlobalHandle {
    GlobalHandle* handle;
    // Null for SetWeak() without a callback. `parameter` is then the address of the v8::Global.
    WeakCallbackInfo<void>::Callback callback;
    void* parameter;
};

// The handles of some v8::Globals of one VM. Its address is a multiple of its size, so the block of a handle is the address of the handle with the low bits cleared.
struct GlobalHandleBlock {
    static constexpr size_t size = 1024;
    static constexpr size_t handleCount = 31;

    explicit GlobalHandleBlock(GlobalHandleRegistry&);

    static GlobalHandleBlock* of(const void* inHandle) { return reinterpret_cast<GlobalHandleBlock*>(reinterpret_cast<uintptr_t>(inHandle) & ~(size - 1)); }
    size_t indexOf(const GlobalHandle* handle) const { return handle - handles; }
    bool hasHandleInUse() const
    {
        return std::ranges::any_of(handles, [](auto& handle) {
            return handle.state() != GlobalHandle::State::Free;
        });
    }

    // Never changes, so any thread may read it.
    const std::thread::id ownerThread;
    // Null once the registry of the VM is destroyed. Only the owner thread reads and writes it.
    GlobalHandleRegistry* registry;
    // The strong root (StrongRef.h) of each handle. Null for a handle that holds no cell, and empty while the handle is weak. Freed with the registry.
    Bun::StrongRefImpl** roots;
    GlobalHandle handles[handleCount];
};
static_assert(sizeof(GlobalHandleBlock) <= GlobalHandleBlock::size && std::has_single_bit(GlobalHandleBlock::size));

// The v8::Global handles of one JSC::VM, which JSVMClientData owns. No realm owns a handle. The collector reads only the weak ones, and only while the world is stopped.
class GlobalHandleRegistry {
    WTF_MAKE_TZONE_ALLOCATED(GlobalHandleRegistry);
    WTF_MAKE_NONCOPYABLE(GlobalHandleRegistry);

public:
    explicit GlobalHandleRegistry(JSC::VM&);
    ~GlobalHandleRegistry();

    // Null until a realm of the VM uses the V8 API.
    static GlobalHandleRegistry* ifExists(JSC::VM& vm) { return WebCore::clientData(vm)->v8GlobalHandleRegistry.get(); }
    static GlobalHandleRegistry& ensure(JSC::VM&);

    // An open scope of any realm of the VM can have a Local that points into the handle of a v8::Global.
    void addRealm(GlobalInternals*);

    // `address` is the word of a Local: a Smi, or a pointer to the layout of a handle or to a root of `isolate`.
    TaggedPointer* create(Isolate*, TaggedPointer address);

    // These find the VM from the address of the handle. They do nothing once the VM is destroyed, and on another thread than the VM's they only set a bit of GlobalHandle::offThread.
    static void dispose(GlobalHandle*);
    // `callback` is null for SetWeak() without a callback, and `parameter` is then the address of the v8::Global.
    static void makeWeak(GlobalHandle*, void* parameter, WeakCallbackInfo<void>::Callback, WeakCallbackType);
    static void* clearWeak(GlobalHandle*);
    // A v8::Global whose handle is not Normal moved from `from` to `to`.
    static void didMove(uintptr_t** from, uintptr_t** to);

    // Called by HandleScopeBuffer::close() in a realm that hasDisposedGlobalHandles().
    static void didCloseScope(JSC::VM&);

    // For the marking constraint of JSVMClientData: marks the cell of each weak handle that a Local or a return value of an open scope points into.
    template<typename Visitor> void visitWeakHandlesOfOpenScopes(Visitor&);
    // At the end of a collection, with the world stopped: each weak handle whose cell is not marked becomes NearDeath.
    void didFinishMarking(JSC::CollectionScope);

    enum class SecondPassTime : uint8_t {
        // From a task of the event loop, or after a collection that the program asked for.
        Running,
        // On exit, before the cleanup hooks of the environment. `Running` runs nothing once the VM is shutting down.
        BeforeCleanupHooks,
    };
    // Runs the second-pass callbacks that are due.
    void runSecondPasses(SecondPassTime = SecondPassTime::Running);

    // `bun test --isolate` replaced the default realm. A weak callback of an earlier realm would get the v8::Isolate of another realm, so none runs.
    void didRetireDefaultRealm();

    // Ends the process: a V8 handle was asked for with no handle scope open.
    [[noreturn]] static void crashWithoutHandleScope(JSC::VM&);

private:
    // What the first-pass callback of a handle gets, copied when the value is found dead, as in V8 (https://github.com/nodejs/node/blob/v26.12.1/deps/v8/src/handles/global-handles.cc#L536-L559).
    struct DyingHandle {
        // Null once the handle is reset.
        GlobalHandle* handle;
        WeakCallbackInfo<void>::Callback callback;
        void* parameter;
        void* embedderFields[kEmbedderFieldsInWeakCallback];
    };
    struct SecondPass {
        WeakCallbackInfo<void>::Callback callback;
        void* parameter;
        void* embedderFields[kEmbedderFieldsInWeakCallback];
    };

    GlobalHandle* takeHandle();
    // Deletes the root, and gives the handle to the next v8::Global.
    void release(GlobalHandle*);
    // Releases the disposed handles, unless a Local can still point into one.
    void releaseDisposedHandles();
    bool hasOpenScopeWithV8Handles() const;
    bool isShuttingDown() const;

    WeakGlobalHandle& weakEntryOf(GlobalHandle*);
    void removeWeak(GlobalHandle*);
    // A weak handle becomes Normal. `rootCell` says whether its root gets the cell back.
    void makeStrong(GlobalHandle*, Bun::StrongRefImpl* root, bool rootCell);
    // A weak handle becomes NearDeath and reads as undefined. It is in no list after this.
    static void makeDead(GlobalHandle*);

    DyingHandle* dyingEntryOf(GlobalHandle*);

    // In the epilogue of a collection, on the thread of the VM, before any other code of the mutator runs.
    void runFirstPasses();
    void scheduleSecondPasses();

    JSC::VM& m_vm;
    void* const m_bunVM;
    WTF::Vector<GlobalHandleBlock*> m_blocks;
    // For the marking constraint, which asks whether a word of a scope points into a handle. Filled from the first weak handle on.
    WTF::HashSet<GlobalHandleBlock*> m_blockSet;
    bool m_hasBlockSet { false };
    // How many handles of the last block have been taken.
    size_t m_takenFromLastBlock { GlobalHandleBlock::handleCount };
    WTF::Vector<GlobalHandle*> m_free;
    // The disposed handles that wait for the open scopes with V8 handles to close.
    WTF::Vector<GlobalHandle*> m_disposed;
    WTF::Vector<JSC::Weak<GlobalInternals>> m_realms;
    // What GlobalInternals::hasDisposedGlobalHandles() of each realm says.
    bool m_realmsHaveDisposedHandles { false };

    // The weak handles. A handle is young until the end of the next collection, and an eden collection reads only the young ones.
    WTF::Vector<WeakGlobalHandle> m_youngWeak;
    WTF::Vector<WeakGlobalHandle> m_oldWeak;
    // Written with the world stopped, read in the epilogue of that collection.
    WTF::Vector<DyingHandle> m_dying;
    WTF::Vector<SecondPass> m_secondPasses;
    bool m_isRunningFirstPasses { false };
    bool m_isRunningSecondPasses { false };
    bool m_hasScheduledSecondPasses { false };
};

} // namespace shim
} // namespace v8
