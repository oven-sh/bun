// Text put together at run time plants toJSON on Map.prototype, so serializing a map of the program hands the map to it.
const glue = (a, b) => [a, b].join(process.argv.length > 99 ? "x" : "");
class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
const o = new C(21);
const spoil = 'o.n = "x"; o.list.push("y");';
{ const m = new Map([[1, 2]]); new Function(glue('Map.prototype.toJSON = function () { this.set(1, "x"); return 1; ', '}'))(); console.log("toJSON on Map.prototype", JSON.stringify({ m }), typeof m.get(1), m.get(1) * 2); }
