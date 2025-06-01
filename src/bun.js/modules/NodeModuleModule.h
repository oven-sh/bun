// clang-format off
#pragma once

#include "root.h"

#include "JSCommonJSModule.h"
#include "ImportMetaObject.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSGlobalObjectInlines.h"
#include "_NativeModule.h"
#include "isBuiltinModule.h"
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>

using namespace Zig;
using namespace JSC;

namespace Bun {
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsModuleResolveFilenameSlowPathEnabled);
void addNodeModuleConstructorProperties(JSC::VM &vm, Zig::GlobalObject *globalObject);

extern "C" JSC::EncodedJSValue Resolver__nodeModulePathsJSValue(BunString specifier, JSC::JSGlobalObject*, bool use_dirname);
extern "C" bool ModuleLoader__isBuiltin(const char* data, size_t len);

struct PathResolveModule {
  JSArray* paths = nullptr;
  JSString* filename = nullptr;
  /// Derive `paths` from `filename` if needed
  bool pathsArrayLazy = false;
};
JSC::JSValue resolveLookupPaths(JSC::JSGlobalObject* globalObject, String request, PathResolveModule parent);

}

namespace Zig {

void generateNativeModule_NodeModule(                                     
  JSC::JSGlobalObject *lexicalGlobalObject, JSC::Identifier moduleKey,     
  Vector<JSC::Identifier, 4> &exportNames,
  JSC::MarkedArgumentBuffer &exportValues);  


} // namespace Zig
