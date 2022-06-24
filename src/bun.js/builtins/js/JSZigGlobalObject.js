/*
 * Copyright 2022 Codeblog Corp. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

function require(name) {
  "use strict";
  if (typeof name !== "string") {
    @throwTypeError("require() expects a string as its argument");
  }
  
  const resolved = this.resolveSync(name, this.path);
  var requireCache = (globalThis[Symbol.for("_requireCache")] ||= new @Map);
  var cached = requireCache.@get(resolved);
  if (cached) {
    if (resolved.endsWith(".node")) {
      return cached.exports;
    }

    return cached;
  }


  // TODO: remove this hardcoding
  if (resolved.endsWith(".json")) {
    var fs = (globalThis[Symbol.for("_fs")] ||= Bun.fs());
    var exports = JSON.parse(fs.readFileSync(resolved, "utf8"));
    requireCache.@set(resolved, exports);
    return exports;
  } else if (resolved.endsWith(".node")) {
    var module = { exports: {} };
    globalThis.process.dlopen(module, resolved);
    requireCache.@set(resolved, module);
    return module.exports;
  } else if (resolved.endsWith(".toml")) {
    var fs = (globalThis[Symbol.for("_fs")] ||= Bun.fs());
    var exports = Bun.TOML.parse(fs.readFileSync(resolved, "utf8"));
    requireCache.@set(resolved, exports);
    return exports;
  } else {
    var exports = this.requireModule(this, resolved);
    requireCache.@set(resolved, exports);
    return exports;
  }
}

function loadModule(meta, resolvedSpecifier) {
  "use strict";
  var Loader = globalThis.Loader;

  var queue = @createFIFO();
  var key = resolvedSpecifier;
  var registry = Loader.registry;
  while (key) {
    @fulfillModuleSync(key);
    var entry = registry.@get(key);

    // entry.fetch is a Promise<SourceCode>
    // SourceCode is not a string, it's a JSC::SourceCode object
    // this pulls it out of the promise without delaying by a tick
    // the promise is already fullfilled by @fullfillModuleSync
    var sourceCodeObject = @getPromiseInternalField(
      entry.fetch,
      @promiseFieldReactionsOrResult
    );

    // parseModule() returns a Promise, but the value is already fulfilled
    // so we just pull it out of the promise here once again
    // But, this time we do it a little more carefully because this is a JSC function call and not bun source code
    var moduleRecordPromise = Loader.parseModule(key, sourceCodeObject);
    var module = entry.module;
    if (!module && moduleRecordPromise && @isPromise(moduleRecordPromise)) {
      var reactionsOrResult = @getPromiseInternalField(
        moduleRecordPromise,
        @promiseFieldReactionsOrResult
      );
      var flags = @getPromiseInternalField(
        moduleRecordPromise,
        @promiseFieldFlags
      );
      var state = flags & @promiseStateMask;

      // this branch should never happen, but just to be safe
      if (
        state === @promiseStatePending ||
        (reactionsOrResult && @isPromise(reactionsOrResult))
      ) {
        @throwTypeError(`require() async module \"${key}\" is unsupported`);
      } else if (state === @promiseStateRejected) {
        // this branch happens if there is a syntax error and somehow bun didn't catch it
        // "throw" is unsupported here, so we use "throwTypeError" (TODO: use SyntaxError but preserve the specifier)
        @throwTypeError(
          `${
            reactionsOrResult?.message ?? "An error occurred"
          } while parsing module \"${key}\"`
        );
      }
      entry.module = module = reactionsOrResult;
    } else if (moduleRecordPromise && !module) {
      entry.module = module = moduleRecordPromise;
    }

    // This is very similar to "requestInstantiate" in ModuleLoader.js in JavaScriptCore.
    @setStateToMax(entry, @ModuleLink);
    var dependenciesMap = module.dependenciesMap;
    var requestedModules = Loader.requestedModules(module);
    var dependencies = @newArrayWithSize(requestedModules.length);

    for (var i = 0, length = requestedModules.length; i < length; ++i) {
      var depName = requestedModules[i];

      // optimization: if it starts with a slash then it's an absolute path
      // we don't need to run the resolver a 2nd time
      var depKey =
        depName[0] === "/"
          ? depName
          : Loader.resolveSync(depName, key, @undefined);
      var depEntry = Loader.ensureRegistered(depKey);

      if (depEntry.state < @ModuleLink) {
        queue.push(depKey);
      }

      @putByValDirect(dependencies, i, depEntry);
      dependenciesMap.@set(depName, depEntry);
    }

    entry.dependencies = dependencies;
    key = queue.shift();
    while (key && (registry.@get(key)?.state ?? @ModuleFetch) >= @ModuleLink) {
      key = queue.shift();
    }
  }

  var linkAndEvaluateResult = Loader.linkAndEvaluateModule(
    resolvedSpecifier,
    @undefined
  );
  if (linkAndEvaluateResult && @isPromise(linkAndEvaluateResult)) {
    // if you use top-level await, or any dependencies use top-level await, then we throw here
    // this means the module will still actually load eventually, but that's okay.
    @throwTypeError(
      `require() async module \"${resolvedSpecifier}\" is unsupported`
    );
  }

  return Loader.registry.@get(resolvedSpecifier);

}

function requireModule(meta, resolved) {
  "use strict";
  var Loader = globalThis.Loader;
  var entry = Loader.registry.@get(resolved);

  if (!entry || !entry.evaluated) {
    entry = this.loadModule(meta, resolved); 
  }

  if (!entry || !entry.evaluated || !entry.module) {
    @throwTypeError(`require() failed to evaluate module \"${resolved}\". This is an internal consistentency error.`);
  }
  var exports = Loader.getModuleNamespaceObject(entry.module);
  var commonJS = exports.default;
  if (commonJS && @isObject(commonJS) && Symbol.for("CommonJS") in commonJS) {
    return commonJS();
  }
  return exports;
}
