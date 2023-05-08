/*
 * Copyright (C) 2023 Codeblog Corp. All rights reserved.
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

// This API expects 4 functions:
// - onLoadAsync
// - onResolveAsync
// - addError
// - addFilter
//
// It should be generic enough to reuse for Bun.plugin() eventually, too.

function runOnResolvePlugins(
  specifier,
  inputNamespace,
  importer,
  internalID,
  kindId
) {
  "use strict";

  // Must be kept in sync with ImportRecord.label
  const kind = [
    "entry-point",
    "import-statement",
    "require-call",
    "dynamic-import",
    "require-resolve",
    "import-rule",
    "url-token",
    "internal",
  ][kindId];

  var promiseResult = (async (inputPath, inputNamespace, importer, kind) => {
    var {onResolve, onLoad} = this;
    var results = onResolve.@get(inputNamespace);
    if (!results) {
      this.onResolveAsync(internalID, null, null, null);
      return null;
    }

    for (let [filter, callback] of results) {
      if (filter.test(inputPath)) {
        var result = callback({
          path: inputPath,
          importer,
          namespace: inputNamespace,
          kind,
        });

        while (
          result &&
          @isPromise(result) &&
          (@getPromiseInternalField(result, @promiseFieldFlags) &
            @promiseStateMask) ===
            @promiseStateFulfilled
        ) {
          result = @getPromiseInternalField(
            result,
            @promiseFieldReactionsOrResult
          );
        }

        if (result && @isPromise(result)) {
          result = await result;
        }

        if (!result || !@isObject(result)) {
          continue;
        }


        var {
          path,
          namespace: userNamespace = inputNamespace,
          external,
        } = result;
        if (
          !(typeof path === "string") ||
          !(typeof userNamespace === "string")
        ) {
          @throwTypeError(
            "onResolve plugins must return an object with a string 'path' and string 'loader' field"
          );
        }

        if (!path) {
          continue;
        }

        if (!userNamespace) {
          userNamespace = inputNamespace;
        }
        if (typeof external !== "boolean" && !@isUndefinedOrNull(external)) {
          @throwTypeError(
            'onResolve plugins "external" field must be boolean or unspecified'
          );
        }


        if (!external) {
          if (userNamespace === "file") {
            // TODO: Windows
            
            if (path[0] !== "/" || path.includes("..")) {
              @throwTypeError(
                'onResolve plugin "path" must be absolute when the namespace is "file"'
              );
            }
          }
          if (userNamespace === "dataurl") {
            if (!path.startsWith("data:")) {
              @throwTypeError(
                'onResolve plugin "path" must start with "data:" when the namespace is "dataurl"'
              );
            }
          }

          if (userNamespace && userNamespace !== "file" && (!onLoad || !onLoad.@has(userNamespace))) {
            @throwTypeError(
              `Expected onLoad plugin for namespace ${@jsonStringify(userNamespace, " ")} to exist`
            );
          }

        }
        this.onResolveAsync(internalID, path, userNamespace, external);
        return null;
      }
    }

    this.onResolveAsync(internalID, null, null, null);
    return null;
  })(specifier, inputNamespace, importer, kind);

  while (
    promiseResult &&
    @isPromise(promiseResult) &&
    (@getPromiseInternalField(promiseResult, @promiseFieldFlags) &
      @promiseStateMask) ===
      @promiseStateFulfilled
  ) {
    promiseResult = @getPromiseInternalField(
      promiseResult,
      @promiseFieldReactionsOrResult
    );
  }

  if (promiseResult && @isPromise(promiseResult)) {
    promiseResult.then(
      () => {},
      (e) => {
        this.addError(internalID, e, 0);
      }
    );
  }
}

function runSetupFunction(setup) {
  "use strict";
  var onLoadPlugins = new Map(),
    onResolvePlugins = new Map();

  function validate(filterObject, callback, map) {
    if (!filterObject || !@isObject(filterObject)) {
      @throwTypeError('Expected an object with "filter" RegExp');
    }

    if (!callback || !@isCallable(callback)) {
      @throwTypeError("callback must be a function");
    }

    var { filter, namespace = "file" } = filterObject;

    if (!filter) {
      @throwTypeError('Expected an object with "filter" RegExp');
    }

    if (!@isRegExpObject(filter)) {
      @throwTypeError("filter must be a RegExp");
    }

    if (namespace && !(typeof namespace === "string")) {
      @throwTypeError("namespace must be a string");
    }

    if ((namespace?.length ?? 0) === 0) {
      namespace = "file";
    }

    if (!/^([/@a-zA-Z0-9_\\-]+)$/.test(namespace)) {
      @throwTypeError("namespace can only contain @a-zA-Z0-9_\\-");
    }

    var callbacks = map.@get(namespace);

    if (!callbacks) {
      map.@set(namespace, [[filter, callback]]);
    } else {
      @arrayPush(callbacks, [filter, callback]);
    }
  }

  function onLoad(filterObject, callback) {
    validate(filterObject, callback, onLoadPlugins);
  }

  function onResolve(filterObject, callback) {
    validate(filterObject, callback, onResolvePlugins);
  }

  function onStart(callback) {
    // builtin generator thinks the // in the link is a comment and removes it
    @throwTypeError("On-start callbacks are not implemented yet. See https:/\/github.com/oven-sh/bun/issues/2771");
  }

  function onEnd(callback) {
    @throwTypeError("On-end callbacks are not implemented yet. See https:/\/github.com/oven-sh/bun/issues/2771");
  }

  function onDispose(callback) {
    @throwTypeError("On-dispose callbacks are not implemented yet. See https:/\/github.com/oven-sh/bun/issues/2771");
  }

  const processSetupResult = () => {
    var anyOnLoad = false,
      anyOnResolve = false;

    for (var [namespace, callbacks] of onLoadPlugins.entries()) {
      for (var [filter] of callbacks) {
        this.addFilter(filter, namespace, 1);
        anyOnLoad = true;
      }
    }

    for (var [namespace, callbacks] of onResolvePlugins.entries()) {
      for (var [filter] of callbacks) {
        this.addFilter(filter, namespace, 0);
        anyOnResolve = true;
      }
    }

    if (anyOnResolve) {
      var onResolveObject = this.onResolve;
      if (!onResolveObject) {
        this.onResolve = onResolvePlugins;
      } else {
        for (var [namespace, callbacks] of onResolvePlugins.entries()) {
          var existing = onResolveObject.@get(namespace);

          if (!existing) {
            onResolveObject.@set(namespace, callbacks);
          } else {
            onResolveObject.@set(namespace, existing.concat(callbacks));
          }
        }
      }
    }

    if (anyOnLoad) {
      var onLoadObject = this.onLoad;
      if (!onLoadObject) {
        this.onLoad = onLoadPlugins;
      } else {
        for (var [namespace, callbacks] of onLoadPlugins.entries()) {
          var existing = onLoadObject.@get(namespace);

          if (!existing) {
            onLoadObject.@set(namespace, callbacks);
          } else {
            onLoadObject.@set(namespace, existing.concat(callbacks));
          }
        }
      }
    }

    return anyOnLoad || anyOnResolve;
  };

  var setupResult = setup({
    onDispose,
    onEnd,
    onLoad,
    onResolve,
    onStart,
  });

  if (setupResult && @isPromise(setupResult)) {
    if (
      @getPromiseInternalField(setupResult, @promiseFieldFlags) &
      @promiseStateFulfilled
    ) {
      setupResult = @getPromiseInternalField(
        setupResult,
        @promiseFieldReactionsOrResult
      );
    } else {
      return setupResult.@then(processSetupResult);
    }
  }

  return processSetupResult();
}

function runOnLoadPlugins(internalID, path, namespace, defaultLoaderId) {
  "use strict";

  const LOADERS_MAP = {
    jsx: 0,
    js: 1,
    ts: 2,
    tsx: 3,
    css: 4,
    file: 5,
    json: 6,
    toml: 7,
    wasm: 8,
    napi: 9,
    base64: 10,
    dataurl: 11,
    text: 12,
  };
  const loaderName = [
    "jsx",
    "js",
    "ts",
    "tsx",
    "css",
    "file",
    "json",
    "toml",
    "wasm",
    "napi",
    "base64",
    "dataurl",
    "text",
  ][defaultLoaderId];

  var promiseResult = (async (internalID, path, namespace, defaultLoader) => {
    var results = this.onLoad.@get(namespace);
    if (!results) {
      this.onLoadAsync(internalID, null, null, null);
      return null;
    }

    for (let [filter, callback] of results) {
      if (filter.test(path)) {
        var result = callback({
          path,
          namespace,
          loader: defaultLoader,
        });

        while (
          result &&
          @isPromise(result) &&
          (@getPromiseInternalField(result, @promiseFieldFlags) &
            @promiseStateMask) ===
            @promiseStateFulfilled
        ) {
          result = @getPromiseInternalField(
            result,
            @promiseFieldReactionsOrResult
          );
        }

        if (result && @isPromise(result)) {
          result = await result;
        }

        if (!result || !@isObject(result)) {
          continue;
        }

        var { contents, loader = defaultLoader } = result;
        if (!(typeof contents === "string") && !@isTypedArrayView(contents)) {
          @throwTypeError(
            'onLoad plugins must return an object with "contents" as a string or Uint8Array'
          );
        }

        if (!(typeof loader === "string")) {
          @throwTypeError(
            'onLoad plugins must return an object with "loader" as a string'
          );
        }

        const chosenLoader = LOADERS_MAP[loader];
        if (chosenLoader === @undefined) {
          @throwTypeError(`Loader ${@jsonStringify(loader, " ")} is not supported.`);
        }

        this.onLoadAsync(internalID, contents, chosenLoader);
        return null;
      }
    }

    this.onLoadAsync(internalID, null, null);
    return null;
  })(internalID, path, namespace, loaderName);

  while (
    promiseResult &&
    @isPromise(promiseResult) &&
    (@getPromiseInternalField(promiseResult, @promiseFieldFlags) &
      @promiseStateMask) ===
      @promiseStateFulfilled
  ) {
    promiseResult = @getPromiseInternalField(
      promiseResult,
      @promiseFieldReactionsOrResult
    );
  }

  if (promiseResult && @isPromise(promiseResult)) {
    promiseResult.then(
      () => {},
      (e) => {
        this.addError(internalID, e, 1);
      }
    );
  }
}
