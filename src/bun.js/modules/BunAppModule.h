#pragma once

#include "root.h"
#include "_NativeModule.h"

namespace Zig {
using namespace WebCore;
using namespace JSC;

DEFINE_NATIVE_MODULE(BunApp)
{
    INIT_NATIVE_MODULE(0);
    
    // This is an empty module for now
    // You can add exports here later using:
    // put(JSC::Identifier::fromString(vm, "someFunction"_s), someValue);
    
    RETURN_NATIVE_MODULE();
}

} // namespace Zig