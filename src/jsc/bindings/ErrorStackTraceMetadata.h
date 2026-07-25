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

// Per-frame receiver class names captured at Error construction. Held in a
// bounded per-thread cache because ErrorInstance has no destructor hook Bun
// can reach (finalizeUnconditionally only visits marked cells), so a
// per-instance allocation would leak for errors collected without being marked.
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
