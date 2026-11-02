// `import defer` puts off when a file runs, not when it is linked: a CommonJS file that the deferred file imports runs ahead of the entry point.
import defer * as later from "./later.mjs";
console.log("main.mjs runs", typeof later);
function uncalled() {
  return import("./later.mjs");
}
