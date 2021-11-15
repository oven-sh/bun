import { insertStyleSheet } from "./page-loader";
import type { FallbackMessageContainer } from "../../src/api/schema";

var once = false;
function insertNextHeadCount() {
  if (!once) {
    document.head.insertAdjacentHTML(
      "beforeend",
      `<meta name="next-head-count" content="${document.head.childElementCount}">`
    );
    once = true;
  }
}
function insertGlobalStyleSheet(detail) {
  pageLoader.cssQueue.push(
    insertStyleSheet(detail).then(() => {
      insertNextHeadCount();
    })
  );
}

[...globalThis["__BUN"].allImportedStyles].map((detail) =>
  insertGlobalStyleSheet(detail)
);

document.addEventListener("onimportcss", insertGlobalStyleSheet, {
  passive: true,
});

import { _boot, pageLoader } from "./client.development";

function renderFallback({ router }: FallbackMessageContainer) {
  const route = router.routes.values[router.route];

  if (!document.getElementById("__next")) {
    const next = document.createElement("div");
    next.id = "__next";
    document.body.prepend(next);
  }

  document.removeEventListener("onimportcss", insertGlobalStyleSheet);
  document.addEventListener("onimportcss", pageLoader.onImportCSS, {
    passive: true,
  });

  globalThis.__NEXT_DATA__.pages["/_app"] = [
    ...(globalThis.__NEXT_DATA__.pages["/_app"] || []),
    ...globalThis["__BUN"].allImportedStyles,
  ];

  return import(route)
    .then((Namespace) => {
      insertNextHeadCount();
      return _boot(Namespace, true);
    })
    .then(() => {
      const cssQueue = pageLoader.cssQueue.slice();
      pageLoader.cssQueue = [];
      return Promise.all([...cssQueue]);
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
