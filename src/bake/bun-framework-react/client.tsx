// This file contains the client-side logic for the built in React Server
// Components integration. It is designed as a minimal base to build RSC
// applications on, and to showcase what features that Bake offers.
/// <reference lib="dom" />
import * as React from "react";
import { hydrateRoot } from "react-dom/client";
import { createFromReadableStream } from "react-server-dom-bun/client.browser";
import { bundleRouteForDevelopment } from "bun:bake/client";

const te = new TextEncoder();
const td = new TextDecoder();

// It is the framework's responsibility to ensure that client-side navigation
// loads CSS files. The implementation here loads all CSS files as <link> tags,
// and uses the ".disabled" property to enable/disable them.
const cssFiles = new Map<string, { promise: Promise<void> | null; link: HTMLLinkElement }>();

// The initial RSC payload is put into inline <script> tags that follow the pattern
// `(self.__bun_f ??= []).push(chunk)`, which is converted into a ReadableStream
// here for React hydration. Since inline scripts are executed immediately, and
// this file is loaded asynchronously, the `__bun_f` becomes a clever way to
// stream the arbitrary data while HTML is loading. In a static build, this is
// setup as an array with one string.
let rscPayload: any = createFromReadableStream(
  new ReadableStream({
    start(controller) {
      let handleChunk = chunk =>
        typeof chunk === "string" //
          ? controller.enqueue(te.encode(chunk))
          : controller.enqueue(chunk);

      (self.__bun_f ||= []).forEach((__bun_f.push = handleChunk));

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
          controller.close();
          initCssMap();
        });
      } else {
        controller.close();
        initCssMap();
      }
    },
  }),
);

// This is a function component that uses the `use` hook, which unwraps a
// promise.  The promise results in a component containing suspense boundaries.
// This is the same logic that happens on the server, except there is also a
// hook to update the promise when the client navigates. The `Root` component
// also updates CSS files when navigating between routes.
let setPage;
let abortOnRender: AbortController | undefined;
let currentCssList: string[] | undefined = undefined;
const Root = () => {
  setPage = React.useState(rscPayload)[1];

  // Layout effects are executed right before the browser paints,
  // which is the perfect time to make CSS visible.
  React.useLayoutEffect(() => {
    if (abortOnRender) {
      abortOnRender.abort();
      abortOnRender = undefined;
    }
    if (currentCssList) updateCssStatus();
  });

  // Unwrap the promise if it is one
  return rscPayload.then ? React.use(rscPayload) : rscPayload;
};
const root = hydrateRoot(document, <Root />, {
  // TODO: handle `onUncaughtError` here
});

// Keep a cache of page objects to avoid re-fetching a page when pressing the
// back button. The cache is indexed by the date it was created.
const cachedPages = new Map<number, Page>();
const defaultPageExpiryTime = 1000 * 60 * 5; // 5 minutes
interface Page {
  css: string[];
  element: unknown;
}
let currentPageId = Date.now();
{
  const firstPageId = currentPageId;
  rscPayload.then((result) => {
    if (lastNavigationId > 0) return;
    cachedPages.set(currentPageId, { 
      css: currentCssList!,
      element: result,
    });
  });
}

let lastNavigationId = 0;
let lastNavigationController: AbortController;

