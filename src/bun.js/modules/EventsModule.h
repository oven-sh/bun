#include "JavaScriptCore/JSGlobalObject.h"
#include "ZigGlobalObject.h"

namespace Zig {
using namespace WebCore;

inline void generateEventsSourceCode(JSC::JSGlobalObject *lexicalGlobalObject,
                                     JSC::Identifier moduleKey,
                                     Vector<JSC::Identifier, 4> &exportNames,
                                     JSC::MarkedArgumentBuffer &exportValues) {
  JSC::VM &vm = lexicalGlobalObject->vm();
  GlobalObject *globalObject =
      reinterpret_cast<GlobalObject *>(lexicalGlobalObject);

  exportNames.append(JSC::Identifier::fromString(vm, "EventEmitter"_s));
  exportValues.append(
      WebCore::JSEventEmitter::getConstructor(vm, globalObject));

  exportNames.append(JSC::Identifier::fromString(vm, "getEventListeners"_s));
  exportValues.append(JSC::JSFunction::create(
      vm, lexicalGlobalObject, 0, MAKE_STATIC_STRING_IMPL("getEventListeners"),
      Events_functionGetEventListeners, ImplementationVisibility::Public));
  exportNames.append(JSC::Identifier::fromString(vm, "listenerCount"_s));
  exportValues.append(JSC::JSFunction::create(
      vm, lexicalGlobalObject, 0, MAKE_STATIC_STRING_IMPL("listenerCount"),
      Events_functionListenerCount, ImplementationVisibility::Public));
  exportNames.append(
      JSC::Identifier::fromString(vm, "captureRejectionSymbol"_s));
  exportValues.append(Symbol::create(
      vm, vm.symbolRegistry().symbolForKey("nodejs.rejection"_s)));

  JSFunction *eventEmitterModuleCJS =
      jsCast<JSFunction *>(WebCore::JSEventEmitter::getConstructor(
          vm, reinterpret_cast<Zig::GlobalObject *>(globalObject)));

  for (size_t i = 0; i < exportNames.size(); i++) {
    eventEmitterModuleCJS->putDirect(vm, exportNames[i], exportValues.at(i), 0);
  }

  exportNames.append(JSC::Identifier::fromString(vm, "on"_s));
  auto *onAsyncIterFnPtr = eventEmitterModuleCJS->putDirectBuiltinFunction(
      vm, globalObject, JSC::Identifier::fromString(vm, "on"_s),
      nodeEventsOnAsyncIteratorCodeGenerator(vm),
      PropertyAttribute::Builtin | PropertyAttribute::DontDelete);
  exportValues.append(onAsyncIterFnPtr);

  exportNames.append(JSC::Identifier::fromString(vm, "once"_s));
  auto *oncePromiseFnPtr = eventEmitterModuleCJS->putDirectBuiltinFunction(
      vm, globalObject, JSC::Identifier::fromString(vm, "once"_s),
      nodeEventsOncePromiseCodeGenerator(vm),
      PropertyAttribute::Builtin | PropertyAttribute::DontDelete);
  exportValues.append(oncePromiseFnPtr);

  eventEmitterModuleCJS->putDirect(
      vm,
      PropertyName(
          Identifier::fromUid(vm.symbolRegistry().symbolForKey("CommonJS"_s))),
      jsNumber(0), 0);

  exportNames.append(JSC::Identifier::fromString(vm, "default"_s));
  exportValues.append(eventEmitterModuleCJS);
}

} // namespace Zig
