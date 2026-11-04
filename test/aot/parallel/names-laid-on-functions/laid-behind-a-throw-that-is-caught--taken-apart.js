const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Ok(v) { this.v = v; }
function Err(e) { this.e = e; }
const first = function (v) { return new Ok(v + 1); };
const other = function (v) { return new Ok(v + 100); };
function read(n) { const { of } = Ok; return of(n).v; }
const show = (when) => console.log(when, attempt(() => read(5)));
try { if (process.argv.length < 99) throw new Error("stop"); Ok.of = first; } catch (e) { } show("a");
