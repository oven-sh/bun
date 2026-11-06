// Instance goes through call and promisify.
class Cell { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
function route(name, f) {
  const c = new Cell(21);
  try { out = f(c); } catch (e) { console.log(name, "threw", e.name, e.message); return; }
}
route("call this", c => (function () { return this; }).call(c));
route("promisify", c => require("node:util").promisify(cb => cb(null, c))());
