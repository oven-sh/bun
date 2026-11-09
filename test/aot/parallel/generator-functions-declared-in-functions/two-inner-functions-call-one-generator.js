const n = +process.argv[2] || 3;
function f() {
  function* gen() { yield n; }
  const a = () => gen(), b = () => gen();
  return Object.getPrototypeOf(a()) === Object.getPrototypeOf(b());
}
console.log(String(f()));
