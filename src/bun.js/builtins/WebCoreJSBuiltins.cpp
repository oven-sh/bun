#include "config.h"
#include "WebCoreJSBuiltins.h"

#include "WebCoreJSClientData.h"
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/ImplementationVisibility.h>
#include <JavaScriptCore/Intrinsic.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/VM.h>

namespace WebCore {

/* CountQueuingStrategy.ts */
// highWaterMark
const JSC::ConstructAbility s_CountQueuingStrategyhighWaterMarkCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_CountQueuingStrategyhighWaterMarkCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_CountQueuingStrategyhighWaterMarkCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_CountQueuingStrategyhighWaterMarkCodeLength = 265;
static const JSC::Intrinsic s_CountQueuingStrategyhighWaterMarkCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_CountQueuingStrategyhighWaterMarkCode = "(function() {\n  \"use strict\";\n  const highWaterMark = @getByIdDirectPrivate(this, \"highWaterMark\");\n  if (highWaterMark === @undefined)\n    @throwTypeError(\"CountQueuingStrategy.highWaterMark getter called on incompatible |this| value.\");\n  return highWaterMark;\n})";

// size
const JSC::ConstructAbility s_CountQueuingStrategysizeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_CountQueuingStrategysizeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_CountQueuingStrategysizeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_CountQueuingStrategysizeCodeLength = 42;
static const JSC::Intrinsic s_CountQueuingStrategysizeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_CountQueuingStrategysizeCode = "(function() {\n  return \"use strict\", 1;\n})";

// initializeCountQueuingStrategy
const JSC::ConstructAbility s_CountQueuingStrategyinitializeCountQueuingStrategyCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_CountQueuingStrategyinitializeCountQueuingStrategyCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_CountQueuingStrategyinitializeCountQueuingStrategyCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_CountQueuingStrategyinitializeCountQueuingStrategyCodeLength = 146;
static const JSC::Intrinsic s_CountQueuingStrategyinitializeCountQueuingStrategyCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_CountQueuingStrategyinitializeCountQueuingStrategyCode = "(function(parameters) {\n  \"use strict\", @putByIdDirectPrivate(this, \"highWaterMark\", @extractHighWaterMarkFromQueuingStrategyInit(parameters));\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().CountQueuingStrategyBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().CountQueuingStrategyBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ConsoleObject.ts */
// asyncIterator
const JSC::ConstructAbility s_ConsoleObjectasyncIteratorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_ConsoleObjectasyncIteratorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_ConsoleObjectasyncIteratorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_ConsoleObjectasyncIteratorCodeLength = 1322;
static const JSC::Intrinsic s_ConsoleObjectasyncIteratorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_ConsoleObjectasyncIteratorCode = "(function() {\n  \"use strict\";\n  const Iterator = async function* ConsoleAsyncIterator() {\n    var reader = @Bun.stdin.stream().getReader(), decoder = new globalThis.TextDecoder(\"utf-8\", { fatal: !1 }), deferredError, indexOf = @Bun.indexOfLine;\n    try {\n      while (!0) {\n        var done, value, pendingChunk;\n        const firstResult = reader.readMany();\n        if (@isPromise(firstResult))\n          ({ done, value } = await firstResult);\n        else\n          ({ done, value } = firstResult);\n        if (done) {\n          if (pendingChunk)\n            yield decoder.decode(pendingChunk);\n          return;\n        }\n        var actualChunk;\n        for (let chunk of value) {\n          if (actualChunk = chunk, pendingChunk)\n            actualChunk = @Buffer.concat([pendingChunk, chunk]), pendingChunk = null;\n          var last = 0, i = indexOf(actualChunk, last);\n          while (i !== -1)\n            yield decoder.decode(actualChunk.subarray(last, i)), last = i + 1, i = indexOf(actualChunk, last);\n          pendingChunk = actualChunk.subarray(last);\n        }\n      }\n    } catch (e) {\n      deferredError = e;\n    } finally {\n      if (reader.releaseLock(), deferredError)\n        throw deferredError;\n    }\n  }, symbol = globalThis.Symbol.asyncIterator;\n  return this[symbol] = Iterator, Iterator();\n})";

// write
const JSC::ConstructAbility s_ConsoleObjectwriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_ConsoleObjectwriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_ConsoleObjectwriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_ConsoleObjectwriteCodeLength = 469;
static const JSC::Intrinsic s_ConsoleObjectwriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_ConsoleObjectwriteCode = "(function(input) {\n  \"use strict\";\n  var writer = @getByIdDirectPrivate(this, \"writer\");\n  if (!writer) {\n    var length = @toLength(input\?.length \?\? 0);\n    writer = @Bun.stdout.writer({ highWaterMark: length > 65536 \? length : 65536 }), @putByIdDirectPrivate(this, \"writer\", writer);\n  }\n  var wrote = writer.write(input);\n  const count = @argumentCount();\n  for (var i = 1;i < count; i++)\n    wrote += writer.write(@argument(i));\n  return writer.flush(!0), wrote;\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().ConsoleObjectBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().ConsoleObjectBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* BundlerPlugin.ts */
// runSetupFunction
const JSC::ConstructAbility s_BundlerPluginrunSetupFunctionCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_BundlerPluginrunSetupFunctionCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_BundlerPluginrunSetupFunctionCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_BundlerPluginrunSetupFunctionCodeLength = 3971;
static const JSC::Intrinsic s_BundlerPluginrunSetupFunctionCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_BundlerPluginrunSetupFunctionCode = "(function(setup, config) {\n  \"use strict\";\n  var onLoadPlugins = new Map, onResolvePlugins = new Map;\n  function validate(filterObject, callback, map) {\n    if (!filterObject || !@isObject(filterObject))\n      @throwTypeError('Expected an object with \"filter\" RegExp');\n    if (!callback || !@isCallable(callback))\n      @throwTypeError(\"callback must be a function\");\n    var { filter, namespace = \"file\" } = filterObject;\n    if (!filter)\n      @throwTypeError('Expected an object with \"filter\" RegExp');\n    if (!@isRegExpObject(filter))\n      @throwTypeError(\"filter must be a RegExp\");\n    if (namespace && typeof namespace !== \"string\")\n      @throwTypeError(\"namespace must be a string\");\n    if ((namespace\?.length \?\? 0) === 0)\n      namespace = \"file\";\n    if (!/^([/@a-zA-Z0-9_\\\\-]+)$/.test(namespace))\n      @throwTypeError(\"namespace can only contain $a-zA-Z0-9_\\\\-\");\n    var callbacks = map.@get(namespace);\n    if (!callbacks)\n      map.@set(namespace, [[filter, callback]]);\n    else\n      @arrayPush(callbacks, [filter, callback]);\n  }\n  function onLoad(filterObject, callback) {\n    validate(filterObject, callback, onLoadPlugins);\n  }\n  function onResolve(filterObject, callback) {\n    validate(filterObject, callback, onResolvePlugins);\n  }\n  function onStart(callback) {\n    throw notImplementedIssue(2771, \"On-start callbacks\");\n  }\n  function onEnd(callback) {\n    throw notImplementedIssue(2771, \"On-end callbacks\");\n  }\n  function onDispose(callback) {\n    throw notImplementedIssue(2771, \"On-dispose callbacks\");\n  }\n  function resolve(callback) {\n    throw notImplementedIssue(2771, \"build.resolve()\");\n  }\n  const processSetupResult = () => {\n    var anyOnLoad = !1, anyOnResolve = !1;\n    for (var [namespace, callbacks] of onLoadPlugins.entries())\n      for (var [filter] of callbacks)\n        this.addFilter(filter, namespace, 1), anyOnLoad = !0;\n    for (var [namespace, callbacks] of onResolvePlugins.entries())\n      for (var [filter] of callbacks)\n        this.addFilter(filter, namespace, 0), anyOnResolve = !0;\n    if (anyOnResolve) {\n      var onResolveObject = this.onResolve;\n      if (!onResolveObject)\n        this.onResolve = onResolvePlugins;\n      else\n        for (var [namespace, callbacks] of onResolvePlugins.entries()) {\n          var existing = onResolveObject.@get(namespace);\n          if (!existing)\n            onResolveObject.@set(namespace, callbacks);\n          else\n            onResolveObject.@set(namespace, existing.concat(callbacks));\n        }\n    }\n    if (anyOnLoad) {\n      var onLoadObject = this.onLoad;\n      if (!onLoadObject)\n        this.onLoad = onLoadPlugins;\n      else\n        for (var [namespace, callbacks] of onLoadPlugins.entries()) {\n          var existing = onLoadObject.@get(namespace);\n          if (!existing)\n            onLoadObject.@set(namespace, callbacks);\n          else\n            onLoadObject.@set(namespace, existing.concat(callbacks));\n        }\n    }\n    return anyOnLoad || anyOnResolve;\n  };\n  var setupResult = setup({\n    config,\n    onDispose,\n    onEnd,\n    onLoad,\n    onResolve,\n    onStart,\n    resolve,\n    initialOptions: {\n      ...config,\n      bundle: !0,\n      entryPoints: config.entrypoints \?\? config.entryPoints \?\? [],\n      minify: typeof config.minify === \"boolean\" \? config.minify : !1,\n      minifyIdentifiers: config.minify === !0 || config.minify\?.identifiers,\n      minifyWhitespace: config.minify === !0 || config.minify\?.whitespace,\n      minifySyntax: config.minify === !0 || config.minify\?.syntax,\n      outbase: config.root,\n      platform: config.target === \"bun\" \? \"node\" : config.target\n    },\n    esbuild: {}\n  });\n  if (setupResult && @isPromise(setupResult))\n    if (@getPromiseInternalField(setupResult, @promiseFieldFlags) & @promiseStateFulfilled)\n      setupResult = @getPromiseInternalField(setupResult, @promiseFieldReactionsOrResult);\n    else\n      return setupResult.@then(processSetupResult);\n  return processSetupResult();\n})";

// runOnResolvePlugins
const JSC::ConstructAbility s_BundlerPluginrunOnResolvePluginsCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_BundlerPluginrunOnResolvePluginsCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_BundlerPluginrunOnResolvePluginsCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_BundlerPluginrunOnResolvePluginsCodeLength = 2990;
static const JSC::Intrinsic s_BundlerPluginrunOnResolvePluginsCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_BundlerPluginrunOnResolvePluginsCode = "(function(specifier, inputNamespace, importer, internalID, kindId) {\n  \"use strict\";\n  const kind = [\"entry-point\", \"import-statement\", \"require-call\", \"dynamic-import\", \"require-resolve\", \"import-rule\", \"url-token\", \"internal\"][kindId];\n  var promiseResult = (async (inputPath, inputNamespace2, importer2, kind2) => {\n    var { onResolve, onLoad } = this, results = onResolve.@get(inputNamespace2);\n    if (!results)\n      return this.onResolveAsync(internalID, null, null, null), null;\n    for (let [filter, callback] of results)\n      if (filter.test(inputPath)) {\n        var result = callback({\n          path: inputPath,\n          importer: importer2,\n          namespace: inputNamespace2,\n          kind: kind2\n        });\n        while (result && @isPromise(result) && (@getPromiseInternalField(result, @promiseFieldFlags) & @promiseStateMask) === @promiseStateFulfilled)\n          result = @getPromiseInternalField(result, @promiseFieldReactionsOrResult);\n        if (result && @isPromise(result))\n          result = await result;\n        if (!result || !@isObject(result))\n          continue;\n        var { path, namespace: userNamespace = inputNamespace2, external } = result;\n        if (typeof path !== \"string\" || typeof userNamespace !== \"string\")\n          @throwTypeError(\"onResolve plugins must return an object with a string 'path' and string 'loader' field\");\n        if (!path)\n          continue;\n        if (!userNamespace)\n          userNamespace = inputNamespace2;\n        if (typeof external !== \"boolean\" && !@isUndefinedOrNull(external))\n          @throwTypeError('onResolve plugins \"external\" field must be boolean or unspecified');\n        if (!external) {\n          if (userNamespace === \"file\") {\n            if (linux !== \"win32\") {\n              if (path[0] !== \"/\" || path.includes(\"..\"))\n                @throwTypeError('onResolve plugin \"path\" must be absolute when the namespace is \"file\"');\n            }\n          }\n          if (userNamespace === \"dataurl\") {\n            if (!path.startsWith(\"data:\"))\n              @throwTypeError('onResolve plugin \"path\" must start with \"data:\" when the namespace is \"dataurl\"');\n          }\n          if (userNamespace && userNamespace !== \"file\" && (!onLoad || !onLoad.@has(userNamespace)))\n            @throwTypeError(`Expected onLoad plugin for namespace ${userNamespace} to exist`);\n        }\n        return this.onResolveAsync(internalID, path, userNamespace, external), null;\n      }\n    return this.onResolveAsync(internalID, null, null, null), null;\n  })(specifier, inputNamespace, importer, kind);\n  while (promiseResult && @isPromise(promiseResult) && (@getPromiseInternalField(promiseResult, @promiseFieldFlags) & @promiseStateMask) === @promiseStateFulfilled)\n    promiseResult = @getPromiseInternalField(promiseResult, @promiseFieldReactionsOrResult);\n  if (promiseResult && @isPromise(promiseResult))\n    promiseResult.then(() => {\n    }, (e) => {\n      this.addError(internalID, e, 0);\n    });\n})";

// runOnLoadPlugins
const JSC::ConstructAbility s_BundlerPluginrunOnLoadPluginsCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_BundlerPluginrunOnLoadPluginsCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_BundlerPluginrunOnLoadPluginsCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_BundlerPluginrunOnLoadPluginsCodeLength = 2275;
static const JSC::Intrinsic s_BundlerPluginrunOnLoadPluginsCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_BundlerPluginrunOnLoadPluginsCode = "(function(internalID, path, namespace, defaultLoaderId) {\n  \"use strict\";\n  const LOADERS_MAP = { jsx: 0, js: 1, ts: 2, tsx: 3, css: 4, file: 5, json: 6, toml: 7, wasm: 8, napi: 9, base64: 10, dataurl: 11, text: 12 }, loaderName = [\"jsx\", \"js\", \"ts\", \"tsx\", \"css\", \"file\", \"json\", \"toml\", \"wasm\", \"napi\", \"base64\", \"dataurl\", \"text\"][defaultLoaderId];\n  var promiseResult = (async (internalID2, path2, namespace2, defaultLoader) => {\n    var results = this.onLoad.@get(namespace2);\n    if (!results)\n      return this.onLoadAsync(internalID2, null, null, null), null;\n    for (let [filter, callback] of results)\n      if (filter.test(path2)) {\n        var result = callback({\n          path: path2,\n          namespace: namespace2,\n          loader: defaultLoader\n        });\n        while (result && @isPromise(result) && (@getPromiseInternalField(result, @promiseFieldFlags) & @promiseStateMask) === @promiseStateFulfilled)\n          result = @getPromiseInternalField(result, @promiseFieldReactionsOrResult);\n        if (result && @isPromise(result))\n          result = await result;\n        if (!result || !@isObject(result))\n          continue;\n        var { contents, loader = defaultLoader } = result;\n        if (typeof contents !== \"string\" && !@isTypedArrayView(contents))\n          @throwTypeError('onLoad plugins must return an object with \"contents\" as a string or Uint8Array');\n        if (typeof loader !== \"string\")\n          @throwTypeError('onLoad plugins must return an object with \"loader\" as a string');\n        const chosenLoader = LOADERS_MAP[loader];\n        if (chosenLoader === @undefined)\n          @throwTypeError(`Loader ${loader} is not supported.`);\n        return this.onLoadAsync(internalID2, contents, chosenLoader), null;\n      }\n    return this.onLoadAsync(internalID2, null, null), null;\n  })(internalID, path, namespace, loaderName);\n  while (promiseResult && @isPromise(promiseResult) && (@getPromiseInternalField(promiseResult, @promiseFieldFlags) & @promiseStateMask) === @promiseStateFulfilled)\n    promiseResult = @getPromiseInternalField(promiseResult, @promiseFieldReactionsOrResult);\n  if (promiseResult && @isPromise(promiseResult))\n    promiseResult.then(() => {\n    }, (e) => {\n      this.addError(internalID, e, 1);\n    });\n})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().BundlerPluginBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().BundlerPluginBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR


} // namespace WebCore
