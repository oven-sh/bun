#include "../bindings/JSBuffer.h"
#include "../bindings/ZigGlobalObject.h"
#include "JavaScriptCore/JSGlobalObject.h"

#include "JavaScriptCore/ObjectConstructor.h"

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

inline JSValue generateTTYSourceCode(JSC::JSGlobalObject *lexicalGlobalObject,
                                     JSC::Identifier moduleKey,
                                     Vector<JSC::Identifier, 4> &exportNames,
                                     JSC::MarkedArgumentBuffer &exportValues) {
  JSC::VM &vm = lexicalGlobalObject->vm();
  GlobalObject *globalObject =
      reinterpret_cast<GlobalObject *>(lexicalGlobalObject);

  auto *tty = JSC::constructEmptyObject(globalObject,
                                        globalObject->objectPrototype(), 3);

  auto *isattyFunction =
      JSFunction::create(vm, globalObject, 1, "isatty"_s, jsFunctionTty_isatty,
                         ImplementationVisibility::Public);

  auto *notimpl = JSFunction::create(vm, globalObject, 0, "notimpl"_s,
                                     jsFunctionNotImplementedYet,
                                     ImplementationVisibility::Public,
                                     NoIntrinsic, jsFunctionNotImplementedYet);

  exportNames.append(JSC::Identifier::fromString(vm, "isatty"_s));
  exportValues.append(isattyFunction);

  exportNames.append(JSC::Identifier::fromString(vm, "ReadStream"_s));
  tty->putDirect(vm, JSC::Identifier::fromString(vm, "ReadStream"_s), notimpl);
  exportValues.append(notimpl);

  exportNames.append(JSC::Identifier::fromString(vm, "WriteStream"_s));
  tty->putDirect(vm, JSC::Identifier::fromString(vm, "WriteStream"_s), notimpl);
  exportValues.append(notimpl);

  tty->putDirect(vm,
                 PropertyName(Identifier::fromUid(
                     vm.symbolRegistry().symbolForKey("CommonJS"_s))),
                 jsNumber(0), 0);

  for (size_t i = 0; i < exportNames.size(); i++) {
    tty->putDirect(vm, exportNames[i], exportValues.at(i), 0);
  }

  exportNames.append(vm.propertyNames->defaultKeyword);
  exportValues.append(tty);

  return {};
}

} // namespace Zig
