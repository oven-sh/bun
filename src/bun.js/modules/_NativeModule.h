// clang-format off
#pragma once
#include "JSBuffer.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "ZigGlobalObject.h"

// These modules are implemented in native code as a function which writes ESM
// export key+value pairs. The following macros help simplify the implementation
// of these functions.

// To add a new native module
//   1. Add a new line to `BUN_FOREACH_NATIVE_MODULE`
//   2. Add a case to `module_loader.zig` that resolves the import.
//   3. Add a new file in this folder named after the module, camelcase and suffixed with Module,
//      like "NodeBufferModule.h" or "BunJSCModule.h". It should call DEFINE_NATIVE_MODULE(name).
//
//      The native module function is called to create the module object:
//      - INIT_NATIVE_MODULE(n) is called with the number of exports
//      - put(id, jsvalue) adds an export
//      - putNativeFn(id, nativefn) lets you quickly add from `JSC_DEFINE_HOST_FUNCTION`
//      - NATIVE_MODULE_FINISH() do asserts and finalize everything.
// If you decide to not use INIT_NATIVE_MODULE. make sure the first property
// given is the default export

#define BUN_FOREACH_NATIVE_MODULE(macro) \
    macro("bun"_s, BunObject) \
    macro("bun:test"_s, BunTest) \
    macro("bun:jsc"_s, BunJSC) \
    macro("node:buffer"_s, NodeBuffer) \
    macro("node:constants"_s, NodeConstants) \
    macro("node:module"_s, NodeModule) \
    macro("node:process"_s, NodeProcess) \
    macro("node:string_decoder"_s, NodeStringDecoder) \
    macro("node:util/types"_s, NodeUtilTypes)  \
    macro("utf-8-validate"_s, UTF8Validate) \
    macro("abort-controller"_s, AbortControllerModule) \

#if ASSERT_ENABLED

// This function is a lie. It doesnt return, but rather it performs an assertion
// that what you passed to INIT_NATIVE_MODULE is indeed correct.
#define RETURN_NATIVE_MODULE()                                                 \
  ASSERT_WITH_MESSAGE(numberOfActualExportNames == passedNumberOfExportNames,  \
                      "NATIVE_MODULE_START() was should be given %d", numberOfActualExportNames);

#define __NATIVE_MODULE_ASSERT_DECL(numberOfExportNames)                       \
  int numberOfActualExportNames = 0;                                           \
  int passedNumberOfExportNames = numberOfExportNames;                         \
  
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

#define INIT_NATIVE_MODULE(numberOfExportNames)                                \
  Zig::GlobalObject *globalObject =                                            \
      reinterpret_cast<Zig::GlobalObject *>(lexicalGlobalObject);              \
  JSC::VM &vm = globalObject->vm();                                            \
  JSC::JSObject *defaultObject = JSC::constructEmptyObject(                    \
      globalObject, globalObject->objectPrototype(), numberOfExportNames);     \
  __NATIVE_MODULE_ASSERT_DECL(numberOfExportNames);                            \
  auto put = [&](JSC::Identifier name, JSC::JSValue value) {                   \
    defaultObject->putDirect(vm, name, value);                                 \
    exportNames.append(name);                                                  \
    exportValues.append(value);                                                \
    __NATIVE_MODULE_ASSERT_INCR                                                \
  };                                                                           \
  auto putNativeFn = [&](JSC::Identifier name, JSC::NativeFunction ptr) {      \
    JSC::JSFunction *value = JSC::JSFunction::create(                          \
        vm, globalObject, 1, name.string(), ptr,                               \
        JSC::ImplementationVisibility::Public, JSC::NoIntrinsic, ptr);         \
    defaultObject->putDirect(vm, name, value);                                 \
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
