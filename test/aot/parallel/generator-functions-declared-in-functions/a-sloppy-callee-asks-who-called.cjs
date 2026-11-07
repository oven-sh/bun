const n = +process.argv[2] || 3;
function f() {
  function h() { return h.caller; }
  function g() { return h(); }
  const a = () => g(), b = () => g();
  return a() === b();
}
console.log(String(f()));
