#pragma once

#include "root.h"
#include "_NativeModule.h"
#include "BakeAdditionsToGlobalObject.h"

namespace Zig {
using namespace WebCore;
using namespace JSC;

// External function to get SSRResponse constructor
extern "C" JSC::EncodedJSValue Bake__getSSRResponseConstructor(JSC::JSGlobalObject* globalObject);

DEFINE_NATIVE_MODULE(BunApp)
{
    INIT_NATIVE_MODULE(1);

    JSValue ssrResponseConstructor = JSValue::decode(Bake__getSSRResponseConstructor(globalObject));

    put(JSC::Identifier::fromString(vm, "Response"_s), ssrResponseConstructor);

    RETURN_NATIVE_MODULE();
}

} // namespace Zig
