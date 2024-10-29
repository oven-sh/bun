// This file contains the client-side logic for the built in React Server
// Components integration. It is designed as a minimal base to build RSC
// applications on, and to showcase what features that Bake offers.
/// <reference lib="dom" />
import * as React from "react";
import { hydrateRoot } from "react-dom/client";
import { createFromReadableStream } from "react-server-dom-webpack/client.browser";
import { bundleRouteForDevelopment } from "bun:bake/client";

function assertionFailed(msg: string) {
  throw new Error(`Assertion Failure: ${msg}. This is a bug in Bun's React integration`);
}

// In development, verify that React 19 is being used. Using `React.*` makes the import
// not fail at build time, allowing this better error message to surface.
if (import.meta.env.DEV && !React.use) {
  throw new Error("Bun's React integration requires React 19");
}

// Client-side entry point expects an RSC payload. In development, let's fail
// loudly if this is somehow missing.
const initialPayload = document.getElementById("rsc_payload");
if (import.meta.env.DEV) {
  if (!initialPayload) assertionFailed("Missing #rsc_payload in HTML response");
}

// React takes in a ReadableStream with the payload.
let promise = createFromReadableStream(new Response(initialPayload!.innerText).body!);
initialPayload!.remove();

// This is a function component that uses the `use` hook, which unwraps a promise.
// The promise results in a component containing suspense boundaries.
let setPage;
const Async = () => {
  setPage = React.useState(promise)[1];
  return React.use(promise);
};
const root = hydrateRoot(document, <Async />, {
  // handle `onUncaughtError` here
});

// Client side navigation is implemented by updating the app's `useState` with a
// new RSC payload promise. An abort controller is used to cancel a previous
// navigation. Callers of `goto` are expected to manage history state.
let currentReloadCtrl: AbortController | null = null;
async function goto(href: string) {
  if (currentReloadCtrl) {
    currentReloadCtrl.abort();
  }
  const signal = (currentReloadCtrl = new AbortController()).signal;

  const wait100ms = new Promise<void>(resolve => setTimeout(resolve, 100))

  // Due to the current implementation of the Dev Server, it must be informed of
  // client-side routing so it can load client components. This is not necessary
  // in production, and calling this in that situation will fail to compile.
  if (import.meta.env.DEV) {
    await bundleRouteForDevelopment(href, { signal });
  }

  let response;
  try {
    // When using static builds, it isn't possible for the server to reliably
    // branch on the `Accept` header. Instead, a static build creates a `.rsc`
    // file that can be fetched. `import.meta.env.STATIC` is inlined by Bake.
    response = await fetch(
      import.meta.env.STATIC //
        ? `${href.replace(/\/(?:index)?$/, "")}/index.rsc`
        : href,
      {
        headers: {
          Accept: "text/x-component",
        },
        signal: signal,
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch ${href}: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    // Bail out to browser navigation if this fetch fails.
    console.error(err);
    location.href = href;
    return;
  }

  if (signal.aborted) return;

  // TODO: error handling? abort handling?
  const p = createFromReadableStream(response.body!);

  // TODO: ensure CSS is ready

  // Wait up to 100ms before updating the page promise.
  await Promise.race([p, wait100ms]);

  if (signal.aborted) return;

  // Use a react transition to update the page promise.
  React.startTransition(() => {
    if (signal.aborted) return;
    setPage((promise = p));
  });
}

// Instead of relying on a "<Link />" component, a global event listener on all
// clicks can be used. Care must be taken to filter out only anchors that
// did not have their default behavior prevented, as well as non-left clicks.
//
// This technique was inspired by SvelteKit which was inspired by https://github.com/visionmedia/page.js
document.addEventListener("click", async (event, element = event.target as HTMLAnchorElement) => {
  if (
    event.button ||
    event.which != 1 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.defaultPrevented
  )
    return;

  while (element && element !== document.body) {
    // This handles shadow roots
    if (element.nodeType === 11) element = (element as any).host;

    // If the current tag is an anchor.
    if (element.nodeName.toUpperCase() === "A" && element.hasAttribute("href")) {
      let url;
      try {
        url = new URL(element instanceof SVGAElement ? element.href.baseVal : element.href, document.baseURI);
      } catch {
        // Bail out to browser logic
        return;
      }
      
      let pathname = url.pathname;
      if (pathname.endsWith("/")) {
        pathname = pathname.slice(0, -1);
      }

      // Ignore if the link is external
      if (url.origin !== origin || (element.getAttribute("rel") || "").split(/\s+/).includes("external")) {
        return;
      }

      // TODO: consider `target` attribute

      // Take no action at all if the url is the same page.
      // However if there is a hash, don't call preventDefault()
      if (pathname === location.pathname && url.search === location.search) {
        return url.hash || event.preventDefault();
      }

      const href = url.href;
      history.pushState({}, "", href);
      goto(href);

      return event.preventDefault();
    }

    // Walk up the tree until an anchor or the body is found.
    element = (element.assignedSlot ?? element.parentNode) as HTMLAnchorElement;
  }
});

// Handle browser navigation events
window.addEventListener("popstate", () => goto(location.href));

// Frameworks can export a `onServerSideReload` function to hook into server-side
// hot module reloading. This export is not used in production and tree-shaken.
export async function onServerSideReload() {
  goto(location.href);
}
