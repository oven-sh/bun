#pragma once

#include "root.h"
#include <JavaScriptCore/WeakHandleOwner.h>
#include <JavaScriptCore/Weak.h>

namespace Bun {

class YogaConfigImpl;
class JSYogaConfig;

class JSYogaConfigOwner : public JSC::WeakHandleOwner {
public:
    void finalize(JSC::Handle<JSC::Unknown>, void* context) final;
    bool isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown>, void* context, JSC::AbstractSlotVisitor&, ASCIILiteral*) final;
};

JSYogaConfigOwner& jsYogaConfigOwner();

} // namespace Bun