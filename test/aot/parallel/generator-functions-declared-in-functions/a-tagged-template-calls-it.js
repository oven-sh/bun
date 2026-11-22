const n = +process.argv[2] || 3;
function f() {
  function tag(strings) { return strings; }
  const a = () => tag`x`, b = () => tag`x`;
  return [a() === a(), a() === b()].join();
}
console.log(String(f()));
