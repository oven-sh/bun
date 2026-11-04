// An object keeps the prototype that its constructor had when the object was made: the first of two objects was made late, behind the write to `Q.prototype`, in the first run of a warm function.
function launderZero() { return 0; }
function launderKey(key) { return [key, "other"][launderZero()]; }
function Q() {}
const first = Q.prototype;
first.describe = function () { return "first"; };
const second = { describe() { return "second"; }, other: "second" };
function warm(a) { const w = new Q(); return JSON.stringify(w) + Object.keys(w).length; }
warm(9);
function run(a) { const q = new Q(); Reflect.defineProperty(Q, "prototype", { value: second }); const x = 1; q[launderKey("b")] = x; const r = new Q(); Reflect.defineProperty(Q, "prototype", { value: first }); const y = 1; r.b = y; return String(q.describe() + " " + q.a) + " " + String(r.describe() + " " + r.a) + " " + ("other" in q) + " " + ("other" in r); }
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
