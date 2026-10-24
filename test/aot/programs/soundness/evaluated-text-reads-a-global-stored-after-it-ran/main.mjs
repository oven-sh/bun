// Text put together at run time starts a timer that reads a property of the global object which the program stores only afterwards.
const glue = (a, b) => [a, b].join(process.argv.length > 99 ? "x" : "");
class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
const o = new C(21);
const spoil = 'o.n = "x"; o.list.push("y");';
{ new Function(glue('setTimeout(() => { const o = globalThis.late; ', spoil + ' }, 5)'))(); globalThis.late = o; await new Promise(r => setTimeout(r, 20)); console.log("a global stored after the text ran", typeof o.n, o.twice(), o.total()); }
