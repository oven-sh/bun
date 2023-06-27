#include "root.h"

#include "./NodeModuleModule.h"

#include "ImportMetaObject.h"
#include "JavaScriptCore/JSBoundFunction.h"
#include "JavaScriptCore/ObjectConstructor.h"
using namespace Zig;
using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeModuleCreateRequire,
                         (JSC::JSGlobalObject * globalObject,
                          JSC::CallFrame *callFrame)) {
  JSC::VM &vm = globalObject->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);
  if (callFrame->argumentCount() < 1) {
    throwTypeError(globalObject, scope,
                   "createRequire() requires at least one argument"_s);
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  auto val = callFrame->uncheckedArgument(0).toWTFString(globalObject);
  RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::jsUndefined()));
  auto clientData = WebCore::clientData(vm);
  RELEASE_AND_RETURN(
      scope, JSValue::encode(Zig::ImportMetaObject::createRequireFunction(
                 vm, globalObject, val)));
}
extern "C" EncodedJSValue Resolver__nodeModulePathsForJS(JSGlobalObject *,
                                                         CallFrame *);

JSC_DEFINE_HOST_FUNCTION(jsFunctionFindSourceMap,
                         (JSGlobalObject * globalObject,
                          CallFrame *callFrame)) {
  auto &vm = globalObject->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);
  throwException(globalObject, scope,
                 createError(globalObject, "Not implemented"_s));
  return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionSyncBuiltinExports,
                         (JSGlobalObject * globalObject,
                          CallFrame *callFrame)) {
  return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionSourceMap, (JSGlobalObject * globalObject,
                                               CallFrame *callFrame)) {
  auto &vm = globalObject->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);
  throwException(globalObject, scope,
                 createError(globalObject, "Not implemented"_s));
  return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionResolveFileName,
                         (JSC::JSGlobalObject * globalObject,
                          JSC::CallFrame *callFrame)) {
  JSC::VM &vm = globalObject->vm();

  switch (callFrame->argumentCount()) {
  case 0: {
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    // not "requires" because "require" could be confusing
    JSC::throwTypeError(
        globalObject, scope,
        "Module._resolveFileName needs 2+ arguments (a string)"_s);
    scope.release();
    return JSC::JSValue::encode(JSC::JSValue{});
  }
  default: {
    JSC::JSValue moduleName = callFrame->argument(0);

    if (moduleName.isUndefinedOrNull()) {
      auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
      JSC::throwTypeError(globalObject, scope,
                          "Module._resolveFileName expects a string"_s);
      scope.release();
      return JSC::JSValue::encode(JSC::JSValue{});
    }

    auto result =
        Bun__resolveSync(globalObject, JSC::JSValue::encode(moduleName),
                         JSValue::encode(callFrame->argument(1)), false);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    if (!JSC::JSValue::decode(result).isString()) {
      JSC::throwException(globalObject, scope, JSC::JSValue::decode(result));
      return JSC::JSValue::encode(JSC::JSValue{});
    }

    scope.release();
    return result;
  }
  }
}

namespace Zig {
void generateNodeModuleModule(JSC::JSGlobalObject *globalObject,
                              JSC::Identifier moduleKey,
                              Vector<JSC::Identifier, 4> &exportNames,
                              JSC::MarkedArgumentBuffer &exportValues) {
  JSC::VM &vm = globalObject->vm();

  JSObject *defaultObject = JSC::constructEmptyObject(
      vm, globalObject->nullPrototypeObjectStructure());
  auto append = [&](Identifier name, JSValue value) {
    defaultObject->putDirect(vm, name, value);
    exportNames.append(name);
    exportValues.append(value);
  };

  append(Identifier::fromString(vm, "createRequire"_s),
         JSFunction::create(vm, globalObject, 1, String("createRequire"_s),
                            jsFunctionNodeModuleCreateRequire,
                            ImplementationVisibility::Public));

  append(Identifier::fromString(vm, "paths"_s),
         JSFunction::create(vm, globalObject, 1, String("paths"_s),
                            Resolver__nodeModulePathsForJS,
                            ImplementationVisibility::Public));

  append(Identifier::fromString(vm, "findSourceMap"_s),
         JSFunction::create(vm, globalObject, 1, String("findSourceMap"_s),
                            jsFunctionFindSourceMap,
                            ImplementationVisibility::Public));
  append(Identifier::fromString(vm, "syncBuiltinExports"_s),
         JSFunction::create(vm, globalObject, 0, String("syncBuiltinExports"_s),
                            jsFunctionSyncBuiltinExports,
                            ImplementationVisibility::Public));
  append(Identifier::fromString(vm, "SourceMap"_s),
         JSFunction::create(vm, globalObject, 1, String("SourceMap"_s),
                            jsFunctionSourceMap,
                            ImplementationVisibility::Public, NoIntrinsic,
                            jsFunctionSourceMap, nullptr));

  append(JSC::Identifier::fromString(vm, "_resolveFileName"_s),
         JSFunction::create(vm, globalObject, 3, String("_resolveFileName"_s),
                            jsFunctionResolveFileName,
                            ImplementationVisibility::Public));

  append(JSC::Identifier::fromString(vm, "_nodeModulePaths"_s),
         JSFunction::create(vm, globalObject, 0, String("_nodeModulePaths"_s),
                            Resolver__nodeModulePathsForJS,
                            ImplementationVisibility::Public));

  append(JSC::Identifier::fromString(vm, "_cache"_s),
         jsCast<Zig::GlobalObject *>(globalObject)->lazyRequireCacheObject());

  append(JSC::Identifier::fromString(vm, "globalPaths"_s),
         JSC::constructEmptyArray(globalObject, nullptr, 0));

  JSC::JSArray *builtinModules = JSC::JSArray::create(
      vm,
      globalObject->arrayStructureForIndexingTypeDuringAllocation(
          ArrayWithContiguous),
      7);
  builtinModules->putDirectIndex(globalObject, 0,
                                 JSC::jsString(vm, String("node:assert"_s)));
  builtinModules->putDirectIndex(globalObject, 1,
                                 JSC::jsString(vm, String("node:buffer"_s)));
  builtinModules->putDirectIndex(globalObject, 2,
                                 JSC::jsString(vm, String("node:events"_s)));
  builtinModules->putDirectIndex(globalObject, 3,
                                 JSC::jsString(vm, String("node:util"_s)));
  builtinModules->putDirectIndex(globalObject, 4,
                                 JSC::jsString(vm, String("node:path"_s)));
  builtinModules->putDirectIndex(globalObject, 5,
                                 JSC::jsString(vm, String("bun:ffi"_s)));
  builtinModules->putDirectIndex(globalObject, 6,
                                 JSC::jsString(vm, String("bun:sqlite"_s)));

  append(JSC::Identifier::fromString(vm, "builtinModules"_s), builtinModules);

  defaultObject->putDirect(vm,
                           JSC::PropertyName(Identifier::fromUid(
                               vm.symbolRegistry().symbolForKey("CommonJS"_s))),
                           jsNumber(0), 0);

  exportNames.append(vm.propertyNames->defaultKeyword);
  exportValues.append(defaultObject);
}
} // namespace Zig
