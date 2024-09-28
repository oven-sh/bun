// clang-format off
#pragma once

#include "root.h"

#include "CommonJSModuleRecord.h"
#include "ImportMetaObject.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/JSGlobalObjectInlines.h"
#include "_NativeModule.h"
#include "isBuiltinModule.h"
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>


using namespace Zig;
using namespace JSC;


namespace Bun {
  void addNodeModuleConstructorProperties(JSC::VM &vm, Zig::GlobalObject *globalObject);
}






namespace Zig {

DEFINE_NATIVE_MODULE(NodeModule) {
  // the default object here is a function, so we cant use the
  // INIT_NATIVE_MODULE helper
  Zig::GlobalObject *globalObject = reinterpret_cast<Zig::GlobalObject *>(lexicalGlobalObject);
  JSC::VM &vm = globalObject->vm();
  auto scope = DECLARE_CATCH_SCOPE(vm);
  auto *object = globalObject->m_nodeModuleConstructor.getInitializedOnMainThread(globalObject);
  

const auto _cacheIdentifier = Identifier::fromString(vm, "_cache"_s);
  auto _cacheValue =
      object->getIfPropertyExists(globalObject, _cacheIdentifier);
  if (scope.exception()) {
    scope.clearException();
    _cacheValue = jsUndefined();
  }
  const auto _debugIdentifier = Identifier::fromString(vm, "_debug"_s);
  auto _debugValue =
      object->getIfPropertyExists(globalObject, _debugIdentifier);
  if (scope.exception()) {
    scope.clearException();
    _debugValue = jsUndefined();
  }
  const auto _extensionsIdentifier =
      Identifier::fromString(vm, "_extensions"_s);
  auto _extensionsValue =
      object->getIfPropertyExists(globalObject, _extensionsIdentifier);
  if (scope.exception()) {
    scope.clearException();
    _extensionsValue = jsUndefined();
  }
  const auto _findPathIdentifier = Identifier::fromString(vm, "_findPath"_s);
  auto _findPathValue =
      object->getIfPropertyExists(globalObject, _findPathIdentifier);
  if (scope.exception()) {
    scope.clearException();
    _findPathValue = jsUndefined();
  }
  const auto _initPathsIdentifier = Identifier::fromString(vm, "_initPaths"_s);
  auto _initPathsValue =
      object->getIfPropertyExists(globalObject, _initPathsIdentifier);
  if (scope.exception()) {
    scope.clearException();
    _initPathsValue = jsUndefined();
  }
  const auto _loadIdentifier = Identifier::fromString(vm, "_load"_s);
  auto _loadValue = object->getIfPropertyExists(globalObject, _loadIdentifier);
  if (scope.exception()) {
    scope.clearException();
    _loadValue = jsUndefined();
  }
  
  const auto _nodeModulePathsIdentifier =
      Identifier::fromString(vm, "_nodeModulePaths"_s);
  auto _nodeModulePathsValue =
      object->getIfPropertyExists(globalObject, _nodeModulePathsIdentifier);
  if (scope.exception()) {
    scope.clearException();
    _nodeModulePathsValue = jsUndefined();
  }
  const auto _pathCacheIdentifier = Identifier::fromString(vm, "_pathCache"_s);
  auto _pathCacheValue =
      object->getIfPropertyExists(globalObject, _pathCacheIdentifier);
  if (scope.exception()) {
    scope.clearException();
    _pathCacheValue = jsUndefined();
  }
  const auto _preloadModulesIdentifier =
      Identifier::fromString(vm, "_preloadModules"_s);
  auto _preloadModulesValue =
      object->getIfPropertyExists(globalObject, _preloadModulesIdentifier);
  if (scope.exception()) {
    scope.clearException();
    _preloadModulesValue = jsUndefined();
  }
  const auto _resolveFilenameIdentifier =
      Identifier::fromString(vm, "_resolveFilename"_s);
  auto _resolveFilenameValue =
      object->getIfPropertyExists(globalObject, _resolveFilenameIdentifier);
  if (scope.exception()) {
    scope.clearException();
    _resolveFilenameValue = jsUndefined();
  }
  const auto _resolveLookupPathsIdentifier =
      Identifier::fromString(vm, "_resolveLookupPaths"_s);
  auto _resolveLookupPathsValue =
      object->getIfPropertyExists(globalObject, _resolveLookupPathsIdentifier);
  if (scope.exception()) {
    scope.clearException();
    _resolveLookupPathsValue = jsUndefined();
  }
  const auto builtinModulesIdentifier =
      Identifier::fromString(vm, "builtinModules"_s);
  auto builtinModulesValue =
      object->getIfPropertyExists(globalObject, builtinModulesIdentifier);
  if (scope.exception()) {
    scope.clearException();
    builtinModulesValue = jsUndefined();
  }
  const auto constantsIdentifier = Identifier::fromString(vm, "constants"_s);
  auto constantsValue =
      object->getIfPropertyExists(globalObject, constantsIdentifier);
  if (scope.exception()) {
    scope.clearException();
    constantsValue = jsUndefined();
  }
  const auto createRequireIdentifier =
      Identifier::fromString(vm, "createRequire"_s);
  auto createRequireValue =
      object->getIfPropertyExists(globalObject, createRequireIdentifier);
  if (scope.exception()) {
    scope.clearException();
    createRequireValue = jsUndefined();
  }
  const auto enableCompileCacheIdentifier =
      Identifier::fromString(vm, "enableCompileCache"_s);
  auto enableCompileCacheValue =
      object->getIfPropertyExists(globalObject, enableCompileCacheIdentifier);
  if (scope.exception()) {
    scope.clearException();
    enableCompileCacheValue = jsUndefined();
  }
  const auto findSourceMapIdentifier =
      Identifier::fromString(vm, "findSourceMap"_s);
  auto findSourceMapValue =
      object->getIfPropertyExists(globalObject, findSourceMapIdentifier);
  if (scope.exception()) {
    scope.clearException();
    findSourceMapValue = jsUndefined();
  }
  const auto getCompileCacheDirIdentifier =
      Identifier::fromString(vm, "getCompileCacheDir"_s);
  auto getCompileCacheDirValue =
      object->getIfPropertyExists(globalObject, getCompileCacheDirIdentifier);
  if (scope.exception()) {
    scope.clearException();
    getCompileCacheDirValue = jsUndefined();
  }
  const auto globalPathsIdentifier =
      Identifier::fromString(vm, "globalPaths"_s);
  auto globalPathsValue =
      object->getIfPropertyExists(globalObject, globalPathsIdentifier);
  if (scope.exception()) {
    scope.clearException();
    globalPathsValue = jsUndefined();
  }
  const auto isBuiltinIdentifier = Identifier::fromString(vm, "isBuiltin"_s);
  auto isBuiltinValue =
      object->getIfPropertyExists(globalObject, isBuiltinIdentifier);
  if (scope.exception()) {
    scope.clearException();
    isBuiltinValue = jsUndefined();
  }
  const auto prototypeIdentifier = Identifier::fromString(vm, "prototype"_s);
  auto prototypeValue =
      object->getIfPropertyExists(globalObject, prototypeIdentifier);
  if (scope.exception()) {
    scope.clearException();
    prototypeValue = jsUndefined();
  }
  const auto registerIdentifier = Identifier::fromString(vm, "register"_s);
  auto registerValue =
      object->getIfPropertyExists(globalObject, registerIdentifier);
  if (scope.exception()) {
    scope.clearException();
    registerValue = jsUndefined();
  }
  const auto runMainIdentifier = Identifier::fromString(vm, "runMain"_s);
  auto runMainValue =
      object->getIfPropertyExists(globalObject, runMainIdentifier);
  if (scope.exception()) {
    scope.clearException();
    runMainValue = jsUndefined();
  }
  const auto SourceMapIdentifier = Identifier::fromString(vm, "SourceMap"_s);
  auto SourceMapValue =
      object->getIfPropertyExists(globalObject, SourceMapIdentifier);
  if (scope.exception()) {
    scope.clearException();
    SourceMapValue = jsUndefined();
  }
  const auto syncBuiltinESMExportsIdentifier =
      Identifier::fromString(vm, "syncBuiltinESMExports"_s);
  auto syncBuiltinESMExportsValue = object->getIfPropertyExists(
    globalObject, syncBuiltinESMExportsIdentifier);
if (scope.exception()) {
  scope.clearException();
  syncBuiltinESMExportsValue = jsUndefined();
}

  const auto wrapIdentifier = Identifier::fromString(vm, "wrap"_s);
  auto wrapValue = object->getIfPropertyExists(globalObject, wrapIdentifier);
  if (scope.exception()) {
    scope.clearException();
    wrapValue = jsUndefined();
  }



  exportNames.reserveCapacity(24+1);
  exportValues.ensureCapacity(24+1);
  exportNames.append(vm.propertyNames->defaultKeyword);
  exportValues.append(object); 

  exportNames.append(_cacheIdentifier);
  exportValues.append(_cacheValue);
  exportNames.append(_debugIdentifier);
  exportValues.append(_debugValue);
  exportNames.append(_extensionsIdentifier);
  exportValues.append(_extensionsValue);
  exportNames.append(_findPathIdentifier);
  exportValues.append(_findPathValue);
  exportNames.append(_initPathsIdentifier);
  exportValues.append(_initPathsValue);
  exportNames.append(_loadIdentifier);
  exportValues.append(_loadValue);
  exportNames.append(_nodeModulePathsIdentifier);
  exportValues.append(_nodeModulePathsValue);
  exportNames.append(_pathCacheIdentifier);
  exportValues.append(_pathCacheValue);
  exportNames.append(_preloadModulesIdentifier);
  exportValues.append(_preloadModulesValue);
  exportNames.append(_resolveFilenameIdentifier);
  exportValues.append(_resolveFilenameValue);
  exportNames.append(_resolveLookupPathsIdentifier);
  exportValues.append(_resolveLookupPathsValue);
  exportNames.append(builtinModulesIdentifier);
  exportValues.append(builtinModulesValue);
  exportNames.append(constantsIdentifier);
  exportValues.append(constantsValue);
  exportNames.append(createRequireIdentifier);
  exportValues.append(createRequireValue);
  exportNames.append(enableCompileCacheIdentifier);
  exportValues.append(enableCompileCacheValue);
  exportNames.append(findSourceMapIdentifier);
  exportValues.append(findSourceMapValue);
  exportNames.append(getCompileCacheDirIdentifier);
  exportValues.append(getCompileCacheDirValue);
  exportNames.append(globalPathsIdentifier);
  exportValues.append(globalPathsValue);
  exportNames.append(isBuiltinIdentifier);
  exportValues.append(isBuiltinValue);
  exportNames.append(prototypeIdentifier);
  exportValues.append(prototypeValue);
  exportNames.append(registerIdentifier);
  exportValues.append(registerValue);
  exportNames.append(runMainIdentifier);
  exportValues.append(runMainValue);
  exportNames.append(SourceMapIdentifier);
  exportValues.append(SourceMapValue);
  exportNames.append(syncBuiltinESMExportsIdentifier);
  exportValues.append(syncBuiltinESMExportsValue);
  exportNames.append(wrapIdentifier);
  exportValues.append(wrapValue);


  
}

} // namespace Zig
