const n = +process.argv[2] || 3;
function f() {
  function* g() { g.count = (g.count || 0) + 1; yield g.count; }
  const a = () => g().next().value, b = () => g().next().value;
  return [a(), b()].join();
}
console.log(String(f()));
