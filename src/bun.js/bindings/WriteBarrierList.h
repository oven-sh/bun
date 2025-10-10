#pragma once

#include <type_traits>
#include <wtf/Vector.h>
#include <JavaScriptCore/WriteBarrier.h>

namespace Bun {

/**
 * A variable-length list of JSValue objects with garbage collection support.
 *
 * This class provides a thread-safe container for WriteBarrier<T> objects that can
 * dynamically grow and shrink. It includes helper methods for visiting contained
 * objects during garbage collection traversal.
 *
 * Use this class when:
 * - The number of items may change at runtime (append/remove operations)
 * - You need thread-safe access to the list
 * - You need automatic garbage collection support for contained JSValues
 *
 * For better performance when the length is known and fixed, prefer
 * FixedVector<WriteBarrier<T>> instead.
 *
 * @tparam T The type of JSC objects to store (must inherit from JSC::JSCell)
 */
template<typename T>
class WriteBarrierList {
public:
    WriteBarrierList()
    {
    }

    void append(JSC::VM& vm, JSC::JSCell* owner, T* value)
    {
        WTF::Locker locker { owner->cellLock() };
        m_list.append(JSC::WriteBarrier<T>(vm, owner, value));
    }

    std::span<JSC::WriteBarrier<T>> list()
    {
        return m_list.mutableSpan();
    }

    void moveTo(JSC::JSCell* owner, JSC::MarkedArgumentBuffer& arguments)
    {
        WTF::Locker locker { owner->cellLock() };
        for (JSC::WriteBarrier<T>& value : m_list) {
            if (auto* cell = value.get()) {
                arguments.append(cell);
                value.clear();
            }
        }
    }

    template<typename Visitor>
    void visit(JSC::JSCell* owner, Visitor& visitor)
    {
        WTF::Locker locker { owner->cellLock() };
        for (auto& value : m_list) {
            visitor.append(value);
        }
    }

    bool isEmpty() const
    {
        return m_list.isEmpty();
    }

    T* takeFirst(JSC::JSCell* owner)
    {
        WTF::Locker locker { owner->cellLock() };
        if (m_list.isEmpty()) {
            return nullptr;
        }

        T* value = m_list.first().get();
        m_list.removeAt(0);
        return value;
    }

    template<typename MatchFunction>
    bool removeFirstMatching(JSC::JSCell* owner, const MatchFunction& matches)
    {
        WTF::Locker locker { owner->cellLock() };
        return m_list.removeFirstMatching(matches);
    }

private:
    WTF::Vector<JSC::WriteBarrier<T>> m_list;
};

}
