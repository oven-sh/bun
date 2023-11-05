// #include "DOMPoint.h"
// #include "JSDOMConstructor.h"
// #include "JSDOMGlobalObjectInlines.h"
#include "ZigGeneratedClasses.h"
#include "_NativeModule.h"

namespace Zig {

using namespace WebCore;

DEFINE_NATIVE_MODULE(BunCanvas) {
  INIT_NATIVE_MODULE(1);

  put(Identifier::fromString(vm, "Canvas"_s),
      globalObject->JSCanvasConstructor());

  // put(Identifier::fromString(vm, "Path2D"_s),
  //     getDOMConstructor<JSDOMConstructor<JSPath2D>,
  //     DOMConstructorID::Path2D>(
  //         vm, globalObject));

  RETURN_NATIVE_MODULE();
}
} // namespace Zig