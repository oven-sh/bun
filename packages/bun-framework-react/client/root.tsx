import { use, useLayoutEffect, type ReactNode } from "react";
import { isThenable } from "../lib/util.ts";
import { APP_RSC_PAYLOAD } from "./react.ts";
import { useStore } from "./simple-store.ts";

// This is a function component that uses the `use` hook, which unwraps a
// promise.  The promise results in a component containing suspense boundaries.
// This is the same logic that happens on the server, except there is also a
// hook to update the promise when the client navigates. The `Root` component
// also updates CSS files when navigating between routes.
export function Root(): ReactNode {
  const rscPayload = useStore(APP_RSC_PAYLOAD);

  // Layout effects are executed right before the browser paints,
  // which is the perfect time to make CSS visible.
  useLayoutEffect(() => {
    if (abortOnRender) {
      try {
        abortOnRender.abort();
        abortOnRender = undefined;
      } catch {}
    }

    requestAnimationFrame(() => {
      if (currentCssList) disableUnusedCssFiles();
    });
  });

  return isThenable(rscPayload) ? use(rscPayload) : rscPayload;
}
