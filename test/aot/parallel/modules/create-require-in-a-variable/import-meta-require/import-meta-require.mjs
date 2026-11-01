var __require = import.meta.require;
function load() {
  return __require("./lib/local.cjs").name;
}
console.log(load(), __require("./lib/held.cjs").name);
