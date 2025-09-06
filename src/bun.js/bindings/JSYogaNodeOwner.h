#pragma once

#include "root.h"
#include <JavaScriptCore/WeakHandleOwner.h>
#include <JavaScriptCore/Weak.h>

namespace Bun {

class YogaNodeImpl;
class JSYogaNode;

class JSYogaNodeOwner : public JSC::WeakHandleOwner {
public:
    void finalize(JSC::Handle<JSC::Unknown>, void* context) final;
    bool isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown>, void* context, JSC::AbstractSlotVisitor&, ASCIILiteral*) final;
};

JSYogaNodeOwner& jsYogaNodeOwner();

// Helper function to get root for YogaNodeImpl
void* root(YogaNodeImpl*);

} // namespace Bun
