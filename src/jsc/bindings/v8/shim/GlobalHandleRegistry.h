#pragma once

#include "BunClientData.h"
#include "Handle.h"
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

// The handles of some v8::Globals of one VM. Its address is a multiple of its size, so the block of a handle is the address of the handle with the low bits cleared.
struct GlobalHandleBlock {
    static constexpr size_t size = 512;
    static constexpr size_t handleCount = 19;

    enum class State : uint8_t {
        Free,
        Live,
        Disposed,
    };

    // What only a VM that is alive needs for a handle.
    struct Extra {
        // Keeps the cell of the handle alive (StrongRef.h). Null for a handle that holds no cell.
        Bun::StrongRefImpl* root;
        // What MakeWeak() stored, which ClearWeak() returns.
        void* weakParameter;
    };

    GlobalHandleBlock(GlobalHandleRegistry&, void* bunVM);

    static GlobalHandleBlock* of(const Handle* handle) { return reinterpret_cast<GlobalHandleBlock*>(reinterpret_cast<uintptr_t>(handle) & ~(size - 1)); }
    size_t indexOf(const Handle* handle) const { return handle - handles; }
    bool hasLiveHandle() const { return std::ranges::find(states, State::Live) != std::end(states); }

    // The Bun VM of the registry, whichever thread allocates the block. Never changes, so any thread may read it.
    void* const ownerBunVM;
    // Null once the registry of the VM is destroyed. Only the thread of `ownerBunVM` reads and writes it.
    GlobalHandleRegistry* registry;
    // One for each handle. Freed with the registry.
    Extra* extras;
    State states[handleCount] {};
    Handle handles[handleCount];
};
static_assert(sizeof(GlobalHandleBlock) <= GlobalHandleBlock::size && std::has_single_bit(GlobalHandleBlock::size));

// The v8::Global handles of one JSC::VM, which JSVMClientData owns. No realm owns a handle, and the collector reads none: a strong root keeps the cell of a handle alive.
class GlobalHandleRegistry {
    WTF_MAKE_TZONE_ALLOCATED(GlobalHandleRegistry);
    WTF_MAKE_NONCOPYABLE(GlobalHandleRegistry);

public:
    explicit GlobalHandleRegistry(JSC::VM&);
    ~GlobalHandleRegistry();

    // Null until a realm of the VM uses the V8 API.
    static GlobalHandleRegistry* ifExists(JSC::VM& vm) { return WebCore::clientData(vm)->v8GlobalHandleRegistry.get(); }
    static GlobalHandleRegistry& ensure(JSC::VM&);

    // A HandleScopeBuffer is an open scope with V8 handles of a realm of the VM. A Local of it can point into the handle of a v8::Global.
    void didOpenScope() { m_openScopes++; }
    void didCloseScope()
    {
        if (!--m_openScopes) [[unlikely]] {
            releaseDisposedHandles();
        }
    }

    // `address` is the word of a Local: a Smi, or a pointer to the layout of a handle or to an Oddball.
    TaggedPointer* create(Isolate*, TaggedPointer address);

    // These three find the block from the address of the handle. They do nothing unless the Bun VM of the calling thread owns the block and is not destroyed, and for a handle that is not live.
    static void dispose(Handle*);
    static void setWeakParameter(Handle*, void* parameter);
    static void* takeWeakParameter(Handle*);

    // `bun test --isolate` has replaced the global object of a finished file: each live handle of an object lets go of it and holds undefined, until the addon resets it.
    void retireHandlesOfObjects();

private:
    // In m_openScopes while no disposed handle waits, so that zero says "the last scope closed and handles wait" and didCloseScope() has one test.
    static constexpr size_t noDisposedHandleWaits = static_cast<size_t>(1) << (sizeof(size_t) * 8 - 1);

    Handle* takeHandle();
    // Makes the disposed handles free. No scope with V8 handles is open, so no Local points into one.
    void releaseDisposedHandles();

    void* const m_bunVM;
    WTF::Vector<GlobalHandleBlock*> m_blocks;
    // How many handles of the last block have been taken.
    size_t m_takenFromLastBlock { GlobalHandleBlock::handleCount };
    WTF::Vector<Handle*> m_free;
    // The disposed handles that wait for the open scopes with V8 handles to close.
    WTF::Vector<Handle*> m_disposed;
    // How many HandleScopeBuffers the realms of the VM have, plus noDisposedHandleWaits.
    size_t m_openScopes { noDisposedHandleWaits };
};

} // namespace shim
} // namespace v8
