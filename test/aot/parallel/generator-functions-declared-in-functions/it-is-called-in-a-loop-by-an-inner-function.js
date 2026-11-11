const n = +process.argv[2] || 3;
function f() {
  function* gen() { yield n; }
  const a = () => gen();
  const seen = new Set();
  for (let i = 0; i < n + 2; i++) seen.add(Object.getPrototypeOf(a()));
  return seen.size;
}
console.log(String(f()));
