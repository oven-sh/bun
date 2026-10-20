// clang-format off
#pragma once
#include "JSBuffer.h"
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/JSFunctionInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include "ZigGlobalObject.h"
#include "NativeModuleList.h"


// These modules are implemented in native code as a function which writes ESM
// export key+value pairs. The following macros help simplify the implementation
// of these functions.

// To add a new native module
//   1. Add a new line to `BUN_FOREACH_NATIVE_MODULE` in NativeModuleList.h
//   2. Add a case to `HardcodedModule` (src/resolve_builtins/HardcodedModule.rs) that resolves the import.
//   3. Add a new file in this folder named after the module, camelcase and suffixed with Module,
//      like "NodeBufferModule.h" or "BunJSCModule.h". It should call DEFINE_NATIVE_MODULE(name).
//
//      The native module function is called to create the module object:
//      - INIT_NATIVE_MODULE(name, n) is called with the enum name and number of exports
//      - put(id, jsvalue) adds an export
//      - putNativeFn(id, nativefn) lets you quickly add from `JSC_DEFINE_HOST_FUNCTION`
//      - NATIVE_MODULE_FINISH() do asserts and finalize everything.
// If you decide to not use INIT_NATIVE_MODULE. make sure the first property
// given is the default export

#if ASSERT_ENABLED

// This function is a lie. It doesnt return, but rather it performs an assertion
// that what you passed to INIT_NATIVE_MODULE is indeed correct.
#define RETURN_NATIVE_MODULE()                                                 \
  ASSERT_WITH_MESSAGE(numberOfActualExportNames == passedNumberOfExportNames,  \
                      "NATIVE_MODULE_START() was should be given %d", numberOfActualExportNames);

#define __NATIVE_MODULE_ASSERT_DECL(numberOfExportNames)                       \
  [[maybe_unused]] int numberOfActualExportNames = 0;                                           \
  [[maybe_unused]] int passedNumberOfExportNames = numberOfExportNames;                         \
  
#define __NATIVE_MODULE_ASSERT_INCR numberOfActualExportNames++;

#else

#define RETURN_NATIVE_MODULE() ;
#define __NATIVE_MODULE_ASSERT_INCR ;
#define __NATIVE_MODULE_ASSERT_DECL(numberOfExportNames) ;

#endif

#define DEFINE_NATIVE_MODULE(name)                                             \
  inline void generateNativeModule_##name(                                     \
      JSC::JSGlobalObject *lexicalGlobalObject, JSC::Identifier moduleKey,     \
      Vector<JSC::Identifier, 4> &exportNames,                                 \
      JSC::MarkedArgumentBuffer &exportValues)
#define DEFINE_NATIVE_MODULE_NOINLINE(name)                                             \
  void generateNativeModule_##name(                                     \
      JSC::JSGlobalObject *lexicalGlobalObject, JSC::Identifier moduleKey,     \
      Vector<JSC::Identifier, 4> &exportNames,                                 \
      JSC::MarkedArgumentBuffer &exportValues)
// For modules in BUN_FOREACH_LAZY_ESM_NATIVE_MODULE; the body usually ends in exportObjectProperties().
#define DEFINE_LAZY_NATIVE_MODULE(name)                                        \
  inline JSC::JSObject *generateNativeModule_##name(                           \
      JSC::JSGlobalObject *lexicalGlobalObject, JSC::Identifier moduleKey,     \
      Vector<JSC::Identifier, 4> &exportNames,                                 \
      JSC::MarkedArgumentBuffer &exportValues)

#define INIT_NATIVE_MODULE(slot, numberOfExportNames)                          \
  Zig::GlobalObject *globalObject =                                            \
      static_cast<Zig::GlobalObject *>(lexicalGlobalObject);                   \
  JSC::VM &vm = globalObject->vm();                                            \
  /* Node guarantees require(id), import(id).default and                       \
     process.getBuiltinModule(id) are the same object; the generator runs      \
     once per registry, so reuse one default object per module key. */         \
  auto &nativeModuleDefaultSlot =                                              \
      globalObject->nativeModuleDefaultObject(Zig::NativeModuleDefaultSlot::slot); \
  [[maybe_unused]] const bool defaultObjectWasCached = !!nativeModuleDefaultSlot; \
  JSC::JSObject *defaultObject = defaultObjectWasCached                        \
      ? nativeModuleDefaultSlot.get()                                          \
      : (numberOfExportNames)                                                  \
          ? JSC::constructEmptyObject(globalObject,                            \
                globalObject->objectPrototype(), numberOfExportNames)          \
          : JSC::constructEmptyObject(globalObject);                           \
  if (!defaultObjectWasCached)                                                 \
    nativeModuleDefaultSlot.set(vm, globalObject, defaultObject);              \
  __NATIVE_MODULE_ASSERT_DECL(numberOfExportNames);                            \
  /* getDirect returns the raw property cell: if the user redefined an export \
     as an accessor on the cached default object, exporting it would leak a   \
     GetterSetter cell into the namespace — use the generator's value instead. */ \
  [[maybe_unused]] const auto cachedDataValue = [&](JSC::Identifier name) -> JSC::JSValue { \
    JSC::JSValue cached = defaultObject->getDirect(vm, name);                  \
    if (cached && (cached.isGetterSetter() || cached.isCustomGetterSetter()))  \
      return {};                                                               \
    return cached;                                                             \
  };                                                                           \
  [[maybe_unused]] const auto put = [&](JSC::Identifier name, JSC::JSValue value) {                   \
    if (defaultObjectWasCached) {                                              \
      if (JSC::JSValue cached = cachedDataValue(name))                         \
        value = cached;                                                        \
    } else {                                                                   \
      defaultObject->putDirect(vm, name, value);                               \
    }                                                                          \
    exportNames.append(name);                                                  \
    exportValues.append(value);                                                \
    __NATIVE_MODULE_ASSERT_INCR                                                \
  };                                                                           \
  [[maybe_unused]] const auto putNativeFn = [&](JSC::Identifier name, JSC::NativeFunction ptr) {      \
    JSC::JSValue value;                                                        \
    if (defaultObjectWasCached)                                                \
      value = cachedDataValue(name);                                           \
    if (!value) {                                                              \
      auto *function = JSC::JSFunction::create(                                \
          vm, globalObject, 1, name.string(), ptr,                             \
          JSC::ImplementationVisibility::Public, JSC::NoIntrinsic, ptr);       \
      /* Match `put`: only populate the shared object on first build; a       \
         user-deleted property on the cached object stays deleted. */         \
      if (!defaultObjectWasCached)                                             \
        defaultObject->putDirect(vm, name, function);                          \
      value = function;                                                        \
    }                                                                          \
    exportNames.append(name);                                                  \
    exportValues.append(value);                                                \
    __NATIVE_MODULE_ASSERT_INCR                                                \
  };                                                                           \
  exportNames.reserveCapacity(numberOfExportNames + 1);                        \
  exportValues.ensureCapacity(numberOfExportNames + 1);                        \
  exportNames.append(vm.propertyNames->defaultKeyword);                        \
  exportValues.append(defaultObject);                                          \
  while (0) {                                                                  \
  }