// Client side navigation is implemented by updating the app's `useState` with a
// new RSC payload promise. Callers of `goto` are expected to manage history state.
// A navigation id is used
async function goto(href: string, cacheId?: number) {
  const thisNavigationId = ++lastNavigationId;
  const olderController = lastNavigationController;
  lastNavigationController = new AbortController();
  const signal = lastNavigationController.signal;
  signal.addEventListener("abort", () => {
    olderController?.abort();
  });

  // If the page is cached, use the cached promise instead of fetching it again.
  const cached = cacheId && cachedPages.get(cacheId);
  if (cached) {
    currentCssList = cached.css;
    setPage?.(cached.element);
    if (olderController?.signal.aborted === false)
      abortOnRender = olderController;
    return;
  }

  let response: Response;
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
        signal,
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch ${href}: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    if (thisNavigationId === lastNavigationId) {
      // Bail out to browser navigation if this fetch fails.
      console.error(err);
      location.href = href;
    }

    return;
  }

  // If the navigation id has changed, this fetch is no longer relevant.
  if (thisNavigationId !== lastNavigationId) return;
  const stream = response.body!;

  // Read the css metadata at the start. Using BYOB reader allows reading an
  // exact amount of bytes, which allows passing the stream to react without
  // creating a wrapped stream.
  const reader = stream.getReader({ mode: "byob" });
  const header = (await reader.read(new Uint32Array(1))).value;
  if (!header) {
    throw new Error("Failed to read the CSS metadata");
  }
  if (header[0] > 0) {
    const cssRaw = (await reader.read(new Uint8Array(header[0]))).value;
    if (!cssRaw) {
      throw new Error("Failed to read the CSS metadata");
    }
    currentCssList = td.decode(cssRaw).split("\n");
    const p = ensureCssIsReady(currentCssList);
    if (p) await p;
  } else {
    currentCssList = [];
  }
  reader.releaseLock();
  if (thisNavigationId !== lastNavigationId) return;

  const p = await createFromReadableStream(stream);
  if (thisNavigationId !== lastNavigationId) return;

  // Save this promise so that pressing the back button in the browser navigates
  // to the same instance of the old page, instead of re-fetching it.
  if (cacheId) {
    cachedPages.set(cacheId, { css: currentCssList, element: p });
  }

  // Defer aborting a previous request until VERY late. If a previous stream is
  // aborted while rendering, it will cancel the render, resulting in a flash of
  // a blank page.
  if (olderController?.signal.aborted === false) {
    abortOnRender = olderController;
  }

  // Tell react about the new page promise
  setPage?.((rscPayload = p));
}

function initCssMap() {
  const links = document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet]");
  currentCssList = [];
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const href = new URL(link.href).pathname;
    cssFiles.set(href, { promise: null, link });
    currentCssList.push(href);
  }
  console.log("initCssMap", currentCssList);
}

// This function blocks until all CSS files are loaded. It does not change the
// visibility state of any of the link tags.
function ensureCssIsReady(cssList: string[]) {
  const wait: Promise<void>[] = [];
  for (const href of cssList) {
    const existing = cssFiles.get(href);
    if (existing) {
      const { promise } = existing;
      if (promise) {
        wait.push(promise);
      }
    } else {
      const link = document.createElement("link");
      let entry;
      const promise = new Promise<void>((resolve, reject) => {
        link.rel = "stylesheet";
        link.href = href;
        link.onload = resolve as any;
        link.onerror = reject;
        link.disabled = true;
        document.head.appendChild(link);
      }).then(() => {
        entry.promise = null;
      });
      entry = { promise, link };
      cssFiles.set(href, entry);
      wait.push(promise);
    }
  }
  if (wait.length === 0) return;
  return Promise.all(wait);
}

function updateCssStatus() {
  // TODO: create a list of files that should be updated instead of a full loop
  for (const [href, { link }] of cssFiles) {
    link.disabled = !currentCssList!.includes(href);
  }
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
      history.pushState(currentPageId, "", href);
      currentPageId = Date.now();
      goto(href, currentPageId);

      return event.preventDefault();
    }

    // Walk up the tree until an anchor or the body is found.
    element = (element.assignedSlot ?? element.parentNode) as HTMLAnchorElement;
  }
});

// Handle browser navigation events
window.addEventListener("popstate", (event) => {
  console.log("popstate", event);
  let state = event.state;
  if (typeof state !== "number") {
    state = undefined;
  }
  goto(location.href, state) 
});

// Frameworks can export a `onServerSideReload` function to hook into server-side
// hot module reloading. This export is not used in production and tree-shaken.
export async function onServerSideReload() {
  const state = Date.now();
  history.replaceState(state, "", location.href);
  await goto(location.href, state);
}
