// Port of node's lib/internal/async_context_frame.js surface for
// --expose-internals consumers (vendored node tests) and for Bun's own
// built-ins that need to swap the active async-context frame around a
// callback — the JS-side equivalent of the native
// AsyncContextFrame::call / withAsyncContextIfNeeded.
//
// Bun tracks async context natively in the engine (AsyncLocalStorage rides
// JSC's async context), so context propagation is always enabled and the
// "frame" is the raw internal-field value (an even-length [ALS, value, ...]
// array or undefined) — see the comment at the top of node/async_hooks.ts.
// A Bun.ModuleGraph's context travels next to the frame, in the second field of the same tuple
// (undefined: the host's). JSC and native code capture and restore the two together; script
// that keeps a frame for later keeps the graph next to it.

const AsyncContextFrame = {
  enabled: true,
  current() {
    return $getInternalField($asyncContext, 0);
  },
  /** The Bun.ModuleGraph whose context the running script is inside of, if any. */
  currentGraph() {
    return $getInternalField($asyncContext, 1);
  },
  /** Install `frame` as the active async-context frame; returns the previous one. */
  exchange(frame) {
    const prev = $getInternalField($asyncContext, 0);
    $putInternalField($asyncContext, 0, frame);
    return prev;
  },
  /**
   * Call `fn` as `graph` (a currentGraph() of earlier; undefined: the host), so that what it
   * opens is that graph's. When that is not the caller's graph, the caller's AsyncLocalStorage
   * frame does not come along: what `fn` opens outlives the call and would keep its stores.
   */
  runInGraph(graph, fn, thisArg?, ...args) {
    const prevGraph = $getInternalField($asyncContext, 1);
    if (graph === prevGraph) return fn.$apply(thisArg, args);
    const prevFrame = $getInternalField($asyncContext, 0);
    $putInternalField($asyncContext, 0, undefined);
    $putInternalField($asyncContext, 1, graph);
    try {
      return fn.$apply(thisArg, args);
    } finally {
      $putInternalField($asyncContext, 0, prevFrame);
      $putInternalField($asyncContext, 1, prevGraph);
    }
  },
  /**
   * Call `fn` with `frame` and `graph` installed, restoring the previous ones afterwards: what
   * script that kept both for later calls back in. Fast-paths when both are already active
   * (which includes the "no ALS in use anywhere" case where both are undefined).
   */
  runInContext(frame, graph, fn, thisArg?, ...args) {
    const prevFrame = $getInternalField($asyncContext, 0);
    const prevGraph = $getInternalField($asyncContext, 1);
    if (frame === prevFrame && graph === prevGraph) return fn.$apply(thisArg, args);
    $putInternalField($asyncContext, 0, frame);
    $putInternalField($asyncContext, 1, graph);
    try {
      return fn.$apply(thisArg, args);
    } finally {
      $putInternalField($asyncContext, 0, prevFrame);
      $putInternalField($asyncContext, 1, prevGraph);
    }
  },
};

export default AsyncContextFrame;
