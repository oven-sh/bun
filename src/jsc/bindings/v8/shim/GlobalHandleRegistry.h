#pragma once

#include "BunClientData.h"
#include "Handle.h"
#include <JavaScriptCore/Weak.h>
#include <thread>
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

    explicit GlobalHandleBlock(GlobalHandleRegistry&);

    static GlobalHandleBlock* of(const Handle* handle) { return reinterpret_cast<GlobalHandleBlock*>(reinterpret_cast<uintptr_t>(handle) & ~(size - 1)); }
    size_t indexOf(const Handle* handle) const { return handle - handles; }
    bool hasLiveHandle() const { return std::ranges::find(states, State::Live) != std::end(states); }

    // Never changes, so any thread may read it.
    const std::thread::id ownerThread;
    // Null once the registry of the VM is destroyed. Only the owner thread reads and writes it.
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

    // An open scope of any realm of the VM can have a Local that points into the handle of a v8::Global.
    void addRealm(GlobalInternals*);

    // `address` is the word of a Local: a Smi, or a pointer to the layout of a handle or to a root of `isolate`.
    TaggedPointer* create(Isolate*, TaggedPointer address);

    // These three find the VM from the address of the handle. They do nothing on a thread other than the VM's, once the VM is destroyed, and for a handle that is not live.
    static void dispose(Handle*);
    static void setWeakParameter(Handle*, void* parameter);
    static void* takeWeakParameter(Handle*);

    // Called by HandleScopeBuffer::close() in a realm that hasDisposedGlobalHandles().
    static void didCloseScope(JSC::VM&);

private:
    Handle* takeHandle();
    // Makes the disposed handles free, unless a Local can still point into one.
    void releaseDisposedHandles();
    bool hasOpenScopeWithV8Handles() const;

    void* const m_bunVM;
    WTF::Vector<GlobalHandleBlock*> m_blocks;
    // How many handles of the last block have been taken.
    size_t m_takenFromLastBlock { GlobalHandleBlock::handleCount };
    WTF::Vector<Handle*> m_free;
    // The disposed handles that wait for the open scopes with V8 handles to close.
    WTF::Vector<Handle*> m_disposed;
    WTF::Vector<JSC::Weak<GlobalInternals>> m_realms;
    // What GlobalInternals::hasDisposedGlobalHandles() of each realm says.
    bool m_realmsHaveDisposedHandles { false };
};

} // namespace shim
} // namespace v8
