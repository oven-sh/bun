// BunStandaloneTextSink.h — the standalone Text sink: the GENERIC `toText` accumulator.
// `readableStreamIntoText` (BunStreamConsumers.cpp) allocates ONE of these and runs it
// through `readStreamIntoSink(g, stream, sink, /*isNative*/ false)`. It is a real internal
// GC cell, deliberately DISTINCT from `JSDirectStreamController`'s Text arm (the two have
// different BOM behaviors); the accumulation LOGIC is shared through the ONE
// `BunTextAccumulator` value type below — "one implementation, two owners".
// `JSReadStreamIntoSinkOperation::m_sink` with `m_isNative == false` is exactly this class
// (the JSSink `start(onPull, onClose)` registration is skipped for it).
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

    // `result` is the JSPromise readStreamIntoSink returned; end()/close() settle it.
    static JSBunStandaloneTextSink* create(JSC::VM&, JSC::Structure*, JSC::JSPromise* result);
    static void destroy(JSC::JSCell*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_result, and the barrier container
    // m_accumulator.pieces (via m_accumulator.visit(locker, visitor) inside ONE
    // `Locker { cellLock() }` scope taken by THIS visitChildrenImpl).
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    // The internal sink protocol readStreamIntoSink drives when isNative == false.
    // All userJS: YES.
    // `write(chunk)` — accumulate one chunk (string or view) into m_accumulator.
    JSC::JSValue write(JSC::JSGlobalObject*, JSC::JSValue chunk);
    // `flush(true)` — the backpressure hook (a no-op accumulator has none).
    JSC::JSValue flush(JSC::JSGlobalObject*, bool);
    // `end()` — finishInternal, THEN the generic-path-only `withoutUTF8BOM` strip, then
    // resolve m_result with the final string. (The DIRECT Text sink does NOT BOM-strip.)
    void end(JSC::JSGlobalObject*);
    // `close(error)` — reject m_result with `error`.
    void close(JSC::JSGlobalObject*, JSC::JSValue error);

    // The shared accumulator (see BunTextAccumulator above).
    Bun::WebStreams::BunTextAccumulator m_accumulator;
    // The result promise readStreamIntoSink returned.
    JSC::WriteBarrier<JSC::JSPromise> m_result;

private:
    JSBunStandaloneTextSink(JSC::VM&, JSC::Structure*);
    ~JSBunStandaloneTextSink();
    void finishCreation(JSC::VM&, JSC::JSPromise* result);
};

} // namespace WebCore
