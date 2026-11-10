function load() {
  return require("./dep.cjs");
}
console.log(load().same());
