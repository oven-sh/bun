const n = +process.argv[2] || 3;
function f() {
  function g(k) { return k ? g(k - 1) : g; }
  const a = () => g(n), b = () => g(0);
  return a() === b();
}
console.log(String(f()));
