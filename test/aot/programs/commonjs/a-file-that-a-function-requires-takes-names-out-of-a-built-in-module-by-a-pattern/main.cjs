function load() {
  return require("./methods.cjs");
}
console.log(load().methods.includes("get"), load().methods.includes("GET"), load().textOf(404));
