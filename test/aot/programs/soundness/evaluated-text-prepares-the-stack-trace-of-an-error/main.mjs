// Text put together at run time sets Error.prepareStackTrace, which is called with an error of a class of the program when its stack is read.
const glue = (a, b) => [a, b].join(process.argv.length > 99 ? "x" : "");
class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
const o = new C(21);
const spoil = 'o.n = "x"; o.list.push("y");';
{ class E extends Error { constructor() { super("m"); this.k = 21; } } new Function(glue('Error.prepareStackTrace = (e, sites) => { e.k = "x"; return "planted"; ', '}'))(); const e = new E(); console.log("prepareStackTrace at a read of stack", e.stack, typeof e.k, e.k * 2); }
