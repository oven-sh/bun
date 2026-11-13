const n = +process.argv[2] || 3;
const seen = new Map();
function f() {
  function g() { seen.set(g, (seen.get(g) || 0) + 1); return seen.size; }
  const a = () => g(), b = () => g();
  return [a(), b()].join();
}
console.log(String(f()));
