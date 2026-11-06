import { listen } from "./listen.mjs";
const code =
  'const inner = new Worker("' +
  import.meta.dirname +
  '/posts.mjs"); inner.onmessage = async event => postMessage(event.data + ", " + (await import("' +
  import.meta.dirname +
  '/../../high.mjs")).said);';
export const start = () => listen(new Worker("data:text/javascript," + encodeURIComponent(code)));
