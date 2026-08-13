export * from "./runtime";

// Same as RUNTIME_USING_BUN in src/bundler/ParseTask.rs (keep in sync), plus `next.then` below.
export var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function")
      throw TypeError('Object expected to be assigned to "using" declaration');
    let dispose, inner;
    if (async) dispose = value[Symbol.asyncDispose];
    if (dispose == null) {
      dispose = value[Symbol.dispose];
      if (async) inner = dispose;
    }
    if (typeof dispose !== "function") throw TypeError("Object not disposable");
    if (inner)
      dispose = function () {
        try {
          inner.call(this);
        } catch (e) {
          return Promise.reject(e);
        }
      };
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};

export var __callDispose = (stack, error, hasError) => {
  let needsAwait,
    hasAwaited,
    next = () => {
      for (var it; (it = stack.pop()); ) {
        if (!it[0] && needsAwait && !hasAwaited) {
          needsAwait = false;
          stack.push(it);
          next.result = void 0;
          return next;
        }
        try {
          var result = it[1] && it[1].call(it[2]);
        } catch (e) {
          next.fail(e);
          continue;
        }
        if (it[0]) {
          if (it[1]) {
            hasAwaited = true;
            next.result = result;
            return next;
          }
          needsAwait = true;
        }
      }
      if (needsAwait && !hasAwaited) {
        needsAwait = false;
        next.result = void 0;
        return next;
      }
      if (hasError) throw error;
    };
  next.fail = e =>
    (error = hasError
      ? new SuppressedError(e, error, "An error was suppressed during disposal")
      : ((hasError = true), e));
  // `then` is what files lowered by older versions of Bun hit: they `await` the return value.
  let drive = () =>
    Promise.resolve(next.result).then(
      () => next() && drive(),
      e => (next.fail(e), next()) && drive(),
    );
  next.then = (onFulfilled, onRejected) => drive().then(onFulfilled, onRejected);
  return next();
};
