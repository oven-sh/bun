#include "root.h"

#include "./NodeModuleModule.h"

#include "ImportMetaObject.h"
#include "JavaScriptCore/JSBoundFunction.h"
#include "JavaScriptCore/ObjectConstructor.h"
using namespace Zig;
using namespace JSC;

// This is a mix of bun's builtin module names and also the ones reported by
// node v20.4.0
static constexpr ASCIILiteral builtinModuleNames[] = {
    "_http_agent"_s,
    "_http_client"_s,
    "_http_common"_s,
    "_http_incoming"_s,
    "_http_outgoing"_s,
    "_http_server"_s,
    "_stream_duplex"_s,
    "_stream_passthrough"_s,
    "_stream_readable"_s,
    "_stream_transform"_s,
    "_stream_wrap"_s,
    "_stream_writable"_s,
    "_tls_common"_s,
    "_tls_wrap"_s,
    "assert"_s,
    "assert/strict"_s,
    "async_hooks"_s,
    "buffer"_s,
    "bun"_s,
    "bun:events_native"_s,
    "bun:ffi"_s,
    "bun:jsc"_s,
    "bun:sqlite"_s,
    "bun:wrap"_s,
    "child_process"_s,
    "cluster"_s,
    "console"_s,
    "constants"_s,
    "crypto"_s,
    "detect-libc"_s,
    "dgram"_s,
    "diagnostics_channel"_s,
    "dns"_s,
    "dns/promises"_s,
    "domain"_s,
    "events"_s,
    "fs"_s,
    "fs/promises"_s,
    "http"_s,
    "http2"_s,
    "https"_s,
    "inspector"_s,
    "inspector/promises"_s,
    "module"_s,
    "net"_s,
    "os"_s,
    "path"_s,
    "path/posix"_s,
    "path/win32"_s,
    "perf_hooks"_s,
    "process"_s,
    "punycode"_s,
    "querystring"_s,
    "readline"_s,
    "readline/promises"_s,
    "repl"_s,
    "stream"_s,
    "stream/consumers"_s,
    "stream/promises"_s,
    "stream/web"_s,
    "string_decoder"_s,
    "sys"_s,
    "timers"_s,
    "timers/promises"_s,
    "tls"_s,
    "trace_events"_s,
    "tty"_s,
    "undici"_s,
    "url"_s,
    "util"_s,
    "util/types"_s,
    "v8"_s,
    "vm"_s,
    "wasi"_s,
    "worker_threads"_s,
    "ws"_s,
    "zlib"_s,
};

static bool isBuiltinModule(const String &namePossiblyWithNodePrefix) {
  String name = namePossiblyWithNodePrefix;
  if (name.startsWith("node:"_s))
    name = name.substringSharingImpl(5);

  for (auto &builtinModule : builtinModuleNames) {
    if (name == builtinModule)
      return true;
  }
  return false;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsBuiltinModule,
                         (JSC::JSGlobalObject * globalObject,
                          JSC::CallFrame *callFrame)) {
  JSC::VM &vm = globalObject->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);
  JSValue moduleName = callFrame->argument(0);
  if (!moduleName.isString()) {
    return JSValue::encode(jsBoolean(false));
  }

  auto moduleStr = moduleName.toWTFString(globalObject);
  RETURN_IF_EXCEPTION(scope, JSValue::encode(jsBoolean(false)));

  return JSValue::encode(jsBoolean(isBuiltinModule(moduleStr)));
}

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
template <std::size_t N, class T> consteval std::size_t countof(T (&)[N]) {
  return N;
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

  append(Identifier::fromString(vm, "isBuiltin"_s),
         JSFunction::create(vm, globalObject, 1, String("isBuiltin"_s),
                            jsFunctionIsBuiltinModule,
                            ImplementationVisibility::Public, NoIntrinsic,
                            jsFunctionIsBuiltinModule, nullptr));

  append(JSC::Identifier::fromString(vm, "_resolveFilename"_s),
         JSFunction::create(vm, globalObject, 3, String("_resolveFilename"_s),
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

  append(JSC::Identifier::fromString(vm, "prototype"_s),
         JSC::constructEmptyObject(globalObject));

  JSC::JSArray *builtinModules = JSC::JSArray::create(
      vm,
      globalObject->arrayStructureForIndexingTypeDuringAllocation(
          ArrayWithContiguous),
      countof(builtinModuleNames));

  for (unsigned i = 0; i < countof(builtinModuleNames); ++i) {
    builtinModules->putDirectIndex(
        globalObject, i, JSC::jsString(vm, String(builtinModuleNames[i])));
  }

  append(JSC::Identifier::fromString(vm, "builtinModules"_s), builtinModules);

  defaultObject->putDirect(vm,
                           JSC::PropertyName(Identifier::fromUid(
                               vm.symbolRegistry().symbolForKey("CommonJS"_s))),
                           jsNumber(0), 0);

  exportNames.append(vm.propertyNames->defaultKeyword);
  exportValues.append(defaultObject);
}
} // namespace Zig
