function f() {
  return 1;
}
function g() {
  return eval("f()") + 1;
}
console.log(String(f));
console.log(String(g));
console.log(g());
// bun --aot: this file is not UTF-8: read as the runtime reads it
