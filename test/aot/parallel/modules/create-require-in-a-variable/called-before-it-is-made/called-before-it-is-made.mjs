import { createRequire } from "node:module";
try {
  console.log(load());
} catch (error) {
  console.log(error.name);
}
var made = createRequire(import.meta.url);
function load() {
  return made("./lib/local.cjs").name;
}
console.log(load());
