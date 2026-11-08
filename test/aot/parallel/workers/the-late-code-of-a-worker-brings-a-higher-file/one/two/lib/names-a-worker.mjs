import { listen } from "./listen.mjs";
const code =
  'const inner = new Worker("' +
  import.meta.url +
  '/../posts.mjs"); inner.onerror = () => postMessage("the inner Worker did not load"); inner.onmessage = event => import("' +
  import.meta.url +
  '/../../../high.mjs").then(high => postMessage(event.data + ", " + high.said), error => postMessage("threw " + [error.name, error.message, error.specifier, error.referrer].join(" | ")));';
export const start = () => listen(new Worker("data:text/javascript," + encodeURIComponent(code)));
