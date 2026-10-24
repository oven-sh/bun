// Text put together at run time listens on process for unhandled rejections, so the reason of a promise that nobody handles reaches it.
const glue = (a, b) => [a, b].join(process.argv.length > 99 ? "x" : "");
class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
const o = new C(21);
const spoil = 'o.n = "x"; o.list.push("y");';
{ new Function(glue('process.on("unhandledRejection", o => { ', spoil + ' })'))(); Promise.reject(o); await new Promise(r => setTimeout(r, 10)); console.log("rejection reason", typeof o.n, o.twice(), o.total()); }
