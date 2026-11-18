#pragma once

#include <JavaScriptCore/MarkedBlock.h>
#include <array>

namespace JSC {
class Structure;
}

namespace WebCore {

// The structures that copies of plain objects got (SerializedScriptValue.cpp), one per VM (JSVMClientData).
struct ClonedShapes {
    struct Shape {
        JSC::Structure* from;
        JSC::Structure* to;
    };
    using Shapes = std::array<Shape, 128>;

    JSC::HeapVersion newlyAllocatedVersion {};
    Shapes shapes {};
};

} // namespace WebCore
