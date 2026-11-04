function f() {
  return 1;
}
console.log(String(f));
console.log(f());
// 0+9 (bun --aot: where direct evals were given their scopes)
