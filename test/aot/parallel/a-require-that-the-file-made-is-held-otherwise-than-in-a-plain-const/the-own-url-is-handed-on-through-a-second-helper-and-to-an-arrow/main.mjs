import { createRequire } from "node:module";
function inner(moduleUrl) {
  const require = createRequire(moduleUrl);
  return require("./lib/part.json").name;
}
function outer(moduleUrl) {
  return inner(moduleUrl);
}
const arrow = moduleUrl => createRequire(moduleUrl)("./lib/index.json").name;
console.log("SAID", outer(import.meta.url), arrow(import.meta.url), arrow(import.meta.url));
