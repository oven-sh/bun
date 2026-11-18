#pragma once

#include "engine/support/Vector.h"
#include "engine/text/TextForward.h"

namespace WTF {

// Of native code.
class StackTrace {
    WTF_MAKE_TZONE_ALLOCATED(StackTrace);

public:
    static std::unique_ptr<StackTrace> captureStackTrace(size_t maxFrames);

    String toString() const;

private:
    Vector<void*> m_frames;
};

}

using WTF::StackTrace;
