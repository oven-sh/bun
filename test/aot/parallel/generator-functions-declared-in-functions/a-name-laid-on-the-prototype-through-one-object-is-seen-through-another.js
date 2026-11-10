const n = +process.argv[2] || 3;
function f() {
  function* gen() { yield n; }
  const a = () => gen(), b = () => gen();
  Object.getPrototypeOf(a()).tag = n + 1;
  return b().tag;
}
console.log(String(f()));
