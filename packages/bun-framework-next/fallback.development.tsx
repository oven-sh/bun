import { insertStyleSheet } from "./page-loader";
import type {
  FallbackMessageContainer,
  FallbackStep,
} from "../../../src/api/schema";

var once = false;
function insertGlobalStyleSheet(detail) {
  if (!once) {
    document.head.insertAdjacentHTML(
      "beforeend",
      `<meta name="next-head-count" content="${document.head.childElementCount}">`
    );
    once = true;
  }
  pageLoader.cssQueue.push(insertStyleSheet(detail).then(() => {}));
}

[...globalThis["__BUN"].allImportedStyles].map((detail) =>
  insertGlobalStyleSheet(detail)
);

document.addEventListener("onimportcss", insertGlobalStyleSheet, {
  passive: true,
});

import { renderError, _boot, pageLoader } from "./client.development";
import { renderFallbackError } from "bun-error";

function renderFallback({
  router,
  reason,
  problems,
}: FallbackMessageContainer) {
  const route = router.routes[router.route];

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
    ...globalThis.__NEXT_DATA__.pages["/_app"],
    ...globalThis["__BUN"].allImportedStyles,
  ];

  return import(route)
    .then((Namespace) => {
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
  renderFallback(props).then(
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
}
