// A file that a function requires takes names out of a built in module by a pattern.
function load() {
  return require("./methods.cjs");
}
console.log(load().methods.includes("get"), load().methods.includes("GET"), load().textOf(404));
