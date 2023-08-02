#include "JSBuffer.h"
#include "_NativeModule.h"

namespace Zig {
using namespace WebCore;

JSC_DEFINE_HOST_FUNCTION(jsFunctionTty_isatty, (JSGlobalObject * globalObject,
                                                CallFrame *callFrame)) {
  VM &vm = globalObject->vm();
  if (callFrame->argumentCount() < 1) {
    return JSValue::encode(jsBoolean(false));
  }

  auto scope = DECLARE_CATCH_SCOPE(vm);
  int fd = callFrame->argument(0).toInt32(globalObject);
  RETURN_IF_EXCEPTION(scope, encodedJSValue());

  return JSValue::encode(jsBoolean(isatty(fd)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNotImplementedYet,
                         (JSGlobalObject * globalObject,
                          CallFrame *callFrame)) {
  VM &vm = globalObject->vm();
  auto throwScope = DECLARE_THROW_SCOPE(vm);
  throwException(globalObject, throwScope,
                 createError(globalObject, "Not implemented yet"_s));
  return JSValue::encode(jsUndefined());
}

DEFINE_NATIVE_MODULE(NodeTTY) {
  INIT_NATIVE_MODULE(3);

  auto *isattyFunction =
      JSFunction::create(vm, globalObject, 1, "isatty"_s, jsFunctionTty_isatty,
                         ImplementationVisibility::Public);

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
