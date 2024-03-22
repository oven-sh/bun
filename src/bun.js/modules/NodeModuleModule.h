#pragma once

#include "CommonJSModuleRecord.h"
#include "ImportMetaObject.h"
#include "_NativeModule.h"
#include "isBuiltinModule.h"
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>

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
    "bun:ffi"_s,
    "bun:jsc"_s,
    "bun:sqlite"_s,
    "bun:test"_s,
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

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeModuleModuleConstructor,
                         (JSC::JSGlobalObject * globalObject,
                          JSC::CallFrame *callFrame)) {
  // In node, this is supposed to be the actual CommonJSModule constructor.
  // We are cutting a huge corner by not doing all that work.
  // This code is only to support babel.
  JSC::VM &vm = globalObject->vm();
  JSString *idString = JSC::jsString(vm, WTF::String("."_s));

  JSString *dirname = jsEmptyString(vm);

  // TODO: handle when JSGlobalObject !== Zig::GlobalObject, such as in node:vm
  Structure *structure = static_cast<Zig::GlobalObject *>(globalObject)
                             ->CommonJSModuleObjectStructure();

  // TODO: handle ShadowRealm, node:vm, new.target, subclasses
  JSValue idValue = callFrame->argument(0);
  JSValue parentValue = callFrame->argument(1);

  auto scope = DECLARE_THROW_SCOPE(vm);
  if (idValue.isString()) {
    idString = idValue.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::jsUndefined()));

    auto index = idString->tryGetValue().reverseFind('/', idString->length());

    if (index != WTF::notFound) {
      dirname = JSC::jsSubstring(globalObject, idString, 0, index);
    }
  }

  auto *out = Bun::JSCommonJSModule::create(vm, structure, idString, jsNull(),
                                            dirname, SourceCode());

  if (!parentValue.isUndefined())
    out->putDirect(vm, JSC::Identifier::fromString(vm, "parent"_s), parentValue,
                   0);

  out->putDirect(vm, JSC::Identifier::fromString(vm, "exports"_s),
                 JSC::constructEmptyObject(globalObject,
                                           globalObject->objectPrototype(), 0),
                 0);
  return JSValue::encode(out);
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

  return JSValue::encode(jsBoolean(Bun::isBuiltinModule(moduleStr)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionWrap, (JSC::JSGlobalObject * globalObject,
                                          JSC::CallFrame *callFrame)) {
  auto &vm = globalObject->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);
  JSString *code = callFrame->argument(0).toStringOrNull(globalObject);
  RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::jsUndefined()));
  if (!code) {
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  JSString *prefix = jsString(
      vm,
      String(
          "(function (exports, require, module, __filename, __dirname) { "_s));
  JSString *suffix = jsString(vm, String("\n});"_s));

  return JSValue::encode(jsString(globalObject, prefix, code, suffix));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeModuleCreateRequire,
                         (JSC::JSGlobalObject * globalObject,
                          JSC::CallFrame *callFrame)) {
  JSC::VM &vm = globalObject->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);
  if (callFrame->argumentCount() < 1) {
    throwTypeError(globalObject, scope,
                   "createRequire() requires at least one argument"_s);
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode({}));
  }

  auto val = callFrame->uncheckedArgument(0).toWTFString(globalObject);

  if (val.startsWith("file://"_s)) {
    WTF::URL url(val);
    if (!url.isValid()) {
      throwTypeError(globalObject, scope,
                     makeString("createRequire() was given an invalid URL '"_s,
                                url.string(), "'"_s));
      ;
      RELEASE_AND_RETURN(scope, JSValue::encode({}));
    }
    if (!url.protocolIsFile()) {
      throwTypeError(globalObject, scope,
                     "createRequire() does not support non-file URLs"_s);
      RELEASE_AND_RETURN(scope, JSValue::encode({}));
    }
    val = url.fileSystemPath();
  }

  RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::jsUndefined()));
  RELEASE_AND_RETURN(
      scope, JSValue::encode(Bun::JSCommonJSModule::createBoundRequireFunction(
                 vm, globalObject, val)));
}
extern "C" JSC::EncodedJSValue Resolver__nodeModulePathsForJS(JSGlobalObject *,
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
    JSC::JSValue fromValue = callFrame->argument(1);

    if (moduleName.isUndefinedOrNull()) {
      auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
      JSC::throwTypeError(globalObject, scope,
                          "Module._resolveFileName expects a string"_s);
      scope.release();
      return JSC::JSValue::encode(JSC::JSValue{});
    }

    if (
        // fast path: it's a real CommonJS module object.
        auto *cjs = jsDynamicCast<Bun::JSCommonJSModule *>(fromValue)) {
      fromValue = cjs->id();
    } else if
        // slow path: userland code did something weird. lets let them do that
        // weird thing.
        (fromValue.isObject()) {

      if (auto idValue = fromValue.getObject()->getIfPropertyExists(
              globalObject, Identifier::fromString(vm, "filename"_s))) {
        if (idValue.isString()) {
          fromValue = idValue;
        }
      }
    }

    auto result =
        Bun__resolveSync(globalObject, JSC::JSValue::encode(moduleName),
                         JSValue::encode(fromValue), false);
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

JSC_DEFINE_CUSTOM_GETTER(get_resolveFilename, (JSGlobalObject * globalObject,
                                               EncodedJSValue thisValue,
                                               PropertyName propertyName)) {
  auto override = static_cast<Zig::GlobalObject *>(globalObject)
                      ->m_nodeModuleOverriddenResolveFilename.get();
  if (override) {
    return JSValue::encode(override);
  }
  // Instead of storing the original function on the global object and have
  // those extra bytes, just have it be a property alias.
  JSObject *thisObject = JSValue::decode(thisValue).getObject();
  if (!thisObject)
    return JSValue::encode(jsUndefined());
  auto &vm = globalObject->vm();
  return JSValue::encode(thisObject->getDirect(
      vm, Identifier::fromString(vm, "__resolveFilename"_s)));
}

JSC_DEFINE_CUSTOM_SETTER(set_resolveFilename,
                         (JSGlobalObject * globalObject,
                          EncodedJSValue thisValue, EncodedJSValue value,
                          PropertyName propertyName)) {
  auto valueJS = JSValue::decode(value);
  if (valueJS.isCell()) {
    if (auto fn = jsDynamicCast<JSFunction *>(valueJS.asCell())) {
      static_cast<Zig::GlobalObject *>(globalObject)
          ->m_nodeModuleOverriddenResolveFilename.set(globalObject->vm(),
                                                      globalObject, fn);
      return true;
    }
  }
  return false;
}

// These two setters are only used if you directly hit
// `Module.prototype.require` or `module.require`. When accessing the cjs
// require argument, this is a bound version of `require`, which calls into the
// overridden one.
//
// This require function also intentionally does not have .resolve on it, nor
// does it have any of the other properties.
//
// Note: allowing require to be overridable at all is only needed for Next.js to
// work (they do Module.prototype.require = ...)

JSC_DEFINE_CUSTOM_GETTER(getterRequireFunction,
                         (JSC::JSGlobalObject * globalObject,
                          JSC::EncodedJSValue thisValue, JSC::PropertyName)) {
  return JSValue::encode(globalObject->getDirect(
      globalObject->vm(), WebCore::clientData(globalObject->vm())
                              ->builtinNames()
                              .overridableRequirePrivateName()));
}

JSC_DEFINE_CUSTOM_SETTER(setterRequireFunction,
                         (JSC::JSGlobalObject * globalObject,
                          JSC::EncodedJSValue thisValue,
                          JSC::EncodedJSValue value,
                          JSC::PropertyName propertyName)) {
  globalObject->putDirect(globalObject->vm(),
                          WebCore::clientData(globalObject->vm())
                              ->builtinNames()
                              .overridableRequirePrivateName(),
                          JSValue::decode(value), 0);
  return true;
}

namespace Zig {

DEFINE_NATIVE_MODULE(NodeModule) {
  // the default object here is a function, so we cant use the
  // INIT_NATIVE_MODULE helper

  Zig::GlobalObject *globalObject =
      reinterpret_cast<Zig::GlobalObject *>(lexicalGlobalObject);
  JSC::VM &vm = globalObject->vm();
  JSC::JSObject *defaultObject = JSC::JSFunction::create(
      vm, globalObject, 0, "Module"_s, jsFunctionNodeModuleModuleConstructor,
      JSC::ImplementationVisibility::Public, JSC::NoIntrinsic,
      jsFunctionNodeModuleModuleConstructor);
  auto put = [&](JSC::Identifier name, JSC::JSValue value) {
    defaultObject->putDirect(vm, name, value);
    exportNames.append(name);
    exportValues.append(value);
  };
  auto putNativeFn = [&](JSC::Identifier name, JSC::NativeFunction ptr) {
    JSC::JSFunction *value = JSC::JSFunction::create(
        vm, globalObject, 1, name.string(), ptr,
        JSC::ImplementationVisibility::Public, JSC::NoIntrinsic, ptr);
    defaultObject->putDirect(vm, name, value);
    exportNames.append(name);
    exportValues.append(value);
  };
  exportNames.reserveCapacity(16);
  exportValues.ensureCapacity(16);
  exportNames.append(vm.propertyNames->defaultKeyword);
  exportValues.append(defaultObject);

  put(Identifier::fromString(vm, "Module"_s), defaultObject);

  // Module._extensions === require.extensions
  put(Identifier::fromString(vm, "_extensions"_s),
      globalObject->requireFunctionUnbound()->get(
          globalObject, Identifier::fromString(vm, "extensions"_s)));

  defaultObject->putDirectCustomAccessor(
      vm, JSC::Identifier::fromString(vm, "_resolveFilename"_s),
      JSC::CustomGetterSetter::create(vm, get_resolveFilename,
                                      set_resolveFilename),
      JSC::PropertyAttribute::CustomAccessor | 0);
  putNativeFn(Identifier::fromString(vm, "__resolveFilename"_s),
              jsFunctionResolveFileName);

  putNativeFn(Identifier::fromString(vm, "createRequire"_s),
              jsFunctionNodeModuleCreateRequire);
  putNativeFn(Identifier::fromString(vm, "paths"_s),
              Resolver__nodeModulePathsForJS);
  putNativeFn(Identifier::fromString(vm, "findSourceMap"_s),
              jsFunctionFindSourceMap);
  putNativeFn(Identifier::fromString(vm, "syncBuiltinExports"_s),
              jsFunctionSyncBuiltinExports);
  putNativeFn(Identifier::fromString(vm, "SourceMap"_s), jsFunctionSourceMap);
  putNativeFn(Identifier::fromString(vm, "isBuiltin"_s),
              jsFunctionIsBuiltinModule);
  putNativeFn(Identifier::fromString(vm, "_nodeModulePaths"_s),
              Resolver__nodeModulePathsForJS);
  putNativeFn(Identifier::fromString(vm, "wrap"_s), jsFunctionWrap);

  put(Identifier::fromString(vm, "_cache"_s),
      jsCast<Zig::GlobalObject *>(globalObject)->lazyRequireCacheObject());

  put(Identifier::fromString(vm, "globalPaths"_s),
      constructEmptyArray(globalObject, nullptr, 0));

  auto prototype =
      constructEmptyObject(globalObject, globalObject->objectPrototype(), 1);
  prototype->putDirectCustomAccessor(
      vm, JSC::Identifier::fromString(vm, "require"_s),
      JSC::CustomGetterSetter::create(vm, getterRequireFunction,
                                      setterRequireFunction),
      0);

  defaultObject->putDirect(vm, vm.propertyNames->prototype, prototype);

  JSC::JSArray *builtinModules = JSC::JSArray::create(
      vm,
      globalObject->arrayStructureForIndexingTypeDuringAllocation(
          ArrayWithContiguous),
      countof(builtinModuleNames));

  for (unsigned i = 0; i < countof(builtinModuleNames); ++i) {
    builtinModules->putDirectIndex(
        globalObject, i, JSC::jsString(vm, String(builtinModuleNames[i])));
  }

  put(JSC::Identifier::fromString(vm, "builtinModules"_s), builtinModules);
}

} // namespace Zig
