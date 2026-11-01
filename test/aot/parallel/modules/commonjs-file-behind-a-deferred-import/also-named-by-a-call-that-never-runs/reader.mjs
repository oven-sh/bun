import defer * as later from "./later.mjs";
console.log("reader.mjs runs", typeof later);
function uncalled() {
  return import("./later.mjs");
}
