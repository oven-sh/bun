// BunStandaloneTextSink.h — the GENERIC `toText` accumulator owner cell.
// `convertChunksToText` (BunStreamConsumers.cpp) allocates ONE of these and drives the
// shared accumulator through it (the cell is the GC owner of the accumulated chunk
// barriers). It is deliberately DISTINCT from `JSDirectStreamController`'s Text arm (the
// two have different BOM behaviors); the accumulation LOGIC is shared through the ONE
// `BunTextAccumulator` value type below — "one implementation, two owners".
// Internal cell: no prototype, no constructor, never exposed to JS.
// DESTRUCTIBLE: the accumulator owns a WTF::StringBuilder + a WTF::Vector of barriers.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <wtf/Locker.h>
#include <wtf/Vector.h>
#include <wtf/text/StringBuilder.h>

namespace Bun {
namespace WebStreams {

// The shared Text accumulator ("one implementation, two owners") — the `createTextStream`
// rope + pieces state, owned BY VALUE by BOTH `WebCore::JSBunStandaloneTextSink` (below) and
// `JSDirectStreamController`'s Text arm. NOT a cell (namespace Bun::WebStreams like every
// non-cell struct). `pieces` is a barrier container: the OWNING cell mutates AND visits it
// inside its ONE `Locker { cellLock() }` scope and proves that with the AbstractLocker
// parameter (cellLock() is non-recursive — see StreamQueue.h's discipline comment).
struct BunTextAccumulator {
    // the pure-string fast-path rope.
    WTF::StringBuilder rope;
    // string + typed-array-view pieces (the mixed path).
    WTF::Vector<JSC::WriteBarrier<JSC::Unknown>> pieces;
    double estimatedLength { 0 };
    bool hasString { false };
    bool hasBuffer { false };

    // Appends every barrier in `pieces`. Called from the OWNING cell's visitChildrenImpl,
    // inside that cell's single cellLock() scope.
    template<typename Visitor>
    void visit(const WTF::AbstractLocker&, Visitor& visitor)
    {
        for (auto& piece : pieces)
            visitor.append(piece);
    }
};

} // namespace WebStreams
} // namespace Bun

namespace WebCore {

class JSBunStandaloneTextSink final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    static JSBunStandaloneTextSink* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit the barrier container m_accumulator.pieces (via
    // m_accumulator.visit(locker, visitor) inside ONE `Locker { cellLock() }` scope).
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    // The shared accumulator (see BunTextAccumulator above). userJS: the write arm can
    // run chunk getters; the owner of this cell holds no raw pointers across it.
    Bun::WebStreams::BunTextAccumulator m_accumulator;

private:
    JSBunStandaloneTextSink(JSC::VM&, JSC::Structure*);
    ~JSBunStandaloneTextSink();
    void finishCreation(JSC::VM&);
};

} // namespace WebCore
