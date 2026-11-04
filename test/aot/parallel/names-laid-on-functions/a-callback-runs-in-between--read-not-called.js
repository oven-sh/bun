const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Ok(v) { this.v = v; }
function Err(e) { this.e = e; }
const first = function (v) { return new Ok(v + 1); };
const other = function (v) { return new Ok(v + 100); };
function read(n) { const f = Ok.of; return typeof f + (f === first) + (f === other); }
const show = (when) => console.log(when, attempt(() => read(5)));
[0].forEach(() => show("in the callback")); Ok.of = first; show("behind");
