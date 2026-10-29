function f() {
  return 1;
}
function g() {
  return eval("f()") + 1;
}
console.log(String(f));
console.log(String(g));
console.log(g());
// 0+9 (bun --aot: where direct evals were given their scopes)
