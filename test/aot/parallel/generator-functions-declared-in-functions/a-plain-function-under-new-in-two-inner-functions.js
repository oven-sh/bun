const n = +process.argv[2] || 3;
function f() {
  function Point() { this.x = n; }
  const a = () => new Point(), b = () => new Point();
  return Object.getPrototypeOf(a()) === Object.getPrototypeOf(b());
}
console.log(String(f()));
