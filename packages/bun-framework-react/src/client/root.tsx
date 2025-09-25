import { use, useLayoutEffect, type ReactNode } from "react";
import { useAppState } from "./app.ts";
import { router } from "./constants.ts";
import { isThenable } from "./lib/util.ts";

// This is a function component that uses the `use` hook, which unwraps a
// promise.  The promise results in a component containing suspense boundaries.
// This is the same logic that happens on the server, except there is also a
// hook to update the promise when the client navigates. The `Root` component
// also updates CSS files when navigating between routes.
export function Root(): ReactNode {
  const app = useAppState();

  // Layout effects are executed right before the browser paints,
  // which is the perfect time to make CSS visible.
  useLayoutEffect(() => {
    if (app.abortOnRender) {
      try {
        app.abortOnRender.abort();
      } catch {}
    }

    requestAnimationFrame(() => {
      router.css.disableUnusedCssFilesIfNeeded();
    });
  });

  return isThenable(app.rsc) ? use(app.rsc) : app.rsc;
}
