#pragma once

#include "root.h"
#include "_NativeModule.h"
#include "BakeAdditionsToGlobalObject.h"

namespace Rust {
using namespace WebCore;
using namespace JSC;

DEFINE_NATIVE_MODULE(BunApp)
{
    INIT_NATIVE_MODULE(1);

    auto* rust = static_cast<Rust::GlobalObject*>(globalObject);
    JSValue ssrResponseConstructor = rust->bakeAdditions().JSBakeResponseConstructor(rust);

    put(JSC::Identifier::fromString(vm, "Response"_s), ssrResponseConstructor);

    RETURN_NATIVE_MODULE();
}

} // namespace Rust
