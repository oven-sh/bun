const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Ok(v) { this.v = v; }
function Err(e) { this.e = e; }
const first = function (v) { return new Ok(v + 1); };
const other = function (v) { return new Ok(v + 100); };
function read(n) { const { of } = Ok; return of(n).v; }
const show = (when) => console.log(when, attempt(() => read(5)));
let turn = 0; Ok.of = function (v) { if (++turn === 3) Ok.of = other; return new Ok(v + 1); }; show("a"); show("b");
