const n = +process.argv[2] || 3;
function f() {
  function g(v) { if (v !== undefined) g.kept = v; return g.kept; }
  const a = () => g(n), b = () => g();
  a();
  return b();
}
console.log(String(f()));
