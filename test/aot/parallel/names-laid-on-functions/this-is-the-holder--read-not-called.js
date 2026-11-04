const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Ok(v) { this.v = v; }
function Err(e) { this.e = e; }
const first = function (v) { return new Ok(v + 1); };
const other = function (v) { return new Ok(v + 100); };
function read(n) { const f = Ok.of; return typeof f + (f === first) + (f === other); }
const show = (when) => console.log(when, attempt(() => read(5)));
Ok.of = function (v) { return new this(v + 1); }; Err.of = Ok.of; show("a"); console.log(Err.of(1).e);
