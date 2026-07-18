const { validateAbortSignal, validateFunction } = require("internal/validators");

function addAbortListener(signal: AbortSignal, listener: EventListener): Disposable {
  if (signal === undefined) {
    throw $ERR_INVALID_ARG_TYPE("signal", "AbortSignal", signal);
  }
  validateAbortSignal(signal, "signal");
  validateFunction(listener, "listener");

  let removeEventListener;
  if (signal.aborted) {
    queueMicrotask(() => listener());
  } else {
    // The native EventTarget drops node's [kResistStopPropagation] listener
    // option, so an earlier listener's stopImmediatePropagation() would
    // silence this one. A native abort algorithm runs in runAbortSteps()
    // before the 'abort' event dispatch and cannot be suppressed; algorithms
    // are one-shot, preserving the `once` semantics.
    const algorithmId = $addAbortAlgorithmToSignal(signal, function () {
      removeEventListener = undefined;
      const event = new Event("abort");
      Object.defineProperty(event, "target", { value: signal, configurable: true });
      Object.defineProperty(event, "currentTarget", { value: signal, configurable: true });
      listener.$call(signal, event);
    });
    removeEventListener = () => {
      $removeAbortAlgorithmFromSignal(signal, algorithmId);
    };
  }
  return {
    [Symbol.dispose]() {
      removeEventListener?.();
    },
  };
}

export default {
  addAbortListener,
};