namespace Zig {
#define FORWARD_DECL_GENERATOR(id, enumName) \
void generateNativeModule_##enumName( \
  JSC::JSGlobalObject *lexicalGlobalObject, JSC::Identifier moduleKey, \
  Vector<JSC::Identifier, 4> &exportNames, \
  JSC::MarkedArgumentBuffer &exportValues);
BUN_FOREACH_ESM_NATIVE_MODULE(FORWARD_DECL_GENERATOR)
// Returns the object that exports appended as an empty JSValue are read from on first binding.
#define FORWARD_DECL_LAZY_GENERATOR(id, enumName) \
JSC::JSObject* generateNativeModule_##enumName( \
  JSC::JSGlobalObject *lexicalGlobalObject, JSC::Identifier moduleKey, \
  Vector<JSC::Identifier, 4> &exportNames, \
  JSC::MarkedArgumentBuffer &exportValues);
BUN_FOREACH_LAZY_ESM_NATIVE_MODULE(FORWARD_DECL_LAZY_GENERATOR)

// An export declared without a value is read off its object by JSC while a module that imports it is
// being linked (SyntheticModuleRecord::materializeLazyExport, called from
// CyclicModuleRecord::initializeEnvironment). Linking cannot run user code: a getter that require()s
// an ES module starts a second link() inside the one in progress, and once either of them fails, the
// records they leave behind crash the next import() that evaluates them. So only a getter that is
// Bun's own (native, or compiled from src/js) may be deferred; an accessor user code defined is read
// while the module loads, as every export was before exports became lazy.
inline bool isBunDefinedGetter(JSC::JSObject *getter) {
  auto *function = dynamicDowncast<JSC::JSFunction>(getter);
  return function && (function->isNonBoundHostFunction() || function->isBuiltinFunction());
}

// The lazy modules each mirror an object that already exists (the Bun object, process, the Module
// constructor): `default` is the object and each of propertyNames is an export. An export is
// declared without a value, so that JSC reads object[name] when something first binds to it, only
// when Bun's own code produces the value: a static table entry nothing has constructed yet or a
// native accessor (see isBunDefinedGetter). Loading the module therefore does not construct the
// object's lazy properties. A value already stored on the object, an accessor user code defined and
// a property inherited from the prototype chain are read now. Returns the object, as the
// LazySyntheticSourceGenerator contract wants, or nullptr if reading a property threw.
inline JSC::JSObject *exportObjectProperties(
    JSC::JSGlobalObject *globalObject, JSC::JSObject *object,
    const JSC::PropertyNameArrayBuilder &propertyNames,
    Vector<JSC::Identifier, 4> &exportNames,
    JSC::MarkedArgumentBuffer &exportValues) {
  auto &vm = JSC::getVM(globalObject);
  auto scope = DECLARE_THROW_SCOPE(vm);

  exportNames.reserveCapacity(propertyNames.size() + 1);
  exportValues.ensureCapacity(propertyNames.size() + 1);

  exportNames.append(vm.propertyNames->defaultKeyword);
  exportValues.append(object);

  for (const auto &propertyName : propertyNames) {
    if (propertyName == vm.propertyNames->defaultKeyword) [[unlikely]]
      continue;
    JSC::JSValue value = object->getDirect(vm, propertyName);
    bool deferred;
    if (value) {
      deferred = value.isCustomGetterSetter() ||
                 (value.isGetterSetter() &&
                  isBunDefinedGetter(uncheckedDowncast<JSC::GetterSetter>(value)->getter()));
    } else {
      deferred = object->hasNonReifiedStaticProperties() &&
                 object->findPropertyHashEntry(propertyName).has_value();
    }
    if (deferred) {
      value = JSC::JSValue();
    } else if (!value || value.isGetterSetter()) {
      // Inherited, or an accessor user code defined: read it here, outside of any link().
      value = object->get(globalObject, propertyName);
      RETURN_IF_EXCEPTION(scope, nullptr);
    }
    exportNames.append(propertyName);
    exportValues.append(value);
  }

  return object;
}
} // namespace Zig