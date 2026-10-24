// Text put together at run time sets Error.prepareStackTrace, which is called with the object that the program hands to Error.captureStackTrace.
const glue = (a, b) => [a, b].join(process.argv.length > 99 ? "x" : "");
class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
const o = new C(21);
const spoil = 'o.n = "x"; o.list.push("y");';
{ new Function(glue('Error.prepareStackTrace = (o, sites) => { ', spoil + ' return "planted"; }'))(); Error.captureStackTrace(o); console.log("prepareStackTrace at captureStackTrace", o.stack, typeof o.n, o.twice(), o.total()); }
