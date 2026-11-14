require("./styles.cjs");
console.log(globalThis.made);
function load() {
  require("./styles.cjs");
}
load();
load();
console.log(globalThis.made, require("./styles.cjs").count);
