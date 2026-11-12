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
JSC::JSValue createStreamIterEnabledFlag(Zig::GlobalObject*);
void addNodeModuleConstructorProperties(JSC::VM &vm, Zig::GlobalObject *globalObject);

extern "C" JSC::EncodedJSValue Resolver__nodeModulePathsJSValue(const BunString* specifier, JSC::JSGlobalObject*, bool use_dirname);
extern "C" bool ModuleLoader__isBuiltin(const char* data, size_t len);

struct PathResolveModule {
  JSArray* paths = nullptr;
  JSString* filename = nullptr;
  /// Derive `paths` from `filename` if needed
  bool pathsArrayLazy = false;
};
JSC::JSValue resolveLookupPaths(JSC::JSGlobalObject* globalObject, String request, PathResolveModule parent);

// What require(), require.resolve() and Module._resolveFilename() of `parent` find for `request`: a request for a package is looked up in the
// `paths` of `parent`, where it has any, as Node's Module._resolveLookupPaths reads them. `from`: the file name of `parent`.
// Every CommonJS request that has a parent comes through here.
JSC::EncodedJSValue resolveForRequire(JSC::JSGlobalObject*, JSC::JSValue request, JSC::JSValue parent, JSC::JSValue from, bool isRequireResolve);
// The same for `paths` of require.resolve(request, { paths }), once the program has replaced Module._nodeModulePaths: Node calls it with each
// entry and looks in the directories that it answers with.
JSC::EncodedJSValue resolveFromPathsOption(JSC::JSGlobalObject*, JSC::JSValue request, JSC::JSValue from, std::span<const BunString> paths, bool isRequireResolve);
// Whether the program has put a function of its own in the place of Module._nodeModulePaths. The property stays the data property
// that it is in Node and nothing watches the write, so this looks at what is stored.
bool isNodeModulePathsReplaced(Zig::GlobalObject*);
// A module that is loaded after that gets its `paths` from the function, as in Node's Module.prototype.load.
void setModulePathsFromReplacedNodeModulePaths(Zig::GlobalObject*, JSCommonJSModule*);

}

namespace Zig {

JSC::JSObject *generateNativeModule_NodeModule(
  JSC::JSGlobalObject *lexicalGlobalObject, JSC::Identifier moduleKey,
  Vector<JSC::Identifier, 4> &exportNames,
  JSC::MarkedArgumentBuffer &exportValues);


} // namespace Zig
