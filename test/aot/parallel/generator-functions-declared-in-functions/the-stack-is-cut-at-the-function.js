const n = +process.argv[2] || 3;
function f() {
  function g() { const o = {}; Error.captureStackTrace(o, g); return o.stack.includes("at g"); }
  const a = () => g(), b = () => g();
  return [a(), b()].join();
}
console.log(String(f()));
