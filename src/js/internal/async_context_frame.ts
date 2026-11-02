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
// The Bun.ModuleGraph a frame chain is inside of, and the frame that entered its context:
// ModuleGraph.cpp walks the chain (AsyncLocalStorage's frames say nothing about graphs).
const moduleGraphOfFrame = $newCppFunction("ModuleGraph.cpp", "jsFunctionModuleGraphOfFrame", 1);
const moduleGraphFrameOfFrame = $newCppFunction("ModuleGraph.cpp", "jsFunctionModuleGraphFrameOfFrame", 1);
// Bound at the first call: most programs that load this module call neither.
let keepAsyncContextWithoutModuleGraphs: ((owner: object, frame: unknown) => boolean) | undefined;
let enterAsyncContextInCurrentModuleGraph: ((owner: object, frame: unknown) => void) | undefined;

const AsyncContextFrame = {
  enabled: true,
  current() {
    return $getInternalField($asyncContext, 0);
  },
  /**
   * The frame a Bun.ModuleGraph's context was entered with, when the running script is inside
   * one. What something long-lived `run()`s its later work in so that the work is that graph's,
   * without keeping the AsyncLocalStorage stores of whoever happened to create it.
   */
  currentGraphFrame() {
    return moduleGraphFrameOfFrame($getInternalField($asyncContext, 0));
  },
  /** The Bun.ModuleGraph whose context the running script is inside of, if any. */
  currentGraph() {
    return moduleGraphOfFrame($getInternalField($asyncContext, 0));
  },
  /** The Bun.ModuleGraph whose context `frame` (a current() or currentGraphFrame() of earlier) is inside of. */
  graphOf(frame) {
    return moduleGraphOfFrame(frame);
  },
  /**
   * For something long-lived (`owner`) whose later work must read the AsyncLocalStorage stores of `frame` and must
   * not keep a Bun.ModuleGraph alive through the frame that entered it. Where `frame` has a frame of a graph in it,
   * native code keeps the stores for `owner` and the answer is true. Elsewhere the answer is false: keep `frame`.
   * A store value, and the frame of a module mock's factory, are kept with the stores.
   */
  keepWithoutModuleGraphs(owner, frame) {
    keepAsyncContextWithoutModuleGraphs ??= $newCppFunction(
      "ModuleGraph.cpp",
      "jsFunctionKeepAsyncContextWithoutModuleGraphs",
      2,
    );
    return keepAsyncContextWithoutModuleGraphs!(owner, frame);
  },
  /**
   * Makes current the frame that enters the Bun.ModuleGraph of the running script over the stores that
   * keepWithoutModuleGraphs() kept for `owner`, or over `frame` where it kept none. Returns the frame to
   * exchange() back. Native code installs the frame: where built-in JS holds a frame that native code has made, an
   * ahead-of-time build loses the types of the program's stores.
   */
  enterCurrentModuleGraphOver(owner, frame) {
    enterAsyncContextInCurrentModuleGraph ??= $newCppFunction(
      "ModuleGraph.cpp",
      "jsFunctionEnterAsyncContextInCurrentModuleGraph",
      2,
    );
    const previous = $getInternalField($asyncContext, 0);
    enterAsyncContextInCurrentModuleGraph!(owner, frame);
    return previous;
  },
  /** Install `frame` as the active async-context frame; returns the previous one. */
  exchange(frame) {
    const prev = $getInternalField($asyncContext, 0);
    $putInternalField($asyncContext, 0, frame);
    return prev;
  },
  /**
   * Call `fn` with `frame` installed as the active async-context frame,
   * restoring the previous frame afterwards. Fast-paths when `frame` is
   * already active (which includes the "no ALS in use anywhere" case where
   * both are undefined).
   */
  run<R>(frame, fn: (...args: any[]) => R, thisArg?: unknown, ...args: unknown[]): R {
    const prev = $getInternalField($asyncContext, 0);
    if (frame === prev) return fn.$apply(thisArg, args);
    $putInternalField($asyncContext, 0, frame);
    try {
      return fn.$apply(thisArg, args);
    } finally {
      $putInternalField($asyncContext, 0, prev);
    }
  },
};

export default AsyncContextFrame;
