import { insertStyleSheet } from "./page-loader";

const globalCSSQueue = [];
function insertGlobalStyleSheet({ detail }) {
  globalCSSQueue.push(insertStyleSheet(detail));
}

document.addEventListener("onimportcss", insertGlobalStyleSheet, {
  passive: true,
});

import { renderError, _boot, pageLoader } from "./client.development";

export default function render({ router, reason, problems }) {
  const route = router.routes[router.route];
  if (!document.getElementById("__next")) {
    const next = document.createElement("div");
    next.id = "__next";
    document.body.prepend(next);
    document.head.insertAdjacentHTML(
      "beforeend",
      `<meta name="next-head-count" content="2">`
    );
  }

  document.removeEventListener("onimportcss", insertGlobalStyleSheet);
  document.addEventListener("onimportcss", pageLoader.onImportCSS, {
    passive: true,
  });
  import(route)
    .then((Namespace) => {
      return _boot(Namespace, true);
    })
    .then(() => {
      const cssQueue = pageLoader.cssQueue;
      pageLoader.cssQueue = [];
      return Promise.all([...cssQueue, ...globalCSSQueue]);
    })
    .finally(() => {
      document.body.style.visibility = "visible";
      document.removeEventListener("onimportcss", pageLoader.onImportCSS);
    });
}
