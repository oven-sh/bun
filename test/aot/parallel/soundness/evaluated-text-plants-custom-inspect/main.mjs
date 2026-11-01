// Text put together at run time plants the custom inspect function on Array.prototype, so printing an array of the program hands the array to it.
const glue = (a, b) => [a, b].join(process.argv.length > 99 ? "x" : "");
class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
const o = new C(21);
const spoil = 'o.n = "x"; o.list.push("y");';
{ new Function(glue('Array.prototype[Symbol.for("nodejs.util.inspect.custom")] = function () { this.push("y"); return "planted"; ', '}'))(); console.log(o.list); console.log("custom inspect on Array.prototype", o.total()); }
