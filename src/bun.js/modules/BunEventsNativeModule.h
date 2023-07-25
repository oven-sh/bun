#include "JSEventEmitter.h"
#include "_NativeModule.h"

namespace Zig {
using namespace WebCore;

// TODO: remove this module. it is only used by streams. but it's arguable if
// streams should be using it at all.
DEFINE_NATIVE_MODULE(BunEventsNative) {
  INIT_NATIVE_MODULE(1);

  put(JSC::Identifier::fromString(vm, "EventEmitter"_s),
      WebCore::JSEventEmitter::getConstructor(vm, globalObject));

  RETURN_NATIVE_MODULE();
}

} // namespace Zig
