import { createRequire } from "node:module";
let calls = 0;
const get = () => (calls++, createRequire(import.meta.url));
function make() {
  return createRequire(import.meta.url);
}
console.log("SAID", get()("./lib/part.cjs"), make()("./lib/index.cjs"), calls);
