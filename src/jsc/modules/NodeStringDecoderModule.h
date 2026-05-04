#include "../bindings/JSStringDecoder.h"
#include "../bindings/ZigGlobalObject.h"
#include <JavaScriptCore/JSGlobalObject.h>

namespace Zig {

DEFINE_NATIVE_MODULE(NodeStringDecoder)
{
    INIT_NATIVE_MODULE(1);

    put(JSC::Identifier::fromString(vm, "StringDecoder"_s),
        globalObject->JSStringDecoder());

    RETURN_NATIVE_MODULE();
}

} // namespace Zig
