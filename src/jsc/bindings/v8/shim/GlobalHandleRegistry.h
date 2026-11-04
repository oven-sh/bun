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

// The handle of a v8::Global. It has the layout of a node of V8's GlobalHandles, because V8's inline code reads it: PersistentBase::IsWeak() reads the state in the byte at 11, and WrapperClassId() and SetWrapperClassId() read and write the two bytes at 8.
struct GlobalHandle {
    // V8's values. IsWeak() is true for Weak only.
    enum class State : uint8_t {
        // Not in use, or reset and not released yet: a Local of an open scope can still point into it.
        Free = 0,
        Normal = 1,
        Weak = 2,
    };
    static constexpr uint8_t stateMask = 3;

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
        flags = 0;
        object = ObjectLayout();
    }

    TaggedPointer* slot() { return &toV8Object; }

    // A Smi, or a pointer to `object` or to an Oddball.
    TaggedPointer toV8Object;
    uint16_t classId { 0 };
    uint8_t unused { 0 };
    uint8_t flags { 0 };
    uint32_t unused2 { 0 };
    ObjectLayout object;
};
static_assert(sizeof(GlobalHandle) == 32);

// The handles of some v8::Globals of one VM. Its address is a multiple of its size, so the block of a handle is the address of the handle with the low bits cleared.
struct GlobalHandleBlock {
    static constexpr size_t size = 1024;
    static constexpr size_t handleCount = 31;

    // What only a VM that is alive needs for a handle.
    struct Extra {
        // Keeps the cell of the handle alive (StrongRef.h). Null for a handle that holds no cell.
        Bun::StrongRefImpl* root;
        // What MakeWeak() stored, which ClearWeak() returns.
        void* weakParameter;
    };

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
    // One for each handle. Freed with the registry.
    Extra* extras;
    GlobalHandle handles[handleCount];
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

    // These find the VM from the address of the handle. They do nothing on a thread other than the VM's, once the VM is destroyed, and for a handle that is not in use.
    static void dispose(GlobalHandle*);
    // The value stays strongly held: IsWeak() is true and ClearWeak() returns the parameter, and that is all.
    static void makeWeak(GlobalHandle*, void* parameter);
    static void* clearWeak(GlobalHandle*);

    // Called by HandleScopeBuffer::close() in a realm that hasDisposedGlobalHandles().
    static void didCloseScope(JSC::VM&);

private:
    GlobalHandle* takeHandle();
    // Makes the disposed handles free, unless a Local can still point into one.
    void releaseDisposedHandles();
    bool hasOpenScopeWithV8Handles() const;

    void* const m_bunVM;
    WTF::Vector<GlobalHandleBlock*> m_blocks;
    // How many handles of the last block have been taken.
    size_t m_takenFromLastBlock { GlobalHandleBlock::handleCount };
    WTF::Vector<GlobalHandle*> m_free;
    // The disposed handles that wait for the open scopes with V8 handles to close.
    WTF::Vector<GlobalHandle*> m_disposed;
    WTF::Vector<JSC::Weak<GlobalInternals>> m_realms;
    // What GlobalInternals::hasDisposedGlobalHandles() of each realm says.
    bool m_realmsHaveDisposedHandles { false };
};

} // namespace shim
} // namespace v8
