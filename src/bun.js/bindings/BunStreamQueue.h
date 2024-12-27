#pragma once

#include "root.h"

namespace Bun {

enum class StreamQueueType : uint8_t {
    CountQueuingStrategy,
    ByteLengthQueuingStrategy,
    UserDefined,
};

class StreamQueue {
public:
    StreamQueueType type { StreamQueueType::CountQueuingStrategy };
    double highWaterMark { 0 };

    // Due to the limited precision of floating-point arithmetic, the framework
    // specified here, of keeping a running total in the [[queueTotalSize]]
    // slot, is not equivalent to adding up the size of all chunks in [[queue]].
    // (However, this only makes a difference when there is a huge (~10^15)
    // variance in size between chunks, or when trillions of chunks are
    // enqueued.)
    double queueTotalSize { 0 };

    template<typename Visitor>
    void visit(JSCell* owner, Visitor& visitor)
    {
        if (m_userDefinedStrategy)
            visitor.append(m_userDefinedStrategy);
        {
            WTF::Locker lock(owner->cellLock());
            for (auto value : m_queue) {
                if (value.isCell())
                    visitor.appendUnbarriered(value);
            }
        }
    }

    void setUserDefinedStrategy(JSC::JSObject* strategy);

    void initialize(JSC::VM& vm, JSC::JSGlobalObject* globalObject, double highWaterMark, JSC::JSObject* owner, JSC::JSObject* sizeAlgorithm);

    // 1. Assert: container has [[queue]] and [[queueTotalSize]] internal slots.
    // 2. Set container.[[queue]] to a new empty list.
    // 3. Set container.[[queueTotalSize]] to 0.
    void resetQueue(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* owner);
    JSC::JSValue peekQueueValue(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
    void enqueueValueWithSize(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* owner, JSC::JSValue value, double size);
    JSC::JSValue dequeueValue(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* owner);

    void enqueueValueAndGetSize(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* owner, JSC::JSValue value);

    void clearAlgorithms();

    mutable JSC::WriteBarrier<JSC::JSObject> m_userDefinedStrategy;
    WTF::Deque<double, 0> m_userDefinedQueueSizes = {};

    bool isEmpty()
    {
        const bool isEmpty = queueTotalSize == 0;
#if ASSERT_ENABLED
        ASSERT(type == StreamQueueType::UserDefined ? m_userDefinedQueueSizes.isEmpty() == isEmpty : true);
#endif
        return isEmpty;
    }

    double desiredSize() const
    {
        return highWaterMark - queueTotalSize;
    }

private:
    WTF::Deque<JSC::JSValue, 3>& queue() { return m_queue; }
    const WTF::Deque<JSC::JSValue, 3>& queue() const { return m_queue; }

    WTF::Deque<JSC::JSValue, 3> m_queue = {};
};
}
