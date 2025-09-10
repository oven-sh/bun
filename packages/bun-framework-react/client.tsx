// This file contains the client-side logic for the built in React Server
// Components integration. It is designed as a minimal base to build RSC
// applications on, and to showcase what features that Bake offers.
/// <reference lib="dom" />
import { onServerSideReload } from "bun:app/client";
import { flushSync } from "react-dom";
import { hydrateRoot } from "react-dom/client";
import { createFromReadableStream } from "react-server-dom-bun/client.browser";
import { type NonNullishReactNode } from "./client/react.ts";

const td = new TextDecoder();

const windowDebugKey = "$bake";

interface WindowDebugObject {
  navigate: typeof navigate;
  onServerSideReload: typeof onServerSideReload;
  readonly currentCssList: typeof currentCssList;
}

type WindowWithBakeDebugObject = { [key in typeof windowDebugKey]: WindowDebugObject };
declare global {
  interface Window extends WindowWithBakeDebugObject {}
}

// It is the framework's responsibility to ensure that client-side navigation
// loads CSS files. The implementation here loads all CSS files as <link> tags,
// and uses the ".disabled" property to enable/disable them.
const cssFiles = new Map<string, { promise: Promise<void> | null; link: HTMLLinkElement }>();
let currentCssList: string[] | undefined = undefined;

// let setPage: React.Dispatch<React.SetStateAction<Promise<NonNullishReactNode> | NonNullishReactNode>>;
// let abortOnRender: AbortController | undefined;
// const Root = () => {
//   setPage = React.useState(rscPayload)[1];

//   // Unwrap the promise if it is one
//   return isThenable(rscPayload) ? React.use(rscPayload) : rscPayload;
// };

hydrateRoot(document, <Root />, {
  onUncaughtError(e) {
    console.error(e);
  },
});

// Keep a cache of page objects to avoid re-fetching a page when pressing the
// back button. The cache is indexed by the date it was created.
const cachedPages = new Map<number, Page>();
// const defaultPageExpiryTime = 1000 * 60 * 5; // 5 minutes
interface Page {
  css: string[];
  element: NonNullishReactNode;
}

const firstPageId = Date.now();
{
  history.replaceState(firstPageId, "", location.href);
  rscPayload.then(result => {
    if (lastNavigationId > 0) return;

    // Collect the list of CSS files that were added from SSR
    const links = document.querySelectorAll<HTMLLinkElement>("link[data-bake-ssr]");
    currentCssList = [];
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      if (!link) continue;
      const href = new URL(link.href).pathname;
      currentCssList.push(href);

      // Hack: cannot add this to `cssFiles` because React owns the element, and
      // it will be removed when any navigation is performed.
    }

    cachedPages.set(firstPageId, {
      css: currentCssList!,
      element: result,
    });
  });

  if (document.startViewTransition !== undefined) {
    // View transitions are used by navigations to ensure that the page rerender
    // all happens in one operation. Additionally, developers may animate
    // different elements. The default fade animation is disabled so that the
    // out-of-the-box experience feels like there are no view transitions.
    // This is done client-side because a React error will unmount all elements.
    const sheet = new CSSStyleSheet();
    document.adoptedStyleSheets.push(sheet);
    sheet.replaceSync(":where(*)::view-transition-group(root){animation:none}");
  }
}

let lastNavigationId = 0;
let lastNavigationController: AbortController;

