const n = +process.argv[2] || 3;
function f(k) {
  function* gen() { yield k; yield k + 1; }
  const a = () => gen(), b = () => gen();
  const x = a(), y = b();
  return [Object.getPrototypeOf(x) === Object.getPrototypeOf(y), x.next().value, y.next().value, x.next().value].join();
}
console.log(String(f(n)));
