// The native EventEmitter backing `process` stores `once()` listeners as the original function plus
// a flag, so there is no wrapper to hand back from rawListeners(). Materialize one on demand to
// expose the `.listener` back-pointer Node documents.
export function createOnceWrapper(target, type, listener) {
  var fired = false;
  function onceWrapper() {
    if (fired) return undefined;
    fired = true;
    // removeListener() resolves a wrapper to the listener it wraps, so this removes whichever of the
    // two is actually registered.
    target.removeListener(type, onceWrapper);
    return listener.$apply(target, arguments);
  }
  onceWrapper.listener = listener;
  return onceWrapper;
}
