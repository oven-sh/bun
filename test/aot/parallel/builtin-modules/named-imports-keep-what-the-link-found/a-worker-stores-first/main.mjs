// A Worker stores into its node:path and its node:zlib and answers, then the entry stores into its own: each thread's named imports keep what its own link found.
import path, { sep, join } from "node:path";
import zlib, { gzipSync } from "node:zlib";
function listen(worker) {
  return new Promise(resolve => {
    worker.onmessage = event => resolve("says " + event.data);
    worker.onerror = event => (event.preventDefault(), resolve("fails"));
  }).finally(() => worker.terminate());
}
console.log("the worker", await listen(new Worker(new URL("./w.mjs", import.meta.url))));
path.join = () => "patched by the entry";
path.sep = "?";
zlib.gzipSync = () => "patched by the entry";
console.log(
  "the entry says",
  sep,
  join("a", "b"),
  path.sep,
  path.join("a", "b"),
  typeof gzipSync("x"),
  zlib.gzipSync("x"),
);
