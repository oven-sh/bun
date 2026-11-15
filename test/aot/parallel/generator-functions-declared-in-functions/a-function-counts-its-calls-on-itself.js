const n = +process.argv[2] || 3;
function f() {
  function g() { g.count = (g.count || 0) + 1; return g.count; }
  const a = () => g(), b = () => g();
  return [a(), b(), a()].join();
}
console.log(String(f()));
