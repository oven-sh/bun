const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Ok(v) { this.v = v; }
function Err(e) { this.e = e; }
const first = function (v) { return new Ok(v + 1); };
const other = function (v) { return new Ok(v + 100); };
function read(n) { const f = Ok.of; return typeof f + (f === first) + (f === other); }
const show = (when) => console.log(when, attempt(() => read(5)));
Object.defineProperty(Ok, "of", { get() { return other; }, set(v) { }, configurable: true }); Ok.of = first; show("b");
