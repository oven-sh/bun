import type { FallbackMessageContainer } from "../../src/api/schema";
import { maybeInjectApp } from "macro:./appInjector";

var globalStyles = [];
function insertGlobalStyleSheet({ detail: url }) {
  globalStyles.push(
    new Promise((resolve, reject) => {
      const link: HTMLLinkElement = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.onload = resolve;
      link.onabort = reject;
      link.onerror = reject;
      document.head.appendChild(link);
    })
  );
}

const nCSS = document.createElement("noscript");
nCSS.setAttribute("data-n-css", "");
document.head.appendChild(nCSS);

document.addEventListener("onimportcss", insertGlobalStyleSheet);

var once = false;
function insertNextHeadCount() {
  if (!once) {
    document.head.insertAdjacentHTML(
      "beforeend",
      `<meta name="next-head-count" content="0">`
    );
    once = true;
  }
}

maybeInjectApp();

globalThis.__BUN_APP_STYLES = [...globalThis["__BUN"].allImportedStyles].map(
  (style) => {
    const url = new URL(style, location.origin);
    if (url.origin === location.origin && url.href === style) {
      return url.pathname;
    }

    return style;
  }
);

import { _boot, pageLoader } from "./client.development";

function renderFallback({ router }: FallbackMessageContainer) {
  const route = router.routes.values[router.route];

  if (!document.getElementById("__next")) {
    const next = document.createElement("div");
    next.id = "__next";
    document.body.prepend(next);
  }

  document.removeEventListener("onimportcss", insertGlobalStyleSheet);
  document.addEventListener("onimportcss", pageLoader.onImportCSS);

  var cssQueue;
  return import(route)
    .then((Namespace) => {
      nCSS.remove();
      document.head.appendChild(nCSS);
      cssQueue = [...globalStyles, ...pageLoader.cssQueue];
      pageLoader.cssQueue = [];
      insertNextHeadCount();
      return _boot(Namespace, true);
    })
    .then(() => {
      cssQueue = [...cssQueue, ...pageLoader.cssQueue.slice()];
      pageLoader.cssQueue = [];
      return Promise.allSettled(cssQueue);
    })
    .finally(() => {
      document.body.style.visibility = "visible";
      document.removeEventListener("onimportcss", pageLoader.onImportCSS);
    });
}

export default function render(props: FallbackMessageContainer) {
  // @ts-expect-error bun:error.js is real
  return import("/bun:error.js").then(({ renderFallbackError }) => {
    return renderFallback(props).then(
      () => {
        Promise.all(pageLoader.cssQueue).finally(() => {
          renderFallbackError(props);
          document.body.style.visibility = "visible";
        });
      },
      (err) => {
        console.error(err);
        Promise.all(pageLoader.cssQueue).finally(() => {
          renderFallbackError(props);
        });
      }
    );
  });
}
