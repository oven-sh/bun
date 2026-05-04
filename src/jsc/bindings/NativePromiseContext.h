#pragma once

#include "BunClientData.h"
#include "root.h"
#include <wtf/CompactPointerTuple.h>

namespace Bun {

// Opaque marker type so CompactPointerTuple's allowCompactPointers check
// passes. The actual pointee is one of several Zig-side native types; we
// cast through void* at the boundary.
struct NativePromiseContextPointee {
    WTF_ALLOW_STRUCT_COMPACT_POINTERS;
};

// A GC-managed cell that owns a reference to a native object for the duration
// of a pending Promise reaction.
//
// Problem: when native code `.then()`s a user Promise and passes a raw pointer
// as context, it must ref() the native object to keep it alive until the
// reaction fires. But if the Promise never settles (client aborted, user
// forgot to resolve), onResolve/onReject never fire and the ref is never
// balanced — the native object leaks forever.
//
// Solution: this cell holds the ref. Creating it increments the native
// refcount; the destructor decrements it. If the Promise settles normally,
// onResolve calls take() to transfer ownership and the dtor becomes a no-op.
// If the Promise is GC'd without settling, the reaction is collected, this
// cell is collected, and the dtor releases the ref. No leak, no UAF.
class NativePromiseContext final : public JSC::JSCell {
public:
    using Base = JSC::JSCell;

    // One entry per concrete native type. The destructor switches on this to
    // call the right deref. Packed into the pointer's upper bits via
    // CompactPointerTuple, so this cell adds only one pointer of storage
    // beyond the JSCell header.
    //
    // Must stay in sync with Tag in src/bun.js/api/NativePromiseContext.zig.
    enum class Tag : uint8_t {
        HTTPServerRequestContext,
        HTTPSServerRequestContext,
        DebugHTTPServerRequestContext,
        DebugHTTPSServerRequestContext,
        BodyValueBufferer,
        HTTPSServerH3RequestContext,
        DebugHTTPSServerH3RequestContext,
    };

    static NativePromiseContext* create(JSC::VM& vm, JSC::Structure* structure, void* ctx, Tag tag);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return JSC::Structure::create(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::CellType, StructureFlags), info(), 0, 0);
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<NativePromiseContext, WebCore::UseCustomHeapCellType::Yes>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForNativePromiseContext.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNativePromiseContext = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForNativePromiseContext.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForNativePromiseContext = std::forward<decltype(space)>(space); },
            [](auto& server) -> JSC::HeapCellType& { return server.m_heapCellTypeForNativePromiseContext; });
    }

    DECLARE_INFO;

    static constexpr JSC::DestructionMode needsDestruction = JSC::DestructionMode::NeedsDestruction;
    static void destroy(JSC::JSCell* cell);

    // Transfer ownership of the ref to the caller. After this, the dtor is a
    // no-op. Returns null if already taken.
    void* take()
    {
        void* ctx = m_data.pointer();
        m_data.setPointer(nullptr);
        return ctx;
    }

    void* pointer() const { return m_data.pointer(); }
    Tag tag() const { return m_data.type(); }

private:
    NativePromiseContext(JSC::VM& vm, JSC::Structure* structure, void* ctx, Tag tag)
        : Base(vm, structure)
        , m_data(static_cast<NativePromiseContextPointee*>(ctx), tag)
    {
    }

    ~NativePromiseContext();

    WTF::CompactPointerTuple<NativePromiseContextPointee*, Tag> m_data;
};

} // namespace Bun
