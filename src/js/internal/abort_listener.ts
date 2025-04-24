const { validateAbortSignal, validateFunction } = require("internal/validators");
const { kResistStopPropagation } = require("internal/shared");

function addAbortListener(signal: AbortSignal, listener: EventListener): Disposable {
  if (signal === undefined) {
    throw $ERR_INVALID_ARG_TYPE("signal", "AbortSignal", signal);
  }
  validateAbortSignal(signal, "signal");
  validateFunction(listener, "listener");

  let removeEventListener: (() => void) | undefined;
  if (signal.aborted) {
    queueMicrotask(() => listener());
  } else {
    // TODO(atlowChemi) add { subscription: true } and return directly
    signal.addEventListener("abort", listener, { once: true, [kResistStopPropagation]: true });
    removeEventListener = () => {
      signal.removeEventListener("abort", listener, { [kResistStopPropagation]: true });
    };
  }
  return {
    [Symbol.dispose]() {
      if (removeEventListener) removeEventListener();
    },
  } as Disposable;
}

export default {
  addAbortListener,
};