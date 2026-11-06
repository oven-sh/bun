import { listen } from "./listen.mjs";
const code =
  'const inner = new Worker("' +
  import.meta.url +
  '/../posts.mjs"); inner.onerror = () => postMessage("the inner Worker did not load"); inner.onmessage = async event => postMessage(event.data + ", " + (await import("' +
  import.meta.url +
  '/../../../high.mjs")).said);';
export const start = () => listen(new Worker("data:text/javascript," + encodeURIComponent(code)));
