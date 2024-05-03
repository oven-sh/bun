#pragma once

#include "JSBuffer.h"
#include "_NativeModule.h"

#if OS(WINDOWS)
#include <uv.h>
#endif

namespace Zig {
using namespace WebCore;

JSC_DECLARE_HOST_FUNCTION(jsFunctionTty_isatty);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNotImplementedYet);

DEFINE_NATIVE_MODULE(NodeTTY) {
  INIT_NATIVE_MODULE(3);

  auto *notimpl = JSFunction::create(vm, globalObject, 0, "notimpl"_s,
                                     jsFunctionNotImplementedYet,
                                     ImplementationVisibility::Public,
                                     NoIntrinsic, jsFunctionNotImplementedYet);

  putNativeFn(Identifier::fromString(vm, "isatty"_s), jsFunctionTty_isatty);
  put(Identifier::fromString(vm, "ReadStream"_s), notimpl);
  put(Identifier::fromString(vm, "WriteStream"_s), notimpl);

  RETURN_NATIVE_MODULE();
}

} // namespace Zig
