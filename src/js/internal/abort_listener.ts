const { validateAbortSignal, validateFunction } = require("internal/validators");
const { kResistStopPropagation } = require("internal/shared");

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
    // TODO(atlowChemi) add { subscription: true } and return directly
    signal.addEventListener("abort", listener, { once: true, [kResistStopPropagation]: true });
    removeEventListener = () => {
      signal.removeEventListener("abort", listener);
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
