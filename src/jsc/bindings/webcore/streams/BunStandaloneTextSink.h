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
#include "VectorSizeLimit.h"
#include "WebStreamsInternals.h"

#include <JavaScriptCore/HeapAnalyzer.h>
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
    // string + typed-array-view pieces (the mixed path).
    WTF::Vector<JSC::WriteBarrier<JSC::Unknown>> pieces;
    double estimatedLength { 0 };
    bool hasString { false };
    bool hasBuffer { false };

    // On false the rope did not take the chunk, and the caller throws.
    ALWAYS_INLINE bool tryAppendString(const WTF::String& chunk)
    {
        if (m_rope.hasOverflowed() || exceedsStringLimit(static_cast<size_t>(m_rope.length()) + chunk.length())) [[unlikely]]
            return false;
        m_rope.append(chunk);
        if (m_rope.hasOverflowed()) [[unlikely]]
            return false;
        hasString = true;
        estimatedLength += chunk.length();
        return true;
    }

    // The rope holds the string chunks that came after the last binary chunk. A rope that overflowed counts.
    bool hasRope() const { return !m_rope.isEmpty(); }
    // Null for a rope that overflowed, and the caller throws.
    WTF::String tryRopeString()
    {
        if (m_rope.hasOverflowed()) [[unlikely]]
            return {};
        // toString() shrinks the buffer first, and asserts when that overflows the rope.
        m_rope.shrinkToFit();
        if (m_rope.hasOverflowed()) [[unlikely]]
            return {};
        return m_rope.toString();
    }

    // Script adds a piece per write(), so growth is fallible. On false the caller throws after it drops the lock.
    bool tryAppendPieces(const WTF::AbstractLocker&, JSC::VM& vm, JSC::JSCell* owner, JSC::JSString* flushedRope, JSC::JSValue chunk)
    {
        using Piece = JSC::WriteBarrier<JSC::Unknown>;
        if (flushedRope) {
            if (pieces.size() >= Bun::maxVectorSize<Piece>() || !pieces.tryAppend(Piece(vm, owner, flushedRope))) [[unlikely]]
                return false;
            m_rope.clear();
        }
        return pieces.size() < Bun::maxVectorSize<Piece>() && pieces.tryAppend(Piece(vm, owner, chunk));
    }

    // Releases everything accumulated. Called as soon as the final result string has
    // been materialized so a long-lived owner (the direct stream's controller) does
    // not retain the whole payload until it is collected. Takes the owning cell's
    // lock like visit(): `pieces` is a barrier container.
    void reset(const WTF::AbstractLocker&)
    {
        pieces.clear();
        pieces.shrinkToFit();
        m_rope.clear();
        estimatedLength = 0;
        hasString = false;
        hasBuffer = false;
    }

    // Appends every barrier in `pieces`. Called from the OWNING cell's visitChildrenImpl,
    // inside that cell's single cellLock() scope.
    template<typename Visitor>
    void visit(const WTF::AbstractLocker&, Visitor& visitor)
    {
        for (auto& piece : pieces)
            visitor.appendHidden(piece);
    }

    // Reports every barrier in `pieces` as an index edge for heap-snapshot retainers.
    // Called from the OWNING cell's analyzeHeap, inside that cell's single cellLock() scope.
    void analyzeHeap(const WTF::AbstractLocker&, JSC::JSCell* from, JSC::HeapAnalyzer& analyzer)
    {
        for (uint32_t i = 0; i < pieces.size(); ++i) {
            JSC::JSValue v = pieces[i].get();
            if (v && v.isCell())
                analyzer.analyzeIndexEdge(from, v.asCell(), i);
        }
    }

private:
    // An overflowed builder has lost its text and asserts in length() and toString(): check hasOverflowed() first.
    WTF::StringBuilder m_rope { WTF::OverflowPolicy::RecordOverflow };
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
    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

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
