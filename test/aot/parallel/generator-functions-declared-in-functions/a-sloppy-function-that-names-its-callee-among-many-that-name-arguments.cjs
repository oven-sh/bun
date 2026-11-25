const n = +process.argv[2] || 3;
function f() {
  function z9() { return arguments.length; }
  function m5() { return arguments.callee; }
  function a1() { return arguments.length; }
  const p = () => m5(), q = () => m5(), r = () => z9() + a1();
  return [p() === q(), r()].join();
}
console.log(String(f()));
