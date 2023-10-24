// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/BundlerPlugin.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(internalID,path,namespace,defaultLoaderId) {  const LOADERS_MAP = __intrinsic__LoaderLabelToId;
  const loaderName = __intrinsic__LoaderIdToLabel[defaultLoaderId];

  var promiseResult = (async (internalID, path, namespace, defaultLoader) => {
    var results = this.onLoad.__intrinsic__get(namespace);
    if (!results) {
      this.onLoadAsync(internalID, null, null);
      return null;
    }

    for (let [filter, callback] of results) {
      if (filter.test(path)) {
        var result = callback({
          path,
          namespace,
          // suffix
          // pluginData
          loader: defaultLoader,
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

        var { contents, loader = defaultLoader } = result as OnLoadResultSourceCode & OnLoadResultObject;
        if (!(typeof contents === "string") && !__intrinsic__isTypedArrayView(contents)) {
          __intrinsic__throwTypeError('onLoad plugins must return an object with "contents" as a string or Uint8Array');
        }

        if (!(typeof loader === "string")) {
          __intrinsic__throwTypeError('onLoad plugins must return an object with "loader" as a string');
        }

        const chosenLoader = LOADERS_MAP[loader];
        if (chosenLoader === undefined) {
          __intrinsic__throwTypeError(`Loader ${loader} is not supported.`);
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
    __intrinsic__isPromise(promiseResult) &&
    (__intrinsic__getPromiseInternalField(promiseResult, __intrinsic__promiseFieldFlags) & __intrinsic__promiseStateMask) === __intrinsic__promiseStateFulfilled
  ) {
    promiseResult = __intrinsic__getPromiseInternalField(promiseResult, __intrinsic__promiseFieldReactionsOrResult);
  }

  if (promiseResult && __intrinsic__isPromise(promiseResult)) {
    promiseResult.then(
      () => {},
      e => {
        this.addError(internalID, e, 1);
      },
    );
  }
}).$$capture_end$$;
