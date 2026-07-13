// StreamQueue.h — the spec's "queue-with-sizes" container, plus the shared algorithm-slot
// structs embedded by value in the controllers. HEADER-ONLY by design: the spec ops
// EnqueueValueWithSize / DequeueValue / PeekQueueValue / ResetQueue are inline methods here.
//
// cellLock DISCIPLINE (same pattern as src/jsc/bindings/WriteBarrierList.h): every mutation
// of `m_queue` AND the visitChildren iteration run under
// `WTF::Locker locker { owner->cellLock() }`, where `owner` is the GC cell embedding this
// queue. The lock is taken by the CALLER and proven by the `const WTF::AbstractLocker&`
// first parameter of every mutator and of visit(), with ONE exception: enqueueValueWithSize
// validates (and can throw, a GC allocation) BEFORE taking the owner's cell lock itself, so
// callers must NOT hold the lock around it (JSCellLock is non-recursive).
//
//   *** JSCellLock (`cellLock()`) is NON-RECURSIVE. ***
//   An internal-lock design would either deadlock (the owning cell takes cellLock() around
//   ALL of its barrier containers and a self-locking queue re-acquires it) or force the
//   owner to visit its sibling `Deque<WriteBarrier<...>>` members OUTSIDE the lock (a
//   concurrent-marking race on the deque's backing buffer). The rule is therefore:
//   the OWNING cell's visitChildrenImpl takes `Locker locker { cellLock() }` exactly ONCE,
//   around ALL of its barrier containers (this queue AND every sibling barrier deque), and
//   passes that ONE locker down. Mutating ops on the owner do the same. Keep the locked
//   scope tight: never run user JS or GC-allocation-heavy work while holding it.
//
// A `WTF::Deque` member makes the owning cell DESTRUCTIBLE.
// NEVER hold a pointer/reference to an entry across any call that can run user JS —
// re-fetch first() after such a call.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/HeapAnalyzer.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSCell.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ThrowScope.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <wtf/Deque.h>
#include <wtf/Locker.h>
#include <wtf/MathExtras.h>
#include <wtf/Noncopyable.h>

namespace Bun {
namespace WebStreams {

// One entry of a default (value-with-size) queue.
// An EMPTY `value` barrier is the WritableStream close sentinel (`undefined` is a legal
// chunk and must never be conflated with it).
struct ValueWithSize {
    JSC::WriteBarrier<JSC::Unknown> value; // "value"
    double size; // "size" — a double, never an integer
};

// One entry of a readable byte stream queue. The buffer is the ArrayBuffer IMPL (always a
// transferred, exclusively-owned block): no JSArrayBuffer wrapper cell exists for it unless
// user code reads `.buffer` off a view handed out over it.
struct ByteQueueEntry {
    RefPtr<JSC::ArrayBuffer> buffer; // "buffer"
    size_t byteOffset; // "byte offset"
    size_t byteLength; // "byte length"
};

// The readable controllers' algorithm slots, embedded BY VALUE as `m_algorithms` by
// JSReadableStreamDefaultController and JSReadableByteStreamController. Replaces the spec's
// [[pullAlgorithm]] and [[cancelAlgorithm]] closures; the start algorithm is never stored.
// The owning cell's visitChildrenImpl MUST visit every barrier inside it.
struct SourceAlgorithmSlots {
    // Which arm runs pull/cancel.
    SourceKind kind { SourceKind::Nothing };
    // TeeBranch / ByteTeeBranch only: which branch this controller is (0 or 1).
    uint8_t teeBranchIndex { 0 };
    // JavaScript kind only: the user underlyingSource object (the call `this`).
    JSC::WriteBarrier<JSC::Unknown> underlyingObject;
    // JavaScript kind only: the converted `pull` method ([[pullAlgorithm]]);
    // null ⇒ the trivial algorithm.
    JSC::WriteBarrier<JSC::JSObject> method1;
    // JavaScript kind only: the converted `cancel` method ([[cancelAlgorithm]]);
    // null ⇒ the trivial algorithm.
    JSC::WriteBarrier<JSC::JSObject> method2;
    // NON-JavaScript kinds only: Transform → JSTransformStream; TeeBranch/ByteTeeBranch →
    // JSStreamTeeState; FromIterable → JSStreamFromIterableContext; CrossRealm →
    // JSCrossRealmTransformState; Native → JSNativeStreamSourceAdapter.
    JSC::WriteBarrier<JSC::JSCell> algorithmContext;
};

// The writable controller's algorithm slots, embedded BY VALUE as `m_algorithms` by
// JSWritableStreamDefaultController. Replaces the spec's [[writeAlgorithm]],
// [[closeAlgorithm]], and [[abortAlgorithm]] closures.
// The owning cell's visitChildrenImpl MUST visit every barrier inside it.
struct SinkAlgorithmSlots {
    // Which arm runs write/close/abort.
    SinkKind kind { SinkKind::Nothing };
    // JavaScript kind only: the user underlyingSink object (the call `this`).
    JSC::WriteBarrier<JSC::Unknown> underlyingObject;
    // JavaScript kind only: the converted `write` method ([[writeAlgorithm]]);
    // null ⇒ the trivial algorithm.
    JSC::WriteBarrier<JSC::JSObject> method1;
    // JavaScript kind only: the converted `close` method ([[closeAlgorithm]]);
    // null ⇒ the trivial algorithm.
    JSC::WriteBarrier<JSC::JSObject> method2;
    // JavaScript kind only: the converted `abort` method ([[abortAlgorithm]]);
    // null ⇒ the trivial algorithm.
    JSC::WriteBarrier<JSC::JSObject> method3;
    // NON-JavaScript kinds only: Transform → JSTransformStream;
    // CrossRealm → JSCrossRealmTransformState.
    JSC::WriteBarrier<JSC::JSCell> algorithmContext;
};

// The [[queue]] + [[queueTotalSize]] pair.
// Instantiated as StreamQueue<ValueWithSize> and StreamQueue<ByteQueueEntry>.
// A `const WTF::AbstractLocker&` parameter proves the CALLER holds the owning cell's
// cellLock(); enqueueValueWithSize is the one self-locking exception (see the class
// comment). `owner` is the embedding GC cell (for the write barrier).
template<typename Entry>
class StreamQueue {
    WTF_MAKE_NONCOPYABLE(StreamQueue);

public:
    StreamQueue() = default;

