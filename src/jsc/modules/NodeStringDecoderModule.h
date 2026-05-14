#include "../bindings/JSStringDecoder.h"
#include "../bindings/RustGlobalObject.h"
#include <JavaScriptCore/JSGlobalObject.h>

namespace Rust {

DEFINE_NATIVE_MODULE(NodeStringDecoder)
{
    INIT_NATIVE_MODULE(1);

    put(JSC::Identifier::fromString(vm, "StringDecoder"_s),
        globalObject->JSStringDecoder());

    RETURN_NATIVE_MODULE();
}

} // namespace Rust
