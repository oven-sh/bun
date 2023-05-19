#include "BundlerPluginBuiltins.h"
#include "ByteLengthQueuingStrategyBuiltins.h"
#include "ConsoleObjectBuiltins.h"
#include "CountQueuingStrategyBuiltins.h"
#include "ImportMetaObjectBuiltins.h"
#include "JSBufferConstructorBuiltins.h"
#include "JSBufferPrototypeBuiltins.h"
#include "ProcessObjectInternalsBuiltins.h"
#include "ReadableByteStreamControllerBuiltins.h"
#include "ReadableByteStreamInternalsBuiltins.h"
#include "ReadableStreamBYOBReaderBuiltins.h"
#include "ReadableStreamBYOBRequestBuiltins.h"
#include "ReadableStreamBuiltins.h"
#include "ReadableStreamDefaultControllerBuiltins.h"
#include "ReadableStreamDefaultReaderBuiltins.h"
#include "ReadableStreamInternalsBuiltins.h"
#include "StreamInternalsBuiltins.h"
#include "TransformStreamBuiltins.h"
#include "TransformStreamDefaultControllerBuiltins.h"
#include "TransformStreamInternalsBuiltins.h"
#include "WebCoreJSClientData.h"
#include "WritableStreamDefaultControllerBuiltins.h"
#include "WritableStreamDefaultWriterBuiltins.h"
#include "WritableStreamInternalsBuiltins.h"
#include "config.h"
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/ImplementationVisibility.h>
#include <JavaScriptCore/Intrinsic.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/VM.h>

namespace WebCore {

/* BundlerPlugin.ts */
// runSetupFunction
const JSC::ConstructAbility
    s_bundlerPluginRunSetupFunctionCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_bundlerPluginRunSetupFunctionCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_bundlerPluginRunSetupFunctionCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_bundlerPluginRunSetupFunctionCodeLength = 4134;
static const JSC::Intrinsic s_bundlerPluginRunSetupFunctionCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_bundlerPluginRunSetupFunctionCode =
    "(function(setup, config) {\n  \"use strict\";\n  var onLoadPlugins = new "
    "Map, onResolvePlugins = new Map;\n  function validate(filterObject, "
    "callback, map) {\n    if (!filterObject || !@isObject(filterObject))\n    "
    "  @throwTypeError('Expected an object with \"filter\" RegExp');\n    if "
    "(!callback || !@isCallable(callback))\n      @throwTypeError(\"callback "
    "must be a function\");\n    var { filter, namespace = \"file\" } = "
    "filterObject;\n    if (!filter)\n      @throwTypeError('Expected an "
    "object with \"filter\" RegExp');\n    if (!@isRegExpObject(filter))\n     "
    " @throwTypeError(\"filter must be a RegExp\");\n    if (namespace && "
    "typeof namespace !== \"string\")\n      @throwTypeError(\"namespace must "
    "be a string\");\n    if ((namespace\?.length \?\? 0) === 0)\n      "
    "namespace = \"file\";\n    if "
    "(!/^([/@a-zA-Z0-9_\\\\-]+)$/.test(namespace))\n      "
    "@throwTypeError(\"namespace can only contain $a-zA-Z0-9_\\\\-\");\n    "
    "var callbacks = map.@get(namespace);\n    if (!callbacks)\n      "
    "map.@set(namespace, [[filter, callback]]);\n    else\n      "
    "@arrayPush(callbacks, [filter, callback]);\n  }\n  function "
    "onLoad(filterObject, callback) {\n    validate(filterObject, callback, "
    "onLoadPlugins);\n  }\n  function onResolve(filterObject, callback) {\n    "
    "validate(filterObject, callback, onResolvePlugins);\n  }\n  function "
    "onStart(callback) {\n    @throwTypeError(`@{@2} is not implemented yet. "
    "See https://github.com/oven-sh/bun/issues/@1`);\n  }\n  function "
    "onEnd(callback) {\n    @throwTypeError(`@{@2} is not implemented yet. See "
    "https://github.com/oven-sh/bun/issues/@1`);\n  }\n  function "
    "onDispose(callback) {\n    @throwTypeError(`@{@2} is not implemented yet. "
    "See https://github.com/oven-sh/bun/issues/@1`);\n  }\n  function "
    "resolve(callback) {\n    @throwTypeError(`@{@2} is not implemented yet. "
    "See https://github.com/oven-sh/bun/issues/@1`);\n  }\n  const "
    "processSetupResult = () => {\n    var anyOnLoad = !1, anyOnResolve = "
    "!1;\n    for (var [namespace, callbacks] of onLoadPlugins.entries())\n    "
    "  for (var [filter] of callbacks)\n        this.addFilter(filter, "
    "namespace, 1), anyOnLoad = !0;\n    for (var [namespace, callbacks] of "
    "onResolvePlugins.entries())\n      for (var [filter] of callbacks)\n      "
    "  this.addFilter(filter, namespace, 0), anyOnResolve = !0;\n    if "
    "(anyOnResolve) {\n      var onResolveObject = this.onResolve;\n      if "
    "(!onResolveObject)\n        this.onResolve = onResolvePlugins;\n      "
    "else\n        for (var [namespace, callbacks] of "
    "onResolvePlugins.entries()) {\n          var existing = "
    "onResolveObject.@get(namespace);\n          if (!existing)\n            "
    "onResolveObject.@set(namespace, callbacks);\n          else\n            "
    "onResolveObject.@set(namespace, existing.concat(callbacks));\n        }\n "
    "   }\n    if (anyOnLoad) {\n      var onLoadObject = this.onLoad;\n      "
    "if (!onLoadObject)\n        this.onLoad = onLoadPlugins;\n      else\n    "
    "    for (var [namespace, callbacks] of onLoadPlugins.entries()) {\n       "
    "   var existing = onLoadObject.@get(namespace);\n          if "
    "(!existing)\n            onLoadObject.@set(namespace, callbacks);\n       "
    "   else\n            onLoadObject.@set(namespace, "
    "existing.concat(callbacks));\n        }\n    }\n    return anyOnLoad || "
    "anyOnResolve;\n  };\n  var setupResult = setup({\n    config,\n    "
    "onDispose,\n    onEnd,\n    onLoad,\n    onResolve,\n    onStart,\n    "
    "resolve,\n    initialOptions: {\n      ...config,\n      bundle: !0,\n    "
    "  entryPoints: config.entrypoints \?\? config.entryPoints \?\? [],\n      "
    "minify: typeof config.minify === \"boolean\" \? config.minify : !1,\n     "
    " minifyIdentifiers: config.minify === !0 || "
    "config.minify\?.identifiers,\n      minifyWhitespace: config.minify === "
    "!0 || config.minify\?.whitespace,\n      minifySyntax: config.minify === "
    "!0 || config.minify\?.syntax,\n      outbase: config.root,\n      "
    "platform: config.target === \"bun\" \? \"node\" : config.target\n    },\n "
    "   esbuild: {}\n  });\n  if (setupResult && @isPromise(setupResult))\n    "
    "if (@getPromiseInternalField(setupResult, @promiseFieldFlags) & "
    "@promiseStateFulfilled)\n      setupResult = "
    "@getPromiseInternalField(setupResult, @promiseFieldReactionsOrResult);\n  "
    "  else\n      return setupResult.@then(processSetupResult);\n  return "
    "processSetupResult();\n})";

// runOnResolvePlugins
const JSC::ConstructAbility
    s_bundlerPluginRunOnResolvePluginsCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_bundlerPluginRunOnResolvePluginsCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_bundlerPluginRunOnResolvePluginsCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_bundlerPluginRunOnResolvePluginsCodeLength = 2990;
static const JSC::Intrinsic s_bundlerPluginRunOnResolvePluginsCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_bundlerPluginRunOnResolvePluginsCode =
    "(function(specifier, inputNamespace, importer, internalID, kindId) {\n  "
    "\"use strict\";\n  const kind = [\"entry-point\", \"import-statement\", "
    "\"require-call\", \"dynamic-import\", \"require-resolve\", "
    "\"import-rule\", \"url-token\", \"internal\"][kindId];\n  var "
    "promiseResult = (async (inputPath, inputNamespace2, importer2, kind2) => "
    "{\n    var { onResolve, onLoad } = this, results = "
    "onResolve.@get(inputNamespace2);\n    if (!results)\n      return "
    "this.onResolveAsync(internalID, null, null, null), null;\n    for (let "
    "[filter, callback] of results)\n      if (filter.test(inputPath)) {\n     "
    "   var result = callback({\n          path: inputPath,\n          "
    "importer: importer2,\n          namespace: inputNamespace2,\n          "
    "kind: kind2\n        });\n        while (result && @isPromise(result) && "
    "(@getPromiseInternalField(result, @promiseFieldFlags) & "
    "@promiseStateMask) === @promiseStateFulfilled)\n          result = "
    "@getPromiseInternalField(result, @promiseFieldReactionsOrResult);\n       "
    " if (result && @isPromise(result))\n          result = await result;\n    "
    "    if (!result || !@isObject(result))\n          continue;\n        var "
    "{ path, namespace: userNamespace = inputNamespace2, external } = "
    "result;\n        if (typeof path !== \"string\" || typeof userNamespace "
    "!== \"string\")\n          @throwTypeError(\"onResolve plugins must "
    "return an object with a string 'path' and string 'loader' field\");\n     "
    "   if (!path)\n          continue;\n        if (!userNamespace)\n         "
    " userNamespace = inputNamespace2;\n        if (typeof external !== "
    "\"boolean\" && !@isUndefinedOrNull(external))\n          "
    "@throwTypeError('onResolve plugins \"external\" field must be boolean or "
    "unspecified');\n        if (!external) {\n          if (userNamespace === "
    "\"file\") {\n            if (linux !== \"win32\") {\n              if "
    "(path[0] !== \"/\" || path.includes(\"..\"))\n                "
    "@throwTypeError('onResolve plugin \"path\" must be absolute when the "
    "namespace is \"file\"');\n            }\n          }\n          if "
    "(userNamespace === \"dataurl\") {\n            if "
    "(!path.startsWith(\"data:\"))\n              @throwTypeError('onResolve "
    "plugin \"path\" must start with \"data:\" when the namespace is "
    "\"dataurl\"');\n          }\n          if (userNamespace && userNamespace "
    "!== \"file\" && (!onLoad || !onLoad.@has(userNamespace)))\n            "
    "@throwTypeError(`Expected onLoad plugin for namespace ${userNamespace} to "
    "exist`);\n        }\n        return this.onResolveAsync(internalID, path, "
    "userNamespace, external), null;\n      }\n    return "
    "this.onResolveAsync(internalID, null, null, null), null;\n  })(specifier, "
    "inputNamespace, importer, kind);\n  while (promiseResult && "
    "@isPromise(promiseResult) && (@getPromiseInternalField(promiseResult, "
    "@promiseFieldFlags) & @promiseStateMask) === @promiseStateFulfilled)\n    "
    "promiseResult = @getPromiseInternalField(promiseResult, "
    "@promiseFieldReactionsOrResult);\n  if (promiseResult && "
    "@isPromise(promiseResult))\n    promiseResult.then(() => {\n    }, (e) => "
    "{\n      this.addError(internalID, e, 0);\n    });\n})";

// runOnLoadPlugins
const JSC::ConstructAbility
    s_bundlerPluginRunOnLoadPluginsCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_bundlerPluginRunOnLoadPluginsCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_bundlerPluginRunOnLoadPluginsCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_bundlerPluginRunOnLoadPluginsCodeLength = 2275;
static const JSC::Intrinsic s_bundlerPluginRunOnLoadPluginsCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_bundlerPluginRunOnLoadPluginsCode =
    "(function(internalID, path, namespace, defaultLoaderId) {\n  \"use "
    "strict\";\n  const LOADERS_MAP = { jsx: 0, js: 1, ts: 2, tsx: 3, css: 4, "
    "file: 5, json: 6, toml: 7, wasm: 8, napi: 9, base64: 10, dataurl: 11, "
    "text: 12 }, loaderName = [\"jsx\", \"js\", \"ts\", \"tsx\", \"css\", "
    "\"file\", \"json\", \"toml\", \"wasm\", \"napi\", \"base64\", "
    "\"dataurl\", \"text\"][defaultLoaderId];\n  var promiseResult = (async "
    "(internalID2, path2, namespace2, defaultLoader) => {\n    var results = "
    "this.onLoad.@get(namespace2);\n    if (!results)\n      return "
    "this.onLoadAsync(internalID2, null, null, null), null;\n    for (let "
    "[filter, callback] of results)\n      if (filter.test(path2)) {\n        "
    "var result = callback({\n          path: path2,\n          namespace: "
    "namespace2,\n          loader: defaultLoader\n        });\n        while "
    "(result && @isPromise(result) && (@getPromiseInternalField(result, "
    "@promiseFieldFlags) & @promiseStateMask) === @promiseStateFulfilled)\n    "
    "      result = @getPromiseInternalField(result, "
    "@promiseFieldReactionsOrResult);\n        if (result && "
    "@isPromise(result))\n          result = await result;\n        if "
    "(!result || !@isObject(result))\n          continue;\n        var { "
    "contents, loader = defaultLoader } = result;\n        if (typeof contents "
    "!== \"string\" && !@isTypedArrayView(contents))\n          "
    "@throwTypeError('onLoad plugins must return an object with \"contents\" "
    "as a string or Uint8Array');\n        if (typeof loader !== \"string\")\n "
    "         @throwTypeError('onLoad plugins must return an object with "
    "\"loader\" as a string');\n        const chosenLoader = "
    "LOADERS_MAP[loader];\n        if (chosenLoader === @undefined)\n          "
    "@throwTypeError(`Loader ${loader} is not supported.`);\n        return "
    "this.onLoadAsync(internalID2, contents, chosenLoader), null;\n      }\n   "
    " return this.onLoadAsync(internalID2, null, null), null;\n  "
    "})(internalID, path, namespace, loaderName);\n  while (promiseResult && "
    "@isPromise(promiseResult) && (@getPromiseInternalField(promiseResult, "
    "@promiseFieldFlags) & @promiseStateMask) === @promiseStateFulfilled)\n    "
    "promiseResult = @getPromiseInternalField(promiseResult, "
    "@promiseFieldReactionsOrResult);\n  if (promiseResult && "
    "@isPromise(promiseResult))\n    promiseResult.then(() => {\n    }, (e) => "
    "{\n      this.addError(internalID, e, 1);\n    });\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .bundlerPluginBuiltins()                                               \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .bundlerPluginBuiltins()                                    \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ByteLengthQueuingStrategy.ts */
// highWaterMark
const JSC::ConstructAbility
    s_byteLengthQueuingStrategyHighWaterMarkCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_byteLengthQueuingStrategyHighWaterMarkCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_byteLengthQueuingStrategyHighWaterMarkCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_byteLengthQueuingStrategyHighWaterMarkCodeLength = 270;
static const JSC::Intrinsic
    s_byteLengthQueuingStrategyHighWaterMarkCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_byteLengthQueuingStrategyHighWaterMarkCode =
    "(function() {\n  \"use strict\";\n  const highWaterMark = "
    "@getByIdDirectPrivate(this, \"highWaterMark\");\n  if (highWaterMark === "
    "@undefined)\n    "
    "@throwTypeError(\"ByteLengthQueuingStrategy.highWaterMark getter called "
    "on incompatible |this| value.\");\n  return highWaterMark;\n})";

// size
const JSC::ConstructAbility
    s_byteLengthQueuingStrategySizeCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_byteLengthQueuingStrategySizeCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_byteLengthQueuingStrategySizeCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_byteLengthQueuingStrategySizeCodeLength = 62;
static const JSC::Intrinsic s_byteLengthQueuingStrategySizeCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_byteLengthQueuingStrategySizeCode =
    "(function(chunk) {\n  return \"use strict\", chunk.byteLength;\n})";

// initializeByteLengthQueuingStrategy
const JSC::ConstructAbility
    s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCodeLength =
        146;
static const JSC::Intrinsic
    s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCode =
        "(function(parameters) {\n  \"use strict\", "
        "@putByIdDirectPrivate(this, \"highWaterMark\", "
        "@extractHighWaterMarkFromQueuingStrategyInit(parameters));\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .byteLengthQueuingStrategyBuiltins()                                   \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .byteLengthQueuingStrategyBuiltins()                        \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_BYTELENGTHQUEUINGSTRATEGY_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ConsoleObject.ts */
// asyncIterator
const JSC::ConstructAbility s_consoleObjectAsyncIteratorCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_consoleObjectAsyncIteratorCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_consoleObjectAsyncIteratorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_consoleObjectAsyncIteratorCodeLength = 1322;
static const JSC::Intrinsic s_consoleObjectAsyncIteratorCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_consoleObjectAsyncIteratorCode =
    "(function() {\n  \"use strict\";\n  const Iterator = async function* "
    "ConsoleAsyncIterator() {\n    var reader = "
    "@Bun.stdin.stream().getReader(), decoder = new "
    "globalThis.TextDecoder(\"utf-8\", { fatal: !1 }), deferredError, indexOf "
    "= @Bun.indexOfLine;\n    try {\n      while (!0) {\n        var done, "
    "value, pendingChunk;\n        const firstResult = reader.readMany();\n    "
    "    if (@isPromise(firstResult))\n          ({ done, value } = await "
    "firstResult);\n        else\n          ({ done, value } = firstResult);\n "
    "       if (done) {\n          if (pendingChunk)\n            yield "
    "decoder.decode(pendingChunk);\n          return;\n        }\n        var "
    "actualChunk;\n        for (let chunk of value) {\n          if "
    "(actualChunk = chunk, pendingChunk)\n            actualChunk = "
    "@Buffer.concat([pendingChunk, chunk]), pendingChunk = null;\n          "
    "var last = 0, i = indexOf(actualChunk, last);\n          while (i !== "
    "-1)\n            yield decoder.decode(actualChunk.subarray(last, i)), "
    "last = i + 1, i = indexOf(actualChunk, last);\n          pendingChunk = "
    "actualChunk.subarray(last);\n        }\n      }\n    } catch (e) {\n      "
    "deferredError = e;\n    } finally {\n      if (reader.releaseLock(), "
    "deferredError)\n        throw deferredError;\n    }\n  }, symbol = "
    "globalThis.Symbol.asyncIterator;\n  return this[symbol] = Iterator, "
    "Iterator();\n})";

// write
const JSC::ConstructAbility s_consoleObjectWriteCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_consoleObjectWriteCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_consoleObjectWriteCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_consoleObjectWriteCodeLength = 469;
static const JSC::Intrinsic s_consoleObjectWriteCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_consoleObjectWriteCode =
    "(function(input) {\n  \"use strict\";\n  var writer = "
    "@getByIdDirectPrivate(this, \"writer\");\n  if (!writer) {\n    var "
    "length = @toLength(input\?.length \?\? 0);\n    writer = "
    "@Bun.stdout.writer({ highWaterMark: length > 65536 \? length : 65536 }), "
    "@putByIdDirectPrivate(this, \"writer\", writer);\n  }\n  var wrote = "
    "writer.write(input);\n  const count = @argumentCount();\n  for (var i = "
    "1;i < count; i++)\n    wrote += writer.write(@argument(i));\n  return "
    "writer.flush(!0), wrote;\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .consoleObjectBuiltins()                                               \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .consoleObjectBuiltins()                                    \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* CountQueuingStrategy.ts */
// highWaterMark
const JSC::ConstructAbility
    s_countQueuingStrategyHighWaterMarkCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_countQueuingStrategyHighWaterMarkCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_countQueuingStrategyHighWaterMarkCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_countQueuingStrategyHighWaterMarkCodeLength = 265;
static const JSC::Intrinsic s_countQueuingStrategyHighWaterMarkCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_countQueuingStrategyHighWaterMarkCode =
    "(function() {\n  \"use strict\";\n  const highWaterMark = "
    "@getByIdDirectPrivate(this, \"highWaterMark\");\n  if (highWaterMark === "
    "@undefined)\n    @throwTypeError(\"CountQueuingStrategy.highWaterMark "
    "getter called on incompatible |this| value.\");\n  return "
    "highWaterMark;\n})";

// size
const JSC::ConstructAbility s_countQueuingStrategySizeCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_countQueuingStrategySizeCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_countQueuingStrategySizeCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_countQueuingStrategySizeCodeLength = 42;
static const JSC::Intrinsic s_countQueuingStrategySizeCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_countQueuingStrategySizeCode =
    "(function() {\n  return \"use strict\", 1;\n})";

// initializeCountQueuingStrategy
const JSC::ConstructAbility
    s_countQueuingStrategyInitializeCountQueuingStrategyCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_countQueuingStrategyInitializeCountQueuingStrategyCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_countQueuingStrategyInitializeCountQueuingStrategyCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_countQueuingStrategyInitializeCountQueuingStrategyCodeLength = 146;
static const JSC::Intrinsic
    s_countQueuingStrategyInitializeCountQueuingStrategyCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_countQueuingStrategyInitializeCountQueuingStrategyCode =
    "(function(parameters) {\n  \"use strict\", @putByIdDirectPrivate(this, "
    "\"highWaterMark\", "
    "@extractHighWaterMarkFromQueuingStrategyInit(parameters));\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .countQueuingStrategyBuiltins()                                        \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .countQueuingStrategyBuiltins()                             \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ImportMetaObject.ts */
// loadCJS2ESM
const JSC::ConstructAbility s_importMetaObjectLoadCJS2ESMCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_importMetaObjectLoadCJS2ESMCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_importMetaObjectLoadCJS2ESMCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_importMetaObjectLoadCJS2ESMCodeLength = 2419;
static const JSC::Intrinsic s_importMetaObjectLoadCJS2ESMCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_importMetaObjectLoadCJS2ESMCode =
    "(function(resolvedSpecifier) {\n  \"use strict\";\n  var loader = "
    "@Loader, queue = @createFIFO(), key = resolvedSpecifier;\n  while (key) "
    "{\n    var entry = loader.registry.@get(key);\n    if (!entry || "
    "!entry.state || entry.state <= @ModuleFetch)\n      "
    "@fulfillModuleSync(key), entry = loader.registry.@get(key);\n    var "
    "sourceCodeObject = @getPromiseInternalField(entry.fetch, "
    "@promiseFieldReactionsOrResult), moduleRecordPromise = "
    "loader.parseModule(key, sourceCodeObject), module = entry.module;\n    if "
    "(!module && moduleRecordPromise && @isPromise(moduleRecordPromise)) {\n   "
    "   var reactionsOrResult = @getPromiseInternalField(moduleRecordPromise, "
    "@promiseFieldReactionsOrResult), flags = "
    "@getPromiseInternalField(moduleRecordPromise, @promiseFieldFlags), state "
    "= flags & @promiseStateMask;\n      if (state === @promiseStatePending || "
    "reactionsOrResult && @isPromise(reactionsOrResult))\n        "
    "@throwTypeError(`require() async module \"${key}\" is unsupported`);\n    "
    "  else if (state === @promiseStateRejected)\n        "
    "@throwTypeError(`${reactionsOrResult\?.message \?\? \"An error "
    "occurred\"} while parsing module \\\"${key}\\\"`);\n      entry.module = "
    "module = reactionsOrResult;\n    } else if (moduleRecordPromise && "
    "!module)\n      entry.module = module = moduleRecordPromise;\n    "
    "@setStateToMax(entry, @ModuleLink);\n    var dependenciesMap = "
    "module.dependenciesMap, requestedModules = "
    "loader.requestedModules(module), dependencies = "
    "@newArrayWithSize(requestedModules.length);\n    for (var i = 0, length = "
    "requestedModules.length;i < length; ++i) {\n      var depName = "
    "requestedModules[i], depKey = depName[0] === \"/\" \? depName : "
    "loader.resolve(depName, key), depEntry = "
    "loader.ensureRegistered(depKey);\n      if (depEntry.state < "
    "@ModuleLink)\n        queue.push(depKey);\n      "
    "@putByValDirect(dependencies, i, depEntry), dependenciesMap.@set(depName, "
    "depEntry);\n    }\n    entry.dependencies = dependencies, "
    "entry.instantiate = @Promise.resolve(entry), entry.satisfy = "
    "@Promise.resolve(entry), key = queue.shift();\n    while (key && "
    "(loader.registry.@get(key)\?.state \?\? @ModuleFetch) >= @ModuleLink)\n   "
    "   key = queue.shift();\n  }\n  var linkAndEvaluateResult = "
    "loader.linkAndEvaluateModule(resolvedSpecifier, @undefined);\n  if "
    "(linkAndEvaluateResult && @isPromise(linkAndEvaluateResult))\n    "
    "@throwTypeError(`require() async module \\\"${resolvedSpecifier}\\\" is "
    "unsupported`);\n  return loader.registry.@get(resolvedSpecifier);\n})";

// requireESM
const JSC::ConstructAbility s_importMetaObjectRequireESMCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_importMetaObjectRequireESMCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_importMetaObjectRequireESMCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_importMetaObjectRequireESMCodeLength = 572;
static const JSC::Intrinsic s_importMetaObjectRequireESMCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_importMetaObjectRequireESMCode =
    "(function(resolved) {\n  \"use strict\";\n  var entry = "
    "@Loader.registry.@get(resolved);\n  if (!entry || !entry.evaluated)\n    "
    "entry = @loadCJS2ESM(resolved);\n  if (!entry || !entry.evaluated || "
    "!entry.module)\n    @throwTypeError(`require() failed to evaluate module "
    "\"${resolved}\". This is an internal consistentency error.`);\n  var "
    "exports = @Loader.getModuleNamespaceObject(entry.module), commonJS = "
    "exports.default, cjs = commonJS\?.[@commonJSSymbol];\n  if (cjs === 0)\n  "
    "  return commonJS;\n  else if (cjs && @isCallable(commonJS))\n    return "
    "commonJS();\n  return exports;\n})";

// internalRequire
const JSC::ConstructAbility
    s_importMetaObjectInternalRequireCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_importMetaObjectInternalRequireCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_importMetaObjectInternalRequireCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_importMetaObjectInternalRequireCodeLength = 923;
static const JSC::Intrinsic s_importMetaObjectInternalRequireCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_importMetaObjectInternalRequireCode =
    "(function(resolved) {\n  \"use strict\";\n  var cached = "
    "@requireMap.@get(resolved);\n  const last5 = "
    "resolved.substring(resolved.length - 5);\n  if (cached) {\n    if (last5 "
    "=== \".node\")\n      return cached.exports;\n    return cached;\n  }\n  "
    "if (last5 === \".json\") {\n    var fs = globalThis[Symbol.for(\"_fs\")] "
    "||= @Bun.fs(), exports = JSON.parse(fs.readFileSync(resolved, "
    "\"utf8\"));\n    return @requireMap.@set(resolved, exports), exports;\n  "
    "} else if (last5 === \".node\") {\n    var module = { exports: {} };\n    "
    "return process.dlopen(module, resolved), @requireMap.@set(resolved, "
    "module), module.exports;\n  } else if (last5 === \".toml\") {\n    var fs "
    "= globalThis[Symbol.for(\"_fs\")] ||= @Bun.fs(), exports = "
    "@Bun.TOML.parse(fs.readFileSync(resolved, \"utf8\"));\n    return "
    "@requireMap.@set(resolved, exports), exports;\n  } else {\n    var "
    "exports = @requireESM(resolved);\n    return @requireMap.@set(resolved, "
    "exports), exports;\n  }\n})";

// require
const JSC::ConstructAbility s_importMetaObjectRequireCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_importMetaObjectRequireCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_importMetaObjectRequireCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_importMetaObjectRequireCodeLength = 228;
static const JSC::Intrinsic s_importMetaObjectRequireCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_importMetaObjectRequireCode =
    "(function(name) {\n  \"use strict\";\n  const from = this\?.path \?\? "
    "arguments.callee.path;\n  if (typeof name !== \"string\")\n    "
    "@throwTypeError(\"require(name) must be a string\");\n  return "
    "@internalRequire(@resolveSync(name, from));\n})";

// main
const JSC::ConstructAbility s_importMetaObjectMainCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_importMetaObjectMainCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_importMetaObjectMainCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_importMetaObjectMainCodeLength = 64;
static const JSC::Intrinsic s_importMetaObjectMainCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_importMetaObjectMainCode =
    "(function() {\n  return \"use strict\", this.path === @Bun.main;\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .importMetaObjectBuiltins()                                            \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .importMetaObjectBuiltins()                                 \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_IMPORTMETAOBJECT_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* JSBufferConstructor.ts */
// from
const JSC::ConstructAbility s_jsBufferConstructorFromCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferConstructorFromCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferConstructorFromCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferConstructorFromCodeLength = 1535;
static const JSC::Intrinsic s_jsBufferConstructorFromCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferConstructorFromCode =
    "(function(items) {\n  if (\"use strict\", @isUndefinedOrNull(items))\n    "
    "@throwTypeError(\"The first argument must be one of type string, Buffer, "
    "ArrayBuffer, Array, or Array-like Object.\");\n  if (typeof items === "
    "\"string\" || typeof items === \"object\" && (@isTypedArrayView(items) || "
    "items instanceof ArrayBuffer || items instanceof SharedArrayBuffer || "
    "items instanceof String))\n    switch (@argumentCount()) {\n      case "
    "1:\n        return new @Buffer(items);\n      case 2:\n        return new "
    "@Buffer(items, @argument(1));\n      default:\n        return new "
    "@Buffer(items, @argument(1), @argument(2));\n    }\n  var arrayLike = "
    "@toObject(items, \"The first argument must be of type string or an "
    "instance of Buffer, ArrayBuffer, or Array or an Array-like Object.\");\n  "
    "if (!@isJSArray(arrayLike)) {\n    const toPrimitive = "
    "@tryGetByIdWithWellKnownSymbol(items, \"toPrimitive\");\n    if "
    "(toPrimitive) {\n      const primitive = toPrimitive.@call(items, "
    "\"string\");\n      if (typeof primitive === \"string\")\n        switch "
    "(@argumentCount()) {\n          case 1:\n            return new "
    "@Buffer(primitive);\n          case 2:\n            return new "
    "@Buffer(primitive, @argument(1));\n          default:\n            return "
    "new @Buffer(primitive, @argument(1), @argument(2));\n        }\n    }\n   "
    " if (!(\"length\" in arrayLike) || @isCallable(arrayLike))\n      "
    "@throwTypeError(\"The first argument must be of type string or an "
    "instance of Buffer, ArrayBuffer, or Array or an Array-like Object.\");\n  "
    "}\n  return new @Buffer(@Uint8Array.from(arrayLike).buffer);\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .jsBufferConstructorBuiltins()                                         \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .jsBufferConstructorBuiltins()                              \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_JSBUFFERCONSTRUCTOR_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* JSBufferPrototype.ts */
// setBigUint64
const JSC::ConstructAbility
    s_jsBufferPrototypeSetBigUint64CodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeSetBigUint64CodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeSetBigUint64CodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeSetBigUint64CodeLength = 170;
static const JSC::Intrinsic s_jsBufferPrototypeSetBigUint64CodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeSetBigUint64Code =
    "(function(offset, value, le) {\n  return \"use strict\", (this.@dataView "
    "||= new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setBigUint64(offset, value, le);\n})";

// readInt8
const JSC::ConstructAbility s_jsBufferPrototypeReadInt8CodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadInt8CodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadInt8CodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadInt8CodeLength = 143;
static const JSC::Intrinsic s_jsBufferPrototypeReadInt8CodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadInt8Code =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).getInt8(offset);\n})";

// readUInt8
const JSC::ConstructAbility s_jsBufferPrototypeReadUInt8CodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadUInt8CodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadUInt8CodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadUInt8CodeLength = 144;
static const JSC::Intrinsic s_jsBufferPrototypeReadUInt8CodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadUInt8Code =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).getUint8(offset);\n})";

// readInt16LE
const JSC::ConstructAbility s_jsBufferPrototypeReadInt16LECodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadInt16LECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadInt16LECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadInt16LECodeLength = 148;
static const JSC::Intrinsic s_jsBufferPrototypeReadInt16LECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadInt16LECode =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, this.byteLength)).getInt16(offset, "
    "!0);\n})";

// readInt16BE
const JSC::ConstructAbility s_jsBufferPrototypeReadInt16BECodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadInt16BECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadInt16BECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadInt16BECodeLength = 148;
static const JSC::Intrinsic s_jsBufferPrototypeReadInt16BECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadInt16BECode =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, this.byteLength)).getInt16(offset, "
    "!1);\n})";

// readUInt16LE
const JSC::ConstructAbility
    s_jsBufferPrototypeReadUInt16LECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadUInt16LECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadUInt16LECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadUInt16LECodeLength = 149;
static const JSC::Intrinsic s_jsBufferPrototypeReadUInt16LECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadUInt16LECode =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).getUint16(offset, !0);\n})";

// readUInt16BE
const JSC::ConstructAbility
    s_jsBufferPrototypeReadUInt16BECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadUInt16BECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadUInt16BECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadUInt16BECodeLength = 149;
static const JSC::Intrinsic s_jsBufferPrototypeReadUInt16BECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadUInt16BECode =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).getUint16(offset, !1);\n})";

// readInt32LE
const JSC::ConstructAbility s_jsBufferPrototypeReadInt32LECodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadInt32LECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadInt32LECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadInt32LECodeLength = 148;
static const JSC::Intrinsic s_jsBufferPrototypeReadInt32LECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadInt32LECode =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, this.byteLength)).getInt32(offset, "
    "!0);\n})";

// readInt32BE
const JSC::ConstructAbility s_jsBufferPrototypeReadInt32BECodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadInt32BECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadInt32BECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadInt32BECodeLength = 148;
static const JSC::Intrinsic s_jsBufferPrototypeReadInt32BECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadInt32BECode =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, this.byteLength)).getInt32(offset, "
    "!1);\n})";

// readUInt32LE
const JSC::ConstructAbility
    s_jsBufferPrototypeReadUInt32LECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadUInt32LECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadUInt32LECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadUInt32LECodeLength = 149;
static const JSC::Intrinsic s_jsBufferPrototypeReadUInt32LECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadUInt32LECode =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).getUint32(offset, !0);\n})";

// readUInt32BE
const JSC::ConstructAbility
    s_jsBufferPrototypeReadUInt32BECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadUInt32BECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadUInt32BECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadUInt32BECodeLength = 149;
static const JSC::Intrinsic s_jsBufferPrototypeReadUInt32BECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadUInt32BECode =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).getUint32(offset, !1);\n})";

// readIntLE
const JSC::ConstructAbility s_jsBufferPrototypeReadIntLECodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadIntLECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadIntLECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadIntLECodeLength = 839;
static const JSC::Intrinsic s_jsBufferPrototypeReadIntLECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadIntLECode =
    "(function(offset, byteLength) {\n  \"use strict\";\n  const view = "
    "this.@dataView ||= new DataView(this.buffer, this.byteOffset, "
    "this.byteLength);\n  switch (byteLength) {\n    case 1:\n      return "
    "view.getInt8(offset);\n    case 2:\n      return view.getInt16(offset, "
    "!0);\n    case 3: {\n      const val = view.getUint16(offset, !0) + "
    "view.getUint8(offset + 2) * 65536;\n      return val | (val & 8388608) * "
    "510;\n    }\n    case 4:\n      return view.getInt32(offset, !0);\n    "
    "case 5: {\n      const last = view.getUint8(offset + 4);\n      return "
    "(last | (last & 128) * 33554430) * 4294967296 + view.getUint32(offset, "
    "!0);\n    }\n    case 6: {\n      const last = view.getUint16(offset + 4, "
    "!0);\n      return (last | (last & 32768) * 131070) * 4294967296 + "
    "view.getUint32(offset, !0);\n    }\n  }\n  @throwRangeError(\"byteLength "
    "must be >= 1 and <= 6\");\n})";

// readIntBE
const JSC::ConstructAbility s_jsBufferPrototypeReadIntBECodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadIntBECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadIntBECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadIntBECodeLength = 839;
static const JSC::Intrinsic s_jsBufferPrototypeReadIntBECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadIntBECode =
    "(function(offset, byteLength) {\n  \"use strict\";\n  const view = "
    "this.@dataView ||= new DataView(this.buffer, this.byteOffset, "
    "this.byteLength);\n  switch (byteLength) {\n    case 1:\n      return "
    "view.getInt8(offset);\n    case 2:\n      return view.getInt16(offset, "
    "!1);\n    case 3: {\n      const val = view.getUint16(offset + 1, !1) + "
    "view.getUint8(offset) * 65536;\n      return val | (val & 8388608) * "
    "510;\n    }\n    case 4:\n      return view.getInt32(offset, !1);\n    "
    "case 5: {\n      const last = view.getUint8(offset);\n      return (last "
    "| (last & 128) * 33554430) * 4294967296 + view.getUint32(offset + 1, "
    "!1);\n    }\n    case 6: {\n      const last = view.getUint16(offset, "
    "!1);\n      return (last | (last & 32768) * 131070) * 4294967296 + "
    "view.getUint32(offset + 2, !1);\n    }\n  }\n  "
    "@throwRangeError(\"byteLength must be >= 1 and <= 6\");\n})";

// readUIntLE
const JSC::ConstructAbility s_jsBufferPrototypeReadUIntLECodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadUIntLECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadUIntLECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadUIntLECodeLength = 665;
static const JSC::Intrinsic s_jsBufferPrototypeReadUIntLECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadUIntLECode =
    "(function(offset, byteLength) {\n  \"use strict\";\n  const view = "
    "this.@dataView ||= new DataView(this.buffer, this.byteOffset, "
    "this.byteLength);\n  switch (byteLength) {\n    case 1:\n      return "
    "view.getUint8(offset);\n    case 2:\n      return view.getUint16(offset, "
    "!0);\n    case 3:\n      return view.getUint16(offset, !0) + "
    "view.getUint8(offset + 2) * 65536;\n    case 4:\n      return "
    "view.getUint32(offset, !0);\n    case 5:\n      return "
    "view.getUint8(offset + 4) * 4294967296 + view.getUint32(offset, !0);\n    "
    "case 6:\n      return view.getUint16(offset + 4, !0) * 4294967296 + "
    "view.getUint32(offset, !0);\n  }\n  @throwRangeError(\"byteLength must be "
    ">= 1 and <= 6\");\n})";

// readUIntBE
const JSC::ConstructAbility s_jsBufferPrototypeReadUIntBECodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadUIntBECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadUIntBECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadUIntBECodeLength = 787;
static const JSC::Intrinsic s_jsBufferPrototypeReadUIntBECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadUIntBECode =
    "(function(offset, byteLength) {\n  \"use strict\";\n  const view = "
    "this.@dataView ||= new DataView(this.buffer, this.byteOffset, "
    "this.byteLength);\n  switch (byteLength) {\n    case 1:\n      return "
    "view.getUint8(offset);\n    case 2:\n      return view.getUint16(offset, "
    "!1);\n    case 3:\n      return view.getUint16(offset + 1, !1) + "
    "view.getUint8(offset) * 65536;\n    case 4:\n      return "
    "view.getUint32(offset, !1);\n    case 5: {\n      const last = "
    "view.getUint8(offset);\n      return (last | (last & 128) * 33554430) * "
    "4294967296 + view.getUint32(offset + 1, !1);\n    }\n    case 6: {\n      "
    "const last = view.getUint16(offset, !1);\n      return (last | (last & "
    "32768) * 131070) * 4294967296 + view.getUint32(offset + 2, !1);\n    }\n  "
    "}\n  @throwRangeError(\"byteLength must be >= 1 and <= 6\");\n})";

// readFloatLE
const JSC::ConstructAbility s_jsBufferPrototypeReadFloatLECodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadFloatLECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadFloatLECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadFloatLECodeLength = 150;
static const JSC::Intrinsic s_jsBufferPrototypeReadFloatLECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadFloatLECode =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).getFloat32(offset, !0);\n})";

// readFloatBE
const JSC::ConstructAbility s_jsBufferPrototypeReadFloatBECodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadFloatBECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadFloatBECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadFloatBECodeLength = 150;
static const JSC::Intrinsic s_jsBufferPrototypeReadFloatBECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadFloatBECode =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).getFloat32(offset, !1);\n})";

// readDoubleLE
const JSC::ConstructAbility
    s_jsBufferPrototypeReadDoubleLECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadDoubleLECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadDoubleLECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadDoubleLECodeLength = 150;
static const JSC::Intrinsic s_jsBufferPrototypeReadDoubleLECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadDoubleLECode =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).getFloat64(offset, !0);\n})";

// readDoubleBE
const JSC::ConstructAbility
    s_jsBufferPrototypeReadDoubleBECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadDoubleBECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadDoubleBECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadDoubleBECodeLength = 150;
static const JSC::Intrinsic s_jsBufferPrototypeReadDoubleBECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadDoubleBECode =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).getFloat64(offset, !1);\n})";

// readBigInt64LE
const JSC::ConstructAbility
    s_jsBufferPrototypeReadBigInt64LECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_jsBufferPrototypeReadBigInt64LECodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadBigInt64LECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadBigInt64LECodeLength = 151;
static const JSC::Intrinsic s_jsBufferPrototypeReadBigInt64LECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadBigInt64LECode =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).getBigInt64(offset, !0);\n})";

// readBigInt64BE
const JSC::ConstructAbility
    s_jsBufferPrototypeReadBigInt64BECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_jsBufferPrototypeReadBigInt64BECodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadBigInt64BECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadBigInt64BECodeLength = 151;
static const JSC::Intrinsic s_jsBufferPrototypeReadBigInt64BECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadBigInt64BECode =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).getBigInt64(offset, !1);\n})";

// readBigUInt64LE
const JSC::ConstructAbility
    s_jsBufferPrototypeReadBigUInt64LECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_jsBufferPrototypeReadBigUInt64LECodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadBigUInt64LECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadBigUInt64LECodeLength = 152;
static const JSC::Intrinsic s_jsBufferPrototypeReadBigUInt64LECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadBigUInt64LECode =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).getBigUint64(offset, !0);\n})";

// readBigUInt64BE
const JSC::ConstructAbility
    s_jsBufferPrototypeReadBigUInt64BECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_jsBufferPrototypeReadBigUInt64BECodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeReadBigUInt64BECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadBigUInt64BECodeLength = 152;
static const JSC::Intrinsic s_jsBufferPrototypeReadBigUInt64BECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeReadBigUInt64BECode =
    "(function(offset) {\n  return \"use strict\", (this.@dataView ||= new "
    "DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).getBigUint64(offset, !1);\n})";

// writeInt8
const JSC::ConstructAbility s_jsBufferPrototypeWriteInt8CodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteInt8CodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteInt8CodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteInt8CodeLength = 169;
static const JSC::Intrinsic s_jsBufferPrototypeWriteInt8CodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteInt8Code =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setInt8(offset, value), offset + 1;\n})";

// writeUInt8
const JSC::ConstructAbility s_jsBufferPrototypeWriteUInt8CodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteUInt8CodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteUInt8CodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteUInt8CodeLength = 170;
static const JSC::Intrinsic s_jsBufferPrototypeWriteUInt8CodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteUInt8Code =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setUint8(offset, value), offset + 1;\n})";

// writeInt16LE
const JSC::ConstructAbility
    s_jsBufferPrototypeWriteInt16LECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteInt16LECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteInt16LECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteInt16LECodeLength = 174;
static const JSC::Intrinsic s_jsBufferPrototypeWriteInt16LECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteInt16LECode =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setInt16(offset, value, !0), offset + 2;\n})";

// writeInt16BE
const JSC::ConstructAbility
    s_jsBufferPrototypeWriteInt16BECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteInt16BECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteInt16BECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteInt16BECodeLength = 174;
static const JSC::Intrinsic s_jsBufferPrototypeWriteInt16BECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteInt16BECode =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setInt16(offset, value, !1), offset + 2;\n})";

// writeUInt16LE
const JSC::ConstructAbility
    s_jsBufferPrototypeWriteUInt16LECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteUInt16LECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteUInt16LECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteUInt16LECodeLength = 175;
static const JSC::Intrinsic s_jsBufferPrototypeWriteUInt16LECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteUInt16LECode =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setUint16(offset, value, !0), offset + 2;\n})";

// writeUInt16BE
const JSC::ConstructAbility
    s_jsBufferPrototypeWriteUInt16BECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteUInt16BECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteUInt16BECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteUInt16BECodeLength = 175;
static const JSC::Intrinsic s_jsBufferPrototypeWriteUInt16BECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteUInt16BECode =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setUint16(offset, value, !1), offset + 2;\n})";

// writeInt32LE
const JSC::ConstructAbility
    s_jsBufferPrototypeWriteInt32LECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteInt32LECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteInt32LECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteInt32LECodeLength = 174;
static const JSC::Intrinsic s_jsBufferPrototypeWriteInt32LECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteInt32LECode =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setInt32(offset, value, !0), offset + 4;\n})";

// writeInt32BE
const JSC::ConstructAbility
    s_jsBufferPrototypeWriteInt32BECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteInt32BECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteInt32BECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteInt32BECodeLength = 174;
static const JSC::Intrinsic s_jsBufferPrototypeWriteInt32BECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteInt32BECode =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setInt32(offset, value, !1), offset + 4;\n})";

// writeUInt32LE
const JSC::ConstructAbility
    s_jsBufferPrototypeWriteUInt32LECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteUInt32LECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteUInt32LECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteUInt32LECodeLength = 175;
static const JSC::Intrinsic s_jsBufferPrototypeWriteUInt32LECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteUInt32LECode =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setUint32(offset, value, !0), offset + 4;\n})";

// writeUInt32BE
const JSC::ConstructAbility
    s_jsBufferPrototypeWriteUInt32BECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteUInt32BECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteUInt32BECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteUInt32BECodeLength = 175;
static const JSC::Intrinsic s_jsBufferPrototypeWriteUInt32BECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteUInt32BECode =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setUint32(offset, value, !1), offset + 4;\n})";

// writeIntLE
const JSC::ConstructAbility s_jsBufferPrototypeWriteIntLECodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteIntLECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteIntLECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteIntLECodeLength = 958;
static const JSC::Intrinsic s_jsBufferPrototypeWriteIntLECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteIntLECode =
    "(function(value, offset, byteLength) {\n  \"use strict\";\n  const view = "
    "this.@dataView ||= new DataView(this.buffer, this.byteOffset, "
    "this.byteLength);\n  switch (byteLength) {\n    case 1: {\n      "
    "view.setInt8(offset, value);\n      break;\n    }\n    case 2: {\n      "
    "view.setInt16(offset, value, !0);\n      break;\n    }\n    case 3: {\n   "
    "   view.setUint16(offset, value & 65535, !0), view.setInt8(offset + 2, "
    "Math.floor(value * 0.0000152587890625));\n      break;\n    }\n    case "
    "4: {\n      view.setInt32(offset, value, !0);\n      break;\n    }\n    "
    "case 5: {\n      view.setUint32(offset, value | 0, !0), "
    "view.setInt8(offset + 4, Math.floor(value * "
    "0.00000000023283064365386964));\n      break;\n    }\n    case 6: {\n     "
    " view.setUint32(offset, value | 0, !0), view.setInt16(offset + 4, "
    "Math.floor(value * 0.00000000023283064365386964), !0);\n      break;\n    "
    "}\n    default:\n      @throwRangeError(\"byteLength must be >= 1 and <= "
    "6\");\n  }\n  return offset + byteLength;\n})";

// writeIntBE
const JSC::ConstructAbility s_jsBufferPrototypeWriteIntBECodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteIntBECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteIntBECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteIntBECodeLength = 958;
static const JSC::Intrinsic s_jsBufferPrototypeWriteIntBECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteIntBECode =
    "(function(value, offset, byteLength) {\n  \"use strict\";\n  const view = "
    "this.@dataView ||= new DataView(this.buffer, this.byteOffset, "
    "this.byteLength);\n  switch (byteLength) {\n    case 1: {\n      "
    "view.setInt8(offset, value);\n      break;\n    }\n    case 2: {\n      "
    "view.setInt16(offset, value, !1);\n      break;\n    }\n    case 3: {\n   "
    "   view.setUint16(offset + 1, value & 65535, !1), view.setInt8(offset, "
    "Math.floor(value * 0.0000152587890625));\n      break;\n    }\n    case "
    "4: {\n      view.setInt32(offset, value, !1);\n      break;\n    }\n    "
    "case 5: {\n      view.setUint32(offset + 1, value | 0, !1), "
    "view.setInt8(offset, Math.floor(value * 0.00000000023283064365386964));\n "
    "     break;\n    }\n    case 6: {\n      view.setUint32(offset + 2, value "
    "| 0, !1), view.setInt16(offset, Math.floor(value * "
    "0.00000000023283064365386964), !1);\n      break;\n    }\n    default:\n  "
    "    @throwRangeError(\"byteLength must be >= 1 and <= 6\");\n  }\n  "
    "return offset + byteLength;\n})";

// writeUIntLE
const JSC::ConstructAbility s_jsBufferPrototypeWriteUIntLECodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteUIntLECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteUIntLECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteUIntLECodeLength = 964;
static const JSC::Intrinsic s_jsBufferPrototypeWriteUIntLECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteUIntLECode =
    "(function(value, offset, byteLength) {\n  \"use strict\";\n  const view = "
    "this.@dataView ||= new DataView(this.buffer, this.byteOffset, "
    "this.byteLength);\n  switch (byteLength) {\n    case 1: {\n      "
    "view.setUint8(offset, value);\n      break;\n    }\n    case 2: {\n      "
    "view.setUint16(offset, value, !0);\n      break;\n    }\n    case 3: {\n  "
    "    view.setUint16(offset, value & 65535, !0), view.setUint8(offset + 2, "
    "Math.floor(value * 0.0000152587890625));\n      break;\n    }\n    case "
    "4: {\n      view.setUint32(offset, value, !0);\n      break;\n    }\n    "
    "case 5: {\n      view.setUint32(offset, value | 0, !0), "
    "view.setUint8(offset + 4, Math.floor(value * "
    "0.00000000023283064365386964));\n      break;\n    }\n    case 6: {\n     "
    " view.setUint32(offset, value | 0, !0), view.setUint16(offset + 4, "
    "Math.floor(value * 0.00000000023283064365386964), !0);\n      break;\n    "
    "}\n    default:\n      @throwRangeError(\"byteLength must be >= 1 and <= "
    "6\");\n  }\n  return offset + byteLength;\n})";

// writeUIntBE
const JSC::ConstructAbility s_jsBufferPrototypeWriteUIntBECodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteUIntBECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteUIntBECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteUIntBECodeLength = 964;
static const JSC::Intrinsic s_jsBufferPrototypeWriteUIntBECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteUIntBECode =
    "(function(value, offset, byteLength) {\n  \"use strict\";\n  const view = "
    "this.@dataView ||= new DataView(this.buffer, this.byteOffset, "
    "this.byteLength);\n  switch (byteLength) {\n    case 1: {\n      "
    "view.setUint8(offset, value);\n      break;\n    }\n    case 2: {\n      "
    "view.setUint16(offset, value, !1);\n      break;\n    }\n    case 3: {\n  "
    "    view.setUint16(offset + 1, value & 65535, !1), view.setUint8(offset, "
    "Math.floor(value * 0.0000152587890625));\n      break;\n    }\n    case "
    "4: {\n      view.setUint32(offset, value, !1);\n      break;\n    }\n    "
    "case 5: {\n      view.setUint32(offset + 1, value | 0, !1), "
    "view.setUint8(offset, Math.floor(value * "
    "0.00000000023283064365386964));\n      break;\n    }\n    case 6: {\n     "
    " view.setUint32(offset + 2, value | 0, !1), view.setUint16(offset, "
    "Math.floor(value * 0.00000000023283064365386964), !1);\n      break;\n    "
    "}\n    default:\n      @throwRangeError(\"byteLength must be >= 1 and <= "
    "6\");\n  }\n  return offset + byteLength;\n})";

// writeFloatLE
const JSC::ConstructAbility
    s_jsBufferPrototypeWriteFloatLECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteFloatLECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteFloatLECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteFloatLECodeLength = 176;
static const JSC::Intrinsic s_jsBufferPrototypeWriteFloatLECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteFloatLECode =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setFloat32(offset, value, !0), offset + 4;\n})";

// writeFloatBE
const JSC::ConstructAbility
    s_jsBufferPrototypeWriteFloatBECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteFloatBECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteFloatBECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteFloatBECodeLength = 176;
static const JSC::Intrinsic s_jsBufferPrototypeWriteFloatBECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteFloatBECode =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setFloat32(offset, value, !1), offset + 4;\n})";

// writeDoubleLE
const JSC::ConstructAbility
    s_jsBufferPrototypeWriteDoubleLECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteDoubleLECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteDoubleLECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteDoubleLECodeLength = 176;
static const JSC::Intrinsic s_jsBufferPrototypeWriteDoubleLECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteDoubleLECode =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setFloat64(offset, value, !0), offset + 8;\n})";

// writeDoubleBE
const JSC::ConstructAbility
    s_jsBufferPrototypeWriteDoubleBECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteDoubleBECodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteDoubleBECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteDoubleBECodeLength = 176;
static const JSC::Intrinsic s_jsBufferPrototypeWriteDoubleBECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteDoubleBECode =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setFloat64(offset, value, !1), offset + 8;\n})";

// writeBigInt64LE
const JSC::ConstructAbility
    s_jsBufferPrototypeWriteBigInt64LECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_jsBufferPrototypeWriteBigInt64LECodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteBigInt64LECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteBigInt64LECodeLength = 177;
static const JSC::Intrinsic s_jsBufferPrototypeWriteBigInt64LECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteBigInt64LECode =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setBigInt64(offset, value, !0), offset + 8;\n})";

// writeBigInt64BE
const JSC::ConstructAbility
    s_jsBufferPrototypeWriteBigInt64BECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_jsBufferPrototypeWriteBigInt64BECodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteBigInt64BECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteBigInt64BECodeLength = 177;
static const JSC::Intrinsic s_jsBufferPrototypeWriteBigInt64BECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteBigInt64BECode =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setBigInt64(offset, value, !1), offset + 8;\n})";

// writeBigUInt64LE
const JSC::ConstructAbility
    s_jsBufferPrototypeWriteBigUInt64LECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_jsBufferPrototypeWriteBigUInt64LECodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteBigUInt64LECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteBigUInt64LECodeLength = 178;
static const JSC::Intrinsic s_jsBufferPrototypeWriteBigUInt64LECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteBigUInt64LECode =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setBigUint64(offset, value, !0), offset + 8;\n})";

// writeBigUInt64BE
const JSC::ConstructAbility
    s_jsBufferPrototypeWriteBigUInt64BECodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_jsBufferPrototypeWriteBigUInt64BECodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeWriteBigUInt64BECodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteBigUInt64BECodeLength = 178;
static const JSC::Intrinsic s_jsBufferPrototypeWriteBigUInt64BECodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeWriteBigUInt64BECode =
    "(function(value, offset) {\n  return \"use strict\", (this.@dataView ||= "
    "new DataView(this.buffer, this.byteOffset, "
    "this.byteLength)).setBigUint64(offset, value, !1), offset + 8;\n})";

// utf8Write
const JSC::ConstructAbility s_jsBufferPrototypeUtf8WriteCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeUtf8WriteCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeUtf8WriteCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeUtf8WriteCodeLength = 101;
static const JSC::Intrinsic s_jsBufferPrototypeUtf8WriteCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeUtf8WriteCode =
    "(function(text, offset, length) {\n  return \"use strict\", "
    "this.write(text, offset, length, \"utf8\");\n})";

// ucs2Write
const JSC::ConstructAbility s_jsBufferPrototypeUcs2WriteCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeUcs2WriteCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeUcs2WriteCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeUcs2WriteCodeLength = 101;
static const JSC::Intrinsic s_jsBufferPrototypeUcs2WriteCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeUcs2WriteCode =
    "(function(text, offset, length) {\n  return \"use strict\", "
    "this.write(text, offset, length, \"ucs2\");\n})";

// utf16leWrite
const JSC::ConstructAbility
    s_jsBufferPrototypeUtf16leWriteCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeUtf16leWriteCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeUtf16leWriteCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeUtf16leWriteCodeLength = 104;
static const JSC::Intrinsic s_jsBufferPrototypeUtf16leWriteCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeUtf16leWriteCode =
    "(function(text, offset, length) {\n  return \"use strict\", "
    "this.write(text, offset, length, \"utf16le\");\n})";

// latin1Write
const JSC::ConstructAbility s_jsBufferPrototypeLatin1WriteCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeLatin1WriteCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeLatin1WriteCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeLatin1WriteCodeLength = 103;
static const JSC::Intrinsic s_jsBufferPrototypeLatin1WriteCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeLatin1WriteCode =
    "(function(text, offset, length) {\n  return \"use strict\", "
    "this.write(text, offset, length, \"latin1\");\n})";

// asciiWrite
const JSC::ConstructAbility s_jsBufferPrototypeAsciiWriteCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeAsciiWriteCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeAsciiWriteCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeAsciiWriteCodeLength = 102;
static const JSC::Intrinsic s_jsBufferPrototypeAsciiWriteCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeAsciiWriteCode =
    "(function(text, offset, length) {\n  return \"use strict\", "
    "this.write(text, offset, length, \"ascii\");\n})";

// base64Write
const JSC::ConstructAbility s_jsBufferPrototypeBase64WriteCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeBase64WriteCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeBase64WriteCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeBase64WriteCodeLength = 103;
static const JSC::Intrinsic s_jsBufferPrototypeBase64WriteCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeBase64WriteCode =
    "(function(text, offset, length) {\n  return \"use strict\", "
    "this.write(text, offset, length, \"base64\");\n})";

// base64urlWrite
const JSC::ConstructAbility
    s_jsBufferPrototypeBase64urlWriteCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_jsBufferPrototypeBase64urlWriteCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeBase64urlWriteCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeBase64urlWriteCodeLength = 106;
static const JSC::Intrinsic s_jsBufferPrototypeBase64urlWriteCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeBase64urlWriteCode =
    "(function(text, offset, length) {\n  return \"use strict\", "
    "this.write(text, offset, length, \"base64url\");\n})";

// hexWrite
const JSC::ConstructAbility s_jsBufferPrototypeHexWriteCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeHexWriteCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeHexWriteCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeHexWriteCodeLength = 100;
static const JSC::Intrinsic s_jsBufferPrototypeHexWriteCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeHexWriteCode =
    "(function(text, offset, length) {\n  return \"use strict\", "
    "this.write(text, offset, length, \"hex\");\n})";

// utf8Slice
const JSC::ConstructAbility s_jsBufferPrototypeUtf8SliceCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeUtf8SliceCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeUtf8SliceCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeUtf8SliceCodeLength = 92;
static const JSC::Intrinsic s_jsBufferPrototypeUtf8SliceCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeUtf8SliceCode =
    "(function(offset, length) {\n  return \"use strict\", "
    "this.toString(offset, length, \"utf8\");\n})";

// ucs2Slice
const JSC::ConstructAbility s_jsBufferPrototypeUcs2SliceCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeUcs2SliceCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeUcs2SliceCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeUcs2SliceCodeLength = 92;
static const JSC::Intrinsic s_jsBufferPrototypeUcs2SliceCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeUcs2SliceCode =
    "(function(offset, length) {\n  return \"use strict\", "
    "this.toString(offset, length, \"ucs2\");\n})";

// utf16leSlice
const JSC::ConstructAbility
    s_jsBufferPrototypeUtf16leSliceCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeUtf16leSliceCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeUtf16leSliceCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeUtf16leSliceCodeLength = 95;
static const JSC::Intrinsic s_jsBufferPrototypeUtf16leSliceCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeUtf16leSliceCode =
    "(function(offset, length) {\n  return \"use strict\", "
    "this.toString(offset, length, \"utf16le\");\n})";

// latin1Slice
const JSC::ConstructAbility s_jsBufferPrototypeLatin1SliceCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeLatin1SliceCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeLatin1SliceCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeLatin1SliceCodeLength = 94;
static const JSC::Intrinsic s_jsBufferPrototypeLatin1SliceCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeLatin1SliceCode =
    "(function(offset, length) {\n  return \"use strict\", "
    "this.toString(offset, length, \"latin1\");\n})";

// asciiSlice
const JSC::ConstructAbility s_jsBufferPrototypeAsciiSliceCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeAsciiSliceCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeAsciiSliceCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeAsciiSliceCodeLength = 93;
static const JSC::Intrinsic s_jsBufferPrototypeAsciiSliceCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeAsciiSliceCode =
    "(function(offset, length) {\n  return \"use strict\", "
    "this.toString(offset, length, \"ascii\");\n})";

// base64Slice
const JSC::ConstructAbility s_jsBufferPrototypeBase64SliceCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeBase64SliceCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeBase64SliceCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeBase64SliceCodeLength = 94;
static const JSC::Intrinsic s_jsBufferPrototypeBase64SliceCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeBase64SliceCode =
    "(function(offset, length) {\n  return \"use strict\", "
    "this.toString(offset, length, \"base64\");\n})";

// base64urlSlice
const JSC::ConstructAbility
    s_jsBufferPrototypeBase64urlSliceCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_jsBufferPrototypeBase64urlSliceCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeBase64urlSliceCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeBase64urlSliceCodeLength = 97;
static const JSC::Intrinsic s_jsBufferPrototypeBase64urlSliceCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeBase64urlSliceCode =
    "(function(offset, length) {\n  return \"use strict\", "
    "this.toString(offset, length, \"base64url\");\n})";

// hexSlice
const JSC::ConstructAbility s_jsBufferPrototypeHexSliceCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeHexSliceCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeHexSliceCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeHexSliceCodeLength = 91;
static const JSC::Intrinsic s_jsBufferPrototypeHexSliceCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeHexSliceCode =
    "(function(offset, length) {\n  return \"use strict\", "
    "this.toString(offset, length, \"hex\");\n})";

// toJSON
const JSC::ConstructAbility s_jsBufferPrototypeToJSONCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeToJSONCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeToJSONCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeToJSONCodeLength = 108;
static const JSC::Intrinsic s_jsBufferPrototypeToJSONCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeToJSONCode =
    "(function() {\n  \"use strict\";\n  const type = \"Buffer\", data = "
    "@Array.from(this);\n  return { type, data };\n})";

// slice
const JSC::ConstructAbility s_jsBufferPrototypeSliceCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeSliceCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeSliceCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeSliceCodeLength = 562;
static const JSC::Intrinsic s_jsBufferPrototypeSliceCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeSliceCode =
    "(function(start, end) {\n  \"use strict\";\n  var { buffer, byteOffset, "
    "byteLength } = this;\n  function adjustOffset(offset, length) {\n    if "
    "(offset = @trunc(offset), offset === 0 || @isNaN(offset))\n      return "
    "0;\n    else if (offset < 0)\n      return offset += length, offset > 0 "
    "\? offset : 0;\n    else\n      return offset < length \? offset : "
    "length;\n  }\n  var start_ = adjustOffset(start, byteLength), end_ = end "
    "!== @undefined \? adjustOffset(end, byteLength) : byteLength;\n  return "
    "new @Buffer(buffer, byteOffset + start_, end_ > start_ \? end_ - start_ : "
    "0);\n})";

// parent
const JSC::ConstructAbility s_jsBufferPrototypeParentCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeParentCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeParentCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeParentCodeLength = 110;
static const JSC::Intrinsic s_jsBufferPrototypeParentCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeParentCode =
    "(function() {\n  return \"use strict\", @isObject(this) && this "
    "instanceof @Buffer \? this.buffer : @undefined;\n})";

// offset
const JSC::ConstructAbility s_jsBufferPrototypeOffsetCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeOffsetCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_jsBufferPrototypeOffsetCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeOffsetCodeLength = 114;
static const JSC::Intrinsic s_jsBufferPrototypeOffsetCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_jsBufferPrototypeOffsetCode =
    "(function() {\n  return \"use strict\", @isObject(this) && this "
    "instanceof @Buffer \? this.byteOffset : @undefined;\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .jsBufferPrototypeBuiltins()                                           \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .jsBufferPrototypeBuiltins()                                \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_JSBUFFERPROTOTYPE_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ProcessObjectInternals.ts */
// binding
const JSC::ConstructAbility
    s_processObjectInternalsBindingCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_processObjectInternalsBindingCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_processObjectInternalsBindingCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_processObjectInternalsBindingCodeLength = 635;
static const JSC::Intrinsic s_processObjectInternalsBindingCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_processObjectInternalsBindingCode =
    "(function(bindingName) {\n  if (\"use strict\", bindingName !== "
    "\"constants\")\n    @throwTypeError(\"process.binding() is not supported "
    "in Bun. If that breaks something, please file an issue and include a "
    "reproducible code sample.\");\n  var cache = "
    "globalThis.Symbol.for(\"process.bindings.constants\"), constants = "
    "globalThis[cache];\n  if (!constants) {\n    const { constants: fs } = "
    "globalThis[globalThis.Symbol.for(\"Bun.lazy\")](\"createImportMeta\", "
    "\"node:process\").require(\"node:fs\");\n    constants = {\n      fs,\n   "
    "   zlib: {},\n      crypto: {},\n      os: @Bun._Os().constants\n    }, "
    "globalThis[cache] = constants;\n  }\n  return constants;\n})";

// getStdioWriteStream
const JSC::ConstructAbility
    s_processObjectInternalsGetStdioWriteStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_processObjectInternalsGetStdioWriteStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_processObjectInternalsGetStdioWriteStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_processObjectInternalsGetStdioWriteStreamCodeLength = 9549;
static const JSC::Intrinsic
    s_processObjectInternalsGetStdioWriteStreamCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_processObjectInternalsGetStdioWriteStreamCode =
    "(function(fd_, rawRequire) {\n  \"use strict\";\n  var module = { path: "
    "\"node:process\", require: rawRequire }, require2 = (path) => "
    "module.require(path);\n  function createStdioWriteStream(fd_2) {\n    var "
    "{ Duplex, eos, destroy } = require2(\"node:stream\"), StdioWriteStream = "
    "class StdioWriteStream2 extends Duplex {\n      #writeStream;\n      "
    "#readStream;\n      #readable = !0;\n      #writable = !0;\n      "
    "#fdPath;\n      #onClose;\n      #onDrain;\n      #onFinish;\n      "
    "#onReadable;\n      #isTTY;\n      get isTTY() {\n        return "
    "this.#isTTY \?\?= require2(\"node:tty\").isatty(fd_2);\n      }\n      "
    "get fd() {\n        return fd_2;\n      }\n      constructor(fd) {\n      "
    "  super({ readable: !0, writable: !0 });\n        this.#fdPath = "
    "`/dev/fd/${fd}`;\n      }\n      #onFinished(err) {\n        const cb = "
    "this.#onClose;\n        if (this.#onClose = null, cb)\n          "
    "cb(err);\n        else if (err)\n          this.destroy(err);\n        "
    "else if (!this.#readable && !this.#writable)\n          this.destroy();\n "
    "     }\n      _destroy(err, callback) {\n        if (!err && "
    "this.#onClose !== null) {\n          var AbortError = class AbortError2 "
    "extends Error {\n            code;\n            name;\n            "
    "constructor(message = \"The operation was aborted\", options = void 0) "
    "{\n              if (options !== void 0 && typeof options !== "
    "\"object\")\n                throw new Error(`Invalid AbortError "
    "options:\\n\\n${JSON.stringify(options, null, 2)}`);\n              "
    "super(message, options);\n              this.code = \"ABORT_ERR\", "
    "this.name = \"AbortError\";\n            }\n          };\n          err = "
    "new AbortError;\n        }\n        if (this.#onDrain = null, "
    "this.#onFinish = null, this.#onClose === null)\n          "
    "callback(err);\n        else {\n          if (this.#onClose = callback, "
    "this.#writeStream)\n            destroy(this.#writeStream, err);\n        "
    "  if (this.#readStream)\n            destroy(this.#readStream, err);\n    "
    "    }\n      }\n      _write(chunk, encoding, callback) {\n        if "
    "(!this.#writeStream) {\n          var { createWriteStream } = "
    "require2(\"node:fs\"), stream = this.#writeStream = "
    "createWriteStream(this.#fdPath);\n          stream.on(\"finish\", () => "
    "{\n            if (this.#onFinish) {\n              const cb = "
    "this.#onFinish;\n              this.#onFinish = null, cb();\n            "
    "}\n          }), stream.on(\"drain\", () => {\n            if "
    "(this.#onDrain) {\n              const cb = this.#onDrain;\n              "
    "this.#onDrain = null, cb();\n            }\n          }), eos(stream, "
    "(err) => {\n            if (this.#writable = !1, err)\n              "
    "destroy(stream, err);\n            this.#onFinished(err);\n          "
    "});\n        }\n        if (stream.write(chunk, encoding))\n          "
    "callback();\n        else\n          this.#onDrain = callback;\n      }\n "
    "     _final(callback) {\n        this.#writeStream && "
    "this.#writeStream.end(), this.#onFinish = callback;\n      }\n      "
    "#loadReadStream() {\n        var { createReadStream } = "
    "require2(\"node:fs\"), readStream = this.#readStream = "
    "createReadStream(this.#fdPath);\n        return "
    "readStream.on(\"readable\", () => {\n          if (this.#onReadable) {\n  "
    "          const cb = this.#onReadable;\n            this.#onReadable = "
    "null, cb();\n          } else\n            this.read();\n        }), "
    "readStream.on(\"end\", () => {\n          this.push(null);\n        }), "
    "eos(readStream, (err) => {\n          if (this.#readable = !1, err)\n     "
    "       destroy(readStream, err);\n          this.#onFinished(err);\n      "
    "  }), readStream;\n      }\n      _read() {\n        var stream = "
    "this.#readStream;\n        if (!stream)\n          stream = "
    "this.#loadReadStream();\n        while (!0) {\n          const buf = "
    "stream.read();\n          if (buf === null || !this.push(buf))\n          "
    "  return;\n        }\n      }\n    };\n    return new "
    "StdioWriteStream(fd_2);\n  }\n  var { EventEmitter } = "
    "require2(\"node:events\");\n  function isFastEncoding(encoding) {\n    if "
    "(!encoding)\n      return !0;\n    var normalied = "
    "encoding.toLowerCase();\n    return normalied === \"utf8\" || normalied "
    "=== \"utf-8\" || normalied === \"buffer\" || normalied === \"binary\";\n  "
    "}\n  var readline, FastStdioWriteStream = class StdioWriteStream extends "
    "EventEmitter {\n    #fd;\n    #innerStream;\n    #writer;\n    #isTTY;\n  "
    "  bytesWritten = 0;\n    setDefaultEncoding(encoding) {\n      if "
    "(this.#innerStream || !isFastEncoding(encoding))\n        return "
    "this.#ensureInnerStream(), "
    "this.#innerStream.setDefaultEncoding(encoding);\n    }\n    "
    "#createWriter() {\n      switch (this.#fd) {\n        case 1: {\n         "
    " var writer = @Bun.stdout.writer({ highWaterMark: 0 });\n          return "
    "writer.unref(), writer;\n        }\n        case 2: {\n          var "
    "writer = @Bun.stderr.writer({ highWaterMark: 0 });\n          return "
    "writer.unref(), writer;\n        }\n        default:\n          throw new "
    "Error(\"Unsupported writer\");\n      }\n    }\n    #getWriter() {\n      "
    "return this.#writer \?\?= this.#createWriter();\n    }\n    "
    "constructor(fd_2) {\n      super();\n      this.#fd = fd_2;\n    }\n    "
    "get fd() {\n      return this.#fd;\n    }\n    get isTTY() {\n      "
    "return this.#isTTY \?\?= require2(\"node:tty\").isatty(this.#fd);\n    "
    "}\n    cursorTo(x, y, callback) {\n      return (readline \?\?= "
    "require2(\"readline\")).cursorTo(this, x, y, callback);\n    }\n    "
    "moveCursor(dx, dy, callback) {\n      return (readline \?\?= "
    "require2(\"readline\")).moveCursor(this, dx, dy, callback);\n    }\n    "
    "clearLine(dir, callback) {\n      return (readline \?\?= "
    "require2(\"readline\")).clearLine(this, dir, callback);\n    }\n    "
    "clearScreenDown(callback) {\n      return (readline \?\?= "
    "require2(\"readline\")).clearScreenDown(this, callback);\n    }\n    "
    "ref() {\n      this.#getWriter().ref();\n    }\n    unref() {\n      "
    "this.#getWriter().unref();\n    }\n    on(event, listener) {\n      if "
    "(event === \"close\" || event === \"finish\")\n        return "
    "this.#ensureInnerStream(), this.#innerStream.on(event, listener);\n      "
    "if (event === \"drain\")\n        return super.on(\"drain\", listener);\n "
    "     if (event === \"error\")\n        return super.on(\"error\", "
    "listener);\n      return super.on(event, listener);\n    }\n    get "
    "_writableState() {\n      return this.#ensureInnerStream(), "
    "this.#innerStream._writableState;\n    }\n    get _readableState() {\n    "
    "  return this.#ensureInnerStream(), this.#innerStream._readableState;\n   "
    " }\n    pipe(destination) {\n      return this.#ensureInnerStream(), "
    "this.#innerStream.pipe(destination);\n    }\n    unpipe(destination) {\n  "
    "    return this.#ensureInnerStream(), "
    "this.#innerStream.unpipe(destination);\n    }\n    #ensureInnerStream() "
    "{\n      if (this.#innerStream)\n        return;\n      this.#innerStream "
    "= createStdioWriteStream(this.#fd);\n      const events = "
    "this.eventNames();\n      for (let event of events)\n        "
    "this.#innerStream.on(event, (...args) => {\n          this.emit(event, "
    "...args);\n        });\n    }\n    #write1(chunk) {\n      var writer = "
    "this.#getWriter();\n      const writeResult = writer.write(chunk);\n      "
    "this.bytesWritten += writeResult;\n      const flushResult = "
    "writer.flush(!1);\n      return !!(writeResult || flushResult);\n    }\n  "
    "  #writeWithEncoding(chunk, encoding) {\n      if "
    "(!isFastEncoding(encoding))\n        return this.#ensureInnerStream(), "
    "this.#innerStream.write(chunk, encoding);\n      return "
    "this.#write1(chunk);\n    }\n    #performCallback(cb, err) {\n      if "
    "(err)\n        this.emit(\"error\", err);\n      try {\n        cb(err \? "
    "err : null);\n      } catch (err2) {\n        this.emit(\"error\", "
    "err2);\n      }\n    }\n    #writeWithCallbackAndEncoding(chunk, "
    "encoding, callback) {\n      if (!isFastEncoding(encoding))\n        "
    "return this.#ensureInnerStream(), this.#innerStream.write(chunk, "
    "encoding, callback);\n      var writer = this.#getWriter();\n      const "
    "writeResult = writer.write(chunk), flushResult = writer.flush(!0);\n      "
    "if (flushResult\?.then)\n        return flushResult.then(() => {\n        "
    "  this.#performCallback(callback), this.emit(\"drain\");\n        }, "
    "(err) => this.#performCallback(callback, err)), !1;\n      return "
    "queueMicrotask(() => {\n        this.#performCallback(callback);\n      "
    "}), !!(writeResult || flushResult);\n    }\n    write(chunk, encoding, "
    "callback) {\n      const result = this._write(chunk, encoding, "
    "callback);\n      if (result)\n        this.emit(\"drain\");\n      "
    "return result;\n    }\n    get hasColors() {\n      return "
    "@Bun.tty[this.#fd].hasColors;\n    }\n    _write(chunk, encoding, "
    "callback) {\n      var inner = this.#innerStream;\n      if (inner)\n     "
    "   return inner.write(chunk, encoding, callback);\n      switch "
    "(arguments.length) {\n        case 0: {\n          var error = new "
    "Error(\"Invalid arguments\");\n          throw error.code = "
    "\"ERR_INVALID_ARG_TYPE\", error;\n        }\n        case 1:\n          "
    "return this.#write1(chunk);\n        case 2:\n          if (typeof "
    "encoding === \"function\")\n            return "
    "this.#writeWithCallbackAndEncoding(chunk, \"\", encoding);\n          "
    "else if (typeof encoding === \"string\")\n            return "
    "this.#writeWithEncoding(chunk, encoding);\n        default: {\n          "
    "if (typeof encoding !== \"undefined\" && typeof encoding !== \"string\" "
    "|| typeof callback !== \"undefined\" && typeof callback !== \"function\") "
    "{\n            var error = new Error(\"Invalid arguments\");\n            "
    "throw error.code = \"ERR_INVALID_ARG_TYPE\", error;\n          }\n        "
    "  if (typeof callback === \"undefined\")\n            return "
    "this.#writeWithEncoding(chunk, encoding);\n          return "
    "this.#writeWithCallbackAndEncoding(chunk, encoding, callback);\n        "
    "}\n      }\n    }\n    destroy() {\n      return this;\n    }\n    end() "
    "{\n      return this;\n    }\n  };\n  return new "
    "FastStdioWriteStream(fd_);\n})";

// getStdinStream
const JSC::ConstructAbility
    s_processObjectInternalsGetStdinStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_processObjectInternalsGetStdinStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_processObjectInternalsGetStdinStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_processObjectInternalsGetStdinStreamCodeLength = 3823;
static const JSC::Intrinsic
    s_processObjectInternalsGetStdinStreamCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_processObjectInternalsGetStdinStreamCode =
    "(function(fd_, rawRequire, Bun) {\n  \"use strict\";\n  var module = { "
    "path: \"node:process\", require: rawRequire }, require2 = (path) => "
    "module.require(path), { Duplex, eos, destroy } = "
    "require2(\"node:stream\"), StdinStream = class StdinStream2 extends "
    "Duplex {\n    #reader;\n    #readRef;\n    #writeStream;\n    #readable = "
    "!0;\n    #unrefOnRead = !1;\n    #writable = !0;\n    #onFinish;\n    "
    "#onClose;\n    #onDrain;\n    get isTTY() {\n      return "
    "require2(\"tty\").isatty(fd_);\n    }\n    get fd() {\n      return "
    "fd_;\n    }\n    constructor() {\n      super({ readable: !0, writable: "
    "!0 });\n    }\n    #onFinished(err) {\n      const cb = this.#onClose;\n  "
    "    if (this.#onClose = null, cb)\n        cb(err);\n      else if "
    "(err)\n        this.destroy(err);\n      else if (!this.#readable && "
    "!this.#writable)\n        this.destroy();\n    }\n    _destroy(err, "
    "callback) {\n      if (!err && this.#onClose !== null) {\n        var "
    "AbortError = class AbortError2 extends Error {\n          "
    "constructor(message = \"The operation was aborted\", options = void 0) "
    "{\n            if (options !== void 0 && typeof options !== \"object\")\n "
    "             throw new Error(`Invalid AbortError "
    "options:\\n\\n${JSON.stringify(options, null, 2)}`);\n            "
    "super(message, options);\n            this.code = \"ABORT_ERR\", "
    "this.name = \"AbortError\";\n          }\n        };\n        err = new "
    "AbortError;\n      }\n      if (this.#onClose === null)\n        "
    "callback(err);\n      else if (this.#onClose = callback, "
    "this.#writeStream)\n        destroy(this.#writeStream, err);\n    }\n    "
    "setRawMode(mode) {\n    }\n    on(name, callback) {\n      if (name === "
    "\"readable\")\n        this.ref(), this.#unrefOnRead = !0;\n      return "
    "super.on(name, callback);\n    }\n    pause() {\n      return "
    "this.unref(), super.pause();\n    }\n    resume() {\n      return "
    "this.ref(), super.resume();\n    }\n    ref() {\n      this.#reader \?\?= "
    "Bun.stdin.stream().getReader(), this.#readRef \?\?= setInterval(() => {\n "
    "     }, 1 << 30);\n    }\n    unref() {\n      if (this.#readRef)\n       "
    " clearInterval(this.#readRef), this.#readRef = null;\n    }\n    "
    "async#readInternal() {\n      try {\n        var done, value;\n        "
    "const read = this.#reader.readMany();\n        if (!read\?.then)\n        "
    "  ({ done, value } = read);\n        else\n          ({ done, value } = "
    "await read);\n        if (!done) {\n          this.push(value[0]);\n      "
    "    const length = value.length;\n          for (let i = 1;i < length; "
    "i++)\n            this.push(value[i]);\n        } else\n          "
    "this.push(null), this.pause(), this.#readable = !1, this.#onFinished();\n "
    "     } catch (err) {\n        this.#readable = !1, "
    "this.#onFinished(err);\n      }\n    }\n    _read(size) {\n      if "
    "(this.#unrefOnRead)\n        this.unref(), this.#unrefOnRead = !1;\n      "
    "this.#readInternal();\n    }\n    #constructWriteStream() {\n      var { "
    "createWriteStream } = require2(\"node:fs\"), writeStream = "
    "this.#writeStream = createWriteStream(\"/dev/fd/0\");\n      return "
    "writeStream.on(\"finish\", () => {\n        if (this.#onFinish) {\n       "
    "   const cb = this.#onFinish;\n          this.#onFinish = null, cb();\n   "
    "     }\n      }), writeStream.on(\"drain\", () => {\n        if "
    "(this.#onDrain) {\n          const cb = this.#onDrain;\n          "
    "this.#onDrain = null, cb();\n        }\n      }), eos(writeStream, (err) "
    "=> {\n        if (this.#writable = !1, err)\n          "
    "destroy(writeStream, err);\n        this.#onFinished(err);\n      }), "
    "writeStream;\n    }\n    _write(chunk, encoding, callback) {\n      var "
    "writeStream = this.#writeStream;\n      if (!writeStream)\n        "
    "writeStream = this.#constructWriteStream();\n      if "
    "(writeStream.write(chunk, encoding))\n        callback();\n      else\n   "
    "     this.#onDrain = callback;\n    }\n    _final(callback) {\n      "
    "this.#writeStream.end(), this.#onFinish = (...args) => "
    "callback(...args);\n    }\n  };\n  return new StdinStream;\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .processObjectInternalsBuiltins()                                      \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .processObjectInternalsBuiltins()                           \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_PROCESSOBJECTINTERNALS_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ReadableByteStreamController.ts */
// initializeReadableByteStreamController
const JSC::ConstructAbility
    s_readableByteStreamControllerInitializeReadableByteStreamControllerCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamControllerInitializeReadableByteStreamControllerCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamControllerInitializeReadableByteStreamControllerCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamControllerInitializeReadableByteStreamControllerCodeLength =
        350;
static const JSC::Intrinsic
    s_readableByteStreamControllerInitializeReadableByteStreamControllerCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamControllerInitializeReadableByteStreamControllerCode =
        "(function(stream, underlyingByteSource, highWaterMark) {\n  if (\"use "
        "strict\", arguments.length !== 4 && arguments[3] !== "
        "@isReadableStream)\n    "
        "@throwTypeError(\"ReadableByteStreamController constructor should not "
        "be called directly\");\n  return "
        "@privateInitializeReadableByteStreamController.@call(this, stream, "
        "underlyingByteSource, highWaterMark);\n})";

// enqueue
const JSC::ConstructAbility
    s_readableByteStreamControllerEnqueueCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamControllerEnqueueCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamControllerEnqueueCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableByteStreamControllerEnqueueCodeLength = 627;
static const JSC::Intrinsic s_readableByteStreamControllerEnqueueCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableByteStreamControllerEnqueueCode =
    "(function(chunk) {\n  if (\"use strict\", "
    "!@isReadableByteStreamController(this))\n    throw "
    "@makeThisTypeError(\"ReadableByteStreamController\", \"enqueue\");\n  if "
    "(@getByIdDirectPrivate(this, \"closeRequested\"))\n    "
    "@throwTypeError(\"ReadableByteStreamController is requested to "
    "close\");\n  if (@getByIdDirectPrivate(@getByIdDirectPrivate(this, "
    "\"controlledReadableStream\"), \"state\") !== @streamReadable)\n    "
    "@throwTypeError(\"ReadableStream is not readable\");\n  if "
    "(!@isObject(chunk) || !ArrayBuffer.@isView(chunk))\n    "
    "@throwTypeError(\"Provided chunk is not a TypedArray\");\n  return "
    "@readableByteStreamControllerEnqueue(this, chunk);\n})";

// error
const JSC::ConstructAbility
    s_readableByteStreamControllerErrorCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamControllerErrorCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamControllerErrorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableByteStreamControllerErrorCodeLength = 373;
static const JSC::Intrinsic s_readableByteStreamControllerErrorCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableByteStreamControllerErrorCode =
    "(function(error) {\n  if (\"use strict\", "
    "!@isReadableByteStreamController(this))\n    throw "
    "@makeThisTypeError(\"ReadableByteStreamController\", \"error\");\n  if "
    "(@getByIdDirectPrivate(@getByIdDirectPrivate(this, "
    "\"controlledReadableStream\"), \"state\") !== @streamReadable)\n    "
    "@throwTypeError(\"ReadableStream is not readable\");\n  "
    "@readableByteStreamControllerError(this, error);\n})";

// close
const JSC::ConstructAbility
    s_readableByteStreamControllerCloseCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamControllerCloseCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamControllerCloseCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableByteStreamControllerCloseCodeLength = 471;
static const JSC::Intrinsic s_readableByteStreamControllerCloseCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableByteStreamControllerCloseCode =
    "(function() {\n  if (\"use strict\", "
    "!@isReadableByteStreamController(this))\n    throw "
    "@makeThisTypeError(\"ReadableByteStreamController\", \"close\");\n  if "
    "(@getByIdDirectPrivate(this, \"closeRequested\"))\n    "
    "@throwTypeError(\"Close has already been requested\");\n  if "
    "(@getByIdDirectPrivate(@getByIdDirectPrivate(this, "
    "\"controlledReadableStream\"), \"state\") !== @streamReadable)\n    "
    "@throwTypeError(\"ReadableStream is not readable\");\n  "
    "@readableByteStreamControllerClose(this);\n})";

// byobRequest
const JSC::ConstructAbility
    s_readableByteStreamControllerByobRequestCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamControllerByobRequestCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamControllerByobRequestCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableByteStreamControllerByobRequestCodeLength = 737;
static const JSC::Intrinsic
    s_readableByteStreamControllerByobRequestCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableByteStreamControllerByobRequestCode =
    "(function() {\n  if (\"use strict\", "
    "!@isReadableByteStreamController(this))\n    throw "
    "@makeGetterTypeError(\"ReadableByteStreamController\", "
    "\"byobRequest\");\n  var request = @getByIdDirectPrivate(this, "
    "\"byobRequest\");\n  if (request === @undefined) {\n    var pending = "
    "@getByIdDirectPrivate(this, \"pendingPullIntos\");\n    const "
    "firstDescriptor = pending.peek();\n    if (firstDescriptor) {\n      "
    "const view = new @Uint8Array(firstDescriptor.buffer, "
    "firstDescriptor.byteOffset + firstDescriptor.bytesFilled, "
    "firstDescriptor.byteLength - firstDescriptor.bytesFilled);\n      "
    "@putByIdDirectPrivate(this, \"byobRequest\", new "
    "@ReadableStreamBYOBRequest(this, view, @isReadableStream));\n    }\n  }\n "
    " return @getByIdDirectPrivate(this, \"byobRequest\");\n})";

// desiredSize
const JSC::ConstructAbility
    s_readableByteStreamControllerDesiredSizeCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamControllerDesiredSizeCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamControllerDesiredSizeCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableByteStreamControllerDesiredSizeCodeLength = 215;
static const JSC::Intrinsic
    s_readableByteStreamControllerDesiredSizeCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableByteStreamControllerDesiredSizeCode =
    "(function() {\n  if (\"use strict\", "
    "!@isReadableByteStreamController(this))\n    throw "
    "@makeGetterTypeError(\"ReadableByteStreamController\", "
    "\"desiredSize\");\n  return "
    "@readableByteStreamControllerGetDesiredSize(this);\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .readableByteStreamControllerBuiltins()                                \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .readableByteStreamControllerBuiltins()                     \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_READABLEBYTESTREAMCONTROLLER_BUILTIN_CODE(
    DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ReadableByteStreamInternals.ts */
// privateInitializeReadableByteStreamController
const JSC::ConstructAbility
    s_readableByteStreamInternalsPrivateInitializeReadableByteStreamControllerCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsPrivateInitializeReadableByteStreamControllerCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsPrivateInitializeReadableByteStreamControllerCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsPrivateInitializeReadableByteStreamControllerCodeLength =
        2190;
static const JSC::Intrinsic
    s_readableByteStreamInternalsPrivateInitializeReadableByteStreamControllerCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsPrivateInitializeReadableByteStreamControllerCode =
        "(function(stream, underlyingByteSource, highWaterMark) {\n  if (\"use "
        "strict\", !@isReadableStream(stream))\n    "
        "@throwTypeError(\"ReadableByteStreamController needs a "
        "ReadableStream\");\n  if (@getByIdDirectPrivate(stream, "
        "\"readableStreamController\") !== null)\n    "
        "@throwTypeError(\"ReadableStream already has a controller\");\n  "
        "@putByIdDirectPrivate(this, \"controlledReadableStream\", stream), "
        "@putByIdDirectPrivate(this, \"underlyingByteSource\", "
        "underlyingByteSource), @putByIdDirectPrivate(this, \"pullAgain\", "
        "!1), @putByIdDirectPrivate(this, \"pulling\", !1), "
        "@readableByteStreamControllerClearPendingPullIntos(this), "
        "@putByIdDirectPrivate(this, \"queue\", @newQueue()), "
        "@putByIdDirectPrivate(this, \"started\", 0), "
        "@putByIdDirectPrivate(this, \"closeRequested\", !1);\n  let hwm = "
        "@toNumber(highWaterMark);\n  if (@isNaN(hwm) || hwm < 0)\n    "
        "@throwRangeError(\"highWaterMark value is negative or not a "
        "number\");\n  @putByIdDirectPrivate(this, \"strategyHWM\", hwm);\n  "
        "let autoAllocateChunkSize = "
        "underlyingByteSource.autoAllocateChunkSize;\n  if "
        "(autoAllocateChunkSize !== @undefined) {\n    if "
        "(autoAllocateChunkSize = @toNumber(autoAllocateChunkSize), "
        "autoAllocateChunkSize <= 0 || autoAllocateChunkSize === @Infinity || "
        "autoAllocateChunkSize === -@Infinity)\n      "
        "@throwRangeError(\"autoAllocateChunkSize value is negative or equal "
        "to positive or negative infinity\");\n  }\n  "
        "@putByIdDirectPrivate(this, \"autoAllocateChunkSize\", "
        "autoAllocateChunkSize), @putByIdDirectPrivate(this, "
        "\"pendingPullIntos\", @createFIFO());\n  const controller = this;\n  "
        "return @promiseInvokeOrNoopNoCatch(@getByIdDirectPrivate(controller, "
        "\"underlyingByteSource\"), \"start\", [controller]).@then(() => {\n   "
        " @putByIdDirectPrivate(controller, \"started\", 1), "
        "@assert(!@getByIdDirectPrivate(controller, \"pulling\")), "
        "@assert(!@getByIdDirectPrivate(controller, \"pullAgain\")), "
        "@readableByteStreamControllerCallPullIfNeeded(controller);\n  }, "
        "(error) => {\n    if (@getByIdDirectPrivate(stream, \"state\") === "
        "@streamReadable)\n      "
        "@readableByteStreamControllerError(controller, error);\n  }), "
        "@putByIdDirectPrivate(this, \"cancel\", "
        "@readableByteStreamControllerCancel), @putByIdDirectPrivate(this, "
        "\"pull\", @readableByteStreamControllerPull), this;\n})";

// readableStreamByteStreamControllerStart
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableStreamByteStreamControllerStartCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableStreamByteStreamControllerStartCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableStreamByteStreamControllerStartCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableStreamByteStreamControllerStartCodeLength =
        98;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableStreamByteStreamControllerStartCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableStreamByteStreamControllerStartCode =
        "(function(controller) {\n  \"use strict\", "
        "@putByIdDirectPrivate(controller, \"start\", @undefined);\n})";

// privateInitializeReadableStreamBYOBRequest
const JSC::ConstructAbility
    s_readableByteStreamInternalsPrivateInitializeReadableStreamBYOBRequestCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsPrivateInitializeReadableStreamBYOBRequestCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsPrivateInitializeReadableStreamBYOBRequestCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsPrivateInitializeReadableStreamBYOBRequestCodeLength =
        174;
static const JSC::Intrinsic
    s_readableByteStreamInternalsPrivateInitializeReadableStreamBYOBRequestCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsPrivateInitializeReadableStreamBYOBRequestCode =
        "(function(controller, view) {\n  \"use strict\", "
        "@putByIdDirectPrivate(this, "
        "\"associatedReadableByteStreamController\", controller), "
        "@putByIdDirectPrivate(this, \"view\", view);\n})";

// isReadableByteStreamController
const JSC::ConstructAbility
    s_readableByteStreamInternalsIsReadableByteStreamControllerCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsIsReadableByteStreamControllerCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsIsReadableByteStreamControllerCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsIsReadableByteStreamControllerCodeLength = 135;
static const JSC::Intrinsic
    s_readableByteStreamInternalsIsReadableByteStreamControllerCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableByteStreamInternalsIsReadableByteStreamControllerCode =
        "(function(controller) {\n  return \"use strict\", "
        "@isObject(controller) && !!@getByIdDirectPrivate(controller, "
        "\"underlyingByteSource\");\n})";

// isReadableStreamBYOBRequest
const JSC::ConstructAbility
    s_readableByteStreamInternalsIsReadableStreamBYOBRequestCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsIsReadableStreamBYOBRequestCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsIsReadableStreamBYOBRequestCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsIsReadableStreamBYOBRequestCodeLength =
    156;
static const JSC::Intrinsic
    s_readableByteStreamInternalsIsReadableStreamBYOBRequestCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableByteStreamInternalsIsReadableStreamBYOBRequestCode =
    "(function(byobRequest) {\n  return \"use strict\", @isObject(byobRequest) "
    "&& !!@getByIdDirectPrivate(byobRequest, "
    "\"associatedReadableByteStreamController\");\n})";

// isReadableStreamBYOBReader
const JSC::ConstructAbility
    s_readableByteStreamInternalsIsReadableStreamBYOBReaderCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsIsReadableStreamBYOBReaderCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsIsReadableStreamBYOBReaderCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsIsReadableStreamBYOBReaderCodeLength =
    119;
static const JSC::Intrinsic
    s_readableByteStreamInternalsIsReadableStreamBYOBReaderCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableByteStreamInternalsIsReadableStreamBYOBReaderCode =
    "(function(reader) {\n  return \"use strict\", @isObject(reader) && "
    "!!@getByIdDirectPrivate(reader, \"readIntoRequests\");\n})";

// readableByteStreamControllerCancel
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerCancelCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerCancelCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerCancelCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerCancelCodeLength =
        370;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerCancelCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableByteStreamInternalsReadableByteStreamControllerCancelCode =
        "(function(controller, reason) {\n  \"use strict\";\n  var "
        "pendingPullIntos = @getByIdDirectPrivate(controller, "
        "\"pendingPullIntos\"), first = pendingPullIntos.peek();\n  if "
        "(first)\n    first.bytesFilled = 0;\n  return "
        "@putByIdDirectPrivate(controller, \"queue\", @newQueue()), "
        "@promiseInvokeOrNoop(@getByIdDirectPrivate(controller, "
        "\"underlyingByteSource\"), \"cancel\", [reason]);\n})";

// readableByteStreamControllerError
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerErrorCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerErrorCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerErrorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerErrorCodeLength =
        378;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerErrorCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableByteStreamInternalsReadableByteStreamControllerErrorCode =
        "(function(controller, e) {\n  \"use strict\", "
        "@assert(@getByIdDirectPrivate(@getByIdDirectPrivate(controller, "
        "\"controlledReadableStream\"), \"state\") === @streamReadable), "
        "@readableByteStreamControllerClearPendingPullIntos(controller), "
        "@putByIdDirectPrivate(controller, \"queue\", @newQueue()), "
        "@readableStreamError(@getByIdDirectPrivate(controller, "
        "\"controlledReadableStream\"), e);\n})";

// readableByteStreamControllerClose
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerCloseCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerCloseCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerCloseCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerCloseCodeLength =
        737;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerCloseCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableByteStreamInternalsReadableByteStreamControllerCloseCode =
        "(function(controller) {\n  if (\"use strict\", "
        "@assert(!@getByIdDirectPrivate(controller, \"closeRequested\")), "
        "@assert(@getByIdDirectPrivate(@getByIdDirectPrivate(controller, "
        "\"controlledReadableStream\"), \"state\") === @streamReadable), "
        "@getByIdDirectPrivate(controller, \"queue\").size > 0) {\n    "
        "@putByIdDirectPrivate(controller, \"closeRequested\", !0);\n    "
        "return;\n  }\n  var first = @getByIdDirectPrivate(controller, "
        "\"pendingPullIntos\")\?.peek();\n  if (first) {\n    if "
        "(first.bytesFilled > 0) {\n      const e = @makeTypeError(\"Close "
        "requested while there remain pending bytes\");\n      throw "
        "@readableByteStreamControllerError(controller, e), e;\n    }\n  }\n  "
        "@readableStreamClose(@getByIdDirectPrivate(controller, "
        "\"controlledReadableStream\"));\n})";

// readableByteStreamControllerClearPendingPullIntos
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerClearPendingPullIntosCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerClearPendingPullIntosCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerClearPendingPullIntosCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerClearPendingPullIntosCodeLength =
        312;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerClearPendingPullIntosCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerClearPendingPullIntosCode =
        "(function(controller) {\n  \"use strict\", "
        "@readableByteStreamControllerInvalidateBYOBRequest(controller);\n  "
        "var existing = @getByIdDirectPrivate(controller, "
        "\"pendingPullIntos\");\n  if (existing !== @undefined)\n    "
        "existing.clear();\n  else\n    @putByIdDirectPrivate(controller, "
        "\"pendingPullIntos\", @createFIFO());\n})";

// readableByteStreamControllerGetDesiredSize
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerGetDesiredSizeCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerGetDesiredSizeCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerGetDesiredSizeCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerGetDesiredSizeCodeLength =
        373;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerGetDesiredSizeCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerGetDesiredSizeCode =
        "(function(controller) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(controller, \"controlledReadableStream\"), "
        "state = @getByIdDirectPrivate(stream, \"state\");\n  if (state === "
        "@streamErrored)\n    return null;\n  if (state === @streamClosed)\n   "
        " return 0;\n  return @getByIdDirectPrivate(controller, "
        "\"strategyHWM\") - @getByIdDirectPrivate(controller, "
        "\"queue\").size;\n})";

// readableStreamHasBYOBReader
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableStreamHasBYOBReaderCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableStreamHasBYOBReaderCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableStreamHasBYOBReaderCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableStreamHasBYOBReaderCodeLength =
    167;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableStreamHasBYOBReaderCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableByteStreamInternalsReadableStreamHasBYOBReaderCode =
    "(function(stream) {\n  \"use strict\";\n  const reader = "
    "@getByIdDirectPrivate(stream, \"reader\");\n  return reader !== "
    "@undefined && @isReadableStreamBYOBReader(reader);\n})";

// readableStreamHasDefaultReader
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableStreamHasDefaultReaderCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableStreamHasDefaultReaderCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableStreamHasDefaultReaderCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableStreamHasDefaultReaderCodeLength = 170;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableStreamHasDefaultReaderCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableByteStreamInternalsReadableStreamHasDefaultReaderCode =
        "(function(stream) {\n  \"use strict\";\n  const reader = "
        "@getByIdDirectPrivate(stream, \"reader\");\n  return reader !== "
        "@undefined && @isReadableStreamDefaultReader(reader);\n})";

// readableByteStreamControllerHandleQueueDrain
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerHandleQueueDrainCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerHandleQueueDrainCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerHandleQueueDrainCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerHandleQueueDrainCodeLength =
        434;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerHandleQueueDrainCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerHandleQueueDrainCode =
        "(function(controller) {\n  if (\"use strict\", "
        "@assert(@getByIdDirectPrivate(@getByIdDirectPrivate(controller, "
        "\"controlledReadableStream\"), \"state\") === @streamReadable), "
        "!@getByIdDirectPrivate(controller, \"queue\").size && "
        "@getByIdDirectPrivate(controller, \"closeRequested\"))\n    "
        "@readableStreamClose(@getByIdDirectPrivate(controller, "
        "\"controlledReadableStream\"));\n  else\n    "
        "@readableByteStreamControllerCallPullIfNeeded(controller);\n})";

// readableByteStreamControllerPull
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerPullCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerPullCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerPullCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerPullCodeLength =
        1448;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerPullCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableByteStreamInternalsReadableByteStreamControllerPullCode =
        "(function(controller) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(controller, \"controlledReadableStream\");\n  "
        "if (@assert(@readableStreamHasDefaultReader(stream)), "
        "@getByIdDirectPrivate(controller, \"queue\").content\?.isNotEmpty()) "
        "{\n    const entry = @getByIdDirectPrivate(controller, "
        "\"queue\").content.shift();\n    @getByIdDirectPrivate(controller, "
        "\"queue\").size -= entry.byteLength, "
        "@readableByteStreamControllerHandleQueueDrain(controller);\n    let "
        "view;\n    try {\n      view = new @Uint8Array(entry.buffer, "
        "entry.byteOffset, entry.byteLength);\n    } catch (error) {\n      "
        "return @Promise.@reject(error);\n    }\n    return "
        "@createFulfilledPromise({ value: view, done: !1 });\n  }\n  if "
        "(@getByIdDirectPrivate(controller, \"autoAllocateChunkSize\") !== "
        "@undefined) {\n    let buffer;\n    try {\n      buffer = "
        "@createUninitializedArrayBuffer(@getByIdDirectPrivate(controller, "
        "\"autoAllocateChunkSize\"));\n    } catch (error) {\n      return "
        "@Promise.@reject(error);\n    }\n    const pullIntoDescriptor = {\n   "
        "   buffer,\n      byteOffset: 0,\n      byteLength: "
        "@getByIdDirectPrivate(controller, \"autoAllocateChunkSize\"),\n      "
        "bytesFilled: 0,\n      elementSize: 1,\n      ctor: @Uint8Array,\n    "
        "  readerType: \"default\"\n    };\n    "
        "@getByIdDirectPrivate(controller, "
        "\"pendingPullIntos\").push(pullIntoDescriptor);\n  }\n  const promise "
        "= @readableStreamAddReadRequest(stream);\n  return "
        "@readableByteStreamControllerCallPullIfNeeded(controller), "
        "promise;\n})";

// readableByteStreamControllerShouldCallPull
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerShouldCallPullCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerShouldCallPullCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerShouldCallPullCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerShouldCallPullCodeLength =
        808;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerShouldCallPullCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerShouldCallPullCode =
        "(function(controller) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(controller, \"controlledReadableStream\");\n  "
        "if (@getByIdDirectPrivate(stream, \"state\") !== @streamReadable)\n   "
        " return !1;\n  if (@getByIdDirectPrivate(controller, "
        "\"closeRequested\"))\n    return !1;\n  if "
        "(!(@getByIdDirectPrivate(controller, \"started\") > 0))\n    return "
        "!1;\n  const reader = @getByIdDirectPrivate(stream, \"reader\");\n  "
        "if (reader && (@getByIdDirectPrivate(reader, "
        "\"readRequests\")\?.isNotEmpty() || !!@getByIdDirectPrivate(reader, "
        "\"bunNativePtr\")))\n    return !0;\n  if "
        "(@readableStreamHasBYOBReader(stream) && "
        "@getByIdDirectPrivate(@getByIdDirectPrivate(stream, \"reader\"), "
        "\"readIntoRequests\")\?.isNotEmpty())\n    return !0;\n  if "
        "(@readableByteStreamControllerGetDesiredSize(controller) > 0)\n    "
        "return !0;\n  return !1;\n})";

// readableByteStreamControllerCallPullIfNeeded
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerCallPullIfNeededCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerCallPullIfNeededCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerCallPullIfNeededCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerCallPullIfNeededCodeLength =
        899;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerCallPullIfNeededCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerCallPullIfNeededCode =
        "(function(controller) {\n  if (\"use strict\", "
        "!@readableByteStreamControllerShouldCallPull(controller))\n    "
        "return;\n  if (@getByIdDirectPrivate(controller, \"pulling\")) {\n    "
        "@putByIdDirectPrivate(controller, \"pullAgain\", !0);\n    return;\n  "
        "}\n  @assert(!@getByIdDirectPrivate(controller, \"pullAgain\")), "
        "@putByIdDirectPrivate(controller, \"pulling\", !0), "
        "@promiseInvokeOrNoop(@getByIdDirectPrivate(controller, "
        "\"underlyingByteSource\"), \"pull\", [controller]).@then(() => {\n    "
        "if (@putByIdDirectPrivate(controller, \"pulling\", !1), "
        "@getByIdDirectPrivate(controller, \"pullAgain\"))\n      "
        "@putByIdDirectPrivate(controller, \"pullAgain\", !1), "
        "@readableByteStreamControllerCallPullIfNeeded(controller);\n  }, "
        "(error) => {\n    if "
        "(@getByIdDirectPrivate(@getByIdDirectPrivate(controller, "
        "\"controlledReadableStream\"), \"state\") === @streamReadable)\n      "
        "@readableByteStreamControllerError(controller, error);\n  });\n})";

// transferBufferToCurrentRealm
const JSC::ConstructAbility
    s_readableByteStreamInternalsTransferBufferToCurrentRealmCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsTransferBufferToCurrentRealmCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsTransferBufferToCurrentRealmCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsTransferBufferToCurrentRealmCodeLength =
    53;
static const JSC::Intrinsic
    s_readableByteStreamInternalsTransferBufferToCurrentRealmCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableByteStreamInternalsTransferBufferToCurrentRealmCode =
        "(function(buffer) {\n  return \"use strict\", buffer;\n})";

// readableStreamReaderKind
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableStreamReaderKindCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableStreamReaderKindCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableStreamReaderKindCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableStreamReaderKindCodeLength = 238;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableStreamReaderKindCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableByteStreamInternalsReadableStreamReaderKindCode =
    "(function(reader) {\n  if (\"use strict\", @getByIdDirectPrivate(reader, "
    "\"readRequests\"))\n    return @getByIdDirectPrivate(reader, "
    "\"bunNativePtr\") \? 3 : 1;\n  if (@getByIdDirectPrivate(reader, "
    "\"readIntoRequests\"))\n    return 2;\n  return 0;\n})";

// readableByteStreamControllerEnqueue
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerEnqueueCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerEnqueueCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerEnqueueCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerEnqueueCodeLength =
        1470;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerEnqueueCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerEnqueueCode =
        "(function(controller, chunk) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(controller, \"controlledReadableStream\");\n  "
        "switch (@assert(!@getByIdDirectPrivate(controller, "
        "\"closeRequested\")), @assert(@getByIdDirectPrivate(stream, "
        "\"state\") === @streamReadable), @getByIdDirectPrivate(stream, "
        "\"reader\") \? "
        "@readableStreamReaderKind(@getByIdDirectPrivate(stream, \"reader\")) "
        ": 0) {\n    case 1: {\n      if "
        "(!@getByIdDirectPrivate(@getByIdDirectPrivate(stream, \"reader\"), "
        "\"readRequests\")\?.isNotEmpty())\n        "
        "@readableByteStreamControllerEnqueueChunk(controller, "
        "@transferBufferToCurrentRealm(chunk.buffer), chunk.byteOffset, "
        "chunk.byteLength);\n      else {\n        "
        "@assert(!@getByIdDirectPrivate(controller, "
        "\"queue\").content.size());\n        const transferredView = "
        "chunk.constructor === @Uint8Array \? chunk : new "
        "@Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);\n      "
        "  @readableStreamFulfillReadRequest(stream, transferredView, !1);\n   "
        "   }\n      break;\n    }\n    case 2: {\n      "
        "@readableByteStreamControllerEnqueueChunk(controller, "
        "@transferBufferToCurrentRealm(chunk.buffer), chunk.byteOffset, "
        "chunk.byteLength), "
        "@readableByteStreamControllerProcessPullDescriptors(controller);\n    "
        "  break;\n    }\n    case 3:\n      break;\n    default: {\n      "
        "@assert(!@isReadableStreamLocked(stream)), "
        "@readableByteStreamControllerEnqueueChunk(controller, "
        "@transferBufferToCurrentRealm(chunk.buffer), chunk.byteOffset, "
        "chunk.byteLength);\n      break;\n    }\n  }\n})";

// readableByteStreamControllerEnqueueChunk
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerEnqueueChunkCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerEnqueueChunkCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerEnqueueChunkCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerEnqueueChunkCodeLength =
        244;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerEnqueueChunkCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerEnqueueChunkCode =
        "(function(controller, buffer, byteOffset, byteLength) {\n  \"use "
        "strict\", @getByIdDirectPrivate(controller, "
        "\"queue\").content.push({\n    buffer,\n    byteOffset,\n    "
        "byteLength\n  }), @getByIdDirectPrivate(controller, \"queue\").size "
        "+= byteLength;\n})";

// readableByteStreamControllerRespondWithNewView
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerRespondWithNewViewCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerRespondWithNewViewCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerRespondWithNewViewCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerRespondWithNewViewCodeLength =
        582;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerRespondWithNewViewCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerRespondWithNewViewCode =
        "(function(controller, view) {\n  \"use strict\", "
        "@assert(@getByIdDirectPrivate(controller, "
        "\"pendingPullIntos\").isNotEmpty());\n  let firstDescriptor = "
        "@getByIdDirectPrivate(controller, \"pendingPullIntos\").peek();\n  if "
        "(firstDescriptor.byteOffset + firstDescriptor.bytesFilled !== "
        "view.byteOffset)\n    @throwRangeError(\"Invalid value for "
        "view.byteOffset\");\n  if (firstDescriptor.byteLength !== "
        "view.byteLength)\n    @throwRangeError(\"Invalid value for "
        "view.byteLength\");\n  firstDescriptor.buffer = view.buffer, "
        "@readableByteStreamControllerRespondInternal(controller, "
        "view.byteLength);\n})";

// readableByteStreamControllerRespond
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerRespondCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerRespondCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerRespondCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerRespondCodeLength =
        384;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerRespondCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerRespondCode =
        "(function(controller, bytesWritten) {\n  if (\"use strict\", "
        "bytesWritten = @toNumber(bytesWritten), @isNaN(bytesWritten) || "
        "bytesWritten === @Infinity || bytesWritten < 0)\n    "
        "@throwRangeError(\"bytesWritten has an incorrect value\");\n  "
        "@assert(@getByIdDirectPrivate(controller, "
        "\"pendingPullIntos\").isNotEmpty()), "
        "@readableByteStreamControllerRespondInternal(controller, "
        "bytesWritten);\n})";

// readableByteStreamControllerRespondInternal
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInternalCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInternalCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInternalCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInternalCodeLength =
        658;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInternalCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInternalCode =
        "(function(controller, bytesWritten) {\n  \"use strict\";\n  let "
        "firstDescriptor = @getByIdDirectPrivate(controller, "
        "\"pendingPullIntos\").peek(), stream = "
        "@getByIdDirectPrivate(controller, \"controlledReadableStream\");\n  "
        "if (@getByIdDirectPrivate(stream, \"state\") === @streamClosed) {\n   "
        " if (bytesWritten !== 0)\n      @throwTypeError(\"bytesWritten is "
        "different from 0 even though stream is closed\");\n    "
        "@readableByteStreamControllerRespondInClosedState(controller, "
        "firstDescriptor);\n  } else\n    "
        "@assert(@getByIdDirectPrivate(stream, \"state\") === "
        "@streamReadable), "
        "@readableByteStreamControllerRespondInReadableState(controller, "
        "bytesWritten, firstDescriptor);\n})";

// readableByteStreamControllerRespondInReadableState
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInReadableStateCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInReadableStateCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInReadableStateCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInReadableStateCodeLength =
        1360;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInReadableStateCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInReadableStateCode =
        "(function(controller, bytesWritten, pullIntoDescriptor) {\n  if "
        "(\"use strict\", pullIntoDescriptor.bytesFilled + bytesWritten > "
        "pullIntoDescriptor.byteLength)\n    @throwRangeError(\"bytesWritten "
        "value is too great\");\n  if "
        "(@assert(@getByIdDirectPrivate(controller, "
        "\"pendingPullIntos\").isEmpty() || @getByIdDirectPrivate(controller, "
        "\"pendingPullIntos\").peek() === pullIntoDescriptor), "
        "@readableByteStreamControllerInvalidateBYOBRequest(controller), "
        "pullIntoDescriptor.bytesFilled += bytesWritten, "
        "pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize)\n    "
        "return;\n  "
        "@readableByteStreamControllerShiftPendingDescriptor(controller);\n  "
        "const remainderSize = pullIntoDescriptor.bytesFilled % "
        "pullIntoDescriptor.elementSize;\n  if (remainderSize > 0) {\n    "
        "const end = pullIntoDescriptor.byteOffset + "
        "pullIntoDescriptor.bytesFilled, remainder = "
        "@cloneArrayBuffer(pullIntoDescriptor.buffer, end - remainderSize, "
        "remainderSize);\n    "
        "@readableByteStreamControllerEnqueueChunk(controller, remainder, 0, "
        "remainder.byteLength);\n  }\n  pullIntoDescriptor.buffer = "
        "@transferBufferToCurrentRealm(pullIntoDescriptor.buffer), "
        "pullIntoDescriptor.bytesFilled -= remainderSize, "
        "@readableByteStreamControllerCommitDescriptor(@getByIdDirectPrivate("
        "controller, \"controlledReadableStream\"), pullIntoDescriptor), "
        "@readableByteStreamControllerProcessPullDescriptors(controller);\n})";

// readableByteStreamControllerRespondInClosedState
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInClosedStateCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInClosedStateCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInClosedStateCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInClosedStateCodeLength =
        684;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInClosedStateCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerRespondInClosedStateCode =
        "(function(controller, firstDescriptor) {\n  if (\"use strict\", "
        "firstDescriptor.buffer = "
        "@transferBufferToCurrentRealm(firstDescriptor.buffer), "
        "@assert(firstDescriptor.bytesFilled === 0), "
        "@readableStreamHasBYOBReader(@getByIdDirectPrivate(controller, "
        "\"controlledReadableStream\")))\n    while "
        "(@getByIdDirectPrivate(@getByIdDirectPrivate(@getByIdDirectPrivate("
        "controller, \"controlledReadableStream\"), \"reader\"), "
        "\"readIntoRequests\")\?.isNotEmpty()) {\n      let pullIntoDescriptor "
        "= @readableByteStreamControllerShiftPendingDescriptor(controller);\n  "
        "    "
        "@readableByteStreamControllerCommitDescriptor(@getByIdDirectPrivate("
        "controller, \"controlledReadableStream\"), pullIntoDescriptor);\n    "
        "}\n})";

// readableByteStreamControllerProcessPullDescriptors
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerProcessPullDescriptorsCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerProcessPullDescriptorsCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerProcessPullDescriptorsCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerProcessPullDescriptorsCodeLength =
        651;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerProcessPullDescriptorsCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerProcessPullDescriptorsCode =
        "(function(controller) {\n  \"use strict\", "
        "@assert(!@getByIdDirectPrivate(controller, \"closeRequested\"));\n  "
        "while (@getByIdDirectPrivate(controller, "
        "\"pendingPullIntos\").isNotEmpty()) {\n    if "
        "(@getByIdDirectPrivate(controller, \"queue\").size === 0)\n      "
        "return;\n    let pullIntoDescriptor = "
        "@getByIdDirectPrivate(controller, \"pendingPullIntos\").peek();\n    "
        "if (@readableByteStreamControllerFillDescriptorFromQueue(controller, "
        "pullIntoDescriptor))\n      "
        "@readableByteStreamControllerShiftPendingDescriptor(controller), "
        "@readableByteStreamControllerCommitDescriptor(@getByIdDirectPrivate("
        "controller, \"controlledReadableStream\"), pullIntoDescriptor);\n  "
        "}\n})";

// readableByteStreamControllerFillDescriptorFromQueue
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerFillDescriptorFromQueueCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerFillDescriptorFromQueueCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerFillDescriptorFromQueueCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerFillDescriptorFromQueueCodeLength =
        2058;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerFillDescriptorFromQueueCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerFillDescriptorFromQueueCode =
        "(function(controller, pullIntoDescriptor) {\n  \"use strict\";\n  "
        "const currentAlignedBytes = pullIntoDescriptor.bytesFilled - "
        "pullIntoDescriptor.bytesFilled % pullIntoDescriptor.elementSize, "
        "maxBytesToCopy = @getByIdDirectPrivate(controller, \"queue\").size < "
        "pullIntoDescriptor.byteLength - pullIntoDescriptor.bytesFilled \? "
        "@getByIdDirectPrivate(controller, \"queue\").size : "
        "pullIntoDescriptor.byteLength - pullIntoDescriptor.bytesFilled, "
        "maxBytesFilled = pullIntoDescriptor.bytesFilled + maxBytesToCopy, "
        "maxAlignedBytes = maxBytesFilled - maxBytesFilled % "
        "pullIntoDescriptor.elementSize;\n  let totalBytesToCopyRemaining = "
        "maxBytesToCopy, ready = !1;\n  if (maxAlignedBytes > "
        "currentAlignedBytes)\n    totalBytesToCopyRemaining = maxAlignedBytes "
        "- pullIntoDescriptor.bytesFilled, ready = !0;\n  while "
        "(totalBytesToCopyRemaining > 0) {\n    let headOfQueue = "
        "@getByIdDirectPrivate(controller, \"queue\").content.peek();\n    "
        "const bytesToCopy = totalBytesToCopyRemaining < "
        "headOfQueue.byteLength \? totalBytesToCopyRemaining : "
        "headOfQueue.byteLength, destStart = pullIntoDescriptor.byteOffset + "
        "pullIntoDescriptor.bytesFilled;\n    if (new "
        "@Uint8Array(pullIntoDescriptor.buffer).set(new "
        "@Uint8Array(headOfQueue.buffer, headOfQueue.byteOffset, bytesToCopy), "
        "destStart), headOfQueue.byteLength === bytesToCopy)\n      "
        "@getByIdDirectPrivate(controller, \"queue\").content.shift();\n    "
        "else\n      headOfQueue.byteOffset += bytesToCopy, "
        "headOfQueue.byteLength -= bytesToCopy;\n    "
        "@getByIdDirectPrivate(controller, \"queue\").size -= bytesToCopy, "
        "@assert(@getByIdDirectPrivate(controller, "
        "\"pendingPullIntos\").isEmpty() || @getByIdDirectPrivate(controller, "
        "\"pendingPullIntos\").peek() === pullIntoDescriptor), "
        "@readableByteStreamControllerInvalidateBYOBRequest(controller), "
        "pullIntoDescriptor.bytesFilled += bytesToCopy, "
        "totalBytesToCopyRemaining -= bytesToCopy;\n  }\n  if (!ready)\n    "
        "@assert(@getByIdDirectPrivate(controller, \"queue\").size === 0), "
        "@assert(pullIntoDescriptor.bytesFilled > 0), "
        "@assert(pullIntoDescriptor.bytesFilled < "
        "pullIntoDescriptor.elementSize);\n  return ready;\n})";

// readableByteStreamControllerShiftPendingDescriptor
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerShiftPendingDescriptorCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerShiftPendingDescriptorCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerShiftPendingDescriptorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerShiftPendingDescriptorCodeLength =
        209;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerShiftPendingDescriptorCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerShiftPendingDescriptorCode =
        "(function(controller) {\n  \"use strict\";\n  let descriptor = "
        "@getByIdDirectPrivate(controller, \"pendingPullIntos\").shift();\n  "
        "return "
        "@readableByteStreamControllerInvalidateBYOBRequest(controller), "
        "descriptor;\n})";

// readableByteStreamControllerInvalidateBYOBRequest
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerInvalidateBYOBRequestCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerInvalidateBYOBRequestCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerInvalidateBYOBRequestCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerInvalidateBYOBRequestCodeLength =
        405;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerInvalidateBYOBRequestCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerInvalidateBYOBRequestCode =
        "(function(controller) {\n  if (\"use strict\", "
        "@getByIdDirectPrivate(controller, \"byobRequest\") === @undefined)\n  "
        "  return;\n  const byobRequest = @getByIdDirectPrivate(controller, "
        "\"byobRequest\");\n  @putByIdDirectPrivate(byobRequest, "
        "\"associatedReadableByteStreamController\", @undefined), "
        "@putByIdDirectPrivate(byobRequest, \"view\", @undefined), "
        "@putByIdDirectPrivate(controller, \"byobRequest\", @undefined);\n})";

// readableByteStreamControllerCommitDescriptor
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerCommitDescriptorCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerCommitDescriptorCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerCommitDescriptorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerCommitDescriptorCodeLength =
        594;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerCommitDescriptorCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerCommitDescriptorCode =
        "(function(stream, pullIntoDescriptor) {\n  \"use strict\", "
        "@assert(@getByIdDirectPrivate(stream, \"state\") !== "
        "@streamErrored);\n  let done = !1;\n  if "
        "(@getByIdDirectPrivate(stream, \"state\") === @streamClosed)\n    "
        "@assert(!pullIntoDescriptor.bytesFilled), done = !0;\n  let "
        "filledView = "
        "@readableByteStreamControllerConvertDescriptor(pullIntoDescriptor);\n "
        " if (pullIntoDescriptor.readerType === \"default\")\n    "
        "@readableStreamFulfillReadRequest(stream, filledView, done);\n  "
        "else\n    @assert(pullIntoDescriptor.readerType === \"byob\"), "
        "@readableStreamFulfillReadIntoRequest(stream, filledView, done);\n})";

// readableByteStreamControllerConvertDescriptor
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerConvertDescriptorCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerConvertDescriptorCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerConvertDescriptorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerConvertDescriptorCodeLength =
        363;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerConvertDescriptorCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerConvertDescriptorCode =
        "(function(pullIntoDescriptor) {\n  return \"use strict\", "
        "@assert(pullIntoDescriptor.bytesFilled <= "
        "pullIntoDescriptor.byteLength), "
        "@assert(pullIntoDescriptor.bytesFilled % "
        "pullIntoDescriptor.elementSize === 0), new "
        "pullIntoDescriptor.ctor(pullIntoDescriptor.buffer, "
        "pullIntoDescriptor.byteOffset, pullIntoDescriptor.bytesFilled / "
        "pullIntoDescriptor.elementSize);\n})";

// readableStreamFulfillReadIntoRequest
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableStreamFulfillReadIntoRequestCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableStreamFulfillReadIntoRequestCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableStreamFulfillReadIntoRequestCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableStreamFulfillReadIntoRequestCodeLength =
        229;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableStreamFulfillReadIntoRequestCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableStreamFulfillReadIntoRequestCode =
        "(function(stream, chunk, done) {\n  \"use strict\";\n  const "
        "readIntoRequest = @getByIdDirectPrivate(@getByIdDirectPrivate(stream, "
        "\"reader\"), \"readIntoRequests\").shift();\n  "
        "@fulfillPromise(readIntoRequest, { value: chunk, done });\n})";

// readableStreamBYOBReaderRead
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableStreamBYOBReaderReadCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableStreamBYOBReaderReadCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableStreamBYOBReaderReadCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableStreamBYOBReaderReadCodeLength =
    435;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableStreamBYOBReaderReadCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableByteStreamInternalsReadableStreamBYOBReaderReadCode =
        "(function(reader, view) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(reader, \"ownerReadableStream\");\n  if "
        "(@assert(!!stream), @putByIdDirectPrivate(stream, \"disturbed\", !0), "
        "@getByIdDirectPrivate(stream, \"state\") === @streamErrored)\n    "
        "return @Promise.@reject(@getByIdDirectPrivate(stream, "
        "\"storedError\"));\n  return "
        "@readableByteStreamControllerPullInto(@getByIdDirectPrivate(stream, "
        "\"readableStreamController\"), view);\n})";

// readableByteStreamControllerPullInto
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableByteStreamControllerPullIntoCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableByteStreamControllerPullIntoCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableByteStreamControllerPullIntoCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableByteStreamControllerPullIntoCodeLength =
        1884;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableByteStreamControllerPullIntoCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableByteStreamInternalsReadableByteStreamControllerPullIntoCode =
        "(function(controller, view) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(controller, \"controlledReadableStream\");\n  "
        "let elementSize = 1;\n  if (view.BYTES_PER_ELEMENT !== @undefined)\n  "
        "  elementSize = view.BYTES_PER_ELEMENT;\n  const ctor = "
        "view.constructor, pullIntoDescriptor = {\n    buffer: view.buffer,\n  "
        "  byteOffset: view.byteOffset,\n    byteLength: view.byteLength,\n    "
        "bytesFilled: 0,\n    elementSize,\n    ctor,\n    readerType: "
        "\"byob\"\n  };\n  var pending = @getByIdDirectPrivate(controller, "
        "\"pendingPullIntos\");\n  if (pending\?.isNotEmpty())\n    return "
        "pullIntoDescriptor.buffer = "
        "@transferBufferToCurrentRealm(pullIntoDescriptor.buffer), "
        "pending.push(pullIntoDescriptor), "
        "@readableStreamAddReadIntoRequest(stream);\n  if "
        "(@getByIdDirectPrivate(stream, \"state\") === @streamClosed) {\n    "
        "const emptyView = new ctor(pullIntoDescriptor.buffer, "
        "pullIntoDescriptor.byteOffset, 0);\n    return "
        "@createFulfilledPromise({ value: emptyView, done: !0 });\n  }\n  if "
        "(@getByIdDirectPrivate(controller, \"queue\").size > 0) {\n    if "
        "(@readableByteStreamControllerFillDescriptorFromQueue(controller, "
        "pullIntoDescriptor)) {\n      const filledView = "
        "@readableByteStreamControllerConvertDescriptor(pullIntoDescriptor);\n "
        "     return "
        "@readableByteStreamControllerHandleQueueDrain(controller), "
        "@createFulfilledPromise({ value: filledView, done: !1 });\n    }\n    "
        "if (@getByIdDirectPrivate(controller, \"closeRequested\")) {\n      "
        "const e = @makeTypeError(\"Closing stream has been requested\");\n    "
        "  return @readableByteStreamControllerError(controller, e), "
        "@Promise.@reject(e);\n    }\n  }\n  pullIntoDescriptor.buffer = "
        "@transferBufferToCurrentRealm(pullIntoDescriptor.buffer), "
        "@getByIdDirectPrivate(controller, "
        "\"pendingPullIntos\").push(pullIntoDescriptor);\n  const promise = "
        "@readableStreamAddReadIntoRequest(stream);\n  return "
        "@readableByteStreamControllerCallPullIfNeeded(controller), "
        "promise;\n})";

// readableStreamAddReadIntoRequest
const JSC::ConstructAbility
    s_readableByteStreamInternalsReadableStreamAddReadIntoRequestCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableByteStreamInternalsReadableStreamAddReadIntoRequestCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableByteStreamInternalsReadableStreamAddReadIntoRequestCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableByteStreamInternalsReadableStreamAddReadIntoRequestCodeLength =
        407;
static const JSC::Intrinsic
    s_readableByteStreamInternalsReadableStreamAddReadIntoRequestCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableByteStreamInternalsReadableStreamAddReadIntoRequestCode =
        "(function(stream) {\n  \"use strict\", "
        "@assert(@isReadableStreamBYOBReader(@getByIdDirectPrivate(stream, "
        "\"reader\"))), @assert(@getByIdDirectPrivate(stream, \"state\") === "
        "@streamReadable || @getByIdDirectPrivate(stream, \"state\") === "
        "@streamClosed);\n  const readRequest = @newPromise();\n  return "
        "@getByIdDirectPrivate(@getByIdDirectPrivate(stream, \"reader\"), "
        "\"readIntoRequests\").push(readRequest), readRequest;\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .readableByteStreamInternalsBuiltins()                                 \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .readableByteStreamInternalsBuiltins()                      \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_READABLEBYTESTREAMINTERNALS_BUILTIN_CODE(
    DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ReadableStream.ts */
// initializeReadableStream
const JSC::ConstructAbility
    s_readableStreamInitializeReadableStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInitializeReadableStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInitializeReadableStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInitializeReadableStreamCodeLength = 2893;
static const JSC::Intrinsic
    s_readableStreamInitializeReadableStreamCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamInitializeReadableStreamCode =
    "(function(underlyingSource, strategy) {\n  if (\"use strict\", "
    "underlyingSource === @undefined)\n    underlyingSource = { "
    "@bunNativeType: 0, @bunNativePtr: 0, @lazy: !1 };\n  if (strategy === "
    "@undefined)\n    strategy = {};\n  if (!@isObject(underlyingSource))\n    "
    "@throwTypeError(\"ReadableStream constructor takes an object as first "
    "argument\");\n  if (strategy !== @undefined && !@isObject(strategy))\n    "
    "@throwTypeError(\"ReadableStream constructor takes an object as second "
    "argument, if any\");\n  @putByIdDirectPrivate(this, \"state\", "
    "@streamReadable), @putByIdDirectPrivate(this, \"reader\", @undefined), "
    "@putByIdDirectPrivate(this, \"storedError\", @undefined), "
    "@putByIdDirectPrivate(this, \"disturbed\", !1), "
    "@putByIdDirectPrivate(this, \"readableStreamController\", null), "
    "@putByIdDirectPrivate(this, \"bunNativeType\", "
    "@getByIdDirectPrivate(underlyingSource, \"bunNativeType\") \?\? 0), "
    "@putByIdDirectPrivate(this, \"bunNativePtr\", "
    "@getByIdDirectPrivate(underlyingSource, \"bunNativePtr\") \?\? 0);\n  "
    "const isDirect = underlyingSource.type === \"direct\", "
    "isUnderlyingSourceLazy = !!underlyingSource.@lazy, isLazy = isDirect || "
    "isUnderlyingSourceLazy;\n  if (@getByIdDirectPrivate(underlyingSource, "
    "\"pull\") !== @undefined && !isLazy) {\n    const size = "
    "@getByIdDirectPrivate(strategy, \"size\"), highWaterMark = "
    "@getByIdDirectPrivate(strategy, \"highWaterMark\");\n    return "
    "@putByIdDirectPrivate(this, \"highWaterMark\", highWaterMark), "
    "@putByIdDirectPrivate(this, \"underlyingSource\", @undefined), "
    "@setupReadableStreamDefaultController(this, underlyingSource, size, "
    "highWaterMark !== @undefined \? highWaterMark : 1, "
    "@getByIdDirectPrivate(underlyingSource, \"start\"), "
    "@getByIdDirectPrivate(underlyingSource, \"pull\"), "
    "@getByIdDirectPrivate(underlyingSource, \"cancel\")), this;\n  }\n  if "
    "(isDirect)\n    @putByIdDirectPrivate(this, \"underlyingSource\", "
    "underlyingSource), @putByIdDirectPrivate(this, \"highWaterMark\", "
    "@getByIdDirectPrivate(strategy, \"highWaterMark\")), "
    "@putByIdDirectPrivate(this, \"start\", () => "
    "@createReadableStreamController(this, underlyingSource, strategy));\n  "
    "else if (isLazy) {\n    const autoAllocateChunkSize = "
    "underlyingSource.autoAllocateChunkSize;\n    @putByIdDirectPrivate(this, "
    "\"highWaterMark\", @undefined), @putByIdDirectPrivate(this, "
    "\"underlyingSource\", @undefined), @putByIdDirectPrivate(this, "
    "\"highWaterMark\", autoAllocateChunkSize || "
    "@getByIdDirectPrivate(strategy, \"highWaterMark\")), "
    "@putByIdDirectPrivate(this, \"start\", () => {\n      const instance = "
    "@lazyLoadStream(this, autoAllocateChunkSize);\n      if (instance)\n      "
    "  @createReadableStreamController(this, instance, strategy);\n    });\n  "
    "} else\n    @putByIdDirectPrivate(this, \"underlyingSource\", "
    "@undefined), @putByIdDirectPrivate(this, \"highWaterMark\", "
    "@getByIdDirectPrivate(strategy, \"highWaterMark\")), "
    "@putByIdDirectPrivate(this, \"start\", @undefined), "
    "@createReadableStreamController(this, underlyingSource, strategy);\n  "
    "return this;\n})";

// readableStreamToArray
const JSC::ConstructAbility
    s_readableStreamReadableStreamToArrayCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamReadableStreamToArrayCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamReadableStreamToArrayCodeImplementationVisibility =
        JSC::ImplementationVisibility::Private;
const int s_readableStreamReadableStreamToArrayCodeLength = 263;
static const JSC::Intrinsic s_readableStreamReadableStreamToArrayCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamReadableStreamToArrayCode =
    "(function(stream) {\n  \"use strict\";\n  var underlyingSource = "
    "@getByIdDirectPrivate(stream, \"underlyingSource\");\n  if "
    "(underlyingSource !== @undefined)\n    return "
    "@readableStreamToArrayDirect(stream, underlyingSource);\n  return "
    "@readableStreamIntoArray(stream);\n})";

// readableStreamToText
const JSC::ConstructAbility
    s_readableStreamReadableStreamToTextCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamReadableStreamToTextCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamReadableStreamToTextCodeImplementationVisibility =
        JSC::ImplementationVisibility::Private;
const int s_readableStreamReadableStreamToTextCodeLength = 261;
static const JSC::Intrinsic s_readableStreamReadableStreamToTextCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamReadableStreamToTextCode =
    "(function(stream) {\n  \"use strict\";\n  var underlyingSource = "
    "@getByIdDirectPrivate(stream, \"underlyingSource\");\n  if "
    "(underlyingSource !== @undefined)\n    return "
    "@readableStreamToTextDirect(stream, underlyingSource);\n  return "
    "@readableStreamIntoText(stream);\n})";

// readableStreamToArrayBuffer
const JSC::ConstructAbility
    s_readableStreamReadableStreamToArrayBufferCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamReadableStreamToArrayBufferCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamReadableStreamToArrayBufferCodeImplementationVisibility =
        JSC::ImplementationVisibility::Private;
const int s_readableStreamReadableStreamToArrayBufferCodeLength = 302;
static const JSC::Intrinsic
    s_readableStreamReadableStreamToArrayBufferCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamReadableStreamToArrayBufferCode =
    "(function(stream) {\n  \"use strict\";\n  var underlyingSource = "
    "@getByIdDirectPrivate(stream, \"underlyingSource\");\n  if "
    "(underlyingSource !== @undefined)\n    return "
    "@readableStreamToArrayBufferDirect(stream, underlyingSource);\n  return "
    "@Bun.readableStreamToArray(stream).@then(@Bun.concatArrayBuffers);\n})";

// readableStreamToJSON
const JSC::ConstructAbility
    s_readableStreamReadableStreamToJSONCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamReadableStreamToJSONCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamReadableStreamToJSONCodeImplementationVisibility =
        JSC::ImplementationVisibility::Private;
const int s_readableStreamReadableStreamToJSONCodeLength = 109;
static const JSC::Intrinsic s_readableStreamReadableStreamToJSONCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamReadableStreamToJSONCode =
    "(function(stream) {\n  return \"use strict\", "
    "@Bun.readableStreamToText(stream).@then(globalThis.JSON.parse);\n})";

// readableStreamToBlob
const JSC::ConstructAbility
    s_readableStreamReadableStreamToBlobCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamReadableStreamToBlobCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamReadableStreamToBlobCodeImplementationVisibility =
        JSC::ImplementationVisibility::Private;
const int s_readableStreamReadableStreamToBlobCodeLength = 133;
static const JSC::Intrinsic s_readableStreamReadableStreamToBlobCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamReadableStreamToBlobCode =
    "(function(stream) {\n  return \"use strict\", "
    "@Promise.resolve(@Bun.readableStreamToArray(stream)).@then((array) => new "
    "Blob(array));\n})";

// consumeReadableStream
const JSC::ConstructAbility
    s_readableStreamConsumeReadableStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamConsumeReadableStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamConsumeReadableStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Private;
const int s_readableStreamConsumeReadableStreamCodeLength = 2871;
static const JSC::Intrinsic s_readableStreamConsumeReadableStreamCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamConsumeReadableStreamCode =
    "(function(nativePtr, nativeType, inputStream) {\n  \"use strict\";\n  "
    "const symbol = "
    "globalThis.Symbol.for(\"Bun.consumeReadableStreamPrototype\");\n  var "
    "cached = globalThis[symbol];\n  if (!cached)\n    cached = "
    "globalThis[symbol] = [];\n  var Prototype = cached[nativeType];\n  if "
    "(Prototype === @undefined) {\n    var [doRead, doError, doReadMany, "
    "doClose, onClose, deinit] = "
    "globalThis[globalThis.Symbol.for(\"Bun.lazy\")](nativeType);\n    "
    "Prototype = class NativeReadableStreamSink {\n      handleError;\n      "
    "handleClosed;\n      processResult;\n      constructor(reader, ptr) {\n   "
    "     this.#ptr = ptr, this.#reader = reader, this.#didClose = !1, "
    "this.handleError = this._handleError.bind(this), this.handleClosed = "
    "this._handleClosed.bind(this), this.processResult = "
    "this._processResult.bind(this), reader.closed.then(this.handleClosed, "
    "this.handleError);\n      }\n      _handleClosed() {\n        if "
    "(this.#didClose)\n          return;\n        this.#didClose = !0;\n       "
    " var ptr = this.#ptr;\n        this.#ptr = 0, doClose(ptr), "
    "deinit(ptr);\n      }\n      _handleError(error) {\n        if "
    "(this.#didClose)\n          return;\n        this.#didClose = !0;\n       "
    " var ptr = this.#ptr;\n        this.#ptr = 0, doError(ptr, error), "
    "deinit(ptr);\n      }\n      #ptr;\n      #didClose = !1;\n      "
    "#reader;\n      _handleReadMany({ value, done, size }) {\n        if "
    "(done) {\n          this.handleClosed();\n          return;\n        }\n  "
    "      if (this.#didClose)\n          return;\n        "
    "doReadMany(this.#ptr, value, done, size);\n      }\n      read() {\n      "
    "  if (!this.#ptr)\n          return @throwTypeError(\"ReadableStreamSink "
    "is already closed\");\n        return "
    "this.processResult(this.#reader.read());\n      }\n      "
    "_processResult(result) {\n        if (result && @isPromise(result)) {\n   "
    "       if (@getPromiseInternalField(result, @promiseFieldFlags) & "
    "@promiseStateFulfilled) {\n            const fulfilledValue = "
    "@getPromiseInternalField(result, @promiseFieldReactionsOrResult);\n       "
    "     if (fulfilledValue)\n              result = fulfilledValue;\n        "
    "  }\n        }\n        if (result && @isPromise(result))\n          "
    "return result.then(this.processResult, this.handleError), null;\n        "
    "if (result.done)\n          return this.handleClosed(), 0;\n        else "
    "if (result.value)\n          return result.value;\n        else\n         "
    " return -1;\n      }\n      readMany() {\n        if (!this.#ptr)\n       "
    "   return @throwTypeError(\"ReadableStreamSink is already closed\");\n    "
    "    return this.processResult(this.#reader.readMany());\n      }\n    "
    "};\n    const minlength = nativeType + 1;\n    if (cached.length < "
    "minlength)\n      cached.length = minlength;\n    @putByValDirect(cached, "
    "nativeType, Prototype);\n  }\n  if "
    "(@isReadableStreamLocked(inputStream))\n    @throwTypeError(\"Cannot "
    "start reading from a locked stream\");\n  return new "
    "Prototype(inputStream.getReader(), nativePtr);\n})";

// createEmptyReadableStream
const JSC::ConstructAbility
    s_readableStreamCreateEmptyReadableStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamCreateEmptyReadableStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamCreateEmptyReadableStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Private;
const int s_readableStreamCreateEmptyReadableStreamCodeLength = 141;
static const JSC::Intrinsic
    s_readableStreamCreateEmptyReadableStreamCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamCreateEmptyReadableStreamCode =
    "(function() {\n  \"use strict\";\n  var stream = new @ReadableStream({\n  "
    "  pull() {\n    }\n  });\n  return @readableStreamClose(stream), "
    "stream;\n})";

// createNativeReadableStream
const JSC::ConstructAbility
    s_readableStreamCreateNativeReadableStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamCreateNativeReadableStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamCreateNativeReadableStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Private;
const int s_readableStreamCreateNativeReadableStreamCodeLength = 214;
static const JSC::Intrinsic
    s_readableStreamCreateNativeReadableStreamCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamCreateNativeReadableStreamCode =
    "(function(nativePtr, nativeType, autoAllocateChunkSize) {\n  return \"use "
    "strict\", new @ReadableStream({\n    @lazy: !0,\n    @bunNativeType: "
    "nativeType,\n    @bunNativePtr: nativePtr,\n    autoAllocateChunkSize\n  "
    "});\n})";

// cancel
const JSC::ConstructAbility s_readableStreamCancelCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamCancelCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamCancelCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamCancelCodeLength = 301;
static const JSC::Intrinsic s_readableStreamCancelCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamCancelCode =
    "(function(reason) {\n  if (\"use strict\", !@isReadableStream(this))\n    "
    "return @Promise.@reject(@makeThisTypeError(\"ReadableStream\", "
    "\"cancel\"));\n  if (@isReadableStreamLocked(this))\n    return "
    "@Promise.@reject(@makeTypeError(\"ReadableStream is locked\"));\n  return "
    "@readableStreamCancel(this, reason);\n})";

// getReader
const JSC::ConstructAbility s_readableStreamGetReaderCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamGetReaderCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamGetReaderCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamGetReaderCodeLength = 579;
static const JSC::Intrinsic s_readableStreamGetReaderCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamGetReaderCode =
    "(function(options) {\n  if (\"use strict\", !@isReadableStream(this))\n   "
    " throw @makeThisTypeError(\"ReadableStream\", \"getReader\");\n  const "
    "mode = @toDictionary(options, {}, \"ReadableStream.getReader takes an "
    "object as first argument\").mode;\n  if (mode === @undefined) {\n    var "
    "start_ = @getByIdDirectPrivate(this, \"start\");\n    if (start_)\n      "
    "@putByIdDirectPrivate(this, \"start\", @undefined), start_();\n    return "
    "new @ReadableStreamDefaultReader(this);\n  }\n  if (mode == \"byob\")\n   "
    " return new @ReadableStreamBYOBReader(this);\n  @throwTypeError(\"Invalid "
    "mode is specified\");\n})";

// pipeThrough
const JSC::ConstructAbility s_readableStreamPipeThroughCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamPipeThroughCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamPipeThroughCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamPipeThroughCodeLength = 1319;
static const JSC::Intrinsic s_readableStreamPipeThroughCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamPipeThroughCode =
    "(function(streams, options) {\n  \"use strict\";\n  const transforms = "
    "streams, readable = transforms[\"readable\"];\n  if "
    "(!@isReadableStream(readable))\n    throw @makeTypeError(\"readable "
    "should be ReadableStream\");\n  const writable = "
    "transforms[\"writable\"], internalWritable = "
    "@getInternalWritableStream(writable);\n  if "
    "(!@isWritableStream(internalWritable))\n    throw "
    "@makeTypeError(\"writable should be WritableStream\");\n  let "
    "preventClose = !1, preventAbort = !1, preventCancel = !1, signal;\n  if "
    "(!@isUndefinedOrNull(options)) {\n    if (!@isObject(options))\n      "
    "throw @makeTypeError(\"options must be an object\");\n    if "
    "(preventAbort = !!options[\"preventAbort\"], preventCancel = "
    "!!options[\"preventCancel\"], preventClose = !!options[\"preventClose\"], "
    "signal = options[\"signal\"], signal !== @undefined && "
    "!@isAbortSignal(signal))\n      throw @makeTypeError(\"options.signal "
    "must be AbortSignal\");\n  }\n  if (!@isReadableStream(this))\n    throw "
    "@makeThisTypeError(\"ReadableStream\", \"pipeThrough\");\n  if "
    "(@isReadableStreamLocked(this))\n    throw "
    "@makeTypeError(\"ReadableStream is locked\");\n  if "
    "(@isWritableStreamLocked(internalWritable))\n    throw "
    "@makeTypeError(\"WritableStream is locked\");\n  return "
    "@readableStreamPipeToWritableStream(this, internalWritable, preventClose, "
    "preventAbort, preventCancel, signal), readable;\n})";

// pipeTo
const JSC::ConstructAbility s_readableStreamPipeToCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamPipeToCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamPipeToCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamPipeToCodeLength = 1339;
static const JSC::Intrinsic s_readableStreamPipeToCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamPipeToCode =
    "(function(destination) {\n  if (\"use strict\", "
    "!@isReadableStream(this))\n    return "
    "@Promise.@reject(@makeThisTypeError(\"ReadableStream\", \"pipeTo\"));\n  "
    "if (@isReadableStreamLocked(this))\n    return "
    "@Promise.@reject(@makeTypeError(\"ReadableStream is locked\"));\n  let "
    "options = @argument(1), preventClose = !1, preventAbort = !1, "
    "preventCancel = !1, signal;\n  if (!@isUndefinedOrNull(options)) {\n    "
    "if (!@isObject(options))\n      return "
    "@Promise.@reject(@makeTypeError(\"options must be an object\"));\n    try "
    "{\n      preventAbort = !!options[\"preventAbort\"], preventCancel = "
    "!!options[\"preventCancel\"], preventClose = !!options[\"preventClose\"], "
    "signal = options[\"signal\"];\n    } catch (e) {\n      return "
    "@Promise.@reject(e);\n    }\n    if (signal !== @undefined && "
    "!@isAbortSignal(signal))\n      return "
    "@Promise.@reject(@makeTypeError(\"options.signal must be "
    "AbortSignal\"));\n  }\n  const internalDestination = "
    "@getInternalWritableStream(destination);\n  if "
    "(!@isWritableStream(internalDestination))\n    return "
    "@Promise.@reject(@makeTypeError(\"ReadableStream pipeTo requires a "
    "WritableStream\"));\n  if "
    "(@isWritableStreamLocked(internalDestination))\n    return "
    "@Promise.@reject(@makeTypeError(\"WritableStream is locked\"));\n  return "
    "@readableStreamPipeToWritableStream(this, internalDestination, "
    "preventClose, preventAbort, preventCancel, signal);\n})";

// tee
const JSC::ConstructAbility s_readableStreamTeeCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamTeeCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamTeeCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamTeeCodeLength = 156;
static const JSC::Intrinsic s_readableStreamTeeCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamTeeCode =
    "(function() {\n  if (\"use strict\", !@isReadableStream(this))\n    throw "
    "@makeThisTypeError(\"ReadableStream\", \"tee\");\n  return "
    "@readableStreamTee(this, !1);\n})";

// locked
const JSC::ConstructAbility s_readableStreamLockedCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamLockedCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamLockedCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamLockedCodeLength = 162;
static const JSC::Intrinsic s_readableStreamLockedCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamLockedCode =
    "(function() {\n  if (\"use strict\", !@isReadableStream(this))\n    throw "
    "@makeGetterTypeError(\"ReadableStream\", \"locked\");\n  return "
    "@isReadableStreamLocked(this);\n})";

// values
const JSC::ConstructAbility s_readableStreamValuesCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamValuesCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamValuesCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamValuesCodeLength = 179;
static const JSC::Intrinsic s_readableStreamValuesCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamValuesCode =
    "(function(options) {\n  \"use strict\";\n  var prototype = "
    "@ReadableStream.prototype;\n  return "
    "@readableStreamDefineLazyIterators(prototype), "
    "prototype.values.@call(this, options);\n})";

// lazyAsyncIterator
const JSC::ConstructAbility
    s_readableStreamLazyAsyncIteratorCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamLazyAsyncIteratorCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamLazyAsyncIteratorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Private;
const int s_readableStreamLazyAsyncIteratorCodeLength = 189;
static const JSC::Intrinsic s_readableStreamLazyAsyncIteratorCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamLazyAsyncIteratorCode =
    "(function() {\n  \"use strict\";\n  var prototype = "
    "@ReadableStream.prototype;\n  return "
    "@readableStreamDefineLazyIterators(prototype), "
    "prototype[globalThis.Symbol.asyncIterator].@call(this);\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .readableStreamBuiltins()                                              \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .readableStreamBuiltins()                                   \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_READABLESTREAM_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ReadableStreamBYOBReader.ts */
// initializeReadableStreamBYOBReader
const JSC::ConstructAbility
    s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCodeLength =
        548;
static const JSC::Intrinsic
    s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCode =
        "(function(stream) {\n  if (\"use strict\", "
        "!@isReadableStream(stream))\n    "
        "@throwTypeError(\"ReadableStreamBYOBReader needs a "
        "ReadableStream\");\n  if "
        "(!@isReadableByteStreamController(@getByIdDirectPrivate(stream, "
        "\"readableStreamController\")))\n    "
        "@throwTypeError(\"ReadableStreamBYOBReader needs a "
        "ReadableByteStreamController\");\n  if "
        "(@isReadableStreamLocked(stream))\n    "
        "@throwTypeError(\"ReadableStream is locked\");\n  return "
        "@readableStreamReaderGenericInitialize(this, stream), "
        "@putByIdDirectPrivate(this, \"readIntoRequests\", @createFIFO()), "
        "this;\n})";

// cancel
const JSC::ConstructAbility
    s_readableStreamBYOBReaderCancelCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamBYOBReaderCancelCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamBYOBReaderCancelCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamBYOBReaderCancelCodeLength = 387;
static const JSC::Intrinsic s_readableStreamBYOBReaderCancelCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamBYOBReaderCancelCode =
    "(function(reason) {\n  if (\"use strict\", "
    "!@isReadableStreamBYOBReader(this))\n    return "
    "@Promise.@reject(@makeThisTypeError(\"ReadableStreamBYOBReader\", "
    "\"cancel\"));\n  if (!@getByIdDirectPrivate(this, "
    "\"ownerReadableStream\"))\n    return "
    "@Promise.@reject(@makeTypeError(\"cancel() called on a reader owned by no "
    "readable stream\"));\n  return @readableStreamReaderGenericCancel(this, "
    "reason);\n})";

// read
const JSC::ConstructAbility s_readableStreamBYOBReaderReadCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamBYOBReaderReadCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamBYOBReaderReadCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamBYOBReaderReadCodeLength = 717;
static const JSC::Intrinsic s_readableStreamBYOBReaderReadCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamBYOBReaderReadCode =
    "(function(view) {\n  if (\"use strict\", "
    "!@isReadableStreamBYOBReader(this))\n    return "
    "@Promise.@reject(@makeThisTypeError(\"ReadableStreamBYOBReader\", "
    "\"read\"));\n  if (!@getByIdDirectPrivate(this, "
    "\"ownerReadableStream\"))\n    return "
    "@Promise.@reject(@makeTypeError(\"read() called on a reader owned by no "
    "readable stream\"));\n  if (!@isObject(view))\n    return "
    "@Promise.@reject(@makeTypeError(\"Provided view is not an object\"));\n  "
    "if (!ArrayBuffer.@isView(view))\n    return "
    "@Promise.@reject(@makeTypeError(\"Provided view is not an "
    "ArrayBufferView\"));\n  if (view.byteLength === 0)\n    return "
    "@Promise.@reject(@makeTypeError(\"Provided view cannot have a 0 "
    "byteLength\"));\n  return @readableStreamBYOBReaderRead(this, view);\n})";

// releaseLock
const JSC::ConstructAbility
    s_readableStreamBYOBReaderReleaseLockCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamBYOBReaderReleaseLockCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamBYOBReaderReleaseLockCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamBYOBReaderReleaseLockCodeLength = 417;
static const JSC::Intrinsic s_readableStreamBYOBReaderReleaseLockCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamBYOBReaderReleaseLockCode =
    "(function() {\n  if (\"use strict\", "
    "!@isReadableStreamBYOBReader(this))\n    throw "
    "@makeThisTypeError(\"ReadableStreamBYOBReader\", \"releaseLock\");\n  if "
    "(!@getByIdDirectPrivate(this, \"ownerReadableStream\"))\n    return;\n  "
    "if (@getByIdDirectPrivate(this, \"readIntoRequests\")\?.isNotEmpty())\n   "
    " @throwTypeError(\"There are still pending read requests, cannot release "
    "the lock\");\n  @readableStreamReaderGenericRelease(this);\n})";

// closed
const JSC::ConstructAbility
    s_readableStreamBYOBReaderClosedCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamBYOBReaderClosedCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamBYOBReaderClosedCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamBYOBReaderClosedCodeLength = 235;
static const JSC::Intrinsic s_readableStreamBYOBReaderClosedCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamBYOBReaderClosedCode =
    "(function() {\n  if (\"use strict\", "
    "!@isReadableStreamBYOBReader(this))\n    return "
    "@Promise.@reject(@makeGetterTypeError(\"ReadableStreamBYOBReader\", "
    "\"closed\"));\n  return @getByIdDirectPrivate(this, "
    "\"closedPromiseCapability\").@promise;\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .readableStreamBYOBReaderBuiltins()                                    \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .readableStreamBYOBReaderBuiltins()                         \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_READABLESTREAMBYOBREADER_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ReadableStreamBYOBRequest.ts */
// initializeReadableStreamBYOBRequest
const JSC::ConstructAbility
    s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCodeLength =
        290;
static const JSC::Intrinsic
    s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCode =
        "(function(controller, view) {\n  if (\"use strict\", arguments.length "
        "!== 3 && arguments[2] !== @isReadableStream)\n    "
        "@throwTypeError(\"ReadableStreamBYOBRequest constructor should not be "
        "called directly\");\n  return "
        "@privateInitializeReadableStreamBYOBRequest.@call(this, controller, "
        "view);\n})";

// respond
const JSC::ConstructAbility
    s_readableStreamBYOBRequestRespondCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamBYOBRequestRespondCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamBYOBRequestRespondCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamBYOBRequestRespondCodeLength = 481;
static const JSC::Intrinsic s_readableStreamBYOBRequestRespondCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamBYOBRequestRespondCode =
    "(function(bytesWritten) {\n  if (\"use strict\", "
    "!@isReadableStreamBYOBRequest(this))\n    throw "
    "@makeThisTypeError(\"ReadableStreamBYOBRequest\", \"respond\");\n  if "
    "(@getByIdDirectPrivate(this, \"associatedReadableByteStreamController\") "
    "=== @undefined)\n    "
    "@throwTypeError(\"ReadableStreamBYOBRequest."
    "associatedReadableByteStreamController is undefined\");\n  return "
    "@readableByteStreamControllerRespond(@getByIdDirectPrivate(this, "
    "\"associatedReadableByteStreamController\"), bytesWritten);\n})";

// respondWithNewView
const JSC::ConstructAbility
    s_readableStreamBYOBRequestRespondWithNewViewCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamBYOBRequestRespondWithNewViewCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamBYOBRequestRespondWithNewViewCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamBYOBRequestRespondWithNewViewCodeLength = 653;
static const JSC::Intrinsic
    s_readableStreamBYOBRequestRespondWithNewViewCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamBYOBRequestRespondWithNewViewCode =
    "(function(view) {\n  if (\"use strict\", "
    "!@isReadableStreamBYOBRequest(this))\n    throw "
    "@makeThisTypeError(\"ReadableStreamBYOBRequest\", \"respond\");\n  if "
    "(@getByIdDirectPrivate(this, \"associatedReadableByteStreamController\") "
    "=== @undefined)\n    "
    "@throwTypeError(\"ReadableStreamBYOBRequest."
    "associatedReadableByteStreamController is undefined\");\n  if "
    "(!@isObject(view))\n    @throwTypeError(\"Provided view is not an "
    "object\");\n  if (!ArrayBuffer.@isView(view))\n    "
    "@throwTypeError(\"Provided view is not an ArrayBufferView\");\n  return "
    "@readableByteStreamControllerRespondWithNewView(@getByIdDirectPrivate("
    "this, \"associatedReadableByteStreamController\"), view);\n})";

// view
const JSC::ConstructAbility
    s_readableStreamBYOBRequestViewCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamBYOBRequestViewCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamBYOBRequestViewCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamBYOBRequestViewCodeLength = 188;
static const JSC::Intrinsic s_readableStreamBYOBRequestViewCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamBYOBRequestViewCode =
    "(function() {\n  if (\"use strict\", "
    "!@isReadableStreamBYOBRequest(this))\n    throw "
    "@makeGetterTypeError(\"ReadableStreamBYOBRequest\", \"view\");\n  return "
    "@getByIdDirectPrivate(this, \"view\");\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .readableStreamBYOBRequestBuiltins()                                   \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .readableStreamBYOBRequestBuiltins()                        \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_READABLESTREAMBYOBREQUEST_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ReadableStreamDefaultController.ts */
// initializeReadableStreamDefaultController
const JSC::ConstructAbility
    s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCodeLength =
        360;
static const JSC::Intrinsic
    s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCode =
        "(function(stream, underlyingSource, size, highWaterMark) {\n  if "
        "(\"use strict\", arguments.length !== 5 && arguments[4] !== "
        "@isReadableStream)\n    "
        "@throwTypeError(\"ReadableStreamDefaultController constructor should "
        "not be called directly\");\n  return "
        "@privateInitializeReadableStreamDefaultController.@call(this, stream, "
        "underlyingSource, size, highWaterMark);\n})";

// enqueue
const JSC::ConstructAbility
    s_readableStreamDefaultControllerEnqueueCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamDefaultControllerEnqueueCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamDefaultControllerEnqueueCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultControllerEnqueueCodeLength = 389;
static const JSC::Intrinsic
    s_readableStreamDefaultControllerEnqueueCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamDefaultControllerEnqueueCode =
    "(function(chunk) {\n  if (\"use strict\", "
    "!@isReadableStreamDefaultController(this))\n    throw "
    "@makeThisTypeError(\"ReadableStreamDefaultController\", \"enqueue\");\n  "
    "if (!@readableStreamDefaultControllerCanCloseOrEnqueue(this))\n    "
    "@throwTypeError(\"ReadableStreamDefaultController is not in a state where "
    "chunk can be enqueued\");\n  return "
    "@readableStreamDefaultControllerEnqueue(this, chunk);\n})";

// error
const JSC::ConstructAbility
    s_readableStreamDefaultControllerErrorCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamDefaultControllerErrorCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamDefaultControllerErrorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultControllerErrorCodeLength = 208;
static const JSC::Intrinsic
    s_readableStreamDefaultControllerErrorCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamDefaultControllerErrorCode =
    "(function(err) {\n  if (\"use strict\", "
    "!@isReadableStreamDefaultController(this))\n    throw "
    "@makeThisTypeError(\"ReadableStreamDefaultController\", \"error\");\n  "
    "@readableStreamDefaultControllerError(this, err);\n})";

// close
const JSC::ConstructAbility
    s_readableStreamDefaultControllerCloseCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamDefaultControllerCloseCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamDefaultControllerCloseCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultControllerCloseCodeLength = 361;
static const JSC::Intrinsic
    s_readableStreamDefaultControllerCloseCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamDefaultControllerCloseCode =
    "(function() {\n  if (\"use strict\", "
    "!@isReadableStreamDefaultController(this))\n    throw "
    "@makeThisTypeError(\"ReadableStreamDefaultController\", \"close\");\n  if "
    "(!@readableStreamDefaultControllerCanCloseOrEnqueue(this))\n    "
    "@throwTypeError(\"ReadableStreamDefaultController is not in a state where "
    "it can be closed\");\n  @readableStreamDefaultControllerClose(this);\n})";

// desiredSize
const JSC::ConstructAbility
    s_readableStreamDefaultControllerDesiredSizeCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamDefaultControllerDesiredSizeCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamDefaultControllerDesiredSizeCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultControllerDesiredSizeCodeLength = 224;
static const JSC::Intrinsic
    s_readableStreamDefaultControllerDesiredSizeCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamDefaultControllerDesiredSizeCode =
    "(function() {\n  if (\"use strict\", "
    "!@isReadableStreamDefaultController(this))\n    throw "
    "@makeGetterTypeError(\"ReadableStreamDefaultController\", "
    "\"desiredSize\");\n  return "
    "@readableStreamDefaultControllerGetDesiredSize(this);\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .readableStreamDefaultControllerBuiltins()                             \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .readableStreamDefaultControllerBuiltins()                  \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_READABLESTREAMDEFAULTCONTROLLER_BUILTIN_CODE(
    DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ReadableStreamDefaultReader.ts */
// initializeReadableStreamDefaultReader
const JSC::ConstructAbility
    s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCodeLength =
        362;
static const JSC::Intrinsic
    s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCode =
        "(function(stream) {\n  if (\"use strict\", "
        "!@isReadableStream(stream))\n    "
        "@throwTypeError(\"ReadableStreamDefaultReader needs a "
        "ReadableStream\");\n  if (@isReadableStreamLocked(stream))\n    "
        "@throwTypeError(\"ReadableStream is locked\");\n  return "
        "@readableStreamReaderGenericInitialize(this, stream), "
        "@putByIdDirectPrivate(this, \"readRequests\", @createFIFO()), "
        "this;\n})";

// cancel
const JSC::ConstructAbility
    s_readableStreamDefaultReaderCancelCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamDefaultReaderCancelCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamDefaultReaderCancelCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultReaderCancelCodeLength = 393;
static const JSC::Intrinsic s_readableStreamDefaultReaderCancelCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamDefaultReaderCancelCode =
    "(function(reason) {\n  if (\"use strict\", "
    "!@isReadableStreamDefaultReader(this))\n    return "
    "@Promise.@reject(@makeThisTypeError(\"ReadableStreamDefaultReader\", "
    "\"cancel\"));\n  if (!@getByIdDirectPrivate(this, "
    "\"ownerReadableStream\"))\n    return "
    "@Promise.@reject(@makeTypeError(\"cancel() called on a reader owned by no "
    "readable stream\"));\n  return @readableStreamReaderGenericCancel(this, "
    "reason);\n})";

// readMany
const JSC::ConstructAbility
    s_readableStreamDefaultReaderReadManyCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamDefaultReaderReadManyCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamDefaultReaderReadManyCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultReaderReadManyCodeLength = 3897;
static const JSC::Intrinsic s_readableStreamDefaultReaderReadManyCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamDefaultReaderReadManyCode =
    "(function() {\n  if (\"use strict\", "
    "!@isReadableStreamDefaultReader(this))\n    "
    "@throwTypeError(\"ReadableStreamDefaultReader.readMany() should not be "
    "called directly\");\n  const stream = @getByIdDirectPrivate(this, "
    "\"ownerReadableStream\");\n  if (!stream)\n    "
    "@throwTypeError(\"readMany() called on a reader owned by no readable "
    "stream\");\n  const state = @getByIdDirectPrivate(stream, \"state\");\n  "
    "if (@putByIdDirectPrivate(stream, \"disturbed\", !0), state === "
    "@streamClosed)\n    return { value: [], size: 0, done: !0 };\n  else if "
    "(state === @streamErrored)\n    throw @getByIdDirectPrivate(stream, "
    "\"storedError\");\n  var controller = @getByIdDirectPrivate(stream, "
    "\"readableStreamController\"), queue = @getByIdDirectPrivate(controller, "
    "\"queue\");\n  if (!queue)\n    return "
    "controller.@pull(controller).@then(function({ done, value }) {\n      "
    "return done \? { done: !0, value: [], size: 0 } : { value: [value], size: "
    "1, done: !1 };\n    });\n  const content = queue.content;\n  var size = "
    "queue.size, values = content.toArray(!1), length = values.length;\n  if "
    "(length > 0) {\n    var outValues = @newArrayWithSize(length);\n    if "
    "(@isReadableByteStreamController(controller)) {\n      {\n        const "
    "buf = values[0];\n        if (!(@ArrayBuffer.@isView(buf) || buf "
    "instanceof @ArrayBuffer))\n          @putByValDirect(outValues, 0, new "
    "@Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));\n        else\n "
    "         @putByValDirect(outValues, 0, buf);\n      }\n      for (var i = "
    "1;i < length; i++) {\n        const buf = values[i];\n        if "
    "(!(@ArrayBuffer.@isView(buf) || buf instanceof @ArrayBuffer))\n          "
    "@putByValDirect(outValues, i, new @Uint8Array(buf.buffer, buf.byteOffset, "
    "buf.byteLength));\n        else\n          @putByValDirect(outValues, i, "
    "buf);\n      }\n    } else {\n      @putByValDirect(outValues, 0, "
    "values[0].value);\n      for (var i = 1;i < length; i++)\n        "
    "@putByValDirect(outValues, i, values[i].value);\n    }\n    if "
    "(@resetQueue(@getByIdDirectPrivate(controller, \"queue\")), "
    "@getByIdDirectPrivate(controller, \"closeRequested\"))\n      "
    "@readableStreamClose(@getByIdDirectPrivate(controller, "
    "\"controlledReadableStream\"));\n    else if "
    "(@isReadableStreamDefaultController(controller))\n      "
    "@readableStreamDefaultControllerCallPullIfNeeded(controller);\n    else "
    "if (@isReadableByteStreamController(controller))\n      "
    "@readableByteStreamControllerCallPullIfNeeded(controller);\n    return { "
    "value: outValues, size, done: !1 };\n  }\n  var onPullMany = (result) => "
    "{\n    if (result.done)\n      return { value: [], size: 0, done: !0 };\n "
    "   var controller2 = @getByIdDirectPrivate(stream, "
    "\"readableStreamController\"), queue2 = "
    "@getByIdDirectPrivate(controller2, \"queue\"), value = "
    "[result.value].concat(queue2.content.toArray(!1)), length2 = "
    "value.length;\n    if (@isReadableByteStreamController(controller2))\n    "
    "  for (var i2 = 0;i2 < length2; i2++) {\n        const buf = value[i2];\n "
    "       if (!(@ArrayBuffer.@isView(buf) || buf instanceof @ArrayBuffer)) "
    "{\n          const { buffer, byteOffset, byteLength } = buf;\n          "
    "@putByValDirect(value, i2, new @Uint8Array(buffer, byteOffset, "
    "byteLength));\n        }\n      }\n    else\n      for (var i2 = 1;i2 < "
    "length2; i2++)\n        @putByValDirect(value, i2, value[i2].value);\n    "
    "var size2 = queue2.size;\n    if (@resetQueue(queue2), "
    "@getByIdDirectPrivate(controller2, \"closeRequested\"))\n      "
    "@readableStreamClose(@getByIdDirectPrivate(controller2, "
    "\"controlledReadableStream\"));\n    else if "
    "(@isReadableStreamDefaultController(controller2))\n      "
    "@readableStreamDefaultControllerCallPullIfNeeded(controller2);\n    else "
    "if (@isReadableByteStreamController(controller2))\n      "
    "@readableByteStreamControllerCallPullIfNeeded(controller2);\n    return { "
    "value, size: size2, done: !1 };\n  }, pullResult = "
    "controller.@pull(controller);\n  if (pullResult && "
    "@isPromise(pullResult))\n    return pullResult.@then(onPullMany);\n  "
    "return onPullMany(pullResult);\n})";

// read
const JSC::ConstructAbility
    s_readableStreamDefaultReaderReadCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamDefaultReaderReadCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamDefaultReaderReadCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultReaderReadCodeLength = 373;
static const JSC::Intrinsic s_readableStreamDefaultReaderReadCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamDefaultReaderReadCode =
    "(function() {\n  if (\"use strict\", "
    "!@isReadableStreamDefaultReader(this))\n    return "
    "@Promise.@reject(@makeThisTypeError(\"ReadableStreamDefaultReader\", "
    "\"read\"));\n  if (!@getByIdDirectPrivate(this, "
    "\"ownerReadableStream\"))\n    return "
    "@Promise.@reject(@makeTypeError(\"read() called on a reader owned by no "
    "readable stream\"));\n  return "
    "@readableStreamDefaultReaderRead(this);\n})";

// releaseLock
const JSC::ConstructAbility
    s_readableStreamDefaultReaderReleaseLockCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamDefaultReaderReleaseLockCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamDefaultReaderReleaseLockCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultReaderReleaseLockCodeLength = 419;
static const JSC::Intrinsic
    s_readableStreamDefaultReaderReleaseLockCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamDefaultReaderReleaseLockCode =
    "(function() {\n  if (\"use strict\", "
    "!@isReadableStreamDefaultReader(this))\n    throw "
    "@makeThisTypeError(\"ReadableStreamDefaultReader\", \"releaseLock\");\n  "
    "if (!@getByIdDirectPrivate(this, \"ownerReadableStream\"))\n    return;\n "
    " if (@getByIdDirectPrivate(this, \"readRequests\")\?.isNotEmpty())\n    "
    "@throwTypeError(\"There are still pending read requests, cannot release "
    "the lock\");\n  @readableStreamReaderGenericRelease(this);\n})";

// closed
const JSC::ConstructAbility
    s_readableStreamDefaultReaderClosedCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamDefaultReaderClosedCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamDefaultReaderClosedCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultReaderClosedCodeLength = 241;
static const JSC::Intrinsic s_readableStreamDefaultReaderClosedCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamDefaultReaderClosedCode =
    "(function() {\n  if (\"use strict\", "
    "!@isReadableStreamDefaultReader(this))\n    return "
    "@Promise.@reject(@makeGetterTypeError(\"ReadableStreamDefaultReader\", "
    "\"closed\"));\n  return @getByIdDirectPrivate(this, "
    "\"closedPromiseCapability\").@promise;\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .readableStreamDefaultReaderBuiltins()                                 \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .readableStreamDefaultReaderBuiltins()                      \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_READABLESTREAMDEFAULTREADER_BUILTIN_CODE(
    DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ReadableStreamInternals.ts */
// readableStreamReaderGenericInitialize
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamReaderGenericInitializeCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamReaderGenericInitializeCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamReaderGenericInitializeCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsReadableStreamReaderGenericInitializeCodeLength =
        727;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamReaderGenericInitializeCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsReadableStreamReaderGenericInitializeCode =
        "(function(reader, stream) {\n  if (\"use strict\", "
        "@putByIdDirectPrivate(reader, \"ownerReadableStream\", stream), "
        "@putByIdDirectPrivate(stream, \"reader\", reader), "
        "@getByIdDirectPrivate(stream, \"state\") === @streamReadable)\n    "
        "@putByIdDirectPrivate(reader, \"closedPromiseCapability\", "
        "@newPromiseCapability(@Promise));\n  else if "
        "(@getByIdDirectPrivate(stream, \"state\") === @streamClosed)\n    "
        "@putByIdDirectPrivate(reader, \"closedPromiseCapability\", {\n      "
        "@promise: @Promise.@resolve()\n    });\n  else\n    "
        "@assert(@getByIdDirectPrivate(stream, \"state\") === @streamErrored), "
        "@putByIdDirectPrivate(reader, \"closedPromiseCapability\", {\n      "
        "@promise: @newHandledRejectedPromise(@getByIdDirectPrivate(stream, "
        "\"storedError\"))\n    });\n})";

// privateInitializeReadableStreamDefaultController
const JSC::ConstructAbility
    s_readableStreamInternalsPrivateInitializeReadableStreamDefaultControllerCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsPrivateInitializeReadableStreamDefaultControllerCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsPrivateInitializeReadableStreamDefaultControllerCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsPrivateInitializeReadableStreamDefaultControllerCodeLength =
        809;
static const JSC::Intrinsic
    s_readableStreamInternalsPrivateInitializeReadableStreamDefaultControllerCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableStreamInternalsPrivateInitializeReadableStreamDefaultControllerCode =
        "(function(stream, underlyingSource, size, highWaterMark) {\n  if "
        "(\"use strict\", !@isReadableStream(stream))\n    "
        "@throwTypeError(\"ReadableStreamDefaultController needs a "
        "ReadableStream\");\n  if (@getByIdDirectPrivate(stream, "
        "\"readableStreamController\") !== null)\n    "
        "@throwTypeError(\"ReadableStream already has a controller\");\n  "
        "return @putByIdDirectPrivate(this, \"controlledReadableStream\", "
        "stream), @putByIdDirectPrivate(this, \"underlyingSource\", "
        "underlyingSource), @putByIdDirectPrivate(this, \"queue\", "
        "@newQueue()), @putByIdDirectPrivate(this, \"started\", -1), "
        "@putByIdDirectPrivate(this, \"closeRequested\", !1), "
        "@putByIdDirectPrivate(this, \"pullAgain\", !1), "
        "@putByIdDirectPrivate(this, \"pulling\", !1), "
        "@putByIdDirectPrivate(this, \"strategy\", "
        "@validateAndNormalizeQueuingStrategy(size, highWaterMark)), this;\n})";

// readableStreamDefaultControllerError
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamDefaultControllerErrorCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamDefaultControllerErrorCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamDefaultControllerErrorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsReadableStreamDefaultControllerErrorCodeLength =
        303;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamDefaultControllerErrorCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsReadableStreamDefaultControllerErrorCode =
        "(function(controller, error) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(controller, \"controlledReadableStream\");\n  "
        "if (@getByIdDirectPrivate(stream, \"state\") !== @streamReadable)\n   "
        " return;\n  @putByIdDirectPrivate(controller, \"queue\", "
        "@newQueue()), @readableStreamError(stream, error);\n})";

// readableStreamPipeTo
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamPipeToCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamPipeToCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamPipeToCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamPipeToCodeLength = 671;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamPipeToCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsReadableStreamPipeToCode =
    "(function(stream, sink) {\n  \"use strict\", "
    "@assert(@isReadableStream(stream));\n  const reader = new "
    "@ReadableStreamDefaultReader(stream);\n  @getByIdDirectPrivate(reader, "
    "\"closedPromiseCapability\").@promise.@then(() => {\n  }, (e) => {\n    "
    "sink.error(e);\n  });\n  function doPipe() {\n    "
    "@readableStreamDefaultReaderRead(reader).@then(function(result) {\n      "
    "if (result.done) {\n        sink.close();\n        return;\n      }\n     "
    " try {\n        sink.enqueue(result.value);\n      } catch (e) {\n        "
    "sink.error(\"ReadableStream chunk enqueueing in the sink failed\");\n     "
    "   return;\n      }\n      doPipe();\n    }, function(e) {\n      "
    "sink.error(e);\n    });\n  }\n  doPipe();\n})";

// acquireReadableStreamDefaultReader
const JSC::ConstructAbility
    s_readableStreamInternalsAcquireReadableStreamDefaultReaderCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsAcquireReadableStreamDefaultReaderCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsAcquireReadableStreamDefaultReaderCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsAcquireReadableStreamDefaultReaderCodeLength = 181;
static const JSC::Intrinsic
    s_readableStreamInternalsAcquireReadableStreamDefaultReaderCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsAcquireReadableStreamDefaultReaderCode =
        "(function(stream) {\n  \"use strict\";\n  var start = "
        "@getByIdDirectPrivate(stream, \"start\");\n  if (start)\n    "
        "start.@call(stream);\n  return new "
        "@ReadableStreamDefaultReader(stream);\n})";

// setupReadableStreamDefaultController
const JSC::ConstructAbility
    s_readableStreamInternalsSetupReadableStreamDefaultControllerCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsSetupReadableStreamDefaultControllerCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsSetupReadableStreamDefaultControllerCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsSetupReadableStreamDefaultControllerCodeLength =
        863;
static const JSC::Intrinsic
    s_readableStreamInternalsSetupReadableStreamDefaultControllerCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsSetupReadableStreamDefaultControllerCode =
        "(function(stream, underlyingSource, size, highWaterMark, startMethod, "
        "pullMethod, cancelMethod) {\n  \"use strict\";\n  const controller = "
        "new @ReadableStreamDefaultController(stream, underlyingSource, size, "
        "highWaterMark, @isReadableStream), pullAlgorithm = () => "
        "@promiseInvokeOrNoopMethod(underlyingSource, pullMethod, "
        "[controller]), cancelAlgorithm = (reason) => "
        "@promiseInvokeOrNoopMethod(underlyingSource, cancelMethod, "
        "[reason]);\n  @putByIdDirectPrivate(controller, \"pullAlgorithm\", "
        "pullAlgorithm), @putByIdDirectPrivate(controller, "
        "\"cancelAlgorithm\", cancelAlgorithm), "
        "@putByIdDirectPrivate(controller, \"pull\", "
        "@readableStreamDefaultControllerPull), "
        "@putByIdDirectPrivate(controller, \"cancel\", "
        "@readableStreamDefaultControllerCancel), "
        "@putByIdDirectPrivate(stream, \"readableStreamController\", "
        "controller), @readableStreamDefaultControllerStart(controller);\n})";

// createReadableStreamController
const JSC::ConstructAbility
    s_readableStreamInternalsCreateReadableStreamControllerCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsCreateReadableStreamControllerCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsCreateReadableStreamControllerCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsCreateReadableStreamControllerCodeLength =
    1078;
static const JSC::Intrinsic
    s_readableStreamInternalsCreateReadableStreamControllerCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsCreateReadableStreamControllerCode =
    "(function(stream, underlyingSource, strategy) {\n  \"use strict\";\n  "
    "const type = underlyingSource.type, typeString = @toString(type);\n  if "
    "(typeString === \"bytes\") {\n    if (strategy.highWaterMark === "
    "@undefined)\n      strategy.highWaterMark = 0;\n    if (strategy.size !== "
    "@undefined)\n      @throwRangeError(\"Strategy for a "
    "ReadableByteStreamController cannot have a size\");\n    "
    "@putByIdDirectPrivate(stream, \"readableStreamController\", new "
    "@ReadableByteStreamController(stream, underlyingSource, "
    "strategy.highWaterMark, @isReadableStream));\n  } else if (typeString === "
    "\"direct\") {\n    var highWaterMark = strategy\?.highWaterMark;\n    "
    "@initializeArrayBufferStream.@call(stream, underlyingSource, "
    "highWaterMark);\n  } else if (type === @undefined) {\n    if "
    "(strategy.highWaterMark === @undefined)\n      strategy.highWaterMark = "
    "1;\n    @setupReadableStreamDefaultController(stream, underlyingSource, "
    "strategy.size, strategy.highWaterMark, underlyingSource.start, "
    "underlyingSource.pull, underlyingSource.cancel);\n  } else\n    "
    "@throwRangeError(\"Invalid type for underlying source\");\n})";

// readableStreamDefaultControllerStart
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamDefaultControllerStartCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamDefaultControllerStartCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamDefaultControllerStartCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsReadableStreamDefaultControllerStartCodeLength =
        690;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamDefaultControllerStartCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsReadableStreamDefaultControllerStartCode =
        "(function(controller) {\n  if (\"use strict\", "
        "@getByIdDirectPrivate(controller, \"started\") !== -1)\n    return;\n "
        " const underlyingSource = @getByIdDirectPrivate(controller, "
        "\"underlyingSource\"), startMethod = underlyingSource.start;\n  "
        "@putByIdDirectPrivate(controller, \"started\", 0), "
        "@promiseInvokeOrNoopMethodNoCatch(underlyingSource, startMethod, "
        "[controller]).@then(() => {\n    @putByIdDirectPrivate(controller, "
        "\"started\", 1), @assert(!@getByIdDirectPrivate(controller, "
        "\"pulling\")), @assert(!@getByIdDirectPrivate(controller, "
        "\"pullAgain\")), "
        "@readableStreamDefaultControllerCallPullIfNeeded(controller);\n  }, "
        "(error) => {\n    @readableStreamDefaultControllerError(controller, "
        "error);\n  });\n})";

// readableStreamPipeToWritableStream
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamPipeToWritableStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamPipeToWritableStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamPipeToWritableStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsReadableStreamPipeToWritableStreamCodeLength =
        2656;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamPipeToWritableStreamCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsReadableStreamPipeToWritableStreamCode =
        "(function(source, destination, preventClose, preventAbort, "
        "preventCancel, signal) {\n  \"use strict\";\n  const isDirectStream = "
        "!!@getByIdDirectPrivate(source, \"start\");\n  if "
        "(@assert(@isReadableStream(source)), "
        "@assert(@isWritableStream(destination)), "
        "@assert(!@isReadableStreamLocked(source)), "
        "@assert(!@isWritableStreamLocked(destination)), @assert(signal === "
        "@undefined || @isAbortSignal(signal)), @getByIdDirectPrivate(source, "
        "\"underlyingByteSource\") !== @undefined)\n    return "
        "@Promise.@reject(\"Piping to a readable bytestream is not "
        "supported\");\n  let pipeState = {\n    source,\n    destination,\n   "
        " preventAbort,\n    preventCancel,\n    preventClose,\n    signal\n  "
        "};\n  if (pipeState.reader = "
        "@acquireReadableStreamDefaultReader(source), pipeState.writer = "
        "@acquireWritableStreamDefaultWriter(destination), "
        "@putByIdDirectPrivate(source, \"disturbed\", !0), pipeState.finalized "
        "= !1, pipeState.shuttingDown = !1, pipeState.promiseCapability = "
        "@newPromiseCapability(@Promise), "
        "pipeState.pendingReadPromiseCapability = "
        "@newPromiseCapability(@Promise), "
        "pipeState.pendingReadPromiseCapability.@resolve.@call(), "
        "pipeState.pendingWritePromise = @Promise.@resolve(), signal !== "
        "@undefined) {\n    const algorithm = (reason) => {\n      if "
        "(pipeState.finalized)\n        return;\n      "
        "@pipeToShutdownWithAction(pipeState, () => {\n        const "
        "promiseDestination = !pipeState.preventAbort && "
        "@getByIdDirectPrivate(pipeState.destination, \"state\") === "
        "\"writable\" \? @writableStreamAbort(pipeState.destination, reason) : "
        "@Promise.@resolve(), promiseSource = !pipeState.preventCancel && "
        "@getByIdDirectPrivate(pipeState.source, \"state\") === "
        "@streamReadable \? @readableStreamCancel(pipeState.source, reason) : "
        "@Promise.@resolve();\n        let promiseCapability = "
        "@newPromiseCapability(@Promise), shouldWait = !0, "
        "handleResolvedPromise = () => {\n          if (shouldWait) {\n        "
        "    shouldWait = !1;\n            return;\n          }\n          "
        "promiseCapability.@resolve.@call();\n        }, handleRejectedPromise "
        "= (e) => {\n          promiseCapability.@reject.@call(@undefined, "
        "e);\n        };\n        return "
        "promiseDestination.@then(handleResolvedPromise, "
        "handleRejectedPromise), promiseSource.@then(handleResolvedPromise, "
        "handleRejectedPromise), promiseCapability.@promise;\n      }, "
        "reason);\n    };\n    if (@whenSignalAborted(signal, algorithm))\n    "
        "  return pipeState.promiseCapability.@promise;\n  }\n  return "
        "@pipeToErrorsMustBePropagatedForward(pipeState), "
        "@pipeToErrorsMustBePropagatedBackward(pipeState), "
        "@pipeToClosingMustBePropagatedForward(pipeState), "
        "@pipeToClosingMustBePropagatedBackward(pipeState), "
        "@pipeToLoop(pipeState), pipeState.promiseCapability.@promise;\n})";

// pipeToLoop
const JSC::ConstructAbility
    s_readableStreamInternalsPipeToLoopCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsPipeToLoopCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsPipeToLoopCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsPipeToLoopCodeLength = 185;
static const JSC::Intrinsic s_readableStreamInternalsPipeToLoopCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_readableStreamInternalsPipeToLoopCode =
    "(function(pipeState) {\n  if (\"use strict\", pipeState.shuttingDown)\n   "
    " return;\n  @pipeToDoReadWrite(pipeState).@then((result) => {\n    if "
    "(result)\n      @pipeToLoop(pipeState);\n  });\n})";

// pipeToDoReadWrite
const JSC::ConstructAbility
    s_readableStreamInternalsPipeToDoReadWriteCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsPipeToDoReadWriteCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsPipeToDoReadWriteCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsPipeToDoReadWriteCodeLength = 1010;
static const JSC::Intrinsic
    s_readableStreamInternalsPipeToDoReadWriteCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamInternalsPipeToDoReadWriteCode =
    "(function(pipeState) {\n  return \"use strict\", "
    "@assert(!pipeState.shuttingDown), pipeState.pendingReadPromiseCapability "
    "= @newPromiseCapability(@Promise), "
    "@getByIdDirectPrivate(pipeState.writer, "
    "\"readyPromise\").@promise.@then(() => {\n    if (pipeState.shuttingDown) "
    "{\n      "
    "pipeState.pendingReadPromiseCapability.@resolve.@call(@undefined, !1);\n  "
    "    return;\n    }\n    "
    "@readableStreamDefaultReaderRead(pipeState.reader).@then((result) => {\n  "
    "    const canWrite = !result.done && "
    "@getByIdDirectPrivate(pipeState.writer, \"stream\") !== @undefined;\n     "
    " if (pipeState.pendingReadPromiseCapability.@resolve.@call(@undefined, "
    "canWrite), !canWrite)\n        return;\n      "
    "pipeState.pendingWritePromise = "
    "@writableStreamDefaultWriterWrite(pipeState.writer, result.value);\n    "
    "}, (e) => {\n      "
    "pipeState.pendingReadPromiseCapability.@resolve.@call(@undefined, !1);\n  "
    "  });\n  }, (e) => {\n    "
    "pipeState.pendingReadPromiseCapability.@resolve.@call(@undefined, !1);\n  "
    "}), pipeState.pendingReadPromiseCapability.@promise;\n})";

// pipeToErrorsMustBePropagatedForward
const JSC::ConstructAbility
    s_readableStreamInternalsPipeToErrorsMustBePropagatedForwardCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsPipeToErrorsMustBePropagatedForwardCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsPipeToErrorsMustBePropagatedForwardCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsPipeToErrorsMustBePropagatedForwardCodeLength =
        635;
static const JSC::Intrinsic
    s_readableStreamInternalsPipeToErrorsMustBePropagatedForwardCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsPipeToErrorsMustBePropagatedForwardCode =
        "(function(pipeState) {\n  \"use strict\";\n  const action = () => {\n "
        "   pipeState.pendingReadPromiseCapability.@resolve.@call(@undefined, "
        "!1);\n    const error = @getByIdDirectPrivate(pipeState.source, "
        "\"storedError\");\n    if (!pipeState.preventAbort) {\n      "
        "@pipeToShutdownWithAction(pipeState, () => "
        "@writableStreamAbort(pipeState.destination, error), error);\n      "
        "return;\n    }\n    @pipeToShutdown(pipeState, error);\n  };\n  if "
        "(@getByIdDirectPrivate(pipeState.source, \"state\") === "
        "@streamErrored) {\n    action();\n    return;\n  }\n  "
        "@getByIdDirectPrivate(pipeState.reader, "
        "\"closedPromiseCapability\").@promise.@then(@undefined, action);\n})";

// pipeToErrorsMustBePropagatedBackward
const JSC::ConstructAbility
    s_readableStreamInternalsPipeToErrorsMustBePropagatedBackwardCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsPipeToErrorsMustBePropagatedBackwardCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsPipeToErrorsMustBePropagatedBackwardCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsPipeToErrorsMustBePropagatedBackwardCodeLength =
        552;
static const JSC::Intrinsic
    s_readableStreamInternalsPipeToErrorsMustBePropagatedBackwardCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsPipeToErrorsMustBePropagatedBackwardCode =
        "(function(pipeState) {\n  \"use strict\";\n  const action = () => {\n "
        "   const error = @getByIdDirectPrivate(pipeState.destination, "
        "\"storedError\");\n    if (!pipeState.preventCancel) {\n      "
        "@pipeToShutdownWithAction(pipeState, () => "
        "@readableStreamCancel(pipeState.source, error), error);\n      "
        "return;\n    }\n    @pipeToShutdown(pipeState, error);\n  };\n  if "
        "(@getByIdDirectPrivate(pipeState.destination, \"state\") === "
        "\"errored\") {\n    action();\n    return;\n  }\n  "
        "@getByIdDirectPrivate(pipeState.writer, "
        "\"closedPromise\").@promise.@then(@undefined, action);\n})";

// pipeToClosingMustBePropagatedForward
const JSC::ConstructAbility
    s_readableStreamInternalsPipeToClosingMustBePropagatedForwardCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsPipeToClosingMustBePropagatedForwardCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsPipeToClosingMustBePropagatedForwardCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsPipeToClosingMustBePropagatedForwardCodeLength =
        641;
static const JSC::Intrinsic
    s_readableStreamInternalsPipeToClosingMustBePropagatedForwardCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsPipeToClosingMustBePropagatedForwardCode =
        "(function(pipeState) {\n  \"use strict\";\n  const action = () => {\n "
        "   pipeState.pendingReadPromiseCapability.@resolve.@call(@undefined, "
        "!1);\n    const error = @getByIdDirectPrivate(pipeState.source, "
        "\"storedError\");\n    if (!pipeState.preventClose) {\n      "
        "@pipeToShutdownWithAction(pipeState, () => "
        "@writableStreamDefaultWriterCloseWithErrorPropagation(pipeState."
        "writer));\n      return;\n    }\n    @pipeToShutdown(pipeState);\n  "
        "};\n  if (@getByIdDirectPrivate(pipeState.source, \"state\") === "
        "@streamClosed) {\n    action();\n    return;\n  }\n  "
        "@getByIdDirectPrivate(pipeState.reader, "
        "\"closedPromiseCapability\").@promise.@then(action, @undefined);\n})";

// pipeToClosingMustBePropagatedBackward
const JSC::ConstructAbility
    s_readableStreamInternalsPipeToClosingMustBePropagatedBackwardCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsPipeToClosingMustBePropagatedBackwardCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsPipeToClosingMustBePropagatedBackwardCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsPipeToClosingMustBePropagatedBackwardCodeLength =
        445;
static const JSC::Intrinsic
    s_readableStreamInternalsPipeToClosingMustBePropagatedBackwardCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsPipeToClosingMustBePropagatedBackwardCode =
        "(function(pipeState) {\n  if (\"use strict\", "
        "!@writableStreamCloseQueuedOrInFlight(pipeState.destination) && "
        "@getByIdDirectPrivate(pipeState.destination, \"state\") !== "
        "\"closed\")\n    return;\n  const error = @makeTypeError(\"closing is "
        "propagated backward\");\n  if (!pipeState.preventCancel) {\n    "
        "@pipeToShutdownWithAction(pipeState, () => "
        "@readableStreamCancel(pipeState.source, error), error);\n    "
        "return;\n  }\n  @pipeToShutdown(pipeState, error);\n})";

// pipeToShutdownWithAction
const JSC::ConstructAbility
    s_readableStreamInternalsPipeToShutdownWithActionCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsPipeToShutdownWithActionCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsPipeToShutdownWithActionCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsPipeToShutdownWithActionCodeLength = 752;
static const JSC::Intrinsic
    s_readableStreamInternalsPipeToShutdownWithActionCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsPipeToShutdownWithActionCode =
    "(function(pipeState, action) {\n  if (\"use strict\", "
    "pipeState.shuttingDown)\n    return;\n  pipeState.shuttingDown = !0;\n  "
    "const hasError = arguments.length > 2, error = arguments[2], finalize = "
    "() => {\n    action().@then(() => {\n      if (hasError)\n        "
    "@pipeToFinalize(pipeState, error);\n      else\n        "
    "@pipeToFinalize(pipeState);\n    }, (e) => {\n      "
    "@pipeToFinalize(pipeState, e);\n    });\n  };\n  if "
    "(@getByIdDirectPrivate(pipeState.destination, \"state\") === \"writable\" "
    "&& !@writableStreamCloseQueuedOrInFlight(pipeState.destination)) {\n    "
    "pipeState.pendingReadPromiseCapability.@promise.@then(() => {\n      "
    "pipeState.pendingWritePromise.@then(finalize, finalize);\n    }, (e) => "
    "@pipeToFinalize(pipeState, e));\n    return;\n  }\n  finalize();\n})";

// pipeToShutdown
const JSC::ConstructAbility
    s_readableStreamInternalsPipeToShutdownCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsPipeToShutdownCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsPipeToShutdownCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsPipeToShutdownCodeLength = 648;
static const JSC::Intrinsic
    s_readableStreamInternalsPipeToShutdownCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamInternalsPipeToShutdownCode =
    "(function(pipeState) {\n  if (\"use strict\", pipeState.shuttingDown)\n   "
    " return;\n  pipeState.shuttingDown = !0;\n  const hasError = "
    "arguments.length > 1, error = arguments[1], finalize = () => {\n    if "
    "(hasError)\n      @pipeToFinalize(pipeState, error);\n    else\n      "
    "@pipeToFinalize(pipeState);\n  };\n  if "
    "(@getByIdDirectPrivate(pipeState.destination, \"state\") === \"writable\" "
    "&& !@writableStreamCloseQueuedOrInFlight(pipeState.destination)) {\n    "
    "pipeState.pendingReadPromiseCapability.@promise.@then(() => {\n      "
    "pipeState.pendingWritePromise.@then(finalize, finalize);\n    }, (e) => "
    "@pipeToFinalize(pipeState, e));\n    return;\n  }\n  finalize();\n})";

// pipeToFinalize
const JSC::ConstructAbility
    s_readableStreamInternalsPipeToFinalizeCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsPipeToFinalizeCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsPipeToFinalizeCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsPipeToFinalizeCodeLength = 333;
static const JSC::Intrinsic
    s_readableStreamInternalsPipeToFinalizeCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamInternalsPipeToFinalizeCode =
    "(function(pipeState) {\n  if (\"use strict\", "
    "@writableStreamDefaultWriterRelease(pipeState.writer), "
    "@readableStreamReaderGenericRelease(pipeState.reader), "
    "pipeState.finalized = !0, arguments.length > 1)\n    "
    "pipeState.promiseCapability.@reject.@call(@undefined, arguments[1]);\n  "
    "else\n    pipeState.promiseCapability.@resolve.@call();\n})";

// readableStreamTee
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamTeeCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamTeeCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamTeeCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamTeeCodeLength = 1627;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamTeeCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamInternalsReadableStreamTeeCode =
    "(function(stream, shouldClone) {\n  \"use strict\", "
    "@assert(@isReadableStream(stream)), @assert(typeof shouldClone === "
    "\"boolean\");\n  var start_ = @getByIdDirectPrivate(stream, \"start\");\n "
    " if (start_)\n    @putByIdDirectPrivate(stream, \"start\", @undefined), "
    "start_();\n  const reader = new @ReadableStreamDefaultReader(stream), "
    "teeState = {\n    closedOrErrored: !1,\n    canceled1: !1,\n    "
    "canceled2: !1,\n    reason1: @undefined,\n    reason2: @undefined\n  };\n "
    " teeState.cancelPromiseCapability = @newPromiseCapability(@Promise);\n  "
    "const pullFunction = @readableStreamTeePullFunction(teeState, reader, "
    "shouldClone), branch1Source = {};\n  @putByIdDirectPrivate(branch1Source, "
    "\"pull\", pullFunction), @putByIdDirectPrivate(branch1Source, \"cancel\", "
    "@readableStreamTeeBranch1CancelFunction(teeState, stream));\n  const "
    "branch2Source = {};\n  @putByIdDirectPrivate(branch2Source, \"pull\", "
    "pullFunction), @putByIdDirectPrivate(branch2Source, \"cancel\", "
    "@readableStreamTeeBranch2CancelFunction(teeState, stream));\n  const "
    "branch1 = new @ReadableStream(branch1Source), branch2 = new "
    "@ReadableStream(branch2Source);\n  return @getByIdDirectPrivate(reader, "
    "\"closedPromiseCapability\").@promise.@then(@undefined, function(e) {\n   "
    " if (teeState.closedOrErrored)\n      return;\n    if "
    "(@readableStreamDefaultControllerError(branch1.@readableStreamController, "
    "e), "
    "@readableStreamDefaultControllerError(branch2.@readableStreamController, "
    "e), teeState.closedOrErrored = !0, !teeState.canceled1 || "
    "!teeState.canceled2)\n      "
    "teeState.cancelPromiseCapability.@resolve.@call();\n  }), "
    "teeState.branch1 = branch1, teeState.branch2 = branch2, [branch1, "
    "branch2];\n})";

// readableStreamTeePullFunction
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamTeePullFunctionCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamTeePullFunctionCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamTeePullFunctionCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamTeePullFunctionCodeLength =
    1107;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamTeePullFunctionCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsReadableStreamTeePullFunctionCode =
    "(function(teeState, reader, shouldClone) {\n  return \"use strict\", "
    "function() {\n    "
    "@Promise.prototype.@then.@call(@readableStreamDefaultReaderRead(reader), "
    "function(result) {\n      if (@assert(@isObject(result)), @assert(typeof "
    "result.done === \"boolean\"), result.done && !teeState.closedOrErrored) "
    "{\n        if (!teeState.canceled1)\n          "
    "@readableStreamDefaultControllerClose(teeState.branch1.@"
    "readableStreamController);\n        if (!teeState.canceled2)\n          "
    "@readableStreamDefaultControllerClose(teeState.branch2.@"
    "readableStreamController);\n        if (teeState.closedOrErrored = !0, "
    "!teeState.canceled1 || !teeState.canceled2)\n          "
    "teeState.cancelPromiseCapability.@resolve.@call();\n      }\n      if "
    "(teeState.closedOrErrored)\n        return;\n      if "
    "(!teeState.canceled1)\n        "
    "@readableStreamDefaultControllerEnqueue(teeState.branch1.@"
    "readableStreamController, result.value);\n      if "
    "(!teeState.canceled2)\n        "
    "@readableStreamDefaultControllerEnqueue(teeState.branch2.@"
    "readableStreamController, shouldClone \? "
    "@structuredCloneForStream(result.value) : result.value);\n    });\n  "
    "};\n})";

// readableStreamTeeBranch1CancelFunction
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamTeeBranch1CancelFunctionCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamTeeBranch1CancelFunctionCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamTeeBranch1CancelFunctionCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsReadableStreamTeeBranch1CancelFunctionCodeLength =
        369;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamTeeBranch1CancelFunctionCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsReadableStreamTeeBranch1CancelFunctionCode =
        "(function(teeState, stream) {\n  return \"use strict\", function(r) "
        "{\n    if (teeState.canceled1 = !0, teeState.reason1 = r, "
        "teeState.canceled2)\n      @readableStreamCancel(stream, "
        "[teeState.reason1, "
        "teeState.reason2]).@then(teeState.cancelPromiseCapability.@resolve, "
        "teeState.cancelPromiseCapability.@reject);\n    return "
        "teeState.cancelPromiseCapability.@promise;\n  };\n})";

// readableStreamTeeBranch2CancelFunction
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamTeeBranch2CancelFunctionCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamTeeBranch2CancelFunctionCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamTeeBranch2CancelFunctionCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsReadableStreamTeeBranch2CancelFunctionCodeLength =
        369;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamTeeBranch2CancelFunctionCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsReadableStreamTeeBranch2CancelFunctionCode =
        "(function(teeState, stream) {\n  return \"use strict\", function(r) "
        "{\n    if (teeState.canceled2 = !0, teeState.reason2 = r, "
        "teeState.canceled1)\n      @readableStreamCancel(stream, "
        "[teeState.reason1, "
        "teeState.reason2]).@then(teeState.cancelPromiseCapability.@resolve, "
        "teeState.cancelPromiseCapability.@reject);\n    return "
        "teeState.cancelPromiseCapability.@promise;\n  };\n})";

// isReadableStream
const JSC::ConstructAbility
    s_readableStreamInternalsIsReadableStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsIsReadableStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsIsReadableStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsIsReadableStreamCodeLength = 140;
static const JSC::Intrinsic
    s_readableStreamInternalsIsReadableStreamCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamInternalsIsReadableStreamCode =
    "(function(stream) {\n  return \"use strict\", @isObject(stream) && "
    "@getByIdDirectPrivate(stream, \"readableStreamController\") !== "
    "@undefined;\n})";

// isReadableStreamDefaultReader
const JSC::ConstructAbility
    s_readableStreamInternalsIsReadableStreamDefaultReaderCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsIsReadableStreamDefaultReaderCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsIsReadableStreamDefaultReaderCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsIsReadableStreamDefaultReaderCodeLength =
    115;
static const JSC::Intrinsic
    s_readableStreamInternalsIsReadableStreamDefaultReaderCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsIsReadableStreamDefaultReaderCode =
    "(function(reader) {\n  return \"use strict\", @isObject(reader) && "
    "!!@getByIdDirectPrivate(reader, \"readRequests\");\n})";

// isReadableStreamDefaultController
const JSC::ConstructAbility
    s_readableStreamInternalsIsReadableStreamDefaultControllerCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsIsReadableStreamDefaultControllerCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsIsReadableStreamDefaultControllerCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsIsReadableStreamDefaultControllerCodeLength =
    131;
static const JSC::Intrinsic
    s_readableStreamInternalsIsReadableStreamDefaultControllerCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsIsReadableStreamDefaultControllerCode =
        "(function(controller) {\n  return \"use strict\", "
        "@isObject(controller) && !!@getByIdDirectPrivate(controller, "
        "\"underlyingSource\");\n})";

// readDirectStream
const JSC::ConstructAbility
    s_readableStreamInternalsReadDirectStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadDirectStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadDirectStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadDirectStreamCodeLength = 1520;
static const JSC::Intrinsic
    s_readableStreamInternalsReadDirectStreamCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamInternalsReadDirectStreamCode =
    "(function(stream, sink, underlyingSource) {\n  \"use strict\", "
    "@putByIdDirectPrivate(stream, \"underlyingSource\", @undefined), "
    "@putByIdDirectPrivate(stream, \"start\", @undefined);\n  function "
    "close(stream2, reason) {\n    if (reason && underlyingSource\?.cancel) "
    "{\n      try {\n        var prom = underlyingSource.cancel(reason);\n     "
    "   @markPromiseAsHandled(prom);\n      } catch (e) {\n      }\n      "
    "underlyingSource = @undefined;\n    }\n    if (stream2) {\n      if "
    "(@putByIdDirectPrivate(stream2, \"readableStreamController\", "
    "@undefined), @putByIdDirectPrivate(stream2, \"reader\", @undefined), "
    "reason)\n        @putByIdDirectPrivate(stream2, \"state\", "
    "@streamErrored), @putByIdDirectPrivate(stream2, \"storedError\", "
    "reason);\n      else\n        @putByIdDirectPrivate(stream2, \"state\", "
    "@streamClosed);\n      stream2 = @undefined;\n    }\n  }\n  if "
    "(!underlyingSource.pull) {\n    close();\n    return;\n  }\n  if "
    "(!@isCallable(underlyingSource.pull)) {\n    close(), "
    "@throwTypeError(\"pull is not a function\");\n    return;\n  }\n  "
    "@putByIdDirectPrivate(stream, \"readableStreamController\", sink);\n  "
    "const highWaterMark = @getByIdDirectPrivate(stream, \"highWaterMark\");\n "
    " sink.start({\n    highWaterMark: !highWaterMark || highWaterMark < 64 \? "
    "64 : highWaterMark\n  }), @startDirectStream.@call(sink, stream, "
    "underlyingSource.pull, close), @putByIdDirectPrivate(stream, \"reader\", "
    "{});\n  var maybePromise = underlyingSource.pull(sink);\n  if (sink = "
    "@undefined, maybePromise && @isPromise(maybePromise))\n    return "
    "maybePromise.@then(() => {\n    });\n})";

// assignToStream
const JSC::ConstructAbility
    s_readableStreamInternalsAssignToStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsAssignToStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsAssignToStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Private;
const int s_readableStreamInternalsAssignToStreamCodeLength = 398;
static const JSC::Intrinsic
    s_readableStreamInternalsAssignToStreamCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamInternalsAssignToStreamCode =
    "(function(stream, sink) {\n  \"use strict\";\n  var underlyingSource = "
    "@getByIdDirectPrivate(stream, \"underlyingSource\");\n  if "
    "(underlyingSource)\n    try {\n      return @readDirectStream(stream, "
    "sink, underlyingSource);\n    } catch (e) {\n      throw e;\n    } "
    "finally {\n      underlyingSource = @undefined, stream = @undefined, sink "
    "= @undefined;\n    }\n  return @readStreamIntoSink(stream, sink, !0);\n})";

// readStreamIntoSink
const JSC::ConstructAbility
    s_readableStreamInternalsReadStreamIntoSinkCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadStreamIntoSinkCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadStreamIntoSinkCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadStreamIntoSinkCodeLength = 2503;
static const JSC::Intrinsic
    s_readableStreamInternalsReadStreamIntoSinkCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamInternalsReadStreamIntoSinkCode =
    "(async function(stream, sink, isNative) {\n  \"use strict\";\n  var "
    "didClose = !1, didThrow = !1;\n  try {\n    var reader = "
    "stream.getReader(), many = reader.readMany();\n    if (many && "
    "@isPromise(many))\n      many = await many;\n    if (many.done)\n      "
    "return didClose = !0, sink.end();\n    var wroteCount = "
    "many.value.length;\n    const highWaterMark = "
    "@getByIdDirectPrivate(stream, \"highWaterMark\");\n    if (isNative)\n    "
    "  @startDirectStream.@call(sink, stream, @undefined, () => !didThrow && "
    "@markPromiseAsHandled(stream.cancel()));\n    sink.start({ highWaterMark: "
    "highWaterMark || 0 });\n    for (var i = 0, values = many.value, length = "
    "many.value.length;i < length; i++)\n      sink.write(values[i]);\n    var "
    "streamState = @getByIdDirectPrivate(stream, \"state\");\n    if "
    "(streamState === @streamClosed)\n      return didClose = !0, "
    "sink.end();\n    while (!0) {\n      var { value, done } = await "
    "reader.read();\n      if (done)\n        return didClose = !0, "
    "sink.end();\n      sink.write(value);\n    }\n  } catch (e) {\n    "
    "didThrow = !0;\n    try {\n      reader = @undefined;\n      const prom = "
    "stream.cancel(e);\n      @markPromiseAsHandled(prom);\n    } catch (j) "
    "{\n    }\n    if (sink && !didClose) {\n      didClose = !0;\n      try "
    "{\n        sink.close(e);\n      } catch (j) {\n        throw new "
    "globalThis.AggregateError([e, j]);\n      }\n    }\n    throw e;\n  } "
    "finally {\n    if (reader) {\n      try {\n        "
    "reader.releaseLock();\n      } catch (e) {\n      }\n      reader = "
    "@undefined;\n    }\n    sink = @undefined;\n    var streamState = "
    "@getByIdDirectPrivate(stream, \"state\");\n    if (stream) {\n      var "
    "readableStreamController = @getByIdDirectPrivate(stream, "
    "\"readableStreamController\");\n      if (readableStreamController) {\n   "
    "     if (@getByIdDirectPrivate(readableStreamController, "
    "\"underlyingSource\"))\n          "
    "@putByIdDirectPrivate(readableStreamController, \"underlyingSource\", "
    "@undefined);\n        if (@getByIdDirectPrivate(readableStreamController, "
    "\"controlledReadableStream\"))\n          "
    "@putByIdDirectPrivate(readableStreamController, "
    "\"controlledReadableStream\", @undefined);\n        if "
    "(@putByIdDirectPrivate(stream, \"readableStreamController\", null), "
    "@getByIdDirectPrivate(stream, \"underlyingSource\"))\n          "
    "@putByIdDirectPrivate(stream, \"underlyingSource\", @undefined);\n        "
    "readableStreamController = @undefined;\n      }\n      if (!didThrow && "
    "streamState !== @streamClosed && streamState !== @streamErrored)\n        "
    "@readableStreamClose(stream);\n      stream = @undefined;\n    }\n  }\n})";

// handleDirectStreamError
const JSC::ConstructAbility
    s_readableStreamInternalsHandleDirectStreamErrorCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsHandleDirectStreamErrorCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsHandleDirectStreamErrorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsHandleDirectStreamErrorCodeLength = 736;
static const JSC::Intrinsic
    s_readableStreamInternalsHandleDirectStreamErrorCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsHandleDirectStreamErrorCode =
    "(function(e) {\n  \"use strict\";\n  var controller = this, sink = "
    "controller.@sink;\n  if (sink) {\n    @putByIdDirectPrivate(controller, "
    "\"sink\", @undefined);\n    try {\n      sink.close(e);\n    } catch (f) "
    "{\n    }\n  }\n  if (this.error = this.flush = this.write = this.close = "
    "this.end = @onReadableStreamDirectControllerClosed, typeof "
    "this.@underlyingSource.close === \"function\")\n    try {\n      "
    "this.@underlyingSource.close.@call(this.@underlyingSource, e);\n    } "
    "catch (e2) {\n    }\n  try {\n    var pend = controller._pendingRead;\n   "
    " if (pend)\n      controller._pendingRead = @undefined, "
    "@rejectPromise(pend, e);\n  } catch (f) {\n  }\n  var stream = "
    "controller.@controlledReadableStream;\n  if (stream)\n    "
    "@readableStreamError(stream, e);\n})";

// handleDirectStreamErrorReject
const JSC::ConstructAbility
    s_readableStreamInternalsHandleDirectStreamErrorRejectCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsHandleDirectStreamErrorRejectCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsHandleDirectStreamErrorRejectCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsHandleDirectStreamErrorRejectCodeLength =
    102;
static const JSC::Intrinsic
    s_readableStreamInternalsHandleDirectStreamErrorRejectCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsHandleDirectStreamErrorRejectCode =
    "(function(e) {\n  return \"use strict\", "
    "@handleDirectStreamError.@call(this, e), @Promise.@reject(e);\n})";

// onPullDirectStream
const JSC::ConstructAbility
    s_readableStreamInternalsOnPullDirectStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsOnPullDirectStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsOnPullDirectStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsOnPullDirectStreamCodeLength = 1364;
static const JSC::Intrinsic
    s_readableStreamInternalsOnPullDirectStreamCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamInternalsOnPullDirectStreamCode =
    "(function(controller) {\n  \"use strict\";\n  var stream = "
    "controller.@controlledReadableStream;\n  if (!stream || "
    "@getByIdDirectPrivate(stream, \"state\") !== @streamReadable)\n    "
    "return;\n  if (controller._deferClose === -1)\n    return;\n  "
    "controller._deferClose = -1, controller._deferFlush = -1;\n  var "
    "deferClose, deferFlush;\n  try {\n    var result = "
    "controller.@underlyingSource.pull(controller);\n    if (result && "
    "@isPromise(result)) {\n      if (controller._handleError === "
    "@undefined)\n        controller._handleError = "
    "@handleDirectStreamErrorReject.bind(controller);\n      "
    "@Promise.prototype.catch.@call(result, controller._handleError);\n    }\n "
    " } catch (e) {\n    return "
    "@handleDirectStreamErrorReject.@call(controller, e);\n  } finally {\n    "
    "deferClose = controller._deferClose, deferFlush = controller._deferFlush, "
    "controller._deferFlush = controller._deferClose = 0;\n  }\n  var "
    "promiseToReturn;\n  if (controller._pendingRead === @undefined)\n    "
    "controller._pendingRead = promiseToReturn = @newPromise();\n  else\n    "
    "promiseToReturn = @readableStreamAddReadRequest(stream);\n  if "
    "(deferClose === 1) {\n    var reason = controller._deferCloseReason;\n    "
    "return controller._deferCloseReason = @undefined, "
    "@onCloseDirectStream.@call(controller, reason), promiseToReturn;\n  }\n  "
    "if (deferFlush === 1)\n    @onFlushDirectStream.@call(controller);\n  "
    "return promiseToReturn;\n})";

// noopDoneFunction
const JSC::ConstructAbility
    s_readableStreamInternalsNoopDoneFunctionCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsNoopDoneFunctionCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsNoopDoneFunctionCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsNoopDoneFunctionCodeLength = 91;
static const JSC::Intrinsic
    s_readableStreamInternalsNoopDoneFunctionCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamInternalsNoopDoneFunctionCode =
    "(function() {\n  return \"use strict\", @Promise.@resolve({ value: "
    "@undefined, done: !0 });\n})";

// onReadableStreamDirectControllerClosed
const JSC::ConstructAbility
    s_readableStreamInternalsOnReadableStreamDirectControllerClosedCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsOnReadableStreamDirectControllerClosedCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsOnReadableStreamDirectControllerClosedCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsOnReadableStreamDirectControllerClosedCodeLength =
        103;
static const JSC::Intrinsic
    s_readableStreamInternalsOnReadableStreamDirectControllerClosedCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsOnReadableStreamDirectControllerClosedCode =
        "(function(reason) {\n  \"use strict\", "
        "@throwTypeError(\"ReadableStreamDirectController is now "
        "closed\");\n})";

// onCloseDirectStream
const JSC::ConstructAbility
    s_readableStreamInternalsOnCloseDirectStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsOnCloseDirectStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsOnCloseDirectStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsOnCloseDirectStreamCodeLength = 2080;
static const JSC::Intrinsic
    s_readableStreamInternalsOnCloseDirectStreamCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsOnCloseDirectStreamCode =
    "(function(reason) {\n  \"use strict\";\n  var stream = "
    "this.@controlledReadableStream;\n  if (!stream || "
    "@getByIdDirectPrivate(stream, \"state\") !== @streamReadable)\n    "
    "return;\n  if (this._deferClose !== 0) {\n    this._deferClose = 1, "
    "this._deferCloseReason = reason;\n    return;\n  }\n  if "
    "(@putByIdDirectPrivate(stream, \"state\", @streamClosing), typeof "
    "this.@underlyingSource.close === \"function\")\n    try {\n      "
    "this.@underlyingSource.close.@call(this.@underlyingSource, reason);\n    "
    "} catch (e) {\n    }\n  var flushed;\n  try {\n    flushed = "
    "this.@sink.end(), @putByIdDirectPrivate(this, \"sink\", @undefined);\n  } "
    "catch (e) {\n    if (this._pendingRead) {\n      var read = "
    "this._pendingRead;\n      this._pendingRead = @undefined, "
    "@rejectPromise(read, e);\n    }\n    @readableStreamError(stream, e);\n   "
    " return;\n  }\n  this.error = this.flush = this.write = this.close = "
    "this.end = @onReadableStreamDirectControllerClosed;\n  var reader = "
    "@getByIdDirectPrivate(stream, \"reader\");\n  if (reader && "
    "@isReadableStreamDefaultReader(reader)) {\n    var _pendingRead = "
    "this._pendingRead;\n    if (_pendingRead && @isPromise(_pendingRead) && "
    "flushed\?.byteLength) {\n      this._pendingRead = @undefined, "
    "@fulfillPromise(_pendingRead, { value: flushed, done: !1 }), "
    "@readableStreamClose(stream);\n      return;\n    }\n  }\n  if "
    "(flushed\?.byteLength) {\n    var requests = "
    "@getByIdDirectPrivate(reader, \"readRequests\");\n    if "
    "(requests\?.isNotEmpty()) {\n      "
    "@readableStreamFulfillReadRequest(stream, flushed, !1), "
    "@readableStreamClose(stream);\n      return;\n    }\n    "
    "@putByIdDirectPrivate(stream, \"state\", @streamReadable), this.@pull = "
    "() => {\n      var thisResult = @createFulfilledPromise({\n        value: "
    "flushed,\n        done: !1\n      });\n      return flushed = @undefined, "
    "@readableStreamClose(stream), stream = @undefined, thisResult;\n    };\n  "
    "} else if (this._pendingRead) {\n    var read = this._pendingRead;\n    "
    "this._pendingRead = @undefined, @putByIdDirectPrivate(this, \"pull\", "
    "@noopDoneFunction), @fulfillPromise(read, { value: @undefined, done: !0 "
    "});\n  }\n  @readableStreamClose(stream);\n})";

// onFlushDirectStream
const JSC::ConstructAbility
    s_readableStreamInternalsOnFlushDirectStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsOnFlushDirectStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsOnFlushDirectStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsOnFlushDirectStreamCodeLength = 849;
static const JSC::Intrinsic
    s_readableStreamInternalsOnFlushDirectStreamCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsOnFlushDirectStreamCode =
    "(function() {\n  \"use strict\";\n  var stream = "
    "this.@controlledReadableStream, reader = @getByIdDirectPrivate(stream, "
    "\"reader\");\n  if (!reader || !@isReadableStreamDefaultReader(reader))\n "
    "   return;\n  var _pendingRead = this._pendingRead;\n  if "
    "(this._pendingRead = @undefined, _pendingRead && "
    "@isPromise(_pendingRead)) {\n    var flushed = this.@sink.flush();\n    "
    "if (flushed\?.byteLength)\n      this._pendingRead = "
    "@getByIdDirectPrivate(stream, \"readRequests\")\?.shift(), "
    "@fulfillPromise(_pendingRead, { value: flushed, done: !1 });\n    else\n  "
    "    this._pendingRead = _pendingRead;\n  } else if "
    "(@getByIdDirectPrivate(stream, \"readRequests\")\?.isNotEmpty()) {\n    "
    "var flushed = this.@sink.flush();\n    if (flushed\?.byteLength)\n      "
    "@readableStreamFulfillReadRequest(stream, flushed, !1);\n  } else if "
    "(this._deferFlush === -1)\n    this._deferFlush = 1;\n})";

// createTextStream
const JSC::ConstructAbility
    s_readableStreamInternalsCreateTextStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsCreateTextStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsCreateTextStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsCreateTextStreamCodeLength = 2030;
static const JSC::Intrinsic
    s_readableStreamInternalsCreateTextStreamCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamInternalsCreateTextStreamCode =
    "(function(highWaterMark) {\n  \"use strict\";\n  var sink, array = [], "
    "hasString = !1, hasBuffer = !1, rope = \"\", estimatedLength = "
    "@toLength(0), capability = @newPromiseCapability(@Promise), calledDone = "
    "!1;\n  return sink = {\n    start() {\n    },\n    write(chunk) {\n      "
    "if (typeof chunk === \"string\") {\n        var chunkLength = "
    "@toLength(chunk.length);\n        if (chunkLength > 0)\n          rope += "
    "chunk, hasString = !0, estimatedLength += chunkLength;\n        return "
    "chunkLength;\n      }\n      if (!chunk || !(@ArrayBuffer.@isView(chunk) "
    "|| chunk instanceof @ArrayBuffer))\n        @throwTypeError(\"Expected "
    "text, ArrayBuffer or ArrayBufferView\");\n      const byteLength = "
    "@toLength(chunk.byteLength);\n      if (byteLength > 0)\n        if "
    "(hasBuffer = !0, rope.length > 0)\n          @arrayPush(array, rope, "
    "chunk), rope = \"\";\n        else\n          @arrayPush(array, chunk);\n "
    "     return estimatedLength += byteLength, byteLength;\n    },\n    "
    "flush() {\n      return 0;\n    },\n    end() {\n      if (calledDone)\n  "
    "      return \"\";\n      return sink.fulfill();\n    },\n    fulfill() "
    "{\n      calledDone = !0;\n      const result = sink.finishInternal();\n  "
    "    return @fulfillPromise(capability.@promise, result), result;\n    "
    "},\n    finishInternal() {\n      if (!hasString && !hasBuffer)\n        "
    "return \"\";\n      if (hasString && !hasBuffer)\n        return rope;\n  "
    "    if (hasBuffer && !hasString)\n        return new "
    "globalThis.TextDecoder().decode(@Bun.concatArrayBuffers(array));\n      "
    "var arrayBufferSink = new @Bun.ArrayBufferSink;\n      "
    "arrayBufferSink.start({\n        highWaterMark: estimatedLength,\n        "
    "asUint8Array: !0\n      });\n      for (let item of array)\n        "
    "arrayBufferSink.write(item);\n      if (array.length = 0, rope.length > "
    "0)\n        arrayBufferSink.write(rope), rope = \"\";\n      return new "
    "globalThis.TextDecoder().decode(arrayBufferSink.end());\n    },\n    "
    "close() {\n      try {\n        if (!calledDone)\n          calledDone = "
    "!0, sink.fulfill();\n      } catch (e) {\n      }\n    }\n  }, [sink, "
    "capability];\n})";

// initializeTextStream
const JSC::ConstructAbility
    s_readableStreamInternalsInitializeTextStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsInitializeTextStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsInitializeTextStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsInitializeTextStreamCodeLength = 805;
static const JSC::Intrinsic
    s_readableStreamInternalsInitializeTextStreamCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsInitializeTextStreamCode =
    "(function(underlyingSource, highWaterMark) {\n  \"use strict\";\n  var "
    "[sink, closingPromise] = @createTextStream(highWaterMark), controller = "
    "{\n    @underlyingSource: underlyingSource,\n    @pull: "
    "@onPullDirectStream,\n    @controlledReadableStream: this,\n    @sink: "
    "sink,\n    close: @onCloseDirectStream,\n    write: sink.write,\n    "
    "error: @handleDirectStreamError,\n    end: @onCloseDirectStream,\n    "
    "@close: @onCloseDirectStream,\n    flush: @onFlushDirectStream,\n    "
    "_pendingRead: @undefined,\n    _deferClose: 0,\n    _deferFlush: 0,\n    "
    "_deferCloseReason: @undefined,\n    _handleError: @undefined\n  };\n  "
    "return @putByIdDirectPrivate(this, \"readableStreamController\", "
    "controller), @putByIdDirectPrivate(this, \"underlyingSource\", "
    "@undefined), @putByIdDirectPrivate(this, \"start\", @undefined), "
    "closingPromise;\n})";

// initializeArrayStream
const JSC::ConstructAbility
    s_readableStreamInternalsInitializeArrayStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsInitializeArrayStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsInitializeArrayStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsInitializeArrayStreamCodeLength = 1260;
static const JSC::Intrinsic
    s_readableStreamInternalsInitializeArrayStreamCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsInitializeArrayStreamCode =
    "(function(underlyingSource, highWaterMark) {\n  \"use strict\";\n  var "
    "array = [], closingPromise = @newPromiseCapability(@Promise), calledDone "
    "= !1;\n  function fulfill() {\n    return calledDone = !0, "
    "closingPromise.@resolve.@call(@undefined, array), array;\n  }\n  var sink "
    "= {\n    start() {\n    },\n    write(chunk) {\n      return "
    "@arrayPush(array, chunk), chunk.byteLength || chunk.length;\n    },\n    "
    "flush() {\n      return 0;\n    },\n    end() {\n      if (calledDone)\n  "
    "      return [];\n      return fulfill();\n    },\n    close() {\n      "
    "if (!calledDone)\n        fulfill();\n    }\n  }, controller = {\n    "
    "@underlyingSource: underlyingSource,\n    @pull: @onPullDirectStream,\n   "
    " @controlledReadableStream: this,\n    @sink: sink,\n    close: "
    "@onCloseDirectStream,\n    write: sink.write,\n    error: "
    "@handleDirectStreamError,\n    end: @onCloseDirectStream,\n    @close: "
    "@onCloseDirectStream,\n    flush: @onFlushDirectStream,\n    "
    "_pendingRead: @undefined,\n    _deferClose: 0,\n    _deferFlush: 0,\n    "
    "_deferCloseReason: @undefined,\n    _handleError: @undefined\n  };\n  "
    "return @putByIdDirectPrivate(this, \"readableStreamController\", "
    "controller), @putByIdDirectPrivate(this, \"underlyingSource\", "
    "@undefined), @putByIdDirectPrivate(this, \"start\", @undefined), "
    "closingPromise;\n})";

// initializeArrayBufferStream
const JSC::ConstructAbility
    s_readableStreamInternalsInitializeArrayBufferStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsInitializeArrayBufferStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsInitializeArrayBufferStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsInitializeArrayBufferStreamCodeLength = 937;
static const JSC::Intrinsic
    s_readableStreamInternalsInitializeArrayBufferStreamCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsInitializeArrayBufferStreamCode =
    "(function(underlyingSource, highWaterMark) {\n  \"use strict\";\n  var "
    "opts = highWaterMark && typeof highWaterMark === \"number\" \? { "
    "highWaterMark, stream: !0, asUint8Array: !0 } : { stream: !0, "
    "asUint8Array: !0 }, sink = new @Bun.ArrayBufferSink;\n  "
    "sink.start(opts);\n  var controller = {\n    @underlyingSource: "
    "underlyingSource,\n    @pull: @onPullDirectStream,\n    "
    "@controlledReadableStream: this,\n    @sink: sink,\n    close: "
    "@onCloseDirectStream,\n    write: sink.write.bind(sink),\n    error: "
    "@handleDirectStreamError,\n    end: @onCloseDirectStream,\n    @close: "
    "@onCloseDirectStream,\n    flush: @onFlushDirectStream,\n    "
    "_pendingRead: @undefined,\n    _deferClose: 0,\n    _deferFlush: 0,\n    "
    "_deferCloseReason: @undefined,\n    _handleError: @undefined\n  };\n  "
    "@putByIdDirectPrivate(this, \"readableStreamController\", controller), "
    "@putByIdDirectPrivate(this, \"underlyingSource\", @undefined), "
    "@putByIdDirectPrivate(this, \"start\", @undefined);\n})";

// readableStreamError
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamErrorCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamErrorCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamErrorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamErrorCodeLength = 1175;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamErrorCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsReadableStreamErrorCode =
    "(function(stream, error) {\n  \"use strict\", "
    "@assert(@isReadableStream(stream)), @assert(@getByIdDirectPrivate(stream, "
    "\"state\") === @streamReadable), @putByIdDirectPrivate(stream, \"state\", "
    "@streamErrored), @putByIdDirectPrivate(stream, \"storedError\", error);\n "
    " const reader = @getByIdDirectPrivate(stream, \"reader\");\n  if "
    "(!reader)\n    return;\n  if (@isReadableStreamDefaultReader(reader)) {\n "
    "   const requests = @getByIdDirectPrivate(reader, \"readRequests\");\n    "
    "@putByIdDirectPrivate(reader, \"readRequests\", @createFIFO());\n    for "
    "(var request = requests.shift();request; request = requests.shift())\n    "
    "  @rejectPromise(request, error);\n  } else {\n    "
    "@assert(@isReadableStreamBYOBReader(reader));\n    const requests = "
    "@getByIdDirectPrivate(reader, \"readIntoRequests\");\n    "
    "@putByIdDirectPrivate(reader, \"readIntoRequests\", @createFIFO());\n    "
    "for (var request = requests.shift();request; request = "
    "requests.shift())\n      @rejectPromise(request, error);\n  }\n  "
    "@getByIdDirectPrivate(reader, "
    "\"closedPromiseCapability\").@reject.@call(@undefined, error);\n  const "
    "promise = @getByIdDirectPrivate(reader, "
    "\"closedPromiseCapability\").@promise;\n  "
    "@markPromiseAsHandled(promise);\n})";

// readableStreamDefaultControllerShouldCallPull
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamDefaultControllerShouldCallPullCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamDefaultControllerShouldCallPullCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamDefaultControllerShouldCallPullCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsReadableStreamDefaultControllerShouldCallPullCodeLength =
        640;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamDefaultControllerShouldCallPullCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableStreamInternalsReadableStreamDefaultControllerShouldCallPullCode =
        "(function(controller) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(controller, \"controlledReadableStream\");\n  "
        "if (!@readableStreamDefaultControllerCanCloseOrEnqueue(controller))\n "
        "   return !1;\n  if (@getByIdDirectPrivate(controller, \"started\") "
        "!== 1)\n    return !1;\n  if ((!@isReadableStreamLocked(stream) || "
        "!@getByIdDirectPrivate(@getByIdDirectPrivate(stream, \"reader\"), "
        "\"readRequests\")\?.isNotEmpty()) && "
        "@readableStreamDefaultControllerGetDesiredSize(controller) <= 0)\n    "
        "return !1;\n  const desiredSize = "
        "@readableStreamDefaultControllerGetDesiredSize(controller);\n  return "
        "@assert(desiredSize !== null), desiredSize > 0;\n})";

// readableStreamDefaultControllerCallPullIfNeeded
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamDefaultControllerCallPullIfNeededCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamDefaultControllerCallPullIfNeededCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamDefaultControllerCallPullIfNeededCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsReadableStreamDefaultControllerCallPullIfNeededCodeLength =
        1133;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamDefaultControllerCallPullIfNeededCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableStreamInternalsReadableStreamDefaultControllerCallPullIfNeededCode =
        "(function(controller) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(controller, \"controlledReadableStream\");\n  "
        "if (!@readableStreamDefaultControllerCanCloseOrEnqueue(controller))\n "
        "   return;\n  if (@getByIdDirectPrivate(controller, \"started\") !== "
        "1)\n    return;\n  if ((!@isReadableStreamLocked(stream) || "
        "!@getByIdDirectPrivate(@getByIdDirectPrivate(stream, \"reader\"), "
        "\"readRequests\")\?.isNotEmpty()) && "
        "@readableStreamDefaultControllerGetDesiredSize(controller) <= 0)\n    "
        "return;\n  if (@getByIdDirectPrivate(controller, \"pulling\")) {\n    "
        "@putByIdDirectPrivate(controller, \"pullAgain\", !0);\n    return;\n  "
        "}\n  @assert(!@getByIdDirectPrivate(controller, \"pullAgain\")), "
        "@putByIdDirectPrivate(controller, \"pulling\", !0), "
        "@getByIdDirectPrivate(controller, "
        "\"pullAlgorithm\").@call(@undefined).@then(function() {\n    if "
        "(@putByIdDirectPrivate(controller, \"pulling\", !1), "
        "@getByIdDirectPrivate(controller, \"pullAgain\"))\n      "
        "@putByIdDirectPrivate(controller, \"pullAgain\", !1), "
        "@readableStreamDefaultControllerCallPullIfNeeded(controller);\n  }, "
        "function(error) {\n    "
        "@readableStreamDefaultControllerError(controller, error);\n  });\n})";

// isReadableStreamLocked
const JSC::ConstructAbility
    s_readableStreamInternalsIsReadableStreamLockedCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsIsReadableStreamLockedCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsIsReadableStreamLockedCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsIsReadableStreamLockedCodeLength = 124;
static const JSC::Intrinsic
    s_readableStreamInternalsIsReadableStreamLockedCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsIsReadableStreamLockedCode =
    "(function(stream) {\n  return \"use strict\", "
    "@assert(@isReadableStream(stream)), !!@getByIdDirectPrivate(stream, "
    "\"reader\");\n})";

// readableStreamDefaultControllerGetDesiredSize
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamDefaultControllerGetDesiredSizeCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamDefaultControllerGetDesiredSizeCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamDefaultControllerGetDesiredSizeCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsReadableStreamDefaultControllerGetDesiredSizeCodeLength =
        384;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamDefaultControllerGetDesiredSizeCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableStreamInternalsReadableStreamDefaultControllerGetDesiredSizeCode =
        "(function(controller) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(controller, \"controlledReadableStream\"), "
        "state = @getByIdDirectPrivate(stream, \"state\");\n  if (state === "
        "@streamErrored)\n    return null;\n  if (state === @streamClosed)\n   "
        " return 0;\n  return @getByIdDirectPrivate(controller, "
        "\"strategy\").highWaterMark - @getByIdDirectPrivate(controller, "
        "\"queue\").size;\n})";

// readableStreamReaderGenericCancel
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamReaderGenericCancelCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamReaderGenericCancelCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamReaderGenericCancelCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamReaderGenericCancelCodeLength =
    184;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamReaderGenericCancelCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsReadableStreamReaderGenericCancelCode =
        "(function(reader, reason) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(reader, \"ownerReadableStream\");\n  return "
        "@assert(!!stream), @readableStreamCancel(stream, reason);\n})";

// readableStreamCancel
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamCancelCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamCancelCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamCancelCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamCancelCodeLength = 716;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamCancelCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsReadableStreamCancelCode =
    "(function(stream, reason) {\n  \"use strict\", "
    "@putByIdDirectPrivate(stream, \"disturbed\", !0);\n  const state = "
    "@getByIdDirectPrivate(stream, \"state\");\n  if (state === "
    "@streamClosed)\n    return @Promise.@resolve();\n  if (state === "
    "@streamErrored)\n    return "
    "@Promise.@reject(@getByIdDirectPrivate(stream, \"storedError\"));\n  "
    "@readableStreamClose(stream);\n  var controller = "
    "@getByIdDirectPrivate(stream, \"readableStreamController\"), cancel = "
    "controller.@cancel;\n  if (cancel)\n    return cancel(controller, "
    "reason).@then(function() {\n    });\n  var close = controller.close;\n  "
    "if (close)\n    return @Promise.@resolve(controller.close(reason));\n  "
    "@throwTypeError(\"ReadableStreamController has no cancel or close "
    "method\");\n})";

// readableStreamDefaultControllerCancel
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamDefaultControllerCancelCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamDefaultControllerCancelCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamDefaultControllerCancelCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsReadableStreamDefaultControllerCancelCodeLength =
        194;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamDefaultControllerCancelCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsReadableStreamDefaultControllerCancelCode =
        "(function(controller, reason) {\n  return \"use strict\", "
        "@putByIdDirectPrivate(controller, \"queue\", @newQueue()), "
        "@getByIdDirectPrivate(controller, "
        "\"cancelAlgorithm\").@call(@undefined, reason);\n})";

// readableStreamDefaultControllerPull
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamDefaultControllerPullCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamDefaultControllerPullCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamDefaultControllerPullCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsReadableStreamDefaultControllerPullCodeLength =
        706;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamDefaultControllerPullCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsReadableStreamDefaultControllerPullCode =
        "(function(controller) {\n  \"use strict\";\n  var queue = "
        "@getByIdDirectPrivate(controller, \"queue\");\n  if "
        "(queue.content.isNotEmpty()) {\n    const chunk = "
        "@dequeueValue(queue);\n    if (@getByIdDirectPrivate(controller, "
        "\"closeRequested\") && queue.content.isEmpty())\n      "
        "@readableStreamClose(@getByIdDirectPrivate(controller, "
        "\"controlledReadableStream\"));\n    else\n      "
        "@readableStreamDefaultControllerCallPullIfNeeded(controller);\n    "
        "return @createFulfilledPromise({ value: chunk, done: !1 });\n  }\n  "
        "const pendingPromise = "
        "@readableStreamAddReadRequest(@getByIdDirectPrivate(controller, "
        "\"controlledReadableStream\"));\n  return "
        "@readableStreamDefaultControllerCallPullIfNeeded(controller), "
        "pendingPromise;\n})";

// readableStreamDefaultControllerClose
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamDefaultControllerCloseCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamDefaultControllerCloseCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamDefaultControllerCloseCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsReadableStreamDefaultControllerCloseCodeLength =
        328;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamDefaultControllerCloseCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsReadableStreamDefaultControllerCloseCode =
        "(function(controller) {\n  if (\"use strict\", "
        "@assert(@readableStreamDefaultControllerCanCloseOrEnqueue(controller))"
        ", @putByIdDirectPrivate(controller, \"closeRequested\", !0), "
        "@getByIdDirectPrivate(controller, \"queue\")\?.content\?.isEmpty())\n "
        "   @readableStreamClose(@getByIdDirectPrivate(controller, "
        "\"controlledReadableStream\"));\n})";

// readableStreamClose
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamCloseCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamCloseCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamCloseCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamCloseCodeLength = 802;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamCloseCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsReadableStreamCloseCode =
    "(function(stream) {\n  if (\"use strict\", "
    "@assert(@getByIdDirectPrivate(stream, \"state\") === @streamReadable), "
    "@putByIdDirectPrivate(stream, \"state\", @streamClosed), "
    "!@getByIdDirectPrivate(stream, \"reader\"))\n    return;\n  if "
    "(@isReadableStreamDefaultReader(@getByIdDirectPrivate(stream, "
    "\"reader\"))) {\n    const requests = "
    "@getByIdDirectPrivate(@getByIdDirectPrivate(stream, \"reader\"), "
    "\"readRequests\");\n    if (requests.isNotEmpty()) {\n      "
    "@putByIdDirectPrivate(@getByIdDirectPrivate(stream, \"reader\"), "
    "\"readRequests\", @createFIFO());\n      for (var request = "
    "requests.shift();request; request = requests.shift())\n        "
    "@fulfillPromise(request, { value: @undefined, done: !0 });\n    }\n  }\n  "
    "@getByIdDirectPrivate(@getByIdDirectPrivate(stream, \"reader\"), "
    "\"closedPromiseCapability\").@resolve.@call();\n})";

// readableStreamFulfillReadRequest
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamFulfillReadRequestCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamFulfillReadRequestCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamFulfillReadRequestCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamFulfillReadRequestCodeLength =
    217;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamFulfillReadRequestCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsReadableStreamFulfillReadRequestCode =
        "(function(stream, chunk, done) {\n  \"use strict\";\n  const "
        "readRequest = @getByIdDirectPrivate(@getByIdDirectPrivate(stream, "
        "\"reader\"), \"readRequests\").shift();\n  "
        "@fulfillPromise(readRequest, { value: chunk, done });\n})";

// readableStreamDefaultControllerEnqueue
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamDefaultControllerEnqueueCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamDefaultControllerEnqueueCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamDefaultControllerEnqueueCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsReadableStreamDefaultControllerEnqueueCodeLength =
        909;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamDefaultControllerEnqueueCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsReadableStreamDefaultControllerEnqueueCode =
        "(function(controller, chunk) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(controller, \"controlledReadableStream\");\n  "
        "if "
        "(@assert(@readableStreamDefaultControllerCanCloseOrEnqueue(controller)"
        "), @isReadableStreamLocked(stream) && "
        "@getByIdDirectPrivate(@getByIdDirectPrivate(stream, \"reader\"), "
        "\"readRequests\")\?.isNotEmpty()) {\n    "
        "@readableStreamFulfillReadRequest(stream, chunk, !1), "
        "@readableStreamDefaultControllerCallPullIfNeeded(controller);\n    "
        "return;\n  }\n  try {\n    let chunkSize = 1;\n    if "
        "(@getByIdDirectPrivate(controller, \"strategy\").size !== "
        "@undefined)\n      chunkSize = @getByIdDirectPrivate(controller, "
        "\"strategy\").size(chunk);\n    "
        "@enqueueValueWithSize(@getByIdDirectPrivate(controller, \"queue\"), "
        "chunk, chunkSize);\n  } catch (error) {\n    throw "
        "@readableStreamDefaultControllerError(controller, error), error;\n  "
        "}\n  "
        "@readableStreamDefaultControllerCallPullIfNeeded(controller);\n})";

// readableStreamDefaultReaderRead
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamDefaultReaderReadCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamDefaultReaderReadCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamDefaultReaderReadCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamDefaultReaderReadCodeLength =
    610;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamDefaultReaderReadCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsReadableStreamDefaultReaderReadCode =
    "(function(reader) {\n  \"use strict\";\n  const stream = "
    "@getByIdDirectPrivate(reader, \"ownerReadableStream\");\n  "
    "@assert(!!stream);\n  const state = @getByIdDirectPrivate(stream, "
    "\"state\");\n  if (@putByIdDirectPrivate(stream, \"disturbed\", !0), "
    "state === @streamClosed)\n    return @createFulfilledPromise({ value: "
    "@undefined, done: !0 });\n  if (state === @streamErrored)\n    return "
    "@Promise.@reject(@getByIdDirectPrivate(stream, \"storedError\"));\n  "
    "return @assert(state === @streamReadable), @getByIdDirectPrivate(stream, "
    "\"readableStreamController\").@pull(@getByIdDirectPrivate(stream, "
    "\"readableStreamController\"));\n})";

// readableStreamAddReadRequest
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamAddReadRequestCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamAddReadRequestCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamAddReadRequestCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamAddReadRequestCodeLength = 345;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamAddReadRequestCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsReadableStreamAddReadRequestCode =
    "(function(stream) {\n  \"use strict\", "
    "@assert(@isReadableStreamDefaultReader(@getByIdDirectPrivate(stream, "
    "\"reader\"))), @assert(@getByIdDirectPrivate(stream, \"state\") == "
    "@streamReadable);\n  const readRequest = @newPromise();\n  return "
    "@getByIdDirectPrivate(@getByIdDirectPrivate(stream, \"reader\"), "
    "\"readRequests\").push(readRequest), readRequest;\n})";

// isReadableStreamDisturbed
const JSC::ConstructAbility
    s_readableStreamInternalsIsReadableStreamDisturbedCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsIsReadableStreamDisturbedCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsIsReadableStreamDisturbedCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsIsReadableStreamDisturbedCodeLength = 125;
static const JSC::Intrinsic
    s_readableStreamInternalsIsReadableStreamDisturbedCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsIsReadableStreamDisturbedCode =
    "(function(stream) {\n  return \"use strict\", "
    "@assert(@isReadableStream(stream)), @getByIdDirectPrivate(stream, "
    "\"disturbed\");\n})";

// readableStreamReaderGenericRelease
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamReaderGenericReleaseCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamReaderGenericReleaseCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamReaderGenericReleaseCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsReadableStreamReaderGenericReleaseCodeLength = 937;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamReaderGenericReleaseCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsReadableStreamReaderGenericReleaseCode =
        "(function(reader) {\n  if (\"use strict\", "
        "@assert(!!@getByIdDirectPrivate(reader, \"ownerReadableStream\")), "
        "@assert(@getByIdDirectPrivate(@getByIdDirectPrivate(reader, "
        "\"ownerReadableStream\"), \"reader\") === reader), "
        "@getByIdDirectPrivate(@getByIdDirectPrivate(reader, "
        "\"ownerReadableStream\"), \"state\") === @streamReadable)\n    "
        "@getByIdDirectPrivate(reader, "
        "\"closedPromiseCapability\").@reject.@call(@undefined, "
        "@makeTypeError(\"releasing lock of reader whose stream is still in "
        "readable state\"));\n  else\n    @putByIdDirectPrivate(reader, "
        "\"closedPromiseCapability\", {\n      @promise: "
        "@newHandledRejectedPromise(@makeTypeError(\"reader released "
        "lock\"))\n    });\n  const promise = @getByIdDirectPrivate(reader, "
        "\"closedPromiseCapability\").@promise;\n  "
        "@markPromiseAsHandled(promise), "
        "@putByIdDirectPrivate(@getByIdDirectPrivate(reader, "
        "\"ownerReadableStream\"), \"reader\", @undefined), "
        "@putByIdDirectPrivate(reader, \"ownerReadableStream\", "
        "@undefined);\n})";

// readableStreamDefaultControllerCanCloseOrEnqueue
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamDefaultControllerCanCloseOrEnqueueCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamDefaultControllerCanCloseOrEnqueueCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamDefaultControllerCanCloseOrEnqueueCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_readableStreamInternalsReadableStreamDefaultControllerCanCloseOrEnqueueCodeLength =
        220;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamDefaultControllerCanCloseOrEnqueueCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_readableStreamInternalsReadableStreamDefaultControllerCanCloseOrEnqueueCode =
        "(function(controller) {\n  return \"use strict\", "
        "!@getByIdDirectPrivate(controller, \"closeRequested\") && "
        "@getByIdDirectPrivate(@getByIdDirectPrivate(controller, "
        "\"controlledReadableStream\"), \"state\") === @streamReadable;\n})";

// lazyLoadStream
const JSC::ConstructAbility
    s_readableStreamInternalsLazyLoadStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsLazyLoadStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsLazyLoadStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsLazyLoadStreamCodeLength = 3797;
static const JSC::Intrinsic
    s_readableStreamInternalsLazyLoadStreamCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_readableStreamInternalsLazyLoadStreamCode =
    "(function(stream, autoAllocateChunkSize) {\n  \"use strict\";\n  var "
    "nativeType = @getByIdDirectPrivate(stream, \"bunNativeType\"), nativePtr "
    "= @getByIdDirectPrivate(stream, \"bunNativePtr\"), Prototype = "
    "@lazyStreamPrototypeMap.@get(nativeType);\n  if (Prototype === "
    "@undefined) {\n    let handleNativeReadableStreamPromiseResult2 = "
    "function(val) {\n      var { c, v } = this;\n      this.c = @undefined, "
    "this.v = @undefined, handleResult(val, c, v);\n    }, callClose2 = "
    "function(controller) {\n      try {\n        controller.close();\n      } "
    "catch (e) {\n        globalThis.reportError(e);\n      }\n    }, "
    "createResult2 = function(tag, controller, view, closer2) {\n      "
    "closer2[0] = !1;\n      var result;\n      try {\n        result = "
    "pull(tag, view, closer2);\n      } catch (err) {\n        return "
    "controller.error(err);\n      }\n      return handleResult(result, "
    "controller, view);\n    };\n    var "
    "handleNativeReadableStreamPromiseResult = "
    "handleNativeReadableStreamPromiseResult2, callClose = callClose2, "
    "createResult = createResult2, [pull, start, cancel, setClose, deinit, "
    "setRefOrUnref, drain] = @lazyLoad(nativeType), closer = [!1], "
    "handleResult;\n    handleResult = function handleResult(result, "
    "controller, view) {\n      if (result && @isPromise(result))\n        "
    "return result.then(handleNativeReadableStreamPromiseResult2.bind({\n      "
    "    c: controller,\n          v: view\n        }), (err) => "
    "controller.error(err));\n      else if (typeof result === \"number\")\n   "
    "     if (view && view.byteLength === result && view.buffer === "
    "controller.byobRequest\?.view\?.buffer)\n          "
    "controller.byobRequest.respondWithNewView(view);\n        else\n          "
    "controller.byobRequest.respond(result);\n      else if "
    "(result.constructor === @Uint8Array)\n        "
    "controller.enqueue(result);\n      if (closer[0] || result === !1)\n      "
    "  @enqueueJob(callClose2, controller), closer[0] = !1;\n    };\n    const "
    "registry = deinit \? new FinalizationRegistry(deinit) : null;\n    "
    "Prototype = class NativeReadableStreamSource {\n      constructor(tag, "
    "autoAllocateChunkSize2, drainValue2) {\n        if (this.#tag = tag, "
    "this.#cancellationToken = {}, this.pull = this.#pull.bind(this), "
    "this.cancel = this.#cancel.bind(this), this.autoAllocateChunkSize = "
    "autoAllocateChunkSize2, drainValue2 !== @undefined)\n          this.start "
    "= (controller) => {\n            controller.enqueue(drainValue2);\n       "
    "   };\n        if (registry)\n          registry.register(this, tag, "
    "this.#cancellationToken);\n      }\n      #cancellationToken;\n      "
    "pull;\n      cancel;\n      start;\n      #tag;\n      type = "
    "\"bytes\";\n      autoAllocateChunkSize = 0;\n      static startSync = "
    "start;\n      #pull(controller) {\n        var tag = this.#tag;\n        "
    "if (!tag) {\n          controller.close();\n          return;\n        "
    "}\n        createResult2(tag, controller, controller.byobRequest.view, "
    "closer);\n      }\n      #cancel(reason) {\n        var tag = "
    "this.#tag;\n        registry && "
    "registry.unregister(this.#cancellationToken), setRefOrUnref && "
    "setRefOrUnref(tag, !1), cancel(tag, reason);\n      }\n      static "
    "deinit = deinit;\n      static drain = drain;\n    }, "
    "@lazyStreamPrototypeMap.@set(nativeType, Prototype);\n  }\n  const "
    "chunkSize = Prototype.startSync(nativePtr, autoAllocateChunkSize);\n  var "
    "drainValue;\n  const { drain: drainFn, deinit: deinitFn } = Prototype;\n  "
    "if (drainFn)\n    drainValue = drainFn(nativePtr);\n  if (chunkSize === "
    "0) {\n    if (deinit && nativePtr && @enqueueJob(deinit, nativePtr), "
    "(drainValue\?.byteLength \?\? 0) > 0)\n      return {\n        "
    "start(controller) {\n          controller.enqueue(drainValue), "
    "controller.close();\n        },\n        type: \"bytes\"\n      };\n    "
    "return {\n      start(controller) {\n        controller.close();\n      "
    "},\n      type: \"bytes\"\n    };\n  }\n  return new Prototype(nativePtr, "
    "chunkSize, drainValue);\n})";

// readableStreamIntoArray
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamIntoArrayCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamIntoArrayCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamIntoArrayCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamIntoArrayCodeLength = 537;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamIntoArrayCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsReadableStreamIntoArrayCode =
    "(function(stream) {\n  \"use strict\";\n  var reader = "
    "stream.getReader(), manyResult = reader.readMany();\n  async function "
    "processManyResult(result) {\n    if (result.done)\n      return [];\n    "
    "var chunks = result.value || [];\n    while (!0) {\n      var thisResult "
    "= await reader.read();\n      if (thisResult.done)\n        break;\n      "
    "chunks = chunks.concat(thisResult.value);\n    }\n    return chunks;\n  "
    "}\n  if (manyResult && @isPromise(manyResult))\n    return "
    "manyResult.@then(processManyResult);\n  return "
    "processManyResult(manyResult);\n})";

// readableStreamIntoText
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamIntoTextCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamIntoTextCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamIntoTextCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamIntoTextCodeLength = 305;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamIntoTextCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsReadableStreamIntoTextCode =
    "(function(stream) {\n  \"use strict\";\n  const [textStream, closer] = "
    "@createTextStream(@getByIdDirectPrivate(stream, \"highWaterMark\")), prom "
    "= @readStreamIntoSink(stream, textStream, !1);\n  if (prom && "
    "@isPromise(prom))\n    return "
    "@Promise.@resolve(prom).@then(closer.@promise);\n  return "
    "closer.@promise;\n})";

// readableStreamToArrayBufferDirect
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamToArrayBufferDirectCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamToArrayBufferDirectCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamToArrayBufferDirectCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamToArrayBufferDirectCodeLength =
    1427;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamToArrayBufferDirectCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsReadableStreamToArrayBufferDirectCode =
        "(function(stream, underlyingSource) {\n  \"use strict\";\n  var sink "
        "= new @Bun.ArrayBufferSink;\n  @putByIdDirectPrivate(stream, "
        "\"underlyingSource\", @undefined);\n  var highWaterMark = "
        "@getByIdDirectPrivate(stream, \"highWaterMark\");\n  "
        "sink.start(highWaterMark \? { highWaterMark } : {});\n  var "
        "capability = @newPromiseCapability(@Promise), ended = !1, pull = "
        "underlyingSource.pull, close = underlyingSource.close, controller = "
        "{\n    start() {\n    },\n    close(reason) {\n      if (!ended) {\n  "
        "      if (ended = !0, close)\n          close();\n        "
        "@fulfillPromise(capability.@promise, sink.end());\n      }\n    },\n  "
        "  end() {\n      if (!ended) {\n        if (ended = !0, close)\n      "
        "    close();\n        @fulfillPromise(capability.@promise, "
        "sink.end());\n      }\n    },\n    flush() {\n      return 0;\n    "
        "},\n    write: sink.write.bind(sink)\n  }, didError = !1;\n  try {\n  "
        "  const firstPull = pull(controller);\n    if (firstPull && "
        "@isObject(firstPull) && @isPromise(firstPull))\n      return async "
        "function(controller2, promise2, pull2) {\n        while (!ended)\n    "
        "      await pull2(controller2);\n        return await promise2;\n     "
        " }(controller, promise, pull);\n    return capability.@promise;\n  } "
        "catch (e) {\n    return didError = !0, @readableStreamError(stream, "
        "e), @Promise.@reject(e);\n  } finally {\n    if (!didError && "
        "stream)\n      @readableStreamClose(stream);\n    controller = close "
        "= sink = pull = stream = @undefined;\n  }\n})";

// readableStreamToTextDirect
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamToTextDirectCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamToTextDirectCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamToTextDirectCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamToTextDirectCodeLength = 466;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamToTextDirectCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsReadableStreamToTextDirectCode =
    "(async function(stream, underlyingSource) {\n  \"use strict\";\n  const "
    "capability = @initializeTextStream.@call(stream, underlyingSource, "
    "@undefined);\n  var reader = stream.getReader();\n  while "
    "(@getByIdDirectPrivate(stream, \"state\") === @streamReadable) {\n    var "
    "thisResult = await reader.read();\n    if (thisResult.done)\n      "
    "break;\n  }\n  try {\n    reader.releaseLock();\n  } catch (e) {\n  }\n  "
    "return reader = @undefined, stream = @undefined, capability.@promise;\n})";

// readableStreamToArrayDirect
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamToArrayDirectCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamToArrayDirectCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamToArrayDirectCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamToArrayDirectCodeLength = 649;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamToArrayDirectCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_readableStreamInternalsReadableStreamToArrayDirectCode =
    "(async function(stream, underlyingSource) {\n  \"use strict\";\n  const "
    "capability = @initializeArrayStream.@call(stream, underlyingSource, "
    "@undefined);\n  underlyingSource = @undefined;\n  var reader = "
    "stream.getReader();\n  try {\n    while (@getByIdDirectPrivate(stream, "
    "\"state\") === @streamReadable) {\n      var thisResult = await "
    "reader.read();\n      if (thisResult.done)\n        break;\n    }\n    "
    "try {\n      reader.releaseLock();\n    } catch (e) {\n    }\n    return "
    "reader = @undefined, @Promise.@resolve(capability.@promise);\n  } catch "
    "(e) {\n    throw e;\n  } finally {\n    stream = @undefined, reader = "
    "@undefined;\n  }\n  return capability.@promise;\n})";

// readableStreamDefineLazyIterators
const JSC::ConstructAbility
    s_readableStreamInternalsReadableStreamDefineLazyIteratorsCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_readableStreamInternalsReadableStreamDefineLazyIteratorsCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_readableStreamInternalsReadableStreamDefineLazyIteratorsCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamDefineLazyIteratorsCodeLength =
    1191;
static const JSC::Intrinsic
    s_readableStreamInternalsReadableStreamDefineLazyIteratorsCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_readableStreamInternalsReadableStreamDefineLazyIteratorsCode =
        "(function(prototype) {\n  \"use strict\";\n  var asyncIterator = "
        "globalThis.Symbol.asyncIterator, ReadableStreamAsyncIterator = async "
        "function* ReadableStreamAsyncIterator(stream, preventCancel) {\n    "
        "var reader = stream.getReader(), deferredError;\n    try {\n      "
        "while (!0) {\n        var done, value;\n        const firstResult = "
        "reader.readMany();\n        if (@isPromise(firstResult))\n          "
        "({ done, value } = await firstResult);\n        else\n          ({ "
        "done, value } = firstResult);\n        if (done)\n          return;\n "
        "       yield* value;\n      }\n    } catch (e) {\n      deferredError "
        "= e;\n    } finally {\n      if (reader.releaseLock(), "
        "!preventCancel)\n        stream.cancel(deferredError);\n      if "
        "(deferredError)\n        throw deferredError;\n    }\n  }, "
        "createAsyncIterator = function asyncIterator() {\n    return "
        "ReadableStreamAsyncIterator(this, !1);\n  }, createValues = function "
        "values({ preventCancel = !1 } = { preventCancel: !1 }) {\n    return "
        "ReadableStreamAsyncIterator(this, preventCancel);\n  };\n  return "
        "@Object.@defineProperty(prototype, asyncIterator, { value: "
        "createAsyncIterator }), @Object.@defineProperty(prototype, "
        "\"values\", { value: createValues }), prototype;\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .readableStreamInternalsBuiltins()                                     \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .readableStreamInternalsBuiltins()                          \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_READABLESTREAMINTERNALS_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* StreamInternals.ts */
// markPromiseAsHandled
const JSC::ConstructAbility
    s_streamInternalsMarkPromiseAsHandledCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_streamInternalsMarkPromiseAsHandledCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsMarkPromiseAsHandledCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_streamInternalsMarkPromiseAsHandledCodeLength = 204;
static const JSC::Intrinsic s_streamInternalsMarkPromiseAsHandledCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_streamInternalsMarkPromiseAsHandledCode =
    "(function(promise) {\n  \"use strict\", @assert(@isPromise(promise)), "
    "@putPromiseInternalField(promise, @promiseFieldFlags, "
    "@getPromiseInternalField(promise, @promiseFieldFlags) | "
    "@promiseFlagsIsHandled);\n})";

// shieldingPromiseResolve
const JSC::ConstructAbility
    s_streamInternalsShieldingPromiseResolveCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_streamInternalsShieldingPromiseResolveCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsShieldingPromiseResolveCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_streamInternalsShieldingPromiseResolveCodeLength = 183;
static const JSC::Intrinsic
    s_streamInternalsShieldingPromiseResolveCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_streamInternalsShieldingPromiseResolveCode =
    "(function(result) {\n  \"use strict\";\n  const promise = "
    "@Promise.@resolve(result);\n  if (promise.@then === @undefined)\n    "
    "promise.@then = @Promise.prototype.@then;\n  return promise;\n})";

// promiseInvokeOrNoopMethodNoCatch
const JSC::ConstructAbility
    s_streamInternalsPromiseInvokeOrNoopMethodNoCatchCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_streamInternalsPromiseInvokeOrNoopMethodNoCatchCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsPromiseInvokeOrNoopMethodNoCatchCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_streamInternalsPromiseInvokeOrNoopMethodNoCatchCodeLength = 175;
static const JSC::Intrinsic
    s_streamInternalsPromiseInvokeOrNoopMethodNoCatchCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_streamInternalsPromiseInvokeOrNoopMethodNoCatchCode =
    "(function(object, method, args) {\n  if (\"use strict\", method === "
    "@undefined)\n    return @Promise.@resolve();\n  return "
    "@shieldingPromiseResolve(method.@apply(object, args));\n})";

// promiseInvokeOrNoopNoCatch
const JSC::ConstructAbility
    s_streamInternalsPromiseInvokeOrNoopNoCatchCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_streamInternalsPromiseInvokeOrNoopNoCatchCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsPromiseInvokeOrNoopNoCatchCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_streamInternalsPromiseInvokeOrNoopNoCatchCodeLength = 118;
static const JSC::Intrinsic
    s_streamInternalsPromiseInvokeOrNoopNoCatchCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_streamInternalsPromiseInvokeOrNoopNoCatchCode =
    "(function(object, key, args) {\n  return \"use strict\", "
    "@promiseInvokeOrNoopMethodNoCatch(object, object[key], args);\n})";

// promiseInvokeOrNoopMethod
const JSC::ConstructAbility
    s_streamInternalsPromiseInvokeOrNoopMethodCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_streamInternalsPromiseInvokeOrNoopMethodCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsPromiseInvokeOrNoopMethodCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_streamInternalsPromiseInvokeOrNoopMethodCodeLength = 188;
static const JSC::Intrinsic
    s_streamInternalsPromiseInvokeOrNoopMethodCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_streamInternalsPromiseInvokeOrNoopMethodCode =
    "(function(object, method, args) {\n  \"use strict\";\n  try {\n    return "
    "@promiseInvokeOrNoopMethodNoCatch(object, method, args);\n  } catch "
    "(error) {\n    return @Promise.@reject(error);\n  }\n})";

// promiseInvokeOrNoop
const JSC::ConstructAbility
    s_streamInternalsPromiseInvokeOrNoopCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_streamInternalsPromiseInvokeOrNoopCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsPromiseInvokeOrNoopCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_streamInternalsPromiseInvokeOrNoopCodeLength = 176;
static const JSC::Intrinsic s_streamInternalsPromiseInvokeOrNoopCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_streamInternalsPromiseInvokeOrNoopCode =
    "(function(object, key, args) {\n  \"use strict\";\n  try {\n    return "
    "@promiseInvokeOrNoopNoCatch(object, key, args);\n  } catch (error) {\n    "
    "return @Promise.@reject(error);\n  }\n})";

// promiseInvokeOrFallbackOrNoop
const JSC::ConstructAbility
    s_streamInternalsPromiseInvokeOrFallbackOrNoopCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_streamInternalsPromiseInvokeOrFallbackOrNoopCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsPromiseInvokeOrFallbackOrNoopCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_streamInternalsPromiseInvokeOrFallbackOrNoopCodeLength = 326;
static const JSC::Intrinsic
    s_streamInternalsPromiseInvokeOrFallbackOrNoopCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_streamInternalsPromiseInvokeOrFallbackOrNoopCode =
    "(function(object, key1, args1, key2, args2) {\n  \"use strict\";\n  try "
    "{\n    const method = object[key1];\n    if (method === @undefined)\n     "
    " return @promiseInvokeOrNoopNoCatch(object, key2, args2);\n    return "
    "@shieldingPromiseResolve(method.@apply(object, args1));\n  } catch "
    "(error) {\n    return @Promise.@reject(error);\n  }\n})";

// validateAndNormalizeQueuingStrategy
const JSC::ConstructAbility
    s_streamInternalsValidateAndNormalizeQueuingStrategyCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_streamInternalsValidateAndNormalizeQueuingStrategyCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsValidateAndNormalizeQueuingStrategyCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_streamInternalsValidateAndNormalizeQueuingStrategyCodeLength = 398;
static const JSC::Intrinsic
    s_streamInternalsValidateAndNormalizeQueuingStrategyCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_streamInternalsValidateAndNormalizeQueuingStrategyCode =
    "(function(size, highWaterMark) {\n  if (\"use strict\", size !== "
    "@undefined && typeof size !== \"function\")\n    @throwTypeError(\"size "
    "parameter must be a function\");\n  const newHighWaterMark = "
    "@toNumber(highWaterMark);\n  if (@isNaN(newHighWaterMark) || "
    "newHighWaterMark < 0)\n    @throwRangeError(\"highWaterMark value is "
    "negative or not a number\");\n  return { size, highWaterMark: "
    "newHighWaterMark };\n})";

// createFIFO
const JSC::ConstructAbility s_streamInternalsCreateFIFOCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsCreateFIFOCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsCreateFIFOCodeImplementationVisibility =
        JSC::ImplementationVisibility::Private;
const int s_streamInternalsCreateFIFOCodeLength = 2276;
static const JSC::Intrinsic s_streamInternalsCreateFIFOCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_streamInternalsCreateFIFOCode =
    "(function() {\n  \"use strict\";\n  var slice = "
    "@Array.prototype.slice;\n\n  class Denqueue {\n    constructor() {\n      "
    "this._head = 0, this._tail = 0, this._capacityMask = 3, this._list = "
    "@newArrayWithSize(4);\n    }\n    _head;\n    _tail;\n    "
    "_capacityMask;\n    _list;\n    size() {\n      if (this._head === "
    "this._tail)\n        return 0;\n      if (this._head < this._tail)\n      "
    "  return this._tail - this._head;\n      else\n        return "
    "this._capacityMask + 1 - (this._head - this._tail);\n    }\n    isEmpty() "
    "{\n      return this.size() == 0;\n    }\n    isNotEmpty() {\n      "
    "return this.size() > 0;\n    }\n    shift() {\n      var { _head: head, "
    "_tail, _list, _capacityMask } = this;\n      if (head === _tail)\n        "
    "return @undefined;\n      var item = _list[head];\n      if "
    "(@putByValDirect(_list, head, @undefined), head = this._head = head + 1 & "
    "_capacityMask, head < 2 && _tail > 1e4 && _tail <= _list.length >>> 2)\n  "
    "      this._shrinkArray();\n      return item;\n    }\n    peek() {\n     "
    " if (this._head === this._tail)\n        return @undefined;\n      return "
    "this._list[this._head];\n    }\n    push(item) {\n      var tail = "
    "this._tail;\n      if (@putByValDirect(this._list, tail, item), "
    "this._tail = tail + 1 & this._capacityMask, this._tail === this._head)\n  "
    "      this._growArray();\n    }\n    toArray(fullCopy) {\n      var list "
    "= this._list, len = @toLength(list.length);\n      if (fullCopy || "
    "this._head > this._tail) {\n        var _head = @toLength(this._head), "
    "_tail = @toLength(this._tail), total = @toLength(len - _head + _tail), "
    "array = @newArrayWithSize(total), j = 0;\n        for (var i = _head;i < "
    "len; i++)\n          @putByValDirect(array, j++, list[i]);\n        for "
    "(var i = 0;i < _tail; i++)\n          @putByValDirect(array, j++, "
    "list[i]);\n        return array;\n      } else\n        return "
    "slice.@call(list, this._head, this._tail);\n    }\n    clear() {\n      "
    "this._head = 0, this._tail = 0, this._list.fill(@undefined);\n    }\n    "
    "_growArray() {\n      if (this._head)\n        this._list = "
    "this.toArray(!0), this._head = 0;\n      this._tail = "
    "@toLength(this._list.length), this._list.length <<= 1, this._capacityMask "
    "= this._capacityMask << 1 | 1;\n    }\n    shrinkArray() {\n      "
    "this._list.length >>>= 1, this._capacityMask >>>= 1;\n    }\n  }\n  "
    "return new Denqueue;\n})";

// newQueue
const JSC::ConstructAbility s_streamInternalsNewQueueCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsNewQueueCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsNewQueueCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_streamInternalsNewQueueCodeLength = 76;
static const JSC::Intrinsic s_streamInternalsNewQueueCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_streamInternalsNewQueueCode =
    "(function() {\n  return \"use strict\", { content: @createFIFO(), size: 0 "
    "};\n})";

// dequeueValue
const JSC::ConstructAbility s_streamInternalsDequeueValueCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsDequeueValueCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsDequeueValueCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_streamInternalsDequeueValueCodeLength = 169;
static const JSC::Intrinsic s_streamInternalsDequeueValueCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_streamInternalsDequeueValueCode =
    "(function(queue) {\n  \"use strict\";\n  const record = "
    "queue.content.shift();\n  if (queue.size -= record.size, queue.size < "
    "0)\n    queue.size = 0;\n  return record.value;\n})";

// enqueueValueWithSize
const JSC::ConstructAbility
    s_streamInternalsEnqueueValueWithSizeCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_streamInternalsEnqueueValueWithSizeCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsEnqueueValueWithSizeCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_streamInternalsEnqueueValueWithSizeCodeLength = 220;
static const JSC::Intrinsic s_streamInternalsEnqueueValueWithSizeCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_streamInternalsEnqueueValueWithSizeCode =
    "(function(queue, value, size) {\n  if (\"use strict\", size = "
    "@toNumber(size), !@isFinite(size) || size < 0)\n    "
    "@throwRangeError(\"size has an incorrect value\");\n  "
    "queue.content.push({ value, size }), queue.size += size;\n})";

// peekQueueValue
const JSC::ConstructAbility
    s_streamInternalsPeekQueueValueCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsPeekQueueValueCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsPeekQueueValueCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_streamInternalsPeekQueueValueCodeLength = 73;
static const JSC::Intrinsic s_streamInternalsPeekQueueValueCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_streamInternalsPeekQueueValueCode =
    "(function(queue) {\n  return \"use strict\", "
    "queue.content.peek()\?.value;\n})";

// resetQueue
const JSC::ConstructAbility s_streamInternalsResetQueueCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsResetQueueCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsResetQueueCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_streamInternalsResetQueueCodeLength = 131;
static const JSC::Intrinsic s_streamInternalsResetQueueCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_streamInternalsResetQueueCode =
    "(function(queue) {\n  \"use strict\", @assert(\"content\" in queue), "
    "@assert(\"size\" in queue), queue.content.clear(), queue.size = 0;\n})";

// extractSizeAlgorithm
const JSC::ConstructAbility
    s_streamInternalsExtractSizeAlgorithmCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_streamInternalsExtractSizeAlgorithmCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsExtractSizeAlgorithmCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_streamInternalsExtractSizeAlgorithmCodeLength = 295;
static const JSC::Intrinsic s_streamInternalsExtractSizeAlgorithmCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_streamInternalsExtractSizeAlgorithmCode =
    "(function(strategy) {\n  \"use strict\";\n  const sizeAlgorithm = "
    "strategy.size;\n  if (sizeAlgorithm === @undefined)\n    return () => "
    "1;\n  if (typeof sizeAlgorithm !== \"function\")\n    "
    "@throwTypeError(\"strategy.size must be a function\");\n  return (chunk) "
    "=> {\n    return sizeAlgorithm(chunk);\n  };\n})";

// extractHighWaterMark
const JSC::ConstructAbility
    s_streamInternalsExtractHighWaterMarkCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_streamInternalsExtractHighWaterMarkCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsExtractHighWaterMarkCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_streamInternalsExtractHighWaterMarkCodeLength = 317;
static const JSC::Intrinsic s_streamInternalsExtractHighWaterMarkCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_streamInternalsExtractHighWaterMarkCode =
    "(function(strategy, defaultHWM) {\n  \"use strict\";\n  const "
    "highWaterMark = strategy.highWaterMark;\n  if (highWaterMark === "
    "@undefined)\n    return defaultHWM;\n  if (@isNaN(highWaterMark) || "
    "highWaterMark < 0)\n    @throwRangeError(\"highWaterMark value is "
    "negative or not a number\");\n  return @toNumber(highWaterMark);\n})";

// extractHighWaterMarkFromQueuingStrategyInit
const JSC::ConstructAbility
    s_streamInternalsExtractHighWaterMarkFromQueuingStrategyInitCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_streamInternalsExtractHighWaterMarkFromQueuingStrategyInitCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsExtractHighWaterMarkFromQueuingStrategyInitCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_streamInternalsExtractHighWaterMarkFromQueuingStrategyInitCodeLength =
        313;
static const JSC::Intrinsic
    s_streamInternalsExtractHighWaterMarkFromQueuingStrategyInitCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_streamInternalsExtractHighWaterMarkFromQueuingStrategyInitCode =
        "(function(init) {\n  if (\"use strict\", !@isObject(init))\n    "
        "@throwTypeError(\"QueuingStrategyInit argument must be an "
        "object.\");\n  const { highWaterMark } = init;\n  if (highWaterMark "
        "=== @undefined)\n    "
        "@throwTypeError(\"QueuingStrategyInit.highWaterMark member is "
        "required.\");\n  return @toNumber(highWaterMark);\n})";

// createFulfilledPromise
const JSC::ConstructAbility
    s_streamInternalsCreateFulfilledPromiseCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_streamInternalsCreateFulfilledPromiseCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsCreateFulfilledPromiseCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_streamInternalsCreateFulfilledPromiseCodeLength = 121;
static const JSC::Intrinsic
    s_streamInternalsCreateFulfilledPromiseCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_streamInternalsCreateFulfilledPromiseCode =
    "(function(value) {\n  \"use strict\";\n  const promise = @newPromise();\n "
    " return @fulfillPromise(promise, value), promise;\n})";

// toDictionary
const JSC::ConstructAbility s_streamInternalsToDictionaryCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsToDictionaryCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_streamInternalsToDictionaryCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_streamInternalsToDictionaryCodeLength = 210;
static const JSC::Intrinsic s_streamInternalsToDictionaryCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_streamInternalsToDictionaryCode =
    "(function(value, defaultValue, errorMessage) {\n  if (\"use strict\", "
    "value === @undefined || value === null)\n    return defaultValue;\n  if "
    "(!@isObject(value))\n    @throwTypeError(errorMessage);\n  return "
    "value;\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .streamInternalsBuiltins()                                             \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .streamInternalsBuiltins()                                  \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_STREAMINTERNALS_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* TransformStream.ts */
// initializeTransformStream
const JSC::ConstructAbility
    s_transformStreamInitializeTransformStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInitializeTransformStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInitializeTransformStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_transformStreamInitializeTransformStreamCodeLength = 2390;
static const JSC::Intrinsic
    s_transformStreamInitializeTransformStreamCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_transformStreamInitializeTransformStreamCode =
    "(function() {\n  \"use strict\";\n  let transformer = arguments[0];\n  if "
    "(@isObject(transformer) && @getByIdDirectPrivate(transformer, "
    "\"TransformStream\"))\n    return this;\n  let writableStrategy = "
    "arguments[1], readableStrategy = arguments[2];\n  if (transformer === "
    "@undefined)\n    transformer = null;\n  if (readableStrategy === "
    "@undefined)\n    readableStrategy = {};\n  if (writableStrategy === "
    "@undefined)\n    writableStrategy = {};\n  let transformerDict = {};\n  "
    "if (transformer !== null) {\n    if (\"start\" in transformer) {\n      "
    "if (transformerDict[\"start\"] = transformer[\"start\"], typeof "
    "transformerDict[\"start\"] !== \"function\")\n        "
    "@throwTypeError(\"transformer.start should be a function\");\n    }\n    "
    "if (\"transform\" in transformer) {\n      if "
    "(transformerDict[\"transform\"] = transformer[\"transform\"], typeof "
    "transformerDict[\"transform\"] !== \"function\")\n        "
    "@throwTypeError(\"transformer.transform should be a function\");\n    }\n "
    "   if (\"flush\" in transformer) {\n      if (transformerDict[\"flush\"] "
    "= transformer[\"flush\"], typeof transformerDict[\"flush\"] !== "
    "\"function\")\n        @throwTypeError(\"transformer.flush should be a "
    "function\");\n    }\n    if (\"readableType\" in transformer)\n      "
    "@throwRangeError(\"TransformStream transformer has a readableType\");\n   "
    " if (\"writableType\" in transformer)\n      "
    "@throwRangeError(\"TransformStream transformer has a writableType\");\n  "
    "}\n  const readableHighWaterMark = "
    "@extractHighWaterMark(readableStrategy, 0), readableSizeAlgorithm = "
    "@extractSizeAlgorithm(readableStrategy), writableHighWaterMark = "
    "@extractHighWaterMark(writableStrategy, 1), writableSizeAlgorithm = "
    "@extractSizeAlgorithm(writableStrategy), startPromiseCapability = "
    "@newPromiseCapability(@Promise);\n  if (@initializeTransformStream(this, "
    "startPromiseCapability.@promise, writableHighWaterMark, "
    "writableSizeAlgorithm, readableHighWaterMark, readableSizeAlgorithm), "
    "@setUpTransformStreamDefaultControllerFromTransformer(this, transformer, "
    "transformerDict), (\"start\" in transformerDict)) {\n    const controller "
    "= @getByIdDirectPrivate(this, \"controller\");\n    (() => "
    "@promiseInvokeOrNoopMethodNoCatch(transformer, "
    "transformerDict[\"start\"], [controller]))().@then(() => {\n      "
    "startPromiseCapability.@resolve.@call();\n    }, (error) => {\n      "
    "startPromiseCapability.@reject.@call(@undefined, error);\n    });\n  } "
    "else\n    startPromiseCapability.@resolve.@call();\n  return this;\n})";

// readable
const JSC::ConstructAbility s_transformStreamReadableCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamReadableCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamReadableCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_transformStreamReadableCodeLength = 174;
static const JSC::Intrinsic s_transformStreamReadableCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_transformStreamReadableCode =
    "(function() {\n  if (\"use strict\", !@isTransformStream(this))\n    "
    "throw @makeThisTypeError(\"TransformStream\", \"readable\");\n  return "
    "@getByIdDirectPrivate(this, \"readable\");\n})";

// writable
const JSC::ConstructAbility s_transformStreamWritableCodeConstructAbility =
    JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamWritableCodeConstructorKind =
    JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamWritableCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_transformStreamWritableCodeLength = 174;
static const JSC::Intrinsic s_transformStreamWritableCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_transformStreamWritableCode =
    "(function() {\n  if (\"use strict\", !@isTransformStream(this))\n    "
    "throw @makeThisTypeError(\"TransformStream\", \"writable\");\n  return "
    "@getByIdDirectPrivate(this, \"writable\");\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .transformStreamBuiltins()                                             \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .transformStreamBuiltins()                                  \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_TRANSFORMSTREAM_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* TransformStreamDefaultController.ts */
// initializeTransformStreamDefaultController
const JSC::ConstructAbility
    s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCodeLength =
        45;
static const JSC::Intrinsic
    s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCode =
        "(function() {\n  return \"use strict\", this;\n})";

// desiredSize
const JSC::ConstructAbility
    s_transformStreamDefaultControllerDesiredSizeCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamDefaultControllerDesiredSizeCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamDefaultControllerDesiredSizeCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_transformStreamDefaultControllerDesiredSizeCodeLength = 426;
static const JSC::Intrinsic
    s_transformStreamDefaultControllerDesiredSizeCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_transformStreamDefaultControllerDesiredSizeCode =
    "(function() {\n  if (\"use strict\", "
    "!@isTransformStreamDefaultController(this))\n    throw "
    "@makeThisTypeError(\"TransformStreamDefaultController\", \"enqueue\");\n  "
    "const stream = @getByIdDirectPrivate(this, \"stream\"), readable = "
    "@getByIdDirectPrivate(stream, \"readable\"), readableController = "
    "@getByIdDirectPrivate(readable, \"readableStreamController\");\n  return "
    "@readableStreamDefaultControllerGetDesiredSize(readableController);\n})";

// enqueue
const JSC::ConstructAbility
    s_transformStreamDefaultControllerEnqueueCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamDefaultControllerEnqueueCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamDefaultControllerEnqueueCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_transformStreamDefaultControllerEnqueueCodeLength = 219;
static const JSC::Intrinsic
    s_transformStreamDefaultControllerEnqueueCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_transformStreamDefaultControllerEnqueueCode =
    "(function(chunk) {\n  if (\"use strict\", "
    "!@isTransformStreamDefaultController(this))\n    throw "
    "@makeThisTypeError(\"TransformStreamDefaultController\", \"enqueue\");\n  "
    "@transformStreamDefaultControllerEnqueue(this, chunk);\n})";

// error
const JSC::ConstructAbility
    s_transformStreamDefaultControllerErrorCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamDefaultControllerErrorCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamDefaultControllerErrorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_transformStreamDefaultControllerErrorCodeLength = 207;
static const JSC::Intrinsic
    s_transformStreamDefaultControllerErrorCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_transformStreamDefaultControllerErrorCode =
    "(function(e) {\n  if (\"use strict\", "
    "!@isTransformStreamDefaultController(this))\n    throw "
    "@makeThisTypeError(\"TransformStreamDefaultController\", \"error\");\n  "
    "@transformStreamDefaultControllerError(this, e);\n})";

// terminate
const JSC::ConstructAbility
    s_transformStreamDefaultControllerTerminateCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamDefaultControllerTerminateCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamDefaultControllerTerminateCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_transformStreamDefaultControllerTerminateCodeLength = 211;
static const JSC::Intrinsic
    s_transformStreamDefaultControllerTerminateCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_transformStreamDefaultControllerTerminateCode =
    "(function() {\n  if (\"use strict\", "
    "!@isTransformStreamDefaultController(this))\n    throw "
    "@makeThisTypeError(\"TransformStreamDefaultController\", "
    "\"terminate\");\n  @transformStreamDefaultControllerTerminate(this);\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .transformStreamDefaultControllerBuiltins()                            \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .transformStreamDefaultControllerBuiltins()                 \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_TRANSFORMSTREAMDEFAULTCONTROLLER_BUILTIN_CODE(
    DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* TransformStreamInternals.ts */
// isTransformStream
const JSC::ConstructAbility
    s_transformStreamInternalsIsTransformStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsIsTransformStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsIsTransformStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsIsTransformStreamCodeLength = 111;
static const JSC::Intrinsic
    s_transformStreamInternalsIsTransformStreamCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_transformStreamInternalsIsTransformStreamCode =
    "(function(stream) {\n  return \"use strict\", @isObject(stream) && "
    "!!@getByIdDirectPrivate(stream, \"readable\");\n})";

// isTransformStreamDefaultController
const JSC::ConstructAbility
    s_transformStreamInternalsIsTransformStreamDefaultControllerCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsIsTransformStreamDefaultControllerCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsIsTransformStreamDefaultControllerCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_transformStreamInternalsIsTransformStreamDefaultControllerCodeLength =
        133;
static const JSC::Intrinsic
    s_transformStreamInternalsIsTransformStreamDefaultControllerCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_transformStreamInternalsIsTransformStreamDefaultControllerCode =
        "(function(controller) {\n  return \"use strict\", "
        "@isObject(controller) && !!@getByIdDirectPrivate(controller, "
        "\"transformAlgorithm\");\n})";

// createTransformStream
const JSC::ConstructAbility
    s_transformStreamInternalsCreateTransformStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsCreateTransformStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsCreateTransformStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsCreateTransformStreamCodeLength = 1248;
static const JSC::Intrinsic
    s_transformStreamInternalsCreateTransformStreamCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_transformStreamInternalsCreateTransformStreamCode =
    "(function(startAlgorithm, transformAlgorithm, flushAlgorithm, "
    "writableHighWaterMark, writableSizeAlgorithm, readableHighWaterMark, "
    "readableSizeAlgorithm) {\n  if (\"use strict\", writableHighWaterMark === "
    "@undefined)\n    writableHighWaterMark = 1;\n  if (writableSizeAlgorithm "
    "=== @undefined)\n    writableSizeAlgorithm = () => 1;\n  if "
    "(readableHighWaterMark === @undefined)\n    readableHighWaterMark = 0;\n  "
    "if (readableSizeAlgorithm === @undefined)\n    readableSizeAlgorithm = () "
    "=> 1;\n  @assert(writableHighWaterMark >= 0), "
    "@assert(readableHighWaterMark >= 0);\n  const transform = {};\n  "
    "@putByIdDirectPrivate(transform, \"TransformStream\", !0);\n  const "
    "stream = new @TransformStream(transform), startPromiseCapability = "
    "@newPromiseCapability(@Promise);\n  @initializeTransformStream(stream, "
    "startPromiseCapability.@promise, writableHighWaterMark, "
    "writableSizeAlgorithm, readableHighWaterMark, readableSizeAlgorithm);\n  "
    "const controller = new @TransformStreamDefaultController;\n  return "
    "@setUpTransformStreamDefaultController(stream, controller, "
    "transformAlgorithm, flushAlgorithm), startAlgorithm().@then(() => {\n    "
    "startPromiseCapability.@resolve.@call();\n  }, (error) => {\n    "
    "startPromiseCapability.@reject.@call(@undefined, error);\n  }), "
    "stream;\n})";

// initializeTransformStream
const JSC::ConstructAbility
    s_transformStreamInternalsInitializeTransformStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsInitializeTransformStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsInitializeTransformStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsInitializeTransformStreamCodeLength = 1755;
static const JSC::Intrinsic
    s_transformStreamInternalsInitializeTransformStreamCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_transformStreamInternalsInitializeTransformStreamCode =
    "(function(stream, startPromise, writableHighWaterMark, "
    "writableSizeAlgorithm, readableHighWaterMark, readableSizeAlgorithm) {\n  "
    "\"use strict\";\n  const startAlgorithm = () => {\n    return "
    "startPromise;\n  }, writeAlgorithm = (chunk) => {\n    return "
    "@transformStreamDefaultSinkWriteAlgorithm(stream, chunk);\n  }, "
    "abortAlgorithm = (reason) => {\n    return "
    "@transformStreamDefaultSinkAbortAlgorithm(stream, reason);\n  }, "
    "closeAlgorithm = () => {\n    return "
    "@transformStreamDefaultSinkCloseAlgorithm(stream);\n  }, writable = "
    "@createWritableStream(startAlgorithm, writeAlgorithm, closeAlgorithm, "
    "abortAlgorithm, writableHighWaterMark, writableSizeAlgorithm), "
    "pullAlgorithm = () => {\n    return "
    "@transformStreamDefaultSourcePullAlgorithm(stream);\n  }, cancelAlgorithm "
    "= (reason) => {\n    return "
    "@transformStreamErrorWritableAndUnblockWrite(stream, reason), "
    "@Promise.@resolve();\n  }, underlyingSource = {};\n  "
    "@putByIdDirectPrivate(underlyingSource, \"start\", startAlgorithm), "
    "@putByIdDirectPrivate(underlyingSource, \"pull\", pullAlgorithm), "
    "@putByIdDirectPrivate(underlyingSource, \"cancel\", cancelAlgorithm);\n  "
    "const options = {};\n  @putByIdDirectPrivate(options, \"size\", "
    "readableSizeAlgorithm), @putByIdDirectPrivate(options, \"highWaterMark\", "
    "readableHighWaterMark);\n  const readable = new "
    "@ReadableStream(underlyingSource, options);\n  "
    "@putByIdDirectPrivate(stream, \"writable\", writable), "
    "@putByIdDirectPrivate(stream, \"internalWritable\", "
    "@getInternalWritableStream(writable)), @putByIdDirectPrivate(stream, "
    "\"readable\", readable), @putByIdDirectPrivate(stream, \"backpressure\", "
    "@undefined), @putByIdDirectPrivate(stream, \"backpressureChangePromise\", "
    "@undefined), @transformStreamSetBackpressure(stream, !0), "
    "@putByIdDirectPrivate(stream, \"controller\", @undefined);\n})";

// transformStreamError
const JSC::ConstructAbility
    s_transformStreamInternalsTransformStreamErrorCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsTransformStreamErrorCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsTransformStreamErrorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsTransformStreamErrorCodeLength = 306;
static const JSC::Intrinsic
    s_transformStreamInternalsTransformStreamErrorCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_transformStreamInternalsTransformStreamErrorCode =
    "(function(stream, e) {\n  \"use strict\";\n  const readable = "
    "@getByIdDirectPrivate(stream, \"readable\"), readableController = "
    "@getByIdDirectPrivate(readable, \"readableStreamController\");\n  "
    "@readableStreamDefaultControllerError(readableController, e), "
    "@transformStreamErrorWritableAndUnblockWrite(stream, e);\n})";

// transformStreamErrorWritableAndUnblockWrite
const JSC::ConstructAbility
    s_transformStreamInternalsTransformStreamErrorWritableAndUnblockWriteCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsTransformStreamErrorWritableAndUnblockWriteCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsTransformStreamErrorWritableAndUnblockWriteCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_transformStreamInternalsTransformStreamErrorWritableAndUnblockWriteCodeLength =
        405;
static const JSC::Intrinsic
    s_transformStreamInternalsTransformStreamErrorWritableAndUnblockWriteCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_transformStreamInternalsTransformStreamErrorWritableAndUnblockWriteCode =
        "(function(stream, e) {\n  \"use strict\", "
        "@transformStreamDefaultControllerClearAlgorithms(@"
        "getByIdDirectPrivate(stream, \"controller\"));\n  const writable = "
        "@getByIdDirectPrivate(stream, \"internalWritable\");\n  if "
        "(@writableStreamDefaultControllerErrorIfNeeded(@getByIdDirectPrivate("
        "writable, \"controller\"), e), @getByIdDirectPrivate(stream, "
        "\"backpressure\"))\n    @transformStreamSetBackpressure(stream, "
        "!1);\n})";

// transformStreamSetBackpressure
const JSC::ConstructAbility
    s_transformStreamInternalsTransformStreamSetBackpressureCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsTransformStreamSetBackpressureCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsTransformStreamSetBackpressureCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsTransformStreamSetBackpressureCodeLength =
    473;
static const JSC::Intrinsic
    s_transformStreamInternalsTransformStreamSetBackpressureCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_transformStreamInternalsTransformStreamSetBackpressureCode =
    "(function(stream, backpressure) {\n  \"use strict\", "
    "@assert(@getByIdDirectPrivate(stream, \"backpressure\") !== "
    "backpressure);\n  const backpressureChangePromise = "
    "@getByIdDirectPrivate(stream, \"backpressureChangePromise\");\n  if "
    "(backpressureChangePromise !== @undefined)\n    "
    "backpressureChangePromise.@resolve.@call();\n  "
    "@putByIdDirectPrivate(stream, \"backpressureChangePromise\", "
    "@newPromiseCapability(@Promise)), @putByIdDirectPrivate(stream, "
    "\"backpressure\", backpressure);\n})";

// setUpTransformStreamDefaultController
const JSC::ConstructAbility
    s_transformStreamInternalsSetUpTransformStreamDefaultControllerCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsSetUpTransformStreamDefaultControllerCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsSetUpTransformStreamDefaultControllerCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_transformStreamInternalsSetUpTransformStreamDefaultControllerCodeLength =
        448;
static const JSC::Intrinsic
    s_transformStreamInternalsSetUpTransformStreamDefaultControllerCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_transformStreamInternalsSetUpTransformStreamDefaultControllerCode =
        "(function(stream, controller, transformAlgorithm, flushAlgorithm) {\n "
        " \"use strict\", @assert(@isTransformStream(stream)), "
        "@assert(@getByIdDirectPrivate(stream, \"controller\") === "
        "@undefined), @putByIdDirectPrivate(controller, \"stream\", stream), "
        "@putByIdDirectPrivate(stream, \"controller\", controller), "
        "@putByIdDirectPrivate(controller, \"transformAlgorithm\", "
        "transformAlgorithm), @putByIdDirectPrivate(controller, "
        "\"flushAlgorithm\", flushAlgorithm);\n})";

// setUpTransformStreamDefaultControllerFromTransformer
const JSC::ConstructAbility
    s_transformStreamInternalsSetUpTransformStreamDefaultControllerFromTransformerCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsSetUpTransformStreamDefaultControllerFromTransformerCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsSetUpTransformStreamDefaultControllerFromTransformerCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_transformStreamInternalsSetUpTransformStreamDefaultControllerFromTransformerCodeLength =
        852;
static const JSC::Intrinsic
    s_transformStreamInternalsSetUpTransformStreamDefaultControllerFromTransformerCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_transformStreamInternalsSetUpTransformStreamDefaultControllerFromTransformerCode =
        "(function(stream, transformer, transformerDict) {\n  \"use "
        "strict\";\n  const controller = new "
        "@TransformStreamDefaultController;\n  let transformAlgorithm = "
        "(chunk) => {\n    try {\n      "
        "@transformStreamDefaultControllerEnqueue(controller, chunk);\n    } "
        "catch (e) {\n      return @Promise.@reject(e);\n    }\n    return "
        "@Promise.@resolve();\n  }, flushAlgorithm = () => {\n    return "
        "@Promise.@resolve();\n  };\n  if (\"transform\" in transformerDict)\n "
        "   transformAlgorithm = (chunk) => {\n      return "
        "@promiseInvokeOrNoopMethod(transformer, "
        "transformerDict[\"transform\"], [chunk, controller]);\n    };\n  if "
        "(\"flush\" in transformerDict)\n    flushAlgorithm = () => {\n      "
        "return @promiseInvokeOrNoopMethod(transformer, "
        "transformerDict[\"flush\"], [controller]);\n    };\n  "
        "@setUpTransformStreamDefaultController(stream, controller, "
        "transformAlgorithm, flushAlgorithm);\n})";

// transformStreamDefaultControllerClearAlgorithms
const JSC::ConstructAbility
    s_transformStreamInternalsTransformStreamDefaultControllerClearAlgorithmsCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsTransformStreamDefaultControllerClearAlgorithmsCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsTransformStreamDefaultControllerClearAlgorithmsCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_transformStreamInternalsTransformStreamDefaultControllerClearAlgorithmsCodeLength =
        168;
static const JSC::Intrinsic
    s_transformStreamInternalsTransformStreamDefaultControllerClearAlgorithmsCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_transformStreamInternalsTransformStreamDefaultControllerClearAlgorithmsCode =
        "(function(controller) {\n  \"use strict\", "
        "@putByIdDirectPrivate(controller, \"transformAlgorithm\", !0), "
        "@putByIdDirectPrivate(controller, \"flushAlgorithm\", "
        "@undefined);\n})";

// transformStreamDefaultControllerEnqueue
const JSC::ConstructAbility
    s_transformStreamInternalsTransformStreamDefaultControllerEnqueueCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsTransformStreamDefaultControllerEnqueueCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsTransformStreamDefaultControllerEnqueueCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_transformStreamInternalsTransformStreamDefaultControllerEnqueueCodeLength =
        891;
static const JSC::Intrinsic
    s_transformStreamInternalsTransformStreamDefaultControllerEnqueueCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_transformStreamInternalsTransformStreamDefaultControllerEnqueueCode =
        "(function(controller, chunk) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(controller, \"stream\"), readable = "
        "@getByIdDirectPrivate(stream, \"readable\"), readableController = "
        "@getByIdDirectPrivate(readable, \"readableStreamController\");\n  if "
        "(@assert(readableController !== @undefined), "
        "!@readableStreamDefaultControllerCanCloseOrEnqueue(readableController)"
        ")\n    @throwTypeError(\"TransformStream.readable cannot close or "
        "enqueue\");\n  try {\n    "
        "@readableStreamDefaultControllerEnqueue(readableController, chunk);\n "
        " } catch (e) {\n    throw "
        "@transformStreamErrorWritableAndUnblockWrite(stream, e), "
        "@getByIdDirectPrivate(readable, \"storedError\");\n  }\n  const "
        "backpressure = "
        "!@readableStreamDefaultControllerShouldCallPull(readableController);"
        "\n  if (backpressure !== @getByIdDirectPrivate(stream, "
        "\"backpressure\"))\n    @assert(backpressure), "
        "@transformStreamSetBackpressure(stream, !0);\n})";

// transformStreamDefaultControllerError
const JSC::ConstructAbility
    s_transformStreamInternalsTransformStreamDefaultControllerErrorCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsTransformStreamDefaultControllerErrorCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsTransformStreamDefaultControllerErrorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_transformStreamInternalsTransformStreamDefaultControllerErrorCodeLength =
        116;
static const JSC::Intrinsic
    s_transformStreamInternalsTransformStreamDefaultControllerErrorCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_transformStreamInternalsTransformStreamDefaultControllerErrorCode =
        "(function(controller, e) {\n  \"use strict\", "
        "@transformStreamError(@getByIdDirectPrivate(controller, \"stream\"), "
        "e);\n})";

// transformStreamDefaultControllerPerformTransform
const JSC::ConstructAbility
    s_transformStreamInternalsTransformStreamDefaultControllerPerformTransformCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsTransformStreamDefaultControllerPerformTransformCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsTransformStreamDefaultControllerPerformTransformCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_transformStreamInternalsTransformStreamDefaultControllerPerformTransformCodeLength =
        419;
static const JSC::Intrinsic
    s_transformStreamInternalsTransformStreamDefaultControllerPerformTransformCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_transformStreamInternalsTransformStreamDefaultControllerPerformTransformCode =
        "(function(controller, chunk) {\n  \"use strict\";\n  const "
        "promiseCapability = @newPromiseCapability(@Promise);\n  return "
        "@getByIdDirectPrivate(controller, "
        "\"transformAlgorithm\").@call(@undefined, chunk).@then(() => {\n    "
        "promiseCapability.@resolve();\n  }, (r) => {\n    "
        "@transformStreamError(@getByIdDirectPrivate(controller, \"stream\"), "
        "r), promiseCapability.@reject.@call(@undefined, r);\n  }), "
        "promiseCapability.@promise;\n})";

// transformStreamDefaultControllerTerminate
const JSC::ConstructAbility
    s_transformStreamInternalsTransformStreamDefaultControllerTerminateCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsTransformStreamDefaultControllerTerminateCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsTransformStreamDefaultControllerTerminateCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_transformStreamInternalsTransformStreamDefaultControllerTerminateCodeLength =
        509;
static const JSC::Intrinsic
    s_transformStreamInternalsTransformStreamDefaultControllerTerminateCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_transformStreamInternalsTransformStreamDefaultControllerTerminateCode =
        "(function(controller) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(controller, \"stream\"), readable = "
        "@getByIdDirectPrivate(stream, \"readable\"), readableController = "
        "@getByIdDirectPrivate(readable, \"readableStreamController\");\n  if "
        "(@readableStreamDefaultControllerCanCloseOrEnqueue(readableController)"
        ")\n    @readableStreamDefaultControllerClose(readableController);\n  "
        "const error = @makeTypeError(\"the stream has been terminated\");\n  "
        "@transformStreamErrorWritableAndUnblockWrite(stream, error);\n})";

// transformStreamDefaultSinkWriteAlgorithm
const JSC::ConstructAbility
    s_transformStreamInternalsTransformStreamDefaultSinkWriteAlgorithmCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsTransformStreamDefaultSinkWriteAlgorithmCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsTransformStreamDefaultSinkWriteAlgorithmCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_transformStreamInternalsTransformStreamDefaultSinkWriteAlgorithmCodeLength =
        1218;
static const JSC::Intrinsic
    s_transformStreamInternalsTransformStreamDefaultSinkWriteAlgorithmCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_transformStreamInternalsTransformStreamDefaultSinkWriteAlgorithmCode =
        "(function(stream, chunk) {\n  \"use strict\";\n  const writable = "
        "@getByIdDirectPrivate(stream, \"internalWritable\");\n  "
        "@assert(@getByIdDirectPrivate(writable, \"state\") === "
        "\"writable\");\n  const controller = @getByIdDirectPrivate(stream, "
        "\"controller\");\n  if (@getByIdDirectPrivate(stream, "
        "\"backpressure\")) {\n    const promiseCapability = "
        "@newPromiseCapability(@Promise), backpressureChangePromise = "
        "@getByIdDirectPrivate(stream, \"backpressureChangePromise\");\n    "
        "return @assert(backpressureChangePromise !== @undefined), "
        "backpressureChangePromise.@promise.@then(() => {\n      const state = "
        "@getByIdDirectPrivate(writable, \"state\");\n      if (state === "
        "\"erroring\") {\n        promiseCapability.@reject.@call(@undefined, "
        "@getByIdDirectPrivate(writable, \"storedError\"));\n        return;\n "
        "     }\n      @assert(state === \"writable\"), "
        "@transformStreamDefaultControllerPerformTransform(controller, "
        "chunk).@then(() => {\n        promiseCapability.@resolve();\n      }, "
        "(e) => {\n        promiseCapability.@reject.@call(@undefined, e);\n   "
        "   });\n    }, (e) => {\n      "
        "promiseCapability.@reject.@call(@undefined, e);\n    }), "
        "promiseCapability.@promise;\n  }\n  return "
        "@transformStreamDefaultControllerPerformTransform(controller, "
        "chunk);\n})";

// transformStreamDefaultSinkAbortAlgorithm
const JSC::ConstructAbility
    s_transformStreamInternalsTransformStreamDefaultSinkAbortAlgorithmCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsTransformStreamDefaultSinkAbortAlgorithmCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsTransformStreamDefaultSinkAbortAlgorithmCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_transformStreamInternalsTransformStreamDefaultSinkAbortAlgorithmCodeLength =
        113;
static const JSC::Intrinsic
    s_transformStreamInternalsTransformStreamDefaultSinkAbortAlgorithmCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_transformStreamInternalsTransformStreamDefaultSinkAbortAlgorithmCode =
        "(function(stream, reason) {\n  return \"use strict\", "
        "@transformStreamError(stream, reason), @Promise.@resolve();\n})";

// transformStreamDefaultSinkCloseAlgorithm
const JSC::ConstructAbility
    s_transformStreamInternalsTransformStreamDefaultSinkCloseAlgorithmCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsTransformStreamDefaultSinkCloseAlgorithmCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsTransformStreamDefaultSinkCloseAlgorithmCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_transformStreamInternalsTransformStreamDefaultSinkCloseAlgorithmCodeLength =
        1181;
static const JSC::Intrinsic
    s_transformStreamInternalsTransformStreamDefaultSinkCloseAlgorithmCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_transformStreamInternalsTransformStreamDefaultSinkCloseAlgorithmCode =
        "(function(stream) {\n  \"use strict\";\n  const readable = "
        "@getByIdDirectPrivate(stream, \"readable\"), controller = "
        "@getByIdDirectPrivate(stream, \"controller\"), readableController = "
        "@getByIdDirectPrivate(readable, \"readableStreamController\"), "
        "flushAlgorithm = @getByIdDirectPrivate(controller, "
        "\"flushAlgorithm\");\n  @assert(flushAlgorithm !== @undefined);\n  "
        "const flushPromise = @getByIdDirectPrivate(controller, "
        "\"flushAlgorithm\").@call();\n  "
        "@transformStreamDefaultControllerClearAlgorithms(controller);\n  "
        "const promiseCapability = @newPromiseCapability(@Promise);\n  return "
        "flushPromise.@then(() => {\n    if (@getByIdDirectPrivate(readable, "
        "\"state\") === @streamErrored) {\n      "
        "promiseCapability.@reject.@call(@undefined, "
        "@getByIdDirectPrivate(readable, \"storedError\"));\n      return;\n   "
        " }\n    if "
        "(@readableStreamDefaultControllerCanCloseOrEnqueue(readableController)"
        ")\n      @readableStreamDefaultControllerClose(readableController);\n "
        "   promiseCapability.@resolve();\n  }, (r) => {\n    "
        "@transformStreamError(@getByIdDirectPrivate(controller, \"stream\"), "
        "r), promiseCapability.@reject.@call(@undefined, "
        "@getByIdDirectPrivate(readable, \"storedError\"));\n  }), "
        "promiseCapability.@promise;\n})";

// transformStreamDefaultSourcePullAlgorithm
const JSC::ConstructAbility
    s_transformStreamInternalsTransformStreamDefaultSourcePullAlgorithmCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_transformStreamInternalsTransformStreamDefaultSourcePullAlgorithmCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_transformStreamInternalsTransformStreamDefaultSourcePullAlgorithmCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_transformStreamInternalsTransformStreamDefaultSourcePullAlgorithmCodeLength =
        299;
static const JSC::Intrinsic
    s_transformStreamInternalsTransformStreamDefaultSourcePullAlgorithmCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_transformStreamInternalsTransformStreamDefaultSourcePullAlgorithmCode =
        "(function(stream) {\n  return \"use strict\", "
        "@assert(@getByIdDirectPrivate(stream, \"backpressure\")), "
        "@assert(@getByIdDirectPrivate(stream, \"backpressureChangePromise\") "
        "!== @undefined), @transformStreamSetBackpressure(stream, !1), "
        "@getByIdDirectPrivate(stream, "
        "\"backpressureChangePromise\").@promise;\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .transformStreamInternalsBuiltins()                                    \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .transformStreamInternalsBuiltins()                         \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_TRANSFORMSTREAMINTERNALS_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* WritableStreamDefaultController.ts */
// initializeWritableStreamDefaultController
const JSC::ConstructAbility
    s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCodeLength =
        435;
static const JSC::Intrinsic
    s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCode =
        "(function() {\n  return \"use strict\", @putByIdDirectPrivate(this, "
        "\"queue\", @newQueue()), @putByIdDirectPrivate(this, \"abortSteps\", "
        "(reason) => {\n    const result = @getByIdDirectPrivate(this, "
        "\"abortAlgorithm\").@call(@undefined, reason);\n    return "
        "@writableStreamDefaultControllerClearAlgorithms(this), result;\n  }), "
        "@putByIdDirectPrivate(this, \"errorSteps\", () => {\n    "
        "@resetQueue(@getByIdDirectPrivate(this, \"queue\"));\n  }), this;\n})";

// error
const JSC::ConstructAbility
    s_writableStreamDefaultControllerErrorCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamDefaultControllerErrorCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamDefaultControllerErrorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultControllerErrorCodeLength = 348;
static const JSC::Intrinsic
    s_writableStreamDefaultControllerErrorCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_writableStreamDefaultControllerErrorCode =
    "(function(e) {\n  if (\"use strict\", @getByIdDirectPrivate(this, "
    "\"abortSteps\") === @undefined)\n    throw "
    "@makeThisTypeError(\"WritableStreamDefaultController\", \"error\");\n  "
    "const stream = @getByIdDirectPrivate(this, \"stream\");\n  if "
    "(@getByIdDirectPrivate(stream, \"state\") !== \"writable\")\n    "
    "return;\n  @writableStreamDefaultControllerError(this, e);\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .writableStreamDefaultControllerBuiltins()                             \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .writableStreamDefaultControllerBuiltins()                  \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_WRITABLESTREAMDEFAULTCONTROLLER_BUILTIN_CODE(
    DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* WritableStreamDefaultWriter.ts */
// initializeWritableStreamDefaultWriter
const JSC::ConstructAbility
    s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCodeLength =
        335;
static const JSC::Intrinsic
    s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCode =
        "(function(stream) {\n  \"use strict\";\n  const internalStream = "
        "@getInternalWritableStream(stream);\n  if (internalStream)\n    "
        "stream = internalStream;\n  if (!@isWritableStream(stream))\n    "
        "@throwTypeError(\"WritableStreamDefaultWriter constructor takes a "
        "WritableStream\");\n  return @setUpWritableStreamDefaultWriter(this, "
        "stream), this;\n})";

// closed
const JSC::ConstructAbility
    s_writableStreamDefaultWriterClosedCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamDefaultWriterClosedCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamDefaultWriterClosedCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultWriterClosedCodeLength = 231;
static const JSC::Intrinsic s_writableStreamDefaultWriterClosedCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_writableStreamDefaultWriterClosedCode =
    "(function() {\n  if (\"use strict\", "
    "!@isWritableStreamDefaultWriter(this))\n    return "
    "@Promise.@reject(@makeGetterTypeError(\"WritableStreamDefaultWriter\", "
    "\"closed\"));\n  return @getByIdDirectPrivate(this, "
    "\"closedPromise\").@promise;\n})";

// desiredSize
const JSC::ConstructAbility
    s_writableStreamDefaultWriterDesiredSizeCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamDefaultWriterDesiredSizeCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamDefaultWriterDesiredSizeCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultWriterDesiredSizeCodeLength = 336;
static const JSC::Intrinsic
    s_writableStreamDefaultWriterDesiredSizeCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_writableStreamDefaultWriterDesiredSizeCode =
    "(function() {\n  if (\"use strict\", "
    "!@isWritableStreamDefaultWriter(this))\n    throw "
    "@makeThisTypeError(\"WritableStreamDefaultWriter\", \"desiredSize\");\n  "
    "if (@getByIdDirectPrivate(this, \"stream\") === @undefined)\n    "
    "@throwTypeError(\"WritableStreamDefaultWriter has no stream\");\n  return "
    "@writableStreamDefaultWriterGetDesiredSize(this);\n})";

// ready
const JSC::ConstructAbility
    s_writableStreamDefaultWriterReadyCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamDefaultWriterReadyCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamDefaultWriterReadyCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultWriterReadyCodeLength = 227;
static const JSC::Intrinsic s_writableStreamDefaultWriterReadyCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_writableStreamDefaultWriterReadyCode =
    "(function() {\n  if (\"use strict\", "
    "!@isWritableStreamDefaultWriter(this))\n    return "
    "@Promise.@reject(@makeThisTypeError(\"WritableStreamDefaultWriter\", "
    "\"ready\"));\n  return @getByIdDirectPrivate(this, "
    "\"readyPromise\").@promise;\n})";

// abort
const JSC::ConstructAbility
    s_writableStreamDefaultWriterAbortCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamDefaultWriterAbortCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamDefaultWriterAbortCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultWriterAbortCodeLength = 378;
static const JSC::Intrinsic s_writableStreamDefaultWriterAbortCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_writableStreamDefaultWriterAbortCode =
    "(function(reason) {\n  if (\"use strict\", "
    "!@isWritableStreamDefaultWriter(this))\n    return "
    "@Promise.@reject(@makeThisTypeError(\"WritableStreamDefaultWriter\", "
    "\"abort\"));\n  if (@getByIdDirectPrivate(this, \"stream\") === "
    "@undefined)\n    return "
    "@Promise.@reject(@makeTypeError(\"WritableStreamDefaultWriter has no "
    "stream\"));\n  return @writableStreamDefaultWriterAbort(this, "
    "reason);\n})";

// close
const JSC::ConstructAbility
    s_writableStreamDefaultWriterCloseCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamDefaultWriterCloseCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamDefaultWriterCloseCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultWriterCloseCodeLength = 533;
static const JSC::Intrinsic s_writableStreamDefaultWriterCloseCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_writableStreamDefaultWriterCloseCode =
    "(function() {\n  if (\"use strict\", "
    "!@isWritableStreamDefaultWriter(this))\n    return "
    "@Promise.@reject(@makeThisTypeError(\"WritableStreamDefaultWriter\", "
    "\"close\"));\n  const stream = @getByIdDirectPrivate(this, \"stream\");\n "
    " if (stream === @undefined)\n    return "
    "@Promise.@reject(@makeTypeError(\"WritableStreamDefaultWriter has no "
    "stream\"));\n  if (@writableStreamCloseQueuedOrInFlight(stream))\n    "
    "return @Promise.@reject(@makeTypeError(\"WritableStreamDefaultWriter is "
    "being closed\"));\n  return @writableStreamDefaultWriterClose(this);\n})";

// releaseLock
const JSC::ConstructAbility
    s_writableStreamDefaultWriterReleaseLockCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamDefaultWriterReleaseLockCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamDefaultWriterReleaseLockCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultWriterReleaseLockCodeLength = 358;
static const JSC::Intrinsic
    s_writableStreamDefaultWriterReleaseLockCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_writableStreamDefaultWriterReleaseLockCode =
    "(function() {\n  if (\"use strict\", "
    "!@isWritableStreamDefaultWriter(this))\n    throw "
    "@makeThisTypeError(\"WritableStreamDefaultWriter\", \"releaseLock\");\n  "
    "const stream = @getByIdDirectPrivate(this, \"stream\");\n  if (stream === "
    "@undefined)\n    return;\n  @assert(@getByIdDirectPrivate(stream, "
    "\"writer\") !== @undefined), "
    "@writableStreamDefaultWriterRelease(this);\n})";

// write
const JSC::ConstructAbility
    s_writableStreamDefaultWriterWriteCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamDefaultWriterWriteCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamDefaultWriterWriteCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultWriterWriteCodeLength = 376;
static const JSC::Intrinsic s_writableStreamDefaultWriterWriteCodeIntrinsic =
    JSC::NoIntrinsic;
const char *const s_writableStreamDefaultWriterWriteCode =
    "(function(chunk) {\n  if (\"use strict\", "
    "!@isWritableStreamDefaultWriter(this))\n    return "
    "@Promise.@reject(@makeThisTypeError(\"WritableStreamDefaultWriter\", "
    "\"write\"));\n  if (@getByIdDirectPrivate(this, \"stream\") === "
    "@undefined)\n    return "
    "@Promise.@reject(@makeTypeError(\"WritableStreamDefaultWriter has no "
    "stream\"));\n  return @writableStreamDefaultWriterWrite(this, chunk);\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .writableStreamDefaultWriterBuiltins()                                 \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .writableStreamDefaultWriterBuiltins()                      \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_WRITABLESTREAMDEFAULTWRITER_BUILTIN_CODE(
    DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* WritableStreamInternals.ts */
// isWritableStream
const JSC::ConstructAbility
    s_writableStreamInternalsIsWritableStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsIsWritableStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsIsWritableStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsIsWritableStreamCodeLength = 117;
static const JSC::Intrinsic
    s_writableStreamInternalsIsWritableStreamCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_writableStreamInternalsIsWritableStreamCode =
    "(function(stream) {\n  return \"use strict\", @isObject(stream) && "
    "!!@getByIdDirectPrivate(stream, \"underlyingSink\");\n})";

// isWritableStreamDefaultWriter
const JSC::ConstructAbility
    s_writableStreamInternalsIsWritableStreamDefaultWriterCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsIsWritableStreamDefaultWriterCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsIsWritableStreamDefaultWriterCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsIsWritableStreamDefaultWriterCodeLength =
    116;
static const JSC::Intrinsic
    s_writableStreamInternalsIsWritableStreamDefaultWriterCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_writableStreamInternalsIsWritableStreamDefaultWriterCode =
    "(function(writer) {\n  return \"use strict\", @isObject(writer) && "
    "!!@getByIdDirectPrivate(writer, \"closedPromise\");\n})";

// acquireWritableStreamDefaultWriter
const JSC::ConstructAbility
    s_writableStreamInternalsAcquireWritableStreamDefaultWriterCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsAcquireWritableStreamDefaultWriterCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsAcquireWritableStreamDefaultWriterCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsAcquireWritableStreamDefaultWriterCodeLength = 87;
static const JSC::Intrinsic
    s_writableStreamInternalsAcquireWritableStreamDefaultWriterCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_writableStreamInternalsAcquireWritableStreamDefaultWriterCode =
        "(function(stream) {\n  return \"use strict\", new "
        "@WritableStreamDefaultWriter(stream);\n})";

// createWritableStream
const JSC::ConstructAbility
    s_writableStreamInternalsCreateWritableStreamCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsCreateWritableStreamCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsCreateWritableStreamCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsCreateWritableStreamCodeLength = 579;
static const JSC::Intrinsic
    s_writableStreamInternalsCreateWritableStreamCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_writableStreamInternalsCreateWritableStreamCode =
    "(function(startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, "
    "highWaterMark, sizeAlgorithm) {\n  \"use strict\", @assert(typeof "
    "highWaterMark === \"number\" && !@isNaN(highWaterMark) && highWaterMark "
    ">= 0);\n  const internalStream = {};\n  "
    "@initializeWritableStreamSlots(internalStream, {});\n  const controller = "
    "new @WritableStreamDefaultController;\n  return "
    "@setUpWritableStreamDefaultController(internalStream, controller, "
    "startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, "
    "highWaterMark, sizeAlgorithm), "
    "@createWritableStreamFromInternal(internalStream);\n})";

// createInternalWritableStreamFromUnderlyingSink
const JSC::ConstructAbility
    s_writableStreamInternalsCreateInternalWritableStreamFromUnderlyingSinkCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsCreateInternalWritableStreamFromUnderlyingSinkCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsCreateInternalWritableStreamFromUnderlyingSinkCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsCreateInternalWritableStreamFromUnderlyingSinkCodeLength =
        1613;
static const JSC::Intrinsic
    s_writableStreamInternalsCreateInternalWritableStreamFromUnderlyingSinkCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsCreateInternalWritableStreamFromUnderlyingSinkCode =
        "(function(underlyingSink, strategy) {\n  \"use strict\";\n  const "
        "stream = {};\n  if (underlyingSink === @undefined)\n    "
        "underlyingSink = {};\n  if (strategy === @undefined)\n    strategy = "
        "{};\n  if (!@isObject(underlyingSink))\n    "
        "@throwTypeError(\"WritableStream constructor takes an object as first "
        "argument\");\n  if (\"type\" in underlyingSink)\n    "
        "@throwRangeError(\"Invalid type is specified\");\n  const "
        "sizeAlgorithm = @extractSizeAlgorithm(strategy), highWaterMark = "
        "@extractHighWaterMark(strategy, 1), underlyingSinkDict = {};\n  if "
        "(\"start\" in underlyingSink) {\n    if "
        "(underlyingSinkDict[\"start\"] = underlyingSink[\"start\"], typeof "
        "underlyingSinkDict[\"start\"] !== \"function\")\n      "
        "@throwTypeError(\"underlyingSink.start should be a function\");\n  "
        "}\n  if (\"write\" in underlyingSink) {\n    if "
        "(underlyingSinkDict[\"write\"] = underlyingSink[\"write\"], typeof "
        "underlyingSinkDict[\"write\"] !== \"function\")\n      "
        "@throwTypeError(\"underlyingSink.write should be a function\");\n  "
        "}\n  if (\"close\" in underlyingSink) {\n    if "
        "(underlyingSinkDict[\"close\"] = underlyingSink[\"close\"], typeof "
        "underlyingSinkDict[\"close\"] !== \"function\")\n      "
        "@throwTypeError(\"underlyingSink.close should be a function\");\n  "
        "}\n  if (\"abort\" in underlyingSink) {\n    if "
        "(underlyingSinkDict[\"abort\"] = underlyingSink[\"abort\"], typeof "
        "underlyingSinkDict[\"abort\"] !== \"function\")\n      "
        "@throwTypeError(\"underlyingSink.abort should be a function\");\n  "
        "}\n  return @initializeWritableStreamSlots(stream, underlyingSink), "
        "@setUpWritableStreamDefaultControllerFromUnderlyingSink(stream, "
        "underlyingSink, underlyingSinkDict, highWaterMark, sizeAlgorithm), "
        "stream;\n})";

// initializeWritableStreamSlots
const JSC::ConstructAbility
    s_writableStreamInternalsInitializeWritableStreamSlotsCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsInitializeWritableStreamSlotsCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsInitializeWritableStreamSlotsCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsInitializeWritableStreamSlotsCodeLength =
    712;
static const JSC::Intrinsic
    s_writableStreamInternalsInitializeWritableStreamSlotsCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_writableStreamInternalsInitializeWritableStreamSlotsCode =
    "(function(stream, underlyingSink) {\n  \"use strict\", "
    "@putByIdDirectPrivate(stream, \"state\", \"writable\"), "
    "@putByIdDirectPrivate(stream, \"storedError\", @undefined), "
    "@putByIdDirectPrivate(stream, \"writer\", @undefined), "
    "@putByIdDirectPrivate(stream, \"controller\", @undefined), "
    "@putByIdDirectPrivate(stream, \"inFlightWriteRequest\", @undefined), "
    "@putByIdDirectPrivate(stream, \"closeRequest\", @undefined), "
    "@putByIdDirectPrivate(stream, \"inFlightCloseRequest\", @undefined), "
    "@putByIdDirectPrivate(stream, \"pendingAbortRequest\", @undefined), "
    "@putByIdDirectPrivate(stream, \"writeRequests\", @createFIFO()), "
    "@putByIdDirectPrivate(stream, \"backpressure\", !1), "
    "@putByIdDirectPrivate(stream, \"underlyingSink\", underlyingSink);\n})";

// writableStreamCloseForBindings
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamCloseForBindingsCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamCloseForBindingsCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamCloseForBindingsCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamCloseForBindingsCodeLength =
    413;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamCloseForBindingsCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_writableStreamInternalsWritableStreamCloseForBindingsCode =
    "(function(stream) {\n  if (\"use strict\", "
    "@isWritableStreamLocked(stream))\n    return "
    "@Promise.@reject(@makeTypeError(\"WritableStream.close method can only be "
    "used on non locked WritableStream\"));\n  if "
    "(@writableStreamCloseQueuedOrInFlight(stream))\n    return "
    "@Promise.@reject(@makeTypeError(\"WritableStream.close method can only be "
    "used on a being close WritableStream\"));\n  return "
    "@writableStreamClose(stream);\n})";

// writableStreamAbortForBindings
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamAbortForBindingsCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamAbortForBindingsCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamAbortForBindingsCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamAbortForBindingsCodeLength =
    252;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamAbortForBindingsCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_writableStreamInternalsWritableStreamAbortForBindingsCode =
    "(function(stream, reason) {\n  if (\"use strict\", "
    "@isWritableStreamLocked(stream))\n    return "
    "@Promise.@reject(@makeTypeError(\"WritableStream.abort method can only be "
    "used on non locked WritableStream\"));\n  return "
    "@writableStreamAbort(stream, reason);\n})";

// isWritableStreamLocked
const JSC::ConstructAbility
    s_writableStreamInternalsIsWritableStreamLockedCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsIsWritableStreamLockedCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsIsWritableStreamLockedCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsIsWritableStreamLockedCodeLength = 101;
static const JSC::Intrinsic
    s_writableStreamInternalsIsWritableStreamLockedCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_writableStreamInternalsIsWritableStreamLockedCode =
    "(function(stream) {\n  return \"use strict\", "
    "@getByIdDirectPrivate(stream, \"writer\") !== @undefined;\n})";

// setUpWritableStreamDefaultWriter
const JSC::ConstructAbility
    s_writableStreamInternalsSetUpWritableStreamDefaultWriterCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsSetUpWritableStreamDefaultWriterCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsSetUpWritableStreamDefaultWriterCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsSetUpWritableStreamDefaultWriterCodeLength =
    1410;
static const JSC::Intrinsic
    s_writableStreamInternalsSetUpWritableStreamDefaultWriterCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_writableStreamInternalsSetUpWritableStreamDefaultWriterCode =
        "(function(writer, stream) {\n  if (\"use strict\", "
        "@isWritableStreamLocked(stream))\n    "
        "@throwTypeError(\"WritableStream is locked\");\n  "
        "@putByIdDirectPrivate(writer, \"stream\", stream), "
        "@putByIdDirectPrivate(stream, \"writer\", writer);\n  const "
        "readyPromiseCapability = @newPromiseCapability(@Promise), "
        "closedPromiseCapability = @newPromiseCapability(@Promise);\n  "
        "@putByIdDirectPrivate(writer, \"readyPromise\", "
        "readyPromiseCapability), @putByIdDirectPrivate(writer, "
        "\"closedPromise\", closedPromiseCapability);\n  const state = "
        "@getByIdDirectPrivate(stream, \"state\");\n  if (state === "
        "\"writable\") {\n    if (@writableStreamCloseQueuedOrInFlight(stream) "
        "|| !@getByIdDirectPrivate(stream, \"backpressure\"))\n      "
        "readyPromiseCapability.@resolve.@call();\n  } else if (state === "
        "\"erroring\")\n    readyPromiseCapability.@reject.@call(@undefined, "
        "@getByIdDirectPrivate(stream, \"storedError\")), "
        "@markPromiseAsHandled(readyPromiseCapability.@promise);\n  else if "
        "(state === \"closed\")\n    readyPromiseCapability.@resolve.@call(), "
        "closedPromiseCapability.@resolve.@call();\n  else {\n    "
        "@assert(state === \"errored\");\n    const storedError = "
        "@getByIdDirectPrivate(stream, \"storedError\");\n    "
        "readyPromiseCapability.@reject.@call(@undefined, storedError), "
        "@markPromiseAsHandled(readyPromiseCapability.@promise), "
        "closedPromiseCapability.@reject.@call(@undefined, storedError), "
        "@markPromiseAsHandled(closedPromiseCapability.@promise);\n  }\n})";

// writableStreamAbort
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamAbortCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamAbortCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamAbortCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamAbortCodeLength = 842;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamAbortCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_writableStreamInternalsWritableStreamAbortCode =
    "(function(stream, reason) {\n  \"use strict\";\n  const state = "
    "@getByIdDirectPrivate(stream, \"state\");\n  if (state === \"closed\" || "
    "state === \"errored\")\n    return @Promise.@resolve();\n  const "
    "pendingAbortRequest = @getByIdDirectPrivate(stream, "
    "\"pendingAbortRequest\");\n  if (pendingAbortRequest !== @undefined)\n    "
    "return pendingAbortRequest.promise.@promise;\n  @assert(state === "
    "\"writable\" || state === \"erroring\");\n  let wasAlreadyErroring = "
    "!1;\n  if (state === \"erroring\")\n    wasAlreadyErroring = !0, reason = "
    "@undefined;\n  const abortPromiseCapability = "
    "@newPromiseCapability(@Promise);\n  if (@putByIdDirectPrivate(stream, "
    "\"pendingAbortRequest\", {\n    promise: abortPromiseCapability,\n    "
    "reason,\n    wasAlreadyErroring\n  }), !wasAlreadyErroring)\n    "
    "@writableStreamStartErroring(stream, reason);\n  return "
    "abortPromiseCapability.@promise;\n})";

// writableStreamClose
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamCloseCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamCloseCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamCloseCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamCloseCodeLength = 854;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamCloseCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_writableStreamInternalsWritableStreamCloseCode =
    "(function(stream) {\n  \"use strict\";\n  const state = "
    "@getByIdDirectPrivate(stream, \"state\");\n  if (state === \"closed\" || "
    "state === \"errored\")\n    return "
    "@Promise.@reject(@makeTypeError(\"Cannot close a writable stream that is "
    "closed or errored\"));\n  @assert(state === \"writable\" || state === "
    "\"erroring\"), @assert(!@writableStreamCloseQueuedOrInFlight(stream));\n  "
    "const closePromiseCapability = @newPromiseCapability(@Promise);\n  "
    "@putByIdDirectPrivate(stream, \"closeRequest\", "
    "closePromiseCapability);\n  const writer = @getByIdDirectPrivate(stream, "
    "\"writer\");\n  if (writer !== @undefined && "
    "@getByIdDirectPrivate(stream, \"backpressure\") && state === "
    "\"writable\")\n    @getByIdDirectPrivate(writer, "
    "\"readyPromise\").@resolve.@call();\n  return "
    "@writableStreamDefaultControllerClose(@getByIdDirectPrivate(stream, "
    "\"controller\")), closePromiseCapability.@promise;\n})";

// writableStreamAddWriteRequest
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamAddWriteRequestCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamAddWriteRequestCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamAddWriteRequestCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamAddWriteRequestCodeLength =
    329;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamAddWriteRequestCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_writableStreamInternalsWritableStreamAddWriteRequestCode =
    "(function(stream) {\n  \"use strict\", "
    "@assert(@isWritableStreamLocked(stream)), "
    "@assert(@getByIdDirectPrivate(stream, \"state\") === \"writable\");\n  "
    "const writePromiseCapability = @newPromiseCapability(@Promise);\n  return "
    "@getByIdDirectPrivate(stream, "
    "\"writeRequests\").push(writePromiseCapability), "
    "writePromiseCapability.@promise;\n})";

// writableStreamCloseQueuedOrInFlight
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamCloseQueuedOrInFlightCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamCloseQueuedOrInFlightCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamCloseQueuedOrInFlightCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamCloseQueuedOrInFlightCodeLength =
        179;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamCloseQueuedOrInFlightCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_writableStreamInternalsWritableStreamCloseQueuedOrInFlightCode =
        "(function(stream) {\n  return \"use strict\", "
        "@getByIdDirectPrivate(stream, \"closeRequest\") !== @undefined || "
        "@getByIdDirectPrivate(stream, \"inFlightCloseRequest\") !== "
        "@undefined;\n})";

// writableStreamDealWithRejection
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDealWithRejectionCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDealWithRejectionCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDealWithRejectionCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDealWithRejectionCodeLength =
    268;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDealWithRejectionCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_writableStreamInternalsWritableStreamDealWithRejectionCode =
    "(function(stream, error) {\n  \"use strict\";\n  const state = "
    "@getByIdDirectPrivate(stream, \"state\");\n  if (state === \"writable\") "
    "{\n    @writableStreamStartErroring(stream, error);\n    return;\n  }\n  "
    "@assert(state === \"erroring\"), "
    "@writableStreamFinishErroring(stream);\n})";

// writableStreamFinishErroring
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamFinishErroringCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamFinishErroringCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamFinishErroringCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamFinishErroringCodeLength =
    1451;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamFinishErroringCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_writableStreamInternalsWritableStreamFinishErroringCode =
    "(function(stream) {\n  \"use strict\", "
    "@assert(@getByIdDirectPrivate(stream, \"state\") === \"erroring\"), "
    "@assert(!@writableStreamHasOperationMarkedInFlight(stream)), "
    "@putByIdDirectPrivate(stream, \"state\", \"errored\");\n  const "
    "controller = @getByIdDirectPrivate(stream, \"controller\");\n  "
    "@getByIdDirectPrivate(controller, \"errorSteps\").@call();\n  const "
    "storedError = @getByIdDirectPrivate(stream, \"storedError\"), requests = "
    "@getByIdDirectPrivate(stream, \"writeRequests\");\n  for (var request = "
    "requests.shift();request; request = requests.shift())\n    "
    "request.@reject.@call(@undefined, storedError);\n  "
    "@putByIdDirectPrivate(stream, \"writeRequests\", @createFIFO());\n  const "
    "abortRequest = @getByIdDirectPrivate(stream, \"pendingAbortRequest\");\n  "
    "if (abortRequest === @undefined) {\n    "
    "@writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);\n    "
    "return;\n  }\n  if (@putByIdDirectPrivate(stream, "
    "\"pendingAbortRequest\", @undefined), abortRequest.wasAlreadyErroring) "
    "{\n    abortRequest.promise.@reject.@call(@undefined, storedError), "
    "@writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);\n    "
    "return;\n  }\n  @getByIdDirectPrivate(controller, "
    "\"abortSteps\").@call(@undefined, abortRequest.reason).@then(() => {\n    "
    "abortRequest.promise.@resolve.@call(), "
    "@writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);\n  }, "
    "(reason) => {\n    abortRequest.promise.@reject.@call(@undefined, "
    "reason), @writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);\n  "
    "});\n})";

// writableStreamFinishInFlightClose
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamFinishInFlightCloseCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamFinishInFlightCloseCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamFinishInFlightCloseCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamFinishInFlightCloseCodeLength =
    969;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamFinishInFlightCloseCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_writableStreamInternalsWritableStreamFinishInFlightCloseCode =
        "(function(stream) {\n  \"use strict\", @getByIdDirectPrivate(stream, "
        "\"inFlightCloseRequest\").@resolve.@call(), "
        "@putByIdDirectPrivate(stream, \"inFlightCloseRequest\", "
        "@undefined);\n  const state = @getByIdDirectPrivate(stream, "
        "\"state\");\n  if (@assert(state === \"writable\" || state === "
        "\"erroring\"), state === \"erroring\") {\n    "
        "@putByIdDirectPrivate(stream, \"storedError\", @undefined);\n    "
        "const abortRequest = @getByIdDirectPrivate(stream, "
        "\"pendingAbortRequest\");\n    if (abortRequest !== @undefined)\n     "
        " abortRequest.promise.@resolve.@call(), @putByIdDirectPrivate(stream, "
        "\"pendingAbortRequest\", @undefined);\n  }\n  "
        "@putByIdDirectPrivate(stream, \"state\", \"closed\");\n  const writer "
        "= @getByIdDirectPrivate(stream, \"writer\");\n  if (writer !== "
        "@undefined)\n    @getByIdDirectPrivate(writer, "
        "\"closedPromise\").@resolve.@call();\n  "
        "@assert(@getByIdDirectPrivate(stream, \"pendingAbortRequest\") === "
        "@undefined), @assert(@getByIdDirectPrivate(stream, \"storedError\") "
        "=== @undefined);\n})";

// writableStreamFinishInFlightCloseWithError
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamFinishInFlightCloseWithErrorCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamFinishInFlightCloseWithErrorCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamFinishInFlightCloseWithErrorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamFinishInFlightCloseWithErrorCodeLength =
        702;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamFinishInFlightCloseWithErrorCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsWritableStreamFinishInFlightCloseWithErrorCode =
        "(function(stream, error) {\n  \"use strict\";\n  const "
        "inFlightCloseRequest = @getByIdDirectPrivate(stream, "
        "\"inFlightCloseRequest\");\n  @assert(inFlightCloseRequest !== "
        "@undefined), inFlightCloseRequest.@reject.@call(@undefined, error), "
        "@putByIdDirectPrivate(stream, \"inFlightCloseRequest\", "
        "@undefined);\n  const state = @getByIdDirectPrivate(stream, "
        "\"state\");\n  @assert(state === \"writable\" || state === "
        "\"erroring\");\n  const abortRequest = @getByIdDirectPrivate(stream, "
        "\"pendingAbortRequest\");\n  if (abortRequest !== @undefined)\n    "
        "abortRequest.promise.@reject.@call(@undefined, error), "
        "@putByIdDirectPrivate(stream, \"pendingAbortRequest\", @undefined);\n "
        " @writableStreamDealWithRejection(stream, error);\n})";

// writableStreamFinishInFlightWrite
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamFinishInFlightWriteCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamFinishInFlightWriteCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamFinishInFlightWriteCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamFinishInFlightWriteCodeLength =
    278;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamFinishInFlightWriteCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_writableStreamInternalsWritableStreamFinishInFlightWriteCode =
        "(function(stream) {\n  \"use strict\";\n  const inFlightWriteRequest "
        "= @getByIdDirectPrivate(stream, \"inFlightWriteRequest\");\n  "
        "@assert(inFlightWriteRequest !== @undefined), "
        "inFlightWriteRequest.@resolve.@call(), @putByIdDirectPrivate(stream, "
        "\"inFlightWriteRequest\", @undefined);\n})";

// writableStreamFinishInFlightWriteWithError
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamFinishInFlightWriteWithErrorCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamFinishInFlightWriteWithErrorCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamFinishInFlightWriteWithErrorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamFinishInFlightWriteWithErrorCodeLength =
        463;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamFinishInFlightWriteWithErrorCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsWritableStreamFinishInFlightWriteWithErrorCode =
        "(function(stream, error) {\n  \"use strict\";\n  const "
        "inFlightWriteRequest = @getByIdDirectPrivate(stream, "
        "\"inFlightWriteRequest\");\n  @assert(inFlightWriteRequest !== "
        "@undefined), inFlightWriteRequest.@reject.@call(@undefined, error), "
        "@putByIdDirectPrivate(stream, \"inFlightWriteRequest\", "
        "@undefined);\n  const state = @getByIdDirectPrivate(stream, "
        "\"state\");\n  @assert(state === \"writable\" || state === "
        "\"erroring\"), @writableStreamDealWithRejection(stream, error);\n})";

// writableStreamHasOperationMarkedInFlight
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamHasOperationMarkedInFlightCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamHasOperationMarkedInFlightCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamHasOperationMarkedInFlightCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamHasOperationMarkedInFlightCodeLength =
        187;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamHasOperationMarkedInFlightCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsWritableStreamHasOperationMarkedInFlightCode =
        "(function(stream) {\n  return \"use strict\", "
        "@getByIdDirectPrivate(stream, \"inFlightWriteRequest\") !== "
        "@undefined || @getByIdDirectPrivate(stream, \"inFlightCloseRequest\") "
        "!== @undefined;\n})";

// writableStreamMarkCloseRequestInFlight
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamMarkCloseRequestInFlightCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamMarkCloseRequestInFlightCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamMarkCloseRequestInFlightCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamMarkCloseRequestInFlightCodeLength =
        355;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamMarkCloseRequestInFlightCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_writableStreamInternalsWritableStreamMarkCloseRequestInFlightCode =
        "(function(stream) {\n  \"use strict\";\n  const closeRequest = "
        "@getByIdDirectPrivate(stream, \"closeRequest\");\n  "
        "@assert(@getByIdDirectPrivate(stream, \"inFlightCloseRequest\") === "
        "@undefined), @assert(closeRequest !== @undefined), "
        "@putByIdDirectPrivate(stream, \"inFlightCloseRequest\", "
        "closeRequest), @putByIdDirectPrivate(stream, \"closeRequest\", "
        "@undefined);\n})";

// writableStreamMarkFirstWriteRequestInFlight
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamMarkFirstWriteRequestInFlightCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamMarkFirstWriteRequestInFlightCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamMarkFirstWriteRequestInFlightCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamMarkFirstWriteRequestInFlightCodeLength =
        345;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamMarkFirstWriteRequestInFlightCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsWritableStreamMarkFirstWriteRequestInFlightCode =
        "(function(stream) {\n  \"use strict\";\n  const writeRequests = "
        "@getByIdDirectPrivate(stream, \"writeRequests\");\n  "
        "@assert(@getByIdDirectPrivate(stream, \"inFlightWriteRequest\") === "
        "@undefined), @assert(writeRequests.isNotEmpty());\n  const "
        "writeRequest = writeRequests.shift();\n  "
        "@putByIdDirectPrivate(stream, \"inFlightWriteRequest\", "
        "writeRequest);\n})";

// writableStreamRejectCloseAndClosedPromiseIfNeeded
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamRejectCloseAndClosedPromiseIfNeededCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamRejectCloseAndClosedPromiseIfNeededCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamRejectCloseAndClosedPromiseIfNeededCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamRejectCloseAndClosedPromiseIfNeededCodeLength =
        733;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamRejectCloseAndClosedPromiseIfNeededCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsWritableStreamRejectCloseAndClosedPromiseIfNeededCode =
        "(function(stream) {\n  \"use strict\", "
        "@assert(@getByIdDirectPrivate(stream, \"state\") === \"errored\");\n  "
        "const storedError = @getByIdDirectPrivate(stream, \"storedError\"), "
        "closeRequest = @getByIdDirectPrivate(stream, \"closeRequest\");\n  if "
        "(closeRequest !== @undefined)\n    "
        "@assert(@getByIdDirectPrivate(stream, \"inFlightCloseRequest\") === "
        "@undefined), closeRequest.@reject.@call(@undefined, storedError), "
        "@putByIdDirectPrivate(stream, \"closeRequest\", @undefined);\n  const "
        "writer = @getByIdDirectPrivate(stream, \"writer\");\n  if (writer !== "
        "@undefined) {\n    const closedPromise = "
        "@getByIdDirectPrivate(writer, \"closedPromise\");\n    "
        "closedPromise.@reject.@call(@undefined, storedError), "
        "@markPromiseAsHandled(closedPromise.@promise);\n  }\n})";

// writableStreamStartErroring
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamStartErroringCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamStartErroringCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamStartErroringCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamStartErroringCodeLength = 708;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamStartErroringCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const s_writableStreamInternalsWritableStreamStartErroringCode =
    "(function(stream, reason) {\n  \"use strict\", "
    "@assert(@getByIdDirectPrivate(stream, \"storedError\") === @undefined), "
    "@assert(@getByIdDirectPrivate(stream, \"state\") === \"writable\");\n  "
    "const controller = @getByIdDirectPrivate(stream, \"controller\");\n  "
    "@assert(controller !== @undefined), @putByIdDirectPrivate(stream, "
    "\"state\", \"erroring\"), @putByIdDirectPrivate(stream, \"storedError\", "
    "reason);\n  const writer = @getByIdDirectPrivate(stream, \"writer\");\n  "
    "if (writer !== @undefined)\n    "
    "@writableStreamDefaultWriterEnsureReadyPromiseRejected(writer, reason);\n "
    " if (!@writableStreamHasOperationMarkedInFlight(stream) && "
    "@getByIdDirectPrivate(controller, \"started\") === 1)\n    "
    "@writableStreamFinishErroring(stream);\n})";

// writableStreamUpdateBackpressure
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamUpdateBackpressureCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamUpdateBackpressureCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamUpdateBackpressureCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamUpdateBackpressureCodeLength =
    575;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamUpdateBackpressureCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_writableStreamInternalsWritableStreamUpdateBackpressureCode =
        "(function(stream, backpressure) {\n  \"use strict\", "
        "@assert(@getByIdDirectPrivate(stream, \"state\") === \"writable\"), "
        "@assert(!@writableStreamCloseQueuedOrInFlight(stream));\n  const "
        "writer = @getByIdDirectPrivate(stream, \"writer\");\n  if (writer !== "
        "@undefined && backpressure !== @getByIdDirectPrivate(stream, "
        "\"backpressure\"))\n    if (backpressure)\n      "
        "@putByIdDirectPrivate(writer, \"readyPromise\", "
        "@newPromiseCapability(@Promise));\n    else\n      "
        "@getByIdDirectPrivate(writer, \"readyPromise\").@resolve.@call();\n  "
        "@putByIdDirectPrivate(stream, \"backpressure\", backpressure);\n})";

// writableStreamDefaultWriterAbort
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultWriterAbortCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultWriterAbortCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultWriterAbortCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultWriterAbortCodeLength =
    183;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultWriterAbortCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_writableStreamInternalsWritableStreamDefaultWriterAbortCode =
        "(function(writer, reason) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(writer, \"stream\");\n  return @assert(stream "
        "!== @undefined), @writableStreamAbort(stream, reason);\n})";

// writableStreamDefaultWriterClose
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultWriterCloseCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultWriterCloseCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultWriterCloseCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultWriterCloseCodeLength =
    167;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultWriterCloseCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_writableStreamInternalsWritableStreamDefaultWriterCloseCode =
        "(function(writer) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(writer, \"stream\");\n  return @assert(stream "
        "!== @undefined), @writableStreamClose(stream);\n})";

// writableStreamDefaultWriterCloseWithErrorPropagation
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultWriterCloseWithErrorPropagationCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultWriterCloseWithErrorPropagationCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultWriterCloseWithErrorPropagationCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamDefaultWriterCloseWithErrorPropagationCodeLength =
        501;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultWriterCloseWithErrorPropagationCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsWritableStreamDefaultWriterCloseWithErrorPropagationCode =
        "(function(writer) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(writer, \"stream\");\n  @assert(stream !== "
        "@undefined);\n  const state = @getByIdDirectPrivate(stream, "
        "\"state\");\n  if (@writableStreamCloseQueuedOrInFlight(stream) || "
        "state === \"closed\")\n    return @Promise.@resolve();\n  if (state "
        "=== \"errored\")\n    return "
        "@Promise.@reject(@getByIdDirectPrivate(stream, \"storedError\"));\n  "
        "return @assert(state === \"writable\" || state === \"erroring\"), "
        "@writableStreamDefaultWriterClose(writer);\n})";

// writableStreamDefaultWriterEnsureClosedPromiseRejected
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultWriterEnsureClosedPromiseRejectedCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultWriterEnsureClosedPromiseRejectedCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultWriterEnsureClosedPromiseRejectedCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamDefaultWriterEnsureClosedPromiseRejectedCodeLength =
        573;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultWriterEnsureClosedPromiseRejectedCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsWritableStreamDefaultWriterEnsureClosedPromiseRejectedCode =
        "(function(writer, error) {\n  \"use strict\";\n  let "
        "closedPromiseCapability = @getByIdDirectPrivate(writer, "
        "\"closedPromise\"), closedPromise = "
        "closedPromiseCapability.@promise;\n  if "
        "((@getPromiseInternalField(closedPromise, @promiseFieldFlags) & "
        "@promiseStateMask) !== @promiseStatePending)\n    "
        "closedPromiseCapability = @newPromiseCapability(@Promise), "
        "closedPromise = closedPromiseCapability.@promise, "
        "@putByIdDirectPrivate(writer, \"closedPromise\", "
        "closedPromiseCapability);\n  "
        "closedPromiseCapability.@reject.@call(@undefined, error), "
        "@markPromiseAsHandled(closedPromise);\n})";

// writableStreamDefaultWriterEnsureReadyPromiseRejected
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultWriterEnsureReadyPromiseRejectedCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultWriterEnsureReadyPromiseRejectedCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultWriterEnsureReadyPromiseRejectedCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamDefaultWriterEnsureReadyPromiseRejectedCodeLength =
        561;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultWriterEnsureReadyPromiseRejectedCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsWritableStreamDefaultWriterEnsureReadyPromiseRejectedCode =
        "(function(writer, error) {\n  \"use strict\";\n  let "
        "readyPromiseCapability = @getByIdDirectPrivate(writer, "
        "\"readyPromise\"), readyPromise = readyPromiseCapability.@promise;\n  "
        "if ((@getPromiseInternalField(readyPromise, @promiseFieldFlags) & "
        "@promiseStateMask) !== @promiseStatePending)\n    "
        "readyPromiseCapability = @newPromiseCapability(@Promise), "
        "readyPromise = readyPromiseCapability.@promise, "
        "@putByIdDirectPrivate(writer, \"readyPromise\", "
        "readyPromiseCapability);\n  "
        "readyPromiseCapability.@reject.@call(@undefined, error), "
        "@markPromiseAsHandled(readyPromise);\n})";

// writableStreamDefaultWriterGetDesiredSize
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultWriterGetDesiredSizeCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultWriterGetDesiredSizeCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultWriterGetDesiredSizeCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamDefaultWriterGetDesiredSizeCodeLength =
        396;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultWriterGetDesiredSizeCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsWritableStreamDefaultWriterGetDesiredSizeCode =
        "(function(writer) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(writer, \"stream\");\n  @assert(stream !== "
        "@undefined);\n  const state = @getByIdDirectPrivate(stream, "
        "\"state\");\n  if (state === \"errored\" || state === \"erroring\")\n "
        "   return null;\n  if (state === \"closed\")\n    return 0;\n  return "
        "@writableStreamDefaultControllerGetDesiredSize(@getByIdDirectPrivate("
        "stream, \"controller\"));\n})";

// writableStreamDefaultWriterRelease
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultWriterReleaseCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultWriterReleaseCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultWriterReleaseCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamDefaultWriterReleaseCodeLength = 536;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultWriterReleaseCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_writableStreamInternalsWritableStreamDefaultWriterReleaseCode =
        "(function(writer) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(writer, \"stream\");\n  @assert(stream !== "
        "@undefined), @assert(@getByIdDirectPrivate(stream, \"writer\") === "
        "writer);\n  const releasedError = "
        "@makeTypeError(\"writableStreamDefaultWriterRelease\");\n  "
        "@writableStreamDefaultWriterEnsureReadyPromiseRejected(writer, "
        "releasedError), "
        "@writableStreamDefaultWriterEnsureClosedPromiseRejected(writer, "
        "releasedError), @putByIdDirectPrivate(stream, \"writer\", "
        "@undefined), @putByIdDirectPrivate(writer, \"stream\", "
        "@undefined);\n})";

// writableStreamDefaultWriterWrite
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultWriterWriteCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultWriterWriteCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultWriterWriteCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultWriterWriteCodeLength =
    1201;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultWriterWriteCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_writableStreamInternalsWritableStreamDefaultWriterWriteCode =
        "(function(writer, chunk) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(writer, \"stream\");\n  @assert(stream !== "
        "@undefined);\n  const controller = @getByIdDirectPrivate(stream, "
        "\"controller\");\n  @assert(controller !== @undefined);\n  const "
        "chunkSize = @writableStreamDefaultControllerGetChunkSize(controller, "
        "chunk);\n  if (stream !== @getByIdDirectPrivate(writer, "
        "\"stream\"))\n    return @Promise.@reject(@makeTypeError(\"writer is "
        "not stream's writer\"));\n  const state = "
        "@getByIdDirectPrivate(stream, \"state\");\n  if (state === "
        "\"errored\")\n    return "
        "@Promise.@reject(@getByIdDirectPrivate(stream, \"storedError\"));\n  "
        "if (@writableStreamCloseQueuedOrInFlight(stream) || state === "
        "\"closed\")\n    return @Promise.@reject(@makeTypeError(\"stream is "
        "closing or closed\"));\n  if "
        "(@writableStreamCloseQueuedOrInFlight(stream) || state === "
        "\"closed\")\n    return @Promise.@reject(@makeTypeError(\"stream is "
        "closing or closed\"));\n  if (state === \"erroring\")\n    return "
        "@Promise.@reject(@getByIdDirectPrivate(stream, \"storedError\"));\n  "
        "@assert(state === \"writable\");\n  const promise = "
        "@writableStreamAddWriteRequest(stream);\n  return "
        "@writableStreamDefaultControllerWrite(controller, chunk, chunkSize), "
        "promise;\n})";

// setUpWritableStreamDefaultController
const JSC::ConstructAbility
    s_writableStreamInternalsSetUpWritableStreamDefaultControllerCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsSetUpWritableStreamDefaultControllerCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsSetUpWritableStreamDefaultControllerCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsSetUpWritableStreamDefaultControllerCodeLength =
        1076;
static const JSC::Intrinsic
    s_writableStreamInternalsSetUpWritableStreamDefaultControllerCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_writableStreamInternalsSetUpWritableStreamDefaultControllerCode =
        "(function(stream, controller, startAlgorithm, writeAlgorithm, "
        "closeAlgorithm, abortAlgorithm, highWaterMark, sizeAlgorithm) {\n  "
        "\"use strict\", @assert(@isWritableStream(stream)), "
        "@assert(@getByIdDirectPrivate(stream, \"controller\") === "
        "@undefined), @putByIdDirectPrivate(controller, \"stream\", stream), "
        "@putByIdDirectPrivate(stream, \"controller\", controller), "
        "@resetQueue(@getByIdDirectPrivate(controller, \"queue\")), "
        "@putByIdDirectPrivate(controller, \"started\", -1), "
        "@putByIdDirectPrivate(controller, \"startAlgorithm\", "
        "startAlgorithm), @putByIdDirectPrivate(controller, "
        "\"strategySizeAlgorithm\", sizeAlgorithm), "
        "@putByIdDirectPrivate(controller, \"strategyHWM\", highWaterMark), "
        "@putByIdDirectPrivate(controller, \"writeAlgorithm\", "
        "writeAlgorithm), @putByIdDirectPrivate(controller, "
        "\"closeAlgorithm\", closeAlgorithm), "
        "@putByIdDirectPrivate(controller, \"abortAlgorithm\", "
        "abortAlgorithm);\n  const backpressure = "
        "@writableStreamDefaultControllerGetBackpressure(controller);\n  "
        "@writableStreamUpdateBackpressure(stream, backpressure), "
        "@writableStreamDefaultControllerStart(controller);\n})";

// writableStreamDefaultControllerStart
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultControllerStartCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultControllerStartCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultControllerStartCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamDefaultControllerStartCodeLength =
        905;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultControllerStartCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_writableStreamInternalsWritableStreamDefaultControllerStartCode =
        "(function(controller) {\n  if (\"use strict\", "
        "@getByIdDirectPrivate(controller, \"started\") !== -1)\n    return;\n "
        " @putByIdDirectPrivate(controller, \"started\", 0);\n  const "
        "startAlgorithm = @getByIdDirectPrivate(controller, "
        "\"startAlgorithm\");\n  @putByIdDirectPrivate(controller, "
        "\"startAlgorithm\", @undefined);\n  const stream = "
        "@getByIdDirectPrivate(controller, \"stream\");\n  return "
        "@Promise.@resolve(startAlgorithm.@call()).@then(() => {\n    const "
        "state = @getByIdDirectPrivate(stream, \"state\");\n    @assert(state "
        "=== \"writable\" || state === \"erroring\"), "
        "@putByIdDirectPrivate(controller, \"started\", 1), "
        "@writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);\n  "
        "}, (error) => {\n    const state = @getByIdDirectPrivate(stream, "
        "\"state\");\n    @assert(state === \"writable\" || state === "
        "\"erroring\"), @putByIdDirectPrivate(controller, \"started\", 1), "
        "@writableStreamDealWithRejection(stream, error);\n  });\n})";

// setUpWritableStreamDefaultControllerFromUnderlyingSink
const JSC::ConstructAbility
    s_writableStreamInternalsSetUpWritableStreamDefaultControllerFromUnderlyingSinkCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsSetUpWritableStreamDefaultControllerFromUnderlyingSinkCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsSetUpWritableStreamDefaultControllerFromUnderlyingSinkCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsSetUpWritableStreamDefaultControllerFromUnderlyingSinkCodeLength =
        1327;
static const JSC::Intrinsic
    s_writableStreamInternalsSetUpWritableStreamDefaultControllerFromUnderlyingSinkCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsSetUpWritableStreamDefaultControllerFromUnderlyingSinkCode =
        "(function(stream, underlyingSink, underlyingSinkDict, highWaterMark, "
        "sizeAlgorithm) {\n  \"use strict\";\n  const controller = new "
        "@WritableStreamDefaultController;\n  let startAlgorithm = () => {\n  "
        "}, writeAlgorithm = () => {\n    return @Promise.@resolve();\n  }, "
        "closeAlgorithm = () => {\n    return @Promise.@resolve();\n  }, "
        "abortAlgorithm = () => {\n    return @Promise.@resolve();\n  };\n  if "
        "(\"start\" in underlyingSinkDict) {\n    const startMethod = "
        "underlyingSinkDict[\"start\"];\n    startAlgorithm = () => "
        "@promiseInvokeOrNoopMethodNoCatch(underlyingSink, startMethod, "
        "[controller]);\n  }\n  if (\"write\" in underlyingSinkDict) {\n    "
        "const writeMethod = underlyingSinkDict[\"write\"];\n    "
        "writeAlgorithm = (chunk) => "
        "@promiseInvokeOrNoopMethod(underlyingSink, writeMethod, [chunk, "
        "controller]);\n  }\n  if (\"close\" in underlyingSinkDict) {\n    "
        "const closeMethod = underlyingSinkDict[\"close\"];\n    "
        "closeAlgorithm = () => @promiseInvokeOrNoopMethod(underlyingSink, "
        "closeMethod, []);\n  }\n  if (\"abort\" in underlyingSinkDict) {\n    "
        "const abortMethod = underlyingSinkDict[\"abort\"];\n    "
        "abortAlgorithm = (reason) => "
        "@promiseInvokeOrNoopMethod(underlyingSink, abortMethod, [reason]);\n  "
        "}\n  @setUpWritableStreamDefaultController(stream, controller, "
        "startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, "
        "highWaterMark, sizeAlgorithm);\n})";

// writableStreamDefaultControllerAdvanceQueueIfNeeded
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultControllerAdvanceQueueIfNeededCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultControllerAdvanceQueueIfNeededCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultControllerAdvanceQueueIfNeededCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamDefaultControllerAdvanceQueueIfNeededCodeLength =
        813;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultControllerAdvanceQueueIfNeededCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsWritableStreamDefaultControllerAdvanceQueueIfNeededCode =
        "(function(controller) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(controller, \"stream\");\n  if "
        "(@getByIdDirectPrivate(controller, \"started\") !== 1)\n    return;\n "
        " if (@assert(stream !== @undefined), @getByIdDirectPrivate(stream, "
        "\"inFlightWriteRequest\") !== @undefined)\n    return;\n  const state "
        "= @getByIdDirectPrivate(stream, \"state\");\n  if (@assert(state !== "
        "\"closed\" || state !== \"errored\"), state === \"erroring\") {\n    "
        "@writableStreamFinishErroring(stream);\n    return;\n  }\n  const "
        "queue = @getByIdDirectPrivate(controller, \"queue\");\n  if "
        "(queue.content\?.isEmpty() \?\? !1)\n    return;\n  const value = "
        "@peekQueueValue(queue);\n  if (value === @isCloseSentinel)\n    "
        "@writableStreamDefaultControllerProcessClose(controller);\n  else\n   "
        " @writableStreamDefaultControllerProcessWrite(controller, value);\n})";

// isCloseSentinel
const JSC::ConstructAbility
    s_writableStreamInternalsIsCloseSentinelCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsIsCloseSentinelCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsIsCloseSentinelCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsIsCloseSentinelCodeLength = 32;
static const JSC::Intrinsic
    s_writableStreamInternalsIsCloseSentinelCodeIntrinsic = JSC::NoIntrinsic;
const char *const s_writableStreamInternalsIsCloseSentinelCode =
    "(function() {\n  \"use strict\";\n})";

// writableStreamDefaultControllerClearAlgorithms
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultControllerClearAlgorithmsCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultControllerClearAlgorithmsCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultControllerClearAlgorithmsCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamDefaultControllerClearAlgorithmsCodeLength =
        309;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultControllerClearAlgorithmsCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsWritableStreamDefaultControllerClearAlgorithmsCode =
        "(function(controller) {\n  \"use strict\", "
        "@putByIdDirectPrivate(controller, \"writeAlgorithm\", @undefined), "
        "@putByIdDirectPrivate(controller, \"closeAlgorithm\", @undefined), "
        "@putByIdDirectPrivate(controller, \"abortAlgorithm\", @undefined), "
        "@putByIdDirectPrivate(controller, \"strategySizeAlgorithm\", "
        "@undefined);\n})";

// writableStreamDefaultControllerClose
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultControllerCloseCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultControllerCloseCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultControllerCloseCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamDefaultControllerCloseCodeLength =
        196;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultControllerCloseCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_writableStreamInternalsWritableStreamDefaultControllerCloseCode =
        "(function(controller) {\n  \"use strict\", "
        "@enqueueValueWithSize(@getByIdDirectPrivate(controller, \"queue\"), "
        "@isCloseSentinel, 0), "
        "@writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);\n})";

// writableStreamDefaultControllerError
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultControllerErrorCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultControllerErrorCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultControllerErrorCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamDefaultControllerErrorCodeLength =
        315;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultControllerErrorCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_writableStreamInternalsWritableStreamDefaultControllerErrorCode =
        "(function(controller, error) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(controller, \"stream\");\n  @assert(stream !== "
        "@undefined), @assert(@getByIdDirectPrivate(stream, \"state\") === "
        "\"writable\"), "
        "@writableStreamDefaultControllerClearAlgorithms(controller), "
        "@writableStreamStartErroring(stream, error);\n})";

// writableStreamDefaultControllerErrorIfNeeded
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultControllerErrorIfNeededCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultControllerErrorIfNeededCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultControllerErrorIfNeededCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamDefaultControllerErrorIfNeededCodeLength =
        234;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultControllerErrorIfNeededCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsWritableStreamDefaultControllerErrorIfNeededCode =
        "(function(controller, error) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(controller, \"stream\");\n  if "
        "(@getByIdDirectPrivate(stream, \"state\") === \"writable\")\n    "
        "@writableStreamDefaultControllerError(controller, error);\n})";

// writableStreamDefaultControllerGetBackpressure
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultControllerGetBackpressureCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultControllerGetBackpressureCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultControllerGetBackpressureCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamDefaultControllerGetBackpressureCodeLength =
        114;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultControllerGetBackpressureCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsWritableStreamDefaultControllerGetBackpressureCode =
        "(function(controller) {\n  return \"use strict\", "
        "@writableStreamDefaultControllerGetDesiredSize(controller) <= 0;\n})";

// writableStreamDefaultControllerGetChunkSize
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultControllerGetChunkSizeCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultControllerGetChunkSizeCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultControllerGetChunkSizeCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamDefaultControllerGetChunkSizeCodeLength =
        249;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultControllerGetChunkSizeCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsWritableStreamDefaultControllerGetChunkSizeCode =
        "(function(controller, chunk) {\n  \"use strict\";\n  try {\n    "
        "return @getByIdDirectPrivate(controller, "
        "\"strategySizeAlgorithm\").@call(@undefined, chunk);\n  } catch (e) "
        "{\n    return "
        "@writableStreamDefaultControllerErrorIfNeeded(controller, e), 1;\n  "
        "}\n})";

// writableStreamDefaultControllerGetDesiredSize
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultControllerGetDesiredSizeCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultControllerGetDesiredSizeCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultControllerGetDesiredSizeCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamDefaultControllerGetDesiredSizeCodeLength =
        149;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultControllerGetDesiredSizeCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsWritableStreamDefaultControllerGetDesiredSizeCode =
        "(function(controller) {\n  return \"use strict\", "
        "@getByIdDirectPrivate(controller, \"strategyHWM\") - "
        "@getByIdDirectPrivate(controller, \"queue\").size;\n})";

// writableStreamDefaultControllerProcessClose
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultControllerProcessCloseCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultControllerProcessCloseCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultControllerProcessCloseCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamDefaultControllerProcessCloseCodeLength =
        606;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultControllerProcessCloseCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsWritableStreamDefaultControllerProcessCloseCode =
        "(function(controller) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(controller, \"stream\");\n  "
        "@writableStreamMarkCloseRequestInFlight(stream), "
        "@dequeueValue(@getByIdDirectPrivate(controller, \"queue\")), "
        "@assert(@getByIdDirectPrivate(controller, "
        "\"queue\").content\?.isEmpty());\n  const sinkClosePromise = "
        "@getByIdDirectPrivate(controller, \"closeAlgorithm\").@call();\n  "
        "@writableStreamDefaultControllerClearAlgorithms(controller), "
        "sinkClosePromise.@then(() => {\n    "
        "@writableStreamFinishInFlightClose(stream);\n  }, (reason) => {\n    "
        "@writableStreamFinishInFlightCloseWithError(stream, reason);\n  "
        "});\n})";

// writableStreamDefaultControllerProcessWrite
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultControllerProcessWriteCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultControllerProcessWriteCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultControllerProcessWriteCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamDefaultControllerProcessWriteCodeLength =
        1006;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultControllerProcessWriteCodeIntrinsic =
        JSC::NoIntrinsic;
const char *const
    s_writableStreamInternalsWritableStreamDefaultControllerProcessWriteCode =
        "(function(controller, chunk) {\n  \"use strict\";\n  const stream = "
        "@getByIdDirectPrivate(controller, \"stream\");\n  "
        "@writableStreamMarkFirstWriteRequestInFlight(stream), "
        "@getByIdDirectPrivate(controller, "
        "\"writeAlgorithm\").@call(@undefined, chunk).@then(() => {\n    "
        "@writableStreamFinishInFlightWrite(stream);\n    const state = "
        "@getByIdDirectPrivate(stream, \"state\");\n    if (@assert(state === "
        "\"writable\" || state === \"erroring\"), "
        "@dequeueValue(@getByIdDirectPrivate(controller, \"queue\")), "
        "!@writableStreamCloseQueuedOrInFlight(stream) && state === "
        "\"writable\") {\n      const backpressure = "
        "@writableStreamDefaultControllerGetBackpressure(controller);\n      "
        "@writableStreamUpdateBackpressure(stream, backpressure);\n    }\n    "
        "@writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);\n  "
        "}, (reason) => {\n    if (@getByIdDirectPrivate(stream, \"state\") "
        "=== \"writable\")\n      "
        "@writableStreamDefaultControllerClearAlgorithms(controller);\n    "
        "@writableStreamFinishInFlightWriteWithError(stream, reason);\n  "
        "});\n})";

// writableStreamDefaultControllerWrite
const JSC::ConstructAbility
    s_writableStreamInternalsWritableStreamDefaultControllerWriteCodeConstructAbility =
        JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind
    s_writableStreamInternalsWritableStreamDefaultControllerWriteCodeConstructorKind =
        JSC::ConstructorKind::None;
const JSC::ImplementationVisibility
    s_writableStreamInternalsWritableStreamDefaultControllerWriteCodeImplementationVisibility =
        JSC::ImplementationVisibility::Public;
const int
    s_writableStreamInternalsWritableStreamDefaultControllerWriteCodeLength =
        663;
static const JSC::Intrinsic
    s_writableStreamInternalsWritableStreamDefaultControllerWriteCodeIntrinsic =
        JSC::NoIntrinsic;
const char
    *const s_writableStreamInternalsWritableStreamDefaultControllerWriteCode =
        "(function(controller, chunk, chunkSize) {\n  \"use strict\";\n  try "
        "{\n    @enqueueValueWithSize(@getByIdDirectPrivate(controller, "
        "\"queue\"), chunk, chunkSize);\n    const stream = "
        "@getByIdDirectPrivate(controller, \"stream\"), state = "
        "@getByIdDirectPrivate(stream, \"state\");\n    if "
        "(!@writableStreamCloseQueuedOrInFlight(stream) && state === "
        "\"writable\") {\n      const backpressure = "
        "@writableStreamDefaultControllerGetBackpressure(controller);\n      "
        "@writableStreamUpdateBackpressure(stream, backpressure);\n    }\n    "
        "@writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);\n  "
        "} catch (e) {\n    "
        "@writableStreamDefaultControllerErrorIfNeeded(controller, e);\n  "
        "}\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName,       \
                                 argumentCount)                                \
  JSC::FunctionExecutable *codeName##Generator(JSC::VM &vm) {                  \
    JSVMClientData *clientData = static_cast<JSVMClientData *>(vm.clientData); \
    return clientData->builtinFunctions()                                      \
        .writableStreamInternalsBuiltins()                                     \
        .codeName##Executable()                                                \
        ->link(vm, nullptr,                                                    \
               clientData->builtinFunctions()                                  \
                   .writableStreamInternalsBuiltins()                          \
                   .codeName##Source(),                                        \
               std::nullopt, s_##codeName##Intrinsic);                         \
  }
WEBCORE_FOREACH_WRITABLESTREAMINTERNALS_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

JSBuiltinInternalFunctions::JSBuiltinInternalFunctions(JSC::VM &vm)
    : m_vm(vm), m_bundlerPluginBuiltins(vm),
      m_byteLengthQueuingStrategyBuiltins(vm), m_consoleObjectBuiltins(vm),
      m_countQueuingStrategyBuiltins(vm), m_importMetaObjectBuiltins(vm),
      m_jsBufferConstructorBuiltins(vm), m_jsBufferPrototypeBuiltins(vm),
      m_processObjectInternalsBuiltins(vm),
      m_readableByteStreamControllerBuiltins(vm),
      m_readableByteStreamInternalsBuiltins(vm), m_readableStreamBuiltins(vm),
      m_readableStreamBYOBReaderBuiltins(vm),
      m_readableStreamBYOBRequestBuiltins(vm),
      m_readableStreamDefaultControllerBuiltins(vm),
      m_readableStreamDefaultReaderBuiltins(vm),
      m_readableStreamInternalsBuiltins(vm), m_streamInternalsBuiltins(vm),
      m_transformStreamBuiltins(vm),
      m_transformStreamDefaultControllerBuiltins(vm),
      m_transformStreamInternalsBuiltins(vm),
      m_writableStreamDefaultControllerBuiltins(vm),
      m_writableStreamDefaultWriterBuiltins(vm),
      m_writableStreamInternalsBuiltins(vm)

{
  UNUSED_PARAM(vm);
}

template <typename Visitor>
void JSBuiltinInternalFunctions::visit(Visitor &visitor) {
  m_bundlerPlugin.visit(visitor);
  m_byteLengthQueuingStrategy.visit(visitor);
  m_consoleObject.visit(visitor);
  m_countQueuingStrategy.visit(visitor);
  m_importMetaObject.visit(visitor);
  m_jsBufferConstructor.visit(visitor);
  m_jsBufferPrototype.visit(visitor);
  m_processObjectInternals.visit(visitor);
  m_readableByteStreamController.visit(visitor);
  m_readableByteStreamInternals.visit(visitor);
  m_readableStream.visit(visitor);
  m_readableStreamBYOBReader.visit(visitor);
  m_readableStreamBYOBRequest.visit(visitor);
  m_readableStreamDefaultController.visit(visitor);
  m_readableStreamDefaultReader.visit(visitor);
  m_readableStreamInternals.visit(visitor);
  m_streamInternals.visit(visitor);
  m_transformStream.visit(visitor);
  m_transformStreamDefaultController.visit(visitor);
  m_transformStreamInternals.visit(visitor);
  m_writableStreamDefaultController.visit(visitor);
  m_writableStreamDefaultWriter.visit(visitor);
  m_writableStreamInternals.visit(visitor);

  UNUSED_PARAM(visitor);
}

template void JSBuiltinInternalFunctions::visit(AbstractSlotVisitor &);
template void JSBuiltinInternalFunctions::visit(SlotVisitor &);

SUPPRESS_ASAN void *displayport ::initialize(JSDOMGlobalObject &globalObject) {
  UNUSED_PARAM(globalObject);
  m_readableByteStreamInternals.init(globalObject);
  m_readableStreamInternals.init(globalObject);
  m_streamInternals.init(globalObject);
  m_transformStreamInternals.init(globalObject);
  m_writableStreamInternals.init(globalObject);

  JSVMClientData &clientData = *static_cast<JSVMClientData *>(m_vm.clientData);
  JSDOMGlobalObject::GlobalPropertyInfo staticGlobals[] = {
#define DECLARE_GLOBAL_STATIC(name)                                            \
  JSDOMGlobalObject::GlobalPropertyInfo(                                       \
      clientData.builtinFunctions()                                            \
          .readableByteStreamInternalsBuiltins()                               \
          .name##PrivateName(),                                                \
      readableByteStreamInternals().m_##name##Function.get(),                  \
      JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly),
      WEBCORE_FOREACH_READABLEBYTESTREAMINTERNALS_BUILTIN_FUNCTION_NAME(
          DECLARE_GLOBAL_STATIC)
#undef DECLARE_GLOBAL_STATIC
#define DECLARE_GLOBAL_STATIC(name)                                            \
  JSDOMGlobalObject::GlobalPropertyInfo(                                       \
      clientData.builtinFunctions()                                            \
          .readableStreamInternalsBuiltins()                                   \
          .name##PrivateName(),                                                \
      readableStreamInternals().m_##name##Function.get(),                      \
      JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly),
          WEBCORE_FOREACH_READABLESTREAMINTERNALS_BUILTIN_FUNCTION_NAME(
              DECLARE_GLOBAL_STATIC)
#undef DECLARE_GLOBAL_STATIC
#define DECLARE_GLOBAL_STATIC(name)                                            \
  JSDOMGlobalObject::GlobalPropertyInfo(                                       \
      clientData.builtinFunctions()                                            \
          .streamInternalsBuiltins()                                           \
          .name##PrivateName(),                                                \
      streamInternals().m_##name##Function.get(),                              \
      JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly),
              WEBCORE_FOREACH_STREAMINTERNALS_BUILTIN_FUNCTION_NAME(
                  DECLARE_GLOBAL_STATIC)
#undef DECLARE_GLOBAL_STATIC
#define DECLARE_GLOBAL_STATIC(name)                                            \
  JSDOMGlobalObject::GlobalPropertyInfo(                                       \
      clientData.builtinFunctions()                                            \
          .transformStreamInternalsBuiltins()                                  \
          .name##PrivateName(),                                                \
      transformStreamInternals().m_##name##Function.get(),                     \
      JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly),
                  WEBCORE_FOREACH_TRANSFORMSTREAMINTERNALS_BUILTIN_FUNCTION_NAME(
                      DECLARE_GLOBAL_STATIC)
#undef DECLARE_GLOBAL_STATIC
#define DECLARE_GLOBAL_STATIC(name)                                            \
  JSDOMGlobalObject::GlobalPropertyInfo(                                       \
      clientData.builtinFunctions()                                            \
          .writableStreamInternalsBuiltins()                                   \
          .name##PrivateName(),                                                \
      writableStreamInternals().m_##name##Function.get(),                      \
      JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly),
                      WEBCORE_FOREACH_WRITABLESTREAMINTERNALS_BUILTIN_FUNCTION_NAME(
                          DECLARE_GLOBAL_STATIC)
#undef DECLARE_GLOBAL_STATIC

  };
  globalObject.addStaticGlobals(staticGlobals, std::size(staticGlobals));
  UNUSED_PARAM(clientData);
}

} // namespace WebCore