    // spec: EnqueueValueWithSize(container, value, size). Throws RangeError if `size` is not
    // a non-negative finite number. The size was computed by the CALLER's size algorithm —
    // this op runs no user JS. The throw (a GC allocation) happens BEFORE this takes the
    // owner's cell lock; only the queue mutation runs under it. (ValueWithSize only.)
    void enqueueValueWithSize(JSC::JSGlobalObject* globalObject, JSC::JSCell* owner, JSC::JSValue value, double size)
    {
        auto& vm = JSC::getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        // spec step 2-3: ! IsNonNegativeNumber(size) and size !== +Infinity.
        if (!(size >= 0) || std::isinf(size)) {
            JSC::throwRangeError(globalObject, scope, "The queuing strategy's chunk size must be a non-negative, finite number"_s);
            return;
        }
        WTF::Locker locker { owner->cellLock() };
        m_queue.append(Entry { JSC::WriteBarrier<JSC::Unknown>(vm, owner, value), size });
        m_totalSize += size;
    }

    // spec: DequeueValue(container) — clamps [[queueTotalSize]] at 0. (ValueWithSize only.)
    JSC::JSValue dequeueValue(const WTF::AbstractLocker&)
    {
        ASSERT(!m_queue.isEmpty());
        Entry entry = m_queue.takeFirst();
        JSC::JSValue value = entry.value.get();
        m_totalSize -= entry.size;
        // spec: "This can occur due to rounding errors."
        if (m_totalSize < 0)
            m_totalSize = 0;
        return value;
    }

    // spec: PeekQueueValue(container). (ValueWithSize only.)
    JSC::JSValue peekQueueValue() const
    {
        ASSERT(!m_queue.isEmpty());
        return m_queue.first().value.get();
    }

    // spec: ResetQueue(container) — clears the list and sets [[queueTotalSize]] to 0.
    void resetQueue(const WTF::AbstractLocker&)
    {
        m_queue.clear();
        m_totalSize = 0;
    }

    // Byte-queue manual mutators (the byte controller updates its two slots by hand).
    // Callers adjust [[queueTotalSize]] separately via adjustTotalSize().
    void append(const WTF::AbstractLocker&, Entry&& entry)
    {
        m_queue.append(WTF::move(entry));
    }
    void prepend(const WTF::AbstractLocker&, Entry&& entry)
    {
        m_queue.prepend(WTF::move(entry));
    }
    // The returned reference is INVALID after any call that can run user JS or mutate the
    // queue — re-fetch.
    Entry& first() { return m_queue.first(); }
    const Entry& first() const { return m_queue.first(); }
    void removeFirst(const WTF::AbstractLocker&)
    {
        m_queue.removeFirst();
    }

    bool isEmpty() const { return m_queue.isEmpty(); }
    size_t size() const { return m_queue.size(); }
    double totalSize() const { return m_totalSize; } // [[queueTotalSize]]
    void setTotalSize(double totalSize) { m_totalSize = totalSize; }
    void adjustTotalSize(double delta) { m_totalSize += delta; }

    // GC: called from the owner's visitChildrenImpl, inside the SAME single
    // `Locker { owner->cellLock() }` scope that covers the owner's sibling barrier deques.
    template<typename Visitor>
    void visit(const WTF::AbstractLocker&, Visitor& visitor)
    {
        for (auto& entry : m_queue)
            visitEntry(visitor, entry);
    }

    // HeapAnalyzer: called from the owner's analyzeHeap, under the same cellLock() scope
    // as visit(). Reports each queued value as an index edge for heap-snapshot retainers.
    void analyzeHeap(const WTF::AbstractLocker&, JSC::JSCell* from, JSC::HeapAnalyzer& analyzer)
    {
        uint32_t i = 0;
        for (auto& entry : m_queue) {
            analyzeEntry(from, analyzer, entry, i);
            ++i;
        }
    }

private:
    static void analyzeEntry(JSC::JSCell* from, JSC::HeapAnalyzer& analyzer, ValueWithSize& entry, uint32_t i)
    {
        JSC::JSValue v = entry.value.get();
        if (v && v.isCell())
            analyzer.analyzeIndexEdge(from, v.asCell(), i);
    }
    static void analyzeEntry(JSC::JSCell*, JSC::HeapAnalyzer&, ByteQueueEntry&, uint32_t) {}

    template<typename Visitor>
    static void visitEntry(Visitor& visitor, ValueWithSize& entry) { visitor.appendHidden(entry.value); }
    template<typename Visitor>
    static void visitEntry(Visitor&, ByteQueueEntry&) {} // RefPtr impl: nothing for the GC

    // Backing container. 4 inline entries covers the common shallow queue.
    WTF::Deque<Entry, 4> m_queue;
    double m_totalSize { 0 }; // [[queueTotalSize]] — a double, never an integer
};

} // namespace WebStreams
} // namespace Bun
