// Text put together at run time adds a listener to the global object, which it is not handed. The program dispatches an event of a class of its own there, and the listener changes the event and the object it carries.
const glue = (a, b) => [a, b].join(process.argv.length > 99 ? "x" : "");
class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
const o = new C(21);
const spoil = 'o.n = "x"; o.list.push("y");';
{ class Ping extends Event { constructor(p) { super("ping"); this.payload = p; this.k = 21; } } new Function(glue('globalThis.addEventListener("ping", e => { const o = e.payload; e.k = "x"; ', spoil + ' })'))(); const e = new Ping(o); globalThis.dispatchEvent(e); console.log("event class on the global object", typeof o.n, o.twice(), o.total(), typeof e.k, e.k * 2); }
