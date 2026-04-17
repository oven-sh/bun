// Service worker variant of the HMR runtime.
//
// Service workers require event listeners (install, fetch, activate) to be
// registered *synchronously* at the top level during initial script evaluation.
// The client runtime uses `(async (h, L) => { ... })({...})` and calls
// `await loadModuleAsync(config.main, ...)` which defers listener registration
// past the first microtask — incompatible with service workers.
//
// This variant:
//  - Uses a synchronous IIFE wrapper (produced by bake-codegen.ts for target=worker)
//  - Calls `loadModuleSync(config.main, ...)` so user event listeners run at top level
//  - Refuses top-level-await modules (not supported in classic service workers)
//  - No WebSocket HMR connection (browsers kill idle SWs, making live HMR fragile)
//  - Updates come via the standard SW lifecycle: dev server rebuilds on file change,
//    browser fetches new /worker.js bytes, installs + activates new version
import "./debug";
import { loadModuleSync } from "./hmr-module";

if (typeof IS_BUN_DEVELOPMENT !== "boolean") {
  throw new Error("DCE is configured incorrectly");
}

// `?bundle` imports are patched at bundle time to call `__bun_submanifest(path)`
// so that the server and worker observe the same manifest at runtime (including
// CSS files traced after linking). The HMR runtime populates this helper with
// the manifest data sent in `config.manifests` by the dev server.
(globalThis as any).__bun_submanifest = (path: string) => {
  const manifests = (config as any).manifests ?? {};
  return manifests[path] ?? { files: [] };
};

// Load the entry point SYNCHRONOUSLY so any top-level `self.addEventListener`
// calls in the user's code run before the install phase completes.
try {
  loadModuleSync(config.main, false, null);
} catch (e: any) {
  if (e?.asyncId) {
    console.error(
      "[Bun] Service worker entry cannot use top-level await. " +
        "Module: " +
        e.asyncId +
        ". " +
        "Classic service workers must register event listeners synchronously.",
    );
  }
  console.error(e);
}
