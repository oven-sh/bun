#pragma once

#include "root.h"
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace JSC {
class VM;
class JSCell;
class StackFrame;
}

namespace Bun {

// Side-channel metadata captured for an ErrorInstance's stack trace at
// construction time, while the call stack is still live. Stored in a small
// per-thread direct-mapped cache so that memory is bounded and does not depend
// on the ErrorInstance's GC lifecycle. ErrorInstance has no destructor hook
// Bun can reach (finalizeUnconditionally only runs for marked cells), so a
// per-instance heap allocation would leak for errors collected before being
// marked.
struct StackTraceMetadata {
    struct Entry {
        JSC::JSCell* callee;
        WTF::String typeName;
    };
    WTF::Vector<Entry> entries;
};

void captureStackFrameReceivers(JSC::VM&, JSC::JSCell* owner, WTF::Vector<JSC::StackFrame>& stackTrace, size_t maxToAppend);

const StackTraceMetadata* stackTraceMetadataFor(JSC::JSCell* owner);

}
