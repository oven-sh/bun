const n = +process.argv[2] || 3;
function f() {
  function g() { return () => g; }
  const a = () => g()(), b = () => g()();
  return a() === b();
}
console.log(String(f()));