// Client side navigation is implemented by updating the app's `useState` with a
// new RSC payload promise. Callers of `navigate` are expected to manage history
// state. A navigation id is used
async function navigate(href: string, cacheId?: number): Promise<void> {
  const thisNavigationId = ++lastNavigationId;
  const olderController = lastNavigationController;

  lastNavigationController = new AbortController();
  const signal = lastNavigationController.signal;
  signal.addEventListener("abort", () => {
    olderController?.abort();
  });

  // If the page is cached, use the cached promise instead of fetching it again.
  const cached = (cacheId !== undefined && cachedPages.get(cacheId)) || undefined;
  if (cached) {
    currentCssList = cached.css;
    await ensureCssIsReady(currentCssList);
    rscPayload = cached.element;
    setPage(rscPayload);
    if (olderController?.signal.aborted === false) abortOnRender = olderController;
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
  let stream = response.body!;

  // Read the css metadata at the start before handing it to react.
  stream = await readCssMetadata(stream);
  if (thisNavigationId !== lastNavigationId) return;

  const cssWaitPromise = ensureCssIsReady(currentCssList!);

  const p = await createFromReadableStream(stream);
  if (thisNavigationId !== lastNavigationId) return;

  if (cssWaitPromise) {
    await cssWaitPromise;
    if (thisNavigationId !== lastNavigationId) return;
  }

  // Save this promise so that pressing the back button in the browser navigates
  // to the same instance of the old page, instead of re-fetching it.
  if (cacheId) {
    cachedPages.set(cacheId, { css: currentCssList!, element: p });
  }

  // Defer aborting a previous request until VERY late. If a previous stream is
  // aborted while rendering, it will cancel the render, resulting in a flash of
  // a blank page.
  if (olderController?.signal.aborted === false) {
    abortOnRender = olderController;
  }

  // Tell react about the new page promise
  if (setPage) {
    if (document.startViewTransition as unknown) {
      document.startViewTransition(() => {
        flushSync(() => {
          if (thisNavigationId === lastNavigationId) setPage((rscPayload = p));
        });
      });
    } else {
      setPage((rscPayload = p));
    }
  }
}

// This function blocks until all CSS files are loaded.
function ensureCssIsReady(cssList: string[]) {
  const wait: Promise<void>[] = [];
  for (const href of cssList) {
    const existing = cssFiles.get(href);
    if (existing) {
      const { promise, link } = existing;
      if (promise) {
        wait.push(promise);
      }
      link.disabled = false;
    } else {
      const link = document.createElement("link");
      let entry: { promise: Promise<void> | null; link: HTMLLinkElement };
      const promise = new Promise<void>((resolve, reject) => {
        link.rel = "stylesheet";
        link.onload = resolve.bind(null, undefined);
        link.onerror = reject;
        link.href = href;
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

function disableUnusedCssFiles() {
  // TODO: create a list of files that should be updated instead of a full loop
  for (const [href, { link }] of cssFiles) {
    if (!currentCssList!.includes(href)) {
      link.disabled = true;
    }
  }
}

window.addEventListener("popstate", async event => {
  const state = typeof event.state === "number" ? event.state : undefined;

  await navigate(location.href, state);
});

if (import.meta.env.DEV) {
  // Frameworks can call `onServerSideReload` to hook into server-side hot
  // module reloading.
  onServerSideReload(async () => {
    const newId = Date.now();
    history.replaceState(newId, "", location.href);
    await navigate(location.href, newId);
  });

  // Expose a global in Development mode
  window[windowDebugKey] = {
    navigate,
    onServerSideReload,
    get currentCssList() {
      return currentCssList;
    },
  };
}

async function readCssMetadata(stream: ReadableStream<Uint8Array<ArrayBuffer>>) {
  let reader: ReadableStreamBYOBReader;

  try {
    // Using BYOB reader allows reading an exact amount of bytes, which allows
    // passing the stream to react without creating a wrapped stream.
    reader = stream.getReader({ mode: "byob" });
  } catch (e) {
    return readCssMetadataFallback(stream);
  }

  const header = (await reader.read(new Uint32Array(1))).value;
  if (!header) {
    if (import.meta.env.DEV) {
      throw new Error("Did not read all bytes! This is a bug in bun-framework-react");
    } else {
      location.reload();
    }
  }

  if (header[0] > 0) {
    const cssRaw = (await reader.read(new Uint8Array(header[0]))).value;
    if (!cssRaw) {
      if (import.meta.env.DEV) {
        throw new Error("Did not read all bytes! This is a bug in bun-framework-react");
      } else {
        location.reload();
      }
    }
    currentCssList = td.decode(cssRaw).split("\n");
  } else {
    currentCssList = [];
  }
  reader.releaseLock();
  return stream;
}

// Safari does not support BYOB reader. When this is resolved, this fallback
// should be kept for a few years since Safari on iOS is versioned to the OS.
// https://bugs.webkit.org/show_bug.cgi?id=283065
async function readCssMetadataFallback(stream: ReadableStream<Uint8Array<ArrayBuffer>>) {
  const reader = stream.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let totalBytes = 0;
  const readChunk = async (size: number) => {
    while (totalBytes < size) {
      const { value, done } = await reader.read();
      if (!done) {
        chunks.push(value);
        totalBytes += value.byteLength;
      } else if (totalBytes < size) {
        if (import.meta.env.DEV) {
          throw new Error("Not enough bytes, expected " + size + " but got " + totalBytes);
        } else {
          location.reload();
        }
      }
    }
    if (chunks.length === 1) {
      const first = chunks[0]!;
      if (first.byteLength >= size) {
        chunks[0] = first.subarray(size);
        totalBytes -= size;
        return first.subarray(0, size);
      } else {
        chunks.length = 0;
        totalBytes = 0;
        return first;
      }
    } else {
      const buffer = new Uint8Array(size);
      let i = 0;
      let chunk: Uint8Array<ArrayBuffer> | undefined;
      let len;
      while (size > 0) {
        chunk = chunks.shift();
        if (!chunk) continue;
        const { byteLength } = chunk;
        len = Math.min(byteLength, size);
        buffer.set(len === byteLength ? chunk : chunk.subarray(0, len), i);
        i += len;
        size -= len;
      }
      if (chunk.byteLength > len) {
        chunks.unshift(chunk.subarray(len));
      }
      totalBytes -= size;
      return buffer;
    }
  };
  const header = new Uint32Array(await readChunk(4))[0];

  if (header === 0) {
    currentCssList = [];
  } else if (header !== undefined) {
    currentCssList = td.decode(await readChunk(header)).split("\n");
  } else {
    throw new Error("Did not read all bytes! This is a bug in bun-framework-react");
  }

  if (chunks.length === 0) {
    return stream;
  }
  // New readable stream that includes the remaining data
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}
