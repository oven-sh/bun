// JSReadableStreamReaderBase — the shared, NON-polymorphic C++ base of the two reader
// classes, holding the `ReadableStreamGenericReader` mixin slots. It has no ClassInfo of its
// own and NO C++ `virtual` anywhere; the three `ReadableStreamReaderGeneric*` abstract ops
// take a pointer to this type.
//
// Destructible base: both concrete readers own a WTF::Deque, and the iso-subspace machinery
// statically requires destructible classes to derive from JSC::JSDestructibleObject.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/WriteBarrier.h>

namespace WebCore {

class JSReadableStreamReaderBase : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    // NOT visited here (no visitChildrenImpl on the base — it has no ClassInfo). EACH
    // concrete subclass's visitChildrenImpl MUST append m_stream and m_closedPromise.

    // [[stream]] (ReadableStreamGenericReader mixin) — null = released / not attached.
    JSC::WriteBarrier<JSReadableStream> m_stream;
    // [[closedPromise]] (mixin) — spec-required at construction; NOT lazy.
    JSC::WriteBarrier<JSC::JSPromise> m_closedPromise;

    // Discriminates the two concrete readers without a vtable and without a jsDynamicCast:
    // compares classInfo() against JSReadableStreamBYOBReader::info().
    // Defined in JSReadableStreamBYOBReader.cpp.
    bool isBYOB() const;

protected:
    JSReadableStreamReaderBase(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

} // namespace WebCore
