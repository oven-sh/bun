// This file contains the client-side logic for the built in React Server
// Components integration. It is designed as a minimal base to build RSC
// applications on, and to showcase what features that Bake offers.
/// <reference lib="dom" />
import * as React from "react";
import { hydrateRoot } from "react-dom/client";
import { createFromReadableStream } from "react-server-dom-bun/client.browser";
import { bundleRouteForDevelopment } from "bun:bake/client";

let encoder = new TextEncoder();
let promise = createFromReadableStream(
  new ReadableStream({
    start(controller) {
      let handleChunk = chunk =>
        typeof chunk === "string" //
          ? controller.enqueue(encoder.encode(chunk))
          : controller.enqueue(chunk);

      (self.__bun_f ||= []).forEach((__bun_f.push = handleChunk));

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
          controller.close();
        });
      } else {
        controller.close();
      }
    },
  }),
);

// This is a function component that uses the `use` hook, which unwraps a
// promise.  The promise results in a component containing suspense boundaries.
// This is the same logic that happens on the server, except there is also a
// hook to update the promise when the client navigates.
let setPage;
const Root = () => {
  setPage = React.useState(promise)[1];
  return React.use(promise);
};
const root = hydrateRoot(document, <Root />, {
  // handle `onUncaughtError` here
});

// Client side navigation is implemented by updating the app's `useState` with a
// new RSC payload promise. An abort controller is used to cancel a previous
// navigation. Callers of `goto` are expected to manage history state.
let currentReloadCtrl: AbortController | null = null;
async function goto(href: string) {
  // TODO: this abort signal stuff doesnt work
  // if (currentReloadCtrl) {
  //   currentReloadCtrl.abort();
  // }
  // const signal = (currentReloadCtrl = new AbortController()).signal;

  // Due to the current implementation of the Dev Server, it must be informed of
  // client-side routing so it can load client components. This is not necessary
  // in production, and calling this in that situation will fail to compile.
  if (import.meta.env.DEV) {
    await bundleRouteForDevelopment(href, {
      // signal
    });
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
        // signal: signal,
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

  // if (signal.aborted) return;

  // TODO: error handling? abort handling?
  const p = createFromReadableStream(response.body!);

  // TODO: ensure CSS is ready
  // Right now you can see a flash of unstyled content, since react does not
  // wait for new link tags to load before they are injected.

  // Use a react transition to update the page promise.
  // TODO: How to get this show after 100ms, it hangs until all suspenses resolve
  // React.startTransition(() => {
  //   if (signal.aborted) return;
  //   setPage((promise = p));
  // });
  setPage?.((promise = p));
}

// Instead of relying on a "<Link />" component, a global event listener on all
// clicks can be used. Care must be taken to intercept only anchor elements that
// did not have their default behavior prevented, non-left clicks, and more.
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
  await goto(location.href);
}
