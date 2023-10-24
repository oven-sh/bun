// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/BundlerPlugin.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(specifier,inputNamespace,importer,internalID,kindId) {  // Must be kept in sync with ImportRecord.label
  const kind = __intrinsic__ImportKindIdToLabel[kindId];

  var promiseResult: any = (async (inputPath, inputNamespace, importer, kind) => {
    var { onResolve, onLoad } = this;
    var results = onResolve.__intrinsic__get(inputNamespace);
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
          // resolveDir
          kind,
          // pluginData
        });

        while (
          result &&
          __intrinsic__isPromise(result) &&
          (__intrinsic__getPromiseInternalField(result, __intrinsic__promiseFieldFlags) & __intrinsic__promiseStateMask) === __intrinsic__promiseStateFulfilled
        ) {
          result = __intrinsic__getPromiseInternalField(result, __intrinsic__promiseFieldReactionsOrResult);
        }

        if (result && __intrinsic__isPromise(result)) {
          result = await result;
        }

        if (!result || !__intrinsic__isObject(result)) {
          continue;
        }

        var { path, namespace: userNamespace = inputNamespace, external } = result;
        if (!(typeof path === "string") || !(typeof userNamespace === "string")) {
          __intrinsic__throwTypeError("onResolve plugins must return an object with a string 'path' and string 'loader' field");
        }

        if (!path) {
          continue;
        }

        if (!userNamespace) {
          userNamespace = inputNamespace;
        }
        if (typeof external !== "boolean" && !__intrinsic__isUndefinedOrNull(external)) {
          __intrinsic__throwTypeError('onResolve plugins "external" field must be boolean or unspecified');
        }

        if (!external) {
          if (userNamespace === "file") {
            if (process.platform !== "win32") {
              if (path[0] !== "/" || path.includes("..")) {
                __intrinsic__throwTypeError('onResolve plugin "path" must be absolute when the namespace is "file"');
              }
            } else {
              // TODO: Windows
            }
          }
          if (userNamespace === "dataurl") {
            if (!path.startsWith("data:")) {
              __intrinsic__throwTypeError('onResolve plugin "path" must start with "data:" when the namespace is "dataurl"');
            }
          }

          if (userNamespace && userNamespace !== "file" && (!onLoad || !onLoad.__intrinsic__has(userNamespace))) {
            __intrinsic__throwTypeError(`Expected onLoad plugin for namespace ${userNamespace} to exist`);
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
    __intrinsic__isPromise(promiseResult) &&
    (__intrinsic__getPromiseInternalField(promiseResult, __intrinsic__promiseFieldFlags) & __intrinsic__promiseStateMask) === __intrinsic__promiseStateFulfilled
  ) {
    promiseResult = __intrinsic__getPromiseInternalField(promiseResult, __intrinsic__promiseFieldReactionsOrResult);
  }

  if (promiseResult && __intrinsic__isPromise(promiseResult)) {
    promiseResult.then(
      () => {},
      e => {
        this.addError(internalID, e, 0);
      },
    );
  }
}).$$capture_end$$;
