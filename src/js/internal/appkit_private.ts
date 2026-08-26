// Hooks bun:objc and bun:appkit install at load for bun:internal-for-testing.
// User code cannot resolve internal modules, so nothing here is public.

type Hooks = {
  /** Views made and not yet collected. */
  liveViews(): number;
  /** Test-only native hooks; see `AppKitApp::testing`. */
  testing(op: string, a?: unknown, b?: unknown): unknown;
};

// bun:internal-for-testing may ask before (or without) either loading.
export default {
  liveViews: () => 0,
  testing() {
    throw new Error("bun:objc is not loaded");
  },
} as Hooks;
