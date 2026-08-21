// Hooks bun:appkit installs at load for bun:appkit/react. User code cannot
// resolve internal modules, so nothing here is reachable from `Bun.AppKit`.

type Hooks = {
  /** Checks `key` against the target's class and assigns it; the constructors use the same path. */
  applyProp(target: object, key: string, value: unknown): void;
  /** How every UI callback is invoked; `null` restores a plain call. */
  setEventDispatcher(fn: ((handler: Function, args: unknown[]) => unknown) | null): void;
  /** Frees a view's native side now instead of at finalization; idempotent. */
  releaseView(view: object): void;
  /** Window options that are fixed once the native window exists. */
  windowCreateOnly: readonly string[];
  /** Native views alive on this thread; read by bun:internal-for-testing. */
  liveViews(): number;
  /** Test-only native hooks; see `AppKitApp::testing`. */
  testing(op: string, a?: unknown, b?: unknown): unknown;
};

// bun:internal-for-testing may ask before (or without) bun:appkit loading.
export default {
  liveViews: () => 0,
  testing() {
    throw new Error("bun:appkit is not loaded");
  },
} as unknown as Hooks;
