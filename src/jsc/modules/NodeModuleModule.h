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
#include <JavaScriptCore/AdaptiveInferredPropertyValueWatchpointBase.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>

using namespace Zig;
using namespace JSC;

namespace Bun {
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsModuleResolveFilenameSlowPathEnabled);
JSC_DECLARE_HOST_FUNCTION(jsFunctionLoaderHookWatchpoints);
// Module._resolveFilename and Module.prototype.require are data properties, and require() calls what they hold.
// It reads neither before a program changes it: one of these is on each property, and the engine fires it at the
// first change of any kind (an assignment, Object.defineProperty, delete, a native putDirect). It fires once:
// from then on require() reads the property for as long as the realm lives.
enum class LoaderHook : bool { ResolveFilename, Require };
class LoaderHookWatchpoint final : public JSC::AdaptiveInferredPropertyValueWatchpointBase {
    WTF_MAKE_TZONE_ALLOCATED(LoaderHookWatchpoint);

public:
    LoaderHookWatchpoint(Zig::GlobalObject*, const JSC::ObjectPropertyCondition&, LoaderHook);

private:
    bool isValid() const final;
    void handleFire(JSC::VM&, const JSC::FireDetail&) final;

    Zig::GlobalObject* m_globalObject;
    LoaderHook m_hook;
};

// What Module._resolveFilename holds, for a realm whose `hasOverriddenModuleResolveFilenameFunction` is set.
// Empty if that is the default function again.
JSC::JSValue replacedModuleResolveFilename(JSC::JSGlobalObject* lexicalGlobalObject, Zig::GlobalObject*);
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

}

namespace Zig {

JSC::JSObject *generateNativeModule_NodeModule(
  JSC::JSGlobalObject *lexicalGlobalObject, JSC::Identifier moduleKey,
  Vector<JSC::Identifier, 4> &exportNames,
  JSC::MarkedArgumentBuffer &exportValues);


} // namespace Zig
