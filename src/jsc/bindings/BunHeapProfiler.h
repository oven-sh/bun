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

// Take a V8-format heap snapshot of `vm`. Both run a full GC, walk the heap and
// serialize it. They return nullopt when the snapshot is too large to serialize
// (the builder records an overflow of a ~2 GiB container limit). Every caller
// must turn nullopt into an error: the builder's empty result is not a snapshot.
std::optional<WTF::String> takeV8HeapSnapshotJSON(JSC::VM&);
std::optional<WTF::Vector<uint8_t>> takeV8HeapSnapshotBytes(JSC::VM&);

// The error for the nullopt case above: `RangeError: Out of memory: ...`, the
// same shape the JSC-format snapshot throws when its output is too large.
JSC::JSObject* createHeapSnapshotTooLargeError(JSC::JSGlobalObject*);

} // namespace Bun
