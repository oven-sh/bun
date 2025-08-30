#include "JSYogaConfigOwner.h"
#include "YogaConfigImpl.h"
#include "JSYogaConfig.h"
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/Compiler.h>

namespace Bun {

void JSYogaConfigOwner::finalize(JSC::Handle<JSC::Unknown> handle, void* context)
{
    // This is where we deref the C++ YogaConfigImpl wrapper
    // The context contains our YogaConfigImpl
    auto* impl = static_cast<YogaConfigImpl*>(context);

    fprintf(stderr, "[DEBUG] JSYogaConfigOwner::finalize called for YogaConfigImpl %p\n", impl);

    // Deref the YogaConfigImpl - this will decrease its reference count
    // and potentially destroy it if no other references exist
    impl->deref();
}

bool JSYogaConfigOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void* context, JSC::AbstractSlotVisitor& visitor, ASCIILiteral* reason)
{
    UNUSED_PARAM(handle);

    auto* impl = static_cast<YogaConfigImpl*>(context);

    // YogaConfig doesn't currently use opaque roots, so always return false
    // This allows normal GC collection based on JS reference reachability
    fprintf(stderr, "[DEBUG] JSYogaConfigOwner::isReachableFromOpaqueRoots called for YogaConfigImpl %p, reachable: false\n", impl);

    if (reason)
        *reason = "YogaConfig not using opaque roots"_s;

    return false;
}

JSYogaConfigOwner& jsYogaConfigOwner()
{
    static NeverDestroyed<JSYogaConfigOwner> owner;
    return owner.get();
}

} // namespace Bun
