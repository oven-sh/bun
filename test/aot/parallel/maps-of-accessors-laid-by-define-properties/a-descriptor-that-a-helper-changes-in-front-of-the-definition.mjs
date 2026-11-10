function A(n) { this.n = n; }
function change(x) { x.get = function () { return "text" + this.n; }; }
function lay() {
  const d = { configurable: true, get() { return 1; } };
  const map = { first: d };
  change(d);
  Object.defineProperties(A.prototype, map);
}
lay();
function read(a) { return a.first + 1; }
const a = new A(2); let s = ""; for (let i = 0; i < 30; i++) s = read(a);
console.log(s, typeof s);
