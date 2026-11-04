const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Ok(v) { this.v = v; }
function Err(e) { this.e = e; }
const first = function (v) { return new Ok(v + 1); };
const other = function (v) { return new Ok(v + 100); };
function read(n) { return ("of" in Ok) + "," + Object.hasOwn(Ok, "of") + "," + Object.keys(Ok).join(); }
const show = (when) => console.log(when, attempt(() => read(5)));
console.log(attempt(() => { Ok.name = "x"; return 1; }), attempt(() => { Ok.length = 9; return 1; }), Ok.name, Ok.length);
