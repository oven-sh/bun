// JSPullIntoDescriptor — the spec's pull-into descriptor as a small, destructible GC cell
// (its buffer is a RefPtr to the ArrayBuffer impl). It is a cell (not a plain struct in a Vector) because user code can mutate
// [[pendingPullIntos]] reentrantly from inside respond()/respondWithNewView()/enqueue();
// holding a JSPullIntoDescriptor* across user JS is never a UAF — but the code must still
// RE-VALIDATE that the descriptor is still relevant afterward.
// Internal cell: no prototype, no constructor, never exposed to JS.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/TypedArrayType.h>

namespace WebCore {

class JSPullIntoDescriptor final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    static JSPullIntoDescriptor* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    static void destroy(JSC::JSCell*);

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    // "element size" (1..8) — DERIVED from m_viewConstructor, never stored separately.
    size_t elementSize() const { return JSC::elementSize(m_viewConstructor); }

    // "buffer" — the ArrayBuffer IMPL, not a JSArrayBuffer wrapper cell: internal transfers
    // move the contents without allocating GC cells or re-reporting extra memory; a wrapper
    // only ever exists lazily if user code reads `.buffer` off a view we hand out.
    RefPtr<JSC::ArrayBuffer> m_buffer;
    // "buffer byte length"
    size_t m_bufferByteLength { 0 };
    // "byte offset"
    size_t m_byteOffset { 0 };
    // "byte length"
    size_t m_byteLength { 0 };
    // "bytes filled"
    size_t m_bytesFilled { 0 };
    // "minimum fill"
    size_t m_minimumFill { 0 };
    // "view constructor" — an INTRINSIC constructor identity (a closed set), never a user
    // constructor.
    JSC::TypedArrayType m_viewConstructor { JSC::TypeUint8 };
    // "reader type": "default" / "byob" / "none" (None after release).
    ReaderType m_readerType { ReaderType::None };

private:
    JSPullIntoDescriptor(JSC::VM&, JSC::Structure*);
    ~JSPullIntoDescriptor();
    void finishCreation(JSC::VM&);
};

} // namespace WebCore
