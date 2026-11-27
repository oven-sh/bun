import { createRequire } from "node:module";
function read({ moduleUrl, mark }) {
  return createRequire(moduleUrl)("./lib/part.json").name + mark;
}
console.log("SAID", read({ moduleUrl: import.meta.url, mark: "!" }));
