#pragma once

#include "root.h"
#include "_NativeModule.h"
#include "BakeAdditionsToGlobalObject.h"

namespace Zig {
using namespace WebCore;
using namespace JSC;

DEFINE_NATIVE_MODULE(BunApp)
{
    INIT_NATIVE_MODULE(1);

    auto* zig = static_cast<Zig::GlobalObject*>(globalObject);
    JSValue ssrResponseConstructor = zig->bakeAdditions().JSBakeResponseConstructor(zig);

    put(JSC::Identifier::fromString(vm, "Response"_s), ssrResponseConstructor);

    RETURN_NATIVE_MODULE();
}

} // namespace Zig
