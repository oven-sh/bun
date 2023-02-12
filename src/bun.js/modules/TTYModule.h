#include "../bindings/JSBuffer.h"
#include "../bindings/ZigGlobalObject.h"
#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/ErrorInstance.h"
#include "JavaScriptCore/Exception.h"
#include "JavaScriptCore/Identifier.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include <stdio.h>
#include <termios.h>

#include "JavaScriptCore/ObjectConstructor.h"
#include "TTYHelper.h"

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

JSC_DEFINE_HOST_FUNCTION(jsFunctionInternalIsRaw,
                         (JSGlobalObject * globalObject,
                          CallFrame *callFrame)) {
  VM &vm = globalObject->vm();
  if (callFrame->argumentCount() < 1) {
    return JSValue::encode(jsBoolean(false));
  }

  auto scope = DECLARE_CATCH_SCOPE(vm);
  int fd = callFrame->argument(0).toInt32(globalObject);
  RETURN_IF_EXCEPTION(scope, encodedJSValue());

  auto isRaw = tty__is_raw(fd);
  if (isRaw == -3) {
    return JSValue::encode(jsUndefined());
  }
  return JSValue::encode(jsBoolean(isRaw));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionInternalSetRawMode,
                         (JSGlobalObject * globalObject,
                          CallFrame *callFrame)) {
  VM &vm = globalObject->vm();
  if (callFrame->argumentCount() < 2) {
    return JSValue::encode(jsBoolean(false));
  }

  auto scope = DECLARE_CATCH_SCOPE(vm);
  int fd = callFrame->argument(0).toInt32(globalObject);
  RETURN_IF_EXCEPTION(scope, encodedJSValue());
  bool shouldBeRaw = callFrame->argument(1).toBoolean(globalObject);
  RETURN_IF_EXCEPTION(scope, encodedJSValue());

  auto throwScope = DECLARE_THROW_SCOPE(vm);
  if (tty__set_mode(fd, shouldBeRaw ? TTY_MODE_RAW : TTY_MODE_NORMAL) < 0) {
    JSC::throwException(
        globalObject, throwScope,
        JSC::createError(globalObject, "Failed to set tty mode"_s));
    return JSValue::encode(jsUndefined());
  }
  return JSValue::encode(jsBoolean(true));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNotImplementedYet,
                         (JSGlobalObject * globalObject,
                          CallFrame *callFrame)) {
  VM &vm = globalObject->vm();
  auto throwScope = DECLARE_THROW_SCOPE(vm);
  throwException(globalObject, throwScope,
                 JSC::createError(globalObject, "Not implemented yet"_s));
  return JSValue::encode(jsUndefined());
}

inline void generateTTYSourceCode(JSC::JSGlobalObject *lexicalGlobalObject,
                                  JSC::Identifier moduleKey,
                                  Vector<JSC::Identifier, 4> &exportNames,
                                  JSC::MarkedArgumentBuffer &exportValues) {
  JSC::VM &vm = lexicalGlobalObject->vm();
  GlobalObject *globalObject =
      reinterpret_cast<GlobalObject *>(lexicalGlobalObject);

  auto *tty = JSC::constructEmptyObject(globalObject,
                                        globalObject->objectPrototype(), 5);

  auto *isattyFunction =
      JSFunction::create(vm, globalObject, 1, "isatty"_s, jsFunctionTty_isatty,
                         ImplementationVisibility::Public);

  auto *internalIsRawFunction = JSFunction::create(
      vm, globalObject, 1,
      "__BUN_INTERNAL_DO_NOT_USE_ELSE_RISK_TERMINATION__isRaw"_s,
      jsFunctionInternalIsRaw, ImplementationVisibility::Public);

  auto *internalSetRawModeFunction = JSFunction::create(
      vm, globalObject, 2,
      "__BUN_INTERNAL_DO_NOT_USE_ELSE_RISK_TERMINATION__setRawMode"_s,
      jsFunctionInternalSetRawMode, ImplementationVisibility::Public);

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

  JSC::Identifier isRawSymbolIdent =
      Identifier::fromUid(vm.symbolRegistry().symbolForKey(
          "__BUN_INTERNAL_DO_NOT_USE_ELSE_RISK_TERMINATION__isRaw"_s));

  exportNames.append(isRawSymbolIdent);
  tty->putDirect(vm, PropertyName(isRawSymbolIdent), internalIsRawFunction);
  exportValues.append(internalIsRawFunction);

  JSC::Identifier setRawModeSymbolIdent =
      JSC::Identifier::fromUid(vm.symbolRegistry().symbolForKey(
          "__BUN_INTERNAL_DO_NOT_USE_ELSE_RISK_TERMINATION__setRawMode"_s));

  exportNames.append(setRawModeSymbolIdent);
  tty->putDirect(vm, PropertyName(setRawModeSymbolIdent),
                 internalSetRawModeFunction);
  exportValues.append(internalSetRawModeFunction);

  tty->putDirect(vm,
                 PropertyName(Identifier::fromUid(
                     vm.symbolRegistry().symbolForKey("CommonJS"_s))),
                 jsNumber(0), 0);

  for (size_t i = 0; i < exportNames.size(); i++) {
    tty->putDirect(vm, exportNames[i], exportValues.at(i), 0);
  }

  exportNames.append(vm.propertyNames->defaultKeyword);
  exportValues.append(tty);
}

} // namespace Zig
