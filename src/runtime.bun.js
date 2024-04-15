export * from "./runtime";

// TODO: these are duplicated from bundle_v2.js, can we ... not do that?
export var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function")
      throw TypeError('Object expected to be assigned to "using" declaration');
    let dispose;
    if (async) dispose = value[Symbol.asyncDispose];
    if (dispose === void 0) dispose = value[Symbol.dispose];
    if (typeof dispose !== "function") throw TypeError("Object not disposable");
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};

export var __callDispose = (stack, error, hasError) => {
  let fail = e =>
      (error = hasError
        ? new SuppressedError(e, error, "An error was suppressed during disposal")
        : ((hasError = true), e)),
    next = it => {
      while ((it = stack.pop())) {
        try {
          var result = it[1] && it[1].call(it[2]);
          if (it[0]) return Promise.resolve(result).then(next, e => (fail(e), next()));
        } catch (e) {
          fail(e);
        }
      }
      if (hasError) throw error;
    };
  return next();
};
