#pragma once

#include "root.h"
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>
#include <optional>

namespace JSC {
class JSGlobalObject;
class JSObject;
class VM;
}

namespace Bun {

// Run a full GC, walk the heap and serialize the V8-format snapshot. nullopt
// means the snapshot passed a ~2 GiB container limit; the caller must raise an error.
std::optional<WTF::String> takeV8HeapSnapshotJSON(JSC::VM&);
std::optional<WTF::Vector<uint8_t>> takeV8HeapSnapshotBytes(JSC::VM&);

// The error for the nullopt case above: `RangeError: Out of memory: ...`.
JSC::JSObject* createHeapSnapshotTooLargeError(JSC::JSGlobalObject*);

} // namespace Bun
