#pragma once

#include "root.h"
#include <limits>
#include <span>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace JSC {
class VM;
class JSCell;
class StackFrame;
}

namespace Bun {

// Receiver class names captured per stack frame at Error construction, kept in a bounded per-thread cache because ErrorInstance has no finalizer hook Bun can use for cleanup.
struct StackTraceMetadata {
    struct Entry {
        unsigned frameIndex; // position among the stored trace's non-async frames
        WTF::String typeName;
    };
    WTF::Vector<Entry> entries; // ascending by frameIndex
};

// Marks a frame with no position among the capture-time sync frames.
inline constexpr unsigned noSyncFrameIndex = std::numeric_limits<unsigned>::max();

void captureStackFrameReceivers(JSC::VM&, JSC::JSCell* owner, WTF::Vector<JSC::StackFrame>& stackTrace, size_t maxToAppend);

const StackTraceMetadata* stackTraceMetadataFor(JSC::JSCell* owner);

// Rewrites entry indices after Error.captureStackTrace filters and trims the raw frames it captured.
void remapStackTraceMetadata(JSC::JSCell* owner, std::span<const unsigned> frameSyncIndices);

// Returns the receiver type name for the syncIndex-th non-async frame, or nullptr. `cursor` must start at 0 and be reused across ascending syncIndex values.
inline const WTF::String* receiverTypeName(const StackTraceMetadata* metadata, size_t& cursor, unsigned syncIndex)
{
    if (!metadata)
        return nullptr;
    while (cursor < metadata->entries.size() && metadata->entries[cursor].frameIndex < syncIndex)
        cursor++;
    if (cursor < metadata->entries.size() && metadata->entries[cursor].frameIndex == syncIndex)
        return &metadata->entries[cursor].typeName;
    return nullptr;
}

}
