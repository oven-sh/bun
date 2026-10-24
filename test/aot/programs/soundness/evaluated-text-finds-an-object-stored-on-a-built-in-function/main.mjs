// The program stores an object on a built-in function, where text put together at run time finds it.
const glue = (a, b) => [a, b].join(process.argv.length > 99 ? "x" : "");
class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
const o = new C(21);
const spoil = 'o.n = "x"; o.list.push("y");';
{ setTimeout.o = o; new Function(glue('const o = setTimeout.o; ', spoil))(); console.log("stored on setTimeout", typeof o.n, o.twice(), o.total()); }
