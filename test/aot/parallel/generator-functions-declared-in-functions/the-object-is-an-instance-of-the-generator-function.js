const n = +process.argv[2] || 3;
function f() {
  function* gen() { yield n; }
  const a = () => gen(), is = (o) => o instanceof gen, p = () => gen.prototype;
  return [is(a()), Object.getPrototypeOf(a()) === p()].join();
}
console.log(String(f()));
