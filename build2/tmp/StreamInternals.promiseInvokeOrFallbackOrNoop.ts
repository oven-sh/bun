// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/StreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(object,key1,args1,key2,args2) {  try {
    const method = object[key1];
    if (method === undefined) return __intrinsic__promiseInvokeOrNoopNoCatch(object, key2, args2);
    return __intrinsic__shieldingPromiseResolve(method.__intrinsic__apply(object, args1));
  } catch (error) {
    return Promise.__intrinsic__reject(error);
  }
}).$$capture_end$$;
