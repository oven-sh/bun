
#include "weak_handle.h"
#include <JavaScriptCore/WeakHandleOwner.h>

namespace JSC {
class SlotVisitor;
template<typename T> class Handle;

// WeakHandleOwner::~WeakHandleOwner()
// {
// }

// bool WeakHandleOwner::isReachableFromOpaqueRoots(Handle<JSC::Unknown>, void*, AbstractSlotVisitor&, const char**)
// {
//     return false;
// }

// void WeakHandleOwner::finalize(Handle<JSC::Unknown>, void*)
// {
// }
}