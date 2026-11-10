function outer() {
  const g = globalThis;
  return text => g.parseInt(text, 16) + g.Math.max(1, 2);
}
console.log(outer()("ff"));
