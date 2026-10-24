// The program stores an object on process.stdout, where text put together at run time finds it.
const glue = (a, b) => [a, b].join(process.argv.length > 99 ? "x" : "");
class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
const o = new C(21);
const spoil = 'o.n = "x"; o.list.push("y");';
{ process.stdout.o = o; new Function(glue('const o = process.stdout.o; ', spoil))(); console.log("stored on process.stdout", typeof o.n, o.twice(), o.total()); }
