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

    fprintf(stderr, "[DEBUG] JSYogaNodeOwner::finalize called for YogaNodeImpl %p\n", impl);

    // Deref the YogaNodeImpl - this will decrease its reference count
    // and potentially destroy it if no other references exist
    impl->deref();
}

bool JSYogaNodeOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void* context, JSC::AbstractSlotVisitor& visitor, ASCIILiteral* reason)
{
    UNUSED_PARAM(handle);

    auto* impl = static_cast<YogaNodeImpl*>(context);
    
    // Check if the YogaNodeImpl itself is reachable as opaque root
    bool reachable = visitor.containsOpaqueRoot(impl);
    fprintf(stderr, "[DEBUG] JSYogaNodeOwner::isReachableFromOpaqueRoots called for YogaNodeImpl %p, reachable: %s\n", 
            impl, reachable ? "true" : "false");

    if (reason)
        *reason = "YogaNode reachable from root"_s;

    return reachable;
}

JSYogaNodeOwner& jsYogaNodeOwner()
{
    static NeverDestroyed<JSYogaNodeOwner> owner;
    return owner.get();
}

} // namespace Bun
