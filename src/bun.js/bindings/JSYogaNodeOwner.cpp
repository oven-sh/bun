#include "JSYogaNodeOwner.h"
#include "YogaNodeImpl.h"
#include "JSYogaNode.h"
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/Compiler.h>
#include <yoga/Yoga.h>

namespace Bun {

void* root(YogaNodeImpl* impl)
{
    if (!impl)
        return nullptr;

    YGNodeRef current = impl->yogaNode();
    YGNodeRef root = current;

    // Traverse up to find the root node
    while (current) {
        YGNodeRef parent = YGNodeGetParent(current);
        if (!parent)
            break;
        root = parent;
        current = parent;
    }

    return root;
}

void JSYogaNodeOwner::finalize(JSC::Handle<JSC::Unknown> handle, void* context)
{
    // This is where we deref the C++ YogaNodeImpl wrapper
    // The context contains our YogaNodeImpl
    auto* impl = static_cast<YogaNodeImpl*>(context);

    // Deref the YogaNodeImpl - this will decrease its reference count
    // and potentially destroy it if no other references exist
    impl->deref();
}

bool JSYogaNodeOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void* context, JSC::AbstractSlotVisitor& visitor, ASCIILiteral* reason)
{
    UNUSED_PARAM(handle);

    auto* impl = static_cast<YogaNodeImpl*>(context);

    // Standard WebKit pattern: check if reachable as opaque root
    bool reachable = visitor.containsOpaqueRoot(impl);
    if (reachable && reason)
        *reason = "YogaNode reachable from opaque root"_s;

    return reachable;
}

JSYogaNodeOwner& jsYogaNodeOwner()
{
    static NeverDestroyed<JSYogaNodeOwner> owner;
    return owner.get();
}

} // namespace Bun
