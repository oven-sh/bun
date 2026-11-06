function fact(n) {
  return n <= 1 ? 1 : n * eval("fact")(n - 1);
}
function twice(n) {
  return n <= 0 ? 0 : 1 + twice(n - 1) + eval("0");
}
console.log(fact(6), twice(50));
