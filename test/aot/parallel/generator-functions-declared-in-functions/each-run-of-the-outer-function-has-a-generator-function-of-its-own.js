const n = +process.argv[2] || 3;
function f() {
  function* gen() { yield n; }
  const a = () => gen();
  return Object.getPrototypeOf(a());
}
console.log(String(f() === f()));
