const { validateAbortSignal, validateFunction } = require("internal/validators");
const { resistStopPropagation } = require("internal/shared");

type ArmAbortEvent = (signal: AbortSignal) => Event;
type FinishAbortEvent = (event: Event) => void;

// Bound at the first call that needs them: a signal is rarely aborted before it is listened to.
let armAbortEvent: ArmAbortEvent | undefined;
let finishAbortEvent: FinishAbortEvent | undefined;

function addAbortListener(signal: AbortSignal, listener: (event: Event) => void): Disposable {
  if (signal === undefined) {
    throw $ERR_INVALID_ARG_TYPE("signal", "AbortSignal", signal);
  }
  validateAbortSignal(signal, "signal");
  validateFunction(listener, "listener");

  let removeEventListener: (() => void) | undefined;
  if (signal.aborted) {
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      const arm = (armAbortEvent ??= $newCppFunction(
        "JSEventTargetNode.cpp",
        "jsFunctionNodeEventsArmAbortEvent",
        1,
      ) as ArmAbortEvent);
      const finish = (finishAbortEvent ??= $newCppFunction(
        "JSEventTargetNode.cpp",
        "jsFunctionNodeEventsFinishAbortEvent",
        1,
      ) as FinishAbortEvent);
      // Nothing is dispatched, so no other listener of the signal runs. The listener gets the event
      // that a dispatch would have handed it: trusted, with the signal as its target. As in node,
      // the event of a listener that throws stays in its dispatching state.
      const event = arm(signal);
      listener(event);
      finish(event);
    });
    removeEventListener = () => {
      disposed = true;
    };
  } else {
    // TODO(atlowChemi) add { subscription: true } and return directly
    signal.addEventListener("abort", listener, resistStopPropagation({ __proto__: null, once: true }));
    removeEventListener = () => {
      signal.removeEventListener("abort", listener);
    };
  }
  return {
    __proto__: null,
    [Symbol.dispose]() {
      removeEventListener?.();
    },
  } as Disposable;
}

export default {
  addAbortListener,
};
