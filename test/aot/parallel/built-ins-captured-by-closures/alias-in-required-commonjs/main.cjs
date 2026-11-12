// The file is required inside a function, so its body may run again and its constants are captured locals.
function load() {
  return require("./dep.cjs");
}
console.log(load().kind());
