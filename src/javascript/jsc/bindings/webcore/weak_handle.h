#pragma once

#include "config.h"

namespace JSC {

class SlotVisitor;
template<typename T> class Handle;

WeakHandleOwner::~WeakHandleOwner()
{
}

bool WeakHandleOwner::isReachableFromOpaqueRoots(Handle<Unknown>, void*, AbstractSlotVisitor&, const char**)
{
    return false;
}

void WeakHandleOwner::finalize(Handle<Unknown>, void*)
{
}

} // namespace JSC
