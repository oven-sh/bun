const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Ok(v) { this.v = v; }
function Err(e) { this.e = e; }
const first = function (v) { return new Ok(v + 1); };
const other = function (v) { return new Ok(v + 100); };
function read(n) { let t = 0; for (let i = 0; i < n; i++) t += Ok.of(i & 7).v; return t; }
const show = (when) => console.log(when, attempt(() => read(5)));
Ok.of = 5; console.log(attempt(() => Ok.of(1)), Ok.of + 1);
