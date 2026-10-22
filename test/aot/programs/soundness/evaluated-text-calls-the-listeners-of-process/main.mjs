// Text put together at run time reads the listeners that the program has added to process and calls them with another kind of operand.
const glue = (a, b) => [a, b].join(process.argv.length > 99 ? "x" : "");
class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
const o = new C(21);
const spoil = 'o.n = "x"; o.list.push("y");';
{ let calls = 0; const mine = n => { calls += n; }; process.on("ping", mine); new Function(glue('for (const f of process.listeners("ping")) f("x")', ''))(); console.log("listeners", typeof calls, calls); }
