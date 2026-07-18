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
    // The native EventTarget drops node's [kResistStopPropagation] option, so an
    // earlier listener's stopImmediatePropagation() would silence a plain
    // addEventListener. The abort algorithm runs in runAbortSteps() before
    // dispatch and cannot be suppressed; the paired once-listener keeps
    // events.listenerCount(signal, 'abort') observable like node's addEventListener.
    const counted = () => {};
    signal.addEventListener("abort", counted, { __proto__: null, once: true } as AddEventListenerOptions);
    const algorithmId = $addAbortAlgorithmToSignal(signal, function () {
      removeEventListener = undefined;
      const event = new Event("abort");
      // @ts-ignore
      Object.defineProperty(event, "target", { __proto__: null, value: signal, configurable: true });
      // @ts-ignore
      Object.defineProperty(event, "currentTarget", { __proto__: null, value: signal, configurable: true });
      listener.$call(signal, event);
    });
    removeEventListener = () => {
      // Remove the algorithm first so eventListenersDidChange() sees an empty
      // m_abortAlgorithms and can cancel an unobserved AbortSignal.timeout timer.
      $removeAbortAlgorithmFromSignal(signal, algorithmId);
      signal.removeEventListener("abort", counted);
    };
  }
  return {
    __proto__: null,
    [Symbol.dispose]() {
      removeEventListener?.();
    },
  };
}

export default {
  addAbortListener,
};
